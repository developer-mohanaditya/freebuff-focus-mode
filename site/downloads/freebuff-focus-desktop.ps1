#Requires -Version 5.1
<#
Freebuff Focus for Desktop - Windows

Freebuff Desktop renders ads from the orchestrator process it ships inside its own
install folder - `resources\orchestrator\orchestrator.js`, run by the bundled
runtime, not from `app.asar`. A browser extension can never reach it, which is
why this exists as a separate, local tool.

This is the Windows half of the macOS tool in `freebuff-focus.sh`. The anchors,
the counts, the markers and the safety rules are the same; only the machinery
around them differs (path discovery, process lookup, the write, and the message a
blocked write gets). It disables the ad runtime in place:

  - It only touches the ad code, at two anchors: the gate the ad auction
    consults is forced to return "no ads to show", and the ad client's own
    request helper - the one method every /api/v1/ads/* call goes through - is
    made to give up before it sends. Nothing else in the file changes.
  - It refuses to run at all unless every patch anchor is found the exact
    number of times it expects, and a relaxation is only accepted when ad code
    sits right beside it. A new Freebuff version that renames a function fails
    safe and changes nothing, rather than half-patching a 9 MB bundle - and
    `scan` then shows what that build does contain, so re-anchoring is a
    report to read instead of a dead end.
  - It backs up the pristine file before the first write, and `revert` puts it
    back.
  - It will not rewrite a file it cannot read as UTF-8, and it will not write
    through anchors whose counts do not match.

Usage, from a PowerShell prompt (PowerShell ships with every Windows, so there
is nothing to install first):

  irm https://freebuff-focusmode.vercel.app/downloads/freebuff-focus-desktop.ps1 | iex           # install (the default)
  $s = irm https://freebuff-focusmode.vercel.app/downloads/freebuff-focus-desktop.ps1
  & ([scriptblock]::Create($s)) status                                      # any other command

  powershell -ExecutionPolicy Bypass -File .\freebuff-focus.ps1 scan       # a local copy

The piped form never writes the script to disk, so it carries no
mark-of-the-web and the execution policy never applies to it: `iex` runs a
string, not a .ps1 file. Downloading it by hand does attach the mark, which is
why the documented local form passes -ExecutionPolicy Bypass, and why
`Unblock-File .\freebuff-focus.ps1` works just as well.

Commands:
  install   patch the app (default; backs up first)
  status    report what is applied - changes nothing
  verify    wait for Freebuff to be relaunched, then check what it loaded
  scan      show every anchor this build has - changes nothing
  revert    restore the pristine backup
  doctor    environment report
  version   print the tool version
  help      this text

Options:
  -App PATH          the Freebuff install folder (auto-detected by default)
  -BackupDir PATH    where the pristine copy lives
  -DisplayOnly       skip the ad-API anchor (leave the render gate only)
  -Deep              the opposite of -DisplayOnly, and the default
  -DryRun            with install: report what would happen, write nothing
  -NoWait            verify: report now instead of waiting for a relaunch
  -Timeout SECONDS   verify: how long to wait (default 300)

Every Freebuff update replaces the resources folder, so the patch is gone after
one. Run `install` again after an update.

The patch is only half the answer: the orchestrator is read once at launch, so a
patched file with an old process in memory is a patched file doing nothing.
`verify` is the other half - it waits for the relaunch and then checks that the
process running now started after the patch was written. `install` runs it for
you when Freebuff is open. Both are read-only.

MIT licensed. See LICENSE.
#>

[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [AllowEmptyCollection()]
  [string[]] $Arguments
)

if ($null -eq $Arguments) { $Arguments = @() }

# Stamped at build time (scripts/build-desktop.mjs).
$Version = '1.8.3'
# The test suite points this at a file:// copy so update can be exercised without
# the network. Nothing else sets it.
$Origin = if ($env:FREEBUFF_FOCUS_ORIGIN) { $env:FREEBUFF_FOCUS_ORIGIN } else { 'https://freebuff-focusmode.vercel.app' }

# Whether this run has the script on disk. `irm ... | iex` does not, so a hint
# that says `.\freebuff-focus.ps1 status` would point at a file that is not there.
$HaveLocal = [bool]$PSCommandPath

# Where the tool installs itself, and the command that runs it. Windows has no
# ~/.local/bin to agree on, so the folder is named and its bin sits inside it.
if ($env:LOCALAPPDATA) { $InstallDir = Join-Path $env:LOCALAPPDATA 'FreebuffFocus' }
else { $InstallDir = Join-Path $HOME '.freebuff-focus' }
if ($env:FREEBUFF_FOCUS_HOME) { $InstallDir = $env:FREEBUFF_FOCUS_HOME }
$BinDir = Join-Path $InstallDir 'bin'
if ($env:FREEBUFF_FOCUS_BIN_DIR) { $BinDir = $env:FREEBUFF_FOCUS_BIN_DIR }
$CommandName = 'freebuff-focusmode'
$InstalledSelf = Join-Path $InstallDir 'freebuff-focus.ps1'
$AddPath = $false
$Force = $false

$Command = ''
$App = ''
if ($env:FREEBUFF_APP) { $App = $env:FREEBUFF_APP }

# The backup folder keeps its 1.6 name on purpose: renaming it would orphan every
# pristine copy an existing install already wrote, and those are what revert
# restores. The override is new; the old one still works.
$BackupDir = Join-Path $HOME 'freebuff-patch-backups'
if ($env:FREEBUFF_FOCUS_BACKUP_DIR) { $BackupDir = $env:FREEBUFF_FOCUS_BACKUP_DIR }

# Where a focus session is recorded. One small file, no daemon: the session ends
# when its timestamp passes, whether or not this tool is ever run again.
$SessionDir = Join-Path $HOME '.local\share\freebuff-focus'
if ($env:LOCALAPPDATA) { $SessionDir = Join-Path $env:LOCALAPPDATA 'freebuff-focus' }
if ($env:FREEBUFF_FOCUS_SESSION_DIR) { $SessionDir = $env:FREEBUFF_FOCUS_SESSION_DIR }

$Deep = $true
$Dry = $false
$Wait = $true
$WaitSecs = 300

# auto   - restart only when Freebuff was open when the patch was written
# always - quit and relaunch even when it was closed (-Restart)
# never  - never touch a process (-NoRestart)
$Restart = 'auto'
$FocusArg = ''

# Set by focus/unfocus before they hand over to install/revert, which are the
# functions that already own the exit paths. A flag is honest here: the session
# is written only when the patch it describes actually succeeded.
$script:FocusSeconds = $null
$script:EndFocus = $false

# What a focus run asked for, and where the patch it describes landed. Complete-
# Focus runs at the end of install, which is what knows the target, so install
# hands the three values over here rather than guessing them again.
$script:FocusMode = ''
$script:InstalledApp = ''
$script:InstalledTarget = ''
$script:InstalledVersion = ''
$script:Interval = 1

# Set only by __watch, the hidden command a timed or session focus starts. Not in
# the command list and not in the help: nobody types these.
$script:WatchRun = ''
$script:WatchTarget = ''
$script:WatchBackup = ''
$script:WatchStamp = ''
$script:WatchMode = ''
$script:WatchPid = '0'
$script:WatchEnds = '0'

$script:IsWindowsOS = ($env:OS -eq 'Windows_NT')
$script:UseColor = $false
try {
  $script:UseColor = [bool](
    (-not $env:NO_COLOR) -and (-not [Console]::IsOutputRedirected) -and ($Host.Name -eq 'ConsoleHost')
  )
} catch {
  # A host with no console to ask: plain text is always safe.
  $script:UseColor = $false
}

# ------------------------------------------------------------------- helpers

function Say {
  param([string] $Text = '')
  Write-Host $Text
}

# Colour is per-fragment and always goes through here, so redirection or
# NO_COLOR turns every one of them off together - the report has to stay the same
# text for a person and for a test.
function Write-Piece {
  param([string] $Text, [string] $Color = '')
  if ($script:UseColor -and $Color) { Write-Host -NoNewline $Text -ForegroundColor $Color }
  else { Write-Host -NoNewline $Text }
}

function Ok {
  param([string] $Text)
  Write-Host -NoNewline '  '
  Write-Piece 'ok' 'Green'
  Write-Host " $Text"
}

function Warn {
  param([string] $Text)
  Write-Host -NoNewline '  '
  Write-Piece '!' 'Yellow'
  Write-Host " $Text"
}

function Bad {
  param([string] $Text)
  Write-Host -NoNewline '  '
  Write-Piece 'x' 'Red'
  Write-Host " $Text"
}

function Die {
  param([string] $Text)
  [Console]::Error.WriteLine("error: $Text")
  exit 1
}

# ------------------------------------------------------------------ arg parse

$index = 0
while ($index -lt $Arguments.Count) {
  $raw = $Arguments[$index]
  $index++
  if ([string]::IsNullOrWhiteSpace($raw)) { continue }

  $key = $raw
  $inline = $null
  if ($key -match '^--?([^=]+)=(.*)$') {
    $key = $Matches[1]
    $inline = $Matches[2]
  } else {
    $key = $key -replace '^--?', ''
  }
  $key = $key.ToLowerInvariant()

  # The value either came glued on (`-App=C:\x`) or is the next argument.
  $value = $inline
  if ($value -eq $null -and @('app', 'backupdir', 'timeout', 'sessiondir', 'interval', 'watchrun', 'watchtarget', 'watchbackup', 'watchstamp', 'watchmode', 'watchpid', 'watchends') -contains $key) {
    if ($index -lt $Arguments.Count) {
      $value = $Arguments[$index]
      $index++
    }
  }

  switch ($key) {
    'install' { $Command = 'install' }
    'setup' { $Command = 'setup' }
    'update' { $Command = 'update' }
    'uninstall' { $Command = 'uninstall' }
    'focus' { $Command = 'focus' }
    'unfocus' { $Command = 'unfocus' }
    'status' { $Command = 'status' }
    'verify' { $Command = 'verify' }
    'revert' { $Command = 'revert' }
    'doctor' { $Command = 'doctor' }
    'scan' { $Command = 'scan' }
    'help' { $Command = 'help' }
    'h' { $Command = 'help' }
    'version' { $Command = 'version' }
    '__watch' { $Command = '__watch' }
    'interval' {
      if ("$value" -notmatch '^\d+$') { Die "-Interval needs a number of seconds, not '$value'" }
      $script:Interval = [int]$value
      if ($script:Interval -lt 1) { $script:Interval = 1 }
    }
    'watchrun' { $script:WatchRun = "$value" }
    'watchtarget' { $script:WatchTarget = "$value" }
    'watchbackup' { $script:WatchBackup = "$value" }
    'watchstamp' { $script:WatchStamp = "$value" }
    'watchmode' { $script:WatchMode = "$value" }
    'watchpid' { $script:WatchPid = "$value" }
    'watchends' { $script:WatchEnds = "$value" }
    'app' {
      if ([string]::IsNullOrWhiteSpace($value)) { Die '-App needs a path' }
      $App = $value
    }
    'backupdir' {
      if ([string]::IsNullOrWhiteSpace($value)) { Die '-BackupDir needs a path' }
      $BackupDir = $value
    }
    'timeout' {
      if ("$value" -notmatch '^\d+$') { Die "-Timeout needs a number of seconds, not '$value'" }
      $WaitSecs = [int]$value
    }
    'sessiondir' {
      if ([string]::IsNullOrWhiteSpace($value)) { Die '-SessionDir needs a path' }
      $SessionDir = $value
    }
    'displayonly' { $Deep = $false }
    'deep' { $Deep = $true }
    'dryrun' { $Dry = $true }
    'restart' { $Restart = 'always' }
    'norestart' { $Restart = 'never' }
    'nowait' { $Wait = $false }
    'addpath' { $AddPath = $true }
    'force' { $Force = $true }
    default {
      # `focus 25m` - the duration is the one positional argument this tool takes,
      # and only focus takes it.
      if ($Command -eq 'focus' -and [string]::IsNullOrEmpty($FocusArg) -and $raw -notmatch '^-') {
        $FocusArg = $raw
      } else {
        Die "unknown argument: $raw  (try help)"
      }
    }
  }
}

if ([string]::IsNullOrEmpty($Command)) { $Command = 'install' }

# --------------------------------------------------------------- app discovery

function Get-TargetPath {
  param([string] $AppDir)
  return [System.IO.Path]::Combine($AppDir, 'resources', 'orchestrator', 'orchestrator.js')
}

function Get-OrchestratorDir {
  param([string] $AppDir)
  return [System.IO.Path]::Combine($AppDir, 'resources', 'orchestrator')
}

function Test-UnderPath {
  param([string] $Root, [string] $Path)
  if (-not $Root -or -not $Path) { return $false }
  try {
    $separator = [System.IO.Path]::DirectorySeparatorChar
    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + $separator
    $pathFull = [System.IO.Path]::GetFullPath($Path)
  } catch {
    return $false
  }
  return $pathFull.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)
}

<#
Where a Freebuff install can live, in the order the answer is most likely to be
right. Nothing here is a complete inventory - an installer can be pointed at a
custom folder - which is why -App exists and why a miss is reportable rather than
fatal:

  - the uninstall registry entries, the one place a per-user or machine-wide
    install records where it went
  - the running app, which knows its own path
  - the known roots: the per-user installer's Local\Programs\<product> (where
    the Windows build has been seen to install, as @codebufffreebuff-desktop),
    every other folder under Local\Programs so a product rename is still found,
    the Squirrel-style app-<version> folders, and the machine-wide Program Files
    locations
#>
function Get-AppCandidates {
  $list = New-Object System.Collections.Generic.List[string]

  foreach ($hive in @(
      'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
      'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )) {
    foreach ($entry in @(Get-ItemProperty -Path $hive -ErrorAction SilentlyContinue)) {
      if ("$($entry.DisplayName)" -notmatch 'freebuff') { continue }
      # InstallLocation is a folder; DisplayIcon is the .exe inside it.
      foreach ($field in @("$($entry.InstallLocation)", "$($entry.DisplayIcon)")) {
        if ([string]::IsNullOrWhiteSpace($field)) { continue }
        $candidate = $field.Trim('"').TrimEnd('\', '/')
        if (-not $candidate) { continue }
        $isFile = $false
        try { $isFile = Test-Path -LiteralPath $candidate -PathType Leaf } catch { $isFile = $false }
        if ($isFile) { $candidate = Split-Path -Parent $candidate }
        $list.Add($candidate)
      }
    }
  }

  # The app, if it is running, is the most reliable answer of all.
  foreach ($process in @(Get-Process -Name 'Freebuff*' -ErrorAction SilentlyContinue)) {
    $exe = Get-ProcessPath $process
    if ($exe) { $list.Add((Split-Path -Parent $exe)) }
  }

  $localAppData = $env:LOCALAPPDATA
  if ($localAppData) {
    # The per-user installer's own folder, seen in the wild as
    # %LOCALAPPDATA%\Programs\@codebufffreebuff-desktop
    $list.Add((Join-Path $localAppData 'Programs\@codebufffreebuff-desktop'))
    $list.Add((Join-Path $localAppData 'Programs\Freebuff'))
    $list.Add((Join-Path $localAppData 'Freebuff'))

    $programs = Join-Path $localAppData 'Programs'
    if (Test-Path -LiteralPath $programs -PathType Container) {
      foreach ($dir in @(Get-ChildItem -LiteralPath $programs -Directory -ErrorAction SilentlyContinue)) {
        $list.Add($dir.FullName)
      }
    }

    # Squirrel keeps each build side by side as app-<version>.
    $squirrel = Join-Path $localAppData 'Freebuff'
    if (Test-Path -LiteralPath $squirrel -PathType Container) {
      foreach ($dir in @(Get-ChildItem -LiteralPath $squirrel -Directory -Filter 'app-*' -ErrorAction SilentlyContinue)) {
        $list.Add($dir.FullName)
      }
    }
  }

  if ($env:ProgramFiles) { $list.Add((Join-Path $env:ProgramFiles 'Freebuff')) }
  if (${env:ProgramFiles(x86)}) { $list.Add((Join-Path ${env:ProgramFiles(x86)} 'Freebuff')) }

  $seen = @{}
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($item in $list) {
    if ([string]::IsNullOrWhiteSpace($item)) { continue }
    $dedupe = $item.ToLowerInvariant()
    if ($seen.ContainsKey($dedupe)) { continue }
    $seen[$dedupe] = $true
    $out.Add($item)
  }
  return $out
}

<#
The install folder, or $null. -App may point at the install folder, at its
`resources` folder, or straight at the orchestrator.js - all three name the same
place, and refusing two of them would only be a puzzle for whoever copied a path
out of a bug report.
#>
function Find-AppDir {
  if ($App) {
    $probe = $App
    if (Test-Path -LiteralPath $probe -PathType Leaf) {
      if ((Split-Path -Leaf $probe) -ne 'orchestrator.js') { Die "not a Freebuff install: $probe" }
      $probe = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $probe))
    } elseif ((Split-Path -Leaf $probe) -eq 'resources') {
      $probe = Split-Path -Parent $probe
    }
    if (-not (Test-Path -LiteralPath (Get-OrchestratorDir $probe) -PathType Container)) {
      Die "not a Freebuff install folder: $App`n  Pass -App with the folder that holds resources\orchestrator."
    }
    return $probe
  }

  foreach ($candidate in (Get-AppCandidates)) {
    if (Test-Path -LiteralPath (Get-TargetPath $candidate) -PathType Leaf) { return $candidate }
  }
  return $null
}

<#
The version Freebuff itself reports, never a number this tool invents. Windows has
no Info.plist: the installer writes the version into the executable's own version
resource, and Squirrel puts it in the folder name instead. Whichever is there is
used, and `unknown` is a truthful answer - it only ever names the backup file.
#>
function Get-AppVersion {
  param([string] $AppDir)

  $exe = Join-Path $AppDir 'Freebuff.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    $found = @(Get-ChildItem -LiteralPath $AppDir -Filter '*.exe' -File -ErrorAction SilentlyContinue |
      Sort-Object -Property Name)
    if ($found.Count -gt 0) { $exe = $found[0].FullName } else { $exe = $null }
  }

  if ($exe) {
    try {
      $info = (Get-Item -LiteralPath $exe).VersionInfo
      foreach ($versionText in @("$($info.ProductVersion)", "$($info.FileVersion)")) {
        if ($versionText -match '\d+\.\d+\.\d+') { return $versionText.Trim() }
      }
    } catch {
      # No version resource, or a file that is not a Windows executable.
    }
  }

  $leaf = Split-Path -Leaf $AppDir
  if ($leaf -match '^app-(.+)$') { return $Matches[1] }
  return 'unknown'
}

# ------------------------------------------------------- processes and clocks

function Get-ProcessPath {
  param($Process)
  try { return $Process.Path } catch { return '' }
}

<#
Every process that is plausibly this install's orchestrator, as objects with an id
and a start time.

Two ways in, because the orchestrator is not the only thing the app starts:

  - the app's own process, matched by name and by living inside the install folder
  - anything whose command line *ends* with the orchestrator file - the bundled
    runtime that actually reads it

The second one is matched on the end of the command line on purpose. A window
title, a log path, an editor or a Get-Content on the file all *mention* it; only
the process actually running it ends with it. Without that rule a check that
happened to name the path would find itself and call the app verified.

Both readings are best-effort by nature: Path is empty for a process this user
cannot open, and Win32_Process needs more rights for other users' processes. An
unknown process is treated as absent, never as a pass.
#>
function Get-OrchestratorProcesses {
  param([string] $AppDir, [string] $Target)

  $seen = @{}
  $out = New-Object System.Collections.Generic.List[object]

  $note = {
    param($processId, $start)
    if (-not $processId) { return }
    $key = "$processId"
    if ($seen.ContainsKey($key)) { return }
    $seen[$key] = $true
    $out.Add([pscustomobject]@{ Id = [int]$processId; Start = $start })
  }

  foreach ($process in @(Get-Process -Name 'Freebuff*' -ErrorAction SilentlyContinue)) {
    $exe = Get-ProcessPath $process
    if (-not $exe) { continue }
    if (-not (Test-UnderPath -Root $AppDir -Path $exe)) { continue }
    $start = $null
    try { $start = [DateTimeOffset]$process.StartTime } catch { $start = $null }
    & $note $process.Id $start
  }

  if ($script:IsWindowsOS) {
    foreach ($row in @(Get-CimInstance -ClassName Win32_Process -Filter "Name LIKE 'Freebuff%'" `
          -Property ProcessId, ExecutablePath, CommandLine, CreationDate -ErrorAction SilentlyContinue)) {
      $start = ConvertTo-StartTime $row.CreationDate
      $exe = "$($row.ExecutablePath)"
      if ($exe -and (Test-UnderPath -Root $AppDir -Path $exe)) {
        & $note $row.ProcessId $start
        continue
      }
      $commandLine = "$($row.CommandLine)"
      if (-not $commandLine) { continue }
      $tail = $commandLine.TrimEnd('"').TrimEnd()
      if ($tail.Length -lt $Target.Length) { continue }
      if ($tail.Substring($tail.Length - $Target.Length) -eq $Target) {
        & $note $row.ProcessId $start
      }
    }
  }

  return $out
}

function ConvertTo-StartTime {
  param($Value)
  if (-not $Value) { return $null }
  try {
    if ($Value -is [datetime]) { return [DateTimeOffset]$Value }
    Add-Type -AssemblyName System.Management -ErrorAction SilentlyContinue
    return [DateTimeOffset][System.Management.ManagementDateTimeConverter]::ToDateTime("$Value")
  } catch {
    return $null
  }
}

function Get-PatchTime {
  param([string] $Target)
  try { return [DateTimeOffset](Get-Item -LiteralPath $Target).LastWriteTime } catch { return $null }
}

# ---------------------------------------------------------------- relaunching
#
# A patch on disk is not a patch in effect, and 1.6 answered that with an
# instruction - "quit it completely and reopen it" - which was the one step
# people skipped. 1.7 does it: close the window politely, then force it, then
# start the app again and watch for the process that proves it read the file.
# Nothing here needs elevation.

function Stop-App {
  param([string] $AppDir, [string] $Target)

  $running = @(Get-OrchestratorProcesses -AppDir $AppDir -Target $Target)
  if ($running.Count -eq 0) { return $true }

  foreach ($entry in $running) {
    try { (Get-Process -Id $entry.Id -ErrorAction Stop).CloseMainWindow() | Out-Null } catch { }
  }

  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (@(Get-OrchestratorProcesses -AppDir $AppDir -Target $Target).Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 500
  }

  foreach ($entry in @(Get-OrchestratorProcesses -AppDir $AppDir -Target $Target)) {
    try { Stop-Process -Id $entry.Id -Force -ErrorAction Stop } catch { }
  }
  Start-Sleep -Seconds 1
  return (@(Get-OrchestratorProcesses -AppDir $AppDir -Target $Target).Count -eq 0)
}

function Start-App {
  param([string] $AppDir)

  $exe = Join-Path $AppDir 'Freebuff.exe'
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
    $exe = $null
    $found = @(Get-ChildItem -LiteralPath $AppDir -Filter 'Freebuff.exe' -File -Recurse -ErrorAction SilentlyContinue |
      Select-Object -First 1)
    if ($found.Count -gt 0) { $exe = $found[0].FullName }
  }
  if (-not $exe) { return $false }

  try { Start-Process -FilePath $exe -ErrorAction Stop | Out-Null } catch { return $false }
  return $true
}

function Restart-App {
  param([string] $AppDir, [string] $Target)
  if (-not (Stop-App -AppDir $AppDir -Target $Target)) { return $false }
  return (Start-App -AppDir $AppDir)
}

# A process that started before the patch was written is still running the old
# bytes. Both times come from the OS at one-second resolution, so the same
# two-second tolerance Wait-ForRelaunch uses applies here.
function Test-StalePatch {
  param([string] $AppDir, [string] $Target)

  $patchTime = Get-PatchTime -Target $Target
  if (-not $patchTime) { return $false }

  foreach ($entry in @(Get-OrchestratorProcesses -AppDir $AppDir -Target $Target)) {
    if (-not $entry.Start) { continue }
    if ($entry.Start.UtcDateTime -lt $patchTime.UtcDateTime.AddSeconds(-2)) { return $true }
  }
  return $false
}

# ------------------------------------------------------------- focus sessions
#
# A session is a timestamp in a file, nothing more. No timer process, no daemon,
# no network: status reads it, install ignores it, and the ads coming back is
# unfocus. That is the whole mechanism, and it is deliberately the whole
# mechanism - a background job that could revert a patch is a background job that
# could revert one at the wrong time.

function ConvertTo-FocusSeconds {
  param([string] $Value)

  # No default: `focus` with no argument means "until unfocus", so guessing a
  # duration here would contradict the reader. 25m, 90m, 2h, 45 and 45s all parse.
  $raw = ''
  if (-not [string]::IsNullOrWhiteSpace($Value)) { $raw = $Value.Trim().ToLowerInvariant() }
  if (-not $raw) { return $null }

  $seconds = 0
  if ($raw -match '^(\d+)s$') { $seconds = [int]$Matches[1] }
  elseif ($raw -match '^(\d+)m$') { $seconds = [int]$Matches[1] * 60 }
  elseif ($raw -match '^(\d+)h$') { $seconds = [int]$Matches[1] * 3600 }
  elseif ($raw -match '^\d+$') { $seconds = [int]$raw * 60 }
  else { return $null }

  if ($seconds -lt 5 -or $seconds -gt 86400) { return $null }
  return $seconds
}

function Get-SessionPath {
  return (Join-Path $SessionDir 'session')
}

function Get-SessionEnds {
  $path = Get-SessionPath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }

  $line = @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^endsAt=' } | Select-Object -First 1)
  if ($line.Count -eq 0) { return $null }

  $text = ("$($line[0])" -replace '^endsAt=', '').Trim()
  if ($text -notmatch '^\d+$') { return $null }

  try { return [DateTimeOffset]::FromUnixTimeSeconds([int64]$text) } catch { return $null }
}

# --------------------------------------------------------- session state file
#
# One small key=value file, the same shape the macOS and Linux tools write, so a
# session is legible with Get-Content:
#
#   mode      until-unfocus | until | session
#   run       what identifies this focus: unfocus and a second focus use it
#   target    the orchestrator.js this focus patched
#   backup    the pristine copy to put back
#   stamp     "length:ticks" of the patched file, so the watcher writes only
#             while the bytes are still the ones the patch wrote
#   endsAt    the deadline, for mode=until
#   pid       the orchestrator this session waits on, for mode=session
#   watcher   the watcher itself

function Get-SessionKey {
  param([string] $Key)
  $path = Get-SessionPath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $pattern = '^' + [regex]::Escape($Key) + '='
  $line = @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue |
    Where-Object { $_ -match $pattern } | Select-Object -First 1)
  if ($line.Count -eq 0) { return $null }
  return (("$($line[0])") -replace $pattern, '')
}

function Set-SessionKey {
  param([string] $Key, [string] $Value, [string] $Token = '')
  $path = Get-SessionPath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
  if ($Token -and (Get-SessionKey 'run') -ne $Token) { return $false }

  $pattern = '^' + [regex]::Escape($Key) + '='
  $done = $false
  $out = @()
  foreach ($line in @(Get-Content -LiteralPath $path -ErrorAction SilentlyContinue)) {
    if ($line -match $pattern) { $out += "$Key=$Value"; $done = $true }
    else { $out += $line }
  }
  if (-not $done) { $out += "$Key=$Value" }
  try {
    [System.IO.File]::WriteAllText($path, (($out -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  } catch { return $false }
  return $true
}

# Length and last-write ticks: two cheap facts that together change for any edit a
# Freebuff update or a fresh install would make.
function Get-FileStamp {
  param([string] $Path)
  try {
    $item = Get-Item -LiteralPath $Path -ErrorAction Stop
    return ("{0}:{1}" -f $item.Length, $item.LastWriteTimeUtc.Ticks)
  } catch { return $null }
}

function Test-ProcessAlive {
  param($ProcessId)
  if (-not $ProcessId) { return $false }
  if ("$ProcessId" -notmatch '^\d+$') { return $false }
  try { return ($null -ne (Get-Process -Id ([int]$ProcessId) -ErrorAction Stop)) } catch { return $false }
}

function Get-NewestOrchestratorPid {
  param([string] $AppDir, [string] $Target)
  $best = $null
  foreach ($entry in @(Get-OrchestratorProcesses -AppDir $AppDir -Target $Target)) {
    if (-not $entry.Start) { continue }
    if (-not $best -or $entry.Start -gt $best.Start) { $best = $entry }
  }
  if ($best) { return [int]$best.Id }
  return 0
}

# The copy of this tool a watcher can run: the file on disk, or the installed one
# when this run came through irm | iex and has no file behind it.
function Get-SelfPath {
  if ($HaveLocal -and $PSCommandPath -and (Test-Path -LiteralPath $PSCommandPath -PathType Leaf)) {
    return $PSCommandPath
  }
  if (Test-Path -LiteralPath $InstalledSelf -PathType Leaf) { return $InstalledSelf }
  return $null
}

# Start-Process joins -ArgumentList with spaces and does not quote what it joins,
# so any path with a space in it would split into two arguments. Every value below
# is handed over already quoted, which the child's own parser unwraps.
function Get-QuotedArg {
  param([string] $Value)
  return ('"' + $Value + '"')
}

# One detached PowerShell per timed or session focus. -WindowStyle Hidden keeps it
# out of the way; -PassThru is the pid, so focus records it immediately rather than
# waiting for the watcher to write its own.
function Start-SessionWatcher {
  $self = Get-SelfPath
  if (-not $self) { return $false }
  $hostExe = $null
  try { $hostExe = (Get-Process -Id $PID).Path } catch { $hostExe = $null }
  if (-not $hostExe) { try { $hostExe = Join-Path $PSHOME 'powershell.exe' } catch { $hostExe = $null } }
  if (-not $hostExe) { return $false }

  $run = Get-SessionKey 'run'
  if (-not $run) { return $false }
  $target = Get-SessionKey 'target'
  $backup = Get-SessionKey 'backup'
  $stamp = Get-SessionKey 'stamp'
  $mode = Get-SessionKey 'mode'
  $pidText = Get-SessionKey 'pid'; if (-not $pidText) { $pidText = '0' }
  $endsText = Get-SessionKey 'endsAt'; if (-not $endsText) { $endsText = '0' }

  $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Get-QuotedArg $self), '__watch')
  if ($script:InstalledApp) { $argv += @('-App', (Get-QuotedArg $script:InstalledApp)) }
  $argv += @(
    '-BackupDir', (Get-QuotedArg "$BackupDir"),
    '-SessionDir', (Get-QuotedArg "$SessionDir"),
    '-WatchRun', "$run",
    '-WatchTarget', (Get-QuotedArg "$target"),
    '-WatchBackup', (Get-QuotedArg "$backup"),
    '-WatchStamp', "$stamp",
    '-WatchMode', "$mode",
    '-WatchPid', "$pidText",
    '-WatchEnds', "$endsText",
    '-Interval', "$($script:Interval)"
  )

  # -WindowStyle is Windows-only, and asking for it elsewhere is a hard error
  # rather than a no-op, so it is only added on the platform that has it.
  # Redirected, because a child that inherits this process's stdout keeps it open:
  # the `focus` run it was started from would never see its own output end. The
  # two files sit beside the session and are the only thing a watcher ever writes
  # beyond its log line.
  $startArgs = @{
    FilePath               = $hostExe
    ArgumentList           = $argv
    PassThru               = $true
    ErrorAction            = 'Stop'
    RedirectStandardOutput = (Join-Path $SessionDir 'watch.out')
    RedirectStandardError  = (Join-Path $SessionDir 'watch.err')
  }
  if ($script:IsWindowsOS) { $startArgs['WindowStyle'] = 'Hidden' }

  try { $proc = Start-Process @startArgs }
  catch { return $false }
  if ($proc -and $proc.Id) { Set-SessionKey -Key 'watcher' -Value "$($proc.Id)" -Token "$run" | Out-Null }
  return $true
}

# Stop a running watcher and give it a moment to be gone. unfocus and a second
# focus both call this: two watchers on one session would race to restore the same
# file. The session file going away is the other half - a watcher with no session
# left exits on its next tick.
function Stop-SessionWatcher {
  $watcher = Get-SessionKey 'watcher'
  if (-not $watcher -or "$watcher" -notmatch '^\d+$') { return }
  try { Stop-Process -Id ([int]$watcher) -Force -ErrorAction Stop } catch { }
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Test-ProcessAlive $watcher)) { break }
    Start-Sleep -Milliseconds 100
  }
}

function Write-WatchLine {
  param([string] $Text)
  try {
    Add-Content -LiteralPath "$(Get-SessionPath).log" -ErrorAction Stop `
      -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text)
  } catch { }
}

# Put the pristine file back, but only if it is still the file the patch wrote.
# Anything else means someone else has already changed it, and silence is the only
# honest answer to that.
function Complete-Watch {
  param([string] $Reason)
  $current = Get-FileStamp $script:WatchTarget
  if ($current -ne $script:WatchStamp) {
    Write-WatchLine "$Reason - left the file alone: it changed after the patch"
  } elseif ($script:WatchBackup -and (Test-Path -LiteralPath $script:WatchBackup -PathType Leaf)) {
    try {
      Copy-Item -LiteralPath $script:WatchBackup -Destination $script:WatchTarget -Force -ErrorAction Stop
      Write-WatchLine "$Reason - restored $($script:WatchTarget)"
    } catch {
      Write-WatchLine "$Reason - could not restore $($script:WatchTarget) (run: unfocus)"
    }
  }
  if ((Get-SessionKey 'run') -eq $script:WatchRun) {
    try { Remove-Item -LiteralPath (Get-SessionPath) -Force -ErrorAction Stop } catch { }
  }
}

# The watcher. Started by focus, never typed: it waits for the one thing that ends
# this focus, puts the pristine file back, and leaves.
function Invoke-Watch {
  $script:InstalledApp = $App
  if (-not $script:WatchRun) { exit 0 }
  if (-not $script:WatchTarget) { exit 0 }
  if (-not (Test-Path -LiteralPath $script:WatchTarget -PathType Leaf)) { exit 0 }
  if (-not (Set-SessionKey -Key 'watcher' -Value "$PID" -Token $script:WatchRun)) { exit 0 }

  Write-WatchLine "watching $($script:WatchMode) pid $($script:WatchPid) - $($script:WatchTarget)"

  while ($true) {
    if ((Get-SessionKey 'run') -ne $script:WatchRun) {
      Write-WatchLine 'standing down: the session was cleared or replaced'
      exit 0
    }

    if ($script:WatchMode -eq 'session') {
      if (-not $script:WatchPid -or $script:WatchPid -eq '0') {
        $found = Get-NewestOrchestratorPid -AppDir $script:InstalledApp -Target $script:WatchTarget
        if ($found) {
          $script:WatchPid = "$found"
          Set-SessionKey -Key 'pid' -Value "$found" -Token $script:WatchRun | Out-Null
          Write-WatchLine "Freebuff opened, pid $found"
        }
      } elseif (-not (Test-ProcessAlive $script:WatchPid)) {
        Complete-Watch 'Freebuff quit'
        exit 0
      }
    } elseif ($script:WatchEnds -match '^\d+$') {
      if ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() -ge [int64]$script:WatchEnds) {
        Complete-Watch 'the deadline passed'
        exit 0
      }
    }

    Start-Sleep -Seconds $script:Interval
  }
}

function Get-FocusMode {
  if ([string]::IsNullOrWhiteSpace($FocusArg)) { return 'until-unfocus' }
  if ($FocusArg.Trim() -match '^(?i)session$') { return 'session' }
  return 'until'
}

# install, then record what should end it. The patch is the thing that hides ads;
# the session file only says what will put it back, so a failed install is a
# failed focus and nothing is recorded.
function Complete-Focus {
  if (-not $script:FocusMode) { return }
  if (-not $script:InstalledTarget) { return }

  try {
    if (-not (Test-Path -LiteralPath $SessionDir -PathType Container)) {
      New-Item -ItemType Directory -Path $SessionDir -Force | Out-Null
    }
  } catch { Die "cannot create $SessionDir" }

  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $stamp = Get-FileStamp $script:InstalledTarget
  $backup = Join-Path $BackupDir "orchestrator.js.$($script:InstalledVersion).orig"
  $run = "$PID-$now"
  $ends = 0
  $watchedPid = '0'

  if ($script:FocusMode -eq 'until') {
    $ends = $now + $script:FocusSeconds
  } elseif ($script:FocusMode -eq 'session') {
    $watchedPid = "$(Get-NewestOrchestratorPid -AppDir $script:InstalledApp -Target $script:InstalledTarget)"
  }

  $lines = @(
    "mode=$($script:FocusMode)",
    "run=$run",
    "started=$now",
    "target=$($script:InstalledTarget)",
    "backup=$backup",
    "stamp=$stamp"
  )
  if ($ends -gt 0) {
    $lines += "endsAt=$ends"
    $lines += "duration=$($script:FocusSeconds)s"
  }
  if ($watchedPid -ne '0') { $lines += "pid=$watchedPid" }

  try {
    [System.IO.File]::WriteAllText(
      (Get-SessionPath),
      (($lines -join "`n") + "`n"),
      (New-Object System.Text.UTF8Encoding($false))
    )
  } catch {
    Die "cannot write $(Get-SessionPath): $($_.Exception.Message)"
  }

  if ($script:FocusMode -ne 'until-unfocus') {
    if (-not (Start-SessionWatcher)) { Warn "could not start the watcher - see $SessionDir" }
  }

  Say ''
  switch ($script:FocusMode) {
    'until-unfocus' {
      Write-Piece 'Focus is on.' 'White'
      Say ' Ads stay off until you end it:'
      Say "    $(Get-CommandName) unfocus"
      Say 'Nothing else ends this one - closing Freebuff and opening it again'
      Say 'keeps the quiet, because the patched file is still on disk.'
    }
    'session' {
      Write-Piece 'Focus for this session.' 'White'
      Say ' Ads come back when you quit Freebuff:'
      Say "    $(Get-CommandName) unfocus     (end it now, without quitting)"
      if ($watchedPid -ne '0') {
        Say "Watching pid $watchedPid. Quit Freebuff and open it again: the next"
        Say 'launch reads the original file, so the ads are back with nothing to type.'
      } else {
        Say 'Freebuff is not open. The watcher starts when it is, and restores the'
        Say 'file when it quits.'
      }
    }
    default {
      $clock = [DateTimeOffset]::FromUnixTimeSeconds($ends).ToLocalTime().ToString('HH:mm')
      Write-Piece "Focus until $clock." 'White'
      Say ' After that the ads come back on their own - the original file is'
      Say 'restored at the deadline:'
      Say "    $(Get-CommandName) unfocus     (end it now)"
      Say 'A window that is open at the deadline keeps the code it started with,'
      Say 'so it stays quiet until it restarts.'
    }
  }
}

# End any focus and take the session file with it, so a stale one cannot outlive
# the patch it describes. The watcher is stopped first: nothing may be waiting to
# write the file this run is restoring.
function Complete-Unfocus {
  Stop-SessionWatcher
  $path = Get-SessionPath
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    try { Remove-Item -LiteralPath $path -Force -ErrorAction Stop } catch { }
  }
  if ($script:EndFocus) { Say '  focus    cleared' }
}

# One line in status: what kind of focus is on, and what will end it. Silent when
# there is no session file at all, because most runs have nothing to say.
function Show-SessionLine {
  $path = Get-SessionPath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }

  $mode = Get-SessionKey 'mode'
  if (-not $mode) { if (Get-SessionEnds) { $mode = 'until' } else { $mode = 'until-unfocus' } }

  switch ($mode) {
    'until-unfocus' {
      Say "  focus    on - until you run: $(Get-CommandName) unfocus"
    }
    'session' {
      $watched = Get-SessionKey 'pid'
      if (-not $watched) {
        Say '  focus    on - until Freebuff quits (waiting for it to open)'
      } elseif (Test-ProcessAlive $watched) {
        Say "  focus    on - until Freebuff quits (pid $watched)"
      } else {
        Say '  focus    ended with Freebuff - ads are back on the next launch'
        Say "           run: $(Get-CommandName) unfocus   (to restore it now)"
      }
    }
    default {
      $ends = Get-SessionEnds
      if (-not $ends) { Say "  focus    on - until you run: $(Get-CommandName) unfocus"; return }
      $clock = $ends.ToLocalTime().ToString('HH:mm')
      if ($ends -gt [DateTimeOffset]::Now) {
        $left = [int][Math]::Ceiling(($ends - [DateTimeOffset]::Now).TotalMinutes)
        Say "  focus    on until $clock ($left min left)"
      } else {
        Say "  focus    deadline passed at $clock - ads are back on the next launch"
        Say "           run: $(Get-CommandName) unfocus   (to restore it now)"
      }
    }
  }
}

function Get-SpanWords {
  param([int] $Seconds)
  $secs = $Seconds
  $when = 'after'
  if ($secs -lt 0) {
    $secs = 0 - $secs
    $when = 'before'
  }
  if ($secs -lt 90) { return "${secs}s $when the patch" }
  return ('{0}m {1} the patch' -f [int]($secs / 60), $when)
}

<#
The whole line about the two times. A delta inside the last two seconds is
reported as what it is - as close as the clock here resolves - rather than as
"1s before the patch", which would read as a contradiction next to a pass.
#>
function Get-ClockWords {
  param([int] $Delta)
  if ($Delta -lt -2) { return "that is $(Get-SpanWords $Delta), so it has not been relaunched since" }
  if ($Delta -le 1) { return 'that is within a second of the patch, as close as this clock resolves' }
  return "that is $(Get-SpanWords $Delta)"
}

function Get-FriendlyTime {
  param($When)
  if (-not $When) { return 'unknown' }
  return $When.ToString('yyyy-MM-dd HH:mm:ss', [System.Globalization.CultureInfo]::InvariantCulture)
}

# -------------------------------------------------------------- patch engine

# Ad code, for the corroboration a relaxation needs. Case-insensitive, like the
# macOS tool: on a minified bundle the casing of a name is not something to bet on.
$AdNear = [regex]::new(
  '(?:displayAd|auction|adRequest|adsRequest|gravity|sponsor|track/click|adServer|adUnit|campaign|\bads?\b)',
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

<#
The patch table - the same two anchors as the macOS tool, the same counts, and the
same replacements, so one `scan` report re-anchors both.

Each patch carries an ordered list of strategies. The first is the exact literal
this tool was verified against. The second is a relaxation, so a Freebuff release
that renames a function but keeps the shape does not brick the tool. A relaxation
only counts as a match when it hits the expected number of times *and* every hit
has ad code beside it, so a decoy `if (somethingTest(process.env))` elsewhere in a
9 MB bundle is never mistaken for the ad render path. When nothing matches
exactly, the tool still refuses - and points at `scan`, which prints what this
build actually has.

There is deliberately no `post` anchor, and it must not come back without a
reason. In 0.0.164 `async post(` matches the ad break-event *telemetry* poster and
the logs shipper that posts to /api/logs. Patching the latter would break
Freebuff's own logging and block no ads, and a literal that keeps matching two
unrelated helpers is exactly what this tool must not aim at. The `request` anchor
already stops the ad API being reached.
#>
$Patches = @(
  @{
    Id     = 'render'
    Layer  = 'display'
    What   = 'force the ad auction to return no ads'
    Expect = 1
    Tries  = @(
      @{
        Name = 'literal'
        Find = [regex]::new([regex]::Escape('if (localAgenticTestCampaign(process.env))'))
        Near = $null
        Repl = 'if (true/*FBD-ADS-OFF:render*/)'
      },
      @{
        Name = 'relaxed'
        Find = [regex]::new('\bif\s*\(\s*[A-Za-z_$][\w$]*Test[A-Za-z_$]*\s*\(\s*process\.env\s*\)\s*\)')
        Near = $AdNear
        Repl = 'if (true/*FBD-ADS-OFF:render*/)'
      }
    )
  },
  @{
    Id     = 'request'
    Layer  = 'request'
    What   = 'stop the ad client from reaching the ad API'
    Expect = 1
    Tries  = @(
      @{
        Name = 'literal'
        # Re-anchored against 0.0.164, where this is unique. The second argument
        # is matched name-agnostically because it is a minifier-supplied local
        # (`path27` in the build this was verified against) and will be renamed by
        # any future build; the shape around it will not. The other six
        # `async request(` definitions in 0.0.164 belong to a proxy, the sites
        # client and the config clients, and none of them has this signature.
        Find = [regex]::new('async request\(method, [A-Za-z_$][\w$]*, payload, timeoutMs = REQUEST_TIMEOUT_MS\) \{')
        Near = $null
        Repl = 'async request(method, path, payload, timeoutMs = REQUEST_TIMEOUT_MS) { return { ok: !1, status: 0, message: "" }; /*FBD-ADS-OFF:request*/'
      },
      @{
        Name = 'relaxed'
        Find = [regex]::new('(?<![.\w$])(?:(?:async|static)\s+)*request\s*\([^)]*\)\s*\{')
        Near = $AdNear
        Repl = 'async request(method, path, payload, timeoutMs = REQUEST_TIMEOUT_MS) { return { ok: !1, status: 0, message: "" }; /*FBD-ADS-OFF:request*/'
      }
    )
  }
)

