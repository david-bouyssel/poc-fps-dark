// Monster: spawn, tile-by-tile movement, wander / chase, contact (pure, no DOM).
//
// Seed contract: the spawn cell and the wandering of a given seed depend on
// MONSTER_SEED_SALT, on the candidate order (increasing tile index, row by row), on
// NEIGHBOR_OFFSETS and on the draw order below. Changing any of them changes the monster
// of a shared seed, never its maze.
//
// Cost: one BFS (at most 16 641 tiles for a 64 x 64 maze) per arrival on a tile, about
// 3.4 BFS/s while chasing. Never one BFS per frame, except when the monster waits on the
// player's tile, in which case the capture is immediate.
//
// Random state: createRng returns a mutable closure, so the state only stores an uint32
// (rngState). Each wander draw does r = createRng(rngState), choice = randomInt(r, n),
// rngState' = randomInt(r, MAX_SEED + 1).

import { NEIGHBOR_OFFSETS, shortestPath, tileAt, tileDistances, UNREACHABLE } from './pathfinding.js';
import { createRng, MAX_SEED, randomInt } from '../maze/random.js';
import { isWallTile } from '../maze/grid.js';

/** Graine dédiée du monstre : maze.seed ^ MONSTER_SEED_SALT (>>> 0). Contrat de graine. */
export const MONSTER_SEED_SALT = 0x85EBCA6B;

/** Kind de sprite du monstre (clé de spriteImages, fournie par T6). */
export const MONSTER_KIND = 'monster';

export const MONSTER_MODE = Object.freeze({ WANDER: 'wander', CHASE: 'chase' });

/** Caps cardinaux, alignés sur NEIGHBOR_OFFSETS (N, E, S, W). */
export const HEADING = Object.freeze({ N: 'N', E: 'E', S: 'S', W: 'W' });

export const MONSTER_EVENT = Object.freeze({ TURN: 'turn' });

/** Réglages (surcharge partielle possible dans options, tests). Unités : tuiles, secondes. */
export const MONSTER = Object.freeze({
  wanderSpeed: 1.6, // tiles / s (< walk 2.5)
  chaseSpeed: 3.4, // tiles / s: walk 2.5 < 3.4 < run 2.5 * 1.8 = 4.5
  chaseDistance: 12, // path tiles (= 6 cells): chase if d <= 12
  chaseHysteresis: 6, // back to wander if d > 12 + 6 = 18
  catchRadius: 0.6, // monster-player euclidean distance, defeat if <= 0.6
  graceDuration: 3, // s of stillness at the start of each round
  spawnMinFraction: 0.5, // spawn at >= ceil(0.5 * max distance) from tile (1, 1)
  maxDt: 0.1, // s, step bound (like MOVEMENT.maxDt)
});

/** Caps dans l'ordre de NEIGHBOR_OFFSETS. */
const HEADINGS_BY_OFFSET = Object.freeze([HEADING.N, HEADING.E, HEADING.S, HEADING.W]);

/** Nombre maximal d'itérations (décision + avancée) par pas. */
const MAX_ITERATIONS = 8;

const EMPTY_EVENTS = Object.freeze([]);

/**
 * @typedef {Object} MonsterState  objet gelé
 * @property {number} tx  tuile de départ du pas en cours (sol, entier)
 * @property {number} ty
 * @property {number|null} nextTx  tuile visée (voisine 4-connexe) ; null = arrêté au centre
 * @property {number|null} nextTy
 * @property {number|null} fromTx  tuile précédente (anti demi-tour en errance) ; null au départ
 * @property {number|null} fromTy
 * @property {number} progress  avancement du pas dans [0, 1) ; 0 si nextTx null
 * @property {number} x  position monde = (tx + 0.5) + (nextTx - tx) * progress
 * @property {number} y  position monde = (ty + 0.5) + (nextTy - ty) * progress
 * @property {'wander'|'chase'} mode
 * @property {'N'|'E'|'S'|'W'|null} heading  cap du dernier pas décidé ; null avant le 1er pas
 * @property {number} pathDistance  dernière distance de chemin au joueur, en tuiles
 *                                  (entier >= 0 ou Infinity)
 * @property {number} graceRemaining  s, >= 0
 * @property {number} rngState  uint32, état du tirage d'errance
 */

