// Detail and edit sheets for appointments, tasks, contacts and memos,
// plus the pickers they share (icons, contacts, dates) and follow-ups.
import { state, get, upsert, remove, commit, undo } from './store.js';
import { esc, today, addDays, addMinutes, minutesBetween, parseYmd, toLocal, ymd, diffDays, addMonths } from './util.js';
import { t, fmtDate, fmtTime, fmtAlarm, fmtDuration, relDay, fmtMonthYear } from './i18n.js';
import { icon, itemIcon, ITEM_ICONS } from './icons.js';
import { openSheet, closeSheet, choose, toast } from './ui.js';
import { describeRepeat, nextOccurrence } from './recur.js';
import { contactsByIds, contactName, catName, catColor, contactHistory, nextOccurrenceOf, makeOcc, eventStartDay, eventEndDay, birthdayParts } from './query.js';
import { catOptions, avatar, taskRow, miniMonth } from './components.js';
import { sortedContacts } from './views/contacts.js';
import { memoTitle } from './views/memos.js';

const ALARMS = [null, 0, 5, 10, 15, 30, 60, 120, 1440, 2880];
const PHONE_LABELS = ['mobile', 'work', 'home', 'pager', 'fax', 'other'];

// ---------------------------------------------------------------- helpers

function formData(form) {
  const fd = new FormData(form);
  const o = {};
  for (const [k, v] of fd.entries()) {
    if (k in o) o[k] = [].concat(o[k], v);
    else o[k] = v;
  }
  return o;
}

const field = (label, inner, cls = '') => `<label class="field ${cls}"><span class="field-label">${esc(label)}</span>${inner}</label>`;

function iconPicker(selected) {
  return `<div class="icon-picker">
    <input type="hidden" name="icon" value="${esc(selected || '')}">
    <button type="button" class="icon-current" data-ip="toggle" aria-label="${esc(t('editor.icon'))}">
      ${selected ? itemIcon(selected, { size: 22 }) : `<span class="ii none">${icon('circle', { size: 22 })}</span>`}
    </button>
    <div class="icon-grid" hidden>
      <button type="button" data-ip-pick="" class="${!selected ? 'on' : ''}" aria-label="${esc(t('editor.noIcon'))}"><span class="ii none">${icon('x', { size: 18 })}</span></button>
      ${Object.keys(ITEM_ICONS).map((n) => `<button type="button" data-ip-pick="${n}" class="${n === selected ? 'on' : ''}" aria-label="${n}">${itemIcon(n, { size: 20 })}</button>`).join('')}
    </div>
  </div>`;
}

function bindIconPicker(root) {
  const wrap = root.querySelector('.icon-picker');
  if (!wrap) return;
  const grid = wrap.querySelector('.icon-grid');
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-ip="toggle"]')) {
      grid.hidden = !grid.hidden;
      return;
    }
    const b = e.target.closest('[data-ip-pick]');
    if (!b) return;
    const name = b.dataset.ipPick;
    wrap.querySelector('input[name=icon]').value = name;
    wrap.querySelector('.icon-current').innerHTML = name ? itemIcon(name, { size: 22 }) : `<span class="ii none">${icon('circle', { size: 22 })}</span>`;
    grid.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    grid.hidden = true;
  });
}

function contactChips(ids) {
  return `<div class="contact-chips" data-ids="${esc(ids.join(','))}">
    ${contactsByIds(ids)
      .map((c) => `<span class="chip">${avatar(c, 20)}<span>${esc(contactName(c))}</span><button type="button" data-cc-remove="${c.id}" aria-label="${esc(t('common.remove'))}">${icon('x', { size: 14 })}</button></span>`)
      .join('')}
    <button type="button" class="chip chip-add" data-cc-add>${icon('plus', { size: 14 })} ${esc(t('editor.addContact'))}</button>
  </div>`;
}

function bindContactChips(root) {
  const box = () => root.querySelector('.contact-chips');
  const ids = () => (box().dataset.ids ? box().dataset.ids.split(',') : []);
  const redraw = (list) => {
    box().outerHTML = contactChips(list);
  };
  root.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-cc-remove]');
    if (rm) return redraw(ids().filter((x) => x !== rm.dataset.ccRemove));
    if (e.target.closest('[data-cc-add]')) openContactPicker(ids(), (list) => redraw(list));
  });
  return () => ids();
}

function repeatFields(repeat, startDay) {
  const r = repeat || {};
  const kind = !r.freq ? '' : r.freq === 'monthly' && r.monthBy === 'weekday' ? 'monthly-wd' : r.freq;
  const wdStart = parseYmd(startDay || today()).getDay();
  const days = r.days?.length ? r.days : [wdStart];
  const names = Array.from({ length: 7 }, (_, i) => (i + state.settings.weekStart) % 7);
  const opts = [
    ['', t('repeat.none')],
    ['daily', t('repeat.daily')],
    ['weekly', t('repeat.weekly')],
    ['monthly', t('repeat.monthlyDate')],
    ['monthly-wd', t('repeat.monthlyWeekday')],
    ['yearly', t('repeat.yearly')],
  ];
  return `<div class="repeat-box">
    ${field(t('editor.repeat'), `<select name="repeatKind" data-repeat>${opts.map(([v, l]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`)}
    <div class="repeat-more" ${kind ? '' : 'hidden'}>
      <div class="row-fields">
        ${field(t('repeat.interval'), `<input type="number" name="repeatInterval" min="1" max="99" value="${r.interval || 1}" inputmode="numeric">`)}
        ${field(t('repeat.until'), `<input type="date" name="repeatUntil" value="${esc(r.until || '')}">`)}
      </div>
      <div class="weekday-toggle" ${kind === 'weekly' ? '' : 'hidden'}>
        ${names
          .map((d) => `<label><input type="checkbox" name="repeatDays" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${esc(new Intl.DateTimeFormat(t.locale(), { weekday: 'narrow' }).format(new Date(2024, 0, 7 + d)))}</span></label>`)
          .join('')}
      </div>
    </div>
  </div>`;
}

function bindRepeat(root) {
  const sel = root.querySelector('[data-repeat]');
  if (!sel) return;
  sel.addEventListener('change', () => {
    root.querySelector('.repeat-more').hidden = !sel.value;
    root.querySelector('.weekday-toggle').hidden = sel.value !== 'weekly';
  });
}

function readRepeat(d) {
  if (!d.repeatKind) return null;
  const freq = d.repeatKind === 'monthly-wd' ? 'monthly' : d.repeatKind;
  const r = { freq, interval: Math.max(1, Number(d.repeatInterval) || 1) };
  if (d.repeatKind === 'monthly-wd') r.monthBy = 'weekday';
  if (d.repeatKind === 'monthly') r.monthBy = 'date';
  if (freq === 'weekly') r.days = [].concat(d.repeatDays || []).map(Number);
  if (d.repeatUntil) r.until = d.repeatUntil;
  return r;
}

// ---------------------------------------------------------------- new chooser

export function openNewChooser(day = today()) {
  const opts = [
    ['new-event', 'calendar', t('event.new')],
    ['new-task', 'square-check-big', t('task.new')],
    ['new-contact', 'contact', t('contact.new')],
    ['new-memo', 'sticky-note', t('memo.new')],
  ];
  openSheet({
    title: t('common.new'),
    cls: 'sheet-dialog',
    body: `<div class="new-grid">${opts.map(([a, i, l]) => `<button class="new-tile" data-pick="${a}">${icon(i, { size: 26 })}<span>${esc(l)}</span></button>`).join('')}</div>`,
    onMount(el) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]');
        if (!b) return;
        closeSheet();
        const a = b.dataset.pick;
        setTimeout(() => {
          if (a === 'new-event') openEventEditor({ day });
          if (a === 'new-task') openTaskEditor({ prefill: { due: day } });
          if (a === 'new-contact') openContactEditor({});
          if (a === 'new-memo') openMemoEditor({});
        }, 30);
      });
    },
  });
}

