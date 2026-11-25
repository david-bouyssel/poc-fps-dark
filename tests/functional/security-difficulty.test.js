// Tests de sécurité de la difficulté (T10) : module pur src/game/difficulty.js face à des
// identifiants hostiles, gel profond des réglages, puis câblage réel de src/main.js en DOM
// factice : valeurs hostiles du <select id="maze-difficulty"> ramenées à « Normal » sans
// exception ni pollution de prototype, aucun HTML dynamique, aucun stockage ni réseau,
// changement de niveau en cours de manche sans fuite de boucle d'animation.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTY,
  DIFFICULTY_IDS,
  DIFFICULTY_SETTINGS,
  difficultySettings,
  isDifficulty,
} from '../../src/game/difficulty.js';

const HOSTILE_VALUES = [
  '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'prototype', '',
  ' normal', 'normal ', 'NORMAL', 'Normal', 'hard', 'x'.repeat(100_000), '<img src=x onerror=1>',
  'normal\u0000', 'easy,nightmare',
];
const NON_STRINGS = [undefined, null, 0, 1, NaN, true, {}, [], ['normal'], Symbol('normal'),
  { toString: () => 'normal' }, Object.create(null), () => 'normal'];

function prototypeSnapshot() {
  return [Object.prototype, Array.prototype, Function.prototype, String.prototype].map(
    (proto) => Reflect.ownKeys(proto).map(String).sort().join('|'),
  );
}

describe('sécurité : module difficulty.js face à des identifiants hostiles', () => {
  test('isDifficulty : clés héritées, valeurs non listées et non-chaînes donnent false', () => {
    for (const value of [...HOSTILE_VALUES, ...NON_STRINGS]) {
      assert.equal(isDifficulty(value), false, typeof value === 'string' ? value.slice(0, 40) : typeof value);
    }
    for (const id of DIFFICULTY_IDS) assert.equal(isDifficulty(id), true, id);
  });

  test('difficultySettings : jamais d\'objet hérité, TypeError/RangeError typées', () => {
    for (const value of HOSTILE_VALUES) {
      assert.throws(() => difficultySettings(value), RangeError);
    }
    for (const value of NON_STRINGS) {
      assert.throws(() => difficultySettings(value), TypeError);
    }
  });

  test('aucune pollution de prototype après des appels hostiles', () => {
    const snapshot = prototypeSnapshot();
    for (const value of [...HOSTILE_VALUES, ...NON_STRINGS]) {
      try { isDifficulty(value); difficultySettings(value); } catch { /* attendu */ }
    }
    assert.deepEqual(prototypeSnapshot(), snapshot);
    assert.equal({}.chaseSpeed, undefined);
    assert.equal({}.fogDistance, undefined);
  });

  test('gel profond : constantes et réglages non mutables par l\'appelant', () => {
    for (const obj of [DIFFICULTY, DIFFICULTY_IDS, DIFFICULTY_SETTINGS]) assert.ok(Object.isFrozen(obj));
    for (const id of DIFFICULTY_IDS) {
      const settings = difficultySettings(id);
      assert.ok(Object.isFrozen(settings), id);
      assert.ok(Object.isFrozen(settings.monster), `${id}.monster`);
      assert.equal(settings, DIFFICULTY_SETTINGS[id], 'même référence gelée');
      assert.throws(() => { 'use strict'; settings.fogDistance = 100; }, TypeError);
      assert.throws(() => { settings.monster.chaseSpeed = 100; }, TypeError);
      assert.throws(() => { settings.monster.catchRadius = 100; }, TypeError);
      assert.throws(() => { delete settings.monster.graceDuration; }, TypeError);
      assert.throws(() => { Object.setPrototypeOf(settings.monster, { chaseSpeed: 99 }); }, TypeError);
    }
    assert.throws(() => { DIFFICULTY_SETTINGS.evil = {}; }, TypeError);
    assert.throws(() => { DIFFICULTY_IDS.push('evil'); }, TypeError);
    assert.equal(isDifficulty('evil'), false);
  });

  test('réglages : nombres finis > 0, clés propres seulement, aucun accesseur', () => {
    for (const id of DIFFICULTY_IDS) {
      const settings = difficultySettings(id);
      assert.ok(Number.isFinite(settings.fogDistance) && settings.fogDistance > 0, id);
      for (const key of Object.keys(settings.monster)) {
        const desc = Object.getOwnPropertyDescriptor(settings.monster, key);
        assert.equal(typeof desc.get, 'undefined', `${id}.${key} sans getter`);
        assert.ok(Number.isFinite(desc.value) && desc.value > 0, `${id}.${key}`);
      }
      assert.deepEqual(Object.keys(settings.monster).sort(),
        ['chaseDistance', 'chaseSpeed', 'graceDuration', 'sightDistance']);
    }
    assert.equal(DEFAULT_DIFFICULTY, DIFFICULTY.NORMAL);
  });
});

