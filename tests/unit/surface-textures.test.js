// Tests d'après docs/design/fps-sol-plafond-textures.md §6.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  SURFACE_TEXTURE,
  SURFACE_SCALE,
  MAX_SURFACE_PIXELS,
  generateSurfaceTexture,
  surfaceBufferSize,
  surfaceRowDistance,
  castSurfaces,
} from '../../src/render/surface-textures.js';
import { TEXTURE_SIZE } from '../../src/render/wall-textures.js';
import { projectColumn, fogFactor } from '../../src/render/raycaster.js';
import { PALETTE } from '../../src/render/palette.js';

const HEX = /^#[0-9a-f]{6}$/;
const FLOOR_KEYS = ['floorBase', 'floorAlt', 'floorGrout'];
const CEILING_KEYS = ['ceilingBase', 'ceilingLine', 'ceilingStar'];

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function pixelAt(tex, x, y) {
  const i = (y * tex.width + x) * 4;
  return [tex.data[i], tex.data[i + 1], tex.data[i + 2], tex.data[i + 3]];
}
function pixelKeys(tex) {
  const set = new Set();
  for (let i = 0; i < tex.data.length; i += 4) {
    set.add(`${tex.data[i]},${tex.data[i + 1]},${tex.data[i + 2]}`);
  }
  return set;
}
function rgbKey(hex) {
  return hexToRgb(hex).join(',');
}
function solid(size, rgb) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return Object.freeze({ width: size, height: size, data });
}
function near(a, b, tol = 1) {
  return Math.abs(a - b) <= tol;
}

describe('PALETTE sol/plafond', () => {
  test('6 clés floor*/ceiling* au format #rrggbb', () => {
    for (const k of [...FLOOR_KEYS, ...CEILING_KEYS]) {
      assert.match(PALETTE[k], HEX, k);
    }
  });
  test('clés existantes inchangées', () => {
    for (const k of ['sky', 'skyHorizon', 'ground', 'fog']) {
      assert.match(PALETTE[k], HEX, k);
    }
  });
});

