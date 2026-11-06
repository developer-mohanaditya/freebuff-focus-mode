#!/bin/sh
# freebuff-cli-focus - turn the ads off in the Freebuff CLI.
#
# Freebuff's terminal client ships ads as text cards: one or two after an
# agent's answer, and one docked above the input. Unlike the desktop app, the
# CLI is not a JavaScript bundle we can edit at leisure - it is a single
# compiled binary (~90 MB on macOS arm64) with the client's JavaScript stored
# inside it as plain text. The ad card, the dock and the impression/click
# reporting all hang off one call that starts the ads hook:
#
#   {..}=ApA({enabled:!iT&&(EA||!zT),provider:"gravity",inline:!0,
#             surface:"cli_chat",forceStart:EA,
#             inlinePlacementId:"Inline-After-Agent-CLI",
#             slotPlacementId:"Above-Input-CLI",..})
#
# and the hook itself is `{ let A = T?.enabled ?? !0; .. return !T.enabled || .. }`.
# With `enabled` false the hook returns "not eligible" immediately: no slot
# fetch, no inline request, no impression, no dock. So the patch is to replace
# just that one expression with `!1`, padded with spaces to the same length -
# the file keeps its size, so nothing that refers to offsets inside it moves.
#
# The minified names around it (iT/EA/zT, iH/CA/RH) differ between builds, so
# the tool never matches them. It anchors on the stable part of the call
# (`provider:"gravity", inline:!0, surface:"cli_chat"`), walks back to the
# `enabled:` that starts the options object, and rewrites only that range.
#
# Safety, in the order it matters:
#   * The new binary is built as a temp file next to the real one (so the
#     tree-sitter.wasm beside it is still found), re-signed on macOS, and run
#     for `--version` BEFORE it replaces anything. A patch that does not start
#     never becomes the installed CLI.
#   * The original bytes are copied to the state directory first, and
#     `unfocus` puts them back - an exact copy, which also restores the code
#     signature exactly.
#   * Every failure leaves the original file in place and says so.
#
# Commands, the same shape as the desktop tool:
#   install   put the command on PATH, then turn the ads off
#   focus     turn the ads off (patch the CLI binary in place)
#   focus 25m turn them off for 25 minutes, then put the original back
#   unfocus   put the original binary back, and stop a timed focus
#   status    is this install patched, and is a backup available?
#   verify    check the binary on disk against the patch, without changing it
#   scan      report what this build contains, read-only
#   doctor    explain where the binary is and what the tool would do
#   update    fetch a newer tool, replace this copy, patch again
#   uninstall remove the command and the installed copy, leave the patch
#   version   print the tool version
#   help      this text
#
# Options:
#   --bin <path>        the CLI binary to patch (default: auto-detect)
#   --backup-dir <dir>  where the original bytes are kept
#   --add-path          install: append the bin folder to your shell rc
#   --force             update: reinstall even when the version matches
#
# Environment:
#   FREEBUFF_FOCUS_CLI_BIN      same as --bin
#   FREEBUFF_FOCUS_CLI_STATE    same as --backup-dir
#   FREEBUFF_FOCUS_CLI_HOME     where the installed copy lives
#   FREEBUFF_FOCUS_BIN_DIR      where the command is written
#   FREEBUFF_FOCUS_ORIGIN       the site update and install fetch from
#   FREEBUFF_FOCUS_NODE         the node (or bun) used to run the patch engine
#
# macOS, Linux. The CLI itself is a Bun single-file binary, so the same bytes
# exist on every platform; only the signing step differs.

set -eu

VERSION="__FBD_VERSION__"
ORIGIN="${FREEBUFF_FOCUS_ORIGIN:-__FBD_ORIGIN__}"
PROG="freebuff-cli-focus"

# Whether this run has the script on disk. `curl | sh` does not, so an install
# that needs the bytes again has to fetch them rather than copy itself.
HAVE_LOCAL=0
if [ -f "${0:-}" ]; then HAVE_LOCAL=1; fi

# The installed copy and the command that runs it. The install folder doubles as
# the state folder: one small directory, two files, nothing to clean up twice.
INSTALL_DIR="${FREEBUFF_FOCUS_CLI_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/freebuff-focus/cli}"
BIN_DIR="${FREEBUFF_FOCUS_BIN_DIR:-$HOME/.local/bin}"
COMMAND_NAME="$PROG"
INSTALLED_SELF="$INSTALL_DIR/freebuff-cli-focus.sh"

CLI_BIN="${FREEBUFF_FOCUS_CLI_BIN:-}"
BACKUP_DIR="${FREEBUFF_FOCUS_CLI_STATE:-}"

# setup --add-path: append the bin folder to the shell rc instead of printing the
# line for the reader to paste. Opt-in, because it edits a dotfile.
ADD_PATH=0
# update --force: reinstall even when the version already matches.
FORCE=0
DURATION=""

# The stable part of the ads-hook call. Everything the tool needs hangs off it.
ANCHOR=',provider:"gravity",inline:!0,surface:"cli_chat",forceStart:'
# How far back the `enabled:` that starts the same options object can sit. The
# real distance is under 40 bytes on every build seen; this is loose enough for
# a renamed variable and tight enough to fail on a coincidence.
BACK_LOOK=200

warn() { printf '%s: %s\n' "$PROG" "$*" >&2; }
die() { warn "$*"; exit 1; }
say() { printf '%s\n' "$*"; }
ok() { printf '  ok  %s\n' "$*"; }
bad() { printf '  no  %s\n' "$*"; }

