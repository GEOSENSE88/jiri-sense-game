# -*- coding: utf-8 -*-
# 지리SENSE GAME — 공유 명예의 전당 API (Flask + SQLite)
# 엔드포인트:
#   GET  /api/health                -> {ok:true}
#   GET  /api/leaderboard[?mode=ox] -> {mode:[{name,score,date}, ... top10], ...}
#   POST /api/score {mode,name,score} -> {ok:true, rank:N}
import os, re, sqlite3
from flask import Flask, request, jsonify

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "scores.db")

# 프런트의 MODE_INFO 키와 일치
ALLOWED_MODES = {
    "explore", "location", "muniname", "detective",
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


init_db()


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


# gunicorn 엔트리포인트
application = app

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8099, debug=True)
