// Asset-independent browser smoke: production functions wired to a real DOM.
// Run manually: node test/client-browser-smoke.mjs (requires Chromium).
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const source = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
function fn(name) {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  return source.slice(m.index, source.indexOf('\n}', m.index) + 2);
}
const dir = mkdtempSync(join(tmpdir(), 'blackroot-browser-'));
const script = `
let connectionState = 'authenticated', zoneLoading = false, loginTimer = null, ws = null;
let dragging = false, camYaw = 0, jump = { active: false }, keys = {}, casts = 0;
const renderer = { domElement: document.querySelector('canvas') };
const settingsEl = document.getElementById('settings'), chatInput = document.getElementById('chat');
const playBtn = document.getElementById('play'), passInput = document.getElementById('pass');
const EDIT = { on: false }, barSlots = ['ability']; let mapOpen = false;
function useAbility() { casts++; }
function handle() {};
${['gameplayInputBlocked', 'resetGameplayInput', 'addEventListeners', 'connect', 'showLoginError'].map(fn).join('\n')}
const assert = (ok, label) => { if (!ok) throw Error(label); };
const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
try {
  addEventListeners();
  for (const id of ['gold', 'text', 'select', 'editable']) {
    const el = document.getElementById(id); el.focus(); key(el, '1'); key(el, 'w');
    assert(casts === 0 && !keys.w, 'form leaked gameplay: ' + id);
  }
  document.activeElement.blur(); key(document.body, '1'); assert(casts === 1, 'normal ability key missing');
  key(document.body, 'w'); assert(keys.w, 'normal movement missing');
  window.dispatchEvent(new Event('blur')); assert(!keys.w, 'blur did not clear movement');
  const dialog = document.createElement('div'); dialog.setAttribute('aria-modal', 'true'); document.body.append(dialog);
  key(document.body, '1'); assert(casts === 1, 'modal leaked ability'); dialog.remove();
  // A real browser WebSocket to an unavailable local port exercises visible recovery.
  connectionState = 'idle'; playBtn.disabled = true;
  connect('Hero', 'secret', {}, 'fighter');
  const end = performance.now() + 3000;
  const check = () => {
    if (connectionState === 'idle') {
      assert(!playBtn.disabled && document.getElementById('loginErr').textContent.includes('try again'), 'missing transport retry');
      document.getElementById('result').textContent = 'PASS: real DOM form/modal hotkeys, movement blur, refused WebSocket visible retry';
    } else if (performance.now() < end) setTimeout(check, 50);
    else document.getElementById('result').textContent = 'FAIL: transport recovery timeout';
  }; check();
} catch (e) { document.getElementById('result').textContent = 'FAIL: ' + e.stack; }
`;
// file: has no host, so connect's real WebSocket constructor fails visibly.
// Use an explicit unused localhost port for the socket URL, preserving all other production code.
const browserScript = script.replace('`${proto}://${location.host}`', "'ws://127.0.0.1:59999'");
writeFileSync(join(dir, 'smoke.html'), `<!doctype html><body><canvas></canvas><div id="settings"></div><input id="chat"><input id="gold" type="number"><textarea id="text"></textarea><select id="select"><option>One</option></select><div id="editable" contenteditable="true">Edit</div><button id="play">Enter</button><input id="pass"><p id="loginErr"></p><pre id="result">PENDING</pre><script>${browserScript}</script>`);
try {
  const r = spawnSync(process.env.CHROMIUM || '/usr/bin/chromium', [`--user-data-dir=${join(dir, 'profile')}`, '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-proxy-server', '--virtual-time-budget=5000', '--dump-dom', `file://${join(dir, 'smoke.html')}`], { encoding: 'utf8', timeout: 15000 });
  const result = r.stdout?.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
  console.log(result || r.stderr || r.error);
  if (!result?.startsWith('PASS:')) process.exitCode = 1;
} finally { rmSync(dir, { recursive: true, force: true }); }
