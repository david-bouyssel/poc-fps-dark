// Tests de sécurité d'intégration du serveur statique (testeur-securite).
// Requêtes envoyées en brut via node:net : fetch et http.request normalisent ou
// refusent certains chemins (.., octet nul, antislash), ce qui fausserait le test.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { createStaticServer } from '../../scripts/static-server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SECRET = 'SECRET_OUTSIDE_ROOT_7f3a';

/**
 * Envoie une requête HTTP/1.1 brute et lit toute la réponse.
 * @param {number} port
 * @param {string} method
 * @param {string} target cible brute, envoyée telle quelle
 * @returns {Promise<{ status: number, headers: Record<string,string>, body: string, raw: string }>}
 */
function rawRequest(port, method, target, { host = '127.0.0.1', extra = '' } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const chunks = [];
    socket.setTimeout(5000, () => socket.destroy(new Error('timeout')));
    socket.on('connect', () => {
      socket.write(
        Buffer.from(
          `${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n${extra}\r\n`,
          'latin1',
        ),
      );
    });
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', reject);
    socket.on('close', () => {
      const raw = Buffer.concat(chunks).toString('latin1');
      const sep = raw.indexOf('\r\n\r\n');
      const head = sep === -1 ? raw : raw.slice(0, sep);
      const body = sep === -1 ? '' : raw.slice(sep + 4);
      const [statusLine, ...headerLines] = head.split('\r\n');
      const status = Number(statusLine.split(' ')[1]);
      const headers = {};
      for (const line of headerLines) {
        const i = line.indexOf(':');
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      resolve({ status, headers, body, raw });
    });
  });
}

