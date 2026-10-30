import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ITEMS, ARMOR_ITEMS, WEAPON_ITEMS, STARTER_ITEMS, STARTER_KITS, starterEquipment, emptySlots, equipStats, valueOf, itemDef, slotOf, slotsFor, SLOTS, stackable } from '../items.js';
import { classDef, CLASSES, classStats, clampClassLevel } from '../balance.js';
import { restorePassives } from '../passives.js';
import { weaponProfile } from '../combat.js';
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
function extract(name) { const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2); }
for (const [cls,kit] of Object.entries(STARTER_KITS)) {
 test(`${cls}: four weak level-one worthless pieces, correct grip and reused visuals`,()=>{
  assert.deepEqual(Object.keys(kit),['weapon','chest','legs','boots']);
  assert.equal(classDef(cls).startWeapon,kit.weapon);
  assert.deepEqual(equipStats(starterEquipment(cls)),{atk:1,def:0});
  assert.equal(weaponProfile(kit.weapon).hands,cls==='fighter'?2:1);
  for(const [slot,name] of Object.entries(kit)) {
   const d=ITEMS[name];assert.equal(d.slot,slot);assert.equal(d.level,1);assert.equal(valueOf(name),0);
   assert.equal(d.starter,true);assert.equal(d.def,0);assert.match(d.desc,/starter/);assert.match(d.desc,/no resale value/i);
   assert.deepEqual(Object.keys(d).filter(k=>/mana|heal|hp|regen/i.test(k)),[]);
   if(slot==='weapon'){assert.equal(d.atk,1);assert.ok(Object.values(WEAPON_ITEMS).some(x=>x.model===d.model),d.model);}
   else assert.ok(Object.values(ARMOR_ITEMS).some(x=>x.wear?.piece===d.wear.piece),d.wear.piece);
   assert.ok(!Object.hasOwn(WEAPON_ITEMS,name));assert.ok(!Object.hasOwn(ARMOR_ITEMS,name));
  }
 });
 test(`${cls}: actual equip/unequip preserves items and supplies three wardrobe slots`,()=>{
  const box=vm.createContext({ITEMS,itemDef,slotOf,slotsFor,SLOTS,send(){},sendBag(){}});
  vm.runInContext(['gearOf','equipItem','unequipItem'].map(extract).join('\n'),box);
  const p={level:1,equipment:emptySlots(),inventory:Object.values(kit)};
  for(const name of Object.values(kit))box.equipItem(p,name);
  assert.equal(p.inventory.length,0);assert.deepEqual(Object.keys(p.gear).sort(),['boots','pants','shirt']);
  for(const slot of Object.keys(kit))box.unequipItem(p,slot);
  assert.deepEqual(p.inventory.sort(),Object.values(kit).sort());assert.deepEqual(equipStats(p.equipment),{atk:0,def:0});
 });
}
test('twelve distinct starters, independent kits, legacy values unchanged',()=>{
 assert.equal(Object.keys(STARTER_ITEMS).length,12);
 const a=starterEquipment('fighter'),b=starterEquipment('fighter');a.weapon=null;assert.equal(b.weapon,STARTER_KITS.fighter.weapon);
 assert.deepEqual(starterEquipment('unknown'),emptySlots());
 assert.equal(valueOf('Rusted Training Sword'),25);assert.equal(ITEMS['Rusted Training Sword'].atk,3);
 assert.equal(valueOf('Dagger'),35);assert.equal(valueOf('Mace'),180);assert.equal(valueOf('Unknown'),5);
});
test('real merchant rejects all starters, losing no items or minting gold, including sell-all',()=>{
 const notices=[];const box=vm.createContext({zoneOf:()=>({npcs:[{trade:true,x:0,z:0}]}),dist2:()=>0,NPC_TALK_RADIUS:5,valueOf,stackable,notice(_p,s){notices.push(s);},send(){},sendBag(){}});
 vm.runInContext(extract('sellItem'),box);
 for(const name of Object.keys(STARTER_ITEMS))for(const all of [false,true]){
  const p={inventory:[name,name],gold:3,x:0,z:0};box.sellItem(p,name,all);assert.deepEqual(p.inventory,[name,name]);assert.equal(p.gold,3);
 }
 assert.equal(notices.length,24);const p={inventory:['Dagger'],gold:3};box.sellItem(p,'Dagger',false);assert.equal(p.gold,17);assert.equal(p.inventory.length,0);
});
test('actual login branch grants only absent saves, not reconnect/dead/empty legacy saves',()=>{
 const start=source.indexOf('const saved = loadSave(name);');const code=source.slice(start,source.indexOf('players.set(id, player)',start));
 for(const saved of [null,{equipment:{},inventory:[]},{hp:0,equipment:{},inventory:[]},{inventory:['Dagger']}]){
  let grants=0,restores=0;const p={cls:'cleric',equipment:emptySlots(),inventory:['Fishing Rod','Bronze Pickaxe']};
  const box=vm.createContext({name:'Test',player:p,loadSave:()=>saved,applySave(player,save){restores++;Object.assign(player,save);},starterEquipment(cls){grants++;return starterEquipment(cls);},gearOf:()=>({})});
  vm.runInContext(code,box);assert.equal(grants,saved?0:1);assert.equal(restores,saved?1:0);
  if(!saved)assert.equal(p.equipment.weapon,STARTER_KITS.cleric.weapon);else assert.deepEqual(p.inventory,saved.inventory);
 }
});
test('client displays no resale value and disables worthless sales',()=>{
 const c=fs.readFileSync(new URL('../../client/index.html',import.meta.url),'utf8');
 assert.ok(c.includes("info.value === 0 ? 'No resale value'"));
 assert.equal(c.split(`itemInfo(n)?.value === 0 ? 'disabled title="No resale value"'`).length - 1, 2);
});

