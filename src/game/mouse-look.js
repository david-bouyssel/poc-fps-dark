// Mouse look: horizontal mouse movement to player rotation (pure, no DOM).
//
// The mouse gives an absolute angle per frame, applied just before stepPlayer. It never
// goes through Intent (which stays -1|0|1 for the keyboard angular speed).

import { normalizeAngle } from './player.js';

/** Réglages de la rotation à la souris. */
export const MOUSE_LOOK = Object.freeze({
  sensitivity: 0.0025, // rad / px (400 px ~ 1 rad, un tour ~ 2500 px)
  maxEventDelta: 300, // px : |movementX| borné par événement (pics connus de certains navigateurs)
  maxFrameTurn: Math.PI, // rad : cumul borné entre deux images
});

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Fusionne la surcharge partielle avec MOUSE_LOOK et la valide (même forme que
 * resolveSettings de movement.js).
 * @param {unknown} options
 * @returns {typeof MOUSE_LOOK}
 */
function resolveSettings(options) {
  if (options === undefined) return MOUSE_LOOK;
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const settings = { ...MOUSE_LOOK };
  for (const key of Object.keys(MOUSE_LOOK)) {
    const value = options[key];
    if (value === undefined) continue;
    if (!isFiniteNumber(value) || value < 0) {
      throw new RangeError(`options.${key} must be a finite number >= 0`);
    }
    settings[key] = value;
  }
  return settings;
}

/**
 * Rotation (rad) produite par un déplacement horizontal de souris.
 * movementX > 0 (vers la droite) -> angle croissant = tourner à droite, même sens que
 * Intent.turn = 1 dans stepPlayer.
 * movementX non nombre ou non fini -> 0. |movementX| borné à maxEventDelta.
 * @param {unknown} movementX
 * @param {Partial<typeof MOUSE_LOOK>} [options] surcharge partielle (tests)
 * @returns {number}
 * @throws {TypeError} options non objet ; {RangeError} réglage non fini ou négatif
 */
export function mouseTurnDelta(movementX, options) {
  const settings = resolveSettings(options);
  if (!isFiniteNumber(movementX) || movementX === 0) {
    return 0;
  }
  const bounded = Math.max(-settings.maxEventDelta, Math.min(settings.maxEventDelta, movementX));
  return bounded * settings.sensitivity;
}

/**
 * Cumul d'une rotation en attente : (pending + delta), borné à [-maxFrameTurn, maxFrameTurn].
 * delta non fini -> pending inchangé ; pending non fini -> traité comme 0.
 * @param {unknown} pending rad
 * @param {unknown} delta rad
 * @param {Partial<typeof MOUSE_LOOK>} [options] surcharge partielle (tests)
 * @returns {number}
 * @throws {TypeError} options non objet ; {RangeError} réglage non fini ou négatif
 */
export function accumulateTurn(pending, delta, options) {
  const settings = resolveSettings(options);
  const base = isFiniteNumber(pending) ? pending : 0;
  const sum = isFiniteNumber(delta) ? base + delta : base;
  return Math.max(-settings.maxFrameTurn, Math.min(settings.maxFrameTurn, sum));
}

/**
 * Applique une rotation au joueur. Fonction pure : x et y inchangés.
 * angle = normalizeAngle(angle + turn).
 * turn === 0 ou non fini -> même référence `player`.
 * @param {{ x: number, y: number, angle: number }} player
 * @param {number} turn rad
 * @returns {import('./player.js').Player} nouveau joueur gelé (ou le même)
 * @throws {TypeError} player sans x, y, angle finis
 */
export function applyMouseTurn(player, turn) {
  if (
    player === null
    || typeof player !== 'object'
    || !isFiniteNumber(player.x)
    || !isFiniteNumber(player.y)
    || !isFiniteNumber(player.angle)
  ) {
    throw new TypeError('player must have finite x, y and angle');
  }
  if (!isFiniteNumber(turn) || turn === 0) {
    return player;
  }
  return Object.freeze({ x: player.x, y: player.y, angle: normalizeAngle(player.angle + turn) });
}
