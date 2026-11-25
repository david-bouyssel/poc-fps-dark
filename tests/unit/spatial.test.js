import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPATIAL, relativeLateral, stereoPan } from '../../src/audio/spatial.js';
import { captionSide } from '../../src/audio/sound-captions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const spatialSource = readFileSync(path.join(root, 'src', 'audio', 'spatial.js'), 'utf8');

const EPS = 1e-9;
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < EPS, `${msg ?? ''} attendu ${expected}, obtenu ${actual}`);
const ORIGIN = (angle) => Object.freeze({ x: 0, y: 0, angle });

describe('spatial.js : constantes', () => {
  test('maxPan strictement dans ]0, 1[ et centerDistance >= 0', () => {
    assert.ok(SPATIAL.maxPan > 0 && SPATIAL.maxPan < 1);
    assert.ok(SPATIAL.centerDistance >= 0);
    assert.ok(Object.isFrozen(SPATIAL));
  });
});

describe('relativeLateral : repères du plan (joueur en (0, 0))', () => {
  test('est (angle 0) : sud (+y) = +1, nord (-y) = -1, devant = 0, derrière = 0', () => {
    near(relativeLateral(ORIGIN(0), { x: 0, y: 5 }), 1, 'sud');
    near(relativeLateral(ORIGIN(0), { x: 0, y: -5 }), -1, 'nord');
    assert.equal(relativeLateral(ORIGIN(0), { x: 5, y: 0 }), 0, 'devant');
    assert.equal(relativeLateral(ORIGIN(0), { x: -5, y: 0 }), 0, 'derrière');
  });

  test('angle PI/2 (sud) : est (+x) = -1', () => {
    near(relativeLateral(ORIGIN(Math.PI / 2), { x: 5, y: 0 }), -1, 'est vu du sud');
    near(relativeLateral(ORIGIN(Math.PI / 2), { x: -5, y: 0 }), 1, 'ouest vu du sud');
  });

  test('diagonale (5, 5) à angle 0 : 1/sqrt(2)', () => {
    near(relativeLateral(ORIGIN(0), { x: 5, y: 5 }), Math.SQRT1_2, 'diagonale');
  });

  test('source proche du joueur (0.1, 0.1) : 0 (sous centerDistance)', () => {
    assert.equal(relativeLateral(ORIGIN(0), { x: 0.1, y: 0.1 }), 0);
  });

  test('source exactement sur le joueur : 0, sans NaN', () => {
    const v = relativeLateral(ORIGIN(0.7), { x: 0, y: 0 });
    assert.equal(v, 0);
    assert.ok(!Number.isNaN(v));
  });
});

describe('relativeLateral : propriétés', () => {
  test('symétrie : réfléchir la source par rapport à l’axe du regard change le signe', () => {
    const points = [{ x: 3, y: 1 }, { x: -2, y: 4 }, { x: 0.5, y: -6 }, { x: 7, y: 2.5 }];
    for (const angle of [0, 0.4, 1.3, -2.2]) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      for (const p of points) {
        // Réflexion par rapport à la droite du regard : composante latérale opposée.
        const along = p.x * c + p.y * s;
        const across = -p.x * s + p.y * c;
        const mirrored = { x: along * c + across * s, y: along * s - across * c };
        near(relativeLateral(ORIGIN(angle), mirrored), -relativeLateral(ORIGIN(angle), p), `angle ${angle}`);
      }
    }
  });

  test('invariance par translation : joueur et source décalés du même vecteur', () => {
    const listener = { x: 3, y: -2, angle: 1.1 };
    const source = { x: 7, y: 1 };
    const dx = source.x - listener.x;
    const dy = source.y - listener.y;
    near(relativeLateral(listener, source), relativeLateral(ORIGIN(1.1), { x: dx, y: dy }), 'translation');
  });

  test('angle hors [0, 2PI) : même résultat que l’angle normalisé', () => {
    const source = { x: 2, y: 3 };
    near(relativeLateral(ORIGIN(-Math.PI / 2), source), relativeLateral(ORIGIN(3 * Math.PI / 2), source), '-PI/2');
    near(relativeLateral(ORIGIN(5 * Math.PI / 2), source), relativeLateral(ORIGIN(Math.PI / 2), source), '5PI/2');
  });

  test('bornes : balayage d’angles et de positions, valeurs dans [-1, 1], jamais NaN ni -0', () => {
    for (let i = -40; i <= 40; i++) {
      const angle = i * 0.37;
      for (let j = -12; j <= 12; j++) {
        for (let k = -12; k <= 12; k++) {
          const v = relativeLateral(ORIGIN(angle), { x: j * 0.9, y: k * 0.9 });
          assert.ok(v >= -1 && v <= 1, `hors bornes : ${v}`);
          assert.ok(!Number.isNaN(v));
          assert.ok(!Object.is(v, -0), 'zéro négatif');
        }
      }
    }
  });

  test('options centerDistance : 0 rend le petit écart non nul', () => {
    near(relativeLateral(ORIGIN(0), { x: 0.1, y: 0.1 }, { centerDistance: 0 }), Math.SQRT1_2, 'centerDistance 0');
  });
});

