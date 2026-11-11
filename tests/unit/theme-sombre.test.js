// Tests du thème sombre (docs/design/dark-theme-sombre.md) : valeurs de la palette ciblée,
// luminance, contraste WCAG, cohérence avec styles.css, brouillard noir à distance >= 6 cases
// (murs, sol, plafond), plafond sans étoile.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PALETTE } from '../../src/render/palette.js';
import { fogFactor, mixColor } from '../../src/render/raycaster.js';
import {
  SURFACE_TEXTURE, generateSurfaceTexture, castSurfaces, surfaceRowDistance,
} from '../../src/render/surface-textures.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const CSS_PATH = fileURLToPath(new URL('../../src/styles.css', import.meta.url));
const RENDER_DIR = fileURLToPath(new URL('../../src/render/', import.meta.url));
const MAIN_PATH = fileURLToPath(new URL('../../src/main.js', import.meta.url));
const css = readFileSync(CSS_PATH, 'utf8');

/** Valeurs de la section « Palette ciblée » du plan dark-theme-sombre.md. */
const PLAN_PALETTE = Object.freeze({
  background: '#120e16',
  floor: '#1c1620',
  ground: '#1c1620',
  wall: '#4a4650',
  wallLight: '#4a4650',
  wallDark: '#37343c',
  sky: '#0a0810',
  skyHorizon: '#17101c',
  fog: '#000000',
  textureBase: '#4a4650',
  textureBrickAlt: '#3d3a44',
  textureMortar: '#26232b',
  texturePlankAlt: '#413d48',
  textureGroove: '#2e2b34',
  textureDot: '#5a2a30',
  textureHeart: '#6b1f2a',
  floorBase: '#1c1620',
  floorAlt: '#241d29',
  floorGrout: '#0f0b13',
  ceilingBase: '#0e0b13',
  ceilingLine: '#1a1521',
  automapBackground: '#0c0910',
  automapFloor: '#2a2230',
  automapWall: '#6a6573',
  automapPlayer: '#d6455d',
});

/** Valeurs CSS du plan (section « CSS »). */
const PLAN_CSS = Object.freeze({
  '--color-page': '#0d0a11',
  '--color-text': '#e6dff0',
  '--color-muted': '#a89cb8',
  '--color-accent': '#8a2f3f',
  '--color-error': '#ff8fa6',
  '--color-error-bg': '#2e0f18',
  '--color-wall': '#4a4650',
});

/** Variables CSS partagées avec la palette : nom CSS -> clé de palette. */
const CSS_TO_PALETTE = Object.freeze({
  '--color-background': 'background',
  '--color-floor': 'floor',
  '--color-wall': 'wall',
  '--color-accent': 'accent',
});

