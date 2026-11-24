// Pause state of a round (pure, no DOM, no clock).
//
// The pause stops the game loop (stop/start), so the first frame after a resume has
// dt = 0. This module only tracks whether the round is paused and why.

import { isGameOver } from './game-state.js';

/** Raisons de pause (valeurs gelées). */
export const PAUSE_REASON = Object.freeze({
  MANUAL: 'manual', // P, touch button
  BLUR: 'blur', // window without focus
  HIDDEN: 'hidden', // hidden page
});

const REASONS = Object.freeze(Object.values(PAUSE_REASON));

/** @typedef {{ paused: boolean, reason: 'manual' | 'blur' | 'hidden' | null }} PauseState  objet gelé */

function validateState(state) {
  if (state === null || typeof state !== 'object' || typeof state.paused !== 'boolean') {
    throw new TypeError('state must be a pause state');
  }
}

function makeState(paused, reason) {
  return Object.freeze({ paused, reason });
}

/** @returns {PauseState} { paused: false, reason: null } */
export function createPauseState() {
  return makeState(false, null);
}

/**
 * Met en pause. Déjà en pause : même référence (la première raison est conservée).
 * @param {PauseState} state
 * @param {string} reason  valeur de PAUSE_REASON
 * @returns {PauseState}
 * @throws {TypeError} état mal formé ou raison inconnue
 */
export function pauseGame(state, reason) {
  validateState(state);
  if (typeof reason !== 'string' || !REASONS.includes(reason)) {
    throw new TypeError('reason must be a PAUSE_REASON value');
  }
  if (state.paused) {
    return state;
  }
  return makeState(true, reason);
}

/**
 * Sort de pause. Pas en pause : même référence.
 * @param {PauseState} state
 * @returns {PauseState} { paused: false, reason: null }
 * @throws {TypeError} état mal formé
 */
export function resumeGame(state) {
  validateState(state);
  if (!state.paused) {
    return state;
  }
  return createPauseState();
}

/**
 * @param {PauseState} state
 * @returns {boolean}
 * @throws {TypeError} état mal formé
 */
export function isPaused(state) {
  validateState(state);
  return state.paused;
}

/**
 * Peut-on mettre en pause ? Vrai seulement si la manche n'est pas en pause et que
 * isGameOver(gameState) est faux.
 * @param {PauseState} pauseState
 * @param {import('./game-state.js').GameState} gameState
 * @returns {boolean}
 * @throws {TypeError} l'un des deux états mal formé
 */
export function canPause(pauseState, gameState) {
  validateState(pauseState);
  const over = isGameOver(gameState);
  return !pauseState.paused && !over;
}
