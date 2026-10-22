import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureHtml } from './generate-realistic-assets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'site', 'store-assets');
const ICON_BASE64 = fs.readFileSync(path.join(ROOT, 'extension', 'icons', 'icon128.png')).toString('base64');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', 'manifest.json'), 'utf8'));
const VERSION = MANIFEST.version;

// Common CSS
const COMMON_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #090b10;
    color: #eef2f9;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
    position: relative;
  }
  .mono { font-family: "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace; }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .badge-sage {
    background: rgba(157, 184, 154, 0.14);
    color: #a3c4a0;
    border: 1px solid rgba(157, 184, 154, 0.3);
  }
  .badge-amber {
    background: rgba(232, 179, 75, 0.14);
    color: #f0be5b;
    border: 1px solid rgba(232, 179, 75, 0.3);
  }
  .traffic-lights {
    display: flex;
    gap: 7px;
    align-items: center;
  }
  .tl-dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
  }
  .tl-red { background: #ff5f56; }
  .tl-yellow { background: #ffbd2e; }
  .tl-green { background: #27c93f; }
`;

/* ------------------------------------------------------------- 1. CHAT SCREENSHOT */
function getHtmlScreenshot1() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${COMMON_CSS}
body {
  width: 1280px;
  height: 800px;
  background: radial-gradient(circle at 50% -10%, #17202a 0%, #090b10 80%);
  padding: 34px 50px 0 50px;
  display: flex;
  flex-direction: column;
}
.header {
  text-align: center;
  margin-bottom: 22px;
}
.header h1 {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #ffffff;
  margin-top: 8px;
}
.header p {
  font-size: 14px;
  color: #8c99b2;
  margin-top: 4px;
}
.browser-window {
  flex: 1;
  background: #0f131c;
  border-radius: 12px 12px 0 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: none;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.85);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.browser-bar {
  height: 42px;
  background: #151a26;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 16px;
}
.address-bar {
  flex: 1;
  max-width: 580px;
  margin: 0 auto;
  height: 28px;
  background: #0c0f17;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  color: #8c99b2;
  gap: 8px;
}
.address-bar span.secure { color: #a3c4a0; }
.address-bar span.domain { color: #ffffff; font-weight: 500; }
.browser-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ext-icon-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(157, 184, 154, 0.15);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(157, 184, 154, 0.35);
}
.ext-icon-wrap img { width: 16px; height: 16px; }
.ext-icon-wrap span { font-size: 11px; font-weight: 600; color: #a3c4a0; }

.app-content {
  flex: 1;
  display: flex;
  background: #0c0f16;
}
.app-sidebar {
  width: 240px;
  background: #111520;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #ffffff;
}
.brand-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ff5a45;
  box-shadow: 0 0 8px #ff5a45;
}
.model-pill {
  background: #171c2b;
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: #cbd5e1;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.chat-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.chat-item {
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: #8c99b2;
}
.chat-item.active {
  background: rgba(255, 255, 255, 0.06);
  color: #ffffff;
  font-weight: 500;
}
.sidebar-footer {
  margin-top: auto;
  font-size: 11px;
  color: #64748b;
  line-height: 1.4;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.main-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 20px 32px 0 32px;
  overflow: hidden;
  gap: 16px;
}
.focus-active-banner {
  background: linear-gradient(90deg, rgba(157, 184, 154, 0.12), rgba(157, 184, 154, 0.04));
  border: 1px solid rgba(157, 184, 154, 0.25);
  border-radius: 8px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}
.fab-left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #a3c4a0;
  font-weight: 600;
}
.fab-right {
  color: #8c99b2;
  font-size: 11px;
}

.chat-bubble-user {
  align-self: flex-end;
  background: #1b2130;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px 12px 2px 12px;
  padding: 12px 16px;
  font-size: 13px;
  color: #f1f5f9;
  max-width: 600px;
  line-height: 1.45;
}
.chat-bubble-ai {
  align-self: flex-start;
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.thought-box {
  background: #10141e;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11px;
  color: #718096;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
}
.code-card {
  background: #090c12;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
  font-size: 12px;
}
.code-header {
  background: #131722;
  padding: 6px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  color: #8c99b2;
}
.code-body {
  padding: 12px 14px;
  line-height: 1.6;
  color: #cbd5e1;
}
.code-kw { color: #f472b6; font-weight: 600; }
.code-type { color: #38bdf8; }
.code-fn { color: #818cf8; }
.code-str { color: #4ade80; }
.code-num { color: #fb923c; }

.quieted-ad-slot {
  background: rgba(15, 18, 26, 0.6);
  border: 1px dashed rgba(157, 184, 154, 0.35);
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.qas-text {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #9db89a;
}
.qas-meta {
  font-size: 11px;
  color: #64748b;
}
</style>
</head>
<body>
  <div class="header">
    <div class="badge badge-sage">Focus Mode Active</div>
    <h1>Stay in deep flow while free models stream your code</h1>
    <p>Zero distractions during builds. Ad slots quieted temporarily and restored on demand.</p>
  </div>

  <div class="browser-window">
    <div class="browser-bar">
      <div class="traffic-lights">
        <div class="tl-dot tl-red"></div>
        <div class="tl-dot tl-yellow"></div>
        <div class="tl-dot tl-green"></div>
      </div>
      <div class="address-bar">
        <span class="secure">🔒</span>
        <span class="domain">freebuff.com</span>
        <span>/chat/sse-telemetry-pipeline</span>
      </div>
      <div class="browser-actions">
        <div class="ext-icon-wrap">
          <img src="data:image/png;base64,${ICON_BASE64}">
          <span>FOCUSING 23m</span>
        </div>
      </div>
    </div>

    <div class="app-content">
      <div class="app-sidebar">
        <div class="brand-row">
          <div class="brand-dot"></div>
          <span>freebuff</span>
        </div>
        <div class="model-pill">
          <span>Claude 3.7 Sonnet</span>
          <span style="color:#27c93f;">● Free</span>
        </div>
        <div class="chat-list">
          <div class="chat-item active">⚡ SSE Telemetry Pipeline</div>
          <div class="chat-item">JWT Session Cookie</div>
          <div class="chat-item">Async Vector Index</div>
        </div>
        <div class="sidebar-footer">
          Ad-supported tier.<br>Focus Mode pauses slots while you code.
        </div>
      </div>

      <div class="main-chat">
        <div class="focus-active-banner">
          <div class="fab-left">
            <span>⚡ Focus Mode: Active</span>
            <span style="color:#64748b;">•</span>
            <span style="color:#cbd5e1; font-weight:normal;">Quieting ad cards & sponsor requests</span>
          </div>
          <div class="fab-right">Restores when session ends</div>
        </div>

        <div class="chat-bubble-user">
          Write a resilient streaming SSE transform pipeline with automatic backpressure handling in TypeScript.
        </div>

        <div class="chat-bubble-ai">
          <div class="thought-box">
            <span>💭 Thought for 3.4s • Reasoning tokens generated</span>
          </div>

          <div class="code-card">
            <div class="code-header">
              <span class="mono">telemetry-stream.ts</span>
              <span>TypeScript • 1,420 tokens/sec</span>
            </div>
            <div class="code-body mono">
              <span class="code-kw">export class</span> <span class="code-type">TelemetryStream</span> <span class="code-kw">extends</span> <span class="code-type">TransformStream</span> {<br>
              &nbsp;&nbsp;<span class="code-kw">constructor</span>(maxBuffer = <span class="code-num">65536</span>) {<br>
              &nbsp;&nbsp;&nbsp;&nbsp;<span class="code-kw">super</span>({<br>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="code-fn">transform</span>(chunk, controller) {<br>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<span class="code-kw">if</span> (controller.desiredSize &lt;= <span class="code-num">0</span>) <span class="code-kw">await</span> <span class="code-type">Drain</span>();<br>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;controller.<span class="code-fn">enqueue</span>(<span class="code-fn">parseFrame</span>(chunk));<br>
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}<br>
              &nbsp;&nbsp;&nbsp;&nbsp;});<br>
              &nbsp;&nbsp;}<br>
              }
            </div>
          </div>

          <div class="quieted-ad-slot">
            <div class="qas-text">
              <span>🛡️</span>
              <span>Mid-build sponsor card quieted</span>
            </div>
            <div class="qas-meta">
              Restores automatically after session • Free tier protected
            </div>
    </div>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------- 2. POPUP SCREENSHOT */
function getHtmlScreenshot2() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${COMMON_CSS}
body {
  width: 1280px;
  height: 800px;
  background: radial-gradient(circle at 50% -10%, #17202a 0%, #090b10 80%);
  padding: 34px 50px 0 50px;
  display: flex;
  flex-direction: column;
  position: relative;
}
.header {
  text-align: center;
  margin-bottom: 22px;
}
.header h1 {
  font-size: 27px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #ffffff;
  margin-top: 8px;
}
.header p {
  font-size: 14px;
  color: #8c99b2;
  margin-top: 4px;
}
.browser-window {
  flex: 1;
  background: #0f131c;
  border-radius: 12px 12px 0 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-bottom: none;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.85);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}
.browser-bar {
  height: 42px;
  background: #151a26;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 16px;
}
.address-bar {
  flex: 1;
  max-width: 580px;
  margin: 0 auto;
  height: 28px;
  background: #0c0f17;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-size: 12px;
  color: #8c99b2;
  gap: 8px;
}
.address-bar span.secure { color: #a3c4a0; }
.address-bar span.domain { color: #ffffff; font-weight: 500; }
.browser-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ext-btn-active {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(157, 184, 154, 0.2);
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(157, 184, 154, 0.4);
}
.ext-btn-active img { width: 16px; height: 16px; }

.app-backdrop {
  flex: 1;
  display: flex;
  background: #0c0f16;
  opacity: 0.35;
  filter: blur(2px);
}
.app-sidebar {
  width: 240px;
  background: #111520;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.brand-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
}
.brand-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff5a45; }
.mock-chat { flex: 1; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.mock-bubble { background: #1a202c; border-radius: 8px; height: 48px; width: 60%; }
.mock-bubble-ai { background: #121622; border-radius: 8px; height: 160px; width: 90%; }

/* The Anchored Popup */
.popup-anchor {
  position: absolute;
  top: 48px;
  right: 24px;
  width: 360px;
  background: #111522;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.95), 0 0 30px rgba(157, 184, 154, 0.15);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 100;
}

.popup-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pt-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pt-brand img { width: 26px; height: 26px; }
.pt-name {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
}
.pt-sub {
  font-size: 11px;
  color: #8c99b2;
}
.pt-ver {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 7px;
  border-radius: 6px;
  color: #cbd5e1;
}

.switch-box {
  background: #161c2b;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sb-left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sb-status {
  font-size: 15px;
  font-weight: 700;
  color: #a3c4a0;
}
.sb-desc {
  font-size: 11px;
  color: #8c99b2;
}
.ios-toggle {
  width: 48px;
  height: 28px;
  background: #9db89a;
  border-radius: 14px;
  position: relative;
}
.ios-knob {
  width: 24px;
  height: 24px;
  background: #ffffff;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  right: 2px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}

.duration-pills {
  display: flex;
  gap: 8px;
}
.dp-pill {
  flex: 1;
  text-align: center;
  padding: 8px 0;
  background: #161c2b;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #8c99b2;
}
.dp-pill.active {
  background: rgba(157, 184, 154, 0.18);
  border-color: rgba(157, 184, 154, 0.4);
  color: #a3c4a0;
}

.stats-card {
  background: #0d1017;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 14px;
}
.sc-num {
  font-size: 30px;
  font-weight: 800;
  color: #ffffff;
  line-height: 1;
}
.sc-text {
  font-size: 12px;
  color: #8c99b2;
  line-height: 1.4;
}

.action-btn {
  width: 100%;
  padding: 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.btn-pick {
  background: #192030;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
}
.btn-revert {
  background: rgba(232, 179, 75, 0.15);
  border: 1px solid rgba(232, 179, 75, 0.35);
  color: #f0be5b;
}

/* Callout on the left inside the window */
.overlay-callout {
  position: absolute;
  left: 60px;
  bottom: 80px;
  width: 440px;
  background: rgba(15, 19, 29, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.7);
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 10;
}
.oc-title { font-size: 16px; font-weight: 700; color: #ffffff; }
.oc-list { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #cbd5e1; }
.oc-item { display: flex; align-items: center; gap: 8px; }
.oc-icon { color: #a3c4a0; font-weight: bold; }
</style>
</head>
<body>
  <div class="header">
    <div class="badge badge-amber">Intuitive Controls</div>
    <h1>One click to focus. One click to restore.</h1>
    <p>Everything runs on your machine. No accounts, no backend, no telemetry.</p>
  </div>

  <div class="browser-window">
    <div class="browser-bar">
      <div class="traffic-lights">
        <div class="tl-dot tl-red"></div>
        <div class="tl-dot tl-yellow"></div>
        <div class="tl-dot tl-green"></div>
      </div>
      <div class="address-bar">
        <span class="secure">🔒</span>
        <span class="domain">freebuff.com</span>
        <span>/chat/sse-telemetry-pipeline</span>
      </div>
      <div class="browser-actions">
        <div class="ext-btn-active">
          <img src="data:image/png;base64,${ICON_BASE64}">
          <span style="font-size:11px;font-weight:600;color:#a3c4a0;">FOCUS 23m</span>
        </div>
      </div>
    </div>

    <div class="app-backdrop">
      <div class="app-sidebar">
        <div class="brand-row"><div class="brand-dot"></div><span>freebuff</span></div>
      </div>
      <div class="mock-chat">
        <div class="mock-bubble"></div>
        <div class="mock-bubble-ai"></div>
      </div>
    </div>

    <div class="overlay-callout">
      <div class="oc-title">Complete Focus Freedom</div>
      <div class="oc-list">
        <div class="oc-item"><span class="oc-icon">✓</span> <b>Timed Blocks:</b> 25m, 50m, 90m or until you close Freebuff</div>
        <div class="oc-item"><span class="oc-icon">✓</span> <b>Smart Picker:</b> Click any nuisance element to quiet it locally</div>
        <div class="oc-item"><span class="oc-icon">✓</span> <b>Ethical Model:</b> Ads return in 1 click so free models stay free</div>
      </div>
    </div>

    <div class="popup-anchor">
      <div class="popup-top">
        <div class="pt-brand">
          <img src="data:image/png;base64,${ICON_BASE64}">
          <div>
            <div class="pt-name">Freebuff Focus Mode</div>
            <div class="pt-sub">freebuff.com only</div>
          </div>
        </div>
        <div class="pt-ver">v${VERSION}</div>
      </div>

      <div class="switch-box">
        <div class="sb-left">
          <div class="sb-status">Focusing (23:42)</div>
          <div class="sb-desc">Distractions quieted on this tab</div>
        </div>
        <div class="ios-toggle"><div class="ios-knob"></div></div>
      </div>

      <div class="duration-pills">
        <div class="dp-pill active">25m</div>
        <div class="dp-pill">50m</div>
        <div class="dp-pill">90m</div>
        <div class="dp-pill">Session</div>
      </div>

      <div class="stats-card">
        <div class="sc-num">14</div>
        <div class="sc-text">
          <b>ad slots quieted</b> during this build.<br>
          Supported 28 free turns today.
        </div>
      </div>

      <button class="action-btn btn-pick">
        <span>🎯</span>
        <span>Hide an element with picker</span>
      </button>

      <button class="action-btn btn-revert">
        <span>End focus &amp; restore ads</span>
      </button>

      <div style="font-size:11px;color:#64748b;text-align:center;">
        Unofficial community tool • Ads support free tier
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------- 3. LAYERS SCREENSHOT */
function getHtmlScreenshot3() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${COMMON_CSS}
body {
  width: 1280px;
  height: 800px;
  background: radial-gradient(circle at 50% 0%, #161e2b 0%, #090b10 80%);
  padding: 44px 60px;
  display: flex;
  flex-direction: column;
}
.header {
  text-align: center;
  margin-bottom: 38px;
}
.header h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #ffffff;
  margin-top: 8px;
}
.header p {
  font-size: 15px;
  color: #8c99b2;
  margin-top: 4px;
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
  flex: 1;
}

.layer-card {
  background: #0f131d;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-shadow: 0 15px 40px rgba(0,0,0,0.6);
  position: relative;
  overflow: hidden;
}
.layer-card::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: #9db89a;
}
.lc-amber::before { background: #e8b34b; }
.lc-blue::before { background: #38bdf8; }

.layer-badge {
  font-size: 11px;
  font-weight: 700;
  color: #a3c4a0;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.lc-amber .layer-badge { color: #f0be5b; }
.lc-blue .layer-badge { color: #38bdf8; }

.layer-title {
  font-size: 18px;
  font-weight: 700;
  color: #ffffff;
}
.layer-desc {
  font-size: 13px;
  color: #8c99b2;
  line-height: 1.5;
}

.visual-box {
  flex: 1;
  background: #07090f;
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
}
.vb-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: #111520;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.spec-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  color: #cbd5e1;
}
.spec-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.spec-icon { color: #a3c4a0; }
</style>
</head>
<body>
  <div class="header">
    <div class="badge badge-sage">Architecture</div>
    <h1>Three session-scoped defense layers</h1>
    <p>Engineered to quiet distractions without ever breaking your build</p>
  </div>

  <div class="cards-grid">
    <div class="layer-card">
      <div>
        <div class="layer-badge">Layer 1</div>
        <div class="layer-title">Network Rules (DNR)</div>
      </div>
      <div class="layer-desc">
        Catches ad requests before they leave the tab using Declarative Net Request. Active only while focus is turned on.
      </div>
      <div class="visual-box mono">
        <div class="vb-row">
          <span>ad-auction.js</span>
          <span style="color:#ff5a45;">BLOCKED (DNR)</span>
        </div>
        <div class="vb-row">
          <span>sponsor-track</span>
          <span style="color:#ff5a45;">CANCELLED</span>
        </div>
        <div class="vb-row" style="border-color: rgba(157, 184, 154, 0.3);">
          <span style="color:#a3c4a0;">freebuff.com/stream</span>
          <span style="color:#a3c4a0;">ALLOW (P-100)</span>
        </div>
      </div>
      <div class="spec-list">
        <div class="spec-item"><span class="spec-icon">✓</span> Priority 100 allow rule for builds</div>
        <div class="spec-item"><span class="spec-icon">✓</span> Zero latency overhead</div>
      </div>
    </div>

    <div class="layer-card lc-amber">
      <div>
        <div class="layer-badge">Layer 2</div>
        <div class="layer-title">DOM Dynamic Cleaner</div>
      </div>
      <div class="layer-desc">
        Catches slots injected mid-build while the model is streaming tokens. Collapses ad slots seamlessly with zero layout jump.
      </div>
      <div class="visual-box mono">
        <div class="vb-row">
          <span>Tier A (Known slots)</span>
          <span style="color:#e8b34b;">QUIETED</span>
        </div>
        <div class="vb-row">
          <span>Tier B (Mid-build)</span>
          <span style="color:#e8b34b;">COLLAPSED</span>
        </div>
        <div class="vb-row">
          <span>Tier C (In-product)</span>
          <span style="color:#e8b34b;">DIMMED</span>
        </div>
      </div>
      <div class="spec-list">
        <div class="spec-item"><span class="spec-icon">✓</span> MutationObserver characterData watch</div>
        <div class="spec-item"><span class="spec-icon">✓</span> Real-content safety guard</div>
      </div>
    </div>

    <div class="layer-card lc-blue">
      <div>
        <div class="layer-badge">Layer 3</div>
        <div class="layer-title">Interactive Element Picker</div>
      </div>
      <div class="layer-desc">
        Click any nuisance item to quiet it immediately. Saved locally in your browser and automatically applied in future focus blocks.
      </div>
      <div class="visual-box mono">
        <div class="vb-row">
          <span>Point &amp; click</span>
          <span style="color:#38bdf8;">ACTIVE</span>
        </div>
        <div class="vb-row">
          <span>Targeting selector</span>
          <span style="color:#38bdf8;">LOCAL STORE</span>
        </div>
        <div class="vb-row">
          <span>Reversible</span>
          <span style="color:#38bdf8;">1-CLICK UNDO</span>
        </div>
      </div>
      <div class="spec-list">
        <div class="spec-item"><span class="spec-icon">✓</span> Stored in chrome.storage.sync</div>
        <div class="spec-item"><span class="spec-icon">✓</span> Survives page updates</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------- 4. SCOPE SCREENSHOT */
function getHtmlScreenshot4() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${COMMON_CSS}
body {
  width: 1280px;
  height: 800px;
  background: radial-gradient(circle at 50% 0%, #151a24 0%, #090b10 80%);
  padding: 44px 60px;
  display: flex;
  flex-direction: column;
}
.header {
  text-align: center;
  margin-bottom: 34px;
}
.header h1 {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #ffffff;
  margin-top: 8px;
}
.header p {
  font-size: 15px;
  color: #8c99b2;
  margin-top: 4px;
}

.metrics-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
  margin-bottom: 28px;
}
.metric-box {
  background: #0f131d;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 20px;
  text-align: center;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
}
.mb-num {
  font-size: 32px;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: -0.02em;
}
.mb-label {
  font-size: 13px;
  font-weight: 600;
  color: #a3c4a0;
  margin-top: 4px;
}
.mb-sub {
  font-size: 11px;
  color: #8c99b2;
  margin-top: 2px;
}

.trust-table-wrap {
  background: #0f131d;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 15px 40px rgba(0,0,0,0.6);
  flex: 1;
  display: flex;
  flex-direction: column;
}
.tt-head {
  background: #141824;
  padding: 14px 24px;
  display: grid;
  grid-template-columns: 240px 1fr 140px;
  font-size: 12px;
  font-weight: 600;
  color: #8c99b2;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.tt-row {
  padding: 16px 24px;
  display: grid;
  grid-template-columns: 240px 1fr 140px;
  font-size: 13px;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.tt-cat { font-weight: 600; color: #ffffff; }
.tt-desc { color: #cbd5e1; }
.tt-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}
.tt-pass { color: #a3c4a0; }
</style>
</head>
<body>
  <div class="header">
    <div class="badge badge-sage">Privacy &amp; Security</div>
    <h1>100% Local. Zero telemetry. No accounts.</h1>
    <p>Everything runs on your machine. Your code, prompts and tokens never leave your browser.</p>
  </div>

  <div class="metrics-row">
    <div class="metric-box">
      <div class="mb-num">0 KB</div>
      <div class="mb-label">External Network Calls</div>
      <div class="mb-sub">No analytics or pings</div>
    </div>
    <div class="metric-box">
      <div class="mb-num">1 Host</div>
      <div class="mb-label">Strict Permission Scope</div>
      <div class="mb-sub">freebuff.com only</div>
    </div>
    <div class="metric-box">
      <div class="mb-num">0</div>
      <div class="mb-label">User Accounts Required</div>
      <div class="mb-sub">No registration needed</div>
    </div>
    <div class="metric-box">
      <div class="mb-num">100%</div>
      <div class="mb-label">Local Processing</div>
      <div class="mb-sub">Stored in browser sync</div>
    </div>
  </div>

  <div class="trust-table-wrap">
    <div class="tt-head">
      <div>Security Domain</div>
      <div>Implementation Detail</div>
      <div>Verdict</div>
    </div>
    <div class="tt-row">
      <div class="tt-cat">Host Permissions</div>
      <div class="tt-desc">Limited strictly to *://freebuff.com/* and *://*.freebuff.com/*. Cannot access any other web page.</div>
      <div class="tt-status tt-pass">✓ Isolated</div>
    </div>
    <div class="tt-row">
      <div class="tt-cat">Build Stream Safety</div>
      <div class="tt-desc">Priority-100 allow rule covers all freebuff.com traffic. Code generation streams are never touched.</div>
      <div class="tt-status tt-pass">✓ Guaranteed</div>
    </div>
    <div class="tt-row">
      <div class="tt-cat">Remote Code Policy</div>
      <div class="tt-desc">Contains zero remote scripts or eval(). Fully compliant with Chrome Web Store and Firefox AMO security rules.</div>
      <div class="tt-status tt-pass">✓ Compliant</div>
    </div>
    <div class="tt-row">
      <div class="tt-cat">Reversibility</div>
      <div class="tt-desc">Single-click toggle restores default state. Ads return immediately, supporting free AI models.</div>
      <div class="tt-status tt-pass">✓ Instant</div>
    </div>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------- 5. PROMO 440x280 */
function getHtmlPromo() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${COMMON_CSS}
body {
  width: 440px;
  height: 280px;
  background: radial-gradient(circle at 50% 20%, #1a2230 0%, #090b10 90%);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 24px;
  text-align: center;
}
.promo-icon {
  width: 60px;
  height: 60px;
  margin-bottom: 12px;
  filter: drop-shadow(0 0 16px rgba(157, 184, 154, 0.4));
}
.promo-title {
  font-size: 21px;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: -0.02em;
}
.promo-sub {
  font-size: 13px;
  color: #9db89a;
  font-weight: 600;
  margin-top: 4px;
}
.promo-desc {
  font-size: 11px;
  color: #8c99b2;
  margin-top: 6px;
  max-width: 340px;
  line-height: 1.4;
}
.promo-badges {
  display: flex;
  gap: 6px;
  margin-top: 14px;
}
.pb-chip {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 10px;
  color: #cbd5e1;
}
</style>
</head>
<body>
  <img class="promo-icon" src="data:image/png;base64,${ICON_BASE64}">
  <div class="promo-title">Freebuff Focus Mode</div>
  <div class="promo-sub">Focus when you need it. Support when you don't.</div>
  <div class="promo-desc">Temporary distraction-free blocks for freebuff.com. Ads on by default, local only.</div>
  <div class="promo-badges">
    <div class="pb-chip">⚡ 1-Click Toggle</div>
    <div class="pb-chip">⏱️ 25m Timer</div>
    <div class="pb-chip">🔒 100% Local</div>
  </div>
</body>
</html>`;
}

/* ------------------------------------------------------------- 6. MARQUEE 1400x560 */
function getHtmlMarquee() {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${COMMON_CSS}
body {
  width: 1400px;
  height: 560px;
  background: radial-gradient(circle at 20% 40%, #182230 0%, #090b10 80%);
  display: flex;
  align-items: center;
  padding: 0 80px;
  position: relative;
  overflow: hidden;
}
.left-col {
  width: 680px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  z-index: 2;
}
.marquee-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(157, 184, 154, 0.15);
  border: 1px solid rgba(157, 184, 154, 0.35);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 700;
  color: #a3c4a0;
  width: fit-content;
}
.hero-headline {
  font-size: 46px;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #ffffff;
  line-height: 1.1;
}
.hero-accent {
  color: #e8b34b;
}
.hero-desc {
  font-size: 16px;
  color: #8c99b2;
  line-height: 1.5;
  max-width: 580px;
}
.feature-row {
  display: flex;
  gap: 20px;
  margin-top: 8px;
}
.f-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #cbd5e1;
}
.f-icon { color: #a3c4a0; }

/* Right Mockup */
.right-col {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  position: relative;
}
.mockup-card {
  width: 380px;
  background: #111520;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.8), 0 0 50px rgba(157, 184, 154, 0.2);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  transform: perspective(1000px) rotateY(-8deg) rotateX(4deg);
}
.mc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.mc-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
}
.mc-brand img { width: 26px; height: 26px; }
.mc-switch {
  background: #171d2b;
  border-radius: 10px;
  padding: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.mc-timer {
  font-size: 14px;
  font-weight: 700;
  color: #a3c4a0;
}
.mc-timer-sub {
  font-size: 11px;
  color: #8c99b2;
}
.mc-toggle {
  width: 48px;
  height: 26px;
  background: #9db89a;
  border-radius: 13px;
  position: relative;
}
.mc-knob {
  width: 22px;
  height: 22px;
  background: #ffffff;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  right: 2px;
}
.mc-chips {
  display: flex;
  gap: 6px;
}
.mc-chip {
  flex: 1;
  padding: 6px 0;
  text-align: center;
  background: #171d2b;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: #8c99b2;
}
.mc-chip.active {
  background: rgba(157, 184, 154, 0.2);
  color: #a3c4a0;
  border: 1px solid rgba(157, 184, 154, 0.4);
}
.mc-footer {
  font-size: 11px;
  color: #64748b;
  text-align: center;
}
</style>
</head>
<body>
  <div class="left-col">
    <div class="marquee-badge">
      <img src="data:image/png;base64,${ICON_BASE64}" style="width:16px;height:16px;">
      <span>FREEBUFF FOCUS MODE</span>
    </div>
    <div class="hero-headline">
      Focus when you need it.<br>
      <span class="hero-accent">Support when you do not.</span>
    </div>
    <div class="hero-desc">
      A calm focus companion for freebuff.com. Quiet ad slots and sponsored noise during deep work, then restore everything in one click so free models stay free.
    </div>
    <div class="feature-row">
      <div class="f-item"><span class="f-icon">✓</span> Timed 25m/50m Blocks</div>
      <div class="f-item"><span class="f-icon">✓</span> Zero Build Interference</div>
      <div class="f-item"><span class="f-icon">✓</span> 100% Local &amp; Private</div>
    </div>
  </div>

  <div class="right-col">
    <div class="mockup-card">
      <div class="mc-header">
        <div class="mc-brand">
          <img src="data:image/png;base64,${ICON_BASE64}">
          <span>Freebuff Focus</span>
        </div>
        <span class="badge badge-sage">Active</span>
      </div>
      <div class="mc-switch">
        <div>
          <div class="mc-timer">Focusing (23:42)</div>
          <div class="mc-timer-sub">14 slots quieted on this build</div>
        </div>
        <div class="mc-toggle">
          <div class="mc-knob"></div>
        </div>
      </div>
      <div class="mc-chips">
        <div class="mc-chip active">25m</div>
        <div class="mc-chip">50m</div>
        <div class="mc-chip">90m</div>
        <div class="mc-chip">Session</div>
      </div>
      <div class="mc-footer">
        Unofficial • Local only • v${VERSION}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function buildAllAssets() {
  console.log('[assets] Generating realistic marketing assets with Chrome headless...');

  captureHtml(getHtmlScreenshot1(), 1280, 800, path.join(OUT_DIR, 'screenshot-1-chat-1280x800.png'));
  captureHtml(getHtmlScreenshot2(), 1280, 800, path.join(OUT_DIR, 'screenshot-2-popup-1280x800.png'));
  captureHtml(getHtmlScreenshot3(), 1280, 800, path.join(OUT_DIR, 'screenshot-3-layers-1280x800.png'));
  captureHtml(getHtmlScreenshot4(), 1280, 800, path.join(OUT_DIR, 'screenshot-4-scope-1280x800.png'));
  captureHtml(getHtmlPromo(), 440, 280, path.join(OUT_DIR, 'promo-440x280.png'));
  captureHtml(getHtmlMarquee(), 1400, 560, path.join(OUT_DIR, 'marquee-1400x560.png'));

  console.log('[assets] All 6 store assets successfully generated!');
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  buildAllAssets();
}
