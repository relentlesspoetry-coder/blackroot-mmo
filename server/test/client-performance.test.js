import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
const helper = source.split('// BEGIN BLACKROOT PERF')[1].split('// END BLACKROOT PERF')[0];
function harness(search = '') {
  let now = 0, reads = 0;
  const window = {};
  const context = vm.createContext({ window, location: { search }, URLSearchParams,
    performance: { now: () => { reads++; return now; } } });
  vm.runInContext(helper + '\nglobalThis.internal = bkPerf; globalThis.measure = _pf;', context);
  return { ...context, api: window.__bkPerf, tick: ms => { now += ms; }, reads: () => reads };
}
test('disabled profiler does not read clocks or retain measurements and preserves returns/errors', () => {
  const h = harness(); let calls = 0;
  assert.equal(h.measure('render', () => { calls++; return 7; }), 7);
  assert.throws(() => h.measure('render', () => { throw Error('same'); }), /same/);
  assert.equal(h.internal.beginFrame(), null);
  assert.equal(calls, 1); assert.equal(h.reads(), 0);
  assert.equal(Object.keys(h.api.report().frame).length, 0);
});
test('enabled frame sections, totals and other have disjoint accounting; reports are detached', () => {
  const h = harness(); h.api.start(); const frame = h.internal.beginFrame();
  h.tick(2); h.measure('render', () => h.tick(5)); h.tick(3); h.internal.endFrame(frame);
  const report = h.api.report();
  assert.equal(report.frame.total.totalMs, 10); assert.equal(report.frame.render.totalMs, 5);
  assert.equal(report.frame.other.totalMs, 5); assert.equal(report.frame.total.calls, 1);
  report.frame.total.totalMs = -5; assert.equal(h.api.report().frame.total.totalMs, 10);
  assert.equal(Object.isFrozen(h.api), true);
  assert.throws(() => { h.window.__bkPerf = {}; }, TypeError);
  h.api.stop(); assert.equal(h.api.report().enabled, false);
});
test('legacy enablement records section sums and frames, including thrown frames', () => {
  const h = harness(); h.window.__bkProf = {}; const frame = h.internal.beginFrame();
  try { h.measure('fireflies', () => { h.tick(8); throw Error('boom'); }); }
  catch {} finally { h.internal.endFrame(frame); }
  assert.equal(h.window.__bkProf.fireflies, 8); assert.equal(h.window.__bkProf.frames, 1);
  assert.equal(h.api.report().frame.fireflies.calls, 1);
  assert.equal(h.api.report().frame.fireflies.maxMs, 8);
  h.api.reset(); assert.equal(Object.keys(h.api.report().frame).length, 0);
  assert.equal(Object.keys(h.window.__bkProf).length, 0);
});
test('startup async duration covers settlement and finally records failures, with reset isolation', async () => {
  const h = harness('?perf=1');
  async function stage(fail) {
    const token = h.internal.begin('startup', 'assetModels');
    try { h.tick(2); await Promise.resolve(); h.tick(9); if (fail) throw Error('failed'); return 3; }
    finally { h.internal.end(token); }
  }
  assert.equal(await stage(false), 3); await assert.rejects(stage(true), /failed/);
  const r = h.api.report().startup.assetModels;
  assert.equal(r.calls, 2); assert.equal(r.totalMs, 22); assert.equal(r.maxMs, 11);
  const stale = h.internal.begin('startup', 'wardrobe'); h.api.reset(); h.internal.end(stale);
  assert.equal(Object.keys(h.api.report().startup).length, 0);
});
test('measurement storage is bounded, even for unintended dynamic labels', () => {
  const h = harness('?perf=1');
  for (let i = 0; i < 1000; i++) h.measure('section' + i, () => h.tick(1));
  assert.equal(Object.keys(h.api.report().frame).length, 64);
});
test('actual client covers previously omitted frame work and all principal startup phases', () => {
  const animate = source.slice(source.indexOf('function animate() {'), source.indexOf('// Boot\n'));
  for (const name of ['ambientFish','fishingSpots','fireflies','loadingRender','render','cull'])
    assert.ok(animate.includes(`_pf('${name}',`), name);
  assert.ok(animate.includes('finally { bkPerf.endFrame(perfFrame); }'));
  for (const name of ['ground','dirt','water','scatter','npcs','forest','details','fireflies','critters'])
    assert.ok(source.includes(`_ps('${name}',`), name);
  for (const name of ['assetModels','loadZone','buildZone','enterZone','wardrobe'])
    assert.ok(source.includes(`bkPerf.begin('startup', '${name}')`), name);
  assert.ok(source.includes('wardrobeLoading.finally(() => bkPerf.end(perfWardrobe))'));
});
test('production loadModels measures the whole async wait and failed progress callback', async () => {
  const h = harness('?perf=1');
  let settle;
  Object.assign(h, {});
  const c = vm.createContext({ window: h.window, bkPerf: h.internal,
    LOADED: {}, LOADED_ANIM: {}, modelKey: p => p,
    gltfLoader: { loadAsync: () => new Promise(resolve => { settle = resolve; }) },
    ensureNormals() {}, shareTiles() {}, console });
  const start = source.indexOf('async function loadModels(');
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), c);
  const promise = c.loadModels(['one'], () => { throw Error('progress'); });
  h.tick(13); assert.equal(h.api.report().startup.assetModels, undefined);
  settle({ scene: {} }); await assert.rejects(promise, /progress/);
  assert.equal(h.api.report().startup.assetModels.totalMs, 13);
  assert.equal(h.api.report().startup.assetModels.calls, 1);
});
