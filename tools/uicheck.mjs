// Headless UI assertions against the running client. Unlike tools/render.mjs
// this takes no screenshots — software rendering makes PNG encoding the slow
// part, and everything here is a number we can just read out of the page.
//
//   npm i -D playwright && npx playwright install chromium
//   cd server && node server.js &
//   PORT=8080 node tools/uicheck.mjs

import { chromium } from 'playwright';

const PORT = process.env.PORT || 8080;
let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--enable-webgl',
         // some networks (and CI proxies) re-sign TLS, which Chromium won't trust
         '--ignore-certificate-errors'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, ignoreHTTPSErrors: true });

const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

await page.goto(`http://localhost:${PORT}/?debug=1`, { waitUntil: 'load', timeout: 60000 });
await page.waitForFunction(() => document.getElementById('playBtn').textContent === 'Enter World', { timeout: 180000 });
await page.fill('#nameInput', 'UICheck');
await page.click('#playBtn');
await page.waitForSelector('#hud', { state: 'visible', timeout: 30000 });
await page.waitForTimeout(3500);

console.log('\n--- boot ---');
check('no client-side errors during load', errors.length === 0, errors.slice(0, 3).join(' | '));
check('debug handle attached', await page.evaluate(() => !!window.__bk));

console.log('\n--- spawn camera ---');
const spawn = await page.evaluate(() => ({
  camYaw: null,
  cam: window.__bk.camera.position.toArray().map(v => +v.toFixed(2)),
  player: window.__bk.self.mesh.position.toArray().map(v => +v.toFixed(2)),
  zoneSpawn: window.__bk.zone.spawn,
  centre: window.__bk.pick(0, 0, 3),
}));
// The character spawns facing south (+Z), so the camera belongs north of them
// (a smaller z) and the view should open onto the zone, not the boundary wall.
check('camera sits behind the spawn facing', spawn.cam[2] < spawn.player[2],
  `cam z ${spawn.cam[2]} vs player z ${spawn.player[2]}`);
const centreNames = spawn.centre.map(h => h.name || '(unnamed)');
check('the view opens onto the world, not a wall at point-blank range',
  !spawn.centre.length || spawn.centre[0].dist > 4,
  `nearest ${spawn.centre[0]?.dist ?? 'nothing'} (${centreNames.join(', ')})`);

console.log('\n--- camera collision ---');
// Orbit 180 degrees so the camera swings toward the north boundary wall, which
// is only a few metres behind the spawn point.
const before = await page.evaluate(() => ({ z: window.__bk.camera.position.z, yaw: window.__bk.camYaw }));
const camBefore = before.z;
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(1500);   // ROT is 2.2 rad/s, so ~pi radians
await page.keyboard.up('ArrowLeft');
await page.waitForTimeout(600);
const orbit = await page.evaluate(() => {
  const bk = window.__bk;
  const cam = bk.camera.position, p = bk.self.mesh.position;
  // Is anything solid between the camera and the player?
  const dir = p.clone().setY(1.6).sub(cam).normalize();
  const rc = new bk.THREE.Raycaster(cam.clone(), dir, 0.1, cam.distanceTo(p));
  const blockers = [];
  bk.scene.traverse(o => { if (o.userData && o.userData.camBlocker) blockers.push(o); });
  return {
    yaw: +bk.camYaw.toFixed(2),
    camDist: bk.camDist,
    inside: (() => { let i = false; return i; })(),
    cam: cam.toArray().map(v => +v.toFixed(2)),
    player: p.toArray().map(v => +v.toFixed(2)),
    dist: +cam.distanceTo(p).toFixed(2),
    blockerCount: blockers.length,
    occluded: rc.intersectObjects(blockers, false).length,
  };
});
check('boundary walls are registered as camera blockers', orbit.blockerCount > 0,
  orbit.blockerCount + ' walls');
check('arrow keys orbit the camera', Math.abs(orbit.yaw - before.yaw) > 1,
  `yaw ${before.yaw.toFixed(2)} -> ${orbit.yaw}`);