# A probe is a substring a person greps for by hand, matched case-insensitively: a
# case-sensitive `agenticTestCampaign` misses `localAgenticTestCampaign`, which
# reads as "the ad runtime is gone" when it is right there.
$Probes = @(
  'displayAd', 'auction', 'agenticTestCampaign', 'testCampaign', 'process.env',
  'async post(', 'async request(', 'gravity', 'sponsor', 'track/click', 'NODE_ENV'
)

function Get-LiteralCount {
  param([string] $Source, [string] $Needle)
  if ([string]::IsNullOrEmpty($Needle)) { return 0 }
  $count = 0
  $at = 0
  while (($at = $Source.IndexOf($Needle, $at, [StringComparison]::Ordinal)) -ge 0) {
    $count++
    $at += $Needle.Length
  }
  return $count
}

<#
A relaxation has to be corroborated: ad code within 320 characters of the hit. The
window is measured in characters here where the macOS tool measured bytes - a
9 MB JavaScript bundle is ASCII in practice, and the window is a heuristic either
way. Literals have no `near` and are trusted as they always were.
#>
function Test-Near {
  param([string] $Source, [int] $Index, [int] $Length, [regex] $Near)
  if (-not $Near) { return $true }
  $from = $Index - 320
  if ($from -lt 0) { $from = 0 }
  $span = $Length + 640
  if ($from + $span -gt $Source.Length) { $span = $Source.Length - $from }
  if ($span -le 0) { return $false }
  return $Near.IsMatch($Source.Substring($from, $span))
}

