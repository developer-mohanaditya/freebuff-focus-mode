/**
 * Desktop tool checks.
 *
 * The desktop blocker edits a 9 MB file inside an app bundle, so the parts that
 * matter are the ones that decide whether it is safe to touch it at all:
 *
 *   - a pristine file with the current anchors is recognised and patched,
 *   - the helpers that are NOT the ad path are left exactly as they were,
 *   - a build whose anchor count changed is refused, not half-patched,
 *   - running it twice does not stack a second patch on top of the first,
 *   - `revert` restores the exact original bytes,
 *   - `verify` says nothing is proven while the app is closed, and confirms the
 *     running app once a process that started after the patch exists.
 *
 * The anchor shapes here are taken from a real Freebuff Desktop **0.0.164**
 * bundle, as reported by `scan` on that build: one render gate inside
 * `auction()`, the ad client's own `request` helper, and the decoys that make the
 * old, looser anchors dangerous - six other `async request(` definitions, and
 * two `async post(` helpers, one of which is the logs shipper that POSTs to
 * `${API_HOST}/api/logs`.
 *
 * Everything runs against a throwaway bundle in a temp directory, with the
 * backup directory redirected too, so the real /Applications and the user's
 * backup folder are never touched. `sh` and `perl` are the only requirements,
 * both of which ship with macOS.
 *
 * Run with `npm run test:desktop` (also part of `npm test`).
 */

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The bundle both desktop suites patch. One fixture, so the macOS tool and the
// Windows tool can never be tested against different shapes.
import { CURRENT, GATE, LEGACY, RENAMED, TWO_GATES, DECOY } from './desktop-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'desktop', 'freebuff-focus.sh');
const TOOL_SOURCE = fs.readFileSync(TOOL, 'utf8');

/**
 * The tool as it is served: stamped. The piped runs below get this rather than
 * the source, because a piped `install` now downloads the tool it installs and
 * refuses a copy older than the code that is running - and the source's
 * placeholder version compares as older than any real one.
 */
const FIXTURE_VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8')
).version;
/** The next patch release, served by the fake origin so `update` has something to do. */
const NEXT_VERSION = (() => {
  const [major, minor, patch] = FIXTURE_VERSION.split('.');
  return `${major}.${minor}.${Number(patch) + 1}`;
})();
const STAMPED_SOURCE = TOOL_SOURCE.replaceAll('__FBD_VERSION__', FIXTURE_VERSION).replaceAll(
  '__FBD_ORIGIN__',
  'https://focus.test'
);

/* -------------------------------------------------------------------- harness */

const results = [];
const check = (name, actual, expected = true) => {
  const ok = actual === expected;
  results.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ` -> ${JSON.stringify(actual)} (want ${JSON.stringify(expected)})`}`);
};

/**
 * A served copy of the tool beside the bundle, so `setup` and `update` have an
 * origin to fetch from without touching the network. Every run below points
 * FREEBUFF_FOCUS_ORIGIN at it, which is also what keeps the real
 * ~/.local/share and ~/.local/bin out of these tests.
 */
function makeOrigin(root, version = FIXTURE_VERSION) {
  const dir = path.join(root, 'origin');
  fs.mkdirSync(path.join(dir, 'downloads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'downloads', 'freebuff-focus-desktop.sh'), served(version));
  return `file://${dir}`;
}

const served = (version) =>
  TOOL_SOURCE.replaceAll('__FBD_VERSION__', version).replaceAll('__FBD_ORIGIN__', 'https://focus.test');

function makeBundle(body = CURRENT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fbd-test-'));
  const app = path.join(root, 'Freebuff.app');
  const orch = path.join(app, 'Contents', 'Resources', 'orchestrator');
  fs.mkdirSync(orch, { recursive: true });
  const target = path.join(orch, 'orchestrator.js');
  fs.writeFileSync(target, body);
  return {
    root,
    app,
    target,
    backups: path.join(root, 'backups'),
    origin: makeOrigin(root),
    home: path.join(root, 'focus-home'),
    bin: path.join(root, 'focus-bin'),
  };
}

/**
 * A bundle that also has what 0.0.19x ships for the window: an app.asar holding
 * electron/hosted-workspace.cjs, and the bun runtime that rewrites it.
 *
 * The asar is built here by hand - header, one blob - so the test needs no
 * packaging tool. `bun` is a shim that runs the patcher on node, which speaks
 * the same fs/crypto API; on a real machine it is the app's own binary.
 */
const SHELL_HW =
  'hostedSession = { webRequest: { onBeforeRequest: (fn) => { current = fn } } }\n' +
  'hostedSession.webRequest.onBeforeRequest(null)\nmodule.exports = {}\n';

const SHELL_PRELOAD =
  "'use strict'\n" +
  "const { contextBridge } = require('electron')\n" +
  "contextBridge.exposeInMainWorld('freebuffHost', { ready: () => 1 })\n";

function buildAsar(hwText, preloadText = SHELL_PRELOAD) {
  const blobs = [
    ['hosted-workspace.cjs', Buffer.from(hwText)],
    ['hosted-preload.cjs', Buffer.from(preloadText)],
  ];
  const entry = (body, offset) => {
    const sha = crypto.createHash('sha256').update(body).digest('hex');
    return {
      size: body.length,
      offset: String(offset),
      integrity: { algorithm: 'SHA256', hash: sha, blockSize: 4194304, blocks: [sha] },
    };
  };
  const files = {};
  let offset = 0;
  for (const [name, body] of blobs) {
    files[name] = entry(body, offset);
    offset += body.length;
  }
  const header = { files: { electron: { files } } };
  const json = Buffer.from(JSON.stringify(header));
  const pad = (4 - (json.length % 4)) % 4;
  // Same four fields as 0.0.201's own app.asar: the last one is the JSON's byte
  // count, not the padded one, because Electron reads exactly that many bytes.
  const jlen = json.length + pad;
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(jlen + 8, 4);
  head.writeUInt32LE(jlen + 4, 8);
  head.writeUInt32LE(json.length, 12);
  return Buffer.concat([head, json, Buffer.alloc(pad), ...blobs.map(([, body]) => body)]);
}

/** One file out of a fixture asar, by path inside it. */
function asarFile(asar, wanted) {
  const jlen = asar.readUInt32LE(12);
  const header = JSON.parse(asar.slice(16, 16 + jlen).toString('utf8').replace(/\0+$/, '').trimEnd());
  const base = 8 + asar.readUInt32LE(4);
  const entry = header.files.electron.files[wanted];
  if (!entry) return null;
  return asar.slice(base + Number(entry.offset), base + Number(entry.offset) + Number(entry.size));
}

