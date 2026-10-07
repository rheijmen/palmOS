// Alarms. While the app is open (or in a background tab) it checks every 15 seconds
// for due alarms and shows an "Agendus Reminder" with snooze and follow-up, plus a
// system notification when permission is granted. Browsers cannot wake a closed web
// app at an exact time, so alarms fire the next time the app is running.
import { state, get, commit, upsert } from './store.js';
import { esc, today, addDays, parseLocal, addMinutes, minutesBetween } from './util.js';
import { t, fmtTime, fmtDate, relDay } from './i18n.js';
import { icon, itemIcon } from './icons.js';
import { openSheet, closeSheet, toast } from './ui.js';
import { occurrencesInRange, makeOcc, contactsByIds, contactName } from './query.js';
import { toggleTask, openEventDetail, openTaskEditor } from './editors.js';

const WINDOW_MS = 6 * 3600 * 1000; // missed alarms older than this are skipped
const SNOOZES = [1, 3, 5, 10, 15, 30, 60];
const queue = [];
let showing = false;

export function startReminders() {
  check();
  setInterval(check, 15000);
  document.addEventListener('visibilitychange', () => !document.hidden && check());
}

function alarmTime(o, alarm) {
  const base = o.allDay ? parseLocal(`${o.day}T09:00`) : parseLocal(o.start);
  return base.getTime() - alarm * 60000;
}

function check() {
  const now = Date.now();
  const fired = state.alarms.fired;
  const due = [];
  for (const o of occurrencesInRange(addDays(today(), -1), addDays(today(), 3), { filter: false })) {
    if (o.ev.alarm == null) continue;
    const at = alarmTime(o, o.ev.alarm);
    const key = `e:${o.ev.id}@${o.day}:${o.ev.alarm}`;
    if (at <= now && now - at < WINDOW_MS && !fired[key]) due.push({ key, kind: 'event', id: o.ev.id, day: o.day });
  }
  for (const tk of state.tasks) {
    if (!tk.alarmAt || tk.done) continue;
    const at = parseLocal(tk.alarmAt).getTime();
    const key = `t:${tk.id}:${tk.alarmAt}`;
    if (at <= now && now - at < WINDOW_MS && !fired[key]) due.push({ key, kind: 'task', id: tk.id });
  }
  const snoozed = state.alarms.snoozed.filter((s) => s.until <= now);
  if (!due.length && !snoozed.length) return;
  commit((s) => {
    for (const d of due) s.alarms.fired[d.key] = now;
    s.alarms.snoozed = s.alarms.snoozed.filter((x) => x.until > now);
    // Forget fired alarms after a week.
    for (const [k, v] of Object.entries(s.alarms.fired)) if (now - v > 7 * 86400000) delete s.alarms.fired[k];
  }, { silent: true });
  for (const item of [...due, ...snoozed]) {
    if (queue.some((q) => q.key === item.key)) continue;
    queue.push(item);
    notify(item);
  }
  chirp();
  showNext();
}

function describe(item) {
  if (item.kind === 'task') {
    const tk = get('tasks', item.id);
    if (!tk) return null;
    return { title: tk.title, icon: tk.icon, people: contactsByIds(tk.contactIds), when: tk.due ? relDay(tk.due) : '', at: tk.alarmAt, src: tk };
  }
  const ev = get('events', item.id);
  if (!ev) return null;
  const o = makeOcc(ev, item.day);
  const when = o.allDay ? relDay(o.day) : `${fmtTime(o.start)} – ${fmtTime(o.end)} ${relDay(o.day)}`;
  return { title: ev.title, icon: ev.icon, people: contactsByIds(ev.contactIds), when, at: o.allDay ? `${o.day}T09:00` : o.start, src: ev, occ: o };
}

function notify(item) {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
  const d = describe(item);
  if (!d) return;
  const body = [d.when, d.people.map((c) => contactName(c)).join(', ')].filter(Boolean).join('\n');
  const opts = { body, tag: item.key, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', renotify: true };
  navigator.serviceWorker?.ready
    .then((reg) => reg.showNotification(d.title, opts))
    .catch(() => {
      try {
        new Notification(d.title, opts);
      } catch {}
    });
}

let audioCtx;
function chirp() {
  if (document.hidden) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = [1760, 1318, 1760];
    tones.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = f;
      g.gain.value = 0.04;
      o.connect(g).connect(audioCtx.destination);
      const t0 = audioCtx.currentTime + i * 0.14;
      o.start(t0);
      o.stop(t0 + 0.1);
    });
  } catch {}
}

