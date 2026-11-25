import { generateMaze, MAZE_LIMITS } from './maze/maze.js';
import { MAX_SEED } from './maze/random.js';
import { toTileGrid } from './maze/grid.js';
import { ACTION, actionForCode, computeIntent } from './game/input.js';
import {
  createTouchState,
  pressTouch,
  releaseTouch,
  touchActionFor,
  touchActions,
} from './game/touch-input.js';
import { accumulateTurn, mouseTurnDelta } from './game/mouse-look.js';
import { createGameLoop } from './game/loop.js';
import { columnWidthFor, createRenderQuality, stepRenderQuality } from './game/render-quality.js';
import { findExit } from './game/exit.js';
import { GAME_STATUS } from './game/game-state.js';
import { createRound, isRoundOver, roundDanger, stepRound } from './game/round.js';
import {
  PAUSE_REASON,
  canPause,
  createPauseState,
  isPaused,
  pauseGame,
  resumeGame,
} from './game/pause.js';
import { MONSTER_EVENT, monsterSprite } from './game/monster.js';
import { DEFAULT_DIFFICULTY, DIFFICULTY_IDS, isDifficulty } from './game/difficulty.js';
import { buildShareUrl, parseNonNegativeInteger, parseShareParams, SHARE_STATUS } from './game/share-link.js';
import { exploredRatio, formatDistance, formatDuration } from './game/round-stats.js';
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
import {
  CAPTION_KIND_KEY,
  CAPTION_SIDE_KEY,
  createCaptionState,
  stepCaptions,
} from './audio/sound-captions.js';

const DEFAULT_SIZE = 16;

const form = document.getElementById('maze-form');
const widthInput = document.getElementById('maze-width');
const heightInput = document.getElementById('maze-height');
const seedInput = document.getElementById('maze-seed');
const difficultySelect = document.getElementById('maze-difficulty');
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
const roundStatus = document.getElementById('round-status');
const soundCaptions = document.getElementById('sound-captions');
const sharePanel = document.getElementById('share-panel');
const shareLinkInput = document.getElementById('share-link');
const shareCopyButton = document.getElementById('share-copy-button');
const shareStatus = document.getElementById('share-status');

const VIEW_TOP = 'top';
const VIEW_FPS = 'fps';

/** Labyrinthe actuellement affiché (conservé en cas d'erreur de saisie). */
let currentMaze = null;
/** Grille de tuiles du labyrinthe courant (vue FPS). */
let currentGrid = null;
/** Sortie du labyrinthe courant (Exit gelé) ; null avant la première génération. */
let currentExit = null;
/**
 * Manche courante (Round gelé de ./game/round.js : joueur, monstre, statut, horloge, bilan,
 * réglages de difficulté) ; null après une génération et avant la première entrée en FPS.
 */
let round = null;
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
/** Qualité de rendu adaptative (RenderQuality gelé) : largeur de colonne selon le temps d'image ; remise à zéro par startRound() et enterFps(). */
let renderQuality = createRenderQuality();
/** Actions (valeurs de ACTION) actuellement enfoncées. */
const pressedActions = new Set();
/** Image d'annonce en attente (requestAnimationFrame) ; 0 si aucune. */
let pendingAnnounceFrame = 0;
/** Doigts posés sur les boutons tactiles (TouchState gelé, remplacé à chaque changement). */
let touchState = createTouchState();
/** Rotation à la souris (rad) cumulée depuis la dernière image ; vidée par clearHeldActions(). */
let pendingMouseTurn = 0;
/** Légendes des sons visibles (CaptionState gelé) ; vidées par clearCaptions(). */
let captionState = createCaptionState();
/** Clé de la dernière liste de légendes dessinée (évite de reconstruire le DOM à chaque image). */
let renderedCaptionKey = '';
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
    if (isRoundOver(round)) {
      return;
    }
    renderQuality = stepRenderQuality(renderQuality, dt);
    // Game logic of the frame lives in stepRound: mouse turn (before the move, so this
    // frame's move follows it), stepPlayer, checkVictory, then the monster only if the
    // round goes on (reaching the exit at the moment of contact is a victory).
    // Only DOM and audio effects stay here.
    const intent = computeIntent([...pressedActions, ...touchActions(touchState)]);
    const step = stepRound(round, intent, dt, pendingMouseTurn);
    pendingMouseTurn = 0;
    round = step.round;
    const { player } = round;
    // The exploration mask only feeds the automap: revealed from the new position.
    revealVisibleTiles(explored, currentGrid, player);
    if (step.monsterStepped) {
      // One HUNT per switch from wander to chase: one announcement per hunt.
      if (step.events.some((event) => event.type === MONSTER_EVENT.HUNT)) {
        announce(t('round.huntAnnouncement'));
      }
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
      // Captions follow the monster events, not the audio player: shown even when muted.
      captionState = stepCaptions(captionState, step.events, player, dt);
      renderSoundCaptions();
    }
    if (step.ended) {
      endRound();
    }
  },
  render() {
    drawFpsFrame();
  },
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
});

