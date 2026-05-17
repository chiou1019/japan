from flask import Flask, jsonify, render_template, request, session, send_file
import json, random, os
from dotenv import load_dotenv
import db

load_dotenv()
db.init_db()

app = Flask(__name__, static_folder='static', template_folder='templates')
app.secret_key = os.getenv('SECRET_KEY', 'n5-study-2024-change-me')

# ── 讀單字 ──
with open("n5.json", "r", encoding="utf-8") as f:
    WORDS = json.load(f)
WORD_MAP = {w['word']: w for w in WORDS}

def current_user():
    uid = session.get('user_id')
    if not uid: return None
    return db.get_user_by_id(uid)

# ════════════════════════════════════════
# 頁面
# ════════════════════════════════════════

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/service-worker.js")
def sw():
    return app.send_static_file('service-worker.js'), 200, {
        'Content-Type': 'application/javascript',
        'Service-Worker-Allowed': '/'
    }

# ════════════════════════════════════════
# 帳號 API
# ════════════════════════════════════════

@app.route("/api/register", methods=["POST"])
def register():
    data     = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    if len(username) < 2: return jsonify({"ok": False, "error": "帳號至少 2 個字"}), 400
    if len(password) < 4: return jsonify({"ok": False, "error": "密碼至少 4 個字"}), 400

    user = db.create_user(username, password)
    if not user: return jsonify({"ok": False, "error": "帳號已存在"}), 409

    session['user_id']  = user['id']
    session['username'] = user['username']
    return jsonify({"ok": True, "username": user['username']})

@app.route("/api/login", methods=["POST"])
def login():
    data     = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    user = db.verify_user(username, password)
    if not user: return jsonify({"ok": False, "error": "帳號或密碼錯誤"}), 401

    session['user_id']  = user['id']
    session['username'] = user['username']
    return jsonify({"ok": True, "username": user['username']})

@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})

@app.route("/api/me")
def me():
    user = current_user()
    if not user: return jsonify({"loggedIn": False})
    return jsonify({"loggedIn": True, "username": user['username']})

# ════════════════════════════════════════
# 單字 API
# ════════════════════════════════════════

@app.route("/all-words")
def all_words():
    return jsonify(WORDS)

@app.route("/daily/<int:count>")
def daily(count):
    count = min(count, len(WORDS))
    user  = current_user()

    if not user:
        return jsonify(random.sample(WORDS, count))

    # 排除已記住的，優先抽新單字
    progress  = db.get_progress(user['id'])
    done      = {w for w, s in progress.items() if s == 'known'}
    available = [w for w in WORDS if w['word'] not in done]
    if len(available) < count:
        available = WORDS

    return jsonify(random.sample(available, min(count, len(available))))

@app.route("/api/unknown-words")
def unknown_words():
    user = current_user()
    if not user: return jsonify([])
    uw     = set(db.get_unknown_words(user['id']))
    result = [w for w in WORDS if w['word'] in uw]
    random.shuffle(result)
    return jsonify(result)

@app.route("/api/known-words")
def known_words():
    user = current_user()
    if not user: return jsonify([])
    kw     = set(db.get_known_words(user['id']))
    result = [w for w in WORDS if w['word'] in kw]
    return jsonify(result)

@app.route("/api/stats")
def stats():
    user = current_user()
    if not user:
        return jsonify({"known": 0, "unknown": 0, "new": len(WORDS), "total": len(WORDS)})
    return jsonify(db.get_stats(user['id'], len(WORDS)))

@app.route("/api/save-progress", methods=["POST"])
def save_progress():
    user = current_user()
    if not user: return jsonify({"ok": False, "error": "未登入"}), 401

    data   = request.json or {}
    word   = data.get("word", "").strip()
    status = data.get("status", "")

    if not word or status not in ('known', 'unknown'):
        return jsonify({"ok": False, "error": "參數錯誤"}), 400

    db.save_word_progress(user['id'], word, status)
    return jsonify({"ok": True})

@app.route("/api/save-progress/batch", methods=["POST"])
def save_progress_batch():
    """批次儲存一整輪練習結果"""
    user = current_user()
    if not user: return jsonify({"ok": False, "error": "未登入"}), 401

    data    = request.json or {}
    records = data.get("records", [])  # [{word, status}, ...]
    mode    = data.get("mode", "daily")
    known   = data.get("known", 0)
    unknown = data.get("unknown", 0)

    if records:
        db.batch_save_progress(user['id'], records)
    if known + unknown > 0:
        db.save_session(user['id'], known, unknown, mode)

    return jsonify({"ok": True})

@app.route("/api/history")
def history():
    user = current_user()
    if not user: return jsonify([])
    return jsonify(db.get_session_history(user['id']))

# ════════════════════════════════════════
# 啟動
# ════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port, debug=False)
