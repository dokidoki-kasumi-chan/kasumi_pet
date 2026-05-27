# mibo — 智能学习伴侣桌宠 (v2.3)

户山香澄（BanG Dream!）桌宠，悬浮桌面、能聊天、帮看代码、番茄钟提醒、摸鱼检测、学习鼓励、听歌陪伴。

## 安装

1. 从 [Releases](../../releases) 下载 `mibo_*.dmg`
2. 双击打开，拖入 `/Applications`
3. 首次打开：右键 → 打开（macOS 未签名应用提示）

## 基本交互

| 操作 | 效果 |
|------|------|
| **单击** 香澄 | 吓一跳 (SURPRISED) |
| **双击** 香澄 | 戳一戳 (POKED) |
| **悬停 3.5 秒不动** | 害羞 (SHY)，说"不要一直盯着我看啦" |
| **1% 概率** | 彩蛋生气 (ANGRY) |
| **双击空白区域** | 关闭气泡，恢复待机 |
| **左上角齿轮** | 打开设置面板 |

## AI 聊天

1. 点击 **「聊天」** 按钮
2. 输入消息，回车发送
3. 香澄进入 THINKING 状态思考
4. 回复先显示庆祝动画，4 秒后显示 AI 回答
5. 回答保持 1 分钟后自动恢复待机

聊天会自动记忆最近约 50 条对话。输入模式下左上角齿轮仍可拖动窗口。

## 好感度系统 (v2.0)

与香澄互动越多，好感度越高，她的态度会逐渐变化：

| 指标 | 说明 | 变化 |
|------|------|------|
| **affection** | 好感值 | 每次聊天成功 +1 |
| **trust** | 信任值 | 随互动自然增长 |
| **familiarity** | 亲密度 | 每次聊天成功 +0.5 |
| **mood** | 心情值 | 每次聊天成功 +2 |
| **interactions** | 互动次数 | 记录总互动次数 |

**语气变化（基于亲密度）：**

| 亲密度 | 语气 | 示例 |
|--------|------|------|
| 0-20 | 礼貌疏远 | "你好，我是户山香澄..." |
| 20-50 | 温暖友好 | "嗨！今天也一起加油吧！" |
| 50+ | 亲密熟悉 | "你来啦~ 香澄一直在等你呢！" |

好感度数据按角色独立存储于 `~/Library/Application Support/com.kasumipet.app/affection.json`。

## 多角色切换 (v2.0)

1. 点击左上角齿轮打开设置
2. 在 **「桌宠角色」** 下拉框选择角色
3. 保存后自动切换 — 图片、台词、AI 人设全部跟随变化
4. 每个角色的好感度独立记录，互不影响

