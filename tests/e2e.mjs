// End-to-end check of the main flows in a headless phone-sized browser.
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
let failed = 0;

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-GB' });
const p = await ctx.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('pageerror: ' + e.message));
const ok = (c, msg) => {
  if (!c) failed++;
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
};
const W = (ms = 350) => p.waitForTimeout(ms);
const S = () => p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')));
await p.goto(`${BASE}/index.html`); await W(600);
await p.click('[data-w=empty]'); await W();
ok((await S()).events.length === 0, 'start empty');

// Create event through FAB chooser
await p.click('#fab'); await W();
await p.click('[data-pick=new-event]'); await W(500);
await p.fill('.sheet input[name=title]', 'Weekly sync');
await p.selectOption('.sheet select[name=repeatKind]', 'weekly');
await p.click('.sheet [data-e=save]'); await W();
let st = await S();
ok(st.events.length === 1 && st.events[0].repeat?.freq === 'weekly', 'create weekly event');
ok(await p.locator('.sheet-wrap').count() === 0, 'sheet closed after save');

// Edit next week's occurrence: only this one
const today = await p.evaluate(() => { const d = new Date(); return d.toISOString().slice(0,10); });
const ev = st.events[0];
const next = await p.evaluate((s) => { const d = new Date(s.slice(0,10)); d.setDate(d.getDate()+7); return d.toISOString().slice(0,10); }, ev.start);
await p.evaluate(h => location.hash = h, '#/day/' + next); await W();
await p.click('.blk'); await W();
await p.click('[data-d=edit]'); await W(500);
await p.fill('.sheet input[name=title]', 'Weekly sync (moved)');
await p.click('.sheet [data-e=save]'); await W();
await p.click('.sheet [data-v="0"]'); await W(500); // Only this one
st = await S();
ok(st.events.length === 2 && st.events[0].exceptions.includes(next) && st.events[1].title === 'Weekly sync (moved)', 'edit single occurrence of recurring');
ok(await p.locator('.sheet-wrap').count() === 0, 'no sheets left');

// Delete standalone occurrence with undo
await p.click('.blk'); await W();
await p.click('[data-d=delete]'); await W(500);
st = await S();
ok(st.events.length === 1, 'delete event');
await p.click('.toast-btn'); await W();
st = await S();
ok(st.events.length === 2, 'undo delete');

// Tasks: quick add + toggle + repeating roll
await p.evaluate(() => location.hash = '#/tasks'); await W();
await p.fill('[data-form=quick-task] input', 'Buy milk');
await p.press('[data-form=quick-task] input', 'Enter'); await W();
st = await S();
ok(st.tasks.length === 1 && st.tasks[0].title === 'Buy milk', 'quick add task');
await p.click('[data-act=toggle-task]'); await W();
st = await S();
ok(st.tasks[0].done === true, 'complete task');
await p.click('[data-act=task-filter][data-mode=done]'); await W();
ok(await p.locator('.task.is-done').count() === 1, 'done filter shows task');
await p.click('[data-act=task-filter][data-mode=all]'); await W();
await p.click('#fab'); await W(500);
await p.fill('.sheet input[name=title]', 'Water plants');
await p.selectOption('.sheet select[name=repeatKind]', 'daily');
await p.click('.sheet [data-e=save]'); await W();
await p.click('.task:not(.is-done) [data-act=toggle-task]'); await W();
st = await S();
const wp = st.tasks.find(t => t.title === 'Water plants');
ok(!wp.done && wp.due > today && wp.completions === 1, 'repeating task rolls to next date: ' + wp.due);

// Contacts: create, link to event via picker
await p.evaluate(() => location.hash = '#/contacts'); await W();
await p.click('#fab'); await W(500);
await p.fill('.sheet input[name=firstName]', 'Kristine');
await p.fill('.sheet input[name=lastName]', 'Villanueva');
await p.fill('.sheet input[name=phoneValue]', '+31 20 555 0134');
await p.fill('.sheet input[name=birthday]', '1990-' + today.slice(5));
await p.click('.sheet [data-e=save]'); await W();
st = await S();
ok(st.contacts.length === 1 && st.contacts[0].phones[0].value === '+31 20 555 0134', 'create contact');
await p.evaluate(h => location.hash = h, '#/agenda/' + today); await W();
ok(await p.locator('.birthday').count() >= 1, 'birthday shows in agenda');

// Search
await p.click('#btn-search'); await W();
await p.fill('[data-sq]', 'sync'); await W(400);
ok(await p.locator('.search-results .occ').count() >= 1, 'search finds events');
// Back button closes sheet
await p.goBack(); await W();
ok(await p.locator('.sheet-wrap.open').count() === 0, 'back button closes sheet');
ok((await p.evaluate(() => location.hash)).startsWith('#/agenda'), 'still on agenda after back');

