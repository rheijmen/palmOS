// Preferences, categories and data management.
import { state, isMemoryOnly } from '../store.js';
import { esc } from '../util.js';
import { t, fmtHour } from '../i18n.js';
import { icon } from '../icons.js';
import { catName } from '../query.js';
import { fmtAlarm } from '../i18n.js';

const ALARMS = [null, 0, 5, 10, 15, 30, 60];
const sel = (key, options, cur) =>
  `<select data-change="setting" data-key="${key}">${options.map(([v, l]) => `<option value="${esc(JSON.stringify(v))}" ${JSON.stringify(v) === JSON.stringify(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const pref = (label, control, hint = '') => `<div class="pref"><span class="pref-label">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span>${control}</div>`;
const toggle = (key, cur) => `<label class="tgl"><input type="checkbox" data-change="setting-bool" data-key="${key}" ${cur ? 'checked' : ''}><span data-on="${esc(t('common.on'))}" data-off="${esc(t('common.off'))}"></span></label>`;

export const settingsView = {
  title: () => t('settings.title'),
  render() {
    const s = state.settings;
    const hours = Array.from({ length: 24 }, (_, h) => [h, fmtHour(h)]);
    const notif = 'Notification' in window ? Notification.permission : 'unsupported';
    return `
      <div class="settings">
        <h3 class="section-head"><span>${esc(t('settings.general'))}</span></h3>
        <div class="card">
          ${pref(t('settings.language'), sel('lang', [['auto', t('settings.auto')], ['en', 'English'], ['nl', 'Nederlands']], s.lang))}
          ${pref(t('settings.theme'), sel('theme', [['auto', t('settings.themeAuto')], ['light', t('settings.themeLight')], ['dark', t('settings.themeDark')], ['modern', t('settings.themeModern')], ['classic', t('settings.themeClassic')]], s.theme))}
          ${pref(t('settings.weekStart'), sel('weekStart', [[1, t('settings.monday')], [0, t('settings.sunday')], [6, t('settings.saturday')]], s.weekStart))}
          ${pref(t('settings.timeFormat'), sel('hour12', [['auto', t('settings.auto')], [false, '13:00'], [true, '1:00 PM']], s.hour12))}
        </div>

        <h3 class="section-head"><span>${esc(t('settings.calendar'))}</span></h3>
        <div class="card">
          ${pref(t('settings.dayStart'), sel('dayStart', hours.slice(0, 13), s.dayStart))}
          ${pref(t('settings.dayEnd'), sel('dayEnd', hours.slice(12).concat([[24, fmtHour(0)]]), s.dayEnd))}
          ${pref(t('settings.duration'), sel('defaultDuration', [15, 30, 45, 60, 90, 120].map((m) => [m, t('alarm.minutesPlain', { n: m })]), s.defaultDuration))}
          ${pref(t('settings.defaultAlarm'), sel('defaultAlarm', ALARMS.map((a) => [a, fmtAlarm(a)]), s.defaultAlarm))}
          ${pref(t('settings.monthText'), toggle('monthText', s.monthText))}
          ${pref(t('settings.agendaDays'), sel('agendaDays', [3, 7, 14, 30].map((n) => [n, t('settings.nDays', { n })]), s.agendaDays))}
          ${pref(t('settings.undatedInAgenda'), toggle('showUndatedInAgenda', s.showUndatedInAgenda))}
          ${pref(t('settings.doneInAgenda'), toggle('showDoneInAgenda', s.showDoneInAgenda))}
        </div>

        <h3 class="section-head"><span>${esc(t('settings.notifications'))}</span></h3>
        <div class="card">
          ${pref(
            t('settings.notifyStatus'),
            notif === 'granted'
              ? `<span class="ok-text">${icon('circle-check', { size: 16 })} ${esc(t('settings.notifyOn'))}</span>`
              : notif === 'unsupported'
                ? `<span class="muted">${esc(t('settings.notifyUnsupported'))}</span>`
                : `<button class="btn btn-small" data-act="enable-notifications">${icon('bell', { size: 16 })} ${esc(t('settings.notifyEnable'))}</button>`,
            t('settings.notifyHint')
          )}
        </div>

        <h3 class="section-head"><span>${esc(t('settings.categories'))}</span></h3>
        <div class="card cats">
          ${state.categories
            .map(
              (c) => `<div class="cat-row">
                <input type="color" value="${esc(c.color)}" data-change="cat-color" data-id="${c.id}" aria-label="${esc(t('settings.color'))}">
                <input value="${esc(catName(c))}" data-change="cat-name" data-id="${c.id}" aria-label="${esc(t('settings.categoryName'))}">
                <button class="icon-btn" data-act="cat-delete" data-id="${c.id}" aria-label="${esc(t('common.delete'))}">${icon('trash-2', { size: 16 })}</button>
              </div>`
            )
            .join('')}
          <button class="link-btn" data-act="cat-add">${icon('plus', { size: 14 })} ${esc(t('settings.addCategory'))}</button>
        </div>

        <h3 class="section-head"><span>${esc(t('settings.data'))}</span></h3>
        <div class="card">
          ${isMemoryOnly() ? `<p class="warn">${esc(t('settings.memoryOnly'))}</p>` : `<p class="muted small">${esc(t('settings.localNote'))}</p>`}
          <div class="btn-grid">
            <button class="btn" data-act="export-json">${icon('download', { size: 16 })} ${esc(t('settings.backup'))}</button>
            <button class="btn" data-act="import-json">${icon('upload', { size: 16 })} ${esc(t('settings.restore'))}</button>
            <button class="btn" data-act="export-ics">${icon('calendar', { size: 16 })} ${esc(t('settings.exportIcs'))}</button>
            <button class="btn" data-act="import-ics">${icon('calendar', { size: 16 })} ${esc(t('settings.importIcs'))}</button>
            <button class="btn" data-act="export-vcf">${icon('contact', { size: 16 })} ${esc(t('settings.exportVcf'))}</button>
            <button class="btn" data-act="import-vcf">${icon('contact', { size: 16 })} ${esc(t('settings.importVcf'))}</button>
          </div>
          <div class="btn-grid">
            <button class="btn" data-act="load-demo">${icon('star', { size: 16 })} ${esc(t('settings.demo'))}</button>
            <button class="btn btn-danger" data-act="erase-all">${icon('trash-2', { size: 16 })} ${esc(t('settings.erase'))}</button>
          </div>
        </div>

        <p class="about">${esc(t('settings.about'))}<br><small>${esc(t('settings.stats', { e: state.events.length, t: state.tasks.length, c: state.contacts.length, m: state.memos.length }))}</small></p>
      </div>`;
  },
};
