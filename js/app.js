// App shell: routing, title bar, toolbar, global actions and lifecycle.
import { state, subscribe, setSetting, commit, undo, exportJSON, importJSON, eraseAll, seedDemo, markWelcomed, upsert, isMemoryOnly } from './store.js';
import { esc, today, download, uid, debounce, isoWeek } from './util.js';
import { configureI18n, t, fmtDate } from './i18n.js';
import { icon } from './icons.js';
import { initActions, on } from './actions.js';
import { initUI, openSheet, closeSheet, toast, confirmDialog, sheetOpen, navigate } from './ui.js';
import { catName, catColor, search } from './query.js';
import { occRow, taskRow, contactRow } from './components.js';
import { agendaView } from './views/agenda.js';
import { dayView, weekView, monthView, yearView, listView, listMore } from './views/calendar.js';
import { tasksView, setTaskMode, quickTaskDue } from './views/tasks.js';
import { contactsView, setContactQuery } from './views/contacts.js';
import { memosView, setMemoQuery, memoTitle } from './views/memos.js';
import { settingsView } from './views/settings.js';
import { openEventDetail, openEventEditor, openTaskEditor, openContactDetail, openContactEditor, openMemoEditor, openNewChooser, toggleTask, openDatePicker } from './editors.js';
import { startReminders, requestNotifications } from './reminders.js';
import { initGestures, gestureBusy } from './gestures.js';
import { openAssistant } from './ai/panel.js';
import { dismissInsight, moveOverdue } from './ai/insights.js';
import { setApiKey } from './ai/assistant.js';
import { speak } from './ai/voice.js';
import { initSync, signIn, signOut, syncNow, onSyncStatus } from './sync.js';
import { exportICS, importICS, exportVCF, importVCF } from './interop.js';

const VIEWS = { agenda: agendaView, day: dayView, week: weekView, month: monthView, year: yearView, list: listView, tasks: tasksView, contacts: contactsView, memos: memosView, settings: settingsView };
const DATED = ['agenda', 'day', 'week', 'month', 'year', 'list'];
const CAL = ['day', 'week', 'month', 'year', 'list'];
const TOOLBAR = [
  ['agenda', 'layout-list', 'nav.agenda'],
  ['calendar', 'calendar-days', 'nav.calendar'],
  ['tasks', 'square-check-big', 'nav.tasks'],
  ['memos', 'sticky-note', 'nav.memos'],
  ['contacts', 'contact', 'nav.contacts'],
];

let route = { view: 'agenda', date: today() };
let lastRouteKey = '';

// ---------------------------------------------------------------- routing

