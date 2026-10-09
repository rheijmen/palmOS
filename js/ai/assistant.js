// The assistant: a conversation with Claude that can read and change the agenda
// through tools, plus a small offline fallback for simple commands.
//
// Provider layer: talk() only depends on runTurn(); adding another provider means
// adding another runTurn implementation, the tools stay the same.
import { state, get, upsert, commit, undo, LOCAL_USER } from '../store.js';
import { today, addDays, toLocal, uid, addMinutes, minutesBetween } from '../util.js';
import { t, fmtTime, relDay } from '../i18n.js';
import { occurrencesInRange, makeOcc, birthdaysInRange, contactsByIds, contactName, search, isOverdue, eventStartDay } from '../query.js';
import { describeRepeat, nextOccurrence } from '../recur.js';
import { changeOccurrence, removeOccurrence } from '../editors.js';
import { localBriefing } from './insights.js';

const KEY_STORE = 'agendus.ai.key'; // kept out of backups on purpose
export const MODELS = [
  // The first one is the default. Haiku has no server-side refusal fallback.
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', fallbacks: false },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', fallbacks: true },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', fallbacks: true },
];

export function getApiKey() {
  try {
    return localStorage.getItem(KEY_STORE) || '';
  } catch {
    return '';
  }
}
export function setApiKey(k) {
  try {
    if (k) localStorage.setItem(KEY_STORE, k.trim());
    else localStorage.removeItem(KEY_STORE);
  } catch {}
}
export const hasAI = () => !!getApiKey();

// ---------------------------------------------------------------- prompt

function systemPrompt() {
  const name = state.settings.aiName || 'Pilot';
  return `You are ${name}, the assistant built into PalmOS Agenda, a personal organizer with a calendar, to-do list, contacts and memos. Everything you know about the user's plans comes from the tools; never invent appointments, tasks or contacts.

Personality: modelled on the intelligent car computers of 1980s science fiction. Calm, capable, loyal and precise, with a light, dry wit. Address the user as a trusted partner. Do not claim to be any existing fictional character.

Your replies are usually spoken aloud by the device. Keep them short: one to three natural sentences, no markdown, no bullet lists, no emoji. Say times the way people say them. Reply in the language the user speaks (Dutch or English).

How to work:
- Look things up with get_agenda or search before answering questions about the user's schedule.
- When a request is clear, act on it straight away with the tools; the app shows an Undo button afterwards. Only delete what the user explicitly asked to delete.
- If a request is ambiguous (for example two appointments match), ask one short question instead of guessing.
- Resolve relative dates ("tomorrow", "next Friday") against the current date given in the context note. Use local times in the format YYYY-MM-DDTHH:mm and dates as YYYY-MM-DD.
- For repeating appointments, change only the occurrence the user means unless they say otherwise (scope "one").
- To text or email someone, use draft_message. You cannot send anything yourself; the user taps to send.
- Be proactive: after handling the request, if you notice something genuinely useful (a clash, no time for lunch, an overdue task, a birthday, a missing location), mention at most one thing briefly and offer to take care of it.`;
}

function contextNote() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const dateStr = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  return `[Context: it is now ${dateStr}, ${toLocal(now).slice(11)} local time (${tz}). Today is ${today()}. The user's language is ${t.lang() === 'nl' ? 'Dutch' : 'English'}${state.settings.userName ? `; their name is ${state.settings.userName}` : ''}.]`;
}

// ---------------------------------------------------------------- tools

