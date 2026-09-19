// Blackroot — deterministic world generation.
//
// Trees and cave dressing are placed here, on the server, so every client sees
// the same world and the solid pieces can be authoritative. Pure functions with
// no side effects: seed in, placements out. See tools/worldgen.mjs.

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

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
  if (p.kind === 'cave') return 9;
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
    if (closestOnPolyline(x, z, zone.path).dist < 6) continue;
    if (zone.river && closestOnPolyline(x, z, zone.river.points).dist < zone.river.width / 2 + 3) continue;
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
      if (zone.path && closestOnPolyline(x, z, zone.path).dist < (spec.r > 0 ? 4.5 : 2.2)) continue;
      // Keep dressing out of the water. A solid piece in a river is worse than
      // useless: an ore vein there is unreachable, because the river is the one
      // thing the player cannot walk through.
      if (zone.river && closestOnPolyline(x, z, zone.river.points).dist < zone.river.width / 2 + 2.5) continue;
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
    let placed = 0, guard = 0;
    while (placed < spec.count && guard++ < spec.count * 30) {
      const x = +(b.minX + 2 + rng() * (b.maxX - b.minX - 4)).toFixed(1);
      const z = +(b.minZ + 2 + rng() * (b.maxZ - b.minZ - 4)).toFixed(1);
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

export function inCavern(cav, x, z) {
  for (const r of cav.rooms) {
    const dx = x - r.x, dz = z - r.z;
    if (dx * dx + dz * dz <= r.r * r.r) return true;
  }
  for (const t of cav.tunnels) {
    const a = cav.rooms.find(r => r.key === t.from), b = cav.rooms.find(r => r.key === t.to);
    if (!a || !b) continue;
    const vx = b.x - a.x, vz = b.z - a.z;
    const len2 = vx * vx + vz * vz || 1;
    let s = ((x - a.x) * vx + (z - a.z) * vz) / len2;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const dx = x - (a.x + vx * s), dz = z - (a.z + vz * s);
    const w = (t.w || cav.tunnelWidth || 12) / 2;
    if (dx * dx + dz * dz <= w * w) return true;
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
  const tol = opts.tolerance || 1.6;
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
