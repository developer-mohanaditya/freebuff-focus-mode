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
 * Detection is deliberately two-tiered:
 *   Tier A - explicit hooks (`[data-ad-slot]`, an iframe on an ad host). Safe
 *            to hide outright; the markup says what it is.
 *   Tier B - attribute *token* matching (`class="ad-slot"` -> tokens
 *            ["ad","slot"]). Tokenised rather than substring matching, because
 *            `[class*="ad"]` also matches header/add/read/load/deadline and
 *            would blank the page. Tier B additionally requires the subtree to
 *            be small, so a section that merely has "ad" in its class name and
 *            holds real content is left alone.
 */
(() => {
  'use strict';

  const STYLE_ID = 'freebuff-adblock-style';
  const HIDDEN_CLASS = 'fbad-hidden';
  const ENABLED_KEY = 'freebuffAdBlockEnabled';

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
  let scheduled = false;
  let hiddenThisFlush = 0;

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

  function hasAdMedia(el) {
    return !!el.querySelector(AD_MEDIA_SELECTOR);
  }

  function hasAnyMedia(el) {
    return !!el.querySelector(ANY_MEDIA_SELECTOR);
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

  /* -------------------------------------------------------------- classify */

  /** Returns 'a', 'b' or null. */
  function classify(el) {
    if (isNeverHidden(el)) return null;
    if (el.matches(TIER_A_SELECTOR)) return 'a';
    if (hasAdToken(el) && !hasRealContent(el)) return 'b';
    return null;
  }

  function hide(el) {
    if (el.classList.contains(HIDDEN_CLASS)) return false;
    el.classList.add(HIDDEN_CLASS);
    hiddenThisFlush++;
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
   * Real content streamed into a wrapper we already hid means we guessed
   * wrong - put it and its hidden ancestors back so nothing disappears.
   */
  function rescue(el) {
    const parent = el.parentElement;
    if (parent && parent.classList.contains(HIDDEN_CLASS)) unhideFrom(parent);
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
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.id === STYLE_ID) continue;
      pending.add(node);
    }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }

  function flush() {
    scheduled = false;

    if (!enabled) {
      pending.clear();
      return;
    }

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
        for (const node of record.addedNodes) nodes.push(node);
      }
      if (nodes.length) schedule(nodes);
    });

    const startObserving = () => {
      if (!document.body) return;
      observer.observe(document.body, { childList: true, subtree: true });
      rescueHidden(document.body);
      sweep(document.body);
    };

    if (document.body) startObserving();
    else document.addEventListener('DOMContentLoaded', startObserving, { once: true });
  }

  init();
})();