// ---------------------------------------------------------------- events

export function openEventDetail(id, day) {
  const ev = get('events', id);
  if (!ev) return;
  const o = makeOcc(ev, day || eventStartDay(ev));
  const people = contactsByIds(ev.contactIds);
  const multi = o.day !== o.endDay;
  const when = o.allDay
    ? multi
      ? `${fmtDate(o.day, { weekday: 'short', day: 'numeric', month: 'short' })} – ${fmtDate(o.endDay, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}`
      : fmtDate(o.day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : multi
      ? `${fmtDate(o.day, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(o.start)} – ${fmtDate(o.endDay, { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(o.end)}`
      : `${fmtDate(o.day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}<br>${fmtTime(o.start)} – ${fmtTime(o.end)} <span class="muted">(${fmtDuration(minutesBetween(o.start, o.end))})</span>`;
  openSheet({
    title: t('event.details'),
    body: `
      <div class="detail-head" style="--cat:${catColor(ev.categoryId)}">
        ${ev.icon ? itemIcon(ev.icon, { size: 30 }) : ''}
        <div><h3>${esc(ev.title || t('event.untitled'))}</h3><p>${when}</p></div>
      </div>
      <dl class="detail-list">
        ${ev.repeat?.freq ? `<dt>${icon('repeat', { size: 16 })}</dt><dd>${esc(describeRepeat(ev.repeat, t, eventStartDay(ev)))}</dd>` : ''}
        ${ev.alarm != null ? `<dt>${icon('bell', { size: 16 })}</dt><dd>${esc(fmtAlarm(ev.alarm))}</dd>` : ''}
        ${ev.location ? `<dt>${icon('map-pin', { size: 16 })}</dt><dd><a href="https://www.openstreetmap.org/search?query=${encodeURIComponent(ev.location)}" target="_blank" rel="noopener">${esc(ev.location)}</a></dd>` : ''}
        <dt>${icon('tag', { size: 16 })}</dt><dd><span class="cat-tag" style="--cat:${catColor(ev.categoryId)}">${esc(catName(state.categories.find((c) => c.id === ev.categoryId)))}</span></dd>
        ${ev.notes ? `<dt>${icon('notebook-pen', { size: 16 })}</dt><dd class="notes">${esc(ev.notes)}</dd>` : ''}
      </dl>
      ${people.length ? `<h4 class="sub-head">${esc(t('editor.contacts'))}</h4><div class="list">${people
        .map((c) => `<div class="row contact"><button class="row-link" data-act="open-contact" data-id="${c.id}">${avatar(c, 32)}<span class="row-main"><span class="row-title">${esc(contactName(c))}</span>${c.company ? `<span class="row-meta">${esc(c.company)}</span>` : ''}</span></button>${quickActionsFor(c)}</div>`)
        .join('')}</div>` : ''}`,
    footer: `
      <button class="btn btn-ghost" data-d="delete">${icon('trash-2', { size: 16 })}<span>${esc(t('common.delete'))}</span></button>
      <button class="btn btn-ghost" data-d="duplicate">${icon('copy', { size: 16 })}<span>${esc(t('common.duplicate'))}</span></button>
      <button class="btn btn-ghost" data-d="followup">${icon('arrow-right', { size: 16 })}<span>${esc(t('followup.title'))}</span></button>
      <button class="btn btn-primary" data-d="edit">${icon('pencil', { size: 16 })}<span>${esc(t('common.edit'))}</span></button>`,
    onMount(el) {
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-d]');
        if (!b) return;
        const a = b.dataset.d;
        if (a === 'edit') {
          closeSheet();
          setTimeout(() => openEventEditor({ id, occDay: o.day }), 30);
        } else if (a === 'delete') {
          closeSheet();
          setTimeout(() => deleteEvent(ev, o.day), 30);
        } else if (a === 'duplicate') {
          closeSheet();
          const copy = { ...ev, id: undefined, createdAt: undefined, repeat: null, exceptions: [], start: o.start, end: o.end, title: ev.title };
          setTimeout(() => openEventEditor({ prefill: copy }), 30);
        } else if (a === 'followup') {
          closeSheet();
          setTimeout(() => openFollowUp({ title: ev.title, contactIds: ev.contactIds, categoryId: ev.categoryId, icon: ev.icon, start: o.start, end: o.end, allDay: o.allDay }), 30);
        }
      });
    },
  });
}

