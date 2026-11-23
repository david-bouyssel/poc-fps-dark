// Tests unitaires du lecteur de bongs (plan docs/design/dark-son-bong.md §3.2 et §6) :
// faux contexte audio injecté, cycle de vie, création paresseuse, délai entre deux
// bongs, suspension, nettoyage des voix. Aucun accès à une vraie API Web Audio.
// Extension « cris du monstre » (plan docs/design/monster-cries.md §3.3 et §6) : playCry,
// playSlurp, état FINALE, filtres (createBiquadFilter), pannes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BONG, bongSchedule } from '../../src/audio/bong.js';
import { BONG_PLAYER_STATE, createBongPlayer } from '../../src/audio/bong-player.js';
import {
  CRY, crySchedule, slurpSchedule, SNIFF, sniffSchedule,
} from '../../src/audio/monster-cries.js';

const EPS = 1e-9;

function fakeParam() {
  return { calls: [], setValueAtTime(v, t) { this.calls.push(['set', v, t]); },
    linearRampToValueAtTime(v, t) { this.calls.push(['linear', v, t]); },
    exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); } };
}

/** Faux AudioContext : enregistre tous les appels ; currentTime réglable. */
function fakeContext({ resumeImpl, suspendImpl, failOscillatorAt, failFilterAt } = {}) {
  const ctx = {
    currentTime: 0,
    state: 'running',
    destination: { name: 'destination' },
    oscillators: [],
    gains: [],
    filters: [],
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
    createBiquadFilter() {
      if (failFilterAt !== undefined && ctx.filters.length === failFilterAt) {
        throw new Error('createBiquadFilter failure');
      }
      const filter = {
        type: 'lowpass',
        frequency: fakeParam(),
        Q: fakeParam(),
        connections: [],
        disconnected: 0,
        connect(node) { this.connections.push(node); },
        disconnect() { this.disconnected += 1; },
      };
      ctx.filters.push(filter);
      return filter;
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
      FINALE: 'finale',
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

// ---------------------------------------------------------------------------
// Cris du monstre (plan docs/design/monster-cries.md §3.3 et §6)

const RAMP = { set: 'set', linear: 'linear', exponential: 'exp' };

/** Appels attendus sur un AudioParam pour une liste de points d'automation. */
function expectedCalls(points) {
  return points.map((p) => [RAMP[p.ramp], p.value, p.time]);
}

/** Nœud de gain (enveloppe) d'un oscillateur, à travers son filtre éventuel. */
function envOf(ctx, osc) {
  const first = osc.connections[0];
  return ctx.filters.includes(first) ? first.connections[0] : first;
}

/** Vérifie qu'un groupe d'oscillateurs suit exactement la partition donnée. */
function assertMatchesSchedule(ctx, oscillators, voices) {
  assert.equal(oscillators.length, voices.length);
  voices.forEach((v, i) => {
    const osc = oscillators[i];
    assert.equal(osc.type, v.wave, `voix ${i} : forme d'onde`);
    assert.deepEqual(osc.frequency.calls, expectedCalls(v.frequency), `voix ${i} : hauteur`);
    const env = envOf(ctx, osc);
    assert.ok(ctx.gains.includes(env), `voix ${i} : enveloppe absente`);
    assert.deepEqual(env.gain.calls, expectedCalls(v.gain), `voix ${i} : enveloppe`);
    assert.deepEqual(env.connections, [ctx.destination], `voix ${i} : env -> destination`);
    assert.equal(osc.startCalls[0], v.start);
    assert.equal(osc.stopCalls[0], v.stop);
    if (v.filter) {
      const filter = osc.connections[0];
      assert.ok(ctx.filters.includes(filter), `voix ${i} : filtre attendu`);
      assert.equal(filter.type, v.filter.type);
      assert.deepEqual(filter.Q.calls, [['set', v.filter.q, v.start]]);
      assert.deepEqual(filter.frequency.calls, expectedCalls(v.filter.frequency));
      assert.deepEqual(filter.connections, [env]);
    } else {
      assert.deepEqual(osc.connections, [env], `voix ${i} : osc -> env sans filtre`);
    }
  });
}

/** Lecteur dans l'état FINALE (sluuurp programmé), avec les oscillateurs du sluuurp. */
function inFinale(contextOptions) {
  const { ctx, player } = setup(contextOptions);
  player.resume();
  ctx.currentTime = 4;
  assert.equal(player.playSlurp(), true);
  const slurpOscs = ctx.oscillators.slice();
  return { ctx, player, slurpOscs };
}

describe('playCry', () => {
  test('en RUNNING : true, 3 oscillateurs, paramètres conformes à crySchedule', () => {
    const { ctx, player } = setup();
    player.resume();
    ctx.currentTime = 7;
    assert.equal(player.playCry(0.4), true);
    assert.equal(ctx.oscillators.length, 3);
    assert.equal(ctx.filters.length, 0, 'le cri n\'a pas de filtre');
    assertMatchesSchedule(ctx, ctx.oscillators, crySchedule(7, 0.4));
  });

  test('gain > 1 borné à 1', () => {
    const { ctx, player } = setup();
    player.resume();
    assert.equal(player.playCry(3), true);
    assertMatchesSchedule(ctx, ctx.oscillators, crySchedule(0, 1));
  });

  test('gain <= 0, NaN, Infinity ou non numérique -> false, rien programmé', () => {
    const { ctx, player } = setup();
    player.resume();
    for (const g of [0, -1, NaN, Infinity, -Infinity, '0.5', undefined, null]) {
      assert.equal(player.playCry(g), false, String(g));
    }
    assert.equal(ctx.oscillators.length, 0);
  });

  test('délai CRY.minInterval : +3 s -> false, +6 s -> true', () => {
    const { ctx, player } = setup();
    player.resume();
    ctx.currentTime = 1;
    assert.equal(player.playCry(0.5), true);
    ctx.currentTime = 4;
    assert.equal(player.playCry(0.5), false);
    assert.equal(ctx.oscillators.length, 3);
    ctx.currentTime = 1 + CRY.minInterval;
    assert.equal(player.playCry(0.5), true);
    assert.equal(ctx.oscillators.length, 6);
  });

  test('un cri n\'empêche pas un bong immédiat, et inversement', () => {
    const a = setup();
    a.player.resume();
    assert.equal(a.player.playCry(0.5), true);
    assert.equal(a.player.play(0.5), true);
    assert.equal(a.ctx.oscillators.length, 3 + 4);

    const b = setup();
    b.player.resume();
    assert.equal(b.player.play(0.5), true);
    assert.equal(b.player.playCry(0.5), true);
    assert.equal(b.ctx.oscillators.length, 4 + 3);
  });

  test('IDLE, SUSPENDED, UNAVAILABLE -> false', () => {
    const idle = setup();
    assert.equal(idle.player.playCry(0.5), false);
    assert.equal(idle.factoryCalls(), 0);

    const suspended = setup();
    suspended.player.resume();
    suspended.player.suspend();
    assert.equal(suspended.player.playCry(0.5), false);
    assert.equal(suspended.ctx.oscillators.length, 0);

    const unavailable = createBongPlayer({ createContext: () => null });
    unavailable.resume();
    assert.equal(unavailable.state, BONG_PLAYER_STATE.UNAVAILABLE);
    assert.equal(unavailable.playCry(0.5), false);
  });

  test('suspend() arrête les voix du cri', () => {
    const { ctx, player } = setup();
    player.resume();
    player.playCry(0.5);
    player.suspend();
    for (const osc of ctx.oscillators) assert.equal(osc.stopCalls.length, 2);
  });
});

describe('playSlurp', () => {
  test('arrête les voix en cours (bong + cri), programme 3 voix dont 2 filtrées', () => {
    const { ctx, player } = setup();
    player.resume();
    assert.equal(player.play(0.5), true);
    assert.equal(player.playCry(0.5), true);
    const before = ctx.oscillators.slice();
    ctx.currentTime = 2.5;
    assert.equal(player.playSlurp(), true);
    for (const osc of before) {
      assert.equal(osc.stopCalls.length, 2, 'voix antérieure non arrêtée');
    }
    const slurpOscs = ctx.oscillators.slice(before.length);
    assert.equal(slurpOscs.length, 3);
    assert.equal(ctx.filters.length, 2);
    assertMatchesSchedule(ctx, slurpOscs, slurpSchedule(2.5));
    // voix 1 et 2 : osc -> filter -> env -> destination
    for (const osc of slurpOscs.slice(0, 2)) {
      assert.ok(ctx.filters.includes(osc.connections[0]));
    }
    assert.ok(!ctx.filters.includes(slurpOscs[2].connections[0]), 'le « p » n\'est pas filtré');
  });

  test('état FINALE ; play et playCry -> false ; second playSlurp -> false', () => {
    const { ctx, player } = inFinale();
    assert.equal(player.state, BONG_PLAYER_STATE.FINALE);
    ctx.currentTime = 100;
    assert.equal(player.play(0.5), false);
    assert.equal(player.playCry(0.5), false);
    assert.equal(player.playSlurp(), false);
    assert.equal(ctx.oscillators.length, 3);
    assert.equal(ctx.suspendCalls, 0, 'aucune suspension immédiate');
  });

  test('IDLE, SUSPENDED, UNAVAILABLE -> false, état inchangé', () => {
    const idle = setup();
    assert.equal(idle.player.playSlurp(), false);
    assert.equal(idle.player.state, BONG_PLAYER_STATE.IDLE);
    assert.equal(idle.factoryCalls(), 0);

    const suspended = setup();
    suspended.player.resume();
    suspended.player.suspend();
    assert.equal(suspended.player.playSlurp(), false);
    assert.equal(suspended.player.state, BONG_PLAYER_STATE.SUSPENDED);
    assert.equal(suspended.ctx.oscillators.length, 0);

    const unavailable = createBongPlayer({ createContext: () => null });
    unavailable.resume();
    assert.equal(unavailable.playSlurp(), false);
    assert.equal(unavailable.state, BONG_PLAYER_STATE.UNAVAILABLE);
  });
});

describe('fin naturelle du sluuurp', () => {
  test('onended de toutes les voix -> ctx.suspend() une fois, SUSPENDED', () => {
    const { ctx, player, slurpOscs } = inFinale();
    for (const osc of slurpOscs) osc.onended();
    assert.equal(ctx.suspendCalls, 1);
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
    slurpOscs.forEach((osc, i) => assert.ok(osc.disconnected >= 1, `osc ${i} non déconnecté`));
    for (const filter of ctx.filters) assert.ok(filter.disconnected >= 1, 'filtre non déconnecté');
    // un onended tardif ne relance rien
    slurpOscs[0].onended();
    assert.equal(ctx.suspendCalls, 1);
  });

  test('onended d\'une seule voix -> toujours FINALE', () => {
    const { ctx, player, slurpOscs } = inFinale();
    slurpOscs[0].onended();
    assert.equal(player.state, BONG_PLAYER_STATE.FINALE);
    assert.equal(ctx.suspendCalls, 0);
  });

  test('ctx.suspend rejeté à la fin naturelle : aucun rejet non géré', async () => {
    const { player, slurpOscs } = inFinale({ suspendImpl: () => Promise.reject(new Error('x')) });
    const seen = await unhandledRejectionsDuring(() => {
      for (const osc of slurpOscs) osc.onended();
    });
    assert.deepEqual(seen, []);
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
  });
});

describe('sortie de FINALE', () => {
  test('suspend() en FINALE -> voix arrêtées, SUSPENDED', () => {
    const { ctx, player, slurpOscs } = inFinale();
    player.suspend();
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
    assert.ok(ctx.suspendCalls >= 1);
    for (const osc of slurpOscs) assert.equal(osc.stopCalls.length, 2, 'sluuurp non coupé');
  });

  test('resume() en FINALE -> voix arrêtées, RUNNING, bong de nouveau possible', () => {
    const { ctx, player, slurpOscs } = inFinale();
    player.resume();
    assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
    for (const osc of slurpOscs) assert.equal(osc.stopCalls.length, 2, 'sluuurp non coupé');
    ctx.currentTime += 10;
    assert.equal(player.play(0.5), true);
    // la fin tardive des voix coupées ne suspend pas la nouvelle manche
    for (const osc of slurpOscs) osc.onended();
    assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
  });
});

describe('pannes pendant la programmation des cris', () => {
  test('createBiquadFilter qui lève au 2e : playSlurp false, voix créées arrêtées, SUSPENDED', () => {
    const { ctx, player } = setup({ failFilterAt: 1 });
    player.resume();
    let result;
    assert.doesNotThrow(() => { result = player.playSlurp(); });
    assert.equal(result, false);
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
    assert.ok(ctx.oscillators.length >= 1);
    for (const osc of ctx.oscillators) {
      assert.ok(osc.stopCalls.length >= 1, 'voix créée non arrêtée');
    }
  });

  test('createBiquadFilter qui lève dès le premier : playSlurp false, SUSPENDED', () => {
    const { player } = setup({ failFilterAt: 0 });
    player.resume();
    assert.equal(player.playSlurp(), false);
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
  });

  test('createOscillator qui lève au 2e : playCry false, voix créées arrêtées, RUNNING', () => {
    const { ctx, player } = setup({ failOscillatorAt: 1 });
    player.resume();
    let result;
    assert.doesNotThrow(() => { result = player.playCry(0.5); });
    assert.equal(result, false);
    assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
    assert.equal(ctx.oscillators.length, 1);
    assert.ok(ctx.oscillators[0].stopCalls.length >= 2, 'voix déjà créée non arrêtée');
  });

  test('createOscillator qui lève au 3e : playSlurp false, voix créées arrêtées, SUSPENDED', () => {
    const { ctx, player } = setup({ failOscillatorAt: 2 });
    player.resume();
    let result;
    assert.doesNotThrow(() => { result = player.playSlurp(); });
    assert.equal(result, false);
    assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
    assert.equal(ctx.oscillators.length, 2);
    for (const osc of ctx.oscillators) assert.ok(osc.stopCalls.length >= 2, 'voix non arrêtée');
  });
});

describe('playSniff', () => {
  test('en RUNNING : true, 12 oscillateurs en passe-bande, conformes à sniffSchedule', () => {
    const { ctx, player } = setup();
    player.resume();
    ctx.currentTime = 5;
    assert.equal(player.playSniff(0.3), true);
    assert.equal(ctx.oscillators.length, 12);
    assert.equal(ctx.filters.length, 12);
    assert.ok(ctx.filters.every((f) => f.type === 'bandpass'));
    assertMatchesSchedule(ctx, ctx.oscillators, sniffSchedule(5, 0.3));
  });

  test('gain invalide -> false ; gain > 1 borné à 1', () => {
    const { ctx, player } = setup();
    player.resume();
    for (const g of [0, -1, NaN, Infinity, '0.5', undefined, null]) {
      assert.equal(player.playSniff(g), false, String(g));
    }
    assert.equal(ctx.oscillators.length, 0);
    assert.equal(player.playSniff(3), true);
    assertMatchesSchedule(ctx, ctx.oscillators, sniffSchedule(0, 1));
  });

  test('délai SNIFF.minInterval, indépendant du cri et du bong', () => {
    const { ctx, player } = setup();
    player.resume();
    ctx.currentTime = 1;
    assert.equal(player.playSniff(0.3), true);
    assert.equal(player.playCry(0.2), true);
    assert.equal(player.play(0.5), true);
    ctx.currentTime = 1 + SNIFF.minInterval / 2;
    assert.equal(player.playSniff(0.3), false);
    ctx.currentTime = 1 + SNIFF.minInterval;
    assert.equal(player.playSniff(0.3), true);
  });

  test('hors RUNNING (IDLE, SUSPENDED, FINALE) -> false', () => {
    const idle = setup();
    assert.equal(idle.player.playSniff(0.3), false);
    const suspended = setup();
    suspended.player.resume();
    suspended.player.suspend();
    assert.equal(suspended.player.playSniff(0.3), false);
    const { player } = inFinale();
    assert.equal(player.playSniff(0.3), false);
  });

  test('filtre qui lève : false, aucune exception, voix créées arrêtées', () => {
    const { ctx, player } = setup({ failFilterAt: 2 });
    player.resume();
    let result;
    assert.doesNotThrow(() => { result = player.playSniff(0.3); });
    assert.equal(result, false);
    assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
    for (const osc of ctx.oscillators) assert.ok(osc.stopCalls.length >= 1 || osc.disconnected > 0);
  });

  test('suspend coupe un reniflement en cours', () => {
    const { ctx, player } = setup();
    player.resume();
    player.playSniff(0.3);
    player.suspend();
    for (const osc of ctx.oscillators) assert.equal(osc.stopCalls.length, 2);
  });
});
