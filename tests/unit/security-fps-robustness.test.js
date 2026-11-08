// Tests de sécurité / robustesse de la vue FPS (testeur-securite) : entrées hostiles
// sur les fonctions pures appelées en boucle chaude, et absence d'emballement.
// Aucun DOM, aucun réseau, aléa déterministe (createRng du projet).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isWallTile, toTileGrid, TILE } from '../../src/maze/grid.js';
import { generateMaze } from '../../src/maze/maze.js';
import { createRng } from '../../src/maze/random.js';
import { stepPlayer, MOVEMENT } from '../../src/game/movement.js';
import { createPlayer } from '../../src/game/player.js';
import { actionForCode, computeIntent } from '../../src/game/input.js';
import { createGameLoop } from '../../src/game/loop.js';
import { castRays } from '../../src/render/raycaster.js';

const HOSTILE_VALUES = [
  undefined, null, true, false, 0, -0, 1, -1, 1.5, -1.5, NaN, Infinity, -Infinity,
  Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, Number.MAX_VALUE, 2 ** 53 + 2,
  '', '1', '0', 'abc', '__proto__', [], [1], {}, { valueOf: () => 1 }, 1n, Symbol('s'),
  () => 0,
];

const realGrid = toTileGrid(generateMaze({ width: 8, height: 8, seed: 42 }));

const HOSTILE_GRIDS = [
  undefined, null, 0, 'grid', [], {},
  { width: 3, height: 3 },
  { width: 3, height: 3, tiles: null },
  { width: 3, height: 3, tiles: '000000000' },
  { width: 3, height: 3, tiles: {} },
  { width: 3, height: 3, tiles: new Uint8Array(0) },
  { width: 3, height: 3, tiles: new Uint8Array(2) },
  { width: -3, height: -3, tiles: new Uint8Array(9) },
  { width: 2.5, height: 2.5, tiles: new Uint8Array(9) },
  { width: NaN, height: NaN, tiles: new Uint8Array(9) },
  { width: Infinity, height: Infinity, tiles: new Uint8Array(9) },
  { width: '3', height: '3', tiles: new Uint8Array(9) },
  { width: 3, height: 3, tiles: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
  Object.create(null),
  realGrid,
];

describe('isWallTile : entrées hostiles', () => {
  test('ne lève jamais et renvoie toujours un booléen (grilles x coordonnées hostiles)', () => {
    let calls = 0;
    for (const grid of HOSTILE_GRIDS) {
      for (const tx of HOSTILE_VALUES) {
        for (const ty of HOSTILE_VALUES) {
          let result;
          assert.doesNotThrow(() => {
            result = isWallTile(grid, tx, ty);
          }, `isWallTile grille #${HOSTILE_GRIDS.indexOf(grid)}, ${typeof tx}, ${typeof ty}`);
          assert.equal(typeof result, 'boolean');
          calls += 1;
        }
      }
    }
    assert.ok(calls > 10000);
  });

  test('coordonnée non entière (types non numériques compris) -> mur (monde fermé)', () => {
    for (const v of HOSTILE_VALUES) {
      if (typeof v === 'number' && Number.isInteger(v)) continue;
      assert.equal(isWallTile(realGrid, v, 1), true, `tx=${String(v)}`);
      assert.equal(isWallTile(realGrid, 1, v), true, `ty=${String(v)}`);
    }
  });

  test('hors grille et grille mal formée -> mur, jamais de lecture hors tableau prise pour du sol', () => {
    assert.equal(isWallTile(realGrid, -1, 1), true);
    assert.equal(isWallTile(realGrid, realGrid.width, 1), true);
    assert.equal(isWallTile(realGrid, 1, realGrid.height), true);
    assert.equal(isWallTile(realGrid, Number.MAX_SAFE_INTEGER, 1), true);
    // tiles plus court que width*height : l'index manquant ne doit pas devenir du sol.
    const short = { width: 3, height: 3, tiles: new Uint8Array(4) };
    assert.equal(isWallTile(short, 2, 2), true);
    // Dimensions non numériques : aucune tuile considérée comme sol.
    for (const grid of HOSTILE_GRIDS.slice(0, 12)) {
      assert.equal(isWallTile(grid, 1, 1), true, `grille ${JSON.stringify(grid)}`);
    }
  });

  test('cohérence avec tiles sur une vraie grille (pas de faux sol)', () => {
    for (let ty = 0; ty < realGrid.height; ty++) {
      for (let tx = 0; tx < realGrid.width; tx++) {
        const expected = realGrid.tiles[ty * realGrid.width + tx] !== TILE.FLOOR;
        assert.equal(isWallTile(realGrid, tx, ty), expected);
      }
    }
  });
});

describe('déplacement : pas de sortie du monde ni de traversée de mur', () => {
  test('dt énorme ou hostile : déplacement borné par walkSpeed * runFactor * maxDt', () => {
    const start = createPlayer(realGrid);
    const intent = computeIntent(['forward', 'strafeRight', 'run']);
    const bound = MOVEMENT.walkSpeed * MOVEMENT.runFactor * MOVEMENT.maxDt + 1e-9;
    for (const dt of [1e9, Infinity, -Infinity, NaN, -1, '10', null, undefined, {}]) {
      const next = stepPlayer(start, intent, dt, realGrid);
      assert.ok(Math.hypot(next.x - start.x, next.y - start.y) <= bound, `dt=${String(dt)}`);
      assert.ok(Number.isFinite(next.x) && Number.isFinite(next.y) && Number.isFinite(next.angle));
    }
  });

  test('intention hostile (axes non {-1,0,1}) : aucun mouvement amplifié', () => {
    const start = createPlayer(realGrid);
    const hostile = { move: 1e9, strafe: Infinity, turn: NaN, run: 'yes' };
    const next = stepPlayer(start, hostile, 0.05, realGrid);
    assert.deepEqual({ ...next }, { ...start });
  });

  test('marche aléatoire longue : le joueur reste toujours sur une tuile sol de la grille', () => {
    const rng = createRng(1234);
    const actionsPool = ['forward', 'backward', 'turnLeft', 'turnRight', 'strafeLeft', 'strafeRight', 'run'];
    let player = createPlayer(realGrid);
    for (let i = 0; i < 20000; i++) {
      const pressed = actionsPool.filter(() => rng() < 0.4);
      const dt = rng() < 0.01 ? 5 : rng() * 0.05;
      player = stepPlayer(player, computeIntent(pressed), dt, realGrid);
      const tx = Math.floor(player.x);
      const ty = Math.floor(player.y);
      assert.equal(isWallTile(realGrid, tx, ty), false, `itération ${i} : joueur dans un mur (${player.x}, ${player.y})`);
    }
  });
});

describe('raycaster : terminaison garantie', () => {
  test('grille entièrement ouverte : les rayons s\'arrêtent (hors grille = mur), distances finies', () => {
    const open = { width: 40, height: 40, tiles: new Uint8Array(1600).fill(TILE.FLOOR) };
    const hits = castRays(open, { x: 20.5, y: 20.5, angle: 0.3 }, 400);
    assert.equal(hits.length, 400);
    for (const h of hits) assert.ok(Number.isFinite(h.distance) && h.distance > 0);
  });

  test('grille déclarée immense mais tiles vide : arrêt immédiat, pas de boucle', () => {
    const huge = { width: 1e9, height: 1e9, tiles: new Uint8Array(0) };
    const before = process.hrtime.bigint();
    const hits = castRays(huge, { x: 5.5, y: 5.5, angle: 1 }, 200);
    const elapsedMs = Number(process.hrtime.bigint() - before) / 1e6;
    assert.equal(hits.length, 200);
    assert.ok(elapsedMs < 1000, `castRays trop lent : ${elapsedMs} ms`);
  });

  test('joueur hors grille ou à coordonnées extrêmes : pas d\'exception ni de NaN', () => {
    for (const [x, y] of [[-100.5, -100.5], [1e12, 3.5], [3.5, -1e12], [1e300, 1e300]]) {
      const hits = castRays(realGrid, { x, y, angle: 2 }, 50);
      for (const h of hits) {
        assert.ok(Number.isFinite(h.distance));
        assert.ok(h.wallX >= 0 && h.wallX < 1);
      }
    }
  });
});

describe('clavier : table de liaisons non contournable', () => {
  test('codes hostiles (prototype, non chaînes) -> null', () => {
    for (const code of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '', 'keyw', ...HOSTILE_VALUES]) {
      assert.equal(actionForCode(code), null, `code=${String(code)}`);
    }
  });

  test('touches navigateur essentielles jamais liées (Tab, F5, F11, F12, Ctrl, Alt, Meta...)', () => {
    for (const code of ['Tab', 'F5', 'F11', 'F12', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'Enter', 'Space', 'KeyR', 'KeyL', 'KeyT', 'KeyN', 'Backspace', 'PageUp', 'PageDown', 'Home', 'End']) {
      assert.equal(actionForCode(code), null, code);
    }
  });
});

