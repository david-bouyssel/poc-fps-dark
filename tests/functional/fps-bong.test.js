// Flux bout en bout côté Node, sans DOM (plan docs/design/dark-son-bong.md §4 et §6) :
// simulation de update() de main.js avec un monstre réel (createMonster/stepMonster),
// selectBongGain(step.events) puis bongPlayer.play(gain) si gain > 0, et un lecteur
// alimenté par un faux contexte audio dont currentTime avance de dt à chaque image.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { findExit } from '../../src/game/exit.js';
import { MONSTER, MONSTER_MODE, createMonster, stepMonster, isCatching } from '../../src/game/monster.js';
import { BONG, selectBongGain } from '../../src/audio/bong.js';
import { BONG_PLAYER_STATE, createBongPlayer } from '../../src/audio/bong-player.js';

const DT = 1 / 60;
const PLAYER = Object.freeze({ x: 1.5, y: 1.5, angle: 0 });

function fakeParam() {
  return { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
}

function fakeContext() {
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: {},
    oscillators: 0,
    createOscillator() {
      ctx.oscillators += 1;
      return { type: 'sine', frequency: fakeParam(), connect() {}, disconnect() {}, start() {}, stop() {}, onended: null };
    },
    createGain() {
      return { gain: fakeParam(), connect() {}, disconnect() {} };
    },
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
  };
  return ctx;
}

/** Lecteur réel + espion des appels à play (gain demandé, résultat, temps). */
function makeWorld(grid, monster) {
  const ctx = fakeContext();
  const player = createBongPlayer({ createContext: () => ctx });
  const plays = [];
  return { grid, monster, ctx, player, plays, time: 0, caught: false, eventsSeen: [] };
}

/** Une image de update() : stepMonster -> selectBongGain -> play -> isCatching. */
function frame(world) {
  const step = stepMonster(world.monster, PLAYER, DT, world.grid);
  world.monster = step.monster;
  world.eventsSeen.push(...step.events);
  const gain = selectBongGain(step.events);
  if (gain > 0) {
    const played = world.player.play(gain);
    world.plays.push({
      gain,
      played,
      time: world.time,
      pathDistance: Math.min(...step.events.map((e) => e.pathDistance)),
      mode: world.monster.mode,
    });
  }
  if (isCatching(world.monster, PLAYER)) world.caught = true;
  world.time += DT;
  world.ctx.currentTime += DT;
}

describe('bongs d\'un monstre qui traque un joueur immobile', () => {
  const grid = toTileGrid(generateMaze({ width: 5, height: 5, seed: 7 }));
  const world = makeWorld(grid, createMonster(grid, 7, { exit: findExit(grid) }));
  world.player.resume();
  while (!world.caught && world.time < 120) frame(world);

  test('le monstre finit par attraper le joueur', () => {
    assert.ok(world.caught, `pas de capture en ${world.time.toFixed(1)} s`);
  });

  test('chaque gain passé à play vaut selectBongGain(step.events) et est > 0', () => {
    assert.ok(world.plays.length > 0);
    for (const p of world.plays) assert.ok(p.gain > 0 && p.gain <= BONG.maxGain);
  });

  test('aucun bong pendant la grâce, le premier suit la fin de la grâce', () => {
    const effective = world.plays.filter((p) => p.played);
    assert.ok(effective.length > 0, 'aucun bong effectif');
    assert.ok(world.plays[0].time >= MONSTER.graceDuration - 1e-9, `${world.plays[0].time}`);
    assert.ok(effective[0].time < MONSTER.graceDuration + 3 * DT, `${effective[0].time}`);
  });

  test('au plus un bong effectif toutes les minInterval secondes', () => {
    const effective = world.plays.filter((p) => p.played);
    for (let i = 1; i < effective.length; i += 1) {
      assert.ok(effective[i].time - effective[i - 1].time >= BONG.minInterval - 1e-6);
    }
  });

  test('les gains joués ne décroissent pas pendant que la distance diminue', () => {
    const effective = world.plays.filter((p) => p.played);
    let compared = 0;
    for (let i = 1; i < effective.length; i += 1) {
      if (effective[i].pathDistance <= effective[i - 1].pathDistance) {
        compared += 1;
        assert.ok(effective[i].gain >= effective[i - 1].gain,
          `d ${effective[i - 1].pathDistance} -> ${effective[i].pathDistance}, gain ${effective[i - 1].gain} -> ${effective[i].gain}`);
      }
    }
    assert.ok(compared >= 3, `trop peu de bongs comparés (${compared})`);
    assert.ok(effective.some((p) => p.mode === MONSTER_MODE.CHASE), 'aucun bong en traque');
  });

  test('4 oscillateurs par bong effectif', () => {
    assert.equal(world.ctx.oscillators, 4 * world.plays.filter((p) => p.played).length);
  });
});

describe('monstre hors de portée (distance de chemin >= 36) en errance', () => {
  // Couloir horizontal y = 1 de x = 1 à 48, puis un anneau x 48..56, y 1..7 : le monstre
  // tourne aux coins de l'anneau, à au moins 47 tuiles de chemin du joueur en (1, 1).
  function farGrid() {
    const width = 59;
    const height = 9;
    const tiles = new Uint8Array(width * height).fill(1);
    const floor = (x, y) => { tiles[y * width + x] = 0; };
    for (let x = 1; x <= 48; x += 1) floor(x, 1);
    for (let x = 48; x <= 56; x += 1) { floor(x, 1); floor(x, 7); }
    for (let y = 1; y <= 7; y += 1) { floor(48, y); floor(56, y); }
    return { width, height, tiles };
  }

  test('aucun play effectif tant que le monstre reste au-delà de la portée', () => {
    const grid = farGrid();
    const base = createMonster(grid, 3, { exit: null });
    const monster = Object.freeze({
      ...base, tx: 52, ty: 7, x: 52.5, y: 7.5, nextTx: null, nextTy: null,
      fromTx: null, fromTy: null, progress: 0, pathDistance: 61, graceRemaining: 0,
    });
    const world = makeWorld(grid, monster);
    world.player.resume();
    // 20 s à 1.6 tuile/s : au plus 32 tuiles parcourues, il reste toujours à >= 36
    while (world.time < 20) frame(world);
    assert.ok(world.eventsSeen.length > 0, 'aucun virage observé');
    for (const e of world.eventsSeen) assert.ok(e.pathDistance >= BONG.silenceDistance, `${e.pathDistance}`);
    assert.equal(world.plays.filter((p) => p.played).length, 0);
    assert.equal(world.ctx.oscillators, 0);
  });
});

describe('cycle de vie simulé (entrée FPS, sortie, retour, fin de partie)', () => {
  test('resume -> bong ; suspend -> rien ; resume -> bong ; suspend', () => {
    const ctx = fakeContext();
    let created = 0;
    const player = createBongPlayer({ createContext: () => { created += 1; return ctx; } });
    assert.equal(player.play(0.5), false, 'avant l\'entrée en FPS');
    assert.equal(created, 0);

    // 1. entrée FPS
    player.resume();
    assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
    assert.equal(player.play(0.5), true);

    // 2. sortie FPS
    player.suspend();
    ctx.currentTime += 5;
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
    assert.equal(player.play(0.5), false);

    // 3. retour en FPS (ou « Rejouer », ou page de nouveau visible)
    player.resume();
    assert.equal(player.play(0.5), true);

    // 4. fin de partie
    player.suspend();
    ctx.currentTime += 5;
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
    assert.equal(player.play(0.5), false);
    assert.equal(created, 1, 'contexte créé une seule fois');
    assert.equal(ctx.oscillators, 8);
  });
});
