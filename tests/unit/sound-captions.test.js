import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPTION,
  CAPTION_KIND_KEY,
  CAPTION_SIDE_KEY,
  captionSide,
  selectCaptions,
  createCaptionState,
  stepCaptions,
} from '../../src/audio/sound-captions.js';
import { BONG } from '../../src/audio/bong.js';
import { ALERT, CRY } from '../../src/audio/monster-cries.js';
import { fr } from '../../src/i18n/fr.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = path.join(root, 'src');
const html = readFileSync(path.join(srcDir, 'index.html'), 'utf8');

/** Joueur orienté vers l'est (angle 0) : droite = sud (+y), comme le lancer de rayons. */
const EAST = Object.freeze({ x: 0, y: 0, angle: 0 });
const ev = (type, pathDistance, x, y) => ({ type, pathDistance, x, y });

describe('captionSide : côté d’un événement vu du joueur', () => {
  test('joueur orienté vers l’est : devant, derrière, droite (+y), gauche (-y)', () => {
    assert.equal(captionSide(EAST, { x: 5, y: 0 }), 'front');
    assert.equal(captionSide(EAST, { x: -5, y: 0 }), 'back');
    assert.equal(captionSide(EAST, { x: 0, y: 5 }), 'right');
    assert.equal(captionSide(EAST, { x: 0, y: -5 }), 'left');
  });

  test('joueur orienté vers le sud (PI/2) : la droite est à l’ouest (-x)', () => {
    const south = { x: 0, y: 0, angle: Math.PI / 2 };
    assert.equal(captionSide(south, { x: 0, y: 5 }), 'front');
    assert.equal(captionSide(south, { x: 0, y: -5 }), 'back');
    assert.equal(captionSide(south, { x: -5, y: 0 }), 'right');
    assert.equal(captionSide(south, { x: 5, y: 0 }), 'left');
  });

  test('joueur orienté vers l’ouest (PI) : la droite est au nord (-y)', () => {
    const west = { x: 0, y: 0, angle: Math.PI };
    assert.equal(captionSide(west, { x: -5, y: 0 }), 'front');
    assert.equal(captionSide(west, { x: 5, y: 0 }), 'back');
    assert.equal(captionSide(west, { x: 0, y: -5 }), 'right');
    assert.equal(captionSide(west, { x: 0, y: 5 }), 'left');
  });

  test('angle proche de 0 et de 2*PI : même côté', () => {
    for (const angle of [1e-9, 2 * Math.PI - 1e-9, 2 * Math.PI + 1e-9]) {
      const p = { x: 0, y: 0, angle };
      assert.equal(captionSide(p, { x: 5, y: 0 }), 'front', `angle ${angle}`);
      assert.equal(captionSide(p, { x: 0, y: 5 }), 'right', `angle ${angle}`);
      assert.equal(captionSide(p, { x: 0, y: -5 }), 'left', `angle ${angle}`);
    }
  });

  test('position du joueur décalée : seul le vecteur relatif compte', () => {
    const p = { x: 10, y: -4, angle: 0 };
    assert.equal(captionSide(p, { x: 13, y: -4 }), 'front');
    assert.equal(captionSide(p, { x: 10, y: 1 }), 'right');
  });

  test('seuil front/back : |sinus| < 0,38 centré, au-delà latéral', () => {
    assert.equal(CAPTION.frontBackRatio, 0.38);
    // distance 10 : sinus 0,3 (centré) puis 0,5 (latéral)
    assert.equal(captionSide(EAST, { x: Math.sqrt(100 - 9), y: 3 }), 'front');
    assert.equal(captionSide(EAST, { x: Math.sqrt(100 - 25), y: 5 }), 'right');
    assert.equal(captionSide(EAST, { x: Math.sqrt(100 - 25), y: -5 }), 'left');
    assert.equal(captionSide(EAST, { x: -Math.sqrt(100 - 9), y: 3 }), 'back');
  });

  test('source confondue avec le joueur : devant', () => {
    assert.equal(captionSide(EAST, { x: 0, y: 0 }), 'front');
  });

  test('coordonnées non finies : TypeError', () => {
    assert.throws(() => captionSide({ x: NaN, y: 0, angle: 0 }, { x: 1, y: 0 }), TypeError);
    assert.throws(() => captionSide(EAST, { x: Infinity, y: 0 }), TypeError);
    assert.throws(() => captionSide({ x: 0, y: 0 }, { x: 1, y: 0 }), TypeError);
    assert.throws(() => captionSide(EAST, { x: 1 }), TypeError);
    assert.throws(() => captionSide(EAST, { x: '1', y: 0 }), TypeError);
  });
});

