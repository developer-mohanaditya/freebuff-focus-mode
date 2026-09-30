/**
 * Freebuff Ad Block - content script
 *
 * Network rules (rules.json) stop ad requests before they leave the browser,
 * but they cannot see markup freebuff.com renders client-side while it is
 * thinking. That is what this file is for:
 *
 *   1. inject a stylesheet that hides anything with an ad-shaped hook,
 *   2. watch the DOM for ad slots inserted mid-build,
 *   3. collapse the empty wrappers they leave behind.
 *
 * Safety rules this file must never break:
 *   - Never hide <html>, <head>, <body> or any landmark/shell element.
 *   - Never hide a subtree that carries real content (see hasRealContent).
 *   - Never fight the build stream: no network activity, no XHR, no fetch.
 *
 * Detection is deliberately three-tiered:
 *   Tier A - explicit hooks (`[data-ad-slot]`, an iframe on an ad host, a
 *            `data-gravity-ad` slot, a `rel="sponsored"` link). Safe to hide
 *            outright; the markup says what it is.
 *   Tier B - attribute *token* matching (`class="ad-slot"` -> tokens
 *            ["ad","slot"]). Tokenised rather than substring matching, because
 *            `[class*="ad"]` also matches header/add/read/load/deadline and
 *            would blank the page. Tier B additionally requires the subtree to
 *            be small, so a section that merely has "ad" in its class name and
 *            holds real content is left alone.
 *   Tier C - in-product promo cards. freebuff.com advertises to itself: a card
 *            with a literal "AD" chip, a headline, body copy and a call to
 *            action, injected straight into the thread. Nothing third-party
 *            loads, and nothing in the markup says "ad", so the badge text is
 *            the only hook there is.
 */