function Get-Window {
  param([string] $Source, [int] $Index, [int] $Length, [int] $Span = 140)
  $from = $Index - $Span
  if ($from -lt 0) { $from = 0 }
  $take = $Length + 2 * $Span
  if ($from + $take -gt $Source.Length) { $take = $Source.Length - $from }
  if ($take -le 0) { return '' }
  return ($Source.Substring($from, $take) -replace '\s+', ' ').Trim()
}

# The first strategy this source can be patched with, the notes the report needs,
# and the largest hit count seen - the counts are what make a refusal readable.
function Get-UsableStrategy {
  param([string] $Source, $Patch)

  $notes = New-Object System.Collections.Generic.List[string]
  $hits = 0

  foreach ($strategy in $Patch.Tries) {
    $matches = $strategy.Find.Matches($Source)
    $count = $matches.Count
    if ($count -eq 0) { continue }

    $near = 0
    if ($strategy.Near) {
      foreach ($match in $matches) {
        if (Test-Near -Source $Source -Index $match.Index -Length $match.Length -Near $strategy.Near) { $near++ }
      }
      $notes.Add(('{0}: {1} match(es), {2} beside ad code' -f $strategy.Name, $count, $near))
    } else {
      # A strategy with no `near` is trusted as written, so an adjacency count for
      # it would be vacuous - "6 beside ad code" would imply a corroboration that
      # never ran. Say which it is.
      $notes.Add(('{0}: {1} match(es), trusted as written' -f $strategy.Name, $count))
    }

    if ($count -gt $hits) { $hits = $count }
    if ($count -ne $Patch.Expect) { continue }
    if ($strategy.Near -and $near -ne $count) { continue }

    # The first usable strategy wins, and the rest are not even run: on a 9 MB file
    # the literal is the common case, and scanning it once beats scanning every
    # relaxation looking for a better answer that does not exist.
    return [pscustomobject]@{ Strategy = $strategy; Notes = $notes; Hits = $hits }
  }

  return [pscustomobject]@{ Strategy = $null; Notes = $notes; Hits = $hits }
}