describe('selectCaptions : légendes d’un pas', () => {
  test('aucun événement : []', () => {
    assert.deepEqual(selectCaptions([], EAST), []);
  });

  test('entrée non tableau : TypeError', () => {
    assert.throws(() => selectCaptions(null, EAST), TypeError);
    assert.throws(() => selectCaptions({ length: 0 }, EAST), TypeError);
  });

  test('turn proche -> bong avec le côté de l’événement', () => {
    assert.deepEqual(selectCaptions([ev('turn', 1, 0, 5)], EAST), [{ kind: 'bong', side: 'right' }]);
  });

  test('hunt proche -> alerte', () => {
    assert.deepEqual(selectCaptions([ev('hunt', 1, 5, 0)], EAST), [{ kind: 'alert', side: 'front' }]);
  });

  test('spot proche -> cri', () => {
    assert.deepEqual(selectCaptions([ev('spot', 1, 0, -5)], EAST), [{ kind: 'cry', side: 'left' }]);
  });

  test('gain nul (trop loin) : pas de légende, pour chaque type', () => {
    assert.deepEqual(selectCaptions([ev('turn', BONG.silenceDistance, 0, 5)], EAST), []);
    assert.deepEqual(selectCaptions([ev('hunt', ALERT.silenceDistance, 0, 5)], EAST), []);
    assert.deepEqual(selectCaptions([ev('spot', CRY.silenceDistance, 0, 5)], EAST), []);
    assert.deepEqual(selectCaptions([ev('turn', Infinity, 0, 5)], EAST), []);
  });

  test('type sans son (autre que turn, hunt, spot) : pas de légende', () => {
    assert.deepEqual(selectCaptions([ev('move', 1, 0, 5)], EAST), []);
  });

  test('plusieurs types : un par type, ordre bong, alerte, cri', () => {
    const captions = selectCaptions([ev('spot', 1, 0, -5), ev('turn', 1, 0, 5)], EAST);
    assert.deepEqual(captions, [
      { kind: 'bong', side: 'right' },
      { kind: 'cry', side: 'left' },
    ]);
  });

  test('même type : côté pris de l’événement de gain maximal', () => {
    // Le plus proche (pathDistance 1, à gauche) l’emporte sur le lointain (pathDistance 10, à droite).
    const captions = selectCaptions([ev('turn', 10, 0, 5), ev('turn', 1, 0, -5)], EAST);
    assert.deepEqual(captions, [{ kind: 'bong', side: 'left' }]);
  });

  test('événement lointain ignoré quand un proche du même type existe', () => {
    const captions = selectCaptions([ev('turn', BONG.silenceDistance, 0, -5), ev('turn', 2, 5, 0)], EAST);
    assert.deepEqual(captions, [{ kind: 'bong', side: 'front' }]);
  });

  test('pureté : entrées non modifiées, appels répétés identiques', () => {
    const events = [ev('turn', 1, 0, 5), ev('spot', 1, 0, -5)];
    const snapshot = JSON.stringify(events);
    const first = selectCaptions(events, EAST);
    assert.deepEqual(selectCaptions(events, EAST), first);
    assert.equal(JSON.stringify(events), snapshot);
  });

  test('événement non objet : TypeError (propagé des sélecteurs)', () => {
    assert.throws(() => selectCaptions([null], EAST), TypeError);
  });
});

describe('constantes et clés i18n', () => {
  test('CAPTION : durée 1,5 s, 3 lignes max', () => {
    assert.equal(CAPTION.duration, 1.5);
    assert.equal(CAPTION.maxLines, 3);
    assert.ok(Object.isFrozen(CAPTION));
  });

  test('chaque libellé de type et de côté existe dans fr.js', () => {
    for (const key of [...Object.values(CAPTION_KIND_KEY), ...Object.values(CAPTION_SIDE_KEY)]) {
      assert.equal(typeof fr[key], 'string', key);
      assert.notEqual(fr[key], '', key);
    }
  });

  test('textes exacts de fr.js', () => {
    assert.equal(fr['captions.bong'], '[bong bong]');
    assert.equal(fr['captions.alert'], '[alerte]');
    assert.equal(fr['captions.cry'], '[cri]');
    assert.equal(fr['captions.left'], 'à gauche');
    assert.equal(fr['captions.right'], 'à droite');
    assert.equal(fr['captions.front'], 'devant');
    assert.equal(fr['captions.back'], 'derrière');
  });
});

