import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION, KEY_BINDINGS, actionForCode, computeIntent } from '../../src/game/input.js';

const EXPECTED_ACTION = {
  FORWARD: 'forward',
  BACKWARD: 'backward',
  TURN_LEFT: 'turnLeft',
  TURN_RIGHT: 'turnRight',
  STRAFE_LEFT: 'strafeLeft',
  STRAFE_RIGHT: 'strafeRight',
  RUN: 'run',
  EXIT: 'exit',
};

const EXPECTED_BINDINGS = {
  ArrowUp: 'forward',
  KeyW: 'forward',
  ArrowDown: 'backward',
  KeyS: 'backward',
  ArrowLeft: 'turnLeft',
  KeyQ: 'turnLeft',
  ArrowRight: 'turnRight',
  KeyE: 'turnRight',
  KeyA: 'strafeLeft',
  KeyD: 'strafeRight',
  ShiftLeft: 'run',
  ShiftRight: 'run',
  Escape: 'exit',
};

describe('ACTION et KEY_BINDINGS', () => {
  test('ACTION conforme au plan et gelé', () => {
    assert.deepEqual({ ...ACTION }, EXPECTED_ACTION);
    assert.ok(Object.isFrozen(ACTION));
  });

  test('KEY_BINDINGS conforme au plan et gelé', () => {
    assert.deepEqual({ ...KEY_BINDINGS }, EXPECTED_BINDINGS);
    assert.ok(Object.isFrozen(KEY_BINDINGS));
  });
});

describe('actionForCode', () => {
  for (const [code, action] of Object.entries(EXPECTED_BINDINGS)) {
    test(`${code} -> ${action}`, () => {
      assert.equal(actionForCode(code), action);
    });
  }

  test('codes inconnus -> null', () => {
    for (const code of ['KeyZ', 'Space', 'Enter', 'Tab', 'F5', '', undefined, null, 'keyw', 'w', 'toString', '__proto__', 'constructor']) {
      assert.equal(actionForCode(code), null, String(code));
    }
  });
});

describe('computeIntent', () => {
  const intent = (actions) => computeIntent(actions);

  test('vide -> {0, 0, 0, false}', () => {
    assert.deepEqual({ ...intent([]) }, { move: 0, strafe: 0, turn: 0, run: false });
    assert.deepEqual({ ...intent(new Set()) }, { move: 0, strafe: 0, turn: 0, run: false });
  });

  test('avancer seul -> move 1 ; reculer seul -> move -1', () => {
    assert.equal(intent(['forward']).move, 1);
    assert.equal(intent(['backward']).move, -1);
  });

  test('avancer + reculer -> move 0', () => {
    assert.equal(intent(['forward', 'backward']).move, 0);
  });

  test('tourner : droite 1, gauche -1, les deux 0', () => {
    assert.equal(intent(['turnRight']).turn, 1);
    assert.equal(intent(['turnLeft']).turn, -1);
    assert.equal(intent(['turnLeft', 'turnRight']).turn, 0);
  });

  test('pas de côté : droite 1, gauche -1, les deux 0', () => {
    assert.equal(intent(['strafeRight']).strafe, 1);
    assert.equal(intent(['strafeLeft']).strafe, -1);
    assert.equal(intent(['strafeLeft', 'strafeRight']).strafe, 0);
  });

  test('run', () => {
    assert.equal(intent(['run']).run, true);
    assert.equal(intent(['forward']).run, false);
  });

  test('exit ignoré', () => {
    assert.deepEqual({ ...intent(['exit']) }, { move: 0, strafe: 0, turn: 0, run: false });
  });

  test('combinaison complète', () => {
    assert.deepEqual(
      { ...intent(new Set(['forward', 'strafeLeft', 'turnRight', 'run'])) },
      { move: 1, strafe: -1, turn: 1, run: true },
    );
  });

  test('accepte un Set et un tableau, même résultat', () => {
    const list = ['backward', 'strafeRight', 'turnLeft'];
    assert.deepEqual({ ...intent(new Set(list)) }, { ...intent(list) });
  });

  test('actions inconnues ignorées', () => {
    assert.deepEqual({ ...intent(['jump', 'KeyW']) }, { move: 0, strafe: 0, turn: 0, run: false });
  });

  test('résultat gelé, entrée non modifiée', () => {
    const set = new Set(['forward']);
    const r = intent(set);
    assert.ok(Object.isFrozen(r));
    assert.deepEqual([...set], ['forward']);
  });

  test('chaîne de bout en bout : codes physiques -> intention', () => {
    const pressed = new Set(['KeyW', 'KeyA', 'ArrowRight', 'ShiftLeft'].map(actionForCode));
    assert.deepEqual({ ...computeIntent(pressed) }, { move: 1, strafe: -1, turn: 1, run: true });
  });
});
