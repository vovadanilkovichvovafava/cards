# Сервер сайта: отдаёт папку site/ без кеширования и принимает заказы.
#
#   POST /api/order  →  сообщение в Telegram через бота (+ фото, если есть)
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
import sys
import time
import urllib.request
import uuid

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


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def do_GET(self):
        # Текстовые файлы отдаём сжатыми (gzip) — так они грузятся в 3–4 раза быстрее
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            path = os.path.join(path, "index.html")
        if (path.endswith(COMPRESSIBLE) and os.path.isfile(path)
                and "gzip" in self.headers.get("Accept-Encoding", "")):
            body = gzip.compress(open(path, "rb").read())
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(path))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def reply(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/api/order":
            return self.reply(404, {"ok": False, "error": "not found"})

        # Ограничение частоты — защита от спама через форму
        ip = (self.headers.get("CF-Connecting-IP")
              or (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
              or self.client_address[0])
        now = time.time()
        recent = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
        if len(recent) >= RATE_LIMIT:
            return self.reply(429, {"ok": False, "error": "Слишком много заказов подряд, попробуй через минуту"})
        _hits[ip] = recent + [now]

        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_BODY:
            return self.reply(413, {"ok": False, "error": "Слишком большой заказ"})
        try:
            data = json.loads(self.rfile.read(length))
        except ValueError:
            return self.reply(400, {"ok": False, "error": "Некорректные данные"})

        name = clean(data.get("name"), 80)
        contact = clean(data.get("contact"), 120)
        comment = clean(data.get("comment"), 600)
        order = [clean(line, 300) for line in (data.get("lines") or [])][:12]
        if not contact or not order:
            return self.reply(400, {"ok": False, "error": "Укажи, как с тобой связаться"})

        env = load_env()
        token, chat = env.get("TELEGRAM_BOT_TOKEN"), env.get("TELEGRAM_CHAT_ID")
        if not token or not chat:
            return self.reply(503, {"ok": False, "error": "Приём заказов ещё не настроен"})

        text = "\n".join(
            ["🃏 Новый заказ с сайта", ""]
            + [l for l in order if l]
            + ["", f"👤 {name or 'без имени'}", f"📱 {contact}"]
            + ([f"💬 {comment}"] if comment else [])
        )
        try:
            tg_call(token, "sendMessage", {"chat_id": chat, "text": text})
            for i, photo in enumerate((data.get("photos") or [])[:MAX_PHOTOS]):
                raw = base64.b64decode(str(photo).split(",", 1)[-1], validate=False)
                tg_call(token, "sendPhoto", {"chat_id": chat, "caption": f"Фото {i + 1} к заказу от {contact}"},
                        {"photo": (f"photo{i + 1}.jpg", raw)})
        except Exception as e:  # сеть или ошибка Telegram — сайт покажет запасной вариант
            print("telegram error:", e, file=sys.stderr)
            return self.reply(502, {"ok": False, "error": "Не удалось отправить заказ"})
        return self.reply(200, {"ok": True})


handler = functools.partial(Handler, directory=os.path.join(ROOT, "site"))
http.server.ThreadingHTTPServer(("", PORT), handler).serve_forever()
