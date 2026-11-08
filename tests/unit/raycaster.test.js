import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, isWallTile, TILE } from '../../src/maze/grid.js';
import { createRng } from '../../src/maze/random.js';
import {
  FOV,
  MIN_DISTANCE,
  castRays,
  projectColumn,
  fogFactor,
  mixColor,
} from '../../src/render/raycaster.js';

const EPSILON = 1e-9;

/**
 * Grille faite main : '#' = mur, '.' = sol.
 * @param {string[]} rows
 */
function gridFromRows(rows) {
  const height = rows.length;
  const width = rows[0].length;
  const tiles = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles[y * width + x] = rows[y][x] === '#' ? TILE.WALL : TILE.FLOOR;
    }
  }
  return { width, height, tiles };
}

/** Pièce rectangulaire fermée : intérieur de (w - 2) x (h - 2) tuiles de sol. */
function room(width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row += border ? '#' : '.';
    }
    rows.push(row);
  }
  return gridFromRows(rows);
}

function assertValidHit(grid, hit) {
  assert.ok(Number.isFinite(hit.distance), `distance finie : ${hit.distance}`);
  assert.ok(hit.distance >= MIN_DISTANCE, `distance >= MIN_DISTANCE : ${hit.distance}`);
  assert.ok(hit.side === 'x' || hit.side === 'y', `side : ${hit.side}`);
  assert.ok(Number.isInteger(hit.tileX) && Number.isInteger(hit.tileY));
  assert.ok(hit.wallX >= 0 && hit.wallX < 1, `wallX dans [0, 1) : ${hit.wallX}`);
  assert.ok(isWallTile(grid, hit.tileX, hit.tileY), `tuile mur : ${hit.tileX},${hit.tileY}`);
}

describe('constantes', () => {
  test('FOV = PI/3 et MIN_DISTANCE = 0.05', () => {
    assert.equal(FOV, Math.PI / 3);
    assert.equal(MIN_DISTANCE, 0.05);
  });
});

describe('castRays', () => {
  test('rayon central : distance exacte, side x, tuile touchée', () => {
    const grid = gridFromRows([
      '#####',
      '#...#',
      '#####',
    ]);
    const [hit] = castRays(grid, { x: 1.5, y: 1.5, angle: 0 }, 1);
    assert.ok(Math.abs(hit.distance - 2.5) < EPSILON);
    assert.equal(hit.side, 'x');
    assert.equal(hit.tileX, 4);
    assert.equal(hit.tileY, 1);
    assert.ok(Math.abs(hit.wallX - 0.5) < EPSILON);
  });

  test('rayon central vers le sud : side y', () => {
    const grid = room(3, 6);
    const [hit] = castRays(grid, { x: 1.5, y: 1.5, angle: Math.PI / 2 }, 1);
    assert.ok(Math.abs(hit.distance - 3.5) < EPSILON);
    assert.equal(hit.side, 'y');
    assert.equal(hit.tileX, 1);
    assert.equal(hit.tileY, 5);
  });

  test('anti fish-eye : mur plat perpendiculaire -> distance constante', () => {
    const grid = room(11, 21);
    const hits = castRays(grid, { x: 1.5, y: 10.5, angle: 0 }, 101);
    for (const hit of hits) {
      assert.ok(Math.abs(hit.distance - 8.5) < EPSILON, `distance ${hit.distance}`);
      assert.equal(hit.side, 'x');
      assert.equal(hit.tileX, 10);
    }
  });

  test('angles alignés sur les axes : ni NaN ni Infinity', () => {
    const grid = room(7, 7);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      for (const columnCount of [1, 2, 3, 64]) {
        const hits = castRays(grid, { x: 3.5, y: 3.5, angle }, columnCount);
        for (const hit of hits) {
          assert.ok(Number.isFinite(hit.distance));
          assert.ok(Number.isFinite(hit.wallX));
          assertValidHit(grid, hit);
        }
      }
    }
  });

  test('joueur sur une frontière de tuile, angle axial : pas de NaN', () => {
    const grid = room(7, 7);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const hits = castRays(grid, { x: 3, y: 3, angle }, 5);
      for (const hit of hits) assertValidHit(grid, hit);
    }
  });

  test('longueur = columnCount ; columnCount 1 accepté', () => {
    const grid = room(5, 5);
    const player = { x: 2.5, y: 2.5, angle: 0.3 };
    assert.equal(castRays(grid, player, 1).length, 1);
    assert.equal(castRays(grid, player, 37).length, 37);
  });

  test('columnCount invalide -> RangeError', () => {
    const grid = room(5, 5);
    const player = { x: 2.5, y: 2.5, angle: 0 };
    for (const columnCount of [0, -1, 1.5, NaN, Infinity]) {
      assert.throws(() => castRays(grid, player, columnCount), RangeError);
    }
  });

  test('fov invalide -> RangeError', () => {
    const grid = room(5, 5);
    const player = { x: 2.5, y: 2.5, angle: 0 };
    for (const fov of [0, -0.1, Math.PI, 4, NaN]) {
      assert.throws(() => castRays(grid, player, 10, fov), RangeError);
    }
    assert.equal(castRays(grid, player, 10, Math.PI / 2).length, 10);
  });

  test('impacts gelés', () => {
    const [hit] = castRays(room(5, 5), { x: 2.5, y: 2.5, angle: 0 }, 1);
    assert.ok(Object.isFrozen(hit));
  });

  test('ordre gauche -> droite à l\'écran', () => {
    const grid = room(11, 21);
    // Facing east in a y-down frame, screen left is north (smaller y).
    const hits = castRays(grid, { x: 1.5, y: 10.5, angle: 0 }, 21);
    const impactY = (hit) => hit.tileY + hit.wallX;
    for (let i = 1; i < hits.length; i++) {
      assert.ok(impactY(hits[i]) > impactY(hits[i - 1]));
    }
  });

  test('tourner légèrement à droite décale l\'impact central vers +y', () => {
    const grid = room(11, 21);
    const [before] = castRays(grid, { x: 1.5, y: 10.5, angle: 0 }, 1);
    const [after] = castRays(grid, { x: 1.5, y: 10.5, angle: 0.1 }, 1);
    assert.equal(before.tileX, 10);
    assert.equal(after.tileX, 10);
    assert.ok(after.tileY + after.wallX > before.tileY + before.wallX);
  });

  test('labyrinthe 16x16 : 100 positions/angles -> impacts valides', () => {
    const grid = toTileGrid(generateMaze({ width: 16, height: 16, seed: 42 }));
    const rng = createRng(2024);
    let checked = 0;
    while (checked < 100) {
      const x = 1 + rng() * (grid.width - 2);
      const y = 1 + rng() * (grid.height - 2);
      if (isWallTile(grid, Math.floor(x), Math.floor(y))) continue;
      const angle = rng() * 2 * Math.PI;
      const hits = castRays(grid, { x, y, angle }, 32);
      assert.equal(hits.length, 32);
      for (const hit of hits) assertValidHit(grid, hit);
      checked++;
    }
  });

  test('ne modifie ni la grille ni le joueur', () => {
    const grid = room(6, 6);
    const tilesCopy = Uint8Array.from(grid.tiles);
    const player = Object.freeze({ x: 2.5, y: 2.5, angle: 1 });
    castRays(grid, player, 16);
    assert.deepEqual(grid.tiles, tilesCopy);
  });
});

