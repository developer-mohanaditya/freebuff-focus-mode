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
 *   Tier A - explicit hooks (`[data-ad-slot]`, an iframe on an ad host). Safe
 *            to hide outright; the markup says what it is.
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

  const TIER_A_SELECTOR = AD_SELECTORS.concat(
    AD_HOSTS.map((h) => `iframe[src*="${h}"], img[src*="${h}"]`)
  ).join(', ');

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
    try {
      return el.matches(TIER_A_SELECTOR);
    } catch {
      return false;
    }
  }

  /** Returns 'a', 'b' or null. */
  function classify(el) {
    if (isNeverHidden(el)) return null;
    if (matchesTierA(el)) return 'a';
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

    let tierA;
    try {
      tierA = root.querySelectorAll(TIER_A_SELECTOR);
    } catch {
      tierA = [];
    }
    for (const el of tierA) process(el, 'a');

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
      chrome.storage.sync.get({ [ENABLED_KEY]: true }, (value) => {
        if (chrome.runtime.lastError) return;
        setEnabled(value[ENABLED_KEY]);
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync') return;
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

  /* ------------------------------------------------------------------- ping */

  /**
   * The popup asks a tab whether this script is actually running. Without it,
   * "nothing was found" and "nothing is running" look identical from the
   * outside - which is exactly the confusing case when a tab was already open
   * before the extension was enabled.
   */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== PING_TYPE) return;
    sendResponse({
      ok: true,
      enabled,
      hidden: hiddenTotal,
      version: chrome.runtime.getManifest().version,
    });
  });

  init();
})();
