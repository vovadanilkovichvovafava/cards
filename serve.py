# Сервер сайта: отдаёт папку site/ без кеширования и принимает заказы.
#
#   POST /api/order  →  сообщение в Telegram через бота (+ фото, если есть)
#   GET  /, /catalog, /catalog/<коллекция>, /builder, /how, /about, /contacts, /privacy, /offer  →  страницы сайта
#        (общие шапка, подвал и окна подставляются из site/partials/)
#   GET  /catalog.js →  карточки, добавленные через бота (хранятся в DATABASE_URL)
#   GET  /assets/cards/[sm/]db/<id>-<a|b>.jpg  →  их кадры из базы
#   GET  /admin, /api/admin/*, POST /api/t  →  админка и запись сессий (см. admin.py)
#
# Токен бота и chat_id берутся из переменных окружения хостинга или из файла
# .env рядом с этим скриптом (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID). В папку
# site/ токен не попадает, поэтому посетители сайта его не видят.
# Порт: аргумент командной строки, переменная PORT или 8080.
import base64
import functools
import gzip
import http.server
import json
import os
import re
import sys
import time
import urllib.request
import posixpath
import urllib.parse
import uuid

from admin import Admin
from catalog_bot import Bot, Store, image_type
from reviews import PER_IP_DAY, Reviews, card_buttons, card_text

# Кадры из бота приходят тяжёлыми PNG (~1 МБ). Отдаём их сжатыми JPEG: полный — 780 px, маленький — 400 px.
# Без Pillow (не поставился) отдаём как есть.
IMAGE_ERR = ""
try:
    from PIL import Image
except Exception as e:
    Image, IMAGE_ERR = None, f"{type(e).__name__}: {e}"[:200]
SHRUNK = {}


def shrink(key, data, width):
    if Image is None:
        return data
    if key in SHRUNK:
        return SHRUNK[key]
    try:
        import io
        im = Image.open(io.BytesIO(data))
        im = im.convert("RGB")
        if im.width > width:
            im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, "JPEG", quality=84, optimize=True, progressive=True)
        small = out.getvalue()
        data = small if len(small) < len(data) else data
    except Exception as e:
        print("shrink error:", e, file=sys.stderr)
    if len(SHRUNK) > 400:
        SHRUNK.clear()
    SHRUNK[key] = data
    return data

PORT = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", 8080))
ROOT = os.path.dirname(os.path.abspath(__file__))
MAX_BODY = 12 * 1024 * 1024   # до ~12 МБ: текст + пара сжатых фото
MAX_PHOTOS = 2
RATE_WINDOW, RATE_LIMIT = 60, 5  # не больше 5 заказов в минуту с одного IP
_hits = {}


def load_env():
    # Переменные окружения хостинга; файл .env (если есть) их дополняет
    env = {k: v for k, v in os.environ.items() if k.startswith("TELEGRAM_")}
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.strip().split("=", 1)
                env[k] = v
    return env


