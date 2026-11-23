// Tests de sécurité de src/game/touch-input.js (testeur-securite) : entrées hostiles
// (action forgée, pointerId invalide, état invalide), plafond de doigts, immutabilité,
// et absence d'API réseau/stockage/HTML dynamique dans le module.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TOUCH_ACTIONS, MAX_TOUCH_POINTERS, touchActionFor, createTouchState,
  pressTouch, releaseTouch, touchActions,
} from '../../src/game/touch-input.js';
import { ACTION } from '../../src/game/input.js';

describe('sécurité touch-input : data-action forgé', () => {
  const forged = [
    'constructor', '__proto__', 'toString', 'EXIT', ACTION.EXIT, '', ' forward', 'FORWARD\u0000',
    '<script>', 'javascript:alert(1)', null, undefined, 0, 1, {}, [], ['forward'], Symbol('x'),
  ];
  test('touchActionFor ne renvoie que des valeurs de TOUCH_ACTIONS', () => {
    for (const v of forged) {
      assert.equal(touchActionFor(v), null, String(typeof v));
    }
    for (const a of TOUCH_ACTIONS) assert.equal(touchActionFor(a), a);
  });
  test('EXIT jamais accessible au tactile', () => {
    assert.ok(!TOUCH_ACTIONS.includes(ACTION.EXIT));
  });
  test('pressTouch ignore action forgée (même référence)', () => {
    const s = createTouchState();
    for (const v of forged) assert.equal(pressTouch(s, 1, v), s);
  });
  test('pressTouch ignore TOGGLE_MAP', () => {
    const s = createTouchState();
    assert.equal(pressTouch(s, 1, ACTION.TOGGLE_MAP), s);
  });
  test('TOUCH_ACTIONS gelé', () => {
    assert.ok(Object.isFrozen(TOUCH_ACTIONS));
    assert.throws(() => TOUCH_ACTIONS.push('x'), TypeError);
  });
});

describe('sécurité touch-input : pointerId invalide', () => {
  const bad = [NaN, Infinity, -Infinity, 1.5, '1', null, undefined, {}, []];
  test('pressTouch ignore les pointerId non entiers', () => {
    const s = createTouchState();
    for (const id of bad) assert.equal(pressTouch(s, id, ACTION.FORWARD), s, String(id));
  });
  test('releaseTouch avec id absent/invalide : même référence, pas d\'exception', () => {
    const s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
    for (const id of [...bad, 99]) assert.equal(releaseTouch(s, id), s, String(id));
  });
  test('pointerId 0 ou négatif accepté sans corruption', () => {
    let s = pressTouch(createTouchState(), -1, ACTION.FORWARD);
    s = pressTouch(s, 0, ACTION.RUN);
    assert.equal(s.pointers.length, 2);
  });
});

describe('sécurité touch-input : plafond et état', () => {
  test('MAX_TOUCH_POINTERS jamais dépassé, état identique au-delà', () => {
    let s = createTouchState();
    for (let i = 0; i < MAX_TOUCH_POINTERS * 5; i++) s = pressTouch(s, i, ACTION.FORWARD);
    assert.equal(s.pointers.length, MAX_TOUCH_POINTERS);
    assert.equal(pressTouch(s, 9999, ACTION.RUN), s);
  });
  test('plein : un pointerId existant peut encore changer d\'action', () => {
    let s = createTouchState();
    for (let i = 0; i < MAX_TOUCH_POINTERS; i++) s = pressTouch(s, i, ACTION.FORWARD);
    const s2 = pressTouch(s, 3, ACTION.RUN);
    assert.equal(s2.pointers.length, MAX_TOUCH_POINTERS);
    assert.ok(touchActions(s2).includes(ACTION.RUN));
  });
  test('le même pointerId répété ne fait pas grossir l\'état', () => {
    let s = createTouchState();
    for (let i = 0; i < 1000; i++) s = pressTouch(s, 7, ACTION.FORWARD);
    assert.equal(s.pointers.length, 1);
  });
  test('états gelés et non mutables', () => {
    const s = pressTouch(createTouchState(), 1, ACTION.FORWARD);
    assert.ok(Object.isFrozen(s) && Object.isFrozen(s.pointers) && Object.isFrozen(s.pointers[0]));
    assert.throws(() => s.pointers.push({}), TypeError);
    assert.ok(Object.isFrozen(touchActions(s)));
  });
  test('état invalide : TypeError', () => {
    for (const bad of [null, undefined, 1, 'x', {}, { pointers: 'x' }]) {
      assert.throws(() => pressTouch(bad, 1, ACTION.FORWARD), TypeError);
      assert.throws(() => releaseTouch(bad, 1), TypeError);
      assert.throws(() => touchActions(bad), TypeError);
    }
  });
});

describe('sécurité touch-input : surface du module', () => {
  const code = readFileSync(new URL('../../src/game/touch-input.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  test('aucun réseau, stockage, HTML dynamique, eval ni DOM', () => {
    const forbidden = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|innerHTML|outerHTML|insertAdjacentHTML|eval|document|window|console)\b|document\.cookie|\bnew Function\b|import\(/;
    assert.doesNotMatch(code, forbidden);
  });
});
