// Reusable HTML fragments shared by several views.
import { esc, today, addDays, startOfWeek, parseYmd, daysInMonth, ymd } from './util.js';
import { icon, itemIcon } from './icons.js';
import { t, fmtTime, weekdayLetters, fmtMonth, relDay } from './i18n.js';
import { catColor, contactsByIds, contactName, isOverdue } from './query.js';
import { state } from './store.js';

export function timeLabel(o) {
  if (o.allDay) return `<span class="time-all">${esc(t('event.allDay'))}</span>`;
  const multi = o.day !== o.endDay;
  return `<span class="time-start">${fmtTime(o.start)}</span><span class="time-end">${multi ? '' : fmtTime(o.end)}</span>`;
}

export function occRow(o, { showDay = false, now = null } = {}) {
  const ev = o.ev;
  const people = contactsByIds(ev.contactIds);
  const past = now && !o.allDay && o.end < now;
  const current = now && !o.allDay && o.start <= now && o.end > now;
  const meta = [
    showDay ? relDay(o.day) : '',
    ev.location ? esc(ev.location) : '',
    people.length ? esc(people.map((c) => contactName(c)).join(', ')) : '',
  ].filter(Boolean);
  return `<button class="row occ ${past ? 'is-past' : ''} ${current ? 'is-now' : ''}" data-act="open-occ" data-id="${ev.id}" data-day="${o.day}" style="--cat:${catColor(ev.categoryId)}">
    <span class="row-time">${timeLabel(o)}</span>
    <span class="row-bar"></span>
    ${ev.icon ? itemIcon(ev.icon) : ''}
    <span class="row-main">
      <span class="row-title">${esc(ev.title || t('event.untitled'))}${ev.repeat?.freq ? ` ${icon('repeat', { size: 12, cls: 'i-inline' })}` : ''}${ev.alarm != null ? ` ${icon('bell', { size: 12, cls: 'i-inline' })}` : ''}</span>
      ${meta.length ? `<span class="row-meta">${meta.join(' · ')}</span>` : ''}
    </span>
  </button>`;
}

export function priorityBadge(p) {
  return `<span class="prio prio-${p || 3}" title="${esc(t('task.priority'))} ${p || 3}">${p || 3}</span>`;
}

export function taskRow(tk, { showDue = true } = {}) {
  const people = contactsByIds(tk.contactIds);
  const overdue = isOverdue(tk);
  const dueTxt = tk.due ? relDay(tk.due) : '';
  return `<div class="row task ${tk.done ? 'is-done' : ''}" style="--cat:${catColor(tk.categoryId)}">
    <button class="check" data-act="toggle-task" data-id="${tk.id}" role="checkbox" aria-checked="${!!tk.done}" aria-label="${esc(t('task.toggle'))}">
      ${icon(tk.done ? 'square-check-big' : 'square', { size: 22 })}
    </button>
    ${priorityBadge(tk.priority)}
    ${tk.icon ? itemIcon(tk.icon) : ''}
    <button class="row-main" data-act="edit-task" data-id="${tk.id}">
      <span class="row-title">${esc(tk.title || t('task.untitled'))}${tk.repeat?.freq ? ` ${icon('repeat', { size: 12, cls: 'i-inline' })}` : ''}</span>
      ${showDue && (dueTxt || people.length) ? `<span class="row-meta">${dueTxt ? `<span class="${overdue ? 'overdue' : ''}">${esc(dueTxt)}</span>` : ''}${dueTxt && people.length ? ' · ' : ''}${esc(people.map((c) => contactName(c)).join(', '))}</span>` : ''}
    </button>
    <span class="cat-dot"></span>
  </div>`;
}

export function avatar(c, size = 36) {
  const initials = ((c.firstName || '')[0] || '') + ((c.lastName || c.company || '')[0] || '');
  return `<span class="avatar" style="--size:${size}px;--cat:${catColor(c.categoryId)}">${esc(initials.toUpperCase() || '?')}</span>`;
}

export function contactRow(c, { compact = false } = {}) {
  const phone = c.phones?.find((p) => p.value);
  const sub = compact ? (phone ? `${t('phone.' + phone.label) || phone.label}: ${phone.value}` : c.company || '') : [c.company, c.title].filter(Boolean).join(' · ');
  return `<button class="row contact" data-act="open-contact" data-id="${c.id}">
    ${avatar(c)}
    <span class="row-main">
      <span class="row-title">${esc(contactName(c, { lastFirst: true }))}</span>
      ${sub ? `<span class="row-meta">${esc(sub)}</span>` : ''}
    </span>
  </button>`;
}

