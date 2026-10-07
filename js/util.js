// Shared helpers: escaping, ids, and local (floating) date handling.
// Dates are stored as 'YYYY-MM-DD' and date-times as 'YYYY-MM-DDTHH:mm' in local time,
// the same way a PDA calendar treats them: no time zone conversion.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const clone = (o) => JSON.parse(JSON.stringify(o));

const pad = (n) => String(n).padStart(2, '0');

export function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hm(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toLocal(d) {
  return `${ymd(d)}T${hm(d)}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function parseLocal(s) {
  if (!s) return null;
  if (s.length <= 10) return parseYmd(s);
  const [date, time] = s.split('T');
  const d = parseYmd(date);
  const [h, mi] = time.split(':').map(Number);
  d.setHours(h, mi, 0, 0);
  return d;
}

export const today = () => ymd(new Date());

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function addMonths(s, n) {
  const d = parseYmd(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return ymd(d);
}

export function addMinutes(local, n) {
  const d = parseLocal(local);
  d.setMinutes(d.getMinutes() + n);
  return toLocal(d);
}

export const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();

// Whole days between two 'YYYY-MM-DD' strings (b - a), DST-safe.
export function diffDays(a, b) {
  const da = parseYmd(a), db = parseYmd(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86400000);
}

export function minutesBetween(a, b) {
  return Math.round((parseLocal(b) - parseLocal(a)) / 60000);
}

export function startOfWeek(s, weekStart = 1) {
  const d = parseYmd(s);
  const diff = (d.getDay() - weekStart + 7) % 7;
  return addDays(s, -diff);
}

export const weekday = (s) => parseYmd(s).getDay();

export function minutesOfDay(local) {
  const t = local.split('T')[1] || '00:00';
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function isoWeek(s) {
  const d = parseYmd(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}
