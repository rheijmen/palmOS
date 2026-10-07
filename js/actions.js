// Click delegation: any element with data-act="name" runs the registered handler.
const handlers = new Map();

export function on(name, fn) {
  handlers.set(name, fn);
}

export function initActions() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = handlers.get(el.dataset.act);
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn(el, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (!el) return;
    handlers.get(el.dataset.change)?.(el, e);
  });
}
