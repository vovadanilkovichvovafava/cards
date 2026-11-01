// Регрессия по багам из стресс-тестов (iPhone SE, WebKit). Сервер: python3 serve.py 8095; заказы подменяются.
import { webkit, devices } from 'playwright';
const b = await webkit.launch(); const r = {};
const ctx = await b.newContext({ ...devices['iPhone SE'] }); const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.route('**/api/order', (rt) => rt.fulfill({ json: { ok: true } }));
const B = 'http://localhost:8095';
// 1 испорченное хранилище
await p.goto(B + '/'); await p.evaluate(() => { localStorage.setItem('cart', '{}'); localStorage.setItem('favs', '5'); });
await p.goto(B + '/builder', { waitUntil: 'networkidle' }); r.builderTotal = await p.textContent('#total');
await p.evaluate(() => localStorage.setItem('cart', JSON.stringify([{ k: 'guts:common', qty: -3 }, { k: 'guts:special', qty: '3' }, { k: 'griffith:common', qty: 2.5 }])));
await p.goto(B + '/catalog/berserk', { waitUntil: 'networkidle' }); r.cartBadge = await p.textContent('#cartCount'); r.works = await p.locator('.work').count();
// 2 BYN
await p.evaluate(() => { localStorage.setItem('region', 'BYN'); localStorage.setItem('cart', JSON.stringify([{ k: 'guts:common', qty: 2 }, { k: 'griffith:common', qty: 2 }])); });
await p.goto(B + '/catalog/berserk', { waitUntil: 'networkidle' });
await p.click('#cartBtn'); r.bynTotal = await p.textContent('#cartTotal'); r.bynItems = await p.locator('.ditem em').allTextContents();
await p.evaluate(() => localStorage.setItem('region', 'RUS'));
// 3 q=2.5
await p.goto(B + '/builder?c=guts&q=2.5', { waitUntil: 'networkidle' }); r.qty = await p.textContent('#qty');
// 4 photo required
await p.goto(B + '/builder?preset=photo', { waitUntil: 'networkidle' }); await p.click('#orderBtn'); r.omOpenNoPhoto = await p.isVisible('#orderModal');
// 5 back closes lightbox
await p.goto(B + '/catalog'); await p.goto(B + '/catalog/berserk', { waitUntil: 'networkidle' });
await p.click('.work__buy .btn'); await p.waitForTimeout(400); await p.goBack(); await p.waitForTimeout(400);
r.afterBack = [p.url().replace(B, ''), await p.isHidden('#lightbox')];
// 6 heart not covered by close
await p.click('.work__buy .btn'); await p.waitForTimeout(400);
await p.evaluate(() => document.querySelector('#lightbox').scrollTop = 260); await p.waitForTimeout(200);
r.heartCovered = await p.evaluate(() => { const h = document.querySelector('#lbFav').getBoundingClientRect(); const el = document.elementFromPoint(h.x + h.width / 2, h.y + h.height / 2); return !el || !el.closest('#lbFav'); });
// 7 long collection name width
await p.route('**/catalog.js', (rt) => rt.fulfill({ contentType: 'application/javascript', body: 'window.EXTRA_UNIVERSES=[{id:"c9",name:"ДжоДжоНевероятныеПриключения",back:"assets/backs/aot.jpg"}];window.EXTRA_CARDS=[];' }));
await p.goto(B + '/catalog/c9', { waitUntil: 'networkidle' }); r.longNameWidth = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
r.errs = errs; console.log(JSON.stringify(r, null, 1)); await b.close();
