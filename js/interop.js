// Import/export in standard formats: iCalendar (.ics) for appointments and tasks,
// vCard (.vcf) for contacts. Lets you move data from Google, Apple or Outlook.
import { state, commit, LOCAL_USER } from './store.js';
import { uid, addDays, toLocal, parseYmd } from './util.js';
import { birthdayParts } from './query.js';

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const escIcs = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const unescIcs = (s) => String(s || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

function fold(line) {
  const out = [];
  while (line.length > 74) {
    out.push(line.slice(0, 74));
    line = ' ' + line.slice(74);
  }
  out.push(line);
  return out.join('\r\n');
}

const icsDate = (d) => d.replace(/-/g, '');
const icsDateTime = (l) => l.replace(/[-:]/g, '') + '00';

function rrule(r) {
  if (!r?.freq) return null;
  const parts = [`FREQ=${r.freq.toUpperCase()}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.freq === 'weekly' && r.days?.length) parts.push(`BYDAY=${r.days.map((d) => DAYS[d]).join(',')}`);
  if (r.until) parts.push(`UNTIL=${icsDate(r.until)}`);
  return parts.join(';');
}

function rruleMonthlyWeekday(r, startDay) {
  const d = parseYmd(startDay);
  const n = Math.ceil(d.getDate() / 7);
  return `${rrule(r)};BYDAY=${n >= 5 ? -1 : n}${DAYS[d.getDay()]}`;
}

export function exportICS() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agendus Web//EN', 'CALSCALE:GREGORIAN'];
  const cat = (id) => state.categories.find((c) => c.id === id);
  for (const ev of state.events) {
    L.push('BEGIN:VEVENT', `UID:${ev.id}@agendus-web`, `DTSTAMP:${stamp}`);
    if (ev.allDay) {
      L.push(`DTSTART;VALUE=DATE:${icsDate(ev.start)}`, `DTEND;VALUE=DATE:${icsDate(addDays(ev.end || ev.start, 1))}`);
    } else {
      L.push(`DTSTART:${icsDateTime(ev.start)}`, `DTEND:${icsDateTime(ev.end || ev.start)}`);
    }
    L.push(`SUMMARY:${escIcs(ev.title)}`);
    if (ev.location) L.push(`LOCATION:${escIcs(ev.location)}`);
    if (ev.notes) L.push(`DESCRIPTION:${escIcs(ev.notes)}`);
    const c = cat(ev.categoryId);
    if (c) L.push(`CATEGORIES:${escIcs(c.name || c.id)}`);
    if (ev.repeat?.freq) {
      L.push(`RRULE:${ev.repeat.freq === 'monthly' && ev.repeat.monthBy === 'weekday' ? rruleMonthlyWeekday(ev.repeat, ev.start.slice(0, 10)) : rrule(ev.repeat)}`);
      for (const x of ev.exceptions || []) L.push(ev.allDay ? `EXDATE;VALUE=DATE:${icsDate(x)}` : `EXDATE:${icsDateTime(x + ev.start.slice(10))}`);
    }
    if (ev.alarm != null) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escIcs(ev.title)}`, `TRIGGER:-PT${ev.alarm}M`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  for (const tk of state.tasks) {
    L.push('BEGIN:VTODO', `UID:${tk.id}@agendus-web`, `DTSTAMP:${stamp}`, `SUMMARY:${escIcs(tk.title)}`);
    if (tk.due) L.push(`DUE;VALUE=DATE:${icsDate(tk.due)}`);
    L.push(`PRIORITY:${[0, 1, 3, 5, 7, 9][tk.priority || 3]}`);
    L.push(`STATUS:${tk.done ? 'COMPLETED' : 'NEEDS-ACTION'}`);
    if (tk.notes) L.push(`DESCRIPTION:${escIcs(tk.notes)}`);
    L.push('END:VTODO');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseProp(line) {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...params] = head.split(';');
  const p = {};
  for (const x of params) {
    const [k, v] = x.split('=');
    p[k.toUpperCase()] = (v || '').replace(/"/g, '');
  }
  return { name: name.toUpperCase(), params: p, value };
}

// '20261007', '20261007T093000', '20261007T093000Z' -> local 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm'
function fromIcsDate(v) {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m[7]) return toLocal(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])));
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;
}

