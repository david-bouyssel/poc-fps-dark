// Plan docs/design/annonce-traque.md (T14), §Cas de test unitaires et statiques : texte
// de l'annonce dans fr.js, zone #round-status dans index.html (role, aria-live, classe
// sr-only, hors #end-screen, sans texte en dur), classe .sr-only sans display:none.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fr } from '../../src/i18n/fr.js';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const html = read('../../src/index.html');
const css = read('../../src/styles.css');

/** Tag ouvrant de l'élément `id`, ou null. */
function openingTag(source, id) {
  const m = new RegExp(`<[a-z]+\\b[^>]*\\sid="${id}"[^>]*>`).exec(source);
  return m ? m[0] : null;
}

/** Identifiants des <div> ouverts (non fermés) à la position `index`. */
function ancestorDivIds(source, index) {
  const stack = [];
  const re = /<div\b([^>]*)>|<\/div>/g;
  let m;
  while ((m = re.exec(source)) && m.index < index) {
    if (m[0] === '</div>') {
      stack.pop();
    } else {
      const id = /\sid="([^"]+)"/.exec(m[1]);
      stack.push(id ? id[1] : '');
    }
  }
  return stack;
}

describe('texte de l\'annonce (fr.js)', () => {
  test('clé round.huntAnnouncement présente, non vide, texte attendu', () => {
    assert.equal(typeof fr['round.huntAnnouncement'], 'string');
    assert.equal(fr['round.huntAnnouncement'], 'Le monstre te traque');
    assert.ok(fr['round.huntAnnouncement'].trim().length > 0);
  });
});

describe('zone #round-status (index.html)', () => {
  const tag = openingTag(html, 'round-status');

  test('élément présent, de type <p>', () => {
    assert.ok(tag, '#round-status absent de index.html');
    assert.match(tag, /^<p\b/);
  });

  test('role="status", aria-live="polite", classe sr-only', () => {
    assert.match(tag, /\srole="status"/);
    assert.match(tag, /\saria-live="polite"/);
    assert.match(tag, /\sclass="sr-only"/);
  });

  test('jamais masqué à l\'ouverture (pas d\'attribut hidden)', () => {
    assert.doesNotMatch(tag, /\shidden[\s>]/);
  });

  test('vide : aucun texte en dur ni attribut data-i18n', () => {
    const m = /id="round-status"[^>]*>([^<]*)<\/p>/.exec(html);
    assert.ok(m, 'contenu de #round-status introuvable');
    assert.equal(m[1], '');
    assert.doesNotMatch(tag, /data-i18n/);
  });

  test('dans #maze-stage, hors #end-screen', () => {
    const ancestors = ancestorDivIds(html, html.indexOf('id="round-status"'));
    assert.ok(ancestors.includes('maze-stage'), `ancêtres : ${ancestors.join(', ')}`);
    assert.ok(!ancestors.includes('end-screen'), 'zone placée dans #end-screen');
  });
});

describe('classe .sr-only (styles.css)', () => {
  const rule = /\.sr-only\s*\{([^}]*)\}/.exec(css);

  test('règle .sr-only présente', () => {
    assert.ok(rule, '.sr-only absent de styles.css');
  });

  test('visuellement cachée sans display:none (lue par les lecteurs d\'écran)', () => {
    assert.doesNotMatch(rule[1], /display\s*:\s*none/);
    assert.match(rule[1], /position\s*:\s*absolute/);
    assert.match(rule[1], /clip\s*:|clip-path\s*:/);
  });
});
