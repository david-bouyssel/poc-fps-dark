// Flux bout en bout côté Node, sans DOM (plan docs/design/monster-cries.md §4 et §6) :
// simulation de update() de main.js (stepRound : stepPlayer -> checkVictory -> stepMonster
// -> isCatching -> declareDefeat ; puis selectBongGain / play -> selectCryGain / playCry), puis
// de endRound() (point 4.3 : playSlurp en défaite, suspend sinon), avec un lecteur réel
// alimenté par un faux contexte audio dont currentTime avance de dt à chaque image.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { shortestPath } from '../../src/game/pathfinding.js';
import { findExit } from '../../src/game/exit.js';
import {
  GAME_STATUS,
  createGameState,
  isGameOver,
} from '../../src/game/game-state.js';
import { MONSTER_EVENT, MONSTER_MODE, createMonster } from '../../src/game/monster.js';
import { stepRound } from '../../src/game/round.js';
import { DEFAULT_DIFFICULTY, difficultySettings } from '../../src/game/difficulty.js';
import { createRoundStats } from '../../src/game/round-stats.js';
import { selectBongGain } from '../../src/audio/bong.js';
import { selectCryGain } from '../../src/audio/monster-cries.js';
import { MONSTER_AUDIO_STATE, createMonsterAudio } from '../../src/audio/monster-audio.js';

const DT = 1 / 60;
const STILL = Object.freeze({ move: 0, strafe: 0, turn: 0, run: false });

function fakeParam() {
  return { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
}

/** Faux contexte : garde chaque oscillateur (arrêts comptés) et chaque filtre. */
function fakeContext() {
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    oscillators: [],
    filters: 0,
    suspendCalls: 0,
    createOscillator() {
      const osc = {
        type: 'sine', frequency: fakeParam(), stops: 0, onended: null,
        connect() {}, disconnect() {}, start() {}, stop() { this.stops += 1; },
      };
      ctx.oscillators.push(osc);
      return osc;
    },
    createGain() {
      return { gain: fakeParam(), connect() {}, disconnect() {} };
    },
    createBiquadFilter() {
      ctx.filters += 1;
      return { type: 'lowpass', frequency: fakeParam(), Q: fakeParam(), connect() {}, disconnect() {} };
    },
    resume: () => Promise.resolve(),
    suspend: () => { ctx.suspendCalls += 1; return Promise.resolve(); },
  };
  return ctx;
}

/** Lecteur réel enveloppé d'un espion : journal ordonné des appels et résultats. */
function spyPlayer(ctx) {
  const real = createMonsterAudio({ createContext: () => ctx });
  const log = [];
  const wrap = (name) => (...args) => {
    const result = real[name](...args);
    log.push({ name, args, result, time: ctx.currentTime, state: real.state });
    return result;
  };
  return {
    real,
    log,
    resume: wrap('resume'),
    suspend: wrap('suspend'),
    play: wrap('play'),
    playCry: wrap('playCry'),
    playSlurp: wrap('playSlurp'),
    get state() { return real.state; },
  };
}

function makeWorld(width, height, seed) {
  const grid = toTileGrid(generateMaze({ width, height, seed }));
  const exit = findExit(grid);
  const ctx = fakeContext();
  const audio = spyPlayer(ctx);
  return {
    grid,
    exit,
    ctx,
    audio,
    player: createPlayer(grid),
    monster: createMonster(grid, seed, { exit }),
    state: createGameState(),
    time: 0,
    ended: false,
    spots: [],
    cryRequests: [],
  };
}

/** endRound() de main.js, point 4.3 du plan. */
function endRound(world) {
  world.ended = true;
  if (world.state.status !== GAME_STATUS.LOST || !world.audio.playSlurp()) {
    world.audio.suspend();
  }
}

/** Une image de update() ; pilot(world) renvoie { intent, angle? }. */
function frame(world, pilot) {
  if (isGameOver(world.state)) return;
  const { intent, angle } = pilot ? pilot(world) : { intent: STILL };
  const p = angle === undefined ? world.player : Object.freeze({ ...world.player, angle });
  const round = Object.freeze({
    grid: world.grid,
    exit: world.exit,
    settings: difficultySettings(DEFAULT_DIFFICULTY),
    player: p,
    monster: world.monster,
    state: world.state,
    time: world.time,
    stats: createRoundStats(),
  });
  const step = stepRound(round, intent, DT);
  world.player = step.round.player;
  world.monster = step.round.monster;
  world.state = step.round.state;
  if (step.monsterStepped) {
    const bong = selectBongGain(step.events);
    if (bong > 0) world.audio.play(bong);
    world.spots.push(...step.events.filter((e) => e.type === MONSTER_EVENT.SPOT)
      .map((e) => ({ ...e, time: world.time })));
    const cry = selectCryGain(step.events);
    if (cry > 0) {
      world.cryRequests.push({ gain: cry, expected: selectCryGain(step.events), time: world.time });
      world.audio.playCry(cry);
    }
  }
  if (step.ended) endRound(world);
  world.time += DT;
  world.ctx.currentTime += DT;
}

function simulate(world, maxSeconds, pilot) {
  while (!world.ended && world.time < maxSeconds) frame(world, pilot);
  return world;
}

const calls = (world, name) => world.audio.log.filter((c) => c.name === name);

