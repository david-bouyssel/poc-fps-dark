import { generateMaze, MAZE_LIMITS } from './maze/maze.js';
import { MAX_SEED } from './maze/random.js';
import { toTileGrid } from './maze/grid.js';
import { createPlayer } from './game/player.js';
import { ACTION, actionForCode, computeIntent } from './game/input.js';
import { stepPlayer } from './game/movement.js';
import { createGameLoop } from './game/loop.js';
import { findExit } from './game/exit.js';
import {
  GAME_STATUS,
  checkVictory,
  createGameState,
  declareDefeat,
  isGameOver,
} from './game/game-state.js';
import { createMonster, isCatching, monsterSprite, stepMonster } from './game/monster.js';
import { drawMaze } from './render/canvas-renderer.js';
import { drawFpsView } from './render/fps-renderer.js';
import {
  AUTOMAP_MODE,
  createExploredMask,
  revealVisibleTiles,
} from './render/automap.js';
import { drawAutomap } from './render/automap-renderer.js';
import {
  MONSTER_FRAME_COUNT,
  MONSTER_FRAME_KINDS,
  generateMonsterSprite,
  monsterFrame,
  monsterFrameSprite,
} from './render/monster-sprite.js';
import { applyTranslations, t } from './i18n/i18n.js';

const DEFAULT_SIZE = 16;
const INTEGER_PATTERN = /^\d+$/;

const form = document.getElementById('maze-form');
const widthInput = document.getElementById('maze-width');
const heightInput = document.getElementById('maze-height');
const seedInput = document.getElementById('maze-seed');
const newMazeButton = document.getElementById('new-maze-button');
const infoElement = document.getElementById('maze-info');
const errorElement = document.getElementById('maze-error');
const canvas = document.getElementById('maze-canvas');
const fpsEnterButton = document.getElementById('fps-enter-button');
const fpsExitButton = document.getElementById('fps-exit-button');
const fpsHelp = document.getElementById('fps-help');
const fpsGoal = document.getElementById('fps-goal');
const endScreen = document.getElementById('end-screen');
const endTitle = document.getElementById('end-title');
const endMessage = document.getElementById('end-message');
const replayButton = document.getElementById('replay-button');
const endNewMazeButton = document.getElementById('end-new-maze-button');

const VIEW_TOP = 'top';
const VIEW_FPS = 'fps';

/** Labyrinthe actuellement affiché (conservé en cas d'erreur de saisie). */
let currentMaze = null;
/** Grille de tuiles du labyrinthe courant (vue FPS). */
let currentGrid = null;
/** Sortie du labyrinthe courant (Exit gelé) ; null avant la première génération. */
let currentExit = null;
/** État de la manche courante (GameState gelé) ; null avant la première génération. */
let gameState = null;
/** Joueur courant ; null tant qu'aucune entrée en FPS depuis la dernière génération. */
let player = null;
/** Monstre de la manche courante ; null hors manche. */
let monster = null;
/** Horloge d'animation de la mâchoire (s) : avance dans update(), remise à 0 par startRound(). */
let monsterClock = 0;
/** Images de la mâchoire : Map kind -> canvas hors écran (vide si la création a échoué). */
let monsterImages = new Map();
/** @type {'top' | 'fps'} */
let viewMode = VIEW_TOP;
/** Masque des tuiles explorées du labyrinthe courant (mutable) ; null avant génération. */
let explored = null;
/** Mode d'affichage de la carte en FPS. */
let mapMode = AUTOMAP_MODE.MINI;
/** Actions (valeurs de ACTION) actuellement enfoncées. */
const pressedActions = new Set();
let resizeFrame = 0;

const gameLoop = createGameLoop({
  update(dt) {
    if (isGameOver(gameState)) {
      return;
    }
    monsterClock += dt;
    player = stepPlayer(player, computeIntent(pressedActions), dt, currentGrid);
    revealVisibleTiles(explored, currentGrid, player);
    // Frame order: stepPlayer, checkVictory, then the monster only if the round goes on
    // (reaching the exit at the moment of contact is a victory).
    gameState = checkVictory(gameState, player, currentExit);
    if (!isGameOver(gameState)) {
      const step = stepMonster(monster, player, dt, currentGrid);
      monster = step.monster;
      if (isCatching(monster, player)) {
        gameState = declareDefeat(gameState);
      }
    }
    if (isGameOver(gameState)) {
      endRound();
    }
  },
  render() {
    drawFpsFrame();
  },
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
});

/**
 * Lit un entier positif ou nul depuis un champ texte.
 * @returns {number | null} null si la saisie n'est pas un entier décimal
 */