usage() {
  cat <<'USAGE'
freebuff-cli-focus - turn the ads off in the Freebuff CLI

Usage:
  freebuff-cli-focus install       put the command on PATH, then patch the CLI
  freebuff-cli-focus [focus]       patch the CLI binary, verify it starts
  freebuff-cli-focus focus 25m     patch it for 25 minutes, then restore
  freebuff-cli-focus unfocus       put the original binary back
  freebuff-cli-focus status        is this install patched?
  freebuff-cli-focus verify        check the binary without changing it
  freebuff-cli-focus scan          report what this build contains, read-only
  freebuff-cli-focus doctor        where is the binary, what would happen
  freebuff-cli-focus update        fetch a newer tool, replace this copy
  freebuff-cli-focus uninstall     remove the command, leave the patch alone
  freebuff-cli-focus version       print the tool version
  freebuff-cli-focus help          this text

Options:
  --bin <path>        the CLI binary to patch (default: auto-detect)
  --backup-dir <dir>  where the original bytes are kept
  --add-path          install: append the bin folder to your shell rc
  --force             update: reinstall even when the version matches

The binary defaults to the one the npm launcher runs
(~/.config/manicode/freebuff). Pass --bin if Freebuff lives somewhere else.
The original is kept in the backup directory, so `unfocus` can restore it
exactly; ads come back only when you ask for them.

A timed focus starts one detached watcher that puts the original bytes back
when the deadline passes. `unfocus` stops it. A Freebuff CLI update replaces
the binary, which makes a pending watcher stand down instead of overwriting
the new build.
USAGE
  exit 0
}

# --- options and the command ------------------------------------------------
#
# Options are accepted on either side of the command: `install --bin x` and
# `--bin x install` both work. That matters because `install` and `update`
# re-run this tool on its own copy with flags of their own, and a reader who
# types the option after the command should not be told it is unrecognised.

CMD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bin)
      [ $# -ge 2 ] || die "--bin needs a path"
      CLI_BIN="$2"
      shift 2
      ;;
    --bin=*)
      CLI_BIN="${1#--bin=}"
      shift
      ;;
    --backup-dir)
      [ $# -ge 2 ] || die "--backup-dir needs a dir"
      BACKUP_DIR="$2"
      shift 2
      ;;
    --backup-dir=*)
      BACKUP_DIR="${1#--backup-dir=}"
      shift
      ;;
    --add-path)
      ADD_PATH=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    -h | --help)
      CMD="help"
      shift
      ;;
    --version)
      CMD="version"
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      die "unknown option: $1 (try: $PROG help)"
      ;;
    *)
      if [ -z "$CMD" ]; then
        CMD="$1"
        shift
      elif [ -z "$DURATION" ] && [ "$CMD" = "focus" ]; then
        # A bare duration after `focus` is the timed form.
        DURATION="$1"
        shift
      else
        die "unexpected argument: $1 (try: $PROG help)"
      fi
      ;;
  esac
done

# With no command at all this is the one-liner: `curl ... | sh` installs.
CMD="${CMD:-install}"

case "$CMD" in
  install | setup | focus | unfocus | status | verify | scan | doctor | update | uninstall) ;;
  help) usage ;;
  version) say "$VERSION"; exit 0 ;;
  *) die "unknown command: $CMD (try: $PROG help)" ;;
esac

# --- state -----------------------------------------------------------------

state_dir() {
  if [ -n "$BACKUP_DIR" ]; then
    printf '%s\n' "$BACKUP_DIR"
    return 0
  fi
  if [ -n "${XDG_DATA_HOME:-}" ]; then
    printf '%s/freebuff-focus/cli\n' "$XDG_DATA_HOME"
  else
    printf '%s/.local/share/freebuff-focus/cli\n' "$HOME"
  fi
}

STATE_DIR="$(state_dir)"
STATE_FILE="$STATE_DIR/state.env"
WATCH_PID_FILE="$STATE_DIR/watch.pid"
SESSION_LOG="$STATE_DIR/session.log"

node_bin() {
  if [ -n "${FREEBUFF_FOCUS_NODE:-}" ]; then
    printf '%s\n' "$FREEBUFF_FOCUS_NODE"
    return 0
  fi
  for candidate in node bun; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

# The first four bytes decide what we are looking at. The npm launcher is a
# `#!` node script that downloads and then runs the real binary, so patching the
# thing on PATH would patch the wrong file.
file_kind() {
  if [ ! -f "$1" ]; then
    printf 'missing\n'
    return 0
  fi
  magic="$(od -An -tx1 -N4 "$1" 2>/dev/null | tr -d ' \n')"
  case "$magic" in
    7f454c46) printf 'elf\n' ;;
    cffaedfe | cefaedfe | feedfacf | cafebabe) printf 'macho\n' ;;
    4d5a*) printf 'pe\n' ;;
    2321*) printf 'script\n' ;;
    *) printf 'other\n' ;;
  esac
}

launcher_config_dir() {
  if [ -n "${CODEBUFF_CONFIG_DIR:-}" ]; then
    printf '%s\n' "$CODEBUFF_CONFIG_DIR"
  elif [ -n "${FREEBUFF_CONFIG_DIR:-}" ]; then
    printf '%s\n' "$FREEBUFF_CONFIG_DIR"
  else
    printf '%s/.config/manicode\n' "$HOME"
  fi
}

