// Persistence and mutations. All data lives on the device (localStorage), with an
// in-memory fallback when storage is unavailable (private mode, blocked site data).
import { uid, clone, today, addDays } from './util.js';

const KEY = 'agendus.v1';
export const LOCAL_USER = 'local';

export const DEFAULT_SETTINGS = {
  lang: 'auto', // 'auto' | 'en' | 'nl'
  theme: 'auto', // 'auto' | 'light' | 'dark' | 'classic'
  weekStart: 1, // 0 = Sunday, 1 = Monday
  dayStart: 7,
  dayEnd: 21,
  hour12: 'auto', // 'auto' | true | false
  defaultDuration: 60,
  defaultAlarm: 10, // minutes before, null = none
  agendaDays: 7,
  showDoneInAgenda: false,
  showUndatedInAgenda: true,
  calView: 'month',
  // Assistant
  aiName: 'Pilot',
  aiModel: 'claude-opus-5-5',
  aiSpeak: true,
  aiVoice: '',
  aiProactive: true,
  aiSpeakReminders: true,
  userName: '',
  category: 'all',
  monthText: true,
};

const DEFAULT_CATEGORIES = [
  // Built-in categories have no name until the user renames them; the UI shows a translated label.
  { id: 'business', name: '', color: '#1f5fbf' },
  { id: 'personal', name: '', color: '#2e9e4f' },
  { id: 'family', name: '', color: '#d6408a' },
  { id: 'holiday', name: '', color: '#e8890c' },
];

function empty() {
  return {
    version: 1,
    welcomed: false,
    events: [],
    tasks: [],
    contacts: [],
    memos: [],
    categories: clone(DEFAULT_CATEGORIES),
    settings: { ...DEFAULT_SETTINGS },
    alarms: { fired: {}, snoozed: [] },
    ai: { dismissed: null },
    // Per-device sync bookkeeping (see sync.js); never in backups or undo.
    sync: { cursor: '', known: {}, lastSync: null, uid: null },
  };
}

let memoryOnly = false;
function readRaw() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    memoryOnly = true;
    return null;
  }
}

function load() {
  const raw = readRaw();
  if (!raw) return empty();
  try {
    const data = JSON.parse(raw);
    const base = empty();
    return {
      ...base,
      ...data,
      settings: { ...base.settings, ...(data.settings || {}) },
      alarms: { ...base.alarms, ...(data.alarms || {}) },
      ai: { ...base.ai, ...(data.ai || {}) },
      sync: { ...base.sync, ...(data.sync || {}) },
    };
  } catch {
    return empty();
  }
}

export const state = load();
const listeners = new Set();
let undoSnapshot = null;

export const isMemoryOnly = () => memoryOnly;

export function save() {
  if (memoryOnly) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    memoryOnly = true;
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  save();
  listeners.forEach((fn) => fn());
}

// Run a mutation. Pass { undoable: true } to allow a single-step undo afterwards.
export function commit(mutator, { undoable = false, silent = false } = {}) {
  if (undoable) undoSnapshot = JSON.stringify(stripAlarms(state));
  mutator(state);
  if (!silent) emit();
  else save();
}

function stripAlarms(s) {
  const { alarms, sync, ...rest } = s;
  return rest;
}

export function canUndo() {
  return !!undoSnapshot;
}

export function undo() {
  if (!undoSnapshot) return;
  const snap = JSON.parse(undoSnapshot);
  undoSnapshot = null;
  Object.assign(state, snap);
  emit();
}

const COLLECTIONS = ['events', 'tasks', 'contacts', 'memos'];

export function get(collection, id) {
  return state[collection].find((x) => x.id === id) || null;
}

export function upsert(collection, item, opts) {
  const now = new Date().toISOString();
  const rec = { ...item };
  if (!rec.id) rec.id = uid();
  if (!rec.createdAt) rec.createdAt = now;
  if (!rec.userId) rec.userId = LOCAL_USER;
  rec.updatedAt = now;
  commit((s) => {
    const i = s[collection].findIndex((x) => x.id === rec.id);
    if (i >= 0) s[collection][i] = rec;
    else s[collection].push(rec);
  }, opts);
  return rec;
}

export function remove(collection, id, opts = { undoable: true }) {
  commit((s) => {
    s[collection] = s[collection].filter((x) => x.id !== id);
    if (collection === 'contacts') {
      for (const c of ['events', 'tasks']) s[c].forEach((x) => x.contactIds && (x.contactIds = x.contactIds.filter((cid) => cid !== id)));
    }
  }, opts);
}

export function setSetting(key, value) {
  commit((s) => {
    s.settings[key] = value;
  });
}

export function category(id) {
  return state.categories.find((c) => c.id === id) || null;
}

export function exportJSON() {
  const { alarms, sync, ...data } = state;
  return JSON.stringify({ app: 'agendus-web', exportedAt: new Date().toISOString(), ...data }, null, 2);
}

export function importJSON(text, { replace = true } = {}) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.events)) throw new Error('invalid');
  commit((s) => {
    if (replace) {
      for (const c of COLLECTIONS) s[c] = data[c] || [];
      s.categories = data.categories?.length ? data.categories : s.categories;
      s.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
    } else {
      for (const c of COLLECTIONS) {
        const ids = new Set(s[c].map((x) => x.id));
        for (const x of data[c] || []) if (!ids.has(x.id)) s[c].push(x);
      }
      const catIds = new Set(s.categories.map((x) => x.id));
      for (const x of data.categories || []) if (!catIds.has(x.id)) s.categories.push(x);
    }
    s.welcomed = true;
  }, { undoable: true });
}

