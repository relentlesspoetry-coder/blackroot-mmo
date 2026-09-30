// Blackroot — deterministic world generation.
//
// Trees and cave dressing are placed here, on the server, so every client sees
// the same world and the solid pieces can be authoritative. Pure functions with
// no side effects: seed in, placements out. See tools/worldgen.mjs.

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

// A zone may hold several bodies of water, each with several crossings. `river`
// (one) is the old single-channel form and still works; `rivers` (many) is what
// a zone with a lake, a creek and a fen authors. Everything downstream reads
// through these two so neither form needs a special case.
export function riversOf(zone) {
  if (!zone) return [];
  return zone.rivers || (zone.river ? [zone.river] : []);
}
export function bridgesOf(river) {
  if (!river) return [];
  return river.bridges || (river.bridge ? [river.bridge] : []);
}
// ---------------------------------------------------------------------------
// TERRAIN GRID
//
// The zone's ground comes from `terrain`, a grid traced straight off the
// blueprint (see tools/trace_blueprint.py). Every question about a point --
// is it water, is it rock, how thick is the wood, is it even on the map --
// is answered by reading one cell, so the world matches the drawing instead
// of approximating it with circles and lines.
// ---------------------------------------------------------------------------
// The grid, the blurred fields and everything about where the ground IS come
// from shared/terrain.js -- the same module the client imports over HTTP. They
// used to be two copies of the same maths, and the copies drifted: the server
// blurred every field at one radius and the client at two, which happened not
// to matter yet and was one edit away from mattering.
import {
  T_OFF, T_DEEP, T_MARSH, T_ROCK, T_DENSE, T_WOOD, T_OPEN,
  terrainAt, isWater, terrainFieldAt, waterEdgeOf, rockEdgeOf, rockRiseAt,
  landHeight, landBaseY, terrainHeight, groundMeshY, groundSlopeAt, tooSteep,
  waterLevelAt, riverProfile, latticeOf, resetTerrain, MAX_WALK_SLOPE, walkSlopeOf,
  onDeckSpan, riverWaterHalf, RIVER_BANK, RIVER_LIP,
} from '../shared/terrain.js';
export {
  T_OFF, T_DEEP, T_MARSH, T_ROCK, T_DENSE, T_WOOD, T_OPEN,
  terrainAt, isWater, terrainFieldAt, waterEdgeOf, rockEdgeOf, rockRiseAt,
  landHeight, landBaseY, terrainHeight, groundMeshY, groundSlopeAt, tooSteep,
  waterLevelAt, riverProfile, latticeOf, resetTerrain, MAX_WALK_SLOPE, walkSlopeOf,
  riverWaterHalf, RIVER_BANK, RIVER_LIP,
};

export function terrainOf(zone) { return zone && zone.terrain; }

// The wetness field the SHORELINE is drawn from -- box-blurred twice over a few
// cells, then sampled bilinear. This has to be here, and has to match the client
// exactly, because the client stopped drawing water on the raw cell grid: it
// contours this field instead, so a cell is no longer the same thing as water.
// Deciding swimming from cells while drawing the shore from the contour left 766
// cells of open ground you swam across. Both sides now read `zone.waterEdge`,
// which the zone generator writes, so the levels cannot drift apart.
// (the fields live in shared/terrain.js now)
export function isSolid(c) { return c === T_DEEP || c === T_ROCK || c === T_OFF; }
// Distance from (x,z) out to the nearest cell that is not `ok`, capped at
// `max`. Used to keep things a sensible distance off water, rock and the rim.
export function terrainClearance(zone, x, z, ok, max = 12) {
  const t = zone && zone.terrain; if (!t) return max;
  const step = t.cell;
  for (let r = step; r <= max; r += step) {
    const n = Math.max(6, Math.round(2 * Math.PI * r / step));
    for (let i = 0; i < n; i++) {
      const a = 2 * Math.PI * i / n;
      if (!ok(terrainAt(zone, x + Math.cos(a) * r, z + Math.sin(a) * r))) return r;
    }
  }
  return max;
}
// How thick the wood is here, as a multiplier on the base tree density.
// How thickly trees stand on ground the drawing calls OPEN. In a wood that is
// clearings with a few trees left in them and 0.06 is right. In an open
// agricultural basin it is not: the Killing Fields is 62,560 open cells and at
// 0.06 it grew 964 trees across a battlefield that the sheet draws bare, with
// woodland only on its western margin. So it is a property of the REGION, and
// the region says what kind of country it is.
const OPEN_TREES = 0.06;
export function regionAt(zone, x, z) {
  const regs = zone && zone.regions;
  if (!regs || regs.length < 2) return null;
  for (const r of regs) {
    if (r.underground) continue;
    const b = r.bounds;
    if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return r;
  }
  return null;
}
export function forestAt(zone, x, z) {
  switch (terrainAt(zone, x, z)) {
    case T_DENSE: return 1.9;
    case T_WOOD:  return 1.0;
    case T_OPEN: {
      const r = regionAt(zone, x, z);
      return (r && r.openTrees != null) ? r.openTrees : OPEN_TREES;
    }
    default:      return 0;          // water, rock, off the map
  }
}

