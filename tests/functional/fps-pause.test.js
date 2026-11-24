// Plan docs/design/pause.md §4 et §6 (cas 12 à 17) : pause de la manche en vue FPS.
// Simulation sans DOM, sur le schéma de fps-monster.test.js : createGameLoop avec un faux
// requestFrame avancé à la main, update() de main.js (stepPlayer -> checkVictory ->
// stepMonster -> isCatching -> declareDefeat), et un faux lecteur audio qui compte
// suspend / resume / playSlurp. pauseRound / resumeRound reproduisent l'ordre du plan §4.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { stepPlayer } from '../../src/game/movement.js';
import { shortestPath } from '../../src/game/pathfinding.js';
import { findExit } from '../../src/game/exit.js';
import { createGameLoop } from '../../src/game/loop.js';
import {
  GAME_STATUS,
  createGameState,
  checkVictory,
  declareDefeat,
  isGameOver,
} from '../../src/game/game-state.js';
import {
  MONSTER_MODE,
  createMonster,
  stepMonster,
  isCatching,
} from '../../src/game/monster.js';
import {
  PAUSE_REASON,
  createPauseState,
  pauseGame,
  resumeGame,
  isPaused,
  canPause,
} from '../../src/game/pause.js';

const STILL = Object.freeze({ move: 0, strafe: 0, turn: 0, run: false });
const FRAME_MS = 16;

function fakeAudio() {
  const calls = { suspend: 0, resume: 0, slurp: 0 };
  return {
    calls,
    suspend() { calls.suspend += 1; },
    resume() { calls.resume += 1; },
    playSlurp() { calls.slurp += 1; return true; },
  };
}

