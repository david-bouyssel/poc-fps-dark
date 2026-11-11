// Flux bout en bout côté Node, sans DOM (plan docs/design/dark-monstre.md §3.4 et §6) :
// generateMaze -> toTileGrid -> findExit -> createMonster, puis simulation de update()
// de main.js : stepPlayer -> checkVictory -> (si partie en cours) stepMonster ->
// isCatching -> declareDefeat.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { stepPlayer, collides } from '../../src/game/movement.js';
import { shortestPath } from '../../src/game/pathfinding.js';
import { findExit } from '../../src/game/exit.js';
import {
  GAME_STATUS,
  createGameState,
  checkVictory,
  declareDefeat,
  isGameOver,
} from '../../src/game/game-state.js';
import {
  MONSTER,
  MONSTER_MODE,
  createMonster,
  stepMonster,
  isCatching,
} from '../../src/game/monster.js';

const STILL = Object.freeze({ move: 0, strafe: 0, turn: 0, run: false });

function setup(width, height, seed) {
  const grid = toTileGrid(generateMaze({ width, height, seed }));
  const exit = findExit(grid);
  return { grid, exit, seed };
}

/**
 * Une image de update() (ordre §3.4). pilot(world) renvoie { intent, angle? } ; angle
 * fixé directement simule un joueur qui vise parfaitement (rotation instantanée).
 */
function frame(world, dt, pilot) {
  const { intent, angle } = pilot ? pilot(world) : { intent: STILL };
  const p = angle === undefined ? world.player : Object.freeze({ ...world.player, angle });
  world.player = stepPlayer(p, intent, dt, world.grid);
  world.state = checkVictory(world.state, world.player, world.exit);
  if (!isGameOver(world.state)) {
    const step = stepMonster(world.monster, world.player, dt, world.grid);
    world.monster = step.monster;
    if (isCatching(world.monster, world.player)) {
      world.state = declareDefeat(world.state);
      world.caught = true;
    }
  }
  world.time += dt;
}

function simulate(world, dt, maxSeconds, pilot) {
  while (!isGameOver(world.state) && world.time < maxSeconds) frame(world, dt, pilot);
  return world;
}

/** Pilote qui suit path (tableau de tuiles) à partir de l'indice start. */
function pathPilot(path, start, run) {
  let waypoint = start + 1;
  return (world) => {
    const { player } = world;
    if (waypoint >= path.length) return { intent: STILL };
    let tx = path[waypoint].tx + 0.5;
    let ty = path[waypoint].ty + 0.5;
    if (Math.hypot(tx - player.x, ty - player.y) < 0.15 && waypoint < path.length - 1) {
      waypoint++;
      tx = path[waypoint].tx + 0.5;
      ty = path[waypoint].ty + 0.5;
    }
    return {
      intent: { move: 1, strafe: 0, turn: 0, run },
      angle: Math.atan2(ty - player.y, tx - player.x),
    };
  };
}

describe('joueur immobile en (1.5, 1.5)', () => {
  for (const [w, h, seed] of [[2, 2, 1], [2, 3, 5], [3, 3, 42], [4, 4, 7], [5, 4, 2024]]) {
    test(`${w} x ${h}, graine ${seed} : capture après la grâce -> LOST`, () => {
      const { grid, exit } = setup(w, h, seed);
      const world = {
        grid,
        exit,
        player: createPlayer(grid),
        state: createGameState(),
        monster: createMonster(grid, seed, { exit }),
        time: 0,
        caught: false,
      };
      const start = { x: world.monster.x, y: world.monster.y };
      // Pendant la grâce, le monstre ne bouge pas.
      while (world.time < MONSTER.graceDuration - 0.05) {
        frame(world, 0.016);
        assert.equal(world.monster.x, start.x);
        assert.equal(world.monster.y, start.y);
        assert.equal(world.state.status, GAME_STATUS.PLAYING);
      }
      simulate(world, 0.016, 900);
      assert.equal(world.caught, true, `pas de capture en ${world.time.toFixed(0)} s`);
      assert.equal(world.state.status, GAME_STATUS.LOST);
      assert.ok(world.time > MONSTER.graceDuration);
      assert.ok(isCatching(world.monster, world.player));
      // Le premier état final l'emporte.
      assert.equal(checkVictory(world.state, exit, exit), world.state);
    });
  }
});

/**
 * Joueur placé sur le chemin (1, 1) -> sortie à l'indice lead, monstre en traque sur la
 * tuile (1, 1), derrière lui.
 */
function chaseWorld(grid, exit, seed, lead) {
  const path = shortestPath(grid, 1, 1, exit.tx, exit.ty);
  const base = createMonster(grid, seed, { exit });
  const monster = Object.freeze({
    ...base,
    tx: 1,
    ty: 1,
    x: 1.5,
    y: 1.5,
    nextTx: null,
    nextTy: null,
    fromTx: null,
    fromTy: null,
    progress: 0,
    mode: MONSTER_MODE.CHASE,
    heading: null,
    pathDistance: lead,
    graceRemaining: 0,
  });
  const player = Object.freeze({
    ...createPlayer(grid),
    x: path[lead].tx + 0.5,
    y: path[lead].ty + 0.5,
  });
  return {
    path,
    world: { grid, exit, player, state: createGameState(), monster, time: 0, caught: false },
  };
}

const RUN_CASES = [[8, 8, 42], [8, 8, 7], [12, 6, 2024], [16, 16, 99]];