/**
 * @typedef {{ type: 'turn', heading: 'N'|'E'|'S'|'W', pathDistance: number,
 *             x: number, y: number }} MonsterEvent  objet gelé ; x, y = centre de la
 *             tuile où le monstre tourne ; pathDistance = celle de la décision
 */

/**
 * Monstre de départ d'une manche.
 * 1. dist = tileDistances(grid, 1, 1) ; maxDist = max sur les tuiles (impair, impair).
 * 2. Candidats : tuiles (impair, impair) atteintes, différentes de (1, 1) et de exit, avec
 *    dist >= Math.ceil(spawnMinFraction * maxDist), triées par index de cellule croissant
 *    (parcours ligne par ligne).
 *    Repli si vide : toutes les tuiles atteintes sauf (1, 1) et exit, puis sauf (1, 1)
 *    seulement ; RangeError si toujours vide.
 * 3. rng = createRng((seed ^ MONSTER_SEED_SALT) >>> 0) ; index = randomInt(rng, n) ;
 *    rngState = randomInt(rng, MAX_SEED + 1) (dans cet ordre).
 * 4. État : centre de la tuile, next et from null, progress 0, mode WANDER, heading null,
 *    pathDistance = dist de la tuile choisie, graceRemaining = graceDuration.
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid  grille de toTileGrid
 * @param {number} seed  entier dans [0, MAX_SEED] (maze.seed)
 * @param {{ exit?: { tx: number, ty: number } | null }} [placement]  sortie à éviter
 * @param {Partial<typeof MONSTER>} [options]
 * @returns {MonsterState}
 * @throws {TypeError} grid, seed (non numérique), placement ou exit mal formé
 * @throws {RangeError} seed hors bornes, tuile (1, 1) non sol, aucun candidat, options invalides
 */
export function createMonster(grid, seed, placement = {}, options) {
  validateGrid(grid);
  if (typeof seed !== 'number') {
    throw new TypeError('seed must be a number');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
    throw new RangeError(`seed must be an integer between 0 and ${MAX_SEED}`);
  }
  if (placement === null || typeof placement !== 'object') {
    throw new TypeError('placement must be an object');
  }
  const exit = placement.exit;
  if (exit !== undefined && exit !== null
    && (typeof exit !== 'object' || !Number.isInteger(exit.tx) || !Number.isInteger(exit.ty))) {
    throw new TypeError('placement.exit must be null or have integer tx and ty');
  }
  const settings = resolveSettings(options);

  const dist = tileDistances(grid, 1, 1);
  const { width, height } = grid;
  const exitIndex = exit ? exit.ty * width + exit.tx : -1;
  const startIndex = width + 1;

  let maxDist = 0;
  for (let ty = 1; ty < height; ty += 2) {
    for (let tx = 1; tx < width; tx += 2) {
      const d = dist[ty * width + tx];
      if (d > maxDist) maxDist = d;
    }
  }
  const threshold = Math.ceil(settings.spawnMinFraction * maxDist);

  let candidates = [];
  for (let ty = 1; ty < height; ty += 2) {
    for (let tx = 1; tx < width; tx += 2) {
      const index = ty * width + tx;
      const d = dist[index];
      if (d === UNREACHABLE || index === startIndex || index === exitIndex) continue;
      if (d >= threshold) candidates.push(index);
    }
  }
  if (candidates.length === 0) {
    candidates = reachedTiles(dist, (index) => index !== startIndex && index !== exitIndex);
  }
  if (candidates.length === 0) {
    candidates = reachedTiles(dist, (index) => index !== startIndex);
  }
  if (candidates.length === 0) {
    throw new RangeError('no spawn tile for the monster');
  }

  const rng = createRng((seed ^ MONSTER_SEED_SALT) >>> 0);
  const chosen = candidates[randomInt(rng, candidates.length)];
  const rngState = randomInt(rng, MAX_SEED + 1);
  const tx = chosen % width;
  const ty = (chosen - tx) / width;

  return makeState({
    tx,
    ty,
    nextTx: null,
    nextTy: null,
    fromTx: null,
    fromTy: null,
    progress: 0,
    mode: MONSTER_MODE.WANDER,
    heading: null,
    pathDistance: dist[chosen],
    graceRemaining: settings.graceDuration,
    rngState,
  });
}

