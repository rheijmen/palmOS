// Sync with a PocketBase server (see server/). The app stays local-first: it
// works offline and this module keeps the server in step in the background.
//
// Every item (appointment, task, contact, memo, category, plus the shared
// preferences) is one row in the server's "records" collection. Changes are found
// by comparing each item with a fingerprint of what was last synced, so every
// kind of edit is caught. Conflicts: the most recently changed version wins.
// Deletes travel as "deleted" rows so other devices remove the item too.
import { state, commit, subscribe } from './store.js';
import { debounce } from './util.js';
import { DEFAULT_SYNC_URL } from './config.js';

const KINDS = ['events', 'tasks', 'contacts', 'memos', 'categories'];
// Preferences that follow you to every device (the rest are per device).
const SHARED_SETTINGS = ['weekStart', 'dayStart', 'dayEnd', 'hour12', 'defaultDuration', 'defaultAlarm', 'agendaDays', 'showDoneInAgenda', 'showUndatedInAgenda', 'monthText', 'aiName', 'aiModel', 'aiSpeak', 'aiProactive', 'aiSpeakReminders', 'userName'];
const BUILTIN_CATEGORIES = ['business', 'personal', 'family', 'holiday'];
const URL_KEY = 'agendus.sync.url';
const BATCH = 50;

let pb = null;
let PocketBaseCls = null;
let unsubscribeRealtime = null;
let running = false;
let again = false;
let status = { state: 'off', error: '', at: null };
const listeners = new Set();

export const syncStatus = () => status;
export const onSyncStatus = (fn) => (listeners.add(fn), () => listeners.delete(fn));
function setStatus(next) {
  status = { ...status, ...next };
  listeners.forEach((fn) => fn(status));
}

export function getServerUrl() {
  try {
    return localStorage.getItem(URL_KEY) || DEFAULT_SYNC_URL;
  } catch {
    return DEFAULT_SYNC_URL;
  }
}

async function client(url = getServerUrl()) {
  if (!url) return null;
  if (!PocketBaseCls) ({ PocketBase: PocketBaseCls } = await import('./vendor/pocketbase.js'));
  if (!pb || pb.baseURL !== url) {
    pb = new PocketBaseCls(url);
    pb.autoCancellation(false);
  }
  return pb;
}

export const signedInAs = () => (pb?.authStore.isValid ? pb.authStore.record?.email || '' : '');

// ---------------------------------------------------------------- fingerprints

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

// cyrb53: a fast, well-spread 53-bit string hash.
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const fingerprint = (data) => hash(stable(data));