# Where the launcher keeps the binary it downloaded and runs. This is the file
# to patch; the launcher only checks that it exists before starting it, and
# verifies checksums on fresh downloads only, so a patch survives restarts.
default_binary() {
  dir="$(launcher_config_dir)"
  for name in freebuff freebuff.exe; do
    if [ -f "$dir/$name" ]; then
      printf '%s\n' "$dir/$name"
      return 0
    fi
  done
  on_path="$(command -v freebuff 2>/dev/null || true)"
  if [ -n "$on_path" ]; then
    kind="$(file_kind "$on_path")"
    case "$kind" in
      macho | elf) printf '%s\n' "$on_path"; return 0 ;;
    esac
  fi
  return 1
}

# Follow symlinks to the file itself. A Homebrew or /usr/local/bin entry is
# usually a link to the real binary; replacing the link would leave a plain file
# where a package manager expects its link, so the patch always lands on the
# target and the link keeps pointing at it.
real_path() {
  p="$1"
  hops=0
  while [ -L "$p" ] && [ "$hops" -lt 20 ]; do
    link_dir="$(dirname "$p")"
    link_target="$(readlink "$p")"
    case "$link_target" in
      /*) p="$link_target" ;;
      *) p="$link_dir/$link_target" ;;
    esac
    hops=$((hops + 1))
  done
  if [ -d "$(dirname "$p")" ]; then
    p="$(cd "$(dirname "$p")" && pwd -P)/$(basename "$p")"
  fi
  printf '%s\n' "$p"
}

resolve_binary() {
  if [ -n "$CLI_BIN" ]; then
    if [ ! -f "$CLI_BIN" ]; then
      die "no such file: $CLI_BIN"
    fi
    real_path "$CLI_BIN"
    return 0
  fi
  if path="$(default_binary)"; then
    real_path "$path"
    return 0
  fi
  die "could not find the Freebuff CLI binary - pass --bin <path> (see: $PROG doctor)"
}

# --- the installed copy ----------------------------------------------------

path_has_bin() {
  case ":${PATH:-}:" in *":$BIN_DIR:"*) return 0 ;; esac
  return 1
}

# The rc file the login shell actually reads. zsh is the macOS default and bash
# the Linux one; anything else gets .profile, which every POSIX shell reads.
shell_rc() {
  case "${SHELL:-}" in
    */zsh) printf '%s' "${ZDOTDIR:-$HOME}/.zshrc" ;;
    */bash) printf '%s' "$HOME/.bashrc" ;;
    *) printf '%s' "$HOME/.profile" ;;
  esac
}

# Append the bin folder once, behind a marker, so a second run cannot double it.
add_to_path() {
  rc="$(shell_rc)"
  marker='# freebuff-cli-focus PATH'
  grep -qF "$marker" "$rc" 2>/dev/null && return 0
  {
    printf '\n%s\n' "$marker"
    printf 'export PATH="%s:$PATH"\n' "$BIN_DIR"
  } >>"$rc" 2>/dev/null || return 1
  say "  path      added $BIN_DIR to $rc"
  return 0
}

# The version a copy of this tool records. Empty means it is not this tool.
version_of() {
  sed -n 's/^VERSION="\(.*\)"$/\1/p' "$1" 2>/dev/null | head -n 1
}

# True when the first version is strictly newer than the second, dotted numbers
# compared one field at a time. Used to refuse a downgrade: the site is the
# authority on what is current, but it must never hand back something older than
# what is already on disk and call it an update.
version_newer() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    n = split(a, x, "."); m = split(b, y, ".")
    for (i = 1; i <= (n > m ? n : m); i++) {
      if ((x[i] + 0) > (y[i] + 0)) exit 0
      if ((x[i] + 0) < (y[i] + 0)) exit 1
    }
    exit 1
  }'
}

# How a hint names this tool: the installed command when it exists, the local file
# otherwise. Someone who ran the one-liner should be told to use what it created.
cmdname() {
  if [ -x "$BIN_DIR/$COMMAND_NAME" ]; then printf '%s' "$COMMAND_NAME"
  else printf '%s' "sh freebuff-cli-focus.sh"
  fi
}

# --- engine ----------------------------------------------------------------
#
# Runs with node or bun, whichever the machine has (the launcher is a node
# program, so node is normally there). Reads the binary, finds the anchor, and
# either reports what it found or writes the patched copy to the path it is
# given. Same-length replacement: the output is the input with one expression
# overwritten, never a rebuilt file.

