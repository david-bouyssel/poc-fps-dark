// Game state: playing / won / lost (pure, no DOM).
//
// Order in a frame (contract for the monster): stepPlayer -> checkVictory -> (monster
// update, then declareDefeat on contact, only if !isGameOver(state)). Reaching the exit
// at the moment of contact is a victory.

import { isAtExit } from './exit.js';

export const GAME_STATUS = Object.freeze({ PLAYING: 'playing', WON: 'won', LOST: 'lost' });

/** @typedef {{ status: 'playing' | 'won' | 'lost' }} GameState  objet gelé */

function validateState(state) {
  if (state === null || typeof state !== 'object'
    || !Object.values(GAME_STATUS).includes(state.status)) {
    throw new TypeError('state must be a game state');
  }
}

/** @returns {GameState} { status: PLAYING } */
export function createGameState() {
  return Object.freeze({ status: GAME_STATUS.PLAYING });
}

/**
 * @param {GameState} state
 * @returns {boolean} status !== PLAYING
 * @throws {TypeError} état mal formé (status hors GAME_STATUS)
 */
export function isGameOver(state) {
  validateState(state);
  return state.status !== GAME_STATUS.PLAYING;
}

/**
 * Victoire si la partie est en cours et isAtExit(position, exit). Pur : nouvel état WON,
 * ou la même référence sinon (partie finie ou hors sortie).
 * @param {GameState} state
 * @param {{ x: number, y: number }} position
 * @param {{ tx: number, ty: number }} exit
 * @returns {GameState}
 * @throws {TypeError} état, position ou exit mal formé
 */
export function checkVictory(state, position, exit) {
  validateState(state);
  const atExit = isAtExit(position, exit);
  if (state.status !== GAME_STATUS.PLAYING || !atExit) return state;
  return Object.freeze({ status: GAME_STATUS.WON });
}

/**
 * Défaite (API du futur monstre). Partie en cours -> nouvel état LOST ; partie déjà finie
 * -> même référence (le premier état final l'emporte, une victoire n'est jamais changée
 * en défaite).
 * @param {GameState} state
 * @returns {GameState}
 * @throws {TypeError} état mal formé
 */
export function declareDefeat(state) {
  validateState(state);
  if (state.status !== GAME_STATUS.PLAYING) return state;
  return Object.freeze({ status: GAME_STATUS.LOST });
}
