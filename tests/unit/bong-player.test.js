// Tests unitaires du lecteur de bongs (plan docs/design/dark-son-bong.md §3.2 et §6) :
// faux contexte audio injecté, cycle de vie, création paresseuse, délai entre deux
// bongs, suspension, nettoyage des voix. Aucun accès à une vraie API Web Audio.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BONG, bongSchedule } from '../../src/audio/bong.js';
import { BONG_PLAYER_STATE, createBongPlayer } from '../../src/audio/bong-player.js';

const EPS = 1e-9;

function fakeParam() {
  return { calls: [], setValueAtTime(v, t) { this.calls.push(['set', v, t]); },
    linearRampToValueAtTime(v, t) { this.calls.push(['linear', v, t]); },
    exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); } };
}

/** Faux AudioContext : enregistre tous les appels ; currentTime réglable. */
function fakeContext({ resumeImpl, suspendImpl, failOscillatorAt } = {}) {
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: { name: 'destination' },
    oscillators: [],
    gains: [],
    resumeCalls: 0,
    suspendCalls: 0,
    createOscillator() {
      if (failOscillatorAt !== undefined && ctx.oscillators.length === failOscillatorAt) {
        throw new Error('createOscillator failure');
      }
      const osc = {
        type: 'sine',
        frequency: fakeParam(),
        connections: [],
        startCalls: [],
        stopCalls: [],
        disconnected: 0,
        onended: null,
        connect(node) { this.connections.push(node); },
        disconnect() { this.disconnected += 1; },
        start(t) { this.startCalls.push(t); },
        stop(t) { this.stopCalls.push(t); },
      };
      ctx.oscillators.push(osc);
      return osc;
    },
    createGain() {
      const env = {
        gain: fakeParam(),
        connections: [],
        disconnected: 0,
        connect(node) { this.connections.push(node); },
        disconnect() { this.disconnected += 1; },
      };
      ctx.gains.push(env);
      return env;
    },
    resume() {
      ctx.resumeCalls += 1;
      return resumeImpl ? resumeImpl() : Promise.resolve();
    },
    suspend() {
      ctx.suspendCalls += 1;
      return suspendImpl ? suspendImpl() : Promise.resolve();
    },
  };
  return ctx;
}

function setup(contextOptions) {
  const ctx = fakeContext(contextOptions);
  let factoryCalls = 0;
  const player = createBongPlayer({
    createContext: () => {
      factoryCalls += 1;
      return ctx;
    },
  });
  return { ctx, player, factoryCalls: () => factoryCalls };
}

/** Collecte les rejets non gérés pendant un tour de boucle (setImmediate). */
async function unhandledRejectionsDuring(fn) {
  const seen = [];
  const listener = (reason) => seen.push(reason);
  process.on('unhandledRejection', listener);
  try {
    fn();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', listener);
  }
  return seen;
}

describe('construction', () => {
  test('BONG_PLAYER_STATE : valeurs et gel', () => {
    assert.deepEqual({ ...BONG_PLAYER_STATE }, {
      IDLE: 'idle', RUNNING: 'running', SUSPENDED: 'suspended', UNAVAILABLE: 'unavailable',
    });
    assert.ok(Object.isFrozen(BONG_PLAYER_STATE));
  });

  test('sans fabrique ou fabrique non fonction -> TypeError', () => {
    assert.throws(() => createBongPlayer({}), TypeError);
    assert.throws(() => createBongPlayer({ createContext: 'ctx' }), TypeError);
    assert.throws(() => createBongPlayer({ createContext: {} }), TypeError);
  });

  test('options invalides -> RangeError', () => {
    const createContext = () => null;
    assert.throws(() => createBongPlayer({ createContext, options: { minInterval: -1 } }), RangeError);
    assert.throws(() => createBongPlayer({ createContext, options: { maxGain: 2 } }), RangeError);
  });

  test('objet gelé, état IDLE, state en lecture seule', () => {
    const { player } = setup();
    assert.ok(Object.isFrozen(player));
    assert.equal(player.state, BONG_PLAYER_STATE.IDLE);
    try { player.state = 'running'; } catch { /* mode strict : TypeError acceptée */ }
    assert.equal(player.state, BONG_PLAYER_STATE.IDLE);
  });
});