function makeShellBundle(body = CURRENT, hwSource = SHELL_HW) {
  const f = makeBundle(body);
  const res = path.join(f.app, 'Contents', 'Resources');
  const asar = buildAsar(hwSource);
  fs.writeFileSync(path.join(res, 'app.asar'), asar);

  const bunDir = path.join(res, 'bun');
  fs.mkdirSync(bunDir, { recursive: true });
  const bun = path.join(bunDir, 'bun');
  fs.writeFileSync(bun, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`);
  fs.chmodSync(bun, 0o755);

  f.asar = path.join(res, 'app.asar');
  // What install would have backed up: the build as it shipped, before any block.
  f.asarOriginal = buildAsar(SHELL_HW);
  return f;
}

/** SHA256 over the asar header block - what Electron's integrity fuse checks. */
function headerHashOf(asar) {
  const jlen = asar.readUInt32LE(12);
  return crypto.createHash('sha256').update(asar.slice(16, 16 + jlen)).digest('hex');
}

/**
 * Stand-in for macOS plutil, which only exists there. The tool only asks it to
 * hand a plist over as XML and to write one back, so those two forms are all
 * this needs to support; the fixture plists are already XML.
 */
const PLUTIL_SHIM = `#!${process.execPath}
const fs = require('fs');
const args = process.argv.slice(2);
const out = args[args.indexOf('-o') + 1];
const file = args[args.length - 1];
const text = fs.readFileSync(file, 'utf8');
if (out === '-') process.stdout.write(text);
else fs.writeFileSync(out, text);
`;

/**
 * A bundle built like 0.0.200: Info.plist records the asar header hash and
 * Electron will not start when they disagree. `recorded` defaults to the hash of
 * the pristine build, which is what an untouched install would carry.
 */
function addAsarIntegrity(f, recorded) {
  const hash = recorded || headerHashOf(buildAsar(SHELL_HW));
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ElectronAsarIntegrity</key>
  <dict>
    <key>Resources/app.asar</key>
    <dict>
      <key>algorithm</key>
      <string>SHA256</string>
      <key>hash</key>
      <string>${hash}</string>
    </dict>
  </dict>
</dict>
</plist>
`;
  f.plist = path.join(f.app, 'Contents', 'Info.plist');
  fs.writeFileSync(f.plist, plist);
  f.plistOriginal = plist;
  f.plutil = path.join(f.root, 'plutil');
  fs.writeFileSync(f.plutil, PLUTIL_SHIM);
  fs.chmodSync(f.plutil, 0o755);
  return f;
}

/** The hash this fixture's Info.plist currently records. */
const recordedHash = (f) => {
  const m = fs.readFileSync(f.plist, 'utf8').match(/<key>hash<\/key>\s*<string>([^<]*)<\/string>/);
  return m && m[1];
};

/**
 * Where an install would land, per fixture. A test that let `setup` write to the
 * real ~/.local/bin would be installing a command on the machine that runs the
 * suite.
 */
function toolEnv(bundle, extra = {}) {
  return {
    ...process.env,
    FREEBUFF_FOCUS_HOME: bundle.home,
    FREEBUFF_FOCUS_BIN_DIR: bundle.bin,
    FREEBUFF_FOCUS_SESSION_DIR: bundle.home,
    FREEBUFF_FOCUS_ORIGIN: bundle.origin,
    ...extra,
  };
}

/** The three paths a fixture's install would use, from the bundle's location. */
const bundlePaths = (app) => {
  const root = path.dirname(app);
  return {
    home: path.join(root, 'focus-home'),
    bin: path.join(root, 'focus-bin'),
    origin: `file://${path.join(root, 'origin')}`,
  };
};

function run(app, backups, ...args) {
  return runWith({}, app, backups, ...args);
}

function runWith(extraEnv, app, backups, ...args) {
  return spawnSync('sh', [TOOL, ...args, '--app', app, '--backup-dir', backups], {
    encoding: 'utf8',
    env: toolEnv(bundlePaths(app), extraEnv),
  });
}

/**
 * The piped form the README and the refusal message both tell people to run:
 * the script arrives on stdin, and the command is the first argument.
 */
function runPiped(app, backups, ...args) {
  return spawnSync('sh', ['-s', ...args, '--app', app, '--backup-dir', backups], {
    encoding: 'utf8',
    input: STAMPED_SOURCE,
    env: toolEnv(bundlePaths(app)),
  });
}

/**
 * The same stamped copy, on disk: a local install hands over exactly the code it
 * is running, so a stamped one is what gives the installed copy a real version to
 * compare in `update`.
 */
const STAMPED_TOOL = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fbd-stamped-')), 'freebuff-focus.sh');
fs.writeFileSync(STAMPED_TOOL, STAMPED_SOURCE);

const runStamped = (app, backups, ...args) =>
  spawnSync('sh', [STAMPED_TOOL, ...args, '--app', app, '--backup-dir', backups], {
    encoding: 'utf8',
    env: toolEnv(bundlePaths(app)),
  });

/** The command itself, the way the shell would run it: by name. */
function runCommand(bundle, ...args) {
  const shim = path.join(bundle.bin, 'freebuff-focusmode');
  return spawnSync(shim, args, {
    encoding: 'utf8',
    env: toolEnv(bundle, { PATH: `${bundle.bin}:${process.env.PATH}` }),
  });
}

const count = (text, needle) => text.split(needle).length - 1;
const read = (file) => fs.readFileSync(file, 'utf8');

/** Locate perl, or the fixture-based checks cannot run at all. */
const hasPerl = spawnSync('sh', ['-c', 'command -v perl'], { encoding: 'utf8' }).status === 0;
if (!hasPerl) {
  console.log('perl is not installed - skipping desktop tool checks.');
  process.exit(0);
}

/* ----------------------------------------------------------------- pristine */

console.log('\npristine 0.0.164 bundle');
const a = makeBundle();

const statusClean = run(a.app, a.backups, 'status');
check('status exits 0', statusClean.status, 0);
check('status names both anchors', /render/.test(statusClean.stdout) && /request/.test(statusClean.stdout));
check('status says it is not patched yet', /Not patched yet/.test(statusClean.stdout));
check('status changes nothing', read(a.target) === CURRENT);

/* ------------------------------------------------------------------ install */

console.log('\ninstall');
const install = run(a.app, a.backups, 'install');
check('install exits 0', install.status, 0);
// The header names whose version it is printing. A macOS fixture has no
// Info.plist, so the value here is "unknown" - the label is what is under test.
check('the header credits the installed app for the version', /freebuff\s+\S+ \(installed\)/.test(install.stdout));

const patched = read(a.target);
check('the one render gate is neutralised', count(patched, 'if (true/*FBD-ADS-OFF:render*/)'), 1);
check('the render gate text is gone', patched.includes('localAgenticTestCampaign(process.env)'), false);
check('the ad client request helper returns early', count(patched, '/*FBD-ADS-OFF:request*/'), 1);
check('the early return is the failure shape its callers expect', patched.includes('return { ok: !1, status: 0, message: "" }'));
check('no post anchor was invented', count(patched, '/*FBD-ADS-OFF:post*/'), 0);

// The whole point of the re-anchor: the neighbours stay byte-identical.
check('the sites client request is untouched', patched.includes('async request(path27, method = "GET", body2, idempotencyKey, signal) {'));
check('the config clients are untouched', patched.includes('async request(path30, method = "GET", value2, authHost = !1) {'));
check('the logs shipper is untouched', patched.includes('fetch(`${API_HOST}/api/logs`, { method: "POST" })'));
check('the break-event poster is untouched', patched.includes('async post(path27, body2, options2 = {}) {'));
check('the gate body it patched is still there', patched.includes('return { ads: [] }'));

check('one pristine backup was taken', fs.existsSync(path.join(a.backups, 'orchestrator.js.unknown.orig')));
check('the backup is the original bytes', read(path.join(a.backups, 'orchestrator.js.unknown.orig')) === CURRENT);

/* --------------------------------------------------------------- idempotent */

console.log('\ninstall twice');
const again = run(a.app, a.backups, 'install');
check('second install exits 0', again.status, 0);
check('it reports already patched', /Already patched/.test(again.stdout));

// A run with nothing to write is only worth what it reports. These are the four
// things a reader needs and "Nothing to do" did not give them: which anchors are
// in place, whether a session is running, what the tool can do next, and - for a
// curl run - how to get a copy of the script to run those commands with.
check('it lists the anchors already in place', /render\s+applied/.test(again.stdout) && /request\s+applied/.test(again.stdout));
check('it says there is no focus', /focus\s+none/.test(again.stdout));
check('it prints the commands the tool has', ['status', 'focus 25m', 'unfocus', 'verify', 'scan', 'revert', 'doctor', 'help'].every((c) => again.stdout.includes(c)));
check('the local run does not tell you to download the script', /No local copy/.test(again.stdout), false);

const twice = read(a.target);
check('the render patch did not stack', count(twice, '/*FBD-ADS-OFF:render*/'), 1);
check('the request patch did not stack', count(twice, '/*FBD-ADS-OFF:request*/'), 1);
check('the file is byte-identical to the first patch', twice === patched);

/* ------------------------------------------------------------------- status */

console.log('\nstatus after install');
const statusPatched = run(a.app, a.backups, 'status');
check('status still exits 0', statusPatched.status, 0);
// These fixtures are a bare orchestrator with no app.asar, so the window stage
// is n/a: status must say the local auction is off without claiming the window is.
check('status scopes the claim to the local auction', /local ad auction is off, but the window is not/.test(statusPatched.stdout));
check('and never says ads are off outright', /Ads are off/.test(statusPatched.stdout), false);
check('and says why the window stage is missing', /window\s+n\/a on this build/.test(statusPatched.stdout));

/* ------------------------------------------------------------------- revert */

console.log('\nrevert');
const revert = run(a.app, a.backups, 'revert');
check('revert exits 0', revert.status, 0);
check('the original bytes are restored', read(a.target) === CURRENT);

/* ------------------------------------------------------- the hosted window */

// 0.0.19x renders freebuff.com inside its own session, so the ads you see are
// fetched by that page. The orchestrator patch cannot reach them; app.asar has
// to cancel that request. These checks run the real rewrite on a real asar.
console.log('\nthe hosted window (app.asar)');
const shell = makeShellBundle();
const shellInstall = run(shell.app, shell.backups, 'install');
check('install exits 0', shellInstall.status, 0);
check('it blocks the window as well', /blocked the ad API in app\.asar/.test(shellInstall.stdout));
check('the asar carries the marker', fs.readFileSync(shell.asar).includes('FBD-ADS-OFF:shell-v2'));
check('the orchestrator is patched too', count(read(shell.target), '/*FBD-ADS-OFF:render*/'), 1);
check('the rewritten asar still parses', fs.readFileSync(shell.asar).readUInt32LE(4) > 0);
// 1.9.0 blocked /api/ad/* only, which is the offer flow; the card above the
// composer comes from /api/web/ads/proposal, so the block has to cover it.
check('it blocks the composer ad endpoint', fs.readFileSync(shell.asar, 'utf8').includes('/api\\/(?:ads?('));
// A card the server already put in the document has no request left to cancel,
// so the page preload hides ad nodes by the attributes the site marks them with.
const shellPreload = asarFile(fs.readFileSync(shell.asar), 'hosted-preload.cjs').toString('utf8');
check('the page preload carries the hide', shellPreload.includes('FBD-ADS-OFF:dom-v1'));
check('it hides the gravity ad nodes', shellPreload.includes('[data-gravity-ad]'));
check('it keeps the preload\'s own code intact', shellPreload.startsWith(SHELL_PRELOAD));
{
  const probe = path.join(shell.root, 'preload-check.cjs');
  fs.writeFileSync(probe, shellPreload);
  const syntax = spawnSync(process.execPath, ['--check', probe], { encoding: 'utf8' });
  check('the patched preload parses', syntax.status, 0);
}
check('the workspace file still has the request block', asarFile(fs.readFileSync(shell.asar), 'hosted-workspace.cjs').toString('utf8').includes('FBD-ADS-OFF:shell-v2'));

// 1.9.3 left the request block in place without the page hide. install has to
// notice that gap and add it rather than call the build done.
console.log('\nupgrading an install that has only the request block');
const halfPatched = buildAsar(
  'hostedSession = { webRequest: { onBeforeRequest: (fn) => { current = fn } } }\n' +
  'hostedSession.webRequest.onBeforeRequest((_d,_c)=>_c({cancel:true}))/*FBD-ADS-OFF:shell-v2*/\n' +
  'module.exports = {}\n'
);
const half = makeShellBundle();
fs.writeFileSync(half.asar, halfPatched);
check('status names the gap', /ad cards not hidden yet/.test(run(half.app, half.backups, 'status').stdout));
const halfInstall = run(half.app, half.backups, 'install');
check('install adds the page hide', /page hide/.test(halfInstall.stdout));
check('and the marker is in the asar', fs.readFileSync(half.asar, 'utf8').includes('FBD-ADS-OFF:dom-v1'));
check('status is clean again', /ad API blocked and ad cards hidden/.test(run(half.app, half.backups, 'status').stdout));

const shellStatus = run(shell.app, shell.backups, 'status');
check('status reports the window blocked', /window\s+ad API blocked/.test(shellStatus.stdout));
check('and only then claims ads are off', /Ads are off/.test(shellStatus.stdout));

const shellAgain = run(shell.app, shell.backups, 'install');
check('a second install is a no-op', /Already patched/.test(shellAgain.stdout));
check('and leaves the window stage alone', /window\s+ad API blocked/.test(run(shell.app, shell.backups, 'status').stdout));

run(shell.app, shell.backups, 'revert');
check('revert restores the asar byte for byte', fs.readFileSync(shell.asar).equals(shell.asarOriginal));
check('and the orchestrator with it', read(shell.target) === CURRENT);

// 1.9.0 wrote a block with a narrower URL pattern. install has to rewind that
// from the pristine backup and re-do it, not leave the old one in place.
console.log('\nupgrading a block 1.9.0 already wrote');
const HW_V1 =
  'hostedSession = { webRequest: { onBeforeRequest: (fn) => { current = fn } } }\n' +
  'hostedSession.webRequest.onBeforeRequest((_d,_c)=>_c({cancel:/\\/api\\/(?:ad\\/|v1\\/ads(?:[\\/?]|$))/.test(_d.url)}))/*FBD-ADS-OFF:shell*/\n' +
  'module.exports = {}\n';
const upgrade = makeShellBundle(CURRENT, HW_V1);
fs.mkdirSync(upgrade.backups, { recursive: true });
fs.writeFileSync(path.join(upgrade.backups, 'app.asar.unknown.orig'), upgrade.asarOriginal);
check('status calls the old block stale', /window\s+older block/.test(run(upgrade.app, upgrade.backups, 'status').stdout));
const upgraded = run(upgrade.app, upgrade.backups, 'install');
check('install rewinds it', /older block found/.test(upgraded.stdout));
check('and installs the wider block', fs.readFileSync(upgrade.asar, 'utf8').includes('web\\/ads'));
check('status is honest again', /window\s+ad API blocked/.test(run(upgrade.app, upgrade.backups, 'status').stdout));
run(upgrade.app, upgrade.backups, 'revert');
check('and revert still restores the pristine bytes', fs.readFileSync(upgrade.asar).equals(upgrade.asarOriginal));

// 0.0.200 records SHA256 of the asar header in Info.plist and Electron refuses
// to start when the two disagree. Rewriting app.asar always changes that header,
// so the recorded hash has to move with it - otherwise the tool blocks the ads
// by making the app unlaunchable, which is what 1.9.1 did on 0.0.200.
console.log('\nthe asar integrity fuse (0.0.200)');
const fused = addAsarIntegrity(makeShellBundle());
const fusedEnv = { FREEBUFF_FOCUS_PLUTIL: fused.plutil };
const fusedInstall = runWith(fusedEnv, fused.app, fused.backups, 'install');
check('install exits 0', fusedInstall.status, 0);
check('it says it moved the recorded hash', /app\.asar hash updated in Info\.plist/.test(fusedInstall.stdout));
check('the recorded hash is the rewritten asar\'s', recordedHash(fused), headerHashOf(fs.readFileSync(fused.asar)));
check('status calls the hash verified', /hash verified/.test(runWith(fusedEnv, fused.app, fused.backups, 'status').stdout));

// The state 1.9.1 left behind: block written, hash still the pristine one. The
// app does not start, and the tool must say so instead of claiming ads are off.
fs.writeFileSync(fused.plist, fused.plistOriginal);
const broken = runWith(fusedEnv, fused.app, fused.backups, 'status');
check('status says the app will not start', /will not start/.test(broken.stdout));
check('and does not claim ads are off', /Ads are off/.test(broken.stdout), false);
const repaired = runWith(fusedEnv, fused.app, fused.backups, 'install');
check('install repairs that state', /app\.asar hash updated in Info\.plist/.test(repaired.stdout));
check('status is honest again', /hash verified/.test(runWith(fusedEnv, fused.app, fused.backups, 'status').stdout));

runWith(fusedEnv, fused.app, fused.backups, 'revert');
check('revert restores the asar', fs.readFileSync(fused.asar).equals(fused.asarOriginal));
check('and Info.plist with it', fs.readFileSync(fused.plist, 'utf8'), fused.plistOriginal);

// A build without the fuse (0.0.196) has no such key and must be left alone.
const noFuse = makeShellBundle();
const noFuseInstall = run(noFuse.app, noFuse.backups, 'install');
check('a build without the key still installs', /blocked the ad API/.test(noFuseInstall.stdout));
check('and no Info.plist is written', fs.existsSync(path.join(noFuse.app, 'Contents', 'Info.plist')), false);

// The failure that shipped in 1.9.2: the plist cannot be read at all. That is
// not the same as "this build has no fuse", and the block must not be left in
// place on a guess - an app that will not start is worse than ads.
const blind = addAsarIntegrity(makeShellBundle());
const blindEnv = { FREEBUFF_FOCUS_PLUTIL: path.join(blind.root, 'no-such-plutil') };
const blindInstall = runWith(blindEnv, blind.app, blind.backups, 'install');
check('an unreadable plist does not count as verified', /hash updated in Info\.plist/.test(blindInstall.stdout), false);
check('and the block is taken back out', fs.readFileSync(blind.asar).equals(blind.asarOriginal));
check('it says why', /could not update it/.test(blindInstall.stdout));
check('status calls that unreadable, not verified', /could not be read/.test(runWith(blindEnv, blind.app, blind.backups, 'status').stdout));

/* ------------------------------------------------------------ display-only */

console.log('\ndisplay-only');
const b = makeBundle();
run(b.app, b.backups, 'install', '--display-only');
const partial = read(b.target);
check('the render gate is applied', count(partial, '/*FBD-ADS-OFF:render*/'), 1);
check('the ad client is left alone', count(partial, '/*FBD-ADS-OFF:request*/'), 0);
check('and the ad client is still intact', partial.includes('async request(method, path27, payload, timeoutMs = REQUEST_TIMEOUT_MS) {'));

/* ---------------------------------------------------------------- fail-safe */

console.log('\ntwo gates, as 0.0.155 had');
const c = makeBundle(TWO_GATES);
const twoGates = run(c.app, c.backups, 'install');
check('install refuses', twoGates.status !== 0);
check('the render anchor reads as ambiguous', /render\s+ambiguous/.test(twoGates.stdout));
check('it says why, with the counts', /match\(es\)/.test(twoGates.stdout) && /trusted as written/.test(twoGates.stdout));
check('it points at the local scan', /freebuff-focus\.sh scan/.test(twoGates.stdout));
check('and at the piped one', /freebuff-focus-desktop\.sh \| sh -s scan/.test(twoGates.stdout));
check('the file is left untouched', read(c.target) === TWO_GATES);
check('no backup was taken', fs.existsSync(c.backups), false);

console.log('\nunknown file');
const d = makeBundle('export const something = 41; // a future orchestrator with renamed functions\n');
const refused = run(d.app, d.backups, 'install');
check('install refuses', refused.status !== 0);
check('it says why', /Refusing to patch|does not match/.test(refused.stdout));
check('the file is left untouched', read(d.target).includes('something = 41'));
check('no backup was taken', fs.existsSync(d.backups), false);

console.log('\na marker where the anchor cannot account for it');
// With one gate expected, a file carrying two render markers is a file the tool
// did not write and cannot reason about - it must refuse rather than add a third.
const doubledBody = `${CURRENT}\n/*FBD-ADS-OFF:render*/\n/*FBD-ADS-OFF:render*/`;
const e = makeBundle(doubledBody);
const halfStatus = run(e.app, e.backups, 'status');
check('status refuses to call it patched', halfStatus.status !== 0);
check('it reports the anchor as broken', /render\s+broken/.test(halfStatus.stdout));
check('install refuses to stack on top of it', run(e.app, e.backups, 'install').status !== 0);
check('it left the file alone', read(e.target) === doubledBody);

console.log('\nan anchor that is simply gone');
// A build whose ad code moved away from every anchor left: nothing to patch, so
// the tool refuses and hands over the two ways to get the report that fixes it.
const goneBody = CURRENT.replace(GATE, 'if (false) return { ads: [] };');
const e2 = makeBundle(goneBody);
const gone = run(e2.app, e2.backups, 'install');
check('install refuses', gone.status !== 0);
check('it reports the render anchor as not found', /render\s+not found/.test(gone.stdout));
check('it offers the piped scan', /sh -s scan/.test(gone.stdout));
check('it left the file alone', read(e2.target) === goneBody);
check('no backup was taken', fs.existsSync(e2.backups), false);

/* ------------------------------------------------------------------- dry run */

console.log('\ndry run');
const f = makeBundle();
const dry = run(f.app, f.backups, 'install', '--dry-run');
check('dry run exits 0', dry.status, 0);
check('it writes nothing', read(f.target) === CURRENT);

/* ------------------------------------------------------------ renamed build */

console.log('\nrenamed build (the gate moved)');
const g = makeBundle(RENAMED);
const renamedInstall = run(g.app, g.backups, 'install');
check('install exits 0', renamedInstall.status, 0);
check('it says which anchor it matched', /via relaxed match/.test(renamedInstall.stdout));

const relaxed = read(g.target);
check('the renamed gate is neutralised', count(relaxed, '/*FBD-ADS-OFF:render*/'), 1);
check('the renamed gate text is gone', relaxed.includes('agenticTestCampaign(process.env)'), false);
check('the ad client is stubbed too', count(relaxed, '/*FBD-ADS-OFF:request*/'), 1);
run(g.app, g.backups, 'revert');
check('revert restores the renamed build exactly', read(g.target) === RENAMED);

/* ------------------------------------------------------------ older build */

// 0.0.164's narrower gate, which the tool still carries a literal for. It must
// patch without falling through to the relaxation.
console.log('\n0.0.164 build (the narrower gate)');
const g1 = makeBundle(LEGACY);
const legacyInstall = run(g1.app, g1.backups, 'install');
check('install exits 0', legacyInstall.status, 0);
check('it does not need the relaxation', /via relaxed match/.test(legacyInstall.stdout), false);
check('the older gate is neutralised', count(read(g1.target), '/*FBD-ADS-OFF:render*/'), 1);
check('the ad client is stubbed too', count(read(g1.target), '/*FBD-ADS-OFF:request*/'), 1);
run(g1.app, g1.backups, 'revert');
check('revert restores it exactly', read(g1.target) === LEGACY);

/* -------------------------------------------------------------------- decoy */

console.log('\ndecoy gate far from ad code');
const h = makeBundle(DECOY);
const decoy = run(h.app, h.backups, 'install');
check('install refuses', decoy.status !== 0);
check('the render anchor reads as ambiguous', /render\s+ambiguous/.test(decoy.stdout));
check('the decoy file is untouched', read(h.target) === DECOY);
check('no backup was taken', fs.existsSync(h.backups), false);

/* --------------------------------------------------------------------- scan */

console.log('\nscan');
const i = makeBundle();
const scan = run(i.app, i.backups, 'scan');
check('scan exits 0', scan.status, 0);
check('scan changes nothing', read(i.target) === CURRENT);
check('scan names both strategies', /literal/.test(scan.stdout) && /relaxed/.test(scan.stdout));
check('scan marks the usable anchor', /<- usable/.test(scan.stdout));
check('scan says a trusted literal has no adjacency check', /trusted as written/.test(scan.stdout));
check('scan reports the probes', /== probes ==/.test(scan.stdout));
check('scan saves the report to attach', read(path.join(i.backups, 'orchestrator-scan.unknown.txt')).includes('== render =='));

// The case-insensitive probe fix: this bundle has localAgenticTestCampaign, and
// a case-sensitive probe for agenticTestCampaign used to report 0 - which reads
// as "the ad runtime is gone" when it is right there.
const probeLine = scan.stdout.split('\n').find((line) => /^\s+agenticTestCampaign\s+\d+/.test(line)) || '';
check('the agenticTestCampaign probe now finds the local variant', /\s[1-9]\d*$/.test(probeLine.trim()));

/* ------------------------------------------------------------- piped one-liner */

console.log('\nthe piped form');
const j = makeBundle();
const pipedScan = runPiped(j.app, j.backups, 'scan');
check('`sh -s scan` exits 0', pipedScan.status, 0);
check('and prints the scan report', /== render ==/.test(pipedScan.stdout));
check('and names the tool version it is running', /anchor scan \(tool \S+\)/.test(pipedScan.stdout));

// A piped run has no script on disk, so it installs the command first and then
// names that command in its hints. A fresh bundle, because `a` has been reverted
// by the time this runs.
const k = makeBundle();
run(k.app, k.backups, 'install');
const pipedAgain = runPiped(k.app, k.backups, 'install');
check('a piped install puts the command on the machine', fs.existsSync(path.join(k.bin, 'freebuff-focusmode')));
check('a piped second install still reports already patched', /Already patched/.test(pipedAgain.stdout));
check('and names the command rather than a file to save', /Run them as:\s+freebuff-focusmode/.test(pipedAgain.stdout));
check('and no longer tells them to save a copy first', /No local copy/.test(pipedAgain.stdout), false);

/* ------------------------------------------------------------------ verify */

/**
 * The relaunch check, which is the one thing `status` cannot say. It is driven
 * by two times rather than by anything on disk, so it has to be tested against a
 * real process: `pgrep -f` finds a process whose command line *ends* with the
 * orchestrator path, and a plain `sh -c 'sleep 30; exit 0' <path>` is exactly
 * that - the same shape as the bundled Bun process, without needing Freebuff.
 */
console.log('\nverify');

const v = makeBundle();

const beforeInstall = run(v.app, v.backups, 'verify', '--no-wait');
check('verify exits non-zero before the patch is applied', beforeInstall.status !== 0);
check('it says it is not patched yet', /Not patched yet/.test(beforeInstall.stdout));
check('it writes nothing', read(v.target) === CURRENT);

run(v.app, v.backups, 'install');
const patchedBytes = read(v.target);

const idle = run(v.app, v.backups, 'verify', '--no-wait');
check('verify exits non-zero with Freebuff closed', idle.status !== 0);
check('it reports both anchors applied', /render\s+applied/.test(idle.stdout) && /request\s+applied/.test(idle.stdout));
check('it says Freebuff is not open', /Freebuff is not open/.test(idle.stdout));
check('it points at running verify again', /freebuff-focus\.sh verify/.test(idle.stdout));
check('verify changes nothing in the bundle', read(v.target) === patchedBytes);

const noTimeout = run(v.app, v.backups, 'verify', '--no-wait', '--timeout', 'soon');
check('a non-numeric --timeout is refused', /--timeout needs/.test(`${noTimeout.stdout}${noTimeout.stderr}`));

const ORCH = path.join(v.app, 'Contents', 'Resources', 'orchestrator', 'orchestrator.js');
const standIn = () => spawn('sh', ['-c', 'sleep 30; exit 0', ORCH], { detached: true, stdio: 'ignore' });
const retire = (child) => {
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* it has already gone */
    }
  }
};

