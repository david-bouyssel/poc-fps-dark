import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid, isWallTile } from '../../src/maze/grid.js';
import { createRng } from '../../src/maze/random.js';
import { PLAYER_RADIUS, createPlayer } from '../../src/game/player.js';
import { MOVEMENT, stepPlayer, collides } from '../../src/game/movement.js';
import { gridFromRows, room } from './fps-test-grids.js';

const EPS = 1e-9;
const TWO_PI = 2 * Math.PI;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < EPS, `${msg ?? ''} ${a} != ${b}`);

const intent = (o = {}) => Object.freeze({ move: 0, strafe: 0, turn: 0, run: false, ...o });
const player = (x, y, angle) => Object.freeze({ x, y, angle });

// Couloir horizontal : sol en y = 1, x de 1 à 10 ; mur en x = 11.
const CORRIDOR = gridFromRows([
  '############',
  '#..........#',
  '############',
]);
// Grande pièce 12x12 : sol de 1 à 10 sur les deux axes.
const ROOM = room(12, 12);

test('MOVEMENT conforme au plan et gelé', () => {
  assert.deepEqual({ ...MOVEMENT }, { walkSpeed: 2.5, runFactor: 1.8, turnSpeed: 2.6, maxDt: 0.1 });
  assert.ok(Object.isFrozen(MOVEMENT));
});

describe('stepPlayer : intention nulle et pureté', () => {
  test('intention nulle -> position et angle identiques', () => {
    const p = player(5.5, 5.5, 1.234);
    const q = stepPlayer(p, intent(), 0.1, ROOM);
    assert.equal(q.x, 5.5);
    assert.equal(q.y, 5.5);
    close(q.angle, 1.234);
  });

  test('player d\'entrée non modifié, résultat gelé, grille intacte', () => {
    const p = { x: 5.5, y: 5.5, angle: 0.3 };
    const before = Uint8Array.from(ROOM.tiles);
    const q = stepPlayer(p, intent({ move: 1, turn: 1, strafe: 1, run: true }), 0.1, ROOM);
    assert.deepEqual(p, { x: 5.5, y: 5.5, angle: 0.3 });
    assert.ok(Object.isFrozen(q));
    assert.notEqual(q, p);
    assert.deepEqual(ROOM.tiles, before);
  });
});

describe('stepPlayer : vitesses', () => {
  test('couloir droit : avancer dt 0.1 -> 0.25 tuile vers l\'est', () => {
    const q = stepPlayer(player(2.5, 1.5, 0), intent({ move: 1 }), 0.1, CORRIDOR);
    close(q.x, 2.75, 'x');
    close(q.y, 1.5, 'y');
  });

  test('couloir droit : avancer en courant -> 0.45 tuile', () => {
    const q = stepPlayer(player(2.5, 1.5, 0), intent({ move: 1, run: true }), 0.1, CORRIDOR);
    close(q.x, 2.95, 'x');
  });

  test('avancer selon un angle quelconque -> (cos a, sin a) * 0.25', () => {
    const a = 0.7;
    const q = stepPlayer(player(5.5, 5.5, a), intent({ move: 1 }), 0.1, ROOM);
    close(q.x, 5.5 + 0.25 * Math.cos(a), 'x');
    close(q.y, 5.5 + 0.25 * Math.sin(a), 'y');
  });

  test('reculer -> sens opposé', () => {
    const a = 0.7;
    const q = stepPlayer(player(5.5, 5.5, a), intent({ move: -1 }), 0.1, ROOM);
    close(q.x, 5.5 - 0.25 * Math.cos(a), 'x');
    close(q.y, 5.5 - 0.25 * Math.sin(a), 'y');
  });

  test('pas de côté droite -> (-sin a, cos a), gauche -> opposé', () => {
    const a = 0.7;
    const r = stepPlayer(player(5.5, 5.5, a), intent({ strafe: 1 }), 0.1, ROOM);
    close(r.x, 5.5 - 0.25 * Math.sin(a), 'x droite');
    close(r.y, 5.5 + 0.25 * Math.cos(a), 'y droite');
    const l = stepPlayer(player(5.5, 5.5, a), intent({ strafe: -1 }), 0.1, ROOM);
    close(l.x, 5.5 + 0.25 * Math.sin(a), 'x gauche');
    close(l.y, 5.5 - 0.25 * Math.cos(a), 'y gauche');
  });

  test('angle 0 : pas à droite = vers +y (sud)', () => {
    const q = stepPlayer(player(5.5, 5.5, 0), intent({ strafe: 1 }), 0.1, ROOM);
    close(q.x, 5.5);
    close(q.y, 5.75);
  });

  test('diagonale : norme = celle d\'un pas simple (pas de bonus)', () => {
    for (const [move, strafe] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const q = stepPlayer(player(5.5, 5.5, 0.4), intent({ move, strafe }), 0.1, ROOM);
      close(Math.hypot(q.x - 5.5, q.y - 5.5), 0.25, `${move},${strafe}`);
    }
  });

  test('déplacement dans le repère du nouvel angle (rotation appliquée d\'abord)', () => {
    const q = stepPlayer(player(5.5, 5.5, 0), intent({ move: 1, turn: 1 }), 0.1, ROOM);
    close(q.angle, 0.26);
    close(q.x, 5.5 + 0.25 * Math.cos(0.26), 'x');
    close(q.y, 5.5 + 0.25 * Math.sin(0.26), 'y');
  });
});

