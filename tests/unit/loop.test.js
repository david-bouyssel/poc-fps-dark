import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createGameLoop } from '../../src/game/loop.js';

/** Faux requestFrame : empile les callbacks, avancé à la main par le test. */
function fakeFrames() {
  let nextId = 1;
  const pending = new Map();
  const cancelled = [];
  return {
    requestFrame(cb) {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    },
    cancelFrame(id) {
      cancelled.push(id);
      pending.delete(id);
    },
    /** Exécute toutes les images en attente à l'horodatage t (ms). */
    tick(t) {
      const cbs = [...pending.values()];
      pending.clear();
      for (const cb of cbs) cb(t);
    },
    pendingIds: () => [...pending.keys()],
    cancelled,
  };
}

function setup() {
  const frames = fakeFrames();
  const calls = [];
  const loop = createGameLoop({
    update: (dt) => calls.push(['update', dt]),
    render: () => calls.push(['render']),
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
  });
  return { frames, calls, loop };
}

describe('createGameLoop', () => {
  test('non démarrée : aucune image demandée, isRunning false', () => {
    const { frames, loop, calls } = setup();
    assert.equal(loop.isRunning(), false);
    assert.equal(frames.pendingIds().length, 0);
    assert.deepEqual(calls, []);
  });

  test('start -> une image : update(0) puis render', () => {
    const { frames, calls, loop } = setup();
    loop.start();
    assert.equal(loop.isRunning(), true);
    assert.equal(frames.pendingIds().length, 1);
    frames.tick(1000);
    assert.deepEqual(calls, [['update', 0], ['render']]);
    assert.equal(frames.pendingIds().length, 1, 'image suivante demandée');
  });

  test('images à t = 1000 puis 1016 -> update reçoit 0.016', () => {
    const { frames, calls, loop } = setup();
    loop.start();
    frames.tick(1000);
    frames.tick(1016);
    const updates = calls.filter((c) => c[0] === 'update').map((c) => c[1]);
    assert.equal(updates.length, 2);
    assert.equal(updates[0], 0);
    assert.ok(Math.abs(updates[1] - 0.016) < 1e-12, String(updates[1]));
    assert.deepEqual(calls.map((c) => c[0]), ['update', 'render', 'update', 'render']);
  });

  test('dt en secondes sur plusieurs images', () => {
    const { frames, calls, loop } = setup();
    loop.start();
    for (const t of [500, 600, 650, 1650]) frames.tick(t);
    const updates = calls.filter((c) => c[0] === 'update').map((c) => c[1]);
    const expected = [0, 0.1, 0.05, 1];
    updates.forEach((dt, i) => assert.ok(Math.abs(dt - expected[i]) < 1e-12, `${i}: ${dt}`));
  });

  test('start deux fois -> un seul callback en attente', () => {
    const { frames, calls, loop } = setup();
    loop.start();
    loop.start();
    assert.equal(frames.pendingIds().length, 1);
    frames.tick(10);
    loop.start();
    assert.equal(frames.pendingIds().length, 1);
    frames.tick(20);
    assert.equal(calls.filter((c) => c[0] === 'update').length, 2);
  });

  test('stop -> cancelFrame avec l\'id en attente, plus aucun update', () => {
    const { frames, calls, loop } = setup();
    loop.start();
    frames.tick(0);
    const [pendingId] = frames.pendingIds();
    loop.stop();
    assert.equal(loop.isRunning(), false);
    assert.deepEqual(frames.cancelled, [pendingId]);
    const count = calls.length;
    frames.tick(16);
    frames.tick(32);
    assert.equal(calls.length, count);
  });

  test('stop sans start : sans erreur, isRunning false', () => {
    const { loop } = setup();
    assert.doesNotThrow(() => loop.stop());
    assert.equal(loop.isRunning(), false);
  });

  test('redémarrage après stop -> dt repart de 0', () => {
    const { frames, calls, loop } = setup();
    loop.start();
    frames.tick(1000);
    frames.tick(1016);
    loop.stop();
    loop.start();
    assert.equal(loop.isRunning(), true);
    frames.tick(5000);
    frames.tick(5020);
    const updates = calls.filter((c) => c[0] === 'update').map((c) => c[1]);
    assert.equal(updates[2], 0, `dt après redémarrage : ${updates[2]}`);
    assert.ok(Math.abs(updates[3] - 0.02) < 1e-12);
  });

  test('dépendance manquante ou non fonction -> TypeError', () => {
    const ok = {
      update: () => {},
      render: () => {},
      requestFrame: () => 1,
      cancelFrame: () => {},
    };
    assert.throws(() => createGameLoop(), TypeError);
    assert.throws(() => createGameLoop(null), TypeError);
    for (const key of Object.keys(ok)) {
      const missing = { ...ok };
      delete missing[key];
      assert.throws(() => createGameLoop(missing), TypeError, `${key} manquant`);
      assert.throws(() => createGameLoop({ ...ok, [key]: 42 }), TypeError, `${key} non fonction`);
    }
  });
});
