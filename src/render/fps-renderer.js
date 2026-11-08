import { PALETTE } from './palette.js';
import { castRays, fogFactor, mixColor, projectColumn } from './raycaster.js';

/** Largeur d'une colonne de rendu, en px CSS (un rayon par colonne). */
const COLUMN_WIDTH = 2;
/** Seuils de wallX sous / au-dessus desquels un liseré de joint de tuile est dessiné. */
const EDGE_LOW = 0.04;
const EDGE_HIGH = 0.96;
/** Assombrissement du liseré : mélange léger vers le noir. */
const EDGE_SHADE_COLOR = '#000000';
const EDGE_SHADE = 0.08;

/**
 * Dessine la vue FPS. Taille CSS = zone du parent (repli : taille actuelle du canvas),
 * gestion de devicePixelRatio. Ne réaffecte canvas.width/height que si la taille change
 * (réaffecter chaque image vide le contexte et coûte cher).
 * Un rayon par tranche de COLUMN_WIDTH = 2 px CSS (perf, aspect « pixel doux »).
 * Ordre : dégradé ciel (sky -> skyHorizon) moitié haute, sol (ground) moitié basse,
 * puis une colonne par rayon : wallLight/wallDark selon side, mélangé vers fog via
 * fogFactor ; liseré plus sombre si wallX < 0.04 ou > 0.96 (joints doux de tuiles).
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {{ x: number, y: number, angle: number }} player
 * @param {{ palette?: object }} [options]
 * @throws {TypeError} grid ou player mal formé (voir castRays)
 */
export function drawFpsView(canvas, grid, player, options = {}) {
  const palette = { ...PALETTE, ...(options.palette ?? {}) };

  const container = canvas.parentElement;
  const cssWidth = Math.max(
    1,
    Math.floor(container?.clientWidth || canvas.clientWidth || canvas.width || 1),
  );
  const cssHeight = Math.max(
    1,
    Math.floor(container?.clientHeight || canvas.clientHeight || canvas.height || 1),
  );

  const ratio = globalThis.devicePixelRatio > 0 ? globalThis.devicePixelRatio : 1;
  const pixelWidth = Math.round(cssWidth * ratio);
  const pixelHeight = Math.round(cssHeight * ratio);
  const styleWidth = `${cssWidth}px`;
  const styleHeight = `${cssHeight}px`;
  if (canvas.style.width !== styleWidth) {
    canvas.style.width = styleWidth;
  }
  if (canvas.style.height !== styleHeight) {
    canvas.style.height = styleHeight;
  }
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  // Sky gradient (upper half) and ground (lower half) cover the whole view.
  const horizon = cssHeight / 2;
  const skyGradient = ctx.createLinearGradient(0, 0, 0, horizon);
  skyGradient.addColorStop(0, palette.sky);
  skyGradient.addColorStop(1, palette.skyHorizon);
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, cssWidth, horizon);
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, horizon, cssWidth, cssHeight - horizon);

  // Walls: one ray per column.
  const columnCount = Math.max(1, Math.ceil(cssWidth / COLUMN_WIDTH));
  const hits = castRays(grid, player, columnCount);
  for (let column = 0; column < columnCount; column++) {
    const hit = hits[column];
    const { top, bottom } = projectColumn(hit.distance, cssHeight);
    if (bottom <= top) {
      continue;
    }
    const base = hit.side === 'x' ? palette.wallLight : palette.wallDark;
    let color = mixColor(base, palette.fog, fogFactor(hit.distance));
    if (hit.wallX < EDGE_LOW || hit.wallX > EDGE_HIGH) {
      color = mixColor(color, EDGE_SHADE_COLOR, EDGE_SHADE);
    }
    const x = column * COLUMN_WIDTH;
    ctx.fillStyle = color;
    ctx.fillRect(x, top, Math.min(COLUMN_WIDTH, cssWidth - x), bottom - top);
  }
}
