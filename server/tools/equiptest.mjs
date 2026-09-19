// End-to-end check of equipment against a live server.
//   cd server && node server.js &        (or PORT=8099 node server.js &)
//   cd server && node tools/equiptest.mjs
// Proves gear moves real numbers, that the server refuses what it should, and
// that nothing is ever duplicated or destroyed by an equip/unequip swap.

import WebSocket from 'ws';
import { playerDamageRange, mitigate, damageReduction } from '../balance.js';
import { ITEMS, equipStats } from '../items.js';

const PORT = process.env.PORT || 8080;
const ws = new WebSocket(`ws://localhost:${PORT}`);

let me = null, myId = null, snapshot = null;
let bag = { items: [], gold: 0, equipment: {}, stats: { atk: 0, def: 0 } };
const events = [];
let failures = 0;

const send = (o) => ws.send(JSON.stringify(o));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function check(label, cond, detail = '') {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}
const held = (n) => bag.items.filter(i => i === n).length;
const totalOf = (n) => held(n) + Object.values(bag.equipment).filter(v => v === n).length;

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') myId = m.id;
  else if (m.t === 'snapshot') { snapshot = m; me = m.players.find(p => p.id === myId) || me; }
  else if (m.t === 'bag') bag = { items: m.items, gold: m.gold, equipment: m.equipment || {}, stats: m.stats || {} };
  else if (m.t === 'event') events.push(m);
});

ws.on('open', async () => {
  send({ t: 'join', name: 'GearBot' });
  await sleep(900);

  console.log('\n--- maths ---');
  check('defence has diminishing returns',
    damageReduction(4) < damageReduction(10) && damageReduction(10) < 0.35,
    `+4 = ${(damageReduction(4) * 100).toFixed(0)}%, +10 = ${(damageReduction(10) * 100).toFixed(0)}%`);
  check('a landed hit always does at least 1', mitigate(2, 999) === 1);
  check('a miss stays a miss through armour', mitigate(0, 5) === 0);
  const [lo1, hi1] = playerDamageRange(5, 0), [lo2, hi2] = playerDamageRange(5, 7);
  check('a weapon shifts the whole damage roll', lo2 === lo1 + 7 && hi2 === hi1 + 7,
    `${lo1}-${hi1} -> ${lo2}-${hi2}`);

  console.log('\n--- level gating ---');
  // Level 1 character: hand it gear it can't use yet by way of the chest? No —
  // just try to equip something it doesn't hold, then something it can't wear.
  send({ t: 'equip', item: 'Iron Sword' });
  await sleep(400);
  check('cannot equip an item you do not hold', !bag.equipment.weapon);

  console.log('\n--- earn some gear ---');
  // Goblins drop a Bronze Dagger on ~8% of kills and Goblin Mail on ~5%, so
  // waiting on one specific item made this test fail about a third of the time
  // for no reason. Take whichever turns up first.
  const WANTED = ['Bronze Dagger', 'Goblin Mail'];
  const earned = () => WANTED.find(n => held(n) > 0);
  let tries = 0;
  while (!earned() && tries++ < 30) {
    const gobs = (snapshot?.monsters || []).filter(m => m.type === 'goblin' && m.alive);
    if (!gobs.length) { await sleep(400); continue; }
    gobs.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    send({ t: 'attack', target: gobs[0].id });
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      const cur = (snapshot?.monsters || []).find(m => m.id === gobs[0].id);
      if (!cur || !cur.alive) break;
    }
    for (let i = 0; i < 6; i++) {
      const items = (snapshot?.items || []).slice()
        .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
      if (!items.length) break;
      send({ t: 'pickup', id: items[0].id });
      await sleep(800);
    }
  }
  const gear = earned();
  check('a wearable item dropped and was looted', !!gear, (gear || 'nothing') + ' after ' + tries + ' goblins');
  if (!gear) { console.log('\ncannot continue without gear\n'); ws.close(); process.exit(1); }
  const slot = ITEMS[gear].slot;
  const bonusKey = ITEMS[gear].atk ? 'atk' : 'def';

  console.log('\n--- equip ---');
  const beforeBonus = bag.stats[bonusKey] || 0;
  const carried = bag.items.length;
  send({ t: 'equip', item: gear });
  await sleep(500);
  check(`${slot} slot is filled`, bag.equipment[slot] === gear, JSON.stringify(bag.equipment));
  check(`${bonusKey} bonus went up`, (bag.stats[bonusKey] || 0) === beforeBonus + ITEMS[gear][bonusKey],
    `+${beforeBonus} -> +${bag.stats[bonusKey]}`);
  check('it left the bag', bag.items.length === carried - 1, `${carried} -> ${bag.items.length}`);
  check('the item still exists exactly once', totalOf(gear) === 1);
  check('an equip event fired', events.some(e => e.kind === 'equip' && e.item === gear));

  console.log('\n--- gear actually changes the damage dealt ---');
  const dmgSamples = [];
  const onHit = (m) => { if (m.kind === 'hit' && m.by === myId && m.dmg > 0) dmgSamples.push(m.dmg); };
  const seen = events.length;
  let fights = 0;
  while (dmgSamples.length < 8 && fights++ < 8) {
    const gobs = (snapshot?.monsters || []).filter(m => m.type === 'goblin' && m.alive);
    if (!gobs.length) { await sleep(400); continue; }
    gobs.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    send({ t: 'attack', target: gobs[0].id });
    for (let i = 0; i < 30 && dmgSamples.length < 8; i++) {
      await sleep(250);
      for (const e of events.slice(seen)) onHit(e);
      events.length = Math.min(events.length, seen); // keep the window fresh
      const cur = (snapshot?.monsters || []).find(m => m.id === gobs[0].id);
      if (!cur || !cur.alive) break;
    }
  }
  const [expLo, expHi] = playerDamageRange(me.level, bag.stats.atk || 0);
  const outOfRange = dmgSamples.filter(d => d < expLo || d > expHi);
  check('every hit landed inside the geared damage range', dmgSamples.length > 0 && outOfRange.length === 0,
    `${dmgSamples.length} hits in ${expLo}-${expHi} (lv ${me.level}, +${bag.stats.atk} atk)` +
    (outOfRange.length ? ' outliers: ' + outOfRange.join(',') : ''));

  console.log('\n--- swap and unequip ---');
  send({ t: 'unequip', slot });
  await sleep(500);
  check(`${slot} slot is empty again`, !bag.equipment[slot]);
  check('the item came back to the bag', held(gear) === 1);
  check(`${bonusKey} bonus dropped back`, (bag.stats[bonusKey] || 0) === beforeBonus, `+${bag.stats[bonusKey]}`);
  send({ t: 'unequip', slot });
  await sleep(300);
  check('unequipping an empty slot does nothing', totalOf(gear) === 1, totalOf(gear) + ' copies');

  console.log('\n--- selling ---');
  const goldBefore = me.gold;
  send({ t: 'sell', item: gear });   // merchant is far away
  await sleep(500);
  check('cannot sell away from a merchant', held(gear) === 1 && me.gold === goldBefore,
    `gold ${me.gold}`);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  ws.close();
  process.exit(failures === 0 ? 0 : 1);
});

ws.on('error', (e) => { console.error('socket error:', e.message); process.exit(1); });