function isValidSize(value) {
  return value !== null && value >= MAZE_LIMITS.minSize && value <= MAZE_LIMITS.maxSize;
}

function randomSeed() {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0];
}

/**
 * Niveau choisi dans le formulaire : la valeur du <select> si c'est un niveau connu, sinon
 * DEFAULT_DIFFICULTY. Ne lève jamais.
 * @returns {string} valeur de DIFFICULTY
 */
function readDifficulty() {
  const value = difficultySelect.value;
  return isDifficulty(value) ? value : DEFAULT_DIFFICULTY;
}

function showError(key, params) {
  errorElement.textContent = t(key, params);
}

function clearError() {
  errorElement.textContent = '';
}

/**
 * Difficulté écrite dans le lien : null pour le niveau par défaut (lien plus court, même
 * partie puisqu'un `d` absent donne le niveau par défaut).
 * @returns {string | null}
 */
function shareDifficulty() {
  const difficulty = readDifficulty();
  return difficulty === DEFAULT_DIFFICULTY ? null : difficulty;
}

/**
 * Met à jour le lien de la partie courante (labyrinthe généré + difficulté choisie) et vide
 * le statut de copie. Si le lien ne peut être construit, le panneau est masqué, sans erreur.
 */
function updateShareLink() {
  shareStatus.textContent = '';
  if (currentMaze === null) {
    return;
  }
  try {
    shareLinkInput.value = buildShareUrl(location.href, {
      width: currentMaze.width,
      height: currentMaze.height,
      seed: currentMaze.seed,
      difficulty: shareDifficulty(),
    });
    sharePanel.hidden = viewMode !== VIEW_TOP;
  } catch {
    shareLinkInput.value = '';
    sharePanel.hidden = true;
  }
}

/** Repli de copie : lien sélectionné, l'utilisateur le copie lui-même. */
function selectShareLinkForManualCopy() {
  try {
    shareLinkInput.focus();
    shareLinkInput.select();
  } catch {
    // Selection unavailable: the manual-copy message is shown anyway.
  }
  shareStatus.textContent = t('share.copyManual');
}

/** Clic sur « Copier le lien » : écriture seule dans le presse-papiers, repli par sélection. */
function copyShareLink() {
  const link = shareLinkInput.value;
  if (link === '') {
    return;
  }
  let pending;
  try {
    const clipboard = window.isSecureContext === true ? navigator.clipboard : undefined;
    if (typeof clipboard?.writeText !== 'function') {
      selectShareLinkForManualCopy();
      return;
    }
    pending = clipboard.writeText(link);
  } catch {
    selectShareLinkForManualCopy();
    return;
  }
  Promise.resolve(pending).then(
    () => {
      shareStatus.textContent = t('share.copied');
    },
    () => {
      selectShareLinkForManualCopy();
    },
  );
}

/** Remet la taille et la graine du formulaire aux valeurs par défaut. */
function resetFormDefaults() {
  widthInput.value = String(DEFAULT_SIZE);
  heightInput.value = String(DEFAULT_SIZE);
  seedInput.value = '';
}

/**
 * Génération initiale : labyrinthe du lien partagé (?seed=&w=&h=&d=) s'il est valide,
 * labyrinthe aléatoire sinon. Lien invalide : message fixe, jamais la valeur reçue.
 */
