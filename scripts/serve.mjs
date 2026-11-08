// CLI: serves <repo>/src on 127.0.0.1 (never the repository root).
// Port: PORT environment variable, default 8080.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './static-server.mjs';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 8080;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..', 'src');

/**
 * @param {string | undefined} value
 * @returns {number} TCP port
 */
function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`PORT invalide : ${JSON.stringify(value)} (entier entre 0 et 65535 attendu).`);
    process.exit(1);
  }
  return port;
}

const port = parsePort(process.env.PORT);
const server = createStaticServer({ root });

server.on('error', (error) => {
  console.error(`Impossible de démarrer le serveur : ${error.message}`);
  process.exit(1);
});

server.listen(port, HOST, () => {
  const { port: actualPort } = server.address();
  console.log(`Serveur de développement : http://${HOST}:${actualPort}/`);
  console.log(`Dossier servi : ${root}`);
});
