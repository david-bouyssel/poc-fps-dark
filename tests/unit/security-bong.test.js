// Tests de sécurité du son « bong bong » (testeur-securite, T7) : scan statique de
// src/audio/ et de l'accès à Web Audio, robustesse de bong.js face à des entrées
// hostiles, lecteur bong-player.js avec un faux contexte audio hostile, et câblage réel
// de src/main.js sous un DOM factice (aucun contexte audio avant le geste « Explorer en
// 3D », suspension hors FPS, en fin de partie et page cachée). Aucun accès réseau.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BONG,
  BONG_SYNTH,
  TURN_EVENT_TYPE,
  bongGain,
  selectBongGain,
  bongSchedule,
} from '../../src/audio/bong.js';
import { BONG_PLAYER_STATE, createBongPlayer } from '../../src/audio/bong-player.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = path.join(repoRoot, 'src');
const audioDir = path.join(srcDir, 'audio');

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
}

const rel = (f) => path.relative(repoRoot, f).split(path.sep).join('/');

function hitsFor(files, patterns) {
  const hits = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    for (const [pattern, label] of patterns) {
      lines.forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${rel(file)}:${i + 1} [${label}] ${line.trim()}`);
      });
    }
  }
  return hits;
}

// --- 1. Scan statique ------------------------------------------------------------------

describe('sécurité statique : src/audio/ et accès Web Audio', () => {
  const audioFiles = listFiles(audioDir);

  test('src/audio/ ne contient que bong.js et bong-player.js', () => {
    assert.deepEqual(audioFiles.map(rel).sort(), ['src/audio/bong-player.js', 'src/audio/bong.js']);
  });

  test('aucun réseau, chargement de son, micro, stockage ni log dans src/audio/', () => {
    const hits = hitsFor(audioFiles, [
      [/\bfetch\s*\(/, 'fetch'],
      [/XMLHttpRequest/, 'XHR'],
      [/WebSocket|EventSource|sendBeacon|RTCPeerConnection/, 'réseau'],
      [/\bimport\s*\(/, 'import dynamique'],
      [/decodeAudioData/, 'decodeAudioData'],
      [/new\s+Audio\b/, 'new Audio'],
      [/<audio|createElement\s*\(\s*['"`]audio/i, 'élément audio'],
      [/getUserMedia|mediaDevices|MediaRecorder|createMediaStreamSource|createMediaElementSource/, 'média'],
      [/audioWorklet|addModule|createScriptProcessor/, 'worklet / chargement de module'],
      [/https?:\/\/|wss?:\/\/|data:|blob:/i, 'URL'],
      [/localStorage|sessionStorage|indexedDB|document\.cookie|caches\b/, 'stockage'],
      [/\bconsole\s*\./, 'log'],
      [/\beval\s*\(|new\s+Function\b|setTimeout\s*\(\s*['"`]/, 'code dynamique'],
      [/\bwindow\b|\bglobalThis\b|\bdocument\b|\bnavigator\b|\bself\b/, 'accès global'],
      [/AudioContext/, 'AudioContext hors main.js'],
    ]);
    assert.deepEqual(hits, [], `Motifs interdits :\n${hits.join('\n')}`);
  });

  test('imports de src/audio/ : bong.js n\'importe rien, bong-player.js seulement ./bong.js', () => {
    const importsOf = (name) =>
      [...stripComments(readFileSync(path.join(audioDir, name), 'utf8')).matchAll(/^\s*import\b[^;]*?from\s*['"]([^'"]+)['"]/gm)]
        .map((m) => m[1]);
    assert.deepEqual(importsOf('bong.js'), []);
    assert.deepEqual(importsOf('bong-player.js'), ['./bong.js']);
  });

  test('AudioContext / webkitAudioContext lus uniquement dans src/main.js, une seule construction', () => {
    const jsFiles = listFiles(srcDir).filter((f) => f.endsWith('.js'));
    const hits = hitsFor(jsFiles, [[/AudioContext/, 'AudioContext']]).filter((h) => !h.startsWith('src/main.js:'));
    assert.deepEqual(hits, [], hits.join('\n'));
    const main = stripComments(readFileSync(path.join(srcDir, 'main.js'), 'utf8'));
    assert.match(main, /window\.AudioContext\s*\?\?\s*window\.webkitAudioContext/);
    assert.equal([...main.matchAll(/new\s+AudioContextClass\s*\(\s*\)/g)].length, 1);
    assert.equal([...main.matchAll(/\bcreateBongPlayer\s*\(/g)].length, 1, 'un seul lecteur');
    for (const forbidden of [/decodeAudioData/, /new\s+Audio\b/, /getUserMedia/, /audioWorklet/]) {
      assert.doesNotMatch(main, forbidden);
    }
  });

  test('aucun fichier son ni élément <audio> dans src/', () => {
    const files = listFiles(srcDir);
    const sounds = files.filter((f) => /\.(mp3|ogg|oga|wav|flac|aac|m4a|opus|webm|mid|midi)$/i.test(f));
    assert.deepEqual(sounds.map(rel), []);
    const html = files.filter((f) => f.endsWith('.html'));
    for (const f of html) assert.doesNotMatch(readFileSync(f, 'utf8'), /<audio|<video|<source/i, rel(f));
  });
});

