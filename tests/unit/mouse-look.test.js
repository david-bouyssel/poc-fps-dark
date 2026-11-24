// Plan docs/design/souris-pointer-lock.md §3 et §6 (unitaires 1 à 5) : rotation à la souris.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MOUSE_LOOK, mouseTurnDelta, accumulateTurn, applyMouseTurn } from '../../src/game/mouse-look.js';
import { normalizeAngle } from '../../src/game/player.js';
import { stepPlayer } from '../../src/game/movement.js';

const TAU = 2 * Math.PI;
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

/** Pièce 5 x 5 fermée (intérieur 3 x 3), pour stepPlayer. */
function room() {
  const width = 5;
  const height = 5;
  const tiles = new Uint8Array(width * height).fill(1);
  for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) tiles[y * width + x] = 0;
  return { width, height, tiles };
}

describe('MOUSE_LOOK', () => {
  test('gelé, valeurs du plan, positives et finies', () => {
    assert.ok(Object.isFrozen(MOUSE_LOOK));
    assert.equal(MOUSE_LOOK.sensitivity, 0.0025);
    assert.equal(MOUSE_LOOK.maxEventDelta, 300);
    assert.equal(MOUSE_LOOK.maxFrameTurn, Math.PI);
    for (const [key, value] of Object.entries(MOUSE_LOOK)) {
      assert.ok(Number.isFinite(value) && value > 0, key);
    }
  });
});

describe('mouseTurnDelta', () => {
  test('signe : droite -> positif, gauche -> négatif, 0 -> 0', () => {
    assert.ok(mouseTurnDelta(10) > 0);
    assert.ok(mouseTurnDelta(-10) < 0);
    assert.equal(mouseTurnDelta(0), 0);
  });

  test('valeur : movementX * sensitivity', () => {
    for (const px of [1, 7, 100, 299.5, -42]) close(mouseTurnDelta(px), px * MOUSE_LOOK.sensitivity);
    close(mouseTurnDelta(400, { maxEventDelta: 1000 }), 1); // 400 px ~ 1 rad
  });

  test('borne ±maxEventDelta par événement', () => {
    close(mouseTurnDelta(10000), 300 * MOUSE_LOOK.sensitivity);
    close(mouseTurnDelta(-10000), -300 * MOUSE_LOOK.sensitivity);
    close(mouseTurnDelta(300), 300 * MOUSE_LOOK.sensitivity);
  });

  test('NaN, Infinity, chaîne, undefined, null -> 0', () => {
    for (const v of [NaN, Infinity, -Infinity, '5', undefined, null, {}, true]) {
      assert.equal(mouseTurnDelta(v), 0, String(v));
    }
  });

  test('surcharge partielle d\'options', () => {
    close(mouseTurnDelta(10, { sensitivity: 0.01 }), 0.1);
    close(mouseTurnDelta(100, { maxEventDelta: 50 }), 50 * MOUSE_LOOK.sensitivity);
    close(mouseTurnDelta(100, {}), 100 * MOUSE_LOOK.sensitivity);
  });

  test('options invalides -> TypeError ou RangeError', () => {
    for (const bad of [null, 1, 'x', true]) assert.throws(() => mouseTurnDelta(1, bad), TypeError);
    for (const bad of [{ sensitivity: -1 }, { sensitivity: NaN }, { maxEventDelta: Infinity },
      { maxFrameTurn: '1' }]) {
      assert.throws(() => mouseTurnDelta(1, bad), RangeError);
    }
  });
});

describe('accumulateTurn', () => {
  test('somme', () => {
    close(accumulateTurn(0, 0.25), 0.25);
    close(accumulateTurn(0.25, -0.1), 0.15);
    close(accumulateTurn(accumulateTurn(0, 0.1), 0.15), 0.25);
  });

  test('borne ±maxFrameTurn', () => {
    assert.equal(accumulateTurn(3, 1), Math.PI);
    assert.equal(accumulateTurn(-3, -1), -Math.PI);
    assert.equal(accumulateTurn(0, 0.5, { maxFrameTurn: 0.2 }), 0.2);
  });

  test('delta non fini ignoré, pending non fini traité comme 0', () => {
    for (const v of [NaN, Infinity, -Infinity, undefined, '1']) {
      assert.equal(accumulateTurn(0.5, v), 0.5, String(v));
      close(accumulateTurn(v, 0.3), 0.3);
    }
  });

  test('options invalides -> erreurs', () => {
    assert.throws(() => accumulateTurn(0, 1, 5), TypeError);
    assert.throws(() => accumulateTurn(0, 1, { maxFrameTurn: -1 }), RangeError);
  });
});

describe('applyMouseTurn', () => {
  test('x et y inchangés, angle = normalizeAngle(angle + turn)', () => {
    const p = Object.freeze({ x: 2.5, y: 1.25, angle: 1 });
    const out = applyMouseTurn(p, 0.5);
    assert.equal(out.x, 2.5);
    assert.equal(out.y, 1.25);
    close(out.angle, normalizeAngle(1.5));
  });

  test('angle dans [0, 2π), passage par 0 dans les deux sens', () => {
    const up = applyMouseTurn({ x: 1, y: 1, angle: TAU - 0.1 }, 0.3);
    close(up.angle, 0.2, 1e-9);
    const down = applyMouseTurn({ x: 1, y: 1, angle: 0.1 }, -0.3);
    close(down.angle, TAU - 0.2, 1e-9);
    for (const a of [up.angle, down.angle]) assert.ok(a >= 0 && a < TAU);
  });

  test('résultat gelé', () => {
    assert.ok(Object.isFrozen(applyMouseTurn({ x: 1, y: 1, angle: 0 }, 0.1)));
  });

  test('même référence pour 0 et pour une valeur non finie', () => {
    const p = Object.freeze({ x: 1, y: 1, angle: 0.5 });
    for (const v of [0, -0, NaN, Infinity, -Infinity, undefined, '1']) {
      assert.equal(applyMouseTurn(p, v), p, String(v));
    }
  });

  test('joueur mal formé -> TypeError', () => {
    for (const bad of [null, undefined, 1, {}, { x: 1, y: 1 }, { x: NaN, y: 1, angle: 0 },
      { x: 1, y: Infinity, angle: 0 }, { x: 1, y: 1, angle: '0' }]) {
      assert.throws(() => applyMouseTurn(bad, 0.1), TypeError);
    }
  });

  test('pureté : le joueur d\'entrée n\'est pas modifié', () => {
    const p = { x: 1.5, y: 1.5, angle: 0.3 };
    const out = applyMouseTurn(p, 1);
    assert.deepEqual(p, { x: 1.5, y: 1.5, angle: 0.3 });
    assert.notEqual(out, p);
  });
});

test('cohérence de sens : mouseTurnDelta(+100) tourne comme stepPlayer avec turn: 1', () => {
  const p = Object.freeze({ x: 2.5, y: 2.5, angle: 1 });
  const mouse = applyMouseTurn(p, mouseTurnDelta(100));
  const keys = stepPlayer(p, { move: 0, strafe: 0, turn: 1, run: false }, 0.05, room());
  assert.ok(mouse.angle > p.angle);
  assert.ok(keys.angle > p.angle);
  const left = applyMouseTurn(p, mouseTurnDelta(-100));
  const keysLeft = stepPlayer(p, { move: 0, strafe: 0, turn: -1, run: false }, 0.05, room());
  assert.ok(left.angle < p.angle && keysLeft.angle < p.angle);
});
