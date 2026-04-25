import csv
import openai
import time

# 👉 填你的 API Key
client = openai.OpenAI(api_key="YOUR_API_KEY")

def translate_word(word, reading):
    prompt = f"""
請把以下日文單字翻譯成繁體中文：

日文漢字：{word}
平假名：{reading}

請只輸出中文意思，不要解釋。
"""

    res = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}]
    )

    return res.choices[0].message.content.strip()

input_file = "N5.csv"
output_file = "N5_translated.csv"

new_rows = []

with open(input_file, encoding="utf-8") as f:
    reader = csv.DictReader(f)

    for i, row in enumerate(reader):
        kanji = row["Kanji"]
        reading = row["Reading"]

        print(f"翻譯中: {kanji}")

        try:
            meaning = translate_word(kanji, reading)
        except Exception as e:
            meaning = "翻譯失敗"

        new_rows.append({
            "kanji": kanji,
            "reading": reading,
            "meaning": meaning
        })

        time.sleep(0.5)  # 避免 API 過快

# 寫入 CSV
with open(output_file, "w", encoding="utf-8", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=["kanji", "reading", "meaning"])
    writer.writeheader()
    writer.writerows(new_rows)

print("完成！已輸出 N5_translated.csv")