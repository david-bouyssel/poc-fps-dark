// Monster sprite: procedural RGBA frames (wide-open jaws, glowing eyes, pointed teeth) and
// the jaw animation clock (pure, no DOM, no randomness, no Date). Does not import game/:
// the kind and mode strings below mirror MONSTER_KIND and MONSTER_MODE of game/monster.js
// (tests check that they match).

/** Nombre d'images de la mâchoire : 0 fermée, 1 mi-ouverte, 2 grande ouverte. */
export const MONSTER_FRAME_COUNT = 3;
/** Côté par défaut d'une image, en texels. */
export const MONSTER_SPRITE_SIZE = 64;
/** Hauteur monde du monstre, en tuiles (passée par main.js). */
export const MONSTER_WORLD_SIZE = 0.8;
/** Kind d'entrée attendu (= MONSTER_KIND de game/monster.js). */
const INPUT_KIND = 'monster';
/** Modes d'entrée attendus (= MONSTER_MODE de game/monster.js). */
const CHASE_MODE = 'chase';
const WANDER_MODE = 'wander';
const MODES = Object.freeze([WANDER_MODE, CHASE_MODE]);
/** Kinds des images, clés de spriteImages. */
export const MONSTER_FRAME_KINDS = Object.freeze(
  Array.from({ length: MONSTER_FRAME_COUNT }, (_, index) => `monster-${index}`),
);

/** Bornes de taille d'une image, en texels. */
const MIN_SIZE = 16;
const MAX_SIZE = 256;
/** Cycle d'images (0 fermée, 1 mi-ouverte, 2 grande ouverte, 1) : un quart de période par image. */
const FRAME_SEQUENCE = Object.freeze([0, 1, 2, 1]);
/** Période d'un cycle complet de mâchoire, en s, en errance et en traque. */
const WANDER_PERIOD = 0.8;
const CHASE_PERIOD = 0.4;
/** Tolérance sur les frontières de quart de période (erreurs de flottants). */
const SLOT_EPSILON = 1e-9;

// Couleurs (constantes du module : thème sombre, pas de palette partagée).
const SKIN = [61, 43, 79];
const OUTLINE = [26, 16, 36];
const EYE = [232, 255, 122];
const PUPIL = [13, 10, 18];
const MOUTH = [10, 4, 8];
const TOOTH = [242, 239, 230];

// Géométrie en coordonnées normalisées [-1, 1] (y vers le bas), indépendante de la taille.
const HEAD_RADIUS = 0.9;
const EYE_CENTER_Y = -0.22;
const EYE_HALF_WIDTH = 0.2;
const EYE_HALF_HEIGHT = 0.24;
const EYE_OFFSET_X = 0.36;
const PUPIL_HALF_WIDTH = 0.05;
const PUPIL_HALF_HEIGHT = 0.17;
const MOUTH_CENTER_Y = 0.42;
const MOUTH_HALF_WIDTH = 0.62;
/** Demi-hauteur de la bouche par image : fente, mi-ouverte, grande ouverte. */
const MOUTH_HALF_HEIGHTS = Object.freeze([0.05, 0.2, 0.36]);
const TOOTH_LENGTH = 0.13;
const TOOTH_HALF_WIDTH = 0.07;
/** Dents du haut (base sur le bord supérieur de la bouche, pointe vers le bas). */
const UPPER_TOOTH_CENTERS = Object.freeze([-0.5, -0.3, -0.1, 0.1, 0.3, 0.5]);
/** Dents du bas (base sur le bord inférieur, pointe vers le haut). */
const LOWER_TOOTH_CENTERS = Object.freeze([-0.4, -0.2, 0, 0.2, 0.4]);

/**
 * @typedef {Object} SpriteData
 * @property {number} width
 * @property {number} height
 * @property {Uint8ClampedArray} data  RGBA, alpha 0 ou 255
 */

/**
 * Image RGBA déterministe d'une position de mâchoire. Repère normalisé : la tête est un
 * disque plein de rayon 0.9 ; contour sombre d'1 texel ; deux yeux lumineux à pupille fine ;
 * bouche sombre dont la demi-hauteur croît avec frame ; dents claires (triangles pointus
 * alternés) sur les bords de la bouche, présentes à chaque image.
 * @param {number} frame entier dans [0, 2]
 * @param {number} [size=MONSTER_SPRITE_SIZE] entier dans [16, 256]
 * @returns {SpriteData} objet gelé { width, height, data }
 * @throws {RangeError} frame hors [0, 2] ou non entier ; size hors [16, 256] ou non entier
 */
export function generateMonsterSprite(frame, size = MONSTER_SPRITE_SIZE) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= MONSTER_FRAME_COUNT) {
    throw new RangeError(`frame must be an integer between 0 and ${MONSTER_FRAME_COUNT - 1}`);
  }
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new RangeError(`size must be an integer between ${MIN_SIZE} and ${MAX_SIZE}`);
  }

  const mouthHalfHeight = MOUTH_HALF_HEIGHTS[frame];
  const outlineWidth = 1 / (size / 2);
  const data = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1;
      const v = ((y + 0.5) / size) * 2 - 1;
      const radius = Math.hypot(u, v);
      if (radius > HEAD_RADIUS) {
        continue;
      }
      let color = SKIN;
      if (radius > HEAD_RADIUS - outlineWidth) {
        color = OUTLINE;
      } else if (isInEllipse(u, v, -EYE_OFFSET_X, EYE_CENTER_Y, EYE_HALF_WIDTH, EYE_HALF_HEIGHT)
        || isInEllipse(u, v, EYE_OFFSET_X, EYE_CENTER_Y, EYE_HALF_WIDTH, EYE_HALF_HEIGHT)) {
        color = isPupil(u, v) ? PUPIL : EYE;
      } else if (isInEllipse(u, v, 0, MOUTH_CENTER_Y, MOUTH_HALF_WIDTH, mouthHalfHeight)) {
        color = MOUTH;
      }
      if (isTooth(u, v, mouthHalfHeight)) {
        color = TOOTH;
      }
      writePixel(data, (y * size + x) * 4, color);
    }
  }
  return Object.freeze({ width: size, height: size, data });
}

