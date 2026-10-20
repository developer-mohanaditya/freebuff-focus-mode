/**
 * Windows desktop tool checks - the other half of `test-desktop.mjs`.
 *
 * The same safety properties, against the same fixture, through the PowerShell
 * tool instead of the shell one: a pristine bundle is recognised and patched, the
 * helpers that are NOT the ad path are left exactly as they were, a build whose
 * anchor count moved is refused rather than half-patched, a second run does not
 * stack a second patch, `revert` restores the exact original bytes, and `verify`
 * says nothing is proven while the app is closed but confirms it once a process
 * that started after the patch exists.
 *
 * Two things here are Windows-specific and get their own checks: the install
 * folder is discovered rather than hardcoded to /Applications, and a file the tool
 * cannot read as UTF-8, or a bundle path that is not a bundle, is refused with the
 * reason rather than with a stack trace.
 *
 * Everything runs against a throwaway install in a temp directory with the backup
 * directory redirected, so no real Freebuff install and no real backup folder is
 * ever touched. The only requirement is PowerShell (`pwsh`, or the Windows
 * PowerShell that ships with Windows); the suite skips itself, loudly, when there
 * is none.
 *
 * Run with `npm run test:windows` (also part of `npm test`).
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CURRENT, GATE, RENAMED, TWO_GATES, DECOY } from './desktop-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'desktop', 'freebuff-focus.ps1');
const TOOL_SOURCE = fs.readFileSync(TOOL, 'utf8');

/**
 * The tool as it is served: stamped. A piped install now puts the command on the
 * machine first and installs the copy it downloads, so the piped runs need a
 * version that compares as a real one.
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
const STAMPED_PS1 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fbd-win-stamped-')), 'freebuff-focus.ps1');
fs.writeFileSync(STAMPED_PS1, STAMPED_SOURCE);

/* ---------------------------------------------------------------------- pwsh */

/**
 * PowerShell, wherever it is. Windows PowerShell 5.1 is `powershell.exe` and is
 * already on Windows; `pwsh` is PowerShell 7 and is what a test host is likely to
 * have. Both run this script, so either is accepted.
 */
function findPowerShell() {
  const candidates = [
    process.env.FBD_PWSH,
    'pwsh',
    'pwsh.exe',
    'powershell',
    'powershell.exe',
    path.join(os.homedir(), '.local', 'pwsh', 'pwsh'),
    '/usr/local/bin/pwsh',
    '/opt/microsoft/powershell/7/pwsh',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8',
      timeout: 60000,
      env: powershellEnv(),
    });
    if (probe.status === 0) return candidate;
  }
  return null;
}

/**
 * A dotnet host with no ICU can still run PowerShell, but only in invariant
 * mode; setting it on a host that has ICU changes nothing. NO_COLOR keeps the
 * report identical to the text the checks read - the tool turns its colours off
 * for a redirected stream anyway, and this makes that explicit.
 */
function powershellEnv() {
  return {
    ...process.env,
    NO_COLOR: '1',
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1',
  };
}

const POWERSHELL = findPowerShell();

if (!POWERSHELL) {
  console.log('\nPowerShell (pwsh) is not installed - skipping the Windows desktop checks.');
  console.log('  install PowerShell 7 to run them: https://aka.ms/powershell-release?tag=stable');
  process.exit(0);
}

/* ------------------------------------------------------------------- harness */

const results = [];
const check = (name, actual, expected = true) => {
  const ok = actual === expected;
  results.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : ` -> ${JSON.stringify(actual)} (want ${JSON.stringify(expected)})`}`);
};

/**
 * A Freebuff install as Windows lays it out: the app folder with
 * `resources\orchestrator\orchestrator.js` inside it. No `.app`, no Info.plist -
 * that is the whole difference from the macOS fixture.
 */
/** A served copy beside the install, so setup and update never need the network. */
function makeOrigin(root, version = FIXTURE_VERSION) {
  const dir = path.join(root, 'origin');
  fs.mkdirSync(path.join(dir, 'downloads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'downloads', 'freebuff-focus-desktop.ps1'), served(version));
  return `file://${dir}`;
}

const served = (version) =>
  TOOL_SOURCE.replaceAll('__FBD_VERSION__', version).replaceAll('__FBD_ORIGIN__', 'https://focus.test');

function makeInstall(body = CURRENT, name = 'Freebuff') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fbd-win-'));
  const app = path.join(root, name);
  const orch = path.join(app, 'resources', 'orchestrator');
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
 * Where an install would land, per fixture. Without these, `setup` would put a
 * command in the real per-user app data of whatever machine runs this suite.
 */
function toolEnv(install, extra = {}) {
  return {
    ...powershellEnv(),
    FREEBUFF_FOCUS_HOME: install.home,
    FREEBUFF_FOCUS_BIN_DIR: install.bin,
    FREEBUFF_FOCUS_ORIGIN: install.origin,
    ...extra,
  };
}

const psArgs = (args) => ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', TOOL, ...args];

/** The three paths a fixture's install would use, from the app's location. */
const installPaths = (app) => {
  const root = path.dirname(app);
  return {
    home: path.join(root, 'focus-home'),
    bin: path.join(root, 'focus-bin'),
    origin: `file://${path.join(root, 'origin')}`,
  };
};

