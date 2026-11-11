/**
 * Lecteur des « bong bong » : seul module qui appelle l'API Web Audio. Le contexte audio
 * vient uniquement de la fabrique injectée `createContext` (jamais d'accès global).
 * Aucune méthode ne lève d'exception : le son ne doit jamais casser le jeu.
 */
import { BONG, bongGain, bongSchedule } from './bong.js';

/** États du lecteur. */
export const BONG_PLAYER_STATE = Object.freeze({
  IDLE: 'idle', // aucun contexte créé
  RUNNING: 'running', // contexte créé, son autorisé
  SUSPENDED: 'suspended', // contexte créé, son coupé
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
 * @param {{ osc: any, env: any }} voice
 */
function disconnectVoice(voice) {
  try {
    voice.osc.disconnect();
    if (voice.env) voice.env.disconnect();
  } catch {
    // Nodes already disconnected.
  }
}

/**
 * Lecteur de bongs. Ne crée aucun contexte à la construction.
 * @param {{ createContext: () => (AudioContext | null | undefined),
 *           options?: Partial<typeof BONG> }} deps
 * @returns {{ resume(): void, suspend(): void, play(gain: number): boolean,
 *             readonly state: string }}  objet gelé
 * @throws {TypeError} createContext n'est pas une fonction
 * @throws {RangeError} options invalides (mêmes règles que bongGain)
 */
export function createBongPlayer({ createContext, options } = {}) {
  if (typeof createContext !== 'function') {
    throw new TypeError('createContext must be a function');
  }
  // Validates options with the same rules as bongGain.
  bongGain(0, options);
  const minInterval = options?.minInterval ?? BONG.minInterval;

  let state = BONG_PLAYER_STATE.IDLE;
  /** @type {any} */
  let ctx = null;
  let lastStart = -Infinity;
  /** @type {Set<{ osc: any, env: any }>} */
  const voices = new Set();

  function resume() {
    if (state === BONG_PLAYER_STATE.UNAVAILABLE) return;
    if (ctx === null) {
      let created = null;
      try {
        created = createContext();
      } catch {
        created = null;
      }
      if (created === null || created === undefined) {
        state = BONG_PLAYER_STATE.UNAVAILABLE;
        return;
      }
      ctx = created;
    }
    state = BONG_PLAYER_STATE.RUNNING;
    try {
      if (typeof ctx.resume === 'function') absorb(ctx.resume());
    } catch {
      // Resume refused: the game stays silent.
    }
  }

  function stopAllVoices() {
    for (const voice of voices) {
      stopVoice(voice);
    }
    voices.clear();
  }

  function suspend() {
    if (ctx === null) return;
    state = BONG_PLAYER_STATE.SUSPENDED;
    stopAllVoices();
    try {
      if (typeof ctx.suspend === 'function') absorb(ctx.suspend());
    } catch {
      // Suspend refused: voices are already stopped.
    }
  }

  /**
   * Programme un « bong bong ».
   * @param {number} gain
   * @returns {boolean} true si un bong est programmé
   */
  function play(gain) {
    if (state !== BONG_PLAYER_STATE.RUNNING) return false;
    if (typeof gain !== 'number' || !Number.isFinite(gain) || gain <= 0) return false;
    const created = [];
    try {
      const now = ctx.currentTime;
      if (now - lastStart < minInterval - INTERVAL_EPSILON) return false;
      const schedule = bongSchedule(now, Math.min(gain, 1));
      for (const voice of schedule) {
        const osc = ctx.createOscillator();
        const entry = { osc, env: null };
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
        env.connect(ctx.destination);
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

  return Object.freeze({
    resume,
    suspend,
    play,
    get state() {
      return state;
    },
  });
}
