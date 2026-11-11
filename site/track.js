// Запись сессии для админки: что видел и делал посетитель (rrweb) + события магазина.
// Поля ввода маскируются (имя, контакт, комментарий не попадают в запись), фото покупателя не записываются.
// Запись грузится после страницы и не мешает ей; данные уходят пачками на /api/t.
(() => {
  const noop = () => {};
  window.track = noop;
  if (navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|read-aloud|google-|pagespeed|gtmetrix|\+https?:\/\//i.test(navigator.userAgent)) return;
  const store = (s, k, v) => { try { return v === undefined ? s.getItem(k) : s.setItem(k, v); } catch { return null; } };
  const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  const IDLE = 30 * 60 * 1000; // полчаса тишины — новая сессия
  let vid = store(localStorage, "av_vid");
  if (!vid) store(localStorage, "av_vid", (vid = rid()));
  let sid = store(sessionStorage, "av_sid");
  if (!sid || Date.now() - +(store(sessionStorage, "av_last") || 0) > IDLE) store(sessionStorage, "av_sid", (sid = rid()));
  window.trackSid = sid;

  const params = new URLSearchParams(location.search);
  const utm = {};
  for (const [k, v] of params) if (k.startsWith("utm_")) utm[k] = v.slice(0, 80);
  const meta = { path: location.pathname + location.search.slice(0, 120), ref: document.referrer.slice(0, 300), utm,
                 scr: `${screen.width}x${screen.height}`, lang: navigator.language };
  let rr = [], ev = [], size = 0, sent = 0, metaSent = false, timer = null, stopped = false;
  const LIMIT = 25 * 1024 * 1024; // больше 25 МБ с одной вкладки не пишем

  const payload = () => {
    const body = { s: sid, v: vid, r: rr, e: ev };
    if (!metaSent) body.m = meta, (metaSent = true);
    rr = []; ev = []; size = 0;
    store(sessionStorage, "av_last", String(Date.now()));
    return JSON.stringify(body);
  };
  async function flush() {
    timer = null;
    if (!rr.length && !ev.length) return;
    const json = payload();
    sent += json.length;
    let body = json;
    try {
      if (window.CompressionStream) body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    } catch {}
    const len = body.byteLength ?? body.length;
    fetch("/api/t", { method: "POST", body, keepalive: len < 60000, headers: { "Content-Type": "application/octet-stream" } }).catch(noop);
  }
  // Уход со страницы: отправляем остаток сразу (без сжатия — его нельзя дождаться)
  function flushNow() {
    if (!rr.length && !ev.length) return;
    const json = payload();
    if (!(navigator.sendBeacon && json.length < 60000 && navigator.sendBeacon("/api/t", new Blob([json], { type: "application/octet-stream" }))))
      fetch("/api/t", { method: "POST", body: json, keepalive: json.length < 60000 }).catch(noop);
  }
  const later = (ms = 4000) => { if (!timer) timer = setTimeout(flush, ms); };
  addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushNow());

  window.track = (type, data = {}) => { ev.push([type, Date.now(), location.pathname, data]); later(1500); };
  // Просмотр страницы — когда app.js уже её собрал (у коллекции заголовок ставится им)
  const pageview = () => setTimeout(() => window.track("pageview", { title: document.title.slice(0, 80) }), 400);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pageview); else pageview();

  // Ошибки JavaScript и незагрузившиеся файлы — для вкладки «Ошибки» в админке.
  // Одинаковые не повторяем, всего — не больше 10 разных за страницу
  const seenErr = new Set();
  const stackOf = (err) => String(err?.stack || "").split("\n").slice(0, 4).map((l) => l.trim().replace(location.origin, "")).join("\n").slice(0, 400);
  const report = (msg, data) => {
    const key = msg + (data.at || "");
    if (seenErr.has(key) || seenErr.size >= 10) return;
    seenErr.add(key);
    window.track("js_error", { msg: msg.slice(0, 200), ...data });
  };
  addEventListener("error", (e) => {
    const el = e.target;
    if (el && el !== window && (el.src || el.href)) {  // картинка, скрипт или стиль не загрузились
      const url = String(el.src || el.href).replace(location.origin, "");
      if (url.startsWith("/vendor/rrweb-record")) return;  // о записи сообщает сам загрузчик ниже (после повторной попытки)
      return report(`Не загрузился файл: ${url.slice(0, 120)}`, { at: (el.tagName || "").toLowerCase(), kind: "resource" });
    }
    report(String(e.message || "error"), { at: `${(e.filename || "").split("/").pop()}:${e.lineno || ""}:${e.colno || ""}`, stack: stackOf(e.error) });
  }, true);
  addEventListener("unhandledrejection", (e) => report(String(e.reason?.message || e.reason || "Promise rejected"), { at: "promise", stack: stackOf(e.reason) }));
  // Переходы в соцсети и Telegram
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (a && /t\.me|tiktok|instagram|vk\.com/.test(a.href)) window.track("tg_click", { href: a.href.slice(0, 120) });
  }, true);

  // --- запись экрана ---
  // Карточки крутятся покадрово (меняется style на каждом кадре): такие изменения склеиваем до ~10 в секунду
  const pending = new Map();
  let pendTimer = null, pendTs = 0;
  const emitPending = (push) => {
    clearTimeout(pendTimer); pendTimer = null;
    if (!pending.size) return;
    push({ type: 3, timestamp: pendTs, data: { source: 0, texts: [], removes: [], adds: [], attributes: [...pending].map(([id, attributes]) => ({ id, attributes })) } });
    pending.clear();
  };
  function start() {
    const lib = window.rrwebRecord;
    const record = lib && (lib.record || lib.default?.record || lib);
    if (typeof record !== "function" || stopped) return;
    const push = (e) => {
      if (stopped) return;
      rr.push(e);
      const n = e.type === 2 ? 200000 : JSON.stringify(e).length;
      size += n;
      if (sent + size > LIMIT) { stopped = true; stop && stop(); }
      if (e.type === 2 || size > 300000) flush(); else later();
    };
    const emit = (e) => {
      const d = e.data;
      if (e.type === 3 && d && d.source === 0 && !d.texts.length && !d.adds.length && !d.removes.length) {
        const rest = [];
        for (const a of d.attributes) {
          const { style, ...other } = a.attributes;
          if (style !== undefined) {
            const prev = pending.get(a.id);
            const next = prev && typeof prev.style === "object" && typeof style === "object" ? { style: { ...prev.style, ...style } } : { style };
            pending.set(a.id, next);
            pendTs = e.timestamp;
          }
          if (Object.keys(other).length) rest.push({ id: a.id, attributes: other });
        }
        if (rest.length) emitPending(push), push({ ...e, data: { ...d, attributes: rest } });
        if (pending.size && !pendTimer) pendTimer = setTimeout(() => emitPending(push), 100);
        return;
      }
      emitPending(push);
      push(e);
    };
    var stop = record({
      emit,
      maskAllInputs: true,
      blockSelector: "#cropView, .upload__img, #previewCard .custom, [data-rr-block]",
      sampling: { mousemove: 120, scroll: 160, input: "last", media: 800 },
      slimDOMOptions: { script: true, comment: true, headFavicon: true, headWhitespace: true, headMetaSocial: true, headMetaRobots: true, headMetaHttpEquiv: true, headMetaVerification: true },
      recordCanvas: false,
      collectFonts: false,
    });
  }
  // Запись может не загрузиться: моргнула сеть — пробуем ещё раз; если её блокирует защита
  // браузера от слежки (Firefox, блокировщики, встроенный браузер Instagram) — так и оставляем
  const load = (retry = 1) => {
    const s = document.createElement("script");
    s.src = "/vendor/rrweb-record.min.js?v=2.1.7";
    s.onload = start;
    s.onerror = () => {
      s.remove();
      if (retry) return setTimeout(() => load(retry - 1), 3000);
      window.track("js_error", { msg: "Запись сессии не загрузилась", at: "recorder", kind: "resource" });
    };
    document.head.appendChild(s);
  };
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
  if (document.readyState === "complete") idle(load);
  else addEventListener("load", () => idle(load));
})();
