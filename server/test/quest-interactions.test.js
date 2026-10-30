import * as passiveHelpers from '../passives.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { QUESTS, canStart, recordTalk } from '../quests.js';

// Exercise production interaction guards and the real quest mutation module,
// without starting a world/server or relying on hand-built quest behavior.
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const interactions = source.slice(source.indexOf('function npcFor('), source.indexOf('\nfunction turnInQuest('));
function setup() {
  const messages = [], updates = [], chats = [];
  const zones = { surface: { npcs: [{ id:'pib',x:0,z:0 }, { id:'rowan',x:0,z:0 }] }, cave: { npcs: [] } };
  const c = vm.createContext({...passiveHelpers, QUESTS, canStart, recordTalk, NPC_TALK_RADIUS:10,
    zoneOf:p=>zones[p.zoneId], dist2:(x,z,a,b)=>(x-a)**2+(z-b)**2,
    send:(_,m)=>messages.push(m), sendBag:p=>updates.push('bag'),
    notifyQuestProgress:(p,ids)=>updates.push([...ids]), sendQuests:()=>updates.push('quests'), systemChat:t=>chats.push(t) });
  vm.runInContext(interactions,c);
  const p = { name:'Tester',ws:{},alive:true,zoneId:'surface',x:0,z:0,level:10,
    quests:new Map(),questDone:new Set(),questKills:{},questFlags:new Set(),
    inventory:['Redberry','Redberry','Redberry','Honeycake'] };
  return { c,p,messages,updates,chats };
}
const invalidConversation = {
  dead:p=>{p.alive=false;}, distant:p=>{p.x=99999;p.z=99999;},
  wrongZone:p=>{p.zoneId='cave';}, unknownZone:p=>{p.zoneId='missing';},
  invalidPosition:p=>{p.x=NaN;}
};
for(const [condition,invalidate] of Object.entries(invalidConversation)) {
  test(`quest talk rejects ${condition} without consuming delivery items`,()=>{
    const {c,p,updates}=setup();p.quests.set('dw_pib',true);invalidate(p);
    c.talkToNpc(p,'pib');assert.equal(p.questFlags.size,0);assert.equal(p.inventory.length,4);assert.equal(updates.length,0);
  });
}
test('unknown NPC cannot advance delivery',()=>{
  const {c,p}=setup();p.quests.set('dw_pib',true);c.talkToNpc(p,'missing');
  assert.equal(p.questFlags.size,0);assert.equal(p.inventory.length,4);
});
test('nearby real NPC records conversation and delivery exactly once',()=>{
  const {c,p,updates}=setup();p.quests.set('dw_pib',true);p.x=10;
  c.talkToNpc(p,'pib');assert.equal(p.inventory.length,0);
  assert.ok(p.questFlags.has('talk:pib'));assert.ok(p.questFlags.has('give:dw_pib:pib'));
  assert.equal(updates.length,2);c.talkToNpc(p,'pib');assert.equal(updates.length,2);
});
for(const [condition,invalidate] of Object.entries(invalidConversation)) {
  test(`quest acceptance replies with rejection for ${condition}`,()=>{
    const {c,p,messages}=setup();invalidate(p);c.acceptQuest(p,'dw_lanterns');
    assert.equal(p.quests.size,0);assert.equal(messages.length,1);
    assert.equal(messages[0].t,'quest:accept');assert.equal(messages[0].id,'dw_lanterns');
    assert.equal(messages[0].ok,false);assert.ok(messages[0].reason);
  });
}
test('unavailable and inherited-name quests receive explicit rejection',()=>{
  for(const id of ['missing','toString','__proto__','dw_pib']) {
    const {c,p,messages}=setup();c.acceptQuest(p,id);
    assert.equal(p.quests.size,0);assert.equal(messages[0].ok,false);assert.ok(messages[0].reason);
  }
});
test('valid acceptance is authoritative and duplicate requests cannot duplicate effects',()=>{
  const {c,p,messages,updates,chats}=setup();c.acceptQuest(p,'dw_lanterns');
  assert.equal(p.quests.size,1);assert.equal(messages[0].kind,'questaccepted');
  assert.equal(messages[1].t,'quest:accept');assert.equal(messages[1].ok,true);assert.equal(updates.length,1);
  c.acceptQuest(p,'dw_lanterns');assert.equal(messages.at(-1).ok,false);assert.equal(p.quests.size,1);
  assert.equal(updates.length,1);assert.equal(chats.length,1);
});
test('network dispatch routes talk through validation and dead acceptance through response',()=>{
  assert.match(source,/case 'talk':\s*\{\s*if \(player\) talkToNpc\(player,/);
  assert.match(source,/case 'questaccept': if \(player\) acceptQuest\(player,/);
});