check('camera swung to the other side', Math.abs(orbit.cam[2] - camBefore) > 5,
  `z ${camBefore.toFixed(1)} -> ${orbit.cam[2]}`);
check('no wall ends up between the camera and the player', orbit.occluded === 0,
  orbit.occluded + ' blocking hits, camera ' + orbit.dist + 'm out');
const maxDist = Math.hypot(orbit.camDist, 2) + 0.5; // orbit radius is measured from 2m up
check('camera never further out than its orbit radius', orbit.dist <= maxDist && orbit.dist >= 2,
  `${orbit.dist}m (max ${maxDist.toFixed(1)})`);

const insideCheck = await page.evaluate(() => {
  const bk = window.__bk, poly = bk.zone.boundary;
  const c = bk.camera.position;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if (((zi > c.z) !== (zj > c.z)) && (c.x < (xj - xi) * (c.z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return { inside, cam: [+c.x.toFixed(1), +c.z.toFixed(1)] };
});
check('camera stays inside the zone boundary', insideCheck.inside, 'camera at ' + insideCheck.cam.join(', '));

console.log('\n--- nameplates ---');
const plates = await page.evaluate(() => {
  const bk = window.__bk;
  const self = bk.self.mesh.position;
  let alive = 0, within = 0;
  for (const [, rec] of bk.entities) {
    if (!rec.data || !rec.data.alive || rec.mesh === bk.self.mesh) continue;
    alive++;
    if (rec.mesh.position.distanceTo(self) <= 45) within++;
  }
  const shown = [...document.querySelectorAll('#nameplates .plate')]
    .filter(el => el.style.display !== 'none').length;
  return { alive, within, shown };
});
check('there are far more mobs in the zone than nearby ones', plates.alive > plates.within,
  `${plates.alive} alive, ${plates.within} within 45m`);
check('only nearby mobs draw a nameplate', plates.shown <= plates.within,
  `${plates.shown} plates shown for ${plates.within} nearby`);

console.log('\n--- panels ---');
await page.keyboard.press('q');
await page.waitForTimeout(400);
check('quest log opens', await page.evaluate(() => getComputedStyle(document.getElementById('questlog')).display === 'block'));
await page.keyboard.press('q');
await page.keyboard.press('i');
await page.waitForTimeout(400);
const bagUi = await page.evaluate(() => ({
  open: getComputedStyle(document.getElementById('bag')).display === 'block',
  slots: document.querySelectorAll('#equipRow .eslot').length,
  stat: document.getElementById('statline').textContent.replace(/\s+/g, ' ').trim(),
  width: document.getElementById('bag').getBoundingClientRect().width,
  overflows: document.getElementById('equipRow').scrollWidth >
             document.getElementById('equipRow').clientWidth + 1,
}));
check('bag opens with three equipment slots', bagUi.open && bagUi.slots === 3, bagUi.slots + ' slots');
check('the equipment row fits its panel', !bagUi.overflows, `panel ${Math.round(bagUi.width)}px`);
check('stat line renders', /Attack/.test(bagUi.stat) && /Defence/.test(bagUi.stat), bagUi.stat);
await page.keyboard.press('i');

console.log('\n--- npc dialogue ---');
const dlg = await page.evaluate(() => {
  window.__bk.openDialogue('alric');
  const el = document.getElementById('dialogue');
  return {
    open: getComputedStyle(el).display === 'block',
    name: document.getElementById('dName').textContent,
    say: document.getElementById('dSay').textContent.slice(0, 60),
    accepts: document.querySelectorAll('#dialogue [data-accept]').length,
    marks: document.querySelectorAll('#npcmarks .npcmark').length,
  };
});
check('dialogue opens for the quest giver', dlg.open && dlg.name === 'Warden Alric', dlg.name);
check('he offers a quest to accept', dlg.accepts > 0, dlg.accepts + ' accept button(s)');
check('he speaks his intro line', dlg.say.length > 10, '"' + dlg.say + '…"');
check('a giver marker is on screen', dlg.marks > 0, dlg.marks + ' marker(s)');

console.log('\n--- after all that ---');
check('still no client-side errors', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