当前可用角色：户山香澄 (Poppin'Party)。更多 Bandori 角色即将推出。

## 剪贴板助手

复制以下内容时，香澄自动检测并出现 **「帮看看？」** 按钮：

- **代码** — 解释代码功能
- **报错** — 分析原因 + 修复建议
- **大段英文** — 翻译成中文

按钮出现 1 分钟后自动消失。点击后 AI 分析结果保持 1 分钟。

## 摸鱼检测 (v2.2)

打开 B站（bilibili）页面超过 5 分钟，香澄自动察觉：

1. **检测到 B站** → 切换坏笑脸 (SLY_SMILE)，台词「诶嘿嘿...你在摸鱼吧？被我发现啦~」
2. **再挂 5 分钟** → 升级警告「喂喂，该回来了吧！星星都等急了！」
3. **再 2 分钟** → 自动恢复待机，不再打扰

> 同时支持 Safari 和 Chrome。桌面端 B站客户端也支持（通过窗口标题检测）。

## 学习鼓励 (v2.3)

使用以下编辑器连续 3 分钟，香澄自动弹出鼓励气泡：

- VS Code / Cursor / Codex / Trae / Xcode / Terminal

台词例如：「哇~ 你已经在 Cursor 写了这么久代码，香澄好佩服你！Kira Kira~ ✨」

关闭编辑器后计数器自动重置。

## 听歌陪伴 (v2.3)

检测到网易云音乐在后台运行时，香澄的待机台词随机加入音乐相关泡泡：

- 「🎵 听歌放松呢~ Kira Kira~♪」
- 「Popipa 的歌最棒了对吧！」

无需 API Key，检测到即生效。

## 番茄钟

**被动触发：** 电脑连续活跃 1 小时后，香澄自动提示「要开始番茄钟吗？」并显示橙色按钮。

- 点击 **「番茄钟？」** → 25 分钟专注开始，气泡显示倒计时
- 专注中按钮变为 **「⏹ 停止」**，可随时取消
- 25 分钟后 → 🎉 自动进入 5 分钟休息
- 休息结束 → 气泡问「学了什么？跟香澄聊聊吧~」

## 定时提醒

| 触发条件 | 状态 | 台词 |
|----------|------|------|
| 连续工作 2 小时 | SLEEPY / YAWN | 休息一下吧？ |
| 12:00 | EATING | 午饭时间到！ |
| 18:30 | EATING | 晚饭时间到！ |
| 23:00 - 06:00 | SLEEP | 深夜自动睡眠 |
| 无操作 10 分钟 | YAWN | 还在吗？ |
| 无操作 30 分钟 | SLEEP | 进入睡眠 |

## 配置 API

不配置 API 也能当桌面摆件。配置后解锁聊天和剪贴板分析：

1. 点击左上角 **齿轮⚙️** 打开设置
2. 选择供应商（智谱 / OpenAI / DeepSeek / Anthropic / 自定义）
3. 填入 **API Key**
4. 点击 **保存**

API Key 存储在 `~/Library/Application Support/com.kasumipet.app/.env`，仅本地保存，不会上传。

## 状态一览

| 状态 | 触发 | 图片 |
|------|------|------|
| IDLE | 默认待机 | idle |
| SURPRISED | 单击 | 惊讶 |
| POKED | 双击 | 被戳 |
| SHY | 悬停静置 3.5s | 害羞 |
| ANGRY | 1% 彩蛋 | 生气 |
| THINKING | 发送消息 / 番茄钟专注 | 思考 |
| HAPPY | AI 回复成功 | 开心 |
| CELEBRATE | 番茄钟完成 | 庆祝 |
| SLEEPY | 工作 2 小时 | 困倦 |
| YAWN | 无操作 10 分钟 | 打哈欠 |
| EATING | 饭点提醒 | 吃饭 |
| SLY_SMILE | 检测到 B站 5 分钟 | 坏笑 |
| SLEEP | 深夜 / 无操作 30 分钟 | 睡眠 |

## 开发

```bash
cd frontend
npm install
npm run tauri:dev      # 开发模式
npm run tauri:build    # 构建到 src-tauri/target/release/bundle/
```

构建后安装：`cp -R src-tauri/target/release/bundle/macos/mibo.app /Applications/`

> 角色图片未包含在源码中，开发前请从 [Releases](../../releases) DMG 中提取 `mibo.app/Contents/Resources/characters/` 放到 `frontend/characters/`。

## 常见问题

**Q: 聊天无响应？**
检查设置中 API Key 是否正确填入，以及所选供应商的账户余额。

**Q: 更新后 API Key 丢失？**
不会。Key 存在 `~/Library/Application Support/com.kasumipet.app/.env`，更新 app 不覆盖此目录。

**Q: 更新后好感度丢失？**
不会。好感度存在 `~/Library/Application Support/com.kasumipet.app/affection.json`，更新 app 不覆盖。

**Q: 如何彻底卸载？**
删除 `/Applications/mibo.app` 和 `~/Library/Application Support/com.kasumipet.app/` 目录。

**Q: B站检测不生效？**
首次使用需授权 mibo 控制浏览器：系统设置 → 隐私与安全性 → 自动化 → 允许 mibo 控制 Safari/Chrome。

**Q: 学习鼓励 / 听歌检测不生效？**
这两个功能无需任何权限，直接生效。如仍无效请确认 app 已安装到 /Applications。
