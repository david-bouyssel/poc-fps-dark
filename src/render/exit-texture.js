// Pure procedural exit door texture (RGBA array) and exit face detection. No DOM, no randomness.

import { TEXTURE_SIZE } from './wall-textures.js';

/** Atténuation du brouillard sur les faces de sortie (lueur visible de loin). */
export const EXIT_FOG_SCALE = 0.35;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MIN_SIZE = 8;
const MAX_SIZE = 256;
/** Épaisseur du cadre (bords gauche, droit et haut), en texels. */
const FRAME_THICKNESS = 3;

/**
 * Texture de porte lumineuse : cadre exitFrame de 3 texels sur les bords gauche, droit et
 * haut ; intérieur en bandes verticales symétriques exitGlow -> exitCore au centre.
 * Déterministe, une couleur exacte de palette par pixel, alpha 255.
 * @param {object} palette clés exitFrame, exitGlow, exitCore en '#rrggbb'
 * @param {number} [size=TEXTURE_SIZE] entier, multiple de 8, dans [8, 256]
 * @returns {{ width: number, height: number, data: Uint8ClampedArray }} objet gelé
 * @throws {RangeError} size invalide
 * @throws {TypeError} palette absente ou couleur requise non '#rrggbb'
 */
export function generateExitTexture(palette, size = TEXTURE_SIZE) {
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE || size % 8 !== 0) {
    throw new RangeError('size must be an integer multiple of 8 in [8, 256]');
  }
  if (palette === null || typeof palette !== 'object') {
    throw new TypeError('palette must be an object');
  }
  const colors = {};
  for (const key of ['exitFrame', 'exitGlow', 'exitCore']) {
    const value = palette[key];
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      throw new TypeError(`palette.${key} must be a "#rrggbb" string`);
    }
    colors[key] = parseHex(value);
  }

  const data = new Uint8ClampedArray(size * size * 4);
  const coreHalfWidth = size / 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let key;
      if (x < FRAME_THICKNESS || x >= size - FRAME_THICKNESS || y < FRAME_THICKNESS) {
        key = 'exitFrame';
      } else {
        key = Math.abs(x + 0.5 - size / 2) <= coreHalfWidth ? 'exitCore' : 'exitGlow';
      }
      const rgb = colors[key];
      const offset = (y * size + x) * 4;
      data[offset] = rgb[0];
      data[offset + 1] = rgb[1];
      data[offset + 2] = rgb[2];
      data[offset + 3] = 255;
    }
  }
  return Object.freeze({ width: size, height: size, data });
}

/**
 * true si le rayon a touché une face de mur tournée vers la tuile de sortie.
 * side 'x' : hit.tileY === exit.ty et (hit.tileX === exit.tx + 1 et player.x <= hit.tileX,
 *   ou hit.tileX === exit.tx - 1 et player.x >= hit.tileX + 1) ;
 * side 'y' : symétrique en y. La condition sur le joueur écarte la face opposée d'un mur
 * fin partagé avec une cellule voisine. exit absent / mal formé ou hit mal formé -> false
 * (jamais d'exception : appelée en boucle chaude).
 * @param {{ side: 'x'|'y', tileX: number, tileY: number }} hit
 * @param {{ x: number, y: number }} player
 * @param {{ tx: number, ty: number } | null | undefined} exit
 * @returns {boolean}
 */
export function isExitFace(hit, player, exit) {
  if (!isObject(hit) || !isObject(player) || !isObject(exit)) {
    return false;
  }
  const { side, tileX, tileY } = hit;
  const { tx, ty } = exit;
  if (!Number.isFinite(tileX) || !Number.isFinite(tileY) || !Number.isFinite(tx)
    || !Number.isFinite(ty) || !Number.isFinite(player.x) || !Number.isFinite(player.y)) {
    return false;
  }
  if (side === 'x') {
    if (tileY !== ty) {
      return false;
    }
    return (tileX === tx + 1 && player.x <= tileX)
      || (tileX === tx - 1 && player.x >= tileX + 1);
  }
  if (side === 'y') {
    if (tileX !== tx) {
      return false;
    }
    return (tileY === ty + 1 && player.y <= tileY)
      || (tileY === ty - 1 && player.y >= tileY + 1);
  }
  return false;
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function parseHex(value) {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
}
