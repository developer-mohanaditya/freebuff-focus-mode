/**
 * Freebuff CLI tool checks.
 *
 * The CLI blocker rewrites one expression inside a ~90 MB compiled binary, so
 * the checks that matter are the ones that decide whether it is safe to touch
 * that file at all:
 *
 *   - a binary with the current ads-hook call is patched, and only that range
 *     changes - same size, same bytes everywhere else,
 *   - a binary without the call, with the call twice, or with no `enabled:`
 *     in front of it is refused, and the file is left exactly as it was,
 *   - a patch whose result does not start is never installed,
 *   - running it twice does not stack a second patch,
 *   - `unfocus` restores the exact original bytes.
 *
 * The fixtures are small shell scripts that stand in for the compiled binary:
 * the ads-hook call lives in a comment, so the byte range the engine rewrites
 * is a real one, and `--version` is a real program the tool can run. The tool
 * is told about them with `--bin`, which is also the documented escape hatch
 * for a binary in an unusual place.
 *
 * Everything runs in a temp directory with the state directory redirected, so
 * the real ~/.config/manicode and the user's backups are never touched.
 *
 * Run with `npm run test:cli` (also part of `npm test`).
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'cli', 'freebuff-cli-focus.sh');

const ANCHOR = ',provider:"gravity",inline:!0,surface:"cli_chat",forceStart:'
const EXPR = '!iT&&(EA||!zT)'

const results = []

function ok(name, condition, detail) {
  if (condition) {
    results.push(true)
    console.log(`  ok    ${name}`)
    return true
  }
  results.push(false)
  console.log(`  FAIL  ${name}${detail === undefined ? '' : ` -> ${detail}`}`)
  return false
}

function eq(name, actual, expected) {
  return ok(name, actual === expected, `${JSON.stringify(actual)} (want ${JSON.stringify(expected)})`)
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fbd-cli-'))
const stateDir = path.join(work, 'state')

/**
 * A stand-in for the compiled CLI: a real program (`--version`) with the
 * ads-hook call in a comment, so the engine has a byte range to rewrite.
 */
