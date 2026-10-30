import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { WorldStore } from '../persistence.js';
import * as helpers from '../passives.js';
import { CLASSES, classDef, classStats, clampClassLevel, abilityCost } from '../balance.js';
import { validMessage } from '../protocol.js';
import { costOf, healPlayer, castSpell, mitigate, stepHots, isSpell } from '../cleric.js';
import { castBard, atkSpeedMult, castTimeMult, manaRegenMult, isBardSpell } from '../bard.js';
const { PASSIVES, PASSIVE_LIMIT, sanitizePassives, restorePassives, passiveValue, passiveDirectMult, passiveWeaponMult } = helpers;
const source=fs.readFileSync(new URL('../server.js',import.meta.url),'utf8');
function extract(name){const i=source.indexOf(`function ${name}(`);assert.ok(i>=0,name);if(name==='clearPassiveOwnedEffects')return source.slice(i,source.indexOf('\nfunction setPassives',i));const line=source.slice(i,source.indexOf('\n',i));return line.endsWith('}')?line:source.slice(i,source.indexOf('\n}',i)+2);}
function player(cls='fighter',id=1){const stats=classStats(cls,40);return{id,cls,name:'Test'+id,level:40,alive:true,zoneId:'z',x:0,z:0,ws:{OPEN:1,readyState:1},known:new Set(classDef(cls).abilities.map(a=>a.id)),passives:[],hp:stats.hp/2,maxHp:stats.hp,mana:stats.mana/2,manaMax:stats.mana,rage:20,rageMax:stats.rage,buffs:{},cooldowns:{},dots:{}};}
function fixture(cls='fighter'){
 const p=player(cls),q=player('cleric',2),players=new Map([[1,p],[2,q]]),zone={id:'z'},events=[];
 const c=vm.createContext({...helpers,players,monsters:new Map(),ZONES:{z:zone},duels:new Map(),checkpointRequested:false,
  send:(_,e)=>events.push(e),sendStatus(){},sendAbilities(){},threatOf:(m,id)=>m.threat?.[id]||0,classDef,Math,SWIM_SPEED:.55,songAmp:()=>1,
  swingSeconds:()=>1,weaponOf:()=>({}),atkSpeedMult});
 vm.runInContext(['interactionReady','inPveCombat','duelOf','passiveLockReason','sendPassives','clearPassiveOwnedEffects','setPassives','addRage','refundRes','addMomentum','playerAttackSpeed','moveMult','critChance'].map(extract).join('\n'),c);
 return{p,q,players,zone,events,c};
}
for(const [cls,list] of Object.entries(PASSIVES))test(`${cls}: seven unique passives, three slots, twenty active abilities`,()=>{
 assert.equal(list.length,7);assert.equal(new Set(list.map(x=>x.id)).size,7);assert.equal(PASSIVE_LIMIT,3);
 assert.equal(CLASSES[cls].abilities.filter(a=>!a.passive).length,20);
 for(const a of list){assert.ok(a.name&&a.desc&&a.effect);assert.ok(a.value>0);}
});
test('sanitization rejects wrong-class/unknown/duplicate/over-limit entries and does not mutate input',()=>{
 const p=player();const ids=['heavy_hands','heavy_hands','grace','__proto__',{},'ironhide','keen_edge','executioner'];
 assert.deepEqual(sanitizePassives(p,ids),['heavy_hands','ironhide','keen_edge']);assert.equal(ids.length,8);
 for(const v of [null,{},'heavy_hands',42])assert.deepEqual(sanitizePassives(p,v),[]);
 p.level=4;assert.deepEqual(sanitizePassives(p,['momentum']),[]);p.level=5;p.known.clear();assert.deepEqual(sanitizePassives(p,['momentum']),[]);
});
test('legacy Momentum migration respects purchase and level; explicit empty selection survives',()=>{
 const p=player();assert.deepEqual(restorePassives(p,undefined),['momentum']);assert.deepEqual(restorePassives(p,[]),[]);
 p.known.delete('momentum');assert.deepEqual(restorePassives(p,undefined),[]);p.known.add('momentum');p.level=4;assert.deepEqual(restorePassives(p,undefined),[]);
 assert.deepEqual(restorePassives(player('cleric'),undefined),[]);
});
for(const [label,change] of Object.entries({dead:p=>p.alive=false,closed:p=>p.ws.readyState=3,missingSocket:p=>delete p.ws,lingering:p=>p.lingerT=3,target:p=>p.combatId=99,timer:p=>p.combatTimer=1,aggro:p=>{p.engagedWith=99;p.engagedT=3;},windup:p=>p.windup={t:3},channel:p=>p.channel={t:3},swing:p=>p.swing={},queued:p=>p.queued={},dot:p=>p.dots.poison={t:3}}))test(`loadout rejected while ${label}`,()=>{
 const {p,c,events}=fixture();p.passives=['heavy_hands'];change(p);c.setPassives(p,['ironhide']);assert.deepEqual(p.passives,['heavy_hands']);assert.equal(events.find(e=>e.t==='passives:result').ok,false);
});
for(const state of ['countdown','fighting'])test(`loadout rejected in ${state} duel`,()=>{const{p,c,events}=fixture();p.duelId=7;c.duels.set(7,{id:7,state});c.setPassives(p,['ironhide']);assert.equal(events.find(e=>e.t==='passives:result').ok,false);});
for(const ids of [['heavy_hands','heavy_hands'],['grace'],['nope'],['heavy_hands','ironhide','keen_edge','executioner'],null])test(`invalid selection rejected ${JSON.stringify(ids)}`,()=>{
 const{p,c,events}=fixture();c.setPassives(p,ids);assert.deepEqual(p.passives,[]);assert.equal(events.find(e=>e.t==='passives:result').ok,false);
});
test('swap clears only own outgoing snapshots and Momentum without cleansing, healing, refunds or resetting cooldowns',()=>{
 const {p,q,zone,c,events}=fixture('cleric');p.passives=['firm_wards'];p.momentum=5;p.songs=['song'];p.songHistory=['a','b'];p.cooldowns.smite=10;p.procICD=22;
 p.buffs={revival_sickness:{by:1,t:300},reckless_exposure:{by:1,t:8,taken:.08},bloodrush:{by:1,t:30,taken:.08,dmg:.18},otherWard:{by:2,t:30,absorb:100},ownWard:{by:1,t:30,absorb:100}};
 q.buffs={ownSong:{by:1,t:300,song:true},otherSong:{by:3,t:300,song:true}};zone._sanct=[{by:1},{by:2}];const before={hp:p.hp,mana:p.mana,rage:p.rage};
 c.setPassives(p,['grace']);assert.deepEqual([...p.passives],['grace']);assert.equal(p.momentum,0);assert.equal(p.songs.length,0);assert.equal(p.songHistory.length,0);
 for(const k of ['revival_sickness','reckless_exposure','bloodrush','otherWard'])assert.ok(p.buffs[k],k);assert.equal(p.buffs.ownWard,undefined);assert.equal(q.buffs.ownSong,undefined);assert.ok(q.buffs.otherSong);assert.deepEqual(zone._sanct,[{by:2}]);
 assert.deepEqual({hp:p.hp,mana:p.mana,rage:p.rage},before);assert.equal(p.cooldowns.smite,10);assert.equal(p.procICD,22);assert.equal(c.checkpointRequested,true);assert.equal(events.at(-1).ok,true);
});
test('no-op reordered selection does not strip effects or mark checkpoint dirty',()=>{const{p,c}=fixture();p.passives=['heavy_hands','ironhide'];p.buffs.own={by:1,t:30};p.momentum=3;c.setPassives(p,['ironhide','heavy_hands']);assert.ok(p.buffs.own);assert.equal(p.momentum,3);assert.equal(c.checkpointRequested,false);});
test('authoritative payload includes availability and changes-only suppression',()=>{const{p,c,events}=fixture();p.level=1;p.known.clear();c.sendPassives(p,true);c.sendPassives(p,true);assert.equal(events.length,1);const m=events[0];assert.equal(m.catalogue.length,7);assert.equal(m.limit,0);assert.equal(m.catalogue.find(a=>a.id==='momentum').available,false);p.combatTimer=1;c.sendPassives(p,true);assert.equal(events.length,2);assert.equal(events[1].locked,true);});
test('protocol only accepts bounded string-array passive intents',()=>{assert.equal(validMessage({t:'passives:set',ids:[]}),true);assert.equal(validMessage({t:'passives:set',ids:['heavy_hands']}),true);for(const ids of [null,{},[1],['__proto__'],Array(4).fill('x')])assert.equal(validMessage({t:'passives:set',ids}),false);assert.equal(validMessage({t:'passives:set'}),false);});
test('Fighter modifiers are gated by equipped choices and Rage refunds are not amplified',()=>{
 const{p,c}=fixture();p.passives=['momentum','fighting_spirit','keen_edge'];c.addMomentum(p,2);assert.equal(p.momentum,2);assert.equal(c.playerAttackSpeed(p),.96);assert.ok(Math.abs(c.critChance(p)-.07)<1e-12);c.addRage(p,10);assert.ok(Math.abs(p.rage-30.6)<1e-9);c.refundRes(p,10);assert.ok(Math.abs(p.rage-40.6)<1e-9);p.passives=[];c.addMomentum(p,2);assert.equal(p.momentum,2);assert.equal(c.playerAttackSpeed(p),1);c.addRage(p,1000);assert.equal(p.rage,100);
});
test('weapon and direct defense conditionals obey thresholds and periodic exclusion',()=>{
 const p=player();p.passives=['heavy_hands','executioner'];assert.equal(passiveWeaponMult(p,{hp:29,maxHp:100}),1.07);assert.equal(passiveWeaponMult(p,{hp:30,maxHp:100}),1.03);
 p.passives=['ironhide','last_stand'];p.hp=p.maxHp*.34;assert.equal(passiveDirectMult(p),.94);assert.equal(passiveDirectMult(p,{isPeriodic:true}),1);p.hp=p.maxHp*.35;assert.equal(passiveDirectMult(p),.97);
});
test('all 35 three-choice combinations per class remain within conservative additive modifier bounds',()=>{
 for(const cls of Object.keys(PASSIVES)){const p=player(cls);for(let a=0;a<7;a++)for(let b=a+1;b<7;b++)for(let c=b+1;c<7;c++){p.passives=[PASSIVES[cls][a].id,PASSIVES[cls][b].id,PASSIVES[cls][c].id];p.hp=p.maxHp*.2;assert.ok(passiveDirectMult(p)>=.94);assert.ok(passiveWeaponMult(p,{hp:1,maxHp:100})<=1.07);for(const effect of ['healing','absorb','holyDamage','sonicDamage','manaRegen','castSpeed','attackSpeed','moveSpeed','bardCost','healingCost','songHealing'])assert.ok(passiveValue(p,effect)<=.04);}}
});
function spellFixture(cls){const p=player(cls),q=player('fighter',2),m={id:9,alive:true,zoneId:'z',x:1,z:0,hp:10000,maxHp:10000,debuffs:{}};p.friendId=2;p.combatId=9;const zone={id:'z'},hits=[];const ctx={players:new Map([[1,p],[2,q]]),monsters:new Map([[9,m]]),zoneOf:()=>zone,send(){},sendStatus(){},systemChat(){},broadcast(){},nextId:()=>9,critChance:()=>0,dmgBuff:()=>0,addBuff(t,b){t.buffs[b.id]={...b,t:b.dur};},applyHit(_p,_m,d){hits.push(d);},interruptMonster(){}};return{p,q,m,zone,hits,ctx};}
test('Cleric Grace and Light Touch affect real healing and healing costs only',()=>{const{p,q,ctx}=spellFixture('cleric');p.passives=['grace','light_touch'];assert.equal(healPlayer(ctx,p,q,100,{crit:false}),103);assert.equal(costOf(p,{kind:'heal',cost:100}),97);assert.equal(costOf(p,{kind:'holy',cost:100}),100);});
test('Cleric Firm Wards snapshots exactly4% more absorption in actual ward casting',()=>{const{p,q,ctx}=spellFixture('cleric');const a=classDef('cleric').abilities.find(a=>a.id==='holy_ward');castSpell(ctx,p,a);const base=q.buffs.holy_ward.absorb;delete q.buffs.holy_ward;p.passives=['firm_wards'];castSpell(ctx,p,a);assert.ok(Math.abs(q.buffs.holy_ward.absorb-base*1.04)<=1);});
test('direct protection stacks multiplicatively with Brace and existing shields; ticks unaffected',()=>{const{p,ctx}=spellFixture('cleric');p.passives=['resolve'];p.buffs.brace={t:4,directDr:.25};assert.equal(mitigate(ctx,p,1000,{},{}).dmg,728);assert.equal(mitigate(ctx,p,1000,{},{isPeriodic:true}).dmg,1000);});
test('Bard rhythm, mobility, meditation and Cleric composure use real runtime multipliers',()=>{const{p,c}=fixture('bard');p.passives=['quick_rhythm','nimble_performer','meditative_melody'];assert.equal(atkSpeedMult(p),.97);assert.equal(c.moveMult(p),1.03);assert.equal(manaRegenMult(p,true),1.04);p.cls='cleric';p.passives=['composure','devotion'];assert.equal(castTimeMult(p),.97);assert.equal(manaRegenMult(p,false),1.04);});
test('Songcraft boosts only own song healing, not ordinary Cleric HoTs',()=>{const{p,q,ctx}=spellFixture('bard');p.passives=['songcraft'];q.hp=0;q.alive=true;q.buffs.song={by:p.id,t:20,hot:true,song:true,tick:1,acc:0,heal:100,cap:10000,done:0};stepHots(ctx,q,1);assert.equal(q.hp,103);delete q.buffs.song;q.buffs.ordinary={by:p.id,t:20,hot:true,tick:1,acc:0,heal:100,cap:10000,done:0};stepHots(ctx,q,1);assert.equal(q.hp,203);});
test('monster targeting or positive active threat prevents swapping even after local target is cleared',()=>{for(const m of [{targetId:1},{state:'combat',threat:{1:5}}]){const{p,c,events}=fixture();c.monsters.set(9,{alive:true,zoneId:'z',...m});c.setPassives(p,['ironhide']);assert.equal(events.find(e=>e.t==='passives:result').ok,false);}});
test('request IDs are echoed for success and rejection',()=>{const{p,c,events}=fixture();c.setPassives(p,['ironhide'],'request-a');assert.equal(events.at(-1).requestId,'request-a');p.combatTimer=2;c.setPassives(p,[],'request-b');assert.equal(events.find(e=>e.t==='passives:result'&&e.requestId==='request-b').ok,false);});
test('leaving the world clears old caster-ID snapshots before a new session can change loadout',()=>{const{p,q,c,zone}=fixture('cleric');q.buffs.ward={by:p.id,t:300,absorb:104};q.buffs.foreign={by:77,t:300};zone._sanct=[{by:1},{by:77}];let saved=false;Object.assign(c,{tradeAbort(){},duelForfeit(){},partyRemove(){},savePlayer(){saved=true;},systemChat(){}});vm.runInContext(extract('leaveWorld'),c);c.leaveWorld(p);assert.equal(q.buffs.ward,undefined);assert.ok(q.buffs.foreign);assert.equal(zone._sanct.length,1);assert.equal(saved,true);assert.equal(c.players.has(p.id),false);});
test('actual checkpoint and applySave round-trip loadouts while sanitizing cross-class and unavailable choices',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blackroot-passive-save-'));
 try{const p=player();Object.assign(p,{x:1,z:1,yaw:0,gold:7,xp:123,inventory:[],equipment:{},quests:new Map(),questDone:new Set(),questFlags:new Set(),questAnnounced:new Set(),openedChests:new Set(),usedObjects:new Set(),visited:new Set(),fog:{},meditation:{level:1,xp:0},passives:['momentum','ironhide','heavy_hands']});
 const zone={spawn:{x:1,z:1,yaw:0}};const c=vm.createContext({...helpers,CLASSES,classDef,classStats,clampClassLevel,ZONES:{z:zone},START_ZONE:'z',ITEMS:{},QUESTS:{},standableAt:()=>true,emptySlots:()=>({}),gearOf:()=>({})});
 vm.runInContext(['serialisePlayer','applySave'].map(extract).join('\n'),c);const raw=c.serialisePlayer(p);const store=new WorldStore(dir);store.commit({v:1,characters:{Test1:raw},graves:[],groundItems:[]});const d=new WorldStore(dir).state.characters.Test1;
 const restored={cls:'fighter',inventory:[]};c.applySave(restored,d);assert.deepEqual([...restored.passives],['momentum','ironhide','heavy_hands']);assert.equal(restored.gold,7);assert.equal(restored.xp,123);
 d.passives=['grace','momentum','ironhide','ironhide','heavy_hands'];d.known=[];c.applySave(restored,d);assert.deepEqual([...restored.passives],['ironhide','heavy_hands']);
 d.passives=[];c.applySave(restored,d);assert.deepEqual([...restored.passives],[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('Holy Conviction and Resonance increase actual spell damage by4% with deterministic rolls',()=>{
 const random=Math.random;Math.random=()=>.5;
 try{for(const [cls,id,passive,cast] of [['cleric','smite','holy_conviction',castSpell],['bard','quick_note','resonance',castBard]]){const{p,ctx,hits}=spellFixture(cls),a=classDef(cls).abilities.find(a=>a.id===id);cast(ctx,p,a);p.passives=[passive];cast(ctx,p,a);assert.ok(Math.abs(hits[1]-hits[0]*1.04)<=1,cls);}}
 finally{Math.random=random;}
});
test('Frugal Verse reduces actual server Bard resource charge without changing base definition',()=>{
 const p=player('bard');p.passives=['frugal_verse'];p.mana=p.manaMax;p.known.add('song_of_mending');const a=classDef('bard').abilities.find(a=>a.id==='song_of_mending');
 const c=vm.createContext({...helpers,classDef,isSpell:()=>false,isBardSpell:()=>true,checkBardCast:()=>null,notice(){},QUEUE_WINDOW:.75,combatTargetOf:()=>null,castBard(){},clericCtx:{},sendAbilities(){},sendStatus(){},broadcast(){},castTimeMult:()=>1});
 vm.runInContext(['useAbility','gcdFor','resOf','spendRes'].map(extract).join('\n'),c);const before=p.mana;c.useAbility(p,a.id);assert.equal(before-p.mana,Math.round(a.cost*.97));assert.equal(a.cost,28);
});
test('ability list reports the same discounted cost the authoritative dispatcher charges',()=>{for(const[cls,id,passive]of[['cleric','greater_heal','light_touch'],['bard','song_of_mending','frugal_verse']]){const p=player(cls);p.passives=[passive];const c=vm.createContext({...helpers,classDef,abilityCost,costOf,isSpell,isBardSpell});vm.runInContext(extract('abilityList'),c);const a=classDef(cls).abilities.find(a=>a.id===id);assert.equal(c.abilityList(p).find(a=>a.id===id).cost,Math.round(a.cost*.97));}});

for (const cls of Object.keys(PASSIVES)) test(`${cls}: five-level passive unlocks and level-gated slot capacities`, () => {
 const p=player(cls);assert.deepEqual(PASSIVES[cls].map(a=>a.level),[5,10,15,20,25,30,35]);
 for(let level=1;level<=40;level++){
  p.level=level;const capacity=level<5?0:level<15?1:level<30?2:3;
  assert.equal(helpers.passiveSlotLimit(p),capacity,`L${level}`);
  for(const a of PASSIVES[cls]) assert.equal(helpers.passiveAvailable(p,a),level>=a.level,`${a.id} L${level}`);
  assert.equal(sanitizePassives(p,PASSIVES[cls].map(a=>a.id)).length,Math.min(capacity,Math.floor(level/5)));
 }
});
test('server rejects excess slots and locked passives without changing saved selection or resources',()=>{
 const {p,c,events}=fixture('cleric');
 for(const [level,ids] of [[4,['grace']],[5,['grace','light_touch']],[10,['grace','light_touch']],[15,['grace','light_touch','firm_wards']],[29,['grace','light_touch','firm_wards']],[30,['songcraft']],[34,['resolve']]]){
  p.level=level;p.passives=[];const hp=p.hp,mana=p.mana;c.setPassives(p,ids);assert.equal(events.filter(e=>e.t==='passives:result').at(-1).ok,false);assert.deepEqual(p.passives,[]);assert.equal(p.hp,hp);assert.equal(p.mana,mana);
 }
 for(const [level,ids] of [[4,[]],[5,['grace']],[15,['grace','light_touch']],[30,['grace','light_touch','firm_wards']],[35,['resolve']]]){
  p.level=level;c.setPassives(p,ids);assert.equal(events.filter(e=>e.t==='passives:result').at(-1).ok,true);assert.deepEqual([...p.passives],ids);
 }
});
test('level-up sends newly unlocked slots and choices even when combat state is unchanged',()=>{
 const{p,c,events}=fixture('cleric');p.level=4;c.sendPassives(p,true);
 for(const [level,limit] of [[5,1],[14,1],[15,2],[29,2],[30,3],[35,3]]){
  p.level=level;c.sendPassives(p,true);const m=events.at(-1);assert.equal(m.limit,limit);assert.deepEqual([...m.slotLevels],[5,15,30]);assert.equal(m.catalogue.filter(a=>a.available).length,Math.floor(level/5));
 }
 const before=events.length;c.sendPassives(p,true);assert.equal(events.length,before);
});
test('legacy over-capacity and over-level selections sanitize deterministically without rewriting known abilities',()=>{
 const p=player('cleric');p.level=15;const known=[...p.known];
 assert.deepEqual(restorePassives(p,['resolve','firm_wards','grace','light_touch','grace']),['firm_wards','grace']);
 p.level=4;assert.deepEqual(restorePassives(p,['grace']),[]);assert.deepEqual([...p.known],known);
 for(const level of [NaN,Infinity,undefined]){p.level=level;assert.equal(helpers.passiveSlotLimit(p),0);assert.deepEqual(sanitizePassives(p,['grace']),[]);}
});
