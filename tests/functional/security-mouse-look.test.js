// Tests de sécurité de la rotation à la souris (T11, testeur-securite).
// 1. Fonctions pures de src/game/mouse-look.js : movementX hostile -> rotation bornée,
//    jamais d'exception ni de NaN.
// 2. Câblage réel de src/main.js sous un DOM factice : mousemove ignoré hors FPS, sans
//    verrou, en pause et en fin de partie ; aucun cumul ne survit à une pause ou à une
//    sortie ; requestPointerLock / exitPointerLock absents ou qui lèvent -> pas de crash ;
//    verrou libéré à la sortie, en pause et en fin de manche ; aucun écouteur window
//    ajouté ; aucun stockage, réseau ni écriture HTML.
// La rotation du joueur est observée par l'empreinte des appels de dessin d'une image
// rejouée au même horodatage (dt = 0 : seul l'angle peut changer le dessin).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOUSE_LOOK, accumulateTurn, applyMouseTurn, mouseTurnDelta } from '../../src/game/mouse-look.js';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { actionForCode, computeIntent } from '../../src/game/input.js';
import { stepPlayer } from '../../src/game/movement.js';
import { findExit } from '../../src/game/exit.js';
import { shortestPath } from '../../src/game/pathfinding.js';

const HOSTILE = [NaN, Infinity, -Infinity, 1e308, -1e308, Number.MAX_VALUE, -Number.MIN_VALUE,
  '100', '', {}, [], [5], null, undefined, true, 10n, Symbol('x'), () => 1,
  { valueOf: () => 1e9 }, new Number(50)];

describe('mouse-look.js : entrées hostiles bornées', () => {
  test('mouseTurnDelta : jamais d\'exception, toujours fini et borné', () => {
    const max = MOUSE_LOOK.maxEventDelta * MOUSE_LOOK.sensitivity;
    for (const value of HOSTILE) {
      let delta;
      assert.doesNotThrow(() => { delta = mouseTurnDelta(value); }, String(typeof value));
      assert.equal(typeof delta, 'number');
      assert.ok(Number.isFinite(delta), `fini pour ${String(typeof value)}`);
      assert.ok(Math.abs(delta) <= max + 1e-12, `borné pour ${String(typeof value)}`);
    }
    assert.equal(mouseTurnDelta(1e308), max);
    assert.equal(mouseTurnDelta(-1e308), -max);
    for (const value of [NaN, Infinity, -Infinity, '100', {}, null, undefined, new Number(50), 10n]) {
      assert.equal(mouseTurnDelta(value), 0, 'non nombre ou non fini -> 0');
    }
  });

  test('accumulateTurn : cumul borné à maxFrameTurn, valeurs non finies ignorées', () => {
    let pending = 0;
    for (let i = 0; i < 10_000; i++) pending = accumulateTurn(pending, mouseTurnDelta(1e9));
    assert.equal(pending, MOUSE_LOOK.maxFrameTurn);
    for (let i = 0; i < 10_000; i++) pending = accumulateTurn(pending, mouseTurnDelta(-1e9));
    assert.equal(pending, -MOUSE_LOOK.maxFrameTurn);
    for (const value of HOSTILE) {
      let r;
      assert.doesNotThrow(() => { r = accumulateTurn(value, value); });
      assert.ok(Number.isFinite(r) && Math.abs(r) <= MOUSE_LOOK.maxFrameTurn);
    }
    assert.equal(accumulateTurn(0.5, NaN), 0.5);
    assert.equal(accumulateTurn(NaN, 0.25), 0.25);
  });

  test('applyMouseTurn : angle fini normalisé, position inchangée, joueur gelé', () => {
    const player = Object.freeze({ x: 1.5, y: 1.5, angle: 0 });
    for (const value of HOSTILE) {
      const out = applyMouseTurn(player, value);
      assert.equal(out.x, 1.5);
      assert.equal(out.y, 1.5);
      assert.ok(Number.isFinite(out.angle));
    }
    const turned = applyMouseTurn(player, 1e6);
    assert.ok(Object.isFrozen(turned));
    assert.ok(turned.angle >= -Math.PI - 1e-9 && turned.angle <= 2 * Math.PI + 1e-9);
    assert.throws(() => applyMouseTurn(null, 1), TypeError);
    assert.throws(() => applyMouseTurn({ x: NaN, y: 0, angle: 0 }, 1), TypeError);
  });

  test('surcharges de réglages hostiles rejetées (jamais de prototype pollué)', () => {
    for (const bad of [null, 1, 'x']) assert.throws(() => mouseTurnDelta(1, bad), TypeError);
    for (const bad of [{ sensitivity: NaN }, { maxEventDelta: -1 }, { maxFrameTurn: Infinity }]) {
      assert.throws(() => accumulateTurn(0, 1, bad), RangeError);
    }
    mouseTurnDelta(1, JSON.parse('{"__proto__": {"polluted": 1}}'));
    assert.equal({}.polluted, undefined);
  });

  test('module pur : ni DOM, ni stockage, ni réseau, ni log, ni HTML', () => {
    const source = readFileSync(fileURLToPath(new URL('../../src/game/mouse-look.js', import.meta.url)), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const word of ['document', 'window', 'localStorage', 'sessionStorage', 'indexedDB', 'cookie',
      'fetch', 'XMLHttpRequest', 'WebSocket', 'sendBeacon', 'console', 'innerHTML', 'eval', 'Function(']) {
      assert.ok(!code.includes(word), word);
    }
  });
});

