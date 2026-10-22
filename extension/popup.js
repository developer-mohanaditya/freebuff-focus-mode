/**
 * Freebuff Focus Mode - popup.
 *
 * The toggle writes to chrome.storage.sync; the content script listens for
 * chrome.storage.onChanged and applies it. The popup never talks to the page
 * directly, so it keeps working even if the tab is mid-navigation.
 */

const ENABLED_KEY = 'freebuffFocusEnabled';
const UNTIL_KEY = 'freebuffFocusUntil';
const DURATION_KEY = 'freebuffFocusMinutes';
const COUNTS_KEY = 'hiddenCounts';

// A session lasts this long unless one of the chips says otherwise. 0 means
// "until I switch it off", which is what the switch alone used to do.
const DEFAULT_MINUTES = 25;

// Read-only legacy names, kept only so a 1.6 setting survives the rename. See
// the same block in content.js: read once, copy, delete.
const LEGACY_ENABLED_KEY = 'freebuffAdBlockEnabled';
const LEGACY_CUSTOM_KEY = 'freebuffAdBlockSelectors';

// Kept in sync with SITE_ORIGIN in scripts/build.mjs.
const INSTALL_URL = 'https://freebuff-focusmode.vercel.app/';

const toggle = document.getElementById('toggle');
const stateText = document.getElementById('stateText');
const countEl = document.getElementById('count');
const installLink = document.getElementById('installLink');
const timerNote = document.getElementById('timerNote');
const chips = [...document.querySelectorAll('#chips .chip')];

installLink.href = INSTALL_URL;

/* ------------------------------------------------------------- focus + timer */

