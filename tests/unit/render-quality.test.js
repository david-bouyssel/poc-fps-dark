// Tests de la qualité de rendu adaptative (docs/design/rendu-adaptatif.md, T16) :
// moyenne mobile exponentielle des dt, passage à 3 puis 4 px au-delà du seuil, retour à 2 px,
// backoff après aller-retour, dt ignorés, columnWidthFor, pureté du module, et câblage
// de la remise à zéro dans main.js (entrée en FPS, début de manche).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  RENDER_QUALITY,
  createRenderQuality,
  stepRenderQuality,
  columnWidthFor,
} from '../../src/game/render-quality.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Image lente (40 ms) et rapide (8 ms), en secondes. */
const SLOW_DT = 0.04;
const FAST_DT = 0.008;
/** Image « moyenne » entre les seuils fastMs (18) et slowMs (24) : zone morte. */
const MID_DT = 0.021;

/** Applique n fois la même image à l'état ; renvoie le nouvel état. */
function feed(state, dt, n) {
  let s = state;
  for (let i = 0; i < n; i++) s = stepRenderQuality(s, dt);
  return s;
}

/** Applique des images jusqu'à ce que le niveau change ; renvoie { state, frames } ou lève. */
function framesUntilLevelChange(state, dt, maxFrames = 100000) {
  let s = state;
  for (let i = 1; i <= maxFrames; i++) {
    const next = stepRenderQuality(s, dt);
    if (next.level !== s.level) return { state: next, frames: i };
    s = next;
  }
  throw new Error('aucun changement de niveau');
}

describe('RENDER_QUALITY : réglages', () => {
  test('objet gelé, largeurs 2, 3, 4 dans l\'ordre du plus fin au plus grossier', () => {
    assert.ok(Object.isFrozen(RENDER_QUALITY));
    assert.ok(Object.isFrozen(RENDER_QUALITY.widths));
    assert.deepEqual([...RENDER_QUALITY.widths], [2, 3, 4]);
  });

  test('seuils et délais : valeurs du plan', () => {
    assert.equal(RENDER_QUALITY.slowMs, 24);
    assert.equal(RENDER_QUALITY.fastMs, 18);
    assert.equal(RENDER_QUALITY.minSamples, 30);
    assert.equal(RENDER_QUALITY.minHoldSeconds, 5);
    assert.equal(RENDER_QUALITY.maxDt, 0.25);
    assert.equal(RENDER_QUALITY.maxBackoff, 12);
    assert.ok(RENDER_QUALITY.fastMs < RENDER_QUALITY.slowMs, 'zone morte non vide');
    assert.ok(RENDER_QUALITY.smoothing > 0 && RENDER_QUALITY.smoothing <= 1);
  });
});

describe('createRenderQuality : état initial', () => {
  test('rendu fin (niveau 0), aucun échantillon, backoff 1', () => {
    const s = createRenderQuality();
    assert.equal(s.level, 0);
    assert.equal(s.avgMs, null);
    assert.equal(s.samples, 0);
    assert.equal(s.hold, 0);
    assert.equal(s.backoff, 1);
    assert.equal(s.returnedToMin, false);
    assert.ok(Object.isFrozen(s));
  });

  test('chaque appel renvoie un état indépendant égal', () => {
    assert.deepEqual(createRenderQuality(), createRenderQuality());
  });
});

describe('stepRenderQuality : moyenne mobile exponentielle', () => {
  test('premier échantillon fixe la moyenne, les suivants la pondèrent', () => {
    let s = stepRenderQuality(createRenderQuality(), 0.040);
    assert.ok(Math.abs(s.avgMs - 40) < 1e-9);
    s = stepRenderQuality(s, 0.020);
    // 40 + smoothing * (20 - 40)
    assert.ok(Math.abs(s.avgMs - (40 + RENDER_QUALITY.smoothing * (20 - 40))) < 1e-9);
    assert.equal(s.samples, 2);
    assert.ok(Math.abs(s.hold - 0.060) < 1e-9);
  });

  test('la moyenne converge vers la cadence constante', () => {
    const s = feed(createRenderQuality(), 0.030, 200);
    assert.ok(Math.abs(s.avgMs - 30) < 1e-6);
  });
});

