// Partage par URL (T12, plan docs/design/partage-url.md §4 et §7) : tests fonctionnels.
// 1. Sans DOM : un lien construit puis analysé redonne le même labyrinthe, la même sortie
//    et le même départ du monstre que la génération directe.
// 2. main.js réel sous DOM factice (une instance du module par scénario, crypto simulé) :
//    lien valide = même labyrinthe que le formulaire, lien invalide = errors.sharedLink et
//    valeurs par défaut, #share-link tenu à jour, panneau masqué en FPS, copie et repli,
//    formulaire limité à 10 chiffres.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateMaze } from '../../src/maze/maze.js';
import { toTileGrid } from '../../src/maze/grid.js';
import { findExit } from '../../src/game/exit.js';
import { createMonster } from '../../src/game/monster.js';
import { DIFFICULTY_IDS } from '../../src/game/difficulty.js';
import { buildShareUrl, parseShareParams } from '../../src/game/share-link.js';
import { fr } from '../../src/i18n/fr.js';
import { t } from '../../src/i18n/i18n.js';

const OPTS = { difficulties: DIFFICULTY_IDS };

describe('lien construit puis analysé : même partie que la génération directe', () => {
  for (const [width, height, seed] of [[10, 8, 42], [16, 16, 7], [2, 64, 0], [64, 2, 4294967295],
    [33, 21, 123456789]]) {
    test(`${width} x ${height}, graine ${seed}`, () => {
      const link = buildShareUrl('https://example.github.io/poc-fps-dark/', { width, height, seed });
      const shared = parseShareParams(new URL(link).search, OPTS);
      assert.equal(shared.status, 'valid');
      const direct = generateMaze({ width, height, seed });
      const viaLink = generateMaze({ width: shared.width, height: shared.height, seed: shared.seed });
      assert.deepEqual([...viaLink.cells], [...direct.cells]);
      const gridDirect = toTileGrid(direct);
      const gridLink = toTileGrid(viaLink);
      const exitDirect = findExit(gridDirect);
      const exitLink = findExit(gridLink);
      assert.deepEqual({ ...exitLink }, { ...exitDirect });
      const mDirect = createMonster(gridDirect, seed, { exit: exitDirect });
      const mLink = createMonster(gridLink, shared.seed, { exit: exitLink });
      assert.equal(mLink.x, mDirect.x);
      assert.equal(mLink.y, mDirect.y);
    });
  }
});

// --- main.js réel sous DOM factice ---

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'maze-difficulty', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'sound-toggle-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'end-stat-time', 'end-stat-explored',
  'end-stat-distance', 'replay-button', 'end-new-maze-button',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch',
  'pause-screen', 'pause-message', 'resume-button', 'round-status', 'sound-captions',
  'share-panel', 'share-link', 'share-copy-button', 'share-status',
];
const HIDDEN_AT_LOAD = new Set(['sound-captions',
  'fps-exit-button', 'sound-toggle-button', 'fps-help', 'fps-goal', 'end-screen',
  'touch-pad-move', 'touch-pad-actions', 'fps-help-touch', 'pause-screen',
]);

/** Contexte 2D factice ; `log` reçoit chaque appel de méthode (nom + arguments). */
function fake2d(log) {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      if (prop === 'getImageData' || prop === 'createImageData') {
        return (...a) => ({ width: a[2] ?? a[0], height: a[3] ?? a[1], data: new Uint8ClampedArray(4) });
      }
      return (...args) => { log?.push(`${String(prop)}(${args.map(String).join(',')})`); };
    },
    set(target, prop, value) {
      log?.push(`${String(prop)}=${String(value)}`);
      target[prop] = value;
      return true;
    },
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
    removeEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, ev = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn(ev); },
  };
}
function makeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) };
}

const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Element',
  'location', 'navigator', 'crypto'];
const saved = {};
let instance = 0;
/** Valeurs successives rendues par crypto.getRandomValues (graines « aléatoires »). */
let randomQueue = [];

function installCrypto() {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true, writable: true,
    value: {
      getRandomValues(buffer) {
        for (let i = 0; i < buffer.length; i++) buffer[i] = randomQueue.length ? randomQueue.shift() : 777;
        return buffer;
      },
    },
  });
}

/**
 * Charge une instance neuve de main.js.
 * @returns {Promise<{ el: (id: string) => any, drawLog: string[] }>}
 */
