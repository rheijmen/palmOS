// The assistant: offline commands, settings, and the Claude tool loop against a
// mocked API (no real key or network needed, nothing is billed).
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
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, locale: 'en-GB' });
const p = await ctx.newPage();
p.on('pageerror', e => errs.push('pageerror ' + e.message));
p.on('console', m => m.type() === 'error' && !m.text().includes('status of 401') && errs.push(m.text()));
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; })();

// Mock the Claude API: first call -> tool_use create_event; second -> end_turn text.
const requests = [];
await ctx.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } });
  const body = JSON.parse(req.postData());
  requests.push({ headers: req.headers(), body });
  const n = requests.length;
  const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  if (body.messages.at(-1).content.some?.(c => c.type === 'text' && /bad key/.test(c.text))) {
    return route.fulfill({ status: 401, headers: cors, body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
  }
  const last = body.messages.at(-1);
  const isToolResult = Array.isArray(last.content) && last.content[0]?.type === 'tool_result';
  const msg = isToolResult
    ? { id: 'msg_2', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'thinking', thinking: '', signature: 'sig2' }, { type: 'text', text: 'Done. Lunch with Kristine is set for tomorrow at 12:30. You have nothing else then.' }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 10, output_tokens: 10 } }
    : { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'thinking', thinking: '', signature: 'sig1' }, { type: 'tool_use', id: 'toolu_1', name: 'create_event', input: { title: 'Lunch with Kristine', start: `${tomorrow}T12:30`, end: `${tomorrow}T13:30`, contact_names: ['Kristine'] } }], stop_reason: 'tool_use', stop_details: null, usage: { input_tokens: 10, output_tokens: 10 } };
  return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(msg) });
});

await p.goto(BASE + '/index.html'); await p.waitForTimeout(500);
await p.click('[data-w=demo]'); await p.waitForTimeout(400);
ok(await p.locator('.pilot-strip').count() === 1, 'assistant strip shows on today\'s agenda');

// Offline mode
await p.click('#btn-ai'); await p.waitForTimeout(600);
ok(await p.locator('.sheet-pilot .voice-box .vb-col').count() === 3, 'dashboard with three-column voice box');
await p.fill('.pilot-input input', 'Remind me to buy milk tomorrow');
await p.press('.pilot-input input', 'Enter'); await p.waitForTimeout(500);
let st = await p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')));
ok(st.tasks.some(t => t.title === 'Buy milk' && t.due === tomorrow), 'offline: "remind me to" adds a task for tomorrow');
await p.fill('.pilot-input input', "What's next?");
await p.press('.pilot-input input', 'Enter'); await p.waitForTimeout(400);
ok((await p.locator('.kl.ai').last().textContent()).includes('Next up'), 'offline: what\'s next answers from the agenda');
await p.keyboard.press('Escape'); await p.waitForTimeout(400);

// Settings: save a key
await p.evaluate(() => location.hash = '#/settings'); await p.waitForTimeout(400);
await p.fill('#ai-key', 'not-a-key'); await p.click('[data-act=ai-save-key]'); await p.waitForTimeout(200);
ok(!(await p.evaluate(() => localStorage.getItem('agendus.ai.key'))), 'rejects a malformed key');
await p.fill('#ai-key', 'sk-ant-test-123'); await p.click('[data-act=ai-save-key]'); await p.waitForTimeout(400);
ok(await p.evaluate(() => localStorage.getItem('agendus.ai.key')) === 'sk-ant-test-123', 'saves the key locally');
ok(!(await p.evaluate(async () => (await import('/js/store.js')).exportJSON())).includes('sk-ant'), 'key is not in backups');
await p.locator('.card', { hasText: 'Claude API key' }).scrollIntoViewIfNeeded();

