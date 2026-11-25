// Difficulté (T10, plan docs/design/difficulte.md §6, tests 16 à 18).
// 16-17 : simulation de update() de main.js (comme fps-monster.test.js) avec les réglages
// de chaque niveau. 18 : câblage réel de src/main.js avec un DOM factice (sans dépendance) :
// le <select> est lu au début de chaque manche, une valeur inconnue vaut « Normal », un
// change en vue de dessus abandonne la manche sans regénérer le labyrinthe, « Rejouer »
// garde le niveau.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { stepPlayer } from '../../src/game/movement.js';
import { shortestPath } from '../../src/game/pathfinding.js';
import { findExit } from '../../src/game/exit.js';
import {
  GAME_STATUS, createGameState, checkVictory, declareDefeat, isGameOver,
} from '../../src/game/game-state.js';
import { createMonster, stepMonster, isCatching } from '../../src/game/monster.js';
import { DIFFICULTY_IDS, DIFFICULTY_SETTINGS } from '../../src/game/difficulty.js';

const STILL = Object.freeze({ move: 0, strafe: 0, turn: 0, run: false });
const DT = 0.016;

/** Manche simulée : ordre de update() (stepPlayer, checkVictory, stepMonster, isCatching). */
function simulateRound(width, height, seed, id, running) {
  const grid = toTileGrid(generateMaze({ width, height, seed }));
  const exit = findExit(grid);
  const opts = DIFFICULTY_SETTINGS[id].monster;
  const path = shortestPath(grid, 1, 1, exit.tx, exit.ty);
  let waypoint = 1;
  let player = createPlayer(grid);
  let state = createGameState();
  let monster = createMonster(grid, seed, { exit }, opts);
  let time = 0;
  while (!isGameOver(state) && time < 900) {
    let intent = STILL;
    if (running && waypoint < path.length) {
      let tx = path[waypoint].tx + 0.5;
      let ty = path[waypoint].ty + 0.5;
      if (Math.hypot(tx - player.x, ty - player.y) < 0.15 && waypoint < path.length - 1) {
        waypoint++;
        tx = path[waypoint].tx + 0.5;
        ty = path[waypoint].ty + 0.5;
      }
      player = Object.freeze({ ...player, angle: Math.atan2(ty - player.y, tx - player.x) });
      intent = { move: 1, strafe: 0, turn: 0, run: true };
    }
    player = stepPlayer(player, intent, DT, grid);
    state = checkVictory(state, player, exit);
    if (!isGameOver(state)) {
      monster = stepMonster(monster, player, DT, grid, opts).monster;
      if (isCatching(monster, player)) state = declareDefeat(state);
    }
    time += DT;
  }
  return { status: state.status, time };
}

describe('joueur immobile : Cauchemar capture plus tôt que Normal, plus tôt que Facile', () => {
  for (const [w, h, seed] of [[8, 8, 42], [8, 8, 7], [6, 6, 3], [8, 8, 1], [16, 16, 99]]) {
    test(`${w} x ${h}, graine ${seed}`, () => {
      const [easy, normal, nightmare] = DIFFICULTY_IDS.map((id) => simulateRound(w, h, seed, id, false));
      for (const r of [easy, normal, nightmare]) assert.equal(r.status, GAME_STATUS.LOST);
      assert.ok(nightmare.time < normal.time, `cauchemar ${nightmare.time} >= normal ${normal.time}`);
      assert.ok(normal.time < easy.time, `normal ${normal.time} >= facile ${easy.time}`);
      assert.ok(nightmare.time > DIFFICULTY_SETTINGS.nightmare.monster.graceDuration);
    });
  }
});

describe('joueur qui court vers la sortie : WON aux trois niveaux', () => {
  for (const [w, h, seed] of [[16, 16, 42], [8, 8, 42], [16, 16, 99], [8, 8, 1]]) {
    test(`${w} x ${h}, graine ${seed}`, () => {
      for (const id of DIFFICULTY_IDS) {
        assert.equal(simulateRound(w, h, seed, id, true).status, GAME_STATUS.WON, id);
      }
    });
  }
});

// --- Câblage de main.js (DOM factice) ---

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'maze-difficulty', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'sound-toggle-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'end-stat-time', 'end-stat-explored',
  'end-stat-distance', 'replay-button', 'end-new-maze-button',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch',
  'pause-screen', 'pause-message', 'resume-button', 'round-status', 'sound-captions',
];
const HIDDEN_AT_LOAD = new Set([ 'sound-captions',
  'fps-exit-button', 'sound-toggle-button', 'fps-help', 'fps-goal', 'end-screen',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch', 'pause-screen',
]);

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
    ...makeHost(), id, hidden: HIDDEN_AT_LOAD.has(id), replaceChildren(...nodes) { this.children = nodes; }, value: '', style: {},
    width: 300, height: 150, clientWidth: 0, clientHeight: 0,
    parentElement: { clientWidth: 160, clientHeight: 120 },
    classList: makeClassList(), textContent: '',
    setAttribute(n, v) { attrs.set(n, String(v)); },
    getAttribute(n) { return attrs.has(n) ? attrs.get(n) : null; },
    focus() { fakeDocument.activeElement = el; }, blur() {},
    getContext() { return fake2d(); },
    insertAdjacentHTML() {},
  };
  return el;
}
const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
elements.get('maze-difficulty').value = 'normal';
fakeDocument.getElementById = (id) => elements.get(id) ?? null;
fakeDocument.createElement = (tag) => ({ tagName: tag, textContent: '', className: '' });
const el = (id) => elements.get(id);