function Read-Orchestrator {
  param([string] $Target)

  try { $bytes = [System.IO.File]::ReadAllBytes($Target) }
  catch { Die "cannot read ${Target}: $($_.Exception.Message)" }

  # Never rewrite a file in an encoding this tool did not read: a UTF-16 bundle
  # written back as UTF-8 would be a corrupt bundle, and a silently re-encoded one
  # is a worse outcome than a refusal. A file that is not valid UTF-8 is refused
  # for the same reason.
  if ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
    Die 'orchestrator.js is UTF-16; this tool only rewrites UTF-8 and will not convert it'
  }

  $hasBom = $false
  $offset = 0
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $hasBom = $true
    $offset = 3
  }

  $text = $null
  try {
    $encoding = New-Object System.Text.UTF8Encoding($hasBom, $true)
    $text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
  } catch {
    Die 'orchestrator.js is not valid UTF-8; this tool will not rewrite it'
  }

  return [pscustomobject]@{ Text = $text; HasBom = $hasBom; Bytes = $bytes.Length }
}

<#
The two ends of the write, kept together.

The new file is built in the target's own folder, so the replacement is a
same-volume operation, and then moved into place with File.Replace, which keeps
the original's ACL and attributes - the things Windows actually enforces. If that
is refused, an in-place copy overwrites the content and the destination keeps the
ACL it had, since the file is not recreated. Neither path touches anything but the
one file, and neither leaves a temporary behind.
#>
function Write-Orchestrator {
  param([string] $Target, [string] $Text, [bool] $HasBom)

  $dir = Split-Path -Parent $Target
  $temp = Join-Path $dir ('.fbd-new-' + [guid]::NewGuid().ToString('N'))
  $encoding = New-Object System.Text.UTF8Encoding($HasBom)

  try {
    [System.IO.File]::WriteAllText($temp, $Text, $encoding)
    try {
      [System.IO.File]::Replace($temp, $Target, $null, $false)
    } catch {
      [System.IO.File]::Copy($temp, $Target, $true)
    }
  } finally {
    if ([System.IO.File]::Exists($temp)) {
      try { [System.IO.File]::Delete($temp) } catch { }
    }
  }
}

