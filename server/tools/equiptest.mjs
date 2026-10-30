// Deterministic inventory fixture, real login and equip/combat protocol. No rare-drop lottery.
import assert from 'node:assert/strict';
import { classStats, mitigate, damageReduction } from '../balance.js';
import { weaponProfile, swingBand, swingSeconds } from '../combat.js';
import { ITEMS, SLOTS, slotsFor } from '../items.js';
import { runTest, sleep } from './test-fixture.mjs';

await runTest(async f => {
  const s = f.state, gear = 'Bronze Dagger';
  const held = n => s.bag.items.filter(i => i === n).length;
  const total = n => held(n) + Object.values(s.bag.equipment).filter(i => i === n).length;
  assert.equal(Object.keys(s.bag.slots).length, SLOTS.length);
  assert.equal(slotsFor('ring').length, 2); assert.equal(slotsFor('earring').length, 2);
  assert.equal(mitigate(0, 5), 0); assert.equal(mitigate(2, 999), 1);
  assert.ok(damageReduction(4) < damageReduction(10));
  assert.equal(held(gear), 1, 'saved fixture loaded');
  f.send({ t: 'equip', item: 'Iron Sword' }); await sleep(300);
  assert.ok(!s.bag.equipment.weapon, 'unheld gear refused');
  f.send({ t: 'equip', item: gear });
  await f.wait('dagger equipped', () => s.bag.equipment.weapon === gear);
  assert.equal(total(gear), 1); assert.equal(held(gear), 0);
  assert.equal(s.bag.stats.atk, ITEMS[gear].atk);
  const profile = weaponProfile(gear), cs = classStats(s.me.cls || 'fighter', s.me.level);
  const band = swingBand(profile, cs.str, s.bag.stats.atk);
  assert.deepEqual([s.bag.swing.lo, s.bag.swing.hi], band, 'server sheet uses class + weapon swing band');
  assert.equal(s.bag.swing.sec, +swingSeconds(profile).toFixed(1));
  // A level-one passive chicken has no armour/block/glance against this Fighter.
  // Record each observed event once; distinguish crits from normal landed hits.
  const target = s.snapshot.monsters.filter(m => m.type === 'chicken' && m.level === 1 && m.alive)
    .sort((a,b)=>Math.hypot(a.x-s.me.x,a.z-s.me.z)-Math.hypot(b.x-s.me.x,b.z-s.me.z))[0];
  assert.ok(target, 'current starter chicken exists');
  f.send({ t: 'attack', target: target.id });
  await f.wait('real geared hit', () => s.events.some(e => e.kind === 'hit' && e.by === s.id && e.dmg > 0), 60000);
  const hits = s.events.filter(e => e.kind === 'hit' && e.by === s.id && e.dmg > 0);
  for (const h of hits) {
    const mult = h.crit ? 2 : 1;
    assert.ok(h.dmg >= band[0]*mult && h.dmg <= band[1]*mult, `hit ${h.dmg} within ${band} x ${mult}`);
  }
  f.send({ t: 'move', x: s.me.x, z: s.me.z });
  f.send({ t: 'unequip', slot: 'weapon' });
  await f.wait('dagger returned', () => !s.bag.equipment.weapon && held(gear) === 1);
  assert.equal(total(gear), 1); assert.equal(s.bag.stats.atk, 0);
  f.send({ t: 'unequip', slot: 'weapon' }); await sleep(300); assert.equal(total(gear), 1);
  const gold = s.bag.gold; f.send({ t: 'sell', item: gear }); await sleep(300);
  assert.equal(held(gear), 1, 'remote sale refused'); assert.equal(s.bag.gold, gold);
}, { prefix: 'Gear', save: { inventory: ['Bronze Dagger', 'Bronze Pickaxe', 'Fishing Rod'] }, timeout: 120000 });
