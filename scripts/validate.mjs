/**
 * Static validation of the packaged extension.
 *
 * Chrome fails the whole extension over a single missing file, an unknown
 * resource type, or one malformed DNR rule - and none of that shows up until
 * someone tries to load it. This catches it at build time instead.
 *
 * Run with `npm run validate`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = path.join(ROOT, 'extension');

const problems = [];
const fail = (message) => problems.push(message);
const pass = (message) => console.log(`  ok    ${message}`);

/** Enumerated values Chrome validates rules against. */
const RESOURCE_TYPES = new Set([
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
]);

const ACTION_TYPES = new Set([
  'block',
  'redirect',
  'upgradeScheme',
  'modifyHeaders',
  'allow',
  'allowAllRequests',
]);

const CONDITION_KEYS = new Set([
  'urlFilter',
  'regexFilter',
  'isUrlFilterCaseSensitive',
  'requestDomains',
  'excludedRequestDomains',
  'initiatorDomains',
  'excludedInitiatorDomains',
  'domainType',
  'excludedDomainTypes',
  'resourceTypes',
  'excludedResourceTypes',
  'tabIds',
  'excludedTabIds',
  'requestMethods',
  'excludedRequestMethods',
]);

const GUARDRAIL_DOMAIN = 'freebuff.com';

/* ----------------------------------------------------------------- manifest */

function checkManifest() {
  console.log('\nmanifest.json');

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    pass('parses as JSON');
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${error.message}`);
    return null;
  }

  if (manifest.manifest_version === 3) pass('manifest_version is 3');
  else fail(`manifest_version must be 3, got ${manifest.manifest_version}`);

  if (/^\d+(\.\d+){0,3}$/.test(String(manifest.version))) pass(`version ${manifest.version}`);
  else fail(`version "${manifest.version}" is not a valid extension version`);

  for (const key of ['declarativeNetRequest', 'storage']) {
    (manifest.permissions || []).includes(key)
      ? pass(`permission "${key}" declared`)
      : fail(`missing required permission "${key}"`);
  }

  const banned = ['tabs', 'webRequest', 'webRequestBlocking', '<all_urls>'];
  for (const key of banned) {
    const inPermissions = (manifest.permissions || []).includes(key);
    const inHosts = (manifest.host_permissions || []).includes(key);
    if (inPermissions || inHosts) fail(`over-broad permission declared: "${key}"`);
  }
  pass('no over-broad permissions');

  // Host access must be scoped to the target site.
  const hosts = manifest.host_permissions || [];
  if (hosts.length === 0) fail('host_permissions is empty');
  const scoped = hosts.every((h) => /^(\*|https?):\/\/(\*\.)?freebuff\.com\/(\*)?$/.test(h));
  scoped
    ? pass(`host access scoped: ${hosts.join(', ')}`)
    : fail(`host_permissions not scoped to freebuff.com: ${hosts.join(', ')}`);

  // Every file the manifest points at must exist.
  const referenced = [];
  if (manifest.background?.service_worker) referenced.push(manifest.background.service_worker);
  if (manifest.action?.default_popup) referenced.push(manifest.action.default_popup);

  for (const [size, file] of Object.entries(manifest.icons || {})) referenced.push(file);
  for (const [size, file] of Object.entries(manifest.action?.default_icon || {})) referenced.push(file);

  for (const script of manifest.content_scripts || []) {
    for (const file of [...(script.js || []), ...(script.css || [])]) referenced.push(file);
    if (!script.matches?.length) fail('content script has no matches');
  }

  for (const resource of manifest.declarative_net_request?.rule_resources || []) {
    referenced.push(resource.path);
    if (!resource.id) fail('ruleset is missing an id');
  }

  if (!manifest.content_scripts?.length) fail('no content_scripts declared');
  if (!manifest.declarative_net_request?.rule_resources?.length) fail('no ruleset declared');

  for (const file of referenced) {
    fs.existsSync(path.join(EXT, file))
      ? pass(`references ${file}`)
      : fail(`manifest references missing file: ${file}`);
  }

  return manifest;
}

/* -------------------------------------------------------------------- icons */

function checkIcons(manifest) {
  console.log('\nicons');

  const sizes = Object.entries(manifest?.icons || {});
  if (!sizes.length) {
    fail('manifest declares no icons');
    return;
  }

  for (const [size, file] of sizes) {
    const full = path.join(EXT, file);
    if (!fs.existsSync(full)) continue; // already reported

    const buf = fs.readFileSync(full);
    const signature = buf.subarray(0, 8).toString('hex');
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);

    if (signature !== '89504e470d0a1a0a') fail(`${file} is not a PNG`);
    else if (width !== Number(size) || height !== Number(size))
      fail(`${file} is ${width}x${height}, expected ${size}x${size}`);
    else pass(`${file} is a valid ${size}x${size} PNG`);
  }
}

/* -------------------------------------------------------------------- popup */

function checkPopup() {
  console.log('\npopup');

  const htmlPath = path.join(EXT, 'popup.html');
  if (!fs.existsSync(htmlPath)) {
    fail('popup.html missing');
    return;
  }

  const html = fs.readFileSync(htmlPath, 'utf8');

  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = match[1];
    if (/^(https?:|#|data:)/.test(ref)) continue;
    fs.existsSync(path.join(EXT, ref))
      ? pass(`popup references ${ref}`)
      : fail(`popup.html references missing file: ${ref}`);
  }

  for (const id of ['toggle', 'stateText', 'count', 'statusText', 'installLink']) {
    html.includes(`id="${id}"`)
      ? pass(`popup has #${id}`)
      : fail(`popup.html is missing #${id}, which popup.js queries`);
  }
}

