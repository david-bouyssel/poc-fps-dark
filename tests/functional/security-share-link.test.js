// Tests de sécurité du partage par URL (T12) : src/game/share-link.js et son câblage dans
// src/main.js (DOM factice). Paramètres hostiles ignorés ou refusés en bloc, message
// d'erreur fixe sans la valeur reçue, aucune pollution de prototype, aucune écriture HTML
// ni réflexion de la valeur brute dans le DOM, lien reconstruit sur l'origine et le chemin
// de la page, presse-papiers en écriture seule avec repli sans crash ni rejet non géré,
// aucun stockage, aucun réseau, history et location jamais modifiés.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fr } from '../../src/i18n/fr.js';
import {
  buildShareUrl,
  parseNonNegativeInteger,
  parseShareParams,
  SHARE_STATUS,
} from '../../src/game/share-link.js';
import { DIFFICULTY_IDS } from '../../src/game/difficulty.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, '../../src');
const OPTS = { difficulties: DIFFICULTY_IDS };

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}
function listJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listJs(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
const protoSnapshot = () => Object.getOwnPropertyNames(Object.prototype).sort().join(',');

// --- Charges hostiles ---

const HOSTILE_INVALID = [
  ['?w=<script>alert(1)</script>', 'size'],
  ['?w=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E', 'size'],
  ['?seed=<svg/onload=alert(1)>', 'seed'],
  ['?seed=1%00', 'seed'],
  ['?seed=%001', 'seed'],
  ['?w=10%00&h=10', 'size'],
  ['?seed=%EF%BC%99', 'seed'], // ９ pleine chasse
  ['?seed=%D9%A1%D9%A2', 'seed'], // chiffres arabo-indiens
  ['?seed=1%E2%80%8B', 'seed'], // espace de largeur nulle
  ['?seed=-1', 'seed'],
  ['?w=-10', 'size'],
  ['?seed=%2B1', 'seed'],
  ['?seed=1.5', 'seed'],
  ['?seed=1.0', 'seed'],
  ['?w=10.0', 'size'],
  ['?seed=1e3', 'seed'],
  ['?seed=1E3', 'seed'],
  ['?seed=1e999', 'seed'],
  ['?seed=Infinity', 'seed'],
  ['?seed=NaN', 'seed'],
  ['?seed=12345678901', 'seed'],
  ['?seed=00000000001', 'seed'],
  ['?seed=4294967296', 'seed'],
  ['?seed=99999999999999999999', 'seed'],
  ['?seed=0x10', 'seed'],
  ['?seed=0b11', 'seed'],
  ['?seed=0o7', 'seed'],
  ['?w=0x10', 'size'],
  ['?seed=1%202', 'seed'],
  ['?w=', 'size'],
  ['?w=%20', 'size'],
  ['?w=1', 'size'],
  ['?w=65', 'size'],
  ['?seed=1&seed=2', 'malformed'],
  ['?w=16&w=17', 'malformed'],
  ['?d=easy&d=normal', 'malformed'],
  ['?seed=&seed=', 'malformed'],
  ['?d=__proto__', 'difficulty'],
  ['?d=constructor', 'difficulty'],
  ['?d=toString', 'difficulty'],
  ['?d=hasOwnProperty', 'difficulty'],
  ['?d=NORMAL', 'difficulty'],
  ['?d=normal%20', 'difficulty'],
  ['?d=%20normal', 'difficulty'],
  ['?d=normal%00', 'difficulty'],
  ['?d=hard', 'difficulty'],
  ['?d=<b>x</b>', 'difficulty'],
  [`?seed=${'9'.repeat(10_000)}`, 'malformed'],
  [`?x=${'a'.repeat(10_000)}&seed=1`, 'malformed'],
  [`?${'a'.repeat(512)}`, 'malformed'],
];

describe('share-link.js : paramètres hostiles', () => {
  for (const [search, reason] of HOSTILE_INVALID) {
    test(`${search.slice(0, 50)} -> invalid/${reason}`, () => {
      const before = protoSnapshot();
      const result = parseShareParams(search, OPTS);
      assert.equal(result.status, SHARE_STATUS.INVALID);
      assert.equal(result.reason, reason);
      assert.deepEqual(Object.keys(result).sort(), ['reason', 'status']);
      assert.ok(Object.isFrozen(result));
      assert.equal(protoSnapshot(), before);
    });
  }

  test('la raison ne contient jamais la valeur reçue', () => {
    for (const [search] of HOSTILE_INVALID) {
      const { reason } = parseShareParams(search, OPTS);
      assert.ok(['malformed', 'size', 'seed', 'difficulty'].includes(reason));
    }
  });

  test('paramètres inconnus ou clés piégées ignorés (absent), sans pollution', () => {
    const before = protoSnapshot();
    for (const search of ['?__proto__=1', '?__proto__[polluted]=1', '?constructor[prototype][x]=1',
      '?SEED=5', '?seed%00=5', '?Seed=5', '?W=10', '?%3Cscript%3E=1', '#seed=5', '?utm=x&ref=y']) {
      const result = parseShareParams(search, OPTS);
      assert.equal(result.status, SHARE_STATUS.ABSENT, search);
      assert.deepEqual(Object.keys(result), ['status']);
    }
    assert.equal(protoSnapshot(), before);
    assert.equal(({}).polluted, undefined);
    assert.equal(({}).x, undefined);
  });

  test('clés piégées mêlées à un lien valide : valeurs connues seules, objet propre', () => {
    const result = parseShareParams('?__proto__=x&constructor=y&seed=5&w=10&h=8&prototype=z', OPTS);
    assert.deepEqual({ ...result }, { status: 'valid', width: 10, height: 8, seed: 5, difficulty: null });
    assert.deepEqual(Object.keys(result).sort(), ['difficulty', 'height', 'seed', 'status', 'width']);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.ok(Object.isFrozen(result));
  });

  test('difficulties hostile (non tableau, éléments non texte) : TypeError, pas de coercition', () => {
    assert.throws(() => parseShareParams('?d=easy', { difficulties: 'easy' }), TypeError);
    assert.throws(() => parseShareParams('?d=1', { difficulties: [1] }), TypeError);
    assert.throws(() => parseShareParams('?d=easy', null), TypeError);
    assert.throws(() => parseShareParams({ toString: () => '?seed=1' }, OPTS), TypeError);
  });

  test('parseNonNegativeInteger : refuse tout sauf les chiffres ASCII (10 au plus)', () => {
    for (const raw of ['-1', '+1', '1.5', '1e3', '1e999', '0x10', 'Infinity', '٣', '９', '1\u00002',
      '12345678901', '1_000', '1,0', '']) {
      assert.equal(parseNonNegativeInteger(raw), null, JSON.stringify(raw));
    }
    assert.throws(() => parseNonNegativeInteger(12), TypeError);
    assert.throws(() => parseNonNegativeInteger({ trim: () => '1' }), TypeError);
  });

  test('analyse bornée en temps sur la charge maximale', () => {
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      parseShareParams(`?seed=${'1'.repeat(505)}`, OPTS);
      parseShareParams(`?${'&'.repeat(511)}`, OPTS);
      parseShareParams(`?${'seed=1&'.repeat(73)}`, OPTS);
    }
    assert.ok(performance.now() - start < 2000);
  });
});

