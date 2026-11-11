"""Usage counters for OpenMindstorms: a tiny event collector on SQLite.

    POST /api/stats/event            JSON from web/shared/stats.js -> 204
    GET  /api/stats                  {"ok": true, "events": n}   (health, no key)
    GET  /api/stats/summary?days=30  everything the dashboard shows   (needs the key)
    GET  /api/stats/events?limit=200 the newest raw events            (needs the key)

The key is the STATS_KEY environment variable, sent by the dashboard in the
X-Stats-Key header (or ?key= for a quick curl).  With no STATS_KEY set, the
read endpoints answer 503 so nothing is exposed by accident.

Stored per event: time, day (local), visitor id, session id, app, event, detail,
ok flag, duration, browser family, OS family, screen width.  The client IP is
never written.  Standard library only.
"""

import json
import os
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DB_PATH = os.environ.get("STATS_DB", "/data/stats.db")
KEY = os.environ.get("STATS_KEY", "").strip()
PORT = int(os.environ.get("PORT", "8082"))
MAX_BODY = 2048
EVENTS = {"page_view", "session", "connect", "compile", "program", "run", "firmware", "file", "editor_mode", "example", "control", "error", "sign_in", "save", "open"}
APPS = {"home", "rcx", "nxt", "ev3", "stats"}
LOCK = threading.Lock()
RATE = {}  # vid -> [window_start, count]
RATE_LIMIT = 600  # events per visitor per 10 minutes


def db():
    con = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """CREATE TABLE IF NOT EXISTS events (
               id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, day TEXT NOT NULL,
               vid TEXT NOT NULL, sid TEXT NOT NULL, app TEXT NOT NULL, event TEXT NOT NULL,
               detail TEXT NOT NULL DEFAULT '', ok INTEGER NOT NULL DEFAULT 1, dur INTEGER,
               browser TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '', w INTEGER)"""
    )
    con.execute("CREATE INDEX IF NOT EXISTS ix_day ON events(day)")
    con.execute("CREATE INDEX IF NOT EXISTS ix_event ON events(event, app)")
    return con


CON = None


def conn():
    global CON
    if CON is None:
        CON = db()
    return CON


def clean(s, n):
    return "".join(ch for ch in str(s or "")[:n] if ch.isprintable())


def rate_ok(vid):
    now = time.time()
    with LOCK:
        w = RATE.get(vid)
        if not w or now - w[0] > 600:
            RATE[vid] = [now, 1]
            if len(RATE) > 5000:
                for k in [k for k, v in RATE.items() if now - v[0] > 600]:
                    del RATE[k]
            return True
        w[1] += 1
        return w[1] <= RATE_LIMIT


def record(obj):
    event = clean(obj.get("event"), 24)
    app = clean(obj.get("app"), 8)
    if event not in EVENTS or app not in APPS:
        return False
    vid = clean(obj.get("vid"), 24) or "anon"
    if not rate_ok(vid):
        return False
    now = int(time.time())
    row = (
        now, datetime.now().strftime("%Y-%m-%d"), vid, clean(obj.get("sid"), 24), app, event, clean(obj.get("detail"), 32),
        1 if obj.get("ok", 1) else 0, int(obj["dur"]) if isinstance(obj.get("dur"), (int, float)) else None,
        clean(obj.get("browser"), 12), clean(obj.get("os"), 12), int(obj["w"]) if isinstance(obj.get("w"), (int, float)) else None,
    )
    with LOCK:
        c = conn()
        c.execute("INSERT INTO events(ts,day,vid,sid,app,event,detail,ok,dur,browser,os,w) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", row)
        c.commit()
    return True