describe('création paresseuse du contexte', () => {
  test('aucun appel à la construction, ni par suspend() ou play() avant resume()', () => {
    const { player, factoryCalls } = setup();
    assert.equal(factoryCalls(), 0);
    player.suspend();
    assert.equal(player.play(0.5), false);
    assert.equal(factoryCalls(), 0);
    assert.equal(player.state, BONG_PLAYER_STATE.IDLE);
  });

  test('resume() crée le contexte une seule fois', () => {
    const { ctx, player, factoryCalls } = setup();
    player.resume();
    assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
    player.suspend();
    player.resume();
    player.resume();
    assert.equal(factoryCalls(), 1);
    assert.ok(ctx.resumeCalls >= 1);
  });
});

describe('contexte indisponible', () => {
  for (const [label, factory] of [
    ['fabrique qui lève', () => { throw new Error('no audio'); }],
    ['fabrique qui renvoie null', () => null],
    ['fabrique qui renvoie undefined', () => undefined],
  ]) {
    test(`${label} -> UNAVAILABLE, play false, fabrique non rappelée`, () => {
      let calls = 0;
      const player = createBongPlayer({ createContext: () => { calls += 1; return factory(); } });
      assert.doesNotThrow(() => player.resume());
      assert.equal(player.state, BONG_PLAYER_STATE.UNAVAILABLE);
      assert.equal(player.play(0.5), false);
      assert.doesNotThrow(() => player.resume());
      assert.doesNotThrow(() => player.suspend());
      assert.equal(calls, 1);
      assert.equal(player.state, BONG_PLAYER_STATE.UNAVAILABLE);
    });
  }
});

describe('promesses rejetées et méthodes absentes', () => {
  test('ctx.resume rejeté : aucun rejet non géré', async () => {
    const { player } = setup({ resumeImpl: () => Promise.reject(new Error('autoplay')) });
    const seen = await unhandledRejectionsDuring(() => player.resume());
    assert.deepEqual(seen, []);
    assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
  });

  test('ctx.suspend rejeté : aucun rejet non géré', async () => {
    const { player } = setup({ suspendImpl: () => Promise.reject(new Error('suspend')) });
    player.resume();
    const seen = await unhandledRejectionsDuring(() => player.suspend());
    assert.deepEqual(seen, []);
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
  });

  test('ctx.resume absent ou qui lève : pas d\'exception', () => {
    const ctx = fakeContext();
    delete ctx.resume;
    const player = createBongPlayer({ createContext: () => ctx });
    assert.doesNotThrow(() => player.resume());
    assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
    assert.equal(player.play(0.5), true);

    const throwing = fakeContext({ resumeImpl: () => { throw new Error('boom'); } });
    const player2 = createBongPlayer({ createContext: () => throwing });
    assert.doesNotThrow(() => player2.resume());
    assert.equal(player2.state, BONG_PLAYER_STATE.RUNNING);
  });
});

