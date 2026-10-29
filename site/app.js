(() => {
  const { CONFIG, UNIVERSES, CHARACTERS, VIDEOS } = window;
  // Карточки, которые Влад добавил через бота: тот же персонаж дополняется новой версией,
  // новый — встаёт в конец своей коллекции
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
  const money = (v) => `${v.toLocaleString("ru-RU")} ${CONFIG.currency}`;
  const RARITY = { common: "Обычная", special: "Особая" };
  // Уменьшенная копия карточки (400 px) — для сеток и миниатюр
  const sm = (src) => src.replace("assets/cards/", "assets/cards/sm/");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  function Flip(el, { interactive = true, free = false, mirror = null, rest = REST, canDrag = null, springBack = false } = {}) {
    el.innerHTML = `
      <div class="flip__tilt">
        <div class="flip__turn">
          <div class="face face--front"></div>
          <div class="face face--back"><img alt="Обратная сторона карточки" loading="lazy" width="600" height="824"><div class="face__holo"></div></div>
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
        if (e.pointerType === "mouse" && (!canDrag || canDrag())) {
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
  $$("[data-brand]").forEach((n) => (n.textContent = CONFIG.brand));
  $$("[data-tagline]").forEach((n) => (n.textContent = CONFIG.tagline));
  $$("[data-production]").forEach((n) => (n.textContent = CONFIG.production));
  $$("[data-price]").forEach((n) => (n.textContent = money(CONFIG.prices[n.dataset.price])));
  $$("[data-price-min]").forEach((n) => (n.textContent = money(Math.min(...Object.values(CONFIG.prices)))));
  $$("[data-tg-handle]").forEach((n) => (n.textContent = `@${CONFIG.telegram}`));
  document.title = `${CONFIG.brand} — ${CONFIG.tagline.toLowerCase()}`;
  const tgUrl = `https://t.me/${CONFIG.telegram}`;
  $("#tgLink").href = tgUrl;

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
    let on = false, src = null, fade = null, pending = null;
    const unlock = () => {
      removeEventListener("pointerdown", unlock, true);
      removeEventListener("keydown", unlock, true);
      if (pending && on) { const p = pending; pending = src = null; play(p); }
    };
    addEventListener("pointerdown", unlock, true);
    addEventListener("keydown", unlock, true);
    try { on = localStorage.getItem("sound") === "on"; } catch {}

    const sync = () => {
      btn.setAttribute("aria-pressed", on);
      btn.classList.toggle("is-playing", on && !audio.paused);
    };
    ["play", "pause", "ended"].forEach((ev) => audio.addEventListener(ev, sync));

    function stop() {
      pending = null;
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
      // До первого клика по странице браузер запрещает звук — цитата сыграет сразу после него
      audio.play().then(() => (pending = null), () => (pending = next));
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
  const cfTrack = $("#cfTrack");
  const hero = (u) => WORKS.find((w) => w.c.universe === u.id && w.rarity === "special") || WORKS.find((w) => w.c.universe === u.id);
  const count = (u) => WORKS.filter((w) => w.c.universe === u.id).length;
  // Коллекций мало — повторяем ленту трижды, чтобы листать по кругу и видеть соседей с обеих сторон
  const N = UNIVERSES.length, LOOPS = 3;
  const SHOW = Array.from({ length: N * LOOPS }, (_, i) => UNIVERSES[i % N]);
  const START = N + Math.max(0, UNIVERSES.findIndex((u) => u.id === "berserk"));
  cfTrack.innerHTML = SHOW.map((u, i) => `
    <div class="cf__slide" role="group" aria-label="Коллекция ${esc(u.name)}" ${Math.floor(i / N) === 1 ? "" : 'aria-hidden="true"'}>
      <div class="cf__item">
        <div class="flip"></div>
        <span class="cf__base" aria-hidden="true"></span>
      </div>
    </div>`).join("");
  const cfSlides = $$(".cf__slide", cfTrack);
  // Наклоняем и сдвигаем только внутренний блок: точки «примагничивания» ленты браузер считает
  // по внешнему, и если двигать его, они уезжают вместе с карточками — лента застревает
  const cfItems = cfSlides.map((sl) => sl.firstElementChild);
  const cfFlips = cfSlides.map((sl, i) => {
    const u = SHOW[i], w = hero(u);
    // Центральную можно покрутить пальцем или мышью и увидеть переход кадров; отпустил — встаёт лицом
    const f = Flip($(".flip", sl), { rest: -0.6, springBack: true, canDrag: () => sl.classList.contains("is-center") });
    if (w) f.setImages(w.a, w.b, Math.abs(i - START) > 1);
    else f.setImages(u.back, u.back, Math.abs(i - START) > 1); // у серии ещё нет артов — показываем её обложку
    f.setBack(u.back);
    return f;
  });
  $("#cfDots").innerHTML = UNIVERSES.map(() => "<i></i>").join("");
  $("#uniStrip").innerHTML = UNIVERSES.map((u) => `
    <button type="button" class="uni ${u.banner ? "" : "uni--text"}" role="tab" aria-selected="false" data-u="${u.id}">
      <img src="${u.banner || u.back}" alt="" width="720" height="240" loading="lazy">
      <span class="${u.banner ? "sr" : ""}">${esc(u.name)}</span></button>`).join("");
  $("#uniNext").addEventListener("click", () => $("#uniStrip").scrollBy({ left: $("#uniStrip").clientWidth * 0.8, behavior: reduceMotion ? "auto" : "smooth" }));

  let cfCenter = -1, cfRaf = null;
  function cfSetCenter(i) {
    cfCenter = i;
    const u = SHOW[i];
    cfSlides.forEach((sl, j) => sl.classList.toggle("is-center", j === i));
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
      const scale = a <= 1 ? 1 - 0.31 * a : a <= 2 ? 0.69 - 0.11 * (a - 1) : 0.58 - 0.1 * (a - 2);
      const shift = a > 1 ? -side * (a - 1) * 0.37 * cfCard : 0;
      const turn = -side * Math.min(a, 2) * 12;
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
  // На телефоне resize срабатывает и когда прячется адресная строка — реагируем только на смену ширины
  let cfWidth = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === cfWidth) return;
    cfWidth = innerWidth;
    cfMeasure();
    cfGo(cfCenter, false);
    cfQueue();
  });
  const cfOpen = () => openCollection(SHOW[cfCenter].id);
  cfTrack.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.preventDefault(), cfGo(cfCenter + (e.key === "ArrowLeft" ? -1 : 1));
    if (e.key === "Enter") cfOpen();
  });

  // Мышью — тянуть, как пальцем; короткий клик по центральной открывает коллекцию
  let cfDrag = null, cfMoved = false;
  cfTrack.addEventListener("pointerdown", (e) => {
    cfMoved = false;
    if (e.pointerType !== "mouse" || e.button > 0 || e.target.closest(".cf__slide.is-center .flip")) return;
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
  cfTrack.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || !e.target.closest(".cf__slide.is-center")) return;
    const q = CHARACTERS.find((c) => c.universe === SHOW[cfCenter].id && c.quote);
    if (q) Sound.play(q.quote);
  });
  cfTrack.addEventListener("pointerleave", () => Sound.stop());

  // Полоса коллекций: листает витрину к ближайшей такой же коллекции
  $("#uniStrip").addEventListener("click", (e) => {
    const t = e.target.closest("[data-u]");
    if (!t) return;
    const near = SHOW.map((u, i) => (u.id === t.dataset.u ? i : -1)).filter((i) => i > -1)
      .sort((x, y) => Math.abs(x - cfCenter) - Math.abs(y - cfCenter))[0];
    near === cfCenter ? cfOpen() : cfGo(near);
  });

  // Каждая коллекция, впервые оказавшись в центре, один раз оборачивается на подиуме
  // и останавливается. Дальше её можно чуть повернуть пальцем — небольшой свайп
  // наклоняет карточку и пружинит обратно, свайп дальше листает.
  // Пока ничего не двигается, кадры не перерисовываются вовсе.
  const SPIN_MS = 2600, SPIN_DELAY = 500;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const spun = new Set();
  let spinRaf = null, spinIdle = null, cfScrollAt = 0;
  function spinOnce(i) {
    const id = SHOW[i].id;
    if (reduceMotion || spun.has(id)) return;
    spun.add(id);
    let t0 = null;
    const step = (t) => {
      t0 ??= t + SPIN_DELAY;
      const k = (t - t0) / SPIN_MS;
      // Начали листать — оборот прерываем, карточка встаёт лицом
      // Человек сам крутит карточку — автооборот уступает ему
      if (cfFlips[i].el.classList.contains("is-dragging")) return void (spinRaf = null);
      if (cfCenter !== i || t - cfScrollAt < 120) {
        if (k <= 0) spun.delete(id); // ещё не начала оборачиваться — обернётся в следующий раз
        return cfFlips[i].spin(0), (spinRaf = null);
      }
      cfFlips[i].spin(k <= 0 || k >= 1 ? 0 : ease(k) * 360);
      spinRaf = k < 1 ? requestAnimationFrame(step) : null;
    };
    cancelAnimationFrame(spinRaf);
    spinRaf = requestAnimationFrame(step);
  }
  // Лента остановилась: переносимся в среднюю копию и оборачиваем новую коллекцию
  cfTrack.addEventListener("scroll", () => {
    cfScrollAt = performance.now();
    clearTimeout(spinIdle);
    spinIdle = setTimeout(() => { cfRecenter(); spinOnce(cfCenter); }, 220);
  }, { passive: true });

  // После того как весь скрипт отработал — встаём на стартовую коллекцию
  requestAnimationFrame(() => {
    cfMeasure();
    cfGo(START, false);
    cfLayout();
    setTimeout(() => spinOnce(cfCenter), 300);
  });

  // ---------------------------------------------------------------
  //  Конструктор
  // ---------------------------------------------------------------
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
      `<button type="button" class="chip ${u.id === state.universe ? "is-on" : ""}" data-u="${u.id}"><img src="${u.icon}" alt="" width="128" height="128" loading="lazy">${esc(u.name)}</button>`
    ).join("");
    $("#styleChips").innerHTML = UNIVERSES.map((u) =>
      `<button type="button" class="chip ${u.id === state.style ? "is-on" : ""}" data-s="${u.id}"><img src="${u.icon}" alt="" width="128" height="128" loading="lazy">${esc(u.name)}</button>`
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
    const q = char(state.character)?.quote;
    q ? Sound.play(q) : Sound.stop();
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

  function renderSummary() {
    const rows = [
      ["Для кого", state.recipient === "gift" ? `В подарок${state.giftName ? " — " + state.giftName : ""}` : "Себе"],
      ["Карточка", describeCard()],
      state.mode === "photo" ? null : ["Версия", RARITY[state.rarity]],
      ["Количество", `${state.qty} × ${money(unitPrice())}`],
    ].filter(Boolean);
    $("#summaryRows").innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join("");
    $("#total").textContent = money(unitPrice() * state.qty);
  }

  // Миниатюра и сумма в нижней панели (мобильные)
  function renderBar() {
    let thumb = "";
    if (state.mode === "character" && state.character !== "other") thumb = sm(char(state.character).variants[state.rarity][0]);
    else if (state.mode === "photo" && state.photos[0]) thumb = state.photos[0];
    const accent = uni(state.mode === "photo" ? state.style : state.universe).accent;
    $("#mbarThumb").style.backgroundImage = thumb ? `url("${thumb}")` : "";
    $("#mbarThumb").style.backgroundColor = thumb ? "#000" : accent;
    $("#mbarTitle").textContent = describeCard();
    $("#mbarTotal").textContent = money(unitPrice() * state.qty);
  }

  function render() {
    const avail = availableRarities();
    if (!avail.includes(state.rarity)) state.rarity = avail[avail.length - 1];
    $$('[data-group="rarity"] button').forEach((b) => (b.disabled = !avail.includes(b.dataset.value)));
    $("#rarityNote").textContent =
      avail.length === 1 ? (state.character === "other" ? "Персонажи под заказ делаются в особой версии." : `У этого персонажа есть только ${RARITY[avail[0]].toLowerCase()} версия.`) : "";

    ["recipient", "mode", "rarity"].forEach((g) => segSet(g, state[g]));
    $("#rarityField").hidden = state.mode === "photo";
    renderUniverseChips();
    renderCharacterGrid();
    renderPreview();
    renderSummary();
    renderBar();
    $("#qty").textContent = state.qty;
  }

  // Текстовые поля
  [["giftName", "giftName"], ["otherChar", "otherChar"], ["photoName", "photoName"], ["photoText", "photoText"]].forEach(([id, key]) =>
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
        if (CONTACT[saved.method]) setMethod(saved.method);
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
    if (!value) return $("#omContact").focus();
    // В заказе сразу видно, куда писать: «WhatsApp: +7 …», «TikTok: @nick»
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

  $("#orderBtn").addEventListener("click", () =>
    sendOrder([
      `Привет! Хочу заказать карточку:`,
      `• Для кого: ${state.recipient === "gift" ? "в подарок" + (state.giftName ? ` (${state.giftName})` : "") : "себе"}`,
      `• Карточка: ${describeCard()}`,
      state.mode === "photo" ? null : `• Версия: ${RARITY[state.rarity]}`,
      state.mode === "photo" && state.photoText ? `• Текст: ${state.photoText}` : null,
      `• Количество: ${state.qty}`,
      `• Сумма: ${money(unitPrice() * state.qty)}`,
    ], { photos: state.mode === "photo" ? state.photos : [] })
  );

  // Пресеты из блока цен
  $$("[data-preset]").forEach((a) =>
    a.addEventListener("click", () => {
      const p = a.dataset.preset;
      if (p === "photo") state.mode = "photo";
      else {
        state.mode = "character";
        state.rarity = p;
        if (p === "common" && !char(state.character)?.variants.common) {
          state.universe = "berserk";
          state.character = "guts";
        }
      }
      render();
    })
  );

  // ---------------------------------------------------------------
  //  Коллекции: плитки вселенных → мини-карточки серии
  // ---------------------------------------------------------------
  const plural = (n, one, few, many) =>
    `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;

  $("#collections").innerHTML = UNIVERSES.map((u) => {
    const n = WORKS.filter((w) => w.c.universe === u.id).length;
    return `
      <button type="button" class="col-tile ${n ? "" : "col-tile--soon"}" data-col="${u.id}" style="--c:${u.accent}">
        <img src="${u.back}" alt="" width="600" height="824" loading="lazy">
        <span class="col-tile__info">
          ${n ? "" : `<span class="col-tile__tag">Под заказ</span>`}
          <b>${esc(u.name)}</b>
          <span>${n ? plural(n, "карточка", "карточки", "карточек") : "Арты скоро появятся на сайте"}</span>
        </span>
      </button>`;
  }).join("");

  const collectionsEl = $("#collections"), collectionEl = $("#collection"), gallery = $("#gallery");
  let galleryFlips = [];

  function openCollection(id) {
    const u = uni(id);
    const items = WORKS.filter((w) => w.c.universe === id);
    $("#colTitle").textContent = u.name;
    $("#colIcon").src = u.icon;
    $("#colCount").textContent = items.length
      ? `${plural(items.length, "карточка", "карточки", "карточек")}. Нажми на карточку, чтобы заказать`
      : "Арты этой серии ещё не на сайте";
    $("#colEmpty").hidden = items.length > 0;
    $("#colCustom").dataset.u = id;

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
      if (w.c.quote) {
        item.addEventListener("pointerenter", (e) => e.pointerType === "mouse" && Sound.play(w.c.quote));
        item.addEventListener("pointerleave", (e) => e.pointerType === "mouse" && lb.hidden && Sound.stop());
      }
      return f;
    });

    syncHearts();
    collectionsEl.hidden = true;
    collectionEl.hidden = false;
    $("#works").scrollIntoView({ block: "start" });
  }

  function closeCollection() {
    collectionEl.hidden = true;
    collectionsEl.hidden = false;
    gallery.innerHTML = "";
    Sound.stop();
    $("#works").scrollIntoView({ block: "start" });
  }

  collectionsEl.addEventListener("click", (e) => {
    const t = e.target.closest("[data-col]");
    if (t) openCollection(t.dataset.col);
  });
  $("#colBack").addEventListener("click", closeCollection);
  $("#colCustom").addEventListener("click", (e) => {
    Object.assign(state, { mode: "character", universe: e.currentTarget.dataset.u, character: "other", rarity: "special" });
    render();
  });

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
    $("#lbTotal").textContent = money(CONFIG.prices[rarity] * qty);
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
      `• Сумма: ${money(CONFIG.prices[rarity] * qty)}`,
    ]);
  });
  $("#lbWant").addEventListener("click", () => {
    const { c, rarity, qty } = lbState;
    Object.assign(state, { mode: "character", universe: c.universe, character: c.id, rarity, qty });
    closeLightbox();
    render();
    $("#builder").scrollIntoView();
  });

  $("#lbCart").addEventListener("click", () => {
    const { c, rarity, qty } = lbState;
    addToCart(`${c.id}:${rarity}`, qty);
  });

  // ---------------------------------------------------------------
  //  Избранное и корзина: хранятся в браузере покупателя
  // ---------------------------------------------------------------
  const MAX_CART = 10; // столько позиций помещается в одно сообщение заказа
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
    <div class="dempty"><p>${text}</p><a href="#works" class="btn btn--ghost btn--full">Открыть каталог</a></div>`;
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
    $("#cartTotal").textContent = money(cart.reduce((n, { k, qty }) => n + CONFIG.prices[workByKey(k).rarity] * qty, 0));
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
      `• Всего карточек: ${items.reduce((n, x) => n + x.qty, 0)}`,
      `• Сумма: ${money(items.reduce((n, { w, qty }) => n + CONFIG.prices[w.rarity] * qty, 0))}`,
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
  const narrow = matchMedia("(max-width: 860px)"), tiny = matchMedia("(max-width: 340px)");
  const setPh = () => (sInput.placeholder = tiny.matches ? "Поиск" : narrow.matches ? "Найти героя..." : "Найти героя, коллекцию или карточку...");
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
    if (i === "custom") {
      Object.assign(state, { mode: "character", character: "other", otherChar: q.slice(0, 60), rarity: "special" });
      $("#otherChar").value = state.otherChar;
      render();
      return $("#builder").scrollIntoView();
    }
    if (it.u) return openCollection(it.u.id);
    const w = WORKS.find((x) => x.c === it.c && x.rarity === "special") || WORKS.find((x) => x.c === it.c);
    openProduct(WORKS.indexOf(w));
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

  render();
})();
