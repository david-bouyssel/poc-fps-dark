// Plan docs/design/fps-automap.md §6.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTOMAP_MODE,
  REVEAL,
  AUTOMAP_LAYOUT,
  createExploredMask,
  revealVisibleTiles,
  automapLayout,
} from '../../src/render/automap.js';
import { PALETTE } from '../../src/render/palette.js';
import { gridFromRows, room } from './fps-test-grids.js';

const at = (grid, mask, x, y) => mask[y * grid.width + x];
const count = (mask) => mask.reduce((a, v) => a + v, 0);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

// Couloir est-ouest : sol x = 1..10 sur y = 1, mur du bout en x = 11.
const corridor = gridFromRows(['############', '#..........#', '############']);

describe('constantes', () => {
  test('gelées et conformes au plan', () => {
    assert.deepEqual({ ...AUTOMAP_MODE }, { MINI: 'mini', FULL: 'full' });
    assert.deepEqual({ ...REVEAL }, { rayCount: 64, maxDistance: 12, step: 0.05 });
    assert.deepEqual({ ...AUTOMAP_LAYOUT }, {
      miniRatio: 0.3, miniMin: 96, miniMax: 240, miniMargin: 16, miniViewTiles: 15, fullPadding: 24,
    });
    for (const o of [AUTOMAP_MODE, REVEAL, AUTOMAP_LAYOUT]) assert.ok(Object.isFrozen(o));
  });
});

describe('createExploredMask', () => {
  test('taille width*height, tout à 0', () => {
    const g = room(7, 5);
    const m = createExploredMask(g);
    assert.ok(m instanceof Uint8Array);
    assert.equal(m.length, 35);
    assert.equal(count(m), 0);
  });

  test('TypeError sur grille mal formée', () => {
    const bad = [
      null,
      undefined,
      {},
      { width: 3, height: 3 },
      { width: 3, height: 3, tiles: new Uint8Array(8) },
      { width: 2.5, height: 2, tiles: new Uint8Array(5) },
      { width: 0, height: 3, tiles: new Uint8Array(0) },
      { width: 3, height: -1, tiles: new Uint8Array(0) },
      { width: NaN, height: 3, tiles: new Uint8Array(9) },
    ];
    for (const g of bad) assert.throws(() => createExploredMask(g), TypeError);
  });
});

