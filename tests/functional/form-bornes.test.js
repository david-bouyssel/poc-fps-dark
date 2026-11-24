// Bornes du formulaire posées par JS depuis les constantes source (plan docs/design/form-bornes.md).
// main.js n'est pas importable (DOM au chargement) : vérification par lecture de sources.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAZE_LIMITS } from '../../src/maze/maze.js';
import { MAX_SEED } from '../../src/maze/random.js';

const MAIN_SOURCE = readFileSync(fileURLToPath(new URL('../../src/main.js', import.meta.url)), 'utf8');
const INDEX_SOURCE = readFileSync(fileURLToPath(new URL('../../src/index.html', import.meta.url)), 'utf8');

/** Balises <input> d'un id donné. */
function inputTag(id) {
  const match = INDEX_SOURCE.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(match, `balise <input id="${id}"> introuvable dans index.html`);
  return match[0];
}

/** Lignes de main.js qui affectent `<target>` (ex. `widthInput.min`). */
function assignmentLines(target) {
  const escaped = target.replace(/\./g, '\\.');
  const re = new RegExp(`\\b${escaped}\\s*=`);
  return MAIN_SOURCE.split('\n').filter((line) => re.test(line));
}

/** Vrai si une ligne affecte `target` avec la valeur `rhs` (chaîne `a.min = b.min = X` acceptée). */
function assignsValue(target, rhs) {
  const escaped = target.replace(/\./g, '\\.');
  const re = new RegExp(`\\b${escaped}\\s*=\\s*(?:[\\w.]+\\s*=\\s*)*${rhs}\\s*;`);
  return re.test(MAIN_SOURCE);
}

describe('index.html : aucune borne en dur', () => {
  for (const id of ['maze-width', 'maze-height', 'maze-seed']) {
    test(`#${id} n'a ni min= ni max=`, () => {
      const tag = inputTag(id);
      assert.doesNotMatch(tag, /\smin\s*=/);
      assert.doesNotMatch(tag, /\smax\s*=/);
    });
  }

  test('les champs gardent type, step et required (largeur, hauteur)', () => {
    assert.match(inputTag('maze-width'), /type="number"/);
    assert.match(inputTag('maze-width'), /step="1"/);
    assert.match(inputTag('maze-width'), /\srequired/);
    assert.match(inputTag('maze-height'), /type="number"/);
    assert.match(inputTag('maze-height'), /\srequired/);
  });
});

describe('main.js : bornes posées depuis les constantes', () => {
  test('widthInput et heightInput reçoivent .min depuis MAZE_LIMITS.minSize', () => {
    assert.ok(assignsValue('widthInput.min', 'String\\(\\s*MAZE_LIMITS\\.minSize\\s*\\)'));
    assert.ok(assignsValue('heightInput.min', 'String\\(\\s*MAZE_LIMITS\\.minSize\\s*\\)'));
  });

  test('widthInput et heightInput reçoivent .max depuis MAZE_LIMITS.maxSize', () => {
    assert.ok(assignsValue('widthInput.max', 'String\\(\\s*MAZE_LIMITS\\.maxSize\\s*\\)'));
    assert.ok(assignsValue('heightInput.max', 'String\\(\\s*MAZE_LIMITS\\.maxSize\\s*\\)'));
  });

  test('seedInput.max reçoit MAX_SEED', () => {
    assert.ok(assignsValue('seedInput.max', 'String\\(\\s*MAX_SEED\\s*\\)'));
  });

  test('seedInput.min vaut 0', () => {
    assert.ok(assignsValue('seedInput.min', "(?:'0'|\"0\"|String\\(\\s*0\\s*\\))"));
  });

  test('les lignes d\'affectation ne contiennent aucun littéral de borne', () => {
    const minLines = [...assignmentLines('widthInput.min'), ...assignmentLines('heightInput.min')];
    const maxLines = [...assignmentLines('widthInput.max'), ...assignmentLines('heightInput.max')];
    const seedMaxLines = assignmentLines('seedInput.max');
    for (const line of minLines) assert.doesNotMatch(line, /\b2\b/, `littéral 2 dans : ${line}`);
    for (const line of maxLines) assert.doesNotMatch(line, /\b64\b/, `littéral 64 dans : ${line}`);
    for (const line of seedMaxLines) {
      assert.doesNotMatch(line, /4294967295/, `littéral 4294967295 dans : ${line}`);
    }
  });
});

describe('accord valeurs source / champs', () => {
  test('String(MAZE_LIMITS.minSize) vaut 2', () => {
    assert.equal(String(MAZE_LIMITS.minSize), '2');
  });

  test('String(MAZE_LIMITS.maxSize) vaut 64', () => {
    assert.equal(String(MAZE_LIMITS.maxSize), '64');
  });

  test('String(MAX_SEED) vaut 4294967295', () => {
    assert.equal(String(MAX_SEED), '4294967295');
  });
});
