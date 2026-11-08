// Tests de sécurité statiques (testeur-securite) du workflow de publication GitHub Pages
// (.github/workflows/pages.yml). Analyse textuelle sans parseur YAML ni dépendance :
// découpage en blocs selon l'indentation. Compatible Node 20.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowsDir = path.join(repoRoot, '.github', 'workflows');
const pagesPath = path.join(workflowsDir, 'pages.yml');
const syncPath = path.join(workflowsDir, 'check-agents-sync.yml');

// ---------------------------------------------------------------------------
// Mini-analyseur YAML textuel (suffisant pour un workflow GitHub Actions simple).
// ---------------------------------------------------------------------------

/** Retire un commentaire `#` de fin de ligne situé hors guillemets. */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
  }
  return line.replace(/\s+$/, '');
}

/** Lignes significatives : { indent, text } (sans commentaires ni lignes vides). */
function toLines(source) {
  return source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(stripComment)
    .map((l) => ({ indent: l.length - l.trimStart().length, text: l.trim() }))
    .filter((l) => l.text !== '');
}

function unquote(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Lignes enfants (indentation strictement supérieure) de la ligne d'index `idx`. */
function childLines(lines, idx) {
  const base = lines[idx].indent;
  const out = [];
  for (let i = idx + 1; i < lines.length && lines[i].indent > base; i += 1) out.push(lines[i]);
  return out;
}

/**
 * Entrées `clé: valeur` au premier niveau d'une liste de lignes.
 * Retourne [{ key, value, children }].
 */
function entries(lines) {
  if (lines.length === 0) return [];
  const level = Math.min(...lines.map((l) => l.indent));
  const out = [];
  lines.forEach((l, i) => {
    if (l.indent !== level) return;
    const m = /^([A-Za-z0-9_-]+|"[^"]+"|'[^']+'):(?:\s+(.*))?$/.exec(l.text);
    if (!m) return;
    out.push({ key: unquote(m[1]), value: (m[2] ?? '').trim(), children: childLines(lines, i) });
  });
  return out;
}

function getEntry(lines, key) {
  return entries(lines).find((e) => e.key === key);
}

/** Valeurs d'une liste : forme `[a, b]` ou forme bloc `- a`. */
function listValues(entry) {
  if (!entry) return [];
  if (entry.value.startsWith('[')) {
    return entry.value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(unquote)
      .filter((v) => v !== '');
  }
  if (entry.value !== '') return [unquote(entry.value)];
  return entry.children.filter((l) => l.text.startsWith('- ')).map((l) => unquote(l.text.slice(2)));
}

/** Étapes d'un job : chaque élément `- ` de `steps:` devient une liste de lignes normalisées. */
function steps(jobEntry) {
  const stepsEntry = getEntry(jobEntry.children, 'steps');
  if (!stepsEntry) return [];
  const lines = stepsEntry.children;
  if (lines.length === 0) return [];
  const itemIndent = Math.min(...lines.map((l) => l.indent));
  const out = [];
  for (const l of lines) {
    if (l.indent === itemIndent && l.text.startsWith('- ')) {
      // "- uses: x" devient une ligne "uses: x" au niveau itemIndent + 2.
      out.push([{ indent: itemIndent + 2, text: l.text.slice(2).trim() }]);
    } else if (out.length > 0) {
      out[out.length - 1].push(l);
    }
  }
  return out;
}

/** Contenu de la commande `run:` d'une étape (inline ou bloc `|` / `>`), ou null. */
function runContent(stepLines) {
  const run = getEntry(stepLines, 'run');
  if (!run) return null;
  const inline = /^[|>][+-]?$/.test(run.value) ? '' : run.value;
  return [inline, ...run.children.map((l) => l.text)].join('\n');
}

function usesValue(stepLines) {
  const u = getEntry(stepLines, 'uses');
  return u ? unquote(u.value) : null;
}

/** Map des permissions d'un bloc `permissions:` (null si absent). */
function permissionsOf(lines) {
  const p = getEntry(lines, 'permissions');
  if (!p) return null;
  if (p.value !== '') return { __scalar__: unquote(p.value) };
  return Object.fromEntries(entries(p.children).map((e) => [e.key, unquote(e.value)]));
}

const USES_RE = /^actions\/[\w-]+@v\d+$/;

// ---------------------------------------------------------------------------
// Chargement du workflow réel.
// ---------------------------------------------------------------------------

const pagesExists = existsSync(pagesPath);
const rawPages = pagesExists ? readFileSync(pagesPath, 'utf8') : '';
const lines = toLines(rawPages);
const jobs = entries(getEntry(lines, 'jobs')?.children ?? []);
const buildJob = jobs.find((j) => j.key === 'build');
const deployJob = jobs.find((j) => j.key === 'deploy');
const allSteps = jobs.flatMap((j) => steps(j));

describe('pages.yml : existence et structure', () => {
  test('le workflow .github/workflows/pages.yml existe', () => {
    assert.ok(pagesExists, `${pagesPath} introuvable`);
  });

  test('le workflow a exactement les jobs build et deploy', () => {
    assert.deepEqual(jobs.map((j) => j.key).sort(), ['build', 'deploy']);
  });
});

describe('pages.yml : déclencheurs', () => {
  const on = getEntry(lines, 'on') ?? getEntry(lines, '"on"');

  test('déclencheurs limités à push et workflow_dispatch', () => {
    assert.ok(on, 'clé on: absente');
    const triggers = on.value !== '' ? listValues(on) : entries(on.children).map((e) => e.key);
    assert.deepEqual([...triggers].sort(), ['push', 'workflow_dispatch']);
  });

  test('push limité à la branche main uniquement', () => {
    const push = getEntry(on.children, 'push');
    assert.ok(push, 'push: absent');
    const pushKeys = entries(push.children).map((e) => e.key);
    assert.deepEqual(pushKeys, ['branches'], `clés inattendues sous push: ${pushKeys}`);
    assert.deepEqual(listValues(getEntry(push.children, 'branches')), ['main']);
  });

  test('aucun déclencheur dangereux (pull_request, pull_request_target, schedule, workflow_run…)', () => {
    for (const forbidden of [
      'pull_request',
      'pull_request_target',
      'schedule',
      'workflow_run',
      'issue_comment',
      'repository_dispatch',
    ]) {
      assert.doesNotMatch(rawPages, new RegExp(`(^|[\\s\\[,])${forbidden}\\s*[:,\\]]`, 'm'), forbidden);
    }
  });

  test('aucun workflow du dépôt n’utilise pull_request_target', () => {
    for (const f of readdirSync(workflowsDir)) {
      const content = readFileSync(path.join(workflowsDir, f), 'utf8');
      assert.doesNotMatch(content, /pull_request_target/, f);
    }
  });
});

describe('pages.yml : permissions minimales', () => {
  test('permissions du workflow : contents: read uniquement', () => {
    assert.deepEqual(permissionsOf(lines), { contents: 'read' });
  });

  test('aucune permission large (write-all, read-all, contents: write, actions: write)', () => {
    assert.doesNotMatch(rawPages, /write-all|read-all/);
    assert.doesNotMatch(rawPages, /contents:\s*write/);
    assert.doesNotMatch(rawPages, /actions:\s*write/);
  });

  test('le job build ne déclare aucune permission en écriture', () => {
    const p = permissionsOf(buildJob.children);
    if (p === null) return;
    for (const [k, v] of Object.entries(p)) assert.notEqual(v, 'write', `build: ${k}: ${v}`);
    assert.notEqual(p.__scalar__, 'write-all');
  });

  test('le job deploy a pages: write et id-token: write, et rien d’autre (hors contents: read)', () => {
    const p = permissionsOf(deployJob.children);
    assert.ok(p && !p.__scalar__, 'deploy doit déclarer un bloc permissions explicite');
    assert.equal(p.pages, 'write');
    assert.equal(p['id-token'], 'write');
    const extra = Object.keys(p).filter((k) => !['pages', 'id-token', 'contents'].includes(k));
    assert.deepEqual(extra, [], `permissions inattendues dans deploy: ${extra}`);
    if (p.contents !== undefined) assert.equal(p.contents, 'read');
  });

  test('pages: write et id-token: write n’apparaissent que dans le job deploy', () => {
    const count = (ls, re) => ls.filter((l) => re.test(l.text)).length;
    for (const re of [/^pages:\s*write$/, /^id-token:\s*write$/]) {
      assert.equal(count(lines, re), 1, `${re} doit apparaître une seule fois`);
      assert.equal(count(deployJob.children, re), 1, `${re} doit être dans deploy`);
    }
  });
});

describe('pages.yml : concurrency', () => {
  test('concurrency avec un group et cancel-in-progress: false', () => {
    const c = getEntry(lines, 'concurrency');
    assert.ok(c, 'concurrency absent');
    const group = getEntry(c.children, 'group');
    assert.ok(group && unquote(group.value) !== '', 'group absent ou vide');
    assert.equal(getEntry(c.children, 'cancel-in-progress')?.value, 'false');
  });
});

describe('pages.yml : actions utilisées', () => {
  const uses = allSteps.map(usesValue).filter((u) => u !== null);

  test('chaque uses: est une action officielle actions/* épinglée en @vN', () => {
    assert.ok(uses.length > 0);
    for (const u of uses) assert.match(u, USES_RE, `action non conforme: ${u}`);
    // Aucun uses: hors des étapes analysées (ex. job réutilisable).
    const rawUses = lines.filter((l) => /^(- )?uses:/.test(l.text)).length;
    assert.equal(rawUses, uses.length, 'uses: non analysé trouvé');
  });

  test('le motif rejette @main, @master, SHA, organisation tierce, action locale', () => {
    for (const bad of [
      'actions/checkout@main',
      'actions/checkout@master',
      'actions/checkout@8f4b7f84864484a7bf31766abe9204da3cbe65b3',
      'actions/checkout@v4.1.0',
      'evil/checkout@v4',
      './local-action',
      'docker://alpine',
      'actions/checkout',
    ]) {
      assert.doesNotMatch(bad, USES_RE, bad);
    }
  });

  test('upload-pages-artifact et deploy-pages sont présents', () => {
    assert.ok(uses.some((u) => u.startsWith('actions/upload-pages-artifact@')));
    assert.ok(uses.some((u) => u.startsWith('actions/deploy-pages@')));
  });
});

describe('pages.yml : périmètre publié et ordre du build', () => {
  const buildSteps = buildJob ? steps(buildJob) : [];
  const uploadIdx = buildSteps.findIndex((s) =>
    (usesValue(s) ?? '').startsWith('actions/upload-pages-artifact@'),
  );
  const testIdx = buildSteps.findIndex((s) => /(^|\s)npm\s+(test|run\s+test)\b/.test(runContent(s) ?? ''));

  test('l’upload publie src seul (une seule clé path:, valeur src ou ./src)', () => {
    assert.ok(uploadIdx >= 0, 'étape upload-pages-artifact absente du job build');
    const pathLines = buildSteps[uploadIdx].filter((l) => /^path:/.test(l.text));
    assert.equal(pathLines.length, 1, 'exactement une clé path: attendue');
    const value = unquote(pathLines[0].text.replace(/^path:/, ''));
    assert.match(value, /^(\.\/)?src\/?$/, `path non conforme: "${value}"`);
  });

  test('npm test précède l’upload dans le job build, sans continue-on-error ni if', () => {
    assert.ok(testIdx >= 0, 'étape npm test absente du job build');
    assert.ok(testIdx < uploadIdx, 'npm test doit précéder l’upload');
    const testStep = buildSteps[testIdx];
    assert.equal(getEntry(testStep, 'continue-on-error'), undefined);
    assert.equal(getEntry(testStep, 'if'), undefined);
    assert.equal(getEntry(buildJob.children, 'continue-on-error'), undefined);
  });

  test('le job deploy dépend de build, cible l’environnement github-pages et n’exécute aucun run:', () => {
    assert.deepEqual(listValues(getEntry(deployJob.children, 'needs')), ['build']);
    const env = getEntry(deployJob.children, 'environment');
    assert.ok(env, 'environment absent');
    const name = env.value !== '' ? unquote(env.value) : unquote(getEntry(env.children, 'name')?.value ?? '');
    assert.equal(name, 'github-pages');
    const deploySteps = steps(deployJob);
    assert.ok(deploySteps.every((s) => runContent(s) === null), 'aucun run: dans deploy (porte id-token)');
  });
});

describe('pages.yml : secrets, dépendances et injection', () => {
  test('aucun secrets., GITHUB_TOKEN explicite ni jeton', () => {
    assert.doesNotMatch(rawPages, /secrets\./);
    assert.doesNotMatch(rawPages, /GITHUB_TOKEN|github\.token|(^|\s)token:/im);
  });

  test('aucun npm install / npm ci / npm i (zéro dépendance)', () => {
    assert.doesNotMatch(rawPages, /\bnpm\s+(install|ci|i|add)\b/);
    assert.doesNotMatch(rawPages, /\b(yarn|pnpm|npx)\b/);
  });

  test('aucune expression ${{ }} injectée dans une commande run:', () => {
    const runs = allSteps.map(runContent).filter((r) => r !== null);
    assert.ok(runs.length > 0);
    for (const r of runs) assert.doesNotMatch(r, /\$\{\{/, `expression dans run: ${r}`);
    assert.doesNotMatch(rawPages, /github\.event\.|github\.head_ref|inputs\./);
  });

  test('l’analyseur détecte une expression injectée dans un run: bloc (cas négatif)', () => {
    const fake = toLines(
      [
        'jobs:',
        '  build:',
        '    steps:',
        '      - run: |',
        '          echo "${{ github.event.head_commit.message }}"',
      ].join('\n'),
    );
    const job = entries(getEntry(fake, 'jobs').children)[0];
    assert.match(runContent(steps(job)[0]), /\$\{\{ github\.event/);
  });
});

describe('Non-régression : check-agents-sync.yml', () => {
  test('check-agents-sync.yml existe et lance toujours sync-agents --check', () => {
    assert.ok(existsSync(syncPath), `${syncPath} introuvable`);
    assert.match(readFileSync(syncPath, 'utf8'), /node scripts\/sync-agents\.mjs --check/);
  });
});
