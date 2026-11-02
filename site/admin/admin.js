// Админка Aniverse Flip: обзор, сессии посетителей с просмотром записи, заказы, карточки, команда.
// Всё, что пришло от посетителей (источник, страницы, поиск), выводится только через esc().
(() => {
  const app = document.getElementById("app");
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const ROLE = { owner: "Владелец", admin: "Админ", viewer: "Наблюдатель" };
  const STATUS = { new: "Новый", work: "В работе", sent: "Отправлен", done: "Получен", cancel: "Отменён" };
  const STATUS_TAG = { new: "tag--red", work: "tag--amber", sent: "tag--blue", done: "tag--green", cancel: "" };
  let me = null, timers = [], player = null, badges = { online: 0, new_orders: 0 };

  // --- иконки ---
  const P = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    play: '<path d="M7 4.5v15l12-7.5z"/>',
    rec: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
    bag: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
    card: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 8h6M9 12h4"/>',
    team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M16 4.8a3 3 0 0 1 0 6M21 20c0-2.6-1.6-4.5-4-5.2"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.2"/><path d="M11 18.5h2"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M9 20h6M12 16v4"/>',
    tablet: '<rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M11 18h2"/>',
    page: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    cart: '<path d="M3 4h2l2.2 11h10.6L20 7H6.2"/><circle cx="9" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    warn: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.2v.1"/>',
    send: '<path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M10 13l11-10"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    out: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  };
  const ico = (n, cls = "") => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ""}</svg>`;

  // --- форматирование ---
  const num = (n) => Number(n || 0).toLocaleString("ru-RU");
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0) + "%";
  const dur = (s) => {
    s = Math.max(0, Math.round(s || 0));
    if (s < 60) return `${s} с`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} мин ${s % 60 ? (s % 60) + " с" : ""}`.trim();
    return `${Math.floor(m / 60)} ч ${m % 60} мин`;
  };
  const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const when = (iso) => {
    const d = new Date(iso), now = new Date();
    const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d >= day) return `сегодня, ${time}`;
    if (d >= new Date(day - 864e5)) return `вчера, ${time}`;
    return `${d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}, ${time}`;
  };
  const flag = (cc) => (/^[A-Z]{2}$/.test(cc || "") ? String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0))) + " " : "");
  const COUNTRY = { RU: "Россия", BY: "Беларусь", KZ: "Казахстан", UA: "Украина", UZ: "Узбекистан", AM: "Армения", GE: "Грузия", KG: "Киргизия", PL: "Польша", DE: "Германия", US: "США", LT: "Литва", LV: "Латвия" };
  const country = (cc) => (cc ? flag(cc) + esc(COUNTRY[cc] || cc) : "—");
  const DEVICE = { mobile: "Телефон", tablet: "Планшет", desktop: "Компьютер" };
  const PAGE = { "/": "Главная", "/catalog": "Каталог", "/builder": "Конструктор", "/how": "Как это работает", "/about": "О нас", "/contacts": "Контакты", "/privacy": "Политика", "/offer": "Оферта" };
  const page = (p) => PAGE[(p || "/").replace(/\/$/, "") || "/"] || (p || "").replace(/^\/catalog\//, "Коллекция ");
  const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, k = m % 10; return `${num(n)} ${m > 10 && m < 20 ? c : k > 1 && k < 5 ? b : k === 1 ? a : c}`; };

  function toast(text) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  async function api(path, body) {
    const opt = body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
    const res = await fetch("/api/admin" + path, { credentials: "same-origin", ...opt });
    const data = await res.json().catch(() => ({ ok: false, error: "Сервер ответил странно" }));
    if (res.status === 401 && !path.startsWith("/login") && !path.startsWith("/register")) {
      me = null; renderAuth(); throw new Error("auth");
    }
    if (!res.ok || data.ok === false) throw new Error(data.error || `Ошибка ${res.status}`);
    return data;
  }
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };
  const every = (ms, fn) => timers.push(setInterval(fn, ms));

  // ------------------------------------------------------------------
  //  Вход и регистрация по приглашению
  // ------------------------------------------------------------------
  function renderAuth() {
    clearTimers();
    const code = new URLSearchParams(location.search).get("invite");
    if (code) return renderRegister(code);
    app.className = "";
    app.innerHTML = `<div class="auth"><form class="auth__box" id="f">
      <div class="auth__logo">Aniverse <span>Flip</span></div><p>Вход в админку магазина</p>
      <label class="field"><span>Почта</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>Пароль</span><input type="password" name="password" autocomplete="current-password" required></label>
      <p class="err" id="err" hidden></p>
      <button class="btn btn--red">Войти</button>
      <div class="auth__alt">Нет доступа? Попроси приглашение у владельца — в боте магазина команда /admin.</div></form></div>`;
    $("#f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), btn = $("button", e.target);
      btn.disabled = true;
      try {
        me = (await api("/login", { email: f.get("email"), password: f.get("password") })).admin;
        route();
      } catch (err) { $("#err").textContent = err.message; $("#err").hidden = false; btn.disabled = false; }
    });
  }
  async function renderRegister(code) {
    app.className = "";
    let role = "";
    try { role = (await api(`/invite?code=${encodeURIComponent(code)}`)).role_name; } catch (e) {
      app.innerHTML = `<div class="auth"><div class="auth__box"><div class="auth__logo">Aniverse <span>Flip</span></div>
        <p>${esc(e.message)}</p><a class="btn btn--red" href="/admin">Ко входу</a></div></div>`;
      return;
    }
    app.innerHTML = `<div class="auth"><form class="auth__box" id="f">
      <div class="auth__logo">Aniverse <span>Flip</span></div><p>Приглашение в админку. Роль: <b>${esc(role)}</b></p>
      <label class="field"><span>Как тебя зовут</span><input name="name" autocomplete="name" maxlength="60"></label>
      <label class="field"><span>Почта (для входа)</span><input type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span>Пароль, минимум 8 символов</span><input type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <p class="err" id="err" hidden></p>
      <button class="btn btn--red">Создать аккаунт</button></form></div>`;
    $("#f").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target), btn = $("button", e.target);
      btn.disabled = true;
      try {
        me = (await api("/register", { code, name: f.get("name"), email: f.get("email"), password: f.get("password") })).admin;
        history.replaceState(null, "", "/admin#/");
        route();
      } catch (err) { $("#err").textContent = err.message; $("#err").hidden = false; btn.disabled = false; }
    });
  }

  // ------------------------------------------------------------------
  //  Каркас и маршруты (#/, #/sessions, #/s/<id>, #/orders, #/cards, #/team)
  // ------------------------------------------------------------------
  const NAV = [["#/", "home", "Обзор"], ["#/sessions", "rec", "Сессии"], ["#/orders", "bag", "Заказы"], ["#/cards", "card", "Карточки"], ["#/team", "team", "Команда"]];
  function shell(active, html) {
    app.className = "";
    app.innerHTML = `<div class="shell"><aside class="side">
      <div class="side__brand">Aniverse <span>Flip</span><small>админка магазина</small></div>
      <nav class="nav">${NAV.map(([h, i, t]) => `<a href="${h}" class="${h === active ? "is-on" : ""}">${ico(i)}<span>${t}</span>${
        h === "#/sessions" && badges.online ? `<i class="nav__dot" title="Сейчас на сайте">${badges.online}</i>` : h === "#/orders" && badges.new_orders ? `<i class="nav__dot" title="Новые заказы">${badges.new_orders}</i>` : ""}</a>`).join("")}</nav>
      <div class="side__me"><b>${esc(me.name)}</b><span>${esc(ROLE[me.role])} · ${esc(me.email)}</span><br><button class="btn btn--sm btn--ghost" data-logout>${ico("out")}Выйти</button></div>
      </aside><main class="main">${html}</main></div>`;
    $$("[data-logout]").forEach((b) => b.addEventListener("click", logout));
    return $(".main");
  }
  async function logout() { await api("/logout", {}).catch(() => {}); me = null; location.hash = "#/"; renderAuth(); }
  async function ping() {
    try {
      const d = await api("/ping");
      if (d.online !== badges.online || d.new_orders !== badges.new_orders) {
        badges = d;
        $$(".nav a").forEach((a) => {
          const h = a.getAttribute("href"), n = h === "#/sessions" ? d.online : h === "#/orders" ? d.new_orders : 0;
          let dot = $(".nav__dot", a);
          if (!n) return dot && dot.remove();
          if (!dot) a.insertAdjacentHTML("beforeend", '<i class="nav__dot"></i>'), (dot = $(".nav__dot", a));
          dot.textContent = n;
        });
      }
    } catch {}
  }

  async function route() {
    clearTimers();
    if (player) { try { player.pause(); } catch {} player = null; }
    if (!me) {
      try { me = (await api("/me")).admin; } catch { return renderAuth(); }
    }
    const h = location.hash || "#/";
    const [path, qs] = h.slice(1).split("?");
    const q = new URLSearchParams(qs || "");
    window.scrollTo(0, 0);
    ping();
    every(30000, ping);
    try {
      if (path.startsWith("/s/")) return await viewSession(decodeURIComponent(path.slice(3)));
      if (path === "/sessions") return await viewSessions(q);
      if (path === "/orders") return await viewOrders(q);
      if (path === "/cards") return await viewCards(q);
      if (path === "/team") return await viewTeam();
      return await viewOverview(q);
    } catch (e) {
      if (e.message !== "auth") shell("", `<div class="empty">Не получилось загрузить: ${esc(e.message)}</div>`);
    }
  }
  addEventListener("hashchange", route);

  // ------------------------------------------------------------------
  //  Обзор
  // ------------------------------------------------------------------
  const PERIODS = [[1, "Сегодня"], [7, "7 дней"], [30, "30 дней"], [90, "90 дней"]];
  const seg = (items, cur, attr) => `<div class="seg">${items.map(([v, t]) => `<button type="button" data-${attr}="${v}" class="${String(v) === String(cur) ? "is-on" : ""}">${t}</button>`).join("")}</div>`;
  const rank = (items, fmt = (x) => esc(x)) => {
    if (!items.length) return '<div class="muted">Пока пусто</div>';
    const max = Math.max(...items.map((x) => x.n));
    return `<ul class="rank">${items.map((x) => `<li><i class="rank__bar" style="width:${(x.n / max) * 100}%"></i><span>${fmt(x.k)}</span><b>${num(x.n)}</b></li>`).join("")}</ul>`;
  };
  function barChart(series, days) {
    const W = 640, H = 190, pad = { l: 28, r: 6, t: 10, b: 22 };
    const max = Math.max(1, ...series.map((x) => x.visitors));
    const n = series.length, bw = (W - pad.l - pad.r) / n;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
    const ticks = [0, Math.ceil(max / 2), max];
    const every = Math.ceil(n / 8);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Посетители и заказы по ${days === 1 ? "часам" : "дням"}">`;
    ticks.forEach((t) => (s += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="rgba(255,255,255,.07)"/><text x="${pad.l - 6}" y="${y(t) + 3}" text-anchor="end">${t}</text>`));
    series.forEach((d, i) => {
      const x = pad.l + i * bw, w = Math.max(2, bw * 0.62), cx = x + (bw - w) / 2;
      s += `<rect x="${cx}" y="${y(d.visitors)}" width="${w}" height="${Math.max(0, H - pad.b - y(d.visitors))}" rx="2" fill="#e3122f" opacity=".85"><title>${esc(d.d)}: ${d.visitors} посет., ${d.orders} заказ.</title></rect>`;
      if (d.orders) s += `<circle cx="${cx + w / 2}" cy="${y(d.visitors) - 7}" r="4" fill="#2fd17a"><title>${d.orders} заказ.</title></circle>`;
      if (i % every === 0) s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(days === 1 ? d.d.slice(0, 2) : d.d.slice(8) + "." + d.d.slice(5, 7))}</text>`;
    });
    return s + "</svg>";
  }
  async function viewOverview(q) {
    const days = +(q.get("days") || 7);
    const main = shell("#/", `<div class="top"><h1>Обзор</h1>${seg(PERIODS, days, "days")}</div><div class="empty">Считаем…</div>`);
    const d = await api(`/overview?days=${days}`);
    const conv = pct(d.with_order, d.sessions);
    const steps = [["Зашли на сайт", d.sessions], ["Открыли карточку", d.with_card], ["Положили в корзину", d.with_cart], ["Открыли оформление", d.order_opened], ["Оформили заказ", d.with_order]];
    main.innerHTML = `<div class="top"><h1>Обзор</h1>${seg(PERIODS, days, "days")}</div>
      <div class="kpis">
        <a class="kpi" href="#/sessions?filter=live" style="text-decoration:none"><div class="kpi__k">${d.online ? '<i class="live"></i>' : ""}Сейчас на сайте</div><div class="kpi__v">${num(d.online)}</div><div class="kpi__s">смотреть вживую →</div></a>
        <div class="kpi"><div class="kpi__k">Посетители</div><div class="kpi__v">${num(d.visitors)}</div><div class="kpi__s">${plural(d.sessions, "сессия", "сессии", "сессий")}</div></div>
        <div class="kpi kpi--red"><div class="kpi__k">Заказы</div><div class="kpi__v">${num(d.orders)}</div><div class="kpi__s">конверсия ${conv}</div></div>
        <div class="kpi"><div class="kpi__k">С корзиной</div><div class="kpi__v">${num(d.with_cart)}</div><div class="kpi__s">${pct(d.with_cart, d.sessions)} сессий</div></div>
        <div class="kpi"><div class="kpi__k">Время на сайте</div><div class="kpi__v">${dur(d.median_sec)}</div><div class="kpi__s">медиана</div></div>
        <div class="kpi"><div class="kpi__k">С телефона</div><div class="kpi__v">${pct(d.mobile, d.sessions)}</div><div class="kpi__s">ушли сразу: ${pct(d.bounces, d.sessions)}</div></div>
      </div>
      <div class="cols">
        <div class="panel chart"><h2>Посетители ${days === 1 ? "по часам" : "по дням"}</h2>${barChart(d.series, days)}
          <div class="legend"><span><i style="background:#e3122f"></i>посетители</span><span><i style="background:#2fd17a;border-radius:50%"></i>есть заказы</span></div></div>
        <div class="panel"><h2>Воронка</h2>${steps.map(([t, v]) => `<div class="funnel__row"><span>${t}</span><b>${num(v)}<small>${pct(v, d.sessions)}</small></b>
          <div class="funnel__bar"><i style="width:${d.sessions ? (v / d.sessions) * 100 : 0}%"></i></div></div>`).join("")}</div>
      </div>
      <div class="cols cols--3">
        <div class="panel"><h2>Откуда пришли</h2>${rank(d.sources)}</div>
        <div class="panel"><h2>Популярные карточки</h2>${rank(d.top_cards)}</div>
        <div class="panel"><h2>Страницы</h2>${rank(d.pages.map((p) => ({ ...p, k: p.k.startsWith("/catalog/") && p.title ? p.title.split(/\s[—|·-]\s/)[0] : page(p.k) })))}</div>
        <div class="panel"><h2>Устройства</h2>${rank(d.devices, (k) => esc(DEVICE[k] || k))}<h2 style="margin-top:14px">Браузеры</h2>${rank(d.browsers)}</div>
        <div class="panel"><h2>Страны</h2>${rank(d.countries, country)}</div>
        <div class="panel"><h2>Что искали</h2>${rank(d.searches)}</div>
      </div>`;
    $$("[data-days]", main).forEach((b) => b.addEventListener("click", () => (location.hash = `#/?days=${b.dataset.days}`)));
    every(60000, () => location.hash === (`#/?days=${days}`) || (location.hash === "#/" || !location.hash) ? viewOverview(q).catch(() => {}) : 0);
  }

  // ------------------------------------------------------------------
  //  Сессии
  // ------------------------------------------------------------------
  const FILTERS = [["", "Все"], ["live", "Онлайн"], ["order", "С заказом"], ["cart", "С корзиной"], ["engaged", "Смотрели карточки"], ["errors", "С ошибками"]];
  function sessionRow(s) {
    const tags = [
      s.live && '<span class="tag tag--green"><i class="live"></i>онлайн</span>',
      s.order && '<span class="tag tag--green">заказ</span>',
      !s.order && s.cart && '<span class="tag tag--red">корзина</span>',
      s.prev_visits > 0 && `<span class="tag tag--blue">${s.prev_visits + 1}-й визит</span>`,
      s.errors > 0 && '<span class="tag tag--amber">ошибка</span>',
    ].filter(Boolean).join("");
    return `<a class="srow" href="#/s/${encodeURIComponent(s.id)}">
      <span class="srow__ic ${s.order ? "is-order" : ""}">${ico(s.device === "mobile" ? "phone" : s.device === "tablet" ? "tablet" : "desktop")}</span>
      <span class="srow__main">${esc(when(s.started))}${tags}</span>
      <span class="srow__sub">${esc(s.source)} · ${esc(page(s.landing.split("?")[0]))} · ${flag(s.country)}${esc(s.browser || s.os)}</span>
      <span class="srow__right"><b>${dur(s.duration)}</b>${s.pages} стр. · ${s.cards} карт.</span>
    </a>`;
  }
  async function viewSessions(q) {
    const f = q.get("filter") || "", days = q.get("days") || "7", dev = q.get("device") || "", text = q.get("q") || "", visitor = q.get("visitor") || "";
    let pageN = 0;
    const qs = (extra = {}) => { const p = new URLSearchParams({ filter: f, days, device: dev, q: text, visitor, ...extra }); [...p].forEach(([k, v]) => !v && p.delete(k)); return p.toString(); };
    const main = shell("#/sessions", `<div class="top"><h1>${visitor ? "Все визиты посетителя" : "Сессии"}</h1>
      <div class="top__sub">Нажми на сессию — откроется запись: что человек видел и куда нажимал</div></div>
      <div class="filters">${seg(FILTERS, f, "f")}</div>
      <div class="filters">
        <select class="inp" id="days" style="flex:0 0 auto;width:auto">${[[1, "Сегодня"], [7, "7 дней"], [30, "30 дней"], [90, "90 дней"]].map(([v, t]) => `<option value="${v}" ${String(v) === days ? "selected" : ""}>${t}</option>`).join("")}</select>
        <select class="inp" id="dev" style="flex:0 0 auto;width:auto"><option value="">Все устройства</option>${Object.entries(DEVICE).map(([v, t]) => `<option value="${v}" ${v === dev ? "selected" : ""}>${t}</option>`).join("")}</select>
        <input class="inp" id="q" type="search" placeholder="Источник, страница, страна…" value="${esc(text)}">
      </div>
      <div id="count" class="muted" style="margin-bottom:8px;font-size:13px"></div><div class="slist" id="list"><div class="empty">Загружаем…</div></div><div class="more" id="more"></div>`);
    const go = (extra) => (location.hash = `#/sessions?${qs(extra)}`);
    $$("[data-f]", main).forEach((b) => b.addEventListener("click", () => go({ filter: b.dataset.f })));
    $("#days").addEventListener("change", (e) => go({ days: e.target.value }));
    $("#dev").addEventListener("change", (e) => go({ device: e.target.value }));
    let tq;
    $("#q").addEventListener("input", (e) => { clearTimeout(tq); tq = setTimeout(() => go({ q: e.target.value.trim() }), 500); });
    async function load(append) {
      const d = await api(`/sessions?${qs({ page: pageN })}`);
      $("#count").textContent = `Найдено: ${plural(d.total, "сессия", "сессии", "сессий")}`;
      const html = d.items.map(sessionRow).join("");
      if (append) $("#list").insertAdjacentHTML("beforeend", html);
      else $("#list").innerHTML = html || `<div class="empty">${f === "live" ? "Сейчас на сайте никого нет. Страница обновляется сама." : "Сессий пока нет — они появятся, когда на сайт кто-нибудь зайдёт."}</div>`;
      $("#more").innerHTML = (pageN + 1) * 50 < d.total ? '<button class="btn" id="mb">Показать ещё</button>' : "";
      $("#mb")?.addEventListener("click", () => { pageN++; load(true); });
    }
    await load();
    if (q.get("q")) { const i = $("#q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
    every(f === "live" ? 5000 : 30000, () => !pageN && load().catch(() => {}));
  }

  // ------------------------------------------------------------------
  //  Просмотр одной сессии: запись + лента событий
  // ------------------------------------------------------------------
  const EV = {
    pageview: ["page", "", (e) => `Открыл страницу «${esc(e.path.startsWith("/catalog/") && e.data.title ? e.data.title.split(/\s[—|·-]\s/)[0] : page(e.path))}»`],
    card_open: ["eye", "t-card", (e) => `Смотрит карточку <b>${esc(e.data.name)}</b><small>${esc(e.data.uni)}${e.data.r ? " · " + (e.data.r === "special" ? "особая" : "обычная") : ""}</small>`],
    cart_add: ["cart", "t-cart", (e) => `В корзину: <b>${esc(e.data.name)}</b>${e.data.qty > 1 ? " × " + esc(e.data.qty) : ""}`],
    fav: ["heart", "t-card", (e) => `В избранное: ${esc(e.data.name)}`],
    order_open: ["form", "t-cart", (e) => `Открыл оформление заказа<small>${esc(e.data.total)}</small>`],
    order_sent: ["check", "t-order", (e) => `<b>Отправил заказ</b><small>${esc(e.data.total)}</small>`],
    order_fail: ["warn", "t-err", (e) => `Заказ не ушёл<small>${esc(e.data.why)}</small>`],
    search: ["search", "", (e) => `Искал «${esc(e.data.q)}»<small>${e.data.pick ? "выбрал: " + esc(e.data.pick) : ""}</small>`],
    region: ["swap", "", (e) => `Переключил валюту на ${esc(e.data.to)}`],
    tg_click: ["send", "", (e) => `Перешёл по ссылке<small>${esc(e.data.href)}</small>`],
    js_error: ["warn", "t-err", (e) => `Ошибка на странице<small>${esc(e.data.msg)} ${esc(e.data.at || "")}</small>`],
  };
  const facts = (rows) => `<dl class="facts">${rows.filter((r) => r[1] !== undefined && r[1] !== "").map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;

  async function viewSession(sid) {
    const main = shell("#/sessions", `<div class="empty">Загружаем запись…</div>`);
    const [info, rec] = await Promise.all([api(`/sessions/${encodeURIComponent(sid)}`), api(`/sessions/${encodeURIComponent(sid)}/replay`)]);
    const s = info.session;
    let events = rec.events.sort((a, b) => a.timestamp - b.timestamp), last = rec.last;
    const base = () => (events[0] ? events[0].timestamp : new Date(s.started).getTime());
    const utm = Object.entries(s.utm || {}).map(([k, v]) => `${esc(k.replace("utm_", ""))}: ${esc(v)}`).join("<br>");
    const visitorFacts = (s) => facts([
            ["Устройство", esc(`${DEVICE[s.device] || s.device}, ${s.os}`)], ["Браузер", esc(s.browser)], ["Экран", esc(s.screen)],
            ["Страна", country(s.country)], ["Язык", esc(s.lang)], ["Откуда", esc(s.source)],
            ["Ссылка", s.referrer ? esc(s.referrer) : ""], ["UTM", utm], ["Первая страница", esc(s.landing)],
            ["Начало", esc(new Date(s.started).toLocaleString("ru-RU"))], ["Длительность", dur(s.duration)],
            ["Страниц / карточек", `${s.pages} / ${s.cards}`]]);
    const stageInfo = (s) => `${esc(DEVICE[s.device] || s.device)} · ${esc(s.screen)} · ${dur(s.duration)}`;
    main.innerHTML = `<div class="top"><a class="btn btn--sm btn--ghost" href="#/sessions">${ico("back")}Сессии</a>
        <h1>Сессия · ${esc(when(s.started))}</h1>
        <div class="chips">${s.live ? '<span class="tag tag--green"><i class="live"></i>сейчас на сайте</span>' : ""}${s.order ? '<span class="tag tag--green">заказ</span>' : ""}${info.others.length ? `<span class="tag tag--blue">${info.others.length + 1} визитов</span>` : ""}</div></div>
      <div class="sv">
        <div class="stage"><div class="stage__bar"><span class="grow muted" id="stinfo">${stageInfo(s)}</span>
          ${s.live ? '<label class="chips" style="align-items:center;cursor:pointer"><input type="checkbox" id="follow" checked> следить вживую</label>' : ""}</div>
          <div class="player" id="player"></div></div>
        <div class="side-col">
          <div class="panel"><h2>Что делал <b id="evn"></b></h2><ul class="tl" id="tl"></ul></div>
          ${info.orders.length ? `<div class="panel"><h2>Заказ</h2>${info.orders.map((o) => `<div style="margin-bottom:8px"><b>#${o.id}</b> · ${esc(o.total)} <span class="tag ${STATUS_TAG[o.status]}">${STATUS[o.status]}</span>
            <ul class="order__lines" style="margin-top:6px">${(o.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`).join("")}<a class="btn btn--sm" href="#/orders">Все заказы</a></div>` : ""}
          <div class="panel"><h2>Посетитель</h2><div id="vfacts">${visitorFacts(s)}</div></div>
          ${info.others.length ? `<div class="panel"><h2>Другие визиты этого человека</h2><ul class="rank">${info.others.map((o) =>
            `<li><span><a href="#/s/${encodeURIComponent(o.id)}">${esc(when(o.started))}</a></span><b>${o.order ? '<span class="tag tag--green">заказ</span> ' : ""}${o.pages} стр.</b></li>`).join("")}</ul>
            <a class="btn btn--sm" style="margin-top:8px" href="#/sessions?visitor=${encodeURIComponent(s.visitor)}&days=365">Все визиты списком</a></div>` : ""}
          ${me.role !== "viewer" ? `<button class="btn btn--ghost btn--sm" id="del" style="justify-self:start">${ico("trash")}Удалить запись</button>` : ""}
        </div></div>`;

    function drawTimeline(list) {
      $("#evn").textContent = list.length ? `· ${list.length}` : "";
      $("#tl").innerHTML = list.length ? list.map((e) => {
        const [icon, cls, text] = EV[e.type] || ["page", "", () => esc(e.type)];
        return `<li class="${cls}" data-t="${e.t}"><time>${clock(e.t - base())}</time>${ico(icon)}<span>${text(e)}</span></li>`;
      }).join("") : '<li class="muted" style="cursor:default">Событий пока нет</li>';
      $$("#tl li[data-t]").forEach((li) => li.addEventListener("click", () => player && player.goto(Math.max(0, +li.dataset.t - base() - 1500), true)));
    }
    drawTimeline(info.events);

    const box = $("#player");
    const Player = window.rrwebPlayer && (window.rrwebPlayer.Player || window.rrwebPlayer.default || window.rrwebPlayer);
    const hasSnap = events.some((e) => e.type === 2);
    if (!Player) box.innerHTML = '<div class="player__msg">Плеер не загрузился — обнови страницу</div>';
    else if (!hasSnap) box.innerHTML = `<div class="player__msg">${s.live ? "Запись экрана ещё не пришла — подожди пару секунд, обновится сама." : "Для этой сессии нет записи экрана: человек ушёл раньше, чем она началась, или браузер её не поддерживает. Действия — в списке справа."}</div>`;
    else mount();

    function mount() {
      const metaEv = events.find((e) => e.type === 4);
      const rw = metaEv?.data?.width || 390, rh = metaEv?.data?.height || 844;
      const W = Math.max(260, box.clientWidth);
      const H = rh > rw ? Math.min(Math.round(innerHeight * 0.66), 760) : Math.min(Math.round((W * rh) / rw), Math.round(innerHeight * 0.7));
      box.innerHTML = "";
      player = new Player({ target: box, props: { events, width: W, height: H, autoPlay: !s.live, skipInactive: true, showController: true,
        speedOption: [1, 2, 4, 8], mouseTail: { strokeStyle: "#ff3b52", lineWidth: 3, duration: 600 }, UNSAFE_replayCanvas: false } });
      if (s.live) player.goto(Math.max(0, events[events.length - 1].timestamp - base() - 800), true);
      // Подписи плеера — по-русски
      $$(".rr-controller *", box).forEach((n) => { if (n.childNodes.length === 1 && n.firstChild.nodeType === 3 && /skip inactive/i.test(n.textContent)) n.textContent = "пропускать паузы"; });
      player.addEventListener("ui-update-current-time", (p) => {
        const t = base() + (p.payload || 0);
        let cur = null;
        $$("#tl li[data-t]").forEach((li) => { if (+li.dataset.t <= t) cur = li; li.classList.remove("is-now"); });
        cur && cur.classList.add("is-now");
      });
    }

    $("#del")?.addEventListener("click", async () => {
      if (!confirm("Удалить запись этой сессии насовсем?")) return;
      await api(`/sessions/${encodeURIComponent(sid)}/delete`, {});
      toast("Запись удалена"); location.hash = "#/sessions";
    });

    // Сессия идёт прямо сейчас — подгружаем новые куски записи и события
    if (s.live) {
      every(3000, async () => {
        try {
          const more = await api(`/sessions/${encodeURIComponent(sid)}/replay?after=${last}`);
          last = more.last;
          if (!more.events.length) return;
          more.events.sort((a, b) => a.timestamp - b.timestamp);
          if (!player) {
            events = events.concat(more.events);
            if (events.some((e) => e.type === 2)) mount();
            return;
          }
          more.events.forEach((e) => { events.push(e); player.addEvent(e); });
          // Плеер вставляет события асинхронно — перематываем к концу, когда они уже внутри
          if ($("#follow")?.checked) setTimeout(() => player && player.goto(Math.max(0, events[events.length - 1].timestamp - base() - 800), true), 60);
        } catch {}
      });
      every(6000, async () => {
        try {
          const fresh = await api(`/sessions/${encodeURIComponent(sid)}`);
          drawTimeline(fresh.events);
          $("#vfacts").innerHTML = visitorFacts(fresh.session);
          $("#stinfo").innerHTML = stageInfo(fresh.session);
        } catch {}
      });
    }
  }

  // ------------------------------------------------------------------
  //  Заказы
  // ------------------------------------------------------------------
  const contactLink = (c) => {
    const m = /^Telegram:\s*@?([A-Za-z0-9_]{4,32})$/.exec(c || "");
    if (m) return `<a href="https://t.me/${m[1]}" target="_blank" rel="noopener">${esc(c)}</a>`;
    const t = /^TikTok:\s*@?([A-Za-z0-9_.]{2,32})$/.exec(c || "");
    if (t) return `<a href="https://www.tiktok.com/@${t[1]}" target="_blank" rel="noopener">${esc(c)}</a>`;
    const g = /^Instagram:\s*@?([A-Za-z0-9_.]{1,30})$/.exec(c || "");
    if (g) return `<a href="https://www.instagram.com/${g[1]}/" target="_blank" rel="noopener">${esc(c)}</a>`;
    return esc(c);
  };
  async function viewOrders(q) {
    const st = q.get("status") || "";
    const main = shell("#/orders", `<div class="top"><h1>Заказы</h1></div><div class="empty">Загружаем…</div>`);
    const d = await api(`/orders${st ? "?status=" + st : ""}`);
    const total = Object.values(d.counts).reduce((a, b) => a + b, 0);
    const tabs = [["", `Все ${total}`], ...Object.entries(STATUS).map(([k, t]) => [k, `${t} ${d.counts[k] || 0}`])];
    const edit = me.role !== "viewer";
    main.innerHTML = `<div class="top"><h1>Заказы</h1><div class="top__sub">Копии заказов с сайта — те же, что приходят в Telegram. Статус видит только команда.</div></div>
      <div class="filters">${seg(tabs, st, "st")}</div>
      <div class="olist">${d.items.map((o) => `<article class="order">
        <div class="order__head"><b>#${o.id}</b><span class="muted">${esc(when(o.created))}</span><span class="grow"></span>${o.total ? `<span class="tag">${esc(o.total)}</span>` : ""}<span class="tag ${STATUS_TAG[o.status]}">${STATUS[o.status]}</span></div>
        <ul class="order__lines">${(o.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        <div class="order__who"><div><span>Имя</span> ${esc(o.name || "—")}</div><div><span>Связь</span> ${contactLink(o.contact)}</div>${o.photos ? `<div><span>Фото</span> ${o.photos} (в Telegram)</div>` : ""}${o.device ? `<div><span>С</span> ${esc(DEVICE[o.device] || o.device)}, ${esc(o.source || "")}</div>` : ""}</div>
        ${o.comment ? `<div class="muted" style="font-size:13px">💬 ${esc(o.comment)}</div>` : ""}
        <div class="order__acts">${edit ? `<select data-oid="${o.id}" aria-label="Статус заказа">${Object.entries(STATUS).map(([k, t]) => `<option value="${k}" ${k === o.status ? "selected" : ""}>${t}</option>`).join("")}</select>` : ""}
          ${o.visit ? `<a class="btn btn--sm" href="#/s/${encodeURIComponent(o.visit)}">${ico("play")}Смотреть сессию</a>` : ""}</div>
      </article>`).join("") || '<div class="empty">Заказов пока нет. Они появятся здесь, как только кто-то оформит заказ на сайте.</div>'}</div>`;
    $$("[data-st]", main).forEach((b) => b.addEventListener("click", () => (location.hash = `#/orders${b.dataset.st ? "?status=" + b.dataset.st : ""}`)));
    $$("[data-oid]", main).forEach((sel) => sel.addEventListener("change", async () => {
      try { await api(`/orders/${sel.dataset.oid}`, { status: sel.value }); toast(`Заказ #${sel.dataset.oid}: ${STATUS[sel.value].toLowerCase()}`); ping(); }
      catch (e) { toast(e.message); }
    }));
  }

  // ------------------------------------------------------------------
  //  Карточки: что смотрят и что берут
  // ------------------------------------------------------------------
  async function viewCards(q) {
    const days = +(q.get("days") || 30);
    const main = shell("#/cards", `<div class="top"><h1>Карточки</h1>${seg(PERIODS.slice(1).concat([[365, "Год"]]), days, "days")}</div><div class="empty">Считаем…</div>`);
    const d = await api(`/cards?days=${days}`);
    main.innerHTML = `<div class="top"><h1>Карточки</h1>${seg(PERIODS.slice(1).concat([[365, "Год"]]), days, "days")}
      <div class="top__sub">Какие карточки открывают в окне товара и сколько из них доходит до корзины</div></div>
      <div class="panel tbl-wrap">${d.items.length ? `<table class="tbl"><thead><tr><th>Карточка</th><th>Коллекция</th><th class="n">Открыли</th><th class="n">Людей</th><th class="n">В корзину</th><th class="n">♥</th><th class="n">Конверсия</th></tr></thead>
        <tbody>${d.items.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td class="muted">${esc(c.uni)}</td><td class="n">${num(c.opens)}</td><td class="n">${num(c.people)}</td><td class="n">${num(c.carts)}</td><td class="n">${num(c.favs)}</td><td class="n">${pct(c.carts, c.people)}</td></tr>`).join("")}</tbody></table>`
        : '<div class="empty">Пока никто не открывал карточки за этот период</div>'}</div>`;
    $$("[data-days]", main).forEach((b) => b.addEventListener("click", () => (location.hash = `#/cards?days=${b.dataset.days}`)));
  }

  // ------------------------------------------------------------------
  //  Команда: админы, приглашения, пароль
  // ------------------------------------------------------------------
  async function viewTeam() {
    const main = shell("#/team", `<div class="top"><h1>Команда</h1></div><div class="empty">Загружаем…</div>`);
    const d = await api("/team");
    const owner = me.role === "owner", canInvite = me.role !== "viewer";
    const roles = owner ? ["viewer", "admin", "owner"] : ["viewer"];
    main.innerHTML = `<div class="top"><h1>Команда</h1><button class="btn btn--sm btn--ghost" data-logout>${ico("out")}Выйти</button></div>
      <div class="grid">
      <div class="panel tbl-wrap"><h2>Кто имеет доступ</h2><table class="tbl"><thead><tr><th>Имя</th><th>Роль</th><th>Был</th><th></th></tr></thead><tbody>
        ${d.admins.map((a) => `<tr><td><b>${esc(a.name)}</b>${a.id === me.id ? ' <span class="tag">это ты</span>' : ""}<br><span class="muted">${esc(a.email)}</span></td>
          <td>${owner && a.id !== me.id ? `<select class="inp" style="min-height:32px;width:auto" data-role="${a.id}">${["viewer", "admin", "owner"].map((r) => `<option value="${r}" ${r === a.role ? "selected" : ""}>${ROLE[r]}</option>`).join("")}</select>` : esc(ROLE[a.role])}</td>
          <td class="muted">${a.last_login ? esc(when(a.last_login)) : "—"}</td>
          <td>${owner && a.id !== me.id ? `<button class="btn btn--sm" data-act="${a.id}" data-on="${a.active ? 0 : 1}">${a.active ? "Отключить" : "Включить"}</button>` : a.active ? "" : '<span class="tag tag--red">отключён</span>'}</td></tr>`).join("")}
      </tbody></table>
      <p class="muted" style="font-size:12px;margin:10px 0 0">Владелец — всё, включая роли. Админ — заказы и записи, зовёт наблюдателей. Наблюдатель — только смотрит.</p></div>
      ${canInvite ? `<div class="panel"><h2>Пригласить</h2><div class="inv"><select id="irole">${roles.map((r) => `<option value="${r}">${ROLE[r]}</option>`).join("")}</select>
        <button class="btn btn--red" id="inv">Создать ссылку</button></div><div id="ilink"></div>
        ${d.invites.length ? `<h2 style="margin-top:14px">Последние приглашения</h2><ul class="rank">${d.invites.map((i) => `<li><span>${esc(ROLE[i.role])} · ${esc(when(i.created))}</span><b>${i.used ? '<span class="tag tag--green">принято</span>' : i.expired ? '<span class="tag">истекло</span>' : '<span class="tag tag--amber">ждёт</span>'}</b></li>`).join("")}</ul>` : ""}</div>` : ""}
      <form class="panel" id="pw" style="max-width:420px"><h2>Сменить пароль</h2>
        <label class="field"><span>Старый пароль</span><input type="password" name="old" autocomplete="current-password" required></label>
        <label class="field"><span>Новый пароль, от 8 символов</span><input type="password" name="new" autocomplete="new-password" minlength="8" required></label>
        <button class="btn">Сохранить</button></form>
      </div>`;
    $$("[data-logout]", main).forEach((b) => b.addEventListener("click", logout));
    $("#inv")?.addEventListener("click", async () => {
      try {
        const r = await api("/invites", { role: $("#irole").value });
        const link = `${location.origin}/admin?invite=${r.code}`;
        $("#ilink").innerHTML = `<p class="muted" style="font-size:13px;margin:12px 0 0">Ссылка одноразовая, действует 7 дней. Отправь её человеку:</p><code class="code">${esc(link)}</code>
          <button class="btn btn--sm" style="margin-top:8px" id="cp">Скопировать</button>`;
        $("#cp").addEventListener("click", () => navigator.clipboard.writeText(link).then(() => toast("Ссылка скопирована"), () => toast("Выдели и скопируй вручную")));
      } catch (e) { toast(e.message); }
    });
    $$("[data-act]", main).forEach((b) => b.addEventListener("click", async () => {
      try { await api(`/team/${b.dataset.act}`, { active: b.dataset.on === "1" }); viewTeam(); } catch (e) { toast(e.message); }
    }));
    $$("[data-role]", main).forEach((s) => s.addEventListener("change", async () => {
      try { await api(`/team/${s.dataset.role}`, { role: s.value }); toast("Роль изменена"); } catch (e) { toast(e.message); }
    }));
    $("#pw").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await api("/password", { old: f.get("old"), new: f.get("new") }); toast("Пароль изменён"); e.target.reset(); } catch (err) { toast(err.message); }
    });
  }

  route();
})();
