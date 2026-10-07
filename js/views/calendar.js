// Calendar views: Day, Week, Month, Year and List.
import { state } from '../store.js';
import { esc, today, addDays, addMonths, startOfWeek, parseYmd, daysInMonth, ymd, minutesOfDay, toLocal, isoWeek, diffDays } from '../util.js';
import { t, fmtDate, fmtHour, fmtTime, fmtMonthYear, weekdayShorts, relDay } from '../i18n.js';
import { icon, itemIcon } from '../icons.js';
import { eventsByDay, eventsOnDay, birthdaysInRange, tasksDueOn, catColor, contactName } from '../query.js';
import { occRow, taskRow, miniMonth, sectionHead, emptyState } from '../components.js';

const HOUR_H = 52;

// ---- shared bits ------------------------------------------------------------

function birthdayRow(b) {
  return `<button class="row occ birthday" data-act="open-contact" data-id="${b.contact.id}" style="--cat:${catColor(b.contact.categoryId)}">
    <span class="row-time"><span class="time-all">${esc(t('event.allDay'))}</span></span>
    <span class="row-bar"></span>
    ${itemIcon('cake')}
    <span class="row-main"><span class="row-title">${esc(t('birthday.of', { name: contactName(b.contact) }))}${b.age != null ? ` (${b.age})` : ''}</span></span>
  </button>`;
}

export function dayListHtml(day, { withTasks = true, emptyNew = true } = {}) {
  const occ = eventsOnDay(day);
  const bds = birthdaysInRange(day, day);
  const tasks = withTasks ? tasksDueOn(day) : [];
  const now = day === today() ? toLocal(new Date()) : null;
  let html = bds.map(birthdayRow).join('') + occ.map((o) => occRow(o, { now })).join('');
  if (!occ.length && !bds.length) html += emptyNew ? emptyState(t('day.nothing'), t('event.new'), 'new-event', `data-day="${day}"`) : '';
  if (tasks.length) html += sectionHead(t('tasks.title')) + tasks.map((tk) => taskRow(tk, { showDue: false })).join('');
  return html;
}

// Lay out timed occurrences of one day into side-by-side columns where they overlap.
function layoutDay(occs, day) {
  const items = occs
    .filter((o) => !o.allDay)
    .map((o) => {
      const s = o.day < day ? 0 : minutesOfDay(o.start);
      const e = o.endDay > day ? 1440 : minutesOfDay(o.end);
      return { o, s, e: Math.max(e, s + 15) };
    })
    .sort((a, b) => a.s - b.s || b.e - a.e);
  const clusters = [];
  let cur = null;
  for (const it of items) {
    if (!cur || it.s >= cur.end) {
      cur = { items: [], cols: [], end: 0 };
      clusters.push(cur);
    }
    let col = cur.cols.findIndex((end) => end <= it.s);
    if (col < 0) {
      col = cur.cols.length;
      cur.cols.push(0);
    }
    cur.cols[col] = it.e;
    it.col = col;
    cur.items.push(it);
    cur.end = Math.max(cur.end, it.e);
  }
  for (const c of clusters) for (const it of c.items) it.ncols = c.cols.length;
  return items;
}

function hourRange(occsByDay) {
  let a = state.settings.dayStart, b = state.settings.dayEnd;
  for (const list of occsByDay) {
    for (const it of list) {
      a = Math.min(a, Math.floor(it.s / 60));
      b = Math.max(b, Math.ceil(it.e / 60));
    }
  }
  return [Math.max(0, a), Math.min(24, Math.max(b, a + 1))];
}

