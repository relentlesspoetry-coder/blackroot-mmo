// Blackroot — a 3D browser MMO (vertical slice)
// Authoritative game server. All movement, combat, AI and progression are
// simulated here; the client only sends intents. Security lesson from the old
// codebase applied correctly: never trust the client.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { darkwoods } from './zones/darkwoods.js';
import { hiddencave } from './zones/hiddencave.js';
import { killingfields } from './zones/killingfields.js';
import {
  PLAYER, ELITE, MONSTER, MONSTER_TEMPLATES,
  maxHpForLevel, xpForLevel, rollPlayerDamage, scaledMonster, rollLoot, mitigate, REGEN,
  TICK, DEFAULT_ATTACK_SPEED, STYLES, COMBAT_SKILLS, hpForHitpoints, combatLevel,
  maxHit, rollSwing, rollMonsterSwing, MEDITATION, meditationHealRate,
} from './balance.js';
import { ITEMS, SLOTS, SLOT_INFO, DOLL, itemDef, slotOf, valueOf, equipStats, slotsFor, emptySlots } from './items.js';
import {
  dist2, closestOnPolyline, pointInPoly, polyCentroid, generateTrees, generateScatter, generateHanging,
  caveOutline,
} from './worldgen.js';
import {
  MINING, ORES, PICKAXES, oreFromModel, bestPickaxe, swingChance, swingTime,
  miningLevelFromXp, canMine, veinYield,
} from './mining.js';
import {
  FISHING, FISH, RODS, bestRod, fishingLevelFromXp, catchChance, castTime,
} from './fishing.js';
import {
  COOKING, COOKABLES, BURNT, cookingLevelFromXp, burnChance, cookableInInventory,
} from './cooking.js';

function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
import {
  QUESTS, questPayload, questProgress, canStart, recordKill, recordReach,
  consumeQuestItems,
} from './quests.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const PORT = process.env.PORT || 8080;

const ZONES = { darkwoods, hiddencave, killingfields };
const START_ZONE = 'darkwoods';
function zoneOf(ent) { return ZONES[ent.zoneId]; }

// Uniformly scale a zone's layout by k (linear). Everything the server and the
// client read from the zone — bounds, boundary, POIs, paths, spawns, radii — is
// multiplied in place, and content counts grow with area so density holds. Runs
// once at startup before populate() so trees/scatter/monsters generate scaled.
function scaleZone(zone, k) {
  const A = k * k;
  const sp = (o) => { if (!o) return; if (o.x != null) o.x *= k; if (o.z != null) o.z *= k; if (o.r != null) o.r *= k; };
  const b = zone.bounds; if (b) { b.minX *= k; b.maxX *= k; b.minZ *= k; b.maxZ *= k; }
  (zone.boundary || []).forEach(sp);
  if (zone.spawn) { zone.spawn.x *= k; zone.spawn.z *= k; }
  // Scale a portal's location in THIS zone, but NOT its `spawn` (a destination
  // in another, unscaled zone).
  (zone.portals || []).forEach(sp);
  (zone.pois || []).forEach(sp);
  (zone.npcs || []).forEach(sp);
  (zone.path || []).forEach(sp);
  if (zone.river) { zone.river.width *= k; (zone.river.points || []).forEach(sp); if (zone.river.bridge) { zone.river.bridge.x *= k; zone.river.bridge.z *= k; zone.river.bridge.halfWidth *= k; } }
  (zone.rocks || []).forEach(sp);
  (zone.pools || []).forEach(sp);
  (zone.chests || []).forEach(sp);
  (zone.fishingSpots || []).forEach(sp);
  (zone.campfires || []).forEach(sp);
  if (zone.safeSpawnRadius) zone.safeSpawnRadius *= k;
  if (zone.boundaryInset) zone.boundaryInset *= k;
  // Spread mobs out: regions grow with the zone (r*k) but counts grow only
  // linearly, so a bigger zone is LESS densely packed, not more.
  (zone.spawns || []).forEach(s => { s.cx *= k; s.cz *= k; s.r *= k; s.count = Math.max(1, Math.round(s.count * k)); });
  (zone.elites || []).forEach(e => { e.cx *= k; e.cz *= k; });
  (zone.scatter || []).forEach(s => { if (s.count) s.count = Math.max(1, Math.round(s.count * A)); });
  // Farm layout: scale positions only (prop SIZES stay native meter-scale).
  if (zone.farm) {
    (zone.farm.fences || []).forEach(f => { f.x1 *= k; f.z1 *= k; f.x2 *= k; f.z2 *= k; });
    if (zone.farm.gate) { const g = zone.farm.gate; g.x *= k; g.z *= k; if (g.seg) { g.seg.x1 *= k; g.seg.z1 *= k; g.seg.x2 *= k; g.seg.z2 *= k; } }
    (zone.farm.props || []).forEach(sp);
    // Keep-out box so the forest/scatter don't grow through the farmyard.
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (const f of (zone.farm.fences || [])) { mnx = Math.min(mnx, f.x1, f.x2); mxx = Math.max(mxx, f.x1, f.x2); mnz = Math.min(mnz, f.z1, f.z2); mxz = Math.max(mxz, f.z1, f.z2); }
    zone._farmBox = { minX: mnx, maxX: mxx, minZ: mnz, maxZ: mxz };
  }
  if (zone.treeCount != null) zone.treeCount = Math.round(zone.treeCount * A);
  zone._cen = null; // recompute the cached centroid lazily
}
scaleZone(darkwoods, 1.7); // "double the size" — a much roomier Dark Woods

// ---------------------------------------------------------------------------
// Seamless world: fuse the outdoor zones into ONE continuous map, so there are
// no loading screens or transitions between them — you see across the border
// and walk straight through. Each source zone still generates its own trees and
// scatter in its own space first (so worldgen keeps avoiding that zone's single
// path and river), then a neighbour is offset into place and everything is
// concatenated into one zone. The enclosed Hidden Cave stays a separate area for
// now (a dark interior does not belong in the open-sky world) and is reached
// through its cave-mouth portal.
// ---------------------------------------------------------------------------
function offsetZone(zone, dx, dz) {
  const sp = (o) => { if (!o) return; if (o.x != null) o.x += dx; if (o.z != null) o.z += dz; };
  const b = zone.bounds; if (b) { b.minX += dx; b.maxX += dx; b.minZ += dz; b.maxZ += dz; }
  (zone.boundary || []).forEach(sp);
  if (zone.spawn) { zone.spawn.x += dx; zone.spawn.z += dz; }
  (zone.pois || []).forEach(sp);
  (zone.npcs || []).forEach(sp);
  (zone.path || []).forEach(sp);
  if (zone.river) { (zone.river.points || []).forEach(sp); if (zone.river.bridge) { zone.river.bridge.x += dx; zone.river.bridge.z += dz; } }
  (zone.rocks || []).forEach(sp);
  (zone.pools || []).forEach(sp);
  (zone.chests || []).forEach(sp);
  (zone.fishingSpots || []).forEach(sp);
  (zone.campfires || []).forEach(sp);
  (zone.hazards || []).forEach(sp);
  (zone.spawns || []).forEach(s => { s.cx += dx; s.cz += dz; });
  (zone.elites || []).forEach(e => { e.cx += dx; e.cz += dz; });
  zone._cen = null;
}

function buildSeamlessWorld() {
  // Place the Killing Fields directly south of the Dark Woods so their edges meet.
  offsetZone(killingfields, 0, 340);
  // Generate each zone's forest/scatter in its own coordinate space up front, so
  // worldgen still avoids that zone's single path & river before we fuse them.
  for (const z of [darkwoods, killingfields]) {
    z._trees = generateTrees(z);
    z._scatter = generateScatter(z);
  }
  const w = darkwoods, kf = killingfields;
  const cat = (k) => { w[k] = (w[k] || []).concat(kf[k] || []); };
  ['pois', 'npcs', 'rocks', 'pools', 'chests', 'hazards', 'spawns', 'elites', '_trees', '_scatter'].forEach(cat);
  // Multiple paths/rivers now — keep each so the client can draw them all.
  w.paths = [w.path, kf.path].filter(Boolean);
  w.rivers = [w.river, kf.river].filter(Boolean);
  // Union bounds + one rectangular boundary wall around the whole world (no
  // interior wall at the seam, so you walk straight from one zone to the next).
  const b = w.bounds, kb = kf.bounds;
  b.minX = Math.min(b.minX, kb.minX); b.maxX = Math.max(b.maxX, kb.maxX);
  b.minZ = Math.min(b.minZ, kb.minZ); b.maxZ = Math.max(b.maxZ, kb.maxZ);
  const ins = 3;
  w.boundary = [
    { x: b.minX + ins, z: b.minZ + ins }, { x: b.maxX - ins, z: b.minZ + ins },
    { x: b.maxX - ins, z: b.maxZ - ins }, { x: b.minX + ins, z: b.maxZ - ins },
  ];
  w.models = [...new Set([...(w.models || []), ...(kf.models || [])])];
  w.treeCount = (w.treeCount || 0) + (kf.treeCount || 0);
  // The world is far bigger than either zone was, and now spans dense forest AND
  // open fields — push the fog back so the open south isn't a grey wall while the
  // forest still feels close. A blend of the two zones' original depths.
  if (w.env) { w.env.fogNear = 55; w.env.fogFar = 340; }
  w._cen = null;
  // Killing Fields is now part of the Dark Woods world; drop it as a separate
  // zone and remove the portal that used to jump between the two.
  delete ZONES.killingfields;
  w.portals = (w.portals || []).filter(p => p.to !== 'killingfields');
}
buildSeamlessWorld();

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const TICK_HZ = 20;
const SNAPSHOT_HZ = 12;
const DT = 1 / TICK_HZ;
const PLAYER_SPEED = PLAYER.speed;
const PLAYER_RADIUS = PLAYER.radius;
const ATTACK_RANGE = PLAYER.attackRange;
const ATTACK_COOLDOWN = PLAYER.attackCooldown;
const RESPAWN_TIME = PLAYER.respawnTime;
const QUEST_REACH_RADIUS = 9;   // how close you must stand to satisfy a 'reach'
const NPC_TALK_RADIUS = 10;     // how close you must stand to accept/turn in

function inSafeZone(zone, x, z) {
  for (const p of zone.pois) {
    if (p.kind === 'safe' && p.r && dist2(x, z, p.x, p.z) < p.r * p.r) return true;
  }
  return false;
}

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

