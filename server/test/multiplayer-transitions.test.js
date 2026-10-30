import * as passiveHelpers from '../passives.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { WorldStore } from '../persistence.js';

// Execute the real transition implementations without starting a listening server.
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const fn = name => { const i = source.indexOf(`function ${name}(`); return source.slice(i, source.indexOf('\n}', i) + 2); };
function setup() {
  const players = new Map(), graves = new Map();
  const c = vm.createContext({...passiveHelpers, players, graves, monsters: new Map(), RESPAWN_TIME:5, GRAVE_TTL:120, nextId:100,
    send(){}, sendRaw(){}, notice(){}, broadcast(){}, systemChat(){}, sendBag(){}, sendStatus(){},
    emptySlots:()=>({}), gearOf:()=>({}), bagStacks:x=>x, dist2:(x,z,a,b)=>(x-a)**2+(z-b)**2 });
  vm.runInContext([
    section('const trades =', '// ---------------------------------------------------------------------------\n// Duels'),
    section('const duels =', '// ---------------------------------------------------------------------------\n// Sitting down'),
    section('const parties =', '// Who shares a kill:'), fn('killPlayer'), fn('lootGrave')
  ].join('\n'), c);
  const player = id => {
    const p = {id,name:`P${id}`,ws:{readyState:1,OPEN:1},zoneId:'surface',x:0,z:0,y:0,
      alive:true,hp:20,maxHp:100,mana:2,manaMax:50,rage:9,combatTimer:0,inventory:[`Item${id}`],equipment:{},gold:100};
    players.set(id,p); return p;
  };
  const a=player(1), b=player(2);
  const trade=()=>{c.tradeRequest(a,b.id);c.tradeAccept(b);assert.ok(c.tradeOf(a));};
  const duel=()=>{c.duelChallenge(a,b.id);c.duelAccept(b);assert.ok(c.duelOf(a));};
  return {c,players,graves,player,a,b,trade,duel};
}
const invalidTrades = {
  zone:p=>{p.zoneId='cave';}, range:p=>{p.x=100;}, dead:p=>{p.alive=false;},
  socket:p=>{p.ws.readyState=3;}, missingSocket:p=>{p.ws=null;}, lingering:p=>{p.lingerT=5;},
  duel:(p,c)=>{vm.runInContext('duels.set(99,{id:99})',c);p.duelId=99;}
};
for (const [name, invalidate] of Object.entries(invalidTrades)) {
  test(`trade rejects stale acceptance: ${name}`,()=>{
    const {c,a,b}=setup();c.tradeRequest(a,b.id);invalidate(a,c);c.tradeAccept(b);
    assert.equal(c.tradeOf(a),null);assert.equal(c.tradeOf(b),null);
  });
  test(`trade revalidates final confirmation and refunds once: ${name}`,()=>{
    const {c,a,b,trade}=setup();trade();c.tradeAdd(a,'Item1');c.tradeAdd(b,'Item2');c.tradeGold(a,40);c.tradeGold(b,20);
    c.tradeOk(a,true);invalidate(a,c);c.tradeOk(b,true);c.stepTrades();c.tradeOk(b,true);
    assert.deepEqual([...a.inventory],['Item1']);assert.deepEqual([...b.inventory],['Item2']);
    assert.equal(a.gold,100);assert.equal(b.gold,100);assert.equal(c.tradeOf(a),null);
  });
}
test('ordinary trade within break range completes exactly once',()=>{
  const {c,a,b,trade}=setup();trade();c.tradeAdd(a,'Item1');c.tradeGold(a,40);b.x=15;
  c.tradeOk(a,true);c.tradeOk(b,true);c.tradeOk(b,true);
  assert.equal(a.inventory.length,0);assert.deepEqual([...b.inventory],['Item2','Item1']);assert.equal(a.gold,60);assert.equal(b.gold,140);
});
test('death moves escrow into the grave, keeps gold, and refunds survivor once',()=>{
  for(const victimId of [1,2]) {
    const {c,a,b,graves,trade}=setup();trade();
    c.tradeAdd(a,'Item1');c.tradeAdd(b,'Item2');c.tradeGold(a,40);c.tradeGold(b,20);
    const dead=victimId===1?a:b, survivor=dead===a?b:a;
    c.killPlayer(dead,'test');c.stepTrades();c.tradeAbort(survivor);
    assert.equal(dead.inventory.length,0);assert.equal(dead.gold,100);assert.equal(survivor.gold,100);
    assert.deepEqual([...survivor.inventory],[`Item${survivor.id}`]);assert.equal(graves.size,1);
    const grave=[...graves.values()][0];assert.deepEqual([...grave.items],[`Item${dead.id}`]);
    // Snapshot round-trip leaves the item in grave ownership, not dead inventory.
    const snapshot=JSON.parse(JSON.stringify({inventory:dead.inventory,grave,gold:dead.gold}));
    assert.equal(snapshot.inventory.length,0);assert.deepEqual(snapshot.grave.items,[`Item${dead.id}`]);
    dead.alive=true;c.lootGrave(dead,grave.id);c.lootGrave(dead,grave.id);
    assert.deepEqual([...dead.inventory],[`Item${dead.id}`]);assert.equal(graves.size,0);
  }
});
const invalidDuels = {
  target:p=>{p.combatId=99;}, timer:p=>{p.combatTimer=4;}, engaged:p=>{p.engagedWith=99;p.engagedT=5;},
  zone:p=>{p.zoneId='cave';}, range:p=>{p.x=25;}, socket:p=>{p.ws.readyState=3;}, missingSocket:p=>{p.ws=null;}, linger:p=>{p.lingerT=5;},
  dead:p=>{p.alive=false;}, trade:(p,c)=>{vm.runInContext('trades.set(99,{id:99})',c);p.tradeId=99;}
};
for(const [name,invalidate] of Object.entries(invalidDuels)) {
  test(`duel rejects stale challenge and cancels countdown without refill: ${name}`,()=>{
    let f=setup();f.c.duelChallenge(f.a,f.b.id);invalidate(f.a,f.c);f.c.duelAccept(f.b);assert.equal(f.c.duelOf(f.a),null);
    f=setup();f.duel();invalidate(f.a,f.c);f.a.swing={kind:'pve'};f.c.stepDuels(4);
    assert.equal(f.c.duelOf(f.a),null);assert.equal(f.a.hp,20);assert.equal(f.a.mana,2);assert.equal(f.a.rage,9);
    assert.equal(f.a.swing.kind,'pve');
    if(name==='timer')assert.equal(f.a.combatTimer,4);
  });
}
test('yield during countdown does not refill either player',()=>{
  const {c,a,b,duel}=setup();duel();c.duelForfeit(b);assert.equal(a.hp,20);assert.equal(a.mana,2);assert.equal(b.hp,20);assert.equal(b.rage,9);
});
test('started duel retains restoration on yield, victory, and disconnect',()=>{
  for(const mode of ['yield','victory','disconnect']) {
    const {c,a,b,duel}=setup();duel();c.stepDuels(3);const d=c.duelOf(a);assert.equal(d.state,'fighting');
    a.hp=1;a.mana=0;a.combatTimer=5;
    if(mode==='yield')c.duelForfeit(a);
    else if(mode==='victory')c.duelEnd(d,b.id);
    else {a.ws.readyState=3;c.duelForfeit(a,'disconnected');}
    assert.equal(a.hp,100);assert.equal(a.mana,50);assert.equal(a.rage,0);assert.equal(a.combatTimer,0);assert.equal(b.hp,100);
  }
});
test('solo invitations cannot add members to an unrelated party',()=>{
  const {c,a,b,player}=setup(), leader=player(3);c.partyInvite(a,b.id);c.partyInvite(leader,a.id);c.partyAccept(a);c.partyAccept(b);
  assert.equal(c.partyOf(a).leader,leader.id);assert.equal(c.partyOf(b),null);
});
test('multiple invitations from a solo leader remain valid after party creation',()=>{
  const {c,a,b,player}=setup(), third=player(3);c.partyInvite(a,b.id);c.partyInvite(a,third.id);c.partyAccept(b);c.partyAccept(third);
  assert.deepEqual([...c.partyOf(a).members],[1,2,3]);
});
test('disband/recreate and leader departure invalidate old invitations',()=>{
  for(const mode of ['disband','leader']) {
    const {c,a,b,player}=setup(),third=player(3),target=player(4),fresh=player(5);
    c.partyInvite(a,b.id);c.partyAccept(b);
    if(mode==='leader'){c.partyInvite(a,third.id);c.partyAccept(third);}
    c.partyInvite(a,target.id);c.partyRemove(a);
    c.partyInvite(a,fresh.id);c.partyAccept(fresh);c.partyAccept(target);
    assert.equal(c.partyOf(target),null);
    if(mode==='leader')assert.equal(c.partyOf(b).leader,b.id);
  }
});
test('party acceptance rechecks capacity',()=>{
  const {c,a,b,player}=setup();const others=[3,4,5,6].map(player);
  c.partyInvite(a,b.id);for(const p of others)c.partyInvite(a,p.id);
  c.partyAccept(b);for(const p of others)c.partyAccept(p);
  assert.equal(c.partyOf(a).members.length,5);assert.equal(c.partyOf(others[3]),null);
});