const str = (description) => ({ type: 'string', description });
const TOOLS = [
  {
    name: 'get_agenda',
    description: 'List appointments (with repeats expanded), birthdays and tasks due between two dates, inclusive. Also returns overdue tasks. Use before answering anything about the schedule.',
    input_schema: { type: 'object', properties: { from: str('First day, YYYY-MM-DD'), to: str('Last day, YYYY-MM-DD (max 62 days after from)') }, required: ['from', 'to'] },
  },
  {
    name: 'search',
    description: 'Search appointments, tasks, contacts and memos by text (title, location, notes, names, phone numbers).',
    input_schema: { type: 'object', properties: { query: str('Words to look for') }, required: ['query'] },
  },
  {
    name: 'create_event',
    description: 'Create an appointment.',
    input_schema: {
      type: 'object',
      properties: {
        title: str('Short title'),
        start: str('YYYY-MM-DDTHH:mm, or YYYY-MM-DD for an all-day appointment'),
        end: str('YYYY-MM-DDTHH:mm, or YYYY-MM-DD (inclusive) for all-day. Optional: defaults to the user\'s default length.'),
        all_day: { type: 'boolean' },
        location: str('Optional place'),
        notes: str('Optional notes'),
        contact_names: { type: 'array', items: { type: 'string' }, description: 'Optional names of existing contacts to link' },
        alarm_minutes_before: { type: 'integer', description: 'Optional reminder, minutes before the start' },
        repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'], description: 'Optional repeat rule' },
      },
      required: ['title', 'start'],
    },
  },
  {
    name: 'update_event',
    description: 'Change an appointment: move it, rename it, change the location, notes or reminder. Get the id and occurrence_day from get_agenda or search first.',
    input_schema: {
      type: 'object',
      properties: {
        id: str('Appointment id'),
        occurrence_day: str('The day of the occurrence to change, YYYY-MM-DD'),
        scope: { type: 'string', enum: ['one', 'future', 'all'], description: 'For repeating appointments: only this one, this and future ones, or all. Ignored otherwise.' },
        title: str('New title'),
        start: str('New start, YYYY-MM-DDTHH:mm (or YYYY-MM-DD if all-day)'),
        end: str('New end'),
        location: str('New location'),
        notes: str('New notes'),
        alarm_minutes_before: { type: 'integer', description: 'New reminder; -1 removes it' },
      },
      required: ['id', 'occurrence_day'],
    },
  },
  {
    name: 'delete_event',
    description: 'Delete an appointment. Only when the user explicitly asks for it.',
    input_schema: {
      type: 'object',
      properties: { id: str('Appointment id'), occurrence_day: str('YYYY-MM-DD'), scope: { type: 'string', enum: ['one', 'future', 'all'] } },
      required: ['id', 'occurrence_day'],
    },
  },
  {
    name: 'create_task',
    description: 'Add a to-do.',
    input_schema: {
      type: 'object',
      properties: {
        title: str('What needs doing'),
        due: str('Optional due date YYYY-MM-DD'),
        priority: { type: 'integer', description: '1 (highest) to 5 (lowest); default 3' },
        notes: str('Optional notes'),
        contact_names: { type: 'array', items: { type: 'string' } },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Change a to-do or mark it done. Get the id from get_agenda or search.',
    input_schema: {
      type: 'object',
      properties: { id: str('Task id'), done: { type: 'boolean' }, title: str('New title'), due: str('New due date YYYY-MM-DD, or "none"'), priority: { type: 'integer' }, notes: str('New notes') },
      required: ['id'],
    },
  },
  {
    name: 'create_memo',
    description: 'Save a memo (a note). The first line becomes its title.',
    input_schema: { type: 'object', properties: { text: str('Memo text') }, required: ['text'] },
  },
  {
    name: 'create_contact',
    description: 'Add a contact.',
    input_schema: { type: 'object', properties: { first_name: str('First name'), last_name: str('Last name'), company: str('Company'), phone: str('Phone number'), email: str('Email address') }, required: ['first_name'] },
  },
  {
    name: 'draft_message',
    description: 'Prepare a text message or email to a contact. The app shows a button; the user taps it to send.',
    input_schema: { type: 'object', properties: { contact_name: str('Name of an existing contact'), channel: { type: 'string', enum: ['sms', 'email'] }, text: str('The message') }, required: ['contact_name', 'channel', 'text'] },
  },
];

function findContacts(names = []) {
  const found = [], missing = [];
  for (const n of names) {
    const q = n.toLowerCase().trim();
    const c = state.contacts.find((x) => contactName(x).toLowerCase() === q) || state.contacts.find((x) => contactName(x).toLowerCase().includes(q) || q.includes((x.firstName || '').toLowerCase() || '\u0000'));
    if (c) found.push(c);
    else missing.push(n);
  }
  return { ids: [...new Set(found.map((c) => c.id))], missing };
}

const occSummary = (o) => ({
  id: o.ev.id,
  occurrence_day: o.day,
  title: o.ev.title,
  start: o.start,
  end: o.end,
  all_day: o.allDay,
  location: o.ev.location || undefined,
  contacts: contactsByIds(o.ev.contactIds).map((c) => contactName(c)),
  repeats: o.ev.repeat?.freq ? describeRepeat(o.ev.repeat, t, eventStartDay(o.ev)) : undefined,
  reminder_minutes_before: o.ev.alarm ?? undefined,
});
const taskSummary = (x) => ({ id: x.id, title: x.title, due: x.due || null, priority: x.priority || 3, done: !!x.done, contacts: contactsByIds(x.contactIds).map((c) => contactName(c)) });

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isDateTime = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s || '');

// Each tool returns { result (sent to Claude), effect? (shown as a button in the panel) }
function runTool(name, input) {
  const i = input || {};
  switch (name) {
    case 'get_agenda': {
      if (!isDay(i.from) || !isDay(i.to)) throw new Error('from and to must be YYYY-MM-DD');
      const to = i.to > addDays(i.from, 62) ? addDays(i.from, 62) : i.to;
      const events = occurrencesInRange(i.from, to, { filter: false }).map(occSummary);
      const birthdays = birthdaysInRange(i.from, to).map((b) => ({ name: contactName(b.contact), day: b.day, age: b.age }));
      const tasks = state.tasks.filter((x) => !x.done && x.due && x.due >= i.from && x.due <= to).map(taskSummary);
      const overdue = state.tasks.filter(isOverdue).map(taskSummary);
      const undated = state.tasks.filter((x) => !x.done && !x.due).slice(0, 20).map(taskSummary);
      return { result: { events, birthdays, tasks_due: tasks, overdue_tasks: overdue, tasks_without_date: undated } };
    }
    case 'search': {
      const r = search(i.query || '');
      return {
        result: {
          events: r.events.slice(0, 15).map(occSummary),
          tasks: r.tasks.slice(0, 15).map(taskSummary),
          contacts: r.contacts.slice(0, 10).map((c) => ({ id: c.id, name: contactName(c), company: c.company, phones: c.phones, emails: c.emails, birthday: c.birthday })),
          memos: r.memos.slice(0, 10).map((m) => ({ id: m.id, text: m.text.slice(0, 300) })),
        },
      };
    }
    case 'create_event': {
      const allDay = !!i.all_day || isDay(i.start);
      if (!(allDay ? isDay(i.start.slice(0, 10)) : isDateTime(i.start))) throw new Error('start must be YYYY-MM-DDTHH:mm or YYYY-MM-DD');
      const start = allDay ? i.start.slice(0, 10) : i.start;
      let end = i.end && (allDay ? isDay(i.end.slice(0, 10)) : isDateTime(i.end)) ? (allDay ? i.end.slice(0, 10) : i.end) : allDay ? start : addMinutes(start, state.settings.defaultDuration);
      if (end < start) end = allDay ? start : addMinutes(start, state.settings.defaultDuration);
      const { ids, missing } = findContacts(i.contact_names);
      const rec = upsert('events', {
        title: i.title, start, end, allDay, location: i.location || '', notes: i.notes || '', contactIds: ids, icon: '', categoryId: '',
        alarm: Number.isInteger(i.alarm_minutes_before) ? i.alarm_minutes_before : state.settings.defaultAlarm,
        repeat: i.repeat && i.repeat !== 'none' ? { freq: i.repeat, interval: 1, ...(i.repeat === 'monthly' ? { monthBy: 'date' } : {}) } : null,
        exceptions: [],
      });
      return { result: { created: occSummary(makeOcc(rec, start.slice(0, 10))), contacts_not_found: missing }, effect: { kind: 'event', id: rec.id, day: start.slice(0, 10), label: rec.title } };
    }
    case 'update_event': {
      const ev = get('events', i.id);
      if (!ev) throw new Error('No appointment with that id');
      const day = isDay(i.occurrence_day) ? i.occurrence_day : eventStartDay(ev);
      const o = makeOcc(ev, day);
      let start = i.start && (ev.allDay ? isDay(i.start.slice(0, 10)) : isDateTime(i.start)) ? (ev.allDay ? i.start.slice(0, 10) : i.start) : o.start;
      let end = i.end && (ev.allDay ? isDay(i.end.slice(0, 10)) : isDateTime(i.end)) ? (ev.allDay ? i.end.slice(0, 10) : i.end) : null;
      if (!end) end = ev.allDay ? addDays(start, Math.max(0, minutesBetween(o.start + 'T00:00', o.end + 'T00:00') / 1440)) : addMinutes(start, minutesBetween(o.start, o.end));
      if (end < start) end = ev.allDay ? start : addMinutes(start, 30);
      const data = {
        title: i.title ?? ev.title, icon: ev.icon || '', allDay: !!ev.allDay, start, end, repeat: ev.repeat || null,
        alarm: Number.isInteger(i.alarm_minutes_before) ? (i.alarm_minutes_before < 0 ? null : i.alarm_minutes_before) : ev.alarm ?? null,
        categoryId: ev.categoryId || '', location: i.location ?? ev.location ?? '', contactIds: ev.contactIds || [], notes: i.notes ?? ev.notes ?? '',
      };
      changeOccurrence(ev, day, data, i.scope || 'one');
      return { result: { updated: { ...data, id: ev.id } }, effect: { kind: 'event', id: ev.id, day: start.slice(0, 10), label: data.title } };
    }
    case 'delete_event': {
      const ev = get('events', i.id);
      if (!ev) throw new Error('No appointment with that id');
      removeOccurrence(ev, isDay(i.occurrence_day) ? i.occurrence_day : eventStartDay(ev), i.scope || 'one');
      return { result: { deleted: ev.title } };
    }
    case 'create_task': {
      const { ids, missing } = findContacts(i.contact_names);
      const rec = upsert('tasks', { title: i.title, due: isDay(i.due) ? i.due : null, priority: Math.min(5, Math.max(1, Number(i.priority) || 3)), notes: i.notes || '', contactIds: ids, done: false, categoryId: '', icon: '' });
      return { result: { created: taskSummary(rec), contacts_not_found: missing }, effect: { kind: 'task', id: rec.id, label: rec.title } };
    }
    case 'update_task': {
      const tk = get('tasks', i.id);
      if (!tk) throw new Error('No task with that id');
      let cur = tk;
      if (i.done === true && !tk.done) {
        // Repeating tasks roll on to their next date, like ticking them off in the list.
        const next = tk.repeat?.freq && tk.due ? nextOccurrence(tk.repeat, tk.repeatStart || tk.due, tk.due) : null;
        cur = next
          ? { ...tk, repeatStart: tk.repeatStart || tk.due, due: next, completions: (tk.completions || 0) + 1, lastDoneAt: new Date().toISOString() }
          : { ...tk, done: true, doneAt: new Date().toISOString() };
      }
      const rec = upsert('tasks', {
        ...cur,
        ...(i.done === false ? { done: false, doneAt: null } : {}),
        ...(i.title ? { title: i.title } : {}),
        ...(i.due ? { due: i.due === 'none' ? null : isDay(i.due) ? i.due : cur.due } : {}),
        ...(Number.isInteger(i.priority) ? { priority: Math.min(5, Math.max(1, i.priority)) } : {}),
        ...(i.notes != null ? { notes: i.notes } : {}),
      });
      return { result: { updated: taskSummary(rec) }, effect: { kind: 'task', id: rec.id, label: rec.title } };
    }
    case 'create_memo': {
      const rec = upsert('memos', { text: String(i.text || ''), categoryId: '' });
      return { result: { created_memo_id: rec.id }, effect: { kind: 'memo', id: rec.id, label: rec.text.split('\n')[0] } };
    }
    case 'create_contact': {
      const rec = upsert('contacts', {
        firstName: i.first_name || '', lastName: i.last_name || '', company: i.company || '',
        phones: i.phone ? [{ label: 'mobile', value: i.phone }] : [], emails: i.email ? [i.email] : [], categoryId: '',
      });
      return { result: { created_contact: contactName(rec), id: rec.id }, effect: { kind: 'contact', id: rec.id, label: contactName(rec) } };
    }
    case 'draft_message': {
      const { ids } = findContacts([i.contact_name]);
      const c = ids.length ? get('contacts', ids[0]) : null;
      if (!c) throw new Error(`No contact named ${i.contact_name}`);
      if (i.channel === 'email') {
        const email = c.emails?.find(Boolean);
        if (!email) throw new Error(`${contactName(c)} has no email address`);
        return { result: { ready: true, to: contactName(c) }, effect: { kind: 'link', href: `mailto:${email}?body=${encodeURIComponent(i.text)}`, label: t('ai.sendEmail', { name: c.firstName || contactName(c) }) } };
      }
      const ph = c.phones?.find((x) => x.label === 'mobile' && x.value) || c.phones?.find((x) => x.value);
      if (!ph) throw new Error(`${contactName(c)} has no phone number`);
      return { result: { ready: true, to: contactName(c) }, effect: { kind: 'link', href: `sms:${ph.value.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(i.text)}`, label: t('ai.sendText', { name: c.firstName || contactName(c) }) } };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

// ---------------------------------------------------------------- Claude

let clientPromise = null;
let clientKey = '';
async function getClient() {
  const key = getApiKey();
  if (!clientPromise || clientKey !== key) {
    clientKey = key;
    clientPromise = import('../vendor/anthropic-sdk.js').then(({ Anthropic }) => ({
      Anthropic,
      // The key lives on this device only and requests go straight to Anthropic.
      client: new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 60_000 }),
    }));
  }
  return clientPromise;
}

// Conversation history, append-only (thinking blocks are sent back untouched).
let history = [];
let lastActivity = 0;
export function resetConversation() {
  history = [];
}

async function runTurn(onStep) {
  const { client, Anthropic } = await getClient();
  const model = MODELS.find((m) => m.id === state.settings.aiModel) || MODELS[0];
  const effects = [];
  let changed = false;
  for (let step = 0; step < 8; step++) {
    let response;
    try {
      response = await client.beta.messages.create({
        model: model.id,
        max_tokens: 16000,
        system: systemPrompt(),
        tools: TOOLS,
        messages: history,
        cache_control: { type: 'ephemeral' },
        output_config: { effort: 'low' }, // short, spoken answers: keep it quick
        ...(model.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      });
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) throw new AIError('auth');
      if (e instanceof Anthropic.RateLimitError) throw new AIError('rate');
      if (e instanceof Anthropic.BadRequestError) throw new AIError('bad', e.message);
      if (e instanceof Anthropic.APIConnectionError) throw new AIError('network');
      if (e instanceof Anthropic.APIError) throw new AIError('api', e.message);
      throw e;
    }
    history.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'refusal') return { text: t('ai.refused'), effects, changed };
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason === 'pause_turn') continue;
    if (!calls.length || response.stop_reason !== 'tool_use') return { text: text || t('ai.done'), effects, changed };
    onStep?.(calls.map((c) => c.name));
    const results = [];
    for (const call of calls) {
      try {
        const { result, effect } = runTool(call.name, call.input);
        if (effect) effects.push(effect);
        if (!['get_agenda', 'search', 'draft_message'].includes(call.name)) changed = true;
        results.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: call.id, content: String(err.message || err), is_error: true });
      }
    }
    history.push({ role: 'user', content: results });
  }
  return { text: t('ai.done'), effects, changed };
}

