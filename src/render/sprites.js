// Pure billboard sprite projection, same camera as castRays. No DOM, no drawing surface.

import { FOV, MIN_DISTANCE } from './raycaster.js';

/** Taille monde par défaut d'un sprite posé au sol, en tuiles. */
export const DEFAULT_SPRITE_WORLD_SIZE = 0.35;

/**
 * @typedef {Object} ProjectedSprite
 * @property {string} kind
 * @property {number} depth    distance perpendiculaire au plan caméra (comparable à
 *                             RayHit.distance)
 * @property {number} screenX  centre horizontal, px
 * @property {number} size     côté du sprite à l'écran, px
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom   coordonnées non bornées à l'écran (le renderer rogne)
 */

/**
 * Projette des sprites posés au sol avec la même caméra que castRays : plan de
 * demi-largeur tan(fov/2), vecteur droit (-sin a, cos a).
 * depth = projection sur la direction (perpendiculaire, comparable à RayHit.distance).
 * Sprites avec depth <= MIN_DISTANCE, ou hors écran, exclus.
 * Géométrie : cameraX = lateral / (depth * tan(fov/2)),
 * screenX = (cameraX + 1) / 2 * viewWidth, size = viewHeight * worldSize / depth,
 * bottom = viewHeight/2 + viewHeight / (2 * depth) (le sprite repose au sol),
 * top = bottom - size, left/right = screenX -/+ size/2.
 * @param {ReadonlyArray<{ x: number, y: number, kind: string }>} sprites
 * @param {{ x: number, y: number, angle: number }} player
 * @param {number} viewWidth  px CSS > 0
 * @param {number} viewHeight px CSS > 0
 * @param {{ fov?: number, worldSize?: number }} [options] worldSize défaut 0.35 tuile
 * @returns {ProjectedSprite[]} trié du plus loin au plus proche (ordre du peintre)
 * @throws {TypeError} sprites, sprite ou player mal formé
 * @throws {RangeError} viewWidth, viewHeight, fov ou worldSize invalide
 */
export function projectSprites(sprites, player, viewWidth, viewHeight, options = {}) {
  if (!Array.isArray(sprites)) {
    throw new TypeError('sprites must be an array');
  }
  if (player === null || typeof player !== 'object'
    || !Number.isFinite(player.x) || !Number.isFinite(player.y)
    || !Number.isFinite(player.angle)) {
    throw new TypeError('player must be { x, y, angle } with finite numbers');
  }
  if (typeof viewWidth !== 'number' || !Number.isFinite(viewWidth) || !(viewWidth > 0)) {
    throw new RangeError('viewWidth must be a finite number > 0');
  }
  if (typeof viewHeight !== 'number' || !Number.isFinite(viewHeight) || !(viewHeight > 0)) {
    throw new RangeError('viewHeight must be a finite number > 0');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const fov = options.fov ?? FOV;
  const worldSize = options.worldSize ?? DEFAULT_SPRITE_WORLD_SIZE;
  if (typeof fov !== 'number' || !(fov > 0 && fov < Math.PI)) {
    throw new RangeError('options.fov must be a number in ]0, PI[');
  }
  if (typeof worldSize !== 'number' || !Number.isFinite(worldSize) || !(worldSize > 0)) {
    throw new RangeError('options.worldSize must be a finite number > 0');
  }

  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  // Right vector in a y-down frame is (-sin a, cos a), as in castRays.
  const rightX = -dirY;
  const rightY = dirX;
  const planeScale = Math.tan(fov / 2);
  const horizon = viewHeight / 2;

  const projected = [];
  for (const sprite of sprites) {
    if (sprite === null || typeof sprite !== 'object'
      || !Number.isFinite(sprite.x) || !Number.isFinite(sprite.y)
      || typeof sprite.kind !== 'string') {
      throw new TypeError('each sprite must be { x, y, kind } with finite x/y and string kind');
    }
    const dx = sprite.x - player.x;
    const dy = sprite.y - player.y;
    const depth = dx * dirX + dy * dirY;
    if (!(depth > MIN_DISTANCE)) {
      continue;
    }
    const lateral = dx * rightX + dy * rightY;
    const cameraX = lateral / (depth * planeScale);
    const screenX = ((cameraX + 1) / 2) * viewWidth;
    const size = (viewHeight * worldSize) / depth;
    const left = screenX - size / 2;
    const right = screenX + size / 2;
    if (right <= 0 || left >= viewWidth) {
      continue;
    }
    const bottom = horizon + viewHeight / (2 * depth);
    const top = bottom - size;
    projected.push({ kind: sprite.kind, depth, screenX, size, left, right, top, bottom });
  }
  // Painter's order: farthest first (stable sort keeps input order on ties).
  projected.sort((a, b) => b.depth - a.depth);
  return projected;
}

/**
 * true si le sprite est devant le mur de la colonne : depth < hit.distance.
 * hit absent ou distance non numérique -> false.
 * @param {number} depth
 * @param {{ distance: number } | undefined} hit
 * @returns {boolean}
 */
export function isSpriteColumnVisible(depth, hit) {
  if (hit === null || typeof hit !== 'object' || typeof hit.distance !== 'number') {
    return false;
  }
  return depth < hit.distance;
}
