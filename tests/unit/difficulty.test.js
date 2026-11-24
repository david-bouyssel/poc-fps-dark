// Difficulté (T10, plan docs/design/difficulte.md §6, tests 1 à 10) : constantes et
// réglages des trois niveaux, « Normal » = jeu actuel, invariants marche < traque <
// course, ordre des niveaux, liste blanche isDifficulty, erreurs de difficultySettings et
// contrat de graine (même apparition du monstre quel que soit le niveau).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIFFICULTY,
  DEFAULT_DIFFICULTY,
  DIFFICULTY_IDS,
  DIFFICULTY_SETTINGS,
  isDifficulty,
  difficultySettings,
} from '../../src/game/difficulty.js';
import { MONSTER, createMonster, stepMonster } from '../../src/game/monster.js';
import { MOVEMENT } from '../../src/game/movement.js';
import { FOG_DISTANCE } from '../../src/render/raycaster.js';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { findExit } from '../../src/game/exit.js';
import { createPlayer } from '../../src/game/player.js';

const MONSTER_KEYS = ['chaseDistance', 'chaseSpeed', 'graceDuration', 'sightDistance'];
const ORDERED = ['easy', 'normal', 'nightmare'];

function setup(width, height, seed) {
  const grid = toTileGrid(generateMaze({ width, height, seed }));
  return { grid, exit: findExit(grid) };
}

describe('constantes', () => {
  test('DIFFICULTY_IDS vaut [easy, normal, nightmare] ; défaut normal', () => {
    assert.deepEqual([...DIFFICULTY_IDS], ORDERED);
    assert.deepEqual({ ...DIFFICULTY }, { EASY: 'easy', NORMAL: 'normal', NIGHTMARE: 'nightmare' });
    assert.equal(DEFAULT_DIFFICULTY, 'normal');
    assert.deepEqual(Object.keys(DIFFICULTY_SETTINGS).sort(), [...ORDERED].sort());
  });

  test('gel profond : DIFFICULTY, DIFFICULTY_IDS, DIFFICULTY_SETTINGS, chaque niveau et monster', () => {
    assert.ok(Object.isFrozen(DIFFICULTY));
    assert.ok(Object.isFrozen(DIFFICULTY_IDS));
    assert.ok(Object.isFrozen(DIFFICULTY_SETTINGS));
    for (const id of DIFFICULTY_IDS) {
      assert.ok(Object.isFrozen(DIFFICULTY_SETTINGS[id]), id);
      assert.ok(Object.isFrozen(DIFFICULTY_SETTINGS[id].monster), `${id}.monster`);
    }
  });

  test('chaque niveau : exactement les 4 clés monster et un fogDistance fini > 0', () => {
    for (const id of DIFFICULTY_IDS) {
      const s = DIFFICULTY_SETTINGS[id];
      assert.deepEqual(Object.keys(s).sort(), ['fogDistance', 'monster'], id);
      assert.deepEqual(Object.keys(s.monster).sort(), MONSTER_KEYS, id);
      for (const k of MONSTER_KEYS) {
        assert.ok(Number.isFinite(s.monster[k]) && s.monster[k] > 0, `${id}.${k}`);
      }
      assert.ok(Number.isFinite(s.fogDistance) && s.fogDistance > 0, `${id}.fogDistance`);
    }
  });

  test('« Normal » = jeu actuel : monster = MONSTER, fogDistance = FOG_DISTANCE', () => {
    const normal = DIFFICULTY_SETTINGS.normal;
    for (const k of MONSTER_KEYS) assert.equal(normal.monster[k], MONSTER[k], k);
    assert.equal(normal.fogDistance, FOG_DISTANCE);
  });

  test('valeurs du tableau §3', () => {
    assert.deepEqual({ ...DIFFICULTY_SETTINGS.easy.monster },
      { chaseSpeed: 2.9, chaseDistance: 6, graceDuration: 5, sightDistance: 8 });
    assert.deepEqual({ ...DIFFICULTY_SETTINGS.nightmare.monster },
      { chaseSpeed: 4.1, chaseDistance: 12, graceDuration: 1.5, sightDistance: 16 });
    assert.equal(DIFFICULTY_SETTINGS.easy.fogDistance, 8);
    assert.equal(DIFFICULTY_SETTINGS.nightmare.fogDistance, 4.5);
  });

  test('marche < chaseSpeed < course pour chaque niveau (2.5 < v < 4.5)', () => {
    const walk = MOVEMENT.walkSpeed;
    const run = MOVEMENT.walkSpeed * MOVEMENT.runFactor;
    for (const id of DIFFICULTY_IDS) {
      const v = DIFFICULTY_SETTINGS[id].monster.chaseSpeed;
      assert.ok(walk < v && v < run, `${id} : ${v}`);
    }
  });

  test('ordre strict Facile < Normal < Cauchemar (inverse pour grâce et brouillard)', () => {
    const [e, n, h] = ORDERED.map((id) => DIFFICULTY_SETTINGS[id]);
    for (const k of ['chaseSpeed', 'chaseDistance', 'sightDistance']) {
      assert.ok(e.monster[k] < n.monster[k] && n.monster[k] < h.monster[k], k);
    }
    assert.ok(e.monster.graceDuration > n.monster.graceDuration);
    assert.ok(n.monster.graceDuration > h.monster.graceDuration);
    assert.ok(e.fogDistance > n.fogDistance && n.fogDistance > h.fogDistance);
  });
});