describe('stepCaptions : durée, rafraîchissement, délais, pureté', () => {
  test('état initial : aucune légende, délais à 0, gelé', () => {
    const state = createCaptionState();
    assert.deepEqual(state.lines, []);
    assert.deepEqual(state.cooldown, { bong: 0, alert: 0, cry: 0 });
    assert.ok(Object.isFrozen(state));
  });

  test('légende créée avec 1,5 s, disparaît après 1,5 s de temps de jeu', () => {
    let state = stepCaptions(createCaptionState(), [ev('turn', 1, 0, 5)], EAST, 0);
    assert.equal(state.lines.length, 1);
    assert.equal(state.lines[0].kind, 'bong');
    assert.equal(state.lines[0].side, 'right');
    assert.equal(state.lines[0].remaining, 1.5);
    state = stepCaptions(state, [], EAST, 1.0);
    assert.equal(state.lines.length, 1, 'encore visible à 1,0 s');
    assert.equal(state.lines[0].remaining, 0.5);
    state = stepCaptions(state, [], EAST, 0.25);
    assert.equal(state.lines.length, 1, 'encore visible à 1,25 s');
    assert.equal(state.lines[0].remaining, 0.25);
    state = stepCaptions(state, [], EAST, 0.25);
    assert.equal(state.lines.length, 0, 'retirée à 1,5 s (remaining 0)');
  });

  test('dt nul : état inchangé en contenu', () => {
    const state = stepCaptions(createCaptionState(), [ev('turn', 1, 0, 5)], EAST, 0);
    const next = stepCaptions(state, [], EAST, 0);
    assert.deepEqual(next.lines, state.lines);
  });

  test('même type déjà visible : rafraîchi, pas dupliqué, côté mis à jour', () => {
    let state = stepCaptions(createCaptionState(), [ev('turn', 1, 0, 5)], EAST, 0);
    state = stepCaptions(state, [], EAST, 1.0);
    state = stepCaptions(state, [ev('turn', 1, 0, -5)], EAST, 1.0);
    const bongs = state.lines.filter((line) => line.kind === 'bong');
    assert.equal(bongs.length, 1, 'pas de doublon');
    assert.equal(bongs[0].side, 'left');
    assert.equal(bongs[0].remaining, 1.5, 'durée repartie à 1,5 s');
  });

  test('trois types simultanés : trois lignes (maximum)', () => {
    const state = stepCaptions(createCaptionState(),
      [ev('turn', 1, 0, 5), ev('hunt', 1, 5, 0), ev('spot', 1, 0, -5)], EAST, 0);
    assert.deepEqual(state.lines.map((line) => line.kind), ['bong', 'alert', 'cry']);
    assert.ok(state.lines.length <= CAPTION.maxLines);
  });

  test('délai bong : une seconde nouvelle légende refusée avant BONG.minInterval', () => {
    let state = stepCaptions(createCaptionState(), [ev('turn', 1, 0, 5)], EAST, 0);
    state = stepCaptions(state, [], EAST, 0.25);
    state = stepCaptions(state, [ev('turn', 1, 0, 5)], EAST, 0.25);
    assert.equal(state.lines.length, 1, 'reste la légende initiale');
    assert.equal(state.lines[0].remaining, 1.0, 'pas rafraîchie pendant le délai');
    state = stepCaptions(state, [ev('turn', 1, 0, 5)], EAST, BONG.minInterval);
    assert.equal(state.lines[0].remaining, 1.5, 'rafraîchie après le délai');
  });

  test('délai alerte : ALERT.minInterval (4 s) entre deux alertes', () => {
    let state = stepCaptions(createCaptionState(), [ev('hunt', 1, 0, 5)], EAST, 0);
    assert.equal(state.cooldown.alert, ALERT.minInterval);
    state = stepCaptions(state, [ev('hunt', 1, 0, 5)], EAST, ALERT.minInterval - 0.5);
    assert.equal(state.lines.length, 0, 'première légende expirée, nouvelle refusée');
    state = stepCaptions(state, [ev('hunt', 1, 0, 5)], EAST, 0.5);
    assert.equal(state.lines.length, 1, 'nouvelle alerte à 4 s');
    assert.equal(state.lines[0].kind, 'alert');
  });

  test('délai cri : CRY.minInterval (6 s) entre deux cris', () => {
    let state = stepCaptions(createCaptionState(), [ev('spot', 1, 0, 5)], EAST, 0);
    assert.equal(state.cooldown.cry, CRY.minInterval);
    state = stepCaptions(state, [ev('spot', 1, 0, 5)], EAST, CRY.minInterval - 0.5);
    assert.equal(state.lines.length, 0);
    state = stepCaptions(state, [ev('spot', 1, 0, 5)], EAST, 0.5);
    assert.equal(state.lines.length, 1);
    assert.equal(state.lines[0].kind, 'cry');
  });

  test('pas de légende pour un gain nul, même délai écoulé', () => {
    const state = stepCaptions(createCaptionState(), [ev('turn', BONG.silenceDistance, 0, 5)], EAST, 10);
    assert.deepEqual(state.lines, []);
  });

  test('dt invalide : RangeError', () => {
    const state = createCaptionState();
    assert.throws(() => stepCaptions(state, [], EAST, -1), RangeError);
    assert.throws(() => stepCaptions(state, [], EAST, NaN), RangeError);
    assert.throws(() => stepCaptions(state, [], EAST, Infinity), RangeError);
    assert.throws(() => stepCaptions(state, [], EAST, '1'), RangeError);
  });

  test('pureté : état, événements et joueur non modifiés ; nouvel état gelé', () => {
    const state = stepCaptions(createCaptionState(), [ev('turn', 1, 0, 5)], EAST, 0);
    const before = JSON.stringify(state);
    const events = [ev('hunt', 1, 5, 0)];
    const player = { x: 0, y: 0, angle: 0 };
    const playerBefore = JSON.stringify(player);
    const next = stepCaptions(state, events, player, 0.5);
    assert.equal(JSON.stringify(state), before, 'état précédent intact');
    assert.equal(JSON.stringify(events), JSON.stringify([ev('hunt', 1, 5, 0)]));
    assert.equal(JSON.stringify(player), playerBefore);
    assert.ok(Object.isFrozen(next));
    assert.ok(Object.isFrozen(next.lines));
    assert.ok(Object.isFrozen(next.cooldown));
    assert.notEqual(next, state);
  });
});

