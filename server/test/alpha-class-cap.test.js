import * as passiveHelpers from '../passives.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { CLASSES, MAX_LEVEL, MAX_CLASS_LEVEL, classDef, classStats, clampClassLevel, classLevelForXp, classXpForLevel, xpTotalForLevel, levelForXp, progressForXp } from '../balance.js';
const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
function extract(source, name) {
  const start=source.indexOf(`function ${name}(`), lineEnd=source.indexOf('\n',start);
  assert.ok(start>=0,name);return source.slice(start,source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',start)+2);
}
test('class level caps at 40 without shortening independent skill XP curve',()=>{
  assert.equal(MAX_CLASS_LEVEL,40);assert.equal(MAX_LEVEL,99);
  assert.equal(classLevelForXp(xpTotalForLevel(40)-1),39);
  for(const l of [40,41,60,99])assert.equal(classLevelForXp(xpTotalForLevel(l)),40);
  assert.equal(classXpForLevel(40),null);assert.ok(classXpForLevel(39)>0);
  assert.equal(levelForXp(xpTotalForLevel(99)),99);assert.equal(progressForXp(xpTotalForLevel(60)).level,60);
  for(const id of Object.keys(CLASSES))assert.deepEqual(classStats(id,99),classStats(id,40));
});
function progressFixture() {
  const events=[];const c=vm.createContext({...passiveHelpers,classLevelForXp,classStats,classDef,send:(_,e)=>events.push(e),systemChat(){},sendSkills(){},sendAbilities(){}});
  vm.runInContext(extract(server,'grantXp'),c);
  const p={name:'Alpha',cls:'cleric',level:39,xp:xpTotalForLevel(40)-1,maxHp:classStats('cleric',39).hp,hp:10};
  return {c,p,events};
}
test('XP awards stop class growth at 40 while retaining above-cap XP',()=>{
  const {c,p,events}=progressFixture();c.grantXp(p,1);assert.equal(p.level,40);assert.equal(p.maxHp,classStats('cleric',40).hp);
  c.grantXp(p,xpTotalForLevel(99));assert.equal(p.level,40);assert.equal(p.xp,xpTotalForLevel(40)+xpTotalForLevel(99));
  assert.deepEqual(events.filter(e=>e.kind==='levelup').map(e=>e.level),[40]);
});
test('a large XP award cannot skip the alpha cap',()=>{
  const {c,p}=progressFixture();p.level=1;p.xp=0;p.maxHp=classStats('cleric',1).hp;c.grantXp(p,xpTotalForLevel(99));assert.equal(p.level,40);
});
test('legacy over-cap saves retain XP and unrelated progression while clamping effective stats',()=>{
  const zone={spawn:{x:1,z:2,yaw:0}};
  const c=vm.createContext({...passiveHelpers,ZONES:{surface:zone},START_ZONE:'surface',CLASSES,clampClassLevel,classStats,classDef,standableAt:()=>true,ITEMS:{},QUESTS:{},sanitizeLook:x=>x});
  vm.runInContext(extract(server,'applySave'),c);
  const p={cls:'fighter',inventory:[]}, xp=xpTotalForLevel(80);
  c.applySave(p,{cls:'cleric',zoneId:'surface',level:80,xp,gold:7,hp:10000,mana:10000,meditation:{level:80,xp},miningXp:xp,fishingXp:xp,cookingXp:xp});
  assert.equal(p.level,40);assert.equal(p.xp,xp);assert.equal(p.hp,classStats('cleric',40).hp);assert.equal(p.mana,classStats('cleric',40).mana);
  assert.equal(p.meditation.level,80);assert.equal(p.miningXp,xp);assert.equal(p.fishingXp,xp);assert.equal(p.cookingXp,xp);
  // Reload the normalized character without losing the banked XP.
  const q={cls:'fighter',inventory:[]};c.applySave(q,{...p,known:[...p.known],quests:[],questDone:[],questFlags:[],visited:[]});assert.equal(q.level,40);assert.equal(q.xp,xp);
});
test('class XP HUD fills and labels the alpha cap instead of retaining stale progress',()=>{
  const els={xpfill:{style:{}},xptext:{}};const c=vm.createContext({...passiveHelpers,document:{getElementById:id=>els[id]}});vm.runInContext(extract(client,'renderClassXp'),c);
  c.renderClassXp({level:39,classMaxLevel:40,xp:10,xpNext:100});assert.equal(els.xpfill.style.transform,'scaleX(0.1)');
  c.renderClassXp({level:40,classMaxLevel:40,xp:0,xpNext:null});assert.equal(els.xpfill.style.transform,'scaleX(1)');assert.equal(els.xptext.textContent,'Level 40 · Alpha cap');
});
test('skills card renders full class cap with retained XP; independent cards still progress',()=>{
  const els=Object.fromEntries(['skillGrid','skillStyles','skillCombat','skillTotal'].map(id=>[id,{}]));
  const c=vm.createContext({...passiveHelpers,document:{getElementById:id=>els[id]},escapeHtml:x=>x,skills:{cls:{name:'Cleric',level:40,maxLevel:40,xp:xpTotalForLevel(40),into:0,next:null}}});
  vm.runInContext(extract(client,'renderSkillWindow'),c);c.renderSkillWindow();assert.match(els.skillStyles.innerHTML,/scaleX\(1\)/);assert.match(els.skillStyles.innerHTML,/alpha cap 40/);assert.match(els.skillGrid.innerHTML,/Mining/);
});
test('class status/snapshot and developer level override use class-only cap helpers',()=>{
  assert.match(server,/next: classXpForLevel\(p.level\), maxLevel: MAX_CLASS_LEVEL/);
  assert.match(server,/xpNext: classXpForLevel\(p.level\), classMaxLevel: MAX_CLASS_LEVEL/);
  assert.match(server,/const L = clampClassLevel\(msg.level\)/);
});
