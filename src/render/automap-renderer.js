import { PALETTE } from './palette.js';
import { AUTOMAP_MODE, automapLayout } from './automap.js';
import { TILE } from '../maze/grid.js';

/** Opacité du fond de la mini-carte. */
const MINI_ALPHA = 0.65;
/** Opacité du contenu (tuiles, joueur) de la mini-carte. */
const MINI_CONTENT_ALPHA = 0.85;
/** Rayon d'angle du panneau de la mini-carte, px CSS. */
const PANEL_RADIUS = 10;

/**
 * Dessine la carte par-dessus l'image FPS déjà présente (ne redimensionne pas le canvas).
 * @param {HTMLCanvasElement} canvas
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {Uint8Array} explored
 * @param {{ x: number, y: number, angle: number }} player
 * @param {'mini' | 'full'} mode
 * @param {{ palette?: object }} [options]
 */
export function drawAutomap(canvas, grid, explored, player, mode, options = {}) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const palette = options?.palette ?? PALETTE;
  const ratio = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssWidth = canvas.width / ratio;
  const cssHeight = canvas.height / ratio;
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight) || cssWidth <= 0 || cssHeight <= 0) {
    return;
  }
  const layout = automapLayout(mode, grid, player, cssWidth, cssHeight);
  const { panelX, panelY, panelWidth, panelHeight, scale, originX, originY } = layout;
  const isMini = mode === AUTOMAP_MODE.MINI;

  context.save();
  try {
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.globalAlpha = isMini ? MINI_ALPHA : 1;
    context.fillStyle = palette.automapBackground;
    if (isMini) {
      panelPath(context, panelX, panelY, panelWidth, panelHeight);
      context.fill();
      context.globalAlpha = MINI_CONTENT_ALPHA;
      panelPath(context, panelX, panelY, panelWidth, panelHeight);
      context.clip();
    } else {
      context.fillRect(0, 0, cssWidth, cssHeight);
    }

    // Seules les tuiles dont le carré touche le panneau sont parcourues.
    const minTx = Math.max(0, Math.floor((panelX - originX) / scale));
    const maxTx = Math.min(grid.width - 1, Math.floor((panelX + panelWidth - originX) / scale));
    const minTy = Math.max(0, Math.floor((panelY - originY) / scale));
    const maxTy = Math.min(grid.height - 1, Math.floor((panelY + panelHeight - originY) / scale));
    // Léger recouvrement pour éviter les coutures entre tuiles.
    const size = scale + 0.5;
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const index = ty * grid.width + tx;
        if (explored[index] !== 1) continue;
        context.fillStyle =
          grid.tiles[index] === TILE.FLOOR ? palette.automapFloor : palette.automapWall;
        context.fillRect(originX + tx * scale, originY + ty * scale, size, size);
      }
    }

    drawPlayer(context, palette, originX + player.x * scale, originY + player.y * scale,
      player.angle, Math.max(4, scale * 0.8));
  } finally {
    context.restore();
  }
}

function panelPath(context, x, y, width, height) {
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(x, y, width, height, PANEL_RADIUS);
  } else {
    context.rect(x, y, width, height);
  }
}

function drawPlayer(context, palette, cx, cy, angle, size) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  context.fillStyle = palette.automapPlayer;
  context.beginPath();
  context.moveTo(cx + cos * size, cy + sin * size);
  context.lineTo(cx + Math.cos(angle + 2.5) * size * 0.8, cy + Math.sin(angle + 2.5) * size * 0.8);
  context.lineTo(cx + Math.cos(angle - 2.5) * size * 0.8, cy + Math.sin(angle - 2.5) * size * 0.8);
  context.closePath();
  context.fill();
}
