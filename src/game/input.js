// Keyboard bindings and movement intent (pure, no DOM).
// Bindings use KeyboardEvent.code (physical key position): KeyW is Z on AZERTY
// and W on QWERTY, so both layouts work with the same table.

/** Actions de jeu (valeurs stockées par l'appelant dans son ensemble d'actions). */
export const ACTION = Object.freeze({
  FORWARD: 'forward',
  BACKWARD: 'backward',
  TURN_LEFT: 'turnLeft',
  TURN_RIGHT: 'turnRight',
  STRAFE_LEFT: 'strafeLeft',
  STRAFE_RIGHT: 'strafeRight',
  RUN: 'run',
  EXIT: 'exit',
});

/** Table gelée KeyboardEvent.code -> action. */
export const KEY_BINDINGS = Object.freeze({
  ArrowUp: ACTION.FORWARD,
  KeyW: ACTION.FORWARD, // Z on AZERTY
  ArrowDown: ACTION.BACKWARD,
  KeyS: ACTION.BACKWARD,
  ArrowLeft: ACTION.TURN_LEFT,
  KeyQ: ACTION.TURN_LEFT, // A on AZERTY
  ArrowRight: ACTION.TURN_RIGHT,
  KeyE: ACTION.TURN_RIGHT,
  KeyA: ACTION.STRAFE_LEFT, // Q on AZERTY
  KeyD: ACTION.STRAFE_RIGHT,
  ShiftLeft: ACTION.RUN,
  ShiftRight: ACTION.RUN,
  Escape: ACTION.EXIT,
});

/**
 * Action liée à une touche physique.
 * @param {string} code KeyboardEvent.code
 * @returns {string | null} action, ou null si touche non liée (ou code non chaîne)
 */
export function actionForCode(code) {
  if (typeof code !== 'string' || !Object.hasOwn(KEY_BINDINGS, code)) {
    return null;
  }
  return KEY_BINDINGS[code];
}

/**
 * @typedef {Object} Intent  objet gelé
 * @property {-1|0|1} move    1 avancer, -1 reculer
 * @property {-1|0|1} strafe  1 pas à droite, -1 pas à gauche
 * @property {-1|0|1} turn    1 tourner à droite, -1 à gauche
 * @property {boolean} run
 */

/**
 * Intention de mouvement à partir de l'ensemble des actions enfoncées.
 * Deux actions opposées enfoncées ensemble s'annulent (0). EXIT et les valeurs
 * inconnues sont ignorés.
 * @param {Iterable<string>} pressedActions par exemple un Set ou un tableau
 * @returns {Intent}
 * @throws {TypeError} pressedActions non itérable
 */
export function computeIntent(pressedActions) {
  if (pressedActions === null || pressedActions === undefined
    || typeof pressedActions[Symbol.iterator] !== 'function') {
    throw new TypeError('pressedActions must be iterable');
  }
  let forward = false;
  let backward = false;
  let turnLeft = false;
  let turnRight = false;
  let strafeLeft = false;
  let strafeRight = false;
  let run = false;
  for (const action of pressedActions) {
    switch (action) {
      case ACTION.FORWARD: forward = true; break;
      case ACTION.BACKWARD: backward = true; break;
      case ACTION.TURN_LEFT: turnLeft = true; break;
      case ACTION.TURN_RIGHT: turnRight = true; break;
      case ACTION.STRAFE_LEFT: strafeLeft = true; break;
      case ACTION.STRAFE_RIGHT: strafeRight = true; break;
      case ACTION.RUN: run = true; break;
      default: break;
    }
  }
  return Object.freeze({
    move: axis(forward, backward),
    strafe: axis(strafeRight, strafeLeft),
    turn: axis(turnRight, turnLeft),
    run,
  });
}

/**
 * @param {boolean} positive
 * @param {boolean} negative
 * @returns {-1|0|1}
 */
function axis(positive, negative) {
  if (positive === negative) return 0;
  return positive ? 1 : -1;
}
