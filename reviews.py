# Отзывы покупателей.
#
#   Сайт: /reviews — все отзывы и форма; на главной — три последних.
#   Новый отзыв сразу виден на сайте (со ссылками — только после «Опубликовать»), а Владу
#   в бот приходит уведомление с кнопками «Ответить», «Скрыть» / «Опубликовать».
#   Ответить можно кнопкой или просто ответом (reply) на уведомление — ответ появится
#   на сайте под отзывом от имени магазина. /reviews в боте — последние отзывы.
import re

STATUS = {"published": "опубликован", "hidden": "скрыт", "pending": "ждёт проверки"}
# Ссылки и упоминания в отзыве — частый спам: такой отзыв ждёт решения Влада
LINKY = re.compile(r"https?://|www\.|t\.me/|\b[a-z0-9-]+\.(ru|com|net|org|by|io|me|xyz|top|site|online|shop)\b|@\w{4,}", re.I)
PER_IP_DAY = 3
# Адрес сайта для ссылки в уведомлении, если SITE_URL не задан
SITE = "https://cards-rwc16u.saturn.ac"


class Reviews:
    def __init__(self, store):
        self.store = store
        self.ready = False

    def run(self, sql, **params):
        if not self.ready:
            self.store.run("""
                CREATE TABLE IF NOT EXISTS reviews (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    rating SMALLINT NOT NULL,
                    text TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'published',
                    reply TEXT,
                    reply_at TIMESTAMPTZ,
                    lang TEXT,
                    ip TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )""")
            # Сообщения в боте, на которые можно ответить reply — у одного отзыва их может быть несколько
            self.store.run("""
                CREATE TABLE IF NOT EXISTS review_msgs (
                    msg BIGINT PRIMARY KEY,
                    review_id INT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE
                )""")
            self.ready = True
        return self.store.run(sql, **params)

    # --- сайт ---
    def public(self, limit=10, offset=0):
        rows = self.run("""SELECT id, name, rating, text, reply, created_at, reply_at FROM reviews
                           WHERE status = 'published' ORDER BY created_at DESC, id DESC LIMIT :l OFFSET :o""",
                        l=limit, o=offset)
        total, avg = self.run("SELECT count(*), avg(rating) FROM reviews WHERE status = 'published'")[0]
        items = [{"id": r[0], "name": r[1], "rating": r[2], "text": r[3], "reply": r[4],
                  "date": r[5].isoformat(), "reply_date": r[6].isoformat() if r[6] else None} for r in rows]
        return {"items": items, "total": total, "avg": round(float(avg), 1) if avg is not None else None}

    def recent_from(self, ip):
        return self.run("SELECT count(*) FROM reviews WHERE ip = :ip AND created_at > now() - interval '1 day'", ip=ip)[0][0]

    def add(self, name, rating, text, lang, ip):
        status = "pending" if LINKY.search(f"{name} {text}") else "published"
        rid = self.run("""INSERT INTO reviews (name, rating, text, status, lang, ip)
                          VALUES (:n, :r, :t, :s, :l, :ip) RETURNING id""", n=name, r=rating, t=text, s=status, l=lang, ip=ip)[0][0]
        return rid, status

    # --- бот ---
    def get(self, rid):
        rows = self.run("SELECT id, name, rating, text, status, reply, lang, created_at FROM reviews WHERE id = :id", id=rid)
        if not rows:
            return None
        r = rows[0]
        return {"id": r[0], "name": r[1], "rating": r[2], "text": r[3], "status": r[4], "reply": r[5], "lang": r[6], "date": r[7]}

    def latest(self, n=5):
        return [r[0] for r in self.run("SELECT id FROM reviews ORDER BY created_at DESC, id DESC LIMIT :n", n=n)]

    def link_msg(self, msg, rid):
        self.run("INSERT INTO review_msgs (msg, review_id) VALUES (:m, :r) ON CONFLICT (msg) DO UPDATE SET review_id = :r", m=msg, r=rid)

    def by_msg(self, msg):
        rows = self.run("SELECT review_id FROM review_msgs WHERE msg = :m", m=msg)
        return rows[0][0] if rows else None

    def set_reply(self, rid, text):
        if text:
            self.run("UPDATE reviews SET reply = :t, reply_at = now() WHERE id = :id", t=text, id=rid)
        else:
            self.run("UPDATE reviews SET reply = NULL, reply_at = NULL WHERE id = :id", id=rid)

    def set_status(self, rid, status):
        self.run("UPDATE reviews SET status = :s WHERE id = :id", s=status, id=rid)


def card_text(r, site=""):
    """Текст уведомления в боте — по нему Влад видит отзыв целиком и что с ним сейчас."""
    stars = "★" * r["rating"] + "☆" * (5 - r["rating"])
    lines = [f"⭐ Отзыв #{r['id']} — {stars}", f"👤 {r['name']}" + (" (английская версия сайта)" if r.get("lang") == "en" else ""),
             "", r["text"], "", f"Статус: {STATUS.get(r['status'], r['status'])}"]
    if r["status"] == "pending":
        lines.append("В отзыве есть ссылка или @ник — на сайте его не видно, пока не нажмёшь «Опубликовать».")
    if r.get("reply"):
        lines += ["", f"↩️ Твой ответ на сайте: {r['reply']}"]
    else:
        lines += ["", "Ответь на это сообщение (reply) или нажми «Ответить» — ответ появится на сайте под отзывом."]
    lines.append(f"{(site or SITE).rstrip('/')}/reviews")
    return "\n".join(lines)


def card_buttons(r):
    rid = r["id"]
    row = [{"text": "✏️ Изменить ответ" if r.get("reply") else "↩️ Ответить", "callback_data": f"rv:{rid}"}]
    row.append({"text": "🙈 Скрыть", "callback_data": f"rvh:{rid}"} if r["status"] == "published"
               else {"text": "✅ Опубликовать", "callback_data": f"rvs:{rid}"})
    rows = [row]
    if r.get("reply"):
        rows.append([{"text": "🗑 Удалить ответ", "callback_data": f"rvd:{rid}"}])
    return rows
