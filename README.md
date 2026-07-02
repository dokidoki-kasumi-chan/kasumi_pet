# mibo — 智能学习伴侣桌宠 (v2.8)

户山香澄（BanG Dream!）桌宠，悬浮桌面、能聊天、帮看代码、番茄钟提醒、摸鱼检测、学习鼓励、听歌陪伴。

## 架构说明

```
┌───────────────────────────────────────────────────--─────┐
│                   TypeScript 前端 (Vite)                  │
│  ┌────────────────┐  ┌──────────────────────────────┐    │
│  │  状态机引擎      │  │  交互事件系统                  │    │
│  │  (main.ts)     │  │  ┌──────┬──────┬────────┐    │    │
│  │  13 个状态      │  │  │单击/  │剪贴板 │番茄钟/  │    │    │
│  │  冷却/防抖/锁    │  │  │双击/  │监听   │活动监控 │   │     │
│  │  60s 看门狗     │  │  │悬停   │(3s轮询)│(30s)  │   │     │
│  └────────────────┘  │  └──────┴──────┴────────┘    │     │
│  ┌────────────────┐  │  ┌─────────────────────────────┐   │
│  │  双缓冲切图      │  │  │  ApiClient (多 Provider)    │   │
│  │  (消除残影)     │  │  │  智谱/OpenAI/DeepSeek/Claude │   │
│  └────────────────┘  │  │  30s 超时 / Token 控制        │  │
│                       │  └──────────────────────────────┘ │
└──────────────────────┬───────────────────────────────--───┘
                       │ Tauri IPC (invoke / listen)
┌──────────────────────▼──────────────────────────────────┐
│                   Rust 后端 (Tauri v1)                   │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ macOS 原生模块   │  │  .env 配置 / 好感度持久化       │  │
│  │ NSWorkspace     │  │  JSON 文件存储                 │  │
│  │ CGWindowList    │  │  多角色独立数据                 │  │
│  │ AppleScript     │  │                              │   │
│  │ (超时熔断 10m)    │  │  情绪语气切换                  │  │
│  └─────────────────┘  └──────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐   │
│  │  资源层：characters/{id}/ → SOUL.md + character    │  │
│  │  .json + profile.json → 三合一 Prompt 构建         │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**设计要点：**
- **状态机架构**：13 个状态（IDLE→THINKING→CELEBRATE→HAPPY→IDLE），5 秒冷却防抖，三级锁定（thinkingLock / responseLock / bubblePermanent），60s 看门狗防卡死
- **双缓冲切图**：双 `<img>` 槽预加载下一帧，`onload` 完成瞬间切换 opacity，消除 PNG 加载闪白
- **macOS 原生集成**：CGWindowList 扫描窗口标题、NSWorkspace 检测运行应用、AppleScript 查浏览器 URL（带 3s 超时 + 10min 熔断）
- **角色数据驱动**：人物配置完全外置 `character.json` + 图片资源，新增角色只需建新目录

---

## 关键 Prompt 与 Vibe 思路

### 三层 Prompt 架构

```
人格层 (SOUL.md)      → 角色世界观、性格、价值观
  ↓
配置层 (character.json) → 状态台词、问候语、提醒语
  ↓
动态参数层            → 好感度参数注入（familiarity 三段阈值）
```

SOUL.md 是系统 prompt 的"灵魂"层，定义角色世界观（"只要不放弃，星星一定会指引我们的方向"）和核心行为模式。随后拼接 character.json 中的角色配置和 RAG 数据集（anime quotes），形成完整 system prompt。

### 好感度驱动语气切换

代码中不硬编码语气模板，而是将好感度参数注入 system prompt，让 LLM 自己感知关系深度：

```text
familiarity < 20  → 礼貌疏远（"你好，我是户山香澄……"）
familiarity 20-50 → 温暖友好（"嗨！今天也一起加油吧！"）
familiarity 50+   → 亲密熟悉（"你来啦~ 香澄一直在等你呢！"）
```

### 剪贴板内容分类（非 AI 方式）

复制内容检测不使用 AI 判断（避免浪费 token），而是纯算法分类：

```text
1. 符号密度 > 0.25                  → code
2. 行末 `;{}:` 占比 > 0.4          → code
3. 缩进行占比 > 0.3 + 有注释标记  → code
4. 英文占比 > 0.6 + 功能词 ≥ 3    → english
5. error/Exception/Traceback 匹配  → error
```

### Vibe 编码说明

全程使用 Claude Code 协作开发，典型迭代流：
1. 提出功能需求（如"检测到 B 站打开 5 分钟就提示摸鱼"）
2. AI 分析现有状态机结构 → 评估锁机制影响 → 生成修改方案
3. 审查 diff → 测试边缘情况（零点跨睡眠、番茄钟+AI 回答锁并发）
4. 发布 Release → 真实用户反馈 → 继续修复（commit 历史可见高频修复模式）

关键决策记录在 CLAUDE.md 中作为项目记忆。

---

## AI 调用逻辑

### 调用链路

```typescript
用户输入 → PetController.chat()
  → ApiClient.chatWithHistory()
    → APIConfig（读取 .env → 路由到 Provider）
    → 构建 system prompt（SOUL.md + character.json + RAG）
    → fetch(apiUrl, { method: POST, headers: Bearer token, 30s AbortController })
    → 解析响应（兼容多格式：choices[0].message.content / data.content）
    → 返回 → PetController 管理历史（保留最近 50 条）
