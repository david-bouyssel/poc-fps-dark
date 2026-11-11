// Tests unitaires de src/render/sprites.js, d'après le plan docs/design/fps-fruits-score.md
// (§3 géométrie de projection, §6 plan de tests).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { projectSprites, isSpriteColumnVisible } from '../../src/render/sprites.js';
import { castRays, FOV, MIN_DISTANCE } from '../../src/render/raycaster.js';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';

const W = 640;
const H = 480;
const EPS = 1e-9;
const player = Object.freeze({ x: 1.5, y: 1.5, angle: 0 });
const close = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

describe('projectSprites', () => {
  test('sprite droit devant à distance d : centre, profondeur, taille, pied au sol', () => {
    for (const d of [0.5, 1, 3, 7.25]) {
      const [s, ...rest] = projectSprites([{ x: 1.5 + d, y: 1.5, kind: 'peach' }], player, W, H);
      assert.equal(rest.length, 0);
      assert.equal(s.kind, 'peach');
      assert.ok(close(s.depth, d), `depth ${s.depth}`);
      assert.ok(close(s.screenX, W / 2), `screenX ${s.screenX}`);
      assert.ok(close(s.size, (H * 0.35) / d), `size ${s.size}`);
      assert.ok(close(s.bottom, H / 2 + H / (2 * d)), `bottom ${s.bottom}`);
      assert.ok(close(s.top, s.bottom - s.size), `top ${s.top}`);
      assert.ok(close(s.left, s.screenX - s.size / 2), `left ${s.left}`);
      assert.ok(close(s.right, s.screenX + s.size / 2), `right ${s.right}`);
    }
  });

  test('option worldSize et fov', () => {
    const [s] = projectSprites([{ x: 3.5, y: 1.5, kind: 'cherry' }], player, W, H, { worldSize: 0.5 });
    assert.ok(close(s.size, (H * 0.5) / 2));
    // Décalage latéral 1 à profondeur 2 : cameraX = 1 / (2 tan(fov/2)).
    const fov = Math.PI / 2;
    const [t] = projectSprites([{ x: 3.5, y: 2.5, kind: 'cherry' }], player, W, H, { fov });
    const cameraX = 1 / (2 * Math.tan(fov / 2));
    assert.ok(close(t.screenX, ((cameraX + 1) / 2) * W), `screenX ${t.screenX}`);
  });

  test('angle quelconque : profondeur = projection sur la direction', () => {
    const p = { x: 5, y: 5, angle: Math.PI / 2 }; // regarde vers +y (bas)
    const [s] = projectSprites([{ x: 5, y: 9, kind: 'peach' }], p, W, H);
    assert.ok(close(s.depth, 4));
    assert.ok(close(s.screenX, W / 2));
    // Regard vers +y : le vecteur droit (-sin a, cos a) vaut (-1, 0), x plus petit = droite.
    const [r] = projectSprites([{ x: 4.5, y: 9, kind: 'peach' }], p, W, H);
    assert.ok(r.screenX > W / 2, `screenX ${r.screenX}`);
  });

  test('sprite à gauche (y plus petit en regardant vers +x) -> screenX < centre ; à droite -> >', () => {
    const [left] = projectSprites([{ x: 4.5, y: 1.0, kind: 'peach' }], player, W, H);
    assert.ok(left.screenX < W / 2, `gauche : ${left.screenX}`);
    const [right] = projectSprites([{ x: 4.5, y: 2.0, kind: 'peach' }], player, W, H);
    assert.ok(right.screenX > W / 2, `droite : ${right.screenX}`);
  });

  test('derrière le joueur, à depth <= MIN_DISTANCE ou hors champ -> exclu', () => {
    const excluded = [
      { x: 0.5, y: 1.5, kind: 'peach' }, // derrière
      { x: 1.5, y: 1.5, kind: 'peach' }, // sur le joueur
      { x: 0, y: 0, kind: 'peach' }, // derrière, en diagonale
      { x: 1.5 + MIN_DISTANCE - 1e-12, y: 1.5, kind: 'peach' }, // depth ~ MIN_DISTANCE (arrondi flottant)
      { x: 1.5 + MIN_DISTANCE / 2, y: 1.5, kind: 'peach' },
      { x: 1.5, y: 9.5, kind: 'peach' }, // plein côté (depth 0)
      { x: 2.5, y: 9.5, kind: 'peach' }, // très latéral, hors écran
      { x: 2.5, y: -6.5, kind: 'peach' },
    ];
    assert.deepEqual(projectSprites(excluded, player, W, H), []);
    // depth exactement MIN_DISTANCE (joueur en x = 0) -> exclu
    assert.deepEqual(projectSprites([{ x: MIN_DISTANCE, y: 0, kind: 'peach' }], { x: 0, y: 0, angle: 0 }, W, H), []);
  });

  test('liste vide -> tableau vide', () => {
    assert.deepEqual(projectSprites([], player, W, H), []);
  });

  test('tri du plus loin au plus proche (ordre du peintre)', () => {
    const sprites = [
      { x: 3.5, y: 1.5, kind: 'a' },
      { x: 9.5, y: 1.6, kind: 'b' },
      { x: 2.5, y: 1.4, kind: 'c' },
      { x: 6.5, y: 1.5, kind: 'd' },
    ];
    const out = projectSprites(sprites, player, W, H);
    assert.deepEqual(out.map((s) => s.kind), ['b', 'd', 'a', 'c']);
    for (let i = 1; i < out.length; i++) assert.ok(out[i].depth <= out[i - 1].depth);
  });

  test('entrée non mutée', () => {
    const sprites = Object.freeze([Object.freeze({ x: 3.5, y: 1.5, kind: 'peach' })]);
    assert.doesNotThrow(() => projectSprites(sprites, Object.freeze({ ...player }), W, H));
  });

  test('cohérence avec castRays : un sprite au point d\'impact du rayon c se projette en colonne c', () => {
    const grid = toTileGrid(generateMaze({ width: 8, height: 8, seed: 42 }));
    const COLUMNS = 64;
    const views = [
      { x: 1.5, y: 1.5, angle: 0 },
      { x: 1.5, y: 1.5, angle: Math.PI / 2 },
      { x: 1.7, y: 1.3, angle: 0.7 },
      { x: 1.4, y: 1.6, angle: 2.1 },
      { x: 1.5, y: 1.5, angle: -2.5 },
    ];
    for (const p of views) {
      const hits = castRays(grid, p, COLUMNS);
      const dirX = Math.cos(p.angle);
      const dirY = Math.sin(p.angle);
      const scale = Math.tan(FOV / 2);
      for (const c of [0, 5, 20, 31, 32, 47, 63]) {
        const cameraX = (2 * (c + 0.5)) / COLUMNS - 1;
        const rx = dirX - dirY * scale * cameraX;
        const ry = dirY + dirX * scale * cameraX;
        const d = hits[c].distance * 0.999;
        const sprite = { x: p.x + rx * d, y: p.y + ry * d, kind: 'peach' };
        const out = projectSprites([sprite], p, COLUMNS, H);
        if (d <= MIN_DISTANCE) continue;
        assert.equal(out.length, 1, `angle ${p.angle} colonne ${c}`);
        assert.ok(close(out[0].depth, d, 1e-6), `depth ${out[0].depth} vs ${d}`);
        assert.equal(Math.floor(out[0].screenX), c, `angle ${p.angle} colonne ${c} : screenX ${out[0].screenX}`);
        assert.equal(isSpriteColumnVisible(out[0].depth, hits[c]), true);
        // Juste derrière le mur : masqué dans cette colonne.
        const behind = projectSprites([{ x: p.x + rx * hits[c].distance * 1.01, y: p.y + ry * hits[c].distance * 1.01, kind: 'peach' }], p, COLUMNS, H);
        assert.equal(isSpriteColumnVisible(behind[0].depth, hits[c]), false);
      }
    }
  });

  test('entrées invalides -> TypeError ou RangeError', () => {
    const isErr = (e) => e instanceof TypeError || e instanceof RangeError;
    const ok = [{ x: 3.5, y: 1.5, kind: 'peach' }];
    const bad = [
      () => projectSprites(null, player, W, H),
      () => projectSprites('x', player, W, H),
      () => projectSprites([null], player, W, H),
      () => projectSprites([{ x: NaN, y: 1, kind: 'peach' }], player, W, H),
      () => projectSprites(ok, null, W, H),
      () => projectSprites(ok, { x: 1, y: 1, angle: NaN }, W, H),
      () => projectSprites(ok, { x: Infinity, y: 1, angle: 0 }, W, H),
      () => projectSprites(ok, player, 0, H),
      () => projectSprites(ok, player, W, -1),
      () => projectSprites(ok, player, NaN, H),
      () => projectSprites(ok, player, W, Infinity),
      () => projectSprites(ok, player, W, H, { fov: 0 }),
      () => projectSprites(ok, player, W, H, { fov: Math.PI }),
      () => projectSprites(ok, player, W, H, { worldSize: -1 }),
      () => projectSprites(ok, player, W, H, { worldSize: NaN }),
    ];
    bad.forEach((fn, i) => assert.throws(fn, isErr, `cas ${i}`));
  });
});