(() => {
  'use strict';

  const STYLE_ID = 'freebuff-adblock-style';
  const HIDDEN_CLASS = 'fbad-hidden';
  const ENABLED_KEY = 'freebuffAdBlockEnabled';
  const PING_TYPE = 'freebuff-adblock:ping';
  const PICK_TYPE = 'freebuff-adblock:pick';
  const CUSTOM_KEY = 'freebuffAdBlockSelectors';
  const CUSTOM_STYLE_ID = 'freebuff-adblock-custom';
  const PICK_BAR_ID = 'freebuff-adblock-picker';
  const PICK_BAR_STYLE =
    'position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);' +
    'background:#0d1017;color:#e9edf5;font:12px/1.4 ui-sans-serif,system-ui,sans-serif;' +
    'padding:8px 14px;border-radius:999px;border:1px solid rgba(255,90,69,.5);' +
    'box-shadow:0 8px 24px rgba(0,0,0,.45);pointer-events:none;';

  // Ad and tracker hosts a free-tier slot is likely to load from.
  const AD_HOSTS = [
    'doubleclick.net',
    'googlesyndication.com',
    'googlesyndication.net',
    'googleadservices.com',
    'adservice.google.com',
    'google-analytics.com',
    'googletagmanager.com',
    'amazon-adsystem.com',
    'media.net',
    'adnxs.com',
    'criteo.com',
    'taboola.com',
    'outbrain.com',
    'pubmatic.com',
    'rubiconproject.com',
    'openx.net',
    'smartadserver.com',
    'yieldmo.com',
    'mgid.com',
    'revcontent.com',
    'casalemedia.com',
    'indexexchange.com',
    'sharethrough.com',
    'triplelift.com',
    'teads.tv',
    'moatads.com',
  ];

  // Tier A - narrow, literal, substring-based. Safe because each fragment is
  // already ad-specific and could not occur in ordinary UI class names.
  const AD_SELECTORS = [
    '[data-ad]',
    '[data-ad-slot]',
    '[data-ad-unit]',
    '[data-ad-container]',
    '[data-ad-client]',
    '[data-google-query-id]',
    // Ad-network hooks. These are the strongest signals in the file: a
    // first-party data attribute written by the ad server itself, the standard
    // sponsored-link rel value, and the ad network's own click endpoint. The
    // in the preview toolbar carries all three and - unlike the promo cards -
    // carries no text label at all, so nothing text-based could have found it.
    // The click path is matched generically, not by host, and the remaining
    // attribute variants are covered by hasNetworkAttribute below - CSS cannot
    // match an attribute *name* prefix, so only the likely spellings are listed
    // here and the rest are caught in script.
    '[data-gravity-ad]',
    '[data-gravity-ad-slot]',
    '[data-gravity-ad-unit]',
    '[data-gravity-sponsored]',
    'a[rel~="sponsored"]',
    'a[href*="/track/click"]',
    '[data-testid*="ad-slot"]',
    '[data-testid*="ad-banner"]',
    '[data-testid*="ad-container"]',
    '[data-testid*="sponsored"]',
    '[class*="ad-banner"]',
    '[class*="ad-slot"]',
    '[class*="ad-unit"]',
    '[class*="ad-container"]',
    '[class*="ad-wrapper"]',
    '[class*="ads-wrapper"]',
    '[class*="ads-container"]',
    '[class*="sponsored-"]',
    '[class*="sponsoredContent"]',
    '[class*="google-auto-placed"]',
    '[id*="ad-container"]',
    '[id*="ad-slot"]',
    '[class*="interstitial"]',
    '[aria-label*="Advertisement"]',
    '[title*="Advertisement"]',
    '.adsbygoogle',
    'ins.adsbygoogle',
  ];

  // Elements that may never receive the hidden class, no matter what they match.
  const NEVER_HIDE_SELECTORS = [
    'html',
    'head',
    'body',
    'main',
    'header',
    'nav',
    'footer',
    'aside',
    '[role="main"]',
    '[role="banner"]',
    '[role="navigation"]',
    '[role="contentinfo"]',
    '[role="complementary"]',
    '[role="log"]',
    '[role="progressbar"]',
    '[role="status"]',
    '[role="alert"]',
    '[role="article"]',
    '[role="region"]',
    '[contenteditable="true"]',
  ].join(', ');

  // Tier B - exact attribute tokens, split on - _ and whitespace.
  const AD_TOKENS = new Set([
    'ad',
    'ads',
    'advert',
    'advertisement',
    'adslot',
    'adunit',
    'adbanner',
    'adcontainer',
    'adsense',
    'adserver',
    'adframe',
    'adsbygoogle',
    'dfp',
    'gpt',
    'sponsored',
    'sponsor',
    'interstitial',
  ]);

  const TOKEN_SOURCE_ATTRS = [
    'class',
    'id',
    'data-testid',
    'data-slot',
    'data-ad-type',
    'aria-label',
    'title',
  ];

  // An element matching only on Tier B heuristics is never hidden if it has
  // more text than an ad unit could carry, or media that did not come from a
  // known ad host. This is the guard that keeps a section with "ad" somewhere
  // in its class name from disappearing.
  const MAX_HEURISTIC_TEXT = 300;

  // Tier C - freebuff.com's own in-product promo cards.
  //
  // These are rendered by freebuff.com itself, so no network rule can reach
  // them, and they carry no ad-shaped class or id - the literal "AD" chip is
  // the only reliable hook, which means this tier reads text where A and B read
  // attributes. Two guards keep that from eating real content:
  //   - the badge must be a leaf element whose entire text is a label like "AD";
  //   - the wrapper found above it must hold a link or a button, must stay
  //     under MAX_PROMO_TEXT characters, and must contain no code or editor.
  const BADGE_LABELS = new Set([
    'ad',
    'ads',
    'advert',
    'advertisement',
    'sponsored',
    'promoted',
  ]);

  const BADGE_LEAF_SELECTOR = 'span, b, strong, em, i, small, sup, mark, abbr, p, div, a';
  const MAX_BADGE_LENGTH = 24;
  const MAX_BADGE_CHILDREN = 2;
  const PROMO_MIN_TEXT = 12;
  const MAX_PROMO_TEXT = 600;
  const MAX_PROMO_DEPTH = 8;
  const MAX_PROMO_ACTIONS = 2;
  const PROMO_ACTION_SELECTOR = 'a[href], button, [role="button"], input[type="submit"]';
  const REAL_CONTENT_SELECTOR =
    'pre, code, textarea, input, [contenteditable="true"], video, audio';

  const ANY_MEDIA_SELECTOR = 'iframe, embed, object, ins, video, audio, source, img';

  const AD_MEDIA_SELECTOR = AD_HOSTS.map(
    (h) =>
      `iframe[src*="${h}"], img[src*="${h}"], embed[src*="${h}"], ` +
      `object[data*="${h}"], source[src*="${h}"], video[src*="${h}"]`
  ).join(', ');

  const TIER_A_ENTRIES = AD_SELECTORS.concat(
    AD_HOSTS.map((h) => `iframe[src*="${h}"], img[src*="${h}"]`)
  );

  // The stylesheet takes the whole list at once - CSS has no practical length
  // cap. Matching is done in small groups instead, because one enormous
  // selector is a fragile thing: an engine that refuses it rejects every hook
  // in the list at once, silently, which is exactly how the toolbar strip kept
  // its place after the hooks for it already existed.
  const TIER_A_GROUPS = [];
  for (let i = 0; i < TIER_A_ENTRIES.length; i += 5) {
    TIER_A_GROUPS.push(TIER_A_ENTRIES.slice(i, i + 5).join(', '));
  }

  const TIER_A_SELECTOR = TIER_A_ENTRIES.join(', ');

  const CANDIDATE_SELECTOR = TOKEN_SOURCE_ATTRS.map((a) => `[${a}]`).join(', ');

  const css = [
    `${TIER_A_SELECTOR} {`,
    '  display: none !important;',
    '  visibility: hidden !important;',
    '}',
    `.${HIDDEN_CLASS} {`,
    '  display: none !important;',
    '  visibility: hidden !important;',
    '}',
  ].join('\n');

  // User-picked selectors, kept separate from everything inferred on our own.
  // These are rules a person made deliberately, so they are applied last and
  // they survive a re-render, a rescue, and anything else in this file.
  const PICK_ATTRS = ['data-gravity-ad', 'data-ad', 'data-ad-slot', 'data-ad-unit', 'data-testid'];

  let customSelectors = [];
  let customStyleEl = null;
  let styleEl = null;
  let enabled = true;
  let observer = null;
  const pending = new Set();
  const pendingBadges = new Set();
  let scheduled = false;
  let hiddenThisFlush = 0;
  let hiddenTotal = 0;

  /* ------------------------------------------------------------------ setup */

  function injectStyle() {
    if (styleEl && styleEl.isConnected) return styleEl;
    styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = css;
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.disabled = !enabled;
    return styleEl;
  }

  function setEnabled(next) {
    const wasEnabled = enabled;
    enabled = !!next;
    if (styleEl) styleEl.disabled = !enabled;
    if (customStyleEl) customStyleEl.disabled = !enabled;
    if (enabled && !wasEnabled && document.body) {
      rescueHidden(document.body);
      sweep(document.body);
    }
  }

  /* ----------------------------------------------------------- token helpers */

  function tokensOf(value) {
    return value ? value.split(/[\s_-]+/).filter(Boolean) : [];
  }

  function hasAdToken(el) {
    for (const attr of TOKEN_SOURCE_ATTRS) {
      const raw = el.getAttribute(attr);
      if (!raw) continue;
      for (const token of tokensOf(raw)) {
        if (AD_TOKENS.has(token.toLowerCase())) return true;
      }
    }
    return false;
  }

  function textLength(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().length;
  }

  // Both of these can be handed a very long generated selector, so they fail
  // closed ("no media found") rather than throwing out of the pass.
  function hasAdMedia(el) {
    try {
      return !!el.querySelector(AD_MEDIA_SELECTOR);
    } catch {
      return false;
    }
  }

  function hasAnyMedia(el) {
    try {
      return !!el.querySelector(ANY_MEDIA_SELECTOR);
    } catch {
      return false;
    }
  }

  function isNeverHidden(el) {
    try {
      return el.matches(NEVER_HIDE_SELECTORS);
    } catch {
      return true;
    }
  }

  /**
   * True when a Tier B (heuristic) match should be left alone because the
   * subtree looks like real page content rather than an ad unit.
   */
  function hasRealContent(el) {
    if (hasAdMedia(el)) return false; // ad-host media inside: it is an ad
    if (hasAnyMedia(el)) return true; // media, but from somewhere legitimate
    return textLength(el) > MAX_HEURISTIC_TEXT;
  }

  /* ------------------------------------------------------- user-picked rules */

  function injectCustomStyle() {
    customStyleEl = document.getElementById(CUSTOM_STYLE_ID);
    if (!customStyleEl) {
      customStyleEl = document.createElement('style');
      customStyleEl.id = CUSTOM_STYLE_ID;
      (document.head || document.documentElement).appendChild(customStyleEl);
    }

    customStyleEl.textContent = customSelectors
      .map((selector) => `${selector} { display: none !important; visibility: hidden !important; }`)
      .join(' ');
    customStyleEl.disabled = !enabled;
  }

  function matchesCustom(el) {
    for (const selector of customSelectors) {
      try {
        if (el.matches(selector)) return true;
      } catch {
        // A rule that no longer parses simply stops matching; the rest carry on.
      }
    }
    return false;
  }

  /** Applied last in every pass, so nothing else can undo a deliberate rule. */
  function applyCustom(root) {
    for (const selector of customSelectors) {
      let found;
      try {
        found = root.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const el of found) hide(el);
    }
  }

  /* ------------------------------------------------------------ promo cards */

  /**
   * True when el's whole text is an ad label.
   *
   * Decided on text rather than on being a leaf, because the chip may hold an
   * icon, and some builds put the label in the same element as the sponsor name
   * ("Baseten AD"). Anything holding more than a label's worth of text is
   * rejected, and the child-count check up front keeps the textContent reads
   * off the bulk of the tree.
   */
  function isBadge(el) {
    if (el.children.length > MAX_BADGE_CHILDREN) return false;
    const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw || raw.length > MAX_BADGE_LENGTH) return false;

    const whole = raw.replace(/[^a-z]/gi, '').toLowerCase();
    if (whole !== '' && BADGE_LABELS.has(whole)) return true;

    if (!raw.includes(' ')) return false;
    const last = raw.split(' ').pop().replace(/[^a-z]/gi, '').toLowerCase();
    return BADGE_LABELS.has(last);
  }

  /**
   * True when node is plausibly the card a badge labels: short enough to be a
   * promo unit, with a call to action, and without the code or input fields a
   * real message or the composer would contain.
   */
  function isPromoCard(node) {
    if (isNeverHidden(node)) return false;

    let actions;
    try {
      if (node.querySelector(REAL_CONTENT_SELECTOR)) return false;
      actions = node.querySelectorAll(PROMO_ACTION_SELECTOR).length;
    } catch {
      return false;
    }

    // Two calls to action at most - and none is allowed too. Several of these
    // promos are plain divs with a framework click handler rather than an
    // anchor, so demanding a link misses them, which is how the strip inside the
    // preview toolbar kept its place. The cap is the guard that matters: a
    // wrapper that swallowed the card along with the skill chips or the message
    // buttons under it is well past it, and taking working UI with it is
    // exactly the climb this has to refuse.
    if (actions > MAX_PROMO_ACTIONS) return false;

    const length = textLength(node);
    return length >= PROMO_MIN_TEXT && length <= MAX_PROMO_TEXT;
  }

  /**
   * Climb from a badge to the outermost wrapper that is still only the card.
   * Stops as soon as an ancestor stops looking like one, so the climb cannot
   * escape into the message list or the composer.
   */
  function findPromoCard(badge) {
    let card = null;
    let node = badge.parentElement;
    let depth = 0;

    while (node && node !== document.body && depth < MAX_PROMO_DEPTH) {
      if (isNeverHidden(node)) break;
      if (isPromoCard(node)) card = node;
      else if (card) break;
      node = node.parentElement;
      depth++;
    }

    return card;
  }

  function hideBadgeCard(el) {
    if (el.nodeType !== Node.ELEMENT_NODE || !isBadge(el)) return;
    const card = findPromoCard(el);
    if (!card) return;
    if (hide(card)) collapseUp(card);
  }

  /** Hide every promo card labelled by a badge inside root. */
  function scanBadges(root) {
    hideBadgeCard(root);

    let leaves;
    try {
      leaves = root.querySelectorAll(BADGE_LEAF_SELECTOR);
    } catch {
      return;
    }

    for (const el of leaves) hideBadgeCard(el);
  }

  /* -------------------------------------------------------------- classify */

  /**
   * Tier A match, never throwing: a selector engine limit or a malformed
   * attribute must not abort the pass that hides the ads. Failing open here
   * still leaves tier B and the promo tier running.
   */
  function matchesTierA(el) {
    for (const group of TIER_A_GROUPS) {
      try {
        if (el.matches(group)) return true;
      } catch {
        // A group the engine refuses must not take the others down with it.
      }
    }
    return false;
  }

  /**
   * Attribute *names* an ad network tends to use. A stylesheet cannot match a
   * name prefix, so these are checked in script: a slot marked with
   * `data-gravity-ad-anything` in future is caught without touching the
   * selector list. Every prefix stays ad-specific, so an unrelated
   * `data-gravity-*` attribute on real UI cannot match one.
   */
  const NETWORK_ATTR_PREFIXES = ['data-gravity-ad', 'data-gravity-sponsored', 'data-gravity-promo'];

  function hasNetworkAttribute(el) {
    for (const attr of el.attributes) {
      const name = attr.name;
      if (!name.startsWith('data-')) continue;
      for (const prefix of NETWORK_ATTR_PREFIXES) {
        if (name.startsWith(prefix)) return true;
      }
    }
    return false;
  }

  /** Returns 'a', 'b' or null. */
  function classify(el) {
    if (isNeverHidden(el)) return null;
    if (matchesTierA(el)) return 'a';
    if (hasNetworkAttribute(el)) return 'a';
    if (hasAdToken(el) && !hasRealContent(el)) return 'b';
    return null;
  }

  function hide(el, counted = true) {
    if (el.classList.contains(HIDDEN_CLASS)) return false;
    el.classList.add(HIDDEN_CLASS);
    if (counted) {
      hiddenThisFlush++;
      hiddenTotal++;
    }
    return true;
  }

  /**
   * Walk up from a hidden ad and hide ancestors that contain nothing but the
   * ad itself, reclaiming the blank space a removed slot would leave.
   * Stops at the first ancestor holding real content, at any landmark element,
   * and at a hard depth cap.
   */
  function collapseUp(el) {
    let node = el.parentElement;
    let depth = 0;

    while (node && depth < 6) {
      if (isNeverHidden(node)) break;
      if (!isPureAdWrapper(node)) break;
      hide(node);
      node = node.parentElement;
      depth++;
    }
  }

  function isPureAdWrapper(node) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.COMMENT_NODE) continue;

      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent && child.textContent.trim() !== '') return false;
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (child.classList.contains(HIDDEN_CLASS)) continue;
      if (child.tagName === 'BR' || child.tagName === 'HR') continue;
      if (classify(child)) continue;

      return false;
    }
    return true;
  }

  /** Remove the hidden class from el and any hidden ancestors. */
  function unhideFrom(el) {
    let node = el;
    let depth = 0;
    while (node && depth < 8 && node.classList && node.classList.contains(HIDDEN_CLASS)) {
      if (isNeverHidden(node)) break;
      node.classList.remove(HIDDEN_CLASS);
      node = node.parentElement;
      depth++;
    }
  }

  /**
   * True when an element we already hid still looks like an ad: it matches a
   * tier A hook, or it still carries an ad badge.
   */
  function isStillAd(el) {
    if (matchesTierA(el)) return true;

    let leaves;
    try {
      leaves = el.querySelectorAll(BADGE_LEAF_SELECTOR);
    } catch {
      return false;
    }

    for (const node of leaves) {
      if (isBadge(node)) return true;
    }
    return false;
  }

  /**
   * Real content streamed into a wrapper we already hid means we guessed wrong -
   * put it and its hidden ancestors back so nothing disappears.
   *
   * The exception is the whole reason a promo card used to reappear the moment
   * you sent another prompt: these cards rebuild their own contents on every
   * render, and treating that rebuild as a false positive tore the hide straight
   * back down. A hide only comes off when the element has stopped looking like
   * an ad.
   */
  function rescue(el) {
    const parent = el.parentElement;
    if (!parent || !parent.classList.contains(HIDDEN_CLASS)) return;
    if (isStillAd(parent)) return;
    // A rule someone made by hand is never second-guessed.
    if (matchesCustom(parent)) return;
    unhideFrom(parent);
  }

  /* ------------------------------------------------------------------ sweep */

  function process(el, tier) {
    if (!tier) {
      rescue(el);
      return;
    }
    hide(el);
    collapseUp(el);
  }

  /**
   * Classify `root` itself, then everything ad-shaped inside it. This is the
   * core routine: it runs over the whole document once, and over every subtree
   * the page inserts while it is building.
   */
  function scan(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE || !root.querySelectorAll) return;

    process(root, classify(root));

    for (const group of TIER_A_GROUPS) {
      let found;
      try {
        found = root.querySelectorAll(group);
      } catch {
        continue;
      }
      for (const el of found) process(el, 'a');
    }

    let candidates;
    try {
      candidates = root.querySelectorAll(CANDIDATE_SELECTOR);
    } catch {
      candidates = [];
    }
    for (const el of candidates) {
      const tier = classify(el);
      if (tier === 'b') process(el, 'b');
    }

    scanBadges(root);
    applyCustom(root);
  }

  /** Full pass: reset counter, scan, report. */
  function sweep(root) {
    hiddenThisFlush = 0;
    scan(root);
    report(hiddenThisFlush);
  }

  /**
   * Self-healing pass. Wrappers hidden earlier may have had legitimate content
   * streamed into them (typically while the extension was toggled off).
   */
  function rescueHidden(root) {
    if (!root || !root.querySelectorAll) return;
    let hidden;
    try {
      hidden = root.querySelectorAll(`.${HIDDEN_CLASS}`);
    } catch {
      return;
    }
    for (const el of hidden) {
      if (isPureAdWrapper(el)) continue;
      unhideFrom(el);
    }
  }

  /* --------------------------------------------------------------- observer */

  function schedule(nodes) {
    for (const node of nodes) {
      // Setting textContent - what React does when it fills in a label after
      // mount - arrives here as a *new text node*, not as a characterData
      // mutation. Dropping those is how a badge gets missed entirely.
      if (node.nodeType === Node.TEXT_NODE) {
        scheduleBadge(node);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.id === STYLE_ID) continue;
      pending.add(node);
    }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }

  /**
   * A badge often shows up as a text change inside markup that was already on
   * the page, which is why the observer listens for characterData too. Those
   * records are checked directly instead of triggering a subtree scan: the page
   * streams text constantly while it builds, and rescanning on every character
   * would be a lot of work for nothing.
   */
  /** True when a class rewrite took our hidden class off an element. */
  function lostHiddenClass(record) {
    const target = record.target;
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
    if (target.classList.contains(HIDDEN_CLASS)) return false;
    return typeof record.oldValue === 'string' && record.oldValue.includes(HIDDEN_CLASS);
  }

  function scheduleBadge(node) {
    const el = node && node.parentElement;
    if (!el) return;
    pendingBadges.add(el);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }

  function flush() {
    scheduled = false;

    if (!enabled) {
      pending.clear();
      pendingBadges.clear();
      return;
    }

    // The stylesheet is the only thing that actually hides anything. If the page
    // rebuilt its head, every hide already made is silently inert, so check it
    // here instead of trusting that it survived.
    if (!styleEl || !styleEl.isConnected) injectStyle();

    hiddenThisFlush = 0;
    const batch = Array.from(pending);
    pending.clear();

    for (const el of batch) {
      if (!el.isConnected) continue;
      try {
        scan(el);
      } catch {
        // A malformed subtree must never break the page.
      }
    }

    const badges = Array.from(pendingBadges);
    pendingBadges.clear();

    for (const el of badges) {
      if (!el.isConnected) continue;
      try {
        hideBadgeCard(el);
      } catch {
        // Same rule: never let one bad node break the page.
      }
    }

    report(hiddenThisFlush);
  }

  /* --------------------------------------------------------------- reporting */

  function report(count) {
    if (!count) return;
    try {
      const result = chrome.runtime.sendMessage({
        type: 'freebuff-adblock:hidden',
        count,
      });
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // Extension context invalidated (reloaded/uninstalled) - ignore.
    }
  }

  /* ------------------------------------------------------------------- state */

  function readState() {
    try {
      chrome.storage.sync.get({ [ENABLED_KEY]: true, [CUSTOM_KEY]: [] }, (value) => {
        if (chrome.runtime.lastError) return;
        const saved = value[CUSTOM_KEY];
        customSelectors = Array.isArray(saved) ? saved : [];
        injectCustomStyle();
        setEnabled(value[ENABLED_KEY]);
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;

        if (Object.prototype.hasOwnProperty.call(changes, CUSTOM_KEY)) {
          const saved = changes[CUSTOM_KEY].newValue;
          customSelectors = Array.isArray(saved) ? saved : [];
          injectCustomStyle();
          if (enabled && document.body) {
            rescueHidden(document.body);
            sweep(document.body);
          }
        }

        if (!Object.prototype.hasOwnProperty.call(changes, ENABLED_KEY)) return;
        setEnabled(changes[ENABLED_KEY].newValue);
      });
    } catch {
      enabled = true;
    }
  }

  /* --------------------------------------------------------------------- go */

  function init() {
    if (document.getElementById(STYLE_ID)) return;

    injectStyle();
    injectCustomStyle();
    readState();

    observer = new MutationObserver((records) => {
      const nodes = [];
      for (const record of records) {
        if (record.type === 'characterData') {
          scheduleBadge(record.target);
          continue;
        }

        // A framework re-render that rewrites className takes our hidden class
        // with it, and the ad is back without a single node being inserted. Put
        // the class straight back rather than rescanning - the old value proves
        // this element was one we hid, and re-adding it fires no further change.
        if (record.type === 'attributes') {
          if (lostHiddenClass(record)) hide(record.target, false);
          continue;
        }

        for (const node of record.addedNodes) nodes.push(node);
      }
      if (nodes.length) schedule(nodes);
    });

    const startObserving = () => {
      if (!document.body) return;
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class'],
        attributeOldValue: true,
      });
      rescueHidden(document.body);
      sweep(document.body);
    };

    if (document.body) startObserving();
    else document.addEventListener('DOMContentLoaded', startObserving, { once: true });
  }

  /* ----------------------------------------------------------------- picking */

  /**
   * The escape hatch, and the only part of this file that cannot be caught out
   * by markup it has never seen. An unrecognised ad is one click away from
   * becoming a rule that holds on every future visit.
   */
  let picking = false;
  let pickBar = null;
  let pickHovered = null;
  let pickHoveredOutline = '';

  function isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  /**
   * Build the most durable selector we can for an element: a real attribute
   * first, an id second, then any data-* attribute, and only then a structural
   * path - which is the fragile one, so it is the last resort.
   */
  function describeElement(el) {
    const tag = el.tagName.toLowerCase();

    for (const attr of PICK_ATTRS) {
      if (el.hasAttribute(attr)) return `${tag}[${attr}]`;
    }

    const id = el.getAttribute('id');
    if (id && !id.includes(':') && !isDigit(id.charAt(0))) return `#${id}`;

    for (const attr of el.attributes) {
      const name = attr.name;
      if (!name.startsWith('data-')) continue;
      if (name === 'data-state' || name === 'data-slot') continue;
      if (attr.value.length > 40) continue;
      return `${tag}[${name}]`;
    }

    const path = [];
    let node = el;
    let depth = 0;

    while (node && node !== document.body && depth < 6) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((sib) => sib.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      path.unshift(part);
      node = parent;
      depth++;
    }

    return path.join(' > ');
  }

  function highlight(el) {
    if (pickHovered === el) return;
    if (pickHovered) pickHovered.style.outline = pickHoveredOutline;
    pickHovered = el;
    if (el) {
      pickHoveredOutline = el.style.outline;
      el.style.outline = '2px solid #ff5a45';
    }
  }

  function pickTarget(event) {
    const el = event.target;
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return null;
    if (el.id === PICK_BAR_ID) return null;
    return el;
  }

  function onPickMove(event) {
    const el = pickTarget(event);
    if (el) highlight(el);
  }

  function onPickClick(event) {
    const el = pickTarget(event);
    if (!el) return;

    // The click belongs to us while picking, not to the page.
    event.preventDefault();
    event.stopPropagation();

    if (isNeverHidden(el) || el === document.body) {
      if (pickBar) pickBar.textContent = 'That is part of the page frame - pick something smaller.';
      return;
    }

    rememberSelector(describeElement(el));
    hide(el);
    stopPicking();
  }

  function onPickKey(event) {
    if (event.key === 'Escape') stopPicking();
  }

  function rememberSelector(selector) {
    if (!selector) return;
    if (customSelectors.includes(selector)) return;

    customSelectors = customSelectors.concat(selector);
    try {
      chrome.storage.sync.set({ [CUSTOM_KEY]: customSelectors });
    } catch {
      // Storage unavailable: the rule still holds for this page.
    }
    injectCustomStyle();
  }

  function startPicking() {
    if (picking) return;
    picking = true;

    pickBar = document.createElement('div');
    pickBar.id = PICK_BAR_ID;
    pickBar.textContent = 'Click the ad to hide it - Esc to cancel';
    pickBar.setAttribute('style', PICK_BAR_STYLE);
    (document.body || document.documentElement).appendChild(pickBar);

    document.addEventListener('mousemove', onPickMove, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickKey, true);
  }

  function stopPicking() {
    if (!picking) return;
    picking = false;

    document.removeEventListener('mousemove', onPickMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickKey, true);

    highlight(null);
    if (pickBar && pickBar.parentElement) pickBar.parentElement.removeChild(pickBar);
    pickBar = null;
  }

  /* ------------------------------------------------------------------- ping */

  /**
   * The popup asks a tab whether this script is actually running. Without it,
   * "nothing was found" and "nothing is running" look identical from the
   * outside - which is exactly the confusing case when a tab was already open
   * before the extension was enabled.
   */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) return;

    if (message.type === PICK_TYPE) {
      startPicking();
      sendResponse({ ok: true, picking: true });
      return;
    }

    if (message.type !== PING_TYPE) return;
    sendResponse({
      ok: true,
      enabled,
      hidden: hiddenTotal,
      custom: customSelectors.length,
      version: chrome.runtime.getManifest().version,
    });
  });

  init();
})();
