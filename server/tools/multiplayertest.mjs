// Local-only bounded functional regression and load characterization, NOT a capacity certificate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { randomBytes, createHash } from 'node:crypto';
import WebSocket from 'ws';

const root = new URL('..', import.meta.url);
const smoke = process.argv.includes('--smoke');
const inputOnly = process.argv.includes('--input-only');
const tierArg = process.argv.find(a => a.startsWith('--clients='));
const requested = tierArg ? Number(tierArg.split('=')[1]) : null;
assert.ok(requested === null || [2, 8, 16].includes(requested), '--clients must be 2, 8 or 16');
const onlyArg = process.argv.find(a => a.startsWith('--only-tier='));
const only = onlyArg ? Number(onlyArg.split('=')[1]) : null;
assert.ok(only === null || [2, 8, 16].includes(only), '--only-tier must be 2, 8 or 16');
assert.ok(only === null || (!smoke && !inputOnly && requested === null), '--only-tier cannot combine with smoke, input-only, or clients');
// Resume a tier only after its lower-tier gates have passed on identical production source.
const tiers = only !== null ? [only] : (smoke || inputOnly) ? [2] : [2, 8, 16].filter(n => requested === null || n <= requested);
const durations = smoke ? { warmup: 2000, idle: 4000, moving: 6000 } : { warmup: 30000, idle: 60000, moving: 120000 };
const outputDir = process.env.MULTIPLAYER_RESULTS || fs.mkdtempSync(path.join(os.tmpdir(), 'blackroot-multiplayer-results-'));
fs.mkdirSync(outputDir, { recursive: true });
const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { kind: smoke ? 'smoke (not benchmark)' : inputOnly ? '2-client browser-like input characterization' : 'bounded moderate-pathfinding characterization', node: process.version, platform: os.platform(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, cpuTickHz: hz, durations, tiers: [], resultsDirectory: outputDir };
report.topology = 'Up to 8 sockets/source IP; clients Load00-07 use 127.0.0.1, Load08-15 use 127.0.0.2 in the 16-client tier. Production caps unchanged.';
report.startedAt = new Date().toISOString();
report.sourceHashes = Object.fromEntries(['../server.js', './multiplayertest.mjs'].map(file => [file, createHash('sha256').update(fs.readFileSync(new URL(file, import.meta.url))).digest('hex')]));
report.workload = inputOnly ? 'One input/client every 50ms, alternating forward/back every 500ms; no move packets' : 'One move destination/client/second while moving; no game input while idle';
try { report.revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch {}
let current, interrupted = false;
const watchdog = setTimeout(() => { interrupted = true; current?.cleanup().finally(() => process.exit(1)); }, smoke ? 180000 : 1500000);
for (const sig of ['SIGINT','SIGTERM']) process.once(sig, () => { interrupted = true; current?.cleanup().finally(() => process.exit(130)); });
function distribution(values) { const a = [...values].sort((a,b) => a-b); const at = q => a.length ? +a[Math.min(a.length-1, Math.ceil(q*a.length)-1)].toFixed(2) : null; return { count:a.length, p50:at(.5), p95:at(.95), p99:at(.99), max:at(1) }; }
function resource(pid) { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8'); return { at:performance.now(), cpuMs:(Number(s[11])+Number(s[12]))/hz*1000, rssMiB:Number(status.match(/^VmRSS:\s+(\d+)/m)[1])/1024 }; }
function ownership(state) { return Object.fromEntries(Object.entries(state.characters).map(([name,c]) => [name,{inventory:[...c.inventory].sort(),equipment:c.equipment,gold:c.gold}])); }
async function fixture(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackroot-multiplayer-'));
  const probe = net.createServer(); probe.listen(0,'127.0.0.1'); await once(probe,'listening'); const port = probe.address().port; await new Promise(r=>probe.close(r));
  const clients=[], logs=[]; let child, failure, lastJoin=-Infinity, logBytes=0, cleaned=false;
  const f = { dir, port, clients, get child(){return child;}, checkpoint:()=>JSON.parse(fs.readFileSync(path.join(dir,'saves/world.checkpoint.json'),'utf8')) };
  f.check = () => { if (interrupted) throw Error('Interrupted'); if(failure) throw failure; if (child && (child.exitCode!==null || child.signalCode!==null)) throw Error(`Server exited ${child.exitCode}/${child.signalCode}`); for(const c of clients) if(!c.expectedClose && c.closed) throw Error(`Unexpected close ${c.name}: ${c.closeCode}`); };
  f.until = async (label, fn, ms=15000) => { const end=performance.now()+ms; while(performance.now()<end){f.check(); const result=fn(); if(result)return result; await sleep(25);} throw Error(`Timeout: ${label}`); };
  f.start = async () => { const before=logs.length; child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),BLACKROOT_DATA_DIR:dir,DATA_DIR:dir,EDITOR_ENABLED:'0'},stdio:['ignore','pipe','pipe']}); child.on('error',e=>{failure=e;}); const append=b=>{ logBytes+=b.length; if(logBytes>2e6){failure=Error('Server log safety cap exceeded');return;} logs.push(b.toString()); }; child.stdout.on('data',append);child.stderr.on('data',append); await f.until('server startup',()=>logs.slice(before).join('').includes('Open http'),30000); };
  f.stop = async (signal='SIGTERM') => { if(child && child.exitCode===null && child.signalCode===null){const done=once(child,'exit'); child.kill(signal); const timer=setTimeout(()=>child.kill('SIGKILL'),5000); try{await done;}finally{clearTimeout(timer);}} };
  f.cleanup = async () => { if(cleaned)return; cleaned=true; for(const c of clients){c.expectedClose=true;c.ws.terminate();} await f.stop(); fs.writeFileSync(path.join(outputDir,`server-${n}.log`),logs.join('')); fs.rmSync(dir,{recursive:true,force:true}); assert.equal(fs.existsSync(dir),false); };
  f.connect = async (name, pass, autoPong=true) => {
    await sleep(Math.max(0,lastJoin+5100-performance.now())); f.check(); lastJoin=performance.now();
    const sourceAddress = n === 16 && Number(name.slice(4)) >= 8 ? '127.0.0.2' : '127.0.0.1';
    const ws=new WebSocket(`ws://127.0.0.1:${port}`,{autoPong,localAddress:sourceAddress}); const c={name,sourceAddress,pass,ws,events:[],closed:false,expectedClose:false,snapshots:[],bytes:0,moved:0,sent:0}; clients.push(c);
    ws.on('error',e=>{if(!c.expectedClose)failure=e;}); ws.on('close',code=>{c.closed=true;c.closeCode=code;});
    ws.on('message',raw=>{ try { const m=JSON.parse(raw); c.bytes+=raw.length; if(m.t==='loginfail')throw Error(`${name} login rejected: ${m.text}`); if(m.t==='welcome')c.id=m.id; if(m.t==='bag')c.bag=m; if(m.t==='snapshot'){const at=performance.now();c.snapshot=m;c.me=m.players.find(p=>p.id===c.id);if(c.me){assert.ok(Number.isFinite(c.me.x)&&Number.isFinite(c.me.z)); if(c.previous)c.moved+=Math.hypot(c.me.x-c.previous.x,c.me.z-c.previous.z);c.previous={x:c.me.x,z:c.me.z};} c.snapshots.push(at);if(c.snapshots.length>20000)throw Error('Snapshot sample safety cap exceeded');} else {c.events.push(m);if(c.events.length>100)c.events.shift();} }catch(e){failure=e;} });
    await f.until('socket open',()=>ws.readyState===WebSocket.OPEN); const start=performance.now(); c.send=m=>{assert.equal(ws.readyState,WebSocket.OPEN);ws.send(JSON.stringify(m));c.sent++;}; c.send({t:'join',name,pass,cls:'fighter'});await f.until(`join ${name}`,()=>c.id&&c.me&&c.bag);c.joinMs=performance.now()-start;return c;
  };
  f.pause=async ms=>{const end=performance.now()+ms;while(performance.now()<end){f.check();await sleep(Math.min(100,end-performance.now()));}};
  return f;
}
async function trade(f,a,b,item) { a.events=[];b.events=[];a.send({t:'trade:request',id:b.id});await f.until('trade request',()=>b.events.some(m=>m.t==='trade:request'));b.send({t:'trade:accept'});await f.until('trade open',()=>a.events.some(m=>m.t==='trade'&&!m.closed));a.send({t:'trade:add',item});await f.until('escrow',()=>a.events.some(m=>m.t==='trade'&&m.mine?.some(s=>s.name===item))); }
async function functional(f, group) {
  let [a,b]=group; const initial=ownership(f.checkpoint()), item=initial[a.name].inventory[0]; assert.ok(item);
  await trade(f,a,b,item);a.expectedClose=true;a.ws.close();await f.until('closed socket',()=>a.closed);await f.until('peer removes logout',()=>!b.snapshot.players.some(p=>p.id===a.id));await f.until('durable escrow refund',()=>JSON.stringify(ownership(f.checkpoint()))===JSON.stringify(initial));
  const oldId=a.id;a=await f.connect(a.name,a.pass);group[0]=a;assert.notEqual(a.id,oldId);assert.deepEqual([...a.bag.items].sort(),initial[a.name].inventory);
  await trade(f,a,b,item);a.events=[];b.events=[];a.send({t:'trade:ok',on:true});await f.until('first confirmation',()=>a.events.some(m=>m.t==='trade'&&m.myOk));b.send({t:'trade:ok',on:true});await f.until('committed trade',()=>a.events.some(m=>m.t==='trade'&&m.closed));
  const expected=structuredClone(initial);expected[a.name].inventory.splice(expected[a.name].inventory.indexOf(item),1);expected[b.name].inventory.push(item);expected[b.name].inventory.sort();assert.deepEqual(ownership(f.checkpoint()),expected);
  a.send({t:'trade:ok',on:true});b.send({t:'trade:ok',on:true});await f.pause(250);assert.deepEqual(ownership(f.checkpoint()),expected);
  // Explicit heartbeat failure: healthy peer stays up; the non-pong client owns pending escrow.
  b.expectedClose=true;b.ws.terminate();await f.until('abrupt socket closed',()=>b.closed);await f.until('peer removes abrupt close',()=>!a.snapshot.players.some(p=>p.id===b.id));
  b=await f.connect(b.name,b.pass,false);group[1]=b;await trade(f,b,a,item);b.expectedClose=true;await f.until('heartbeat eviction',()=>b.closed,25000);await f.until('peer removes expired heartbeat',()=>!a.snapshot.players.some(p=>p.id===b.id));assert.deepEqual(ownership(f.checkpoint()),expected);
  // Verify persisted successful transfer and refund through a real graceful restart.
  for(const c of group)c.expectedClose=true;await f.stop();for(const c of group)c.ws.terminate();await f.start();
  for(let i=group.length-1;i>=0;i--){const old=group[i];group[i]=await f.connect(old.name,old.pass);assert.deepEqual([...group[i].bag.items].sort(),expected[old.name].inventory);assert.equal(group[i].bag.gold,expected[old.name].gold);}
  assert.deepEqual(ownership(f.checkpoint()),expected);return {logoutEscrow:'pass',tradeCommitAndReplay:'pass',abruptDisconnect:'pass',heartbeatEscrow:'pass',gracefulRestart:'pass'};
}
async function phase(f,group,label,ms,moving=false) {
  const begin=performance.now(), start=resource(f.child.pid), generatorStart=process.cpuUsage(), samples=[], offsets=group.map(c=>({snap:c.snapshots.length,bytes:c.bytes,moved:c.moved,sent:c.sent}));let nextMove=begin,nextSample=begin;
  while(performance.now()-begin<ms){ f.check();const now=performance.now();if(moving&&now>=nextMove){if(moving==='input'){const step=Math.floor((now-begin)/500);group.forEach(c=>c.send({t:'input',f:step%2?-1:1,r:0,yaw:0}));nextMove=now+50;}else{const step=Math.floor((now-begin)/1000);group.forEach((c,i)=>c.send({t:'move',x:step%2?-3:0,z:19+(i%3)*.4}));nextMove=now+1000;}} if(now>=nextSample){const r=resource(f.child.pid);samples.push(r);if(r.rssMiB>1024)throw Error('Server RSS exceeded 1 GiB safety ceiling (not an SLO)');nextSample=now+500;}for(const c of group){assert.ok(c.snapshots.length);assert.ok(now-c.snapshots.at(-1)<10000,'No snapshot for 10 seconds (liveness safety deadline)');}await sleep(moving==='input'?25:500); }
  if(moving==='input')for(const c of group)c.send({t:'input',f:0,r:0,yaw:0});
  const end=resource(f.child.pid), elapsed=end.at-start.at, gen=process.cpuUsage(generatorStart);
  const perClient=group.map((c,i)=>{const times=c.snapshots.slice(offsets[i].snap);const gaps=times.slice(1).map((v,j)=>v-times[j]);const distance=c.moved-offsets[i].moved;assert.ok(times.length>0);if(moving)assert.ok(distance>.5,`${c.name} did not move: ${distance}`);return {name:c.name,sourceAddress:c.sourceAddress,sentGameMessages:c.sent-offsets[i].sent,sentGameMessagesHz:(c.sent-offsets[i].sent)/(elapsed/1000),snapshots:times.length,hz:times.length/(elapsed/1000),gapMs:distribution(gaps),bytesPerSecond:(c.bytes-offsets[i].bytes)/(elapsed/1000),distance};});
  const result={label,elapsedMs:elapsed,serverCpuPercent:(end.cpuMs-start.cpuMs)/elapsed*100,serverPeakRssMiB:Math.max(...samples.map(s=>s.rssMiB)),generatorCpuPercent:(gen.user+gen.system)/1000/elapsed*100,generatorRssMiB:process.memoryUsage().rss/1024**2,perClient};fs.writeFileSync(path.join(outputDir,`${group.length}-${label}-raw.json`),JSON.stringify({samples,clients:group.map((c,i)=>({name:c.name,snapshotTimes:c.snapshots.slice(offsets[i].snap)}))}));console.log(JSON.stringify({clients:group.length,...result}));return result;
}
try {
  for(const n of tiers){const f=current=await fixture(n);const result={clients:n,phases:[],passed:false};report.tiers.push(result);try{
    await f.start();const group=[];for(let i=0;i<n;i++)group.push(await f.connect(`Load${String(i).padStart(2,'0')}`,randomBytes(20).toString('hex')));
    result.joinMs=distribution(group.map(c=>c.joinMs));await f.until('all peers visible',()=>group.every(c=>group.every(p=>c.snapshot.players.some(q=>q.id===p.id))));
    await f.pause(durations.warmup);if(inputOnly){result.phases.push(await phase(f,group,'browser-like-input',60000,'input'));}else{result.phases.push(await phase(f,group,'idle',durations.idle));result.phases.push(await phase(f,group,'moving',durations.moving,true));}
    // Return the pair to nearby coordinates before social interactions.
    if(!inputOnly){for(const c of group)c.send({t:'move',x:-1.9,z:19.9});await f.until('return to social point',()=>group.every(c=>Math.hypot(c.me.x+1.9,c.me.z-19.9)<1),15000);result.functional=await functional(f,group);}
    const observer=group[0];for(const c of group.slice(1)){c.expectedClose=true;c.ws.close();}await f.until('departed players absent',()=>observer.snapshot.players.length===1);await f.pause(21000);assert.equal(observer.closed,false);result.passed=true;
  }finally{await f.cleanup();result.cleanup='owned server terminated; sockets closed; disposable data removed';fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(report,null,2));}console.log(`PASS ${n} clients; cleanup verified`);}
  console.log(`ALL MULTIPLAYER CHECKS PASSED; results ${outputDir}`);
}catch(e){report.error=e.stack;fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;}finally{clearTimeout(watchdog);await current?.cleanup();}
