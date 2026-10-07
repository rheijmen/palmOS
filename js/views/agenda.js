// Agenda: the Agendus signature screen. Appointments, tasks, birthdays and the
// people you deal with today on one page, plus a look at the days ahead.
import { state } from '../store.js';
import { esc, today, addDays, toLocal, startOfWeek } from '../util.js';
import { t, fmtDate, relDay } from '../i18n.js';
import { icon, itemIcon } from '../icons.js';
import { eventsOnDay, eventsByDay, birthdaysInRange, tasksForAgenda, contactsByIds, contactName, catColor } from '../query.js';
import { occRow, taskRow, sectionHead, weekStrip, emptyState, avatar, quickActions } from '../components.js';

export const agendaView = {
  title: (ctx) => (ctx.date === today() ? t('common.today') : fmtDate(ctx.date, { weekday: 'short', day: 'numeric', month: 'short' })),
  step: (d, n) => addDays(d, n),
  render(ctx) {
    const day = ctx.date;
    const ws = state.settings.weekStart;
    const wStart = startOfWeek(day, ws);
    const busyMap = eventsByDay(wStart, addDays(wStart, 6));
    const busy = new Map([...busyMap].map(([k, v]) => [k, v.length]));
    const occ = eventsOnDay(day);
    const bds = birthdaysInRange(day, day);
    const tasks = tasksForAgenda(day);
    const now = day === today() ? toLocal(new Date()) : null;
    const next = now ? occ.find((o) => !o.allDay && o.end > now) : null;

    // People linked to today's appointments and tasks, in order of first appearance.
    const ids = [...new Set([...occ.flatMap((o) => o.ev.contactIds || []), ...tasks.flatMap((x) => x.contactIds || [])])];
    const people = contactsByIds(ids);

    const upFrom = addDays(day, 1);
    const upTo = addDays(day, state.settings.agendaDays);
    const upMap = eventsByDay(upFrom, upTo);
    const upBds = birthdaysInRange(upFrom, upTo);
    const upDays = [...new Set([...upMap.keys(), ...upBds.map((b) => b.day)])].sort();

    const overdue = tasks.filter((x) => !x.done && x.due && x.due < day).length;

    return `
      ${weekStrip(day, { weekStart: ws, busy })}
      <div class="agenda-summary">
        <span>${icon('calendar', { size: 14 })} ${esc(t('agenda.countEvents', { n: occ.length + bds.length }))}</span>
        <span>${icon('square-check-big', { size: 14 })} ${esc(t('agenda.countTasks', { n: tasks.filter((x) => !x.done).length }))}</span>
        ${overdue ? `<span class="overdue">${esc(t('tasks.overdueN', { n: overdue }))}</span>` : ''}
      </div>
      ${next ? `<div class="next-up" style="--cat:${catColor(next.ev.categoryId)}">${icon('clock', { size: 16 })}<span>${esc(next.start <= now ? t('agenda.now') : t('agenda.next'))}: <b>${esc(next.ev.title)}</b></span></div>` : ''}

      ${sectionHead(t('agenda.appointments'), `<button class="link-btn" data-act="new-event" data-day="${day}">${icon('plus', { size: 14 })} ${esc(t('common.new'))}</button>`)}
      <div class="list">
        ${bds
          .map(
            (b) => `<button class="row occ birthday" data-act="open-contact" data-id="${b.contact.id}" style="--cat:${catColor(b.contact.categoryId)}"><span class="row-time"><span class="time-all">${esc(t('event.allDay'))}</span></span><span class="row-bar"></span>${itemIcon('cake')}<span class="row-main"><span class="row-title">${esc(t('birthday.of', { name: contactName(b.contact) }))}${b.age != null ? ` (${b.age})` : ''}</span></span></button>`
          )
          .join('')}
        ${occ.map((o) => occRow(o, { now })).join('')}
        ${!occ.length && !bds.length ? `<p class="muted pad">${esc(t('agenda.noAppointments'))}</p>` : ''}
      </div>

      ${sectionHead(t('tasks.title'), `<button class="link-btn" data-act="new-task" data-day="${day}">${icon('plus', { size: 14 })} ${esc(t('common.new'))}</button>`)}
      <div class="list">
        ${tasks.map((x) => taskRow(x)).join('') || `<p class="muted pad">${esc(t('agenda.noTasks'))}</p>`}
      </div>

      ${people.length ? sectionHead(t('agenda.contacts')) + `<div class="list">${people
        .map(
          (c) => `<div class="row contact"><button class="row-link" data-act="open-contact" data-id="${c.id}">${avatar(c, 32)}<span class="row-main"><span class="row-title">${esc(contactName(c, { lastFirst: true }))}</span>${c.phones?.[0]?.value ? `<span class="row-meta">${esc(t('phone.' + c.phones[0].label))}: ${esc(c.phones[0].value)}</span>` : ''}</span></button>${quickActions(c)}</div>`
        )
        .join('')}</div>` : ''}

      ${sectionHead(t('agenda.upcoming', { n: state.settings.agendaDays }), `<button class="link-btn" data-act="goto-view" data-view="list" data-day="${upFrom}">${esc(t('agenda.all'))} ${icon('chevron-right', { size: 14 })}</button>`)}
      <div class="list upcoming">
        ${upDays.length
          ? upDays
              .map((d) => {
                const list = upMap.get(d) || [];
                const bd = upBds.filter((b) => b.day === d);
                return `<div class="up-day"><button class="up-date" data-act="goto-day" data-day="${d}">${esc(relDay(d))}</button>
                  ${bd.map((b) => `<button class="row occ compact birthday" data-act="open-contact" data-id="${b.contact.id}">${itemIcon('cake', { size: 14 })}<span class="row-title">${esc(t('birthday.of', { name: contactName(b.contact) }))}</span></button>`).join('')}
                  ${list.map((o) => occRow(o)).join('')}</div>`;
              })
              .join('')
          : `<p class="muted pad">${esc(t('agenda.noUpcoming'))}</p>`}
      </div>
      ${!state.events.length && !state.tasks.length ? emptyState(t('agenda.emptyHint'), t('event.new'), 'new-event', `data-day="${day}"`) : ''}`;
  },
};
