// Fruits to collect in the maze: species, seeded placement, pickup and score.
//
// Pure module: no DOM, no Math.random, no Date. Fruit placement uses its own PRNG
// stream, so the "seed -> maze" contract of generateMaze is untouched.
//
// Seed stability: the fruit layout for a given seed depends on FRUIT_SEED_SALT, on the
// order of FRUIT_TABLE and on the algorithm of placeFruits. Changing any of them changes
// the fruits of a shared seed (never its maze).

import { createRng, randomInt, MAX_SEED } from '../maze/random.js';
import { MAZE_LIMITS } from '../maze/maze.js';

export const FRUIT_KIND = Object.freeze({
  STRAWBERRY: 'strawberry',
  CHERRY: 'cherry',
  PEACH: 'peach',
  DRAGONFRUIT: 'dragonfruit',
});

/** Frozen order (most common to rarest): part of the seed contract. */
export const FRUIT_TABLE = Object.freeze([
  Object.freeze({ kind: FRUIT_KIND.STRAWBERRY, weight: 55, points: 10 }),
  Object.freeze({ kind: FRUIT_KIND.CHERRY, weight: 28, points: 25 }),
  Object.freeze({ kind: FRUIT_KIND.PEACH, weight: 13, points: 50 }),
  Object.freeze({ kind: FRUIT_KIND.DRAGONFRUIT, weight: 4, points: 100 }),
]);

export const FRUIT_SEED_SALT = 0x9E3779B9;
export const FRUIT_DENSITY = 0.125;
export const MAX_FRUITS = 96;
export const PICKUP_RADIUS = 0.5;

const TOTAL_WEIGHT = FRUIT_TABLE.reduce((sum, entry) => sum + entry.weight, 0);

/**
 * @typedef {{ id: number, kind: string, cellX: number, cellY: number,
 *             x: number, y: number }} Fruit  frozen, x/y in tiles
 * @typedef {{ fruits: ReadonlyArray<Fruit>, score: number, collected: number,
 *             total: number }} FruitState
 */

/**
 * Number of fruits for a maze of cellCount cells.
 * @param {number} cellCount entier >= 1
 * @returns {number}
 */
export function fruitCount(cellCount) {
  if (!Number.isInteger(cellCount) || cellCount < 1) {
    throw new RangeError('cellCount must be an integer >= 1');
  }
  return Math.max(0, Math.min(
    MAX_FRUITS,
    cellCount - 1,
    Math.max(1, Math.floor(cellCount * FRUIT_DENSITY)),
  ));
}

/**
 * Points of a species.
 * @param {string} kind
 * @returns {number}
 * @throws {RangeError} unknown species
 */
export function pointsFor(kind) {
  const entry = FRUIT_TABLE.find((e) => e.kind === kind);
  if (!entry) {
    throw new RangeError(`unknown fruit kind: ${String(kind)}`);
  }
  return entry.points;
}

function isDimension(value) {
  return Number.isInteger(value)
    && value >= MAZE_LIMITS.minSize && value <= MAZE_LIMITS.maxSize;
}

/**
 * @param {{ width: number, height: number, seed: number }} maze
 * @returns {ReadonlyArray<Fruit>} frozen, sorted by increasing id
 * @throws {TypeError|RangeError} malformed maze
 */
export function placeFruits(maze) {
  if (maze === null || typeof maze !== 'object') {
    throw new TypeError('maze must be an object');
  }
  const { width, height, seed } = maze;
  if (typeof width !== 'number' || typeof height !== 'number'
    || typeof seed !== 'number') {
    throw new TypeError('maze width, height and seed must be numbers');
  }
  if (!isDimension(width) || !isDimension(height)) {
    throw new RangeError('maze dimensions must be integers within limits');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError('maze seed must be an integer in [0, 0xFFFFFFFF]');
  }

  const cellCount = width * height;
  const count = fruitCount(cellCount);
  const rng = createRng((seed ^ FRUIT_SEED_SALT) >>> 0);

  // Candidates: cell indexes 1..cellCount-1 (cell 0, the start, never has a fruit).
  const n = cellCount - 1;
  const candidates = new Array(n);
  for (let i = 0; i < n; i += 1) candidates[i] = i + 1;

  // Partial Fisher-Yates: the first `count` entries are kept.
  for (let i = 0; i < count; i += 1) {
    const j = i + randomInt(rng, n - i);
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  const fruits = [];
  for (let id = 0; id < count; id += 1) {
    const index = candidates[id];
    const r = randomInt(rng, TOTAL_WEIGHT);
    let cumulative = 0;
    let kind = FRUIT_TABLE[FRUIT_TABLE.length - 1].kind;
    for (const entry of FRUIT_TABLE) {
      cumulative += entry.weight;
      if (r < cumulative) {
        kind = entry.kind;
        break;
      }
    }
    const cellX = index % width;
    const cellY = Math.floor(index / width);
    fruits.push(Object.freeze({
      id, kind, cellX, cellY, x: 2 * cellX + 1.5, y: 2 * cellY + 1.5,
    }));
  }
  return Object.freeze(fruits);
}

/**
 * @param {ReadonlyArray<Fruit>} fruits
 * @returns {FruitState}
 */
export function createFruitState(fruits) {
  if (!Array.isArray(fruits)) {
    throw new TypeError('fruits must be an array');
  }
  return Object.freeze({
    fruits: Object.freeze(fruits.slice()),
    score: 0,
    collected: 0,
    total: fruits.length,
  });
}

/**
 * Collects fruits within `radius` of `position`. Pure: returns a new state, or the same
 * reference when nothing is collected.
 * @param {FruitState} state
 * @param {{ x: number, y: number }} position
 * @param {number} [radius=PICKUP_RADIUS]
 * @returns {FruitState}
 * @throws {TypeError} malformed state or non-finite coordinates
 */
export function collectFruits(state, position, radius = PICKUP_RADIUS) {
  if (state === null || typeof state !== 'object' || !Array.isArray(state.fruits)
    || !Number.isFinite(state.score) || !Number.isFinite(state.collected)
    || !Number.isFinite(state.total)) {
    throw new TypeError('state must be a fruit state');
  }
  if (position === null || typeof position !== 'object'
    || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new TypeError('position must have finite x and y');
  }
  if (!Number.isFinite(radius)) {
    throw new TypeError('radius must be finite');
  }

  const remaining = [];
  let gained = 0;
  let picked = 0;
  for (const fruit of state.fruits) {
    if (Math.hypot(fruit.x - position.x, fruit.y - position.y) <= radius) {
      gained += pointsFor(fruit.kind);
      picked += 1;
    } else {
      remaining.push(fruit);
    }
  }
  if (picked === 0) return state;
  return Object.freeze({
    fruits: Object.freeze(remaining),
    score: state.score + gained,
    collected: state.collected + picked,
    total: state.total,
  });
}
