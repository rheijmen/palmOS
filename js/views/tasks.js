// To Do list with filters and a quick-add line.
import { esc, today } from '../util.js';
import { t, relDay } from '../i18n.js';
import { icon } from '../icons.js';
import { filterTasks, isOverdue } from '../query.js';
import { taskRow, sectionHead, emptyState } from '../components.js';

export const TASK_FILTERS = ['all', 'today', 'upcoming', 'nodate', 'done'];
let mode = 'all';
export const setTaskMode = (m) => (mode = m);

function group(list) {
  const t0 = today();
  const groups = new Map();
  for (const tk of list) {
    const key = tk.done ? 'done' : !tk.due ? 'nodate' : isOverdue(tk) ? 'overdue' : tk.due === t0 ? 'today' : tk.due;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tk);
  }
  return groups;
}

export const tasksView = {
  title: () => t('tasks.title'),
  render() {
    const list = filterTasks(mode);
    const counts = Object.fromEntries(TASK_FILTERS.map((f) => [f, filterTasks(f).length]));
    let body = '';
    if (!list.length) {
      body = emptyState(t(`tasks.empty.${mode}`), mode === 'done' ? '' : t('task.new'), 'new-task');
    } else if (mode === 'done') {
      body = `<div class="list">${list.map((x) => taskRow(x)).join('')}</div>`;
      body += `<button class="btn btn-ghost more-btn" data-act="purge-done">${icon('trash-2', { size: 16 })} ${esc(t('tasks.purge'))}</button>`;
    } else {
      for (const [key, items] of group(list)) {
        const label = key === 'overdue' ? t('tasks.overdue') : key === 'today' ? t('common.today') : key === 'nodate' ? t('tasks.noDate') : relDay(key, { weekday: 'long', day: 'numeric', month: 'long' });
        body += `${sectionHead(label)}<div class="list ${key === 'overdue' ? 'is-overdue' : ''}">${items.map((x) => taskRow(x, { showDue: key === 'overdue' || key === 'nodate' ? true : false })).join('')}</div>`;
      }
    }
    return `
      <form class="quick-add" data-form="quick-task">
        <span class="qa-icon">${icon('plus', { size: 18 })}</span>
        <input name="title" placeholder="${esc(t('tasks.quickAdd'))}" autocomplete="off" enterkeyhint="done" aria-label="${esc(t('tasks.quickAdd'))}">
      </form>
      <div class="filters" role="tablist">
        ${TASK_FILTERS.map((f) => `<button class="pill ${f === mode ? 'on' : ''}" role="tab" aria-selected="${f === mode}" data-act="task-filter" data-mode="${f}">${esc(t('tasks.filter.' + f))}${f !== 'done' && counts[f] ? ` <span class="count">${counts[f]}</span>` : ''}</button>`).join('')}
      </div>
      ${body}`;
  },
};

export const quickTaskDue = () => (mode === 'today' ? today() : null);
