import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, WALL } from '../../src/maze/maze.js';
import { toTileGrid, TILE, isWallTile } from '../../src/maze/grid.js';

const CASES = [
  [2, 2, 1],
  [2, 9, 7],
  [16, 16, 42],
  [5, 31, 999],
  [64, 64, 123456],
];

test('TILE conforme au plan', () => {
  assert.deepEqual({ ...TILE }, { FLOOR: 0, WALL: 1 });
  assert.ok(Object.isFrozen(TILE));
});

for (const [w, h, seed] of CASES) {
  describe(`toTileGrid ${w}x${h} graine ${seed}`, () => {
    const maze = generateMaze({ width: w, height: h, seed });
    const grid = toTileGrid(maze);
    const tile = (tx, ty) => grid.tiles[ty * grid.width + tx];

    test('dimensions (2w+1) x (2h+1)', () => {
      assert.equal(grid.width, 2 * w + 1);
      assert.equal(grid.height, 2 * h + 1);
      assert.ok(grid.tiles instanceof Uint8Array);
      assert.equal(grid.tiles.length, grid.width * grid.height);
      for (const v of grid.tiles) assert.ok(v === TILE.FLOOR || v === TILE.WALL);
    });

    test('bordure entièrement WALL', () => {
      for (let tx = 0; tx < grid.width; tx++) {
        assert.equal(tile(tx, 0), TILE.WALL);
        assert.equal(tile(tx, grid.height - 1), TILE.WALL);
      }
      for (let ty = 0; ty < grid.height; ty++) {
        assert.equal(tile(0, ty), TILE.WALL);
        assert.equal(tile(grid.width - 1, ty), TILE.WALL);
      }
    });

    test('tuiles (pair, pair) toutes WALL', () => {
      for (let ty = 0; ty < grid.height; ty += 2) {
        for (let tx = 0; tx < grid.width; tx += 2) {
          assert.equal(tile(tx, ty), TILE.WALL, `(${tx},${ty})`);
        }
      }
    });

    test('tuiles de cellule (impair, impair) toutes FLOOR', () => {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          assert.equal(tile(2 * x + 1, 2 * y + 1), TILE.FLOOR, `cellule (${x},${y})`);
        }
      }
    });

    test('tuile de passage FLOOR <=> mur absent', () => {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = maze.cells[y * w + x];
          if (x < w - 1) {
            const expected = c & WALL.E ? TILE.WALL : TILE.FLOOR;
            assert.equal(tile(2 * x + 2, 2 * y + 1), expected, `passage E de (${x},${y})`);
          }
          if (y < h - 1) {
            const expected = c & WALL.S ? TILE.WALL : TILE.FLOOR;
            assert.equal(tile(2 * x + 1, 2 * y + 2), expected, `passage S de (${x},${y})`);
          }
        }
      }
    });

    test('nombre de tuiles FLOOR === w*h + (w*h - 1)', () => {
      let floors = 0;
      for (const v of grid.tiles) if (v === TILE.FLOOR) floors++;
      assert.equal(floors, w * h + (w * h - 1));
    });

    test('connexité des tuiles FLOOR (BFS 4-voisins)', () => {
      let total = 0;
      for (const v of grid.tiles) if (v === TILE.FLOOR) total++;
      const start = 1 * grid.width + 1;
      const seen = new Uint8Array(grid.tiles.length);
      seen[start] = 1;
      const queue = [start];
      let count = 1;
      while (queue.length) {
        const i = queue.shift();
        const tx = i % grid.width;
        const ty = Math.floor(i / grid.width);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
          const n = ny * grid.width + nx;
          if (!seen[n] && grid.tiles[n] === TILE.FLOOR) {
            seen[n] = 1;
            count++;
            queue.push(n);
          }
        }
      }
      assert.equal(count, total);
    });
  });
}

// --- isWallTile (vue FPS, plan docs/design/vue-fps.md §3 et §6) ---

describe('isWallTile', () => {
  const maze = generateMaze({ width: 16, height: 16, seed: 2024 });
  const grid = toTileGrid(maze);

  test('cohérent avec tiles sur toute la grille 16x16', () => {
    for (let ty = 0; ty < grid.height; ty++) {
      for (let tx = 0; tx < grid.width; tx++) {
        const expected = grid.tiles[ty * grid.width + tx] === TILE.WALL;
        assert.equal(isWallTile(grid, tx, ty), expected, `(${tx},${ty})`);
      }
    }
  });

  test('hors grille -> true', () => {
    const cases = [
      [-1, 1], [1, -1], [grid.width, 1], [1, grid.height],
      [grid.width + 5, grid.height + 5], [1e9, 1], [1, 1e9], [-1e9, -1e9],
      [Infinity, 1], [1, -Infinity],
    ];
    for (const [tx, ty] of cases) {
      assert.equal(isWallTile(grid, tx, ty), true, `(${tx},${ty})`);
    }
  });

  test('coordonnées non entières ou NaN -> true (même sur une tuile sol)', () => {
    assert.equal(isWallTile(grid, 1, 1), false, 'précondition : (1,1) sol');
    for (const [tx, ty] of [[1.5, 1], [1, 1.5], [1.0001, 1], [NaN, 1], [1, NaN], [NaN, NaN]]) {
      assert.equal(isWallTile(grid, tx, ty), true, `(${tx},${ty})`);
    }
  });

  test('ne lève jamais et ne modifie pas la grille', () => {
    const before = Uint8Array.from(grid.tiles);
    for (const v of [-2, -1, 0, 1, 2.5, NaN, Infinity, 33, 34, 1e12]) {
      assert.doesNotThrow(() => isWallTile(grid, v, v));
    }
    assert.deepEqual(grid.tiles, before);
  });
});