describe('generateSurfaceTexture', () => {
  for (const kind of [SURFACE_TEXTURE.FLOOR, SURFACE_TEXTURE.CEILING]) {
    test(`${kind} : forme, alpha 255, gelé, déterministe`, () => {
      const a = generateSurfaceTexture(kind, PALETTE);
      const b = generateSurfaceTexture(kind, PALETTE);
      assert.equal(a.width, 32);
      assert.equal(a.height, 32);
      assert.equal(TEXTURE_SIZE, 32);
      assert.ok(a.data instanceof Uint8ClampedArray);
      assert.equal(a.data.length, 32 * 32 * 4);
      assert.ok(Object.isFrozen(a));
      for (let i = 3; i < a.data.length; i += 4) assert.equal(a.data[i], 255);
      assert.deepEqual(Array.from(a.data), Array.from(b.data));
    });
  }

  test('sol : uniquement les couleurs floor*, toutes présentes', () => {
    const t = generateSurfaceTexture(SURFACE_TEXTURE.FLOOR, PALETTE);
    const expected = new Set(FLOOR_KEYS.map((k) => rgbKey(PALETTE[k])));
    assert.deepEqual(pixelKeys(t), expected);
  });

  test('plafond : uniquement les couleurs ceiling*, toutes présentes', () => {
    const t = generateSurfaceTexture(SURFACE_TEXTURE.CEILING, PALETTE);
    const expected = new Set(CEILING_KEYS.map((k) => rgbKey(PALETTE[k])));
    assert.deepEqual(pixelKeys(t), expected);
  });

  test('sol et plafond diffèrent', () => {
    const f = generateSurfaceTexture(SURFACE_TEXTURE.FLOOR, PALETTE);
    const c = generateSurfaceTexture(SURFACE_TEXTURE.CEILING, PALETTE);
    assert.notDeepEqual(Array.from(f.data), Array.from(c.data));
  });

  test('sol : ligne 0 et colonne 0 = floorGrout', () => {
    const t = generateSurfaceTexture(SURFACE_TEXTURE.FLOOR, PALETTE);
    const g = hexToRgb(PALETTE.floorGrout);
    for (let i = 0; i < 32; i++) {
      assert.deepEqual(pixelAt(t, i, 0).slice(0, 3), g, `ligne 0 x=${i}`);
      assert.deepEqual(pixelAt(t, 0, i).slice(0, 3), g, `colonne 0 y=${i}`);
    }
  });

  test('plafond : ligne 0 et colonne 0 = ceilingLine', () => {
    const t = generateSurfaceTexture(SURFACE_TEXTURE.CEILING, PALETTE);
    const g = hexToRgb(PALETTE.ceilingLine);
    for (let i = 0; i < 32; i++) {
      assert.deepEqual(pixelAt(t, i, 0).slice(0, 3), g, `ligne 0 x=${i}`);
      assert.deepEqual(pixelAt(t, 0, i).slice(0, 3), g, `colonne 0 y=${i}`);
    }
  });

  test('palette surchargée : nouvelle couleur présente, ancienne absente', () => {
    const star = '#123456';
    const t = generateSurfaceTexture(SURFACE_TEXTURE.CEILING, { ...PALETTE, ceilingStar: star });
    const keys = pixelKeys(t);
    assert.ok(keys.has(rgbKey(star)));
    assert.ok(!keys.has(rgbKey(PALETTE.ceilingStar)));
  });

  test('size valides : 8, 16, 64', () => {
    for (const size of [8, 16, 64]) {
      for (const kind of [SURFACE_TEXTURE.FLOOR, SURFACE_TEXTURE.CEILING]) {
        const t = generateSurfaceTexture(kind, PALETTE, size);
        assert.equal(t.width, size);
        assert.equal(t.height, size);
        assert.equal(t.data.length, size * size * 4);
      }
    }
  });

  test('size invalides -> RangeError', () => {
    for (const size of [0, 7, 12, 264, 1.5, NaN]) {
      assert.throws(() => generateSurfaceTexture('floor', PALETTE, size), RangeError, String(size));
    }
  });

  test('kind inconnu -> RangeError', () => {
    assert.throws(() => generateSurfaceTexture('wall', PALETTE), RangeError);
    assert.throws(() => generateSurfaceTexture('', PALETTE), RangeError);
  });

  test('palette absente ou couleur mal formée -> TypeError', () => {
    assert.throws(() => generateSurfaceTexture('floor', undefined), TypeError);
    assert.throws(() => generateSurfaceTexture('floor', null), TypeError);
    assert.throws(() => generateSurfaceTexture('floor', { ...PALETTE, floorBase: 'red' }), TypeError);
    assert.throws(() => generateSurfaceTexture('floor', { ...PALETTE, floorAlt: '#fff' }), TypeError);
    assert.throws(() => generateSurfaceTexture('ceiling', { ...PALETTE, ceilingBase: 'red' }), TypeError);
    assert.throws(() => generateSurfaceTexture('ceiling', { ...PALETTE, ceilingStar: '#fff' }), TypeError);
  });
});

describe('surfaceBufferSize', () => {
  test('constantes du plan', () => {
    assert.equal(SURFACE_SCALE, 2);
    assert.equal(MAX_SURFACE_PIXELS, 230400);
  });
  test('1280x720 : borné et ratio ~16/9', () => {
    const { width, height } = surfaceBufferSize(1280, 720);
    assert.ok(Number.isInteger(width) && Number.isInteger(height));
    assert.ok(width * height <= MAX_SURFACE_PIXELS);
    assert.ok(Math.abs(width / height - 16 / 9) <= 0.05);
  });
  test('grande vue : toujours borné', () => {
    const { width, height } = surfaceBufferSize(3840, 2160);
    assert.ok(width * height <= MAX_SURFACE_PIXELS);
    assert.ok(width >= 1 && height >= 1);
  });
  test('320x240 -> 160x120', () => {
    assert.deepEqual(surfaceBufferSize(320, 240), { width: 160, height: 120 });
  });
  test('entrées dégénérées -> entiers >= 1, sans exception', () => {
    for (const [w, h] of [[0, 0], [NaN, NaN], [Infinity, Infinity], [-5, 10], [NaN, 100]]) {
      const r = surfaceBufferSize(w, h);
      assert.ok(Number.isInteger(r.width) && r.width >= 1, `${w},${h}`);
      assert.ok(Number.isInteger(r.height) && r.height >= 1, `${w},${h}`);
      assert.ok(r.width * r.height <= MAX_SURFACE_PIXELS);
    }
  });
});