describe('revealVisibleTiles', () => {
  test('marque la tuile du joueur et ses 8 voisines', () => {
    const g = room(11, 11);
    const m = createExploredMask(g);
    const n = revealVisibleTiles(m, g, { x: 5.5, y: 5.5, angle: 0 });
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.equal(at(g, m, 5 + dx, 5 + dy), 1);
    assert.ok(n >= 9);
    assert.equal(n, count(m));
  });

  test("couloir regardé vers l'est : sol jusqu'au mur du bout inclus", () => {
    const m = createExploredMask(corridor);
    revealVisibleTiles(m, corridor, { x: 2.5, y: 1.5, angle: 0 });
    for (let x = 1; x <= 11; x++) assert.equal(at(corridor, m, x, 1), 1, `x=${x}`);
  });

  test("pièce fermée : rien au-delà du mur d'enceinte", () => {
    const g = gridFromRows([
      '..........',
      '.#####....',
      '.#...#....',
      '.#...#....',
      '.#####....',
      '..........',
    ]);
    for (const angle of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI, 0.7]) {
      const m = createExploredMask(g);
      revealVisibleTiles(m, g, { x: 3.5, y: 2.5, angle });
      for (const [x, y] of [[0, 0], [0, 2], [6, 2], [8, 3], [3, 0], [3, 5], [9, 5]]) {
        assert.equal(at(g, m, x, y), 0, `angle ${angle} (${x},${y})`);
      }
    }
  });

  test('derrière le joueur (hors FOV, hors voisines) : rien', () => {
    const g = room(21, 21);
    const m = createExploredMask(g);
    revealVisibleTiles(m, g, { x: 10.5, y: 10.5, angle: 0 });
    for (let x = 1; x <= 7; x++) assert.equal(at(g, m, x, 10), 0, `x=${x}`);
    assert.equal(at(g, m, 12, 10), 1);
  });

  test('maxDistance réduite : tuiles au-delà non marquées', () => {
    const m = createExploredMask(corridor);
    revealVisibleTiles(m, corridor, { x: 2.5, y: 1.5, angle: 0 }, { maxDistance: 3 });
    assert.equal(at(corridor, m, 5, 1), 1);
    for (let x = 8; x <= 11; x++) assert.equal(at(corridor, m, x, 1), 0, `x=${x}`);
  });

  test('retour = nouvelles tuiles ; second appel 0 et masque inchangé', () => {
    const g = room(15, 15);
    const m = createExploredMask(g);
    const p = { x: 7.5, y: 7.5, angle: 1 };
    const n = revealVisibleTiles(m, g, p);
    assert.equal(n, count(m));
    const snapshot = Uint8Array.from(m);
    assert.equal(revealVisibleTiles(m, g, p), 0);
    assert.deepEqual(m, snapshot);
  });

  test('retour ne compte que les tuiles nouvelles', () => {
    const g = room(15, 15);
    const m = createExploredMask(g);
    const a = revealVisibleTiles(m, g, { x: 7.5, y: 7.5, angle: 0 });
    const b = revealVisibleTiles(m, g, { x: 7.5, y: 7.5, angle: Math.PI });
    assert.equal(a + b, count(m));
    assert.ok(b > 0);
  });

  test('jamais hors grille, masque en 0/1, angles alignés près des bords', () => {
    const g = room(9, 9);
    const spots = [[1.01, 1.01], [7.99, 7.99], [4.5, 1.2], [1.2, 4.5]];
    for (const [x, y] of spots) {
      for (const angle of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI, -3, 100]) {
        const m = createExploredMask(g);
        const n = revealVisibleTiles(m, g, { x, y, angle });
        assert.equal(m.length, 81);
        assert.ok(m.every((v) => v === 0 || v === 1));
        assert.equal(n, count(m));
      }
    }
  });

  test('joueur sur le bord de la grille : voisines hors grille ignorées', () => {
    const g = gridFromRows(['...', '...', '...']);
    const m = createExploredMask(g);
    revealVisibleTiles(m, g, { x: 0.5, y: 0.5, angle: Math.PI });
    assert.equal(m.length, 9);
    assert.equal(at(g, m, 0, 0), 1);
    assert.equal(at(g, m, 1, 1), 1);
  });

  test('TypeError : masque de mauvaise taille', () => {
    const g = room(5, 5);
    assert.throws(() => revealVisibleTiles(new Uint8Array(24), g, { x: 2.5, y: 2.5, angle: 0 }), TypeError);
    assert.throws(() => revealVisibleTiles(null, g, { x: 2.5, y: 2.5, angle: 0 }), TypeError);
  });

  test('TypeError : player non fini', () => {
    const g = room(5, 5);
    const m = createExploredMask(g);
    for (const p of [
      { x: NaN, y: 2.5, angle: 0 },
      { x: 2.5, y: Infinity, angle: 0 },
      { x: 2.5, y: 2.5, angle: NaN },
      { x: 2.5, y: 2.5, angle: -Infinity },
    ]) assert.throws(() => revealVisibleTiles(m, g, p), TypeError);
  });

  test('TypeError : options invalides', () => {
    const g = room(5, 5);
    const m = createExploredMask(g);
    const p = { x: 2.5, y: 2.5, angle: 0 };
    for (const o of [
      { rayCount: 0 },
      { rayCount: 2.5 },
      { step: 0 },
      { step: -0.1 },
      { maxDistance: 0 },
      { maxDistance: -1 },
      { fov: 0 },
      { fov: -1 },
      { fov: 7 },
    ]) assert.throws(() => revealVisibleTiles(m, g, p, o), TypeError, JSON.stringify(o));
  });
});