describe('stepPlayer : rotation', () => {
  test('turn 1, dt 0.1 -> +0.26 rad', () => {
    const q = stepPlayer(player(5.5, 5.5, 1), intent({ turn: 1 }), 0.1, ROOM);
    close(q.angle, 1.26);
    assert.equal(q.x, 5.5);
    assert.equal(q.y, 5.5);
  });

  test('turn -1, dt 0.1 -> -0.26 rad', () => {
    const q = stepPlayer(player(5.5, 5.5, 1), intent({ turn: -1 }), 0.1, ROOM);
    close(q.angle, 0.74);
  });

  test('passage par 2PI normalisé', () => {
    const q = stepPlayer(player(5.5, 5.5, TWO_PI - 0.1), intent({ turn: 1 }), 0.1, ROOM);
    close(q.angle, 0.16);
    const r = stepPlayer(player(5.5, 5.5, 0.1), intent({ turn: -1 }), 0.1, ROOM);
    close(r.angle, TWO_PI - 0.16);
    assert.ok(r.angle >= 0 && r.angle < TWO_PI);
  });
});

describe('stepPlayer : bornage de dt', () => {
  test('dt = 5 équivaut à dt = 0.1', () => {
    const p = player(5.5, 5.5, 0.3);
    const i = intent({ move: 1, turn: 1, run: true });
    const a = stepPlayer(p, i, 5, ROOM);
    const b = stepPlayer(p, i, 0.1, ROOM);
    close(a.x, b.x);
    close(a.y, b.y);
    close(a.angle, b.angle);
  });

  for (const dt of [-1, -0.05, NaN]) {
    test(`dt = ${dt} -> aucun mouvement`, () => {
      const p = player(5.5, 5.5, 0.3);
      const q = stepPlayer(p, intent({ move: 1, strafe: 1, turn: 1, run: true }), dt, ROOM);
      assert.equal(q.x, 5.5);
      assert.equal(q.y, 5.5);
      close(q.angle, 0.3);
    });
  }
});

describe('collides', () => {
  test('rayon par défaut = PLAYER_RADIUS', () => {
    // centre à 0.15 du mur ouest (x = 1) : chevauche avec 0.2, pas avec 0.1
    assert.equal(collides(CORRIDOR, 1.15, 1.5), true);
    assert.equal(collides(CORRIDOR, 1.15, 1.5, 0.1), false);
    assert.equal(collides(CORRIDOR, 1.15, 1.5, PLAYER_RADIUS), true);
  });

  test('centre de couloir -> false ; dans un mur -> true', () => {
    assert.equal(collides(CORRIDOR, 5.5, 1.5), false);
    assert.equal(collides(CORRIDOR, 5.5, 0.5), true);
    assert.equal(collides(CORRIDOR, 11.5, 1.5), true);
  });

  test('chevauchement vertical d\'un mur -> true', () => {
    assert.equal(collides(CORRIDOR, 5.5, 1.1), true);
    assert.equal(collides(CORRIDOR, 5.5, 1.9), true);
    assert.equal(collides(CORRIDOR, 5.5, 1.3), false);
  });

  test('hors grille -> true', () => {
    assert.equal(collides(CORRIDOR, -3, -3), true);
    assert.equal(collides(CORRIDOR, 100, 1.5), true);
  });
});