/** Démarre un serveur sur port éphémère loopback. */
async function start(root) {
  const server = createStaticServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

/** Une réponse d'erreur ne doit rien révéler (pas de stack, pas de chemin disque). */
function assertOpaqueError(res, roots) {
  assert.match(res.body, /^(\d{3} [A-Za-z' -]*\n)?$/, `corps inattendu : ${JSON.stringify(res.body)}`);
  assert.doesNotMatch(res.raw, /\bat .+:\d+:\d+|Error:|ENOENT|EACCES|node:internal/);
  for (const r of roots) assert.ok(!res.raw.includes(r), 'chemin disque divulgué');
  assert.ok(!res.raw.includes(SECRET), 'contenu hors racine divulgué');
}

describe('serveur statique : racine temporaire contrôlée', () => {
  let base;
  let root;
  let port;
  let server;
  let fileSymlinkOk = false;

  before(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'poc-fps-sec-'));
    root = path.join(base, 'root');
    await mkdir(path.join(root, 'sub'), { recursive: true });
    await mkdir(path.join(root, 'dir.js'));
    await mkdir(path.join(base, 'root-evil'));
    await writeFile(path.join(base, 'secret.js'), `// ${SECRET}\n`);
    await writeFile(path.join(base, 'secret.html'), `${SECRET}\n`);
    await writeFile(path.join(base, 'root-evil', 'secret.js'), `${SECRET}\n`);
    await writeFile(path.join(root, 'index.html'), '<!doctype html><canvas></canvas>\n');
    await writeFile(path.join(root, 'app.js'), 'export const ok = 1;\n');
    await writeFile(path.join(root, 'style.css'), 'body{}\n');
    await writeFile(path.join(root, 'sub', 'inner.js'), 'export {};\n');
    await writeFile(path.join(root, '.hidden.js'), `${SECRET}\n`);
    await mkdir(path.join(root, '.git'));
    await writeFile(path.join(root, '.git', 'config.js'), `${SECRET}\n`);
    for (const name of ['notes.txt', 'data.json', 'mod.mjs', 'app.js.map', 'README', 'evil.svgz']) {
      await writeFile(path.join(root, name), `${SECRET}\n`);
    }
    // Jonction de répertoire : autorisée sans droits admin sous Windows.
    await symlink(base, path.join(root, 'jlink'), 'junction');
    // Lien symbolique de fichier : peut exiger admin / mode développeur sous Windows.
    try {
      await symlink(path.join(base, 'secret.js'), path.join(root, 'flink.js'), 'file');
      fileSymlinkOk = true;
    } catch (error) {
      if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    }
    ({ server, port } = await start(root));
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(base, { recursive: true, force: true });
  });

  test('fichiers légitimes servis avec MIME de la liste blanche et nosniff', async () => {
    const cases = [
      ['/', 'text/html; charset=utf-8'],
      ['/index.html', 'text/html; charset=utf-8'],
      ['/app.js', 'text/javascript; charset=utf-8'],
      ['/style.css', 'text/css; charset=utf-8'],
      ['/sub/inner.js', 'text/javascript; charset=utf-8'],
    ];
    for (const [target, mime] of cases) {
      const res = await rawRequest(port, 'GET', target);
      assert.equal(res.status, 200, target);
      assert.equal(res.headers['content-type'], mime, target);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', target);
    }
  });

  const traversals = [
    '/../secret.js',
    '/../secret.html',
    '/../../secret.js',
    '/sub/../../secret.js',
    '/sub/../index.html',
    '/./app.js',
    '/%2e%2e/secret.js',
    '/%2E%2E/secret.js',
    '/%2e%2e%2fsecret.js',
    '/..%2fsecret.js',
    '/..%2Fsecret.js',
    '/sub/%2e%2e/%2e%2e/secret.js',
    '/%252e%252e/secret.js',
    '/%252e%252e%252fsecret.js',
    '/..%252fsecret.js',
    '/%c0%ae%c0%ae/secret.js',
    '/%c0%af..%c0%afsecret.js',
    '/..\\secret.js',
    '/sub\\..\\..\\secret.js',
    '/..%5csecret.js',
    '/..%5Csecret.js',
    '/%2e%2e%5csecret.js',
    '/..%255csecret.js',
    '/app.js%00.html',
    '/app.js%00',
    '/%00../secret.js',
    '/../root-evil/secret.js',
    '/%2e%2e/root-evil/secret.js',
    '//secret.js',
    '/sub//inner.js',
    '/.hidden.js',
    '/%2ehidden.js',
    '/.git/config.js',
    '/%2egit/config.js',
    '/jlink/secret.js',
    '/jlink/root-evil/secret.js',
    '/%E0%A4%A',
    '/%',
    '/%zz',
    '/secret.js/..',
    '/.',
    '/..',
  ];

  for (const target of traversals) {
    test(`traversée refusée : ${target}`, async () => {
      const res = await rawRequest(port, 'GET', target);
      assert.notEqual(res.status, 200, `${target} -> 200`);
      assert.ok(res.status >= 400 && res.status < 500, `${target} -> ${res.status}`);
      assertOpaqueError(res, [base, root]);
    });
  }

  test('traversée par chemin absolu disque (lettre de lecteur, UNC)', async () => {
    const abs = path.join(base, 'secret.js').split(path.sep).join('/');
    const targets = [
      `/${abs.replace(/^\//, '')}`,
      `/${encodeURIComponent(path.join(base, 'secret.js'))}`,
      `/${encodeURIComponent(abs)}`,
      '/C:/Windows/win.ini',
      '/C:%2fWindows%2fwin.ini',
      '//localhost/c$/Windows/win.ini',
    ];
    for (const target of targets) {
      const res = await rawRequest(port, 'GET', target);
      assert.ok(res.status >= 400 && res.status < 500, `${target} -> ${res.status}`);
      assertOpaqueError(res, [base, root]);
    }
  });

  test('octet nul et antislash bruts dans la ligne de requête', async () => {
    for (const target of ['/app.js\0.html', '/\0', '/..\\..\\secret.js']) {
      const res = await rawRequest(port, 'GET', target);
      assert.notEqual(res.status, 200, JSON.stringify(target));
      assert.ok(!res.raw.includes(SECRET));
    }
  });

  test('cible absolue (absolute-form) et astérisque refusées', async () => {
    for (const target of ['http://127.0.0.1/../secret.js', 'http://evil.example/app.js', '*']) {
      const res = await rawRequest(port, 'GET', target);
      assert.notEqual(res.status, 200, target);
      assertOpaqueError(res, [base, root]);
    }
  });

  test('lien symbolique de fichier vers l\'extérieur refusé', async (t) => {
    if (!fileSymlinkOk) {
      t.skip('symlink de fichier impossible sans droits (EPERM, Windows sans admin/mode dev) ; jonction testée à la place');
      return;
    }
    const res = await rawRequest(port, 'GET', '/flink.js');
    assert.equal(res.status, 404);
    assertOpaqueError(res, [base, root]);
  });

  test('extensions hors liste blanche -> 404 (txt, json, mjs, map, sans extension, svgz)', async () => {
    for (const target of ['/notes.txt', '/data.json', '/mod.mjs', '/app.js.map', '/README', '/evil.svgz']) {
      const res = await rawRequest(port, 'GET', target);
      assert.equal(res.status, 404, target);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assertOpaqueError(res, [base, root]);
    }
  });

  test('pas de listing de répertoire', async () => {
    for (const target of ['/sub', '/sub/', '/dir.js', '/dir.js/', '/jlink', '/jlink/']) {
      const res = await rawRequest(port, 'GET', target);
      assert.equal(res.status, 404, target);
      assert.doesNotMatch(res.body, /inner\.js|secret|index\.html|app\.js/);
      assertOpaqueError(res, [base, root]);
    }
  });

  test('méthodes autres que GET/HEAD -> 405 avec Allow, sans contenu du fichier', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE', 'PROPFIND', 'MKCOL']) {
      const extra = ['POST', 'PUT', 'PATCH'].includes(method) ? 'Content-Length: 0\r\n' : '';
      const res = await rawRequest(port, method, '/app.js', { extra });
      assert.equal(res.status, 405, method);
      assert.equal(res.headers.allow, 'GET, HEAD', method);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', method);
      assert.doesNotMatch(res.body, /export const ok/, method);
      assertOpaqueError(res, [base, root]);
    }
  });

  test('PUT ne crée ni ne modifie de fichier', async () => {
    const res = await rawRequest(port, 'PUT', '/new.js', { extra: 'Content-Length: 0\r\n' });
    assert.equal(res.status, 405);
    const after = await rawRequest(port, 'GET', '/new.js');
    assert.equal(after.status, 404);
  });

  test('HEAD : statut et en-têtes sans corps (200 et 404)', async () => {
    const ok = await rawRequest(port, 'HEAD', '/app.js');
    assert.equal(ok.status, 200);
    assert.equal(ok.body, '');
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    const ko = await rawRequest(port, 'HEAD', '/../secret.js');
    assert.equal(ko.status, 404);
    assert.equal(ko.body, '');
  });

  test('pas de fuite de version serveur ni de X-Powered-By', async () => {
    const res = await rawRequest(port, 'GET', '/app.js');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.equal(res.headers.server, undefined);
  });

  test('URL très longue : pas de crash ni de détail', async () => {
    const res = await rawRequest(port, 'GET', `/${'a/'.repeat(2000)}x.js`);
    // 500 toléré (ENAMETOOLONG possible selon l'OS) tant que la réponse reste opaque.
    assert.ok([404, 414, 431, 500].includes(res.status), String(res.status));
    assertOpaqueError(res, [base, root]);
    const alive = await rawRequest(port, 'GET', '/app.js');
    assert.equal(alive.status, 200, 'serveur toujours vivant');
  });

  test('createStaticServer refuse une racine relative ou absente', () => {
    assert.throws(() => createStaticServer({ root: 'src' }), TypeError);
    assert.throws(() => createStaticServer({ root: '' }), TypeError);
    assert.throws(() => createStaticServer({}), TypeError);
    assert.throws(() => createStaticServer(), TypeError);
  });
});