export function eraseAll() {
  commit((s) => {
    const fresh = empty();
    for (const c of COLLECTIONS) s[c] = [];
    s.categories = fresh.categories;
    s.alarms = fresh.alarms;
    s.welcomed = true;
  }, { undoable: true });
}

// Sample data, positioned around today so every view has something to show.
export function seedDemo(t = (k) => k) {
  const d0 = today();
  const T = (k, fallback) => (t(`demo.${k}`) === `demo.${k}` ? fallback : t(`demo.${k}`));
  const at = (offset, time) => `${addDays(d0, offset)}T${time}`;
  const c = (o) => ({ id: uid(), userId: LOCAL_USER, createdAt: new Date().toISOString(), ...o });
  const kristine = c({ firstName: 'Kristine', lastName: 'Villanueva', company: 'Bright Smile Dental', phones: [{ label: 'work', value: '+1 202 555 0134' }], emails: ['kristine@example.com'], categoryId: 'personal' });
  const william = c({ firstName: 'William', lastName: 'Carlson', company: 'Carlson & Co', title: 'Account manager', phones: [{ label: 'mobile', value: '+1 202 555 0147' }, { label: 'pager', value: '555 0100' }], emails: ['william@example.com'], categoryId: 'business' });
  const fit = c({ firstName: 'Fit', lastName: 'Jansen', phones: [{ label: 'mobile', value: '+1 202 555 0168' }], birthday: addDays(d0, 2).replace(/^\d{4}/, '1988'), categoryId: 'family' });
  const cathy = c({ firstName: 'Cathy', lastName: 'Clarkson', company: 'Northwind', emails: ['cathy@example.com'], categoryId: 'business' });
  const contacts = [kristine, william, fit, cathy];
  const wd = new Date().getDay();
  const events = [
    c({ title: T('dentist', 'Dentist appointment'), icon: 'stethoscope', start: at(0, '11:30'), end: at(0, '14:30'), categoryId: 'personal', contactIds: [kristine.id], location: 'Bright Smile Dental', alarm: 30 }),
    c({ title: T('standup', 'Team stand-up'), icon: 'users', start: at(0, '09:00'), end: at(0, '09:15'), categoryId: 'business', repeat: { freq: 'weekly', interval: 1, days: [1, 2, 3, 4, 5] }, alarm: 5 }),
    c({ title: T('gym', 'Gym'), icon: 'dumbbell', start: at(1, '18:00'), end: at(1, '19:00'), categoryId: 'personal', repeat: { freq: 'weekly', interval: 1, days: [1, 3, 5] } }),
    c({ title: T('lunch', 'Lunch with Cathy'), icon: 'utensils', start: at(1, '12:30'), end: at(1, '13:30'), categoryId: 'business', contactIds: [cathy.id], location: 'Cafe de Jaren' }),
    c({ title: T('conference', 'Marketing Conference'), icon: 'presentation', start: addDays(d0, 7), end: addDays(d0, 8), allDay: true, categoryId: 'business', location: 'RAI Amsterdam' }),
    c({ title: T('payday', 'Pay day'), icon: 'banknote', start: `${d0.slice(0, 8)}25`, end: `${d0.slice(0, 8)}25`, allDay: true, categoryId: 'personal', repeat: { freq: 'monthly', interval: 1, monthBy: 'date' } }),
    c({ title: T('flight', 'Flight to Lisbon'), icon: 'plane', start: at(12, '07:45'), end: at(12, '10:20'), categoryId: 'holiday', location: 'Schiphol', alarm: 120 }),
    c({ title: T('review', 'Project review'), icon: 'briefcase', start: at(wd === 5 ? 3 : 2, '14:00'), end: at(wd === 5 ? 3 : 2, '15:30'), categoryId: 'business', contactIds: [william.id] }),
  ];
  const tasks = [
    c({ title: T('boarding', 'Print boarding pass'), icon: 'plane', due: addDays(d0, 11), priority: 2, categoryId: 'holiday', done: false }),
    c({ title: T('dinner', 'Make dinner reservation'), icon: 'utensils', due: d0, priority: 3, categoryId: 'personal', done: false }),
    c({ title: T('callWilliam', 'Call William about the proposal'), icon: 'phone', due: addDays(d0, -1), priority: 1, categoryId: 'business', contactIds: [william.id], done: false }),
    c({ title: T('birthdayReminder', 'Send birthday reminder to people'), icon: 'cake', due: addDays(d0, 1), priority: 3, categoryId: 'family', contactIds: [fit.id], done: false }),
    c({ title: T('plants', 'Water the plants'), icon: 'house', due: d0, priority: 4, categoryId: 'personal', done: false, repeat: { freq: 'weekly', interval: 1 } }),
    c({ title: T('passport', 'Renew passport'), priority: 3, categoryId: 'personal', done: false, due: null }),
  ];
  const memos = [
    c({ text: T('memo1', 'Packing list Lisbon\n- Passport\n- Charger\n- Sunglasses\n- Guide book'), categoryId: 'holiday' }),
    c({ text: T('memo2', 'Ideas for the conference talk\nOpen with the Palm story, then show the new roadmap.'), categoryId: 'business' }),
  ];
  commit((s) => {
    s.contacts.push(...contacts);
    s.events.push(...events);
    s.tasks.push(...tasks);
    s.memos.push(...memos);
    s.welcomed = true;
  });
}

export function markWelcomed() {
  commit((s) => {
    s.welcomed = true;
  });
}
