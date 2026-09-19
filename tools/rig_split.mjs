// Split a merged character GLB into named, pivoted parts so the engine can
// animate it. Run from the repo root:
//
//   npm i -D @gltf-transform/core
//   node tools/rig_split.mjs
//
// Why this exists: none of the character models are rigged, and most are a
// single merged mesh, so there is nothing for code to move. Proper skinning in
// Blender is the right long-term answer. Short of that, a mesh can still be cut
// into parts along material and geometric lines, each part given a sensible
// pivot, and those parts rotated -- which is enough for a wing flap, a walk
// cycle and a weapon swing.
//
// The output is an ordinary GLB with a node hierarchy. It opens in Blender, and
// the parts are named the same way the hand-authored spiders name theirs, so
// client/index.html's buildRig() finds them with no special cases.

import { NodeIO } from '@gltf-transform/core';
import fs from 'fs';
import path from 'path';

const MODELS = 'client/models';

// A part is: a name, a test against a triangle, and where its pivot sits.
// Tests run in order; the first match wins, so put specific parts first.
const SPECS = {
  Bat: {
    parts: [
      { name: 'Wing_L', test: (c, m) => isWing(m) && c.x > 0, pivot: 'inner' },
      { name: 'Wing_R', test: (c, m) => isWing(m) && c.x < 0, pivot: 'inner' },
      { name: 'Body',   test: () => true, pivot: 'origin' },
    ],
  },
  Moss_Cave_Giant:    giant({ haft: 'Club_Wood',  weapon: ['Club_Wood', 'Club_Stone'] }),
  Crystal_Cave_Giant: giant({ haft: 'Club_Stone', weapon: ['Club_Stone'] }),
  // The Guardian's iron is shared between its mace head, its shield and the
  // horns on its helmet, so material alone puts all three in one part. Which
  // side of the body a triangle sits on settles it.
  Cave_Guardian:      giant({ haft: 'Club_Wood', weapon: ['Club_Wood', 'Dark_Iron', 'Worn_Iron_Edges'],
                              shield: ['Dark_Iron', 'Worn_Iron_Edges'] }),
};

function isWing(mat) { return /Wing/i.test(mat); }

// Humanoids share one skin material across torso, arms and legs, so the limbs
// have to be cut geometrically. Thresholds are fractions of the model's own
// height and half-width, which keeps this working across the three giants
// despite their different proportions.
function giant(mats) {
  return {
    mats,
    parts: [
      // Held gear first: it is on the far side of an arm, so it would otherwise
      // be swallowed by the arm test below.
      { name: 'Weapon', test: (c, m, s) => s.weapon.has(m) &&
          Math.sign(c.x) === s.weaponSide && Math.abs(c.x) > s.armX * 0.9, pivot: 'grip' },
      { name: 'Shield', test: (c, m, s) => s.shield.has(m) &&
          Math.sign(c.x) === -s.weaponSide && Math.abs(c.x) > s.armX * 0.9, pivot: 'grip' },
      { name: 'Arm_L',  test: (c, m, s) => c.x > s.armX && c.y > s.armY, pivot: 'shoulder' },
      { name: 'Arm_R',  test: (c, m, s) => c.x < -s.armX && c.y > s.armY, pivot: 'shoulder' },
      { name: 'Leg_L',  test: (c, m, s) => c.y < s.hipY && c.x > 0.04, pivot: 'hip' },
      { name: 'Leg_R',  test: (c, m, s) => c.y < s.hipY && c.x <= 0.04, pivot: 'hip' },
      { name: 'Torso',  test: () => true, pivot: 'origin' },
    ],
    limits: (bb) => ({
      armX: (bb.max[0] - bb.min[0]) * 0.20,   // arms hang outside this
      armY: bb.max[1] * 0.28,                  // hands stop about here
      hipY: bb.max[1] * 0.42,                  // below the belt is leg
    }),
  };
}

// ---------------------------------------------------------------------------
function triCentroid(p, a, b, c) {
  return {
    x: (p[a * 3] + p[b * 3] + p[c * 3]) / 3,
    y: (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1]) / 3,
    z: (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2]) / 3,
  };
}

