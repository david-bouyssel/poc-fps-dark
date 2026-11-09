// Tests de sécurité des textures procédurales des murs FPS (testeur-securite) :
// pureté du module, absence de ressource externe / image / lecture de pixels,
// robustesse aux entrées hostiles, mémoire et cache bornés, repli sans exception.
// Aucun DOM réel, aucun réseau : canvas factices instrumentés.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TEXTURE_SIZE,
  WALL_TEXTURE,
  WALL_TEXTURE_KINDS,
  WALL_TEXTURE_WEIGHTS,
  SIDE_SHADE,
  generateWallTexture,
  shadeTexture,
  textureIndexForTile,
  textureColumn,
  textureSlice,
} from '../../src/render/wall-textures.js';
import { PALETTE } from '../../src/render/palette.js';
import { drawFpsView } from '../../src/render/fps-renderer.js';
import { room } from './fps-test-grids.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = path.join(repoRoot, 'src');
const wallTexturesPath = path.join(srcDir, 'render', 'wall-textures.js');
const fpsRendererPath = path.join(srcDir, 'render', 'fps-renderer.js');
const palettePath = path.join(srcDir, 'render', 'palette.js');

/** Retire commentaires bloc et ligne (approximation suffisante pour ce code). */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

function scan(file, patterns) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  const hits = [];
  lines.forEach((line, i) => {
    for (const [pattern, label] of patterns) {
      if (pattern.test(line)) hits.push(`${path.basename(file)}:${i + 1} [${label}] ${line.trim()}`);
    }
  });
  return hits;
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

const TEXTURE_KEYS = [
  'textureBase', 'textureBrickAlt', 'textureMortar', 'texturePlankAlt',
  'textureGroove', 'textureDot', 'textureHeart',
];

const HOSTILE_VALUES = [
  undefined, null, true, false, 0, -0, 1, -1, 1.5, -1.5, 7, 9, 12, 33, 264, 512, 4096,
  NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
  Number.MAX_VALUE, 2 ** 31, -(2 ** 31), 2 ** 53 + 2, '', '1', '32', 'abc', '__proto__',
  'constructor', 'toString', 'hasOwnProperty', [], [32], {}, { valueOf: () => 32 }, 1n,
  Symbol('s'), () => 0,
];

