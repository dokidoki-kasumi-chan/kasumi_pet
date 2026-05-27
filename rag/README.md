# RAG 数据集 — 户山香澄人设

## 数据文件

```
rag/data/
├── kasumi_profile.json   # 角色详细档案 (性格/人际关系/背景故事)
├── anime_quotes.jsonl    # 动画+游戏核心台词 (20条, 日/中/场景)
├── all.jsonl             # 汇总 (档案+台词, 供RAG检索用)
└── cards.jsonl           # [旧] 卡面数据, 爬虫运行时自动清理
```

## 数据来源

| 来源 | 内容 |
|------|------|
| Bestdori API | 角色名/乐队/颜色 (自动爬取验证) |
| 手动整理 | 性格特质、人际关系、背景故事 |
| 动画 S1-S3 | 关键台词 (按集数和场景标注) |
| 游戏 | 日常/练习/早安晚安等对话 |

## 使用

```bash
pip3 install requests
python3 crawler.py          # 收集数据 (不会覆盖手动整理的文件)
cat data/all.jsonl | head   # 查看汇总
```

## 数据格式

```json
// 动画台词
{"source":"anime_s1","episode":1,"context":"组建乐队",
 "ja":"私、バンドやりたい！","zh":"我想组乐队！","note":"第一季第一集"}

// 角色档案
{"source":"manual_curated","personality_traits":[...],"catchphrases":[...],"relationships":[...],...}
```