// --- Câblage réel de src/main.js (DOM factice) -----------------------------------------

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'maze-difficulty', 'new-maze-button',
  'maze-info', 'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button',
  'sound-toggle-button', 'fps-help', 'fps-goal', 'end-screen', 'end-title', 'end-message',
  'end-stat-time', 'end-stat-explored', 'end-stat-distance', 'replay-button',
  'end-new-maze-button', 'touch-pad-move', 'touch-pad-actions', 'fps-help-touch',
  'pause-screen', 'pause-message', 'resume-button', 'round-status', 'sound-captions',
];
const HIDDEN_AT_LOAD = new Set([ 'sound-captions',
  'fps-exit-button', 'sound-toggle-button', 'fps-help', 'fps-goal', 'end-screen',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch', 'pause-screen',
]);
const htmlWrites = [];
const forbiddenCalls = [];
const uncaught = [];

function fake2d() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'getImageData' || prop === 'createImageData') {
        return (...args) => {
          const w = typeof args[0] === 'number' && args.length <= 2 ? args[0] : args[2] ?? 1;
          const h = typeof args[1] === 'number' && args.length <= 2 ? args[1] : args[3] ?? 1;
          return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) };
        };
      }
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
    ...makeHost(), id, hidden: HIDDEN_AT_LOAD.has(id), replaceChildren(...nodes) { this.children = nodes; }, value: '', style: {},
    width: 300, height: 150, clientWidth: 0, clientHeight: 0,
    parentElement: { clientWidth: 160, clientHeight: 120 },
    classList: makeClassList(),
    setAttribute(n, v) { attrs.set(n, String(v)); },
    getAttribute(n) { return attrs.has(n) ? attrs.get(n) : null; },
    focus() { fakeDocument.activeElement = el; }, blur() {},
    getContext() { return fake2d(); },
    insertAdjacentHTML() { htmlWrites.push(`${id}.insertAdjacentHTML`); },
  };
  let text = '';
  Object.defineProperty(el, 'textContent', { get() { return text; }, set(v) { text = String(v); } });
  for (const prop of ['innerHTML', 'outerHTML']) {
    Object.defineProperty(el, prop, { get() { return ''; }, set() { htmlWrites.push(`${id}.${prop}`); } });
  }
  return el;
}
const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
elements.get('maze-difficulty').value = 'normal';
fakeDocument.getElementById = (id) => elements.get(id) ?? null;
fakeDocument.createElement = (tag) => ({ tagName: tag, textContent: '', className: '' });
const el = (id) => elements.get(id);
class FakeElement {}

