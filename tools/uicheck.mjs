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
// Orbit the camera toward the north boundary wall, which is only a few metres
// behind the spawn point.
//
// Don't assert how FAR it turns. Rotation is `camYaw += ROT * dt` with dt
// clamped to 0.05, so under software rendering (~1.5 fps) a held key turns the
// camera about one fifteenth as fast as it would at 60 fps. That clamp is
// deliberate -- it stops large frame gaps from tunnelling movement through
// geometry -- so what matters here is that the input arrives and the camera
// follows the yaw, not the wall-clock rate.
const before = await page.evaluate(() => ({ z: window.__bk.camera.position.z, yaw: window.__bk.camYaw }));
const camBefore = before.z;
// Hold the key until the page has actually rendered some frames. Under
// software rendering a fixed wall-clock hold can span zero frames, and a
// camera that did not move because nothing was drawn is not a bug.
await page.keyboard.down('ArrowLeft');
const startFrames = await page.evaluate(() => window.__bk.frames);
await page.waitForFunction(
  (f) => window.__bk.frames > f + 6, startFrames, { timeout: 30000 }).catch(() => {});
const heldFrames = (await page.evaluate(() => window.__bk.frames)) - startFrames;
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
  // Where the camera sits relative to the player, versus where camYaw says it
  // should sit. A clamped camera is pulled straight in toward the player, so
  // the bearing is preserved even when the distance is not.
  const bearing = Math.atan2(cam.x - p.x, cam.z - p.z);
  let err = Math.abs(bearing - bk.camYaw) % (Math.PI * 2);
  if (err > Math.PI) err = Math.PI * 2 - err;
  return {
    yaw: +bk.camYaw.toFixed(2),
    camDist: bk.camDist,
    bearingError: err,
    clamped: cam.distanceTo(p) < bk.camDist - 1,
    cam: cam.toArray().map(v => +v.toFixed(2)),
    player: p.toArray().map(v => +v.toFixed(2)),
    dist: +cam.distanceTo(p).toFixed(2),
    blockerCount: blockers.length,
    occluded: rc.intersectObjects(blockers, false).length,
  };
});
check('boundary walls are registered as camera blockers', orbit.blockerCount > 0,
  orbit.blockerCount + ' walls');
check('arrow keys reach the camera', Math.abs(orbit.yaw - before.yaw) > 0.05,
  `yaw ${before.yaw.toFixed(2)} -> ${orbit.yaw} over ${heldFrames} rendered frames`);
check('camera position follows the yaw', orbit.bearingError < 0.15,
  `bearing off by ${orbit.bearingError.toFixed(3)} rad` +
  (orbit.clamped ? ' (clamped inside the boundary)' : ''));
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
  skills: document.getElementById('skillline').textContent.replace(/\s+/g, ' ').trim(),
  width: document.getElementById('bag').getBoundingClientRect().width,
}));
check('bag opens', bagUi.open);
check('mining skill line renders', /Mining/.test(bagUi.skills), bagUi.skills);
await page.keyboard.press('i');

console.log('\n--- equipment window ---');
await page.keyboard.press('e');
await page.waitForTimeout(500);
const eq = await page.evaluate(() => {
  const win = document.getElementById('equipwin');
  const cells = [...win.querySelectorAll('.eslot')];
  const r = win.getBoundingClientRect();
  const overflowing = cells.filter(c => {
    const b = c.getBoundingClientRect();
    return b.left < r.left - 1 || b.right > r.right + 1 || b.width < 20;
  });
  return {
    open: getComputedStyle(win).display === 'block',
    slots: cells.length,
    names: cells.map(c => c.dataset.slot),
    labels: cells.map(c => c.querySelector('.lb') && c.querySelector('.lb').textContent).filter(Boolean).length,
    figure: !!win.querySelector('#doll .figure'),
    // Slots must not sit on top of each other now that they are positioned.
    overlaps: (() => {
      const bs = cells.map(c => c.getBoundingClientRect());
      let n = 0;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) n++;
      }
      return n;
    })(),
    // The doll faces the viewer, so the character's left is on the viewer's
    // right: every L slot must sit right of its R counterpart.
    facing: (() => {
      const x = (n) => {
        const el = win.querySelector(`.eslot[data-slot="${n}"]`);
        return el ? el.getBoundingClientRect().left : null;
      };
      const pairs = [['earring_l', 'earring_r'], ['ring_l', 'ring_r']];
      for (const [l, r] of pairs) {
        if (x(l) === null || x(r) === null) return 'missing';
        if (x(l) < x(r)) return `${l} is left of ${r} — doll is back-to-front`;
      }
      return 'ok';
    })(),
    // Head above hands above feet: the arrangement has to read as a body.
    anatomy: (() => {
      const at = (n) => {
        const el = win.querySelector(`.eslot[data-slot="${n}"]`);
        return el ? el.getBoundingClientRect() : null;
      };
      const helmet = at('helmet'), chest = at('chest'), boots = at('boots');
      const gloves = at('gloves'), offhand = at('offhand'), necklace = at('necklace');
      if (!helmet || !chest || !boots || !gloves || !offhand || !necklace) return 'missing';
      const stacked = helmet.top < necklace.top && necklace.top < chest.top && chest.top < boots.top;
      const armed = Math.sign(gloves.left - chest.left) !== Math.sign(offhand.left - chest.left);
      return (stacked && armed) ? 'ok' : 'wrong order';
    })(),
    stats: document.getElementById('equipStats').textContent.replace(/\s+/g, ' ').trim(),
    width: Math.round(r.width),
    onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
    overflowing: overflowing.length,
  };
});
check('equipment window opens on E', eq.open);
check('all fourteen slots are drawn', eq.slots === 14, eq.slots + ' slots');
check('the slots the brief asked for are present',
  ['helmet', 'shoulders', 'chest', 'gloves', 'legs', 'boots', 'cape', 'necklace',
   'earring_l', 'earring_r', 'ring_l', 'ring_r'].every(n => eq.names.includes(n)),
  eq.names.join(', '));
check('a character figure sits behind the slots', eq.figure);
check('no two slots overlap', eq.overlaps === 0, eq.overlaps + ' overlapping pairs');
check('slots are arranged as a body', eq.anatomy === 'ok', eq.anatomy);
check('the doll faces the viewer', eq.facing === 'ok', eq.facing);
check('every slot is labelled', eq.labels === eq.slots, eq.labels + '/' + eq.slots);
check('no slot spills out of the window', eq.overflowing === 0, eq.overflowing + ' overflowing');
check('the window fits on screen', eq.onScreen, eq.width + 'px wide');
check('it totals the bonuses', /Attack/.test(eq.stats) && /Worn/.test(eq.stats), eq.stats);
await page.keyboard.press('e');

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
