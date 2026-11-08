import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  generateMaze,
  hasWall,
  WALL,
  ALL_WALLS,
  MAZE_LIMITS,
} from '../../src/maze/maze.js';
import { MAX_SEED } from '../../src/maze/random.js';

const SIZES = [
  [2, 2],
  [2, 9],
  [16, 16],
  [64, 64],
  [5, 31],
];
const SEEDS = [0, 1, 42, 123456789, MAX_SEED];

function cell(maze, x, y) {
  return maze.cells[y * maze.width + x];
}

function countOpenInternalPassages(maze) {
  const { width, height } = maze;
  let open = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = cell(maze, x, y);
      if (x < width - 1 && !(c & WALL.E)) open++;
      if (y < height - 1 && !(c & WALL.S)) open++;
    }
  }
  return open;
}

function bfsReachable(maze) {
  const { width, height } = maze;
  const seen = new Uint8Array(width * height);
  const queue = [0];
  seen[0] = 1;
  let count = 1;
  const dirs = [
    [WALL.N, 0, -1],
    [WALL.E, 1, 0],
    [WALL.S, 0, 1],
    [WALL.W, -1, 0],
  ];
  while (queue.length) {
    const idx = queue.shift();
    const x = idx % width;
    const y = Math.floor(idx / width);
    const c = maze.cells[idx];
    for (const [bit, dx, dy] of dirs) {
      if (c & bit) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (!seen[n]) {
        seen[n] = 1;
        count++;
        queue.push(n);
      }
    }
  }
  return count;
}

test('constantes exportées conformes au plan', () => {
  assert.deepEqual({ ...WALL }, { N: 1, E: 2, S: 4, W: 8 });
  assert.ok(Object.isFrozen(WALL));
  assert.equal(ALL_WALLS, 15);
  assert.deepEqual({ ...MAZE_LIMITS }, { minSize: 2, maxSize: 64 });
  assert.ok(Object.isFrozen(MAZE_LIMITS));
});

for (const [width, height] of SIZES) {
  for (const seed of SEEDS) {
    describe(`labyrinthe parfait ${width}x${height} graine ${seed}`, () => {
      const maze = generateMaze({ width, height, seed });

      test('métadonnées et taille de cells', () => {
        assert.equal(maze.width, width);
        assert.equal(maze.height, height);
        assert.equal(maze.seed, seed);
        assert.ok(maze.cells instanceof Uint8Array);
        assert.equal(maze.cells.length, width * height);
        for (const v of maze.cells) assert.ok(v >= 0 && v <= 15, `valeur ${v}`);
      });

      test('objet gelé', () => {
        assert.ok(Object.isFrozen(maze));
      });

      test('bordures fermées', () => {
        for (let x = 0; x < width; x++) {
          assert.ok(cell(maze, x, 0) & WALL.N, `N manquant en (${x},0)`);
          assert.ok(cell(maze, x, height - 1) & WALL.S, `S manquant en (${x},${height - 1})`);
        }
        for (let y = 0; y < height; y++) {
          assert.ok(cell(maze, 0, y) & WALL.W, `W manquant en (0,${y})`);
          assert.ok(cell(maze, width - 1, y) & WALL.E, `E manquant en (${width - 1},${y})`);
        }
      });

      test('cohérence des murs voisins', () => {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const c = cell(maze, x, y);
            if (x < width - 1) {
              assert.equal(
                Boolean(c & WALL.E),
                Boolean(cell(maze, x + 1, y) & WALL.W),
                `E/W incohérent entre (${x},${y}) et (${x + 1},${y})`,
              );
            }
            if (y < height - 1) {
              assert.equal(
                Boolean(c & WALL.S),
                Boolean(cell(maze, x, y + 1) & WALL.N),
                `S/N incohérent entre (${x},${y}) et (${x},${y + 1})`,
              );
            }
          }
        }
      });

      test('connexité BFS depuis (0,0)', () => {
        assert.equal(bfsReachable(maze), width * height);
      });

      test('pas de cycle : w*h - 1 passages internes ouverts', () => {
        assert.equal(countOpenInternalPassages(maze), width * height - 1);
      });

      test('hasWall cohérent avec cells', () => {
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const c = cell(maze, x, y);
            for (const bit of [WALL.N, WALL.E, WALL.S, WALL.W]) {
              assert.equal(hasWall(maze, x, y, bit), Boolean(c & bit));
            }
          }
        }
      });
    });
  }
}