/**
 * Avance le monstre pendant dt secondes. Pur : ne modifie ni monster ni player.
 * - step = dt borné à [0, maxDt] (négatif, NaN ou non numérique -> 0).
 *   step === 0 -> { monster: même référence, events: [] }.
 * - graceRemaining > 0 : graceRemaining = max(0, graceRemaining - step), aucun
 *   déplacement ni décision pendant ce pas (le reliquat de temps est perdu).
 * - Sinon, budget de temps t = step, au plus 8 itérations :
 *   a. Si nextTx est null : décision (ci-dessous). Si elle ne donne pas de tuile visée,
 *      arrêt (temps consommé).
 *   b. speed = chaseSpeed si mode CHASE, sinon wanderSpeed ; si speed === 0, arrêt.
 *      reste = (1 - progress) / speed.
 *      Si t < reste : progress += t * speed, t = 0.
 *      Sinon : arrivée. from = t, t = next, next = null, progress = 0, et t -= reste.
 * - Décision au centre de la tuile (tx, ty) :
 *   1. (ptx, pty) = tileAt(player.x, player.y). Mur ou hors grille : path = null. Sinon
 *      path = shortestPath(grid, tx, ty, ptx, pty). d = path ? path.length - 1 : Infinity ;
 *      pathDistance = d.
 *   2. Mode : WANDER et d <= chaseDistance -> CHASE ;
 *      CHASE et d > chaseDistance + chaseHysteresis -> WANDER.
 *   3. CHASE et d >= 1 : next = path[1]. CHASE et d === 0 : pas de tuile visée (attend
 *      au centre). Pas de tirage aléatoire en CHASE.
 *   4. WANDER : voisins sols dans l'ordre NEIGHBOR_OFFSETS, sauf la tuile from. Si vide,
 *      tous les voisins sols (cul-de-sac -> demi-tour). Si vide encore, pas de tuile visée.
 *      Un seul voisin : pas de tirage. Plusieurs : tirage, rngState mis à jour.
 *   5. Si une tuile est visée et que son cap diffère de heading : événement TURN
 *      { heading, pathDistance: d, x: tx + 0.5, y: ty + 0.5 }, puis heading = cap. Le
 *      premier pas après la grâce émet donc un TURN.
 * - x, y recalculés en fin de pas.
 * Coût : un BFS par décision, c'est-à-dire par arrivée sur une tuile (jamais à chaque
 * image, sauf monstre arrêté sur la tuile du joueur, cas de capture immédiate).
 * @param {MonsterState} monster
 * @param {{ x: number, y: number }} player
 * @param {number} dt  secondes
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {Partial<typeof MONSTER>} [options]
 * @returns {{ monster: MonsterState, events: ReadonlyArray<MonsterEvent> }}  objet gelé,
 *          events gelé, dans l'ordre chronologique
 * @throws {TypeError} monster, player ou grid mal formé
 * @throws {RangeError} options invalides
 */
export function stepMonster(monster, player, dt, grid, options) {
  validateGrid(grid);
  validateMonster(monster, grid);
  validatePosition(player, 'player');
  const settings = resolveSettings(options);

  const step = typeof dt === 'number' && dt > 0 ? Math.min(dt, settings.maxDt) : 0;
  if (step === 0) {
    return Object.freeze({ monster, events: EMPTY_EVENTS });
  }

  if (monster.graceRemaining > 0) {
    const next = makeState({
      ...monster,
      graceRemaining: Math.max(0, monster.graceRemaining - step),
    });
    return Object.freeze({ monster: next, events: EMPTY_EVENTS });
  }

  const s = { ...monster };
  const events = [];
  let t = step;
  for (let i = 0; i < MAX_ITERATIONS && t > 0; i += 1) {
    if (s.nextTx === null) {
      decide(s, player, grid, settings, events);
      if (s.nextTx === null) break;
    }
    const speed = s.mode === MONSTER_MODE.CHASE ? settings.chaseSpeed : settings.wanderSpeed;
    if (speed === 0) break;
    const remaining = (1 - s.progress) / speed;
    if (t < remaining) {
      s.progress += t * speed;
      t = 0;
    } else {
      s.fromTx = s.tx;
      s.fromTy = s.ty;
      s.tx = s.nextTx;
      s.ty = s.nextTy;
      s.nextTx = null;
      s.nextTy = null;
      s.progress = 0;
      t -= remaining;
    }
  }

  return Object.freeze({
    monster: makeState(s),
    events: events.length === 0 ? EMPTY_EVENTS : Object.freeze(events),
  });
}

