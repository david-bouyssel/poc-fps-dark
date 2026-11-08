// Fonctionnement sous un sous-chemin (GitHub Pages : /poc-fps-orchestration/).
// Plan : docs/design/publication-pages.md, § 6, `subpath-resolution.test.js`.
// Analyse textuelle de src/ : aucune dépendance, compatible Node 20.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));
const BASE = 'https://example.github.io/poc-fps-orchestration/';

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function toPosix(p) {
  return p.split(sep).join('/');
}

// URL publiée d'un fichier de src/ (src/ est la racine du site).
function publishedUrl(file) {
  return new URL(toPosix(relative(SRC_DIR, file)), BASE).href;
}

// Résout `ref` contre `fromUrl` et vérifie qu'elle reste sous BASE et pointe
// vers un fichier existant de src/. Retourne la liste des problèmes (vide = OK).
function checkReference(ref, fromUrl) {
  const problems = [];
  let resolved;
  try {
    resolved = new URL(ref, fromUrl);
  } catch {
    return [`référence invalide : ${ref}`];
  }
  if (!resolved.href.startsWith(BASE)) {
    problems.push(`${ref} -> ${resolved.href} sort du préfixe ${BASE}`);
    return problems;
  }
  const relPath = decodeURIComponent(resolved.pathname.slice(new URL(BASE).pathname.length));
  const target = join(SRC_DIR, relPath);
  const rel = relative(SRC_DIR, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    problems.push(`${ref} -> ${target} hors de src/`);
  } else if (!existsSync(target) || !statSync(target).isFile()) {
    problems.push(`${ref} -> ${toPosix(rel)} n'existe pas dans src/`);
  }
  return problems;
}

