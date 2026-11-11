// Tests unitaires du calcul pur du son « bong bong » (plan docs/design/dark-son-bong.md
// §3.1 et §6) : constantes, bongGain, selectBongGain, bongSchedule.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TURN_EVENT_TYPE,
  BONG,
  BONG_SYNTH,
  bongGain,
  selectBongGain,
  bongSchedule,
} from '../../src/audio/bong.js';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { findExit } from '../../src/game/exit.js';
import { createMonster, stepMonster } from '../../src/game/monster.js';

const EPS = 1e-9;

function near(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label ?? ''} attendu ${expected}, obtenu ${actual}`,
  );
}

describe('constantes', () => {
  test('TURN_EVENT_TYPE vaut "turn"', () => {
    assert.equal(TURN_EVENT_TYPE, 'turn');
  });

  test('BONG, BONG_SYNTH, hits et chaque coup sont gelés', () => {
    assert.ok(Object.isFrozen(BONG));
    assert.ok(Object.isFrozen(BONG_SYNTH));
    assert.ok(Object.isFrozen(BONG_SYNTH.hits));
    for (const hit of BONG_SYNTH.hits) assert.ok(Object.isFrozen(hit));
  });

  test('valeurs du plan', () => {
    assert.equal(BONG.maxGain, 0.7);
    assert.equal(BONG.nearDistance, 2);
    assert.equal(BONG.silenceDistance, 36);
    assert.equal(BONG.minInterval, 0.9);
    assert.equal(BONG_SYNTH.hits.length, 2);
    assert.deepEqual({ ...BONG_SYNTH.hits[0] }, { offset: 0, frequency: 98, level: 1 });
    assert.deepEqual({ ...BONG_SYNTH.hits[1] }, { offset: 0.3, frequency: 73.42, level: 0.85 });
    assert.equal(BONG_SYNTH.partialRatio, 2.76);
    assert.equal(BONG_SYNTH.partialLevel, 0.3);
    assert.equal(BONG_SYNTH.pitchDrop, 1.08);
    assert.equal(BONG_SYNTH.pitchDropTime, 0.06);
    assert.equal(BONG_SYNTH.attack, 0.008);
    assert.equal(BONG_SYNTH.decay, 0.55);
    assert.equal(BONG_SYNTH.floorGain, 0.0001);
    assert.equal(BONG_SYNTH.release, 0.02);
  });

  test('maxGain dans ]0, 1] et nearDistance < silenceDistance', () => {
    assert.ok(BONG.maxGain > 0 && BONG.maxGain <= 1);
    assert.ok(BONG.nearDistance < BONG.silenceDistance);
  });

  test('durée d\'un bong bong <= minInterval (pas de chevauchement)', () => {
    const last = BONG_SYNTH.hits[BONG_SYNTH.hits.length - 1];
    const duration = last.offset + BONG_SYNTH.attack + BONG_SYNTH.decay + BONG_SYNTH.release;
    assert.ok(duration <= BONG.minInterval, `durée ${duration}`);
  });

  test('coups graves (< 120 Hz), second plus grave que le premier', () => {
    for (const hit of BONG_SYNTH.hits) assert.ok(hit.frequency < 120, `${hit.frequency}`);
    assert.ok(BONG_SYNTH.hits[1].frequency < BONG_SYNTH.hits[0].frequency);
  });

  test('floorGain > 0 (exigé par les rampes exponentielles)', () => {
    assert.ok(BONG_SYNTH.floorGain > 0);
  });
});

describe('bongGain', () => {
  test('0, 1, 2 -> maxGain', () => {
    for (const d of [0, 1, 2]) assert.equal(bongGain(d), BONG.maxGain, `d=${d}`);
  });

  test('36, 37, 1000, Infinity -> 0', () => {
    for (const d of [36, 37, 1000, Infinity]) assert.equal(bongGain(d), 0, `d=${d}`);
  });

  test('valeurs repères 12, 18, 30 (tolérance 1e-3)', () => {
    near(bongGain(12), 0.349, 1e-3, 'd=12');
    near(bongGain(18), 0.196, 1e-3, 'd=18');
    near(bongGain(30), 0.022, 1e-3, 'd=30');
  });

  test('formule quadratique maxGain * (1 - u)^2', () => {
    for (let d = 2; d <= 36; d += 0.5) {
      const u = (d - 2) / 34;
      near(bongGain(d), 0.7 * (1 - u) ** 2, 1e-12, `d=${d}`);
    }
  });

  test('strictement décroissante entre 2 et 36, toujours dans [0, maxGain]', () => {
    let previous = bongGain(2);
    for (let d = 2.25; d <= 36; d += 0.25) {
      const g = bongGain(d);
      assert.ok(g < previous, `d=${d} : ${g} >= ${previous}`);
      assert.ok(g >= 0 && g <= BONG.maxGain);
      previous = g;
    }
    for (let d = 0; d <= 50; d += 1) {
      const g = bongGain(d);
      assert.ok(g >= 0 && g <= BONG.maxGain, `d=${d}`);
    }
  });

  test('continue aux bornes', () => {
    near(bongGain(2 + 1e-9), BONG.maxGain, 1e-6, 'près de nearDistance');
    near(bongGain(36 - 1e-9), 0, 1e-6, 'près de silenceDistance');
  });

  test('surcharge partielle des options', () => {
    assert.equal(bongGain(10, { silenceDistance: 10 }), 0);
    near(bongGain(6, { silenceDistance: 10 }), 0.7 * 0.5 ** 2, EPS, 'silence 10');
    assert.equal(bongGain(0, { maxGain: 1 }), 1);
    assert.equal(bongGain(4, { nearDistance: 4 }), 0.7);
    // clé inconnue ignorée
    assert.equal(bongGain(0, { foo: -5 }), BONG.maxGain);
    // la constante n'est pas modifiée par la surcharge
    assert.equal(BONG.silenceDistance, 36);
  });

  test('TypeError : chaîne, undefined, NaN', () => {
    for (const d of ['12', undefined, NaN, null, {}]) {
      assert.throws(() => bongGain(d), TypeError, `d=${String(d)}`);
    }
  });

  test('RangeError : distance négative', () => {
    assert.throws(() => bongGain(-1), RangeError);
  });

  test('RangeError : options négatives, non finies, maxGain > 1, near >= silence', () => {
    const bad = [
      { maxGain: -0.1 },
      { nearDistance: -1 },
      { silenceDistance: -1 },
      { minInterval: -1 },
      { maxGain: NaN },
      { nearDistance: Infinity },
      { silenceDistance: Infinity },
      { maxGain: 1.5 },
      { nearDistance: 36 },
      { nearDistance: 40 },
      { nearDistance: 10, silenceDistance: 5 },
    ];
    for (const options of bad) {
      assert.throws(() => bongGain(10, options), RangeError, JSON.stringify(options));
    }
  });
});

describe('selectBongGain', () => {
  const turn = (pathDistance) => Object.freeze({ type: 'turn', heading: 'N', pathDistance, x: 1.5, y: 1.5 });

  test('tableau vide -> 0', () => {
    assert.equal(selectBongGain([]), 0);
  });

  test('un turn -> bongGain de sa distance', () => {
    assert.equal(selectBongGain([turn(12)]), bongGain(12));
  });

  test('plusieurs turn -> le maximum (un seul bong par image)', () => {
    assert.equal(selectBongGain([turn(30), turn(5), turn(18)]), bongGain(5));
  });

  test('type inconnu ignoré', () => {
    assert.equal(selectBongGain([{ type: 'roar', pathDistance: 0 }]), 0);
    assert.equal(selectBongGain([{ type: 'roar', pathDistance: 0 }, turn(18)]), bongGain(18));
  });

  test('turn à Infinity -> 0', () => {
    assert.equal(selectBongGain([turn(Infinity)]), 0);
  });

  test('options transmises à bongGain', () => {
    assert.equal(selectBongGain([turn(10)], { silenceDistance: 10 }), 0);
  });

  test('événements gelés réels de stepMonster', () => {
    const grid = toTileGrid(generateMaze({ width: 5, height: 5, seed: 42 }));
    let monster = createMonster(grid, 42, { exit: findExit(grid) });
    const player = Object.freeze({ x: 1.5, y: 1.5, angle: 0 });
    const seen = [];
    for (let i = 0; i < 400 && seen.length < 3; i += 1) {
      const step = stepMonster(monster, player, 1 / 60, grid);
      monster = step.monster;
      if (step.events.length > 0) {
        assert.ok(Object.isFrozen(step.events));
        const expected = Math.max(...step.events.map((e) => bongGain(e.pathDistance)));
        assert.equal(selectBongGain(step.events), expected);
        seen.push(step.events);
      } else {
        assert.equal(selectBongGain(step.events), 0);
      }
    }
    assert.ok(seen.length > 0, 'aucun événement TURN observé');
  });

  test('TypeError : non tableau, élément null ou non objet', () => {
    for (const events of [undefined, null, 'turn', 3, { length: 0 }]) {
      assert.throws(() => selectBongGain(events), TypeError, String(events));
    }
    assert.throws(() => selectBongGain([null]), TypeError);
    assert.throws(() => selectBongGain([42]), TypeError);
  });

  test('erreurs de bongGain propagées', () => {
    assert.throws(() => selectBongGain([{ type: 'turn', pathDistance: 'x' }]), TypeError);
    assert.throws(() => selectBongGain([{ type: 'turn', pathDistance: -1 }]), RangeError);
  });
});

describe('bongSchedule', () => {
  const voices = bongSchedule(10, 0.5);

  test('4 voix dans l\'ordre : coup 1 (fondamentale, partiel), coup 2 (...)', () => {
    assert.equal(voices.length, 4);
    assert.deepEqual(voices.map((v) => v.wave), ['sine', 'triangle', 'sine', 'triangle']);
  });

  test('valeurs exactes pour startTime = 10 et gain = 0.5', () => {
    const expected = [
      { start: 10, frequency: 98, peak: 0.5 },
      { start: 10, frequency: 98 * 2.76, peak: 0.5 * 0.3 },
      { start: 10.3, frequency: 73.42, peak: 0.5 * 0.85 },
      { start: 10.3, frequency: 73.42 * 2.76, peak: 0.5 * 0.85 * 0.3 },
    ];
    expected.forEach((e, i) => {
      const v = voices[i];
      near(v.start, e.start, EPS, `voix ${i} start`);
      near(v.frequency, e.frequency, EPS, `voix ${i} frequency`);
      near(v.startFrequency, e.frequency * 1.08, EPS, `voix ${i} startFrequency`);
      near(v.pitchEnd, e.start + 0.06, EPS, `voix ${i} pitchEnd`);
      near(v.peak, e.peak, EPS, `voix ${i} peak`);
      near(v.attackEnd, e.start + 0.008, EPS, `voix ${i} attackEnd`);
      near(v.decayEnd, e.start + 0.008 + 0.55, EPS, `voix ${i} decayEnd`);
      near(v.stop, e.start + 0.008 + 0.55 + 0.02, EPS, `voix ${i} stop`);
      assert.equal(v.floorGain, BONG_SYNTH.floorGain);
    });
  });

  test('floorGain > 0, peak <= gain, temps croissants dans chaque voix', () => {
    for (const gain of [0.01, 0.5, 1]) {
      for (const v of bongSchedule(3, gain)) {
        assert.ok(v.floorGain > 0);
        assert.ok(v.peak <= gain && v.peak > 0);
        assert.ok(v.start < v.pitchEnd);
        assert.ok(v.start < v.attackEnd);
        assert.ok(v.attackEnd < v.decayEnd);
        assert.ok(v.decayEnd < v.stop);
        assert.ok(v.start >= 3);
      }
    }
  });

  test('gain = 0 -> tableau vide', () => {
    const empty = bongSchedule(10, 0);
    assert.equal(empty.length, 0);
    assert.ok(Array.isArray(empty));
  });

  test('déterminisme et gel', () => {
    assert.deepEqual(bongSchedule(10, 0.5), voices);
    assert.ok(Object.isFrozen(voices));
    for (const v of voices) assert.ok(Object.isFrozen(v));
  });

  test('startTime = 0 accepté, gain = 1 accepté', () => {
    assert.equal(bongSchedule(0, 1).length, 4);
  });

  test('synthèse personnalisée', () => {
    const synth = Object.freeze({
      ...BONG_SYNTH,
      hits: Object.freeze([Object.freeze({ offset: 0, frequency: 50, level: 1 })]),
    });
    const custom = bongSchedule(0, 1, synth);
    assert.equal(custom.length, 2);
    near(custom[0].frequency, 50, EPS);
  });

  test('TypeError : startTime ou gain non fini', () => {
    for (const [t, g] of [[NaN, 0.5], [Infinity, 0.5], ['1', 0.5], [1, NaN], [1, Infinity], [1, undefined]]) {
      assert.throws(() => bongSchedule(t, g), TypeError, `${String(t)}, ${String(g)}`);
    }
  });

  test('RangeError : startTime négatif, gain hors [0, 1]', () => {
    assert.throws(() => bongSchedule(-0.1, 0.5), RangeError);
    assert.throws(() => bongSchedule(1, -0.1), RangeError);
    assert.throws(() => bongSchedule(1, 1.01), RangeError);
  });
});
