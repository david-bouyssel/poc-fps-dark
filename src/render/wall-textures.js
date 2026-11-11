// Pure procedural wall textures (RGBA arrays). No DOM, no drawing surface, no randomness.

import { MIN_DISTANCE, mixColor, projectColumn } from './raycaster.js';

/** Côté d'une texture carrée, en texels. */
export const TEXTURE_SIZE = 32;

/** Identifiants des motifs. */
export const WALL_TEXTURE = Object.freeze({
  BRICKS: 'bricks',
  PLANKS: 'planks',
  DOTS: 'dots',
  HEARTS: 'hearts',
});

/** Ordre de référence (index utilisé par textureIndexForTile). */
export const WALL_TEXTURE_KINDS = Object.freeze([
  WALL_TEXTURE.BRICKS,
  WALL_TEXTURE.PLANKS,
  WALL_TEXTURE.DOTS,
  WALL_TEXTURE.HEARTS,
]);

/** Poids du tirage, même ordre : briques majoritaires (50 %), puis 20/15/15 %. */
export const WALL_TEXTURE_WEIGHTS = Object.freeze([10, 4, 3, 3]);

/** Assombrissement des faces 'y' (vers le noir), proche de l'écart wallLight/wallDark. */
export const SIDE_SHADE = 0.25;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MIN_SIZE = 8;
const MAX_SIZE = 256;
const SHADE_TARGET = '#000000';
const TOTAL_WEIGHT = WALL_TEXTURE_WEIGHTS.reduce((sum, weight) => sum + weight, 0);

/** Couleurs de palette requises par motif. */
const REQUIRED_COLORS = Object.freeze({
  [WALL_TEXTURE.BRICKS]: Object.freeze(['textureBase', 'textureBrickAlt', 'textureMortar']),
  [WALL_TEXTURE.PLANKS]: Object.freeze(['textureBase', 'texturePlankAlt', 'textureGroove']),
  [WALL_TEXTURE.DOTS]: Object.freeze(['textureBase', 'textureDot', 'textureGroove']),
  [WALL_TEXTURE.HEARTS]: Object.freeze(['textureBase', 'textureHeart', 'textureGroove']),
});

/**
 * @typedef {Object} TextureData  objet gelé (le contenu de data reste un tableau typé)
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data  RGBA, length = width * height * 4, alpha = 255
 */

/**
 * Génère un motif de mur sombre. Déterministe : mêmes entrées -> mêmes octets.
 * Chaque pixel prend exactement une des couleurs du motif (pas d'anticrénelage),
 * pour un rendu « pixel doux » et des tests simples.
 * Tous les motifs sauf les briques ont un joint de bord textureGroove en colonne 0
 * (les briques sombres, HEARTS, l'ont aussi).
 * @param {string} kind valeur de WALL_TEXTURE
 * @param {object} palette doit contenir les clés texture* utilisées par le motif
 * @param {number} [size=TEXTURE_SIZE] entier, multiple de 8, dans [8, 256]
 * @returns {TextureData}
 * @throws {RangeError} kind inconnu ou size invalide
 * @throws {TypeError} palette absente ou couleur requise non '#rrggbb'
 */