/** `mm:ss` - the popup is 300px wide, so minutes and seconds are all that fit. */
function remaining(until) {
  const left = Math.max(0, Number(until) - Date.now());
  const total = Math.ceil(left / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** The wall clock the session ends at, in the reader's own locale. */
function endsAt(until) {
  return new Date(Number(until)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

let deadline = null;
let ticking = null;

function renderToggle(enabled, until) {
  const numeric = Number(until);
  const timed = enabled && Number.isFinite(numeric) && numeric > 0;

  deadline = timed ? numeric : null;
  toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
  stateText.classList.toggle('on', enabled);

  if (!enabled) stateText.textContent = 'Ads showing';
  else if (timed) stateText.textContent = `Focusing - ${remaining(numeric)} left`;
  else stateText.textContent = 'Focusing';

  timerNote.classList.toggle('on', enabled);
  timerNote.textContent = !enabled
    ? 'Next session'
    : timed
      ? `Ends at ${endsAt(numeric)}`
      : 'Until you switch off';

  if (deadline) startTicking();
  else stopTicking();
}

/**
 * Tick the countdown while the popup is open. The deadline is still the only
 * authority: a session that runs out while this is on screen is closed by
 * writing the same two values the worker writes, so the popup and the tabs
 * agree even if the alarm has not landed yet.
 */
function startTicking() {
  if (ticking) return;
  ticking = setInterval(() => {
    if (!deadline) return stopTicking();
    if (deadline <= Date.now()) {
      stopTicking();
      renderToggle(false, null);
      renderStatus('Session over. Ads back on the next load', 'warn');
      chrome.storage.sync.set({ [ENABLED_KEY]: false, [UNTIL_KEY]: null });
      return;
    }
    stateText.textContent = `Focusing - ${remaining(deadline)} left`;
  }, 1000);
}

function stopTicking() {
  if (!ticking) return;
  clearInterval(ticking);
  ticking = null;
}

function renderChips(minutes) {
  for (const chip of chips) {
    chip.setAttribute(
      'aria-pressed',
      Number(chip.dataset.minutes) === Number(minutes) ? 'true' : 'false'
    );
  }
}

for (const chip of chips) {
  chip.addEventListener('click', () => {
    const minutes = Number(chip.dataset.minutes) || 0;
    renderChips(minutes);
    chrome.storage.sync.set({ [DURATION_KEY]: minutes });

    // Off: the chip only decides what the next session will be. On: it retimes
    // the running one, and "until off" drops the deadline without ending it.
    if (toggle.getAttribute('aria-checked') !== 'true') return;

    const until = minutes > 0 ? Date.now() + minutes * 60000 : null;
    chrome.storage.sync.set({ [UNTIL_KEY]: until }, () => renderToggle(true, until));
    renderStatus(
      until ? `Focusing until ${endsAt(until)}` : 'Focusing until you switch it off',
      'live'
    );
  });
}

/**
 * Move a 1.6 setting to its 1.7 name, once, then hand the merged state to the
 * caller. One read instead of two so the popup cannot paint half a migration.
 */
function readState(cb) {
  chrome.storage.sync.get(
    {
      [ENABLED_KEY]: null,
      [UNTIL_KEY]: null,
      [DURATION_KEY]: DEFAULT_MINUTES,
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
  const minutes = selectedMinutes();
  // Switching on starts a session of the chosen length; switching off ends it
  // and clears the deadline, so a leftover one cannot end a later session.
  const until = next && minutes > 0 ? Date.now() + minutes * 60000 : null;

  renderToggle(next, until);
  chrome.storage.sync.set({ [ENABLED_KEY]: next, [UNTIL_KEY]: until });

  // Anything already cancelled at the network layer stays cancelled until the
  // page is fetched again, so say that rather than implying a live switch.
  if (!next) {
    renderStatus('Focus off. Reload freebuff.com to bring ads back', 'warn');
    return;
  }
  renderStatus(
    until
      ? `Focusing until ${endsAt(until)}. Ads stay out from the next load`
      : 'Focusing. Ads stay out from the next load',
    'live'
  );
});

/** The chip the reader picked last, defaulting to a plain 25 minutes. */
function selectedMinutes() {
  const pressed = chips.find((chip) => chip.getAttribute('aria-pressed') === 'true');
  return pressed ? Number(pressed.dataset.minutes) || 0 : DEFAULT_MINUTES;
}

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
  const minutes = Number.isFinite(Number(state[DURATION_KEY]))
    ? Number(state[DURATION_KEY])
    : DEFAULT_MINUTES;

  renderChips(minutes);
  renderToggle(
    typeof state[ENABLED_KEY] === 'boolean' ? state[ENABLED_KEY] : false,
    state[UNTIL_KEY]
  );
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

/* --------------------------------------------------------- keyboard shortcut */

const PICK_COMMAND = 'start-picking';
const pickKeyEl = document.getElementById('pickKey');
const MAC_KEYS = { Alt: '⌥', Shift: '⇧', Ctrl: '⌃', Command: '⌘' };

/**
 * Show the key the command is currently bound to.
 *
 * Chrome stores "Alt+Shift+F" and names keys the same way on every platform, so
 * the Mac spelling is ours to add: Option is Alt there, and nobody looks for a
 * key labelled "Alt" on a Mac keyboard. A shortcut the reader removed at
 * chrome://extensions/shortcuts comes back empty and the hint hides itself -
 * the button still picks.
 */
function renderShortcut(shortcut) {
  if (!pickKeyEl) return;

  const parts = String(shortcut || '').split('+').filter(Boolean);
  if (!parts.length) {
    pickKeyEl.hidden = true;
    return;
  }

  const mac = /Mac OS X|Macintosh/i.test(navigator.userAgent);
  pickKeyEl.textContent = mac
    ? parts.map((part) => MAC_KEYS[part] || part).join('')
    : parts.join('+');
  pickKeyEl.hidden = false;
  pickButton.title = `Hide an element in focus (${pickKeyEl.textContent})`;
}

if (chrome.commands && chrome.commands.getAll) {
  chrome.commands.getAll((commands) => {
    const command = (commands || []).find((entry) => entry.name === PICK_COMMAND);
    renderShortcut(command && command.shortcut);
  });
}

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

const has = (changes, key) => Object.prototype.hasOwnProperty.call(changes, key);

chrome.storage.onChanged.addListener((changes, area) => {
  // One render for both timer keys: the worker writes `enabled` and the
  // deadline together when a session ends, so painting them separately would
  // flicker through a state that never existed.
  if (area === 'sync' && (has(changes, ENABLED_KEY) || has(changes, UNTIL_KEY))) {
    const enabled = has(changes, ENABLED_KEY)
      ? !!changes[ENABLED_KEY].newValue
      : toggle.getAttribute('aria-checked') === 'true';
    const until = has(changes, UNTIL_KEY) ? changes[UNTIL_KEY].newValue : deadline;
    renderToggle(enabled, until);
  }
  if (area === 'sync' && has(changes, DURATION_KEY)) {
    renderChips(changes[DURATION_KEY].newValue);
  }
  if (area === 'sync' && has(changes, CUSTOM_KEY)) {
    renderCustom(changes[CUSTOM_KEY].newValue);
  }
  if (area === 'session' && has(changes, COUNTS_KEY)) {
    readCount(activeTabId);
  }
});
