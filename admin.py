# Админка: вход по приглашениям, запись сессий посетителей, аналитика, заказы.
#
#   POST /api/t                     ←  сайт присылает запись сессии (rrweb) и события (просмотр карточки, корзина, заказ)
#   GET  /admin                     →  страница админки (site/admin.html)
#   /api/admin/*                    →  API админки (cookie «adm», только для вошедших)
#
# Админы и приглашения хранятся в той же базе (DATABASE_URL), что и карточки из бота.
# Первое приглашение (владелец) выдаёт бот командой /admin или скрипт tools/admin_invite.py.
import base64
import gzip
import hashlib
import hmac
import json
import re
import secrets
import sys
import threading
import time
import urllib.parse
import zlib

ROLES = ("owner", "admin", "viewer")
ROLE_NAMES = {"owner": "Владелец", "admin": "Админ", "viewer": "Наблюдатель"}
TOKEN_DAYS = 30
ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,40}$")
MAX_IN = 2 * 1024 * 1024          # сжатый кусок записи от посетителя
MAX_RAW = 10 * 1024 * 1024        # он же после распаковки
MAX_SESSION = 40 * 1024 * 1024    # всего на одну сессию (сжатые данные)
KEEP_REPLAY_DAYS, KEEP_EVENTS_DAYS = 30, 180
EVENT_TYPES = {"pageview", "card_open", "cart_add", "fav", "order_open", "order_sent", "order_fail",
               "builder", "search", "region", "promo", "collection", "js_error", "tg_click"}
TZ = "Europe/Moscow"  # сутки и часы в отчётах — по Москве/Минску
LOCAL_DAY = f"date_trunc('day', now() AT TIME ZONE '{TZ}')"
BOT_UA = re.compile(r"bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|vkshare|whatsapp", re.I)


def now_ms():
    return int(time.time() * 1000)


def b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hash_password(pw, salt=None):
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)
    return f"pbkdf2${b64u(salt)}${b64u(dk)}"


def check_password(pw, stored):
    try:
        _, salt, dk = stored.split("$")
        return hmac.compare_digest(hash_password(pw, unb64u(salt)), stored)
    except Exception:
        return False


def parse_ua(ua):
    ua = ua or ""
    if re.search(r"iPad|Tablet|Nexus (7|9|10)", ua) or ("Android" in ua and "Mobile" not in ua):
        device = "tablet"
    elif re.search(r"iPhone|Android|Mobile", ua):
        device = "mobile"
    else:
        device = "desktop"
    os_ = next((n for p, n in [(r"iPhone|iPad|iPod", "iOS"), (r"Android", "Android"), (r"Windows", "Windows"),
                                (r"Mac OS X|Macintosh", "macOS"), (r"Linux", "Linux")] if re.search(p, ua)), "")
    # Встроенные браузеры приложений важнее движка: видно, откуда пришли
    browser = next((n for p, n in [(r"Telegram", "Telegram"), (r"Instagram", "Instagram"), (r"musical_ly|BytedanceWebview|TikTok", "TikTok"),
                                    (r"VKClient|vkontakte", "VK"), (r"YaBrowser", "Яндекс"), (r"Edg/", "Edge"), (r"OPR/|Opera", "Opera"),
                                    (r"Firefox|FxiOS", "Firefox"), (r"Chrome|CriOS", "Chrome"), (r"Safari", "Safari")] if re.search(p, ua)), "")
    return device, os_, browser


def source_of(referrer, utm):
    if utm.get("utm_source"):
        return utm["utm_source"][:40]
    host = urllib.parse.urlparse(referrer or "").hostname or ""
    host = host.removeprefix("www.").removeprefix("m.").removeprefix("l.")
    for key, name in (("tiktok", "TikTok"), ("instagram", "Instagram"), ("t.me", "Telegram"), ("telegram", "Telegram"),
                      ("vk.com", "VK"), ("yandex", "Яндекс"), ("google", "Google"), ("youtube", "YouTube")):
        if key in host:
            return name
    return host[:40] or "Прямой заход"