engine_path() {
  engine="$STATE_DIR/patch-engine.cjs"
  if [ -f "$engine" ] && [ "$engine_written" = "1" ]; then
    printf '%s\n' "$engine"
    return 0
  fi
  mkdir -p "$STATE_DIR"
  cat >"$engine.new.$$" <<'FBD_CLI_ENGINE'
const fs = require('fs')

const ANCHOR = ',provider:"gravity",inline:!0,surface:"cli_chat",forceStart:'
const BACK_LOOK = 200

function fail(message) {
  process.stdout.write('RESULT=error\n')
  process.stdout.write(`NOTE=${message.replace(/\n/g, ' ')}\n`)
  process.exit(0)
}

function main() {
  const mode = process.argv[2]
  const file = process.argv[3]
  const out = process.argv[4]

  let buf
  try {
    buf = fs.readFileSync(file)
  } catch (error) {
    return fail(`cannot read ${file}: ${error.message}`)
  }

  const anchor = Buffer.from(ANCHOR, 'utf8')
  const at = buf.indexOf(anchor)
  if (at < 0) {
    return fail('this build has no ads-hook call to patch')
  }
  if (buf.indexOf(anchor, at + 1) >= 0) {
    return fail('the ads-hook call appears more than once in this build')
  }

  const floor = Math.max(0, at - BACK_LOOK)
  const enabledAt = buf.lastIndexOf(Buffer.from('enabled:', 'utf8'), at)
  if (enabledAt < floor) {
    return fail('could not find the enabled: switch in front of the ads-hook call')
  }

  const exprStart = enabledAt + 'enabled:'.length
  const exprLength = at - exprStart
  if (exprLength < 2) {
    return fail(`the enabled: expression is only ${exprLength} bytes - refusing to guess`)
  }

  const current = buf.subarray(exprStart, at).toString('utf8')
  const replacement = '!1' + ' '.repeat(exprLength - 2)
  const patched = current === replacement

  process.stdout.write(`RESULT=${patched ? 'already' : 'patch'}\n`)
  process.stdout.write(`OFFSET=${exprStart}\n`)
  process.stdout.write(`EXPR=${JSON.stringify(current)}\n`)
  process.stdout.write(`SIZE=${buf.length}\n`)

  if (mode !== 'apply' || patched) return

  const copy = Buffer.from(buf)
  copy.write(replacement, exprStart, 'utf8')
  if (copy.length !== buf.length) return fail('the patched copy changed size')

  let mode0 = 0o755
  try {
    mode0 = fs.statSync(file).mode & 0o777
  } catch {}

  try {
    fs.writeFileSync(out, copy, { mode: mode0 })
    fs.chmodSync(out, mode0)
  } catch (error) {
    return fail(`cannot write ${out}: ${error.message}`)
  }

  process.stdout.write('WROTE=1\n')
}

main()
FBD_CLI_ENGINE
  mv -f "$engine.new.$$" "$engine" || {
    rm -f "$engine.new.$$"
    return 1
  }
  engine_written=1
  printf '%s\n' "$engine"
}

engine_written=0

run_engine() {
  # $1 = check|apply, $2 = binary, $3 = output path (apply only)
  engine="$(engine_path)" || die "could not write the patch engine into $STATE_DIR"
  node="$(node_bin)" || die "need node or bun to patch the CLI (the npm launcher needs node too)"

  if [ "$1" = "apply" ]; then
    "$node" "$engine" apply "$2" "$3"
  else
    "$node" "$engine" check "$2"
  fi
}

field() {
  # $1 = engine output, $2 = key
  printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -n 1
}

cli_version() {
  # The version the binary reports, or nothing if it will not run.
  "$1" --version 2>/dev/null | tr -d '\r' | head -n 1
}

sign_binary() {
  # Ad-hoc signing, as the release itself is signed. On arm64 macOS a modified
  # executable without a valid signature is killed at launch, so this is not
  # optional there. Entitlements are preserved: the binary's JIT needs them.
  if [ "$(uname -s)" != "Darwin" ]; then
    return 0
  fi
  command -v codesign >/dev/null 2>&1 || {
    warn "codesign is not available - a modified arm64 binary will not start"
    return 1
  }
  if codesign --force --sign - --preserve-metadata=entitlements,flags "$1" >/dev/null 2>&1; then
    return 0
  fi
  codesign --force --sign - "$1" >/dev/null 2>&1
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    printf 'unknown\n'
  fi
}

backup_path_for() {
  # $1 = binary, $2 = version tag
  printf '%s/freebuff-%s.orig\n' "$STATE_DIR" "${2:-unknown}"
}

# --- timed focus -----------------------------------------------------------

# 25m, 90s, 2h, or a bare number of minutes. Nothing shorter than a second and
# nothing longer than thirty days, so a typo cannot pin the tool open.
duration_seconds() {
  d="$1"
  case "$d" in
    *s) n="${d%s}"; mult=1 ;;
    *m) n="${d%m}"; mult=60 ;;
    *h) n="${d%h}"; mult=3600 ;;
    *[0-9]) n="$d"; mult=60 ;;
    *) return 1 ;;
  esac
  case "$n" in '' | *[!0-9]*) return 1 ;; esac
  [ "$n" -gt 0 ] || return 1
  total=$((n * mult))
  [ "$total" -ge 1 ] && [ "$total" -le 2592000 ] || return 1
  printf '%s' "$total"
}

duration_words() {
  s="$1"
  if [ $((s % 3600)) -eq 0 ] && [ "$s" -ge 3600 ]; then
    printf '%sh' "$((s / 3600))"
  elif [ $((s % 60)) -eq 0 ] && [ "$s" -ge 60 ]; then
    printf '%sm' "$((s / 60))"
  else
    printf '%ss' "$s"
  fi
}

