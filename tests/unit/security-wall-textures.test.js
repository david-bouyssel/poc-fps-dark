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
import {
  SURFACE_TEXTURE,
  SURFACE_SCALE,
  MAX_SURFACE_PIXELS,
  generateSurfaceTexture,
  surfaceBufferSize,
  surfaceRowDistance,
  castSurfaces,
} from '../../src/render/surface-textures.js';
import { PALETTE } from '../../src/render/palette.js';
import { drawFpsView } from '../../src/render/fps-renderer.js';
import { room } from './fps-test-grids.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = path.join(repoRoot, 'src');
const wallTexturesPath = path.join(srcDir, 'render', 'wall-textures.js');
const fpsRendererPath = path.join(srcDir, 'render', 'fps-renderer.js');
const palettePath = path.join(srcDir, 'render', 'palette.js');
const surfaceTexturesPath = path.join(srcDir, 'render', 'surface-textures.js');

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

  test('fps-renderer.js : seul createElement(\'canvas\') est créé (murs + tampon sol/plafond), jamais attaché au DOM', () => {
    const code = stripComments(readFileSync(fpsRendererPath, 'utf8'));
    const created = [...code.matchAll(/createElement\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
    assert.ok(created.length >= 1 && created.length <= 2, `createElement: ${created.length}`);
    assert.ok(created.every((tag) => tag === "'canvas'"), created.join(','));
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
    // Murs hostiles : seul le tampon sol/plafond (valide) peut être créé, aucun canvas de mur.
    const hostile = ['red', '#fff', 'url(http://example.invalid/a.png)', '', '#b9a6e8;x'];
    for (const value of hostile) {
      const log = newLog();
      const canvas = fakeCanvas(log, fakeDocument(log));
      assert.doesNotThrow(() =>
        drawFpsView(canvas, grid, player, { palette: { textureBase: value, textureDot: `${value}${paletteCounter++}` } }));
      assert.ok(log.created.length <= 1, 'au plus le tampon sol/plafond');
      assert.ok(log.drawImage.every(({ image }) => log.created.includes(image)));
      assert.ok(log.drawImage.length <= 1, 'aucun drawImage de mur');
    }
  });

  test('couleurs sol/plafond hostiles : repli en dégradé silencieux, aucun canvas de sol', () => {
    const keys = ['floorBase', 'floorAlt', 'floorGrout', 'ceilingBase', 'ceilingLine'];
    for (const key of keys) {
      for (const value of ['red', '#fff', 'url(http://example.invalid/a.png)', '', '#b9a6e8;x', null, 12, {}]) {
        const log = newLog();
        const canvas = fakeCanvas(log, fakeDocument(log));
        let gradients = 0;
        const original = log.ctx.createLinearGradient;
        log.ctx.createLinearGradient = (...a) => { gradients += 1; return original(...a); };
        assert.doesNotThrow(() => drawFpsView(canvas, grid, player,
          { palette: { [key]: value, textureHeart: `#${(paletteCounter++).toString(16).padStart(6, '0')}` } }));
        assert.equal(gradients, 1, `${key}=${String(value)} : repli dégradé`);
        assert.ok(log.drawImage.every(({ image }) => image.width === TEXTURE_SIZE), 'aucun drawImage du tampon');
        assert.ok(log.drawImage.every(({ image }) => log.created.includes(image)));
      }
    }
  });

  test('tampon sol/plafond : drawImage borné, putImageData ; échecs du contexte sans exception', () => {
    const log = newLog();
    const canvas = fakeCanvas(log, fakeDocument(log));
    drawFpsView(canvas, grid, player, { palette: uniquePalette() });
    assert.ok(log.putImageData >= 1);
    const first = log.drawImage[0];
    assert.ok(log.created.includes(first.image));
    const [sx, sy, sw, sh, dx, dy, dw, dh] = first.args;
    assert.deepEqual([sx, sy, dx, dy], [0, 0, 0, 0]);
    assert.ok(sw * sh <= MAX_SURFACE_PIXELS && sw >= 1 && sh >= 1);
    assert.equal(dw, 160);
    assert.equal(dh, 120);

    const log2 = newLog();
    const canvas2 = fakeCanvas(log2, fakeDocument(log2));
    const doc = canvas2.ownerDocument;
    const create = doc.createElement;
    doc.createElement = (tag) => {
      const el = create(tag);
      const getContext = el.getContext;
      el.getContext = () => {
        const c = getContext();
        c.createImageData = () => { throw new Error('boom'); };
        c.putImageData = () => { throw new Error('boom'); };
        return c;
      };
      return el;
    };
    assert.doesNotThrow(() => drawFpsView(canvas2, grid, player, { palette: uniquePalette() }));
  });

  test('chemin texturé : drawImage uniquement depuis les canvas hors écran créés, '
    + 'rectangle source borné, lissage coupé, globalAlpha restauré', () => {
    const log = newLog();
    const canvas = fakeCanvas(log, fakeDocument(log));
    drawFpsView(canvas, grid, player, { palette: uniquePalette() });
    assert.ok(log.drawImage.length > 0);
    assert.ok(log.createElement.every((tag) => tag === 'canvas'));
    // 8 canvas de murs + 1 tampon sol/plafond.
    assert.equal(log.created.length, WALL_TEXTURE_KINDS.length * 2 + 1);
    const created = new Set(log.created);
    const surface = log.drawImage[0];
    assert.equal(surface.args.length, 8, 'premier drawImage = tampon sol/plafond');
    for (const { image, args } of log.drawImage.slice(1)) {
      assert.ok(created.has(image), 'source de drawImage = canvas texture local');
      assert.notEqual(image, surface.image);
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
    // Murs de la palette (8 canvas) + tampon sol/plafond unique (1), réutilisé ensuite.
    const afterFirst = log.createElement.length;
    assert.equal(afterFirst, WALL_TEXTURE_KINDS.length * 2 + 1);
    const perPalette = WALL_TEXTURE_KINDS.length * 2;
    for (let i = 0; i < 20; i++) drawFpsView(fakeCanvas(log, doc), grid, player, { palette: first });
    assert.equal(log.createElement.length, afterFirst, 'aucune régénération par image');

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

const SURFACE_PALETTE = {
  floorBase: '#fde4ec', floorAlt: '#fad6e3', floorGrout: '#f2c6d6',
  ceilingBase: '#e4f3fb', ceilingLine: '#cde5f4',
};
const BAD_COLORS = [
  undefined, null, 0, 12, true, {}, [], '', 'red', '#fff', '#fffffff', ' #fde4ec', '#fde4ec\n',
  '#fde4ec; x', 'url(http://example.invalid/a.png)', '#gggggg', { toString: () => '#fde4ec' },
  ['#fde4ec'], 1n, Symbol('c'), () => '#fde4ec',
];

describe('surface-textures.js : pureté statique', () => {
  test('imports limités, aucun DOM / réseau / stockage / log / aléa / horloge / URL', () => {
    const code = stripComments(readFileSync(surfaceTexturesPath, 'utf8'));
    const imports = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.deepEqual(imports.sort(), ['./raycaster.js', './wall-textures.js']);
    assert.doesNotMatch(code, /\bimport\s*\(/);
    const hits = scan(surfaceTexturesPath, [
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

  test('palette : clés sol/plafond #rrggbb strict', () => {
    for (const key of Object.keys(SURFACE_PALETTE)) {
      assert.match(PALETTE[key], /^#[0-9a-fA-F]{6}$/, key);
    }
  });
});

describe('generateSurfaceTexture : entrées hostiles', () => {
  test('kind hostile -> RangeError', () => {
    for (const kind of [...HOSTILE_VALUES, 'FLOOR', ' floor', 'walls']) {
      assert.throws(() => generateSurfaceTexture(kind, SURFACE_PALETTE), RangeError);
    }
  });

  test('size hostile -> RangeError, allocation max 256 x 256', () => {
    for (const size of HOSTILE_VALUES) {
      if (size === undefined) continue;
      if (Number.isInteger(size) && size >= 8 && size <= 256 && size % 8 === 0) continue;
      assert.throws(() => generateSurfaceTexture('floor', SURFACE_PALETTE, size), RangeError, String(size));
    }
    assert.equal(generateSurfaceTexture('ceiling', SURFACE_PALETTE, 256).data.length, 256 * 256 * 4);
  });

  test('palette / couleurs hostiles -> TypeError, sans pollution', () => {
    for (const kind of Object.values(SURFACE_TEXTURE)) {
      for (const palette of [undefined, null, 0, 'p', true, {}, Object.create(null)]) {
        assert.throws(() => generateSurfaceTexture(kind, palette), TypeError);
      }
      for (const key of Object.keys(SURFACE_PALETTE)) {
        const required = kind === 'floor' ? key.startsWith('floor') : key.startsWith('ceiling');
        if (!required) continue;
        for (const bad of BAD_COLORS) {
          assert.throws(() => generateSurfaceTexture(kind, { ...SURFACE_PALETTE, [key]: bad }), TypeError, key);
        }
      }
    }
    assert.equal({}.floorBase, undefined);
  });

  test('sortie gelée, alpha 255, couleurs limitées à la palette', () => {
    for (const [kind, keys] of [['floor', ['floorBase', 'floorAlt', 'floorGrout']],
      ['ceiling', ['ceilingBase', 'ceilingLine']]]) {
      const tex = generateSurfaceTexture(kind, SURFACE_PALETTE);
      assert.ok(Object.isFrozen(tex));
      const allowed = new Set(keys.map((k) => SURFACE_PALETTE[k]));
      for (let i = 0; i < tex.data.length; i += 4) {
        assert.equal(tex.data[i + 3], 255);
        const hex = `#${[0, 1, 2].map((c) => tex.data[i + c].toString(16).padStart(2, '0')).join('')}`;
        assert.ok(allowed.has(hex), hex);
      }
    }
  });
});

describe('surfaceBufferSize / surfaceRowDistance : bornes mémoire, jamais de levée', () => {
  test('toute entrée -> entiers >= 1, width * height <= MAX_SURFACE_PIXELS', () => {
    const values = [...HOSTILE_VALUES, 1e4, 1e6, 1e9, 1e300];
    for (const w of values) {
      for (const h of values) {
        let size;
        assert.doesNotThrow(() => { size = surfaceBufferSize(w, h); });
        assert.ok(Number.isInteger(size.width) && size.width >= 1, `${String(w)}x${String(h)}`);
        assert.ok(Number.isInteger(size.height) && size.height >= 1);
        assert.ok(size.width * size.height <= MAX_SURFACE_PIXELS, `${String(w)}x${String(h)}`);
      }
    }
    assert.deepEqual(surfaceBufferSize(160, 120), { width: 160 / SURFACE_SCALE, height: 120 / SURFACE_SCALE });
    const huge = surfaceBufferSize(7680, 4320);
    assert.ok(huge.width * huge.height <= MAX_SURFACE_PIXELS);
  });

  test('surfaceBufferSize : ratios extrêmes, Infinity, négatifs, 1 x N et N x 1', () => {
    const extremes = [1, 2, 3, 1e3, 1e6, 1e9, 1e15, 1e300, Number.MAX_VALUE, Infinity, -Infinity, -5, 0, NaN];
    for (const a of extremes) {
      for (const b of extremes) {
        for (const [w, h] of [[a, b], [b, a]]) {
          const s = surfaceBufferSize(w, h);
          assert.ok(Number.isInteger(s.width) && Number.isInteger(s.height), `${w}x${h}`);
          assert.ok(s.width >= 1 && s.height >= 1, `${w}x${h}`);
          assert.ok(s.width * s.height <= MAX_SURFACE_PIXELS, `${w}x${h}`);
        }
      }
    }
  });

  test('surfaceRowDistance : fini et > 0 pour toute ligne valide', () => {
    for (const height of [1, 2, 3, 60, 1080, 100000]) {
      for (const row of [0, 1, Math.floor(height / 2), height - 1]) {
        const d = surfaceRowDistance(row, height);
        assert.ok(Number.isFinite(d) && d > 0, `${row}/${height}`);
      }
    }
  });
});

describe('castSurfaces : entrées hostiles, écriture bornée', () => {
  const tex = {
    floor: generateSurfaceTexture('floor', SURFACE_PALETTE, 8),
    ceiling: generateSurfaceTexture('ceiling', SURFACE_PALETTE, 8),
  };
  const ply = { x: 2.5, y: 2.5, angle: 0.3 };
  const call = (over = {}) => {
    const a = { w: 8, h: 6, target: null, player: ply, textures: tex, fog: '#aabbcc', fov: undefined, ...over };
    const target = a.target === null ? new Uint8ClampedArray(a.w * a.h * 4) : a.target;
    return castSurfaces(target, a.w, a.h, a.player, a.textures, a.fog, a.fov);
  };

  test('width / height / fov hostiles -> RangeError', () => {
    for (const v of HOSTILE_VALUES) {
      if (Number.isInteger(v) && v >= 1) continue;
      assert.throws(() => castSurfaces(new Uint8ClampedArray(4), v, 1, ply, tex, '#aabbcc'), RangeError);
      assert.throws(() => castSurfaces(new Uint8ClampedArray(4), 1, v, ply, tex, '#aabbcc'), RangeError);
    }
    for (const fov of [0, -1, Math.PI, 4, NaN, Infinity, '1', null, {}, 1n]) {
      assert.throws(() => call({ fov }), RangeError, String(fov));
    }
  });

  test('target mal formé / de mauvaise longueur -> TypeError', () => {
    for (const target of [undefined, [], new Uint8Array(192), new Uint8ClampedArray(191),
      new Uint8ClampedArray(193), new Uint8ClampedArray(0), {}, 'x']) {
      assert.throws(() => call({ target }), TypeError);
    }
    assert.throws(() => castSurfaces(null, 8, 6, ply, tex, '#aabbcc'), TypeError);
  });

  test('player hostile -> TypeError', () => {
    for (const p of [undefined, null, 0, 'p', {}, { x: NaN, y: 0, angle: 0 }, { x: 0, y: Infinity, angle: 0 },
      { x: 0, y: 0, angle: NaN }, { x: '1', y: 0, angle: 0 }, { x: 0, y: 0 }, { x: 1n, y: 0, angle: 0 }]) {
      assert.throws(() => call({ player: p }), TypeError);
    }
  });

  test('textures hostiles (tailles, types, géantes déclarées) -> TypeError', () => {
    const good = tex.floor;
    const bad = [
      undefined, null, 0, {}, { floor: good }, { ceiling: good }, { floor: null, ceiling: good },
      { floor: good, ceiling: generateSurfaceTexture('ceiling', SURFACE_PALETTE, 16) },
      { floor: { ...good, data: new Uint8Array(good.data.length) }, ceiling: tex.ceiling },
      { floor: { ...good, data: new Uint8ClampedArray(3) }, ceiling: tex.ceiling },
      { floor: { width: 1e9, height: 1e9, data: new Uint8ClampedArray(4) }, ceiling: tex.ceiling },
      { floor: { width: 8, height: 4, data: new Uint8ClampedArray(128) }, ceiling: tex.ceiling },
      { floor: { width: NaN, height: NaN, data: new Uint8ClampedArray(0) }, ceiling: tex.ceiling },
      {
        floor: { width: 0, height: 0, data: new Uint8ClampedArray(0) },
        ceiling: { width: 0, height: 0, data: new Uint8ClampedArray(0) },
      },
    ];
    for (const textures of bad) assert.throws(() => call({ textures }), TypeError);
  });

  test('fogColor hostile -> TypeError', () => {
    for (const fog of BAD_COLORS) assert.throws(() => call({ fog }), TypeError, String(typeof fog));
  });

  test('succès : alpha 255, joueur / fov extrêmes sans levée, taille maximale bornée', () => {
    const target = new Uint8ClampedArray(8 * 6 * 4);
    call({ target });
    for (let i = 3; i < target.length; i += 4) assert.equal(target[i], 255);
    for (const p of [{ x: 1e15, y: -1e15, angle: 1e9 }, { x: -0, y: 0, angle: -1e300 },
      { x: Number.MAX_VALUE, y: Number.MIN_VALUE, angle: Math.PI }]) {
      for (const fov of [1e-9, 1, Math.PI - 1e-9]) {
        assert.doesNotThrow(() => call({ player: p, fov }));
      }
    }
    const { width, height } = surfaceBufferSize(1e6, 1e6);
    const big = new Uint8ClampedArray(width * height * 4);
    assert.ok(big.length <= MAX_SURFACE_PIXELS * 4);
    assert.doesNotThrow(() => castSurfaces(big, width, height, ply, tex, '#000000'));
    assert.equal(big[big.length - 1], 255);
  });

  test('ne modifie pas les textures', () => {
    const before = [Uint8ClampedArray.from(tex.floor.data), Uint8ClampedArray.from(tex.ceiling.data)];
    call();
    assert.deepEqual(tex.floor.data, before[0]);
    assert.deepEqual(tex.ceiling.data, before[1]);
  });
});

// ---------------------------------------------------------------------------
// Sprites billboard (testeur-securite, après retrait des fruits en T2) : projection
// (src/render/sprites.js) et intégration au rendu (drawFpsView options.sprites et
// options.spriteImages). Aucun contenu métier : kinds génériques, images fournies par
// l'appelant.
// ---------------------------------------------------------------------------
const spritesPath = path.join(srcDir, 'render', 'sprites.js');
const mainPath = path.join(srcDir, 'main.js');

const PURITY_PATTERNS = [
  [/\b(window|document|globalThis|self|navigator|location)\b/, 'global navigateur'],
  [/\b(HTMLCanvasElement|OffscreenCanvas|ImageData|Image|createElement|getContext)\b/, 'canvas/DOM'],
  [/\bMath\.random\b/, 'Math.random'],
  [/\b(Date|performance|requestAnimationFrame|setTimeout|setInterval)\b/, 'horloge'],
  [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Worker)\b/, 'réseau'],
  [/\b(localStorage|sessionStorage|indexedDB|caches|cookie)\b/, 'stockage'],
  [/\bconsole\./, 'log'],
  [/\beval\s*\(|\bnew\s+Function\b/, 'exécution dynamique'],
  [/https?:\/\/|['"`(](data|blob):/, 'URL'],
];

const { projectSprites, isSpriteColumnVisible } = await import('../../src/render/sprites.js');
const { MIN_DISTANCE } = await import('../../src/render/raycaster.js');

const isFiniteNumbers = (obj) => Object.values(obj).every((v) => typeof v !== 'number' || Number.isFinite(v));

describe('sprites : pureté statique de sprites.js, rendu sans import de game/', () => {
  test('sprites.js : import limité à ./raycaster.js, aucun DOM / aléa / horloge / réseau / stockage / log / eval / URL', () => {
    const code = stripComments(readFileSync(spritesPath, 'utf8'));
    const found = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]).sort();
    assert.deepEqual(found, ['./raycaster.js']);
    assert.doesNotMatch(code, /\bimport\s*\(/, 'import dynamique');
    const hits = scan(spritesPath, PURITY_PATTERNS);
    assert.deepEqual(hits, [], hits.join('\n'));
  });

  test('le rendu n\'importe jamais src/game/ ; main.js n\'écrit jamais de HTML', () => {
    for (const file of [fpsRendererPath, spritesPath]) {
      assert.doesNotMatch(stripComments(readFileSync(file, 'utf8')), /from\s+['"][^'"]*\/game\//, path.basename(file));
    }
    const hits = scan(mainPath, [
      [/\.(innerHTML|outerHTML)\b|insertAdjacentHTML|document\.write/, 'écriture HTML'],
      [/\b(localStorage|sessionStorage|indexedDB|cookie)\b/, 'stockage'],
      [/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, 'réseau'],
      [/\bconsole\./, 'log'],
      [/\beval\s*\(|\bnew\s+Function\b/, 'exécution dynamique'],
    ]);
    assert.deepEqual(hits, [], hits.join('\n'));
  });

  test('palette : aucune clé fruit* résiduelle (retrait T2)', () => {
    assert.deepEqual(Object.keys(PALETTE).filter((k) => /^fruit/i.test(k)), []);
  });
});
describe('projectSprites / isSpriteColumnVisible', () => {
  const cam = { x: 2.5, y: 2.5, angle: 0 };

  test('player / vue / options / liste hostiles -> erreur typée', () => {
    for (const p of [undefined, null, {}, { x: NaN, y: 0, angle: 0 }, { x: 0, y: 0, angle: Infinity }, { x: '1', y: 0, angle: 0 }]) {
      assert.throws(() => projectSprites([], p, 100, 100), TypeError);
    }
    for (const v of [0, -1, NaN, Infinity, '100', null, undefined, 1n]) {
      assert.throws(() => projectSprites([], cam, v, 100), RangeError, String(v));
      assert.throws(() => projectSprites([], cam, 100, v), RangeError, String(v));
    }
    for (const o of [null, 'x', 0]) assert.throws(() => projectSprites([], cam, 100, 100, o), TypeError);
    for (const o of [{ fov: 0 }, { fov: Math.PI }, { fov: NaN }, { fov: '1' }, { worldSize: 0 }, { worldSize: Infinity }, { worldSize: -1 }]) {
      assert.throws(() => projectSprites([], cam, 100, 100, o), RangeError, JSON.stringify(o));
    }
    for (const s of [undefined, null, 'abc', {}, { length: 1 }]) {
      assert.throws(() => projectSprites(s, cam, 100, 100), TypeError);
    }
  });

  test('sprites hostiles -> TypeError ; kind « __proto__ » copié comme simple valeur', () => {
    const bad = [null, 0, 'x', {}, { x: NaN, y: 0, kind: 'peach' }, { x: 3, y: Infinity, kind: 'peach' },
      { x: 3, y: 2.5, kind: 42 }, { x: '3', y: 2.5, kind: 'peach' }, { x: 3, y: 2.5 }];
    for (const s of bad) {
      assert.throws(() => projectSprites([s], cam, 100, 100), TypeError, JSON.stringify(s));
    }
    const proto = projectSprites([{ x: 4, y: 2.5, kind: '__proto__' }], cam, 100, 100);
    assert.equal(proto.length, 1);
    assert.equal(Object.getPrototypeOf(proto[0]), Object.prototype);
  });

  test('distance 0, derrière la caméra, juste au-delà de MIN_DISTANCE, très loin : sorties finies', () => {
    assert.equal(projectSprites([{ x: cam.x, y: cam.y, kind: 'peach' }], cam, 100, 100).length, 0,
      'sprite sur le joueur exclu (pas de division par 0)');
    const behind = projectSprites([{ x: cam.x - 1, y: cam.y, kind: 'peach' },
      { x: cam.x - 1e-9, y: cam.y + 5, kind: 'peach' }], cam, 100, 100);
    assert.equal(behind.length, 0, 'sprites derrière la caméra exclus');
    const near = projectSprites([{ x: cam.x + MIN_DISTANCE * 1.0001, y: cam.y, kind: 'peach' }], cam, 100, 100);
    assert.equal(near.length, 1);
    assert.ok(isFiniteNumbers(near[0]));
    const far = projectSprites([{ x: 1e300, y: 2.5, kind: 'peach' }, { x: 1e300, y: 1e300, kind: 'cherry' }], cam, 100, 100);
    for (const s of far) assert.ok(isFiniteNumbers(s));
  });

  test('liste énorme : coût borné, entrée gelée non modifiée, ordre du peintre', () => {
    const sprites = [];
    for (let i = 0; i < 100000; i++) sprites.push(Object.freeze({ x: 3 + (i % 50), y: 2.5 + ((i * 7) % 11) - 5, kind: 'cherry' }));
    Object.freeze(sprites);
    const started = process.hrtime.bigint();
    const out = projectSprites(sprites, cam, 640, 480);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 2000, `100 000 sprites en ${ms} ms`);
    for (let i = 1; i < out.length; i++) assert.ok(out[i - 1].depth >= out[i].depth);
  });

  test('isSpriteColumnVisible : jamais de levée, toujours un booléen', () => {
    const hits = [undefined, null, 0, 'x', {}, { distance: '5' }, { distance: NaN }, { distance: Infinity },
      { distance: -1 }, { distance: 3 }, Object.create(null), { get distance() { return 2; } }];
    const depths = [NaN, -Infinity, -1, 0, 1, 2.5, Infinity, '1', undefined, null];
    for (const hit of hits) {
      for (const depth of depths) {
        let r;
        assert.doesNotThrow(() => { r = isSpriteColumnVisible(depth, hit); });
        assert.equal(typeof r, 'boolean');
      }
    }
    assert.equal(isSpriteColumnVisible(NaN, { distance: 3 }), false);
    assert.equal(isSpriteColumnVisible(1, null), false);
  });
});

describe('drawFpsView : options.sprites / spriteImages hostiles (kind générique)', () => {
  const SPRITE_IMAGE = Object.freeze({ width: 8, height: 8 });
  const spriteImages = new Map([['monster', SPRITE_IMAGE]]);
  const front = { x: 3.8, y: 2.9, kind: 'monster' };

  /** Dessine une frame et retient les drawImage de l'image de sprite, avec leur globalAlpha. */
  function instrumentedDraw(sprites, { images = spriteImages, palette = uniquePalette(), docOpts } = {}) {
    const log = newLog();
    const canvas = fakeCanvas(log, fakeDocument(log, docOpts));
    const alphas = [];
    const original = log.ctx.drawImage;
    log.ctx.drawImage = (image, ...args) => {
      alphas.push(log.ctx.globalAlpha);
      original(image, ...args);
    };
    assert.doesNotThrow(() => drawFpsView(canvas, grid, player, { palette, sprites, spriteImages: images }));
    const spriteDraws = log.drawImage.map((d, i) => ({ ...d, alpha: alphas[i] }))
      .filter((d) => d.image === SPRITE_IMAGE);
    return { log, spriteDraws };
  }

  test('sprite valide : bande source bornée à l\'image fournie, alpha dans [0, 1] puis restauré', () => {
    const { log, spriteDraws } = instrumentedDraw([front]);
    assert.ok(spriteDraws.length > 0, 'le sprite devant est dessiné');
    for (const { args, alpha } of spriteDraws) {
      const [sx, sy, sw, sh, dx, , dw, dh] = args;
      assert.ok(Number.isInteger(sx) && sx >= 0 && sx < SPRITE_IMAGE.width);
      assert.deepEqual([sy, sw, sh], [0, 1, SPRITE_IMAGE.height]);
      for (const v of args) assert.ok(Number.isFinite(v));
      assert.ok(dx >= 0 && dx + dw <= 160 + 1e-9 && dw > 0 && dh > 0);
      assert.ok(alpha >= 0 && alpha <= 1);
    }
    assert.equal(log.ctx.globalAlpha, 1);
    assert.equal(log.ctx.imageSmoothingEnabled, false);
  });

  test('options.sprites hostile (type, éléments, kind, worldSize) : aucune exception, aucun sprite dessiné, alpha 1', () => {
    const hostile = [
      null, 'abc', 42, {}, { length: 2 }, [null], [undefined], [42], ['monster'],
      [{ x: NaN, y: 2.5, kind: 'monster' }], [{ x: 3, y: Infinity, kind: 'monster' }],
      [{ x: 3.8, y: 2.9, kind: 42 }], [{ x: 3.8, y: 2.9 }],
      [{ x: 3.8, y: 2.9, kind: '__proto__' }], [{ x: 3.8, y: 2.9, kind: 'constructor' }],
      [{ x: 3.8, y: 2.9, kind: 'banana' }],
      [{ x: 3.8, y: 2.9, kind: 'monster', worldSize: -1 }],
      [{ x: 3.8, y: 2.9, kind: 'monster', worldSize: 0 }],
      [{ x: 3.8, y: 2.9, kind: 'monster', worldSize: NaN }],
      [{ x: 3.8, y: 2.9, kind: 'monster', worldSize: 'abc' }],
      [{ x: player.x, y: player.y, kind: 'monster' }],
      [{ x: player.x - Math.cos(player.angle), y: player.y - Math.sin(player.angle), kind: 'monster' }],
      [{ x: 1e300, y: 1e300, kind: 'monster' }],
    ];
    hostile.forEach((sprites, i) => {
      const { log, spriteDraws } = instrumentedDraw(sprites);
      assert.equal(spriteDraws.length, 0, `cas #${i}`);
      assert.equal(log.ctx.globalAlpha, 1, `globalAlpha restauré : cas #${i}`);
    });
  });

  test('sprite mal formé à côté d\'un sprite valide : seul le valide est dessiné', () => {
    const alone = instrumentedDraw([front]).spriteDraws.length;
    assert.ok(alone > 0);
    for (const bad of [null, { x: NaN, y: 2.9, kind: 'monster' }, { x: 3.8, y: 2.9, kind: 'banana' }]) {
      assert.equal(instrumentedDraw([front, bad]).spriteDraws.length, alone, JSON.stringify(bad));
    }
  });

  test('spriteImages hostile (non-Map, valeurs vides ou sans dimensions) : aucune exception, aucun sprite', () => {
    const images = [
      null, 'abc', {}, [['monster', SPRITE_IMAGE]],
      new Map([['monster', null]]), new Map([['monster', undefined]]),
      new Map([['monster', { width: 0, height: 8 }]]), new Map([['monster', { width: 8 }]]),
    ];
    for (const map of images) {
      const { log, spriteDraws } = instrumentedDraw([front], { images: map });
      assert.equal(spriteDraws.length, 0, String(map));
      assert.equal(log.ctx.globalAlpha, 1);
    }
  });

  test('sans sprites : spriteImages jamais consultée, aucun sprite dessiné', () => {
    class SpyMap extends Map {
      get(key) { this.calls = (this.calls ?? 0) + 1; return super.get(key); }
    }
    const spy = new SpyMap([['monster', SPRITE_IMAGE]]);
    for (const sprites of [[], undefined]) {
      const { spriteDraws } = instrumentedDraw(sprites, { images: spy });
      assert.equal(spriteDraws.length, 0);
    }
    assert.equal(spy.calls ?? 0, 0, 'aucun get sans sprites');
  });

  test('le renderer ne crée aucun canvas pour les sprites : même nombre de canvas avec ou sans sprites', () => {
    const countWith = (sprites, images) => {
      const log = newLog();
      drawFpsView(fakeCanvas(log, fakeDocument(log)), grid, player,
        { palette: uniquePalette(), sprites, spriteImages: images });
      return log.createElement.length;
    };
    assert.equal(countWith([front], spriteImages), countWith([], undefined));
  });

  test('sprite à MIN_DISTANCE : taille géante rognée, valeurs finies, alpha restauré', () => {
    const k = MIN_DISTANCE * 1.01;
    const near = { x: player.x + Math.cos(player.angle) * k, y: player.y + Math.sin(player.angle) * k, kind: 'monster' };
    const { log, spriteDraws } = instrumentedDraw([near]);
    for (const { args } of spriteDraws) for (const v of args) assert.ok(Number.isFinite(v));
    assert.ok(spriteDraws.length <= 80, 'au plus une bande par colonne de rendu');
    assert.equal(log.ctx.globalAlpha, 1);
  });

  test('liste énorme : sans exception, coût borné, alpha restauré', () => {
    const sprites = [];
    for (let i = 0; i < 20000; i++) sprites.push({ x: 1.5 + (i % 4), y: 1.5 + ((i >> 2) % 4), kind: i % 2 ? 'monster' : 'absent' });
    const started = process.hrtime.bigint();
    const { log } = instrumentedDraw(sprites);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 5000, `20 000 sprites en ${ms} ms`);
    assert.equal(log.ctx.globalAlpha, 1);
  });

  test('échec canvas (createElement qui lève, getContext nul, drawImage qui lève) : sans exception', () => {
    // Échec des textures de murs (canvas hors écran) : les sprites ne dépendent que de leur image.
    for (const docOpts of [{ throwOnCreate: true }, { nullContext: true }]) {
      const { log, spriteDraws } = instrumentedDraw([front], { docOpts });
      assert.ok(spriteDraws.length > 0, 'sprite dessiné malgré l\'échec des textures de murs');
      assert.equal(log.ctx.globalAlpha, 1);
    }
    const log = newLog();
    const canvas = fakeCanvas(log, fakeDocument(log));
    const original = log.ctx.drawImage;
    log.ctx.drawImage = (image, ...args) => {
      if (image === SPRITE_IMAGE) { log.ctx.globalAlpha = 0.3; throw new Error('boom'); }
      original(image, ...args);
    };
    assert.doesNotThrow(() => drawFpsView(canvas, grid, player, { palette: uniquePalette(), sprites: [front], spriteImages }));
    assert.equal(log.ctx.globalAlpha, 1, 'globalAlpha restauré même après une levée');
  });
});
