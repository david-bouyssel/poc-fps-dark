// Tests de non-régression du rendu des murs texturés (docs/design/fix-murs-invisibles.md) :
// chaque tranche de mur est dessinée à globalAlpha = 1 (la fuite du voile de brouillard
// de la colonne précédente ne doit plus l'atténuer), le voile reste dans ]0, 1], et son
// ordre par colonne est préservé. Canvas et contexte factices instrumentés : lecture de
// globalAlpha au moment de chaque appel, pas seulement en fin de frame.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { drawFpsView } from '../../src/render/fps-renderer.js';
import { PALETTE } from '../../src/render/palette.js';
import { WALL_TEXTURE_KINDS } from '../../src/render/wall-textures.js';
import { room } from './fps-test-grids.js';

/** Taille CSS de la vue : container factice 160 x 120 (pas de devicePixelRatio sous Node). */
const VIEW_WIDTH = 160;
const VIEW_HEIGHT = 120;
/** Voile de brouillard : plafond de DEFAULT_MAX_FOG (thème sombre : noir total, ]0, 1]). */
const MAX_FOG_ALPHA = 1;

/**
 * Contexte 2D factice : journalise, dans une séquence unique et dans l'ordre d'appel,
 * chaque drawImage et fillRect avec le globalAlpha et le fillStyle au moment de l'appel.
 */
