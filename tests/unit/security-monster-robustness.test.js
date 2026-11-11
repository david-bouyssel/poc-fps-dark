// Tests de sécurité / robustesse du monstre (T5, testeur-securite) : entrées hostiles de
// src/game/monster.js (grilles malformées, NaN, Infinity, dt négatif ou énorme, monstres
// forgés, joueur hors grille, objets gelés), borne de travail par appel, déterminisme par
// graine, pureté (aucune mutation des entrées, sorties gelées), scan statique (pas de
// Math.random, Date, DOM, réseau, stockage, log), et câblage réel dans src/main.js sous
// un DOM factice (pas d'écriture HTML, monstre figé hors FPS, défaite déclarée une fois).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, isWallTile } from '../../src/maze/grid.js';
import { createRng, randomInt, MAX_SEED } from '../../src/maze/random.js';
import { t } from '../../src/i18n/i18n.js';
import {
  createMonster, stepMonster, isCatching, monsterSprite, MONSTER, MONSTER_MODE,
} from '../../src/game/monster.js';

const isTypeOrRange = (e) => e instanceof TypeError || e instanceof RangeError;
const HOSTILE_NUMBERS = [NaN, Infinity, -Infinity, '1', null, true, {}, [], 1n];

function realGrid(width = 6, height = 5, seed = 42) {
  return toTileGrid(generateMaze({ width, height, seed }));
}

function hostileGrids() {
  const g = realGrid();
  return [
    null, undefined, 0, 'grid', [], {},
    { width: NaN, height: g.height, tiles: g.tiles },
    { width: Infinity, height: g.height, tiles: g.tiles },
    { width: g.width + 0.5, height: g.height, tiles: g.tiles },
    { width: -g.width, height: -g.height, tiles: g.tiles },
    { width: '13', height: g.height, tiles: g.tiles },
    { width: g.width, height: g.height, tiles: null },
    { width: g.width, height: g.height, tiles: 'x'.repeat(g.width * g.height) },
    { width: g.width, height: g.height, tiles: g.tiles.subarray(1) },
    { width: g.width, height: g.height },
    { width: 0, height: 0, tiles: new Uint8Array(0) },
  ];
}

function snapshot(value) {
  return structuredClone(value);
}

/** Positions sols (centres de tuiles) d'une grille. */
function floorCenters(grid) {
  const result = [];
  for (let ty = 0; ty < grid.height; ty += 1) {
    for (let tx = 0; tx < grid.width; tx += 1) {
      if (!isWallTile(grid, tx, ty)) result.push({ x: tx + 0.5, y: ty + 0.5 });
    }
  }
  return result;
}

/** Monstre après la grâce (graceRemaining = 0), pour tester le déplacement. */
function awake(grid, seed = 7) {
  return { ...createMonster(grid, seed), graceRemaining: 0 };
}

/** Invariants de sécurité d'un état : sol, voisin 4-connexe, valeurs finies, gelé. */
function assertSafeState(m, grid) {
  assert.ok(Object.isFrozen(m), 'état gelé');
  assert.ok(!isWallTile(grid, m.tx, m.ty), 'tuile courante sol');
  assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y), 'position finie');
  assert.ok(m.progress >= 0 && m.progress < 1, 'progress dans [0, 1)');
  assert.ok(Number.isInteger(m.rngState) && m.rngState >= 0 && m.rngState <= MAX_SEED);
  if (m.nextTx !== null) {
    assert.ok(!isWallTile(grid, m.nextTx, m.nextTy), 'tuile visée sol');
    assert.equal(Math.abs(m.nextTx - m.tx) + Math.abs(m.nextTy - m.ty), 1, 'voisine 4-connexe');
  }
}

