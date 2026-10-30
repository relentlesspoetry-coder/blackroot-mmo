import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { sceneLoading, beginSceneLoad, acceptSceneReady, heartbeatExpired, SCENE_LOAD_TIMEOUT_MS } from '../scene-loading.js';
import { validMessage } from '../protocol.js';

const source = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const client = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
function fn(text, name) {
  const i = text.indexOf(`function ${name}(`);
  assert.ok(i >= 0, name);
  return text.slice(i, text.indexOf('\n}', i) + 2);
}
const token = 'a'.repeat(32), otherToken = 'b'.repeat(32);
function socket() {
  return { joined: true, isAlive: false, connectedAt: 0, readyState: 1, OPEN: 1,
    bufferedAmount: 0, sent: [], terminated: 0,
    send(data) { this.sent.push(data); }, terminate() { this.terminated++; } };
}
const ready = receipt => ({ t: 'scene:ready', ...receipt });

test('slow scene receives a bounded grace, then ordinary heartbeat resumes', () => {
  const ws = socket(), receipt = beginSceneLoad(ws, 'a', token, 100);
  assert.equal(heartbeatExpired(ws, 30100), false);
  assert.equal(acceptSceneReady(ws, ready(receipt), 'a', 30100), true);
  assert.equal(ws.isAlive, true); assert.equal(ws.sceneLoad.needsSnapshot, true);
  ws.isAlive = false;
  assert.equal(heartbeatExpired(ws, 30101), true);
});

test('A to B to A rejects stale generations, zone mismatches and duplicates', () => {
  const ws = socket(), first = beginSceneLoad(ws, 'a', token, 0);
  const second = beginSceneLoad(ws, 'b', token, 10);
  const latest = beginSceneLoad(ws, 'a', token, 20);
  assert.deepEqual([first.generation, second.generation, latest.generation], [1, 2, 3]);
  assert.equal(acceptSceneReady(ws, ready(first), 'a', 30), false);
  assert.equal(acceptSceneReady(ws, ready(second), 'a', 30), false);
  assert.equal(acceptSceneReady(ws, ready(latest), 'b', 30), false);
  assert.equal(sceneLoading(ws), true);
  assert.equal(acceptSceneReady(ws, ready(latest), 'a', 30), true);
  ws.sceneLoad.needsSnapshot = false;
  assert.equal(acceptSceneReady(ws, ready(latest), 'a', 40), false);
  assert.equal(ws.sceneLoad.needsSnapshot, false);
});

test('reconnect uses a different connection token even when generation and zone match', () => {
  const old = beginSceneLoad(socket(), 'a', token, 0), ws = socket();
  const current = beginSceneLoad(ws, 'a', otherToken, 0);
  assert.equal(acceptSceneReady(ws, ready(old), 'a', 1), false);
  assert.equal(acceptSceneReady(ws, ready(current), 'a', 1), true);
});

test('never-ready deadline cannot be renewed by transitions or late acknowledgement', () => {
  const ws = socket(); beginSceneLoad(ws, 'a', token, 100);
  const next = beginSceneLoad(ws, 'b', token, SCENE_LOAD_TIMEOUT_MS);
  assert.equal(ws.sceneLoad.deadline, 100 + SCENE_LOAD_TIMEOUT_MS);
  assert.equal(heartbeatExpired(ws, ws.sceneLoad.deadline - 1), false);
  assert.equal(heartbeatExpired(ws, ws.sceneLoad.deadline), true);
  assert.equal(acceptSceneReady(ws, ready(next), 'b', ws.sceneLoad.deadline), false);
  const unjoined = socket(); unjoined.joined = false; unjoined.isAlive = true;
  beginSceneLoad(unjoined, 'a', token, 0);
  assert.equal(heartbeatExpired(unjoined, 15001), true);
});

test('readiness schema requires all fields and rejects malformed generations and tokens', () => {
  const good = ready({ zoneId: 'a', token, generation: 1 });
  assert.equal(validMessage(good), true);
  for (const field of ['zoneId', 'token', 'generation']) {
    const incomplete = { ...good }; delete incomplete[field];
    assert.equal(validMessage(incomplete), false, field);
  }
  for (const generation of [0, -1, 1.5, Infinity, '1', Number.MAX_SAFE_INTEGER + 1])
    assert.equal(validMessage({ ...good, generation }), false);
  for (const value of ['', 'x'.repeat(32), token + 'a', null])
    assert.equal(validMessage({ ...good, token: value }), false);
});

