import { PALETTE } from './palette.js';
import { computeCellSize, wallSegments } from './maze-geometry.js';

const DEFAULT_PADDING = 16;

/**
 * Dessine fond, sols de cellules et murs (lineCap/lineJoin "round").
 * La zone disponible est celle du parent du canvas (repli : taille actuelle du canvas).
 * Gère devicePixelRatio pour un rendu net.
 * @param {HTMLCanvasElement} canvas
 * @param {import('../maze/maze.js').Maze} maze
 * @param {{ palette?: object, padding?: number, exit?: { cellX: number, cellY: number } }} [options]
 *        exit : cellule de sortie, marqueur dessiné après le sol et avant les murs
 */
export function drawMaze(canvas, maze, options = {}) {
  const palette = { ...PALETTE, ...(options.palette ?? {}) };
  const padding = Number.isFinite(options.padding) && options.padding >= 0
    ? options.padding
    : DEFAULT_PADDING;

  const container = canvas.parentElement;
  const availableWidth = container?.clientWidth || canvas.clientWidth || canvas.width;
  const availableHeight = container?.clientHeight || canvas.clientHeight || canvas.height;

  const cellSize = computeCellSize(maze, availableWidth, availableHeight, padding);
  const mazeWidth = cellSize * maze.width;
  const mazeHeight = cellSize * maze.height;
  const cssWidth = mazeWidth + 2 * padding;
  const cssHeight = mazeHeight + 2 * padding;

  const ratio = globalThis.devicePixelRatio > 0 ? globalThis.devicePixelRatio : 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  // Fond crème arrondi.
  ctx.fillStyle = palette.background;
  fillRoundedRect(ctx, 0, 0, cssWidth, cssHeight, Math.min(24, padding + cellSize / 2));

  // Sol rose poudré, avec un damier menthe très léger pour un effet carrelage doux.
  ctx.fillStyle = palette.floor;
  fillRoundedRect(ctx, padding, padding, mazeWidth, mazeHeight, cellSize / 3);
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = palette.accent;
  for (let y = 0; y < maze.height; y += 1) {
    for (let x = (y % 2); x < maze.width; x += 2) {
      fillRoundedRect(
        ctx,
        padding + x * cellSize + cellSize * 0.2,
        padding + y * cellSize + cellSize * 0.2,
        cellSize * 0.6,
        cellSize * 0.6,
        cellSize * 0.2,
      );
    }
  }
  ctx.restore();

  // Marqueur de sortie : carré arrondi (60 % du côté de la cellule), sous les murs.
  const exit = options.exit;
  if (
    exit && Number.isInteger(exit.cellX) && Number.isInteger(exit.cellY)
    && exit.cellX >= 0 && exit.cellX < maze.width
    && exit.cellY >= 0 && exit.cellY < maze.height
  ) {
    ctx.fillStyle = palette.topExit;
    fillRoundedRect(
      ctx,
      padding + exit.cellX * cellSize + cellSize * 0.2,
      padding + exit.cellY * cellSize + cellSize * 0.2,
      cellSize * 0.6,
      cellSize * 0.6,
      cellSize * 0.2,
    );
  }

  // Murs lavande, traits épais et arrondis.
  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = Math.max(1, cellSize * 0.22);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const { x1, y1, x2, y2 } of wallSegments(maze)) {
    ctx.moveTo(padding + x1 * cellSize, padding + y1 * cellSize);
    ctx.lineTo(padding + x2 * cellSize, padding + y2 * cellSize);
  }
  ctx.stroke();
}

function fillRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.fill();
}
