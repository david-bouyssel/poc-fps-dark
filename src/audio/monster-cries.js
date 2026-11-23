/**
 * Cris du monstre : reniflement (début de traque), cri strident (le monstre voit le
 * joueur) et « sluuurp » (capture).
 * Calcul pur des gains et des partitions. Aucun DOM, aucune API Web Audio ;
 * n'importe que ./bong.js.
 */
import { bongGain } from './bong.js';

/** Type d'événement consommé (MonsterSpotEvent) ; recopié, pas importé. */
export const SPOT_EVENT_TYPE = 'spot';

/** Type d'événement consommé (MonsterHuntEvent) ; recopié, pas importé. */
export const HUNT_EVENT_TYPE = 'hunt';

/** Réglages du reniflement. Distances en tuiles de chemin, temps en secondes. */
export const SNIFF = Object.freeze({
  maxGain: 0.5, // crête à courte distance (passe-bande : perçu plus doux que le bong)
  nearDistance: 2,
  silenceDistance: 36, // même courbe que les bongs
  minInterval: 4, // s entre deux débuts de reniflement
});

/**
 * Synthèse du reniflement : trois inspirations brèves. Chaque inspiration superpose des
 * dents de scie à hauteurs inharmoniques, agitées d'un vibrato rapide (souffle rugueux),
 * dans un passe-bande qui monte (l'air qui entre). Aucun bruit aléatoire : tout est
 * déterministe. Fréquences en Hz, temps en secondes relatifs au début.
 */
export const SNIFF_SYNTH = Object.freeze({
  inhales: Object.freeze([
    Object.freeze({ offset: 0, duration: 0.12, level: 0.8 }),
    Object.freeze({ offset: 0.19, duration: 0.12, level: 0.9 }),
    Object.freeze({ offset: 0.38, duration: 0.22, level: 1 }), // la plus longue
  ]),
  components: Object.freeze([
    Object.freeze({ wave: 'sawtooth', frequency: 1130, level: 1 }),
    Object.freeze({ wave: 'sawtooth', frequency: 1547, level: 0.8 }),
    Object.freeze({ wave: 'sawtooth', frequency: 2069, level: 0.6 }),
    Object.freeze({ wave: 'square', frequency: 2731, level: 0.4 }),
  ]),
  jitterRate: 70, // Hz, vibrato en triangle (grain du souffle)
  jitterDepth: 0.18,
  filter: Object.freeze({
    type: 'bandpass',
    q: 1.8,
    startFrequency: 1600,
    endFrequency: 3600, // l'air qui entre : le filtre monte
  }),
  attack: 0.04, // montée linéaire 0 -> crête
  floorGain: 0.0001,
  release: 0.02,
});

/** Réglages du cri. Distances en tuiles de chemin, temps en secondes. */
export const CRY = Object.freeze({
  maxGain: 0.2, // crête à courte distance : bas, le cri aigu ne doit pas couvrir les bongs graves
  nearDistance: 2,
  silenceDistance: 36, // même courbe que les bongs, crête plus basse (son aigu, perçu fort)
  minInterval: 6, // s entre deux débuts de cri
});

/** Réglages du sluuurp (contact : distance nulle, gain fixe). */
export const SLURP = Object.freeze({ gain: 0.6 });

/**
 * Synthèse du cri. Fréquences en Hz, temps en secondes relatifs au début.
 * contour : multiplicateurs de baseFrequency * ratio, rejoints en rampes exponentielles.
 */
