/**
 * Static preview server.
 *
 * Runs the build first so dist/ is always current, then serves it. Binds
 * 0.0.0.0 because Freebuff reaches the preview from outside the container and
 * injects the port via PORT.
 *
 * Never launch this directly with `npm run dev` - Freebuff owns the preview
 * process and starts it with `freebuff-preview start`.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT, 'dist');

const PORT = Number(process.env.PORT) || 4173;
const HOST = '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function resolveRequest(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = path.join(DIST_DIR, relative);

  // Containment check: never serve anything outside dist/.
  if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + path.sep)) return null;

  let target = candidate;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;

  return target;
}

async function main() {
  build();

  if (!fs.existsSync(DIST_DIR)) {
    throw new Error('dist/ was not produced by the build');
  }

  const server = http.createServer((req, res) => {
    const target = resolveRequest(req.url || '/');

    if (!target) {
      send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
      return;
    }

    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';

    let body;
    try {
      body = fs.readFileSync(target);
    } catch {
      send(res, 500, 'Internal error', { 'content-type': 'text/plain; charset=utf-8' });
      return;
    }

    send(res, 200, body, { 'content-type': type, 'content-length': body.length });
  });

  server.on('error', (error) => {
    console.error('[preview] failed to start:', error.message);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`[preview] serving dist/ on http://${HOST}:${PORT}`);
  });
}

main().catch((error) => {
  console.error('[preview]', error);
  process.exit(1);
});
