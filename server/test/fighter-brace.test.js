import * as passiveHelpers from '../passives.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CLASSES, classDef, classStats, abilityCost, clampClassLevel } from '../balance.js';

import { mitigate, braceDamageMult } from '../cleric.js';
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const first = source.slice(start, source.indexOf('\n', start));
  return first.endsWith('}') ? first : source.slice(start, source.indexOf('\n}', start) + 2);
}
function fixture() {
  const max = classStats('fighter', 20).rage;
  const p = { id:1, cls:'fighter', level:20, alive:true, x:0, z:0, rage:max, rageMax:max,
    buffs:{}, cooldowns:{}, known:new Set(classDef('fighter').abilities.map(a=>a.id)), momentum:5, momentumT:300 };
  const target = {id:2, alive:true, x:0, z:1, hp:1000, maxHp:1000};
  const notices=[], hits=[];
  const c = vm.createContext({...passiveHelpers,classDef,classStats,QUEUE_WINDOW:0.75,DT:0.05,clericCtx:{},
    notice:(_,text)=>notices.push(text),isSpell:()=>false,isBardSpell:()=>false,
    combatTargetOf:()=>target,dist2:(x,z,a,b)=>(x-a)**2+(z-b)**2,reachOf:()=>3,
    castTimeMult:()=>1,abilityHit:(_,t,a,extra)=>{hits.push({id:a.id,extra});t.hp-=10;return 10;},
    addBuff:(t,b)=>{t.buffs[b.id]={...b,t:b.dur};},monstersNear:()=>[target],taunt(){},retarget(){},
    broadcast(){},sendStatus(){},sendAbilities(){},sendPassives(){},send(){},stepHots(){},stepSongs(){},stepQueue(){}});
  vm.runInContext(['queueAbility','useAbility','gcdFor','spendCharges','addMomentum','resOf','spendRes','refundRes','addRage','stepClass'].map(extract).join('\n'),c);
  return {p,target,c,notices,hits};
}