function fakeContext(sequence) {
  return {
    globalAlpha: 1,
    fillStyle: '#000000',
    imageSmoothingEnabled: true,
    setTransform() {},
    createLinearGradient() { return { addColorStop() {} }; },
    fillRect(...args) {
      sequence.push({ kind: 'fill', args, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
    },
    drawImage(image, ...args) {
      sequence.push({ kind: 'draw', image, args, globalAlpha: this.globalAlpha });
    },
    createImageData(w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData() {},
  };
}

/**
 * Document factice. `created` garde l'ordre de création des canvas hors écran :
 * [0] = tampon sol/plafond, puis 2 canvas par type de mur. Les sprites n'en créent aucun.
 */
function makeEnv() {
  const sequence = [];
  const created = [];
  const ownerDocument = {
    createElement(tag) {
      const context = fakeContext([]);
      const element = {
        tag,
        width: 0,
        height: 0,
        getContext: () => context,
      };
      created.push(element);
      return element;
    },
  };
  const mainContext = fakeContext(sequence);
  const canvas = {
    width: 0,
    height: 0,
    clientWidth: 0,
    clientHeight: 0,
    style: {},
    parentElement: { clientWidth: VIEW_WIDTH, clientHeight: VIEW_HEIGHT },
    ownerDocument,
    getContext: () => mainContext,
  };
  return { sequence, created, canvas, mainContext };
}

/** Images de murs : canvas créés par getWallTextures (après le tampon sol/plafond). */
function wallImagesOf(created) {
  return new Set(created.slice(1, 1 + 2 * WALL_TEXTURE_KINDS.length));
}

/** Image de sprite fournie par l'appelant (Map kind -> image) : taille de texel connue. */
const SPRITE_KIND = 'testSprite';
const SPRITE_IMAGE = Object.freeze({ width: 8, height: 8 });

/** Palette valide unique par test (évite les effets du cache module de textures). */
let paletteCounter = 0;
function uniquePalette() {
  paletteCounter += 1;
  return { ...PALETTE, textureHeart: `#${paletteCounter.toString(16).padStart(6, '0')}` };
}

const grid = room(6, 6);
const player = { x: 2.5, y: 2.5, angle: 0.3 };

describe('drawFpsView : murs texturés opaques, voile de brouillard seul atténué', () => {
  test('chaque drawImage de mur est à globalAlpha === 1 au moment de l\'appel', () => {
    const env = makeEnv();
    const palette = uniquePalette();
    drawFpsView(env.canvas, grid, player, { palette });
    const walls = wallImagesOf(env.created);
    const wallDraws = env.sequence.filter((op) => op.kind === 'draw' && walls.has(op.image));
    assert.ok(wallDraws.length >= 2, `au moins 2 colonnes de mur attendues, obtenu ${wallDraws.length}`);
    for (const op of wallDraws) {
      assert.equal(op.globalAlpha, 1, `drawImage mur en x=${op.args[4]} : globalAlpha=${op.globalAlpha}`);
    }
  });

  test('voile de brouillard : fillRect à palette.fog avec 0 < globalAlpha <= 1', () => {
    const env = makeEnv();
    const palette = uniquePalette();
    drawFpsView(env.canvas, grid, player, { palette });
    const fogFills = env.sequence.filter((op) => op.kind === 'fill' && op.fillStyle === palette.fog);
    assert.ok(fogFills.length > 0, 'aucun voile de brouillard dessiné');
    for (const op of fogFills) {
      assert.ok(op.globalAlpha > 0 && op.globalAlpha <= MAX_FOG_ALPHA,
        `voile en x=${op.args[0]} : globalAlpha=${op.globalAlpha}`);
    }
  });

  test('ordre par colonne : le drawImage du mur précède le fillRect de son voile', () => {
    const env = makeEnv();
    const palette = uniquePalette();
    drawFpsView(env.canvas, grid, player, { palette });
    const ops = env.sequence;
    const fogIndexes = ops
      .map((op, i) => ({ op, i }))
      .filter(({ op }) => op.kind === 'fill' && op.fillStyle === palette.fog);
    assert.ok(fogIndexes.length > 0, 'aucun voile de brouillard dessiné');
    for (const { op, i } of fogIndexes) {
      const column = op.args[0];
      const previous = ops[i - 1];
      assert.ok(previous && previous.kind === 'draw' && previous.args[4] === column,
        `voile en x=${column} non précédé du drawImage de son mur`);
    }
  });

  test('globalAlpha === 1 en fin de frame, y compris sur deux frames consécutives', () => {
    const env = makeEnv();
    const palette = uniquePalette();
    const walls = () => wallImagesOf(env.created);

    drawFpsView(env.canvas, grid, player, { palette });
    assert.equal(env.mainContext.globalAlpha, 1, 'fin de frame 1');

    env.sequence.length = 0;
    drawFpsView(env.canvas, grid, player, { palette });
    assert.equal(env.mainContext.globalAlpha, 1, 'fin de frame 2');
    const firstWall = env.sequence.find((op) => op.kind === 'draw' && walls().has(op.image));
    assert.ok(firstWall, 'aucun mur dessiné en frame 2');
    assert.equal(firstWall.globalAlpha, 1, 'premier mur de la frame 2 à globalAlpha 1');
    for (const op of env.sequence.filter((o) => o.kind === 'draw' && walls().has(o.image))) {
      assert.equal(op.globalAlpha, 1, `frame 2, mur en x=${op.args[4]}`);
    }
  });

  test('avec sprites devant le joueur : les murs restent à globalAlpha === 1', () => {
    const env = makeEnv();
    const palette = uniquePalette();
    const sprites = [{ x: 3.2, y: 2.6, kind: SPRITE_KIND }];
    drawFpsView(env.canvas, grid, player, { palette, sprites, spriteImages: new Map([[SPRITE_KIND, SPRITE_IMAGE]]) });
    const walls = wallImagesOf(env.created);
    const wallDraws = env.sequence.filter((op) => op.kind === 'draw' && walls.has(op.image));
    const spriteDraws = env.sequence.filter((op) => op.kind === 'draw' && op.image === SPRITE_IMAGE);
    assert.ok(spriteDraws.length > 0, 'le sprite devant le joueur doit être dessiné (sinon test vide)');
    assert.ok(wallDraws.length >= 2, 'au moins 2 colonnes de mur attendues');
    for (const op of wallDraws) {
      assert.equal(op.globalAlpha, 1, `mur en x=${op.args[4]} avec sprites : globalAlpha=${op.globalAlpha}`);
    }
    assert.equal(env.mainContext.globalAlpha, 1, 'fin de frame avec sprites');
  });

  test('sprite dont le kind est absent de spriteImages : ignoré, aucune exception', () => {
    const env = makeEnv();
    const sprites = [{ x: 3.2, y: 2.6, kind: 'absent' }];
    assert.doesNotThrow(() => drawFpsView(env.canvas, grid, player, {
      palette: uniquePalette(), sprites, spriteImages: new Map([[SPRITE_KIND, SPRITE_IMAGE]]),
    }));
    assert.equal(env.sequence.filter((op) => op.kind === 'draw' && op.image === SPRITE_IMAGE).length, 0);
    assert.equal(env.mainContext.globalAlpha, 1);
  });

  test('sans sprites : spriteImages jamais consultée, aucune image de sprite dessinée', () => {
    const env = makeEnv();
    let reads = 0;
    const spy = { get() { reads += 1; return SPRITE_IMAGE; } };
    drawFpsView(env.canvas, grid, player, { palette: uniquePalette(), spriteImages: spy });
    drawFpsView(env.canvas, grid, player, { palette: uniquePalette(), sprites: [], spriteImages: spy });
    assert.equal(reads, 0, 'aucune lecture de la Map sans sprites');
    assert.equal(env.sequence.filter((op) => op.kind === 'draw' && op.image === SPRITE_IMAGE).length, 0);
  });

  test('worldSize par sprite : le sprite plus grand est dessiné deux fois plus haut', () => {
    const heightFor = (worldSize) => {
      const env = makeEnv();
      const sprites = [{ x: 3.2, y: 2.6, kind: SPRITE_KIND, worldSize }];
      drawFpsView(env.canvas, grid, player, {
        palette: uniquePalette(), sprites, spriteImages: new Map([[SPRITE_KIND, SPRITE_IMAGE]]),
      });
      const heights = env.sequence
        .filter((op) => op.kind === 'draw' && op.image === SPRITE_IMAGE)
        .map((op) => op.args[7]);
      assert.ok(heights.length > 0, `worldSize ${worldSize} : sprite non dessiné`);
      assert.ok(heights.every((h) => h === heights[0]), 'hauteur constante sur les bandes');
      return heights[0];
    };
    const base = heightFor(0.35);
    const double = heightFor(0.7);
    assert.ok(Math.abs(double / base - 2) < 1e-6, `ratio ${double / base}`);
  });

  test('worldSize invalide (<= 0, non fini) : sprite ignoré, aucune exception', () => {
    for (const worldSize of [0, -1, NaN, Infinity]) {
      const env = makeEnv();
      const sprites = [{ x: 3.2, y: 2.6, kind: SPRITE_KIND, worldSize }];
      assert.doesNotThrow(() => drawFpsView(env.canvas, grid, player, {
        palette: uniquePalette(), sprites, spriteImages: new Map([[SPRITE_KIND, SPRITE_IMAGE]]),
      }), String(worldSize));
      assert.equal(env.sequence.filter((op) => op.kind === 'draw' && op.image === SPRITE_IMAGE).length, 0, String(worldSize));
      assert.equal(env.mainContext.globalAlpha, 1, String(worldSize));
    }
  });
});

// --- Sortie : option exit (plan docs/design/dark-sortie-victoire.md §4.1) ---
import { fogFactor, mixColor, castRays } from '../../src/render/raycaster.js';
import { EXIT_FOG_SCALE } from '../../src/render/exit-texture.js';
import { gridFromRows } from './fps-test-grids.js';

/** Env. dont les canvas hors écran gardent les pixels posés (repère la texture de sortie). */
function makeExitEnv({ withDocument = true } = {}) {
  const base = makeEnv();
  const pixelsOf = new Map();
  if (withDocument) {
    base.canvas.ownerDocument = {
      createElement(tag) {
        const context = fakeContext([]);
        const element = { tag, width: 0, height: 0, getContext: () => context };
        context.putImageData = (imageData) => { pixelsOf.set(element, imageData.data); };
        base.created.push(element);
        return element;
      },
    };
  } else {
    delete base.canvas.ownerDocument;
  }
  return { ...base, pixelsOf };
}

/** Palette avec couleurs exit* uniques (évite le cache module), cœur reconnaissable. */
let exitPaletteCounter = 0;
function exitPalette() {
  exitPaletteCounter += 1;
  const n = exitPaletteCounter.toString(16).padStart(4, '0');
  return { ...uniquePalette(), exitFrame: `#01${n}`, exitGlow: `#02${n}`, exitCore: `#03${n}` };
}

function hasColor(data, color) {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === r && data[i + 1] === g && data[i + 2] === b) return true;
  }
  return false;
}

function exitImagesOf(env, palette) {
  return new Set([...env.pixelsOf].filter(([, data]) => hasColor(data, palette.exitCore)).map(([el]) => el));
}

// Couloir est-ouest long : sortie en (8, 1), joueur en (1.5, 1.5) regardant l'est vers le
// mur (9, 1), face tournée vers la sortie.
const exitCorridor = gridFromRows(['##########', '#........#', '##########']);
const exitPlayer = { x: 1.5, y: 1.5, angle: 0 };
const corridorExit = Object.freeze({ tx: 8, ty: 1 });

describe('drawFpsView : faces de sortie (option exit)', () => {
  test('faces tournées vers la sortie : texture de sortie dessinée, à globalAlpha 1', () => {
    const env = makeExitEnv();
    const palette = exitPalette();
    drawFpsView(env.canvas, exitCorridor, exitPlayer, { palette, exit: corridorExit });
    const exitImages = exitImagesOf(env, palette);
    assert.equal(exitImages.size, 1, 'une texture de sortie hors écran');
    const draws = env.sequence.filter((op) => op.kind === 'draw' && exitImages.has(op.image));
    assert.ok(draws.length > 0, 'aucune colonne de sortie dessinée');
    for (const op of draws) assert.equal(op.globalAlpha, 1);
  });

  test('voile de brouillard des faces de sortie = voile normal * EXIT_FOG_SCALE', () => {
    const fogByColumn = (exit) => {
      const env = makeExitEnv();
      const palette = exitPalette();
      drawFpsView(env.canvas, exitCorridor, exitPlayer, { palette, exit });
      const exitImages = exitImagesOf(env, palette);
      const result = new Map();
      env.sequence.forEach((op, i) => {
        if (op.kind !== 'fill' || op.fillStyle !== palette.fog) return;
        const prev = env.sequence[i - 1];
        if (prev?.kind !== 'draw') return;
        result.set(op.args[0], { alpha: op.globalAlpha, exit: exitImages.has(prev.image) });
      });
      return result;
    };
    const normal = fogByColumn(undefined);
    const withExit = fogByColumn(corridorExit);
    let compared = 0;
    for (const [x, { alpha, exit }] of withExit) {
      if (!exit) continue;
      const ref = normal.get(x);
      assert.ok(ref, `colonne ${x} : voile normal absent`);
      assert.ok(Math.abs(alpha - ref.alpha * EXIT_FOG_SCALE) < 1e-9, `colonne ${x} : ${alpha} vs ${ref.alpha}`);
      compared++;
    }
    assert.ok(compared > 0, 'aucune colonne de sortie avec voile (test vide)');
  });

  test('sans exit (absent ou null) : aucune texture de sortie dessinée', () => {
    for (const exit of [undefined, null]) {
      const env = makeExitEnv();
      const palette = exitPalette();
      drawFpsView(env.canvas, exitCorridor, exitPlayer, { palette, exit });
      const exitImages = exitImagesOf(env, palette);
      const draws = env.sequence.filter((op) => op.kind === 'draw' && exitImages.has(op.image));
      assert.equal(draws.length, 0, String(exit));
    }
  });

  test('exit ailleurs (face non tournée vers la sortie) : aucune colonne de sortie', () => {
    const env = makeExitEnv();
    const palette = exitPalette();
    // Sortie en (1, 1) derrière le joueur regardant l'est : le mur (9, 1) n'est pas adjacent.
    drawFpsView(env.canvas, exitCorridor, { x: 4.5, y: 1.5, angle: 0 }, { palette, exit: { tx: 1, ty: 1 } });
    const exitImages = exitImagesOf(env, palette);
    const draws = env.sequence.filter((op) => op.kind === 'draw' && exitImages.has(op.image));
    // Le champ de vision (est) ne montre pas le mur ouest (0, 1).
    assert.equal(draws.length, 0);
  });

  test('exit mal formé : aucune exception', () => {
    for (const exit of [{}, { tx: NaN, ty: 1 }, { tx: '8', ty: 1 }, 42]) {
      const env = makeExitEnv();
      assert.doesNotThrow(() => drawFpsView(env.canvas, exitCorridor, exitPlayer, { palette: exitPalette(), exit }));
      assert.equal(env.mainContext.globalAlpha, 1);
    }
  });

  test('repli aplat (pas de ownerDocument) : exitGlow mélangé vers fog * EXIT_FOG_SCALE', () => {
    const env = makeExitEnv({ withDocument: false });
    const palette = exitPalette();
    assert.doesNotThrow(() => drawFpsView(env.canvas, exitCorridor, exitPlayer, { palette, exit: corridorExit }));
    const hits = castRays(exitCorridor, exitPlayer, VIEW_WIDTH / 2);
    const expected = new Set(hits.map((h) => mixColor(palette.exitGlow, palette.fog, fogFactor(h.distance) * EXIT_FOG_SCALE)));
    const fills = env.sequence.filter((op) => op.kind === 'fill' && expected.has(op.fillStyle));
    assert.ok(fills.length > 0, 'aucune colonne de sortie en aplat');
  });
});
