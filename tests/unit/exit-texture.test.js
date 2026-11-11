// Plan docs/design/dark-sortie-victoire.md §3.4 et §6 (exit-texture.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT_FOG_SCALE, generateExitTexture, isExitFace } from '../../src/render/exit-texture.js';
import { TEXTURE_SIZE } from '../../src/render/wall-textures.js';
import { PALETTE } from '../../src/render/palette.js';

const palette = { exitFrame: '#102030', exitGlow: '#a0b0c0', exitCore: '#f0e0d0' };

const hex = (data, i) => `#${[0, 1, 2].map((k) => data[i + k].toString(16).padStart(2, '0')).join('')}`;
const pixel = (tex, x, y) => hex(tex.data, (y * tex.width + x) * 4);

describe('generateExitTexture', () => {
  test('EXIT_FOG_SCALE = 0.35', () => {
    assert.equal(EXIT_FOG_SCALE, 0.35);
  });

  test('dimensions par défaut TEXTURE_SIZE, alpha 255, objet gelé', () => {
    const tex = generateExitTexture(palette);
    assert.equal(tex.width, TEXTURE_SIZE);
    assert.equal(tex.height, TEXTURE_SIZE);
    assert.equal(tex.data.length, TEXTURE_SIZE * TEXTURE_SIZE * 4);
    assert.ok(Object.isFrozen(tex));
    for (let i = 3; i < tex.data.length; i += 4) assert.equal(tex.data[i], 255);
  });

  for (const size of [8, 32, 64]) {
    test(`taille ${size} : uniquement les 3 couleurs, cadre, centre, symétrie, bandes verticales`, () => {
      const tex = generateExitTexture(palette, size);
      assert.equal(tex.width, size);
      assert.equal(tex.height, size);
      const allowed = new Set([palette.exitFrame, palette.exitGlow, palette.exitCore]);
      const seen = new Set();
      for (let i = 0; i < tex.data.length; i += 4) {
        const c = hex(tex.data, i);
        assert.ok(allowed.has(c), `couleur hors palette ${c}`);
        seen.add(c);
      }
      // En 8, l'intérieur ne fait que 2 texels (6 de cadre) : symétrie -> une seule bande.
      if (size >= 16) assert.equal(seen.size, 3, 'les 3 couleurs doivent apparaître');

      // Cadre de 3 texels : gauche, droite, haut.
      for (let y = 0; y < size; y++) {
        for (let k = 0; k < 3; k++) {
          assert.equal(pixel(tex, k, y), palette.exitFrame, `gauche (${k}, ${y})`);
          assert.equal(pixel(tex, size - 1 - k, y), palette.exitFrame, `droite (${size - 1 - k}, ${y})`);
        }
      }
      for (let x = 0; x < size; x++) {
        for (let k = 0; k < 3; k++) assert.equal(pixel(tex, x, k), palette.exitFrame, `haut (${x}, ${k})`);
      }
      // Pas de cadre en bas : l'intérieur descend jusqu'à la dernière ligne.
      assert.notEqual(pixel(tex, size / 2, size - 1), palette.exitFrame);

      // Centre en exitCore, première bande intérieure en exitGlow.
      assert.equal(pixel(tex, size / 2, size - 1), palette.exitCore);
      assert.equal(pixel(tex, size / 2 - 1, size - 1), palette.exitCore);
      if (size >= 16) {
        assert.equal(pixel(tex, 3, size - 1), palette.exitGlow);
        assert.equal(pixel(tex, size - 4, size - 1), palette.exitGlow);
      }

      // Intérieur : symétrique gauche/droite, bandes verticales (constantes sous le cadre).
      for (let y = 3; y < size; y++) {
        for (let x = 0; x < size; x++) {
          assert.equal(pixel(tex, x, y), pixel(tex, size - 1 - x, y), `symétrie (${x}, ${y})`);
          assert.equal(pixel(tex, x, y), pixel(tex, x, size - 1), `bande verticale (${x}, ${y})`);
        }
      }
    });
  }

  test('déterministe', () => {
    assert.deepEqual(generateExitTexture(palette).data, generateExitTexture(palette).data);
  });

  test('fonctionne avec PALETTE', () => {
    assert.doesNotThrow(() => generateExitTexture(PALETTE));
  });

  test('RangeError size invalide', () => {
    for (const size of [0, 4, 7, 12, 264, 1.5, -8, NaN, Infinity]) {
      assert.throws(() => generateExitTexture(palette, size), RangeError, String(size));
    }
  });

  test('TypeError palette absente ou couleur non #rrggbb', () => {
    for (const p of [null, undefined, 'red']) {
      assert.throws(() => generateExitTexture(p), TypeError, String(p));
    }
    for (const key of ['exitFrame', 'exitGlow', 'exitCore']) {
      for (const bad of [undefined, '#fff', 'red', '#12345g', 0x123456]) {
        assert.throws(() => generateExitTexture({ ...palette, [key]: bad }), TypeError, `${key}=${bad}`);
      }
    }
  });
});

