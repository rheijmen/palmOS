// Touch and mouse gestures: drag, resize, create-by-drag, month drag, task swipes.
// Run with: npm test   (needs Playwright: npm install)
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, path || 'index.html'));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const BASE = `http://localhost:${server.address().port}`;
const b = await chromium.launch();
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const errs = [];
const day = (() => { const d = new Date(); d.setDate(d.getDate() + 1); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; })();
const next = (s, n) => { const [y,m,d] = s.split('-').map(Number); const x = new Date(y, m-1, d+n); const p = (k) => String(k).padStart(2,'0'); return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}`; };

async function setup(mobile) {
  const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(BASE + '/index.html'); await p.waitForTimeout(500);
  await p.click('[data-w=empty]'); await p.waitForTimeout(200);
  await p.evaluate(async (day) => {
    const s = await import('./js/store.js');
    s.upsert('events', { id: 'dent', title: 'Dentist', start: `${day}T11:00`, end: `${day}T12:00`, exceptions: [], contactIds: [] });
    s.upsert('events', { id: 'sync', title: 'Sync', start: `${day}T09:00`, end: `${day}T09:30`, repeat: { freq: 'daily', interval: 1 }, exceptions: [], contactIds: [] });
    s.upsert('tasks', { id: 't1', title: 'Swipe me done', due: day, priority: 3, done: false, contactIds: [] });
    s.upsert('tasks', { id: 't2', title: 'Swipe me away', due: day, priority: 3, done: false, contactIds: [] });
  }, day);
  const cdp = mobile ? await ctx.newCDPSession(p) : null;
  return { p, cdp };
}
const ev = (p, id) => p.evaluate((id) => JSON.parse(localStorage.getItem('agendus.v1')).events.find(e => e.id === id), id);
const evs = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')).events);
const center = async (p, sel) => { const r = await p.locator(sel).first().boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r }; };
async function touchDrag(cdp, p, from, to, { hold = 450, steps = 12 } = {}) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  await p.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }] });
    await p.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(450);
}

// ---------- touch
let { p, cdp } = await setup(true);
await p.evaluate((h) => location.hash = h, '#/day/' + day); await p.waitForTimeout(400);
let c = await center(p, '.blk[data-id=dent]');
await touchDrag(cdp, p, c, { x: c.x, y: c.y + 104 });
let e = await ev(p, 'dent');
ok(e.start === `${day}T13:00` && e.end === `${day}T14:00`, 'touch long-press drag moves 2h later: ' + e.start);
ok(await p.locator('.sheet-wrap').count() === 0, 'no detail sheet opened after drag');
await p.click('.toast-btn'); await p.waitForTimeout(300);
e = await ev(p, 'dent');
ok(e.start === `${day}T11:00`, 'undo restores move');

c = await center(p, '.blk[data-id=dent]');
await touchDrag(cdp, p, c, { x: c.x, y: c.y + 120 }, { hold: 40 });
e = await ev(p, 'dent');
ok(e.start === `${day}T11:00`, 'quick vertical swipe (no long-press) does not move the item');

// tap still opens detail
await p.locator('.blk[data-id=dent]').tap(); await p.waitForTimeout(400);
ok(await p.locator('.sheet-wrap.open').count() === 1, 'tap opens appointment detail');
await p.keyboard.press('Escape'); await p.waitForTimeout(400);

// resize via handle (touch: immediate)
const h = await center(p, '.blk[data-id=dent] .blk-resize');
await touchDrag(cdp, p, h, { x: h.x, y: h.y + 52 }, { hold: 30 });
e = await ev(p, 'dent');
ok(e.start === `${day}T11:00` && e.end === `${day}T13:00`, 'resize handle extends by 1h: ' + e.end);

// recurring move -> scope question -> only this one
c = await center(p, '.blk[data-id=sync]');
await touchDrag(cdp, p, c, { x: c.x, y: c.y + 52 });
ok(await p.locator('.sheet-dialog [data-v]').count() >= 2, 'recurring drag asks which occurrences');
await p.click('.sheet-dialog [data-v="0"]'); await p.waitForTimeout(400);
let all = await evs(p);
const series = all.find(x => x.id === 'sync');
const single = all.find(x => x.seriesId === 'sync');
ok(series.exceptions.includes(day) && single && single.start === `${day}T10:00`, 'only this occurrence moved to 10:00');

// create by long-press + drag on empty grid
const grid = await p.locator('.tg-col').boundingBox();
const y15 = await p.evaluate(() => { const g = document.querySelector('.timegrid'); return g.dataset.scrollTo; });
const slot = await p.locator('.slot').nth(8).boundingBox(); // h0 + 8
await touchDrag(cdp, p, { x: slot.x + 100, y: slot.y + 5 }, { x: slot.x + 100, y: slot.y + 5 + 78 });
const sTime = await p.inputValue('.sheet input[name=sTime]').catch(() => null);
const eTime = await p.inputValue('.sheet input[name=eTime]').catch(() => null);
ok(sTime && eTime && sTime < eTime, `drag on empty grid opens editor with range ${sTime}-${eTime}`);
await p.keyboard.press('Escape'); await p.waitForTimeout(400);

// month: drag dentist to the next day
await p.evaluate((h) => location.hash = h, '#/month/' + day); await p.waitForTimeout(400);
const it = await center(p, `.mc-it[data-id=dent]`);
const target = await center(p, `.mc[data-day="${next(day, 1)}"]`);
await touchDrag(cdp, p, it, target);
e = await ev(p, 'dent');
ok(e.start === `${next(day, 1)}T11:00` && e.end === `${next(day, 1)}T13:00`, 'month drag moves to next day: ' + e.start);

// tasks swipe
await p.evaluate(() => location.hash = '#/tasks'); await p.waitForTimeout(400);
let row = await p.locator('.task', { hasText: 'Swipe me done' }).boundingBox();
await touchDrag(cdp, p, { x: row.x + 60, y: row.y + row.height / 2 }, { x: row.x + 330, y: row.y + row.height / 2 }, { hold: 20 });
let tk = await p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')).tasks);
ok(tk.find(x => x.id === 't1').done === true, 'swipe right completes task');
row = await p.locator('.task', { hasText: 'Swipe me away' }).boundingBox();
await touchDrag(cdp, p, { x: row.x + 330, y: row.y + row.height / 2 }, { x: row.x + 40, y: row.y + row.height / 2 }, { hold: 20 });
tk = await p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')).tasks);
ok(!tk.find(x => x.id === 't2'), 'swipe left deletes task');
await p.click('.toast-btn'); await p.waitForTimeout(300);
tk = await p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')).tasks);
ok(!!tk.find(x => x.id === 't2'), 'undo brings deleted task back');
row = await p.locator('.task', { hasText: 'Swipe me away' }).boundingBox();
await touchDrag(cdp, p, { x: row.x + 200, y: row.y + row.height / 2 }, { x: row.x + 150, y: row.y + row.height / 2 }, { hold: 20 });
tk = await p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')).tasks);
ok(!!tk.find(x => x.id === 't2' && !x.done), 'short swipe springs back without action');

// ---------- mouse (desktop)
({ p } = await setup(false));
await p.evaluate((h) => location.hash = h, '#/week/' + day); await p.waitForTimeout(400);
c = await center(p, '.blk[data-id=dent]');
const colW = (await p.locator('.tg-col').first().boundingBox()).width;
await p.mouse.move(c.x, c.y); await p.mouse.down();
for (let i = 1; i <= 10; i++) { await p.mouse.move(c.x + colW * i / 10, c.y + 26 * i / 10); await p.waitForTimeout(16); }
await p.mouse.up(); await p.waitForTimeout(450);
e = await ev(p, 'dent');
ok(e.start === `${next(day, 1)}T11:30`, 'mouse drag in week view moves to next day 11:30: ' + e.start);
ok(await p.locator('.sheet-wrap').count() === 0, 'no sheet after mouse drag');

console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no console errors');
await b.close();
server.close();
process.exit(failed || errs.length ? 1 : 0);