describe('share-link.js : construction du lien (pas d\'hôte injecté)', () => {
  const config = { width: 10, height: 8, seed: 42 };

  test('origine et chemin de la page conservés, requête et fragment hostiles supprimés', () => {
    const base = 'https://example.test/poc-fps-dark/?w=<script>&next=https://evil.test#<img>';
    const link = new URL(buildShareUrl(base, config));
    assert.equal(link.origin, 'https://example.test');
    assert.equal(link.pathname, '/poc-fps-dark/');
    assert.equal(link.search, '?seed=42&w=10&h=8');
    assert.equal(link.hash, '');
    assert.ok(!link.href.includes('evil'));
    assert.ok(!link.href.includes('<'));
  });

  test('difficulté encodée : aucun paramètre ni caractère injecté', () => {
    const link = new URL(buildShareUrl('http://127.0.0.1:8080/', { ...config, difficulty: '<x>&w=99#y' }));
    assert.equal(link.searchParams.getAll('w').length, 1);
    assert.equal(link.searchParams.get('w'), '10');
    assert.equal(link.hash, '');
    assert.ok(!link.href.includes('<'));
  });

  test('valeurs hors bornes ou mal typées refusées (aucune URL fabriquée)', () => {
    const base = 'http://127.0.0.1:8080/';
    assert.throws(() => buildShareUrl(base, { ...config, seed: -1 }), RangeError);
    assert.throws(() => buildShareUrl(base, { ...config, seed: 2 ** 32 }), RangeError);
    assert.throws(() => buildShareUrl(base, { ...config, width: 65 }), RangeError);
    assert.throws(() => buildShareUrl(base, { ...config, seed: '42' }), TypeError);
    assert.throws(() => buildShareUrl(base, { ...config, seed: 1.5 }), TypeError);
    assert.throws(() => buildShareUrl(base, { ...config, seed: Infinity }), TypeError);
    assert.throws(() => buildShareUrl('/relative', config), TypeError);
    assert.throws(() => buildShareUrl(null, config), TypeError);
  });
});