# One detached watcher per timed focus. It writes nothing if the binary changed
# since the patch, so a Freebuff update makes it stand down instead of
# overwriting the new build with an old one.
start_watcher() {
  # $1 = binary, $2 = backup, $3 = seconds, $4 = sha256 of the patched binary
  bin="$1"
  backup="$2"
  secs="$3"
  patched="$4"

  mkdir -p "$STATE_DIR" || return 1
  sha_cmd="sha256sum"
  if command -v shasum >/dev/null 2>&1; then sha_cmd="shasum -a 256"; fi

  watcher="$STATE_DIR/watcher.sh"
  {
    printf '#!/bin/sh\n'
    printf '# Written by %s - restores the original after a timed focus.\n' "$PROG"
    printf 'sleep %s\n' "$secs"
    printf 'now="$(date -u %s)"\n' "'+%Y-%m-%dT%H:%M:%SZ'"
    printf 'if [ -f %s ] && [ "$(%s %s | awk %s)" = %s ]; then\n' \
      "'$backup'" "$sha_cmd" "'$bin'" "'{print \$1}'" "'$patched'"
    printf '  cp -p %s %s && chmod 755 %s\n' "'$backup'" "'$bin'" "'$bin'"
    printf '  printf %s "$now" %s >>%s\n' "'%s restored %s after a timed focus\\n'" "'$bin'" "'$SESSION_LOG'"
    printf 'else\n'
    printf '  printf %s "$now" %s >>%s\n' "'%s left %s alone - it changed since the patch\\n'" "'$bin'" "'$SESSION_LOG'"
    printf 'fi\n'
    printf 'rm -f %s\n' "'$WATCH_PID_FILE'"
  } >"$watcher" || return 1
  chmod 755 "$watcher" 2>/dev/null || true

  nohup sh "$watcher" >/dev/null 2>&1 &
  printf '%s\n' "$!" >"$WATCH_PID_FILE"
  return 0
}

# A pending watcher would put an old binary back over a newer patch, so every
# explicit focus and every restore starts by stopping it.
stop_watcher() {
  if [ -f "$WATCH_PID_FILE" ]; then
    pid="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
    case "$pid" in
      '' | *[!0-9]*)
        rm -f "$WATCH_PID_FILE"
        ;;
      *)
        if kill "$pid" 2>/dev/null; then
          ok "stopped the timed focus (pid $pid)"
        fi
        rm -f "$WATCH_PID_FILE"
        ;;
    esac
  fi
}

watcher_note() {
  if [ -f "$WATCH_PID_FILE" ]; then
    pid="$(cat "$WATCH_PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ]; then say "  focus     timed, watcher pid $pid (unfocus stops it)"; fi
  fi
}

# --- commands --------------------------------------------------------------

cmd_status() {
  bin="$(resolve_binary)" || exit 1
  kind="$(file_kind "$bin")"
  say "Freebuff CLI focus $VERSION"
  say ""
  say "  binary   $bin"
  if [ -z "$CLI_BIN" ] && [ "$kind" = "script" ]; then
    bad "that is the npm launcher script, not the CLI binary"
    return 1
  fi
  ver="$(cli_version "$bin")"
  say "  version  ${ver:-does not run}"
  out="$(run_engine check "$bin")" || true
  result="$(field "$out" RESULT)"
  case "$result" in
    already)
      ok "ads are off (the ads hook is disabled in this binary)"
      ;;
    patch)
      bad "ads are on (the binary is unpatched)"
      ;;
    *)
      bad "cannot tell: $(field "$out" NOTE)"
      ;;
  esac
  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE" 2>/dev/null || true
    if [ -n "${BACKUP_FILE:-}" ] && [ -f "$BACKUP_FILE" ]; then
      ok "original kept at $BACKUP_FILE"
    fi
  fi
  if [ -x "$BIN_DIR/$COMMAND_NAME" ]; then
    ok "command  $BIN_DIR/$COMMAND_NAME"
  else
    say "  command  not installed (run: $(cmdname) install)"
  fi
  watcher_note
  return 0
}

cmd_verify() {
  bin="$(resolve_binary)" || exit 1
  out="$(run_engine check "$bin")" || true
  result="$(field "$out" RESULT)"
  case "$result" in
    already) ok "$bin has the ads hook disabled"; return 0 ;;
    patch) bad "$bin is unpatched - ads will show"; return 1 ;;
    *) bad "${bin}: $(field "$out" NOTE)"; return 1 ;;
  esac
}

cmd_doctor() {
  say "Freebuff CLI focus $VERSION - doctor"
  say ""
  say "  system     $(uname -s) $(uname -m)"
  if node="$(node_bin)"; then
    ok "runtime: $node"
  else
    bad "no node or bun found - the patch engine cannot run"
  fi
  say "  launcher   $(launcher_config_dir)/freebuff"
  if bin="$(default_binary 2>/dev/null)"; then
    ok "binary: $bin ($(file_kind "$bin"), $(wc -c <"$bin" | tr -d ' ') bytes)"
    ver="$(cli_version "$bin")"
    say "  version    ${ver:-does not run}"
    out="$(run_engine check "$bin")" || true
    case "$(field "$out" RESULT)" in
      already) ok "ads hook: disabled" ;;
      patch) bad "ads hook: enabled (unpatched)" ;;
      *) bad "ads hook: $(field "$out" NOTE)" ;;
    esac
  else
    bad "no binary found at the launcher path or on PATH"
  fi
  if [ "$(uname -s)" = "Darwin" ]; then
    if command -v codesign >/dev/null 2>&1; then
      ok "codesign available (re-signed ad-hoc after patching)"
    else
      bad "codesign missing - cannot patch an arm64 binary"
    fi
  fi
  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE" 2>/dev/null || true
    say "  backup     ${BACKUP_FILE:-none}"
  else
    say "  backup     none yet"
  fi
  say "  state dir  $STATE_DIR"
  if [ -f "$INSTALLED_SELF" ]; then
    ok "installed  $INSTALLED_SELF ($(version_of "$INSTALLED_SELF"))"
  else
    say "  installed  none (run: $(cmdname) install)"
  fi
  if [ -x "$BIN_DIR/$COMMAND_NAME" ]; then
    ok "command    $BIN_DIR/$COMMAND_NAME"
    path_has_bin && ok "$BIN_DIR is on PATH" || bad "$BIN_DIR is not on PATH in this shell"
  else
    say "  command    none"
  fi
  say "  origin     $ORIGIN"
  watcher_note
  return 0
}

