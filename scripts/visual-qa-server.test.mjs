// Tests du serveur visual-qa : node --test "scripts/*.test.mjs"
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { createVisualQaServer, parseArgs, toRelativePath, decodePngDataUrl } from "./visual-qa-server.mjs";

// PNG 1x1 valide.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const DATA_URL = `data:image/png;base64,${PNG_BASE64}`;

let dir;
let server;
let port;

function request({ method = "GET", target, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: target, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const origin = () => `http://127.0.0.1:${port}`;
const capture = (query, body = DATA_URL, headers = { origin: origin() }) =>
  request({ method: "POST", target: `/__visual-qa/capture?${query}`, headers: { "content-type": "text/plain", ...headers }, body });

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "vqa-"));
  await mkdir(path.join(dir, "site", "js"), { recursive: true });
  await writeFile(path.join(dir, "site", "index.html"), "<h1>jeu</h1>");
  await writeFile(path.join(dir, "site", "js", "main.js"), "export {};");
  await writeFile(path.join(dir, "site", ".env"), "SECRET=1");
  await writeFile(path.join(dir, "secret.html"), "hors racine");
  server = await createVisualQaServer({ root: path.join(dir, "site"), out: path.join(dir, "out") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

test("sert index.html et les fichiers de la racine", async () => {
  assert.equal((await request({ target: "/" })).body, "<h1>jeu</h1>");
  assert.equal((await request({ target: "/js/main.js" })).status, 200);
});

test("refuse la sortie de la racine, les fichiers cachés et les extensions inconnues", async () => {
  for (const target of ["/../secret.html", "/%2e%2e/secret.html", "/..%2fsecret.html", "/.env", "/js/", "/a%5Cb.js"]) {
    assert.equal((await request({ target })).status, 404, target);
  }
});

test("refuse un en-tête Host étranger (DNS rebinding)", async () => {
  assert.equal((await request({ target: "/", headers: { host: `evil.example:${port}` } })).status, 421);
});

test("enregistre une capture PNG dans <out>/<item>/<nom>.png", async () => {
  const res = await capture("item=T1&name=01-murs");
  assert.equal(res.status, 201);
  assert.deepEqual(JSON.parse(res.body), { file: "T1/01-murs.png" });
  const saved = await readFile(path.join(dir, "out", "T1", "01-murs.png"));
  assert.equal(saved.toString("base64"), PNG_BASE64);
});

test("refuse une capture sans Origin ou d'une autre origine", async () => {
  assert.equal((await capture("item=T1&name=a", DATA_URL, {})).status, 403);
  assert.equal((await capture("item=T1&name=a", DATA_URL, { origin: "http://evil.example" })).status, 403);
});

test("refuse des identifiants dangereux", async () => {
  for (const query of ["item=..&name=a", "item=T1&name=../../x", "item=T1%2F..&name=a", "item=&name=a", "item=T1"]) {
    assert.equal((await capture(query)).status, 400, query);
  }
  assert.equal(existsSync(path.join(dir, "x.png")), false);
});

test("refuse ce qui n'est pas un PNG", async () => {
  assert.equal((await capture("item=T1&name=b", "data:image/png;base64,QUJDREVGR0hJSg==")).status, 415);
  assert.equal((await capture("item=T1&name=b", "data:text/html;base64,PGgxPg==")).status, 415);
});

test("refuse les autres méthodes", async () => {
  assert.equal((await request({ method: "PUT", target: "/index.html" })).status, 405);
  assert.equal((await request({ target: "/__visual-qa/capture?item=T1&name=a" })).status, 405);
});

test("utilitaires purs", () => {
  assert.equal(toRelativePath("/"), "index.html");
  assert.equal(toRelativePath("/a/../b.js"), null);
  assert.ok(decodePngDataUrl(DATA_URL));
  assert.equal(decodePngDataUrl("nope"), null);
  assert.deepEqual(parseArgs(["--root", "src", "--out", "o"]), { root: "src", out: "o", port: 8765 });
  assert.throws(() => parseArgs(["--root", "src"]));
  assert.throws(() => parseArgs(["--root", "s", "--out", "o", "--port", "99999"]));
});