function run(app, backups, ...args) {
  return spawnSync(POWERSHELL, psArgs([...args, '-App', app, '-BackupDir', backups]), {
    encoding: 'utf8',
    env: toolEnv(installPaths(app)),
  });
}

/**
 * The piped form the help text, the README and the refusal message all tell
 * people to run: the script arrives as a string - not as a file, so no
 * mark-of-the-web and no execution policy - and the command follows the
 * scriptblock. If this shape breaks, the documented one-liner breaks with it.
 */
function runPiped(app, backups, ...args) {
  const all = [...args, '-App', app, '-BackupDir', backups];
  const quoted = all.map((arg) => (arg.includes(' ') ? `'${arg}'` : arg));
  const command = `$s = [Console]::In.ReadToEnd(); & ([scriptblock]::Create($s)) ${quoted.join(' ')}`;
  return spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8',
    env: toolEnv(installPaths(app)),
    input: STAMPED_SOURCE,
  });
}

const runStamped = (app, backups, ...args) =>
  spawnSync(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', STAMPED_PS1, ...args, '-App', app, '-BackupDir', backups], {
    encoding: 'utf8',
    env: toolEnv(installPaths(app)),
  });

/** The installed copy, run the way the .cmd launcher runs it: as a file. */
function runInstalled(install, ...args) {
  return spawnSync(
    POWERSHELL,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(install.home, 'freebuff-focus.ps1'), ...args],
    { encoding: 'utf8', env: toolEnv(install) }
  );
}

const count = (text, needle) => text.split(needle).length - 1;
const read = (file) => fs.readFileSync(file, 'utf8');
const both = (result) => `${result.stdout}${result.stderr}`;

/* ----------------------------------------------------------------- pristine */

console.log('\npristine 0.0.164 install');
const a = makeInstall();

const statusClean = run(a.app, a.backups, 'status');
check('status exits 0', statusClean.status, 0);
check('it reports both anchors', /render/.test(statusClean.stdout) && /request/.test(statusClean.stdout));
check('it says it is not patched yet', /Not patched yet/.test(statusClean.stdout));
check('it names the install folder it found', statusClean.stdout.includes(a.app));
check('status changes nothing', read(a.target) === CURRENT);

console.log('\nhelp and version');
check('help exits 0', run(a.app, a.backups, 'help').status, 0);
check('the help text documents verify', /verify\s+wait for Freebuff/.test(run(a.app, a.backups, 'help').stdout));
check('version prints the tool version', /^freebuff-focus-desktop \S+$/m.test(run(a.app, a.backups, 'version').stdout));

/* ------------------------------------------------------------------ install */

console.log('\ninstall');
const install = run(a.app, a.backups, 'install');
check('install exits 0', install.status, 0);
// The header names whose version it is printing. A fixture install has no exe
// version resource, so the value is "unknown" - the label is what is under test.
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
// Nothing to write means the run is worth only what it reports: the anchors in
// place, the session, the process state, and the commands left to use.
check('it lists the anchors already in place', /render\s+applied/.test(again.stdout) && /request\s+applied/.test(again.stdout));
check('it says there is no focus', /focus\s+none/.test(again.stdout));
check('it prints the commands the tool has', ['status', 'focus 25m', 'unfocus', 'verify', 'scan', 'revert', 'doctor', 'help'].every((c) => again.stdout.includes(c)));
check('a run from the file does not tell you to download it', /No local copy/.test(again.stdout), false);

const twice = read(a.target);
check('the render patch did not stack', count(twice, '/*FBD-ADS-OFF:render*/'), 1);
check('the request patch did not stack', count(twice, '/*FBD-ADS-OFF:request*/'), 1);
check('the file is byte-identical to the first patch', twice === patched);

console.log('\nstatus after install');
const statusPatched = run(a.app, a.backups, 'status');
check('status still exits 0', statusPatched.status, 0);
check('status confirms ads are off', /Ads are off/.test(statusPatched.stdout));

/* ------------------------------------------------------------------- revert */

console.log('\nrevert');
const revert = run(a.app, a.backups, 'revert');
check('revert exits 0', revert.status, 0);
check('the original bytes are restored', read(a.target) === CURRENT);

/* ------------------------------------------------------------ display-only */

console.log('\ndisplay-only');
const b = makeInstall();
run(b.app, b.backups, 'install', '-DisplayOnly');
const partial = read(b.target);
check('the render gate is applied', count(partial, '/*FBD-ADS-OFF:render*/'), 1);
check('the ad client is left alone', count(partial, '/*FBD-ADS-OFF:request*/'), 0);
check('and the ad client is still intact', partial.includes('async request(method, path27, payload, timeoutMs = REQUEST_TIMEOUT_MS) {'));

/* ---------------------------------------------------------------- fail-safe */

console.log('\ntwo gates, as 0.0.155 had');
const c = makeInstall(TWO_GATES);
const twoGates = run(c.app, c.backups, 'install');
check('install refuses', twoGates.status !== 0);
check('the render anchor reads as ambiguous', /render\s+ambiguous/.test(twoGates.stdout));
check('it says why, with the counts', /match\(es\)/.test(twoGates.stdout) && /trusted as written/.test(twoGates.stdout));
check('it points at the local scan', /freebuff-focus\.ps1 scan/.test(twoGates.stdout));
check('and at the piped scan', /freebuff-focus-desktop\.ps1/.test(twoGates.stdout));
check('the file is left untouched', read(c.target) === TWO_GATES);
check('no backup was taken', fs.existsSync(c.backups), false);

