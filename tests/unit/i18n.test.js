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
  'fps.help': 'Avancer / reculer : Z S ou ↑ ↓ — Tourner : ← → ou A E (ou souris après un clic dans la vue, Échap la libère) — Pas de côté : Q D — Courir : Maj — Carte : M — Pause : P — Son : X — Quitter : Échap',
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

// --- Mobile tactile (plan docs/design/mobile-tactile.md §5 et §6) ---

const TOUCH_KEYS = [
  'touch.moveGroup', 'touch.actionGroup',
  'touch.forward', 'touch.forwardLabel', 'touch.backward', 'touch.backwardLabel',
  'touch.turnLeft', 'touch.turnLeftLabel', 'touch.turnRight', 'touch.turnRightLabel',
  'touch.strafeLeft', 'touch.strafeLeftLabel', 'touch.strafeRight', 'touch.strafeRightLabel',
  'touch.run', 'touch.runLabel', 'touch.map', 'touch.mapLabel',
  'touch.pause', 'touch.pauseLabel',
  'fps.helpTouch',
];

test('tactile : clés touch.* et fps.helpTouch présentes et non vides', () => {
  for (const key of TOUCH_KEYS) {
    assert.equal(typeof fr[key], 'string', `clé manquante : ${key}`);
    assert.ok(fr[key].trim().length > 0, `clé vide : ${key}`);
  }
});

test('tactile : textes clés du plan', () => {
  assert.equal(fr['touch.forwardLabel'], 'Avancer');
  assert.equal(fr['touch.run'], 'Courir');
  assert.equal(fr['touch.map'], 'Carte');
  assert.equal(fr['fps.help'], EXPECTED_FPS['fps.help']);
});

test('tactile : index.html, chaque data-i18n et data-i18n-aria-label a sa clé', () => {
  const html = readFileSync(fileURLToPath(new URL('../../src/index.html', import.meta.url)), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-aria-label)?=["']([^"']+)["']/g)) {
    assert.equal(typeof fr[m[1]], 'string', `clé inconnue dans index.html : ${m[1]}`);
  }
  for (const key of ['touch.moveGroup', 'touch.actionGroup', 'touch.forwardLabel', 'touch.mapLabel']) {
    assert.match(html, new RegExp(`data-i18n-aria-label=["']${key.replace('.', '\.')}["']`), key);
  }
  assert.match(html, /data-i18n=["']fps\.helpTouch["']/);
});

