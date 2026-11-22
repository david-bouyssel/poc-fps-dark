// Serveur local de la vague visual-qa : sert l'application en statique et enregistre les
// captures PNG du canvas envoyées par la page.
//
// Usage :
//   node scripts/visual-qa-server.mjs --root <dossier servi> --out <dossier des captures>
//                                     [--port 8765]
//
// Routes :
//   GET/HEAD /<fichier>                         fichier statique de --root ("/" -> index.html)
//   POST /__visual-qa/capture?item=<id>&name=<nom>
//        corps : data URL "data:image/png;base64,..." (text/plain)
//        écrit <out>/<id>/<nom>.png et répond {"file":"<id>/<nom>.png"}
//
// Règles de sécurité : écoute 127.0.0.1 seulement ; en-tête Host limité à 127.0.0.1 et
// localhost (anti DNS rebinding) ; POST seulement depuis la même origine (en-tête Origin
// obligatoire) ; identifiants [A-Za-z0-9_-] ; PNG vérifié (signature) et limité à 10 Mo ;
// statique en GET/HEAD, sans listing, sans fichier caché, sans sortie de --root, liste
// blanche d'extensions.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 8765;
const CAPTURE_ROUTE = "/__visual-qa/capture";
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MIME_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
});

function isInside(root, candidate) {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate === root || candidate.startsWith(prefix);
}

function send(res, status, body = "", type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function allowedHosts(port) {
  return new Set([`${HOST}:${port}`, `localhost:${port}`]);
}

/** Chemin relatif sûr ("a/b.js"), ou null si la requête doit être refusée. */
export function toRelativePath(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.startsWith("/")) return null;
  if (rawPath.includes("\\") || rawPath.includes("\0")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) return null;
  if (decoded === "/") return "index.html";
  const segments = decoded.slice(1).split("/");
  if (segments.some((s) => s === "" || s.startsWith("."))) return null;
  return segments.join("/");
}

/** Décode une data URL PNG ; null si le format ou la signature ne conviennent pas. */
export function decodePngDataUrl(text) {
  if (typeof text !== "string" || !text.startsWith(DATA_URL_PREFIX)) return null;
  const base64 = text.slice(DATA_URL_PREFIX.length).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length < PNG_SIGNATURE.length) return null;
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
  return bytes;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleCapture(req, res, url, outDir, port) {
  const origin = req.headers.origin;
  const allowedOrigins = [...allowedHosts(port)].map((h) => `http://${h}`);
  if (!origin || !allowedOrigins.includes(origin)) return send(res, 403, "403 Forbidden\n");
  const item = url.searchParams.get("item");
  const name = url.searchParams.get("name");
  if (!ID_PATTERN.test(item ?? "") || !ID_PATTERN.test(name ?? "")) {
    return send(res, 400, "400 Bad Request\n");
  }
  let body;
  try {
    body = await readBody(req, MAX_BODY_BYTES);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) send(res, error.status ?? 400, "Bad body\n");
    return;
  }
  const png = decodePngDataUrl(body);
  if (!png) return send(res, 415, "415 Unsupported Media Type\n");
  const dir = path.join(outDir, item);
  const file = path.join(dir, `${name}.png`);
  if (!isInside(outDir, file)) return send(res, 400, "400 Bad Request\n");
  await mkdir(dir, { recursive: true });
  await writeFile(file, png);
  return send(res, 201, JSON.stringify({ file: `${item}/${name}.png` }), "application/json");
}

async function handleStatic(req, res, url, rootReal) {
  const relative = toRelativePath(url.pathname);
  if (relative === null) return send(res, 404, "404 Not Found\n");
  const type = MIME_TYPES[path.extname(relative).toLowerCase()];
  if (!type) return send(res, 404, "404 Not Found\n");
  let real;
  try {
    real = await realpath(path.join(rootReal, ...relative.split("/")));
    if (!isInside(rootReal, real) || !(await stat(real)).isFile()) throw new Error("not a file");
  } catch {
    return send(res, 404, "404 Not Found\n");
  }
  const { size } = await stat(real);
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(real).on("error", () => res.destroy()).pipe(res);
}

/**
 * @param {{ root: string, out: string }} options dossiers absolus ou relatifs au dossier courant
 * @returns {Promise<import('node:http').Server>} serveur non démarré
 */
export async function createVisualQaServer({ root, out }) {
  const rootReal = await realpath(path.resolve(root));
  const outDir = path.resolve(out);
  const server = createServer((req, res) => {
    const port = server.address()?.port;
    if (!allowedHosts(port).has(req.headers.host ?? "")) return send(res, 421, "421 Misdirected Request\n");
    let url;
    try {
      url = new URL(req.url ?? "/", `http://${HOST}:${port}`);
    } catch {
      return send(res, 400, "400 Bad Request\n");
    }
    const task = url.pathname === CAPTURE_ROUTE
      ? (req.method === "POST" ? handleCapture(req, res, url, outDir, port) : send(res, 405, "405 Method Not Allowed\n"))
      : (req.method === "GET" || req.method === "HEAD" ? handleStatic(req, res, url, rootReal) : send(res, 405, "405 Method Not Allowed\n"));
    Promise.resolve(task).catch(() => {
      if (!res.headersSent) send(res, 500, "500 Internal Server Error\n");
      else res.destroy();
    });
  });
  return server;
}

export function parseArgs(argv) {
  const args = { port: DEFAULT_PORT };
  for (let i = 0; i < argv.length; i += 2) {
    const [key, value] = [argv[i], argv[i + 1]];
    if (value === undefined) throw new Error(`valeur manquante pour ${key}`);
    if (key === "--root") args.root = value;
    else if (key === "--out") args.out = value;
    else if (key === "--port") {
      if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) throw new Error(`port invalide : ${value}`);
      args.port = Number(value);
    } else throw new Error(`option inconnue : ${key}`);
  }
  if (!args.root || !args.out) throw new Error("--root et --out sont obligatoires");
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Erreur : ${error.message}`);
    console.error("Usage : node scripts/visual-qa-server.mjs --root <dossier> --out <dossier> [--port 8765]");
    process.exit(2);
  }
  const server = await createVisualQaServer(args);
  server.on("error", (error) => {
    console.error(`Impossible de démarrer le serveur : ${error.message}`);
    process.exit(1);
  });
  server.listen(args.port, HOST, () => {
    console.log(`visual-qa : http://${HOST}:${server.address().port}/`);
  });
}
