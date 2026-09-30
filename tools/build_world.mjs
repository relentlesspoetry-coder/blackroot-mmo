// Compose the regions into ONE world.
//
// Blackroot is an open world: you walk out of the Dark Woods and into the
// Killing Fields without a door, a loading screen or a portal. That is not a
// new idea in this codebase -- the client has carried a region system the whole
// time, right down to the comment "crossing into another region of the seamless
// world announces it like a zone" -- it had simply never had more than one
// region put in it, because worldgen.js writes `z.regions = [one]` over
// whatever the zone declares.
//
// So the two builders each produce their own map in their own coordinates, and
// this puts them side by side: one terrain grid, one boundary, one set of
// landmarks, two regions. Each region keeps its own name, its own map page and
// its own title card.
//
//   node tools/build_world.mjs      (after both zone builders have run)
//
// Writes server/zones/blackroot.js
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { darkwoods } from '../server/zones/darkwoods.js';
import { killingfields } from '../server/zones/killingfields.js';

// Where the Killing Fields sits relative to the Dark Woods. Chosen so its
// Woodland Road comes out level with the Dark Woods' East Path -- the two exits
// the sheets say join -- with a short run of open ground stamped between them.
const OFF = { x: 815, z: -276 };
const BRIDGE_W = 26;          // half-width of the corridor joining the two maps

const shift = (p) => ({ ...p, x: +(p.x + OFF.x).toFixed(1), z: +(p.z + OFF.z).toFixed(1) });
const shiftC = (p) => ({ ...p, cx: +(p.cx + OFF.x).toFixed(1), cz: +(p.cz + OFF.z).toFixed(1) });

function shiftAll(arr, how = shift) { return (arr || []).map(how); }

// --- the merged grid ---------------------------------------------------------
const A = darkwoods.terrain, B = killingfields.terrain;
const cell = A.cell;
if (B.cell !== cell) throw new Error('the two maps are on different grids');
const bMinX = B.minX + OFF.x, bMinZ = B.minZ + OFF.z;
const minX = Math.min(A.minX, bMinX), minZ = Math.min(A.minZ, bMinZ);
const maxX = Math.max(A.minX + A.w * cell, bMinX + B.w * cell);
const maxZ = Math.max(A.minZ + A.h * cell, bMinZ + B.h * cell);
const W = Math.round((maxX - minX) / cell), H = Math.round((maxZ - minZ) / cell);
const grid = Array.from({ length: H }, () => new Array(W).fill(' '));

function stamp(t, ox, oz) {
  const gx0 = Math.round((t.minX + ox - minX) / cell);
  const gz0 = Math.round((t.minZ + oz - minZ) / cell);
  for (let z = 0; z < t.h; z++) {
    const row = t.rows[z];
    for (let x = 0; x < t.w; x++) {
      const c = row[x] || ' ';
      if (c === ' ') continue;            // land wins where the two overlap
      grid[gz0 + z][gx0 + x] = c;
    }
  }
}
stamp(A, 0, 0);
stamp(B, OFF.x, OFF.z);

// The join. The two hulls do not touch -- the Dark Woods' land stops at its
// East Path and the Killing Fields' starts at its Woodland Road -- so the road
// between them is stamped as open ground. Without it the seam is a chasm and
// "seamless" is a claim rather than a fact.
const east = darkwoods.pois.find(p => p.key === 'east_path');
const west = shift(killingfields.pois.find(p => p.key === 'woodland_road'));
{
  const steps = Math.ceil(Math.hypot(west.x - east.x, west.z - east.z) / (cell * 0.4));
  const r = Math.ceil(BRIDGE_W / cell);
  for (let i = 0; i <= steps; i++) {
    const wx = east.x + (west.x - east.x) * i / steps;
    const wz = east.z + (west.z - east.z) * i / steps;
    const gx = Math.round((wx - minX) / cell), gz = Math.round((wz - minZ) / cell);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      const x = gx + dx, z = gz + dz;
      if (x < 0 || z < 0 || x >= W || z >= H) continue;
      if (grid[z][x] === ' ') grid[z][x] = (dx * dx + dz * dz > (r - 3) * (r - 3)) ? 'f' : '.';
    }
  }
}

