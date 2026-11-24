// Plan docs/design/annonce-traque.md (T14), §Cas de test fonctionnels : vrai src/main.js sous
// un DOM factice (schéma de fps-mouse-look.test.js). Le joueur reste immobile : le monstre
// traque et la manche se termine par une capture. Les écritures de #round-status sont
// journalisées via textContent ; innerHTML / innerText ne doivent jamais être écrits.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fr } from '../../src/i18n/fr.js';

const TEXT = fr['round.huntAnnouncement'];
const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'];
const saved = {};

// Identifiants et attribut hidden lus depuis index.html (même DOM que la page réelle).
const html = readFileSync(fileURLToPath(new URL('../../src/index.html', import.meta.url)), 'utf8');
const TAGS = [...html.matchAll(/<[^>]*\sid="([^"]+)"[^>]*>/g)].map((m) => ({ id: m[1], hidden: /\shidden[\s>]/.test(m[0]) }));
const ELEMENT_IDS = TAGS.map((t) => t.id);
const HIDDEN_AT_LOAD = new Set(TAGS.filter((t) => t.hidden).map((t) => t.id));

function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function makeListenerHost() {
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
    dispatch(type, event) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
  };
}

function makeElement(id) {
  const attributes = new Map();
  const element = {
    ...makeListenerHost(),
    id,
    hidden: HIDDEN_AT_LOAD.has(id),
    textContent: '',
    value: '',
    style: {},
    width: 300,
    height: 150,
    clientWidth: 0,
    clientHeight: 0,
    parentElement: { clientWidth: 640, clientHeight: 480 },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    focus() { fakeDocument.activeElement = element; },
    blur() {},
    getContext() { return fakeContext(); },
  };
  return element;
}

const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
elements.get('maze-difficulty').value = 'normal';
const el = (id) => elements.get(id);
const fakeWindow = makeListenerHost();
const fakeDocument = {
  ...makeListenerHost(),
  title: '',
  hidden: false,
  activeElement: null,
  pointerLockElement: null,
  getElementById: (id) => elements.get(id) ?? null,
  querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} } },
};

// Images d'animation en attente : id -> callback. Les annulations retirent l'entrée.
const frames = new Map();
let nextFrameId = 1;
let clock = 5000;
const STEP_MS = 50;

/** Une « image » : chaque callback en attente au début de l'image tourne une fois, par id. */
function tick() {
  clock += STEP_MS;
  for (const id of [...frames.keys()].sort((a, b) => a - b)) {
    if (!frames.has(id)) continue;
    const cb = frames.get(id);
    frames.delete(id);
    cb(clock);
  }
}
function ticks(n) {
  for (let i = 0; i < n; i++) tick();
}
function tickUntil(predicate, max) {
  for (let i = 0; i < max && !predicate(); i++) tick();
  return predicate();
}

/** Journal des écritures de #round-status (textContent) et écritures HTML interdites. */
const status = { writes: [], text: '', htmlWrites: 0 };
function watchStatus() {
  const node = el('round-status');
  Object.defineProperty(node, 'textContent', {
    configurable: true,
    get() { return status.text; },
    set(value) { status.writes.push(value); status.text = value; },
  });
  for (const prop of ['innerHTML', 'innerText']) {
    Object.defineProperty(node, prop, {
      configurable: true,
      get() { return ''; },
      set() { status.htmlWrites++; },
    });
  }
}

const announced = () => status.writes.filter((w) => w === TEXT).length;
const inFps = () => el('maze-form').hidden === true;
const endShown = () => el('end-screen').hidden === false;

/** Manche neuve : sortie si besoin, « Générer » puis « Explorer en 3D ». */
function startFpsRound() {
  if (inFps()) el('fps-exit-button').dispatch('click', {});
  el('maze-form').dispatch('submit', { preventDefault() {} });
  el('fps-enter-button').dispatch('click', {});
  assert.ok(inFps(), 'vue FPS attendue');
}

describe('annonce de l\'état de manche : main.js sous DOM factice', () => {
  let rejections = 0;
  const onRejection = () => { rejections++; };

  before(async () => {
    for (const n of GLOBALS) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);
    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.requestAnimationFrame = (cb) => { const id = nextFrameId++; frames.set(id, cb); return id; };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    process.on('unhandledRejection', onRejection);
    el('maze-width').value = '8';
    el('maze-height').value = '8';
    el('maze-seed').value = '11';
    await import('../../src/main.js');
    watchStatus();
    el('maze-form').dispatch('submit', { preventDefault() {} });
  });

  after(() => {
    process.off('unhandledRejection', onRejection);
    for (const n of GLOBALS) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n];
    }
  });

  test('zone #round-status visible et vide au chargement', () => {
    assert.equal(el('round-status').hidden, false);
    assert.equal(status.text, '');
  });

  test('vue de dessus : aucune annonce', () => {
    ticks(5);
    assert.equal(announced(), 0);
    assert.equal(status.text, '');
  });

  test('traque : « Le monstre te traque » écrit, précédé d\'un vidage', () => {
    startFpsRound();
    assert.ok(tickUntil(() => announced() > 0, 8000), 'annonce attendue pendant la traque');
    const first = status.writes.indexOf(TEXT);
    assert.equal(status.writes[first - 1], '', 'vidage avant l\'écriture de l\'annonce');
    assert.equal(status.text, TEXT);
  });

  test('une seule annonce par traque, jusqu\'à la fin de manche', () => {
    assert.ok(tickUntil(endShown, 8000), 'capture attendue (écran de fin)');
    assert.equal(announced(), 1);
  });

  test('fin de manche : zone vidée, plus aucune écriture ensuite', () => {
    assert.equal(status.writes.at(-1), '');
    assert.equal(status.text, '');
    const before = status.writes.length;
    ticks(10);
    assert.equal(status.writes.length, before);
  });

  test('« Rejouer » : zone vidée puis nouvelle annonce à la traque suivante', () => {
    const before = status.writes.length;
    el('replay-button').dispatch('click', {});
    assert.ok(status.writes.length > before, 'écriture attendue au départ de la manche');
    assert.equal(status.writes.at(-1), '');
    assert.ok(tickUntil(() => announced() === 2, 8000), 'annonce rejouée à la nouvelle traque');
  });

  test('sortie FPS pendant la traque : zone vidée, aucune annonce ensuite', () => {
    el('fps-exit-button').dispatch('click', {});
    assert.equal(status.writes.at(-1), '');
    assert.equal(status.text, '');
    const before = status.writes.length;
    ticks(20);
    assert.equal(status.writes.length, before);
    assert.equal(announced(), 2);
  });

  test('« Nouveau labyrinthe » de l\'écran de fin : zone vidée', () => {
    startFpsRound();
    assert.ok(tickUntil(endShown, 8000), 'écran de fin attendu');
    const before = status.writes.length;
    el('end-new-maze-button').dispatch('click', {});
    assert.ok(status.writes.length > before, 'écriture attendue au départ de la manche');
    assert.equal(status.writes.at(-1), '');
    assert.equal(status.text, '');
  });

  test('écriture par textContent uniquement, aucun texte autre que l\'annonce', () => {
    assert.equal(status.htmlWrites, 0);
    assert.ok(status.writes.every((w) => w === '' || w === TEXT));
    assert.equal(rejections, 0);
  });
});
