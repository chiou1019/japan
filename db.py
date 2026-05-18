# db.py — 支援 PostgreSQL（Render）和 SQLite（本地開發）自動切換
import os
import hashlib

DATABASE_URL = os.environ.get("DATABASE_URL", "")
USE_POSTGRES  = DATABASE_URL.startswith("postgres")

# ── 根據環境選擇驅動 ──
if USE_POSTGRES:
    import psycopg2
    import psycopg2.extras

    def get_db():
        url = DATABASE_URL.replace("postgres://", "postgresql://", 1)
        conn = psycopg2.connect(url, sslmode="require",
                                cursor_factory=psycopg2.extras.RealDictCursor)
        conn.autocommit = False
        return conn

    PH = "%s"   # PostgreSQL 佔位符

else:
    import sqlite3

    DB_PATH = os.environ.get("DB_PATH", "n5.db")

    def get_db():
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    PH = "?"    # SQLite 佔位符


def _row(r):
    """統一把 Row 轉成普通 dict"""
    return dict(r) if r else None


def hash_pw(pw: str) -> str:
    return hashlib.sha256(pw.encode("utf-8")).hexdigest()


# ════════════════════════════════════════
# 初始化資料表
# ════════════════════════════════════════

def init_db():
    conn = get_db()
    c    = conn.cursor()

    if USE_POSTGRES:
        c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id         SERIAL PRIMARY KEY,
            username   TEXT   UNIQUE NOT NULL,
            password   TEXT   NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            last_login TIMESTAMP
        )""")
        c.execute("""
        CREATE TABLE IF NOT EXISTS word_progress (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            word       TEXT    NOT NULL,
            status     TEXT    NOT NULL CHECK(status IN ('known','unknown')),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, word)
        )""")
        c.execute("""
        CREATE TABLE IF NOT EXISTS study_sessions (
            id            SERIAL PRIMARY KEY,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            known_count   INTEGER DEFAULT 0,
            unknown_count INTEGER DEFAULT 0,
            total_count   INTEGER DEFAULT 0,
            accuracy      REAL    DEFAULT 0,
            mode          TEXT    DEFAULT 'daily',
            created_at    TIMESTAMP DEFAULT NOW()
        )""")
    else:
        c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            username   TEXT    UNIQUE NOT NULL,
            password   TEXT    NOT NULL,
            created_at TEXT    DEFAULT (datetime('now','localtime')),
            last_login TEXT
        )""")
        c.execute("""
        CREATE TABLE IF NOT EXISTS word_progress (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            word       TEXT    NOT NULL,
            status     TEXT    NOT NULL CHECK(status IN ('known','unknown')),
            updated_at TEXT    DEFAULT (datetime('now','localtime')),
            UNIQUE(user_id, word)
        )""")
        c.execute("""
        CREATE TABLE IF NOT EXISTS study_sessions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            known_count   INTEGER DEFAULT 0,
            unknown_count INTEGER DEFAULT 0,
            total_count   INTEGER DEFAULT 0,
            accuracy      REAL    DEFAULT 0,
            mode          TEXT    DEFAULT 'daily',
            created_at    TEXT    DEFAULT (datetime('now','localtime'))
        )""")

    conn.commit()
    c.close()
    conn.close()


# ════════════════════════════════════════
# 使用者 CRUD
# ════════════════════════════════════════

def create_user(username: str, password: str):
    conn = get_db()
    c    = conn.cursor()
    try:
        if USE_POSTGRES:
            c.execute(
                "INSERT INTO users (username, password) VALUES (%s, %s) RETURNING id",
                (username, hash_pw(password))
            )
            uid = c.fetchone()["id"]
        else:
            c.execute(
                "INSERT INTO users (username, password) VALUES (?, ?)",
                (username, hash_pw(password))
            )
            uid = c.lastrowid
        conn.commit()
        return get_user_by_id(uid)
    except Exception:
        conn.rollback()
        return None
    finally:
        c.close(); conn.close()


def verify_user(username: str, password: str):
    conn = get_db()
    c    = conn.cursor()
    c.execute(
        f"SELECT * FROM users WHERE username={PH} AND password={PH}",
        (username, hash_pw(password))
    )
    user = _row(c.fetchone())
    if user:
        if USE_POSTGRES:
            c.execute("UPDATE users SET last_login=NOW() WHERE id=%s", (user["id"],))
        else:
            c.execute("UPDATE users SET last_login=datetime('now','localtime') WHERE id=?", (user["id"],))
        conn.commit()
    c.close(); conn.close()
    return user


def get_user_by_id(user_id: int):
    conn = get_db()
    c    = conn.cursor()
    c.execute(f"SELECT * FROM users WHERE id={PH}", (user_id,))
    row = _row(c.fetchone())
    c.close(); conn.close()
    return row


