// Headless check of the client's procedural animation, run against the real
// GLB files. It pulls the actual functions out of client/index.html rather
// than a copy, so this can't drift from what ships.
//   cd server && node tools/animtest.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');

let failures = 0;
function check(label, cond, detail = '') {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}

// --- lift the real source out of the client ---------------------------------
function grab(name, kind = 'function') {
  const re = kind === 'function'
    ? new RegExp(`\\nfunction ${name}\\s*\\([\\s\\S]*?\\n\\}`)
    : new RegExp(`\\nconst ${name} = \\{[\\s\\S]*?\\n\\};`);
  const m = html.match(re);
  if (!m) throw new Error(`could not find ${kind} ${name} in client/index.html`);
  return m[0];
}
const src = [
  html.match(/\nconst MODEL_YAW = .*;/)[0],
  grab('RIG_STYLE', 'const'),
  grab('GAIT', 'const'),
  grab('cloneModel'),
  grab('findByName'),
  grab('buildRig'),
  grab('animateEntity'),
].join('\n');

const LOADED = {};
const make = new Function('THREE', 'LOADED', src + `
  return { cloneModel, buildRig, animateEntity, RIG_STYLE, GAIT };
`);
const api = make(THREE, LOADED);

// --- load the models --------------------------------------------------------
const loader = new GLTFLoader();
const MODELS = ['Male', 'Goblin', 'Bandit', 'Guard', 'Hill_Ogre', 'Spider', 'Cow', 'Chicken',
  'Bat', 'Cave_Spider', 'Venom_Spider', 'Crystal_Spider',
  'Moss_Cave_Giant', 'Crystal_Cave_Giant', 'Cave_Guardian'];
