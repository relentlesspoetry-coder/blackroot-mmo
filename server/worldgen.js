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
// Inside the farmyard keep-out box (plus margin m)? Keeps forest/scatter out.
function inFarm(zone, x, z, m = 0) {
  const b = zone._farmBox; if (!b) return false;
  return x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
}
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
// Lakes and fens: standing water with a real outline, rather than a river made
// fat enough to pretend. `points` is a closed polygon; `shallow` water can be
// waded (a fen), deep water is solid and you walk around it.
export function lakesOf(zone) { return (zone && zone.lakes) || []; }
// A closed ring of the polygon, for distance queries.
export function lakeRing(lake) {
  if (!lake._ring) lake._ring = [...lake.points, lake.points[0]];
  return lake._ring;
}
// Distance from (x,z) to the lake's edge, negative inside it.
export function lakeEdgeDist(lake, x, z) {
  const d = closestOnPolyline(x, z, lakeRing(lake)).dist;
  return pointInPoly(x, z, lake.points) ? -d : d;
}

// The same one-or-many rule for roads: `path` is a single route, `paths` is a
// network (a main road with spurs to each of the zone's exits).
export function pathsOf(zone) {
  if (!zone) return [];
  return zone.paths || (zone.path ? [zone.path] : []);
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
// The mining pits (zone.mines, each at the POI of its key), as circles to keep
// the forest and scatter out of, with a margin for the fence and dirt fringe.
export function mineAreas(zone) {
  if (zone._mineAreas) return zone._mineAreas;
  zone._mineAreas = (zone.mines || []).map(m => { const p = (zone.pois || []).find(q => q.key === m.key); return p ? { x: p.x, z: p.z, r: m.r } : null; }).filter(Boolean);
  return zone._mineAreas;
}
function inMine(zone, x, z, m = 0) { return mineAreas(zone).some(a => dist2(x, z, a.x, a.z) < (a.r + m) ** 2); }
// Inside one of the enterable houses (axis-aligned, w x d about its centre)?
// The farm keep-out box is built from the fence line alone, so a cottage set
// outside the fences was protected by nothing and the forest grew through its
// roof. Canopy over a roof is fine and looks well; a trunk in the bedroom is
// not, so the margin only has to keep trunks off the walls.
export function houseAreas(zone) {
  return ((zone.farm && zone.farm.houses) || []);
}
export function inHouse(zone, x, z, m = 0) {
  return houseAreas(zone).some(h => Math.abs(x - h.x) < h.w / 2 + m && Math.abs(z - h.z) < h.d / 2 + m);
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
  const trees = [], minSpace = 11;
  let guard = 0;
  while (trees.length < zone.treeCount && guard++ < zone.treeCount * 25) {
    const x = b.minX + 3 + rng() * (b.maxX - b.minX - 6);
    const z = b.minZ + 3 + rng() * (b.maxZ - b.minZ - 6);
    if (zone.boundary && !pointInPoly(x, z, zone.boundary)) continue;
    if (pathsOf(zone).some(p => closestOnPolyline(x, z, p).dist < 6)) continue;
    if (riversOf(zone).some(r => closestOnPolyline(x, z, r.points).dist < r.width / 2 + RIVER_BANK + 3)) continue;
    if (lakesOf(zone).some(l => lakeEdgeDist(l, x, z) < 3)) continue;
    if (riversOf(zone).some(r => bridgesOf(r).some(b => dist2(x, z, b.x, b.z) < 15 * 15))) continue;
    if (inFarm(zone, x, z, 3)) continue;
    if (inHouse(zone, x, z, 2.5)) continue;
    if (inMine(zone, x, z, 4)) continue;
    if (zone.pois.some(p => dist2(x, z, p.x, p.z) < clearRadiusS(p) ** 2)) continue;
    if ((zone.rocks || []).some(o => dist2(x, z, o.x, o.z) < (o.r + 2) ** 2)) continue;
    if (trees.some(t => dist2(x, z, t.x, t.z) < minSpace * minSpace)) continue;
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
      if (pathsOf(zone).some(p => closestOnPolyline(x, z, p).dist < (spec.r > 0 ? 4.5 : 2.2))) continue;
      // Keep dressing out of the water. A solid piece in a river is worse than
      // useless: an ore vein there is unreachable, because the river is the one
      // thing the player cannot walk through.
      if (riversOf(zone).some(r => closestOnPolyline(x, z, r.points).dist < r.width / 2 + RIVER_BANK + 2.5)) continue;
      if (lakesOf(zone).some(l => lakeEdgeDist(l, x, z) < (l.shallow ? 0 : 2.5))) continue;
      if (inFarm(zone, x, z, 2)) continue;
      if (inHouse(zone, x, z, 1.5)) continue;
      // a pit's own dressing (crates, barricades at the ravine dig) may sit in it; nothing else may
      if (inMine(zone, x, z, 3) && !(spec.near && (zone.mines || []).some(m => m.key === spec.near))) continue;
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

export function roomRadius(room, angle) {
  return room.r * wobble(room.key || 'room', angle, room.rough != null ? room.rough : 0.34);
}

// Rooms are also stretched along an axis of their own. A circle with ripples
// still reads as a circle; an elongated lumpy blob reads as a cave.
export function roomShape(room) {
  const seed = room.key || 'room';
  return {
    axis: hash(seed + 'x') * Math.PI,                    // orientation
    stretch: 1.15 + hash(seed + 'y') * 0.45,             // 1.15 to 1.6 long axis
  };
}

// A tunnel bends through a midpoint pushed off the straight line, so passages
// curve instead of running dead straight between rooms.
export function tunnelPath(cav, t) {
  const a = cav.rooms.find(r => r.key === t.from), b = cav.rooms.find(r => r.key === t.to);
  if (!a || !b) return null;
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const bend = (hash(t.from + t.to) - 0.5) * 2 * (t.bend != null ? t.bend : 0.3) * len;
  return { a, b, c: { x: mx + (-dz / len) * bend, z: mz + (dx / len) * bend } };
}

function quadPoint(p, s) {
  const u = 1 - s;
  return {
    x: u * u * p.a.x + 2 * u * s * p.c.x + s * s * p.b.x,
    z: u * u * p.a.z + 2 * u * s * p.c.z + s * s * p.b.z,
  };
}

// Points along a tunnel's actual curve — used by tools to verify a passage is
// open end to end. Sampling the straight line between room centres tests rock.
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

// Marching squares over the union, chained into one ring and simplified.
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

// ---------------------------------------------------------------------------
// The world's outline. Two zones stacked north/south each have their own
// natural boundary polygon; the world's boundary is the two joined into one
// (each loses the arc that faces the seam, and short bridges close the sides)
// and then roughened: subdivided every few metres and pushed OUTWARD by
// layered noise so the mountain wall wanders in bays and headlands instead of
// running in straight edges. Only outward, so nothing authored inside either
// zone ends up in the rock.
// ---------------------------------------------------------------------------
function signedArea(poly) { let a = 0; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.z - q.x * p.z; } return a / 2; }
function ccw(poly) { return signedArea(poly) > 0 ? poly.slice() : poly.slice().reverse(); }
export function mergeOutlines(north, south, seamZ, keep = 40) {
  // Both counter-clockwise (in x/z). Drop each polygon's points that face the
  // seam, then walk north's remaining arc and south's remaining arc so the
  // result is one loop: north arc (west -> east along its far side), bridge,
  // south arc, bridge back.
  const N = ccw(north).filter(p => p.z < seamZ - keep), S = ccw(south).filter(p => p.z > seamZ + keep);
  // rotate each arc so it starts at its end nearest the seam on one side: for
  // the north arc start at the south-west-most kept point and go around the
  // top to the south-east-most; south arc from north-east to north-west.
  const rot = (arr, startIdx) => arr.slice(startIdx).concat(arr.slice(0, startIdx));
  const nIdx = N.reduce((b, p, i) => (p.z - p.x * 0.3 > N[b].z - N[b].x * 0.3 ? i : b), 0);      // SW-most
  let n = rot(N, nIdx);
  // ensure it runs west->north->east (x increasing over the top): if the next point heads south-east, reverse
  if (n[1].z > n[0].z) n = [n[0]].concat(n.slice(1).reverse());
  const sIdx = S.reduce((b, p, i) => (p.z + p.x * 0.3 < S[b].z + S[b].x * 0.3 ? i : b), 0);      // NE-most
  let sArr = rot(S, sIdx);
  if (sArr[1].z < sArr[0].z) sArr = [sArr[0]].concat(sArr.slice(1).reverse());
  return n.concat(sArr).map(p => ({ x: p.x, z: p.z }));
}
export function roughenOutline(poly, seed, opts = {}) {
  const step = opts.step || 5, big = opts.big || 18, mid = opts.mid || 5, small = opts.small || 1.6;
  const rng = mulberry32(seed);
  const lat = (n) => { const a = []; for (let i = 0; i < n; i++) a.push(rng()); return a; };
  const L1 = lat(24), L2 = lat(96), L3 = lat(384);
  const per = (L, u) => { const n = L.length, x = ((u % 1) + 1) % 1 * n, i = Math.floor(x), f = x - i, t = f * f * (3 - 2 * f); return L[i % n] * (1 - t) + L[(i + 1) % n] * t; };
  const P = ccw(poly), N = P.length;
  let total = 0; const cum = [0];
  for (let i = 0; i < N; i++) { const a = P[i], b = P[(i + 1) % N]; total += Math.hypot(b.x - a.x, b.z - a.z); cum.push(total); }
  let cx = 0, cz = 0; for (const p of P) { cx += p.x; cz += p.z; } cx /= N; cz /= N;
  const out = [];
  for (let i = 0; i < N; i++) {
    const a = P[i], b = P[(i + 1) % N], len = Math.hypot(b.x - a.x, b.z - a.z), segs = Math.max(1, Math.round(len / step));
    // outward normal of this edge (polygon is ccw, so the left of the edge is inside)
    let nx = (b.z - a.z) / len, nz = -(b.x - a.x) / len;
    if ((a.x + b.x) / 2 * nx + (a.z + b.z) / 2 * nz < cx * nx + cz * nz) { nx = -nx; nz = -nz; }
    for (let s = 0; s < segs; s++) {
      const t = s / segs, u = (cum[i] + len * t) / total;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      // layered, purely outward: broad bays, mid-size shoulders, small crags
      const d = Math.max(0, per(L1, u) - 0.3) / 0.7 * big + per(L2, u) * mid + per(L3, u) * small;
      out.push({ x: +(x + nx * d).toFixed(1), z: +(z + nz * d).toFixed(1) });
    }
  }
  return out;
}
// Forest for the world's edge: the bays the roughened outline opened up and a
// dense band inside the wall, so the border reads as deep woods rather than a
// bare strip of grass in front of rock.
export function generateEdgeForest(zone, innerPolys, seed, band = 32) {
  const b = zone.bounds, rng = mulberry32(seed), out = [], trees = zone._trees || [];
  const ring = zone.boundary.concat([zone.boundary[0]]);
  const minSpace = 7.5, tries = 9000;
  for (let k = 0; k < tries; k++) {
    const x = b.minX + rng() * (b.maxX - b.minX), z = b.minZ + rng() * (b.maxZ - b.minZ);
    if (!pointInPoly(x, z, zone.boundary)) continue;
    const dEdge = closestOnPolyline(x, z, ring).dist;
    const inside = innerPolys.some(pg => pointInPoly(x, z, pg));
    if (inside && dEdge > band) continue;                   // deep interior already has its forest
    if (dEdge < 2.5) continue;                              // not in the rock
    if (pathsOf(zone).some(p => closestOnPolyline(x, z, p).dist < 6)) continue;
    if (riversOf(zone).some(r => closestOnPolyline(x, z, r.points).dist < r.width / 2 + RIVER_BANK + 3)) continue;
    if (lakesOf(zone).some(l => lakeEdgeDist(l, x, z) < 3)) continue;
    if (inFarm(zone, x, z, 3) || inMine(zone, x, z, 4) || inHouse(zone, x, z, 2.5)) continue;
    if ((zone.pois || []).some(p => dist2(x, z, p.x, p.z) < clearRadiusS(p) ** 2)) continue;
    const near = (t) => dist2(x, z, t.x, t.z) < minSpace * minSpace;
    if (trees.some(near) || out.some(near)) continue;
    out.push({ x: +x.toFixed(1), z: +z.toFixed(1), s: +(0.85 + rng() * 0.35).toFixed(2), r: +(rng() * 6).toFixed(2) });
  }
  return out;
}