/** Pilote qui suit le plus court chemin jusqu'à la sortie, en courant. */
function exitPilot(world) {
  const path = shortestPath(world.grid, 1, 1, world.exit.tx, world.exit.ty);
  let waypoint = 1;
  return (wd) => {
    const { player } = wd;
    if (waypoint >= path.length) return { intent: STILL };
    let tx = path[waypoint].tx + 0.5;
    let ty = path[waypoint].ty + 0.5;
    if (Math.hypot(tx - player.x, ty - player.y) < 0.15 && waypoint < path.length - 1) {
      waypoint += 1;
      tx = path[waypoint].tx + 0.5;
      ty = path[waypoint].ty + 0.5;
    }
    return { intent: { move: 1, strafe: 0, turn: 0, run: true }, angle: Math.atan2(ty - player.y, tx - player.x) };
  };
}

// ---------------------------------------------------------------------------

describe('joueur immobile au départ : un seul cri, puis le sluuurp à la capture', () => {
  for (const [w, h, seed] of [[5, 5, 7], [8, 8, 42], [8, 8, 11]]) {
    describe(`${w} x ${h}, graine ${seed}`, () => {
      const world = makeWorld(w, h, seed);
      world.audio.resume();
      simulate(world, 180);

      test('la manche finit par une capture (LOST)', () => {
        assert.equal(world.state.status, GAME_STATUS.LOST, `fin à ${world.time.toFixed(1)} s`);
      });

      test('un seul cri, au début de la traque, gain = selectCryGain', () => {
        const effective = calls(world, 'playCry').filter((c) => c.result);
        assert.equal(effective.length, 1, `${effective.length} cris joués`);
        assert.equal(world.spots.length, 1, `${world.spots.length} SPOT`);
        assert.ok(Math.abs(effective[0].time - world.spots[0].time) < 1e-9, 'cri au moment du SPOT');
        for (const r of world.cryRequests) {
          assert.equal(r.gain, r.expected);
          assert.ok(r.gain > 0);
        }
        assert.equal(effective[0].args[0], world.cryRequests[0].gain);
      });

      test('aucun cri pendant la traque qui suit', () => {
        const cries = calls(world, 'playCry');
        const first = cries.find((c) => c.result);
        assert.ok(cries.every((c) => c === first || c.time < first.time), 'cri demandé après le premier');
      });

      test('défaite : playSlurp appelé, aucun suspend immédiat, sluuurp programmé', () => {
        assert.equal(calls(world, 'playSlurp').length, 1);
        assert.equal(calls(world, 'playSlurp')[0].result, true);
        assert.equal(calls(world, 'suspend').length, 0, 'suspend immédiat en défaite');
        assert.equal(world.audio.state, MONSTER_AUDIO_STATE.FINALE);
        assert.equal(world.ctx.suspendCalls, 0);
        assert.equal(world.ctx.filters, 2, 'deux voix filtrées du sluuurp');
      });

      test('fin naturelle du sluuurp -> SUSPENDED', () => {
        const slurpOscs = world.ctx.oscillators.slice(-3);
        for (const osc of slurpOscs) osc.onended();
        assert.equal(world.audio.state, MONSTER_AUDIO_STATE.SUSPENDED);
        assert.equal(world.ctx.suspendCalls, 1);
      });
    });
  }
});

describe('victoire : suspend immédiat, aucun sluuurp', () => {
  test('8 x 8, graine 42 : course jusqu\'à la sortie -> WON, suspend, pas de playSlurp', () => {
    const world = makeWorld(8, 8, 42);
    world.audio.resume();
    simulate(world, 120, exitPilot(world));
    assert.equal(world.state.status, GAME_STATUS.WON);
    assert.equal(calls(world, 'playSlurp').length, 0);
    assert.equal(calls(world, 'suspend').length, 1);
    assert.equal(world.audio.state, MONSTER_AUDIO_STATE.SUSPENDED);
    assert.equal(world.ctx.filters, 0, 'aucune voix du sluuurp');
  });
});

describe('cycle après une défaite', () => {
  function lostWorld() {
    const world = makeWorld(5, 5, 7);
    world.audio.resume();
    simulate(world, 180);
    assert.equal(world.state.status, GAME_STATUS.LOST);
    assert.equal(world.audio.state, MONSTER_AUDIO_STATE.FINALE);
    return world;
  }

  test('« Rejouer » (resume) pendant le sluuurp : voix coupées, bongs de nouveau possibles', () => {
    const world = lostWorld();
    const slurpOscs = world.ctx.oscillators.slice(-3);
    world.audio.resume();
    assert.equal(world.audio.state, MONSTER_AUDIO_STATE.RUNNING);
    for (const osc of slurpOscs) assert.ok(osc.stops >= 2, 'sluuurp non coupé');
    world.ctx.currentTime += 10;
    assert.equal(world.audio.play(0.5), true);
    assert.equal(world.audio.playCry(0.5), true);
  });

  test('sortie FPS (suspend) pendant le sluuurp : sluuurp coupé, SUSPENDED', () => {
    const world = lostWorld();
    const slurpOscs = world.ctx.oscillators.slice(-3);
    world.audio.suspend();
    assert.equal(world.audio.state, MONSTER_AUDIO_STATE.SUSPENDED);
    for (const osc of slurpOscs) assert.ok(osc.stops >= 2, 'sluuurp non coupé');
    assert.equal(world.audio.play(0.5), false);
    assert.equal(world.audio.playCry(0.5), false);
  });

  test('le monstre traque bien avant la capture (cri lié à la traque)', () => {
    const world = makeWorld(5, 5, 7);
    world.audio.resume();
    let modeAtCry = null;
    while (!world.ended && world.time < 180) {
      const before = calls(world, 'playCry').length;
      frame(world);
      if (modeAtCry === null && calls(world, 'playCry').length > before) modeAtCry = world.monster.mode;
    }
    assert.equal(modeAtCry, MONSTER_MODE.CHASE);
  });
});