/**
 * The no-wait cases are decided by two times, so the fixture writes one of them
 * directly: a patch written a minute ago, or a minute from now. Sleeping through
 * a real minute would test the same comparison more slowly, and ps only reports a
 * process's age to the second anyway - the wait itself is covered end to end
 * below, where a pid that appeared after watching began is the evidence.
 */
const stampPatchTime = (target, seconds) => {
  const when = (Date.now() + seconds * 1000) / 1000;
  fs.utimesSync(target, when, when);
};

// The half that matters more: a process that started *before* the write is an
// app that has not been relaunched, and it must never be reported as verified.
console.log('\nverify, with an app that was already running');
const stale = makeBundle();
const already = spawn(
  'sh',
  ['-c', 'sleep 30; exit 0', path.join(stale.app, 'Contents', 'Resources', 'orchestrator', 'orchestrator.js')],
  { detached: true, stdio: 'ignore' }
);
already.unref();

await new Promise((resolve) => setTimeout(resolve, 400));
// --no-restart is what pins this scenario: with the 1.7 default, install would
// restart the app it found, and there would be no stale process left to refuse.
run(stale.app, stale.backups, 'install', '--no-restart');
stampPatchTime(stale.target, 60);
const notYet = run(stale.app, stale.backups, 'verify', '--no-wait');
retire(already);

