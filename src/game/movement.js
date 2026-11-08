// Player movement: rotation, translation and wall collisions (pure, no DOM).

import { isWallTile } from '../maze/grid.js';
import { PLAYER_RADIUS, normalizeAngle } from './player.js';

/** Réglages de déplacement par défaut. */
export const MOVEMENT = Object.freeze({
  walkSpeed: 2.5, // tiles / s
  runFactor: 1.8,
  turnSpeed: 2.6, // rad / s (~150 deg/s)
  maxDt: 0.1, // s: time step bound (background tab, lag)
});

/**
 * true si le carré de collision du joueur (demi-côté radius) centré en (x, y) chevauche
 * une tuile mur. Un contact exact sur le bord d'une tuile ne compte pas comme
 * chevauchement. Position non finie -> true.
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {number} x
 * @param {number} y
 * @param {number} [radius=PLAYER_RADIUS] demi-côté du carré, en tuiles
 * @returns {boolean}
 * @throws {RangeError} radius non fini ou négatif
 */
export function collides(grid, x, y, radius = PLAYER_RADIUS) {
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0) {
    throw new RangeError('radius must be a finite number >= 0');
  }
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return true;
  }
  const minTx = Math.floor(x - radius);
  const maxTx = Math.max(minTx, Math.ceil(x + radius) - 1);
  const minTy = Math.floor(y - radius);
  const maxTy = Math.max(minTy, Math.ceil(y + radius) - 1);
  for (let ty = minTy; ty <= maxTy; ty += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      if (isWallTile(grid, tx, ty)) return true;
    }
  }
  return false;
}

/**
 * Applique une intention pendant dt secondes. Fonction pure : ne modifie pas `player`.
 * 1. dt borné à [0, maxDt] ; dt négatif/NaN -> 0.
 * 2. Rotation : angle += turn * turnSpeed * dt, normalisé.
 * 3. Vecteur de déplacement (repère du nouvel angle) :
 *    avant = (cos a, sin a), droite = (-sin a, cos a) ;
 *    v = move * avant + strafe * droite, normalisé si sa norme > 1 (pas de bonus en
 *    diagonale), multiplié par walkSpeed * (run ? runFactor : 1) * dt.
 * 4. Collisions par axes séparés (glissement) : dx refusé si le carré de demi-côté
 *    PLAYER_RADIUS centré sur la nouvelle position touche un mur, puis même chose pour dy.
 * @param {import('./player.js').Player} player
 * @param {import('./input.js').Intent} intent axes hors {-1, 0, 1} traités comme 0
 * @param {number} dt secondes
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {Partial<typeof MOVEMENT>} [options] surcharge partielle de MOVEMENT (tests)
 * @returns {import('./player.js').Player} nouveau joueur gelé
 * @throws {TypeError} player, intent ou options mal formés
 * @throws {RangeError} réglage de options non fini ou négatif
 */
export function stepPlayer(player, intent, dt, grid, options) {
  if (player === null || typeof player !== 'object'
    || !isFiniteNumber(player.x) || !isFiniteNumber(player.y)
    || !isFiniteNumber(player.angle)) {
    throw new TypeError('player must have finite numeric x, y and angle');
  }
  if (intent === null || typeof intent !== 'object') {
    throw new TypeError('intent must be an object');
  }
  const settings = resolveSettings(options);

  const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, settings.maxDt) : 0;
  const move = axisValue(intent.move);
  const strafe = axisValue(intent.strafe);
  const turn = axisValue(intent.turn);

  const angle = normalizeAngle(player.angle + turn * settings.turnSpeed * step);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let vx = move * cos - strafe * sin;
  let vy = move * sin + strafe * cos;
  const norm = Math.hypot(vx, vy);
  if (norm > 1) {
    vx /= norm;
    vy /= norm;
  }
  const speed = settings.walkSpeed * (intent.run === true ? settings.runFactor : 1);
  const dx = vx * speed * step;
  const dy = vy * speed * step;

  let { x, y } = player;
  if (dx !== 0 && !collides(grid, x + dx, y, PLAYER_RADIUS)) x += dx;
  if (dy !== 0 && !collides(grid, x, y + dy, PLAYER_RADIUS)) y += dy;

  return Object.freeze({ x, y, angle });
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Valeur d'axe d'intention : 1, -1, sinon 0.
 * @param {unknown} value
 * @returns {-1|0|1}
 */
function axisValue(value) {
  if (value === 1) return 1;
  if (value === -1) return -1;
  return 0;
}

/**
 * Fusionne la surcharge partielle avec MOVEMENT et la valide.
 * @param {unknown} options
 * @returns {typeof MOVEMENT}
 */
function resolveSettings(options) {
  if (options === undefined) return MOVEMENT;
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const settings = { ...MOVEMENT };
  for (const key of Object.keys(MOVEMENT)) {
    const value = options[key];
    if (value === undefined) continue;
    if (!isFiniteNumber(value) || value < 0) {
      throw new RangeError(`options.${key} must be a finite number >= 0`);
    }
    settings[key] = value;
  }
  return settings;
}