/** Faux requestFrame : file de callbacks, horloge avancée à la main. */
function fakeFrames() {
  const queue = new Map();
  let nextId = 1;
  return {
    now: 0,
    requestFrame(cb) {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancelFrame(id) { queue.delete(id); },
    pending() { return queue.size; },
    /** Exécute les callbacks en attente à l'horodatage now + ms. */
    tick(ms = FRAME_MS) {
      this.now += ms;
      const cbs = [...queue.values()];
      queue.clear();
      for (const cb of cbs) cb(this.now);
    },
  };
}

/**
 * Monde de manche : joueur placé sur le chemin (1, 1) -> sortie à l'indice lead, monstre
 * en traque sur la tuile (1, 1). Joueur immobile.
 */
function chaseRound(w, h, seed, lead) {
  const grid = toTileGrid(generateMaze({ width: w, height: h, seed }));
  const exit = findExit(grid);
  const path = shortestPath(grid, 1, 1, exit.tx, exit.ty);
  assert.ok(path.length > lead + 1, 'chemin trop court');
  const base = createMonster(grid, seed, { exit });
  const monster = Object.freeze({
    ...base,
    tx: 1, ty: 1, x: 1.5, y: 1.5,
    nextTx: null, nextTy: null, fromTx: null, fromTy: null, progress: 0,
    mode: MONSTER_MODE.CHASE, heading: null, pathDistance: lead, graceRemaining: 0,
  });
  const player = Object.freeze({
    ...createPlayer(grid),
    x: path[lead].tx + 0.5,
    y: path[lead].ty + 0.5,
  });
  return { grid, exit, player, monster };
}

/** Harnais : reproduit l'état mutable de main.js en vue FPS. */
function makeGame(round) {
  const audio = fakeAudio();
  const frames = fakeFrames();
  const g = {
    ...round,
    state: createGameState(),
    pauseState: createPauseState(),
    viewMode: 'fps',
    audio,
    frames,
    dts: [],
    gameTime: 0,
    endScreen: false,
  };

  function endRound() {
    g.loop.stop();
    if (g.state.status !== GAME_STATUS.LOST || !audio.playSlurp()) audio.suspend();
    g.endScreen = true;
  }

  function update(dt) {
    g.dts.push(dt);
    g.player = stepPlayer(g.player, STILL, dt, g.grid);
    g.state = checkVictory(g.state, g.player, g.exit);
    if (!isGameOver(g.state)) {
      g.monster = stepMonster(g.monster, g.player, dt, g.grid).monster;
      if (isCatching(g.monster, g.player)) g.state = declareDefeat(g.state);
    }
    g.gameTime += dt;
    if (isGameOver(g.state)) endRound();
  }

  g.loop = createGameLoop({
    update,
    render() {},
    requestFrame: (cb) => frames.requestFrame(cb),
    cancelFrame: (id) => frames.cancelFrame(id),
  });

  // Plan §4 : pauseRound(reason).
  g.pauseRound = (reason) => {
    if (g.viewMode !== 'fps' || !canPause(g.pauseState, g.state)) return;
    g.pauseState = pauseGame(g.pauseState, reason);
    g.loop.stop();
    audio.suspend();
  };
  // Plan §4 : resumeRound().
  g.resumeRound = () => {
    if (g.viewMode !== 'fps' || !isPaused(g.pauseState)) return;
    g.pauseState = resumeGame(g.pauseState);
    audio.resume();
    g.loop.start();
  };
  g.start = () => { audio.resume(); g.loop.start(); };
  g.runFrames = (n, ms = FRAME_MS) => {
    for (let i = 0; i < n && !isGameOver(g.state); i += 1) frames.tick(ms);
  };
  return g;
}

const snapshot = (m) => ({ x: m.x, y: m.y, tx: m.tx, ty: m.ty, mode: m.mode, progress: m.progress });

describe('monstre figé pendant la pause (cas 12)', () => {
  test('60 s de pause : premier dt nul, monstre identique, statut PLAYING', () => {
    const g = makeGame(chaseRound(8, 8, 42, 8));
    g.start();
    g.runFrames(10);
    assert.equal(g.state.status, GAME_STATUS.PLAYING);
    assert.equal(g.monster.mode, MONSTER_MODE.CHASE);

    g.pauseRound(PAUSE_REASON.MANUAL);
    assert.equal(isPaused(g.pauseState), true);
    assert.equal(g.loop.isRunning(), false);
    assert.equal(g.frames.pending(), 0, 'image encore programmée en pause');
    const before = snapshot(g.monster);
    const dtCount = g.dts.length;

    // 60 s d'horloge sans image exécutée.
    for (let i = 0; i < 60; i += 1) g.frames.tick(1000);
    assert.equal(g.dts.length, dtCount, 'update appelé pendant la pause');
    assert.deepEqual(snapshot(g.monster), before);

    g.resumeRound();
    g.frames.tick(60_000);
    assert.equal(g.dts[dtCount], 0, 'le premier dt après la reprise doit valoir 0');
    assert.deepEqual(snapshot(g.monster), before);
    assert.equal(g.state.status, GAME_STATUS.PLAYING);
  });
});

describe('pas de défaite en pause (cas 13)', () => {
  test('monstre à une tuile : aucune capture en pause, capture après la reprise', () => {
    const g = makeGame(chaseRound(8, 8, 42, 1));
    g.start();
    g.frames.tick(); // première image, dt = 0
    assert.equal(g.state.status, GAME_STATUS.PLAYING);
    g.pauseRound(PAUSE_REASON.BLUR);
    for (let i = 0; i < 600; i += 1) g.frames.tick();
    assert.equal(g.state.status, GAME_STATUS.PLAYING);
    assert.equal(g.endScreen, false);

    g.resumeRound();
    g.runFrames(60 * 30);
    assert.equal(g.state.status, GAME_STATUS.LOST);
    assert.ok(isCatching(g.monster, g.player));
    assert.equal(g.endScreen, true);
  });
});

describe('son (cas 14)', () => {
  test('pauseRound -> un suspend, resumeRound -> un resume, second pauseRound sans effet', () => {
    const g = makeGame(chaseRound(8, 8, 42, 8));
    g.start();
    g.runFrames(5);
    const base = { ...g.audio.calls };

    g.pauseRound(PAUSE_REASON.MANUAL);
    assert.equal(g.audio.calls.suspend, base.suspend + 1);
    // blur après P : déjà en pause, plus rien n'est appelé, raison MANUAL conservée.
    g.pauseRound(PAUSE_REASON.BLUR);
    g.pauseRound(PAUSE_REASON.HIDDEN);
    assert.equal(g.audio.calls.suspend, base.suspend + 1);
    assert.equal(g.pauseState.reason, PAUSE_REASON.MANUAL);
    assert.equal(g.audio.calls.resume, base.resume);

    g.resumeRound();
    assert.equal(g.audio.calls.resume, base.resume + 1);
    // Reprise hors pause : sans effet.
    g.resumeRound();
    assert.equal(g.audio.calls.resume, base.resume + 1);
    assert.equal(g.audio.calls.suspend, base.suspend + 1);
    assert.equal(g.loop.isRunning(), true);
  });
});

describe('pas de pause en fin de partie (cas 15)', () => {
  test('après la défaite : canPause faux, blur ne coupe pas le sluuurp', () => {
    const g = makeGame(chaseRound(8, 8, 42, 1));
    g.start();
    g.runFrames(60 * 30);
    assert.equal(g.state.status, GAME_STATUS.LOST);
    assert.equal(g.audio.calls.slurp, 1);
    const suspendsAtEnd = g.audio.calls.suspend;

    assert.equal(canPause(g.pauseState, g.state), false);
    g.pauseRound(PAUSE_REASON.BLUR);
    g.pauseRound(PAUSE_REASON.MANUAL);
    assert.equal(isPaused(g.pauseState), false);
    assert.equal(g.audio.calls.suspend, suspendsAtEnd, 'suspend lié à la pause en fin de partie');
  });

  test('declareDefeat direct : canPause faux', () => {
    assert.equal(canPause(createPauseState(), declareDefeat(createGameState())), false);
  });
});

describe('reprise déterministe (cas 16)', () => {
  test('même trajectoire du monstre avec et sans pause, à temps de jeu égal', () => {
    const plain = makeGame(chaseRound(12, 6, 2024, 10));
    const paused = makeGame(chaseRound(12, 6, 2024, 10));
    plain.start();
    paused.start();
    const trace = (g) => snapshot(g.monster);
    const A = [];
    const B = [];

    // 1 + 200 images (la première a dt = 0) dans la manche sans pause.
    plain.frames.tick();
    for (let i = 0; i < 200 && !isGameOver(plain.state); i += 1) {
      plain.frames.tick();
      A.push(trace(plain));
    }

    paused.frames.tick();
    for (let i = 0; i < 100; i += 1) {
      paused.frames.tick();
      B.push(trace(paused));
    }
    paused.pauseRound(PAUSE_REASON.HIDDEN);
    for (let i = 0; i < 30; i += 1) paused.frames.tick(1000);
    paused.resumeRound();
    paused.frames.tick(); // image de reprise, dt = 0 : temps de jeu inchangé
    for (let i = 100; i < 200 && !isGameOver(paused.state); i += 1) {
      paused.frames.tick();
      B.push(trace(paused));
    }

    assert.ok(A.length > 50);
    assert.deepEqual(B, A);
    assert.ok(Math.abs(paused.gameTime - plain.gameTime) < 1e-9, `${paused.gameTime} != ${plain.gameTime}`);
    assert.equal(paused.state.status, plain.state.status);
  });
});

// --- Câblage de main.js (cas 17) : analyse textuelle, main.js touche au DOM. ---

const MAIN_SRC = readFileSync(fileURLToPath(new URL('../../src/main.js', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

/** Corps d'une fonction de premier niveau (de `function name(` à `\n}\n`). */
function functionBody(name) {
  const start = MAIN_SRC.indexOf(`\nfunction ${name}(`);
  assert.notEqual(start, -1, `fonction absente de main.js : ${name}`);
  const end = MAIN_SRC.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `fin de fonction introuvable : ${name}`);
  return MAIN_SRC.slice(start, end + 3);
}

/** Corps de l'écouteur `target.addEventListener('type', ...)` jusqu'au `});` qui le ferme. */
function listenerBody(target, type) {
  const re = new RegExp(`${target}\\.addEventListener\\(\\s*['"]${type}['"]`);
  const m = re.exec(MAIN_SRC);
  assert.ok(m, `écouteur ${target} ${type} absent`);
  const end = MAIN_SRC.indexOf('\n  });', m.index);
  assert.notEqual(end, -1);
  return MAIN_SRC.slice(m.index, end);
}

/**
 * Vrai si le corps remet l'état de pause à zéro : directement
 * (`pauseState = createPauseState()`), ou via une fonction de main.js qui le fait.
 */
function resetsPause(body) {
  const direct = /pauseState\s*=\s*createPauseState\(\)/;
  if (direct.test(body)) return true;
  for (const call of body.matchAll(/\b([A-Za-z_$][\w$]*)\(\s*\)\s*;/g)) {
    const name = call[1];
    if (MAIN_SRC.includes(`\nfunction ${name}(`) && direct.test(functionBody(name))) return true;
  }
  return false;
}

describe('câblage de main.js (cas 17)', () => {
  test('main.js importe l’état de pause depuis ./game/pause.js', () => {
    assert.match(MAIN_SRC, /from\s+['"]\.\/game\/pause\.js['"]/);
    assert.match(MAIN_SRC, /let\s+pauseState\s*=\s*createPauseState\(\)/);
  });

  test('l’écouteur blur relâche les touches puis appelle pauseRound(PAUSE_REASON.BLUR)', () => {
    const body = listenerBody('window', 'blur');
    assert.match(body, /clearHeldActions\(\)/);
    assert.match(body, /pauseRound\(\s*PAUSE_REASON\.BLUR\s*\)/);
    assert.doesNotMatch(body, /resumeRound/);
  });

  test('visibilitychange : page cachée -> pauseRound(HIDDEN), page visible testée par isPaused', () => {
    const body = listenerBody('document', 'visibilitychange');
    assert.match(body, /pauseRound\(\s*PAUSE_REASON\.HIDDEN\s*\)/);
    const visible = body.slice(body.indexOf('else'));
    assert.ok(body.includes('else'), 'branche page visible absente');
    assert.match(visible, /isPaused\(\s*pauseState\s*\)/);
    assert.doesNotMatch(body, /resumeRound/, 'la page visible ne doit jamais reprendre la manche');
    assert.doesNotMatch(visible, /gameLoop\.start/);
  });

  test('startRound et exitFps remettent l’état de pause à zéro', () => {
    assert.ok(resetsPause(functionBody('startRound')), 'startRound');
    assert.ok(resetsPause(functionBody('exitFps')), 'exitFps');
  });

  test('pauseRound : garde canPause, stop, suspend, drawFpsFrame, écran affiché, focus Reprendre', () => {
    const body = functionBody('pauseRound');
    assert.match(body, /canPause\(\s*pauseState\s*,\s*gameState\s*\)/);
    const order = ['pauseGame(', 'gameLoop.stop()', '.suspend()', 'clearHeldActions()', 'drawFpsFrame()', '.hidden = false', '.focus()'];
    let pos = -1;
    for (const token of order) {
      const at = body.indexOf(token, pos + 1);
      assert.ok(at > pos, `ordre du plan non respecté à ${token}`);
      pos = at;
    }
    assert.match(body, /pause\.message['"]/);
    assert.match(body, /pause\.messageAuto['"]/);
    assert.match(body, /textContent/);
    assert.doesNotMatch(body, /innerHTML/);
  });

  test('resumeRound : garde isPaused, écran masqué, resume, gameLoop.start, focus', () => {
    const body = functionBody('resumeRound');
    assert.match(body, /isPaused\(\s*pauseState\s*\)/);
    const order = ['resumeGame(', '.hidden = true', 'clearHeldActions()', '.resume()', 'gameLoop.start()', '.focus()'];
    let pos = -1;
    for (const token of order) {
      const at = body.indexOf(token, pos + 1);
      assert.ok(at > pos, `ordre du plan non respecté à ${token}`);
      pos = at;
    }
  });

  test('le bouton Reprendre appelle resumeRound', () => {
    assert.match(MAIN_SRC, /getElementById\(\s*['"]resume-button['"]\s*\)/);
    assert.match(MAIN_SRC, /\.addEventListener\(\s*['"]click['"]\s*,\s*resumeRound\s*\)/);
  });
});