test('real whole-world checkpoint reload preserves grave and both trade owners after death',()=>{
  const {c,a,b,graves,trade}=setup();
  for(const p of [a,b])Object.assign(p,{yaw:0,known:new Set(),quests:new Map(),questDone:new Set(),
    questFlags:new Set(),questAnnounced:new Set(),openedChests:new Set(),usedObjects:new Set()});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackroot-death-escrow-'));
  try {
    Object.assign(c,{worldStore:new WorldStore(dir),groundItems:new Map(),SAVE_EVERY:45,
      lastOwnership:'',lastCheckpoint:0,checkpointRequested:false});
    vm.runInContext(['serialisePlayer','durablePlayer','ownershipOf','commitWorld'].map(fn).join('\n'),c);
    trade();c.tradeAdd(a,'Item1');c.tradeAdd(b,'Item2');c.tradeGold(a,40);c.tradeGold(b,20);
    c.commitWorld(true);c.killPlayer(a,'test');c.commitWorld(true);
    const restored=new WorldStore(dir).state;
    assert.deepEqual(restored.characters.P1.inventory,[]);assert.deepEqual(restored.characters.P2.inventory,['Item2']);
    assert.equal(restored.characters.P1.gold,100);assert.equal(restored.characters.P2.gold,100);
    assert.equal(restored.graves.length,1);assert.deepEqual(restored.graves[0].items,['Item1']);
    assert.equal(restored.graves[0].name,'P1');assert.equal(restored.graves[0].owner,null);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