function parseRRule(v, startDay) {
  const r = {};
  for (const part of v.split(';')) {
    const [k, val] = part.split('=');
    r[k] = val;
  }
  const freq = (r.FREQ || '').toLowerCase();
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) return null;
  const out = { freq, interval: Number(r.INTERVAL) || 1 };
  if (r.UNTIL) out.until = fromIcsDate(r.UNTIL).slice(0, 10);
  if (freq === 'weekly' && r.BYDAY) out.days = r.BYDAY.split(',').map((d) => DAYS.indexOf(d.slice(-2))).filter((d) => d >= 0);
  if (freq === 'monthly') out.monthBy = r.BYDAY ? 'weekday' : 'date';
  if (r.COUNT && !out.until) {
    // Approximate COUNT with an end date.
    const n = Number(r.COUNT) * out.interval;
    const mult = { daily: 1, weekly: 7, monthly: 31, yearly: 366 }[freq];
    out.until = addDays(startDay, Math.max(0, n * mult - 1));
  }
  return out;
}

export function importICS(text) {
  const lines = unfold(text);
  const events = [], tasks = [];
  let cur = null, kind = null, inAlarm = false;
  const now = new Date().toISOString();
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT' || line === 'BEGIN:VTODO') {
      kind = line.slice(6);
      cur = { exdates: [] };
      continue;
    }
    if (line === 'BEGIN:VALARM') inAlarm = true;
    if (line === 'END:VALARM') {
      inAlarm = false;
      continue;
    }
    if (!cur) continue;
    if (line === 'END:VEVENT' || line === 'END:VTODO') {
      if (kind === 'VEVENT' && cur.DTSTART) {
        const start = fromIcsDate(cur.DTSTART);
        const allDay = start.length === 10;
        let end = cur.DTEND ? fromIcsDate(cur.DTEND) : start;
        if (allDay && cur.DTEND) end = addDays(end, -1);
        if (end < start) end = start;
        events.push({
          id: uid(), userId: LOCAL_USER, createdAt: now,
          title: unescIcs(cur.SUMMARY || ''), start, end, allDay,
          location: unescIcs(cur.LOCATION || ''), notes: unescIcs(cur.DESCRIPTION || ''),
          repeat: cur.RRULE ? parseRRule(cur.RRULE, start.slice(0, 10)) : null,
          exceptions: cur.exdates, alarm: cur.alarm ?? null, contactIds: [], categoryId: '', icon: '',
        });
      } else if (kind === 'VTODO') {
        const p = Number(cur.PRIORITY) || 0;
        tasks.push({
          id: uid(), userId: LOCAL_USER, createdAt: now,
          title: unescIcs(cur.SUMMARY || ''), due: cur.DUE ? fromIcsDate(cur.DUE).slice(0, 10) : null,
          priority: p === 0 ? 3 : Math.min(5, Math.max(1, Math.ceil(p / 2))),
          done: cur.STATUS === 'COMPLETED', notes: unescIcs(cur.DESCRIPTION || ''), contactIds: [], categoryId: '',
        });
      }
      cur = null;
      continue;
    }
    const p = parseProp(line);
    if (!p) continue;
    if (inAlarm) {
      if (p.name === 'TRIGGER') {
        const m = p.value.match(/-?P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
        if (m) cur.alarm = (Number(m[1]) || 0) * 1440 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
      }
      continue;
    }
    if (p.name === 'EXDATE') p.value.split(',').forEach((v) => cur.exdates.push(fromIcsDate(v).slice(0, 10)));
    else cur[p.name] = p.value;
  }
  commit((s) => {
    s.events.push(...events);
    s.tasks.push(...tasks);
  }, { undoable: true });
  return { events: events.length, tasks: tasks.length };
}

