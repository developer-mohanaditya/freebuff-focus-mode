/**
 * Content-script checks: does it hide the ads, and does it leave everything
 * else standing?
 *
 * Loads extension/content.js into a jsdom page shaped like the Freebuff app -
 * a message with a code block, an in-product "AD" promo card, the skill chips
 * under it, a composer and a second promo banner above it - then asserts what
 * was hidden and what was not. The negative cases matter more than the positive
 * ones: a false positive here means someone's actual work disappears.
 *
 * jsdom is deliberately not a project dependency, so this skips itself when it
 * is absent. To run the checks:  npm install --no-save jsdom && npm test
 */

import fs from 'node:fs';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('jsdom is not installed - skipping content-script checks.');
  console.log('  npm install --no-save jsdom  &&  npm test');
  process.exit(0);
}

const CODE = fs.readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');

/** The real manifest, so no test double carries a version of its own. */
const MANIFEST = JSON.parse(
  fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8')
);

const html = `<!doctype html><html><head></head><body>
  <div id="app">
    <aside class="sidebar">
      <a href="/">Home</a><a href="/chat">New chat</a><a href="/daily">Daily</a><a href="/wallet">Wallet</a>
    </aside>
    <main>
      <div class="thread" role="log">
        <article class="msg" id="assistant">
          <p>Replied in 33s</p>
          <pre><code>git add -A
git commit -m "Add Freebuff Focus Mode"</code></pre>
        </article>
        <div class="promo" id="card">
          <div class="promo-head"><span class="brand">Coderabbit</span><span class="ad-chip">AD</span></div>
          <p class="promo-copy">The agent that wrote it should not be the only thing checking it. Verify your code before pushing with CodeRabbit's independent review of uncommitted changes and PRs.</p>
          <a class="cta" href="https://coderabbit.ai/" target="_blank">Start Free</a>
        </div>
        <div class="skills-row" id="skills">
          <button>Review changes</button><button>Run tests</button><button>Explain project</button>
        </div>
        <article class="msg" id="linkmsg">
          <p>Docs live at <a href="https://example.com/docs">example.com</a></p>
        </article>
        <div class="preseed" id="preseed">Saved rule target</div>
      </div>
      <div class="composer" id="composer">
        <div class="promo banner" id="banner">
          <span class="logo"></span><span class="brand">Baseten</span><span class="ad-chip">AD</span>
          <span class="copy">Scale your projects with Baseten Model APIs, offering instant, OpenAI-compatible inference.</span>
          <a class="cta" href="https://baseten.co/" target="_blank">Get API Access</a>
        </div>
        <textarea placeholder="Type a message"></textarea>
      </div>
    </main>
  </div>
</body></html>`;

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://freebuff.com/',
});

const { window } = dom;
const { document } = window;

// Minimal chrome.* surface. State lives in this object so a saved rule can be
// seeded before the script runs, and so the tests can read back whatever the
// picker stored. Message listeners are captured so the picker can be triggered.
const store = { freebuffFocusEnabled: true, freebuffFocusSelectors: ['.preseed'] };
const messageListeners = [];

const sendMessage = (type) => messageListeners.forEach((fn) => fn({ type }, {}, () => {}));

window.chrome = {
  runtime: {
    lastError: null,
    getManifest: () => ({ version: MANIFEST.version }),
    sendMessage: () => undefined,
    onMessage: { addListener: (fn) => messageListeners.push(fn) },
  },
  storage: {
    sync: {
      get: (defaults, cb) => {
        const out = { ...defaults };
        for (const key of Object.keys(defaults)) {
          if (key in store) out[key] = store[key];
        }
        cb(out);
      },
      set: (values) => Object.assign(store, values),
    },
    session: { get: (defaults, cb) => cb(defaults), set() {} },
    onChanged: { addListener() {} },
  },
};

const script = document.createElement('script');
script.textContent = CODE;
document.body.appendChild(script);