function quickActionsFor(c) {
  const phone = c.phones?.find((p) => p.value);
  const email = c.emails?.find(Boolean);
  const tel = (v) => v.replace(/[^\d+]/g, '');
  return `<span class="quick">${phone ? `<a class="icon-btn" href="tel:${esc(tel(phone.value))}" aria-label="${esc(t('contact.call'))}">${icon('phone', { size: 18 })}</a><a class="icon-btn" href="sms:${esc(tel(phone.value))}" aria-label="${esc(t('contact.sms'))}">${icon('message-square', { size: 18 })}</a>` : ''}${email ? `<a class="icon-btn" href="mailto:${esc(email)}" aria-label="${esc(t('contact.email'))}">${icon('mail', { size: 18 })}</a>` : ''}</span>`;
}

async function askScope(kindKey, { allowFuture = true } = {}) {
  const options = [
    { value: 'one', label: t('scope.one') },
    ...(allowFuture ? [{ value: 'future', label: t('scope.future') }] : []),
    { value: 'all', label: t('scope.all') },
  ];
  return choose({ title: t(kindKey), message: t('scope.message'), options });
}

export async function deleteEvent(ev, occDay) {
  let scope = 'all';
  if (ev.repeat?.freq) {
    scope = await askScope('scope.deleteTitle', { allowFuture: occDay !== eventStartDay(ev) });
    if (!scope) return;
  }
  removeOccurrence(ev, occDay, scope, { undoable: true });
  toast(t('event.deleted'), { action: t('common.undo'), onAction: undo });
}

// Non-interactive building blocks (also used by the assistant).
// scope: 'one' | 'future' | 'all'; ignored for appointments that don't repeat.
export function removeOccurrence(ev, occDay, scope, opts = {}) {
  if (ev.repeat?.freq && scope === 'one') {
    commit((s) => {
      const x = s.events.find((e) => e.id === ev.id);
      x.exceptions = [...(x.exceptions || []), occDay];
    }, opts);
  } else if (ev.repeat?.freq && scope === 'future' && occDay !== eventStartDay(ev)) {
    commit((s) => {
      const x = s.events.find((e) => e.id === ev.id);
      x.repeat = { ...x.repeat, until: addDays(occDay, -1) };
    }, opts);
  } else remove('events', ev.id, opts);
}

export function changeOccurrence(ev, occDay, data, scope) {
  if (ev.repeat?.freq) saveRecurring(ev, occDay, data, scope === 'future' && occDay === eventStartDay(ev) ? 'all' : scope);
  else upsert('events', { ...ev, ...data });
}

// openEventEditor({ id, occDay, day, start, prefill })
export function openEventEditor({ id, occDay, day, start, prefill } = {}) {
  const existing = id ? get('events', id) : null;
  const s = state.settings;
  let ev;
  if (existing) {
    const o = makeOcc(existing, occDay || eventStartDay(existing));
    ev = { ...existing, start: o.start, end: o.end };
  } else {
    const base = start || `${day || today()}T${nextHalfHour(day)}`;
    ev = { title: '', allDay: false, start: base, end: addMinutes(base, s.defaultDuration), alarm: s.defaultAlarm, categoryId: s.category !== 'all' && s.category !== 'none' ? s.category : '', contactIds: [], ...prefill };
    if (prefill?.allDay && prefill.start?.length === 10) ev.end = prefill.end || prefill.start;
  }
  const sDay = ev.start.slice(0, 10);
  const eDay = (ev.end || ev.start).slice(0, 10);
  const sTime = ev.allDay ? nextHalfHour(sDay) : ev.start.slice(11, 16);
  const eTime = ev.allDay ? addMinutes(`${sDay}T${sTime}`, s.defaultDuration).slice(11, 16) : (ev.end || ev.start).slice(11, 16);

  openSheet({
    title: existing ? t('event.edit') : t('event.new'),
    cls: 'sheet-form',
    body: `<form class="form" id="event-form" novalidate>
      <div class="title-line">
        ${iconPicker(ev.icon)}
        <input name="title" class="title-input" value="${esc(ev.title)}" placeholder="${esc(t('event.titlePh'))}" autofocus required autocomplete="off" enterkeyhint="done">
      </div>
      <label class="switch"><input type="checkbox" name="allDay" ${ev.allDay ? 'checked' : ''}><span>${esc(t('event.allDay'))}</span></label>
      <div class="row-fields dt">
        ${field(t('editor.starts'), `<input type="date" name="sDay" value="${sDay}" required>`)}
        ${field(t('editor.time'), `<input type="time" name="sTime" value="${sTime}" step="300">`, 'time-f')}
      </div>
      <div class="row-fields dt">
        ${field(t('editor.ends'), `<input type="date" name="eDay" value="${eDay}" required>`)}
        ${field(t('editor.time'), `<input type="time" name="eTime" value="${eTime}" step="300">`, 'time-f')}
      </div>
      ${repeatFields(ev.repeat, sDay)}
      <div class="row-fields">
        ${field(t('editor.alarm'), `<select name="alarm">${ALARMS.map((a) => `<option value="${a ?? ''}" ${a === (ev.alarm ?? null) ? 'selected' : ''}>${esc(fmtAlarm(a))}</option>`).join('')}</select>`)}
        ${field(t('editor.category'), `<select name="categoryId">${catOptions(ev.categoryId)}</select>`)}
      </div>
      ${field(t('editor.location'), `<input name="location" value="${esc(ev.location || '')}" autocomplete="off" placeholder="${esc(t('editor.locationPh'))}">`)}
      <div class="field"><span class="field-label">${esc(t('editor.contacts'))}</span>${contactChips(ev.contactIds || [])}</div>
      ${field(t('editor.notes'), `<textarea name="notes" rows="3">${esc(ev.notes || '')}</textarea>`)}
    </form>`,
    footer: `${existing ? `<button class="btn btn-ghost btn-danger-text" data-e="delete">${icon('trash-2', { size: 16 })}<span>${esc(t('common.delete'))}</span></button>` : ''}
      <span class="spacer"></span>
      <button class="btn btn-ghost" data-close>${esc(t('common.cancel'))}</button>
      <button class="btn btn-primary" data-e="save">${esc(t('common.save'))}</button>`,
    onMount(el) {
      const form = el.querySelector('form');
      bindIconPicker(el);
      bindRepeat(el);
      const getIds = bindContactChips(el);
      const allDay = form.allDay;
      const syncAllDay = () => form.querySelectorAll('.time-f').forEach((f) => (f.hidden = allDay.checked));
      syncAllDay();
      allDay.addEventListener('change', syncAllDay);
      // Keep the duration when the start moves, like the Palm did.
      let prevStart = `${form.sDay.value}T${form.sTime.value || '00:00'}`;
      const onStart = () => {
        const ns = `${form.sDay.value}T${form.sTime.value || '00:00'}`;
        if (!form.sDay.value) return;
        const curEnd = `${form.eDay.value}T${form.eTime.value || '00:00'}`;
        const dur = minutesBetween(prevStart, curEnd);
        const ne = addMinutes(ns, Math.max(0, dur));
        form.eDay.value = ne.slice(0, 10);
        form.eTime.value = ne.slice(11, 16);
        prevStart = ns;
      };
      form.sDay.addEventListener('change', onStart);
      form.sTime.addEventListener('change', onStart);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        el.querySelector('[data-e=save]').click();
      });
      el.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-e]');
        if (!b) return;
        if (b.dataset.e === 'delete') {
          closeSheet();
          setTimeout(() => deleteEvent(existing, occDay || eventStartDay(existing)), 30);
          return;
        }
        const d = formData(form);
        if (!d.title.trim()) {
          form.title.focus();
          form.title.classList.add('invalid');
          return;
        }
        const isAll = !!d.allDay;
        let startV = isAll ? d.sDay : `${d.sDay}T${d.sTime || '09:00'}`;
        let endV = isAll ? d.eDay || d.sDay : `${d.eDay || d.sDay}T${d.eTime || d.sTime || '10:00'}`;
        if (endV < startV) endV = isAll ? startV : addMinutes(startV, s.defaultDuration);
        const data = {
          title: d.title.trim(),
          icon: d.icon || '',
          allDay: isAll,
          start: startV,
          end: endV,
          repeat: readRepeat(d),
          alarm: d.alarm === '' ? null : Number(d.alarm),
          categoryId: d.categoryId || '',
          location: d.location.trim(),
          contactIds: getIds(),
          notes: d.notes,
        };
        if (data.repeat?.freq === 'weekly' && !data.repeat.days.length) data.repeat.days = [parseYmd(d.sDay).getDay()];
        if (!existing) {
          upsert('events', { ...data, exceptions: [] });
          closeSheet();
          toast(t('event.saved'));
          return;
        }
        const od = occDay || eventStartDay(existing);
        if (existing.repeat?.freq) {
          const scope = await askScope('scope.editTitle', { allowFuture: od !== eventStartDay(existing) });
          if (!scope) return;
          saveRecurring(existing, od, data, scope);
        } else {
          upsert('events', { ...existing, ...data });
        }
        closeSheet();
        toast(t('event.saved'));
      });
    },
  });
}

