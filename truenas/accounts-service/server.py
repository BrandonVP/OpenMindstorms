"""Optional accounts for OpenMindstorms: sign in with Google or GitHub, keep programs.

The site works without this service; it only adds "save my program online".

    GET    /api/auth/me                       {"user": {...} | null, "providers": [...]}
    GET    /api/auth/login/<provider>?back=/rcx/   redirect to Google / GitHub (or sign in a
                                               fixed test user when DEV_LOGIN=1)
    GET    /api/auth/callback/<provider>      the provider sends the browser back here
    POST   /api/auth/logout
    DELETE /api/auth/me                       delete the account and all its programs
    GET    /api/auth/export                   every program as one JSON download

    GET    /api/programs?app=rcx              [{id, name, mode, size, updated}]
    GET    /api/programs/<id>                 the full program
    POST   /api/programs                      {app, name, mode, blocks, src} -> {id, updated}
    PUT    /api/programs/<id>                 same body, optional "updated" for conflict checks
    DELETE /api/programs/<id>

Environment: ACCOUNTS_DB, PORT, SITE_URL (https://www.openmindstorms.com, used for the
OAuth redirect address), GOOGLE_CLIENT_ID/SECRET, GITHUB_CLIENT_ID/SECRET, DEV_LOGIN,
BACKUP_HOUR (local hour for the nightly SQLite backup into /data/backups), TZ.

Stored per user: provider, the provider's id, display name, e-mail (shown back to the
person, never mailed).  Sessions are random tokens in an HttpOnly cookie, kept hashed.
Writes need the header X-Requested-With: OpenMindstorms, which a cross-site page cannot
add without a CORS preflight that this service never answers.  Standard library only.
"""

import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DB_PATH = os.environ.get("ACCOUNTS_DB", "/data/accounts.db")
PORT = int(os.environ.get("PORT", "8083"))
SITE_URL = os.environ.get("SITE_URL", "https://www.openmindstorms.com").rstrip("/")
DEV_LOGIN = os.environ.get("DEV_LOGIN", "0") == "1"
BACKUP_HOUR = int(os.environ.get("BACKUP_HOUR", "3"))
PROVIDERS = {
    "google": {
        "id": os.environ.get("GOOGLE_CLIENT_ID", "").strip(),
        "secret": os.environ.get("GOOGLE_CLIENT_SECRET", "").strip(),
        "auth": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "scope": "openid email profile",
    },
    "github": {
        "id": os.environ.get("GITHUB_CLIENT_ID", "").strip(),
        "secret": os.environ.get("GITHUB_CLIENT_SECRET", "").strip(),
        "auth": "https://github.com/login/oauth/authorize",
        "token": "https://github.com/login/oauth/access_token",
        "scope": "read:user user:email",
    },
}
APPS = {"rcx", "nxt", "ev3"}
MODES = {"blocks", "text", "asm", "python"}
SESSION_DAYS = 90
MAX_PROGRAMS = 500
MAX_PROGRAM_BYTES = 512 * 1024
MAX_BODY = MAX_PROGRAM_BYTES + 4096
WRITE_LIMIT = 60          # writes per user per minute
COOKIE = "om_session"
STATE_COOKIE = "om_state"
HEADER = "OpenMindstorms"
LOCK = threading.Lock()
RATE = {}                 # user_id -> [window_start, count]


