import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { prepareZone } from '../worldgen.js';
import { blackroot } from '../zones/blackroot.js';
import { darkwoods } from '../zones/darkwoods.js';
import { resolveCollision } from '../collision.js';

// Measured from client/models/farm/Farm_Gate.glb at 891c1cc5:
// blob SHA 4add4a78ff25603cb43cdc9b4c4c1cc553e1e472. Native post centers
// are x=-1/+1, y=.65; bakeModel centers X/Z, seats Y, and keeps native units.
const nativePosts = [-1, 1];
const source = readFileSync(new URL('../../client/index.html', import.meta.url), 'utf8');
const start = source.indexOf('function placeInstances(');
const placement = source.slice(start, source.indexOf('\n}', start) + 2);
function renderedMatrix(item) {
  let matrix;
  const context = vm.createContext({
    THREE, UP: new THREE.Vector3(0, 1, 0), NATIVE: 0,
    SWAY_MODEL: /never-match/, NO_SWAY_MODEL: /never-match/,
    bakeModel: () => [{ geo: {}, mat: {} }],
    chunkedInstances: (geo, mat, items, place) => {
      place(items[0], 0, {setMatrixAt: (i, m) => {matrix = m.clone();}});
      return [];
    },
  });
  vm.runInContext(placement, context);
  context.placeInstances([item], () => 0);
  return matrix;
}
const prepared = structuredClone(blackroot);
prepareZone(prepared);
const gates = prepared._scatter.filter(p => p.m === 'Farm_Gate');

test('both farm gate posts attach to authored fence endpoints after real client placement', () => {
  assert.equal(gates.length, 2);
  for (const gate of gates) {
    const matrix = renderedMatrix(gate);
    for (const x of nativePosts) {
      const post = new THREE.Vector3(x, 0, 0).applyMatrix4(matrix);
      const distance = Math.min(...blackroot.fences.flatMap(f => [
        Math.hypot(post.x - f.x1, post.z - f.z1),
        Math.hypot(post.x - f.x2, post.z - f.z2),
      ]));
      // Cow enclosure coordinates were rounded to 0.1 m by the authoring tool.
      assert.ok(distance < .05, `gate ${gate.x},${gate.z}: detached by ${distance}m`);
    }
    const scale = new THREE.Vector3().setFromMatrixScale(matrix);
    assert.deepEqual(scale.toArray().map(v => +v.toFixed(6)), [2, 1, 1]);
  }
});

test('zone rebuild source retains the same gate width as generated Blackroot', () => {
  assert.deepEqual(darkwoods.props.filter(p => p.m === 'Farm_Gate'), blackroot.props.filter(p => p.m === 'Farm_Gate'));
});

test('length scaling survives worldgen serialization without changing ordinary props', () => {
  const wire = JSON.parse(JSON.stringify(prepared._scatter));
  assert.ok(wire.filter(p => p.m === 'Farm_Gate').every(p => p.sx === 2 && p.s === 1 && p.c === 0));
  assert.ok(wire.filter(p => p.m === 'Farm_Fence').every(p => !Object.hasOwn(p, 'sx')));
});

test('visual repair leaves collision fence endpoints and existing gate passages unchanged', () => {
  for (const fence of blackroot.fences) {
    assert.ok(prepared._walls.some(w => w.x1 === fence.x1 && w.z1 === fence.z1 && w.x2 === fence.x2 && w.z2 === fence.z2));
  }
  // Static decorative gates remain nonblocking; this fix must not add an
  // invisible wall to a passage or silently introduce new gate gameplay.
  const zone = {bounds: blackroot.bounds, _walls: prepared._walls.slice(-blackroot.fences.length), _scatter: gates};
  for (const gate of gates) {
    for (const offset of [-.8, 0, .8]) {
      const input = {x: gate.x + Math.sin(gate.r) * offset, z: gate.z + Math.cos(gate.r) * offset};
      const actual = {...input};
      resolveCollision(zone, actual, .55);
      assert.deepEqual(actual, input);
    }
  }
});