describe('isDifficulty', () => {
  test('vrai pour les 3 ids', () => {
    for (const id of DIFFICULTY_IDS) assert.equal(isDifficulty(id), true, id);
  });
  test('faux pour les valeurs hors liste, sans exception', () => {
    for (const v of ['', 'Normal', 'EASY', ' normal', '__proto__', 'constructor', 'toString',
      'hasOwnProperty', null, undefined, 1, {}, [], ['normal']]) {
      assert.equal(isDifficulty(v), false, String(v));
    }
  });
});

describe('difficultySettings', () => {
  test('renvoie la référence de DIFFICULTY_SETTINGS[id]', () => {
    for (const id of DIFFICULTY_IDS) assert.equal(difficultySettings(id), DIFFICULTY_SETTINGS[id]);
  });
  test('id non chaîne -> TypeError', () => {
    for (const v of [null, undefined, 1, {}, [], Symbol('x'), true]) {
      assert.throws(() => difficultySettings(v), TypeError);
    }
  });
  test('id inconnu ou nom de prototype -> RangeError', () => {
    for (const v of ['', 'Normal', 'hard', '__proto__', 'constructor', 'toString']) {
      assert.throws(() => difficultySettings(v), RangeError, v);
    }
  });
});

describe('réglages acceptés par le monstre', () => {
  test('createMonster et stepMonster ne lèvent pas pour chaque niveau', () => {
    const { grid, exit } = setup(8, 8, 42);
    const player = createPlayer(grid);
    for (const id of DIFFICULTY_IDS) {
      const { monster: opts } = DIFFICULTY_SETTINGS[id];
      let m = createMonster(grid, 42, { exit }, opts);
      for (let i = 0; i < 200; i++) m = stepMonster(m, player, 0.05, grid, opts).monster;
      assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y), id);
    }
  });
});

describe('contrat de graine', () => {
  const CASES = [[16, 16, 42], [8, 8, 7], [12, 6, 2024], [5, 4, 1], [32, 32, 99]];
  for (const [w, h, seed] of CASES) {
    test(`${w} x ${h}, graine ${seed} : même apparition aux 3 niveaux, seule la grâce change`, () => {
      const { grid, exit } = setup(w, h, seed);
      const ms = DIFFICULTY_IDS.map((id) => createMonster(grid, seed, { exit }, DIFFICULTY_SETTINGS[id].monster));
      for (const m of ms) {
        for (const k of ['tx', 'ty', 'x', 'y', 'rngState', 'pathDistance']) {
          assert.deepEqual(m[k], ms[0][k], k);
        }
      }
      DIFFICULTY_IDS.forEach((id, i) => {
        assert.equal(ms[i].graceRemaining, DIFFICULTY_SETTINGS[id].monster.graceDuration, id);
      });
      // Normal = createMonster sans options.
      assert.deepEqual(ms[1], createMonster(grid, seed, { exit }));
    });
  }

  test('labyrinthe et sortie : ne dépendent que de la graine et de la taille', () => {
    const a = setup(16, 16, 42);
    const b = setup(16, 16, 42);
    assert.deepEqual(Array.from(a.grid.tiles), Array.from(b.grid.tiles));
    assert.deepEqual(a.exit, b.exit);
  });

  test('même graine, même niveau : deux simulations donnent les mêmes états', () => {
    const { grid, exit } = setup(16, 16, 42);
    const player = createPlayer(grid);
    for (const id of DIFFICULTY_IDS) {
      const opts = DIFFICULTY_SETTINGS[id].monster;
      const run = () => {
        const states = [];
        let m = createMonster(grid, 42, { exit }, opts);
        for (let i = 0; i < 400; i++) {
          m = stepMonster(m, player, 0.05, grid, opts).monster;
          states.push(m);
        }
        return states;
      };
      assert.deepEqual(run(), run(), id);
    }
  });
});
