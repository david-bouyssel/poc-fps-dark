// Tests de sécurité du câblage tactile réel de src/main.js (testeur-securite), DOM factice :
// data-action forgé ignoré, pointerId invalide, setPointerCapture qui lève, aucun HTML
// dynamique, écouteurs posés sur les pads uniquement, aucun réseau/stockage appelé.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'maze-difficulty', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'sound-toggle-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'replay-button', 'end-new-maze-button',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch',
  'pause-screen', 'pause-message', 'resume-button', 'round-status',
];
const HIDDEN_AT_LOAD = new Set([
  'fps-exit-button', 'sound-toggle-button', 'fps-help', 'fps-goal', 'end-screen',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch', 'pause-screen',
]);
const htmlWrites = [];
const forbiddenCalls = [];

function fakeContext() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(t, p) {
      if (p in t) return t[p];
      if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => gradient;
      return () => {};
    },
    set(t, p, v) { t[p] = v; return true; },
  });
}
function makeHost() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    dispatch(type, ev) { for (const fn of [...(listeners.get(type) ?? [])]) fn(ev); },
  };
}
function makeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) };
}
function makeElement(id) {
  const attrs = new Map();
  const el = {
    ...makeHost(), id, hidden: HIDDEN_AT_LOAD.has(id), textContent: '', value: '', style: {},
    width: 300, height: 150, clientWidth: 0, clientHeight: 0,
    parentElement: { clientWidth: 640, clientHeight: 480 },
    classList: makeClassList(),
    setAttribute(n, v) { attrs.set(n, String(v)); },
    getAttribute(n) { return attrs.has(n) ? attrs.get(n) : null; },
    focus() {}, blur() {}, getContext() { return fakeContext(); },
    insertAdjacentHTML() { htmlWrites.push(`${id}.insertAdjacentHTML`); },
  };
  for (const prop of ['innerHTML', 'outerHTML']) {
    Object.defineProperty(el, prop, { get() { return ''; }, set() { htmlWrites.push(`${id}.${prop}`); } });
  }
  return el;
}

class FakeElement {}
/** Bouton tactile factice : instance de FakeElement, closest renvoie lui-même. */
function makeButton(action, { captureThrows = false } = {}) {
  const b = new FakeElement();
  b.dataset = action === undefined ? {} : { action };
  b.classList = makeClassList();
  b.captureCalls = 0;
  b.setPointerCapture = () => { b.captureCalls++; if (captureThrows) throw new Error('NotFoundError'); };
  b.closest = (sel) => (sel === '[data-action]' && action !== undefined ? b : null);
  return b;
}
function pointerEvent(target, pointerId) {
  return {
    target, pointerId, prevented: 0,
    preventDefault() { this.prevented++; },
  };
}

const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
elements.get('maze-difficulty').value = 'normal';
const fakeWindow = makeHost();
const fakeDocument = {
  ...makeHost(), title: '', hidden: false, activeElement: null,
  getElementById: (id) => elements.get(id) ?? null,
  querySelectorAll: () => [],
  body: { classList: makeClassList() },
};
const frames = new Map();
let nextFrame = 1;
const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Element',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB'];
const saved = {};
const pad = () => elements.get('touch-pad-actions');

