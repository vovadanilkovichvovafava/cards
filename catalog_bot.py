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
RARITY = {"common": "Обычная", "special": "Особая", "bonus": "Бонус"}
# Постоянная клавиатура внизу чата заказов: кнопка = команда, печатать ничего не нужно
ADMIN_KEYS = [["📚 Коллекции", "➕ Новая коллекция"],
              ["🗂 Карточки из бота", "📝 Описание героя"],
              ["⭐ Отзывы", "🔑 Пригласить в админку"],
              ["❓ Помощь", "✖️ Отмена"]]
KEY_COMMANDS = {"📚 Коллекции": "/collections", "➕ Новая коллекция": "/collection", "🗂 Карточки из бота": "/list",
                "📝 Описание героя": "/about", "⭐ Отзывы": "/reviews", "🔑 Пригласить в админку": "/admin",
                "❓ Помощь": "/help", "✖️ Отмена": "/cancel"}
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
        # Текст для блока «О персонаже» в окне карточки (необязательный)
        self.conn.run("ALTER TABLE cards ADD COLUMN IF NOT EXISTS about TEXT")
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
        # Новая рубашка любой коллекции (и встроенной из data.js, и созданной ботом); ver — для адреса мимо кеша
        self.conn.run("""
            CREATE TABLE IF NOT EXISTS collection_backs (
                uid TEXT PRIMARY KEY,
                back BYTEA NOT NULL,
                ver INT NOT NULL DEFAULT 1
            )""")
        # Встроенные коллекции, скрытые с сайта через бота (их нельзя удалить — они в коде сайта)
        self.conn.run("CREATE TABLE IF NOT EXISTS hidden_collections (uid TEXT PRIMARY KEY)")

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
        rows = self.run("SELECT id, universe, name, rarity, about FROM cards ORDER BY id")
        return [{"id": r[0], "universe": r[1], "name": r[2], "rarity": r[3], "about": r[4] or ""} for r in rows]

    def image(self, card_id, side, small):
        col = ("sm_" if small else "img_") + side
        rows = self.run(f"SELECT {col} FROM cards WHERE id = :id", id=card_id)
        return bytes(rows[0][0]) if rows else None

    def add(self, universe, name, rarity, a, b, sm_a, sm_b):
        # Та же карточка (персонаж + версия) заменяется новой, а не дублируется; описание переходит к новой
        old = self.run("""DELETE FROM cards WHERE universe = :u AND lower(name) = lower(:n) AND rarity = :r
                          RETURNING about""", u=universe, n=name, r=rarity)
        about = next((r[0] for r in old if r[0]), None)
        return self.run("""INSERT INTO cards (universe, name, rarity, img_a, img_b, sm_a, sm_b, about)
                           VALUES (:u, :n, :r, :a, :b, :sa, :sb, :ab) RETURNING id""",
                        u=universe, n=name, r=rarity, a=a, b=b, sa=sm_a, sb=sm_b, ab=about)[0][0]

    def set_about(self, card_id, about):
        # Описание общее для персонажа: пишем во все его версии в этой коллекции
        return self.run("""UPDATE cards SET about = :ab WHERE (universe, lower(name)) =
                           (SELECT universe, lower(name) FROM cards WHERE id = :id) RETURNING name""",
                        ab=about or None, id=card_id)

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

    def set_back(self, uid, back):
        return self.run("""INSERT INTO collection_backs (uid, back) VALUES (:u, :b)
                           ON CONFLICT (uid) DO UPDATE SET back = :b, ver = collection_backs.ver + 1 RETURNING ver""", u=uid, b=back)[0][0]

    def back_versions(self):
        return dict(self.run("SELECT uid, ver FROM collection_backs"))

    def custom_back(self, uid):
        rows = self.run("SELECT back FROM collection_backs WHERE uid = :u", u=uid)
        return bytes(rows[0][0]) if rows else None

    def hidden(self):
        return [r[0] for r in self.run("SELECT uid FROM hidden_collections")]

    def set_hidden(self, uid, hide):
        if hide:
            self.run("INSERT INTO hidden_collections (uid) VALUES (:u) ON CONFLICT DO NOTHING", u=uid)
        else:
            self.run("DELETE FROM hidden_collections WHERE uid = :u", u=uid)

    def delete_collection(self, num):
        self.run("DELETE FROM collection_backs WHERE uid = :u", u=f"c{num}")
        self.run("DELETE FROM cards WHERE universe = :u", u=f"c{num}")
        return self.run("DELETE FROM collections WHERE id = :id RETURNING name", id=num)