// Move or resize an appointment occurrence (drag and drop). Returns false when
// the user cancels the "which occurrences" question.
export async function moveEvent(ev, occDay, start, end) {
  const data = {
    title: ev.title, icon: ev.icon || '', allDay: !!ev.allDay, start, end, repeat: ev.repeat ? { ...ev.repeat } : null,
    alarm: ev.alarm ?? null, categoryId: ev.categoryId || '', location: ev.location || '', contactIds: ev.contactIds || [], notes: ev.notes || '',
  };
  const shift = diffDays(occDay, start.slice(0, 10));
  if (ev.repeat?.freq) {
    const scope = await askScope('scope.moveTitle', { allowFuture: occDay !== eventStartDay(ev) });
    if (!scope) return false;
    // Weekly series keep their weekday pattern, shifted along with the move.
    if (shift && data.repeat?.freq === 'weekly' && data.repeat.days?.length) data.repeat.days = data.repeat.days.map((d) => (((d + shift) % 7) + 7) % 7);
    commit(() => {}, { undoable: true, silent: true });
    saveRecurring(ev, occDay, data, scope);
  } else {
    upsert('events', { ...ev, start, end }, { undoable: true });
  }
  const when = data.allDay ? relDay(start.slice(0, 10)) : `${relDay(start.slice(0, 10))} ${fmtTime(start)}`;
  toast(t('event.moved', { when }), { action: t('common.undo'), onAction: undo });
  return true;
}

function saveRecurring(existing, od, data, scope) {
  if (scope === 'one') {
    commit((s) => {
      const x = s.events.find((e) => e.id === existing.id);
      x.exceptions = [...(x.exceptions || []), od];
    }, { silent: true });
    upsert('events', { ...data, repeat: null, exceptions: [], seriesId: existing.id });
  } else if (scope === 'future') {
    commit((s) => {
      const x = s.events.find((e) => e.id === existing.id);
      x.repeat = { ...x.repeat, until: addDays(od, -1) };
    }, { silent: true });
    upsert('events', { ...data, exceptions: [] });
  } else {
    // "All": apply the edited occurrence's date shift to the series start.
    const shift = diffDays(od, data.start.slice(0, 10));
    const newStartDay = addDays(eventStartDay(existing), shift);
    const span = diffDays(data.start.slice(0, 10), data.end.slice(0, 10));
    const startV = data.allDay ? newStartDay : `${newStartDay}T${data.start.slice(11, 16)}`;
    const endV = data.allDay ? addDays(newStartDay, span) : `${addDays(newStartDay, span)}T${data.end.slice(11, 16)}`;
    upsert('events', { ...existing, ...data, start: startV, end: endV, exceptions: existing.exceptions || [] });
  }
}

function nextHalfHour(day) {
  const d = new Date();
  if (day && day !== today()) return '09:00';
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  if (d.getHours() < 7 || ymd(d) !== today()) return '09:00';
  return toLocal(d).slice(11, 16);
}

// ---------------------------------------------------------------- tasks

export function toggleTask(id) {
  const tk = get('tasks', id);
  if (!tk) return;
  if (!tk.done && tk.repeat?.freq && tk.due) {
    // A repeating task rolls on to its next date instead of being completed.
    const next = nextOccurrence(tk.repeat, tk.repeatStart || tk.due, tk.due);
    if (next) {
      upsert('tasks', { ...tk, repeatStart: tk.repeatStart || tk.due, due: next, completions: (tk.completions || 0) + 1, lastDoneAt: new Date().toISOString() }, { undoable: true });
      toast(t('task.rolled', { date: relDay(next) }), { action: t('common.undo'), onAction: undo });
      return;
    }
  }
  upsert('tasks', { ...tk, done: !tk.done, doneAt: !tk.done ? new Date().toISOString() : null }, { undoable: true });
  if (!tk.done) toast(t('task.completed'), { action: t('common.undo'), onAction: undo });
}

