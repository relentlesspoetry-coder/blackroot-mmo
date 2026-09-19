// What does world generation actually put in the world? Run: node tools/worldgen.mjs
// Placement is rejection-sampled, so a spec asking for 26 stalagmites does not
// necessarily get 26 — this prints what it really managed, and checks that
// nothing landed somewhere it shouldn't.

import { generateTrees, generateScatter, generateHanging, pointInPoly, dist2, caveOutline, inCavern, tunnelSamples } from '../server/worldgen.js';
import { darkwoods } from '../server/zones/darkwoods.js';
import { hiddencave } from '../server/zones/hiddencave.js';

const pad = (s, n) => String(s).padEnd(n);
let problems = 0;
function flag(msg) { console.log('  !! ' + msg); problems++; }

for (const zone of [darkwoods, hiddencave]) {
  console.log(`\n=== ${zone.name} ===`);

  // A cave authored as rooms and tunnels: trace it, then check the shape is
  // one connected piece and that nothing authored fell outside it.
  if (zone.cavern && !zone.boundary) {
    zone.boundary = caveOutline(zone.cavern, zone.bounds);
    const cav = zone.cavern;
    console.log(`cavern         ${cav.rooms.length} rooms, ${cav.tunnels.length} tunnels ` +
      `-> ${zone.boundary.length} wall segments`);

    // The tunnel graph has to be a tree, or the union encloses rock and the
    // outline becomes two rings.
    const seen = new Set(['' + cav.rooms[0].key]);
    let edges = 0;
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of cav.tunnels) {
        if (seen.has(t.from) !== seen.has(t.to)) { seen.add(t.from); seen.add(t.to); changed = true; }
      }
    }
    edges = cav.tunnels.length;
    if (seen.size !== cav.rooms.length) flag(`${cav.rooms.length - seen.size} room(s) unreachable from the entrance`);
    if (edges !== cav.rooms.length - 1) flag(`tunnel graph is not a tree (${edges} tunnels for ${cav.rooms.length} rooms) — the outline will have holes`);
    for (const t of cav.tunnels) {
      for (const k of [t.from, t.to]) {
        if (!cav.rooms.some(r => r.key === k)) flag(`tunnel refers to unknown room "${k}"`);
      }
    }
    // Every room must be walkable from the arrival point; sample the tunnels.
    for (const t of cav.tunnels) {
      // Follow the tunnel's own curve — tunnels bend, so the straight line
      // between room centres runs through rock.
      for (const q of tunnelSamples(cav, t, 40)) {
        if (!inCavern(cav, q.x, q.z) || !pointInPoly(q.x, q.z, zone.boundary)) {
          flag(`tunnel ${t.from} -> ${t.to} is pinched off at ${q.x.toFixed(0)},${q.z.toFixed(0)}`);
          break;
        }
      }
    }
    for (const p of zone.pois) {
      if (!pointInPoly(p.x, p.z, zone.boundary)) flag(`POI "${p.key}" is outside the cave`);
    }
    for (const sp of zone.spawns) {
      if (!pointInPoly(sp.cx, sp.cz, zone.boundary)) flag(`spawn "${sp.hint}" is centred outside the cave`);
      // Rooms are lumpy now, so a spawn circle can poke well into rock. Sample
      // it: if most of the area is solid, the mobs all crowd one lobe.
      let inside = 0, total = 0;
      for (let a = 0; a < 24; a++) {
        for (let k = 1; k <= 4; k++) {
          const rr = sp.r * Math.sqrt(k / 4), th = (a / 24) * Math.PI * 2;
          total++;
          if (pointInPoly(sp.cx + Math.cos(th) * rr, sp.cz + Math.sin(th) * rr, zone.boundary)) inside++;
        }
      }
      const pct = inside / total;
      if (pct < 0.55) flag(`spawn "${sp.hint}" is only ${(pct * 100).toFixed(0)}% walkable — mobs will pile into one lobe`);
      else if (pct < 0.75) console.log(`  ${sp.hint.padEnd(22)} ${(pct * 100).toFixed(0)}% walkable`);
    }
  }
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

// A portal names where it drops you in the destination zone, and that point
// lives in the source zone's file — easy to leave behind when a zone is
// relaid out.
const ZONES = { darkwoods, hiddencave };
for (const zone of [darkwoods, hiddencave]) {
  for (const portal of (zone.portals || [])) {
    const to = ZONES[portal.to];
    if (!to) { flag(`${zone.name}: portal leads to unknown zone "${portal.to}"`); continue; }
    const at = portal.spawn || to.spawn;
    if (to.boundary && !pointInPoly(at.x, at.z, to.boundary)) {
      flag(`${zone.name}: portal drops the player at ${at.x},${at.z}, which is outside ${to.name}`);
    }
    // The drop point should be somewhere the player can get back from: either
    // the destination's own arrival point, or beside one of its portals (a
    // return portal lands you at the door you came out of, not at the start).
    const anchors = [to.spawn, ...(to.portals || [])];
    const near = anchors.some(a => Math.hypot(at.x - a.x, at.z - a.z) <= 30);
    if (!near) {
      flag(`${zone.name}: portal drops the player at ${at.x},${at.z} — nowhere near ${to.name}'s arrival point or any of its portals`);
    }
  }
}

console.log(`\n${problems === 0 ? 'NO PLACEMENT PROBLEMS' : problems + ' PROBLEM(S)'}\n`);
process.exit(problems === 0 ? 0 : 1);