function readNonNegativeInteger(input) {
  const raw = input.value.trim();
  if (!INTEGER_PATTERN.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function isValidSize(value) {
  return value !== null && value >= MAZE_LIMITS.minSize && value <= MAZE_LIMITS.maxSize;
}

function randomSeed() {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0];
}

function showError(key, params) {
  errorElement.textContent = t(key, params);
}

function clearError() {
  errorElement.textContent = '';
}

/**
 * Images de la mâchoire du monstre (une par MONSTER_FRAME_KINDS), hors écran. Une image qui
 * ne peut être créée est omise : le monstre est alors invisible sur cette image, sans erreur.
 * @returns {Map<string, HTMLCanvasElement>}
 */
function buildMonsterImages() {
  const images = new Map();
  for (let frame = 0; frame < MONSTER_FRAME_COUNT; frame += 1) {
    try {
      const sprite = generateMonsterSprite(frame);
      const element = document.createElement('canvas');
      element.width = sprite.width;
      element.height = sprite.height;
      const context = element.getContext('2d');
      const imageData = context.createImageData(sprite.width, sprite.height);
      imageData.data.set(sprite.data);
      context.putImageData(imageData, 0, 0);
      images.set(MONSTER_FRAME_KINDS[frame], element);
    } catch {
      // No canvas support: this frame is simply not drawn.
    }
  }
  return images;
}

/** Dessine une image FPS (vue 3D puis automap) de la manche courante. */
function drawFpsFrame() {
  const frame = monsterFrame(monsterClock, monster.mode, monster.graceRemaining);
  drawFpsView(canvas, currentGrid, player, {
    exit: currentExit,
    sprites: [monsterFrameSprite(monsterSprite(monster), frame)],
    spriteImages: monsterImages,
  });
  drawAutomap(canvas, currentGrid, explored, player, mapMode, { exit: currentExit });
}

function render() {
  if (viewMode === VIEW_TOP && currentMaze) {
    drawMaze(canvas, currentMaze, { exit: currentExit });
  } else if (viewMode === VIEW_FPS && player !== null && !gameLoop.isRunning()) {
    // Round over: keep the last frame (and the mini-map) visible under the end screen.
    drawFpsFrame();
  }
}

function hideEndScreen() {
  endScreen.hidden = true;
}

/**
 * Valide la saisie puis génère et affiche un labyrinthe.
 * @param {{ forceRandomSeed: boolean }} options
 * @returns {boolean} true si un nouveau labyrinthe a été généré
 */
function generateFromForm({ forceRandomSeed }) {
  const width = readNonNegativeInteger(widthInput);
  const height = readNonNegativeInteger(heightInput);
  if (!isValidSize(width) || !isValidSize(height)) {
    showError('errors.size', { min: MAZE_LIMITS.minSize, max: MAZE_LIMITS.maxSize });
    return false;
  }

  let seed;
  if (forceRandomSeed || seedInput.value.trim() === '') {
    seed = randomSeed();
  } else {
    seed = readNonNegativeInteger(seedInput);
    if (seed === null || seed > MAX_SEED) {
      showError('errors.seed', { max: MAX_SEED });
      return false;
    }
  }

  let maze;
  let grid;
  let exit;
  try {
    maze = generateMaze({ width, height, seed });
    grid = toTileGrid(maze);
    exit = findExit(grid);
  } catch {
    showError('errors.generic');
    return false;
  }

  seedInput.value = String(seed);
  currentMaze = maze;
  currentGrid = grid;
  currentExit = exit;
  gameState = createGameState();
  player = null;
  monster = null;
  explored = createExploredMask(currentGrid);
  hideEndScreen();
  clearError();
  infoElement.textContent = t('info.current', {
    seed: maze.seed,
    width: maze.width,
    height: maze.height,
  });
  render();
  return true;
}

function onResize() {
  if (resizeFrame) {
    return;
  }
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    render();
  });
}

/**
 * Démarre une manche neuve sur le labyrinthe courant (même sortie) : joueur au départ,
 * monstre à son départ (déterministe par graine), exploration remise à zéro, partie en
 * cours, écran de fin masqué.
 * @returns {boolean} false si le joueur ou le monstre n'a pas pu être créé (erreur affichée)
 */
function startRound() {
  let nextPlayer;
  let nextMonster;
  try {
    nextPlayer = createPlayer(currentGrid);
    nextMonster = createMonster(currentGrid, currentMaze.seed, { exit: currentExit });
  } catch {
    showError('errors.generic');
    return false;
  }
  player = nextPlayer;
  monster = nextMonster;
  monsterClock = 0;
  explored = createExploredMask(currentGrid);
  gameState = createGameState();
  pressedActions.clear();
  hideEndScreen();
  return true;
}

/**
 * Termine la manche (victoire ou défaite) : boucle arrêtée, dernière image dessinée,
 * écran de fin affiché avec le focus sur « Rejouer ».
 */
function endRound() {
  gameLoop.stop();
  pressedActions.clear();
  mapMode = AUTOMAP_MODE.MINI;
  canvas.setAttribute('aria-label', t('canvas.labelFps'));
  drawFpsFrame();
  const won = gameState.status === GAME_STATUS.WON;
  endTitle.textContent = t(won ? 'end.wonTitle' : 'end.lostTitle');
  endMessage.textContent = t(won ? 'end.wonMessage' : 'end.lostMessage');
  endScreen.hidden = false;
  replayButton.focus();
}

