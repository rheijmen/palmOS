// Contacts list with search and an A-Z index.
import { state } from '../store.js';
import { esc } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { contactName, passesFilter } from '../query.js';
import { contactRow, emptyState } from '../components.js';

let query = '';
export const setContactQuery = (q) => (query = q);

export function sortedContacts() {
  return state.contacts
    .filter(passesFilter)
    .slice()
    .sort((a, b) => contactName(a, { lastFirst: true }).localeCompare(contactName(b, { lastFirst: true }), undefined, { sensitivity: 'base' }));
}

export const contactsView = {
  title: () => t('contacts.title'),
  render() {
    const q = query.trim().toLowerCase();
    const all = sortedContacts();
    const list = q
      ? all.filter((c) => [c.firstName, c.lastName, c.company, ...(c.emails || []), ...(c.phones || []).map((p) => p.value)].some((v) => (v || '').toLowerCase().includes(q)))
      : all;
    const groups = new Map();
    for (const c of list) {
      const L = (contactName(c, { lastFirst: true })[0] || '#').toUpperCase();
      const key = /[A-Z]/.test(L) ? L : '#';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    return `
      <div class="search-line">
        ${icon('search', { size: 18 })}
        <input type="search" data-input="contact-search" value="${esc(query)}" placeholder="${esc(t('contacts.search', { n: all.length }))}" aria-label="${esc(t('common.search'))}">
      </div>
      ${list.length ? `<div class="az">${[...groups.keys()].map((k) => `<a href="#az-${k}" data-act="az" data-k="${k}">${k}</a>`).join('')}</div>` : ''}
      ${
        list.length
          ? [...groups].map(([k, items]) => `<h3 class="letter" id="az-${k}">${k}</h3><div class="list">${items.map((c) => contactRow(c)).join('')}</div>`).join('')
          : emptyState(q ? t('contacts.noMatch') : t('contacts.empty'), t('contact.new'), 'new-contact')
      }`;
  },
};
