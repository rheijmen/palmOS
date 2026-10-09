// The assistant's face, in the Agendus 2007 style: a glossy LCD with a light that
// sweeps across while it thinks and a three-column voice box that lights up while
// it talks (a nod to the talking cars of 1980s TV), speech bubbles and one big
// Talk button. Plus the slim proactive strip at the top of the Agenda.
import { state } from '../store.js';
import { esc } from '../util.js';
import { t } from '../i18n.js';
import { icon } from '../icons.js';
import { openSheet } from '../ui.js';
import { talk, hasAI, undoAssistant, AIError } from './assistant.js';
import { computeInsights } from './insights.js';
import { listen, stopListening, canListen, speak, stopSpeaking, isSpeaking, voiceBox, animateVoiceBox, onSpeakingChange } from './voice.js';

const aiName = () => state.settings.aiName || 'Pilot';

function actionChip(a) {
  if (a.href) return `<a class="pilot-chip" href="${esc(a.href)}" ${a.href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${esc(a.label)}</a>`;
  const data = Object.entries(a.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
  return `<button class="pilot-chip" data-act="${a.act}" ${data}>${esc(a.label)}</button>`;
}

function effectChip(e) {
  if (e.kind === 'link') return actionChip({ href: e.href, label: e.label });
  if (e.kind === 'event') return actionChip({ act: 'open-occ', data: { id: e.id, day: e.day }, label: `${t('ai.open')}: ${e.label}` });
  if (e.kind === 'task') return actionChip({ act: 'edit-task', data: { id: e.id }, label: `${t('ai.open')}: ${e.label}` });
  if (e.kind === 'memo') return actionChip({ act: 'edit-memo', data: { id: e.id }, label: `${t('ai.open')}: ${e.label}` });
  if (e.kind === 'contact') return actionChip({ act: 'open-contact', data: { id: e.id }, label: `${t('ai.open')}: ${e.label}` });
  if (e.kind === 'settings') return actionChip({ act: 'goto-settings', label: e.label });
  return '';
}

// ---------------------------------------------------------------- agenda strip

export function assistantStrip() {
  if (!state.settings.aiProactive) return '';
  const top = computeInsights()[0];
  return `<div class="pilot-strip ${top ? 'has-news' : ''}">
    <button class="ks-main" data-act="ai-open" aria-label="${esc(t('ai.talkTo', { name: aiName() }))}">
      <span class="ks-scanner" aria-hidden="true"><i></i></span>
      <span class="ks-text">${top ? esc(top.text) : esc(t('ai.standby', { name: aiName() }))}</span>
    </button>
    ${top ? `<span class="ks-actions">${top.actions.slice(0, 2).map(actionChip).join('')}<button class="pilot-chip ghost" data-act="ai-dismiss" data-id="${esc(top.id)}" aria-label="${esc(t('ai.dismiss'))}">${icon('x', { size: 14 })}</button></span>` : ''}
    <button class="ks-mic" data-act="ai-listen" aria-label="${esc(t('ai.speak'))}">${icon('mic', { size: 18 })}</button>
  </div>`;
}

// ---------------------------------------------------------------- dashboard

let open = null; // state of the open panel

export function openAssistant({ listenNow = false, prompt = '' } = {}) {
  if (open) return;
  const chips = [
    ['ai.chip.next', 'ai.chip.nextPrompt'],
    ['ai.chip.brief', 'ai.chip.briefPrompt'],
    ['ai.chip.tomorrow', 'ai.chip.tomorrowPrompt'],
    ['ai.chip.task', null],
  ];
  const entry = openSheet({
    title: aiName(),
    cls: 'sheet-pilot sheet-tall',
    body: `<div class="pilot">
      <div class="pilot-lcd">
        <span class="pilot-sweep" aria-hidden="true"></span>
        ${voiceBox()}
        <div class="pilot-readout"><b>${esc(aiName())}</b><span class="pilot-status" aria-live="polite"></span></div>
      </div>
      <div class="pilot-log" role="log"></div>
      <div class="pilot-suggest">${chips.map(([l, p]) => `<button class="pilot-chip" data-k-chip="${p ? esc(t(p)) : ''}">${esc(t(l))}</button>`).join('')}</div>
      <button class="pilot-mic ${canListen() ? '' : 'hidden'}" type="button" aria-label="${esc(t('ai.speak'))}"><span class="km-ring"></span>${icon('mic', { size: 26 })}<b>${esc(t('ai.talk'))}</b></button>
      <form class="pilot-input">
        <input name="q" autocomplete="off" enterkeyhint="send" placeholder="${esc(canListen() ? t('ai.placeholderMic') : t('ai.placeholder'))}" aria-label="${esc(t('ai.placeholder'))}">
        <button type="submit" class="pilot-send" aria-label="${esc(t('ai.send'))}">${icon('arrow-right', { size: 20 })}</button>
      </form>
    </div>`,
    onMount(el) {
      const root = el.querySelector('.pilot');
      const log = root.querySelector('.pilot-log');
      const status = root.querySelector('.pilot-status');
      const input = root.querySelector('input[name=q]');
      const mic = root.querySelector('.pilot-mic');
      open = { root, mode: 'idle', listening: false, busy: false };
      const setStatus = (key, extra = '') => {
        status.textContent = t(key || (hasAI() ? 'ai.status.ready' : 'ai.status.offline')) + extra;
        root.dataset.mode = open.listening ? 'listening' : open.busy ? 'thinking' : isSpeaking() ? 'speaking' : 'idle';
      };
      const stopAnim = animateVoiceBox(root.querySelector('.voice-box'), () => (open?.listening ? 'listening' : isSpeaking() ? 'speaking' : open?.busy ? 'thinking' : 'idle'));
      const offSpeak = onSpeakingChange(() => setStatus(isSpeaking() ? 'ai.status.speaking' : ''));
      open.cleanup = () => {
        stopAnim();
        offSpeak();
        stopListening();
        stopSpeaking();
      };

      const add = (who, html) => {
        log.insertAdjacentHTML('beforeend', `<div class="kl ${who}">${html}</div>`);
        log.scrollTop = log.scrollHeight;
      };

      async function send(text) {
        text = text.trim();
        if (!text || open.busy) return;
        input.value = '';
        stopSpeaking();
        add('me', esc(text));
        open.busy = true;
        setStatus('ai.status.thinking');
        try {
          const r = await talk(text, { onStep: () => setStatus('ai.status.working') });
          const chipsHtml = [...(r.effects || []).map(effectChip), r.changed ? `<button class="pilot-chip warn" data-k-undo>${esc(t('common.undo'))}</button>` : ''].join('');
          add('ai', `<p>${esc(r.text)}</p>${chipsHtml ? `<div class="kl-chips">${chipsHtml}</div>` : ''}${r.local && !hasAI() ? `<small class="kl-note">${esc(t('ai.localNote'))}</small>` : ''}`);
          open.busy = false;
          setStatus('');
          speak(r.text);
        } catch (e) {
          open.busy = false;
          const code = e instanceof AIError ? e.code : 'other';
          add('ai err', `<p>${esc(t('ai.error.' + (['auth', 'rate', 'network', 'bad', 'api'].includes(code) ? code : 'other')))}</p>${code === 'auth' ? `<div class="kl-chips">${effectChip({ kind: 'settings', label: t('ai.connect') })}</div>` : ''}`);
          setStatus('');
        }
      }

      function startListening() {
        if (!canListen() || open.listening) return;
        stopSpeaking();
        open.listening = true;
        mic.classList.add('on');
        setStatus('ai.status.listening');
        listen({
          onPartial: (txt) => (input.value = txt),
          onFinal: (txt) => send(txt),
          onError: (err) => err === 'not-allowed' && add('ai err', `<p>${esc(t('ai.error.mic'))}</p>`),
          onEnd: () => {
            if (!open) return;
            open.listening = false;
            mic.classList.remove('on');
            if (!open.busy) setStatus('');
          },
        });
      }

      mic.addEventListener('click', () => (open.listening ? stopListening() : startListening()));
      root.querySelector('.pilot-input').addEventListener('submit', (e) => {
        e.preventDefault();
        send(input.value);
      });
      root.addEventListener('click', (e) => {
        const chip = e.target.closest('[data-k-chip]');
        if (chip) {
          if (chip.dataset.kChip) send(chip.dataset.kChip);
          else {
            input.value = t('ai.chip.taskPrefix');
            input.focus();
          }
          return;
        }
        const u = e.target.closest('[data-k-undo]');
        if (u) {
          undoAssistant();
          u.replaceWith(Object.assign(document.createElement('span'), { className: 'pilot-chip done', textContent: t('ai.undone') }));
        }
      });

      // Opening words: the most useful insights, or a short greeting.
      const ins = state.settings.aiProactive ? computeInsights().slice(0, 3) : [];
      const greet = ins.length ? t('ai.greetNews', { n: ins.length }) : t('ai.greet', { name: aiName() });
      add('ai', `<p>${esc(greet)}</p>${ins.map((x) => `<div class="kl-insight"><p>${esc(x.text)}</p>${x.actions.length ? `<div class="kl-chips">${x.actions.map(actionChip).join('')}</div>` : ''}</div>`).join('')}${!hasAI() ? `<small class="kl-note">${esc(t('ai.localNote'))}</small>` : ''}`);
      setStatus('');
      if (prompt) send(prompt);
      else if (listenNow) startListening();
      // Opening the panel is a tap, so the browser lets us speak: say the news.
      else speak([greet, ...ins.map((x) => x.text)].join(' '));
    },
    onClose() {
      open?.cleanup?.();
      open = null;
    },
  });
  return entry;
}