/* --------------------------------------------------------------------- rules */

function checkRules() {
  console.log('\nrules.json');

  let rules;
  try {
    rules = JSON.parse(fs.readFileSync(path.join(EXT, 'rules.json'), 'utf8'));
    pass('parses as JSON');
  } catch (error) {
    fail(`rules.json is not valid JSON: ${error.message}`);
    return;
  }

  if (!Array.isArray(rules) || rules.length === 0) {
    fail('rules.json must be a non-empty array');
    return;
  }

  // Chrome rejects unknown top-level keys on a rule.
  const RULE_KEYS = new Set(['id', 'priority', 'action', 'condition']);
  const seenIds = new Set();
  let hasGuardrail = false;

  for (const rule of rules) {
    const label = `rule ${rule.id ?? '?'}`;

    for (const key of Object.keys(rule)) {
      if (!RULE_KEYS.has(key)) fail(`${label}: unknown property "${key}" (Chrome rejects the whole ruleset)`);
    }

    if (!Number.isInteger(rule.id)) fail(`${label}: id must be an integer`);
    else if (seenIds.has(rule.id)) fail(`${label}: duplicate id`);
    else seenIds.add(rule.id);

    if (!Number.isInteger(rule.priority) || rule.priority < 1)
      fail(`${label}: priority must be a positive integer`);

    if (!ACTION_TYPES.has(rule.action?.type)) fail(`${label}: invalid action type "${rule.action?.type}"`);

    if (!rule.condition || typeof rule.condition !== 'object') {
      fail(`${label}: missing condition`);
      continue;
    }

    for (const key of Object.keys(rule.condition)) {
      if (!CONDITION_KEYS.has(key)) fail(`${label}: unknown condition property "${key}"`);
    }

    const hasScope = rule.condition.requestDomains || rule.condition.urlFilter || rule.condition.regexFilter;
    if (!hasScope) fail(`${label}: condition matches every URL`);

    const types = rule.condition.resourceTypes;
    if (types) {
      if (!Array.isArray(types)) fail(`${label}: resourceTypes must be an array`);
      else {
        for (const type of types) {
          if (!RESOURCE_TYPES.has(type)) fail(`${label}: invalid resourceType "${type}"`);
        }
        if (types.includes('main_frame')) fail(`${label}: never block main_frame (breaks navigation)`);
      }
    }

    // The guardrail: every block must be scoped to freebuff.com as initiator.
    if (rule.action.type === 'block') {
      const initiators = rule.condition.initiatorDomains;
      if (!initiators?.includes(GUARDRAIL_DOMAIN))
        fail(`${label}: block rule is not scoped to an initiator on ${GUARDRAIL_DOMAIN}`);
      if (rule.priority > 1) fail(`${label}: block priority must stay below the guardrail`);
    }

    if (rule.action.type === 'allow' && rule.condition.requestDomains?.includes(GUARDRAIL_DOMAIN)) {
      if (rule.priority <= 1) fail(`${label}: guardrail allow must out-rank every block rule`);
      else hasGuardrail = true;
    }
  }

  hasGuardrail
    ? pass('priority-100 first-party allow guardrail present')
    : fail(`no allow rule protects ${GUARDRAIL_DOMAIN} first-party traffic`);

  pass(`${rules.length} rules, ids ${[...seenIds].sort((a, b) => a - b).join(', ')}`);
}

/* ---------------------------------------------------------------- selectors */

