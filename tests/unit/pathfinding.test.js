// Plan docs/design/dark-sortie-victoire.md §3.1 et §6 (pathfinding.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, TILE } from '../../src/maze/grid.js';
import {
  UNREACHABLE,
  NEIGHBOR_OFFSETS,
  tileDistances,
  pathDistance,
  shortestPath,
  cellToTile,
  tileAt,
} from '../../src/game/pathfinding.js';
import { gridFromRows } from './fps-test-grids.js';

// Couloir est-ouest : sols x = 1..6 sur y = 1.
const corridor = gridFromRows(['########', '#......#', '########']);

// Deux pièces séparées par un mur plein : gauche (1..2, 1..2), droite (4..5, 1..2).
const split = gridFromRows(['#######', '#..#..#', '#..#..#', '#######']);

const at = (grid, d, x, y) => d[y * grid.width + x];

describe('constantes', () => {
  test('UNREACHABLE = -1, NEIGHBOR_OFFSETS = N, E, S, W gelé', () => {
    assert.equal(UNREACHABLE, -1);
    assert.deepEqual(NEIGHBOR_OFFSETS.map((o) => ({ ...o })), [
      { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
    ]);
    assert.ok(Object.isFrozen(NEIGHBOR_OFFSETS));
    for (const o of NEIGHBOR_OFFSETS) assert.ok(Object.isFrozen(o));
  });
});

describe('tileDistances', () => {
  test('couloir : distances 0..n, murs à UNREACHABLE', () => {
    const d = tileDistances(corridor, 1, 1);
    assert.ok(d instanceof Int32Array);
    assert.equal(d.length, corridor.width * corridor.height);
    for (let x = 1; x <= 6; x++) assert.equal(at(corridor, d, x, 1), x - 1, `x=${x}`);
    for (let y = 0; y < corridor.height; y++) {
      for (let x = 0; x < corridor.width; x++) {
        if (corridor.tiles[y * corridor.width + x] === TILE.WALL) {
          assert.equal(at(corridor, d, x, y), UNREACHABLE, `mur (${x}, ${y})`);
        }
      }
    }
  });

  test('départ au milieu du couloir', () => {
    const d = tileDistances(corridor, 4, 1);
    assert.deepEqual([1, 2, 3, 4, 5, 6].map((x) => at(corridor, d, x, 1)), [3, 2, 1, 0, 1, 2]);
  });

  test('pièce séparée -> UNREACHABLE', () => {
    const d = tileDistances(split, 1, 1);
    assert.equal(at(split, d, 2, 2), 2);
    for (const [x, y] of [[4, 1], [5, 1], [4, 2], [5, 2]]) {
      assert.equal(at(split, d, x, y), UNREACHABLE, `(${x}, ${y})`);
    }
  });

  test('nouveau tableau à chaque appel, contenu identique (déterminisme)', () => {
    const a = tileDistances(corridor, 1, 1);
    const b = tileDistances(corridor, 1, 1);
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });

  test('erreurs : TypeError grille / coordonnées non entières, RangeError hors grille ou mur', () => {
    const badGrids = [null, undefined, 42, {}, { width: 3, height: 3 },
      { width: 3, height: 3, tiles: new Uint8Array(8) },
      { width: 0, height: 3, tiles: new Uint8Array(0) },
      { width: 2.5, height: 2, tiles: new Uint8Array(5) }];
    for (const g of badGrids) assert.throws(() => tileDistances(g, 1, 1), TypeError);
    for (const [x, y] of [[1.5, 1], [1, NaN], ['1', 1], [1, undefined], [Infinity, 1]]) {
      assert.throws(() => tileDistances(corridor, x, y), TypeError, `(${x}, ${y})`);
    }
    for (const [x, y] of [[-1, 1], [8, 1], [1, 3], [1, -1]]) {
      assert.throws(() => tileDistances(corridor, x, y), RangeError, `(${x}, ${y})`);
    }
    assert.throws(() => tileDistances(corridor, 0, 0), RangeError, 'départ sur un mur');
  });
});

describe('pathDistance', () => {
  test('couloir : distance de chemin', () => {
    assert.equal(pathDistance(corridor, 1, 1, 6, 1), 5);
    assert.equal(pathDistance(corridor, 3, 1, 3, 1), 0);
  });

  test('pièce séparée -> Infinity (jamais -1)', () => {
    assert.equal(pathDistance(split, 1, 1, 5, 2), Infinity);
  });

  test('erreurs pour l\'origine et pour la cible', () => {
    assert.throws(() => pathDistance(corridor, 0, 1, 1, 1), RangeError);
    assert.throws(() => pathDistance(corridor, 1, 1, 7, 1), RangeError, 'cible sur un mur');
    assert.throws(() => pathDistance(corridor, 1, 1, 99, 1), RangeError, 'cible hors grille');
    assert.throws(() => pathDistance(corridor, 1, 1, 2.5, 1), TypeError);
    assert.throws(() => pathDistance(null, 1, 1, 2, 1), TypeError);
  });

  test('toTileGrid réel : symétrique', () => {
    const grid = toTileGrid(generateMaze({ width: 12, height: 9, seed: 99 }));
    const pairs = [[[1, 1], [23, 17]], [[5, 3], [11, 15]], [[21, 1], [1, 17]]];
    for (const [[ax, ay], [bx, by]] of pairs) {
      const ab = pathDistance(grid, ax, ay, bx, by);
      assert.ok(Number.isInteger(ab) && ab > 0);
      assert.equal(pathDistance(grid, bx, by, ax, ay), ab);
      assert.equal(ab, at(grid, tileDistances(grid, ax, ay), bx, by));
    }
  });
});

describe('shortestPath', () => {
  test('origine = cible -> [origine]', () => {
    const p = shortestPath(corridor, 3, 1, 3, 1);
    assert.deepEqual(p.map((s) => ({ ...s })), [{ tx: 3, ty: 1 }]);
  });

  test('pièce séparée -> null', () => {
    assert.equal(shortestPath(split, 1, 1, 4, 1), null);
  });

  test('couloir : chemin complet, gelé', () => {
    const p = shortestPath(corridor, 1, 1, 4, 1);
    assert.deepEqual(p.map((s) => ({ ...s })), [1, 2, 3, 4].map((tx) => ({ tx, ty: 1 })));
    assert.ok(Object.isFrozen(p));
    for (const s of p) assert.ok(Object.isFrozen(s));
  });

  test('toTileGrid réel : contigu, sols seulement, longueur = distance + 1, déterministe', () => {
    for (const seed of [1, 42, 2024]) {
      const grid = toTileGrid(generateMaze({ width: 10, height: 10, seed }));
      const to = [19, 19];
      const p = shortestPath(grid, 1, 1, ...to);
      assert.ok(Array.isArray(p) || Object.isFrozen(p));
      assert.equal(p.length, pathDistance(grid, 1, 1, ...to) + 1, `graine ${seed}`);
      assert.deepEqual({ ...p[0] }, { tx: 1, ty: 1 });
      assert.deepEqual({ ...p[p.length - 1] }, { tx: to[0], ty: to[1] });
      for (let i = 0; i < p.length; i++) {
        assert.equal(grid.tiles[p[i].ty * grid.width + p[i].tx], TILE.FLOOR, `étape ${i} sur un mur`);
        if (i > 0) {
          const step = Math.abs(p[i].tx - p[i - 1].tx) + Math.abs(p[i].ty - p[i - 1].ty);
          assert.equal(step, 1, `étape ${i} non contiguë`);
        }
      }
      assert.deepEqual(shortestPath(grid, 1, 1, ...to), p);
    }
  });

  test('erreurs', () => {
    assert.throws(() => shortestPath(corridor, 0, 0, 1, 1), RangeError);
    assert.throws(() => shortestPath(corridor, 1, 1, 0, 0), RangeError);
    assert.throws(() => shortestPath(corridor, 1, 1, 1, 1.2), TypeError);
    assert.throws(() => shortestPath({ width: 1 }, 1, 1, 1, 1), TypeError);
  });
});

describe('cellToTile et tileAt', () => {
  test('cellToTile : centre de cellule, gelé', () => {
    assert.deepEqual({ ...cellToTile(0, 0) }, { tx: 1, ty: 1 });
    assert.deepEqual({ ...cellToTile(2, 3) }, { tx: 5, ty: 7 });
    assert.ok(Object.isFrozen(cellToTile(1, 1)));
  });

  test('cellToTile : TypeError non entier ou négatif', () => {
    for (const [x, y] of [[-1, 0], [0, -1], [0.5, 0], [0, NaN], ['1', 0], [Infinity, 0]]) {
      assert.throws(() => cellToTile(x, y), TypeError, `(${x}, ${y})`);
    }
  });

  test('tileAt : Math.floor, gelé', () => {
    assert.deepEqual({ ...tileAt(2.7, 3.0) }, { tx: 2, ty: 3 });
    assert.deepEqual({ ...tileAt(0.999, 5.5) }, { tx: 0, ty: 5 });
    assert.deepEqual({ ...tileAt(-0.2, 1) }, { tx: -1, ty: 1 });
    assert.ok(Object.isFrozen(tileAt(1, 1)));
  });

  test('tileAt : TypeError non fini', () => {
    for (const [x, y] of [[NaN, 0], [0, Infinity], ['1', 0], [undefined, 0], [0, null]]) {
      assert.throws(() => tileAt(x, y), TypeError, `(${x}, ${y})`);
    }
  });
});
