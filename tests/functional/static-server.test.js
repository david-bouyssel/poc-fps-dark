import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../../scripts/static-server.mjs';

const root = fileURLToPath(new URL('../../src/', import.meta.url));
const pkgContent = readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8');

let server;
let base;
let port;

before(async () => {
  server = createStaticServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function rawRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET / -> 200 text/html, contient <canvas et charge ./main.js en module', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8/);
  const body = await res.text();
  assert.ok(body.includes('<canvas'), 'pas de <canvas');
  assert.match(body, /<script[^>]*type=["']module["'][^>]*src=["']\.\/main\.js["']|<script[^>]*src=["']\.\/main\.js["'][^>]*type=["']module["']/);
});

test('GET /index.html -> même contenu que /', async () => {
  const a = await (await fetch(`${base}/`)).text();
  const b = await fetch(`${base}/index.html`);
  assert.equal(b.status, 200);
  assert.equal(await b.text(), a);
});

test('GET /main.js -> 200 text/javascript', async () => {
  const res = await fetch(`${base}/main.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/javascript; charset=utf-8/);
  await res.arrayBuffer();
});

test('GET /maze/maze.js -> 200 text/javascript', async () => {
  const res = await fetch(`${base}/maze/maze.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/javascript; charset=utf-8/);
  const body = await res.text();
  assert.ok(body.includes('generateMaze'));
});

test('GET /styles.css -> 200 text/css', async () => {
  const res = await fetch(`${base}/styles.css`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/css; charset=utf-8/);
  await res.arrayBuffer();
});

test('HEAD / -> 200 sans corps', async () => {
  const res = await rawRequest('/', 'HEAD');
  assert.equal(res.status, 200);
  assert.equal(res.body, '');
});

test('GET /absent.js -> 404', async () => {
  const res = await fetch(`${base}/absent.js`);
  assert.equal(res.status, 404);
  await res.arrayBuffer();
});

test('GET /maze/ -> 404 (pas de listing)', async () => {
  const res = await fetch(`${base}/maze/`);
  assert.equal(res.status, 404);
  const body = await res.text();
  assert.ok(!body.includes('maze.js'));
});

test('traversée de chemin -> jamais 200 ni contenu de package.json', async () => {
  const paths = ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/..%5cpackage.json', '/%00'];
  for (const p of paths) {
    const res = await rawRequest(p);
    assert.notEqual(res.status, 200, `${p} -> 200`);
    assert.ok([400, 403, 404].includes(res.status), `${p} -> ${res.status}`);
    assert.ok(!res.body.includes('"scripts"'), `${p} renvoie package.json`);
    assert.notEqual(res.body, pkgContent);
  }
});

test('POST / -> 405', async () => {
  const res = await fetch(`${base}/`, { method: 'POST', body: 'x' });
  assert.equal(res.status, 405);
  await res.arrayBuffer();
});

test('PUT et DELETE -> 405', async () => {
  for (const method of ['PUT', 'DELETE']) {
    const res = await rawRequest('/', method);
    assert.equal(res.status, 405, method);
  }
});

test('en-têtes nosniff et no-store présents', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  await res.arrayBuffer();
});

// --- Vue FPS (plan docs/design/vue-fps.md §6) ---

const FPS_MODULES = [
  ['/game/player.js', 'createPlayer'],
  ['/game/input.js', 'actionForCode'],
  ['/game/movement.js', 'stepPlayer'],
  ['/game/loop.js', 'createGameLoop'],
  ['/render/raycaster.js', 'castRays'],
  ['/render/fps-renderer.js', 'drawFpsView'],
  // Textures des murs (plan docs/design/fps-wall-textures.md §6)
  ['/render/wall-textures.js', 'generateWallTexture'],
  // Textures sol/plafond (plan docs/design/fps-sol-plafond-textures.md §6)
  ['/render/surface-textures.js', 'castSurfaces'],
  // Automap (plan docs/design/fps-automap.md §6)
  ['/render/automap.js', 'revealVisibleTiles'],
  ['/render/automap-renderer.js', 'drawAutomap'],
  // Sprites billboard (plan docs/design/fps-fruits-score.md §3, généralisé par dark-retrait-fruits.md)
  ['/render/sprites.js', 'projectSprites'],
  // Apparence du monstre (plan docs/design/dark-monstre-apparence.md)
  ['/render/monster-sprite.js', 'generateMonsterSprite'],
];

for (const [path, symbol] of FPS_MODULES) {
  test(`GET ${path} -> 200 text/javascript`, async () => {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/javascript; charset=utf-8/);
    const body = await res.text();
    assert.ok(body.includes(symbol), `${path} ne contient pas ${symbol}`);
  });
}

