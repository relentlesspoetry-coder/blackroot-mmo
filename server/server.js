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
import {
  PLAYER, ELITE, MONSTER, MONSTER_TEMPLATES,
  maxHpForLevel, xpForLevel, rollPlayerDamage, scaledMonster, rollLoot, mitigate, REGEN,
} from './balance.js';
import { ITEMS, SLOTS, itemDef, slotOf, valueOf, equipStats } from './items.js';
import {
  QUESTS, questPayload, questProgress, canStart, recordKill, recordReach,
  consumeQuestItems,
} from './quests.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', 'client');
const PORT = process.env.PORT || 8080;

const ZONES = { darkwoods, hiddencave };
const START_ZONE = 'darkwoods';
function zoneOf(ent) { return ZONES[ent.zoneId]; }

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

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }

// Closest point on segment AB to P.
function closestOnSeg(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz || 1), 0, 1);
  return { x: ax + abx * t, z: az + abz * t };
}
function closestOnPolyline(px, pz, pts) {
  let best = null, bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const c = closestOnSeg(px, pz, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
    const d = dist2(px, pz, c.x, c.z);
    if (d < bestD) { bestD = d; best = c; }
  }
  return { ...best, dist: Math.sqrt(bestD) };
}

function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}
function polyCentroid(poly) {
  let x = 0, z = 0; for (const p of poly) { x += p.x; z += p.z; }
  return { x: x / poly.length, z: z / poly.length };
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function clearRadiusS(p) {
  if (p.kind === 'safe') return (p.r || 9) + 3;
  if (p.kind === 'boss') return 15;
  if (p.kind === 'gate') return 11;
  if (p.kind === 'cave') return 9;
  return 7;
}
// Deterministic, thinned, well-spaced trees. Authoritative so they can be solid.
function generateTrees(zone) {
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

function inSafeZone(zone, x, z) {
  for (const p of zone.pois) {
    if (p.kind === 'safe' && p.r && dist2(x, z, p.x, p.z) < p.r * p.r) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Collision: keep an entity inside bounds, out of rocks, and out of the river
// (except at the bridge).
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
    const c = closestOnPolyline(ent.x, ent.z, r.points);
    const half = r.width / 2 + radius;
    const nearBridge = dist2(ent.x, ent.z, r.bridge.x, r.bridge.z) < (r.bridge.halfWidth + 2) ** 2;
    if (c.dist < half && !nearBridge) {
      let dx = ent.x - c.x, dz = ent.z - c.z, d = Math.hypot(dx, dz);
      if (d < 1e-4) { dx = 1; dz = 0; d = 1; }
      ent.x = c.x + (dx / d) * half; ent.z = c.z + (dz / d) * half;
    }
  }

  // Trees are solid.
  for (const t of (zone._trees || [])) {
    const dx = ent.x - t.x, dz = ent.z - t.z, d = Math.hypot(dx, dz), min = 0.8 + radius;
    if (d < min && d > 1e-4) { ent.x = t.x + (dx / d) * min; ent.z = t.z + (dz / d) * min; }
  }

  // Organic boundary: keep the entity inside the zone's polygon shape.
  if (zone.boundary) {
    if (!pointInPoly(ent.x, ent.z, zone.boundary)) {
      const closed = zone.boundary.concat([zone.boundary[0]]);
      const c = closestOnPolyline(ent.x, ent.z, closed);
      if (!zone._cen) zone._cen = polyCentroid(zone.boundary);
      let dx = zone._cen.x - c.x, dz = zone._cen.z - c.z, d = Math.hypot(dx, dz) || 1;
      ent.x = c.x + (dx / d) * radius; ent.z = c.z + (dz / d) * radius;
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
    if (zone.river && closestOnPolyline(x, z, zone.river.points).dist < zone.river.width / 2 + 1) continue;
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
    respawn: MONSTER_TEMPLATES[spec.type].respawn || RESPAWN_TIME,
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
    zone._trees = generateTrees(zone);
  }
}

function populateElite(zoneId, e) {
  const elite = makeMonster({
    zoneId, type: e.type, level: e.level, name: e.name, elite: true,
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
  if (m.elite) { drops.push({ item: `${m.name} Trophy`, qty: 1 }); drops.push({ item: 'Coins', qty: Math.floor(rand(200, 400)) }); }
  for (const d of drops) {
    const ang = rand(0, Math.PI * 2), rr = rand(0, 1.4);
    dropItem(m.zoneId, m.x + Math.cos(ang) * rr, m.z + Math.sin(ang) * rr, d.item, d.qty, killer ? killer.id : null);
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
    equipment: p.equipment, stats: equipStats(p.equipment) });
  // A 'collect' objective reads straight off the inventory, so any bag change
  // can complete (or un-complete) a quest.
  sendQuests(p);
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------
function equipItem(p, name) {
  const def = itemDef(name);
  const slot = slotOf(name);
  if (!def || !slot) return;
  const idx = p.inventory.indexOf(name);
  if (idx < 0) return;                                  // must actually hold it
  if ((def.level || 1) > p.level) {
    send(p.ws, { t: 'event', kind: 'notice', text: `You need level ${def.level} to use the ${name}.` });
    return;
  }
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
        m.atkTimer = 1.2;
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
    p.moveTo = null; p.combatId = null; p.pendingChest = null; p.pendingPickup = null; p.pendingPickup = null;
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
  p.zoneId = toId;
  p.x = spawn.x; p.z = spawn.z; p.yaw = spawn.yaw || 0;
  p.input = { f: 0, r: 0, yaw: 0 }; p.moving = false; p.hazardAccum = 0;
  p.moveTo = null; p.combatId = null; p.pendingChest = null; p.pendingPickup = null;
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
      return (byZone[zid] = JSON.stringify({ t: 'snapshot', now, players: ps, monsters: ms, items,
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
          level: 1, xp: 0, gold: 0, inventory: [], openedChests: new Set(),
          equipment: { weapon: null, body: null, trinket: null },
          quests: new Map(), questDone: new Set(), questKills: {},
          questFlags: new Set(), questAnnounced: new Set(),
          maxHp: maxHpForLevel(1), hp: maxHpForLevel(1), alive: true,
          atkTimer: 0, regen: 0, combatTimer: 0, deathTimer: 0, portalCd: 0, inSafe: true,
          moveTo: null, combatId: null, pendingChest: null, pendingPickup: null, input: { f: 0, r: 0, yaw: 0 },
        };
        players.set(id, player);
        send(ws, { t: 'welcome', id, tickRate: SNAPSHOT_HZ, zone: zoneForClient(start) });
        sendBag(player); // sends the quest payload too
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
          player.combatId = m.id; player.moveTo = null; player.pendingChest = null; player.pendingPickup = null;
        }
        break;
      }
      case 'move': {
        if (!player || !player.alive) break;
        const b = zoneOf(player).bounds;
        player.moveTo = { x: clamp(Number(msg.x) || 0, b.minX, b.maxX), z: clamp(Number(msg.z) || 0, b.minZ, b.maxZ) };
        player.combatId = null; player.pendingChest = null; player.pendingPickup = null;
        break;
      }
      case 'openchest': {
        if (!player || !player.alive) break;
        player.pendingChest = String(msg.id || ''); player.combatId = null; player.moveTo = null; player.pendingPickup = null;
        break;
      }
      case 'pickup': {
        if (!player || !player.alive) break;
        player.pendingPickup = Number(msg.id); player.combatId = null; player.moveTo = null; player.pendingChest = null;
        break;
      }
      case 'equip': if (player && player.alive) equipItem(player, String(msg.item || '')); break;
      case 'unequip': if (player && player.alive) unequipItem(player, String(msg.slot || '')); break;
      case 'sell': if (player && player.alive) sellItem(player, String(msg.item || '')); break;
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