export function generateWallTexture(kind, palette, size = TEXTURE_SIZE) {
  if (typeof kind !== 'string' || !Object.hasOwn(REQUIRED_COLORS, kind)) {
    throw new RangeError('kind must be a WALL_TEXTURE value');
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
  [WALL_TEXTURE.BRICKS]: (size) => {
    const rowHeight = size / 4;
    const brickWidth = size / 2;
    return (x, y) => {
      const row = Math.floor(y / rowHeight);
      if (y % rowHeight === rowHeight - 1) {
        return 'textureMortar';
      }
      const shifted = (x + (row % 2 === 1 ? brickWidth / 2 : 0)) % size;
      if (shifted % brickWidth === 0) {
        return 'textureMortar';
      }
      const brick = Math.floor(shifted / brickWidth);
      return (row + brick) % 2 === 0 ? 'textureBase' : 'textureBrickAlt';
    };
  },
  [WALL_TEXTURE.PLANKS]: (size) => {
    const plankWidth = size / 4;
    return (x) => {
      if (x % plankWidth === 0) {
        return 'textureGroove';
      }
      return Math.floor(x / plankWidth) % 2 === 0 ? 'textureBase' : 'texturePlankAlt';
    };
  },
  // Pierre : assises de size / 4, blocs de size / 2 décalés d'une assise à l'autre,
  // joints textureGroove ; un bloc sur trois est teinté de rouille (textureDot).
  [WALL_TEXTURE.DOTS]: (size) => {
    const rowHeight = size / 4;
    const blockWidth = size / 2;
    return (x, y) => {
      if (x === 0 || y % rowHeight === 0) {
        return 'textureGroove';
      }
      const row = Math.floor(y / rowHeight);
      const shifted = (x + (row % 2 === 1 ? blockWidth / 2 : 0)) % size;
      if (shifted % blockWidth === 0) {
        return 'textureGroove';
      }
      const block = Math.floor(shifted / blockWidth);
      return (row + block) % 3 === 0 ? 'textureDot' : 'textureBase';
    };
  },
  // Briques sombres : mêmes proportions que BRICKS, alternance textureBase / textureHeart,
  // joints textureGroove, plus un joint de bord en colonne 0.
  [WALL_TEXTURE.HEARTS]: (size) => {
    const rowHeight = size / 4;
    const brickWidth = size / 2;
    return (x, y) => {
      if (x === 0 || y % rowHeight === rowHeight - 1) {
        return 'textureGroove';
      }
      const row = Math.floor(y / rowHeight);
      const shifted = (x + (row % 2 === 1 ? brickWidth / 2 : 0)) % size;
      if (shifted % brickWidth === 0) {
        return 'textureGroove';
      }
      const brick = Math.floor(shifted / brickWidth);
      return (row + brick) % 2 === 0 ? 'textureBase' : 'textureHeart';
    };
  },
});

