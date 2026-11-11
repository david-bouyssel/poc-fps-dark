// BFS utilities on the tile grid (pure, no DOM).
//
// Cost: at most 129 x 129 = 16 641 tiles for a 64 x 64 maze. A caller (e.g. the future
// monster) must call these functions when its cell changes, not on every frame.

import { TILE } from '../maze/grid.js';

/** Valeur des tuiles non atteintes (murs, hors composante) dans tileDistances. */
export const UNREACHABLE = -1;

/** Ordre fixe des voisins (part du contrat de déterminisme) : N, E, S, W. */
export const NEIGHBOR_OFFSETS = Object.freeze([
  Object.freeze({ dx: 0, dy: -1 }),
  Object.freeze({ dx: 1, dy: 0 }),
  Object.freeze({ dx: 0, dy: 1 }),
  Object.freeze({ dx: -1, dy: 0 }),
]);

function validateGrid(grid) {
  if (grid === null || typeof grid !== 'object') {
    throw new TypeError('grid must be an object');
  }
  const { width, height, tiles } = grid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new TypeError('grid must have integer width and height >= 1');
  }
  if (tiles === null || typeof tiles !== 'object' || tiles.length !== width * height) {
    throw new TypeError('grid must have tiles of length width * height');
  }
}

function validateStart(grid, tx, ty) {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) {
    throw new TypeError('tile coordinates must be integers');
  }
  if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) {
    throw new RangeError('tile is outside the grid');
  }
  if (grid.tiles[ty * grid.width + tx] !== TILE.FLOOR) {
    throw new RangeError('tile is not a floor');
  }
}

/**
 * BFS interne. S'arrête dès que targetIndex (>= 0) est atteint.
 * @returns {{ dist: Int32Array, parent: Int32Array }}
 */
function bfs(grid, startTx, startTy, targetIndex) {
  const { width, height, tiles } = grid;
  const size = width * height;
  const dist = new Int32Array(size).fill(UNREACHABLE);
  const parent = new Int32Array(size).fill(-1);
  const queue = new Int32Array(size);
  let head = 0;
  let tail = 0;
  const start = startTy * width + startTx;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const current = queue[head++];
    if (current === targetIndex) break;
    const cx = current % width;
    const cy = (current - cx) / width;
    for (let i = 0; i < NEIGHBOR_OFFSETS.length; i++) {
      const nx = cx + NEIGHBOR_OFFSETS[i].dx;
      const ny = cy + NEIGHBOR_OFFSETS[i].dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (tiles[next] !== TILE.FLOOR || dist[next] !== UNREACHABLE) continue;
      dist[next] = dist[current] + 1;
      parent[next] = current;
      queue[tail++] = next;
    }
  }
  return { dist, parent };
}

/**
 * Distances BFS (en pas de tuile, 4-connexité, sols seulement) depuis (startTx, startTy).
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {number} startTx entier
 * @param {number} startTy entier
 * @returns {Int32Array} longueur width * height, index ty * width + tx ; UNREACHABLE pour
 *          les murs et les sols non atteignables ; 0 au départ. Nouveau tableau à chaque appel.
 * @throws {TypeError} grid mal formé, coordonnées non entières
 * @throws {RangeError} départ hors grille ou sur un mur
 */
export function tileDistances(grid, startTx, startTy) {
  validateGrid(grid);
  validateStart(grid, startTx, startTy);
  return bfs(grid, startTx, startTy, -1).dist;
}

/**
 * Distance de chemin entre deux tuiles de sol.
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {number} fromTx
 * @param {number} fromTy
 * @param {number} toTx
 * @param {number} toTy
 * @returns {number} entier >= 0, ou Infinity si non atteignable (jamais -1 : une
 *          comparaison `d <= seuil` reste sûre)
 * @throws {TypeError|RangeError} comme tileDistances, pour l'origine ET la cible
 */
export function pathDistance(grid, fromTx, fromTy, toTx, toTy) {
  validateGrid(grid);
  validateStart(grid, fromTx, fromTy);
  validateStart(grid, toTx, toTy);
  const target = toTy * grid.width + toTx;
  const d = bfs(grid, fromTx, fromTy, target).dist[target];
  return d === UNREACHABLE ? Infinity : d;
}

/**
 * Plus court chemin (BFS, voisins dans l'ordre NEIGHBOR_OFFSETS, premier atteint gagne).
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {number} fromTx
 * @param {number} fromTy
 * @param {number} toTx
 * @param {number} toTy
 * @returns {ReadonlyArray<{ tx: number, ty: number }> | null} tableau gelé d'éléments
 *          gelés, de l'origine à la cible incluses (longueur = distance + 1 ; [origine]
 *          si origine = cible) ; null si non atteignable
 * @throws {TypeError|RangeError} comme pathDistance
 */
export function shortestPath(grid, fromTx, fromTy, toTx, toTy) {
  validateGrid(grid);
  validateStart(grid, fromTx, fromTy);
  validateStart(grid, toTx, toTy);
  const { width } = grid;
  const target = toTy * width + toTx;
  const { dist, parent } = bfs(grid, fromTx, fromTy, target);
  if (dist[target] === UNREACHABLE) return null;
  const path = new Array(dist[target] + 1);
  let index = target;
  for (let i = path.length - 1; i >= 0; i--) {
    const tx = index % width;
    path[i] = Object.freeze({ tx, ty: (index - tx) / width });
    index = parent[index];
  }
  return Object.freeze(path);
}

/**
 * Tuile centrale d'une cellule : { tx: 2*cellX + 1, ty: 2*cellY + 1 } (gelé).
 * @param {number} cellX entier >= 0
 * @param {number} cellY entier >= 0
 * @returns {{ tx: number, ty: number }}
 * @throws {TypeError} coordonnées non entières ou négatives
 */
export function cellToTile(cellX, cellY) {
  if (!Number.isInteger(cellX) || !Number.isInteger(cellY) || cellX < 0 || cellY < 0) {
    throw new TypeError('cell coordinates must be non-negative integers');
  }
  return Object.freeze({ tx: 2 * cellX + 1, ty: 2 * cellY + 1 });
}

/**
 * Tuile contenant un point monde : { tx: Math.floor(x), ty: Math.floor(y) } (gelé).
 * @param {number} x
 * @param {number} y
 * @returns {{ tx: number, ty: number }}
 * @throws {TypeError} x ou y non fini
 */
export function tileAt(x, y) {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError('x and y must be finite numbers');
  }
  return Object.freeze({ tx: Math.floor(x), ty: Math.floor(y) });
}