function fakeParam() {
  return new Proxy({}, { get: () => () => {}, set: () => true });
}
class FakeAudioContext {
  constructor() {
    return {
      currentTime: 0, destination: {},
      resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
      createOscillator() {
        const osc = {
          type: null, frequency: fakeParam(), onended: null, connect() {}, disconnect() {}, start() {},
          stop() { queueMicrotask(() => { if (typeof osc.onended === 'function') osc.onended(); }); },
        };
        return osc;
      },
      createGain() { return { gain: fakeParam(), connect() {}, disconnect() {} }; },
      createBiquadFilter() {
        return { type: null, Q: fakeParam(), frequency: fakeParam(), connect() {}, disconnect() {} };
      },
    };
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
    try { cb(clock); } catch (error) { uncaught.push(error); }
  }
}
const select = () => el('maze-difficulty');
const changeDifficulty = (value) => {
  select().value = value;
  select().dispatch('change', {});
};
const enter = () => el('fps-enter-button').dispatch('click', {});
const exit = () => el('fps-exit-button').dispatch('click', {});
const inFps = () => el('fps-exit-button').hidden === false;

const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Element',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB'];
const saved = {};
let prototypesAtLoad;

describe('sécurité : difficulté dans main.js (DOM factice)', () => {
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
    prototypesAtLoad = prototypeSnapshot();
    await import('../../src/main.js');
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

  test('un seul écouteur « change » sur le select, aucun « input » ni écouteur global ajouté', () => {
    assert.deepEqual([...select().listeners.keys()], ['change']);
    assert.equal(select().listeners.get('change').length, 1);
    assert.ok(!fakeWindow.listeners.has('change') && !fakeDocument.listeners.has('change'));
  });

  test('valeurs hostiles du select : manche démarrée, aucune exception ni message d\'erreur', () => {
    for (const value of [...HOSTILE_VALUES, undefined, null]) {
      changeDifficulty(value);
      assert.doesNotThrow(enter, String(value).slice(0, 40));
      assert.ok(inFps(), `vue FPS pour ${String(value).slice(0, 40)}`);
      assert.equal(el('maze-error').textContent, '', String(value).slice(0, 40));
      runFrames(5);
      assert.deepEqual(uncaught, [], String(value).slice(0, 40));
      assert.ok(frames.size <= 1, 'au plus une image en attente');
      exit();
      assert.equal(frames.size, 0, 'boucle arrêtée en vue de dessus');
    }
    assert.deepEqual(prototypeSnapshot(), prototypesAtLoad, 'aucune pollution de prototype');
    assert.equal({}.chaseSpeed, undefined);
    assert.equal({}.monster, undefined);
  });

  test('changements répétés en vue de dessus : aucune boucle relancée ni image en attente', () => {
    changeDifficulty('normal');
    enter();
    runFrames(10);
    exit();
    for (let i = 0; i < 200; i++) changeDifficulty(DIFFICULTY_IDS[i % 3]);
    assert.equal(frames.size, 0, 'change ne démarre jamais la boucle');
    assert.equal(inFps(), false);
    enter();
    assert.equal(frames.size, 1, 'une seule boucle après une manche neuve');
    runFrames(20);
    assert.equal(frames.size, 1);
    exit();
    assert.equal(frames.size, 0);
    assert.deepEqual(uncaught, []);
  });

  test('select inatteignable pendant une manche : formulaire masqué en FPS et en pause', () => {
    // onDifficultyChange ne vérifie pas la vue : la garantie de non-abandon en cours de
    // manche repose sur le masquage du formulaire (plan §main.js). Seul un événement forgé
    // (outils de développement) l'atteint en FPS.
    changeDifficulty('easy');
    enter();
    runFrames(5);
    assert.equal(el('maze-form').hidden, true, 'formulaire masqué en FPS');
    fakeWindow.dispatch('blur', {});
    assert.equal(el('pause-screen').hidden, false, 'pause');
    assert.equal(el('maze-form').hidden, true, 'formulaire masqué en pause');
    el('resume-button').dispatch('click', {});
    runFrames(5);
    assert.deepEqual(uncaught.map(String), []);
    assert.ok(frames.size <= 1);
    exit();
    assert.equal(el('maze-form').hidden, false, 'formulaire visible en vue de dessus');
    assert.equal(frames.size, 0);
  });

  test('aucune écriture HTML, aucun stockage ni réseau pendant tout le scénario', () => {
    assert.deepEqual(htmlWrites, []);
    assert.deepEqual(forbiddenCalls, []);
  });
});
