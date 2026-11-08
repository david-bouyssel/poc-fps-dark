import { generateMaze, MAZE_LIMITS } from './maze/maze.js';
import { MAX_SEED } from './maze/random.js';
import { drawMaze } from './render/canvas-renderer.js';
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

/** Labyrinthe actuellement affiché (conservé en cas d'erreur de saisie). */
let currentMaze = null;
let resizeFrame = 0;

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

function render() {
  if (currentMaze) {
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
  try {
    maze = generateMaze({ width, height, seed });
  } catch {
    showError('errors.generic');
    return;
  }

  seedInput.value = String(seed);
  currentMaze = maze;
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

function init() {
  applyTranslations(document);
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

  generateFromForm({ forceRandomSeed: true });
}

init();
