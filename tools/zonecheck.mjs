// Invariants for the Dark Woods. Every one of these is here because it broke:
// they are regression tests, not a style guide.
//
//   node tools/zonecheck.mjs
//
// Exits non-zero if any invariant fails, so it can gate a build.
import { darkwoods as z } from '../server/zones/darkwoods.js';
import { terrainAt, terrainFieldAt, isSolid } from '../server/worldgen.js';

let failures = 0;
const ok = (name, pass, detail) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) failures++;
};

const T = z.terrain;
const segDist = (x, zz, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (zz - a.z) * dz) / L2));
  return Math.hypot(x - (a.x + dx * t), zz - (a.z + dz * t));
};
const toPath = (x, zz) => {
  let best = 1e9;
  for (const p of z.paths) for (let i = 0; i < p.points.length - 1; i++)
    best = Math.min(best, segDist(x, zz, p.points[i], p.points[i + 1]));
  return best;
};
const onDeck = (x, zz) => {
  for (const r of (z.rivers || [])) for (const b of (r.bridges || [])) {
    const s = b.span || 12;
    if ((x - b.x) ** 2 + (zz - b.z) ** 2 < s * s / 4) return true;
  }
  for (const d of (z.decks || [])) {
    const dx = x - d.x, dz = zz - d.z, sn = Math.sin(d.yaw || 0), cs = Math.cos(d.yaw || 0);
    if (Math.abs(dx * cs + dz * sn) <= (d.len || 4) / 2
     && Math.abs(-dx * sn + dz * cs) <= (d.w || 2.4) / 2) return true;
  }
  return false;
};

console.log('\nThe Dark Woods — zone invariants\n');

// --- water -----------------------------------------------------------------
// The client contours its shoreline off `waterEdge` and the server decides
// swimming off the same numbers. When those two came apart there were 766 cells
// of open ground you swam across.
{
  const E = z.waterEdge;
  ok('zone carries waterEdge', !!(E && E.deep && E.marsh && E.fade),
      E ? `deep ${E.deep} marsh ${E.marsh} fade ${E.fade}` : 'missing');
  // The real test has to reproduce the CLIENT's shoreline, which is the ground
  // crossing the waterline -- not just restate the server's rule, which would
  // be comparing a number with itself and could never fail.
  const RIVER_WATER_Y = -0.5, RIVER_BED_Y = -2.2, RIVER_BANK = 4, RIVER_LIP = 2.0;
  const ROCK_RISE = 17, WATER_CUT = 4.6, MARSH_CUT = 2.0;
  const dFall = Math.log(0.5 / WATER_CUT) / Math.log(E.deep);
  const mFall = Math.log(0.5 / MARSH_CUT) / Math.log(E.marsh);
  const polyDist = (x, zz, pts) => {
    let m = 1e9;
    for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segDist(x, zz, pts[i], pts[i + 1]));
    return m;
  };
  const landHeight = (x, zz) => {
    let h = 0;
    for (const k of (z.hills || [])) {
      const d = Math.hypot(x - k.x, zz - k.z);
      if (d >= k.r) continue;
      const t = 1 - d / k.r;
      h += k.h * t * t * (3 - 2 * t);
    }
    return h;
  };
  const terrainHeight = (x, zz) => {
    const wet = terrainFieldAt(z, x, zz, 'wet'), deep = terrainFieldAt(z, x, zz, 'deep');
    const rock = terrainFieldAt(z, x, zz, 'rock');
    const LF = Math.max(0, 1 - wet / E.fade);
    let y = LF * (landHeight(x, zz) + ROCK_RISE * rock * rock);
    y -= WATER_CUT * Math.pow(deep, dFall)
       + MARSH_CUT * Math.max(0, Math.pow(wet, mFall) - Math.pow(deep, mFall));
    for (const r of (z.rivers || [])) {
      const half = r.width / 2 + RIVER_BANK, H = half + RIVER_LIP;
      const d = polyDist(x, zz, r.points);
      if (d >= H) continue;
      const h = d >= half
        ? RIVER_WATER_Y + (0 - RIVER_WATER_Y) * ((d - half) / RIVER_LIP)
        : RIVER_BED_Y + (RIVER_WATER_Y - RIVER_BED_Y) * Math.pow(d / half, 3);
      if (h < 0 && h < y) y = h;
    }
    return y;
  };
  let swimDry = 0, wadeDry = 0;
  if (E) for (let gz = 0; gz < T.h; gz++) for (let gx = 0; gx < T.w; gx++) {
    if (T.rows[gz][gx] === ' ') continue;
    const x = T.minX + (gx + 0.5) * T.cell, zz = T.minZ + (gz + 0.5) * T.cell;
    if (onDeck(x, zz)) continue;
    // the server makes you swim here
    if (terrainFieldAt(z, x, zz, 'deep') < E.deep) continue;
    // ...so the client must be drawing its deep sheet here too
    const drawn = Math.min(RIVER_WATER_Y + 0.02 - terrainHeight(x, zz),
                           (terrainFieldAt(z, x, zz, 'deep') - E.deep) * 24) >= 0;
    if (!drawn) swimDry++;
  }
  ok('no swimming without water drawn', swimDry === 0, `${swimDry} cells`);
}

