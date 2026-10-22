/**
 * Freebuff Focus Mode - MV3 service worker.
 *
 * Deliberately minimal. MV3 workers are ephemeral: anything this file needs to
 * remember must live in chrome.storage, never in a module-level variable,
 * because the worker can be torn down between messages.
 *
 * Responsibilities:
 *   - turn network blocking on and off with the focus setting,
 *   - end a timed session at its deadline, and
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
const UNTIL_KEY = 'freebuffFocusUntil';
const EXPIRY_ALARM = 'freebuff-focus:expiry';
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
  // 1.6 install that was focusing when it updated. A deadline that passed
  // while the browser was closed is settled here too.
  reconcile();
});

chrome.runtime.onStartup.addListener(() => {
  resetCounts();
  reconcile();
});

const has = (changes, key) => Object.prototype.hasOwnProperty.call(changes, key);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const touchesFocus =
    has(changes, ENABLED_KEY) || has(changes, UNTIL_KEY);
  if (!touchesFocus) return;
  // One read for both keys, so the ruleset and the alarm can never be decided
  // from two different versions of the setting.
  reconcile();
});

/* --------------------------------------------------------------------- timer */

/**
 * Bring the ruleset and the expiry alarm in line with what is stored.
 *
 * The deadline is the authority, not the alarm: an alarm is only a wake-up
 * call, and this worker can be torn down between messages, miss a beat while
 * the machine sleeps, or start a session on a browser that was closed at the
 * deadline. So every entry point that matters reads the two stored values and
 * settles them, and a deadline in the past ends the session right here rather
 * than waiting for something to fire.
 */
function reconcile() {
  chrome.storage.sync.get({ [ENABLED_KEY]: false, [UNTIL_KEY]: null }, (value) => {
    if (chrome.runtime.lastError) return;

    const enabled = !!value[ENABLED_KEY];
    const until = Number(value[UNTIL_KEY]);

    applyRuleset(enabled);

    // No deadline means an untimed session: `enabled` alone decides, exactly
    // as it did before timed focus existed, so a 1.8 setting keeps working.
    if (!enabled || !Number.isFinite(until) || until <= 0) {
      scheduleExpiry(null);
      return;
    }

    if (until <= Date.now()) {
      endSession();
      return;
    }

    scheduleExpiry(until);
  });
}

/** Arm the one alarm, or take it away when there is nothing to wait for. */
function scheduleExpiry(until) {
  chrome.alarms.clear(EXPIRY_ALARM, () => {
    if (!Number.isFinite(until) || until <= 0) return;
    chrome.alarms.create(EXPIRY_ALARM, { when: until });
  });
}

/**
 * End the session: ads back, no deadline left behind.
 *
 * Writing the setting (rather than flipping a variable) is what makes the
 * content script in every open tab restore itself - it already listens for
 * this key - and it means the end survives the worker being killed the moment
 * after it runs.
 */
function endSession() {
  chrome.storage.sync.set({ [ENABLED_KEY]: false, [UNTIL_KEY]: null }, () => {
    applyRuleset(false);
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== EXPIRY_ALARM) return;

  chrome.storage.sync.get({ [ENABLED_KEY]: false, [UNTIL_KEY]: null }, (value) => {
    if (chrome.runtime.lastError) return;

    const enabled = !!value[ENABLED_KEY];
    const until = Number(value[UNTIL_KEY]);

    if (!enabled || !Number.isFinite(until) || until <= 0) return;

    // Chrome can deliver an alarm slightly early after the machine wakes, and
    // the system clock can move backwards. Anything still in the future is
    // re-armed rather than ending a session before its deadline.
    if (until > Date.now()) {
      scheduleExpiry(until);
      return;
    }

    endSession();
  });
});

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
