// Tests unitaires du monstre (plan docs/design/dark-monstre.md §3 et §6) : constantes,
// createMonster (apparition loin du joueur, PRNG dédié, repli, erreurs), stepMonster
// (grâce, bornage, déplacement, errance, traque et hystérésis, événements TURN, pureté),
// isCatching, capture garantie, monsterSprite.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, isWallTile } from '../../src/maze/grid.js';
import { createRng, randomInt, MAX_SEED } from '../../src/maze/random.js';
import { MOVEMENT, collides } from '../../src/game/movement.js';
import { tileDistances } from '../../src/game/pathfinding.js';
import { findExit } from '../../src/game/exit.js';
import {
  MONSTER,
  MONSTER_KIND,
  MONSTER_MODE,
  MONSTER_EVENT,
  MONSTER_SEED_SALT,
  HEADING,
  createMonster,
  stepMonster,
  isCatching,
  monsterSprite,
} from '../../src/game/monster.js';
import { gridFromRows } from './fps-test-grids.js';

const EPS = 1e-9;

/** Monstre éveillé (grâce 0) arrêté au centre de (tx, ty). */
function monsterAt(tx, ty, extra = {}) {
  return Object.freeze({
    tx,
    ty,
    nextTx: null,
    nextTy: null,
    fromTx: null,
    fromTy: null,
    progress: 0,
    x: tx + 0.5,
    y: ty + 0.5,
    mode: MONSTER_MODE.WANDER,
    heading: null,
    pathDistance: Infinity,
    graceRemaining: 0,
    rngState: 12345,
    ...extra,
  });
}

function from(tx, ty) {
  return { fromTx: tx, fromTy: ty };
}

/** Centre de tuile (position monde d'un joueur). */
function center(tx, ty) {
  return { x: tx + 0.5, y: ty + 0.5 };
}

// Couloir horizontal (1..9, 1) + tuile isolée (1, 3) pour un joueur inatteignable.
const CORRIDOR = gridFromRows([
  '###########',
  '#.........#',
  '###########',
  '#.#########',
  '###########',
]);
const POCKET_CORRIDOR = center(1, 3);

// Carrefour en T en (3, 1) : W (2, 1), E (4, 1), S (3, 2) ; poche isolée (5, 3).
const T_GRID = gridFromRows([
  '#######',
  '#.....#',
  '###.###',
  '###.#.#',
  '#######',
]);
const POCKET_T = center(5, 3);

// Couloir en L : (1, 1) -> (3, 1) puis (3, 2) -> (3, 3) ; poche isolée (1, 3).
const L_GRID = gridFromRows([
  '#####',
  '#...#',
  '###.#',
  '#.#.#',
  '#####',
]);

// Couloir en zigzag : (1,1) S (1,3) E (3,3) N (3,1) E (5,1) S (5,3) ; poche (1, 5).
const ZIGZAG = gridFromRows([
  '#######',
  '#.#...#',
  '#.#.#.#',
  '#...#.#',
  '#######',
  '#.#####',
  '#######',
]);

// Long couloir (1..41, 1) pour la traque et l'hystérésis.
const LONG = gridFromRows(['#'.repeat(43), `#${'.'.repeat(41)}#`, '#'.repeat(43)]);

function realGrid(width, height, seed) {
  return toTileGrid(generateMaze({ width, height, seed }));
}

/** Enchaîne des pas de dt secondes pendant seconds secondes ; cumule les événements. */
function runSteps(monster, player, grid, seconds, dt = 0.05, options) {
  let m = monster;
  const events = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    const r = stepMonster(m, player, dt, grid, options);
    events.push(...r.events);
    m = r.monster;
  }
  return { monster: m, events };
}

// ---------------------------------------------------------------------------

describe('constantes', () => {
  test('objets gelés', () => {
    for (const o of [MONSTER, MONSTER_MODE, HEADING, MONSTER_EVENT]) {
      assert.ok(Object.isFrozen(o));
    }
  });

  test('valeurs du contrat', () => {
    assert.equal(MONSTER_KIND, 'monster');
    assert.equal(MONSTER_SEED_SALT, 0x85EBCA6B);
    assert.deepEqual({ ...MONSTER_MODE }, { WANDER: 'wander', CHASE: 'chase' });
    assert.deepEqual({ ...HEADING }, { N: 'N', E: 'E', S: 'S', W: 'W' });
    assert.equal(MONSTER_EVENT.TURN, 'turn');
    assert.equal(MONSTER.graceDuration, 3);
    assert.equal(MONSTER.chaseDistance, 12);
    assert.equal(MONSTER.chaseHysteresis, 6);
    assert.equal(MONSTER.maxDt, 0.1);
  });

  test('marche < traque < course ; errance < marche', () => {
    assert.ok(MOVEMENT.walkSpeed < MONSTER.chaseSpeed);
    assert.ok(MONSTER.chaseSpeed < MOVEMENT.walkSpeed * MOVEMENT.runFactor);
    assert.ok(MONSTER.wanderSpeed < MOVEMENT.walkSpeed);
  });

  test('catchRadius dans [0.583, 1.4[ ; pas max < 2 * catchRadius', () => {
    assert.ok(MONSTER.catchRadius >= Math.hypot(0.5, 0.3));
    assert.ok(MONSTER.catchRadius < 1.4);
    assert.ok(MONSTER.chaseSpeed * MONSTER.maxDt < 2 * MONSTER.catchRadius);
  });
});