export function quickActions(c) {
  const phone = c.phones?.find((p) => p.value);
  const mobile = c.phones?.find((p) => p.value && p.label === 'mobile') || phone;
  const email = c.emails?.find(Boolean);
  const tel = (v) => v.replace(/[^\d+]/g, '');
  return `<span class="quick">
    ${phone ? `<a class="icon-btn" href="tel:${esc(tel(phone.value))}" aria-label="${esc(t('contact.call'))}">${icon('phone', { size: 18 })}</a>` : ''}
    ${mobile ? `<a class="icon-btn" href="sms:${esc(tel(mobile.value))}" aria-label="${esc(t('contact.sms'))}">${icon('message-square', { size: 18 })}</a>` : ''}
    ${email ? `<a class="icon-btn" href="mailto:${esc(email)}" aria-label="${esc(t('contact.email'))}">${icon('mail', { size: 18 })}</a>` : ''}
  </span>`;
}

export function sectionHead(title, extra = '') {
  return `<h3 class="section-head"><span>${esc(title)}</span>${extra}</h3>`;
}

export function emptyState(msg, actionLabel, act, data = '') {
  return `<div class="empty"><p>${esc(msg)}</p>${actionLabel ? `<button class="btn btn-primary" data-act="${act}" ${data}>${icon('plus', { size: 16 })} ${esc(actionLabel)}</button>` : ''}</div>`;
}

// Mini month grid (used in the year view and the date picker).
export function miniMonth(y, m, { weekStart, busy = new Map(), selected = null, act = 'goto-day', showTitle = true, titleAct = null } = {}) {
  const first = new Date(y, m, 1);
  const firstDay = ymd(first);
  const lead = (first.getDay() - weekStart + 7) % 7;
  const n = daysInMonth(y, m);
  const t0 = today();
  const letters = weekdayLetters(weekStart);
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="mm-cell mm-empty"></span>';
  for (let d = 1; d <= n; d++) {
    const day = `${firstDay.slice(0, 8)}${String(d).padStart(2, '0')}`;
    const wd = (lead + d - 1 + weekStart) % 7;
    const cls = ['mm-cell', wd === 6 ? 'sat' : '', wd === 0 ? 'sun' : '', day === t0 ? 'is-today' : '', day === selected ? 'is-sel' : '', busy.get(day) ? 'busy' : '']
      .filter(Boolean)
      .join(' ');
    cells += `<button class="${cls}" data-act="${act}" data-day="${day}">${d}</button>`;
  }
  return `<div class="mini-month">
    ${showTitle ? `<button class="mm-title" ${titleAct ? `data-act="${titleAct}" data-day="${firstDay}"` : 'tabindex="-1"'}>${esc(fmtMonth(firstDay, 'short'))}</button>` : ''}
    <div class="mm-grid">
      ${letters.map((l, i) => `<span class="mm-head ${(i + weekStart) % 7 === 6 ? 'sat' : ''} ${(i + weekStart) % 7 === 0 ? 'sun' : ''}">${esc(l)}</span>`).join('')}
      ${cells}
    </div>
  </div>`;
}

export function weekStrip(day, { weekStart, busy = new Map() }) {
  const s = startOfWeek(day, weekStart);
  const t0 = today();
  let out = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(s, i);
    const wd = parseYmd(d).getDay();
    out += `<button class="ws-day ${d === day ? 'is-sel' : ''} ${d === t0 ? 'is-today' : ''} ${wd === 6 ? 'sat' : ''} ${wd === 0 ? 'sun' : ''}" data-act="goto-day" data-day="${d}">
      <span class="ws-wd">${esc(new Intl.DateTimeFormat(t.locale(), { weekday: 'narrow' }).format(parseYmd(d)))}</span>
      <span class="ws-num">${parseYmd(d).getDate()}</span>
      <span class="ws-dots">${busy.get(d) ? '<i></i>'.repeat(Math.min(3, busy.get(d))) : ''}</span>
    </button>`;
  }
  return `<div class="week-strip">${out}</div>`;
}

export function catOptions(selected, { includeNone = true } = {}) {
  return `${includeNone ? `<option value="">${esc(t('cat.none'))}</option>` : ''}${state.categories
    .map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name || t('cat.' + c.id))}</option>`)
    .join('')}`;
}