function checkSelectors() {
  console.log('\ncontent.js selectors');

  const source = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');

  const grab = (name) => {
    const match = source.match(new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
    if (!match) return null;
    return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  };

  const selectors = grab('AD_SELECTORS');
  if (!selectors?.length) fail('could not read AD_SELECTORS from content.js');
  else {
    for (const selector of selectors) {
      const opens = (selector.match(/\[/g) || []).length;
      const closes = (selector.match(/\]/g) || []).length;
      if (opens !== closes) fail(`unbalanced selector: ${selector}`);
      if (selector.endsWith(',')) fail(`trailing comma in selector: ${selector}`);
    }
    pass(`${selectors.length} ad selectors, all balanced`);
  }

  // The dangerous pattern: a bare substring match that also catches real UI.
  const dangerous = (selectors || []).filter((s) => /\[class\*="(ad|ads|adv)"\]/.test(s));
  dangerous.length
    ? fail(`blank-page selector present: ${dangerous.join(', ')} (matches header/add/read/load)`)
    : pass('no bare [class*="ad"] selector (would match header/add/read/load)');

  const tokens = source.match(/const AD_TOKENS = new Set\(\[([\s\S]*?)\]\);/);
  if (!tokens) fail('could not read AD_TOKENS from content.js');
  else {
    const list = [...tokens[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (list.includes('add') || list.includes('header') || list.includes('load'))
      fail('AD_TOKENS contains a token that matches ordinary UI');
    else pass(`${list.length} exact ad tokens, none matching ordinary UI`);
  }

  // Tier C: promo cards are matched on badge *text*, which is a far wider net
  // than an attribute hook. The guards around it have to stay in place.
  const labels = source.match(/const BADGE_LABELS = new Set\(\[([\s\S]*?)\]\);/);
  if (!labels) fail('could not read BADGE_LABELS from content.js');
  else {
    const list = [...labels[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    if (!list.includes('ad') || !list.includes('sponsored'))
      fail(`BADGE_LABELS is missing a base label: ${list.join(', ')}`);
    else pass(`${list.length} badge labels`);
  }

  for (const needle of ['PROMO_ACTION_SELECTOR', 'REAL_CONTENT_SELECTOR']) {
    source.includes(`const ${needle}`)
      ? pass(`promo tier keeps its ${needle} guard`)
      : fail(`content.js no longer defines ${needle} - promo detection would be unguarded`);
  }

  if (!source.includes('characterData: true'))
    fail('observer does not watch characterData; a badge that appears as text is missed');
  else pass('observer watches characterData for late badges');

  for (const needle of ['MutationObserver', 'chrome.storage', 'requestAnimationFrame']) {
    source.includes(needle)
      ? pass(`uses ${needle}`)
      : fail(`content.js does not use ${needle}`);
  }
}

/* ------------------------------------------------------------------- origin */

/**
 * The popup's install link and the feed's codebase URL come from two different
 * files. When they disagree, the popup links to a domain that does not exist and
 * the feed advertises a package nobody can fetch - and nothing anywhere reports
 * an error, because both files are individually well-formed. So compare them.
 */
/**
 * The first single-quoted string after `needle`, or null.
 *
 * Deliberately not a regex. The obvious greedy pattern backtracks to the last
 * quote on the line and then lets its capture group run on across newlines, so
 * it silently compares two pieces of unrelated text and reports a mismatch that
 * does not exist. This cannot do that.
 */
function quotedAfter(source, needle) {
  const at = source.indexOf(needle);
  if (at < 0) return null;
  const open = source.indexOf("'", at);
  if (open < 0) return null;
  const close = source.indexOf("'", open + 1);
  if (close < 0) return null;
  return source.slice(open + 1, close);
}

function checkOrigin() {
  console.log('\nsite origin');

  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  const popup = fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8');

  const origin = quotedAfter(build, 'const SITE_ORIGIN'); // dead: old regex tail -> \n]*'([^']+)'/);
  if (!origin || !origin.startsWith('http')) {
    fail('could not read SITE_ORIGIN from scripts/build.mjs');
    return;
  }
  pass(`build origin: ${origin}`);

  const install = quotedAfter(popup, 'const INSTALL_URL'); // dead: old regex tail -> \n]*'([^']+)'/);
  if (!install || !install.startsWith('http')) {
    fail('could not read INSTALL_URL from extension/popup.js');
    return;
  }

  const expected = origin.endsWith('/') ? origin : `${origin}/`;
  if (install === expected) pass(`popup install link matches: ${install}`);
  else
    fail(
      `popup INSTALL_URL ${install} does not match SITE_ORIGIN ${origin} - the popup would link off-site`
    );
}

/* ------------------------------------------------------------------ package */

function run() {
  console.log('Validating extension/');

  const manifest = checkManifest();
  checkIcons(manifest);
  checkPopup();
  checkRules();
  checkSelectors();
  checkOrigin();

  console.log('');
  if (problems.length) {
    console.error(`FAILED - ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log('All extension checks passed.');
}

run();
