// Tests de sécurité / robustesse des modules purs de la sortie et de la victoire (T4,
// testeur-securite) : entrées hostiles (grilles malformées, NaN, Infinity, prototypes,
// objets gelés), absence de mutation des entrées, sorties gelées, et scan statique des
// fichiers ajoutés (pas de sink HTML, ni réseau, ni stockage, ni log, ni chemin absolu).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, TILE } from '../../src/maze/grid.js';
import {
  tileDistances, pathDistance, shortestPath, cellToTile, tileAt, UNREACHABLE, NEIGHBOR_OFFSETS,
} from '../../src/game/pathfinding.js';
import { findExit, isAtExit } from '../../src/game/exit.js';
import {
  GAME_STATUS, createGameState, isGameOver, checkVictory, declareDefeat,
} from '../../src/game/game-state.js';
import { generateExitTexture, isExitFace, EXIT_FOG_SCALE } from '../../src/render/exit-texture.js';
import { PALETTE } from '../../src/render/palette.js';

const HOSTILE_NUMBERS = [NaN, Infinity, -Infinity, 1.5, -1, '1', null, undefined, true, {}, [], 1n];

function realGrid(width = 6, height = 5, seed = 42) {
  return toTileGrid(generateMaze({ width, height, seed }));
}

/** Grille gelée (objet et propriétés) : un Uint8Array ne peut pas être gelé, on le copie. */
function frozenGrid() {
  const g = realGrid();
  return Object.freeze({ width: g.width, height: g.height, tiles: g.tiles });
}

function hostileGrids() {
  const g = realGrid();
  return [
    null, undefined, 0, 'grid', [], {},
    { width: NaN, height: g.height, tiles: g.tiles },
    { width: Infinity, height: g.height, tiles: g.tiles },
    { width: g.width + 0.5, height: g.height, tiles: g.tiles },
    { width: -g.width, height: -g.height, tiles: g.tiles },
    { width: '13', height: g.height, tiles: g.tiles },
    { width: g.width, height: g.height, tiles: null },
    { width: g.width, height: g.height, tiles: 'x'.repeat(g.width * g.height) },
    { width: g.width, height: g.height, tiles: g.tiles.subarray(1) },
    { width: g.width, height: g.height },
    { width: 0, height: 0, tiles: new Uint8Array(0) },
  ];
}