function block(it, h0, compact) {
  const ev = it.o.ev;
  const top = ((it.s - h0 * 60) / 60) * HOUR_H;
  const height = Math.max(20, ((it.e - it.s) / 60) * HOUR_H - 2);
  const w = 100 / it.ncols;
  return `<button class="blk ${compact ? 'compact' : ''}" data-act="open-occ" data-id="${ev.id}" data-day="${it.o.day}"
      style="top:${top}px;height:${height}px;left:calc(${w * it.col}% + 1px);width:calc(${w}% - 3px);--cat:${catColor(ev.categoryId)}">
    ${ev.icon ? itemIcon(ev.icon, { size: compact ? 14 : 16 }) : ''}
    <span class="blk-text">${compact ? '' : `<b>${fmtTime(it.o.start)}</b> `}${esc(ev.title || t('event.untitled'))}</span>
  </button>`;
}

function hoursColumn(h0, h1) {
  let s = '';
  for (let h = h0; h < h1; h++) s += `<div class="hour-label" style="height:${HOUR_H}px"><span>${h === h0 ? '' : esc(fmtHour(h))}</span></div>`;
  return `<div class="hours">${s}</div>`;
}

function slots(day, h0, h1) {
  let s = '';
  for (let h = h0; h < h1; h++) s += `<button class="slot" style="height:${HOUR_H}px" data-act="new-at" data-start="${day}T${String(h).padStart(2, '0')}:00" aria-label="${esc(t('event.newAt', { time: fmtHour(h) }))}"></button>`;
  return s;
}

function nowLine(day, h0, h1) {
  if (day !== today()) return '';
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  if (m < h0 * 60 || m > h1 * 60) return '';
  return `<div class="now-line" style="top:${((m - h0 * 60) / 60) * HOUR_H}px"></div>`;
}

function allDayChips(occs, bds, day) {
  const chips = [
    ...bds.map((b) => `<button class="chip" data-act="open-contact" data-id="${b.contact.id}" style="--cat:${catColor(b.contact.categoryId)}">${itemIcon('cake', { size: 14 })}<span>${esc(contactName(b.contact))}</span></button>`),
    ...occs
      .filter((o) => o.allDay || (o.day !== o.endDay && o.day < day && o.endDay > day))
      .map((o) => `<button class="chip" data-act="open-occ" data-id="${o.ev.id}" data-day="${o.day}" style="--cat:${catColor(o.ev.categoryId)}">${o.ev.icon ? itemIcon(o.ev.icon, { size: 14 }) : ''}<span>${esc(o.ev.title || t('event.untitled'))}</span></button>`),
  ];
  return chips.join('');
}

// ---- Day ------------------------------------------------------------------

export const dayView = {
  title: (ctx) => fmtDate(ctx.date, { weekday: 'short', day: 'numeric', month: 'short' }),
  step: (d, n) => addDays(d, n),
  render(ctx) {
    const day = ctx.date;
    const occ = eventsOnDay(day);
    const bds = birthdaysInRange(day, day);
    const items = layoutDay(occ.filter((o) => !(o.day < day && o.endDay > day)), day);
    const [h0, h1] = hourRange([items]);
    const tasks = tasksDueOn(day);
    const chips = allDayChips(occ, bds, day);
    return `
      <div class="day-head">
        <div class="day-date"><span class="big">${parseYmd(day).getDate()}</span><span>${esc(fmtDate(day, { weekday: 'long' }))}<br><small>${esc(fmtDate(day, { month: 'long', year: 'numeric' }))} · ${esc(t('week.short', { n: isoWeek(day) }))}</small></span></div>
        ${chips ? `<div class="chips">${chips}</div>` : ''}
        ${tasks.length ? `<details class="day-tasks"><summary>${icon('square-check-big', { size: 16 })} ${esc(t('day.tasksDue', { n: tasks.length }))}</summary>${tasks.map((tk) => taskRow(tk, { showDue: false })).join('')}</details>` : ''}
      </div>
      <div class="timegrid" data-scroll-to="${h0}">
        ${hoursColumn(h0, h1)}
        <div class="tg-cols"><div class="tg-col">${slots(day, h0, h1)}${items.map((it) => block(it, h0, false)).join('')}${nowLine(day, h0, h1)}</div></div>
      </div>`;
  },
};

// ---- Week -----------------------------------------------------------------

