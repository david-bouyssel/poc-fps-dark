/**
 * Lecteur des sons du monstre (« bong bong », alerte, cri, « sluuurp ») : seul module
 * qui appelle l'API Web Audio.
 * Le contexte audio vient uniquement de la fabrique injectée `createContext`
 * (jamais d'accès global).
 * Aucune méthode ne lève d'exception : le son ne doit jamais casser le jeu.
 */
import { BONG, bongGain, bongSchedule } from './bong.js';
import {
  ALERT, alertSchedule, CRY, crySchedule, slurpSchedule,
} from './monster-cries.js';

/** États du lecteur. */
export const MONSTER_AUDIO_STATE = Object.freeze({
  IDLE: 'idle', // aucun contexte créé
  RUNNING: 'running', // contexte créé, son autorisé
  SUSPENDED: 'suspended', // contexte créé, son coupé
  FINALE: 'finale', // contexte actif, seul le sluuurp sonne (fin de partie)
  UNAVAILABLE: 'unavailable', // fabrique en échec ou sans contexte : muet définitif
});

/** Tolérance sur le délai entre deux bongs (arrondis de l'horloge en virgule flottante). */
const INTERVAL_EPSILON = 1e-9;

/**
 * Absorbe le rejet éventuel d'une promesse (aucun rejet non géré).
 * @param {unknown} result
 */
function absorb(result) {
  if (result !== null && typeof result === 'object' && typeof result.catch === 'function') {
    result.catch(() => {});
  }
}

/**
 * Arrête et déconnecte une voix, sans jamais lever.
 * @param {{ osc: any, env: any }} voice
 */
function stopVoice(voice) {
  try {
    voice.osc.stop();
  } catch {
    // Oscillator never started or already stopped.
  }
}

/**
 * Déconnecte les nœuds d'une voix, sans jamais lever.
 * @param {{ osc: any, env: any, filter?: any, panner?: any }} voice
 */
function disconnectVoice(voice) {
  try {
    voice.osc.disconnect();
    if (voice.filter) voice.filter.disconnect();
    if (voice.env) voice.env.disconnect();
    if (voice.panner) voice.panner.disconnect();
  } catch {
    // Nodes already disconnected.
  }
}

/**
 * Ramène un panoramique à un nombre dans [-1, 1] ; toute autre valeur donne 0 (centre).
 * @param {unknown} pan
 * @returns {number}
 */
function sanitizePan(pan) {
  if (typeof pan !== 'number' || !Number.isFinite(pan)) return 0;
  return Math.min(1, Math.max(-1, pan));
}

/**
 * Applique une liste de points d'automation à un AudioParam.
 * @param {any} param
 * @param {ReadonlyArray<{ time: number, value: number, ramp: string }>} points
 */
function applyPoints(param, points) {
  for (const p of points) {
    if (p.ramp === 'set') param.setValueAtTime(p.value, p.time);
    else if (p.ramp === 'linear') param.linearRampToValueAtTime(p.value, p.time);
    else param.exponentialRampToValueAtTime(p.value, p.time);
  }
}

/**
 * Lecteur des sons du monstre. Ne crée aucun contexte à la construction.
 * @param {{ createContext: () => (AudioContext | null | undefined),
 *           options?: Partial<typeof BONG> }} deps
 * @returns {{ resume(): void, suspend(): void, setMuted(value: boolean): void,
 *             isMuted(): boolean, play(gain: number, pan?: number): boolean,
 *             playCry(gain: number, pan?: number): boolean, playAlert(gain: number, pan?: number): boolean,
 *             playSlurp(): boolean,
 *             readonly state: string }}  objet gelé
 * @throws {TypeError} createContext n'est pas une fonction
 * @throws {RangeError} options invalides (mêmes règles que bongGain)
 */