```

## 安装

1. 从 [Releases](../../releases) 下载 `mibo_*.dmg`
2. 双击打开，拖入 `/Applications`
3. 首次打开：右键 → 打开（macOS 未签名应用提示）
4. 若提示「已损坏，无法打开」：终端执行 `xattr -cr /Applications/mibo.app`

## 基本交互

| 操作 | 效果 |
|------|------|
| **单击** 香澄 | 吓一跳 (SURPRISED) |
| **双击** 香澄 | 戳一戳 (POKED) |
| **悬停 3.5 秒不动** | 害羞 (SHY) |
| **1% 概率** | 彩蛋生气 (ANGRY) |
| **双击空白区域** | 关闭气泡，恢复待机 |
| **左上角齿轮** | 打开设置面板 |

## AI 聊天

1. 点击 **「聊天」** 按钮 → 输入消息 → 回车发送
2. 香澄进入 THINKING 状态 → 4 秒庆祝动画 → 显示 AI 回答
3. 回答保持 1 分钟后自动恢复待机，自动记忆最近 50 条对话

## 主要功能

### 剪贴板助手
复制代码/报错/大段英文时自动弹出「帮看看？」按钮，AI 分析结果保持 1 分钟。

### 摸鱼检测
打开 B站超过 5 分钟 → 坏笑脸提醒 → 再 5 分钟升级警告 → 自动恢复。

### 学习鼓励
编辑器（VS Code / Cursor / Xcode / Terminal 等）连续使用 3 分钟 → 自动弹出鼓励气泡。

### 听歌陪伴
检测到网易云音乐后台运行 → 待机台词随机插入音乐相关泡泡。

### 番茄钟
连续活跃 1 小时后自动提示 → 25 分钟专注 + 5 分钟休息 → 纯计时模式，不干扰宠物状态。

### 好感度系统
每次聊天成功 +1 好感度。familiarity 分 0-20 / 20-50 / 50+ 三档，语气从礼貌疏远到亲密熟悉逐级变化。数据按角色独立存储。

### 多角色切换
设置面板一键切换角色，图片/台词/AI 人设全部跟随，好感度独立记录。

### 深夜睡眠
00:00-08:00 自动进入 SLEEP，所有交互锁死，按钮隐藏。启动/角色切换时若在睡眠时段直接入睡。

## 定时提醒

| 触发条件 | 状态 |
|----------|------|
| 连续工作 2 小时 | SLEEPY / YAWN |
| 12:00 / 18:30 | EATING |
| 00:00 - 08:00 | SLEEP |
| 无操作 10 分钟 | YAWN |

## 配置 API

1. 点击左上角齿轮打开设置
2. 选择供应商（智谱 / OpenAI / DeepSeek / Anthropic / 自定义）
3. 填入 API Key → 保存

API Key 存储在 `~/Library/Application Support/com.kasumipet.app/.env`，仅本地保存。

## 开发

```bash
cd frontend
npm install
npm run tauri:dev      # 开发模式
npm run tauri:build    # 构建
```

> 角色图片未包含在源码中，从 [Releases](../../releases) DMG 提取 `mibo.app/Contents/Resources/characters/` 放到 `frontend/characters/`。

## 常见问题

**Q: 聊天无响应？** 检查设置中 API Key 是否正确，以及账户余额。

**Q: 更新后 API Key / 好感度丢失？** 不会。数据存在 `~/Library/Application Support/com.kasumipet.app/`，更新不覆盖。

**Q: 「已损坏」无法打开？** 终端执行 `xattr -cr /Applications/mibo.app`。未签名应用经 QQ/网盘传输会被 macOS 标记隔离。

**Q: B站检测不生效？** 系统设置 → 隐私与安全性 → 自动化 → 允许 mibo 控制浏览器。

---

> 架构设计、AI 集成方案、技术决策详见 [TECHNICAL_README.md](./TECHNICAL_README.md)
