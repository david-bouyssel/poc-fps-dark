// Tests de sécurité / robustesse de l'automap (testeur-securite) : entrées hostiles,
// bornes CPU/mémoire, robustesse du rendu, absence de réseau/stockage/log/innerHTML.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toTileGrid } from '../../src/maze/grid.js';
import { generateMaze } from '../../src/maze/maze.js';
import {
  AUTOMAP_MODE, REVEAL, createExploredMask, revealVisibleTiles, automapLayout,
} from '../../src/render/automap.js';
import { drawAutomap } from '../../src/render/automap-renderer.js';
import { actionForCode, ACTION } from '../../src/game/input.js';

const grid = toTileGrid(generateMaze({ width: 6, height: 6, seed: 7 }));
const player = { x: 1.5, y: 1.5, angle: 0 };
const BAD_NUM = [NaN, Infinity, -Infinity, 0, -1, '1', null, undefined, {}, 1n === 1n ? 1.5 : 0];

describe('automap pur : entrées hostiles', () => {
  test('createExploredMask rejette les grilles mal formées', () => {
    for (const g of [null, undefined, 0, 'x', [], {}, { width: 0, height: 0, tiles: new Uint8Array(0) },
      { width: NaN, height: 2, tiles: new Uint8Array(4) }, { width: 2, height: 2, tiles: new Uint8Array(3) },
      { width: 2, height: 2, tiles: null }, { width: 1e9, height: 1e9, tiles: new Uint8Array(4) }]) {
      assert.throws(() => createExploredMask(g), TypeError);
    }
    assert.equal(createExploredMask(grid).length, grid.width * grid.height);
  });

  test('revealVisibleTiles rejette masque de mauvaise taille/type', () => {
    for (const m of [null, undefined, [], new Uint8Array(1), new Uint16Array(grid.width * grid.height)]) {
      assert.throws(() => revealVisibleTiles(m, grid, player), TypeError);
    }
  });

  test('revealVisibleTiles rejette joueur/options hostiles', () => {
    const m = createExploredMask(grid);
    for (const p of [null, undefined, {}, { x: NaN, y: 1, angle: 0 }, { x: 1, y: Infinity, angle: 0 },
      { x: 1, y: 1, angle: NaN }, { x: '1', y: 1, angle: 0 }]) {
      assert.throws(() => revealVisibleTiles(m, grid, p), TypeError);
    }
    for (const v of [NaN, Infinity, 0, -1, 1.5, '3']) {
      assert.throws(() => revealVisibleTiles(m, grid, player, { rayCount: v }), TypeError);
    }
    for (const v of [NaN, Infinity, -Infinity, 0, -1, '1']) {
      assert.throws(() => revealVisibleTiles(m, grid, player, { maxDistance: v }), TypeError);
      assert.throws(() => revealVisibleTiles(m, grid, player, { step: v }), TypeError);
    }
    for (const v of [NaN, 0, -1, 7, Infinity]) {
      assert.throws(() => revealVisibleTiles(m, grid, player, { fov: v }), TypeError);
    }
    assert.doesNotThrow(() => revealVisibleTiles(m, grid, player, null));
    assert.deepEqual(Object.isFrozen(REVEAL), true);
  });

  test('joueur hors grille / coordonnées énormes : pas d\'exception, pas d\'écriture hors masque', () => {
    for (const [x, y] of [[-50, -50], [1e6, 1e6], [-1e300, 1e300], [Number.MAX_VALUE, 0], [grid.width, grid.height]]) {
      const m = createExploredMask(grid);
      assert.doesNotThrow(() => revealVisibleTiles(m, grid, { x, y, angle: 1e10 }));
      assert.equal(m.length, grid.width * grid.height);
      assert.ok(m.every((v) => v === 0 || v === 1));
    }
  });

  test('idempotent et borné : 2e appel marque 0 tuile', () => {
    const m = createExploredMask(grid);
    const n = revealVisibleTiles(m, grid, player);
    assert.ok(n > 0 && n <= m.length);
    assert.equal(revealVisibleTiles(m, grid, player), 0);
  });

  test('coût par défaut borné (rayCount * maxDistance / step itérations)', () => {
    const m = createExploredMask(grid);
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) revealVisibleTiles(m, grid, { ...player, angle: i });
    assert.ok(performance.now() - t0 < 2000);
    assert.ok(REVEAL.rayCount * (REVEAL.maxDistance / REVEAL.step) <= 20000);
  });

  test('automapLayout : entrées hostiles', () => {
    for (const mode of ['', 'MINI', null, undefined, 'full ', {}]) {
      assert.throws(() => automapLayout(mode, grid, player, 800, 600), TypeError);
    }
    for (const v of [0, -1, NaN, Infinity, '800', null, undefined]) {
      assert.throws(() => automapLayout(AUTOMAP_MODE.MINI, grid, player, v, 600), TypeError);
      assert.throws(() => automapLayout(AUTOMAP_MODE.FULL, grid, player, 800, v), TypeError);
    }
    for (const [w, h] of [[1, 1], [10, 10], [1e9, 1e9], [Number.MAX_VALUE, 5]]) {
      for (const mode of [AUTOMAP_MODE.MINI, AUTOMAP_MODE.FULL]) {
        const l = automapLayout(mode, grid, player, w, h);
        assert.ok(Object.isFrozen(l));
        assert.ok(l.scale > 0 && Number.isFinite(l.scale), `${mode} ${w}x${h}`);
        assert.ok(l.panelWidth > 0);
      }
    }
    // joueur absent / non fini en mini : pas d'exception, origine finie
    for (const p of [null, undefined, { x: NaN, y: Infinity }]) {
      const l = automapLayout(AUTOMAP_MODE.MINI, grid, p, 800, 600);
      assert.ok(Number.isFinite(l.originX) && Number.isFinite(l.originY));
    }
  });
});