export const weekView = {
  title: (ctx) => {
    const s = startOfWeek(ctx.date, state.settings.weekStart);
    const e = addDays(s, 6);
    const sameMonth = s.slice(0, 7) === e.slice(0, 7);
    return `${fmtDate(s, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${fmtDate(e, { day: 'numeric', month: 'short' })}`;
  },
  step: (d, n) => addDays(d, n * 7),
  render(ctx) {
    const ws = state.settings.weekStart;
    const s = startOfWeek(ctx.date, ws);
    const e = addDays(s, 6);
    const map = eventsByDay(s, e);
    const bds = birthdaysInRange(s, e);
    const days = Array.from({ length: 7 }, (_, i) => addDays(s, i));
    const per = days.map((d) => layoutDay((map.get(d) || []).filter((o) => !(o.day < d && o.endDay > d)), d));
    const [h0, h1] = hourRange(per);
    const names = weekdayShorts(ws);
    const t0 = today();
    const allDay = days.map((d) => allDayChips(map.get(d) || [], bds.filter((b) => b.day === d), d));
    const hasAllDay = allDay.some(Boolean);
    return `
      <div class="week-head">
        <div class="wk-num">${esc(t('week.short', { n: isoWeek(s) }))}</div>
        ${days
          .map((d, i) => {
            const wd = parseYmd(d).getDay();
            return `<button class="wk-day ${d === t0 ? 'is-today' : ''} ${d === ctx.date ? 'is-sel' : ''} ${wd === 6 ? 'sat' : ''} ${wd === 0 ? 'sun' : ''}" data-act="open-day" data-day="${d}"><span>${esc(names[i])}</span><b>${parseYmd(d).getDate()}</b></button>`;
          })
          .join('')}
      </div>
      ${hasAllDay ? `<div class="week-allday"><div class="wk-num"></div>${allDay.map((c) => `<div class="wk-ad">${c}</div>`).join('')}</div>` : ''}
      <div class="timegrid week" data-scroll-to="${h0}">
        ${hoursColumn(h0, h1)}
        <div class="tg-cols">${days
          .map((d, i) => {
            const wd = parseYmd(d).getDay();
            return `<div class="tg-col ${wd === 6 ? 'sat' : ''} ${wd === 0 ? 'sun' : ''}">${slots(d, h0, h1)}${per[i].map((it) => block(it, h0, true)).join('')}${nowLine(d, h0, h1)}</div>`;
          })
          .join('')}</div>
      </div>`;
  },
};

// ---- Month ----------------------------------------------------------------

