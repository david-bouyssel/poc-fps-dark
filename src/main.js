import { generateMaze, MAZE_LIMITS } from './maze/maze.js';
import { MAX_SEED } from './maze/random.js';
import { toTileGrid } from './maze/grid.js';
import { createPlayer } from './game/player.js';
import { ACTION, actionForCode, computeIntent } from './game/input.js';
import {
  createTouchState,
  pressTouch,
  releaseTouch,
  touchActionFor,
  touchActions,
} from './game/touch-input.js';
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
import {
  PAUSE_REASON,
  canPause,
  createPauseState,
  isPaused,
  pauseGame,
  resumeGame,
} from './game/pause.js';
import { createMonster, isCatching, monsterSprite, stepMonster } from './game/monster.js';
import { dangerLevel } from './game/danger.js';
import {
  advanceStats,
  createRoundStats,
  exploredRatio,
  formatDistance,
  formatDuration,
} from './game/round-stats.js';
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
import { selectBongGain } from './audio/bong.js';
import { selectAlertGain, selectCryGain } from './audio/monster-cries.js';
import { createMonsterAudio } from './audio/monster-audio.js';

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
const soundToggleButton = document.getElementById('sound-toggle-button');
const fpsHelp = document.getElementById('fps-help');
const fpsHelpTouch = document.getElementById('fps-help-touch');
const touchPads = [
  document.getElementById('touch-pad-move'),
  document.getElementById('touch-pad-actions'),
];
const fpsGoal = document.getElementById('fps-goal');
const endScreen = document.getElementById('end-screen');
const endTitle = document.getElementById('end-title');
const endMessage = document.getElementById('end-message');
const replayButton = document.getElementById('replay-button');
const endNewMazeButton = document.getElementById('end-new-maze-button');
const endStatTime = document.getElementById('end-stat-time');
const endStatExplored = document.getElementById('end-stat-explored');
const endStatDistance = document.getElementById('end-stat-distance');
const pauseScreen = document.getElementById('pause-screen');
const pauseMessage = document.getElementById('pause-message');
const resumeButton = document.getElementById('resume-button');

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
/** État de pause de la manche (PauseState gelé) ; remis à zéro par startRound() et exitFps(). */
let pauseState = createPauseState();
/** Bilan de la manche courante (RoundStats gelé) : temps et distance, remis à zéro par startRound(). */
let roundStats = createRoundStats();
/** Actions (valeurs de ACTION) actuellement enfoncées. */
const pressedActions = new Set();
/** Doigts posés sur les boutons tactiles (TouchState gelé, remplacé à chaque changement). */
let touchState = createTouchState();
let resizeFrame = 0;

/**
 * Fabrique du contexte audio (seul accès à window.AudioContext du projet).
 * @returns {AudioContext | null} null si le navigateur n'a pas Web Audio
 */
function createAudioContext() {
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  return AudioContextClass ? new AudioContextClass() : null;
}

/** Lecteur des bongs du monstre ; contexte audio créé au premier « Explorer en 3D ». */
const monsterAudio = createMonsterAudio({ createContext: createAudioContext });