describe('serveur statique : racine réelle src/ du dépôt', () => {
  let server;
  let port;
  before(async () => {
    ({ server, port } = await start(path.join(repoRoot, 'src')));
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test('fichiers hors src/ inaccessibles (package.json, scripts, tests, .git, .claude, AGENTS.md)', async () => {
    const targets = [
      '/../package.json',
      '/%2e%2e/package.json',
      '/../scripts/static-server.mjs',
      '/../scripts/serve.mjs',
      '/../tests/unit/security-static-scan.test.js',
      '/%2e%2e/tests/functional/security-static-server.test.js',
      '/../.git/config',
      '/../.claude/agents/testeur-securite.md',
      '/..%5c.claude%5csettings.json',
      '/../AGENTS.md',
      '/../.github/copilot-instructions.md',
    ];
    for (const target of targets) {
      const res = await rawRequest(port, 'GET', target);
      assert.equal(res.status, 404, target);
      assertOpaqueError(res, [repoRoot]);
    }
  });

  test('page d\'accueil servie en HTML avec nosniff', async () => {
    const res = await rawRequest(port, 'GET', '/');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });
});

describe('scripts/serve.mjs : écoute loopback uniquement', () => {
  /** Lance serve.mjs et attend l'URL annoncée. */
  function launch(env) {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts', 'serve.mjs')], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`pas d'annonce : ${out}${err}`)), 10000);
      child.stdout.on('data', (c) => {
        out += c;
        const m = out.match(/http:\/\/([\d.]+):(\d+)\//);
        if (m && out.includes('\n', m.index)) {
          clearTimeout(timer);
          resolve({ host: m[1], port: Number(m[2]) });
        }
      });
      child.stderr.on('data', (c) => (err += c));
      child.on('exit', (code) => {
        clearTimeout(timer);
        reject(Object.assign(new Error(`sortie ${code}`), { code, out, err }));
      });
    });
    return { child, ready, output: () => ({ out, err }) };
  }

  function waitExit(child) {
    return new Promise((resolve) => {
      if (child.exitCode !== null) resolve(child.exitCode);
      else child.on('exit', (code) => resolve(code));
    });
  }

  test('annonce 127.0.0.1, sert src/, injoignable via une IP non loopback', async (t) => {
    const { child, ready, output } = launch({ PORT: '0' });
    try {
      const { host, port } = await ready;
      assert.equal(host, '127.0.0.1');
      await new Promise((r) => setTimeout(r, 50));
      assert.ok(
        output().out.includes(path.join(repoRoot, 'src')),
        'dossier servi annoncé = <dépôt>/src',
      );
      const res = await rawRequest(port, 'GET', '/../package.json');
      assert.equal(res.status, 404);
      const home = await rawRequest(port, 'GET', '/');
      assert.equal(home.status, 200);

      const external = Object.values(os.networkInterfaces())
        .flat()
        .find((i) => i && i.family === 'IPv4' && !i.internal);
      if (!external) {
        t.diagnostic('aucune interface IPv4 non loopback : vérification externe sautée');
      } else {
        const reachable = await new Promise((resolve) => {
          const s = net.connect({ host: external.address, port });
          s.setTimeout(2000, () => {
            s.destroy();
            resolve(false);
          });
          s.on('connect', () => {
            s.destroy();
            resolve(true);
          });
          s.on('error', () => resolve(false));
        });
        assert.equal(reachable, false, `serveur joignable via ${external.address}`);
      }
      const v6 = await new Promise((resolve) => {
        const s = net.connect({ host: '::1', port });
        s.setTimeout(2000, () => {
          s.destroy();
          resolve(false);
        });
        s.on('connect', () => {
          s.destroy();
          resolve(true);
        });
        s.on('error', () => resolve(false));
      });
      assert.equal(v6, false, 'serveur joignable via ::1 (écoute pas limitée à 127.0.0.1)');
    } finally {
      child.kill();
      await waitExit(child);
    }
  });

  test('PORT invalide : sortie 1, message court sans stack trace', async () => {
    for (const value of ['abc', '-1', '70000', '80; rm -rf /', '1e3']) {
      const { child, ready } = launch({ PORT: value });
      const error = await ready.then(
        () => null,
        (e) => e,
      );
      if (error === null) child.kill();
      assert.ok(error, `PORT=${value} accepté`);
      assert.equal(error.code, 1, `PORT=${value}`);
      assert.doesNotMatch(error.err, /\n\s+at\s|node:internal/, `stack trace pour PORT=${value}`);
    }
  });
});
