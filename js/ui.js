// UI primitives: stacked bottom sheets, toasts with undo, confirm and choice dialogs.
import { esc } from './util.js';
import { icon } from './icons.js';
import { t } from './i18n.js';

const stack = [];
let root;

// History: one entry is pushed while any sheet is open, so the phone's back
// gesture closes the top sheet instead of leaving the app.
let pushed = false;
let pendingBack = false;
const afterBack = [];

export function initUI() {
  root = document.getElementById('sheet-root');
  window.addEventListener('popstate', () => {
    if (pendingBack) {
      pendingBack = false;
      if (stack.length) ensureHistory();
      afterBack.splice(0).forEach((fn) => fn());
      return;
    }
    pushed = false;
    if (stack.length) closeSheet({ fromHistory: true });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && stack.length) closeSheet();
  });
}

function ensureHistory() {
  if (!pushed && !pendingBack) {
    history.pushState({ sheet: 1 }, '');
    pushed = true;
  }
}

// Run fn once any pending history.back() from closing sheets has settled.
export function afterHistory(fn) {
  if (pendingBack) afterBack.push(fn);
  else fn();
}

// Close every sheet, then navigate to a hash route.
export function navigate(hash) {
  closeAllSheets();
  afterHistory(() => {
    if (location.hash !== hash) location.hash = hash;
  });
}

export const sheetOpen = () => stack.length > 0;

// openSheet({ title, body, footer, cls, onMount(el), onClose(), wide })
export function openSheet(opts) {
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <section class="sheet ${opts.cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(opts.title || '')}">
      <header class="sheet-head">
        <h2 class="tab-title">${esc(opts.title || '')}</h2>
        ${opts.headExtra || ''}
        <button class="icon-btn sheet-x" data-close aria-label="${esc(t('common.close'))}">${icon('x')}</button>
      </header>
      <div class="sheet-body">${opts.body || ''}</div>
      ${opts.footer ? `<footer class="sheet-foot">${opts.footer}</footer>` : ''}
    </section>`;
  root.appendChild(el);
  const entry = { el, opts };
  stack.push(entry);
  ensureHistory();
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
  });
  requestAnimationFrame(() => el.classList.add('open'));
  opts.onMount?.(el.querySelector('.sheet'), entry);
  const focusable = el.querySelector('[autofocus]');
  if (focusable && !matchMedia('(pointer: coarse)').matches) focusable.focus();
  return entry;
}

export function closeSheet({ fromHistory = false } = {}) {
  const entry = stack.pop();
  if (!entry) return;
  entry.el.classList.remove('open');
  entry.el.classList.add('closing');
  setTimeout(() => entry.el.remove(), 220);
  entry.opts.onClose?.();
  if (fromHistory) {
    if (stack.length) ensureHistory();
  } else if (!stack.length && pushed) {
    pushed = false;
    pendingBack = true;
    history.back();
  }
}

export function closeAllSheets() {
  while (stack.length) closeSheet();
}

export function replaceSheetBody(entry, html) {
  entry.el.querySelector('.sheet-body').innerHTML = html;
}

let toastTimer;
export function toast(msg, { action, onAction, ms = 4000 } = {}) {
  const el = document.getElementById('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action)}</button>` : ''}`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (action) {
    el.querySelector('.toast-btn').onclick = () => {
      el.classList.remove('show');
      onAction?.();
    };
  }
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// choose({ title, message, options: [{ value, label, danger }] }) -> Promise<value|null>
export function choose({ title, message = '', options }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    openSheet({
      title,
      cls: 'sheet-dialog',
      body: `${message ? `<p class="dialog-msg">${esc(message)}</p>` : ''}
        <div class="dialog-actions">${options
          .map((o, i) => `<button class="btn ${o.danger ? 'btn-danger' : i === 0 ? 'btn-primary' : ''}" data-v="${i}">${esc(o.label)}</button>`)
          .join('')}
          <button class="btn btn-ghost" data-close>${esc(t('common.cancel'))}</button></div>`,
      onMount(el) {
        el.addEventListener('click', (e) => {
          const b = e.target.closest('[data-v]');
          if (!b) return;
          finish(options[Number(b.dataset.v)].value);
          closeSheet();
        });
      },
      onClose: () => finish(null),
    });
  });
}

export async function confirmDialog(title, message, okLabel, danger = true) {
  const v = await choose({ title, message, options: [{ value: true, label: okLabel, danger }] });
  return v === true;
}
