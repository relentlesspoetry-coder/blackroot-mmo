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
        const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * 14;
        x = anchor.x + Math.cos(a) * rr; z = anchor.z + Math.sin(a) * rr;
      } else {
        x = b.minX + 3 + rng() * (b.maxX - b.minX - 6);
        z = b.minZ + 3 + rng() * (b.maxZ - b.minZ - 6);
      }
      if (zone.boundary && !pointInPoly(x, z, zone.boundary)) continue;
      if (zone.path && closestOnPolyline(x, z, zone.path).dist < (spec.r > 0 ? 4.5 : 2.2)) continue;
      if ((zone.rocks || []).some(o => dist2(x, z, o.x, o.z) < (o.r + 1.5) ** 2)) continue;
      if ((zone.chests || []).some(c => dist2(x, z, c.x, c.z) < 16)) continue;
      if (dist2(x, z, zone.spawn.x, zone.spawn.z) < 64) continue;
      const spacing = spec.rare ? 3.5 : spec.r > 0 ? 5 : 3;
      if (out.some(o => dist2(x, z, o.x, o.z) < spacing * spacing)) continue;
      const lo = spec.scale ? spec.scale[0] : 1, hi = spec.scale ? spec.scale[1] : 1;
      out.push({
        m: spec.model, x: +x.toFixed(1), z: +z.toFixed(1),
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
      const x = b.minX + 2 + rng() * (b.maxX - b.minX - 4);
      const z = b.minZ + 2 + rng() * (b.maxZ - b.minZ - 4);
      if (zone.boundary && !pointInPoly(x, z, zone.boundary)) continue;
      if (out.some(o => dist2(x, z, o.x, o.z) < 9)) continue;
      const lo = spec.scale ? spec.scale[0] : 1, hi = spec.scale ? spec.scale[1] : 1;
      out.push({ m: spec.model, x: +x.toFixed(1), z: +z.toFixed(1),
        s: +(lo + rng() * (hi - lo)).toFixed(2), r: +(rng() * 6.28).toFixed(2) });
      placed++;
    }
  }
  return out;
}
