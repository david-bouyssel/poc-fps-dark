// Couper le son (T9, plan docs/design/couper-son.md, section Tests 6) sur le câblage réel
// de src/main.js, avec un DOM factice (aucune dépendance) : bouton caché hors FPS et visible
// en FPS, clic et touche X qui basculent libellé et aria-pressed, X en pause et sur l'écran
// de fin, état conservé entre vues et après « Rejouer », aucun stockage ni réseau.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fr } from '../../src/i18n/fr.js';

const translate = (k) => fr[k];

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'maze-difficulty', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'sound-toggle-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'end-stat-time', 'end-stat-explored', 'end-stat-distance', 'replay-button', 'end-new-maze-button',
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
class FakeElement {}

function makeElement(id) {
  const attrs = new Map();
  const el = {
    ...makeHost(), id, hidden: HIDDEN_AT_LOAD.has(id), value: '', style: {},
    width: 300, height: 150, clientWidth: 0, clientHeight: 0,
    parentElement: { clientWidth: 320, clientHeight: 240 },
    classList: makeClassList(),
    textContent: '',
    setAttribute(n, v) { attrs.set(n, String(v)); },
    getAttribute(n) { return attrs.has(n) ? attrs.get(n) : null; },
    focus() { fakeDocument.activeElement = el; }, blur() {},
    getContext() { return fake2d(); },
    insertAdjacentHTML() { htmlWrites.push(`${id}.insertAdjacentHTML`); },
  };
  // Rendu initial de index.html : libellé et aria-pressed du bouton de son.
  if (id === 'sound-toggle-button') {
    el.textContent = translate('sound.mute');
    el.setAttribute('aria-pressed', 'false');
  }
  for (const prop of ['innerHTML', 'outerHTML']) {
    Object.defineProperty(el, prop, { get() { return ''; }, set() { htmlWrites.push(`${id}.${prop}`); } });
  }
  return el;
}
const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
elements.get('maze-difficulty').value = 'normal';
fakeDocument.getElementById = (id) => elements.get(id) ?? null;
const el = (id) => elements.get(id);
const soundButton = () => el('sound-toggle-button');
const label = () => soundButton().textContent;
const muted = () => label() === translate('sound.unmute');
const pressed = () => soundButton().getAttribute('aria-pressed');
const paused = () => el('pause-screen').hidden === false;
const endShown = () => el('end-screen').hidden === false;

const fakeWindow = makeHost();
const contexts = [];
function fakeParam() {
  return new Proxy({}, { get: () => () => {}, set: () => true });
}
class FakeAudioContext {
  constructor() {
    const ctx = {
      currentTime: 0, destination: {}, resumeCalls: 0, suspendCalls: 0,
      resume() { ctx.resumeCalls++; return Promise.resolve(); },
      suspend() { ctx.suspendCalls++; return Promise.resolve(); },
      createOscillator() {
        return {
          type: null, frequency: fakeParam(), onended: null,
          connect() {}, disconnect() {}, start() {}, stop() {},
        };
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

const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Element',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB'];
const saved = {};

describe('couper le son (T9) : câblage de main.js (DOM factice)', () => {
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
    // Labyrinthe 8 x 8 à graine fixe : manche déterministe.
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

  test('vue de dessus : bouton caché, X sans effet (non bloquée, libellé inchangé)', () => {
    assert.equal(soundButton().hidden, true);
    assert.equal(key('keydown', 'KeyX').defaultPrevented, false, 'X non bloquée hors FPS');
    assert.equal(label(), translate('sound.mute'));
    assert.equal(pressed(), 'false');
  });

  test('FPS : bouton visible ; clic bascule libellé et aria-pressed, second clic rétablit', () => {
    el('fps-enter-button').dispatch('click', {});
    assert.equal(soundButton().hidden, false, 'bouton visible en FPS');
    soundButton().dispatch('click', {});
    assert.equal(label(), translate('sound.unmute'));
    assert.equal(pressed(), 'true');
    soundButton().dispatch('click', {});
    assert.equal(label(), translate('sound.mute'));
    assert.equal(pressed(), 'false');
  });

  test('touche X équivaut au clic ; auto-répétition et Ctrl+X sans effet', () => {
    const ev = key('keydown', 'KeyX');
    assert.equal(ev.defaultPrevented, true);
    assert.equal(muted(), true);
    assert.equal(pressed(), 'true');
    key('keyup', 'KeyX');
    assert.equal(key('keydown', 'KeyX', { repeat: true }).defaultPrevented, true);
    assert.equal(muted(), true, 'répétition ignorée');
    assert.equal(key('keydown', 'KeyX', { ctrlKey: true }).defaultPrevented, false);
    assert.equal(muted(), true, 'Ctrl+X ignorée');
    key('keydown', 'KeyX');
    assert.equal(muted(), false, 'X rétablit');
    assert.equal(pressed(), 'false');
  });

  test('pause : X bascule le son sans reprendre la manche, puis P reprend', () => {
    key('keydown', 'KeyP');
    assert.equal(paused(), true);
    assert.equal(key('keydown', 'KeyX').defaultPrevented, true);
    assert.equal(muted(), true, 'X en pause bascule');
    assert.equal(paused(), true, 'X ne reprend pas la manche');
    key('keyup', 'KeyX');
    key('keydown', 'KeyP');
    assert.equal(paused(), false);
    key('keyup', 'KeyP');
  });

  test('état conservé entre vues : Échap puis réentrée gardent le libellé et aria-pressed', () => {
    assert.equal(muted(), true);
    key('keydown', 'Escape');
    assert.equal(soundButton().hidden, true, 'bouton caché hors FPS');
    el('fps-enter-button').dispatch('click', {});
    assert.equal(soundButton().hidden, false);
    assert.equal(label(), translate('sound.unmute'));
    assert.equal(pressed(), 'true');
    soundButton().dispatch('click', {});
    assert.equal(muted(), false);
  });

  test('fin de manche : X reste active sur l\'écran de fin ; « Rejouer » conserve l\'état', () => {
    // Le monstre immobile rattrape le joueur : défaite (budget borné, déterministe).
    runFrames(40000);
    assert.equal(endShown(), true, 'écran de fin atteint');
    assert.equal(key('keydown', 'KeyX').defaultPrevented, true, 'X active sur l\'écran de fin');
    assert.equal(muted(), true);
    key('keyup', 'KeyX');
    el('replay-button').dispatch('click', {});
    assert.equal(endShown(), false, 'nouvelle manche');
    assert.equal(muted(), true, 'l\'état survit à « Rejouer »');
    assert.equal(pressed(), 'true');
  });

  test('aucun stockage, aucun réseau appelé pendant le scénario', () => {
    assert.deepEqual(forbiddenCalls, []);
    assert.deepEqual(htmlWrites, [], 'aucune écriture HTML dynamique');
  });
});
