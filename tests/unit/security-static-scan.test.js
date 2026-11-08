// Tests de sécurité statiques (testeur-securite) : analyse du code source réellement
// livré dans src/ et scripts/, et de package.json. Aucun accès réseau, aucun DOM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = path.join(repoRoot, 'src');
const appScripts = ['scripts/static-server.mjs', 'scripts/serve.mjs'].map((p) =>
  path.join(repoRoot, p),
);

/** Parcours récursif compatible Node 20 (sans readdir recursive). */
function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

/** Retire commentaires bloc et ligne (approximation suffisante pour ce code). */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');
}

const srcFiles = listFiles(srcDir);
const srcJsFiles = srcFiles.filter((f) => f.endsWith('.js'));
const rel = (f) => path.relative(repoRoot, f).split(path.sep).join('/');
const read = (f) => readFileSync(f, 'utf8');

/**
 * Vérifie qu'aucun motif interdit n'apparaît (hors commentaires) dans les fichiers.
 * @param {string[]} files
 * @param {Array<[RegExp, string]>} patterns
 */
function assertNoPattern(files, patterns) {
  const hits = [];
  for (const file of files) {
    const code = stripComments(read(file));
    for (const [pattern, label] of patterns) {
      const lines = code.split('\n');
      lines.forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${rel(file)}:${i + 1} [${label}] ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(hits, [], `Motifs interdits trouvés :\n${hits.join('\n')}`);
}

describe('sécurité statique : arborescence servie src/', () => {
  test('src/ ne contient que des extensions de la liste blanche, ni fichier caché ni test', () => {
    const allowed = new Set(['.html', '.js', '.css']);
    const bad = srcFiles.filter((f) => {
      const name = path.basename(f);
      return (
        !allowed.has(path.extname(f).toLowerCase()) ||
        name.startsWith('.') ||
        /\.test\.js$/.test(name)
      );
    });
    assert.deepEqual(bad.map(rel), []);
  });

  test('aucun sink HTML / exécution dynamique (innerHTML, eval, Function, document.write...)', () => {
    assertNoPattern(srcJsFiles, [
      [/\binnerHTML\b/, 'innerHTML'],
      [/\bouterHTML\b/, 'outerHTML'],
      [/\binsertAdjacentHTML\b/, 'insertAdjacentHTML'],
      [/\bcreateContextualFragment\b/, 'createContextualFragment'],
      [/\bDOMParser\b/, 'DOMParser'],
      [/\beval\s*\(/, 'eval'],
      [/\bnew\s+Function\b/, 'new Function'],
      [/(^|[^.\w])Function\s*\(/, 'Function()'],
      [/\bdocument\s*\.\s*write(ln)?\b/, 'document.write'],
      [/\b(setTimeout|setInterval)\s*\(\s*['"`]/, 'timer avec chaîne'],
      [/\bsrcdoc\b/, 'srcdoc'],
      [/javascript:/i, 'URL javascript:'],
      [/\.\s*setAttribute\s*\(\s*['"]on\w+/i, 'gestionnaire on* via setAttribute'],
    ]);
  });

  test('aucun accès réseau sortant dans src/ (fetch, XHR, WebSocket, import dynamique, URL absolue)', () => {
    assertNoPattern(srcFiles, [
      [/\bfetch\s*\(/, 'fetch'],
      [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
      [/\bWebSocket\b/, 'WebSocket'],
      [/\bEventSource\b/, 'EventSource'],
      [/\bsendBeacon\b/, 'sendBeacon'],
      [/\bRTCPeerConnection\b/, 'WebRTC'],
      [/\bnew\s+Worker\b|\bSharedWorker\b|\bserviceWorker\b/, 'worker'],
      [/(^|[^\w.])import\s*\(/, 'import dynamique'],
      [/\b(https?|wss?|ftp):\/\//i, 'URL absolue'],
      [/(src|href)\s*=\s*["']\s*\/\//i, 'URL protocole-relative'],
      [/@import\s+url\s*\(\s*["']?\s*(https?:)?\/\//i, '@import externe'],
    ]);
  });

  test('aucun stockage navigateur (localStorage, sessionStorage, indexedDB, cookie, Cache API)', () => {
    assertNoPattern(srcJsFiles, [
      [/\blocalStorage\b/, 'localStorage'],
      [/\bsessionStorage\b/, 'sessionStorage'],
      [/\bindexedDB\b/, 'indexedDB'],
      [/\bdocument\s*\.\s*cookie\b/, 'document.cookie'],
      [/\bcaches\s*\./, 'Cache API'],
    ]);
  });

  test('aucun log console dans src/ (pas de fuite de données dans les logs)', () => {
    assertNoPattern(srcJsFiles, [[/\bconsole\s*\./, 'console']]);
  });

  test('imports de src/ uniquement relatifs avec extension .js', () => {
    const bad = [];
    for (const file of srcJsFiles) {
      const code = stripComments(read(file));
      for (const m of code.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
        if (!/^\.{1,2}\/[\w./-]+\.js$/.test(m[1])) bad.push(`${rel(file)} -> ${m[1]}`);
      }
      for (const m of code.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) {
        if (!/^\.{1,2}\/[\w./-]+\.js$/.test(m[1])) bad.push(`${rel(file)} -> ${m[1]}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test('valeurs affichées via textContent (main.js et i18n.js)', () => {
    const main = stripComments(read(path.join(srcDir, 'main.js')));
    assert.match(main, /errorElement\.textContent\s*=/);
    assert.match(main, /infoElement\.textContent\s*=/);
    const i18n = stripComments(read(path.join(srcDir, 'i18n', 'i18n.js')));
    assert.match(i18n, /\.textContent\s*=\s*t\(/);
    // innerText / outerText non utilisés non plus : textContent est la seule voie.
    assertNoPattern(srcJsFiles, [[/\b(innerText|outerText)\s*=/, 'innerText/outerText']]);
  });

  test('graine aléatoire via crypto.getRandomValues, jamais Math.random dans src/', () => {
    assertNoPattern(srcJsFiles, [[/\bMath\s*\.\s*random\b/, 'Math.random']]);
  });

  test('index.html : aucun script inline, aucun gestionnaire on*, ressources locales relatives', () => {
    const html = stripComments(read(path.join(srcDir, 'index.html')));
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.ok(scripts.length >= 1, 'au moins un script attendu');
    for (const [, attrs, body] of scripts) {
      assert.equal(body.trim(), '', 'script inline interdit');
      assert.match(attrs, /\bsrc\s*=\s*["']\.\/[\w./-]+\.js["']/, `src relatif attendu : ${attrs}`);
      assert.match(attrs, /\btype\s*=\s*["']module["']/);
    }
    assert.doesNotMatch(html, /\son\w+\s*=/i, 'attribut on* interdit');
    for (const m of html.matchAll(/\b(?:src|href|action)\s*=\s*["']([^"']*)["']/gi)) {
      assert.match(m[1], /^\.\/[\w./-]+$/, `ressource non locale : ${m[1]}`);
    }
    assert.doesNotMatch(html, /<(iframe|object|embed|base)\b/i);
  });
});

describe('sécurité statique : secrets en dur', () => {
  const files = [...srcFiles, ...appScripts, path.join(repoRoot, 'package.json')];
  const secretPatterns = [
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée PEM'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'clé AWS'],
    [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'token GitHub'],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'token GitHub fin'],
    [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'clé API type sk-'],
    [/\bxox[abpr]-[A-Za-z0-9-]{10,}\b/, 'token Slack'],
    [/\bAIza[0-9A-Za-z_-]{35}\b/, 'clé Google'],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
    [
      /\b(api[_-]?key|secret|token|passw(or)?d|pwd|private[_-]?key|auth|credential)s?\b\s*[:=]\s*['"`][^'"`\s]{6,}['"`]/i,
      'affectation de secret',
    ],
    [/\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:[^/\s@'"]+@/i, 'identifiants dans une URL'],
  ];

  test('aucun motif de secret dans src/, scripts/ applicatifs et package.json', () => {
    const hits = [];
    for (const file of files) {
      read(file)
        .split('\n')
        .forEach((line, i) => {
          for (const [pattern, label] of secretPatterns) {
            if (pattern.test(line)) hits.push(`${rel(file)}:${i + 1} [${label}]`);
          }
        });
    }
    assert.deepEqual(hits, []);
  });

  test('aucun fichier de secrets/config machine dans src/', () => {
    const bad = srcFiles.filter((f) =>
      /(^|[\\/])(\.env.*|.*\.(pem|key|p12|pfx|crt)|id_rsa.*|\.npmrc)$/i.test(f),
    );
    assert.deepEqual(bad.map(rel), []);
  });
});

describe('sécurité statique : dépendances et chaîne d\'outillage', () => {
  const pkg = JSON.parse(read(path.join(repoRoot, 'package.json')));

  test('package.json : zéro dépendance npm', () => {
    for (const key of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
      'bundleDependencies',
      'bundledDependencies',
    ]) {
      const value = pkg[key];
      const count = value == null ? 0 : Array.isArray(value) ? value.length : Object.keys(value).length;
      assert.equal(count, 0, `${key} doit être vide`);
    }
  });

  test('package.json : privé, aucun script de cycle de vie npm (install/prepare...)', () => {
    assert.equal(pkg.private, true);
    const lifecycle = Object.keys(pkg.scripts ?? {}).filter((s) =>
      /^(pre|post)?(install|uninstall|prepare|prepublish|prepublishOnly|prepack|postpack|publish)$/.test(s),
    );
    assert.deepEqual(lifecycle, []);
    assert.equal(pkg.scripts?.start, 'node scripts/serve.mjs');
  });

  test('aucun node_modules ni lockfile avec paquets', () => {
    assert.equal(existsSync(path.join(repoRoot, 'node_modules')), false, 'node_modules présent');
    const lock = path.join(repoRoot, 'package-lock.json');
    if (existsSync(lock)) {
      const packages = Object.keys(JSON.parse(read(lock)).packages ?? {}).filter((k) => k !== '');
      assert.deepEqual(packages, [], 'package-lock.json référence des paquets');
    }
  });

  test('scripts serveur : imports limités aux modules natifs node: et locaux', () => {
    const bad = [];
    for (const file of appScripts) {
      const code = stripComments(read(file));
      for (const m of code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) {
        if (!/^(node:|\.\/)/.test(m[1])) bad.push(`${rel(file)} -> ${m[1]}`);
      }
      assert.doesNotMatch(code, /\brequire\s*\(/, `${rel(file)} : require interdit`);
      assert.doesNotMatch(code, /\bchild_process\b|\beval\s*\(|new\s+Function\b/);
    }
    assert.deepEqual(bad, []);
  });

  test('serve.mjs : hôte 127.0.0.1 en dur, racine servie = src/ (jamais la racine du dépôt)', () => {
    const code = stripComments(read(appScripts[1]));
    assert.match(code, /const HOST\s*=\s*'127\.0\.0\.1'/);
    assert.match(code, /\.listen\(\s*port\s*,\s*HOST\b/);
    assert.match(code, /path\.resolve\(\s*scriptDir\s*,\s*'\.\.'\s*,\s*'src'\s*\)/);
    assert.doesNotMatch(code, /0\.0\.0\.0|'::'|process\.env\.HOST/);
  });

  test('static-server.mjs : en-têtes nosniff posés, aucune réponse de détail d\'erreur', () => {
    const code = stripComments(read(appScripts[0]));
    assert.match(code, /'X-Content-Type-Options',\s*'nosniff'/);
    assert.doesNotMatch(code, /error\.(stack|message)|String\(error\)/, 'détail d\'erreur renvoyé');
    assert.doesNotMatch(code, /readdir|opendir/, 'listing de répertoire possible');
    assert.doesNotMatch(code, /\bconsole\s*\./, 'log dans la bibliothèque serveur');
  });
});