describe('scan statique du partage', () => {
  const files = listJs(srcDir);
  const code = new Map(files.map((f) => [path.relative(srcDir, f).replaceAll('\\', '/'),
    stripComments(readFileSync(f, 'utf8'))]));

  test('share-link.js pur : ni window, document, location, navigator, history, réseau, stockage', () => {
    const src = code.get('game/share-link.js');
    for (const word of ['window', 'document', 'location', 'navigator', 'history', 'fetch',
      'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage', 'indexedDB', 'cookie',
      'innerHTML', 'eval', 'Function(', 'http://', 'https://']) {
      assert.ok(!src.includes(word), `share-link.js contient ${word}`);
    }
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(imports, ['../maze/maze.js', '../maze/random.js']);
  });

  test('src/ : aucune lecture du presse-papiers, execCommand, navigator.share, history', () => {
    for (const [file, src] of code) {
      for (const word of ['readText', 'clipboard.read', 'execCommand', 'navigator.share',
        'pushState', 'replaceState', 'history.', 'location.assign', 'location.replace',
        'location.href =', 'location.search =', 'location.hash', 'window.open', 'document.cookie']) {
        assert.ok(!src.includes(word), `${file} contient ${word}`);
      }
    }
  });

  test('location et navigator.clipboard lus uniquement dans main.js', () => {
    for (const [file, src] of code) {
      if (file === 'main.js') continue;
      assert.ok(!/\blocation\b/.test(src), `${file} lit location`);
      assert.ok(!src.includes('clipboard'), `${file} touche au presse-papiers`);
    }
  });
});

// --- Câblage de main.js (DOM factice, une instance du module par scénario) ---

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

const htmlWrites = [];
const forbiddenCalls = [];
const unhandled = [];
const onUnhandled = (reason) => { unhandled.push(reason); };

function fake2d() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
      return () => {};
    },
    set(target, prop, value) { target[prop] = value; return true; },
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
    dispatch(type, ev) { for (const fn of [...(listeners.get(type) ?? [])]) fn(ev); },
  };
}
function makeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), has: (c) => set.has(c) };
}

/** Objet piège : toute écriture ou tout appel de méthode est consigné. */
function trapObject(name, base, log) {
  return new Proxy(base, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value === 'function') {
        return (...args) => { log.push(`${name}.${String(prop)}()`); return value.apply(target, args); };
      }
      return value;
    },
    set(target, prop) { log.push(`${name}.${String(prop)}=`); return true; },
    defineProperty(target, prop) { log.push(`${name}.define ${String(prop)}`); return true; },
  });
}

