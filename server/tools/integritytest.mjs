import * as passiveHelpers from '../passives.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import WebSocket from 'ws';
import vm from 'node:vm';
import { emptySlots } from '../items.js';
import { atomicWrite, readJson, WorldStore } from '../persistence.js';
import { validMessage } from '../protocol.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackroot-integrity-'));
let server, output = '';
const port = 18000 + Math.floor(Math.random() * 10000);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label) { for (let i = 0; i < 300; i++) { const r = fn(); if (r) return r; await sleep(50); } throw Error(`${label}: ${output}`); }
async function start() {
  output = ''; server = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), BLACKROOT_DATA_DIR: tmp } });
  server.stdout.on('data', b => output += b); server.stderr.on('data', b => output += b);
  await until(() => output.includes('Open http'), 'startup');
}
async function stop(signal = 'SIGTERM') { if (server && server.exitCode === null && server.signalCode === null) { const ended = once(server, 'exit'); server.kill(signal); await ended; } }
async function connect(name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`), messages = [];
  ws.on('message', b => { const m = JSON.parse(b); messages.push(m); if (m.t === 'welcome' || m.t === 'transition') ws.send(JSON.stringify({ t: 'scene:ready', ...m.scene })); }); await once(ws, 'open');
  const send = m => ws.send(JSON.stringify(m));
  if (name) { send({ t: 'join', name, pass: 'safe-test-password', cls: 'fighter' }); await until(() => messages.find(m => m.t === 'snapshot'), 'scene ready');
    // Initial state clears stale trade/invite UI; do not mistake it for this test's later trade completion.
    for (let i = messages.length - 1; i >= 0; i--) if ((messages[i].t === 'trade' && messages[i].closed) || messages[i].expired) messages.splice(i, 1); }
  return { ws, messages, send, wait: async (t, condition = () => true) => until(() => messages.find(m => m.t === t && condition(m)), t + ' ' + JSON.stringify(messages.slice(-5))) };
}
const state = () => JSON.parse(fs.readFileSync(path.join(tmp, 'saves/world.checkpoint.json')));
try {
  for (const msg of [null, [], {t:'join',name:{toString:null},pass:'123456'}, {t:'join',name:'x',pass:'123456',cls:'__proto__'}, {t:'input',f:{}}, {t:'input',f:Infinity}, {t:'questaccept',id:'constructor'}, {t:'edit:place',x:{}}, {t:'chat',msg:[]}]) assert.equal(validMessage(msg), false);
  assert.equal(validMessage({t:'join',name:'Tester',pass:'123456',cls:'fighter'}), true);
  const fixture = path.join(tmp, 'storage'); fs.mkdirSync(fixture);
  atomicWrite(path.join(fixture,'one.json'), {v:1,name:'One',inventory:[],equipment:{},gold:0,known:[]});
  atomicWrite(path.join(fixture,'world.json'),{v:1,name:'World',inventory:[],equipment:{},gold:7,known:[]});
  const store = new WorldStore(fixture); assert.ok(store.state.characters.One); assert.equal(store.state.characters.World.gold,7);
  store.commit(store.state); store.commit({...store.state, characters:{...store.state.characters, One:{...store.state.characters.One,gold:10}}});
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'world.json'))).name,'World','legacy World save retained unchanged');
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture,'world.checkpoint.json.bak'))).characters.One.gold,0);
  const rename = fs.renameSync;
  fs.renameSync = (from,to) => { if (to === store.file) throw Error('injected commit failure'); return rename(from,to); };
  try { assert.throws(() => store.commit({...store.state, characters:{...store.state.characters,One:{...store.state.characters.One,gold:999}}}), /injected commit failure/); }
  finally { fs.renameSync = rename; }
  assert.equal(JSON.parse(fs.readFileSync(store.file)).characters.One.gold,10,'failed replace preserves complete previous generation');
  fs.writeFileSync(path.join(fixture,'world.checkpoint.json'),'{broken'); assert.throws(() => new WorldStore(fixture), /Cannot read/);
  for (const root of ['null','false','0','\"\"','[]']) { fs.writeFileSync(path.join(fixture,'bad.json'),root); assert.throws(() => readJson(path.join(fixture,'bad.json')), /Expected a JSON object/); }
  await start();
  const bad = await connect();
  for (const m of [{t:'join',name:{toString:null},pass:'123456'},{t:'join',name:'Evil',pass:'123456',cls:'constructor'},{t:'input',f:{toString:null}},{t:'questaccept',id:'__proto__'}]) bad.send(m);
  await bad.wait('error'); assert.equal(server.exitCode,null); bad.ws.close();
  fs.mkdirSync(path.join(tmp,'accounts'),{recursive:true});
  fs.writeFileSync(path.join(tmp,'accounts','broken.json'),'null');
  const broken = await connect(); broken.send({t:'join',name:'Broken',pass:'test-password',cls:'fighter'}); await broken.wait('loginfail'); broken.ws.close();
  assert.equal(fs.readFileSync(path.join(tmp,'accounts','broken.json'),'utf8'),'null','corrupt account not overwritten');
  const a = await connect('Alice'), b = await connect('Bobby');
  const aid = (await a.wait('welcome')).id, bid = (await b.wait('welcome')).id;
  const initial = state(); const item = initial.characters.Alice.inventory[0]; assert.ok(item);
  a.send({t:'trade:request',id:bid}); await b.wait('trade:request'); b.send({t:'trade:accept'}); await a.wait('trade');
  a.send({t:'trade:add',item}); await a.wait('trade',m => m.mine?.some(s => s.name === item)); await sleep(100);
  await stop('SIGKILL'); a.ws.terminate(); b.ws.terminate();
  assert.deepEqual(state().characters.Alice.inventory.toSorted(),initial.characters.Alice.inventory.toSorted(),'escrow refunded in durable checkpoint');
  await start();
  const a2 = await connect('Alice'), b2 = await connect('Bobby'); const bid2 = (await b2.wait('welcome')).id;
  a2.send({t:'trade:request',id:bid2}); await b2.wait('trade:request'); b2.send({t:'trade:accept'}); await a2.wait('trade');
  a2.send({t:'trade:add',item}); await a2.wait('trade',m => m.mine?.some(s => s.name === item)); a2.send({t:'trade:ok',on:true}); await a2.wait('trade',m => m.myOk); b2.send({t:'trade:ok',on:true});
  await a2.wait('trade',m => m.closed); await stop('SIGKILL'); a2.ws.terminate(); b2.ws.terminate();
  const traded = state(); assert.equal(traded.characters.Alice.inventory.length,initial.characters.Alice.inventory.length-1); assert.equal(traded.characters.Bobby.inventory.length,initial.characters.Bobby.inventory.length+1);
  // Execute the exact production death and checkpoint functions as a unit,
  // with networking/AI stubbed (separate from the live seeded grave recovery).
  const source = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const fn = name => { const i = source.indexOf(`function ${name}(`); assert.ok(i >= 0); return source.slice(i, source.indexOf('\n}', i) + 2); };
  const p = { ...traded.characters.Alice, id: 7, ws: {}, alive: true, fog: {} };
  for (const key of ['known','questDone','questFlags','questAnnounced','openedChests','usedObjects','visited']) p[key] = new Set(p[key] || []);
  p.quests = new Map(p.quests); p.inventory = [...p.inventory]; p.equipment = {...p.equipment};
  const unitStore = new WorldStore(path.join(tmp,'death-unit'));
  const ctx = vm.createContext({...passiveHelpers, players: new Map([[p.id,p]]), monsters: new Map(), graves: new Map(), groundItems: new Map(),
    ZONES: {}, sendStatus(){}, worldStore: unitStore, tradeOf: () => null, fogToB64: () => '', emptySlots, gearOf: () => ({}),
    send: () => {}, sendBag: () => {}, systemChat: () => {}, dropThreat: () => {}, retarget: () => {},
    tradeAbort: () => {}, duelForfeit: () => {}, partyRemove: () => {}, sendRaw: () => {}, console,
    process: {exit: code => {throw Error(`unexpected process exit ${code}`);}},
    GRAVE_TTL: 120, RESPAWN_TIME: 5, SAVE_EVERY: 45, nextId: 1000, lastOwnership: '', lastCheckpoint: 0, checkpointRequested: false, outbound: null });
  vm.runInContext(['serialisePlayer','durablePlayer','ownershipOf','commitWorld','savePlayer','transaction','clearPassiveOwnedEffects','leaveWorld','killPlayer'].map(fn).join('\n'),ctx);
  const escrowItem = p.inventory.pop(); p.gold = 60;
  ctx.tradeOf = () => ({ items: {7:[escrowItem]}, gold:{7:40} }); ctx.commitWorld();
  assert.equal(unitStore.state.characters.Alice.gold,100); assert.ok(unitStore.state.characters.Alice.inventory.includes(escrowItem));
  ctx.tradeOf = () => null; p.inventory.push(escrowItem); p.gold = 100;
  ctx.commitWorld();
  // No-op input/tick checkpoints must not repeatedly serialize base64 fog or
  // write disk; gold changes, explicit saves and the 45s deadline still must.
  let fogEncodes = 0; ctx.fogToB64 = () => { fogEncodes++; return ''; }; p.fog = {sample:[]};
  ctx.commitWorld(true); assert.equal(fogEncodes,1);
  const checkpoint = unitStore.state;
  for (let i=0;i<20;i++) { p.yaw += 0.01; ctx.commitWorld(); }
  assert.equal(fogEncodes,1,'no-op checkpoints skip full fog serialization');
  assert.equal(unitStore.state,checkpoint,'no-op checkpoints skip disk commit');
  p.gold++; ctx.commitWorld(); assert.equal(fogEncodes,2,'ownership change still commits immediately');
  ctx.lastCheckpoint = Date.now()-46000; ctx.commitWorld(); assert.equal(fogEncodes,3,'45s deadline still commits');
  const originalX = p.x; p.x += 1;
  ctx.transaction(() => ctx.leaveWorld(p));
  assert.equal(new WorldStore(path.join(tmp,'death-unit')).state.characters.Alice.x, +p.x.toFixed(2), 'logout persists movement without ownership change');
  ctx.players.set(p.id,p); p.x = originalX;
  const carried = p.inventory.length + Object.values(p.equipment).filter(Boolean).length;
  ctx.transaction(() => ctx.killPlayer(p,'test death'));
  const death = new WorldStore(path.join(tmp,'death-unit')).state;
  assert.equal(death.characters.Alice.inventory.length,0); assert.equal(Object.values(death.characters.Alice.equipment).filter(Boolean).length,0);
  assert.equal(death.graves[0].items.length + Object.values(death.graves[0].equipment).filter(Boolean).length,carried);
  assert.equal(death.graves[0].name,'Alice');
  // Fixture represents an atomic death checkpoint. IDs must be remapped after
  // world population; stable name, not the previous connection id, owns grave.
  const graveItem = traded.characters.Alice.inventory.pop();
  traded.graves = [{id:999999,zoneId:traded.characters.Alice.zoneId,x:traded.characters.Alice.x,z:traded.characters.Alice.z,name:'Alice',owner:bid,items:[graveItem],equipment:{},ttl:100}];
  traded.characters.Alice.level = 2; traded.characters.Alice.known = ['heavy_swing'];
  atomicWrite(path.join(tmp,'saves/world.checkpoint.json'),traded);
  await start(); const a3 = await connect('Alice');
  const snap = await a3.wait('snapshot',m => m.graves?.length); const grave = snap.graves.find(g => g.name === 'Alice'); assert.ok(grave); assert.ok(grave.ttl > 90);
  a3.send({t:'lootgrave',id:grave.id}); await until(() => state().graves.length === 0,'grave recovery');
  assert.ok(state().characters.Alice.inventory.includes(graveItem)); assert.deepEqual(state().characters.Alice.known,['heavy_swing'],'relog cannot buy cleave');
  const b3 = await connect('Bobby');
  const beforeDrop = state(); a3.send({t:'drop',item:graveItem});
  const dropped = await a3.wait('snapshot',m => m.items?.some(g => g.name === graveItem));
  const ground = dropped.items.find(g => g.name === graveItem);
  b3.send({t:'pickup',id:ground.id}); await b3.wait('event',m => m.kind === 'loot');
  await stop('SIGKILL'); a3.ws.terminate(); b3.ws.terminate();
  assert.equal(state().characters.Alice.inventory.length,beforeDrop.characters.Alice.inventory.length-1);
  assert.equal(state().characters.Bobby.inventory.length,beforeDrop.characters.Bobby.inventory.length+1);
  assert.equal(state().groundItems.length,0,'ground transfer checkpoint is atomic across owners');
  console.log('PASS protocol, atomic backup/corruption, live malformed packets, SIGKILL escrow/trade/ground transfer, exact death/checkpoint and logout, live restart grave recovery and trainer ownership');
} finally { await stop('SIGKILL'); fs.rmSync(tmp,{recursive:true,force:true}); }