# ------------------------------------------------------------ the report rows

function Format-PatchRow {
  param($Row)

  Write-Host -NoNewline ('  {0,-9} ' -f $Row.Id)
  switch ($Row.State) {
    'applied' { Write-Piece 'applied' 'Green' }
    'ready' { Write-Piece 'ready' 'Yellow' }
    'skipped' { Write-Piece 'skipped' 'DarkGray' }
    'failed' { Write-Piece 'failed' 'Red' }
    'broken' { Write-Piece 'broken' 'Red' }
    'ambiguous' { Write-Piece 'ambiguous' 'Red' }
    'unknown' { Write-Piece 'not found' 'Red' }
    default { Write-Piece $Row.State 'Red' }
  }
  if ($Row.Via -eq 'relaxed') {
    Write-Host -NoNewline ' '
    Write-Piece '(via relaxed match)' 'DarkGray'
  }
  Write-Host ''

  # The counts, when the anchor is not simply applied. This is the line that turns
  # "ambiguous" into something a reader can act on without running scan.
  if ((@('ambiguous', 'unknown', 'broken', 'failed') -contains $Row.State) -and $Row.Notes) {
    Write-Host -NoNewline '            '
    Write-Piece $Row.Notes 'DarkGray'
    Write-Host ''
  }
}

function Show-Report {
  param($Result)
  foreach ($row in $Result.Rows) { Format-PatchRow $row }
}

# Everything this tool can do, at the one moment a reader cares: right after an
# install that found nothing to write. Printed by install only - `status` stays a
# report and `help` stays the long form.
function Show-NextSteps {
  Write-Piece '  What this tool can do' 'White'
  Write-Host ''
  Say '  status        what is applied, and any focus - changes nothing'
  Say '  focus         quiet until you run unfocus'
  Say '  focus 25m     quiet until a deadline: 25m, 90m, 2h, 45s'
  Say '  focus session quiet until Freebuff quits'
  Say '  unfocus       end it now and bring the ads back'
  Say '  verify        wait for a relaunch, then check what it loaded'
  Say '  scan          every anchor this build contains - read-only'
  Say '  revert        restore the pristine backup'
  Say '  doctor        environment report'
  Say '  update        fetch the newest tool, replace it, then patch again'
  Say '  uninstall     remove the command; the patch stays'
  Say '  help          every command and option'
  Say ''
  if (Test-Path -LiteralPath (Join-Path $BinDir "$CommandName.cmd") -PathType Leaf) {
    Say "  Run them as:  $CommandName <command>"
    if (-not (Test-PathHasBin)) {
      Say "  ($BinDir is not on PATH in this shell - open a new terminal)"
    }
  } else {
    Say "  Run them as:  $(Get-CommandName) <command>"
    if (-not $HaveLocal) {
      Say '  No local copy (this run came through irm | iex)? Install the command once:'
      Say "    irm $Origin/downloads/freebuff-focus-desktop.ps1 | iex"
    }
  }
}

function Test-AllApplied {
  param($Result)
  if ($Result.Verdict -ne 'ok') { return $false }
  foreach ($row in $Result.Rows) {
    if ($row.State -eq 'ready') { return $false }
  }
  return $true
}

function Invoke-Engine {
  param(
    [ValidateSet('check', 'apply')] [string] $Mode,
    [string] $Target,
    [bool] $DeepScan
  )

  $read = Read-Orchestrator -Target $Target
  $source = $read.Text
  $original = $source
  $rows = New-Object System.Collections.Generic.List[object]

  foreach ($patch in $Patches) {
    $markerText = "FBD-ADS-OFF:$($patch.Id)"
    $skip = ($patch.Layer -eq 'request' -and -not $DeepScan)

    $markerCount = Get-LiteralCount -Source $source -Needle $markerText
    $state = ''
    $via = '-'
    $anchors = 0
    $notes = ''

    if ($skip) {
      $state = 'skipped'
    } elseif ($markerCount -eq $patch.Expect) {
      $state = 'applied'
    } elseif ($markerCount -gt 0) {
      $state = 'broken'
    } else {
      $evaluation = Get-UsableStrategy -Source $source -Patch $patch
      $notes = ($evaluation.Notes -join '; ')

      if ($evaluation.Strategy) {
        $via = $evaluation.Strategy.Name
        $anchors = $patch.Expect
        $state = 'ready'

        if ($Mode -eq 'apply') {
          $find = $evaluation.Strategy.Find
          $replacement = $evaluation.Strategy.Repl
          $substitutions = $find.Matches($source).Count
          $source = $find.Replace($source, [System.Text.RegularExpressions.MatchEvaluator] { param($m) $replacement })
          if ($substitutions -eq $patch.Expect) {
            $state = 'applied'
            $markerCount = $patch.Expect
            $anchors = 0
          } else {
            $state = 'failed'
          }
        }
      } else {
        # Nothing usable. A hit count that is merely wrong is ambiguous (the shape
        # is there, the count is not); no hits at all is unknown.
        if ($evaluation.Hits) { $state = 'ambiguous' } else { $state = 'unknown' }
        $anchors = $patch.Tries[0].Find.Matches($source).Count
      }
    }

    $rows.Add([pscustomobject]@{
        Id      = $patch.Id
        What    = $patch.What
        State   = $state
        Via     = $via
        Anchors = $anchors
        Markers = $markerCount
        Expect  = $patch.Expect
        Notes   = $notes
      })
  }

  $failed = 0
  foreach ($row in $rows) {
    if (@('broken', 'unknown', 'ambiguous', 'failed') -contains $row.State) { $failed++ }
  }

  $changed = ($source -ne $original)
  $written = $false
  if ($Mode -eq 'apply' -and $changed -and $failed -eq 0) {
    Write-Orchestrator -Target $Target -Text $source -HasBom $read.HasBom
    $written = $true
  }

  $verdict = 'ok'
  if ($failed) { $verdict = 'fail' }

  return [pscustomobject]@{
    Verdict = $verdict
    Failed  = $failed
    Written = $written
    Rows    = $rows
  }
}

function Get-ProbeCounts {
  param([string] $Source)
  $counts = @{}
  foreach ($probe in $Probes) {
    $counts[$probe] = [regex]::Matches($source, [regex]::Escape($probe), 'IgnoreCase').Count
  }
  return $counts
}

# The ad runtime this tool patches, as "auction 17 · gravity 4". Empty when none of
# those names appears at all - the one way this build can be said to have no ad
# code left for the patch to block. Read-only.
function Get-AdCodeLine {
  param([string] $Target)
  $parts = New-Object System.Collections.Generic.List[string]
  try {
    $source = (Read-Orchestrator -Target $Target).Text
    $counts = Get-ProbeCounts $source
    foreach ($name in @('auction', 'displayAd', 'gravity', 'sponsor', 'track/click')) {
      if ($counts[$name] -gt 0) { $parts.Add("$name $($counts[$name])") }
    }
  } catch {
    return ''
  }
  return ($parts -join ' · ')
}

<#
A read-only description of what this build actually contains. This is the payload
for a re-anchor: if a Freebuff update moves an anchor, `scan` shows every candidate
site and its surroundings, and nothing is written.
#>
function Get-ScanReport {
  param([string] $Target, [string] $AppDir, [bool] $DeepScan)

  $read = Read-Orchestrator -Target $Target
  $source = $read.Text
  $lines = New-Object System.Collections.Generic.List[string]

  $lines.Add('== environment ==')
  $lines.Add("  target   $Target")
  $lines.Add("  install  $AppDir")
  $lines.Add("  bytes    $($read.Bytes)")
  $lines.Add("  utf8-bom $($read.HasBom)")
  $lines.Add("  powershell $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))")
  $lines.Add('')

  foreach ($patch in $Patches) {
    $skip = ($patch.Layer -eq 'request' -and -not $DeepScan)
    $markerText = "FBD-ADS-OFF:$($patch.Id)"
    $markerCount = Get-LiteralCount -Source $source -Needle $markerText

    $lines.Add(('== {0} == {1} needed, {2} marker(s) already in place' -f $patch.Id, $patch.Expect, $markerCount))
    $lines.Add("   $($patch.What)")

    if ($skip) {
      $lines.Add('   skipped: -DisplayOnly')
      $lines.Add('')
      continue
    }

    foreach ($strategy in $patch.Tries) {
      $matches = $strategy.Find.Matches($source)
      $count = $matches.Count
      $near = 0
      if ($strategy.Near) {
        foreach ($match in $matches) {
          if (Test-Near -Source $source -Index $match.Index -Length $match.Length -Near $strategy.Near) { $near++ }
        }
      }

      $usable = ''
      if ($count -eq $patch.Expect -and ((-not $strategy.Near) -or $near -eq $count)) { $usable = '   <- usable' }

      if ($strategy.Near) {
        $lines.Add(('   {0,-8} {1} match(es), {2} beside ad code{3}' -f $strategy.Name, $count, $near, $usable))
      } else {
        $lines.Add(('   {0,-8} {1} match(es), trusted as written{2}' -f $strategy.Name, $count, $usable))
      }

      $shown = 0
      foreach ($match in $matches) {
        if ($shown -ge 3) { break }
        $shown++
        $lines.Add("     [$shown] $(Get-Window -Source $source -Index $match.Index -Length $match.Length)")
      }
    }

    $lines.Add('')
  }

  $lines.Add('== probes == (case-insensitive)')
  $counts = Get-ProbeCounts $source
  foreach ($probe in $Probes) {
    $lines.Add(('   {0,-20} {1}' -f $probe, $counts[$probe]))
    $shown = 0
    foreach ($match in [regex]::Matches($source, [regex]::Escape($probe), 'IgnoreCase')) {
      if ($shown -ge 2) { break }
      $shown++
      $lines.Add("     [$shown] $(Get-Window -Source $source -Index $match.Index -Length $match.Length -Span 90)")
    }
  }

  return (($lines -join [Environment]::NewLine) + [Environment]::NewLine)
}

# --------------------------------------------------------------- write access

<#
Is this file writable? The honest answer needs two things: the file itself, and
the folder it lives in, because replacing a file means creating and renaming
inside that folder. So the probe creates and removes its own temp file in the
folder - it changes nothing else, and a folder where that fails is a folder where
nothing this tool does could have worked.

