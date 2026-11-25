// Partage par URL (T12, plan docs/design/partage-url.md §3 et §7) : module pur
// src/game/share-link.js. Tests rédigés d'après le plan.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SHARE_PARAM,
  SHARE_LIMITS,
  SHARE_STATUS,
  parseNonNegativeInteger,
  parseShareParams,
  buildShareUrl,
} from '../../src/game/share-link.js';
import { MAZE_LIMITS } from '../../src/maze/maze.js';
import { MAX_SEED, createRng, randomInt } from '../../src/maze/random.js';
import { DIFFICULTY_IDS } from '../../src/game/difficulty.js';

const OPTS = Object.freeze({ difficulties: DIFFICULTY_IDS });
const PAGES_BASE = 'https://example.github.io/poc-fps-dark/';

describe('constantes', () => {
  test('SHARE_PARAM, SHARE_LIMITS, SHARE_STATUS : valeurs du plan, gelées', () => {
    assert.deepEqual({ ...SHARE_PARAM }, { seed: 'seed', width: 'w', height: 'h', difficulty: 'd' });
    assert.deepEqual({ ...SHARE_LIMITS }, { maxSearchLength: 512, maxIntegerLength: 10 });
    assert.deepEqual({ ...SHARE_STATUS }, { ABSENT: 'absent', VALID: 'valid', INVALID: 'invalid' });
    for (const c of [SHARE_PARAM, SHARE_LIMITS, SHARE_STATUS]) assert.ok(Object.isFrozen(c));
  });
});

describe('parseNonNegativeInteger', () => {
  test('acceptés : 0, 42, espaces autour, zéros initiaux, 10 chiffres', () => {
    assert.equal(parseNonNegativeInteger('0'), 0);
    assert.equal(parseNonNegativeInteger('42'), 42);
    assert.equal(parseNonNegativeInteger(' 7 '), 7);
    assert.equal(parseNonNegativeInteger('007'), 7);
    assert.equal(parseNonNegativeInteger('4294967295'), 4294967295);
    assert.equal(parseNonNegativeInteger('9999999999'), 9999999999);
  });

  test('refusés : vide, signe, point, exposant, hexadécimal, non ASCII, 11 chiffres', () => {
    for (const raw of ['', '   ', '-1', '+1', '1.0', '1e3', '0x10', '١٢', '12345678901',
      '1 2', 'abc', 'NaN', 'Infinity']) {
      assert.equal(parseNonNegativeInteger(raw), null, JSON.stringify(raw));
    }
  });

  test('TypeError sur un non-texte', () => {
    for (const raw of [42, null, undefined, {}, ['1'], true]) {
      assert.throws(() => parseNonNegativeInteger(raw), TypeError, String(raw));
    }
  });
});