// Navigation prev/next + title date picker
await p.evaluate(() => location.hash = '#/month/' + new Date().toISOString().slice(0,10)); await W();
const t1 = await p.textContent('#title');
await p.click('[data-act=next]'); await W();
const t2 = await p.textContent('#title');
ok(t1 !== t2, 'next month: ' + t1 + ' -> ' + t2);
await p.click('#title'); await W();
await p.click('.date-picker [data-dp=today]'); await W(500);
ok((await p.textContent('#title')) === t1, 'date picker today');

// Memo autosave on close
await p.evaluate(() => location.hash = '#/memos'); await W();
await p.click('#fab'); await W(500);
await p.fill('.sheet textarea[name=text]', 'Groceries\nEggs');
await p.keyboard.press('Escape'); await W();
st = await S();
ok(st.memos.length === 1 && st.memos[0].text.startsWith('Groceries'), 'memo autosaves on close');

// ICS roundtrip
const ics = await p.evaluate(async () => (await import('/js/interop.js')).exportICS());
ok(ics.includes('RRULE:FREQ=WEEKLY') && ics.includes('EXDATE') && ics.includes('BEGIN:VTODO'), 'ICS export has rrule/exdate/todo');
const r = await p.evaluate(async (txt) => (await import('/js/interop.js')).importICS(txt), ics);
st = await S();
ok(r.events === 2 && st.events.length === 4, 'ICS import roundtrip');
const vcf = await p.evaluate(async () => (await import('/js/interop.js')).exportVCF());
const n = await p.evaluate(async (txt) => (await import('/js/interop.js')).importVCF(txt), vcf);
st = await S();
ok(n === 1 && st.contacts[1].birthday === st.contacts[0].birthday && st.contacts[1].phones[0].value === '+31 20 555 0134', 'VCF roundtrip');

// Category filter
await p.evaluate(() => location.hash = '#/tasks'); await W();
await p.selectOption('#cat-filter', 'business'); await W();
st = await S();
ok(st.settings.category === 'business', 'category filter set');
await p.selectOption('#cat-filter', 'all'); await W();

// Recurrence engine checks
const rec = await p.evaluate(async () => {
  const r = await import('/js/recur.js');
  return {
    monthlyLast: r.occurrenceDays({ freq: 'monthly', monthBy: 'weekday', interval: 1 }, '2026-01-30', '2026-01-01', '2026-06-30'),
    monthly31: r.occurrenceDays({ freq: 'monthly', monthBy: 'date', interval: 1 }, '2026-01-31', '2026-01-01', '2026-06-30'),
    biweekly: r.occurrenceDays({ freq: 'weekly', interval: 2, days: [1, 3] }, '2026-10-05', '2026-10-01', '2026-10-31'),
    leap: r.occurrenceDays({ freq: 'yearly', interval: 1 }, '2024-02-29', '2024-01-01', '2028-12-31'),
    until: r.occurrenceDays({ freq: 'daily', interval: 3, until: '2026-10-10' }, '2026-10-01', '2026-10-01', '2026-10-31'),
  };
});
ok(JSON.stringify(rec.monthlyLast) === JSON.stringify(['2026-01-30','2026-02-27','2026-03-27','2026-04-24','2026-05-29','2026-06-26']), 'last Friday monthly ' + rec.monthlyLast);
ok(JSON.stringify(rec.monthly31) === JSON.stringify(['2026-01-31','2026-03-31','2026-05-31']), 'monthly on 31st skips short months');
ok(JSON.stringify(rec.biweekly) === JSON.stringify(['2026-10-05','2026-10-07','2026-10-19','2026-10-21']), 'every 2 weeks Mon/Wed ' + rec.biweekly);
ok(JSON.stringify(rec.leap) === JSON.stringify(['2024-02-29','2028-02-29']), 'yearly Feb 29');
ok(JSON.stringify(rec.until) === JSON.stringify(['2026-10-01','2026-10-04','2026-10-07','2026-10-10']), 'daily every 3 until');


// No horizontal overflow on a small phone in any view.
await p.setViewportSize({ width: 360, height: 740 });
for (const h of ['#/agenda/', '#/day/', '#/week/', '#/month/', '#/year/', '#/list/']) {
  await p.evaluate((x) => (location.hash = x + new Date().toISOString().slice(0, 10)), h);
  await W(250);
  ok((await p.evaluate(() => document.documentElement.scrollWidth)) <= 360, 'no horizontal overflow ' + h);
}

if (errs.length) failed++;
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no console errors');
await b.close();
server.close();
process.exit(failed ? 1 : 0);