export const CRY_SYNTH = Object.freeze({
  baseFrequency: 1300,
  components: Object.freeze([
    Object.freeze({ wave: 'sawtooth', ratio: 1, level: 1 }),
    Object.freeze({ wave: 'sawtooth', ratio: 1.012, level: 0.6 }), // désaccord, grain strident
    Object.freeze({ wave: 'square', ratio: 1.5, level: 0.35 }),
  ]),
  contour: Object.freeze([
    Object.freeze({ time: 0, multiplier: 0.8 }),
    Object.freeze({ time: 0.08, multiplier: 1.25 }), // montée brusque
    Object.freeze({ time: 0.35, multiplier: 1.15 }), // tenue
    Object.freeze({ time: 0.7, multiplier: 0.6 }), // chute
  ]),
  vibratoRate: 22, // Hz, vibrato en triangle
  vibratoDepth: 0.04,
  vibratoStart: 0.08,
  vibratoEnd: 0.7,
  attack: 0.02, // montée linéaire 0 -> crête
  hold: 0.35, // crête tenue jusqu'ici
  decayEnd: 0.7, // descente exponentielle crête -> floorGain
  floorGain: 0.0001,
  release: 0.02, // arrêt de l'oscillateur après la descente
});

/** Synthèse du sluuurp. Fréquences en Hz, temps en secondes relatifs au début. */
export const SLURP_SYNTH = Object.freeze({
  body: Object.freeze({
    startFrequency: 260,
    endFrequency: 70,
    glideDuration: 1.1, // rampe exponentielle de hauteur
    wobbleRate: 9, // Hz, « glouglou » en triangle
    wobbleDepth: 0.08,
    components: Object.freeze([
      Object.freeze({ wave: 'sawtooth', frequencyRatio: 1, level: 1 }),
      Object.freeze({ wave: 'square', frequencyRatio: 0.5, level: 0.4 }),
    ]),
    filter: Object.freeze({
      type: 'lowpass',
      q: 8, // résonance « mouillée »
      startFrequency: 2600,
      endFrequency: 280, // le « uuu » qui se ferme
      duration: 1.1,
    }),
    attack: 0.05,
    hold: 0.8,
    decayEnd: 1.2,
  }),
  pop: Object.freeze({
    wave: 'sine',
    offset: 1.15,
    startFrequency: 900,
    endFrequency: 120,
    glideDuration: 0.04,
    attack: 0.004,
    decayEnd: 0.08,
    level: 0.5,
  }),
  floorGain: 0.0001,
  release: 0.02,
});

/** Tolérance sur les temps (arrondis en virgule flottante). */
const TIME_EPSILON = 1e-9;

/**
 * @typedef {{ time: number, value: number, ramp: 'set'|'linear'|'exponential' }} AutomationPoint
 * @typedef {{ wave: 'sine'|'square'|'sawtooth'|'triangle', start: number, stop: number,
 *             frequency: ReadonlyArray<AutomationPoint>,
 *             gain: ReadonlyArray<AutomationPoint>,
 *             filter: null | { type: 'lowpass'|'bandpass', q: number,
 *                              frequency: ReadonlyArray<AutomationPoint> } }} SynthVoice
 * Invariants : premier point de chaque liste en 'set' à time === start ; temps croissants
 * au sens large dans [start, stop] ; valeurs des points 'exponential' > 0 ; gain dans [0, 1].
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {number} time
 * @param {number} value
 * @param {'set'|'linear'|'exponential'} ramp
 * @returns {AutomationPoint}
 */
function point(time, value, ramp) {
  return Object.freeze({ time, value, ramp });
}

/**
 * Valide startTime et gain comme bongSchedule.
 * @throws {TypeError} startTime ou gain non fini
 * @throws {RangeError} startTime < 0 ; gain hors [0, 1]
 */
function validateSchedule(startTime, gain) {
  if (!isFiniteNumber(startTime)) {
    throw new TypeError('startTime must be a finite number');
  }
  if (!isFiniteNumber(gain)) {
    throw new TypeError('gain must be a finite number');
  }
  if (startTime < 0) {
    throw new RangeError('startTime must be >= 0');
  }
  if (gain < 0 || gain > 1) {
    throw new RangeError('gain must be in [0, 1]');
  }
}

/**
 * Valeur d'un contour { time, multiplier } au temps t, interpolée géométriquement.
 * @param {ReadonlyArray<{ time: number, multiplier: number }>} contour
 * @param {number} t  temps relatif
 * @returns {number}
 */