// --- 2. Robustesse de bong.js ----------------------------------------------------------

describe('sécurité : robustesse de bong.js face à des entrées hostiles', () => {
  const inRange = (g) => typeof g === 'number' && !Number.isNaN(g) && g >= 0 && g <= BONG.maxGain;

  test('constantes gelées (aucune altération par un appelant)', () => {
    assert.ok(Object.isFrozen(BONG));
    assert.ok(Object.isFrozen(BONG_SYNTH));
    assert.ok(Object.isFrozen(BONG_SYNTH.hits));
    for (const h of BONG_SYNTH.hits) assert.ok(Object.isFrozen(h));
  });

  test('bongGain : distances limites bornées dans [0, maxGain], jamais NaN', () => {
    for (const d of [0, -0, Number.MIN_VALUE, 1, 2, 2.0000001, 17.5, 35.999999, 36, 1e300,
      Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, Infinity]) {
      assert.ok(inRange(bongGain(d)), `d=${d}`);
    }
    assert.equal(bongGain(Infinity), 0);
    assert.equal(bongGain(Number.MAX_VALUE), 0);
  });

  test('bongGain : NaN, négatifs, -Infinity et non-nombres rejetés par TypeError/RangeError', () => {
    for (const d of [NaN, -1, -Number.MIN_VALUE, -Infinity]) {
      assert.throws(() => bongGain(d), (e) => e instanceof TypeError || e instanceof RangeError, `d=${d}`);
    }
    const forged = [undefined, null, '5', '', true, {}, [], [5], 5n, Symbol('x'),
      { valueOf: () => 5 }, new Number(5), { __proto__: Number.prototype }];
    for (const d of forged) {
      assert.throws(() => bongGain(d), TypeError, `d=${String(typeof d)}`);
    }
  });

  test('bongGain : options hostiles rejetées, aucune pollution de prototype', () => {
    const bad = [null, 5, 'x', { maxGain: NaN }, { maxGain: 2 }, { maxGain: -1 },
      { silenceDistance: Infinity }, { nearDistance: 40 }, { nearDistance: 36 }, { minInterval: '1' }];
    for (const o of bad) {
      assert.throws(() => bongGain(5, o), (e) => e instanceof TypeError || e instanceof RangeError);
    }
    const polluted = JSON.parse('{"__proto__": {"maxGain": 999, "polluted": true}}');
    assert.ok(inRange(bongGain(1, polluted)));
    assert.equal({}.polluted, undefined, 'Object.prototype intact');
    assert.equal(Object.prototype.maxGain, undefined);
    // Clés inconnues ignorées ; gain borné par maxGain surchargé.
    assert.equal(bongGain(0, { maxGain: 0.2, constructor: 1, toString: 2 }), 0.2);
  });

  test('selectBongGain : événements forgés, __proto__ et types hostiles', () => {
    const events = [
      { type: TURN_EVENT_TYPE, pathDistance: 10 },
      { type: 'catch', pathDistance: 0 },
      { type: 'TURN', pathDistance: 0 },
      { type: { toString: () => 'turn' }, pathDistance: 0 },
      { type: ['turn'], pathDistance: 0 },
      JSON.parse('{"__proto__": {"type": "turn", "pathDistance": 0}}'),
      Object.create({ type: 'other', pathDistance: 0 }),
    ];
    const g = selectBongGain(events);
    assert.ok(inRange(g));
    assert.equal(g, bongGain(10), 'seuls les vrais virages comptent');
    assert.equal({}.type, undefined, 'Object.prototype intact');
    assert.equal(selectBongGain([]), 0);
    for (const bad of [null, undefined, 'turn', {}, { length: 1, 0: { type: 'turn', pathDistance: 0 } }]) {
      assert.throws(() => selectBongGain(bad), TypeError);
    }
    for (const bad of [[null], [5], ['turn'], [undefined]]) {
      assert.throws(() => selectBongGain(bad), TypeError);
    }
    for (const d of [NaN, -3, '1', undefined]) {
      assert.throws(() => selectBongGain([{ type: 'turn', pathDistance: d }]),
        (e) => e instanceof TypeError || e instanceof RangeError);
    }
  });

  test('selectBongGain : liste énorme traitée sans emballement, gain borné (un seul bong)', () => {
    const many = Array.from({ length: 200_000 }, (_, i) => ({ type: TURN_EVENT_TYPE, pathDistance: i % 50 }));
    const t0 = performance.now();
    const g = selectBongGain(many);
    assert.ok(performance.now() - t0 < 2000);
    assert.equal(g, BONG.maxGain, 'plusieurs virages ne s\'empilent pas au-delà de maxGain');
  });

  test('bongSchedule : entrées hostiles rejetées, sorties gelées et bornées', () => {
    for (const [s, g] of [[NaN, 0.5], [Infinity, 0.5], [0, NaN], [0, Infinity], ['0', 0.5],
      [0, '0.5'], [-1, 0.5], [0, -0.1], [0, 1.0001], [0, null], [{}, 0.5]]) {
      assert.throws(() => bongSchedule(s, g), (e) => e instanceof TypeError || e instanceof RangeError);
    }
    const voices = bongSchedule(1e6, 1);
    assert.ok(Object.isFrozen(voices));
    assert.ok(voices.length <= 4);
    for (const v of voices) {
      assert.ok(Object.isFrozen(v));
      for (const k of ['start', 'frequency', 'startFrequency', 'pitchEnd', 'peak', 'attackEnd', 'decayEnd', 'floorGain', 'stop']) {
        assert.ok(Number.isFinite(v[k]), k);
      }
      assert.ok(v.peak >= 0 && v.peak <= 1);
      assert.ok(v.floorGain > 0, 'exponentialRamp exige une cible > 0');
      assert.ok(v.startFrequency > 0 && v.frequency > 0);
      assert.ok(v.stop > v.start);
      assert.ok(v.stop - 1e6 <= BONG.minInterval + 1e-9, 'bong bong terminé avant le suivant');
    }
    assert.deepEqual(bongSchedule(0, 0), []);
  });
});

