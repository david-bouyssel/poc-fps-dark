// Tests unitaires de l'indicateur de danger (plan docs/design/indicateur-danger.md) :
// dangerLevel est linéaire entre nearDistance (niveau 1) et farDistance (niveau 0), borné
// dans [0, 1], Infinity -> 0, erreurs TypeError / RangeError, et module pur (sans import).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dangerLevel, DANGER } from '../../src/game/danger.js';

describe('dangerLevel : réglages par défaut', () => {
  test('DANGER : near 2, far 12 (gel)', () => {
    assert.equal(DANGER.nearDistance, 2);
    assert.equal(DANGER.farDistance, 12);
    assert.ok(Object.isFrozen(DANGER));
  });
});

describe('dangerLevel : bornes', () => {
  test('d >= 12 (far) -> 0, y compris au-delà', () => {
    assert.equal(dangerLevel(12), 0);
    assert.equal(dangerLevel(13), 0);
    assert.equal(dangerLevel(100), 0);
  });

  test('d <= 2 (near) -> 1, y compris 0', () => {
    assert.equal(dangerLevel(2), 1);
    assert.equal(dangerLevel(1), 1);
    assert.equal(dangerLevel(0), 1);
  });

  test('Infinity (monstre inatteignable) -> 0', () => {
    assert.equal(dangerLevel(Infinity), 0);
  });

  test('résultat toujours dans [0, 1]', () => {
    for (let d = 0; d <= 30; d += 0.5) {
      const level = dangerLevel(d);
      assert.ok(level >= 0 && level <= 1, `d=${d} -> ${level}`);
    }
  });
});

describe('dangerLevel : linéarité et monotonie', () => {
  test('milieu : d = 7 -> 0.5', () => {
    assert.equal(dangerLevel(7), 0.5);
  });

  test('linéaire : d = 4 -> 0.8 et d = 10 -> 0.2', () => {
    assert.ok(Math.abs(dangerLevel(4) - 0.8) < 1e-12);
    assert.ok(Math.abs(dangerLevel(10) - 0.2) < 1e-12);
  });

  test('monotone décroissant de 0 à 14 tuiles', () => {
    let previous = Infinity;
    for (let d = 0; d <= 14; d += 0.25) {
      const level = dangerLevel(d);
      assert.ok(level <= previous, `non monotone en d=${d}`);
      previous = level;
    }
  });
});

describe('dangerLevel : options', () => {
  test('surcharge partielle : near 4, far 8 -> d = 6 donne 0.5', () => {
    assert.equal(dangerLevel(6, { nearDistance: 4, farDistance: 8 }), 0.5);
  });

  test('surcharge partielle : seul farDistance change (far 20, d = 11 -> 0.5)', () => {
    assert.equal(dangerLevel(11, { farDistance: 20 }), 0.5);
  });

  test('options undefined : défaut', () => {
    assert.equal(dangerLevel(7, undefined), 0.5);
  });

  test('clé inconnue ignorée', () => {
    assert.equal(dangerLevel(7, { foo: 3 }), 0.5);
  });
});

describe('dangerLevel : erreurs', () => {
  test('TypeError : NaN', () => {
    assert.throws(() => dangerLevel(NaN), TypeError);
  });

  test('TypeError : chaîne', () => {
    assert.throws(() => dangerLevel('3'), TypeError);
  });

  test('TypeError : undefined et null', () => {
    assert.throws(() => dangerLevel(undefined), TypeError);
    assert.throws(() => dangerLevel(null), TypeError);
  });

  test('RangeError : distance négative', () => {
    assert.throws(() => dangerLevel(-1), RangeError);
  });

  test('RangeError : near >= far', () => {
    assert.throws(() => dangerLevel(5, { nearDistance: 12, farDistance: 12 }), RangeError);
    assert.throws(() => dangerLevel(5, { nearDistance: 13, farDistance: 12 }), RangeError);
  });

  test('RangeError : option négative ou non finie', () => {
    assert.throws(() => dangerLevel(5, { nearDistance: -1 }), RangeError);
    assert.throws(() => dangerLevel(5, { farDistance: Infinity }), RangeError);
  });

  test('TypeError : options non objet', () => {
    assert.throws(() => dangerLevel(5, 'x'), TypeError);
  });
});

describe('danger.js : module pur', () => {
  test('aucun import (ni DOM, ni navigateur, ni autre module du projet)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../src/game/danger.js', import.meta.url)),
      'utf8',
    );
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|requestAnimationFrame|performance\./);
  });
});