def universes(store=None, with_hidden=False):
    """Коллекции из site/data.js плюс созданные через бота."""
    src = open(os.path.join(ROOT, "site", "data.js"), encoding="utf-8").read()
    block = src.split("window.UNIVERSES", 1)[1].split("window.CHARACTERS", 1)[0]
    found = re.findall(r'id:\s*"([^"]+)",\s*name:\s*"([^"]+)"', block)
    if store:
        try:
            found += [(c["id"], c["name"]) for c in store.collections()]
            if not with_hidden:
                hidden = set(store.hidden())
                found = [f for f in found if f[0] not in hidden]
        except Exception as e:
            print("bot: collections unavailable:", e, file=sys.stderr)
    return found


def image_type(data):
    return "image/png" if data[:8] == b"\x89PNG\r\n\x1a\n" else "image/webp" if data[8:12] == b"WEBP" else "image/jpeg"


# ---------------------------------------------------------------
#  Бот
# ---------------------------------------------------------------
class Bot:
    def __init__(self, token, admin_chat, store, site_url="", reviews=None):
        self.token, self.admin, self.store, self.reviews = token, str(admin_chat), store, reviews
        self.site = site_url.rstrip("/")
        self.state = {}  # chat_id → черновик карточки
        self.into = {}   # chat_id → (id, название) коллекции, куда сейчас добавляются карточки
        self.greeted = {}
        self.keys_shown = False  # клавиатуру Владу показываем один раз за запуск (дальше Telegram её помнит)
        self.flood = {}    # антифлуд покупателей  # покупателям «передали» пишем один раз за запуск

    def api(self, method, **fields):
        req = urllib.request.Request(f"https://api.telegram.org/bot{self.token}/{method}",
                                     json.dumps(fields).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=70) as r:
            return json.load(r)["result"]

    def say(self, chat, text, buttons=None, keyboard=False):
        fields = {"chat_id": chat, "text": text, "disable_web_page_preview": True}
        if buttons:
            fields["reply_markup"] = {"inline_keyboard": buttons}
        elif keyboard:  # только в чате заказов: у покупателей своей клавиатуры нет
            fields["reply_markup"] = {"keyboard": [[{"text": t} for t in row] for row in ADMIN_KEYS],
                                      "resize_keyboard": True, "is_persistent": True,
                                      "input_field_placeholder": "Пришли два кадра карточки или нажми кнопку"}
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
        if doc.get("mime_type", "") in ("image/jpeg", "image/png", "image/webp"):
            return doc["file_id"], doc["file_id"]
        return None

    # --- интерактивные виджеты (Bot API 10.4): HTML-карточка прямо в сообщении ---
    # «Отправлен» — последний шаг: отправил — значит готово
    WIDGET_STATUS = {"new": "Новый", "work": "В работе", "sent": "Отправлен"}

    def send_widget_demo(self, chat):
        html = open(os.path.join(ROOT, "widgets", "order.html"), encoding="utf-8").read()
        try:
            self.api("sendWidget", chat_id=chat, html=html, allow_queries=True, chat_data=json.dumps({"s": "new"}),
                     caption="Тест: интерактивная карточка заказа. Нажми статус в карточке.")
        except Exception as e:
            self.say(chat, f"Telegram не принял виджет: {e}")

    def on_widget(self, q):
        """Нажатие в виджете: только Влад может менять статус; ответ виден прямо в карточке."""
        chat = str((q.get("chat") or {}).get("id", ""))
        kind, _, value = (q.get("data") or "").partition(":")
        if chat != self.admin or kind != "st" or value not in self.WIDGET_STATUS:
            return self.api("answerWidgetQuery", widget_query_id=q["id"], data="Нет доступа")
        self.api("editMessageWidgetData", chat_id=chat, message_id=q["message_id"], chat_data=json.dumps({"s": value}))
        self.api("answerWidgetQuery", widget_query_id=q["id"], data=f"Статус: {self.WIDGET_STATUS[value]}")

    # --- приём сообщений ---
    def handle(self, upd):
        if "widget_query" in upd:
            return self.on_widget(upd["widget_query"])
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
            if (msg.get("chat") or {}).get("type") != "private":
                return  # в группах, куда добавили бота, молчим
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
            # Ответ (reply) на уведомление об отзыве — публикуем как ответ магазина
            rid = self.reviews and self.reviews.by_msg(rep_to)
            if rid:
                if not text or text.startswith("/"):
                    return self.say(chat, "Ответ на отзыв пришли текстом.")
                return self.save_review_reply(chat, rid, text)
        if not self.keys_shown:
            self.keys_shown = True
            if text not in ("/start", "/help", "/menu", "/cancel") and text not in KEY_COMMANDS:
                self.say(chat, "Внизу чата — кнопки со всеми действиями бота.", keyboard=True)
        self.on_admin(chat, msg, text)

    def on_customer(self, chat, msg, text):
        now = time.time()
        hits = [t for t in self.flood.get(chat, []) if now - t < 600]
        if len(hits) >= 20:
            if len(hits) == 20:
                self.say(chat, "Слишком много сообщений подряд — подожди немного, мы уже всё получили.")
            self.flood[chat] = hits + [now]
            return
        self.flood[chat] = hits + [now]
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
        text = KEY_COMMANDS.get(text, text)  # нажатая кнопка внизу чата — та же команда
        if text in ("/start", "/help", "/menu"):
            return self.say(chat, "Кнопки внизу чата — все действия бота, печатать команды не нужно.\n\n"
                                  "Чтобы добавить карточку на сайт, пришли два кадра — как она выглядит прямо и после наклона. "
                                  "Можно одним альбомом. Дальше я спрошу коллекцию, имя и версию.\n\n"
                                  "/collection — новая коллекция (название, рубашка, потом карточки)\n"
                                  "/list — карточки и коллекции из бота (там же удаление)\n"
                                  "/collections — все коллекции: сменить рубашку, удалить или скрыть с сайта\n"
                                  "/about — описание персонажа для окна карточки на сайте\n"
                                  "/reviews — последние отзывы с сайта (ответить, скрыть)\n"
                                  "/widget — тест: интерактивная карточка заказа (новое в Telegram)\n"
                                  "/admin — ссылка-приглашение в админку сайта\n/cancel — отменить добавление", keyboard=True)
        if text == "/cancel":
            self.state.pop(chat, None)
            self.into.pop(chat, None)
            return self.say(chat, "Отменил. Пришли два кадра, когда будешь готов.", keyboard=True)
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
        if text.lower().lstrip("/") in ("collections", "коллекции", "рубашка", "back"):
            return self.show_collections(chat)
        if st and st.get("step") == "set_back":
            pic = self.pick(msg)
            if not pic:
                return self.say(chat, "Пришли новую рубашку картинкой. Или /cancel.")
            return self.save_back(chat, st, pic)
        if text.startswith("/about"):
            return self.ask_about(chat)
        if text == "/admin":
            return self.admin_invite(chat)
        if text == "/reviews":
            return self.show_reviews(chat)
        if text == "/widget":
            return self.send_widget_demo(chat)
        if st and st.get("step") == "rv_reply" and text and not text.startswith("/"):
            self.state.pop(chat, None)
            return self.save_review_reply(chat, st["id"], text)
        if st and st.get("step") == "about":
            if text == "/skip":
                self.state.pop(chat, None)
                return self.say(chat, "Ок, без своего описания. Для известных персонажей сайт покажет своё.")
            if text and not text.startswith("/"):
                return self.save_about(chat, st, text)

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
                    "rarity": "Выбери версию кнопкой выше.", "about": "Напиши описание текстом или /skip."}.get(st["step"], "")
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
        if kind == "bk":
            name = dict(universes(self.store, with_hidden=True)).get(value)
            if not name:
                return self.say(chat, "Этой коллекции уже нет.")
            self.state[chat] = {"step": "set_back", "uid": value, "name": name}
            return self.say(chat, f"Пришли новую рубашку для «{name}» — картинкой, как обычное фото. /cancel — передумал.")
        if kind in ("hide", "unhide"):
            name = dict(universes(self.store, with_hidden=True)).get(value)
            if not name or value.startswith("c"):
                return self.say(chat, "Эту коллекцию так не скрыть.")
            self.store.set_hidden(value, kind == "hide")
            self.say(chat, f"«{name}» скрыта с сайта вместе с её карточками. Вернуть — /collections." if kind == "hide"
                     else f"«{name}» снова на сайте.")
            return self.show_collections(chat)
        if kind == "cdel":
            name = {str(c["num"]): c["name"] for c in self.store.collections()}.get(value)
            if not name:
                return self.say(chat, "Этой коллекции уже нет.")
            return self.say(chat, f"Удалить коллекцию «{name}» вместе со всеми её карточками?",
                            [[{"text": "Да, удалить", "callback_data": f"cdel!:{value}"}, {"text": "Нет", "callback_data": "no:"}]])
        if kind == "cdel!":
            rows = self.store.delete_collection(int(value))
            st2 = self.state.get(chat)
            if st2 and st2.get("universe") == f"c{value}":
                self.state.pop(chat, None)
            if self.into.get(chat, ("",))[0] == f"c{value}":
                self.into.pop(chat, None)
            return self.say(chat, f"Удалил коллекцию «{rows[0][0]}»." if rows else "Этой коллекции уже нет.")
        if kind == "ab":
            name = dict((str(c["id"]), c["name"]) for c in self.store.cards()).get(value)
            if not name:
                return self.say(chat, "Этой карточки уже нет.")
            self.state[chat] = {"step": "about", "id": int(value), "name": name}
            return self.say(chat, f"Напиши описание для «{name}» — 2–4 предложения о персонаже. "
                                  "Пришли «-», чтобы убрать своё описание, или /skip.")
        if kind in ("rv", "rvh", "rvs", "rvd") and self.reviews and value.isdigit():
            return self.on_review_button(chat, kind, int(value), message_id)
        if kind == "inv" and value in ("owner", "admin", "viewer"):
            return self.admin_invite(chat, value)
        if kind == "no":
            return self.say(chat, "Оставил как есть.")
        self.say(chat, "Эта кнопка уже не работает. Пришли два кадра, чтобы добавить карточку.")

    def save(self, chat, st, rarity):
        if st["universe"] not in dict(universes(self.store)):
            self.state.pop(chat, None)
            return self.say(chat, "Этой коллекции уже нет. Пришли кадры заново и выбери коллекцию.")
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
        self.state[chat] = {"step": "about", "id": card_id, "name": st["name"]}
        uni = dict(universes(self.store)).get(st["universe"], st["universe"])
        link = f"\n{self.site}/catalog/{st['universe']}" if self.site else ""
        buttons = [[{"text": "Удалить эту карточку", "callback_data": f"del:{card_id}"}]]
        more = ""
        if self.into.get(chat):
            more = "\n\nПришли следующие два кадра — карточка тоже попадёт в эту коллекцию."
            buttons.append([{"text": "Закончить коллекцию", "callback_data": "done:"}])
        self.say(chat, f"Готово! {st['name']} ({RARITY[rarity].lower()}) теперь в коллекции «{uni}»." + link + more, buttons)
        self.say(chat, f"Напиши пару предложений о персонаже — они появятся на сайте в блоке «О персонаже». "
                       "Или /skip — тогда для известных персонажей сайт покажет своё описание.")

    def admin_invite(self, chat, role=None):
        """Одноразовая ссылка в админку. Первый вход — всегда владелец."""
        from admin import Admin, ROLE_NAMES
        adm = Admin(self.store)
        try:
            first = adm.admins_count() == 0
            if not role and not first:
                return self.say(chat, "Кого пригласить в админку?", [[{"text": ROLE_NAMES[r], "callback_data": f"inv:{r}"}] for r in ("owner", "admin", "viewer")])
            role = "owner" if first else role
            code = adm.create_invite(role)
        except Exception as e:
            print("bot admin invite error:", e, file=sys.stderr)
            return self.say(chat, f"Не получилось создать приглашение: {e}")
        base = self.site or "https://cards-rwc16u.saturn.ac"
        self.say(chat, f"Приглашение в админку ({ROLE_NAMES[role].lower()}), одноразовое, действует 7 дней:\n{base}/admin?invite={code}\n\n"
                       "Открой ссылку, укажи почту и пароль — дальше входи на /admin. Не пересылай её посторонним.")

    def ask_about(self, chat):
        cards = self.store.cards()
        if not cards:
            return self.say(chat, "Через бота карточек пока не добавляли.")
        seen, rows = set(), []
        names = dict(universes(self.store, with_hidden=True))
        for c in reversed(cards):  # один раз на персонажа, свежие сверху
            key = (c["universe"], c["name"].lower())
            if key in seen:
                continue
            seen.add(key)
            mark = "✓ " if c["about"] else ""
            rows.append([{"text": f"{mark}{c['name']} — {names.get(c['universe'], c['universe'])}", "callback_data": f"ab:{c['id']}"}])
        self.say(chat, "Чьё описание написать или поменять? ✓ — своё описание уже есть.", rows[:40])

    def save_about(self, chat, st, text):
        about = "" if text.strip() in ("-", "—") else text.strip()[:600]
        try:
            rows = self.store.set_about(st["id"], about)
        except Exception as e:
            print("bot about error:", e, file=sys.stderr)
            return self.say(chat, f"Не получилось сохранить описание: {e}. Пришли его ещё раз.")
        self.state.pop(chat, None)
        if not rows:
            return self.say(chat, "Этой карточки уже нет.")
        more = "\n\nПришли следующие два кадра — карточка попадёт в эту же коллекцию." if self.into.get(chat) else ""
        self.say(chat, (f"Убрал своё описание у «{st['name']}»." if not about else
                        f"Описание «{st['name']}» сохранено, на сайте оно уже есть.") + more)

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

    def show_collections(self, chat):
        """Все коллекции сайта: сменить рубашку; созданные ботом — удалить, встроенные — скрыть/вернуть."""
        hidden = set(self.store.hidden())
        own = {c["id"]: c["num"] for c in self.store.collections()}
        rows = []
        for uid, name in universes(self.store, with_hidden=True):
            mark = " (скрыта)" if uid in hidden else ""
            row = [{"text": f"🎴 {name}{mark}", "callback_data": f"bk:{uid}"}]
            if uid in own:
                row.append({"text": "✕ Удалить", "callback_data": f"cdel:{own[uid]}"})
            else:
                row.append({"text": "↩️ Вернуть" if uid in hidden else "🙈 Скрыть", "callback_data": f"{'unhide' if uid in hidden else 'hide'}:{uid}"})
            rows.append(row)
        self.say(chat, "Коллекции на сайте. Нажми на название — сменить рубашку. "
                       "Коллекции из бота можно удалить, встроенные — скрыть с сайта (и вернуть).", rows)

    def save_back(self, chat, st, pic):
        try:
            ver = self.store.set_back(st["uid"], self.download(pic[0]))
        except Exception as e:
            print("bot back error:", e, file=sys.stderr)
            return self.say(chat, f"Не получилось сохранить: {e}. Пришли картинку ещё раз.")
        self.state.pop(chat, None)
        site = self.site or "https://cards-rwc16u.saturn.ac"
        self.say(chat, f"Новая рубашка для «{st['name']}» уже на сайте (версия {ver}).\n{site}/catalog/{st['uid']}")

    def show_list(self, chat):
        cols = self.store.collections()
        if cols:
            self.say(chat, f"Коллекции из бота: {len(cols)}. Нажми, чтобы удалить (вместе с карточками):",
                     [[{"text": f"✕ {c['name']}", "callback_data": f"cdel:{c['num']}"}] for c in cols])
        cards = self.store.cards()
        if not cards:
            return self.say(chat, "Через бота карточек пока не добавляли. Пришли два кадра, чтобы добавить первую.")
        names = dict(universes(self.store, with_hidden=True))
        rows = [[{"text": f"✕ {c['name']}, {RARITY.get(c['rarity'], '').lower()} — {names.get(c['universe'], c['universe'])}",
                  "callback_data": f"del:{c['id']}"}] for c in cards[-40:]]
        more = f" Показаны последние 40." if len(cards) > 40 else ""
        self.say(chat, f"Карточки из бота: {len(cards)}.{more} Нажми, чтобы удалить:", rows)

    # --- отзывы с сайта ---
    def review_card(self, chat, rid):
        """Отправить отзыв карточкой с кнопками; reply на неё — ответ на отзыв."""
        from reviews import card_text, card_buttons
        r = self.reviews.get(rid)
        if not r:
            return None
        m = self.say(chat, card_text(r, self.site), card_buttons(r))
        self.reviews.link_msg(m["message_id"], rid)
        return m

    def refresh_card(self, chat, rid, message_id):
        from reviews import card_text, card_buttons
        r = self.reviews.get(rid)
        if not r or not message_id:
            return
        try:
            self.api("editMessageText", chat_id=chat, message_id=message_id, text=card_text(r, self.site),
                     disable_web_page_preview=True, reply_markup={"inline_keyboard": card_buttons(r)})
        except Exception:
            pass  # сообщение не изменилось или слишком старое — не страшно

    def save_review_reply(self, chat, rid, text):
        r = self.reviews.get(rid)
        if not r:
            return self.say(chat, "Этого отзыва уже нет.")
        self.reviews.set_reply(rid, text[:1000])
        note = "" if r["status"] == "published" else "\nСам отзыв на сайте пока не виден — нажми «Опубликовать» в карточке ниже."
        self.say(chat, f"Ответ на отзыв #{rid} ({r['name']}) опубликован на сайте." + note)
        self.review_card(chat, rid)

    def on_review_button(self, chat, kind, rid, message_id):
        r = self.reviews.get(rid)
        if not r:
            return self.say(chat, "Этого отзыва уже нет.")
        if kind == "rv":
            self.state[chat] = {"step": "rv_reply", "id": rid}
            return self.say(chat, f"Напиши ответ на отзыв #{rid} от {r['name']} — он появится на сайте под отзывом от имени магазина. /cancel — передумал.")
        if kind == "rvd":
            self.reviews.set_reply(rid, None)
            self.say(chat, f"Убрал ответ с отзыва #{rid}.")
        else:
            self.reviews.set_status(rid, "hidden" if kind == "rvh" else "published")
            self.say(chat, f"Отзыв #{rid} скрыт с сайта." if kind == "rvh" else f"Отзыв #{rid} опубликован на сайте.")
        self.refresh_card(chat, rid, message_id)

    def show_reviews(self, chat):
        if not self.reviews:
            return self.say(chat, "Отзывы работают только с базой данных.")
        ids = self.reviews.latest(5)
        if not ids:
            return self.say(chat, "Отзывов пока нет.")
        self.say(chat, f"Последние отзывы ({len(ids)}), сначала новые:")
        for rid in ids:
            self.review_card(chat, rid)

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
                for upd in self.api("getUpdates", offset=offset, timeout=50, allowed_updates=["message", "callback_query", "widget_query"]):
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
