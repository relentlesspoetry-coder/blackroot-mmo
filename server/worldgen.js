// Blackroot — deterministic world generation.
//
// Trees and cave dressing are placed here, on the server, so every client sees
// the same world and the solid pieces can be authoritative. Pure functions with
// no side effects: seed in, placements out. See tools/worldgen.mjs.

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
// Extra flooded width beyond the river's nominal half-width (matches the client
// and server collision, so nothing is placed in the widened water).
const RIVER_BANK = 4;
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
export const T_OFF = ' ', T_DEEP = 'W', T_MARSH = 'w', T_ROCK = 'R',
             T_DENSE = 'F', T_WOOD = 'f', T_OPEN = '.';

export function terrainOf(zone) { return zone && zone.terrain; }
// The class at (x,z). Off the grid reads as off the map.
export function terrainAt(zone, x, z) {
  const t = zone && zone.terrain;
  if (!t) return T_OPEN;
  const gx = Math.floor((x - t.minX) / t.cell), gz = Math.floor((z - t.minZ) / t.cell);
  if (gz < 0 || gz >= t.h || gx < 0 || gx >= t.w) return T_OFF;
  return t.rows[gz][gx] || T_OFF;
}
export function isWater(c) { return c === T_DEEP || c === T_MARSH; }

// The wetness field the SHORELINE is drawn from -- box-blurred twice over a few
// cells, then sampled bilinear. This has to be here, and has to match the client
// exactly, because the client stopped drawing water on the raw cell grid: it
// contours this field instead, so a cell is no longer the same thing as water.
// Deciding swimming from cells while drawing the shore from the contour left 766
// cells of open ground you swam across. Both sides now read `zone.waterEdge`,
// which the zone generator writes, so the levels cannot drift apart.
const FIELD_SRC = {
  deep: c => (c === T_DEEP ? 1 : 0),
  wet: c => ((c === T_DEEP || c === T_MARSH) ? 1 : 0),
  rock: c => (c === T_ROCK ? 1 : 0),
};
export function terrainFieldAt(zone, x, z, name) {
  const t = zone && zone.terrain;
  if (!t) return 0;
  const R = (zone.waterEdge && zone.waterEdge.blur) || 3;
  let F = zone._fields;
  if (!F) {
    F = zone._fields = {};
    for (const [key, of] of Object.entries(FIELD_SRC)) {
      const raw = new Float32Array(t.w * t.h);
      for (let gz = 0; gz < t.h; gz++) {
        for (let gx = 0; gx < t.w; gx++) raw[gz * t.w + gx] = of(t.rows[gz][gx] || T_OFF);
      }
      const tmp = new Float32Array(t.w * t.h), out = new Float32Array(t.w * t.h);
      const pass = (src, dst, horiz) => {
        for (let gz = 0; gz < t.h; gz++) for (let gx = 0; gx < t.w; gx++) {
          let sum = 0, n = 0;
          for (let d = -R; d <= R; d++) {
            const ix = horiz ? gx + d : gx, iz = horiz ? gz : gz + d;
            if (ix < 0 || ix >= t.w || iz < 0 || iz >= t.h) continue;
            sum += src[iz * t.w + ix]; n++;
          }
          dst[gz * t.w + gx] = n ? sum / n : 0;
        }
      };
      pass(raw, tmp, true); pass(tmp, out, false);
      pass(out, tmp, true); pass(tmp, out, false);
      F[key] = out;
    }
  }
  const g = F[name];
  if (!g) return 0;
  const fx = (x - t.minX) / t.cell - 0.5, fz = (z - t.minZ) / t.cell - 0.5;
  const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
  const at = (ix, iz) => (iz < 0 || iz >= t.h || ix < 0 || ix >= t.w) ? 0 : g[iz * t.w + ix];
  const a = at(x0, z0) * (1 - tx) + at(x0 + 1, z0) * tx;
  const b = at(x0, z0 + 1) * (1 - tx) + at(x0 + 1, z0 + 1) * tx;
  return a * (1 - tz) + b * tz;
}
// Solid ground you cannot enter: deep water, rock, and off the map.
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
export function forestAt(zone, x, z) {
  switch (terrainAt(zone, x, z)) {
    case T_DENSE: return 1.9;
    case T_WOOD:  return 1.0;
    case T_OPEN:  return 0.06;
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
    if (riversOf(zone).some(r => closestOnPolyline(x, z, r.points).dist < r.width / 2 + RIVER_BANK + 3)) continue;
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
    let placed = 0, guard = 0;
    while (placed < spec.count && guard++ < spec.count * 40) {
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
      if (riversOf(zone).some(r => closestOnPolyline(x, z, r.points).dist < r.width / 2 + RIVER_BANK + 2.5)) continue;
      // Deep water takes nothing. A fen takes reeds and sedge -- pure decor
      // wades out into it -- but keeps anything solid on the bank.
      // Undergrowth thickens and thins with the wood above it.
      if (!spec.near && rng() > Math.min(1, 0.45 + forestAt(zone, x, z) * 0.5)) continue;
      // a pit's own dressing (crates, barricades at the ravine dig) may sit in it; nothing else may
      if (inStructure(zone, x, z, 1.5)) continue;      // the churchyard, not the nave
      // Nothing stands INSIDE a cliff. Rock is solid ground you cannot walk on
      // and it rises many metres, so a piece placed there is either buried or
      // perched out of reach -- and an ore vein in a cliff face is a node that
      // can never be mined. Wolfsnag had 55 of its 65 pieces there, seventeen
      // of them ore, once its chokepoints squeezed the open ground away.
      if (isSolid(terrainAt(zone, x, z))) continue;
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