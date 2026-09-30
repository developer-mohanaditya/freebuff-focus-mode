/**
 * Freebuff Ad Block - MV3 service worker.
 *
 * Deliberately minimal. MV3 workers are ephemeral: anything this file needs to
 * remember must live in chrome.storage, never in a module-level variable,
 * because the worker can be torn down between messages.
 *
 * Responsibilities:
 *   - seed the default enabled state on install
 *   - keep a per-tab hidden-element count and mirror it onto the toolbar badge
 */

const ENABLED_KEY = 'freebuffAdBlockEnabled';
const COUNTS_KEY = 'hiddenCounts';
const MESSAGE_TYPE = 'freebuff-adblock:hidden';
const MAX_BADGE = '999+';

/* ------------------------------------------------------------- initialisation */

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get({ [ENABLED_KEY]: true }, (value) => {
    // get() with a default fills in missing keys, so this is idempotent.
    chrome.storage.sync.set({ [ENABLED_KEY]: value[ENABLED_KEY] });
  });
  resetCounts();
});

chrome.runtime.onStartup.addListener(resetCounts);

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