test('large welcome drains alone; snapshots, party, combat and UI sends never form a loading backlog', () => {
  const ws = socket(); beginSceneLoad(ws, 'a', token, 0);
  const context = vm.createContext({ sceneLoading, outbound: null });
  vm.runInContext(fn(source, 'sendRaw'), context);
  const welcome = JSON.stringify({ t: 'welcome', padding: 'x'.repeat(1075000) });
  context.sendRaw(ws, welcome, true);
  assert.equal(ws.sent.length, 1);
  ws.bufferedAmount = Buffer.byteLength(welcome);
  for (let i = 0; i < 100; i++) for (const t of ['snapshot', 'event', 'bag', 'skills', 'abilities', 'status', 'passives', 'objects', 'party', 'chat'])
    context.sendRaw(ws, JSON.stringify({ t }));
  assert.equal(ws.sent.length, 1); assert.equal(ws.terminated, 0);
  assert.equal(Object.keys(ws.sceneLoad).some(k => /queue|events|snapshot$/i.test(k) && k !== 'needsSnapshot'), false);
  const receipt = { ...ws.sceneLoad };
  assert.equal(acceptSceneReady(ws, ready(receipt), 'a', 100), true);
  ws.bufferedAmount = 0; context.sendRaw(ws, '{"t":"snapshot","now":100}');
  assert.equal(ws.sent.length, 2);
  ws.bufferedAmount = 1024 * 1024 + 1;
  context.sendRaw(ws, '{"t":"snapshot","now":101}');
  assert.equal(ws.terminated, 1, 'original output bound remains enforced after readiness');
});

test('a second oversized scene control packet retains the existing buffer protection', () => {
  const ws = socket(); beginSceneLoad(ws, 'a', token, 0); ws.bufferedAmount = 1024 * 1024 + 1;
  const c = vm.createContext({ sceneLoading, outbound: null }); vm.runInContext(fn(source, 'sendRaw'), c);
  c.sendRaw(ws, '{"t":"transition"}', true);
  assert.equal(ws.terminated, 1); assert.equal(ws.sent.length, 0);
});

test('loading leaves damage, monster engagement and lethal hits authoritative', () => {
  const ws = socket(); beginSceneLoad(ws, 'a', token, 0);
  let engagements = 0, deaths = 0;
  const p = { id: 1, ws, hp: 20, alive: true, cls: 'cleric' };
  const monster = { id: 2, name: 'test monster', state: 'combat', targetId: p.id };
  const c = vm.createContext({ Date, Math, clericCtx: {}, mitigate: (_, __, dmg) => ({ dmg, absorbed: 0 }),
    onLethal: (_, __, dmg) => dmg, classDef: () => ({}), REGEN: { combatLockout: 5 },
    engage() { engagements++; }, broadcast() {}, afterHit() {}, sendStatus() {},
    killPlayer(target) { deaths++; target.alive = false; } });
  vm.runInContext(fn(source, 'hurtPlayer'), c);
  c.hurtPlayer(p, 5, monster); assert.equal(p.hp, 15); assert.equal(p.combatTimer, 5);
  assert.equal(engagements, 1); assert.ok(p.lastCombat > 0);
  c.hurtPlayer(p, 20, monster); assert.equal(deaths, 1); assert.equal(p.alive, false);
  assert.equal(sceneLoading(ws), true);
});

function clientFixture() {
  const sent = [], models = new Map(), frames = [], built = [];
  const ws = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  const c = vm.createContext({ ws, WebSocket: { OPEN: 1 }, zoneLoadGeneration: 0, zoneLoading: false,
    resetGameplayInput() {}, document: { getElementById: () => ({}) },
    loadModels: ([id]) => new Promise(resolve => models.set(id, resolve)),
    loadZone: zone => built.push(zone.id), requestAnimationFrame: callback => frames.push(callback), handle() {} });
  vm.runInContext('async ' + fn(client, 'enterZone'), c);
  return { c, sent, models, frames, built, ws };
}

test('client acknowledges matching completed generation only after a rendering opportunity', async () => {
  const f = clientFixture(), receipt = { token, generation: 1 };
  const loading = f.c.enterZone({ id: 'a', models: ['a'] }, receipt);
  assert.equal(f.sent.length, 0);
  f.models.get('a')(); await new Promise(setImmediate);
  assert.deepEqual(f.built, ['a']); assert.equal(f.c.zoneLoading, true);
  assert.equal(f.sent.length, 0); f.frames.shift()();
  assert.equal(f.sent.length, 0); f.frames.shift()(); await loading;
  assert.deepEqual(f.sent, [ready({ zoneId: 'a', token, generation: 1 })]);
  assert.equal(f.c.zoneLoading, false);
});

test('client suppresses stale loads across rapid transitions and reconnects', async () => {
  const f = clientFixture();
  const first = f.c.enterZone({ id: 'a', models: ['a'] }, { token, generation: 1 });
  const last = f.c.enterZone({ id: 'b', models: ['b'] }, { token, generation: 2 });
  f.models.get('a')(); await first;
  assert.deepEqual(f.built, []); assert.equal(f.sent.length, 0);
  f.models.get('b')(); await new Promise(setImmediate);
  f.c.ws = { readyState: 1, send() { assert.fail('stale load sent through replacement socket'); } };
  f.frames.shift()(); f.frames.shift()(); await last;
  assert.equal(f.sent.length, 0);
});

