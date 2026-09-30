/**
 * Force-regenerate the extension icons.
 *
 * `npm run icons`. Normally unnecessary - the build regenerates them if they
 * are missing - but useful after changing the artwork constants in png.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureIcons, ICON_SIZES } from './png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'extension', 'icons');

fs.rmSync(DIR, { recursive: true, force: true });
ensureIcons(DIR);

console.log(`[icons] wrote ${ICON_SIZES.map((s) => `icon${s}.png`).join(', ')} to extension/icons/`);
