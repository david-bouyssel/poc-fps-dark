// Plan docs/design/chrono-bilan.md (T7, voie courte) : bilan de manche pur.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createRoundStats,
  advanceStats,
  exploredRatio,
  formatDuration,
  formatDistance,
} from '../../src/game/round-stats.js';
import { t } from '../../src/i18n/i18n.js';
import { fr } from '../../src/i18n/fr.js';

const FLOOR = 0;
const WALL = 1;

function grid(width, height, values) {
  return { width, height, tiles: Uint8Array.from(values) };
}

describe('createRoundStats et advanceStats', () => {
  test('bilan vierge : temps 0, distance 0, objet gelé', () => {
    const stats = createRoundStats();
    assert.deepEqual({ ...stats }, { elapsed: 0, distance: 0 });
    assert.ok(Object.isFrozen(stats));
  });

  test('cumul de dt sur plusieurs pas', () => {
    let stats = createRoundStats();
    const p = { x: 1, y: 1 };
    stats = advanceStats(stats, 0.25, p, p);
    stats = advanceStats(stats, 0.5, p, p);
    stats = advanceStats(stats, 0, p, p);
    assert.equal(stats.elapsed, 0.75);
  });

  test('distance diagonale : hypot du déplacement réel', () => {
    const stats = advanceStats(createRoundStats(), 0.1, { x: 0, y: 0 }, { x: 3, y: 4 });
    assert.equal(stats.distance, 5);
    const diag = advanceStats(createRoundStats(), 0.1, { x: 2, y: 2 }, { x: 3, y: 3 });
    assert.ok(Math.abs(diag.distance - Math.SQRT2) < 1e-12);
  });

  test('immobile : distance inchangée, temps cumulé', () => {
    const p = { x: 4.5, y: 2 };
    const stats = advanceStats(createRoundStats(), 1.5, p, { x: 4.5, y: 2 });
    assert.equal(stats.distance, 0);
    assert.equal(stats.elapsed, 1.5);
  });

  test('ne modifie pas le bilan reçu, renvoie un objet gelé', () => {
    const before = createRoundStats();
    const after = advanceStats(before, 1, { x: 0, y: 0 }, { x: 1, y: 0 });
    assert.deepEqual({ ...before }, { elapsed: 0, distance: 0 });
    assert.notEqual(after, before);
    assert.ok(Object.isFrozen(after));
  });

  test('entrées invalides : TypeError', () => {
    const p = { x: 0, y: 0 };
    const s = createRoundStats();
    assert.throws(() => advanceStats(s, -0.1, p, p), TypeError);
    assert.throws(() => advanceStats(s, Number.NaN, p, p), TypeError);
    assert.throws(() => advanceStats(s, Infinity, p, p), TypeError);
    assert.throws(() => advanceStats(s, '1', p, p), TypeError);
    assert.throws(() => advanceStats(s, 1, null, p), TypeError);
    assert.throws(() => advanceStats(s, 1, p, { x: Number.NaN, y: 0 }), TypeError);
    assert.throws(() => advanceStats(s, 1, { x: 0 }, p), TypeError);
    assert.throws(() => advanceStats(null, 1, p, p), TypeError);
    assert.throws(() => advanceStats({ elapsed: 0 }, 1, p, p), TypeError);
  });
});

describe('exploredRatio', () => {
  // Sol : indices 0, 1, 2 ; mur : indice 3.
  const g = grid(4, 1, [FLOOR, FLOOR, FLOOR, WALL]);

  test('masque vierge : 0', () => {
    assert.equal(exploredRatio(new Uint8Array(4), g), 0);
  });

  test('tout le sol exploré : 100', () => {
    assert.equal(exploredRatio(Uint8Array.from([1, 1, 1, 0]), g), 100);
  });

  test('partiel : 2 tuiles sol sur 3 -> 66 (arrondi inférieur)', () => {
    assert.equal(exploredRatio(Uint8Array.from([1, 1, 0, 0]), g), 66);
  });

  test('arrondi inférieur : 1 sur 3 -> 33', () => {
    assert.equal(exploredRatio(Uint8Array.from([0, 1, 0, 0]), g), 33);
  });

  test('murs exclus : marquer seulement un mur ne compte pas', () => {
    assert.equal(exploredRatio(Uint8Array.from([0, 0, 0, 1]), g), 0);
  });

  test('murs exclus du dénominateur : sol seul marqué sur grille à murs -> 100', () => {
    const wallsHeavy = grid(4, 1, [WALL, WALL, FLOOR, WALL]);
    assert.equal(exploredRatio(Uint8Array.from([0, 0, 1, 0]), wallsHeavy), 100);
  });

  test('grille sans tuile libre : 0 (pas de division par zéro)', () => {
    assert.equal(exploredRatio(Uint8Array.from([1, 1]), grid(2, 1, [WALL, WALL])), 0);
  });

  test('résultat entier dans 0..100', () => {
    const big = grid(7, 7, new Array(49).fill(FLOOR));
    for (let k = 0; k <= 49; k += 1) {
      const explored = new Uint8Array(49);
      explored.fill(1, 0, k);
      const r = exploredRatio(explored, big);
      assert.ok(Number.isInteger(r) && r >= 0 && r <= 100, `r=${r} pour k=${k}`);
    }
  });

  test('entrées mal formées : TypeError', () => {
    assert.throws(() => exploredRatio(new Uint8Array(3), g), TypeError);
    assert.throws(() => exploredRatio([0, 0, 0, 0], g), TypeError);
    assert.throws(() => exploredRatio(new Uint8Array(4), null), TypeError);
    assert.throws(() => exploredRatio(new Uint8Array(4), { width: 4, height: 1, tiles: [0, 0, 0, 1] }), TypeError);
    assert.throws(() => exploredRatio(new Uint8Array(4), { width: 2.5, height: 1, tiles: new Uint8Array(4) }), TypeError);
  });
});

