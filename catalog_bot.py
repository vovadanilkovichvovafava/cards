# Карточки, которые Влад добавляет через бота, и сам диалог с ботом.
#
#   Влад шлёт боту два кадра карточки → выбирает коллекцию кнопкой → пишет имя
#   персонажа → выбирает версию. Карточка сохраняется в базе (DATABASE_URL) и
#   сразу появляется на сайте в нужной коллекции.
#
# Добавлять и удалять карточки может только чат заказов (TELEGRAM_CHAT_ID).
# Остальным бот на /start отвечает, как сделать заказ.
import json
import os
import re
import ssl
import sys
import threading
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
RARITY = {"common": "Обычная", "special": "Особая"}
MAX_IMAGE = 8 * 1024 * 1024


# ---------------------------------------------------------------
#  База
# ---------------------------------------------------------------
class Store:
    def __init__(self, url):
        self.url = url
        self.conn = None
        self.lock = threading.Lock()

    def _connect(self):
        import pg8000.native
        u = urllib.parse.urlparse(self.url)
        q = urllib.parse.parse_qs(u.query)
        ctx = None
        if q.get("sslmode", [""])[0] in ("require", "verify-ca", "verify-full"):
            ctx = ssl.create_default_context()
            if q["sslmode"][0] == "require":
                ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
        self.conn = pg8000.native.Connection(
            user=urllib.parse.unquote(u.username or ""), password=urllib.parse.unquote(u.password or ""),
            host=u.hostname, port=u.port or 5432, database=u.path.lstrip("/") or None,
            ssl_context=ctx, timeout=20)
        self.conn.run("""
            CREATE TABLE IF NOT EXISTS cards (
                id SERIAL PRIMARY KEY,
                universe TEXT NOT NULL,
                name TEXT NOT NULL,
                rarity TEXT NOT NULL,
                img_a BYTEA NOT NULL, img_b BYTEA NOT NULL,
                sm_a BYTEA NOT NULL, sm_b BYTEA NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")

    def run(self, sql, **params):
        # Одно соединение на весь сервер; при обрыве — переподключаемся один раз
        with self.lock:
            for attempt in (1, 2):
                try:
                    if self.conn is None:
                        self._connect()
                    return self.conn.run(sql, **params)
                except Exception:
                    self.conn = None
                    if attempt == 2:
                        raise

    def try_lead(self):
        """Только одна копия сервера опрашивает бота (иначе Telegram отвечает 409).
        Блокировка держится, пока живо соединение, и сама снимается, когда копия гаснет."""
        return bool(self.run("SELECT pg_try_advisory_lock(7391001)")[0][0])

    def cards(self):
        rows = self.run("SELECT id, universe, name, rarity FROM cards ORDER BY id")
        return [{"id": r[0], "universe": r[1], "name": r[2], "rarity": r[3]} for r in rows]

    def image(self, card_id, side, small):
        col = ("sm_" if small else "img_") + side
        rows = self.run(f"SELECT {col} FROM cards WHERE id = :id", id=card_id)
        return bytes(rows[0][0]) if rows else None

    def add(self, universe, name, rarity, a, b, sm_a, sm_b):
        # Та же карточка (персонаж + версия) заменяется новой, а не дублируется
        self.run("DELETE FROM cards WHERE universe = :u AND lower(name) = lower(:n) AND rarity = :r",
                 u=universe, n=name, r=rarity)
        return self.run("""INSERT INTO cards (universe, name, rarity, img_a, img_b, sm_a, sm_b)
                           VALUES (:u, :n, :r, :a, :b, :sa, :sb) RETURNING id""",
                        u=universe, n=name, r=rarity, a=a, b=b, sa=sm_a, sb=sm_b)[0][0]

    def delete(self, card_id):
        return self.run("DELETE FROM cards WHERE id = :id RETURNING name", id=card_id)


def universes():
    """Коллекции берём из site/data.js, чтобы список был один на сайт и бота."""
    src = open(os.path.join(ROOT, "site", "data.js"), encoding="utf-8").read()
    block = src.split("window.UNIVERSES", 1)[1].split("window.CHARACTERS", 1)[0]
    return re.findall(r'id:\s*"([^"]+)",\s*name:\s*"([^"]+)"', block)


def image_type(data):
    return "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/webp" if data[8:12] == b"WEBP" else "image/jpeg"


# ---------------------------------------------------------------
#  Бот
# ---------------------------------------------------------------
class Bot:
    def __init__(self, token, admin_chat, store, site_url=""):
        self.token, self.admin, self.store = token, str(admin_chat), store
        self.site = site_url.rstrip("/")
        self.state = {}  # chat_id → черновик карточки

    def api(self, method, **fields):
        req = urllib.request.Request(f"https://api.telegram.org/bot{self.token}/{method}",
                                     json.dumps(fields).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=70) as r:
            return json.load(r)["result"]

    def say(self, chat, text, buttons=None):
        fields = {"chat_id": chat, "text": text, "disable_web_page_preview": True}
        if buttons:
            fields["reply_markup"] = {"inline_keyboard": buttons}
        return self.api("sendMessage", **fields)

    def download(self, file_id):
        path = self.api("getFile", file_id=file_id)["file_path"]
        with urllib.request.urlopen(f"https://api.telegram.org/file/bot{self.token}/{path}", timeout=60) as r:
            data = r.read(MAX_IMAGE + 1)
        if len(data) > MAX_IMAGE:
            raise ValueError("файл больше 8 МБ")
        return data

    @staticmethod
    def pick(msg):
        """(полный кадр, уменьшенный) из фото или из картинки, отправленной файлом."""
        if msg.get("photo"):
            sizes = sorted(msg["photo"], key=lambda p: p["width"])
            small = next((p for p in sizes if p["width"] >= 400), sizes[-1])
            return sizes[-1]["file_id"], small["file_id"]
        doc = msg.get("document") or {}
        if doc.get("mime_type", "").startswith("image/"):
            return doc["file_id"], doc["file_id"]
        return None

    # --- приём сообщений ---
    def handle(self, upd):
        if "callback_query" in upd:
            cb = upd["callback_query"]
            chat = str(cb["message"]["chat"]["id"])
            self.api("answerCallbackQuery", callback_query_id=cb["id"])
            if chat == self.admin:
                self.on_button(chat, cb["data"], cb["message"]["message_id"])
            return
        msg = upd.get("message")
        if not msg:
            return
        chat = str(msg["chat"]["id"])
        text = (msg.get("text") or "").strip()
        if chat != self.admin:
            if text.startswith("/start") or text.startswith("/help"):
                link = f"\n\nЗаказать карточку: {self.site}" if self.site else ""
                self.say(chat, "Привет! Это бот магазина Aniverse Flip — через него к нам приходят заказы с сайта. "
                               "Оформи карточку на сайте, и мы напишем тебе туда, куда укажешь." + link)
            return
        self.on_admin(chat, msg, text)

    def on_admin(self, chat, msg, text):
        st = self.state.get(chat)
        if text in ("/start", "/help"):
            return self.say(chat, "Чтобы добавить карточку на сайт, пришли два кадра — как она выглядит прямо и после наклона. "
                                  "Можно одним альбомом. Дальше я спрошу коллекцию, имя и версию.\n\n"
                                  "/list — карточки, добавленные через бота (там же удаление)\n/cancel — отменить добавление")
        if text == "/cancel":
            self.state.pop(chat, None)
            return self.say(chat, "Отменил. Пришли два кадра, когда будешь готов.")
        if text == "/list":
            return self.show_list(chat)

        pic = self.pick(msg)
        if pic:
            if not st or st.get("step") not in ("a", "b"):
                self.state[chat] = {"step": "b", "a": pic}
                return self.say(chat, "Первый кадр есть. Пришли второй — как карточка выглядит после наклона.")
            if st["step"] == "b":
                st.update(step="universe", b=pic)
                rows = [[{"text": name, "callback_data": f"u:{uid}"}] for uid, name in universes()]
                return self.say(chat, "Оба кадра есть. В какую коллекцию добавить?", rows)
        if st and st["step"] == "name" and text and not text.startswith("/"):
            st.update(step="rarity", name=text[:40])
            return self.say(chat, f"Персонаж: {st['name']}. Какая версия?",
                            [[{"text": label, "callback_data": f"r:{key}"} for key, label in RARITY.items()]])
        if st:
            hint = {"universe": "Выбери коллекцию кнопкой выше.", "name": "Напиши имя персонажа текстом.",
                    "rarity": "Выбери версию кнопкой выше."}.get(st["step"], "")
            return self.say(chat, f"{hint} Или /cancel, чтобы начать заново.")
        self.say(chat, "Чтобы добавить карточку на сайт, пришли два её кадра. Подсказка — /help")

    def on_button(self, chat, data, message_id):
        st = self.state.get(chat)
        kind, _, value = data.partition(":")
        if kind == "u" and st and st["step"] == "universe":
            st.update(step="name", universe=value)
            return self.say(chat, f"Коллекция: {dict(universes()).get(value, value)}. Как зовут персонажа? Например: Гатс")
        if kind == "r" and st and st["step"] == "rarity" and value in RARITY:
            return self.save(chat, st, value)
        if kind == "del":
            name = dict((str(c["id"]), c["name"]) for c in self.store.cards()).get(value)
            if not name:
                return self.say(chat, "Этой карточки уже нет.")
            return self.say(chat, f"Удалить «{name}» с сайта?",
                            [[{"text": "Да, удалить", "callback_data": f"del!:{value}"}, {"text": "Нет", "callback_data": "no:"}]])
        if kind == "del!":
            rows = self.store.delete(int(value))
            return self.say(chat, f"Удалил «{rows[0][0]}» с сайта." if rows else "Этой карточки уже нет.")
        if kind == "no":
            return self.say(chat, "Оставил как есть.")
        self.say(chat, "Эта кнопка уже не работает. Пришли два кадра, чтобы добавить карточку.")

    def save(self, chat, st, rarity):
        self.say(chat, "Загружаю на сайт…")
        try:
            a, b = self.download(st["a"][0]), self.download(st["b"][0])
            sm_a = a if st["a"][1] == st["a"][0] else self.download(st["a"][1])
            sm_b = b if st["b"][1] == st["b"][0] else self.download(st["b"][1])
            card_id = self.store.add(st["universe"], st["name"], rarity, a, b, sm_a, sm_b)
        except Exception as e:
            print("bot save error:", e, file=sys.stderr)
            return self.say(chat, f"Не получилось сохранить: {e}. Попробуй выбрать версию ещё раз.",
                            [[{"text": label, "callback_data": f"r:{key}"} for key, label in RARITY.items()]])
        self.state.pop(chat, None)
        uni = dict(universes()).get(st["universe"], st["universe"])
        link = f"\n{self.site}/catalog/{st['universe']}" if self.site else ""
        self.say(chat, f"Готово! {st['name']} ({RARITY[rarity].lower()}) теперь в коллекции «{uni}»." + link,
                 [[{"text": "Удалить эту карточку", "callback_data": f"del:{card_id}"}]])

    def show_list(self, chat):
        cards = self.store.cards()
        if not cards:
            return self.say(chat, "Через бота карточек пока не добавляли. Пришли два кадра, чтобы добавить первую.")
        names = dict(universes())
        rows = [[{"text": f"✕ {c['name']}, {RARITY.get(c['rarity'], '').lower()} — {names.get(c['universe'], c['universe'])}",
                  "callback_data": f"del:{c['id']}"}] for c in cards[-40:]]
        self.say(chat, f"Карточки из бота: {len(cards)}. Нажми, чтобы удалить:", rows)

    # --- опрос Telegram в фоне ---
    def loop(self):
        offset = 0
        try:
            self.api("deleteWebhook")  # иначе getUpdates не работает
        except Exception as e:
            print("bot: deleteWebhook failed:", e, file=sys.stderr)
        # Отдельное соединение под блокировку: обычные запросы её не трогают
        leader = Store(self.store.url)
        waiting = False
        while True:
            try:
                if not leader.try_lead():
                    if not waiting:
                        print("bot: another server instance is polling, waiting", file=sys.stderr)
                    waiting = True
                    time.sleep(15)
                    continue
                if waiting:
                    print("bot: now polling", file=sys.stderr)
                waiting = False
                for upd in self.api("getUpdates", offset=offset, timeout=50, allowed_updates=["message", "callback_query"]):
                    offset = upd["update_id"] + 1
                    try:
                        self.handle(upd)
                    except Exception as e:
                        print("bot: update failed:", e, file=sys.stderr)
            except Exception as e:
                print("bot: polling error:", e, file=sys.stderr)
                time.sleep(5)

    def start(self):
        threading.Thread(target=self.loop, daemon=True).start()