// --- 3. bong-player.js avec un faux contexte hostile -----------------------------------

function fakeParam(log) {
  return new Proxy({}, { get: (_, name) => (...args) => log.push(['param', String(name), ...args]) });
}

/** Faux AudioContext ; `faults` : nom de méthode -> comportement hostile. */
function fakeAudioContext({ faults = {}, autoEnd = false } = {}) {
  const log = [];
  const oscillators = [];
  const ctx = {
    log,
    oscillators,
    currentTime: 0,
    destination: { node: 'destination' },
    resumeCalls: 0,
    suspendCalls: 0,
    resume() {
      ctx.resumeCalls++;
      if (faults.resume === 'throw') throw new Error('resume refusé');
      if (faults.resume === 'reject') return Promise.reject(new Error('autoplay'));
      return Promise.resolve();
    },
    suspend() {
      ctx.suspendCalls++;
      if (faults.suspend === 'throw') throw new Error('suspend refusé');
      if (faults.suspend === 'reject') return Promise.reject(new Error('suspend'));
      return Promise.resolve();
    },
    createOscillator() {
      if (faults.createOscillator === 'throw') throw new Error('osc');
      if (faults.createOscillatorAfter !== undefined && oscillators.length >= faults.createOscillatorAfter) {
        throw new Error('osc quota');
      }
      const osc = {
        type: null,
        started: 0,
        stopped: 0,
        disconnected: 0,
        onended: null,
        frequency: fakeParam(log),
        connect() { if (faults.connect === 'throw') throw new Error('connect'); },
        disconnect() { osc.disconnected++; },
        start(t) { osc.started++; osc.startAt = t; },
        stop() {
          osc.stopped++;
          if (faults.stop === 'throw') throw new Error('stop');
          if (autoEnd) queueMicrotask(() => { if (typeof osc.onended === 'function') osc.onended(); });
        },
      };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      if (faults.createGain === 'throw') throw new Error('gain');
      return {
        gain: fakeParam(log),
        connect() {},
        disconnect() {},
      };
    },
  };
  return ctx;
}