export function openTaskEditor({ id, prefill = {} } = {}) {
  const existing = id ? get('tasks', id) : null;
  const s = state.settings;
  const tk = existing || { title: '', priority: 3, due: today(), categoryId: s.category !== 'all' && s.category !== 'none' ? s.category : '', contactIds: [], done: false, ...prefill };
  const t0 = today();
  const quick = [
    ['', t('tasks.noDate')],
    [t0, t('common.today')],
    [addDays(t0, 1), t('common.tomorrow')],
    [addDays(t0, 7), t('task.nextWeek')],
  ];
  openSheet({
    title: existing ? t('task.edit') : t('task.new'),
    cls: 'sheet-form',
    body: `<form class="form" novalidate>
      <div class="title-line">
        ${iconPicker(tk.icon)}
        <input name="title" class="title-input" value="${esc(tk.title)}" placeholder="${esc(t('task.titlePh'))}" autofocus autocomplete="off" enterkeyhint="done">
      </div>
      ${existing ? `<label class="switch"><input type="checkbox" name="done" ${tk.done ? 'checked' : ''}><span>${esc(t('task.done'))}</span></label>` : ''}
      <div class="field"><span class="field-label">${esc(t('task.priority'))}</span>
        <div class="seg prio-seg">${[1, 2, 3, 4, 5].map((p) => `<label><input type="radio" name="priority" value="${p}" ${Number(tk.priority || 3) === p ? 'checked' : ''}><span class="prio prio-${p}">${p}</span></label>`).join('')}</div>
      </div>
      <div class="field"><span class="field-label">${esc(t('task.due'))}</span>
        <div class="due-line">
          <input type="date" name="due" value="${esc(tk.due || '')}">
          <div class="quick-due">${quick.map(([v, l]) => `<button type="button" class="pill" data-due="${v}">${esc(l)}</button>`).join('')}</div>
        </div>
      </div>
      ${repeatFields(tk.repeat, tk.due || t0)}
      <div class="row-fields">
        ${field(t('editor.category'), `<select name="categoryId">${catOptions(tk.categoryId)}</select>`)}
        ${field(t('task.reminder'), `<input type="datetime-local" name="alarmAt" value="${esc(tk.alarmAt || '')}">`)}
      </div>
      <div class="field"><span class="field-label">${esc(t('editor.contacts'))}</span>${contactChips(tk.contactIds || [])}</div>
      ${field(t('editor.notes'), `<textarea name="notes" rows="3">${esc(tk.notes || '')}</textarea>`)}
      ${existing?.completions ? `<p class="muted small">${esc(t('task.completions', { n: existing.completions }))}</p>` : ''}
    </form>`,
    footer: `${existing ? `<button class="btn btn-ghost btn-danger-text" data-e="delete">${icon('trash-2', { size: 16 })}<span>${esc(t('common.delete'))}</span></button>
      <button class="btn btn-ghost" data-e="followup">${icon('arrow-right', { size: 16 })}<span>${esc(t('followup.title'))}</span></button>` : ''}
      <span class="spacer"></span>
      <button class="btn btn-ghost" data-close>${esc(t('common.cancel'))}</button>
      <button class="btn btn-primary" data-e="save">${esc(t('common.save'))}</button>`,
    onMount(el) {
      const form = el.querySelector('form');
      bindIconPicker(el);
      bindRepeat(el);
      const getIds = bindContactChips(el);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        el.querySelector('[data-e=save]').click();
      });
      el.addEventListener('click', (e) => {
        const q = e.target.closest('[data-due]');
        if (q) {
          form.due.value = q.dataset.due;
          return;
        }
        const b = e.target.closest('[data-e]');
        if (!b) return;
        if (b.dataset.e === 'delete') {
          remove('tasks', existing.id);
          closeSheet();
          toast(t('task.deleted'), { action: t('common.undo'), onAction: undo });
          return;
        }
        if (b.dataset.e === 'followup') {
          closeSheet();
          setTimeout(() => openFollowUp({ title: existing.title, contactIds: existing.contactIds, categoryId: existing.categoryId, icon: existing.icon }), 30);
          return;
        }
        const d = formData(form);
        if (!d.title.trim()) {
          form.title.focus();
          form.title.classList.add('invalid');
          return;
        }
        const done = !!d.done;
        const rec = {
          ...(existing || {}),
          title: d.title.trim(),
          icon: d.icon || '',
          priority: Number(d.priority) || 3,
          due: d.due || null,
          repeat: readRepeat(d),
          categoryId: d.categoryId || '',
          alarmAt: d.alarmAt || null,
          contactIds: getIds(),
          notes: d.notes,
          done,
          doneAt: done ? existing?.doneAt || new Date().toISOString() : null,
        };
        if (rec.repeat && (!existing || existing.due !== rec.due)) rec.repeatStart = rec.due;
        if (rec.repeat?.freq === 'weekly' && !rec.repeat.days.length) rec.repeat.days = [parseYmd(rec.due || today()).getDay()];
        upsert('tasks', rec);
        closeSheet();
        toast(t('task.saved'));
      });
    },
  });
}

// ---------------------------------------------------------------- follow-up