# Read-only. Prints what this build contains, so a Freebuff release that moved
# an anchor is a report to read rather than a dead end. Nothing is written to
# the binary.
cmd_scan() {
  bin="$(resolve_binary)" || exit 1
  ver="$(cli_version "$bin")"
  size="$(wc -c <"$bin" | tr -d ' ')"

  say "Freebuff CLI focus $VERSION - anchor scan"
  say "  binary   $bin"
  say "  kind     $(file_kind "$bin"), $size bytes"
  say "  version  ${ver:-does not run}"
  say ""

  out="$(run_engine check "$bin")" || die "the scan could not read $bin"
  result="$(field "$out" RESULT)"

  case "$result" in
    already | patch)
      ok "ads-hook anchor found at offset $(field "$out" OFFSET)"
      say "  expression  $(field "$out" EXPR)"
      ;;
    *)
      bad "$(field "$out" NOTE)"
      ;;
  esac

  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE" 2>/dev/null || true
    if [ -n "${BACKUP_FILE:-}" ]; then say "  backup      $BACKUP_FILE"; fi
  else
    say "  backup      none yet"
  fi

  report="$STATE_DIR/scan-${ver:-unknown}.txt"
  if mkdir -p "$STATE_DIR" 2>/dev/null && {
    say ""
    printf 'binary=%s\nversion=%s\nkind=%s\nsize=%s\nresult=%s\noffset=%s\nexpr=%s\n' \
      "$bin" "${ver:-unknown}" "$(file_kind "$bin")" "$size" "$result" \
      "$(field "$out" OFFSET)" "$(field "$out" EXPR)"
  } >"$report" 2>/dev/null; then
    ok "saved    $report"
  else
    warn "could not write $report - copy the block above instead"
  fi

  say ""
  say "  Nothing in the binary was touched."
  return 0
}

cmd_focus() {
  bin="$(resolve_binary)" || exit 1
  kind="$(file_kind "$bin")"
  # An explicit --bin is the caller's business; only the auto-detected file has
  # to prove it is the real binary and not the npm launcher that starts it.
  if [ -z "$CLI_BIN" ] && [ "$kind" = "script" ]; then
    die "$bin is the npm launcher script, not the CLI binary (see: $PROG doctor)"
  fi
  if [ "$kind" = "pe" ]; then
    die "the Windows binary is not supported by this tool yet"
  fi

  secs=""
  if [ -n "$DURATION" ]; then
    secs="$(duration_seconds "$DURATION")" || die "not a duration: $DURATION (try: 25m, 90s, 2h)"
  fi

  say "Freebuff CLI focus $VERSION"
  say ""

  before="$(cli_version "$bin")" || before=""
  if [ -z "$before" ]; then
    die "$bin does not run (no --version output) - not touching it"
  fi
  ok "found Freebuff CLI $before at $bin"

  # A watcher left over from an earlier timed focus would restore an old binary
  # over this one, so a new focus always clears it first.
  stop_watcher >/dev/null 2>&1 || true

  out="$(run_engine check "$bin")" || true
  result="$(field "$out" RESULT)"
  case "$result" in
    already)
      ok "ads are already off in this binary - nothing to do"
      if [ -n "$secs" ]; then
        patched_sha="$(sha256_of "$bin")"
        backup="$(backup_path_for "$bin" "$before")"
        if [ -f "$backup" ] && start_watcher "$bin" "$backup" "$secs" "$patched_sha"; then
          say ""
          ok "ads come back in $(duration_words "$secs") (watcher pid $(cat "$WATCH_PID_FILE" 2>/dev/null || echo '?'))"
        else
          warn "could not start the timed watcher - the patch stays until you run unfocus"
        fi
      fi
      return 0
      ;;
    patch) ;;
    *)
      die "$(field "$out" NOTE) - left $bin untouched"
      ;;
  esac

  dir="$(dirname "$bin")"
  base="$(basename "$bin")"
  tmp="$dir/.$base.focus-tmp.$$"
  rm -f "$tmp"

  applied="$(run_engine apply "$bin" "$tmp")" || {
    rm -f "$tmp"
    die "the patch engine failed - left $bin untouched"
  }
  if [ "$(field "$applied" WROTE)" != "1" ]; then
    rm -f "$tmp"
    die "$(field "$applied" NOTE) - left $bin untouched"
  fi
  ok "patched the ads hook out of the copy (same size: $(field "$applied" SIZE) bytes)"

  if ! sign_binary "$tmp"; then
    rm -f "$tmp"
    die "codesign failed - left $bin untouched"
  fi
  if [ "$(uname -s)" = "Darwin" ]; then
    ok "re-signed the copy ad-hoc"
  fi

  after="$("$tmp" --version 2>/dev/null | tr -d '\r' | head -n 1)" || after=""
  if [ "$after" != "$before" ]; then
    if [ "$(uname -s)" = "Darwin" ] && [ -z "$after" ]; then
      # A refusal to start is the one outcome that must never be installed.
      rm -f "$tmp"
      die "the patched copy did not start (macOS killed it) - left $bin untouched"
    fi
    rm -f "$tmp"
    die "the patched copy reports '${after:-nothing}' instead of $before - left $bin untouched"
  fi
  ok "the patched copy starts and still reports $before"

  mkdir -p "$STATE_DIR" || {
    rm -f "$tmp"
    die "could not create $STATE_DIR"
  }
  backup="$(backup_path_for "$bin" "$before")"
  if [ ! -f "$backup" ]; then
    cp -p "$bin" "$backup" || {
      rm -f "$tmp"
      die "could not save the original to $backup - left $bin untouched"
    }
  fi
  ok "original saved to $backup"

  if ! mv -f "$tmp" "$bin"; then
    rm -f "$tmp"
    die "could not replace $bin (is it on a read-only volume?)"
  fi
  chmod 755 "$bin" 2>/dev/null || true

  installed="$(cli_version "$bin")" || installed=""
  if [ "$installed" != "$before" ]; then
    cp -p "$backup" "$bin" 2>/dev/null || true
    die "the installed binary did not start - put the original back"
  fi

  {
    printf 'BINARY=%s\n' "$bin"
    printf 'VERSION=%s\n' "$before"
    printf 'BACKUP_FILE=%s\n' "$backup"
    printf 'BACKUP_SHA=%s\n' "$(sha256_of "$backup")"
    printf 'PATCHED_AT=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'TOOL_VERSION=%s\n' "$VERSION"
  } >"$STATE_FILE"

  say ""
  ok "ads are off"

  if [ -n "$secs" ]; then
    patched_sha="$(sha256_of "$bin")"
    if start_watcher "$bin" "$backup" "$secs" "$patched_sha"; then
      say ""
      ok "ads come back in $(duration_words "$secs") (watcher pid $(cat "$WATCH_PID_FILE" 2>/dev/null || echo '?'))"
      say "  Stop it early: $(cmdname) unfocus"
    else
      warn "could not start the timed watcher - the patch stays until you run unfocus"
    fi
  fi

  say ""
  say "Start the CLI as usual; the ad cards, the dock above the input and their"
  say "impression reporting are all gated on the switch that is now off."
  say "Keep $backup to undo this: $PROG unfocus"
  say ""
  say "A newer CLI is a new binary and arrives unpatched - run focus again after"
  say "an update. Nothing else needs doing."
  return 0
}

