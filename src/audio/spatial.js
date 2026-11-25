/**
 * Panoramique stéréo des sons du monstre : calcul pur à partir de la position du joueur
 * (x, y, angle) et de celle de la source. N'importe rien, aucune API Web Audio, aucun DOM.
 * Repère FPS : angle 0 = est (+x), PI/2 = sud (+y) ; un angle qui croît tourne vers la
 * droite du joueur.
 */

/** Réglages du panoramique. */
export const SPATIAL = Object.freeze({
  maxPan: 0.8, // jamais tout à gauche ou tout à droite : l'autre oreille entend encore
  centerDistance: 0.25, // en tuiles : en dessous, le son est au centre (direction instable)
});

/**
 * Résout les réglages : valeurs par défaut pour les champs absents.
 * @param {Partial<typeof SPATIAL>} [options]
 * @returns {{ maxPan: number, centerDistance: number }}
 * @throws {TypeError} options non objet
 * @throws {RangeError} maxPan hors [0, 1] ou centerDistance < 0, ou valeur non finie
 */
function resolveOptions(options) {
  if (options !== undefined && options !== null && typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const maxPan = options?.maxPan ?? SPATIAL.maxPan;
  const centerDistance = options?.centerDistance ?? SPATIAL.centerDistance;
  if (typeof maxPan !== 'number' || !Number.isFinite(maxPan) || maxPan < 0 || maxPan > 1) {
    throw new RangeError('maxPan must be a finite number between 0 and 1');
  }
  if (typeof centerDistance !== 'number' || !Number.isFinite(centerDistance) || centerDistance < 0) {
    throw new RangeError('centerDistance must be a finite number >= 0');
  }
  return { maxPan, centerDistance };
}

/**
 * Vérifie qu'un point a des coordonnées finies.
 * @param {unknown} point
 * @param {string[]} keys
 * @param {string} label
 */
function assertFinite(point, keys, label) {
  if (point === null || typeof point !== 'object') {
    throw new TypeError(`${label} must be an object`);
  }
  for (const key of keys) {
    if (typeof point[key] !== 'number' || !Number.isFinite(point[key])) {
      throw new TypeError(`${label}.${key} must be a finite number`);
    }
  }
}

/**
 * Valeur latérale de la source vue du joueur : sin(direction - angle).
 * = (dy * cos(angle) - dx * sin(angle)) / hypot(dx, dy), avec dx = source.x - listener.x,
 * dy = source.y - listener.y.
 * +1 : plein à droite ; -1 : plein à gauche ; 0 : devant ou derrière.
 * hypot(dx, dy) < centerDistance -> 0.
 * @param {{ x: number, y: number, angle: number }} listener
 * @param {{ x: number, y: number }} source
 * @param {Partial<typeof SPATIAL>} [options]
 * @returns {number} dans [-1, 1]
 * @throws {TypeError} listener ou source non objet ; x, y, angle non finis
 * @throws {RangeError} options invalides
 */
export function relativeLateral(listener, source, options) {
  const { centerDistance } = resolveOptions(options);
  assertFinite(listener, ['x', 'y', 'angle'], 'listener');
  assertFinite(source, ['x', 'y'], 'source');
  const dx = source.x - listener.x;
  const dy = source.y - listener.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance < centerDistance) return 0;
  const cos = Math.cos(listener.angle);
  const sin = Math.sin(listener.angle);
  const value = (dy * cos - dx * sin) / distance;
  // Borne et normalisation du zéro : pas de NaN, pas de -0.
  return Math.min(1, Math.max(-1, value)) + 0;
}

/**
 * Panoramique à donner au lecteur : maxPan * relativeLateral(...).
 * @param {{ x: number, y: number, angle: number }} listener
 * @param {{ x: number, y: number }} source
 * @param {Partial<typeof SPATIAL>} [options]
 * @returns {number} dans [-maxPan, maxPan] ; jamais -0
 * @throws mêmes erreurs que relativeLateral
 */
export function stereoPan(listener, source, options) {
  const { maxPan } = resolveOptions(options);
  return maxPan * relativeLateral(listener, source, options) + 0;
}
