// Apparence du monstre sans DOM, d'après le plan docs/design/dark-monstre-apparence.md
// (§ Tests fonctionnels). Vue FPS dessinée sur un faux canvas qui enregistre les drawImage ;
// vue de dessus et automap vérifiées par la source de main.js et des renderers.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drawFpsView } from '../../src/render/fps-renderer.js';
import {
  MONSTER_FRAME_KINDS,
  monsterFrame,
  monsterFrameSprite,
} from '../../src/render/monster-sprite.js';
import { gridFromRows } from '../unit/fps-test-grids.js';

const MAIN_SOURCE = readFileSync(fileURLToPath(new URL('../../src/main.js', import.meta.url)), 'utf8');
const AUTOMAP_SOURCE = readFileSync(fileURLToPath(new URL('../../src/render/automap-renderer.js', import.meta.url)), 'utf8');
const TOP_SOURCE = readFileSync(fileURLToPath(new URL('../../src/render/canvas-renderer.js', import.meta.url)), 'utf8');

// Un couloir de 5 cases ; le mur colonne x = 3 coupe la vue (occlusion).
const OPEN = gridFromRows([
  '#######',
  '#.....#',
  '#.....#',
  '#######',
]);
const WALLED = gridFromRows([
  '#######',
  '#..#..#',
  '#..#..#',
  '#######',
]);
const PLAYER = Object.freeze({ x: 1.5, y: 1.5, angle: 0 });
const MONSTER_X = 4.5;
const MONSTER_Y = 1.5;

/** Faux contexte 2D : enregistre drawImage, tout le reste est un no-op. */
function fakeContext(calls) {
  const gradient = { addColorStop() {} };
  const target = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      if (prop === 'drawImage') {
        return (...args) => { calls.push(args); };
      }
      return () => undefined;
    },
    set(obj, prop, value) {
      obj[prop] = value;
      return true;
    },
  });
}

/** Faux canvas : parentElement de taille fixe, pas de ownerDocument (pas de textures). */
function fakeCanvas(calls) {
  const ctx = fakeContext(calls);
  return {
    width: 0,
    height: 0,
    style: {},
    parentElement: { clientWidth: 320, clientHeight: 240 },
    getContext: () => ctx,
  };
}

function images() {
  return new Map(MONSTER_FRAME_KINDS.map((kind, i) => [kind, { width: 64, height: 64, tag: i }]));
}

/** Dessine une vue FPS avec un monstre optionnel ; renvoie les images utilisées. */
function render(grid, sprites, spriteImages = images()) {
  const calls = [];
  drawFpsView(fakeCanvas(calls), grid, PLAYER, { sprites, spriteImages });
  return calls.map((args) => args[0]);
}

describe('occlusion par un mur', () => {
  test('monstre derrière un mur, kind monster-k : aucun drawImage pour cette image', () => {
    for (let frame = 0; frame < MONSTER_FRAME_KINDS.length; frame++) {
      const imgs = images();
      const sprite = monsterFrameSprite({ x: MONSTER_X, y: MONSTER_Y, kind: 'monster' }, frame);
      const drawn = render(WALLED, [sprite], imgs);
      assert.equal(drawn.filter((img) => img === imgs.get(sprite.kind)).length, 0, `frame ${frame}`);
    }
  });

  test('même monstre sans mur : dessiné, avec l\'image de son kind', () => {
    for (let frame = 0; frame < MONSTER_FRAME_KINDS.length; frame++) {
      const imgs = images();
      const sprite = monsterFrameSprite({ x: MONSTER_X, y: MONSTER_Y, kind: 'monster' }, frame);
      const drawn = render(OPEN, [sprite], imgs);
      assert.ok(drawn.length > 0, `frame ${frame} non dessinée`);
      assert.ok(drawn.every((img) => img === imgs.get(sprite.kind)), `frame ${frame} : mauvaise image`);
    }
  });

  test('image choisie par monsterFrame au temps t est celle dessinée', () => {
    const imgs = images();
    const cases = [
      { t: 0, mode: 'wander', grace: 0 },
      { t: 0.2, mode: 'wander', grace: 0 },
      { t: 0.4, mode: 'chase', grace: 0 },
      { t: 0.3, mode: 'wander', grace: 2 },
    ];
    for (const { t, mode, grace } of cases) {
      const frame = monsterFrame(t, mode, grace);
      const sprite = monsterFrameSprite({ x: MONSTER_X, y: MONSTER_Y, kind: 'monster' }, frame);
      const drawn = render(OPEN, [sprite], imgs);
      assert.ok(drawn.length > 0);
      assert.ok(drawn.every((img) => img === imgs.get(`monster-${frame}`)), `t=${t} ${mode} grace=${grace}`);
    }
  });

  test('pendant la grâce (sommeil) : image monster-0 dessinée', () => {
    const imgs = images();
    const frame = monsterFrame(0.5, 'chase', 1.5);
    assert.equal(frame, 0);
    const sprite = monsterFrameSprite({ x: MONSTER_X, y: MONSTER_Y, kind: 'monster' }, frame);
    const drawn = render(OPEN, [sprite], imgs);
    assert.ok(drawn.length > 0);
    assert.ok(drawn.every((img) => img === imgs.get('monster-0')));
  });

  test('sans image pour le kind (Map vide) : rien dessiné, pas d\'exception', () => {
    const sprite = monsterFrameSprite({ x: MONSTER_X, y: MONSTER_Y, kind: 'monster' }, 1);
    const drawn = render(OPEN, [sprite], new Map());
    assert.equal(drawn.length, 0);
  });
});

describe('aucun monstre sur l\'automap ni en vue de dessus', () => {
  test('main.js : appels drawAutomap et drawMaze sans référence au monstre', () => {
    const lines = MAIN_SOURCE.split('\n');
    const calls = lines.filter((line) => /\bdrawAutomap\s*\(|\bdrawMaze\s*\(/.test(line));
    assert.ok(calls.length >= 2, `appels trouvés : ${calls.length}`);
    for (const line of calls) {
      assert.doesNotMatch(line, /monster|sprite/i, `appel avec monstre : ${line.trim()}`);
    }
  });

  test('automap-renderer.js et canvas-renderer.js ne manipulent ni sprites ni monstres', () => {
    for (const source of [AUTOMAP_SOURCE, TOP_SOURCE]) {
      assert.doesNotMatch(source, /monster|sprite/i);
    }
  });
});
