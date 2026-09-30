/**
 * Freebuff Ad Block - popup.
 *
 * The toggle writes to chrome.storage.sync; the content script listens for
 * chrome.storage.onChanged and applies it. The popup never talks to the page
 * directly, so it keeps working even if the tab is mid-navigation.
 */

const ENABLED_KEY = 'freebuffAdBlockEnabled';
const COUNTS_KEY = 'hiddenCounts';

// Kept in sync with SITE_ORIGIN in scripts/build.mjs.
const INSTALL_URL = 'https://freebuff-adblock.vercel.app/';

const toggle = document.getElementById('toggle');
const stateText = document.getElementById('stateText');
const countEl = document.getElementById('count');
const installLink = document.getElementById('installLink');

installLink.href = INSTALL_URL;

/* ------------------------------------------------------------------- toggle */

function renderToggle(enabled) {
  toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
  stateText.textContent = enabled ? 'On' : 'Paused';
  stateText.classList.toggle('on', enabled);
}

chrome.storage.sync.get({ [ENABLED_KEY]: true }, (value) => {
  if (chrome.runtime.lastError) return;
  renderToggle(value[ENABLED_KEY]);
});

toggle.addEventListener('click', () => {
  const next = toggle.getAttribute('aria-checked') !== 'true';
  renderToggle(next);
  chrome.storage.sync.set({ [ENABLED_KEY]: next });
});

/* -------------------------------------------------------------------- count */

function renderCount(value) {
  countEl.textContent = value > 999 ? '999+' : String(value || 0);
}

function readCount(tabId) {
  if (tabId === undefined) {
    renderCount(0);
    return;
  }
  chrome.storage.session.get({ [COUNTS_KEY]: {} }, (data) => {
    if (chrome.runtime.lastError) return;
    const counts = data[COUNTS_KEY] || {};
    renderCount(counts[tabId] || 0);
  });
}

let activeTabId;

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  activeTabId = tabs[0] && tabs[0].id;
  readCount(activeTabId);
});

/* ------------------------------------------------------- live updates while open */

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, ENABLED_KEY)) {
    renderToggle(changes[ENABLED_KEY].newValue);
  }
  if (area === 'session' && Object.prototype.hasOwnProperty.call(changes, COUNTS_KEY)) {
    readCount(activeTabId);
  }
});
