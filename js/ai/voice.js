// Voice in and out, using the browser's own speech engines (no audio leaves the
// device except what the browser's recognizer itself sends; Chrome uses Google's
// service, Safari uses Apple's). Also drives the voice-box animation.
import { state } from '../store.js';
import { t } from '../i18n.js';

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = () => !!Recognition;
export const canSpeak = () => 'speechSynthesis' in window;

const speechLang = () => (t.lang() === 'nl' ? 'nl-NL' : t.locale().startsWith('en') ? t.locale() : 'en-GB');

// ---------------------------------------------------------------- listening

let rec = null;
// listen({ onPartial(text), onFinal(text), onEnd() }) -> stop()
export function listen({ onPartial, onFinal, onEnd, onError } = {}) {
  if (!Recognition) return () => {};
  stopSpeaking();
  stopListening();
  rec = new Recognition();
  rec.lang = speechLang();
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript;
      else interim += r[0].transcript;
    }
    onPartial?.((finalText + interim).trim());
  };
  rec.onerror = (e) => onError?.(e.error);
  rec.onend = () => {
    rec = null;
    if (finalText.trim()) onFinal?.(finalText.trim());
    onEnd?.();
  };
  try {
    rec.start();
  } catch {
    onEnd?.();
  }
  return stopListening;
}

export function stopListening() {
  try {
    rec?.stop();
  } catch {}
}

// ---------------------------------------------------------------- speaking

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const wanted = state.settings.aiVoice;
  if (wanted) {
    const v = voices.find((x) => x.voiceURI === wanted);
    if (v) return v;
  }
  const lang = speechLang().slice(0, 2);
  const mine = voices.filter((v) => v.lang.toLowerCase().startsWith(lang));
  // Prefer calm, deeper voices when the platform offers them.
  const prefer = ['daniel', 'arthur', 'google uk english male', 'microsoft ryan', 'microsoft guy', 'alex', 'xander', 'microsoft maarten', 'google nederlands'];
  for (const p of prefer) {
    const v = mine.find((x) => x.name.toLowerCase().includes(p));
    if (v) return v;
  }
  return mine.find((v) => v.localService) || mine[0] || null;
}

export function voicesForLanguage() {
  if (!canSpeak()) return [];
  const lang = speechLang().slice(0, 2);
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
}

const speakListeners = new Set();
export const onSpeakingChange = (fn) => (speakListeners.add(fn), () => speakListeners.delete(fn));
let speaking = false;
function setSpeaking(v) {
  speaking = v;
  speakListeners.forEach((fn) => fn(v));
}
export const isSpeaking = () => speaking;

let wordPulse = 0;
export const takePulse = () => {
  const p = wordPulse;
  wordPulse *= 0.82;
  return p;
};

// Speak text aloud. Resolves when finished (or immediately if speech is off/unavailable).
export function speak(text, { force = false } = {}) {
  if (!canSpeak() || (!force && !state.settings.aiSpeak) || !text) return Promise.resolve();
  stopSpeaking();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''));
    u.lang = speechLang();
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.02;
    u.pitch = 0.92;
    u.onstart = () => setSpeaking(true);
    u.onboundary = () => (wordPulse = 1);
    const done = () => {
      setSpeaking(false);
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    speechSynthesis.speak(u);
    // Some browsers never fire onstart for blocked speech; don't hang.
    setTimeout(() => !speaking && !speechSynthesis.speaking && done(), 4000);
  });
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel();
  if (speaking) setSpeaking(false);
}

// ---------------------------------------------------------------- voice box

// The voice box: three columns of red segments, the middle one taller, lit from the
// centre outwards with the rhythm of speech (or a gentle idle shimmer while listening).
export function voiceBox() {
  const col = (n) => `<span class="vb-col" style="--n:${n}">${'<i></i>'.repeat(n)}</span>`;
  return `<div class="voice-box" aria-hidden="true">${col(7)}${col(11)}${col(7)}</div>`;
}

export function animateVoiceBox(el, getMode) {
  const cols = [...el.querySelectorAll('.vb-col')];
  let raf, level = [0, 0, 0], tm = 0;
  const frame = () => {
    tm += 1;
    const mode = getMode();
    const pulse = takePulse();
    for (let c = 0; c < cols.length; c++) {
      let target = 0;
      if (mode === 'speaking') target = 0.25 + 0.55 * pulse + 0.25 * Math.abs(Math.sin(tm / (5 + c * 2)));
      else if (mode === 'listening') target = 0.12 + 0.12 * Math.abs(Math.sin(tm / (7 + c)));
      else if (mode === 'thinking') target = 0.08 + 0.06 * Math.abs(Math.sin(tm / 10));
      if (c !== 1) target *= 0.78;
      level[c] += (target - level[c]) * 0.35;
      const segs = cols[c].children;
      const n = segs.length, mid = (n - 1) / 2;
      const lit = level[c] * (n / 2 + 0.5);
      for (let i = 0; i < n; i++) segs[i].classList.toggle('on', Math.abs(i - mid) < lit);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
