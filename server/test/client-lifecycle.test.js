import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
// Execute production functions, not copies of their logic. DOM/Three are
// deliberately stubbed: these tests do not claim asset-backed rendering QA.
function fn(name) {
  const match = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(source);
  assert.ok(match, name);
  return source.slice(match.index, source.indexOf('\n}', match.index) + 2);
}
function context(values, names) {
  const c = vm.createContext({ ...values });
  vm.runInContext(names.map(fn).join('\n'), c);
  return c;
}
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('cached flame field reattaches to current scene', () => {
  const scene = { add(mesh) { mesh.parent = this; } }, field = { mesh: { parent: null } };
  const c = context({ scene, flameField: field }, ['getFlameField']);
  assert.equal(c.getFlameField(), field);
  assert.equal(field.mesh.parent, scene);
});

test('zone teardown releases flame resources and all effect ownership', () => {
  let disposed = 0;
  const resource = () => ({ dispose() { disposed++; } });
  const caches = Object.fromEntries(['holyFx', 'sanctFx', 'monFx', 'bossMarks', '_bossEmb', 'hazardFx', 'statusFx', 'castFxMap'].map(k => [k, new Map()]));
  caches.hazardFx.set(1, { g: {} }); caches.statusFx.set(1, { flames: [0] });
  caches.sanctFx.set(1, {});
  const c = context({ ...caches, auraObj: null, momentumObj: null, scene: { remove() {} }, fxList: [], dropHoly() {}, flameField: { mesh: { geometry: resource(), material: { dispose() { disposed++; }, uniforms: { uMask: { value: resource() }, uNoise: { value: resource() } } } } } }, ['dropObj', 'resetZoneEffects']);
  c.resetZoneEffects();
  assert.equal(c.flameField, null); assert.equal(disposed, 4);
  for (const cache of Object.values(caches)) assert.equal(cache.size, 0);
});

test('objects arriving before meshes retain used/spent/lit and remain zone-specific', () => {
  const c = context({ zoneLoading: true, incomingZoneId: 'cave', zone: { id: 'world' }, objectStateByZone: new Map(), worldObjects: new Map(), litObjects: new Set(), applyObjectState() {} }, ['handle', 'restoreObjectState']);
  c.handle({ t: 'objects', used: ['quest'], spent: ['node'], lit: ['lamp'] });
  c.zone = { id: 'cave' }; c.worldObjects.set('quest', {}); c.worldObjects.set('node', {}); c.restoreObjectState();
  assert.equal(c.worldObjects.get('quest').used, true);
  assert.equal(c.worldObjects.get('node').spent, true);
  assert.equal(c.litObjects.has('lamp'), true);
  c.zone = { id: 'other' }; c.restoreObjectState();
  assert.equal(c.worldObjects.get('quest').used, false);
  assert.equal(c.litObjects.size, 0);
});

test('latest zone load wins and snapshots wait for its scene', async () => {
  const pending = new Map(), built = [], replay = [];
  const c = context({ zoneLoadGeneration: 0, zoneLoading: false, pendingZoneSnapshot: null, resetGameplayInput() {}, document: { getElementById: () => ({}) }, loadModels: ([id]) => { const d = defer(); pending.set(id, d); return d.promise; }, loadZone: z => built.push(z.id), handle: m => replay.push(m) }, ['enterZone']);
  const first = c.enterZone({ id: 'old', models: ['old'] });
  const second = c.enterZone({ id: 'new', models: ['new'] });
  c.pendingZoneSnapshot = { t: 'snapshot', players: [] };
  pending.get('new').resolve(); await second;
  pending.get('old').resolve(); await first;
  assert.deepEqual(built, ['new']); assert.equal(replay.length, 1); assert.equal(c.zoneLoading, false);
});

test('snapshot dispatch queues rather than touching old scene during loading', () => {
  const c = context({ zoneLoading: true }, ['handle']);
  const snapshot = { t: 'snapshot' }; c.handle(snapshot);
  assert.equal(c.pendingZoneSnapshot, snapshot);
});