console.log('\nunknown file');
const d = makeInstall('export const something = 41; // a future orchestrator with renamed functions\n');
const refused = run(d.app, d.backups, 'install');
check('install refuses', refused.status !== 0);
check('it says why', /Refusing to patch|does not match/.test(refused.stdout));
check('the file is left untouched', read(d.target).includes('something = 41'));
check('no backup was taken', fs.existsSync(d.backups), false);

console.log('\na marker where the anchor cannot account for it');
// With one gate expected, a file carrying two render markers is a file the tool
// did not write and cannot reason about - it must refuse rather than add a third.
const doubledBody = `${CURRENT}\n/*FBD-ADS-OFF:render*/ /*FBD-ADS-OFF:render*/`;
const e = makeInstall(doubledBody);
const halfStatus = run(e.app, e.backups, 'status');
check('status refuses to call it patched', halfStatus.status !== 0);
check('it reports the anchor as broken', /render\s+broken/.test(halfStatus.stdout));
check('install refuses to stack on top of it', run(e.app, e.backups, 'install').status !== 0);
check('it left the file alone', read(e.target) === doubledBody);

console.log('\nan anchor that is simply gone');
// A build whose ad code moved away from every anchor left: nothing to patch, so
// the tool refuses and hands over the two ways to get the report that fixes it.
const goneBody = CURRENT.replace(GATE, 'if (false) return { ads: [] };');
const gone = makeInstall(goneBody);
const goneRun = run(gone.app, gone.backups, 'install');
check('install refuses', goneRun.status !== 0);
check('it reports the render anchor as not found', /render\s+not found/.test(goneRun.stdout));
check('it offers the piped scan', /scriptblock/.test(goneRun.stdout));
check('it left the file alone', read(gone.target) === goneBody);
check('no backup was taken', fs.existsSync(gone.backups), false);

/* ------------------------------------------------------------------- dry run */

console.log('\ndry run');
const f = makeInstall();
const dry = run(f.app, f.backups, 'install', '-DryRun');
check('dry run exits 0', dry.status, 0);
check('it writes nothing', read(f.target) === CURRENT);
check('it says so', /nothing was written/.test(dry.stdout));

/* ------------------------------------------------------------ renamed build */

console.log('\nrenamed build (the gate moved)');
const g = makeInstall(RENAMED);
const renamedInstall = run(g.app, g.backups, 'install');
check('install exits 0', renamedInstall.status, 0);
check('it says which anchor it matched', /via relaxed match/.test(renamedInstall.stdout));

const relaxed = read(g.target);
check('the renamed gate is neutralised', count(relaxed, '/*FBD-ADS-OFF:render*/'), 1);
check('the renamed gate text is gone', relaxed.includes('agenticTestCampaign(process.env)'), false);
check('the ad client is stubbed too', count(relaxed, '/*FBD-ADS-OFF:request*/'), 1);
run(g.app, g.backups, 'revert');
check('revert restores the renamed build exactly', read(g.target) === RENAMED);

/* -------------------------------------------------------------------- decoy */

console.log('\ndecoy gate far from ad code');
const h = makeInstall(DECOY);
const decoy = run(h.app, h.backups, 'install');
check('install refuses', decoy.status !== 0);
check('the render anchor reads as ambiguous', /render\s+ambiguous/.test(decoy.stdout));
check('the decoy file is untouched', read(h.target) === DECOY);
check('no backup was taken', fs.existsSync(h.backups), false);

/* --------------------------------------------------------------------- scan */

console.log('\nscan');
const i = makeInstall();
const scan = run(i.app, i.backups, 'scan');
check('scan exits 0', scan.status, 0);
check('scan changes nothing', read(i.target) === CURRENT);
check('scan names both strategies', /literal/.test(scan.stdout) && /relaxed/.test(scan.stdout));
check('scan marks the usable anchor', /<- usable/.test(scan.stdout));
check('scan says a trusted literal has no adjacency check', /trusted as written/.test(scan.stdout));
check('scan reports the probes', /== probes ==/.test(scan.stdout));
check('scan reports the encoding it read', /utf8-bom False/.test(scan.stdout));
check('scan saves the report to attach', read(path.join(i.backups, 'orchestrator-scan.unknown.txt')).includes('== render =='));

// The case-insensitive probe: this bundle has localAgenticTestCampaign, and a
// case-sensitive probe for agenticTestCampaign used to report 0 - which reads as
// "the ad runtime is gone" when it is right there.
const probeLine = scan.stdout.split('\n').find((line) => /^\s+agenticTestCampaign\s+\d+/.test(line)) || '';
check('the agenticTestCampaign probe finds the local variant', /\s[1-9]\d*$/.test(probeLine.trim()));

/* ------------------------------------------------------------- app discovery */

console.log('\napp discovery and argument handling');
// A Windows install under the per-user Programs folder, found without -App: the
// point of the port is that nobody has to know where their app went.
const discovered = makeInstall();
const found = run(discovered.app, discovered.backups, 'doctor');
check('doctor exits 0 on a real install', found.status, 0);
check('doctor names the app it found', found.stdout.includes(discovered.app));
check('doctor reports the bundle writable', /bundle is writable/.test(found.stdout));