// ---------------------------------------------------------------------------

describe('createMonster', () => {
  const CASES = [
    [2, 2, [0, 1, 2, 3, 99]],
    [16, 16, [1, 42, 7, 2024, MAX_SEED]],
    [64, 64, [5, 123456]],
    [12, 5, [3, 8, 77]],
    [3, 7, [11, 12]],
  ];

  for (const [w, h, seeds] of CASES) {
    for (const seed of seeds) {
      test(`${w} x ${h}, graine ${seed} : cellule sol, loin, ni (1, 1) ni la sortie`, () => {
        const grid = realGrid(w, h, seed);
        const exit = findExit(grid);
        const m = createMonster(grid, seed, { exit });
        assert.equal(m.tx % 2, 1, 'tx impair');
        assert.equal(m.ty % 2, 1, 'ty impair');
        assert.equal(isWallTile(grid, m.tx, m.ty), false);
        assert.ok(!(m.tx === 1 && m.ty === 1), 'jamais (1, 1)');
        assert.ok(!(m.tx === exit.tx && m.ty === exit.ty), 'jamais la sortie');

        const dist = tileDistances(grid, 1, 1);
        let max = 0;
        for (let ty = 1; ty < grid.height; ty += 2) {
          for (let tx = 1; tx < grid.width; tx += 2) {
            max = Math.max(max, dist[ty * grid.width + tx]);
          }
        }
        const d = dist[m.ty * grid.width + m.tx];
        assert.ok(d >= Math.ceil(0.5 * max), `distance ${d} < ceil(0.5 * ${max})`);
        assert.equal(m.pathDistance, d, 'pathDistance = distance de la tuile choisie');
      });
    }
  }

  test('sans sortie : jamais (1, 1)', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const grid = realGrid(2, 2, seed);
      const m = createMonster(grid, seed);
      assert.ok(!(m.tx === 1 && m.ty === 1));
      const m2 = createMonster(grid, seed, { exit: null });
      assert.deepEqual(m2, m);
    }
  });

  test('état initial : errance, heading null, grâce 3, centre de tuile, gelé', () => {
    const grid = realGrid(16, 16, 42);
    const m = createMonster(grid, 42, { exit: findExit(grid) });
    assert.ok(Object.isFrozen(m));
    assert.equal(m.mode, 'wander');
    assert.equal(m.heading, null);
    assert.equal(m.graceRemaining, 3);
    assert.equal(m.x, m.tx + 0.5);
    assert.equal(m.y, m.ty + 0.5);
    assert.equal(m.nextTx, null);
    assert.equal(m.nextTy, null);
    assert.equal(m.fromTx, null);
    assert.equal(m.fromTy, null);
    assert.equal(m.progress, 0);
    assert.ok(Number.isInteger(m.rngState) && m.rngState >= 0 && m.rngState <= MAX_SEED);
  });

  test('graceDuration surchargée', () => {
    const grid = realGrid(8, 8, 1);
    assert.equal(createMonster(grid, 1, {}, { graceDuration: 0 }).graceRemaining, 0);
    assert.equal(createMonster(grid, 1, {}, { graceDuration: 5 }).graceRemaining, 5);
  });

  test('déterminisme : même graine -> même état', () => {
    for (const seed of [0, 9, 4242]) {
      const grid = realGrid(16, 16, seed);
      const exit = findExit(grid);
      assert.deepEqual(createMonster(grid, seed, { exit }), createMonster(grid, seed, { exit }));
    }
  });

  test('graines différentes -> au moins deux départs différents (même labyrinthe)', () => {
    const grid = realGrid(16, 16, 42);
    const exit = findExit(grid);
    const starts = new Set();
    const states = new Set();
    for (let seed = 0; seed < 12; seed++) {
      const m = createMonster(grid, seed, { exit });
      starts.add(`${m.tx},${m.ty}`);
      states.add(m.rngState);
    }
    assert.ok(starts.size >= 2, 'tous les départs identiques');
    assert.ok(states.size >= 2, 'tous les rngState identiques');
  });

  test('PRNG dédié : tirage = createRng((seed ^ SALT) >>> 0), index puis rngState', () => {
    // Couloir 7 x 3 : cellules (3, 1) d=2 et (5, 1) d=4 ; seuil ceil(0.5 * 4) = 2.
    const grid = gridFromRows(['#######', '#.....#', '#######']);
    for (const seed of [0, 1, 17, 99999]) {
      const rng = createRng((seed ^ MONSTER_SEED_SALT) >>> 0);
      const index = randomInt(rng, 2);
      const rngState = randomInt(rng, MAX_SEED + 1);
      const m = createMonster(grid, seed);
      assert.equal(m.tx, [3, 5][index]);
      assert.equal(m.ty, 1);
      assert.equal(m.rngState, rngState);
    }
  });

  test('sortie exclue sur un couloir : seule (3, 1) reste', () => {
    const grid = gridFromRows(['#######', '#.....#', '#######']);
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const m = createMonster(grid, seed, { exit: { tx: 5, ty: 1 } });
      assert.equal(m.tx, 3);
      assert.equal(m.ty, 1);
    }
  });

  test('repli : seuil vide -> autres tuiles atteintes hors (1, 1) et sortie', () => {
    const grid = gridFromRows(['#######', '#.....#', '#######']);
    for (const seed of [0, 1, 2, 3, 4, 5, 6, 7]) {
      // spawnMinFraction 1 : seule (5, 1) passe le seuil, et c'est la sortie.
      const m = createMonster(grid, seed, { exit: { tx: 5, ty: 1 } }, { spawnMinFraction: 1 });
      assert.equal(isWallTile(grid, m.tx, m.ty), false);
      assert.equal(m.ty, 1);
      assert.ok(m.tx !== 1 && m.tx !== 5, `repli sur (${m.tx}, 1)`);
    }
  });

  test('repli final : seule la sortie est atteinte -> monstre sur la sortie', () => {
    const grid = gridFromRows(['####', '#..#', '####']);
    const m = createMonster(grid, 3, { exit: { tx: 2, ty: 1 } });
    assert.equal(m.tx, 2);
    assert.equal(m.ty, 1);
  });

  test('aucun candidat -> RangeError', () => {
    const grid = gridFromRows(['###', '#.#', '###']);
    assert.throws(() => createMonster(grid, 1), RangeError);
  });

  test('erreurs : grille', () => {
    const ok = realGrid(2, 2, 1);
    assert.throws(() => createMonster(null, 1), TypeError);
    assert.throws(() => createMonster(undefined, 1), TypeError);
    assert.throws(() => createMonster({ width: 5, height: 5, tiles: new Uint8Array(3) }, 1), TypeError);
    assert.throws(() => createMonster({ width: 0, height: 5, tiles: new Uint8Array(0) }, 1), TypeError);
    assert.throws(() => createMonster({ width: 2.5, height: 2, tiles: new Uint8Array(5) }, 1), TypeError);
    assert.throws(() => createMonster({ ...ok, tiles: null }, 1), TypeError);
    // (1, 1) non sol
    assert.throws(() => createMonster(gridFromRows(['###', '###', '###']), 1), RangeError);
  });

  test('erreurs : graine', () => {
    const grid = realGrid(2, 2, 1);
    assert.throws(() => createMonster(grid, 'a'), TypeError);
    assert.throws(() => createMonster(grid, undefined), TypeError);
    assert.throws(() => createMonster(grid, -1), RangeError);
    assert.throws(() => createMonster(grid, MAX_SEED + 1), RangeError);
    assert.throws(() => createMonster(grid, 1.5));
    assert.doesNotThrow(() => createMonster(grid, 0));
    assert.doesNotThrow(() => createMonster(grid, MAX_SEED));
  });

  test('erreurs : placement et exit mal formés', () => {
    const grid = realGrid(2, 2, 1);
    assert.throws(() => createMonster(grid, 1, 'x'), TypeError);
    assert.throws(() => createMonster(grid, 1, { exit: 'x' }), TypeError);
    assert.throws(() => createMonster(grid, 1, { exit: { tx: 'a', ty: 1 } }), TypeError);
    assert.throws(() => createMonster(grid, 1, { exit: { tx: 1 } }), TypeError);
    assert.throws(() => createMonster(grid, 1, { exit: { tx: NaN, ty: 1 } }), TypeError);
  });

  test('options : négatif ou non fini -> RangeError ; clé inconnue ignorée', () => {
    const grid = realGrid(2, 2, 1);
    assert.throws(() => createMonster(grid, 1, {}, { graceDuration: -1 }), RangeError);
    assert.throws(() => createMonster(grid, 1, {}, { graceDuration: NaN }), RangeError);
    assert.throws(() => createMonster(grid, 1, {}, { spawnMinFraction: Infinity }), RangeError);
    assert.deepEqual(createMonster(grid, 1, {}, { foo: -5 }), createMonster(grid, 1));
  });
});

