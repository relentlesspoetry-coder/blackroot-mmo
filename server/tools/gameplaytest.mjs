// Deterministic contracts for the real class modules and server integration functions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { mitigate, afterHit, healPlayer, castSpell, stepHots, resistsDot } from '../cleric.js';
import { castBard, spendSongCharges } from '../bard.js';
import { stepCluckifer, stepHazards } from '../cluckifer.js';
import { classDef } from '../balance.js';
import { resolveAttack } from '../combat.js';
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function extract(name) {
  const start = src.indexOf(`function ${name}(`); assert.ok(start >= 0, name);
  const first = src.slice(start, src.indexOf('\n', start));
  if (first.endsWith('}')) return first;
  return src.slice(start, start + src.slice(start).indexOf('\n}') + 2);
}
function server(names, bindings = {}) {
  const box = vm.createContext({ Math: Object.create(Math), Date, ...bindings });
  vm.runInContext(names.map(extract).join('\n'), box); return box;
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`ok ${passed} - ${name}`); }
const player = (id = 1) => ({ id, cls: 'cleric', level: 20, x: 0, z: 0, zoneId: 'z', hp: 100, maxHp: 1000, alive: true, buffs: {}, cooldowns: {}, known: new Set(), mana: 1000, manaMax: 1000, rage: 200, rageMax: 200 });
function fixture() {
  const p = player(), m = { id: 10, alive: true, hp: 1000, maxHp: 1000, x: 0, z: 2, zoneId: 'z', evil: true }, zone = { id: 'z' }, events = [];
  const ctx = { players: new Map([[p.id, p]]), monsters: new Map([[m.id, m]]), zoneOf: () => zone, broadcast: e => events.push(e), send() {}, sendStatus() {}, systemChat() {}, critChance: () => 0, dmgBuff: () => 0, nextId: () => 100, addBuff(t,b) { t.buffs[b.id] = {...b,t:b.dur}; }, applyHit(p,m,dmg) { m.hp -= dmg; }, interruptMonster(m) { m.cast = null; }, dist2: (x,z,a,b) => (x-a)**2+(z-b)**2, incomingMult: () => 1, hurtPlayer(t,d) { t.hp -= d; }, resolveCollision() {}, navStep() {}, addDot() {}, addSlow() {} };
  p.combatId = m.id; return {p,m,ctx,zone,events};
}
test('damage labels do not determine direct hit semantics; periodic hits preserve charges', () => {
  for (const kind of ['slash','pierce','magic','peck','burn']) {
    const {p,m,ctx} = fixture();
    p.buffs.guardian_prayer = {id:'guardian_prayer',t:30,dr:0.15,charges:8};
    p.buffs.prayer_of_mending = {id:'prayer_of_mending',t:30,charges:5,heal:10,by:p.id,jump:25};
    const box = server(['hurtPlayer'], {clericCtx:ctx, mitigate, afterHit, onLethal:()=>0, monsterDmgMult:()=>1,bardMonsterDmgMult:()=>1, classDef, REGEN:{combatLockout:5}, broadcast:ctx.broadcast, engage(){}, sendStatus(){}, addRage(){}});
    box.hurtPlayer(p,20,m,kind); assert.equal(p.buffs.guardian_prayer.charges,7); assert.equal(p.buffs.prayer_of_mending.charges,4);
    box.hurtPlayer(p,20,m,kind,undefined,{isPeriodic:true}); assert.equal(p.buffs.guardian_prayer.charges,7); assert.equal(p.buffs.prayer_of_mending.charges,4);
  }
});
test('all protected-hit consumers spend only on direct hits, last shield charge still absorbs', () => {
  const {p,m,ctx,zone} = fixture();
  p.buffs = {undead_ward:{id:'undead_ward',t:30,charges:2},divine_intervention:{id:'divine_intervention',t:30,fired:true,dr:0.2,drCharges:3},shield:{id:'shield',t:30,song:true,dr:0.1,protect:true,charges:1,absorb:100}};
  zone._sanct = [{t:30,charges:3,x:0,z:0,r:8,dr:0.1}];
  mitigate(ctx,p,20,m,{isPeriodic:true}); assert.equal(p.buffs.shield.charges,1); assert.equal(zone._sanct[0].charges,3);
  const r = mitigate(ctx,p,20,m); assert.equal(r.dmg,0); assert.ok(r.absorbed>0); assert.equal(p.buffs.shield,undefined); assert.equal(p.buffs.undead_ward.charges,1); assert.equal(p.buffs.divine_intervention.drCharges,2); assert.equal(zone._sanct[0].charges,2);
});
test('poison follows canonical DOT refresh/resistance/death contract alongside bleed', () => {
  const {p,m,ctx} = fixture();
  const box = server(['monsterStrike','addDot'], {MOB_ARCH:{warrior:{dmgType:'slash'}}, resolveAttack:()=>({dmg:12}), incomingMult:()=>1, defenceProfile:()=>({}), addBuff(){}, hurtPlayer(){}, engage(){}, broadcast(){}, resistsDot, clericCtx:ctx});
  p.dots={bleed:{t:5,dps:3,acc:0}};
  box.monsterStrike(m,p,{poison:6}); assert.equal(p.dots.poison.dps,2); assert.equal(p.dots.poison.t,12); assert.equal(p.dots.bleed.dps,3);
  p.dots.poison.acc=1; box.monsterStrike(m,p,{poison:6}); assert.equal(p.dots.poison.acc,0);
  castSpell(ctx,p,{id:'cleanse',kind:'cleanse',n:1}); assert.equal(p.dots.poison,undefined); assert.ok(p.dots.bleed);
  p.buffs.purified_soul={t:30,charges:2,resist:1}; box.monsterStrike(m,p,{poison:6}); assert.equal(p.dots.poison,undefined); assert.equal(p.buffs.purified_soul.charges,1);
  p.alive=false; box.addDot(p,'poison',12,2); assert.equal(p.dots.poison,undefined);
});
test('canonical poison actually ticks through stepClass and expires', () => {
  const {p,ctx}=fixture(); const hits=[];
  const box=server(['addDot','stepClass'],{resistsDot,clericCtx:ctx,DT:0.05,classDef:()=>({}),classStats:()=>({rage:200,mana:1000}),stepHots(){},stepSongs(){},stepQueue(){},hurtPlayer(...args){hits.push(args)},sendStatus(){}});
  box.addDot(p,'poison',12,2);for(let i=0;i<241;i++)box.stepClass(p,false);
  assert.equal(hits.length,8);assert.equal(hits.reduce((n,a)=>n+a[1],0),24);assert.ok(hits.every(a=>a[3]==='poison'&&a[5].isPeriodic));assert.equal(p.dots.poison,undefined);
  box.addDot(p,'poison',12,2);assert.equal(p.dots.poison.acc,0);
});
test('fighter action charge consumer ignores all friendly defensive/recovery/proc buffs', () => {
  const {p,ctx} = fixture(); const box = server(['spendCharges']);
  for (const id of ['guardian_prayer','prayer_of_mending','recovery','shield','blessed_hands']) p.buffs[id]={id,t:30,charges:8};
  p.buffs.song={id:'song',t:30,charges:8,offensive:true}; p.buffs.flow={id:'flow',t:30,charges:2,chargeTrigger:'ability',heavyOnly:true};
  spendSongCharges(ctx,p,'offensive'); box.spendCharges(p,{heavy:false}); assert.equal(p.buffs.song.charges,7); assert.equal(p.buffs.flow.charges,2);
  box.spendCharges(p,{heavy:true}); assert.equal(p.buffs.flow.charges,1);
  for (const id of ['guardian_prayer','prayer_of_mending','recovery','shield','blessed_hands']) assert.equal(p.buffs[id].charges,8);
  for (const a of classDef('fighter').abilities) if(a.buff?.charges) assert.equal(a.buff.chargeTrigger,'ability');
});
test('multi-target and missed fighter abilities spend own charge once, songs only per landed hit', () => {
  for(const landed of [true,false]) {
    const {p,m,ctx}=fixture();p.cls='fighter';const a=classDef('fighter').abilities.find(a=>a.id==='cleave');p.known.add(a.id);const hits=[m,{...m,id:11},{...m,id:12}];
    p.buffs.own={id:'own',t:30,charges:8,chargeTrigger:'ability'};p.buffs.guardian_prayer={id:'guardian_prayer',t:30,charges:8};p.buffs.song={id:'song',t:30,charges:8,offensive:true};
    const box=server(['useAbility','gcdFor','spendCharges'],{classDef,notice(){},QUEUE_WINDOW:0.4,isSpell:()=>false,isBardSpell:()=>false,resOf:()=>200,combatTargetOf:()=>m,dist2:ctx.dist2,reachOf:()=>5,ATTACK_RANGE:3,aoeRadius:()=>5,monstersNear:()=>hits,abilityHit(){if(landed)spendSongCharges(ctx,p,'offensive');return landed?10:0;},addMomentum(){},spendRes(){},sendStatus(){},sendAbilities(){},broadcast(){},castTimeMult:()=>1});
    box.useAbility(p,a.id);assert.equal(p.buffs.own.charges,7);assert.equal(p.buffs.guardian_prayer.charges,8);assert.equal(p.buffs.song.charges,landed?5:8);
  }
});
test('Bard and Cleric interrupt real target casts; normal attacks leave casts intact', () => {
  for (const [cls,id,cast] of [['bard','dissonant_chord',castBard],['cleric','exorcise_evil',castSpell]]) {
    const {p,m,ctx}=fixture(); p.cls=cls; m.cast={t:10}; const a=classDef(cls).abilities.find(a=>a.id===id); assert.ok(a); cast(ctx,p,a); assert.equal(m.cast,null);
    m.cast={t:10}; cast(ctx,p,{...a,interrupt:false}); assert.deepEqual(m.cast,{t:10});
  }
});
test('Blessed Hands empowers one effective event, not overheal, dead targets, subsequent AoE or HoT recipients', () => {
  const {p,ctx}=fixture(); p.buffs.blessed_hands={t:30,heal:0.3,charges:1}; p.hp=p.maxHp;
  healPlayer(ctx,p,p,100,{crit:false}); assert.ok(p.buffs.blessed_hands);
  const t=player(2);t.alive=false;healPlayer(ctx,p,t,100,{crit:false});assert.ok(p.buffs.blessed_hands);
  p.hp=100;assert.equal(healPlayer(ctx,p,p,100,{crit:false,tick:true}),130);assert.equal(p.buffs.blessed_hands,undefined);assert.equal(healPlayer(ctx,p,p,100,{crit:false}),100);
  p.buffs.blessed_hands={t:30,heal:0.3,charges:1};p.buffs.renewing_prayer={t:30,hot:true,acc:0,tick:1,heal:100,cap:1000,done:0,by:p.id};const hotBefore=p.hp;stepHots(ctx,p,1);assert.equal(p.hp-hotBefore,130);assert.equal(p.buffs.blessed_hands,undefined);
  p.buffs.blessed_hands={t:30,heal:0.3,charges:1};t.alive=true;ctx.players.set(t.id,t);const before=p.hp; castSpell(ctx,p,{id:'test',kind:'aoeheal',radius:10,cap:3,heal:10}); assert.equal(p.buffs.blessed_hands,undefined);assert.ok(p.hp>before);
});
test('off-GCD is usable during GCD, preserves timer, but respects cast/channel commitment', () => {
  const {p,ctx}=fixture();p.cls='bard';const a=classDef('bard').abilities.find(a=>a.id==='echoing_verse');p.known.add(a.id);p.gcd=1.2;let casts=0,queued=0;
  const box=server(['useAbility','gcdFor'], {classDef,notice(){},QUEUE_WINDOW:0.4,queueAbility(){queued++},isSpell:()=>false,isBardSpell:()=>true,checkBardCast:()=>null,resOf:()=>1000,combatTargetOf:()=>null,castBard(){casts++},clericCtx:ctx,spendRes(){},sendStatus(){},sendAbilities(){},broadcast(){},castTimeMult:()=>1});
  box.useAbility(p,a.id);assert.equal(casts,1);assert.equal(p.gcd,1.2);assert.equal(queued,0);
  p.cooldowns[a.id]=0;p.gcd=0.2;box.useAbility(p,a.id);assert.equal(casts,2);assert.equal(p.gcd,0.2);assert.equal(queued,0);
  p.cooldowns[a.id]=0;p.windup={t:1};box.useAbility(p,a.id);assert.equal(casts,2);
});
test('fire egg delayed step survives busy duration; target lifecycle cancels safely', () => {
  for(const ending of ['none','dead','left','disconnected','boss-dead']) {
    const {p,m,ctx,events,zone}=fixture();Object.assign(m,{boss:'cluckifer',cds:{},phase:1,gcd:0,arena:{x:0,z:0,r:26},yaw:0,speed:6});
    for(const id of ['hell_peck','wing','scratch','demon_cluck','chicks','barrage','rush','eggs_of_ruin','roost','chicken_run','peckening','rotten_egg','brood'])m.cds[id]=100;
    stepCluckifer(ctx,m,0.05);assert.ok(m.script);
    for(let i=0;i<21;i++)stepCluckifer(ctx,m,0.05);assert.ok(m.script,'late step retained');assert.ok(events.some(e=>e.fx==='fire_egg'));
    if(ending==='dead')p.alive=false;if(ending==='left')p.zoneId='other';if(ending==='disconnected')ctx.players.delete(p.id);if(ending==='boss-dead')m.alive=false;
    for(let i=0;i<12;i++){ if(!ctx.monsters.has(m.id))break;stepCluckifer(ctx,m,0.05); }
    assert.equal(events.filter(e=>e.fx==='egg_burst').length,ending==='none'?1:0);
    if(ending==='none'){assert.equal(zone._bossHazards.length,1);assert.equal(p.hp,80);}
  }
});
test('every boss mechanic completes every scheduled step, including the ultimate', () => {
  const bossSource=fs.readFileSync(new URL('../cluckifer.js',import.meta.url),'utf8').replace(/export /g,'');
  const box=vm.createContext({Math,Date,console:{error(...args){throw Error(args.join(' '))}}});
  vm.runInContext(bossSource+'\nglobalThis.mechanics=M;',box);
  for(const [name,build] of Object.entries(box.mechanics)) {
    const {p,m,ctx}=fixture();Object.assign(m,{boss:'cluckifer',cds:{},phase:1,gcd:0,arena:{x:0,z:0,r:26},yaw:0,speed:6});
    let next=20;ctx.makeMonster=o=>{const child={id:next++,alive:true,zoneId:o.zoneId,x:o.region.cx,z:o.region.cz,yaw:0};ctx.monsters.set(child.id,child);return child;};
    const sc=build(ctx,m,p);let calls=0;sc.steps=sc.steps.map(s=>({...s,do(){calls++;s.do();}}));box.startScript(m,sc);
    for(let i=0;i<200&&m.script;i++)box.stepCluckifer(ctx,m,0.05);
    assert.equal(m.script,null,name);assert.equal(calls,sc.steps.length,name);
  }
});
test('targeted boss lunge does not follow a departed player while another keeps encounter alive', () => {
  const bossSource=fs.readFileSync(new URL('../cluckifer.js',import.meta.url),'utf8').replace(/export /g,'');const box=vm.createContext({Math,Date,console});vm.runInContext(bossSource+'\nglobalThis.mechanics=M;',box);
  const {p,m,ctx,events}=fixture();Object.assign(m,{cds:{},phase:1,arena:{x:0,z:0,r:26},yaw:0});const other=player(2);ctx.players.set(other.id,other);box.startScript(m,box.mechanics.peckening(ctx,m,p));p.zoneId='other';p.x=1000;
  for(let i=0;i<75&&m.script;i++)box.stepCluckifer(ctx,m,0.05);assert.equal(m.x,0);assert.ok(!events.some(e=>e.fx==='lunge'));
});
test('hazards explicitly mark damage periodic', () => { const {p,ctx,zone}=fixture();zone._bossHazards=[{t:10,x:0,z:0,r:3,dps:5,kind:'fire'}];let args;ctx.hurtPlayer=(...a)=>args=a;stepHazards(ctx,zone,1.5);assert.equal(args[5].isPeriodic,true); });
test('death countdown has one simulation owner and lasts configured five seconds', () => { const box=server(['stepPlayer'],{DT:0.05});const p={alive:false,deathTimer:5};for(let i=0;i<99;i++)box.stepPlayer(p);assert.ok(p.deathTimer>0);box.stepPlayer(p);assert.ok(p.deathTimer<1e-12);assert.ok(!/deathTimer\s*-=\s*0\.25/.test(src)); });
test('injected attack RNG covers damage band as well as attack-table rolls', () => { const old=Math.random;Math.random=()=>{throw Error('global RNG leaked')};try{const a={level:10,band:[5,15],crit:0},d={level:10,dodge:0,parry:0,block:0,facing:false};assert.deepEqual(resolveAttack(a,d,()=>0.9),resolveAttack(a,d,()=>0.9));}finally{Math.random=old;} });
test('class lookup rejects inherited object properties', () => {
  const fallback = classDef(undefined);
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'missing', null]) assert.equal(classDef(id), fallback);
  for (const id of ['fighter', 'cleric', 'bard']) assert.ok(Array.isArray(classDef(id).abilities));
});
console.log(`${passed} gameplay contract tests passed.`);
