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
} from './balance.js';
import { ITEMS, SLOTS, SLOT_INFO, DOLL, itemDef, slotOf, valueOf, equipStats, slotsFor, emptySlots } from './items.js';
import {
  dist2, closestOnPolyline, pointInPoly, polyCentroid, generateTrees, generateScatter, generateHanging,
  caveOutline,
} from './worldgen.js';
import {
  MINING, ORES, PICKAXES, oreFromModel, bestPickaxe, swingChance, swingTime,
  miningLevelFromXp, canMine,
} from './mining.js';

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

  const r = zone.river;
  if (r) {
    // Bridge frame (path-aligned deck), computed once: matches how the client
    // builds and orients the arched bridge.
    if (r.bridge && !zone._bridge) {
      const pd = segDirAt(zone.path || r.points, r.bridge.x, r.bridge.z);
      const rd = segDirAt(r.points, r.bridge.x, r.bridge.z);
      const pl = Math.hypot(pd.dx, pd.dz) || 1, rl = Math.hypot(rd.dx, rd.dz) || 1;
      const sinA = Math.min(1, Math.abs((pd.dx / pl) * (rd.dz / rl) - (pd.dz / pl) * (rd.dx / rl)));
      const L = (r.width + 2 * RIVER_BANK) / Math.max(0.5, sinA) + 9;
      zone._bridge = { cx: r.bridge.x, cz: r.bridge.z, dx: pd.dx / pl, dz: pd.dz / pl, L, deckW: 6, railHalf: 2.5 };
    }
    const B = zone._bridge;
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
    respawn: Math.round((MONSTER_TEMPLATES[spec.type].respawn || RESPAWN_TIME) * (zone.respawnMult || 1)),
    alive: true, state: 'idle', targetId: null, atkTimer: 0,
    wanderTimer: rand(1, 4), wanderDir: { x: 0, z: 0 }, respawnTimer: 0,
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
    zone._trees = generateTrees(zone);
    zone._scatter = generateScatter(zone);
    buildFarm(zone);
    zone._hanging = generateHanging(zone);
    // Any scattered ore vein becomes a minable node, addressed by its index.
    zone._veins = new Map();
    for (const o of zone._scatter) {
      const ore = oreFromModel(o.m);
      if (ore) zone._veins.set(o.i, { id: o.i, ore, x: o.x, z: o.z, depleted: 0 });
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
    p.maxHp = maxHpForLevel(p.level);
    p.hp = p.maxHp;
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
  const drops = rollLoot(m.type);
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
  send(p.ws, { t: 'skills', mining: { level: st.level, xp: p.miningXp, into: st.into, next: st.next,
    pick: st.pick } });
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
  if (Math.random() >= swingChance(vein.ore, st.level, st.power)) return false;

  const ore = ORES[vein.ore];
  p.inventory.push(ore.ore);
  vein.depleted = ore.respawn;
  send(p.ws, { t: 'event', kind: 'mined', id: vein.id, item: ore.ore, xp: ore.xp });
  grantMiningXp(p, ore.xp);
  sendBag(p);
  return true;
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
    if (mineSwing(p, vein)) p.pendingMine = null; // one ore per click, like the veins deplete
  }
}

