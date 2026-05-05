from flask import Flask, jsonify, render_template, request, session
import json, random, os, hashlib
import sqlite3
from dotenv import load_dotenv
import requests

load_dotenv()

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.getenv('SECRET_KEY', 'n5-study-secret-2024')

# ── 讀單字 ──
with open("n5.json", "r", encoding="utf-8") as f:
    words = json.load(f)

# ── DB 初始化 ──
def init_db():
    conn = sqlite3.connect("study.db")
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT    UNIQUE NOT NULL,
        password TEXT    NOT NULL,
        created  TEXT    DEFAULT (datetime('now'))
    )""")
    c.execute("""
    CREATE TABLE IF NOT EXISTS word_progress (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL,
        word       TEXT    NOT NULL,
        status     TEXT    NOT NULL DEFAULT 'new',
        updated    TEXT    DEFAULT (datetime('now')),
        FOREIGN KEY(user_id) REFERENCES users(id),
        UNIQUE(user_id, word)
    )""")
    conn.commit()
    conn.close()

init_db()

def get_db():
    conn = sqlite3.connect("study.db")
    conn.row_factory = sqlite3.Row
    return conn

def hash_pw(pw):
    return hashlib.sha256(pw.encode()).hexdigest()

def current_user():
    return session.get('user_id'), session.get('username')

# ── 頁面路由 ──
@app.route("/")
def home():
    return render_template("index.html")

@app.route("/translate")
def translate_page():
    return render_template("translate.html")

# ── 登入 / 註冊 ──
@app.route("/api/register", methods=["POST"])
def register():
    data = request.json
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    if not username or not password:
        return jsonify({"ok": False, "error": "帳號和密碼不能為空"}), 400
    if len(username) < 2:
        return jsonify({"ok": False, "error": "帳號至少 2 個字"}), 400
    if len(password) < 4:
        return jsonify({"ok": False, "error": "密碼至少 4 個字"}), 400
    db = get_db()
    try:
        db.execute("INSERT INTO users (username, password) VALUES (?, ?)",
                   (username, hash_pw(password)))
        db.commit()
        user = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        session['user_id']  = user['id']
        session['username'] = username
        return jsonify({"ok": True, "username": username})
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "error": "帳號已存在"}), 400
    finally:
        db.close()

@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    db = get_db()
    user = db.execute(
        "SELECT id, username FROM users WHERE username=? AND password=?",
        (username, hash_pw(password))
    ).fetchone()
    db.close()
    if not user:
        return jsonify({"ok": False, "error": "帳號或密碼錯誤"}), 401
    session['user_id']  = user['id']
    session['username'] = user['username']
    return jsonify({"ok": True, "username": user['username']})

@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})

@app.route("/api/me")
def me():
    uid, uname = current_user()
    if not uid:
        return jsonify({"loggedIn": False})
    return jsonify({"loggedIn": True, "username": uname})

# ── 單字 API ──
@app.route("/daily/<int:count>")
def daily(count):
    uid, _ = current_user()
    count = min(count, len(words))
    if not uid:
        return jsonify(random.sample(words, count))
    db = get_db()
    done = set(row['word'] for row in db.execute(
        "SELECT word FROM word_progress WHERE user_id=? AND status='known'", (uid,)
    ).fetchall())
    db.close()
    available = [w for w in words if w['word'] not in done]
    if len(available) < count:
        available = words
    return jsonify(random.sample(available, min(count, len(available))))

@app.route("/api/unknown-words")
def unknown_words():
    uid, _ = current_user()
    if not uid:
        return jsonify([])
    db = get_db()
    unknown_list = [row['word'] for row in db.execute(
        "SELECT word FROM word_progress WHERE user_id=? AND status='unknown'", (uid,)
    ).fetchall()]
    db.close()
    result = [w for w in words if w['word'] in unknown_list]
    random.shuffle(result)
    return jsonify(result)

@app.route("/api/known-words")
def known_words():
    uid, _ = current_user()
    if not uid:
        return jsonify([])
    db = get_db()
    known_list = [row['word'] for row in db.execute(
        "SELECT word FROM word_progress WHERE user_id=? AND status='known' ORDER BY updated DESC", (uid,)
    ).fetchall()]
    db.close()
    result = [w for w in words if w['word'] in known_list]
    return jsonify(result)

@app.route("/api/stats")
def stats():
    uid, _ = current_user()
    if not uid:
        return jsonify({"known": 0, "unknown": 0, "new": len(words), "total": len(words)})
    db = get_db()
    rows = db.execute(
        "SELECT status, COUNT(*) as cnt FROM word_progress WHERE user_id=? GROUP BY status",
        (uid,)
    ).fetchall()
    db.close()
    counts = {r['status']: r['cnt'] for r in rows}
    known   = counts.get('known', 0)
    unknown = counts.get('unknown', 0)
    new_cnt = len(words) - known - unknown
    return jsonify({"known": known, "unknown": unknown, "new": new_cnt, "total": len(words)})

@app.route("/api/save-progress", methods=["POST"])
def save_progress():
    uid, _ = current_user()
    if not uid:
        return jsonify({"ok": False, "error": "未登入"}), 401
    data   = request.json
    word   = data.get("word")
    status = data.get("status")
    if not word or status not in ('known', 'unknown'):
        return jsonify({"ok": False, "error": "參數錯誤"}), 400
    db = get_db()
    db.execute("""
        INSERT INTO word_progress (user_id, word, status, updated)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, word) DO UPDATE SET status=excluded.status, updated=excluded.updated
    """, (uid, word, status))
    db.commit()
    db.close()
    return jsonify({"ok": True})

# ── Gemini Proxy ──
@app.route("/api/translate", methods=["POST"])
def api_translate():
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return jsonify({"error": "未設定 GEMINI_API_KEY"}), 500
        body   = request.json
        prompt = body["messages"][0]["content"]
        resp = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}",
            headers={"Content-Type": "application/json"},
            json={"contents": [{"parts": [{"text": prompt}]}]},
            timeout=60
        )
        data = resp.json()
        if resp.status_code != 200:
            return jsonify({"error": data}), resp.status_code
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        return jsonify({"content": [{"type": "text", "text": text}]})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── Render 部署：綁定 0.0.0.0 + 讀取 PORT 環境變數 ──
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)