cmd_unfocus() {
  stop_watcher
  bin="$(resolve_binary)" || exit 1
  backup=""
  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE" 2>/dev/null || true
    backup="${BACKUP_FILE:-}"
  fi
  if [ -z "$backup" ] || [ ! -f "$backup" ]; then
    die "no saved original to restore (looked in $STATE_DIR)"
  fi

  say "Freebuff CLI focus $VERSION"
  say ""
  kind="$(file_kind "$bin")"
  if [ "$kind" = "macho" ] || [ "$kind" = "elf" ]; then
    ok "restoring $bin from $backup"
  fi

  dir="$(dirname "$bin")"
  base="$(basename "$bin")"
  tmp="$dir/.$base.focus-tmp.$$"
  cp -p "$backup" "$tmp" || die "could not copy the backup next to $bin"
  if ! cmp -s "$backup" "$tmp"; then
    rm -f "$tmp"
    die "the restored copy does not match the backup - left $bin untouched"
  fi
  if ! mv -f "$tmp" "$bin"; then
    rm -f "$tmp"
    die "could not replace $bin"
  fi
  chmod 755 "$bin" 2>/dev/null || true

  ver="$(cli_version "$bin")" || ver=""
  if [ -z "$ver" ]; then
    die "the original was restored but does not report a version - check $bin"
  fi
  ok "original restored, reports $ver"
  say ""
  ok "ads are on again (the original build is back)"
  return 0
}