export function createMonsterAudio({ createContext, options } = {}) {
  if (typeof createContext !== 'function') {
    throw new TypeError('createContext must be a function');
  }
  // Validates options with the same rules as bongGain.
  bongGain(0, options);
  const minInterval = options?.minInterval ?? BONG.minInterval;

  let state = MONSTER_AUDIO_STATE.IDLE;
  /** @type {any} */
  let ctx = null;
  let lastStart = -Infinity;
  let lastCryStart = -Infinity;
  let lastAlertStart = -Infinity;
  /** @type {Set<{ osc: any, env: any, filter?: any }>} */
  const voices = new Set();
  /** Voix du sluuurp en cours (null si aucun) : sa fin naturelle suspend le contexte. */
  /** @type {Set<object> | null} */
  let slurpVoices = null;
  /** Drapeau suspend/resume (pause, page cachée, fin de partie) : indépendant de muted. */
  let suspended = false;
  /** Drapeau de coupure (setMuted) : indépendant de suspended. */
  let muted = false;

  /**
   * Crée le contexte à la demande (fabrique injectée, une seule fois).
   * @returns {boolean} false si le contexte est indisponible (muet définitif)
   */
  function ensureContext() {
    if (state === MONSTER_AUDIO_STATE.UNAVAILABLE) return false;
    if (ctx !== null) return true;
    let created = null;
    try {
      created = createContext();
    } catch {
      created = null;
    }
    if (created === null || created === undefined) {
      state = MONSTER_AUDIO_STATE.UNAVAILABLE;
      return false;
    }
    ctx = created;
    return true;
  }

  /**
   * Applique au contexte l'état voulu : il tourne si et seulement si le lecteur n'est
   * ni suspendu ni coupé. Sans contexte, ne fait rien (le drapeau sera appliqué à la création).
   */
  function syncContext() {
    if (ctx === null || state === MONSTER_AUDIO_STATE.UNAVAILABLE) return;
    if (suspended || muted) {
      stopAllVoices();
      state = MONSTER_AUDIO_STATE.SUSPENDED;
      try {
        if (typeof ctx.suspend === 'function') absorb(ctx.suspend());
      } catch {
        // Suspend refused: voices are already stopped.
      }
      return;
    }
    if (state !== MONSTER_AUDIO_STATE.FINALE) state = MONSTER_AUDIO_STATE.RUNNING;
    try {
      if (typeof ctx.resume === 'function') absorb(ctx.resume());
    } catch {
      // Resume refused: the game stays silent.
    }
  }

  function resume() {
    suspended = false;
    if (!ensureContext()) return;
    if (state === MONSTER_AUDIO_STATE.FINALE) {
      stopAllVoices();
      state = MONSTER_AUDIO_STATE.SUSPENDED;
    }
    syncContext();
  }

  function stopAllVoices() {
    for (const voice of voices) {
      stopVoice(voice);
    }
    voices.clear();
    slurpVoices = null;
  }

  function suspend() {
    suspended = true;
    syncContext();
  }

  /**
   * Coupe (true) ou rétablit (false) le son. Coupé : aucun son ne se programme et les sons en
   * cours sont arrêtés. Indépendant de suspend/resume.
   * @param {boolean} value
   */
  function setMuted(value) {
    muted = value === true;
    syncContext();
  }

  /** @returns {boolean} true si le son est coupé par setMuted */
  function isMuted() {
    return muted;
  }

  /**
   * Branche la sortie d'une voix : env -> panner -> destination si le contexte sait créer un
   * StereoPannerNode, sinon env -> destination (centre). Un échec du panner ne lève pas :
   * la voix joue au centre. pan === null : pas de panner (sluuurp).
   * @param {any} env
   * @param {number | null} pan
   * @param {{ panner?: any }} entry
   * @param {number} start  instant de départ de la voix (réglage du panoramique)
   */
  function connectOutput(env, pan, entry, start) {
    const destination = ctx.destination;
    if (pan === null || typeof ctx.createStereoPanner !== 'function') {
      env.connect(destination);
      return;
    }
    let panner = null;
    try {
      panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(sanitizePan(pan), start);
      panner.connect(destination);
      env.connect(panner);
    } catch {
      if (panner !== null) {
        try {
          panner.disconnect();
        } catch {
          // Panner never connected.
        }
      }
      panner = null;
      env.connect(destination);
    }
    if (panner !== null) entry.panner = panner;
  }

  /**
   * Programme un « bong bong ».
   * @param {number} gain
   * @param {number} [pan=0]  panoramique [-1, 1] (gauche -> droite) ; invalide -> centre
   * @returns {boolean} true si un bong est programmé
   */
  function play(gain, pan = 0) {
    if (state !== MONSTER_AUDIO_STATE.RUNNING) return false;
    if (typeof gain !== 'number' || !Number.isFinite(gain) || gain <= 0) return false;
    const created = [];
    try {
      const now = ctx.currentTime;
      if (now - lastStart < minInterval - INTERVAL_EPSILON) return false;
      const schedule = bongSchedule(now, Math.min(gain, 1));
      for (const voice of schedule) {
        const osc = ctx.createOscillator();
        const entry = { osc, env: null, panner: null };
        created.push(entry);
        osc.type = voice.wave;
        osc.frequency.setValueAtTime(voice.startFrequency, voice.start);
        osc.frequency.exponentialRampToValueAtTime(voice.frequency, voice.pitchEnd);
        const env = ctx.createGain();
        entry.env = env;
        env.gain.setValueAtTime(0, voice.start);
        env.gain.linearRampToValueAtTime(voice.peak, voice.attackEnd);
        env.gain.exponentialRampToValueAtTime(voice.floorGain, voice.decayEnd);
        osc.connect(env);
        connectOutput(env, pan, entry, voice.start);
        osc.start(voice.start);
        osc.stop(voice.stop);
        osc.onended = () => {
          disconnectVoice(entry);
          voices.delete(entry);
        };
        voices.add(entry);
      }
      lastStart = now;
      return true;
    } catch {
      for (const entry of created) {
        stopVoice(entry);
        disconnectVoice(entry);
        voices.delete(entry);
      }
      return false;
    }
  }

  /**
   * Programme une SynthVoice : osc -> (filter) -> env -> (panner) -> destination. L'entrée est
   * ajoutée à created avant toute opération qui peut lever.
   * @param {import('./monster-cries.js').SynthVoice} voice
   * @param {Array<object>} created
   * @param {() => void} [onEnded]  appelé après la déconnexion, à la fin de la voix
   * @param {number | null} [pan=null]  panoramique ; null : pas de panner (sluuurp)
   */
  function scheduleSynthVoice(voice, created, onEnded, pan = null) {
    const osc = ctx.createOscillator();
    const entry = { osc, env: null, filter: null, panner: null };
    created.push(entry);
    osc.type = voice.wave;
    applyPoints(osc.frequency, voice.frequency);
    const env = ctx.createGain();
    entry.env = env;
    applyPoints(env.gain, voice.gain);
    if (voice.filter) {
      const filter = ctx.createBiquadFilter();
      entry.filter = filter;
      filter.type = voice.filter.type;
      filter.Q.setValueAtTime(voice.filter.q, voice.start);
      applyPoints(filter.frequency, voice.filter.frequency);
      osc.connect(filter);
      filter.connect(env);
    } else {
      osc.connect(env);
    }
    connectOutput(env, pan, entry, voice.start);
    osc.start(voice.start);
    osc.stop(voice.stop);
    osc.onended = () => {
      disconnectVoice(entry);
      voices.delete(entry);
      if (onEnded) onEnded(entry);
    };
    voices.add(entry);
    return entry;
  }

  /**
   * Arrête et déconnecte les voix créées par une programmation qui a échoué.
   * @param {Array<object>} created
   */
  function discard(created) {
    for (const entry of created) {
      stopVoice(entry);
      disconnectVoice(entry);
      voices.delete(entry);
    }
  }

  /**
   * Programme un cri (le monstre voit le joueur). Délai propre au cri (CRY.minInterval).
   * @param {number} gain
   * @param {number} [pan=0]  panoramique [-1, 1] ; invalide -> centre
   * @returns {boolean} true si un cri est programmé
   */
  function playCry(gain, pan = 0) {
    if (state !== MONSTER_AUDIO_STATE.RUNNING) return false;
    if (typeof gain !== 'number' || !Number.isFinite(gain) || gain <= 0) return false;
    const created = [];
    try {
      const now = ctx.currentTime;
      if (now - lastCryStart < CRY.minInterval - INTERVAL_EPSILON) return false;
      for (const voice of crySchedule(now, Math.min(gain, 1))) {
        scheduleSynthVoice(voice, created, undefined, sanitizePan(pan));
      }
      lastCryStart = now;
      return true;
    } catch {
      discard(created);
      return false;
    }
  }

  /**
   * Programme une alerte (début de traque). Délai propre (ALERT.minInterval).
   * @param {number} gain
   * @param {number} [pan=0]  panoramique [-1, 1] ; invalide -> centre
   * @returns {boolean} true si une alerte est programmée
   */
  function playAlert(gain, pan = 0) {
    if (state !== MONSTER_AUDIO_STATE.RUNNING) return false;
    if (typeof gain !== 'number' || !Number.isFinite(gain) || gain <= 0) return false;
    const created = [];
    try {
      const now = ctx.currentTime;
      if (now - lastAlertStart < ALERT.minInterval - INTERVAL_EPSILON) return false;
      for (const voice of alertSchedule(now, Math.min(gain, 1))) {
        scheduleSynthVoice(voice, created, undefined, sanitizePan(pan));
      }
      lastAlertStart = now;
      return true;
    } catch {
      discard(created);
      return false;
    }
  }

  /**
   * Coupe toutes les voix, joue le sluuurp et passe en FINALE. À la fin naturelle de la
   * dernière voix du sluuurp, le contexte est suspendu (état SUSPENDED).
   * @returns {boolean} true si le sluuurp est programmé
   */
  function playSlurp() {
    if (state !== MONSTER_AUDIO_STATE.RUNNING) return false;
    stopAllVoices();
    const created = [];
    try {
      const current = new Set();
      const onEnded = (entry) => {
        if (slurpVoices !== current) return;
        current.delete(entry);
        if (current.size > 0 || state !== MONSTER_AUDIO_STATE.FINALE) return;
        slurpVoices = null;
        suspended = true;
        state = MONSTER_AUDIO_STATE.SUSPENDED;
        try {
          if (typeof ctx.suspend === 'function') absorb(ctx.suspend());
        } catch {
          // Suspend refused: the slurp is over anyway.
        }
      };
      for (const voice of slurpSchedule(ctx.currentTime)) {
        current.add(scheduleSynthVoice(voice, created, onEnded));
      }
      slurpVoices = current;
      state = MONSTER_AUDIO_STATE.FINALE;
      return true;
    } catch {
      discard(created);
      suspend();
      return false;
    }
  }

  return Object.freeze({
    resume,
    suspend,
    setMuted,
    isMuted,
    play,
    playCry,
    playAlert,
    playSlurp,
    get state() {
      return state;
    },
  });
}