// ---- vCard ----

export function exportVCF() {
  const out = [];
  for (const c of state.contacts) {
    out.push('BEGIN:VCARD', 'VERSION:3.0');
    out.push(`N:${escIcs(c.lastName)};${escIcs(c.firstName)};;;`);
    out.push(`FN:${escIcs([c.firstName, c.lastName].filter(Boolean).join(' ') || c.company || '')}`);
    if (c.company) out.push(`ORG:${escIcs(c.company)}`);
    if (c.title) out.push(`TITLE:${escIcs(c.title)}`);
    const typ = { mobile: 'CELL', work: 'WORK', home: 'HOME', pager: 'PAGER', fax: 'FAX', other: 'VOICE' };
    for (const p of c.phones || []) out.push(`TEL;TYPE=${typ[p.label] || 'VOICE'}:${p.value}`);
    for (const e of c.emails || []) out.push(`EMAIL:${e}`);
    if (c.address) out.push(`ADR:;;${escIcs(c.address)};;;;`);
    const b = birthdayParts(c);
    if (b) out.push(`BDAY:${b.year ? b.year : '--'}${String(b.month).padStart(2, '0')}${String(b.day).padStart(2, '0')}`);
    if (c.website) out.push(`URL:${c.website}`);
    if (c.notes) out.push(`NOTE:${escIcs(c.notes)}`);
    out.push('END:VCARD');
  }
  return out.map(fold).join('\r\n') + '\r\n';
}

export function importVCF(text) {
  const contacts = [];
  let cur = null;
  const now = new Date().toISOString();
  const lab = { CELL: 'mobile', WORK: 'work', HOME: 'home', PAGER: 'pager', FAX: 'fax' };
  for (const line of unfold(text)) {
    if (/^BEGIN:VCARD/i.test(line)) {
      cur = { id: uid(), userId: LOCAL_USER, createdAt: now, firstName: '', lastName: '', phones: [], emails: [], categoryId: '' };
      continue;
    }
    if (/^END:VCARD/i.test(line)) {
      if (cur && (cur.firstName || cur.lastName || cur.company)) contacts.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const p = parseProp(line.replace(/^item\d+\./i, ''));
    if (!p) continue;
    const v = unescIcs(p.value);
    switch (p.name) {
      case 'N': {
        const [last, first] = p.value.split(';');
        cur.lastName = unescIcs(last || '');
        cur.firstName = unescIcs(first || '');
        break;
      }
      case 'FN':
        if (!cur.firstName && !cur.lastName) {
          const parts = v.split(' ');
          cur.firstName = parts.shift() || '';
          cur.lastName = parts.join(' ');
        }
        break;
      case 'ORG':
        cur.company = v.split(';')[0];
        break;
      case 'TITLE':
        cur.title = v;
        break;
      case 'TEL': {
        const types = (p.params.TYPE || '').toUpperCase().split(',');
        const label = types.map((x) => lab[x]).find(Boolean) || 'other';
        cur.phones.push({ label, value: p.value });
        break;
      }
      case 'EMAIL':
        cur.emails.push(p.value);
        break;
      case 'ADR':
        cur.address = p.value.split(';').map(unescIcs).filter(Boolean).join('\n');
        break;
      case 'BDAY': {
        const m = p.value.replace(/-/g, '').match(/^(\d{4})?(\d{2})(\d{2})$/) || p.value.match(/^--(\d{2})-?(\d{2})$/);
        if (m && m.length === 4) cur.birthday = m[1] ? `${m[1]}-${m[2]}-${m[3]}` : `--${m[2]}-${m[3]}`;
        else if (m) cur.birthday = `--${m[1]}-${m[2]}`;
        break;
      }
      case 'URL':
        cur.website = p.value;
        break;
      case 'NOTE':
        cur.notes = v;
        break;
    }
  }
  commit((s) => {
    s.contacts.push(...contacts);
  }, { undoable: true });
  return contacts.length;
}
