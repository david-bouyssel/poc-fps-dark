// Plan docs/design/sous-titres-sons.md (T13), §Comportement : vrai src/main.js sous un DOM
// factice (schéma de fps-round-announce.test.js). Pas de contexte audio (fenêtre sans
// AudioContext) : les légendes ne dépendent pas du lecteur. Le joueur reste immobile, le
// monstre traque : une légende « [alerte] <côté> » apparaît à la traque. Graine fixe via
// crypto.getRandomValues, comme les autres tests de main.js.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fr } from '../../src/i18n/fr.js';

const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'crypto'];
const saved = {};
const ALERT_LABEL = fr['captions.alert'];
const ALERT_LINE = /^\[alerte\] (à gauche|à droite|devant|derrière)$/;

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
    hidden: HIDDEN_AT_LOAD.has(id), replaceChildren(...nodes) { this.children = nodes; },
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
  createElement: (tag) => ({ tagName: tag, textContent: '', className: '' }),
  querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} } },
};

// Images d'animation en attente : id -> callback.
const frames = new Map();
let nextFrameId = 1;
let clock = 5000;
const STEP_MS = 50;

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

const inFps = () => el('maze-form').hidden === true;
const endShown = () => el('end-screen').hidden === false;
const paused = () => el('pause-screen').hidden === false;

/** Lignes de légende affichées (textContent des paragraphes), vide si zone masquée. */
function captionTexts() {
  const zone = el('sound-captions');
  if (zone.hidden) return [];
  return (zone.children ?? []).map((p) => p.textContent);
}
const captionsVisible = () => captionTexts().length > 0;
const alertShown = () => captionTexts().some((text) => text.startsWith(ALERT_LABEL));

/** Manche neuve : sortie si besoin, « Générer » puis « Explorer en 3D ». */
function startFpsRound() {
  if (inFps()) el('fps-exit-button').dispatch('click', {});
  el('maze-form').dispatch('submit', { preventDefault() {} });
  el('fps-enter-button').dispatch('click', {});
  assert.ok(inFps(), 'vue FPS attendue');
}

describe('légendes des sons : main.js sous DOM factice (sans contexte audio)', () => {
  let rejections = 0;
  const onRejection = () => { rejections++; };

  before(async () => {
    for (const n of GLOBALS) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);
    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.requestAnimationFrame = (cb) => { const id = nextFrameId++; frames.set(id, cb); return id; };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues(buffer) { buffer[0] = 1; return buffer; } },
    });
    process.on('unhandledRejection', onRejection);
    el('maze-width').value = '8';
    el('maze-height').value = '8';
    el('maze-seed').value = '1';
    await import('../../src/main.js');
    el('maze-form').dispatch('submit', { preventDefault() {} });
  });

  after(() => {
    process.off('unhandledRejection', onRejection);
    for (const n of GLOBALS) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n];
    }
  });

  test('zone #sound-captions masquée au chargement et en vue de dessus', () => {
    assert.equal(el('sound-captions').hidden, true);
    assert.deepEqual(captionTexts(), []);
  });

  test('FPS sans lecteur audio : une légende « [alerte] <côté> » apparaît à la traque', () => {
    startFpsRound();
    assert.ok(tickUntil(alertShown, 8000), 'légende d\'alerte attendue pendant la traque');
    assert.equal(el('sound-captions').hidden, false, 'zone visible');
    const alert = captionTexts().find((text) => text.startsWith(ALERT_LABEL));
    assert.match(alert, ALERT_LINE);
  });

  test('légende : une ligne par type, classe caption-<côté>, pas de doublon d\'alerte', () => {
    const lines = el('sound-captions').children ?? [];
    assert.ok(lines.length >= 1 && lines.length <= 3, 'au plus 3 lignes');
    assert.equal(captionTexts().filter((t) => t.startsWith(ALERT_LABEL)).length, 1);
    for (const line of lines) {
      assert.match(line.className, /^caption caption-(left|right|front|back)$/);
    }
  });

  test('son coupé (bascule) : la légende continue de s\'afficher', () => {
    el('sound-toggle-button').dispatch('click', {});
    assert.equal(el('sound-toggle-button').textContent, fr['sound.unmute'], 'son coupé');
    // Nouvelle manche : la traque relance une alerte, légende visible malgré le son coupé.
    el('replay-button').dispatch('click', {});
    assert.ok(tickUntil(() => alertShown() || endShown(), 8000));
    assert.ok(alertShown(), 'légende affichée son coupé');
    el('sound-toggle-button').dispatch('click', {});
  });

  test('légende éphémère : disparaît 1,5 s après son apparition sans nouvelle alerte', () => {
    // La traque ne ré-émet pas d'alerte avant 4 s ; après 1,5 s la ligne d'alerte est retirée.
    assert.ok(tickUntil(alertShown, 8000), 'alerte affichée');
    ticks(32);
    assert.equal(alertShown(), false, 'alerte retirée après 1,5 s');
  });

  test('fin de manche : zone effacée et masquée', () => {
    assert.ok(tickUntil(endShown, 8000), 'écran de fin attendu');
    assert.equal(el('sound-captions').hidden, true);
    assert.deepEqual(captionTexts(), []);
    ticks(10);
    assert.equal(captionsVisible(), false, 'aucune légende après la fin');
  });

  test('« Rejouer » : zone effacée au départ, légendes reprises à la traque suivante', () => {
    el('replay-button').dispatch('click', {});
    assert.equal(el('sound-captions').hidden, true, 'masquée au départ');
    assert.ok(tickUntil(alertShown, 8000), 'alerte à la nouvelle traque');
  });

  test('pause (perte du focus) : zone effacée et masquée, rien pendant la pause', () => {
    assert.ok(tickUntil(alertShown, 8000), 'légende visible avant la pause');
    fakeWindow.dispatch('blur', {});
    assert.equal(paused(), true, 'manche en pause');
    assert.equal(el('sound-captions').hidden, true);
    assert.deepEqual(captionTexts(), []);
    const before = captionTexts().length;
    ticks(10);
    assert.equal(captionTexts().length, before, 'aucune nouvelle légende en pause');
    assert.equal(captionsVisible(), false);
  });

  test('sortie FPS : zone effacée, aucune légende en vue de dessus', () => {
    el('resume-button').dispatch('click', {});
    assert.equal(paused(), false, 'reprise');
    el('fps-exit-button').dispatch('click', {});
    assert.equal(el('sound-captions').hidden, true);
    assert.deepEqual(captionTexts(), []);
    ticks(20);
    assert.equal(captionsVisible(), false, 'vue de dessus : aucune légende');
  });

  test('texte uniquement via textContent : aucune écriture HTML, aucune erreur non gérée', () => {
    assert.equal(rejections, 0);
  });
});
