// Flux bout en bout côté Node (plan docs/design/dark-sortie-victoire.md §6) :
// generateMaze -> toTileGrid -> findExit -> shortestPath de (1, 1) à la sortie ->
// pilote clavier (actionForCode) -> createGameLoop (faux requestFrame) -> stepPlayer ->
// checkVictory à chaque image, comme update() de main.js (§4.3).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { actionForCode, computeIntent } from '../../src/game/input.js';
import { stepPlayer, collides } from '../../src/game/movement.js';
import { createGameLoop } from '../../src/game/loop.js';
import { shortestPath } from '../../src/game/pathfinding.js';
import { findExit, isAtExit } from '../../src/game/exit.js';
import {
  GAME_STATUS,
  createGameState,
  checkVictory,
  declareDefeat,
  isGameOver,
} from '../../src/game/game-state.js';

const FRAME_MS = 16;
const MAX_FRAMES = 40000;
const TWO_PI = 2 * Math.PI;

function fakeFrames() {
  let id = 0;
  let pending = null;
  return {
    requestFrame(cb) { pending = cb; return ++id; },
    cancelFrame() { pending = null; },
    tick(t) {
      const cb = pending;
      pending = null;
      if (cb) cb(t);
      return cb !== null;
    },
  };
}

function angleDiff(target, current) {
  let d = (target - current) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d <= -Math.PI) d += TWO_PI;
  return d;
}

for (const [width, height, seed] of [[8, 8, 42], [8, 8, 7], [12, 6, 2024], [16, 16, 99]]) {
  describe(`parcours jusqu'à la sortie ${width} x ${height}, graine ${seed}`, () => {
    const grid = toTileGrid(generateMaze({ width, height, seed }));
    const exit = findExit(grid);

    test('PLAYING avant la tuile de sortie, WON en y entrant, declareDefeat sans effet ensuite', () => {
      const path = shortestPath(grid, 1, 1, exit.tx, exit.ty);
      assert.ok(path && path.length >= 2, 'chemin vers la sortie introuvable');
      assert.equal(path.length - 1, exit.distance, 'longueur du chemin = distance de la sortie');

      let player = createPlayer(grid);
      let state = createGameState();
      let waypoint = 1;
      let frame = 0;
      let wonFrame = -1;
      let enteredFrame = -1;
      const pressed = new Set();

      function pilot() {
        pressed.clear();
        if (waypoint >= path.length) return;
        let tx = path[waypoint].tx + 0.5;
        let ty = path[waypoint].ty + 0.5;
        if (Math.hypot(tx - player.x, ty - player.y) < 0.15 && waypoint < path.length - 1) {
          waypoint++;
          tx = path[waypoint].tx + 0.5;
          ty = path[waypoint].ty + 0.5;
        }
        const diff = angleDiff(Math.atan2(ty - player.y, tx - player.x), player.angle);
        pressed.add(actionForCode(Math.abs(diff) > 0.05 ? (diff > 0 ? 'ArrowRight' : 'ArrowLeft') : 'KeyW'));
      }

      const frames = fakeFrames();
      const loop = createGameLoop({
        update(dt) {
          if (isGameOver(state)) return; // main.js : partie finie -> rien
          pilot();
          player = stepPlayer(player, computeIntent(pressed), dt, grid);
          const inExit = Math.floor(player.x) === exit.tx && Math.floor(player.y) === exit.ty;
          if (inExit && enteredFrame < 0) enteredFrame = frame;
          const before = state;
          state = checkVictory(state, player, exit);
          if (!inExit) {
            assert.equal(state, before, `image ${frame} : état changé hors de la sortie`);
            assert.equal(state.status, GAME_STATUS.PLAYING, `image ${frame} : partie finie hors sortie`);
          } else if (wonFrame < 0) {
            assert.equal(state.status, GAME_STATUS.WON, `image ${frame} : dans la sortie sans victoire`);
            wonFrame = frame;
          }
        },
        render() {
          frame++;
          assert.equal(collides(grid, player.x, player.y), false, `image ${frame} : collision`);
        },
        requestFrame: frames.requestFrame,
        cancelFrame: frames.cancelFrame,
      });

      loop.start();
      let t = 1000;
      while (!isGameOver(state) && frame < MAX_FRAMES) {
        assert.ok(frames.tick(t), 'la boucle doit redemander une image');
        t += FRAME_MS;
      }
      loop.stop();

      assert.ok(frame < MAX_FRAMES, `sortie non atteinte en ${frame} images (étape ${waypoint}/${path.length})`);
      assert.equal(state.status, GAME_STATUS.WON);
      assert.equal(wonFrame, enteredFrame, 'victoire dès l\'entrée dans la tuile de sortie');
      assert.ok(isAtExit(player, exit));
      assert.ok(waypoint >= path.length - 1, 'victoire avant la fin du chemin');

      // La victoire n'est jamais changée en défaite, ni défaite par une nouvelle vérification.
      assert.equal(declareDefeat(state), state);
      assert.equal(declareDefeat(state).status, GAME_STATUS.WON);
      assert.equal(checkVictory(state, { x: 1.5, y: 1.5 }, exit), state);
    });

    test('manche neuve : départ hors sortie, partie en cours', () => {
      const player = createPlayer(grid);
      const state = createGameState();
      assert.equal(isAtExit(player, exit), false);
      assert.equal(checkVictory(state, player, exit), state);
      assert.equal(isGameOver(state), false);
    });
  });
}