function parseHash() {
  const [, view = 'agenda', date] = location.hash.replace(/^#\/?/, '#/').split('/');
  const v = VIEWS[view] ? view : 'agenda';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : route.date || today();
  return { view: v, date: d };
}

export function go(view, date = route.date) {
  if (view === 'calendar') view = state.settings.calView || 'month';
  if (CAL.includes(view) && state.settings.calView !== view) commit((s) => (s.settings.calView = view), { silent: true });
  navigate(DATED.includes(view) ? `#/${view}/${date}` : `#/${view}`);
}

// ---------------------------------------------------------------- theme

// Theme = colours (light/dark), skin = the look: 'gloss' (2007), 'flat' (modern), 'palm' (classic).
export const skinFor = (theme) => (theme === 'classic' ? 'palm' : theme === 'modern' ? 'flat' : 'gloss');

function applyTheme() {
  const theme = state.settings.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.skin = skinFor(theme);
  const dark = theme === 'dark' || ((theme === 'auto' || theme === 'modern') && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name=theme-color]').content = theme === 'classic' ? '#003a8c' : dark ? '#121a2b' : skinFor(theme) === 'gloss' ? '#2a62c0' : '#1b4fa8';
}

// ---------------------------------------------------------------- render

function renderChrome() {
  const v = VIEWS[route.view];
  const title = document.getElementById('title');
  title.innerHTML = `<span>${esc(v.title(route))}</span>${DATED.includes(route.view) ? icon('chevron-down', { size: 14 }) : ''}`;
  title.setAttribute('aria-label', DATED.includes(route.view) ? t('goto.title') : v.title(route));

  const sel = document.getElementById('cat-filter');
  const cur = state.settings.category;
  sel.innerHTML = `<option value="all">${esc(t('filter.all'))}</option>${state.categories.map((c) => `<option value="${c.id}">${esc(catName(c))}</option>`).join('')}<option value="none">${esc(t('cat.none'))}</option>`;
  sel.value = cur;
  sel.closest('.cat-filter').style.setProperty('--cat', cur === 'all' || cur === 'none' ? 'transparent' : catColor(cur));
  sel.closest('.cat-filter').hidden = route.view === 'settings';

  const aiBtn = document.getElementById('btn-ai');
  aiBtn.innerHTML = '<span class="mini-scanner" aria-hidden="true"><i></i></span>';
  aiBtn.setAttribute('aria-label', t('ai.talkTo', { name: state.settings.aiName || 'Pilot' }));
  document.getElementById('btn-search').innerHTML = icon('search');
  document.getElementById('btn-search').setAttribute('aria-label', t('common.search'));
  document.getElementById('btn-settings').innerHTML = icon('settings');
  document.getElementById('btn-settings').setAttribute('aria-label', t('settings.title'));

  const sub = document.getElementById('subbar');
  if (DATED.includes(route.view)) {
    sub.hidden = false;
    sub.innerHTML = `
      ${CAL.includes(route.view)
        ? `<div class="seg views" role="tablist">${CAL.map((c) => `<button role="tab" class="${c === route.view ? 'on' : ''}" aria-selected="${c === route.view}" data-act="goto-view" data-view="${c}">${esc(t('view.' + c))}</button>`).join('')}</div>`
        : `<span class="sub-date">${esc(fmtDate(route.date, { weekday: 'long', day: 'numeric', month: 'long' }))} <small>${esc(t('week.short', { n: isoWeek(route.date) }))}</small></span>`}
      <div class="navs">
        ${route.date !== today() ? `<button class="today-btn" data-act="today" aria-label="${esc(t('common.today'))}"><span class="today-num">${new Date().getDate()}</span><span class="today-txt">${esc(t('common.today'))}</span></button>` : ''}
        <button class="icon-btn" data-act="prev" aria-label="${esc(t('common.previous'))}">${icon('chevron-left')}</button>
        <button class="icon-btn" data-act="next" aria-label="${esc(t('common.next'))}">${icon('chevron-right')}</button>
      </div>`;
  } else {
    sub.hidden = true;
    sub.innerHTML = '';
  }

  const active = CAL.includes(route.view) ? 'calendar' : route.view;
  document.getElementById('toolbar').innerHTML = TOOLBAR.map(
    ([k, ic, label]) => `<button class="tb ${k === active ? 'on' : ''}" data-act="goto-view" data-view="${k}" aria-current="${k === active ? 'page' : 'false'}">${icon(ic, { size: 22 })}<span>${esc(t(label))}</span></button>`
  ).join('');

  const fab = document.getElementById('fab');
  fab.hidden = route.view === 'settings';
  fab.innerHTML = icon('plus', { size: 26 });
  fab.setAttribute('aria-label', t(route.view === 'tasks' ? 'task.new' : route.view === 'contacts' ? 'contact.new' : route.view === 'memos' ? 'memo.new' : route.view === 'agenda' ? 'common.new' : 'event.new'));
  document.title = `${v.title(route)} · Agendus`;
}

function render() {
  configureI18n(state.settings);
  applyTheme();
  renderChrome();
  const main = document.getElementById('main');
  const key = `${route.view}/${route.date}`;
  const sameRoute = key === lastRouteKey;
  const scroll = sameRoute ? main.scrollTop : 0;
  const tg = main.querySelector('.timegrid');
  const tgScroll = sameRoute && tg ? tg.scrollTop : null;
  const focused = document.activeElement && main.contains(document.activeElement) ? document.activeElement : null;
  const focusSel = focused?.dataset.input ? `[data-input="${focused.dataset.input}"]` : focused?.name === 'title' && focused.closest('[data-form]') ? '[data-form] input[name=title]' : null;
  const caret = focused?.selectionStart;

  main.className = `view-${route.view}`;
  main.innerHTML = VIEWS[route.view].render(route);
  main.scrollTop = scroll;
  const grid = main.querySelector('.timegrid');
  if (grid) {
    if (tgScroll != null) grid.scrollTop = tgScroll;
    else scrollGrid(grid);
  }
  if (focusSel) {
    const el = main.querySelector(focusSel);
    if (el) {
      el.focus();
      try {
        el.setSelectionRange(caret, caret);
      } catch {}
    }
  }
  lastRouteKey = key;
}

// Scroll the time grid to "now" (today) or the start of the working day.
function scrollGrid(grid) {
  const h0 = Number(grid.dataset.scrollTo) || 0;
  const target = route.view === 'day' && route.date === today() ? Math.max(h0, new Date().getHours() - 1) : state.settings.dayStart;
  const row = grid.querySelectorAll('.hour-label')[Math.max(0, target - h0)];
  grid.scrollTop = row ? row.offsetTop - 4 : 0;
}

// ---------------------------------------------------------------- navigation

let navDir = 0;
function step(n) {
  const v = VIEWS[route.view];
  if (!v.step) return;
  navDir = n;
  go(route.view, v.step(route.date, n));
}

function onTitleTap() {
  if (!DATED.includes(route.view)) return;
  openDatePicker(route.date, (d) => go(route.view, d));
}

// ---------------------------------------------------------------- search

function openSearch() {
  const results = (q) => {
    const r = search(q);
    if (!q.trim()) return `<p class="muted pad">${esc(t('search.hint'))}</p>`;
    const n = r.events.length + r.tasks.length + r.contacts.length + r.memos.length;
    if (!n) return `<p class="muted pad">${esc(t('search.none', { q }))}</p>`;
    return `
      ${r.events.length ? `<h4 class="sub-head">${esc(t('search.appointments'))}</h4><div class="list">${r.events.slice(0, 30).map((o) => occRow(o, { showDay: true })).join('')}</div>` : ''}
      ${r.tasks.length ? `<h4 class="sub-head">${esc(t('tasks.title'))}</h4><div class="list">${r.tasks.slice(0, 30).map((x) => taskRow(x)).join('')}</div>` : ''}
      ${r.contacts.length ? `<h4 class="sub-head">${esc(t('contacts.title'))}</h4><div class="list">${r.contacts.slice(0, 30).map((c) => contactRow(c, { compact: true })).join('')}</div>` : ''}
      ${r.memos.length ? `<h4 class="sub-head">${esc(t('memos.title'))}</h4><div class="list">${r.memos.slice(0, 30).map((m) => `<button class="row" data-act="edit-memo" data-id="${m.id}">${icon('sticky-note', { size: 18 })}<span class="row-main"><span class="row-title">${esc(memoTitle(m))}</span></span></button>`).join('')}</div>` : ''}`;
  };
  let q = '';
  let unsub = null;
  openSheet({
    title: t('common.search'),
    cls: 'sheet-tall',
    body: `<div class="search-line big">${icon('search', { size: 20 })}<input type="search" autofocus placeholder="${esc(t('search.placeholder'))}" data-sq enterkeyhint="search"></div><div class="search-results">${results('')}</div>`,
    onMount(el) {
      const input = el.querySelector('[data-sq]');
      const box = el.querySelector('.search-results');
      input.addEventListener('input', debounce(() => {
        q = input.value;
        box.innerHTML = results(q);
      }, 120));
      // Re-run the search after edits made from a result.
      unsub = subscribe(() => (box.innerHTML = results(q)));
      setTimeout(() => input.focus(), 50);
    },
    onClose() {
      unsub?.();
    },
  });
}

// ---------------------------------------------------------------- welcome

function showWelcome() {
  openSheet({
    title: t('welcome.title'),
    cls: 'sheet-dialog welcome',
    body: `<div class="welcome-art"><img src="assets/icon.svg" alt="" width="72" height="72"></div>
      <p>${esc(t('welcome.text'))}</p>
      <ul class="welcome-list">
        <li>${icon('layout-list', { size: 16 })} ${esc(t('welcome.f1'))}</li>
        <li>${icon('calendar-days', { size: 16 })} ${esc(t('welcome.f2'))}</li>
        <li>${icon('users', { size: 16 })} ${esc(t('welcome.f3'))}</li>
        <li>${icon('bell', { size: 16 })} ${esc(t('welcome.f4'))}</li>
        <li>${icon('lock', { size: 16 })} ${esc(t('welcome.f5'))}</li>
        <li>${icon('smartphone', { size: 16 })} ${esc(t('welcome.f6'))}</li>
      </ul>
      <div class="dialog-actions">
        <button class="btn btn-primary" data-w="demo">${esc(t('welcome.demo'))}</button>
        <button class="btn" data-w="empty">${esc(t('welcome.empty'))}</button>
        <button class="btn btn-ghost" data-w="account">${icon('users', { size: 16 })} ${esc(t('sync.haveAccount'))}</button>
      </div>`,
    onMount(el) {
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-w]');
        if (!b) return;
        if (b.dataset.w === 'demo') seedDemo(t);
        else markWelcomed();
        closeSheet();
        if (b.dataset.w === 'account') go('settings');
      });
    },
    onClose() {
      if (!state.welcomed) markWelcomed();
    },
  });
}