describe('formatDuration', () => {
  test('valeurs du plan : 0, 7.9, 59.9, 60, 725', () => {
    assert.equal(formatDuration(0), '0:00');
    assert.equal(formatDuration(7.9), '0:07');
    assert.equal(formatDuration(59.9), '0:59');
    assert.equal(formatDuration(60), '1:00');
    assert.equal(formatDuration(725), '12:05');
  });

  test('minutes non bornées à 59', () => {
    assert.equal(formatDuration(3600), '60:00');
  });

  test('erreurs : négatif ou non fini -> RangeError, non-nombre -> TypeError', () => {
    assert.throws(() => formatDuration(-1), RangeError);
    assert.throws(() => formatDuration(Number.NaN), RangeError);
    assert.throws(() => formatDuration(Infinity), RangeError);
    assert.throws(() => formatDuration('5'), TypeError);
    assert.throws(() => formatDuration(undefined), TypeError);
  });
});

describe('formatDistance', () => {
  test('virgule française, une décimale : 12.34 -> "12,3"', () => {
    assert.equal(formatDistance(12.34), '12,3');
  });

  test('zéro et entier : "0,0", "3,0"', () => {
    assert.equal(formatDistance(0), '0,0');
    assert.equal(formatDistance(3), '3,0');
  });

  test('aucun point décimal dans la sortie', () => {
    assert.ok(!formatDistance(12.34).includes('.'));
  });

  test('erreurs : négatif ou non fini -> RangeError, non-nombre -> TypeError', () => {
    assert.throws(() => formatDistance(-0.5), RangeError);
    assert.throws(() => formatDistance(Number.NaN), RangeError);
    assert.throws(() => formatDistance(Infinity), RangeError);
    assert.throws(() => formatDistance('3'), TypeError);
    assert.throws(() => formatDistance(null), TypeError);
  });
});

describe('pureté et textes du bilan', () => {
  test('module pur : aucun DOM, horloge ni aléa ; seul import = grille', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../src/game/round-stats.js', import.meta.url)),
      'utf8',
    );
    assert.doesNotMatch(src, /\bdocument\b|\bwindow\b|\bDate\b|\bperformance\b/);
    assert.doesNotMatch(src, /requestAnimationFrame|setTimeout|Math\.random/);
    const imports = src.match(/^import .* from '[^']+';$/gm) ?? [];
    assert.deepEqual(imports, ["import { TILE } from '../maze/grid.js';"]);
  });

  test('clés end.statTime, end.statExplored, end.statDistance : textes du plan', () => {
    assert.equal(fr['end.statTime'], 'Temps : {value}');
    assert.equal(fr['end.statExplored'], 'Labyrinthe exploré : {value} %');
    assert.equal(fr['end.statDistance'], 'Distance parcourue : {value} tuiles');
    assert.equal(t('end.statTime', { value: '0:07' }), 'Temps : 0:07');
    assert.equal(t('end.statExplored', { value: 42 }), 'Labyrinthe exploré : 42 %');
    assert.equal(t('end.statDistance', { value: '12,3' }), 'Distance parcourue : 12,3 tuiles');
  });

  test('index.html : ul#end-stats avec les 3 li de bilan, sous #end-message', () => {
    const html = readFileSync(
      fileURLToPath(new URL('../../src/index.html', import.meta.url)),
      'utf8',
    );
    const ul = html.match(/<ul[^>]*id="end-stats"[^>]*>([\s\S]*?)<\/ul>/);
    assert.ok(ul, 'ul#end-stats absent');
    for (const id of ['end-stat-time', 'end-stat-explored', 'end-stat-distance']) {
      assert.match(ul[1], new RegExp(`<li[^>]*id="${id}"`), id);
    }
    assert.ok(html.indexOf('id="end-message"') < html.indexOf('id="end-stats"'));
  });
});