test('action bar repaint preserves authoritative cooldown deadline', () => {
  let now = 1000;
  const ability = { id: 'a', left: 30 };
  const c = context({ performance: { now: () => now }, document: { getElementById: () => ({ querySelectorAll: () => [] }) }, barSlots: Array(8).fill(null), fillBarDefaults() {}, renderSpellbook() {}, refreshDialogue() {}, abilities: [] }, ['handle', 'renderActionBar']);
  c.handle({ t: 'abilities', list: [ability] });
  const deadline = c.abilities[0].readyAt;
  now = 11000; c.renderActionBar(); assert.equal(c.abilities[0].readyAt, deadline);
  assert.equal((deadline - now) / 1000, 20);
  now = 40000; c.renderActionBar(); assert.equal(c.abilities[0].readyAt, deadline);
});

function loginContext() {
  const sockets = [], timers = new Map(), elements = new Map(); let timerId = 0;
  class Socket { static OPEN = 1; constructor() { sockets.push(this); this.readyState = 1; this.sent = []; } send(v) { this.sent.push(JSON.parse(v)); } close() { this.closed = true; this.onclose?.(); } }
  const element = () => ({ style: {}, focus() {}, append() {}, setAttribute() {} });
  const c = context({ WebSocket: Socket, location: { protocol: 'http:', host: 'localhost', reload() {} }, document: { getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); }, createElement: element, body: { append() {} } }, connectionState: 'idle', ws: null, loginTimer: null, playBtn: element(), passInput: { ...element(), value: 'secret' }, setTimeout(f) { timers.set(++timerId, f); return timerId; }, clearTimeout(id) { timers.delete(id); }, resetGameplayInput() {}, handle() {} }, ['connect', 'showLoginError']);
  return { c, sockets, timers, elements };
}

test('transport failure and timeout visibly restore retry and discard stale sockets', () => {
  const { c, sockets, timers, elements } = loginContext();
  c.connect('Hero', 'secret', {}, 'fighter'); const stale = sockets[0].onopen;
  sockets[0].onerror();
  assert.equal(c.connectionState, 'idle'); assert.equal(c.playBtn.disabled, false);
  assert.match(elements.get('loginErr').textContent, /try again/); assert.equal(sockets[0].closed, true);
  c.connect('Hero', 'secret2', {}, 'fighter'); stale();
  assert.equal(sockets[1].sent.length, 0);
  [...timers.values()][0]();
  assert.equal(c.connectionState, 'idle'); assert.match(elements.get('loginErr').textContent, /timed out/);
});

test('welcome clears transport deadline and duplicate welcome cannot restart session', () => {
  const { c, sockets, timers } = loginContext(); let welcomed = 0; c.handle = () => welcomed++;
  c.connect('Hero', 'secret', {}, 'fighter'); sockets[0].onopen();
  sockets[0].onmessage({ data: '{"t":"welcome"}' }); sockets[0].onmessage({ data: '{"t":"welcome"}' });
  assert.equal(timers.size, 0); assert.equal(welcomed, 1); assert.equal(c.connectionState, 'authenticated');
});

test('play is single-flight even while core assets are pending', async () => {
  const pending = defer(); let connections = 0;
  const c = context({ connectionState: 'idle', nameInput: { value: 'Hero' }, passInput: { value: 'secret' }, currentLook: () => ({}), localStorage: { setItem() {} }, document: { getElementById: () => ({ style: {} }) }, playBtn: {}, modelsDone: false, modelsReady: pending.promise, pickedClass: 'fighter', connect() { connections++; c.connectionState = 'connecting'; } }, ['play']);
  const one = c.play(); await c.play(); pending.resolve(); await one;
  assert.equal(connections, 1);
});

