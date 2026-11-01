// Проверка стандарта карточек: запусти сервер (python3 serve.py 8095) и
//   npm i playwright && npx playwright install webkit && node tools/check-cards.mjs
// Во всех местах сайта карточки одной группы одного размера, формата 780:1051,
// не наезжают друг на друга, страница не шире экрана — на iPhone 13, Pixel 7, iPhone SE (320 px).
import { webkit, chromium, devices } from 'playwright';
const R = 1051 / 780, LONG = 'Очень Длинное Имя Героя Аккерман';
const groups = {
  '/': ['.cf__slide.is-center .flip', '.newc__img'],
  '/catalog': ['.col-tile.pack'],
  '/catalog/mushoku': ['.work .flip'],
  '/catalog/berserk': ['.work .flip'],
  '/builder': ['#characterGrid .pick__img', '#previewCard'],
};
const out = [];
for (const [engine, dev] of [[webkit, 'iPhone 13'], [chromium, 'Pixel 7'], [webkit, 'iPhone SE']]) {
  const b = await engine.launch(engine === chromium ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : {}); const ctx = await b.newContext({ ...devices[dev] }); const p = await ctx.newPage();
  for (const [path, sels] of Object.entries(groups)) {
    await p.goto('http://localhost:8095' + path, { waitUntil: 'networkidle' }); await p.waitForTimeout(900);
    await p.evaluate((L) => document.querySelectorAll('.work__meta b, .newc b, .pick__name').forEach((e) => (e.firstChild.textContent = L)), LONG);
    await p.waitForTimeout(300);
    for (const sel of sels) {
      const r = await p.evaluate(([sel, R]) => {
        const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent || e.getClientRects().length);
        const rs = els.map((e) => e.getBoundingClientRect());
        const widths = [...new Set(rs.map((x) => Math.round(x.width)))];
        const badRatio = rs.filter((x) => x.width && Math.abs(x.height / x.width - R) > 0.03).length;
        let overlap = 0;
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
          const a = rs[i], c = rs[j]; if (Math.abs(a.top - c.top) < 2 && a.left < c.right - 2 && c.left < a.right - 2) overlap++;
        }
        const offscreenW = document.documentElement.scrollWidth > innerWidth;
        return { n: els.length, widths, badRatio, overlap, offscreenW };
      }, [sel, R]);
      const flatGroup = '';
      const ok = r.badRatio === 0 && r.overlap === 0 && !r.offscreenW && (flatGroup || r.widths.length <= 1);
      out.push(`${ok ? 'OK ' : 'BAD'} ${dev.padEnd(9)} ${path.padEnd(17)} ${sel.padEnd(28)} n=${r.n} widths=${r.widths.join('/')} ratioBad=${r.badRatio} overlap=${r.overlap}${r.offscreenW ? ' PAGE-WIDER-THAN-SCREEN' : ''}`);
    }
  }
  // окно карточки
  await p.goto('http://localhost:8095/catalog/berserk', { waitUntil: 'networkidle' }); await p.click('.work__buy .btn'); await p.waitForTimeout(900);
  const lb = await p.evaluate((R) => { const x = document.querySelector('#lightboxCard').getBoundingClientRect(); return Math.abs(x.height / x.width - R) < 0.03 && x.right <= innerWidth && x.bottom <= innerHeight; }, R);
  out.push(`${lb ? 'OK ' : 'BAD'} ${dev.padEnd(9)} lightbox`);
  await b.close();
}
console.log(out.join('\n'));
