// Read-side helpers: expand recurring events into occurrences, collect what is on a
// given day, and apply the global category filter.
import { state, category } from './store.js';
import { occurrenceDays, matches } from './recur.js';
import { addDays, diffDays, parseYmd, today, minutesOfDay } from './util.js';
import { t } from './i18n.js';

export const catFilter = () => state.settings.category;
export const passesFilter = (item) => catFilter() === 'all' || (catFilter() === 'none' ? !item.categoryId : item.categoryId === catFilter());

export function catName(c) {
  if (!c) return t('cat.none');
  return c.name || t(`cat.${c.id}`);
}
export const catColor = (id) => category(id)?.color || 'var(--muted)';

export const eventStartDay = (ev) => ev.start.slice(0, 10);
export const eventEndDay = (ev) => (ev.end || ev.start).slice(0, 10);

// Occurrence = one concrete instance of an event on a concrete day.
export function occurrencesInRange(from, to, { filter = true } = {}) {
  const out = [];
  for (const ev of state.events) {
    if (filter && !passesFilter(ev)) continue;
    const sDay = eventStartDay(ev);
    const span = Math.max(0, diffDays(sDay, eventEndDay(ev)));
    const days = occurrenceDays(ev.repeat, sDay, addDays(from, -span), to, ev.exceptions || []);
    for (const day of days) out.push(makeOcc(ev, day, span));
  }
  return out.sort(sortOcc);
}

export function makeOcc(ev, day, span = Math.max(0, diffDays(eventStartDay(ev), eventEndDay(ev)))) {
  const endDay = addDays(day, span);
  const time = ev.allDay ? '' : 'T' + ev.start.slice(11, 16);
  const endTime = ev.allDay ? '' : 'T' + (ev.end || ev.start).slice(11, 16);
  return { key: `${ev.id}@${day}`, ev, day, endDay, start: day + time, end: endDay + endTime, allDay: !!ev.allDay };
}

export function sortOcc(a, b) {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start < b.start ? -1 : a.start > b.start ? 1 : (a.ev.title || '').localeCompare(b.ev.title || '');
}

// Does an occurrence cover this day? Timed events ending exactly at midnight don't spill over.
export function occOnDay(o, day) {
  if (day < o.day || day > o.endDay) return false;
  if (!o.allDay && day === o.endDay && day !== o.day && minutesOfDay(o.end) === 0) return false;
  return true;
}

export function eventsOnDay(day, opts) {
  return occurrencesInRange(day, day, opts).filter((o) => occOnDay(o, day));
}

// Map day -> occurrences for a whole range in one pass (month/year/week views).
export function eventsByDay(from, to, opts) {
  const map = new Map();
  for (const o of occurrencesInRange(from, to, opts)) {
    for (let d = o.day < from ? from : o.day; d <= o.endDay && d <= to; d = addDays(d, 1)) {
      if (!occOnDay(o, d)) continue;
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(o);
    }
  }
  return map;
}

export function contactName(c, { lastFirst = false } = {}) {
  if (!c) return '';
  const first = c.firstName || '', last = c.lastName || '';
  const name = lastFirst && last && first ? `${last}, ${first}` : [first, last].filter(Boolean).join(' ');
  return name || c.company || t('contacts.unnamed');
}

export function contactsByIds(ids = []) {
  return ids.map((id) => state.contacts.find((c) => c.id === id)).filter(Boolean);
}