describe('createMonster : entrées hostiles', () => {
  const grid = realGrid();

  test('grilles malformées : TypeError/RangeError', () => {
    for (const g of hostileGrids()) {
      assert.throws(() => createMonster(g, 1), isTypeOrRange);
    }
  });

  test('graine hostile : TypeError/RangeError', () => {
    for (const seed of [...HOSTILE_NUMBERS, undefined, -1, 1.5, MAX_SEED + 1, 2 ** 53]) {
      assert.throws(() => createMonster(grid, seed), isTypeOrRange, String(seed));
    }
  });

  test('placement / exit hostiles : TypeError', () => {
    for (const placement of [null, 0, 'exit', true]) {
      assert.throws(() => createMonster(grid, 1, placement), TypeError);
    }
    for (const exit of [0, 'x', {}, { tx: NaN, ty: 1 }, { tx: 1, ty: Infinity }, { tx: '1', ty: 1 },
      { tx: 1.5, ty: 1 }]) {
      assert.throws(() => createMonster(grid, 1, { exit }), TypeError);
    }
  });

  test('options hostiles : TypeError/RangeError, prototype pollué sans effet silencieux', () => {
    for (const options of [null, 0, 'x', true]) {
      assert.throws(() => createMonster(grid, 1, {}, options), TypeError);
    }
    for (const value of [NaN, Infinity, -Infinity, -1, '1', null, true, 1n]) {
      for (const key of Object.keys(MONSTER)) {
        assert.throws(() => createMonster(grid, 1, {}, { [key]: value }), RangeError, `${key}=${String(value)}`);
      }
    }
    // Clé __proto__ venue d'un JSON : propriété propre, ignorée, sans pollution globale.
    const fromJson = JSON.parse('{"__proto__": {"graceDuration": 999}}');
    assert.equal(createMonster(grid, 1, {}, fromJson).graceRemaining, MONSTER.graceDuration);
    assert.equal({}.graceDuration, undefined);
  });

  test('grille sans départ (1, 1) sol, ou sans candidat : erreur, jamais de boucle', () => {
    const walls = { width: 5, height: 5, tiles: new Uint8Array(25).fill(1) };
    assert.throws(() => createMonster(walls, 1), RangeError);
    const lonely = { width: 3, height: 3, tiles: Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 1]) };
    assert.throws(() => createMonster(lonely, 1), RangeError);
  });

  test('entrées gelées acceptées et non modifiées ; sortie gelée ; déterministe', () => {
    const g = realGrid(8, 8, 3);
    const tilesBefore = Uint8Array.from(g.tiles);
    const frozenGrid = Object.freeze({ width: g.width, height: g.height, tiles: g.tiles });
    const placement = Object.freeze({ exit: Object.freeze({ tx: 0, ty: 1 }) });
    const options = Object.freeze({ graceDuration: 1 });
    const a = createMonster(frozenGrid, 123, placement, options);
    const b = createMonster(frozenGrid, 123, placement, options);
    assert.deepEqual(a, b);
    assert.ok(Object.isFrozen(a));
    assert.deepEqual(g.tiles, tilesBefore);
    assertSafeState(a, g);
  });
});

