// Touch and mouse gestures:
// - Day/Week: long-press an appointment and drag to move it (to another time or,
//   in the week view, another day); drag its bottom edge to change the length;
//   long-press an empty spot and drag to create a new appointment.
// - Month: long-press an appointment and drag it to another day.
// - Tasks: swipe right to complete, swipe left to delete.
// With a mouse every drag starts straight away; on touch screens a long press
// "lifts" the item first, so normal scrolling keeps working.
import { get, remove, undo } from './store.js';
import { HOUR_H } from './views/calendar.js';
import { moveEvent, openEventEditor, toggleTask } from './editors.js';
import { addMinutes, addDays, diffDays } from './util.js';
import { makeOcc } from './query.js';
import { t, fmtTime } from './i18n.js';
import { toast } from './ui.js';

const LONG_PRESS_MS = 320;
const SNAP = 15;
let g = null; // the gesture in progress
let suppressClickUntil = 0;
let lastGestureAt = 0;
let rerender = () => {};

const buzz = (ms = 10) => {
  try {
    navigator.vibrate?.(ms);
  } catch {}
};
const snap = (m) => Math.round(m / SNAP) * SNAP;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// True while a drag runs or right after one, so swipe navigation can stay out of the way.
export const gestureBusy = () => !!g?.dragging || Date.now() - lastGestureAt < 450;