/** « Rejouer » : manche neuve sur le même labyrinthe (même sortie). */
function replay() {
  if (viewMode !== VIEW_FPS || !startRound()) {
    return;
  }
  gameLoop.start();
  fpsExitButton.focus();
}

/** « Nouveau labyrinthe » de l'écran de fin : autre graine, on reste en FPS. */
function newMazeFromEndScreen() {
  if (viewMode !== VIEW_FPS) {
    return;
  }
  // On failure the error is shown and the end screen stays.
  if (!generateFromForm({ forceRandomSeed: true }) || !startRound()) {
    return;
  }
  gameLoop.start();
  fpsExitButton.focus();
}

/** Passe en vue à la première personne (labyrinthe courant, sans regénération). */
function enterFps() {
  if (viewMode === VIEW_FPS || !currentGrid) {
    return;
  }
  // A finished round is never resumed as is.
  if ((player === null || isGameOver(gameState)) && !startRound()) {
    return;
  }
  viewMode = VIEW_FPS;
  mapMode = AUTOMAP_MODE.MINI;
  form.hidden = true;
  fpsEnterButton.hidden = true;
  fpsExitButton.hidden = false;
  fpsHelp.hidden = false;
  fpsGoal.hidden = false;
  canvas.setAttribute('aria-label', t('canvas.labelFps'));
  pressedActions.clear();
  gameLoop.start();
  fpsEnterButton.blur();
  fpsExitButton.focus();
}

/** Revient à la vue de dessus ; la position du joueur est conservée. */
function exitFps() {
  if (viewMode !== VIEW_FPS) {
    return;
  }
  gameLoop.stop();
  pressedActions.clear();
  viewMode = VIEW_TOP;
  mapMode = AUTOMAP_MODE.MINI;
  form.hidden = false;
  fpsEnterButton.hidden = false;
  fpsExitButton.hidden = true;
  fpsHelp.hidden = true;
  fpsGoal.hidden = true;
  hideEndScreen();
  canvas.setAttribute('aria-label', t('canvas.label'));
  render();
  fpsEnterButton.focus();
}

/**
 * Traduit un appui clavier en action FPS (ignoré hors FPS ou avec Ctrl/Meta/Alt).
 * @param {KeyboardEvent} event
 * @returns {string | null} action liée, ou null si l'événement doit être ignoré
 */
function boundKeyDownAction(event) {
  if (viewMode !== VIEW_FPS || event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }
  return actionForCode(event.code);
}

/** Bascule mini-carte / carte plein écran et met à jour le libellé ARIA du canvas. */
function toggleMap() {
  const full = mapMode === AUTOMAP_MODE.MINI;
  mapMode = full ? AUTOMAP_MODE.FULL : AUTOMAP_MODE.MINI;
  canvas.setAttribute('aria-label', t(full ? 'canvas.labelFpsMap' : 'canvas.labelFps'));
}

function onKeyDown(event) {
  const action = boundKeyDownAction(event);
  if (action === null) {
    return;
  }
  // Round over: only Escape is handled; other keys keep their default behaviour
  // (Tab, Enter and Space stay usable on the end screen buttons).
  if (isGameOver(gameState) && action !== ACTION.EXIT) {
    return;
  }
  event.preventDefault();
  if (action === ACTION.EXIT) {
    exitFps();
    return;
  }
  if (action === ACTION.TOGGLE_MAP) {
    if (!event.repeat) {
      toggleMap();
    }
    return;
  }
  pressedActions.add(action);
}

/**
 * Release always removes the action, whatever the modifiers (avoids stuck keys when
 * Ctrl/Meta/Alt is pressed while walking). No preventDefault on release.
 * @param {KeyboardEvent} event
 */
function onKeyUp(event) {
  if (viewMode !== VIEW_FPS) {
    return;
  }
  const action = actionForCode(event.code);
  if (action !== null) {
    pressedActions.delete(action);
  }
}

function init() {
  applyTranslations(document);
  document.title = t('app.title');

  widthInput.value = String(DEFAULT_SIZE);
  heightInput.value = String(DEFAULT_SIZE);
  monsterImages = buildMonsterImages();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    generateFromForm({ forceRandomSeed: false });
  });
  newMazeButton.addEventListener('click', () => {
    generateFromForm({ forceRandomSeed: true });
  });
  window.addEventListener('resize', onResize);

  fpsEnterButton.addEventListener('click', enterFps);
  fpsExitButton.addEventListener('click', exitFps);
  replayButton.addEventListener('click', replay);
  endNewMazeButton.addEventListener('click', newMazeFromEndScreen);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    pressedActions.clear();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pressedActions.clear();
    }
  });

  generateFromForm({ forceRandomSeed: true });
}

init();