// How far the flooded channel reaches beyond the river's nominal half-width
// (must match RIVER_BANK on the client, which floods the whole carved channel).
const RIVER_BANK = 4;
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
  const rivers = zone.rivers || (zone.river ? [zone.river] : []);
  const paths = zone.paths || (zone.path ? [zone.path] : []);
  for (const r of rivers) {
    // Bridge frame (path-aligned deck), computed once: matches how the client
    // builds and orients the arched bridge.
    if (r.bridge && !r._bridge) {
      const nearPath = paths.slice().sort((a, b) => closestOnPolyline(r.bridge.x, r.bridge.z, a).dist - closestOnPolyline(r.bridge.x, r.bridge.z, b).dist)[0] || r.points;
      const pd = segDirAt(nearPath, r.bridge.x, r.bridge.z);
      const rd = segDirAt(r.points, r.bridge.x, r.bridge.z);
      const pl = Math.hypot(pd.dx, pd.dz) || 1, rl = Math.hypot(rd.dx, rd.dz) || 1;
      const sinA = Math.min(1, Math.abs((pd.dx / pl) * (rd.dz / rl) - (pd.dz / pl) * (rd.dx / rl)));
      const L = (r.width + 2 * RIVER_BANK) / Math.max(0.5, sinA) + 9;
      r._bridge = { cx: r.bridge.x, cz: r.bridge.z, dx: pd.dx / pl, dz: pd.dz / pl, L, deckW: 6, railHalf: 2.5 };
    }
    const B = r._bridge;
    let onDeck = false;
    if (B) {
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
    if (!onDeck) { // not on the deck — keep out of the water
      const c = closestOnPolyline(ent.x, ent.z, r.points);
      const half = r.width / 2 + RIVER_BANK + radius;
      if (c.dist < half) {
        let dx = ent.x - c.x, dz = ent.z - c.z, d = Math.hypot(dx, dz);
        if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
        ent.x = c.x + (dx / d) * half; ent.z = c.z + (dz / d) * half;
      }
    }
  }

  // Farmstead fences are solid walls (the gate gap is left open so the trail
  // leads out); this keeps the livestock penned and the player inside until the
  // gate.
  for (const f of (zone._fenceSegs || [])) {
    const dx = f.x2 - f.x1, dz = f.z2 - f.z1, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((ent.x - f.x1) * dx + (ent.z - f.z1) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = f.x1 + dx * t, cz = f.z1 + dz * t;
    let ox = ent.x - cx, oz = ent.z - cz, d = Math.hypot(ox, oz);
    const min = 0.5 + radius;
    if (d < min) { if (d < 1e-4) { ox = 1; oz = 0; d = 1; } ent.x = cx + (ox / d) * min; ent.z = cz + (oz / d) * min; }
  }
  // The gate leaf blocks its gap while shut (t small); once it has swung open
  // the gap is passable.
  const G = zone._gate;
  if (G && G.seg && G.t < 0.55) {
    const f = G.seg, dx = f.x2 - f.x1, dz = f.z2 - f.z1, L2 = dx * dx + dz * dz;
    let t = L2 > 0 ? ((ent.x - f.x1) * dx + (ent.z - f.z1) * dz) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = f.x1 + dx * t, cz = f.z1 + dz * t;
    let ox = ent.x - cx, oz = ent.z - cz, d = Math.hypot(ox, oz);
    const min = 0.5 + radius;
    if (d < min) { if (d < 1e-4) { ox = 1; oz = 0; d = 1; } ent.x = cx + (ox / d) * min; ent.z = cz + (oz / d) * min; }
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

  // Trees are solid.
  for (const t of (zone._trees || [])) {
    const dx = ent.x - t.x, dz = ent.z - t.z, d = Math.hypot(dx, dz), min = 0.8 + radius;
    if (d < min && d > 1e-4) { ent.x = t.x + (dx / d) * min; ent.z = t.z + (dz / d) * min; }
  }

  // Organic boundary: keep the entity inside the zone's polygon shape, and at
  // least `boundaryInset` from the edge so it stops at the mountain range that
  // rings the border rather than walking into the rock.
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

// ---------------------------------------------------------------------------
// Entity state
// ---------------------------------------------------------------------------
let nextId = 1;
const players = new Map();
const monsters = new Map();

function spawnInRegion(zone, region, opts = {}) {
  // Aggressive mobs are kept out of the ring around the zone's arrival point,
  // so a fresh character is never in combat before they can look around.
  const keepOut = opts.passive ? 0 : (zone.safeSpawnRadius || 0);
  for (let i = 0; i < 40; i++) {
    const a = rand(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * region.r;
    const x = region.cx + Math.cos(a) * rr, z = region.cz + Math.sin(a) * rr;
    const b = zone.bounds;
    if (x < b.minX + 3 || x > b.maxX - 3 || z < b.minZ + 3 || z > b.maxZ - 3) continue;
    if (zone.boundary && !pointInPoly(x, z, zone.boundary)) continue;
    if (inSafeZone(zone, x, z)) continue;
    if (keepOut && dist2(x, z, zone.spawn.x, zone.spawn.z) < keepOut * keepOut) continue;
    if ((zone.rocks || []).some(o => dist2(x, z, o.x, o.z) < (o.r + 2) ** 2)) continue;
    if (zone.river && closestOnPolyline(x, z, zone.river.points).dist < zone.river.width / 2 + RIVER_BANK + 1) continue;
    return { x, z };
  }
  // Fallback: the region centre, pushed clear of the keep-out ring if needed.
  let fx = region.cx, fz = region.cz;
  if (keepOut) {
    const dx = fx - zone.spawn.x, dz = fz - zone.spawn.z, d = Math.hypot(dx, dz);
    if (d < keepOut) {
      const ux = d > 1e-4 ? dx / d : 1, uz = d > 1e-4 ? dz / d : 0;
      fx = zone.spawn.x + ux * keepOut; fz = zone.spawn.z + uz * keepOut;
    }
  }
  return { x: fx, z: fz };
}

function makeMonster(spec) {
  // spec: {zoneId, type, level, region:{cx,cz,r}, elite?, name?}
  const zone = ZONES[spec.zoneId];
  const stats = scaledMonster(spec.type, spec.level);
  const passive = !!MONSTER_TEMPLATES[spec.type].passive;
  const pos = spawnInRegion(zone, spec.region, { passive });
  const id = nextId++;
  const m = {
    id, kind: 'monster', zoneId: spec.zoneId, type: spec.type,
    name: spec.name || MONSTER_TEMPLATES[spec.type].name,
    elite: !!spec.elite, level: spec.level,
    x: pos.x, z: pos.z, home: { x: pos.x, z: pos.z }, yaw: rand(0, Math.PI * 2),
    hp: stats.hp, maxHp: stats.hp, dmg: stats.dmg, speed: stats.speed,
    aggro: stats.aggro, xp: stats.xp, passive: !!MONSTER_TEMPLATES[spec.type].passive,
    // OSRS combat stats (accuracy rolls + max hit).
    atkLevel: stats.atkLevel, defLevel: stats.defLevel, atkBonus: stats.atkBonus,
    defBonus: stats.defBonus, maxHit: stats.maxHit, attackSpeed: stats.attackSpeed,
    respawn: spec.respawn != null ? spec.respawn : Math.round((MONSTER_TEMPLATES[spec.type].respawn || RESPAWN_TIME) * (zone.respawnMult || 1)),
    alive: true, state: 'idle', targetId: null, atkTimer: 0,
    wanderTimer: rand(1, 4), wanderDir: { x: 0, z: 0 }, respawnTimer: 0,
    editSpawnId: spec.editSpawnId || null, // links back to an editor-placed spawn region
    spec,
  };
  monsters.set(id, m);
  return m;
}

function populate() {
  for (const zoneId of Object.keys(ZONES)) {
    const zone = ZONES[zoneId];
    for (const s of (zone.spawns || [])) {
      for (let i = 0; i < s.count; i++) {
        makeMonster({ zoneId, type: s.type, level: s.level, region: { cx: s.cx, cz: s.cz, r: s.r } });
      }
    }
    for (const e of (zone.elites || [])) populateElite(zoneId, e);
    // A cave authored as rooms and tunnels gets its boundary traced from them,
    // so collision, walls and placement all work off one polygon as before.
    if (zone.cavern && !zone.boundary) {
      zone.boundary = caveOutline(zone.cavern, zone.bounds);
    }
    // The seamless world pre-generates these (per source zone) before the merge.
    zone._trees = zone._trees || generateTrees(zone);
    zone._scatter = zone._scatter || generateScatter(zone);
    buildFarm(zone);
    loadOverrides(zone); // player-built objects from the world editor
    zone._hanging = generateHanging(zone);
    // Any scattered ore vein becomes a minable node, addressed by its index.
    zone._veins = new Map();
    for (const o of zone._scatter) {
      const ore = oreFromModel(o.m);
      // `remaining` is how many ores are left in this vein before it works out.
      if (ore) zone._veins.set(o.i, { id: o.i, ore, x: o.x, z: o.z, depleted: 0, remaining: veinYield(ore) });
    }
  }
}

// Tile the farmstead: turn each fence segment into a run of Farm_Fence panels
// (appended to the render scatter) plus a wall-collision segment, drop the gate,
// and place the props. Panels are native meter-scale; the zone scale only moved
// the endpoints, so we tile the native panel width across the scaled length.
const FENCE_PANEL = 2.0; // Farm_Fence native width (local +X)
function buildFarm(zone) {
  const F = zone.farm; if (!F) return;
  const scat = zone._scatter;
  zone._fenceSegs = [];
  for (const seg of (F.fences || [])) {
    const dx = seg.x2 - seg.x1, dz = seg.z2 - seg.z1, len = Math.hypot(dx, dz) || 1;
    const n = Math.max(1, Math.round(len / FENCE_PANEL)), spacing = len / n;
    const ux = dx / len, uz = dz / len, yaw = Math.atan2(-uz, ux);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * spacing;
      scat.push({ i: scat.length, m: 'Farm_Fence', x: +(seg.x1 + ux * t).toFixed(2), z: +(seg.z1 + uz * t).toFixed(2), s: +(spacing / FENCE_PANEL).toFixed(3), r: +yaw.toFixed(3), c: 0 });
    }
    zone._fenceSegs.push({ x1: seg.x1, z1: seg.z1, x2: seg.x2, z2: seg.z2 });
  }
  // The gate is rendered as a standalone, animated model on the client (it
  // swings), so it is NOT baked into the instanced scatter. The server owns its
  // open/shut state and toggles the gap collision with it.
  if (F.gate) zone._gate = { cx: F.gate.x, cz: F.gate.z, seg: F.gate.seg || null, t: 0, target: 0, dir: 1 };
  for (const p of (F.props || [])) scat.push({ i: scat.length, m: p.m, x: p.x, z: p.z, s: p.s || 1, r: p.yaw || 0, c: p.c || 0 });
}

// The gate only opens/shuts when a player clicks it (see toggleGate); here we
// just ease the leaf toward its target each tick.
const GATE_REACH = 3.2; // how close a player walks before the click takes effect
function toggleGate(g, p) {
  g.target = g.target > 0.5 ? 0 : 1;
  // Open AWAY from the player's side, so it swings both ways (whoever operates it
  // pushes it open in front of them). A player north of the gate swings it south
  // and vice-versa.
  if (g.target > 0.5) g.dir = (p.z < g.cz) ? -1 : 1;
}
function stepGates() {
  for (const zoneId of Object.keys(ZONES)) {
    const g = ZONES[zoneId]._gate; if (!g) continue;
    g.t += (g.target - g.t) * Math.min(1, DT * 4); // ~0.25s swing
    if (Math.abs(g.t - g.target) < 0.01) g.t = g.target;
  }
}

// ---------------------------------------------------------------------------
// World editor (Edit Mode). Player-placed objects live in a per-zone overrides
// file and merge into the live world. Edits are authoritative and gated by a key
// (?edit=<key> on the client). Rendered as individual meshes client-side so they
// can be moved/deleted one at a time.
// ---------------------------------------------------------------------------
const EDIT_KEY = process.env.BLACKROOT_EDIT_KEY || 'letmebuild';
let editSeq = 1;
function overridesPath(zone) { return path.join(__dirname, 'zones', zone.id + '.overrides.json'); }
function loadOverrides(zone) {
  zone._editObjects = []; zone._editSpawns = [];
  try {
    const data = JSON.parse(fs.readFileSync(overridesPath(zone), 'utf8'));
    if (Array.isArray(data.objects)) zone._editObjects = data.objects;
    if (Array.isArray(data.spawns)) zone._editSpawns = data.spawns;
    for (const o of [...zone._editObjects, ...zone._editSpawns]) { const n = parseInt(String(o.id).replace(/\D/g, ''), 10); if (n >= editSeq) editSeq = n + 1; }
  } catch { /* no overrides yet */ }
  for (const sp of zone._editSpawns) spawnEditorRegion(zone, sp); // populate its monsters
}
function saveOverrides(zone) {
  try { fs.writeFileSync(overridesPath(zone), JSON.stringify({ objects: zone._editObjects, spawns: zone._editSpawns }, null, 2)); }
  catch (e) { console.error('saveOverrides failed:', e.message); }
}
// Spawn the monsters for one editor spawn region.
function spawnEditorRegion(zone, sp) {
  if (!MONSTER_TEMPLATES[sp.type]) return;
  for (let i = 0; i < (sp.count || 1); i++) {
    makeMonster({ zoneId: zone.id, type: sp.type, level: sp.level || 1,
      region: { cx: sp.cx, cz: sp.cz, r: sp.r || 6 }, respawn: sp.respawn, editSpawnId: sp.id });
  }
}
// Remove all monsters that belong to an editor spawn region.
function despawnEditorRegion(id) {
  for (const [mid, m] of monsters) if (m.editSpawnId === id) monsters.delete(mid);
}
// Mob types offered in the spawn palette.
const MOB_TYPES = Object.keys(MONSTER_TEMPLATES);

// ---- Loot overrides: per mob type, an independent-roll drop table edited in
// game. Global (a type drops the same everywhere), stored in loot.overrides.json.
let LOOT_OVERRIDES = {};
const lootOverridesPath = () => path.join(__dirname, 'loot.overrides.json');
(function loadLootOverrides() { try { LOOT_OVERRIDES = JSON.parse(fs.readFileSync(lootOverridesPath(), 'utf8')) || {}; } catch { LOOT_OVERRIDES = {}; } })();
function saveLootOverrides() { try { fs.writeFileSync(lootOverridesPath(), JSON.stringify(LOOT_OVERRIDES, null, 2)); } catch (e) { console.error('saveLootOverrides:', e.message); } }
const LOOT_ITEMS = ['Coins', ...Object.keys(ITEMS)];
const lootItemOk = (name) => name === 'Coins' || !!ITEMS[name];
// A template's loot, expressed in the editor's independent-roll format
// ({item, min, max, chance=1-in-N}). Weighted tables convert approximately.
function templateLootAsEditor(type) {
  const t = MONSTER_TEMPLATES[type]; if (!t) return [];
  if (t.droptable) return t.droptable.map(e => ({ item: e.item, min: e.min || 1, max: e.max || 1, chance: e.always ? 1 : Math.max(1, Math.round(e.chance || 1)) }));
  if (t.loot) {
    const rolls = t.rolls || 1; let W = 0; for (const e of t.loot) W += e.w;
    const out = [];
    for (const e of t.loot) { if (e.item == null) continue; const p = 1 - Math.pow(1 - e.w / W, rolls); out.push({ item: e.item, min: e.min || 1, max: e.max || 1, chance: Math.max(1, Math.round(1 / Math.max(1e-4, p))) }); }
    return out;
  }
  return [];
}
function effectiveLoot(type) { return LOOT_OVERRIDES[type] || templateLootAsEditor(type); }
function allLootTables() { const o = {}; for (const t of MOB_TYPES) o[t] = effectiveLoot(t); return o; }
// Roll loot, honouring an override table (independent rolls) when present.
function rollMobLoot(type) {
  const ov = LOOT_OVERRIDES[type];
  if (!ov) return rollLoot(type);
  const drops = [];
  for (const e of ov) {
    if (!e.item) continue;
    if (Math.random() < 1 / Math.max(1, e.chance || 1)) {
      const min = e.min || 1, max = Math.max(min, e.max || min);
      drops.push({ item: e.item, qty: min + Math.floor(Math.random() * (max - min + 1)) });
    }
  }
  return drops;
}
function broadcastZone(zoneId, obj) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) if (p.zoneId === zoneId && p.ws.readyState === p.ws.OPEN) p.ws.send(s);
}
// Every .glb under client/models, as model keys for the editor palette.
let MODEL_MANIFEST = [];
(function scanModels() {
  const base = path.join(CLIENT_DIR, 'models'), out = [];
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), prefix + e.name + '/');
      else if (e.name.endsWith('.glb')) out.push(prefix + e.name.replace(/\.glb$/, ''));
    }
  };
  try { walk(base, ''); } catch { /* no models dir */ }
  MODEL_MANIFEST = out.sort();
})();

