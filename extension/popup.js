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
const INSTALL_URL = 'https://freebuff-adblocker.vercel.app/';

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

/* -------------------------------------------------------- user-picked rules */

const PICK_TYPE = 'freebuff-adblock:pick';
const CUSTOM_KEY = 'freebuffAdBlockSelectors';

const pickButton = document.getElementById('pick');
const customCountEl = document.getElementById('customCount');
const clearButton = document.getElementById('clearCustom');

function renderCustom(list) {
  const count = Array.isArray(list) ? list.length : 0;
  customCountEl.textContent =
    count === 0 ? 'No custom rules' : `${count} custom rule${count === 1 ? '' : 's'}`;
  clearButton.hidden = count === 0;
}

chrome.storage.sync.get({ [CUSTOM_KEY]: [] }, (value) => {
  if (chrome.runtime.lastError) return;
  renderCustom(value[CUSTOM_KEY]);
});

pickButton.addEventListener('click', () => {
  if (activeTabId === undefined) {
    renderStatus('Open freebuff.com to pick an element', 'warn');
    return;
  }

  chrome.tabs.sendMessage(activeTabId, { type: PICK_TYPE }, () => {
    if (chrome.runtime.lastError) {
      renderStatus('Not running here - reload this tab', 'warn');
      return;
    }
    // Get out of the way so the page is clickable.
    window.close();
  });
});

clearButton.addEventListener('click', () => {
  chrome.storage.sync.set({ [CUSTOM_KEY]: [] }, () => renderCustom([]));
});

/* ------------------------------------------------------------------- status */

const statusEl = document.getElementById('statusText');
const PING_TYPE = 'freebuff-adblock:ping';
const SITE_URL = /^https?:\/\/([a-z0-9-]+\.)*freebuff\.com(\/|$)/i;

function renderStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = kind ? `status ${kind}` : 'status';
}

/**
 * Ask the content script in this tab whether it is alive. A missing reply is
 * the one failure you cannot otherwise see: the extension is installed, but the
 * page was loaded before it, so nothing was ever scanned.
 */
function checkTab(tab) {
  if (!tab || tab.id === undefined) {
    renderStatus('Open freebuff.com to start blocking', 'warn');
    return;
  }

  if (!SITE_URL.test(tab.url || '')) {
    renderStatus('Not a freebuff.com tab — nothing to do here', 'warn');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: PING_TYPE }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      renderStatus('Not running here — reload this tab', 'warn');
      return;
    }
    renderStatus(
      response.enabled ? `Active on this tab (v${response.version})` : 'Paused on this tab',
      response.enabled ? 'live' : 'warn'
    );
  });
}

let activeTabId;

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  activeTabId = tab && tab.id;
  readCount(activeTabId);
  checkTab(tab);
});

/* ------------------------------------------------------- live updates while open */

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, ENABLED_KEY)) {
    renderToggle(changes[ENABLED_KEY].newValue);
  }
  if (area === 'sync' && Object.prototype.hasOwnProperty.call(changes, CUSTOM_KEY)) {
    renderCustom(changes[CUSTOM_KEY].newValue);
  }
  if (area === 'session' && Object.prototype.hasOwnProperty.call(changes, COUNTS_KEY)) {
    readCount(activeTabId);
  }
});
