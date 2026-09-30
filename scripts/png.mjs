/**
 * Minimal PNG encoder + the Freebuff Ad Block icon.
 *
 * The icons have to exist for `chrome://extensions` to accept the extension,
 * but the workspace has no image tooling and no dependencies by design. So the
 * 16/32/48/128 icons are drawn procedurally here and written straight to disk.
 *
 * The glyph is the universal "prohibited" mark: a ring with a diagonal bar,
 * in the product's coral, on a dark rounded square. Rendered at 8x and box
 * filtered down so the small sizes stay crisp.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/* ----------------------------------------------------------------- crc32 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);

  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Encode a non-premultiplied RGBA buffer (size * size * 4) as a PNG. */
export function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc(size * (1 + stride));

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + stride);
    raw[rowStart] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ paint */

const SUPER = 8;

const BG = [13, 16, 23]; // #0d1017 - matches the install page background
const FG = [255, 90, 69]; // #ff5a45 - product accent

const CORNER_RADIUS = 0.22;
const RING_RADIUS = 0.29;
const STROKE = 0.13;

function distanceToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Draw the icon at an arbitrary size.
 * Returns a Buffer of size*size*4 RGBA bytes.
 */
export function renderIcon(size) {
  const ss = SUPER;
  const n = size * ss;
  const samples = ss * ss;

  const accCount = new Float64Array(n * n);
  const accR = new Float64Array(n * n);
  const accG = new Float64Array(n * n);
  const accB = new Float64Array(n * n);

  const half = 0.5;
  const inner = half - CORNER_RADIUS;

  // Slash runs corner to corner across the ring's centreline.
  const d = RING_RADIUS * Math.SQRT1_2;
  const ax = half + d;
  const ay = half - d;
  const bx = half - d;
  const by = half + d;

  for (let py = 0; py < n; py++) {
    const v = (py + 0.5) / n;
    const dy = Math.max(Math.abs(v - half) - inner, 0);

    for (let px = 0; px < n; px++) {
      const u = (px + 0.5) / n;
      const dx = Math.max(Math.abs(u - half) - inner, 0);

      // Inside the rounded square?
      if (dx * dx + dy * dy > CORNER_RADIUS * CORNER_RADIUS) continue;

      const off = py * n + px;
      accCount[off] += 1;

      const ringDist = Math.abs(Math.hypot(u - half, v - half) - RING_RADIUS);
      const slashDist = distanceToSegment(u, v, ax, ay, bx, by);
      const isGlyph = ringDist <= STROKE / 2 || slashDist <= STROKE / 2;

      const colour = isGlyph ? FG : BG;
      accR[off] += colour[0];
      accG[off] += colour[1];
      accB[off] += colour[2];
    }
  }

  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let count = 0;
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < ss; sy++) {
        const row = (y * ss + sy) * n + x * ss;
        for (let sx = 0; sx < ss; sx++) {
          const off = row + sx;
          count += accCount[off];
          r += accR[off];
          g += accG[off];
          b += accB[off];
        }
      }

      const o = (y * size + x) * 4;
      if (count === 0) continue;

      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = Math.round((count / samples) * 255);
    }
  }

  return out;
}

/* ------------------------------------------------------------------- icons */

export const ICON_SIZES = [16, 32, 48, 128];

/** Write icons/icon<size>.png for every size, only when missing or stale. */
export function ensureIcons(dir) {
  fs.mkdirSync(dir, { recursive: true });

  let regenerated = false;

  for (const size of ICON_SIZES) {
    const file = path.join(dir, `icon${size}.png`);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) continue;

    fs.writeFileSync(file, encodePng(size, renderIcon(size)));
    regenerated = true;
  }

  return regenerated;
}