describe('pathfinding.js : entrées hostiles', () => {
  test('grilles malformées : TypeError/RangeError, jamais de plantage silencieux ni de boucle', () => {
    for (const grid of hostileGrids()) {
      for (const fn of [
        () => tileDistances(grid, 1, 1),
        () => pathDistance(grid, 1, 1, 1, 1),
        () => shortestPath(grid, 1, 1, 1, 1),
      ]) {
        assert.throws(fn, (e) => e instanceof TypeError || e instanceof RangeError);
      }
    }
  });

  test('coordonnées hostiles (NaN, Infinity, flottants, chaînes...) rejetées', () => {
    const grid = realGrid();
    for (const v of HOSTILE_NUMBERS.filter((n) => n !== -1)) {
      assert.throws(() => tileDistances(grid, v, 1), TypeError, `tileDistances(${String(v)})`);
      assert.throws(() => pathDistance(grid, 1, 1, v, 1), TypeError, `pathDistance cible ${String(v)}`);
      assert.throws(() => shortestPath(grid, 1, v, 1, 1), TypeError, `shortestPath ${String(v)}`);
      if (v !== 1.5) assert.throws(() => tileAt(v, 0), TypeError, `tileAt(${String(v)})`);
      assert.throws(() => cellToTile(v, 0), TypeError, `cellToTile(${String(v)})`);
    }
    for (const [tx, ty] of [[-1, 1], [grid.width, 1], [1, grid.height], [0, 0], [1e9, 1e9]]) {
      assert.throws(() => tileDistances(grid, tx, ty), RangeError, `départ (${tx}, ${ty})`);
      assert.throws(() => pathDistance(grid, 1, 1, tx, ty), RangeError, `cible (${tx}, ${ty})`);
    }
  });

  test('grille gelée acceptée, entrée jamais modifiée, résultats indépendants et gelés', () => {
    const grid = frozenGrid();
    const before = Uint8Array.from(grid.tiles);
    const d1 = tileDistances(grid, 1, 1);
    d1.fill(7); // muter le résultat ne doit pas affecter un appel suivant
    const d2 = tileDistances(grid, 1, 1);
    assert.equal(d2[grid.width + 1], 0);
    const path = shortestPath(grid, 1, 1, grid.width - 2, grid.height - 2);
    assert.ok(Object.isFrozen(path) && path.every((p) => Object.isFrozen(p)));
    assert.throws(() => { path.push({ tx: 0, ty: 0 }); }, TypeError);
    assert.deepEqual(grid.tiles, before, 'tuiles inchangées');
    assert.ok(Object.isFrozen(NEIGHBOR_OFFSETS) && NEIGHBOR_OFFSETS.every((o) => Object.isFrozen(o)));
    assert.ok(Object.isFrozen(cellToTile(0, 0)) && Object.isFrozen(tileAt(0.5, 0.5)));
  });

  test('tuiles hostiles (valeurs hors TILE, sols isolés) : distances finies, pas de -1 en pathDistance', () => {
    const width = 7;
    const height = 7;
    const tiles = new Uint8Array(width * height).fill(255);
    tiles[1 * width + 1] = TILE.FLOOR;
    tiles[5 * width + 5] = TILE.FLOOR;
    const grid = { width, height, tiles };
    const dist = tileDistances(grid, 1, 1);
    assert.equal(dist.filter((d) => d !== UNREACHABLE).length, 1, 'valeurs inconnues = murs');
    assert.equal(pathDistance(grid, 1, 1, 5, 5), Infinity);
    assert.equal(shortestPath(grid, 1, 1, 5, 5), null);
  });

  test('plus grand labyrinthe (64 x 64) : BFS borné en temps', () => {
    const grid = realGrid(64, 64, 7);
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) tileDistances(grid, 1, 1);
    assert.ok(Date.now() - t0 < 2000, 'BFS 129 x 129 trop lent');
  });
});

describe('exit.js : entrées hostiles', () => {
  test('findExit : grilles malformées, paires, trop petites, départ mur, sortie absente', () => {
    for (const grid of hostileGrids()) {
      assert.throws(() => findExit(grid), (e) => e instanceof TypeError || e instanceof RangeError);
    }
    const even = { width: 6, height: 5, tiles: new Uint8Array(30) };
    assert.throws(() => findExit(even), RangeError);
    const small = { width: 3, height: 3, tiles: new Uint8Array(9) };
    assert.throws(() => findExit(small), RangeError);
    const walls = { width: 5, height: 5, tiles: new Uint8Array(25).fill(TILE.WALL) };
    assert.throws(() => findExit(walls), RangeError);
    const lonely = { width: 5, height: 5, tiles: new Uint8Array(25).fill(TILE.WALL) };
    lonely.tiles[6] = TILE.FLOOR; // (1, 1) seul, rien d'autre atteignable
    assert.throws(() => findExit(lonely), RangeError);
  });

  test('findExit : grille gelée non modifiée, résultat gelé et dans la grille', () => {
    const grid = frozenGrid();
    const before = Uint8Array.from(grid.tiles);
    const exit = findExit(grid);
    assert.ok(Object.isFrozen(exit));
    assert.throws(() => { exit.tx = 1; }, TypeError);
    assert.ok(exit.tx > 0 && exit.tx < grid.width && exit.ty > 0 && exit.ty < grid.height);
    assert.equal(grid.tiles[exit.ty * grid.width + exit.tx], TILE.FLOOR);
    assert.deepEqual(grid.tiles, before);
  });

  test('isAtExit : position/sortie hostiles -> TypeError, jamais true par coercition', () => {
    const exit = findExit(realGrid());
    for (const v of [NaN, Infinity, -Infinity, '3', null, undefined, true, {}, [], 1n]) {
      assert.throws(() => isAtExit({ x: v, y: exit.y }, exit), TypeError, `x=${String(v)}`);
      assert.throws(() => isAtExit({ x: exit.x, y: v }, exit), TypeError, `y=${String(v)}`);
    }
    for (const bad of [null, undefined, 42, 'exit', {}, { tx: String(exit.tx), ty: exit.ty },
      { tx: exit.tx + 0.5, ty: exit.ty }, { tx: NaN, ty: NaN }, { tx: Infinity, ty: exit.ty }]) {
      assert.throws(() => isAtExit({ x: exit.x, y: exit.y }, bad), TypeError);
    }
    for (const bad of [null, undefined, 'pos', 7]) {
      assert.throws(() => isAtExit(bad, exit), TypeError);
    }
    assert.equal(isAtExit(Object.freeze({ x: exit.x, y: exit.y }), exit), true);
    assert.equal(isAtExit({ x: exit.tx - 1e-9, y: exit.y }, exit), false, 'bord exclu');
  });
});

