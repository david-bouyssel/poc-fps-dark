/**
 * Indicateur de danger : niveau 0..1 selon la distance de chemin au monstre. Calcul pur,
 * aucun DOM, aucune API navigateur, n'importe rien.
 */

/** Réglages par défaut. Distances en tuiles de chemin. */
export const DANGER = Object.freeze({
  nearDistance: 2, // d <= 2 : niveau maximal
  farDistance: 12, // d >= 12 : aucun danger
});

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Fusionne une surcharge partielle avec DANGER et la valide. Clé inconnue ignorée.
 * @param {Partial<typeof DANGER> | undefined} options
 * @returns {typeof DANGER}
 * @throws {TypeError} options non objet
 * @throws {RangeError} valeur non finie ou négative, nearDistance >= farDistance
 */
function resolveSettings(options) {
  if (options === undefined) return DANGER;
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const settings = { ...DANGER };
  for (const key of Object.keys(DANGER)) {
    const value = options[key];
    if (value === undefined) continue;
    if (!isFiniteNumber(value) || value < 0) {
      throw new RangeError(`options.${key} must be a finite number >= 0`);
    }
    settings[key] = value;
  }
  if (settings.nearDistance >= settings.farDistance) {
    throw new RangeError('options.nearDistance must be < options.farDistance');
  }
  return settings;
}

/**
 * Niveau de danger selon la distance de chemin monstre-joueur, linéaire :
 * - d === Infinity ou d >= farDistance -> 0 ;
 * - d <= nearDistance -> 1 ;
 * - sinon niveau = (far - d) / (far - near).
 * @param {number} pathDistance  entier >= 0 ou Infinity (monstre.pathDistance)
 * @param {Partial<typeof DANGER>} [options]  surcharge partielle (tests)
 * @returns {number} niveau dans [0, 1]
 * @throws {TypeError} pathDistance non numérique ou NaN
 * @throws {RangeError} pathDistance < 0 ; options invalides
 */
export function dangerLevel(pathDistance, options) {
  if (typeof pathDistance !== 'number' || Number.isNaN(pathDistance)) {
    throw new TypeError('pathDistance must be a number');
  }
  if (pathDistance < 0) {
    throw new RangeError('pathDistance must be >= 0');
  }
  const settings = resolveSettings(options);
  if (pathDistance >= settings.farDistance) return 0;
  if (pathDistance <= settings.nearDistance) return 1;
  return (settings.farDistance - pathDistance) / (settings.farDistance - settings.nearDistance);
}
