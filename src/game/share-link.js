// Shareable game link: strict parsing of ?seed=&w=&h=&d= and link building (pure, no DOM).
//
// The caller (main.js) passes location.search and location.href: this module never reads
// window, document or the address bar. Validation rules are the form's rules (MAZE_LIMITS,
// MAX_SEED), and the form uses parseNonNegativeInteger too, so both never diverge.

import { MAZE_LIMITS } from '../maze/maze.js';
import { MAX_SEED } from '../maze/random.js';

/** Noms des paramètres de requête. */
export const SHARE_PARAM = Object.freeze({ seed: 'seed', width: 'w', height: 'h', difficulty: 'd' });

/** Garde-fous de longueur. */
export const SHARE_LIMITS = Object.freeze({ maxSearchLength: 512, maxIntegerLength: 10 });

export const SHARE_STATUS = Object.freeze({ ABSENT: 'absent', VALID: 'valid', INVALID: 'invalid' });

const INTEGER_PATTERN = /^\d+$/;
const KNOWN_PARAMS = Object.freeze(Object.values(SHARE_PARAM));

/**
 * Entier décimal >= 0, après trim. Mêmes règles que le formulaire.
 * @param {string} raw
 * @returns {number | null} null si non conforme (vide, signe, point, exposant,
 *   hexadécimal, plus de maxIntegerLength chiffres, non sûr)
 * @throws {TypeError} si raw n'est pas une chaîne
 */
export function parseNonNegativeInteger(raw) {
  if (typeof raw !== 'string') {
    throw new TypeError('raw must be a string');
  }
  const text = raw.trim();
  if (text.length > SHARE_LIMITS.maxIntegerLength || !INTEGER_PATTERN.test(text)) {
    return null;
  }
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

function isValidSize(value) {
  return value !== null && value >= MAZE_LIMITS.minSize && value <= MAZE_LIMITS.maxSize;
}

function isValidSeed(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SEED;
}

function invalid(reason) {
  return Object.freeze({ status: SHARE_STATUS.INVALID, reason });
}

/** Taille facultative : absente -> null ; présente (même vide) -> entier borné ou undefined. */
function readSize(params, name) {
  if (!params.has(name)) {
    return null;
  }
  const value = parseNonNegativeInteger(params.get(name));
  return isValidSize(value) ? value : undefined;
}

/**
 * @param {string} search  location.search ('' ou '?…'; le '?' initial est facultatif)
 * @param {{ difficulties?: readonly string[] }} [options]
 * @returns {Readonly<
 *   | { status: 'absent' }
 *   | { status: 'valid', width: number | null, height: number | null,
 *       seed: number | null, difficulty: string | null }
 *   | { status: 'invalid', reason: 'malformed' | 'size' | 'seed' | 'difficulty' }>}
 * @throws {TypeError} si search n'est pas une chaîne, ou difficulties pas un tableau de chaînes
 */
export function parseShareParams(search, options = {}) {
  if (typeof search !== 'string') {
    throw new TypeError('search must be a string');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const difficulties = options.difficulties === undefined ? [] : options.difficulties;
  if (!Array.isArray(difficulties) || !difficulties.every((id) => typeof id === 'string')) {
    throw new TypeError('difficulties must be an array of strings');
  }

  if (search.length > SHARE_LIMITS.maxSearchLength) {
    return invalid('malformed');
  }
  const params = new URLSearchParams(search);
  if (!KNOWN_PARAMS.some((name) => params.has(name))) {
    return Object.freeze({ status: SHARE_STATUS.ABSENT });
  }
  if (KNOWN_PARAMS.some((name) => params.getAll(name).length > 1)) {
    return invalid('malformed');
  }

  const width = readSize(params, SHARE_PARAM.width);
  const height = readSize(params, SHARE_PARAM.height);
  if (width === undefined || height === undefined) {
    return invalid('size');
  }

  let seed = null;
  const rawSeed = params.get(SHARE_PARAM.seed);
  if (rawSeed !== null && rawSeed.trim() !== '') {
    seed = parseNonNegativeInteger(rawSeed);
    if (seed === null || seed > MAX_SEED) {
      return invalid('seed');
    }
  }

  let difficulty = null;
  const rawDifficulty = params.get(SHARE_PARAM.difficulty);
  if (rawDifficulty !== null && rawDifficulty !== '') {
    if (!difficulties.includes(rawDifficulty)) {
      return invalid('difficulty');
    }
    difficulty = rawDifficulty;
  }

  return Object.freeze({ status: SHARE_STATUS.VALID, width, height, seed, difficulty });
}

/**
 * @param {string} baseHref  URL absolue de la page (location.href)
 * @param {{ width: number, height: number, seed: number, difficulty?: string | null }} config
 * @returns {string} URL absolue : origine et chemin de baseHref, requête remplacée,
 *   fragment supprimé
 * @throws {TypeError} baseHref non chaîne ou non analysable, champ manquant ou mal typé
 * @throws {RangeError} taille hors MAZE_LIMITS, graine hors 0..MAX_SEED
 */
export function buildShareUrl(baseHref, config) {
  if (typeof baseHref !== 'string') {
    throw new TypeError('baseHref must be a string');
  }
  if (config === null || typeof config !== 'object') {
    throw new TypeError('config must be an object');
  }
  const { width, height, seed, difficulty = null } = config;
  for (const value of [width, height, seed]) {
    if (!Number.isInteger(value)) {
      throw new TypeError('width, height and seed must be integers');
    }
  }
  if (difficulty !== null && typeof difficulty !== 'string') {
    throw new TypeError('difficulty must be a string or null');
  }
  if (!isValidSize(width) || !isValidSize(height)) {
    throw new RangeError('size out of MAZE_LIMITS');
  }
  if (!isValidSeed(seed)) {
    throw new RangeError('seed out of range');
  }

  let url;
  try {
    url = new URL(baseHref);
  } catch {
    throw new TypeError('baseHref must be an absolute URL');
  }
  url.search = '';
  url.hash = '';
  url.searchParams.set(SHARE_PARAM.seed, String(seed));
  url.searchParams.set(SHARE_PARAM.width, String(width));
  url.searchParams.set(SHARE_PARAM.height, String(height));
  if (typeof difficulty === 'string' && difficulty !== '') {
    url.searchParams.set(SHARE_PARAM.difficulty, difficulty);
  }
  return url.href;
}
