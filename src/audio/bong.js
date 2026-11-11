/**
 * Son « bong bong » du monstre : calcul pur du gain selon la distance de chemin et
 * partition des notes. Aucun DOM, aucune API Web Audio, n'importe rien.
 */

/** Type d'événement consommé (forme de MonsterEvent, T5) ; recopié, pas importé. */
export const TURN_EVENT_TYPE = 'turn';

/** Réglages du gain. Distances en tuiles de chemin, temps en secondes. */
export const BONG = Object.freeze({
  maxGain: 0.7, // gain de crête à courte distance (dans [0, 1])
  nearDistance: 2, // d <= 2 : gain maximal
  silenceDistance: 36, // d >= 36 (18 cellules) : silence
  minInterval: 0.9, // s entre deux débuts de bong (>= durée d'un bong bong)
});

/** Synthèse d'un « bong bong ». Fréquences en Hz, temps en secondes relatifs au début. */
export const BONG_SYNTH = Object.freeze({
  hits: Object.freeze([
    Object.freeze({ offset: 0, frequency: 98, level: 1 }), // sol grave (G2)
    Object.freeze({ offset: 0.3, frequency: 73.42, level: 0.85 }), // ré plus grave (D2)
  ]),
  partialRatio: 2.76, // partiel de cloche, au-dessus de la fondamentale
  partialLevel: 0.3, // part du partiel dans le gain du coup
  pitchDrop: 1.08, // la fréquence part de frequency * 1.08...
  pitchDropTime: 0.06, // ... et descend à frequency en 0.06 s (attaque « bong »)
  attack: 0.008, // montée linéaire 0 -> crête
  decay: 0.55, // descente exponentielle crête -> floorGain
  floorGain: 0.0001, // cible de la rampe exponentielle (> 0, exigé par Web Audio)
  release: 0.02, // arrêt de l'oscillateur après la fin de la descente
});

/**
 * @typedef {{ wave: 'sine'|'triangle', start: number, frequency: number,
 *             startFrequency: number, pitchEnd: number, peak: number, attackEnd: number,
 *             decayEnd: number, floorGain: number, stop: number }} BongVoice
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Fusionne une surcharge partielle avec BONG et la valide. Clé inconnue ignorée.
 * @param {Partial<typeof BONG> | undefined} options
 * @returns {typeof BONG}
 * @throws {TypeError} options non objet
 * @throws {RangeError} valeur non finie ou négative, maxGain > 1,
 *   nearDistance >= silenceDistance
 */
function resolveSettings(options) {
  if (options === undefined) return BONG;
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const settings = { ...BONG };
  for (const key of Object.keys(BONG)) {
    const value = options[key];
    if (value === undefined) continue;
    if (!isFiniteNumber(value) || value < 0) {
      throw new RangeError(`options.${key} must be a finite number >= 0`);
    }
    settings[key] = value;
  }
  if (settings.maxGain > 1) {
    throw new RangeError('options.maxGain must be <= 1');
  }
  if (settings.nearDistance >= settings.silenceDistance) {
    throw new RangeError('options.nearDistance must be < options.silenceDistance');
  }
  return settings;
}

/**
 * Gain d'un bong selon la distance de chemin monstre-joueur.
 * - d === Infinity ou d >= silenceDistance -> 0 ;
 * - d <= nearDistance -> maxGain ;
 * - sinon u = (d - nearDistance) / (silenceDistance - nearDistance),
 *   gain = maxGain * (1 - u) ** 2 (décroissance quadratique, plus naturelle à l'oreille).
 * Strictement décroissante sur [nearDistance, silenceDistance], continue aux bornes.
 * Repères (valeurs par défaut) : d = 12 -> ~0.349 ; d = 18 -> ~0.196 ; d = 30 -> ~0.022.
 * @param {number} pathDistance  entier >= 0 ou Infinity (MonsterEvent.pathDistance)
 * @param {Partial<typeof BONG>} [options]  surcharge partielle (tests)
 * @returns {number} gain dans [0, maxGain]
 * @throws {TypeError} pathDistance non numérique ou NaN
 * @throws {RangeError} pathDistance < 0 ; options invalides
 */