function populateElite(zoneId, e) {
  const elite = makeMonster({
    zoneId, type: e.type, level: e.level, name: e.name, elite: true,
    drops: e.drops,
    region: { cx: e.cx, cz: e.cz, r: 3 },
  });
  // Elites are tankier and hit harder than a same-level normal. A zone entry
  // may override the multipliers when the base creature is unusually squishy
  // (the Broodmother would otherwise die faster than a Hill Ogre).
  const hpM = e.hpMult || ELITE.hp, dmgM = e.dmgMult || ELITE.dmg;
  elite.maxHp = Math.round(elite.maxHp * hpM); elite.hp = elite.maxHp;
  elite.dmg = [Math.round(elite.dmg[0] * dmgM), Math.round(elite.dmg[1] * dmgM)];
  elite.maxHit = Math.max(1, Math.round(elite.maxHit * dmgM)); // scale OSRS max hit too
  elite.atkBonus = Math.round(elite.atkBonus * 1.5); elite.defBonus = Math.round(elite.defBonus * 1.5);
  elite.xp = Math.round(elite.xp * ELITE.xp);
  elite.aggro = 10; // shorter leash; guards its circle
}
populate();

// ---------------------------------------------------------------------------
// Networking helpers
// ---------------------------------------------------------------------------
function send(ws, obj) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) if (p.ws.readyState === p.ws.OPEN) p.ws.send(s);
}
function systemChat(msg) { broadcast({ t: 'chat', from: 'System', msg, sys: true }); }

// ---------------------------------------------------------------------------
// Combat & progression
// ---------------------------------------------------------------------------
function grantXp(p, amount) {
  p.xp += amount;
  send(p.ws, { t: 'event', kind: 'xp', amount });
  while (p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    // HP is driven by the Hitpoints skill now, so leveling the adventure track
    // no longer overrides it.
    send(p.ws, { t: 'event', kind: 'levelup', level: p.level });
    systemChat(`${p.name} reached level ${p.level}!`);
  }
}

function killMonster(m, killer) {
  m.alive = false; m.state = 'dead';
  m.respawnTimer = m.elite ? Math.max(90, m.respawn * 2) : m.respawn;
  m.hp = 0;
  if (killer) {
    grantXp(killer, m.xp);
    notifyQuestProgress(killer, recordKill(killer, m));
  }

  // Roll the loot table and drop items on the ground where it fell.
  const drops = rollMobLoot(m.type);
  if (m.elite) {
    // A named encounter can name its own reward; otherwise it leaves a trophy.
    for (const item of (m.spec.drops || [`${m.name} Trophy`])) drops.push({ item, qty: 1 });
    drops.push({ item: 'Coins', qty: Math.floor(rand(200, 400)) });
  }
  // Everything a kill drops piles up on the exact spot where the mob fell.
  for (const d of drops) {
    dropItem(m.zoneId, m.x, m.z, d.item, d.qty, killer ? killer.id : null);
  }
  if (m.elite) systemChat(`${killer ? killer.name : 'Someone'} has slain ${m.name}!`);
}

// ---------------------------------------------------------------------------
// Ground items (loot you walk over and pick up)
// ---------------------------------------------------------------------------
const groundItems = new Map(); // id -> { id, zoneId, x, z, name, qty, owner, ttl }
const ITEM_TTL = 120; // seconds before it despawns