describe('stepRenderQuality : passage à 3 puis 4 px, plafond', () => {
  test('images lentes : niveau 1 (3 px) puis 2 (4 px), jamais au-delà', () => {
    let s = createRenderQuality();
    let max = 0;
    for (let i = 0; i < 1000; i++) {
      s = stepRenderQuality(s, SLOW_DT);
      max = Math.max(max, s.level);
      if (i === 150) assert.equal(s.level, 1, 'niveau 1 après ~5 s');
    }
    assert.equal(s.level, 2);
    assert.equal(max, 2, 'le niveau ne dépasse jamais 2');
    assert.equal(columnWidthFor(s), 4);
  });

  test('à chaque changement, moyenne et échantillons remis à zéro', () => {
    const before = feed(createRenderQuality(), SLOW_DT, 200);
    assert.equal(before.level, 1);
    const changed = framesUntilLevelChange(before, SLOW_DT).state;
    assert.equal(changed.level, 2);
    assert.equal(changed.avgMs, null);
    assert.equal(changed.samples, 0);
    assert.equal(changed.hold, 0);
  });
});

describe('stepRenderQuality : retour à 2 px', () => {
  test('images rapides redescendent jusqu\'à 2 px, jamais en dessous', () => {
    let s = feed(createRenderQuality(), SLOW_DT, 400);
    assert.equal(s.level, 2);
    let min = 2;
    for (let i = 0; i < 2000; i++) {
      s = stepRenderQuality(s, FAST_DT);
      min = Math.min(min, s.level);
    }
    assert.equal(min, 0, 'retour à 0 atteint');
    assert.equal(s.level, 0);
    assert.equal(columnWidthFor(s), 2);
    s = feed(s, FAST_DT, 500);
    assert.equal(s.level, 0, 'pas en dessous de 2 px');
  });
});

describe('stepRenderQuality : délais avant toute décision', () => {
  test('rien avant minSamples échantillons, même avec hold suffisant', () => {
    // 0.25 s par image : 5 s atteintes en 20 images, mais 30 échantillons exigés.
    const longFrame = RENDER_QUALITY.maxDt;
    const s29 = feed(createRenderQuality(), longFrame, RENDER_QUALITY.minSamples - 1);
    assert.ok(s29.hold >= RENDER_QUALITY.minHoldSeconds);
    assert.equal(s29.level, 0);
    const s30 = stepRenderQuality(s29, longFrame);
    assert.equal(s30.level, 1);
  });

  test('rien avant minHoldSeconds, même avec assez d\'échantillons', () => {
    // 30 échantillons de 40 ms = 1.2 s : pas de décision avant 5 s de maintien.
    const s = feed(createRenderQuality(), SLOW_DT, 60);
    assert.ok(s.samples >= RENDER_QUALITY.minSamples);
    assert.ok(s.hold < RENDER_QUALITY.minHoldSeconds);
    assert.equal(s.level, 0);
    const later = feed(s, SLOW_DT, 80);
    assert.equal(later.level, 1);
  });
});

describe('stepRenderQuality : zone morte', () => {
  test('moyenne entre fastMs et slowMs : aucun changement, depuis 0 comme depuis 1', () => {
    const fromZero = feed(createRenderQuality(), MID_DT, 1000);
    assert.equal(fromZero.level, 0);
    assert.ok(fromZero.avgMs > RENDER_QUALITY.fastMs && fromZero.avgMs < RENDER_QUALITY.slowMs);

    const up = feed(createRenderQuality(), SLOW_DT, 200);
    assert.equal(up.level, 1);
    const fromOne = feed(up, MID_DT, 1000);
    assert.equal(fromOne.level, 1);
  });
});