const byFile = run(
  discovered.app,
  discovered.backups,
  'status',
  '-App',
  path.join(discovered.app, 'resources', 'orchestrator', 'orchestrator.js')
);
check('a path to orchestrator.js itself is accepted', byFile.status, 0);
check('and it resolves to the same install', byFile.stdout.includes(discovered.app));

const byResources = run(discovered.app, discovered.backups, 'status', '-App', path.join(discovered.app, 'resources'));
check('a path to the resources folder is accepted', byResources.status, 0);

const notAnInstall = path.join(discovered.root, 'not-freebuff');
fs.mkdirSync(notAnInstall, { recursive: true });
// Invoked directly, not through run(): run() appends its own -App, and the last
// one wins - which is the behaviour under test in the next check.
const wrongApp = spawnSync(
  POWERSHELL,
  psArgs(['status', `--app=${notAnInstall}`, '-BackupDir', discovered.backups]),
  { encoding: 'utf8', env: powershellEnv() }
);
check('an -App that is not an install is refused', wrongApp.status !== 0);
check('and says what was wrong', /not a Freebuff install folder/.test(both(wrongApp)));

const badFlag = run(discovered.app, discovered.backups, 'status', '-Nonsense');
check('an unknown flag is refused', badFlag.status !== 0);
check('and names it', /unknown argument: -Nonsense/.test(both(badFlag)));

/* --------------------------------------------------------------- encodings */

console.log('\na file this tool must not rewrite');
const utf16 = makeInstall();
fs.writeFileSync(utf16.target, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(CURRENT, 'utf16le')]));
const utf16Run = run(utf16.app, utf16.backups, 'install');
check('a UTF-16 bundle is refused', utf16Run.status !== 0);
check('it says why, rather than half-writing it', /UTF-16/.test(both(utf16Run)));
check('and the file is untouched', fs.readFileSync(utf16.target).subarray(0, 2).equals(Buffer.from([0xff, 0xfe])));

const bom = makeInstall('\uFEFF' + CURRENT);
const bomRun = run(bom.app, bom.backups, 'install');
check('a UTF-8 BOM is carried through, not stripped', bomRun.status === 0 && read(bom.target).startsWith('\uFEFF'));
check('and the patch still lands', count(read(bom.target), '/*FBD-ADS-OFF:render*/'), 1);

/* ------------------------------------------------------------- piped one-liner */

console.log('\nthe piped form');
const j = makeInstall();
const pipedScan = runPiped(j.app, j.backups, 'scan');
check('the scriptblock form exits 0', pipedScan.status, 0);
check('and prints the scan report', /== render ==/.test(pipedScan.stdout));
check('and names the tool version it is running', /anchor scan \(tool \S+\)/.test(pipedScan.stdout));

// The scan is the read-only half. The page's headline action is the piped
// *install*, and until this ran it was the one documented command the suite never
// exercised - the helper quietly dropped -App/-BackupDir, so anything it covered
// was really testing "no install found" rather than the path itself.
const pipedFixture = makeInstall();
const pipedInstall = runPiped(pipedFixture.app, pipedFixture.backups, 'install');
check('a piped install exits 0', pipedInstall.status, 0);
check('and patches the render gate', count(read(pipedFixture.target), '/*FBD-ADS-OFF:render*/'), 1);
check('and the ad client', count(read(pipedFixture.target), '/*FBD-ADS-OFF:request*/'), 1);
check('and leaves a backup', fs.existsSync(path.join(pipedFixture.backups, 'orchestrator.js.unknown.orig')));
check('a piped status agrees', /Ads are off/.test(runPiped(pipedFixture.app, pipedFixture.backups, 'status').stdout));
check(
  'a piped revert restores the original bytes',
  runPiped(pipedFixture.app, pipedFixture.backups, 'revert').status === 0 && read(pipedFixture.target) === CURRENT
);

const pipedUnknown = makeInstall('export const renamed = 1; // nothing the tool knows\n');
const pipedRefusal = runPiped(pipedUnknown.app, pipedUnknown.backups, 'install');
check('a piped refusal exits non-zero', pipedRefusal.status !== 0);
check('and offers the piped scan by URL', /freebuff-focus-desktop\.ps1/.test(pipedRefusal.stdout));
check('and wrote nothing', read(pipedUnknown.target), 'export const renamed = 1; // nothing the tool knows\n');

/* ------------------------------------------------------------------- verify */

/**
 * The relaunch check, which is the one thing `status` cannot say. It is decided by
 * two times rather than by anything on disk, so it has to be tested against a real
 * process: a copy of `sleep` named Freebuff.exe inside the fake install is exactly
 * the shape the Windows lookup looks for - a process named Freebuff* whose
 * executable lives in the install folder - without needing Freebuff.
 */
console.log('\nverify');

const v = makeInstall();

const beforeInstall = run(v.app, v.backups, 'verify', '-NoWait');
check('verify exits non-zero before the patch is applied', beforeInstall.status !== 0);
check('it says it is not patched yet', /Not patched yet/.test(beforeInstall.stdout));
check('it writes nothing', read(v.target) === CURRENT);

run(v.app, v.backups, 'install');
const patchedBytes = read(v.target);