function dropItem(zoneId, x, z, name, qty, owner) {
  const id = nextId++;
  groundItems.set(id, { id, zoneId, x, z, name, qty: qty || 1, owner, ttl: ITEM_TTL });
  return id;
}
function pickupItem(p, itemId) {
  const it = groundItems.get(itemId);
  if (!it || it.zoneId !== p.zoneId) return;
  if (dist2(p.x, p.z, it.x, it.z) > 9) return; // must be adjacent
  groundItems.delete(itemId);
  if (it.name === 'Coins') { p.gold += it.qty; send(p.ws, { t: 'event', kind: 'loot', text: `${it.qty} Coins`, gold: p.gold }); }
  else { for (let i = 0; i < (it.qty || 1); i++) p.inventory.push(it.name); send(p.ws, { t: 'event', kind: 'loot', text: `${it.qty > 1 ? it.qty + ' ' : ''}${it.name}` }); }
  sendBag(p);
}

function sendBag(p) {
  send(p.ws, { t: 'bag', items: p.inventory, gold: p.gold,
    equipment: p.equipment, stats: equipStats(p.equipment), slots: SLOT_INFO, doll: DOLL });
  // A 'collect' objective reads straight off the inventory, so any bag change
  // can complete (or un-complete) a quest.
  sendQuests(p);
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------
function equipItem(p, name, wanted) {
  const def = itemDef(name);
  const base = slotOf(name);
  if (!def || !base) return;
  const idx = p.inventory.indexOf(name);
  if (idx < 0) return;                                  // must actually hold it
  if ((def.level || 1) > p.level) {
    send(p.ws, { t: 'event', kind: 'notice', text: `You need level ${def.level} to use the ${name}.` });
    return;
  }
  // Rings and earrings come in pairs: honour an explicitly chosen side,
  // otherwise fill an empty one before displacing anything.
  const choices = slotsFor(base);
  let slot = (wanted && choices.includes(wanted)) ? wanted : choices.find(s => !p.equipment[s]) || choices[0];

  p.inventory.splice(idx, 1);
  const previous = p.equipment[slot];
  if (previous) p.inventory.push(previous);             // swap, never destroy
  p.equipment[slot] = name;
  send(p.ws, { t: 'event', kind: 'equip', slot, item: name });
  sendBag(p);
}

function unequipItem(p, slot) {
  if (!SLOTS.includes(slot)) return;
  const name = p.equipment[slot];
  if (!name) return;
  p.equipment[slot] = null;
  p.inventory.push(name);
  send(p.ws, { t: 'event', kind: 'unequip', slot, item: name });
  sendBag(p);
}

// Sell to a merchant NPC you're standing next to. Equipped gear is never sold.
function sellItem(p, name) {
  const merchant = (zoneOf(p).npcs || []).find(n => n.trade);
  if (!merchant) return;
  if (dist2(p.x, p.z, merchant.x, merchant.z) > NPC_TALK_RADIUS * NPC_TALK_RADIUS) return;
  const idx = p.inventory.indexOf(name);
  if (idx < 0) return;
  p.inventory.splice(idx, 1);
  const paid = Math.max(1, Math.round(valueOf(name) * 0.4)); // merchants buy low
  p.gold += paid;
  send(p.ws, { t: 'event', kind: 'sold', text: `Sold ${name} for ${paid} gold.`, gold: p.gold });
  sendBag(p);
}

// ---------------------------------------------------------------------------
// Mining
// ---------------------------------------------------------------------------
function minerStats(p) {
  const prog = miningLevelFromXp(p.miningXp);
  // A pickaxe counts whether it is equipped or just carried, so nobody has to
  // choose between holding a weapon and being able to mine.
  const carried = p.equipment.weapon ? [...p.inventory, p.equipment.weapon] : p.inventory;
  const pick = bestPickaxe(carried, prog.level);
  return { ...prog, pick, power: pick ? PICKAXES[pick].power : 0 };
}

function sendSkills(p) {
  const st = minerStats(p);
  const cs = {};
  for (const s of COMBAT_SKILLS) cs[s] = { level: p.skills[s].level, xp: Math.floor(p.skills[s].xp), next: xpForLevel(p.skills[s].level) };
  const fp = fishingLevelFromXp(p.fishingXp), cp = cookingLevelFromXp(p.cookingXp);
  send(p.ws, { t: 'skills', mining: { level: st.level, xp: p.miningXp, into: st.into, next: st.next, pick: st.pick },
    fishing: { level: fp.level, into: fp.into, next: fp.next, rod: fisherStats(p).rod },
    cooking: { level: cp.level, into: cp.into, next: cp.next },
    combat: cs, combatLevel: p.combat || combatLevel(p.skills), style: p.style,
    meditation: { level: p.meditation.level, xp: Math.floor(p.meditation.xp), next: xpForLevel(p.meditation.level) },
    resting: !!p.resting });
}

function grantMiningXp(p, amount) {
  const before = miningLevelFromXp(p.miningXp).level;
  p.miningXp += amount;
  const after = miningLevelFromXp(p.miningXp).level;
  send(p.ws, { t: 'event', kind: 'minexp', amount });
  if (after > before) {
    send(p.ws, { t: 'event', kind: 'minelevel', level: after });
    systemChat(`${p.name} reached Mining level ${after}.`);
  }
  sendSkills(p);
}

// One swing. Returns true when the vein gives up its ore.
function mineSwing(p, vein) {
  const st = minerStats(p);
  if (!st.pick) {
    send(p.ws, { t: 'event', kind: 'notice', text: 'You need a pickaxe to mine.' });
    p.pendingMine = null; return false;
  }
  if (!canMine(vein.ore, st.level)) {
    send(p.ws, { t: 'event', kind: 'notice',
      text: `You need Mining level ${ORES[vein.ore].level} to mine ${vein.ore}.` });
    p.pendingMine = null; return false;
  }
  send(p.ws, { t: 'event', kind: 'mineswing', id: vein.id });
  // Each swing has a chance to knock loose one ore, so it takes a random number
  // of swings — the animation reads as real work, not a single instant grab.
  if (Math.random() >= swingChance(vein.ore, st.level, st.power)) return false;

  const ore = ORES[vein.ore];
  p.inventory.push(ore.ore);
  if (vein.remaining == null) vein.remaining = veinYield(vein.ore);
  vein.remaining -= 1;
  send(p.ws, { t: 'event', kind: 'mined', id: vein.id, item: ore.ore, xp: ore.xp });
  grantMiningXp(p, ore.xp);
  sendBag(p);
  // The vein is only worked out (and starts its respawn) once it is empty; until
  // then the miner keeps swinging and pulling ore from the same node.
  if (vein.remaining <= 0) { vein.depleted = ore.respawn; return true; }
  return false;
}

function stepMining(p) {
  if (p.pendingMine == null) return;
  const zone = zoneOf(p);
  const vein = zone._veins.get(p.pendingMine);
  if (!vein || vein.depleted > 0) { p.pendingMine = null; return; }
  const d = Math.hypot(vein.x - p.x, vein.z - p.z);
  if (d > MINING.reach) return;   // stepPlayer walks us in
  const st = minerStats(p);
  p.mineTimer -= DT;
  if (p.mineTimer <= 0) {
    p.mineTimer = swingTime(st.power || 1);
    if (mineSwing(p, vein)) p.pendingMine = null; // keep swinging until the vein is worked out
  }
}

// ---------------------------------------------------------------------------
// Fishing — mirrors mining: click a spot, walk to the bank, cast on a timer.
// ---------------------------------------------------------------------------
function fisherStats(p) {
  const prog = fishingLevelFromXp(p.fishingXp);
  const carried = p.equipment.weapon ? [...p.inventory, p.equipment.weapon] : p.inventory;
  const rod = bestRod(carried, prog.level);
  return { ...prog, rod, power: rod ? RODS[rod].power : 0 };
}
function grantFishingXp(p, amount) {
  const before = fishingLevelFromXp(p.fishingXp).level;
  p.fishingXp += amount;
  const after = fishingLevelFromXp(p.fishingXp).level;
  if (after > before) { send(p.ws, { t: 'event', kind: 'fishlevel', level: after }); systemChat(`${p.name} reached Fishing level ${after}.`); }
  sendSkills(p);
}
function fishCast(p, spot) {
  const st = fisherStats(p);
  if (!st.rod) { send(p.ws, { t: 'event', kind: 'notice', text: 'You need a fishing rod.' }); p.pendingFish = null; return true; }
  const fish = FISH[spot.tier];
  if (!fish || st.level < fish.level) {
    send(p.ws, { t: 'event', kind: 'notice', text: `You need Fishing level ${fish ? fish.level : '?'} to fish here.` });
    p.pendingFish = null; return true;
  }
  send(p.ws, { t: 'event', kind: 'fishcast', id: spot.id });
  if (Math.random() >= catchChance(spot.tier, st.level, st.power)) return false;
  p.inventory.push(fish.item);
  send(p.ws, { t: 'event', kind: 'caught', item: fish.item, xp: fish.xp });
  grantFishingXp(p, fish.xp);
  sendBag(p);
  return false; // keep fishing this spot (spots never deplete)
}
function stepFishing(p) {
  if (p.pendingFish == null) return;
  const zone = zoneOf(p);
  const spot = (zone.fishingSpots || []).find(s => s.id === p.pendingFish);
  if (!spot) { p.pendingFish = null; return; }
  if (Math.hypot(spot.x - p.x, spot.z - p.z) > FISHING.reach) return; // stepPlayer walks us in
  p.yaw = Math.atan2(spot.x - p.x, spot.z - p.z);
  p.fishTimer -= DT;
  if (p.fishTimer <= 0) { p.fishTimer = castTime(fisherStats(p).power || 1); if (fishCast(p, spot)) p.pendingFish = null; }
}

// ---------------------------------------------------------------------------
// Cooking — stand at a campfire and cook raw meat/fish; burn chance by level.
// ---------------------------------------------------------------------------
function grantCookingXp(p, amount) {
  const before = cookingLevelFromXp(p.cookingXp).level;
  p.cookingXp += amount;
  const after = cookingLevelFromXp(p.cookingXp).level;
  if (after > before) { send(p.ws, { t: 'event', kind: 'cooklevel', level: after }); systemChat(`${p.name} reached Cooking level ${after}.`); }
  sendSkills(p);
}
function cookOne(p) {
  const level = cookingLevelFromXp(p.cookingXp).level;
  const raw = cookableInInventory(p.inventory, level)[0];
  if (!raw) { p.pendingCook = null; return true; }         // nothing left to cook
  const i = p.inventory.indexOf(raw); if (i < 0) { p.pendingCook = null; return true; }
  p.inventory.splice(i, 1);
  const c = COOKABLES[raw];
  if (Math.random() < burnChance(raw, level)) {
    p.inventory.push(BURNT);
    send(p.ws, { t: 'event', kind: 'cooked', item: BURNT, burnt: true });
  } else {
    p.inventory.push(c.cooked);
    send(p.ws, { t: 'event', kind: 'cooked', item: c.cooked, xp: c.xp });
    grantCookingXp(p, c.xp);
  }
  sendBag(p);
  return cookableInInventory(p.inventory, level).length === 0; // stop when out of raw food
}
function stepCooking(p) {
  if (p.pendingCook == null) return;
  const zone = zoneOf(p);
  const fire = (zone.campfires || []).find(f => f.id === p.pendingCook);
  if (!fire) { p.pendingCook = null; return; }
  if (Math.hypot(fire.x - p.x, fire.z - p.z) > COOKING.reach) return; // walk in
  p.yaw = Math.atan2(fire.x - p.x, fire.z - p.z);
  p.cookTimer -= DT;
  if (p.cookTimer <= 0) { p.cookTimer = COOKING.cookTime; if (cookOne(p)) p.pendingCook = null; }
}

// Eat a cooked food to recover HP.
function eatFood(p, item) {
  const def = itemDef(item);
  if (!def || !def.heal) return;
  const i = p.inventory.indexOf(item); if (i < 0) return;
  if (p.hp >= p.maxHp) { send(p.ws, { t: 'event', kind: 'notice', text: 'You are already at full health.' }); return; }
  p.inventory.splice(i, 1);
  p.hp = Math.min(p.maxHp, p.hp + def.heal);
  send(p.ws, { t: 'event', kind: 'ate', item, heal: def.heal });
  sendBag(p);
}

// Depleted veins come back on their own timer.
function stepVeins() {
  for (const zone of Object.values(ZONES)) {
    for (const v of (zone._veins || new Map()).values()) {
      if (v.depleted > 0) {
        v.depleted -= DT;
        if (v.depleted <= 0) { v.depleted = 0; v.remaining = veinYield(v.ore); } // refill on respawn
      }
    }
  }
}

function depletedIds(zone) {
  const out = [];
  for (const v of (zone._veins || new Map()).values()) if (v.depleted > 0) out.push(v.id);
  return out;
}

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------
function sendQuests(p) {
  const payload = questPayload(p);
  send(p.ws, payload);
  // Announce "ready to hand in" exactly once per quest.
  for (const a of payload.active) {
    if (a.complete && !p.questAnnounced.has(a.id)) {
      p.questAnnounced.add(a.id);
      send(p.ws, { t: 'event', kind: 'questready', id: a.id, name: a.name });
    } else if (!a.complete) p.questAnnounced.delete(a.id);
  }
}

function notifyQuestProgress(p, ids) {
  if (!ids || !ids.length) return;
  for (const id of new Set(ids)) {
    const q = QUESTS[id]; if (!q) continue;
    const pr = questProgress(p, q);
    const line = pr.objectives.filter(o => !o.done || o.need > 1)
      .map(o => `${o.label} ${o.have}/${o.need}`).join(', ');
    send(p.ws, { t: 'event', kind: 'questprogress', id, name: q.name, text: line });
  }
  sendQuests(p);
}

function npcFor(zone, giverId) { return (zone.npcs || []).find(n => n.id === giverId); }

// The giver must actually be standing next to you — the client asking nicely
// isn't enough.
function nearGiver(p, q) {
  const npc = npcFor(zoneOf(p), q.giver);
  if (!npc) return false;
  return dist2(p.x, p.z, npc.x, npc.z) <= NPC_TALK_RADIUS * NPC_TALK_RADIUS;
}

function acceptQuest(p, id) {
  const q = QUESTS[id];
  if (!q || !canStart(p, q) || !nearGiver(p, q)) return;
  p.quests.set(id, true);
  p.questKills[id] = p.questKills[id] || {};
  send(p.ws, { t: 'event', kind: 'questaccepted', id, name: q.name });
  systemChat(`${p.name} started "${q.name}".`);
  sendQuests(p);
}

function turnInQuest(p, id) {
  const q = QUESTS[id];
  if (!q || !p.quests.has(id) || !nearGiver(p, q)) return;
  if (!questProgress(p, q).complete) return;

  consumeQuestItems(p, q);
  p.quests.delete(id);
  p.questDone.add(id);
  p.questAnnounced.delete(id);
  delete p.questKills[id];

  const r = q.reward || {};
  if (r.gold) p.gold += r.gold;
  for (const it of (r.items || [])) p.inventory.push(it);
  send(p.ws, { t: 'event', kind: 'questcomplete', id, name: q.name,
    text: q.done, xp: r.xp || 0, gold: r.gold || 0, items: r.items || [] });
  if (r.xp) grantXp(p, r.xp);          // may level the player up
  systemChat(`${p.name} completed "${q.name}".`);
  sendBag(p);                           // also re-sends the quest payload
}

// Called each tick: satisfy 'reach' objectives by standing near the POI.
function checkQuestReach(p) {
  if (!p.quests.size) return;
  const zone = zoneOf(p);
  for (const poi of zone.pois) {
    if (dist2(p.x, p.z, poi.x, poi.z) > QUEST_REACH_RADIUS * QUEST_REACH_RADIUS) continue;
    const moved = recordReach(p, zone.id, poi.key);
    if (moved.length) notifyQuestProgress(p, moved);
  }
}

// Called from the movement state machine once the player is in melee range.
// Per-weapon attack speed (ticks). Fast blades swing more often; heavy weapons
// hit harder but slower. Anything not listed uses the default (4 ticks).
const WEAPON_SPEED = {
  'Bronze Dagger': 3, 'Spiderfang Dagger': 3, 'Rusty Dagger': 3,
  'Iron Sword': 4, 'Goblin Shortbow': 3,
  'Ogre Club': 6, "Giant's Stone Maul": 7,
};
function playerAttackSpeed(p) {
  const w = p.equipment && p.equipment.weapon;
  return (WEAPON_SPEED[w] || DEFAULT_ATTACK_SPEED) * TICK;
}
// Combat XP: 4 per damage to the style's skill (split for controlled) + 1.33 to
// hitpoints. Levels the skill, grows max HP off hitpoints, tracks combat level.
function addSkillXp(p, skill, amount) {
  const sk = p.skills[skill]; if (!sk) return;
  sk.xp += amount; let leveled = false;
  while (sk.xp >= xpForLevel(sk.level)) { sk.xp -= xpForLevel(sk.level); sk.level++; leveled = true; }
  if (leveled) {
    if (skill === 'hitpoints') { const old = p.maxHp; p.maxHp = hpForHitpoints(sk.level); p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - old)); }
    p.combat = combatLevel(p.skills);
    send(p.ws, { t: 'event', kind: 'skilllevel', skill, level: sk.level });
  }
}
function awardCombatXp(p, dmg) {
  if (dmg <= 0) return;
  const s = STYLES[p.style] || STYLES.controlled;
  if (s.train === 'shared') { addSkillXp(p, 'attack', 1.33 * dmg); addSkillXp(p, 'strength', 1.33 * dmg); addSkillXp(p, 'defence', 1.33 * dmg); }
  else addSkillXp(p, s.train, 4 * dmg);
  addSkillXp(p, 'hitpoints', 1.33 * dmg);
  sendSkills(p);
}
// Meditation trains as you rest to heal: xp scales with HP recovered.
function addMeditationXp(p, amount) {
  const sk = p.meditation; sk.xp += amount; let leveled = false;
  while (sk.xp >= xpForLevel(sk.level)) { sk.xp -= xpForLevel(sk.level); sk.level++; leveled = true; }
  if (leveled) { send(p.ws, { t: 'event', kind: 'medlevel', level: sk.level }); sendSkills(p); }
}
function doPlayerAttack(p, m) {
  if (p.atkTimer > 0) return;
  p.atkTimer = playerAttackSpeed(p);
  m.state = 'combat'; m.targetId = p.id; // monster fights back even on a miss
  // OSRS accuracy: our attack roll vs the monster's defence roll; damage 0..maxHit.
  // A flat competence (+6 effective) keeps early, gear-less combat from being a
  // miss-fest against low-level foes while still scaling with skills and gear.
  const eq = equipStats(p.equipment), bonus = eq.atk || 0, COMP = 6;
  const dmg = rollSwing(p.skills.attack.level + COMP, p.skills.strength.level + COMP, bonus, bonus, p.style, m.defLevel || 1, m.defBonus || 0);
  if (dmg > 0) { m.hp -= dmg; awardCombatXp(p, dmg); }
  broadcast({ t: 'event', kind: 'hit', by: p.id, target: m.id, dmg, targetKind: 'monster' });
  if (m.hp <= 0) killMonster(m, p);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function stepMonster(m) {
  const zone = zoneOf(m);
  if (!m.alive) {
    m.respawnTimer -= DT;
    if (m.respawnTimer <= 0) {
      const pos = spawnInRegion(zone, m.spec.region, { passive: m.passive });
      m.x = pos.x; m.z = pos.z; m.home = { x: pos.x, z: pos.z };
      m.hp = m.maxHp; m.alive = true; m.state = 'idle'; m.targetId = null; m.atkTimer = 0;
    }
    return;
  }
  m.atkTimer = Math.max(0, m.atkTimer - DT);

  let target = m.targetId ? players.get(m.targetId) : null;
  if (target && (!target.alive || target.zoneId !== m.zoneId)) { target = null; m.targetId = null; }
  if (!target && !m.passive) { // passive mobs only fight when attacked
    let best = null, bestD = m.aggro ** 2;
    for (const p of players.values()) {
      if (!p.alive || p.zoneId !== m.zoneId || inSafeZone(zone, p.x, p.z)) continue; // safe zones block aggro
      const d = dist2(m.x, m.z, p.x, p.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) { target = best; m.targetId = best.id; m.state = 'combat'; }
  }

  if (target) {
    const d = Math.hypot(target.x - m.x, target.z - m.z);
    // Passive mobs have aggro 0, which used to give them a zero-length leash:
    // one step from home and they reset to full health, so a cow could almost
    // never be killed. Every mob gets a real minimum.
    const leash = m.elite ? ELITE.leash : Math.max(12, m.aggro * 2.2);
    if (dist2(m.x, m.z, m.home.x, m.home.z) > leash ** 2 || inSafeZone(zone, target.x, target.z)) {
      m.targetId = null; m.state = 'return';
    } else {
      m.yaw = Math.atan2(target.x - m.x, target.z - m.z);
      if (d > ATTACK_RANGE - 0.5) {
        m.x += Math.sin(m.yaw) * m.speed * DT;
        m.z += Math.cos(m.yaw) * m.speed * DT;
      } else if (m.atkTimer <= 0) {
        m.atkTimer = (m.attackSpeed || 4) * TICK;
        // OSRS accuracy: monster attack roll vs the player's defence roll (level
        // + armour), damage 0..monster maxHit.
        const eq = equipStats(target.equipment);
        const dmg = rollMonsterSwing(m.atkLevel || 1, m.atkBonus || 0, m.maxHit || 1, target.skills.defence.level, eq.def || 0);
        if (dmg > 0) { target.hp -= dmg; target.combatTimer = REGEN.combatLockout; }
        // Auto-retaliate: if the player isn't already fighting, strike back.
        if (target.alive && target.combatId == null && !target.pendingMine) { target.combatId = m.id; target.moveTo = null; }
        broadcast({ t: 'event', kind: 'hit', by: m.id, target: target.id, dmg, targetKind: 'player' });
        if (target.hp <= 0) {
          target.hp = 0; target.alive = false; target.deathTimer = RESPAWN_TIME;
          m.targetId = null; m.state = 'idle';
          systemChat(`${target.name} was slain by ${m.elite ? m.name : 'a ' + m.name}.`);
          send(target.ws, { t: 'event', kind: 'death' });
        }
      }
      resolveCollision(zone, m, PLAYER_RADIUS);
      return;
    }
  }

  // Wander near home / return home.
  m.wanderTimer -= DT;
  if (m.state === 'return') {
    const dx = m.home.x - m.x, dz = m.home.z - m.z, d = Math.hypot(dx, dz);
    if (d < 1) { m.state = 'idle'; m.hp = m.maxHp; }
    else { m.yaw = Math.atan2(dx, dz); m.x += (dx / d) * m.speed * DT; m.z += (dz / d) * m.speed * DT; }
  } else if (m.wanderTimer <= 0) {
    m.wanderTimer = rand(2, 5);
    if (Math.random() < 0.5) { m.state = 'idle'; }
    else { const a = rand(0, Math.PI * 2); m.wanderDir = { x: Math.sin(a), z: Math.cos(a) }; m.yaw = a; m.state = 'wander'; }
  }
  if (m.state === 'wander') {
    m.x += m.wanderDir.x * m.speed * 0.4 * DT;
    m.z += m.wanderDir.z * m.speed * 0.4 * DT;
    if (dist2(m.x, m.z, m.home.x, m.home.z) > 15 ** 2) m.state = 'return';
  }
  resolveCollision(zone, m, PLAYER_RADIUS);
}

function stepPlayer(p) {
  if (!p.alive) { p.deathTimer -= DT; return; }
  const zone = zoneOf(p);
  p.atkTimer = Math.max(0, p.atkTimer - DT);
  if (p.portalCd > 0) p.portalCd -= DT;
  let moved = false;
  const inp = p.input;
  // Meditating ends the moment the player wants to act (move / fight / interact)
  // or gets hit — you can't rest in the middle of a scrap.
  if (p.resting) {
    const wantsAction = (inp && (inp.f !== 0 || inp.r !== 0)) || p.moveTo || p.combatId != null ||
      p.pendingChest || p.pendingPickup != null || p.pendingMine != null || p.pendingGate ||
      p.pendingFish != null || p.pendingCook != null;
    if (wantsAction || (p.combatTimer || 0) > 0) { p.resting = false; sendSkills(p); }
  }
  const step = (tx, tz, stopDist) => {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d <= stopDist) return false;
    const yaw = Math.atan2(dx, dz);
    p.x += Math.sin(yaw) * PLAYER_SPEED * DT; p.z += Math.cos(yaw) * PLAYER_SPEED * DT;
    p.yaw = yaw; return true;
  };

  if (inp && (inp.f !== 0 || inp.r !== 0)) {
    // Manual WASD overrides click-to-move / combat.
    p.moveTo = null; p.combatId = null; p.pendingChest = null; p.pendingPickup = null; p.pendingMine = null; p.pendingGate = false; p.pendingFish = null; p.pendingCook = null;
    const yaw = inp.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.sin(yaw - Math.PI / 2), rz = Math.cos(yaw - Math.PI / 2);
    let mx = fx * inp.f + rx * inp.r, mz = fz * inp.f + rz * inp.r;
    const len = Math.hypot(mx, mz);
    if (len > 1e-4) {
      mx /= len; mz /= len;
      p.x += mx * PLAYER_SPEED * DT; p.z += mz * PLAYER_SPEED * DT;
      p.yaw = Math.atan2(mx, mz); moved = true;
    }
  } else if (p.combatId != null) {
    const m = monsters.get(p.combatId);
    if (!m || !m.alive || m.zoneId !== p.zoneId) { p.combatId = null; }
    else if (step(m.x, m.z, ATTACK_RANGE - 0.4)) { moved = true; } // walk into range
    else { p.yaw = Math.atan2(m.x - p.x, m.z - p.z); doPlayerAttack(p, m); }
  } else if (p.pendingChest) {
    const ch = (zone.chests || []).find(c => c.id === p.pendingChest);
    if (!ch) { p.pendingChest = null; }
    else if (step(ch.x, ch.z, 2.5)) { moved = true; }
    else { openChest(p, ch.id); p.pendingChest = null; }
  } else if (p.pendingPickup != null) {
    const it = groundItems.get(p.pendingPickup);
    if (!it || it.zoneId !== p.zoneId) { p.pendingPickup = null; }
    else if (step(it.x, it.z, 1.6)) { moved = true; }
    else { pickupItem(p, p.pendingPickup); p.pendingPickup = null; }
  } else if (p.pendingMine != null) {
    const v = zone._veins && zone._veins.get(p.pendingMine);
    if (!v || v.depleted > 0) { p.pendingMine = null; }
    else if (step(v.x, v.z, MINING.reach - 0.6)) { moved = true; }
    else p.yaw = Math.atan2(v.x - p.x, v.z - p.z);
  } else if (p.pendingFish != null) {
    const s = (zone.fishingSpots || []).find(f => f.id === p.pendingFish);
    if (!s) { p.pendingFish = null; }
    else if (step(s.x, s.z, FISHING.reach - 0.6)) { moved = true; }
    else p.yaw = Math.atan2(s.x - p.x, s.z - p.z);
  } else if (p.pendingCook != null) {
    const f = (zone.campfires || []).find(c => c.id === p.pendingCook);
    if (!f) { p.pendingCook = null; }
    else if (step(f.x, f.z, COOKING.reach - 0.6)) { moved = true; }
    else p.yaw = Math.atan2(f.x - p.x, f.z - p.z);
  } else if (p.pendingGate) {
    const g = zone._gate;
    if (!g) { p.pendingGate = false; }
    else if (step(g.cx, g.cz, GATE_REACH)) { moved = true; }
    else { p.yaw = Math.atan2(g.cx - p.x, g.cz - p.z); toggleGate(g, p); p.pendingGate = false; }
  } else if (p.moveTo) {
    if (step(p.moveTo.x, p.moveTo.z, 0.5)) moved = true;
    else p.moveTo = null;
  }
  p.moving = moved;
  resolveCollision(zone, p, PLAYER_RADIUS);
  // Stand on the floor beneath us: step/ramp up onto surfaces, fall off ledges.
  const floor = floorHeightAt(zone, p.x, p.z, p.y || 0);
  if (floor >= (p.y || 0) - 0.01) p.y = floor; else p.y = Math.max(floor, (p.y || 0) - 16 * DT);

  // Zone transitions (cave mouth / exit portal).
  if (p.portalCd <= 0 && zone.portals) {
    for (const portal of zone.portals) {
      if (dist2(p.x, p.z, portal.x, portal.z) < portal.r * portal.r) {
        transitionPlayer(p, portal.to, portal.spawn);
        return;
      }
    }
  }

  stepMining(p);
  stepFishing(p);
  stepCooking(p);
  checkQuestReach(p);

  const safe = inSafeZone(zone, p.x, p.z);

  // Environmental hazards (damage over time), disabled inside safe zones.
  if (!safe && zone.hazards) {
    let inHazard = null;
    for (const h of zone.hazards) {
      if (dist2(p.x, p.z, h.x, h.z) < h.r * h.r) { inHazard = h; break; }
    }
    if (inHazard) {
      p.hazardAccum = (p.hazardAccum || 0) + inHazard.dps * DT;
      if (p.hazardAccum >= 1) {
        const d = Math.floor(p.hazardAccum); p.hazardAccum -= d;
        p.hp -= d;
        p.combatTimer = REGEN.combatLockout;
        send(p.ws, { t: 'event', kind: 'hazard', dmg: d, hazard: inHazard.type });
        if (p.hp <= 0) {
          p.hp = 0; p.alive = false; p.deathTimer = RESPAWN_TIME;
          send(p.ws, { t: 'event', kind: 'death' });
          systemChat(`${p.name} succumbed to the ${inHazard.label}.`);
        }
      }
    } else p.hazardAccum = 0;
  }

  // Regen: faster inside safe zones, and locked out for a few seconds after
  // taking a hit. Without the lockout it ticked all the way through a fight and
  // quietly paid for roughly a third of the incoming damage.
  p.combatTimer = Math.max(0, (p.combatTimer || 0) - DT);
  if (p.resting && p.hp < p.maxHp && p.combatTimer <= 0) {
    // Meditation: heal at a level-scaled rate, and train the skill on the HP
    // recovered. HP is a float here; the snapshot rounds it for display.
    const heal = Math.min(p.maxHp - p.hp, meditationHealRate(p.meditation.level) * DT);
    p.hp += heal;
    if (heal > 0) addMeditationXp(p, heal * MEDITATION.xpPerHp);
    if (p.hp >= p.maxHp) { p.resting = false; sendSkills(p); } // fully rested
  } else if (p.hp < p.maxHp && (safe || p.combatTimer <= 0)) {
    p.regen += DT;
    const rate = safe ? 0.35 : 1.0; // seconds per tick of passive healing
    if (p.regen >= rate) { p.regen = 0; p.hp = Math.min(p.maxHp, p.hp + (safe ? 6 : 2)); }
  }
  p.inSafe = safe;
}

function respawnPlayer(p) {
  const zone = zoneOf(p);
  p.x = zone.spawn.x; p.z = zone.spawn.z; p.hp = p.maxHp; p.alive = true; p.moving = false; p.resting = false;
  p.moveTo = null; p.combatId = null; p.pendingChest = null; p.pendingPickup = null;
  send(p.ws, { t: 'event', kind: 'respawned' });
}

function transitionPlayer(p, toId, spawn) {
  const to = ZONES[toId];
  if (!to) { p.portalCd = 2; return; } // destination zone not built yet — ignore
  p.zoneId = toId;
  p.x = spawn.x; p.z = spawn.z; p.yaw = spawn.yaw || 0;
  p.input = { f: 0, r: 0, yaw: 0 }; p.moving = false; p.hazardAccum = 0;
  p.moveTo = null; p.combatId = null; p.pendingChest = null; p.pendingPickup = null; p.pendingMine = null;
  p.portalCd = 2; // don't immediately re-trigger the return portal
  send(p.ws, { t: 'transition', zone: zoneForClient(to) });
  sendQuests(p); // giver markers are per-zone
  systemChat(`${p.name} entered ${to.name}.`);
}

function openChest(p, chestId) {
  const zone = zoneOf(p);
  const chest = (zone.chests || []).find(c => c.id === chestId);
  if (!chest) return;
  if (dist2(p.x, p.z, chest.x, chest.z) > 25) return; // must be near it
  const key = p.zoneId + ':' + chestId;
  if (p.openedChests.has(key)) return;
  p.openedChests.add(key);
  const gold = chest.gold || Math.floor(rand(60, 160));
  p.gold += gold;
  const item = chest.item || 'Smuggler’s Trinket';
  p.inventory.push(item);
  send(p.ws, { t: 'event', kind: 'chest', id: chestId, text: `${gold} gold and a ${item}`, gold: p.gold });
  sendBag(p);
  // A 'chest' objective reads p.openedChests, so just re-announce progress.
  notifyQuestProgress(p, [...p.quests.keys()].filter(id =>
    QUESTS[id].objectives.some(o => o.type === 'chest' && o.zone === p.zoneId && o.chest === chestId)));
}

// World clock + weather (shared by all players).
const DAY_LENGTH = 600;          // seconds for a full day/night cycle (10 min)
let dayTime = 0.5;              // 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk
const DAY_NIGHT_CYCLE = false;  // night disabled for now — time pinned at noon
const WEATHER_POOL = ['clear', 'clear', 'clear', 'rain', 'mist'];
let weather = 'clear';
let weatherTimer = 120;

// Main loop
let lastSnap = 0;
setInterval(() => {
  if (DAY_NIGHT_CYCLE) dayTime = (dayTime + DT / DAY_LENGTH) % 1;
  weatherTimer -= DT;
  if (weatherTimer <= 0) {
    weather = WEATHER_POOL[Math.floor(Math.random() * WEATHER_POOL.length)];
    weatherTimer = 90 + Math.random() * 150;
  }
  stepVeins();
  stepGates();
  for (const m of monsters.values()) stepMonster(m);
  for (const p of players.values()) stepPlayer(p);
  for (const [id, it] of groundItems) { it.ttl -= DT; if (it.ttl <= 0) groundItems.delete(id); }

  const now = Date.now();
  if (now - lastSnap >= 1000 / SNAPSHOT_HZ) {
    lastSnap = now;
    // Build one snapshot per zone; each player only sees entities in their zone.
    const byZone = {};
    const zoneSnap = (zid) => {
      if (byZone[zid]) return byZone[zid];
      const ps = [], ms = [];
      for (const p of players.values()) {
        if (p.zoneId !== zid) continue;
        ps.push({ id: p.id, name: p.name, x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +(p.y || 0).toFixed(2),
          yaw: +p.yaw.toFixed(2), hp: Math.round(p.hp), maxHp: p.maxHp, level: p.level,
          combat: p.combat || combatLevel(p.skills),
          xp: p.xp, xpNext: xpForLevel(p.level), gold: p.gold, alive: p.alive,
          moving: p.moving, inSafe: !!p.inSafe, resting: !!p.resting,
          weapon: p.equipment.weapon || null }); // held item for the paperdoll
      }
      for (const m of monsters.values()) {
        if (m.zoneId !== zid) continue;
        ms.push({ id: m.id, type: m.type, name: m.name, level: m.level, elite: m.elite,
          x: +m.x.toFixed(2), z: +m.z.toFixed(2), yaw: +m.yaw.toFixed(2),
          hp: Math.round(m.hp), maxHp: m.maxHp, alive: m.alive });
      }
      const items = [];
      for (const it of groundItems.values()) {
        if (it.zoneId !== zid) continue;
        items.push({ id: it.id, name: it.name, qty: it.qty, x: +it.x.toFixed(2), z: +it.z.toFixed(2) });
      }
      const gate = ZONES[zid]._gate;
      return (byZone[zid] = JSON.stringify({ t: 'snapshot', now, players: ps, monsters: ms, items,
        depleted: depletedIds(ZONES[zid]),
        gate: gate ? +(gate.t * gate.dir).toFixed(3) : undefined, // signed: sign = swing direction
        time: +dayTime.toFixed(4), weather }));
    };
    for (const p of players.values()) {
      if (p.ws.readyState === p.ws.OPEN) p.ws.send(zoneSnap(p.zoneId));
    }
  }
}, 1000 / TICK_HZ);

setInterval(() => {
  for (const p of players.values()) if (!p.alive && p.deathTimer > 0) p.deathTimer -= 0.25;
}, 250);

// ---------------------------------------------------------------------------
// HTTP static host + WebSocket
// ---------------------------------------------------------------------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
const httpServer = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(CLIENT_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(CLIENT_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
});

function zoneForClient(zone) {
  return {
    id: zone.id, name: zone.name, subtitle: zone.subtitle, spawn: zone.spawn,
    bounds: zone.bounds, boundary: zone.boundary, pois: zone.pois, path: zone.path, river: zone.river,
    paths: zone.paths || (zone.path ? [zone.path] : []), rivers: zone.rivers || (zone.river ? [zone.river] : []),
    rocks: zone.rocks, hazards: zone.hazards, pools: zone.pools, chests: zone.chests,
    fishingSpots: zone.fishingSpots || [], campfires: zone.campfires || [],
    env: zone.env, enclosed: !!zone.enclosed, ceilingY: zone.ceilingY,
    npcs: zone.npcs || [],
    trees: zone._trees || [],
    scatter: zone._scatter || [],
    hanging: zone._hanging || [],
    models: zone.models || [],
    farmBox: zone._farmBox || null,
    gate: zone.farm && zone.farm.gate ? { x: zone.farm.gate.x, z: zone.farm.gate.z, yaw: zone.farm.gate.yaw || 0, s: zone.farm.gate.s || 1 } : null,
    editObjects: zone._editObjects || [],
    editSpawns: zone._editSpawns || [],
  };
}

const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (ws) => {
  let player = null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'join': {
        if (player) return;
        const name = String(msg.name || 'Adventurer').slice(0, 16).replace(/[^\w \-]/g, '') || 'Adventurer';
        const id = nextId++;
        const start = ZONES[START_ZONE];
        player = {
          id, ws, kind: 'player', name, zoneId: START_ZONE,
          x: start.spawn.x, z: start.spawn.z, y: 0, yaw: start.spawn.yaw, moving: false,
          level: 1, xp: 0, gold: 0, openedChests: new Set(),
          // OSRS-style combat skills. Hitpoints starts at 10 (=> 80 HP).
          skills: { attack: { level: 1, xp: 0 }, strength: { level: 1, xp: 0 },
            defence: { level: 1, xp: 0 }, hitpoints: { level: 10, xp: 0 } },
          meditation: { level: 1, xp: 0 }, resting: false,
          style: 'controlled',
          // Everyone starts able to mine and fish; better tools are earned. The
          // pickaxe starts equipped so it shows in-hand (and swings when mining).
          inventory: ['Fishing Rod'],
          equipment: Object.assign(emptySlots(), { weapon: 'Bronze Pickaxe' }),
          miningXp: 0, pendingMine: null, mineTimer: 0,
          fishingXp: 0, pendingFish: null, fishTimer: 0,
          cookingXp: 0, pendingCook: null, cookTimer: 0,
          quests: new Map(), questDone: new Set(), questKills: {},
          questFlags: new Set(), questAnnounced: new Set(),
          maxHp: hpForHitpoints(10), hp: hpForHitpoints(10), alive: true,
          atkTimer: 0, regen: 0, combatTimer: 0, deathTimer: 0, portalCd: 0, inSafe: true,
          moveTo: null, combatId: null, pendingChest: null, pendingPickup: null, pendingGate: false, input: { f: 0, r: 0, yaw: 0 },
        };
        player.combat = combatLevel(player.skills);
        players.set(id, player);
        send(ws, { t: 'welcome', id, tickRate: SNAPSHOT_HZ, zone: zoneForClient(start) });
        sendBag(player); // sends the quest payload too
        sendSkills(player);
        systemChat(`${name} has entered ${start.name}.`);
        break;
      }
      case 'input': {
        if (!player) return;
        player.input = {
          f: clamp(Number(msg.f) || 0, -1, 1),
          r: clamp(Number(msg.r) || 0, -1, 1),
          yaw: Number(msg.yaw) || 0,
        };
        break;
      }
      case 'attack': {
        if (!player || !player.alive) break;
        const m = monsters.get(Number(msg.target));
        if (m && m.alive && m.zoneId === player.zoneId) {
          player.combatId = m.id; player.moveTo = null; player.pendingChest = null; player.pendingPickup = null; player.pendingMine = null;
        }
        break;
      }
      case 'style': {
        if (!player) break;
        if (STYLES[msg.style]) { player.style = msg.style; sendSkills(player); }
        break;
      }
      case 'rest': {
        if (!player || !player.alive) break;
        // Toggle meditation. Can't start resting mid-fight.
        player.resting = !player.resting && (player.combatTimer || 0) <= 0 && player.combatId == null;
        sendSkills(player);
        break;
      }
      case 'move': {
        if (!player || !player.alive) break;
        const b = zoneOf(player).bounds;
        player.moveTo = { x: clamp(Number(msg.x) || 0, b.minX, b.maxX), z: clamp(Number(msg.z) || 0, b.minZ, b.maxZ) };
        player.combatId = null; player.pendingChest = null; player.pendingPickup = null; player.pendingMine = null;
        break;
      }
      case 'openchest': {
        if (!player || !player.alive) break;
        player.pendingChest = String(msg.id || ''); player.combatId = null; player.moveTo = null; player.pendingPickup = null; player.pendingMine = null;
        break;
      }
      case 'pickup': {
        if (!player || !player.alive) break;
        player.pendingPickup = Number(msg.id); player.combatId = null; player.moveTo = null; player.pendingChest = null; player.pendingMine = null;
        break;
      }
      case 'gate': {
        if (!player || !player.alive || !zoneOf(player)._gate) break;
        player.pendingGate = true; player.combatId = null; player.moveTo = null; player.pendingChest = null; player.pendingPickup = null; player.pendingMine = null;
        break;
      }
      case 'fish': {
        if (!player || !player.alive) break;
        const spot = (zoneOf(player).fishingSpots || []).find(s => s.id === String(msg.id || ''));
        if (!spot) break;
        player.pendingFish = spot.id; player.pendingCook = null;
        player.combatId = null; player.moveTo = null; player.pendingChest = null; player.pendingPickup = null; player.pendingMine = null; player.resting = false;
        break;
      }
      case 'cook': {
        if (!player || !player.alive) break;
        const fire = (zoneOf(player).campfires || []).find(s => s.id === String(msg.id || ''));
        if (!fire) break;
        player.pendingCook = fire.id; player.pendingFish = null;
        player.combatId = null; player.moveTo = null; player.pendingChest = null; player.pendingPickup = null; player.pendingMine = null; player.resting = false;
        break;
      }
      case 'eat': {
        if (!player || !player.alive) break;
        eatFood(player, String(msg.item || ''));
        break;
      }
      // --- World editor (gated by EDIT_KEY) ---
      case 'edit:list': {
        if (msg.key === EDIT_KEY) send(ws, { t: 'models', models: MODEL_MANIFEST, mobs: MOB_TYPES, items: LOOT_ITEMS, loot: allLootTables() });
        break;
      }
      case 'edit:loot:set': {
        if (msg.key !== EDIT_KEY || !MONSTER_TEMPLATES[msg.type] || !Array.isArray(msg.table)) break;
        const table = msg.table.filter(e => e && lootItemOk(e.item)).map(e => ({
          item: String(e.item), min: Math.max(0, Math.min(9999, (+e.min | 0) || 1)),
          max: Math.max(1, Math.min(9999, (+e.max | 0) || 1)), chance: Math.max(1, Math.min(100000, (+e.chance | 0) || 1)),
        }));
        LOOT_OVERRIDES[msg.type] = table; saveLootOverrides();
        broadcast({ t: 'loot', type: msg.type, table }); // sync any other editors
        break;
      }
      case 'edit:spawn:place': {
        if (!player || msg.key !== EDIT_KEY || !MONSTER_TEMPLATES[msg.type]) break;
        const z = zoneOf(player);
        const sp = { id: 's' + (editSeq++), type: String(msg.type), cx: +(+msg.x).toFixed(2), cz: +(+msg.z).toFixed(2),
          r: +(+(msg.r || 8)).toFixed(1), count: Math.max(1, Math.min(20, +(msg.count || 3) | 0)),
          level: Math.max(1, Math.min(20, +(msg.level || 1) | 0)), respawn: Math.max(2, Math.min(600, +(msg.respawn || 20) | 0)) };
        (z._editSpawns = z._editSpawns || []).push(sp);
        spawnEditorRegion(z, sp); saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'spawn', sp });
        break;
      }
      case 'edit:spawn:update': {
        if (!player || msg.key !== EDIT_KEY) break;
        const z = zoneOf(player); const sp = (z._editSpawns || []).find(s => s.id === msg.id); if (!sp) break;
        if (msg.type != null && MONSTER_TEMPLATES[msg.type]) sp.type = String(msg.type);
        if (msg.cx != null) sp.cx = +(+msg.cx).toFixed(2);
        if (msg.cz != null) sp.cz = +(+msg.cz).toFixed(2);
        if (msg.r != null) sp.r = Math.max(1, Math.min(60, +(+msg.r).toFixed(1)));
        if (msg.count != null) sp.count = Math.max(1, Math.min(20, +msg.count | 0));
        if (msg.level != null) sp.level = Math.max(1, Math.min(20, +msg.level | 0));
        if (msg.respawn != null) sp.respawn = Math.max(2, Math.min(600, +msg.respawn | 0));
        despawnEditorRegion(sp.id); spawnEditorRegion(z, sp); // re-roll the region with new settings
        saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'spawn', sp });
        break;
      }
      case 'edit:spawn:delete': {
        if (!player || msg.key !== EDIT_KEY) break;
        const z = zoneOf(player); const i = (z._editSpawns || []).findIndex(s => s.id === msg.id); if (i < 0) break;
        const [sp] = z._editSpawns.splice(i, 1); despawnEditorRegion(sp.id);
        saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'spawn:delete', id: sp.id });
        break;
      }
      case 'edit:place': {
        if (!player || msg.key !== EDIT_KEY || !msg.m) break;
        const z = zoneOf(player);
        const o = { id: 'e' + (editSeq++), m: String(msg.m), x: +(+msg.x).toFixed(2), z: +(+msg.z).toFixed(2),
          yaw: +(+(msg.yaw || 0)).toFixed(3), s: +(+(msg.s || 1)).toFixed(3), c: +(+(msg.c || 0)).toFixed(2),
          // per-part texture map { partIndex: textureName }; carried over by Duplicate
          tex: (msg.tex && typeof msg.tex === 'object' && !Array.isArray(msg.tex)) ? msg.tex : {} };
        o.y = clamp(+(msg.y || 0), -20, 100); // height offset above the ground (stacking)
        // Builder primitives (prim:floor / prim:wall / prim:block) carry box dims.
        if (o.m.startsWith('prim:')) { o.w = clamp(+msg.w || 4, 0.2, 200); o.h = clamp(+msg.h || 3, 0.2, 60); o.d = clamp(+msg.d || 4, 0.2, 200); }
        z._editObjects.push(o); saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'place', obj: o });
        break;
      }
      case 'edit:update': {
        if (!player || msg.key !== EDIT_KEY) break;
        const z = zoneOf(player); const o = (z._editObjects || []).find(o => o.id === msg.id); if (!o) break;
        if (msg.x != null) o.x = +(+msg.x).toFixed(2);
        if (msg.z != null) o.z = +(+msg.z).toFixed(2);
        if (msg.yaw != null) o.yaw = +(+msg.yaw).toFixed(3);
        if (msg.s != null) o.s = +(+msg.s).toFixed(3);
        if (msg.c != null) o.c = +(+msg.c).toFixed(2);
        if (msg.y != null) o.y = clamp(+msg.y, -20, 100);
        if (msg.w != null) o.w = clamp(+msg.w, 0.2, 200);
        if (msg.h != null) o.h = clamp(+msg.h, 0.2, 60);
        if (msg.d != null) o.d = clamp(+msg.d, 0.2, 200);
        // Per-part texture: msg.part is the material index, msg.tex the name ('' clears).
        if (msg.part != null) {
          if (!o.tex || typeof o.tex !== 'object') o.tex = {};
          if (msg.tex) o.tex[String(msg.part)] = String(msg.tex); else delete o.tex[String(msg.part)];
        }
        saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'update', obj: o });
        break;
      }
      case 'edit:delete': {
        if (!player || msg.key !== EDIT_KEY) break;
        const z = zoneOf(player); const i = (z._editObjects || []).findIndex(o => o.id === msg.id); if (i < 0) break;
        z._editObjects.splice(i, 1); saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'delete', id: msg.id });
        break;
      }
      case 'equip': if (player && player.alive) equipItem(player, String(msg.item || ''), msg.slot ? String(msg.slot) : null); break;
      case 'unequip': if (player && player.alive) unequipItem(player, String(msg.slot || '')); break;
      case 'sell': if (player && player.alive) sellItem(player, String(msg.item || '')); break;
      case 'mine': {
        if (!player || !player.alive) break;
        const mz = zoneOf(player);
        const id = Number(msg.id);
        const v = mz._veins && mz._veins.get(id);
        if (!v || v.depleted > 0) break;
        // Answer now rather than after the player has walked the length of the
        // zone to find out they cannot mine this.
        const st = minerStats(player);
        if (!st.pick) {
          send(ws, { t: 'event', kind: 'notice', text: 'You need a pickaxe to mine.' });
          break;
        }
        if (!canMine(v.ore, st.level)) {
          send(ws, { t: 'event', kind: 'notice',
            text: `You need Mining level ${ORES[v.ore].level} to mine ${v.ore}.` });
          break;
        }
        player.pendingMine = id; player.mineTimer = 0;
        player.combatId = null; player.moveTo = null;
        player.pendingChest = null; player.pendingPickup = null;
        break;
      }
      case 'questaccept': if (player && player.alive) acceptQuest(player, String(msg.id || '')); break;
      case 'questturnin': if (player && player.alive) turnInQuest(player, String(msg.id || '')); break;
      case 'questsync': if (player) sendQuests(player); break;
      case 'respawn': if (player && !player.alive && player.deathTimer <= 0) respawnPlayer(player); break;
      case 'chat': {
        if (!player) return;
        const text = String(msg.msg || '').slice(0, 200);
        if (text.trim()) broadcast({ t: 'chat', from: player.name, msg: text });
        break;
      }
    }
  });
  ws.on('close', () => {
    if (player) { players.delete(player.id); systemChat(`${player.name} has left the world.`); }
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n  Blackroot — ${ZONES[START_ZONE].name}`);
  console.log(`  Open http://localhost:${PORT} in your browser.`);
  console.log(`  Open it in two windows to see multiplayer.\n`);
});
