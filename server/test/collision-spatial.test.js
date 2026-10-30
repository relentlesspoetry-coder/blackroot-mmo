import test from 'node:test';
import assert from 'node:assert/strict';
import { sceneryCandidates, invalidateSceneryArray } from '../collision-spatial.js';
import { resolveCollision, invalidateCollisionScenery } from '../collision.js';
import { resolveCollision as baseline } from './fixtures/collision-linear-oracle.js';

const radiusOf = o => o.r;
const zoneFor = objects => ({ bounds: { minX: -1e7, maxX: 1e7, minZ: -1e7, maxZ: 1e7 }, _scatter: objects });
function parity(zone, position = { x: 0.1, z: 0 }, radius = 0.5) {
  const a = { ...position }, b = { ...position };
  baseline(zone, a, radius); resolveCollision(zone, b, radius);
  assert.deepEqual(b, a);
  return b;
}

test('broad phase examines nearby objects in original order', () => {
  const objects = Array.from({ length: 10000 }, (_, i) => ({ x: i * 32, z: 0, r: 1 }));
  assert.deepEqual([...sceneryCandidates(objects, { x: 65, z: 0 }, 0.5, radiusOf)], [objects[2]]);
});

test('a displacement discovers later far-away objects without revisiting earlier ones', () => {
  const objects = [{ x: 80, z: 0, r: 2 }, { x: 0, z: 0, r: 2 }, { x: 80, z: 0, r: 2 }];
  const ent = { x: 0, z: 0 }, seen = [];
  for (const o of sceneryCandidates(objects, ent, 0.5, radiusOf)) {
    seen.push(objects.indexOf(o));
    ent.x = 80;
  }
  assert.deepEqual(seen, [1, 2]);
});

test('huge obstacles and unusual entity radii retain exact collision semantics', () => {
  const zone = zoneFor([{ x: 0, z: 0, c: 1, s: 20000 }, { x: 20001, z: 0, c: 1, s: 2 }]);
  for (const radius of [0, 0.5, 50, 20000, -1, Infinity, NaN]) parity(zone, undefined, radius);
});

test('replacement, length changes, and explicit invalidation keep scenery current', () => {
  const zone = zoneFor([{ x: 100, z: 0, c: 1, s: 2 }]);
  parity(zone);
  zone._scatter[0].x = 0;
  invalidateCollisionScenery(zone);
  assert.notEqual(parity(zone).x, 0.1);
  zone._scatter.push({ x: 3, z: 0, c: 1, s: 2 }); parity(zone);
  zone._scatter.shift(); parity(zone);
  zone._scatter = [{ x: 0, z: 0, c: 1, s: 50 }]; parity(zone);
  zone._scatter.push({ x: 51, z: 0, c: 1, s: 2 }); parity(zone);
  zone._scatter.reverse(); invalidateCollisionScenery(zone); parity(zone);
  zone._scatter[0].c = 0; invalidateSceneryArray(zone._scatter); parity(zone);
});

test('live editor moves and deletes never require scenery invalidation', () => {
  const zone = zoneFor([{ x: 100, z: 0, c: 1, s: 2 }]);
  zone._editObjects = [{ x: 100, z: 0, c: 2, s: 1, m: 'prop' }];
  parity(zone);
  zone._editObjects[0].x = 0; assert.notEqual(parity(zone).x, 0.1);
  zone._editObjects[0] = { x: 0, z: 0, c: 1, m: 'prim:box', w: 8, d: 4, h: 3, yaw: 0.7 }; parity(zone);
  zone._editObjects.length = 0; assert.equal(parity(zone).x, 0.1);
});