test('load failure never acknowledges readiness', async () => {
  const f = clientFixture(); f.c.loadZone = () => { throw Error('scene construction failed'); };
  const load = f.c.enterZone({ id: 'a', models: ['a'] }, { token, generation: 1 });
  f.models.get('a')(); await load;
  assert.equal(f.sent.length, 0); assert.equal(f.c.zoneLoading, true);
});

function stateFixture(p) {
  const c = vm.createContext({ sceneLoading, outbound: null, trades: new Map(), players: new Map([[p.id, p]]),
    sendBag() {}, sendSkills() {}, sendAbilities() {}, sendStatus() {}, sendPassives() {}, sendObjects() {},
    fogPayload: () => ({}), zoneOf: () => ({}), partyOf: () => null, sendParty() {}, notice() {},
    bagStacks: items => items, TRADE_BREAK_RANGE: 10, tradePairValid: (a, b) => a.zoneId === b.zoneId });
  for (const name of ['sendRaw', 'sendSceneState', 'tradePayload', 'tradeCancel', 'stepTrades']) vm.runInContext(fn(source, name), c);
  vm.runInContext("function send(ws,obj){sendRaw(ws,JSON.stringify(obj))} function tradeOf(p){return trades.get(p.tradeId)||null} function tradePair(t){return [players.get(t.a),players.get(t.b)]}", c);
  return c;
}

test('ready restores trade closure after a portal cancels escrow during loading, and current open trade', () => {
  const p = { id: 1, ws: socket(), zoneId: 'a', tradeId: 7, inventory: [], gold: 0, visited: new Set(), _fogNew: [] };
  const q = { id: 2, ws: socket(), zoneId: 'a', tradeId: 7, inventory: [], gold: 0, name: 'Peer' };
  const c = stateFixture(p); c.players.set(q.id, q);
  const trade = { id: 7, a: 1, b: 2, items: { 1: ['Sword'], 2: [] }, gold: { 1: 3, 2: 0 }, ok: {} }; c.trades.set(7, trade);
  let visibleTrade = { t: 'trade', name: 'Peer' };
  p.zoneId = 'b'; const receipt = beginSceneLoad(p.ws, 'b', token, 0); c.stepTrades();
  assert.equal(p.tradeId, null); assert.deepEqual(p.inventory, ['Sword']); assert.equal(p.gold, 3);
  assert.equal(p.ws.sent.length, 0, 'closure correctly suppressed while scene loads');
  assert.equal(acceptSceneReady(p.ws, ready(receipt), 'b', 1), true); c.sendSceneState(p);
  for (const m of p.ws.sent.map(JSON.parse)) if (m.t === 'trade') visibleTrade = m.closed ? null : m;
  assert.equal(visibleTrade, null, 'fresh state clears stale trade window');
  p.ws.sent.length = 0; p.tradeId = 7; c.trades.set(7, trade); trade.gold[1] = 9; c.sendSceneState(p);
  const current = p.ws.sent.map(JSON.parse).find(m => m.t === 'trade');
  assert.equal(current.myGold, 9); assert.equal(current.name, 'Peer');
});

test('ready rebuilds bounded current invites using remaining TTL and clears expired prompts', () => {
  const p = { id: 1, ws: socket(), visited: new Set(), _fogNew: [], partyInvite: { from: 2, name: 'Peer', t: 4.5 }, duelChallenge: { from: 2, name: 'Peer', t: 0 }, tradeRequest: null };
  stateFixture(p).sendSceneState(p);
  const messages = p.ws.sent.map(JSON.parse);
  assert.deepEqual(messages.find(m => m.t === 'party:invite'), { t: 'party:invite', from: 2, name: 'Peer', seconds: 4.5 });
  for (const t of ['duel:challenge', 'trade:request']) assert.deepEqual(messages.find(m => m.t === t), { t, expired: true });
});

test('editor list request follows successful ready acknowledgement on the same socket', async () => {
  const f = clientFixture(); f.c.EDIT = { on: true, key: 'authorized-editor-key' };
  const load = f.c.enterZone({ id: 'a', models: ['a'] }, { token, generation: 1 });
  f.models.get('a')(); await new Promise(setImmediate); assert.equal(f.sent.length, 0);
  f.frames.shift()(); f.frames.shift()(); await load;
  assert.equal(f.sent[0].t, 'scene:ready');
  assert.deepEqual(f.sent[1], { t: 'edit:list', key: 'authorized-editor-key' });
});