describe('stepMonster : entrées hostiles', () => {
  const grid = realGrid(8, 8, 11);
  const player = Object.freeze({ x: 1.5, y: 1.5 });

  test('dt hostile (NaN, négatif, non numérique) : même référence, aucun événement', () => {
    const m = awake(grid);
    for (const dt of [NaN, -1, -Infinity, -1e308, 0, -0, '0.1', null, undefined, true, {}, 1n]) {
      const r = stepMonster(m, player, dt, grid);
      assert.equal(r.monster, m, String(dt));
      assert.equal(r.events.length, 0);
      assert.ok(Object.isFrozen(r) && Object.isFrozen(r.events));
    }
  });

  test('dt énorme ou Infinity : borné à maxDt (même résultat que dt = maxDt)', () => {
    const m = awake(grid);
    const ref = stepMonster(m, player, MONSTER.maxDt, grid);
    for (const dt of [Infinity, 1e308, 1e6, 10]) {
      assert.deepEqual(stepMonster(m, player, dt, grid), ref, String(dt));
    }
  });

  test('joueur hostile : TypeError', () => {
    const m = awake(grid);
    for (const p of [null, undefined, 1, 'p', {}, { x: NaN, y: 1 }, { x: 1, y: Infinity },
      { x: '1', y: 1 }, { x: 1n, y: 1 }]) {
      assert.throws(() => stepMonster(m, p, 0.1, grid), TypeError);
    }
  });

  test('joueur hors grille ou dans un mur (fini) : aucune exception, errance, distance Infinity', () => {
    for (const p of [{ x: -1e9, y: 3 }, { x: 1e300, y: -1e300 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 1.5 }]) {
      const r = stepMonster(awake(grid), p, 0.1, grid);
      assert.equal(r.monster.mode, MONSTER_MODE.WANDER);
      assert.equal(r.monster.pathDistance, Infinity);
      assertSafeState(r.monster, grid);
    }
  });

  test('grilles malformées : TypeError/RangeError', () => {
    const m = awake(grid);
    for (const g of hostileGrids()) {
      assert.throws(() => stepMonster(m, player, 0.1, g), isTypeOrRange);
    }
  });

  test('monstres forgés : TypeError, jamais d\'état hors sol accepté', () => {
    const base = awake(grid);
    const moving = stepMonster(base, player, 0.05, grid).monster;
    assert.notEqual(moving.nextTx, null, 'précondition : monstre en mouvement');
    const forged = [
      null, undefined, 1, 'm', {},
      { ...base, tx: 0, ty: 0 }, // mur
      { ...base, tx: -1 }, { ...base, tx: grid.width }, { ...base, tx: NaN }, { ...base, tx: 1.5 },
      { ...base, tx: '1' },
      { ...moving, nextTx: null }, // nextTx null mais nextTy non null
      { ...moving, nextTx: 0, nextTy: 0 }, // tuile visée mur
      { ...moving, progress: 1 }, { ...moving, progress: -0.1 }, { ...moving, progress: NaN },
      { ...moving, progress: Infinity },
      { ...base, progress: 0.5 }, // arrêté mais progress != 0
      { ...base, fromTx: 1, fromTy: null }, { ...base, fromTx: NaN, fromTy: 1 },
      { ...base, mode: 'attack' }, { ...base, mode: undefined },
      { ...base, heading: 'Z' }, { ...base, heading: 0 },
      { ...base, pathDistance: NaN }, { ...base, pathDistance: -1 }, { ...base, pathDistance: '1' },
      { ...base, graceRemaining: Infinity }, { ...base, graceRemaining: NaN },
      { ...base, graceRemaining: -1 },
      { ...base, rngState: -1 }, { ...base, rngState: MAX_SEED + 1 }, { ...base, rngState: 1.5 },
      { ...base, rngState: NaN },
    ];
    for (const m of forged) {
      assert.throws(() => stepMonster(m, player, 0.1, grid), TypeError, JSON.stringify(m));
    }
  });

  test('monstre forgé : tuile visée sol mais non voisine (téléportation à travers les murs) refusée', () => {
    const base = awake(grid);
    const floors = floorCenters(grid)
      .map((p) => ({ tx: Math.floor(p.x), ty: Math.floor(p.y) }))
      .filter((f) => Math.abs(f.tx - base.tx) + Math.abs(f.ty - base.ty) > 1);
    const far = floors[floors.length - 1];
    const m = { ...base, nextTx: far.tx, nextTy: far.ty, progress: 0.5 };
    assert.throws(() => stepMonster(m, player, 0.1, grid), TypeError,
      'nextTx/nextTy doit être voisin 4-connexe de (tx, ty) (plan §3, MonsterState)');
  });

  test('options extrêmes : au plus 8 itérations par appel, état sûr, pas de boucle', () => {
    const big = realGrid(64, 64, 5);
    const target = { x: big.width - 1.5, y: big.height - 1.5 };
    for (const options of [
      { wanderSpeed: 1e300, chaseSpeed: 1e300, maxDt: 1e300 },
      { wanderSpeed: Number.MIN_VALUE, chaseSpeed: Number.MIN_VALUE },
      { wanderSpeed: 0, chaseSpeed: 0 },
      { chaseDistance: 1e300, chaseHysteresis: 1e300, maxDt: 1e300, chaseSpeed: 1e300 },
    ]) {
      const m = awake(big);
      const start = Date.now();
      const r = stepMonster(m, target, 1e300, big, options);
      assert.ok(Date.now() - start < 2000, 'appel borné en temps');
      assert.ok(r.events.length <= 8, 'au plus 8 décisions par pas');
      assert.ok(Math.abs(r.monster.tx - m.tx) + Math.abs(r.monster.ty - m.ty) <= 8, 'au plus 8 tuiles');
      assertSafeState(r.monster, big);
    }
  });

  test('charge : 64 x 64, 3 000 pas en traque (un BFS par arrivée) en temps borné', () => {
    const big = realGrid(64, 64, 9);
    const floors = floorCenters(big);
    const rng = createRng(2024);
    let m = awake(big, 9);
    const start = Date.now();
    for (let i = 0; i < 3000; i += 1) {
      const p = floors[randomInt(rng, floors.length)];
      m = stepMonster(m, p, 0.1, big, { chaseDistance: 1e9 }).monster;
    }
    assert.ok(Date.now() - start < 15000, `3 000 pas trop lents : ${Date.now() - start} ms`);
    assertSafeState(m, big);
  });
});