function cssVariables() {
  const vars = {};
  for (const m of css.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG d'une couleur '#rrggbb'. */
function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG entre deux couleurs '#rrggbb'. */
function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('palette sombre', () => {
  test('tous les champs sont des #rrggbb valides, plus de ceilingStar', () => {
    for (const [key, value] of Object.entries(PALETTE)) {
      assert.match(value, HEX, key);
    }
    assert.equal(Object.hasOwn(PALETTE, 'ceilingStar'), false);
  });

  test('valeurs de la palette ciblée du plan', () => {
    for (const [key, value] of Object.entries(PLAN_PALETTE)) {
      assert.equal(PALETTE[key], value, `PALETTE.${key}`);
    }
  });

  test('ceilingStar n\'est référencé nulle part dans le rendu', () => {
    const files = readdirSync(RENDER_DIR)
      .filter((f) => f.endsWith('.js'))
      .map((f) => RENDER_DIR + f);
    files.push(MAIN_PATH);
    for (const file of files) {
      assert.doesNotMatch(readFileSync(file, 'utf8'), /ceilingStar/, file);
    }
  });

  test('sol, murs, plafond et fond : luminance relative < 0.15', () => {
    for (const key of ['background', 'floor', 'ground', 'wall', 'wallLight', 'wallDark',
      'floorBase', 'floorAlt', 'ceilingBase', 'ceilingLine', 'textureBase']) {
      assert.ok(luminance(PALETTE[key]) < 0.15, `${key} ${PALETTE[key]}`);
    }
  });

  test('mur et sol distincts (écart de contraste >= 1.5 pour l\'orientation)', () => {
    assert.ok(contrast(PALETTE.wallLight, PALETTE.floorBase) >= 1.5);
  });

  test('automap : joueur/sol >= 3:1, mur/sol >= 1.5:1', () => {
    assert.ok(contrast(PALETTE.automapPlayer, PALETTE.automapFloor) >= 3);
    assert.ok(contrast(PALETTE.automapWall, PALETTE.automapFloor) >= 1.5);
  });
});

describe('contraste WCAG (texte, boutons, erreurs)', () => {
  const vars = cssVariables();
  const color = (name) => vars[name];

  test('valeurs CSS du plan', () => {
    for (const [name, value] of Object.entries(PLAN_CSS)) {
      assert.equal(color(name), value, name);
    }
    assert.match(color('--shadow'), /rgba\(\s*0,\s*0,\s*0,\s*0\.6\s*\)/);
  });

  test('texte principal / page >= 7:1', () => {
    assert.ok(contrast(color('--color-text'), color('--color-page')) >= 7);
  });

  test('texte secondaire / page >= 4.5:1', () => {
    assert.ok(contrast(color('--color-muted'), color('--color-page')) >= 4.5);
  });

  test('erreur / fond d\'erreur >= 4.5:1', () => {
    assert.ok(contrast(color('--color-error'), color('--color-error-bg')) >= 4.5);
  });

  test('texte de bouton / fond primaire et secondaire >= 4.5:1', () => {
    assert.ok(contrast(color('--color-text'), color('--color-wall')) >= 4.5);
    assert.ok(contrast(color('--color-text'), color('--color-accent')) >= 4.5);
  });
});

describe('cohérence styles.css / palette.js', () => {
  test('les variables CSS partagées ont la valeur de la palette', () => {
    const vars = cssVariables();
    for (const [cssName, key] of Object.entries(CSS_TO_PALETTE)) {
      assert.equal(vars[cssName], PALETTE[key], `${cssName} vs PALETTE.${key}`);
    }
  });

  test('plus de teintes pastel ni de blanc pur dans la feuille de style', () => {
    assert.doesNotMatch(css, /#fff\b/i);
    assert.doesNotMatch(css, /rgba\(\s*(255|185|150|210|109|14)\s*,/);
  });
});

describe('brouillard sombre', () => {
  test('noir total à partir de 6 cases, monotone', () => {
    assert.equal(fogFactor(0), 0);
    assert.equal(fogFactor(6), 1);
    assert.equal(fogFactor(100), 1);
    let previous = -1;
    for (let d = 0; d <= 12; d += 0.1) {
      const value = fogFactor(d);
      assert.ok(value >= previous);
      previous = value;
    }
  });

  test('couleur de brouillard noire', () => {
    assert.equal(PALETTE.fog, '#000000');
  });

  test('mur à distance >= 6 : couleur = fog noir, quelle que soit la teinte du mur', () => {
    for (const d of [6, 6.5, 20]) {
      assert.equal(mixColor(PALETTE.wallLight, PALETTE.fog, fogFactor(d)), '#000000', `d=${d}`);
      assert.equal(mixColor(PALETTE.wallDark, PALETTE.fog, fogFactor(d)), '#000000', `d=${d}`);
    }
  });

  test('sol et plafond à distance >= 6 : pixels exactement noirs', () => {
    const textures = {
      floor: generateSurfaceTexture(SURFACE_TEXTURE.FLOOR, PALETTE),
      ceiling: generateSurfaceTexture(SURFACE_TEXTURE.CEILING, PALETTE),
    };
    const width = 9;
    const height = 200;
    const target = new Uint8ClampedArray(width * height * 4);
    castSurfaces(target, width, height, { x: 2.5, y: 2.5, angle: 0 }, textures, PALETTE.fog);
    let far = 0;
    for (let row = 0; row < height; row++) {
      if (surfaceRowDistance(row, height) < 6) continue;
      far++;
      for (let col = 0; col < width; col++) {
        const i = (row * width + col) * 4;
        assert.deepEqual([target[i], target[i + 1], target[i + 2]], [0, 0, 0], `row ${row} col ${col}`);
      }
    }
    assert.ok(far > 0, 'aucune ligne à distance >= 6 testée');
  });
});

describe('plafond sans étoile', () => {
  test('texture de plafond : seules ceilingBase et ceilingLine apparaissent', () => {
    const tex = generateSurfaceTexture(SURFACE_TEXTURE.CEILING, PALETTE);
    const allowed = new Set([PALETTE.ceilingBase, PALETTE.ceilingLine].map((hex) => {
      const n = Number.parseInt(hex.slice(1), 16);
      return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
    }));
    for (let i = 0; i < tex.data.length; i += 4) {
      const key = `${tex.data[i]},${tex.data[i + 1]},${tex.data[i + 2]}`;
      assert.ok(allowed.has(key), `pixel ${key} hors plafond sombre`);
    }
  });
});
