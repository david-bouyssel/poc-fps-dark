// Tests unitaires de src/render/fruit-sprites.js, d'après le plan
// docs/design/fps-fruits-score.md (§3 API, §6 plan de tests).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FRUIT_SPRITE_KINDS, SPRITE_SIZE, generateFruitSprite } from '../../src/render/fruit-sprites.js';
import { FRUIT_TABLE } from '../../src/game/fruits.js';
import { PALETTE } from '../../src/render/palette.js';

const FRUIT_KEYS = ['fruitStrawberry', 'fruitSeed', 'fruitCherry', 'fruitPeach', 'fruitDragon', 'fruitLeaf', 'fruitStem'];

function alphaAt(img, x, y) {
  return img.data[(y * img.width + x) * 4 + 3];
}

describe('FRUIT_SPRITE_KINDS', () => {
  test('égal aux ids de FRUIT_TABLE, dans le même ordre, gelé', () => {
    assert.deepEqual([...FRUIT_SPRITE_KINDS], FRUIT_TABLE.map((k) => k.kind));
    assert.ok(Object.isFrozen(FRUIT_SPRITE_KINDS));
    assert.equal(SPRITE_SIZE, 32);
  });
});

describe('PALETTE fruit*', () => {
  test('clés fruit* du plan présentes, format #rrggbb', () => {
    for (const key of FRUIT_KEYS) {
      assert.match(PALETTE[key], /^#[0-9a-fA-F]{6}$/, key);
    }
    for (const [key, value] of Object.entries(PALETTE)) {
      if (key.startsWith('fruit')) assert.match(value, /^#[0-9a-fA-F]{6}$/, key);
    }
  });
});

describe('generateFruitSprite', () => {
  for (const kind of FRUIT_SPRITE_KINDS) {
    test(`${kind} : taille, RGBA, coins transparents, centre opaque, alpha binaire, gel`, () => {
      const img = generateFruitSprite(kind, PALETTE);
      assert.equal(img.width, SPRITE_SIZE);
      assert.equal(img.height, SPRITE_SIZE);
      assert.ok(img.data instanceof Uint8ClampedArray);
      assert.equal(img.data.length, SPRITE_SIZE * SPRITE_SIZE * 4);
      assert.ok(Object.isFrozen(img));
      const last = SPRITE_SIZE - 1;
      for (const [x, y] of [[0, 0], [last, 0], [0, last], [last, last]]) {
        assert.equal(alphaAt(img, x, y), 0, `coin (${x}, ${y})`);
      }
      const mid = SPRITE_SIZE / 2;
      const centre = [[mid - 1, mid - 1], [mid, mid - 1], [mid - 1, mid], [mid, mid]].map(([x, y]) => alphaAt(img, x, y));
      assert.ok(centre.includes(255), `centre transparent : ${centre}`);
      let opaque = 0;
      for (let i = 3; i < img.data.length; i += 4) {
        assert.ok(img.data[i] === 0 || img.data[i] === 255, `alpha intermédiaire ${img.data[i]}`);
        if (img.data[i] === 255) opaque++;
      }
      assert.ok(opaque > SPRITE_SIZE * SPRITE_SIZE * 0.1, `trop peu de pixels opaques : ${opaque}`);
    });
  }

  test('déterminisme', () => {
    for (const kind of FRUIT_SPRITE_KINDS) {
      assert.deepEqual(
        Array.from(generateFruitSprite(kind, PALETTE).data),
        Array.from(generateFruitSprite(kind, PALETTE).data),
        kind,
      );
    }
  });

  test('les quatre images sont distinctes', () => {
    const images = new Set(FRUIT_SPRITE_KINDS.map((k) => Buffer.from(generateFruitSprite(k, PALETTE).data).toString('base64')));
    assert.equal(images.size, 4);
  });

  test('taille personnalisée', () => {
    const img = generateFruitSprite('peach', PALETTE, 16);
    assert.equal(img.width, 16);
    assert.equal(img.height, 16);
    assert.equal(img.data.length, 16 * 16 * 4);
  });

  test('pixels opaques en couleurs de la palette fruit*', () => {
    const allowed = new Set(FRUIT_KEYS.map((k) => PALETTE[k].toLowerCase()));
    const hex = (v) => v.toString(16).padStart(2, '0');
    let inPalette = 0;
    let opaque = 0;
    const img = generateFruitSprite('strawberry', PALETTE);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] !== 255) continue;
      opaque++;
      if (allowed.has(`#${hex(img.data[i])}${hex(img.data[i + 1])}${hex(img.data[i + 2])}`)) inPalette++;
    }
    assert.ok(inPalette > 0, 'aucun pixel aux couleurs de la palette');
    assert.ok(opaque > 0);
  });

  test('espèce inconnue -> RangeError', () => {
    for (const kind of ['banana', '', 'STRAWBERRY', '__proto__', undefined, null, 3]) {
      assert.throws(() => generateFruitSprite(kind, PALETTE), RangeError, String(kind));
    }
  });

  test('couleur de palette invalide -> TypeError', () => {
    for (const bad of ['red', '#fff', '#gggggg', '', 'url(x)', 12]) {
      const palette = { ...PALETTE };
      for (const key of Object.keys(palette)) if (key.startsWith('fruit')) palette[key] = bad;
      for (const kind of FRUIT_SPRITE_KINDS) {
        assert.throws(() => generateFruitSprite(kind, palette), TypeError, `${kind} ${bad}`);
      }
    }
  });
});