function fakeCanvas(width, height, ctx) {
  return { width, height, getContext: () => ctx };
}
function recordingCtx() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, a]); }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx, calls };
}

describe('drawAutomap : robustesse', () => {
  const explored = createExploredMask(grid);
  revealVisibleTiles(explored, grid, player);

  test('contexte absent : retour silencieux', () => {
    assert.doesNotThrow(() => drawAutomap(fakeCanvas(800, 600, null), grid, explored, player, 'mini'));
  });

  test('modes, masque trop court, joueur non fini, couleurs hostiles : sans exception', () => {
    for (const mode of [AUTOMAP_MODE.MINI, AUTOMAP_MODE.FULL]) {
      const { ctx } = recordingCtx();
      const evil = { automapBackground: '</style><script>', automapFloor: {}, automapWall: null, automapPlayer: 42 };
      assert.doesNotThrow(() => drawAutomap(fakeCanvas(800, 600, ctx), grid, explored, player, mode, { palette: evil }));
      assert.doesNotThrow(() => drawAutomap(fakeCanvas(800, 600, ctx), grid, new Uint8Array(2), player, mode));
      assert.doesNotThrow(() => drawAutomap(fakeCanvas(800, 600, ctx), grid, explored, { x: NaN, y: Infinity, angle: NaN }, mode));
    }
  });

  test('save/restore équilibrés même si le dessin lève', () => {
    const { ctx, calls } = recordingCtx();
    ctx.fillRect = () => { throw new Error('boom'); };
    assert.throws(() => drawAutomap(fakeCanvas(800, 600, ctx), grid, explored, player, 'full'));
    const n = (k) => calls.filter(([c]) => c === k).length;
    assert.equal(n('save'), n('restore'));
  });

  test('nombre d\'appels de dessin borné par la taille de la grille', () => {
    const { ctx, calls } = recordingCtx();
    drawAutomap(fakeCanvas(800, 600, ctx), grid, explored, player, 'full');
    assert.ok(calls.length < grid.width * grid.height * 2 + 50);
  });

  test('canvas de taille 0 : signalé (le rendu lève TypeError, risque d\'arrêt de boucle)', () => {
    const { ctx } = recordingCtx();
    try {
      drawAutomap(fakeCanvas(0, 0, ctx), grid, explored, player, 'mini');
    } catch (e) {
      assert.ok(e instanceof TypeError);
    }
  });
});

describe('scan statique automap', () => {
  const files = ['src/render/automap.js', 'src/render/automap-renderer.js'].map((f) =>
    [f, readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')]);
  for (const [f, s] of files) {
    test(`${f} : pas de réseau, stockage, log, innerHTML, eval, secret`, () => {
      assert.doesNotMatch(s, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|https?:\/\//);
      assert.doesNotMatch(s, /localStorage|sessionStorage|indexedDB|document\.cookie/);
      assert.doesNotMatch(s, /console\.|debugger/);
      assert.doesNotMatch(s, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|import\s*\(/);
      assert.doesNotMatch(s, /(api[_-]?key|token|secret|password)\s*[:=]/i);
    });
  }
});

describe('clavier TOGGLE_MAP', () => {
  test('seules KeyM et Semicolon déclenchent la bascule', () => {
    assert.equal(actionForCode('KeyM'), ACTION.TOGGLE_MAP);
    assert.equal(actionForCode('Semicolon'), ACTION.TOGGLE_MAP);
    for (const c of ['KeyN', 'Comma', 'Period', 'Quote', 'Tab', 'F5', 'KeyL', '', 'm', ';', 'keym', '__proto__']) {
      assert.notEqual(actionForCode(c), ACTION.TOGGLE_MAP, c);
    }
  });

  test('main.js : event.repeat ignoré pour la bascule', () => {
    const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
    assert.match(src, /TOGGLE_MAP\)\s*\{\s*if \(!event\.repeat\)/);
  });

  test('main.js : touches modifiées (Ctrl/Alt/Meta) non capturées', () => {
    const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('function boundKeyDownAction'), src.indexOf('function toggleMap'));
    assert.match(fn, /ctrlKey|metaKey|altKey/);
  });
});