// --- Câblage de main.js -------------------------------------------------------------

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'maze-difficulty', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'sound-toggle-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'end-stat-time', 'end-stat-explored', 'end-stat-distance',
  'replay-button', 'end-new-maze-button', 'touch-pad-move', 'touch-pad-actions', 'fps-help-touch',
  'pause-screen', 'pause-message', 'resume-button', 'round-status', 'sound-captions',
  'share-panel', 'share-link', 'share-copy-button', 'share-status',
];
const HIDDEN_AT_LOAD = new Set([ 'sound-captions',
  'fps-exit-button', 'sound-toggle-button', 'fps-help', 'fps-goal', 'end-screen',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch', 'pause-screen',
]);
const htmlWrites = [];
const forbiddenCalls = [];
/** Journal des appels de dessin (méthode + arguments arrondis, affectations). */
let drawLog = [];

const norm = (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : typeof v === 'string' ? v : typeof v);

function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      return (...args) => { drawLog.push(`${String(prop)}(${args.map(norm).join(',')})`); };
    },
    set(target, prop, value) {
      drawLog.push(`${String(prop)}=${norm(value)}`);
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
  const host = makeListenerHost();
  const attributes = new Map();
  const element = {
    ...host,
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
    insertAdjacentHTML() { htmlWrites.push(`${id}.insertAdjacentHTML`); },
  };
  for (const prop of ['innerHTML', 'outerHTML']) {
    Object.defineProperty(element, prop, { get() { return ''; }, set() { htmlWrites.push(`${id}.${prop}`); } });
  }
  return element;
}

const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
elements.get('maze-difficulty').value = 'normal';
const canvas = elements.get('maze-canvas');
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

/** Espions Pointer Lock (comportement réglable par test). */
const lock = { requests: 0, exits: 0, requestMode: 'grant', exitMode: 'release' };
function installLockApi() {
  canvas.requestPointerLock = () => {
    lock.requests++;
    if (lock.requestMode === 'throw') throw new Error('refus');
    if (lock.requestMode === 'reject') return Promise.reject(new Error('refus'));
    if (lock.requestMode === 'bad-thenable') return { catch() { throw new Error('catch hostile'); } };
    fakeDocument.pointerLockElement = canvas;
    fakeDocument.dispatch('pointerlockchange', {});
    return undefined;
  };
  fakeDocument.exitPointerLock = () => {
    lock.exits++;
    if (lock.exitMode === 'throw') throw new Error('refus');
    // Libération synchrone (réentrance plus dure que le cas réel asynchrone).
    fakeDocument.pointerLockElement = null;
    fakeDocument.dispatch('pointerlockchange', {});
  };
}

const frames = new Map();
let nextFrameId = 1;
const saved = {};
const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB'];

function press(type, code) {
  const event = {
    code, key: code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
  };
  fakeWindow.dispatch(type, event);
  return event;
}
function tap(code) { press('keydown', code); press('keyup', code); }

