# Сервер сайта: отдаёт папку site/ без кеширования и принимает заказы.
#
#   POST /api/order  →  сообщение в Telegram через бота (+ фото, если есть)
#   GET  /, /catalog, /catalog/<коллекция>, /builder, /how, /about, /contacts, /privacy, /offer  →  страницы сайта
#        (общие шапка, подвал и окна подставляются из site/partials/)
#   GET  /catalog.js →  карточки, добавленные через бота (хранятся в DATABASE_URL)
#   GET  /assets/cards/[sm/]db/<id>-<a|b>.jpg  →  их кадры из базы
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

from catalog_bot import Bot, Store, image_type

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
         "/contacts": "contacts.html", "/privacy": "privacy.html", "/offer": "offer.html"}
COLLECTION = re.compile(r"^/catalog/[a-z0-9-]+/?$")
INCLUDE = re.compile(r"<!--#include ([a-z]+)-->")


def render_page(name):  # noqa: D401
    """Страница с подставленными общими кусками (шапка, подвал, окна)."""
    html = open(os.path.join(SITE, name), encoding="utf-8").read()
    return INCLUDE.sub(lambda m: open(os.path.join(SITE, "partials", m[1] + ".html"), encoding="utf-8").read(), html)

# База нужна только для карточек из бота; без неё сайт и заказы работают как раньше
STORE = Store(os.environ["DATABASE_URL"]) if os.environ.get("DATABASE_URL") else None


def extra_collections():
    if not STORE:
        return []
    try:
        return [{"id": c["id"], "name": c["name"], "back": f"assets/collections/{c['num']}.jpg"} for c in STORE.collections()]
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
            return self.reply(200, {"ok": True, "db": db})
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
            if "/" not in name and os.path.isfile(os.path.join(SITE, name)) and name != "404.html":
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
        if self.path != "/api/order":
            return self.reply(404, {"ok": False, "error": "not found"})

        # Ограничение частоты. IP берём только из заголовка нашего прокси (Cloudflare/Сатурн ставят
        # реальный адрес последним в X-Forwarded-For), подделанные значения слева не помогают обойти лимит.
        fwd = [x.strip() for x in (self.headers.get("X-Forwarded-For") or "").split(",") if x.strip()]
        ip = fwd[-1] if fwd else self.client_address[0]
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
        return self.reply(200, {"ok": True})


_env = load_env()
if STORE and _env.get("TELEGRAM_BOT_TOKEN") and _env.get("TELEGRAM_CHAT_ID") and os.environ.get("BOT_POLLING", "1") != "0":
    Bot(_env["TELEGRAM_BOT_TOKEN"], _env["TELEGRAM_CHAT_ID"], STORE, os.environ.get("SITE_URL", "")).start()

handler = functools.partial(Handler, directory=SITE)
http.server.ThreadingHTTPServer(("", PORT), handler).serve_forever()
