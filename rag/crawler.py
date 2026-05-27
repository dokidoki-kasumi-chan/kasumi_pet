#!/usr/bin/env python3
"""
户山香澄 (Kasumi Toyama) 人设数据收集 + 整理
数据来源: bestdori.com API + 手动整理 (动画台词/角色档案)
输出: JSONL 格式
"""

import requests
import json
import time
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
BESTDORI_API = "https://bestdori.com/api"
HEADERS = {"User-Agent": "KasumiPet-DataCollector/1.0"}
CHARACTER_ID = 1

def rate_limit():
    time.sleep(1.0)

def fetch(url: str):
    print(f"  GET {url[:80]}...", end=" ", flush=True)
    try:
        r = requests.get(url, headers=HEADERS, timeout=30)
        r.raise_for_status()
        print(f"200 ({len(r.content)} bytes)")
        return r.json()
    except Exception as e:
        print(f"FAIL: {e}")
        return None

# ============ 1. 角色档案 (Bestdori验证版) ============
def fetch_character():
    print("\n🎸 爬取角色档案...")
    data = fetch(f"{BESTDORI_API}/characters/all.5.json")
    if not data:
        return None

    char = data.get(str(CHARACTER_ID))
    if not char:
        print("  ⚠️ 未找到香澄")
        return None

    return {
        "source": "bestdori_character",
        "ja": char["characterName"][0] if char.get("characterName") else "",
        "en": char["characterName"][1] if len(char.get("characterName", [])) > 1 else "",
        "zh": char["characterName"][3] if len(char.get("characterName", [])) > 3 else "",
        "firstName_ja": char["firstName"][0] if char.get("firstName") else "",
        "firstName_zh": char["firstName"][3] if len(char.get("firstName", [])) > 3 else "",
        "lastName_ja": char["lastName"][0] if char.get("lastName") else "",
        "bandId": char.get("bandId"),
        "colorCode": char.get("colorCode"),
    }

# ============ 导出 ============
def save_jsonl(data: list, name: str):
    path = DATA_DIR / name
    path.write_text("\n".join(json.dumps(d, ensure_ascii=False) for d in data) + "\n", encoding="utf-8")

def load_jsonl(name: str) -> list:
    path = DATA_DIR / name
    if path.exists():
        return [json.loads(l) for l in path.read_text(encoding="utf-8").strip().split("\n") if l.strip()]
    return []

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print("🎸 收集户山香澄人设数据\n")

    all_data = []

    # 1. Bestdori 角色档案
    char = fetch_character()
    if char:
        all_data.append(char)
        print(f"  ✅ 角色档案导入")

    # 2. 手动整理的数据文件
    manual_files = ["kasumi_profile.json", "anime_quotes.jsonl"]
    for fname in manual_files:
        path = DATA_DIR / fname
        if not path.exists():
            print(f"  ⚠️ 跳过 {fname}（文件不存在，需手动创建）")
            continue
        if fname.endswith(".jsonl"):
            items = load_jsonl(fname)
        else:
            data = json.loads(path.read_text(encoding="utf-8"))
            items = [data]
        all_data.extend(items)
        print(f"  📄 {fname} → {len(items)} 条")

    # 3. 汇总
    save_jsonl(all_data, "all.jsonl")

    profile_count = sum(1 for d in all_data if d.get("source") == "manual_curated")
    quote_count = sum(1 for d in all_data if d.get("source") in ("anime_s1", "anime_s2", "anime_s3", "game_main"))

    print(f"\n🎉 总计 {len(all_data)} 条")
    print(f"   角色档案: {profile_count}")
    print(f"   动画/游戏台词: {quote_count}")
    print(f"   Bestdori验证: {1 if char else 0}")
    print(f"📁 {DATA_DIR.resolve()}")

    # 4. 清理旧卡片数据（如存在且无用的）
    old_cards = DATA_DIR / "cards.jsonl"
    if old_cards.exists():
        old_cards.unlink()
        print(f"  🧹 已清理旧卡面数据")

if __name__ == "__main__":
    main()
