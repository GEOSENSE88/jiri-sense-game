# -*- coding: utf-8 -*-
# 지리SENSE GAME — 공유 명예의 전당 + 학생 기록 API (Flask + SQLite)
# 엔드포인트:
#   GET  /api/health                -> {ok:true}
#   GET  /api/leaderboard[?mode=ox] -> {mode:[{name,score,date}, ... top10], ...}
#   POST /api/score {mode,name,score} -> {ok:true, rank:N}
#   POST /api/student/login {class,nickname,pin} -> {ok,token,xp,data,isNew}
#   POST /api/student/sync  {token,xp,data}      -> {ok,xp}
#   GET  /api/class/roster?class=3-7&pw=...      -> {students:[{nickname,xp,updated}]}  (교사용)
import os, re, json, hashlib, secrets, sqlite3
from flask import Flask, request, jsonify

# 교사 대시보드 비밀번호 (배포 시 환경변수 GEO_TEACHER_PW로 덮어쓰기 권장)
TEACHER_PW = os.environ.get("GEO_TEACHER_PW", "sannam-geo")
PIN_SALT = os.environ.get("GEO_PIN_SALT", "jirisense-v1")
MAX_DATA = 200_000        # 동기화 데이터 상한(바이트)

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "scores.db")

# 프런트의 MODE_INFO 키와 일치
ALLOWED_MODES = {
    "explore", "location", "theme", "muniname", "detective",
    "climate", "stats", "mcq", "ox", "battle",
}
TOP_N = 10        # 응답으로 돌려주는 상위 개수
KEEP_N = 100      # 모드별 보관 상한(무한 증가 방지)

app = Flask(__name__)


