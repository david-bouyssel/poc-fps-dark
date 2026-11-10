// Plan docs/design/fps-automap.md §6 : exploration le long du parcours BFS (0,0) -> (7,7).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, isWallTile } from '../../src/maze/grid.js';
import { createExploredMask, revealVisibleTiles } from '../../src/render/automap.js';

const SIZE = 8;

function bfsPath(grid, w, h) {
  const goal = (h - 1) * w + (w - 1);
  const prev = new Int32Array(w * h).fill(-1);
  prev[0] = 0;
  const queue = [0];
  while (queue.length) {
    const c = queue.shift();
    if (c === goal) break;
    const cx = c % w;
    const cy = Math.floor(c / w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (isWallTile(grid, 2 * cx + 1 + dx, 2 * cy + 1 + dy)) continue;
      const n = ny * w + nx;
      if (prev[n] !== -1) continue;
      prev[n] = c;
      queue.push(n);
    }
  }
  assert.notEqual(prev[goal], -1);
  const path = [];
  for (let c = goal; c !== 0; c = prev[c]) path.push(c);
  path.push(0);
  return path.reverse().map((c) => [c % w, Math.floor(c / w)]);
}

for (const seed of [42, 7, 2024]) {
  describe(`exploration graine ${seed}`, () => {
    const grid = toTileGrid(generateMaze({ width: SIZE, height: SIZE, seed }));

    test('tuiles traversées marquées, labyrinthe non entièrement révélé', () => {
      const path = bfsPath(grid, SIZE, SIZE);
      const mask = createExploredMask(grid);
      const traversed = new Set();
      for (let i = 0; i < path.length; i++) {
        const [cx, cy] = path[i];
        const last = i + 1 >= path.length;
        const next = last ? path[i] : path[i + 1];
        const x0 = 2 * cx + 1.5;
        const y0 = 2 * cy + 1.5;
        const dxw = 2 * (next[0] - cx);
        const dyw = 2 * (next[1] - cy);
        const angle = last ? 0 : Math.atan2(dyw, dxw);
        for (const t of [0, 0.25, 0.5, 0.75]) {
          const x = x0 + dxw * t;
          const y = y0 + dyw * t;
          revealVisibleTiles(mask, grid, { x, y, angle });
          traversed.add(`${Math.floor(x)},${Math.floor(y)}`);
        }
      }
      for (const key of traversed) {
        const [x, y] = key.split(',').map(Number);
        assert.equal(mask[y * grid.width + x], 1, `tuile (${x},${y}) non marquée`);
      }
      const marked = mask.reduce((a, v) => a + v, 0);
      assert.ok(marked > traversed.size);
      assert.ok(marked < grid.width * grid.height, `${marked} / ${grid.width * grid.height}`);
    });
  });
}