describe('automapLayout', () => {
  const g = room(17, 17);
  const player = { x: 8.5, y: 6.5 };

  test('MINI : carré dans le canvas, coin bas-gauche, joueur au centre', () => {
    const l = automapLayout(AUTOMAP_MODE.MINI, g, player, 800, 600);
    assert.equal(l.panelWidth, l.panelHeight);
    assert.equal(l.panelWidth, 180);
    assert.equal(l.panelX, AUTOMAP_LAYOUT.miniMargin);
    near(l.panelY + l.panelHeight, 600 - AUTOMAP_LAYOUT.miniMargin);
    assert.ok(l.panelX >= 0 && l.panelX + l.panelWidth <= 800);
    assert.ok(l.panelY >= 0 && l.panelY + l.panelHeight <= 600);
    near(l.scale, 180 / AUTOMAP_LAYOUT.miniViewTiles);
    near(l.originX + player.x * l.scale, l.panelX + l.panelWidth / 2);
    near(l.originY + player.y * l.scale, l.panelY + l.panelHeight / 2);
  });

  test('MINI : côté borné par miniMax sur grand canvas', () => {
    const l = automapLayout('mini', g, player, 3000, 2000);
    assert.equal(l.panelWidth, AUTOMAP_LAYOUT.miniMax);
  });

  test('MINI : côté >= miniMin sur canvas moyen', () => {
    const l = automapLayout('mini', g, player, 400, 300);
    assert.ok(l.panelWidth >= AUTOMAP_LAYOUT.miniMin);
    assert.ok(l.panelWidth <= 300);
  });

  test('FULL : panneau = canvas, labyrinthe centré, même échelle x/y', () => {
    const grid = gridFromRows(Array.from({ length: 10 }, () => '.'.repeat(20)));
    const l = automapLayout('full', grid, { x: 1.5, y: 1.5 }, 800, 600);
    assert.deepEqual([l.panelX, l.panelY, l.panelWidth, l.panelHeight], [0, 0, 800, 600]);
    const p = AUTOMAP_LAYOUT.fullPadding;
    near(l.scale, Math.min((800 - 2 * p) / 20, (600 - 2 * p) / 10));
    const left = l.originX;
    const right = l.originX + 20 * l.scale;
    const top = l.originY;
    const bottom = l.originY + 10 * l.scale;
    assert.ok(left >= p - 1e-6 && right <= 800 - p + 1e-6);
    assert.ok(top >= p - 1e-6 && bottom <= 600 - p + 1e-6);
    near(left, 800 - right);
    near(top, 600 - bottom);
  });

  test('FULL : labyrinthe carré limité par la hauteur', () => {
    const l = automapLayout('full', g, player, 800, 600);
    near(l.scale, (600 - 2 * AUTOMAP_LAYOUT.fullPadding) / 17);
    near(l.originX, (800 - 17 * l.scale) / 2);
  });

  test('petits canvas : valeurs finies, côté >= 1', () => {
    for (const [w, h] of [[50, 50], [10, 10], [1, 1], [30, 400]]) {
      for (const mode of ['mini', 'full']) {
        const l = automapLayout(mode, g, player, w, h);
        for (const [k, v] of Object.entries(l)) assert.ok(Number.isFinite(v), `${mode} ${w}x${h} ${k}=${v}`);
        assert.ok(l.panelWidth >= 1 && l.panelHeight >= 1);
        assert.ok(l.scale > 0);
      }
    }
  });

  test('objet gelé', () => {
    assert.ok(Object.isFrozen(automapLayout('mini', g, player, 800, 600)));
    assert.ok(Object.isFrozen(automapLayout('full', g, player, 800, 600)));
  });

  test('TypeError : mode inconnu, dimensions invalides', () => {
    assert.throws(() => automapLayout('huge', g, player, 800, 600), TypeError);
    assert.throws(() => automapLayout(undefined, g, player, 800, 600), TypeError);
    for (const [w, h] of [[0, 600], [800, 0], [-1, 600], [800, -5], [NaN, 600], [800, Infinity]]) {
      assert.throws(() => automapLayout('mini', g, player, w, h), TypeError, `${w}x${h}`);
      assert.throws(() => automapLayout('full', g, player, w, h), TypeError, `${w}x${h}`);
    }
  });
});

describe('clés automap* de PALETTE', () => {
  for (const key of ['automapBackground', 'automapFloor', 'automapWall', 'automapPlayer']) {
    test(key, () => {
      assert.match(PALETTE[key], /^#[0-9a-f]{6}$/i);
    });
  }
});
