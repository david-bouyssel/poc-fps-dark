import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fr } from '../../src/i18n/fr.js';
import { t } from '../../src/i18n/i18n.js';

// app.title / app.subtitle : texte laissé au développeur (plan dark-renommage.md) ;
// seules la présence et la non-vacuité sont vérifiées, pas le libellé exact.
const TEXTES_LIBRES = ['app.title', 'app.subtitle'];

const EXPECTED = {
  'form.width': 'Largeur',
  'form.height': 'Hauteur',
  'form.seed': 'Graine (optionnelle)',
  'form.generate': 'Générer',
  'form.newMaze': 'Nouveau labyrinthe',
  'info.current': 'Graine : {seed} — {width} × {height}',
  'canvas.label': 'Vue de dessus du labyrinthe',
  'errors.size': 'La largeur et la hauteur doivent être des nombres entiers entre {min} et {max}.',
  'errors.seed': 'La graine doit être un nombre entier entre 0 et {max}.',
  'errors.generic': 'Impossible de générer le labyrinthe.',
};

test('fr est un objet gelé à plat', () => {
  assert.ok(Object.isFrozen(fr));
  for (const v of Object.values(fr)) assert.equal(typeof v, 'string');
});

test('toutes les clés du plan existent, chaînes non vides', () => {
  for (const key of [...Object.keys(EXPECTED), ...TEXTES_LIBRES]) {
    assert.equal(typeof fr[key], 'string', `clé manquante : ${key}`);
    assert.ok(fr[key].trim().length > 0, `clé vide : ${key}`);
  }
});

test('app.title et app.subtitle : clés présentes, non vides, issues de fr.js', () => {
  for (const key of TEXTES_LIBRES) {
    assert.equal(typeof fr[key], 'string', `clé manquante : ${key}`);
    assert.ok(fr[key].trim().length > 0, `clé vide : ${key}`);
    assert.equal(t(key), fr[key], `t(${key}) doit renvoyer fr.js`);
  }
});

test('textes conformes au plan (section 5)', () => {
  for (const [key, text] of Object.entries(EXPECTED)) {
    assert.equal(fr[key], text, key);
  }
});

test('t sans paramètre renvoie le texte', () => {
  assert.equal(t('errors.generic'), 'Impossible de générer le labyrinthe.');
});

test('t remplace les paramètres', () => {
  assert.equal(t('info.current', { seed: 42, width: 16, height: 8 }), 'Graine : 42 — 16 × 8');
  assert.equal(
    t('errors.size', { min: 2, max: 64 }),
    'La largeur et la hauteur doivent être des nombres entiers entre 2 et 64.',
  );
  assert.equal(
    t('errors.seed', { max: 4294967295 }),
    'La graine doit être un nombre entier entre 0 et 4294967295.',
  );
});

test('t : clé inconnue renvoie la clé, sans exception', () => {
  assert.equal(t('does.not.exist'), 'does.not.exist');
  assert.equal(t('does.not.exist', { a: 1 }), 'does.not.exist');
});

test('index.html : aucun texte alphabétique visible en dur', () => {
  const htmlPath = fileURLToPath(new URL('../../src/index.html', import.meta.url));
  const html = readFileSync(htmlPath, 'utf8');
  const body = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const textOutsideTags = body.replace(/<[^>]*>/g, ' ');
  const words = textOutsideTags.match(/\p{L}+/gu) ?? [];
  assert.deepEqual(words, [], `texte en dur trouvé : ${words.join(' ')}`);
});

// --- Vue FPS (plan docs/design/vue-fps.md §5) ---

const EXPECTED_FPS = {
  'fps.enter': 'Explorer en 3D',
  'fps.exit': 'Revenir à la vue de dessus',
  'fps.help': 'Avancer / reculer : Z S ou ↑ ↓ — Tourner : ← → ou A E — Pas de côté : Q D — Courir : Maj — Carte : M — Quitter : Échap',
  'canvas.labelFps': 'Vue à la première personne dans le labyrinthe',
  'canvas.labelFpsMap': 'Carte des zones explorées du labyrinthe',
};