describe('stepMonster : pureté, invariants, déterminisme', () => {
  test('marche hostile de 4 000 pas : entrées non modifiées, états sûrs, sorties gelées', () => {
    const grid = realGrid(10, 9, 77);
    const tilesBefore = Uint8Array.from(grid.tiles);
    const floors = floorCenters(grid);
    const rng = createRng(99);
    const dts = [0.016, 0.1, 1, -1, NaN, Infinity, 0, 0.033];
    let m = createMonster(grid, 77);
    for (let i = 0; i < 4000; i += 1) {
      const p = Object.freeze({ ...floors[randomInt(rng, floors.length)] });
      const before = snapshot(m);
      const r = stepMonster(m, p, dts[i % dts.length], grid);
      assert.deepEqual(m, before, 'monstre d\'entrée non modifié');
      assert.ok(Object.isFrozen(r) && Object.isFrozen(r.events));
      for (const e of r.events) {
        assert.ok(Object.isFrozen(e));
        assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
      }
      assertSafeState(r.monster, grid);
      m = r.monster;
    }
    assert.deepEqual(grid.tiles, tilesBefore, 'grille non modifiée');
  });

  test('déterminisme : même graine et mêmes entrées -> même suite d\'états et d\'événements', () => {
    const grid = realGrid(12, 12, 4);
    const run = () => {
      const out = [];
      let m = createMonster(grid, 4);
      for (let i = 0; i < 600; i += 1) {
        const r = stepMonster(m, { x: 1.5, y: 1.5 }, 0.05, grid);
        out.push(r);
        m = r.monster;
      }
      return out;
    };
    assert.deepEqual(run(), run());
  });

  test('aucune dépendance au hasard global : Math.random et Date neutralisés', () => {
    const grid = realGrid(8, 8, 1);
    const reference = [];
    let m = createMonster(grid, 1);
    for (let i = 0; i < 200; i += 1) {
      m = stepMonster(m, { x: 1.5, y: 1.5 }, 0.1, grid).monster;
      reference.push(m);
    }
    const savedRandom = Math.random;
    const savedNow = Date.now;
    Math.random = () => { throw new Error('Math.random appelé'); };
    Date.now = () => { throw new Error('Date.now appelé'); };
    try {
      let m2 = createMonster(grid, 1);
      for (let i = 0; i < 200; i += 1) {
        m2 = stepMonster(m2, { x: 1.5, y: 1.5 }, 0.1, grid).monster;
        assert.deepEqual(m2, reference[i]);
      }
    } finally {
      Math.random = savedRandom;
      Date.now = savedNow;
    }
  });
});