// ---------------------------------------------------------------- file import

function pickFile(accept, cb) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const f = input.files?.[0];
    if (!f) return;
    f.text().then(cb);
  };
  input.click();
}

// ---------------------------------------------------------------- actions

function registerActions() {
  on('goto-view', (el) => go(el.dataset.view, el.dataset.day || (el.dataset.view === 'agenda' ? today() : route.date)));
  on('goto-day', (el) => go(route.view === 'agenda' || !DATED.includes(route.view) ? 'agenda' : route.view, el.dataset.day));
  on('open-day', (el) => go('day', el.dataset.day));
  on('open-month', (el) => go('month', el.dataset.day));
  on('select-day', (el) => {
    if (el.dataset.day === route.date) go('day', el.dataset.day);
    else go('month', el.dataset.day);
  });
  on('today', () => go(route.view, today()));
  on('prev', () => step(-1));
  on('next', () => step(1));
  on('title-tap', onTitleTap);
  on('goto-settings', () => go('settings'));
  on('search', openSearch);
  on('ai-open', () => openAssistant());
  on('ai-listen', () => openAssistant({ listenNow: true }));
  on('ai-dismiss', (el) => dismissInsight(el.dataset.id));
  on('ai-move-overdue', (el) => {
    moveOverdue(el.dataset.to);
    toast(t('ai.moved'), { action: t('common.undo'), onAction: undo });
  });
  on('ai-gift-task', (el) => {
    const c = state.contacts.find((x) => x.id === el.dataset.id);
    if (!c) return;
    upsert('tasks', { title: t('ai.giftTitle', { name: c.firstName || c.lastName || '' }), due: today(), priority: 2, icon: 'gift', done: false, contactIds: [c.id], categoryId: '' }, { undoable: true });
    toast(t('task.added'), { action: t('common.undo'), onAction: undo });
  });
  on('setting-text', (el) => setSetting(el.dataset.key, el.value.trim()));
  on('ai-save-key', () => {
    const v = document.getElementById('ai-key').value.trim();
    if (v && !/^sk-ant-/.test(v)) return toast(t('ai.keyInvalid'));
    setApiKey(v);
    toast(v ? t('ai.keySaved') : t('ai.keyRemoved'));
    render();
  });
  on('ai-forget-key', () => {
    setApiKey('');
    toast(t('ai.keyRemoved'));
    render();
  });
  on('ai-test-voice', () => speak(t('ai.voiceTest', { name: state.settings.aiName || 'Pilot' }), { force: true }));

  on('sync-signin', async (el) => {
    const url = document.getElementById('sync-url').value;
    const email = document.getElementById('sync-email').value;
    const pass = document.getElementById('sync-pass').value;
    if (!url.trim() || !email.trim() || !pass) return toast(t('sync.fillIn'));
    el.disabled = true;
    el.textContent = t('sync.signingIn');
    try {
      await signIn(url, email, pass);
      toast(t('sync.signedIn'));
    } catch (e) {
      toast(e?.status === 400 ? t('sync.wrongLogin') : e?.status ? t('sync.serverError', { code: e.status }) : t('sync.unreachable'));
    }
    render();
  });
  on('sync-now', () => syncNow());
  on('sync-signout', async () => {
    if (!(await confirmDialog(t('sync.signOut'), t('sync.signOutConfirm'), t('sync.signOut'), false))) return;
    signOut();
    render();
  });
  on('list-more', () => {
    listMore();
    render();
  });

  on('fab', () => {
    const v = route.view;
    if (v === 'tasks') openTaskEditor({ prefill: { due: quickTaskDue() ?? today() } });
    else if (v === 'contacts') openContactEditor({});
    else if (v === 'memos') openMemoEditor({});
    else if (v === 'agenda') openNewChooser(route.date);
    else openEventEditor({ day: route.date });
  });
  on('new-event', (el) => openEventEditor({ day: el.dataset.day || route.date }));
  on('new-at', (el) => openEventEditor({ start: el.dataset.start }));
  on('new-task', (el) => openTaskEditor({ prefill: { due: el.dataset.day || today() } }));
  on('new-contact', () => openContactEditor({}));
  on('new-memo', () => openMemoEditor({}));

  on('open-occ', (el) => openEventDetail(el.dataset.id, el.dataset.day));
  on('toggle-task', (el) => toggleTask(el.dataset.id));
  on('edit-task', (el) => openTaskEditor({ id: el.dataset.id }));
  on('open-contact', (el) => openContactDetail(el.dataset.id));
  on('edit-memo', (el) => openMemoEditor({ id: el.dataset.id }));
  on('task-filter', (el) => {
    setTaskMode(el.dataset.mode);
    render();
  });
  on('purge-done', async () => {
    if (!(await confirmDialog(t('tasks.purge'), t('tasks.purgeConfirm'), t('common.delete')))) return;
    commit((s) => (s.tasks = s.tasks.filter((x) => !x.done)), { undoable: true });
    toast(t('tasks.purged'), { action: t('common.undo'), onAction: undo });
  });
  on('az', (el) => document.getElementById('az-' + el.dataset.k)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));

  on('cat-filter', (el) => setSetting('category', el.value));
  on('setting', (el) => {
    setSetting(el.dataset.key, JSON.parse(el.value));
  });
  on('setting-bool', (el) => setSetting(el.dataset.key, el.checked));
  on('cat-color', (el) => commit((s) => (s.categories.find((c) => c.id === el.dataset.id).color = el.value)));
  on('cat-name', (el) => commit((s) => (s.categories.find((c) => c.id === el.dataset.id).name = el.value.trim())));
  on('cat-add', () => {
    const palette = ['#7b3fbf', '#0f8a8a', '#c0392b', '#5d6d7e', '#b7950b', '#1e8449'];
    commit((s) => s.categories.push({ id: uid(), name: t('settings.newCategory'), color: palette[s.categories.length % palette.length] }));
  });
  on('cat-delete', async (el) => {
    const c = state.categories.find((x) => x.id === el.dataset.id);
    if (!(await confirmDialog(t('settings.deleteCategory'), t('settings.deleteCategoryMsg', { name: catName(c) }), t('common.delete')))) return;
    commit((s) => {
      s.categories = s.categories.filter((x) => x.id !== c.id);
      for (const col of ['events', 'tasks', 'contacts', 'memos']) s[col].forEach((x) => x.categoryId === c.id && (x.categoryId = ''));
      if (s.settings.category === c.id) s.settings.category = 'all';
    }, { undoable: true });
    toast(t('settings.categoryDeleted'), { action: t('common.undo'), onAction: undo });
  });
  on('enable-notifications', async () => {
    const r = await requestNotifications();
    toast(r === 'granted' ? t('settings.notifyOn') : t('settings.notifyDenied'));
    render();
  });
  on('export-json', () => download(`agendus-backup-${today()}.json`, exportJSON()));
  on('import-json', () =>
    pickFile('.json,application/json', async (text) => {
      const replace = await confirmDialog(t('settings.restore'), t('settings.restoreConfirm'), t('settings.restoreReplace'), false);
      if (!replace) return;
      try {
        importJSON(text);
        toast(t('settings.restored'), { action: t('common.undo'), onAction: undo });
      } catch {
        toast(t('settings.badFile'));
      }
    })
  );
  on('export-ics', () => download(`agendus-${today()}.ics`, exportICS(), 'text/calendar'));
  on('import-ics', () =>
    pickFile('.ics,text/calendar', (text) => {
      try {
        const r = importICS(text);
        toast(t('settings.importedIcs', { e: r.events, t: r.tasks }), { action: t('common.undo'), onAction: undo });
      } catch {
        toast(t('settings.badFile'));
      }
    })
  );
  on('export-vcf', () => download(`agendus-contacts-${today()}.vcf`, exportVCF(), 'text/vcard'));
  on('import-vcf', () =>
    pickFile('.vcf,text/vcard,text/x-vcard', (text) => {
      try {
        const n = importVCF(text);
        toast(t('settings.importedVcf', { n }), { action: t('common.undo'), onAction: undo });
      } catch {
        toast(t('settings.badFile'));
      }
    })
  );
  on('load-demo', () => {
    seedDemo(t);
    toast(t('settings.demoLoaded'));
  });
  on('erase-all', async () => {
    if (!(await confirmDialog(t('settings.erase'), t('settings.eraseConfirm'), t('settings.erase')))) return;
    eraseAll();
    toast(t('settings.erased'), { action: t('common.undo'), onAction: undo });
  });

  // Form submit (quick add task) and live search inputs.
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form="quick-task"]');
    if (!f) return;
    e.preventDefault();
    const title = f.title.value.trim();
    if (!title) return;
    const cat = state.settings.category;
    upsert('tasks', { title, priority: 3, due: quickTaskDue(), done: false, categoryId: cat !== 'all' && cat !== 'none' ? cat : '', contactIds: [] });
    toast(t('task.added'));
  });
  document.addEventListener('input', (e) => {
    const k = e.target.dataset?.input;
    if (k === 'contact-search') {
      setContactQuery(e.target.value);
      render();
    } else if (k === 'memo-search') {
      setMemoQuery(e.target.value);
      render();
    }
  });
}

