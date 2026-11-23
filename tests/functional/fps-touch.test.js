// Plan docs/design/mobile-tactile.md §6 : simulation de update() avec un touchState, sans DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION, computeIntent } from '../../src/game/input.js';
import { stepPlayer } from '../../src/game/movement.js';
import {
  createTouchState,
  pressTouch,
  releaseTouch,
  touchActions,
} from '../../src/game/touch-input.js';

const W = 40;
const tiles = new Uint8Array(W * 3).fill(1);
for (let x = 1; x < W - 1; x += 1) tiles[W + x] = 0; // couloir horizontal, ligne 1
const grid = { width: W, height: 3, tiles };
const START = Object.freeze({ x: 1.5, y: 1.5, angle: 0 });
const DT = 1 / 60;

function run(player, touchState, frames, pressed = new Set()) {
  let p = player;
  for (let i = 0; i < frames; i += 1) {
    p = stepPlayer(p, computeIntent([...pressed, ...touchActions(touchState)]), DT, grid);
  }
  return p;
}

test('tactile : appui forward avance, relâchement arrête', () => {
  let s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
  const moved = run(START, s, 30);
  assert.ok(moved.x > START.x + 0.5, `x=${moved.x}`);
  s = releaseTouch(s, 1);
  const still = run(moved, s, 30);
  assert.equal(still.x, moved.x);
  assert.equal(still.y, moved.y);
});

test('tactile : forward + run va plus loin que forward seul', () => {
  const walk = run(START, pressTouch(createTouchState(), 1, ACTION.FORWARD), 30);
  let s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
  s = pressTouch(s, 2, ACTION.RUN);
  const fast = run(START, s, 30);
  assert.ok(fast.x > walk.x, `${fast.x} <= ${walk.x}`);
});

test('tactile : forward + turnRight avance et tourne', () => {
  let s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
  s = pressTouch(s, 2, ACTION.TURN_RIGHT);
  const p = run(START, s, 5);
  assert.notEqual(p.angle, START.angle);
});

test('tactile : forward et backward ensemble ne bougent pas', () => {
  let s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
  s = pressTouch(s, 2, ACTION.BACKWARD);
  const p = run(START, s, 30);
  assert.equal(p.x, START.x);
});

test('clavier + tactile sur la même action : un seul mouvement', () => {
  const s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
  const both = run(START, s, 20, new Set([ACTION.FORWARD]));
  const touchOnly = run(START, s, 20);
  assert.equal(both.x, touchOnly.x);
});
