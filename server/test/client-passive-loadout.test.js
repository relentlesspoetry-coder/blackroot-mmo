import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../../client/index.html',import.meta.url),'utf8');
function extract(name){const i=source.indexOf(`function ${name}(`);assert.ok(i>=0,name);return source.slice(i,source.indexOf('\n}',i)+2);}
function fixture(){
  const sent=[],timers=new Map();let next=0;
  const catalogue=Array.from({length:7},(_,i)=>({id:`p${i}`,name:`Passive ${i}`,desc:'A modest benefit.',level:(i+1)*5,available:true}));
  const c=vm.createContext({passiveLoadout:{catalogue,equipped:['p0'],limit:3,locked:false,reason:''},passiveRequestTimer:null,passiveRequestId:null,passiveRequestSequence:0,passiveNotice:'',passivePickerSlot:null,closePassivePicker(){},renderPassiveViews(){},renderSpellbook(){},WebSocket:{OPEN:1},ws:{readyState:1,send:s=>sent.push(JSON.parse(s))},setTimeout(fn){timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
  vm.runInContext(['clearPassiveLoadout','receivePassiveLoadout','finishPassiveLoadout','requestPassiveToggle','requestPassiveSelection','passiveLoadoutMarkup'].map(extract).join('\n'),c);
  return{c,sent,timers,catalogue};
}
test('seven passive buttons expose native keyboard controls and three confirmed slots',()=>{
  const {c}=fixture(),html=c.passiveLoadoutMarkup();
  assert.equal((html.match(/class="sbpassive"/g)||[]).length,7);
  assert.equal((html.match(/class="sbpassive-slot"/g)||[]).length,3);
  assert.match(html,/type="button"/);assert.match(html,/aria-pressed="true"/);assert.match(html,/1\/3 equipped/);assert.match(html,/Changing passives ends spells and songs you placed/);
});
test('toggle waits for authoritative state rather than claiming optimistic equipment',()=>{
  const {c,sent}=fixture();c.requestPassiveToggle('p1');assert.deepEqual(sent,[{t:'passives:set',ids:['p0','p1'],requestId:'passive-1'}]);assert.equal(c.passiveLoadout.equipped.join(','),'p0');assert.match(c.passiveLoadoutMarkup(),/Saving your loadout/);
  c.requestPassiveToggle('p2');assert.equal(sent.length,1);
  c.receivePassiveLoadout({...c.passiveLoadout,equipped:['p0','p1']});assert.equal(c.passiveLoadout.equipped.length,2);assert.notEqual(c.passiveRequestTimer,null);
  c.finishPassiveLoadout({ok:true,requestId:'passive-1'});assert.equal(c.passiveRequestTimer,null);assert.match(c.passiveNotice,/saved/);
});
test('removal routes exact new loadout and fourth selection is refused',()=>{
  const {c,sent}=fixture();c.passiveLoadout.equipped=['p0','p1','p2'];c.requestPassiveToggle('p3');assert.equal(sent.length,0);assert.match(c.passiveNotice,/Unequip/);
  c.requestPassiveToggle('p1');assert.deepEqual(sent[0].ids,['p0','p2']);
});
test('combat and unavailable entries never send requests; server reasons remain visible',()=>{
  const {c,sent}=fixture();c.passiveLoadout.locked=true;c.passiveLoadout.reason='Finish combat first.';c.requestPassiveToggle('p1');assert.equal(sent.length,0);assert.match(c.passiveLoadoutMarkup(),/Finish combat first/);
  c.passiveLoadout.locked=false;c.passiveLoadout.catalogue[1].available=false;c.passiveLoadout.catalogue[1].reason='Learn Momentum first.';c.requestPassiveToggle('p1');assert.equal(sent.length,0);assert.match(c.passiveLoadoutMarkup(),/Learn Momentum first/);
});
test('rejection and timeout retain last server-confirmed state and allow retry',()=>{
  const {c,sent,timers}=fixture();c.requestPassiveToggle('p1');c.finishPassiveLoadout({ok:false,reason:'Combat began.',requestId:'passive-1'});assert.equal(c.passiveLoadout.equipped.join(','),'p0');assert.equal(timers.size,0);assert.equal(c.passiveNotice,'Combat began.');
  c.requestPassiveToggle('p2');timers.get(c.passiveRequestTimer)();assert.equal(c.passiveRequestTimer,null);assert.match(c.passiveNotice,/not confirmed/);assert.equal(c.passiveLoadout.equipped.join(','),'p0');assert.equal(sent.length,2);
});
test('offline and send failures do not leave a stuck pending state',()=>{
  const {c,sent,timers}=fixture();c.ws.readyState=3;c.requestPassiveToggle('p1');assert.equal(sent.length,0);assert.equal(c.passiveRequestTimer,null);assert.match(c.passiveNotice,/Not connected/);
  c.ws.readyState=1;c.ws.send=()=>{throw Error('closed')};c.requestPassiveToggle('p1');assert.equal(c.passiveRequestTimer,null);assert.equal(timers.size,0);assert.match(c.passiveNotice,/Could not send/);
});
test('session cleanup cancels requests and ignores delayed results',()=>{
  const {c,timers}=fixture();c.requestPassiveToggle('p1');c.clearPassiveLoadout();assert.equal(timers.size,0);assert.equal(c.passiveLoadout,null);c.finishPassiveLoadout({ok:true,requestId:'passive-1'});assert.equal(c.passiveNotice,'');
  assert.match(source,/clearPendingQuestAccepts\(\); clearPassiveLoadout\(\); ws = null/);assert.match(source,/if \(m.t === 'logout'\) \{ clearPendingQuestAccepts\(\); clearPassiveLoadout\(\)/);
});
test('passives remain separate from active grid and do not steal refresh scroll or focus',()=>{
  const render=extract('renderSpellbook');assert.match(render,/a.known && !a.passive/);assert.match(render,/passiveLoadoutMarkup\(\)/);assert.match(render,/list.scrollTop = scrollTop/);assert.match(render,/button.dataset.passiveId === passiveFocus/);
  assert.match(source,/case 'passives':\s+receivePassiveLoadout\(m\)/);assert.match(source,/case 'passives:result':\s+finishPassiveLoadout\(m\)/);
});

test('late result after timeout cannot confirm or cancel a newer request',()=>{
  const {c,timers}=fixture();c.requestPassiveToggle('p1');const stale=c.passiveRequestId;timers.get(c.passiveRequestTimer)();
  c.requestPassiveToggle('p2');const current=c.passiveRequestId,timer=c.passiveRequestTimer;assert.notEqual(stale,current);
  c.finishPassiveLoadout({ok:true,requestId:stale});assert.equal(c.passiveRequestId,current);assert.equal(c.passiveRequestTimer,timer);
  c.finishPassiveLoadout({ok:false,requestId:current,reason:'Combat began.'});assert.equal(c.passiveRequestTimer,null);assert.equal(c.passiveNotice,'Combat began.');
});

test('Fighter guide explains Momentum must be learned and equipped',()=>{
  assert.match(extract('classGuide'),/Learn Momentum from your trainer at level 5, then equip it to build stacks/);
});

test('Spellbook reports unlocked capacity and labels all passive unlock levels',()=>{
 const{c,sent}=fixture();c.receivePassiveLoadout({...c.passiveLoadout,limit:0,equipped:[],catalogue:c.passiveLoadout.catalogue.map(p=>({...p,available:false}))});
 let html=c.passiveLoadoutMarkup();assert.match(html,/0\/0 equipped/);assert.match(html,/first passive and slot unlock at level 5/);for(const level of [5,15,30])assert.match(html,new RegExp(`Unlocks at level ${level}`));
 c.requestPassiveToggle('p0');assert.equal(sent.length,0);
 c.receivePassiveLoadout({...c.passiveLoadout,limit:1,equipped:['p0'],catalogue:c.passiveLoadout.catalogue.map(p=>({...p,available:true}))});
 html=c.passiveLoadoutMarkup();assert.match(html,/1\/1 equipped/);assert.match(html,/data-passive-id="p1"[^>]*disabled/);assert.match(html,/Passive 6 · Level 35/);
 c.requestPassiveToggle('p0');assert.deepEqual(sent[0].ids,[]);
});