// Couper le son (T9, plan docs/design/couper-son.md, section Textes) : libellés du bouton.
test('couper le son : sound.mute et sound.unmute au texte du plan, bouton en data-i18n', () => {
  assert.equal(fr['sound.mute'], 'Couper le son (X)');
  assert.equal(fr['sound.unmute'], 'Rétablir le son (X)');
  assert.equal(t('sound.mute'), 'Couper le son (X)');
  assert.equal(t('sound.unmute'), 'Rétablir le son (X)');
  const html = readFileSync(fileURLToPath(new URL('../../src/index.html', import.meta.url)), 'utf8');
  assert.match(html, /id=["']sound-toggle-button["'][^>]*data-i18n=["']sound\.mute["']/);
});

// Message d'erreur dédié (T4, todolist-ameliorations) : `errors.round` pour l'échec de
// création du joueur ou du monstre dans startRound(), `errors.generic` réservé à la
// génération du labyrinthe. main.js touche au DOM : on vérifie le câblage par source.
// Fins de ligne normalisées : main.js peut être en CRLF (checkout Windows).
const MAIN_SRC = readFileSync(fileURLToPath(new URL('../../src/main.js', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

function functionBody(name) {
  const start = MAIN_SRC.indexOf(`\nfunction ${name}(`);
  assert.notEqual(start, -1, `fonction absente de main.js : ${name}`);
  const end = MAIN_SRC.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `fin de fonction introuvable : ${name}`);
  return MAIN_SRC.slice(start, end + 3);
}

test('errors.round : clé présente, chaîne non vide, distincte de errors.generic', () => {
  assert.equal(typeof fr['errors.round'], 'string', 'clé manquante : errors.round');
  assert.ok(fr['errors.round'].trim().length > 0, 'clé vide : errors.round');
  assert.notEqual(fr['errors.round'], fr['errors.generic']);
  assert.equal(t('errors.round'), fr['errors.round']);
});

test('startRound : le catch affiche errors.round, pas errors.generic', () => {
  const body = functionBody('startRound');
  assert.match(body, /catch\s*\{\s*showError\('errors\.round'\)\s*;?\s*return false;?\s*\}/);
  assert.doesNotMatch(body, /errors\.generic/);
});

test('génération : le catch de generateFromForm garde errors.generic', () => {
  const body = functionBody('generateFromForm');
  assert.match(body, /catch\s*\{\s*showError\('errors\.generic'\)\s*;?\s*return false;?\s*\}/);
  assert.doesNotMatch(body, /errors\.round/);
});

// --- Pause (plan docs/design/pause.md §5 et §6, cas 11) ---

const EXPECTED_PAUSE = {
  'pause.title': 'En pause',
  'pause.message': 'Appuie sur P ou sur « Reprendre » pour continuer.',
  'pause.messageAuto': 'La partie s’est mise en pause quand la fenêtre a perdu le focus. Appuie sur P ou sur « Reprendre » pour continuer.',
  'pause.resume': 'Reprendre',
  'touch.pause': 'Pause',
  'touch.pauseLabel': 'Mettre en pause ou reprendre la partie',
};

test('pause : clés pause.*, touch.pause et touch.pauseLabel avec les textes du plan', () => {
  for (const [key, text] of Object.entries(EXPECTED_PAUSE)) {
    assert.equal(typeof fr[key], 'string', `clé manquante : ${key}`);
    assert.ok(fr[key].trim().length > 0, `clé vide : ${key}`);
    assert.equal(fr[key], text, key);
    assert.equal(t(key), text, `t(${key})`);
  }
});

test('pause : fps.help cite P puis X (son) avant Quitter, fps.helpTouch se termine par « Pause »', () => {
  assert.match(fr['fps.help'], /Pause : P — Son : X — Quitter : Échap$/);
  assert.ok(fr['fps.helpTouch'].endsWith(' « Pause » arrête la partie.'), fr['fps.helpTouch']);
});

test('pause : index.html référence pause.title, pause.resume, touch.pause et touch.pauseLabel', () => {
  const html = readFileSync(fileURLToPath(new URL('../../src/index.html', import.meta.url)), 'utf8');
  for (const key of ['pause.title', 'pause.resume', 'touch.pause']) {
    assert.match(html, new RegExp(`data-i18n=["']${key.replace('.', '\.')}["']`), key);
  }
  assert.match(html, /data-i18n-aria-label=["']touch\.pauseLabel["']/);
});

// --- Difficulté (plan docs/design/difficulte.md §5 et §6, tests 14 et 15) ---
import { DIFFICULTY_IDS } from '../../src/game/difficulty.js';

const EXPECTED_DIFFICULTY = {
  'form.difficulty': 'Difficulté',
  'difficulty.easy': 'Facile',
  'difficulty.normal': 'Normal',
  'difficulty.nightmare': 'Cauchemar',
};

function readIndexHtml() {
  return readFileSync(fileURLToPath(new URL('../../src/index.html', import.meta.url)), 'utf8');
}

test('difficulté : 4 clés avec les textes du plan, info.current inchangé', () => {
  for (const [key, text] of Object.entries(EXPECTED_DIFFICULTY)) {
    assert.equal(fr[key], text, key);
    assert.equal(t(key), text, key);
  }
  assert.equal(fr['info.current'], 'Graine : {seed} — {width} × {height}');
});

test('difficulté : index.html référence form.difficulty et les 3 difficulty.* via data-i18n', () => {
  const html = readIndexHtml();
  for (const key of Object.keys(EXPECTED_DIFFICULTY)) {
    assert.match(html, new RegExp(`data-i18n=["']${key.replace('.', '\.')}["']`), key);
  }
  assert.match(html, /<label[^>]*for=["']maze-difficulty["'][^>]*data-i18n=["']form\.difficulty["']/);
});

test('difficulté : <option> de #maze-difficulty = DIFFICULTY_IDS dans l\'ordre, normal selected', () => {
  const html = readIndexHtml();
  const m = html.match(/<select[^>]*id=["']maze-difficulty["'][^>]*>([\s\S]*?)<\/select>/);
  assert.ok(m, 'select #maze-difficulty absent');
  const options = [...m[1].matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)];
  const values = options.map((o) => o[1].match(/value=["']([^"']*)["']/)[1]);
  assert.deepEqual(values, [...DIFFICULTY_IDS]);
  const selected = options.filter((o) => /\sselected\b/.test(o[1]));
  assert.equal(selected.length, 1, 'une seule option selected');
  assert.match(selected[0][1], /value=["']normal["']/);
  for (const o of options) assert.equal(o[2].trim(), '', 'texte en dur dans une <option>');
  // Placé dans #maze-form, après la graine, avant les boutons.
  const form = html.indexOf('id="maze-form"');
  const seed = html.indexOf('id="maze-seed"');
  const select = html.indexOf('id="maze-difficulty"');
  const buttons = html.indexOf('class="buttons"');
  assert.ok(form >= 0 && form < seed && seed < select, 'select avant la graine ou hors formulaire');
  if (buttons >= 0) assert.ok(select < buttons, 'select après .buttons');
});

// Rotation à la souris (plan docs/design/souris-pointer-lock.md §5, §6.6)
test('souris : fps.help mentionne la souris après un clic, fps.helpTouch sans souris', () => {
  assert.match(fr['fps.help'], /Tourner : ← → ou A E \(ou souris après un clic dans la vue, Échap la libère\) — /);
  assert.ok(fr['fps.help'].includes('souris'));
  assert.ok(!fr['fps.helpTouch'].includes('souris'));
});

// Partage par URL (plan docs/design/partage-url.md §5)
const EXPECTED_SHARE = {
  'share.label': 'Lien de cette partie',
  'share.copy': 'Copier le lien',
  'share.copied': 'Lien copié dans le presse-papiers.',
  'share.copyManual': 'Copie automatique impossible : le lien est sélectionné, copie-le à la main.',
  'errors.sharedLink': 'Le lien partagé est invalide : un labyrinthe aléatoire a été généré à la place.',
};

test('partage : cinq clés présentes, non vides, textes du plan', () => {
  for (const [key, text] of Object.entries(EXPECTED_SHARE)) {
    assert.equal(typeof fr[key], 'string', `clé manquante : ${key}`);
    assert.ok(fr[key].trim().length > 0, `clé vide : ${key}`);
    assert.equal(fr[key], text, key);
  }
});

test('partage : index.html, bloc #share-panel sous #maze-error, libellés via data-i18n', () => {
  const html = readFileSync(fileURLToPath(new URL('../../src/index.html', import.meta.url)), 'utf8');
  const error = html.indexOf('id="maze-error"');
  const panel = html.indexOf('id="share-panel"');
  assert.ok(error >= 0 && panel > error, '#share-panel absent ou avant #maze-error');
  assert.match(html, /<label[^>]*for=["']share-link["'][^>]*data-i18n=["']share\.label["'][^>]*><\/label>/);
  const input = html.match(/<input[^>]*id=["']share-link["'][^>]*>/);
  assert.ok(input, '#share-link absent');
  assert.match(input[0], /type=["']text["']/);
  assert.match(input[0], /\sreadonly[\s>]/);
  assert.match(html, /<button[^>]*id=["']share-copy-button["'][^>]*type=["']button["'][^>]*data-i18n=["']share\.copy["'][^>]*><\/button>/);
  assert.match(html, /<p[^>]*id=["']share-status["'][^>]*aria-live=["']polite["'][^>]*><\/p>/);
});