// ---------------------------------------------------------------------------

describe('stepMonster : grâce et bornage', () => {
  const grid = realGrid(8, 8, 3);
  const m0 = createMonster(grid, 3, { exit: findExit(grid) });
  const player = center(1, 1);

  for (const dt of [0, -1, NaN, 'x', undefined, -Infinity]) {
    test(`dt = ${String(dt)} -> même référence, events vide`, () => {
      const r = stepMonster(m0, player, dt, grid);
      assert.equal(r.monster, m0);
      assert.equal(r.events.length, 0);
      assert.ok(Object.isFrozen(r));
      assert.ok(Object.isFrozen(r.events));
      const awake = monsterAt(3, 1);
      assert.equal(stepMonster(awake, POCKET_T, dt, T_GRID).monster, awake);
    });
  }

  test('pendant la grâce : immobile, graceRemaining décroît, aucun événement', () => {
    const r = stepMonster(m0, player, 0.05, grid);
    assert.equal(r.monster.x, m0.x);
    assert.equal(r.monster.y, m0.y);
    assert.equal(r.monster.tx, m0.tx);
    assert.equal(r.monster.nextTx, null);
    assert.equal(r.monster.heading, null);
    assert.ok(Math.abs(r.monster.graceRemaining - 2.95) < EPS);
    assert.equal(r.events.length, 0);
  });

  test('grâce : plancher 0, reliquat perdu', () => {
    const m = Object.freeze({ ...m0, graceRemaining: 0.03 });
    const r = stepMonster(m, player, 0.1, grid);
    assert.equal(r.monster.graceRemaining, 0);
    assert.equal(r.monster.x, m0.x);
    assert.equal(r.monster.y, m0.y);
    assert.equal(r.events.length, 0);
  });

  test('dt > maxDt borné (grâce)', () => {
    const r = stepMonster(m0, player, 10, grid);
    assert.ok(Math.abs(r.monster.graceRemaining - (3 - MONSTER.maxDt)) < EPS);
  });

  test('dt > maxDt borné (déplacement)', () => {
    const m = monsterAt(3, 1, from(2, 1));
    const r = stepMonster(m, POCKET_CORRIDOR, 5, CORRIDOR);
    assert.ok(Math.abs(r.monster.x - (3.5 + MONSTER.wanderSpeed * MONSTER.maxDt)) < EPS);
  });

  test('sans surcharge, aucun déplacement pendant les 3 s de grâce', () => {
    let m = m0;
    let t = 0;
    while (m.graceRemaining > 0) {
      const r = stepMonster(m, player, 0.1, grid);
      assert.equal(r.events.length, 0);
      assert.equal(r.monster.x, m0.x);
      assert.equal(r.monster.y, m0.y);
      m = r.monster;
      t += 0.1;
      assert.ok(t < 3.2 + EPS, 'grâce trop longue');
    }
    assert.ok(t >= 3 - EPS, 'grâce trop courte');
  });
});