def tg_call(token, method, fields, files=None):
    """Вызов Bot API. files: {"photo": (имя, bytes)} — отправка multipart."""
    url = f"https://api.telegram.org/bot{token}/{method}"
    if files:
        boundary = uuid.uuid4().hex
        body = b""
        for k, v in fields.items():
            body += f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        for k, (name, data) in files.items():
            body += (f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"; filename="{name}"\r\n'
                     f"Content-Type: image/jpeg\r\n\r\n").encode() + data + b"\r\n"
        body += f"--{boundary}--\r\n".encode()
        req = urllib.request.Request(url, body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
    else:
        req = urllib.request.Request(url, json.dumps(fields).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def clean(value, limit):
    return str(value or "").strip()[:limit]


COMPRESSIBLE = (".html", ".css", ".js", ".json", ".svg")
DB_IMAGE = re.compile(r"^/assets/cards/(sm/)?db/(\d+)-([ab])\.jpg$")
DB_BACK = re.compile(r"^/assets/collections/(\d+)\.jpg$")
SITE = os.path.join(ROOT, "site")
# Красивые адреса страниц → файлы
PAGES = {"/": "index.html", "/catalog": "catalog.html", "/builder": "builder.html",
         "/about": "about.html", "/how": "how.html",
         "/contacts": "contacts.html", "/privacy": "privacy.html", "/offer": "offer.html", "/reviews": "reviews.html"}
COLLECTION = re.compile(r"^/catalog/[a-z0-9-]+/?$")
INCLUDE = re.compile(r"<!--#include ([a-z]+)-->")


def render_page(name):  # noqa: D401
    """Страница с подставленными общими кусками (шапка, подвал, окна)."""
    html = open(os.path.join(SITE, name), encoding="utf-8").read()
    return INCLUDE.sub(lambda m: open(os.path.join(SITE, "partials", m[1] + ".html"), encoding="utf-8").read(), html)

# База нужна только для карточек из бота; без неё сайт и заказы работают как раньше
STORE = Store(os.environ["DATABASE_URL"]) if os.environ.get("DATABASE_URL") else None
ADMIN = Admin(STORE) if STORE else None
REVIEWS = Reviews(STORE) if STORE else None
_review_hits = {}
# Страница админки: картинки и стили записанных сессий — только со своего сервера и Google Fonts,
# чтобы подделанная запись не могла ничего загрузить с чужого сайта
ADMIN_CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
             "font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self'; "
             "connect-src 'self'; frame-src 'self' about: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; "
             "frame-ancestors 'none'")


def extra_collections():
    if not STORE:
        return []
    try:
        return [{"id": c["id"], "name": c["name"], "back": f"assets/collections/{c['num']}.jpg?v=3"} for c in STORE.collections()]
    except Exception as e:
        print("db error:", e, file=sys.stderr)
        return []


def extra_cards():
    if not STORE:
        return []
    try:
        return STORE.cards()
    except Exception as e:  # база недоступна — показываем только карточки из data.js
        print("db error:", e, file=sys.stderr)
        return []


class Handler(http.server.SimpleHTTPRequestHandler):
    cache_forever = False
    timeout = 20  # медленные/недосланные запросы не держат поток вечно

    def list_directory(self, path):  # списки файлов папок не показываем
        self.send_404()
        return None

    def send_404(self):
        # Своя страница «не найдено» в стиле сайта
        try:
            body = render_page("404.html").encode()
        except Exception:
            body = b"Not found"
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self._head = True
        try:
            self.do_GET()
        finally:
            self._head = False

    def end_headers(self):
        # Кадры из базы не меняются (новая версия — новый id), их можно кешировать навсегда
        self.send_header("Cache-Control", "public, max-age=31536000, immutable" if self.cache_forever
                         else "no-store, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def client_ip(self):
        # IP берём только из заголовка нашего прокси (Cloudflare/Сатурн ставят реальный адрес последним
        # в X-Forwarded-For), подделанные значения слева не помогают обойти лимиты.
        fwd = [x.strip() for x in (self.headers.get("X-Forwarded-For") or "").split(",") if x.strip()]
        return fwd[-1] if fwd else self.client_address[0]

    def read_body(self, limit):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if not 0 < length <= limit:
            return None
        return self.rfile.read(length)

    def admin_api(self, method, path_only, query, body=None):
        if not ADMIN:
            return self.reply(503, {"ok": False, "error": "Админке нужна база данных (DATABASE_URL)"})
        try:
            res = ADMIN.api(self, method, path_only[len("/api/admin"):], query, body)
        except Exception as e:
            print("admin error:", repr(e), file=sys.stderr)
            return self.reply(500, {"ok": False, "error": "Ошибка сервера"})
        code, payload = res[0], res[1]
        ctype, headers = (res[2], res[4]) if len(res) > 2 else (None, {})
        body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype or "application/json; charset=utf-8")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self):
        # Проверка здоровья для хостинга: сервер жив — отвечаем 200
        self.cache_forever = False  # один обработчик может отвечать на несколько запросов подряд
        # Нормализуем путь: «..», «%2e», двойные слэши — ничего за пределы site/ не отдаём
        path_only = posixpath.normpath(urllib.parse.unquote(self.path.split("?", 1)[0].split("#", 1)[0]))
        if not path_only.startswith("/"):
            path_only = "/" + path_only
        if path_only != "/" and self.path.split("?", 1)[0].endswith("/"):
            path_only = path_only.rstrip("/")
        if "/partials" in path_only or "/." in path_only:
            return self.send_404()
        if path_only == "/health":
            db = None
            if STORE:
                try:
                    db = len(STORE.cards())  # сколько карточек добавлено через бота
                except Exception as e:
                    db = f"error: {type(e).__name__}"
            return self.reply(200, {"ok": True, "db": db, "py": sys.version.split()[0],
                                    "img": "ok" if Image else (IMAGE_ERR or "no pillow")})
        if path_only.startswith("/api/admin/"):
            return self.admin_api("GET", path_only, self.path.partition("?")[2])
        if path_only == "/api/reviews":
            if not REVIEWS:
                return self.reply(200, {"ok": True, "items": [], "total": 0, "avg": None})
            q = urllib.parse.parse_qs(self.path.partition("?")[2])
            num = lambda k, d, hi: max(0, min(hi, int(q[k][0]) if q.get(k, [""])[0].isdigit() else d))
            try:
                return self.reply(200, {"ok": True, **REVIEWS.public(num("limit", 10, 30), num("offset", 0, 100000))})
            except Exception as e:
                print("reviews error:", repr(e), file=sys.stderr)
                return self.reply(500, {"ok": False, "error": "Не удалось загрузить отзывы"})
        if path_only in ("/admin", "/admin.html"):
            body = open(os.path.join(SITE, "admin.html"), "rb").read()
            if "gzip" in self.headers.get("Accept-Encoding", ""):
                body = gzip.compress(body)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            if body[:2] == b"\x1f\x8b":
                self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Security-Policy", ADMIN_CSP)
            self.send_header("X-Robots-Tag", "noindex, nofollow")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        if path_only == "/catalog.js":
            body = ("window.EXTRA_UNIVERSES = " + json.dumps(extra_collections(), ensure_ascii=False) + ";\n"
                    "window.EXTRA_CARDS = " + json.dumps(extra_cards(), ensure_ascii=False) + ";\n").encode()
            return self.send_body(200, "application/javascript; charset=utf-8", body)
        # Страницы цен больше нет — старые ссылки ведут на «Как это работает»
        if path_only.rstrip("/") in ("/prices", "/prices.html"):
            self.send_response(301)
            self.send_header("Location", "/how")
            self.end_headers()
            return
        page = PAGES.get(path_only.rstrip("/") or "/") or ("collection.html" if COLLECTION.match(path_only.lower()) else None)
        if page is None and path_only.endswith(".html"):
            name = path_only.lstrip("/")
            if "/" not in name and os.path.isfile(os.path.join(SITE, name)) and name not in ("404.html", "admin.html"):
                page = name
        if page:
            return self.send_text(render_page(page).encode(), "text/html; charset=utf-8")
        mb = DB_BACK.match(path_only)
        if mb:
            data = None
            try:
                data = STORE and STORE.collection_back(int(mb[1]))
            except Exception as e:
                print("db error:", e, file=sys.stderr)
            if not data:
                return self.reply(404, {"ok": False, "error": "not found"})
            data = shrink(("back", mb[1]), data, 780)
            self.cache_forever = True
            return self.send_body(200, image_type(data), data)
        m = DB_IMAGE.match(path_only)
        if m:
            data = None
            try:
                data = STORE and STORE.image(int(m[2]), m[3], bool(m[1]))
            except Exception as e:
                print("db error:", e, file=sys.stderr)
            if not data:
                return self.reply(404, {"ok": False, "error": "not found"})
            data = shrink((m[2], m[3], bool(m[1])), data, 400 if m[1] else 780)
            self.cache_forever = True
            return self.send_body(200, image_type(data), data)
        # Текстовые файлы отдаём сжатыми (gzip) — так они грузятся в 3–4 раза быстрее
        path = os.path.realpath(os.path.join(SITE, path_only.lstrip("/")))
        if not path.startswith(os.path.realpath(SITE) + os.sep) or not os.path.isfile(path):
            return self.send_404()
        if path.endswith(".html"):  # страницы — только через PAGES (с подстановкой шапки)
            return self.send_404()
        if path.endswith(COMPRESSIBLE) and "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(open(path, "rb").read())
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        self.path = path_only
        super().do_GET() if self.command != "HEAD" else super().do_HEAD()

    def send_text(self, body, ctype):
        # Сжимаем, если браузер умеет
        if "gzip" in self.headers.get("Accept-Encoding", ""):
            body = gzip.compress(body)
            self.send_response(200)
            self.send_header("Content-Encoding", "gzip")
        else:
            self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_body(self, code, ctype, body):
        if self.command == "HEAD":
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def reply(self, code, payload):
        self.send_body(code, "application/json; charset=utf-8", json.dumps(payload, ensure_ascii=False).encode())

    def do_POST(self):
        path_only, _, query = self.path.partition("?")
        if path_only == "/api/t":  # запись сессии с сайта
            body = self.read_body(2 * 1024 * 1024)
            if body is None:
                return self.reply(413, {"ok": False})
            if not ADMIN:
                return self.reply(200, {"ok": True})
            try:
                code, payload = ADMIN.ingest(self, self.client_ip(), body)
            except Exception as e:
                print("ingest error:", repr(e), file=sys.stderr)
                code, payload = 500, {"ok": False}
            return self.reply(code, payload)
        if path_only.startswith("/api/admin/"):
            body = self.read_body(64 * 1024)
            return self.admin_api("POST", path_only, query, body or b"{}")
        if path_only == "/api/reviews":
            return self.post_review()
        if self.path != "/api/order":
            return self.reply(404, {"ok": False, "error": "not found"})

        # Ограничение частоты (см. client_ip)
        ip = self.client_ip()
        now = time.time()
        for k in [k for k, v in _hits.items() if not v or now - v[-1] > RATE_WINDOW]:
            _hits.pop(k, None)  # память не растёт
        recent = _hits.get(ip, [])
        if len(recent) >= RATE_LIMIT:
            return self.reply(429, {"ok": False, "error": "Слишком много заказов подряд, попробуй через минуту"})

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if not 0 < length <= MAX_BODY:
            return self.reply(413, {"ok": False, "error": "Слишком большой заказ"})
        try:
            data = json.loads(self.rfile.read(length))
        except (ValueError, RecursionError):
            return self.reply(400, {"ok": False, "error": "Некорректные данные"})
        if not isinstance(data, dict):
            return self.reply(400, {"ok": False, "error": "Некорректные данные"})
        lines = data.get("lines")
        photos_in = data.get("photos") or []
        if not isinstance(lines, list) or not isinstance(photos_in, list):
            return self.reply(400, {"ok": False, "error": "Некорректные данные"})

        name = clean(data.get("name"), 80)
        contact = clean(data.get("contact"), 120)
        comment = clean(data.get("comment"), 600)
        order = [clean(line, 300) for line in lines if isinstance(line, str)][:30]
        if not contact or not order:
            return self.reply(400, {"ok": False, "error": "Укажи, как с тобой связаться"})

        # Фото проверяем заранее: битое фото не должно ломать заказ на полпути
        photos = []
        for photo in photos_in[:MAX_PHOTOS]:
            try:
                raw = base64.b64decode(str(photo).split(",", 1)[-1], validate=True)
            except Exception:
                continue
            if raw[:3] == b"\xff\xd8\xff" and len(raw) > 1000:
                photos.append(raw)

        env = load_env()
        token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
        if not token or not chat:
            return self.reply(503, {"ok": False, "error": "Приём заказов ещё не настроен"})
        _hits[ip] = recent + [now]  # считаем только принятые заказы

        text = "\n".join(
            ["🃏 Новый заказ с сайта", ""]
            + [l for l in order if l]
            + ["", f"👤 {name or 'без имени'}", f"📱 {contact}"]
            + ([f"💬 {comment}"] if comment else [])
            + ([f"📷 Фото: {len(photos)}"] if photos else [])
        )
        try:
            tg_call(token, "sendMessage", {"chat_id": chat, "text": text})
        except Exception as e:  # сеть или ошибка Telegram — сайт покажет запасной вариант
            print("telegram error:", e, file=sys.stderr)
            return self.reply(502, {"ok": False, "error": "Не удалось отправить заказ"})
        # Заказ уже у нас: ошибка с фото не повод просить покупателя отправить всё ещё раз
        for i, raw in enumerate(photos):
            try:
                tg_call(token, "sendPhoto", {"chat_id": chat, "caption": f"Фото {i + 1} к заказу от {contact}"},
                        {"photo": (f"photo{i + 1}.jpg", raw)})
            except Exception as e:
                print("telegram photo error:", e, file=sys.stderr)
                try:
                    tg_call(token, "sendMessage", {"chat_id": chat, "text": f"⚠️ Фото {i + 1} к заказу от {contact} не дошло — попроси его в чате."})
                except Exception:
                    pass
        if ADMIN:  # копия заказа — в админку, со ссылкой на запись сессии
            try:
                ADMIN.save_order(clean(data.get("sid"), 40), name, contact, comment, order, clean(data.get("total"), 40), len(photos))
            except Exception as e:
                print("admin order error:", repr(e), file=sys.stderr)
        return self.reply(200, {"ok": True})

    def post_review(self):
        if not REVIEWS:
            return self.reply(503, {"ok": False, "error": "Отзывы временно не принимаются"})
        body = self.read_body(16 * 1024)
        try:
            data = json.loads(body or b"")
        except (ValueError, RecursionError):
            data = None
        if not isinstance(data, dict):
            return self.reply(400, {"ok": False, "error": "Некорректные данные"})
        if data.get("website"):  # невидимое поле: его заполняют только боты
            return self.reply(200, {"ok": True, "status": "published"})
        name = " ".join(clean(data.get("name"), 40).split())
        text = clean(data.get("text"), 1000)
        try:
            rating = int(data.get("rating"))
        except (TypeError, ValueError):
            rating = 0
        if len(name) < 2:
            return self.reply(400, {"ok": False, "error": "Напиши, как тебя зовут"})
        if not 1 <= rating <= 5:
            return self.reply(400, {"ok": False, "error": "Поставь оценку от 1 до 5 звёзд"})
        if len(text) < 10:
            return self.reply(400, {"ok": False, "error": "Отзыв слишком короткий — напиши хотя бы пару слов"})
        ip, now = self.client_ip(), time.time()
        for k in [k for k, v in _review_hits.items() if not v or now - v[-1] > 600]:
            _review_hits.pop(k, None)
        recent = [t for t in _review_hits.get(ip, []) if now - t < 600]
        try:
            if len(recent) >= 2 or REVIEWS.recent_from(ip) >= PER_IP_DAY:
                return self.reply(429, {"ok": False, "error": "Ты уже оставил отзывы сегодня — спасибо! Попробуй завтра"})
            rid, status = REVIEWS.add(name, rating, text, "en" if data.get("lang") == "en" else "ru", ip)
        except Exception as e:
            print("reviews error:", repr(e), file=sys.stderr)
            return self.reply(500, {"ok": False, "error": "Не удалось сохранить отзыв"})
        _review_hits[ip] = recent + [now]
        # Уведомление Владу; не дошло — отзыв всё равно сохранён, его видно в боте по /reviews
        env = load_env()
        token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
        if token and chat:
            try:
                r = REVIEWS.get(rid)
                res = tg_call(token, "sendMessage", {"chat_id": chat, "text": card_text(r, os.environ.get("SITE_URL", "").rstrip("/")),
                                                     "disable_web_page_preview": True, "reply_markup": {"inline_keyboard": card_buttons(r)}})
                REVIEWS.link_msg(res["result"]["message_id"], rid)
            except Exception as e:
                print("telegram review error:", repr(e), file=sys.stderr)
        return self.reply(200, {"ok": True, "status": status})


_env = load_env()
if STORE and _env.get("TELEGRAM_BOT_TOKEN") and _env.get("TELEGRAM_CHAT_ID") and os.environ.get("BOT_POLLING", "1") != "0":
    Bot(_env["TELEGRAM_BOT_TOKEN"], _env["TELEGRAM_CHAT_ID"], STORE, os.environ.get("SITE_URL", ""), REVIEWS).start()

handler = functools.partial(Handler, directory=SITE)
http.server.ThreadingHTTPServer(("", PORT), handler).serve_forever()
