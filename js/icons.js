// SVG icon helpers. UI icons follow the text colour; item icons (the Agendus-style
// icons you attach to appointments and tasks) carry their own colour.
import { ITEM_ICONS, UI_ICONS } from './icons-data.js';

export { ITEM_ICONS };

const svg = (body, cls, size) =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export function icon(name, { size = 20, cls = 'i' } = {}) {
  return svg(UI_ICONS[name] || '', cls, size);
}

export function itemIcon(name, { size = 18, cls = 'ii' } = {}) {
  const ic = ITEM_ICONS[name];
  if (!ic) return '';
  return `<span class="${cls}" style="color:${ic.color}">${svg(ic.svg, '', size)}</span>`;
}