// ---------------------------------------------------------------------------

describe('stepMonster : déplacement', () => {
  test('couloir : avance de speed * dt', () => {
    const m = monsterAt(3, 1, from(2, 1));
    const r1 = stepMonster(m, POCKET_CORRIDOR, 0.05, CORRIDOR);
    assert.equal(r1.monster.nextTx, 4);
    assert.equal(r1.monster.nextTy, 1);
    assert.ok(Math.abs(r1.monster.progress - 0.05 * MONSTER.wanderSpeed) < EPS);
    assert.ok(Math.abs(r1.monster.x - (3.5 + 0.05 * MONSTER.wanderSpeed)) < EPS);
    assert.equal(r1.monster.y, 1.5);
    const r2 = stepMonster(r1.monster, POCKET_CORRIDOR, 0.1, CORRIDOR);
    assert.ok(Math.abs(r2.monster.x - (3.5 + 0.15 * MONSTER.wanderSpeed)) < EPS);
  });

  test('vitesse de traque en mode chase', () => {
    const m = monsterAt(1, 1, { mode: MONSTER_MODE.CHASE });
    const r = stepMonster(m, center(9, 1), 0.1, CORRIDOR);
    assert.equal(r.monster.mode, 'chase');
    assert.ok(Math.abs(r.monster.x - (1.5 + 0.1 * MONSTER.chaseSpeed)) < EPS);
  });

  test('arrivée exacte sur une tuile', () => {
    const m = monsterAt(3, 1, from(2, 1));
    const r = stepMonster(m, POCKET_CORRIDOR, 0.1, CORRIDOR, { wanderSpeed: 10 });
    assert.ok(Math.abs(r.monster.x - 4.5) < EPS, `x = ${r.monster.x}`);
    assert.equal(r.monster.y, 1.5);
    assert.ok(r.monster.progress >= 0 && r.monster.progress < 1);
  });

  test('enchaînement de tuiles dans le même pas', () => {
    const m = monsterAt(3, 1, from(2, 1));
    const r = stepMonster(m, POCKET_CORRIDOR, 0.1, CORRIDOR, { wanderSpeed: 25 });
    const s = r.monster;
    assert.ok(Math.abs(s.x - 6) < EPS, `x = ${s.x}`);
    assert.equal(s.tx, 5);
    assert.equal(s.nextTx, 6);
    assert.equal(s.fromTx, 4);
    assert.ok(Math.abs(s.progress - 0.5) < EPS);
  });

  test('vitesse 0 autorisée : aucun déplacement', () => {
    const m = monsterAt(3, 1, from(2, 1));
    const r = stepMonster(m, POCKET_CORRIDOR, 0.1, CORRIDOR, { wanderSpeed: 0 });
    assert.equal(r.monster.x, 3.5);
    assert.equal(r.monster.y, 1.5);
  });

  test('options invalides -> RangeError', () => {
    const m = monsterAt(3, 1);
    assert.throws(() => stepMonster(m, POCKET_CORRIDOR, 0.1, CORRIDOR, { chaseSpeed: -1 }), RangeError);
    assert.throws(() => stepMonster(m, POCKET_CORRIDOR, 0.1, CORRIDOR, { maxDt: NaN }), RangeError);
  });

  test('erreurs : monstre, joueur, grille mal formés -> TypeError', () => {
    const m = monsterAt(3, 1);
    assert.throws(() => stepMonster(null, POCKET_CORRIDOR, 0.1, CORRIDOR), TypeError);
    assert.throws(() => stepMonster({ ...m, tx: 3.5 }, POCKET_CORRIDOR, 0.1, CORRIDOR), TypeError);
    assert.throws(() => stepMonster({ ...m, tx: 0 }, POCKET_CORRIDOR, 0.1, CORRIDOR), TypeError);
    assert.throws(() => stepMonster({ ...m, mode: 'x' }, POCKET_CORRIDOR, 0.1, CORRIDOR), TypeError);
    assert.throws(() => stepMonster(m, null, 0.1, CORRIDOR), TypeError);
    assert.throws(() => stepMonster(m, { x: 'a', y: 1 }, 0.1, CORRIDOR), TypeError);
    assert.throws(() => stepMonster(m, POCKET_CORRIDOR, 0.1, null), TypeError);
    assert.throws(() => stepMonster(m, POCKET_CORRIDOR, 0.1, { width: 3, height: 3, tiles: new Uint8Array(2) }), TypeError);
  });

  function checkInvariant(grid, s, label) {
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), `${label} : position non finie`);
    assert.equal(isWallTile(grid, s.tx, s.ty), false, `${label} : tuile de départ mur`);
    assert.ok(s.progress >= 0 && s.progress < 1, `${label} : progress ${s.progress}`);
    let ex = s.tx + 0.5;
    let ey = s.ty + 0.5;
    if (s.nextTx !== null) {
      assert.equal(isWallTile(grid, s.nextTx, s.nextTy), false, `${label} : tuile visée mur`);
      assert.equal(Math.abs(s.nextTx - s.tx) + Math.abs(s.nextTy - s.ty), 1, `${label} : non voisine`);
      ex += (s.nextTx - s.tx) * s.progress;
      ey += (s.nextTy - s.ty) * s.progress;
    } else {
      assert.equal(s.progress, 0, `${label} : progress non nul à l'arrêt`);
    }
    assert.ok(Math.abs(s.x - ex) < 1e-6 && Math.abs(s.y - ey) < 1e-6, `${label} : x, y incohérents`);
    assert.equal(isWallTile(grid, Math.floor(s.x), Math.floor(s.y)), false, `${label} : dans un mur`);
  }

  for (const [label, playerAt] of [['joueur sur un mur', () => ({ x: 0.5, y: 0.5 })], ['joueur au départ', () => center(1, 1)]]) {
    test(`jamais sur un mur : 2 000 pas sur un labyrinthe réel (${label})`, () => {
      const grid = realGrid(16, 16, 2024);
      let m = createMonster(grid, 2024, { exit: findExit(grid) }, { graceDuration: 0 });
      const rng = createRng(77);
      const player = playerAt();
      const visited = new Set();
      for (let i = 0; i < 2000; i++) {
        const dt = randomInt(rng, 151) / 1000; // 0 à 0.15 s
        m = stepMonster(m, player, dt, grid).monster;
        checkInvariant(grid, m, `pas ${i}`);
        visited.add(`${m.tx},${m.ty}`);
      }
      assert.ok(visited.size > 10, 'le monstre ne s\'est presque pas déplacé');
    });
  }

  test('pureté : entrée non modifiée, sortie gelée', () => {
    const grid = realGrid(8, 8, 5);
    const tilesCopy = Uint8Array.from(grid.tiles);
    const m = Object.freeze({ ...createMonster(grid, 5), graceRemaining: 0 });
    const copy = { ...m };
    const player = Object.freeze(center(1, 1));
    let cur = m;
    for (let i = 0; i < 50; i++) {
      const r = stepMonster(cur, player, 0.1, grid);
      assert.ok(Object.isFrozen(r));
      assert.ok(Object.isFrozen(r.monster));
      assert.ok(Object.isFrozen(r.events));
      for (const e of r.events) assert.ok(Object.isFrozen(e));
      cur = r.monster;
    }
    assert.deepEqual({ ...m }, copy);
    assert.deepEqual(player, center(1, 1));
    assert.deepEqual(grid.tiles, tilesCopy);
  });

  test('pureté : un monstre non gelé n\'est pas modifié', () => {
    const m = { ...monsterAt(3, 1, from(2, 1)) };
    const copy = { ...m };
    stepMonster(m, POCKET_CORRIDOR, 0.1, CORRIDOR);
    assert.deepEqual(m, copy);
  });
});

