// Two-device sync check against a throwaway local PocketBase server.
// Run with: POCKETBASE=/path/to/pocketbase node tests/sync.mjs
// (get PocketBase from https://pocketbase.io/docs/; the test is skipped without it)
import { chromium } from 'playwright';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = process.env.POCKETBASE || 'pocketbase';
try {
  execFileSync(BIN, ['--version'], { stdio: 'ignore' });
} catch {
  console.log('SKIP sync test: PocketBase not found (set POCKETBASE=/path/to/pocketbase)');
  process.exit(0);
}

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
const APP = `http://localhost:${server.address().port}`;

// A fresh server with the real migration, locked to the app's origin like in production.
const DATA = mkdtempSync(join(tmpdir(), 'agendus-pb-'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const PB = `http://127.0.0.1:${PORT}`;
const MIGRATIONS = join(ROOT, 'server', 'pb_migrations');
execFileSync(BIN, ['migrate', 'up', `--dir=${DATA}`, `--migrationsDir=${MIGRATIONS}`], { stdio: 'ignore' });
execFileSync(BIN, ['superuser', 'upsert', 'admin@example.com', 'admin-pass-123', `--dir=${DATA}`], { stdio: 'ignore' });
const pbProc = spawn(BIN, ['serve', `--http=127.0.0.1:${PORT}`, `--dir=${DATA}`, `--migrationsDir=${MIGRATIONS}`, `--origins=${APP}`], { stdio: 'ignore' });
const cleanup = () => {
  pbProc.kill();
  server.close();
  rmSync(DATA, { recursive: true, force: true });
};
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${PB}/api/health`)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 100));
}
const api = async (path, body, token) => {
  const r = await fetch(PB + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const { body: su } = await api('/api/collections/_superusers/auth-with-password', { identity: 'admin@example.com', password: 'admin-pass-123' });
for (const email of ['rik@example.com', 'eva@example.com']) await api('/api/collections/users/records', { email, password: 'secret-pass-1', passwordConfirm: 'secret-pass-1', verified: true }, su.token);

const b = await chromium.launch();
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const errs = [];
const W = (p, ms = 400) => p.waitForTimeout(ms);
const S = (p) => p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')));
async function device(name, { demo = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-GB' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(name + ' ' + e.message));
  p.on('console', (m) => m.type() === 'error' && !/status of 40[03]/.test(m.text()) && errs.push(name + ' ' + m.text()));
  await p.goto(APP + '/index.html'); await W(p, 500);
  await p.click(demo ? '[data-w=demo]' : '[data-w=empty]'); await W(p);
  return { p, ctx };
}
async function signIn(p, email, pass = 'secret-pass-1') {
  await p.evaluate(() => (location.hash = '#/settings')); await W(p);
  await p.fill('#sync-url', PB); await p.fill('#sync-email', email); await p.fill('#sync-pass', pass);
  await p.click('[data-act=sync-signin]'); await W(p, 2500);
}
const until = async (p, fn, arg, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn, arg)) return true; await W(p, 250); } return false; };

// Device A (phone) has demo data, signs in first: everything goes up.
const A = await device('A', { demo: true });
await signIn(A.p, 'wrong@example.com');
ok(await A.p.locator('#sync-email').count() === 1, 'wrong login stays on the sign-in form');
await signIn(A.p, 'rik@example.com');
ok((await A.p.locator('.sync-state').textContent()).toLowerCase().includes('synced'), 'A shows synced: ' + (await A.p.locator('.sync-state').textContent()));
const sa = await S(A.p);
ok(Object.keys(sa.sync.known).length >= sa.events.length + sa.tasks.length + sa.contacts.length, 'A uploaded its items: ' + Object.keys(sa.sync.known).length);

// Device B (laptop) starts empty, signs in: everything comes down.
const B = await device('B');
await signIn(B.p, 'rik@example.com');
let sb = await S(B.p);
ok(sb.events.length === sa.events.length && sb.tasks.length === sa.tasks.length && sb.contacts.length === sa.contacts.length && sb.memos.length === sa.memos.length, `B received everything (${sb.events.length} events, ${sb.tasks.length} tasks)`);

// Live: create on A -> appears on B without reload.
await A.p.evaluate(async () => { const s = await import('./js/store.js'); s.upsert('events', { id: 'livetest01', title: 'Sync demo', start: '2026-12-01T10:00', end: '2026-12-01T11:00', exceptions: [], contactIds: [] }); });
ok(await until(B.p, () => JSON.parse(localStorage.getItem('agendus.v1')).events.some((e) => e.id === 'livetest01')), 'new appointment on A shows up live on B');

// Edit on B -> A.
await B.p.evaluate(async () => { const s = await import('./js/store.js'); const e = s.get('events', 'livetest01'); s.upsert('events', { ...e, title: 'Sync demo (edited on B)' }); });
ok(await until(A.p, () => JSON.parse(localStorage.getItem('agendus.v1')).events.find((e) => e.id === 'livetest01')?.title.includes('edited on B')), 'edit on B reaches A');

// Commit-style change (exception on a repeating event) also syncs.
const rep = sa.events.find((e) => e.repeat?.freq);
await A.p.evaluate(async (id) => { const s = await import('./js/store.js'); s.commit((st) => { const x = st.events.find((e) => e.id === id); x.exceptions = [...(x.exceptions || []), '2026-12-24']; }); }, rep.id);
ok(await until(B.p, (id) => JSON.parse(localStorage.getItem('agendus.v1')).events.find((e) => e.id === id)?.exceptions?.includes('2026-12-24'), rep.id), 'in-place changes (skipping one repeat) sync too');

// Delete on A -> gone on B.
await A.p.evaluate(async () => { const s = await import('./js/store.js'); s.remove('events', 'livetest01'); });
ok(await until(B.p, () => !JSON.parse(localStorage.getItem('agendus.v1')).events.some((e) => e.id === 'livetest01')), 'delete on A removes it on B');

// Shared preference syncs, device preference (theme) does not.
await A.p.evaluate(async () => { const s = await import('./js/store.js'); s.setSetting('weekStart', 0); s.setSetting('theme', 'classic'); });
ok(await until(B.p, () => JSON.parse(localStorage.getItem('agendus.v1')).settings.weekStart === 0), 'shared preference (week start) syncs');
sb = await S(B.p);
ok(sb.settings.theme !== 'classic', 'device preference (look) stays per device');

// Offline edits on B, then back online.
await B.ctx.setOffline(true);
await B.p.evaluate(async () => { const s = await import('./js/store.js'); s.upsert('tasks', { id: 'offline01', title: 'Made offline', due: null, priority: 3, done: false, contactIds: [] }); });
await W(B.p, 2500);
ok(!(await A.p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')).tasks.some((t) => t.id === 'offline01'))), 'offline change stays local');
await B.ctx.setOffline(false);
await B.p.evaluate(() => window.dispatchEvent(new Event('online')));
ok(await until(A.p, () => JSON.parse(localStorage.getItem('agendus.v1')).tasks.some((t) => t.id === 'offline01')), 'offline change uploads when back online');

// Conflict: both edit the same task; the later edit wins on both.
await A.ctx.setOffline(true); await B.ctx.setOffline(true);
await A.p.evaluate(async () => { const s = await import('./js/store.js'); const x = s.get('tasks', 'offline01'); s.upsert('tasks', { ...x, title: 'Edit from A' }); });
await W(A.p, 1200);
await B.p.evaluate(async () => { const s = await import('./js/store.js'); const x = s.get('tasks', 'offline01'); s.upsert('tasks', { ...x, title: 'Edit from B (later)' }); });
await A.ctx.setOffline(false); await A.p.evaluate(() => window.dispatchEvent(new Event('online'))); await W(A.p, 2500);
await B.ctx.setOffline(false); await B.p.evaluate(() => window.dispatchEvent(new Event('online'))); await W(B.p, 2500);
await A.p.evaluate(async () => (await import('./js/sync.js')).syncNow()); await W(A.p, 2000);
const ta = (await S(A.p)).tasks.find((t) => t.id === 'offline01').title;
const tb = (await S(B.p)).tasks.find((t) => t.id === 'offline01').title;
ok(ta === tb && ta === 'Edit from B (later)', `the later edit wins on both devices after a conflict ("${ta}")`);

// No endless sync loop: request count stays flat when idle.
let reqs = 0;
B.p.on('request', (r) => r.url().startsWith(PB) && reqs++);
await W(B.p, 5000);
ok(reqs <= 2, 'idle device stays quiet (' + reqs + ' requests in 5s)');

// Another account on device B: Rik's items must not leak into Eva's account.
await B.p.evaluate(() => (location.hash = '#/settings')); await W(B.p);
await B.p.click('[data-act=sync-signout]'); await W(B.p); await B.p.click('.sheet-dialog [data-v="0"]'); await W(B.p);
await signIn(B.p, 'eva@example.com');
sb = await S(B.p);
ok(sb.events.length === 0 && sb.tasks.length === 0, 'switching account clears the previous account\'s items locally');
const evaRows = await B.p.evaluate(async (pb) => { const r = await fetch(pb + '/api/collections/records/records?perPage=200', { headers: { Authorization: JSON.parse(localStorage.getItem('pocketbase_auth')).token } }); return (await r.json()).items.map((x) => ({ kind: x.kind, rid: x.rid, name: x.data?.name })); }, PB);
const leaked = evaRows.filter((x) => !(x.kind === 'settings' || (x.kind === 'categories' && ['business', 'personal', 'family', 'holiday'].includes(x.rid) && !x.name)));
ok(leaked.length === 0, 'nothing of Rik\'s was uploaded to Eva (only defaults and her preferences: ' + evaRows.map((x) => x.kind + ':' + x.rid).join(', ') + ')');

// Reload keeps the session.
await A.p.reload(); await W(A.p, 2500);
await A.p.evaluate(() => (location.hash = '#/settings')); await W(A.p, 800);
ok((await A.p.locator('.card', { hasText: 'Signed in as' }).count()) === 1, 'session survives a reload');

console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no console errors');
await b.close();
cleanup();
process.exit(failed || errs.length ? 1 : 0);