export function bongGain(pathDistance, options) {
  if (typeof pathDistance !== 'number' || Number.isNaN(pathDistance)) {
    throw new TypeError('pathDistance must be a number');
  }
  if (pathDistance < 0) {
    throw new RangeError('pathDistance must be >= 0');
  }
  const settings = resolveSettings(options);
  if (pathDistance >= settings.silenceDistance) return 0;
  if (pathDistance <= settings.nearDistance) return settings.maxGain;
  const u =
    (pathDistance - settings.nearDistance) /
    (settings.silenceDistance - settings.nearDistance);
  return settings.maxGain * (1 - u) ** 2;
}

/**
 * Gain à jouer pour les événements d'un pas : maximum des bongGain des événements de
 * type TURN_EVENT_TYPE. Autres types ignorés. Aucun événement TURN -> 0.
 * Un seul bong par image : plusieurs virages dans un pas ne s'empilent pas.
 * @param {ReadonlyArray<{ type: string, pathDistance: number }>} events
 * @param {Partial<typeof BONG>} [options]
 * @returns {number}
 * @throws {TypeError} events non tableau, élément non objet ; erreurs de bongGain
 */
export function selectBongGain(events, options) {
  if (!Array.isArray(events)) {
    throw new TypeError('events must be an array');
  }
  resolveSettings(options);
  let gain = 0;
  for (const event of events) {
    if (event === null || typeof event !== 'object') {
      throw new TypeError('each event must be an object');
    }
    if (event.type !== TURN_EVENT_TYPE) continue;
    gain = Math.max(gain, bongGain(event.pathDistance, options));
  }
  return gain;
}

/**
 * Partition d'un bong bong : une voix par coup et par composante (fondamentale, puis
 * partiel), dans l'ordre de BONG_SYNTH.hits. 2 coups -> 4 voix.
 * Pour un coup h et une composante de rapport r (1, ou partialRatio) et de niveau
 * l (1, ou partialLevel) :
 *   start = startTime + h.offset
 *   frequency = h.frequency * r ; startFrequency = frequency * pitchDrop
 *   pitchEnd = start + pitchDropTime
 *   peak = gain * h.level * l ; attackEnd = start + attack
 *   decayEnd = attackEnd + decay ; stop = decayEnd + release
 *   wave = 'sine' (fondamentale) ou 'triangle' (partiel)
 * gain === 0 -> tableau vide.
 * @param {number} startTime  s, temps du contexte audio (>= 0)
 * @param {number} gain  dans [0, 1]
 * @param {typeof BONG_SYNTH} [synth=BONG_SYNTH]
 * @returns {ReadonlyArray<BongVoice>}  tableau gelé d'objets gelés
 * @throws {TypeError} startTime ou gain non fini
 * @throws {RangeError} startTime < 0 ; gain hors [0, 1]
 */
export function bongSchedule(startTime, gain, synth = BONG_SYNTH) {
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
  if (gain === 0) return Object.freeze([]);

  const components = [
    { wave: 'sine', ratio: 1, level: 1 },
    { wave: 'triangle', ratio: synth.partialRatio, level: synth.partialLevel },
  ];
  const voices = [];
  for (const hit of synth.hits) {
    const start = startTime + hit.offset;
    for (const component of components) {
      const frequency = hit.frequency * component.ratio;
      const attackEnd = start + synth.attack;
      const decayEnd = attackEnd + synth.decay;
      voices.push(
        Object.freeze({
          wave: component.wave,
          start,
          frequency,
          startFrequency: frequency * synth.pitchDrop,
          pitchEnd: start + synth.pitchDropTime,
          peak: gain * hit.level * component.level,
          attackEnd,
          decayEnd,
          floorGain: synth.floorGain,
          stop: decayEnd + synth.release,
        }),
      );
    }
  }
  return Object.freeze(voices);
}