test('déterminisme : même entrée -> cells identiques octet par octet', () => {
  for (const [width, height] of SIZES) {
    for (const seed of SEEDS) {
      const a = generateMaze({ width, height, seed });
      const b = generateMaze({ width, height, seed });
      assert.notEqual(a.cells, b.cells, 'chaque appel doit produire son propre tableau');
      assert.deepEqual(Buffer.from(a.cells), Buffer.from(b.cells));
    }
  }
});

test('graines différentes -> cells différentes (16x16)', () => {
  const ref = generateMaze({ width: 16, height: 16, seed: 1 });
  for (const seed of [2, 3, 42, 1000, MAX_SEED]) {
    const other = generateMaze({ width: 16, height: 16, seed });
    assert.notDeepEqual(
      Buffer.from(other.cells),
      Buffer.from(ref.cells),
      `graine ${seed} identique à graine 1`,
    );
  }
});

test('hasWall : coordonnées hors grille -> RangeError', () => {
  const maze = generateMaze({ width: 4, height: 3, seed: 5 });
  for (const [x, y] of [[-1, 0], [0, -1], [4, 0], [0, 3], [10, 10]]) {
    assert.throws(() => hasWall(maze, x, y, WALL.N), RangeError, `(${x},${y})`);
  }
});

describe('validation des entrées', () => {
  const isTypeOrRange = (err) => err instanceof TypeError || err instanceof RangeError;

  test('options absent -> TypeError', () => {
    assert.throws(() => generateMaze(), TypeError);
    assert.throws(() => generateMaze(undefined), TypeError);
  });

  const badSizes = [1, 0, -3, 65, 2.5, NaN, '10'];
  for (const param of ['width', 'height']) {
    for (const bad of badSizes) {
      test(`${param} = ${JSON.stringify(bad) ?? String(bad)} rejeté avec message citant ${param}`, () => {
        const opts = { width: 8, height: 8, seed: 1, [param]: bad };
        assert.throws(
          () => generateMaze(opts),
          (err) => isTypeOrRange(err) && err.message.includes(param),
        );
      });
    }
  }

  test('width/height non numérique -> TypeError', () => {
    assert.throws(() => generateMaze({ width: '10', height: 8, seed: 1 }), TypeError);
    assert.throws(() => generateMaze({ width: 8, height: '10', seed: 1 }), TypeError);
  });

  test('width/height hors bornes ou non entier -> RangeError', () => {
    for (const bad of [1, 0, -3, 65, 2.5]) {
      assert.throws(() => generateMaze({ width: bad, height: 8, seed: 1 }), RangeError);
      assert.throws(() => generateMaze({ width: 8, height: bad, seed: 1 }), RangeError);
    }
  });

  const badSeeds = [
    ['-1', -1],
    ['MAX_SEED + 1', MAX_SEED + 1],
    ['3.7', 3.7],
  ];
  for (const [label, bad] of badSeeds) {
    test(`seed = ${label} -> RangeError citant seed`, () => {
      assert.throws(
        () => generateMaze({ width: 8, height: 8, seed: bad }),
        (err) => err instanceof RangeError && err.message.includes('seed'),
      );
    });
  }

  test('seed absent -> rejet citant seed', () => {
    assert.throws(
      () => generateMaze({ width: 8, height: 8 }),
      (err) => isTypeOrRange(err) && err.message.includes('seed'),
    );
  });

  test('bornes 2 et 64 acceptées', () => {
    const { minSize, maxSize } = MAZE_LIMITS;
    for (const [w, h] of [[minSize, minSize], [maxSize, maxSize], [minSize, maxSize], [maxSize, minSize]]) {
      const m = generateMaze({ width: w, height: h, seed: 3 });
      assert.equal(m.width, w);
      assert.equal(m.height, h);
    }
  });

  test('graines limites 0 et MAX_SEED acceptées', () => {
    assert.equal(generateMaze({ width: 4, height: 4, seed: 0 }).seed, 0);
    assert.equal(generateMaze({ width: 4, height: 4, seed: MAX_SEED }).seed, MAX_SEED);
  });
});

test('performance : 64x64 en moins de 200 ms (après chauffe)', () => {
  generateMaze({ width: 64, height: 64, seed: 1 }); // appel de chauffe (JIT)
  const start = performance.now();
  generateMaze({ width: 64, height: 64, seed: 2 });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 200, `64x64 généré en ${elapsed.toFixed(1)} ms`);
});
