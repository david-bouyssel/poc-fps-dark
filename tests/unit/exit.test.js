// Plan docs/design/dark-sortie-victoire.md §3.2 et §6 (exit.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, hasWall, WALL } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { tileDistances, UNREACHABLE } from '../../src/game/pathfinding.js';
import { findExit, isAtExit } from '../../src/game/exit.js';
import { gridFromRows } from './fps-test-grids.js';

const CASES = [
  [2, 2, 1], [2, 2, 7], [16, 16, 42], [16, 16, 2024], [64, 64, 3], [10, 5, 11], [5, 13, 77],
];

describe('findExit sur des labyrinthes générés', () => {
  for (const [width, height, seed] of CASES) {
    test(`${width} x ${height}, graine ${seed}`, () => {
      const maze = generateMaze({ width, height, seed });
      const grid = toTileGrid(maze);
      const exit = findExit(grid);

      assert.ok(Object.isFrozen(exit));
      assert.ok(!(exit.cellX === 0 && exit.cellY === 0), 'sortie en (0, 0)');
      assert.ok(exit.cellX >= 0 && exit.cellX < width && exit.cellY >= 0 && exit.cellY < height);
      assert.equal(exit.tx, 2 * exit.cellX + 1);
      assert.equal(exit.ty, 2 * exit.cellY + 1);
      assert.equal(exit.x, exit.tx + 0.5);
      assert.equal(exit.y, exit.ty + 0.5);

      // distance = maximum de tileDistances sur les tuiles de cellule ; égalité : plus petit index.
      const d = tileDistances(grid, 1, 1);
      let best = -1;
      let bestIndex = -1;
      for (let cy = 0; cy < height; cy++) {
        for (let cx = 0; cx < width; cx++) {
          const v = d[(2 * cy + 1) * grid.width + (2 * cx + 1)];
          assert.notEqual(v, UNREACHABLE, 'labyrinthe parfait : toute cellule atteignable');
          if (v > best) { best = v; bestIndex = cy * width + cx; }
        }
      }
      assert.equal(exit.distance, best);
      assert.equal(exit.cellY * width + exit.cellX, bestIndex);

      // cul-de-sac : une seule ouverture.
      const openings = [WALL.N, WALL.E, WALL.S, WALL.W]
        .filter((w) => !hasWall(maze, exit.cellX, exit.cellY, w)).length;
      assert.equal(openings, 1, 'la sortie doit être un cul-de-sac');

      // même graine -> même sortie.
      const again = findExit(toTileGrid(generateMaze({ width, height, seed })));
      assert.deepEqual({ ...again }, { ...exit });
    });
  }
});

describe('findExit : règle d\'égalité et erreurs', () => {
  test('deux cellules équidistantes : plus petit index de cellule', () => {
    // Cellules 3 x 2. (1, 0) [index 1] et (0, 1) [index 3] à distance 2 de (1, 1).
    const grid = gridFromRows([
      '#######',
      '#...###',
      '#.#####',
      '#.#####',
      '#######',
    ]);
    const exit = findExit(grid);
    assert.deepEqual({ ...exit }, { cellX: 1, cellY: 0, tx: 3, ty: 1, x: 3.5, y: 1.5, distance: 2 });
  });

  test('égalité : (2, 0) gagne sur (0, 2), index plus petit', () => {
    // Cellules 3 x 3 : (2, 0) [index 2] et (0, 2) [index 6] à distance 4.
    const grid = gridFromRows([
      '#######',
      '#.....#',
      '#.#####',
      '#.#####',
      '#.#####',
      '#.#####',
      '#######',
    ]);
    // (0, 2) tuile (1, 5) à distance 4, index 6 ; (2, 0) tuile (5, 1) à distance 4, index 2.
    const exit = findExit(grid);
    assert.equal(exit.cellX, 2);
    assert.equal(exit.cellY, 0);
    assert.equal(exit.distance, 4);
  });

  test('TypeError grille mal formée', () => {
    for (const g of [null, undefined, {}, { width: 5, height: 5 },
      { width: 5, height: 5, tiles: new Uint8Array(24) }]) {
      assert.throws(() => findExit(g), TypeError);
    }
  });

  test('RangeError : dimensions paires ou < 5, (1, 1) mur, aucune autre cellule atteignable', () => {
    const even = { width: 6, height: 5, tiles: new Uint8Array(30) };
    assert.throws(() => findExit(even), RangeError, 'largeur paire');
    const evenH = { width: 5, height: 6, tiles: new Uint8Array(30) };
    assert.throws(() => findExit(evenH), RangeError, 'hauteur paire');
    const small = gridFromRows(['###', '#.#', '###']);
    assert.throws(() => findExit(small), RangeError, '< 5');
    const wallStart = gridFromRows(['#####', '#####', '#####', '#####', '#####']);
    assert.throws(() => findExit(wallStart), RangeError, '(1, 1) mur');
    const isolated = gridFromRows(['#####', '#.#.#', '#####', '#.#.#', '#####']);
    assert.throws(() => findExit(isolated), RangeError, 'aucune cellule atteignable');
  });
});

describe('isAtExit', () => {
  const exit = Object.freeze({ tx: 3, ty: 5 });

  test('dans la tuile, bord inférieur inclus, bord supérieur exclu', () => {
    assert.equal(isAtExit({ x: 3.5, y: 5.5 }, exit), true);
    assert.equal(isAtExit({ x: 3, y: 5 }, exit), true);
    assert.equal(isAtExit({ x: 3.999, y: 5.999 }, exit), true);
    assert.equal(isAtExit({ x: 4, y: 5.5 }, exit), false);
    assert.equal(isAtExit({ x: 3.5, y: 6 }, exit), false);
  });

  test('tuiles voisines -> false', () => {
    for (const [x, y] of [[2.9, 5.5], [3.5, 4.9], [4.5, 5.5], [3.5, 6.5]]) {
      assert.equal(isAtExit({ x, y }, exit), false, `(${x}, ${y})`);
    }
  });

  test('accepte un Exit complet issu de findExit', () => {
    const full = findExit(toTileGrid(generateMaze({ width: 8, height: 8, seed: 42 })));
    assert.equal(isAtExit({ x: full.x, y: full.y }, full), true);
    assert.equal(isAtExit({ x: 1.5, y: 1.5 }, full), false);
  });

  test('TypeError position ou exit mal formé', () => {
    for (const p of [null, undefined, {}, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: '1', y: 1 }]) {
      assert.throws(() => isAtExit(p, exit), TypeError, JSON.stringify(p));
    }
    for (const e of [null, undefined, {}, { tx: 1.5, ty: 1 }, { tx: 1, ty: NaN }, { tx: '1', ty: 1 }]) {
      assert.throws(() => isAtExit({ x: 1, y: 1 }, e), TypeError, JSON.stringify(e));
    }
  });
});
