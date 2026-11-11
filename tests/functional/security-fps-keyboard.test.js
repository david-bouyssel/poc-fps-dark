// Tests de sécurité du câblage clavier réel de src/main.js (testeur-securite).
// main.js est importé tel quel sous Node, avec un DOM factice minimal (aucune
// dépendance) : on vérifie que preventDefault ne touche que les touches liées, jamais
// avec Ctrl/Meta/Alt, jamais sur keyup, jamais hors vue FPS ; que des événements
// hostiles ne lèvent pas ; que la boucle n'a jamais plus d'une image en attente ; et
// qu'aucun écouteur global inattendu (message, storage...) n'est posé.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { createPlayer } from '../../src/game/player.js';
import { actionForCode, computeIntent } from '../../src/game/input.js';
import { stepPlayer } from '../../src/game/movement.js';
import { findExit } from '../../src/game/exit.js';
import { shortestPath } from '../../src/game/pathfinding.js';

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'replay-button', 'end-new-maze-button',
];
/** Éléments masqués au chargement, comme dans src/index.html. */
const HIDDEN_AT_LOAD = new Set(['fps-exit-button', 'fps-help', 'fps-goal', 'end-screen']);
/** Toute écriture HTML (innerHTML, outerHTML, insertAdjacentHTML) est journalisée ici. */
const htmlWrites = [];

/** Contexte 2D factice : toute méthode est un no-op, toute propriété est affectable. */
function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      return () => {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function makeListenerHost() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, event) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
  };
}

function makeElement(id) {
  const host = makeListenerHost();
  const attributes = new Map();
  const element = {
    ...host,
    id,
    hidden: HIDDEN_AT_LOAD.has(id),
    textContent: '',
    value: '',
    style: {},
    width: 300,
    height: 150,
    clientWidth: 0,
    clientHeight: 0,
    parentElement: { clientWidth: 640, clientHeight: 480 },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    focus() { fakeDocument.activeElement = element; },
    blur() {},
    getContext() { return fakeContext(); },
    insertAdjacentHTML(position, html) { htmlWrites.push(`${id}.insertAdjacentHTML`); },
  };
  for (const prop of ['innerHTML', 'outerHTML']) {
    Object.defineProperty(element, prop, {
      get() { return ''; },
      set() { htmlWrites.push(`${id}.${prop}`); },
    });
  }
  return element;
}

const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
const fakeWindow = makeListenerHost();
const fakeDocument = {
  ...makeListenerHost(),
  title: '',
  hidden: false,
  activeElement: null,
  getElementById: (id) => elements.get(id) ?? null,
  querySelectorAll: () => [],
};

const frames = new Map();
let nextFrameId = 1;
const saved = {};
const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'];

