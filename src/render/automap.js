// Logique pure de l'automap : masque d'exploration, révélation par champ de vision,
// mise en page. Aucun DOM ni canvas ici.

import { TILE } from '../maze/grid.js';
import { FOV } from './raycaster.js';

/** Modes d'affichage de la carte. */
export const AUTOMAP_MODE = Object.freeze({ MINI: 'mini', FULL: 'full' });

/** Réglages de la révélation. */
export const REVEAL = Object.freeze({
  rayCount: 64, // rayons répartis uniformément sur FOV
  maxDistance: 12, // portée en tuiles
  step: 0.05, // pas de marche le long d'un rayon, en tuiles
});

/** Plafonds de sécurité appliqués aux options de révélation. */
const MAX_RAY_COUNT = 512;
const MAX_DISTANCE = 64;
const MIN_STEP = 0.01;

/** Réglages de mise en page. */
export const AUTOMAP_LAYOUT = Object.freeze({
  miniRatio: 0.3, // côté de la mini-carte = 30 % du plus petit côté du canvas
  miniMin: 96, // bornes du côté, px CSS
  miniMax: 240,
  miniMargin: 16, // marge gauche et basse, px CSS
  miniViewTiles: 15, // nombre de tuiles visibles sur la largeur de la mini-carte
  fullPadding: 24, // marge autour du labyrinthe en plein écran, px CSS
});

function assertGrid(grid) {
  if (
    grid === null ||
    typeof grid !== 'object' ||
    !Number.isInteger(grid.width) ||
    !Number.isInteger(grid.height) ||
    grid.width < 1 ||
    grid.height < 1 ||
    grid.tiles === null ||
    typeof grid.tiles !== 'object' ||
    grid.tiles.length !== grid.width * grid.height
  ) {
    throw new TypeError('grid must have integer width/height >= 1 and matching tiles');
  }
}

/**
 * Masque vierge (tout à 0) pour une grille.
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @returns {Uint8Array}
 * @throws {TypeError} grid mal formé
 */
export function createExploredMask(grid) {
  assertGrid(grid);
  return new Uint8Array(grid.width * grid.height);
}

/**
 * Marque sur place les tuiles vues depuis le joueur (tuile du joueur + 8 voisines, puis
 * rayons dans le FOV arrêtés au premier mur, mur inclus). Idempotent.
 * @param {Uint8Array} explored
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {{ x: number, y: number, angle: number }} player
 * @param {{ rayCount?: number, maxDistance?: number, step?: number, fov?: number }} [options]
 * @returns {number} nombre de tuiles nouvellement marquées
 * @throws {TypeError} arguments mal formés ou options hors bornes
 */
export function revealVisibleTiles(explored, grid, player, options = {}) {
  assertGrid(grid);
  if (!(explored instanceof Uint8Array) || explored.length !== grid.width * grid.height) {
    throw new TypeError('explored must be a Uint8Array of width * height');
  }
  if (
    player === null ||
    typeof player !== 'object' ||
    !Number.isFinite(player.x) ||
    !Number.isFinite(player.y) ||
    !Number.isFinite(player.angle)
  ) {
    throw new TypeError('player must have finite x, y and angle');
  }
  const opts = options === null || typeof options !== 'object' ? {} : options;
  const rayCount = opts.rayCount ?? REVEAL.rayCount;
  const maxDistance = opts.maxDistance ?? REVEAL.maxDistance;
  const step = opts.step ?? REVEAL.step;
  const fov = opts.fov ?? FOV;
  if (!Number.isInteger(rayCount) || rayCount < 1) {
    throw new TypeError('rayCount must be an integer >= 1');
  }
  if (!Number.isFinite(maxDistance) || maxDistance <= 0) {
    throw new TypeError('maxDistance must be a finite number > 0');
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw new TypeError('step must be a finite number > 0');
  }
  const rays = Math.min(rayCount, MAX_RAY_COUNT);
  const reach = Math.min(maxDistance, MAX_DISTANCE);
  const stride = Math.max(step, MIN_STEP);
  if (!Number.isFinite(fov) || fov <= 0 || fov > 2 * Math.PI) {
    throw new TypeError('fov must be in ]0, 2*PI]');
  }

  const { width, height, tiles } = grid;
  let added = 0;
  const mark = (tx, ty) => {
    const index = ty * width + tx;
    if (explored[index] === 0) {
      explored[index] = 1;
      added += 1;
    }
  };

  const playerTx = Math.floor(player.x);
  const playerTy = Math.floor(player.y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = playerTx + dx;
      const ty = playerTy + dy;
      if (tx >= 0 && ty >= 0 && tx < width && ty < height) mark(tx, ty);
    }
  }

  for (let i = 0; i < rays; i++) {
    const t = rays === 1 ? 0.5 : i / (rays - 1);
    const rayAngle = player.angle - fov / 2 + fov * t;
    const cos = Math.cos(rayAngle);
    const sin = Math.sin(rayAngle);
    for (let distance = 0; distance <= reach; distance += stride) {
      const tx = Math.floor(player.x + cos * distance);
      const ty = Math.floor(player.y + sin * distance);
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) break;
      mark(tx, ty);
      if (tiles[ty * width + tx] !== TILE.FLOOR) break;
    }
  }
  return added;
}

/**
 * Mise en page de la carte en px CSS.
 * @param {'mini' | 'full'} mode
 * @param {{ width: number, height: number }} grid
 * @param {{ x: number, y: number }} player
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @returns {{ panelX: number, panelY: number, panelWidth: number, panelHeight: number,
 *   scale: number, originX: number, originY: number }} objet gelé
 * @throws {TypeError} mode inconnu, dimensions non finies ou <= 0
 */
export function automapLayout(mode, grid, player, cssWidth, cssHeight) {
  if (mode !== AUTOMAP_MODE.MINI && mode !== AUTOMAP_MODE.FULL) {
    throw new TypeError('unknown automap mode');
  }
  if (
    !Number.isFinite(cssWidth) ||
    !Number.isFinite(cssHeight) ||
    cssWidth <= 0 ||
    cssHeight <= 0
  ) {
    throw new TypeError('cssWidth and cssHeight must be finite numbers > 0');
  }

  const L = AUTOMAP_LAYOUT;
  if (mode === AUTOMAP_MODE.MINI) {
    const smallest = Math.min(cssWidth, cssHeight);
    let side = Math.round(smallest * L.miniRatio);
    side = Math.min(Math.max(side, L.miniMin), L.miniMax);
    side = Math.max(1, Math.min(side, smallest - 2 * L.miniMargin));
    const panelX = L.miniMargin;
    const panelY = cssHeight - L.miniMargin - side;
    const scale = side / L.miniViewTiles;
    const px = Number.isFinite(player?.x) ? player.x : 0;
    const py = Number.isFinite(player?.y) ? player.y : 0;
    return Object.freeze({
      panelX,
      panelY,
      panelWidth: side,
      panelHeight: side,
      scale,
      originX: panelX + side / 2 - px * scale,
      originY: panelY + side / 2 - py * scale,
    });
  }

  const p = L.fullPadding;
  const scale = Math.max(
    Number.EPSILON,
    Math.min((cssWidth - 2 * p) / grid.width, (cssHeight - 2 * p) / grid.height),
  );
  return Object.freeze({
    panelX: 0,
    panelY: 0,
    panelWidth: cssWidth,
    panelHeight: cssHeight,
    scale,
    originX: (cssWidth - grid.width * scale) / 2,
    originY: (cssHeight - grid.height * scale) / 2,
  });
}