describe('sécurité du câblage tactile de main.js (DOM factice)', () => {
  before(async () => {
    for (const n of GLOBALS) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);
    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.Element = FakeElement;
    globalThis.requestAnimationFrame = (cb) => { const id = nextFrame++; frames.set(id, cb); return id; };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    for (const n of ['fetch', 'XMLHttpRequest', 'WebSocket']) {
      Object.defineProperty(globalThis, n, {
        configurable: true, writable: true,
        value() { forbiddenCalls.push(n); throw new Error('réseau interdit'); },
      });
    }
    for (const n of ['localStorage', 'sessionStorage', 'indexedDB']) {
      Object.defineProperty(globalThis, n, {
        configurable: true,
        get() { forbiddenCalls.push(n); throw new Error('stockage interdit'); },
      });
    }
    elements.get('maze-width').value = '8';
    elements.get('maze-height').value = '8';
    await import('../../src/main.js');
  });
  after(() => {
    for (const n of GLOBALS) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n];
    }
  });

  test('écouteurs pointer posés sur les pads, pas sur window/document', () => {
    for (const id of ['touch-pad-move', 'touch-pad-actions']) {
      assert.deepEqual([...elements.get(id).listeners.keys()].sort(),
        ['contextmenu', 'lostpointercapture', 'pointercancel', 'pointerdown', 'pointerup']);
    }
    for (const host of [fakeWindow, fakeDocument]) {
      for (const type of host.listeners.keys()) {
        // T11 : pointerlockchange/pointerlockerror (API Pointer Lock) sont attendus sur document.
        if (host === fakeDocument && (type === 'pointerlockchange' || type === 'pointerlockerror')) continue;
        assert.ok(!/^(pointer|touch|lostpointer)/.test(type), type);
      }
    }
    assert.deepEqual([...fakeWindow.listeners.keys()].sort(), ['blur', 'keydown', 'keyup', 'resize']);
  });

  test('vue de dessus : pointerdown ignoré (pas de preventDefault, pas de capture)', () => {
    const b = makeButton('forward');
    const ev = pointerEvent(b, 1);
    pad().dispatch('pointerdown', ev);
    assert.equal(ev.prevented, 0);
    assert.equal(b.captureCalls, 0);
    assert.equal(b.classList.has('is-pressed'), false);
  });

  describe('en vue FPS', () => {
    before(() => {
      elements.get('fps-enter-button').dispatch('click', {});
      assert.equal(pad().hidden, false, 'pads visibles en FPS');
    });

    test('data-action forgé ou absent ignoré', () => {
      for (const action of ['exit', 'EXIT', 'constructor', '__proto__', '', '<img onerror=x>', undefined]) {
        const b = makeButton(action);
        const ev = pointerEvent(b, 2);
        pad().dispatch('pointerdown', ev);
        assert.equal(ev.prevented, 0, String(action));
        assert.equal(b.captureCalls, 0, String(action));
        assert.equal(b.classList.has('is-pressed'), false, String(action));
      }
    });

    test('cible qui n\'est pas un Element : ignorée sans exception', () => {
      for (const target of [null, undefined, {}, 'x', { closest() { throw new Error('x'); } }]) {
        assert.doesNotThrow(() => pad().dispatch('pointerdown', pointerEvent(target, 3)));
        assert.doesNotThrow(() => pad().dispatch('pointerup', pointerEvent(target, 3)));
      }
    });

    test('setPointerCapture qui lève : l\'appui est pris en compte, aucune exception', () => {
      const b = makeButton('forward', { captureThrows: true });
      assert.doesNotThrow(() => pad().dispatch('pointerdown', pointerEvent(b, 4)));
      assert.equal(b.captureCalls, 1);
      assert.equal(b.classList.has('is-pressed'), true);
      pad().dispatch('pointerup', pointerEvent(b, 4));
      assert.equal(b.classList.has('is-pressed'), false);
    });

    test('pointerId invalide : aucune exception', () => {
      for (const id of [NaN, Infinity, 1.5, '1', null, undefined, {}]) {
        const b = makeButton('forward');
        assert.doesNotThrow(() => pad().dispatch('pointerdown', pointerEvent(b, id)), String(id));
        assert.doesNotThrow(() => pad().dispatch('pointerup', pointerEvent(b, id)), String(id));
      }
    });

    test('rafale de 200 doigts : aucune exception, une seule image en attente', () => {
      const b = makeButton('run');
      for (let i = 100; i < 300; i++) {
        assert.doesNotThrow(() => pad().dispatch('pointerdown', pointerEvent(b, i)));
      }
      assert.equal(frames.size, 1, 'une seule image en attente');
      const [[id, cb]] = frames;
      frames.delete(id);
      assert.doesNotThrow(() => cb(1000));
      for (let i = 100; i < 300; i++) pad().dispatch('pointerup', pointerEvent(b, i));
    });

    test('data-action exit forgé ne quitte pas la vue FPS', () => {
      assert.doesNotThrow(() => pad().dispatch('pointerdown', pointerEvent(makeButton('exit'), 6)));
      assert.equal(elements.get('fps-exit-button').hidden, false, 'toujours en FPS');
    });
  });

  test('aucune écriture HTML dynamique, aucun appel réseau/stockage', () => {
    assert.deepEqual(htmlWrites, []);
    assert.deepEqual(forbiddenCalls, []);
  });
});
