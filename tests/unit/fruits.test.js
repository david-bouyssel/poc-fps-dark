// Tests unitaires de src/game/fruits.js, d'après le plan docs/design/fps-fruits-score.md
// (§1 choix structurants, §3 API et algorithme figé, §6 plan de tests).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FRUIT_KIND,
  FRUIT_TABLE,
  FRUIT_SEED_SALT,
  FRUIT_DENSITY,
  MAX_FRUITS,
  PICKUP_RADIUS,
  fruitCount,
  pointsFor,
  placeFruits,
  createFruitState,
  collectFruits,
} from '../../src/game/fruits.js';
import { createRng, randomInt, MAX_SEED } from '../../src/maze/random.js';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, isWallTile } from '../../src/maze/grid.js';

const KIND_IDS = Object.values(FRUIT_KIND);
const isTypeOrRangeError = (e) => e instanceof TypeError || e instanceof RangeError;

/** Implémentation de référence de l'algorithme figé du plan (§3). */
function referencePlacement({ width, height, seed }) {
  const rng = createRng((seed ^ 0x9E3779B9) >>> 0);
  const cellCount = width * height;
  const count = Math.min(96, cellCount - 1, Math.max(1, Math.floor(cellCount * 0.125)));
  const candidates = [];
  for (let i = 1; i < cellCount; i++) candidates.push(i);
  const n = candidates.length;
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(rng, n - i);
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const table = [
    ['strawberry', 55], ['cherry', 28], ['peach', 13], ['dragonfruit', 4],
  ];
  const totalWeight = table.reduce((s, [, w]) => s + w, 0);
  const result = [];
  for (let id = 0; id < count; id++) {
    const index = candidates[id];
    const r = randomInt(rng, totalWeight);
    let acc = 0;
    let kind = null;
    for (const [k, w] of table) {
      acc += w;
      if (acc > r) { kind = k; break; }
    }
    const cellX = index % width;
    const cellY = Math.floor(index / width);
    result.push({ id, kind, cellX, cellY, x: 2 * cellX + 1.5, y: 2 * cellY + 1.5 });
  }
  return result;
}

function fruit(id, x, y, kind = 'strawberry') {
  return Object.freeze({ id, kind, cellX: Math.floor((x - 1) / 2), cellY: Math.floor((y - 1) / 2), x, y });
}

describe('constantes et table des espèces', () => {
  test('constantes du plan', () => {
    assert.equal(FRUIT_SEED_SALT, 0x9E3779B9);
    assert.equal(FRUIT_DENSITY, 0.125);
    assert.equal(MAX_FRUITS, 96);
    assert.equal(PICKUP_RADIUS, 0.5);
  });

  test('FRUIT_KIND : quatre ids, gelé', () => {
    assert.ok(Object.isFrozen(FRUIT_KIND));
    assert.deepEqual(FRUIT_KIND, {
      STRAWBERRY: 'strawberry', CHERRY: 'cherry', PEACH: 'peach', DRAGONFRUIT: 'dragonfruit',
    });
  });

  test('FRUIT_TABLE : 4 espèces, ordre figé, valeurs du plan, ids = FRUIT_KIND', () => {
    assert.deepEqual(
      FRUIT_TABLE.map((e) => ({ kind: e.kind, weight: e.weight, points: e.points })),
      [
        { kind: 'strawberry', weight: 55, points: 10 },
        { kind: 'cherry', weight: 28, points: 25 },
        { kind: 'peach', weight: 13, points: 50 },
        { kind: 'dragonfruit', weight: 4, points: 100 },
      ],
    );
    assert.deepEqual([...FRUIT_TABLE.map((e) => e.kind)].sort(), [...KIND_IDS].sort());
  });

  test('plus rare = plus de points : poids strictement décroissants, points strictement croissants', () => {
    for (let i = 1; i < FRUIT_TABLE.length; i++) {
      assert.ok(FRUIT_TABLE[i].weight < FRUIT_TABLE[i - 1].weight, `poids ${FRUIT_TABLE[i].kind}`);
      assert.ok(FRUIT_TABLE[i].points > FRUIT_TABLE[i - 1].points, `points ${FRUIT_TABLE[i].kind}`);
    }
  });

  test('FRUIT_TABLE et ses entrées sont gelées', () => {
    assert.ok(Object.isFrozen(FRUIT_TABLE));
    for (const e of FRUIT_TABLE) assert.ok(Object.isFrozen(e), e.kind);
    assert.throws(() => { 'use strict'; FRUIT_TABLE[0].points = 1000; }, TypeError);
  });
});