// The server row id is derived from user + item, so every device computes the
// same id and uploads become simple upserts. PocketBase ids: 15 chars [a-z0-9].
async function rowId(uid, key) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${uid}:${key}`)));
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 15; i++) id += abc[bytes[i] % 36];
  return id;
}

// ---------------------------------------------------------------- local view

function sharedSettings() {
  const o = {};
  for (const k of SHARED_SETTINGS) o[k] = state.settings[k];
  return o;
}

// key -> { kind, rid, data } for everything that syncs
function localItems() {
  const map = new Map();
  for (const kind of KINDS) for (const item of state[kind]) if (item?.id) map.set(`${kind}:${item.id}`, { kind, rid: item.id, data: item });
  map.set('settings:prefs', { kind: 'settings', rid: 'prefs', data: sharedSettings() });
  return map;
}

// ---------------------------------------------------------------- pull

function applyRemote(rows) {
  // Skip rows this device already has (the cursor query repeats the newest row).
  const fresh = rows.filter((row) => {
    const k = state.sync.known[`${row.kind}:${row.rid}`];
    return !k || k.sid !== row.id || k.h !== (row.deleted ? 'deleted' : fingerprint(row.data));
  });
  if (!fresh.length) return;
  commit((s) => {
    const known = s.sync.known;
    for (const row of fresh) {
      const key = `${row.kind}:${row.rid}`;
      const k = known[key];
      if (row.kind === 'settings') {
        const localChanged = k && fingerprint(sharedSettings()) !== k.h;
        if (!row.deleted && row.data && !localChanged) Object.assign(s.settings, row.data);
        known[key] = { h: row.deleted ? 'deleted' : fingerprint(row.data), sid: row.id };
        continue;
      }
      if (!KINDS.includes(row.kind)) continue;
      const list = s[row.kind];
      const i = list.findIndex((x) => x.id === row.rid);
      const local = i >= 0 ? list[i] : null;
      const localChanged = local && (!k || fingerprint(local) !== k.h);
      if (row.deleted) {
        // A local edit made after the delete survives (it will be uploaded again).
        if (local && !localChanged) list.splice(i, 1);
        known[key] = { h: 'deleted', sid: row.id, deleted: true };
        continue;
      }
      if (!row.data || typeof row.data !== 'object') continue;
      const remote = { ...row.data, id: row.rid };
      if (!local) list.push(remote);
      else if (!localChanged || (remote.updatedAt || '') >= (local.updatedAt || '')) list[i] = remote;
      known[key] = { h: fingerprint(remote), sid: row.id, u: remote.updatedAt };
    }
  });
}

async function pull() {
  const cursor = state.sync.cursor || '2000-01-01 00:00:00.000Z';
  let page = 1, newest = state.sync.cursor;
  for (;;) {
    const res = await pb.collection('records').getList(page, 200, {
      filter: pb.filter('updated >= {:c}', { c: cursor }),
      sort: 'updated,id',
      skipTotal: true,
    });
    applyRemote(res.items);
    for (const r of res.items) if (r.updated > (newest || '')) newest = r.updated;
    if (res.items.length < 200) break;
    page++;
  }
  if (newest && newest !== state.sync.cursor) commit((s) => (s.sync.cursor = newest), { silent: true });
}

// ---------------------------------------------------------------- push

async function push() {
  const uid = pb.authStore.record.id;
  const known = state.sync.known;
  const items = localItems();
  const now = new Date().toISOString();
  const ups = [];
  let stamped = false;
  for (const [key, it] of items) {
    if (known[key]?.h === fingerprint(it.data)) continue;
    // Edits made through the editors carry the time they were made, which decides
    // conflicts. Changes that did not refresh that stamp get the upload time.
    if (it.kind !== 'settings' && (!it.data.updatedAt || it.data.updatedAt === known[key]?.u)) {
      it.data.updatedAt = now;
      stamped = true;
    }
    ups.push({ key, ...it });
  }
  for (const [key, k] of Object.entries(known)) {
    if (!items.has(key) && !k.deleted) {
      const [kind, ...rest] = key.split(':');
      ups.push({ key, kind, rid: rest.join(':'), data: null, deleted: true });
    }
  }
  if (!ups.length) return 0;
  if (stamped) commit(() => {}, { silent: true }); // persist the new stamps
  for (let i = 0; i < ups.length; i += BATCH) {
    const chunk = ups.slice(i, i + BATCH);
    const batch = pb.createBatch();
    const ids = [];
    for (const u of chunk) {
      const id = known[u.key]?.sid || (await rowId(uid, u.key));
      ids.push(id);
      batch.collection('records').upsert({ id, user: uid, kind: u.kind, rid: u.rid, data: u.data, deleted: !!u.deleted });
    }
    await batch.send();
    commit((s) => {
      chunk.forEach((u, j) => {
        s.sync.known[u.key] = u.deleted ? { h: 'deleted', sid: ids[j], deleted: true } : { h: fingerprint(u.data), sid: ids[j], u: u.data?.updatedAt };
      });
    }, { silent: true });
  }
  return ups.length;
}

// ---------------------------------------------------------------- run

export async function syncNow() {
  if (!pb?.authStore.isValid) return;
  if (!navigator.onLine) return setStatus({ state: 'offline' });
  if (running) {
    again = true;
    return;
  }
  running = true;
  setStatus({ state: 'syncing', error: '' });
  try {
    await pull();
    await push();
    commit((s) => (s.sync.lastSync = new Date().toISOString()), { silent: true });
    setStatus({ state: 'ok', at: Date.now() });
  } catch (e) {
    if (e?.status === 401 || e?.status === 403) {
      pb.authStore.clear();
      setStatus({ state: 'signedout', error: 'expired' });
    } else setStatus({ state: 'error', error: e?.status ? `${e.status}` : 'network' });
  } finally {
    running = false;
    if (again) {
      again = false;
      syncNow();
    }
  }
}

const schedule = debounce(syncNow, 1500);

async function startLive() {
  stopLive();
  try {
    unsubscribeRealtime = await pb.collection('records').subscribe('*', () => schedule());
  } catch {
    // Realtime is a bonus; periodic and on-change syncing still run.
  }
}
function stopLive() {
  try {
    unsubscribeRealtime?.();
  } catch {}
  unsubscribeRealtime = null;
}

let timers = false;
function startTimers() {
  if (timers) return;
  timers = true;
  subscribe(() => pb?.authStore.isValid && schedule());
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => setStatus({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => !document.hidden && syncNow());
  setInterval(() => syncNow(), 5 * 60 * 1000);
}

// Called once at startup: resume a saved session.
export async function initSync() {
  const c = await client();
  if (!c?.authStore.isValid) return setStatus({ state: 'off' });
  adoptAccount(c.authStore.record.id);
  startTimers();
  startLive();
  try {
    await c.collection('users').authRefresh();
  } catch (e) {
    if (e?.status === 401) {
      c.authStore.clear();
      return setStatus({ state: 'signedout', error: 'expired' });
    }
  }
  syncNow();
}

// Tie this device to an account. The first sign-in merges what is already on the
// device into the account. Signing in with a different account than before
// clears the previous account's items first, so they never leak across accounts.
function adoptAccount(uid) {
  if (state.sync.uid === uid) return;
  const switching = !!state.sync.uid;
  commit((s) => {
    if (switching) {
      for (const kind of KINDS) if (kind !== 'categories') s[kind] = [];
      // Keep only the built-in categories, under their default names and without a
      // change stamp, so the new account's own versions win when they come down.
      s.categories = s.categories
        .filter((c) => BUILTIN_CATEGORIES.includes(c.id))
        .map(({ updatedAt, ...c }) => ({ ...c, name: '' }));
    }
    s.sync = { cursor: '', known: {}, lastSync: null, uid };
  });
}

export async function signIn(url, email, password) {
  url = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = `https://${url}`;
  const c = await client(url);
  await c.collection('users').authWithPassword(email.trim(), password);
  try {
    localStorage.setItem(URL_KEY, url);
  } catch {}
  adoptAccount(c.authStore.record.id);
  startTimers();
  await startLive();
  // First sync merges: what is on this device goes up, what is on the server comes down.
  await syncNow();
  return c.authStore.record.email;
}

export function signOut() {
  stopLive();
  pb?.authStore.clear();
  setStatus({ state: 'off', error: '' });
}