function isRootAbsolute(ref) {
  // '/x' (racine du domaine) ou '//host/x' (protocole relatif) : cassent sous le sous-chemin.
  return ref.startsWith('/');
}

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function extractHtmlRefs(html) {
  const refs = [];
  const re = /\s(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  for (const m of stripHtmlComments(html).matchAll(re)) refs.push(m[1] ?? m[2] ?? m[3]);
  return refs;
}

function stripJsComments(code) {
  // Suffisant pour ce code : pas de '//' ni '/*' dans des chaînes d'import.
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function extractStaticImports(code) {
  const specs = [];
  const clean = stripJsComments(code);
  const fromRe = /\b(?:import|export)\s+[^'"`;]*?\bfrom\s*(['"])([^'"]+)\1/g;
  const bareRe = /\bimport\s*(['"])([^'"]+)\1/g;
  for (const m of clean.matchAll(fromRe)) specs.push(m[2]);
  for (const m of clean.matchAll(bareRe)) specs.push(m[2]);
  return specs;
}

function extractCssRefs(css) {
  const refs = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)) {
    refs.push(m[1] ?? m[2] ?? m[3]);
  }
  for (const m of clean.matchAll(/@import\s+(?:url\()?\s*(['"])([^'"]+)\1/gi)) refs.push(m[2]);
  return refs;
}

const allFiles = walk(SRC_DIR);
const jsFiles = allFiles.filter((f) => f.endsWith('.js'));
const cssFiles = allFiles.filter((f) => f.endsWith('.css'));
const indexFile = join(SRC_DIR, 'index.html');
const indexUrl = publishedUrl(indexFile);
const indexRefs = extractHtmlRefs(readFileSync(indexFile, 'utf8'));

test('la page publiée est index.html à la racine de la base', () => {
  assert.equal(indexUrl, `${BASE}index.html`);
});

test('index.html : chaque src/href résolu sous la base pointe vers un fichier de src/', () => {
  assert.ok(indexRefs.includes('./styles.css'), 'référence à ./styles.css attendue');
  assert.ok(indexRefs.includes('./main.js'), 'référence à ./main.js attendue');
  const problems = indexRefs.flatMap((ref) => checkReference(ref, indexUrl));
  assert.deepEqual(problems, []);
});

test('index.html : la page servie sur l\'URL de répertoire (base avec /) résout pareil', () => {
  const problems = indexRefs.flatMap((ref) => checkReference(ref, BASE));
  assert.deepEqual(problems, []);
});

test('src/**/*.js : chaque import statique résolu depuis son module reste sous la base et existe', () => {
  assert.ok(jsFiles.length > 0, 'des fichiers JS sont attendus dans src/');
  let count = 0;
  const problems = [];
  for (const file of jsFiles) {
    const fromUrl = publishedUrl(file);
    for (const spec of extractStaticImports(readFileSync(file, 'utf8'))) {
      count += 1;
      for (const p of checkReference(spec, fromUrl)) problems.push(`${toPosix(relative(SRC_DIR, file))} : ${p}`);
    }
  }
  assert.ok(count > 0, 'au moins un import attendu (main.js importe des modules)');
  assert.deepEqual(problems, []);
});

test('graphe de modules depuis index.html : tous les modules atteints existent sous la base', () => {
  const seen = new Set();
  const queue = indexRefs.filter((r) => r.endsWith('.js')).map((r) => new URL(r, indexUrl).href);
  const problems = [];
  while (queue.length > 0) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    const file = join(SRC_DIR, decodeURIComponent(new URL(url).pathname.slice(new URL(BASE).pathname.length)));
    if (!existsSync(file)) {
      problems.push(`module introuvable : ${url}`);
      continue;
    }
    for (const spec of extractStaticImports(readFileSync(file, 'utf8'))) {
      const issues = checkReference(spec, url);
      if (issues.length > 0) problems.push(...issues);
      else queue.push(new URL(spec, url).href);
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(seen.has(`${BASE}main.js`));
  assert.ok(seen.size > 1, 'main.js doit importer au moins un module');
});

test('aucun chemin absolu racine dans les src/href de index.html', () => {
  assert.deepEqual(indexRefs.filter(isRootAbsolute), []);
});

test('aucun chemin absolu racine dans les imports statiques de src/**/*.js', () => {
  const offenders = [];
  for (const file of jsFiles) {
    for (const spec of extractStaticImports(readFileSync(file, 'utf8'))) {
      if (isRootAbsolute(spec)) offenders.push(`${toPosix(relative(SRC_DIR, file))} : ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('aucun chemin absolu racine dans url( / @import de src/**/*.css, et références existantes', () => {
  assert.ok(cssFiles.length > 0, 'au moins une feuille de style attendue');
  const offenders = [];
  for (const file of cssFiles) {
    const name = toPosix(relative(SRC_DIR, file));
    for (const ref of extractCssRefs(readFileSync(file, 'utf8'))) {
      if (isRootAbsolute(ref)) offenders.push(`${name} : ${ref}`);
      else if (!ref.startsWith('data:')) {
        for (const p of checkReference(ref, publishedUrl(file))) offenders.push(`${name} : ${p}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

// Cas négatifs : prouvent que la détection fonctionne.
test('cas négatif : /main.js résolu contre la base sort du préfixe et est détecté', () => {
  assert.equal(new URL('/main.js', BASE).href, 'https://example.github.io/main.js');
  assert.equal(isRootAbsolute('/main.js'), true);
  const problems = checkReference('/main.js', indexUrl);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /sort du préfixe/);
});

test('cas négatif : autres références fautives détectées', () => {
  assert.match(checkReference('../main.js', indexUrl)[0], /sort du préfixe/);
  assert.match(checkReference('//cdn.example.com/x.js', indexUrl)[0], /sort du préfixe/);
  assert.match(checkReference('./absent.js', indexUrl)[0], /n'existe pas/);
  assert.match(checkReference('./maze/', indexUrl)[0], /n'existe pas/);
});

test('cas négatif : les extracteurs repèrent les chemins absolus dans HTML, JS et CSS', () => {
  const html = '<link rel="stylesheet" href="/styles.css"><script type="module" src=\'/main.js\'></script>';
  assert.deepEqual(extractHtmlRefs(html).filter(isRootAbsolute), ['/styles.css', '/main.js']);

  const js = "import { a } from '/maze/maze.js';\nexport { b } from \"/render/palette.js\";\nimport '/side.js';";
  assert.deepEqual(extractStaticImports(js).filter(isRootAbsolute).sort(), ['/maze/maze.js', '/render/palette.js', '/side.js']);

  const css = "@import '/base.css';\n.a { background: url(/img.png); }\n.b { background: url(\"./ok.png\"); }";
  assert.deepEqual(extractCssRefs(css).filter(isRootAbsolute).sort(), ['/base.css', '/img.png']);
});
