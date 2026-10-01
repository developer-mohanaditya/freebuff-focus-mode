# Freebuff Ad Block

**The ads stop. The build keeps streaming.**

An extension for Chromium and Firefox (Manifest V3) that removes the ads on
**freebuff.com**: the network-served slots, the ones the page injects while a
build is thinking, and the product's own in-line "AD" cards.

Site-scoped by design — it touches freebuff.com and nothing else. No accounts,
no backend, no database, no telemetry, and nothing to configure.

[Install it](https://freebuff-adblocker.vercel.app/) ·
[Privacy policy](https://freebuff-adblocker.vercel.app/privacy) ·
[Report an issue](https://github.com/developer-mohanaditya/freebuff-ad-blocker/issues)

## Install

Neither Chromium nor Firefox will install an unsigned extension from a link, so
until the store listings are live the path is loading the extracted folder as a
developer extension. It behaves exactly like an installed one — in Chromium it
persists, in Firefox a temporary add-on lasts until the browser restarts.

**Chromium** (Chrome, Edge, Brave, Opera, Vivaldi, Comet…)

1. Download the zip from the install page and extract it somewhere permanent.
   If you move the folder later, Chrome reports the extension as unloaded and
   you have to point it at the new path again.
2. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
3. Enable **Developer mode** → **Load unpacked** → pick the extracted
   `freebuff-adblock` folder.
4. Reload any freebuff.com tabs that were already open.

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on** → pick `manifest.json` inside the extracted
   Firefox zip.

Once a listing exists, the install page's hero button works out which browser is
reading it and points at the store that serves that browser — no wrong-store
links, and no button at all for a browser that cannot install it.

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

## Browsers

Firefox has no Manifest V3 service worker, so it needs `background.scripts` to
run the same file as an event page — and that key is Manifest V2 as far as
Chromium is concerned. Chrome 121+ ignores it rather than refusing to load, but
it still shows up as a **warning on `chrome://extensions`**. So the source
manifest stays Chromium-clean and `firefoxManifest()` in `scripts/build.mjs`
derives the Firefox one, adding that key plus `browser_specific_settings.gecko.id`
(required to sign an MV3 add-on on AMO, where Chromium-only keys are ignored).
`strict_min_version` is 115, where `storage.session` became available.

Everything else is shared: the same `declarativeNetRequest` ruleset, the same
content script, the same popup. `npm run validate` fails if an MV2-only key
creeps back into the source manifest, or if the derived Firefox manifest loses
the event page or the gecko id.

One build writes three packages:

| File | For |
| --- | --- |
| `freebuff-adblock-<version>.zip` | load unpacked in Chromium — one tidy top-level folder |
| `freebuff-adblock-<version>-store.zip` | Chrome Web Store and Edge Add-ons — `manifest.json` at the archive root |
| `freebuff-adblock-<version>-firefox.zip` | addons.mozilla.org — the same, plus the event-page background |

The zips are reproducible: entries are stamped with the ZIP epoch rather than
the build time (or `SOURCE_DATE_EPOCH` when it is set), so two builds of the
same sources are byte-identical and a signed package can be matched back to a
commit.

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

### Slots that have to keep their place

The strip the network drops into the preview toolbar cannot be removed the way
the others are. It is wrapped in a full-width `flex` div that is itself one item
of the toolbar row, so taking the wrapper out of the flow collapses that item
and slides the controls beside it to the left.

Ads shaped that way are **emptied where they stand** instead: the stylesheet
makes the node invisible and un-clickable but leaves its box alone, so the row
keeps its exact width, and the script skips it rather than collapsing its
wrapper. Two conditions decide it - the ad is an item of a horizontal flex row,
and it holds no block-level content. A card that merely happens to sit in a row
has `div`s and `p`s in it, so it is still removed outright, wrapper included.

The popup's **Hide an element on the page** button is the part no heuristic can
replace. Click it, click an ad nothing recognised, and the rule is saved to
`chrome.storage.sync` and reapplied on every future visit. The picker builds the
most durable selector it can — a real attribute first, then an id, then any
`data-*` attribute, and a structural path only as a last resort, because
structural paths break the moment a layout changes.

Deliberate rules are applied last in every pass and are never second-guessed by
`rescue()`, so a rule you made by hand outranks anything inferred.

## Privacy

The extension has one host permission, no network requests of its own, and no
analytics. What it stores, and what it does not, is written out in
[`site/privacy.html`](site/privacy.html) — the policy both stores link to.

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
  build.mjs           packages both zips, writes update.xml, emits dist/
  serve.mjs           preview server (builds first, binds 0.0.0.0)
  validate.mjs        static checks Chrome would otherwise only fail at load
  test-detection.mjs  jsdom checks: hides the ads, keeps the chat
  test-site.mjs       jsdom checks: the install page's store button
  zip.mjs             minimal ZIP writer
  png.mjs             minimal PNG encoder + icon artwork
  store-assets.mjs    promo tile, marquee, and the four listing screenshots
  gen-icons.mjs       force-regenerate icons
site/               the install page and everything it serves
  index.html          markup; the version is stamped in at build time
  styles.css
  app.js              store-button detection; paste listing URLs into STORE_LINKS
  privacy.html        the policy both stores link to
  store-assets/       the listing art
  downloads/          the built zips
dist/               static output - served by the preview and by hosting
PUBLISHING.md       step-by-step store submissions, plus the listing copy
```

There are no npm dependencies. Uploaded files lose their executable bit, so the
packaging step is plain Node rather than a `zip` shell-out.

## Commands

```sh
npm run build     # package both zips -> site/downloads, write site/update.xml, emit dist/
npm run preview   # build, then serve dist/ on 0.0.0.0:$PORT (default 4173)
npm run icons     # force-regenerate extension/icons
npm run assets    # redraw the store art: promo tile, marquee, screenshots
npm run check     # syntax-check the build tooling
npm run validate  # static extension checks (manifest, icons, DNR rules, selectors)
npm test          # jsdom checks: the content script, then the install page
                  # (needs `npm i --no-save jsdom`)
```

## Hosting

`dist/` is the whole deployment: a static directory, no server, no build-time
secrets. `scripts/build.mjs` stamps the public origin into `site/update.xml`
and into the download links, so it has to match where the site is actually
served; `SITE_ORIGIN` overrides the default.

`extension/popup.js` (`INSTALL_URL`) points at the same origin, and
`npm run validate` fails if the two drift apart, because a mismatch is a dead
link in the popup and a dead `codebase` in the feed rather than anything visible
here.

## Auto-updates

`site/update.xml` is regenerated with every build with the matching version and
codebase URL, but **Chrome only consults an update feed for an extension
installed from that feed** — via a managed `ExtensionInstallForcelist` policy or
the Chrome Web Store. An extension loaded unpacked never polls it.

Before the feed goes live, replace `YOUR_EXTENSION_ID_HERE` with the packed
extension's real ID and point `codebase` at a signed CRX. The install page
explains both routes to the user rather than implying unpacked extensions
update themselves.

## Scope

Web version only. The desktop application is a separate binary with no
extension surface, so a browser extension cannot reach it.