describe('projectColumn', () => {
  test('distance 1 -> pleine hauteur', () => {
    assert.deepEqual(projectColumn(1, 400), { top: 0, bottom: 400 });
  });

  test('distance 2 -> moitié centrée', () => {
    assert.deepEqual(projectColumn(2, 400), { top: 100, bottom: 300 });
  });

  test('distance très petite -> bornée à [0, viewHeight]', () => {
    for (const distance of [0.01, 0, -3]) {
      const { top, bottom } = projectColumn(distance, 400);
      assert.equal(top, 0);
      assert.equal(bottom, 400);
    }
  });

  test('distance infinie -> colonne vide au centre', () => {
    const { top, bottom } = projectColumn(Infinity, 400);
    assert.equal(top, 200);
    assert.equal(bottom, 200);
  });

  test('entrées invalides -> RangeError', () => {
    assert.throws(() => projectColumn(NaN, 400), RangeError);
    assert.throws(() => projectColumn(1, -1), RangeError);
    assert.throws(() => projectColumn(1, Infinity), RangeError);
  });
});

describe('fogFactor', () => {
  test('0 à distance 0', () => {
    assert.equal(fogFactor(0), 0);
  });

  test('monotone croissant et plafonné à maxFog (défauts 8 et 0.6)', () => {
    let previous = -1;
    for (let distance = 0; distance <= 20; distance += 0.25) {
      const value = fogFactor(distance);
      assert.ok(value >= previous);
      assert.ok(value >= 0 && value <= 0.6);
      previous = value;
    }
    assert.ok(Math.abs(fogFactor(4) - 0.3) < EPSILON);
    assert.equal(fogFactor(8), 0.6);
    assert.equal(fogFactor(100), 0.6);
  });

  test('options prises en compte', () => {
    assert.ok(Math.abs(fogFactor(2, { fogDistance: 4, maxFog: 1 }) - 0.5) < EPSILON);
    assert.equal(fogFactor(10, { fogDistance: 4, maxFog: 0.2 }), 0.2);
  });

  test('options invalides -> RangeError', () => {
    assert.throws(() => fogFactor(1, { fogDistance: 0 }), RangeError);
    assert.throws(() => fogFactor(1, { maxFog: 2 }), RangeError);
  });
});

describe('mixColor', () => {
  test('t = 0 -> A, t = 1 -> B (minuscules)', () => {
    assert.equal(mixColor('#B9A6E8', '#fff8ef', 0), '#b9a6e8');
    assert.equal(mixColor('#b9a6e8', '#FFF8EF', 1), '#fff8ef');
  });

  test('t = 0.5 -> moyenne arrondie', () => {
    assert.equal(mixColor('#000000', '#ffffff', 0.5), '#808080');
    assert.equal(mixColor('#102030', '#203040', 0.5), '#182838');
  });

  test('t hors bornes borné', () => {
    assert.equal(mixColor('#102030', '#405060', -2), '#102030');
    assert.equal(mixColor('#102030', '#405060', 3), '#405060');
  });

  test('couleur invalide -> TypeError', () => {
    for (const bad of ['#fff', 'b9a6e8', '#gggggg', '', null, 123, '#b9a6e8ff']) {
      assert.throws(() => mixColor(bad, '#ffffff', 0.5), TypeError);
      assert.throws(() => mixColor('#ffffff', bad, 0.5), TypeError);
    }
  });
});