test('vue FPS : clés fps.* et libellés canvas avec les textes du plan', () => {
  for (const [key, text] of Object.entries(EXPECTED_FPS)) {
    assert.equal(fr[key], text, key);
    assert.equal(t(key), text, `t(${key})`);
  }
});

test('vue FPS : index.html référence fps.enter, fps.exit, fps.help via data-i18n', () => {
  const htmlPath = fileURLToPath(new URL('../../src/index.html', import.meta.url));
  const html = readFileSync(htmlPath, 'utf8');
  for (const key of ['fps.enter', 'fps.exit', 'fps.help']) {
    assert.match(html, new RegExp(`data-i18n=["']${key.replace('.', '\.')}["']`), key);
  }
  for (const key of html.matchAll(/data-i18n=["']([^"']+)["']/g)) {
    assert.equal(typeof fr[key[1]], 'string', `clé inconnue dans index.html : ${key[1]}`);
  }
});

// --- Retrait des fruits et du score (plan docs/design/dark-retrait-fruits.md) ---

const REMOVED_KEYS = ['fps.score', 'fps.allCollected', 'fps.fruitPoints', 'fps.legendSeparator'];

test('retrait : aucune clé fruit.* ni fps.score / fps.allCollected / fps.fruitPoints dans fr.js', () => {
  for (const key of REMOVED_KEYS) {
    assert.equal(Object.hasOwn(fr, key), false, `clé retirée encore présente : ${key}`);
  }
  assert.deepEqual(Object.keys(fr).filter((k) => /^fruit\./.test(k)), []);
});

test('retrait : t renvoie la clé elle-même pour les clés retirées', () => {
  for (const key of [...REMOVED_KEYS, 'fruit.cherry']) {
    assert.equal(t(key), key, key);
  }
});

test('retrait : index.html ne référence aucune clé retirée via data-i18n', () => {
  const htmlPath = fileURLToPath(new URL('../../src/index.html', import.meta.url));
  const html = readFileSync(htmlPath, 'utf8');
  for (const key of REMOVED_KEYS) {
    assert.doesNotMatch(html, new RegExp(`data-i18n=["']${key.replace('.', '\.')}["']`), key);
  }
  assert.doesNotMatch(html, /data-i18n=["']fruit\./);
});

// --- Sortie et victoire (plan docs/design/dark-sortie-victoire.md §5) ---

const EXPECTED_END = {
  'fps.goal': 'Trouve la porte lumineuse de la sortie avant de te faire attraper !',
  'end.wonTitle': 'Tu t’en es sorti !',
  'end.wonMessage': 'Tu as trouvé la sortie du labyrinthe.',
  'end.lostTitle': 'Attrapé !',
  'end.lostMessage': 'Le monstre t’a rattrapé avant la sortie.',
  'end.replay': 'Rejouer',
  'end.newMaze': 'Nouveau labyrinthe',
};

test('sortie : clés fps.goal et end.* présentes, non vides, textes du plan', () => {
  for (const [key, text] of Object.entries(EXPECTED_END)) {
    assert.equal(typeof fr[key], 'string', `clé manquante : ${key}`);
    assert.ok(fr[key].trim().length > 0, `clé vide : ${key}`);
    assert.equal(fr[key], text, key);
    assert.equal(t(key), text, `t(${key})`);
  }
});

test('sortie : index.html référence fps.goal, end.replay, end.newMaze via data-i18n', () => {
  const htmlPath = fileURLToPath(new URL('../../src/index.html', import.meta.url));
  const html = readFileSync(htmlPath, 'utf8');
  for (const [id, key] of [['fps-goal', 'fps.goal'], ['replay-button', 'end.replay'], ['end-new-maze-button', 'end.newMaze']]) {
    const tag = html.match(new RegExp(`<[a-z0-9]+[^>]*id=["']${id}["'][^>]*>`));
    assert.ok(tag, `élément ${id} absent`);
    assert.match(tag[0], new RegExp(`data-i18n=["']${key.replace('.', '\.')}["']`), id);
  }
});