/**
 * Image à afficher. Sommeil (graceRemaining > 0) : image 0. Sinon cycle 0, 1, 2, 1 ; une
 * période de 0.8 s en errance, 0.4 s en traque (deux fois plus rapide).
 * @param {number} time  secondes écoulées, fini et >= 0
 * @param {'wander' | 'chase'} mode
 * @param {number} [graceRemaining=0]  secondes, fini
 * @returns {number} entier dans [0, 2]
 * @throws {TypeError} time non fini ou négatif ; mode inconnu ; graceRemaining non fini
 */
export function monsterFrame(time, mode, graceRemaining = 0) {
  if (typeof time !== 'number' || !Number.isFinite(time) || time < 0) {
    throw new TypeError('time must be a finite number >= 0');
  }
  if (!MODES.includes(mode)) {
    throw new TypeError('mode must be "wander" or "chase"');
  }
  if (typeof graceRemaining !== 'number' || !Number.isFinite(graceRemaining)) {
    throw new TypeError('graceRemaining must be a finite number');
  }
  if (graceRemaining > 0) {
    return FRAME_SEQUENCE[0];
  }
  const period = mode === CHASE_MODE ? CHASE_PERIOD : WANDER_PERIOD;
  const quarter = period / FRAME_SEQUENCE.length;
  const slot = Math.floor(time / quarter + SLOT_EPSILON) % FRAME_SEQUENCE.length;
  return FRAME_SEQUENCE[slot];
}

/**
 * Forme de sprite à passer à drawFpsView : { x, y, kind, worldSize } gelé, kind =
 * MONSTER_FRAME_KINDS[frame], worldSize = MONSTER_WORLD_SIZE.
 * @param {{ x: number, y: number, kind: string }} sprite  sortie de monsterSprite
 * @param {number} frame entier dans [0, 2]
 * @returns {{ x: number, y: number, kind: string, worldSize: number }}
 * @throws {TypeError} sprite mal formé, kind différent de 'monster', x ou y non finis
 * @throws {RangeError} frame hors [0, 2] ou non entier
 */
export function monsterFrameSprite(sprite, frame) {
  if (sprite === null || typeof sprite !== 'object') {
    throw new TypeError('sprite must be an object');
  }
  if (sprite.kind !== INPUT_KIND) {
    throw new TypeError(`sprite.kind must be "${INPUT_KIND}"`);
  }
  if (!Number.isFinite(sprite.x) || !Number.isFinite(sprite.y)) {
    throw new TypeError('sprite must have finite x and y');
  }
  if (!Number.isInteger(frame) || frame < 0 || frame >= MONSTER_FRAME_COUNT) {
    throw new RangeError(`frame must be an integer between 0 and ${MONSTER_FRAME_COUNT - 1}`);
  }
  return Object.freeze({
    x: sprite.x,
    y: sprite.y,
    kind: MONSTER_FRAME_KINDS[frame],
    worldSize: MONSTER_WORLD_SIZE,
  });
}

/** true si (u, v) est dans l'ellipse de centre (cu, cv) et de demi-axes (rx, ry). */
function isInEllipse(u, v, cu, cv, rx, ry) {
  const du = (u - cu) / rx;
  const dv = (v - cv) / ry;
  return du * du + dv * dv <= 1;
}

/** Pupille fine verticale au centre d'un œil (position relative à l'œil le plus proche). */
function isPupil(u, v) {
  const eyeU = u < 0 ? -EYE_OFFSET_X : EYE_OFFSET_X;
  return Math.abs(u - eyeU) <= PUPIL_HALF_WIDTH && Math.abs(v - EYE_CENTER_Y) <= PUPIL_HALF_HEIGHT;
}

/**
 * Dent : triangle pointu, base sur le bord de la bouche (haut ou bas), pointe vers
 * l'intérieur. Dents du haut et du bas alternées.
 */
function isTooth(u, v, mouthHalfHeight) {
  const upperBase = MOUTH_CENTER_Y - mouthHalfHeight;
  const lowerBase = MOUTH_CENTER_Y + mouthHalfHeight;
  for (const cu of UPPER_TOOTH_CENTERS) {
    if (isInTriangle(u, v, cu, upperBase, upperBase + TOOTH_LENGTH)) {
      return true;
    }
  }
  for (const cu of LOWER_TOOTH_CENTERS) {
    if (isInTriangle(u, v, cu, lowerBase, lowerBase - TOOTH_LENGTH)) {
      return true;
    }
  }
  return false;
}

/**
 * Triangle de base en baseV (largeur 2 * TOOTH_HALF_WIDTH centrée sur cu), pointe en tipV
 * sur le même axe vertical.
 */
function isInTriangle(u, v, cu, baseV, tipV) {
  const span = tipV - baseV;
  const t = (v - baseV) / span;
  if (t < 0 || t > 1) {
    return false;
  }
  return Math.abs(u - cu) <= TOOTH_HALF_WIDTH * (1 - t);
}

function writePixel(data, offset, [r, g, b]) {
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = 255;
}
