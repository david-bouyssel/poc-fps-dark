// Plan docs/design/souris-pointer-lock.md §4 et §6 (fonctionnels 1 à 8) : rotation à la
// souris en vue FPS, avec le vrai src/main.js sous un DOM factice (schéma de
// security-fps-keyboard.test.js). Pointer Lock espionné : canvas.requestPointerLock,
// document.exitPointerLock (remet pointerLockElement à null et émet pointerlockchange),
// document.pointerLockElement.
// La rotation est observée par l'empreinte des appels de dessin d'une image : deux images
// au même horodatage et dans le même état ne diffèrent que par l'angle du joueur.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOUSE_LOOK } from '../../src/game/mouse-look.js';
import { MOVEMENT, stepPlayer } from '../../src/game/movement.js';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { actionForCode, computeIntent } from '../../src/game/input.js';
import { findExit } from '../../src/game/exit.js';
import { shortestPath } from '../../src/game/pathfinding.js';
import { fr } from '../../src/i18n/fr.js';

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'maze-difficulty', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'sound-toggle-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'end-stat-time', 'end-stat-explored', 'end-stat-distance',
  'replay-button', 'end-new-maze-button', 'touch-pad-move', 'touch-pad-actions', 'fps-help-touch',
  'pause-screen', 'pause-message', 'resume-button', 'round-status',
];
const HIDDEN_AT_LOAD = new Set([
  'fps-exit-button', 'sound-toggle-button', 'fps-help', 'fps-goal', 'end-screen',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch', 'pause-screen',
]);

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
const canvas = elements.get('maze-canvas');
const bodyClasses = new Set();
const fakeWindow = makeListenerHost();
const fakeDocument = {
  ...makeListenerHost(),
  title: '',
  hidden: false,
  activeElement: null,
  pointerLockElement: null,
  getElementById: (id) => elements.get(id) ?? null,
  querySelectorAll: () => [],
  body: { classList: { add(c) { bodyClasses.add(c); }, remove(c) { bodyClasses.delete(c); } } },
};

/** Espions Pointer Lock ; requestMode règle la réponse du navigateur simulé. */
const lock = { requests: 0, exits: 0, requestMode: 'grant' };
canvas.requestPointerLock = () => {
  lock.requests++;
  if (lock.requestMode === 'throw') throw new Error('refus');
  if (lock.requestMode === 'reject') return Promise.reject(new Error('refus'));
  if (lock.requestMode === 'ignore') return undefined;
  fakeDocument.pointerLockElement = canvas;
  fakeDocument.dispatch('pointerlockchange', {});
  return undefined;
};
fakeDocument.exitPointerLock = () => {
  lock.exits++;
  fakeDocument.pointerLockElement = null;
  fakeDocument.dispatch('pointerlockchange', {});
};

const frames = new Map();
let nextFrameId = 1;
const saved = {};
const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'];

function press(type, code) {
  const event = {
    code, key: code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; },
  };
  fakeWindow.dispatch(type, event);
  return event;
}
const tap = (code) => { press('keydown', code); press('keyup', code); };
const mouse = (movementX) => fakeDocument.dispatch('mousemove', { movementX, movementY: 13 });
const click = (pointerType = 'mouse') => canvas.dispatch('click', { pointerType, button: 0 });
const loseLock = () => { fakeDocument.pointerLockElement = null; fakeDocument.dispatch('pointerlockchange', {}); };
const el = (id) => elements.get(id);
const isPausedScreen = () => el('pause-screen').hidden === false;
const inFps = () => el('maze-form').hidden === true;

function runFrame(t) {
  assert.equal(frames.size, 1, 'une image en attente');
  const [[id, cb]] = frames;
  frames.delete(id);
  cb(t);
}
function frameLog(t) {
  drawLog = [];
  runFrame(t);
  return drawLog.join('|');
}
/** Image avec des touches maintenues pendant l'image. */
function frameHolding(codes, t) {
  for (const c of codes) press('keydown', c);
  const log = frameLog(t);
  for (const c of codes) press('keyup', c);
  return log;
}
/**
 * Manche neuve sur le même labyrinthe (graine fixée) : sortie, « Générer » (joueur remis à
 * zéro), puis retour en FPS (startRound).
 */
