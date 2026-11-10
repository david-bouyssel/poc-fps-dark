// Pure procedural fruit sprites (RGBA arrays with transparency). No DOM, no randomness.
// Never imports src/game/: species ids are duplicated here and kept equal to FRUIT_KIND
// by a unit test.

import { mixColor } from './raycaster.js';

/** Ids des espèces, même ordre que FRUIT_TABLE (src/game/fruits.js). */
export const FRUIT_SPRITE_KINDS = Object.freeze(['strawberry', 'cherry', 'peach', 'dragonfruit']);

/** Côté d'une image de fruit, en texels. */
export const SPRITE_SIZE = 32;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MIN_SIZE = 8;
const MAX_SIZE = 256;
const OUTLINE_TARGET = '#000000';
/** Assombrissement du contour : lisible sur le sol rose et les murs lavande. */
const OUTLINE_SHADE = 0.3;
/** Assombrissement du sillon de la pêche. */
const GROOVE_SHADE = 0.15;

/** Couleurs de palette requises par espèce. */
const REQUIRED_COLORS = Object.freeze({
  strawberry: Object.freeze(['fruitStrawberry', 'fruitSeed', 'fruitLeaf']),
  cherry: Object.freeze(['fruitCherry', 'fruitStem', 'fruitLeaf']),
  peach: Object.freeze(['fruitPeach', 'fruitLeaf', 'fruitStem']),
  dragonfruit: Object.freeze(['fruitDragon', 'fruitLeaf']),
});

/**
 * @typedef {Object} SpriteData  objet gelé (le contenu de data reste un tableau typé)
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data  RGBA, fond alpha 0, pixels du fruit alpha 255
 */

/**
 * Génère l'image d'un fruit. Déterministe : mêmes entrées -> mêmes octets.
 * Formes simples (disques, ellipses) calculées par pixel, contour assombri d'un pixel.
 * Alpha toujours 0 ou 255 (pas d'alpha intermédiaire).
 * @param {string} kind valeur de FRUIT_SPRITE_KINDS
 * @param {object} palette doit contenir les clés fruit* utilisées par l'espèce
 * @param {number} [size=SPRITE_SIZE] entier dans [8, 256]
 * @returns {SpriteData}
 * @throws {RangeError} kind inconnu ou size invalide
 * @throws {TypeError} palette absente ou couleur requise non '#rrggbb'
 */
export function generateFruitSprite(kind, palette, size = SPRITE_SIZE) {
  if (typeof kind !== 'string' || !Object.hasOwn(REQUIRED_COLORS, kind)) {
    throw new RangeError('kind must be a FRUIT_SPRITE_KINDS value');
  }
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new RangeError('size must be an integer in [8, 256]');
  }
  if (palette === null || typeof palette !== 'object') {
    throw new TypeError('palette must be an object');
  }
  const hex = {};
  for (const key of REQUIRED_COLORS[kind]) {
    const value = palette[key];
    if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
      throw new TypeError(`palette.${key} must be a "#rrggbb" string`);
    }
    hex[key] = value;
  }

  const colors = buildColors(kind, hex);
  const shape = SHAPES[kind];
  // Pass 1: colour key per pixel (null = transparent).
  const keys = new Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      keys[y * size + x] = shape((x + 0.5) / size, (y + 0.5) / size);
    }
  }
  // Pass 2: RGBA, with a darker outline on pixels next to the background.
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const key = keys[y * size + x];
      if (key === null) {
        continue;
      }
      const edge = isTransparent(keys, size, x - 1, y) || isTransparent(keys, size, x + 1, y)
        || isTransparent(keys, size, x, y - 1) || isTransparent(keys, size, x, y + 1);
      const rgb = edge ? colors[key].outline : colors[key].fill;
      const offset = (y * size + x) * 4;
      data[offset] = rgb[0];
      data[offset + 1] = rgb[1];
      data[offset + 2] = rgb[2];
      data[offset + 3] = 255;
    }
  }
  return Object.freeze({ width: size, height: size, data });
}

function isTransparent(keys, size, x, y) {
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return true;
  }
  return keys[y * size + x] === null;
}

/** Couleurs de remplissage et de contour par clé utilisée par les formes. */
function buildColors(kind, hex) {
  const entries = {};
  const add = (name, color) => {
    entries[name] = {
      fill: parseHex(color),
      outline: parseHex(mixColor(color, OUTLINE_TARGET, OUTLINE_SHADE)),
    };
  };
  for (const [key, color] of Object.entries(hex)) {
    add(key, color);
  }
  if (kind === 'peach') {
    add('peachGroove', mixColor(hex.fruitPeach, OUTLINE_TARGET, GROOVE_SHADE));
  }
  return entries;
}

