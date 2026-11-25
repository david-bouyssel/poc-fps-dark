// Manche de jeu : état (joueur, monstre, statut, horloge, bilan) et pas d'une image.
// Logique pure : aucun DOM, aucune horloge, aucun audio, aucun hasard hors graine.
//
// Ordre d'une image (contrat, voir game-state.js) : rotation souris -> stepPlayer ->
// bilan -> checkVictory -> (seulement si la partie continue) stepMonster puis
// declareDefeat au contact. Atteindre la sortie au moment du contact est une victoire.

import { createPlayer } from './player.js';
import { stepPlayer } from './movement.js';
import { applyMouseTurn } from './mouse-look.js';
import { createMonster, isCatching, stepMonster } from './monster.js';
import {
  checkVictory,
  createGameState,
  declareDefeat,
  isGameOver,
} from './game-state.js';
import { advanceStats, createRoundStats } from './round-stats.js';
import { difficultySettings } from './difficulty.js';
import { dangerLevel } from './danger.js';

/**
 * @typedef {Object} Round  objet gelé, une manche
 * @property {object} grid      TileGrid de la manche (référence, non copiée)
 * @property {object} exit      Exit gelé (référence)
 * @property {object} settings  réglages de difficulté (monstre, brouillard), gelés
 * @property {object} player    Player gelé { x, y, angle }
 * @property {object} monster   MonsterState gelé
 * @property {object} state     GameState gelé { status }
 * @property {number} time      secondes de jeu de la manche (animation de la mâchoire), >= 0
 * @property {object} stats     RoundStats gelé (temps et distance du bilan)
 */

const NO_EVENTS = Object.freeze([]);

/**
 * @param {unknown} round
 * @throws {TypeError} manche mal formée
 */
function assertRound(round) {
  if (
    round === null
    || typeof round !== 'object'
    || round.state === null
    || typeof round.state !== 'object'
    || round.player === null
    || typeof round.player !== 'object'
    || round.monster === null
    || typeof round.monster !== 'object'
    || round.settings === null
    || typeof round.settings !== 'object'
    || typeof round.time !== 'number'
    || !Number.isFinite(round.time)
  ) {
    throw new TypeError('round must be a round');
  }
}

/**
 * Manche neuve : joueur au départ, monstre déterministe par graine, partie en cours,
 * horloge et bilan à zéro.
 * @param {{ grid: object, seed: number, exit: object, difficulty: string }} options
 * @returns {Readonly<Round>}
 * @throws {TypeError|RangeError|Error} comme difficultySettings / createPlayer / createMonster
 */
export function createRound({ grid, seed, exit, difficulty } = {}) {
  const settings = difficultySettings(difficulty);
  const player = createPlayer(grid);
  const monster = createMonster(grid, seed, { exit }, settings.monster);
  return Object.freeze({
    grid,
    exit,
    settings,
    player,
    monster,
    state: createGameState(),
    time: 0,
    stats: createRoundStats(),
  });
}

/**
 * Une image de jeu (ordre de l'en-tête du module).
 * @param {Round} round
 * @param {object} intent intention de déplacement (validée par stepPlayer)
 * @param {number} dt secondes
 * @param {number} [turn=0] rotation à la souris (rad) appliquée avant le déplacement
 * @returns {{ round: Readonly<Round>, events: readonly object[], monsterStepped: boolean, ended: boolean }}
 *   events : événements de stepMonster de ce pas ([] gelé si le monstre n'a pas bougé) ;
 *   monsterStepped : true si le monstre a avancé pendant ce pas ;
 *   ended : true seulement au pas où le statut devient final
 * @throws {TypeError} manche mal formée (et erreurs des fonctions composées)
 */
export function stepRound(round, intent, dt, turn = 0) {
  assertRound(round);
  if (isGameOver(round.state)) {
    return Object.freeze({ round, events: NO_EVENTS, monsterStepped: false, ended: false });
  }
  const time = round.time + dt;
  const turned = applyMouseTurn(round.player, turn);
  const player = stepPlayer(turned, intent, dt, round.grid);
  const stats = advanceStats(round.stats, dt, turned, player);
  let state = checkVictory(round.state, player, round.exit);
  let monster = round.monster;
  let events = NO_EVENTS;
  let monsterStepped = false;
  if (!isGameOver(state)) {
    const step = stepMonster(monster, player, dt, round.grid, round.settings.monster);
    monster = step.monster;
    events = step.events;
    monsterStepped = true;
    if (isCatching(monster, player)) {
      state = declareDefeat(state);
    }
  }
  const next = Object.freeze({ ...round, player, monster, state, time, stats });
  return Object.freeze({ round: next, events, monsterStepped, ended: isGameOver(state) });
}

/**
 * @param {Round} round
 * @returns {boolean} statut final (won ou lost)
 * @throws {TypeError} manche mal formée
 */
export function isRoundOver(round) {
  assertRound(round);
  return isGameOver(round.state);
}

/**
 * Niveau de danger de l'image : nul pendant le délai d'immobilité du monstre et une fois la
 * manche finie, sinon selon la distance de chemin au monstre.
 * @param {Round} round
 * @returns {number} 0..1
 * @throws {TypeError} manche mal formée
 */
export function roundDanger(round) {
  assertRound(round);
  if (round.monster.graceRemaining > 0 || isGameOver(round.state)) {
    return 0;
  }
  return dangerLevel(round.monster.pathDistance);
}
