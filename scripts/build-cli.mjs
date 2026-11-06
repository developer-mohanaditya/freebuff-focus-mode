/**
 * Freebuff CLI tool packaging.
 *
 *   cli/freebuff-cli-focus.sh  ->  site/downloads/freebuff-cli-focus.sh
 *
 * One file, one artifact: the tool carries its own patch engine and is what the
 * install line fetches, so there is nothing to zip. The version is the app's
 * version, handed in by build.mjs - the CLI tool, the extension and the desktop
 * tools are one product released under one number.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = path.join(ROOT, 'cli');
const DOWNLOADS_DIR = path.join(ROOT, 'site', 'downloads');

const SOURCE = 'freebuff-cli-focus.sh';
const SCRIPT_NAME = 'freebuff-cli-focus.sh';

export function buildCli({ version }) {
  if (!version) throw new Error('buildCli needs the app version');

  const source = path.join(CLI_DIR, SOURCE);
  if (!fs.existsSync(source)) {
    throw new Error(`cli/${SOURCE} is missing - nothing to package`);
  }

  const stamped = fs.readFileSync(source, 'utf8').replaceAll('__FBD_VERSION__', version);
  if (stamped.includes('__FBD_VERSION__')) {
    throw new Error(`cli/${SOURCE} still carries a version placeholder`);
  }

  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  const target = path.join(DOWNLOADS_DIR, SCRIPT_NAME);
  fs.writeFileSync(target, stamped);
  // Served over HTTP the mode is lost, but the file in the repo and in a
  // checkout is meant to be run, and `curl -o` keeps what the server says.
  fs.chmodSync(target, 0o755);

  return {
    script: { relativePath: `downloads/${SCRIPT_NAME}`, bytes: Buffer.byteLength(stamped) },
  };
}