async function split(file, spec) {
  const io = new NodeIO();
  const doc = await io.read(file);
  const root = doc.getRoot();
  if (root.listNodes().some(n => n.getName() === 'Root')) {
    throw new Error(`${path.basename(file)} is already split — restore the original first`);
  }
  const buffer = root.listBuffers()[0];
  const scene = root.listScenes()[0];
  const meshes = root.listMeshes();

  // Everything is baked in world space already (single node, identity), so we
  // can work directly in the mesh's own coordinates.
  const bb = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
  for (const mesh of meshes) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      const v = pos.getElement(i, [0, 0, 0]);
      for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k], v[k]); bb.max[k] = Math.max(bb.max[k], v[k]); }
    }
  }
  // The biggest material by vertex count is the creature's skin. Decoration
  // (shoulder crystals, moss) is attached to limbs but must not define where a
  // joint sits -- the Crystal Giant's shoulder spikes put its arm pivot a full
  // head above its actual shoulder.
  {
    const tally = {};
    for (const mesh of meshes) for (const prim of mesh.listPrimitives()) {
      const n = prim.getAttribute('POSITION').getCount();
      const m = prim.getMaterial()?.getName() || '?';
      tally[m] = (tally[m] || 0) + n;
    }
    spec._skinMat = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
  }

  const s = spec.limits ? spec.limits(bb) : {};
  s.weapon = new Set(spec.mats?.weapon || []);
  s.shield = new Set(spec.mats?.shield || []);

  // Which hand holds the weapon? The haft material is unambiguous, so take its
  // side rather than hard-coding one per model.
  s.weaponSide = 1;
  if (spec.mats?.haft) {
    let sum = 0, n = 0;
    for (const mesh of meshes) for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()?.getName() !== spec.mats.haft) continue;
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) { sum += pos.getElement(i, [0, 0, 0])[0]; n++; }
    }
    if (n) s.weaponSide = Math.sign(sum / n) || 1;
  }

  // --- assign every triangle to a part ---
  const groups = new Map(); // partName -> [{prim, tris:[[a,b,c]...]}]
  for (const mesh of meshes) {
    for (const prim of mesh.listPrimitives()) {
      const matName = prim.getMaterial()?.getName() || '';
      const pos = prim.getAttribute('POSITION').getArray();
      const idx = prim.getIndices();
      const count = idx ? idx.getCount() : prim.getAttribute('POSITION').getCount();
      const ind = idx ? idx.getArray() : null;
      const buckets = {};
      for (let t = 0; t < count; t += 3) {
        const a = ind ? ind[t] : t, b = ind ? ind[t + 1] : t + 1, c = ind ? ind[t + 2] : t + 2;
        const cen = triCentroid(pos, a, b, c);
        const part = spec.parts.find(p => p.test(cen, matName, s)).name;
        (buckets[part] || (buckets[part] = [])).push([a, b, c]);
      }
      for (const [part, tris] of Object.entries(buckets)) {
        if (!groups.has(part)) groups.set(part, []);
        groups.get(part).push({ prim, tris });
      }
    }
  }

  // --- work out each part's pivot ---
  const bounds = {};
  for (const [part, chunks] of groups) {
    const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], sum: [0, 0, 0], n: 0, xs: [], ys: [], skinYs: [] };
    for (const { prim, tris } of chunks) {
      const isSkin = (prim.getMaterial()?.getName() || '?') === spec._skinMat;
      const pos = prim.getAttribute('POSITION').getArray();
      for (const tri of tris) for (const vi of tri) {
        for (let k = 0; k < 3; k++) {
          const v = pos[vi * 3 + k];
          b.min[k] = Math.min(b.min[k], v); b.max[k] = Math.max(b.max[k], v); b.sum[k] += v;
        }
        b.xs.push(pos[vi * 3]); b.ys.push(pos[vi * 3 + 1]);
        if (isSkin) b.skinYs.push(pos[vi * 3 + 1]);
        b.n++;
      }
    }
    b.xs.sort((p, q) => p - q); b.ys.sort((p, q) => p - q); b.skinYs.sort((p, q) => p - q);
    bounds[part] = b;
  }

  // Percentiles, not extremes: a handful of triangles bridge the centreline
  // where a wing or arm meets the body, and one of those strays is enough to
  // drag a min/max pivot to completely the wrong end of the part.
  const pct = (arr, q) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor(arr.length * q)))];
  const pivotFor = (part) => {
    const b = bounds[part];
    const mid = [0, 1, 2].map(k => b.sum[k] / b.n);
    const side = mid[0] >= 0 ? 1 : -1;
    // The edge of this part nearest the body's centreline.
    const inner = side > 0 ? pct(b.xs, 0.04) : pct(b.xs, 0.96);
    // Joint height comes from skin vertices where there are any.
    const top = pct(b.skinYs.length > b.ys.length * 0.25 ? b.skinYs : b.ys, 0.96);
    const spec2 = spec.parts.find(p => p.name === part);
    switch (spec2.pivot) {
      case 'inner':     // wing root: the edge nearest the body's centreline
        return [inner, mid[1], mid[2]];
      case 'shoulder':  // top of the arm, on the side nearest the torso
        return [inner, top, mid[2]];
      case 'hip':       // top of the leg
        return [mid[0], top, mid[2]];
      case 'grip':      // where a hand would hold it: top of the haft
        return [mid[0], top * 0.8, mid[2]];
      default:
        return [0, 0, 0];
    }
  };

  // --- rebuild as one mesh per part, under a node carrying its pivot ---
  for (const node of scene.listChildren()) node.dispose();
  const rootNode = doc.createNode('Root');
  scene.addChild(rootNode);

  const report = [];
  const made = {};
  for (const [part, chunks] of groups) {
    const pivot = pivotFor(part);
    const mesh = doc.createMesh(part);
    let tris = 0;
    for (const { prim, tris: triList } of chunks) {
      const srcAttrs = prim.listSemantics().map(sem => [sem, prim.getAttribute(sem)]);
      const remap = new Map();
      const out = srcAttrs.map(([sem, acc]) => ({ sem, acc, vals: [] }));
      const indices = [];
      for (const tri of triList) {
        for (const vi of tri) {
          let ni = remap.get(vi);
          if (ni === undefined) {
            ni = remap.size; remap.set(vi, ni);
            for (const o of out) {
              const el = o.acc.getElement(vi, new Array(o.acc.getElementSize()).fill(0));
              if (o.sem === 'POSITION') for (let k = 0; k < 3; k++) el[k] -= pivot[k];
              o.vals.push(...el);
            }
          }
          indices.push(ni);
        }
        tris++;
      }
      const np = doc.createPrimitive().setMaterial(prim.getMaterial());
      for (const o of out) {
        const acc = doc.createAccessor()
          .setType(o.acc.getType())
          .setArray(new Float32Array(o.vals))
          .setBuffer(buffer);
        np.setAttribute(o.sem, acc);
      }
      np.setIndices(doc.createAccessor()
        .setType('SCALAR')
        .setArray(new Uint32Array(indices))
        .setBuffer(buffer));
      mesh.addPrimitive(np);
    }
    const node = doc.createNode(part).setMesh(mesh).setTranslation(pivot);
    rootNode.addChild(node);
    made[part] = { node, pivot };
    report.push({ part, tris, pivot: pivot.map(v => +v.toFixed(2)) });
  }

  // Held gear belongs to the hand that holds it: parent it under that arm, with
  // its translation made relative, so swinging the arm carries the weapon with
  // it instead of leaving it hanging in the air.
  const attach = (childName, armName) => {
    const child = made[childName], arm = made[armName];
    if (!child || !arm) return;
    rootNode.removeChild(child.node);
    arm.node.addChild(child.node);
    child.node.setTranslation(child.pivot.map((v, k) => v - arm.pivot[k]));
    const r = report.find(x => x.part === childName);
    if (r) r.parent = armName;
  };
  if (s.weaponSide) {
    attach('Weapon', s.weaponSide > 0 ? 'Arm_L' : 'Arm_R');
    attach('Shield', s.weaponSide > 0 ? 'Arm_R' : 'Arm_L');
  }

  // Prune anything the old scene left behind.
  for (const mesh of meshes) mesh.dispose();

  await io.write(file, doc);
  return report;
}