// --- the outline -------------------------------------------------------------
// One polygon round the whole thing, traced off the merged land rather than
// taken as the union of two star-shaped hulls (which cuts the waist off a
// dumbbell). Moore-neighbourhood contour following, then simplified.
function outline() {
  const land = (x, z) => x >= 0 && z >= 0 && x < W && z < H && grid[z][x] !== ' ';
  let sx = -1, sz = -1;
  outer: for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (land(x, z)) { sx = x; sz = z; break outer; }
  const N = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts = [];
  let cx = sx, cz = sz, dir = 0, guard = 0;
  do {
    pts.push([cx, cz]);
    let moved = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8;               // start looking back-left
      const nx = cx + N[d][0], nz = cz + N[d][1];
      if (land(nx, nz)) { cx = nx; cz = nz; dir = d; moved = true; break; }
    }
    if (!moved) break;
  } while ((cx !== sx || cz !== sz) && ++guard < W * H * 4);
  // world coords, one point every few cells, pushed a little outside the land
  const ring = [];
  for (let i = 0; i < pts.length; i += 5) {
    ring.push({ x: +(minX + (pts[i][0] + 0.5) * cell).toFixed(1),
                z: +(minZ + (pts[i][1] + 0.5) * cell).toFixed(1) });
  }
  return ring;
}

// --- regions -----------------------------------------------------------------
const regions = [
  { id: 'darkwoods', name: darkwoods.name, subtitle: darkwoods.subtitle,
    bounds: { ...darkwoods.bounds },
    boundary: (darkwoods.boundary || []).map(p => ({ x: p.x, z: p.z })) },
  { id: 'killingfields', name: killingfields.name, subtitle: killingfields.subtitle,
    // "Dense woodland limited mostly to the western margin and a few copses",
    // says the sheet. On open ground the default 0.06 put 964 trees across the
    // battlefield; a fifth of that leaves it the bare basin it is drawn as.
    openTrees: 0.012,
    // Dry stubble and turned earth, not sward. Anchored on the sheet's own
    // palette: its open battlefield sits at hue 30 of 360 and its crop fields
    // at 37, against the Dark Woods' green. The hue spread comes in too --
    // at the woodland's 0.16 the range ran from ochre all the way back to
    // green and half the basin still looked like a lawn.
    sward: { h: 0.115, s: 0.26, l: 0.19, hv: 0.065 },
    bounds: { minX: +(killingfields.bounds.minX + OFF.x).toFixed(1),
              maxX: +(killingfields.bounds.maxX + OFF.x).toFixed(1),
              minZ: +(killingfields.bounds.minZ + OFF.z).toFixed(1),
              maxZ: +(killingfields.bounds.maxZ + OFF.z).toFixed(1) },
    boundary: (killingfields.boundary || []).map(shift) },
];

// --- everything else ---------------------------------------------------------
const shiftPath = (p) => ({ ...p, points: p.points.map(shift) });
const shiftRiver = (r) => ({ ...r, points: r.points.map(shift),
                             bridges: (r.bridges || []).map(shift),
                             fords: (r.fords || []).map(shift) });
const shiftFence = (f) => ({ ...f, x1: +(f.x1 + OFF.x).toFixed(1), z1: +(f.z1 + OFF.z).toFixed(1),
                             x2: +(f.x2 + OFF.x).toFixed(1), z2: +(f.z2 + OFF.z).toFixed(1) });