// --- crossings -------------------------------------------------------------
// A bridge belongs where a road meets a river and nowhere else.
{
  let fords = 0, offLine = 0, bridges = 0;
  for (const r of z.rivers) {
    for (const b of (r.bridges || [])) {
      bridges++;
      let d = 1e9;
      for (let i = 0; i < r.points.length - 1; i++) d = Math.min(d, segDist(b.x, b.z, r.points[i], r.points[i + 1]));
      if (d > 2) offLine++;
    }
    for (const p of z.paths) for (let i = 0; i < p.points.length - 1; i++) {
      for (let j = 0; j < r.points.length - 1; j++) {
        const a1 = p.points[i], a2 = p.points[i + 1], b1 = r.points[j], b2 = r.points[j + 1];
        const d = (a2.x - a1.x) * (b2.z - b1.z) - (a2.z - a1.z) * (b2.x - b1.x);
        if (Math.abs(d) < 1e-9) continue;
        const t = ((b1.x - a1.x) * (b2.z - b1.z) - (b1.z - a1.z) * (b2.x - b1.x)) / d;
        const u = ((b1.x - a1.x) * (a2.z - a1.z) - (b1.z - a1.z) * (a2.x - a1.x)) / d;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const hx = a1.x + (a2.x - a1.x) * t, hz = a1.z + (a2.z - a1.z) * t;
        if (!(r.bridges || []).some(b => Math.hypot(b.x - hx, b.z - hz) < 12)) fords++;
      }
    }
  }
  ok('every path/river crossing is bridged', fords === 0, `${fords} fords, ${bridges} bridges`);
  ok('every bridge sits on its centreline', offLine === 0, `${offLine} adrift`);
}

// --- the fen ---------------------------------------------------------------
{
  const D = z.decks || [];
  let gaps = 0, adrift = 0;
  for (const d of D) {
    let nearest = 1e9;
    for (const e of D) if (e !== d) nearest = Math.min(nearest, Math.hypot(d.x - e.x, d.z - e.z));
    if (nearest > 4.3) gaps++;
    let ends = 0;
    for (const e of D) if (e !== d && Math.hypot(d.x - e.x, d.z - e.z) < 5) ends++;
    if (ends <= 1 && toPath(d.x, d.z) > 6 && d.m !== 'Boardwalk_Jetty') adrift++;
  }
  ok('plank walk has no gaps', gaps === 0, `${D.length} spans, ${gaps} isolated`);
  ok('every walk end meets a path', adrift === 0, `${adrift} adrift`);
}

// --- buildings -------------------------------------------------------------
// Every piece is set at the height of its structure's CENTRE, so anything
// outside the levelled pad floats or sinks with the hillside.
{
  let overflow = 0, sealed = 0;
  for (const b of z.structures) {
    let mx = 0, mz = 0;
    for (const pc of b.pieces) { mx = Math.max(mx, Math.abs(pc.dx)); mz = Math.max(mz, Math.abs(pc.dz)); }
    if (b.padW && (mx > b.padW || mz > b.padD)) overflow++;
    const walls = b.pieces.filter(pc => pc.wall && !(pc.dy > 0.01));
    if (walls.length > 6 && !walls.some(pc => pc.gap)) sealed++;
  }
  ok('structure pads cover their pieces', overflow === 0, `${overflow} overflowing`);
  ok('enclosed structures have a doorway', sealed === 0, `${sealed} sealed`);
}

// --- camp palisades --------------------------------------------------------
// A fence across the road is the farm-gate bug: the gateways are cut by the
// paths, so none of them may stand on one.
{
  const barriers = z.props.filter(o => /Rough_Fence|Spike_Barricade/.test(o.m));
  const blocking = barriers.filter(o => toPath(o.x, o.z) < 2.8).length;
  ok('no barrier stands on a path', blocking === 0, `${barriers.length} barriers, ${blocking} blocking`);
}