function parseHex(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex(r, g, b) {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Nouvelle texture mélangée vers le noir de `amount` (mixColor par pixel), alpha
 * conservé. Ne modifie pas l'entrée.
 * @param {TextureData} texture
 * @param {number} amount dans [0, 1]
 * @returns {TextureData}
 * @throws {TypeError} texture mal formée
 * @throws {RangeError} amount hors [0, 1] ou NaN
 */
export function shadeTexture(texture, amount) {
  if (texture === null || typeof texture !== 'object'
    || !Number.isInteger(texture.width) || texture.width < 1
    || !Number.isInteger(texture.height) || texture.height < 1
    || !(texture.data instanceof Uint8ClampedArray)
    || texture.data.length !== texture.width * texture.height * 4) {
    throw new TypeError('texture must be { width, height, data: Uint8ClampedArray }');
  }
  if (typeof amount !== 'number' || !(amount >= 0 && amount <= 1)) {
    throw new RangeError('amount must be a number in [0, 1]');
  }
  const source = texture.data;
  const data = new Uint8ClampedArray(source.length);
  for (let offset = 0; offset < source.length; offset += 4) {
    const shaded = parseHex(
      mixColor(toHex(source[offset], source[offset + 1], source[offset + 2]), SHADE_TARGET, amount),
    );
    data[offset] = shaded[0];
    data[offset + 1] = shaded[1];
    data[offset + 2] = shaded[2];
    data[offset + 3] = source[offset + 3];
  }
  return Object.freeze({ width: texture.width, height: texture.height, data });
}

/**
 * Index (dans WALL_TEXTURE_KINDS) du motif d'une tuile mur : hachage entier
 * 32 bits de (tileX, tileY) (Math.imul, décalages, sans aléa), puis tirage
 * pondéré par WALL_TEXTURE_WEIGHTS. Ne lève jamais (boucle chaude) :
 * coordonnées non entières ou non finies -> 0 (briques).
 * @param {number} tileX
 * @param {number} tileY
 * @returns {number} entier dans [0, WALL_TEXTURE_KINDS.length)
 */
export function textureIndexForTile(tileX, tileY) {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) {
    return 0;
  }
  // Different multipliers per axis: the hash is not symmetric in (x, y).
  let hash = Math.imul(tileX | 0, 0x27d4eb2d) ^ Math.imul(tileY | 0, 0x165667b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  let pick = (hash >>> 0) % TOTAL_WEIGHT;
  for (let index = 0; index < WALL_TEXTURE_WEIGHTS.length; index++) {
    pick -= WALL_TEXTURE_WEIGHTS[index];
    if (pick < 0) {
      return index;
    }
  }
  return 0;
}

/**
 * Colonne de texel à échantillonner pour un impact.
 * texX = floor(wallX * size), borné à [0, size - 1], puis retourné (size - 1 - texX)
 * quand la face est vue « à l'envers », pour que les motifs asymétriques se lisent
 * à l'endroit (texX croît de gauche à droite à l'écran) sur toutes les faces.
 * Repère y vers le bas, vecteur droite caméra = (-sin a, cos a) (cf. castRays) :
 *   side 'x' et player.x > hit.tileX (rayon vers -x, face est) -> retourné ;
 *   side 'y' et player.y < hit.tileY (rayon vers +y, face nord) -> retourné.
 * (Face ouest vue vers +x : droite écran = +y, wallX croît vers la droite -> non
 * retourné. Face sud vue vers -y : droite écran = +x -> non retourné.)
 * wallX non fini -> 0. Ne lève jamais.
 * @param {{ side: 'x'|'y', tileX: number, tileY: number, wallX: number }} hit
 * @param {{ x: number, y: number }} player
 * @param {number} [size=TEXTURE_SIZE]
 * @returns {number} entier dans [0, size - 1]
 */
export function textureColumn(hit, player, size = TEXTURE_SIZE) {
  const texSize = Number.isInteger(size) && size >= 1 ? size : TEXTURE_SIZE;
  if (hit === null || typeof hit !== 'object') {
    return 0;
  }
  const wallX = Number.isFinite(hit.wallX) ? hit.wallX : 0;
  let texX = Math.min(Math.max(Math.floor(wallX * texSize), 0), texSize - 1);
  const px = player !== null && typeof player === 'object' ? player.x : NaN;
  const py = player !== null && typeof player === 'object' ? player.y : NaN;
  const flipped = (hit.side === 'x' && px > hit.tileX)
    || (hit.side === 'y' && py < hit.tileY);
  if (flipped) {
    texX = texSize - 1 - texX;
  }
  return texX;
}

/**
 * Projection d'une colonne texturée : même top/bottom que projectColumn, plus la
 * portion verticale de texture visible. Quand le mur dépasse l'écran (joueur collé
 * au mur), top/bottom sont bornés et la source est rognée symétriquement.
 *   wallHeight = viewHeight / max(distance, MIN_DISTANCE)
 *   rawTop = (viewHeight - wallHeight) / 2
 *   srcY = (top - rawTop) / wallHeight * size
 *   srcHeight = (bottom - top) / wallHeight * size
 * viewHeight = 0 (ou bottom <= top) -> srcY = 0, srcHeight = 0 (aucune division par 0).
 * @param {number} distance
 * @param {number} viewHeight
 * @param {number} [size=TEXTURE_SIZE]
 * @returns {{ top: number, bottom: number, srcY: number, srcHeight: number }}
 *          0 <= srcY, srcY + srcHeight <= size
 * @throws {RangeError} mêmes cas que projectColumn
 */
export function textureSlice(distance, viewHeight, size = TEXTURE_SIZE) {
  const { top, bottom } = projectColumn(distance, viewHeight);
  const wallHeight = viewHeight / Math.max(distance, MIN_DISTANCE);
  if (!(viewHeight > 0) || !(bottom > top) || !(wallHeight > 0)) {
    return { top, bottom, srcY: 0, srcHeight: 0 };
  }
  const rawTop = (viewHeight - wallHeight) / 2;
  const srcY = Math.min(Math.max(((top - rawTop) / wallHeight) * size, 0), size);
  const srcHeight = Math.min(
    Math.max(((bottom - top) / wallHeight) * size, 0),
    size - srcY,
  );
  return { top, bottom, srcY, srcHeight };
}