describe('game-state.js : états forgés', () => {
  test('états forgés ou malformés rejetés par toutes les fonctions', () => {
    const exit = findExit(realGrid());
    const forged = [
      null, undefined, 'won', 42, {}, [], { status: 'WON' }, { status: 'won ' },
      { status: { toString: () => 'won' } }, { status: '__proto__' }, { status: 'constructor' },
      Object.create({ status: 'nope' }),
    ];
    for (const state of forged) {
      assert.throws(() => isGameOver(state), TypeError);
      assert.throws(() => declareDefeat(state), TypeError);
      assert.throws(() => checkVictory(state, { x: exit.x, y: exit.y }, exit), TypeError);
    }
  });

  test('états gelés, constantes gelées, victoire jamais changée en défaite', () => {
    assert.ok(Object.isFrozen(GAME_STATUS));
    assert.throws(() => { GAME_STATUS.WON = 'lost'; }, TypeError);
    const s = createGameState();
    assert.ok(Object.isFrozen(s));
    assert.throws(() => { s.status = GAME_STATUS.WON; }, TypeError);
    assert.notEqual(createGameState(), s, 'nouvel état à chaque appel');
    const exit = findExit(realGrid());
    const won = checkVictory(s, { x: exit.x, y: exit.y }, exit);
    assert.equal(won.status, GAME_STATUS.WON);
    assert.ok(Object.isFrozen(won));
    assert.equal(s.status, GAME_STATUS.PLAYING, 'état d\'origine non muté');
    assert.equal(declareDefeat(won), won);
    const lost = declareDefeat(createGameState());
    assert.equal(checkVictory(lost, { x: exit.x, y: exit.y }, exit), lost, 'défaite définitive');
  });

  test('checkVictory : position/sortie hostiles levées même en partie finie', () => {
    const exit = findExit(realGrid());
    const won = checkVictory(createGameState(), { x: exit.x, y: exit.y }, exit);
    assert.throws(() => checkVictory(createGameState(), { x: NaN, y: NaN }, exit), TypeError);
    assert.throws(() => checkVictory(won, { x: Infinity, y: 0 }, exit), TypeError);
    assert.throws(() => checkVictory(createGameState(), { x: exit.x, y: exit.y }, null), TypeError);
  });
});

