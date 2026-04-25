from flask import Flask, jsonify, render_template, request
import json, random, os
import sqlite3
import requests
from dotenv import load_dotenv

load_dotenv()  # 讀取 .env 裡的 ANTHROPIC_API_KEY

# 1️⃣ 建立 app
app = Flask(__name__, static_folder='static', template_folder='templates')

# 2️⃣ DB 初始化
def init_db():
    conn = sqlite3.connect("study.db")
    cursor = conn.cursor()
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        word TEXT,
        status TEXT
    )
    """)
    conn.commit()
    conn.close()

init_db()

# 3️⃣ 路由

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/translate")
def translate_page():
    return render_template("translate.html")


@app.route("/daily/<int:count>")
def daily(count):
    count = min(count, len(words))
    return jsonify(random.sample(words, count))


@app.route("/save", methods=["POST"])
def save():
    data = request.json
    word = data["word"]
    status = data["status"]

    conn = sqlite3.connect("study.db")
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO progress (word, status) VALUES (?, ?)",
        (word, status)
    )
    conn.commit()
    conn.close()

    return {"ok": True}


# ✅ Gemini API Proxy
@app.route("/api/translate", methods=["POST"])
def api_translate():
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return jsonify({"error": "未設定 GEMINI_API_KEY，請確認 .env 檔案"}), 500

        body = request.json
        prompt = body["messages"][0]["content"]

        # Gemini API 格式
        gemini_body = {
            "contents": [
                {"parts": [{"text": prompt}]}
            ]
        }

        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json=gemini_body,
            timeout=60
        )

        data = resp.json()

        if resp.status_code != 200:
            return jsonify({"error": data}), resp.status_code

        # 轉換成前端期待的格式（跟 Anthropic 一樣）
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return jsonify({
            "content": [{"type": "text", "text": text}]
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# 4️⃣ 讀單字
with open("n5.json", "r", encoding="utf-8") as f:
    words = json.load(f)

# 5️⃣ 啟動
if __name__ == "__main__":
    app.run(debug=True)