describe('parseShareParams', () => {
  const valid = (search, opts = OPTS) => {
    const r = parseShareParams(search, opts);
    assert.equal(r.status, SHARE_STATUS.VALID, search);
    return { ...r };
  };
  const invalid = (search, reason, opts = OPTS) => {
    const r = parseShareParams(search, opts);
    assert.equal(r.status, SHARE_STATUS.INVALID, search);
    assert.equal(r.reason, reason, search);
  };

  test("'', '?', '?utm=x' : absent", () => {
    for (const s of ['', '?', '?utm=x']) {
      assert.deepEqual({ ...parseShareParams(s, OPTS) }, { status: 'absent' }, s);
    }
  });

  test('options facultatives : sans options, une requête sans d reste analysée', () => {
    assert.equal(parseShareParams('').status, 'absent');
    assert.deepEqual(valid('?seed=1&w=4&h=4', undefined),
      { status: 'valid', width: 4, height: 4, seed: 1, difficulty: null });
  });

  test("'?seed=42&w=10&h=8' : valid 42 / 10 / 8, difficulté null ; '?' facultatif", () => {
    const expected = { status: 'valid', width: 10, height: 8, seed: 42, difficulty: null };
    assert.deepEqual(valid('?seed=42&w=10&h=8'), expected);
    assert.deepEqual(valid('seed=42&w=10&h=8'), expected);
    assert.deepEqual(valid('?h=8&utm=x&w=10&seed=42'), expected, 'ordre libre, inconnus ignorés');
  });

  test('bornes acceptées : w=2, w=64, seed=0, seed=4294967295', () => {
    assert.equal(valid(`?w=${MAZE_LIMITS.minSize}`).width, 2);
    assert.equal(valid(`?w=${MAZE_LIMITS.maxSize}`).width, 64);
    assert.equal(valid(`?h=${MAZE_LIMITS.maxSize}`).height, 64);
    assert.equal(valid('?seed=0').seed, 0);
    assert.equal(valid(`?seed=${MAX_SEED}`).seed, 4294967295);
  });

  test('bornes refusées : w=1, w=65, h=0, seed=4294967296', () => {
    invalid('?w=1', 'size');
    invalid('?w=65', 'size');
    invalid('?h=0', 'size');
    invalid('?h=65', 'size');
    invalid(`?seed=${MAX_SEED + 1}`, 'seed');
  });

  test('seed seul : tailles null ; w et h seuls : graine null ; seed= vide : null ; w= vide : size', () => {
    assert.deepEqual(valid('?seed=5'), { status: 'valid', width: null, height: null, seed: 5, difficulty: null });
    assert.deepEqual(valid('?w=10&h=8'), { status: 'valid', width: 10, height: 8, seed: null, difficulty: null });
    assert.equal(valid('?seed=&w=10&h=8').seed, null);
    invalid('?w=&h=8', 'size');
    invalid('?h=', 'size');
  });

  test('formats refusés comme au formulaire', () => {
    invalid('?seed=1e3', 'seed');
    invalid('?seed=0x10', 'seed');
    invalid('?seed=-1', 'seed');
    invalid('?seed=12345678901', 'seed');
    invalid('?w=10.0', 'size');
    invalid('?w=abc', 'size');
  });

  test('doublon : malformed ; requête de 513 caractères : malformed, 512 accepté', () => {
    invalid('?seed=1&seed=2', 'malformed');
    invalid('?w=8&w=8', 'malformed');
    invalid('?d=easy&d=easy', 'malformed');
    const at512 = `?seed=1&x=${'a'.repeat(512 - '?seed=1&x='.length)}`;
    assert.equal(at512.length, 512);
    assert.equal(valid(at512).seed, 1);
    const at513 = `${at512}a`;
    invalid(at513, 'malformed');
  });

  test('difficulté : admis acceptés ; casse, __proto__, inconnu, liste vide refusés ; d= vide null', () => {
    for (const id of DIFFICULTY_IDS) assert.equal(valid(`?d=${id}`).difficulty, id);
    invalid('?d=Easy', 'difficulty');
    invalid('?d=NIGHTMARE', 'difficulty');
    invalid('?d=__proto__', 'difficulty');
    invalid('?d=constructor', 'difficulty');
    invalid('?d=hard', 'difficulty');
    invalid('?d=easy', 'difficulty', { difficulties: [] });
    invalid('?d=easy', 'difficulty', {});
    assert.equal(valid('?d=&seed=3').difficulty, null);
    assert.deepEqual(valid('?seed=42&w=10&h=8&d=nightmare'),
      { status: 'valid', width: 10, height: 8, seed: 42, difficulty: 'nightmare' });
  });

  test('ordre des raisons : doublon > taille > graine > difficulté', () => {
    invalid('?w=1&seed=-1&d=x', 'size');
    invalid('?seed=-1&d=x', 'seed');
    invalid('?w=99&seed=1&seed=2', 'malformed');
    invalid('?h=1&seed=abc', 'size');
  });

  test('tout ou rien : une valeur invalide annule tout le lien (aucune valeur rendue)', () => {
    const r = parseShareParams('?seed=42&w=10&h=99', OPTS);
    assert.deepEqual({ ...r }, { status: 'invalid', reason: 'size' });
  });

  test('résultat gelé dans les trois statuts', () => {
    for (const s of ['', '?seed=1', '?w=1']) assert.ok(Object.isFrozen(parseShareParams(s, OPTS)), s);
  });

  test('TypeError : search non texte, difficulties mal typé', () => {
    for (const s of [null, undefined, 42, {}, new URLSearchParams('seed=1')]) {
      assert.throws(() => parseShareParams(s, OPTS), TypeError);
    }
    assert.throws(() => parseShareParams('?d=easy', { difficulties: 'easy' }), TypeError);
    assert.throws(() => parseShareParams('?d=easy', { difficulties: [1, 2] }), TypeError);
    assert.throws(() => parseShareParams('?d=easy', { difficulties: new Set(['easy']) }), TypeError);
  });
});

