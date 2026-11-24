// Touch buttons state: which pointer holds which action (pure, no DOM).
import { ACTION } from './input.js';

/** Actions a touch button can carry (EXIT excluded: dedicated existing button). */
export const TOUCH_ACTIONS = Object.freeze([
  ACTION.FORWARD,
  ACTION.BACKWARD,
  ACTION.TURN_LEFT,
  ACTION.TURN_RIGHT,
  ACTION.STRAFE_LEFT,
  ACTION.STRAFE_RIGHT,
  ACTION.RUN,
  ACTION.TOGGLE_MAP,
  ACTION.PAUSE,
]);

/** Maximum number of fingers tracked at the same time. */
export const MAX_TOUCH_POINTERS = 10;

/**
 * Action of a button from its data-action attribute.
 * @param {unknown} value
 * @returns {string | null} a TOUCH_ACTIONS value, or null (unknown value, not a string)
 */
export function touchActionFor(value) {
  if (typeof value !== 'string') {
    return null;
  }
  return TOUCH_ACTIONS.includes(value) ? value : null;
}

/**
 * @typedef {Object} TouchState  frozen object
 * @property {ReadonlyArray<{ pointerId: number, action: string }>} pointers  frozen entries
 */

function makeState(pointers) {
  return Object.freeze({ pointers: Object.freeze(pointers) });
}

function assertState(state) {
  if (state === null || typeof state !== 'object' || !Array.isArray(state.pointers)) {
    throw new TypeError('state must be a TouchState');
  }
}

/** @returns {TouchState} empty state */
export function createTouchState() {
  return makeState([]);
}

/**
 * A finger lands on a button that holds an action.
 * Same pointerId already present: its action is replaced. TOGGLE_MAP and PAUSE (toggles,
 * not held), unknown action, non-integer pointerId or full state: same reference returned.
 * @param {TouchState} state
 * @param {number} pointerId
 * @param {string} action
 * @returns {TouchState}
 * @throws {TypeError} invalid state
 */
export function pressTouch(state, pointerId, action) {
  assertState(state);
  if (!Number.isInteger(pointerId) || action === ACTION.TOGGLE_MAP
    || action === ACTION.PAUSE || touchActionFor(action) === null) {
    return state;
  }
  const index = state.pointers.findIndex((entry) => entry.pointerId === pointerId);
  if (index === -1) {
    if (state.pointers.length >= MAX_TOUCH_POINTERS) {
      return state;
    }
    return makeState([...state.pointers, Object.freeze({ pointerId, action })]);
  }
  const next = state.pointers.slice();
  next[index] = Object.freeze({ pointerId, action });
  return makeState(next);
}

/**
 * The finger lifts. Absent pointerId: same reference.
 * @param {TouchState} state
 * @param {number} pointerId
 * @returns {TouchState}
 * @throws {TypeError} invalid state
 */
export function releaseTouch(state, pointerId) {
  assertState(state);
  if (!state.pointers.some((entry) => entry.pointerId === pointerId)) {
    return state;
  }
  return makeState(state.pointers.filter((entry) => entry.pointerId !== pointerId));
}

/**
 * Held actions, without duplicates, in press order.
 * @param {TouchState} state
 * @returns {ReadonlyArray<string>}
 */
export function touchActions(state) {
  assertState(state);
  return Object.freeze([...new Set(state.pointers.map((entry) => entry.action))]);
}
