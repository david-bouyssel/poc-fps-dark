import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze, WALL } from '../../src/maze/maze.js';
import { wallSegments, computeCellSize } from '../../src/render/maze-geometry.js';
import { PALETTE } from '../../src/render/palette.js';

const CASES = [
  [2, 2, 1],
  [2, 9, 7],
  [16, 16, 42],
  [5, 31, 999],
  [64, 64, 31337],
];

function normKey({ x1, y1, x2, y2 }) {
  const a = `${x1},${y1}`;
  const b = `${x2},${y2}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function internalWallsPresent(maze) {
  const { width: w, height: h, cells } = maze;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = cells[y * w + x];
      if (x < w - 1 && c & WALL.E) n++;
      if (y < h - 1 && c & WALL.S) n++;
    }
  }
  return n;
}

for (const [w, h, seed] of CASES) {
  describe(`wallSegments ${w}x${h} graine ${seed}`, () => {
    const maze = generateMaze({ width: w, height: h, seed });
    const segs = wallSegments(maze);

    test('renvoie un tableau', () => {
      assert.ok(Array.isArray(segs));
    });

    test('aucun segment en double', () => {
      const keys = segs.map(normKey);
      assert.equal(new Set(keys).size, keys.length);
    });

    test('nombre = murs internes présents + périmètre (2w + 2h)', () => {
      assert.equal(segs.length, internalWallsPresent(maze) + 2 * w + 2 * h);
    });

    test('segments axe-alignés, longueur 1, coordonnées entières dans [0,w]x[0,h]', () => {
      for (const s of segs) {
        for (const k of ['x1', 'y1', 'x2', 'y2']) {
          assert.ok(Number.isInteger(s[k]), `${k} non entier : ${s[k]}`);
        }
        assert.ok(s.x1 >= 0 && s.x1 <= w && s.x2 >= 0 && s.x2 <= w);
        assert.ok(s.y1 >= 0 && s.y1 <= h && s.y2 >= 0 && s.y2 <= h);
        const dx = Math.abs(s.x2 - s.x1);
        const dy = Math.abs(s.y2 - s.y1);
        assert.ok((dx === 1 && dy === 0) || (dx === 0 && dy === 1), `segment non unitaire ${JSON.stringify(s)}`);
      }
    });

    test('segments correspondent exactement aux murs de cells', () => {
      const expected = new Set();
      const add = (x1, y1, x2, y2) => expected.add(normKey({ x1, y1, x2, y2 }));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = maze.cells[y * w + x];
          if (c & WALL.N) add(x, y, x + 1, y);
          if (c & WALL.S) add(x, y + 1, x + 1, y + 1);
          if (c & WALL.W) add(x, y, x, y + 1);
          if (c & WALL.E) add(x + 1, y, x + 1, y + 1);
        }
      }
      assert.deepEqual(new Set(segs.map(normKey)), expected);
    });
  });
}

describe('computeCellSize', () => {
  const maze = generateMaze({ width: 16, height: 10, seed: 3 });

  test('entier >= 1 et labyrinthe + marge tient dans la zone', () => {
    const zones = [
      [800, 600, 16],
      [1920, 1080, 20],
      [300, 900, 8],
      [1000, 200, 0],
      [517, 333, 12],
    ];
    for (const [aw, ah, pad] of zones) {
      const size = computeCellSize(maze, aw, ah, pad);
      assert.ok(Number.isInteger(size), `non entier : ${size}`);
      assert.ok(size >= 1);
      assert.ok(size * maze.width + 2 * pad <= aw, `largeur déborde (${aw}, pad ${pad}, size ${size})`);
      assert.ok(size * maze.height + 2 * pad <= ah, `hauteur déborde (${ah}, pad ${pad}, size ${size})`);
    }
  });

  test('la taille exploite la zone (pas sous-dimensionnée de plus d\'une unité)', () => {
    const size = computeCellSize(maze, 800, 600, 0);
    assert.ok((size + 1) * maze.width > 800 || (size + 1) * maze.height > 600);
  });

  test('zone minuscule -> 1', () => {
    assert.equal(computeCellSize(maze, 5, 5, 0), 1);
    assert.equal(computeCellSize(maze, 10, 10, 20), 1);
    assert.equal(computeCellSize(maze, 0, 0, 0), 1);
  });
});

describe('PALETTE', () => {
  test('objet gelé avec background, floor, wall, accent', () => {
    assert.ok(Object.isFrozen(PALETTE));
    for (const k of ['background', 'floor', 'wall', 'accent']) {
      assert.equal(typeof PALETTE[k], 'string', `PALETTE.${k}`);
      assert.ok(PALETTE[k].length > 0);
    }
  });
});