It is still a probe, not a promise: a permission or a lock can change between here
and the write, which is why every write is wrapped and reports what blocked it.
Nothing is ever half-written: the new content is built elsewhere and moved in.
#>
function Test-CanWrite {
  param([string] $Target)

  $dir = Split-Path -Parent $Target
  $probe = Join-Path $dir ('.fbd-probe-' + [guid]::NewGuid().ToString('N'))
  try {
    $stream = [System.IO.File]::Create($probe)
    $stream.Dispose()
    [System.IO.File]::Delete($probe)
    return $true
  } catch {
    if ([System.IO.File]::Exists($probe)) {
      try { [System.IO.File]::Delete($probe) } catch { }
    }
    return $false
  }
}

<#
What to say when a write is refused, which on Windows is one of three things: the
file is open in the app, the folder needs an elevated shell, or the file carries
the read-only attribute. Naming the wrong one sends someone to the wrong setting,
so the exception is read rather than guessed at.
#>
function Show-WriteHelp {
  param([string] $Target, $ErrorRecord = $null)

  $message = ''
  $sharing = $false
  if ($ErrorRecord) {
    $message = "$($ErrorRecord.Exception.Message)"
    $hresult = 0
    try { $hresult = $ErrorRecord.Exception.HResult } catch { $hresult = 0 }
    # -2147024864 is 0x80070020, ERROR_SHARING_VIOLATION: another handle has the
    # file open with an incompatible sharing mode. On Windows that is usually the
    # app itself, and no amount of elevation would have helped.
    if ($hresult -eq -2147024864 -or $message -match 'being used by another process') { $sharing = $true }
  }

  Write-Host ('-' * 44)
  if ($sharing) {
    Write-Piece 'Freebuff has the file open.' 'White'
    Write-Host ''
    Write-Host ''
    Write-Host '  Quit Freebuff completely - right-click its tray icon and exit, or end'
    Write-Host '  Freebuff.exe in Task Manager - then run this again.'
    Write-Host ''
    Write-Host '  Windows will not replace a file another process is holding, and this'
    Write-Host '  tool will not force it.'
  } else {
    Write-Piece 'Windows is not letting this write go through.' 'White'
    Write-Host ''
    Write-Host ''
    if ($message) {
      Write-Host "  $message"
      Write-Host ''
    }
    Write-Host '  If Freebuff is installed for everyone (under C:\Program Files), open a'
    Write-Host '  PowerShell window with "Run as administrator" and run the same command'
    Write-Host '  again. A per-user install (under %LOCALAPPDATA%\Programs) never needs'
    Write-Host '  that.'
    Write-Host ''
    Write-Host '  If the file is marked read-only, clear it first:'
    Write-Host "    attrib -R `"$Target`""
    Write-Host ''
    Write-Host '  Antivirus and Controlled Folder Access can refuse this too. The tool'
    Write-Host '  never asks for a password and never elevates by itself.'
  }
  Write-Host ('-' * 44)
}

function Get-ScanHint {
  Write-Host '  See what this build actually has:'
  Write-Host ('    ' + (Get-CommandName) + ' scan')
  Write-Host "    `$s = irm $Origin/downloads/freebuff-focus-desktop.ps1; & ([scriptblock]::Create(`$s)) scan"
  Write-Host '  Read-only either way. The piped one is for when you ran the one-liner and'
  Write-Host '  have no local copy to point at.'
}

# ------------------------------------------------------------------- commands

function Show-Version {
  Say "freebuff-focus-desktop $Version"
  Say $Origin
}

function Show-Help {
  Say "Freebuff Focus for Desktop (Windows) $Version"
  Say 'Blocks the ads Freebuff Desktop renders from its bundled orchestrator.'
  Say ''
  Say 'usage'
  Say "  irm $Origin/downloads/freebuff-focus-desktop.ps1 | iex"
  Say "  `$s = irm $Origin/downloads/freebuff-focus-desktop.ps1"
  Say '  & ([scriptblock]::Create($s)) [command] [options]'
  Say ''
  Say 'commands'
  Say '  install   patch the app (default; backs up first, then restarts it)'
  Say '  focus     quiet until you run unfocus (no timer, no watcher)'
  Say '  focus 25m quiet until a deadline: 25m, 90m, 2h, 45s'
  Say '  focus session  quiet until Freebuff quits'
  Say '  unfocus   end it now: restore the pristine backup'
  Say '  status    report what is applied, and any focus - changes nothing'
  Say '  verify    wait for Freebuff to be relaunched, then check what it loaded'
  Say '  scan      show every anchor this build has - changes nothing'
  Say '  revert    restore the pristine backup'
  Say '  doctor    environment report'
  Say "  setup     install the tool and the $CommandName command (piped runs do this)"
  Say '  update    fetch the latest tool, replace this copy, then patch again'
  Say '  uninstall  remove the command and the installed copy; the patch stays'
  Say '  version   print the tool version'
  Say ''
  Say 'options'
  Say '  -App PATH          the Freebuff install folder (auto-detected by default)'
  Say '  -BackupDir PATH    where the pristine copy lives'
  Say '  -DisplayOnly       skip the ad-API anchor (leave the render gate only)'
  Say '  -DryRun            report only, write nothing'
  Say '  -NoRestart         leave the app alone; you quit and reopen it'
  Say '  -Restart           quit and relaunch even if the app was closed'
  Say '  -SessionDir PATH   where a focus session is recorded'
  Say '  -NoWait            verify: report now instead of waiting for the relaunch'
  Say '  -Timeout SECONDS   how long verify waits (default 300)'
  Say "  -AddPath           setup: append $BinDir to your user PATH"
  Say '  -Force             update: reinstall even when the version matches'
  Say ''
  Say 'A focus has three modes, and only what ends it differs:'
  Say '  focus          nothing but unfocus. Closing and reopening Freebuff keeps'
  Say '                 the ads off - the patched file is still on disk.'
  Say '  focus 25m      a deadline. A watcher restores the original file when it'
  Say '                 passes, so the next start of Freebuff has ads again. A'
  Say '                 window that is already open keeps the code it started with'
  Say '                 until it restarts - nothing here restarts it for you.'
  Say '  focus session  quitting Freebuff. The watcher restores the file as the app'
  Say '                 exits, so reopening it later shows ads.'
  Say ''
  Say 'The watcher is one hidden PowerShell process per timed or session focus - the'
  Say 'only thing this tool leaves running. It writes only while the file is still'
  Say 'the one the patch wrote, so a Freebuff update in the meantime makes it stand'
  Say 'down instead of overwriting. unfocus stops it.'
  Say ''
  Say 'A patch on disk is not the same as a patch in effect: the orchestrator is'
  Say 'read once at launch. verify waits for the relaunch and reports the two times'
  Say 'that decide it - when the patch was written and when the process running now'
  Say 'started. install does that for you whenever Freebuff is open. The wait is'
  Say 'bounded by -Timeout, and Ctrl-C ends it at once - nothing either does writes'
  Say 'to the app, and an interrupted wait prints no verdict.'
  Say ''
  Say 'After any Freebuff update, run install again - an update replaces the whole'
  Say 'resources folder and the patch goes with it.'
  Say ''
  Say 'Each anchor has a literal form and a relaxed one. The relaxed form is only'
  Say 'used when it is found the expected number of times and ad code sits beside it,'
  Say 'and a write is undone if the check afterwards disagrees. If a patch reports'
  Say 'not found, scan lists what this build does have.'
}

function Get-RequiredApp {
  $appDir = Find-AppDir
  if (-not $appDir) {
    Die "Freebuff Desktop was not found.`n  Pass -App with its install folder, for example:`n    -App `"$env:LOCALAPPDATA\Programs\@codebufffreebuff-desktop`""
  }
  return $appDir
}

function Get-RequiredTarget {
  param([string] $AppDir)
  $target = Get-TargetPath $AppDir
  if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
    Die "no resources\orchestrator\orchestrator.js in $AppDir - is that the Freebuff install folder?"
  }
  return $target
}

function Invoke-Status {
  $appDir = Get-RequiredApp
  $target = Get-RequiredTarget $appDir
  $appVersion = Get-AppVersion $appDir

  Say "Freebuff Focus - desktop tool $Version"
  Say "  app      $appDir"
  Say "  freebuff $appVersion (installed)"
  Say "  target   $target"
  Say ''

  Show-SessionLine
  $result = Invoke-Engine -Mode check -Target $target -DeepScan $Deep
  Show-Report $result

  if ($result.Verdict -eq 'ok') {
    if (Test-AllApplied $result) {
      Say ''
      Say '  Ads are off. Quit Freebuff and reopen it, then check what it loaded:'
      Say "    $(Get-CommandName) verify"
    } else {
      Say ''
      Say "  Not patched yet. Run: $(Get-CommandName) install"
    }
    exit 0
  }

  Say ''
  Bad 'This orchestrator.js does not match what the tool expects.'
  Say '  Either it was already modified by another tool, or this Freebuff version'
  Say '  changed the file. Nothing was written.'
  Say ''
  Say '  See what this build actually has:'
  Say "    $(Get-CommandName) scan"
  Say ''
  $backup = Join-Path $BackupDir "orchestrator.js.$appVersion.orig"
  if (Test-Path -LiteralPath $backup -PathType Leaf) {
    Say '  A pristine backup exists. Restore it, then install again:'
    Say "    $(Get-CommandName) revert"
  } else {
    Say '  If you patched this by hand before, restore the original file first.'
  }
  exit 1
}

# --------------------------------------------------------------- the command

function Get-LocalScriptVersion {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return '' }
  $line = Select-String -LiteralPath $Path -Pattern '^\$Version = ' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $line -or $line.Line -notmatch "'(.*)'") { return '' }
  return $Matches[1]
}

function Get-RemoteScript {
  param([string] $Destination)
  $uri = "$Origin/downloads/freebuff-focus-desktop.ps1"
  if ($uri -match '^file://') {
    # A file:// origin is how the tests run update without the network.
    $local = ([uri]$uri).LocalPath
    if (-not (Test-Path -LiteralPath $local -PathType Leaf)) { Die "cannot reach $Origin - nothing was changed" }
    Copy-Item -LiteralPath $local -Destination $Destination -Force
    return
  }
  try {
    Invoke-WebRequest -Uri $uri -OutFile $Destination -UseBasicParsing -ErrorAction Stop
  } catch {
    Die "cannot reach $Origin - nothing was changed"
  }
}

# How a hint names this tool: the installed command when it exists, the local
# file otherwise. Someone who ran the one-liner should be told to use what it
# created, not a .ps1 path that was never written.
function Get-CommandName {
  if (Test-Path -LiteralPath (Join-Path $BinDir "$CommandName.cmd") -PathType Leaf) { return $CommandName }
  return 'powershell -ExecutionPolicy Bypass -File .\freebuff-focus.ps1'
}

function Test-PathHasBin {
  $sep = [System.IO.Path]::PathSeparator
  foreach ($entry in ("$env:Path" -split [regex]::Escape($sep))) {
    if ($entry.TrimEnd('\', '/') -eq $BinDir.TrimEnd('\', '/')) { return $true }
  }
  return $false
}

function Add-BinToPath {
  try {
    $current = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $current) { $current = '' }
    if (($current -split ';') -contains $BinDir) { return $true }
    $next = if ($current) { "$BinDir;$current" } else { $BinDir }
    [Environment]::SetEnvironmentVariable('Path', $next, 'User')
    return $true
  } catch {
    return $false
  }
}

# Install the tool and the command that runs it. The first `irm | iex` does this,
# so the reader gets `freebuff-focusmode status` instead of a file they have to
# name and a folder they have to remember.
# True when the first version is strictly newer than the second. Used to refuse
# a downgrade: the site is the authority on what is current, but it must never
# hand back something older than what is already on disk and call it an update.
function Test-VersionNewer {
  param([string] $Candidate, [string] $Reference)
  try {
    return ([version]$Candidate) -gt ([version]$Reference)
  } catch {
    return $false
  }
}

function Show-Setup {
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null

  $tmp = "$InstalledSelf.tmp"
  if ($HaveLocal -and $PSCommandPath) {
    # Exactly the code that is running: a local copy needs no second download.
    Copy-Item -LiteralPath $PSCommandPath -Destination $tmp -Force
  } else {
    Get-RemoteScript $tmp
    $got = Get-LocalScriptVersion $tmp
    if (-not $got) {
      Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
      Die 'the download does not look like this tool - nothing was installed'
    }
    if ($got -ne $Version) {
      # A copy older than the code that is running is a stale site, not an
      # update: installing it would hand back a tool missing this very command.
      if (Test-VersionNewer $Version $got) {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        Die "the site is serving $got while this run is $Version - nothing was installed. Try the one-liner again in a minute."
      }
      Warn "downloaded $got while running $Version - installing $got"
    }
  }

  Move-Item -LiteralPath $tmp -Destination $InstalledSelf -Force

  $shim = Join-Path $BinDir "$CommandName.cmd"
  $body = "@echo off`r`npowershell -NoProfile -ExecutionPolicy Bypass -File `"$InstalledSelf`" %*`r`n"
  try { [System.IO.File]::WriteAllText($shim, $body) } catch { Die "cannot write $shim" }

  Ok "installed $InstalledSelf"
  Ok "command   $shim"

  if (Test-PathHasBin) {
    Say "  $BinDir is already on PATH"
  } elseif ($AddPath) {
    if (Add-BinToPath) {
      Say "  path      added $BinDir to your user PATH"
      Say "  Open a new terminal, then run:  $CommandName status"
    } else {
      Warn "could not update PATH - add $BinDir yourself"
    }
  } else {
    Say ''
    Say "  $BinDir is not on PATH yet. Add it for good, as the current user:"
    Say "    [Environment]::SetEnvironmentVariable('Path', `"$BinDir;`$env:Path`", 'User')"
    Say '  or rerun setup with -AddPath and this is done for you.'
  }
}

function Invoke-Update {
  if (-not (Test-Path -LiteralPath $InstalledSelf -PathType Leaf)) {
    Die "no installed copy yet - run the one-liner from $Origin"
  }

  Say 'Freebuff Focus - update'
  $old = Get-LocalScriptVersion $InstalledSelf
  $oldText = if ($old) { $old } else { 'unknown' }
  Say "  installed  $oldText"

  $tmp = "$InstalledSelf.new"
  Get-RemoteScript $tmp
  $new = Get-LocalScriptVersion $tmp
  if (-not $new) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    Die 'the download does not look like this tool - kept the installed copy'
  }
  Say "  available  $new"

  if ($new -eq $old -and -not $Force) {
    Remove-Item -LiteralPath $tmp -Force
    Ok 'already up to date'
    exit 0
  }

  if (-not $Force -and (Test-VersionNewer $old $new)) {
    Remove-Item -LiteralPath $tmp -Force
    Die "the site is serving $new, which is older than the installed $old - nothing was changed"
  }

  Copy-Item -LiteralPath $InstalledSelf -Destination "$InstalledSelf.prev" -Force -ErrorAction SilentlyContinue
  Move-Item -LiteralPath $tmp -Destination $InstalledSelf -Force
  Ok "updated    $oldText -> $new"
  Say "  previous   $InstalledSelf.prev"
  Say ''

  Invoke-Install
  exit 0
}

function Invoke-Uninstall {
  $shim = Join-Path $BinDir "$CommandName.cmd"
  $removed = $false
  if (Test-Path -LiteralPath $shim -PathType Leaf) {
    Remove-Item -LiteralPath $shim -Force
    Ok "removed $shim"
    $removed = $true
  }
  if (Test-Path -LiteralPath $InstalledSelf -PathType Leaf) {
    Remove-Item -LiteralPath $InstalledSelf -Force
    Remove-Item -LiteralPath "$InstalledSelf.prev" -Force -ErrorAction SilentlyContinue
    Ok "removed $InstalledSelf"
    $removed = $true
  }

  if (-not $removed) {
    Say '  Nothing was installed here.'
    exit 0
  }
  Say ''
  Say '  The patch is still applied. Restore the ads first next time, with a fresh copy.'
  exit 0
}

function Invoke-Install {
  # The one-liner is the install path: a piped run with no file behind it puts the
  # command on the machine first, then patches. A local copy just patches.
  if (-not $HaveLocal) { Show-Setup }

  $appDir = Get-RequiredApp
  $target = Get-RequiredTarget $appDir
  $appVersion = Get-AppVersion $appDir

  # What Complete-Focus needs to record a focus, since it runs at the end of this
  # function and the app is what this function resolved.
  $script:InstalledApp = $appDir
  $script:InstalledTarget = $target
  $script:InstalledVersion = $appVersion

  Say "Freebuff Focus - desktop tool $Version"
  Say "  app      $appDir"
  Say "  freebuff $appVersion (installed)"
  Say ''

  $result = Invoke-Engine -Mode check -Target $target -DeepScan $Deep

  if ($result.Verdict -ne 'ok') {
    Show-Report $result
    Say ''
    Bad "Refusing to patch - the file does not match this tool's expectations."
    Say '  Nothing was written. Either it was modified by another tool, or this'
    Say '  Freebuff version changed the ad code.'
    Say ''
    Get-ScanHint
    Say ''
    $backup = Join-Path $BackupDir "orchestrator.js.$appVersion.orig"
    if (Test-Path -LiteralPath $backup -PathType Leaf) {
      Say '  A pristine backup is on disk:'
      Say "    $(Get-CommandName) revert"
    }
    exit 1
  }

  if (Test-AllApplied $result) {
    # Nothing to write, so this run is worth only what it reports: which anchors
    # are already in place, whether a session is running, whether the process
    # you are looking at is reading the patched bytes, and what else the tool
    # can do from here. "Nothing to do" alone answered none of that.
    Write-Piece '  Already patched.' 'Green'
    Say ' Every anchor in this build is already replaced.'
    Show-Report $result
    Show-SessionLine
    if (-not (Test-Path -LiteralPath (Get-SessionPath) -PathType Leaf)) {
      Say '  focus    none - ads stay off until you revert'
    }
    Say ''

    # Nothing to write, but there can still be a process reading the old bytes.
    $running = @(Get-OrchestratorProcesses -AppDir $appDir -Target $target).Count -gt 0
    if (-not $running) {
      Write-Piece '  Next: open Freebuff.' 'White'
      Say ' The orchestrator is read once at launch, so the patch takes effect'
      Say '  on the next start.'
      Say '  Then check what it loaded:'
      Say "    $(Get-CommandName) verify"
    } elseif (Test-StalePatch -AppDir $appDir -Target $target) {
      if ($Restart -eq 'never') {
        Write-Piece '  Freebuff is running the bytes from before the patch.' 'White'
        Say ''
        Say '  Quit it completely and reopen it - focusing the window is not enough.'
        Say '  Then check what it loaded:'
        Say "    $(Get-CommandName) verify"
      } else {
        Say '  A process that started before the patch is still running it.'
        if (Restart-App -AppDir $appDir -Target $target) {
          Say '  restarted Freebuff'
          if ($Wait) { Wait-ForRelaunch -AppDir $appDir -Target $target | Out-Null }
        } else {
          Warn 'could not restart Freebuff - quit it yourself and open it again'
        }
      }
    } else {
      Write-Piece '  Freebuff is running the patched file.' 'White'
      Say ' Ads are off in that window.'
    }

    Say ''
    Show-NextSteps
    Complete-Focus
    exit 0
  }

  Say '  Would patch:'
  Show-Report $result
  Say ''

  if ($Dry) {
    Say '  -DryRun: nothing was written.'
    exit 0
  }

  if ((Get-Item -LiteralPath $target).IsReadOnly) {
    Bad 'the file is marked read-only'
    Show-WriteHelp -Target $target
    exit 1
  }

  if (-not (Test-CanWrite -Target $target)) {
    Show-WriteHelp -Target $target
    exit 1
  }

  if (-not (Test-Path -LiteralPath $BackupDir -PathType Container)) {
    try { New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null }
    catch { Die "cannot create the backup folder ${BackupDir}: $($_.Exception.Message)" }
  }

  $backup = Join-Path $BackupDir "orchestrator.js.$appVersion.orig"
  if (Test-Path -LiteralPath $backup -PathType Leaf) {
    Say "  backup   kept $backup"
  } else {
    try {
      Copy-Item -LiteralPath $target -Destination $backup -Force -ErrorAction Stop
    } catch {
      Show-WriteHelp -Target $target -ErrorRecord $_
      exit 1
    }
    Say "  backup   $backup"
  }

  Say ''
  $applied = $null
  try {
    $applied = Invoke-Engine -Mode apply -Target $target -DeepScan $Deep
  } catch {
    Bad 'the patch did not apply cleanly - the file was left untouched'
    Show-WriteHelp -Target $target -ErrorRecord $_
    exit 1
  }

  if (-not $applied.Written) {
    Bad 'the patch did not apply cleanly - the file was left untouched'
    Show-Report $applied
    exit 1
  }

  $after = Invoke-Engine -Mode check -Target $target -DeepScan $Deep

  # A relaxed anchor is an inference, not a literal this tool was verified against,
  # so the write only stands if a fresh count agrees with it. If it does not, the
  # pristine copy goes straight back - a half-patched bundle is the one outcome
  # worth undoing.
  if ($after.Verdict -ne 'ok' -or -not (Test-AllApplied $after)) {
    Show-Report $after
    Say ''
    Bad 'the patch did not verify after writing - putting the original back'
    try {
      Copy-Item -LiteralPath $backup -Destination $target -Force -ErrorAction Stop
      Ok "restored $target"
    } catch {
      Bad "could not restore $target - copy it back by hand: $backup"
    }
    exit 1
  }

  Show-Report $after
  Say ''

  Ok "patched Freebuff $appVersion"
  Write-Host ('-' * 44)

  # A fresh write means any recorded session describes the old bytes. The watcher
  # that was waiting on them has to go before it restores the wrong thing, and a
  # session nobody is watching is worse than no session at all.
  if ((Test-Path -LiteralPath (Get-SessionPath) -PathType Leaf) -and
      ((Get-SessionKey 'stamp') -ne (Get-FileStamp $target))) {
    Stop-SessionWatcher
    try { Remove-Item -LiteralPath (Get-SessionPath) -Force -ErrorAction Stop } catch { }
    Say '  focus    cleared - the patch was rewritten'
    Say ''
  }

  $running = @(Get-OrchestratorProcesses -AppDir $appDir -Target $target).Count -gt 0

  if ($Restart -eq 'never') {
    if ($running) {
      Write-Piece 'Freebuff is running. Quit it completely and reopen it.' 'White'
      Write-Host ''
      Say 'The orchestrator is read once at launch, so the patch only takes effect on'
      Say 'the next start - focusing the window is not enough.'
      Say '  Then check what it loaded:'
      Say "    $(Get-CommandName) verify"
    } else {
      Write-Piece 'Open Freebuff.' 'White'
      Write-Host ''
      Say 'The patch takes effect on the next launch.'
      Say '  Then check what it loaded:'
      Say "    $(Get-CommandName) verify"
    }
  } elseif ($running -or $Restart -eq 'always') {
    Write-Piece 'Restarting Freebuff so the patch takes effect.' 'White'
    Write-Host ''
    Say 'The orchestrator is read once at launch, so a running app has to be'
    Say 'restarted - focusing the window is not enough.'
    Say ''
    if (Restart-App -AppDir $appDir -Target $target) {
      Say '  restarted Freebuff'
      # Only when there is a relaunch to wait for. A closed app has nothing to
      # observe, and an unattended install must not sit here for five minutes.
      if ($Wait) {
        Wait-ForRelaunch -AppDir $appDir -Target $target | Out-Null
      } else {
        Say '  Then check what it loaded:'
        Say "    $(Get-CommandName) verify"
      }
    } else {
      Warn 'could not restart Freebuff - quit it completely, reopen it, then:'
      Say "    $(Get-CommandName) verify"
    }
  } else {
    Write-Piece 'Open Freebuff.' 'White'
    Write-Host ''
    Say 'The patch takes effect on the next launch.'
    Say '  Then check what it loaded:'
    Say "    $(Get-CommandName) verify"
  }
  Say ''
  Say 'Undo any time: unfocus ends a session.'
  Say "Back to ads only: $(Get-CommandName) revert"
  Say 'After a Freebuff update, run install again.'
  Say "For a newer version of this tool itself: $(Get-CommandName) update"
  Say ''
  Show-NextSteps
  Complete-Focus
  exit 0
}

function Invoke-Revert {
  # Nothing may be waiting to write this file once it is being restored.
  Stop-SessionWatcher
  $appDir = Get-RequiredApp
  $target = Get-RequiredTarget $appDir
  $appVersion = Get-AppVersion $appDir
  $backup = Join-Path $BackupDir "orchestrator.js.$appVersion.orig"

  if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
    Say "No backup for $appVersion in $BackupDir"
    if (Test-Path -LiteralPath $BackupDir -PathType Container) {
      Say 'Available backups:'
      foreach ($file in @(Get-ChildItem -LiteralPath $BackupDir -Filter 'orchestrator.js.*.orig' -ErrorAction SilentlyContinue)) {
        Say "  $($file.FullName)"
      }
    }
    Die 'nothing to restore'
  }

  if (-not (Test-CanWrite -Target $target)) {
    Show-WriteHelp -Target $target
    exit 1
  }

  try {
    Copy-Item -LiteralPath $backup -Destination $target -Force -ErrorAction Stop
  } catch {
    Show-WriteHelp -Target $target -ErrorRecord $_
    exit 1
  }

  Ok "restored $target from $backup"

  if ($Restart -eq 'never') {
    Say '  Quit Freebuff and reopen it to bring the ads back.'
    exit 0
  }

  if (@(Get-OrchestratorProcesses -AppDir $appDir -Target $target).Count -gt 0) {
    if (Restart-App -AppDir $appDir -Target $target) {
      Say '  restarted Freebuff - the ads are back on the next launch.'
    } else {
      Warn 'could not restart Freebuff - quit it completely and reopen it'
    }
  } else {
    Say '  Freebuff is not running. The ads come back the next time you start it.'
  }
  Complete-Unfocus
  exit 0
}

function Invoke-Doctor {
  Say "freebuff-focus-desktop $Version"
  Say "  origin        $Origin"
  Say "  os            $([System.Environment]::OSVersion.VersionString)"
  Say "  powershell    $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))"
  Say "  windows       $($script:IsWindowsOS)"
  Say "  backup dir    $BackupDir"
  Say "  session dir   $SessionDir"
  Say ''

  $candidates = Get-AppCandidates
  Say "  looked in     $($candidates.Count) location(s)"
  $shown = 0
  foreach ($candidate in $candidates) {
    if ($shown -ge 10) {
      Say "                ... and $($candidates.Count - $shown) more"
      break
    }
    $shown++
    $mark = ''
    if (Test-Path -LiteralPath (Get-TargetPath $candidate) -PathType Leaf) { $mark = ' <- has orchestrator.js' }
    Say "                $candidate$mark"
  }
  Say ''

  $appDir = Find-AppDir
  if (-not $appDir) {
    Bad 'Freebuff Desktop was not found'
    Say '  That is the whole report: there is no app to inspect.'
    # One exit status on every platform, so a wrapper can use this as its
    # preflight check. 1.6 exited 1 here and 0 on macOS/Linux for the same
    # finding, which made the answer depend on the OS rather than the app.
    exit 0
  }

  $target = Get-TargetPath $appDir
  $appVersion = Get-AppVersion $appDir
  Say "  app           $appDir"
  # The app's own version, read from the executable it would patch - not a
  # constant and not what the tool was built against. The source is named
  # because the label alone used to read as the tool's version.
  Say "  freebuff      $appVersion   (Freebuff.exe version resource)"
  Say "  orchestrator  $target"

  if (Test-Path -LiteralPath $target -PathType Leaf) {
    Say "  size          $((Get-Item -LiteralPath $target).Length) bytes"
    if (Test-CanWrite -Target $target) { Ok 'bundle is writable' }
    else { Bad 'bundle is NOT writable (needs an elevated shell, or the file is locked)' }

    Show-Report (Invoke-Engine -Mode check -Target $target -DeepScan $Deep)
  } else {
    Bad 'orchestrator.js is missing'
  }

  $processes = Get-OrchestratorProcesses -AppDir $appDir -Target $target
  Show-SessionLine

  if ($processes.Count -gt 0) {
    Warn "Freebuff is running ($($processes.Count) matching process(es))"
  } else {
    Ok 'Freebuff is not running'
  }
  exit 0
}

function Invoke-Scan {
  $appDir = Get-RequiredApp
  $target = Get-RequiredTarget $appDir
  $appVersion = Get-AppVersion $appDir

  Say "Freebuff Focus - anchor scan (tool $Version)"
  Say "  app      $appDir"
  Say "  freebuff $appVersion (installed)"
  Say "  target   $target"
  Say ''

  $report = Get-ScanReport -Target $target -AppDir $appDir -DeepScan $Deep

  Write-Host -NoNewline $report
  Say ''

  $out = Join-Path $BackupDir "orchestrator-scan.$appVersion.txt"
  $saved = $false
  try {
    if (-not (Test-Path -LiteralPath $BackupDir -PathType Container)) {
      New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($out, $report, (New-Object System.Text.UTF8Encoding($false)))
    $saved = $true
  } catch {
    $saved = $false
  }

  if ($saved) {
    Ok "saved    $out"
    Say '  Nothing inside the app was touched. When a patch reports'
    Write-Host -NoNewline '  '
    Write-Piece 'not found' 'White'
    Say ', this file is what re-anchoring the tool needs.'
  } else {
    Warn "could not write $out - copy the block above instead"
  }
  exit 0
}

function Invoke-Verify {
  $appDir = Get-RequiredApp
  $target = Get-RequiredTarget $appDir
  $appVersion = Get-AppVersion $appDir

  Say "Freebuff Focus - desktop tool $Version"
  Say "  app      $appDir"
  Say "  freebuff $appVersion (installed)"
  Say "  target   $target"
  Say ''

  $result = Invoke-Engine -Mode check -Target $target -DeepScan $Deep

  if ($result.Verdict -ne 'ok') {
    Show-Report $result
    Say ''
    Bad 'This orchestrator.js does not match what the tool expects.'
    Say "  There is nothing of this tool's to verify, and nothing was written."
    Say ''
    Say '  See what this build actually has:'
    Say "    $(Get-CommandName) scan"
    exit 1
  }

  if (-not (Test-AllApplied $result)) {
    Show-Report $result
    Say ''
    Say '  Not patched yet. Run:'
    Say "    $(Get-CommandName) install"
    exit 1
  }

  Show-Report $result
  Say ''
  # `-contains` rather than an equality test: a stray value on this function's
  # output stream must not be able to turn a refusal into a success, and a scalar
  # on the left of -contains is read as a one-element list.
  $verified = Wait-ForRelaunch -AppDir $appDir -Target $target
  if ($verified -contains 0) { exit 0 }
  exit 1
}

# What no file can answer: whether the app you are looking at loaded the patched
# file. The orchestrator is read once at launch, so the one honest test is a
# comparison of two times: when the patch was written, and when the process that is
# running now started. Started later means the patched file is what it read.
function Wait-ForRelaunch {
  param([string] $AppDir, [string] $Target)

  $patchTime = Get-PatchTime -Target $Target
  $remaining = $WaitSecs
  $announced = $false
  $waiting = $false

  # Every statement in here is assigned or piped to Out-Null on purpose: this
  # function's return value *is* the command's exit status, and one stray value on
  # the output stream is enough to turn a refusal into a success. That is not
  # hypothetical - it happened, through a method reference that looked inert.
  #
  # Ctrl-C is deliberately not intercepted, and that is a measurement, not a
  # preference. A CancelKeyPress handler written as a PowerShell script block
  # cannot run: the signal arrives on a thread with no runspace, so PowerShell
  # answers with an unhandled PSInvalidOperationException and the process dies of
  # SIGABRT - a handler here is worse than no handler. A compiled .NET delegate
  # (Add-Type) does run, but it buys nothing: PowerShell still reports exit 0 for
  # an interrupted run and ignores Environment.Exit() from that thread, so the
  # handler could print but never set a status. Ctrl-C therefore ends the run the
  # moment it arrives - no verdict, no message - and the exit code on that path
  # belongs to the host. What brings an unattended run back is the bound below.
  while ($true) {
    $bestId = 0
    $bestStart = $null
    foreach ($process in (Get-OrchestratorProcesses -AppDir $AppDir -Target $Target)) {
      if (-not $process.Start) { continue }
      if ((-not $bestStart) -or ($process.Start -gt $bestStart)) {
        $bestId = $process.Id
        $bestStart = $process.Start
      }
    }

    # Two seconds of tolerance, and both seconds are the clock's fault: a process
    # started immediately after the write can read as a second before it. No real
    # relaunch is ever that close to the patch, and a false "relaunch and run this
    # again" is worse than a false pass in a window two seconds wide.
    if ($bestId -and $patchTime) {
      $delta = [int]($bestStart.ToUnixTimeSeconds() - $patchTime.ToUnixTimeSeconds())
      if ($delta -ge -2) {
        Say "  running    pid $bestId, started $(Get-FriendlyTime $bestStart)"
        Say "             $(Get-ClockWords $delta)"
        $ad = Get-AdCodeLine -Target $Target
        if ($ad) {
          Say "  ad code    still in this build: $ad"
        } else {
          Warn 'the ad runtime this patch aims at is not in this build'
          Say '             Freebuff may have removed it, or moved it. scan lists'
          Say '             every site this build does have.'
        }
        Say ''
        Ok 'the running app is the patched file'
        Say '  The ad auction in it returns no ads, and the ad client gives up before'
        Say '  it sends. What no check here can see is whether an ad break still'
        Say '  appears - only you can. On the free tier, run a turn: an ad card is'
        Say '  the one carrying an "AD" chip or a /track/click link.'
        return 0
      }
    }

    # Why not, said once, so a long wait does not repeat itself.
    if (-not $announced) {
      if (-not $bestId) {
        Say '  running    Freebuff is not open.'
      } elseif (-not $patchTime) {
        Say "  running    pid $bestId, started $(Get-FriendlyTime $bestStart)"
        Say '             the patch time could not be read, so the two cannot be compared'
      } else {
        Say "  running    pid $bestId, started $(Get-FriendlyTime $bestStart)"
        Say "             $(Get-ClockWords $delta)"
      }
      $announced = $true
    }

    if (-not $Wait) {
      Say ''
      Say '  Not verified. This check needs Freebuff running the patched file.'
      Say '  Quit it completely, reopen it, then run it again:'
      Say "    $(Get-CommandName) verify"
      return 1
    }

    if (-not $waiting) {
      Say ''
      Write-Host -NoNewline '  Waiting for Freebuff to be quit and reopened...  '
      Write-Piece '(Ctrl-C stops it, with no verdict)' 'DarkGray'
      Say ''
      $waiting = $true
    }

    if ($remaining -le 0) {
      Say ''
      Say '  Stopped waiting. The patch itself is fine - this check only needs the'
      Say '  relaunch. Run it again once Freebuff is open:'
      Say "    $(Get-CommandName) verify"
      return 1
    }

    Start-Sleep -Seconds 2
    $remaining -= 2
  }
}

# ------------------------------------------------------------------------ run

function Invoke-Focus {
  $script:FocusMode = Get-FocusMode
  $script:FocusSeconds = $null
  if ($script:FocusMode -eq 'until') {
    $seconds = ConvertTo-FocusSeconds $FocusArg
    if (-not $seconds) {
      Die 'focus takes a duration like 25m, 90m, 2h or 45s, or the word session'
    }
    $script:FocusSeconds = $seconds
  }

  # A second focus replaces the first: one session file, one watcher.
  Stop-SessionWatcher

  # Install first: it is what patches, and a piped run installs the copy the
  # watcher will re-run. Complete-Focus runs at the end of it with the target.
  Invoke-Install
}

function Invoke-Unfocus {
  $script:EndFocus = $true
  Stop-SessionWatcher
  Invoke-Revert
}

switch ($Command) {
  'install' { Invoke-Install }
  'setup' { Show-Setup; exit 0 }
  'update' { Invoke-Update }
  'uninstall' { Invoke-Uninstall }
  'focus' { Invoke-Focus }
  'unfocus' { Invoke-Unfocus }
  '__watch' { Invoke-Watch }
  'status' { Invoke-Status }
  'verify' { Invoke-Verify }
  'revert' { Invoke-Revert }
  'doctor' { Invoke-Doctor }
  'scan' { Invoke-Scan }
  'version' { Show-Version; exit 0 }
  'help' { Show-Help; exit 0 }
  default { Die "unknown command: $Command  (try help)" }
}