// The same one-or-many rule for roads: `path` is a single route, `paths` is a
// network (a main road with spurs to each of the zone's exits).
//
// The blueprint draws two kinds -- a major path (road) and a minor path
// (trail) -- so an entry may be a bare list of points (a road, as before) or
// { points, kind }. `pathSpecsOf` gives the typed form for drawing; `pathsOf`
// gives just the lines, which is what every distance check wants.
export function pathSpecsOf(zone) {
  if (!zone) return [];
  const raw = zone.paths || (zone.path ? [zone.path] : []);
  return raw.map(p => Array.isArray(p) ? { points: p, kind: 'road' } : { points: p.points, kind: p.kind || 'road' });
}
export function pathsOf(zone) { return pathSpecsOf(zone).map(p => p.points); }
// How wide the forest is kept back from each kind.
export function pathClearOf(kind) { return kind === 'trail' ? 3 : 6; }
// How wide the WALKING surface is -- the same half-widths the builder cuts a
// path with. A road is walkable by definition (see rockSolidAt), so this is the
// width of that exemption, not a drawing measurement.
export function pathWalkOf(kind) { return kind === 'trail' ? 2.4 : 3.4; }
// True if (x,z) is on a road or trail.
export function onPath(zone, x, z) {
  for (const p of pathSpecsOf(zone)) {
    if (!p.points || p.points.length < 2) continue;
    if (closestOnPolyline(x, z, p.points).dist <= pathWalkOf(p.kind)) return true;
  }
  return false;
}

// --- rock -----------------------------------------------------------------
// What blocks is the rock the client DRAWS, not the cell the blueprint was
// traced into. Those are different shapes: the drawn height is the cell grid
// put through a four-pass blur, and blurring shrinks a stringy shape, so a
// one-cell spur of traced rock draws as a metre-high swell. Blocking by the
// cell meant 371 cells of invisible wall and 310 cells of ground with a cliff
// standing on it, and no edit to the cells could close that gap -- opening a
// thin spur lowers the field around what is left and exposes the next one.
//
// So there is one level, here, and client, server and builder all use it: rock
// blocks where the field reaches `solid`. At 0.5 -- the half-level a blur puts
// at the edge of the shape it came from -- you are stopped exactly at the drawn
// edge of the rock, and the wall you are stopped by is rise * 0.5^2 = 4.25 m
// tall. This is the same arrangement as `waterEdge`, for the same reason.
// (rockEdgeOf / rockRiseAt live in shared/terrain.js now)
// Is (x,z) somewhere the ground is too steep to walk? This used to ask how
// much ROCK was under you, and that was the wrong quantity: measured across
// every cell that blocked, 47% were gentler than 30 degrees and 735 of them
// were flat -- a grassy mound you walked into like a wall. What stops a person
// is steepness, and the steepness of the surface the player can SEE.
//
// A road is the authored exception. The blueprint's chokepoints are three to
// five metres of gap through a cliff, narrower than the blurred field can
// resolve, so without it a pass reads as solid stone with a road painted on
// it. It is consulted only where the ground would otherwise block, so it costs
// nothing on open ground.
export function rockSolidAt(zone, x, z) {
  if (!zone || !zone.terrain) return false;
  if (!tooSteep(zone, x, z)) return false;
  return !onPath(zone, x, z);
}
// Nearest point on ANY of a zone's roads.
export function closestOnPaths(x, z, zone) {
  let best = null;
  for (const p of pathsOf(zone)) {
    if (!p || p.length < 2) continue;
    const c = closestOnPolyline(x, z, p);
    if (!best || c.dist < best.dist) best = c;
  }
  return best;
}
export function closestOnSeg(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz || 1), 0, 1);
  return { x: ax + abx * t, z: az + abz * t };
}

