import csv
import json
import time
import requests

# ==============================
# 🔑 把你的 Gemini API Key 貼在這裡
GEMINI_API_KEY = "AIzaSyCUgPeu89QbMZ2Fr0cpZ3jcjMi4CyuMUSk"
# ==============================

INPUT_FILE = r"C:\japan\japan\locat_translate\n5.csv"
OUTPUT_FILE = r"C:\japan\japan\locat_translate\n5.json"
BATCH_SIZE = 10       # 每次送幾個單字給 AI
DELAY = 1.0           # 每批次間隔幾秒（避免太快）


def translate_batch(batch):
    """送一批單字給 Gemini，回傳翻譯結果"""
    word_list = "\n".join(
        f"{i+1}. {r['kanji']}（{r['reading']}）"
        for i, r in enumerate(batch)
    )

    prompt = f"""請將以下日文N5單字翻譯成繁體中文。
只輸出 JSON 陣列，不要其他說明或 markdown：

[
  {{"kanji": "漢字", "reading": "假名", "meaning": "中文意思"}}
]

單字：
{word_list}

規則：
- meaning 給最常用的 1~3 個中文意思，用「、」分隔
- 回傳筆數必須與輸入相同（{len(batch)} 筆）"""

    resp = requests.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}",
        headers={"Content-Type": "application/json"},
        json={"contents": [{"parts": [{"text": prompt}]}]},
        timeout=60
    )

    data = resp.json()

    if resp.status_code != 200:
        raise Exception(f"API 錯誤：{data}")

    text = data["candidates"][0]["content"]["parts"][0]["text"].strip()

    # 移除可能的 markdown ```json ... ```
    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]

    return json.loads(text)


def main():
    # 1. 讀 CSV
    print(f"📂 讀取 {INPUT_FILE}...")
    rows = []
    with open(INPUT_FILE, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({
                "kanji": row["Kanji"].strip(),
                "reading": row["Reading"].strip()
            })
    print(f"✅ 共 {len(rows)} 個單字")

    # 2. 批次翻譯
    results = []
    total = len(rows)

    for i in range(0, total, BATCH_SIZE):
        batch = rows[i:i+BATCH_SIZE]
        print(f"🔄 翻譯 {i+1}～{min(i+BATCH_SIZE, total)} / {total}：{' '.join(r['kanji'] for r in batch)}")

        try:
            translated = translate_batch(batch)
            for item in translated:
                results.append({
                    "word": item["kanji"],
                    "hiragana": item["reading"],
                    "meaning": item["meaning"]
                })
            print(f"   ✓ 完成")
        except Exception as e:
            print(f"   ✗ 失敗：{e}，用空白代替")
            for r in batch:
                results.append({
                    "word": r["kanji"],
                    "hiragana": r["reading"],
                    "meaning": "翻譯失敗"
                })

        if i + BATCH_SIZE < total:
            time.sleep(DELAY)

    # 3. 輸出 JSON
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\n🎉 完成！已輸出 {OUTPUT_FILE}（共 {len(results)} 筆）")


if __name__ == "__main__":
    main()