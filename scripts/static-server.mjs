// Static file server for local development (no dependency, Node >= 20).
// Generic on purpose: it knows nothing about the served tree except the rule
// "/" -> "index.html". Security rules: GET/HEAD only, no directory listing,
// no path traversal (encoded, backslash, null byte), MIME whitelist.
import { createServer, STATUS_CODES } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/** Whitelist of served extensions. Unknown extension -> 404. */
const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
});

const ALLOWED_METHODS = 'GET, HEAD';

/**
 * Checks that `candidate` is `root` itself or lies inside it.
 * Uses a path.sep prefix check (no naive string comparison).
 * @param {string} root absolute, resolved
 * @param {string} candidate absolute, resolved
 * @returns {boolean}
 */
function isInside(root, candidate) {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate === root || candidate.startsWith(prefix);
}

/**
 * Converts the raw request target into a safe relative path, or null if the
 * request must be refused.
 * @param {string} rawUrl request target as received (req.url)
 * @returns {string | null} relative path with "/" separators, without leading "/"
 */
function toRelativePath(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/')) return null;
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  // Raw backslash or null byte (encoded or not) is never legitimate.
  if (rawPath.includes('\\') || rawPath.includes('\0')) return null;

  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\\') || decoded.includes('\0')) return null;

  if (decoded === '/') return 'index.html';

  const segments = decoded.slice(1).split('/');
  for (const segment of segments) {
    // Empty segment ("//" or trailing "/" = directory request), "." / ".."
    // and hidden files are all refused.
    if (segment === '' || segment.startsWith('.')) return null;
  }
  return segments.join('/');
}

/**
 * Sends a short plain-text status response (no stack trace, no detail).
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {Record<string, string>} [extraHeaders]
 */
function sendStatus(res, status, extraHeaders = {}) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const body = `${status} ${STATUS_CODES[status] ?? ''}\n`;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

/**
 * Resolves a request to an absolute file path inside root, or null (-> 404).
 * Follows symlinks with realpath and re-checks containment.
 * @param {string} realRoot
 * @param {string} relativePath
 * @returns {Promise<{ filePath: string, size: number, mime: string } | null>}
 */
async function resolveFile(realRoot, relativePath) {
  const mime = MIME_TYPES[path.extname(relativePath).toLowerCase()];
  if (!mime) return null;

  const candidate = path.resolve(realRoot, ...relativePath.split('/'));
  if (!isInside(realRoot, candidate)) return null;

  let filePath;
  try {
    filePath = await realpath(candidate);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
  if (!isInside(realRoot, filePath)) return null;

  const info = await stat(filePath);
  if (!info.isFile()) return null; // directory -> 404, no listing
  return { filePath, size: info.size, mime };
}

/**
 * @param {{ root: string }} options dossier racine servi (chemin absolu)
 * @returns {import('node:http').Server} non démarré (l'appelant fait listen)
 * @throws {TypeError} si root n'est pas un chemin absolu
 */
export function createStaticServer({ root } = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new TypeError('root must be an absolute path');
  }
  const resolvedRoot = path.resolve(root);
  // Resolved per request (cheap) so that a root created after startup works.
  const getRealRoot = () => realpath(resolvedRoot);

  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendStatus(res, 405, { Allow: ALLOWED_METHODS });
        return;
      }

      const relativePath = toRelativePath(req.url);
      if (relativePath === null) {
        sendStatus(res, 404);
        return;
      }

      const file = await resolveFile(await getRealRoot(), relativePath);
      if (file === null) {
        sendStatus(res, 404);
        return;
      }

      res.writeHead(200, {
        'Content-Type': file.mime,
        'Content-Length': file.size,
      });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      const stream = createReadStream(file.filePath);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch {
      sendStatus(res, 500);
    }
  });
}