describe('surfaceRowDistance', () => {
  test('height 100 : rows 99 et 0 symétriques', () => {
    const expected = 100 / (2 * 49.5);
    assert.ok(near(surfaceRowDistance(99, 100), expected, 1e-12));
    assert.ok(near(surfaceRowDistance(0, 100), expected, 1e-12));
  });
  test('décroissance stricte en s\'éloignant de l\'horizon', () => {
    const h = 100;
    for (let r = h / 2; r < h - 1; r++) {
      assert.ok(surfaceRowDistance(r + 1, h) < surfaceRowDistance(r, h), `bas ${r}`);
    }
    for (let r = 0; r < h / 2 - 1; r++) {
      assert.ok(surfaceRowDistance(r, h) < surfaceRowDistance(r + 1, h), `haut ${r}`);
    }
  });
  test('finie et > 0 pour hauteurs paires et impaires', () => {
    for (const h of [1, 2, 3, 100, 101]) {
      for (let r = 0; r < h; r++) {
        const d = surfaceRowDistance(r, h);
        assert.ok(Number.isFinite(d) && d > 0, `h=${h} r=${r}`);
      }
    }
  });
  test('cohérent avec projectColumn', () => {
    const h = 100;
    for (const d of [1.5, 3, 5, 8]) {
      const { bottom } = projectColumn(d, h);
      let best = 50;
      for (let r = 50; r < h; r++) {
        if (Math.abs(surfaceRowDistance(r, h) - d) < Math.abs(surfaceRowDistance(best, h) - d)) best = r;
      }
      assert.ok(Math.abs(best - bottom) <= 1.5, `d=${d} best=${best} bottom=${bottom}`);
    }
  });
});