describe('projectSprites : sprite.worldSize par sprite', () => {
  // Sprite droit devant à distance 2 : size = H * worldSize / depth.
  const ahead = { x: 3.5, y: 1.5 };

  test('sprite.worldSize fourni : prioritaire sur options.worldSize', () => {
    const [s] = projectSprites([{ ...ahead, kind: 'monster', worldSize: 0.5 }], player, W, H, { worldSize: 0.2 });
    assert.ok(close(s.size, (H * 0.5) / 2), `size ${s.size}`);
    assert.equal(s.worldSize, 0.5);
  });

  test('sprite.worldSize absent : options.worldSize utilisé, sinon défaut 0.35', () => {
    const [byOption] = projectSprites([{ ...ahead, kind: 'monster' }], player, W, H, { worldSize: 0.2 });
    assert.ok(close(byOption.size, (H * 0.2) / 2));
    assert.equal(byOption.worldSize, 0.2);
    const [byDefault] = projectSprites([{ ...ahead, kind: 'monster' }], player, W, H);
    assert.ok(close(byDefault.size, (H * 0.35) / 2));
    assert.equal(byDefault.worldSize, 0.35);
  });

  test('sprite.worldSize explicitement undefined : traité comme absent (défaut 0.35)', () => {
    const [s] = projectSprites([{ ...ahead, kind: 'monster', worldSize: undefined }], player, W, H);
    assert.ok(close(s.size, (H * 0.35) / 2));
  });

  test('sprite.worldSize par sprite : chaque sprite garde sa taille dans le même appel', () => {
    const out = projectSprites([
      { ...ahead, kind: 'big', worldSize: 0.6 },
      { x: 3.5, y: 2.5, kind: 'small', worldSize: 0.1 },
    ], player, W, H);
    const big = out.find((s) => s.kind === 'big');
    const small = out.find((s) => s.kind === 'small');
    assert.ok(close(big.size, (H * 0.6) / 2));
    assert.ok(close(small.size, (H * 0.1) / 2));
  });

  test('sprite.worldSize invalide (<= 0, non fini, non nombre) -> RangeError', () => {
    for (const worldSize of [0, -1, NaN, Infinity, -Infinity, null, '0.5', true]) {
      assert.throws(() => projectSprites([{ ...ahead, kind: 'monster', worldSize }], player, W, H),
        RangeError, String(worldSize));
    }
  });
});

describe('isSpriteColumnVisible', () => {
  test('depth < distance -> true ; >= -> false', () => {
    const hit = Object.freeze({ distance: 3, side: 'x', tileX: 4, tileY: 1, wallX: 0.5 });
    assert.equal(isSpriteColumnVisible(2, hit), true);
    assert.equal(isSpriteColumnVisible(2.999, hit), true);
    assert.equal(isSpriteColumnVisible(3, hit), false);
    assert.equal(isSpriteColumnVisible(4, hit), false);
  });
});