test('real save restore preserves starter ownership, removed kits, legacy gear and dead saves without regrant',()=>{
 const zone={spawn:{x:0,z:0,yaw:0}};
 const box=vm.createContext({ITEMS,SLOTS,emptySlots,slotsFor,slotOf,CLASSES,classDef,classStats,clampClassLevel,restorePassives,
  ZONES:{start:zone},START_ZONE:'start',QUESTS:{},standableAt:()=>true,placeAt:()=>null});
 vm.runInContext(['gearOf','applySave'].map(extract).join('\n'),box);
 for(const cls of Object.keys(STARTER_KITS))for(const hp of [0,1])for(const equipment of [starterEquipment(cls),emptySlots(),{weapon:'Rusted Training Sword'}]){
  const inventory=['Fishing Rod','Bronze Pickaxe',STARTER_KITS[cls].boots];
  const d=JSON.parse(JSON.stringify({cls,level:1,hp,gold:0,equipment,inventory}));
  const p={cls,equipment:emptySlots(),inventory:[]};box.applySave(p,d);
  assert.deepEqual(Object.fromEntries(Object.entries(p.equipment).filter(([,v])=>v)),Object.fromEntries(Object.entries(equipment).filter(([,v])=>v)));
  assert.deepEqual([...p.inventory],inventory);
  box.applySave(p,d);assert.deepEqual([...p.inventory],inventory,'repeat restore never duplicates items');
 }
});

test('quest reachability derives creation gear without exempting unrelated items', () => {
 const check=fs.readFileSync(new URL('../../tools/questcheck.mjs',import.meta.url),'utf8');
 const start=check.indexOf('for (const cls of Object.keys(CLASSES))');
 assert.ok(start>=0);
 const code=check.slice(start,check.indexOf('// Cooking',start));
 const sources=new Map();
 vm.runInNewContext(code,{CLASSES,starterEquipment,note:(item,where)=>sources.set(item,where)});
 assert.deepEqual([...sources.keys()].sort(),Object.keys(STARTER_ITEMS).sort());
 assert.equal(sources.has('Unobtainable Test Item'),false);
 assert.equal(sources.has('Rusted Training Sword'),false,'legacy loot must still prove its own source');
 assert.ok(check.includes('Object.keys(ITEMS).filter(n => !source.has(n))'),'unreachable items remain errors');
});
