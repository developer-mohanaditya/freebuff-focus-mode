# Freebuff Focus Mode

**Focus when you need it. Support when you do not.**

A focus companion for [freebuff.com](https://freebuff.com). Flip focus on before a deep
work block and it quiets ad requests plus the slots that appear mid-build. Flip it off when
you are done, and everything returns, so free models stay free.

Unofficial community project. Not affiliated with Freebuff or Codebuff.

[Install it](https://freebuff-focusmode.vercel.app/) ·
[Privacy policy](https://freebuff-focusmode.vercel.app/privacy) ·
[Report an issue](https://github.com/developer-mohanaditya/freebuff-focus-mode/issues)

## Why focus, not block

Freebuff is free because ads fund premium models. Permanent blocking takes that deal away.
Focus Mode keeps it: ads stay on by default, quiet applies only while focus is on, and
reverting is always one click. No accounts, no backend, no telemetry, nothing leaves your
machine.

## Install

**Extension** (Chrome, Edge, Brave, Opera, Vivaldi, Firefox):

1. Download the zip from the install page and extract it somewhere permanent.
2. Open `chrome://extensions`, enable **Developer mode**, then **Load unpacked** and pick
   the extracted folder.
3. Reload open freebuff.com tabs, open the popup, and flip focus on. Flip it off when the
   block ends.

**Desktop app** (macOS, Windows, Linux): the desktop bundle has no extension surface, so it
has its own local tools. See the For Desktop section on the install page.

```sh
# macOS / Linux
curl -fsSL https://freebuff-focusmode.vercel.app/downloads/freebuff-focus-desktop.sh | sh
sh freebuff-focus.sh focus 25m   # quiet for the work block
sh freebuff-focus.sh unfocus     # bring ads back after
```

```powershell
# Windows
irm https://freebuff-focusmode.vercel.app/downloads/freebuff-focus-desktop.ps1 | iex
```

The tool restarts Freebuff itself, then checks that the running process read the patched
file. Every Freebuff update replaces the patched files, so run it again after an update.
A session is the patch plus an end time: `status` prints when it lifts, and nothing runs in
the background - `unfocus` is what puts the ads back.

## How it works

| Layer | Catches | When |
| --- | --- | --- |
| Network rules (`extension/rules.json`) | Ad requests before they leave the tab | Focus on only |
| Content script (`extension/content.js`) | Slots injected mid-build, in-product AD cards | Focus on only |
| Picker (popup) | Anything you quiet by hand, saved per site | Future focus sessions |

A priority-100 allow rule covers freebuff.com traffic, so builds and thinking streams are
never touched. Outside focus, no rule runs at all.

The desktop tools patch only the ad runtime at counted anchors, back up the original first,
and refuse to write when a new Freebuff build changes the code. `status` reports, `verify`
confirms the running app loaded the file, `scan` shows what a new build contains.

## Privacy

No server, no analytics, no accounts. Stored locally only: your focus setting and element
rules you create. Full policy on the
[site](https://freebuff-focusmode.vercel.app/privacy).

## Develop

```sh
npm run build     # packages, stamps versions, emits dist/
npm run dev       # live reload preview on 0.0.0.0:$PORT
npm run validate  # static checks
npm test          # content, site, and desktop suites
```

`dist/` is the whole deployment: static files, no secrets. See `docs/` for the publishing
guide and the full project history notes.

## License

MIT, see [LICENSE](LICENSE).