function fakeParam() {
  return new Proxy({}, { get: () => () => {}, set: () => true });
}
class FakeAudioContext {
  constructor() {
    return {
      currentTime: 0, destination: {},
      resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
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
  }
}
const fakeWindow = makeHost();
fakeWindow.AudioContext = FakeAudioContext;
fakeWindow.webkitAudioContext = FakeAudioContext;

const frames = new Map();
let nextFrame = 1;
let clock = 0;
function runFrames(n, stepMs = 50) {
  let ran = 0;
  for (let i = 0; i < n && frames.size > 0; i++) {
    const [[id, cb]] = frames;
    frames.delete(id);
    clock += stepMs;
    cb(clock);
    ran++;
  }
  return ran;
}
const endShown = () => el('end-screen').hidden === false;
const enter = () => el('fps-enter-button').dispatch('click', {});
const exit = () => el('fps-exit-button').dispatch('click', {});
const changeDifficulty = (value) => {
  el('maze-difficulty').value = value;
  el('maze-difficulty').dispatch('change', {});
};
/** Joueur immobile : nombre d'images jusqu'à la capture (écran de fin), plafonné. */
function framesUntilEnd(limit = 20000) {
  let n = 0;
  while (!endShown() && n < limit && frames.size > 0) n += runFrames(1);
  assert.ok(endShown(), `pas de fin de manche en ${n} images`);
  return n;
}
/** Manche neuve au niveau donné depuis la vue de dessus, jusqu'à la capture. */
function freshRound(value) {
  changeDifficulty(value);
  enter();
  const n = framesUntilEnd();
  exit();
  return n;
}

const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Element'];
const saved = {};

describe('câblage main.js : select #maze-difficulty (DOM factice)', () => {
  const ref = {};

  before(async () => {
    for (const n of GLOBALS) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);
    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.Element = FakeElement;
    globalThis.requestAnimationFrame = (cb) => { const id = nextFrame++; frames.set(id, cb); return id; };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    await import('../../src/main.js');
    // 8 x 8 graine 42 : immobile, Facile > Normal > Cauchemar en temps de capture.
    el('maze-width').value = '8';
    el('maze-height').value = '8';
    el('maze-seed').value = '42';
    el('maze-form').dispatch('submit', { preventDefault() {} });
    assert.equal(el('maze-error').textContent, '');
  });
  after(() => {
    for (const n of GLOBALS) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n];
    }
  });

  test('niveau lu au début de la manche : Cauchemar < Normal < Facile, déterministe', () => {
    for (const id of DIFFICULTY_IDS) ref[id] = freshRound(id);
    assert.ok(ref.nightmare < ref.normal, `cauchemar ${ref.nightmare} >= normal ${ref.normal}`);
    assert.ok(ref.normal < ref.easy, `normal ${ref.normal} >= facile ${ref.easy}`);
    assert.equal(freshRound('nightmare'), ref.nightmare, 'même niveau, même manche');
  });

  test('valeur inconnue du select : aucune exception, manche au niveau Normal', () => {
    for (const v of ['hard', '', '__proto__', 'Normal']) {
      let n;
      assert.doesNotThrow(() => { n = freshRound(v); }, v);
      assert.equal(n, ref.normal, `valeur ${JSON.stringify(v)}`);
      assert.equal(el('maze-error').textContent, '');
    }
  });

  test('change en vue de dessus : labyrinthe conservé (#maze-info identique), manche abandonnée', () => {
    changeDifficulty('normal');
    enter();
    runFrames(20);
    assert.equal(endShown(), false);
    exit();
    const info = el('maze-info').textContent;
    assert.ok(info.length > 0);
    changeDifficulty('easy');
    assert.equal(el('maze-info').textContent, info, 'labyrinthe regénéré');
    assert.equal(frames.size, 0, 'change ne relance pas la boucle');
    // Manche neuve en Facile : même durée que la référence Facile (pas la suite de la
    // manche Normale entamée, qui finirait vers ref.normal - 20 images).
    enter();
    assert.equal(framesUntilEnd(), ref.easy);
    exit();
    assert.equal(el('maze-info').textContent, info);
  });

  test('sans change, la manche interrompue reprend (contrôle du test précédent)', () => {
    changeDifficulty('normal');
    enter();
    runFrames(20);
    exit();
    // Re-sélection de la même valeur sans événement change : aucun abandon.
    enter();
    const rest = framesUntilEnd();
    assert.ok(rest < ref.normal, `manche non reprise : ${rest} images`);
    exit();
  });

  test('« Rejouer » garde le niveau choisi', () => {
    changeDifficulty('nightmare');
    enter();
    assert.equal(framesUntilEnd(), ref.nightmare);
    el('replay-button').dispatch('click', {});
    assert.equal(endShown(), false);
    assert.equal(framesUntilEnd(), ref.nightmare);
    exit();
  });
});
