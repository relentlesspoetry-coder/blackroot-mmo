// Focused level-five legal-loadout quest contract, not fresh-player progression.
// Real authenticated quest/loot loop on the shipped composed Blackroot map.
import assert from 'node:assert/strict';
import { QUESTS } from '../quests.js';
import { runTest, walk, sleep } from './test-fixture.mjs';

await runTest(async f => {
  const s = f.state, q = QUESTS.feathers;
  const held = item => s.bag.items.filter(n => n === item).length;
  const active = () => s.quests.active.find(a => a.id === q.id);
  const giver = s.zone.npcs.find(n => n.id === q.giver);
  assert.equal(s.zone.id, 'blackroot'); assert.equal(s.me.level, 5);
  assert.ok(s.quests.available.some(a => a.id === q.id));
  assert.ok(!s.quests.available.some(a => a.id === 'trail'));
  assert.ok(s.quests.available.some(a => a.id === 'dw_lanterns'), 'current Dark Woods starter quest offered');
  await walk(f, giver.x, giver.z);
  f.send({ t: 'questaccept', id: q.id });
  await f.wait('quest acceptance', active);
  assert.equal(active().objectives.length, q.objectives.length);
  assert.ok(active().objectives.every(o => o.have === 0));
  for (const [type, item, need] of [['chicken', 'Feather', 5], ['cow', 'Cowhide', 2]]) {
    for (let attempt = 0; held(item) < need && attempt < 12; attempt++) {
      const target = await f.wait(`living ${type}`, () => s.snapshot.monsters.filter(m => m.type === type && m.alive)
        .sort((a, b) => Math.hypot(a.x-s.me.x,a.z-s.me.z)-Math.hypot(b.x-s.me.x,b.z-s.me.z))[0], 30000);
      console.log(`Hunting ${type} ${target.id} at ${target.x},${target.z} from ${s.me.x},${s.me.z}`);
      f.send({ t: 'attack', target: target.id });
      // Separate route completion from combat: the large live map's approach can
      // consume the old combined budget before the first swing occurs.
      const seen = s.events.length;
      await f.wait(`${type} approach and first swing`, () => s.events.slice(seen).some(e => e.kind === 'swing' && e.by === s.id && e.target === target.id), 120000);
      let nextPress = 0;
      await f.wait(`${type} death after approach`, () => {
        const mob = s.snapshot.monsters.find(m => m.id === target.id);
        if (!mob?.alive) return true;
        const ability = s.abilities?.list.find(a => a.id === 'heavy_swing');
        const readyAt = (s.abilitiesAt || 0) + 1000 * Math.max(ability?.left || 0, s.abilities?.gcdLeft || 0);
        if (ability?.known && !ability.locked && s.me.rage >= ability.cost && !s.me.windup && !s.me.channel &&
            Date.now() >= Math.max(readyAt, nextPress) && Math.hypot(mob.x-s.me.x,mob.z-s.me.z) <= s.bag.swing.reach) {
          f.send({ t: 'ability', id: ability.id }); nextPress = Date.now() + 1000;
        }
        return false;
      }, 120000);
      const drop = await f.wait(`${item} ground loot`, () => s.snapshot.items.find(i => i.name === item), 3000);
      const before = held(item); f.send({ t: 'pickup', id: drop.id });
      await f.wait(`${item} pickup`, () => held(item) > before, 20000);
    }
    assert.ok(held(item) >= need, `required ${need} ${item}`);
  }
  assert.ok(s.events.some(e => e.kind === 'ability' && e.by === s.id && e.id === 'heavy_swing'), 'known Fighter skill exercised through server protocol');
  await f.wait('quest complete', () => active()?.complete);
  assert.ok(s.events.some(e => e.kind === 'questready' && e.id === q.id));
  assert.ok(Math.hypot(s.me.x-giver.x,s.me.z-giver.z)>15, 'loot collection left giver range');
  f.send({ t: 'questturnin', id: q.id });
  await f.wait('out-of-range turn-in rejected', () => s.events.some(e => e.kind === 'notice' && /in person/.test(e.text)));
  assert.ok(active());
  await walk(f, giver.x, giver.z);
  const gold = s.bag.gold, feather = held('Feather'), xp = s.skills.cls.xp;
  f.send({ t: 'questturnin', id: q.id });
  await f.wait('quest completed and rewards received', () => s.quests.completed.some(a => a.id === q.id) && s.bag.gold === gold + q.reward.gold && s.skills.cls.xp >= xp + q.reward.xp);
  assert.equal(held('Feather'), feather - 5);
  assert.ok(s.quests.available.some(a => a.id === 'trail'));
  f.send({ t: 'questaccept', id: q.id }); await sleep(300);
  assert.ok(!active(), 'completed quest cannot be accepted twice');
}, { prefix: 'Quest', save: { level: 5, inventory: ['Bronze Pickaxe', 'Fishing Rod'], equipment: { weapon: 'Iron Sword' } }, timeout: 600000 });
