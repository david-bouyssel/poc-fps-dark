// Plan docs/design/mobile-tactile.md §3 et §6.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTION, computeIntent } from '../../src/game/input.js';
import {
  TOUCH_ACTIONS,
  MAX_TOUCH_POINTERS,
  touchActionFor,
  createTouchState,
  pressTouch,
  releaseTouch,
  touchActions,
} from '../../src/game/touch-input.js';

const EXPECTED = [
  ACTION.FORWARD, ACTION.BACKWARD, ACTION.TURN_LEFT, ACTION.TURN_RIGHT,
  ACTION.STRAFE_LEFT, ACTION.STRAFE_RIGHT, ACTION.RUN, ACTION.TOGGLE_MAP,
];

test('TOUCH_ACTIONS : gelé, 8 actions du plan, sans EXIT', () => {
  assert.ok(Object.isFrozen(TOUCH_ACTIONS));
  const values = Array.isArray(TOUCH_ACTIONS) ? [...TOUCH_ACTIONS] : Object.values(TOUCH_ACTIONS);
  assert.equal(values.length, 8);
  assert.deepEqual([...values].sort(), [...EXPECTED].sort());
  assert.ok(!values.includes(ACTION.EXIT));
  for (const v of values) assert.ok(Object.values(ACTION).includes(v), v);
});

test('MAX_TOUCH_POINTERS : entier positif', () => {
  assert.equal(MAX_TOUCH_POINTERS, 10);
});

test('touchActionFor : valeurs valides à l’identique, le reste donne null', () => {
  for (const a of EXPECTED) assert.equal(touchActionFor(a), a);
  for (const bad of ['exit', '', '__proto__', 'toString', 'constructor', null, undefined, 3, {}, [], ['forward']]) {
    assert.equal(touchActionFor(bad), null, String(bad));
  }
});

test('createTouchState : gelé, vide', () => {
  const s = createTouchState();
  assert.ok(Object.isFrozen(s));
  assert.equal(s.pointers.length, 0);
  assert.deepEqual([...touchActions(s)], []);
});

test('pressTouch : ajoute sans muter, état et entrées gelés', () => {
  const s0 = createTouchState();
  const s1 = pressTouch(s0, 1, ACTION.FORWARD);
  assert.notEqual(s1, s0);
  assert.equal(s0.pointers.length, 0);
  assert.ok(Object.isFrozen(s1));
  assert.ok(Object.isFrozen(s1.pointers));
  assert.ok(Object.isFrozen(s1.pointers[0]));
  assert.deepEqual({ ...s1.pointers[0] }, { pointerId: 1, action: ACTION.FORWARD });
});

test('pressTouch : même pointerId remplace l’action, pas de doublon', () => {
  let s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
  s = pressTouch(s, 1, ACTION.TURN_LEFT);
  assert.equal(s.pointers.length, 1);
  assert.deepEqual([...touchActions(s)], [ACTION.TURN_LEFT]);
});

test('pressTouch : entrées invalides renvoient la même référence', () => {
  const s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
  assert.equal(pressTouch(s, 2, ACTION.TOGGLE_MAP), s);
  assert.equal(pressTouch(s, 2, 'exit'), s);
  assert.equal(pressTouch(s, 2, 'nope'), s);
  assert.equal(pressTouch(s, 2, undefined), s);
  for (const id of [1.5, NaN, '1', null, undefined, Infinity]) {
    assert.equal(pressTouch(s, id, ACTION.RUN), s, String(id));
  }
});

test('pressTouch : plafond MAX_TOUCH_POINTERS', () => {
  let s = createTouchState();
  for (let i = 0; i < MAX_TOUCH_POINTERS; i += 1) s = pressTouch(s, i, ACTION.FORWARD);
  assert.equal(s.pointers.length, MAX_TOUCH_POINTERS);
  assert.equal(pressTouch(s, 999, ACTION.RUN), s);
});

test('releaseTouch : retire le bon doigt, absent = même référence', () => {
  let s = createTouchState();
  s = pressTouch(s, 1, ACTION.FORWARD);
  s = pressTouch(s, 2, ACTION.TURN_RIGHT);
  const r = releaseTouch(s, 1);
  assert.notEqual(r, s);
  assert.ok(Object.isFrozen(r));
  assert.deepEqual([...touchActions(r)], [ACTION.TURN_RIGHT]);
  assert.equal(s.pointers.length, 2);
  assert.equal(releaseTouch(r, 42), r);
  assert.equal(releaseTouch(createTouchState().pointers && r, 1), r);
});

test('touchActions : sans doublon, ordre d’appui, gelé', () => {
  let s = createTouchState();
  s = pressTouch(s, 5, ACTION.TURN_LEFT);
  s = pressTouch(s, 1, ACTION.FORWARD);
  s = pressTouch(s, 9, ACTION.FORWARD);
  const acts = touchActions(s);
  assert.ok(Object.isFrozen(acts));
  assert.deepEqual([...acts], [ACTION.TURN_LEFT, ACTION.FORWARD]);
});

test('multi-touch avec computeIntent', () => {
  const press = (...pairs) => pairs.reduce((s, [id, a]) => pressTouch(s, id, a), createTouchState());
  const a = computeIntent(touchActions(press([1, ACTION.FORWARD], [2, ACTION.TURN_LEFT])));
  assert.equal(a.move, 1);
  assert.equal(a.turn, -1);
  const b = computeIntent(touchActions(press([1, ACTION.FORWARD], [2, ACTION.RUN])));
  assert.equal(b.run, true);
  assert.equal(b.move, 1);
  const c = computeIntent(touchActions(press([1, ACTION.FORWARD], [2, ACTION.BACKWARD])));
  assert.equal(c.move, 0);
});

test('union clavier + tactile : un seul mouvement', () => {
  const s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
  const intent = computeIntent([...new Set([ACTION.FORWARD]), ...touchActions(s)]);
  assert.equal(intent.move, 1);
});

test('state invalide : TypeError', () => {
  for (const bad of [null, {}, undefined, 'x']) {
    assert.throws(() => pressTouch(bad, 1, ACTION.FORWARD), TypeError);
    assert.throws(() => releaseTouch(bad, 1), TypeError);
  }
});

test('pureté : pas de DOM, window, performance, Date ; seul import ./input.js', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/game/touch-input.js', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const word of ['document', 'window', 'performance', 'Date']) {
    assert.doesNotMatch(code, new RegExp(`\\b${word}\\b`), word);
  }
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.deepEqual(imports, ['./input.js']);
});
