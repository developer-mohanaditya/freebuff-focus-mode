# rules.json — declarativeNetRequest static ruleset

Chrome validates this file against a strict schema. **No comments and no
unknown properties are allowed inside it** — a single stray key makes Chrome
reject the entire ruleset and silently disable network blocking. The
explanations live here instead.

## Structure

| Rule id | Priority | Action | Purpose |
| --- | --- | --- | --- |
| `1` | 100 | `allow` | **Guardrail.** Allows everything on `freebuff.com`. |
| `10` | 1 | `block` | Google ads / measurement / tag delivery. |
| `11` | 1 | `block` | Amazon ad system. |
| `12` | 1 | `block` | Programmatic + RTB exchanges. |
| `13` | 1 | `block` | Native / content-recommendation units. |
| `14` | 1 | `block` | Ad-network tracking on `trygravity.ai/track/`. |
| `15` | 1 | `block` | `/ads/` path segment. |
| `16` | 1 | `block` | `/adserver` path segment. |
| `17` | 1 | `block` | `/advert` path segment. |

Ids are grouped by decade (10s = Google, 12s = programmatic, 15s = path rules)
so new domains slot into an existing group without renumbering.

## Why rule 1 can never be outranked

Every block rule is `priority: 1`. Rule 1 is `priority: 100`. Chrome resolves
DNR by highest priority first, so an `allow` at 100 always beats a `block` at 1.
Rule 1 matches `requestDomains: ["freebuff.com"]`, which covers the apex and all
subdomains — that is where the build/thinking stream lives (XHR, SSE and
WebSocket). Nothing in this file can cut that stream off.

If you ever raise a block rule's priority above 100, you have broken the
product's own progress feed. Don't.

## Why every block rule carries `initiatorDomains`

`initiatorDomains: ["freebuff.com"]` means "only when freebuff.com is the page
that started the request". A block rule with no initiator scope would follow you
to every site in the browser, turning a site-scoped tool into a general-purpose
ad blocker — which is explicitly out of scope.

## Why path rules are slash-anchored

`/ads/`, `/adserver`, `/advert`. Never `ads`, `ad`, or `advert` bare — those
match `/load`, `/headers`, `/read`, `/cadslayer` and plenty of legitimate
first-party paths. Slash-anchoring keeps the false-positive surface tiny, and
rule 1 covers first-party hits anyway.

## Note on `_comment`

Earlier drafts of this file used `_comment` keys for grouping notes. Chrome's
DNR schema rejects unknown properties, which fails the whole ruleset. Keep
comments in this file only.

## The in-product ad network

freebuff.com serves its own in-product promos through an ad network whose
click endpoint is `api.trygravity.ai/track/click`, and the slots it injects are
marked three ways:

| Hook | Where it is |
| --- | --- |
| `data-gravity-ad="true"` | the slot element itself |
| `rel="noopener noreferrer sponsored"` | the wrapping anchor |
| `href="https://api.trygravity.ai/track/click?p=…"` | the wrapping anchor |

Those three are handled by `content.js` as tier A hooks, because a slot this
explicit does not need guessing. Rule 14 covers the tracking half of the same
network: the host is scoped by `/track/` rather than blocked outright, because
`trygravity.ai` also serves non-ad API traffic.

**Rule 14 deliberately does not list `main_frame`.** Clicking an ad is a
top-level navigation, and blocking a top-level navigation is how you break a
page - the browser shows an error instead of the destination. There is nothing
to click once `content.js` has removed the element, so the network rule only
needs to cover beacons.

## Adding a domain

Append it to the `requestDomains` array of the group it belongs to (create a new
rule with a fresh id if it doesn't fit). Keep `priority: 1` and keep the
`initiatorDomains` scope. Then reload the extension from `chrome://extensions`.
