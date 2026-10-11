/**
 * Dev server with live reload.
 *
 * Same static output as serve.mjs (builds site/ -> dist/), plus:
 *   - watches site/, extension/, desktop/ and rebuilds on change (debounced)
 *   - serves an SSE endpoint at /__reload that tells the browser to refresh
 *   - injects a tiny EventSource snippet into served HTML pages
 *
 * Usage: PORT=3002 node scripts/dev.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(ROOT, 'dist');
const SITE_DIR = path.join(ROOT, 'site');
const EXT_DIR = path.join(ROOT, 'extension');
const DESKTOP_DIR = path.join(ROOT, 'desktop');

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

const RELOAD_SNIPPET = `\n<!-- dev live-reload -->\n<script>(()=>{const s=new EventSource("/__reload");s.onmessage=e=>{if(e.data==="reload")location.reload()};s.onerror=()=>setTimeout(()=>location.reload(),3000)})();</script>\n`;

const clients = new Set();
let buildTimer = null;

function doBuild(reason) {
  try {
    build();
    console.log(`[dev] rebuilt (${reason})`);
    for (const res of clients) {
      try { res.write(`data: reload\n\n`); } catch {}
    }
  } catch (err) {
    console.error('[dev] rebuild failed:', err.message);
  }
}

function scheduleRebuild(reason) {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(() => doBuild(reason), 150);
}

function watchDir(dir) {
  try {
    fs.watch(dir, { recursive: true }, (event, file) => {
      if (!file) return;
      const name = String(file);
      // Ignore build output churn: downloads/ and update.xml are written by build itself.
      if (name.includes('downloads') || name === 'update.xml') return;
      scheduleRebuild(`${event}:${name}`);
    });
    console.log(`[dev] watching ${path.relative(ROOT, dir)}/`);
  } catch (err) {
    console.error(`[dev] cannot watch ${dir}:`, err.message);
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function resolveRequest(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  let relative = path.normalize(decoded).split('?')[0]; if (relative.includes('..')) relative = '/';
  const candidate = path.join(DIST_DIR, relative);
  if (candidate !== DIST_DIR && !candidate.startsWith(DIST_DIR + path.sep)) return null;
  let target = candidate;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
  if (!fs.existsSync(target) && path.extname(target) === '') {
    const withHtml = `${target}.html`;
    if (fs.existsSync(withHtml) && fs.statSync(withHtml).isFile()) return withHtml;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  return target;
}

doBuild('initial');
for (const d of [SITE_DIR, EXT_DIR, DESKTOP_DIR]) if (fs.existsSync(d)) watchDir(d);

const server = http.createServer((req, res) => {
  if (req.url === '/__reload') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: connected\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  const target = resolveRequest(req.url || '/');
  if (!target) { send(res, 404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' }); return; }
  const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
  let body;
  try { body = fs.readFileSync(target); } catch { send(res, 500, 'Internal error', { 'content-type': 'text/plain; charset=utf-8' }); return; }
  if (type.startsWith('text/html')) {
    let html = body.toString('utf8');
    if (!html.includes('/__reload')) html = html.replace(/<\/body>/i, `${RELOAD_SNIPPET}</body>`);
    body = Buffer.from(html);
  }
  send(res, 200, body, { 'content-type': type, 'content-length': body.length });
});

server.on('error', (e) => { console.error('[dev] failed to start:', e.message); process.exit(1); });
server.listen(PORT, HOST, () => console.log(`[dev] serving dist/ with live reload on http://${HOST}:${PORT}`));
