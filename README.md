# Freebuff Ad Block

A Chromium (Manifest V3) extension that removes ads on **freebuff.com**, plus the
static page that distributes it.

Site-scoped by design: it touches freebuff.com and nothing else. No accounts, no
backend, no database, no telemetry.

## Why three layers

| Layer | File | Catches |
| --- | --- | --- |
| Network | `extension/rules.json` | Ad requests, before they leave the tab |
| DOM hooks | `extension/content.js` | Ad-shaped markup injected mid-build |
| In-product promos | `extension/content.js` | freebuff.com's own "AD" cards |
| Ad-network slots | `extension/content.js` + `rules.json` | `data-gravity-ad` slots, `rel="sponsored"` links |
| Picked by hand | `popup` + `extension/content.js` | Anything you hide yourself, on every visit |

None of them alone is sufficient. A `declarativeNetRequest` ruleset only sees
requests, so it is blind to an ad container the page builds itself while it is
thinking. A content script only sees markup, so it never stops the request. And
an in-product promo card is first-party with no ad-shaped class or id at all, so
it can only be found by its badge text. The extension runs all three.

The promo tier is the one place matching is not based on an attribute, so it is
fenced in tightly: a leaf whose entire text is a label like `AD`, a card found
above it that holds a link or button, stays under 600 characters, contains no
code block or editor, and carries a single call to action. That last guard is
what stops the walk from climbing out of the card and taking the skill chips
below it.

The ruleset carries a priority-100 `allow` for freebuff.com's own traffic that
every block rule (all priority 1) loses against — your build and thinking stream
can never be blocked. See `extension/rules.md` for the full reasoning.

## The ad network, and what happens when it changes

The in-product slots are not hand-built by freebuff.com. They arrive from an ad
network, and the slots it injects carry three markers worth knowing:

| Marker | Meaning |
| --- | --- |
| `data-gravity-ad` (and `data-gravity-ad-*`) | the network's own slot attribute |
| `rel="… sponsored"` | the standard sponsored-link rel value |
| `href="…/track/click?…"` | the network's click endpoint |

Matching on the network's markers rather than on freebuff.com's layout is what
makes this hold in places we have never seen: a new slot anywhere in the app is
caught by the same attribute, without a screenshot and without a guess.

That still only covers what the network marks. **`npm test` covers the rest.**

The popup's **Hide an element on the page** button is the part no heuristic can
replace. Click it, click an ad nothing recognised, and the rule is saved to
`chrome.storage.sync` and reapplied on every future visit. The picker builds the
most durable selector it can — a real attribute first, then an id, then any
`data-*` attribute, and a structural path only as a last resort, because
structural paths break the moment a layout changes.

Deliberate rules are applied last in every pass and are never second-guessed by
`rescue()`, so a rule you made by hand outranks anything inferred.

## Layout

```
extension/          the extension source
  manifest.json       MV3 manifest
  rules.json          declarativeNetRequest static ruleset
  rules.md            why the rules are shaped the way they are
  content.js          stylesheet injection + MutationObserver
  background.js       service worker (badge counter)
  popup.*             enable/disable popup + "is it running on this tab?"
  icons/              16/32/48/128, generated procedurally
scripts/            zero-dependency build tooling
  build.mjs           packages the zip, writes update.xml, emits dist/
  serve.mjs           preview server (builds first, binds 0.0.0.0)
  validate.mjs        static checks Chrome would otherwise only fail at load
  test-detection.mjs  jsdom checks: hides the ads, keeps the chat
  zip.mjs             minimal ZIP writer
  png.mjs             minimal PNG encoder + icon artwork
  gen-icons.mjs       force-regenerate icons
site/               install page source
  index.html, styles.css, app.js
dist/               static output - served by the preview and by hosting
```

There are no npm dependencies. The production build image is Node-only and
uploaded files lose their executable bit, so the packaging step is plain Node
rather than a `zip` shell-out.

## Commands

```sh
npm run build     # package extension -> site/downloads + site/update.xml, emit dist/
npm start         # build, then serve dist/ on 0.0.0.0:$PORT (default 4173)
npm run icons     # force-regenerate extension/icons
npm run check     # syntax-check the build tooling
npm run validate  # static extension checks (manifest, icons, DNR rules, selectors)
npm test          # jsdom checks for the content script (needs `npm i --no-save jsdom`)
```

The preview server is started and managed by Freebuff
(`freebuff-preview start`), never by hand.

## Installing it

Chromium will not install an unsigned extension from a link, so:

1. Download and extract the zip.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Enable **Developer mode** → **Load unpacked** → pick the extracted
   `freebuff-adblock` folder.
4. Reload any freebuff.com tabs that were already open.

## Auto-updates

`site/update.xml` is regenerated with every build with the matching version and
codebase URL, but **Chrome only consults an update feed for an extension
installed from that feed** — via a managed `ExtensionInstallForcelist` policy or
the Chrome Web Store. An extension loaded unpacked never polls it.

Before the feed goes live, replace `YOUR_EXTENSION_ID_HERE` with the packed
extension's real ID and point `codebase` at a signed CRX. The install page
explains both routes to the user rather than implying unpacked extensions
update themselves.

## Deploying

Set `SITE_ORIGIN` (in `scripts/build.mjs`, or as an environment variable) to the
public origin so `update.xml` and the download link are absolute and correct.
It defaults to `https://freebuff-adblocker.vercel.app`.

`extension/popup.js` (`INSTALL_URL`) points at the same origin; `npm run
validate` fails if the two drift apart, because a mismatch is a dead link in the
popup and a dead `codebase` in the feed rather than anything visible here.

`VERCEL_TOKEN` is read from the workspace environment; nothing else is required.

## Scope

Web version only. The desktop application is a separate binary with no
extension surface, so a browser extension cannot reach it.