// ---------------------------------------------------------------- gestures & keys

function initSwipe() {
  const main = document.getElementById('main');
  let x0 = null, y0 = 0, tm = 0;
  main.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('input,textarea,select,.filters,.chips,.task,.blk-resize')) return (x0 = null);
    x0 = e.touches[0].clientX;
    y0 = e.touches[0].clientY;
    tm = Date.now();
  }, { passive: true });
  main.addEventListener('touchend', (e) => {
    if (x0 == null || !DATED.includes(route.view) || gestureBusy()) return (x0 = null);
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Date.now() - tm > 600 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    step(dx < 0 ? 1 : -1);
  }, { passive: true });
}

function initKeys() {
  document.addEventListener('keydown', (e) => {
    if (sheetOpen() || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input,textarea,select')) return;
    const map = { d: 'day', w: 'week', m: 'month', y: 'year', l: 'list', a: 'agenda' };
    if (map[e.key]) go(map[e.key]);
    else if (e.key === 't') go(DATED.includes(route.view) ? route.view : 'agenda', today());
    else if (e.key === 'ArrowLeft' && DATED.includes(route.view)) step(-1);
    else if (e.key === 'ArrowRight' && DATED.includes(route.view)) step(1);
    else if (e.key === 'n') document.getElementById('fab').click();
    else if (e.key === 'k') openAssistant();
    else if (e.key === '/') {
      e.preventDefault();
      openSearch();
    } else return;
  });
}

// ---------------------------------------------------------------- boot

function onRoute() {
  const r = parseHash();
  if (r.view === 'list' && (route.view !== 'list' || r.date !== route.date)) listView.reset();
  route = r;
  // Slide between dates with the View Transitions API where the browser has it.
  const dir = navDir;
  navDir = 0;
  if (dir && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.dataset.nav = dir > 0 ? 'fwd' : 'back';
    document.startViewTransition(() => render());
  } else render();
}

function boot() {
  configureI18n(state.settings);
  initUI();
  initActions();
  registerActions();
  initSwipe();
  initGestures(document.getElementById('main'), { rerender: render });
  initKeys();
  subscribe(render);
  window.addEventListener('hashchange', onRoute);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  if (!location.hash) history.replaceState(null, '', `#/agenda/${today()}`);
  onRoute();

  // Keep "now" fresh: re-render once a minute when idle, and on day change.
  let lastDay = today();
  setInterval(() => {
    const busy = sheetOpen() || document.activeElement?.closest?.('input,textarea,select');
    if (busy || document.hidden) return;
    if (today() !== lastDay && route.date === lastDay) {
      lastDay = today();
      return go(route.view, lastDay);
    }
    lastDay = today();
    if (['agenda', 'day', 'week'].includes(route.view)) render();
  }, 60000);

  if (!state.welcomed) setTimeout(showWelcome, 300);
  startReminders();
  // Sync: a dot on the Preferences button shows the state; Preferences shows details.
  onSyncStatus((st) => {
    document.getElementById('btn-settings').dataset.sync = st.state;
    if (route.view === 'settings' && !document.activeElement?.closest?.('input')) render();
  });
  initSync();
  // Speech voices load asynchronously; refresh the voice list in Preferences.
  if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', () => route.view === 'settings' && render());

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (navigator.storage?.persist && !isMemoryOnly()) navigator.storage.persist().catch(() => {});
}

boot();
