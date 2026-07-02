# mibo — 技术文档

面向面试官/技术评审。产品功能见 [README.md](./README.md)。

## 技术栈

| 层 | 技术 | 规模 |
|----|------|------|
| 前端 | TypeScript + Vite | ~1400 行状态机 |
| 后端 | Rust (Tauri v1) | ~640 行，18 个命令 |
| AI | 多 Provider HTTP 直连 | 智谱/OpenAI/DeepSeek/Anthropic |
| 桌面 | Tauri (macOS) | NSWorkspace / CGWindowList / AppleScript |
| 存储 | 本地 JSON 文件 | .env 配置 + affection 好感度 |

## 架构

```
┌─ TypeScript 前端 ─────────────────────────────────────┐
│  main.ts (状态机)    ApiClient (多 Provider)            │
│  13 状态 + 3 层锁    30s 超时 + AbortController         │
│  双缓冲切图          50 条对话历史                       │
│  剪贴板/活动检测器    Token 控制 (长消息拦截)             │
└──────────────┬────────────────────────────────────────┘
               │ Tauri IPC (invoke / listen)
┌──────────────┴────────────────────────────────────────┐
│  Rust 后端 (Tauri v1)                                  │
│  macOS: NSWorkspace / CGWindowList / AppleScript        │
│  配置: .env 读写 / 好感度 JSON 持久化                    │
│  角色: character.json 加载 / RAG 数据注入               │
└────────────────────────────────────────────────────────┘
```

## AI 协作开发流程（Claude Code Vibe Coding）

全程 Claude Code 驱动，典型迭代：

```
提出需求 → AI 分析状态机 + 锁影响 → 生成 diff → 审查 → 测试边界 → 发布
```

### 上下文管理策略
- **CLAUDE.md**：项目架构 + 协作规范，每次对话自动加载
- **Memory 文件**：版本演进、设计决策持久化，跨会话不丢上下文
- **SKILL.md**：固化构建/部署/发版流程，触发即执行
- **references/**：状态机文档，主文件只放骨架，细节按需读取

### 单文件状态机策略
`main.ts` (~1400 行) 集中管理所有状态和交互。Agent 改一个功能只需读一个文件，不需要跨文件跳转。代价是文件长，但 AI 处理长文件比处理分散逻辑更可靠。

## AI API 集成

### 多 Provider 适配
一套接口兼容 4 个供应商，用户设置面板下拉切换：

| Provider | 模型（下拉可选） | 端点 |
|----------|-----------------|------|
| DeepSeek | v4-flash / v4-pro / reasoner | api.deepseek.com |
| OpenAI | gpt-4.1 / gpt-4o / gpt-4o-mini | api.openai.com |
| Anthropic | fable-5 / opus-4-8 / sonnet-4-6 / haiku-4-5 | api.anthropic.com |
| 智谱 | glm-4-flash / glm-4-plus / glm-4 | open.bigmodel.cn |

### 可靠性设计
- **30s AbortController 超时**：防止 API 挂死
- **60s 安全看门狗**：超时后强制恢复 IDLE + 弹错误提示，绝对不死锁
- **多格式响应兼容**：`choices[0].message.content` / `delta.content` / 顶层 `content` 逐级 fallback
- **长消息拦截**：>2000 字直接拒绝，不发 API（控制 token 成本）

### 上下文管理
- 最近 50 条对话历史滚动
- System prompt = SOUL.md（人格层）+ character.json（配置层）+ RAG 台词例句（语气样本）
- 好感度参数动态注入 system prompt，让 LLM 自行感知关系深度而非硬编码语气模板

### Token 成本控制
- 用户用自己的 Key，费用用户侧可控
- 超长消息前置拦截，避免无效 API 调用
- 剪贴板内容分类用纯算法（符号密度/行末特征/功能词计数），不浪费 token 调 AI 判断

## 状态机设计

### 13 种状态 + 3 层锁

```
响应锁 (responseLocked)    ← AI 回答后 1min，最高优先级
思考锁 (isThinkingLocked)  ← LLM 调用期间
输入锁 (isInputting)       ← 用户输入期间
冷却层 (STATE_COOLDOWN)    ← 5s 防抖
```

白名单机制：系统自动状态（THINKING/CELEBRATE/HAPPY/SLEEP/IDLE）可穿透对应锁层，用户交互（单击/双击/悬停/剪贴板）被拦截。

### 睡眠系统（00:00-08:00）

14 个拦截点全覆盖：点击 pet、点击空白、双击空白、悬停、发消息、进输入模式、活动检测、剪贴板检测、番茄钟提示、空闲打哈欠、空闲唤醒检测（idle ≥ 2h = 熄屏唤醒）、休息提醒（天然避开 9-22）。

入睡时先停番茄钟、退输入模式、隐按钮，再设 SLEEP。锁到期若仍在睡眠时段自动回 SLEEP 而非 IDLE。醒来时无条件恢复按钮（不依赖 currentState）。

### 防御性设计
- **看门狗**：60s 后 API 无响应强制恢复，永不死锁
- **空闲唤醒检测**：idle ≥ 120min 判定为熄屏唤醒，重置计时而非触发 SLEEP
- **跨天窗口兼容**：`isSleepTime()` 同时处理同天窗口（0-8，用 `&&`）和跨天窗口（23-6，用 `||`）

## 全栈闭环能力

### macOS 原生集成
- **NSWorkspace**：检测运行中的应用（编辑器/网易云），无需系统权限
- **CGWindowList**：扫描窗口标题（B站桌面客户端检测）
- **AppleScript**：查浏览器 URL（B站检测 fallback），3s 超时 + 10min 熔断
- **18 个 Tauri 命令**：窗口管理 / 配置读写 / 角色切换 / 好感度 / 系统检测

### 部署与发布
- `npm run tauri:build` → DMG + .app
- GitHub Releases 分发，`gh` CLI 一键创建
- 版本号同步更新 tauri.conf.json / README / 使用说明

### 数据持久化
- `.env` 配置：`~/Library/Application Support/com.kasumipet.app/.env`
- 好感度：`affection.json`，按角色独立文件存储
- 旧版 localStorage 自动迁移

### 安全
- API Key 存储在仓库外（`~/Library/Application Support/`），永不提交
- `.gitignore` 屏蔽 images/ / docs/ / 角色图 / 杂项
- 开源仓库无密钥泄漏，git 全历史已扫描确认

## 版本演进

| 版本 | 内容 |
|------|------|
| v2.0 | 多角色切换 + 好感度系统 |
| v2.2 | B站摸鱼检测（CGWindowList + AppleScript） |
| v2.3 | 学习鼓励 + 听歌陪伴（NSWorkspace） |
| v2.4 | 剪贴板结构检测重构（算法分类替代关键词） |
| v2.5 | AI 回答锁系统 + 番茄钟纯计时 + CELEBRATE 冷却修复 |
| v2.6 | 长消息拦截 + 60s 安全看门狗 |
| v2.7 | 开源发布 + 设置面板模型下拉 + macOS 已损坏修复指引 |
| v2.8 | 睡眠系统全面加固（14 拦截点 + 启动直入 + 锁不挡 + 按钮恢复） |