describe('boucle de jeu : pas d\'emballement', () => {
  function fakeScheduler() {
    const queue = new Map();
    let nextId = 1;
    return {
      queue,
      requestFrame(cb) {
        const id = nextId++;
        queue.set(id, cb);
        return id;
      },
      cancelFrame(id) {
        queue.delete(id);
      },
      runOne(t) {
        const [[id, cb]] = queue;
        queue.delete(id);
        cb(t);
      },
    };
  }

  test('au plus une image en attente, malgré start répétés et horodatages hostiles', () => {
    const s = fakeScheduler();
    let updates = 0;
    const loop = createGameLoop({
      update(dt) {
        updates += 1;
        assert.ok(Number.isFinite(dt) && dt >= 0, `dt=${dt}`);
      },
      render() {},
      requestFrame: s.requestFrame,
      cancelFrame: s.cancelFrame,
    });
    for (let i = 0; i < 100; i++) loop.start();
    assert.equal(s.queue.size, 1);
    for (const t of [0, NaN, -1e9, Infinity, 16, -Infinity, 1e300, 32, undefined, 'x']) {
      s.runOne(t);
      assert.equal(s.queue.size, 1, 'une seule image replanifiée par image');
    }
    assert.equal(updates, 10);
    loop.stop();
    assert.equal(s.queue.size, 0);
  });

  test('stop/start depuis update : jamais deux chaînes d\'images concurrentes', () => {
    const s = fakeScheduler();
    let loop;
    loop = createGameLoop({
      update() {
        loop.stop();
        loop.start();
        loop.start();
      },
      render() {},
      requestFrame: s.requestFrame,
      cancelFrame: s.cancelFrame,
    });
    loop.start();
    for (let i = 0; i < 50; i++) {
      s.runOne(i * 16);
      assert.equal(s.queue.size, 1);
    }
    loop.stop();
    assert.equal(s.queue.size, 0);
  });

  test('callback périmé (après stop) : aucun update ni replanification', () => {
    const s = fakeScheduler();
    let updates = 0;
    const loop = createGameLoop({
      update() { updates += 1; },
      render() {},
      requestFrame: s.requestFrame,
      cancelFrame: () => {}, // annulation ignorée : le callback périmé sera quand même appelé
    });
    loop.start();
    loop.stop();
    s.runOne(16);
    assert.equal(updates, 0);
    assert.equal(s.queue.size, 0);
  });
});