/**
 * Contact : Math.hypot(monster.x - player.x, monster.y - player.y) <= radius.
 * @param {{ x: number, y: number }} monster
 * @param {{ x: number, y: number }} player
 * @param {number} [radius=MONSTER.catchRadius]
 * @returns {boolean}
 * @throws {TypeError} positions non finies ; radius non fini ou négatif
 */
export function isCatching(monster, player, radius = MONSTER.catchRadius) {
  validatePosition(monster, 'monster');
  validatePosition(player, 'player');
  if (!isFiniteNumber(radius) || radius < 0) {
    throw new TypeError('radius must be a finite number >= 0');
  }
  return Math.hypot(monster.x - player.x, monster.y - player.y) <= radius;
}

/**
 * Forme de sprite du monstre pour drawFpsView : objet gelé { x, y, kind: MONSTER_KIND }.
 * worldSize n'est pas fixé ici : T6 l'ajoute (ou le fixe dans main.js).
 * @param {MonsterState} monster
 * @returns {{ x: number, y: number, kind: string }}
 * @throws {TypeError} monster mal formé
 */
export function monsterSprite(monster) {
  validatePosition(monster, 'monster');
  return Object.freeze({ x: monster.x, y: monster.y, kind: MONSTER_KIND });
}

/**
 * Décision au centre de la tuile (s.tx, s.ty). Modifie s (copie de travail) et events.
 * @param {Object} s  état de travail mutable
 * @param {{ x: number, y: number }} player
 * @param {{ width: number, height: number, tiles: Uint8Array }} grid
 * @param {typeof MONSTER} settings
 * @param {MonsterEvent[]} events
 */
function decide(s, player, grid, settings, events) {
  const { tx: ptx, ty: pty } = tileAt(player.x, player.y);
  const path = isWallTile(grid, ptx, pty) ? null : shortestPath(grid, s.tx, s.ty, ptx, pty);
  const d = path ? path.length - 1 : Infinity;
  s.pathDistance = d;

  if (s.mode === MONSTER_MODE.WANDER && d <= settings.chaseDistance) {
    s.mode = MONSTER_MODE.CHASE;
  } else if (s.mode === MONSTER_MODE.CHASE
    && d > settings.chaseDistance + settings.chaseHysteresis) {
    s.mode = MONSTER_MODE.WANDER;
  }

  let target = null;
  if (s.mode === MONSTER_MODE.CHASE) {
    if (d >= 1) target = path[1];
  } else {
    target = wanderTarget(s, grid);
  }
  if (target === null) return;

  const offsetIndex = NEIGHBOR_OFFSETS.findIndex(
    (offset) => offset.dx === target.tx - s.tx && offset.dy === target.ty - s.ty,
  );
  const heading = HEADINGS_BY_OFFSET[offsetIndex];
  s.nextTx = target.tx;
  s.nextTy = target.ty;
  if (heading !== s.heading) {
    events.push(Object.freeze({
      type: MONSTER_EVENT.TURN,
      heading,
      pathDistance: d,
      x: s.tx + 0.5,
      y: s.ty + 0.5,
    }));
    s.heading = heading;
  }
}

/**
 * Tuile visée en errance (voir stepMonster, point 4) ; met à jour s.rngState en cas de
 * tirage.
 * @returns {{ tx: number, ty: number } | null}
 */
function wanderTarget(s, grid) {
  const floors = [];
  for (const offset of NEIGHBOR_OFFSETS) {
    const nx = s.tx + offset.dx;
    const ny = s.ty + offset.dy;
    if (!isWallTile(grid, nx, ny)) floors.push({ tx: nx, ty: ny });
  }
  let choices = floors.filter((tile) => tile.tx !== s.fromTx || tile.ty !== s.fromTy);
  if (choices.length === 0) choices = floors;
  if (choices.length === 0) return null;
  if (choices.length === 1) return choices[0];
  const r = createRng(s.rngState);
  const choice = randomInt(r, choices.length);
  s.rngState = randomInt(r, MAX_SEED + 1);
  return choices[choice];
}

/**
 * Indices des tuiles atteintes (index croissant) qui passent le filtre.
 * @param {Int32Array} dist
 * @param {(index: number) => boolean} keep
 * @returns {number[]}
 */
function reachedTiles(dist, keep) {
  const result = [];
  for (let index = 0; index < dist.length; index += 1) {
    if (dist[index] !== UNREACHABLE && keep(index)) result.push(index);
  }
  return result;
}

