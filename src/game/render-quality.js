// Qualité de rendu adaptative : choisit la largeur de colonne (2, 3 ou 4 px CSS) selon le
// temps moyen d'image. Pur : le dt vient de createGameLoop (aucun performance, Date ni DOM).

/**
 * Réglages de la qualité adaptative. widths : largeurs admises, du rendu le plus fin au plus
 * grossier. slowMs / fastMs : seuils de la moyenne (ms) ; zone morte entre les deux.
 * minSamples / minHoldSeconds : délai avant toute décision. maxDt : dt (s) au-delà duquel
 * l'image est ignorée (onglet caché, reprise). smoothing : poids d'un nouvel échantillon dans
 * la moyenne mobile exponentielle. maxBackoff : multiplicateur maximal du délai de maintien.
 */
export const RENDER_QUALITY = Object.freeze({
  widths: Object.freeze([2, 3, 4]),
  slowMs: 24,
  fastMs: 18,
  minSamples: 30,
  minHoldSeconds: 5,
  maxDt: 0.25,
  smoothing: 0.1,
  maxBackoff: 12,
});

const MAX_LEVEL = RENDER_QUALITY.widths.length - 1;

/**
 * État initial : rendu fin (2 px), aucun échantillon.
 * @returns {Readonly<{ level: number, avgMs: number | null, samples: number, hold: number,
 *   backoff: number, returnedToMin: boolean }>}
 */
export function createRenderQuality() {
  return Object.freeze({
    level: 0,
    avgMs: null,
    samples: 0,
    hold: 0,
    backoff: 1,
    returnedToMin: false,
  });
}

/**
 * Intègre une image : dt (s) de l'image, ignoré s'il n'est pas un nombre fini dans ]0, maxDt].
 * Décide un changement de niveau seulement après minSamples échantillons et
 * minHoldSeconds * backoff secondes depuis le dernier changement. Un changement remet la
 * moyenne et les échantillons à zéro. Un retour au niveau le plus fin suivi d'une nouvelle
 * dégradation double le backoff (plafonné à maxBackoff) pour éviter l'oscillation.
 * @param {ReturnType<typeof createRenderQuality>} state
 * @param {number} dtSeconds
 * @returns {Readonly<object>} nouvel état gelé (state inchangé si dt ignoré)
 * @throws {TypeError} state n'est pas un objet
 */
export function stepRenderQuality(state, dtSeconds) {
  if (state === null || typeof state !== 'object') {
    throw new TypeError('state must be a render quality state');
  }
  if (!isUsableDt(dtSeconds)) {
    return state;
  }
  const ms = dtSeconds * 1000;
  const avgMs = state.avgMs === null
    ? ms
    : state.avgMs + RENDER_QUALITY.smoothing * (ms - state.avgMs);
  const samples = state.samples + 1;
  const hold = state.hold + dtSeconds;
  const canDecide = samples >= RENDER_QUALITY.minSamples
    && hold >= RENDER_QUALITY.minHoldSeconds * state.backoff;

  if (canDecide && avgMs > RENDER_QUALITY.slowMs && state.level < MAX_LEVEL) {
    return changeLevel(state, 1);
  }
  if (canDecide && avgMs < RENDER_QUALITY.fastMs && state.level > 0) {
    return changeLevel(state, -1);
  }
  return Object.freeze({ ...state, avgMs, samples, hold });
}

/**
 * Largeur de colonne de l'état : une valeur de RENDER_QUALITY.widths (2, 3 ou 4).
 * @param {{ level: number }} state
 * @returns {number}
 */
export function columnWidthFor(state) {
  const level = Math.min(MAX_LEVEL, Math.max(0, Math.trunc(state.level)));
  return RENDER_QUALITY.widths[level];
}

function isUsableDt(dtSeconds) {
  return typeof dtSeconds === 'number'
    && Number.isFinite(dtSeconds)
    && dtSeconds > 0
    && dtSeconds <= RENDER_QUALITY.maxDt;
}

function changeLevel(state, direction) {
  const up = direction > 0;
  const backoff = up && state.returnedToMin
    ? Math.min(RENDER_QUALITY.maxBackoff, state.backoff * 2)
    : state.backoff;
  const level = state.level + direction;
  return Object.freeze({
    level,
    avgMs: null,
    samples: 0,
    hold: 0,
    backoff,
    returnedToMin: !up && level === 0,
  });
}
