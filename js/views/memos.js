// Memo Pad: plain-text notes, first line is the title.
import { state } from '../store.js';
import { esc, ymd } from '../util.js';
import { t, fmtDate } from '../i18n.js';
import { passesFilter, catColor } from '../query.js';
import { emptyState } from '../components.js';
import { icon } from '../icons.js';

let query = '';
export const setMemoQuery = (q) => (query = q);

export const memoTitle = (m) => (m.text || '').split('\n').find((l) => l.trim())?.trim() || t('memo.untitled');

export const memosView = {
  title: () => t('memos.title'),
  render() {
    const q = query.trim().toLowerCase();
    const list = state.memos
      .filter(passesFilter)
      .filter((m) => !q || (m.text || '').toLowerCase().includes(q))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return `
      <div class="search-line">
        ${icon('search', { size: 18 })}
        <input type="search" data-input="memo-search" value="${esc(query)}" placeholder="${esc(t('memos.search'))}" aria-label="${esc(t('common.search'))}">
      </div>
      ${
        list.length
          ? `<div class="memo-grid">${list
              .map((m) => {
                const lines = (m.text || '').split('\n').filter((l) => l.trim());
                return `<button class="memo-card" data-act="edit-memo" data-id="${m.id}" style="--cat:${catColor(m.categoryId)}">
                  <b>${esc(memoTitle(m))}</b>
                  <span class="memo-prev">${esc(lines.slice(1, 5).join('\n'))}</span>
                  <small>${m.updatedAt ? esc(fmtDate(ymd(new Date(m.updatedAt)))) : ''}</small>
                </button>`;
              })
              .join('')}</div>`
          : emptyState(q ? t('memos.noMatch') : t('memos.empty'), t('memo.new'), 'new-memo')
      }`;
  },
};