const world = {
  id: 'blackroot',
  name: darkwoods.name,
  subtitle: darkwoods.subtitle,
  spawn: darkwoods.spawn,
  bounds: { minX, maxX, minZ, maxZ },
  boundaryInset: 0,
  safeSpawnRadius: darkwoods.safeSpawnRadius,
  boundary: outline(),
  regions,
  hills: [...(darkwoods.hills || []), ...shiftAll(killingfields.hills)],
  pois: [...darkwoods.pois, ...shiftAll(killingfields.pois)],
  rivers: [...(darkwoods.rivers || []), ...(killingfields.rivers || []).map(shiftRiver)],
  paths: [...(darkwoods.paths || []), ...(killingfields.paths || []).map(shiftPath),
          // the Woodland Road itself, the one road that belongs to neither map
          { kind: 'road', from: 'east_path', to: 'woodland_road',
            points: [{ x: east.x, z: east.z }, { x: west.x, z: west.z }] }],
  portals: darkwoods.portals || [],        // the Spider Den only: a cave IS a door
  rocks: [], hazards: [],
  treeCount: (darkwoods.treeCount || 0) + (killingfields.treeCount || 0),
  treeSeed: darkwoods.treeSeed, scatterSeed: darkwoods.scatterSeed,
  spawns: [...(darkwoods.spawns || []), ...shiftAll(killingfields.spawns, shiftC)],
  scatter: [...(darkwoods.scatter || []), ...(killingfields.scatter || [])],
  decks: [...(darkwoods.decks || []), ...shiftAll(killingfields.decks)],
  props: [...(darkwoods.props || []), ...shiftAll(killingfields.props)],
  fences: [...(darkwoods.fences || []), ...(killingfields.fences || []).map(shiftFence)],
  dirt: [...(darkwoods.dirt || []), ...shiftAll(killingfields.dirt)],
  structures: [...(darkwoods.structures || []), ...shiftAll(killingfields.structures)],
  fishingSpots: [...(darkwoods.fishingSpots || []), ...shiftAll(killingfields.fishingSpots)],
  campfires: [...(darkwoods.campfires || []), ...shiftAll(killingfields.campfires)],
  npcs: [...(darkwoods.npcs || []), ...shiftAll(killingfields.npcs)],
  chests: [...(darkwoods.chests || []), ...shiftAll(killingfields.chests)],
  elites: [...(darkwoods.elites || []), ...shiftAll(killingfields.elites, shiftC)],
  objects: [...(darkwoods.objects || []), ...shiftAll(killingfields.objects)],
  models: [...new Set([...(darkwoods.models || []), ...(killingfields.models || [])])].sort(),
  env: darkwoods.env,
  waterEdge: darkwoods.waterEdge,
  rockEdge: darkwoods.rockEdge,
  terrain: { cell, w: W, h: H, minX, minZ, rows: grid.map(r => r.join('')) },
};

// These describe one zone and the regions are composed into one, so the two
// halves have to agree. Taking one side's silently is how the Killing Fields
// came to author a cliff height that never reached the world.
for (const key of ['waterEdge', 'rockEdge']) {
  const a = JSON.stringify(darkwoods[key] || null), b = JSON.stringify(killingfields[key] || null);
  if (b !== 'null' && a !== b)
    throw new Error(`${key} differs between the regions and describes the whole zone:\n` +
                    `  darkwoods     ${a}\n  killingfields ${b}`);
}

// ids have to stay unique across the merged world or the server will hand two
// different things the same name
for (const key of ['npcs', 'chests', 'objects', 'fishingSpots', 'campfires']) {
  const seen = new Set(), dupes = [];
  for (const it of world[key]) { if (it.id === undefined) continue;
    if (seen.has(it.id)) dupes.push(it.id); seen.add(it.id); }
  if (dupes.length) throw new Error(`${key}: duplicate ids across regions: ${dupes.join(', ')}`);
}
const poiKeys = new Set(), poiDupes = [];
for (const p of world.pois) { if (poiKeys.has(p.key)) poiDupes.push(p.key); poiKeys.add(p.key); }
if (poiDupes.length) throw new Error(`landmark keys clash: ${poiDupes.join(', ')}`);

const out = fileURLToPath(new URL('../server/zones/blackroot.js', import.meta.url));
writeFileSync(out,
  '// GENERATED by tools/build_world.mjs -- the Dark Woods and the Killing\n' +
  '// Fields composed into one open world. Do not edit by hand: edit the two\n' +
  '// builders, or the composer, and run them again.\n' +
  `export const blackroot = ${JSON.stringify(world)};\n`);
let cells = 0; for (const r of world.terrain.rows) for (const c of r) if (c !== ' ') cells++;
console.log(`grid ${W} x ${H} (${(W * H / 1000).toFixed(0)}k cells, ${(cells / 1000).toFixed(0)}k of them land)`);
console.log(`world ${(maxX - minX).toFixed(0)} x ${(maxZ - minZ).toFixed(0)} units, ` +
  `${world.regions.length} regions, ${world.pois.length} landmarks, ${world.paths.length} paths, ` +
  `${world.spawns.length} spawn groups, ${world.models.length} models`);
console.log('wrote server/zones/blackroot.js');
