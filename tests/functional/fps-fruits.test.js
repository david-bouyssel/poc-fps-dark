// Flux bout en bout des fruits et du score, d'après le plan docs/design/fps-fruits-score.md
// (§1 cycle de vie, §3 main.js, §4 flux UI, §6 plan de tests).
// 1. Flux Node pur : generateMaze -> placeFruits -> createFruitState -> parcours de toutes
//    les cellules avec stepPlayer et la boucle à faux requestFrame, collectFruits à chaque
//    update.
// 2. Câblage réel de src/main.js sous un DOM factice minimal : HUD visible en FPS seulement,
//    masqué en carte plein écran, score conservé en sortie/retour, remis à zéro à la
//    génération.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, isWallTile } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { actionForCode, computeIntent } from '../../src/game/input.js';
import { stepPlayer } from '../../src/game/movement.js';
import { createGameLoop } from '../../src/game/loop.js';
import { placeFruits, createFruitState, collectFruits, pointsFor } from '../../src/game/fruits.js';
import { t } from '../../src/i18n/i18n.js';

const SIZE = 8;
const FRAME_MS = 16;
const TWO_PI = 2 * Math.PI;

function fakeFrames() {
  let id = 0;
  let pending = null;
  return {
    requestFrame(cb) { pending = cb; return ++id; },
    cancelFrame() { pending = null; },
    tick(time) {
      const cb = pending;
      pending = null;
      if (cb) cb(time);
      return cb !== null;
    },
  };
}

/** Parcours en profondeur (aller et retour) qui passe par toutes les cellules. */
function fullTour(grid, w, h) {
  const seen = new Uint8Array(w * h);
  const tour = [];
  function visit(c) {
    seen[c] = 1;
    tour.push(c);
    const cx = c % w;
    const cy = Math.floor(c / w);
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (isWallTile(grid, 2 * cx + 1 + dx, 2 * cy + 1 + dy)) continue;
      const n = ny * w + nx;
      if (seen[n]) continue;
      visit(n);
      tour.push(c);
    }
  }
  visit(0);
  assert.equal(seen.reduce((s, v) => s + v, 0), w * h, 'labyrinthe non parfait');
  return tour.map((c) => [c % w, Math.floor(c / w)]);
}

const center = ([cx, cy]) => [2 * cx + 1.5, 2 * cy + 1.5];

function angleDiff(target, current) {
  let d = (target - current) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

for (const seed of [42, 7, 2024]) {
  describe(`fruits 8x8 graine ${seed} : parcours complet`, () => {
    const maze = generateMaze({ width: SIZE, height: SIZE, seed });
    const grid = toTileGrid(maze);
    const placed = placeFruits(maze);

    test('le parcours ramasse tous les fruits, score = somme des points', () => {
      const tour = fullTour(grid, SIZE, SIZE);
      let player = createPlayer(grid);
      let state = createFruitState(placed);
      assert.equal(state.score, 0);
      assert.equal(state.collected, 0);
      assert.equal(state.total, placed.length);
      assert.ok(state.total > 0);

      let waypoint = 1;
      let frame = 0;
      let changes = 0;
      const pressed = new Set();

      function pilot() {
        pressed.clear();
        if (waypoint >= tour.length) return;
        let [tx, ty] = center(tour[waypoint]);
        if (Math.hypot(tx - player.x, ty - player.y) < 0.15) {
          waypoint++;
          if (waypoint >= tour.length) return;
          [tx, ty] = center(tour[waypoint]);
        }
        const diff = angleDiff(Math.atan2(ty - player.y, tx - player.x), player.angle);
        pressed.add(actionForCode(Math.abs(diff) > 0.05 ? (diff > 0 ? 'ArrowRight' : 'ArrowLeft') : 'KeyW'));
      }

      const frames = fakeFrames();
      const loop = createGameLoop({
        update(dt) {
          pilot();
          player = stepPlayer(player, computeIntent(pressed), dt, grid);
          const next = collectFruits(state, player);
          if (next !== state) {
            changes++;
            const gained = state.fruits.filter((f) => !next.fruits.includes(f));
            assert.ok(gained.length >= 1, 'nouvel état sans fruit ramassé');
            assert.equal(next.collected, state.collected + gained.length);
            assert.equal(next.score, state.score + gained.reduce((s, f) => s + pointsFor(f.kind), 0));
            for (const f of gained) {
              assert.ok(Math.hypot(f.x - player.x, f.y - player.y) <= 0.5, 'ramassé hors du rayon');
            }
            state = next;
          }
        },
        render() {
          frame++;
          assert.equal(state.fruits.length + state.collected, state.total);
        },
        requestFrame: frames.requestFrame,
        cancelFrame: frames.cancelFrame,
      });

      loop.start();
      let time = 1000;
      while (waypoint < tour.length && frame < 60000) {
        assert.ok(frames.tick(time));
        time += FRAME_MS;
      }
      loop.stop();

      assert.ok(waypoint >= tour.length, `parcours inachevé (${waypoint}/${tour.length})`);
      assert.equal(state.collected, state.total, `restants : ${JSON.stringify(state.fruits)}`);
      assert.equal(state.fruits.length, 0);
      assert.equal(state.score, placed.reduce((s, f) => s + pointsFor(f.kind), 0));
      assert.ok(changes >= 1 && changes <= state.total);
    });

    test('regénérer la même graine -> mêmes fruits, nouvel état à 0', () => {
      const again = placeFruits(generateMaze({ width: SIZE, height: SIZE, seed }));
      assert.deepEqual(again, placed);
      const fresh = createFruitState(again);
      assert.equal(fresh.score, 0);
      assert.equal(fresh.collected, 0);
      assert.equal(fresh.total, placed.length);
    });
  });
}

// --- Câblage de src/main.js (DOM factice) ---

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'fps-help',
  'fps-hud', 'fps-score', 'fps-all-collected', 'fps-fruit-legend',
];
const HIDDEN_AT_LOAD = new Set(['fps-exit-button', 'fps-help', 'fps-hud', 'fps-all-collected']);

