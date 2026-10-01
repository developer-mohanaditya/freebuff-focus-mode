/**
 * Store marketing images.
 *
 *   npm run assets
 *
 * Writes `site/store-assets/promo-440x280.png` (Chrome Web Store + Edge small
 * promo tile) and `site/store-assets/marquee-1400x560.png` (Chrome marquee).
 *
 * Both are 24-bit RGB, no alpha, because the stores reject transparency in
 * these - `encodePngRgb` in png.mjs is what guarantees the absence rather than
 * hoping every pixel happens to be opaque.
 *
 * Drawn procedurally, like the icons: the workspace has no image tooling, no
 * fonts and no dependencies, so the type is a small geometric caps face defined
 * below. Everything is rendered at 4x and box-filtered down, which is where the
 * anti-aliasing comes from.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePngRgb } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'site', 'store-assets');

/* ------------------------------------------------------------------ palette */

/** Same tokens as site/styles.css, so the tiles match the product. */
const BG = [11, 13, 18]; // --bg
const ACCENT = [255, 90, 69]; // --accent
const AMBER = [255, 176, 32]; // --accent-2
const TEXT = [233, 237, 246]; // --text
const MUTED = [150, 160, 181]; // --muted

/* ----------------------------------------------------------------- geometry */

const deg = (d) => (d * Math.PI) / 180;

const seg = (x1, y1, x2, y2) => [
  [x1, y1],
  [x2, y2],
];

/** Circular arc, counter-clockwise from a0 to a1 (degrees). */
function arc(cx, cy, r, a0, a1, steps = 22) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const a = deg(a0 + ((a1 - a0) * i) / steps);
    points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return points;
}

/** Elliptical arc - what makes 'O' and 'D' narrower than they are tall. */
function ell(cx, cy, rx, ry, a0, a1, steps = 34) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const a = deg(a0 + ((a1 - a0) * i) / steps);
    points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return points;
}

/** Fuse several polylines into one continuous stroke. */
const join = (...parts) => parts.reduce((acc, part) => acc.concat(part), []);

/* --------------------------------------------------------------------- type */

/**
 * A geometric caps face on a 1.0 em cap height, baseline at y = 0.
 * `w` is the advance width; `s` is a list of polylines.
 *
 * Uppercase only, plus the punctuation the copy actually needs. Asking for
 * anything else throws rather than silently dropping a character into a store
 * listing.
 */