const brace = classDef('fighter').abilities.find(a=>a.id==='brace');
test('Brace spends20 Rage off-GCD without consuming offensive charges',()=>{
  const {p,c}=fixture();p.rage=20;p.gcd=1;
  p.buffs.weapon_flow={id:'weapon_flow',t:30,charges:2,chargeTrigger:'ability',heavyOnly:true};
  c.useAbility(p,'brace');assert.equal(p.rage,0);assert.equal(p.gcd,1);assert.equal(p.cooldowns.brace,30);
  assert.equal(p.buffs.brace.t,4);assert.equal(p.buffs.weapon_flow.charges,2);
});
for(const [name,change] of [['poor',p=>p.rage=19],['cooldown',p=>p.cooldowns.brace=1],['windup',p=>p.windup={t:2}],['channel',p=>p.channel={ticks:3}]]) {
  test(`Brace refuses ${name} without spending or applying protection`,()=>{const {p,c}=fixture();change(p);const rage=p.rage;c.useAbility(p,'brace');assert.equal(p.rage,rage);assert.equal(p.buffs.brace,undefined);});
}
test('Brace reduces direct damage only and expires through real class upkeep',()=>{
  const {p,c}=fixture();c.useAbility(p,'brace');const ctx={zoneOf:()=>({id:'z'})};
  assert.equal(mitigate(ctx,p,100,null).dmg,75);
  assert.equal(mitigate(ctx,p,100,null,{isPeriodic:true}).dmg,100);
  for(let i=0;i<81;i++)c.stepClass(p,false);
  assert.equal(p.buffs.brace,undefined);assert.equal(mitigate(ctx,p,100,null).dmg,100);
});
test('Brace stacks multiplicatively with Cleric and Bard protection before absorption',()=>{
  const {p,c}=fixture();c.useAbility(p,'brace');p.buffs.guardian_prayer={id:'guardian_prayer',t:20,dr:.15,charges:8};
  p.buffs.resonant_shield={id:'resonant_shield',t:20,song:true,dr:.1,charges:6,protect:true,absorb:10};
  const r=mitigate({zoneOf:()=>({id:'z'})},p,100,null);
  assert.equal(r.dmg,47);assert.equal(r.absorbed,10);assert.equal(p.buffs.guardian_prayer.charges,7);assert.equal(p.buffs.resonant_shield.charges,5);
});
test('Brace applies to a direct duel hit without altering duel yield behavior',()=>{
  const {p,c}=fixture();c.useAbility(p,'brace');p.hp=200;p.maxHp=300;
  Object.assign(c,{braceDamageMult,duelOf:()=>({state:'fighting'}),REGEN:{combatLockout:8},DUEL_YIELD:.1,duelEnd(){throw Error('unexpected yield');}});
  vm.runInContext(extract('duelHit'),c);c.duelHit({cls:'fighter'},p,100,false);assert.equal(p.hp,125);
});
test('Brace ends at death, not only after respawn',()=>{
  const {p,c}=fixture();c.useAbility(p,'brace');Object.assign(p,{inventory:[],equipment:{},zoneId:'z'});
  Object.assign(c,{tradeAbort(){},RESPAWN_TIME:5,monsters:new Map(),systemChat(){},send(){}});
  vm.runInContext(extract('killPlayer'),c);c.killPlayer(p,'fell');assert.equal(p.buffs.brace,undefined);assert.equal(p.alive,false);
});
test('Brace trainer purchase survives save reload; temporary protection does not',()=>{
  const {p,c}=fixture();p.level=5;p.known.delete('brace');p.gold=1000;
  const zone={id:'surface',spawn:{x:1,z:1,yaw:0},npcs:[{trainer:'fighter',x:0,z:0}]};
  Object.assign(c,{emptySlots:()=>({}),gearOf:()=>({}),abilityCost,zoneOf:()=>zone,sendBag(){},CLASSES,clampClassLevel,ZONES:{surface:zone},START_ZONE:'surface',ITEMS:{},QUESTS:{},standableAt:()=>true,sanitizeLook:x=>x});
  vm.runInContext(['learnAbility','abilityList','serialisePlayer','applySave'].map(extract).join('\n'),c);
  c.learnAbility(p,'brace');assert.equal(p.gold,1000-abilityCost(brace));assert.ok(p.known.has('brace'));
  assert.equal(c.abilityList(p).find(a=>a.id==='brace').passive,false);
  Object.assign(p,{zoneId:'surface',hp:100,yaw:0,inventory:[],equipment:{},quests:new Map(),questDone:new Set(),questFlags:new Set(),questAnnounced:new Set(),openedChests:new Set(),usedObjects:new Set(),visited:new Set(),fog:{}});
  c.useAbility(p,'brace');const saved=c.serialisePlayer(p);assert.equal(saved.buffs,undefined);
  const q={cls:'fighter',inventory:[],buffs:{}};c.applySave(q,saved);assert.ok(q.known.has('brace'));assert.equal(q.buffs.brace,undefined);
});
test('Brace can fill an action slot while Momentum remains excluded; existing emblem fallback is used',()=>{
  const client=fs.readFileSync(new URL('../../client/index.html',import.meta.url),'utf8');
  const get=name=>{const i=client.indexOf(`function ${name}(`);return client.slice(i,client.indexOf('\n}',i)+2);};
  const box=vm.createContext({...passiveHelpers,abilities:[{id:'momentum',known:true,passive:true},{id:'brace',known:true,passive:false}],barSlots:Array(8).fill(null),loadBar(){},saveBar(){}});
  vm.runInContext("function abilityById(id){return abilities.find(a=>a.id===id)}\n"+get('fillBarDefaults'),box);box.fillBarDefaults();assert.equal(box.barSlots[0],'brace');assert.ok(!box.barSlots.includes('momentum'));
  assert.match(client,/id === 'brace' \? 'ui\/fighter\/emblem.png'/);
  assert.match(client,/brace: 'Brace · 25% less direct damage'/);
  assert.match(get('renderSpellbook'),/active learned/);assert.match(get('renderSpellbook'),/passives equipped/);
});
