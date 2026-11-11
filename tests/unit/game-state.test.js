// Plan docs/design/dark-sortie-victoire.md §3.3 et §6 (game-state.js).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAME_STATUS,
  createGameState,
  isGameOver,
  checkVictory,
  declareDefeat,
} from '../../src/game/game-state.js';

const exit = Object.freeze({ tx: 5, ty: 3 });
const onExit = Object.freeze({ x: 5.5, y: 3.5 });
const offExit = Object.freeze({ x: 1.5, y: 1.5 });

describe('GAME_STATUS et createGameState', () => {
  test('constantes gelées', () => {
    assert.deepEqual({ ...GAME_STATUS }, { PLAYING: 'playing', WON: 'won', LOST: 'lost' });
    assert.ok(Object.isFrozen(GAME_STATUS));
  });

  test('état initial PLAYING gelé, nouvel objet à chaque appel', () => {
    const s = createGameState();
    assert.equal(s.status, GAME_STATUS.PLAYING);
    assert.ok(Object.isFrozen(s));
    assert.equal(isGameOver(s), false);
    assert.notEqual(createGameState(), s);
  });
});

describe('checkVictory', () => {
  test('hors sortie -> même référence', () => {
    const s = createGameState();
    assert.equal(checkVictory(s, offExit, exit), s);
    assert.equal(checkVictory(s, { x: 4.99, y: 3.5 }, exit), s);
  });

  test('sur la sortie -> nouvel état WON gelé', () => {
    const s = createGameState();
    const won = checkVictory(s, onExit, exit);
    assert.notEqual(won, s);
    assert.equal(won.status, GAME_STATUS.WON);
    assert.ok(Object.isFrozen(won));
    assert.equal(isGameOver(won), true);
    assert.equal(s.status, GAME_STATUS.PLAYING, 'l\'état d\'origine n\'est pas muté');
  });

  test('partie finie (WON ou LOST) -> même référence', () => {
    const won = checkVictory(createGameState(), onExit, exit);
    assert.equal(checkVictory(won, onExit, exit), won);
    assert.equal(checkVictory(won, offExit, exit), won);
    const lost = declareDefeat(createGameState());
    assert.equal(checkVictory(lost, onExit, exit), lost);
    assert.equal(lost.status, GAME_STATUS.LOST);
  });

  test('TypeError état, position ou exit mal formé', () => {
    const s = createGameState();
    for (const bad of [null, undefined, {}, { status: 'paused' }, 'playing']) {
      assert.throws(() => checkVictory(bad, onExit, exit), TypeError, String(bad));
    }
    for (const p of [null, { x: NaN, y: 1 }, { y: 1 }]) {
      assert.throws(() => checkVictory(s, p, exit), TypeError);
    }
    for (const e of [null, { tx: 1.5, ty: 1 }, { tx: 1 }]) {
      assert.throws(() => checkVictory(s, onExit, e), TypeError);
    }
  });
});

describe('declareDefeat et isGameOver', () => {
  test('en cours -> nouvel état LOST gelé', () => {
    const s = createGameState();
    const lost = declareDefeat(s);
    assert.notEqual(lost, s);
    assert.equal(lost.status, GAME_STATUS.LOST);
    assert.ok(Object.isFrozen(lost));
    assert.equal(isGameOver(lost), true);
  });

  test('après WON -> même référence WON (premier état final l\'emporte)', () => {
    const won = checkVictory(createGameState(), onExit, exit);
    assert.equal(declareDefeat(won), won);
    assert.equal(declareDefeat(won).status, GAME_STATUS.WON);
  });

  test('après LOST -> même référence', () => {
    const lost = declareDefeat(createGameState());
    assert.equal(declareDefeat(lost), lost);
  });

  test('isGameOver sur les trois statuts (objets construits à la main)', () => {
    assert.equal(isGameOver({ status: 'playing' }), false);
    assert.equal(isGameOver({ status: 'won' }), true);
    assert.equal(isGameOver({ status: 'lost' }), true);
  });

  test('TypeError état mal formé', () => {
    for (const bad of [null, undefined, {}, { status: 'paused' }, { status: 1 }, 'won']) {
      assert.throws(() => isGameOver(bad), TypeError, String(bad));
      assert.throws(() => declareDefeat(bad), TypeError, String(bad));
    }
  });
});