// ---------------------------------------------------------------------------

describe('errance', () => {
  test('pas de demi-tour hors cul-de-sac', () => {
    const r = stepMonster(monsterAt(3, 1, from(4, 1)), POCKET_CORRIDOR, 0.05, CORRIDOR);
    assert.equal(r.monster.nextTx, 2);
    assert.equal(r.monster.nextTy, 1);
    for (let s = 0; s < 40; s++) {
      const t = stepMonster(monsterAt(3, 1, { ...from(3, 2), rngState: s * 7919 }), POCKET_T, 0.05, T_GRID);
      assert.ok(!(t.monster.nextTx === 3 && t.monster.nextTy === 2), 'demi-tour au carrefour');
    }
  });

  test('demi-tour au cul-de-sac', () => {
    const r = stepMonster(monsterAt(1, 1, from(2, 1)), POCKET_CORRIDOR, 0.05, CORRIDOR);
    assert.equal(r.monster.nextTx, 2);
    assert.equal(r.monster.nextTy, 1);
    assert.equal(r.monster.heading, 'E');
  });

  test('aucun voisin sol -> pas de tuile visée', () => {
    const r = stepMonster(monsterAt(1, 3), center(1, 1), 0.1, CORRIDOR);
    assert.equal(r.monster.nextTx, null);
    assert.equal(r.monster.x, 1.5);
    assert.equal(r.monster.y, 3.5);
  });

  test('carrefour : même état -> même choix', () => {
    const m = monsterAt(3, 1, { ...from(3, 2), rngState: 987654 });
    const a = stepMonster(m, POCKET_T, 0.05, T_GRID);
    const b = stepMonster(m, POCKET_T, 0.05, T_GRID);
    assert.deepEqual(a.monster, b.monster);
    assert.deepEqual(a.events, b.events);
  });

  test('carrefour : plusieurs choix observés sur des rngState différents', () => {
    const seen = new Set();
    const seenFree = new Set();
    for (let s = 0; s < 60; s++) {
      const m = monsterAt(3, 1, { ...from(3, 2), rngState: (s * 2654435761) >>> 0 });
      const r = stepMonster(m, POCKET_T, 0.05, T_GRID);
      seen.add(r.monster.heading);
      const free = monsterAt(3, 1, { rngState: (s * 2654435761) >>> 0 });
      seenFree.add(stepMonster(free, POCKET_T, 0.05, T_GRID).monster.heading);
    }
    assert.deepEqual([...seen].sort(), ['E', 'W']);
    assert.deepEqual([...seenFree].sort(), ['E', 'S', 'W'], 'from null : les 3 voisins');
  });

  test('carrefour : rngState mis à jour après un tirage', () => {
    let changed = 0;
    for (let s = 0; s < 10; s++) {
      const m = monsterAt(3, 1, { ...from(3, 2), rngState: s * 1000 + 1 });
      const r = stepMonster(m, POCKET_T, 0.05, T_GRID);
      if (r.monster.rngState !== m.rngState) changed++;
      assert.ok(Number.isInteger(r.monster.rngState) && r.monster.rngState >= 0 && r.monster.rngState <= MAX_SEED);
    }
    assert.ok(changed >= 9);
  });

  test('rngState inchangé quand il n\'y a qu\'un voisin', () => {
    const m = monsterAt(3, 1, { ...from(2, 1), rngState: 4242 });
    const r = stepMonster(m, POCKET_CORRIDOR, 0.05, CORRIDOR);
    assert.equal(r.monster.rngState, 4242);
    const dead = monsterAt(1, 1, { ...from(2, 1), rngState: 4242 });
    assert.equal(stepMonster(dead, POCKET_CORRIDOR, 0.05, CORRIDOR).monster.rngState, 4242);
  });
});

