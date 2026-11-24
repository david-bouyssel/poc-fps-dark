// Bilan de manche : temps de jeu, distance parcourue, part du labyrinthe explorée.
// Logique pure : aucun DOM, aucune horloge. Le temps est cumulé à partir des dt reçus par
// update() (la pause arrête la boucle, donc elle n'est jamais comptée).

import { TILE } from '../maze/grid.js';

/**
 * @typedef {Object} RoundStats  objet gelé
 * @property {number} elapsed   temps de jeu cumulé (s)
 * @property {number} distance  distance parcourue (tuiles)
 */

/**
 * @param {unknown} point
 * @param {string} name
 * @throws {TypeError} point sans x/y numériques finis
 */
function assertPoint(point, name) {
  if (
    point === null ||
    typeof point !== 'object' ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  ) {
    throw new TypeError(`${name} must have finite numeric x and y`);
  }
}

/**
 * Bilan vierge d'une manche.
 * @returns {Readonly<RoundStats>}
 */
export function createRoundStats() {
  return Object.freeze({ elapsed: 0, distance: 0 });
}

/**
 * Ajoute un pas de jeu : temps += dt, distance += déplacement réel de from à to.
 * Fonction pure : ne modifie pas `stats`.
 * @param {RoundStats} stats
 * @param {number} dt secondes, fini et >= 0
 * @param {{ x: number, y: number }} from position avant le pas
 * @param {{ x: number, y: number }} to position après le pas
 * @returns {Readonly<RoundStats>} nouveau bilan gelé
 * @throws {TypeError} stats, dt ou points mal formés
 */
export function advanceStats(stats, dt, from, to) {
  if (stats === null || typeof stats !== 'object'
    || !Number.isFinite(stats.elapsed) || !Number.isFinite(stats.distance)) {
    throw new TypeError('stats must have finite numeric elapsed and distance');
  }
  if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) {
    throw new TypeError('dt must be a finite number >= 0');
  }
  assertPoint(from, 'from');
  assertPoint(to, 'to');
  return Object.freeze({
    elapsed: stats.elapsed + dt,
    distance: stats.distance + Math.hypot(to.x - from.x, to.y - from.y),
  });
}

/**
 * Part du labyrinthe explorée : tuiles sol marquées / tuiles sol de la grille.
 * Les murs ne comptent ni au numérateur ni au dénominateur.
 * @param {Uint8Array} explored masque (non nul = marquée)
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @returns {number} entier 0..100, arrondi à l'inférieur ; 0 si aucune tuile sol
 * @throws {TypeError} arguments mal formés
 */
export function exploredRatio(explored, grid) {
  if (grid === null || typeof grid !== 'object' || !(grid.tiles instanceof Uint8Array)
    || !Number.isInteger(grid.width) || !Number.isInteger(grid.height)
    || grid.tiles.length !== grid.width * grid.height) {
    throw new TypeError('grid must have integer width/height and matching Uint8Array tiles');
  }
  if (!(explored instanceof Uint8Array) || explored.length !== grid.tiles.length) {
    throw new TypeError('explored must be a Uint8Array of width * height');
  }
  let floors = 0;
  let marked = 0;
  for (let i = 0; i < grid.tiles.length; i += 1) {
    if (grid.tiles[i] === TILE.FLOOR) {
      floors += 1;
      if (explored[i] !== 0) {
        marked += 1;
      }
    }
  }
  return floors === 0 ? 0 : Math.floor((marked * 100) / floors);
}

/**
 * Durée au format m:ss (secondes tronquées, minutes non bornées).
 * @param {number} seconds fini et >= 0
 * @returns {string} ex. "0:07", "12:05"
 * @throws {TypeError} non-nombre
 * @throws {RangeError} négatif ou non fini
 */
export function formatDuration(seconds) {
  if (typeof seconds !== 'number') {
    throw new TypeError('seconds must be a number');
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new RangeError('seconds must be finite and >= 0');
  }
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

/**
 * Distance en tuiles avec une décimale.
 * @param {number} tiles fini et >= 0
 * @returns {string} ex. "12,3" (virgule française)
 * @throws {TypeError} non-nombre
 * @throws {RangeError} négatif ou non fini
 */
export function formatDistance(tiles) {
  if (typeof tiles !== 'number') {
    throw new TypeError('tiles must be a number');
  }
  if (!Number.isFinite(tiles) || tiles < 0) {
    throw new RangeError('tiles must be finite and >= 0');
  }
  return tiles.toFixed(1).replace('.', ',');
}
