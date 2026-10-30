import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../client/index.html',import.meta.url),'utf8');
function extract(name){const i=source.indexOf(`function ${name}(`);assert.ok(i>=0,name);return source.slice(i,source.indexOf('\n}',i)+2);}
function fixture(){
 const sent=[],timers=new Map();let next=0;
 const catalogue=Array.from({length:7},(_,i)=>({id:`p${i}`,name:`Passive ${i}`,desc:'A modest benefit.',level:(i+1)*5,available:true}));
 const c=vm.createContext({passiveLoadout:{catalogue,equipped:['p0','p1','p2'],limit:3,slotLevels:[5,15,30],locked:false,reason:''},passivePickerSlot:null,passiveRequestTimer:null,passiveRequestId:null,passiveRequestSequence:0,passiveNotice:'',abilityClass:{clsId:'fighter'},renderPassiveHotbar(){},renderPassiveViews(){},renderSpellbook(){},resetGameplayInput(){c.resets++;},resets:0,document:{querySelector(){return{focus(){c.focused++;}}}},focused:0,WebSocket:{OPEN:1},ws:{readyState:1,send:s=>sent.push(JSON.parse(s))},setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 vm.runInContext(['requestPassiveSelection','requestPassiveToggle','openPassivePicker','closePassivePicker','choosePassiveForSlot','dismissPassivePickerKey','dismissPassivePickerOutside','passiveHotbarMarkup','passivePickerMarkup','receivePassiveLoadout','finishPassiveLoadout','clearPassiveLoadout'].map(extract).join('\n'),c);return{c,sent,timers};
}
test('three native hotbar slots sit above active slots and use existing emblem assets',()=>{const{c}=fixture();const html=c.passiveHotbarMarkup();assert.equal((html.match(/data-passive-slot=/g)||[]).length,3);assert.equal((html.match(/type="button"/g)||[]).length,3);assert.match(html,/ui\/fighter\/emblem.png/);assert.ok(source.indexOf('id="passivebar"')<source.indexOf('id="slots"'));assert.match(source,/#passivePicker.*position: absolute; bottom:/);assert.match(source,/max-height: min\(420px, 60vh\)/);});
test('slot replacement preserves other slots and waits for authoritative confirmation',()=>{const{c,sent}=fixture();c.openPassivePicker(1);c.choosePassiveForSlot('p4');assert.deepEqual(sent[0].ids,['p0','p4','p2']);assert.equal(c.passiveLoadout.equipped.join(','),'p0,p1,p2');assert.equal(c.resets,1);assert.ok(c.focused);c.choosePassiveForSlot('p5');assert.equal(sent.length,1);c.receivePassiveLoadout({...c.passiveLoadout,equipped:['p0','p4','p2']});c.finishPassiveLoadout({ok:true,requestId:sent[0].requestId});assert.equal(c.passivePickerSlot,null);assert.equal(c.passiveLoadout.equipped.join(','),'p0,p4,p2');});
test('duplicates and unavailable choices are disabled and rejected without a request',()=>{const{c,sent}=fixture();c.openPassivePicker(0);c.choosePassiveForSlot('p1');c.passiveLoadout.catalogue[3].available=false;c.choosePassiveForSlot('p3');assert.equal(sent.length,0);const html=c.passivePickerMarkup();assert.equal((html.match(/data-passive-choice=/g)||[]).length,7);assert.match(html,/data-passive-choice="p1"[^>]*disabled/);assert.match(html,/data-passive-choice="p3"[^>]*disabled/);assert.match(html,/Changing passives ends spells and songs/);});
test('unequip compacts slots and an empty slot appends without holes',()=>{let{c,sent}=fixture();c.openPassivePicker(1);c.choosePassiveForSlot(null);assert.deepEqual(sent[0].ids,['p0','p2']);({c,sent}=fixture());c.passiveLoadout.equipped=['p0'];c.openPassivePicker(2);c.choosePassiveForSlot('p3');assert.deepEqual(sent[0].ids,['p0','p3']);});
test('combat update closes stale picker and blocks new changes',()=>{const{c,sent}=fixture();c.openPassivePicker(0);c.receivePassiveLoadout({...c.passiveLoadout,locked:true,reason:'Finish combat first.'});assert.equal(c.passivePickerSlot,null);c.openPassivePicker(1);c.choosePassiveForSlot('p4');assert.equal(sent.length,0);assert.match(c.passiveHotbarMarkup(),/Finish combat first/);assert.equal((c.passiveHotbarMarkup().match(/ disabled/g)||[]).length,3);});
test('Escape and outside dismissal consume events without issuing gameplay',()=>{const{c}=fixture();let prevented=0,stopped=0;const e={key:'Escape',preventDefault(){prevented++;},stopPropagation(){stopped++;},target:{closest(){return false;}}};c.openPassivePicker(1);assert.equal(c.dismissPassivePickerKey(e),true);assert.equal(c.passivePickerSlot,null);assert.equal(prevented,1);c.openPassivePicker(0);c.dismissPassivePickerOutside(e);assert.equal(c.passivePickerSlot,null);assert.equal(prevented,2);assert.equal(stopped,2);assert.equal(c.dismissPassivePickerKey(e),false);assert.match(source,/addEventListener\('mousedown', dismissPassivePickerOutside, true\)/);assert.match(extract('gameplayInputBlocked'),/passivePickerSlot != null/);assert.ok(source.indexOf('if (dismissPassivePickerKey(e))')<source.indexOf('if (dismissSettingsKey(e))'));});
test('timeout/rejection/offline preserve loadout and allow recoverable retry',()=>{const{c,sent,timers}=fixture();c.openPassivePicker(0);c.choosePassiveForSlot('p3');c.finishPassiveLoadout({ok:false,requestId:sent[0].requestId,reason:'Combat began.'});assert.equal(c.passivePickerSlot,0);assert.equal(c.passiveLoadout.equipped.join(','),'p0,p1,p2');c.choosePassiveForSlot('p4');timers.get(c.passiveRequestTimer)();assert.equal(c.passiveRequestTimer,null);assert.match(c.passiveNotice,/not confirmed/);c.ws.readyState=3;c.choosePassiveForSlot('p5');assert.equal(sent.length,2);assert.match(c.passiveNotice,/Not connected/);});
test('Spellbook and hotbar share one in-flight request and session cleanup closes picker',()=>{const{c,sent,timers}=fixture();c.openPassivePicker(0);c.choosePassiveForSlot('p3');c.requestPassiveToggle('p1');assert.equal(sent.length,1);c.clearPassiveLoadout();assert.equal(c.passivePickerSlot,null);assert.equal(c.passiveLoadout,null);assert.equal(timers.size,0);c.finishPassiveLoadout({ok:true,requestId:sent[0].requestId});assert.equal(c.passiveNotice,'');});

test('server capacities show level-locked slots and prevent opening or filling them',()=>{
 for(const [level,limit] of [[1,0],[4,0],[5,1],[14,1],[15,2],[29,2],[30,3],[40,3]]){
  const{c,sent}=fixture();c.receivePassiveLoadout({...c.passiveLoadout,limit,equipped:[]});
  const html=c.passiveHotbarMarkup();assert.equal((html.match(/ disabled/g)||[]).length,3-limit,`level ${level}`);
  for(let i=limit;i<3;i++){assert.match(html,new RegExp(`Unlocks at level ${[5,15,30][i]}`));c.openPassivePicker(i);assert.equal(c.passivePickerSlot,null);}
  if(limit){c.openPassivePicker(limit-1);assert.equal(c.passivePickerSlot,limit-1);}
  c.requestPassiveSelection(Array.from({length:limit+1},(_,i)=>`p${i}`));assert.equal(sent.length,0);
 }
});
test('capacity decrease closes a stale picker and unavailable levels remain explained',()=>{
 const{c,sent}=fixture();c.openPassivePicker(2);c.receivePassiveLoadout({...c.passiveLoadout,limit:1,equipped:['p0']});assert.equal(c.passivePickerSlot,null);
 c.passivePickerSlot=2;c.choosePassiveForSlot('p3');assert.equal(sent.length,0);assert.equal(c.passivePickerMarkup(),'');
 c.passivePickerSlot=null;c.openPassivePicker(0);c.passiveLoadout.catalogue[3].available=false;c.passiveLoadout.catalogue[3].unavailableReason='Unlocks at level 20.';
 assert.match(c.passivePickerMarkup(),/Level 20/);assert.match(c.passivePickerMarkup(),/Unlocks at level 20/);
});
test('missing or invalid server capacity fails closed and level-up state unlocks slots',()=>{
 const{c}=fixture();for(const limit of [undefined,NaN,'3',null]){c.receivePassiveLoadout({...c.passiveLoadout,limit,equipped:[]});assert.equal(c.passiveLoadout.limit,0);assert.equal((c.passiveHotbarMarkup().match(/ disabled/g)||[]).length,3);}
 c.receivePassiveLoadout({...c.passiveLoadout,limit:2});c.openPassivePicker(1);assert.equal(c.passivePickerSlot,1);
});