const gameLoop = createGameLoop({
  update(dt) {
    if (isGameOver(gameState)) {
      return;
    }
    monsterClock += dt;
    const previousPlayer = player;
    player = stepPlayer(player, computeIntent([...pressedActions, ...touchActions(touchState)]), dt, currentGrid);
    roundStats = advanceStats(roundStats, dt, previousPlayer, player);
    revealVisibleTiles(explored, currentGrid, player);
    // Frame order: stepPlayer, checkVictory, then the monster only if the round goes on
    // (reaching the exit at the moment of contact is a victory).
    gameState = checkVictory(gameState, player, currentExit);
    if (!isGameOver(gameState)) {
      const step = stepMonster(monster, player, dt, currentGrid);
      monster = step.monster;
      const bongGainValue = selectBongGain(step.events);
      if (bongGainValue > 0) {
        monsterAudio.play(bongGainValue);
      }
      const alertGainValue = selectAlertGain(step.events);
      if (alertGainValue > 0) {
        monsterAudio.playAlert(alertGainValue);
      }
      const cryGainValue = selectCryGain(step.events);
      if (cryGainValue > 0) {
        monsterAudio.playCry(cryGainValue);
      }
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

/**
 * Niveau de danger de l'image : nul pendant le délai d'immobilité du monstre et une fois la
 * manche finie (écran de fin), sinon selon la distance de chemin au monstre.
 * @returns {number} 0..1
 */
function currentDanger() {
  if (monster.graceRemaining > 0 || isGameOver(gameState)) {
    return 0;
  }
  return dangerLevel(monster.pathDistance);
}

/** Dessine une image FPS (vue 3D puis automap) de la manche courante. */
function drawFpsFrame() {
  const frame = monsterFrame(monsterClock, monster.mode, monster.graceRemaining);
  drawFpsView(canvas, currentGrid, player, {
    exit: currentExit,
    sprites: [monsterFrameSprite(monsterSprite(monster), frame)],
    spriteImages: monsterImages,
    danger: currentDanger(),
  });
  drawAutomap(canvas, currentGrid, explored, player, mapMode, { exit: currentExit });
}

function render() {
  if (viewMode === VIEW_TOP && currentMaze) {
    drawMaze(canvas, currentMaze, { exit: currentExit });
  } else if (viewMode === VIEW_FPS && player !== null && !gameLoop.isRunning()) {
    // Round over or paused: keep the last frame (and the map) visible under the overlay.
    drawFpsFrame();
  }
}

function hideEndScreen() {
  endScreen.hidden = true;
}

/** Sort de pause sans reprendre la boucle : état remis à zéro, écran de pause masqué. */
function clearPause() {
  pauseState = createPauseState();
  pauseScreen.hidden = true;
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
  roundStats = createRoundStats();
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
    showError('errors.round');
    return false;
  }
  player = nextPlayer;
  monster = nextMonster;
  monsterClock = 0;
  explored = createExploredMask(currentGrid);
  roundStats = createRoundStats();
  gameState = createGameState();
  clearHeldActions();
  hideEndScreen();
  clearPause();
  return true;
}

/**
 * Termine la manche (victoire ou défaite) : boucle arrêtée, dernière image dessinée,
 * écran de fin affiché avec le focus sur « Rejouer ».
 */
function endRound() {
  gameLoop.stop();
  // Defeat: the slurp plays over the end screen and cuts every other sound.
  if (gameState.status !== GAME_STATUS.LOST || !monsterAudio.playSlurp()) {
    monsterAudio.suspend();
  }
  clearHeldActions();
  mapMode = AUTOMAP_MODE.MINI;
  canvas.setAttribute('aria-label', t('canvas.labelFps'));
  drawFpsFrame();
  const won = gameState.status === GAME_STATUS.WON;
  endTitle.textContent = t(won ? 'end.wonTitle' : 'end.lostTitle');
  endMessage.textContent = t(won ? 'end.wonMessage' : 'end.lostMessage');
  endStatTime.textContent = t('end.statTime', { value: formatDuration(roundStats.elapsed) });
  endStatExplored.textContent = t('end.statExplored', {
    value: exploredRatio(explored, currentGrid),
  });
  endStatDistance.textContent = t('end.statDistance', {
    value: formatDistance(roundStats.distance),
  });
  endScreen.hidden = false;
  replayButton.focus();
}

/**
 * Met la manche en pause (FPS, partie en cours, pas déjà en pause) : boucle arrêtée,
 * sons suspendus, dernière image dessinée (mode de carte conservé), écran de pause affiché.
 * @param {string} reason valeur de PAUSE_REASON
 */
function pauseRound(reason) {
  if (viewMode !== VIEW_FPS || !canPause(pauseState, gameState)) {
    return;
  }
  pauseState = pauseGame(pauseState, reason);
  gameLoop.stop();
  monsterAudio.suspend();
  clearHeldActions();
  drawFpsFrame();
  const messageKey = reason === PAUSE_REASON.MANUAL ? 'pause.message' : 'pause.messageAuto';
  pauseMessage.textContent = t(messageKey);
  pauseScreen.hidden = false;
  resumeButton.focus();
}

/**
 * Reprend la manche en pause. La boucle repart par start() : le premier dt vaut 0, la durée
 * de la pause n'est jamais intégrée.
 */
function resumeRound() {
  if (viewMode !== VIEW_FPS || !isPaused(pauseState)) {
    return;
  }
  pauseState = resumeGame(pauseState);
  pauseScreen.hidden = true;
  clearHeldActions();
  monsterAudio.resume();
  gameLoop.start();
  fpsExitButton.focus();
}

/** « Rejouer » : manche neuve sur le même labyrinthe (même sortie). */
function replay() {
  if (viewMode !== VIEW_FPS || !startRound()) {
    return;
  }
  monsterAudio.resume();
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
  monsterAudio.resume();
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
  soundToggleButton.hidden = false;
  fpsHelp.hidden = false;
  fpsHelpTouch.hidden = false;
  setTouchPadsHidden(false);
  document.body.classList.add('fps-active');
  fpsGoal.hidden = false;
  canvas.setAttribute('aria-label', t('canvas.labelFps'));
  clearHeldActions();
  // First call creates the audio context, inside the click gesture (autoplay policy).
  monsterAudio.resume();
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
  monsterAudio.suspend();
  clearHeldActions();
  viewMode = VIEW_TOP;
  mapMode = AUTOMAP_MODE.MINI;
  form.hidden = false;
  fpsEnterButton.hidden = false;
  fpsExitButton.hidden = true;
  soundToggleButton.hidden = true;
  fpsHelp.hidden = true;
  fpsHelpTouch.hidden = true;
  setTouchPadsHidden(true);
  document.body.classList.remove('fps-active');
  fpsGoal.hidden = true;
  hideEndScreen();
  clearPause();
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

/**
 * Coupe ou rétablit le son du monstre (état conservé entre parties et vues).
 * Le libellé et aria-pressed suivent l'état : pressé = son coupé.
 */
function toggleSound() {
  monsterAudio.setMuted(!monsterAudio.isMuted());
  const muted = monsterAudio.isMuted();
  soundToggleButton.textContent = t(muted ? 'sound.unmute' : 'sound.mute');
  soundToggleButton.setAttribute('aria-pressed', String(muted));
}

/** Relâche toutes les actions maintenues (clavier et tactile). */
function clearHeldActions() {
  pressedActions.clear();
  touchState = createTouchState();
  for (const button of document.querySelectorAll('.touch-button.is-pressed')) {
    button.classList.remove('is-pressed');
  }
}

function setTouchPadsHidden(hidden) {
  for (const pad of touchPads) {
    pad.hidden = hidden;
  }
}

/** Bouton tactile (avec data-action reconnu) sous la cible d'un événement, sinon null. */
function touchButtonOf(event) {
  const button = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  return button !== null && touchActionFor(button.dataset.action) !== null ? button : null;
}

function onTouchPointerDown(event) {
  const button = touchButtonOf(event);
  if (button === null || viewMode !== VIEW_FPS || isGameOver(gameState)) {
    return;
  }
  const action = touchActionFor(button.dataset.action);
  // Paused: only the pause button (resume) is handled.
  if (isPaused(pauseState) && action !== ACTION.PAUSE) {
    return;
  }
  event.preventDefault();
  try {
    button.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic or already released pointer: capture is optional.
  }
  if (action === ACTION.PAUSE) {
    if (isPaused(pauseState)) {
      resumeRound();
    } else {
      pauseRound(PAUSE_REASON.MANUAL);
    }
    return;
  }
  if (action === ACTION.TOGGLE_MAP) {
    toggleMap();
    return;
  }
  touchState = pressTouch(touchState, event.pointerId, action);
  button.classList.add('is-pressed');
}

function onTouchPointerEnd(event) {
  touchState = releaseTouch(touchState, event.pointerId);
  const button = touchButtonOf(event);
  if (button !== null) {
    button.classList.remove('is-pressed');
  }
}

/** Touches traitées pendant la pause : action -> gestionnaire (event). */
const PAUSED_KEY_HANDLERS = Object.freeze({
  [ACTION.PAUSE]: (event) => {
    if (!event.repeat) {
      resumeRound();
    }
  },
  [ACTION.EXIT]: () => exitFps(),
  [ACTION.TOGGLE_SOUND]: (event) => {
    if (!event.repeat) {
      toggleSound();
    }
  },
});

function onKeyDown(event) {
  const action = boundKeyDownAction(event);
  if (action === null) {
    return;
  }
  // Round over: only Escape and the sound key are handled; other keys keep their default
  // behaviour (Tab, Enter and Space stay usable on the end screen buttons).
  if (isGameOver(gameState) && action !== ACTION.EXIT && action !== ACTION.TOGGLE_SOUND) {
    return;
  }
  // Paused: only the keys of PAUSED_KEY_HANDLERS are handled; others keep their default
  // behaviour (Tab, Enter and Space stay usable on « Reprendre ») and are not held.
  if (isPaused(pauseState)) {
    const handler = PAUSED_KEY_HANDLERS[action];
    if (handler !== undefined) {
      event.preventDefault();
      handler(event);
    }
    return;
  }
  event.preventDefault();
  if (action === ACTION.EXIT) {
    exitFps();
    return;
  }
  if (action === ACTION.PAUSE) {
    if (!event.repeat) {
      pauseRound(PAUSE_REASON.MANUAL);
    }
    return;
  }
  if (action === ACTION.TOGGLE_MAP) {
    if (!event.repeat) {
      toggleMap();
    }
    return;
  }
  if (action === ACTION.TOGGLE_SOUND) {
    if (!event.repeat) {
      toggleSound();
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

  widthInput.min = heightInput.min = String(MAZE_LIMITS.minSize);
  widthInput.max = heightInput.max = String(MAZE_LIMITS.maxSize);
  seedInput.min = '0';
  seedInput.max = String(MAX_SEED);

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
  soundToggleButton.addEventListener('click', toggleSound);
  replayButton.addEventListener('click', replay);
  endNewMazeButton.addEventListener('click', newMazeFromEndScreen);
  resumeButton.addEventListener('click', resumeRound);
  for (const pad of touchPads) {
    pad.addEventListener('pointerdown', onTouchPointerDown);
    pad.addEventListener('pointerup', onTouchPointerEnd);
    pad.addEventListener('pointercancel', onTouchPointerEnd);
    pad.addEventListener('lostpointercapture', onTouchPointerEnd);
    pad.addEventListener('contextmenu', (event) => event.preventDefault());
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => {
    clearHeldActions();
    pauseRound(PAUSE_REASON.BLUR);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearHeldActions();
      monsterAudio.suspend();
      pauseRound(PAUSE_REASON.HIDDEN);
    } else if (viewMode === VIEW_FPS && !isGameOver(gameState) && !isPaused(pauseState)) {
      // Context already unlocked by the initial gesture; never created here outside FPS.
      // Paused: nothing restarts, the resume is always explicit.
      monsterAudio.resume();
    }
  });

  generateFromForm({ forceRandomSeed: true });
}

init();
