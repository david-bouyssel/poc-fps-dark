// Pure raycasting engine (DDA) on the tile grid. No DOM, no window, no global time.

import { isWallTile } from '../maze/grid.js';

/** Champ de vision horizontal par défaut, en radians (60°). */
export const FOV = Math.PI / 3;

/** Distance minimale renvoyée, en tuiles : évite les divisions par ~0. */
export const MIN_DISTANCE = 0.05;

const DEFAULT_FOG_DISTANCE = 8;
const DEFAULT_MAX_FOG = 0.6;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * @typedef {Object} RayHit  objet gelé
 * @property {number} distance  distance perpendiculaire au plan caméra (anti fish-eye),
 *                              >= MIN_DISTANCE
 * @property {'x'|'y'} side     'x' : face verticale (mur est/ouest), 'y' : horizontale
 * @property {number} tileX
 * @property {number} tileY     tuile mur touchée
 * @property {number} wallX     position du point d'impact le long de la face, [0, 1)
 */

/**
 * Lance `columnCount` rayons répartis uniformément sur le plan caméra (méthode
 * direction + plan, demi-largeur du plan = tan(fov / 2)), de gauche à droite à l'écran.
 * Algorithme DDA ; composante de direction nulle -> pas infini géré sans NaN.
 * Garde-fou : au plus grid.width + grid.height pas par rayon ; hors grille = mur.
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {{ x: number, y: number, angle: number }} player
 * @param {number} columnCount entier >= 1
 * @param {number} [fov=FOV] radians, dans ]0, PI[
 * @returns {RayHit[]} longueur columnCount
 * @throws {TypeError} grid ou player mal formé
 * @throws {RangeError} columnCount ou fov invalide
 */
export function castRays(grid, player, columnCount, fov = FOV) {
  if (grid === null || typeof grid !== 'object'
    || !Number.isInteger(grid.width) || !Number.isInteger(grid.height)) {
    throw new TypeError('grid must be { width, height, tiles } with integer dimensions');
  }
  if (player === null || typeof player !== 'object'
    || !Number.isFinite(player.x) || !Number.isFinite(player.y)
    || !Number.isFinite(player.angle)) {
    throw new TypeError('player must be { x, y, angle } with finite numbers');
  }
  if (!Number.isInteger(columnCount) || columnCount < 1) {
    throw new RangeError('columnCount must be an integer >= 1');
  }
  if (typeof fov !== 'number' || !(fov > 0 && fov < Math.PI)) {
    throw new RangeError('fov must be a number in ]0, PI[');
  }

  const { x: posX, y: posY, angle } = player;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  // Right vector in a y-down frame is (-sin a, cos a).
  const planeScale = Math.tan(fov / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;
  const maxSteps = grid.width + grid.height;
  const startTileX = Math.floor(posX);
  const startTileY = Math.floor(posY);

  const hits = new Array(columnCount);
  for (let column = 0; column < columnCount; column++) {
    // Column centre, from -1 (left edge) to +1 (right edge).
    const cameraX = (2 * (column + 0.5)) / columnCount - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;
    hits[column] = castSingleRay(
      grid, posX, posY, startTileX, startTileY, rayDirX, rayDirY, maxSteps,
    );
  }
  return hits;
}

function castSingleRay(grid, posX, posY, startTileX, startTileY, rayDirX, rayDirY, maxSteps) {
  let tileX = startTileX;
  let tileY = startTileY;
  const deltaDistX = rayDirX === 0 ? Infinity : Math.abs(1 / rayDirX);
  const deltaDistY = rayDirY === 0 ? Infinity : Math.abs(1 / rayDirY);
  const stepX = rayDirX < 0 ? -1 : 1;
  const stepY = rayDirY < 0 ? -1 : 1;
  // Zero direction component: never cross on that axis (avoid 0 * Infinity = NaN).
  let sideDistX = rayDirX === 0
    ? Infinity
    : (rayDirX < 0 ? posX - tileX : tileX + 1 - posX) * deltaDistX;
  let sideDistY = rayDirY === 0
    ? Infinity
    : (rayDirY < 0 ? posY - tileY : tileY + 1 - posY) * deltaDistY;

  let side = 'x';
  let hit = false;
  for (let step = 0; step < maxSteps; step++) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      tileX += stepX;
      side = 'x';
    } else {
      sideDistY += deltaDistY;
      tileY += stepY;
      side = 'y';
    }
    if (isWallTile(grid, tileX, tileY)) {
      hit = true;
      break;
    }
  }

  let rawDistance = side === 'x' ? sideDistX - deltaDistX : sideDistY - deltaDistY;
  if (!hit || !Number.isFinite(rawDistance) || rawDistance < 0) {
    // Safety net only: with a closed world (outside grid = wall) a ray always hits.
    rawDistance = Number.isFinite(rawDistance) && rawDistance > 0 ? rawDistance : MIN_DISTANCE;
  }

  let wallX = side === 'x' ? posY + rawDistance * rayDirY : posX + rawDistance * rayDirX;
  wallX -= Math.floor(wallX);
  if (!(wallX >= 0 && wallX < 1)) {
    wallX = 0;
  }

  return Object.freeze({
    distance: Math.max(rawDistance, MIN_DISTANCE),
    side,
    tileX,
    tileY,
    wallX,
  });
}

