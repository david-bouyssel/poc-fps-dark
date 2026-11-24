// Tests de sécurité de la pause (T6) sur le câblage réel de src/main.js, DOM factice :
// aucune reprise implicite (blur, visibilitychange, touches, tactile forgé), seules P et
// Échap traitées en pause (les autres gardent leur comportement par défaut), message de
// pause écrit par textContent, blur/visibilitychange répétés sans emballement, aucun son
// joué ni contexte repris pendant la pause, aucun réseau/stockage.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fr } from '../../src/i18n/fr.js';

const translate = (k) => fr[k];

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'sound-toggle-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'replay-button', 'end-new-maze-button',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch',
  'pause-screen', 'pause-message', 'resume-button',
];
const HIDDEN_AT_LOAD = new Set([
  'fps-exit-button', 'sound-toggle-button', 'fps-help', 'fps-goal', 'end-screen',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch', 'pause-screen',
]);
const htmlWrites = [];
const forbiddenCalls = [];

function fake2d() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
}
function makeHost() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, ev) { for (const fn of [...(listeners.get(type) ?? [])]) fn(ev); },
  };
}
function makeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) };
}

const fakeDocument = {
  ...makeHost(), title: '', hidden: false, activeElement: null,
  querySelectorAll: () => [],
  body: { classList: makeClassList() },
};
function makeElement(id) {
  const attrs = new Map();
  const el = {
    ...makeHost(), id, hidden: HIDDEN_AT_LOAD.has(id), value: '', style: {},
    width: 300, height: 150, clientWidth: 0, clientHeight: 0,
    parentElement: { clientWidth: 320, clientHeight: 240 },
    classList: makeClassList(),
    textWrites: 0,
    setAttribute(n, v) { attrs.set(n, String(v)); },
    getAttribute(n) { return attrs.has(n) ? attrs.get(n) : null; },
    focus() { fakeDocument.activeElement = el; }, blur() {},
    getContext() { return fake2d(); },
    insertAdjacentHTML() { htmlWrites.push(`${id}.insertAdjacentHTML`); },
  };
  let text = '';
  Object.defineProperty(el, 'textContent', {
    get() { return text; },
    set(v) { el.textWrites++; text = String(v); },
  });
  for (const prop of ['innerHTML', 'outerHTML']) {
    Object.defineProperty(el, prop, { get() { return ''; }, set() { htmlWrites.push(`${id}.${prop}`); } });
  }
  return el;
}
const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
fakeDocument.getElementById = (id) => elements.get(id) ?? null;
const el = (id) => elements.get(id);

class FakeElement {}
function makeButton(action) {
  const b = new FakeElement();
  b.dataset = { action };
  b.classList = makeClassList();
  b.setPointerCapture = () => {};
  b.closest = (sel) => (sel === '[data-action]' ? b : null);
  return b;
}
function pointer(target, pointerId) {
  return { target, pointerId, prevented: 0, preventDefault() { this.prevented++; } };
}

// Contexte audio factice : compte les sources sonores et les reprises/suspensions.
const contexts = [];
function fakeParam() {
  return new Proxy({}, { get: () => () => {}, set: () => true });
}
class FakeAudioContext {
  constructor() {
    const ctx = {
      currentTime: 0, destination: {}, resumeCalls: 0, suspendCalls: 0, sources: 0,
      resume() { ctx.resumeCalls++; return Promise.resolve(); },
      suspend() { ctx.suspendCalls++; return Promise.resolve(); },
      createOscillator() {
        ctx.sources++;
        const osc = {
          type: null, frequency: fakeParam(), onended: null,
          connect() {}, disconnect() {}, start() {},
          stop() { queueMicrotask(() => { if (typeof osc.onended === 'function') osc.onended(); }); },
        };
        return osc;
      },
      createGain() { return { gain: fakeParam(), connect() {}, disconnect() {} }; },
      createBiquadFilter() {
        return { type: null, Q: fakeParam(), frequency: fakeParam(), connect() {}, disconnect() {} };
      },
    };
    contexts.push(ctx);
    return ctx;
  }
}
const fakeWindow = makeHost();
fakeWindow.AudioContext = FakeAudioContext;
fakeWindow.webkitAudioContext = FakeAudioContext;

const frames = new Map();
let nextFrame = 1;
let clock = 0;
function runFrames(n, stepMs = 50) {
  for (let i = 0; i < n && frames.size > 0; i++) {
    const [[id, cb]] = frames;
    frames.delete(id);
    clock += stepMs;
    if (contexts[0]) contexts[0].currentTime = clock / 1000;
    cb(clock);
  }
}
function key(type, code, extra = {}) {
  const ev = {
    code, key: typeof code === 'string' ? code : '', ctrlKey: false, metaKey: false,
    altKey: false, shiftKey: false, repeat: false, ...extra,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
  };
  fakeWindow.dispatch(type, ev);
  return ev;
}
const setHidden = (hidden) => {
  fakeDocument.hidden = hidden;
  fakeDocument.dispatch('visibilitychange', {});
};
const pauseScreen = () => el('pause-screen');
const paused = () => pauseScreen().hidden === false;
const actionsPad = () => el('touch-pad-actions');

