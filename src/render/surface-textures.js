// Pure procedural floor/ceiling textures and floor casting. No DOM, no drawing surface,
// no randomness. The only write is into the `target` array given to castSurfaces.

import { FOV, fogFactor } from './raycaster.js';
import { TEXTURE_SIZE } from './wall-textures.js';

/** Identifiants des surfaces. */
export const SURFACE_TEXTURE = Object.freeze({ FLOOR: 'floor', CEILING: 'ceiling' });

/** Taille d'un pixel du tampon sol/plafond, en px CSS. */
export const SURFACE_SCALE = 2;

/** Nombre maximal de pixels du tampon (640 x 360). */
export const MAX_SURFACE_PIXELS = 230400;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MIN_SIZE = 8;
const MAX_SIZE = 256;

/** Couleurs de palette requises par surface. */
const REQUIRED_COLORS = Object.freeze({
  [SURFACE_TEXTURE.FLOOR]: Object.freeze(['floorBase', 'floorAlt', 'floorGrout']),
  [SURFACE_TEXTURE.CEILING]: Object.freeze(['ceilingBase', 'ceilingLine', 'ceilingStar']),
});

/**
 * @typedef {Object} TextureData  objet gelé (le contenu de data reste un tableau typé)
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data  RGBA, length = width * height * 4, alpha = 255
 */

/**
 * Génère la texture d'une surface. Déterministe : mêmes entrées -> mêmes octets.
 * Chaque pixel prend exactement une des couleurs documentées (pas d'anticrénelage).
 * @param {string} kind valeur de SURFACE_TEXTURE
 * @param {object} palette clés floor* (sol) ou ceiling* (plafond), '#rrggbb'
 * @param {number} [size=TEXTURE_SIZE] entier, multiple de 8, dans [8, 256]
 * @returns {TextureData}
 * @throws {RangeError} kind inconnu ou size invalide
 * @throws {TypeError} palette absente ou couleur requise non '#rrggbb'
 */
export function generateSurfaceTexture(kind, palette, size = TEXTURE_SIZE) {
  if (typeof kind !== 'string' || !Object.hasOwn(REQUIRED_COLORS, kind)) {
    throw new RangeError('kind must be a SURFACE_TEXTURE value');
  }
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE || size % 8 !== 0) {
    throw new RangeError('size must be an integer multiple of 8 in [8, 256]');
  }
  if (palette === null || typeof palette !== 'object') {
    throw new TypeError('palette must be an object');
  }
  const colors = {};
  for (const key of REQUIRED_COLORS[kind]) {
    const value = palette[key];
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      throw new TypeError(`palette.${key} must be a "#rrggbb" string`);
    }
    colors[key] = parseHex(value);
  }

  const data = new Uint8ClampedArray(size * size * 4);
  const pickColor = PATTERNS[kind](size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = colors[pickColor(x, y)];
      const offset = (y * size + x) * 4;
      data[offset] = rgb[0];
      data[offset + 1] = rgb[1];
      data[offset + 2] = rgb[2];
      data[offset + 3] = 255;
    }
  }
  return Object.freeze({ width: size, height: size, data });
}

/** Fabriques de motifs : size -> (x, y) -> clé de palette. */
const PATTERNS = Object.freeze({
  // Damier 2 x 2, joints de 1 texel sur les lignes et colonnes 0 et size / 2.
  [SURFACE_TEXTURE.FLOOR]: (size) => {
    const half = size / 2;
    return (x, y) => {
      if (x % half === 0 || y % half === 0) {
        return 'floorGrout';
      }
      return (Math.floor(x / half) + Math.floor(y / half)) % 2 === 0 ? 'floorBase' : 'floorAlt';
    };
  },
  // Panneau avec bordure ligne 0 / colonne 0 et deux étoiles en « + » en quinconce.
  [SURFACE_TEXTURE.CEILING]: (size) => {
    const stars = [[size / 4, size / 4], [(size * 3) / 4, (size * 3) / 4]];
    return (x, y) => {
      if (x === 0 || y === 0) {
        return 'ceilingLine';
      }
      for (const [cx, cy] of stars) {
        const dx = Math.abs(x - cx);
        const dy = Math.abs(y - cy);
        if (dx + dy <= 1) {
          return 'ceilingStar';
        }
      }
      return 'ceilingBase';
    };
  },
});

/**
 * Taille du tampon pour une vue CSS donnée :
 *   width = ceil(cssWidth / SURFACE_SCALE), height = ceil(cssHeight / SURFACE_SCALE)
 *   au-delà de MAX_SURFACE_PIXELS, les deux sont réduits du même facteur
 *   k = sqrt(MAX_SURFACE_PIXELS / (width * height)), puis floor, minimum 1.
 * Ne lève jamais : une entrée non finie ou < 1 est traitée comme 1.
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @returns {{ width: number, height: number }} entiers >= 1, width * height <= MAX_SURFACE_PIXELS
 */
export function surfaceBufferSize(cssWidth, cssHeight) {
  const cssW = Number.isFinite(cssWidth) && cssWidth >= 1 ? cssWidth : 1;
  const cssH = Number.isFinite(cssHeight) && cssHeight >= 1 ? cssHeight : 1;
  let width = Math.max(Math.ceil(cssW / SURFACE_SCALE), 1);
  let height = Math.max(Math.ceil(cssH / SURFACE_SCALE), 1);
  if (width * height > MAX_SURFACE_PIXELS) {
    const k = Math.sqrt(MAX_SURFACE_PIXELS / (width * height));
    width = Math.max(Math.floor(width * k), 1);
    height = Math.max(Math.floor(height * k), 1);
    // Ratio extrême : le minimum 1 d'une dimension peut faire dépasser la borne.
    if (width * height > MAX_SURFACE_PIXELS) {
      if (width === 1) {
        height = Math.min(height, MAX_SURFACE_PIXELS);
      } else {
        width = Math.min(width, MAX_SURFACE_PIXELS);
      }
    }
  }
  return { width, height };
}