describe('stereoPan : sortie pour le lecteur', () => {
  test('repères : sud = maxPan, nord = -maxPan, devant et derrière = 0, PI/2 est = -maxPan', () => {
    near(stereoPan(ORIGIN(0), { x: 0, y: 5 }), SPATIAL.maxPan, 'sud');
    near(stereoPan(ORIGIN(0), { x: 0, y: -5 }), -SPATIAL.maxPan, 'nord');
    assert.equal(stereoPan(ORIGIN(0), { x: 5, y: 0 }), 0, 'devant');
    assert.equal(stereoPan(ORIGIN(0), { x: -5, y: 0 }), 0, 'derrière');
    near(stereoPan(ORIGIN(Math.PI / 2), { x: 5, y: 0 }), -SPATIAL.maxPan, 'est vu du sud');
  });

  test('diagonale (5, 5) : 0.8 / sqrt(2)', () => {
    near(stereoPan(ORIGIN(0), { x: 5, y: 5 }), 0.8 * Math.SQRT1_2, 'diagonale');
  });

  test('bornes : dans [-maxPan, maxPan], jamais NaN ni -0, sur un balayage', () => {
    for (let i = -20; i <= 20; i++) {
      const angle = i * 0.61;
      for (let j = -10; j <= 10; j++) {
        for (let k = -10; k <= 10; k++) {
          const v = stereoPan(ORIGIN(angle), { x: j * 0.7, y: k * 0.7 });
          assert.ok(v >= -SPATIAL.maxPan - EPS && v <= SPATIAL.maxPan + EPS, `hors bornes : ${v}`);
          assert.ok(!Number.isNaN(v));
          assert.ok(!Object.is(v, -0));
        }
      }
    }
  });

  test('source sur le joueur : 0 (et jamais -0)', () => {
    const v = stereoPan(ORIGIN(0), { x: 0, y: 0 });
    assert.equal(v, 0);
    assert.ok(!Object.is(v, -0));
  });

  test('options maxPan : 1 donne 1 au repère sud, 0 donne 0 partout', () => {
    near(stereoPan(ORIGIN(0), { x: 0, y: 5 }, { maxPan: 1 }), 1, 'maxPan 1');
    for (const p of [{ x: 0, y: 5 }, { x: 0, y: -5 }, { x: 3, y: 4 }]) {
      assert.equal(stereoPan(ORIGIN(0.3), p, { maxPan: 0 }), 0);
    }
  });

  test('erreurs : listener ou source non objet, coordonnées non finies -> TypeError', () => {
    assert.throws(() => stereoPan(null, { x: 1, y: 1 }), TypeError);
    assert.throws(() => stereoPan(ORIGIN(0), null), TypeError);
    assert.throws(() => stereoPan(ORIGIN(0), 'x'), TypeError);
    assert.throws(() => stereoPan({ x: NaN, y: 0, angle: 0 }, { x: 1, y: 1 }), TypeError);
    assert.throws(() => stereoPan(ORIGIN(Infinity), { x: 1, y: 1 }), TypeError);
    assert.throws(() => stereoPan(ORIGIN(0), { x: 1, y: -Infinity }), TypeError);
  });

  test('erreurs : maxPan 1.5, -1 ou NaN -> RangeError', () => {
    for (const maxPan of [1.5, -1, NaN]) {
      assert.throws(() => stereoPan(ORIGIN(0), { x: 0, y: 5 }, { maxPan }), RangeError, `maxPan ${maxPan}`);
    }
  });
});

describe('spatial.js : cohérence avec le côté des sous-titres', () => {
  const EAST = ORIGIN(0);
  test('droite / gauche : même signe que captionSide, devant / derrière : pas de latéral', () => {
    const cases = [
      [{ x: 0, y: 5 }, 'right'],
      [{ x: 0, y: -5 }, 'left'],
      [{ x: 4, y: 3 }, 'right'],
      [{ x: 4, y: -3 }, 'left'],
      [{ x: -2, y: 6 }, 'right'],
      [{ x: 5, y: 0 }, 'front'],
      [{ x: -5, y: 0 }, 'back'],
    ];
    for (const [source, side] of cases) {
      assert.equal(captionSide(EAST, source), side, `captionSide ${JSON.stringify(source)}`);
      const lateral = relativeLateral(EAST, source);
      if (side === 'right') assert.ok(lateral > 0, `${JSON.stringify(source)} : ${lateral}`);
      else if (side === 'left') assert.ok(lateral < 0, `${JSON.stringify(source)} : ${lateral}`);
      else assert.equal(lateral, 0, `${side} : latéral nul attendu`);
    }
  });
});

describe('spatial.js : pureté', () => {
  const code = spatialSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');

  test('aucun import ni export from', () => {
    assert.doesNotMatch(code, /^\s*import\b/m);
    assert.doesNotMatch(code, /\bfrom\s*['"]/);
  });

  test('aucune API Web Audio, aucun DOM, aucun accès global', () => {
    assert.doesNotMatch(code, /\.create\w+\s*\(|AudioContext|AudioParam|\bctx\b|\.connect\s*\(/);
    assert.doesNotMatch(code, /\bwindow\b|\bdocument\b|\bglobalThis\b|\bnavigator\b|\bgetElementById\b/);
    assert.doesNotMatch(code, /\bfetch\b|XMLHttpRequest|WebSocket|localStorage|sessionStorage/);
  });
});