const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Element',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB'];
const saved = {};

describe('sécurité de la pause (T6) dans main.js (DOM factice)', () => {
  before(async () => {
    for (const n of GLOBALS) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);
    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.Element = FakeElement;
    globalThis.requestAnimationFrame = (cb) => { const id = nextFrame++; frames.set(id, cb); return id; };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    for (const n of ['fetch', 'XMLHttpRequest', 'WebSocket']) {
      Object.defineProperty(globalThis, n, {
        configurable: true, writable: true,
        value() { forbiddenCalls.push(n); throw new Error('réseau interdit'); },
      });
    }
    for (const n of ['localStorage', 'sessionStorage', 'indexedDB']) {
      Object.defineProperty(globalThis, n, {
        configurable: true,
        get() { forbiddenCalls.push(n); throw new Error('stockage interdit'); },
      });
    }
    await import('../../src/main.js');
    // Labyrinthe 8 x 8 à graine fixe : manche longue (monstre loin), déterministe.
    el('maze-width').value = '8';
    el('maze-height').value = '8';
    el('maze-seed').value = '7';
    el('maze-form').dispatch('submit', { preventDefault() {} });
    assert.equal(el('maze-error').textContent, '');
  });
  after(() => {
    for (const n of GLOBALS) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n];
    }
  });

  test('vue de dessus : P, blur, visibilitychange et « Reprendre » sans effet', () => {
    assert.equal(key('keydown', 'KeyP').defaultPrevented, false, 'P non bloquée hors FPS');
    fakeWindow.dispatch('blur', {});
    setHidden(true);
    setHidden(false);
    el('resume-button').dispatch('click', {});
    assert.equal(paused(), false, 'aucune pause hors FPS');
    assert.equal(frames.size, 0, 'aucune boucle hors FPS');
    assert.equal(contexts.length, 0, 'aucun contexte audio hors FPS');
  });

  test('P avec Ctrl/Meta/Alt ou en répétition ne met pas en pause', () => {
    el('fps-enter-button').dispatch('click', {});
    assert.equal(frames.size, 1);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      assert.equal(key('keydown', 'KeyP', mod).defaultPrevented, false, JSON.stringify(mod));
    }
    key('keydown', 'KeyP', { repeat: true });
    assert.equal(paused(), false, 'auto-répétition ignorée');
    assert.equal(frames.size, 1);
  });

  test('pause manuelle : boucle arrêtée, sons suspendus, message par textContent', () => {
    const ctx = contexts[0];
    const suspends = ctx.suspendCalls;
    const writes = el('pause-message').textWrites;
    assert.equal(key('keydown', 'KeyP').defaultPrevented, true);
    key('keyup', 'KeyP');
    assert.equal(paused(), true);
    assert.equal(frames.size, 0, 'aucune image en attente en pause');
    assert.ok(ctx.suspendCalls > suspends, 'contexte audio suspendu');
    assert.equal(el('pause-message').textWrites, writes + 1, 'message écrit via textContent');
    assert.equal(el('pause-message').textContent, translate('pause.message'));
    assert.equal(fakeDocument.activeElement, el('resume-button'), 'focus sur « Reprendre »');
  });

  test('en pause : touches de déplacement non bloquées, non maintenues, aucune relance', () => {
    const ctx = contexts[0];
    const resumes = ctx.resumeCalls;
    for (const code of ['KeyW', 'ArrowUp', 'ShiftLeft', 'KeyM', 'Semicolon', 'KeyA', 'KeyD',
      'Tab', 'Enter', 'Space', 'NumpadEnter', 'F5']) {
      assert.equal(key('keydown', code).defaultPrevented, false, `pause : keydown ${code}`);
      assert.equal(key('keyup', code).defaultPrevented, false, `pause : keyup ${code}`);
    }
    for (const code of ['__proto__', 'constructor', 'toString', undefined, null, 42, {}]) {
      assert.doesNotThrow(() => key('keydown', code), String(code));
    }
    key('keydown', 'KeyP', { repeat: true });
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      assert.equal(key('keydown', 'KeyP', mod).defaultPrevented, false, `P + ${JSON.stringify(mod)}`);
    }
    assert.equal(paused(), true, 'toujours en pause');
    assert.equal(frames.size, 0, 'aucune touche ne relance la boucle');
    assert.equal(ctx.resumeCalls, resumes, 'aucune reprise audio');
  });

  test('en pause : blur et visibilitychange répétés ne reprennent jamais', () => {
    const ctx = contexts[0];
    const resumes = ctx.resumeCalls;
    for (let i = 0; i < 50; i++) {
      assert.doesNotThrow(() => fakeWindow.dispatch('blur', {}));
      setHidden(true);
      setHidden(false);
    }
    assert.equal(paused(), true);
    assert.equal(frames.size, 0, 'aucune boucle relancée');
    assert.equal(ctx.resumeCalls, resumes, 'aucune reprise audio implicite');
    assert.equal(el('pause-message').textContent, translate('pause.message'),
      'la première raison (manuelle) est conservée');
  });

  test('en pause : tactile forgé ou bouton autre que pause ignoré', () => {
    const ctx = contexts[0];
    const resumes = ctx.resumeCalls;
    for (const action of ['forward', 'run', 'toggleMap', 'exit', '__proto__', '', 'PAUSE']) {
      const ev = pointer(makeButton(action), 7);
      assert.doesNotThrow(() => actionsPad().dispatch('pointerdown', ev));
      assert.equal(ev.prevented, 0, `pause : ${action} sans preventDefault`);
      actionsPad().dispatch('pointerup', pointer(makeButton(action), 7));
    }
    assert.equal(paused(), true);
    assert.equal(frames.size, 0);
    assert.equal(ctx.resumeCalls, resumes);
  });

  test('aucun son pendant une longue pause', async () => {
    const ctx = contexts[0];
    const before = ctx.sources;
    runFrames(400); // aucune image en attente : rien ne tourne
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(ctx.sources, before, 'aucune source sonore créée en pause');
  });

  test('reprise explicite (« Reprendre ») : une seule boucle, clics répétés sûrs', () => {
    const ctx = contexts[0];
    const resumes = ctx.resumeCalls;
    el('resume-button').dispatch('click', {});
    el('resume-button').dispatch('click', {});
    assert.equal(paused(), false);
    assert.equal(frames.size, 1, 'une seule image en attente');
    assert.equal(ctx.resumeCalls, resumes + 1, 'une seule reprise audio');
    assert.equal(contexts.length, 1, 'pas de second contexte');
  });

  test('perte de focus : pause automatique, message auto, aucune reprise au retour', () => {
    const ctx = contexts[0];
    runFrames(5);
    fakeWindow.dispatch('blur', {});
    assert.equal(paused(), true);
    assert.equal(frames.size, 0);
    assert.equal(el('pause-message').textContent, translate('pause.messageAuto'));
    const resumes = ctx.resumeCalls;
    setHidden(true);
    setHidden(false);
    assert.equal(ctx.resumeCalls, resumes);
    assert.equal(frames.size, 0);
    // Reprise par le bouton tactile pause.
    const ev = pointer(makeButton('pause'), 9);
    actionsPad().dispatch('pointerdown', ev);
    assert.equal(paused(), false);
    assert.equal(frames.size, 1);
  });

  test('page cachée : pause, puis rafale pause/reprise sans emballement', () => {
    setHidden(true);
    assert.equal(paused(), true, 'page cachée = pause');
    assert.equal(frames.size, 0);
    setHidden(false);
    assert.equal(paused(), true, 'retour visible : toujours en pause');
    for (let i = 0; i < 100; i++) {
      key('keydown', 'KeyP');
      key('keyup', 'KeyP');
      assert.ok(frames.size <= 1, 'jamais plus d\'une image en attente');
    }
    assert.equal(paused(), true, '100 bascules depuis la pause : en pause');
    key('keydown', 'KeyP');
    assert.equal(paused(), false);
    assert.equal(frames.size, 1);
    runFrames(5);
    assert.equal(frames.size, 1);
  });

  test('Échap en pause : sortie FPS, pause effacée, plus rien ne reprend', () => {
    key('keydown', 'KeyP');
    assert.equal(paused(), true);
    const ev = key('keydown', 'Escape');
    assert.equal(ev.defaultPrevented, true);
    assert.equal(el('maze-form').hidden, false, 'retour en vue de dessus');
    assert.equal(paused(), false, 'écran de pause masqué');
    assert.equal(frames.size, 0);
    const ctx = contexts[0];
    const resumes = ctx.resumeCalls;
    el('resume-button').dispatch('click', {});
    setHidden(true);
    setHidden(false);
    assert.equal(key('keydown', 'KeyP').defaultPrevented, false);
    assert.equal(frames.size, 0, 'rien ne relance la boucle hors FPS');
    assert.equal(ctx.resumeCalls, resumes, 'aucune reprise audio hors FPS');
  });

  test('aucune écriture HTML dynamique, aucun appel réseau/stockage', () => {
    assert.deepEqual(htmlWrites, []);
    assert.deepEqual(forbiddenCalls, []);
  });
});
