// Load the real client in a real browser and screenshot it. Catches the class
// of bug the other tests can't: runtime errors in the client, broken layout, a
// camera pointed at a wall.
//
//   npm i -D playwright && npx playwright install chromium
//   cd server && node server.js &
//   PORT=8080 node tools/render.mjs
//
// Note: software rendering (SwiftShader) is slow — a single screenshot can take
// a minute or more. Add shots back in one at a time rather than all at once.
import { chromium } from 'playwright';
import fs from 'fs';

const PORT = process.env.PORT || 8099;
const OUT = process.env.OUT || './shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--enable-webgl',
         // the container's egress proxy re-signs TLS, which Chromium won't trust
         '--ignore-certificate-errors'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 }, ignoreHTTPSErrors: true });

const errors = [], logs = [];
page.on('console', m => { logs.push(`${m.type()}: ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: 'load', timeout: 60000 });

// Models preload before the button enables.
await page.waitForFunction(() => document.getElementById('playBtn').textContent === 'Enter World', { timeout: 120000 });
await page.fill('#nameInput', 'Render');
await page.click('#playBtn');
try {
  await page.waitForSelector('#hud', { state: 'visible', timeout: 30000 });
} catch (e) {
  console.log('HUD never appeared. Console log follows:');
  for (const l of logs.slice(-40)) console.log('  ' + l);
  console.log('errors:', errors);
  await page.screenshot({ path: `${OUT}/00-stuck.png` });
  await browser.close(); process.exit(1);
}
await page.waitForTimeout(2500); // let the world build and snapshots arrive

const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 90000, animations: 'disabled' }); console.log('shot:', name); };

await shot('01-world');

// Is anything actually being drawn? Sample the canvas rather than trusting it.
const canvasInfo = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return { ok: false, why: 'no canvas' };
  const g = c.getContext('webgl2') || c.getContext('webgl');
  return { ok: !!g, w: c.width, h: c.height, renderer: g ? g.getParameter(g.VERSION) : null };
});
console.log('canvas:', JSON.stringify(canvasInfo));

// Walk south a little so locomotion runs, then look at the entrance NPC.
await page.keyboard.down('w');
await page.waitForTimeout(1500);
await page.keyboard.up('w');
await page.waitForTimeout(800);
await shot('02-walking');

// Panels
await page.keyboard.press('q');
await page.waitForTimeout(600);
await shot('03-questlog');
await page.keyboard.press('q');
await page.keyboard.press('i');
await page.waitForTimeout(600);
await shot('04-bag');
await page.keyboard.press('i');

// Talk to Warden Alric by driving the client's own dialogue path.
const opened = await page.evaluate(() => {
  if (window.__bk) { window.__bk.openDialogue('alric'); return true; }
  return false;
});
await page.waitForTimeout(900);
await shot('05-dialogue');
console.log('dialogue opened via hook:', opened);

// Quest + world state as the client sees it
const state = await page.evaluate(() => ({
  quests: window.__bk ? {
    available: window.__bk.quests.available.map(q => q.name),
    markers: window.__bk.quests.markers,
  } : null,
  camera: window.__bk ? window.__bk.camera.position.toArray().map(v => +v.toFixed(1)) : null,
  player: window.__bk?.self ? window.__bk.self.mesh.position.toArray().map(v => +v.toFixed(1)) : null,
  centreOfScreen: window.__bk ? window.__bk.pick(0, 0) : null,
  upperScreen: window.__bk ? window.__bk.pick(0, 0.5) : null,
  plates: document.querySelectorAll('#nameplates .plate').length,
  npcMarks: document.querySelectorAll('#npcmarks .npcmark').length,
  poiLabels: document.querySelectorAll('#poilabels .poi').length,
  hp: document.getElementById('hptext')?.textContent,
  lvl: document.getElementById('clevel')?.textContent,
}));
console.log('client state:', JSON.stringify(state, null, 2));

console.log('\nconsole errors:', errors.length);
for (const e of errors.slice(0, 20)) console.log('  ' + e);

await browser.close();
process.exit(errors.length ? 1 : 0);