check('a process started before the patch is not verified', notYet.status !== 0);
check('it says the app has not been relaunched since', /has not been relaunched since/.test(notYet.stdout));
check('it reports the gap it measured', /before the patch/.test(notYet.stdout));
check('and the patch itself still went in', read(stale.target).includes('/*FBD-ADS-OFF:render*/'));

const live = standIn();
live.unref();
await new Promise((resolve) => setTimeout(resolve, 400));
stampPatchTime(v.target, -60);

const seen = run(v.app, v.backups, 'verify', '--no-wait');
retire(live);

check('verify exits 0 once a process started after the patch exists', seen.status, 0);
check('it names the pid it found', /pid \d+/.test(seen.stdout));
check('it reports the process as started after the patch', /after the patch/.test(seen.stdout));
check('it names the running app as the patched file', /running app is the patched file/.test(seen.stdout));
check('it reports the ad code still in the build', /still in this build: .*auction \d+/.test(seen.stdout));
check('it says what only the user can see', /only you can/.test(seen.stdout));

// The whole point of the command: started with the app closed, it has to sit on
// its own and finish when the app comes back, with no second command to run.
const waiting = spawn(
  'sh',
  [TOOL, 'verify', '--app', v.app, '--backup-dir', v.backups, '--timeout', '20'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
);
let waitOut = '';
waiting.stdout.on('data', (chunk) => {
  waitOut += chunk;
});

await new Promise((resolve) => setTimeout(resolve, 600));
check('it waits while Freebuff is closed', /Waiting for Freebuff/.test(waitOut));

const arrived = standIn();
arrived.unref();
const waitedCode = await new Promise((resolve) => waiting.on('exit', resolve));
retire(arrived);

check('the wait ends by itself once the app comes back', waitedCode, 0);
check('and it reaches the same verdict', /running app is the patched file/.test(waitOut));
check('and it still wrote nothing', read(v.target) === patchedBytes);

/* ------------------------------------------------------ restart and focus */

/**
 * The 1.7 lifecycle: install no longer asks the reader to quit and reopen, it
 * does both. `open` is the only macOS-specific command in that path, so a fake
 * one on PATH is the whole harness - it records the launch and starts a process
 * whose command line ends with the orchestrator path, which is exactly the shape
 * `verify` looks for.
 */
console.log('\nrestart on install');

const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'fbd-open-'));
const openLog = path.join(fakeBin, 'launched.log');
fs.writeFileSync(
  path.join(fakeBin, 'open'),
  [
    '#!/bin/sh',
    'app=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in -a) shift; app="$1" ;; esac',
    '  shift',
    'done',
    '[ -n "$app" ] || exit 1',
    'printf "%s\\n" "$app" >> "$FAKE_OPEN_LOG"',
    'sh -c "sleep 30; exit 0" "$app/Contents/Resources/orchestrator/orchestrator.js" >/dev/null 2>&1 &',
    'exit 0',
    '',
  ].join('\n')
);
fs.chmodSync(path.join(fakeBin, 'open'), 0o755);