describe('isCatching / monsterSprite : entrées hostiles', () => {
  const ok = { x: 1.5, y: 1.5 };

  test('positions et rayon hostiles : TypeError', () => {
    for (const p of [null, undefined, {}, { x: NaN, y: 1 }, { x: 1, y: -Infinity }, { x: '1', y: 1 }]) {
      assert.throws(() => isCatching(p, ok), TypeError);
      assert.throws(() => isCatching(ok, p), TypeError);
      assert.throws(() => monsterSprite(p), TypeError);
    }
    for (const radius of [NaN, Infinity, -1, '1', null, 1n]) {
      assert.throws(() => isCatching(ok, ok, radius), TypeError, String(radius));
    }
  });

  test('positions extrêmes finies : pas de débordement en vrai positif', () => {
    assert.equal(isCatching({ x: 1e308, y: 1e308 }, { x: -1e308, y: -1e308 }), false);
    assert.equal(isCatching({ x: Number.MAX_VALUE, y: 0 }, { x: 0, y: 0 }), false);
  });

  test('sprite gelé, sans référence vers l\'état', () => {
    const s = monsterSprite(Object.freeze({ x: 2.5, y: 3.5 }));
    assert.ok(Object.isFrozen(s));
    assert.deepEqual(Object.keys(s).sort(), ['kind', 'x', 'y']);
  });
});

describe('scan statique', () => {
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('monster.js : pur (pas de hasard global, horloge, DOM, réseau, stockage, log, eval)', () => {
    const code = stripComments(read('../../src/game/monster.js'));
    const forbidden = [
      /Math\.random/, /\bDate\b/, /performance\./, /\bdocument\b/, /\bwindow\b/, /globalThis/,
      /\bfetch\b/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /localStorage/,
      /sessionStorage/, /indexedDB/, /document\.cookie/, /\bconsole\./, /\beval\b/,
      /new\s+Function/, /setTimeout|setInterval/, /import\s*\(/, /innerHTML|outerHTML|insertAdjacentHTML/,
    ];
    for (const re of forbidden) assert.doesNotMatch(code, re, String(re));
    for (const [, spec] of code.matchAll(/from\s+'([^']+)'/g)) {
      assert.match(spec, /^\.\.?\//, `import relatif : ${spec}`);
    }
  });

  test('main.js : aucun sink HTML, réseau, stockage, log ; ordre victoire puis monstre', () => {
    const code = stripComments(read('../../src/main.js'));
    for (const re of [/innerHTML|outerHTML|insertAdjacentHTML|document\.write/, /\beval\b|new\s+Function/,
      /\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon/, /localStorage|sessionStorage|indexedDB|document\.cookie/,
      /\bconsole\./, /Math\.random/]) {
      assert.doesNotMatch(code, re, String(re));
    }
    const victory = code.indexOf('checkVictory(gameState');
    const guard = code.indexOf('if (!isGameOver(gameState))', victory);
    const step = code.indexOf('stepMonster(', guard);
    assert.ok(victory > 0 && guard > victory && step > guard,
      'stepMonster appelé après checkVictory, sous garde !isGameOver');
  });
});

// ---------------------------------------------------------------------------------------
// Câblage réel de main.js sous un DOM factice minimal.

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'replay-button', 'end-new-maze-button',
];
const HIDDEN_AT_LOAD = new Set(['fps-exit-button', 'fps-help', 'fps-goal', 'end-screen']);
const htmlWrites = [];
const endTitleWrites = [];

