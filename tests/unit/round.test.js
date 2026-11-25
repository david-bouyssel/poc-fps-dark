// Tests de src/game/round.js (plan docs/design/main-allegement.md, sections 2.2, 3 et 6).
// La référence « avant l'extraction » est l'ordre de update()/startRound() de main.js
// décrit au plan : rotation souris -> stepPlayer -> bilan -> checkVictory -> (si la partie
// continue) stepMonster -> declareDefeat au contact ; horloge += dt avant la victoire.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { findExit } from '../../src/game/exit.js';
import { createPlayer } from '../../src/game/player.js';
import { stepPlayer } from '../../src/game/movement.js';
import { applyMouseTurn } from '../../src/game/mouse-look.js';
import { createMonster, isCatching, stepMonster } from '../../src/game/monster.js';
import {
  GAME_STATUS,
  checkVictory,
  createGameState,
  declareDefeat,
  isGameOver,
} from '../../src/game/game-state.js';
import { advanceStats, createRoundStats } from '../../src/game/round-stats.js';
import { DIFFICULTY, DIFFICULTY_IDS, difficultySettings } from '../../src/game/difficulty.js';
import { dangerLevel } from '../../src/game/danger.js';
import { createRound, isRoundOver, roundDanger, stepRound } from '../../src/game/round.js';

const STILL = Object.freeze({ move: 0, strafe: 0, turn: 0, run: false });
const FORWARD = Object.freeze({ move: 1, strafe: 0, turn: 0, run: false });
const DT = 1 / 60;

function level(seed = 42, size = 16) {
  const grid = toTileGrid(generateMaze({ width: size, height: size, seed }));
  return { grid, seed, exit: findExit(grid) };
}

function newRound(seed = 42, difficulty = DIFFICULTY.NORMAL, size = 16) {
  return createRound({ ...level(seed, size), difficulty });
}

/** Copie gelée de la manche avec des champs remplacés (positions de test). */
function withFields(round, fields) {
  return Object.freeze({ ...round, ...fields });
}

/** Ancienne image de update() (référence de l'ordre avant extraction). */
function legacyFrame(world, intent, dt, turn) {
  if (isGameOver(world.state)) return world;
  const clock = world.clock + dt;
  const turned = applyMouseTurn(world.player, turn);
  const player = stepPlayer(turned, intent, dt, world.grid);
  const stats = advanceStats(world.stats, dt, turned, player);
  let state = checkVictory(world.state, player, world.exit);
  let { monster } = world;
  let events = [];
  if (!isGameOver(state)) {
    const step = stepMonster(monster, player, dt, world.grid, world.settings.monster);
    monster = step.monster;
    events = step.events;
    if (isCatching(monster, player)) state = declareDefeat(state);
  }
  return { ...world, clock, player, monster, state, stats, events };
}