def db():
    conn = sqlite3.connect(DB, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with db() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute(
            """CREATE TABLE IF NOT EXISTS scores(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 mode TEXT NOT NULL,
                 name TEXT NOT NULL,
                 score INTEGER NOT NULL,
                 created TEXT NOT NULL DEFAULT (datetime('now','localtime')))"""
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_mode_score ON scores(mode, score DESC)")
        c.execute(
            """CREATE TABLE IF NOT EXISTS students(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 class_code TEXT NOT NULL,
                 nickname   TEXT NOT NULL,
                 pin_hash   TEXT NOT NULL,
                 token      TEXT NOT NULL,
                 xp         INTEGER NOT NULL DEFAULT 0,
                 data       TEXT NOT NULL DEFAULT '{}',
                 created    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                 updated    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                 UNIQUE(class_code, nickname))"""
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_class ON students(class_code, xp DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_token ON students(token)")


init_db()


def clean(s, n):
    return re.sub(r"[<>\r\n\t]", "", str(s or "").strip())[:n]


def pin_hash(pin):
    return hashlib.sha256((PIN_SALT + str(pin)).encode("utf-8")).hexdigest()


@app.after_request
def no_cache(resp):
    # Cloudflare/브라우저가 랭킹을 캐시하지 않도록
    resp.headers["Cache-Control"] = "no-store, max-age=0"
    return resp


@app.get("/api/health")
def health():
    return jsonify(ok=True)


@app.get("/api/leaderboard")
def leaderboard():
    qmode = request.args.get("mode")
    modes = [qmode] if qmode in ALLOWED_MODES else sorted(ALLOWED_MODES)
    out = {}
    with db() as c:
        for m in modes:
            rows = c.execute(
                "SELECT name, score, substr(created,1,10) AS date "
                "FROM scores WHERE mode=? ORDER BY score DESC, id ASC LIMIT ?",
                (m, TOP_N),
            ).fetchall()
            out[m] = [dict(r) for r in rows]
    return jsonify(out)


@app.post("/api/score")
def add_score():
    data = request.get_json(silent=True) or {}
    mode = str(data.get("mode", ""))
    name = re.sub(r"[<>\r\n\t]", "", str(data.get("name", "")).strip())[:10] or "무명"
    try:
        score = int(data.get("score"))
    except (TypeError, ValueError):
        return jsonify(error="bad score"), 400
    if mode not in ALLOWED_MODES:
        return jsonify(error="bad mode"), 400
    if not (0 <= score <= 100000):
        return jsonify(error="score out of range"), 400

    with db() as c:
        c.execute("INSERT INTO scores(mode,name,score) VALUES(?,?,?)", (mode, name, score))
        # 모드별 상위 KEEP_N개만 보관
        c.execute(
            "DELETE FROM scores WHERE mode=? AND id NOT IN ("
            "  SELECT id FROM scores WHERE mode=? ORDER BY score DESC, id ASC LIMIT ?)",
            (mode, mode, KEEP_N),
        )
        rank = c.execute(
            "SELECT COUNT(*)+1 AS r FROM scores WHERE mode=? AND score>?", (mode, score)
        ).fetchone()["r"]
    return jsonify(ok=True, rank=rank)


@app.post("/api/student/login")
def student_login():
    d = request.get_json(silent=True) or {}
    cls = clean(d.get("class"), 20)
    nick = clean(d.get("nickname"), 16)
    pin = clean(d.get("pin"), 8)
    if not cls or not nick or not re.fullmatch(r"\d{4,8}", pin or ""):
        return jsonify(error="반·닉네임·비밀번호(숫자 4~8자리)를 확인하세요"), 400
    ph = pin_hash(pin)
    with db() as c:
        row = c.execute(
            "SELECT * FROM students WHERE class_code=? AND nickname=?", (cls, nick)
        ).fetchone()
        if row is None:
            token = secrets.token_hex(16)
            c.execute(
                "INSERT INTO students(class_code,nickname,pin_hash,token) VALUES(?,?,?,?)",
                (cls, nick, ph, token),
            )
            return jsonify(ok=True, token=token, xp=0, data={}, isNew=True)
        if row["pin_hash"] != ph:
            return jsonify(error="비밀번호가 일치하지 않습니다"), 403
        token = secrets.token_hex(16)
        c.execute(
            "UPDATE students SET token=?, updated=datetime('now','localtime') WHERE id=?",
            (token, row["id"]),
        )
        try:
            data = json.loads(row["data"] or "{}")
        except ValueError:
            data = {}
    return jsonify(ok=True, token=token, xp=row["xp"], data=data, isNew=False)


@app.get("/api/student/me")
def student_me():
    token = clean(request.args.get("token"), 40)
    if not token:
        return jsonify(error="no token"), 401
    with db() as c:
        row = c.execute("SELECT xp, data FROM students WHERE token=?", (token,)).fetchone()
    if row is None:
        return jsonify(error="invalid token"), 401
    try:
        data = json.loads(row["data"] or "{}")
    except ValueError:
        data = {}
    return jsonify(ok=True, xp=row["xp"], data=data)


@app.post("/api/student/sync")
def student_sync():
    d = request.get_json(silent=True) or {}
    token = clean(d.get("token"), 40)
    data = d.get("data")
    try:
        xp = int(d.get("xp", 0))
    except (TypeError, ValueError):
        xp = 0
    if not token:
        return jsonify(error="no token"), 401
    blob = json.dumps(data, ensure_ascii=False) if isinstance(data, (dict, list)) else "{}"
    if len(blob.encode("utf-8")) > MAX_DATA:
        return jsonify(error="data too large"), 413
    with db() as c:
        row = c.execute("SELECT id FROM students WHERE token=?", (token,)).fetchone()
        if row is None:
            return jsonify(error="invalid token"), 401
        c.execute(
            "UPDATE students SET xp=?, data=?, updated=datetime('now','localtime') WHERE id=?",
            (max(0, min(xp, 10_000_000)), blob, row["id"]),
        )
    return jsonify(ok=True, xp=xp)


@app.get("/api/class/roster")
def class_roster():
    cls = clean(request.args.get("class"), 20)
    pw = str(request.args.get("pw", ""))
    if pw != TEACHER_PW:
        return jsonify(error="교사 비밀번호가 올바르지 않습니다"), 403
    if not cls:
        return jsonify(error="반을 입력하세요"), 400
    with db() as c:
        rows = c.execute(
            "SELECT nickname, xp, substr(updated,1,16) AS updated "
            "FROM students WHERE class_code=? ORDER BY xp DESC, nickname ASC LIMIT 300",
            (cls,),
        ).fetchall()
    return jsonify(class_code=cls, count=len(rows), students=[dict(r) for r in rows])


# gunicorn 엔트리포인트
application = app

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8099, debug=True)
