# Карточки, которые Влад добавляет через бота, и сам диалог с ботом.
#
#   Влад шлёт боту два кадра карточки → выбирает коллекцию кнопкой → пишет имя
#   персонажа → выбирает версию. Карточка сохраняется в базе (DATABASE_URL) и
#   сразу появляется на сайте в нужной коллекции.
#
#   /collection (или слово «коллекция») — новая коллекция: название → рубашка →
#   дальше можно сразу слать карточки, они попадают в эту коллекцию.
#
# Добавлять и удалять карточки может только чат заказов (TELEGRAM_CHAT_ID).
#
# Переписка с покупателями идёт через бота: всё, что покупатель пишет боту,
# бот пересылает Владу; Влад отвечает «ответом» (reply) на пересланное
# сообщение — и бот отправляет ответ покупателю. Ник Влада покупатели не видят.
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
        self.conn.run("""
            CREATE TABLE IF NOT EXISTS relay (
                admin_msg BIGINT PRIMARY KEY,
                user_chat BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )""")
        self.conn.run("""
            CREATE TABLE IF NOT EXISTS collections (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                back BYTEA NOT NULL,
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

    # --- переписка с покупателями: какое пересланное сообщение от какого покупателя ---
    def relay_put(self, admin_msg, user_chat):
        self.run("INSERT INTO relay (admin_msg, user_chat) VALUES (:m, :c) ON CONFLICT (admin_msg) DO NOTHING", m=admin_msg, c=user_chat)

    def relay_get(self, admin_msg):
        rows = self.run("SELECT user_chat FROM relay WHERE admin_msg = :m", m=admin_msg)
        return rows[0][0] if rows else None

    # --- коллекции из бота: id на сайте — «c<номер>» ---
    def collections(self):
        rows = self.run("SELECT id, name FROM collections ORDER BY id")
        return [{"id": f"c{r[0]}", "num": r[0], "name": r[1]} for r in rows]

    def collection_back(self, num):
        rows = self.run("SELECT back FROM collections WHERE id = :id", id=num)
        return bytes(rows[0][0]) if rows else None

    def add_collection(self, name, back):
        return self.run("INSERT INTO collections (name, back) VALUES (:n, :b) RETURNING id", n=name, b=back)[0][0]

    def delete_collection(self, num):
        self.run("DELETE FROM cards WHERE universe = :u", u=f"c{num}")
        return self.run("DELETE FROM collections WHERE id = :id RETURNING name", id=num)


def universes(store=None):
    """Коллекции из site/data.js плюс созданные через бота."""
    src = open(os.path.join(ROOT, "site", "data.js"), encoding="utf-8").read()
    block = src.split("window.UNIVERSES", 1)[1].split("window.CHARACTERS", 1)[0]
    found = re.findall(r'id:\s*"([^"]+)",\s*name:\s*"([^"]+)"', block)
    if store:
        try:
            found += [(c["id"], c["name"]) for c in store.collections()]
        except Exception as e:
            print("bot: collections unavailable:", e, file=sys.stderr)
    return found


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
        self.into = {}   # chat_id → (id, название) коллекции, куда сейчас добавляются карточки
        self.greeted = {}  # покупателям «передали» пишем один раз за запуск

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
            return self.on_customer(chat, msg, text)
        # Влад ответил (reply) на пересланное сообщение покупателя — отправляем ответ покупателю
        rep_to = (msg.get("reply_to_message") or {}).get("message_id")
        if rep_to:
            user = self.store.relay_get(rep_to)
            if user:
                try:
                    self.api("copyMessage", chat_id=user, from_chat_id=chat, message_id=msg["message_id"])
                    return self.api("setMessageReaction", chat_id=chat, message_id=msg["message_id"],
                                    reaction=[{"type": "emoji", "emoji": "👍"}])
                except Exception as e:
                    return self.say(chat, f"Не получилось отправить ответ покупателю: {e}")
        self.on_admin(chat, msg, text)

    def on_customer(self, chat, msg, text):
        if text.startswith("/start") or text.startswith("/help"):
            link = f"\n\nКаталог и конструктор карточек: {self.site}" if self.site else ""
            return self.say(chat, "Привет! Это Aniverse Flip 🃏\nНапиши сюда вопрос или что хочешь заказать — "
                                  "мы ответим прямо в этом чате." + link)
        # Пересылаем Владу: шапка с именем покупателя + само сообщение (фото, голос — что угодно)
        u = msg.get("from") or {}
        who = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x) or "Покупатель"
        if u.get("username"):
            who += f" (@{u['username']})"
        try:
            head = self.say(self.admin, f"💬 {who} пишет в бота. Ответь на это или следующее сообщение (reply) — ответ уйдёт покупателю.")
            copy = self.api("copyMessage", chat_id=self.admin, from_chat_id=chat, message_id=msg["message_id"])
            self.store.relay_put(head["message_id"], int(chat))
            self.store.relay_put(copy["message_id"], int(chat))
        except Exception as e:
            print("bot relay error:", e, file=sys.stderr)
            return self.say(chat, "Не получилось передать сообщение, попробуй ещё раз чуть позже.")
        if not self.greeted.get(chat):
            self.greeted[chat] = True
            self.say(chat, "Передали — ответим здесь же, обычно в течение дня.")

    def on_admin(self, chat, msg, text):
        st = self.state.get(chat)
        if text in ("/start", "/help"):
            return self.say(chat, "Чтобы добавить карточку на сайт, пришли два кадра — как она выглядит прямо и после наклона. "
                                  "Можно одним альбомом. Дальше я спрошу коллекцию, имя и версию.\n\n"
                                  "/collection — новая коллекция (название, рубашка, потом карточки)\n"
                                  "/list — карточки и коллекции из бота (там же удаление)\n/cancel — отменить добавление")
        if text == "/cancel":
            self.state.pop(chat, None)
            self.into.pop(chat, None)
            return self.say(chat, "Отменил. Пришли два кадра, когда будешь готов.")
        if text.lower().lstrip("/") in ("collection", "коллекция", "новая коллекция"):
            self.state[chat] = {"step": "col_name"}
            return self.say(chat, "Новая коллекция. Как она называется? Например: Наруто")
        if st and st.get("step") == "col_name" and text and not text.startswith("/"):
            st.update(step="col_back", name=text[:40])
            return self.say(chat, f"Коллекция «{st['name']}». Теперь пришли рубашку карточек — она станет обложкой коллекции на сайте.")
        if st and st.get("step") == "col_back":
            pic = self.pick(msg)
            if not pic:
                return self.say(chat, "Пришли рубашку картинкой. Или /cancel.")
            return self.save_collection(chat, st, pic)
        if text == "/list":
            return self.show_list(chat)

        pic = self.pick(msg)
        if pic:
            if not st or st.get("step") not in ("a", "b"):
                self.state[chat] = {"step": "b", "a": pic}
                return self.say(chat, "Первый кадр есть. Пришли второй — как карточка выглядит после наклона.")
            if st["step"] == "b" and self.into.get(chat):
                uid, uname = self.into[chat]
                st.update(step="name", b=pic, universe=uid)
                return self.say(chat, f"Оба кадра есть, карточка пойдёт в коллекцию «{uname}». Как зовут персонажа?")
            if st["step"] == "b":
                st.update(step="universe", b=pic)
                rows = [[{"text": name, "callback_data": f"u:{uid}"}] for uid, name in universes(self.store)]
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
            return self.say(chat, f"Коллекция: {dict(universes(self.store)).get(value, value)}. Как зовут персонажа? Например: Гатс")
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
        if kind == "done":
            self.into.pop(chat, None)
            return self.say(chat, "Коллекция готова. Новые карточки снова попросят выбрать коллекцию.")
        if kind == "cdel":
            name = {str(c["num"]): c["name"] for c in self.store.collections()}.get(value)
            if not name:
                return self.say(chat, "Этой коллекции уже нет.")
            return self.say(chat, f"Удалить коллекцию «{name}» вместе со всеми её карточками?",
                            [[{"text": "Да, удалить", "callback_data": f"cdel!:{value}"}, {"text": "Нет", "callback_data": "no:"}]])
        if kind == "cdel!":
            rows = self.store.delete_collection(int(value))
            if self.into.get(chat, ("",))[0] == f"c{value}":
                self.into.pop(chat, None)
            return self.say(chat, f"Удалил коллекцию «{rows[0][0]}»." if rows else "Этой коллекции уже нет.")
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
        uni = dict(universes(self.store)).get(st["universe"], st["universe"])
        link = f"\n{self.site}/catalog/{st['universe']}" if self.site else ""
        buttons = [[{"text": "Удалить эту карточку", "callback_data": f"del:{card_id}"}]]
        more = ""
        if self.into.get(chat):
            more = "\n\nПришли следующие два кадра — карточка тоже попадёт в эту коллекцию."
            buttons.append([{"text": "Закончить коллекцию", "callback_data": "done:"}])
        self.say(chat, f"Готово! {st['name']} ({RARITY[rarity].lower()}) теперь в коллекции «{uni}»." + link + more, buttons)

    def save_collection(self, chat, st, pic):
        self.say(chat, "Создаю коллекцию…")
        try:
            back = self.download(pic[0])
            num = self.store.add_collection(st["name"], back)
        except Exception as e:
            print("bot collection error:", e, file=sys.stderr)
            return self.say(chat, f"Не получилось сохранить: {e}. Пришли рубашку ещё раз.")
        self.state.pop(chat, None)
        self.into[chat] = (f"c{num}", st["name"])
        link = f"\n{self.site}/catalog/c{num}" if self.site else ""
        self.say(chat, f"Коллекция «{st['name']}» создана и уже на сайте." + link +
                 "\n\nТеперь присылай карточки этой коллекции: по два кадра на карточку (прямо и после наклона).",
                 [[{"text": "Закончить коллекцию", "callback_data": "done:"}],
                  [{"text": "Удалить коллекцию", "callback_data": f"cdel:{num}"}]])

    def show_list(self, chat):
        cols = self.store.collections()
        if cols:
            self.say(chat, f"Коллекции из бота: {len(cols)}. Нажми, чтобы удалить (вместе с карточками):",
                     [[{"text": f"✕ {c['name']}", "callback_data": f"cdel:{c['num']}"}] for c in cols])
        cards = self.store.cards()
        if not cards:
            return self.say(chat, "Через бота карточек пока не добавляли. Пришли два кадра, чтобы добавить первую.")
        names = dict(universes(self.store))
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
