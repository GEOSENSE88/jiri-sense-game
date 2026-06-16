# -*- coding: utf-8 -*-
# 지리SENSE GAME — 공유 명예의 전당 + 학생 기록 API (Flask + SQLite)
# 엔드포인트:
#   GET  /api/health                -> {ok:true}
#   GET  /api/leaderboard[?mode=ox] -> {mode:[{name,score,date}, ... top10], ...}
#   POST /api/score {mode,name,score} -> {ok:true, rank:N}
#   POST /api/student/login {class,nickname,pin} -> {ok,token,xp,data,isNew}
#   POST /api/student/sync  {token,xp,data}      -> {ok,xp}
#   POST /api/teacher/register {school,nickname,pw,code} -> {ok,token}  (code=교사 등록 코드)
#   POST /api/teacher/login    {school,nickname,pw}      -> {ok,token}
#   GET  /api/teacher/roster?token=...           -> {school,teacher,students:[...]}  (우리 학교)
#   GET  /api/class/roster?class=&pw=...         -> {students:[...]}  (구버전, 전역 PW)
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
    "explore", "location", "theme", "bingo", "streak", "muniname", "detective",
    "climate", "stats", "mcq", "ox", "battle",
}
TOP_N = 10        # 응답으로 돌려주는 상위 개수
KEEP_N = 100      # 모드별 보관 상한(무한 증가 방지)

app = Flask(__name__)


# CORS — GitHub Pages 등 다른 출처에서 호출 허용(토큰은 쿠키가 아닌 본문/쿼리 전달 → 와일드카드 안전)
@app.after_request
def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Max-Age"] = "86400"
    return resp


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
        c.execute(
            """CREATE TABLE IF NOT EXISTS teachers(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 school_code TEXT NOT NULL,
                 nickname    TEXT NOT NULL,
                 pw_hash     TEXT NOT NULL,
                 token       TEXT NOT NULL,
                 created     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                 updated     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
                 UNIQUE(school_code, nickname))"""
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_teacher_token ON teachers(token)")
        c.execute(
            """CREATE TABLE IF NOT EXISTS daily(
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 day   TEXT NOT NULL,
                 name  TEXT NOT NULL,
                 score INTEGER NOT NULL,
                 created TEXT NOT NULL DEFAULT (datetime('now','localtime')))"""
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_day_score ON daily(day, score DESC)")


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
    name = re.sub(r"[<>\r\n\t]", "", str(data.get("name", "")).strip())[:30] or "무명"
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
        return jsonify(error="학교명·닉네임·비밀번호(숫자 4~8자리)를 확인하세요"), 400
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


@app.get("/api/daily")
def daily_board():
    day = clean(request.args.get("day"), 10)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day or ""):
        return jsonify(error="bad day"), 400
    with db() as c:
        rows = c.execute(
            "SELECT name, score FROM daily WHERE day=? ORDER BY score DESC, id ASC LIMIT ?",
            (day, TOP_N * 2),
        ).fetchall()
    return jsonify(day=day, top=[dict(r) for r in rows])


@app.post("/api/daily/score")
def daily_score():
    d = request.get_json(silent=True) or {}
    day = clean(d.get("day"), 10)
    name = re.sub(r"[<>\r\n\t]", "", str(d.get("name", "")).strip())[:30] or "무명"
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day or ""):
        return jsonify(error="bad day"), 400
    try:
        score = int(d.get("score"))
    except (TypeError, ValueError):
        return jsonify(error="bad score"), 400
    if not (0 <= score <= 100000):
        return jsonify(error="score out of range"), 400
    with db() as c:
        c.execute("INSERT INTO daily(day,name,score) VALUES(?,?,?)", (day, name, score))
        # 날짜별 상위 200개만 보관
        c.execute(
            "DELETE FROM daily WHERE day=? AND id NOT IN ("
            "  SELECT id FROM daily WHERE day=? ORDER BY score DESC, id ASC LIMIT 200)",
            (day, day),
        )
        rank = c.execute(
            "SELECT COUNT(*)+1 AS r FROM daily WHERE day=? AND score>?", (day, score)
        ).fetchone()["r"]
    return jsonify(ok=True, rank=rank)


@app.post("/api/teacher/register")
def teacher_register():
    # 학교별 교사 자체 등록. 학생이 교사로 가장하는 것을 막기 위해
    # 등록 시에만 교사 등록 코드(TEACHER_PW)를 요구한다(로그인은 불필요).
    d = request.get_json(silent=True) or {}
    school = clean(d.get("school"), 20)
    nick = clean(d.get("nickname"), 16)
    pw = clean(d.get("pw"), 32)
    code = str(d.get("code", ""))
    if code != TEACHER_PW:
        return jsonify(error="교사 등록 코드가 올바르지 않습니다"), 403
    if not school or not nick or len(pw) < 4:
        return jsonify(error="학교명·닉네임·비밀번호(4자 이상)를 확인하세요"), 400
    with db() as c:
        if c.execute(
            "SELECT id FROM teachers WHERE school_code=? AND nickname=?", (school, nick)
        ).fetchone():
            return jsonify(error="이미 등록된 교사입니다. 로그인해 주세요"), 409
        token = secrets.token_hex(16)
        c.execute(
            "INSERT INTO teachers(school_code,nickname,pw_hash,token) VALUES(?,?,?,?)",
            (school, nick, pin_hash(pw), token),
        )
    return jsonify(ok=True, token=token, school=school, nickname=nick)


@app.post("/api/teacher/login")
def teacher_login():
    d = request.get_json(silent=True) or {}
    school = clean(d.get("school"), 20)
    nick = clean(d.get("nickname"), 16)
    pw = clean(d.get("pw"), 32)
    if not school or not nick or not pw:
        return jsonify(error="학교명·교사 닉네임·비밀번호를 입력하세요"), 400
    with db() as c:
        row = c.execute(
            "SELECT * FROM teachers WHERE school_code=? AND nickname=?", (school, nick)
        ).fetchone()
        if row is None:
            return jsonify(error="등록된 교사가 없습니다. 먼저 교사 등록을 해주세요"), 404
        if row["pw_hash"] != pin_hash(pw):
            return jsonify(error="비밀번호가 일치하지 않습니다"), 403
        token = secrets.token_hex(16)
        c.execute(
            "UPDATE teachers SET token=?, updated=datetime('now','localtime') WHERE id=?",
            (token, row["id"]),
        )
    return jsonify(ok=True, token=token, school=school, nickname=nick)


@app.get("/api/teacher/roster")
def teacher_roster():
    token = clean(request.args.get("token"), 40)
    if not token:
        return jsonify(error="no token"), 401
    with db() as c:
        t = c.execute(
            "SELECT school_code, nickname FROM teachers WHERE token=?", (token,)
        ).fetchone()
        if t is None:
            return jsonify(error="세션이 만료되었습니다. 다시 로그인해 주세요"), 401
        rows = c.execute(
            "SELECT nickname, xp, substr(updated,1,16) AS updated "
            "FROM students WHERE class_code=? ORDER BY xp DESC, nickname ASC LIMIT 500",
            (t["school_code"],),
        ).fetchall()
    return jsonify(
        school=t["school_code"], teacher=t["nickname"],
        count=len(rows), students=[dict(r) for r in rows],
    )


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