// ---------------------------------------------------------------------------

describe('traque et hystérésis', () => {
  function decide(mode, d) {
    const m = monsterAt(1, 1, { mode });
    return stepMonster(m, center(1 + d, 1), 0.01, LONG).monster;
  }

  test('errance, d <= 12 -> chase', () => {
    for (const d of [1, 6, 12]) {
      const s = decide(MONSTER_MODE.WANDER, d);
      assert.equal(s.mode, 'chase', `d = ${d}`);
      assert.equal(s.pathDistance, d);
    }
  });

  test('errance, d = 13 -> reste wander', () => {
    const s = decide(MONSTER_MODE.WANDER, 13);
    assert.equal(s.mode, 'wander');
    assert.equal(s.pathDistance, 13);
  });

  test('traque, d dans ]12, 18] -> reste chase', () => {
    for (const d of [13, 15, 18]) {
      assert.equal(decide(MONSTER_MODE.CHASE, d).mode, 'chase', `d = ${d}`);
    }
  });

  test('traque, d > 18 -> wander', () => {
    for (const d of [19, 30]) {
      const s = decide(MONSTER_MODE.CHASE, d);
      assert.equal(s.mode, 'wander', `d = ${d}`);
      assert.equal(s.pathDistance, d);
    }
  });

  test('traque : suit le plus court chemin, sans tirage (demi-tour permis)', () => {
    const m = monsterAt(3, 1, { ...from(3, 2), mode: MONSTER_MODE.CHASE, rngState: 31337 });
    const r = stepMonster(m, center(3, 3), 0.05, T_GRID);
    assert.equal(r.monster.nextTx, 3);
    assert.equal(r.monster.nextTy, 2);
    assert.equal(r.monster.rngState, 31337);
  });

  test('traque : pathDistance d\'un joueur immobile décroît jusqu\'à 0, puis attente au centre', () => {
    const player = center(11, 1);
    let m = monsterAt(1, 1, { mode: MONSTER_MODE.CHASE });
    const seq = [];
    for (let i = 0; i < 100; i++) {
      m = stepMonster(m, player, 0.1, LONG).monster;
      if (seq[seq.length - 1] !== m.pathDistance) seq.push(m.pathDistance);
    }
    assert.deepEqual(seq, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    assert.equal(m.mode, 'chase');
    assert.equal(m.tx, 11);
    assert.equal(m.nextTx, null);
    assert.equal(m.x, 11.5);
    assert.equal(m.y, 1.5);
    const r = stepMonster(m, player, 0.1, LONG);
    assert.equal(r.monster.x, 11.5);
    assert.equal(r.monster.y, 1.5);
    assert.equal(r.events.length, 0);
  });

  test('joueur sur un mur, hors grille ou inatteignable -> Infinity, errance', () => {
    for (const player of [{ x: 0.5, y: 0.5 }, { x: -5, y: -5 }, { x: 100, y: 1.5 }, POCKET_T]) {
      const m = monsterAt(3, 1, { mode: MONSTER_MODE.CHASE, pathDistance: 2 });
      const s = stepMonster(m, player, 0.05, T_GRID).monster;
      assert.equal(s.pathDistance, Infinity, JSON.stringify(player));
      assert.equal(s.mode, 'wander', JSON.stringify(player));
    }
  });
});

// ---------------------------------------------------------------------------

describe('événements TURN', () => {
  test('premier pas après la grâce -> un TURN', () => {
    const grid = realGrid(8, 8, 11);
    let m = createMonster(grid, 11, { exit: findExit(grid) });
    const player = center(1, 1);
    while (m.graceRemaining > 0) {
      const r = stepMonster(m, player, 0.1, grid);
      assert.equal(r.events.length, 0);
      m = r.monster;
    }
    const start = { x: m.x, y: m.y };
    const r = stepMonster(m, player, 0.05, grid);
    assert.equal(r.events.length, 1);
    const e = r.events[0];
    assert.ok(Object.isFrozen(e));
    assert.equal(e.type, 'turn');
    assert.equal(e.type, MONSTER_EVENT.TURN);
    assert.ok(['N', 'E', 'S', 'W'].includes(e.heading));
    assert.equal(e.heading, r.monster.heading);
    assert.equal(e.x, start.x);
    assert.equal(e.y, start.y);
    assert.equal(e.pathDistance, r.monster.pathDistance);
  });

  test('couloir droit -> aucun nouvel événement', () => {
    const m = monsterAt(2, 1, { ...from(1, 1), heading: HEADING.E });
    const { monster, events } = runSteps(m, POCKET_CORRIDOR, CORRIDOR, 3, 0.1);
    assert.equal(events.length, 0);
    assert.ok(monster.x > 6, `x = ${monster.x}`);
    assert.equal(monster.heading, 'E');
  });

  test('virage (errance) -> TURN au bon cap, centre de la tuile', () => {
    const m = monsterAt(3, 1, { ...from(2, 1), heading: HEADING.E });
    const r = stepMonster(m, center(1, 3), 0.05, L_GRID);
    assert.equal(r.events.length, 1);
    assert.deepEqual({ ...r.events[0] }, { type: 'turn', heading: 'S', pathDistance: Infinity, x: 3.5, y: 1.5 });
    assert.equal(r.monster.heading, 'S');
  });

  test('virage (traque) -> pathDistance de la décision', () => {
    const m = monsterAt(3, 1, { ...from(2, 1), heading: HEADING.E, mode: MONSTER_MODE.CHASE });
    const r = stepMonster(m, center(3, 3), 0.05, L_GRID);
    assert.equal(r.events.length, 1);
    assert.deepEqual({ ...r.events[0] }, { type: 'turn', heading: 'S', pathDistance: 2, x: 3.5, y: 1.5 });
  });

  test('demi-tour au cul-de-sac -> TURN', () => {
    const m = monsterAt(9, 1, { ...from(8, 1), heading: HEADING.E });
    const r = stepMonster(m, POCKET_CORRIDOR, 0.05, CORRIDOR);
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].heading, 'W');
    assert.equal(r.events[0].x, 9.5);
  });

  test('plusieurs virages dans un pas : ordre chronologique', () => {
    const m = monsterAt(1, 1, { heading: HEADING.S });
    const r = stepMonster(m, center(1, 5), 0.1, ZIGZAG, { wanderSpeed: 65 });
    const got = r.events.map((e) => [e.heading, e.x, e.y]);
    assert.deepEqual(got, [['E', 1.5, 3.5], ['N', 3.5, 3.5], ['E', 3.5, 1.5]]);
    for (const e of r.events) {
      assert.ok(Object.isFrozen(e));
      assert.equal(e.type, 'turn');
      assert.equal(e.pathDistance, Infinity);
    }
    assert.ok(Math.abs(r.monster.x - 4) < EPS && r.monster.y === 1.5, `x = ${r.monster.x}`);
  });
});