describe('castSurfaces', () => {
  const textures = {
    floor: generateSurfaceTexture('floor', PALETTE),
    ceiling: generateSurfaceTexture('ceiling', PALETTE),
  };
  const player = { x: 2.5, y: 2.5, angle: 0 };
  const FOG = '#000000';

  function run(width, height, p = player, tex = textures, fog = PALETTE.fog) {
    const target = new Uint8ClampedArray(width * height * 4);
    castSurfaces(target, width, height, p, tex, fog);
    return target;
  }

  test('remplit tout : alpha 255 partout', () => {
    const t = run(16, 12);
    for (let i = 3; i < t.length; i += 4) assert.equal(t[i], 255, `i=${i}`);
  });

  test('déterministe', () => {
    const a = run(16, 12, { x: 3.3, y: 1.7, angle: 0.9 });
    const b = run(16, 12, { x: 3.3, y: 1.7, angle: 0.9 });
    assert.deepEqual(Array.from(a), Array.from(b));
  });

  test('haut = plafond, bas = sol (couleurs unies + brouillard)', () => {
    const tex = { floor: solid(32, [200, 100, 50]), ceiling: solid(32, [50, 100, 200]) };
    const w = 6;
    const h = 20;
    const t = run(w, h, player, tex, FOG);
    for (let row = 0; row < h; row++) {
      const f = fogFactor(surfaceRowDistance(row, h));
      const src = row < h / 2 ? [50, 100, 200] : [200, 100, 50];
      for (let x = 0; x < w; x++) {
        const i = (row * w + x) * 4;
        for (let c = 0; c < 3; c++) {
          assert.ok(near(t[i + c], src[c] * (1 - f), 1), `row=${row} x=${x} c=${c}: ${t[i + c]}`);
        }
      }
    }
  });

  test('brouillard : horizon plus proche de fog que dernière ligne', () => {
    const tex = { floor: solid(32, [255, 255, 255]), ceiling: solid(32, [255, 255, 255]) };
    const w = 4;
    const h = 40;
    const t = run(w, h, player, tex, FOG);
    const at = (row) => t[row * w * 4];
    assert.ok(at(h / 2) < at(h - 1), 'sol');
    assert.ok(at(h / 2 - 1) < at(0), 'plafond');
  });

  test('fog égal aux couleurs -> sortie uniforme', () => {
    const c = [120, 130, 140];
    const tex = { floor: solid(32, c), ceiling: solid(32, c) };
    const t = run(8, 10, { x: 1.2, y: 3.4, angle: 2 }, tex, '#78828c');
    for (let i = 0; i < t.length; i += 4) {
      assert.ok(near(t[i], c[0]) && near(t[i + 1], c[1]) && near(t[i + 2], c[2]), `i=${i}`);
      assert.equal(t[i + 3], 255);
    }
  });

  test('mapping : pixel central, dernière ligne -> texel attendu', () => {
    const size = 32;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        const i = (ty * size + tx) * 4;
        data[i] = tx * 8;
        data[i + 1] = ty * 8;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
    const tex = { floor: Object.freeze({ width: size, height: size, data }), ceiling: solid(size, [0, 0, 0]) };
    const w = 9;
    const h = 100;
    const t = run(w, h, player, tex, FOG);
    const d = surfaceRowDistance(h - 1, h);
    const f = fogFactor(d);
    const wx = 2.5 + d;
    const wy = 2.5;
    const tx = Math.min(size - 1, Math.floor((wx - Math.floor(wx)) * size));
    const ty = Math.min(size - 1, Math.floor((wy - Math.floor(wy)) * size));
    const i = ((h - 1) * w + 4) * 4;
    assert.ok(near(t[i], tx * 8 * (1 - f), 1), `R ${t[i]} vs tx=${tx}`);
    assert.ok(near(t[i + 1], ty * 8 * (1 - f), 1), `G ${t[i + 1]} vs ty=${ty}`);
  });

  test('invariance par translation entière', () => {
    const a = run(16, 12, { x: 2.5, y: 2.25, angle: 0.7 });
    const b = run(16, 12, { x: 3.5, y: 5.25, angle: 0.7 });
    assert.deepEqual(Array.from(a), Array.from(b));
  });

  test('aucun NaN écrit, valeurs dans [0, 255]', () => {
    const t = run(16, 12, { x: 0.1, y: 7.9, angle: -3 });
    for (const v of t) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
  });

  test('erreurs de type -> TypeError', () => {
    const ok = () => new Uint8ClampedArray(4 * 4 * 4);
    assert.throws(() => castSurfaces(new Uint8ClampedArray(10), 4, 4, player, textures, PALETTE.fog), TypeError);
    assert.throws(() => castSurfaces(ok(), 4, 4, { x: NaN, y: 1, angle: 0 }, textures, PALETTE.fog), TypeError);
    assert.throws(() => castSurfaces(ok(), 4, 4, { x: 1, y: 1, angle: Infinity }, textures, PALETTE.fog), TypeError);
    assert.throws(() => castSurfaces(ok(), 4, 4, null, textures, PALETTE.fog), TypeError);
    const small = generateSurfaceTexture('ceiling', PALETTE, 16);
    assert.throws(
      () => castSurfaces(ok(), 4, 4, player, { floor: textures.floor, ceiling: small }, PALETTE.fog),
      TypeError,
    );
    assert.throws(() => castSurfaces(ok(), 4, 4, player, textures, 'red'), TypeError);
  });

  test('erreurs de plage -> RangeError', () => {
    assert.throws(() => castSurfaces(new Uint8ClampedArray(0), 0, 4, player, textures, PALETTE.fog), RangeError);
    assert.throws(
      () => castSurfaces(new Uint8ClampedArray(24), 1.5, 4, player, textures, PALETTE.fog),
      RangeError,
    );
    const target = new Uint8ClampedArray(4 * 4 * 4);
    assert.throws(() => castSurfaces(target, 4, 4, player, textures, PALETTE.fog, 0), RangeError);
    assert.throws(() => castSurfaces(target, 4, 4, player, textures, PALETTE.fog, Math.PI), RangeError);
  });
});