function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'createImageData' || prop === 'getImageData') {
        return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
      }
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; },
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
  return {
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
    focus() {},
    blur() {},
    getContext() { return fakeContext(); },
  };
}

describe('main.js : HUD, cycle de vie du score (DOM factice)', () => {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
  const el = (id) => elements.get(id);
  const fakeWindow = makeListenerHost();
  const fakeDocument = {
    ...makeListenerHost(),
    title: '',
    hidden: false,
    activeElement: null,
    getElementById: (id) => elements.get(id) ?? null,
    querySelectorAll: () => [],
  };
  const frames = new Map();
  let nextFrameId = 1;
  let clock = 1000;
  const saved = {};
  const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'];

  const key = (type, code) => {
    fakeWindow.dispatch(type, {
      code, key: code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      repeat: false, preventDefault() {},
    });
  };
  const tap = (code) => { key('keydown', code); key('keyup', code); };
  const runFrame = () => {
    const [[id, cb]] = frames;
    frames.delete(id);
    cb(clock);
    clock += FRAME_MS;
  };
  const submit = (width, height, seed) => {
    el('maze-width').value = String(width);
    el('maze-height').value = String(height);
    el('maze-seed').value = String(seed);
    el('maze-form').dispatch('submit', { preventDefault() {} });
    assert.equal(el('maze-error').textContent, '', 'erreur de génération');
  };
  const enter = () => el('fps-enter-button').dispatch('click', {});
  const scoreText = (score, collected, total) => t('fps.score', { score, collected, total });

  // Graine 2 x 2 dont l'unique fruit est dans la cellule voisine face au départ.
  let seed;
  let fruit;

  before(async () => {
    for (let s = 1; s < 5000 && seed === undefined; s++) {
      const maze = generateMaze({ width: 2, height: 2, seed: s });
      const start = createPlayer(toTileGrid(maze));
      const ahead = start.angle === 0 ? [1, 0] : [0, 1];
      const [f] = placeFruits(maze);
      if (f.cellX === ahead[0] && f.cellY === ahead[1]) {
        seed = s;
        fruit = f;
      }
    }
    assert.notEqual(seed, undefined, 'aucune graine adaptée');

    for (const name of GLOBALS) saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.requestAnimationFrame = (cb) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    await import('../../src/main.js');
  });

  after(() => {
    for (const name of GLOBALS) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  });

  test('chargement : HUD masqué en vue de dessus, légende des points construite', () => {
    assert.equal(el('fps-hud').hidden, true);
    const legend = el('fps-fruit-legend').textContent;
    for (const [kind, points] of [['strawberry', 10], ['cherry', 25], ['peach', 50], ['dragonfruit', 100]]) {
      assert.ok(legend.includes(t('fps.fruitPoints', { name: t(`fruit.${kind}`), points })), `légende : ${legend}`);
    }
    assert.ok(legend.includes(t('fps.legendSeparator')));
  });

  test('génération : score 0, HUD toujours masqué hors FPS', () => {
    submit(2, 2, seed);
    assert.equal(el('fps-score').textContent, scoreText(0, 0, 1));
    assert.equal(el('fps-all-collected').hidden, true);
    assert.equal(el('fps-hud').hidden, true);
  });

  test('entrée en FPS : HUD visible ; carte plein écran (M) : HUD masqué ; M à nouveau : visible', () => {
    enter();
    assert.equal(el('fps-hud').hidden, false, 'HUD masqué en FPS');
    tap('KeyM');
    assert.equal(el('fps-hud').hidden, true, 'HUD visible en carte plein écran');
    tap('KeyM');
    assert.equal(el('fps-hud').hidden, false, 'HUD masqué après fermeture de la carte');
    tap('Semicolon'); // M en AZERTY
    assert.equal(el('fps-hud').hidden, true);
    tap('Semicolon');
    assert.equal(el('fps-hud').hidden, false);
  });

  test('ramassage en avançant : score et compteur, message « tous ramassés »', () => {
    assert.equal(frames.size, 1);
    key('keydown', 'KeyW');
    for (let i = 0; i < 600 && el('fps-score').textContent === scoreText(0, 0, 1); i++) runFrame();
    key('keyup', 'KeyW');
    assert.equal(el('fps-score').textContent, scoreText(pointsFor(fruit.kind), 1, 1));
    assert.equal(el('fps-all-collected').hidden, false, 'message non affiché');
    assert.equal(el('fps-hud').hidden, false);
  });

  test('sortie (Échap) : HUD masqué ; réentrée : même score', () => {
    const before = el('fps-score').textContent;
    tap('Escape');
    assert.equal(el('fps-hud').hidden, true, 'HUD visible en vue de dessus');
    enter();
    assert.equal(el('fps-hud').hidden, false);
    assert.equal(el('fps-score').textContent, before, 'score perdu à la réentrée');
    assert.equal(el('fps-all-collected').hidden, false);
    for (let i = 0; i < 10; i++) runFrame();
    assert.equal(el('fps-score').textContent, before, 'fruit ramassé deux fois');
  });

  test('sortie carte plein écran ouverte puis réentrée : HUD visible', () => {
    tap('KeyM');
    assert.equal(el('fps-hud').hidden, true);
    tap('Escape');
    assert.equal(el('fps-hud').hidden, true);
    enter();
    assert.equal(el('fps-hud').hidden, false, 'HUD masqué à la réentrée (mode carte non réinitialisé)');
    tap('Escape');
  });

  test('regénérer la même graine : score remis à 0, mêmes fruits (total identique)', () => {
    submit(2, 2, seed);
    assert.equal(el('fps-score').textContent, scoreText(0, 0, 1));
    assert.equal(el('fps-all-collected').hidden, true, 'message toujours affiché');
    enter();
    key('keydown', 'KeyW');
    for (let i = 0; i < 600 && el('fps-score').textContent === scoreText(0, 0, 1); i++) runFrame();
    key('keyup', 'KeyW');
    assert.equal(el('fps-score').textContent, scoreText(pointsFor(fruit.kind), 1, 1), 'même fruit au même endroit');
    tap('Escape');
  });

  test('« Nouveau labyrinthe » : score remis à 0', () => {
    el('maze-width').value = '8';
    el('maze-height').value = '8';
    el('new-maze-button').dispatch('click', {});
    assert.equal(el('maze-error').textContent, '');
    assert.equal(el('fps-score').textContent, scoreText(0, 0, 8));
    assert.equal(el('fps-all-collected').hidden, true);
    assert.equal(el('fps-hud').hidden, true);
  });
});