const idle = run(v.app, v.backups, 'verify', '-NoWait');
check('verify exits non-zero with Freebuff closed', idle.status !== 0);
check('it reports both anchors applied', /render\s+applied/.test(idle.stdout) && /request\s+applied/.test(idle.stdout));
check('it says Freebuff is not open', /Freebuff is not open/.test(idle.stdout));
check('it points at running verify again', /freebuff-focus\.ps1 verify/.test(idle.stdout));
check('verify changes nothing in the bundle', read(v.target) === patchedBytes);

const noTimeout = run(v.app, v.backups, 'verify', '-NoWait', '-Timeout', 'soon');
check('a non-numeric -Timeout is refused', /needs a number of seconds/.test(both(noTimeout)));

const sleepBin = ['/bin/sleep', '/usr/bin/sleep'].find((candidate) => fs.existsSync(candidate));

function standIn(app) {
  const exe = path.join(app, 'Freebuff.exe');
  if (!fs.existsSync(exe)) {
    fs.copyFileSync(sleepBin, exe);
    fs.chmodSync(exe, 0o755);
  }
  const child = spawn(exe, ['30'], { stdio: 'ignore' });
  child.unref();
  return child;
}

function retire(child) {
  try {
    child.kill('SIGKILL');
  } catch {
    /* it has already gone */
  }
}

/**
 * The no-wait cases are decided by two times, so the fixture writes one of them
 * directly: a patch written a minute ago, or a minute from now. Sleeping through a
 * real minute would test the same comparison more slowly.
 */
const stampPatchTime = (target, seconds) => {
  const when = (Date.now() + seconds * 1000) / 1000;
  fs.utimesSync(target, when, when);
};

// The half that matters more: a process that started *before* the write is an app
// that has not been relaunched, and it must never be reported as verified.
console.log('\nverify, with an app that was already running');
const stale = makeInstall();
const already = standIn(stale.app);
await new Promise((resolve) => setTimeout(resolve, 500));
// -NoRestart is what pins this scenario: with the 1.7 default, install would
// restart the app it found, and there would be no stale process left to refuse.
run(stale.app, stale.backups, 'install', '-NoWait', '-NoRestart');
stampPatchTime(stale.target, 60);
const notYet = run(stale.app, stale.backups, 'verify', '-NoWait');
retire(already);

check('a process started before the patch is not verified', notYet.status !== 0);
check('it says the app has not been relaunched since', /has not been relaunched since/.test(notYet.stdout));
check('it reports the gap it measured', /before the patch/.test(notYet.stdout));
check('and the patch itself still went in', read(stale.target).includes('/*FBD-ADS-OFF:render*/'));

const live = standIn(v.app);
await new Promise((resolve) => setTimeout(resolve, 500));
stampPatchTime(v.target, -60);

const seen = run(v.app, v.backups, 'verify', '-NoWait');
retire(live);

check('verify exits 0 once a process started after the patch exists', seen.status, 0);
check('it names the pid it found', /pid \d+/.test(seen.stdout));
check('it reports the process as started after the patch', /after the patch/.test(seen.stdout));
check('it names the running app as the patched file', /running app is the patched file/.test(seen.stdout));
check('it reports the ad code still in the build', /still in this build: .*auction \d+/.test(seen.stdout));
check('it says what only the user can see', /only you can/.test(seen.stdout));

// The whole point of the command: started with the app closed, it has to sit on
// its own and finish when the app comes back, with no second command to run.
stampPatchTime(v.target, -60);
const waiting = spawn(POWERSHELL, psArgs(['verify', '-App', v.app, '-BackupDir', v.backups, '-Timeout', '20']), {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: powershellEnv(),
});
let waitOut = '';
waiting.stdout.on('data', (chunk) => {
  waitOut += chunk;
});

await new Promise((resolve) => setTimeout(resolve, 1500));
check('it waits while Freebuff is closed', /Waiting for Freebuff/.test(waitOut));

const arrived = standIn(v.app);
const waitedCode = await new Promise((resolve) => waiting.on('exit', resolve));
retire(arrived);

check('the wait ends by itself once the app comes back', waitedCode, 0);
check('and it reaches the same verdict', /running app is the patched file/.test(waitOut));
check('and it still wrote nothing', read(v.target) === patchedBytes);

console.log('\nthe wait is bounded');
const bounded = spawnSync(POWERSHELL, psArgs(['verify', '-App', v.app, '-BackupDir', v.backups, '-Timeout', '1']), {
  encoding: 'utf8',
  env: powershellEnv(),
  timeout: 60000,
});
check('a short -Timeout ends the wait with a refusal', bounded.status !== 0);
check('and says the patch itself is fine', /Stopped waiting/.test(bounded.stdout));

// Bounded is only half of it. The other half is that a person can stop the wait,
// and that stopping is PowerShell's own SIGINT handling rather than a
// CancelKeyPress handler - a script-block handler cannot run on the signal thread
// (no runspace) and kills the process with SIGABRT, and a compiled one cannot set
// the exit code either. So what is asserted here is what the tool can promise: the
// run ends as soon as the signal arrives instead of running to its timeout, it
// prints no verdict it did not reach, and it wrote nothing.
//
// The timeout is 30 rather than 300 so a run that ignored the signal fails on the
// 10-second bound below instead of holding the suite for five minutes.
console.log('\nthe wait can be stopped');
stampPatchTime(v.target, -60);
const stoppable = spawn(POWERSHELL, psArgs(['verify', '-App', v.app, '-BackupDir', v.backups, '-Timeout', '30']), {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: powershellEnv(),
});
let stopOut = '';
stoppable.stdout.on('data', (chunk) => {
  stopOut += chunk;
});

