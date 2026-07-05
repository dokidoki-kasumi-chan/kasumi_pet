# mibo — 智能学习伴侣桌宠 (v2.9)

Tauri v1 + TypeScript + Rust，macOS 桌面应用。户山香澄（BanG Dream!）桌宠，悬浮桌面、能聊天、帮看代码、番茄钟提醒、摸鱼检测、学习鼓励、听歌陪伴。全程 Claude Code 协作开发。

## 安装

1. 从 [Releases](https://github.com/dokidoki-kasumi-chan/kasumi_pet/releases) 下载 `mibo_*.dmg`
2. 双击打开，拖入 `/Applications`
3. 首次打开：右键 → 打开（macOS 未签名应用提示）
4. 若提示「已损坏，无法打开」：终端执行 `xattr -cr /Applications/mibo.app`（macOS 对未签名应用的隔离标记，通过 QQ/网盘传输会自动附加）

## 基本交互

| 操作 | 触发状态 | 说明 |
|------|---------|------|
| 单击香澄 | SURPRISED | 吓一跳，随机台词 |
| 双击香澄 | POKED | 被戳反应 |
| 悬停 3.5 秒不动 | SHY | "不要一直盯着我看啦" |
| 1% 概率 | ANGRY | 彩蛋生气 |
| 双击桌面空白 | — | 关闭气泡，恢复待机 |
| 左上角齿轮 | — | 打开独立设置窗口 |

所有交互有 5 秒冷却防抖。回答锁期间、思考锁期间、输入模式下的交互均被拦截。

## AI 聊天

点击「聊天」按钮 → 输入消息回车发送 → 香澄进入 THINKING 状态思考 → AI 返回后先显示 CELEBRATE 庆祝动画 → 4 秒后切换到 HAPPY 状态展示 AI 回答 → 1 分钟后自动恢复 IDLE。

聊天流程的可靠性设计：
- 多 Provider 支持（智谱/OpenAI/DeepSeek/Anthropic/自定义），设置面板下拉切换
- 30s AbortController 超时，60s 安全看门狗兜底（同时清理 isThinkingLocked、responseLocked、bubblePermanent），超时后强制恢复 IDLE 并提示错误
- 超过 2000 字的输入直接拒绝，不消耗 API token
- 最近 50 条对话历史滚动保留，角色切换时清空
- System prompt 由 SOUL.md（人格层）+ character.json（配置层）+ RAG 台词例句（语气层）三合一构建
- API Key 存储在 `~/Library/Application Support/com.kasumipet.app/.env`，仅本地保存，代码中零硬编码

## 功能详情

### 剪贴板智能助手
每 3 秒检测剪贴板变化。使用纯算法分类（不浪费 token 调 AI 判断）：
- 代码：符号密度 > 0.25，或行末代码特征 > 0.4，或缩进比例 > 0.3 且含注释
- 报错：匹配 error/Exception/Traceback/panic/stack trace 等关键词
- 大段英文：英文字符占比 > 60%（分子分母均截断 500 防长文本失真）且含 3 个以上英文功能词

检测到目标内容后弹出「帮看看？」按钮，1 分钟后自动消失。点击后调 AI 分析，结果保持 1 分钟。

### 摸鱼检测（B站）
每 30 秒检测 B站是否打开。通过 CGWindowList 扫描窗口标题（桌面客户端）+ AppleScript 查浏览器标签页（Safari/Chrome）。首次检测 5 分钟后触发 SLY_SMILE 坏笑脸，再过 5 分钟升级警告，再过 2 分钟自动恢复。AppleScript 有 3s 超时 + 10min 熔断保护。

### 学习鼓励
通过 NSWorkspace API 检测运行中的编辑器（VS Code/Cursor/Codex/Trae/Xcode/Terminal），连续使用 3 分钟后弹出鼓励气泡。关闭编辑器后计数器自动重置。

### 听歌陪伴
通过 NSWorkspace 检测网易云音乐是否后台运行。IDLE 状态时随机弹出音乐相关泡泡，每 5 分钟有一定概率再次触发。

### 番茄钟
连续活跃 1 小时后自动弹出番茄钟提示按钮。25 分钟专注 + 5 分钟休息，气泡显示每 200ms 更新的倒计时。纯计时模式——不改变宠物状态，只更新气泡。番茄钟与 AI 回答锁互不干扰：锁期间倒计时照常更新，锁结束自动恢复。入睡时番茄钟自动停止。阶段切换有重入保护，回答锁已运行时仅驻留气泡不延长锁时间。

### 好感度系统
每次聊天成功 +1 好感度，按角色独立存储到 `affection.json`。亲密度（familiarity）分三段注入 system prompt，让 LLM 自行感知关系深度而非硬编码语气模板：
- 0-20：礼貌疏远（"你好，我是户山香澄..."）
- 20-50：温暖友好（"嗨！今天也一起加油吧！"）
- 50+：亲密熟悉（"你来啦~ 香澄一直在等你呢！"）

### 多角色切换
设置面板下拉切换角色。图片、台词、AI 人设、好感度全部跟随变化。角色数据完全外置：`characters/{id}/character.json` + 图片资源 + SOUL.md + profile.json。新增角色只需建新目录。

### 深夜睡眠系统（00:00-08:00）
入睡流程：先停止番茄钟 → 退出输入模式 → 隐藏所有按钮 → 设置 SLEEP 状态 → 显示静态 zzz 气泡。`canChangeState` 内置 SLEEP 独立守卫：SLEEP 状态下只允许切 IDLE（唤醒）或保持 SLEEP，定时器路径（饭点/休息提醒）无法打断睡眠。14 个交互拦截点全覆盖（点击/双击/悬停/发消息/进输入模式/活动检测/剪贴板/番茄钟提示/空闲打哈欠）。启动和角色切换时若在睡眠时段直接进入 SLEEP。回答锁到期时若仍在睡眠时段自动回 SLEEP。08:00 醒来时无条件恢复聊天按钮。空闲超过 2 小时判定为熄屏唤醒，重置计时。

### 定时提醒

| 触发条件 | 状态 | 说明 |
|----------|------|------|
| 连续工作 2 小时 | SLEEPY / YAWN | 随机选一个，提醒休息 |
| 12:00 | EATING | 午饭提醒 |
| 18:30 | EATING | 晚饭提醒 |
| 00:00-08:00 | SLEEP | 深夜睡眠，交互全锁 |
| 无操作 10 分钟 | YAWN | 打哈欠提醒 |

## 架构

```
TypeScript 前端 (Vite)
  main.ts — 13 状态 + 3 层锁 + 双缓冲切图
  ApiClient — 多 Provider + 30s 超时 + AbortController
  PetController — 50 条对话历史管理
         │ Tauri IPC
Rust 后端 (Tauri v1, 18 个命令)
  macOS: NSWorkspace / CGWindowList / AppleScript
  配置: .env 读写 / 好感度 JSON 持久化
  资源: character.json / SOUL.md / RAG 数据
```

详细架构设计、AI 集成方案、全栈闭环能力见 [TECHNICAL_README.md](./TECHNICAL_README.md)。

## 配置 API

1. 点击左上角齿轮打开设置面板
2. 选择供应商（下拉预设 URL + 常用模型列表）或自定义
3. 填入 API Key
4. 保存后即时生效，无需重启

设置面板支持 DeepSeek（v4-flash/v4-pro/reasoner）、OpenAI（gpt-4.1/gpt-4o/gpt-4o-mini/o3-mini）、Anthropic（fable-5/opus-4-8/sonnet-4-6/haiku-4-5）、智谱（glm-4-flash/glm-4-plus/glm-4/glm-4-air），也可手动输入模型名称。

## 开发

```bash
cd frontend
npm install
npm run tauri:dev      # 热重载开发模式
npm run tauri:build    # 构建 DMG + .app
```

角色图片未包含在源码中。开发前从 Releases DMG 提取 `mibo.app/Contents/Resources/characters/` 放到 `frontend/characters/`。

## 常见问题

**Q: 聊天无响应？** 检查 API Key 是否正确填入，以及账户余额。确认网络能访问所选供应商的 API 端点。

**Q: 更新后 API Key / 好感度丢失？** 不会。数据存在 `~/Library/Application Support/com.kasumipet.app/`，覆盖安装 `.app` 不影响此目录。

**Q: 「已损坏」无法打开？** 终端执行 `xattr -cr /Applications/mibo.app`。未签名应用经 QQ/网盘传输会被 macOS 附加 `com.apple.quarantine` 隔离标记。

**Q: B站检测不生效？** 系统设置 → 隐私与安全性 → 自动化 → 允许 mibo 控制 Safari/Chrome。

**Q: 学习鼓励/听歌检测不生效？** 这两个功能使用 NSWorkspace API，无需任何系统权限。确认 App 已安装到 `/Applications` 而非直接从 DMG 运行。