const runRestart = (app, backups, ...args) =>
  spawnSync('sh', [TOOL, ...args, '--app', app, '--backup-dir', backups], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_OPEN_LOG: openLog },
  });

const r = makeBundle();
const forced = runRestart(r.app, r.backups, 'install', '--restart');
check('--restart exits 0', forced.status, 0);
check('it says it is restarting', /Restarting Freebuff/.test(forced.stdout));
check('it launched the app it patched', read(openLog).includes(r.app));
check('and verified the process it started', /running app is the patched file/.test(forced.stdout));

// The opposite flag: nothing is touched, and the reader is told what to do.
const quiet = makeBundle();
const quietRun = run(quiet.app, quiet.backups, 'install', '--no-restart');
check('--no-restart still patches', count(read(quiet.target), '/*FBD-ADS-OFF:render*/'), 1);
check('and it asks the reader to quit and reopen', /Open Freebuff\./.test(quietRun.stdout));
check('and it never claims a restart', /restarted Freebuff/.test(quietRun.stdout), false);

/* ------------------------------------------------------------------- focus */

/**
 * The three modes, and the process that ends two of them.
 *
 * `focus` on its own must promise nothing but `unfocus` - it used to default to
 * 25m and print a deadline the patch never honoured. A timed focus and a session
 * focus both leave one detached watcher, and what ends them differs: a clock, or
 * the app quitting. The fake orchestrator below is the same shape the tool looks
 * for - a process whose command line ends with the orchestrator path - so the
 * checks drive the real pgrep/ps path rather than a stub.
 */