// Claude mode with tools
await p.evaluate(() => location.hash = '#/agenda/' + new Date().toISOString().slice(0, 10)); await p.waitForTimeout(400);
await p.click('#btn-ai'); await p.waitForTimeout(500);
await p.fill('.pilot-input input', 'Plan lunch with Kristine tomorrow at half past twelve');
await p.press('.pilot-input input', 'Enter'); await p.waitForTimeout(2500);
st = await p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')));
const lunch = st.events.find(e => e.title === 'Lunch with Kristine' && e.start === `${tomorrow}T12:30`);
ok(!!lunch, 'tool call created the appointment');
const kristine = st.contacts.find(c => c.firstName === 'Kristine');
ok(lunch && lunch.contactIds.includes(kristine.id), 'linked the contact by name');
ok((await p.locator('.kl.ai').last().textContent()).includes('12:30'), 'shows Claude\'s answer');
ok(await p.locator('.kl.ai').last().locator('[data-k-undo]').count() === 1, 'offers Undo after changes');
const r0 = requests[0];
ok(r0.headers['x-api-key'] === 'sk-ant-test-123', 'sends the key as x-api-key');
ok(r0.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'browser access header set by SDK');
ok(r0.body.model === 'claude-haiku-5-5' && r0.body.output_config?.effort === 'low', 'default model is Haiku 5.5, low effort');
ok(!('fallbacks' in r0.body) && !(r0.headers['anthropic-beta'] || '').includes('server-side-fallback'), 'no refusal fallback on Haiku (not supported there)');
ok(Array.isArray(r0.body.tools) && r0.body.tools.length === 10 && !r0.body.tool_choice, '10 tools, auto tool choice');
const r1 = requests[1];
ok(r1.body.messages.length === 3 && r1.body.messages[1].content[0].type === 'thinking' && r1.body.messages[2].content[0].type === 'tool_result', 'second call appends assistant turn (incl. thinking) and tool result');
await p.click('[data-k-undo]'); await p.waitForTimeout(300);
st = await p.evaluate(() => JSON.parse(localStorage.getItem('agendus.v1')));
ok(!st.events.some(e => e.title === 'Lunch with Kristine' && e.start === `${tomorrow}T12:30`), 'Undo reverts the assistant\'s change');

// Auth error handling
await p.fill('.pilot-input input', 'bad key please');
await p.press('.pilot-input input', 'Enter'); await p.waitForTimeout(2500);
ok((await p.locator('.kl.ai.err').last().textContent()).toLowerCase().includes('api key'), 'auth error explains what to do');
await p.evaluate(async () => (await import('/js/store.js')).setSetting('aiModel', 'claude-opus-5-5'));
await p.fill('.pilot-input input', 'Plan lunch with Kristine tomorrow at half past twelve');
await p.press('.pilot-input input', 'Enter'); await p.waitForTimeout(2500);
const rOpus = requests.at(-1);
ok(rOpus.body.model === 'claude-opus-5-5' && (rOpus.headers['anthropic-beta'] || '').includes('server-side-fallback-2026-07-01') && rOpus.body.fallbacks === 'default', 'Opus, when picked, gets the refusal fallback');
const last = requests.at(-1).body.messages;
ok(last.filter(m => m.role === 'user' && m.content.some?.(c => c.type === 'text' && /bad key/.test(c.text))).length === 0, 'failed turn is dropped from history');

// Default model change: old default moves to Haiku, a deliberate pick stays.
await p.reload(); await p.waitForTimeout(600);
ok(await p.evaluate(async () => (await import('/js/store.js')).state.settings.aiModel) === 'claude-opus-5-5', 'a model picked on purpose is kept');
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('agendus.v1')); s.settings.aiModel = 'claude-opus-5-5'; delete s.settings.aiModelV; localStorage.setItem('agendus.v1', JSON.stringify(s)); });
await p.reload(); await p.waitForTimeout(600);
ok(await p.evaluate(async () => (await import('/js/store.js')).state.settings.aiModel) === 'claude-haiku-5-5', 'settings on the old Opus default move to Haiku');

// Insights
const ins = await p.evaluate(async () => (await import('/js/ai/insights.js')).computeInsights().map(i => i.id.split('-')[0]));
ok(ins.includes('overdue'), 'insights include overdue tasks: ' + ins.join(','));
console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no console errors');
await b.close();
server.close();
process.exit(failed || errs.length ? 1 : 0);