describe('fuite en courant vers la sortie, monstre en traque derrière', () => {
  for (const [w, h, seed] of RUN_CASES) {
    test(`${w} x ${h}, graine ${seed} : WON sans capture`, () => {
      const { grid, exit } = setup(w, h, seed);
      const lead = 4;
      const { path, world } = chaseWorld(grid, exit, seed, lead);
      assert.ok(path.length > lead + 10, 'chemin trop court pour le test');
      const pilot = pathPilot(path, lead, true);
      let chased = false;
      simulate(world, 0.016, 300, (wd) => {
        if (wd.monster.mode === MONSTER_MODE.CHASE) chased = true;
        assert.equal(collides(grid, wd.player.x, wd.player.y), false);
        return pilot(wd);
      });
      assert.equal(world.caught, false, 'capturé en courant');
      assert.equal(world.state.status, GAME_STATUS.WON);
      assert.ok(chased, 'le monstre n\'a jamais traqué');
    });
  }
});

describe('même parcours en marchant, monstre en traque derrière', () => {
  for (const [w, h, seed] of RUN_CASES) {
    test(`${w} x ${h}, graine ${seed} : capture -> LOST`, () => {
      const { grid, exit } = setup(w, h, seed);
      const lead = 4;
      const { path, world } = chaseWorld(grid, exit, seed, lead);
      // Écart 4 tuiles, rattrapé à 3.4 - 2.5 = 0.9 tuile/s : il faut un chemin assez long.
      assert.ok(path.length - 1 - lead >= 12, 'chemin trop court pour le test');
      simulate(world, 0.016, 300, pathPilot(path, lead, false));
      assert.equal(world.caught, true, 'jamais rattrapé en marchant');
      assert.equal(world.state.status, GAME_STATUS.LOST);
    });
  }
});

describe('victoire et contact dans le même pas', () => {
  test('-> WON (checkVictory passe avant le monstre)', () => {
    const { grid, exit, seed } = setup(8, 8, 42);
    const path = shortestPath(grid, 1, 1, exit.tx, exit.ty);
    const before = path[path.length - 2];
    // Joueur juste avant la tuile de sortie, qui y entre pendant ce pas.
    const dx = exit.tx - before.tx;
    const dy = exit.ty - before.ty;
    const angle = Math.atan2(dy, dx);
    const px = before.tx + 0.5 + dx * 0.45;
    const py = before.ty + 0.5 + dy * 0.45;
    const player = Object.freeze({ ...createPlayer(grid), x: px, y: py, angle });
    // Monstre arrêté au centre de la tuile voisine : contact au départ du pas.
    const monster = Object.freeze({
      ...createMonster(grid, seed, { exit }),
      tx: before.tx,
      ty: before.ty,
      x: before.tx + 0.5,
      y: before.ty + 0.5,
      nextTx: null,
      nextTy: null,
      fromTx: null,
      fromTy: null,
      progress: 0,
      graceRemaining: 2,
    });
    const world = { grid, exit, player, state: createGameState(), monster, time: 0, caught: false };
    const forward = { move: 1, strafe: 0, turn: 0, run: false };
    frame(world, 0.05, () => ({ intent: forward }));
    assert.equal(Math.floor(world.player.x), exit.tx);
    assert.equal(Math.floor(world.player.y), exit.ty);
    assert.ok(isCatching(world.monster, world.player), 'pas de contact : test mal construit');
    assert.equal(world.state.status, GAME_STATUS.WON);
    assert.equal(world.caught, false);
  });

  test('contact pendant la grâce -> LOST', () => {
    const { grid, exit, seed } = setup(8, 8, 42);
    const base = createMonster(grid, seed, { exit });
    assert.ok(base.graceRemaining > 0);
    const world = {
      grid,
      exit,
      player: Object.freeze({ ...createPlayer(grid), x: base.x + 0.3, y: base.y }),
      state: createGameState(),
      monster: base,
      time: 0,
      caught: false,
    };
    if (collides(grid, world.player.x, world.player.y)) {
      world.player = Object.freeze({ ...world.player, x: base.x, y: base.y + 0.3 });
    }
    if (collides(grid, world.player.x, world.player.y)) {
      world.player = Object.freeze({ ...world.player, x: base.x, y: base.y });
    }
    frame(world, 0.016);
    assert.equal(world.state.status, GAME_STATUS.LOST);
  });
});

describe('« Rejouer »', () => {
  for (const [w, h, seed] of [[8, 8, 42], [16, 16, 99], [64, 64, 3]]) {
    test(`${w} x ${h}, graine ${seed} : deux createMonster successifs -> états égaux, même errance`, () => {
      const { grid, exit } = setup(w, h, seed);
      const a = createMonster(grid, seed, { exit });
      const b = createMonster(grid, seed, { exit });
      assert.deepEqual(a, b);
      // Même manche rejouée (joueur immobile) : même trajectoire du monstre.
      const run = () => {
        const world = {
          grid,
          exit,
          player: createPlayer(grid),
          state: createGameState(),
          monster: createMonster(grid, seed, { exit }),
          time: 0,
          caught: false,
        };
        const trace = [];
        for (let i = 0; i < 400 && !isGameOver(world.state); i++) {
          frame(world, 0.05);
          trace.push([world.monster.x, world.monster.y, world.monster.mode]);
        }
        return trace;
      };
      assert.deepEqual(run(), run());
    });
  }
});