test('editable, form, modal and hidden contexts suppress gameplay keys', () => {
  const c = context({ connectionState: 'authenticated', zoneLoading: false, document: { hidden: false, activeElement: null, querySelector: () => null }, settingsEl: { classList: { contains: () => false } } }, ['gameplayInputBlocked']);
  for (const tag of ['input', 'textarea', 'select', 'button', 'form', '[role="dialog"]']) {
    assert.equal(c.gameplayInputBlocked({ target: { closest: selector => selector.includes(tag) }, key: '1' }), true, tag);
  }
  assert.equal(c.gameplayInputBlocked({ target: { isContentEditable: true }, key: 'w' }), true);
  assert.equal(c.gameplayInputBlocked({ target: {}, key: 'w' }), false);
  c.document.hidden = true; assert.equal(c.gameplayInputBlocked({ target: {}, key: 'w' }), true);
});

test('focus loss clears latched movement and sends neutral input', () => {
  const sent = [];
  const c = context({ keys: { w: true, a: true }, dragging: true, jump: { active: true }, camYaw: 1, ws: { readyState: 1, send: s => sent.push(JSON.parse(s)) }, WebSocket: { OPEN: 1 } }, ['resetGameplayInput']);
  c.resetGameplayInput();
  assert.equal(c.keys.w, false); assert.equal(c.keys.a, false); assert.equal(c.dragging, false);
  assert.deepEqual(sent[0], { t: 'input', f: 0, r: 0, yaw: 1 + Math.PI });
  assert.match(source, /addEventListener\('blur', resetGameplayInput\)/);
  assert.match(source, /visibilitychange.*document.hidden.*resetGameplayInput/);
});

test('deferred object model cannot attach to a replaced zone record', async () => {
  const pending = defer(); let clones = 0;
  class Group { constructor() { this.position = { set() {} }; this.rotation = {}; } add() {} }
  const c = context({ THREE: { Group }, zone: { objects: [{ id: 'object', x: 0, z: 0, m: 'model' }] }, zoneLoading: false, groundY: () => 0, scene: { add() {} }, worldObjects: new Map(), loadModels: () => pending.promise, cloneModel() { clones++; }, modelKey: x => x, applyObjectStates() {}, applyObjectState() {} }, ['buildWorldObjects']);
  c.buildWorldObjects(); c.worldObjects.clear();
  pending.resolve(); await pending.promise; await Promise.resolve();
  assert.equal(clones, 0);
});

test('delayed boss effects do not leak through a zone transition', () => {
  let callback, fired = 0;
  const c = context({ zoneLoadGeneration: 1, zoneLoading: false, setTimeout(fn) { callback = fn; } }, ['zoneEffectTimeout']);
  c.zoneEffectTimeout(() => fired++, 100); c.zoneLoadGeneration++; callback();
  assert.equal(fired, 0);
  c.zoneEffectTimeout(() => fired++, 100); callback(); assert.equal(fired, 1);
});

test('used replacement model wins even when original model loads last', async () => {
  const pending = { base: defer(), doused: defer() };
  class Group {
    constructor() { this.position = { set() {} }; this.rotation = {}; this.children = []; }
    add(o) { this.children.push(o); } remove(o) { this.children = this.children.filter(c => c !== o); } traverse() {}
  }
  const c = context({ THREE: { Group }, zone: { id: 'world', objects: [{ id: 'object', x: 0, z: 0, m: 'base', doused: 'doused' }] }, zoneLoading: false, groundY: () => 0, scene: { add() {} }, worldObjects: new Map(), objectStateByZone: new Map([['world', { used: new Set(['object']), spent: new Set(), lit: new Set() }]]), loadModels: ([id]) => pending[id].promise, cloneModel: name => ({ name, isObject3D: true, traverse() {} }), modelKey: x => x }, ['buildWorldObjects', 'applyObjectState', 'applyObjectStates', 'restoreObjectState']);
  c.buildWorldObjects(); c.restoreObjectState();
  pending.doused.resolve(); await pending.doused.promise; await Promise.resolve();
  pending.base.resolve(); await pending.base.promise; await Promise.resolve();
  assert.deepEqual(c.worldObjects.get('object').group.children.map(g => g.name), ['doused']);
});