await new Promise((resolve) => setTimeout(resolve, 2500));
check('it is waiting before the signal', /Waiting for Freebuff/.test(stopOut));

const stopStart = Date.now();
stoppable.kill('SIGINT');
const stopElapsed = await new Promise((resolve) => {
  const guard = setTimeout(() => {
    stoppable.kill('SIGKILL');
    resolve(null);
  }, 20000);
  stoppable.on('exit', () => {
    clearTimeout(guard);
    resolve(Date.now() - stopStart);
  });
});

check('Ctrl-C ends the wait, it does not run on to the timeout', stopElapsed !== null && stopElapsed < 10000);
check('and no verdict is claimed it did not reach', !/running app is the patched file/.test(stopOut));
check('and the file it was checking is untouched', read(v.target) === patchedBytes);

/* ---------------------------------------------------- the message after it */

/**
 * The report is built out of coloured fragments, and a fragment is printed
 * without a newline - which is how "Open Freebuff.The patch takes effect on the
 * next launch." shipped once. Only a check on the finished text notices that, so
 * both tails of install are read here, closed app and open one.
 */
console.log('\nwhat install says afterwards');

const closedTail = makeInstall();
const closedRun = run(closedTail.app, closedTail.backups, 'install');
check('the closed-app heading is on its own line', /Open Freebuff\.\r?\nThe patch takes effect on the next launch/.test(closedRun.stdout));
check('and it points at verify', /freebuff-focus\.ps1 verify/.test(closedRun.stdout));
check('and at revert', /freebuff-focus\.ps1 revert/.test(closedRun.stdout));

const openTail = makeInstall();
const openProcess = standIn(openTail.app);
await new Promise((resolve) => setTimeout(resolve, 400));
const openRun = run(openTail.app, openTail.backups, 'install', '-NoWait', '-NoRestart');
retire(openProcess);

check(
  'the running-app heading is on its own line',
  /Freebuff is running\. Quit it completely and reopen it\.\r?\nThe orchestrator is read once at launch/.test(openRun.stdout)
);
check('a no-wait install does not sit on the relaunch', /Then check what it loaded/.test(openRun.stdout));
check('and the patch still went in', count(read(openTail.target), '/*FBD-ADS-OFF:request*/'), 1);

// The 1.7 default, on a host with no Freebuff.exe to start: it must still say
// that it is restarting, and must say so plainly when it cannot.
const restartTail = makeInstall();
const restartProcess = standIn(restartTail.app);
await new Promise((resolve) => setTimeout(resolve, 400));
const restartRun = run(restartTail.app, restartTail.backups, 'install', '-NoWait');
retire(restartProcess);

check('an open app is restarted by default', /Restarting Freebuff so the patch takes effect/.test(restartRun.stdout));
check(
  'and a restart it cannot do is admitted, not claimed',
  /restarted Freebuff/.test(restartRun.stdout) || /could not restart Freebuff/.test(restartRun.stdout)
);
check('and the patch still went in', count(read(restartTail.target), '/*FBD-ADS-OFF:request*/'), 1);

/* --------------------------------------------------------------- a big bundle */

/**
 * The real file is about 9 MB on one line. Nothing here reads the whole bundle
 * more often than it has to, and this is where that claim is measured rather than
 * assumed: a 9 MB fixture with the anchors in it, timed end to end.
 */
console.log('\na 9 MB bundle');
const bigBody = `${CURRENT}\nconst padding = "${'a'.repeat(9 * 1024 * 1024)}";\n`;
const big = makeInstall(bigBody);
const bigStarted = Date.now();
const bigInstall = run(big.app, big.backups, 'install');
const bigElapsed = Date.now() - bigStarted;

check('a 9 MB bundle installs', bigInstall.status, 0);
check('with the render anchor applied once', count(read(big.target), '/*FBD-ADS-OFF:render*/'), 1);
check('and the request anchor applied once', count(read(big.target), '/*FBD-ADS-OFF:request*/'), 1);
check('and the backup is the whole original', read(path.join(big.backups, 'orchestrator.js.unknown.orig')).length === bigBody.length);
check(`the install finishes in reasonable time (${bigElapsed} ms)`, bigElapsed < 60000);

/* ------------------------------------------------------- the installed command */

/**
 * What `irm | iex` leaves behind: a `freebuff-focusmode.cmd` launcher, the tool
 * beside it, and a way to replace or remove both. The launcher itself is a batch
 * file, so this host runs the installed .ps1 the way that batch file runs it and
 * reads the batch file to check it points at the right copy with `%*` after it.
 */
console.log('\nthe freebuff-focusmode command');

const cmdInstall = makeInstall();
const setup = runStamped(cmdInstall.app, cmdInstall.backups, 'setup');
const launcher = path.join(cmdInstall.bin, 'freebuff-focusmode.cmd');
check('setup exits 0', setup.status, 0);
check('it writes the launcher', fs.existsSync(launcher));
check('the launcher runs the installed copy', fs.existsSync(path.join(cmdInstall.home, 'freebuff-focus.ps1')));
check('and passes its arguments through', read(launcher).includes('%*'));
check('and says where both went', setup.stdout.includes(cmdInstall.home) && setup.stdout.includes(launcher));
check('and does not patch anything yet', read(cmdInstall.target) === CURRENT);
check('setup again is not an error', runStamped(cmdInstall.app, cmdInstall.backups, 'setup').status, 0);