export const monthView = {
  title: (ctx) => fmtMonthYear(ctx.date),
  step: (d, n) => addMonths(d, n),
  render(ctx) {
    const ws = state.settings.weekStart;
    const sel = ctx.date;
    const first = sel.slice(0, 8) + '01';
    const gridStart = startOfWeek(first, ws);
    const y = parseYmd(first).getFullYear(), m = parseYmd(first).getMonth();
    const last = ymd(new Date(y, m, daysInMonth(y, m)));
    const weeks = Math.ceil((diffDays(gridStart, last) + 1) / 7);
    const gridEnd = addDays(gridStart, weeks * 7 - 1);
    const map = eventsByDay(gridStart, gridEnd);
    const bdMap = new Map();
    for (const b of birthdaysInRange(gridStart, gridEnd)) bdMap.set(b.day, [...(bdMap.get(b.day) || []), b]);
    const t0 = today();
    const names = weekdayShorts(ws);
    const showText = state.settings.monthText;
    let cells = '';
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(gridStart, i);
      const wd = parseYmd(d).getDay();
      const occ = map.get(d) || [];
      const bd = bdMap.get(d) || [];
      const items = [...bd.map((b) => ({ icon: 'cake', title: contactName(b.contact), cat: b.contact.categoryId })), ...occ.map((o) => ({ icon: o.ev.icon, title: o.ev.title, cat: o.ev.categoryId, allDay: o.allDay || o.day !== o.endDay }))];
      const max = 3;
      const shown = items.slice(0, max);
      cells += `<button class="mc ${d.slice(0, 7) !== first.slice(0, 7) ? 'out' : ''} ${d === t0 ? 'is-today' : ''} ${d === sel ? 'is-sel' : ''} ${wd === 6 ? 'sat' : ''} ${wd === 0 ? 'sun' : ''}" data-act="select-day" data-day="${d}">
        <span class="mc-num">${parseYmd(d).getDate()}</span>
        <span class="mc-items">${shown
          .map((it) => `<span class="mc-it ${it.allDay ? 'ad' : ''}" style="--cat:${catColor(it.cat)}">${it.icon ? itemIcon(it.icon, { size: 12 }) : '<i class="mc-dot"></i>'}${showText ? `<span>${esc(it.title || '')}</span>` : ''}</span>`)
          .join('')}${items.length > max ? `<span class="mc-more">+${items.length - max}</span>` : ''}</span>
      </button>`;
    }
    return `
      <div class="month ${showText ? 'with-text' : ''}">
        <div class="mh">${names.map((n, i) => `<span class="${(i + ws) % 7 === 6 ? 'sat' : ''} ${(i + ws) % 7 === 0 ? 'sun' : ''}">${esc(n)}</span>`).join('')}</div>
        <div class="mg" style="--weeks:${weeks}">${cells}</div>
      </div>
      <div class="month-day">
        ${sectionHead(relDay(sel, { weekday: 'long', day: 'numeric', month: 'long' }), `<button class="link-btn" data-act="open-day" data-day="${sel}">${esc(t('month.openDay'))} ${icon('chevron-right', { size: 14 })}</button>`)}
        <div class="list">${dayListHtml(sel)}</div>
      </div>`;
  },
};

// ---- Year -----------------------------------------------------------------

export const yearView = {
  title: (ctx) => ctx.date.slice(0, 4),
  step: (d, n) => addMonths(d, n * 12),
  render(ctx) {
    const y = Number(ctx.date.slice(0, 4));
    const map = eventsByDay(`${y}-01-01`, `${y}-12-31`);
    for (const b of birthdaysInRange(`${y}-01-01`, `${y}-12-31`)) map.set(b.day, [...(map.get(b.day) || []), b]);
    const busy = new Map([...map].map(([k, v]) => [k, v.length]));
    let out = '';
    for (let m = 0; m < 12; m++) out += miniMonth(y, m, { weekStart: state.settings.weekStart, busy, selected: ctx.date, act: 'open-day', titleAct: 'open-month' });
    return `<div class="year-grid">${out}</div>`;
  },
};

// ---- List -----------------------------------------------------------------

let listDays = 45;
export const listView = {
  title: () => t('view.list'),
  step: (d, n) => addDays(d, n * 30),
  reset() {
    listDays = 45;
  },
  render(ctx) {
    const from = ctx.date;
    const to = addDays(from, listDays);
    const map = eventsByDay(from, to);
    for (const b of birthdaysInRange(from, to)) map.set(b.day, [...(map.get(b.day) || []), b]);
    const days = [...map.keys()].sort();
    const now = toLocal(new Date());
    let html = '';
    for (const d of days) {
      const list = map.get(d);
      const bds = list.filter((x) => x.contact);
      const occ = list.filter((x) => x.ev);
      html += `<div class="list-day ${d === today() ? 'is-today' : ''}">${sectionHead(relDay(d, { weekday: 'long', day: 'numeric', month: 'long' }))}${bds.map(birthdayRow).join('')}${occ.map((o) => occRow(o, { now })).join('')}</div>`;
    }
    if (!days.length) html = emptyState(t('list.nothing', { n: listDays }), t('event.new'), 'new-event', `data-day="${from}"`);
    return `<div class="list list-view">${html}<button class="btn btn-ghost more-btn" data-act="list-more">${esc(t('list.more', { date: fmtDate(to) }))}</button></div>`;
  },
};

export function listMore() {
  listDays += 60;
}