export class AIError extends Error {
  constructor(code, detail = '') {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

// Talk to the assistant. Returns { text, effects[], changed, local }.
export async function talk(userText, { onStep } = {}) {
  // Start fresh after a quiet half hour, so old context doesn't pile up.
  if (Date.now() - lastActivity > 30 * 60 * 1000) history = [];
  lastActivity = Date.now();
  if (!hasAI()) return { ...localCommand(userText), local: true };
  // One undo step covers everything the assistant changes in this turn.
  commit(() => {}, { undoable: true, silent: true });
  const turnStart = history.length;
  history.push({ role: 'user', content: [{ type: 'text', text: contextNote() }, { type: 'text', text: userText }] });
  try {
    return await runTurn(onStep);
  } catch (e) {
    // Keep the history valid: drop this turn if it didn't complete.
    history = history.slice(0, turnStart);
    throw e;
  }
}

export const undoAssistant = () => undo();

// ---------------------------------------------------------------- offline fallback

// A few useful commands without AI: what's next, today/tomorrow, add a task.
function localCommand(text) {
  const s = text.toLowerCase().trim();
  const d0 = today();
  const nowL = toLocal(new Date());
  if (/(what'?s next|wat is (het )?volgende|wat (staat|heb ik) (er )?nu)/.test(s)) {
    const next = occurrencesInRange(d0, addDays(d0, 14), { filter: false }).find((o) => !o.allDay && o.start > nowL);
    return { text: next ? t('ai.local.next', { title: next.ev.title, when: whenText(next) }) : t('ai.local.nothingNext'), effects: next ? [{ kind: 'event', id: next.ev.id, day: next.day, label: next.ev.title }] : [] };
  }
  const m = s.match(/^(?:add (?:a )?task|new task|remind me to|herinner me (?:eraan )?(?:om|aan)|taak|nieuwe taak|zet op (?:de )?lijst)[:\s]+(.+)$/i);
  if (m) {
    const title = text.slice(text.length - m[1].length).trim();
    const due = /(tomorrow|morgen)/.test(s) ? addDays(d0, 1) : d0;
    const clean = title.replace(/\b(tomorrow|morgen|today|vandaag)\b/gi, '').trim();
    const rec = upsert('tasks', { id: uid(), userId: LOCAL_USER, title: clean.charAt(0).toUpperCase() + clean.slice(1), due, priority: 3, done: false, contactIds: [], categoryId: '' }, { undoable: true });
    return { text: t('ai.local.taskAdded', { title: rec.title }), effects: [{ kind: 'task', id: rec.id, label: rec.title }], changed: true };
  }
  const dayMatch = /(tomorrow|morgen)/.test(s) ? addDays(d0, 1) : /(today|vandaag|briefing|brief me|my day|mijn dag)/.test(s) ? d0 : null;
  if (dayMatch) return { text: dayMatch === d0 ? localBriefing() : dayText(dayMatch), effects: [] };
  return { text: t('ai.local.needKey'), effects: [{ kind: 'settings', label: t('ai.connect') }] };
}

function whenText(o) {
  return `${relDay(o.day, { weekday: 'long', day: 'numeric', month: 'long' }).toLowerCase()} ${fmtTime(o.start)}`;
}

function dayText(day) {
  const list = occurrencesInRange(day, day, { filter: false });
  if (!list.length) return t('ai.local.dayFree');
  const items = list.slice(0, 5).map((o) => (o.allDay ? o.ev.title : `${o.ev.title} ${t('ai.brief.atTime', { time: fmtTime(o.start) })}`));
  return `${t('ai.local.dayCount', { n: list.length })} ${items.join(', ')}.`;
}