function newRound() {
  if (inFps()) el('fps-exit-button').dispatch('click', {});
  el('maze-form').dispatch('submit', { preventDefault() {} });
  el('fps-enter-button').dispatch('click', {});
  assert.ok(inFps());
}
/** Envoie une rotation d'exactement `rad` par événements de maxEventDelta au plus. */
function mouseTurn(rad) {
  let px = rad / MOUSE_LOOK.sensitivity;
  const sign = Math.sign(px);
  px = Math.abs(px);
  while (px > 1e-9) {
    const step = Math.min(px, MOUSE_LOOK.maxEventDelta);
    mouse(sign * step);
    px -= step;
  }
}

const T0 = 5000;
const DT_MS = 50;
const T1 = T0 + DT_MS;
// Rotation clavier sur une image de 50 ms, et le déplacement souris équivalent (52 px).
const KEY_TURN = MOVEMENT.turnSpeed * (DT_MS / 1000);
const KEY_PX = KEY_TURN / MOUSE_LOOK.sensitivity;

describe('rotation à la souris : main.js sous DOM factice', () => {
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
    el('maze-seed').value = '42';
    await import('../../src/main.js');
    el('maze-form').dispatch('submit', { preventDefault() {} });
  });

  after(() => {
    process.off('unhandledRejection', onRejection);
    for (const n of GLOBALS) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n];
    }
  });

  test('§6.9 écouteurs : mousemove, pointerlockchange, pointerlockerror sur document', () => {
    assert.deepEqual([...fakeWindow.listeners.keys()].sort(), ['blur', 'keydown', 'keyup', 'resize']);
    for (const type of ['mousemove', 'pointerlockchange', 'pointerlockerror']) {
      assert.equal(fakeDocument.listeners.get(type)?.length, 1, type);
    }
    assert.ok(canvas.listeners.has('click'));
  });

  test('§6.1 vue de dessus : clic sans verrou ; mousemove sans effet', () => {
    click();
    assert.equal(lock.requests, 0);
    assert.doesNotThrow(() => mouse(100));
    assert.equal(frames.size, 0);
    assert.ok(!bodyClasses.has('fps-active'));
  });

  test('§2 curseur crosshair sur le canvas en FPS (CSS + classe fps-active)', () => {
    const css = readFileSync(fileURLToPath(new URL('../../src/styles.css', import.meta.url)), 'utf8');
    assert.match(css, /body\.fps-active\s+#maze-canvas\s*\{[^}]*cursor:\s*crosshair;/);
    newRound();
    assert.ok(bodyClasses.has('fps-active'));
    el('fps-exit-button').dispatch('click', {});
    assert.ok(!bodyClasses.has('fps-active'));
  });

  test('§6.1 / §6.2 FPS : un appel au clic, pas en tactile ni stylet ; refus absorbés', async () => {
    newRound();
    lock.requests = 0;
    assert.equal(fakeDocument.pointerLockElement, null, 'jamais de verrou automatique à l\'entrée');
    click('touch');
    click('pen');
    assert.equal(lock.requests, 0);
    for (const mode of ['throw', 'reject', 'ignore']) {
      lock.requestMode = mode;
      assert.doesNotThrow(() => click(), mode);
    }
    const original = canvas.requestPointerLock;
    delete canvas.requestPointerLock;
    assert.doesNotThrow(() => click());
    canvas.requestPointerLock = original;
    await new Promise((r) => setImmediate(r));
    assert.equal(rejections, 0, 'promesse rejetée gérée');
    assert.equal(lock.requests, 3);
    assert.equal(isPausedScreen(), false, 'un refus ne met pas en pause');
    assert.doesNotThrow(() => fakeDocument.dispatch('pointerlockerror', {}));
    assert.doesNotThrow(() => frameLog(T0), 'le jeu continue');
    lock.requestMode = 'grant';
    lock.requests = 0;
    click();
    assert.equal(lock.requests, 1, 'un appel en FPS, partie en cours');
    assert.equal(fakeDocument.pointerLockElement, canvas);
    click();
    assert.equal(lock.requests, 1, 'déjà verrouillé : pas de nouvel appel');
    el('fps-exit-button').dispatch('click', {});
  });

  test('§6.3 / §6.8 angle : +movementX * sensitivity, même sens et même valeur que le clavier', () => {
    // Manche 1, sans verrou : référence clavier (← → inchangés).
    newRound();
    const base = frameLog(T0);
    const keyRight = frameHolding(['ArrowRight'], T1);
    assert.notEqual(keyRight, base);
    mouse(-KEY_PX);
    assert.equal(frameLog(T1), keyRight, 'sans verrou : mousemove sans effet');

    // Manche 2, verrouillée : le clavier tourne à l'identique (non-régression).
    newRound();
    click();
    assert.equal(frameLog(T0), base);
    assert.equal(frameHolding(['ArrowRight'], T1), keyRight, 'rotation clavier identique avec la souris');
    mouse(-KEY_PX);
    const back = frameLog(T1);
    assert.notEqual(back, keyRight, 'verrouillé : la souris tourne');
    mouse(KEY_PX);
    assert.equal(frameLog(T1), keyRight, `${KEY_PX} px vers la droite = ArrowRight pendant ${DT_MS} ms`);
    mouse(-KEY_PX / 2);
    mouse(-KEY_PX / 2);
    assert.equal(frameLog(T1), back, 'cumul de deux événements avant une image');

    // Bornes : pic énorme = maxEventDelta ; NaN / non nombre = rien.
    mouse(1e9);
    const big = frameLog(T1);
    mouse(-MOUSE_LOOK.maxEventDelta);
    assert.equal(frameLog(T1), back, 'movementX énorme borné à maxEventDelta');
    for (const v of [NaN, Infinity, '100', undefined, null]) assert.doesNotThrow(() => mouse(v));
    assert.equal(frameLog(T1), back, 'valeurs non finies : aucune rotation');
    assert.notEqual(big, back);
    for (let i = 0; i < 100; i++) mouse(MOUSE_LOOK.maxEventDelta);
    frameLog(T1);
    mouseTurn(-MOUSE_LOOK.maxFrameTurn);
    assert.equal(frameLog(T1), back, 'cumul d\'une image borné à maxFrameTurn');
    el('fps-exit-button').dispatch('click', {});
  });

  test('§4.2 rotation appliquée avant stepPlayer : le pas de la même image suit le nouveau cap', () => {
    newRound();
    click();
    frameLog(T0);
    mouseTurn(Math.PI / 2);
    const sameFrame = frameHolding(['KeyW'], T1);

    newRound();
    click();
    frameLog(T0);
    mouseTurn(Math.PI / 2);
    const turnedOnly = frameLog(T0); // dt = 0 : rotation seule
    const nextFrame = frameHolding(['KeyW'], T1);
    assert.equal(sameFrame, nextFrame);
    assert.notEqual(nextFrame, turnedOnly, 'précondition : le pas a bien déplacé le joueur');
    el('fps-exit-button').dispatch('click', {});
  });

  test('§6.4 cumul vidé par blur et par une nouvelle manche', () => {
    newRound();
    click();
    const base = frameLog(T0);
    mouse(200);
    fakeWindow.dispatch('blur', {});
    assert.ok(isPausedScreen());
    tap('KeyP');
    assert.equal(isPausedScreen(), false);
    assert.equal(frameLog(T0), base, 'aucune rotation après blur');

    click();
    mouse(200);
    newRound();
    assert.equal(frameLog(T0), base, 'aucune rotation après startRound');
    el('fps-exit-button').dispatch('click', {});
  });

  test('§6.5 perte du verrou en cours de manche -> pause T6 (raison MANUAL)', () => {
    newRound();
    click();
    frameLog(T0);
    loseLock();
    assert.ok(isPausedScreen());
    assert.equal(el('pause-message').textContent, fr['pause.message']);
    assert.equal(frames.size, 0, 'boucle arrêtée');
    assert.ok(inFps());
    // Déjà en pause : aucun effet.
    loseLock();
    assert.ok(isPausedScreen());
    tap('KeyP');
    assert.equal(isPausedScreen(), false, 'une seule pause : un P reprend');
    assert.equal(fakeDocument.pointerLockElement, null, 'pas de nouveau verrou automatique à la reprise');
    // Vue de dessus : aucun effet.
    el('fps-exit-button').dispatch('click', {});
    loseLock();
    assert.equal(isPausedScreen(), false);
    assert.equal(frames.size, 0);
  });

  test('§6.6 sortie FPS et pause par P verrouillées : exitPointerLock une fois, sans double pause', () => {
    newRound();
    click();
    let exits = lock.exits;
    el('fps-exit-button').dispatch('click', {});
    assert.equal(lock.exits, exits + 1);
    assert.equal(isPausedScreen(), false, 'pas de pause fantôme à la sortie');
    assert.equal(fakeDocument.pointerLockElement, null);

    newRound();
    click();
    exits = lock.exits;
    tap('KeyP');
    assert.equal(lock.exits, exits + 1);
    assert.ok(isPausedScreen());
    assert.equal(el('pause-message').textContent, fr['pause.message']);
    click();
    assert.equal(fakeDocument.pointerLockElement, null, 'pas de verrou en pause');
    tap('KeyP');
    assert.equal(isPausedScreen(), false, 'un seul P reprend : pas de double pause');
    assert.equal(frames.size, 1);
    el('fps-exit-button').dispatch('click', {});
  });

  test('§6.7 Échap verrouillé : preventDefault, verrou libéré, reste en FPS ; non verrouillé : sortie', () => {
    newRound();
    click();
    const exits = lock.exits;
    const event = press('keydown', 'Escape');
    press('keyup', 'Escape');
    assert.equal(event.defaultPrevented, true);
    assert.equal(lock.exits, exits + 1);
    assert.equal(fakeDocument.pointerLockElement, null);
    assert.ok(inFps(), 'toujours en FPS');
    assert.ok(isPausedScreen(), 'pause via pointerlockchange');
    tap('KeyP');
    assert.equal(isPausedScreen(), false);
    tap('Escape');
    assert.equal(inFps(), false, 'Échap non verrouillé : retour à la vue de dessus');
  });

  test('§6.6 fin de manche verrouillée : exitPointerLock une fois, pas de pause ; clic ensuite sans verrou', () => {
    el('maze-width').value = '3';
    el('maze-height').value = '3';
    el('maze-form').dispatch('submit', { preventDefault() {} });
    newRound();
    click();
    assert.equal(fakeDocument.pointerLockElement, canvas);
    const grid = toTileGrid(generateMaze({ width: 3, height: 3, seed: Number(el('maze-seed').value) }));
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
    const endScreen = el('end-screen');
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
    assert.equal(endScreen.hidden, false, 'écran de fin');
    assert.equal(lock.exits, exits + 1, 'verrou libéré une fois en fin de manche');
    assert.equal(fakeDocument.pointerLockElement, null);
    assert.equal(isPausedScreen(), false, 'pas de pause fantôme en fin de manche');
    const requests = lock.requests;
    click();
    assert.equal(lock.requests, requests, 'pas de verrou en partie finie');
    fakeDocument.pointerLockElement = canvas;
    assert.doesNotThrow(() => mouse(300));
    loseLock();
    assert.equal(isPausedScreen(), false, 'perte du verrou en partie finie : aucun effet');
    assert.equal(frames.size, 0);
  });
});