export function openFollowUp(src) {
  const t0 = today();
  const title = t('followup.prefix', { title: src.title || '' });
  const base = { contactIds: src.contactIds || [], categoryId: src.categoryId || '', icon: src.icon || '' };
  const nextWeekStart = src.start && !src.allDay ? `${addDays(src.start.slice(0, 10) < t0 ? t0 : src.start.slice(0, 10), 7)}T${src.start.slice(11, 16)}` : `${addDays(t0, 7)}T09:00`;
  choose({
    title: t('followup.title'),
    message: t('followup.message'),
    options: [
      { value: 'task-tomorrow', label: t('followup.taskTomorrow') },
      { value: 'task-week', label: t('followup.taskWeek') },
      { value: 'event-week', label: t('followup.eventWeek') },
      { value: 'event-pick', label: t('followup.eventPick') },
    ],
  }).then((v) => {
    if (!v) return;
    setTimeout(() => {
      if (v === 'task-tomorrow') openTaskEditor({ prefill: { ...base, title, due: addDays(t0, 1), priority: 2 } });
      if (v === 'task-week') openTaskEditor({ prefill: { ...base, title, due: addDays(t0, 7), priority: 3 } });
      if (v === 'event-week') openEventEditor({ prefill: { ...base, title, start: nextWeekStart, end: addMinutes(nextWeekStart, src.start && src.end && !src.allDay ? minutesBetween(src.start, src.end) : 60) } });
      if (v === 'event-pick') openEventEditor({ prefill: { ...base, title } });
    }, 30);
  });
}

// ---------------------------------------------------------------- contacts

export function openContactPicker(selected, cb) {
  let sel = new Set(selected);
  const all = sortedContacts();
  const render = (q = '') => {
    const s = q.trim().toLowerCase();
    const list = all.filter((c) => !s || contactName(c).toLowerCase().includes(s) || (c.company || '').toLowerCase().includes(s));
    return list.length
      ? list.map((c) => `<label class="row pick"><input type="checkbox" value="${c.id}" ${sel.has(c.id) ? 'checked' : ''}>${avatar(c, 30)}<span class="row-main"><span class="row-title">${esc(contactName(c, { lastFirst: true }))}</span>${c.company ? `<span class="row-meta">${esc(c.company)}</span>` : ''}</span></label>`).join('')
      : `<p class="muted pad">${esc(t('contacts.noMatch'))}</p>`;
  };
  openSheet({
    title: t('editor.addContact'),
    body: `<div class="search-line">${icon('search', { size: 18 })}<input type="search" placeholder="${esc(t('common.search'))}" data-pk-q autofocus></div>
      <div class="list pick-list">${render()}</div>
      <button type="button" class="btn btn-ghost more-btn" data-pk-new>${icon('plus', { size: 16 })} ${esc(t('contact.new'))}</button>`,
    footer: `<span class="spacer"></span><button class="btn btn-primary" data-pk-done>${esc(t('common.done'))}</button>`,
    onMount(el) {
      const listEl = el.querySelector('.pick-list');
      el.querySelector('[data-pk-q]').addEventListener('input', (e) => (listEl.innerHTML = render(e.target.value)));
      listEl.addEventListener('change', (e) => {
        if (e.target.checked) sel.add(e.target.value);
        else sel.delete(e.target.value);
      });
      el.querySelector('[data-pk-done]').addEventListener('click', () => {
        cb([...sel]);
        closeSheet();
      });
      el.querySelector('[data-pk-new]').addEventListener('click', () => {
        const q = el.querySelector('[data-pk-q]').value.trim();
        const [firstName, ...rest] = q.split(' ');
        openContactEditor({
          prefill: { firstName: firstName || '', lastName: rest.join(' ') },
          onSaved: (c) => {
            sel.add(c.id);
            all.push(c);
            all.sort((a, b) => contactName(a, { lastFirst: true }).localeCompare(contactName(b, { lastFirst: true })));
            listEl.innerHTML = render(el.querySelector('[data-pk-q]').value);
          },
        });
      });
    },
  });
}

