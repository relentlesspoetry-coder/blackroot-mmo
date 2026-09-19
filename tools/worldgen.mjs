// What does world generation actually put in the world? Run: node tools/worldgen.mjs
// Placement is rejection-sampled, so a spec asking for 26 stalagmites does not
// necessarily get 26 — this prints what it really managed, and checks that
// nothing landed somewhere it shouldn't.

import { generateTrees, generateScatter, generateHanging, pointInPoly, dist2 } from '../server/worldgen.js';
import { darkwoods } from '../server/zones/darkwoods.js';
import { hiddencave } from '../server/zones/hiddencave.js';

const pad = (s, n) => String(s).padEnd(n);
let problems = 0;
function flag(msg) { console.log('  !! ' + msg); problems++; }

for (const zone of [darkwoods, hiddencave]) {
  console.log(`\n=== ${zone.name} ===`);
  const trees = generateTrees(zone);
  const scatter = generateScatter(zone);
  const hanging = generateHanging(zone);

  if (zone.treeCount) {
    console.log(`trees          ${trees.length} / ${zone.treeCount} asked`);
  }
  if (zone.scatter) {
    const asked = zone.scatter.reduce((a, s) => a + s.count, 0);
    const by = {};
    for (const o of scatter) by[o.m] = (by[o.m] || 0) + 1;
    console.log(`scatter        ${scatter.length} / ${asked} asked   (${scatter.filter(o => o.c > 0).length} solid)`);
    for (const spec of zone.scatter) {
      const got = by[spec.model] || 0;
      const short = got < spec.count;
      console.log(`  ${pad(spec.model, 24)}${pad(got + '/' + spec.count, 9)}${short ? '  under-placed' : ''}`);
      if (got === 0) flag(`${spec.model} placed nothing at all`);
    }
  }
  if (zone.hanging) {
    const asked = zone.hanging.reduce((a, s) => a + s.count, 0);
    console.log(`hanging        ${hanging.length} / ${asked} asked`);
  }

  // --- placement sanity ---
  const all = [...scatter, ...hanging, ...trees.map(t => ({ ...t, m: 'tree' }))];
  if (zone.boundary) {
    const outside = all.filter(o => !pointInPoly(o.x, o.z, zone.boundary));
    if (outside.length) flag(`${outside.length} pieces outside the zone boundary`);
  }
  const onSpawn = scatter.filter(o => dist2(o.x, o.z, zone.spawn.x, zone.spawn.z) < 64);
  if (onSpawn.length) flag(`${onSpawn.length} pieces within 8m of the arrival point`);
  const inChest = scatter.filter(o => (zone.chests || []).some(c => dist2(o.x, o.z, c.x, c.z) < 16));
  if (inChest.length) flag(`${inChest.length} pieces sitting on a chest`);
  const blockingPath = scatter.filter(o => o.c > 0 &&
    zone.path && Math.min(...zone.path.map(p => Math.hypot(o.x - p.x, o.z - p.z))) < 3);
  if (blockingPath.length) flag(`${blockingPath.length} solid pieces on the walked path`);

  // Determinism: the same seed must give the same world, or clients disagree.
  const again = generateScatter(zone);
  if (JSON.stringify(again) !== JSON.stringify(scatter)) flag('scatter is not deterministic');

  // Wire cost — this ships to every client on zone entry.
  const bytes = JSON.stringify({ trees, scatter, hanging }).length;
  console.log(`wire cost      ${(bytes / 1024).toFixed(1)} KB`);
}

console.log(`\n${problems === 0 ? 'NO PLACEMENT PROBLEMS' : problems + ' PROBLEM(S)'}\n`);
process.exit(problems === 0 ? 0 : 1);