def get_user_by_name(username: str):
    conn = get_db()
    c    = conn.cursor()
    c.execute(f"SELECT * FROM users WHERE username={PH}", (username,))
    row = _row(c.fetchone())
    c.close(); conn.close()
    return row


# ════════════════════════════════════════
# 進度 CRUD
# ════════════════════════════════════════

def get_progress(user_id: int) -> dict:
    conn = get_db()
    c    = conn.cursor()
    c.execute(f"SELECT word, status FROM word_progress WHERE user_id={PH}", (user_id,))
    result = {r["word"]: r["status"] for r in c.fetchall()}
    c.close(); conn.close()
    return result


def save_word_progress(user_id: int, word: str, status: str):
    conn = get_db()
    c    = conn.cursor()
    if USE_POSTGRES:
        c.execute("""
            INSERT INTO word_progress (user_id, word, status, updated_at)
            VALUES (%s, %s, %s, NOW())
            ON CONFLICT (user_id, word)
            DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()
        """, (user_id, word, status))
    else:
        c.execute("""
            INSERT INTO word_progress (user_id, word, status, updated_at)
            VALUES (?, ?, ?, datetime('now','localtime'))
            ON CONFLICT(user_id, word)
            DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
        """, (user_id, word, status))
    conn.commit()
    c.close(); conn.close()


def batch_save_progress(user_id: int, records: list):
    """批次儲存，整個 batch 用同一個 transaction"""
    if not records:
        return
    conn = get_db()
    c    = conn.cursor()
    try:
        for r in records:
            if USE_POSTGRES:
                c.execute("""
                    INSERT INTO word_progress (user_id, word, status, updated_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (user_id, word)
                    DO UPDATE SET status=EXCLUDED.status, updated_at=NOW()
                """, (user_id, r["word"], r["status"]))
            else:
                c.execute("""
                    INSERT INTO word_progress (user_id, word, status, updated_at)
                    VALUES (?, ?, ?, datetime('now','localtime'))
                    ON CONFLICT(user_id, word)
                    DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
                """, (user_id, r["word"], r["status"]))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        c.close(); conn.close()


def get_stats(user_id: int, total_words: int) -> dict:
    conn = get_db()
    c    = conn.cursor()
    c.execute(
        f"SELECT status, COUNT(*) as cnt FROM word_progress WHERE user_id={PH} GROUP BY status",
        (user_id,)
    )
    counts  = {r["status"]: r["cnt"] for r in c.fetchall()}
    c.close(); conn.close()
    known   = counts.get("known",   0)
    unknown = counts.get("unknown", 0)
    return {
        "known":   known,
        "unknown": unknown,
        "new":     max(total_words - known - unknown, 0),
        "total":   total_words,
    }


def get_known_words(user_id: int) -> list:
    conn = get_db()
    c    = conn.cursor()
    c.execute(
        f"SELECT word FROM word_progress WHERE user_id={PH} AND status='known' ORDER BY updated_at DESC",
        (user_id,)
    )
    result = [r["word"] for r in c.fetchall()]
    c.close(); conn.close()
    return result


def get_unknown_words(user_id: int) -> list:
    conn = get_db()
    c    = conn.cursor()
    c.execute(
        f"SELECT word FROM word_progress WHERE user_id={PH} AND status='unknown' ORDER BY updated_at DESC",
        (user_id,)
    )
    result = [r["word"] for r in c.fetchall()]
    c.close(); conn.close()
    return result


# ════════════════════════════════════════
# 學習紀錄
# ════════════════════════════════════════

def save_session(user_id: int, known: int, unknown: int, mode: str = "daily"):
    total    = known + unknown
    accuracy = round(known / total * 100, 1) if total > 0 else 0
    conn = get_db()
    c    = conn.cursor()
    if USE_POSTGRES:
        c.execute("""
            INSERT INTO study_sessions
                (user_id, known_count, unknown_count, total_count, accuracy, mode)
            VALUES (%s,%s,%s,%s,%s,%s)
        """, (user_id, known, unknown, total, accuracy, mode))
    else:
        c.execute("""
            INSERT INTO study_sessions
                (user_id, known_count, unknown_count, total_count, accuracy, mode)
            VALUES (?,?,?,?,?,?)
        """, (user_id, known, unknown, total, accuracy, mode))
    conn.commit()
    c.close(); conn.close()


def get_session_history(user_id: int, limit: int = 10) -> list:
    conn = get_db()
    c    = conn.cursor()
    # LIMIT 不能用參數佔位符，用 f-string 直接插入整數（已驗證 limit 為 int，安全）
    c.execute(f"""
        SELECT known_count, unknown_count, total_count, accuracy, mode, created_at
        FROM study_sessions
        WHERE user_id={PH}
        ORDER BY created_at DESC
        LIMIT {int(limit)}
    """, (user_id,))
    result = [dict(r) for r in c.fetchall()]
    c.close(); conn.close()
    return result