describe('stepRenderQuality : dt ignorés', () => {
  test('dt 0, négatif, NaN, infini, > maxDt, non-nombre : même état, même référence', () => {
    const s = feed(createRenderQuality(), MID_DT, 10);
    const invalid = [0, -0.01, NaN, Infinity, -Infinity, RENDER_QUALITY.maxDt + 0.001, '0.04', null, undefined];
    for (const dt of invalid) {
      assert.equal(stepRenderQuality(s, dt), s, `dt=${String(dt)}`);
    }
  });

  test('dt ignorés ne comptent ni dans les échantillons ni dans le maintien', () => {
    let s = createRenderQuality();
    for (let i = 0; i < 500; i++) s = stepRenderQuality(s, 0);
    for (let i = 0; i < 500; i++) s = stepRenderQuality(s, NaN);
    assert.equal(s.samples, 0);
    assert.equal(s.hold, 0);
    assert.equal(s.level, 0);
  });

  test('dt égal à maxDt est accepté', () => {
    const s = stepRenderQuality(createRenderQuality(), RENDER_QUALITY.maxDt);
    assert.equal(s.samples, 1);
  });

  test('une image à maxDt+ ne fait pas monter le niveau (onglet caché)', () => {
    let s = feed(createRenderQuality(), MID_DT, 100);
    for (let i = 0; i < 100; i++) s = stepRenderQuality(s, 5);
    assert.equal(s.level, 0);
  });
});

describe('stepRenderQuality : backoff', () => {
  test('aller-retour : le backoff double à la nouvelle dégradation (1 -> 2)', () => {
    let s = feed(createRenderQuality(), SLOW_DT, 200);
    assert.equal(s.level, 1);
    assert.equal(s.backoff, 1, 'première montée sans backoff');
    s = feed(s, FAST_DT, 2000);
    assert.equal(s.level, 0);
    assert.equal(s.returnedToMin, true);
    s = feed(s, SLOW_DT, 400);
    assert.ok(s.level >= 1);
    assert.equal(s.backoff, 2);
  });

  test('après backoff 2, la montée suivante attend environ deux fois plus longtemps', () => {
    // Chaque changement remet le maintien à zéro : on repart d'un retour à 0 juste survenu.
    let s = framesUntilLevelChange(createRenderQuality(), SLOW_DT).state;
    s = framesUntilLevelChange(s, FAST_DT).state;
    assert.equal(s.level, 0);
    assert.equal(s.backoff, 1);
    // La dégradation 0 -> 1 se fait après 5 s (backoff 1) et porte le backoff à 2 ;
    // la dégradation suivante 1 -> 2 attend alors 10 s.
    const up = framesUntilLevelChange(s, SLOW_DT);
    assert.equal(up.state.backoff, 2);
    const next = framesUntilLevelChange(up.state, SLOW_DT);
    const base = framesUntilLevelChange(createRenderQuality(), SLOW_DT).frames;
    // 5 s / 40 ms = 125 images ; 10 s = 250 images.
    assert.ok(next.frames >= 2 * base - 10, `frames=${next.frames} base=${base}`);
  });

  test('backoff plafonné à maxBackoff après plusieurs aller-retours', () => {
    let s = createRenderQuality();
    let maxSeen = 1;
    for (let cycle = 0; cycle < 6; cycle++) {
      s = framesUntilLevelChange(s, SLOW_DT).state;
      assert.equal(s.level, 1);
      s = framesUntilLevelChange(s, FAST_DT).state;
      assert.equal(s.level, 0);
      maxSeen = Math.max(maxSeen, s.backoff);
      assert.ok(s.backoff <= RENDER_QUALITY.maxBackoff);
    }
    assert.equal(maxSeen, RENDER_QUALITY.maxBackoff);
    assert.equal(s.backoff, RENDER_QUALITY.maxBackoff);
  });

  test('createRenderQuality remet le backoff à 1', () => {
    assert.equal(createRenderQuality().backoff, 1);
  });
});

