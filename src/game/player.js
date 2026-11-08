// Player state: starting position and orientation (pure, no DOM).

import { isWallTile } from '../maze/grid.js';

const TWO_PI = 2 * Math.PI;

/**
 * @typedef {Object} Player  objet gelé
 * @property {number} x      position en tuiles
 * @property {number} y
 * @property {number} angle  radians, dans [0, 2*PI)
 */

/** Rayon de collision du joueur, en tuiles. */
export const PLAYER_RADIUS = 0.2;

/**
 * Normalise un angle dans [0, 2*PI).
 * @param {number} angle radians
 * @returns {number} angle équivalent dans [0, 2*PI)
 * @throws {TypeError} angle non numérique ou non fini
 */
export function normalizeAngle(angle) {
  if (typeof angle !== 'number' || !Number.isFinite(angle)) {
    throw new TypeError('angle must be a finite number');
  }
  const normalized = ((angle % TWO_PI) + TWO_PI) % TWO_PI;
  // Rounding can yield exactly 2*PI for tiny negative inputs.
  return normalized >= TWO_PI ? 0 : normalized;
}

/**
 * Joueur de départ : centre de la cellule (0, 0), soit (1.5, 1.5).
 * Orientation : vers l'est (0) si la tuile (2, 1) est un sol, sinon vers le sud (PI/2).
 * (Labyrinthe parfait : la cellule (0, 0) a toujours au moins un passage E ou S.)
 * Ne modifie pas la grille.
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @returns {Player}
 * @throws {TypeError} grid absent ou mal formé (tiles non Uint8Array, dimensions non
 *                     entières, tiles.length !== width * height)
 * @throws {RangeError} tuile (1, 1) non sol
 */
export function createPlayer(grid) {
  if (grid === null || typeof grid !== 'object') {
    throw new TypeError('grid must be an object');
  }
  const { width, height, tiles } = grid;
  if (!Number.isInteger(width) || width < 0 || !Number.isInteger(height) || height < 0) {
    throw new TypeError('grid.width and grid.height must be non-negative integers');
  }
  if (!(tiles instanceof Uint8Array)) {
    throw new TypeError('grid.tiles must be a Uint8Array');
  }
  if (tiles.length !== width * height) {
    throw new TypeError('grid.tiles length must equal grid.width * grid.height');
  }
  if (isWallTile(grid, 1, 1)) {
    throw new RangeError('grid tile (1, 1) must be a floor tile');
  }
  const angle = isWallTile(grid, 2, 1) ? Math.PI / 2 : 0;
  return Object.freeze({ x: 1.5, y: 1.5, angle });
}