describe('wall-textures.js : pureté et absence de ressource externe (statique)', () => {
  test('imports limités à ./raycaster.js', () => {
    const code = stripComments(readFileSync(wallTexturesPath, 'utf8'));
    const imports = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.deepEqual(imports, ['./raycaster.js']);
    assert.doesNotMatch(code, /\bimport\s*\(/, 'aucun import dynamique');
  });

  test('aucun accès DOM, global, aléa, horloge, réseau, stockage ni log', () => {
    const hits = scan(wallTexturesPath, [
      [/\b(window|document|globalThis|self|navigator|location)\b/, 'global navigateur'],
      [/\b(HTMLCanvasElement|OffscreenCanvas|ImageData|Image|createElement|getContext)\b/, 'canvas/DOM'],
      [/\bMath\.random\b/, 'Math.random'],
      [/\b(Date|performance|requestAnimationFrame|setTimeout|setInterval)\b/, 'horloge'],
      [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Worker)\b/, 'réseau'],
      [/\b(localStorage|sessionStorage|indexedDB|caches|cookie)\b/, 'stockage'],
      [/\bconsole\./, 'log'],
      [/\beval\s*\(|\bnew\s+Function\b/, 'exécution dynamique'],
      [/https?:\/\/|['"`(](data|blob):/, 'URL'],
    ]);
    assert.deepEqual(hits, [], hits.join('\n'));
  });
});

describe('fps-renderer.js / palette.js : aucune ressource externe ni lecture de pixels', () => {
  test('aucun chargement d\'image, URL, data:/blob:, ni relecture du canvas (empreinte)', () => {
    const hits = [];
    for (const file of [fpsRendererPath, palettePath]) {
      hits.push(...scan(file, [
        [/\bnew\s+Image\b|\bImage\s*\(|\bcreateImageBitmap\b/, 'chargement image'],
        [/\.src\s*=|\bsrcset\b|\burl\s*\(/, 'source externe'],
        [/https?:\/\/|['"`(](data|blob):|createObjectURL/, 'URL'],
        [/\b(toDataURL|toBlob|getImageData|captureStream|readPixels)\b/, 'relecture pixels'],
        [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, 'réseau'],
        [/\b(localStorage|sessionStorage|indexedDB|caches|cookie)\b/, 'stockage'],
        [/\bconsole\./, 'log'],
        [/\bMath\.random\b/, 'Math.random'],
      ]));
    }
    assert.deepEqual(hits, [], hits.join('\n'));
  });

  test('fps-renderer.js : seul createElement(\'canvas\') est créé, jamais attaché au DOM', () => {
    const code = stripComments(readFileSync(fpsRendererPath, 'utf8'));
    const created = [...code.matchAll(/createElement\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
    assert.deepEqual(created, ["'canvas'"]);
    assert.doesNotMatch(code, /\b(appendChild|append|prepend|insertBefore|replaceChildren|body)\b/);
  });

  test('src/ : aucun fichier image/police/binaire, aucun chemin absolu dans le code modifié', () => {
    const binary = listFiles(srcDir).filter((f) =>
      /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg|woff2?|ttf|otf|wasm)$/i.test(f));
    assert.deepEqual(binary, []);
    for (const file of [wallTexturesPath, fpsRendererPath, palettePath]) {
      const code = stripComments(readFileSync(file, 'utf8'));
      const specs = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of specs) assert.match(spec, /^\.\.?\//, `${file} -> ${spec}`);
      assert.doesNotMatch(code, /['"`]\/(?!\/)[\w-]/, `${file} : chemin absolu`);
      assert.doesNotMatch(code, /[A-Za-z]:\\|\/Users\/|\/home\//, `${file} : chemin machine`);
    }
  });

  test('palette : objet gelé, teintes de texture au format #rrggbb strict', () => {
    assert.ok(Object.isFrozen(PALETTE));
    for (const key of TEXTURE_KEYS) {
      assert.match(PALETTE[key], /^#[0-9a-fA-F]{6}$/, key);
    }
  });

  test('constantes exportées gelées (non modifiables par un autre module)', () => {
    assert.ok(Object.isFrozen(WALL_TEXTURE));
    assert.ok(Object.isFrozen(WALL_TEXTURE_KINDS));
    assert.ok(Object.isFrozen(WALL_TEXTURE_WEIGHTS));
    assert.equal(TEXTURE_SIZE, 32);
    assert.ok(SIDE_SHADE >= 0 && SIDE_SHADE <= 1);
  });
});

describe('generateWallTexture : entrées hostiles, mémoire bornée', () => {
  test('kind hostile (dont clés de prototype) -> RangeError, jamais d\'autre erreur', () => {
    for (const kind of [...HOSTILE_VALUES, 'BRICKS', 'Bricks', ' bricks']) {
      assert.throws(() => generateWallTexture(kind, PALETTE), RangeError, String(typeof kind));
    }
  });

  test('size hostile -> RangeError ; aucune allocation au-delà de 256 x 256', () => {
    for (const size of HOSTILE_VALUES) {
      if (size === undefined) continue; // valeur par défaut légitime
      const valid = Number.isInteger(size) && size >= 8 && size <= 256 && size % 8 === 0;
      if (valid) continue;
      assert.throws(() => generateWallTexture('bricks', PALETTE, size), RangeError, String(size));
    }
    for (const kind of WALL_TEXTURE_KINDS) {
      const max = generateWallTexture(kind, PALETTE, 256);
      assert.equal(max.data.length, 256 * 256 * 4);
    }
  });

  test('palette hostile -> TypeError, jamais d\'exécution de code ni de pollution', () => {
    const palettes = [
      undefined, null, 0, 'palette', true, 1n, Symbol('p'),
      {}, Object.create(null),
      { ...PALETTE, textureBase: '#fff' },
      { ...PALETTE, textureBase: 'red' },
      { ...PALETTE, textureBase: '#b9a6e8; background:url(http://x)' },
      { ...PALETTE, textureBase: 'url(http://example.invalid/x.png)' },
      { ...PALETTE, textureBase: ' #b9a6e8' },
      { ...PALETTE, textureBase: '#b9a6e8\n' },
      { ...PALETTE, textureBase: 0xb9a6e8 },
      { ...PALETTE, textureBase: { toString: () => '#b9a6e8' } },
      { ...PALETTE, textureBase: ['#b9a6e8'] },
    ];
    for (const palette of palettes) {
      if (palette === undefined || palette === null || typeof palette !== 'object') {
        assert.throws(() => generateWallTexture('bricks', palette), TypeError);
        continue;
      }
      for (const kind of WALL_TEXTURE_KINDS) {
        assert.throws(() => generateWallTexture(kind, palette), TypeError);
      }
    }
    assert.equal({}.textureBase, undefined, 'aucune pollution de Object.prototype');
  });

  test('sortie gelée, alpha 255 partout, couleurs limitées à la palette fournie', () => {
    for (const kind of WALL_TEXTURE_KINDS) {
      const tex = generateWallTexture(kind, PALETTE);
      assert.ok(Object.isFrozen(tex));
      assert.ok(tex.data instanceof Uint8ClampedArray);
      const allowed = new Set(TEXTURE_KEYS.map((k) => PALETTE[k].toLowerCase()));
      for (let i = 0; i < tex.data.length; i += 4) {
        assert.equal(tex.data[i + 3], 255);
        const hex = `#${[0, 1, 2].map((c) => tex.data[i + c].toString(16).padStart(2, '0')).join('')}`;
        assert.ok(allowed.has(hex), `${kind} : ${hex}`);
      }
    }
  });
});

describe('shadeTexture : entrées hostiles, pas de mutation, pas d\'allocation forgée', () => {
  const base = generateWallTexture('hearts', PALETTE, 8);

  test('texture mal formée -> TypeError (dont tailles géantes déclarées)', () => {
    const textures = [
      undefined, null, 0, 'tex', {}, [],
      { width: 8, height: 8 },
      { width: 8, height: 8, data: new Uint8Array(256) },
      { width: 8, height: 8, data: Array(256).fill(0) },
      { width: 8, height: 8, data: new Uint8ClampedArray(255) },
      { width: 0, height: 0, data: new Uint8ClampedArray(0) },
      { width: -8, height: -8, data: new Uint8ClampedArray(256) },
      { width: 8.5, height: 8, data: new Uint8ClampedArray(272) },
      { width: NaN, height: 8, data: new Uint8ClampedArray(256) },
      { width: 1e9, height: 1e9, data: new Uint8ClampedArray(4) },
      { width: '8', height: '8', data: new Uint8ClampedArray(256) },
    ];
    for (const tex of textures) {
      assert.throws(() => shadeTexture(tex, 0.1), TypeError);
    }
  });

  test('amount hostile -> RangeError', () => {
    for (const amount of [NaN, -0.01, 1.01, Infinity, -Infinity, '0.1', null, undefined, {}, 1n]) {
      assert.throws(() => shadeTexture(base, amount), RangeError, String(amount));
    }
  });

  test('ne modifie jamais l\'entrée, sortie gelée et de même taille', () => {
    const before = Uint8ClampedArray.from(base.data);
    const out = shadeTexture(base, SIDE_SHADE);
    assert.deepEqual(base.data, before);
    assert.notEqual(out.data, base.data);
    assert.ok(Object.isFrozen(out));
    assert.equal(out.data.length, base.data.length);
  });
});

describe('fonctions de boucle chaude : ne lèvent jamais, sorties bornées', () => {
  test('textureIndexForTile : entier dans [0, kinds) pour toute entrée', () => {
    for (const x of HOSTILE_VALUES) {
      for (const y of HOSTILE_VALUES) {
        let index;
        assert.doesNotThrow(() => { index = textureIndexForTile(x, y); });
        assert.ok(Number.isInteger(index) && index >= 0 && index < WALL_TEXTURE_KINDS.length);
      }
    }
  });

  test('textureColumn : entier dans [0, size - 1] pour hit/player/size hostiles', () => {
    const hits = [
      ...HOSTILE_VALUES,
      ...HOSTILE_VALUES.map((v) => ({ side: 'x', tileX: 1, tileY: 1, wallX: v })),
      ...HOSTILE_VALUES.map((v) => ({ side: v, tileX: v, tileY: v, wallX: 0.5 })),
    ];
    const players = [undefined, null, 0, {}, { x: NaN, y: NaN }, { x: 2, y: 0 }, { x: '5', y: '5' }];
    for (const hit of hits) {
      for (const player of players) {
        for (const size of [undefined, 1, 8, 32, 256, 0, -1, 1.5, NaN, Infinity, '32', null]) {
          let col;
          assert.doesNotThrow(() => { col = textureColumn(hit, player, size); });
          const effective = Number.isInteger(size) && size >= 1 ? size : TEXTURE_SIZE;
          assert.ok(Number.isInteger(col) && col >= 0 && col <= effective - 1,
            `col=${String(col)} size=${String(size)}`);
        }
      }
    }
  });

  test('textureSlice : rectangle source fini et inclus dans la texture, sans division par 0', () => {
    const distances = [1e-12, 1e-6, 0.001, 0.05, 0.1, 0.5, 1, 3.7, 50, 1e6, 1e300];
    const heights = [0, 1, 2, 3, 240, 1080, 4321, 1e6];
    for (const d of distances) {
      for (const h of heights) {
        for (const size of [8, 32, 256]) {
          const s = textureSlice(d, h, size);
          for (const v of Object.values(s)) assert.ok(Number.isFinite(v), `${d} ${h} ${v}`);
          assert.ok(s.srcY >= 0 && s.srcHeight >= 0 && s.srcY + s.srcHeight <= size + 1e-9);
          assert.ok(s.top >= 0 && s.bottom <= h + 1e-9);
        }
      }
    }
  });

  test('textureSlice : entrées invalides -> erreur typée uniquement (pas de valeur corrompue)', () => {
    for (const d of [NaN, -1, Infinity, -Infinity, undefined, null, '1', {}]) {
      for (const h of [NaN, -1, Infinity, 240]) {
        try {
          const s = textureSlice(d, h);
          for (const v of Object.values(s)) assert.ok(Number.isFinite(v), `${String(d)} ${h}`);
        } catch (error) {
          assert.ok(error instanceof RangeError || error instanceof TypeError, String(error));
        }
      }
    }
  });
});

/** Contexte 2D factice qui journalise les appels utiles. */
function fakeContext(log) {
  return {
    globalAlpha: 1,
    fillStyle: '#000000',
    imageSmoothingEnabled: true,
    setTransform() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect() {},
    drawImage(image, ...args) { log.drawImage.push({ image, args }); },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() { log.putImageData += 1; },
  };
}

/** Document factice : compte les canvas hors écran créés. */
function fakeDocument(log, { nullContext = false, throwOnCreate = false } = {}) {
  return {
    createElement(tag) {
      log.createElement.push(tag);
      if (throwOnCreate) throw new Error('blocked');
      const element = {
        width: 0,
        height: 0,
        getContext: () => (nullContext ? null : fakeContext(log)),
      };
      log.created.push(element);
      return element;
    },
  };
}

function newLog() {
  return { createElement: [], created: [], drawImage: [], putImageData: 0, ctx: null };
}

function fakeCanvas(log, ownerDocument) {
  const ctx = fakeContext(log);
  log.ctx = ctx;
  return {
    width: 0, height: 0, clientWidth: 0, clientHeight: 0,
    style: {},
    parentElement: { clientWidth: 160, clientHeight: 120 },
    ownerDocument,
    getContext: () => ctx,
  };
}

const grid = room(6, 6);
const player = { x: 2.5, y: 2.5, angle: 0.3 };
let paletteCounter = 0;
/** Palette valide unique (évite les effets du cache module entre tests). */
function uniquePalette() {
  paletteCounter += 1;
  return { textureHeart: `#${paletteCounter.toString(16).padStart(6, '0')}` };
}

describe('drawFpsView : repli sans exception et cache borné', () => {
  test('sans ownerDocument : rendu en aplat, aucune exception, aucun drawImage', () => {
    const log = newLog();
    assert.doesNotThrow(() => drawFpsView(fakeCanvas(log, undefined), grid, player,
      { palette: uniquePalette() }));
    assert.equal(log.drawImage.length, 0);
  });

  test('getContext nul / createElement qui lève : repli en aplat, aucune exception', () => {
    for (const opts of [{ nullContext: true }, { throwOnCreate: true }]) {
      const log = newLog();
      const canvas = fakeCanvas(log, fakeDocument(log, opts));
      assert.doesNotThrow(() => drawFpsView(canvas, grid, player, { palette: uniquePalette() }));
      assert.equal(log.drawImage.length, 0);
    }
  });

  test('couleurs de texture hostiles : repli en aplat silencieux, aucun canvas créé', () => {
    const hostile = ['red', '#fff', 'url(http://example.invalid/a.png)', '', '#b9a6e8;x'];
    for (const value of hostile) {
      const log = newLog();
      const canvas = fakeCanvas(log, fakeDocument(log));
      assert.doesNotThrow(() =>
        drawFpsView(canvas, grid, player, { palette: { textureBase: value, textureDot: `${value}${paletteCounter++}` } }));
      assert.equal(log.drawImage.length, 0);
      assert.equal(log.createElement.length, 0);
    }
  });

  test('chemin texturé : drawImage uniquement depuis les canvas hors écran créés, '
    + 'rectangle source borné, lissage coupé, globalAlpha restauré', () => {
    const log = newLog();
    const canvas = fakeCanvas(log, fakeDocument(log));
    drawFpsView(canvas, grid, player, { palette: uniquePalette() });
    assert.ok(log.drawImage.length > 0);
    assert.ok(log.createElement.every((tag) => tag === 'canvas'));
    assert.equal(log.created.length, WALL_TEXTURE_KINDS.length * 2);
    const created = new Set(log.created);
    for (const { image, args } of log.drawImage) {
      assert.ok(created.has(image), 'source de drawImage = canvas texture local');
      const [sx, sy, sw, sh] = args;
      assert.ok(Number.isInteger(sx) && sx >= 0 && sx < TEXTURE_SIZE);
      assert.ok(sy >= 0 && sh > 0 && sy + sh <= TEXTURE_SIZE + 1e-9);
      assert.equal(sw, 1);
      for (const v of args) assert.ok(Number.isFinite(v));
    }
    assert.equal(log.ctx.imageSmoothingEnabled, false);
    assert.equal(log.ctx.globalAlpha, 1);
  });

  test('cache : textures générées une seule fois par palette, nombre d\'entrées borné', () => {
    const log = newLog();
    const doc = fakeDocument(log);
    const first = uniquePalette();
    drawFpsView(fakeCanvas(log, doc), grid, player, { palette: first });
    const perPalette = log.createElement.length;
    assert.equal(perPalette, WALL_TEXTURE_KINDS.length * 2);
    for (let i = 0; i < 20; i++) drawFpsView(fakeCanvas(log, doc), grid, player, { palette: first });
    assert.equal(log.createElement.length, perPalette, 'aucune régénération par image');

    // 50 palettes distinctes : sans borne, le cache conserverait 50 x 8 canvas.
    for (let i = 0; i < 50; i++) {
      drawFpsView(fakeCanvas(log, doc), grid, player, { palette: uniquePalette() });
    }
    // La première palette a été évincée (cache vidé au-delà de la borne).
    const before = log.createElement.length;
    drawFpsView(fakeCanvas(log, doc), grid, player, { palette: first });
    assert.equal(log.createElement.length - before, perPalette, 'cache borné : entrée évincée');
  });
});