const GLYPHS = {
  ' ': { w: 0.4, s: [] },

  A: { w: 0.68, s: [[[0, 0], [0.34, 1], [0.68, 0]], [[0.113, 0.34], [0.567, 0.34]]] },
  B: {
    w: 0.64,
    s: [
      seg(0, 0, 0, 1),
      join(seg(0, 1, 0.29, 1), arc(0.29, 0.75, 0.25, 90, -90)),
      seg(0, 0.5, 0.29, 0.5),
      join(seg(0, 0, 0.29, 0), arc(0.29, 0.25, 0.25, -90, 90)),
    ],
  },
  C: { w: 0.68, s: [arc(0.34, 0.5, 0.34, 52, 308)] },
  D: {
    w: 0.7,
    s: [join(seg(0, 0, 0, 1), seg(0, 1, 0.28, 1), ell(0.28, 0.5, 0.32, 0.5, 90, -90), [[0, 0]])],
  },
  E: { w: 0.62, s: [seg(0, 0, 0, 1), seg(0, 1, 0.58, 1), seg(0, 0.5, 0.48, 0.5), seg(0, 0, 0.58, 0)] },
  F: { w: 0.6, s: [seg(0, 0, 0, 1), seg(0, 1, 0.58, 1), seg(0, 0.5, 0.48, 0.5)] },
  G: { w: 0.72, s: [join(arc(0.36, 0.5, 0.36, 52, 350), [[0.44, 0.44]])] },
  H: { w: 0.68, s: [seg(0, 0, 0, 1), seg(0.68, 0, 0.68, 1), seg(0, 0.52, 0.68, 0.52)] },
  I: { w: 0.18, s: [seg(0.09, 0, 0.09, 1)] },
  J: { w: 0.56, s: [join(seg(0.52, 1, 0.52, 0.26), arc(0.28, 0.26, 0.24, 0, -180))] },
  K: { w: 0.66, s: [seg(0, 0, 0, 1), seg(0.62, 1, 0.1, 0.42), seg(0.26, 0.56, 0.66, 0)] },
  L: { w: 0.58, s: [seg(0, 0, 0, 1), seg(0, 0, 0.56, 0)] },
  M: { w: 0.98, s: [seg(0, 0, 0, 1), seg(0, 1, 0.49, 0.28), seg(0.49, 0.28, 0.98, 1), seg(0.98, 1, 0.98, 0)] },
  N: { w: 0.7, s: [seg(0, 0, 0, 1), seg(0, 1, 0.7, 0), seg(0.7, 0, 0.7, 1)] },
  O: { w: 0.74, s: [ell(0.37, 0.5, 0.37, 0.5, 0, 360)] },
  P: { w: 0.66, s: [seg(0, 0, 0, 1), join(seg(0, 1, 0.29, 1), arc(0.29, 0.75, 0.25, 90, -90))] },
  Q: { w: 0.74, s: [ell(0.37, 0.5, 0.37, 0.5, 0, 360), seg(0.44, 0.22, 0.72, -0.06)] },
  R: {
    w: 0.7,
    s: [
      seg(0, 0, 0, 1),
      join(seg(0, 1, 0.29, 1), arc(0.29, 0.75, 0.25, 90, -90)),
      seg(0.3, 0.5, 0.66, 0),
    ],
  },
  S: { w: 0.66, s: [join(arc(0.33, 0.75, 0.25, 20, 250), arc(0.33, 0.25, 0.25, 110, -180))] },
  T: { w: 0.64, s: [seg(0, 1, 0.64, 1), seg(0.32, 1, 0.32, 0)] },
  U: {
    w: 0.68,
    s: [join(seg(0, 1, 0, 0.34), arc(0.34, 0.34, 0.34, 180, 360), seg(0.68, 0.34, 0.68, 1))],
  },
  V: { w: 0.7, s: [[[0, 1], [0.35, 0], [0.7, 1]]] },
  W: { w: 1.04, s: [[[0, 1], [0.23, 0], [0.52, 0.7], [0.81, 0], [1.04, 1]]] },
  X: { w: 0.68, s: [seg(0, 0, 0.68, 1), seg(0, 1, 0.68, 0)] },
  Y: { w: 0.68, s: [seg(0, 1, 0.34, 0.52), seg(0.68, 1, 0.34, 0.52), seg(0.34, 0.52, 0.34, 0)] },
  Z: { w: 0.66, s: [seg(0, 1, 0.66, 1), seg(0.66, 1, 0, 0), seg(0, 0, 0.66, 0)] },

  '.': { w: 0.26, s: [seg(0.13, 0, 0.13, 0.06)] },
  ',': { w: 0.26, s: [seg(0.13, 0.06, 0.06, -0.12)] },
  '\u00b7': { w: 0.26, s: [seg(0.13, 0.36, 0.13, 0.42)] },
  '-': { w: 0.44, s: [seg(0.09, 0.42, 0.35, 0.42)] },
  ':': { w: 0.26, s: [seg(0.13, 0.1, 0.13, 0.16), seg(0.13, 0.5, 0.13, 0.56)] },
  '!': { w: 0.22, s: [seg(0.11, 0.24, 0.11, 1), seg(0.11, 0, 0.11, 0.06)] },
  '/': { w: 0.54, s: [seg(0.04, -0.06, 0.5, 1.06)] },
  '+': { w: 0.54, s: [seg(0.09, 0.45, 0.45, 0.45), seg(0.27, 0.27, 0.27, 0.63)] },
};

const STROKE_WEIGHT = 0.085; // em

/* ------------------------------------------------------------------- canvas */

const SS = 4; // supersampling factor