export function initGestures(main, opts = {}) {
  rerender = opts.rerender || rerender;
  main.addEventListener('pointerdown', onDown);
  // Stop the page from scrolling while something is being dragged.
  document.addEventListener('touchmove', (e) => g?.dragging && e.cancelable && e.preventDefault(), { passive: false });
  // The click that follows a drag must not open the item.
  document.addEventListener(
    'click',
    (e) => {
      if (Date.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
  main.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.blk, .mc-it[data-id], .slot, .task')) e.preventDefault();
  });
}

function onDown(e) {
  if (g || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return;
  const target = e.target;
  let mode = null, el = null;
  if ((el = target.closest('.blk-resize'))) mode = 'resize';
  else if ((el = target.closest('.blk[data-start]'))) mode = 'move';
  else if ((el = target.closest('.slot'))) mode = 'create';
  else if ((el = target.closest('.mc-it[data-id]'))) mode = 'month';
  else if ((el = target.closest('.task')) && e.pointerType !== 'mouse') mode = 'swipe';
  if (!mode) return;
  g = { mode, el, id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dragging: false, moved: false };
  if (mode === 'resize' && e.pointerType !== 'mouse') activate();
  else if (e.pointerType !== 'mouse' && mode !== 'swipe') g.timer = setTimeout(activate, LONG_PRESS_MS);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

function onMove(e) {
  if (!g || e.pointerId !== g.id) return;
  g.x = e.clientX;
  g.y = e.clientY;
  const dx = g.x - g.x0, dy = g.y - g.y0;
  if (!g.dragging) {
    if (g.mode === 'swipe') {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) startSwipe();
      else if (Math.abs(dy) > 10) return end();
      if (!g?.dragging) return;
    } else if (g.type === 'mouse') {
      if (Math.hypot(dx, dy) < 4) return;
      activate();
    } else {
      // Moving before the long press completes means the user is scrolling.
      if (Math.hypot(dx, dy) > 8) end();
      return;
    }
  }
  if (Math.hypot(dx, dy) > 3) g.moved = true;
  e.preventDefault();
  update();
}

function onUp(e) {
  if (!g || e.pointerId !== g.id) return;
  if (g.dragging) {
    suppressClickUntil = Date.now() + 400;
    finish();
  }
  end();
}

function onCancel(e) {
  if (!g || e.pointerId !== g.id) return;
  if (g.dragging) rerender();
  end();
}

function end() {
  if (!g) return;
  clearTimeout(g.timer);
  cancelAnimationFrame(g.raf);
  if (g.dragging) lastGestureAt = Date.now();
  document.documentElement.classList.remove('is-dragging');
  g.ghost?.remove();
  g.badge?.remove();
  g = null;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
}

// ---------------------------------------------------------------- start

function activate() {
  if (!g || g.dragging) return;
  g.dragging = true;
  buzz();
  document.documentElement.classList.add('is-dragging');
  if (g.mode === 'month') return startMonth();
  const blk = g.mode === 'create' ? null : g.el.closest('.blk');
  const grid = g.el.closest('.timegrid');
  g.grid = grid;
  g.h0 = Number(grid.dataset.scrollTo) || 0;
  g.h1 = g.h0 + grid.querySelectorAll('.hour-label').length;
  g.ax = g.x;
  g.ay = g.y;
  g.col = g.el.closest('.tg-col');
  if (g.mode === 'create') {
    g.startMin = Math.floor(minutesAt(g.col, g.y0) / SNAP) * SNAP;
    g.ghost = document.createElement('div');
    g.ghost.className = 'blk ghost';
    g.col.appendChild(g.ghost);
  } else {
    g.blk = blk;
    g.start = blk.dataset.start;
    g.dur = Number(blk.dataset.dur);
    g.startMin = minutesOfLocal(g.start);
    // Keep the item (or its bottom edge, when resizing) where the finger grabbed it.
    g.grabOffset = minutesAt(g.col, g.y0) - (g.mode === 'resize' ? g.startMin + g.dur : g.startMin);
    blk.classList.add('lifted');
  }
  g.badge = document.createElement('span');
  g.badge.className = 'drag-badge';
  (g.blk || g.ghost).appendChild(g.badge);
  update();
  autoScroll();
}

function minutesOfLocal(local) {
  const [h, m] = local.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
}

// Minutes since midnight at a screen Y position inside a day column.
function minutesAt(col, y) {
  const r = col.getBoundingClientRect();
  return g.h0 * 60 + ((y - r.top) / HOUR_H) * 60;
}

function colAt(x) {
  const cols = [...g.grid.querySelectorAll('.tg-col')];
  let best = cols[0], dist = Infinity;
  for (const c of cols) {
    const r = c.getBoundingClientRect();
    const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    if (d < dist) {
      dist = d;
      best = c;
    }
  }
  return best;
}

const topFor = (min) => ((min - g.h0 * 60) / 60) * HOUR_H;

// ---------------------------------------------------------------- update

function update() {
  if (!g?.dragging) return;
  if (g.mode === 'swipe') return updateSwipe();
  if (g.mode === 'month') return updateMonth();
  if (g.mode === 'move') {
    const col = colAt(g.x);
    const startMin = clamp(snap(minutesAt(col, g.y) - g.grabOffset), g.h0 * 60, Math.max(g.h0 * 60, g.h1 * 60 - Math.min(g.dur, 60)));
    if (col !== g.blk.parentElement) {
      col.appendChild(g.blk);
      g.blk.style.left = '1px';
      g.blk.style.width = 'calc(100% - 3px)';
    }
    g.newDay = col.dataset.day;
    g.newStartMin = startMin;
    g.blk.style.top = `${topFor(startMin)}px`;
    g.badge.textContent = `${fmtTime(`${g.newDay}T${hhmm(startMin)}`)}`;
  } else if (g.mode === 'resize') {
    const endMin = clamp(snap(minutesAt(g.col, g.y) - g.grabOffset), g.startMin + SNAP, Math.max(g.startMin + SNAP, g.h1 * 60));
    g.newDur = endMin - g.startMin;
    g.blk.style.height = `${(g.newDur / 60) * HOUR_H - 2}px`;
    g.badge.textContent = `${fmtTime(g.start)} – ${fmtTime(addMinutes(g.start, g.newDur))}`;
  } else if (g.mode === 'create') {
    const cur = minutesAt(g.col, g.y);
    const a = Math.min(g.startMin, Math.floor(cur / SNAP) * SNAP);
    const b = Math.max(g.startMin + SNAP, Math.ceil(cur / SNAP) * SNAP);
    g.range = [clamp(a, g.h0 * 60, g.h1 * 60 - SNAP), clamp(b, g.h0 * 60 + SNAP, g.h1 * 60)];
    g.ghost.style.top = `${topFor(g.range[0])}px`;
    g.ghost.style.height = `${((g.range[1] - g.range[0]) / 60) * HOUR_H - 2}px`;
    const day = g.col.dataset.day;
    g.badge.textContent = `${fmtTime(`${day}T${hhmm(g.range[0])}`)} – ${fmtTime(`${day}T${hhmm(g.range[1] % 1440)}`)}`;
  }
}

// Scroll the time grid when dragging near its top or bottom edge.
function autoScroll() {
  if (!g?.dragging || !g.grid) return;
  const r = g.grid.getBoundingClientRect();
  const edge = 48;
  let v = 0;
  // Only once the finger has actually travelled, so grabbing an item near the edge doesn't scroll.
  if (Math.hypot(g.x - g.ax, g.y - g.ay) < 16) {
    g.raf = requestAnimationFrame(autoScroll);
    return;
  }
  if (g.y < r.top + edge) v = -Math.ceil((r.top + edge - g.y) / 6);
  else if (g.y > r.bottom - edge) v = Math.ceil((g.y - (r.bottom - edge)) / 6);
  if (v) {
    g.grid.scrollTop += v;
    update();
  }
  g.raf = requestAnimationFrame(autoScroll);
}

// ---------------------------------------------------------------- finish

function finish() {
  const mode = g.mode;
  if (mode === 'swipe') return finishSwipe();
  if (mode === 'month') return finishMonth();
  if (mode === 'create') {
    const day = g.col.dataset.day;
    const [a, b] = g.range || [g.startMin, g.startMin + 60];
    const start = `${day}T${hhmm(a)}`;
    const endLocal = b >= 1440 ? `${addDays(day, 1)}T00:00` : `${day}T${hhmm(b)}`;
    buzz();
    setTimeout(() => openEventEditor({ prefill: { start, end: endLocal } }), 10);
    return;
  }
  const ev = get('events', g.blk.dataset.id);
  const occDay = g.blk.dataset.day;
  if (!ev) return rerender();
  let start = g.start, dur = g.dur;
  if (mode === 'move') start = `${g.newDay}T${hhmm(g.newStartMin)}`;
  if (mode === 'resize') dur = g.newDur;
  if (start === g.start && dur === g.dur) return rerender();
  buzz();
  moveEvent(ev, occDay, start, addMinutes(start, dur)).then((ok) => !ok && rerender());
}

// ---------------------------------------------------------------- month

function startMonth() {
  const r = g.el.getBoundingClientRect();
  g.ghost = g.el.cloneNode(true);
  g.ghost.className += ' month-ghost';
  Object.assign(g.ghost.style, { width: `${Math.max(r.width, 90)}px`, left: `${r.left}px`, top: `${r.top}px` });
  g.offX = g.x0 - r.left;
  g.offY = g.y0 - r.top;
  document.body.appendChild(g.ghost);
  g.el.classList.add('lifted');
  updateMonth();
}

function updateMonth() {
  g.ghost.style.transform = `translate(${g.x - g.offX - parseFloat(g.ghost.style.left)}px, ${g.y - g.offY - parseFloat(g.ghost.style.top)}px)`;
  const cell = document.elementFromPoint(g.x, g.y)?.closest('.mc');
  if (cell !== g.overCell) {
    g.overCell?.classList.remove('drop-target');
    cell?.classList.add('drop-target');
    g.overCell = cell;
  }
}

function finishMonth() {
  const cell = g.overCell;
  cell?.classList.remove('drop-target');
  g.el.classList.remove('lifted');
  const ev = get('events', g.el.dataset.id);
  const occDay = g.el.dataset.day;
  const target = cell?.dataset.day;
  if (!ev || !target || target === occDay) return rerender();
  // Shift this occurrence by whole days, keeping its times and length.
  const o = makeOcc(ev, occDay);
  const shift = diffDays(occDay, target);
  const move = (v) => addDays(v.slice(0, 10), shift) + v.slice(10);
  buzz();
  moveEvent(ev, occDay, move(o.start), move(o.end)).then((ok) => !ok && rerender());
}

// ---------------------------------------------------------------- task swipe

function startSwipe() {
  g.dragging = true;
  const row = g.el;
  const list = row.parentElement;
  if (getComputedStyle(list).position === 'static') list.style.position = 'relative';
  g.bg = document.createElement('div');
  g.bg.className = 'swipe-bg';
  Object.assign(g.bg.style, { top: `${row.offsetTop}px`, height: `${row.offsetHeight}px` });
  const done = row.classList.contains('is-done');
  g.bg.innerHTML = `<span class="sw-done">${t(done ? 'swipe.reopen' : 'swipe.done')}</span><span class="sw-del">${t('common.delete')}</span>`;
  list.insertBefore(g.bg, row);
  g.ghost = g.bg;
  row.classList.add('swiping');
  g.width = row.offsetWidth;
}

function updateSwipe() {
  const dx = g.x - g.x0;
  const th = Math.max(80, g.width * 0.3);
  g.el.style.transform = `translateX(${dx}px)`;
  g.bg.classList.toggle('right', dx > 0);
  g.bg.classList.toggle('left', dx < 0);
  const armed = Math.abs(dx) > th;
  if (armed !== g.armed) {
    g.armed = armed;
    g.bg.classList.toggle('armed', armed);
    if (armed) buzz(6);
  }
}

function finishSwipe() {
  const row = g.el;
  const dx = g.x - g.x0;
  const id = row.querySelector('[data-act=toggle-task]')?.dataset.id;
  const bg = g.bg;
  g.ghost = null; // keep the background while the row animates
  row.classList.remove('swiping');
  if (g.armed && id) {
    row.style.transform = `translateX(${dx > 0 ? '110%' : '-110%'})`;
    setTimeout(() => {
      bg.remove();
      if (dx > 0) toggleTask(id);
      else {
        remove('tasks', id);
        toast(t('task.deleted'), { action: t('common.undo'), onAction: undo });
      }
    }, 180);
  } else {
    row.style.transform = '';
    setTimeout(() => bg.remove(), 220);
  }
}