let instance = 0;
const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'Element',
  'location', 'history', 'navigator', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches'];
const saved = {};

/**
 * Charge une instance neuve de main.js avec l'URL et le presse-papiers donnés.
 * @returns {Promise<{ el: (id: string) => any, frames: Map, navLog: string[], clipboardLog: string[] }>}
 */
async function loadMain({ search = '', href = `http://127.0.0.1:8080/${search}`, secure = true,
  clipboard, navigatorGetter } = {}) {
  const fakeDocument = {
    ...makeHost(), title: '', hidden: false, activeElement: null,
    querySelectorAll: () => [],
    body: { classList: makeClassList() },
  };
  function makeElement(id) {
    const attrs = new Map();
    const node = {
      ...makeHost(), id, hidden: HIDDEN_AT_LOAD.has(id), value: '', style: {},
      replaceChildren(...nodes) { this.children = nodes; },
      width: 300, height: 150, clientWidth: 0, clientHeight: 0,
      parentElement: { clientWidth: 320, clientHeight: 240 },
      classList: makeClassList(),
      focusCalls: 0, selectCalls: 0,
      setAttribute(n, v) { attrs.set(n, String(v)); },
      getAttribute(n) { return attrs.has(n) ? attrs.get(n) : null; },
      focus() { node.focusCalls++; fakeDocument.activeElement = node; }, blur() {},
      select() { node.selectCalls++; },
      getContext() { return fake2d(); },
      insertAdjacentHTML() { htmlWrites.push(`${id}.insertAdjacentHTML`); },
    };
    for (const prop of ['innerHTML', 'outerHTML']) {
      Object.defineProperty(node, prop, { get() { return ''; }, set() { htmlWrites.push(`${id}.${prop}`); } });
    }
    return node;
  }
  const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id)]));
  elements.get('maze-difficulty').value = 'normal';
  fakeDocument.getElementById = (id) => elements.get(id) ?? null;
  fakeDocument.createElement = (tag) => ({ tagName: tag, textContent: '', className: '' });

  const fakeWindow = makeHost();
  if (secure !== 'absent') fakeWindow.isSecureContext = secure;

  const navLog = [];
  const frames = new Map();
  let nextFrame = 1;
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  globalThis.Element = class FakeElement {};
  globalThis.requestAnimationFrame = (cb) => { const id = nextFrame++; frames.set(id, cb); return id; };
  globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
  const loc = { href, search, hash: '', origin: 'http://127.0.0.1:8080', pathname: '/',
    assign() {}, replace() {}, reload() {} };
  Object.defineProperty(globalThis, 'location', { configurable: true, writable: true,
    value: trapObject('location', loc, navLog) });
  Object.defineProperty(globalThis, 'history', { configurable: true, writable: true,
    value: trapObject('history', { length: 1, state: null, pushState() {}, replaceState() {},
      back() {}, forward() {}, go() {} }, navLog) });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get: navigatorGetter ?? (() => ({ userAgent: 'test', clipboard })),
  });
  await import(`../../src/main.js?share-security=${++instance}`);
  return { el: (id) => elements.get(id), frames, navLog };
}