function contourAt(contour, t) {
  if (t <= contour[0].time) return contour[0].multiplier;
  for (let i = 1; i < contour.length; i += 1) {
    const a = contour[i - 1];
    const b = contour[i];
    if (t <= b.time) {
      const u = (t - a.time) / (b.time - a.time);
      return a.multiplier * (b.multiplier / a.multiplier) ** u;
    }
  }
  return contour[contour.length - 1].multiplier;
}

/**
 * Points de vibrato en triangle : tous les 1 / (2 * rate) s, strictement entre from et
 * to (temps relatifs), valeur = scale * contour(t) * (1 + depth) puis (1 - depth) en
 * alternance, rampe linéaire.
 * @returns {AutomationPoint[]}
 */
function vibratoPoints(startTime, from, to, rate, depth, scale, contour) {
  const points = [];
  const step = 1 / (2 * rate);
  for (let k = 1; ; k += 1) {
    const t = from + k * step;
    if (t >= to - TIME_EPSILON) break;
    const sign = k % 2 === 1 ? 1 : -1;
    points.push(point(startTime + t, scale * contourAt(contour, t) * (1 + sign * depth), 'linear'));
  }
  return points;
}

/**
 * Gain d'un cri : même courbe que bongGain avec CRY (maxGain, nearDistance,
 * silenceDistance). Repère : d = 12 -> ~0.0997.
 * @param {number} pathDistance  entier >= 0 ou Infinity (MonsterSpotEvent.pathDistance)
 * @returns {number} dans [0, CRY.maxGain]
 * @throws {TypeError} pathDistance non numérique ou NaN
 * @throws {RangeError} pathDistance < 0
 */
export function cryGain(pathDistance) {
  return bongGain(pathDistance, {
    maxGain: CRY.maxGain,
    nearDistance: CRY.nearDistance,
    silenceDistance: CRY.silenceDistance,
  });
}

/**
 * Gain d'un reniflement : même courbe que bongGain avec SNIFF.
 * @param {number} pathDistance  entier >= 0 ou Infinity (MonsterHuntEvent.pathDistance)
 * @returns {number} dans [0, SNIFF.maxGain]
 * @throws {TypeError} pathDistance non numérique ou NaN
 * @throws {RangeError} pathDistance < 0
 */
export function sniffGain(pathDistance) {
  return bongGain(pathDistance, {
    maxGain: SNIFF.maxGain,
    nearDistance: SNIFF.nearDistance,
    silenceDistance: SNIFF.silenceDistance,
  });
}

/**
 * Maximum des sniffGain des événements de type HUNT_EVENT_TYPE ; autres types ignorés ;
 * aucun -> 0.
 * @param {ReadonlyArray<{ type: string, pathDistance: number }>} events
 * @returns {number}
 * @throws {TypeError} events non tableau, élément non objet ; erreurs de sniffGain
 */
export function selectSniffGain(events) {
  if (!Array.isArray(events)) {
    throw new TypeError('events must be an array');
  }
  let gain = 0;
  for (const event of events) {
    if (event === null || typeof event !== 'object') {
      throw new TypeError('each event must be an object');
    }
    if (event.type !== HUNT_EVENT_TYPE) continue;
    gain = Math.max(gain, sniffGain(event.pathDistance));
  }
  return gain;
}

/**
 * Partition du reniflement : pour chaque inspiration, une voix par composante
 * (3 x 4 = 12 voix), toutes en passe-bande.
 * Inspiration i de début s = startTime + offset et de durée D :
 *   hauteur : f, puis vibrato en triangle (jitterRate, jitterDepth) jusqu'à s + D ;
 *   filtre : startFrequency -> endFrequency en rampe exponentielle sur D ;
 *   gain : 0, rampe linéaire à peak = gain * inhale.level * component.level en attack,
 *          rampe exponentielle à floorGain en s + D ; stop = s + D + release.
 * gain === 0 -> tableau vide.
 * @param {number} startTime  s, temps du contexte audio (>= 0)
 * @param {number} gain  dans [0, 1]
 * @param {typeof SNIFF_SYNTH} [synth=SNIFF_SYNTH]
 * @returns {ReadonlyArray<SynthVoice>}  tableau gelé d'objets gelés
 * @throws {TypeError} startTime ou gain non fini
 * @throws {RangeError} startTime < 0 ; gain hors [0, 1]
 */
