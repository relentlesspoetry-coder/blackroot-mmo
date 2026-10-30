import * as passiveHelpers from '../passives.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { classDef, classStats } from '../balance.js';

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
    broadcast(){},sendStatus(){},sendAbilities(){},send(){},stepHots(){},stepSongs(){},stepQueue(){}});
  vm.runInContext(['useAbility','gcdFor','spendCharges','addMomentum','resOf','spendRes','refundRes','addRage','stepClass'].map(extract).join('\n'),c);
  return {p,target,c,notices,hits};
}

test('every Fighter ability is affordable at its real resource cap, including at unlock level',()=>{
  for(const a of classDef('fighter').abilities) {
    if(a.passive)continue;
    assert.ok(a.cost >= 0 && a.cost <= classStats('fighter',a.level).rage,`${a.name}: ${a.cost}`);
  }
  for(const level of [1,17,19,20,99])assert.equal(classStats('fighter',level).rage,100);
});
for(const id of ['titan_chop','berserkers_roar','perfect_masterstroke']) {
  test(`${id} casts at its exact real cost without a free proc`,()=>{
    const {p,c,notices,hits}=fixture(), a=classDef('fighter').abilities.find(a=>a.id===id);
    p.rage=a.cost;c.useAbility(p,id);
    assert.equal(notices.length,0);assert.equal(p.rage,0);assert.equal(p.cooldowns[id],a.cd);
    if(a.windup){assert.equal(hits.length,0);for(let i=0;i<21;i++)c.stepClass(p,false);}
    if(a.kind==='self')assert.ok(p.buffs[a.buff.id]);
    else assert.equal(hits[0].id,id);
    if(id==='perfect_masterstroke'){assert.equal(hits[0].extra.flat,150);assert.equal(p.momentum,0);}
  });
  test(`${id} rejects insufficient Rage without spending, cooldown, buff or damage`,()=>{
    const {p,c,notices,hits}=fixture(), a=classDef('fighter').abilities.find(a=>a.id===id);
    p.rage=a.cost-1;c.useAbility(p,id);
    assert.equal(notices[0],'Not enough rage.');assert.equal(p.rage,a.cost-1);
    assert.equal(p.cooldowns[id],undefined);assert.equal(hits.length,0);assert.equal(p.windup,undefined);
    assert.deepEqual(Object.keys(p.buffs),[]);
  });
}
test('Titan Chop interrupted windup refunds its exact cost without exceeding real cap',()=>{
  const {p,c,hits}=fixture();c.useAbility(p,'titan_chop');assert.equal(p.rage,5);
  p.moving=true;c.stepClass(p,false);assert.equal(p.rage,100);assert.equal(p.windup,null);
  assert.equal(p.cooldowns.titan_chop,0);assert.equal(hits.length,0);
});
test('real Rage generation and refunds never exceed 100',()=>{
  const {p,c}=fixture();p.rage=99;c.addRage(p,50);assert.equal(p.rage,100);
  c.spendRes(p,95);assert.equal(p.rage,5);c.refundRes(p,200);assert.equal(p.rage,100);
  c.stepClass(p,true);assert.equal(p.rage,100);
});
