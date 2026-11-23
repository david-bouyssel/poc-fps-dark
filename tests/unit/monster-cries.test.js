// Tests unitaires des cris du monstre (plan docs/design/monster-cries.md §3.2 et §6) :
// constantes, cryGain, selectCryGain, crySchedule (cri strident) et slurpSchedule
// (« sluuurp »). Module pur : aucun accès à une API Web Audio.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { findExit } from '../../src/game/exit.js';
import { MONSTER_EVENT, createMonster, stepMonster } from '../../src/game/monster.js';
import {
  SPOT_EVENT_TYPE,
  HUNT_EVENT_TYPE,
  SNIFF,
  SNIFF_SYNTH,
  sniffGain,
  selectSniffGain,
  sniffSchedule,
  CRY,
  SLURP,
  CRY_SYNTH,
  SLURP_SYNTH,
  cryGain,
  selectCryGain,
  crySchedule,
  slurpSchedule,
} from '../../src/audio/monster-cries.js';

const EPS = 1e-9;

/** Vérifie récursivement que tous les objets et tableaux sont gelés. */
function assertDeepFrozen(value, path = 'racine') {
  if (value === null || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value), `${path} non gelé`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${path}.${key}`);
}

/** Invariants d'une SynthVoice (§3.2). */
function assertVoiceInvariants(voice, gain, label) {
  assert.ok(['sine', 'square', 'sawtooth', 'triangle'].includes(voice.wave), `${label} : wave`);
  assert.ok(voice.stop > voice.start, `${label} : stop > start`);
  const lists = [['frequency', voice.frequency], ['gain', voice.gain]];
  if (voice.filter) lists.push(['filter.frequency', voice.filter.frequency]);
  for (const [name, points] of lists) {
    assert.ok(points.length >= 2, `${label} ${name} : au moins 2 points`);
    assert.equal(points[0].ramp, 'set', `${label} ${name} : premier point en set`);
    assert.ok(Math.abs(points[0].time - voice.start) < EPS, `${label} ${name} : premier point à start`);
    for (let i = 0; i < points.length; i += 1) {
      const p = points[i];
      assert.ok(['set', 'linear', 'exponential'].includes(p.ramp), `${label} ${name}[${i}] ramp`);
      assert.ok(Number.isFinite(p.value), `${label} ${name}[${i}] valeur finie`);
      assert.ok(p.time >= voice.start - EPS && p.time <= voice.stop + EPS, `${label} ${name}[${i}] dans [start, stop]`);
      if (i > 0) assert.ok(p.time >= points[i - 1].time - EPS, `${label} ${name}[${i}] temps croissants`);
      if (p.ramp === 'exponential') assert.ok(p.value > 0, `${label} ${name}[${i}] exponentiel > 0`);
    }
  }
  for (const p of voice.gain) {
    assert.ok(p.value >= 0 && p.value <= 1, `${label} gain dans [0, 1]`);
    assert.ok(p.value <= gain + EPS, `${label} peak <= gain`);
  }
}

// ---------------------------------------------------------------------------

describe('constantes', () => {
  test('objets gelés (et sous-objets)', () => {
    for (const [name, obj] of Object.entries({ CRY, SLURP, CRY_SYNTH, SLURP_SYNTH })) {
      assertDeepFrozen(obj, name);
    }
  });

  test('valeurs du contrat', () => {
    assert.deepEqual({ ...CRY }, { maxGain: 0.2, nearDistance: 2, silenceDistance: 36, minInterval: 6 });
    assert.equal(SLURP.gain, 0.6);
    assert.equal(CRY_SYNTH.baseFrequency, 1300);
    assert.equal(CRY_SYNTH.vibratoRate, 22);
    assert.equal(CRY_SYNTH.vibratoDepth, 0.04);
  });

  test('SPOT_EVENT_TYPE === MONSTER_EVENT.SPOT', () => {
    assert.equal(SPOT_EVENT_TYPE, 'spot');
    assert.equal(SPOT_EVENT_TYPE, MONSTER_EVENT.SPOT);
  });
});

// ---------------------------------------------------------------------------

describe('cri aigu, sluuurp grave', () => {
  const cry = crySchedule(0, 1);
  const slurp = slurpSchedule(0, 1);

  test('cri : points de hauteur jusqu\'à hold (0.35 s) tous >= 1000 Hz', () => {
    let checked = 0;
    for (const voice of cry) {
      for (const p of voice.frequency) {
        if (p.time <= voice.start + 0.35 + EPS) {
          checked += 1;
          assert.ok(p.value >= 1000, `${voice.wave} t = ${p.time} : ${p.value} Hz`);
        }
      }
    }
    assert.ok(checked >= 6, `trop peu de points vérifiés (${checked})`);
  });

  test('cri : toutes les fréquences, chute finale comprise, >= 500 Hz', () => {
    for (const voice of cry) {
      for (const p of voice.frequency) {
        assert.ok(p.value >= 500, `${voice.wave} t = ${p.time} : ${p.value} Hz`);
      }
    }
  });

  test('sluuurp : dernière fréquence de la voix 1 <= 100 Hz', () => {
    const f = slurp[0].frequency;
    assert.ok(f[f.length - 1].value <= 100, `${f[f.length - 1].value} Hz`);
    assert.ok(f[0].value > f[f.length - 1].value, 'la hauteur descend');
  });

  test('sluuurp : coupure du filtre décroissante', () => {
    for (const voice of slurp.slice(0, 2)) {
      const f = voice.filter.frequency;
      for (let i = 1; i < f.length; i += 1) {
        assert.ok(f[i].value <= f[i - 1].value, `coupure ${f[i - 1].value} -> ${f[i].value}`);
      }
      assert.ok(f[f.length - 1].value < f[0].value);
    }
  });

  test('durées : cri <= CRY.minInterval ; sluuurp entre 1 et 1.5 s', () => {
    const cryDuration = Math.max(...cry.map((v) => v.stop)) - Math.min(...cry.map((v) => v.start));
    assert.ok(cryDuration <= CRY.minInterval, `cri ${cryDuration} s`);
    assert.ok(Math.abs(cryDuration - 0.72) < 1e-6, `cri ${cryDuration} s (0.72 attendu)`);
    const slurpDuration = Math.max(...slurp.map((v) => v.stop)) - Math.min(...slurp.map((v) => v.start));
    assert.ok(slurpDuration >= 1 && slurpDuration <= 1.5, `sluuurp ${slurpDuration} s`);
  });
});

// ---------------------------------------------------------------------------

describe('cryGain', () => {
  test('repères : 0 et 2 -> 0.2 ; 12 -> ~0.0997 ; 36 et Infinity -> 0', () => {
    assert.equal(cryGain(0), 0.2);
    assert.equal(cryGain(2), 0.2);
    assert.ok(Math.abs(cryGain(12) - 0.0997) < 1e-3, `${cryGain(12)}`);
    assert.equal(cryGain(36), 0);
    assert.equal(cryGain(50), 0);
    assert.equal(cryGain(Infinity), 0);
  });

  test('décroissant et dans [0, CRY.maxGain]', () => {
    let previous = Infinity;
    for (let d = 0; d <= 40; d += 0.5) {
      const g = cryGain(d);
      assert.ok(g >= 0 && g <= CRY.maxGain, `d = ${d}`);
      assert.ok(g <= previous + EPS, `d = ${d}`);
      previous = g;
    }
  });

  test('erreurs : non numérique ou NaN -> TypeError ; négatif -> RangeError', () => {
    for (const bad of [NaN, '3', undefined, null, {}]) {
      assert.throws(() => cryGain(bad), TypeError, String(bad));
    }
    assert.throws(() => cryGain(-1), RangeError);
    assert.throws(() => cryGain(-Infinity), RangeError);
  });
});

describe('selectCryGain', () => {
  const spot = (pathDistance) => ({ type: 'spot', pathDistance, x: 1.5, y: 1.5 });
  const turn = (pathDistance) => ({ type: 'turn', heading: 'N', pathDistance, x: 1.5, y: 1.5 });

  test('vide -> 0 ; un spot -> son gain ; plusieurs -> maximum ; turn ignoré', () => {
    assert.equal(selectCryGain([]), 0);
    assert.equal(selectCryGain([spot(12)]), cryGain(12));
    assert.equal(selectCryGain([spot(20), spot(5), spot(12)]), cryGain(5));
    assert.equal(selectCryGain([turn(0)]), 0);
    assert.equal(selectCryGain([turn(0), spot(12), { type: 'other', pathDistance: 0 }]), cryGain(12));
  });

  test('événements réels de stepMonster : gain > 0 au début de la traque', () => {
    const grid = toTileGrid(generateMaze({ width: 5, height: 5, seed: 7 }));
    let m = createMonster(grid, 7, { exit: findExit(grid) });
    const player = { x: 1.5, y: 1.5 };
    let found = null;
    for (let i = 0; i < 3000 && !found; i += 1) {
      const r = stepMonster(m, player, 1 / 60, grid);
      m = r.monster;
      const g = selectCryGain(r.events);
      const spots = r.events.filter((e) => e.type === SPOT_EVENT_TYPE);
      if (spots.length > 0) found = { g, spots };
      else assert.equal(g, 0);
    }
    assert.ok(found, 'aucun SPOT observé');
    assert.equal(found.g, cryGain(found.spots[0].pathDistance));
    assert.ok(found.g > 0);
  });

  test('erreurs : non tableau, élément non objet', () => {
    for (const bad of [null, undefined, 'spot', {}, 3]) {
      assert.throws(() => selectCryGain(bad), TypeError, String(bad));
    }
    assert.throws(() => selectCryGain([null]), TypeError);
    assert.throws(() => selectCryGain([spot(3), 'spot']), TypeError);
    assert.throws(() => selectCryGain([spot(NaN)]), TypeError);
    assert.throws(() => selectCryGain([spot(-1)]), RangeError);
  });
});

// ---------------------------------------------------------------------------

describe('crySchedule', () => {
  test('3 voix, dans l\'ordre des composantes, sans filtre', () => {
    const voices = crySchedule(2, 0.5);
    assert.equal(voices.length, 3);
    assert.deepEqual(voices.map((v) => v.wave), ['sawtooth', 'sawtooth', 'square']);
    for (const v of voices) {
      assert.equal(v.filter, null);
      assert.equal(v.start, 2);
      assert.ok(Math.abs(v.stop - 2.72) < 1e-9, `stop ${v.stop}`);
    }
  });

  test('invariants des SynthVoice, peak = gain * level', () => {
    const gain = 0.8;
    const voices = crySchedule(3, gain);
    const levels = [1, 0.6, 0.35];
    voices.forEach((v, i) => {
      assertVoiceInvariants(v, gain, `cri ${i}`);
      const peak = Math.max(...v.gain.map((p) => p.value));
      assert.ok(Math.abs(peak - gain * levels[i]) < EPS, `voix ${i} : peak ${peak}`);
      assert.equal(v.gain[0].value, 0);
      assert.ok(Math.abs(v.gain[v.gain.length - 1].value - 0.0001) < EPS, 'floorGain final');
    });
  });

  test('contour : rapport des fréquences = ratios des composantes ; repères du contour', () => {
    const [a, b, c] = crySchedule(0, 1);
    assert.ok(Math.abs(a.frequency[0].value - 1300 * 0.8) < 1e-6);
    assert.ok(Math.abs(b.frequency[0].value - 1300 * 1.012 * 0.8) < 1e-6);
    assert.ok(Math.abs(c.frequency[0].value - 1300 * 1.5 * 0.8) < 1e-6);
    const last = a.frequency[a.frequency.length - 1];
    assert.ok(Math.abs(last.value - 1300 * 0.6) < 1e-6, `fin ${last.value}`);
    assert.ok(Math.abs(last.time - 0.7) < 1e-9);
    const at08 = a.frequency.find((p) => Math.abs(p.time - 0.08) < 1e-9);
    assert.ok(at08, 'point du contour à 0.08 s');
    assert.ok(Math.abs(at08.value - 1300 * 1.25) < 1e-6);
  });

  test('vibrato : points alternés au-dessus / en dessous du contour, pas 1 / 44 s', () => {
    const voice = crySchedule(0, 1)[0];
    const vib = voice.frequency.filter((p) => p.time > 0.08 + EPS && p.time < 0.7 - EPS);
    assert.ok(vib.length >= 20, `${vib.length} points de vibrato`);
    const step = 1 / (2 * 22);
    // contour géométrique entre les repères (0.08, 1.25), (0.35, 1.15), (0.7, 0.6)
    const contour = (t) => (t <= 0.35
      ? 1.25 * (1.15 / 1.25) ** ((t - 0.08) / 0.27)
      : 1.15 * (0.6 / 1.15) ** ((t - 0.35) / 0.35));
    vib.forEach((p, k) => {
      assert.equal(p.ramp, 'linear');
      if (k > 0) assert.ok(Math.abs(p.time - vib[k - 1].time - step) < 1e-9, `pas ${k}`);
      const ratio = p.value / (1300 * contour(p.time));
      const expected = k % 2 === 0 ? 1.04 : 0.96;
      assert.ok(Math.abs(ratio - expected) < 1e-6, `point ${k} : ratio ${ratio}`);
    });
  });

  test('gain = 0 -> [] ; déterminisme ; gel', () => {
    const empty = crySchedule(1, 0);
    assert.deepEqual([...empty], []);
    assert.ok(Object.isFrozen(empty));
    assert.deepEqual(crySchedule(1.5, 0.3), crySchedule(1.5, 0.3));
    assertDeepFrozen(crySchedule(1.5, 0.3), 'cri');
  });

  test('erreurs : startTime / gain non finis -> TypeError ; hors domaine -> RangeError', () => {
    for (const bad of [NaN, Infinity, '1', undefined]) {
      assert.throws(() => crySchedule(bad, 0.5), TypeError, `startTime ${String(bad)}`);
      assert.throws(() => crySchedule(0, bad), TypeError, `gain ${String(bad)}`);
    }
    assert.throws(() => crySchedule(-1, 0.5), RangeError);
    assert.throws(() => crySchedule(0, -0.1), RangeError);
    assert.throws(() => crySchedule(0, 1.1), RangeError);
  });
});

describe('slurpSchedule', () => {
  test('3 voix : sawtooth et square filtrées, puis le « p » en sine sans filtre', () => {
    const voices = slurpSchedule(1);
    assert.equal(voices.length, 3);
    assert.deepEqual(voices.map((v) => v.wave), ['sawtooth', 'square', 'sine']);
    for (const v of voices.slice(0, 2)) {
      assert.ok(v.filter, 'filtre attendu');
      assert.equal(v.filter.type, 'lowpass');
      assert.equal(v.filter.q, 8);
      assert.equal(v.filter.frequency[0].value, 2600);
      assert.equal(v.filter.frequency[v.filter.frequency.length - 1].value, 280);
    }
    assert.equal(voices[2].filter, null);
    assert.ok(Math.abs(voices[2].start - 2.15) < 1e-9, `p : start ${voices[2].start}`);
  });

  test('gain par défaut = SLURP.gain ; invariants des SynthVoice', () => {
    assert.deepEqual(slurpSchedule(0), slurpSchedule(0, SLURP.gain));
    const voices = slurpSchedule(0.5, 0.6);
    voices.forEach((v, i) => assertVoiceInvariants(v, 0.6, `sluuurp ${i}`));
    const peaks = voices.map((v) => Math.max(...v.gain.map((p) => p.value)));
    assert.ok(Math.abs(peaks[0] - 0.6) < EPS);
    assert.ok(Math.abs(peaks[1] - 0.24) < EPS);
    assert.ok(Math.abs(peaks[2] - 0.3) < EPS);
  });

  test('voix 2 : hauteurs de la voix 1 divisées par 2', () => {
    const [v1, v2] = slurpSchedule(0);
    assert.equal(v1.frequency.length, v2.frequency.length);
    v1.frequency.forEach((p, i) => {
      assert.ok(Math.abs(v2.frequency[i].value - p.value / 2) < 1e-9, `point ${i}`);
      assert.equal(v2.frequency[i].time, p.time);
    });
    assert.equal(v1.frequency[0].value, 260);
    assert.ok(Math.abs(v1.frequency[v1.frequency.length - 1].value - 70) < 1e-9);
  });

  test('glouglou : points alternés autour du glissando, rampe linéaire', () => {
    const v1 = slurpSchedule(0)[0];
    const wob = v1.frequency.slice(1, -1);
    assert.ok(wob.length >= 15, `${wob.length} points de glouglou`);
    const glide = (t) => 260 * (70 / 260) ** (t / 1.1);
    wob.forEach((p, k) => {
      assert.equal(p.ramp, 'linear');
      const ratio = p.value / glide(p.time);
      const expected = k % 2 === 0 ? 1.08 : 0.92;
      assert.ok(Math.abs(ratio - expected) < 1e-6, `point ${k} : ratio ${ratio}`);
    });
  });

  test('« p » : 900 -> 120 Hz en 0.04 s, décroissance en 0.08 s', () => {
    const p = slurpSchedule(0)[2];
    assert.equal(p.frequency[0].value, 900);
    const end = p.frequency[p.frequency.length - 1];
    assert.equal(end.value, 120);
    assert.ok(Math.abs(end.time - 1.19) < 1e-9);
    assert.ok(Math.abs(p.gain[p.gain.length - 1].time - 1.23) < 1e-9);
  });

  test('gain = 0 -> [] ; déterminisme ; gel', () => {
    assert.deepEqual([...slurpSchedule(0, 0)], []);
    assert.ok(Object.isFrozen(slurpSchedule(0, 0)));
    assert.deepEqual(slurpSchedule(3), slurpSchedule(3));
    assertDeepFrozen(slurpSchedule(3), 'sluuurp');
  });

  test('erreurs : comme crySchedule', () => {
    for (const bad of [NaN, Infinity, '1', null]) {
      assert.throws(() => slurpSchedule(bad), TypeError, `startTime ${String(bad)}`);
      assert.throws(() => slurpSchedule(0, bad), TypeError, `gain ${String(bad)}`);
    }
    assert.throws(() => slurpSchedule(-1), RangeError);
    assert.throws(() => slurpSchedule(0, 2), RangeError);
    assert.throws(() => slurpSchedule(0, -1), RangeError);
  });
});

describe('reniflement', () => {
  test('constantes gelées ; HUNT_EVENT_TYPE === MONSTER_EVENT.HUNT', () => {
    assert.equal(HUNT_EVENT_TYPE, MONSTER_EVENT.HUNT);
    assert.deepEqual({ ...SNIFF }, { maxGain: 0.5, nearDistance: 2, silenceDistance: 36, minInterval: 4 });
    assert.ok(Object.isFrozen(SNIFF));
    assert.ok(Object.isFrozen(SNIFF_SYNTH));
    assert.ok(Object.isFrozen(SNIFF_SYNTH.inhales));
    assert.ok(Object.isFrozen(SNIFF_SYNTH.components));
  });

  test('sniffGain : 0 et 2 -> maxGain ; décroissant ; 36 et Infinity -> 0 ; erreurs', () => {
    assert.equal(sniffGain(0), SNIFF.maxGain);
    assert.equal(sniffGain(2), SNIFF.maxGain);
    assert.equal(sniffGain(36), 0);
    assert.equal(sniffGain(Infinity), 0);
    let previous = Infinity;
    for (let d = 0; d <= 40; d += 1) {
      const g = sniffGain(d);
      assert.ok(g <= previous && g >= 0 && g <= SNIFF.maxGain, `d = ${d}`);
      previous = g;
    }
    assert.throws(() => sniffGain(NaN), TypeError);
    assert.throws(() => sniffGain(-1), RangeError);
  });

  test('selectSniffGain : seuls les HUNT comptent, maximum, erreurs', () => {
    assert.equal(selectSniffGain([]), 0);
    assert.equal(selectSniffGain([{ type: 'turn', pathDistance: 0 }, { type: 'spot', pathDistance: 0 }]), 0);
    assert.equal(selectSniffGain([{ type: 'hunt', pathDistance: 12 }, { type: 'hunt', pathDistance: 4 }]),
      sniffGain(4));
    assert.throws(() => selectSniffGain(null), TypeError);
    assert.throws(() => selectSniffGain([null]), TypeError);
  });

  test('sniffSchedule : 3 inspirations x 4 composantes, passe-bande montant, bornes', () => {
    const voices = sniffSchedule(2, 0.3);
    assert.ok(Object.isFrozen(voices));
    assert.equal(voices.length, SNIFF_SYNTH.inhales.length * SNIFF_SYNTH.components.length);
    for (const v of voices) {
      assert.ok(Object.isFrozen(v));
      assert.equal(v.filter.type, 'bandpass');
      const [f0, f1] = v.filter.frequency;
      assert.ok(f1.value > f0.value, 'le filtre monte');
      for (const list of [v.frequency, v.gain, v.filter.frequency]) {
        assert.equal(list[0].ramp, 'set');
        assert.equal(list[0].time, v.start);
        for (let i = 1; i < list.length; i += 1) assert.ok(list[i].time >= list[i - 1].time - 1e-9);
        assert.ok(list.at(-1).time <= v.stop + 1e-9);
      }
      for (const p of v.gain) assert.ok(p.value >= 0 && p.value <= 0.3 + 1e-9);
      for (const p of v.frequency) assert.ok(p.value > 500 && p.value < 20000);
    }
    // inspirations disjointes, la dernière la plus longue
    const starts = [...new Set(voices.map((v) => v.start))];
    assert.equal(starts.length, 3);
    assert.deepEqual(starts, SNIFF_SYNTH.inhales.map((h) => 2 + h.offset));
  });

  test('sniffSchedule : gain 0 -> vide ; erreurs', () => {
    assert.deepEqual([...sniffSchedule(0, 0)], []);
    assert.throws(() => sniffSchedule(NaN, 0.3), TypeError);
    assert.throws(() => sniffSchedule(-1, 0.3), RangeError);
    assert.throws(() => sniffSchedule(0, 1.5), RangeError);
  });
});
