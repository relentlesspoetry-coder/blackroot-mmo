// End-to-end check of mining against a live server.
//   cd server && node server.js &
//   cd server && node tools/miningtest.mjs
// Walks to a real vein, mines it, and checks the ore, the xp, the depletion and
// the respawn. Also checks the things a player would try to cheat.

import WebSocket from 'ws';
import { ORES, miningLevelFromXp, swingChance, PICKAXES } from '../mining.js';

const PORT = process.env.PORT || 8080;
const ws = new WebSocket(`ws://localhost:${PORT}`);

let me = null, myId = null, zone = null, snapshot = null;
let bag = { items: [], gold: 0, equipment: {} };
let skills = null;
const events = [];
let failures = 0;

const send = (o) => ws.send(JSON.stringify(o));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function check(label, cond, detail = '') {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}
const held = (n) => bag.items.filter(i => i === n).length;

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') { myId = m.id; zone = m.zone; }
  else if (m.t === 'transition') zone = m.zone;
  else if (m.t === 'snapshot') { snapshot = m; me = m.players.find(p => p.id === myId) || me; }
  else if (m.t === 'bag') bag = { items: m.items, gold: m.gold, equipment: m.equipment || {} };
  else if (m.t === 'skills') skills = m;
  else if (m.t === 'event') events.push(m);
});

const veinsOf = (oreName) => (zone.scatter || [])
  .filter(o => o.m === oreName + '_Ore_Vein')
  .map(o => ({ id: o.i, x: o.x, z: o.z }));

async function walkTo(x, z, seconds = 30) {
  send({ t: 'move', x, z });
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(300);
    if (me && Math.hypot(me.x - x, me.z - z) < 3) return true;
    send({ t: 'move', x, z });
  }
  return false;
}

ws.on('open', async () => {
  send({ t: 'join', name: 'MinerBot' });
  await sleep(1200);

  console.log('\n--- a new character can mine ---');
  check('starts with a pickaxe', held('Bronze Pickaxe') === 1, bag.items.join(', '));
  check('starts at Mining level 1', skills?.mining?.level === 1, JSON.stringify(skills?.mining));
  check('the server reports which pickaxe is in use', skills?.mining?.pick === 'Bronze Pickaxe');

  console.log('\n--- there is surface ore to start on ---');
  const copper = veinsOf('Copper'), tin = veinsOf('Tin'), iron = veinsOf('Iron');
  check('copper and tin are above ground', copper.length > 0 && tin.length > 0,
    `${copper.length} copper, ${tin.length} tin, ${iron.length} iron`);
  const ids = (zone.scatter || []).map(o => o.i);
  check('every placement has a unique id', new Set(ids).size === ids.length, ids.length + ' placements');

  console.log('\n--- mine a copper vein ---');
  // Pick the vein nearest spawn so the walk is short, and let the server do the
  // walking -- 'mine' is a click-to-interact, exactly like attacking.
  copper.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
  const vein = copper[0];
  const xpBefore = skills.mining.xp;
  send({ t: 'mine', id: vein.id });
  let arrived = false;
  for (let i = 0; i < 60 && !arrived; i++) {
    await sleep(400);
    arrived = Math.hypot(me.x - vein.x, me.z - vein.z) <= 3.6;
  }
  check('the server walked us to the vein', arrived,
    `${Math.hypot(me.x - vein.x, me.z - vein.z).toFixed(1)}m from it`);
  // Copper is a 28% roll per 2.4s swing, so a short window fails by chance
  // roughly once in seventy runs. Wait long enough that a failure means
  // something is actually broken, and report swings separately so an unlucky
  // run is distinguishable from a dead one.
  let mined = null, swings = 0;
  for (let i = 0; i < 160 && !mined; i++) {
    await sleep(400);
    swings = events.filter(e => e.kind === 'mineswing' && e.id === vein.id).length;
    mined = events.find(e => e.kind === 'mined' && e.id === vein.id);
  }
  check('the pickaxe is swinging', swings > 0, swings + ' swings');
  check('the vein gave up ore', !!mined,
    mined ? `${mined.item} for ${mined.xp} xp after ${swings} swings` : `nothing in ${swings} swings`);
  if (!mined) { console.log('\ncannot continue\n'); ws.close(); process.exit(1); }
  check('the ore is in the bag', held('Copper Ore') >= 1, held('Copper Ore') + ' held');
  check('mining xp was awarded', skills.mining.xp === xpBefore + ORES.Copper.xp,
    `${xpBefore} -> ${skills.mining.xp}`);
  check('swings were reported for the animation', swings > 0, swings + ' swings');

  console.log('\n--- the vein depletes, then comes back ---');
  await sleep(600);
  check('the vein reads as depleted', (snapshot.depleted || []).includes(vein.id),
    'depleted: [' + (snapshot.depleted || []).join(',') + ']');
  send({ t: 'mine', id: vein.id });
  await sleep(1500);
  const minedAgain = events.filter(e => e.kind === 'mined' && e.id === vein.id).length;
  check('a depleted vein cannot be mined', minedAgain === 1, minedAgain + ' ore from one vein');

  console.log(`  ... waiting ${ORES.Copper.respawn}s for respawn`);
  await sleep((ORES.Copper.respawn + 3) * 1000);
  check('the vein came back', !(snapshot.depleted || []).includes(vein.id),
    'depleted: [' + (snapshot.depleted || []).join(',') + ']');

  console.log('\n--- level gates hold ---');
  const ironVein = iron[0];
  if (ironVein) {
    // No need to travel: the refusal comes back on the click.
    events.length = 0;
    send({ t: 'mine', id: ironVein.id });
    await sleep(4000);
    const got = events.find(e => e.kind === 'mined');
    const refused = events.find(e => e.kind === 'notice' && /Mining level/.test(e.text || ''));
    check('iron is refused at Mining level 1', !got && !!refused,
      refused ? refused.text : (got ? 'mined it anyway' : 'no response at all'));
  }

  console.log('\n--- you cannot mine from across the map ---');
  const far = copper.find(c => Math.hypot(c.x - me.x, c.z - me.z) > 25) || copper[copper.length - 1];
  events.length = 0;
  send({ t: 'mine', id: far.id });
  await sleep(900);
  const instant = events.find(e => e.kind === 'mined');
  check('a distant vein is not mined instantly', !instant,
    `vein ${Math.hypot(far.x - me.x, far.z - me.z).toFixed(0)}m away`);

  console.log('\n--- maths matches the server ---');
  const lvl = miningLevelFromXp(skills.mining.xp);
  check('client and server agree on level', lvl.level === skills.mining.level,
    `${lvl.level} vs ${skills.mining.level}`);
  check('a level-1 miner has a real chance on copper',
    swingChance('Copper', 1, PICKAXES['Bronze Pickaxe'].power) > 0.2,
    (swingChance('Copper', 1, PICKAXES['Bronze Pickaxe'].power) * 100).toFixed(0) + '%');
  check('a level-1 miner has no chance on runite',
    swingChance('Runite', 1, PICKAXES['Bronze Pickaxe'].power) === 0);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  ws.close();
  process.exit(failures === 0 ? 0 : 1);
});

ws.on('error', (e) => { console.error('socket error:', e.message); process.exit(1); });
