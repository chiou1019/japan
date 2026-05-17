# db.py — 資料庫模組
import sqlite3
import hashlib
import os

DB_PATH = os.environ.get("DB_PATH", "n5.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # 提升並發效能
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def init_db():
    """首次啟動建立所有資料表"""
    conn = get_db()
    c = conn.cursor()

    # ── 使用者表 ──
    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT    UNIQUE NOT NULL,
        password   TEXT    NOT NULL,
        created_at TEXT    DEFAULT (datetime('now','localtime')),
        last_login TEXT
    )""")

    # ── 單字進度表 ──
    c.execute("""
    CREATE TABLE IF NOT EXISTS word_progress (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        word       TEXT    NOT NULL,
        status     TEXT    NOT NULL CHECK(status IN ('known','unknown')),
        updated_at TEXT    DEFAULT (datetime('now','localtime')),
        UNIQUE(user_id, word)
    )""")

    # ── 學習紀錄表（每次練習的統計） ──
    c.execute("""
    CREATE TABLE IF NOT EXISTS study_sessions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        known_count INTEGER DEFAULT 0,
        unknown_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        accuracy    REAL    DEFAULT 0,
        mode        TEXT    DEFAULT 'daily',
        created_at  TEXT    DEFAULT (datetime('now','localtime'))
    )""")

    conn.commit()
    conn.close()

# ── 使用者 CRUD ──

def create_user(username: str, password: str):
    """建立新使用者，成功回傳 user dict，失敗回傳 None"""
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO users (username, password) VALUES (?, ?)",
            (username, hash_pw(password))
        )
        conn.commit()
        return get_user_by_name(username)
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def verify_user(username: str, password: str):
    """驗證帳號密碼，成功回傳 user dict，失敗回傳 None"""
    conn = get_db()
    user = conn.execute(
        "SELECT * FROM users WHERE username=? AND password=?",
        (username, hash_pw(password))
    ).fetchone()

    if user:
        # 更新最後登入時間
        conn.execute(
            "UPDATE users SET last_login=datetime('now','localtime') WHERE id=?",
            (user['id'],)
        )
        conn.commit()

    conn.close()
    return dict(user) if user else None

def get_user_by_name(username: str):
    conn = get_db()
    row  = conn.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    conn.close()
    return dict(row) if row else None

def get_user_by_id(user_id: int):
    conn = get_db()
    row  = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

# ── 進度 CRUD ──

def get_progress(user_id: int) -> dict:
    """回傳 {word: status} 字典"""
    conn = get_db()
    rows = conn.execute(
        "SELECT word, status FROM word_progress WHERE user_id=?", (user_id,)
    ).fetchall()
    conn.close()
    return {r['word']: r['status'] for r in rows}

def save_word_progress(user_id: int, word: str, status: str):
    """INSERT OR REPLACE 單字進度"""
    conn = get_db()
    conn.execute("""
        INSERT INTO word_progress (user_id, word, status, updated_at)
        VALUES (?, ?, ?, datetime('now','localtime'))
        ON CONFLICT(user_id, word)
        DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
    """, (user_id, word, status))
    conn.commit()
    conn.close()

def batch_save_progress(user_id: int, records: list):
    """批次儲存 [{word, status}, ...]"""
    conn = get_db()
    for r in records:
        conn.execute("""
            INSERT INTO word_progress (user_id, word, status, updated_at)
            VALUES (?, ?, ?, datetime('now','localtime'))
            ON CONFLICT(user_id, word)
            DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
        """, (user_id, r['word'], r['status']))
    conn.commit()
    conn.close()

def get_stats(user_id: int, total_words: int) -> dict:
    """回傳學習統計"""
    conn = get_db()
    rows = conn.execute(
        "SELECT status, COUNT(*) as cnt FROM word_progress WHERE user_id=? GROUP BY status",
        (user_id,)
    ).fetchall()
    conn.close()

    counts  = {r['status']: r['cnt'] for r in rows}
    known   = counts.get('known', 0)
    unknown = counts.get('unknown', 0)
    return {
        "known":   known,
        "unknown": unknown,
        "new":     max(total_words - known - unknown, 0),
        "total":   total_words
    }

def get_known_words(user_id: int) -> list:
    conn = get_db()
    rows = conn.execute(
        "SELECT word FROM word_progress WHERE user_id=? AND status='known' ORDER BY updated_at DESC",
        (user_id,)
    ).fetchall()
    conn.close()
    return [r['word'] for r in rows]

def get_unknown_words(user_id: int) -> list:
    conn = get_db()
    rows = conn.execute(
        "SELECT word FROM word_progress WHERE user_id=? AND status='unknown' ORDER BY updated_at DESC",
        (user_id,)
    ).fetchall()
    conn.close()
    return [r['word'] for r in rows]

# ── 學習紀錄 ──

def save_session(user_id: int, known: int, unknown: int, mode: str = 'daily'):
    total    = known + unknown
    accuracy = round(known / total * 100, 1) if total > 0 else 0
    conn = get_db()
    conn.execute("""
        INSERT INTO study_sessions (user_id, known_count, unknown_count, total_count, accuracy, mode)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (user_id, known, unknown, total, accuracy, mode))
    conn.commit()
    conn.close()

def get_session_history(user_id: int, limit: int = 10) -> list:
    conn = get_db()
    rows = conn.execute("""
        SELECT known_count, unknown_count, total_count, accuracy, mode, created_at
        FROM study_sessions
        WHERE user_id=?
        ORDER BY created_at DESC
        LIMIT ?
    """, (user_id, limit)).fetchall()
    conn.close()
    return [dict(r) for r in rows]
