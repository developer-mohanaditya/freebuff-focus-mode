/**
 * Build pipeline.
 *
 *   extension/  ->  site/downloads/freebuff-adblock-<version>.zip
 *               ->  site/update.xml
 *   site/       ->  dist/   (static output the preview and hosting serve)
 *
 * Idempotent and dependency-free so it runs identically in the sandbox and in
 * the production build image (Node only, no shell utilities, no network).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureIcons } from './png.mjs';
import { createZip, walk } from './zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_DIR = path.join(ROOT, 'extension');
const SITE_DIR = path.join(ROOT, 'site');
const DIST_DIR = path.join(ROOT, 'dist');
const ICONS_DIR = path.join(EXT_DIR, 'icons');
const DOWNLOADS_DIR = path.join(SITE_DIR, 'downloads');

/**
 * Public origin the install page and update feed are served from.
 * Must match INSTALL_URL in extension/popup.js.
 * Override with SITE_ORIGIN when the project is deployed elsewhere.
 */
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://freebuff-adblock.vercel.app';

const ZIP_ROOT_FOLDER = 'freebuff-adblock';

/** Chrome rejects this feed until the real ID and a signed CRX exist. */
const PLACEHOLDER_APP_ID = 'YOUR_EXTENSION_ID_HERE';

function log(...parts) {
  console.log('[build]', ...parts);
}

/* ------------------------------------------------------------------ helpers */

function readManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'));
  if (!/^\d+(\.\d+){0,3}$/.test(String(manifest.version))) {
    throw new Error(`manifest.json version "${manifest.version}" is not a valid version`);
  }
  return manifest;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/* ------------------------------------------------------------- package the zip */

function packageExtension(version) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

  const files = walk(EXT_DIR).sort();
  if (!files.includes('manifest.json')) {
    throw new Error('extension/manifest.json not found - nothing to package');
  }

  // The manifest must sit at the root of the archive Chrome extracts, and a
  // single top-level folder keeps the extracted result tidy.
  const entries = files.map((relative) => {
    const absolute = path.join(EXT_DIR, relative);
    return {
      name: `${ZIP_ROOT_FOLDER}/${relative.split(path.sep).join('/')}`,
      data: fs.readFileSync(absolute),
    };
  });

  const zip = createZip(entries);
  const fileName = `freebuff-adblock-${version}.zip`;
  const outPath = path.join(DOWNLOADS_DIR, fileName);

  // Remove stale packages so downloads/ never accumulates old versions.
  for (const existing of fs.readdirSync(DOWNLOADS_DIR)) {
    if (existing.endsWith('.zip') && existing !== fileName) {
      fs.unlinkSync(path.join(DOWNLOADS_DIR, existing));
      log('removed stale package', existing);
    }
  }

  fs.writeFileSync(outPath, zip);

  return {
    fileName,
    relativePath: `downloads/${fileName}`,
    absoluteUrl: `${SITE_ORIGIN}/downloads/${fileName}`,
    bytes: zip.length,
    fileCount: entries.length,
  };
}

/* ---------------------------------------------------------------- update feed */

function writeUpdateXml(version, packageInfo) {
  const xml = `<?xml version='1.0' encoding='UTF-8'?>
<!--
  Chromium update manifest for Freebuff Ad Block.

  BEFORE THIS FEED GOES LIVE:
    1. Replace ${PLACEHOLDER_APP_ID} with the real 32-character extension ID
       (chrome://extensions -> Details -> ID) of the PACKED extension.
    2. Publish the extension's .crx and point codebase at it. A .zip is only a
       placeholder here - Chrome installs from an update feed expect a CRX.
    3. Make sure SITE_ORIGIN (scripts/build.mjs) matches the domain this file
       is actually served from.

  Chrome only consults this feed for extensions installed FROM it, i.e. via a
  managed ExtensionInstallForcelist policy or the Chrome Web Store. An
  extension loaded unpacked never reads it. See the Auto-updates section of the
  install page.
-->
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${PLACEHOLDER_APP_ID}'>
    <updatecheck codebase='${packageInfo.absoluteUrl}' version='${version}' />
  </app>
</gupdate>
`;

  fs.writeFileSync(path.join(SITE_DIR, 'update.xml'), xml);
}

/* ------------------------------------------------------------------ site dist */

/**
 * Copy site/ into dist/ and stamp the version into index.html.
 * Substitutions are regexes over already-substituted values, so rebuilding
 * never drifts: run it twice and the output is identical.
 */
function writeDist(version, packageInfo) {
  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });

  fs.cpSync(SITE_DIR, DIST_DIR, { recursive: true });

  const indexPath = path.join(DIST_DIR, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');

  html = html
    .replace(/href="downloads\/freebuff-adblock-[\d.]+\.zip"/g, `href="${packageInfo.relativePath}"`)
    .replace(/(<span data-version>)[^<]*(<\/span>)/g, `$1${version}$2`)
    .replace(/(<code data-download-path>)[^<]*(<\/code>)/g, `$1/${packageInfo.relativePath}$2`);

  fs.writeFileSync(indexPath, html);

  // Keep the source copy in sync too, so site/ is always directly serveable.
  const sourceIndex = path.join(SITE_DIR, 'index.html');
  let sourceHtml = fs.readFileSync(sourceIndex, 'utf8');
  const stampedSource = sourceHtml
    .replace(/href="downloads\/freebuff-adblock-[\d.]+\.zip"/g, `href="${packageInfo.relativePath}"`)
    .replace(/(<span data-version>)[^<]*(<\/span>)/g, `$1${version}$2`)
    .replace(/(<code data-download-path>)[^<]*(<\/code>)/g, `$1/${packageInfo.relativePath}$2`);

  if (stampedSource !== sourceHtml) {
    fs.writeFileSync(sourceIndex, stampedSource);
    log('stamped version into site/index.html');
  }

  // Favicon for the install page, straight from the extension's own artwork.
  const favicon = path.join(ICONS_DIR, 'icon128.png');
  if (fs.existsSync(favicon)) fs.copyFileSync(favicon, path.join(DIST_DIR, 'favicon.png'));

  fs.writeFileSync(
    path.join(DIST_DIR, 'version.json'),
    `${JSON.stringify({ version, zip: packageInfo.relativePath, origin: SITE_ORIGIN }, null, 2)}\n`
  );
}

/* --------------------------------------------------------------------- build */

export function build() {
  const started = Date.now();

  const regenerated = ensureIcons(ICONS_DIR);
  if (regenerated) log('generated extension icons');

  const manifest = readManifest();
  const version = manifest.version;

  const packageInfo = packageExtension(version);
  writeUpdateXml(version, packageInfo);
  writeDist(version, packageInfo);

  log(`v${version} - ${packageInfo.fileCount} files, ${formatBytes(packageInfo.bytes)}`);
  log(`package  site/${packageInfo.relativePath}`);
  log('feed     site/update.xml');
  log(`output   dist/  (${Date.now() - started}ms)`);

  return { version, packageInfo };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) build();