export function sniffSchedule(startTime, gain, synth = SNIFF_SYNTH) {
  validateSchedule(startTime, gain);
  if (gain === 0) return Object.freeze([]);

  const flat = Object.freeze([Object.freeze({ time: 0, multiplier: 1 })]);
  const voices = [];
  for (const inhale of synth.inhales) {
    const start = startTime + inhale.offset;
    const end = start + inhale.duration;
    for (const component of synth.components) {
      const frequency = [
        point(start, component.frequency, 'set'),
        ...vibratoPoints(start, 0, inhale.duration, synth.jitterRate, synth.jitterDepth,
          component.frequency, flat),
      ];
      const peak = gain * inhale.level * component.level;
      voices.push(Object.freeze({
        wave: component.wave,
        start,
        stop: end + synth.release,
        frequency: Object.freeze(frequency),
        gain: Object.freeze([
          point(start, 0, 'set'),
          point(start + synth.attack, peak, 'linear'),
          point(end, synth.floorGain, 'exponential'),
        ]),
        filter: Object.freeze({
          type: synth.filter.type,
          q: synth.filter.q,
          frequency: Object.freeze([
            point(start, synth.filter.startFrequency, 'set'),
            point(end, synth.filter.endFrequency, 'exponential'),
          ]),
        }),
      }));
    }
  }
  return Object.freeze(voices);
}

/**
 * Maximum des cryGain des événements de type SPOT_EVENT_TYPE ; autres types ignorés ;
 * aucun -> 0.
 * @param {ReadonlyArray<{ type: string, pathDistance: number }>} events
 * @returns {number}
 * @throws {TypeError} events non tableau, élément non objet ; erreurs de cryGain
 */
export function selectCryGain(events) {
  if (!Array.isArray(events)) {
    throw new TypeError('events must be an array');
  }
  let gain = 0;
  for (const event of events) {
    if (event === null || typeof event !== 'object') {
      throw new TypeError('each event must be an object');
    }
    if (event.type !== SPOT_EVENT_TYPE) continue;
    gain = Math.max(gain, cryGain(event.pathDistance));
  }
  return gain;
}

/**
 * Partition du cri : une voix par composante de synth.components (3 voix), sans filtre.
 * Hauteur : contour en rampes exponentielles, vibrato entre vibratoStart et vibratoEnd.
 * Enveloppe : 0 au début, rampe linéaire à peak = gain * level en attack, tenue jusqu'à
 * hold, rampe exponentielle à floorGain en decayEnd ; stop = decayEnd + release.
 * gain === 0 -> tableau vide.
 * @param {number} startTime  s, temps du contexte audio (>= 0)
 * @param {number} gain  dans [0, 1]
 * @param {typeof CRY_SYNTH} [synth=CRY_SYNTH]
 * @returns {ReadonlyArray<SynthVoice>}  tableau gelé d'objets gelés
 * @throws {TypeError} startTime ou gain non fini
 * @throws {RangeError} startTime < 0 ; gain hors [0, 1]
 */
