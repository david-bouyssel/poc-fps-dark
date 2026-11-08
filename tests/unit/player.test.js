import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, isWallTile } from '../../src/maze/grid.js';
import { createPlayer, normalizeAngle, PLAYER_RADIUS } from '../../src/game/player.js';
import { gridFromRows } from './fps-test-grids.js';

const TWO_PI = 2 * Math.PI;

test('PLAYER_RADIUS = 0.2', () => {
  assert.equal(PLAYER_RADIUS, 0.2);
});

describe('createPlayer : position de départ', () => {
  for (const [w, h, seed] of [[2, 2, 1], [2, 2, 7], [16, 16, 42], [16, 16, 999], [64, 64, 123456]]) {
    test(`${w}x${h} graine ${seed} -> (1.5, 1.5)`, () => {
      const grid = toTileGrid(generateMaze({ width: w, height: h, seed }));
      const p = createPlayer(grid);
      assert.equal(p.x, 1.5);
      assert.equal(p.y, 1.5);
      assert.ok(p.angle >= 0 && p.angle < TWO_PI);
    });
  }
});

describe('createPlayer : orientation', () => {
  test('tuile (2, 1) sol -> angle 0 (est)', () => {
    const grid = gridFromRows([
      '#####',
      '#...#',
      '###.#',
      '#...#',
      '#####',
    ]);
    assert.equal(createPlayer(grid).angle, 0);
  });

  test('tuile (2, 1) mur -> angle PI/2 (sud)', () => {
    const grid = gridFromRows([
      '#####',
      '#.#.#',
      '#.#.#',
      '#...#',
      '#####',
    ]);
    assert.equal(createPlayer(grid).angle, Math.PI / 2);
  });

  test('50 graines : la direction choisie pointe vers un sol', () => {
    for (let seed = 0; seed < 50; seed++) {
      const grid = toTileGrid(generateMaze({ width: 8, height: 8, seed }));
      const p = createPlayer(grid);
      const expected = isWallTile(grid, 2, 1) ? Math.PI / 2 : 0;
      assert.equal(p.angle, expected, `graine ${seed}`);
      const tx = Math.floor(p.x + Math.cos(p.angle));
      const ty = Math.floor(p.y + Math.sin(p.angle));
      assert.equal(isWallTile(grid, tx, ty), false, `graine ${seed} : (${tx},${ty}) mur`);
    }
  });
});

describe('createPlayer : immuabilité', () => {
  test('joueur gelé', () => {
    const grid = toTileGrid(generateMaze({ width: 4, height: 4, seed: 3 }));
    const p = createPlayer(grid);
    assert.ok(Object.isFrozen(p));
  });

  test('ne modifie pas la grille', () => {
    const grid = toTileGrid(generateMaze({ width: 4, height: 4, seed: 3 }));
    const before = Uint8Array.from(grid.tiles);
    createPlayer(grid);
    assert.deepEqual(grid.tiles, before);
    assert.equal(grid.width, 9);
    assert.equal(grid.height, 9);
  });
});

describe('createPlayer : erreurs', () => {
  test('grid absent -> TypeError', () => {
    assert.throws(() => createPlayer(), TypeError);
    assert.throws(() => createPlayer(null), TypeError);
    assert.throws(() => createPlayer(42), TypeError);
  });

  test('tiles non Uint8Array -> TypeError', () => {
    assert.throws(() => createPlayer({ width: 3, height: 3, tiles: [1, 1, 1, 1, 0, 1, 1, 1, 1] }), TypeError);
    assert.throws(() => createPlayer({ width: 3, height: 3 }), TypeError);
  });

  test('longueur incohérente -> TypeError', () => {
    assert.throws(() => createPlayer({ width: 3, height: 3, tiles: new Uint8Array(8) }), TypeError);
  });

  test('dimensions non entières -> TypeError', () => {
    assert.throws(() => createPlayer({ width: 2.5, height: 4, tiles: new Uint8Array(10) }), TypeError);
  });

  test('tuile (1, 1) mur -> RangeError', () => {
    const grid = gridFromRows(['#####', '##..#', '#...#', '#...#', '#####']);
    assert.throws(() => createPlayer(grid), RangeError);
  });
});

describe('normalizeAngle', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

  test('-PI/2 -> 3PI/2', () => close(normalizeAngle(-Math.PI / 2), 1.5 * Math.PI));
  test('2PI -> 0', () => close(normalizeAngle(TWO_PI), 0));
  test('5PI -> PI', () => close(normalizeAngle(5 * Math.PI), Math.PI));
  test('0 -> 0 et PI -> PI', () => {
    assert.equal(normalizeAngle(0), 0);
    close(normalizeAngle(Math.PI), Math.PI);
  });

  test('résultat toujours dans [0, 2PI)', () => {
    const values = [-1e6, -100, -TWO_PI, -1e-12, -0, 0, 1e-12, 1, TWO_PI - 1e-12, TWO_PI, 7, 100, 1e6];
    for (const v of values) {
      const r = normalizeAngle(v);
      assert.ok(r >= 0 && r < TWO_PI, `${v} -> ${r}`);
      // même direction
      close(Math.cos(r), Math.cos(v));
      close(Math.sin(r), Math.sin(v));
    }
  });
});