function keyEvent(code, modifiers = {}) {
  return {
    code,
    key: typeof code === 'string' ? code : '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...modifiers,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
}

function press(type, code, modifiers) {
  const event = keyEvent(code, modifiers);
  fakeWindow.dispatch(type, event);
  return event;
}

function runFrame(t) {
  const [[id, cb]] = frames;
  frames.delete(id);
  cb(t);
}

const BOUND = [
  'ArrowUp', 'KeyW', 'ArrowDown', 'KeyS', 'ArrowLeft', 'KeyQ', 'ArrowRight', 'KeyE',
  'KeyA', 'KeyD', 'ShiftLeft', 'ShiftRight',
];
const UNBOUND = [
  'Tab', 'F5', 'F11', 'F12', 'KeyR', 'KeyL', 'KeyT', 'KeyN', 'Space', 'Enter',
  'Backspace', 'PageUp', 'PageDown', 'Home', 'End', 'Digit1', 'ControlLeft', 'AltLeft',
  'MetaLeft', 'KeyZ',
];
const MODIFIERS = [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { ctrlKey: true, shiftKey: true }];

const enterButton = () => elements.get('fps-enter-button');
const form = () => elements.get('maze-form');

describe('sécurité du câblage clavier de main.js (DOM factice)', () => {
  before(async () => {
    for (const name of GLOBALS) saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.requestAnimationFrame = (cb) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    elements.get('maze-width').value = '8';
    elements.get('maze-height').value = '8';
    await import('../../src/main.js');
  });

  after(() => {
    for (const name of GLOBALS) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  });

  test('initialisation : seuls les écouteurs globaux attendus sont posés', () => {
    assert.deepEqual([...fakeWindow.listeners.keys()].sort(), ['blur', 'keydown', 'keyup', 'resize']);
    assert.deepEqual([...fakeDocument.listeners.keys()].sort(), ['visibilitychange']);
    assert.equal(elements.get('maze-error').textContent, '', 'aucune erreur au démarrage');
    assert.notEqual(elements.get('maze-info').textContent, '');
  });

  test('vue de dessus : aucune touche (même liée) n\'est bloquée', () => {
    for (const code of [...BOUND, 'Escape', ...UNBOUND]) {
      assert.equal(press('keydown', code).defaultPrevented, false, `keydown ${code}`);
      assert.equal(press('keyup', code).defaultPrevented, false, `keyup ${code}`);
    }
    assert.equal(frames.size, 0, 'aucune boucle de jeu hors FPS');
  });

  test('entrée en FPS : une seule image en attente, formulaire masqué', () => {
    enterButton().dispatch('click', {});
    assert.equal(form().hidden, true);
    assert.equal(frames.size, 1);
    enterButton().dispatch('click', {}); // double clic : pas de seconde boucle
    assert.equal(frames.size, 1);
  });

  test('FPS : preventDefault sur keydown des touches liées sans modificateur', () => {
    for (const code of BOUND) {
      assert.equal(press('keydown', code).defaultPrevented, true, `keydown ${code}`);
      press('keyup', code);
    }
    assert.equal(press('keydown', 'KeyW', { shiftKey: true }).defaultPrevented, true, 'Maj = courir, reste lié');
    press('keyup', 'KeyW');
  });

  test('FPS : jamais de preventDefault avec Ctrl/Meta/Alt (raccourcis navigateur préservés)', () => {
    for (const code of [...BOUND, 'Escape', 'KeyR', 'KeyL', 'KeyT', 'KeyW']) {
      for (const mod of MODIFIERS) {
        assert.equal(press('keydown', code, mod).defaultPrevented, false, `keydown ${code} ${JSON.stringify(mod)}`);
      }
    }
    assert.equal(form().hidden, true, 'Ctrl/Alt+Échap ne quitte pas la vue FPS');
  });

  test('FPS : touches non liées (Tab, F5, F11, F12...) jamais bloquées', () => {
    for (const code of UNBOUND) {
      assert.equal(press('keydown', code).defaultPrevented, false, `keydown ${code}`);
    }
  });

  test('FPS : keyup jamais bloqué, quels que soient la touche et les modificateurs', () => {
    for (const code of [...BOUND, 'Escape', ...UNBOUND]) {
      assert.equal(press('keyup', code).defaultPrevented, false, `keyup ${code}`);
      assert.equal(press('keyup', code, { ctrlKey: true }).defaultPrevented, false, `keyup Ctrl+${code}`);
    }
  });

  test('FPS : événements hostiles (code absent, prototype, non chaîne) sans exception ni blocage', () => {
    const hostile = [undefined, null, '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 42, {}, [], 'keyw'];
    for (const code of hostile) {
      for (const type of ['keydown', 'keyup']) {
        let event;
        assert.doesNotThrow(() => { event = press(type, code); }, `${type} ${String(code)}`);
        assert.equal(event.defaultPrevented, false, `${type} ${String(code)}`);
      }
    }
  });

  test('FPS : images avec horodatages hostiles et touches maintenues, sans exception ni emballement', () => {
    press('keydown', 'KeyW');
    press('keydown', 'ShiftLeft');
    press('keydown', 'ArrowLeft');
    for (const t of [0, 16, NaN, -1e9, 1e12, Infinity, 48, undefined, 64, 80]) {
      assert.doesNotThrow(() => runFrame(t), `image t=${String(t)}`);
      assert.equal(frames.size, 1, 'une seule image replanifiée');
    }
    fakeWindow.dispatch('blur', {});
    fakeDocument.hidden = true;
    fakeDocument.dispatch('visibilitychange', {});
    fakeDocument.hidden = false;
    for (let i = 0; i < 20; i++) runFrame(100 + i * 16);
    assert.equal(frames.size, 1);
    assert.equal(elements.get('maze-error').textContent, '');
  });

  test('Échap (sans modificateur) quitte la vue FPS : boucle arrêtée, plus aucun blocage', () => {
    const event = press('keydown', 'Escape');
    assert.equal(event.defaultPrevented, true);
    assert.equal(form().hidden, false);
    assert.equal(frames.size, 0, 'image en attente annulée');
    for (const code of [...BOUND, 'Escape']) {
      assert.equal(press('keydown', code).defaultPrevented, false, `après sortie : keydown ${code}`);
    }
  });

  // --- Fin de manche (T4 : sortie et victoire) ---------------------------------------
  // Pilote automatique en lockstep : le test rejoue en local le même joueur (mêmes
  // fonctions pures, mêmes dt) et choisit les touches pour suivre le plus court chemin
  // jusqu'à la sortie. Sans rotation : l'orientation de départ (est ou sud) fixe le sens
  // des touches W/S/A/D.
  const endScreen = () => elements.get('end-screen');
  const FRAME_MS = 50;

  function generateSmallMaze() {
    elements.get('maze-width').value = '3';
    elements.get('maze-height').value = '3';
    form().dispatch('submit', { preventDefault() {} });
    assert.equal(elements.get('maze-error').textContent, '', 'génération 3 x 3 sans erreur');
  }

  function currentLocalGrid() {
    const maze = generateMaze({
      width: Number(elements.get('maze-width').value),
      height: Number(elements.get('maze-height').value),
      seed: Number(elements.get('maze-seed').value),
    });
    return toTileGrid(maze);
  }

  /** Touche pour aller dans la direction (dx, dy) selon l'orientation de départ. */
  function keyFor(angle, dx, dy) {
    const east = angle === 0;
    if (dx > 0) return east ? 'KeyW' : 'KeyA';
    if (dx < 0) return east ? 'KeyS' : 'KeyD';
    if (dy > 0) return east ? 'KeyD' : 'KeyW';
    return east ? 'KeyA' : 'KeyS';
  }

  /** Mène le joueur à la sortie ; renvoie l'horodatage suivant. */
  function walkToExit(startTime) {
    const grid = currentLocalGrid();
    const exit = findExit(grid);
    let local = createPlayer(grid);
    const path = shortestPath(grid, 1, 1, exit.tx, exit.ty);
    let target = 1;
    let t = startTime;
    let first = true;
    let held = null;
    for (let i = 0; i < 2000 && frames.size > 0 && endScreen().hidden; i++) {
      const node = path[Math.min(target, path.length - 1)];
      const ex = node.tx + 0.5 - local.x;
      const ey = node.ty + 0.5 - local.y;
      if (Math.abs(ex) < 0.15 && Math.abs(ey) < 0.15 && target < path.length - 1) target++;
      let key = null;
      if (Math.abs(ex) > 0.1) key = keyFor(local.angle, Math.sign(ex), 0);
      else if (Math.abs(ey) > 0.1) key = keyFor(local.angle, 0, Math.sign(ey));
      if (key !== held) {
        if (held) press('keyup', held);
        if (key) assert.equal(press('keydown', key).defaultPrevented, true, 'touche liée en cours de partie');
        held = key;
      }
      runFrame(t);
      const dt = first ? 0 : FRAME_MS / 1000;
      first = false;
      const actions = new Set(held ? [actionForCode(held)] : []);
      local = stepPlayer(local, computeIntent(actions), dt, grid);
      t += FRAME_MS;
    }
    if (held) press('keyup', held);
    assert.equal(endScreen().hidden, false, 'écran de fin affiché à la sortie');
    assert.equal(frames.size, 0, 'boucle arrêtée en fin de manche');
    return t;
  }

  test('fin de manche : écran de fin via textContent, boucle arrêtée, focus sur Rejouer', () => {
    generateSmallMaze();
    assert.equal(endScreen().hidden, true);
    enterButton().dispatch('click', {});
    assert.equal(frames.size, 1);
    assert.equal(elements.get('fps-goal').hidden, false, 'objectif affiché en FPS');
    walkToExit(1_000_000);
    assert.notEqual(elements.get('end-title').textContent, '');
    assert.notEqual(elements.get('end-message').textContent, '');
    assert.equal(fakeDocument.activeElement, elements.get('replay-button'));
  });

  test('fin de manche : seule Échap est traitée, aucune autre touche bloquée ni relance', () => {
    const others = [...BOUND, 'KeyM', 'Tab', 'Enter', 'Space', 'NumpadEnter', 'F5'];
    for (const code of others) {
      assert.equal(press('keydown', code).defaultPrevented, false, `fin : keydown ${code}`);
      assert.equal(press('keyup', code).defaultPrevented, false, `fin : keyup ${code}`);
    }
    for (const code of ['__proto__', 'constructor', undefined, null, 42]) {
      assert.doesNotThrow(() => press('keydown', code));
    }
    for (const mod of MODIFIERS) {
      assert.equal(press('keydown', 'Escape', mod).defaultPrevented, false, 'Échap + modificateur ignoré');
    }
    assert.equal(frames.size, 0, 'aucune touche ne relance la boucle');
    assert.equal(endScreen().hidden, false, 'écran de fin toujours visible');
    const event = press('keydown', 'Escape');
    assert.equal(event.defaultPrevented, true, 'Échap traitée en fin de manche');
    assert.equal(form().hidden, false, 'retour à la vue de dessus');
    assert.equal(endScreen().hidden, true, 'écran de fin masqué');
    assert.equal(frames.size, 0);
  });

  test('boutons de fin hors FPS : sans effet (aucune boucle lancée)', () => {
    elements.get('replay-button').dispatch('click', {});
    elements.get('end-new-maze-button').dispatch('click', {});
    assert.equal(frames.size, 0);
    assert.equal(form().hidden, false);
  });

  test('Rejouer et Nouveau labyrinthe : une seule boucle, manche neuve, clics répétés sûrs', () => {
    enterButton().dispatch('click', {});
    assert.equal(frames.size, 1, 'une partie finie reprend en manche neuve');
    assert.equal(endScreen().hidden, true);
    let t = walkToExit(2_000_000);
    elements.get('replay-button').dispatch('click', {});
    elements.get('replay-button').dispatch('click', {});
    assert.equal(frames.size, 1, 'double clic Rejouer : une seule boucle');
    assert.equal(endScreen().hidden, true);
    t = walkToExit(t + 1000);
    elements.get('end-new-maze-button').dispatch('click', {});
    elements.get('end-new-maze-button').dispatch('click', {});
    assert.equal(frames.size, 1, 'double clic Nouveau labyrinthe : une seule boucle');
    assert.equal(endScreen().hidden, true);
    assert.equal(form().hidden, true, 'on reste en FPS');
    assert.equal(elements.get('maze-error').textContent, '');
    press('keydown', 'Escape');
    assert.equal(frames.size, 0);
  });

  test('HUD et textes : aucune écriture HTML (innerHTML/outerHTML/insertAdjacentHTML)', () => {
    assert.deepEqual(htmlWrites, []);
  });
});
