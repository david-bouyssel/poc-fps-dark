// Plan docs/design/pause.md §3 et §6 (cas 1 à 8) : état de pause pur.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PAUSE_REASON,
  createPauseState,
  pauseGame,
  resumeGame,
  isPaused,
  canPause,
} from '../../src/game/pause.js';
import {
  GAME_STATUS,
  createGameState,
  checkVictory,
  declareDefeat,
} from '../../src/game/game-state.js';

const REASONS = ['manual', 'blur', 'hidden'];

function wonState() {
  const exit = Object.freeze({ tx: 1, ty: 1 });
  const s = checkVictory(createGameState(), { x: 1.5, y: 1.5, angle: 0 }, exit);
  assert.equal(s.status, GAME_STATUS.WON);
  return s;
}

describe('PAUSE_REASON (cas 8)', () => {
  test('gelé, exactement 3 valeurs du plan', () => {
    assert.ok(Object.isFrozen(PAUSE_REASON));
    assert.deepEqual({ ...PAUSE_REASON }, { MANUAL: 'manual', BLUR: 'blur', HIDDEN: 'hidden' });
    assert.equal(Object.keys(PAUSE_REASON).length, 3);
  });
});

describe('createPauseState (cas 1)', () => {
  test('{ paused: false, reason: null }, gelé', () => {
    const s = createPauseState();
    assert.deepEqual({ ...s }, { paused: false, reason: null });
    assert.ok(Object.isFrozen(s));
  });

  test('deux appels donnent deux états équivalents', () => {
    assert.deepEqual({ ...createPauseState() }, { ...createPauseState() });
  });
});

describe('pauseGame (cas 2 et 3)', () => {
  for (const reason of REASONS) {
    test(`raison ${reason} : nouvel objet gelé, paused true, raison conservée`, () => {
      const s0 = createPauseState();
      const s1 = pauseGame(s0, reason);
      assert.notEqual(s1, s0);
      assert.ok(Object.isFrozen(s1));
      assert.deepEqual({ ...s1 }, { paused: true, reason });
      // L'état d'origine n'est pas muté.
      assert.deepEqual({ ...s0 }, { paused: false, reason: null });
    });
  }

  test('déjà en pause : même référence, première raison conservée (MANUAL puis BLUR)', () => {
    const s1 = pauseGame(createPauseState(), PAUSE_REASON.MANUAL);
    const s2 = pauseGame(s1, PAUSE_REASON.BLUR);
    assert.equal(s2, s1);
    assert.equal(s2.reason, PAUSE_REASON.MANUAL);
    assert.equal(pauseGame(s1, PAUSE_REASON.HIDDEN), s1);
    assert.equal(pauseGame(s1, PAUSE_REASON.MANUAL), s1);
  });

  test('BLUR puis MANUAL : BLUR conservé', () => {
    const s1 = pauseGame(createPauseState(), PAUSE_REASON.BLUR);
    assert.equal(pauseGame(s1, PAUSE_REASON.MANUAL).reason, PAUSE_REASON.BLUR);
  });
});

describe('resumeGame (cas 4)', () => {
  for (const reason of REASONS) {
    test(`en pause (${reason}) : nouvel état { paused: false, reason: null }`, () => {
      const s1 = pauseGame(createPauseState(), reason);
      const s2 = resumeGame(s1);
      assert.notEqual(s2, s1);
      assert.ok(Object.isFrozen(s2));
      assert.deepEqual({ ...s2 }, { paused: false, reason: null });
      assert.deepEqual({ ...s1 }, { paused: true, reason });
    });
  }

  test('hors pause : même référence', () => {
    const s0 = createPauseState();
    assert.equal(resumeGame(s0), s0);
  });
});

describe('isPaused (cas 5)', () => {
  test('false, puis true, puis false sur un cycle pause / reprise', () => {
    let s = createPauseState();
    assert.equal(isPaused(s), false);
    s = pauseGame(s, PAUSE_REASON.MANUAL);
    assert.equal(isPaused(s), true);
    s = resumeGame(s);
    assert.equal(isPaused(s), false);
    s = pauseGame(s, PAUSE_REASON.HIDDEN);
    assert.equal(isPaused(s), true);
  });
});

describe('canPause (cas 6)', () => {
  test('vrai hors pause avec une partie en cours', () => {
    assert.equal(canPause(createPauseState(), createGameState()), true);
  });

  test('faux en pause', () => {
    const paused = pauseGame(createPauseState(), PAUSE_REASON.MANUAL);
    assert.equal(canPause(paused, createGameState()), false);
  });

  test('faux si la partie est WON', () => {
    assert.equal(canPause(createPauseState(), wonState()), false);
  });

  test('faux si la partie est LOST', () => {
    const lost = declareDefeat(createGameState());
    assert.equal(lost.status, GAME_STATUS.LOST);
    assert.equal(canPause(createPauseState(), lost), false);
  });

  test('vrai de nouveau après la reprise', () => {
    const s = resumeGame(pauseGame(createPauseState(), PAUSE_REASON.BLUR));
    assert.equal(canPause(s, createGameState()), true);
  });
});

describe('erreurs (cas 7)', () => {
  const BAD_STATES = [
    null,
    undefined,
    42,
    'paused',
    true,
    {},
    { paused: 'true', reason: null },
    { paused: 1, reason: null },
    { paused: null, reason: null },
  ];

  for (const bad of BAD_STATES) {
    const label = JSON.stringify(bad) ?? String(bad);
    test(`état mal formé ${label} : TypeError partout`, () => {
      assert.throws(() => pauseGame(bad, PAUSE_REASON.MANUAL), TypeError);
      assert.throws(() => resumeGame(bad), TypeError);
      assert.throws(() => isPaused(bad), TypeError);
      assert.throws(() => canPause(bad, createGameState()), TypeError);
    });
  }

  test('raison inconnue ou non chaîne : TypeError', () => {
    const s = createPauseState();
    for (const reason of ['', 'Manual', 'pause', 'toString', '__proto__', null, undefined, 0, {}, ['manual']]) {
      assert.throws(() => pauseGame(s, reason), TypeError, String(reason));
    }
  });

  test('raison inconnue même déjà en pause : TypeError', () => {
    const s = pauseGame(createPauseState(), PAUSE_REASON.MANUAL);
    assert.throws(() => pauseGame(s, 'nope'), TypeError);
  });

  test('canPause : gameState mal formé -> TypeError', () => {
    const s = createPauseState();
    for (const bad of [null, undefined, 3, 'playing', {}, { status: 'nope' }]) {
      assert.throws(() => canPause(s, bad), TypeError, JSON.stringify(bad) ?? String(bad));
    }
  });

  test('canPause : gameState mal formé même en pause -> TypeError', () => {
    const s = pauseGame(createPauseState(), PAUSE_REASON.MANUAL);
    assert.throws(() => canPause(s, null), TypeError);
  });
});

describe('règle de couche', () => {
  test('pause.js est pur et n’importe que ./game-state.js', () => {
    const code = readFileSync(fileURLToPath(new URL('../../src/game/pause.js', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const word of ['document', 'window', 'Date', 'performance', 'requestAnimationFrame', 'setTimeout']) {
      assert.doesNotMatch(code, new RegExp(`\\b${word}\\b`), word);
    }
    const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.deepEqual(imports, ['./game-state.js']);
  });
});