async function loadMain({ search = '', secure = true, clipboard, randoms = [] } = {}) {
  randomQueue = [...randoms];
  const fakeDocument = {
    ...makeHost(), title: '', hidden: false, activeElement: null,
    querySelectorAll: () => [],
    body: { classList: makeClassList() },
  };
  const drawLog = [];
  function makeElement(id) {
    const attrs = new Map();
    const node = {
      ...makeHost(), id, hidden: HIDDEN_AT_LOAD.has(id), value: '', textContent: '', style: {},
      replaceChildren(...nodes) { this.children = nodes; },
      width: 300, height: 150, clientWidth: 0, clientHeight: 0,
      parentElement: { clientWidth: 320, clientHeight: 240 },
      classList: makeClassList(),
      focusCalls: 0, selectCalls: 0,
      setAttribute(n, v) { attrs.set(n, String(v)); },
      getAttribute(n) { return attrs.has(n) ? attrs.get(n) : null; },
      removeAttribute(n) { attrs.delete(n); },
      focus() { node.focusCalls++; fakeDocument.activeElement = node; }, blur() {},
      select() { node.selectCalls++; },
      getContext() { return fake2d(id === 'maze-canvas' ? drawLog : null); },
    };
    return node;
  }
  const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
  elements.get('maze-difficulty').value = 'normal';
  fakeDocument.getElementById = (id) => elements.get(id) ?? null;
  fakeDocument.createElement = (tag) => ({
    tagName: tag, textContent: '', className: '', width: 0, height: 0, style: {},
    getContext: () => fake2d(null),
  });

  const fakeWindow = makeHost();
  fakeWindow.isSecureContext = secure;
  let nextFrame = 1;
  const frames = new Map();
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  globalThis.Element = class FakeElement {};
  globalThis.requestAnimationFrame = (cb) => { const id = nextFrame++; frames.set(id, cb); return id; };
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
  Object.defineProperty(globalThis, 'location', {
    configurable: true, writable: true,
    value: { href: `http://127.0.0.1:8080/poc-fps-dark/${search}`, search, hash: '',
      origin: 'http://127.0.0.1:8080', pathname: '/poc-fps-dark/' },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, get: () => ({ userAgent: 'test', clipboard }),
  });
  await import(`../../src/main.js?share-functional=${++instance}`);
  return { el: (id) => elements.get(id), drawLog, frames, window: fakeWindow };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Redessine la vue de dessus et rend les appels de dessin du canvas. */
function redraw(app) {
  app.drawLog.length = 0;
  app.window.dispatch('resize');
  // Le redimensionnement est différé d'une image : on la joue à la main.
  for (const [id, cb] of [...app.frames]) {
    app.frames.delete(id);
    cb(0);
  }
  return [...app.drawLog];
}

/** Saisit le formulaire puis le soumet. */
function submitForm(app, { width, height, seed, difficulty }) {
  if (difficulty !== undefined) {
    app.el('maze-difficulty').value = difficulty;
    app.el('maze-difficulty').dispatch('change');
  }
  app.el('maze-width').value = width;
  app.el('maze-height').value = height;
  app.el('maze-seed').value = seed;
  app.el('maze-form').dispatch('submit', { preventDefault() {} });
}

const linkOf = (app) => new URL(app.el('share-link').value);

describe('main.js : partage par URL (DOM factice)', () => {
  before(() => {
    for (const n of GLOBALS) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);
    installCrypto();
  });
  after(() => {
    for (const n of GLOBALS) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n];
    }
  });

  test('chargement sans requête : labyrinthe aléatoire 16 x 16, lien de la partie, aucun message', async () => {
    const app = await loadMain({ randoms: [314159] });
    assert.equal(app.el('maze-error').textContent, '');
    assert.equal(app.el('maze-seed').value, '314159');
    assert.equal(app.el('maze-info').textContent, t('info.current', { seed: 314159, width: 16, height: 16 }));
    assert.equal(app.el('share-link').value, 'http://127.0.0.1:8080/poc-fps-dark/?seed=314159&w=16&h=16');
    assert.equal(app.el('share-panel').hidden, false);
  });

  test('lien valide : même labyrinthe que le formulaire pour la même graine, taille et difficulté', async () => {
    const shared = await loadMain({ search: '?seed=42&w=10&h=8&d=easy' });
    assert.equal(shared.el('maze-error').textContent, '');
    assert.equal(shared.el('maze-width').value, '10');
    assert.equal(shared.el('maze-height').value, '8');
    assert.equal(shared.el('maze-seed').value, '42');
    assert.equal(shared.el('maze-difficulty').value, 'easy');
    assert.equal(shared.el('maze-info').textContent, t('info.current', { seed: 42, width: 10, height: 8 }));
    assert.equal(linkOf(shared).search, '?seed=42&w=10&h=8&d=easy');
    assert.equal(shared.frames.size, 0, 'pas d\'entrée automatique en FPS');
    const sharedDrawing = redraw(shared);

    const viaForm = await loadMain({ randoms: [999] });
    submitForm(viaForm, { width: '10', height: '8', seed: '42', difficulty: 'easy' });
    assert.equal(viaForm.el('maze-error').textContent, '');
    assert.equal(viaForm.el('maze-info').textContent, shared.el('maze-info').textContent);
    assert.equal(viaForm.el('share-link').value, shared.el('share-link').value);
    const formDrawing = redraw(viaForm);
    assert.ok(formDrawing.length > 0, 'aucun dessin enregistré');
    assert.deepEqual(formDrawing, sharedDrawing, 'dessins différents pour la même partie');

    // Contrôle : une autre graine donne un autre dessin.
    submitForm(viaForm, { width: '10', height: '8', seed: '43' });
    assert.notDeepEqual(redraw(viaForm), sharedDrawing);
  });

  test('lien valide partiel : graine seule -> taille par défaut ; tailles seules -> graine aléatoire', async () => {
    const seedOnly = await loadMain({ search: '?seed=5' });
    assert.equal(seedOnly.el('maze-error').textContent, '');
    assert.equal(seedOnly.el('maze-info').textContent, t('info.current', { seed: 5, width: 16, height: 16 }));
    const sizeOnly = await loadMain({ search: '?w=10&h=8', randoms: [2024] });
    assert.equal(sizeOnly.el('maze-error').textContent, '');
    assert.equal(sizeOnly.el('maze-info').textContent, t('info.current', { seed: 2024, width: 10, height: 8 }));
    assert.equal(linkOf(sizeOnly).search, '?seed=2024&w=10&h=8');
  });

  for (const search of ['?seed=abc&w=10', '?w=65&h=8&seed=1', '?seed=1&seed=2', '?d=hard&seed=3',
    '?seed=4294967296', `?seed=1&x=${'a'.repeat(600)}`]) {
    test(`lien invalide ${search.slice(0, 30)} : errors.sharedLink, valeurs par défaut, partie aléatoire`, async () => {
      const app = await loadMain({ search, randoms: [8675309] });
      assert.equal(app.el('maze-error').textContent, fr['errors.sharedLink']);
      assert.equal(app.el('maze-width').value, '16');
      assert.equal(app.el('maze-height').value, '16');
      assert.equal(app.el('maze-seed').value, '8675309');
      assert.equal(app.el('maze-difficulty').value, 'normal');
      assert.equal(app.el('maze-info').textContent, t('info.current', { seed: 8675309, width: 16, height: 16 }));
      assert.equal(app.el('share-link').value, 'http://127.0.0.1:8080/poc-fps-dark/?seed=8675309&w=16&h=16');
      assert.equal(app.el('share-panel').hidden, false);
      assert.equal(app.frames.size, 0, 'pas d\'entrée automatique en FPS');
    });
  }

  test('lien invalide : la génération suivante efface le message', async () => {
    const app = await loadMain({ search: '?seed=-1', randoms: [11, 12] });
    assert.equal(app.el('maze-error').textContent, fr['errors.sharedLink']);
    app.el('new-maze-button').dispatch('click');
    assert.equal(app.el('maze-error').textContent, '');
    assert.equal(app.el('maze-seed').value, '12');
  });

  test('#share-link mis à jour à chaque génération (formulaire, Nouveau labyrinthe)', async () => {
    const app = await loadMain({ search: '?seed=42&w=10&h=8', randoms: [5000, 6000] });
    assert.equal(linkOf(app).search, '?seed=42&w=10&h=8');
    app.el('new-maze-button').dispatch('click');
    assert.equal(app.el('maze-seed').value, '5000');
    assert.equal(linkOf(app).search, '?seed=5000&w=10&h=8');
    submitForm(app, { width: '20', height: '12', seed: '77' });
    assert.equal(linkOf(app).search, '?seed=77&w=20&h=12');
    assert.equal(linkOf(app).pathname, '/poc-fps-dark/', 'chemin de la page conservé');
    submitForm(app, { width: '20', height: '12', seed: '' });
    assert.equal(linkOf(app).search, '?seed=6000&w=20&h=12', 'graine vide -> graine tirée');
  });

  test('génération refusée : lien inchangé', async () => {
    const app = await loadMain({ search: '?seed=42&w=10&h=8' });
    const before = app.el('share-link').value;
    submitForm(app, { width: '99', height: '8', seed: '1' });
    assert.notEqual(app.el('maze-error').textContent, '');
    assert.equal(app.el('share-link').value, before);
  });

  test('#share-link mis à jour à chaque changement de difficulté (d omis pour normal)', async () => {
    const app = await loadMain({ search: '?seed=42&w=10&h=8' });
    const select = app.el('maze-difficulty');
    for (const [id, expected] of [['nightmare', '?seed=42&w=10&h=8&d=nightmare'],
      ['easy', '?seed=42&w=10&h=8&d=easy'], ['normal', '?seed=42&w=10&h=8']]) {
      select.value = id;
      select.dispatch('change');
      assert.equal(linkOf(app).search, expected, id);
      assert.equal(app.el('maze-seed').value, '42', 'pas de regénération');
    }
  });

  test('panneau masqué en FPS, réaffiché à la sortie avec le même lien', async () => {
    const app = await loadMain({ search: '?seed=42&w=10&h=8' });
    const link = app.el('share-link').value;
    assert.equal(app.el('share-panel').hidden, false);
    app.el('fps-enter-button').dispatch('click');
    assert.equal(app.el('maze-form').hidden, true, 'FPS non atteinte');
    assert.equal(app.el('share-panel').hidden, true);
    app.el('fps-exit-button').dispatch('click');
    assert.equal(app.el('maze-form').hidden, false);
    assert.equal(app.el('share-panel').hidden, false);
    assert.equal(app.el('share-link').value, link);
  });

  test('copie en contexte sécurisé : writeText(lien), puis share.copied ; vidé à la génération', async () => {
    const calls = [];
    const clipboard = { writeText: (text) => { calls.push(text); return Promise.resolve(); } };
    const app = await loadMain({ search: '?seed=42&w=10&h=8', clipboard, randoms: [1] });
    app.el('share-copy-button').dispatch('click');
    await flush();
    assert.deepEqual(calls, [app.el('share-link').value]);
    assert.equal(app.el('share-status').textContent, fr['share.copied']);
    assert.equal(app.el('share-link').selectCalls, 0);
    app.el('new-maze-button').dispatch('click');
    assert.equal(app.el('share-status').textContent, '');
  });

  test('contexte non sécurisé : pas de writeText, sélection du lien + share.copyManual', async () => {
    const calls = [];
    const clipboard = { writeText: (text) => { calls.push(text); return Promise.resolve(); } };
    const app = await loadMain({ search: '?seed=42&w=10&h=8', clipboard, secure: false });
    app.el('share-copy-button').dispatch('click');
    await flush();
    assert.deepEqual(calls, []);
    assert.equal(app.el('share-link').focusCalls, 1);
    assert.equal(app.el('share-link').selectCalls, 1);
    assert.equal(app.el('share-status').textContent, fr['share.copyManual']);
  });

  test('API absente ou promesse rejetée : repli par sélection + share.copyManual', async () => {
    for (const clipboard of [undefined, { writeText: () => Promise.reject(new Error('refus')) }]) {
      const app = await loadMain({ search: '?seed=42&w=10&h=8', clipboard });
      app.el('share-copy-button').dispatch('click');
      await flush();
      assert.equal(app.el('share-link').selectCalls, 1);
      assert.equal(app.el('share-status').textContent, fr['share.copyManual']);
    }
  });

  test('formulaire : refuse un entier de plus de 10 chiffres, accepte 10 chiffres', async () => {
    const app = await loadMain({ search: '?seed=42&w=10&h=8' });
    const before = app.el('share-link').value;
    submitForm(app, { width: '10', height: '8', seed: '00000000042' });
    assert.equal(app.el('maze-error').textContent, t('errors.seed', { max: 4294967295 }));
    assert.equal(app.el('share-link').value, before);
    submitForm(app, { width: '00000000016', height: '8', seed: '1' });
    assert.equal(app.el('maze-error').textContent, t('errors.size', { min: 2, max: 64 }));
    submitForm(app, { width: '0000000016', height: '8', seed: '0000000042' });
    assert.equal(app.el('maze-error').textContent, '');
    assert.equal(linkOf(app).search, '?seed=42&w=16&h=8');
  });
});

test('source de main.js : validation unique via parseNonNegativeInteger, pas d\'innerHTML', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
  assert.ok(!src.includes('INTEGER_PATTERN'), 'INTEGER_PATTERN local restant');
  assert.ok(!src.includes('readNonNegativeInteger'), 'readNonNegativeInteger restant');
  assert.match(src, /import\s*\{[^}]*\bparseNonNegativeInteger\b[^}]*\}\s*from\s*'\.\/game\/share-link\.js'/);
  assert.ok(!src.includes('innerHTML'));
});