describe('isExitFace', () => {
  const exit = Object.freeze({ tx: 3, ty: 3 });
  const inside = Object.freeze({ x: 3.5, y: 3.5 });

  test('les 4 faces autour de la sortie, vues depuis la sortie -> true', () => {
    assert.equal(isExitFace({ side: 'x', tileX: 4, tileY: 3 }, inside, exit), true, 'est');
    assert.equal(isExitFace({ side: 'x', tileX: 2, tileY: 3 }, inside, exit), true, 'ouest');
    assert.equal(isExitFace({ side: 'y', tileX: 3, tileY: 4 }, inside, exit), true, 'sud');
    assert.equal(isExitFace({ side: 'y', tileX: 3, tileY: 2 }, inside, exit), true, 'nord');
  });

  test('face d\'un mur adjacent vue depuis le couloir (même côté que la sortie) -> true', () => {
    // Joueur à l'ouest de la sortie, dans la même rangée, qui regarde le mur est de la sortie.
    assert.equal(isExitFace({ side: 'x', tileX: 4, tileY: 3 }, { x: 1.5, y: 3.5 }, exit), true);
  });

  test('face opposée d\'un mur partagé, vue depuis la cellule voisine -> false', () => {
    // Mur fin (4, 3) entre la sortie (3, 3) et la cellule voisine (5, 3).
    assert.equal(isExitFace({ side: 'x', tileX: 4, tileY: 3 }, { x: 5.5, y: 3.5 }, exit), false, 'est');
    assert.equal(isExitFace({ side: 'x', tileX: 2, tileY: 3 }, { x: 1.5, y: 3.5 }, exit), false, 'ouest');
    assert.equal(isExitFace({ side: 'y', tileX: 3, tileY: 4 }, { x: 3.5, y: 5.5 }, exit), false, 'sud');
    assert.equal(isExitFace({ side: 'y', tileX: 3, tileY: 2 }, { x: 3.5, y: 1.5 }, exit), false, 'nord');
  });

  test('tuile non adjacente ou mauvais côté -> false', () => {
    assert.equal(isExitFace({ side: 'x', tileX: 5, tileY: 3 }, inside, exit), false);
    assert.equal(isExitFace({ side: 'x', tileX: 4, tileY: 4 }, inside, exit), false);
    assert.equal(isExitFace({ side: 'y', tileX: 4, tileY: 3 }, inside, exit), false, 'side y sur un voisin x');
    assert.equal(isExitFace({ side: 'x', tileX: 3, tileY: 4 }, inside, exit), false, 'side x sur un voisin y');
  });

  test('exit null / mal formé ou hit mal formé -> false sans exception', () => {
    const hit = { side: 'x', tileX: 4, tileY: 3 };
    for (const e of [null, undefined, {}, { tx: NaN, ty: 3 }, { tx: '3', ty: 3 }, 42]) {
      assert.equal(isExitFace(hit, inside, e), false, JSON.stringify(e));
    }
    for (const h of [null, undefined, {}, { side: 'z', tileX: 4, tileY: 3 }, { side: 'x', tileX: NaN, tileY: 3 }]) {
      assert.equal(isExitFace(h, inside, exit), false, JSON.stringify(h));
    }
    assert.doesNotThrow(() => isExitFace(hit, null, exit));
  });
});