# ------------------------------------------------------------------ storage
def db():
    con = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db():
    con = db()
    con.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, provider TEXT NOT NULL, provider_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
        created INTEGER NOT NULL, last_seen INTEGER NOT NULL,
        UNIQUE(provider, provider_id));
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS programs (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        app TEXT NOT NULL, name TEXT NOT NULL, mode TEXT NOT NULL,
        blocks TEXT NOT NULL DEFAULT '', src TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL,
        created INTEGER NOT NULL, updated INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS programs_user ON programs(user_id, app, updated);
    """)
    con.commit()
    con.close()


CON = None


def conn():
    global CON
    if CON is None:
        CON = db()
    return CON


def now():
    return int(time.time())


def token_hash(tok):
    return hashlib.sha256(tok.encode()).hexdigest()


# ------------------------------------------------------------------ backups
def backup_once():
    d = os.path.join(os.path.dirname(DB_PATH), "backups")
    os.makedirs(d, exist_ok=True)
    name = os.path.join(d, "accounts-%s.db" % datetime.now().strftime("%Y-%m-%d"))
    with LOCK:
        dst = sqlite3.connect(name)
        conn().backup(dst)
        dst.close()
        conn().execute("DELETE FROM sessions WHERE expires < ?", (now(),))
        conn().commit()
    keep = sorted(f for f in os.listdir(d) if f.startswith("accounts-") and f.endswith(".db"))
    for old in keep[:-14]:
        try:
            os.remove(os.path.join(d, old))
        except OSError:
            pass
    print("backup written:", name, flush=True)


def backup_loop():
    while True:
        t = datetime.now()
        nxt = t.replace(hour=BACKUP_HOUR, minute=0, second=0, microsecond=0)
        if nxt <= t:
            nxt += timedelta(days=1)
        time.sleep(max(60, (nxt - t).total_seconds()))
        try:
            backup_once()
        except Exception as e:  # noqa: BLE001
            print("backup failed:", e, flush=True)


# ------------------------------------------------------------------ OAuth
def http_json(url, data=None, headers=None, bearer=None):
    h = {"Accept": "application/json", "User-Agent": "OpenMindstorms-accounts"}
    if headers:
        h.update(headers)
    if bearer:
        h["Authorization"] = "Bearer " + bearer
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        h["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, headers=h, method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def redirect_uri(provider):
    return SITE_URL + "/api/auth/callback/" + provider


def provider_identity(provider, code):
    """Exchange the code for the person's id, name and e-mail at the provider."""
    p = PROVIDERS[provider]
    tok = http_json(p["token"], data={
        "code": code, "client_id": p["id"], "client_secret": p["secret"],
        "redirect_uri": redirect_uri(provider), "grant_type": "authorization_code",
    })
    access = tok.get("access_token")
    if not access:
        raise ValueError("no access token from " + provider)
    if provider == "google":
        u = http_json("https://openidconnect.googleapis.com/v1/userinfo", bearer=access)
        return str(u["sub"]), u.get("name") or (u.get("email") or "").split("@")[0], u.get("email") or ""
    u = http_json("https://api.github.com/user", bearer=access)
    email = u.get("email") or ""
    if not email:
        try:
            for e in http_json("https://api.github.com/user/emails", bearer=access):
                if e.get("primary") and e.get("verified"):
                    email = e["email"]
                    break
        except Exception:  # noqa: BLE001
            pass
    return str(u["id"]), u.get("name") or u.get("login") or "GitHub user", email


def enabled_providers():
    out = [k for k, p in PROVIDERS.items() if p["id"] and p["secret"]]
    if DEV_LOGIN:
        out.append("dev")
    return out


# ------------------------------------------------------------------ handler
class Handler(BaseHTTPRequestHandler):
    server_version = "openmindstorms-accounts/1"

    def log_message(self, *a):  # quiet; no IPs in the log
        pass

    # ---- plumbing
    def send(self, code, body=None, extra=None, ctype="application/json"):
        data = b"" if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith("text") or ctype == "application/json" else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if data:
            self.wfile.write(data)

    def redirect(self, to, extra=None):
        self.send_response(302)
        self.send_header("Location", to)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()

    @staticmethod
    def cookie(name, value, max_age):
        c = "%s=%s; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=%d" % (name, value, max_age)
        return ("Set-Cookie", c)

    def cookies_in(self):
        c = cookies.SimpleCookie()
        try:
            c.load(self.headers.get("Cookie", ""))
        except cookies.CookieError:
            return {}
        return {k: m.value for k, m in c.items()}

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > MAX_BODY:
            return None
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None

    def user(self):
        tok = self.cookies_in().get(COOKIE)
        if not tok:
            return None
        with LOCK:
            r = conn().execute("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?",
                               (token_hash(tok), now())).fetchone()
            if r and now() - r["last_seen"] > 3600:
                conn().execute("UPDATE users SET last_seen = ? WHERE id = ?", (now(), r["id"]))
                conn().commit()
        return dict(r) if r else None

    def guard_write(self):
        """Returns the user for a state-changing request, or sends the error and returns None."""
        if self.headers.get("X-Requested-With") != HEADER:
            self.send(403, {"error": "missing X-Requested-With header"})
            return None
        u = self.user()
        if not u:
            self.send(401, {"error": "not signed in"})
            return None
        w = RATE.setdefault(u["id"], [now(), 0])
        if now() - w[0] > 60:
            w[0], w[1] = now(), 0
        w[1] += 1
        if w[1] > WRITE_LIMIT:
            self.send(429, {"error": "too many saves; wait a minute"})
            return None
        return u

    @staticmethod
    def public_user(u):
        return {"id": u["id"], "name": u["name"], "email": u["email"], "provider": u["provider"]}

    # ---- routes
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        path = url.path.rstrip("/")
        if path == "/api/auth":
            return self.send(200, {"ok": True, "providers": enabled_providers()})
        if path == "/api/auth/me":
            u = self.user()
            return self.send(200, {"user": self.public_user(u) if u else None, "providers": enabled_providers()})
        if path.startswith("/api/auth/login/"):
            return self.login(path.rsplit("/", 1)[1], q)
        if path.startswith("/api/auth/callback/"):
            return self.callback(path.rsplit("/", 1)[1], q)
        if path == "/api/auth/export":
            u = self.user()
            if not u:
                return self.send(401, {"error": "not signed in"})
            with LOCK:
                rows = conn().execute("SELECT id, app, name, mode, blocks, src, created, updated FROM programs WHERE user_id = ? ORDER BY app, name", (u["id"],)).fetchall()
            out = {"exported": datetime.now().isoformat(timespec="seconds"), "user": {"name": u["name"], "provider": u["provider"]},
                   "programs": [self.program_out(r) for r in rows]}
            return self.send(200, json.dumps(out, indent=1).encode(), [("Content-Disposition", 'attachment; filename="openmindstorms-programs.json"')], "application/json")
        if path == "/api/programs":
            u = self.user()
            if not u:
                return self.send(401, {"error": "not signed in"})
            app = (q.get("app") or [""])[0]
            with LOCK:
                if app in APPS:
                    rows = conn().execute("SELECT id, app, name, mode, size, updated FROM programs WHERE user_id = ? AND app = ? ORDER BY updated DESC", (u["id"], app)).fetchall()
                else:
                    rows = conn().execute("SELECT id, app, name, mode, size, updated FROM programs WHERE user_id = ? ORDER BY updated DESC", (u["id"],)).fetchall()
            return self.send(200, [dict(r) for r in rows])
        if path.startswith("/api/programs/"):
            u = self.user()
            if not u:
                return self.send(401, {"error": "not signed in"})
            r = self.own_program(u, path)
            if r is None:
                return self.send(404, {"error": "no such program"})
            return self.send(200, self.program_out(r))
        self.send(404, {"error": "not found"})

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path.rstrip("/")
        if path == "/api/auth/logout":
            if self.headers.get("X-Requested-With") != HEADER:
                return self.send(403, {"error": "missing X-Requested-With header"})
            tok = self.cookies_in().get(COOKIE)
            if tok:
                with LOCK:
                    conn().execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(tok),))
                    conn().commit()
            return self.send(204, None, [self.cookie(COOKIE, "", 0)])
        if path == "/api/programs":
            u = self.guard_write()
            if not u:
                return
            p = self.valid_program(self.body())
            if p is None:
                return
            with LOCK:
                n = conn().execute("SELECT COUNT(*) FROM programs WHERE user_id = ?", (u["id"],)).fetchone()[0]
                if n >= MAX_PROGRAMS:
                    return self.send(413, {"error": "library full (%d programs)" % MAX_PROGRAMS})
                t = now()
                cur = conn().execute("INSERT INTO programs(user_id, app, name, mode, blocks, src, size, created, updated) VALUES (?,?,?,?,?,?,?,?,?)",
                                     (u["id"], p["app"], p["name"], p["mode"], p["blocks"], p["src"], p["size"], t, t))
                conn().commit()
            return self.send(201, {"id": cur.lastrowid, "updated": t})
        self.send(404, {"error": "not found"})

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path.rstrip("/")
        if not path.startswith("/api/programs/"):
            return self.send(404, {"error": "not found"})
        u = self.guard_write()
        if not u:
            return
        body = self.body()
        p = self.valid_program(body)
        if p is None:
            return
        with LOCK:
            r = self.own_program(u, path)
            if r is None:
                return self.send(404, {"error": "no such program"})
            known = body.get("updated")
            if isinstance(known, int) and known and known < r["updated"]:
                return self.send(409, {"error": "saved elsewhere more recently", "updated": r["updated"]})
            t = max(now(), r["updated"] + 1)
            conn().execute("UPDATE programs SET name = ?, mode = ?, blocks = ?, src = ?, size = ?, updated = ? WHERE id = ?",
                           (p["name"], p["mode"], p["blocks"], p["src"], p["size"], t, r["id"]))
            conn().commit()
        return self.send(200, {"id": r["id"], "updated": t})

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path.rstrip("/")
        if path == "/api/auth/me":
            u = self.guard_write()
            if not u:
                return
            with LOCK:
                conn().execute("DELETE FROM users WHERE id = ?", (u["id"],))
                conn().commit()
            return self.send(204, None, [self.cookie(COOKIE, "", 0)])
        if path.startswith("/api/programs/"):
            u = self.guard_write()
            if not u:
                return
            with LOCK:
                r = self.own_program(u, path)
                if r is None:
                    return self.send(404, {"error": "no such program"})
                conn().execute("DELETE FROM programs WHERE id = ?", (r["id"],))
                conn().commit()
            return self.send(204)
        self.send(404, {"error": "not found"})

    # ---- helpers
    def own_program(self, u, path):
        try:
            pid = int(path.rsplit("/", 1)[1])
        except ValueError:
            return None
        return conn().execute("SELECT * FROM programs WHERE id = ? AND user_id = ?", (pid, u["id"])).fetchone()

    @staticmethod
    def program_out(r):
        d = dict(r)
        d.pop("user_id", None)
        return d

    def valid_program(self, b):
        if not isinstance(b, dict):
            self.send(400, {"error": "bad JSON"})
            return None
        app = b.get("app")
        mode = b.get("mode")
        name = str(b.get("name") or "").strip()[:80]
        blocks = b.get("blocks") or ""
        src = b.get("src") or ""
        if not isinstance(blocks, str):
            blocks = json.dumps(blocks, separators=(",", ":"))
        if app not in APPS or mode not in MODES or not name or not isinstance(src, str):
            self.send(400, {"error": "need app, mode, name"})
            return None
        size = len(blocks.encode()) + len(src.encode())
        if size > MAX_PROGRAM_BYTES:
            self.send(413, {"error": "program larger than %d KB" % (MAX_PROGRAM_BYTES // 1024)})
            return None
        return {"app": app, "mode": mode, "name": name, "blocks": blocks, "src": src, "size": size}

    @staticmethod
    def safe_back(q):
        back = (q.get("back") or ["/"])[0]
        if not back.startswith("/") or back.startswith("//") or "\\" in back:
            back = "/"
        return back[:200]

    def login(self, provider, q):
        back = self.safe_back(q)
        if provider == "dev" and DEV_LOGIN:
            return self.finish_login("dev", "1", "Test User", "test@example.invalid", back)
        p = PROVIDERS.get(provider)
        if not p or not p["id"] or not p["secret"]:
            return self.send(404, {"error": "sign-in with %s is not set up" % provider})
        state = secrets.token_urlsafe(24)
        params = {"client_id": p["id"], "redirect_uri": redirect_uri(provider), "response_type": "code",
                  "scope": p["scope"], "state": state}
        if provider == "google":
            params["prompt"] = "select_account"
        cookie_val = urllib.parse.quote(json.dumps({"s": state, "b": back}), safe="")
        self.redirect(p["auth"] + "?" + urllib.parse.urlencode(params), [self.cookie(STATE_COOKIE, cookie_val, 600)])

    def callback(self, provider, q):
        p = PROVIDERS.get(provider)
        try:
            st = json.loads(urllib.parse.unquote(self.cookies_in().get(STATE_COOKIE, "")))
        except ValueError:
            st = {}
        state = (q.get("state") or [""])[0]
        code = (q.get("code") or [""])[0]
        back = st.get("b") if isinstance(st.get("b"), str) and st["b"].startswith("/") else "/"
        if not p or not state or not code or state != st.get("s"):
            return self.redirect(back + ("&" if "?" in back else "?") + "signin=failed", [self.cookie(STATE_COOKIE, "", 0)])
        try:
            pid, name, email = provider_identity(provider, code)
        except Exception as e:  # noqa: BLE001
            print("sign-in failed:", provider, e, flush=True)
            return self.redirect(back + ("&" if "?" in back else "?") + "signin=failed", [self.cookie(STATE_COOKIE, "", 0)])
        return self.finish_login(provider, pid, name, email, back, clear_state=True)

    def finish_login(self, provider, pid, name, email, back, clear_state=False):
        name = (name or "").strip()[:60] or provider
        email = (email or "").strip()[:120]
        t = now()
        with LOCK:
            conn().execute("INSERT INTO users(provider, provider_id, name, email, created, last_seen) VALUES (?,?,?,?,?,?) "
                           "ON CONFLICT(provider, provider_id) DO UPDATE SET name = excluded.name, email = excluded.email, last_seen = excluded.last_seen",
                           (provider, pid, name, email, t, t))
            uid = conn().execute("SELECT id FROM users WHERE provider = ? AND provider_id = ?", (provider, pid)).fetchone()[0]
            tok = secrets.token_urlsafe(32)
            conn().execute("INSERT INTO sessions(token_hash, user_id, created, expires) VALUES (?,?,?,?)",
                           (token_hash(tok), uid, t, t + SESSION_DAYS * 86400))
            conn().commit()
        extra = [self.cookie(COOKIE, tok, SESSION_DAYS * 86400)]
        if clear_state:
            extra.append(self.cookie(STATE_COOKIE, "", 0))
        self.redirect(back + ("&" if "?" in back else "?") + "signin=ok", extra)


def main():
    init_db()
    threading.Thread(target=backup_loop, daemon=True).start()
    print("accounts service on :%d, providers: %s, db %s" % (PORT, ", ".join(enabled_providers()) or "none", DB_PATH), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
