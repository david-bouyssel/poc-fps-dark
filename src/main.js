import { generateMaze, MAZE_LIMITS } from './maze/maze.js';
import { MAX_SEED } from './maze/random.js';
import { toTileGrid } from './maze/grid.js';
import { createPlayer } from './game/player.js';
import { ACTION, actionForCode, computeIntent } from './game/input.js';
import { stepPlayer } from './game/movement.js';
import { createGameLoop } from './game/loop.js';
import { drawMaze } from './render/canvas-renderer.js';
import { drawFpsView } from './render/fps-renderer.js';
import {
  AUTOMAP_MODE,
  createExploredMask,
  revealVisibleTiles,
} from './render/automap.js';
import { drawAutomap } from './render/automap-renderer.js';
import {
  FRUIT_TABLE,
  collectFruits,
  createFruitState,
  placeFruits,
} from './game/fruits.js';
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
const fpsHud = document.getElementById('fps-hud');
const fpsScore = document.getElementById('fps-score');
const fpsAllCollected = document.getElementById('fps-all-collected');
const fpsFruitLegend = document.getElementById('fps-fruit-legend');

const VIEW_TOP = 'top';
const VIEW_FPS = 'fps';

/** Labyrinthe actuellement affiché (conservé en cas d'erreur de saisie). */
let currentMaze = null;
/** Grille de tuiles du labyrinthe courant (vue FPS). */
let currentGrid = null;
/** Joueur courant ; null tant qu'aucune entrée en FPS depuis la dernière génération. */
let player = null;
/** @type {'top' | 'fps'} */
let viewMode = VIEW_TOP;
/** Masque des tuiles explorées du labyrinthe courant (mutable) ; null avant génération. */
let explored = null;
/** Mode d'affichage de la carte en FPS. */
let mapMode = AUTOMAP_MODE.MINI;
/** Fruits restants et score du labyrinthe courant ; null avant génération. */
let fruitState = null;
/** Actions (valeurs de ACTION) actuellement enfoncées. */
const pressedActions = new Set();
let resizeFrame = 0;

const gameLoop = createGameLoop({
  update(dt) {
    player = stepPlayer(player, computeIntent(pressedActions), dt, currentGrid);
    revealVisibleTiles(explored, currentGrid, player);
    const next = collectFruits(fruitState, player);
    if (next !== fruitState) {
      fruitState = next;
      updateHud();
    }
  },
  render() {
    drawFpsView(canvas, currentGrid, player, { sprites: fruitState.fruits });
    drawAutomap(canvas, currentGrid, explored, player, mapMode);
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

/** Met à jour le texte du score (appelé seulement quand l'état change). */
function updateScoreText() {
  if (fruitState === null) {
    return;
  }
  fpsScore.textContent = t('fps.score', {
    score: fruitState.score,
    collected: fruitState.collected,
    total: fruitState.total,
  });
  fpsAllCollected.hidden = fruitState.collected !== fruitState.total;
}

/** Affiche le HUD seulement en FPS et hors carte plein écran. */
function updateHudVisibility() {
  fpsHud.hidden = viewMode !== VIEW_FPS || mapMode === AUTOMAP_MODE.FULL;
}

function updateHud() {
  updateScoreText();
  updateHudVisibility();
}

/** Construit une fois la légende « espèce : points » à partir de FRUIT_TABLE. */
function buildFruitLegend() {
  fpsFruitLegend.textContent = FRUIT_TABLE.map((entry) =>
    t('fps.fruitPoints', { name: t(`fruit.${entry.kind}`), points: entry.points }),
  ).join(t('fps.legendSeparator'));
}

function render() {
  if (viewMode === VIEW_TOP && currentMaze) {
    drawMaze(canvas, currentMaze);
  }
}

/**
 * Valide la saisie puis génère et affiche un labyrinthe.
 * @param {{ forceRandomSeed: boolean }} options
 */
function generateFromForm({ forceRandomSeed }) {
  const width = readNonNegativeInteger(widthInput);
  const height = readNonNegativeInteger(heightInput);
  if (!isValidSize(width) || !isValidSize(height)) {
    showError('errors.size', { min: MAZE_LIMITS.minSize, max: MAZE_LIMITS.maxSize });
    return;
  }

  let seed;
  if (forceRandomSeed || seedInput.value.trim() === '') {
    seed = randomSeed();
  } else {
    seed = readNonNegativeInteger(seedInput);
    if (seed === null || seed > MAX_SEED) {
      showError('errors.seed', { max: MAX_SEED });
      return;
    }
  }

  let maze;
  let fruits;
  try {
    maze = generateMaze({ width, height, seed });
    fruits = placeFruits(maze);
  } catch {
    showError('errors.generic');
    return;
  }

  seedInput.value = String(seed);
  currentMaze = maze;
  currentGrid = toTileGrid(maze);
  player = null;
  explored = createExploredMask(currentGrid);
  fruitState = createFruitState(fruits);
  updateHud();
  clearError();
  infoElement.textContent = t('info.current', {
    seed: maze.seed,
    width: maze.width,
    height: maze.height,
  });
  render();
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

/** Passe en vue à la première personne (labyrinthe courant, sans regénération). */
function enterFps() {
  if (viewMode === VIEW_FPS || !currentGrid) {
    return;
  }
  if (player === null) {
    try {
      player = createPlayer(currentGrid);
    } catch {
      showError('errors.generic');
      return;
    }
  }
  viewMode = VIEW_FPS;
  mapMode = AUTOMAP_MODE.MINI;
  form.hidden = true;
  fpsEnterButton.hidden = true;
  fpsExitButton.hidden = false;
  fpsHelp.hidden = false;
  updateHud();
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
  updateHud();
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
  updateHudVisibility();
}

function onKeyDown(event) {
  const action = boundKeyDownAction(event);
  if (action === null) {
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
  buildFruitLegend();
  document.title = t('app.title');

  widthInput.value = String(DEFAULT_SIZE);
  heightInput.value = String(DEFAULT_SIZE);

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