function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'getImageData' || prop === 'createImageData') {
        return (a, b, w = 1, h = 1) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      }
      return () => {};
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
  let text = '';
  const element = {
    ...makeListenerHost(),
    id,
    hidden: HIDDEN_AT_LOAD.has(id),
    value: '',
    style: {},
    width: 300,
    height: 150,
    clientWidth: 0,
    clientHeight: 0,
    parentElement: { clientWidth: 320, clientHeight: 240 },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    focus() {},
    blur() {},
    getContext() { return fakeContext(); },
    insertAdjacentHTML() { htmlWrites.push(`${id}.insertAdjacentHTML`); },
  };
  Object.defineProperty(element, 'textContent', {
    get() { return text; },
    set(value) {
      text = String(value);
      if (id === 'end-title') endTitleWrites.push(text);
    },
  });
  for (const prop of ['innerHTML', 'outerHTML']) {
    Object.defineProperty(element, prop, {
      get() { return ''; },
      set() { htmlWrites.push(`${id}.${prop}`); },
    });
  }
  return element;
}

describe('main.js : câblage du monstre (DOM factice)', () => {
  const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
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
  let clock = 0;
  const saved = {};
  const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'];

  const runFrame = () => {
    const [[id, cb]] = frames;
    frames.delete(id);
    clock += 100; // dt = 0.1 s
    cb(clock);
  };
  const enter = () => elements.get('fps-enter-button').dispatch('click', {});
  const exit = () => elements.get('fps-exit-button').dispatch('click', {});
  const endScreen = () => elements.get('end-screen');

  before(async () => {
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
    // Petit labyrinthe : le monstre est toujours à portée de traque du joueur immobile.
    elements.get('maze-width').value = '2';
    elements.get('maze-height').value = '2';
    elements.get('maze-seed').value = '5';
    elements.get('maze-form').dispatch('submit', { preventDefault() {} });
    assert.equal(elements.get('maze-error').textContent, '');
  });

  after(() => {
    for (const name of GLOBALS) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  });

  test('vue de dessus : aucune boucle, donc monstre figé', () => {
    assert.equal(frames.size, 0);
  });

  test('sortie de FPS pendant la manche : boucle arrêtée (monstre figé), aucune défaite', () => {
    enter();
    assert.equal(frames.size, 1);
    for (let i = 0; i < 5; i += 1) runFrame();
    exit();
    assert.equal(frames.size, 0, 'plus aucune image en attente hors FPS');
    assert.equal(endScreen().hidden, true);
    assert.equal(endTitleWrites.length, 0);
  });

  test('joueur immobile rattrapé : défaite déclarée une seule fois, boucle arrêtée', () => {
    enter();
    let n = 0;
    while (frames.size > 0 && n < 2000) {
      runFrame();
      n += 1;
    }
    assert.equal(frames.size, 0, 'boucle arrêtée après la capture');
    assert.ok(n < 2000, 'capture atteinte');
    assert.equal(endScreen().hidden, false);
    assert.deepEqual(endTitleWrites, [t('end.lostTitle')], 'écran de fin écrit une seule fois');
    // Clics et touches après la fin : pas de nouvelle défaite ni de reprise de boucle.
    enter();
    fakeWindow.dispatch('keydown', { code: 'KeyW', key: 'w', preventDefault() {} });
    assert.equal(frames.size, 0);
    assert.equal(endTitleWrites.length, 1);
  });

  test('rejouer : nouvelle manche, monstre recréé (grâce), aucune défaite immédiate', () => {
    elements.get('replay-button').dispatch('click', {});
    assert.equal(endScreen().hidden, true);
    for (let i = 0; i < 20; i += 1) runFrame(); // 2 s < grâce de 3 s
    assert.equal(frames.size, 1);
    assert.equal(endTitleWrites.length, 1);
  });

  test('aucune écriture HTML pendant tout le scénario', () => {
    assert.deepEqual(htmlWrites, []);
  });
});