const viaCommand = runInstalled(cmdInstall, 'version');
check('the installed copy runs', viaCommand.status, 0);
check('and reports the tool version', viaCommand.stdout.includes(`freebuff-focus-desktop ${FIXTURE_VERSION}`));
// -AddPath edits the user PATH, which is a Windows-only operation; on another
// host the tool has to admit it could not and leave the rest usable.
const added = runStamped(cmdInstall.app, cmdInstall.backups, 'setup', '-AddPath');
check('-AddPath exits 0 either way', added.status, 0);
check(
  'and either adds the folder or says it could not',
  /added .* to your user PATH/.test(added.stdout) || /could not update PATH/.test(added.stdout)
);

const freshInstall = makeInstall();
runStamped(freshInstall.app, freshInstall.backups, 'setup');
makeOrigin(freshInstall.root, NEXT_VERSION);
const updated = runInstalled(freshInstall, 'update', '-App', freshInstall.app, '-BackupDir', freshInstall.backups);
check('update exits 0', updated.status, 0);
check('it names both versions', updated.stdout.includes(`${FIXTURE_VERSION} -> ${NEXT_VERSION}`));
check('the installed copy is the new one', read(path.join(freshInstall.home, 'freebuff-focus.ps1')).includes(`$Version = '${NEXT_VERSION}'`));
check('the copy it replaced is kept', fs.existsSync(path.join(freshInstall.home, 'freebuff-focus.ps1.prev')));
// The patch step is the new copy's, with the paths this run was given.
check('and it patches with the new copy', count(read(freshInstall.target), '/*FBD-ADS-OFF:render*/'), 1);
check('and names the command once more at the end', /Run them as:\s+freebuff-focusmode/.test(updated.stdout));

const current = runInstalled(freshInstall, 'update');
check('a second update says it is already current', /already up to date/.test(current.stdout));
check('and exits 0', current.status, 0);

makeOrigin(freshInstall.root, '1.7.9');
const older = runInstalled(freshInstall, 'update');
check('an older served copy is refused', older.status !== 0);
check('and it says which way round they are', /older than the installed/.test(both(older)));
check('and the installed copy is untouched', read(path.join(freshInstall.home, 'freebuff-focus.ps1')).includes(`$Version = '${NEXT_VERSION}'`));

const removed = runInstalled(freshInstall, 'uninstall');
check('uninstall exits 0', removed.status, 0);
check('it removes the launcher', fs.existsSync(path.join(freshInstall.bin, 'freebuff-focusmode.cmd')), false);
check('and the installed copy', fs.existsSync(path.join(freshInstall.home, 'freebuff-focus.ps1')), false);
check('and says the patch is still applied', /patch is still applied/.test(removed.stdout));
check('and the patch really is still applied', count(read(freshInstall.target), '/*FBD-ADS-OFF:render*/'), 1);

/* ---------------------------------------------------- the shipped artifact */

/**
 * Everything above tests the source. This tests the file people actually
 * download: stamped with a version and an origin, carrying the same anchors. A
 * shipped copy that lags the source is the failure this catches - it is built by
 * `npm run build`, so a missing or stale one is a build away.
 */
console.log('\nthe stamped artifact in site/downloads');
const STAMPED = path.join(ROOT, 'site', 'downloads', 'freebuff-focus-desktop.ps1');

if (!fs.existsSync(STAMPED)) {
  console.log('  (not built yet - skipping; run npm run build)');
} else {
  const stampedSource = read(STAMPED);
  const k = makeInstall();
  const shipped = spawnSync(
    POWERSHELL,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', STAMPED, 'install', '-App', k.app, '-BackupDir', k.backups],
    { encoding: 'utf8', env: powershellEnv() }
  );

  check('it is stamped, not shipped with placeholders', /__FBD_(VERSION|ORIGIN)__/.test(stampedSource), false);
  check('the shipped copy installs on a 0.0.164-shaped build', shipped.status, 0);
  check('it applies the render anchor once', count(read(k.target), '/*FBD-ADS-OFF:render*/'), 1);
  check('it applies the request anchor once', count(read(k.target), '/*FBD-ADS-OFF:request*/'), 1);
  check('it leaves the logs shipper alone', read(k.target).includes('api/logs'));

  // The origin is composed at runtime from the stamped origin, so the only way to
  // check the hint is to make the shipped copy refuse and read what it says.
  const k2 = makeInstall(TWO_GATES);
  const shippedRefusal = spawnSync(
    POWERSHELL,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', STAMPED, 'install', '-App', k2.app, '-BackupDir', k2.backups],
    { encoding: 'utf8', env: powershellEnv() }
  );

  check('it refuses when the anchor count moved', shippedRefusal.status !== 0);
  check('and prints the counts it saw', /match\(es\)/.test(shippedRefusal.stdout));
  check(
    'and a scan command naming the real origin',
    /irm https:\/\/\S+\/downloads\/freebuff-focus-desktop\.ps1/.test(shippedRefusal.stdout)
  );
  check('and leaves that build untouched', read(k2.target) === TWO_GATES);
}

/* --------------------------------------------------------------- focus */