function generateInitialMaze() {
  let shared;
  try {
    // No location (non-browser host): same as a page opened without a query.
    const search = typeof location === 'undefined' ? '' : location.search;
    shared = parseShareParams(search, { difficulties: DIFFICULTY_IDS });
  } catch {
    shared = { status: SHARE_STATUS.INVALID };
  }
  if (shared.status === SHARE_STATUS.ABSENT) {
    generateFromForm({ forceRandomSeed: true });
    return;
  }
  if (shared.status === SHARE_STATUS.VALID) {
    widthInput.value = String(shared.width ?? DEFAULT_SIZE);
    heightInput.value = String(shared.height ?? DEFAULT_SIZE);
    seedInput.value = shared.seed === null ? '' : String(shared.seed);
    if (shared.difficulty !== null && isDifficulty(shared.difficulty)) {
      difficultySelect.value = shared.difficulty;
    }
    if (generateFromForm({ forceRandomSeed: false })) {
      return;
    }
  }
  resetFormDefaults();
  difficultySelect.value = DEFAULT_DIFFICULTY;
  generateFromForm({ forceRandomSeed: true });
  showError('errors.sharedLink');
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

/** @returns {boolean} vrai si une manche existe et qu'elle est finie (victoire ou défaite) */
function isCurrentRoundOver() {
  return round !== null && isRoundOver(round);
}

/** Dessine une image FPS (vue 3D puis automap) de la manche courante. */
function drawFpsFrame() {
  const { player, monster } = round;
  const frame = monsterFrame(round.time, monster.mode, monster.graceRemaining);
  drawFpsView(canvas, currentGrid, player, {
    exit: currentExit,
    sprites: [monsterFrameSprite(monsterSprite(monster), frame)],
    spriteImages: monsterImages,
    // Danger: none during the monster's grace delay and once the round is over.
    danger: roundDanger(round),
    fogDistance: round.settings.fogDistance,
    columnWidth: columnWidthFor(renderQuality),
  });
  drawAutomap(canvas, currentGrid, explored, player, mapMode, { exit: currentExit });
}

function render() {
  if (viewMode === VIEW_TOP && currentMaze) {
    drawMaze(canvas, currentMaze, { exit: currentExit });
  } else if (viewMode === VIEW_FPS && round !== null && !gameLoop.isRunning()) {
    // Round over or paused: keep the last frame (and the map) visible under the overlay.
    drawFpsFrame();
  }
}

function hideEndScreen() {
  endScreen.hidden = true;
}

/**
 * Vide la zone d'annonce (lecteur d'écran) et annule une écriture en attente.
 * Sans effet visuel : la zone est `sr-only`.
 */
function clearRoundStatus() {
  if (pendingAnnounceFrame) {
    cancelAnimationFrame(pendingAnnounceFrame);
    pendingAnnounceFrame = 0;
  }
  roundStatus.textContent = '';
}

/**
 * Annonce un texte à l'écran de lecture : la zone est vidée puis réécrite à l'image suivante,
 * pour que la même phrase soit relue à chaque annonce.
 * @param {string} text
 */
function announce(text) {
  clearRoundStatus();
  pendingAnnounceFrame = requestAnimationFrame(() => {
    pendingAnnounceFrame = 0;
    roundStatus.textContent = text;
  });
}

/**
 * Vide les légendes des sons (état remis à zéro) et masque leur zone.
 */
function clearCaptions() {
  captionState = createCaptionState();
  renderSoundCaptions();
}

/**
 * Dessine les légendes courantes : une ligne par légende, texte par textContent (libellés
 * de fr.js). Zone masquée hors FPS ou sans légende. Ne reconstruit rien si rien ne change.
 */
function renderSoundCaptions() {
  const lines = viewMode === VIEW_FPS ? captionState.lines : [];
  const key = lines.map((line) => `${line.kind}:${line.side}`).join('|');
  if (key !== renderedCaptionKey) {
    renderedCaptionKey = key;
    soundCaptions.replaceChildren(...lines.map((line) => {
      const element = document.createElement('p');
      element.className = `caption caption-${line.side}`;
      element.textContent = `${t(CAPTION_KIND_KEY[line.kind])} ${t(CAPTION_SIDE_KEY[line.side])}`;
      return element;
    }));
  }
  soundCaptions.hidden = lines.length === 0;
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
  const width = parseNonNegativeInteger(widthInput.value);
  const height = parseNonNegativeInteger(heightInput.value);
  if (!isValidSize(width) || !isValidSize(height)) {
    showError('errors.size', { min: MAZE_LIMITS.minSize, max: MAZE_LIMITS.maxSize });
    return false;
  }

  let seed;
  if (forceRandomSeed || seedInput.value.trim() === '') {
    seed = randomSeed();
  } else {
    seed = parseNonNegativeInteger(seedInput.value);
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
  round = null;
  explored = createExploredMask(currentGrid);
  hideEndScreen();
  clearRoundStatus();
  clearError();
  infoElement.textContent = t('info.current', {
    seed: maze.seed,
    width: maze.width,
    height: maze.height,
  });
  updateShareLink();
  render();
  return true;
}

/**
 * Changement de niveau en vue de dessus : la manche en cours est abandonnée (comme après
 * « Générer »), le labyrinthe, la graine et la sortie restent. Le prochain « Explorer en 3D »
 * démarre une manche neuve au nouveau niveau. Un changement forgé en FPS est ignoré.
 */
function onDifficultyChange() {
  if (viewMode !== VIEW_TOP || round === null || currentGrid === null) {
    return;
  }
  round = null;
  explored = createExploredMask(currentGrid);
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
  let nextRound;
  try {
    nextRound = createRound({
      grid: currentGrid,
      seed: currentMaze.seed,
      exit: currentExit,
      difficulty: readDifficulty(),
    });
  } catch {
    showError('errors.round');
    return false;
  }
  round = nextRound;
  explored = createExploredMask(currentGrid);
  renderQuality = createRenderQuality();
  clearHeldActions();
  hideEndScreen();
  clearPause();
  clearRoundStatus();
  clearCaptions();
  return true;
}

/**
 * Termine la manche (victoire ou défaite) : boucle arrêtée, dernière image dessinée,
 * écran de fin affiché avec le focus sur « Rejouer ».
 */
function endRound() {
  gameLoop.stop();
  // Defeat: the slurp plays over the end screen and cuts every other sound.
  if (round.state.status !== GAME_STATUS.LOST || !monsterAudio.playSlurp()) {
    monsterAudio.suspend();
  }
  clearHeldActions();
  mapMode = AUTOMAP_MODE.MINI;
  canvas.setAttribute('aria-label', t('canvas.labelFps'));
  drawFpsFrame();
  const won = round.state.status === GAME_STATUS.WON;
  endTitle.textContent = t(won ? 'end.wonTitle' : 'end.lostTitle');
  endMessage.textContent = t(won ? 'end.wonMessage' : 'end.lostMessage');
  endStatTime.textContent = t('end.statTime', { value: formatDuration(round.stats.elapsed) });
  endStatExplored.textContent = t('end.statExplored', {
    value: exploredRatio(explored, currentGrid),
  });
  endStatDistance.textContent = t('end.statDistance', {
    value: formatDistance(round.stats.distance),
  });
  clearRoundStatus();
  clearCaptions();
  endScreen.hidden = false;
  // State already over: the pointerlockchange that follows does nothing.
  releasePointerLock();
  replayButton.focus();
}

/**
 * Met la manche en pause (FPS, partie en cours, pas déjà en pause) : boucle arrêtée,
 * sons suspendus, dernière image dessinée (mode de carte conservé), écran de pause affiché.
 * @param {string} reason valeur de PAUSE_REASON
 */
function pauseRound(reason) {
  if (viewMode !== VIEW_FPS || round === null || !canPause(pauseState, round.state)) {
    return;
  }
  pauseState = pauseGame(pauseState, reason);
  // State already paused: the pointerlockchange that follows does nothing.
  releasePointerLock();
  gameLoop.stop();
  monsterAudio.suspend();
  clearHeldActions();
  clearCaptions();
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
  if ((round === null || isRoundOver(round)) && !startRound()) {
    return;
  }
  viewMode = VIEW_FPS;
  renderQuality = createRenderQuality();
  mapMode = AUTOMAP_MODE.MINI;
  form.hidden = true;
  sharePanel.hidden = true;
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
  // View already top: the pointerlockchange that follows does nothing.
  releasePointerLock();
  mapMode = AUTOMAP_MODE.MINI;
  form.hidden = false;
  sharePanel.hidden = shareLinkInput.value === '';
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
  clearRoundStatus();
  clearCaptions();
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

/** Relâche toutes les actions maintenues (clavier, tactile et rotation souris en attente). */
function clearHeldActions() {
  pressedActions.clear();
  touchState = createTouchState();
  pendingMouseTurn = 0;
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
  if (button === null || viewMode !== VIEW_FPS || isCurrentRoundOver()) {
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

/** @returns {boolean} vrai si le canvas détient le verrou du pointeur */
function isPointerLocked() {
  return document.pointerLockElement === canvas;
}

/** Peut-on tourner à la souris ? FPS, partie en cours et hors pause. */
function isMouseLookActive() {
  return viewMode === VIEW_FPS && !isCurrentRoundOver() && !isPaused(pauseState);
}

/** Libère le verrou du pointeur s'il est tenu par le canvas (sans effet sinon, ne lève jamais). */
function releasePointerLock() {
  if (typeof document.exitPointerLock !== 'function' || !isPointerLocked()) {
    return;
  }
  try {
    document.exitPointerLock();
  } catch {
    // Release refused: nothing else to do.
  }
}

/**
 * Clic sur le canvas : prend le verrou du pointeur (FPS, partie en cours, hors pause, souris).
 * Un refus du navigateur est silencieux : le clavier reste complet.
 * @param {MouseEvent} event
 */
function onCanvasClick(event) {
  if (
    !isMouseLookActive()
    || isPointerLocked()
    || event.pointerType === 'touch'
    || event.pointerType === 'pen'
    || typeof canvas.requestPointerLock !== 'function'
  ) {
    return;
  }
  try {
    const result = canvas.requestPointerLock();
    if (result !== null && typeof result === 'object' && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch {
    // Lock refused (sandboxed iframe, unsupported): keyboard play goes on.
  }
}

/** @param {MouseEvent} event */
function onMouseMove(event) {
  if (!isPointerLocked() || !isMouseLookActive()) {
    return;
  }
  pendingMouseTurn = accumulateTurn(pendingMouseTurn, mouseTurnDelta(event.movementX));
}

/** Perte du verrou pendant une manche en cours (Échap, typiquement) : mise en pause. */
function onPointerLockChange() {
  if (isPointerLocked() || !isMouseLookActive()) {
    return;
  }
  pauseRound(PAUSE_REASON.MANUAL);
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
  if (isCurrentRoundOver() && action !== ACTION.EXIT && action !== ACTION.TOGGLE_SOUND) {
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
    // Locked (browser delivered Escape anyway): free the mouse and stay in FPS; the
    // pointerlockchange that follows pauses the round.
    if (isPointerLocked()) {
      releasePointerLock();
      return;
    }
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
  difficultySelect.addEventListener('change', () => {
    onDifficultyChange();
    if (viewMode === VIEW_TOP) {
      updateShareLink();
    }
  });
  shareCopyButton.addEventListener('click', copyShareLink);
  window.addEventListener('resize', onResize);

  fpsEnterButton.addEventListener('click', enterFps);
  fpsExitButton.addEventListener('click', exitFps);
  soundToggleButton.addEventListener('click', toggleSound);
  replayButton.addEventListener('click', replay);
  endNewMazeButton.addEventListener('click', newMazeFromEndScreen);
  resumeButton.addEventListener('click', resumeRound);
  canvas.addEventListener('click', onCanvasClick);
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
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  // Lock refused: no effect (listener only so that no error is left unhandled).
  document.addEventListener('pointerlockerror', () => {});
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearHeldActions();
      monsterAudio.suspend();
      pauseRound(PAUSE_REASON.HIDDEN);
    } else if (viewMode === VIEW_FPS && !isCurrentRoundOver() && !isPaused(pauseState)) {
      // Context already unlocked by the initial gesture; never created here outside FPS.
      // Paused: nothing restarts, the resume is always explicit.
      monsterAudio.resume();
    }
  });

  generateInitialMaze();
}

init();
