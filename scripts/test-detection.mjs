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
git commit -m "Add Freebuff Ad Block"</code></pre>
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

// Minimal chrome.* surface: the script only reads state, watches for changes and
// reports counts.
window.chrome = {
  runtime: {
    lastError: null,
    getManifest: () => ({ version: '1.1.0' }),
    sendMessage: () => undefined,
    onMessage: { addListener() {} },
  },
  storage: {
    sync: {
      get: (defaults, cb) => cb(defaults),
      set() {},
    },
    session: { get: (defaults, cb) => cb(defaults), set() {} },
    onChanged: { addListener() {} },
  },
};

const script = document.createElement('script');
script.textContent = CODE;
document.body.appendChild(script);

const HIDDEN = 'fbad-hidden';
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

const failed = results.filter((r) => !r).length;
console.log('');
if (failed) {
  console.error(`${failed} of ${results.length} checks failed`);
  process.exit(1);
}
console.log(`All ${results.length} checks passed.`);