export function birthdayParts(c) {
  if (!c.birthday) return null;
  const m = c.birthday.match(/^(\d{4}|-{1,2})?-?(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = /^\d{4}$/.test(m[1] || '') ? Number(m[1]) : null;
  return { year, month: Number(m[2]), day: Number(m[3]) };
}

export function birthdaysInRange(from, to) {
  const out = [];
  if (!state.contacts.length) return out;
  const y0 = parseYmd(from).getFullYear(), y1 = parseYmd(to).getFullYear();
  for (const c of state.contacts) {
    if (!passesFilter(c)) continue;
    const b = birthdayParts(c);
    if (!b) continue;
    for (let y = y0; y <= y1; y++) {
      if (b.month === 2 && b.day === 29 && new Date(y, 1, 29).getMonth() !== 1) continue;
      const day = `${y}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
      if (day >= from && day <= to) out.push({ key: `bd-${c.id}-${y}`, contact: c, day, age: b.year ? y - b.year : null });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

// --- Tasks -----------------------------------------------------------------

export const PRIORITIES = [1, 2, 3, 4, 5];

export function sortTasks(a, b) {
  if (!!a.done !== !!b.done) return a.done ? 1 : -1;
  const ad = a.due || '9999', bd = b.due || '9999';
  if (ad !== bd) return ad < bd ? -1 : 1;
  if ((a.priority || 3) !== (b.priority || 3)) return (a.priority || 3) - (b.priority || 3);
  return (a.title || '').localeCompare(b.title || '');
}

export function tasksForAgenda(day) {
  const t0 = today();
  const showDone = state.settings.showDoneInAgenda;
  return state.tasks
    .filter(passesFilter)
    .filter((tk) => {
      if (tk.done) return showDone && tk.doneAt?.slice(0, 10) === day;
      if (!tk.due) return state.settings.showUndatedInAgenda && day === t0;
      if (tk.due === day) return true;
      return day === t0 && tk.due < t0; // overdue shows on today
    })
    .sort(sortTasks);
}

export function tasksDueOn(day) {
  return state.tasks.filter((tk) => passesFilter(tk) && !tk.done && tk.due === day);
}

export const isOverdue = (tk) => !tk.done && tk.due && tk.due < today();

export function filterTasks(mode) {
  const t0 = today();
  const base = state.tasks.filter(passesFilter);
  const f = {
    all: (x) => !x.done,
    today: (x) => !x.done && x.due && x.due <= t0,
    upcoming: (x) => !x.done && x.due && x.due > t0,
    nodate: (x) => !x.done && !x.due,
    done: (x) => x.done,
  }[mode] || (() => true);
  const list = base.filter(f);
  return mode === 'done' ? list.sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || '')) : list.sort(sortTasks);
}

// --- Contact history: everything linked to a contact -----------------------

export function contactHistory(contactId) {
  const evs = state.events.filter((e) => e.contactIds?.includes(contactId));
  const tasks = state.tasks.filter((x) => x.contactIds?.includes(contactId));
  return { events: evs.sort((a, b) => (a.start < b.start ? 1 : -1)), tasks: tasks.sort(sortTasks) };
}

// Next upcoming occurrence of an event (for lists and search results).
export function nextOccurrenceOf(ev, from = today()) {
  const sDay = eventStartDay(ev);
  if (!ev.repeat?.freq) return makeOcc(ev, sDay);
  let d = from < sDay ? sDay : from;
  for (let i = 0; i < 800; i++) {
    if (ev.repeat.until && d > ev.repeat.until) break;
    if (matches(ev.repeat, sDay, d, ev.exceptions || [])) return makeOcc(ev, d);
    d = addDays(d, 1);
  }
  return makeOcc(ev, sDay);
}

// --- Search ----------------------------------------------------------------

export function search(q) {
  const s = q.trim().toLowerCase();
  if (!s) return { events: [], tasks: [], contacts: [], memos: [] };
  const has = (...vals) => vals.some((v) => (v || '').toString().toLowerCase().includes(s));
  return {
    events: state.events.filter((e) => has(e.title, e.location, e.notes)).map((e) => nextOccurrenceOf(e)).sort(sortOcc),
    tasks: state.tasks.filter((x) => has(x.title, x.notes)).sort(sortTasks),
    contacts: state.contacts
      .filter((c) => has(c.firstName, c.lastName, c.company, c.title, c.notes, c.address, ...(c.emails || []), ...(c.phones || []).map((p) => p.value)))
      .sort((a, b) => contactName(a, { lastFirst: true }).localeCompare(contactName(b, { lastFirst: true }))),
    memos: state.memos.filter((m) => has(m.text)),
  };
}