/** Toutes les écritures textuelles et valeurs visibles d'une instance. */
function visibleTexts(el) {
  return ELEMENT_IDS.map((id) => `${el(id).textContent ?? ''}|${el(id).value ?? ''}`).join('\n');
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('main.js : lien partagé hostile (DOM factice)', () => {
  before(() => {
    for (const n of GLOBALS) saved[n] = Object.getOwnPropertyDescriptor(globalThis, n);
    for (const n of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
      Object.defineProperty(globalThis, n, {
        configurable: true, writable: true,
        value() { forbiddenCalls.push(n); throw new Error('réseau interdit'); },
      });
    }
    for (const n of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
      Object.defineProperty(globalThis, n, {
        configurable: true,
        get() { forbiddenCalls.push(n); throw new Error('stockage interdit'); },
      });
    }
    process.on('unhandledRejection', onUnhandled);
  });
  after(() => {
    process.off('unhandledRejection', onUnhandled);
    for (const n of GLOBALS) {
      if (saved[n]) Object.defineProperty(globalThis, n, saved[n]); else delete globalThis[n];
    }
  });

  const PAYLOADS = [
    ['?w=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E', '<img'],
    ['?seed=%3Cscript%3Ealert(1)%3C%2Fscript%3E', '<script'],
    ['?d=%3Cb%3Ex%3C%2Fb%3E&seed=3', '<b>'],
    ['?seed=1%00', '\u0000'],
    ['?seed=1e999', '1e999'],
    ['?seed=0x10', '0x10'],
    ['?seed=-7', '-7'],
    ['?seed=1&seed=2', 'seed=1&seed=2'],
    ['?d=__proto__', '__proto__'],
    ['?d=constructor&seed=9', 'constructor'],
    [`?seed=${'8'.repeat(10_000)}`, '8'.repeat(20)],
  ];

  for (const [search, marker] of PAYLOADS) {
    test(`${search.slice(0, 40)} : labyrinthe aléatoire, message fixe, aucune réflexion`, async () => {
      const before = protoSnapshot();
      const { el, frames, navLog } = await loadMain({ search });
      assert.equal(el('maze-error').textContent, fr['errors.sharedLink']);
      assert.equal(el('maze-width').value, '16');
      assert.equal(el('maze-height').value, '16');
      assert.match(el('maze-seed').value, /^\d{1,10}$/, 'graine aléatoire attendue');
      assert.equal(el('maze-difficulty').value, 'normal');
      assert.ok(!visibleTexts(el).includes(marker), 'valeur brute écrite dans le DOM');
      const link = new URL(el('share-link').value);
      assert.equal(link.origin, 'http://127.0.0.1:8080');
      assert.equal(link.pathname, '/');
      assert.deepEqual([...link.searchParams.keys()], ['seed', 'w', 'h']);
      assert.equal(link.searchParams.get('seed'), el('maze-seed').value);
      assert.equal(link.searchParams.get('w'), '16');
      assert.equal(el('share-panel').hidden, false);
      assert.equal(frames.size, 0, 'aucune entrée automatique en FPS');
      assert.deepEqual(navLog, [], 'location/history modifiés');
      assert.deepEqual(htmlWrites, []);
      assert.deepEqual(forbiddenCalls, []);
      assert.equal(protoSnapshot(), before);
    });
  }

  test('lien valide : rien d\'autre que les valeurs validées n\'est repris', async () => {
    const { el, navLog } = await loadMain({ search: '?seed=42&w=10&h=8&d=easy&x=%3Cscript%3E' });
    assert.equal(el('maze-error').textContent, '');
    assert.equal(el('maze-seed').value, '42');
    assert.equal(el('maze-difficulty').value, 'easy');
    assert.equal(new URL(el('share-link').value).search, '?seed=42&w=10&h=8&d=easy');
    assert.ok(!visibleTexts(el).includes('<script'));
    assert.deepEqual(navLog, []);
  });

  test('href hostile (requête et fragment) : lien reconstruit sans les reprendre', async () => {
    const { el } = await loadMain({ search: '?seed=5&w=8&h=8',
      href: 'http://127.0.0.1:8080/poc-fps-dark/?seed=5&w=8&h=8&next=%2F%2Fevil.test#%3Cimg%3E' });
    const link = new URL(el('share-link').value);
    assert.equal(link.host, '127.0.0.1:8080');
    assert.equal(link.pathname, '/poc-fps-dark/');
    assert.equal(link.search, '?seed=5&w=8&h=8');
    assert.equal(link.hash, '');
  });

  test('location absent de l\'hôte : chargement sans crash, panneau masqué', async () => {
    const { el } = await loadMain({ search: '' });
    delete globalThis.location;
    el('new-maze-button').dispatch('click', {});
    assert.equal(el('share-link').value, '');
    assert.equal(el('share-panel').hidden, true);
    el('share-copy-button').dispatch('click', {});
    assert.equal(el('share-status').textContent, '');
  });

  // --- Presse-papiers ---

  function clipboardSpy(writeText) {
    const log = [];
    const target = {
      writeText: (...args) => { log.push(['writeText', ...args]); return writeText(...args); },
      readText: () => { log.push(['readText']); return Promise.resolve('secret'); },
      read: () => { log.push(['read']); return Promise.resolve([]); },
    };
    return { log, clipboard: target };
  }

  test('copie réussie : écriture seule du lien affiché, message fixe', async () => {
    const { log, clipboard } = clipboardSpy(() => Promise.resolve());
    const { el } = await loadMain({ search: '?seed=42&w=10&h=8', clipboard });
    el('share-copy-button').dispatch('click', {});
    await flush();
    assert.deepEqual(log, [['writeText', el('share-link').value]]);
    assert.equal(el('share-status').textContent, fr['share.copied']);
  });

  const FALLBACKS = [
    ['contexte non sécurisé', { secure: false }, true],
    ['isSecureContext absent', { secure: 'absent' }, true],
    ['API absente', { clipboard: undefined }, false],
    ['writeText non fonction', { clipboard: { writeText: 'x' } }, false],
    ['writeText rejette', { reject: true }, true],
    ['writeText lève', { throws: true }, true],
    ['writeText rend une non-promesse rejetée (thenable)', { thenable: true }, true],
  ];
  for (const [name, opts, withSpy] of FALLBACKS) {
    test(`repli : ${name} -> sélection + message manuel, sans crash ni rejet non géré`, async () => {
      unhandled.length = 0;
      let spy = null;
      let clipboard = opts.clipboard;
      if (withSpy || opts.reject || opts.throws || opts.thenable) {
        spy = clipboardSpy(() => {
          if (opts.throws) throw new Error('<img src=x onerror=alert(1)>');
          if (opts.thenable) return { then: (_ok, ko) => ko(new Error('<script>')) };
          if (opts.reject) return Promise.reject(new Error('<script>alert(1)</script>'));
          return Promise.resolve();
        });
        clipboard = spy.clipboard;
      }
      const { el } = await loadMain({ search: '?seed=42&w=10&h=8', secure: 'secure' in opts ? opts.secure : true, clipboard });
      assert.doesNotThrow(() => el('share-copy-button').dispatch('click', {}));
      await flush();
      await flush();
      assert.equal(el('share-status').textContent, fr['share.copyManual']);
      assert.equal(el('share-link').selectCalls, 1);
      assert.ok(!visibleTexts(el).includes('<'), 'message d\'erreur réfléchi');
      if (spy) {
        assert.ok(!spy.log.some(([m]) => m === 'readText' || m === 'read'), 'lecture du presse-papiers');
        if ('secure' in opts) {
          assert.deepEqual(spy.log, [], 'writeText appelé hors contexte sécurisé');
        }
      }
      assert.deepEqual(unhandled, []);
    });
  }

  test('navigator dont l\'accès lève : repli sans crash', async () => {
    unhandled.length = 0;
    const { el } = await loadMain({ search: '?seed=42&w=10&h=8',
      navigatorGetter: () => { throw new Error('navigator indisponible'); } });
    assert.doesNotThrow(() => el('share-copy-button').dispatch('click', {}));
    await flush();
    assert.equal(el('share-status').textContent, fr['share.copyManual']);
    assert.deepEqual(unhandled, []);
  });

  test('aucun réseau, stockage ni écriture HTML sur l\'ensemble des scénarios', () => {
    assert.deepEqual(forbiddenCalls, []);
    assert.deepEqual(htmlWrites, []);
  });
});