describe('stepPlayer : collisions', () => {
  test('mur en face : 200 pas de 0.1 s -> arrêt avant le mur, jamais en collision', () => {
    let p = player(2.5, 1.5, 0);
    for (let i = 0; i < 200; i++) {
      p = stepPlayer(p, intent({ move: 1, run: i % 2 === 0 }), 0.1, CORRIDOR);
      assert.equal(collides(CORRIDOR, p.x, p.y), false, `pas ${i}`);
    }
    // mur en tuile x = 11
    assert.ok(11 - p.x >= PLAYER_RADIUS - EPS, `distance au mur ${11 - p.x}`);
    assert.ok(p.x > 11 - PLAYER_RADIUS - 0.45, `trop loin du mur : ${p.x}`);
    close(p.y, 1.5);
  });

  test('glissement : diagonale contre le mur nord -> x progresse, y bloqué', () => {
    // angle -PI/4 : vers +x et -y ; mur nord en tuile y = 0
    let p = player(2.5, 1.5, normalizeAngleLocal(-Math.PI / 4));
    const ys = [];
    for (let i = 0; i < 20; i++) {
      p = stepPlayer(p, intent({ move: 1 }), 0.1, ROOM);
      assert.equal(collides(ROOM, p.x, p.y), false, `pas ${i}`);
      ys.push(p.y);
    }
    assert.ok(p.y >= 1 + PLAYER_RADIUS - EPS, `y traverse : ${p.y}`);
    // y bloqué : les derniers pas ne bougent plus en y
    assert.equal(ys.at(-1), ys.at(-5));
    // x progresse de 0.25 * cos(PI/4) par pas sur les 20 pas (pièce assez large)
    close(p.x, 2.5 + 20 * 0.25 * Math.SQRT1_2, 'x');
  });

  test('glissement dans un angle : bloqué sur les deux axes, sans traversée', () => {
    let p = player(5.5, 5.5, normalizeAngleLocal(-3 * Math.PI / 4)); // vers nord-ouest
    for (let i = 0; i < 100; i++) {
      p = stepPlayer(p, intent({ move: 1, run: true }), 0.1, ROOM);
      assert.equal(collides(ROOM, p.x, p.y), false);
    }
    assert.ok(p.x >= 1.2 - EPS && p.x < 1.7, `x ${p.x}`);
    assert.ok(p.y >= 1.2 - EPS && p.y < 1.7, `y ${p.y}`);
  });
});

describe('stepPlayer : propriété non-tunnel', () => {
  test('16x16 graine fixe : 10 000 pas pseudo-aléatoires, jamais en collision ni sur un mur', () => {
    const grid = toTileGrid(generateMaze({ width: 16, height: 16, seed: 31337 }));
    const rng = createRng(4242);
    const pick = () => Math.floor(rng() * 3) - 1; // -1, 0 ou 1
    let p = createPlayer(grid);
    let i = intent();
    let travelled = 0;
    for (let step = 0; step < 10000; step++) {
      if (step % 15 === 0) {
        i = intent({ move: pick(), strafe: pick(), turn: pick(), run: rng() < 0.5 });
      }
      const dt = rng() * 0.1;
      const q = stepPlayer(p, i, dt, grid);
      travelled += Math.hypot(q.x - p.x, q.y - p.y);
      p = q;
      assert.equal(collides(grid, p.x, p.y), false, `pas ${step} : (${p.x}, ${p.y})`);
      assert.equal(isWallTile(grid, Math.floor(p.x), Math.floor(p.y)), false, `pas ${step} : tuile mur`);
      assert.ok(p.angle >= 0 && p.angle < TWO_PI);
    }
    assert.ok(travelled > 10, `le joueur doit réellement se déplacer (${travelled})`);
  });
});

describe('stepPlayer : options', () => {
  test('walkSpeed surchargé', () => {
    const q = stepPlayer(player(2.5, 1.5, 0), intent({ move: 1 }), 0.1, CORRIDOR, { walkSpeed: 1 });
    close(q.x, 2.6);
  });

  test('runFactor surchargé, autres valeurs par défaut', () => {
    const q = stepPlayer(player(2.5, 1.5, 0), intent({ move: 1, run: true }), 0.1, CORRIDOR, { runFactor: 2 });
    close(q.x, 3.0);
  });

  test('turnSpeed et maxDt surchargés', () => {
    const q = stepPlayer(player(5.5, 5.5, 0), intent({ turn: 1 }), 1, ROOM, { turnSpeed: 1, maxDt: 0.5 });
    close(q.angle, 0.5);
  });

  test('MOVEMENT non modifié par la surcharge', () => {
    stepPlayer(player(2.5, 1.5, 0), intent({ move: 1 }), 0.1, CORRIDOR, { walkSpeed: 9 });
    assert.equal(MOVEMENT.walkSpeed, 2.5);
  });
});

function normalizeAngleLocal(a) {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}