describe('play', () => {
  test('en RUNNING : true, 4 oscillateurs et 4 gains, osc -> env -> destination', () => {
    const { ctx, player } = setup();
    player.resume();
    assert.equal(player.play(0.5), true);
    assert.equal(ctx.oscillators.length, 4);
    assert.equal(ctx.gains.length, 4);
    ctx.oscillators.forEach((osc, i) => {
      assert.deepEqual(osc.connections, [ctx.gains[i]]);
      assert.deepEqual(ctx.gains[i].connections, [ctx.destination]);
    });
  });

  test('paramètres conformes à bongSchedule(currentTime, gain)', () => {
    const { ctx, player } = setup();
    player.resume();
    ctx.currentTime = 5;
    assert.equal(player.play(0.5), true);
    const voices = bongSchedule(5, 0.5);
    voices.forEach((v, i) => {
      const osc = ctx.oscillators[i];
      const env = ctx.gains[i];
      assert.equal(osc.type, v.wave);
      assert.deepEqual(osc.frequency.calls, [
        ['set', v.startFrequency, v.start],
        ['exp', v.frequency, v.pitchEnd],
      ]);
      assert.deepEqual(env.gain.calls, [
        ['set', 0, v.start],
        ['linear', v.peak, v.attackEnd],
        ['exp', v.floorGain, v.decayEnd],
      ]);
      assert.deepEqual(osc.startCalls, [v.start]);
      assert.deepEqual(osc.stopCalls, [v.stop]);
    });
  });

  test('gain > 1 borné à 1', () => {
    const { ctx, player } = setup();
    player.resume();
    assert.equal(player.play(5), true);
    const voices = bongSchedule(0, 1);
    voices.forEach((v, i) => {
      const linear = ctx.gains[i].gain.calls.find((c) => c[0] === 'linear');
      assert.ok(Math.abs(linear[1] - v.peak) < EPS, `voix ${i}`);
    });
  });

  test('gain <= 0, NaN, Infinity ou non numérique -> false, rien programmé', () => {
    const { ctx, player } = setup();
    player.resume();
    for (const g of [0, -0.5, NaN, Infinity, -Infinity, '0.5', undefined]) {
      assert.equal(player.play(g), false, String(g));
    }
    assert.equal(ctx.oscillators.length, 0);
  });

  test('délai minInterval : +0.5 s -> false, +0.9 s -> true', () => {
    const { ctx, player } = setup();
    player.resume();
    ctx.currentTime = 2;
    assert.equal(player.play(0.5), true);
    ctx.currentTime = 2.5;
    assert.equal(player.play(0.5), false);
    assert.equal(ctx.oscillators.length, 4);
    ctx.currentTime = 2 + BONG.minInterval;
    assert.equal(player.play(0.5), true);
    assert.equal(ctx.oscillators.length, 8);
  });

  test('minInterval surchargé par options', () => {
    const ctx = fakeContext();
    const player = createBongPlayer({ createContext: () => ctx, options: { minInterval: 2 } });
    player.resume();
    assert.equal(player.play(0.5), true);
    ctx.currentTime = 1;
    assert.equal(player.play(0.5), false);
    ctx.currentTime = 2;
    assert.equal(player.play(0.5), true);
  });
});

describe('suspend', () => {
  test('état SUSPENDED, voix en cours arrêtées, play suivant false', () => {
    const { ctx, player } = setup();
    player.resume();
    player.play(0.5);
    player.suspend();
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
    assert.ok(ctx.suspendCalls >= 1);
    for (const osc of ctx.oscillators) {
      assert.equal(osc.stopCalls.length, 2, 'stop() immédiat attendu en plus du stop programmé');
    }
    ctx.currentTime = 10;
    assert.equal(player.play(0.5), false);
    assert.equal(ctx.oscillators.length, 4);
  });

  test('resume après suspend : play de nouveau possible', () => {
    const { ctx, player } = setup();
    player.resume();
    player.suspend();
    player.resume();
    assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
    assert.equal(player.play(0.5), true);
  });

  test('stop() qui lève pendant suspend : pas d\'exception', () => {
    const { ctx, player } = setup();
    player.resume();
    player.play(0.5);
    for (const osc of ctx.oscillators) {
      osc.stop = () => { throw new Error('InvalidStateError'); };
    }
    assert.doesNotThrow(() => player.suspend());
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
  });
});

describe('fin de voix (onended)', () => {
  test('déconnexion des nœuds, voix plus arrêtée par un suspend ultérieur', () => {
    const { ctx, player } = setup();
    player.resume();
    player.play(0.5);
    for (const osc of ctx.oscillators) {
      assert.equal(typeof osc.onended, 'function');
      osc.onended();
    }
    ctx.oscillators.forEach((osc, i) => {
      assert.ok(osc.disconnected >= 1, `osc ${i} non déconnecté`);
      assert.ok(ctx.gains[i].disconnected >= 1, `env ${i} non déconnecté`);
    });
    player.suspend();
    for (const osc of ctx.oscillators) {
      assert.equal(osc.stopCalls.length, 1, 'voix terminée arrêtée à nouveau');
    }
  });
});

describe('exception pendant la programmation', () => {
  test('createOscillator qui lève : play false, voix déjà créées arrêtées', () => {
    const { ctx, player } = setup({ failOscillatorAt: 2 });
    player.resume();
    let result;
    assert.doesNotThrow(() => { result = player.play(0.5); });
    assert.equal(result, false);
    assert.equal(ctx.oscillators.length, 2);
    for (const osc of ctx.oscillators) {
      // un stop() programmé (osc.stop(stop)) + l'arrêt immédiat après l'exception
      assert.ok(osc.stopCalls.length >= 2, 'voix déjà créée non arrêtée');
    }
  });
});