async function load(name) {
  const buf = fs.readFileSync(path.join(ROOT, 'client', 'models', name + '.glb'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((res, rej) => loader.parse(ab, '', g => res(g.scene), rej));
}

console.log('\n--- assets ---');
for (const n of MODELS) LOADED[n] = await load(n);
check('all character models parsed', MODELS.every(n => LOADED[n]));
const rigged = MODELS.filter(n => { let s = false; LOADED[n].traverse(o => { if (o.isSkinnedMesh) s = true; }); return s; });
check('none are skinned (procedural animation is the only option)', rigged.length === 0,
  rigged.length ? 'skinned: ' + rigged.join(', ') : 'confirmed: 0 skinned meshes');

// --- rigs -------------------------------------------------------------------
console.log('\n--- rigs ---');
const STYLE_FOR = { Male: 'biped', Goblin: 'biped', Bandit: 'biped', Guard: 'biped',
  Hill_Ogre: 'ogre', Spider: 'spider', Cow: 'quad', Chicken: 'bird',
  Bat: 'flier', Cave_Spider: 'spider', Venom_Spider: 'spider', Crystal_Spider: 'spider',
  Moss_Cave_Giant: 'biped', Crystal_Cave_Giant: 'biped', Cave_Guardian: 'biped' };
const rigs = {};
for (const n of MODELS) {
  const wrap = api.cloneModel(n, 2.0);
  const rig = api.buildRig(wrap, STYLE_FOR[n]);
  rigs[n] = { wrap, rig };
  check(`${n}: rig built`, !!rig && !!rig.body);
}
check('Spider found all 8 leg nodes', rigs.Spider.rig.legs.length === 8,
  rigs.Spider.rig.legs.length + ' legs');
check('Spider legs split into two alternating groups',
  new Set(rigs.Spider.rig.legs.map(l => l.group)).size === 2 &&
  rigs.Spider.rig.legs.filter(l => l.group === 0).length === 4,
  rigs.Spider.rig.legs.map(l => l.node.name + ':' + l.group).join(' '));
check('Hill Ogre found its club', !!rigs.Hill_Ogre.rig.club, rigs.Hill_Ogre.rig.club?.name);

// --- motion -----------------------------------------------------------------
console.log('\n--- motion ---');
function run(name, { walk = true, frames = 40, dt = 1 / 60, alive = true, kind = 'monster' } = {}) {
  const { wrap, rig } = rigs[name];
  const rec = { mesh: wrap, ax: 0, az: 0 };
  wrap.userData.rig = rig;
  const samples = [];
  for (let i = 0; i < frames; i++) {
    if (walk) { wrap.position.x += 6 * dt; } // 6 m/s
    api.animateEntity(rec, { alive, moving: walk }, kind, dt);
    samples.push({
      y: rig.body.position.y, z: rig.body.position.z,
      rx: rig.body.rotation.x, rz: rig.body.rotation.z,
      legY: rig.legs[0] ? rig.legs[0].node.rotation.y : 0,
      club: rig.club ? rig.club.rotation.x : 0,
    });
  }
  const span = (k) => Math.max(...samples.map(s => s[k])) - Math.min(...samples.map(s => s[k]));
  return { samples, span, rig, wrap, rec };
}

for (const n of MODELS) {
  const w = run(n, { walk: true });
  check(`${n}: bobs while walking`, w.span('y') > 0.01, 'bob range ' + w.span('y').toFixed(3));
  check(`${n}: rolls while walking`, w.span('rz') > 0.005, 'roll range ' + w.span('rz').toFixed(3));
}

// reset and check idle really is quieter than walking
for (const n of MODELS) { rigs[n].rig.amp = 0; rigs[n].rig.speed = 0; rigs[n].wrap.position.set(0, 0, 0); }
const idleGoblin = run('Goblin', { walk: false, frames: 120 });
check('idle motion is much smaller than walking', idleGoblin.span('y') < 0.03,
  'idle bob ' + idleGoblin.span('y').toFixed(4));

console.log('\n--- split models have the parts the animator looks for ---');
for (const n of ['Moss_Cave_Giant', 'Crystal_Cave_Giant', 'Cave_Guardian']) {
  const r = rigs[n].rig;
  check(`${n}: arms and legs found`, !!(r.armL && r.armR && r.legL && r.legR),
    ['armL', 'armR', 'legL', 'legR'].filter(k => r[k]).join(','));
  check(`${n}: weapon is parented to an arm`, !!r.swingArm,
    r.weapon ? (r.swingArm ? r.swingArm.name : 'weapon found but not parented') : 'no weapon');
}
check('Cave_Guardian carries a shield', !!rigs.Cave_Guardian.rig.shield);
check('Bat has both wings', !!(rigs.Bat.rig.wingL && rigs.Bat.rig.wingR));
for (const n of ['Cave_Spider', 'Venom_Spider', 'Crystal_Spider']) {
  check(`${n}: 8 legs found`, rigs[n].rig.legs.length === 8, rigs[n].rig.legs.length + '');
  const offOrigin = rigs[n].rig.legs.filter(l => Math.hypot(l.baseP.x, l.baseP.y, l.baseP.z) > 0.05);
  check(`${n}: legs pivot at the hip, not the body centre`, offOrigin.length === 8,
    offOrigin.length + '/8 off-origin');
}

console.log('\n--- wings actually flap ---');
rigs.Bat.rig.amp = 0; rigs.Bat.rig.speed = 0;
{
  const { wrap, rig } = rigs.Bat;
  wrap.userData.rig = rig;
  const rec = { mesh: wrap, ax: 0, az: 0 };
  const zs = [], ys = [];
  for (let i = 0; i < 60; i++) {
    wrap.position.x += 5 / 60;
    api.animateEntity(rec, { alive: true, moving: true }, 'monster', 1 / 60);
    zs.push(rig.wingL.rotation.z); ys.push(rig.body.position.y);
  }
  const span = Math.max(...zs) - Math.min(...zs);
  check('wings beat through a wide arc', span > 0.7, 'arc ' + span.toFixed(2) + ' rad');
  check('wings beat in opposition', Math.sign(rig.wingL.rotation.z) !== Math.sign(rig.wingR.rotation.z),
    `L ${rig.wingL.rotation.z.toFixed(2)} / R ${rig.wingR.rotation.z.toFixed(2)}`);
  check('the body rides the wingbeat', Math.max(...ys) - Math.min(...ys) > 0.05,
    'bob ' + (Math.max(...ys) - Math.min(...ys)).toFixed(3));
}

console.log('\n--- giants stride and swing ---');
for (const n of ['Moss_Cave_Giant', 'Cave_Guardian']) {
  const { wrap, rig } = rigs[n];
  rig.amp = 0; rig.speed = 0; rig.atk = 0;
  wrap.userData.rig = rig;
  const rec = { mesh: wrap, ax: wrap.position.x, az: wrap.position.z };
  const legs = [], arms = [];
  for (let i = 0; i < 70; i++) {
    wrap.position.x += 4 / 60;
    api.animateEntity(rec, { alive: true, moving: true }, 'monster', 1 / 60);
    legs.push(rig.legL.rotation.x); arms.push(rig.armL.rotation.x);
  }
  const legSpan = Math.max(...legs) - Math.min(...legs);
  check(`${n}: legs stride`, legSpan > 0.3, 'stride ' + legSpan.toFixed(2) + ' rad');
  check(`${n}: arms counter-swing the legs`,
    Math.sign(rig.legL.rotation.x) !== Math.sign(rig.armL.rotation.x) ||
    Math.abs(rig.legL.rotation.x) < 0.02,
    `leg ${rig.legL.rotation.x.toFixed(2)} arm ${rig.armL.rotation.x.toFixed(2)}`);

  // now swing the weapon
  rig.atk = 1;
  const swing = [];
  const wpos = new THREE.Vector3();
  wrap.updateMatrixWorld(true);
  const before = rig.weapon.getWorldPosition(new THREE.Vector3()).clone();
  // Track the furthest the weapon gets during the swing. Measuring only the
  // final frame reports nothing: by then the arm has already returned to rest.
  let peak = 0;
  for (let i = 0; i < 24; i++) {
    api.animateEntity(rec, { alive: true, moving: false }, 'monster', 1 / 60);
    wrap.updateMatrixWorld(true);
    swing.push(rig.swingArm.rotation.x);
    rig.weapon.getWorldPosition(wpos);
    peak = Math.max(peak, before.distanceTo(wpos));
  }
  const arc = Math.max(...swing) - Math.min(...swing);
  check(`${n}: weapon arm swings overhead`, arc > 1.2, 'arc ' + arc.toFixed(2) + ' rad');
  check(`${n}: the weapon travels with the arm`, peak > 0.5,
    'weapon swept ' + peak.toFixed(2) + ' units');
  check(`${n}: the weapon returns to rest`, before.distanceTo(wpos) < 0.15,
    'ends ' + before.distanceTo(wpos).toFixed(3) + ' from rest');
}

console.log('\n--- spider legs & ogre club ---');
rigs.Spider.rig.amp = 0; rigs.Spider.rig.speed = 0;
const sp = run('Spider', { walk: true, frames: 60 });
check('spider legs sweep', sp.span('legY') > 0.05, 'sweep ' + sp.span('legY').toFixed(3));
const legs = rigs.Spider.rig.legs;
const g0 = legs.find(l => l.group === 0), g1 = legs.find(l => l.group === 1);
check('opposite tripods are out of phase',
  Math.sign(g0.node.rotation.y - g0.baseY) !== Math.sign(g1.node.rotation.y - g1.baseY),
  `${(g0.node.rotation.y - g0.baseY).toFixed(3)} vs ${(g1.node.rotation.y - g1.baseY).toFixed(3)}`);

console.log('\n--- attack & death ---');
rigs.Hill_Ogre.rig.atk = 1;
const atk = run('Hill_Ogre', { walk: false, frames: 24 });
check('attack lunges the body forward (-Z is forward)', Math.min(...atk.samples.map(s => s.z)) < -0.1,
  'max lunge ' + Math.min(...atk.samples.map(s => s.z)).toFixed(3));
check('attack swings the ogre club', atk.span('club') > 0.5, 'swing ' + atk.span('club').toFixed(2));
check('lunge settles back to rest', Math.abs(atk.samples.at(-1).z) < 0.02,
  'final z ' + atk.samples.at(-1).z.toFixed(4));

const dead = run('Bandit', { walk: false, frames: 60, alive: false });
check('death topples the body over', dead.samples.at(-1).rx < -1.4,
  'final pitch ' + dead.samples.at(-1).rx.toFixed(2) + ' rad');
const revived = run('Bandit', { walk: false, frames: 10, alive: true });
check('respawn resets the corpse pose', Math.abs(revived.samples.at(-1).rx) < 0.2,
  'pitch ' + revived.samples.at(-1).rx.toFixed(3));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
process.exit(failures === 0 ? 0 : 1);