def rows(sql, args=()):
    with LOCK:
        cur = conn().execute(sql, args)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def summary(days):
    days = max(1, min(int(days), 3650))
    since = (datetime.now() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    out = {"days": days, "since": since, "generated": datetime.now().isoformat(timespec="seconds")}
    out["first_day"] = (rows("SELECT MIN(day) AS d FROM events")[0]["d"])
    out["total_events"] = rows("SELECT COUNT(*) AS n FROM events")[0]["n"]

    def totals(where="", args=()):
        r = rows(
            f"""SELECT
                 COUNT(DISTINCT CASE WHEN event='page_view' THEN vid END) AS visitors,
                 COUNT(DISTINCT CASE WHEN event='page_view' THEN sid END) AS sessions,
                 SUM(event='page_view') AS page_views,
                 SUM(event='connect' AND ok=1) AS connects,
                 SUM(event='connect' AND ok=0) AS connect_fail,
                 SUM(event='connect' AND ok=1 AND detail<>'sim') AS connects_real,
                 SUM(event='compile' AND ok=1) AS compiles,
                 SUM(event='compile' AND ok=0) AS compile_fail,
                 SUM(event='program' AND ok=1) AS programs,
                 SUM(event='run' AND ok=1) AS runs,
                 SUM(event='firmware' AND ok=1) AS firmware,
                 SUM(event='file') AS files,
                 SUM(event='control') AS control,
                 SUM(CASE WHEN event='session' THEN dur END) AS seconds,
                 SUM(event='session') AS ended_sessions
               FROM events {where}""",
            args,
        )[0]
        return {k: (v or 0) for k, v in r.items()}

    out["all_time"] = totals()
    out["range"] = totals("WHERE day >= ?", (since,))
    out["by_app"] = {}
    for app in ("home", "rcx", "nxt", "ev3"):
        out["by_app"][app] = totals("WHERE day >= ? AND app = ?", (since, app))
    # daily series (every day in range, zero-filled)
    daily = {r["day"]: r for r in rows(
        """SELECT day,
             COUNT(DISTINCT CASE WHEN event='page_view' THEN vid END) AS visitors,
             SUM(event='page_view') AS page_views,
             SUM(event='connect' AND ok=1) AS connects,
             SUM(event='compile' AND ok=1) AS compiles,
             SUM(event='program' AND ok=1) AS programs,
             SUM(event='run' AND ok=1) AS runs
           FROM events WHERE day >= ? GROUP BY day""", (since,))}
    series = []
    d = datetime.strptime(since, "%Y-%m-%d")
    for _ in range(days):
        k = d.strftime("%Y-%m-%d")
        r = daily.get(k, {})
        series.append({"day": k, **{f: (r.get(f) or 0) for f in ("visitors", "page_views", "connects", "compiles", "programs", "runs")}})
        d += timedelta(days=1)
    out["daily"] = series
    out["connect_links"] = rows("SELECT app, detail AS link, ok, COUNT(*) AS n FROM events WHERE event='connect' AND day >= ? GROUP BY app, detail, ok ORDER BY app, link", (since,))
    out["browsers"] = rows("SELECT browser, COUNT(DISTINCT vid) AS visitors FROM events WHERE event='page_view' AND day >= ? GROUP BY browser ORDER BY visitors DESC", (since,))
    out["oses"] = rows("SELECT os, COUNT(DISTINCT vid) AS visitors FROM events WHERE event='page_view' AND day >= ? GROUP BY os ORDER BY visitors DESC", (since,))
    out["editor_modes"] = rows("SELECT app, detail AS mode, COUNT(*) AS n FROM events WHERE event='editor_mode' AND day >= ? GROUP BY app, detail ORDER BY app, n DESC", (since,))
    out["examples"] = rows("SELECT app, detail AS name, COUNT(*) AS n FROM events WHERE event='example' AND day >= ? GROUP BY app, detail ORDER BY n DESC LIMIT 20", (since,))
    out["errors"] = rows("SELECT app, event, detail, COUNT(*) AS n FROM events WHERE ok=0 AND day >= ? GROUP BY app, event, detail ORDER BY n DESC LIMIT 20", (since,))
    out["controls"] = rows("SELECT app, detail AS what, COUNT(*) AS n FROM events WHERE event='control' AND day >= ? GROUP BY app, detail ORDER BY n DESC LIMIT 20", (since,))
    out["recent"] = rows("SELECT ts, app, event, detail, ok, dur, browser, os FROM events ORDER BY id DESC LIMIT 40")
    out["db_bytes"] = os.path.getsize(DB_PATH) if os.path.exists(DB_PATH) else 0
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = "openmindstorms-stats/1"

    def log_message(self, fmt, *args):  # quiet; no IPs in the log
        pass

    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "X-Stats-Key, Content-Type")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def authorised(self, q):
        if not KEY:
            self.send(503, {"error": "STATS_KEY is not set on the server"})
            return False
        given = self.headers.get("X-Stats-Key") or (q.get("key") or [""])[0]
        if given != KEY:
            self.send(401, {"error": "bad key"})
            return False
        return True

    def do_OPTIONS(self):
        self.send(204, b"")

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        p = u.path.rstrip("/")
        try:
            if p in ("/api/stats", ""):
                self.send(200, {"ok": True, "events": rows("SELECT COUNT(*) AS n FROM events")[0]["n"], "key_set": bool(KEY)})
            elif p == "/api/stats/summary":
                if self.authorised(q):
                    self.send(200, summary((q.get("days") or ["30"])[0]))
            elif p == "/api/stats/events":
                if self.authorised(q):
                    n = max(1, min(int((q.get("limit") or ["200"])[0]), 5000))
                    self.send(200, rows("SELECT ts, day, app, event, detail, ok, dur, browser, os, w FROM events ORDER BY id DESC LIMIT ?", (n,)))
            else:
                self.send(404, {"error": "not found"})
        except Exception as e:  # pragma: no cover
            self.send(500, {"error": str(e)})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path.rstrip("/") != "/api/stats/event":
            self.send(404, {"error": "not found"})
            return
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            self.send(413, {"error": "body size"})
            return
        try:
            obj = json.loads(self.rfile.read(n).decode("utf-8", "replace"))
            ok = isinstance(obj, dict) and record(obj)
        except Exception:
            ok = False
        self.send(204 if ok else 400, b"")


def main():
    os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
    conn()
    print(f"stats service on :{PORT}, db {DB_PATH}, key {'set' if KEY else 'NOT SET (dashboard disabled)'}", flush=True)
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
