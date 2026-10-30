import * as passiveHelpers from '../passives.js';
// Real server admission and real spell modules; isolated world/effect sinks.
// This checks every active entry, not complete encounter balance or rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CLASSES, classDef, classStats } from '../balance.js';
import { isSpell, checkCast, costOf, castSpell, mitigate, onLethal } from '../cleric.js';
import { isBardSpell, checkBardCast, castBard, castTimeMult } from '../bard.js';
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const first = source.slice(start, source.indexOf('\n', start));
  return first.endsWith('}') ? first : source.slice(start, source.indexOf('\n}', start) + 2);
}
function fixture(cls, a) {
  const stats = classStats(cls, a.level);
  const p = {id:1,name:'Caster',cls,level:a.level,zoneId:'z',x:0,z:0,yaw:0,alive:true,
    maxHp:stats.hp,hp:Math.floor(stats.hp/3),mana:stats.mana,manaMax:stats.mana,
    rage:stats.rage,rageMax:stats.rage,buffs:{},cooldowns:{},known:new Set([a.id]),combatId:10,
    songHistory:['hymn_of_courage','battle_hymn'],momentum:3};
  if (a.kind==='cleanse') p.dots={poison:{t:20,dps:1},bleed:{t:20,dps:1}};
  if (a.requires) p.buffs[a.requires]={id:a.requires,t:10,since:1};
  const ally={...p,id:2,name:'Ally',x:1,buffs:{},alive:a.kind!=='revive'};
  if(a.kind==='revive') p.friendId=2;
  const m={id:10,name:'Target',x:0,z:2,zoneId:'z',hp:200,maxHp:1000,alive:true,evil:true,debuffs:{},cast:{t:5}};
  const notices=[],events=[],routes=[]; const zone={id:'z'};
  const dist2=(x,z,a,b)=>(x-a)**2+(z-b)**2;
  const ctx={players:new Map([[1,p],[2,ally]]),monsters:new Map([[10,m]]),zoneOf:()=>zone,
    send(_ws,e){if(e.kind==='notice')notices.push(e.text);},broadcast:e=>events.push(e),sendStatus(){},systemChat(){},
    nextId:()=>100,critChance:()=>0,dmgBuff:()=>0,dist2,
    addBuff(t,b){t.buffs[b.id]={...b,t:b.dur};},
    applyHit(_p,t,n){t.hp-=n;if(t.hp<=0)t.alive=false;},interruptMonster(t){t.cast=null;}};
  const box=vm.createContext({...passiveHelpers,classDef,isSpell,isBardSpell,costOf,checkCast,checkBardCast,castTimeMult,
    castSpell(c,p,a){routes.push('cleric');return castSpell(c,p,a);},
    castBard(c,p,a){routes.push('bard');return castBard(c,p,a);},clericCtx:ctx,
    notice(_p,s){notices.push(s);},QUEUE_WINDOW:0.4,queueAbility(){throw Error('unexpected queue');},
    combatTargetOf:()=>ctx.monsters.get(p.combatId),dist2,reachOf:()=>4,ATTACK_RANGE:3,aoeRadius:(_p,a)=>a.radius||3,
    monstersNear:()=>[m],zoneOf:ctx.zoneOf,lineClear:()=>true,
    abilityHit(_p,t){routes.push('fighter-hit');t.hp-=1;return 1;},
    addMomentum(p,n){p.momentum=Math.min(5,(p.momentum||0)+n);},addBuff:ctx.addBuff,
    interruptMonster:ctx.interruptMonster,addThreat(){},retarget(){},taunt(){},
    sendStatus(){},sendAbilities(){},broadcast:ctx.broadcast});
  vm.runInContext(['useAbility','gcdFor','resOf','spendRes','spendCharges'].map(extract).join('\n'),box);
  return {p,ally,m,ctx,zone,box,notices,events,routes,resource:()=>classDef(cls).mana?p.mana:p.rage};
}
for(const [cls,c] of Object.entries(CLASSES)) {
  test(`${cls}: 20 active level 1–20 definitions plus separate passives have unambiguous dispatch`,()=>{
    assert.equal(c.abilities.filter(a=>!a.passive).length,20);
    assert.equal(c.abilities.filter(a=>a.passive).length,cls==='fighter'?1:0);
    assert.equal(new Set(c.abilities.map(a=>a.id)).size,c.abilities.length);
    assert.deepEqual([...new Set(c.abilities.map(a=>a.level))],Array.from({length:20},(_,i)=>i+1));
    for(const a of c.abilities) if(!a.passive) {
      assert.ok(Number.isFinite(a.cost)&&a.cost>=0,a.id);
      if(cls==='cleric')assert.ok(isSpell(a)&&!isBardSpell(a),a.id);
      else if(cls==='bard')assert.ok(isBardSpell(a)&&!isSpell(a),a.id);
      else assert.ok(['melee','execute','cone','aoe','channel','rush','self'].includes(a.kind),a.id);
    }
  });
  for(const a of c.abilities.filter(a=>!a.passive)) {
    test(`${cls}/${a.id}: real unlock pool admits cast and charges exactly once`,()=>{
      const f=fixture(cls,a),before=f.resource();
      assert.ok(a.cost<=before,`${a.id}: cost ${a.cost} exceeds pool ${before}`);
      f.box.useAbility(f.p,a.id);
      assert.deepEqual(f.notices,a.kind==='cleanse'?['You are cleansed.']:[]);
      assert.equal(f.resource(),before-a.cost);
      assert.equal(f.p.cooldowns[a.id],a.cd||0);
      assert.equal(f.events.filter(e=>e.kind==='ability').length,1);
      if(f.p.windup){const fire=f.p.windup.fire; f.p.windup=null;fire();}
      assert.equal(f.resource(),before-a.cost,'resolving windup cannot spend again');
      if(cls==='cleric'||cls==='bard')assert.deepEqual(f.routes,[cls]);
      else if(['melee','execute','cone','aoe'].includes(a.kind))assert.ok(f.routes.includes('fighter-hit'));
      else if(a.kind==='channel')assert.equal(f.p.channel.id,a.id);
      else assert.ok(f.p.buffs[a.buff.id]);
    });
    test(`${cls}/${a.id}: real dispatch rejects unknown/dead/locked/poor/cooldown without spending`,()=>{
      for(const reason of ['unknown','dead','locked','poor','cooldown']){
        if(reason==='locked'&&a.level===1)continue;
        const f=fixture(cls,a);
        if(reason==='unknown')f.p.known.clear();
        if(reason==='dead')f.p.alive=false;
        if(reason==='locked')f.p.level=a.level-1;
        if(reason==='poor'){if(c.mana)f.p.mana=a.cost-1;else f.p.rage=a.cost-1;}
        if(reason==='cooldown')f.p.cooldowns[a.id]=9;
        const before=f.resource();f.box.useAbility(f.p,a.id);
        assert.equal(f.resource(),before,reason);assert.equal(f.events.length,0,reason);assert.equal(f.routes.length,0,reason);
      }
    });
  }
}
test('hostile class abilities reject absent, dead, wrong-zone and distant spell targets before spending',()=>{
  for(const cls of ['cleric','bard'])for(const a of CLASSES[cls].abilities.filter(a=>['holy','turn','note','sonic','lullaby','dirge'].includes(a.kind))){
    for(const reason of ['absent','dead','zone','range']){
      const f=fixture(cls,a);if(reason==='absent')f.ctx.monsters.clear();if(reason==='dead')f.m.alive=false;
      if(reason==='zone')f.m.zoneId='elsewhere';if(reason==='range')f.m.x=10000;
      const before=f.resource();f.box.useAbility(f.p,a.id);assert.equal(f.resource(),before,`${a.id}/${reason}`);assert.equal(f.events.length,0);
    }
  }
});
test('Cleric intervention prevents one lethal hit and ward absorbs actual damage',()=>{
  const a=CLASSES.cleric.abilities.find(a=>a.id==='divine_intervention'),f=fixture('cleric',a);
  f.box.useAbility(f.p,a.id);const lethal=onLethal(f.ctx,f.p,10000);
  assert.equal(lethal,f.p.hp-1);assert.equal(onLethal(f.ctx,f.p,10000),10000);
  const ward=CLASSES.cleric.abilities.find(a=>a.id==='holy_ward');castSpell(f.ctx,f.p,ward);
  const r=mitigate(f.ctx,f.p,20,f.m);assert.equal(r.dmg,0);assert.ok(r.absorbed>0);
});
test('Bard third song replaces oldest on allies and Echo only amplifies the next song',()=>{
  const a=CLASSES.bard.abilities.find(a=>a.id==='echoing_verse'),f=fixture('bard',a);
  const defs=CLASSES.bard.abilities;
  castBard(f.ctx,f.p,a);
  for(const id of ['hymn_of_courage','battle_hymn','blade_rhythm'])castBard(f.ctx,f.p,defs.find(a=>a.id===id));
  assert.deepEqual(f.p.songs,['battle_hymn','blade_rhythm']);
  assert.equal(f.ally.buffs.hymn_of_courage,undefined);
  assert.equal(f.p.buffs.echoing_verse,undefined);
  assert.equal(f.ally.buffs.battle_hymn.charges,10);assert.equal(f.ally.buffs.blade_rhythm.charges,12);
});
test('Cleric targeted heals reject dead or distant allies without spending mana',()=>{
  for(const a of CLASSES.cleric.abilities.filter(a=>['heal','hot','cleanse','ward','mending','barrier','intervention','guardian'].includes(a.kind))){
    for(const reason of ['dead','range']){
      const f=fixture('cleric',a);f.p.friendId=2;
      if(reason==='dead')f.ally.alive=false;else f.ally.x=10000;
      const before=f.resource();f.box.useAbility(f.p,a.id);
      assert.equal(f.resource(),before,`${a.id}/${reason}`);assert.equal(f.events.length,0);
    }
  }
});
test('Cleric revival rejects combat or no fallen ally and restores a valid nearby ally',()=>{
  const a=CLASSES.cleric.abilities.find(a=>a.kind==='revive');
  for(const reason of ['combat','living','range','zone']){
    const f=fixture('cleric',a);
    if(reason==='combat')f.p.combatTimer=5;if(reason==='living')f.ally.alive=true;
    if(reason==='range')f.ally.x=10000;if(reason==='zone')f.ally.zoneId='elsewhere';
    const before=f.resource();f.box.useAbility(f.p,a.id);assert.equal(f.resource(),before,reason);assert.equal(f.events.length,0);
  }
  const f=fixture('cleric',a);f.box.useAbility(f.p,a.id);f.p.windup.fire();
  assert.equal(f.ally.alive,true);assert.equal(f.ally.hp,Math.round(f.ally.maxHp*a.hpPct));
  assert.equal(f.ally.mana,Math.round(f.ally.manaMax*a.resPct));assert.ok(f.ally.buffs.revival_sickness);
});
test('Bard Echo increases exactly one charged song, and Songweave requires two songs',()=>{
  const defs=CLASSES.bard.abilities,a=defs.find(a=>a.id==='echoing_verse'),f=fixture('bard',a);
  castBard(f.ctx,f.p,a);castBard(f.ctx,f.p,defs.find(a=>a.id==='hymn_of_courage'));
  assert.equal(f.ally.buffs.hymn_of_courage.charges,18);
  castBard(f.ctx,f.p,defs.find(a=>a.id==='battle_hymn'));assert.equal(f.ally.buffs.battle_hymn.charges,10);
  const weave=defs.find(a=>a.id==='songweave'),g=fixture('bard',weave);g.p.songHistory=['hymn_of_courage'];
  const before=g.resource();g.box.useAbility(g.p,weave.id);assert.equal(g.resource(),before);assert.equal(g.events.length,0);
});
test('Fighter Momentum passive cannot be activated or charged as an ability',()=>{
  const a=CLASSES.fighter.abilities.find(a=>a.passive),f=fixture('fighter',a),before=f.resource();
  f.box.useAbility(f.p,a.id);assert.equal(f.resource(),before);assert.equal(f.events.length,0);assert.equal(f.p.cooldowns[a.id],undefined);
});