// --- interactables ---------------------------------------------------------
{
  const spots = z.fishingSpots || [];
  const dry = spots.filter(f => {
    const c = terrainAt(z, f.x, f.z);
    if (c === 'W' || c === 'w') return false;
    for (const r of z.rivers) for (let i = 0; i < r.points.length - 1; i++)
      if (segDist(f.x, f.z, r.points[i], r.points[i + 1]) < r.width / 2 + 4) return false;
    return true;
  }).length;
  ok('every fishing spot is on water', dry === 0, `${spots.length} spots, ${dry} on land`);

  const ore = (z.scatter || []).filter(o => /Ore_Vein/.test(o.model || o.m || ''));
  ok('ore specs exist', ore.length > 0, `${ore.length} vein specs`);

  // Anything you have to walk up to must stand on ground you can stand on.
  // Two chests had been sealed inside cliffs -- unopenable, and silent about it.
  const sealedIn = [
    ...(z.chests || []).map(c => ['chest ' + c.id, c.x, c.z]),
    ...(z.elites || []).map(e => ['elite ' + e.name, e.cx, e.cz]),
    ...(z.npcs || []).map(n => ['npc ' + n.name, n.x, n.z]),
  ].filter(([, x, zz]) => isSolid(terrainAt(z, x, zz)));
  ok('chests, elites and NPCs stand on reachable ground', sealedIn.length === 0,
      sealedIn.length ? sealedIn.map(r => r[0]).join(', ')
                      : `${z.chests.length} chests, ${z.elites.length} elites, ${z.npcs.length} npcs`);

  // A named landmark with nothing in it is a signpost, not a place.
  const barren = z.pois.filter(p => p.kind !== 'exit' && p.kind !== 'safe').filter(p => {
    const mobs = (z.spawns || []).filter(sp => Math.hypot(sp.cx - p.x, sp.cz - p.z) < p.r + 20)
                                 .reduce((a, sp) => a + sp.count, 0);
    return mobs === 0;
  });
  ok('every landmark has something in it', barren.length === 0,
      barren.length ? barren.map(p => p.key).join(', ') : `${z.pois.length - 5} landmarks populated`);
}

// --- reachability ----------------------------------------------------------
// A landmark walled off behind its own cliffs is the easiest bug to ship.
{
  const WALK = new Set(['.', 'f', 'F', 'w']);
  const at = (gx, gz) => (gz < 0 || gz >= T.h || gx < 0 || gx >= T.w) ? ' ' : T.rows[gz][gx];
  const cell = (x, zz) => [Math.floor((x - T.minX) / T.cell), Math.floor((zz - T.minZ) / T.cell)];
  const walkable = (gx, gz) => WALK.has(at(gx, gz));
  const nearestWalkable = (x, zz) => {
    let [gx, gz] = cell(x, zz);
    if (walkable(gx, gz)) return [gx, gz];
    for (let r = 1; r < 40; r++) for (let i = 0; i < 360; i += 10) {
      const a = i * Math.PI / 180;
      const nx = gx + Math.round(Math.cos(a) * r), nz = gz + Math.round(Math.sin(a) * r);
      if (walkable(nx, nz)) return [nx, nz];
    }
    return null;
  };
  const camp = z.pois.find(p => p.key === 'camp');
  const seed = nearestWalkable(camp.x, camp.z);
  const seen = new Set([seed.join(',')]); const stack = [seed];
  while (stack.length) {
    const [gx, gz] = stack.pop();
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = gx + dx, nz = gz + dz, k = nx + ',' + nz;
      if (seen.has(k) || !walkable(nx, nz)) continue;
      seen.add(k); stack.push([nx, nz]);
    }
  }
  // A landmark counts as reached if ANY walkable cell in its vicinity is in the
  // camp's component -- not merely the nearest one, which can be a pocket
  // sealed inside its own cliffs (Wolfsnag's centre is solid rock by design).
  //
  // The vicinity has to be generous, because a pin is not always on ground you
  // can stand on: Ravenwater's sits on an isolated scrap of marsh out in the
  // pool with its nearest connected shore 43 m away, and an exit's sits on the
  // map boundary itself. The generator's own anchor search reaches 90 m, so
  // anything tighter than that reports landmarks stranded that plainly are not.
  const reached = (p) => {
    const [gx0, gz0] = cell(p.x, p.z);
    const rc = Math.ceil(60 / T.cell);
    for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
      if (dx * dx + dz * dz > rc * rc) continue;
      if (seen.has((gx0 + dx) + ',' + (gz0 + dz))) return true;
    }
    return false;
  };
  const stranded = z.pois.filter(p => !reached(p));
  ok('every landmark reachable on foot from the camp', stranded.length === 0,
      stranded.length ? stranded.map(p => p.key).join(', ') : `${z.pois.length} landmarks`);
}

// --- manifest --------------------------------------------------------------
// Placement and the model manifest are separate lists, and the failure is
// silent: a piece placed but never downloaded is simply invisible.
{
  const used = new Set();
  for (const o of (z.scatter || [])) used.add(o.model || o.m);
  for (const o of (z.props || [])) used.add(o.m);
  for (const o of (z.decks || [])) used.add(o.m);
  for (const b of (z.structures || [])) for (const pc of b.pieces) used.add(pc.m);
  const listed = new Set(z.models.map(m => m.split('/').pop()));
  const missing = [...used].filter(m => m && !listed.has(m));
  ok('everything placed is in the model manifest', missing.length === 0,
      missing.length ? missing.join(', ') : `${used.size} models placed`);
}

console.log(`\n${failures ? failures + ' FAILED' : 'all invariants hold'}\n`);
process.exit(failures ? 1 : 0);