export function crySchedule(startTime, gain, synth = CRY_SYNTH) {
  validateSchedule(startTime, gain);
  if (gain === 0) return Object.freeze([]);

  const { contour } = synth;
  const start = startTime;
  const stop = startTime + synth.decayEnd + synth.release;
  const voices = [];
  for (const component of synth.components) {
    const scale = synth.baseFrequency * component.ratio;
    const frequency = [point(start, scale * contour[0].multiplier, 'set')];
    for (let i = 1; i < contour.length; i += 1) {
      const { time, multiplier } = contour[i];
      if (time > synth.vibratoStart + TIME_EPSILON && time < synth.vibratoEnd - TIME_EPSILON) {
        continue; // Inside the vibrato: the vibrato points follow the contour.
      }
      frequency.push(point(startTime + time, scale * multiplier, 'exponential'));
      if (Math.abs(time - synth.vibratoStart) <= TIME_EPSILON) {
        frequency.push(...vibratoPoints(startTime, synth.vibratoStart, synth.vibratoEnd,
          synth.vibratoRate, synth.vibratoDepth, scale, contour));
      }
    }
    const peak = gain * component.level;
    voices.push(Object.freeze({
      wave: component.wave,
      start,
      stop,
      frequency: Object.freeze(frequency),
      gain: Object.freeze([
        point(start, 0, 'set'),
        point(startTime + synth.attack, peak, 'linear'),
        point(startTime + synth.hold, peak, 'linear'),
        point(startTime + synth.decayEnd, synth.floorGain, 'exponential'),
      ]),
      filter: null,
    }));
  }
  return Object.freeze(voices);
}

/**
 * Partition du sluuurp : 3 voix (voix 1 en dents de scie, voix 2 carrée à mi-hauteur,
 * toutes deux filtrées ; voix 3, le « p » final, sans filtre).
 * gain === 0 -> tableau vide.
 * @param {number} startTime  s, temps du contexte audio (>= 0)
 * @param {number} [gain=SLURP.gain]  dans [0, 1]
 * @param {typeof SLURP_SYNTH} [synth=SLURP_SYNTH]
 * @returns {ReadonlyArray<SynthVoice>}  tableau gelé d'objets gelés
 * @throws {TypeError} startTime ou gain non fini
 * @throws {RangeError} startTime < 0 ; gain hors [0, 1]
 */
export function slurpSchedule(startTime, gain = SLURP.gain, synth = SLURP_SYNTH) {
  validateSchedule(startTime, gain);
  if (gain === 0) return Object.freeze([]);

  const { body, pop } = synth;
  const glide = Object.freeze([
    Object.freeze({ time: 0, multiplier: body.startFrequency }),
    Object.freeze({ time: body.glideDuration, multiplier: body.endFrequency }),
  ]);
  const bodyStart = startTime;
  const bodyStop = startTime + body.decayEnd + synth.release;
  const voices = [];
  for (const component of body.components) {
    const ratio = component.frequencyRatio;
    const frequency = [
      point(bodyStart, body.startFrequency * ratio, 'set'),
      ...vibratoPoints(startTime, 0, body.glideDuration, body.wobbleRate, body.wobbleDepth,
        ratio, glide),
      point(startTime + body.glideDuration, body.endFrequency * ratio, 'exponential'),
    ];
    const peak = gain * component.level;
    voices.push(Object.freeze({
      wave: component.wave,
      start: bodyStart,
      stop: bodyStop,
      frequency: Object.freeze(frequency),
      gain: Object.freeze([
        point(bodyStart, 0, 'set'),
        point(startTime + body.attack, peak, 'linear'),
        point(startTime + body.hold, peak, 'linear'),
        point(startTime + body.decayEnd, synth.floorGain, 'exponential'),
      ]),
      filter: Object.freeze({
        type: body.filter.type,
        q: body.filter.q,
        frequency: Object.freeze([
          point(bodyStart, body.filter.startFrequency, 'set'),
          point(startTime + body.filter.duration, body.filter.endFrequency, 'exponential'),
        ]),
      }),
    }));
  }

  const popStart = startTime + pop.offset;
  const popPeak = gain * pop.level;
  voices.push(Object.freeze({
    wave: pop.wave,
    start: popStart,
    stop: popStart + pop.decayEnd + synth.release,
    frequency: Object.freeze([
      point(popStart, pop.startFrequency, 'set'),
      point(popStart + pop.glideDuration, pop.endFrequency, 'exponential'),
    ]),
    gain: Object.freeze([
      point(popStart, 0, 'set'),
      point(popStart + pop.attack, popPeak, 'linear'),
      point(popStart + pop.decayEnd, synth.floorGain, 'exponential'),
    ]),
    filter: null,
  }));
  return Object.freeze(voices);
}
