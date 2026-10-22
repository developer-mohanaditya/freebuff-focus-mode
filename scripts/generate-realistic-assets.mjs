import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { encodePngRgb } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'site', 'store-assets');
const ICON_BASE64 = fs.readFileSync(path.join(ROOT, 'extension', 'icons', 'icon128.png')).toString('base64');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function ensureRgb24(pngBuf) {
  const width = pngBuf.readUInt32BE(16);
  const height = pngBuf.readUInt32BE(20);
  const colorType = pngBuf[25];
  if (colorType === 2) return pngBuf;

  let pos = 8;
  const idats = [];
  while (pos < pngBuf.length) {
    const len = pngBuf.readUInt32BE(pos);
    const type = pngBuf.subarray(pos + 4, pos + 8).toString('ascii');
    if (type === 'IDAT') {
      idats.push(pngBuf.subarray(pos + 8, pos + 8 + len));
    }
    pos += 12 + len;
  }
  const decompressed = zlib.inflateSync(Buffer.concat(idats));

  if (colorType === 6) { // RGBA
    const rgb = Buffer.alloc(width * height * 3);
    const srcStride = 1 + width * 4;
    for (let y = 0; y < height; y++) {
      const srcRow = y * srcStride + 1;
      const dstRow = y * width * 3;
      for (let x = 0; x < width; x++) {
        rgb[dstRow + x * 3] = decompressed[srcRow + x * 4];
        rgb[dstRow + x * 3 + 1] = decompressed[srcRow + x * 4 + 1];
        rgb[dstRow + x * 3 + 2] = decompressed[srcRow + x * 4 + 2];
      }
    }
    return encodePngRgb(width, height, rgb);
  }
  return pngBuf;
}

export function captureHtml(html, width, height, outFile) {
  const tmpHtml = path.join('/tmp', `asset_${Date.now()}_${Math.random().toString(36).slice(2)}.html`);
  const tmpPng = path.join('/tmp', `asset_${Date.now()}_${Math.random().toString(36).slice(2)}.png`);

  fs.writeFileSync(tmpHtml, html, 'utf8');

  execFileSync(CHROME_PATH, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--screenshot=${tmpPng}`,
    `file://${tmpHtml}`,
  ], { stdio: 'pipe' });

  const rawPng = fs.readFileSync(tmpPng);
  const rgbPng = ensureRgb24(rawPng);
  fs.writeFileSync(outFile, rgbPng);

  try { fs.unlinkSync(tmpHtml); } catch {}
  try { fs.unlinkSync(tmpPng); } catch {}

  console.log(`[assets] Rendered ${path.basename(outFile)} (${width}x${height}, type 2)`);
}

console.log('Renderer module ready');
