// Real sockets, unchanged security bounds, disposable storage and an owned port.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blackroot-scene-test-'));
const clients = [], start = Date.now();
let server, output = '', failure;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(label, predicate, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (failure) throw failure;
    if (predicate()) return;
    await sleep(25);
  }
  throw Error(`Timed out: ${label}; server=${output.slice(-1500)}`);
}
const deadline = setTimeout(() => { failure = Error('Overall 160-second deadline'); }, 160000);
async function connect(name, pass = randomBytes(20).toString('hex'), autoPong = true) {
  const c = { name, pass, messages: [], snapshots: [], pings: 0, ready: false, connectedAt: Date.now() };
  const ws = c.ws = new WebSocket(`ws://127.0.0.1:${port}`, { autoPong: false }); clients.push(c);
  c.send = value => ws.send(JSON.stringify(value));
  ws.on('error', error => { failure = error; });
  ws.on('close', (code, reason) => { c.closed = { code, reason: reason.toString(), elapsedMs: Date.now() - c.connectedAt }; });
  ws.on('ping', data => { c.pings++; if (autoPong || c.ready) ws.pong(data); });
  ws.on('message', raw => {
    const m = JSON.parse(raw); c.messages.push(m);
    if (m.t === 'welcome') c.welcome = m;
    if (m.t === 'snapshot') c.snapshots.push(m);
  });
  await once(ws, 'open'); c.send({ t: 'join', name, pass, cls: 'fighter' });
  await until('welcome', () => c.welcome);
  c.ack = () => { c.ready = true; c.ackAt = Date.now(); c.send({ t: 'scene:ready', ...c.welcome.scene }); };
  return c;
}
let port;
try {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  server = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), BLACKROOT_DATA_DIR: dir, EDITOR_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.on('error', error => { failure = error; });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', data => { output = (output + data).slice(-16000); });
  await until('owned server startup', () => output.includes('Open http'), 30000);
  const never = await connect('NeverReady');
  const slow = await connect('SlowReady', undefined, false);
  const peer = await connect('ReadyPeer'); peer.ack();
  await until('ready peer snapshot', () => peer.snapshots.length);
  const before = peer.snapshots.at(-1).players.find(p => p.id === slow.welcome.id);
  slow.send({ t: 'input', f: 1, r: 0, yaw: 0 });
  slow.send({ t: 'scene:ready', ...slow.welcome.scene, generation: 999 });
  await sleep(25000);
  assert.equal(slow.ws.readyState, WebSocket.OPEN); assert.ok(slow.pings >= 2);
  assert.equal(slow.messages.length, 1, 'only welcome sent while loading, including no UI/event backlog');
  assert.ok(Buffer.byteLength(JSON.stringify(slow.welcome)) > 1024 * 1024);
  const after = peer.snapshots.at(-1).players.find(p => p.id === slow.welcome.id);
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < 0.1, 'gameplay input before readiness refused');
  slow.ack();
  const expected = ['bag', 'quests', 'skills', 'abilities', 'status', 'passives', 'objects', 'fog:sync', 'party'];
  await until('fresh state and snapshot after delayed readiness', () => expected.every(t => slow.messages.some(m => m.t === t)) && slow.snapshots.length);
  assert.ok(slow.snapshots[0].now >= slow.ackAt, 'first snapshot represents current world, not queued history');
  const bags = slow.messages.filter(m => m.t === 'bag').length;
  slow.send({ t: 'scene:ready', ...slow.welcome.scene }); await sleep(250);
  assert.equal(slow.messages.filter(m => m.t === 'bag').length, bags, 'duplicate acknowledgement does not replay state');
  const position = slow.snapshots.at(-1).players.find(p => p.id === slow.welcome.id);
  slow.send({ t: 'input', f: 1, r: 0, yaw: 0 }); await sleep(600); slow.send({ t: 'input', f: 0, r: 0, yaw: 0 });
  await until('movement after readiness', () => {
    const p = slow.snapshots.at(-1).players.find(p => p.id === slow.welcome.id);
    return Math.hypot(p.x - position.x, p.z - position.z) > 1;
  });
  console.log('PASS 25-second load without pong or output buildup; fresh complete state; input gating; duplicate ready; normal snapshots and movement');
  const oldReceipt = slow.welcome.scene;
  slow.ws.close(1000, 'reconnect test'); await until('old socket closed', () => slow.closed);
  const again = await connect(slow.name, slow.pass);
  again.send({ t: 'scene:ready', ...oldReceipt }); await sleep(250);
  assert.equal(again.messages.length, 1, 'previous connection receipt cannot release new scene');
  again.ack(); await until('reconnected snapshot', () => again.snapshots.length);
  console.log('PASS reconnect rejects old connection token and resumes with its new receipt');
  await until('never-ready client disconnected on fixed deadline', () => never.closed, 135000 - (Date.now() - never.connectedAt));
  assert.equal(never.messages.length, 1); assert.equal(never.closed.code, 1006);
  assert.ok(never.closed.elapsedMs >= 120000 && never.closed.elapsedMs < 132000);
  console.log('PASS never-ready client bounded despite answering heartbeats', JSON.stringify(never.closed));
  console.log(JSON.stringify({ port, elapsedMs: Date.now() - start, result: 'ALL SCENE LOADING LIVE CHECKS PASSED' }));
} finally {
  clearTimeout(deadline);
  for (const c of clients) c.ws.terminate();
  if (server && server.exitCode === null && server.signalCode === null) {
    const ended = once(server, 'exit'); server.kill('SIGTERM');
    const kill = setTimeout(() => server.kill('SIGKILL'), 5000);
    await ended; clearTimeout(kill);
  }
  await fs.rm(dir, { recursive: true, force: true });
}