describe('createRound', () => {
  test('mêmes valeurs qu’avant l’extraction : createPlayer, createMonster(grid, seed, { exit }, settings.monster)', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      const lv = level(42);
      const round = createRound({ ...lv, difficulty });
      const settings = difficultySettings(difficulty);
      assert.deepEqual(round.player, createPlayer(lv.grid));
      assert.deepEqual(round.monster, createMonster(lv.grid, lv.seed, { exit: lv.exit }, settings.monster));
      assert.equal(round.settings, settings, 'réglages de difficulté (référence)');
      assert.equal(round.monster.graceRemaining, settings.monster.graceDuration);
      assert.deepEqual(round.state, createGameState());
      assert.equal(round.state.status, GAME_STATUS.PLAYING);
      assert.equal(round.time, 0);
      assert.deepEqual(round.stats, createRoundStats());
      assert.equal(round.grid, lv.grid);
      assert.equal(round.exit, lv.exit);
    }
  });

  test('gel de la manche et de ses champs', () => {
    const round = newRound();
    assert.ok(Object.isFrozen(round));
    for (const key of ['player', 'monster', 'state', 'stats', 'settings']) {
      assert.ok(Object.isFrozen(round[key]), key);
    }
  });

  test('déterministe par graine ; graines différentes -> monstres différents pour au moins une', () => {
    assert.deepEqual(newRound(7), newRound(7));
    const monsters = [1, 2, 3, 4, 5].map((seed) => newRound(seed).monster);
    assert.ok(monsters.some((m) => m.x !== monsters[0].x || m.y !== monsters[0].y));
  });

  test('la difficulté change les réglages du monstre (grâce)', () => {
    const easy = newRound(42, DIFFICULTY.EASY);
    const nightmare = newRound(42, DIFFICULTY.NIGHTMARE);
    assert.ok(easy.monster.graceRemaining > nightmare.monster.graceRemaining);
    assert.notEqual(easy.settings.fogDistance, nightmare.settings.fogDistance);
  });

  test('erreurs propagées : difficulté, grille, graine', () => {
    const lv = level();
    assert.throws(() => createRound({ ...lv, difficulty: undefined }), TypeError);
    assert.throws(() => createRound({ ...lv, difficulty: 'impossible' }), RangeError);
    assert.throws(() => createRound({ ...lv, grid: null, difficulty: DIFFICULTY.NORMAL }), TypeError);
    assert.throws(() => createRound({ ...lv, seed: 'x', difficulty: DIFFICULTY.NORMAL }), TypeError);
    assert.throws(() => createRound({ ...lv, seed: -1, difficulty: DIFFICULTY.NORMAL }), RangeError);
    assert.throws(() => createRound(), TypeError);
  });
});