// Depleted veins come back on their own timer.
function stepVeins() {
  for (const zone of Object.values(ZONES)) {
    for (const v of (zone._veins || new Map()).values()) {
      if (v.depleted > 0) {
        v.depleted -= DT;
        if (v.depleted <= 0) v.depleted = 0;
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
function doPlayerAttack(p, m) {
  if (p.atkTimer > 0) return;
  p.atkTimer = ATTACK_COOLDOWN;
  m.state = 'combat'; m.targetId = p.id; // monster fights back even on a miss
  const dmg = rollPlayerDamage(p.level, equipStats(p.equipment).atk); // 0 on a miss
  if (dmg > 0) m.hp -= dmg;
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
        m.atkTimer = 2.4; // slower, more deliberate monster swings
        const raw = Math.random() < MONSTER.hitChance ? Math.floor(rand(m.dmg[0], m.dmg[1] + 1)) : 0;
        const dmg = mitigate(raw, equipStats(target.equipment).def); // armour, min 1
        if (dmg > 0) { target.hp -= dmg; target.combatTimer = REGEN.combatLockout; }
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
  const step = (tx, tz, stopDist) => {
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d <= stopDist) return false;
    const yaw = Math.atan2(dx, dz);
    p.x += Math.sin(yaw) * PLAYER_SPEED * DT; p.z += Math.cos(yaw) * PLAYER_SPEED * DT;
    p.yaw = yaw; return true;
  };

  if (inp && (inp.f !== 0 || inp.r !== 0)) {
    // Manual WASD overrides click-to-move / combat.
    p.moveTo = null; p.combatId = null; p.pendingChest = null; p.pendingPickup = null; p.pendingMine = null; p.pendingGate = false;
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
  if (p.hp < p.maxHp && (safe || p.combatTimer <= 0)) {
    p.regen += DT;
    const rate = safe ? 0.35 : 1.0; // seconds per tick of healing
    if (p.regen >= rate) { p.regen = 0; p.hp = Math.min(p.maxHp, p.hp + (safe ? 6 : 2)); }
  }
  p.inSafe = safe;
}

function respawnPlayer(p) {
  const zone = zoneOf(p);
  p.x = zone.spawn.x; p.z = zone.spawn.z; p.hp = p.maxHp; p.alive = true; p.moving = false;
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
let dayTime = 0.32;              // 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk
const WEATHER_POOL = ['clear', 'clear', 'clear', 'rain', 'mist'];
let weather = 'clear';
let weatherTimer = 120;

// Main loop
let lastSnap = 0;
setInterval(() => {
  dayTime = (dayTime + DT / DAY_LENGTH) % 1;
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
        ps.push({ id: p.id, name: p.name, x: +p.x.toFixed(2), z: +p.z.toFixed(2),
          yaw: +p.yaw.toFixed(2), hp: Math.round(p.hp), maxHp: p.maxHp, level: p.level,
          xp: p.xp, xpNext: xpForLevel(p.level), gold: p.gold, alive: p.alive,
          moving: p.moving, inSafe: !!p.inSafe });
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
    rocks: zone.rocks, hazards: zone.hazards, pools: zone.pools, chests: zone.chests,
    env: zone.env, enclosed: !!zone.enclosed, ceilingY: zone.ceilingY,
    npcs: zone.npcs || [],
    trees: zone._trees || [],
    scatter: zone._scatter || [],
    hanging: zone._hanging || [],
    models: zone.models || [],
    farmBox: zone._farmBox || null,
    gate: zone.farm && zone.farm.gate ? { x: zone.farm.gate.x, z: zone.farm.gate.z, yaw: zone.farm.gate.yaw || 0, s: zone.farm.gate.s || 1 } : null,
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
          x: start.spawn.x, z: start.spawn.z, yaw: start.spawn.yaw, moving: false,
          level: 1, xp: 0, gold: 0, openedChests: new Set(),
          // Everyone starts able to mine; better pickaxes are earned.
          inventory: ['Bronze Pickaxe'],
          equipment: emptySlots(),
          miningXp: 0, pendingMine: null, mineTimer: 0,
          quests: new Map(), questDone: new Set(), questKills: {},
          questFlags: new Set(), questAnnounced: new Set(),
          maxHp: maxHpForLevel(1), hp: maxHpForLevel(1), alive: true,
          atkTimer: 0, regen: 0, combatTimer: 0, deathTimer: 0, portalCd: 0, inSafe: true,
          moveTo: null, combatId: null, pendingChest: null, pendingPickup: null, pendingGate: false, input: { f: 0, r: 0, yaw: 0 },
        };
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
