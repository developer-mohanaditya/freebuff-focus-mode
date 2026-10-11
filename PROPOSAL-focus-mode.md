# Proposal: Rename Freebuff Ad Block → Freebuff Focus Mode

**Status:** Draft for review (fun project, no paid tier)
**Current version:** 1.6.0 (`Freebuff Ad Block`)
**Proposed version:** 1.7.0 (`Freebuff Focus Mode`)
**Scope:** Extension (Chromium + Firefox) + Desktop tools (macOS / Windows / Linux) + Site + Store listings
**Principle:** Ads ON by default. Focus is opt-in, temporary, local-only, reversible.

---

## 1. Executive summary

Rename the project from an **always-on ad blocker** to a **temporary Focus Mode**:

> "Hide distractions for deep-work sessions, then let ads support free models when you're out of focus."

Why:
1. **Matches reality from research:** users tolerate text-only between-turn ads because they get premium models for $0. No verified angry mob wants permanent blocking. They *do* want no visual noise during flow / screenshare / deadline.
2. **Moral conviction:** Freebuff funds free access with ads. `Focus Mode` respects that — default ON, session-scoped, with a visible "you supported X free responses" counter. `Ad Block` reads as killing revenue.
3. **Lower product / ToS / store risk:** Freebuff ToS (https://freebuff.com/terms-of-service) has no explicit ad-block ban, but bans "any device, software, or routine that interferes with Service" + allows termination at discretion. Advertiser Terms treat "never rendered" as invalid traffic. A temporary, cosmetic, user-controlled hide with ads-on default is far closer to JetBrains Distraction-Free / Stack Overflow reduced-ads than to YouTube Vanced / Spotify ReVanced (both got C&D / DMCA).
4. **Keeps the fun-project framing:** no paid tier, no accounts, no backend. Same zero-dependency, local-only architecture.

Non-goals for this rename:
- No paid / pro tier, no license key, no telemetry.
- No unlocking paid models, no bypassing auth / rate limits / paywalls.
- No permanent "block forever and forget" as default.
- No official affiliation claim.

---

## 2. Current state inventory (v1.6.0)

- `extension/manifest.json`: name `Freebuff Ad Block`, short `FB Ad Block`, desc `Blocks the ads on freebuff.com...`, v1.6.0, MV3, `declarativeNetRequest` + `storage`, host `freebuff.com`, content `content.js`, background `background.js`, popup `popup.*`, `rules.json` (network block) + `rules.md`.
- `extension/content.js`: STYLE_ID `freebuff-adblock-style`, HIDDEN_CLASS `fbad-hidden`, keys `freebuffAdBlockEnabled`, `freebuffAdBlockSelectors`, Tiers A/B/C detection, MutationObserver, picker ("Hide an element"), badge counting via `chrome.runtime.sendMessage`.
- `desktop/`: `freebuff-adblock.sh` (macOS), `freebuff-adblock.ps1` (Windows), `freebuff-adblock-linux.sh` (Linux) + launchers `Freebuff AdBlock.command` / `.cmd`, INSTALL txts. Anchors: `render` (auction gate → "no ads") + `request` (fail before send to `/api/v1/ads/*`). Commands: `status / verify / scan / install / revert / doctor`.
- `site/`: `index.html`, `app.js` (STORE_LINKS, platform switch), `privacy.html`, `update.xml`, `downloads/`, `store-assets/`.
- `scripts/`: `build.mjs`, `build-desktop.mjs`, `validate.mjs`, `test-detection.mjs`, `test-site.mjs`, `zip.mjs`, etc.
- Stores: Chrome Web Store + AMO live, hero button logic, privacy policy linked.

---

## 3. New positioning & naming

### 3.1 Names

| Place | Before | After |
|---|---|---|
| Full name | Freebuff Ad Block | **Freebuff Focus Mode** |
| Short name | FB Ad Block | **FB Focus** |
| Tagline | The ads stop. The build keeps streaming. | **Focus when you need it. Support when you don't.** |
| Extension desc (store, ≤132 chars) | Blocks the ads on freebuff.com... | `Temporary focus sessions for freebuff.com. Hides ad cards while you work, restores them after. Ads on by default.` |
| Desktop tool | freebuff-adblock.sh / .ps1 | `freebuff-focus.sh` / `freebuff-focus.ps1` / `freebuff-focus-linux.sh` (keep old names as shims for 1 release) |
| CSS / IDs | `freebuff-adblock-style`, `fbad-hidden` | `freebuff-focus-style`, `fb-focus-hidden` (migrate with backward-compat sweep) |
| Storage keys | `freebuffAdBlockEnabled`, `freebuffAdBlockSelectors` | `freebuffFocusEnabled` + `freebuffFocusMode` (`off|session|custom`), `freebuffFocusSelectors` (migrate old keys on load) |
| Message types | `freebuff-adblock:ping/pick/hidden` | `freebuff-focus:ping/pick/hidden/session` |

Trademark safety: add footer everywhere: `Unofficial fun project. Not affiliated with Freebuff or Codebuff.`

### 3.2 Core promise (for README + stores + site)

```
Freebuff is $0 forever because ads fund premium models.
Focus Mode doesn't remove that — it pauses visual noise while you do deep work,
then puts ads back.

- Ads ON by default
- Focus = 25 / 50 / 90 min or "until I turn it off"
- Countdown + "End focus & restore ads" always visible
- Counter: "Focused 25 min • Supported 12 free responses with 3 ad views"
- One click to revert, survives reloads, no account, no tracking
```

---

## 4. UX design

### 4.1 Extension popup (replace enable/disable)

```
[ Freebuff Focus Mode ]  (title + version)
Status: Ads showing | Focusing (18:42 left)
[ Start focus 25m ] [ 50m ] [ 90m ] [ Custom ]
[ ] Also dim in-product promo cards (default on)
[ ] Hide picked elements too (default on)
[ End focus & restore ads ]  (primary when focusing)
Link: How this supports Freebuff (site#focus-ethos)
Footer: Unofficial • v1.7.0 • Install page
Picker button stays: "Hide an element" → becomes focus-scoped.
```

Behavior:
- `Start focus` → set `freebuffFocusMode=session`, `sessionEndsAt=now+dur`, enable hiding, start badge timer.
- Timer expiry or `End focus` → disable hiding, `rescueHidden()` + re-enable stylesheet off, sweep to unhide, show "Thanks — ads restored" toast in popup.
- Browser restart mid-session: restore session if `sessionEndsAt` in future, else end.
- Badge: show `⏸ 18m` while focusing, else count of supported views (or blank). Never show blocked-count as trophy — show focus time + supported count.

### 4.2 Content script changes (minimal, ToS-safer)

Keep 3-tier detection as-is (it's well-guarded), change *when* it applies:

- Add `focusActive()` gate: `mode==session && now<endsAt` OR `mode==custom && enabled`.
- When not focusing: stylesheet `disabled=true`, observer still runs lightweight ping but does not hide. This preserves current safety (never hide html/body/landmarks/live UI).
- Add `FOCUS_STYLE` that *prefers* `visibility:hidden + pointer-events:none` (keep layout box) over `display:none` for in-flow strips — already done for gravity slots, extend to session hides. Rationale: less layout shift, less "never rendered" signal change vs network blocking.
- **Network rules (rules.json):** biggest moral/ToS lever. Options:
  - A (recommended for Focus Mode): ship ruleset **disabled by default**, enable only during focus session via `declarativeNetRequest.updateEnabledRulesets` or dynamic rules. Document as "pause requests during focus, resume after." Falls back to cosmetic hide if DNR unavailable.
  - B: keep network blocking always-on (current) — simplest code, but contradicts Focus ethos and keeps invalid-traffic risk.
  - Proposal: implement A, with popup toggle "Also pause ad requests during focus (default off, cosmetic hide only)". Default = cosmetic hide only.

### 4.3 Desktop tools (macOS / Win / Linux)

Current: permanent `install` (patch orchestrator.js, backup, revert on update). New:

- Keep `install / revert / status / verify / scan / doctor` exactly (no breaking change for existing users).
- Add session wrapper:
  ```
  sh freebuff-focus.sh focus 25m   # install + start timer + print restore time
  sh freebuff-focus.sh unfocus     # revert (restore backup) + verify
  sh freebuff-focus.sh status      # + shows focus until HH:MM if active
  ```
- `focus` = `install` + writes `~/.local/share/freebuff-focus/session` with endsAt. `unfocus` = `revert`. Document: "Quit + reopen Freebuff after each, updates wipe patch (same as before)."
- No daemon, no auto-revert timer (shell exits). Popup/site explains manual `unfocus`. Future: optional `--auto-minutes` that sleeps then reverts (explicit opt-in only).
- Rename files but keep shims: `freebuff-adblock.sh` → prints deprecation + execs `freebuff-focus.sh` for one minor version, then removed in 1.8.0.

---

## 5. Technical migration plan

### Phase 0 — Prep (no user-visible change)
- Branch `rename/focus-mode-1.7.0`.
- `npm run validate` + `npm test` green baseline, record.

### Phase 1 — Strings & manifest (extension)
- `manifest.json`: name, short_name, description, `default_title`, version 1.6.0 → 1.7.0.
- `popup.html/css/js`, `background.js`: copy changes, new buttons, timer, session storage, badge text. Migrate storage keys (read old, write new, delete old after).
- `content.js`: rename STYLE_ID / HIDDEN_CLASS (keep old class in `rescueHidden` sweep for 1 release so old hides get cleaned), add `focusActive()` gate, keep Tier A/B/C logic untouched.
- `rules.json` + `rules.md`: add `focus-only` variant + doc why DNR is session-scoped. Update `rules.md` reasoning section.
- Icons: keep shapes, shift palette from red/block (⛔) to calm/focus (🌙 / ◎). Regenerate via `gen-icons.mjs` + `store-assets.mjs`. No logo resembling Freebuff.

### Phase 2 — Desktop rename
- Copy `desktop/freebuff-adblock.*` → `freebuff-focus.*`, sed internal strings, backup dir `~/freebuff-patch-backups/` → keep (avoid orphaning backups) + new `~/.local/share/freebuff-focus/` for session file. Update INSTALL txts, `.command`/`.cmd` launchers.
- `scripts/build-desktop.mjs`, `desktop-fixtures.mjs`, `test-desktop*.mjs`: update paths + add `focus/unfocus` tests (install→status→unfocus→status, idempotence, refusal path unchanged).
- `scripts/validate.mjs`: assert new names present, old names absent except shims.

### Phase 3 — Site + docs + stores
- `site/index.html`: hero `Freebuff Focus Mode`, subhead from §3.2, three buttons stay (store + For Desktop), add `#focus-ethos` section ("Why ads stay on") + session demo GIF. Platform switch unchanged.
- `site/app.js`: STORE_LINKS unchanged, add focus timer demo (static, no tracking).
- `site/privacy.html`: update name, restate no collection, add "Focus sessions stored locally only (`chrome.storage.sync` / `~/.local/share/...`)".
- `README.md`, `PUBLISHING.md`: rewrite Why three layers → Why focus sessions; update commands, layout tree, hosting, scope sections. Keep install steps, add focus usage.
- `site/update.xml`: bump version, keep old download URLs as redirects (e.g. `/downloads/freebuff-adblock-desktop.sh` → new file) for 1 release.

### Phase 4 — Release 1.7.0
- `npm run build` → three zips renamed `freebuff-focus-<ver>.zip` (+ `-store`, `-firefox`), plus compat symlinks with old names for manual users.
- `npm run validate` + `npm test` (jsdom detection + site + all three desktop suites).
- Tag `v1.7.0`, update Chrome / AMO / Edge listings (name, desc, screenshots, privacy URL same). Note: stores treat rename as metadata update, no new listing needed unless ID changes — do NOT change GUIDs/IDs.
- Post in discussions / Reddit as focus tool, not blocker (see §7).

Rollback: keep `v1.6.0` tag + zips; shims ensure old commands/popups still work for one version.

---

## 6. Branding, copy, legal safety

- Every surface: `Unofficial community project for personal focus. Not affiliated with, endorsed by, or sponsored by Freebuff / Codebuff. Freebuff funds free access with ads — please keep ads on when not focusing.`
- Never: use Freebuff logo, claim "undetectable", "permanent ad-free", "official", or auto-enable on install.
- Default state after install: **ads visible, focus off**. User must explicitly start a session.
- Privacy: no new permissions. Keep `declarativeNetRequest + storage` only, host `freebuff.com` only. No new host, no fetch/XHR (content.js rule stays).
- Desktop: keep existing warning `Patching a third-party app's bundled code may conflict with that app's terms — that's on the person running it, nothing here does it silently.` Extend to `Focus sessions still modify bundled code — same warning, plus "please unfocus to restore ads."`

---

## 7. Go-to-market (as fun project)

- Title posts: `I built a Focus Mode for Freebuff (ads on by default, hides during deep work)` — not `ad blocker`.
- Seed in: HN thread reply, r/DeepSeek + r/opencodeCLI + r/aigamedev replies (ask, don't spam), Freebuff Discussion (ask if they'd want official reduced-ads/focus).
- Ask validation: `Do you use web vs desktop vs CLI? Would 25m sessions help? Is Codebuff Pro unsuitable? Would a support counter make you feel ok using it?`
- Success for fun project: 20–50 active focus users, a few "thanks, used during screenshare" comments, zero takedown notes. Not revenue.

---

## 8. Testing & acceptance

- `npm run validate`: passes (manifest, icons, DNR, selectors, all three desktop tools with new names + shims).
- `npm test`: passes (jsdom hides only when focusing, keeps chat/live UI; site store-button + ethos section; desktop patch/idempotence/revert/focus/unfocus/refusal/dry-run/relaunch verify on throwaway fixtures).
- Manual: install unpacked Chromium + temp Firefox, start 1-min focus on freebuff.com, confirm hides → timer ends → ads return; desktop `focus 1m` → quit/reopen → `verify` → `unfocus` → `verify`.
- Store dry-run: Chrome + AMO validators warn-free (Firefox `strict_min_version` 142.0, `data_collection_permissions none` preserved).

---

## 9. Risks & open questions

1. **Does cosmetic-hide still count as interference?** Lower risk than request-blocking, but ToS "interferes with Service" is broad + termination is discretionary. Mitigation: default-off, temporary, transparent, easy revert, no branding confusion.
2. **DNR pause vs hide-only?** Hide-only = safest for invalid-traffic, but ad still loads (perf). Default hide-only, opt-in pause. Needs decision before 1.7.0.
3. **Desktop patch fragility:** every Freebuff update (e.g. 0.0.164 anchors) wipes patch + may need re-anchor. `scan` + counted anchors already handle; focus wrapper adds no new fragility.
4. **Store rename friction:** screenshots/descriptions must be re-reviewed; AMO may re-ask data-collection. Keep IDs stable.
5. **CLI ads:** out of scope (advertiser page lists desktop/web/terminal). State explicitly: web + desktop app only, no terminal.

---

## 10. Effort estimate

- S: strings/manifest/site copy (1–2 hrs)
- M: popup timer + content gate + DNR session toggle + tests (4–6 hrs)
- M: desktop rename + focus/unfocus + fixtures/tests (3–5 hrs)
- S: icons/store assets + update.xml + redirects (1–2 hrs)
- Total: ~2–3 focused evenings, shippable as 1.7.0.

---

## Appendix: File rename map (proposed)

```
extension/manifest.json (edit, v1.7.0)
extension/content.js (edit: IDs, gate)
extension/background.js (edit: badge timer)
extension/popup.html/css/js (edit: session UI)
extension/rules.json (edit: focus variant) + rules.md (edit)
extension/icons/* (regenerate)
desktop/freebuff-adblock.sh → desktop/freebuff-focus.sh (+ shim)
desktop/freebuff-adblock.ps1 → desktop/freebuff-focus.ps1 (+ shim)
desktop/freebuff-adblock-linux.sh → desktop/freebuff-focus-linux.sh (+ shim)
desktop/Freebuff AdBlock.command → desktop/Freebuff Focus.command
desktop/Freebuff AdBlock.cmd → desktop/Freebuff Focus.cmd
desktop/INSTALL*.txt (edit)
site/index.html / app.js / privacy.html / update.xml (edit)
scripts/*.mjs (edit paths + tests)
README.md / PUBLISHING.md (rewrite §§)
```

No data migration beyond local storage key move. No server. No new permission.
