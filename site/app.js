(() => {
  const { CONFIG, UNIVERSES, CHARACTERS, VIDEOS } = window;
  // Карточки, которые Влад добавил через бота: тот же персонаж дополняется новой версией,
  // новый — встаёт в конец своей коллекции
  // Коллекции, созданные через бота: рубашка — она же обложка и иконка
  (window.EXTRA_UNIVERSES || []).forEach(({ id, name, back }) => {
    if (!UNIVERSES.some((u) => u.id === id)) UNIVERSES.push({ id, name, icon: back, banner: null, back, accent: "#d8112f", glow: "#d8112f" });
  });
  (window.EXTRA_CARDS || []).forEach(({ id, universe, name, rarity }) => {
    if (!UNIVERSES.some((u) => u.id === universe)) return;
    const pair = [`assets/cards/db/${id}-a.jpg`, `assets/cards/db/${id}-b.jpg`];
    const same = CHARACTERS.find((c) => c.universe === universe && c.name.toLowerCase() === name.toLowerCase());
    if (same) same.variants[rarity] = pair;
    else CHARACTERS.push({ id: `db${id}`, universe, name, variants: { [rarity]: pair } });
  });
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const uni = (id) => UNIVERSES.find((u) => u.id === id);
  const char = (id) => CHARACTERS.find((c) => c.id === id);
  // Валюта выбирается переключателем BYN | RUS в шапке и запоминается
  let REGION = "RUS";
  try { if (localStorage.getItem("region") === "BYN") REGION = "BYN"; } catch {}
  const money = (v) => REGION === "BYN"
    ? `${Math.max(1, Math.round(v * CONFIG.bynPerRub)).toLocaleString("ru-RU")} BYN`
    : `${v.toLocaleString("ru-RU")} ${CONFIG.currency}`;
  const RARITY = { common: "Обычная", special: "Особая" };
  // Уменьшенная копия карточки (400 px) — для сеток и миниатюр
  const sm = (src) => src.replace("assets/cards/", "assets/cards/sm/");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Какая это страница сайта (body data-page): index, catalog, collection, builder, how, about, contacts, privacy, offer
  const PAGE = document.body.dataset.page || "index";
  const go = (url) => (location.href = url);
  const plural = (n, one, few, many) =>
    `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;
  // Акция 4+1 для нескольких одинаковых карточек: каждая пятая — бесплатно
  // Акция 4+1: за каждые 4 карточки — пятая, мистери-карточка, в подарок (её выбираем мы)
  const promo41 = (unit, qty) => {
    const free = window.CONFIG.promo41 ? Math.floor(qty / 4) : 0;
    return { free, discount: 0, total: unit * qty };
  };
  const mystery = (n) => `+${n}\u00a0${n === 1 ? "мистери-карточка" : n < 5 ? "мистери-карточки" : "мистери-карточек"} в\u00a0подарок`;
  const promoLine = (p) => p.free ? `• Акция 4+1: ${mystery(p.free)}` : null;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------------------------------------------------------------
  //  Стерео-карточка — «камера 360°».
  //  Перетаскивание плавно облетает карточку по горизонтали и вертикали;
  //  отпустил — она мягко дотормаживает и остаётся под этим углом.
  //  Кадр A ↔ B и голографический перелив зависят от угла обзора.
  //  На телефоне вертикальное вращение включено только там, где нет
  //  нужды прокручивать страницу пальцем по карточке (free: true).
  // ---------------------------------------------------------------
  const GIFT_ICON = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-1.5-3-5-3.5-5-1.5S10 7 12 7c2 0 5-.5 5-1.5S13.5 4 12 7"/></svg>`;
  const HEART = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/></svg>`;
  const heartBtn = (k) => `<button type="button" class="heart" data-fav="${k}" aria-pressed="false" aria-label="В избранное">${HEART}</button>`;
  const workKey = (w) => `${w.c.id}:${w.rarity}`;
  const SILHOUETTE = `<svg viewBox="0 0 100 100" fill="currentColor"><circle cx="50" cy="34" r="18"/><path d="M14 98c0-22 16-38 36-38s36 16 36 38z"/></svg>`;
  const REST = -0.3;      // наклон в покое: видно кадр A и немного объёма
  const DEG_PER_W = 140;  // протянуть на ширину карточки — повернуть на 140°
  const EASE = 0.12;      // доля пути до цели за кадр — плавность «камеры»
  const HOVER_EASE = 0.07; // наклон за курсором и возврат в покой — ещё мягче
  const FRICTION = 0.92;  // затухание инерции за кадр
  const rad = (d) => (d * Math.PI) / 180;
  const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  // mirror — элемент, которому тоже передаётся угол перелива (заголовок первого экрана)
  // rest — наклон в покое; canDrag — можно ли сейчас крутить; springBack — после отпускания вернуться лицом
  // hover — наклоняться за курсором мыши
  function Flip(el, { interactive = true, free = false, mirror = null, rest = REST, canDrag = null, springBack = false, hover = true } = {}) {
    el.innerHTML = `
      <div class="flip__tilt">
        <div class="flip__turn">
          <div class="face face--front"></div>
          <div class="face face--back"><img alt="Обратная сторона карточки" loading="lazy" width="600" height="824"><div class="face__holo"></div></div>
          ${free ? Array.from({ length: 9 }, (_, k) => `<i class="flip__layer" style="--k:${(k / 8 - 0.5).toFixed(3)}"></i>`).join("") : ""}
        </div>
      </div>`;
    if (free) el.dataset.free = "";
    const tilt = $(".flip__tilt", el);
    const front = $(".face--front", el);
    const backImg = $(".face--back img", el);
    let anim = null;
    // Ориентация: цель (куда тянет пользователь) и текущее положение (догоняет плавно)
    const tgt = { x: 0, y: 0 }, cur = { x: 0, y: 0 }, vel = { x: 0, y: 0 };
    let hx = REST, hy = 0;     // текущий наклон от курсора/анимации, [-1, 1]
    let thx = REST, thy = 0;   // к какому наклону плавно стремимся
    let raf = null, dragging = null, moved = false;

    function render() {
      const ay = cur.y + hx * 12;
      const ax = cur.x - hy * 9;
      tilt.style.transform = `rotateX(${ax}deg) rotateY(${ay}deg)`;
      // Кадр: правее нормали — B, левее — A, с плавным переходом ±9°
      const s = Math.sin(rad(ay)), v = Math.sin(rad(ax));
      el.style.setProperty("--mix", smooth(-0.15, 0.15, s).toFixed(3));
      // Перелив: чем дальше от «в лоб», тем ярче; полоса бежит по поверхности
      el.style.setProperty("--holo", Math.min(0.75, (Math.abs(s) + Math.abs(v)) * 1.1 + 0.06).toFixed(3));
      el.style.setProperty("--hpx", `${50 + s * 60}%`);
      el.style.setProperty("--hpy", `${50 - v * 60}%`);
      el.style.setProperty("--sheen", `${s * 160}%`);
      if (mirror) mirror.style.setProperty("--foil", `${50 + s * 90}%`);
    }

    function tick() {
      // Инерция после отпускания
      if (!dragging) {
        tgt.x += vel.x; tgt.y += vel.y;
        vel.x *= FRICTION; vel.y *= FRICTION;
        if (Math.abs(vel.x) < 0.01) vel.x = 0;
        if (Math.abs(vel.y) < 0.01) vel.y = 0;
      }
      cur.x += (tgt.x - cur.x) * EASE;
      cur.y += (tgt.y - cur.y) * EASE;
      hx += (thx - hx) * HOVER_EASE;
      hy += (thy - hy) * HOVER_EASE;
      render();
      const still = !dragging && !vel.x && !vel.y
        && Math.abs(tgt.x - cur.x) < 0.02 && Math.abs(tgt.y - cur.y) < 0.02
        && Math.abs(thx - hx) < 0.002 && Math.abs(thy - hy) < 0.002;
      raf = still ? ((cur.x = tgt.x), (cur.y = tgt.y), (hx = thx), (hy = thy), render(), null) : requestAnimationFrame(tick);
    }
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick); };

    // Сразу (для покадровых анимаций) и плавно (для курсора)
    function pose(x, y = 0) { hx = thx = x; hy = thy = y; render(); }
    function lean(x, y = 0) { thx = x; thy = y; wake(); }
    pose(rest);

    function stopAnim() { if (anim) cancelAnimationFrame(anim), (anim = null); }

    if (interactive) {
      el.addEventListener("pointerdown", (e) => {
        if (e.button > 0 || (canDrag && !canDrag())) return;
        stopAnim();
        const r = el.getBoundingClientRect();
        dragging = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, t: performance.now(), sx: tgt.x, sy: tgt.y, w: r.width, touch: e.pointerType !== "mouse",
          // Вверх ногами горизонталь зеркалится — компенсируем, чтобы «вправо» всегда было вправо
          flipY: Math.cos(rad(cur.x)) < 0 ? -1 : 1 };
        vel.x = vel.y = 0;
        moved = false;
      });
      el.addEventListener("pointermove", (e) => {
        stopAnim();
        el.classList.add("is-dragging");
        if (dragging) {
          const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
          if (!moved && Math.hypot(dx, dy) > 6) {
            // Палец идёт в основном вертикально — это прокрутка страницы, карточку не трогаем
            if (dragging.touch && !free && Math.abs(dy) > Math.abs(dx)) return void (dragging = null);
            moved = true;
            try { el.setPointerCapture(e.pointerId); } catch {}
          }
          if (moved) {
            const vertical = !dragging.touch || free;
            const k = DEG_PER_W / dragging.w;
            tgt.y = dragging.sy + dx * k * dragging.flipY;
            if (vertical) tgt.x = dragging.sx - dy * k;
            // Скорость в градусах за кадр (≈16 мс) — для мягкого дотормаживания
            const dt = Math.max(1, performance.now() - dragging.t);
            const cap = (v) => Math.max(-6, Math.min(6, v));
            vel.y = cap(((e.clientX - dragging.lx) * k * 16 * dragging.flipY) / dt);
            vel.x = vertical ? cap(((dragging.ly - e.clientY) * k * 16) / dt) : 0;
            dragging.lx = e.clientX; dragging.ly = e.clientY; dragging.t = performance.now();
            thx = 0; thy = 0;
            wake();
            return;
          }
        }
        if (hover && e.pointerType === "mouse" && (!canDrag || canDrag())) {
          const r = el.getBoundingClientRect();
          lean(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
        }
      });
      const release = () => {
        // Если палец/мышь замерли перед отпусканием — без инерции
        if (dragging && performance.now() - dragging.t > 80) vel.x = vel.y = 0;
        if (!dragging || !moved) vel.x = vel.y = 0;
        if (springBack && dragging) {
          vel.x = vel.y = 0;
          tgt.y = Math.round(tgt.y / 360) * 360;
          tgt.x = 0;
        }
        dragging = null;
        el.classList.remove("is-dragging");
        lean(rest, 0);
      };
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("pointerleave", () => { if (!dragging) release(); });
      // Если карточку крутили — это не клик
      el.addEventListener("click", (e) => { if (moved) e.stopImmediatePropagation(), e.preventDefault(), (moved = false); }, true);
    }

    return {
      el,
      // lazy=false — для главной карточки: грузится сразу и с высоким приоритетом
      setImages(a, b, lazy = true) {
        const imgA = $(".frame-a", front), imgB = $(".frame-b", front);
        // Меняем только src, чтобы при смене кадров не мигал чёрный фон
        if (imgA?.tagName === "IMG" && imgB?.tagName === "IMG" && !$(".custom", front)) {
          if (imgA.srcset) imgA.srcset = `${sm(a)} 400w, ${a} 780w`, imgB.srcset = `${sm(b)} 400w, ${b} 780w`;
          return void ((imgA.src = a), (imgB.src = b));
        }
        const load = lazy ? 'loading="lazy"' : 'fetchpriority="high"';
        // Полноразмерные кадры отдаём через srcset: телефону хватает копии 400 px
        const set = (src) => (src.includes("/sm/") ? "" : `srcset="${sm(src)} 400w, ${src} 780w" sizes="(max-width: 600px) 66vw, 400px"`);
        front.innerHTML = `<img class="frame-a" src="${a}" ${set(a)} alt="" width="780" height="1051" ${load}><img class="frame-b" src="${b}" ${set(b)} alt="" width="780" height="1051" ${lazy ? load : 'fetchpriority="low"'}><div class="face__lines"></div><div class="face__holo"></div><div class="face__sheen"></div>`;
      },
      // Поставить наклон сразу, без анимации (витрина двигает карточки при прокрутке)
      pose,
      // Повернуть вокруг вертикальной оси сразу (вращение на подиуме)
      spin(deg) { tgt.y = cur.y = deg; vel.y = 0; render(); },
      setCustom(html) { front.innerHTML = html; },
      setBack(src) { backImg.src = src; },
      setBadge(text) {
        $(".flip__badge", el)?.remove();
        if (text) tilt.insertAdjacentHTML("beforeend", `<span class="flip__badge">${GIFT_ICON}${esc(text)}</span>`);
      },
      // Перевернуть: force=true — на задник, false — на лицо, без аргумента — на 180° дальше
      turn(force) {
        const facing = Math.cos(rad(tgt.x)) * Math.cos(rad(tgt.y)) >= 0;
        if (force === undefined || force === facing) {
          // Доворачиваем ровно к ближайшей стороне и ещё на пол-оборота
          tgt.y = Math.round(tgt.y / 180) * 180 + 180;
          tgt.x = Math.round(tgt.x / 360) * 360;
          vel.x = vel.y = 0;
          wake();
        }
      },
      // Сразу (без анимации) поставить лицом
      reset() { tgt.x = tgt.y = cur.x = cur.y = vel.x = vel.y = 0; pose(rest); },
      // Покачать карточку: показать оба кадра
      sweep(duration = 1800) {
        stopAnim();
        const t0 = performance.now();
        const step = (t) => {
          const p = Math.min(1, (t - t0) / duration);
          pose(rest + Math.sin(p * Math.PI * 2) * 0.9 * (1 - p * 0.3));
          anim = p < 1 ? requestAnimationFrame(step) : null;
          if (!anim) pose(rest);
        };
        anim = requestAnimationFrame(step);
      },
      autoplay() {
        const t0 = performance.now();
        const loop = (t) => {
          if (!el.classList.contains("is-dragging")) {
            const s = Math.sin((t - t0) / 1300);
            lean(Math.sign(s) * Math.min(1, Math.abs(s) * 1.6) * 0.75, Math.cos((t - t0) / 2100) * 0.2);
          }
          requestAnimationFrame(loop);
        };
        if (!reduceMotion) requestAnimationFrame(loop);
      },
    };
  }

  function customFace({ photos = [], name, text, rarity, accent, num = "01", emptyLabel }) {
    const [a, b] = photos;
    const layerA = a ? `<img class="frame-a" src="${a}" alt="">` : `<div class="custom__empty">${SILHOUETTE}</div>`;
    // Если второго кадра нет — показываем первый в «боевом» цвете, чтобы эффект было видно
    const layerB = b
      ? `<img class="frame-b" src="${b}" alt="">`
      : a ? `<img class="frame-b" src="${a}" alt="" style="filter: contrast(1.25) saturate(1.5) hue-rotate(-12deg) brightness(.9)">` : "";
    return `
      <div class="custom" style="--c:${accent}">
        <div class="custom__photo">${layerA}${layerB}</div>
        <div class="custom__frame"></div>
        <span class="custom__num">${num}</span>
        <div class="custom__top"><span class="custom__rarity">${RARITY[rarity]}</span></div>
        <div class="custom__bottom">
          <span class="custom__name">${esc(name || emptyLabel || "Твоё имя")}</span>
          <p class="custom__text">${esc(text || "Здесь будет текст о герое")}</p>
        </div>
        <div class="face__lines"></div><div class="face__holo"></div><div class="face__sheen"></div>
      </div>`;
  }

  // ---------------------------------------------------------------
  //  Общий контент из конфига
  // ---------------------------------------------------------------
  // Название в две краски, как на макете: первое слово светлое, последнее — розовое
  $$("[data-brand]").forEach((n) => {
    const words = CONFIG.brand.split(" ");
    const last = words.pop();
    n.innerHTML = `${esc(words.join(" "))} <span class="logo__accent">${esc(last)}</span>`;
  });
  $$("[data-region]").forEach((b) => {
    b.classList.toggle("is-on", b.dataset.region === REGION);
    b.setAttribute("aria-pressed", b.dataset.region === REGION);
    b.addEventListener("click", () => {
      if (b.dataset.region === REGION) return;
      try { localStorage.setItem("region", b.dataset.region); } catch {}
      location.reload(); // все цены на странице пересчитаются в выбранной валюте
    });
  });
  $$("[data-tagline]").forEach((n) => (n.textContent = CONFIG.tagline));
  $$("[data-production]").forEach((n) => (n.textContent = CONFIG.production));
  $$("[data-price]").forEach((n) => (n.textContent = money(CONFIG.prices[n.dataset.price])));
  $$("[data-price-min]").forEach((n) => (n.textContent = money(Math.min(...Object.values(CONFIG.prices)))));
  $$("[data-tg-handle]").forEach((n) => (n.textContent = `@${CONFIG.telegramBot || CONFIG.telegram}`));
  if (PAGE === "index") document.title = `${CONFIG.brand} — ${CONFIG.tagline.toLowerCase()}`;
  // Покупатели пишут не лично Владу, а в бота — бот пересылает
  const tgUrl = `https://t.me/${CONFIG.telegramBot || CONFIG.telegram}`;
  $("#tgLink").href = tgUrl;
  $$("[data-tg-link]").forEach((a) => (a.href = tgUrl));

  // ---------------------------------------------------------------
  //  Выезжающие панели: меню, избранное, корзина
  // ---------------------------------------------------------------
  const burger = $("#burger");
  let drawer = null, drawerFrom = null;
  function openDrawer(id, from) {
    if (drawer) closeDrawer(false);
    drawer = $(id);
    drawerFrom = from;
    drawer.hidden = false;
    document.body.style.overflow = "hidden";
    from?.setAttribute("aria-expanded", true);
    $("[data-dclose]", drawer).focus();
  }
  function closeDrawer(restoreFocus = true) {
    if (!drawer) return;
    drawer.hidden = true;
    document.body.style.overflow = "";
    drawerFrom?.setAttribute("aria-expanded", false);
    if (restoreFocus) drawerFrom?.focus();
    drawer = drawerFrom = null;
  }
  $$(".drawer").forEach((d) => {
    d.addEventListener("click", (e) => {
      if (e.target === d || e.target.closest("[data-dclose]")) closeDrawer();
      else if (e.target.closest("a[href^='#']")) closeDrawer(false);
    });
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && drawer) closeDrawer(); });
  burger.addEventListener("click", () => openDrawer("#menuDrawer", burger));

  // Соцсети: пока ссылки нет — честно говорим «скоро» вместо пустой страницы
  const SOCIAL = {
    instagram: { name: "Instagram", url: CONFIG.instagram },
    tiktok: { name: "TikTok", url: CONFIG.tiktok },
    telegram: { name: "Telegram", url: CONFIG.telegramChannel || tgUrl },
  };
  $("#menuSocial").innerHTML = $$(".nav__social [data-social]")
    .map((a) => a.outerHTML.replace('class="soc"', 'class="icon-btn icon-btn--label"').replace(/igG/g, "igG2").replace("</svg>", `</svg>${SOCIAL[a.dataset.social].name}`))
    .join("");
  $$("[data-social]").forEach((a) => {
    const s = SOCIAL[a.dataset.social];
    if (s.url) return (a.href = s.url);
    a.href = "#";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      toast(`${s.name} скоро появится — пока пиши нам в Telegram`);
    });
  });

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 3200);
  }

  // ---------------------------------------------------------------
  //  Звуковые цитаты: одна дорожка за раз, плавное затухание
  // ---------------------------------------------------------------
  const Sound = (() => {
    const btn = $("#soundToggle");
    const audio = new Audio();
    audio.preload = "none";
    // Звук выключен, пока пользователь сам его не включит
    let on = false, src = null, fade = null;
    try { on = localStorage.getItem("sound") === "on"; } catch {}

    const sync = () => {
      btn.setAttribute("aria-pressed", on);
      btn.classList.toggle("is-playing", on && !audio.paused);
    };
    ["play", "pause", "ended"].forEach((ev) => audio.addEventListener(ev, sync));

    function stop() {
      clearInterval(fade);
      if (audio.paused) return (src = null);
      // Затухание за ~300 мс, чтобы не обрывать фразу резко
      fade = setInterval(() => {
        audio.volume = Math.max(0, audio.volume - 0.1);
        if (audio.volume === 0) clearInterval(fade), audio.pause(), (src = null);
      }, 30);
    }

    function play(next) {
      if (!on || !next) return;
      clearInterval(fade);
      audio.volume = 1;
      if (src === next && !audio.paused) return;
      src = next;
      audio.src = next;
      audio.play().catch(() => {});
    }

    btn.addEventListener("click", () => {
      on = !on;
      try { localStorage.setItem("sound", on ? "on" : "off"); } catch {}
      if (!on) stop();
      sync();
    });
    sync();
    return { play, stop };
  })();

  // Все готовые карточки (персонаж × версия)
  const WORKS = CHARACTERS.flatMap((c) =>
    Object.entries(c.variants).map(([rarity, [a, b]]) => ({ c, rarity, a, b }))
  );

  // ---------------------------------------------------------------
  //  Витрина первого экрана: коллекции на подиумах.
  //  Листается пальцем (родная прокрутка со «снапом») или мышью, по кругу.
  //  На подиуме — обложка серии; при наклоне и обороте видна карточка её героя.
  //  Нажатие на центральную — открывает коллекцию со всеми карточками.
  // ---------------------------------------------------------------
  if ($("#cfTrack")) (() => {
  const cfTrack = $("#cfTrack");
  const count = (u) => WORKS.filter((w) => w.c.universe === u.id).length;
  // Коллекций мало — повторяем ленту трижды, чтобы листать по кругу и видеть соседей с обеих сторон
  const N = UNIVERSES.length, LOOPS = 3;
  const SHOW = Array.from({ length: N * LOOPS }, (_, i) => UNIVERSES[i % N]);
  const START = N + Math.max(0, UNIVERSES.findIndex((u) => u.id === "berserk"));
  cfTrack.innerHTML = SHOW.map((u, i) => `
    <div class="cf__slide" role="group" aria-label="Коллекция ${esc(u.name)}" ${Math.floor(i / N) === 1 ? "" : 'aria-hidden="true"'}>
      <div class="cf__item">
        <div class="flip"></div>
        <span class="cf__glare" aria-hidden="true"></span>
        <span class="cf__label">${esc(u.short || u.name)}</span>
        <span class="cf__base" aria-hidden="true"></span>
      </div>
    </div>`).join("");
  const cfSlides = $$(".cf__slide", cfTrack);
  // Наклоняем и сдвигаем только внутренний блок: точки «примагничивания» ленты браузер считает
  // по внешнему, и если двигать его, они уезжают вместе с карточками — лента застревает
  const cfItems = cfSlides.map((sl) => sl.firstElementChild);
  const cfFlips = cfSlides.map((sl, i) => {
    const u = SHOW[i];
    // В витрине карточки стоят рубашкой (обложкой серии) и не крутятся — только листаются
    const f = Flip($(".flip", sl), { interactive: false, rest: -0.6 });
    f.setImages(u.back, u.back, Math.abs(i - START) > 1);
    f.setBack(u.back);
    return f;
  });
  $("#cfDots").innerHTML = UNIVERSES.map(() => "<i></i>").join("");
  $("#uniStrip").innerHTML = UNIVERSES.map((u) => `
    <button type="button" class="uni" role="tab" aria-selected="false" data-u="${u.id}" style="--c:${u.glow || u.accent}">
      <img src="${u.icon}" alt="" width="40" height="40" loading="lazy">
      <span class="uni__name">${esc(u.short || u.name)}</span></button>`).join("");
  $("#uniNext").addEventListener("click", () => $("#uniStrip").scrollBy({ left: $("#uniStrip").clientWidth * 0.8, behavior: reduceMotion ? "auto" : "smooth" }));

  let cfCenter = -1, cfRaf = null;
  function cfSetCenter(i) {
    cfCenter = i;
    const u = SHOW[i];
    cfSlides.forEach((sl, j) => sl.classList.toggle("is-center", j === i));
    // Сцена окрашивается в цвет серии, за карточкой — её название
    $(".hero").style.setProperty("--acc", u.glow || u.accent);
    $("#cfMark").textContent = (u.mark || u.short || u.name).toUpperCase();
    $$("#cfDots i").forEach((d, j) => d.classList.toggle("is-on", j === i % N));
    $$("#uniStrip [data-u]").forEach((t) => {
      const on = t.dataset.u === u.id;
      t.classList.toggle("is-on", on);
      t.setAttribute("aria-selected", on);
    });
  }
  // Центры карточек считаем один раз (и при смене ширины), а не в каждом кадре:
  // чтение offsetLeft после записи стилей заставляло браузер пересчитывать раскладку
  const CF_REST = -0.6;
  let cfCenters = [], cfW = 1, cfStep = 1, cfCard = 1;
  const cfMeasure = () => {
    cfW = cfSlides[0].offsetWidth;
    cfCard = cfItems[0].offsetWidth;
    cfCenters = cfSlides.map((sl) => sl.offsetLeft + cfW / 2);
    cfStep = cfCenters[1] - cfCenters[0];
  };
  const cfLast = [];
  function cfLayout() {
    cfRaf = null;
    const mid = cfTrack.scrollLeft + cfTrack.clientWidth / 2;
    let best = 0, bestD = Infinity;
    cfSlides.forEach((sl, i) => {
      const d = (cfCenters[i] - mid) / cfW; // в ширинах карточки
      const a = Math.min(Math.abs(d), 3);
      if (Math.abs(d) < bestD) (bestD = Math.abs(d)), (best = i);
      // Карточки далеко за краем не трогаем
      if (a >= 3 && cfLast[i] >= 3) return;
      cfLast[i] = a;
      // Пропорции сняты с макета: соседняя карточка — 0,69 центральной на расстоянии 1,1 ширины,
      // дальняя — 0,58 на расстоянии 1,83; все слегка развёрнуты к центру
      const side = Math.sign(d);
      const scale = a <= 1 ? 1 - 0.34 * a : a <= 2 ? 0.66 - 0.12 * (a - 1) : 0.54 - 0.1 * (a - 2);
      const shift = -side * (Math.min(a, 1) * 0.13 + Math.max(0, a - 1) * 0.4) * cfCard;
      const turn = -side * Math.min(a, 2) * 16;
      cfItems[i].style.transform = `translate3d(${shift.toFixed(1)}px, 0, 0) rotateY(${turn.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
      // Прозрачность у 3D-карточки ломает скрытие рубашки (на Android она просвечивает сквозь лицо),
      // поэтому карточки не полупрозрачные — дальние просто прячем
      cfItems[i].style.visibility = a > 2.6 ? "hidden" : "";
      sl.style.zIndex = 10 - Math.round(a);
      // Перелив и смена кадра — только у карточек рядом с центром.
      // В покое — чуть повёрнута к первому кадру: ровно «в лоб» оба кадра смешаны пополам
      if (a < 1.5) cfFlips[i].pose(Math.max(-1, Math.min(1, CF_REST - d * 1.6)));
    });
    if (best !== cfCenter) cfSetCenter(best);
  }
  const cfQueue = () => { if (!cfRaf) cfRaf = requestAnimationFrame(cfLayout); };
  function cfGo(i, smooth = true) {
    i = Math.max(0, Math.min(SHOW.length - 1, i));
    cfTrack.scrollTo({ left: cfCenters[i] - cfTrack.clientWidth / 2, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
  }
  // Ушли в крайнюю копию ленты — незаметно переносимся в такую же коллекцию в средней
  function cfRecenter() {
    const loop = Math.floor(cfCenter / N);
    if (loop === 1 || cfDrag) return;
    cfTrack.scrollLeft += (1 - loop) * N * cfStep;
    cfLayout();
  }
  cfTrack.addEventListener("scroll", cfQueue, { passive: true });
  // Колесо и тачпад над витриной: в основном вертикальный жест — только прокрутка страницы,
  // без случайного листания ленты боковой составляющей
  cfTrack.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    scrollBy(0, e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1));
  }, { passive: false });
  // На телефоне resize срабатывает и когда прячется адресная строка — реагируем только на смену ширины
  let cfWidth = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === cfWidth) return;
    cfWidth = innerWidth;
    cfMeasure();
    cfGo(cfCenter, false);
    cfQueue();
  });
  const cfOpen = () => go(`catalog/${SHOW[cfCenter].id}`);
  cfTrack.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.preventDefault(), cfGo(cfCenter + (e.key === "ArrowLeft" ? -1 : 1));
    if (e.key === "Enter") cfOpen();
  });

  // Мышью — тянуть, как пальцем; короткий клик по центральной открывает коллекцию
  let cfDrag = null, cfMoved = false;
  cfTrack.addEventListener("pointerdown", (e) => {
    cfMoved = false;
    if (e.pointerType !== "mouse" || e.button > 0) return;
    cfDrag = { x: e.clientX, left: cfTrack.scrollLeft };
  });
  addEventListener("pointermove", (e) => {
    if (!cfDrag) return;
    const dx = e.clientX - cfDrag.x;
    if (!cfMoved && Math.abs(dx) > 5) (cfMoved = true), cfTrack.classList.add("is-drag");
    if (cfMoved) cfTrack.scrollLeft = cfDrag.left - dx;
  });
  addEventListener("pointerup", () => {
    if (!cfDrag) return;
    cfDrag = null;
    if (!cfMoved) return;
    cfTrack.classList.remove("is-drag");
    cfGo(cfCenter);
  });
  cfTrack.addEventListener("click", (e) => {
    const sl = e.target.closest(".cf__slide");
    if (!sl || cfMoved) return;
    const i = cfSlides.indexOf(sl);
    i === cfCenter ? cfOpen() : cfGo(i);
  });

  // Полоса коллекций: листает витрину к ближайшей такой же коллекции
  $("#uniStrip").addEventListener("click", (e) => {
    const t = e.target.closest("[data-u]");
    if (!t) return;
    const near = SHOW.map((u, i) => (u.id === t.dataset.u ? i : -1)).filter((i) => i > -1)
      .sort((x, y) => Math.abs(x - cfCenter) - Math.abs(y - cfCenter))[0];
    near === cfCenter ? cfOpen() : cfGo(near);
  });

  // Лента остановилась — если ушли в крайнюю копию, переносимся в среднюю
  let cfIdle = null;
  cfTrack.addEventListener("scroll", () => { clearTimeout(cfIdle); cfIdle = setTimeout(cfRecenter, 220); }, { passive: true });

  // После того как весь скрипт отработал — встаём на стартовую коллекцию
  requestAnimationFrame(() => {
    cfMeasure();
    cfGo(START, false);
    cfLayout();
  });
  })();

  // ---------------------------------------------------------------
  //  Конструктор
  // ---------------------------------------------------------------
  // Конструктор есть только на странице /builder
  const initBuilder = () => {
  const state = {
    recipient: "self", giftName: "",
    mode: "character",
    universe: "berserk", character: "guts", otherChar: "",
    rarity: "special",
    photos: [null, null], photoName: "", photoText: "", style: "berserk",
    qty: 1,
  };
  const preview = Flip($("#previewCard"), { free: true });

  function segSet(group, value) {
    $$(`[data-group="${group}"] button`).forEach((b) => b.classList.toggle("is-on", b.dataset.value === value));
    $$(`[data-show-when^="${group}="]`).forEach((r) => r.classList.toggle("is-open", r.dataset.showWhen === `${group}=${value}`));
  }

  $$(".seg").forEach((seg) =>
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn || btn.disabled) return;
      state[seg.dataset.group] = btn.dataset.value;
      render();
    })
  );

  function renderUniverseChips() {
    $("#universeChips").innerHTML = UNIVERSES.map((u) =>
      `<button type="button" class="chip ${u.id === state.universe ? "is-on" : ""}" data-u="${u.id}"><img src="${u.icon}" alt="" width="128" height="128" loading="lazy">${esc(u.short || u.name)}</button>`
    ).join("");
    $("#styleChips").innerHTML = UNIVERSES.map((u) =>
      `<button type="button" class="chip ${u.id === state.style ? "is-on" : ""}" data-s="${u.id}"><img src="${u.icon}" alt="" width="128" height="128" loading="lazy">${esc(u.short || u.name)}</button>`
    ).join("");
  }
  $("#universeChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-u]");
    if (!b) return;
    state.universe = b.dataset.u;
    const first = CHARACTERS.find((c) => c.universe === state.universe);
    state.character = first ? first.id : "other";
    render();
  });
  $("#styleChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-s]");
    if (!b) return;
    state.style = b.dataset.s;
    render();
  });

  function renderCharacterGrid() {
    const list = CHARACTERS.filter((c) => c.universe === state.universe);
    $("#characterGrid").innerHTML =
      list.map((c) => {
        const [a] = c.variants.special || c.variants.common;
        return `<button type="button" class="pick__item ${c.id === state.character ? "is-on" : ""}" data-c="${c.id}"><span class="pick__img"><img src="${sm(a)}" alt="" width="400" height="539" loading="lazy"></span><span class="pick__name">${esc(c.name)}</span></button>`;
      }).join("") +
      `<button type="button" class="pick__item pick__item--other ${state.character === "other" ? "is-on" : ""}" data-c="other"><span class="pick__img"><b>+</b></span><span class="pick__name">${list.length ? "Другой" : "Любой"}</span></button>`;
    $("#otherCharBox").classList.toggle("is-open", state.character === "other");
  }
  $("#characterGrid").addEventListener("click", (e) => {
    const b = e.target.closest("[data-c]");
    if (!b) return;
    state.character = b.dataset.c;
    render();
    if (state.character === "other") $("#otherChar").focus();
  });

  // Доступные версии для текущего выбора
  function availableRarities() {
    if (state.mode === "photo") return ["special"]; // у карточки по фото одна цена — выбор версии скрыт
    if (state.character === "other") return ["special"];
    return Object.keys(char(state.character).variants);
  }

  function unitPrice() {
    return state.mode === "photo" ? CONFIG.prices.custom : CONFIG.prices[state.rarity];
  }

  function describeCard() {
    if (state.mode === "photo") return `По фото: ${state.photoName || "без имени"}, стиль «${uni(state.style).name}»`;
    const u = uni(state.universe).name;
    if (state.character === "other") return `${state.otherChar || "Персонаж не указан"} (под заказ), ${u}`;
    return `${char(state.character).name}, ${u}`;
  }

  function renderPreview() {
    if (state.mode === "character" && state.character !== "other") {
      const [a, b] = char(state.character).variants[state.rarity];
      preview.setImages(a, b);
      preview.setBack(uni(state.universe).back);
    } else if (state.mode === "character") {
      const u = uni(state.universe);
      preview.setCustom(customFace({
        name: state.otherChar, emptyLabel: "Твой герой",
        text: "Арт нарисуем специально под заказ", rarity: state.rarity, accent: u.accent,
      }));
      preview.setBack(u.back);
    } else {
      const u = uni(state.style);
      preview.setCustom(customFace({
        photos: state.photos, name: state.photoName, text: state.photoText,
        rarity: state.rarity, accent: u.accent,
      }));
      preview.setBack(u.back);
    }
    preview.setBadge(state.recipient === "gift" ? state.giftName || "Подарок" : "");
  }

  // Индивидуальная карточка — по фото или свой персонаж «под заказ»
  const isCustom = () => state.mode === "photo" || state.character === "other";
  // Акция 2+1: за каждые 2 индивидуальные карточки — любая карточка каталога в подарок (вместо 4+1)
  const gifts21 = () => (CONFIG.promo21 !== false && isCustom() ? Math.floor(state.qty / 2) : 0);
  const p41 = () => (isCustom() ? { free: 0, discount: 0, total: unitPrice() * state.qty } : promo41(unitPrice(), state.qty));
  const giftName = () => {
    const w = WORKS[+$("#gift21Card").value] || WORKS[0];
    return `${w.c.name}, ${uni(w.c.universe).short || uni(w.c.universe).name} (${RARITY[w.rarity].toLowerCase()})`;
  };
  $("#gift21Card").innerHTML = WORKS.map((w, i) => `<option value="${i}">${esc(w.c.name)} — ${esc(uni(w.c.universe).short || uni(w.c.universe).name)}, ${RARITY[w.rarity].toLowerCase()}</option>`).join("");
  $("#gift21Card").addEventListener("change", () => renderSummary());
  const gift21Line = () => {
    const n = gifts21();
    if (!n) return null;
    return n === 1 ? `в подарок: ${giftName()}` : `в подарок ${n} карточки из каталога (первая: ${giftName()}, остальные выберем в чате)`;
  };

  function renderSummary() {
    const g = gifts21();
    $("#gift21").hidden = !g;
    if (g) $("#gift21Text").textContent = g === 1 ? "— выбери карточку из каталога, она будет бесплатно." : `— тебе положено ${g} подарочные карточки: первую выбери здесь, остальные — в чате.`;
    const rows = [
      ["Карточка", describeCard()],
      state.mode === "photo" ? null : ["Версия", RARITY[state.rarity]],
      ["Количество", `${state.qty} × ${money(unitPrice())}`],
      p41().free ? ["Акция 4+1", mystery(p41().free)] : null,
      g ? ["Акция 2+1", gift21Line()] : null,
    ].filter(Boolean);
    $("#summaryRows").innerHTML = rows.map(([k, v]) => `<div class="${k.startsWith("Акция") ? "is-promo" : ""}"><span>${k}</span><b>${esc(v)}</b></div>`).join("");
    $("#total").textContent = money(p41().total);
  }

  // Миниатюра и сумма в нижней панели (мобильные)
  function renderBar() {
    let thumb = "";
    if (state.mode === "character" && state.character !== "other") thumb = sm(char(state.character).variants[state.rarity][0]);
    else if (state.mode === "photo" && state.photos[0]) thumb = state.photos[0];
    // Нет своей картинки — показываем рубашку серии, а не плоский цветной квадрат
    const back = uni(state.mode === "photo" ? state.style : state.universe).back;
    $("#mbarThumb").style.backgroundImage = `url("${thumb || back}")`;
    $("#mbarThumb").style.backgroundColor = "#000";
    $("#mbarTitle").textContent = describeCard();
    $("#mbarTotal").textContent = money(p41().total);
  }

  function render() {
    const avail = availableRarities();
    if (!avail.includes(state.rarity)) state.rarity = avail[avail.length - 1];
    $$('[data-group="rarity"] button').forEach((b) => (b.disabled = !avail.includes(b.dataset.value)));
    $("#rarityNote").textContent =
      avail.length === 1 ? (state.character === "other" ? "Персонажи под заказ делаются в особой версии." : `У этого персонажа есть только ${RARITY[avail[0]].toLowerCase()} версия.`) : "";

    ["mode", "rarity"].forEach((g) => segSet(g, state[g]));
    $("#rarityField").hidden = state.mode === "photo";
    renderUniverseChips();
    renderCharacterGrid();
    renderPreview();
    renderSummary();
    renderBar();
    $("#qty").textContent = state.qty;
  }

  // Текстовые поля
  [["otherChar", "otherChar"], ["photoName", "photoName"], ["photoText", "photoText"]].forEach(([id, key]) =>
    $("#" + id).addEventListener("input", (e) => {
      state[key] = e.target.value.trim();
      renderPreview();
      renderSummary();
      renderBar();
      if (key === "otherChar") renderCharacterGrid();
    })
  );

  // Загрузка фото (только локально, в браузере)
  $$(".upload input").forEach((input) =>
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      const slot = +input.dataset.slot;
      if (state.photos[slot]) URL.revokeObjectURL(state.photos[slot]);
      state.photos[slot] = URL.createObjectURL(file);
      const thumb = $(".upload__img", input.closest(".upload"));
      thumb.style.backgroundImage = `url(${state.photos[slot]})`;
      thumb.textContent = " ";
      renderPreview();
      renderBar();
      if (slot === 1) preview.sweep();
    })
  );

  $$("[data-qty]").forEach((b) =>
    b.addEventListener("click", () => {
      state.qty = Math.min(50, Math.max(1, state.qty + +b.dataset.qty));
      render();
    })
  );

  $("#tiltBtn").addEventListener("click", () => { preview.turn(false); preview.sweep(); });
  $("#turnBtn").addEventListener("click", () => preview.turn());

  // Нижняя панель видна, пока пользователь внутри конструктора, но блок с итогом не на экране
  const mbar = $("#mbar");
  const seen = { builder: false, summary: false, preview: false };
  const syncBar = () => {
    const on = seen.builder && !seen.summary && !seen.preview;
    mbar.classList.toggle("is-on", on);
    mbar.inert = !on; // скрытая панель не должна ловить фокус с клавиатуры
  };
  const barIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => (seen[en.target.dataset.bar] = en.isIntersecting));
    syncBar();
  });
  [["#builder", "builder"], [".summary", "summary"], [".preview", "preview"]].forEach(([s, k]) => {
    $(s).dataset.bar = k;
    barIO.observe($(s));
  });
  $("#mbarThumb").addEventListener("click", () => $(".preview").scrollIntoView({ block: "center" }));
  $("#mbarOrder").addEventListener("click", () => $("#orderBtn").click());

  $("#orderBtn").addEventListener("click", () =>
    sendOrder([
      `Привет! Хочу заказать карточку:`,
      `• Карточка: ${describeCard()}`,
      state.mode === "photo" ? null : `• Версия: ${RARITY[state.rarity]}`,
      state.mode === "photo" && state.photoText ? `• Текст: ${state.photoText}` : null,
      `• Количество: ${state.qty}`,
      promoLine(p41()),
      gifts21() ? `• Акция 2+1: ${gift21Line()}` : null,
      `• Сумма: ${money(p41().total)}`,
    ], { photos: state.mode === "photo" ? state.photos : [] })
  );

  // С других страниц сюда приходят с готовым выбором в адресе:
  //   ?c=guts&r=special&q=2 — карточка из каталога, ?other=Имя&u=aot — свой персонаж,
  //   ?preset=common|special|photo — кнопка «Выбрать» на странице цен
  const qp = new URLSearchParams(location.search);
  const pc = char(qp.get("c"));
  if (pc) Object.assign(state, { mode: "character", universe: pc.universe, character: pc.id, rarity: pc.variants[qp.get("r")] ? qp.get("r") : state.rarity, qty: Math.min(50, Math.max(1, +qp.get("q") || 1)) });
  if (qp.has("other")) {
    Object.assign(state, { mode: "character", universe: uni(qp.get("u")) ? qp.get("u") : state.universe, character: "other", otherChar: qp.get("other").slice(0, 60), rarity: "special" });
    $("#otherChar").value = state.otherChar;
  }
  if (qp.get("promo") === "21") {
    state.qty = Math.max(state.qty, 2);
    $("#builder .sub")?.insertAdjacentHTML("afterend", `<p class="promo-note"><b>Акция 2+1</b><span>Закажи 2 индивидуальные карточки — по фото или своего персонажа — и выбери любую карточку из каталога в подарок.</span></p>`);
  }
  if (qp.get("promo") === "41") {
    state.qty = Math.max(state.qty, 4);
    $("#builder .sub")?.insertAdjacentHTML("afterend", `<p class="promo-note"><b>Акция 4+1</b><span>Выбери 4 карточки — пятую, мистери-карточку, добавим в подарок.</span></p>`);
  }
  const preset = qp.get("preset");
  if (preset === "photo") state.mode = "photo";
  else if (preset === "common" || preset === "special") {
    state.rarity = preset;
    if (preset === "common" && !char(state.character)?.variants.common) Object.assign(state, { universe: "berserk", character: "guts" });
  }
  render();
  };

  // ---------------------------------------------------------------
  //  Оформление заказа: форма → /api/order → бот присылает заказ в Telegram.
  //  Если сервер недоступен — запасной путь: копируем текст и открываем чат.
  // ---------------------------------------------------------------
  const om = $("#orderModal");
  let omOrder = null;

  // Сжать фото в браузере перед отправкой (до 1600 px, JPEG)
  function shrinkPhoto(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function sendOrder(lines, { photos = [], onSent = null } = {}) {
    omOrder = { lines: lines.filter(Boolean), photos: photos.filter(Boolean), onSent };
    // Строки заказа «• Ключ: значение» показываем как чек; сумма — отдельной строкой внизу
    const rows = omOrder.lines.slice(1).map((l) => l.replace(/^•\s*/, "").split(/:\s(.*)/s));
    if (omOrder.photos.length) rows.splice(rows.length - 1, 0, ["Фото", String(omOrder.photos.length)]);
    $("#omLines").innerHTML = rows.map(([k, v], i) =>
      `<div class="${i === rows.length - 1 ? "is-total" : ""}"><dt>${esc(k)}</dt><dd>${esc(v ?? "")}</dd></div>`).join("");
    try {
      const saved = JSON.parse(localStorage.getItem("orderContact") || "{}");
      if (saved.name && !$("#omName").value) $("#omName").value = saved.name;
      if (!$("#omContact").value) {
        if (CONTACT[saved.method] && $(`#omMethod [data-m="${saved.method}"]`)) setMethod(saved.method);
        if (saved.value || saved.contact) $("#omContact").value = saved.value || saved.contact;
      }
    } catch {}
    $("#omErr").hidden = true;
    $("#omForm").hidden = false;
    $("#omDone").hidden = true;
    $("#omSubmit").disabled = false;
    $("#omSubmit").textContent = "Отправить заказ";
    om.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => ($("#omContact").value ? $("#omSubmit") : $("#omContact")).focus(), 50);
  }

  // Где написать покупателю: Telegram у него может и не быть
  const CONTACT = {
    tg: { name: "Telegram", label: "Ник в Telegram", ph: "@nickname", mode: "text", ac: "username" },
    wa: { name: "WhatsApp", label: "Номер WhatsApp", ph: "+7 900 000-00-00", mode: "tel", ac: "tel" },
    vk: { name: "ВК", label: "Ссылка или ник ВКонтакте", ph: "vk.com/nickname", mode: "text", ac: "off" },
    tt: { name: "TikTok", label: "Ник в TikTok", ph: "@nickname", mode: "text", ac: "off" },
    ph: { name: "Телефон", label: "Номер телефона", ph: "+7 900 000-00-00", mode: "tel", ac: "tel" },
  };
  let contactMethod = "tg";
  function setMethod(m) {
    contactMethod = m;
    const c = CONTACT[m], input = $("#omContact");
    $$("#omMethod [data-m]").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.m === m);
      b.setAttribute("aria-checked", b.dataset.m === m);
    });
    $("#omContactLabel").textContent = `${c.label} *`;
    input.placeholder = c.ph;
    input.inputMode = c.mode;
    input.autocomplete = c.ac;
    input.type = c.mode === "tel" ? "tel" : "text";
  }
  $("#omMethod").addEventListener("click", (e) => {
    const b = e.target.closest("[data-m]");
    if (!b || b.dataset.m === contactMethod) return;
    setMethod(b.dataset.m);
    $("#omContact").value = "";
    $("#omContact").focus();
  });

  function closeOrder() {
    om.hidden = true;
    if (lb.hidden) document.body.style.overflow = "";
  }
  $$("[data-oclose]", om).forEach((b) => b.addEventListener("click", closeOrder));
  om.addEventListener("click", (e) => { if (e.target === om) closeOrder(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !om.hidden) closeOrder(); });

  $("#orderForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#omName").value.trim(), value = $("#omContact").value.trim(), comment = $("#omComment").value.trim();
    $("#omContact").classList.toggle("is-bad", !value);
    $("#omContact").setAttribute("aria-invalid", !value);
    if (!value) {
      $("#omErr").textContent = `Укажи, куда тебе написать: ${CONTACT[contactMethod].label.toLowerCase()}.`;
      $("#omErr").hidden = false;
      return $("#omContact").focus();
    }
    // В заказе сразу видно, куда писать: «ВК: vk.com/…», «TikTok: @nick»
    const contact = `${CONTACT[contactMethod].name}: ${value}`;
    if (!$("#omConsent").checked) {
      $("#omErr").textContent = "Отметь согласие — без него мы не можем принять контакт.";
      $("#omErr").hidden = false;
      return $("#omConsent").focus();
    }
    try { localStorage.setItem("orderContact", JSON.stringify({ name, method: contactMethod, value })); } catch {}

    const btn = $("#omSubmit");
    btn.disabled = true;
    btn.textContent = omOrder.photos.length ? "Отправляем фото…" : "Отправляем…";
    $("#omErr").hidden = true;
    try {
      const photos = (await Promise.all(omOrder.photos.map(shrinkPhoto))).filter(Boolean);
      const res = await fetch("api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: omOrder.lines.slice(1), name, contact, comment, photos }), // без приветствия
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Не удалось отправить заказ");
      $("#omForm").hidden = true;
      $("#omDone").hidden = false;
      $("#omComment").value = "";
      omOrder.onSent?.();
    } catch (err) {
      $("#omErr").textContent = `${err.message}. Попробуй ещё раз или напиши нам в Telegram — текст заказа скопируем.`;
      $("#omErr").hidden = false;
      btn.disabled = false;
      btn.textContent = "Отправить заказ";
    }
  });

  // Запасной путь: копируем текст и открываем чат
  $("#omAlt").addEventListener("click", async () => {
    const text = omOrder.lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Текст заказа скопирован — вставь его в чат");
    } catch {
      toast("Открываю Telegram — опиши заказ в чате");
    }
    window.open(tgUrl, "_blank", "noopener");
  });

  // ---------------------------------------------------------------
  //  Коллекции: плитки вселенных → мини-карточки серии
  // ---------------------------------------------------------------
  const collectionsEl = $("#collections"), collectionEl = $("#collection"), gallery = $("#gallery");
  // Коллекции — запечатанные паки: при наведении верх отрывается и выглядывает карточка героя
  if (collectionsEl) collectionsEl.innerHTML = UNIVERSES.map((u) => {
    const items = WORKS.filter((w) => w.c.universe === u.id);
    const n = items.length;
    const peek = items.find((w) => w.rarity === "special") || items[0];
    return `
      <button type="button" class="col-tile pack ${n ? "" : "col-tile--soon"}" data-col="${u.id}" style="--c:${u.accent}">
        ${peek ? `<img class="pack__card" src="${sm(peek.a)}" alt="" width="400" height="539" loading="lazy">` : ""}
        <span class="pack__body">
          <img src="${u.back}" alt="" width="600" height="824" loading="lazy">
          <span class="col-tile__info">
            ${n ? "" : `<span class="col-tile__tag">Под заказ</span>`}
            <b>${esc(u.name)}</b>
            <span>${n ? plural(n, "карточка", "карточки", "карточек") : "Арты скоро появятся на сайте"}</span>
          </span>
        </span>
        <span class="pack__top" aria-hidden="true"><img src="${u.back}" alt="" width="600" height="824" loading="lazy"></span>
      </button>`;
  }).join("");

  let galleryFlips = [];

  function openCollection(id) {
    const u = uni(id);
    const items = WORKS.filter((w) => w.c.universe === id);
    $("#colTitle").textContent = u.name;
    $("#colIcon").src = u.icon;
    $("#colCount").textContent = items.length
      ? `${plural(items.length, "карточка", "карточки", "карточек")} — нажми, чтобы заказать`
      : "Карточки под заказ";
    $("#colEmpty").hidden = items.length > 0;
    $("#colCustom").href = `builder?u=${id}&other=`;
    document.title = `${u.name} — ${CONFIG.brand}`;

    gallery.innerHTML = "";
    galleryFlips = items.map((w) => {
      const i = WORKS.indexOf(w);
      const item = document.createElement("div");
      item.className = "work";
      item.innerHTML = `
        <div class="flip"></div>
        <div class="work__meta"><b>${esc(w.c.name)}</b><span>${RARITY[w.rarity]}</span>${heartBtn(workKey(w))}</div>
        <div class="work__buy"><b>${money(CONFIG.prices[w.rarity])}</b><button type="button" class="btn btn--sm">Заказать</button></div>`;
      gallery.append(item);
      const f = Flip($(".flip", item));
      f.setImages(sm(w.a), sm(w.b));
      f.setBack(u.back);
      // Клик по карточке (не вращение) или по кнопке — окно товара
      $(".flip", item).addEventListener("click", () => openProduct(i));
      $(".work__meta", item).addEventListener("click", (e) => !e.target.closest("[data-fav]") && openProduct(i));
      $(".btn", item).addEventListener("click", () => openProduct(i));
      return f;
    });

    syncHearts();
  }

  // Какая коллекция открыта на странице /catalog/<id>
  const pageCollection = PAGE === "collection" ? location.pathname.split("/").filter(Boolean)[1] : null;
  if (collectionsEl) {
    if (PAGE === "collection") {
      if (!uni(pageCollection)) location.replace("catalog");
      else {
        collectionsEl.hidden = true;
        collectionEl.hidden = false;
      }
    }
    collectionsEl.addEventListener("click", (e) => {
      const t = e.target.closest("[data-col]");
      if (!t) return;
      // Сначала пак «вскрывается» (на телефоне — это единственный способ увидеть анимацию), потом переход
      t.classList.add("is-open");
      setTimeout(() => go(`catalog/${t.dataset.col}`), reduceMotion ? 0 : 480);
    });
    $("#colBack").addEventListener("click", () => go("catalog"));
  }

  // ---------------------------------------------------------------
  //  Окно товара: вращаемая карточка, версия, количество, заказ
  // ---------------------------------------------------------------
  const lb = $("#lightbox");
  const lbCard = Flip($("#lightboxCard"), { free: true });
  const lbState = { c: null, rarity: "special", qty: 1 };

  function renderProduct() {
    const { c, rarity, qty } = lbState;
    const [a, b] = c.variants[rarity];
    lbCard.setImages(a, b);
    lbCard.setBack(uni(c.universe).back);
    $("#lbUni").textContent = uni(c.universe).name;
    $("#lbTitle").textContent = c.name;
    const rs = Object.keys(c.variants);
    $("#lbRarity").hidden = rs.length < 2;
    $("#lbRarity").innerHTML = rs.map((r) => `<button type="button" data-r="${r}" class="${r === rarity ? "is-on" : ""}">${RARITY[r]}</button>`).join("");
    $("#lbQty").textContent = qty;
    $("#lbUnit").textContent = `${money(CONFIG.prices[rarity])} за штуку`;
    $("#lbTotal").textContent = money(promo41(CONFIG.prices[rarity], qty).total);
    $("#lbFav").dataset.fav = `${c.id}:${rarity}`;
    syncHearts();
  }

  function openProduct(i) {
    const w = WORKS[i];
    Object.assign(lbState, { c: w.c, rarity: w.rarity, qty: 1 });
    lbCard.reset();
    renderProduct();
    lb.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => lbCard.sweep(), 250);
    w.c.quote ? Sound.play(w.c.quote) : Sound.stop();
  }
  function closeLightbox() { lb.hidden = true; document.body.style.overflow = ""; Sound.stop(); }

  $("#lbRarity").addEventListener("click", (e) => {
    const b = e.target.closest("[data-r]");
    if (!b) return;
    lbState.rarity = b.dataset.r;
    renderProduct();
    lbCard.sweep(1200);
  });
  $$("[data-lbqty]").forEach((b) =>
    b.addEventListener("click", () => {
      lbState.qty = Math.min(50, Math.max(1, lbState.qty + +b.dataset.lbqty));
      renderProduct();
    })
  );
  $(".lightbox__close").addEventListener("click", closeLightbox);
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLightbox(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !lb.hidden) closeLightbox(); });
  $("#lbTurn").addEventListener("click", () => lbCard.turn());
  $("#lbOrder").addEventListener("click", () => {
    const { c, rarity, qty } = lbState;
    sendOrder([
      `Привет! Хочу заказать карточку:`,
      `• Карточка: ${c.name}, ${uni(c.universe).name}`,
      `• Версия: ${RARITY[rarity]}`,
      `• Количество: ${qty}`,
      promoLine(promo41(CONFIG.prices[rarity], qty)),
      `• Сумма: ${money(promo41(CONFIG.prices[rarity], qty).total)}`,
    ]);
  });
  $("#lbWant").addEventListener("click", () => {
    const { c, rarity, qty } = lbState;
    go(`builder?c=${c.id}&r=${rarity}&q=${qty}`);
  });

  $("#lbCart").addEventListener("click", () => {
    const { c, rarity, qty } = lbState;
    addToCart(`${c.id}:${rarity}`, qty);
  });

  // ---------------------------------------------------------------
  //  Избранное и корзина: хранятся в браузере покупателя
  // ---------------------------------------------------------------
  const MAX_CART = 25; // столько позиций помещается в одно сообщение заказа
  const load = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
  const keep = (key, v) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} };
  const workByKey = (k) => WORKS.find((w) => workKey(w) === k);
  const thumbOf = (w) => `style="background-image:url('${sm(w.a)}')"`;
  let favs = load("favs").filter(workByKey);
  let cart = load("cart").filter((it) => workByKey(it.k));

  function syncHearts() {
    $$("[data-fav]").forEach((b) => {
      const on = favs.includes(b.dataset.fav);
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on);
      b.setAttribute("aria-label", on ? "Убрать из избранного" : "В избранное");
    });
  }
  function bump(el, n) {
    el.textContent = n;
    el.hidden = !n;
    el.classList.remove("is-bump");
    void el.offsetWidth;
    el.classList.add("is-bump");
  }
  function toggleFav(k) {
    favs = favs.includes(k) ? favs.filter((x) => x !== k) : [k, ...favs];
    keep("favs", favs);
    bump($("#favCount"), favs.length);
    syncHearts();
    renderFavs();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fav]");
    if (b) e.stopPropagation(), toggleFav(b.dataset.fav);
  });

  function addToCart(k, qty = 1) {
    const it = cart.find((x) => x.k === k);
    if (it) it.qty = Math.min(50, it.qty + qty);
    else if (cart.length >= MAX_CART) return toast(`В корзине уже ${MAX_CART} позиций — оформи их, потом добавим ещё`);
    else cart.push({ k, qty });
    keep("cart", cart);
    bump($("#cartCount"), cart.reduce((n, x) => n + x.qty, 0));
    renderCart();
    toast(`${workByKey(k).c.name} в корзине`);
  }
  function setCart(next) {
    cart = next;
    keep("cart", cart);
    bump($("#cartCount"), cart.reduce((n, x) => n + x.qty, 0));
    renderCart();
  }

  const emptyState = (text) => `
    <div class="dempty"><p>${text}</p><a href="catalog" class="btn btn--ghost btn--full">Открыть каталог</a></div>`;
  const itemHead = (w) => `
    <button type="button" class="ditem__img" data-open="${workKey(w)}" ${thumbOf(w)} aria-label="Открыть ${esc(w.c.name)}"></button>
    <div class="ditem__info"><b>${esc(w.c.name)}</b><span>${esc(uni(w.c.universe).name)}, ${RARITY[w.rarity].toLowerCase()}</span>`;

  function renderFavs() {
    $("#favList").innerHTML = favs.length
      ? favs.map((k) => {
          const w = workByKey(k);
          return `<div class="ditem">${itemHead(w)}<em>${money(CONFIG.prices[w.rarity])}</em></div>
            <div class="ditem__act"><button type="button" class="btn btn--sm" data-tocart="${k}">В корзину</button>${heartBtn(k)}</div></div>`;
        }).join("")
      : emptyState("Нажми на сердечко у карточки — она сохранится здесь.");
    syncHearts();
  }

  // Итог корзины с акцией 4+1: на каждые 5 карточек самая дешёвая — бесплатно
  function cartSum() {
    const units = cart.flatMap(({ k, qty }) => Array(qty).fill(CONFIG.prices[workByKey(k).rarity])).sort((a, b) => a - b);
    const full = units.reduce((n, v) => n + v, 0);
    const free = CONFIG.promo41 ? Math.floor(units.length / 4) : 0;
    return { count: units.length, full, free, discount: 0, total: full };
  }

  function renderCart() {
    $("#cartFoot").hidden = !cart.length;
    $("#cartList").innerHTML = cart.length
      ? cart.map(({ k, qty }) => {
          const w = workByKey(k);
          return `<div class="ditem">${itemHead(w)}<em>${money(CONFIG.prices[w.rarity] * qty)}</em></div>
            <div class="ditem__act">
              <div class="qty qty--sm"><button type="button" data-cq="${k}" data-d="-1" aria-label="Меньше">−</button><output>${qty}</output><button type="button" data-cq="${k}" data-d="1" aria-label="Больше">+</button></div>
              <button type="button" class="icon-btn icon-btn--sm" data-cdel="${k}" aria-label="Убрать ${esc(w.c.name)}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
            </div></div>`;
        }).join("")
      : emptyState("Корзина пуста. Добавь карточки из каталога — оформим всё одним заказом.");
    const sum = cartSum();
    $("#cartTotal").textContent = money(sum.total);
    $("#cartPromo").hidden = !CONFIG.promo41 || !sum.count;
    $("#cartPromo").innerHTML = sum.free
      ? `Акция 4+1: ${mystery(sum.free)}\u00a0🎁`
      : `Акция 4+1: добавь ещё ${plural(4 - (sum.count % 4), "карточку", "карточки", "карточек")} — и получишь мистери-карточку в подарок`;
    $("#cartPromo").classList.toggle("is-on", sum.free > 0);
  }

  [$("#favList"), $("#cartList")].forEach((list) =>
    list.addEventListener("click", (e) => {
      const open = e.target.closest("[data-open]"), add = e.target.closest("[data-tocart]");
      const q = e.target.closest("[data-cq]"), del = e.target.closest("[data-cdel]");
      if (open) closeDrawer(false), openProduct(WORKS.indexOf(workByKey(open.dataset.open)));
      if (add) addToCart(add.dataset.tocart);
      if (q) setCart(cart.map((it) => it.k === q.dataset.cq ? { ...it, qty: Math.min(50, Math.max(1, it.qty + +q.dataset.d)) } : it));
      if (del) setCart(cart.filter((it) => it.k !== del.dataset.cdel));
    })
  );
  $("#favBtn").addEventListener("click", (e) => openDrawer("#favDrawer", e.currentTarget));
  $("#cartBtn").addEventListener("click", (e) => openDrawer("#cartDrawer", e.currentTarget));
  $("#cartOrder").addEventListener("click", () => {
    const items = cart.map(({ k, qty }) => ({ w: workByKey(k), qty }));
    closeDrawer(false);
    sendOrder([
      `Привет! Хочу заказать карточки:`,
      ...items.map(({ w, qty }) => `• ${w.c.name}, ${uni(w.c.universe).name} (${RARITY[w.rarity].toLowerCase()}): ${qty} × ${money(CONFIG.prices[w.rarity])}`),
      `• Всего карточек: ${cartSum().count}`,
      cartSum().free ? `• Акция 4+1: ${mystery(cartSum().free)}` : null,
      `• Сумма: ${money(cartSum().total)}`,
    ], { onSent: () => setCart([]) });
  });

  bump($("#favCount"), favs.length);
  bump($("#cartCount"), cart.reduce((n, x) => n + x.qty, 0));
  renderFavs();
  renderCart();

  // ---------------------------------------------------------------
  //  Поиск по каталогу: персонажи и вселенные
  // ---------------------------------------------------------------
  const norm = (t) => String(t || "").toLowerCase().replace(/ё/g, "е");
  const searchIndex = [
    ...UNIVERSES.map((u) => ({ u, text: norm(`${u.name} ${u.id}`) })),
    ...CHARACTERS.map((c) => ({ c, text: norm(`${c.name} ${c.subtitle || ""} ${c.id} ${uni(c.universe).name}`) })),
  ];
  const sInput = $("#searchInput"), sRes = $("#searchRes");
  // На телефоне поле узкое — короткая подсказка
  const narrow = matchMedia("(max-width: 860px)"), tiny = matchMedia("(max-width: 400px)");
  const setPh = () => (sInput.placeholder = narrow.matches ? "Поиск" : "Найти героя, коллекцию или карточку...");
  setPh();
  [narrow, tiny].forEach((m) => m.addEventListener("change", setPh));
  let sHits = [];

  function renderSearch() {
    const q = sInput.value.trim();
    if (!q) return (sRes.hidden = true);
    const words = norm(q).split(/\s+/);
    sHits = searchIndex.filter((it) => words.every((wd) => it.text.includes(wd))).slice(0, 6);
    sRes.innerHTML = sHits.length
      ? sHits.map((it, i) => {
          if (it.u) {
            const n = WORKS.filter((w) => w.c.universe === it.u.id).length;
            return `<button type="button" class="sres" data-hit="${i}"><img src="${it.u.icon}" alt="" width="40" height="40"><span><b>${esc(it.u.name)}</b><span>${n ? `Коллекция, ${plural(n, "карточка", "карточки", "карточек")}` : "Нарисуем под заказ"}</span></span></button>`;
          }
          const w = WORKS.find((x) => x.c === it.c && x.rarity === "special") || WORKS.find((x) => x.c === it.c);
          return `<button type="button" class="sres" data-hit="${i}"><i ${thumbOf(w)}></i><span><b>${esc(it.c.name)}</b><span>${esc(uni(it.c.universe).name)}, от ${money(Math.min(...Object.keys(it.c.variants).map((r) => CONFIG.prices[r])))}</span></span></button>`;
        }).join("")
      : `<div class="sres sres--none"><span>Такого героя пока нет в каталоге — нарисуем под заказ.</span><button type="button" class="btn btn--sm" data-hit="custom">Заказать «${esc(q)}»</button></div>`;
    sRes.hidden = false;
  }
  function pickHit(i) {
    const q = sInput.value.trim(), it = sHits[i];
    sInput.value = "";
    sRes.hidden = true;
    sInput.blur();
    if (i === "custom") return go(`builder?other=${encodeURIComponent(q.slice(0, 60))}`);
    if (it.u) return go(`catalog/${it.u.id}`);
    const w = WORKS.find((x) => x.c === it.c && x.rarity === "special") || WORKS.find((x) => x.c === it.c);
    // Уже на странице этой коллекции — открываем окно здесь, иначе переходим в неё
    if (pageCollection === it.c.universe) openProduct(WORKS.indexOf(w));
    else go(`catalog/${it.c.universe}?card=${workKey(w)}`);
  }
  sInput.addEventListener("input", renderSearch);
  sInput.addEventListener("focus", renderSearch);
  sInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") sInput.value = "", (sRes.hidden = true);
    if (e.key === "Enter" && !sRes.hidden) e.preventDefault(), pickHit(sHits.length ? 0 : "custom");
  });
  sRes.addEventListener("click", (e) => {
    const b = e.target.closest("[data-hit]");
    if (b) pickHit(b.dataset.hit === "custom" ? "custom" : +b.dataset.hit);
  });
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest(".search")) sRes.hidden = true; });

  // ---------------------------------------------------------------
  //  Слайдер видео: по центру одно, соседние выглядывают по бокам.
  //  Играет только активное; досмотрел — листается дальше.
  // ---------------------------------------------------------------
  if ($("#vstage")) (() => {
  const vstage = $("#vstage"), vdots = $("#vdots");
  vstage.innerHTML = VIDEOS.map((v, i) => `
    <div class="vslide" data-i="${i}">
      <video data-src="${v.src}" data-poster="${v.poster}" muted playsinline preload="none"></video>
      <span class="vslide__bar"><i></i></span>
    </div>`).join("");
  vdots.innerHTML = VIDEOS.map((_, i) => `<button type="button" role="tab" aria-label="Видео ${i + 1}" data-i="${i}"></button>`).join("");
  const slides = $$(".vslide", vstage);
  let vIdx = 0, vVisible = false;

  function layoutSlides() {
    const n = slides.length;
    slides.forEach((el, i) => {
      // Кратчайшее смещение с учётом зацикливания: -1, 0, +1 …
      let d = (i - vIdx + n) % n;
      if (d > n / 2) d -= n;
      const side = d !== 0;
      el.style.transform = `translateX(${d * 78}%) scale(${side ? 0.8 : 1}) rotateY(${d * -8}deg)`;
      el.style.opacity = Math.abs(d) > 1 ? 0 : side ? 0.35 : 1;
      el.style.filter = side ? "blur(1px) brightness(.5)" : "none";
      el.style.zIndex = 10 - Math.abs(d);
      el.classList.toggle("is-active", !side);
      const v = $("video", el);
      if (side) v.pause();
    });
    $$("button", vdots).forEach((b, i) => b.classList.toggle("is-on", i === vIdx));
    playActive();
  }

  function playActive() {
    const v = $("video", slides[vIdx]);
    if (!vVisible) return v.pause();
    v.preload = "auto";
    v.play().catch(() => {});
    // Подгружаем следующее заранее
    $("video", slides[(vIdx + 1) % slides.length]).preload = "metadata";
  }

  function goVideo(i) {
    const prev = $("video", slides[vIdx]);
    vIdx = (i + slides.length) % slides.length;
    if (prev !== $("video", slides[vIdx])) prev.currentTime = 0;
    layoutSlides();
  }

  slides.forEach((el, i) => {
    const v = $("video", el);
    v.addEventListener("ended", () => i === vIdx && goVideo(vIdx + 1));
    v.addEventListener("timeupdate", () => el.style.setProperty("--p", (v.currentTime / (v.duration || 1)).toFixed(3)));
    el.addEventListener("click", () => {
      if (i !== vIdx) return goVideo(i);
      v.paused ? v.play().catch(() => {}) : v.pause();
    });
  });
  $$("[data-vstep]").forEach((b) => b.addEventListener("click", () => goVideo(vIdx + +b.dataset.vstep)));
  vdots.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) goVideo(+b.dataset.i); });

  // Свайп
  let vx0 = null;
  vstage.addEventListener("pointerdown", (e) => (vx0 = e.clientX));
  vstage.addEventListener("pointerup", (e) => {
    if (vx0 === null) return;
    const dx = e.clientX - vx0;
    vx0 = null;
    if (Math.abs(dx) > 40) goVideo(vIdx + (dx < 0 ? 1 : -1));
  }, true);
  // Если был свайп — не считать это кликом по слайду
  vstage.addEventListener("click", (e) => { if (e.detail && Math.abs(e.clientX - (vstage._down ?? e.clientX)) > 40) e.stopPropagation(); }, true);
  vstage.addEventListener("pointerdown", (e) => (vstage._down = e.clientX));

  // Постеры и видео начинаем грузить, только когда слайдер близко к экрану
  new IntersectionObserver(([en], obs) => {
    if (!en.isIntersecting) return;
    $$("video", vstage).forEach((v) => { v.poster = v.dataset.poster; v.src = v.dataset.src; });
    obs.disconnect();
  }, { rootMargin: "1200px" }).observe(vstage);
  new IntersectionObserver(([en]) => { vVisible = en.isIntersecting; playActive(); }, { threshold: 0.35 }).observe(vstage);
  layoutSlides();
  })();

  // Главная: новинки — последние добавленные карточки (через бота — самые свежие), по одной на героя
  if ($("#newCards")) {
    const seenChar = new Set();
    const fresh = [...WORKS].reverse().filter((w) => !seenChar.has(w.c.id) && seenChar.add(w.c.id)).slice(0, 8);
    const one = fresh.map((w) => `
      <a class="newc" href="catalog/${w.c.universe}?card=${workKey(w)}">
        <span class="newc__img"><img src="${sm(w.a)}" alt="" width="400" height="539"></span>
        <b>${esc(w.c.name)} <em>Новинка</em></b><span>${esc(uni(w.c.universe).short || uni(w.c.universe).name)}, ${money(CONFIG.prices[w.rarity])}</span>
      </a>`).join("");
    // Бегущая строка: список дважды подряд, лента сдвигается на половину и начинается заново
    // картинки ленты грузим сразу — иначе при подгрузке строка «прыгает»
    const copy = one.replace(/<a class="newc"/g, '<a class="newc" tabindex="-1" aria-hidden="true"');
    $("#newCards").innerHTML = `<div class="newcards__track">${one}${copy}${copy}</div>`;
    // Бесконечная лента на родной прокрутке: пальцем листается в обе стороны с инерцией системы,
    // сама медленно едет, когда её не трогают. Три одинаковых набора: уходя за край, незаметно
    // переносимся в средний — лента не кончается.
    const box = $("#newCards"), track = $(".newcards__track", box);
    const SPEED = reduceMotion ? 0 : 0.03; // px за мс
    let setW = 1, pos = 0, last = 0, userUntil = 0, visible = true, mouse = null, moved = false;
    const measure = () => { setW = track.scrollWidth / 3 || 1; };
    const recenter = () => {
      if (box.scrollLeft < setW * 0.5) box.scrollLeft += setW;
      else if (box.scrollLeft > setW * 1.5) box.scrollLeft -= setW;
      pos = box.scrollLeft;
    };
    const frame = (t) => {
      const dt = Math.min(48, t - (last || t)); last = t;
      if (t > userUntil && !mouse) {
        pos += SPEED * dt;
        box.scrollLeft = pos;
        if (pos > setW * 1.5) pos -= setW, (box.scrollLeft = pos);
      }
      if (visible) requestAnimationFrame(frame); else last = 0;
    };
    const touched = () => (userUntil = performance.now() + 1800);
    ["touchstart", "touchmove", "wheel"].forEach((ev) => box.addEventListener(ev, touched, { passive: true }));
    box.addEventListener("scroll", () => { if (performance.now() < userUntil || mouse) recenter(); }, { passive: true });
    // Мышью — тянуть, как пальцем
    box.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button > 0) return;
      mouse = { x: e.clientX, left: box.scrollLeft }; moved = false;
    });
    addEventListener("pointermove", (e) => {
      if (!mouse) return;
      const dx = e.clientX - mouse.x;
      if (Math.abs(dx) > 5) moved = true, box.classList.add("is-drag");
      box.scrollLeft = mouse.left - dx;
    });
    addEventListener("pointerup", () => { if (mouse) mouse = null, box.classList.remove("is-drag"), touched(); });
    box.addEventListener("click", (e) => { if (moved) e.preventDefault(), e.stopPropagation(), (moved = false); }, true);
    box.addEventListener("dragstart", (e) => e.preventDefault());
    const start = () => { measure(); box.scrollLeft = setW; pos = setW; };
    start();
    addEventListener("load", start);
    addEventListener("resize", () => { measure(); recenter(); });
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) requestAnimationFrame(frame); }).observe(box);
  }
  if ($("#promos") && (CONFIG.promos || []).length) {
    // Коллекции, у которых есть карточки: все их карточки — как на странице коллекции
    const colSets = UNIVERSES.map((u) => ({ u, cards: WORKS.filter((w) => w.c.universe === u.id) })).filter((x) => x.cards.length);
    const setSum = (x) => x.cards.reduce((n, w) => n + CONFIG.prices[w.rarity], 0);
    // Серия целиком: каждая пятая карточка самой серии — бесплатно (самые дешёвые)
    const setFree = (x) => {
      if (!CONFIG.promo41) return { n: 0, discount: 0 };
      const units = x.cards.map((w) => CONFIG.prices[w.rarity]).sort((a, b) => a - b);
      const n = Math.floor(units.length / 5);
      return { n, discount: units.slice(0, n).reduce((a, v) => a + v, 0) };
    };
    $("#promos").innerHTML = CONFIG.promos.map((p) => `
      <div class="promo"><span class="promo__tag">${esc(p.tag || "Акция")}</span><h3>${esc(p.title)}</h3><p>${esc(p.text || "")}</p>
        ${p.action === "buycollection" ? `<div class="promo__cols">${colSets.map((x) => `
            <button type="button" class="promo__col" data-buycol="${x.u.id}">
              <img src="${x.u.icon}" alt="" width="40" height="40" loading="lazy">
              <span><b>${esc(x.u.short || x.u.name)}</b><small>${plural(x.cards.length, "карточка", "карточки", "карточек")}${setFree(x).n ? `, ${setFree(x).n}\u00a0бесплатно` : ""}</small></span>
              <em>${setFree(x).n ? `<s>${money(setSum(x))}</s>` : ""}${money(setSum(x) - setFree(x).discount)}</em>
            </button>`).join("")}</div>`
          : p.link ? `<a href="${esc(p.link)}" class="btn btn--sm">${esc(p.linkText || "Подробнее")}</a>` : ""}</div>`).join("");
    // Нажали на коллекцию — сразу форма заказа со всеми её карточками
    $("#promos").addEventListener("click", (e) => {
      const b = e.target.closest("[data-buycol]");
      if (!b) return;
      const x = colSets.find((y) => y.u.id === b.dataset.buycol);
      const f = setFree(x);
      sendOrder([
        `Привет! Хочу коллекцию «${x.u.name}» целиком:`,
        ...x.cards.map((w) => `• ${w.c.name} (${RARITY[w.rarity].toLowerCase()}): 1 × ${money(CONFIG.prices[w.rarity])}`),
        `• Всего карточек: ${x.cards.length}`,
        f.n ? `• Акция 4+1: ${plural(f.n, "карточка", "карточки", "карточек")} из серии бесплатно, −${money(f.discount)}` : null,
        `• Сумма: ${money(setSum(x) - f.discount)}`,
      ]);
    });
    $("#promo").hidden = false;
  }

  if (PAGE === "builder") initBuilder();
  // Карточки коллекции рисуем в конце: им нужны уже готовые избранное и окно товара
  if (PAGE === "collection" && uni(pageCollection)) openCollection(pageCollection);

  // Пришли из поиска или избранного с другой страницы — сразу открываем карточку
  const openCard = workByKey(new URLSearchParams(location.search).get("card"));
  if (openCard) openProduct(WORKS.indexOf(openCard));
})();
