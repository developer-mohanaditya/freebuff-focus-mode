/**
 * Store marketing images.
 *
 *   npm run assets
 *
 * Writes `site/store-assets/promo-440x280.png` (Chrome Web Store + Edge small
 * promo tile) and `site/store-assets/marquee-1400x560.png` (Chrome marquee),
 * plus the four 1280x800 listing screenshots.
 *
 * All of them are 24-bit RGB, no alpha, because the stores reject transparency
 * in these - `encodePngRgb` in png.mjs is what guarantees the absence rather
 * than hoping every pixel happens to be opaque.
 *
 * Drawn procedurally, like the icons: the workspace has no image tooling, no
 * fonts and no dependencies, so the type is a small geometric caps face defined
 * below. Everything is rendered at 4x and box-filtered down, which is where the
 * anti-aliasing comes from.
 *
 * The screenshots are composed from the extension's real interface (the same
 * popup rows, the same three detection tiers, the same "emptied in place"
 * behaviour) rather than captured from a live browser, which this workspace
 * does not have. They are illustrations of the product, and the listing text
 * says so.
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
 * Uppercase, digits, and the punctuation the copy actually needs. Asking for
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

  // Digits, on the same 1.0 em cap height. Curves for the round counters and
  // straight strokes where a geometric face would use them, so a count in the
  // popup screenshot sits beside the headings rather than fighting them.
  '0': { w: 0.64, s: [ell(0.32, 0.5, 0.32, 0.5, 0, 360)] },
  '1': { w: 0.44, s: [seg(0.04, 0.76, 0.24, 1), seg(0.24, 1, 0.24, 0)] },
  '2': {
    w: 0.62,
    s: [join(arc(0.31, 0.76, 0.27, 178, -34), seg(0.534, 0.61, 0, 0), seg(0, 0, 0.62, 0))],
  },
  '3': {
    w: 0.62,
    s: [join(arc(0.28, 0.76, 0.26, 160, -90), arc(0.28, 0.26, 0.26, 90, -168))],
  },
  '4': { w: 0.68, s: [[[0.5, 1], [0.5, 0], [0, 0.64], [0.68, 0.64]]] },
  '5': {
    w: 0.62,
    s: [join(seg(0.58, 1, 0.09, 1), seg(0.09, 1, 0.037, 0.41), arc(0.3, 0.3, 0.28, 160, -160))],
  },
  '6': {
    w: 0.62,
    s: [join(seg(0.52, 1, 0.26, 1), seg(0.26, 1, 0.04, 0.3), arc(0.32, 0.3, 0.28, 180, 540))],
  },
  '7': { w: 0.62, s: [seg(0, 1, 0.62, 1), seg(0.62, 1, 0.22, 0)] },
  '8': { w: 0.62, s: [ell(0.31, 0.76, 0.23, 0.24, 0, 360), ell(0.31, 0.27, 0.29, 0.27, 0, 360)] },
  '9': {
    w: 0.62,
    s: [join(arc(0.3, 0.7, 0.28, 0, 360), seg(0.58, 0.7, 0.58, 0.14), seg(0.58, 0.14, 0.36, 0))],
  },

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

/** Is a supersampled pixel centre inside a rounded rectangle? */
function insideRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px >= x + w || py >= y + h) return false;
  if (r <= 0) return true;

  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

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

  /** Filled rounded rectangle in design units - the store art's whole surface. */
  panel(x, y, w, h, r, colour, alpha = 1) {
    const x0 = Math.max(0, Math.floor(x * SS));
    const y0 = Math.max(0, Math.floor(y * SS));
    const x1 = Math.min(this.W, Math.ceil((x + w) * SS));
    const y1 = Math.min(this.H, Math.ceil((y + h) * SS));

    const rx = x * SS;
    const ry = y * SS;
    const rw = w * SS;
    const rh = h * SS;
    const rr = Math.min(r * SS, Math.min(rw, rh) / 2);

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        if (insideRect(px + 0.5, py + 0.5, rx, ry, rw, rh, rr)) this.blend(px, py, colour, alpha);
      }
    }
  }

  /** The hairline around a `panel` of the same geometry. */
  frame(x, y, w, h, r, width, colour, alpha = 1) {
    const x0 = Math.max(0, Math.floor(x * SS));
    const y0 = Math.max(0, Math.floor(y * SS));
    const x1 = Math.min(this.W, Math.ceil((x + w) * SS));
    const y1 = Math.min(this.H, Math.ceil((y + h) * SS));

    const rx = x * SS;
    const ry = y * SS;
    const rw = w * SS;
    const rh = h * SS;
    const rr = Math.min(r * SS, Math.min(rw, rh) / 2);
    const iw = width * SS;

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const sx = px + 0.5;
        const sy = py + 0.5;
        if (!insideRect(sx, sy, rx, ry, rw, rh, rr)) continue;
        if (insideRect(sx, sy, rx + iw, ry + iw, rw - iw * 2, rh - iw * 2, Math.max(0, rr - iw))) {
          continue;
        }
        this.blend(px, py, colour, alpha);
      }
    }
  }

  /** Dashed rule - the outline around an ad slot that never loaded. */
  dash(x1, y1, x2, y2, dash, gap, width, colour) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length === 0) return;

    const ux = (x2 - x1) / length;
    const uy = (y2 - y1) / length;

    for (let d = 0; d < length; d += dash + gap) {
      const e = Math.min(d + dash, length);
      this.stroke(
        [
          [x1 + ux * d, y1 + uy * d],
          [x1 + ux * e, y1 + uy * e],
        ],
        width,
        colour
      );
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
        `store-assets: no glyph for "${ch}" - the face covers A-Z, 0-9 and . , \u00b7 - : ! / + only`
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

/* ------------------------------------------------------------- screenshots */

/**
 * The four listing screenshots, at the 1280x800 Chrome and Edge both accept.
 *
 * They are composed from the extension's own interface - the popup's real
 * rows, the three real detection tiers, the real "emptied in place" rule for
 * the toolbar slot - because the stores want the product on screen and this
 * workspace has no browser to capture one in. Everything is drawn from the
 * same palette, so nothing here can drift from the product: change the copy
 * and `npm run assets` redraws all of it.
 */

const SHOT_W = 1280;
const SHOT_H = 800;

const MARGIN = 72;
const COLUMN = SHOT_W - MARGIN * 2;

const SURFACE = [19, 23, 32];
const SURFACE_UP = [27, 32, 43];
const HAIRLINE = [43, 49, 64];

/** Small copy carries a heavier stroke: 0.085 em at 11px is under a pixel. */
const small = (canvas, text, x, baseline, size, colour, tracking = 0.06) =>
  canvas.text(text, x, baseline, size, colour, { tracking, weight: 0.115 });

/** A skeleton line of copy. The mocks are drawn, so they cannot show text. */
const bar = (canvas, x, y, w, h) => canvas.panel(x, y, w, h, h / 2, MUTED, 0.3);

/** The heading band every screenshot shares. Returns where the body may start. */
function shotHead(canvas, { eyebrow, title, standfirst, titleSize = 50 }) {
  canvas.text(eyebrow, MARGIN, 92, 15, ACCENT, { tracking: 0.18 });

  const titleBaseline = 106 + titleSize;
  canvas.text(title, MARGIN, titleBaseline, titleSize, TEXT, { tracking: 0.01 });

  const brand = 'FREEBUFF AD BLOCK';
  const brandSize = 13;
  const brandWidth = canvas.measure(brand, brandSize, 0.14);
  canvas.mark(SHOT_W - MARGIN - brandWidth - 32, 60, 32, ACCENT);
  canvas.text(brand, SHOT_W - MARGIN - brandWidth, 86, brandSize, MUTED, { tracking: 0.14 });

  let bottom = titleBaseline;
  if (standfirst) {
    bottom += 32;
    canvas.text(standfirst, MARGIN, bottom, 16, MUTED, { tracking: 0.04 });
  }

  canvas.dash(MARGIN, bottom + 28, SHOT_W - MARGIN, bottom + 28, 6, 9, 1.2, HAIRLINE);
  return bottom + 62;
}

/** A browser window: three wells, a URL pill, and a content well. */
function windowFrame(canvas, x, y, w, h, url) {
  const barHeight = 46;
  const corner = 16;

  canvas.panel(x, y, w, h, corner, SURFACE);
  canvas.panel(x, y, w, barHeight, corner, SURFACE_UP);
  canvas.panel(x, y + barHeight - corner, w, corner, 0, SURFACE_UP);
  canvas.frame(x, y, w, h, corner, 1.2, HAIRLINE);

  for (let i = 0; i < 3; i++) canvas.panel(x + 22 + i * 16, y + 20, 7, 7, 3.5, HAIRLINE);

  const pillWidth = 300;
  const pillX = x + (w - pillWidth) / 2;
  canvas.panel(pillX, y + 11, pillWidth, 24, 12, BG);
  small(canvas, url, pillX + 16, y + 28, 11, MUTED, 0.1);

  canvas.panel(x + 1, y + barHeight, w - 2, 1, 0, HAIRLINE);
  return { x: x + 24, y: y + barHeight + 22, w: w - 48 };
}

/** freebuff.com mid-build, as the extension leaves it. */
function chatCard(canvas, x, y, w, h) {
  const box = windowFrame(canvas, x, y, w, h, 'FREEBUFF.COM');
  const { x: left, y: top, w: inner } = box;

  // The preview toolbar. Its slot is emptied where it stands, so the controls
  // beside it never slide left - the one fix that is not a removal.
  canvas.panel(left, top, inner, 44, 10, SURFACE_UP);
  bar(canvas, left + 16, top + 18, 110, 8);
  bar(canvas, left + 142, top + 18, 64, 8);
  bar(canvas, left + 220, top + 18, 40, 8);

  const chipX = left + inner - 74;
  canvas.panel(chipX, top + 12, 58, 20, 10, ACCENT, 0.16);
  canvas.frame(chipX, top + 12, 58, 20, 10, 1, ACCENT, 0.6);
  small(canvas, 'AD', chipX + 17, top + 27, 11, ACCENT, 0.1);
  canvas.stroke([
    [chipX + 6, top + 14],
    [chipX + 52, top + 30],
  ], 1.8, ACCENT);

  small(canvas, 'AN AD SLOT IN THE TOOLBAR, EMPTIED IN PLACE', left, top + 72, 11, MUTED);

  // A turn: the question, then the reply with a slot the network injected.
  const askY = top + 100;
  canvas.panel(x + w - 24 - 330, askY, 330, 46, 12, SURFACE_UP);
  bar(canvas, x + w - 24 - 308, askY + 14, 200, 7);
  bar(canvas, x + w - 24 - 308, askY + 27, 262, 7);

  const replyY = askY + 70;
  canvas.panel(left, replyY, inner, 196, 12, SURFACE_UP);
  bar(canvas, left + 18, replyY + 20, 300, 7);
  bar(canvas, left + 18, replyY + 34, 238, 7);

  const slotY = replyY + 58;
  const slotRight = left + inner - 18;
  canvas.dash(left + 18, slotY, slotRight, slotY, 7, 7, 1.2, ACCENT);
  canvas.dash(left + 18, slotY + 92, slotRight, slotY + 92, 7, 7, 1.2, ACCENT);
  canvas.dash(left + 18, slotY, left + 18, slotY + 92, 7, 7, 1.2, ACCENT);
  canvas.dash(slotRight, slotY, slotRight, slotY + 92, 7, 7, 1.2, ACCENT);
  small(canvas, 'AD SLOT - BLOCKED BEFORE IT LOADED', left + 40, slotY + 52, 13, ACCENT, 0.08);

  bar(canvas, left + 18, replyY + 168, 180, 7);

  return box;
}

/** A raised tile with a label and two lines of copy. */
function featureCard(canvas, x, y, w, h, label, lines) {
  canvas.panel(x, y, w, h, 14, SURFACE);
  canvas.frame(x, y, w, h, 14, 1.2, HAIRLINE);
  canvas.panel(x + 22, y + 26, 22, 3, 1.5, ACCENT);
  canvas.text(label, x + 22, y + 62, 15, TEXT, { tracking: 0.12 });

  let baseline = y + 92;
  for (const line of lines) {
    small(canvas, line, x + 22, baseline, 13, MUTED, 0.04);
    baseline += 21;
  }
}

/** A note beside a mock, tied to it by a short accent rule. */
function callout(canvas, x, y, w, label, lines) {
  canvas.panel(x, y + 2, 3, 36, 1.5, ACCENT);
  canvas.text(label, x + 24, y + 26, 17, TEXT, { tracking: 0.08 });

  let baseline = y + 56;
  for (const line of lines) {
    small(canvas, line, x + 24, baseline, 13, MUTED, 0.04);
    baseline += 21;
  }
}

/** 1. The product doing its job, with the three tiers beside it. */
function shotChat() {
  const canvas = new Canvas(SHOT_W, SHOT_H);
  canvas.glow(120, -60, 620, ACCENT, 0.16);
  canvas.glow(1190, 830, 520, AMBER, 0.09);

  shotHead(canvas, {
    eyebrow: 'CHROME \u00b7 EDGE \u00b7 BRAVE \u00b7 FIREFOX',
    title: 'THE ADS STOP.',
    standfirst: 'THE BUILD KEEPS STREAMING - SITE-SCOPED TO FREEBUFF.COM',
  });

  chatCard(canvas, MARGIN, 250, 728, 486);

  featureCard(canvas, 824, 250, 384, 148, 'NETWORK', [
    'AD REQUESTS STOPPED BEFORE',
    'THEY LEAVE THE TAB',
  ]);
  featureCard(canvas, 824, 418, 384, 148, 'IN-PRODUCT', [
    'THE AD CARDS THE PAGE BUILDS',
    'ITSELF WHILE IT THINKS',
  ]);
  featureCard(canvas, 824, 586, 384, 148, 'HAND-PICKED', [
    'HIDE ANYTHING ONCE, GONE',
    'ON EVERY VISIT',
  ]);

  return canvas;
}

/** 2. The popup, annotated - the parts a reviewer will ask about. */
function shotPopup() {
  const canvas = new Canvas(SHOT_W, SHOT_H);
  canvas.glow(300, -40, 640, ACCENT, 0.15);
  canvas.glow(1240, 820, 520, AMBER, 0.09);

  shotHead(canvas, {
    eyebrow: 'THE POPUP',
    title: 'ONE SWITCH. ONE SITE.',
    standfirst: 'THE SAME PANEL IN CHROME, EDGE, BRAVE AND FIREFOX',
    titleSize: 46,
  });

  const x = 140;
  const w = 420;
  const y = 250;
  const h = 486;

  canvas.panel(x, y, w, h, 18, SURFACE);
  canvas.frame(x, y, w, h, 18, 1.2, HAIRLINE);

  canvas.mark(x + 28, y + 28, 36, ACCENT);
  canvas.text('FREEBUFF AD BLOCK', x + 76, y + 50, 16, TEXT, { tracking: 0.04 });
  small(canvas, 'FREEBUFF.COM ONLY', x + 76, y + 70, 11, MUTED, 0.1);

  canvas.panel(x + 24, y + 96, w - 48, 1, 0, HAIRLINE);

  canvas.text('BLOCK ADS', x + 24, y + 142, 16, TEXT, { tracking: 0.04 });
  small(canvas, 'ON', x + 24, y + 162, 11, MUTED, 0.1);

  const toggleX = x + w - 24 - 58;
  canvas.panel(toggleX, y + 122, 58, 32, 16, ACCENT);
  canvas.panel(toggleX + 30, y + 125, 26, 26, 13, TEXT);

  canvas.text('12', x + 24, y + 224, 46, TEXT, { tracking: 0.02 });
  small(canvas, 'AD ELEMENTS HIDDEN ON THIS TAB', x + 24, y + 248, 11, MUTED, 0.08);

  const buttonLabel = 'HIDE AN ELEMENT ON THE PAGE';
  canvas.panel(x + 24, y + 286, w - 48, 48, 12, ACCENT, 0.14);
  canvas.frame(x + 24, y + 286, w - 48, 48, 12, 1.2, ACCENT, 0.55);
  canvas.text(
    buttonLabel,
    x + 24 + (w - 48 - canvas.measure(buttonLabel, 13, 0.06)) / 2,
    y + 316,
    13,
    ACCENT,
    { tracking: 0.06, weight: 0.115 }
  );
  small(canvas, '2 CUSTOM RULES', x + 24, y + 356, 11, MUTED, 0.08);

  canvas.panel(x + 24, y + 380, w - 48, 1, 0, HAIRLINE);
  small(canvas, 'ACTIVE ON THIS TAB', x + 24, y + 408, 11, ACCENT, 0.08);
  small(canvas, 'INSTALL PAGE + DOCS', x + 24, y + 428, 11, MUTED, 0.08);

  callout(canvas, 640, 264, 568, 'BLOCK ADS', [
    'A PER-SITE SWITCH. OFF LEAVES THE',
    'PAGE EXACTLY AS IT WAS.',
  ]);
  callout(canvas, 640, 396, 568, 'LIVE COUNT', [
    'ELEMENTS HIDDEN ON THIS TAB,',
    'COUNTED IN THE BACKGROUND WORKER.',
  ]);
  callout(canvas, 640, 528, 568, 'HIDE AN ELEMENT', [
    'CLICK THE BUTTON, THEN THE AD.',
    'SAVED TO SYNC AND REAPPLIED',
    'ON EVERY FUTURE VISIT.',
  ]);

  return canvas;
}

/** 3. Why there are three tiers rather than one. */
function shotLayers() {
  const canvas = new Canvas(SHOT_W, SHOT_H);
  canvas.glow(140, -40, 620, ACCENT, 0.15);
  canvas.glow(1200, 820, 500, AMBER, 0.08);

  shotHead(canvas, {
    eyebrow: 'HOW IT WORKS',
    title: 'THREE LAYERS, ONE PAGE.',
    standfirst: 'NONE OF THEM IS ENOUGH ON ITS OWN',
    titleSize: 46,
  });

  const cards = [
    ['01', 'NETWORK', 'RULES.JSON', ['STOPS THE REQUEST', 'BEFORE IT LEAVES', 'THE TAB.']],
    ['02', 'DOM HOOKS', 'CONTENT.JS', ['REMOVES AD-SHAPED', 'MARKUP THE PAGE', 'BUILDS MID-BUILD.']],
    ['03', 'PROMOS + PICKER', 'CONTENT.JS', ['FINDS FIRST-PARTY AD', 'CARDS, AND KEEPS', 'WHAT YOU PICK BY HAND.']],
  ];

  const cardW = Math.floor((COLUMN - 40) / 3);

  cards.forEach(([number, label, file, lines], index) => {
    const cx = MARGIN + index * (cardW + 20);
    const cy = 250;

    canvas.panel(cx, cy, cardW, 300, 14, SURFACE);
    canvas.frame(cx, cy, cardW, 300, 14, 1.2, HAIRLINE);

    canvas.text(number, cx + 24, cy + 66, 38, ACCENT, { tracking: 0.02 });
    canvas.text(label, cx + 24, cy + 108, 19, TEXT, { tracking: 0.06 });

    const chipW = canvas.measure(file, 12, 0.1) + 32;
    canvas.panel(cx + 24, cy + 130, chipW, 28, 8, SURFACE_UP);
    small(canvas, file, cx + 40, cy + 149, 12, MUTED, 0.1);

    let baseline = cy + 202;
    for (const line of lines) {
      small(canvas, line, cx + 24, baseline, 13, MUTED, 0.04);
      baseline += 22;
    }
  });

  canvas.panel(MARGIN, 596, COLUMN, 116, 14, SURFACE);
  canvas.frame(MARGIN, 596, COLUMN, 116, 14, 1.2, HAIRLINE);
  canvas.panel(MARGIN + 28, 622, 22, 3, 1.5, ACCENT);
  canvas.text(
    'A PRIORITY-100 ALLOW KEEPS YOUR BUILD AND THINKING STREAM UNTOUCHED',
    MARGIN + 28,
    672,
    17,
    TEXT,
    { tracking: 0.03 }
  );
  small(
    canvas,
    'EVERY BLOCK RULE SITS AT PRIORITY 1, SO NOTHING CAN WIN AGAINST IT',
    MARGIN + 28,
    698,
    13,
    MUTED,
    0.04
  );

  return canvas;
}

/** 4. The one site it asks for, and the things it never reads. */
function shotScope() {
  const canvas = new Canvas(SHOT_W, SHOT_H);
  canvas.glow(1250, -60, 600, ACCENT, 0.15);
  canvas.glow(80, 820, 520, AMBER, 0.08);

  shotHead(canvas, {
    eyebrow: 'SCOPE',
    title: 'IT TOUCHES ONE SITE.',
    standfirst: 'NO ACCOUNTS \u00b7 NO TELEMETRY \u00b7 NO REMOTE CODE',
    titleSize: 46,
  });

  canvas.panel(MARGIN, 250, 556, 296, 14, SURFACE);
  canvas.frame(MARGIN, 250, 556, 296, 14, 1.2, HAIRLINE);
  canvas.text('HOST PERMISSIONS', MARGIN + 24, 292, 14, ACCENT, { tracking: 0.16 });

  const host = 'FREEBUFF.COM';
  const hostW = canvas.measure(host, 30, 0.04) + 48;
  canvas.panel(MARGIN + 24, 320, hostW, 62, 14, SURFACE_UP);
  canvas.frame(MARGIN + 24, 320, hostW, 62, 14, 1.2, ACCENT, 0.45);
  canvas.text(host, MARGIN + 48, 362, 30, TEXT, { tracking: 0.04 });

  small(canvas, 'THE ONLY ORIGIN IT ASKS FOR.', MARGIN + 24, 420, 13, MUTED, 0.04);
  small(canvas, 'NOT ALL URLS, NOT EVERY SITE.', MARGIN + 24, 444, 13, MUTED, 0.04);
  small(canvas, 'A CONTENT SCRIPT HAS TO BE ABLE TO', MARGIN + 24, 468, 13, MUTED, 0.04);
  small(canvas, 'READ THE PAGE IT IS CLEANING UP.', MARGIN + 24, 492, 13, MUTED, 0.04);

  const rightX = MARGIN + 580;
  canvas.panel(rightX, 250, 556, 296, 14, SURFACE);
  canvas.frame(rightX, 250, 556, 296, 14, 1.2, HAIRLINE);
  canvas.text('NEVER READS', rightX + 24, 292, 14, TEXT, { tracking: 0.16 });

  const rows = ['OTHER SITES AND TABS', 'YOUR BROWSING HISTORY', 'CREDENTIALS AND FORMS'];
  rows.forEach((row, index) => {
    const ry = 322 + index * 52;
    canvas.mark(rightX + 26, ry, 26, ACCENT);
    canvas.text(row, rightX + 70, ry + 21, 15, MUTED, { tracking: 0.05 });
  });

  small(canvas, 'IT REQUESTS NO DATA AND SENDS NONE.', rightX + 24, 508, 13, MUTED, 0.04);

  canvas.panel(MARGIN, 586, COLUMN, 116, 14, SURFACE);
  canvas.frame(MARGIN, 586, COLUMN, 116, 14, 1.2, HAIRLINE);

  const facts = [
    ['NO ACCOUNTS', 'NOTHING TO SIGN INTO'],
    ['NO TELEMETRY', 'NO ANALYTICS, NO PINGS HOME'],
    ['NO REMOTE CODE', 'EVERYTHING SHIPS IN THE PACKAGE'],
  ];

  facts.forEach(([value, caption], index) => {
    const fx = MARGIN + 28 + index * 360;
    canvas.text(value, fx, 636, 20, TEXT, { tracking: 0.05 });
    small(canvas, caption, fx, 662, 13, MUTED, 0.04);
    if (index > 0) canvas.panel(MARGIN + index * 360 - 20, 610, 1, 68, 0, HAIRLINE);
  });

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
    ['screenshot-1-chat-1280x800.png', shotChat()],
    ['screenshot-2-popup-1280x800.png', shotPopup()],
    ['screenshot-3-layers-1280x800.png', shotLayers()],
    ['screenshot-4-scope-1280x800.png', shotScope()],
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