// ---------------------------------------------------------------------------

describe('isCatching', () => {
  test('0.6 inclus, 0.61 exclu', () => {
    const m = { x: 3, y: 3 };
    assert.equal(isCatching(m, { x: 3.5, y: 3.3 }), true);
    assert.equal(isCatching(m, { x: 3.62, y: 3 }), false);
    assert.equal(isCatching(m, { x: 3, y: 3 }), true);
    assert.equal(isCatching({ x: 0, y: 0 }, { x: 0.6, y: 0 }), true);
    assert.equal(isCatching({ x: 0, y: 0 }, { x: 0.61, y: 0 }), false);
  });

  test('rayon explicite', () => {
    assert.equal(isCatching({ x: 0, y: 0 }, { x: 1, y: 0 }, 1), true);
    assert.equal(isCatching({ x: 0, y: 0 }, { x: 0.1, y: 0 }, 0), false);
    assert.equal(isCatching({ x: 0, y: 0 }, { x: 0, y: 0 }, 0), true);
  });

  test('erreurs -> TypeError', () => {
    const p = { x: 0, y: 0 };
    for (const bad of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: '0', y: 0 }, null]) {
      assert.throws(() => isCatching(bad, p), TypeError);
      assert.throws(() => isCatching(p, bad), TypeError);
    }
    for (const r of [-1, NaN, Infinity, '1']) {
      assert.throws(() => isCatching(p, p, r), TypeError);
    }
  });
});

