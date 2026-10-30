import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const fn = name => { const i = source.indexOf(`function ${name}(`); assert.ok(i >= 0); return source.slice(i, source.indexOf('\n}', i) + 2); };
function setup() {
  const player = (name, id) => ({ name, id, cls:'fighter', x:0,z:0,yaw:0,gold:100,hp:10,inventory:['Sword'],equipment:{},
    known:new Set(['starter']),quests:new Map(),questDone:new Set(),questFlags:new Set(),questAnnounced:new Set(),
    openedChests:new Set(),usedObjects:new Set(),visited:new Set(),fog:{surface:new Uint8Array(1024)},meditation:{level:1,xp:0} });
  const a = player('Alice',1), b = player('Bobby',2), escrow = new Map();
  let writes=0, encodes=0;
  const store = {state:{characters:{}},commit(state){ writes++; this.state=state; }};
  const c=vm.createContext({ players:new Map([[1,a],[2,b]]),worldStore:store,graves:new Map(),groundItems:new Map(),
    tradeOf:p=>escrow.get(p.id),fogToB64:()=>{encodes++;return 'encoded';},SAVE_EVERY:45,
    lastOwnership:'',lastCheckpoint:0,checkpointRequested:false });
  vm.runInContext(['serialisePlayer','durablePlayer','ownershipOf','commitWorld','savePlayer'].map(fn).join('\n'),c);
  return {a,b,escrow,c,store,counts:()=>({writes,encodes})};
}
test('no-op checkpoints skip serialization; mutations, force, logout and 45s remain durable',()=>{
  const {a,c,store,counts}=setup(); c.commitWorld(); assert.deepEqual(counts(),{writes:1,encodes:2});
  for(let i=0;i<50;i++){a.x++;a.hp++;c.commitWorld();}
  assert.deepEqual(counts(),{writes:1,encodes:2});
  a.gold++; c.commitWorld(); assert.deepEqual(counts(),{writes:2,encodes:4});
  c.commitWorld(true); assert.deepEqual(counts(),{writes:3,encodes:6});
  c.lastCheckpoint=Date.now()-46000;c.commitWorld(); assert.deepEqual(counts(),{writes:4,encodes:8});
  a.x=123;c.savePlayer(a);c.players.delete(a.id);c.commitWorld();
  assert.equal(store.state.characters.Alice.x,123);assert.equal(counts().writes,5);
});
test('fingerprint and durable state canonicalize escrow consistently and commit both owners',()=>{
  const {a,b,escrow,c,store,counts}=setup();c.commitWorld();
  a.inventory=[];a.gold=60;escrow.set(1,{items:{1:['Sword']},gold:{1:40}});c.commitWorld();
  assert.equal(counts().writes,1,'offered escrow still belongs to original owner');
  c.commitWorld(true);assert.equal(store.state.characters.Alice.gold,100);assert.deepEqual([...store.state.characters.Alice.inventory],['Sword']);
  b.inventory.push('Sword');b.gold+=40;escrow.delete(1);c.commitWorld();
  assert.equal(store.state.characters.Alice.gold,60);assert.equal(store.state.characters.Bobby.gold,140);
  assert.equal(store.state.characters.Alice.inventory.length,0);assert.equal(store.state.characters.Bobby.inventory.length,2);
});
test('minimal legacy optional collections do not break cheap ownership projection',()=>{
  const {c,store}=setup();store.state.characters.Legacy={name:'Legacy',inventory:[],equipment:{},known:[],gold:0};
  assert.doesNotThrow(()=>c.commitWorld());assert.ok(store.state.characters.Legacy);
});
