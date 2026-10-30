// Real-auth, disposable two-client passive loadout regression. No production hooks.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import WebSocket from 'ws';
import { xpTotalForLevel } from '../balance.js';

const root = new URL('..', import.meta.url);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackroot-passives-'));
const results = process.env.PASSIVE_RESULTS || fs.mkdtempSync(path.join(os.tmpdir(), 'blackroot-passive-results-'));
fs.mkdirSync(results, { recursive: true });
const report = { startedAt: new Date().toISOString(), checks: [], hashes: {} };
for (const file of ['server.js', 'passives.js', 'protocol.js']) report.hashes[file] = createHash('sha256').update(fs.readFileSync(new URL(file, root))).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clients = [];
let child, port, failure, output = '', lastJoin = 0, request = 0, cleaned = false;
const check = () => {
  if (failure) throw failure;
  if (child && (child.exitCode !== null || child.signalCode !== null)) throw Error(`Server exited ${child.exitCode}/${child.signalCode}`);
  for (const c of clients) if (c.closed && !c.expectedClose) throw Error(`Unexpected close ${c.name}`);
};
async function until(label, predicate, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { check(); if (predicate()) return; await sleep(25); }
  throw Error(`Timeout: ${label}`);
}
async function start() {
  const offset = output.length;
  child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, PORT: String(port), BLACKROOT_DATA_DIR: dir, DATA_DIR: dir, EDITOR_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', error => { failure = error; });
  const append = chunk => { output += chunk; if (output.length > 1000000) failure = Error('Server log exceeded safety cap'); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  await until('startup', () => output.slice(offset).includes('Open http'), 30000);
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit'); child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    try { await ended; } finally { clearTimeout(timer); }
  }
}
async function cleanup() {
  if (cleaned) return; cleaned = true;
  for (const c of clients) { c.expectedClose = true; c.ws.terminate(); }
  await stop(); fs.writeFileSync(path.join(results, 'server.log'), output);
  fs.rmSync(dir, { recursive: true, force: true }); assert.equal(fs.existsSync(dir), false);
  report.cleanup = 'Owned server stopped, sockets closed, disposable accounts removed';
  fs.writeFileSync(path.join(results, 'report.json'), JSON.stringify(report, null, 2));
}
const deadline = setTimeout(() => { report.error = 'Overall 180-second deadline exceeded'; cleanup().finally(() => process.exit(1)); }, 180000);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { report.error = signal; cleanup().finally(() => process.exit(130)); });
async function connect(name, pass, cls = 'fighter') {
  await sleep(Math.max(0, lastJoin + 5100 - Date.now())); lastJoin = Date.now();
  const c = { name, pass, cls, events: [], closed: false, expectedClose: false };
  c.ws = new WebSocket(`ws://127.0.0.1:${port}`); clients.push(c);
  c.ws.on('error', error => { if (!c.expectedClose) failure = error; });
  c.ws.on('close', () => { c.closed = true; });
  c.ws.on('message', raw => {
    try {
      const m = JSON.parse(raw);
      if (m.t === 'welcome' || m.t === 'transition') c.ws.send(JSON.stringify({ t: 'scene:ready', ...m.scene }));
      if (m.t === 'loginfail') throw Error(`Login rejected: ${m.text}`);
      if (m.t === 'welcome') c.id = m.id;
      if (m.t === 'passives') c.passives = m;
      if (m.t === 'snapshot') { c.me = m.players.find(p => p.id === c.id); c.snapshot = m; }
      c.events.push(m); if (c.events.length > 120) c.events.shift();
    } catch (error) { failure = error; }
  });
  await until('socket open', () => c.ws.readyState === WebSocket.OPEN);
  c.send = value => c.ws.send(JSON.stringify(value));
  c.send({ t: 'join', name, pass, cls });
  await until('authenticated initial passive state and snapshot', () => c.id && c.me && c.passives);
  return c;
}
const checkpoint = () => JSON.parse(fs.readFileSync(path.join(dir, 'saves/world.checkpoint.json'), 'utf8'));
async function set(c, ids, expected) {
  const requestId = `passive-live-${++request}`;
  c.send({ t: 'passives:set', ids, requestId });
  let reply;
  await until('correlated passive acknowledgement', () => (reply = c.events.find(m => m.t === 'passives:result' && m.requestId === requestId)));
  assert.equal(reply.ok, expected); if (!expected) assert.ok(reply.reason);
  return reply;
}
function pass(label) { report.checks.push(label); console.log(`PASS ${label}`); }
try {
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  fs.mkdirSync(path.join(dir, 'saves'));
  const thresholds = [5, 10, 15, 20, 25, 30, 35];
  const legacyExpected = ['heavy_hands', 'keen_edge'];
  const fixtures = [
    { name: 'PassiveA', cls: 'fighter', level: 35, passives: [] },
    { name: 'PassiveB', cls: 'fighter', level: 29, passives: [...legacyExpected, 'ironhide'] },
    ...thresholds.flatMap(level => [level - 1, level].map(level => ({ name: `Gate${level}`, cls: 'cleric', level, passives: [] }))),
  ];
  for (const fixture of fixtures) fs.writeFileSync(path.join(dir, 'saves', fixture.name.toLowerCase() + '.json'), JSON.stringify({ v: 1, zoneId: 'blackroot', gold: 5, hp: 25, mana: 0, known: [], inventory: ['Bronze Dagger'], equipment: {}, x: -1.9, z: 19.9, ...fixture, xp: xpTotalForLevel(fixture.level) }));
  await start();
  // Boundary fixtures use real XP and ordinary authentication, never editor level changes.
  for (const [index, level] of thresholds.entries()) {
    const pair = [];
    for (const actual of [level - 1, level]) pair.push(await connect(`Gate${actual}`, randomBytes(20).toString('hex'), 'cleric'));
    for (const [side, c] of pair.entries()) {
      const actual = level - 1 + side;
      const slots = actual >= 30 ? 3 : actual >= 15 ? 2 : actual >= 5 ? 1 : 0;
      assert.equal(c.me.level, actual); assert.equal(c.passives.limit, slots);
      assert.deepEqual(c.passives.slotLevels, [5, 15, 30]);
      assert.deepEqual(c.passives.catalogue.map(p => p.level), thresholds);
      const choice = c.passives.catalogue[index]; assert.equal(choice.available, side === 1);
      await set(c, [choice.id], side === 1);
      const available = c.passives.catalogue.filter(p => p.available).map(p => p.id);
      const equipped = available.slice(0, slots);
      await set(c, equipped, true);
      await until('boundary selection persisted', () => JSON.stringify(checkpoint().characters[c.name].passives) === JSON.stringify(equipped));
      assert.deepEqual(c.passives.equipped, equipped);
      if (available.length > slots && slots < 3) { await set(c, available.slice(0, slots + 1), false); assert.deepEqual(c.passives.equipped, equipped); }
      assert.equal(c.me.hp, 25);
    }
    for (const c of pair) { c.expectedClose = true; c.ws.close(); }
    await until('boundary pair disconnected', () => pair.every(c => c.closed));
    pass(`unlock ${level - 1}/${level} boundary, dynamic slot capacity, valid XP and durable selection`);
  }
  let a = await connect('PassiveA', randomBytes(20).toString('hex'));
  let b = await connect('PassiveB', randomBytes(20).toString('hex'));
  for (const c of [a, b]) { assert.equal(c.passives.catalogue.length, 7); assert.equal(c.passives.locked, false); assert.equal(c.me.hp, 25); }
  assert.equal(a.passives.limit, 3); assert.deepEqual(a.passives.equipped, []);
  assert.equal(b.passives.limit, 2); assert.deepEqual(b.passives.equipped, legacyExpected);
  assert.deepEqual(checkpoint().characters.PassiveB.passives, legacyExpected);
  pass('level-35 three-slot fixture; level-29 legacy over-capacity loadout sanitized to first two choices');
  let selected = ['heavy_hands', 'keen_edge', 'ironhide'];
  await set(a, selected, true);
  await until('authoritative loadout and durable checkpoint', () => JSON.stringify(a.passives.equipped) === JSON.stringify(selected) && JSON.stringify(checkpoint().characters.PassiveA.passives) === JSON.stringify(selected));
  assert.deepEqual(b.passives.equipped, legacyExpected); assert.equal(a.me.hp, 25);
  pass('three valid choices acknowledged, authoritative state, durable save, peer isolation and no HP refill');
  for (const ids of [['grace'], ['keen_edge', 'keen_edge'], ['momentum']]) { await set(a, ids, false); assert.deepEqual(a.passives.equipped, selected); assert.deepEqual(checkpoint().characters.PassiveA.passives, selected); }
  a.events = []; a.send({ t: 'passives:set', ids: ['heavy_hands', 'keen_edge', 'ironhide', 'last_stand'], requestId: 'over-limit' });
  await sleep(300); check(); assert.deepEqual(a.passives.equipped, selected); assert.deepEqual(checkpoint().characters.PassiveA.passives, selected); assert.ok(!a.events.some(m => m.t === 'passives:result' && m.requestId === 'over-limit' && m.ok));
  pass('foreign, duplicate, unavailable Momentum and over-limit requests cannot mutate loadout');
  selected = ['last_stand']; await set(a, selected, true);
  await until('replacement persisted', () => JSON.stringify(checkpoint().characters.PassiveA.passives) === JSON.stringify(selected));
  assert.equal(a.me.hp, 25);
  a.events = []; b.events = []; a.send({ t: 'duel:challenge', id: b.id });
  await until('duel invitation', () => b.events.some(m => m.t === 'duel:challenge' && m.from === a.id)); b.send({ t: 'duel:accept' });
  await until('duel loadout lock', () => a.passives.locked && /duel/i.test(a.passives.reason));
  await set(a, [], false); assert.deepEqual(a.passives.equipped, selected); a.send({ t: 'duel:yield' });
  await until('duel lock released', () => !a.passives.locked); assert.equal(a.me.hp, 25);
  pass('actual duel countdown locks selection; rejection preserves loadout and cancellation does not heal');
  a.expectedClose = true; a.ws.close(); await until('logout', () => a.closed);
  const old = a; a = await connect(old.name, old.pass); assert.deepEqual(a.passives.equipped, selected); assert.equal(a.me.hp, 25);
  pass('authenticated reconnect restores selected passive without refill');
  b.expectedClose = true; b.ws.close(); await until('legacy owner logout', () => b.closed);
  const previousB = b; b = await connect(previousB.name, previousB.pass);
  assert.deepEqual(b.passives.equipped, legacyExpected);
  pass('sanitized legacy over-capacity selection survives authenticated reconnect');
  for (const c of [a, b]) { c.expectedClose = true; c.ws.terminate(); }
  await stop(); await start();
  const oldA = a, oldB = b; b = await connect(oldB.name, oldB.pass); a = await connect(oldA.name, oldA.pass);
  assert.deepEqual(a.passives.equipped, selected); assert.deepEqual(b.passives.equipped, legacyExpected); assert.equal(a.me.hp, 25);
  await set(a, [], true); await until('empty loadout persisted', () => checkpoint().characters.PassiveA.passives.length === 0);
  pass('full restart and reverse-order reconnect preserve ownership; explicit empty selection saves');
  report.passed = true; console.log(`ALL PASSIVE LOADOUT LIVE CHECKS PASSED; results ${results}`);
} catch (error) { report.passed = false; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally { clearTimeout(deadline); await cleanup(); }
