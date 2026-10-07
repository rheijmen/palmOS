// Tiny i18n layer: t(key, params) with an English fallback, plus locale-aware
// date and time formatting through Intl.
import { STRINGS } from './strings.js';
import { parseLocal, parseYmd, today, addDays } from './util.js';

let lang = 'en';
let locale = 'en-GB';
let hour12 = false;

export function configureI18n(settings) {
  const nav = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase();
  lang = settings.lang === 'auto' ? (nav.startsWith('nl') ? 'nl' : 'en') : settings.lang;
  locale = lang === 'nl' ? 'nl-NL' : nav.startsWith('en') ? safeLocale(navigator.languages?.[0] || navigator.language) : 'en-GB';
  hour12 = settings.hour12 === 'auto' ? !!new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hour12 : !!settings.hour12;
  document.documentElement.lang = lang;
}

// Some environments report tags Intl rejects (e.g. "en-US@posix").
function safeLocale(tag) {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : 'en-GB';
  } catch {
    return 'en-GB';
  }
}

export function t(key, params) {
  let s = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  // "one|other" plural forms, chosen by params.n.
  if (s.includes('|') && params && 'n' in params) s = s.split('|')[Number(params.n) === 1 ? 0 : 1];
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}
t.locale = () => locale;
t.lang = () => lang;

const cache = new Map();
function fmt(opts) {
  const k = locale + JSON.stringify(opts) + hour12;
  if (!cache.has(k)) cache.set(k, new Intl.DateTimeFormat(locale, { ...opts, ...(opts.hour ? { hour12 } : {}) }));
  return cache.get(k);
}

export const fmtTime = (local) => fmt({ hour: 'numeric', minute: '2-digit' }).format(parseLocal(local));
export const fmtHour = (h) => fmt({ hour: 'numeric' }).format(new Date(2024, 0, 1, h));
export const fmtDate = (day, opts = { dateStyle: 'medium' }) => fmt(opts).format(parseYmd(day));
export const fmtWeekday = (day, style = 'short') => fmt({ weekday: style }).format(parseYmd(day));
export const fmtMonth = (day, style = 'long') => fmt({ month: style }).format(parseYmd(day));
export const fmtMonthYear = (day) => fmt({ month: 'long', year: 'numeric' }).format(parseYmd(day));
export const fmtShortMonthYear = (day) => fmt({ month: 'short', year: 'numeric' }).format(parseYmd(day));
export const weekdayLetters = (weekStart) =>
  Array.from({ length: 7 }, (_, i) => fmt({ weekday: 'narrow' }).format(new Date(2024, 0, 7 + ((i + weekStart) % 7))));
export const weekdayShorts = (weekStart) =>
  Array.from({ length: 7 }, (_, i) => fmt({ weekday: 'short' }).format(new Date(2024, 0, 7 + ((i + weekStart) % 7))));

// "Today", "Tomorrow", "Yesterday" or a short date.
export function relDay(day, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const t0 = today();
  if (day === t0) return t('common.today');
  if (day === addDays(t0, 1)) return t('common.tomorrow');
  if (day === addDays(t0, -1)) return t('common.yesterday');
  return fmtDate(day, opts);
}

export function fmtDuration(min) {
  if (min < 60) return t('dur.min', { n: min });
  const h = Math.floor(min / 60), m = min % 60;
  return m ? t('dur.hmin', { h, m }) : t('dur.h', { n: h });
}

export function fmtAlarm(min) {
  if (min == null) return t('alarm.none');
  if (min === 0) return t('alarm.atTime');
  if (min % 1440 === 0) return t('alarm.days', { n: min / 1440 });
  if (min % 60 === 0) return t('alarm.hours', { n: min / 60 });
  return t('alarm.minutes', { n: min });
}