describe('index.html et source : légendes sans texte en dur', () => {
  const tags = [...html.matchAll(/<[^>]*\sid="sound-captions"[^>]*>/g)].map((m) => m[0]);

  test('#sound-captions : une seule balise, aria-hidden, hidden au départ, sans texte', () => {
    assert.equal(tags.length, 1);
    assert.match(tags[0], /\saria-hidden="true"/);
    assert.match(tags[0], /\shidden[\s>]/);
    assert.doesNotMatch(tags[0], /aria-live|role="(status|alert)"/);
    const start = html.indexOf(tags[0]);
    const after = html.slice(start + tags[0].length, start + tags[0].length + 20);
    assert.match(after, /^<\/div>/, 'contenu vide, rempli par JS');
  });

  test('#sound-captions est dans #maze-stage', () => {
    const stage = html.indexOf('id="maze-stage"');
    const captions = html.indexOf('id="sound-captions"');
    assert.ok(stage >= 0 && captions > stage);
  });

  test('aucun libellé de légende en dur dans index.html ni dans les chaînes JS hors fr.js', () => {
    const labels = [fr['captions.bong'], fr['captions.alert'], fr['captions.cry'],
      fr['captions.left'], fr['captions.right'], fr['captions.front'], fr['captions.back']];
    assert.equal(html.includes(fr['captions.bong']), false, 'index.html');
    for (const file of listJs(srcDir)) {
      if (file.endsWith(path.join('i18n', 'fr.js'))) continue;
      const text = readFileSync(file, 'utf8');
      for (const label of labels) {
        // Chaînes JS seulement (les commentaires peuvent citer les mots).
        const quoted = [`'${label}'`, `"${label}"`, `\`${label}\``];
        for (const needle of quoted) {
          assert.ok(!text.includes(needle), `${path.relative(root, file)} contient ${needle}`);
        }
      }
    }
  });
});

function listJs(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listJs(full) : (name.endsWith('.js') ? [full] : []);
  });
}
