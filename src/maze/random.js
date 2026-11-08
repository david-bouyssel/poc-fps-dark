// Deterministic pseudo-random number generation for maze generation.
//
// Seed stability: the "seed -> maze" contract depends on this exact algorithm
// (mulberry32) and on randomInt below. Changing either one breaks every seed
// already shared by players.

/** Largest accepted seed (unsigned 32-bit integer). */
export const MAX_SEED = 0xFFFFFFFF;

/**
 * PRNG mulberry32. Algorithme figé : changer l'algorithme casse la reproductibilité
 * des graines déjà partagées.
 * @param {number} seed entier dans [0, 0xFFFFFFFF]
 * @returns {() => number} fonction qui renvoie un flottant dans [0, 1)
 * @throws {TypeError|RangeError} si seed invalide
 */
export function createRng(seed) {
  if (typeof seed !== 'number') {
    throw new TypeError('seed must be a number');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`seed must be an integer between 0 and ${MAX_SEED}`);
  }

  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Entier uniforme dans [0, maxExclusive).
 * @param {() => number} rng
 * @param {number} maxExclusive entier >= 1
 * @returns {number}
 * @throws {TypeError} si rng n'est pas une fonction ou maxExclusive non numérique
 * @throws {RangeError} si maxExclusive n'est pas un entier >= 1
 */
export function randomInt(rng, maxExclusive) {
  if (typeof rng !== 'function') {
    throw new TypeError('rng must be a function');
  }
  if (typeof maxExclusive !== 'number') {
    throw new TypeError('maxExclusive must be a number');
  }
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1) {
    throw new RangeError('maxExclusive must be an integer >= 1');
  }
  return Math.floor(rng() * maxExclusive);
}