/**
 * Construit l'état gelé (ordre de clés fixe) et recalcule x, y.
 * @returns {MonsterState}
 */
function makeState(s) {
  const moving = s.nextTx !== null;
  return Object.freeze({
    tx: s.tx,
    ty: s.ty,
    nextTx: s.nextTx,
    nextTy: s.nextTy,
    fromTx: s.fromTx,
    fromTy: s.fromTy,
    progress: s.progress,
    x: s.tx + 0.5 + (moving ? (s.nextTx - s.tx) * s.progress : 0),
    y: s.ty + 0.5 + (moving ? (s.nextTy - s.ty) * s.progress : 0),
    mode: s.mode,
    heading: s.heading,
    pathDistance: s.pathDistance,
    graceRemaining: s.graceRemaining,
    rngState: s.rngState,
  });
}

function validateGrid(grid) {
  if (grid === null || typeof grid !== 'object') {
    throw new TypeError('grid must be an object');
  }
  const { width, height, tiles } = grid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new TypeError('grid must have integer width and height >= 1');
  }
  if (tiles === null || typeof tiles !== 'object' || tiles.length !== width * height) {
    throw new TypeError('grid must have tiles of length width * height');
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNullableInteger(value) {
  return value === null || Number.isInteger(value);
}

function validateMonster(monster, grid) {
  if (monster === null || typeof monster !== 'object') {
    throw new TypeError('monster must be an object');
  }
  const {
    tx, ty, nextTx, nextTy, fromTx, fromTy, progress, mode, heading, pathDistance,
    graceRemaining, rngState,
  } = monster;
  if (!Number.isInteger(tx) || !Number.isInteger(ty) || isWallTile(grid, tx, ty)) {
    throw new TypeError('monster tile must be a floor tile');
  }
  if (!isNullableInteger(nextTx) || !isNullableInteger(nextTy)
    || (nextTx === null) !== (nextTy === null)
    || (nextTx !== null && (isWallTile(grid, nextTx, nextTy)
      || Math.abs(nextTx - tx) + Math.abs(nextTy - ty) !== 1))) {
    throw new TypeError('monster next tile must be null or a neighbouring floor tile');
  }
  if (!isNullableInteger(fromTx) || !isNullableInteger(fromTy)
    || (fromTx === null) !== (fromTy === null)) {
    throw new TypeError('monster previous tile must be null or integers');
  }
  if (!isFiniteNumber(progress) || progress < 0 || progress >= 1
    || (nextTx === null && progress !== 0)) {
    throw new TypeError('monster progress must be in [0, 1) and 0 when stopped');
  }
  if (!Object.values(MONSTER_MODE).includes(mode)) {
    throw new TypeError('monster mode is invalid');
  }
  if (heading !== null && !Object.values(HEADING).includes(heading)) {
    throw new TypeError('monster heading is invalid');
  }
  if (typeof pathDistance !== 'number' || Number.isNaN(pathDistance) || pathDistance < 0) {
    throw new TypeError('monster pathDistance must be a number >= 0');
  }
  if (!isFiniteNumber(graceRemaining) || graceRemaining < 0) {
    throw new TypeError('monster graceRemaining must be a finite number >= 0');
  }
  if (!Number.isInteger(rngState) || rngState < 0 || rngState > MAX_SEED) {
    throw new TypeError('monster rngState must be an uint32');
  }
}

function validatePosition(position, name) {
  if (position === null || typeof position !== 'object'
    || !isFiniteNumber(position.x) || !isFiniteNumber(position.y)) {
    throw new TypeError(`${name} must have finite numeric x and y`);
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Fusionne la surcharge partielle avec MONSTER et la valide (clé inconnue ignorée).
 * @param {unknown} options
 * @returns {typeof MONSTER}
 * @throws {TypeError} options non objet
 * @throws {RangeError} valeur non finie ou négative
 */
function resolveSettings(options) {
  if (options === undefined) return MONSTER;
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  const settings = { ...MONSTER };
  for (const key of Object.keys(MONSTER)) {
    const value = options[key];
    if (value === undefined) continue;
    if (!isFiniteNumber(value) || value < 0) {
      throw new RangeError(`options.${key} must be a finite number >= 0`);
    }
    settings[key] = value;
  }
  return settings;
}