describe('buildShareUrl', () => {
  const CONFIG = Object.freeze({ width: 10, height: 8, seed: 42 });

  test('base GitHub Pages : origine et chemin conservés, requête ?seed=42&w=10&h=8', () => {
    const link = buildShareUrl(PAGES_BASE, CONFIG);
    assert.equal(typeof link, 'string');
    assert.equal(link, 'https://example.github.io/poc-fps-dark/?seed=42&w=10&h=8');
    const url = new URL(link);
    assert.equal(url.origin, 'https://example.github.io');
    assert.equal(url.pathname, '/poc-fps-dark/');
  });

  test('ordre des paramètres : seed, w, h, puis d', () => {
    const url = new URL(buildShareUrl(PAGES_BASE, { ...CONFIG, difficulty: 'easy' }));
    assert.deepEqual([...url.searchParams.keys()], ['seed', 'w', 'h', 'd']);
    assert.equal(url.search, '?seed=42&w=10&h=8&d=easy');
  });

  test('requête et fragment existants remplacés ou supprimés', () => {
    const base = 'http://127.0.0.1:8080/poc-fps-dark/index.html?seed=1&w=2&h=2&d=easy&utm=x#top';
    const link = buildShareUrl(base, CONFIG);
    assert.equal(link, 'http://127.0.0.1:8080/poc-fps-dark/index.html?seed=42&w=10&h=8');
  });

  test('d omis pour null, absent ou chaîne vide', () => {
    for (const config of [CONFIG, { ...CONFIG, difficulty: null }, { ...CONFIG, difficulty: '' }]) {
      assert.equal(new URL(buildShareUrl(PAGES_BASE, config)).search, '?seed=42&w=10&h=8');
    }
  });

  test('bornes : 2, 64, 0 et MAX_SEED acceptés', () => {
    const url = new URL(buildShareUrl(PAGES_BASE, { width: 2, height: 64, seed: MAX_SEED }));
    assert.equal(url.search, '?seed=4294967295&w=2&h=64');
    assert.equal(new URL(buildShareUrl(PAGES_BASE, { width: 64, height: 2, seed: 0 })).search,
      '?seed=0&w=64&h=2');
  });

  test('RangeError hors bornes', () => {
    for (const config of [{ ...CONFIG, width: 1 }, { ...CONFIG, width: 65 }, { ...CONFIG, height: 0 },
      { ...CONFIG, seed: -1 }, { ...CONFIG, seed: MAX_SEED + 1 }]) {
      assert.throws(() => buildShareUrl(PAGES_BASE, config), RangeError, JSON.stringify(config));
    }
  });

  test('TypeError : base invalide, champ manquant ou mal typé', () => {
    for (const base of [null, 42, '', 'pas une url', '/relatif']) {
      assert.throws(() => buildShareUrl(base, CONFIG), TypeError, String(base));
    }
    const { seed, ...noSeed } = CONFIG;
    const { width, ...noWidth } = CONFIG;
    const { height, ...noHeight } = CONFIG;
    void seed; void width; void height;
    for (const config of [noSeed, noWidth, noHeight, { ...CONFIG, seed: '42' }, { ...CONFIG, width: '10' },
      { ...CONFIG, height: 8.5 }, { ...CONFIG, seed: NaN }]) {
      assert.throws(() => buildShareUrl(PAGES_BASE, config), TypeError, JSON.stringify(config));
    }
    assert.throws(() => buildShareUrl(PAGES_BASE, null), TypeError);
    assert.throws(() => buildShareUrl(PAGES_BASE, { ...CONFIG, difficulty: 3 }), TypeError);
  });

  test('aller-retour avec parseShareParams sur des graines et tailles tirées par createRng', () => {
    const rng = createRng(20261125);
    const span = MAZE_LIMITS.maxSize - MAZE_LIMITS.minSize + 1;
    for (let i = 0; i < 200; i++) {
      const config = {
        width: MAZE_LIMITS.minSize + randomInt(rng, span),
        height: MAZE_LIMITS.minSize + randomInt(rng, span),
        seed: Math.floor(rng() * (MAX_SEED + 1)),
        difficulty: i % 4 === 3 ? null : DIFFICULTY_IDS[i % 3],
      };
      const parsed = parseShareParams(new URL(buildShareUrl(PAGES_BASE, config)).search, OPTS);
      assert.deepEqual({ ...parsed }, { status: 'valid', ...config });
    }
  });
});

test('pureté : la source du module ne contient ni window, document, location, navigator', () => {
  // Commentaires retirés : la JSDoc cite location.search, seul le code compte.
  const src = readFileSync(fileURLToPath(new URL('../../src/game/share-link.js', import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  for (const word of ['window', 'document', 'location', 'navigator']) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(src), `share-link.js contient ${word}`);
  }
});