describe('exit-texture.js : entrées hostiles', () => {
  test('generateExitTexture : tailles hostiles -> RangeError (pas d\'allocation géante)', () => {
    for (const size of [NaN, Infinity, -64, 0, 4, 12, 63.5, 264, 1e9, 2 ** 31, '64', null, true, {}]) {
      assert.throws(() => generateExitTexture(PALETTE, size), RangeError, `size=${String(size)}`);
    }
  });

  test('generateExitTexture : palettes hostiles -> TypeError (aucune chaîne CSS injectée)', () => {
    const bad = ['#fff', 'red', '#12345g', '#1234567', ' #123456', 'url(http://x)', 'expression(1)',
      '#123456;', 123456, null, undefined, { toString: () => '#123456' }];
    for (const palette of [null, undefined, 'palette', 42]) {
      assert.throws(() => generateExitTexture(palette), TypeError);
    }
    for (const key of ['exitFrame', 'exitGlow', 'exitCore']) {
      for (const value of bad) {
        const palette = { ...PALETTE, [key]: value };
        assert.throws(() => generateExitTexture(palette), TypeError, `${key}=${String(value)}`);
      }
    }
  });

  test('generateExitTexture : palette gelée non modifiée, texture gelée, alpha 255', () => {
    const palette = Object.freeze({ ...PALETTE });
    const tex = generateExitTexture(palette, 8);
    assert.ok(Object.isFrozen(tex));
    assert.equal(tex.data.length, 8 * 8 * 4);
    for (let i = 3; i < tex.data.length; i += 4) assert.equal(tex.data[i], 255);
    assert.deepEqual(palette, { ...PALETTE });
    assert.ok(Number.isFinite(EXIT_FOG_SCALE) && EXIT_FOG_SCALE > 0 && EXIT_FOG_SCALE <= 1);
  });

  test('isExitFace : jamais d\'exception, false pour toute entrée hostile', () => {
    const exit = { tx: 3, ty: 3 };
    const hit = { side: 'x', tileX: 4, tileY: 3 };
    const player = { x: 3.5, y: 3.5 };
    assert.equal(isExitFace(hit, player, exit), true, 'cas nominal');
    const values = [null, undefined, 0, 'x', NaN, Infinity, {}, [], 1n, Symbol('s')];
    for (const v of values) {
      assert.equal(isExitFace(v, player, exit), false);
      assert.equal(isExitFace(hit, v, exit), false);
      assert.equal(isExitFace(hit, player, v), false);
      assert.equal(isExitFace({ ...hit, tileX: v }, player, exit), false);
      if (v !== 'x') assert.equal(isExitFace({ ...hit, side: v }, player, exit), false);
      if (v !== 0) {
        assert.equal(isExitFace(hit, { x: v, y: 3.5 }, exit), false, `player.x=${String(v)}`);
        assert.equal(isExitFace(hit, player, { tx: v, ty: 3 }), false, `exit.tx=${String(v)}`);
      }
    }
    assert.equal(isExitFace({ side: 'x', tileX: '4', tileY: '3' }, player, exit), false, 'pas de coercition');
    assert.equal(isExitFace(Object.create(hit), player, exit), true, 'prototype lu sans plantage');
  });
});

describe('scan statique des fichiers T4', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const FILES = [
    'src/game/pathfinding.js', 'src/game/exit.js', 'src/game/game-state.js',
    'src/render/exit-texture.js', 'src/main.js', 'src/index.html', 'src/styles.css',
  ];
  const FORBIDDEN = [
    [/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/, 'sink HTML'],
    [/\beval\s*\(|new\s+Function\b/, 'exécution dynamique'],
    [/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(/, 'réseau'],
    [/localStorage|sessionStorage|indexedDB|document\.cookie|\bcaches\b/, 'stockage'],
    [/\bconsole\./, 'log'],
    [/https?:\/\/|\/\/[a-z0-9.-]+\.[a-z]{2,}\//i, 'URL absolue'],
    [/(?:src|href)\s*=\s*["']\/|url\(\s*["']?\//, 'chemin absolu'],
    [/Math\.random/, 'aléa non déterministe'],
  ];

  test('aucun sink HTML, réseau, stockage, log, URL ou chemin absolu', () => {
    const hits = [];
    for (const file of FILES) {
      const lines = readFileSync(ROOT + file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const [pattern, label] of FORBIDDEN) {
          if (pattern.test(line)) hits.push(`${file}:${i + 1} [${label}] ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(hits, []);
  });

  test('main.js : textes de fin via textContent et i18n uniquement', () => {
    const src = readFileSync(ROOT + 'src/main.js', 'utf8');
    for (const target of ['endTitle', 'endMessage']) {
      const writes = src.match(new RegExp(`${target}\\.\\w+\\s*=`, 'g')) ?? [];
      assert.ok(writes.length > 0, `${target} écrit`);
      assert.ok(writes.every((w) => w.startsWith(`${target}.textContent`)), `${target} : ${writes}`);
    }
    assert.match(src, /endTitle\.textContent\s*=\s*t\(/);
    assert.match(src, /endMessage\.textContent\s*=\s*t\(/);
  });

  test('index.html : écran de fin sans gestionnaire on* ni texte en dur', () => {
    const html = readFileSync(ROOT + 'src/index.html', 'utf8');
    const block = html.slice(html.indexOf('id="end-screen"'), html.indexOf('</main>'));
    assert.ok(block.length > 0);
    assert.doesNotMatch(block, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(block, /<(h2|p|button)[^>]*>[^<\s][^<]*</, 'textes via data-i18n seulement');
    assert.match(html, /id="end-screen"[^>]*\shidden/);
  });
});