describe('sécurité : bong-player.js face à un contexte audio hostile', () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  before(() => process.on('unhandledRejection', onUnhandled));
  after(() => process.off('unhandledRejection', onUnhandled));

  test('construction : aucune création de contexte ; fabrique invalide rejetée', () => {
    let calls = 0;
    const player = createBongPlayer({ createContext: () => { calls++; return fakeAudioContext(); } });
    assert.equal(calls, 0);
    assert.equal(player.state, BONG_PLAYER_STATE.IDLE);
    assert.ok(Object.isFrozen(player));
    assert.equal(player.play(0.5), false, 'aucun bong avant resume()');
    assert.doesNotThrow(() => player.suspend());
    assert.equal(calls, 0, 'ni play ni suspend ne créent de contexte');
    assert.equal(player.state, BONG_PLAYER_STATE.IDLE);
    for (const bad of [undefined, null, {}, { createContext: 'x' }, { createContext: {} }]) {
      assert.throws(() => createBongPlayer(bad), TypeError);
    }
    assert.throws(() => createBongPlayer({ createContext: () => null, options: { maxGain: NaN } }), RangeError);
  });

  test('fabrique qui lève, renvoie null ou undefined : UNAVAILABLE définitif, appelée une seule fois', () => {
    for (const factory of [() => { throw new Error('pas de Web Audio'); }, () => null, () => undefined]) {
      let calls = 0;
      const player = createBongPlayer({ createContext: () => { calls++; return factory(); } });
      assert.doesNotThrow(() => player.resume());
      assert.equal(player.state, BONG_PLAYER_STATE.UNAVAILABLE);
      assert.doesNotThrow(() => { player.resume(); player.suspend(); player.resume(); });
      assert.equal(player.play(0.7), false);
      assert.equal(calls, 1, 'pas de nouvelle tentative de création');
      assert.equal(player.state, BONG_PLAYER_STATE.UNAVAILABLE);
    }
  });

  test('promesses rejetées et méthodes qui lèvent (resume/suspend) : aucune exception, aucun rejet non géré', async () => {
    for (const mode of ['throw', 'reject']) {
      const ctx = fakeAudioContext({ faults: { resume: mode, suspend: mode } });
      const player = createBongPlayer({ createContext: () => ctx });
      assert.doesNotThrow(() => player.resume());
      assert.equal(player.state, BONG_PLAYER_STATE.RUNNING);
      assert.doesNotThrow(() => player.suspend());
      assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
      assert.doesNotThrow(() => player.resume());
    }
    // Thenable dont catch lève, contexte sans resume/suspend, getters hostiles.
    const weird = [
      { resume: () => ({ catch() { throw new Error('catch'); } }), suspend: () => ({ catch: 1 }) },
      {},
      Object.defineProperties({}, {
        resume: { get() { throw new Error('getter'); } },
        suspend: { get() { throw new Error('getter'); } },
        currentTime: { get() { throw new Error('getter'); } },
      }),
    ];
    for (const ctx of weird) {
      const player = createBongPlayer({ createContext: () => ctx });
      assert.doesNotThrow(() => { player.resume(); player.play(0.5); player.suspend(); player.resume(); });
      assert.equal(player.play(0.5), false);
    }
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(unhandled, [], 'aucune promesse rejetée non gérée');
  });

  test('play : gains hostiles ignorés, gain > 1 plafonné', () => {
    const ctx = fakeAudioContext();
    const player = createBongPlayer({ createContext: () => ctx });
    player.resume();
    for (const g of [NaN, Infinity, -Infinity, -1, 0, -0, '0.5', null, undefined, {}, 5n]) {
      assert.equal(player.play(g), false, String(typeof g));
    }
    assert.equal(ctx.oscillators.length, 0);
    assert.equal(player.play(1e308), true);
    const peaks = ctx.log.filter((e) => e[1] === 'linearRampToValueAtTime').map((e) => e[2]);
    assert.ok(peaks.length > 0);
    for (const p of peaks) assert.ok(p >= 0 && p <= 1, `crête ${p}`);
    for (const e of ctx.log) {
      for (const v of e.slice(2)) assert.ok(Number.isFinite(v), `${e[1]} reçoit ${v}`);
    }
  });

  test('currentTime hostile (NaN, Infinity, négatif, à rebours) : aucune exception', () => {
    for (const t of [NaN, Infinity, -5, undefined, '3']) {
      const ctx = fakeAudioContext();
      ctx.currentTime = t;
      const player = createBongPlayer({ createContext: () => ctx });
      player.resume();
      let r;
      assert.doesNotThrow(() => { r = player.play(0.5); });
      assert.equal(typeof r, 'boolean');
      assert.equal(ctx.oscillators.filter((o) => o.started && !o.stopped).length, 0, 'aucune voix non arrêtée');
    }
    const ctx = fakeAudioContext();
    const player = createBongPlayer({ createContext: () => ctx });
    player.resume();
    ctx.currentTime = 100;
    assert.equal(player.play(0.5), true);
    ctx.currentTime = 1; // horloge à rebours
    assert.doesNotThrow(() => player.play(0.5));
  });

  test('méthodes de nœud qui lèvent : aucune exception, aucune voix démarrée non arrêtée', () => {
    for (const faults of [{ createOscillator: 'throw' }, { createGain: 'throw' }, { connect: 'throw' },
      { stop: 'throw' }, { createOscillatorAfter: 2 }]) {
      const ctx = fakeAudioContext({ faults });
      const player = createBongPlayer({ createContext: () => ctx });
      player.resume();
      let r;
      assert.doesNotThrow(() => { r = player.play(0.6); }, JSON.stringify(faults));
      assert.equal(r, false, JSON.stringify(faults));
      for (const osc of ctx.oscillators) {
        if (osc.started) assert.ok(osc.stopped > 0, `voix démarrée laissée active ${JSON.stringify(faults)}`);
        assert.ok(osc.disconnected > 0 || faults.stop === 'throw', `voix non déconnectée ${JSON.stringify(faults)}`);
      }
      assert.doesNotThrow(() => player.suspend());
      assert.equal(player.state, BONG_PLAYER_STATE.SUSPENDED);
    }
  });

  test('limitation : au plus 1 bong par 0.9 s, même en rafale', () => {
    const ctx = fakeAudioContext();
    const player = createBongPlayer({ createContext: () => ctx });
    player.resume();
    let played = 0;
    for (let i = 0; i < 10_000; i++) {
      ctx.currentTime = i * 0.001; // 10 s de rafale à 1 kHz
      if (player.play(0.5)) played++;
    }
    assert.ok(played <= Math.floor(10 / BONG.minInterval) + 1, `bongs joués : ${played}`);
    assert.ok(played >= 10, 'le son reste fonctionnel');
    assert.equal(ctx.oscillators.length, played * 4, '4 voix par bong, pas plus');
  });

  test('pas de fuite de voix : onended libère, suspend arrête tout, aucun bong suspendu', async () => {
    const ctx = fakeAudioContext({ autoEnd: false });
    const player = createBongPlayer({ createContext: () => ctx });
    player.resume();
    for (let i = 0; i < 5; i++) {
      ctx.currentTime = i;
      assert.equal(player.play(0.5), true);
    }
    const before = ctx.oscillators.map((o) => o.stopped);
    player.suspend();
    assert.equal(ctx.suspendCalls, 1);
    ctx.oscillators.forEach((o, i) => assert.ok(o.stopped > before[i], `voix ${i} arrêtée à la suspension`));
    const count = ctx.oscillators.length;
    ctx.currentTime = 100;
    assert.equal(player.play(0.7), false, 'aucun bong en état SUSPENDED');
    assert.equal(ctx.oscillators.length, count);
    // Second suspend : les voix déjà libérées ne sont pas re-stoppées.
    const stops = ctx.oscillators.map((o) => o.stopped);
    player.suspend();
    assert.deepEqual(ctx.oscillators.map((o) => o.stopped), stops, 'ensemble des voix vidé');
    // Fin naturelle : onended déconnecte et libère.
    const ctx2 = fakeAudioContext({ autoEnd: true });
    const p2 = createBongPlayer({ createContext: () => ctx2 });
    p2.resume();
    p2.play(0.5);
    await new Promise((r) => setTimeout(r, 0));
    for (const osc of ctx2.oscillators) assert.ok(osc.disconnected > 0, 'voix déconnectée en fin de son');
    const stops2 = ctx2.oscillators.map((o) => o.stopped);
    p2.suspend();
    assert.deepEqual(ctx2.oscillators.map((o) => o.stopped), stops2, 'voix finies retirées de l\'ensemble');
  });
});