# Install the tool and the command that runs it, then patch - the first
# `curl | sh` does all three, so the reader gets `freebuff-cli-focus status`
# instead of a file they have to name and a path they have to remember.
cmd_install() {
  mkdir -p "$INSTALL_DIR" "$BIN_DIR" 2>/dev/null ||
    die "cannot create $INSTALL_DIR or $BIN_DIR"

  say "Freebuff CLI focus $VERSION - install"
  say ""

  tmp="$INSTALLED_SELF.tmp.$$"
  if [ "$HAVE_LOCAL" = "1" ] && [ -f "${0:-}" ]; then
    # Exactly the code that is running: a local copy needs no second download.
    cp "$0" "$tmp" || die "cannot write $tmp"
  else
    # stdin is already consumed by the interpreter, so the piped case downloads
    # the same URL it came from rather than re-reading a stream that is gone.
    curl -fsSL "$ORIGIN/downloads/freebuff-cli-focus.sh" -o "$tmp" 2>/dev/null ||
      { rm -f "$tmp"; die "cannot download the tool from $ORIGIN"; }
    got="$(version_of "$tmp")"
    [ -n "$got" ] || { rm -f "$tmp"; die "the download does not look like this tool - nothing was installed"; }
    if [ "$got" != "$VERSION" ]; then
      # A copy older than the code that is running is a stale site, not an
      # update: installing it would hand back a tool missing this very command.
      if version_newer "$VERSION" "$got"; then
        rm -f "$tmp"
        die "the site is serving $got while this run is $VERSION - nothing was installed. Try the one-liner again in a minute."
      fi
      warn "downloaded $got while running $VERSION - installing $got"
    fi
  fi

  chmod 755 "$tmp" 2>/dev/null || true
  mv "$tmp" "$INSTALLED_SELF" || { rm -f "$tmp"; die "cannot install to $INSTALLED_SELF"; }

  shim="$BIN_DIR/$COMMAND_NAME"
  printf '#!/bin/sh\n# Freebuff CLI focus launcher - written by `%s install`.\nexec sh "%s" "$@"\n' \
    "$COMMAND_NAME" "$INSTALLED_SELF" >"$shim" 2>/dev/null ||
    die "cannot write $shim"
  chmod 755 "$shim" 2>/dev/null || die "cannot make $shim executable"

  ok "installed $INSTALLED_SELF"
  ok "command   $shim"

  if path_has_bin; then
    say "  ${BIN_DIR} is already on PATH"
  elif [ "$ADD_PATH" = "1" ]; then
    add_to_path || warn "could not update $(shell_rc) - add $BIN_DIR to PATH yourself"
    say "  Open a new terminal, then run:  $COMMAND_NAME status"
  else
    say ""
    say "  $BIN_DIR is not on PATH yet. Add it for good:"
    say "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> $(shell_rc)"
    say "  or rerun install with --add-path and this is done for you."
  fi

  say ""
  # Patch through the installed copy, so the code that writes the patch is the
  # code that was just installed rather than the one that happened to run.
  set -- focus
  if [ -n "$CLI_BIN" ]; then set -- "$@" --bin "$CLI_BIN"; fi
  if [ -n "$BACKUP_DIR" ]; then set -- "$@" --backup-dir "$BACKUP_DIR"; fi
  if sh "$INSTALLED_SELF" "$@"; then
    return 0
  fi
  say ""
  bad "the tool is installed, but patching failed - see the message above."
  say "  Try: $COMMAND_NAME doctor"
  return 1
  # A shell that was already open when the launcher was written keeps its own
  # command hash, so the name is there but does not tab-complete until refreshed.
  say "  If the name does not tab-complete yet: rehash (zsh) or open a new terminal."
}

# Replace the installed copy with whatever the site serves now, keeping the old
# one beside it, then run the new code so the patch is refreshed by the version
# that will be used from now on.
cmd_update() {
  [ -f "$INSTALLED_SELF" ] ||
    die "no installed copy yet - run: curl -fsSL $ORIGIN/downloads/freebuff-cli-focus.sh | sh"

  say "Freebuff CLI focus $VERSION - update"
  old="$(version_of "$INSTALLED_SELF")"
  say "  installed  ${old:-unknown}"

  tmp="$INSTALLED_SELF.new.$$"
  curl -fsSL "$ORIGIN/downloads/freebuff-cli-focus.sh" -o "$tmp" 2>/dev/null ||
    { rm -f "$tmp"; die "cannot reach $ORIGIN - nothing was changed"; }
  new="$(version_of "$tmp")"
  [ -n "$new" ] || { rm -f "$tmp"; die "the download does not look like this tool - kept the installed copy"; }
  say "  available  $new"

  if [ "$new" = "$old" ] && [ "$FORCE" != "1" ]; then
    rm -f "$tmp"
    ok "already up to date"
    return 0
  fi

  if [ "$FORCE" != "1" ] && version_newer "${old:-0}" "$new"; then
    rm -f "$tmp"
    die "the site is serving $new, which is older than the installed ${old:-?} - nothing was changed"
  fi

  cp "$INSTALLED_SELF" "$INSTALLED_SELF.prev" 2>/dev/null || true
  chmod 755 "$tmp" 2>/dev/null || true
  mv "$tmp" "$INSTALLED_SELF" || { rm -f "$tmp"; die "cannot replace $INSTALLED_SELF"; }
  ok "updated    ${old:-unknown} -> $new"
  say "  previous   $INSTALLED_SELF.prev"
  say ""

  # Hand over to the copy that was just installed, with the settings this run was
  # given, so the new version does the patching.
  set -- focus
  if [ -n "$CLI_BIN" ]; then set -- "$@" --bin "$CLI_BIN"; fi
  if [ -n "$BACKUP_DIR" ]; then set -- "$@" --backup-dir "$BACKUP_DIR"; fi
  exec sh "$INSTALLED_SELF" "$@"
}

# Remove the command and the installed copy. The patch is left alone on purpose:
# taking away the tool that can undo it must not also take away the undo.
cmd_uninstall() {
  stop_watcher
  shim="$BIN_DIR/$COMMAND_NAME"
  removed=0
  if [ -f "$shim" ]; then rm -f "$shim" && { ok "removed $shim"; removed=1; }; fi
  if [ -f "$INSTALLED_SELF" ]; then
    rm -f "$INSTALLED_SELF" "$INSTALLED_SELF.prev" && { ok "removed $INSTALLED_SELF"; removed=1; }
  fi

  if [ "$removed" = "0" ]; then
    say "  Nothing was installed here."
    return 0
  fi

  say ""
  say "  The patch is still applied. Restore the ads first next time, with a fresh copy:"
  say "    curl -fsSL $ORIGIN/downloads/freebuff-cli-focus.sh | sh -s unfocus"
}

case "$CMD" in
  install | setup) cmd_install ;;
  focus) cmd_focus ;;
  unfocus) cmd_unfocus ;;
  status) cmd_status ;;
  verify) cmd_verify ;;
  scan) cmd_scan ;;
  doctor) cmd_doctor ;;
  update) cmd_update ;;
  uninstall) cmd_uninstall ;;
esac
