// Perfect maze generation (spanning tree) with an iterative depth-first search.
//
// Seed stability: for a given { width, height, seed }, the generated maze depends on
// mulberry32 (random.js), the start cell (0, 0), the neighbour order below
// (N, E, S, W) and randomInt. Changing any of these breaks every seed already shared.

import { createRng, randomInt, MAX_SEED } from './random.js';

// Bits de mur (un bit à 1 = mur présent)
export const WALL = Object.freeze({ N: 1, E: 2, S: 4, W: 8 });
export const ALL_WALLS = 15;
export const MAZE_LIMITS = Object.freeze({ minSize: 2, maxSize: 64 });

// Neighbour order is part of the seed contract: do not reorder.
const DIRECTIONS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1, wall: WALL.N, opposite: WALL.S }),
  Object.freeze({ dx: 1, dy: 0, wall: WALL.E, opposite: WALL.W }),
  Object.freeze({ dx: 0, dy: 1, wall: WALL.S, opposite: WALL.N }),
  Object.freeze({ dx: -1, dy: 0, wall: WALL.W, opposite: WALL.E }),
]);

const VALID_WALLS = new Set(Object.values(WALL));

/**
 * @typedef {Object} Maze
 * @property {number} width   nombre de colonnes de cellules
 * @property {number} height  nombre de lignes de cellules
 * @property {number} seed    graine utilisée
 * @property {Uint8Array} cells longueur width*height, masque de murs WALL par cellule
 */

function validateSize(value, name) {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number`);
  }
  if (
    !Number.isInteger(value) ||
    value < MAZE_LIMITS.minSize ||
    value > MAZE_LIMITS.maxSize
  ) {
    throw new RangeError(
      `${name} must be an integer between ${MAZE_LIMITS.minSize} and ${MAZE_LIMITS.maxSize}`,
    );
  }
}

function validateSeed(seed) {
  if (typeof seed !== 'number') {
    throw new TypeError('seed must be a number');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`seed must be an integer between 0 and ${MAX_SEED}`);
  }
}

/**
 * Génère un labyrinthe parfait (arbre couvrant) par DFS itératif.
 * Départ : cellule (0, 0). Voisins non visités tirés via randomInt(rng, n).
 * Fonction pure : mêmes arguments => résultat identique octet par octet.
 * @param {{ width: number, height: number, seed: number }} options
 * @returns {Maze} objet gelé (Object.freeze) ; cells n'est pas copiée à chaque accès
 * @throws {TypeError}  options absent, champ non numérique
 * @throws {RangeError} width/height non entier ou hors MAZE_LIMITS ;
 *                      seed non entier, < 0 ou > MAX_SEED
 */
export function generateMaze(options) {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object with width, height and seed');
  }
  const { width, height, seed } = options;
  validateSize(width, 'width');
  validateSize(height, 'height');
  validateSeed(seed);

  const rng = createRng(seed);
  const cellCount = width * height;
  const cells = new Uint8Array(cellCount).fill(ALL_WALLS);
  const visited = new Uint8Array(cellCount);
  const stack = new Int32Array(cellCount);
  const candidates = [];

  let top = 0;
  stack[top++] = 0;
  visited[0] = 1;

  while (top > 0) {
    const current = stack[top - 1];
    const cx = current % width;
    const cy = (current - cx) / width;

    candidates.length = 0;
    for (const dir of DIRECTIONS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (visited[ny * width + nx]) continue;
      candidates.push(dir);
    }

    if (candidates.length === 0) {
      top--;
      continue;
    }

    const dir = candidates[randomInt(rng, candidates.length)];
    const next = (cy + dir.dy) * width + (cx + dir.dx);
    cells[current] &= ~dir.wall;
    cells[next] &= ~dir.opposite;
    visited[next] = 1;
    stack[top++] = next;
  }

  return Object.freeze({ width, height, seed, cells });
}

/**
 * @param {Maze} maze
 * @param {number} x
 * @param {number} y
 * @param {number} wall une valeur de WALL
 * @returns {boolean}
 * @throws {RangeError} si (x, y) hors du labyrinthe, ou wall n'est pas une valeur de WALL
 */
export function hasWall(maze, x, y, wall) {
  if (!Number.isInteger(x) || x < 0 || x >= maze.width) {
    throw new RangeError(`x must be an integer between 0 and ${maze.width - 1}`);
  }
  if (!Number.isInteger(y) || y < 0 || y >= maze.height) {
    throw new RangeError(`y must be an integer between 0 and ${maze.height - 1}`);
  }
  if (!VALID_WALLS.has(wall)) {
    throw new RangeError('wall must be one of WALL.N, WALL.E, WALL.S, WALL.W');
  }
  return (maze.cells[y * maze.width + x] & wall) !== 0;
}