function showNext() {
  if (showing) return;
  const item = queue.shift();
  if (!item) return;
  const d = describe(item);
  if (!d) return showNext();
  showing = true;
  let action = 'ok';
  const isTask = item.kind === 'task';
  openSheet({
    title: t('reminder.title'),
    cls: 'sheet-dialog reminder',
    body: `
      <div class="rem-head">${d.icon ? itemIcon(d.icon, { size: 28 }) : icon('alarm-clock', { size: 28, cls: 'i rem-ic' })}<span>${esc(fmtTime(d.at))} ${esc(fmtDate(d.at.slice(0, 10), { weekday: 'short', day: 'numeric', month: 'numeric', year: '2-digit' }))}</span></div>
      ${d.people.length ? `<p class="rem-people">${esc(d.people.map((c) => contactName(c)).join(', '))}</p>` : ''}
      <p class="rem-title">${esc(d.title)}</p>
      ${d.when ? `<p class="rem-when">${esc(d.when)}</p>` : ''}
      <div class="rem-fields">
        <label><span>${esc(t('reminder.followUp'))}:</span><select data-r="follow">
          <option value="">${esc(t('reminder.none'))}</option>
          <option value="task1">${esc(t('followup.taskTomorrow'))}</option>
          <option value="task7">${esc(t('followup.taskWeek'))}</option>
          <option value="event7">${esc(t('followup.eventWeek'))}</option>
        </select></label>
        <label><span>${esc(t('reminder.snooze'))}:</span><select data-r="snooze">${SNOOZES.map((m) => `<option value="${m}" ${m === 5 ? 'selected' : ''}>${esc(t('alarm.minutesPlain', { n: m }))}</option>`).join('')}</select></label>
      </div>
      <div class="rem-actions">
        <button class="rem-btn ok" data-ra="ok" aria-label="${esc(t('reminder.ok'))}">${icon('check', { size: 26 })}<span>${esc(t('reminder.ok'))}</span></button>
        <button class="rem-btn go" data-ra="open" aria-label="${esc(t('reminder.open'))}">${icon('arrow-right', { size: 26 })}<span>${esc(t('reminder.open'))}</span></button>
        ${isTask ? `<button class="rem-btn done" data-ra="done" aria-label="${esc(t('reminder.complete'))}">${icon('square-check-big', { size: 26 })}<span>${esc(t('reminder.complete'))}</span></button>` : ''}
        <button class="rem-btn snooze" data-ra="snooze" aria-label="${esc(t('reminder.snooze'))}">${icon('rotate-ccw', { size: 26 })}<span>${esc(t('reminder.snooze'))}</span></button>
      </div>`,
    onMount(el) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ra]');
        if (!b) return;
        action = b.dataset.ra;
        const follow = el.querySelector('[data-r=follow]').value;
        const mins = Number(el.querySelector('[data-r=snooze]').value);
        if (follow) createFollowUp(follow, d);
        if (action === 'snooze') {
          commit((s) => {
            s.alarms.snoozed.push({ ...item, until: Date.now() + mins * 60000 });
          }, { silent: true });
          toast(t('reminder.snoozed', { n: mins }));
        }
        if (action === 'done') toggleTask(item.id);
        closeSheet();
        if (action === 'open') setTimeout(() => (isTask ? openTaskEditor({ id: item.id }) : openEventDetail(item.id, item.day)), 60);
      });
    },
    onClose() {
      showing = false;
      setTimeout(showNext, 300);
    },
  });
}

function createFollowUp(kind, d) {
  const src = d.src;
  const title = t('followup.prefix', { title: src.title });
  const base = { contactIds: src.contactIds || [], categoryId: src.categoryId || '', icon: src.icon || '' };
  if (kind === 'task1' || kind === 'task7') {
    upsert('tasks', { ...base, title, due: addDays(today(), kind === 'task1' ? 1 : 7), priority: 2, done: false });
    toast(t('followup.created'));
  } else if (kind === 'event7') {
    const o = d.occ;
    const start = o && !o.allDay ? `${addDays(o.day, 7)}T${o.start.slice(11, 16)}` : `${addDays(today(), 7)}T09:00`;
    const dur = o && !o.allDay ? minutesBetween(o.start, o.end) : 60;
    upsert('events', { ...base, title, start, end: addMinutes(start, dur), allDay: false, alarm: src.alarm ?? null, exceptions: [] });
    toast(t('followup.created'));
  }
}

export async function requestNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return 'denied';
  }
}