describe('pointsFor', () => {
  test('valeurs du tableau', () => {
    for (const e of FRUIT_TABLE) assert.equal(pointsFor(e.kind), e.points, e.kind);
    assert.equal(pointsFor(FRUIT_KIND.DRAGONFRUIT), 100);
  });

  test('espèce inconnue -> RangeError', () => {
    for (const k of ['banana', '', 'STRAWBERRY', '__proto__', 'toString', undefined, null, 42]) {
      assert.throws(() => pointsFor(k), RangeError, String(k));
    }
  });
});

describe('fruitCount', () => {
  test('exemples du plan', () => {
    assert.equal(fruitCount(4), 1);
    assert.equal(fruitCount(256), 32);
    assert.equal(fruitCount(4096), 96);
    assert.equal(fruitCount(2), 1);
  });

  test('formule min(96, n - 1, max(1, floor(n / 8))), bornes 1 et n - 1', () => {
    for (let n = 2; n <= 4096; n++) {
      const c = fruitCount(n);
      assert.equal(c, Math.min(96, n - 1, Math.max(1, Math.floor(n * 0.125))), `n = ${n}`);
      assert.ok(c >= 1 && c <= n - 1 && c <= MAX_FRUITS, `n = ${n}`);
    }
  });
});

describe('placeFruits', () => {
  const SEEDS = [0, 1, 42, 7, 2024, 123456789, MAX_SEED];
  const SIZES = [[2, 2], [3, 2], [8, 8], [16, 16], [64, 64], [5, 13]];

  test('nombre, ids, unicité de cellule, jamais (0, 0), centre de cellule sur tuile sol', () => {
    for (const [width, height] of SIZES) {
      for (const seed of [42, 2024]) {
        const maze = generateMaze({ width, height, seed });
        const grid = toTileGrid(maze);
        const fruits = placeFruits(maze);
        assert.equal(fruits.length, fruitCount(width * height), `${width}x${height}`);
        const cells = new Set();
        fruits.forEach((f, i) => {
          assert.equal(f.id, i, 'ids 0..n-1 triés');
          assert.ok(KIND_IDS.includes(f.kind), f.kind);
          assert.ok(Number.isInteger(f.cellX) && f.cellX >= 0 && f.cellX < width);
          assert.ok(Number.isInteger(f.cellY) && f.cellY >= 0 && f.cellY < height);
          assert.ok(!(f.cellX === 0 && f.cellY === 0), 'fruit en (0, 0)');
          const key = f.cellY * width + f.cellX;
          assert.ok(!cells.has(key), `deux fruits dans la cellule ${key}`);
          cells.add(key);
          assert.equal(f.x, 2 * f.cellX + 1.5);
          assert.equal(f.y, 2 * f.cellY + 1.5);
          assert.equal(isWallTile(grid, Math.floor(f.x), Math.floor(f.y)), false, 'fruit dans un mur');
        });
      }
    }
  });

  test('2 x 2 -> 1 fruit ; 16 x 16 -> 32 ; 64 x 64 -> 96', () => {
    assert.equal(placeFruits({ width: 2, height: 2, seed: 3 }).length, 1);
    assert.equal(placeFruits({ width: 16, height: 16, seed: 3 }).length, 32);
    assert.equal(placeFruits({ width: 64, height: 64, seed: 3 }).length, 96);
  });

  test('résultat gelé (tableau et fruits)', () => {
    const fruits = placeFruits(generateMaze({ width: 8, height: 8, seed: 42 }));
    assert.ok(Object.isFrozen(fruits));
    for (const f of fruits) assert.ok(Object.isFrozen(f));
    assert.throws(() => { 'use strict'; fruits.push(fruit(99, 1.5, 1.5)); }, TypeError);
  });

  test('algorithme figé du plan §3 (graine dérivée, Fisher-Yates partiel, tirage pondéré)', () => {
    for (const [width, height] of SIZES) {
      for (const seed of SEEDS) {
        const maze = { width, height, seed };
        assert.deepEqual(
          placeFruits(maze).map((f) => ({ ...f })),
          referencePlacement(maze),
          `${width}x${height} graine ${seed}`,
        );
      }
    }
  });

  test('reproductible : même graine -> même disposition', () => {
    for (const seed of SEEDS) {
      const a = placeFruits(generateMaze({ width: 16, height: 16, seed }));
      const b = placeFruits(generateMaze({ width: 16, height: 16, seed }));
      assert.deepEqual(a, b, `graine ${seed}`);
    }
  });

  test('graines différentes -> dispositions différentes', () => {
    const layouts = new Set(SEEDS.map((seed) => JSON.stringify(placeFruits({ width: 16, height: 16, seed }))));
    assert.equal(layouts.size, SEEDS.length);
  });

  test('ne perturbe pas le flux du labyrinthe : cells identiques avant et après', () => {
    for (const seed of SEEDS) {
      const before = generateMaze({ width: 16, height: 16, seed });
      const cellsBefore = Array.from(before.cells);
      placeFruits(before);
      assert.deepEqual(Array.from(before.cells), cellsBefore, 'maze muté');
      const after = generateMaze({ width: 16, height: 16, seed });
      assert.deepEqual(Array.from(after.cells), cellsBefore, `graine ${seed}`);
    }
  });

  test('répartition : fréquences dans l\'ordre des poids, fruit du dragon présent et minoritaire', () => {
    const rng = createRng(20261110);
    const counts = Object.fromEntries(KIND_IDS.map((k) => [k, 0]));
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const seed = randomInt(rng, MAX_SEED);
      for (const f of placeFruits({ width: 16, height: 16, seed })) {
        counts[f.kind]++;
        total++;
      }
    }
    assert.equal(total, 200 * 32);
    assert.ok(counts.strawberry > counts.cherry, JSON.stringify(counts));
    assert.ok(counts.cherry > counts.peach, JSON.stringify(counts));
    assert.ok(counts.peach > counts.dragonfruit, JSON.stringify(counts));
    assert.ok(counts.dragonfruit > 0, 'fruit du dragon jamais tiré');
    assert.ok(counts.dragonfruit / total < 0.1, `fruit du dragon trop fréquent : ${counts.dragonfruit / total}`);
  });

  test('n\'utilise pas Math.random', () => {
    const original = Math.random;
    Math.random = () => { throw new Error('Math.random interdit'); };
    try {
      assert.doesNotThrow(() => placeFruits({ width: 16, height: 16, seed: 42 }));
      assert.doesNotThrow(() => collectFruits(createFruitState(placeFruits({ width: 8, height: 8, seed: 1 })), { x: 1.5, y: 1.5 }));
    } finally {
      Math.random = original;
    }
  });

  test('entrées invalides -> TypeError ou RangeError', () => {
    const bad = [
      null, undefined, 42, 'maze', {},
      { width: 8, height: 8 },
      { width: 8, height: 8, seed: -1 },
      { width: 8, height: 8, seed: MAX_SEED + 1 },
      { width: 8, height: 8, seed: 1.5 },
      { width: 8, height: 8, seed: NaN },
      { width: 8, height: 8, seed: '42' },
      { width: 8.5, height: 8, seed: 1 },
      { width: 8, height: 2.2, seed: 1 },
      { width: NaN, height: 8, seed: 1 },
      { width: '8', height: 8, seed: 1 },
    ];
    for (const maze of bad) {
      assert.throws(() => placeFruits(maze), isTypeOrRangeError, JSON.stringify(maze));
    }
    assert.throws(() => placeFruits(null), TypeError);
  });
});

