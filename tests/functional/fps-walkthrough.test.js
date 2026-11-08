// Flux bout en bout côté Node (plan docs/design/vue-fps.md §6) :
// generateMaze -> toTileGrid -> createPlayer -> createGameLoop (faux requestFrame)
// -> stepPlayer(player, computeIntent(actions), dt, grid), actions issues de codes
// clavier physiques via actionForCode.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, isWallTile } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { actionForCode, computeIntent } from '../../src/game/input.js';
import { stepPlayer, collides } from '../../src/game/movement.js';
import { createGameLoop } from '../../src/game/loop.js';
import { castRays, MIN_DISTANCE } from '../../src/render/raycaster.js';

const SIZE = 8;
const FRAME_MS = 16;
const TWO_PI = 2 * Math.PI;

function fakeFrames() {
  let id = 0;
  let pending = null;
  return {
    requestFrame(cb) {
      pending = cb;
      return ++id;
    },
    cancelFrame() {
      pending = null;
    },
    tick(t) {
      const cb = pending;
      pending = null;
      if (cb) cb(t);
      return cb !== null;
    },
  };
}

/** Chemin BFS de cellules de (0, 0) à (w-1, h-1) sur la grille de tuiles. */
function bfsPath(grid, w, h) {
  const start = 0;
  const goal = (h - 1) * w + (w - 1);
  const prev = new Int32Array(w * h).fill(-1);
  prev[start] = start;
  const queue = [start];
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
  assert.notEqual(prev[goal], -1, 'cellule d\'arrivée inaccessible');
  const path = [];
  for (let c = goal; c !== start; c = prev[c]) path.push(c);
  path.push(start);
  return path.reverse().map((c) => [c % w, Math.floor(c / w)]);
}

const center = ([cx, cy]) => [2 * cx + 1.5, 2 * cy + 1.5];

/** Différence d'angle signée dans ]-PI, PI]. */
function angleDiff(target, current) {
  let d = (target - current) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

function assertValidHits(grid, hits, columnCount) {
  assert.equal(hits.length, columnCount);
  for (const hit of hits) {
    assert.ok(Number.isFinite(hit.distance) && hit.distance >= MIN_DISTANCE, `distance ${hit.distance}`);
    assert.ok(hit.side === 'x' || hit.side === 'y');
    assert.equal(isWallTile(grid, hit.tileX, hit.tileY), true, `(${hit.tileX},${hit.tileY}) non mur`);
    assert.ok(hit.wallX >= 0 && hit.wallX < 1, `wallX ${hit.wallX}`);
  }
}

for (const seed of [42, 7, 2024]) {
  describe(`balade FPS 8x8 graine ${seed}`, () => {
    const grid = toTileGrid(generateMaze({ width: SIZE, height: SIZE, seed }));

    test('pilote BFS de (0, 0) à (7, 7) sans collision', () => {
      const path = bfsPath(grid, SIZE, SIZE);
      let player = createPlayer(grid);
      let waypoint = 1;
      let frame = 0;
      let rayChecks = 0;
      const pressed = new Set();

      function pilot() {
        pressed.clear();
        if (waypoint >= path.length) return;
        let [tx, ty] = center(path[waypoint]);
        if (Math.hypot(tx - player.x, ty - player.y) < 0.15) {
          waypoint++;
          if (waypoint >= path.length) return;
          [tx, ty] = center(path[waypoint]);
        }
        const diff = angleDiff(Math.atan2(ty - player.y, tx - player.x), player.angle);
        if (Math.abs(diff) > 0.05) {
          pressed.add(actionForCode(diff > 0 ? 'ArrowRight' : 'ArrowLeft'));
        } else {
          pressed.add(actionForCode('KeyW'));
        }
      }

      const frames = fakeFrames();
      const loop = createGameLoop({
        update(dt) {
          pilot();
          player = stepPlayer(player, computeIntent(pressed), dt, grid);
        },
        render() {
          frame++;
          assert.equal(collides(grid, player.x, player.y), false, `image ${frame} : collision en (${player.x}, ${player.y})`);
          assert.equal(isWallTile(grid, Math.floor(player.x), Math.floor(player.y)), false);
          if (frame % 100 === 0) {
            assertValidHits(grid, castRays(grid, player, 64), 64);
            rayChecks++;
          }
        },
        requestFrame: frames.requestFrame,
        cancelFrame: frames.cancelFrame,
      });

      loop.start();
      let t = 1000;
      while (waypoint < path.length && frame < 20000) {
        assert.ok(frames.tick(t), 'la boucle doit redemander une image');
        t += FRAME_MS;
      }
      loop.stop();

      assert.ok(frame < 20000, `arrivée non atteinte en ${frame} images (étape ${waypoint}/${path.length})`);
      assert.equal(Math.floor((player.x - 1) / 2), SIZE - 1, `cellule x finale ${player.x}`);
      assert.equal(Math.floor((player.y - 1) / 2), SIZE - 1, `cellule y finale ${player.y}`);
      assert.ok(rayChecks > 0, 'castRays vérifié au moins une fois');
      assert.equal(frames.tick(t), false, 'plus aucune image après stop');
    });

    test('foncer dans un mur pendant 5 s simulées -> position bloquée', () => {
      // Le nord de la cellule (0, 0) est la bordure : toujours un mur.
      const start = createPlayer(grid);
      let player = Object.freeze({ x: start.x, y: start.y, angle: 1.5 * Math.PI });
      const pressed = new Set(['KeyW', 'ShiftLeft'].map(actionForCode));
      const frames = fakeFrames();
      let frameCount = 0;
      const loop = createGameLoop({
        update(dt) {
          player = stepPlayer(player, computeIntent(pressed), dt, grid);
        },
        render() {
          frameCount++;
          assert.equal(collides(grid, player.x, player.y), false);
        },
        requestFrame: frames.requestFrame,
        cancelFrame: frames.cancelFrame,
      });
      loop.start();
      for (let t = 0; t <= 5000; t += FRAME_MS) frames.tick(t);
      loop.stop();
      assert.ok(frameCount > 300);
      assert.ok(player.y >= 1 + 0.2 - 1e-9, `traversée du mur nord : y = ${player.y}`);
      assert.ok(player.y < 1.5 + 1e-9, `le joueur n'a pas avancé vers le mur : y = ${player.y}`);
      assert.ok(Math.abs(player.x - start.x) < 1e-6, `dérive en x : ${player.x}`);
      assert.equal(Math.floor(player.y), 1);
    });
  });
}
