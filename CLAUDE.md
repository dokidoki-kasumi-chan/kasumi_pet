# CLAUDE.md — mibo 桌宠项目协作指南

## 项目
Tauri v1 桌宠应用（户山香澄），macOS 专属。TypeScript 前端 + Rust 后端 + 2D PNG 立绘。

## 我的偏好
- **简洁**: 回复简短，不要多余解释。不主动加 emoji
- **直接行动**: 读完代码就改，不要长篇分析，不要让我确认每一步
- **编辑优先**: 改现有文件，不要新建文件，除非确实需要
- **不写注释**: 代码自解释，只在不明显的 WHY 处写一行短注释
- **不过度工程**: 三个相似行比一个过早抽象好
- **不加不存在的场景**: 不写"将来可能"的错误处理/fallback/validation
- **事后 commit**: 改完等我说 push/commit 再提交，不要主动提交

## 常用操作
```bash
# 构建
cd /Users/thomas/Desktop/桌宠/frontend && npm run tauri:build

# 部署
cp frontend/src-tauri/target/release/bundle/dmg/mibo_2.5.0_aarch64.dmg /Users/thomas/Desktop/桌宠/mibo_2.5_aarch64.dmg
cp -R frontend/src-tauri/target/release/bundle/macos/mibo.app /Applications/

# 查看配置 (不在仓库里)
cat ~/Library/Application\ Support/com.kasumipet.app/.env
```

## Git 习惯
- commit message 用中文描述
- 结尾加 `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- push 到 `origin master` (GitHub: dokidoki-kasumi-chan/kasumi_pet)
- 绝不 amend，不用 --no-verify，不 force push master

## 版本更新 checklist
改完代码后：更新 `tauri.conf.json` version → 更新 README.md → 更新 docs/使用说明.txt → 构建 → 部署 DMG + .app → commit & push

## 关键文件速查
| 文件 | 做什么 |
|------|--------|
| `frontend/src/main.ts` (~1383行) | 状态机核心：所有交互/定时器/番茄钟/回答锁 |
| `frontend/src/api/client.ts` | LLM API 客户端 (fetch + 30s 超时) |
| `frontend/src-tauri/src/main.rs` (~635行) | 18个Tauri命令 (NSWorkspace/macOS) |
| `frontend/src-tauri/tauri.conf.json` | 版本号、窗口配置、bundle设置 |

## 项目记忆
完整状态/架构/功能清单在 memory 文件 (自动加载)。