// A real await, not a busy sleep: node reaps its children on the event loop, and
// a killed child that has not been reaped is still a live pid to `kill -0` -
// which is exactly what the watcher waits on. Sleeping with Atomics here would
// leave the fake app looking alive and fail a check the tool gets right.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sessionKeys = (file) =>
  Object.fromEntries(read(file).trim().split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

console.log('\nfocus: until you end it');
const s = makeBundle();
const sessionDir = path.join(s.root, 'session-state');
const sessionFile = path.join(sessionDir, 'session');
const sessionLog = path.join(sessionDir, 'session.log');

const plain = run(s.app, s.backups, 'focus', '--session-dir', sessionDir);
check('focus with no duration exits 0', plain.status, 0);
check('it names no deadline', /Ads stay off until you end it/.test(plain.stdout));
check('and nothing else as the end of it', /Nothing else ends this one/.test(plain.stdout));
check('the patch went in', count(read(s.target), '/*FBD-ADS-OFF:render*/'), 1);
check('a session file is written', fs.existsSync(sessionFile));
check('the mode is until-unfocus', sessionKeys(sessionFile).mode, 'until-unfocus');
check('there is no end time', 'endsAt' in sessionKeys(sessionFile), false);
check('and nothing is left running', fs.existsSync(sessionLog), false);
check('nothing else is left in that folder', fs.readdirSync(sessionDir).length, 1);

const plainStatus = run(s.app, s.backups, 'status', '--session-dir', sessionDir);
check('status says only unfocus ends it', /focus\s+on - until you run/.test(plainStatus.stdout));
check('and still reports the patch', /render\s+applied/.test(plainStatus.stdout));
check('without claiming the window is quiet', /Ads are off/.test(plainStatus.stdout), false);

const ended = run(s.app, s.backups, 'unfocus', '--session-dir', sessionDir);
check('unfocus exits 0', ended.status, 0);
check('it restores the original bytes', read(s.target) === CURRENT);
check('it clears the session file', fs.existsSync(sessionFile), false);
check('and says so', /focus\s+cleared/.test(ended.stdout));

const badDuration = run(s.app, s.backups, 'focus', 'soon', '--session-dir', sessionDir);
check('a duration that is not a duration is refused', badDuration.status !== 0);
check('and it says what one looks like', /duration like 25m/.test(`${badDuration.stdout}${badDuration.stderr}`));
check('and nothing is patched', read(s.target) === CURRENT);

console.log('\nfocus 5s: restored at the deadline');
run(s.app, s.backups, 'install', '--session-dir', sessionDir, '--no-wait');
const timed = run(s.app, s.backups, 'focus', '5s', '--session-dir', sessionDir);
check('a timed focus exits 0', timed.status, 0);
check('it names the time it ends', /Focus until \d\d:\d\d/.test(timed.stdout));
check('the mode is until', sessionKeys(sessionFile).mode, 'until');
check('it carries an end time', /^endsAt=\d+$/m.test(read(sessionFile)));
await wait(600);
const timedKeys = sessionKeys(sessionFile);
check('a watcher records its own pid', Number(timedKeys.watcher) > 0);
check('and the file it wrote', /^\d+:\d+$/.test(timedKeys.stamp));
await wait(6500);
check('the deadline restores the original bytes', read(s.target) === CURRENT);
check('and the session file goes with it', fs.existsSync(sessionFile), false);
check('the log says why', /the deadline passed - restored/.test(read(sessionLog)));

console.log('\nfocus session: restored when the app quits');
run(s.app, s.backups, 'install', '--session-dir', sessionDir, '--no-wait');
// The app is open and already running the patched file, which is the state a
// session focus is asked for in.
const fake = spawn('sh', ['-c', 'sleep 120', s.target], { stdio: 'ignore' });
await wait(300);
const sess = run(s.app, s.backups, 'focus', 'session', '--session-dir', sessionDir);
check('session focus exits 0', sess.status, 0);
check('it says the ads come back when Freebuff quits', /Ads come back when you quit Freebuff/.test(sess.stdout));
check('the mode is session', sessionKeys(sessionFile).mode, 'session');
check('it watches the running app', Number(sessionKeys(sessionFile).pid), fake.pid);
await wait(600);
check('a watcher records its own pid', Number(sessionKeys(sessionFile).watcher) > 0);
const sessionStatus = run(s.app, s.backups, 'status', '--session-dir', sessionDir);
check('status names the pid it is waiting on', new RegExp(`until Freebuff quits \\(pid ${fake.pid}\\)`).test(sessionStatus.stdout));

fake.kill('SIGKILL');
await wait(2500);
check('quitting the app restores the original bytes', read(s.target) === CURRENT);
check('and clears the session', fs.existsSync(sessionFile), false);
check('the log names the quit', /Freebuff quit - restored/.test(read(sessionLog)));

console.log('\nthe watcher stands down when the file moves under it');
run(s.app, s.backups, 'install', '--session-dir', sessionDir, '--no-wait');
const fake2 = spawn('sh', ['-c', 'sleep 120', s.target], { stdio: 'ignore' });
await wait(300);
run(s.app, s.backups, 'focus', 'session', '--session-dir', sessionDir);
await wait(600);
// What a Freebuff update looks like from here: the bytes the patch wrote are
// replaced by someone else while the session is still on.
fs.appendFileSync(s.target, '\n/* replaced by an update */\n');
fake2.kill('SIGKILL');
await wait(2500);
check('a file that changed after the patch is left alone', read(s.target).includes('replaced by an update'));
check('the watcher says why it did nothing', /left the file alone: it changed after the patch/.test(read(sessionLog)));
check('and the session is over anyway', fs.existsSync(sessionFile), false);

console.log('\nunfocus and a second focus stop the watcher');
run(s.app, s.backups, 'install', '--session-dir', sessionDir, '--no-wait');
const fake3 = spawn('sh', ['-c', 'sleep 120', s.target], { stdio: 'ignore' });
await wait(300);
run(s.app, s.backups, 'focus', 'session', '--session-dir', sessionDir);
await wait(600);
const firstWatcher = Number(sessionKeys(sessionFile).watcher);
const stopped = run(s.app, s.backups, 'unfocus', '--session-dir', sessionDir);
check('unfocus exits 0', stopped.status, 0);
check('it restores the original bytes', read(s.target) === CURRENT);
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
check('and stops the watcher', alive(firstWatcher), false);

run(s.app, s.backups, 'focus', 'session', '--session-dir', sessionDir);
await wait(600);
const secondWatcher = Number(sessionKeys(sessionFile).watcher);
run(s.app, s.backups, 'focus', 'session', '--session-dir', sessionDir);
await wait(600);
const thirdWatcher = Number(sessionKeys(sessionFile).watcher);
check('a second focus replaces the first watcher', secondWatcher !== thirdWatcher);
check('and the one it replaced is gone', alive(secondWatcher), false);
run(s.app, s.backups, 'unfocus', '--session-dir', sessionDir);
fake3.kill('SIGKILL');

/* ------------------------------------------------------- the installed command */

/**
 * The one-liner is the install path, so what it creates is the product: a
 * `freebuff-focusmode` command that keeps working after the curl is forgotten,
 * a way to replace it with a newer copy, and a way to take it away again without
 * taking the patch with it.
 */
console.log('\nthe freebuff-focusmode command');

const inst = makeBundle();
const setup = runStamped(inst.app, inst.backups, 'setup');
const shim = path.join(inst.bin, 'freebuff-focusmode');
check('setup exits 0', setup.status, 0);
check('it writes the command', fs.existsSync(shim));
check('the command is executable', (fs.statSync(shim).mode & 0o111) !== 0);
const alias = path.join(inst.bin, 'freebuff-focus');
check('the short alias is written beside it', fs.existsSync(alias));
check('the alias is executable too', (fs.statSync(alias).mode & 0o111) !== 0);
check(
  'and runs the same tool',
  spawnSync(alias, ['version'], { encoding: 'utf8' }).stdout.includes(`freebuff-focus-desktop ${FIXTURE_VERSION}`)
);
check('it installs the tool itself', fs.existsSync(path.join(inst.home, 'freebuff-focus.sh')));
check('and says where both went', setup.stdout.includes(inst.home) && setup.stdout.includes(shim));
check('and does not patch anything yet', read(inst.target) === CURRENT);
check('setup again is not an error', runStamped(inst.app, inst.backups, 'setup').status, 0);

// A name that is already someone else's command stays theirs.
const foreign = makeBundle();
fs.mkdirSync(foreign.bin, { recursive: true });
const own = path.join(foreign.bin, 'freebuff-focus');
fs.writeFileSync(own, '#!/bin/sh\necho mine\n');
const foreignSetup = runStamped(foreign.app, foreign.backups, 'setup');
check('a file that is not ours is left alone', read(own), '#!/bin/sh\necho mine\n');
check('and the long command is still installed', fs.existsSync(path.join(foreign.bin, 'freebuff-focusmode')));
check(
  'and setup says it left it alone',
  /was not written by this tool/.test(`${foreignSetup.stdout}${foreignSetup.stderr}`)
);

const viaCommand = runCommand(inst, 'version');
check('the command runs the tool', viaCommand.status, 0);
check('and reports the tool version', viaCommand.stdout.includes(`freebuff-focus-desktop ${FIXTURE_VERSION}`));
const commandStatus = runCommand(inst, 'status', '--app', inst.app, '--backup-dir', inst.backups);
check('arguments reach the tool through the command', /Not patched yet/.test(commandStatus.stdout));

// --add-path edits a dotfile, so it is opt-in and it has to be idempotent: the
// marker is what stops a second run from appending the same line twice.
const p1 = spawnSync('sh', [STAMPED_TOOL, 'setup', '--add-path'], {
  encoding: 'utf8',
  env: toolEnv(inst, { HOME: inst.root, SHELL: '/bin/bash' }),
});
spawnSync('sh', [STAMPED_TOOL, 'setup', '--add-path'], {
  encoding: 'utf8',
  env: toolEnv(inst, { HOME: inst.root, SHELL: '/bin/bash' }),
});
const rc = path.join(inst.root, '.bashrc');
check('--add-path exits 0', p1.status, 0);
check('it adds the folder to the shell rc', fs.existsSync(rc) && read(rc).includes(inst.bin));
check('and only once, however often setup runs', count(read(rc), '# freebuff-focus PATH'), 1);

const fresh = makeBundle();
runStamped(fresh.app, fresh.backups, 'setup');
makeOrigin(fresh.root, NEXT_VERSION);
const updated = runCommand(fresh, 'update', '--app', fresh.app, '--backup-dir', fresh.backups);
check('update exits 0', updated.status, 0);
check('it names both versions', updated.stdout.includes(`${FIXTURE_VERSION} -> ${NEXT_VERSION}`));
check('the installed copy is the new one', read(path.join(fresh.home, 'freebuff-focus.sh')).includes(`VERSION="${NEXT_VERSION}"`));
check('the copy it replaced is kept', fs.existsSync(path.join(fresh.home, 'freebuff-focus.sh.prev')));
// The patch step is the new copy's, with the paths this run was given: the
// handover must not fall back to guessing where Freebuff is.
check('and it patches with the new copy', count(read(fresh.target), '/*FBD-ADS-OFF:render*/'), 1);
check('and names the command once more at the end', /Run them as:\s+freebuff-focusmode/.test(updated.stdout));

const current = runCommand(fresh, 'update');
check('a second update says it is already current', /already up to date/.test(current.stdout));
check('and exits 0', current.status, 0);

makeOrigin(fresh.root, '1.7.9');
const older = runCommand(fresh, 'update');
check('an older served copy is refused', older.status !== 0);
check('and it says which way round they are', /older than the installed/.test(older.stderr));
check('and the installed copy is untouched', read(path.join(fresh.home, 'freebuff-focus.sh')).includes(`VERSION="${NEXT_VERSION}"`));

const removed = runCommand(fresh, 'uninstall');
check('uninstall exits 0', removed.status, 0);
check('it removes the command', fs.existsSync(path.join(fresh.bin, 'freebuff-focusmode')), false);
check('and the short alias with it', fs.existsSync(path.join(fresh.bin, 'freebuff-focus')), false);
check('and the installed copy', fs.existsSync(path.join(fresh.home, 'freebuff-focus.sh')), false);
check('and says the patch is still applied', /patch is still applied/.test(removed.stdout));
check('and the patch really is still applied', count(read(fresh.target), '/*FBD-ADS-OFF:render*/'), 1);

/* ---------------------------------------------------- the shipped artifact */

/**
 * Everything above tests the source. This tests the file people actually
 * download: stamped with a version and an origin, and carrying the same
 * anchors. A shipped copy that lags the source is the failure this catches -
 * it is built by `npm run build`, so a missing or stale one is a build away.
 */
console.log('\nthe stamped artifact in site/downloads');
const STAMPED = path.join(ROOT, 'site', 'downloads', 'freebuff-focus-desktop.sh');

if (!fs.existsSync(STAMPED)) {
  console.log('  (not built yet - skipping; run npm run build)');
} else {
  const stampedSource = read(STAMPED);
  const k = makeBundle();
  const shipped = spawnSync('sh', [STAMPED, 'install', '--app', k.app, '--backup-dir', k.backups], {
    encoding: 'utf8',
  });

  check('it is stamped, not shipped with placeholders', /__FBD_(VERSION|ORIGIN)__/.test(stampedSource), false);
  check('the shipped copy installs on a 0.0.164-shaped build', shipped.status, 0);
  check('it applies the render anchor once', count(read(k.target), '/*FBD-ADS-OFF:render*/'), 1);
  check('it applies the request anchor once', count(read(k.target), '/*FBD-ADS-OFF:request*/'), 1);
  check('it leaves the logs shipper alone', read(k.target).includes('api/logs'));
  // The origin is composed at runtime from the stamped $ORIGIN, so the only way
  // to check the hint is to make the shipped copy refuse and read what it says.
  const k2 = makeBundle(TWO_GATES);
  const shippedRefusal = spawnSync('sh', [STAMPED, 'install', '--app', k2.app, '--backup-dir', k2.backups], {
    encoding: 'utf8',
  });

  check('it refuses when the anchor count moved', shippedRefusal.status !== 0);
  check('and prints the counts it saw', /match\(es\)/.test(shippedRefusal.stdout));
  check(
    'and a piped scan command naming the real origin',
    /curl -fsSL https:\/\/\S+ \| sh -s scan/.test(shippedRefusal.stdout)
  );
  check('and leaves that build untouched', read(k2.target) === TWO_GATES);
}

/* ------------------------------------------------ does the bundle start at all */

/**
 * `open -a` answers for LaunchServices, not for the app: it reports success the
 * moment macOS accepts the handover, which is before a line of the bundle has
 * run. So a bundle that dies while loading its own resources looks exactly like
 * one that opened - "it closes and never comes back". These two fixtures are
 * that failure and its absence, behind an `open` that only records the handover.
 */
console.log('\ndoes the bundle start');

const deafBin = fs.mkdtempSync(path.join(os.tmpdir(), 'fbd-deaf-'));
fs.writeFileSync(path.join(deafBin, 'open'), '#!/bin/sh\nexit 0\n');
fs.chmodSync(path.join(deafBin, 'open'), 0o755);

/** A 0.0.200-shaped bundle whose own executable runs `script` and nothing else. */
function makeStartBundle(script) {
  const f = addAsarIntegrity(makeShellBundle());
  const mac = path.join(f.app, 'Contents', 'MacOS');
  fs.mkdirSync(mac, { recursive: true });
  const bin = path.join(mac, 'Freebuff');
  fs.writeFileSync(bin, `#!/bin/sh\n${script}\n`);
  fs.chmodSync(bin, 0o755);
  return f;
}

const startRun = (f, ...args) =>
  runWith(
    {
      PATH: `${deafBin}:${process.env.PATH}`,
      FREEBUFF_FOCUS_BUN: process.execPath,
      FREEBUFF_FOCUS_PLUTIL: f.plutil,
      FREEBUFF_FOCUS_WAIT_APP: '2',
      FREEBUFF_FOCUS_PROBE_SECS: '2',
    },
    f.app,
    f.backups,
    ...args
  );

const wontStart = makeStartBundle(
  'echo "Error: integrity check failed for electron/hosted-preload.cjs" >&2\nexit 9'
);
const wontStartRun = startRun(wontStart, 'install', '--restart', '--no-wait');
check('a bundle that will not start is not reported as a restart', /would not start with the window stage applied/.test(wontStartRun.stdout));
check('and what the app said is quoted back', /integrity check failed/.test(wontStartRun.stdout));
check('app.asar is put back byte for byte', fs.readFileSync(wontStart.asar).equals(wontStart.asarOriginal));
check('and Info.plist with it', read(wontStart.plist), wontStart.plistOriginal);
check('the failure is kept for status', /last start of Freebuff failed/.test(startRun(wontStart, 'status').stdout));

const flashes = makeStartBundle(
  'sleep 1\necho "Error: Unable to load preload script: hosted-preload.cjs" >&2\nexit 3'
);
const flashesRun = startRun(flashes, 'install', '--restart', '--no-wait');
check('a launch that dies a second in is not a start', /started Freebuff/.test(flashesRun.stdout), false);
check('and it is rolled back like any other refusal', /would not start with the window stage applied/.test(flashesRun.stdout));
check('with the pristine app.asar back', fs.readFileSync(flashes.asar).equals(flashes.asarOriginal));

// A bundle that refuses one half of the window stage and takes the other: the
// only way to tell the tool which half it minds is to start it with each.
const bisect = makeStartBundle(
  [
    'asar="$(cd "$(dirname "$0")/../Resources" 2>/dev/null && pwd)/app.asar"',
    'if grep -qa "FBD-ADS-OFF:dom-v1" "$asar" 2>/dev/null; then echo "Error: unable to load preload script" >&2; exit 7; fi',
    'sleep 5',
  ].join('\n')
);
startRun(bisect, 'install', '--no-restart');
const bisectRun = startRun(bisect, 'diagnose');
check('diagnose starts the bundle with none of the patch in place', /started\s+Freebuff's own files/.test(bisectRun.stdout));
check('diagnose starts it with the API block alone', /started\s+the ad API block alone/.test(bisectRun.stdout));
check('diagnose names the card hide as the half that stops it', /The ad card hide\s+is what stops Freebuff from starting/.test(bisectRun.stdout));
check('diagnose leaves the shipped app.asar behind', fs.readFileSync(bisect.asar).equals(bisect.asarOriginal));

const starts = makeStartBundle('sleep 5');
const startsRun = startRun(starts, 'install', '--restart', '--no-wait');
check('a bundle that starts is started and said so', /started Freebuff/.test(startsRun.stdout));
check('and its patch is left in place', count(read(starts.asar), 'FBD-ADS-OFF:dom-v1'), 1);
check('and its hash still matches', headerHashOf(fs.readFileSync(starts.asar)), recordedHash(starts));

// Electron reads the header string with the length from the fourth field, so a
// padded count there makes it swallow the NUL pad and refuse the file - the
// bundle dies before a line of it runs, with "Failed to parse header". The
// fields are therefore checked against what 0.0.201 ships, not against this
// tool's own reader, which is what let the two drift apart.
const headerFields = (buf) => {
  const w0 = buf.readUInt32LE(0);
  const w1 = buf.readUInt32LE(4);
  const w2 = buf.readUInt32LE(8);
  const w3 = buf.readUInt32LE(12);
  const base = 8 + w1;
  const json = buf.slice(16, base).toString('utf8').replace(/\0+$/, '');
  return { w0, w1, w2, w3, base, json };
};

const patchedAsar = fs.readFileSync(starts.asar);
const hf = headerFields(patchedAsar);
check('the header counts its own payload', hf.w0, 4);
check('and that payload is the header block minus the count', hf.w2, hf.w1 - 4);
check('and the files start on a 4-byte boundary', hf.base % 4, 0);
check('and the length field is the JSON alone, padding excluded', hf.w3, Buffer.byteLength(hf.json));
check(
  'and exactly those bytes parse as the header',
  (() => {
    try {
      return !!JSON.parse(patchedAsar.slice(16, 16 + hf.w3).toString('utf8'));
    } catch (e) {
      return false;
    }
  })()
);
check('and the recorded hash covers exactly the JSON', headerHashOf(patchedAsar), recordedHash(starts));


// On some Macs the kernel kills a hand-started copy of the bundle (Killed: 9)
// while the same bytes open fine from Finder. A direct start that dies is
// therefore not an answer on its own: the launch a reader would make has to
// follow it, or every patch looks broken on that machine.
const reviveBin = fs.mkdtempSync(path.join(os.tmpdir(), 'fbd-revive-'));
fs.writeFileSync(
  path.join(reviveBin, 'open'),
  [
    '#!/bin/sh',
    'app=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in -a) shift; app="$1" ;; esac',
    '  shift',
    'done',
    'sh -c "sleep 30; exit 0" "$app/Contents/Resources/orchestrator/orchestrator.js" >/dev/null 2>&1 &',
    'exit 0',
    '',
  ].join('\n')
);
fs.chmodSync(path.join(reviveBin, 'open'), 0o755);

const startRunOpen = (f, ...args) =>
  runWith(
    {
      PATH: `${reviveBin}:${process.env.PATH}`,
      FREEBUFF_FOCUS_BUN: process.execPath,
      FREEBUFF_FOCUS_PLUTIL: f.plutil,
      FREEBUFF_FOCUS_WAIT_APP: '2',
      FREEBUFF_FOCUS_PROBE_SECS: '2',
    },
    f.app,
    f.backups,
    ...args
  );

const killed = makeStartBundle('kill -9 $$');
const killedRun = startRun(killed, 'install', '--restart', '--no-wait');
check('a hand-started bundle the kernel kills is still a failed start', /would not start with the window stage applied/.test(killedRun.stdout));
check('and the kill is named as the reason, not the patch', /Killed: 9/.test(killedRun.stdout));
check('and that bundle is put back', fs.readFileSync(killed.asar).equals(killed.asarOriginal));

const revived = makeStartBundle('kill -9 $$');
const revivedRun = startRunOpen(revived, 'install', '--restart', '--no-wait');
check('the same kill with a normal launch that works is a start', /started Freebuff/.test(revivedRun.stdout));
check('and the patch it installed is left in place', count(read(revived.asar), 'FBD-ADS-OFF:dom-v1'), 1);

// The engine that rewrites app.asar is generated once into the session dir and
// then reused, because regenerating a 90 KB script on every run is wasted work.
// That reuse used to be decided by one hand-written tag line, and 1.9.9 changed
// the engine - the asar header fix - without bumping the tag: any machine that
// had run an earlier version kept the old writer forever, so the fix never ran
// there and every patched build died with "Failed to parse header". A cache hit
// is decided by comparing the generated bytes now, so an engine change cannot be
// shadowed by a copy that predates it.
const tagOf = (source) => {
  const m = source.match(/SHELL_JS_TAG='([^']+)'/);
  return m && m[1];
};
const cachedOld = makeStartBundle('sleep 5');
const cachedOldHome = path.join(path.dirname(cachedOld.app), 'focus-home');
fs.mkdirSync(cachedOldHome, { recursive: true });
const cachedOldEngine = path.join(cachedOldHome, 'shell-adblock.js');
// Right tag, old body: exactly what a cache from before the fix looks like.
fs.writeFileSync(cachedOldEngine, `// shell-adblock ${tagOf(TOOL_SOURCE)}\n'use strict';\nprocess.exit(3);\n`);
const cachedOldRun = startRun(cachedOld, 'install', '--no-restart');
check('a cached engine with the current tag but an old body is not reused', /process\.exit\(3\)/.test(read(cachedOldEngine)), false);
check('and it is replaced by the engine this build generates', /MARK = '\/\*FBD-ADS-OFF:shell-v2\*\//.test(read(cachedOldEngine)));
check('and the patch it writes is the one the current engine writes', count(read(cachedOld.asar), 'FBD-ADS-OFF:dom-v1'), 1);
const cachedOldHeader = headerFields(fs.readFileSync(cachedOld.asar));
check('and that asar header counts its JSON without the padding', cachedOldHeader.w3, Buffer.byteLength(cachedOldHeader.json));
check(
  'and exactly those bytes parse as the header',
  (() => {
    try {
      return !!JSON.parse(fs.readFileSync(cachedOld.asar).slice(16, 16 + cachedOldHeader.w3).toString('utf8'));
    } catch (e) {
    }
  })(),
  true
);

// A second run finds the same bytes and keeps the cached copy: the comparison
// has to be a read, not a rewrite on every invocation, and no temp file may be
// left behind by either path.
const engineBefore = fs.statSync(cachedOldEngine).mtimeMs;
const secondRun = startRun(cachedOld, 'install', '--no-restart');
check('a second run reuses the cached engine it just wrote', fs.statSync(cachedOldEngine).mtimeMs, engineBefore);
check('and leaves no temp engine behind', fs.readdirSync(cachedOldHome).filter((n) => n.includes('.new.')).length, 0);
check('and still patches', /applied/.test(secondRun.stdout));
check('and the old engine never ran as the patcher', /could not write/.test(cachedOldRun.stdout), false);

const failed = results.filter((r) => !r).length;
console.log('');
if (failed) {
  console.error(`${failed} of ${results.length} desktop checks failed`);
  process.exit(1);
}
console.log(`All ${results.length} desktop checks passed.`);