describe('stepRound', () => {
  test('équivalent à l’ancienne image de update() sur une partie entière (rotation souris comprise)', () => {
    // Grilles 4 x 4 : le monstre attrape le joueur immobile en quelques secondes.
    for (const seed of [1, 42, 7, 2024]) {
      let round = newRound(seed, DIFFICULTY.NORMAL, 4);
      let world = {
        grid: round.grid, exit: round.exit, settings: round.settings, player: round.player,
        monster: round.monster, state: round.state, stats: round.stats, clock: 0,
      };
      let ended = 0;
      for (let i = 0; i < 60 * 90 && !isGameOver(world.state); i++) {
        // Avance un tiers de seconde puis reste immobile.
        const intent = i < 20 ? FORWARD : STILL;
        const turn = i % 45 === 0 ? 0.4 : 0;
        const step = stepRound(round, intent, DT, turn);
        world = legacyFrame(world, intent, DT, turn);
        round = step.round;
        assert.deepEqual(round.player, world.player, `joueur, image ${i}`);
        assert.deepEqual(round.monster, world.monster, `monstre, image ${i}`);
        assert.equal(round.state.status, world.state.status);
        assert.equal(round.time, world.clock);
        assert.deepEqual(round.stats, world.stats);
        assert.deepEqual([...step.events], [...world.events]);
        if (step.ended) ended++;
      }
      assert.equal(world.state.status, GAME_STATUS.LOST, `graine ${seed} : capture`);
      assert.equal(ended, 1, 'ended vrai une seule fois, au pas final');
      const after = stepRound(round, FORWARD, DT);
      assert.equal(after.round, round, 'aucun pas après la fin');
    }
  });

  test('partie en cours : horloge += dt, arguments non modifiés, résultat gelé, monsterStepped', () => {
    const round = newRound();
    const snapshot = structuredClone({ ...round, grid: null });
    const step = stepRound(round, FORWARD, DT);
    assert.ok(Object.isFrozen(step));
    assert.ok(Object.isFrozen(step.round));
    assert.ok(Object.isFrozen(step.events));
    assert.notEqual(step.round, round);
    assert.equal(step.round.time, DT);
    assert.equal(step.monsterStepped, true);
    assert.equal(step.ended, false);
    assert.deepEqual(step.round.player, stepPlayer(round.player, FORWARD, DT, round.grid));
    assert.deepEqual(step.round.monster,
      stepMonster(round.monster, step.round.player, DT, round.grid, round.settings.monster).monster);
    assert.deepEqual(structuredClone({ ...round, grid: null }), snapshot);
    assert.equal(step.round.grid, round.grid);
    assert.equal(step.round.exit, round.exit);
    assert.equal(step.round.settings, round.settings);
  });

  test('rotation souris appliquée avant le déplacement', () => {
    const round = newRound();
    const turn = Math.PI / 2;
    const step = stepRound(round, FORWARD, DT, turn);
    const expected = stepPlayer(applyMouseTurn(round.player, turn), FORWARD, DT, round.grid);
    assert.deepEqual(step.round.player, expected);
    // turn par défaut 0 : identique à un appel sans rotation.
    assert.deepEqual(stepRound(round, FORWARD, DT).round.player, stepRound(round, FORWARD, DT, 0).round.player);
  });

  test('bilan : temps et distance avancés depuis la position tournée', () => {
    const round = newRound();
    const step = stepRound(round, FORWARD, DT, 0.3);
    const turned = applyMouseTurn(round.player, 0.3);
    assert.deepEqual(step.round.stats, advanceStats(round.stats, DT, turned, step.round.player));
    assert.ok(step.round.stats.distance > 0);
  });

  test('victoire : won, ended, monstre immobile, events vide, horloge avancée', () => {
    const base = newRound();
    const onExit = Object.freeze({ ...base.player, x: base.exit.tx + 0.5, y: base.exit.ty + 0.5 });
    const round = withFields(base, { player: onExit });
    const step = stepRound(round, STILL, DT);
    assert.equal(step.round.state.status, GAME_STATUS.WON);
    assert.equal(step.ended, true);
    assert.equal(step.monsterStepped, false);
    assert.equal(step.events.length, 0);
    assert.equal(step.round.monster, round.monster, 'monstre inchangé (même référence)');
    assert.equal(step.round.time, DT, 'l’horloge avance au pas qui termine la manche');
  });

  test('victoire prioritaire : sortie et contact dans le même pas -> won', () => {
    const base = newRound();
    const at = { x: base.exit.tx + 0.5, y: base.exit.ty + 0.5 };
    const round = withFields(base, {
      player: Object.freeze({ ...base.player, ...at }),
      monster: Object.freeze({ ...base.monster, ...at, tx: base.exit.tx, ty: base.exit.ty }),
    });
    assert.ok(isCatching(round.monster, round.player));
    const step = stepRound(round, STILL, DT);
    assert.equal(step.round.state.status, GAME_STATUS.WON);
    assert.equal(step.monsterStepped, false);
  });

  test('défaite au contact, y compris pendant la grâce', () => {
    const base = newRound();
    assert.ok(base.monster.graceRemaining > 0);
    const round = withFields(base, {
      monster: Object.freeze({
        ...base.monster, tx: Math.floor(base.player.x), ty: Math.floor(base.player.y), x: base.player.x, y: base.player.y,
      }),
    });
    const step = stepRound(round, STILL, DT);
    assert.equal(step.round.state.status, GAME_STATUS.LOST);
    assert.equal(step.ended, true);
    assert.equal(step.monsterStepped, true);
  });

  test('manche finie : même référence, events vide gelé, ended et monsterStepped faux, horloge figée', () => {
    for (const status of [GAME_STATUS.WON, GAME_STATUS.LOST]) {
      const base = newRound();
      const over = withFields(base, { state: Object.freeze({ status }), time: 2.5 });
      const step = stepRound(over, FORWARD, DT, 1);
      assert.equal(step.round, over);
      assert.equal(step.events.length, 0);
      assert.ok(Object.isFrozen(step.events));
      assert.equal(step.ended, false);
      assert.equal(step.monsterStepped, false);
      assert.equal(step.round.time, 2.5);
      assert.ok(Object.isFrozen(step));
    }
  });

  test('dt 0 : joueur, monstre, horloge et bilan inchangés, la partie continue', () => {
    const round = newRound();
    const step = stepRound(round, FORWARD, 0);
    assert.deepEqual(step.round.player, round.player);
    assert.equal(step.round.monster.graceRemaining, round.monster.graceRemaining);
    assert.equal(step.round.monster.x, round.monster.x);
    assert.equal(step.round.monster.y, round.monster.y);
    assert.equal(step.round.time, 0);
    assert.deepEqual(step.round.stats, round.stats);
    assert.equal(step.ended, false);
    assert.equal(step.monsterStepped, true);
  });

  test('TypeError sur une manche mal formée', () => {
    const good = newRound();
    const bad = [null, undefined, 1, 'round', {}, withFields(good, { state: null }),
      withFields(good, { player: null }), withFields(good, { monster: 3 }),
      withFields(good, { settings: null }), withFields(good, { time: Number.NaN }),
      withFields(good, { time: '0' })];
    for (const round of bad) {
      assert.throws(() => stepRound(round, STILL, DT), TypeError);
      assert.throws(() => isRoundOver(round), TypeError);
      assert.throws(() => roundDanger(round), TypeError);
    }
  });
});

