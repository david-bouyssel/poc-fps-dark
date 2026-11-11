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
