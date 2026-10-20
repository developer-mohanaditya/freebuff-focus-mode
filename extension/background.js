/**
 * Freebuff Focus Mode - MV3 service worker.
 *
 * Deliberately minimal. MV3 workers are ephemeral: anything this file needs to
 * remember must live in chrome.storage, never in a module-level variable,
 * because the worker can be torn down between messages.
 *
 * Responsibilities:
 *   - turn network blocking on and off with the focus setting,
 *   - reset the per-tab count on install and at browser start (never the
 *     enabled state: a missing key is the default), and
 *   - keep a per-tab hidden-element count and mirror it onto the toolbar badge
 *
 * The ruleset is the half of focus that the page cannot undo. content.js only
 * hides what freebuff.com already rendered; requests cancelled here never
 * arrived. Both halves have to follow the same setting, or the popup says
 * "ads showing" while an ad-free page is still what loads.
 */

const ENABLED_KEY = 'freebuffFocusEnabled';
const RULESET_ID = 'focus_rules';
const COUNTS_KEY = 'hiddenCounts';
const MESSAGE_TYPE = 'freebuff-focus:hidden';
const MAX_BADGE = '999+';

/* ------------------------------------------------------------- initialisation */

chrome.runtime.onInstalled.addListener(() => {
  // Deliberately writes no enabled state. The default lives in one place -
  // a missing key means "ads showing" - so a fresh install has nothing stored
  // to disagree with the popup copy or with content.js. Seeding a value here
  // would silently turn focus on for every new user, which is the opposite of
  // what the listing promises.
  resetCounts();
  // An upgrade resets static rulesets to the manifest default (off), so the
  // stored setting has to be pushed back onto the ruleset - including for a
  // 1.6 install that was focusing when it updated.
  syncRuleset();
});

chrome.runtime.onStartup.addListener(() => {
  resetCounts();
  syncRuleset();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (!Object.prototype.hasOwnProperty.call(changes, ENABLED_KEY)) return;
  applyRuleset(!!changes[ENABLED_KEY].newValue);
});

/** Read the stored setting, then make the ruleset match it. */
function syncRuleset() {
  chrome.storage.sync.get({ [ENABLED_KEY]: false }, (value) => {
    if (chrome.runtime.lastError) return;
    applyRuleset(!!value[ENABLED_KEY]);
  });
}

/**
 * Enable or disable the static ruleset. Idempotent: Chrome accepts a no-op
 * update, and the call is cheap, so there is no local cache to get out of step
 * with the profile.
 */
function applyRuleset(enabled) {
  const update = enabled
    ? { enableRulesetIds: [RULESET_ID] }
    : { disableRulesetIds: [RULESET_ID] };
  chrome.declarativeNetRequest.updateEnabledRulesets(update, () => {
    // lastError is expected on Chrome builds where the ruleset is locked by an
    // administrator policy; the cosmetic half of focus still works without it.
    void chrome.runtime.lastError;
  });
}

function resetCounts() {
  chrome.storage.session.set({ [COUNTS_KEY]: {} }, paintAllBadges);
}

/* ------------------------------------------------------------------- counting */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== MESSAGE_TYPE) return;

  const tabId = sender.tab && sender.tab.id;
  const count = Number(message.count) || 0;
  if (tabId === undefined || count <= 0) return;

  chrome.storage.session.get({ [COUNTS_KEY]: {} }, (data) => {
    const counts = data[COUNTS_KEY] || {};
    counts[tabId] = (counts[tabId] || 0) + count;
    chrome.storage.session.set({ [COUNTS_KEY]: counts }, () => paintBadge(tabId, counts[tabId]));
  });

  sendResponse({ ok: true });
});

function paintBadge(tabId, value) {
  const text = value > 999 ? MAX_BADGE : String(value || '');
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#FF5A45' });
}

function paintAllBadges() {
  chrome.storage.session.get({ [COUNTS_KEY]: {} }, (data) => {
    const counts = data[COUNTS_KEY] || {};
    for (const tabId of Object.keys(counts)) paintBadge(Number(tabId), counts[tabId]);
  });
}

/* ------------------------------------------------------------------ teardown */

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.get({ [COUNTS_KEY]: {} }, (data) => {
    const counts = data[COUNTS_KEY] || {};
    if (!(tabId in counts)) return;
    delete counts[tabId];
    chrome.storage.session.set({ [COUNTS_KEY]: counts });
  });
});
