// Recurrence rules for events and tasks.
// repeat = { freq: 'daily'|'weekly'|'monthly'|'yearly', interval: n, days: [0-6], monthBy: 'date'|'weekday', until: 'YYYY-MM-DD'|null }
import { addDays, diffDays, parseYmd, daysInMonth, startOfWeek } from './util.js';

const nthOfMonth = (d) => Math.ceil(d.getDate() / 7);
const isLastOfMonth = (d) => d.getDate() + 7 > daysInMonth(d.getFullYear(), d.getMonth());

// Does a series that starts on `startDay` produce an occurrence on `day`?
export function matches(repeat, startDay, day, exceptions = []) {
  if (day < startDay) return false;
  if (!repeat || !repeat.freq) return day === startDay;
  if (repeat.until && day > repeat.until) return false;
  if (exceptions.includes(day)) return false;
  const iv = Math.max(1, repeat.interval || 1);
  const s = parseYmd(startDay), d = parseYmd(day);
  switch (repeat.freq) {
    case 'daily':
      return diffDays(startDay, day) % iv === 0;
    case 'weekly': {
      const days = repeat.days?.length ? repeat.days : [s.getDay()];
      if (!days.includes(d.getDay())) return false;
      const weeks = diffDays(startOfWeek(startDay, 0), startOfWeek(day, 0)) / 7;
      return weeks % iv === 0;
    }
    case 'monthly': {
      const months = (d.getFullYear() - s.getFullYear()) * 12 + d.getMonth() - s.getMonth();
      if (months % iv !== 0) return false;
      if (repeat.monthBy === 'weekday') {
        if (d.getDay() !== s.getDay()) return false;
        // A series starting on a 5th weekday ("last Friday") stays on the last one.
        if (nthOfMonth(s) >= 5) return isLastOfMonth(d);
        return nthOfMonth(d) === nthOfMonth(s);
      }
      return d.getDate() === s.getDate();
    }
    case 'yearly': {
      const years = d.getFullYear() - s.getFullYear();
      return years % iv === 0 && d.getMonth() === s.getMonth() && d.getDate() === s.getDate();
    }
    default:
      return day === startDay;
  }
}

// All occurrence start days of a series within [from, to] (inclusive).
export function occurrenceDays(repeat, startDay, from, to, exceptions = []) {
  const out = [];
  if (!repeat || !repeat.freq) {
    if (startDay >= from && startDay <= to && !exceptions.includes(startDay)) out.push(startDay);
    return out;
  }
  let day = from < startDay ? startDay : from;
  const end = repeat.until && repeat.until < to ? repeat.until : to;
  // Guard: never walk more than ~6 years in one call.
  let guard = 0;
  while (day <= end && guard++ < 2300) {
    if (matches(repeat, startDay, day, exceptions)) out.push(day);
    day = addDays(day, 1);
  }
  return out;
}

export function nextOccurrence(repeat, startDay, after, exceptions = []) {
  if (!repeat || !repeat.freq) return null;
  let day = addDays(after, 1);
  for (let i = 0; i < 4000; i++) {
    if (repeat.until && day > repeat.until) return null;
    if (matches(repeat, startDay, day, exceptions)) return day;
    day = addDays(day, 1);
  }
  return null;
}

export function describeRepeat(repeat, t, startDay) {
  if (!repeat || !repeat.freq) return '';
  const iv = Math.max(1, repeat.interval || 1);
  let s = iv === 1 ? t(`repeat.every.${repeat.freq}`) : t(`repeat.everyN.${repeat.freq}`, { n: iv });
  if (repeat.freq === 'weekly' && repeat.days?.length) {
    const names = repeat.days.slice().sort().map((d) => new Intl.DateTimeFormat(t.locale(), { weekday: 'short' }).format(new Date(2024, 0, 7 + d)));
    s += ` (${names.join(', ')})`;
  }
  if (repeat.freq === 'monthly' && repeat.monthBy === 'weekday' && startDay) {
    const d = parseYmd(startDay);
    const wd = new Intl.DateTimeFormat(t.locale(), { weekday: 'long' }).format(d);
    s += ` (${t('repeat.nth.' + Math.min(nthOfMonth(d), 5))} ${wd})`;
  }
  if (repeat.until) s += ` ${t('repeat.until')} ${new Intl.DateTimeFormat(t.locale(), { dateStyle: 'medium' }).format(parseYmd(repeat.until))}`;
  return s;
}
