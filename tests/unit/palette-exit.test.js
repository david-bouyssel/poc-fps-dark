// Plan docs/design/dark-sortie-victoire.md §3.5 et §6 : clés de palette de la sortie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE } from '../../src/render/palette.js';

const EXIT_KEYS = ['exitFrame', 'exitGlow', 'exitCore', 'automapExit', 'topExit'];

test('clés exit*, automapExit, topExit présentes au format #rrggbb', () => {
  for (const key of EXIT_KEYS) {
    assert.equal(typeof PALETTE[key], 'string', `clé manquante : ${key}`);
    assert.match(PALETTE[key], /^#[0-9a-f]{6}$/i, key);
  }
});

test('cadre, lueur et cœur de la porte : trois couleurs distinctes', () => {
  const colors = new Set(['exitFrame', 'exitGlow', 'exitCore'].map((k) => PALETTE[k].toLowerCase()));
  assert.equal(colors.size, 3);
});

test('marqueurs de sortie distincts du sol de leur vue', () => {
  assert.notEqual(PALETTE.automapExit.toLowerCase(), PALETTE.automapFloor.toLowerCase());
  assert.notEqual(PALETTE.topExit.toLowerCase(), PALETTE.floor.toLowerCase());
});