/**
 * Distance perpendiculaire (tuiles) du sol ou du plafond vu par la ligne `row` d'un
 * tampon de hauteur `height`. Pour un centre de ligne p = row + 0.5 - height / 2 :
 *   distance = height / (2 * max(|p|, 0.5))
 * Ne lève jamais : valeur finie > 0 pour row entier dans [0, height).
 * @param {number} row
 * @param {number} height
 * @returns {number}
 */
export function surfaceRowDistance(row, height) {
  const p = row + 0.5 - height / 2;
  return height / (2 * Math.max(Math.abs(p), 0.5));
}

function isTextureData(texture) {
  return texture !== null && typeof texture === 'object'
    && Number.isInteger(texture.width) && texture.width >= 1
    && texture.height === texture.width
    && texture.data instanceof Uint8ClampedArray
    && texture.data.length === texture.width * texture.height * 4;
}

/**
 * Floor casting : remplit `target` (RGBA, width * height * 4) avec le plafond pour les
 * lignes row < height / 2 et avec le sol pour les autres. Alpha 255 partout.
 * Pour chaque ligne : d = surfaceRowDistance(row, height), f = fogFactor(d).
 * Pour chaque pixel : cameraX = 2 * (x + 0.5) / width - 1,
 *   monde = (player.x, player.y) + d * (dir + plane * cameraX)
 *   texel = floor(frac(monde) * size) ; couleur = texel * (1 - f) + fog * f, arrondie.
 * @param {Uint8ClampedArray} target modifié en place, seule écriture de la fonction
 * @param {number} width entier >= 1
 * @param {number} height entier >= 1
 * @param {{ x: number, y: number, angle: number }} player nombres finis
 * @param {{ floor: TextureData, ceiling: TextureData }} textures carrées de même taille
 * @param {string} fogColor '#rrggbb'
 * @param {number} [fov=FOV] radians, dans ]0, PI[
 * @throws {TypeError} target de mauvaise longueur, player, textures ou fogColor mal formés
 * @throws {RangeError} width, height ou fov invalide
 */
export function castSurfaces(target, width, height, player, textures, fogColor, fov = FOV) {
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError('width must be an integer >= 1');
  }
  if (!Number.isInteger(height) || height < 1) {
    throw new RangeError('height must be an integer >= 1');
  }
  if (typeof fov !== 'number' || !(fov > 0 && fov < Math.PI)) {
    throw new RangeError('fov must be a number in ]0, PI[');
  }
  if (!(target instanceof Uint8ClampedArray) || target.length !== width * height * 4) {
    throw new TypeError('target must be a Uint8ClampedArray of width * height * 4');
  }
  if (player === null || typeof player !== 'object'
    || !Number.isFinite(player.x) || !Number.isFinite(player.y) || !Number.isFinite(player.angle)) {
    throw new TypeError('player must be { x, y, angle } with finite numbers');
  }
  if (textures === null || typeof textures !== 'object'
    || !isTextureData(textures.floor) || !isTextureData(textures.ceiling)
    || textures.floor.width !== textures.ceiling.width) {
    throw new TypeError('textures must be { floor, ceiling } square TextureData of equal size');
  }
  if (typeof fogColor !== 'string' || !HEX_COLOR.test(fogColor)) {
    throw new TypeError('fogColor must be a "#rrggbb" string');
  }

  const size = textures.floor.width;
  const [fogR, fogG, fogB] = parseHex(fogColor);
  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  const planeScale = Math.tan(fov / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;
  const cameraStart = 1 / width - 1;
  const cameraStep = 2 / width;
  // Fractional origin keeps results identical under integer translations of the player.
  const originX = player.x - Math.floor(player.x);
  const originY = player.y - Math.floor(player.y);
  const maxTexel = size - 1;

  for (let row = 0; row < height; row++) {
    const source = row < height / 2 ? textures.ceiling.data : textures.floor.data;
    const d = surfaceRowDistance(row, height);
    const fog = fogFactor(d);
    const keep = 1 - fog;
    const fogRKept = fogR * fog;
    const fogGKept = fogG * fog;
    const fogBKept = fogB * fog;
    let worldX = originX + d * (dirX + planeX * cameraStart);
    let worldY = originY + d * (dirY + planeY * cameraStart);
    const stepX = d * planeX * cameraStep;
    const stepY = d * planeY * cameraStep;
    let offset = row * width * 4;
    for (let x = 0; x < width; x++) {
      let texX = Math.floor((worldX - Math.floor(worldX)) * size);
      let texY = Math.floor((worldY - Math.floor(worldY)) * size);
      texX = texX > maxTexel ? maxTexel : texX < 0 ? 0 : texX;
      texY = texY > maxTexel ? maxTexel : texY < 0 ? 0 : texY;
      const t = (texY * size + texX) * 4;
      target[offset] = Math.round(source[t] * keep + fogRKept);
      target[offset + 1] = Math.round(source[t + 1] * keep + fogGKept);
      target[offset + 2] = Math.round(source[t + 2] * keep + fogBKept);
      target[offset + 3] = 255;
      offset += 4;
      worldX += stepX;
      worldY += stepY;
    }
  }
}

function parseHex(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