export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.W = width * SS;
    this.H = height * SS;
    this.data = new Uint8Array(this.W * this.H * 3);
    this.paint(0, 0, width, height, BG);
  }

  blend(px, py, colour, alpha) {
    if (alpha <= 0) return;
    if (px < 0 || py < 0 || px >= this.W || py >= this.H) return;

    const i = (py * this.W + px) * 3;
    const d = this.data;

    if (alpha >= 1) {
      d[i] = colour[0];
      d[i + 1] = colour[1];
      d[i + 2] = colour[2];
      return;
    }

    d[i] = Math.round(d[i] + (colour[0] - d[i]) * alpha);
    d[i + 1] = Math.round(d[i + 1] + (colour[1] - d[i + 1]) * alpha);
    d[i + 2] = Math.round(d[i + 2] + (colour[2] - d[i + 2]) * alpha);
  }

  /** Filled rectangle in design units. */
  paint(x, y, w, h, colour, alpha = 1) {
    const x0 = Math.max(0, Math.floor(x * SS));
    const y0 = Math.max(0, Math.floor(y * SS));
    const x1 = Math.min(this.W, Math.ceil((x + w) * SS));
    const y1 = Math.min(this.H, Math.ceil((y + h) * SS));

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) this.blend(px, py, colour, alpha);
    }
  }

  /** Soft radial wash - the same warm gradient the install page leans on. */
  glow(cx, cy, radius, colour, strength) {
    const x0 = Math.max(0, Math.floor((cx - radius) * SS));
    const y0 = Math.max(0, Math.floor((cy - radius) * SS));
    const x1 = Math.min(this.W, Math.ceil((cx + radius) * SS));
    const y1 = Math.min(this.H, Math.ceil((cy + radius) * SS));
    const r = radius * SS;

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const d = Math.hypot(px - cx * SS, py - cy * SS) / r;
        if (d >= 1) continue;
        this.blend(px, py, colour, strength * (1 - d) * (1 - d));
      }
    }
  }

  /** Stroke a polyline with round caps, in design units. */
  stroke(points, width, colour) {
    if (points.length < 2) return;

    const pts = points.map(([x, y]) => [x * SS, y * SS]);
    const half = (width * SS) / 2;
    const pad = half + 1;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    const x0 = Math.max(0, Math.floor(minX - pad));
    const y0 = Math.max(0, Math.floor(minY - pad));
    const x1 = Math.min(this.W, Math.ceil(maxX + pad));
    const y1 = Math.min(this.H, Math.ceil(maxY + pad));

    const segments = [];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const vx = bx - ax;
      const vy = by - ay;
      const lenSq = vx * vx + vy * vy;
      segments.push([ax, ay, vx, vy, lenSq === 0 ? 0 : 1 / lenSq]);
    }

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const sx = px + 0.5;
        const sy = py + 0.5;
        let nearest = Infinity;

        for (const [ax, ay, vx, vy, inv] of segments) {
          let t = ((sx - ax) * vx + (sy - ay) * vy) * inv;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const dx = sx - (ax + t * vx);
          const dy = sy - (ay + t * vy);
          const dist = dx * dx + dy * dy;
          if (dist < nearest) nearest = dist;
          if (nearest === 0) break;
        }

        if (nearest <= half * half) this.blend(px, py, colour, 1);
      }
    }
  }

  /** Advances, in design units, for a string at a given size. */
  measure(text, size, tracking = 0) {
    let width = 0;
    const chars = [...text.toUpperCase()];
    for (const ch of chars) {
      const glyph = this.glyph(ch);
      width += glyph.w * size + tracking * size;
    }
    return Math.max(0, width - tracking * size);
  }

  glyph(ch) {
    const glyph = GLYPHS[ch];
    if (!glyph) {
      throw new Error(
        `store-assets: no glyph for "${ch}" - the caps face has no digits or symbols beyond . , \u00b7 - : ! / +`
      );
    }
    return glyph;
  }

  /** Draw a line of text with the baseline at `baseline`. */
  text(text, x, baseline, size, colour, { tracking = 0, weight = STROKE_WEIGHT } = {}) {
    let cursor = x;

    for (const ch of [...text.toUpperCase()]) {
      const glyph = this.glyph(ch);

      for (const polyline of glyph.s) {
        this.stroke(
          polyline.map(([gx, gy]) => [cursor + gx * size, baseline - gy * size]),
          size * weight,
          colour
        );
      }

      cursor += glyph.w * size + tracking * size;
    }
  }

  /** The product mark: the prohibited ring, same geometry as the icons. */
  mark(x, y, size, colour) {
    const c = size / 2;
    const ring = size * 0.29;
    const d = ring * Math.SQRT1_2;

    this.stroke(
      arc(0, 0, ring, 0, 360, 48).map(([px, py]) => [x + c + px, y + c + py]),
      size * 0.13,
      colour
    );

    this.stroke(
      [
        [x + c + d, y + c - d],
        [x + c - d, y + c + d],
      ],
      size * 0.13,
      colour
    );
  }

  /** Box-filter the supersampled buffer down to 24-bit RGB. */
  toRgb() {
    const out = Buffer.alloc(this.width * this.height * 3);
    const samples = SS * SS;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        let r = 0;
        let g = 0;
        let b = 0;

        for (let sy = 0; sy < SS; sy++) {
          const row = ((y * SS + sy) * this.W + x * SS) * 3;
          for (let sx = 0; sx < SS; sx++) {
            const i = row + sx * 3;
            r += this.data[i];
            g += this.data[i + 1];
            b += this.data[i + 2];
          }
        }

        const o = (y * this.width + x) * 3;
        out[o] = Math.round(r / samples);
        out[o + 1] = Math.round(g / samples);
        out[o + 2] = Math.round(b / samples);
      }
    }

    return out;
  }
}

