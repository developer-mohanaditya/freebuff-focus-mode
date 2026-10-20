/**
 * Freebuff Focus Mode - popup.
 *
 * The toggle writes to chrome.storage.sync; the content script listens for
 * chrome.storage.onChanged and applies it. The popup never talks to the page
 * directly, so it keeps working even if the tab is mid-navigation.
 */

const ENABLED_KEY = 'freebuffFocusEnabled';
const COUNTS_KEY = 'hiddenCounts';

// Read-only legacy names, kept only so a 1.6 setting survives the rename. See
// the same block in content.js: read once, copy, delete.
const LEGACY_ENABLED_KEY = 'freebuffAdBlockEnabled';
const LEGACY_CUSTOM_KEY = 'freebuffAdBlockSelectors';

// Kept in sync with SITE_ORIGIN in scripts/build.mjs.
const INSTALL_URL = 'https://freebuff-focus-mode.vercel.app/';

const toggle = document.getElementById('toggle');
const stateText = document.getElementById('stateText');
const countEl = document.getElementById('count');
const installLink = document.getElementById('installLink');

installLink.href = INSTALL_URL;

/* ------------------------------------------------------------------- toggle */

function renderToggle(enabled) {
  toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
  stateText.textContent = enabled ? 'Focusing' : 'Ads showing';
  stateText.classList.toggle('on', enabled);
}

/**
 * Move a 1.6 setting to its 1.7 name, once, then hand the merged state to the
 * caller. One read instead of two so the popup cannot paint half a migration.
 */
function readState(cb) {
  chrome.storage.sync.get(
    {
      [ENABLED_KEY]: null,
      [CUSTOM_KEY]: null,
      [LEGACY_ENABLED_KEY]: null,
      [LEGACY_CUSTOM_KEY]: null,
    },
    (value) => {
      if (chrome.runtime.lastError) return;

      const next = {};
      if (typeof value[ENABLED_KEY] !== 'boolean' && typeof value[LEGACY_ENABLED_KEY] === 'boolean') {
        next[ENABLED_KEY] = value[LEGACY_ENABLED_KEY];
      }
      if (!Array.isArray(value[CUSTOM_KEY]) && Array.isArray(value[LEGACY_CUSTOM_KEY])) {
        next[CUSTOM_KEY] = value[LEGACY_CUSTOM_KEY];
      }
      if (Object.keys(next).length > 0) {
        chrome.storage.sync.set(next);
        if (chrome.storage.sync.remove) chrome.storage.sync.remove([LEGACY_ENABLED_KEY, LEGACY_CUSTOM_KEY]);
      }

      cb({ ...value, ...next });
    }
  );
}

toggle.addEventListener('click', () => {
  const next = toggle.getAttribute('aria-checked') !== 'true';
  renderToggle(next);
  chrome.storage.sync.set({ [ENABLED_KEY]: next });
  // Anything already cancelled at the network layer stays cancelled until the
  // page is fetched again, so say that rather than implying a live switch.
  renderStatus(
    next
      ? 'Focusing. Ads stay out from the next load'
      : 'Focus off. Reload freebuff.com to bring ads back',
    next ? 'live' : 'warn'
  );
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

const PICK_TYPE = 'freebuff-focus:pick';
const CUSTOM_KEY = 'freebuffFocusSelectors';

const pickButton = document.getElementById('pick');
const customCountEl = document.getElementById('customCount');
const clearButton = document.getElementById('clearCustom');

function renderCustom(list) {
  const count = Array.isArray(list) ? list.length : 0;
  customCountEl.textContent =
    count === 0 ? 'No custom rules' : `${count} custom rule${count === 1 ? '' : 's'}`;
  clearButton.hidden = count === 0;
}

readState((state) => {
  renderToggle(typeof state[ENABLED_KEY] === 'boolean' ? state[ENABLED_KEY] : false);
  renderCustom(state[CUSTOM_KEY]);

  const version = chrome.runtime.getManifest().version;
  const badge = document.getElementById('version');
  if (badge) badge.textContent = `v${version}`;
});

pickButton.addEventListener('click', () => {
  if (activeTabId === undefined) {
    renderStatus('Open freebuff.com to quiet an element', 'warn');
    return;
  }

  chrome.tabs.sendMessage(activeTabId, { type: PICK_TYPE }, () => {
    if (chrome.runtime.lastError) {
      renderStatus('Not running here, reload this tab', 'warn');
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
const PING_TYPE = 'freebuff-focus:ping';
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
    renderStatus('Open freebuff.com to start focus', 'warn');
    return;
  }

  if (!SITE_URL.test(tab.url || '')) {
    renderStatus('Not a freebuff.com tab, nothing to quiet here', 'warn');
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: PING_TYPE }, (response) => {
    if (chrome.runtime.lastError || !response || !response.ok) {
      renderStatus('Not running here, reload this tab', 'warn');
      return;
    }
    renderStatus(
      response.enabled ? `Focusing on this tab (v${response.version})` : 'Ads showing on this tab',
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