describe('capture garantie', () => {
  test('toute position légale du joueur dans la tuile du monstre arrêté -> contact', () => {
    const grid = realGrid(16, 16, 31);
    let tested = 0;
    for (let ty = 1; ty < grid.height; ty++) {
      for (let tx = 1; tx < grid.width; tx++) {
        if (isWallTile(grid, tx, ty)) continue;
        const m = monsterAt(tx, ty);
        for (let i = 0; i <= 20; i++) {
          for (let j = 0; j <= 20; j++) {
            const x = tx + i / 20;
            const y = ty + j / 20;
            if (x >= tx + 1 || y >= ty + 1 || collides(grid, x, y)) continue;
            tested++;
            assert.equal(isCatching(m, { x, y }), true, `(${x}, ${y}) dans (${tx}, ${ty})`);
          }
        }
      }
    }
    assert.ok(tested > 1000);
  });
});

describe('monsterSprite', () => {
  test('forme { x, y, kind } gelée', () => {
    const m = monsterAt(3, 5, { x: 3.7, y: 5.5, nextTx: 4, nextTy: 5, progress: 0.2 });
    const s = monsterSprite(m);
    assert.deepEqual({ ...s }, { x: 3.7, y: 5.5, kind: 'monster' });
    assert.equal(s.kind, MONSTER_KIND);
    assert.ok(Object.isFrozen(s));
  });

  test('erreurs -> TypeError', () => {
    for (const bad of [null, undefined, 3, {}, { x: NaN, y: 1 }, { x: 1, y: 'a' }]) {
      assert.throws(() => monsterSprite(bad), TypeError);
    }
  });
});