describe('createFruitState', () => {
  test('score 0, collected 0, total = longueur, gelé', () => {
    const fruits = placeFruits({ width: 8, height: 8, seed: 42 });
    const state = createFruitState(fruits);
    assert.equal(state.score, 0);
    assert.equal(state.collected, 0);
    assert.equal(state.total, fruits.length);
    assert.deepEqual([...state.fruits], [...fruits]);
    assert.ok(Object.isFrozen(state));
    assert.ok(Object.isFrozen(state.fruits));
  });

  test('liste vide : total 0', () => {
    const state = createFruitState([]);
    assert.equal(state.total, 0);
    assert.equal(state.fruits.length, 0);
  });
});

describe('collectFruits', () => {
  const near = fruit(0, 3.5, 1.5, 'cherry');
  const far = fruit(1, 9.5, 9.5, 'dragonfruit');

  test('fruit à exactement 0.5 -> ramassé ; à 0.51 -> non', () => {
    const state = createFruitState([near, far]);
    const hit = collectFruits(state, { x: 3.0, y: 1.5 });
    assert.equal(hit.collected, 1);
    assert.equal(hit.score, 25);
    assert.equal(hit.total, 2);
    assert.deepEqual(hit.fruits.map((f) => f.id), [1]);

    const miss = collectFruits(state, { x: 2.99, y: 1.5 });
    assert.equal(miss, state, 'même référence si rien n\'est ramassé');
  });

  test('distance euclidienne (diagonale)', () => {
    const state = createFruitState([near]);
    const d = 0.49 / Math.SQRT2;
    assert.equal(collectFruits(state, { x: 3.5 - d, y: 1.5 + d }).collected, 1);
    const e = 0.52 / Math.SQRT2;
    assert.equal(collectFruits(state, { x: 3.5 - e, y: 1.5 + e }), state);
  });

  test('plusieurs fruits dans le rayon -> tous ramassés, points cumulés', () => {
    const a = fruit(0, 3.5, 1.5, 'strawberry');
    const b = fruit(1, 3.8, 1.5, 'peach');
    const c = fruit(2, 3.5, 1.2, 'dragonfruit');
    const state = createFruitState([a, b, c, far]);
    const next = collectFruits(state, { x: 3.5, y: 1.5 });
    assert.equal(next.collected, 3);
    assert.equal(next.score, 10 + 50 + 100);
    assert.equal(next.total, 4);
    assert.deepEqual(next.fruits, [far]);
    assert.ok(Object.isFrozen(next));
    assert.ok(Object.isFrozen(next.fruits));
  });

  test('rayon personnalisé', () => {
    const state = createFruitState([near]);
    assert.equal(collectFruits(state, { x: 2.5, y: 1.5 }), state);
    assert.equal(collectFruits(state, { x: 2.5, y: 1.5 }, 1).collected, 1);
  });

  test('rien dans le rayon -> même référence', () => {
    const state = createFruitState([near, far]);
    assert.equal(collectFruits(state, { x: 1.5, y: 1.5 }), state);
    const empty = createFruitState([]);
    assert.equal(collectFruits(empty, { x: 1.5, y: 1.5 }), empty);
  });

  test('état d\'entrée non muté ; fruit ramassé une seule fois', () => {
    const state = createFruitState([near, far]);
    const snapshot = JSON.stringify(state);
    const once = collectFruits(state, { x: 3.5, y: 1.5 });
    assert.equal(JSON.stringify(state), snapshot);
    assert.equal(state.fruits.length, 2);
    const twice = collectFruits(once, { x: 3.5, y: 1.5 });
    assert.equal(twice, once, 'aucun second ramassage');
    assert.equal(twice.score, 25);
    assert.equal(twice.collected, 1);
  });

  test('score cumulé sur un parcours = somme des points des fruits ramassés', () => {
    const fruits = placeFruits({ width: 8, height: 8, seed: 42 });
    let state = createFruitState(fruits);
    for (const f of fruits) state = collectFruits(state, { x: f.x, y: f.y });
    assert.equal(state.collected, fruits.length);
    assert.equal(state.fruits.length, 0);
    assert.equal(state.score, fruits.reduce((s, f) => s + pointsFor(f.kind), 0));
  });

  test('position non finie ou état mal formé -> TypeError', () => {
    const state = createFruitState([near]);
    for (const pos of [null, undefined, {}, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: '1', y: 1 }, 3]) {
      assert.throws(() => collectFruits(state, pos), TypeError, JSON.stringify(pos));
    }
    for (const bad of [null, undefined, {}, 42, { fruits: null, score: 0, collected: 0, total: 0 }]) {
      assert.throws(() => collectFruits(bad, { x: 1.5, y: 1.5 }), TypeError, JSON.stringify(bad));
    }
  });
});
