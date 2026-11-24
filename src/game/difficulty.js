// Difficulty levels: monster settings and FPS fog range of each level (pure, no DOM).
//
// "Normal" is exactly the default game: its monster values equal MONSTER and its fog range
// equals FOG_DISTANCE (src/render/raycaster.js). The seed, the maze and the exit never
// depend on the difficulty. Invariant of every level: walk 2.5 < chaseSpeed < run 4.5.

/** Identifiants des niveaux de difficulté. */
export const DIFFICULTY = Object.freeze({ EASY: 'easy', NORMAL: 'normal', NIGHTMARE: 'nightmare' });

/** Niveau par défaut (chargement de la page, valeur inconnue). */
export const DEFAULT_DIFFICULTY = DIFFICULTY.NORMAL;

/** Ordre d'affichage du <select>. */
export const DIFFICULTY_IDS = Object.freeze([DIFFICULTY.EASY, DIFFICULTY.NORMAL, DIFFICULTY.NIGHTMARE]);

function level(monster, fogDistance) {
  return Object.freeze({ monster: Object.freeze(monster), fogDistance });
}

/**
 * id -> { monster: Partial<MONSTER> gelé, fogDistance: number } gelé (gel profond).
 * Unités de MONSTER : tuiles et secondes ; fogDistance en tuiles.
 */
export const DIFFICULTY_SETTINGS = Object.freeze({
  [DIFFICULTY.EASY]: level({ chaseSpeed: 2.9, chaseDistance: 6, graceDuration: 5, sightDistance: 8 }, 8),
  [DIFFICULTY.NORMAL]: level({ chaseSpeed: 3.4, chaseDistance: 8, graceDuration: 3, sightDistance: 12 }, 6),
  [DIFFICULTY.NIGHTMARE]: level(
    { chaseSpeed: 4.1, chaseDistance: 12, graceDuration: 1.5, sightDistance: 16 },
    4.5,
  ),
});

/**
 * true si value est une chaîne et une clé propre de DIFFICULTY_SETTINGS. Ne lève jamais.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDifficulty(value) {
  return typeof value === 'string' && Object.hasOwn(DIFFICULTY_SETTINGS, value);
}

/**
 * Réglages gelés du niveau (référence de DIFFICULTY_SETTINGS[id]).
 * @param {string} id valeur de DIFFICULTY
 * @returns {{ monster: object, fogDistance: number }}
 * @throws {TypeError} id non chaîne
 * @throws {RangeError} id inconnu
 */
export function difficultySettings(id) {
  if (typeof id !== 'string') {
    throw new TypeError('id must be a string');
  }
  if (!isDifficulty(id)) {
    throw new RangeError('unknown difficulty id');
  }
  return DIFFICULTY_SETTINGS[id];
}