class Admin:
    def __init__(self, store):
        self.store = store
        self.ready = False
        self.lock = threading.Lock()
        self.secret = None
        self.login_hits = {}
        self.ingest_hits = {}
        self.new_visits = {}
        self.last_cleanup = 0

    # ------------------------------------------------------------------
    #  Таблицы
    # ------------------------------------------------------------------
    def ensure(self):
        if self.ready:
            return
        with self.lock:
            if self.ready:
                return
            run = self.store.run
            run("""CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
                password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin', is_active BOOLEAN NOT NULL DEFAULT TRUE,
                token_ver INT NOT NULL DEFAULT 1, invited_by INT, last_login TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            run("""CREATE TABLE IF NOT EXISTS admin_invites (
                id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, role TEXT NOT NULL, created_by INT,
                used_by INT, used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            run("CREATE TABLE IF NOT EXISTS admin_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)")
            run("""CREATE TABLE IF NOT EXISTS visits (
                id TEXT PRIMARY KEY, visitor TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                last_seen TIMESTAMPTZ NOT NULL DEFAULT now(), country TEXT NOT NULL DEFAULT '',
                device TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '', browser TEXT NOT NULL DEFAULT '',
                ua TEXT NOT NULL DEFAULT '', screen TEXT NOT NULL DEFAULT '', lang TEXT NOT NULL DEFAULT '',
                referrer TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', utm TEXT NOT NULL DEFAULT '',
                landing TEXT NOT NULL DEFAULT '', pages INT NOT NULL DEFAULT 0, cards INT NOT NULL DEFAULT 0,
                has_cart BOOLEAN NOT NULL DEFAULT FALSE, has_order BOOLEAN NOT NULL DEFAULT FALSE,
                errors INT NOT NULL DEFAULT 0, replay_bytes BIGINT NOT NULL DEFAULT 0)""")
            run("CREATE INDEX IF NOT EXISTS visits_started ON visits (started_at DESC)")
            run("CREATE INDEX IF NOT EXISTS visits_visitor ON visits (visitor)")
            run("""CREATE TABLE IF NOT EXISTS replay_chunks (
                id BIGSERIAL PRIMARY KEY, visit TEXT NOT NULL, t_first BIGINT NOT NULL, t_last BIGINT NOT NULL,
                data BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())""")
            run("CREATE INDEX IF NOT EXISTS replay_chunks_visit ON replay_chunks (visit, id)")
            run("""CREATE TABLE IF NOT EXISTS visit_events (
                id BIGSERIAL PRIMARY KEY, visit TEXT NOT NULL, ts TIMESTAMPTZ NOT NULL, t BIGINT NOT NULL,
                type TEXT NOT NULL, path TEXT NOT NULL DEFAULT '', data JSONB NOT NULL DEFAULT '{}'::jsonb)""")
            run("CREATE INDEX IF NOT EXISTS visit_events_visit ON visit_events (visit, t)")
            run("CREATE INDEX IF NOT EXISTS visit_events_type_ts ON visit_events (type, ts DESC)")
            run("""CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY, visit TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                name TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', comment TEXT NOT NULL DEFAULT '',
                lines JSONB NOT NULL DEFAULT '[]'::jsonb, total TEXT NOT NULL DEFAULT '', photos INT NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'new', note TEXT NOT NULL DEFAULT '')""")
            rows = run("SELECT v FROM admin_meta WHERE k = 'secret'")
            if rows:
                self.secret = rows[0][0].encode()
            else:
                s = secrets.token_hex(32)
                run("INSERT INTO admin_meta (k, v) VALUES ('secret', :v) ON CONFLICT (k) DO NOTHING", v=s)
                self.secret = run("SELECT v FROM admin_meta WHERE k = 'secret'")[0][0].encode()
            self.ready = True

    # ------------------------------------------------------------------
    #  Приглашения (их же выдаёт бот и tools/admin_invite.py)
    # ------------------------------------------------------------------
    def create_invite(self, role, created_by=None, days=7):
        self.ensure()
        code = "adm_" + secrets.token_urlsafe(12)
        self.store.run("""INSERT INTO admin_invites (code, role, created_by, expires_at)
                          VALUES (:c, :r, :b, now() + make_interval(days => :d))""", c=code, r=role, b=created_by, d=days)
        return code

    def admins_count(self):
        self.ensure()
        return self.store.run("SELECT count(*) FROM admin_users")[0][0]

    # ------------------------------------------------------------------
    #  Токен входа: подписанный HMAC, проверяется по базе на каждом запросе
    # ------------------------------------------------------------------
    def make_token(self, admin_id, ver):
        payload = b64u(json.dumps({"a": admin_id, "v": ver, "e": int(time.time()) + TOKEN_DAYS * 86400, "t": "admin"}).encode())
        sig = b64u(hmac.new(self.secret, payload.encode(), hashlib.sha256).digest())
        return f"{payload}.{sig}"

    def current(self, h):
        raw = ""
        for part in (h.headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "adm":
                raw = v
        if "." not in raw:
            return None
        self.ensure()
        payload, sig = raw.rsplit(".", 1)
        good = b64u(hmac.new(self.secret, payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, good):
            return None
        try:
            p = json.loads(unb64u(payload))
        except Exception:
            return None
        if p.get("t") != "admin" or p.get("e", 0) < time.time():
            return None
        rows = self.store.run("SELECT id, email, name, role, is_active, token_ver FROM admin_users WHERE id = :i", i=p.get("a"))
        if not rows or not rows[0][4] or rows[0][5] != p.get("v"):
            return None
        r = rows[0]
        return {"id": r[0], "email": r[1], "name": r[2], "role": r[3]}

    def set_cookie(self, h, value, max_age):
        secure = "; Secure" if (h.headers.get("X-Forwarded-Proto") == "https" or "localhost" not in (h.headers.get("Host") or "")) else ""
        return f"adm={value}; Path=/; HttpOnly; SameSite=Strict; Max-Age={max_age}{secure}"

    # ------------------------------------------------------------------
    #  Приём записи от посетителей
    # ------------------------------------------------------------------
    def ingest(self, h, ip, body):
        now = time.time()
        hits = [t for t in self.ingest_hits.get(ip, []) if now - t < 60]
        if len(hits) >= 120:
            return 429, {"ok": False}
        self.ingest_hits[ip] = hits + [now]
        if len(self.ingest_hits) > 5000:
            self.ingest_hits.clear()
        ua = h.headers.get("User-Agent") or ""
        if BOT_UA.search(ua):
            return 200, {"ok": True}
        try:
            if body[:2] == b"\x1f\x8b":  # сайт сжимает запись (gzip) — распаковываем с ограничением размера
                d = zlib.decompressobj(16 + zlib.MAX_WBITS)
                body = d.decompress(body, MAX_RAW)
                if d.unconsumed_tail:
                    return 413, {"ok": False}
            data = json.loads(body)
        except Exception:
            return 400, {"ok": False}
        if not isinstance(data, dict):
            return 400, {"ok": False}
        sid, vid = str(data.get("s") or ""), str(data.get("v") or "")
        if not ID_RE.match(sid) or not ID_RE.match(vid):
            return 400, {"ok": False}
        self.ensure()
        run = self.store.run
        meta = data.get("m") if isinstance(data.get("m"), dict) else None
        exists = run("SELECT replay_bytes FROM visits WHERE id = :s", s=sid)
        if not exists:
            # Одному адресу — не больше 40 новых сессий в час: базу не забить подделанными записями
            fresh = [t for t in self.new_visits.get(ip, []) if now - t < 3600]
            if len(fresh) >= 40:
                return 429, {"ok": False}
            self.new_visits[ip] = fresh + [now]
            if len(self.new_visits) > 5000:
                self.new_visits.clear()
            m = meta or {}
            device, os_, browser = parse_ua(ua)
            utm = {k: str(v)[:80] for k, v in (m.get("utm") or {}).items() if k.startswith("utm_")} if isinstance(m.get("utm"), dict) else {}
            ref = str(m.get("ref") or "")[:300]
            run("""INSERT INTO visits (id, visitor, country, device, os, browser, ua, screen, lang, referrer, source, utm, landing)
                   VALUES (:s, :v, :c, :d, :o, :b, :ua, :sc, :l, :r, :src, :utm, :land) ON CONFLICT (id) DO NOTHING""",
                s=sid, v=vid, c=(h.headers.get("CF-IPCountry") or "")[:2].upper(), d=device, o=os_, b=browser, ua=ua[:300],
                sc=str(m.get("scr") or "")[:20], l=str(m.get("lang") or "")[:10], r=ref, src=source_of(ref, utm),
                utm=json.dumps(utm, ensure_ascii=False), land=str(m.get("path") or "")[:200])
            used = 0
        else:
            used = exists[0][0]
        # Запись экрана (rrweb)
        rr = data.get("r")
        if isinstance(rr, list) and rr and used < MAX_SESSION:
            ts = [e.get("timestamp") for e in rr if isinstance(e, dict) and isinstance(e.get("timestamp"), (int, float))]
            if ts:
                blob = gzip.compress(json.dumps(rr, ensure_ascii=False, separators=(",", ":")).encode(), 6)
                run("INSERT INTO replay_chunks (visit, t_first, t_last, data) VALUES (:s, :a, :b, :d)",
                    s=sid, a=int(min(ts)), b=int(max(ts)), d=blob)
                used += len(blob)
        # События для аналитики
        flags = {"pages": 0, "cards": 0, "cart": False, "order": False, "errors": 0}
        evs = data.get("e") if isinstance(data.get("e"), list) else []
        for ev in evs[:200]:
            if not (isinstance(ev, list) and len(ev) >= 3 and ev[0] in EVENT_TYPES):
                continue
            typ, t = ev[0], ev[1] if isinstance(ev[1], (int, float)) else now_ms()
            t = int(min(max(t, now_ms() - 86400000), now_ms() + 60000))
            extra = ev[3] if len(ev) > 3 and isinstance(ev[3], dict) else {}
            payload = json.dumps({k: (v if isinstance(v, (int, float, bool)) else str(v)[:300]) for k, v in list(extra.items())[:12]}, ensure_ascii=False)
            run("INSERT INTO visit_events (visit, ts, t, type, path, data) VALUES (:s, to_timestamp(:t / 1000.0), :t, :ty, :p, CAST(:d AS jsonb))",
                s=sid, t=t, ty=typ, p=str(ev[2] or "")[:200], d=payload)
            flags["pages"] += typ == "pageview"
            flags["cards"] += typ == "card_open"
            flags["cart"] |= typ == "cart_add"
            flags["order"] |= typ == "order_sent"
            flags["errors"] += typ == "js_error"
        run("""UPDATE visits SET last_seen = now(), pages = pages + :p, cards = cards + :c, has_cart = has_cart OR :ca,
               has_order = has_order OR :o, errors = errors + :er, replay_bytes = :rb WHERE id = :s""",
            p=flags["pages"], c=flags["cards"], ca=flags["cart"], o=flags["order"], er=flags["errors"], rb=used, s=sid)
        if now - self.last_cleanup > 3600:
            self.last_cleanup = now
            try:
                run("DELETE FROM replay_chunks WHERE created_at < now() - make_interval(days => :d)", d=KEEP_REPLAY_DAYS)
                run("DELETE FROM visit_events WHERE ts < now() - make_interval(days => :d)", d=KEEP_EVENTS_DAYS)
            except Exception as e:
                print("cleanup error:", e, file=sys.stderr)
        return 200, {"ok": True}

    def save_order(self, sid, name, contact, comment, lines, total, photos):
        self.ensure()
        sid = sid if ID_RE.match(sid or "") else None
        self.store.run("""INSERT INTO orders (visit, name, contact, comment, lines, total, photos)
                          VALUES (:s, :n, :c, :cm, CAST(:l AS jsonb), :t, :p)""",
                       s=sid, n=name, c=contact, cm=comment, l=json.dumps(lines, ensure_ascii=False), t=total[:40], p=photos)
        if sid:
            self.store.run("UPDATE visits SET has_order = TRUE WHERE id = :s", s=sid)

    # ------------------------------------------------------------------
    #  API админки
    # ------------------------------------------------------------------
    def api(self, h, method, path, query, body):
        """Возвращает (код, json) или (код, bytes, content-type, доп. заголовки)."""
        self.ensure()
        ip = h.client_ip()
        if method == "POST":
            # Защита от подделки запросов с чужих сайтов: POST только со своей страницы
            origin = h.headers.get("Origin")
            if origin and urllib.parse.urlparse(origin).netloc != (h.headers.get("Host") or ""):
                return 403, {"ok": False, "error": "Чужой источник запроса"}
            try:
                data = json.loads(body or b"{}")
            except Exception:
                return 400, {"ok": False, "error": "Некорректные данные"}
            if not isinstance(data, dict):
                return 400, {"ok": False, "error": "Некорректные данные"}
        else:
            data = {}
        q = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}

        # --- без входа ---
        if path == "/login" and method == "POST":
            return self.login(h, ip, data)
        if path == "/register" and method == "POST":
            return self.register(h, ip, data)
        if path == "/invite" and method == "GET":
            rows = self.store.run("""SELECT role FROM admin_invites WHERE code = :c AND used_by IS NULL AND expires_at > now()""",
                                  c=str(q.get("code", ""))[:60])
            return (200, {"ok": True, "role": rows[0][0], "role_name": ROLE_NAMES[rows[0][0]]}) if rows else \
                (404, {"ok": False, "error": "Приглашение не найдено, уже использовано или устарело"})
        if path == "/logout" and method == "POST":
            return 200, {"ok": True}, None, None, {"Set-Cookie": self.set_cookie(h, "", 0)}

        me = self.current(h)
        if not me:
            return 401, {"ok": False, "error": "Нужно войти"}
        can_edit = me["role"] in ("owner", "admin")

        if path == "/me":
            return 200, {"ok": True, "admin": me}
        if path == "/ping":  # счётчики в меню: кто сейчас на сайте и сколько новых заказов
            return 200, {"ok": True, "online": self.store.run("SELECT count(*) FROM visits WHERE last_seen > now() - interval '2 minutes'")[0][0],
                         "new_orders": self.store.run("SELECT count(*) FROM orders WHERE status = 'new'")[0][0]}
        if path == "/overview":
            return 200, self.overview(int(q.get("days", 7) or 7))
        if path == "/sessions":
            return 200, self.sessions(q)
        m = re.match(r"^/sessions/([A-Za-z0-9_-]{8,40})(/replay|/delete)?$", path)
        if m:
            sid = m[1]
            if m[2] == "/replay":
                return self.replay(h, sid, int(q.get("after", 0) or 0))
            if m[2] == "/delete":
                if method != "POST" or not can_edit:
                    return 403, {"ok": False, "error": "Нет прав"}
                for t in ("replay_chunks", "visit_events"):
                    self.store.run(f"DELETE FROM {t} WHERE visit = :s", s=sid)
                self.store.run("DELETE FROM visits WHERE id = :s", s=sid)
                return 200, {"ok": True}
            return self.session(sid)
        if path == "/orders":
            return 200, self.orders(q)
        m = re.match(r"^/orders/(\d+)$", path)
        if m and method == "POST":
            if not can_edit:
                return 403, {"ok": False, "error": "Наблюдатель не может менять заказы"}
            status = data.get("status")
            if status not in ("new", "work", "sent", "done", "cancel"):
                return 400, {"ok": False, "error": "Неизвестный статус"}
            self.store.run("UPDATE orders SET status = :st, note = COALESCE(:n, note) WHERE id = :i",
                           st=status, n=(str(data["note"])[:500] if "note" in data else None), i=int(m[1]))
            return 200, {"ok": True}
        if path == "/cards":
            return 200, self.cards(int(q.get("days", 30) or 30))
        if path == "/team":
            return 200, self.team(me)
        if path == "/invites" and method == "POST":
            role = data.get("role")
            if role not in ROLES or not can_edit or (me["role"] == "admin" and role != "viewer"):
                return 403, {"ok": False, "error": "Админ может приглашать только наблюдателей"}
            code = self.create_invite(role, me["id"])
            return 200, {"ok": True, "code": code}
        m = re.match(r"^/team/(\d+)$", path)
        if m and method == "POST":
            if me["role"] != "owner" or int(m[1]) == me["id"]:
                return 403, {"ok": False, "error": "Только владелец, и не себя"}
            if "active" in data:
                self.store.run("UPDATE admin_users SET is_active = :a, token_ver = token_ver + 1 WHERE id = :i",
                               a=bool(data["active"]), i=int(m[1]))
            if data.get("role") in ROLES:
                self.store.run("UPDATE admin_users SET role = :r WHERE id = :i", r=data["role"], i=int(m[1]))
            return 200, {"ok": True}
        if path == "/password" and method == "POST":
            rows = self.store.run("SELECT password_hash FROM admin_users WHERE id = :i", i=me["id"])
            if not check_password(str(data.get("old", "")), rows[0][0]):
                return 400, {"ok": False, "error": "Старый пароль не подходит"}
            new = str(data.get("new", ""))
            if len(new) < 8:
                return 400, {"ok": False, "error": "Пароль — минимум 8 символов"}
            ver = self.store.run("""UPDATE admin_users SET password_hash = :p, token_ver = token_ver + 1 WHERE id = :i
                                    RETURNING token_ver""", p=hash_password(new), i=me["id"])[0][0]
            return 200, {"ok": True}, None, None, {"Set-Cookie": self.set_cookie(h, self.make_token(me["id"], ver), TOKEN_DAYS * 86400)}
        return 404, {"ok": False, "error": "not found"}

    def login(self, h, ip, data):
        now = time.time()
        hits = [t for t in self.login_hits.get(ip, []) if now - t < 600]
        if len(hits) >= 10:
            return 429, {"ok": False, "error": "Слишком много попыток, подожди 10 минут"}
        self.login_hits[ip] = hits + [now]
        email = str(data.get("email", "")).strip().lower()[:120]
        rows = self.store.run("SELECT id, password_hash, is_active, token_ver, name, role FROM admin_users WHERE email = :e", e=email)
        if not rows or not check_password(str(data.get("password", "")), rows[0][1]):
            return 400, {"ok": False, "error": "Неверная почта или пароль"}
        if not rows[0][2]:
            return 403, {"ok": False, "error": "Доступ отключён владельцем"}
        self.store.run("UPDATE admin_users SET last_login = now() WHERE id = :i", i=rows[0][0])
        self.login_hits.pop(ip, None)
        admin = {"id": rows[0][0], "email": email, "name": rows[0][4], "role": rows[0][5]}
        return 200, {"ok": True, "admin": admin}, None, None, {"Set-Cookie": self.set_cookie(h, self.make_token(rows[0][0], rows[0][3]), TOKEN_DAYS * 86400)}

    def register(self, h, ip, data):
        now = time.time()
        hits = [t for t in self.login_hits.get(ip, []) if now - t < 600]
        if len(hits) >= 10:
            return 429, {"ok": False, "error": "Слишком много попыток, подожди 10 минут"}
        self.login_hits[ip] = hits + [now]
        code = str(data.get("code", ""))[:60]
        email = str(data.get("email", "")).strip().lower()[:120]
        name = str(data.get("name", "")).strip()[:60]
        pw = str(data.get("password", ""))
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            return 400, {"ok": False, "error": "Проверь почту"}
        if len(pw) < 8:
            return 400, {"ok": False, "error": "Пароль — минимум 8 символов"}
        with self.lock:  # одно приглашение — один аккаунт, даже при одновременных запросах
            inv = self.store.run("""SELECT id, role, created_by FROM admin_invites
                                    WHERE code = :c AND used_by IS NULL AND expires_at > now()""", c=code)
            if not inv:
                return 400, {"ok": False, "error": "Приглашение не найдено, уже использовано или устарело"}
            if self.store.run("SELECT 1 FROM admin_users WHERE email = :e", e=email):
                return 400, {"ok": False, "error": "Такая почта уже зарегистрирована — просто войди"}
            aid = self.store.run("""INSERT INTO admin_users (email, name, password_hash, role, invited_by, last_login)
                                    VALUES (:e, :n, :p, :r, :b, now()) RETURNING id""",
                                 e=email, n=name or email.split("@")[0], p=hash_password(pw), r=inv[0][1], b=inv[0][2])[0][0]
            self.store.run("UPDATE admin_invites SET used_by = :a, used_at = now() WHERE id = :i", a=aid, i=inv[0][0])
        admin = {"id": aid, "email": email, "name": name or email.split("@")[0], "role": inv[0][1]}
        return 200, {"ok": True, "admin": admin}, None, None, {"Set-Cookie": self.set_cookie(h, self.make_token(aid, 1), TOKEN_DAYS * 86400)}

    # --- аналитика ---
    def overview(self, days):
        """days=1 — сегодня по часам, иначе — последние N календарных дней (время Москвы/Минска)."""
        days = max(1, min(days, 365))
        run = self.store.run
        since = f"(({LOCAL_DAY} - make_interval(days => :d - 1)) AT TIME ZONE '{TZ}')"
        k = run(f"""SELECT count(*), count(DISTINCT visitor), count(*) FILTER (WHERE has_order),
                    count(*) FILTER (WHERE has_cart), count(*) FILTER (WHERE device = 'mobile'),
                    COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM last_seen - started_at)), 0),
                    count(*) FILTER (WHERE cards > 0), count(*) FILTER (WHERE pages <= 1 AND cards = 0 AND NOT has_cart)
                    FROM visits WHERE started_at >= {since}""", d=days)[0]
        online = run("SELECT count(*) FROM visits WHERE last_seen > now() - interval '2 minutes'")[0][0]
        orders = run(f"SELECT count(*) FROM orders WHERE created_at >= {since}", d=days)[0][0]
        opened = run(f"SELECT count(DISTINCT visit) FROM visit_events WHERE type = 'order_open' AND ts >= {since}", d=days)[0][0]
        # Ряд по дням (или по часам за сегодня): считаем группами и дополняем пустые промежутки
        unit, fmt = ("hour", "HH24:00") if days == 1 else ("day", "YYYY-MM-DD")
        bucket = lambda col: f"to_char(date_trunc('{unit}', {col} AT TIME ZONE '{TZ}'), '{fmt}')"
        vis = {r[0]: (r[1], r[2]) for r in run(f"""SELECT {bucket('started_at')}, count(*), count(DISTINCT visitor)
                    FROM visits WHERE started_at >= {since} GROUP BY 1""", d=days)}
        ords = dict(run(f"SELECT {bucket('created_at')}, count(*) FROM orders WHERE created_at >= {since} GROUP BY 1", d=days))
        keys = [r[0] for r in run(f"""SELECT to_char(x, '{fmt}') FROM generate_series({LOCAL_DAY} - make_interval(days => :d - 1),
                    {"date_trunc('hour', now() AT TIME ZONE '" + TZ + "')" if days == 1 else LOCAL_DAY}, interval '1 {unit}') x""", d=days)]
        series = [{"d": x, "sessions": vis.get(x, (0, 0))[0], "visitors": vis.get(x, (0, 0))[1], "orders": ords.get(x, 0)} for x in keys]
        group = lambda col: [{"k": r[0] or "—", "n": r[1]} for r in run(
            f"SELECT {col}, count(*) FROM visits WHERE started_at >= {since} GROUP BY 1 ORDER BY 2 DESC LIMIT 8", d=days)]
        top = lambda typ, expr: [{"k": r[0], "n": r[1]} for r in run(
            f"""SELECT {expr}, count(*) FROM visit_events WHERE type = '{typ}' AND ts >= {since}
                GROUP BY 1 ORDER BY 2 DESC LIMIT 8""", d=days)]
        return {"ok": True, "days": days, "sessions": k[0], "visitors": k[1], "with_order": k[2], "with_cart": k[3],
                "mobile": k[4], "median_sec": int(k[5]), "with_card": k[6], "bounces": k[7], "online": online,
                "orders": orders, "order_opened": opened, "series": series,
                "sources": group("source"), "devices": group("device"), "countries": group("country"),
                "browsers": group("browser"),
                "pages": [{"k": r[0], "title": r[1] or "", "n": r[2]} for r in run(
                    f"""SELECT path, max(data->>'title'), count(*) FROM visit_events WHERE type = 'pageview' AND ts >= {since}
                        GROUP BY 1 ORDER BY 3 DESC LIMIT 8""", d=days)],
                "top_cards": top("card_open", "data->>'name'"), "searches": top("search", "lower(data->>'q')")}

    def sessions(self, q):
        where, params = ["TRUE"], {}
        days = max(1, min(int(q.get("days", 7) or 7), 365))
        where.append("v.started_at >= now() - make_interval(days => :d)")
        params["d"] = days
        f = q.get("filter", "")
        if f == "order":
            where.append("v.has_order")
        elif f == "cart":
            where.append("v.has_cart")
        elif f == "live":
            where.append("v.last_seen > now() - interval '2 minutes'")
        elif f == "errors":
            where.append("v.errors > 0")
        elif f == "engaged":
            where.append("(v.cards > 0 OR v.pages > 2)")
        if q.get("device") in ("mobile", "desktop", "tablet"):
            where.append("v.device = :dev")
            params["dev"] = q["device"]
        if q.get("visitor") and ID_RE.match(q["visitor"]):
            where.append("v.visitor = :vis")
            params["vis"] = q["visitor"]
        if q.get("q"):
            where.append("(v.source ILIKE :s OR v.landing ILIKE :s OR v.country ILIKE :s OR v.browser ILIKE :s OR v.id = :raw)")
            params["s"] = f"%{q['q'][:60]}%"
            params["raw"] = q["q"][:60]
        page = max(0, int(q.get("page", 0) or 0))
        sql_where = " AND ".join(where)
        total = self.store.run(f"SELECT count(*) FROM visits v WHERE {sql_where}", **params)[0][0]
        rows = self.store.run(f"""SELECT v.id, v.visitor, v.started_at, EXTRACT(EPOCH FROM v.last_seen - v.started_at)::int,
                v.last_seen > now() - interval '2 minutes', v.country, v.device, v.os, v.browser, v.source, v.landing,
                v.pages, v.cards, v.has_cart, v.has_order, v.errors, v.replay_bytes > 0,
                (SELECT count(*) FROM visits o WHERE o.visitor = v.visitor AND o.started_at < v.started_at)
                FROM visits v WHERE {sql_where} ORDER BY v.started_at DESC LIMIT 50 OFFSET :off""", off=page * 50, **params)
        keys = ("id", "visitor", "started", "duration", "live", "country", "device", "os", "browser", "source", "landing",
                "pages", "cards", "cart", "order", "errors", "has_replay", "prev_visits")
        out = [dict(zip(keys, r)) for r in rows]
        for s in out:
            s["started"] = s["started"].isoformat()
        return {"ok": True, "total": total, "page": page, "items": out}

    def session(self, sid):
        rows = self.store.run("""SELECT id, visitor, started_at, last_seen, EXTRACT(EPOCH FROM last_seen - started_at)::int,
                last_seen > now() - interval '2 minutes', country, device, os, browser, ua, screen, lang, referrer, source, utm,
                landing, pages, cards, has_cart, has_order, errors, replay_bytes FROM visits WHERE id = :s""", s=sid)
        if not rows:
            return 404, {"ok": False, "error": "Сессия не найдена"}
        keys = ("id", "visitor", "started", "last_seen", "duration", "live", "country", "device", "os", "browser", "ua", "screen",
                "lang", "referrer", "source", "utm", "landing", "pages", "cards", "cart", "order", "errors", "replay_bytes")
        s = dict(zip(keys, rows[0]))
        s["started"], s["last_seen"] = s["started"].isoformat(), s["last_seen"].isoformat()
        try:
            s["utm"] = json.loads(s["utm"] or "{}")
        except Exception:
            s["utm"] = {}
        events = [{"t": r[0], "type": r[1], "path": r[2], "data": r[3] if isinstance(r[3], dict) else json.loads(r[3] or "{}")}
                  for r in self.store.run("SELECT t, type, path, data FROM visit_events WHERE visit = :s ORDER BY t, id LIMIT 2000", s=sid)]
        orders = [{"id": r[0], "created": r[1].isoformat(), "total": r[2], "status": r[3], "lines": r[4]}
                  for r in self.store.run("SELECT id, created_at, total, status, lines FROM orders WHERE visit = :s ORDER BY id", s=sid)]
        others = [{"id": r[0], "started": r[1].isoformat(), "order": r[2], "pages": r[3]} for r in self.store.run(
            """SELECT id, started_at, has_order, pages FROM visits WHERE visitor = :v AND id <> :s ORDER BY started_at DESC LIMIT 20""",
            v=s["visitor"], s=sid)]
        return 200, {"ok": True, "session": s, "events": events, "orders": orders, "others": others}

    def replay(self, h, sid, after):
        rows = self.store.run("SELECT id, data FROM replay_chunks WHERE visit = :s AND id > :a ORDER BY t_first, id", s=sid, a=after)
        parts, last = [], after
        for cid, blob in rows:
            try:
                txt = gzip.decompress(bytes(blob)).decode()
            except Exception:
                continue
            inner = txt.strip()[1:-1]
            if inner:
                parts.append(inner)
            last = max(last, cid)
        body = ('{"ok":true,"last":%d,"events":[%s]}' % (last, ",".join(parts))).encode()
        headers = {}
        if "gzip" in (h.headers.get("Accept-Encoding") or ""):
            body = gzip.compress(body, 5)
            headers["Content-Encoding"] = "gzip"
        return 200, body, "application/json; charset=utf-8", None, headers

    def orders(self, q):
        where, params = "TRUE", {}
        if q.get("status") in ("new", "work", "sent", "done", "cancel"):
            where, params = "o.status = :st", {"st": q["status"]}
        rows = self.store.run(f"""SELECT o.id, o.created_at, o.name, o.contact, o.comment, o.lines, o.total, o.photos, o.status,
                o.note, o.visit, v.source, v.device FROM orders o LEFT JOIN visits v ON v.id = o.visit
                WHERE {where} ORDER BY o.id DESC LIMIT 200""", **params)
        keys = ("id", "created", "name", "contact", "comment", "lines", "total", "photos", "status", "note", "visit", "source", "device")
        out = [dict(zip(keys, r)) for r in rows]
        for o in out:
            o["created"] = o["created"].isoformat()
            if isinstance(o["lines"], str):
                o["lines"] = json.loads(o["lines"])
        counts = dict(self.store.run("SELECT status, count(*) FROM orders GROUP BY 1"))
        return {"ok": True, "items": out, "counts": counts}

    def cards(self, days):
        days = max(1, min(days, 365))
        rows = self.store.run("""SELECT data->>'name', data->>'uni', count(*) FILTER (WHERE type = 'card_open'),
                count(DISTINCT visit) FILTER (WHERE type = 'card_open'), count(*) FILTER (WHERE type = 'cart_add'),
                count(*) FILTER (WHERE type = 'fav')
                FROM visit_events WHERE type IN ('card_open', 'cart_add', 'fav') AND ts >= now() - make_interval(days => :d)
                AND data ? 'name' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 200""", d=days)
        return {"ok": True, "items": [{"name": r[0], "uni": r[1] or "", "opens": r[2], "people": r[3], "carts": r[4], "favs": r[5]} for r in rows]}

    def team(self, me):
        admins = [{"id": r[0], "email": r[1], "name": r[2], "role": r[3], "active": r[4],
                   "last_login": r[5].isoformat() if r[5] else None, "created": r[6].isoformat()}
                  for r in self.store.run("SELECT id, email, name, role, is_active, last_login, created_at FROM admin_users ORDER BY id")]
        invites = []
        if me["role"] in ("owner", "admin"):
            invites = [{"code": r[0], "role": r[1], "used": r[2] is not None, "expires": r[3].isoformat(), "created": r[4].isoformat(),
                        "expired": r[5]} for r in self.store.run(
                "SELECT code, role, used_by, expires_at, created_at, expires_at < now() FROM admin_invites ORDER BY id DESC LIMIT 30")]
        return {"ok": True, "admins": admins, "invites": invites, "me": me}
