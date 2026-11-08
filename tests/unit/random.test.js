import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, randomInt, MAX_SEED } from '../../src/maze/random.js';

function sequence(seed, n) {
  const rng = createRng(seed);
  const out = [];
  for (let i = 0; i < n; i++) out.push(rng());
  return out;
}

test('MAX_SEED vaut 0xFFFFFFFF', () => {
  assert.equal(MAX_SEED, 0xFFFFFFFF);
});

test('même graine -> même suite de 1000 valeurs', () => {
  assert.deepEqual(sequence(12345, 1000), sequence(12345, 1000));
});

test('graines différentes -> suites différentes', () => {
  assert.notDeepEqual(sequence(1, 100), sequence(2, 100));
});

test('valeurs dans [0, 1) sur 10 000 tirages', () => {
  const rng = createRng(987654321);
  for (let i = 0; i < 10000; i++) {
    const v = rng();
    assert.equal(typeof v, 'number');
    assert.ok(v >= 0 && v < 1, `valeur hors [0,1) : ${v}`);
  }
});

test('graines limites acceptées : 0 et MAX_SEED', () => {
  for (const seed of [0, MAX_SEED]) {
    const rng = createRng(seed);
    const v = rng();
    assert.ok(v >= 0 && v < 1);
  }
});

test('graines invalides rejetées (TypeError ou RangeError)', () => {
  const bad = [-1, MAX_SEED + 1, 1.5, NaN, Infinity, '42', undefined, null];
  for (const seed of bad) {
    assert.throws(
      () => createRng(seed),
      (err) => err instanceof TypeError || err instanceof RangeError,
      `graine ${String(seed)} devrait être rejetée`,
    );
  }
});

test('randomInt : entiers dans [0, n)', () => {
  const rng = createRng(42);
  for (const n of [2, 3, 7, 100]) {
    for (let i = 0; i < 2000; i++) {
      const v = randomInt(rng, n);
      assert.ok(Number.isInteger(v), `non entier : ${v}`);
      assert.ok(v >= 0 && v < n, `hors [0,${n}) : ${v}`);
    }
  }
});

test('randomInt : toutes les valeurs de [0, n) atteintes', () => {
  const rng = createRng(7);
  const seen = new Set();
  for (let i = 0; i < 1000; i++) seen.add(randomInt(rng, 4));
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test('randomInt : n = 1 renvoie toujours 0', () => {
  const rng = createRng(99);
  for (let i = 0; i < 500; i++) assert.equal(randomInt(rng, 1), 0);
});

test('randomInt : n invalide rejeté', () => {
  const rng = createRng(1);
  for (const n of [0, -1, -5, 1.5, NaN]) {
    assert.throws(
      () => randomInt(rng, n),
      (err) => err instanceof TypeError || err instanceof RangeError,
      `n = ${n} devrait être rejeté`,
    );
  }
});