/**
 * Projection d'une colonne de mur. Hauteur = viewHeight / distance (mur de 1 tuile vu à
 * 1 tuile = toute la hauteur), centrée verticalement ; top/bottom bornés à [0, viewHeight].
 * Une distance inférieure à MIN_DISTANCE est traitée comme MIN_DISTANCE.
 * @param {number} distance tuiles
 * @param {number} viewHeight hauteur de la vue (px), finie et >= 0
 * @returns {{ top: number, bottom: number }}
 * @throws {RangeError} distance NaN ou viewHeight invalide
 */
export function projectColumn(distance, viewHeight) {
  if (typeof distance !== 'number' || Number.isNaN(distance)) {
    throw new RangeError('distance must be a number');
  }
  if (!Number.isFinite(viewHeight) || viewHeight < 0) {
    throw new RangeError('viewHeight must be a finite number >= 0');
  }
  const wallHeight = viewHeight / Math.max(distance, MIN_DISTANCE);
  const top = (viewHeight - wallHeight) / 2;
  return {
    top: clamp(top, 0, viewHeight),
    bottom: clamp(top + wallHeight, 0, viewHeight),
  };
}

/**
 * Facteur de mélange vers la couleur de brouillard, dans [0, maxFog] :
 * 0 près du joueur, croissant linéairement avec la distance jusqu'à fogDistance.
 * Distance négative ou NaN -> 0.
 * @param {number} distance
 * @param {{ fogDistance?: number, maxFog?: number }} [options] défauts 8 et 0.6
 * @returns {number}
 * @throws {RangeError} fogDistance non > 0 ou maxFog hors [0, 1]
 */
export function fogFactor(distance, options = {}) {
  const fogDistance = options.fogDistance ?? DEFAULT_FOG_DISTANCE;
  const maxFog = options.maxFog ?? DEFAULT_MAX_FOG;
  if (typeof fogDistance !== 'number' || !(fogDistance > 0)) {
    throw new RangeError('options.fogDistance must be a number > 0');
  }
  if (typeof maxFog !== 'number' || !(maxFog >= 0 && maxFog <= 1)) {
    throw new RangeError('options.maxFog must be a number in [0, 1]');
  }
  if (!(distance > 0)) {
    return 0;
  }
  return Math.min(distance / fogDistance, 1) * maxFog;
}

/**
 * Mélange deux couleurs hexadécimales '#rrggbb'. t dans [0, 1] (borné).
 * @param {string} colorA couleur pour t = 0
 * @param {string} colorB couleur pour t = 1
 * @param {number} t
 * @returns {string} '#rrggbb' minuscule
 * @throws {TypeError} couleur non '#rrggbb' ou t non numérique (NaN compris)
 */
export function mixColor(colorA, colorB, t) {
  if (typeof colorA !== 'string' || !HEX_COLOR.test(colorA)) {
    throw new TypeError('colorA must be a "#rrggbb" string');
  }
  if (typeof colorB !== 'string' || !HEX_COLOR.test(colorB)) {
    throw new TypeError('colorB must be a "#rrggbb" string');
  }
  if (typeof t !== 'number' || Number.isNaN(t)) {
    throw new TypeError('t must be a number');
  }
  const ratio = clamp(t, 0, 1);
  const a = Number.parseInt(colorA.slice(1), 16);
  const b = Number.parseInt(colorB.slice(1), 16);
  let result = '#';
  for (const shift of [16, 8, 0]) {
    const channelA = (a >> shift) & 0xff;
    const channelB = (b >> shift) & 0xff;
    const channel = Math.round(channelA + (channelB - channelA) * ratio);
    result += channel.toString(16).padStart(2, '0');
  }
  return result;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