/* --------------------------------------------------------------- the images */

const NAME = 'FREEBUFF AD BLOCK';

/** 440x280 - the small promo tile Chrome and Edge both ask for. */
function promo() {
  const canvas = new Canvas(440, 280);

  canvas.glow(78, 34, 330, ACCENT, 0.2);
  canvas.glow(410, 262, 260, AMBER, 0.1);

  // The mark is a ring inscribed in its box at 0.29, so it reads smaller than
  // the box: 96 here is a ~63px circle beside a 29px cap height.
  const markSize = 96;
  const titleSize = 29;
  const captionSize = 12.5;

  const markY = 50;
  canvas.mark((440 - markSize) / 2, markY, markSize, ACCENT);

  const titleBaseline = markY + markSize + 22 + titleSize;
  canvas.text(NAME, (440 - canvas.measure(NAME, titleSize, 0.04)) / 2, titleBaseline, titleSize, TEXT, {
    tracking: 0.04,
  });

  const caption = 'SITE-SCOPED \u00b7 NO TRACKING';
  const captionBaseline = titleBaseline + 24;
  canvas.text(
    caption,
    (440 - canvas.measure(caption, captionSize, 0.18)) / 2,
    captionBaseline,
    captionSize,
    MUTED,
    { tracking: 0.18 }
  );

  return canvas;
}

/** 1400x560 - the marquee Chrome shows above the listing. */
function marquee() {
  const canvas = new Canvas(1400, 560);

  canvas.glow(150, 10, 640, ACCENT, 0.18);
  canvas.glow(1260, 540, 540, AMBER, 0.1);

  const markSize = 168;
  const markX = 100;
  const markY = 196;
  const textX = markX + markSize + 60;

  const eyebrow = 'CHROME \u00b7 EDGE \u00b7 BRAVE \u00b7 FIREFOX';
  const eyebrowSize = 18;
  const titleSize = 84;
  const captionSize = 26;

  canvas.text(eyebrow, textX, 212, eyebrowSize, ACCENT, { tracking: 0.16 });
  canvas.text(NAME, textX, 318, titleSize, TEXT, { tracking: 0.02 });
  canvas.text('BLOCKS ADS ON FREEBUFF.COM', textX, 366, captionSize, MUTED, { tracking: 0.06 });

  canvas.mark(markX, markY, markSize, ACCENT);

  return canvas;
}

/* ------------------------------------------------------------------- output */

/**
 * ASCII downsample, so the artwork can be eyeballed without an image viewer.
 * Each cell averages the block it covers - point sampling drops thin strokes.
 */
function preview(canvas, columns = 110) {
  const rgb = canvas.toRgb();
  const rows = Math.round((columns * canvas.height) / canvas.width / 2);
  const ramp = ' .:-=+*#%@';
  let out = '';

  for (let ry = 0; ry < rows; ry++) {
    const y0 = Math.floor((ry * canvas.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((ry + 1) * canvas.height) / rows));

    for (let rx = 0; rx < columns; rx++) {
      const x0 = Math.floor((rx * canvas.width) / columns);
      const x1 = Math.max(x0 + 1, Math.floor(((rx + 1) * canvas.width) / columns));

      let total = 0;
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * canvas.width + x) * 3;
          total += (rgb[i] * 0.299 + rgb[i + 1] * 0.587 + rgb[i + 2] * 0.114) / 255;
          count += 1;
        }
      }

      const lum = count === 0 ? 0 : total / count;
      out += ramp[Math.min(ramp.length - 1, Math.floor(lum * ramp.length))];
    }

    out += '\n';
  }

  return out;
}

export function generateStoreAssets({ ascii = false } = {}) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const images = [
    ['promo-440x280.png', promo()],
    ['marquee-1400x560.png', marquee()],
  ];

  const written = [];

  for (const [fileName, canvas] of images) {
    const file = path.join(OUT_DIR, fileName);
    fs.writeFileSync(file, encodePngRgb(canvas.width, canvas.height, canvas.toRgb()));
    written.push({ fileName, width: canvas.width, height: canvas.height, bytes: fs.statSync(file).size });
    if (ascii) process.stdout.write(`\n${fileName}\n${preview(canvas)}\n`);
  }

  return written;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const written = generateStoreAssets({ ascii: process.argv.includes('--preview') });
  for (const image of written) {
    console.log(
      `[assets] site/store-assets/${image.fileName}  ${image.width}x${image.height}  ${(image.bytes / 1024).toFixed(1)} KB`
    );
  }
}