// --- 4. Câblage réel de src/main.js (DOM factice) --------------------------------------

const ELEMENT_IDS = [
  'maze-form', 'maze-width', 'maze-height', 'maze-seed', 'new-maze-button', 'maze-info',
  'maze-error', 'maze-canvas', 'fps-enter-button', 'fps-exit-button', 'fps-help',
  'fps-goal', 'end-screen', 'end-title', 'end-message', 'replay-button', 'end-new-maze-button',
];
const HIDDEN_AT_LOAD = new Set(['fps-exit-button', 'fps-help', 'fps-goal', 'end-screen']);

function fake2dContext() {
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

function makeElement(id, doc) {
  const attributes = new Map();
  const element = {
    ...makeListenerHost(),
    id,
    hidden: HIDDEN_AT_LOAD.has(id),
    textContent: '',
    value: '',
    style: {},
    width: 300,
    height: 150,
    clientWidth: 0,
    clientHeight: 0,
    parentElement: { clientWidth: 320, clientHeight: 240 },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
    focus() { doc.activeElement = element; },
    blur() {},
    getContext() { return fake2dContext(); },
  };
  return element;
}

describe('sécurité : câblage audio de src/main.js (DOM factice)', () => {
  const fakeDocument = {
    ...makeListenerHost(),
    title: '',
    hidden: false,
    activeElement: null,
    querySelectorAll: () => [],
  };
  const elements = new Map(ELEMENT_IDS.map((id) => [id, makeElement(id, fakeDocument)]));
  fakeDocument.getElementById = (id) => elements.get(id) ?? null;
  const fakeWindow = makeListenerHost();
  /** Contextes audio construits par main.js. */
  const contexts = [];
  class FakeAudioContextClass {
    constructor(...args) {
      const ctx = fakeAudioContext({ autoEnd: true });
      ctx.args = args;
      contexts.push(ctx);
      return ctx;
    }
  }
  fakeWindow.AudioContext = FakeAudioContextClass;
  fakeWindow.webkitAudioContext = FakeAudioContextClass;

  const frames = new Map();
  let nextFrameId = 1;
  let clock = 0;
  const saved = {};
  const GLOBALS = ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const el = (id) => elements.get(id);

  function runFrames(n, stepMs = 50) {
    for (let i = 0; i < n && frames.size > 0; i++) {
      const [[id, cb]] = frames;
      frames.delete(id);
      clock += stepMs;
      if (contexts[0]) contexts[0].currentTime = clock / 1000;
      cb(clock);
    }
  }
  const setHidden = (hidden) => {
    fakeDocument.hidden = hidden;
    fakeDocument.dispatch('visibilitychange', {});
  };
  function generate(width, height, seed) {
    el('maze-width').value = String(width);
    el('maze-height').value = String(height);
    el('maze-seed').value = seed;
    el('maze-form').dispatch('submit', { preventDefault() {} });
    assert.equal(el('maze-error').textContent, '');
  }
  const escape = () => fakeWindow.dispatch('keydown', {
    code: 'Escape', key: 'Escape', ctrlKey: false, metaKey: false, altKey: false,
    shiftKey: false, repeat: false, preventDefault() {},
  });

  before(async () => {
    for (const name of GLOBALS) saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    globalThis.window = fakeWindow;
    globalThis.document = fakeDocument;
    globalThis.requestAnimationFrame = (cb) => { const id = nextFrameId++; frames.set(id, cb); return id; };
    globalThis.cancelAnimationFrame = (id) => { frames.delete(id); };
    await import('../../src/main.js');
  });

  after(() => {
    for (const name of GLOBALS) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  });

  test('aucun AudioContext au chargement ni en vue de dessus (génération, onglet, clavier)', () => {
    assert.equal(contexts.length, 0, 'aucun contexte au chargement');
    // init() impose 16 x 16 : labyrinthe 8 x 8 à graine fixe (déterministe), monstre loin.
    generate(8, 8, '7');
    el('maze-form').dispatch('submit', { preventDefault() {} });
    setHidden(true);
    setHidden(false);
    fakeWindow.dispatch('blur', {});
    escape();
    assert.equal(contexts.length, 0, 'aucun contexte avant « Explorer en 3D »');
    assert.equal(el('maze-error').textContent, '');
  });

  test('« Explorer en 3D » : un seul contexte créé dans le geste, sans argument, repris', () => {
    el('fps-enter-button').dispatch('click', {});
    assert.equal(contexts.length, 1);
    assert.deepEqual(contexts[0].args, [], 'aucune option (latencyHint, sinkId...) transmise');
    assert.ok(contexts[0].resumeCalls >= 1);
    el('fps-enter-button').dispatch('click', {});
    assert.equal(contexts.length, 1, 'double clic : pas de second contexte');
  });

  test('page cachée en FPS : suspendu et aucun bong ; retour visible : repris', () => {
    const ctx = contexts[0];
    const suspends = ctx.suspendCalls;
    setHidden(true);
    assert.equal(ctx.suspendCalls, suspends + 1);
    const oscBefore = ctx.oscillators.length;
    runFrames(200); // 10 s simulées : grâce écoulée, virages du monstre
    assert.equal(el('end-screen').hidden, true, 'manche toujours en cours');
    assert.equal(ctx.oscillators.length, oscBefore, 'aucun bong page cachée');
    const resumes = ctx.resumeCalls;
    setHidden(false);
    assert.equal(ctx.resumeCalls, resumes + 1);
    assert.equal(contexts.length, 1);
    // Témoin : une fois visible, les bongs reprennent (le contrôle ci-dessus a du sens).
    for (let i = 0; i < 1200 && ctx.oscillators.length === oscBefore && el('end-screen').hidden; i++) runFrames(50);
    assert.ok(ctx.oscillators.length > oscBefore, 'bongs joués en FPS visible');
  });

  test('sortie FPS (Échap) : suspendu, aucun bong, onglet visible ne reprend pas hors FPS', () => {
    const ctx = contexts[0];
    const suspends = ctx.suspendCalls;
    escape();
    assert.equal(el('maze-form').hidden, false, 'retour en vue de dessus');
    assert.equal(ctx.suspendCalls, suspends + 1);
    const resumes = ctx.resumeCalls;
    setHidden(true);
    setHidden(false);
    assert.equal(ctx.resumeCalls, resumes, 'aucune reprise en vue de dessus');
    assert.equal(frames.size, 0);
    assert.equal(contexts.length, 1);
  });

  test('fin de partie (capture) : suspendu, aucune reprise par l\'onglet, bongs bornés', () => {
    el('fps-enter-button').dispatch('click', {});
    const ctx = contexts[0];
    assert.equal(contexts.length, 1, 'contexte réutilisé');
    const suspends = ctx.suspendCalls;
    // Joueur immobile : le monstre finit par le capturer.
    for (let i = 0; i < 400 && el('end-screen').hidden; i++) runFrames(50);
    assert.equal(el('end-screen').hidden, false, 'fin de partie atteinte');
    assert.equal(frames.size, 0);
    assert.ok(ctx.suspendCalls > suspends, 'suspendu à la fin de partie');
    const resumes = ctx.resumeCalls;
    setHidden(true);
    setHidden(false);
    assert.equal(ctx.resumeCalls, resumes, 'pas de reprise sur écran de fin');
    const peaks = ctx.log.filter((e) => e[1] === 'linearRampToValueAtTime').map((e) => e[2]);
    for (const p of peaks) assert.ok(Number.isFinite(p) && p >= 0 && p <= BONG.maxGain, `crête ${p}`);
    assert.equal(ctx.oscillators.length % 4, 0, '4 voix par bong');
    const bongStarts = [];
    for (let i = 0; i < ctx.oscillators.length; i += 4) bongStarts.push(ctx.oscillators[i].startAt);
    for (let i = 1; i < bongStarts.length; i++) {
      assert.ok(bongStarts[i] - bongStarts[i - 1] >= BONG.minInterval - 1e-6,
        `bongs trop rapprochés : ${bongStarts[i - 1]} -> ${bongStarts[i]}`);
    }
    assert.equal(el('maze-error').textContent, '');
  });

  test('« Rejouer » : reprise dans le geste, sans nouveau contexte', () => {
    const ctx = contexts[0];
    const resumes = ctx.resumeCalls;
    el('replay-button').dispatch('click', {});
    assert.equal(ctx.resumeCalls, resumes + 1);
    assert.equal(contexts.length, 1);
    escape();
  });

  test('navigateur sans Web Audio : jeu fonctionnel et muet (aucune exception)', async () => {
    // Le lecteur de main.js est déjà lié au contexte factice ; on vérifie la fabrique
    // réelle via un lecteur neuf sur les mêmes globaux, sans AudioContext.
    const ctor = fakeWindow.AudioContext;
    delete fakeWindow.AudioContext;
    delete fakeWindow.webkitAudioContext;
    const source = readFileSync(path.join(srcDir, 'main.js'), 'utf8');
    const body = source.match(/function createAudioContext\(\) \{([\s\S]*?)\n\}/)[1];
    const factory = new Function('window', body); // copie fidèle de la fabrique de main.js
    const player = createBongPlayer({ createContext: () => factory(fakeWindow) });
    assert.doesNotThrow(() => { player.resume(); player.play(0.5); player.suspend(); });
    assert.equal(player.state, BONG_PLAYER_STATE.UNAVAILABLE);
    fakeWindow.AudioContext = ctor;
  });
});