// ---------------------------------------------------------------------------
// The spiders already have one node per leg, but every node sits at the model
// origin, so rotating one swings the leg around the spider's middle instead of
// around its hip. Move each node to where its leg actually meets the body.
const REPIVOT = ['Spider', 'Cave_Spider', 'Venom_Spider', 'Crystal_Spider'];

async function repivotLegs(file) {
  const io = new NodeIO();
  const doc = await io.read(file);
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    if (!/^Leg_[LR]_\d$/.test(node.getName() || '')) continue;
    const mesh = node.getMesh();
    if (!mesh) continue;
    const t = node.getTranslation();
    if (Math.hypot(t[0], t[1], t[2]) > 1e-4) { out.push({ leg: node.getName(), skipped: true }); continue; }

    // The hip is the end of the leg nearest the body's centre line.
    const pts = [];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) pts.push(pos.getElement(i, [0, 0, 0]));
    }
    if (!pts.length) continue;
    pts.sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2]));
    const inner = pts.slice(0, Math.max(3, Math.floor(pts.length * 0.06)));
    const hip = [0, 1, 2].map(k => inner.reduce((a, p) => a + p[k], 0) / inner.length);

    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const arr = pos.getArray().slice();
      for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) arr[i + k] -= hip[k];
      pos.setArray(arr);
    }
    node.setTranslation(hip);
    out.push({ leg: node.getName(), hip: hip.map(v => +v.toFixed(2)) });
  }
  await io.write(file, doc);
  return out;
}

if (process.argv[2] === '--legs' || !process.argv[2]) {
  for (const name of REPIVOT) {
    const file = path.join(MODELS, name + '.glb');
    if (!fs.existsSync(file)) continue;
    const res = await repivotLegs(file);
    const moved = res.filter(r => !r.skipped);
    console.log(`${name}: re-pivoted ${moved.length} legs` +
      (moved.length ? `  e.g. ${moved[0].leg} hip at ${moved[0].hip.join(', ')}` : '') +
      (res.length - moved.length ? `  (${res.length - moved.length} already pivoted)` : ''));
  }
}

const only = process.argv[2] === '--legs' ? '__none__' : process.argv[2];
for (const [name, spec] of Object.entries(SPECS)) {
  if (only && name !== only) continue;
  const file = path.join(MODELS, name + '.glb');
  if (!fs.existsSync(file)) { console.log('missing:', file); continue; }
  const before = fs.statSync(file).size;
  const report = await split(file, spec);
  const after = fs.statSync(file).size;
  console.log(`\n${name}  (${(before / 1024).toFixed(0)}K -> ${(after / 1024).toFixed(0)}K)`);
  for (const r of report) {
    console.log(`   ${r.part.padEnd(8)} ${String(r.tris).padStart(5)} tris   pivot ${r.pivot.join(', ')}` +
      (r.parent ? `   (child of ${r.parent})` : ''));
  }
}
console.log('');
