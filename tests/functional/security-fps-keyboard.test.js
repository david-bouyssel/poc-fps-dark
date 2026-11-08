// Tests de sécurité du câblage clavier réel de src/main.js (testeur-securite).
// main.js est importé tel quel sous Node, avec un DOM factice minimal (aucune
// dépendance) : on vérifie que preventDefault ne touche que les touches liées, jamais
// avec Ctrl/Meta/Alt, jamais sur keyup, jamais hors vue FPS ; que des événements
// hostiles ne lèvent pas ; que la boucle n'a jamais plus d'une image en attente ; et
// qu'aucun écouteur global inattendu (message, storage...) n'est posé.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'fps-help',
];

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
    hidden: id === 'fps-exit-button' || id === 'fps-help',
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
  };
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
});