/*
The three focus modes, and the watcher that ends two of them.

`focus` on its own must promise nothing but `unfocus`. A timed focus leaves one
hidden PowerShell watcher and restores the file when the deadline passes; a
session focus leaves one waiting on the orchestrator process. The deadline half is
checked end to end here - it starts the real watcher, with the real argument
passing, and waits for the file to come back. The session half needs a process
whose command line ends with orchestrator.js, which this suite cannot fabricate
portably, so it is checked for the state it records and the message it prints.
*/

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sessionKeys = (file) =>
  Object.fromEntries(read(file).trim().split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

console.log('\nfocus: until you end it');
const focusTree = makeInstall();
const sessionDir = path.join(focusTree.root, 'session-state');
const sessionFile = path.join(sessionDir, 'session');
const sessionLog = path.join(sessionDir, 'session.log');

const focused = run(focusTree.app, focusTree.backups, 'focus', '-SessionDir', sessionDir);
check('focus with no duration exits 0', focused.status, 0);
check('it names no deadline', /Ads stay off until you end it/.test(focused.stdout));
check('the patch went in', count(read(focusTree.target), '/*FBD-ADS-OFF:render*/'), 1);
check('a session file is written', fs.existsSync(sessionFile));
check('the mode is until-unfocus', sessionKeys(sessionFile).mode, 'until-unfocus');
check('there is no end time', 'endsAt' in sessionKeys(sessionFile), false);
check('and nothing is left running', fs.existsSync(sessionLog), false);

const withSession = run(focusTree.app, focusTree.backups, 'status', '-SessionDir', sessionDir);
check('status says only unfocus ends it', /focus\s+on - until you run/.test(withSession.stdout));

const unfocused = run(focusTree.app, focusTree.backups, 'unfocus', '-SessionDir', sessionDir);
check('unfocus exits 0', unfocused.status, 0);
check('it restores the original bytes', read(focusTree.target) === CURRENT);
check('it clears the session file', fs.existsSync(sessionFile), false);
check('and says so', /focus\s+cleared/.test(unfocused.stdout));

const badDuration = run(focusTree.app, focusTree.backups, 'focus', 'soon', '-SessionDir', sessionDir);
check('a duration that is not a duration is refused', badDuration.status !== 0);
check('and it says what one looks like', /duration like 25m/.test(`${badDuration.stdout}${badDuration.stderr}`));
check('and nothing is patched', read(focusTree.target) === CURRENT);

console.log('\nfocus 5s: restored at the deadline');
const timedTree = makeInstall();
const timedDir = path.join(timedTree.root, 'session-state');
const timedFile = path.join(timedDir, 'session');
const timedLog = path.join(timedDir, 'session.log');
run(timedTree.app, timedTree.backups, 'install', '-SessionDir', timedDir, '-NoWait');
const timed = run(timedTree.app, timedTree.backups, 'focus', '5s', '-SessionDir', timedDir);
check('a timed focus exits 0', timed.status, 0);
check('it names the time it ends', /Focus until \d\d:\d\d/.test(timed.stdout));
check('the mode is until', sessionKeys(timedFile).mode, 'until');
check('it carries an end time', /^endsAt=\d+$/m.test(read(timedFile)));
check('a watcher records its own pid', Number(sessionKeys(timedFile).watcher) > 0);
check('and the file it wrote', /^\d+:\d+$/.test(sessionKeys(timedFile).stamp));

await wait(7000);
check('the deadline restores the original bytes', read(timedTree.target) === CURRENT);
check('and the session file goes with it', fs.existsSync(timedFile), false);
check('the log says why', /the deadline passed - restored/.test(read(timedLog)));

console.log('\nfocus session: what it records');
const sessTree = makeInstall();
const sessDir = path.join(sessTree.root, 'session-state');
const sessFile = path.join(sessDir, 'session');
run(sessTree.app, sessTree.backups, 'install', '-SessionDir', sessDir, '-NoWait');
const sess = run(sessTree.app, sessTree.backups, 'focus', 'session', '-SessionDir', sessDir);
check('session focus exits 0', sess.status, 0);
check('it says the ads come back when Freebuff quits', /Ads come back when you quit Freebuff/.test(sess.stdout));
check('the mode is session', sessionKeys(sessFile).mode, 'session');
check('it watches nothing yet, because no app is running', 'pid' in sessionKeys(sessFile), false);
check('a watcher records its own pid', Number(sessionKeys(sessFile).watcher) > 0);
const sessStatus = run(sessTree.app, sessTree.backups, 'status', '-SessionDir', sessDir);
check('status says it is waiting for the app', /until Freebuff quits \(waiting for it to open\)/.test(sessStatus.stdout));

// unfocus has to take the watcher with it, or the session outlives the command.
const sessWatcher = Number(sessionKeys(sessFile).watcher);
run(sessTree.app, sessTree.backups, 'unfocus', '-SessionDir', sessDir);
await wait(800);
const watcherAlive = (() => {
  try { process.kill(sessWatcher, 0); return true; } catch { return false; }
})();
check('unfocus stops the watcher', watcherAlive, false);
check('and clears the session file', fs.existsSync(sessFile), false);
check('and restores the original bytes', read(sessTree.target) === CURRENT);

const failed = results.filter((r) => !r).length;
console.log('');
if (failed) {
  console.error(`${failed} of ${results.length} Windows desktop checks failed`);
  process.exit(1);
}
console.log(`All ${results.length} Windows desktop checks passed.`);
