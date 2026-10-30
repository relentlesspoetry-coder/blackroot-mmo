// Frozen linear collision implementation from commit af25892f97e4746de9c975f57c03c4bf1c5ad7e6.
// Only import paths changed; do not update when optimizing production collision.
// Blackroot — collision and walkability.
//
// This file exists because of a bug class, not tidiness. Every check that asked
// "can a player stand here?" in its own words -- a tool with its own 2.5 m grid,
// a builder with no body radius -- passed while the world was unwalkable. The
// runtime answer is `resolveCollision`: if it moves a probe, the probe was
// inside something. Tools import THIS, so a check and the game ask one question.

import { PLAYER } from '../../balance.js';
import {
  dist2, closestOnPolyline, pointInPoly, polyCentroid,
  riversOf, bridgesOf, pathsOf, terrainAt, rockSolidAt, T_OFF, T_DEEP,
  riverWaterHalf, RIVER_BANK,
} from '../../worldgen.js';

const PLAYER_RADIUS = PLAYER.radius;
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---------------------------------------------------------------------------
// Direction of the polyline segment nearest to (x,z).
function segDirAt(pts, x, z) {
  let best = { dx: 1, dz: 0 }, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    const cx = a.x + dx * t, cz = a.z + dz * t, d = Math.hypot(x - cx, z - cz);
    if (d < bd) { bd = d; best = { dx, dz }; }
  }
  return best;
}

// How far the flooded channel reaches beyond the river's nominal half-width.
// This was `const RIVER_BANK = 4` with a comment saying it must match the
// client -- a hand-kept copy of a constant shared/terrain.js already exports,
// in the one file whose own header says a check that asks the question in its
// own words passes while the world is wrong. Imported now, and the three
// places that spelled out `width / 2 + RIVER_BANK` call riverWaterHalf.
// Multi-storey walking: how tall a ledge you can step onto, and body height.
const STEP_UP = 0.7, PLAYER_TALL = 2.2;
// True if (x,z) is inside a placed primitive's rotated footprint; returns its
// walkable top there (ramps slope along their run), else null.
function primTopAt(o, x, z) {
  const s = o.s || 1, hw = (o.w || 1) * s / 2, hd = (o.d || 1) * s / 2;
  const c = Math.cos(o.yaw || 0), sn = Math.sin(o.yaw || 0), rx = x - o.x, rz = z - o.z;
  const lx = rx * c + rz * sn, lz = -rx * sn + rz * c;
  if (Math.abs(lx) > hw || Math.abs(lz) > hd) return null;
  const rise = (o.h || 1) * s;
  // Ramps and stairs both rise along their run; physically they are the same
  // smooth slope, so a stepped staircase walks up without snagging on treads.
  if (o.m === 'prim:ramp' || o.m === 'prim:stairs') { const t = Math.max(0, Math.min(1, (lz + hd) / (2 * hd))); return (o.y || 0) + rise * t; }
  return (o.y || 0) + rise;
}
// The walkable floor height under (x,z), reachable from fromY (ground = 0).
function floorHeightAt(zone, x, z, fromY) {
  let best = 0;
  for (const o of (zone._editObjects || [])) {
    if (typeof o.m !== 'string' || !o.m.startsWith('prim:')) continue;
    const top = primTopAt(o, x, z);
    if (top != null && top <= fromY + STEP_UP && top > best) best = top;
  }
  return best;
}
// Collision: keep an entity inside bounds, out of rocks, and out of the river
// (except at the bridge, where solid rails keep it on the deck).
// ---------------------------------------------------------------------------
// Is (x,z) somewhere a person can actually stand? Inside the world, out of the
// rock and out of any river. Used when loading a save written against an older
// version of the map.
function standableAt(zone, x, z) {
  const b = zone.bounds;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  if (zone.boundary && !pointInPoly(x, z, zone.boundary)) return false;
  for (const o of (zone.rocks || [])) if (dist2(x, z, o.x, o.z) < o.r * o.r) return false;
  if (zone.terrain) {
    const c = terrainAt(zone, x, z);
    if (c === T_OFF || c === T_DEEP) return false;
    if (rockSolidAt(zone, x, z)) return false;
  }
  for (const r of riversOf(zone)) {
    if (closestOnPolyline(x, z, r.points).dist < riverWaterHalf(r.width)) {
      // standing on a bridge deck is fine
      if (!bridgesOf(r).some(br => dist2(x, z, br.x, br.z) < 12 * 12)) return false;
    }
  }
  return true;
}

