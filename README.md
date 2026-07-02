# mibo — 智能学习伴侣桌宠 (v2.8)

户山香澄（BanG Dream!）桌宠，悬浮桌面、能聊天、帮看代码、番茄钟提醒、摸鱼检测、学习鼓励、听歌陪伴。

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
