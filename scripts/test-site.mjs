/**
 * Install-page checks: does the store button name the browser in front of it,
 * and does it stay out of the way when there is no listing to point at?
 *
 * Loads site/index.html into jsdom and runs site/app.js against a stubbed
 * navigator for each browser that matters, substituting listing URLs into
 * STORE_LINKS so both states are exercised without editing the page.
 *
 * jsdom is deliberately not a project dependency, so this skips itself when it
 * is absent. To run the checks:  npm install --no-save jsdom && npm test
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  console.log('jsdom is not installed - skipping install-page checks.');
  console.log('  npm install --no-save jsdom');
  process.exit(0);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'site', 'app.js'), 'utf8');

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const EDGE = CHROME.replace('Chrome/121.0.0.0', 'Chrome/121.0.0.0 Edg/121.0.0.0');
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
const SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const LISTINGS = {
  chrome: 'https://store.test/chrome',
  edge: 'https://store.test/edge',
  firefox: 'https://store.test/firefox',
};

/**
 * Paste listing URLs into STORE_LINKS the same way a person would, in the source
 * text. If the shape of that block ever changes this throws rather than silently
 * testing nothing.
 */
function withListings(source, links) {
  let out = source;
  for (const [store, url] of Object.entries(links)) {
    const before = out;
    out = out.replace(new RegExp(`(\\b${store}:\\s*)''`), `$1'${url}'`);
    if (out === before) {
      throw new Error(`could not set STORE_LINKS.${store} - the shape of that block changed`);
    }
  }
  return out;
}

/**
 * Load the page with a given browser attached and listing URLs in place.
 *
 * The user agent is defined on the navigator directly: jsdom's `userAgent`
 * option only sets the header its own requests carry, and navigator.userAgent
 * always answers with jsdom's built-in string regardless.
 */
function open({ ua, brands, brave, links = {} } = {}) {
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', url: 'https://example.test/' });

  const { window } = dom;
  const { document } = window;

  if (ua) {
    Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
  }

  if (brands) {
    Object.defineProperty(window.navigator, 'userAgentData', {
      value: { brands: brands.map((brand) => ({ brand, version: '121' })) },
      configurable: true,
    });
  }

  if (brave) {
    Object.defineProperty(window.navigator, 'brave', {
      value: { isBrave: () => true },
      configurable: true,
    });
  }

  const script = document.createElement('script');
  script.textContent = withListings(APP, links);
  document.body.appendChild(script);

  return {
    document,
    button: document.querySelector('[data-store-button]'),
    zip: document.querySelector('[data-zip]'),
  };
}

const results = [];
const show = (value) => {
  if (value === null) return 'no button';
  if (value && value.nodeType) return `<${value.tagName.toLowerCase()}>`;
  return JSON.stringify(value);
};
const check = (name, actual, expected) => {
  const ok = actual === expected;
  results.push(ok);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name} -> ${show(actual)} (want ${show(expected)})`);
};

const label = (button) => (button ? button.textContent.trim() : null);
const href = (button) => (button ? button.getAttribute('href') : null);
const shown = (button) => !!button && button.hidden === false;

/* ------------------------------------------------------------ no listing yet */

console.log('\nno listing published');
const none = open({ ua: CHROME });
check('no store button is offered', none.button, null);
check('the zip keeps the headline style', none.zip.classList.contains('btn-primary'), true);

/* -------------------------------------------------------- chrome and chromium */

console.log('\nchrome listing, read in chrome');
const chrome = open({ ua: CHROME, links: { chrome: LISTINGS.chrome } });
check('the button appears', shown(chrome.button), true);
check('it names the browser', label(chrome.button), 'Add to Chrome');
check('it points at the listing', href(chrome.button), LISTINGS.chrome);
check('the zip steps back to the quiet button', chrome.zip.classList.contains('btn-primary'), false);
check('the zip says what it is now', chrome.zip.querySelector('.btn-meta').textContent.trim(), 'manual install');

console.log('\nedge listing, read in edge');
const edge = open({ ua: EDGE, links: { edge: LISTINGS.edge } });
check('it names the browser', label(edge.button), 'Add to Edge');
check('it points at the edge store', href(edge.button), LISTINGS.edge);

const edgeBrands = open({
  ua: CHROME,
  brands: ['Not/A)Brand', 'Chromium', 'Microsoft Edge'],
  links: { edge: LISTINGS.edge },
});
check('edge named only by its own brand', label(edgeBrands.button), 'Add to Edge');

/* ------------------------------------------------------------------- firefox */

console.log('\nfirefox listing, read in firefox');
const firefox = open({ ua: FIREFOX, links: { firefox: LISTINGS.firefox } });
check('it names the browser', label(firefox.button), 'Add to Firefox');
check('it points at addons.mozilla.org', href(firefox.button), LISTINGS.firefox);

console.log('\nbrowser with no listing of its own');
const mismatched = open({ ua: FIREFOX, links: { chrome: LISTINGS.chrome } });
check('a chrome-only listing shows nothing in firefox', mismatched.button, null);

/* ------------------------------------------------------- self-reported brands */

console.log('\nbrowser we have never enumerated');
const unknown = open({
  ua: CHROME,
  brands: ['Chromium', 'Coc Coc', 'Not/A)Brand'],
  links: { chrome: LISTINGS.chrome },
});
check('it keeps the name it reported', label(unknown.button), 'Add to Coc Coc');
check('it takes the store that serves every Blink browser', href(unknown.button), LISTINGS.chrome);

const brave = open({ ua: CHROME, brave: true, links: { chrome: LISTINGS.chrome } });
check('brave is named by its own tell', label(brave.button), 'Add to Brave');

/* ------------------------------------------------------------------- safari */

console.log('\nsafari, with every listing live');
const safari = open({ ua: SAFARI, links: LISTINGS });
check('no button, because there is no build it could install', safari.button, null);
check('the zip is still the path', safari.zip.classList.contains('btn-primary'), true);

const failed = results.filter((r) => !r).length;
console.log('');
if (failed) {
  console.error(`${failed} of ${results.length} checks failed`);
  process.exit(1);
}
console.log(`All ${results.length} checks passed.`);