describe('stepRenderQuality : contrat', () => {
  test('état d\'entrée jamais modifié, sortie gelée', () => {
    const s = createRenderQuality();
    const snapshot = JSON.stringify(s);
    const next = stepRenderQuality(s, SLOW_DT);
    assert.equal(JSON.stringify(s), snapshot);
    assert.ok(Object.isFrozen(next));
  });

  test('déterministe : même suite d\'images, même résultat', () => {
    const seq = [SLOW_DT, FAST_DT, MID_DT, 0, SLOW_DT, NaN, FAST_DT];
    const run = () => {
      let s = createRenderQuality();
      const trace = [];
      for (let i = 0; i < 1500; i++) {
        s = stepRenderQuality(s, seq[i % seq.length]);
        trace.push(s.level);
      }
      return trace;
    };
    assert.deepEqual(run(), run());
  });

  test('état non objet : TypeError', () => {
    for (const bad of [null, undefined, 3, 'x']) {
      assert.throws(() => stepRenderQuality(bad, SLOW_DT), TypeError);
    }
  });
});

describe('columnWidthFor', () => {
  test('niveaux 0, 1, 2 -> 2, 3, 4 px', () => {
    assert.equal(columnWidthFor({ level: 0 }), 2);
    assert.equal(columnWidthFor({ level: 1 }), 3);
    assert.equal(columnWidthFor({ level: 2 }), 4);
  });

  test('toujours dans {2, 3, 4} sur toute trace de simulation', () => {
    let s = createRenderQuality();
    const allowed = new Set([2, 3, 4]);
    for (let i = 0; i < 3000; i++) {
      s = stepRenderQuality(s, i % 400 < 200 ? SLOW_DT : FAST_DT);
      assert.ok(allowed.has(columnWidthFor(s)));
    }
  });

  test('niveau hors plage ou non entier : borné, jamais hors {2, 3, 4}', () => {
    assert.equal(columnWidthFor({ level: 9 }), 4);
    assert.equal(columnWidthFor({ level: -3 }), 2);
    assert.equal(columnWidthFor({ level: 1.7 }), 3);
  });
});

describe('pureté du module (garde-fou source)', () => {
  /** Source sans commentaires (// et /* *\/) : seuls les usages réels comptent. */
  function codeOnly(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  test('src/game/render-quality.js : pas de performance, Date, Math.random ni DOM', () => {
    const src = codeOnly(readFileSync(join(ROOT, 'src', 'game', 'render-quality.js'), 'utf8'));
    for (const word of ['performance', 'Date', 'Math.random', 'document', 'window', 'requestAnimationFrame']) {
      assert.ok(!src.includes(word), `${word} interdit dans render-quality.js`);
    }
  });

  test('src/render/ : aucun usage de performance', () => {
    const dir = join(ROOT, 'src', 'render');
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
      const src = codeOnly(readFileSync(join(dir, name), 'utf8'));
      assert.ok(!src.includes('performance'), `performance dans src/render/${name}`);
    }
  });
});

describe('câblage main.js : remise à zéro de la qualité', () => {
  const main = readFileSync(join(ROOT, 'src', 'main.js'), 'utf8');

  /** Corps d'une fonction de premier niveau (accolades équilibrées, sans commentaires). */
  function bodyOf(name) {
    const start = main.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `fonction ${name} introuvable`);
    const open = main.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < main.length; i++) {
      if (main[i] === '{') depth++;
      else if (main[i] === '}') {
        depth--;
        if (depth === 0) return main.slice(open, i + 1);
      }
    }
    throw new Error(`corps de ${name} non fermé`);
  }

  test('startRound réinitialise renderQuality', () => {
    assert.match(bodyOf('startRound'), /renderQuality\s*=\s*createRenderQuality\(\)/);
  });

  test('enterFps réinitialise renderQuality', () => {
    assert.match(bodyOf('enterFps'), /renderQuality\s*=\s*createRenderQuality\(\)/);
  });

  test('drawFpsView reçoit columnWidth issu de columnWidthFor(renderQuality)', () => {
    assert.match(main, /columnWidth:\s*columnWidthFor\(renderQuality\)/);
  });
});
