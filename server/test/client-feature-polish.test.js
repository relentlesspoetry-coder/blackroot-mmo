import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  // Production functions here have closing braces at column zero; single-line
  // functions end on their declaration line.
  const lineEnd = source.indexOf('\n', start);
  const end = source.slice(start, lineEnd).endsWith('}') ? lineEnd : source.indexOf('\n}', start) + 2;
  return source.slice(start, end);
}
function context(values, names) {
  const c = vm.createContext(values); vm.runInContext(names.map(fn).join('\n'), c); return c;
}
function inviteFixture() {
  let now = 1000, tick;
  const els = Object.fromEntries(['invite','inviteText','inviteSub'].map(k => [k,{style:{}}]));
  const sent = [];
  const c = context({document:{getElementById:k=>els[k]}, Date:{now:()=>now}, pendingInvites:new Map(), inviteKind:null,
    INVITE_TEXT:{party:n=>`Party ${n}`,trade:n=>`Trade ${n}`,duel:n=>`Duel ${n}`}, escapeHtml:x=>x,
    clearInterval(){},setInterval(f){tick=f;return 1;},ws:{send:s=>sent.push(JSON.parse(s))}}, ['showInvite','renderInvite','answerInvite']);
  return {c,els,sent,advance(ms){now+=ms;tick();}};
}
test('old invitation expiry does not hide another kind',()=>{
  const {c,els}=inviteFixture(); c.showInvite({name:'A',seconds:30},'party'); c.showInvite({name:'B',seconds:30},'trade');
  c.showInvite({expired:true},'party'); assert.equal(c.inviteKind,'trade'); assert.equal(els.invite.style.display,'block');
});
test('answering latest invite restores older pending invite and routes correct kind',()=>{
  const {c,sent}=inviteFixture(); c.showInvite({name:'A',seconds:30},'party'); c.showInvite({name:'B',seconds:30},'trade');
  c.answerInvite(true); assert.equal(sent[0].t,'trade:accept'); assert.equal(c.inviteKind,'party'); c.answerInvite(false); assert.equal(sent[1].t,'party:decline');
});
test('expired current invitation falls back; expired responses are not sent',()=>{
  const {c,advance,sent}=inviteFixture(); c.showInvite({name:'A',seconds:30},'party'); c.showInvite({name:'B',seconds:1},'trade');
  advance(1100); assert.equal(c.inviteKind,'party'); advance(30000); c.answerInvite(true); assert.equal(sent.length,0); assert.equal(c.inviteKind,null);
});
test('settings Escape dismisses focused control before gameplay suppression',()=>{
  let shown=true,blurred=0,reset=0,prevented=0;
  const c=context({settingsEl:{classList:{contains:()=>shown,remove:()=>shown=false},contains:()=>true},document:{activeElement:{blur(){blurred++;}}},resetGameplayInput(){reset++;}},['closeSettings','dismissSettingsKey']);
  assert.equal(c.dismissSettingsKey({key:'Escape',preventDefault(){prevented++;}}),true);
  assert.equal(shown,false);assert.equal(blurred,1);assert.equal(reset,1);assert.equal(prevented,1);
  assert.equal(c.dismissSettingsKey({key:'i'}),false);
  assert.match(source,/addEventListener\('keydown', \(e\) => \{\s*if \(dismissPassivePickerKey\(e\)\) return;\s*if \(dismissSettingsKey\(e\)\) return;\s*if \(gameplayInputBlocked\(e\)\)/);
});
function dialogueFixture() {
  const els={};
  for(const id of ['dScript','dSay','dQuests','dName']) els[id]={style:{},innerHTML:'',textContent:'',children:[],querySelector(){return null;},appendChild(v){this.children.push(v);},scrollIntoView(){}};
  const sent=[], notices=[],timers=new Map();let timerId=0;
  const c=context({dialogueNpc:null,scriptState:null,document:{getElementById:id=>els[id],createElement:()=>({scrollIntoView(){}})},
    dialogueEl:{style:{},querySelectorAll:()=>[]}, npcMeshes:new Map([['npc',{def:{name:'Keeper',idle:'Hello'}}]]),
    questData:{available:[{id:'q',giver:'npc',name:'Quest',talk:[['n','One'],['y','Two'],['n','Three']],objectives:[]}],active:[]},
    pendingQuestAccepts:new Map(),ws:{readyState:1,send:s=>sent.push(JSON.parse(s))},WebSocket:{OPEN:1},escapeHtml:x=>x,rewardLine:()=>'',bag:{stacks:[]},
    addChat:(a,b)=>notices.push(b),setTimeout:f=>{timers.set(++timerId,f);return timerId;},clearTimeout:id=>timers.delete(id)},
    ['openDialogue','renderDialogueActions','playScript','stepScript','refreshDialogue','closeDialogue','requestQuestAccept','finishQuestAccept','clearPendingQuestAccepts']);
  return {c,els,sent,notices,timers};
}
test('ordinary dialogue refresh preserves script index, rendered lines and action visibility',()=>{
  const {c,els,sent}=dialogueFixture(); c.openDialogue('npc');c.stepScript();const st=c.scriptState;
  assert.equal(st.i,2); c.refreshDialogue();assert.equal(c.scriptState,st);assert.equal(st.i,2);assert.equal(els.dQuests.style.display,'none');assert.equal(sent.length,1);
  c.stepScript();c.refreshDialogue();assert.equal(c.scriptState,null);assert.equal(els.dQuests.style.display,'');assert.equal(sent.length,1);
});
test('dialogue close then reopen starts a fresh actual conversation',()=>{
  const {c,sent}=dialogueFixture();c.openDialogue('npc');c.closeDialogue();assert.equal(c.scriptState,null);c.refreshDialogue();assert.equal(sent.length,1);
  c.openDialogue('npc');assert.equal(sent.length,2);assert.equal(c.scriptState.i,1);
});
test('quest acceptance is pending until authoritative ack and rejects recoverably',()=>{
  const {c,sent,notices}=dialogueFixture();c.requestQuestAccept('q');c.requestQuestAccept('q');assert.equal(sent.length,1);assert.equal(c.pendingQuestAccepts.size,1);assert.equal(notices.length,0);
  c.finishQuestAccept({id:'q',ok:false,reason:'Too far away.'});assert.equal(c.pendingQuestAccepts.size,0);assert.equal(notices[0],'Too far away.');
  c.requestQuestAccept('q');c.finishQuestAccept({id:'q',ok:true});assert.equal(notices[1],'Quest accepted.');assert.equal(c.pendingQuestAccepts.size,0);
});
test('quest acceptance timeout and offline state never report success',()=>{
  const {c,timers,notices,sent}=dialogueFixture();c.requestQuestAccept('q');[...timers.values()][0]();assert.equal(c.pendingQuestAccepts.size,0);assert.match(notices[0],/not confirmed/);
  c.ws.readyState=3;c.requestQuestAccept('q');assert.equal(sent.length,1);assert.match(notices[1],/Not connected/);
});
test('class choices are native keyboard buttons and selected state tracks selection',()=>{
  const choices=[...source.matchAll(/<button type="button" aria-pressed="(true|false)" class="classopt(?: sel)?" data-cls="(fighter|cleric|bard)"/g)];assert.equal(choices.length,3);
  const buttons=['fighter','cleric','bard'].map(cls=>({dataset:{cls},classList:{toggle(k,v){this.selected=v;}},setAttribute(k,v){this[k]=v;}}));
  const c=context({pickedClass:'fighter',document:{querySelectorAll:()=>buttons},outfitSel:{value:12},CLASS_OUTFIT:{fighter:12,cleric:31,bard:19},localStorage:{setItem(){}}},['selectClass']);
  c.selectClass('bard');assert.equal(c.pickedClass,'bard');assert.equal(c.outfitSel.value,19);assert.deepEqual(buttons.map(b=>b['aria-pressed']),['false','false','true']);
});

test('session cleanup cancels pending quest timers and ignores late acknowledgments',()=>{
  const {c,timers,notices}=dialogueFixture();c.requestQuestAccept('q');c.requestQuestAccept('other');assert.equal(timers.size,2);
  c.clearPendingQuestAccepts();assert.equal(timers.size,0);assert.equal(c.pendingQuestAccepts.size,0);
  c.finishQuestAccept({id:'q',ok:true});assert.equal(notices.length,0);
  assert.match(source,/resetGameplayInput\(\); clearPendingQuestAccepts\(\); clearPassiveLoadout\(\); ws = null; connectionState = 'disconnected'/);
  assert.match(source,/if \(m.t === 'logout'\) \{ clearPendingQuestAccepts\(\); clearPassiveLoadout\(\); location.reload\(\)/);
});