function resolveCollision(zone, ent, radius) {
  const b = zone.bounds;
  ent.x = clamp(ent.x, b.minX + radius, b.maxX - radius);
  ent.z = clamp(ent.z, b.minZ + radius, b.maxZ - radius);

  for (const o of (zone.rocks || [])) {
    const dx = ent.x - o.x, dz = ent.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + radius;
    if (d < min && d > 1e-4) { ent.x = o.x + (dx / d) * min; ent.z = o.z + (dz / d) * min; }
  }

  // Every river is solid (with a passable bridge deck). The fused world can hold
  // several, each with its own bridge frame cached on the river object.
  // What blocks is the rock the client DRAWS (worldgen.rockSolidAt), not the
  // traced cell: see the note on rockEdge there. Off-map and -- for anything
  // that cannot swim -- deep water are still cell tests, because both of those
  // are what the drawing says and neither is blurred into view. A player can
  // swim, so for them the lakes and channels are places to go, not walls.
  const hereC = zone.terrain ? terrainAt(zone, ent.x, ent.z) : T_OFF;
  const swims = !!ent.canSwim;
  const inStone = (x, z, c) => c === T_OFF || (c === T_DEEP && !swims) || rockSolidAt(zone, x, z);
  const blocked = zone.terrain ? inStone(ent.x, ent.z, hereC) : true;
  if (zone.terrain && blocked) {
    const step = zone.terrain.cell;
    let bx = null, bz = null, bd = Infinity;
    for (let r = step; r <= step * 8 && bx === null; r += step) {
      const n = Math.max(8, Math.round(2 * Math.PI * r / step));
      for (let i = 0; i < n; i++) {
        const a = 2 * Math.PI * i / n, nx = ent.x + Math.cos(a) * r, nz = ent.z + Math.sin(a) * r;
        if (inStone(nx, nz, terrainAt(zone, nx, nz))) continue;
        const d = (nx - ent.x) ** 2 + (nz - ent.z) ** 2;
        if (d < bd) { bd = d; bx = nx; bz = nz; }
      }
      if (bx !== null) break;
    }
    if (bx !== null) { ent.x = bx; ent.z = bz; }
  }
  const rivers = riversOf(zone);
  const paths = pathsOf(zone);
  for (const r of rivers) {
    // Bridge frames (path-aligned decks), computed once each: matches how the
    // client builds and orients every arched bridge on this water.
    if (!r._bridges) {
      r._bridges = bridgesOf(r).map((bridge) => {
        const nearPath = paths.slice().sort((a, b) => closestOnPolyline(bridge.x, bridge.z, a).dist - closestOnPolyline(bridge.x, bridge.z, b).dist)[0] || r.points;
        const pd = segDirAt(nearPath, bridge.x, bridge.z);
        const rd = segDirAt(r.points, bridge.x, bridge.z);
        const pl = Math.hypot(pd.dx, pd.dz) || 1, rl = Math.hypot(rd.dx, rd.dz) || 1;
        const sinA = Math.min(1, Math.abs((pd.dx / pl) * (rd.dz / rl) - (pd.dz / pl) * (rd.dx / rl)));
        const L = (r.width + 2 * RIVER_BANK) / Math.max(0.5, sinA) + 9;
        return { cx: bridge.x, cz: bridge.z, dx: pd.dx / pl, dz: pd.dz / pl, L, deckW: 6, railHalf: 2.5 };
      });
    }
    let onDeck = false;
    for (const B of r._bridges) {
      if (onDeck) break;
      const ex = ent.x - B.cx, ez = ent.z - B.cz;
      const along = ex * B.dx + ez * B.dz;   // along the deck (path direction)
      const across = ex * -B.dz + ez * B.dx;  // across the deck (rail axis)
      // Solid rails run the FULL length of the deck (including the land ramps at
      // both ends), so clamp whenever within the deck footprint — not only over
      // the water.
      if (Math.abs(along) <= B.L / 2 && Math.abs(across) <= B.deckW / 2 + 0.6) {
        onDeck = true;
        const lim = B.railHalf;
        if (Math.abs(across) > lim) {
          const na = Math.sign(across) * lim;
          ent.x = B.cx + along * B.dx + na * -B.dz;
          ent.z = B.cz + along * B.dz + na * B.dx;
        }
      }
    }
    if (!onDeck && swims) continue;   // a swimmer just gets in
    if (!onDeck) { // not on the deck — keep out of the water
      const c = closestOnPolyline(ent.x, ent.z, r.points);
      const half = riverWaterHalf(r.width) + radius;
      if (c.dist < half) {
        let dx = ent.x - c.x, dz = ent.z - c.z, d = Math.hypot(dx, dz);
        if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        ent.x = c.x + (dx / d) * half; ent.z = c.z + (dz / d) * half;
      }
    }
  }


  // Solid cave dressing (columns, big stalagmites, ore veins).
  for (const o of (zone._scatter || [])) {
    if (!o.c) continue;
    const dx = ent.x - o.x, dz = ent.z - o.z, d = Math.hypot(dx, dz), min = o.c * o.s + radius;
    if (d < min && d > 1e-4) { ent.x = o.x + (dx / d) * min; ent.z = o.z + (dz / d) * min; }
  }
  // Editor-placed objects: builder primitives are solid oriented boxes; other
  // props use a simple collision radius.
  for (const o of (zone._editObjects || [])) {
    if (!o.c) continue;
    const isPrim = typeof o.m === 'string' && o.m.startsWith('prim:');
    if (o.m === 'prim:ramp' || o.m === 'prim:stairs') continue; // a walkable slope, never a wall
    // Height gate: only block if the piece spans the entity's body — you step
    // onto anything within a step, and walk under anything above your head.
    const ey = ent.y || 0, base = o.y || 0, top = base + (isPrim ? (o.h || 1) * (o.s || 1) : 3);
    if (top <= ey + STEP_UP || base >= ey + PLAYER_TALL) continue;
    if (isPrim) {
      const s = o.s || 1, hw = (o.w || 1) * s / 2 + radius, hd = (o.d || 1) * s / 2 + radius;
      const c = Math.cos(o.yaw || 0), sn = Math.sin(o.yaw || 0);
      const rx = ent.x - o.x, rz = ent.z - o.z;
      let lx = rx * c + rz * sn, lz = -rx * sn + rz * c; // world -> box-local
      if (Math.abs(lx) < hw && Math.abs(lz) < hd) {
        if (hw - Math.abs(lx) < hd - Math.abs(lz)) lx = Math.sign(lx || 1) * hw; else lz = Math.sign(lz || 1) * hd;
        ent.x = o.x + lx * c - lz * sn; ent.z = o.z + lx * sn + lz * c; // box-local -> world
      }
    } else {
      const dx = ent.x - o.x, dz = ent.z - o.z, d = Math.hypot(dx, dz), min = o.c * (o.s || 1) + radius;
      if (d < min && d > 1e-4) { ent.x = o.x + (dx / d) * min; ent.z = o.z + (dz / d) * min; }
    }
  }

  // Trees are solid at their trunk. Which species stands at a spot is the
  // client's own hash of the position (speciesFor), so the trunk radius here
  // matches the trunk drawn there, scaled by the tree's size.
  for (const t of (zone._trees || [])) {
    const dx = ent.x - t.x, dz = ent.z - t.z, d = Math.hypot(dx, dz), min = treeTrunkRadius(t) + radius;
    if (d < min && d > 1e-4) { ent.x = t.x + (dx / d) * min; ent.z = t.z + (dz / d) * min; }
  }

  // Buildings are walls, not bollards. A structure the size of the Fallen Chapel
  // cannot be a collision CIRCLE -- a radius that covers a 14 x 20 m footprint is
  // a twelve-metre no-go blob you bump into from across the nave -- so a
  // structure carries a list of wall segments instead. A wall with a `gap` has a
  // doorway of that width at its middle, which is what makes a ruin something
  // you walk into rather than around.
  for (const w of (zone._walls || [])) {
    const dx = w.x2 - w.x1, dz = w.z2 - w.z1, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((ent.x - w.x1) * dx + (ent.z - w.z1) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    if (w.gap) {                                  // a doorway at the middle of the run
      const len = Math.sqrt(L2) || 1;
      if (Math.abs(t - 0.5) * len < w.gap / 2) continue;
    }
    const cx = w.x1 + dx * t, cz = w.z1 + dz * t;
    let ox = ent.x - cx, oz = ent.z - cz, d = Math.hypot(ox, oz);
    const min = (w.r || 0.4) + radius;
    if (d < min) { if (d < 1e-4) { ox = 1; oz = 0; d = 1; } ent.x = cx + (ox / d) * min; ent.z = cz + (oz / d) * min; }
  }

  // Region-aware containment. Underground (in a cave) or in the descent tunnel,
  // the entity is bounded by that region; otherwise by the outdoor boundary. The
  // surface path is exactly as before, so above-ground play is unchanged.
  if (zone.boundary) {
    const inset = zone.boundaryInset || 0;
    const inside = pointInPoly(ent.x, ent.z, zone.boundary);
    if (!inside || inset > 0) {
      const closed = zone.boundary.concat([zone.boundary[0]]);
      const c = closestOnPolyline(ent.x, ent.z, closed);
      if (!inside || c.dist < inset) {
        if (!zone._cen) zone._cen = polyCentroid(zone.boundary);
        let dx = zone._cen.x - c.x, dz = zone._cen.z - c.z, d = Math.hypot(dx, dz) || 1;
        const push = Math.max(inset, radius);
        ent.x = c.x + (dx / d) * push; ent.z = c.z + (dz / d) * push;
      }
    }
  }
}

// Mirrors the client's TREE_SPECIES / speciesFor so collision knows the trunk.
// Radii are the trunks measured at 2.5 m up a 13 m tree (roots flare wider
// but are low enough to walk over).
const TREE_SPECIES = ['Ancient_Forest_Tree', 'Broad_Crown_Oak', 'Tall_Leafy_Birch', 'Twisted_Darkwood', 'Weeping_Willow'];
const TREE_TRUNK_R = { Ancient_Forest_Tree: 1.9, Broad_Crown_Oak: 1.8, Tall_Leafy_Birch: 0.8, Twisted_Darkwood: 1.6, Weeping_Willow: 1.5 };
function treeTrunkRadius(t) {
  const h = Math.abs(Math.floor(t.x * 73856093) ^ Math.floor(t.z * 19349663));
  return (TREE_TRUNK_R[TREE_SPECIES[h % TREE_SPECIES.length]] || 1.0) * (t.s || 1);
}
// `canSwim` matters: a monster is walled in by the lake, a player is not (every
// player has canSwim set every tick), so asking "can a PLAYER get here" with a
// walker's probe reports the middle of Ravenwater as solid ground you cannot
// reach. The default stays a walker, which is what the monster nav wants.
function navBlocked(zone, x, z, radius = PLAYER_RADIUS * 0.9, canSwim = false) {
  const probe = { x, z, y: 0, canSwim };
  resolveCollision(zone, probe, radius);
  return Math.hypot(probe.x - x, probe.z - z) > 0.05;
}

// Straight-line walkability between two points (live collision, so a shut gate blocks).
function lineClear(zone, ax, az, bx, bz, radius = PLAYER_RADIUS * 0.9) {
  const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 0.5));
  for (let i = 1; i <= n; i++) { const t = i / n; if (navBlocked(zone, ax + (bx - ax) * t, az + (bz - az) * t, radius)) return false; }
  return true;
}

export { RIVER_BANK, STEP_UP, PLAYER_TALL, primTopAt, floorHeightAt, standableAt,
         resolveCollision, treeTrunkRadius, navBlocked, lineClear, segDirAt };
