// Maze exit: farthest cell from the start by path distance (pure, no DOM).
//
// Seed contract: the exit of a seed depends on toTileGrid, on the neighbor order of the
// BFS (NEIGHBOR_OFFSETS) and on the tie rule below. Changing any of them changes the exit
// of a shared seed (never the maze itself).

import { TILE } from '../maze/grid.js';
import { tileDistances, UNREACHABLE } from './pathfinding.js';

/**
 * @typedef {Object} Exit  objet gelé
 * @property {number} cellX
 * @property {number} cellY
 * @property {number} tx        = 2*cellX + 1
 * @property {number} ty        = 2*cellY + 1
 * @property {number} x         = tx + 0.5 (centre monde)
 * @property {number} y         = ty + 0.5
 * @property {number} distance  distance de chemin en tuiles depuis la tuile (1, 1)
 */

/**
 * Sortie : la cellule dont la tuile centrale est la plus éloignée de la tuile (1, 1)
 * (cellule (0, 0)) au sens de tileDistances. Seules les tuiles (impair, impair) sont
 * candidates. Égalité : plus petit index de cellule cellY * mazeWidth + cellX (parcours
 * ligne par ligne, on ne remplace que si strictement plus loin).
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid grille issue de
 *        toTileGrid (dimensions impaires >= 5)
 * @returns {Exit}
 * @throws {TypeError} grid mal formé
 * @throws {RangeError} dimensions paires ou < 5, tuile (1, 1) non sol, aucune cellule
 *         atteignable autre que (0, 0)
 */
export function findExit(grid) {
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
  if (width % 2 === 0 || height % 2 === 0 || width < 5 || height < 5) {
    throw new RangeError('grid dimensions must be odd and >= 5');
  }
  if (tiles[1 * width + 1] !== TILE.FLOOR) {
    throw new RangeError('tile (1, 1) must be a floor');
  }

  const dist = tileDistances(grid, 1, 1);
  const mazeWidth = (width - 1) / 2;
  const mazeHeight = (height - 1) / 2;
  let bestX = -1;
  let bestY = -1;
  let bestDistance = 0;
  for (let cellY = 0; cellY < mazeHeight; cellY++) {
    for (let cellX = 0; cellX < mazeWidth; cellX++) {
      if (cellX === 0 && cellY === 0) continue;
      const d = dist[(2 * cellY + 1) * width + (2 * cellX + 1)];
      if (d !== UNREACHABLE && d > bestDistance) {
        bestDistance = d;
        bestX = cellX;
        bestY = cellY;
      }
    }
  }
  if (bestX < 0) {
    throw new RangeError('no reachable cell other than (0, 0)');
  }
  const tx = 2 * bestX + 1;
  const ty = 2 * bestY + 1;
  return Object.freeze({
    cellX: bestX,
    cellY: bestY,
    tx,
    ty,
    x: tx + 0.5,
    y: ty + 0.5,
    distance: bestDistance,
  });
}

/**
 * true si la position est dans la tuile de la sortie (Math.floor(x) === exit.tx et
 * Math.floor(y) === exit.ty).
 * @param {{ x: number, y: number }} position
 * @param {{ tx: number, ty: number }} exit
 * @returns {boolean}
 * @throws {TypeError} position ou exit mal formé (non finis / non entiers)
 */
export function isAtExit(position, exit) {
  if (position === null || typeof position !== 'object'
    || typeof position.x !== 'number' || typeof position.y !== 'number'
    || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new TypeError('position must have finite x and y');
  }
  if (exit === null || typeof exit !== 'object'
    || !Number.isInteger(exit.tx) || !Number.isInteger(exit.ty)) {
    throw new TypeError('exit must have integer tx and ty');
  }
  return Math.floor(position.x) === exit.tx && Math.floor(position.y) === exit.ty;
}