export function closestOnPolyline(px, pz, pts) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const c = closestOnSeg(px, pz, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
    const d = dist2(px, pz, c.x, c.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return { ...best, dist: Math.sqrt(bestD) };
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

export function polyCentroid(poly) {
  let x = 0, z = 0; for (const p of poly) { x += p.x; z += p.z; }
  return { x: x / poly.length, z: z / poly.length };
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Is (x, z) inside a building's footprint? A structure declares one already --
// the pad it levels the ground with -- so that rectangle, rotated with the
// building and given a margin, is the thing nothing else may stand in.
//
// This was missing, and clearRadiusS returns a flat 7 m for a ruin or a
// lookout: the Crow Hill tower is eight metres across under an eleven-metre
// roof, so the forest was seeded happily inside it and an oak grew up through
// the lookout. Gravestones were doing the same to the chapel's nave.
export function inStructure(zone, x, z, margin = 3) {
  for (const b of (zone.structures || [])) {
    const c = Math.cos(b.yaw || 0), s = Math.sin(b.yaw || 0);
    const dx = x - b.x, dz = z - b.z;
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    if (Math.abs(lx) < (b.padW || 8) + margin && Math.abs(lz) < (b.padD || 8) + margin) return true;
  }
  return false;
}

export function clearRadiusS(p) {
  if (p.kind === 'safe') return (p.r || 9) + 3;
  if (p.kind === 'boss') return 15;
  if (p.kind === 'gate') return 11;
  if (p.kind === 'cave') return 18;   // keep the forest off the cave mouth so the way in reads
  return 7;
}

export function generateTrees(zone) {
  if (!zone.treeCount || zone.treeCount <= 0) return [];
  const b = zone.bounds, rng = mulberry32(zone.treeSeed || 1);
  const trees = [], minSpace = 9;
  let guard = 0;
  while (trees.length < zone.treeCount && guard++ < zone.treeCount * 60) {
    const x = b.minX + 3 + rng() * (b.maxX - b.minX - 6);
    const z = b.minZ + 3 + rng() * (b.maxZ - b.minZ - 6);
    if (zone.boundary && !pointInPoly(x, z, zone.boundary)) continue;
    if (pathSpecsOf(zone).some(p => closestOnPolyline(x, z, p.points).dist < pathClearOf(p.kind))) continue;
    if (riversOf(zone).some(r => closestOnPolyline(x, z, r.points).dist < riverWaterHalf(r.width) + 3)) continue;
    if (riversOf(zone).some(r => bridgesOf(r).some(b => dist2(x, z, b.x, b.z) < 15 * 15))) continue;
    if (zone.pois.some(p => dist2(x, z, p.x, p.z) < clearRadiusS(p) ** 2)) continue;
    if (inStructure(zone, x, z, 4)) continue;          // no oaks through the tower
    if ((zone.rocks || []).some(o => dist2(x, z, o.x, o.z) < (o.r + 2) ** 2)) continue;
    // Density decides both whether a tree stands here at all and how close it
    // stands to its neighbours: a grove packs them in, a clearing is bare.
    const dens = forestAt(zone, x, z);
    if (dens <= 0.02 || rng() > Math.min(1, dens)) continue;
    const space = minSpace / Math.sqrt(Math.max(0.12, dens));
    if (trees.some(t => dist2(x, z, t.x, t.z) < space * space)) continue;
    trees.push({ x: +x.toFixed(1), z: +z.toFixed(1), s: +(0.85 + rng() * 0.35).toFixed(2), r: +(rng() * 6).toFixed(2) });
  }
  return trees;
}

export function generateScatter(zone) {
  if (!zone.scatter) return [];
  const b = zone.bounds, rng = mulberry32(zone.scatterSeed || 7);
  const out = [];
  // Rarest first. Placement is rejection-sampled against everything already
  // down, so whatever runs last competes for the leftovers — with the specs in
  // authoring order the single Runite vein was asking for space in a cave that
  // 250 stalagmites had already filled, and never got any.
  const specs = zone.scatter.slice().sort((a, b) =>
    (a.count - b.count) || a.model.localeCompare(b.model));
  for (const spec of specs) {
    const anchor = spec.near ? zone.pois.find(p => p.key === spec.near) : null;
    // The sampling budget, not the space. The zone has room for some thirty
    // thousand pieces of dressing at the 3 m spacing this enforces and places
    // under three; what stopped a spec finishing was giving up after count x 40
    // tries, against a stack of gates (forest bias, paths, rivers, structures,
    // solid rock, spacing) that between them reject most candidates. At x40
    // Poison_Mushrooms placed 49 of 71; at x300 it places 61, and the whole
    // scatter pass goes from 266ms to 368ms -- which is nothing, in a build
    // step that runs once.
    let placed = 0, guard = 0;
    while (placed < spec.count && guard++ < spec.count * 300) {
      let x, z;
      if (anchor) {
        const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * (spec.nearR || 22);
        x = anchor.x + Math.cos(a) * rr; z = anchor.z + Math.sin(a) * rr;
      } else {
        x = b.minX + 3 + rng() * (b.maxX - b.minX - 6);
        z = b.minZ + 3 + rng() * (b.maxZ - b.minZ - 6);
      }
      // Test the value that actually gets stored. Testing the full-precision
      // point and then rounding it lets a piece one hundredth inside the wall
      // round to one tenth outside it.
      x = +x.toFixed(1); z = +z.toFixed(1);
      if (zone.boundary && !pointInPoly(x, z, zone.boundary)) continue;
      // `shore` dressing belongs ON THE BANK: dry ground within sight of the
      // water. Scattered through a disc instead, it mostly lands in the middle
      // of the pool and is culled -- Ravenwater kept 2 of its 12 mossy boulders
      // and 1 of its 7 willows that way, and its banks came out bare while its
      // own concept sheet lists boulders and fallen logs as key props.
      if (spec.shore) {
        if (isWater(terrainAt(zone, x, z))) continue;
        const reach = spec.shoreR || 7;
        let found = false;
        for (let i = 0; i < 8 && !found; i++) {
          const a2 = i / 8 * Math.PI * 2;
          for (const rr2 of [reach * 0.45, reach * 0.8, reach]) {
            if (isWater(terrainAt(zone, x + Math.cos(a2) * rr2, z + Math.sin(a2) * rr2))) { found = true; break; }
          }
        }
        if (!found) continue;
      }
      // A trail is a scuff through the grass, so dressing crowds right up to
      // it; a road is kept clear. (Inverted on the first pass, which walled the
      // Wayside Camp's own trail off from the camp and lost its tent.)
      if (pathSpecsOf(zone).some(p => closestOnPolyline(x, z, p.points).dist < (p.kind === 'trail' ? 0.55 : 1) * (spec.r > 0 ? 4.5 : 2.2))) continue;
      // Keep dressing out of the water. A solid piece in a river is worse than
      // useless: an ore vein there is unreachable, because the river is the one
      // thing the player cannot walk through.
      if (riversOf(zone).some(r => closestOnPolyline(x, z, r.points).dist < riverWaterHalf(r.width) + 2.5)) continue;
      // Deep water takes nothing. A fen takes reeds and sedge -- pure decor
      // wades out into it -- but keeps anything solid on the bank.
      // Undergrowth thickens and thins with the wood above it -- but a meadow
      // species wants the opposite of undergrowth, which is light. Scattered
      // with the forest bias a flower pack lands under the canopy where it
      // would never grow, and the clearings the blueprint drew stay bare.
      // `open` inverts the bias so poppies and goldenrod find the open ground.
      if (!spec.near) {
        const dens = forestAt(zone, x, z);
        const keep = spec.open ? Math.min(1, 0.22 + (1 - dens) * 0.9)
                               : Math.min(1, 0.45 + dens * 0.5);
        if (rng() > keep) continue;
      }
      // a pit's own dressing (crates, barricades at the ravine dig) may sit in it; nothing else may
      if (inStructure(zone, x, z, 1.5)) continue;      // the churchyard, not the nave
      // Nothing stands INSIDE a cliff. Rock is solid ground you cannot walk on
      // and it rises many metres, so a piece placed there is either buried or
      // perched out of reach -- and an ore vein in a cliff face is a node that
      // can never be mined. Wolfsnag had 55 of its 65 pieces there, seventeen
      // of them ore, once its chokepoints squeezed the open ground away.
      // The cliff is the one the client DRAWS, which is what a player sees a
      // vein sticking out of, so this asks rockSolidAt and not the cell.
      { const c = terrainAt(zone, x, z);
        if (c === T_OFF || c === T_DEEP || rockSolidAt(zone, x, z)) continue; }
      if ((zone.rocks || []).some(o => dist2(x, z, o.x, o.z) < (o.r + 1.5) ** 2)) continue;
      if ((zone.chests || []).some(c => dist2(x, z, c.x, c.z) < 16)) continue;
      if (dist2(x, z, zone.spawn.x, zone.spawn.z) < 64) continue;
      const spacing = spec.rare ? 3.5 : spec.r > 0 ? 5 : 3;
      if (out.some(o => dist2(x, z, o.x, o.z) < spacing * spacing)) continue;
      const lo = spec.scale ? spec.scale[0] : 1, hi = spec.scale ? spec.scale[1] : 1;
      out.push({
        i: out.length,                      // stable id: veins are addressed by it
        m: spec.model, x, z,
        s: +(lo + rng() * (hi - lo)).toFixed(2), r: +(rng() * 6.28).toFixed(2),
        c: spec.r || 0,
      });
      placed++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Caves. Rooms are lumpy blobs, tunnels are curved capsules between them, and
// caveOutline marches the union into the one `boundary` polygon the engine
// already uses for collision and walls -- so an underground zone needs nothing
// downstream that a surface zone does not already have.
//
// Restored from before the engine purge for the Spider Den, which its concept
// sheet calls "a hidden cave network ... webbed tunnels descend into darkness"
// and which had been standing in as a dip in a field with cobwebs on it.
//
// The seam-fusing helpers that lived alongside these (mergeOutlines,
// roughenOutline) are deliberately NOT back: they existed to weld two surface
// zones into one, that world is gone, and one of them had a sign bug that
// produced a bowtie polygon and an invisible wall.
//
// The tunnel graph must stay a TREE -- see caveOutline for why.
// ---------------------------------------------------------------------------

export function roomRadius(room, angle) {
  return room.r * wobble(room.key || 'room', angle, room.rough != null ? room.rough : 0.34);
}

export function roomShape(room) {
  const seed = room.key || 'room';
  return {
    axis: hash(seed + 'x') * Math.PI,                    // orientation
    stretch: 1.15 + hash(seed + 'y') * 0.45,             // 1.15 to 1.6 long axis
  };
}

export function tunnelPath(cav, t) {
  const a = cav.rooms.find(r => r.key === t.from), b = cav.rooms.find(r => r.key === t.to);
  if (!a || !b) return null;
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const bend = (hash(t.from + t.to) - 0.5) * 2 * (t.bend != null ? t.bend : 0.3) * len;
  return { a, b, c: { x: mx + (-dz / len) * bend, z: mz + (dx / len) * bend } };
}

export function tunnelSamples(cav, t, n = 24) {
  const p = tunnelPath(cav, t);
  if (!p) return [];
  const out = [];
  for (let i = 0; i <= n; i++) out.push(quadPoint(p, i / n));
  return out;
}

export function inCavern(cav, x, z) {
  for (const r of cav.rooms) {
    let dx = x - r.x, dz = z - r.z;
    if (Math.abs(dx) > r.r * 2 || Math.abs(dz) > r.r * 2) continue;   // cheap reject
    const sh = roomShape(r);
    // Into the room's own frame, then squash the long axis so the radial test
    // below describes an elongated blob rather than a disc.
    const ca = Math.cos(-sh.axis), sa = Math.sin(-sh.axis);
    const lx = (dx * ca - dz * sa) / sh.stretch, lz = dx * sa + dz * ca;
    const d = Math.hypot(lx, lz);
    if (d <= roomRadius(r, Math.atan2(lz, lx))) return true;
  }
  for (const t of cav.tunnels) {
    const p = tunnelPath(cav, t);
    if (!p) continue;
    const baseW = (t.w || cav.tunnelWidth || 12) / 2;
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const q = quadPoint(p, s);
      const dx = x - q.x, dz = z - q.z;
      // Passages pinch and open along their length rather than running at one
      // constant width.
      const w = baseW * (0.7 + 0.5 * Math.abs(Math.sin(s * 5.1 + hash(t.from + t.to + 'w') * 6.283)));
      if (dx * dx + dz * dz <= w * w) return true;
    }
  }
  return false;
}

export function caveOutline(cav, bounds, opts = {}) {
  const step = opts.step || 2.5;
  const x0 = bounds.minX, x1 = bounds.maxX, z0 = bounds.minZ, z1 = bounds.maxZ;
  const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
  const at = (i, j) => inCavern(cav, x0 + i * step, z0 + j * step);

  const grid = [];
  for (let i = 0; i <= nx; i++) {
    grid[i] = [];
    for (let j = 0; j <= nz; j++) grid[i][j] = at(i, j);
  }

  // Each cell contributes edge segments between midpoints of its sides.
  const key = (p) => p[0].toFixed(2) + ',' + p[1].toFixed(2);
  const segs = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const tl = grid[i][j], tr = grid[i + 1][j], br = grid[i + 1][j + 1], bl = grid[i][j + 1];
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const X = x0 + i * step, Z = z0 + j * step;
      const T = [X + step / 2, Z], R = [X + step, Z + step / 2];
      const B = [X + step / 2, Z + step], L = [X, Z + step / 2];
      const push = (a, b) => segs.push([a, b]);
      switch (code) {
        case 1: case 14: push(L, B); break;
        case 2: case 13: push(B, R); break;
        case 3: case 12: push(L, R); break;
        case 4: case 11: push(T, R); break;
        case 6: case 9:  push(T, B); break;
        case 7: case 8:  push(L, T); break;
        case 5: push(L, T); push(B, R); break;
        case 10: push(T, R); push(L, B); break;
      }
    }
  }
  if (!segs.length) return [];

  // Chain segments end-to-end into the longest closed ring.
  const adj = new Map();
  for (const [a, b] of segs) {
    for (const [p, q] of [[a, b], [b, a]]) {
      const k = key(p);
      if (!adj.has(k)) adj.set(k, { pt: p, next: [] });
      adj.get(k).next.push(q);
    }
  }
  const used = new Set();
  let best = [];
  for (const startKey of adj.keys()) {
    if (used.has(startKey)) continue;
    const ring = [];
    let cur = adj.get(startKey).pt, curKey = startKey;
    while (true) {
      used.add(curKey);
      ring.push(cur);
      const node = adj.get(curKey);
      if (!node) break;
      const nxt = node.next.find(p => !used.has(key(p)));
      if (!nxt) break;
      cur = nxt; curKey = key(nxt);
    }
    if (ring.length > best.length) best = ring;
  }

  // Ramer-Douglas-Peucker: the raw ring is thousands of 2.5-unit steps, and
  // the client turns every edge into a wall mesh.
  const tol = opts.tolerance || 1.1;
  const simplify = (pts) => {
    if (pts.length < 3) return pts;
    const d2 = (p, a, b) => {
      const vx = b[0] - a[0], vz = b[1] - a[1];
      const len2 = vx * vx + vz * vz || 1;
      let s = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / len2;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const dx = p[0] - (a[0] + vx * s), dz = p[1] - (a[1] + vz * s);
      return dx * dx + dz * dz;
    };
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [lo, hi] = stack.pop();
      let far = -1, fd = tol * tol;
      for (let i = lo + 1; i < hi; i++) {
        const d = d2(pts[i], pts[lo], pts[hi]);
        if (d > fd) { fd = d; far = i; }
      }
      if (far > 0) { keep[far] = true; stack.push([lo, far], [far, hi]); }
    }
    return pts.filter((_, i) => keep[i]);
  };

  return simplify(best).map(p => ({ x: +p[0].toFixed(1), z: +p[1].toFixed(1) }));
}

export function generateHanging(zone) {
  if (!zone.hanging) return [];
  const b = zone.bounds, rng = mulberry32((zone.scatterSeed || 7) + 991);
  const out = [];
  for (const spec of zone.hanging) {
    const anchor = spec.near ? zone.pois.find(p => p.key === spec.near) : null;
    let placed = 0, guard = 0;
    while (placed < spec.count && guard++ < spec.count * 30) {
      let x, z;
      if (anchor) {
        const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * (spec.nearR || 22);
        x = +(anchor.x + Math.cos(a) * rr).toFixed(1); z = +(anchor.z + Math.sin(a) * rr).toFixed(1);
      } else {
        x = +(b.minX + 2 + rng() * (b.maxX - b.minX - 4)).toFixed(1);
        z = +(b.minZ + 2 + rng() * (b.maxZ - b.minZ - 4)).toFixed(1);
      }
      if (zone.boundary && !pointInPoly(x, z, zone.boundary)) continue;
      if (out.some(o => dist2(x, z, o.x, o.z) < 9)) continue;
      const lo = spec.scale ? spec.scale[0] : 1, hi = spec.scale ? spec.scale[1] : 1;
      out.push({ m: spec.model, x, z,
        s: +(lo + rng() * (hi - lo)).toFixed(2), r: +(rng() * 6.28).toFixed(2) });
      placed++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cavern outlines
// ---------------------------------------------------------------------------
// A cave authored as rooms and tunnels, traced into the single boundary polygon
// the rest of the engine already understands — collision (pointInPoly), the
// client's wall segments, spawn placement and scatter all keep working
// unchanged. Rooms are discs, tunnels are capsules between them; the walkable
// region is their union.
//
// Keep the tunnel graph a tree. A cycle encloses rock in the middle, the union
// grows a hole, and a hole is a second contour ring that this returns nothing
// for and that pointInPoly could not represent anyway.

// A room is a disc whose radius wobbles with angle, and a tunnel is a bent
// capsule of varying width. Perfect circles and straight corridors read as
// architecture; caves are lumpy. Every wobble is derived from the room or
// tunnel's own name, so the shape is stable across server restarts and
// identical for every client.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

// Three harmonics: one big lobe, one medium, one fine. Sum of amplitudes stays
// under `rough` so a room never pinches to nothing or balloons past its radius.
function wobble(seed, angle, rough) {
  const p1 = hash(seed + 'a') * 6.283, p2 = hash(seed + 'b') * 6.283, p3 = hash(seed + 'c') * 6.283;
  const k2 = 3 + Math.floor(hash(seed + 'd') * 2);      // 3 or 4 lobes
  const k3 = 6 + Math.floor(hash(seed + 'e') * 3);      // 6 to 8 ripples
  return 1 + rough * (
    0.50 * Math.sin(2 * angle + p1) +
    0.34 * Math.sin(k2 * angle + p2) +
    0.16 * Math.sin(k3 * angle + p3));
}
function quadPoint(p, s) {
  const u = 1 - s;
  return {
    x: u * u * p.a.x + 2 * u * s * p.c.x + s * s * p.b.x,
    z: u * u * p.a.z + 2 * u * s * p.c.z + s * s * p.b.z,
  };
}
function signedArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.z - q.x * p.z; } return a / 2; }
function ccw(poly) { return signedArea(poly) > 0 ? poly.slice() : poly.slice().reverse(); }

// ---------------------------------------------------------------------------
// Everything a zone needs standing up before collision, spawning or a tool can
// ask a question about it: the forest, the dressing, the walls a structure is
// assembled from. Exported because tools must prepare a zone the same way the
// server does -- a check run against an unprepared zone cannot see a tree.
// ---------------------------------------------------------------------------
export function prepareZone(z) {
  z._trees = generateTrees(z);
  z._scatter = generateScatter(z);
  // Anything the zone places by hand goes down after the scatter and is not
  // rejection-sampled: a camp that was laid out is a camp, not a suggestion.
  for (const pr of (z.props || [])) z._scatter.push({ i: z._scatter.length, m: pr.m, x: pr.x, z: pr.z, s: pr.s || 1, r: pr.yaw || 0, c: pr.c || 0 });
  // Trees the zone asks for by hand -- ones inside a clearing the forest was
  // told to keep out of -- join the generated forest, so they get the same
  // trunk collision and the same species-for-a-position as any other tree.
  for (const tr of (z.trees || [])) z._trees.push({ x: tr.x, z: tr.z, s: tr.s || 1, r: tr.r != null ? tr.r : +(Math.random() * 6).toFixed(2) });
  // Collision follows the PIECES a structure is assembled from, not a bounding
  // box: a modular ruin is a row of walls with gaps in it, and the gaps are the
  // point -- they are where the building fell down and where you walk in. Only
  // the ground course collides; an upper course of a tower is something you look
  // at. A piece's `gap` is a doorway at the middle of its run.
  z._walls = [];
  z.pads = [];
  for (const b of (z.structures || [])) {
    const c = Math.cos(b.yaw || 0), sn = Math.sin(b.yaw || 0);
    for (const pc of (b.pieces || [])) {
      if (!pc.wall || (pc.dy || 0) > 0.01) continue;
      const yaw = (b.yaw || 0) + (pc.yaw || 0);
      // The piece's run is along its own X, half a length either side of centre
      // -- and with the SAME sign the client draws it: three.js rotation.y by t
      // sends local +X to (cos t, -sin t). Positions used the opposite sign, so
      // any structure with a non-zero yaw had collision standing somewhere the
      // stone was not.
      const hx = Math.cos(yaw) * pc.wall / 2, hz = -Math.sin(yaw) * pc.wall / 2;
      const px = b.x + pc.dx * c + pc.dz * sn;
      const pz = b.z - pc.dx * sn + pc.dz * c;
      z._walls.push({ x1: px - hx, z1: pz - hz, x2: px + hx, z2: pz + hz,
        r: 0.45, gap: pc.gap || 0 });
    }
    // A ruin you can walk into needs a level floor, or the interior is a slope
    // with a wall standing on stilts at the low end.
    if (b.padW) z.pads.push({ minX: b.x - b.padW, maxX: b.x + b.padW,
      minZ: b.z - b.padD, maxZ: b.z + b.padD, fr: 16 });
  }
  // A farmyard fence is a WALL, not a row of bollards. Every panel used to
  // carry its own collision circle, and circles in a row do not stop anyone:
  // between two of them the two pushes point along the row, cancel, and you
  // walk through. The zone now ships the runs themselves, with the gateways
  // already cut out of them.
  const fences = (z.fences || []).length;
  for (const f of (z.fences || [])) z._walls.push({ x1: f.x1, z1: f.z1, x2: f.x2, z2: f.z2, r: f.r || 0.35, gap: 0 });
  if (z._walls.length) console.log(`[worldgen] ${z._walls.length} wall segments and ${z.pads.length} pads `
    + `from ${(z.structures || []).length} structures and ${fences} fence runs`);

  // Reeds and sedge grow with their feet in the water. A fern, a stump or a
  // berry bush does not, and each of those models is built on its own pad of
  // earth -- so one standing in the Murkfen is a floating clod of dirt in open
  // water. Anything not on the list goes if its cell is wet.
  // Things that belong standing IN the water rather than beside it. The dead
  // trees are here because Ravenwater's and Murkfen's concept sheets both lead
  // on them -- "twisted, dead trees rise from the water", "submerged trees
  // visible beneath surface" -- and the cull would otherwise drag every one of
  // them back onto the bank and leave the pool bare.
  const WADERS = /Pond_Reeds|Meadow_Sedge|Web|Cocoon|Egg_Cluster|Brood_Nest|Boardwalk|Twisted_Dead_Tree|Lily_Pads|Rock_Spire/;
  const beforeN = z._scatter.length;
  z._scatter = z._scatter.filter(o => {
    if (WADERS.test(o.m)) return true;
    return !isWater(terrainAt(z, o.x, o.z));
  });
  const drowned = beforeN - z._scatter.length;
  if (drowned) console.log(`[worldgen] pulled ${drowned} pieces of dressing out of the water`);

  // The map pane shows the region you are standing in. A zone that names its
  // own regions keeps them -- the surface world is the Dark Woods AND the
  // Killing Fields, walked between rather than travelled to. This line used to
  // overwrite whatever a zone declared with a single region covering the lot,
  // which is why the region machinery the client has always carried had never
  // had more than one thing in it.
  if (!z.regions || !z.regions.length) {
    z.regions = [{ id: z.id, name: z.name, subtitle: z.subtitle,
      bounds: { ...z.bounds }, boundary: (z.boundary || []).map(p => ({ x: p.x, z: p.z })) }];
  }
  z._cen = null;
  console.log(`[worldgen] ${z.name}: ${z.bounds.maxX - z.bounds.minX} x ${z.bounds.maxZ - z.bounds.minZ} units, ` +
    `${z._trees.length} trees, ${z._scatter.length} scatter, ${(z.pois || []).length} landmarks`);
}

// How deep the water is on a point, and whether you are standing on planks
// over it. This lived in server.js and was re-derived by hand twice in
// tools/zonecheck.mjs, so the checker's fishing invariants were measuring a
// paraphrase of the swim rule rather than the swim rule. Three copies of one
// number; one of them is now the number.
export function onDeck(zone, x, z, grow = 0) {
  for (const r of riversOf(zone)) {
    for (const b of bridgesOf(r)) {
      const span = (b.span || 12) + 2 * grow;
      if (dist2(x, z, b.x, b.z) < (span * span) / 4) return true;
    }
  }
  // One rectangle for both sides -- see onDeckSpan in shared/terrain.js.
  for (const d of (zone.decks || [])) if (onDeckSpan(d, x, z, grow)) return true;
  return false;
}
// How far past the deep contour the bed has to shelve before you are out of
// your depth. Tuned against the measured profile at Ravenwater, which drops
// from nothing at the bank to 3.8 m twenty-five metres out.
// At 0.34 the swim line measured 15 m out at Ravenwater in 1.93 m of water --
// over a fighter's head. Shoulders on a 1.8 m man are about 1.5 m, so the ramp
// is shortened to put the line there: you wade to your chest and swim past it.
const DEEP_RAMP = 0.29;
export function waterDepthAt(zone, x, z, deckGrow = 0) {
  if (onDeck(zone, x, z, deckGrow)) return 0;      // dry feet: you are on the planks
  let d = 0;
  if (zone.terrain) {
    // The SAME contour the client draws its shoreline from -- not the raw cell.
    // A cell is 2.5 m and the drawn shore is a smooth curve through it, so asking
    // the grid "is this cell wet" put the waterline up to a couple of metres away
    // from the water you can see. Both sides read zone.waterEdge.
    const E = zone.waterEdge;
    if (E) {
      // GRADED, not a step. This returned 1 the instant you crossed the deep
      // contour, so you started swimming at the water's edge where it is
      // ankle deep -- a step off the bank and you were out of your depth. The
      // bed shelves, and the field shelves with it: at the contour you are
      // wading, and you only lose your feet once you are properly out. At
      // Ravenwater that puts the swim line about thirteen metres out, where
      // the pool is a metre and a half deep -- chest-to-shoulder on a man.
      const dg = terrainFieldAt(zone, x, z, 'deep');
      const wg = terrainFieldAt(zone, x, z, 'wet');
      if (dg >= E.deep) {
        const t = Math.min(1, (dg - E.deep) / DEEP_RAMP);
        d = Math.max(d, 0.30 + 0.70 * (t * t * (3 - 2 * t)));
      } else if (wg >= E.marsh) d = 0.35;                                // wadeable
    } else {
      const c = terrainAt(zone, x, z);
      if (c === T_DEEP) d = 1;
      else if (c === T_MARSH) d = 0.35;
    }
  }
  for (const r of riversOf(zone)) {
    const dist = closestOnPolyline(x, z, r.points).dist;
    // A SECOND idea of how wide a river is. The terrain carves the channel and
    // hangs the water out to riverWaterHalf(width) -- width/2 plus the bank --
    // and this asked about width/2, so on the outer half of every river you
    // walked along the bed with dry feet under water that was drawn over your
    // head. Measured across all four rivers: 21% of the ring between the two
    // widths had more than half a metre of visible water and depth 0 here,
    // worst 1.53 m on the Sallows. One width, the one that draws the water.
    //
    // This also puts the swim line where the comment above says it was aimed.
    // On width/2 it landed 2.42 m out on the Creek in 1.66 m of water and
    // 2.69 m out on the Redwater in 2.72 m -- past a man's head, because the
    // ramp was being run over half the real channel. On the drawn half-width
    // it lands in 1.44 m on both the Creek and the Crowwater, which is the
    // shoulder height this was tuned to. The middle of a river is still a
    // swim, so bridges and fords still carry the roads.
    const half = riverWaterHalf(r.width);
    if (dist >= half) continue;
    // shelves off toward the middle of the channel rather than dropping at the bank
    d = Math.max(d, Math.min(1, 0.45 + (1 - dist / half) * 0.8));
  }
  return d;
}