export function openContactDetail(id) {
  const c = get('contacts', id);
  if (!c) return;
  const { events, tasks } = contactHistory(id);
  const t0 = today();
  const upcoming = events.map((e) => nextOccurrenceOf(e)).filter((o) => o.endDay >= t0).sort((a, b) => (a.start < b.start ? -1 : 1));
  const past = events.filter((e) => !e.repeat?.freq && eventEndDay(e) < t0);
  const tel = (v) => v.replace(/[^\d+]/g, '');
  const phone = c.phones?.find((p) => p.value);
  const mobile = c.phones?.find((p) => p.value && p.label === 'mobile') || phone;
  const email = c.emails?.find(Boolean);
  const b = birthdayParts(c);
  const bdText = b ? fmtDate(`${b.year || 2000}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`, b.year ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' }) : '';
  const occLine = (o) => `<button class="row occ compact" data-act="open-occ" data-id="${o.ev.id}" data-day="${o.day}" style="--cat:${catColor(o.ev.categoryId)}">${o.ev.icon ? itemIcon(o.ev.icon, { size: 14 }) : '<span class="row-bar"></span>'}<span class="row-main"><span class="row-title">${esc(o.ev.title)}</span><span class="row-meta">${esc(relDay(o.day, { day: 'numeric', month: 'short', year: 'numeric' }))}${o.allDay ? '' : ' · ' + fmtTime(o.start)}</span></span></button>`;
  openSheet({
    title: t('contact.details'),
    body: `
      <div class="contact-hero">
        ${avatar(c, 64)}
        <h3>${esc(contactName(c))}</h3>
        ${c.title || c.company ? `<p>${esc([c.title, c.company].filter(Boolean).join(' · '))}</p>` : ''}
        <div class="hero-actions">
          ${phone ? `<a class="hero-btn" href="tel:${esc(tel(phone.value))}">${icon('phone', { size: 20 })}<span>${esc(t('contact.call'))}</span></a>` : ''}
          ${mobile ? `<a class="hero-btn" href="sms:${esc(tel(mobile.value))}">${icon('message-square', { size: 20 })}<span>${esc(t('contact.sms'))}</span></a>` : ''}
          ${email ? `<a class="hero-btn" href="mailto:${esc(email)}">${icon('mail', { size: 20 })}<span>${esc(t('contact.email'))}</span></a>` : ''}
          ${c.address ? `<a class="hero-btn" href="https://www.openstreetmap.org/search?query=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">${icon('map-pin', { size: 20 })}<span>${esc(t('contact.map'))}</span></a>` : ''}
        </div>
      </div>
      <dl class="detail-list wide">
        ${(c.phones || []).filter((p) => p.value).map((p) => `<dt>${esc(t('phone.' + p.label))}</dt><dd><a href="tel:${esc(tel(p.value))}">${esc(p.value)}</a></dd>`).join('')}
        ${(c.emails || []).filter(Boolean).map((m) => `<dt>${esc(t('contact.emailLabel'))}</dt><dd><a href="mailto:${esc(m)}">${esc(m)}</a></dd>`).join('')}
        ${c.address ? `<dt>${esc(t('contact.address'))}</dt><dd class="notes">${esc(c.address)}</dd>` : ''}
        ${c.website ? `<dt>${esc(t('contact.website'))}</dt><dd><a href="${esc(/^https?:/.test(c.website) ? c.website : 'https://' + c.website)}" target="_blank" rel="noopener">${esc(c.website)}</a></dd>` : ''}
        ${bdText ? `<dt>${esc(t('contact.birthday'))}</dt><dd>${esc(bdText)}</dd>` : ''}
        <dt>${esc(t('editor.category'))}</dt><dd><span class="cat-tag" style="--cat:${catColor(c.categoryId)}">${esc(catName(state.categories.find((x) => x.id === c.categoryId)))}</span></dd>
        ${c.notes ? `<dt>${esc(t('editor.notes'))}</dt><dd class="notes">${esc(c.notes)}</dd>` : ''}
      </dl>
      <div class="history">
        <h4 class="sub-head">${esc(t('contact.history'))}</h4>
        <div class="hist-actions">
          <button class="btn btn-small" data-c="new-event">${icon('calendar', { size: 16 })} ${esc(t('event.new'))}</button>
          <button class="btn btn-small" data-c="new-task">${icon('square-check-big', { size: 16 })} ${esc(t('task.new'))}</button>
        </div>
        ${upcoming.length ? `<h5>${esc(t('contact.upcoming'))}</h5><div class="list">${upcoming.map(occLine).join('')}</div>` : ''}
        ${tasks.length ? `<h5>${esc(t('tasks.title'))}</h5><div class="list">${tasks.map((x) => taskRow(x)).join('')}</div>` : ''}
        ${past.length ? `<h5>${esc(t('contact.past'))}</h5><div class="list">${past.slice(0, 20).map((e) => occLine(makeOcc(e, eventStartDay(e)))).join('')}</div>` : ''}
        ${!upcoming.length && !tasks.length && !past.length ? `<p class="muted">${esc(t('contact.noHistory'))}</p>` : ''}
      </div>`,
    footer: `<button class="btn btn-ghost btn-danger-text" data-c="delete">${icon('trash-2', { size: 16 })}<span>${esc(t('common.delete'))}</span></button>
      <span class="spacer"></span>
      <button class="btn btn-primary" data-c="edit">${icon('pencil', { size: 16 })}<span>${esc(t('common.edit'))}</span></button>`,
    onMount(el) {
      el.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-c]');
        if (!btn) return;
        const a = btn.dataset.c;
        if (a === 'edit') {
          closeSheet();
          setTimeout(() => openContactEditor({ id }), 30);
        } else if (a === 'delete') {
          closeSheet();
          remove('contacts', id);
          toast(t('contact.deleted'), { action: t('common.undo'), onAction: undo });
        } else if (a === 'new-event') {
          closeSheet();
          setTimeout(() => openEventEditor({ prefill: { contactIds: [id], title: t('contact.meetWith', { name: contactName(c) }) } }), 30);
        } else if (a === 'new-task') {
          closeSheet();
          setTimeout(() => openTaskEditor({ prefill: { contactIds: [id], title: t('contact.callName', { name: contactName(c) }), icon: 'phone' } }), 30);
        }
      });
    },
  });
}

function phoneRow(p = { label: 'mobile', value: '' }) {
  return `<div class="multi-row"><select name="phoneLabel">${PHONE_LABELS.map((l) => `<option value="${l}" ${l === p.label ? 'selected' : ''}>${esc(t('phone.' + l))}</option>`).join('')}</select><input type="tel" name="phoneValue" value="${esc(p.value)}" autocomplete="off" inputmode="tel"><button type="button" class="icon-btn" data-row-remove aria-label="${esc(t('common.remove'))}">${icon('x', { size: 16 })}</button></div>`;
}
function emailRow(v = '') {
  return `<div class="multi-row"><input type="email" name="email" value="${esc(v)}" autocomplete="off" inputmode="email"><button type="button" class="icon-btn" data-row-remove aria-label="${esc(t('common.remove'))}">${icon('x', { size: 16 })}</button></div>`;
}