test('GET / contient fps-enter-button, fps-exit-button, fps-help', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const id of ['fps-enter-button', 'fps-exit-button', 'fps-help']) {
    assert.match(body, new RegExp(`id=["']${id}["']`), id);
  }
  // en vue de dessus au chargement : sortie et aide masquées, entrée visible
  assert.match(body, /<button[^>]*id=["']fps-exit-button["'][^>]*\shidden[\s>=]|<button[^>]*\shidden[^>]*id=["']fps-exit-button["']/);
  assert.match(body, /<p[^>]*id=["']fps-help["'][^>]*\shidden[\s>=]|<p[^>]*\shidden[^>]*id=["']fps-help["']/);
  const enter = body.match(/<button[^>]*id=["']fps-enter-button["'][^>]*>/)[0];
  assert.ok(!/\shidden[\s>=]/.test(enter), 'bouton entrer masqué au chargement');
});

test('retrait : /game/fruits.js et /render/fruit-sprites.js -> 404', async () => {
  for (const path of ['/game/fruits.js', '/render/fruit-sprites.js']) {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 404, path);
    await res.body?.cancel();
  }
});

test('retrait : GET / ne contient plus de HUD (fps-hud, fps-score, fps-all-collected, fps-fruit-legend)', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const id of ['fps-hud', 'fps-score', 'fps-all-collected', 'fps-fruit-legend']) {
    assert.doesNotMatch(body, new RegExp(`id=["']${id}["']`), id);
  }
  assert.doesNotMatch(body, /class=["'][^"']*\bhud\b/, 'classe hud résiduelle');
});

// --- Sortie et victoire (plan docs/design/dark-sortie-victoire.md §6) ---

const EXIT_MODULES = [
  ['/game/pathfinding.js', 'shortestPath'],
  ['/game/exit.js', 'findExit'],
  ['/game/game-state.js', 'checkVictory'],
  ['/render/exit-texture.js', 'generateExitTexture'],
  // Monstre (plan docs/design/dark-monstre.md §6)
  ['/game/monster.js', 'stepMonster'],
];

for (const [path, symbol] of EXIT_MODULES) {
  test(`sortie : GET ${path} -> 200 text/javascript`, async () => {
    const res = await fetch(`${base}${path}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/javascript; charset=utf-8/);
    const body = await res.text();
    assert.ok(body.includes(symbol), `${path} ne contient pas ${symbol}`);
  });
}

test('sortie : GET / contient end-screen, replay-button, end-new-maze-button, fps-goal', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  for (const id of ['end-screen', 'end-title', 'end-message', 'replay-button', 'end-new-maze-button', 'fps-goal']) {
    assert.match(body, new RegExp(`id=["']${id}["']`), id);
  }
  const tagOf = (id) => body.match(new RegExp(`<[a-z0-9]+[^>]*id=["']${id}["'][^>]*>`))[0];
  // Masqués au chargement.
  for (const id of ['end-screen', 'fps-goal']) {
    assert.match(tagOf(id), /\shidden[\s>=]/, `${id} visible au chargement`);
  }
  // Accessibilité de l'écran de fin.
  const screen = tagOf('end-screen');
  assert.match(screen, /role=["']alertdialog["']/);
  assert.match(screen, /aria-labelledby=["']end-title["']/);
  assert.match(screen, /aria-describedby=["']end-message["']/);
  for (const id of ['replay-button', 'end-new-maze-button']) {
    assert.match(tagOf(id), /^<button/, `${id} doit être un bouton`);
    assert.match(tagOf(id), /type=["']button["']/, `${id} type=button`);
  }
  // Écran de fin placé dans #maze-stage, après le canvas.
  const stage = body.indexOf('id="maze-stage"');
  assert.ok(stage >= 0, 'maze-stage absent');
  assert.ok(body.indexOf('<canvas', stage) < body.indexOf('id="end-screen"'), 'end-screen avant le canvas');
});

test('sortie : écran de fin et objectif sans texte en dur', async () => {
  const body = await (await fetch(`${base}/`)).text();
  const start = body.indexOf('<div id="end-screen"');
  assert.ok(start >= 0);
  // Contenu jusqu'au dernier bouton de l'écran de fin inclus.
  const end = body.indexOf('</button>', body.indexOf('id="end-new-maze-button"')) + '</button>'.length;
  const fragment = body.slice(start, end).replace(/<[^>]*>/g, ' ');
  assert.deepEqual(fragment.match(/\p{L}+/gu) ?? [], []);
  const goal = body.match(/<p[^>]*id=["']fps-goal["'][^>]*>([\s\S]*?)<\/p>/);
  assert.ok(goal);
  assert.equal(goal[1].trim(), '');
});