describe('isRoundOver', () => {
  test('playing -> false, won et lost -> true', () => {
    const round = newRound();
    assert.equal(isRoundOver(round), false);
    assert.equal(isRoundOver(withFields(round, { state: Object.freeze({ status: GAME_STATUS.WON }) })), true);
    assert.equal(isRoundOver(withFields(round, { state: Object.freeze({ status: GAME_STATUS.LOST }) })), true);
  });
});

describe('roundDanger', () => {
  test('0 pendant la grâce', () => {
    const round = newRound();
    assert.ok(round.monster.graceRemaining > 0);
    assert.equal(roundDanger(withFields(round, { monster: Object.freeze({ ...round.monster, pathDistance: 1 }) })), 0);
  });

  test('après la grâce : dangerLevel(pathDistance) ; 0 en fin de partie', () => {
    const base = newRound();
    const awake = Object.freeze({ ...base.monster, graceRemaining: 0, pathDistance: 2 });
    const round = withFields(base, { monster: awake });
    assert.equal(roundDanger(round), dangerLevel(2));
    assert.ok(roundDanger(round) > 0);
    for (const status of [GAME_STATUS.WON, GAME_STATUS.LOST]) {
      assert.equal(roundDanger(withFields(round, { state: Object.freeze({ status }) })), 0);
    }
  });
});

describe('pureté de round.js (scan statique)', () => {
  const code = readFileSync(fileURLToPath(new URL('../../src/game/round.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('aucun DOM, horloge, hasard global, audio, réseau, stockage, log, timer', () => {
    for (const re of [/\bwindow\b/, /\bdocument\b/, /globalThis/, /\bnavigator\b/, /Math\.random/, /\bDate\b/,
      /performance/, /requestAnimationFrame/, /setTimeout|setInterval/, /\bconsole\./, /AudioContext/,
      /\bfetch\b|XMLHttpRequest|WebSocket|sendBeacon/, /localStorage|sessionStorage|indexedDB|cookie/,
      /\beval\b|new\s+Function/, /import\s*\(/]) {
      assert.doesNotMatch(code, re, String(re));
    }
  });

  test('imports relatifs limités à src/game/ et src/maze/', () => {
    const specs = [...code.matchAll(/^\s*import\b[^;]*?from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    assert.ok(specs.length > 0);
    for (const spec of specs) {
      assert.match(spec, /^\.\/[\w-]+\.js$|^\.\.\/maze\/[\w-]+\.js$/, spec);
    }
    assert.equal([...code.matchAll(/^\s*import\b/gm)].length, specs.length, 'import non statique');
  });
});
