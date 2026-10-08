// Proactive insights, computed locally from the agenda (no AI or network needed):
// what's next, clashes, days without a break, overdue tasks, birthdays and an early
// start tomorrow. The assistant shows the most important one and can read a
// briefing aloud.
import { state, commit } from '../store.js';
import { today, addDays, toLocal, minutesBetween, parseLocal } from '../util.js';
import { t, fmtTime, relDay } from '../i18n.js';
import { eventsOnDay, birthdaysInRange, contactsByIds, contactName, tasksForAgenda, isOverdue } from '../query.js';

const tel = (v) => (v || '').replace(/[^\d+]/g, '');

function dismissedToday() {
  const d = state.ai?.dismissed;
  return d && d.day === today() ? d.ids : [];
}

export function dismissInsight(id) {
  commit((s) => {
    s.ai = s.ai || {};
    const cur = s.ai.dismissed && s.ai.dismissed.day === today() ? s.ai.dismissed.ids : [];
    s.ai.dismissed = { day: today(), ids: [...cur, id] };
  });
}

// Each insight: { id, priority (lower = more important), text, actions: [{ label, act | href, data }] }
export function computeInsights(now = new Date()) {
  const out = [];
  const nowL = toLocal(now);
  const d0 = today();
  const todayOcc = eventsOnDay(d0, { filter: false });
  const timed = todayOcc.filter((o) => !o.allDay);

  // 1. What's next, within the next 90 minutes.
  const next = timed.find((o) => o.start > nowL);
  if (next) {
    const mins = minutesBetween(nowL, next.start);
    if (mins <= 90) {
      const people = contactsByIds(next.ev.contactIds);
      const p = people.find((c) => c.phones?.some((x) => x.value));
      const actions = [{ label: t('ai.open'), act: 'open-occ', data: { id: next.ev.id, day: next.day } }];
      if (next.ev.location) actions.push({ label: t('ai.route'), href: `https://www.openstreetmap.org/search?query=${encodeURIComponent(next.ev.location)}` });
      if (p) {
        const ph = p.phones.find((x) => x.label === 'mobile' && x.value) || p.phones.find((x) => x.value);
        actions.push({ label: t('ai.textLate', { name: p.firstName || contactName(p) }), href: `sms:${tel(ph.value)}?body=${encodeURIComponent(t('ai.lateMessage', { title: next.ev.title }))}` });
      }
      out.push({
        id: `next-${next.key}`,
        priority: mins <= 20 ? 0 : 2,
        text: t('ai.insight.next', { title: next.ev.title, n: mins, time: fmtTime(next.start), where: next.ev.location ? t('ai.at', { place: next.ev.location }) : '' }),
        actions,
      });
    }
  }

  // 2. Clashes today and tomorrow.
  for (const day of [d0, addDays(d0, 1)]) {
    const list = (day === d0 ? timed : eventsOnDay(day, { filter: false }).filter((o) => !o.allDay)).filter((o) => o.end > nowL);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (b.start < a.end && a.start < b.end) {
          out.push({
            id: `clash-${a.key}-${b.key}`,
            priority: 1,
            text: t('ai.insight.clash', { a: a.ev.title, b: b.ev.title, day: relDay(day).toLowerCase(), time: fmtTime(b.start) }),
            actions: [{ label: t('ai.open'), act: 'open-occ', data: { id: b.ev.id, day: b.day } }],
          });
        }
      }
    }
  }

  // 3. No breathing room: 3+ appointments back to back.
  let run = 1;
  for (let i = 1; i < timed.length; i++) {
    run = minutesBetween(timed[i - 1].end, timed[i].start) < 15 ? run + 1 : 1;
    if (run === 3 && timed[i].end > nowL) {
      out.push({ id: `busy-${d0}`, priority: 4, text: t('ai.insight.busy', { from: fmtTime(timed[i - 2].start), to: fmtTime(timed[i].end) }), actions: [] });
      break;
    }
  }

  // 4. Overdue tasks.
  const overdue = state.tasks.filter(isOverdue);
  if (overdue.length) {
    out.push({
      id: `overdue-${d0}-${overdue.length}`,
      priority: 3,
      text: t('ai.insight.overdue', { n: overdue.length, title: overdue[0].title }),
      actions: [
        { label: t('ai.moveToday'), act: 'ai-move-overdue', data: { to: d0 } },
        { label: t('ai.moveTomorrow'), act: 'ai-move-overdue', data: { to: addDays(d0, 1) } },
      ],
    });
  }

  // 5. Birthdays today and tomorrow.
  for (const b of birthdaysInRange(d0, addDays(d0, 1))) {
    const c = b.contact;
    const ph = c.phones?.find((x) => x.label === 'mobile' && x.value) || c.phones?.find((x) => x.value);
    const actions = [];
    if (ph) actions.push({ label: t('contact.call'), href: `tel:${tel(ph.value)}` });
    if (b.day !== d0) actions.push({ label: t('ai.giftTask'), act: 'ai-gift-task', data: { id: c.id } });
    out.push({
      id: `bday-${c.id}-${b.day}`,
      priority: b.day === d0 ? 1 : 3,
      text: t(b.day === d0 ? 'ai.insight.bdayToday' : 'ai.insight.bdayTomorrow', { name: contactName(c), age: b.age != null ? ` (${b.age})` : '' }),
      actions,
    });
  }

  // 6. Evening: early start tomorrow.
  if (now.getHours() >= 18) {
    const first = eventsOnDay(addDays(d0, 1), { filter: false }).find((o) => !o.allDay);
    if (first && parseLocal(first.start).getHours() < 9) {
      out.push({ id: `early-${first.key}`, priority: 2, text: t('ai.insight.early', { time: fmtTime(first.start), title: first.ev.title }), actions: [{ label: t('ai.open'), act: 'open-occ', data: { id: first.ev.id, day: first.day } }] });
    }
  }

  const hidden = dismissedToday();
  return out.filter((x) => !hidden.includes(x.id)).sort((a, b) => a.priority - b.priority);
}

// A spoken briefing for today, built from the agenda (used without AI, and as context).
export function localBriefing(now = new Date()) {
  const d0 = today();
  const nowL = toLocal(now);
  const occ = eventsOnDay(d0, { filter: false });
  const left = occ.filter((o) => o.allDay || o.end > nowL);
  const tasks = tasksForAgenda(d0).filter((x) => !x.done);
  const h = now.getHours();
  const parts = [t(h < 12 ? 'ai.brief.morning' : h < 18 ? 'ai.brief.afternoon' : 'ai.brief.evening', { name: state.settings.userName ? ` ${state.settings.userName}` : '' })];
  if (!left.length) parts.push(t('ai.brief.free'));
  else {
    parts.push(t('ai.brief.count', { n: left.length }));
    const listed = left.slice(0, 4).map((o) => (o.allDay ? o.ev.title : `${o.ev.title} ${t('ai.brief.atTime', { time: fmtTime(o.start) })}`));
    parts.push(listed.join(', ') + '.');
  }
  if (tasks.length) parts.push(t('ai.brief.tasks', { n: tasks.length }));
  const top = computeInsights(now).find((x) => !x.id.startsWith('next-'));
  if (top) parts.push(top.text);
  return parts.join(' ');
}

export function moveOverdue(to) {
  commit((s) => {
    for (const tk of s.tasks) if (!tk.done && tk.due && tk.due < today()) tk.due = to;
  }, { undoable: true });
}