function insideEllipse(u, v, cx, cy, rx, ry) {
  const dx = (u - cx) / rx;
  const dy = (v - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function distanceToSegment(u, v, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.min(Math.max(((u - ax) * abx + (v - ay) * aby) / (abx * abx + aby * aby), 0), 1);
  return Math.hypot(u - (ax + t * abx), v - (ay + t * aby));
}

/** Petite flamme verte pointant vers le haut, base en (cx, cy). */
function insideFlame(u, v, cx, cy, height, halfWidth) {
  const dy = cy - v;
  if (dy < 0 || dy > height) {
    return false;
  }
  return Math.abs(u - cx) <= halfWidth * (1 - dy / height);
}

/** Formes : (u, v) dans ]0, 1[ (centre du pixel) -> clé de couleur ou null. */
const SHAPES = Object.freeze({
  strawberry: (u, v) => {
    // Leaves on top of the body.
    if (insideEllipse(u, v, 0.38, 0.24, 0.14, 0.06) || insideEllipse(u, v, 0.62, 0.24, 0.14, 0.06)
      || insideEllipse(u, v, 0.5, 0.2, 0.06, 0.1)) {
      return 'fruitLeaf';
    }
    // Body: ellipse narrowing towards the bottom tip.
    const cy = 0.56;
    const below = Math.max(0, (v - cy) / 0.36);
    if (!insideEllipse(u, v, 0.5, cy, 0.36 * (1 - 0.55 * below), 0.36)) {
      return null;
    }
    // Staggered cream seeds.
    const row = Math.floor(v * 7);
    const shift = row % 2 === 0 ? 0 : 0.5;
    const cellU = (u * 7 + shift) % 1;
    const cellV = (v * 7) % 1;
    if (v > 0.36 && Math.abs(cellU - 0.5) < 0.13 && Math.abs(cellV - 0.5) < 0.13) {
      return 'fruitSeed';
    }
    return 'fruitStrawberry';
  },
  cherry: (u, v) => {
    if (insideEllipse(u, v, 0.36, 0.66, 0.22, 0.22) || insideEllipse(u, v, 0.64, 0.68, 0.22, 0.22)) {
      return 'fruitCherry';
    }
    if (insideEllipse(u, v, 0.68, 0.14, 0.12, 0.05)) {
      return 'fruitLeaf';
    }
    if (distanceToSegment(u, v, 0.36, 0.46, 0.54, 0.12) <= 0.03
      || distanceToSegment(u, v, 0.64, 0.48, 0.54, 0.12) <= 0.03) {
      return 'fruitStem';
    }
    return null;
  },
  peach: (u, v) => {
    if (insideEllipse(u, v, 0.5, 0.57, 0.38, 0.36)) {
      // Soft vertical groove, slightly curved.
      const grooveU = 0.42 + 0.05 * Math.sin(v * Math.PI);
      if (v > 0.3 && v < 0.85 && Math.abs(u - grooveU) < 0.022) {
        return 'peachGroove';
      }
      return 'fruitPeach';
    }
    if (insideEllipse(u, v, 0.64, 0.16, 0.13, 0.06)) {
      return 'fruitLeaf';
    }
    if (distanceToSegment(u, v, 0.5, 0.23, 0.53, 0.1) <= 0.025) {
      return 'fruitStem';
    }
    return null;
  },
  dragonfruit: (u, v) => {
    // Green spikes on the top and on the body.
    if (insideFlame(u, v, 0.5, 0.14, 0.11, 0.07) || insideFlame(u, v, 0.34, 0.19, 0.09, 0.06)
      || insideFlame(u, v, 0.66, 0.19, 0.09, 0.06)) {
      return 'fruitLeaf';
    }
    if (!insideEllipse(u, v, 0.5, 0.55, 0.42, 0.42)) {
      return null;
    }
    if (insideFlame(u, v, 0.26, 0.48, 0.1, 0.05) || insideFlame(u, v, 0.74, 0.48, 0.1, 0.05)
      || insideFlame(u, v, 0.32, 0.8, 0.1, 0.05) || insideFlame(u, v, 0.68, 0.8, 0.1, 0.05)
      || insideFlame(u, v, 0.5, 0.36, 0.08, 0.04)) {
      return 'fruitLeaf';
    }
    return 'fruitDragon';
  },
});

function parseHex(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