function runFrame(t) {
  const [[id, cb]] = frames;
  frames.delete(id);
  cb(t);
}
/** Empreinte de dessin d'une image (t fixe -> dt = 0 après la première). */
function frameLog(t) {
  drawLog = [];
  runFrame(t);
  return drawLog.join('|');
}
function mouse(movementX) {
  const event = { movementX, movementY: 7, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  fakeDocument.dispatch('mousemove', event);
  return event;
}
const click = (pointerType = 'mouse') => canvas.dispatch('click', { pointerType, button: 0 });
const form = () => elements.get('maze-form');
const pauseScreen = () => elements.get('pause-screen');
const T = 5000;

describe('sécurité du câblage souris de main.js (DOM factice)', () => {
  let rejections = 0;
  const onRejection = () => { rejections++; };

  before(async () => {
    for (const n of GLOBALS) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);
    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.requestAnimationFrame = (cb) => { const id = nextFrameId++; frames.set(id, cb); return id; };
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
    process.on('unhandledRejection', onRejection);
    installLockApi();
    elements.get('maze-width').value = '8';
    elements.get('maze-height').value = '8';
    await import('../../src/main.js');
  });

  after(() => {
    process.off('unhandledRejection', onRejection);
    for (const n of GLOBALS) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n];
    }
  });

  test('écouteurs : rien de nouveau sur window, souris/verrou sur document, clic sur le canvas', () => {
    assert.deepEqual([...fakeWindow.listeners.keys()].sort(), ['blur', 'keydown', 'keyup', 'resize']);
    assert.deepEqual([...fakeDocument.listeners.keys()].sort(),
      ['mousemove', 'pointerlockchange', 'pointerlockerror', 'visibilitychange']);
    assert.deepEqual([...canvas.listeners.keys()], ['click']);
  });

  test('vue de dessus : clic sans demande de verrou, mousemove / pointerlock* sans effet', () => {
    click();
    assert.equal(lock.requests, 0);
    fakeDocument.pointerLockElement = canvas; // verrou forgé hors FPS
    for (const value of HOSTILE) assert.doesNotThrow(() => mouse(value));
    assert.doesNotThrow(() => fakeDocument.dispatch('pointerlockchange', {}));
    fakeDocument.pointerLockElement = null;
    assert.doesNotThrow(() => fakeDocument.dispatch('pointerlockchange', {}));
    assert.doesNotThrow(() => fakeDocument.dispatch('pointerlockerror', {}));
    assert.equal(frames.size, 0, 'aucune boucle lancée');
    assert.equal(form().hidden, false);
    assert.equal(pauseScreen().hidden, true);
  });

  describe('en vue FPS', () => {
    let baseline;

    before(() => {
      elements.get('fps-enter-button').dispatch('click', {});
      assert.equal(frames.size, 1);
      frameLog(T);
      baseline = frameLog(T);
      assert.equal(frameLog(T), baseline, 'précondition : image stable à dt = 0');
    });

    test('clic tactile ou stylet : pas de demande de verrou', () => {
      click('touch');
      click('pen');
      assert.equal(lock.requests, 0);
    });

    test('requestPointerLock absent, qui lève, rejette ou rend un thenable hostile : pas de crash', async () => {
      const original = canvas.requestPointerLock;
      delete canvas.requestPointerLock;
      assert.doesNotThrow(() => click());
      canvas.requestPointerLock = 'pas une fonction';
      assert.doesNotThrow(() => click());
      canvas.requestPointerLock = original;
      for (const mode of ['throw', 'reject', 'bad-thenable']) {
        lock.requestMode = mode;
        assert.doesNotThrow(() => click(), mode);
      }
      await new Promise((r) => setImmediate(r));
      assert.equal(rejections, 0, 'aucune promesse rejetée non gérée');
      lock.requestMode = 'grant';
      assert.equal(fakeDocument.pointerLockElement, null);
      assert.equal(frames.size, 1, 'partie toujours en cours');
      assert.equal(pauseScreen().hidden, true, 'un refus ne met pas en pause');
      assert.doesNotThrow(() => fakeDocument.dispatch('pointerlockerror', {}));
      assert.equal(elements.get('maze-error').textContent, '');
    });

    test('sans verrou : mousemove sans effet sur la vue', () => {
      for (const value of [300, -300, 1e9]) mouse(value);
      assert.equal(frameLog(T), baseline);
    });

    test('verrou tenu par un autre élément : mousemove sans effet', () => {
      fakeDocument.pointerLockElement = elements.get('fps-goal');
      mouse(300);
      assert.equal(frameLog(T), baseline);
      fakeDocument.pointerLockElement = null;
    });

    test('verrouillé : mousemove tourne la vue, jamais de preventDefault ni de double verrou', () => {
      click();
      assert.equal(lock.requests, 4, 'une seule demande effective');
      assert.equal(fakeDocument.pointerLockElement, canvas);
      click();
      assert.equal(lock.requests, 4, 'déjà verrouillé : pas de nouvelle demande');
      const event = mouse(300);
      assert.equal(event.defaultPrevented, false);
      assert.notEqual(frameLog(T), baseline, 'rotation appliquée');
      mouse(-300);
      assert.equal(frameLog(T), baseline, 'rotation inverse : vue initiale');
    });

    test('verrouillé : movementX hostiles sans exception, non numériques ignorés', () => {
      for (const value of [NaN, Infinity, -Infinity, '100', '', {}, [], [5], null, undefined, true, 10n,
        Symbol('x'), () => 1, { valueOf: () => 1e9 }, new Number(50)]) {
        assert.doesNotThrow(() => mouse(value), String(typeof value));
      }
      assert.equal(frameLog(T), baseline, 'aucune rotation pour des valeurs non finies ou non nombres');
      assert.equal(frames.size, 1);
      assert.equal(elements.get('maze-error').textContent, '');
    });

    test('verrouillé : |movementX| borné par événement et cumul borné par image', () => {
      mouse(1e308);
      frameLog(T);
      mouse(-MOUSE_LOOK.maxEventDelta);
      assert.equal(frameLog(T), baseline, 'pic énorme = maxEventDelta');
      for (let i = 0; i < 1000; i++) mouse(1e9);
      frameLog(T);
      const px = MOUSE_LOOK.maxFrameTurn / MOUSE_LOOK.sensitivity; // px pour un demi-tour
      let left = px;
      while (left > 0) { const step = Math.min(left, MOUSE_LOOK.maxEventDelta); mouse(-step); left -= step; }
      assert.equal(frameLog(T), baseline, '1000 pics = un demi-tour au plus, pas d\'emballement');
    });

    test('pause (P) : verrou libéré, cumul vidé, mousemove ignoré pendant la pause', () => {
      const exits = lock.exits;
      mouse(300); // en attente, jamais appliqué
      tap('KeyP');
      assert.equal(pauseScreen().hidden, false);
      assert.equal(frames.size, 0);
      assert.equal(lock.exits, exits + 1, 'verrou libéré en pause');
      assert.equal(fakeDocument.pointerLockElement, null);
      fakeDocument.pointerLockElement = canvas; // verrou forgé pendant la pause
      for (let i = 0; i < 50; i++) mouse(300);
      click();
      fakeDocument.pointerLockElement = null;
      assert.equal(frames.size, 0, 'aucune reprise implicite');
      tap('KeyP');
      assert.equal(pauseScreen().hidden, true);
      assert.equal(frameLog(T), baseline, 'aucun cumul ne survit à la pause');
    });

    test('perte du verrou en cours de manche : mise en pause, une seule fois', () => {
      click();
      assert.equal(fakeDocument.pointerLockElement, canvas);
      fakeDocument.pointerLockElement = null;
      fakeDocument.dispatch('pointerlockchange', {});
      assert.equal(pauseScreen().hidden, false);
      assert.equal(frames.size, 0);
      assert.doesNotThrow(() => fakeDocument.dispatch('pointerlockchange', {}));
      assert.equal(frames.size, 0);
      tap('KeyP');
      assert.equal(frameLog(T), baseline);
    });

    test('Échap verrouillé : libère sans quitter le FPS (pause) ; exitPointerLock qui lève : pas de crash', () => {
      click();
      const exits = lock.exits;
      assert.equal(press('keydown', 'Escape').defaultPrevented, true);
      press('keyup', 'Escape');
      assert.equal(lock.exits, exits + 1);
      assert.equal(form().hidden, true, 'toujours en FPS');
      assert.equal(pauseScreen().hidden, false, 'pause via pointerlockchange');
      tap('KeyP');
      click();
      lock.exitMode = 'throw';
      assert.doesNotThrow(() => tap('KeyP'), 'pause avec libération refusée');
      assert.equal(pauseScreen().hidden, false);
      tap('KeyP');
      const saveExit = fakeDocument.exitPointerLock;
      delete fakeDocument.exitPointerLock;
      assert.doesNotThrow(() => tap('KeyP'), 'pause sans exitPointerLock');
      fakeDocument.exitPointerLock = saveExit;
      lock.exitMode = 'release';
      fakeDocument.pointerLockElement = null;
      tap('KeyP');
      assert.equal(pauseScreen().hidden, true);
      assert.equal(frames.size, 1);
      assert.equal(frameLog(T), baseline);
    });

    test('sortie FPS (bouton) verrouillé : verrou libéré, cumul vidé, mousemove ignoré ensuite', () => {
      click();
      mouse(300);
      const exits = lock.exits;
      elements.get('fps-exit-button').dispatch('click', {});
      assert.equal(form().hidden, false);
      assert.equal(lock.exits, exits + 1);
      assert.equal(frames.size, 0);
      fakeDocument.pointerLockElement = canvas;
      for (let i = 0; i < 20; i++) mouse(300);
      fakeDocument.dispatch('pointerlockchange', {});
      fakeDocument.pointerLockElement = null;
      assert.equal(frames.size, 0);
      assert.equal(pauseScreen().hidden, true, 'pas de pause hors FPS');
      elements.get('fps-enter-button').dispatch('click', {});
      frameLog(T);
      assert.equal(frameLog(T), baseline, 'aucun cumul ne survit à la sortie');
    });
  });

  test('fin de manche : verrou libéré, mousemove et clic ensuite sans effet', () => {
    // Petit labyrinthe, pilote automatique sans rotation jusqu'à la sortie, verrou tenu.
    elements.get('fps-exit-button').dispatch('click', {});
    elements.get('maze-width').value = '3';
    elements.get('maze-height').value = '3';
    form().dispatch('submit', { preventDefault() {} });
    elements.get('fps-enter-button').dispatch('click', {});
    click();
    assert.equal(fakeDocument.pointerLockElement, canvas);
    const grid = toTileGrid(generateMaze({
      width: 3, height: 3, seed: Number(elements.get('maze-seed').value),
    }));
    const exit = findExit(grid);
    let local = createPlayer(grid);
    const path = shortestPath(grid, 1, 1, exit.tx, exit.ty);
    const keyFor = (angle, dx, dy) => {
      const east = angle === 0;
      if (dx > 0) return east ? 'KeyW' : 'KeyA';
      if (dx < 0) return east ? 'KeyS' : 'KeyD';
      if (dy > 0) return east ? 'KeyD' : 'KeyW';
      return east ? 'KeyA' : 'KeyS';
    };
    let target = 1;
    let t = 9_000_000;
    let first = true;
    let held = null;
    const exits = lock.exits;
    const endScreen = elements.get('end-screen');
    for (let i = 0; i < 2000 && frames.size > 0 && endScreen.hidden; i++) {
      const node = path[Math.min(target, path.length - 1)];
      const ex = node.tx + 0.5 - local.x;
      const ey = node.ty + 0.5 - local.y;
      if (Math.abs(ex) < 0.15 && Math.abs(ey) < 0.15 && target < path.length - 1) target++;
      let key = null;
      if (Math.abs(ex) > 0.1) key = keyFor(local.angle, Math.sign(ex), 0);
      else if (Math.abs(ey) > 0.1) key = keyFor(local.angle, 0, Math.sign(ey));
      if (key !== held) {
        if (held) press('keyup', held);
        if (key) press('keydown', key);
        held = key;
      }
      runFrame(t);
      local = stepPlayer(local, computeIntent(new Set(held ? [actionForCode(held)] : [])), first ? 0 : 0.05, grid);
      first = false;
      t += 50;
    }
    if (held) press('keyup', held);
    assert.equal(endScreen.hidden, false, 'écran de fin affiché');
    assert.equal(lock.exits, exits + 1, 'verrou libéré en fin de manche');
    assert.equal(fakeDocument.pointerLockElement, null);
    const requests = lock.requests;
    click();
    assert.equal(lock.requests, requests, 'pas de verrou en fin de partie');
    fakeDocument.pointerLockElement = canvas;
    for (const value of HOSTILE) assert.doesNotThrow(() => mouse(value));
    fakeDocument.dispatch('pointerlockchange', {});
    fakeDocument.pointerLockElement = null;
    fakeDocument.dispatch('pointerlockchange', {});
    assert.equal(frames.size, 0, 'aucune relance');
    assert.equal(pauseScreen().hidden, true, 'pas de pause en fin de partie');
  });

  test('aucun stockage, réseau, écriture HTML ni rejet non géré pendant tout le parcours', () => {
    assert.deepEqual(forbiddenCalls, []);
    assert.deepEqual(htmlWrites, []);
    assert.equal(rejections, 0);
    const source = readFileSync(fileURLToPath(new URL('../../src/main.js', import.meta.url)), 'utf8');
    assert.ok(!/console\.\w+\([^)]*movement/i.test(source), 'aucun log de mouvement souris');
  });
});