export function openContactEditor({ id, prefill = {}, onSaved } = {}) {
  const existing = id ? get('contacts', id) : null;
  const c = existing || { firstName: '', lastName: '', phones: [{ label: 'mobile', value: '' }], emails: [''], categoryId: '', ...prefill };
  const phones = c.phones?.length ? c.phones : [{ label: 'mobile', value: '' }];
  const emails = c.emails?.length ? c.emails : [''];
  const b = birthdayParts(c);
  openSheet({
    title: existing ? t('contact.edit') : t('contact.new'),
    cls: 'sheet-form',
    body: `<form class="form" novalidate>
      <div class="row-fields">
        ${field(t('contact.firstName'), `<input name="firstName" value="${esc(c.firstName || '')}" autocomplete="off" autofocus>`)}
        ${field(t('contact.lastName'), `<input name="lastName" value="${esc(c.lastName || '')}" autocomplete="off">`)}
      </div>
      <div class="row-fields">
        ${field(t('contact.company'), `<input name="company" value="${esc(c.company || '')}" autocomplete="off">`)}
        ${field(t('contact.jobTitle'), `<input name="title" value="${esc(c.title || '')}" autocomplete="off">`)}
      </div>
      <div class="field"><span class="field-label">${esc(t('contact.phones'))}</span><div class="multi" data-multi="phone">${phones.map(phoneRow).join('')}</div><button type="button" class="link-btn" data-add="phone">${icon('plus', { size: 14 })} ${esc(t('contact.addPhone'))}</button></div>
      <div class="field"><span class="field-label">${esc(t('contact.emails'))}</span><div class="multi" data-multi="email">${emails.map(emailRow).join('')}</div><button type="button" class="link-btn" data-add="email">${icon('plus', { size: 14 })} ${esc(t('contact.addEmail'))}</button></div>
      ${field(t('contact.address'), `<textarea name="address" rows="2">${esc(c.address || '')}</textarea>`)}
      <div class="row-fields">
        ${field(t('contact.birthday'), `<input type="date" name="birthday" value="${b ? `${b.year || 1900}-${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}` : ''}">`)}
        ${field(t('editor.category'), `<select name="categoryId">${catOptions(c.categoryId)}</select>`)}
      </div>
      <label class="switch small"><input type="checkbox" name="noYear" ${b && !b.year ? 'checked' : ''}><span>${esc(t('contact.noYear'))}</span></label>
      ${field(t('contact.website'), `<input name="website" value="${esc(c.website || '')}" autocomplete="off" inputmode="url">`)}
      ${field(t('editor.notes'), `<textarea name="notes" rows="3">${esc(c.notes || '')}</textarea>`)}
    </form>`,
    footer: `<span class="spacer"></span><button class="btn btn-ghost" data-close>${esc(t('common.cancel'))}</button><button class="btn btn-primary" data-e="save">${esc(t('common.save'))}</button>`,
    onMount(el) {
      const form = el.querySelector('form');
      el.addEventListener('click', (e) => {
        const add = e.target.closest('[data-add]');
        if (add) {
          const box = el.querySelector(`[data-multi="${add.dataset.add}"]`);
          box.insertAdjacentHTML('beforeend', add.dataset.add === 'phone' ? phoneRow({ label: 'work', value: '' }) : emailRow());
          box.lastElementChild.querySelector('input').focus();
          return;
        }
        const rm = e.target.closest('[data-row-remove]');
        if (rm) {
          rm.closest('.multi-row').remove();
          return;
        }
        if (!e.target.closest('[data-e=save]')) return;
        const d = formData(form);
        const labels = [].concat(d.phoneLabel || []);
        const values = [].concat(d.phoneValue || []);
        const rec = {
          ...(existing || {}),
          firstName: (d.firstName || '').trim(),
          lastName: (d.lastName || '').trim(),
          company: (d.company || '').trim(),
          title: (d.title || '').trim(),
          phones: values.map((v, i) => ({ label: labels[i], value: v.trim() })).filter((p) => p.value),
          emails: [].concat(d.email || []).map((x) => x.trim()).filter(Boolean),
          address: d.address.trim(),
          birthday: d.birthday ? (d.noYear ? `--${d.birthday.slice(5)}` : d.birthday) : '',
          categoryId: d.categoryId || '',
          website: d.website.trim(),
          notes: d.notes,
        };
        if (!rec.firstName && !rec.lastName && !rec.company) {
          form.firstName.focus();
          form.firstName.classList.add('invalid');
          return;
        }
        const saved = upsert('contacts', rec);
        closeSheet();
        toast(t('contact.saved'));
        onSaved?.(saved);
      });
    },
  });
}

// ---------------------------------------------------------------- memos

export function openMemoEditor({ id } = {}) {
  const existing = id ? get('memos', id) : null;
  const s = state.settings;
  const m = existing || { text: '', categoryId: s.category !== 'all' && s.category !== 'none' ? s.category : '' };
  let deleted = false;
  let form;
  const persist = () => {
    if (deleted || !form) return;
    const text = form.text.value;
    const categoryId = form.categoryId.value;
    if (!text.trim()) return;
    if (existing && existing.text === text && (existing.categoryId || '') === categoryId) return;
    upsert('memos', { ...(existing || {}), text, categoryId });
  };
  openSheet({
    title: existing ? memoTitle(existing) : t('memo.new'),
    cls: 'sheet-form sheet-tall',
    body: `<form class="form memo-form" novalidate>
      <textarea name="text" class="memo-text" placeholder="${esc(t('memo.placeholder'))}" autofocus>${esc(m.text)}</textarea>
      ${field(t('editor.category'), `<select name="categoryId">${catOptions(m.categoryId)}</select>`)}
    </form>`,
    footer: `${existing ? `<button class="btn btn-ghost btn-danger-text" data-e="delete">${icon('trash-2', { size: 16 })}<span>${esc(t('common.delete'))}</span></button>` : ''}
      <span class="spacer"></span><button class="btn btn-primary" data-e="save">${esc(t('common.done'))}</button>`,
    onMount(el) {
      form = el.querySelector('form');
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-e]');
        if (!b) return;
        if (b.dataset.e === 'delete') {
          deleted = true;
          remove('memos', existing.id);
          closeSheet();
          toast(t('memo.deleted'), { action: t('common.undo'), onAction: undo });
        } else closeSheet();
      });
    },
    // Memos save themselves when the sheet closes, like the Palm Memo Pad.
    onClose: persist,
  });
}

// ---------------------------------------------------------------- go to date

export function openDatePicker(current, onPick) {
  let cursor = current.slice(0, 8) + '01';
  const body = () => `
    <div class="dp-nav">
      <button class="icon-btn" data-dp="prev" aria-label="${esc(t('common.previous'))}">${icon('chevron-left')}</button>
      <b>${esc(fmtMonthYear(cursor))}</b>
      <button class="icon-btn" data-dp="next" aria-label="${esc(t('common.next'))}">${icon('chevron-right')}</button>
    </div>
    ${miniMonth(parseYmd(cursor).getFullYear(), parseYmd(cursor).getMonth(), { weekStart: state.settings.weekStart, selected: current, act: '', showTitle: false })}
    <div class="dp-foot"><input type="date" value="${current}" data-dp-input aria-label="${esc(t('goto.date'))}"><button class="btn btn-primary" data-dp="today">${esc(t('common.today'))}</button></div>`;
  openSheet({
    title: t('goto.title'),
    cls: 'sheet-dialog date-picker',
    body: body(),
    onMount(el) {
      const bodyEl = el.querySelector('.sheet-body');
      bodyEl.addEventListener('click', (e) => {
        const nav = e.target.closest('[data-dp]');
        const cell = e.target.closest('.mm-cell[data-day]');
        if (nav?.dataset.dp === 'prev') cursor = addMonths(cursor, -1);
        else if (nav?.dataset.dp === 'next') cursor = addMonths(cursor, 1);
        else if (nav?.dataset.dp === 'today') return pick(today());
        else if (cell) return pick(cell.dataset.day);
        else return;
        bodyEl.innerHTML = body();
      });
      bodyEl.addEventListener('change', (e) => {
        if (e.target.matches('[data-dp-input]') && e.target.value) pick(e.target.value);
      });
      function pick(d) {
        closeSheet();
        onPick(d);
      }
    },
  });
}