const HIDDEN = 'fb-focus-hidden';
const results = [];
const hidden = (id) => document.getElementById(id).classList.contains(HIDDEN);
const check = (name, actual, expected) => {
  const ok = actual === expected;
  results.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${actual ? 'hidden' : 'visible'} (want ${expected ? 'hidden' : 'visible'})`);
};

console.log('\ninitial sweep');
check('in-product promo card (Coderabbit AD)', hidden('card'), true);
check('composer banner (Baseten AD)', hidden('banner'), true);
check('assistant message with code block', hidden('assistant'), false);
check('skills chip row', hidden('skills'), false);
check('composer', hidden('composer'), false);
check('short message with an external link', hidden('linkmsg'), false);

// The real case: React inserts the card mid-session, badge text included.
console.log('\nmid-session insert (childList path)');
const late = document.createElement('div');
late.className = 'promo';
late.id = 'late';
late.innerHTML =
  '<div class="promo-head"><span>Coderabbit</span><span class="ad-chip">AD</span></div>' +
  "<p>Verify your code before pushing with CodeRabbit's independent review.</p>" +
  '<a href="https://coderabbit.ai/" target="_blank">Start Free</a>';
document.querySelector('.thread').appendChild(late);

// And the variant where the badge text lands after the markup does.
const textLate = document.createElement('div');
textLate.className = 'promo';
textLate.id = 'textlate';
textLate.innerHTML =
  '<div class="promo-head"><span>Baseten</span><span class="ad-chip"></span></div>' +
  '<p>Scale your projects with Baseten Model APIs.</p>' +
  '<a href="https://baseten.co/" target="_blank">Get API Access</a>';
document.querySelector('.thread').appendChild(textLate);

await new Promise((r) => setTimeout(r, 60));
textLate.querySelector('.ad-chip').textContent = 'AD';
await new Promise((r) => setTimeout(r, 80));

check('card inserted after load', hidden('late'), true);
check('card whose badge text arrived later (characterData path)', hidden('textlate'), true);
check('assistant message still visible', hidden('assistant'), false);
check('skills chip row still visible', hidden('skills'), false);

// Sending another prompt makes these cards rebuild their contents in place.
// That must not lift the hide.
console.log('\nre-render resilience');
const refreshed = document.createElement('p');
refreshed.textContent = 'A fresh impression, rebuilt in place.';
document.getElementById('card').appendChild(refreshed);
await new Promise((r) => setTimeout(r, 60));
check('card that rebuilt its own contents stays hidden', hidden('card'), true);
check('card is still display-blocked by the stylesheet', !!document.getElementById('freebuff-focus-style'), true);

// A framework re-render can rewrite className, taking the hidden class with it.
document.getElementById('card').classList.remove(HIDDEN);
await new Promise((r) => setTimeout(r, 60));
check('card stripped of the hidden class is re-hidden', hidden('card'), true);

// If the page replaces its head, the stylesheet doing the hiding is gone and
// every hide already made is inert.
document.getElementById('freebuff-focus-style').remove();
const poke = document.createElement('div');
poke.textContent = 'poke';
document.querySelector('.thread').appendChild(poke);
await new Promise((r) => setTimeout(r, 60));
check('stylesheet is re-injected after being removed', !!document.getElementById('freebuff-focus-style'), true);

// The strip in the preview toolbar: a badge with no anchor, sharing a row with
// the address field and the navigation buttons.
console.log('\npromo strip sharing a toolbar row');
const bar = document.createElement('div');
bar.className = 'preview-toolbar';
bar.id = 'bar';
bar.innerHTML =
  '<button>back</button><button>forward</button><button>reload</button>' +
  '<input id="addr" value="https://example.com/">' +
  '<div class="promo strip" id="strip">' +
  '<span class="logo"></span><span class="brand">Baseten</span><span class="ad-chip">AD</span>' +
  '<span class="copy">Deploy mission-critical AI inference on dedicated deployments with Baseten.</span>' +
  '</div>' +
  '<button id="stop">stop</button>';
document.querySelector('.thread').appendChild(bar);
await new Promise((r) => setTimeout(r, 60));
check('promo strip with no anchor is hidden', hidden('strip'), true);
check('toolbar row that holds it stays visible', hidden('bar'), false);
check('address field stays visible', hidden('addr'), false);
check('stop button stays visible', hidden('stop'), false);

// The real markup, copied from the live page: an ad-network slot inside the
// preview toolbar. Worth noting what it does NOT contain - no "AD" chip and no
// ad-shaped class. Its only honest signals are the data attribute, the
// sponsored rel and the tracking href.
console.log('\nreal ad-network slot (copied from the live page)');
const gravityBar = document.createElement('div');
gravityBar.id = 'gravity-bar';
gravityBar.innerHTML =
  '<input id="gravity-addr" value="https://freebuff.com/">' +
  '<a id="gravity-ad" href="https://api.trygravity.ai/track/click?p=abc123" target="_blank" rel="noopener noreferrer sponsored" data-gravity-ad="true" class="group flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 no-underline" data-state="closed">' +
  '<img alt="" loading="lazy" class="h-4 w-4 shrink-0 rounded-sm object-contain" src="https://icons.duckduckgo.com/ip3/www.baseten.co.ico">' +
  '<span class="shrink-0 text-[11px] font-semibold">Baseten</span>' +
  '<span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px]">Deploy mission-critical AI inference on dedicated deployments with Baseten 99.99% uptime and SOC 2</span>' +
  '</a>' +
  '<button id="gravity-stop">stop</button>';
document.querySelector('.thread').appendChild(gravityBar);
await new Promise((r) => setTimeout(r, 60));
check('ad-network slot is hidden', hidden('gravity-ad'), true);
check('row holding the slot stays visible', hidden('gravity-bar'), false);
check('address field beside the slot stays visible', hidden('gravity-addr'), false);
check('stop button beside the slot stays visible', hidden('gravity-stop'), false);

// Each hook has to stand on its own, because the network does not always ship
// all three on every placement.
const relOnly = document.createElement('a');
relOnly.id = 'rel-only';
relOnly.setAttribute('rel', 'noopener sponsored');
relOnly.setAttribute('href', 'https://example.com/partner');
relOnly.textContent = 'A sponsored placement';
document.querySelector('.thread').appendChild(relOnly);

const hrefOnly = document.createElement('a');
hrefOnly.id = 'href-only';
hrefOnly.setAttribute('href', 'https://api.trygravity.ai/track/click?p=xyz');
hrefOnly.textContent = 'Baseten: deploy inference';
document.querySelector('.thread').appendChild(hrefOnly);

const dataOnly = document.createElement('div');
dataOnly.id = 'data-only';
dataOnly.setAttribute('data-gravity-ad', 'true');
dataOnly.textContent = 'Promoted slot with no link at all';
document.querySelector('.thread').appendChild(dataOnly);

await new Promise((r) => setTimeout(r, 60));
check('rel=sponsored alone is enough', hidden('rel-only'), true);
check('tracking href alone is enough', hidden('href-only'), true);
check('data-gravity-ad alone is enough', hidden('data-only'), true);
check('messages around them stay visible', hidden('assistant'), false);

// The shape that was still wrong: the ad is the only child of a full-width
// wrapper, and the wrapper is one item of the preview toolbar beside the back
// button and the stop button. Hiding the wrapper took the whole slot out of
// the row, so the controls next to it slid to the left. The strip keeps its
// place now - the stylesheet empties it where it stands.
console.log('\npreview strip: ad is the only child of a row item');
const stripRow = document.createElement('div');
stripRow.id = 'strip-row';
stripRow.className = 'preview-toolbar';
stripRow.style.display = 'flex';
stripRow.innerHTML =
  '<button id="strip-back">back</button>' +
  '<div id="strip-slot" class="flex w-full min-w-0 items-center" style="display: flex;">' +
  '<a id="strip-ad" href="https://api.trygravity.ai/track/click?p=abc123" target="_blank" rel="noopener noreferrer sponsored" data-gravity-ad="true" class="group flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 no-underline" data-state="closed">' +
  '<img alt="" loading="lazy" class="h-4 w-4 shrink-0 rounded-sm object-contain" src="https://icons.duckduckgo.com/ip3/www.baseten.co.ico">' +
  '<span class="shrink-0 text-[11px] font-semibold text-foreground/80">Baseten</span>' +
  '<span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted-foreground">Deploy mission-critical AI inference on dedicated cloud or VPC deployments with Baseten.</span>' +
  '</a></div>' +
  '<button id="strip-stop">stop</button>';
document.querySelector('.thread').appendChild(stripRow);
await new Promise((r) => setTimeout(r, 60));
check('wrapper holding only the strip stays in the flow', hidden('strip-slot'), false);
check('toolbar row keeps its shape', hidden('strip-row'), false);
check('control before the strip stays put', hidden('strip-back'), false);
check('control after the strip stays put', hidden('strip-stop'), false);
check('strip is not taken out of the flow', hidden('strip-ad'), false);
check('strip keeps its contents in the DOM', document.getElementById('strip-ad').children.length, 3);
check(
  'stylesheet empties such a strip in place',
  /pointer-events: none !important/.test(
    document.getElementById('freebuff-focus-style').textContent
  ),
  true
);

// Only a strip gets to keep its slot. A card that happens to sit in a row is
// still removed for good, wrapper included - the block-level content inside it
// is what rules the in-place treatment out.
console.log('\npreview strip: a card in the same spot is still removed');
const rowCard = document.createElement('div');
rowCard.id = 'row-card-row';
rowCard.style.display = 'flex';
rowCard.innerHTML =
  '<div id="row-card-slot">' +
  '<a id="row-card-ad" href="https://api.trygravity.ai/track/click?p=abc123" rel="noopener noreferrer sponsored" data-gravity-ad="true" style="display: flex; flex-direction: column;">' +
  '<div><span>Coderabbit</span><span id="row-card-chip">Ad</span></div>' +
  '<p>More code should not mean less review.</p></a></div>' +
  '<button id="row-card-stop">stop</button>';
document.querySelector('.thread').appendChild(rowCard);
await new Promise((r) => setTimeout(r, 60));
check('card-shaped ad in a row is hidden outright', hidden('row-card-ad'), true);
check('the wrapper it filled goes with it', hidden('row-card-slot'), true);
check('the row itself stays visible', hidden('row-card-row'), false);
check('control beside the removed card stays visible', hidden('row-card-stop'), false);

// A saved rule has to be honoured on load, and has to survive the card rebuild
// that used to tear hides down.
console.log('\nsaved rules and unseen slot names');
check('saved rule is applied on load', hidden('preseed'), true);

const intoSaved = document.createElement('p');
intoSaved.textContent = 'Content rendered into an element a rule hid';
document.getElementById('preseed').appendChild(intoSaved);
await new Promise((r) => setTimeout(r, 40));
check('a rule-hidden element stays hidden when content lands in it', hidden('preseed'), true);

// A slot name the network has not used yet. Not in the selector list, caught by
// the attribute-name scan instead.
const variant = document.createElement('div');
variant.id = 'gravity-variant';
variant.setAttribute('data-gravity-ad-banner', 'left-rail');
variant.textContent = 'A slot name we had never seen';
document.querySelector('.thread').appendChild(variant);
await new Promise((r) => setTimeout(r, 40));
check('unseen data-gravity-ad-* slot name is caught', hidden('gravity-variant'), true);

// The reported false positive, from the live page: a thread ad whose "Ad" chip
// sits inside the same .turn as the response's own working UI. The card search
// used to climb out of the ad and hide the whole turn - reasoning toggle and
// progress meter included - and the ad's badge then stopped the rescue from
// putting it back. The real shape: <a data-gravity-ad> holding the chip, with
// the reasoning toggle and the progress meter mounted into the same turn below.
console.log('\nturn sharing the ad with the response UI');
const turn = document.createElement('div');
turn.className = 'turn';
turn.id = 'turn';
turn.innerHTML =
  '<div class="msg user" id="turn-user">' +
  '<div class="bubble user-message-bubble"><div class="user-message-text">Ship it</div></div>' +
  '<div class="msg-footer"><span class="msg-time">10:49 PM</span>' +
  '<button type="button" class="icon-button quiet control-small" aria-label="Restore to here" aria-haspopup="dialog" data-state="closed">undo</button>' +
  '</div></div>' +
  '<div class="my-8 w-full max-w-full text-sm" id="turn-adwrap">' +
  '<a id="turn-ad" href="https://api.trygravity.ai/track/click?p=abc123" target="_blank" rel="noopener noreferrer sponsored" class="w-full" data-gravity-ad="true">' +
  '<div style="display: flex; gap: 8px;">' +
  '<img alt="" src="https://icons.duckduckgo.com/ip3/www.coderabbit.ai.ico">' +
  '<span>Coderabbit</span><span id="turn-adchip">Ad</span>' +
  '</div>' +
  '<p>More code should not mean less review.</p>' +
  '</a></div>';
document.querySelector('.thread').appendChild(turn);
await new Promise((r) => setTimeout(r, 60));

check('ad card inside the turn is hidden', hidden('turn-ad'), true);
check('turn holding the ad stays visible while the ad is alone', hidden('turn'), false);

// The response parts mount into the same turn a moment after the ad.
const turnAssistant = document.createElement('div');
turnAssistant.className = 'msg assistant cloud-parts';
turnAssistant.id = 'turn-assistant';
turnAssistant.innerHTML =
  '<div><div data-state="closed"><button type="button" class="acts-toggle live" id="turn-reasoning">Reasoning</button></div></div>';
turn.appendChild(turnAssistant);

const turnProgress = document.createElement('div');
turnProgress.className = 'min-h-[2.75rem]';
turnProgress.id = 'turn-progress';
turnProgress.innerHTML =
  '<div class="my-2 w-full max-w-lg"><div class="flex items-center gap-3">' +
  '<span class="truncate" id="turn-status"><span class="fb-text-body-sm shim-text">Thinking</span>' +
  '<span class="mx-1.5 text-content-disabled">·</span><span class="text-content-muted">reasoning is streaming above</span></span>' +
  '<span class="fb-text-mono shrink-0 text-[11px] tabular-nums text-content-subtle">55s</span>' +
  '<div class="fb-meter fb-meter--a2 mt-2" id="turn-meter" role="progressbar" aria-label="Estimated run progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="34"><i style="width: 34%;"></i></div>' +
  '</div></div>';
turn.appendChild(turnProgress);
await new Promise((r) => setTimeout(r, 80));

check('the turn itself stays visible', hidden('turn'), false);
check('the ad card is still hidden', hidden('turn-ad'), true);
check('the reasoning toggle stays visible', hidden('turn-reasoning'), false);
check('the progress meter stays visible', hidden('turn-meter'), false);
check('the status line stays visible', hidden('turn-status'), false);

// The same shape, but the ad lands before anything else mounts, so the wrapper
// really is collapsed with it. Live UI arriving inside has to bring it back.
const early = document.createElement('div');
early.className = 'turn';
early.id = 'turn-early';
early.innerHTML =
  '<div class="my-8 w-full max-w-full text-sm" id="early-adwrap">' +
  '<a id="early-ad" href="https://api.trygravity.ai/track/click?p=abc123" rel="noopener noreferrer sponsored" data-gravity-ad="true">' +
  '<span>Coderabbit</span><span>Ad</span></a></div>';
document.querySelector('.thread').appendChild(early);
await new Promise((r) => setTimeout(r, 60));
check('turn holding only the ad is collapsed with it', hidden('turn-early'), true);

const earlyProgress = document.createElement('div');
earlyProgress.id = 'early-progress';
earlyProgress.innerHTML =
  '<span>Thinking</span><div role="progressbar" aria-label="Estimated run progress" aria-valuenow="12"><i></i></div>';
early.appendChild(earlyProgress);
await new Promise((r) => setTimeout(r, 80));
check('turn is restored once live UI mounts inside it', hidden('turn-early'), false);
check('the ad itself stays hidden after the restore', hidden('early-ad'), true);

// The escape hatch: an ad shape nothing recognises, hidden by hand.
console.log('\npicker');
// Named deliberately free of any ad-ish token: nothing here should be caught by
// a hook, a token or a badge, which is the whole point of the picker.
const mystery = document.createElement('div');
mystery.id = 'mystery-unit';
mystery.className = 'promo-teaser';
mystery.textContent = 'A format from a network we have never seen';
document.querySelector('.thread').appendChild(mystery);
await new Promise((r) => setTimeout(r, 40));
check('unrecognised element is visible before picking', hidden('mystery-unit'), false);

sendMessage('freebuff-focus:pick');
check('picker bar appears', !!document.getElementById('freebuff-focus-picker'), true);

mystery.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 40));
check('picked element is hidden', hidden('mystery-unit'), true);
check('the rule was saved', store.freebuffFocusSelectors.includes('#mystery-unit'), true);
check('picker bar is gone after picking', !!document.getElementById('freebuff-focus-picker'), false);

// Esc has to back out cleanly, leaving the page exactly as it was.
sendMessage('freebuff-focus:pick');
const other = document.createElement('div');
other.id = 'other-unit';
other.textContent = 'Another unrecognised unit';
document.querySelector('.thread').appendChild(other);
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
other.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 40));
check('Esc cancels without hiding anything', hidden('other-unit'), false);
check('picker bar is gone after Esc', !!document.getElementById('freebuff-focus-picker'), false);
check('messages still visible after picking', hidden('assistant'), false);

// A structural element is refused once, then accepted on a second click. The
// guard has to stay loud enough to stop an accident and quiet enough not to
// overrule a person who really does want the wrapper gone.
console.log('\npicker override for page structure');
const shell = document.querySelector('main');
const barText = () => (document.getElementById('freebuff-focus-picker') || {}).textContent || '';

sendMessage('freebuff-focus:pick');
const refused = new window.MouseEvent('click', { bubbles: true, cancelable: true });
shell.dispatchEvent(refused);
await new Promise((r) => setTimeout(r, 40));
check('the first click on page structure hides nothing', hidden('assistant') || shell.classList.contains(HIDDEN), false);
check('and says how to override it', /click it again/i.test(barText()), true);
check('the picker stays open after the refusal', !!document.getElementById('freebuff-focus-picker'), true);

shell.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 40));
check('the second click hides it', shell.classList.contains(HIDDEN), true);
const pickedRule = store.freebuffFocusSelectors[store.freebuffFocusSelectors.length - 1];
check('and the rule is saved for next time', !!pickedRule && shell.matches(pickedRule), true);
console.log(`        saved as: ${pickedRule}`);

// Esc has to clear the pending offer too, or a click minutes later would be
// treated as consent for something the reader has forgotten about.
sendMessage('freebuff-focus:pick');
const navish = document.createElement('header');
navish.id = 'later-header';
document.body.appendChild(navish);
navish.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
sendMessage('freebuff-focus:pick');
navish.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 40));
check('a refused click does not survive Esc and cancel the next one', navish.classList.contains(HIDDEN), false);
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

// The document itself stays out of reach however often it is clicked.
sendMessage('freebuff-focus:pick');
const rootEl = document.documentElement;
rootEl.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
rootEl.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 40));
check('html is never hidden', rootEl.classList.contains(HIDDEN), false);
check('and says so instead', /document itself/i.test(barText()), true);
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

/* --------------------------------------------------------- 1.6 migration */

/**
 * The rename is only safe if a 1.6 install keeps its choice. This is a second
 * page with a second chrome mock, because migration happens once at load: the
 * store starts under the old names, and what it looks like afterwards is the
 * whole assertion.
 */
console.log('\nmigrating a 1.6 install');

const legacyStore = { freebuffAdBlockEnabled: false, freebuffAdBlockSelectors: ['.preseed'] };
const removedKeys = [];
const legacyDom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://freebuff.com/',
});
const legacyWindow = legacyDom.window;
const legacyDocument = legacyWindow.document;

// A page from the 1.6 generation: an element hidden with the old class, and the
// old stylesheet still in the document.
const staleHidden = legacyDocument.createElement('div');
staleHidden.id = 'stale-hidden';
staleHidden.className = 'fbad-hidden';
staleHidden.textContent = 'hidden by 1.6';
legacyDocument.querySelector('.thread').appendChild(staleHidden);
const staleStyle = legacyDocument.createElement('style');
staleStyle.id = 'freebuff-adblock-style';
legacyDocument.head.appendChild(staleStyle);

legacyWindow.chrome = {
  runtime: {
    lastError: null,
    getManifest: () => ({ version: MANIFEST.version }),
    sendMessage: () => undefined,
    onMessage: { addListener: () => undefined },
  },
  storage: {
    sync: {
      get: (defaults, cb) => {
        const out = { ...defaults };
        for (const key of Object.keys(defaults)) {
          if (key in legacyStore) out[key] = legacyStore[key];
        }
        cb(out);
      },
      set: (values) => Object.assign(legacyStore, values),
      remove: (keys) => {
        for (const key of keys) {
          removedKeys.push(key);
          delete legacyStore[key];
        }
      },
    },
    session: { get: (defaults, cb) => cb(defaults), set() {} },
    onChanged: { addListener() {} },
  },
};

const legacyScript = legacyDocument.createElement('script');
legacyScript.textContent = CODE;
legacyDocument.body.appendChild(legacyScript);
await new Promise((r) => setTimeout(r, 80));

check('the old enabled value is copied to the new key', legacyStore.freebuffFocusEnabled, false);
check('the old selectors are copied to the new key', Array.isArray(legacyStore.freebuffFocusSelectors), true);
check('the old keys are removed afterwards', removedKeys.length, 2);
check('the old stylesheet is gone', !!legacyDocument.getElementById('freebuff-adblock-style'), false);
check('the old hidden class is stripped', staleHidden.className.includes('fbad-hidden'), false);
// The class may still be on a node; what hides anything is the stylesheet, so
// that is the state the migrated setting has to control.
check('and the migrated setting is respected', legacyDocument.getElementById('freebuff-focus-style').disabled, true);
check('the new stylesheet is what is installed', !!legacyDocument.getElementById('freebuff-focus-style'), true);

/* ------------------------------------------------------------ fresh install */

/**
 * The pack says "ads on by default". This is that sentence, tested: a store
 * with nothing in it must leave the stylesheet off. The class may still land on
 * a node - the stylesheet is what hides anything - so `disabled` is the state
 * that has to be right.
 */
console.log('\nfresh install');

const freshStore = {};
const freshDom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://freebuff.com/',
});
const freshDocument = freshDom.window.document;

freshDom.window.chrome = {
  runtime: {
    lastError: null,
    getManifest: () => ({ version: MANIFEST.version }),
    sendMessage: () => undefined,
    onMessage: { addListener: () => undefined },
  },
  storage: {
    sync: {
      get: (defaults, cb) => {
        const out = { ...defaults };
        for (const key of Object.keys(defaults)) {
          if (key in freshStore) out[key] = freshStore[key];
        }
        cb(out);
      },
      set: (values) => Object.assign(freshStore, values),
      remove: () => undefined,
    },
    session: { get: (defaults, cb) => cb(defaults), set() {} },
    onChanged: { addListener() {} },
  },
};

const freshScript = freshDocument.createElement('script');
freshScript.textContent = CODE;
freshDocument.body.appendChild(freshScript);
await new Promise((r) => setTimeout(r, 80));

check('a fresh install starts with ads visible', freshDocument.getElementById('freebuff-focus-style').disabled, true);
check('and writes no setting of its own', Object.keys(freshStore).length, 0);

/* ----------------------------------------------------------- service worker */

/**
 * The install handler is the only extension code that runs outside a page, and
 * it is where the default used to be decided a second time: `get({enabled:
 * true})` then `set()`, which quietly turned focus on for every new install and
 * made the listing's "ads on by default" false. A missing key is now the only
 * carrier of the default, so the assertion is that install writes nothing.
 */
console.log('\nservice worker install');

const BACKGROUND = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
const installHandlers = [];
const startupHandlers = [];
const changedHandlers = [];
const syncWrites = [];
const badgeTexts = [];
const sessionState = {};
const syncStore = {};
const rulesetUpdates = [];
const alarmsCreated = [];
const alarmsCleared = [];
const alarmHandlers = [];
const commandHandlers = [];
const tabMessages = [];
// The active tab the worker falls back to when Chrome hands it no tab.
const activeTabs = [{ id: 7, url: 'https://freebuff.com/chat' }];

new Function('chrome', BACKGROUND)({
  runtime: {
    onInstalled: { addListener: (fn) => installHandlers.push(fn) },
    onStartup: { addListener: (fn) => startupHandlers.push(fn) },
    onMessage: { addListener: () => undefined },
    lastError: null,
  },
  storage: {
    sync: {
      // Writes land in the store, the way Chrome does it: the worker reads the
      // setting back on the next line, so a stub that only records would let a
      // broken read pass.
      get: (defaults, cb) => cb({ ...defaults, ...syncStore }),
      set: (values, cb) => {
        syncWrites.push(values);
        Object.assign(syncStore, values);
        if (cb) cb();
      },
    },
    session: {
      get: (defaults, cb) => cb({ ...defaults, ...sessionState }),
      set: (values, cb) => {
        Object.assign(sessionState, values);
        if (cb) cb();
      },
    },
    onChanged: { addListener: (fn) => changedHandlers.push(fn) },
  },
  declarativeNetRequest: {
    updateEnabledRulesets: (update, cb) => {
      rulesetUpdates.push(update);
      if (cb) cb();
    },
  },
  action: {
    setBadgeText: ({ text }) => badgeTexts.push(text),
    setBadgeBackgroundColor: () => undefined,
  },
  alarms: {
    create: (name, info) => alarmsCreated.push({ name, info }),
    clear: (name, cb) => {
      alarmsCleared.push(name);
      if (cb) cb();
    },
    onAlarm: { addListener: (fn) => alarmHandlers.push(fn) },
  },
  commands: {
    onCommand: { addListener: (fn) => commandHandlers.push(fn) },
  },
  tabs: {
    onRemoved: { addListener: () => undefined },
    query: (info, cb) => cb(activeTabs.slice()),
    sendMessage: (tabId, message, cb) => {
      tabMessages.push({ tabId, message });
      if (cb) cb();
    },
  },
});

check('the worker registers one install handler', installHandlers.length, 1);
for (const fn of installHandlers) fn();
check('install writes no sync setting', syncWrites.length, 0);
check('install clears the per-tab counts', JSON.stringify(sessionState.hiddenCounts), '{}');
check('install paints no badge', badgeTexts.length, 0);

// The ruleset is the half of focus the page cannot undo, so it has to follow
// the same setting. A missing setting means off, which is a disable, not a
// no-op: an upgrade can leave the ruleset enabled from the previous version.
check(
  'a fresh install leaves network blocking off',
  JSON.stringify(rulesetUpdates[rulesetUpdates.length - 1]),
  JSON.stringify({ disableRulesetIds: ['focus_rules'] })
);

syncStore.freebuffFocusEnabled = true;
rulesetUpdates.length = 0;
for (const fn of startupHandlers) fn();
check('a stored focus setting enables blocking at startup', JSON.stringify(rulesetUpdates[0]), JSON.stringify({ enableRulesetIds: ['focus_rules'] }));

check('the worker watches the setting', changedHandlers.length > 0, true);
rulesetUpdates.length = 0;
syncStore.freebuffFocusEnabled = false;
for (const fn of changedHandlers) fn({ freebuffFocusEnabled: { newValue: false } }, 'sync');
check('leaving focus turns blocking off', JSON.stringify(rulesetUpdates[0]), JSON.stringify({ disableRulesetIds: ['focus_rules'] }));

rulesetUpdates.length = 0;
for (const fn of changedHandlers) fn({ hiddenCounts: { newValue: {} } }, 'session');
check('an unrelated storage change touches no ruleset', rulesetUpdates.length, 0);

/* ------------------------------------------------------------ timed sessions */

console.log('\ntimed sessions');

const ALARM = 'freebuff-focus:expiry';

// A deadline in the future is one armed alarm, and the ruleset follows the
// setting in the same pass - never two reads that could disagree.
const soon = Date.now() + 25 * 60000;
syncStore.freebuffFocusEnabled = true;
syncStore.freebuffFocusUntil = soon;
alarmsCreated.length = 0;
alarmsCleared.length = 0;
rulesetUpdates.length = 0;
for (const fn of changedHandlers) fn({ freebuffFocusUntil: { newValue: soon } }, 'sync');
check('a timed session arms exactly one alarm', alarmsCreated.length, 1);
check('the alarm is named for the session', alarmsCreated[0] && alarmsCreated[0].name, ALARM);
check('the alarm fires at the deadline', alarmsCreated[0] && alarmsCreated[0].info.when, soon);
check(
  'a timed session enables blocking',
  JSON.stringify(rulesetUpdates[0]),
  JSON.stringify({ enableRulesetIds: ['focus_rules'] })
);

// "Until I switch it off" is the pre-timer behaviour: enabled with no deadline.
// Any alarm left over from an earlier session has to go, or it would end a
// session that was never meant to end.
syncStore.freebuffFocusUntil = null;
alarmsCreated.length = 0;
alarmsCleared.length = 0;
for (const fn of changedHandlers) fn({ freebuffFocusUntil: { newValue: null } }, 'sync');
check('an untimed session arms no alarm', alarmsCreated.length, 0);
check('and drops the one that was armed', alarmsCleared.includes(ALARM), true);

// The alarm is only a wake-up call; the deadline is what ends the session.
syncStore.freebuffFocusEnabled = true;
syncStore.freebuffFocusUntil = Date.now() - 1000;
syncWrites.length = 0;
rulesetUpdates.length = 0;
for (const fn of alarmHandlers) fn({ name: ALARM });
check(
  'the deadline turns focus off and clears itself',
  JSON.stringify(syncWrites[0]),
  JSON.stringify({ freebuffFocusEnabled: false, freebuffFocusUntil: null })
);
check(
  'and blocking goes off with it',
  JSON.stringify(rulesetUpdates[0]),
  JSON.stringify({ disableRulesetIds: ['focus_rules'] })
);

// Chrome can deliver an alarm slightly early after the machine wakes, and the
// system clock can move backwards. A session must not end before its deadline.
const later = Date.now() + 10 * 60000;
syncStore.freebuffFocusEnabled = true;
syncStore.freebuffFocusUntil = later;
syncWrites.length = 0;
alarmsCreated.length = 0;
for (const fn of alarmHandlers) fn({ name: ALARM });
check('an early alarm writes no setting', syncWrites.length, 0);
check('and is armed again for the deadline', alarmsCreated[0] && alarmsCreated[0].info.when, later);

// A browser closed at the deadline starts with no alarm at all, so the stored
// deadline has to be settled on the way in.
syncStore.freebuffFocusEnabled = true;
syncStore.freebuffFocusUntil = Date.now() - 60 * 60 * 1000;
syncWrites.length = 0;
alarmsCreated.length = 0;
rulesetUpdates.length = 0;
for (const fn of startupHandlers) fn();
check(
  'startup ends a session whose deadline passed while closed',
  JSON.stringify(syncWrites[0]),
  JSON.stringify({ freebuffFocusEnabled: false, freebuffFocusUntil: null })
);
check('and never re-arms it', alarmsCreated.length, 0);
check(
  'and blocking is off',
  JSON.stringify(rulesetUpdates[rulesetUpdates.length - 1]),
  JSON.stringify({ disableRulesetIds: ['focus_rules'] })
);

// An untimed session still survives a restart - the thing the extension did
// before timed focus existed, and what a 1.8 setting looks like.
syncStore.freebuffFocusEnabled = true;
syncStore.freebuffFocusUntil = null;
syncWrites.length = 0;
alarmsCreated.length = 0;
rulesetUpdates.length = 0;
for (const fn of startupHandlers) fn();
check('an untimed session survives a restart', syncWrites.length, 0);
check('still blocking', JSON.stringify(rulesetUpdates[0]), JSON.stringify({ enableRulesetIds: ['focus_rules'] }));
check('and arms nothing', alarmsCreated.length, 0);

// Some other extension's alarm must not end this session.
syncStore.freebuffFocusEnabled = true;
syncStore.freebuffFocusUntil = Date.now() + 60000;
syncWrites.length = 0;
for (const fn of alarmHandlers) fn({ name: 'someone-else' });
check('a foreign alarm is ignored', syncWrites.length, 0);

/* --------------------------------------------------------------- shortcut */

/**
 * Option+Shift+F, declared in the manifest and collected by the worker.
 *
 * The command is a second way into the same picker the popup opens, so the
 * checks are about routing: it has to reach the freebuff.com tab with the same
 * message the popup sends, and it must do nothing anywhere else - a global
 * shortcut that half-works on another site is worse than no shortcut.
 */
console.log('\nkeyboard shortcut');

const command = MANIFEST.commands && MANIFEST.commands['start-picking'];
check('the manifest declares the picker command', Boolean(command), true);
check('with a default key', command && command.suggested_key && command.suggested_key.default, 'Alt+Shift+F');
// On a Mac Chrome calls Option "Alt", so this is the same physical chord.
check('and the same chord on a Mac', command && command.suggested_key && command.suggested_key.mac, 'Alt+Shift+F');
check('and a description the shortcut editor can show', Boolean(command && command.description), true);

check('the worker watches for the command', commandHandlers.length, 1);

// The exact chord the popup sends: one picker, one message type.
tabMessages.length = 0;
for (const fn of commandHandlers) fn('start-picking', { id: 7, url: 'https://freebuff.com/chat' });
check('the shortcut asks this tab to pick', tabMessages.length, 1);
check('on the tab it fired in', tabMessages[0] && tabMessages[0].tabId, 7);
check('with the picker message', tabMessages[0] && tabMessages[0].message.type, 'freebuff-focus:pick');

// Chrome does not always pass the tab, and the active-tab fallback is what
// makes the shortcut work while the popup has never been opened.
tabMessages.length = 0;
for (const fn of commandHandlers) fn('start-picking');
check('without a tab argument it uses the active tab', tabMessages[0] && tabMessages[0].tabId, 7);

// Someone else's command name, and a non-Freebuff tab.
tabMessages.length = 0;
for (const fn of commandHandlers) fn('someone-else', { id: 7, url: 'https://freebuff.com/chat' });
check('an unknown command is ignored', tabMessages.length, 0);

for (const url of ['https://example.com/', 'https://notfreebuff.com/', 'https://freebuff.com.evil.test/']) {
  tabMessages.length = 0;
  for (const fn of commandHandlers) fn('start-picking', { id: 9, url });
  check(`the shortcut does nothing on ${url}`, tabMessages.length, 0);
}

const failed = results.filter((r) => !r).length;
console.log('');
if (failed) {
  console.error(`${failed} of ${results.length} checks failed`);
  process.exit(1);
}
console.log(`All ${results.length} checks passed.`);
