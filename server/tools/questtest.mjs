// End-to-end check of the quest loop against a live server.
//   cd server && node server.js &        (or: PORT=8099 node server.js &)
//   cd server && node tools/questtest.mjs
// Joins as a real client, accepts a quest from Warden Alric, kills chickens and
// cows for the drops, picks them up, and hands the quest in. Fails loudly.

import WebSocket from 'ws';

const PORT = process.env.PORT || 8080;
const ws = new WebSocket(`ws://localhost:${PORT}`);

let me = null, myId = null, quests = null, bag = { items: [], gold: 0 };
let snapshot = null;
const log = [];
const events = [];
let failures = 0;

const send = (o) => ws.send(JSON.stringify(o));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function check(label, cond, detail = '') {
  console.log(`${cond ? '  ok  ' : '  FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
}
function countItem(name) { return bag.items.filter(i => i === name).length; }
function activeQuest(id) { return quests?.active.find(q => q.id === id); }
function availableQuest(id) { return quests?.available.find(q => q.id === id); }

ws.on('message', (raw) => {
  const m = JSON.parse(raw);
  if (m.t === 'welcome') { myId = m.id; }
  else if (m.t === 'snapshot') { snapshot = m; me = m.players.find(p => p.id === myId) || me; }
  else if (m.t === 'quests') { quests = m; }
  else if (m.t === 'bag') { bag = { items: m.items, gold: m.gold }; }
  else if (m.t === 'event') { events.push(m); if (/^quest/.test(m.kind)) log.push(`${m.kind}: ${m.name || ''} ${m.text || ''}`); }
});

// Fight the nearest living monster of a type until it dies (server does the work).
async function killNearest(type, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const mons = (snapshot?.monsters || []).filter(m => m.type === type && m.alive);
    if (!mons.length) { await sleep(300); continue; }
    mons.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    const target = mons[0];
    send({ t: 'attack', target: target.id });
    // wait for it to die
    while (Date.now() - t0 < timeoutMs) {
      await sleep(250);
      const cur = (snapshot?.monsters || []).find(m => m.id === target.id);
      if (!cur || !cur.alive) return true;
    }
  }
  return false;
}

// Walk over and grab every ground item within reach.
async function sweepLoot(seconds = 8) {
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const items = snapshot?.items || [];
    if (!items.length) { await sleep(300); continue; }
    items.sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
    send({ t: 'pickup', id: items[0].id });
    await sleep(900);
  }
}

async function walkTo(x, z, seconds = 12) {
  send({ t: 'move', x, z });
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    await sleep(250);
    if (me && Math.hypot(me.x - x, me.z - z) < 2) return true;
  }
  return false;
}

ws.on('open', async () => {
  send({ t: 'join', name: 'QuestBot' });
  await sleep(800);

  console.log('\n--- join ---');
  check('got a player id', myId != null, 'id=' + myId);
  check('got a quest payload', !!quests);
  check('level 1 start', me?.level === 1, 'hp ' + me?.hp + '/' + me?.maxHp);

  console.log('\n--- quest offers at the entrance ---');
  check('"Feathers and Hide" is offered', !!availableQuest('feathers'));
  check('"Thin the Trail" is gated behind it', !availableQuest('trail'));
  check('Alric shows an offer marker', quests?.markers?.alric === 'offer', JSON.stringify(quests?.markers));

  console.log('\n--- no aggressive mob in the spawn ring ---');
  await sleep(600);
  const near = (snapshot?.monsters || []).filter(m =>
    Math.hypot(m.x - 5, m.z + 92) < 30 && !['cow', 'chicken'].includes(m.type));
  check('spawn ring is free of aggressive mobs', near.length === 0,
    near.map(m => `${m.name}@${m.x.toFixed(0)},${m.z.toFixed(0)}`).join(' ') || '0 found');

  console.log('\n--- accept ---');
  send({ t: 'questaccept', id: 'feathers' });
  await sleep(500);
  check('quest is now active', !!activeQuest('feathers'));
  check('it left the available list', !availableQuest('feathers'));
  const obj = activeQuest('feathers')?.objectives || [];
  check('two objectives, both at zero', obj.length === 2 && obj.every(o => o.have === 0),
    obj.map(o => `${o.label} ${o.have}/${o.need}`).join(', '));

  console.log('\n--- farm the objectives ---');
  for (let i = 0; i < 6 && countItem('Feather') < 5; i++) {
    await killNearest('chicken'); await sweepLoot(4);
  }
  check('picked up 5+ feathers', countItem('Feather') >= 5, countItem('Feather') + ' held');
  for (let i = 0; i < 6 && countItem('Cowhide') < 2; i++) {
    await killNearest('cow'); await sweepLoot(5);
  }
  check('picked up 2+ cowhides', countItem('Cowhide') >= 2, countItem('Cowhide') + ' held');

  await sleep(400);
  check('quest reads as complete', !!activeQuest('feathers')?.complete);
  check('a "ready to hand in" event fired', events.some(e => e.kind === 'questready' && e.id === 'feathers'));

  console.log('\n--- turn-in must happen at the giver ---');
  await walkTo(-30, -40, 14); // walk well away from Alric
  send({ t: 'questturnin', id: 'feathers' });
  await sleep(600);
  check('refused while away from the giver', !!activeQuest('feathers'),
    'distance ' + Math.hypot(me.x - 11, me.z + 88).toFixed(1));

  await walkTo(11, -86, 20);
  const goldBefore = me.gold, xpBefore = me.xp, feathersBefore = countItem('Feather');
  send({ t: 'questturnin', id: 'feathers' });
  await sleep(900);

  console.log('\n--- rewards ---');
  check('quest moved to completed', quests.completed.some(q => q.id === 'feathers'));
  check('gold paid out (+30)', me.gold === goldBefore + 30, `${goldBefore} -> ${me.gold}`);
  check('xp awarded', me.xp > xpBefore || me.level > 1, `${xpBefore} -> ${me.xp} (lv ${me.level})`);
  check('quest items consumed', countItem('Feather') === feathersBefore - 5,
    `${feathersBefore} -> ${countItem('Feather')}`);
  check('follow-up quest unlocked', !!availableQuest('trail'));
  check('cannot re-accept a finished quest', !availableQuest('feathers'));

  console.log('\n--- quest log messages seen ---');
  for (const l of log.slice(0, 12)) console.log('   ' + l);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}\n`);
  ws.close();
  process.exit(failures === 0 ? 0 : 1);
});

ws.on('error', (e) => { console.error('socket error:', e.message); process.exit(1); });