function fixture(name, { body = '', version = '9.9.9' } = {}) {
  const file = path.join(work, name)
  const text = [
    '#!/bin/sh',
    '# Freebuff CLI fixture. The ads-hook call is in this comment:',
    `#   {..}=Ads({enabled:${EXPR},${ANCHOR.replace(/^,/, '')}EA,`,
    '#            inlinePlacementId:"Inline-After-Agent-CLI",slotPlacementId:"Above-Input-CLI"})',
    'case "${1:-}" in',
    '  --version)',
    body,
    `    printf '%s\\n' '${version}'`,
    '    exit 0',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n')
  fs.writeFileSync(file, text, { mode: 0o755 })
  fs.chmodSync(file, 0o755)
  return file
}

function run(args, { bin } = {}) {
  const argv = [TOOL]
  if (bin) argv.push('--bin', bin)
  argv.push(...args)
  const r = spawnSync('sh', argv, {
    encoding: 'utf8',
    env: {
      ...process.env,
      FREEBUFF_FOCUS_CLI_STATE: stateDir,
      FREEBUFF_FOCUS_NODE: process.execPath,
      XDG_DATA_HOME: path.join(work, 'xdg'),
    },
  })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const bytes = (file) => fs.readFileSync(file)
const tmpLeftovers = (dir) => fs.readdirSync(dir).filter((n) => n.includes('focus-tmp'))

console.log('Freebuff CLI tool')

// --- the tool itself -------------------------------------------------------

const syntax = spawnSync('sh', ['-n', TOOL], { encoding: 'utf8' })
eq('sh -n accepts the tool', syntax.status, 0)

const versionRun = run(['version'])
ok('version prints a version', /^\S+$/.test(versionRun.out.trim()), versionRun.out.trim())
eq('version exits 0', versionRun.code, 0)

// --- a pristine binary is patched -----------------------------------------

const pristine = fixture('freebuff')
const pristineBytes = bytes(pristine)
const pristineSha = sha(pristine)

const before = run(['verify'], { bin: pristine })
ok('verify says an unpatched binary has ads on', before.code !== 0 && /unpatched/.test(before.out), before.out.trim())

const statusBefore = run(['status'], { bin: pristine })
ok('status reports the version it found', /9\.9\.9/.test(statusBefore.out), statusBefore.out.trim())
ok('status says ads are on before the patch', /ads are on/.test(statusBefore.out), statusBefore.out.trim())

const focus = run(['focus'], { bin: pristine })
eq('focus exits 0', focus.code, 0)
ok('focus says the ads are off', /ads are off/.test(focus.out), focus.out.trim())
ok('focus reports the version it kept', /9\.9\.9/.test(focus.out), focus.out.trim())
ok('focus mentions the saved original', /original saved/.test(focus.out), focus.out.trim())

const patchedBytes = bytes(pristine)
eq('the binary keeps its size', patchedBytes.length, pristineBytes.length)

const patchedText = patchedBytes.toString('utf8')
ok('the ads switch is off in the binary', patchedText.includes('enabled:!1'), patchedText.slice(patchedText.indexOf('enabled:'), patchedText.indexOf('enabled:') + 24))
ok('the old expression is gone', !patchedText.includes(EXPR))
ok('the anchor after it is untouched', patchedText.includes(ANCHOR))

// Exactly one contiguous range may differ, and it must sit before the anchor.
let firstDiff = -1
let lastDiff = -1
let diffs = 0
for (let i = 0; i < pristineBytes.length; i += 1) {
  if (pristineBytes[i] !== patchedBytes[i]) {
    diffs += 1
    if (firstDiff < 0) firstDiff = i
    lastDiff = i
  }
}
const exprStart = pristineText().indexOf(`enabled:${EXPR}`) + 'enabled:'.length
function pristineText() {
  return pristineBytes.toString('utf8')
}
ok('every changed byte is inside the enabled: expression', firstDiff >= exprStart && lastDiff < exprStart + EXPR.length, `first ${firstDiff} last ${lastDiff} start ${exprStart}`)
ok('the change is small', diffs > 0 && diffs <= EXPR.length, diffs)

const backup = path.join(stateDir, 'freebuff-9.9.9.orig')
ok('the original is backed up', fs.existsSync(backup))
eq('the backup is the exact original', sha(backup), pristineSha)

const state = fs.readFileSync(path.join(stateDir, 'state.env'), 'utf8')
ok('the state file records the binary', state.includes(`BINARY=${pristine}`), state)
ok('the state file records the backup', state.includes(`BACKUP_FILE=${backup}`), state)

const ranPatched = run(['status'], { bin: pristine })
ok('the patched binary still runs', /9\.9\.9/.test(ranPatched.out), ranPatched.out.trim())

const verifyAfter = run(['verify'], { bin: pristine })
eq('verify exits 0 on a patched binary', verifyAfter.code, 0)
ok('verify says the hook is disabled', /ads hook disabled/.test(verifyAfter.out), verifyAfter.out.trim())

const statusAfter = run(['status'], { bin: pristine })
ok('status says ads are off', /ads are off/.test(statusAfter.out), statusAfter.out.trim())
ok('status names the saved original', /original kept at/.test(statusAfter.out), statusAfter.out.trim())

// --- running it again does not stack a second patch ------------------------

const mtime = fs.statSync(pristine).mtimeMs
const again = run(['focus'], { bin: pristine })
eq('a second focus exits 0', again.code, 0)
ok('a second focus says there is nothing to do', /already off/.test(again.out), again.out.trim())
eq('a second focus does not rewrite the binary', fs.statSync(pristine).mtimeMs, mtime)
eq('no temp file is left behind', tmpLeftovers(path.dirname(pristine)).length, 0)

// --- unfocus restores the original bytes ----------------------------------

const unfocus = run(['unfocus'], { bin: pristine })
eq('unfocus exits 0', unfocus.code, 0)
ok('unfocus says the ads are on again', /ads are on again/.test(unfocus.out), unfocus.out.trim())
eq('the binary is byte-identical to the original', sha(pristine), pristineSha)

const verifyRestored = run(['verify'], { bin: pristine })
ok('verify fails again after unfocus', verifyRestored.code !== 0, verifyRestored.out.trim())

// --- refusals leave the file alone ----------------------------------------

function refusal(name, text, needle) {
  const file = path.join(work, name)
  fs.writeFileSync(file, text, { mode: 0o755 })
  fs.chmodSync(file, 0o755)
  const beforeSha = sha(file)
  const edge = run(['focus'], { bin: file })
  ok(`${name}: focus refuses`, edge.code !== 0, edge.out.trim())
  ok(`${name}: the reason is named`, new RegExp(needle).test(edge.out), edge.out.trim())
  eq(`${name}: the file is untouched`, sha(file), beforeSha)
  eq(`${name}: no temp file is left behind`, tmpLeftovers(work).length, 0)
}

refusal(
  'no-anchor',
  ['#!/bin/sh', 'case "$1" in --version) echo 1.0.0;; esac', 'exit 0', ''].join('\n'),
  'no ads-hook call',
)

refusal(
  'two-anchors',
  [
    '#!/bin/sh',
    `# one: enabled:${EXPR},${ANCHOR}EA,`,
    `# two: enabled:${EXPR},${ANCHOR}EA,`,
    'case "$1" in --version) echo 1.0.0;; esac',
    'exit 0',
    '',
  ].join('\n'),
  'more than once',
)

refusal(
  'no-enabled',
  [
    '#!/bin/sh',
    `# {..}=Ads(${ANCHOR}EA, inlinePlacementId:"Inline-After-Agent-CLI")`,
    'case "$1" in --version) echo 1.0.0;; esac',
    'exit 0',
    '',
  ].join('\n'),
  'could not find the enabled',
)

// A patch that makes the binary refuse to start must never be installed. The
// fixture prints its version only while it is unpatched, so the patched copy
// fails exactly like a bundle that will not launch.
const breaks = path.join(work, 'breaks-on-patch')
fs.writeFileSync(
  breaks,
  [
    '#!/bin/sh',
    `# {..}=Ads({enabled:${EXPR},${ANCHOR}EA, inlinePlacementId:"Inline-After-Agent-CLI"})`,
    'case "${1:-}" in',
    '  --version)',
    "    if grep -q 'enabled:!1' \"$0\" 2>/dev/null; then exit 1; fi",
    "    printf '%s\\n' '1.0.0'",
    '    exit 0',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'),
  { mode: 0o755 },
)
fs.chmodSync(breaks, 0o755)
const breaksSha = sha(breaks)
const broken = run(['focus'], { bin: breaks })
ok('a patch that will not start is refused', broken.code !== 0, broken.out.trim())
ok('and the refusal says so', /did not start|does not run|instead of/.test(broken.out), broken.out.trim())
eq('the unstartable file is left untouched', sha(breaks), breaksSha)
eq('no temp file is left behind after the refusal', tmpLeftovers(work).length, 0)

// --- arguments and diagnostics --------------------------------------------

const missing = run(['focus'], { bin: path.join(work, 'nope') })
ok('a missing binary is reported', missing.code !== 0 && /no such file/.test(missing.out), missing.out.trim())

const equalsForm = run(['focus'], { bin: pristine })
eq('the tool can patch again after a restore', equalsForm.code, 0)

const doctor = run(['doctor'])
eq('doctor exits 0', doctor.code, 0)
ok('doctor names the launcher path', /launcher/.test(doctor.out), doctor.out.trim())
ok('doctor names the runtime it will use', /runtime/.test(doctor.out), doctor.out.trim())

const unknown = run(['nonsense'])
ok('an unknown command is refused', unknown.code !== 0 && /unknown command/.test(unknown.out), unknown.out.trim())

const help = run(['help'])
ok('help prints usage', /focus/.test(help.out) && /unfocus/.test(help.out), help.out.trim().slice(0, 80))

const failed = results.filter((r) => !r).length
console.log('')
if (failed) {
  console.error(`${failed} of ${results.length} CLI checks failed`)
  process.exit(1)
}
console.log(`All ${results.length} CLI checks passed.`)
