import { PASSIVES, PASSIVE_LIMIT, PASSIVE_SLOT_LEVELS, passiveSlotLimit, passiveAvailable, sanitizePassives, restorePassives, passiveValue, passiveDirectMult, passiveWeaponMult } from './passives.js';
// Blackroot — a 3D browser MMO (vertical slice)
// Authoritative game server. All movement, combat, AI and progression are
// simulated here; the client only sends intents. Security lesson from the old
// codebase applied correctly: never trust the client.

import http from 'http';
import { createStaticHandler } from './static-host.js';
import { atomicWrite, readJson, WorldStore } from './persistence.js';
import { validMessage } from './protocol.js';
import { sceneLoading, beginSceneLoad, acceptSceneReady, heartbeatExpired } from './scene-loading.js';
import fs from 'fs';
import crypto from 'crypto';
import { promisify } from 'node:util';
const scryptAsync = promisify(crypto.scrypt);
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { blackroot } from './zones/blackroot.js';
import { spiderden } from './zones/spiderden.js';
import {
  PLAYER, ELITE, MONSTER_TEMPLATES,
  xpForLevel, xpTotalForLevel, levelForXp, xpForKill, MAX_CLASS_LEVEL, clampClassLevel, classLevelForXp, classXpForLevel, attackRoll, defenceRoll, hitChance, scaledMonster, rollLoot, REGEN,
  TICK, CLASSES, DEFAULT_CLASS, classDef, classStats, abilityCost,
  maxHit, MEDITATION, meditationHealPerTick, rollGear, STARTING_INVENTORY, MOB_ART, ALWAYS_ART } from './balance.js';
import { ITEMS, SLOTS, SLOT_INFO, DOLL, itemDef, slotOf, valueOf, equipStats, slotsFor, emptySlots, starterEquipment, stackable, bagStacks } from './items.js';
import { weaponProfile, swingSeconds, weaponRange, swingBand, resolveAttack, facing,
         MOB_ARCH, MOB_DEF, archOf, addThreat, threatOf, dropThreat, clearThreat, taunt, topThreat, decayThreat } from './combat.js';
import { BOSS_TEMPLATES, BOSS_ITEMS, maybeSpawnCluckifer, stepCluckifer, stepMinion, stepHazards, hazardList, onMinionKilled, onBossKilled } from './cluckifer.js';
import { isSpell, checkCast, castSpell, costOf, hymnTick, mitigate, braceDamageMult, onLethal, afterHit, resistsDot, monsterDmgMult, fleeStep, stepHots, stepSanctuaries, sanctuaryList } from './cleric.js';
import { isBardSpell, checkBardCast, castBard, spendSongCharges, songAmp, atkSpeedMult, castTimeMult, meditationMult, manaRegenMult, controlMult, hasBardDebuff,
  bardMonsterDmgMult, bardMonsterDefMult, bardMonsterTakenMult, bardMonsterSpeedMult, bardMonsterAtkSpeedMult, stepSongs } from './bard.js';
import {
  dist2, closestOnPolyline, mulberry32, pointInPoly, polyCentroid, generateTrees, generateScatter, generateHanging,
  onDeck, waterDepthAt, waterLevelAt, riversOf, bridgesOf, pathsOf, pathSpecsOf, closestOnPaths, terrainAt, terrainFieldAt, isSolid, isWater, terrainClearance, T_OFF, T_ROCK, T_DEEP, T_MARSH,
  caveOutline, prepareZone,
} from './worldgen.js';
import { onDeckSpan, riverWaterHalf } from '../shared/terrain.js';
import { fogDims, fogBytes, newFog, revealDisc, fogToB64, fogFromB64, sightOf, regionAt, fogCellOf } from '../shared/fog.js';
import {
  RIVER_BANK, floorHeightAt, standableAt, resolveCollision, navBlocked, lineClear,
} from './collision.js';
import {
  MINING, ORES, PICKAXES, oreFromModel, bestPickaxe, swingChance, swingTime,
  miningLevelFromXp, canMine, veinYield,
} from './mining.js';
import {
  FISHING, FISH, RODS, bestRod, fishingLevelFromXp, catchChance, castTime, fishForTier,
} from './fishing.js';
import {
  COOKING, COOKABLES, BURNT, cookingLevelFromXp, burnChance, cookableInInventory,
} from './cooking.js';

function rand(min, max) { return min + Math.random() * (max - min); }
// A player's chosen appearance (see HAIR_STYLES / OUTFITS in the client): hair
// style and outfit as indices, colours as '#rrggbb'. Anything off is dropped.
function sanitizeLook(raw) {
  // A look is a body colour and what they are wearing: one of the wardrobe's
  // 50 outfits, with optional per-slot overrides by piece name (0 = bare).
  const o = raw && typeof raw === 'object' ? raw : {};
  const col = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) ? v.toLowerCase() : d;
  const look = { hairColor: col(o.hairColor, '#4a2e1a'), skin: col(o.skin, '#cba281') };
  const n = Math.floor(Number(o.outfit));
  if (Number.isFinite(n) && n >= 1 && n <= 50) look.outfit = n;
  if (typeof o.hair === 'string' && /^(Hair_[A-Za-z]+|Bald)$/.test(o.hair)) look.hair = o.hair;
  if (typeof o.beard === 'string' && /^(Beard_[A-Za-z]+|None)$/.test(o.beard)) look.beard = o.beard;
  if (o.wear && typeof o.wear === 'object') {
    const wear = {};
    for (const slot of ['shirt', 'pants', 'hat', 'boots', 'gloves', 'cape']) {
      const v = o.wear[slot];
      if (v === 0 || v === null) wear[slot] = 0;
      else if (typeof v === 'string' && /^[A-Za-z]+_[A-Za-z0-9]+_[A-Za-z]+$/.test(v)) wear[slot] = v;
    }
    if (Object.keys(wear).length) look.wear = wear;
  }
  return look;
}

// What the character visibly wears from their equipment: pack item ids by
// wardrobe slot (top/trousers/helmet/shoulders/boots/gloves/overlayer/belt),
// drawn over the base outfit by the client. Only armour pieces carry `gear`.
// What the player's worn armour looks like: the wardrobe piece for each slot
// they have armour in. It overrides whatever their outfit puts there, so a
// Steel Chevalier cuirass really does replace the shirt they walked in wearing.
function gearOf(equipment) {
  const g = {};
  for (const name of Object.values(equipment || {})) {
    const d = name && ITEMS[name]; if (!d || !d.wear) continue;
    g[d.wear.slot] = d.wear.piece;
  }
  return g;
}
function lookOf(p) { return Object.keys(p.gear || {}).length ? { ...p.look, gear: p.gear } : p.look; }

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
import {
  QUESTS, questPayload, questProgress, canStart, recordKill, recordReach,
  consumeQuestItems, recordUse, recordTalk, objectiveProgress,
} from './quests.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(__dirname, '..', 'client');
// The modules both sides import. The browser gets them at /shared/*.
const SHARED_DIR = path.join(__dirname, '..', 'shared');
const PORT = process.env.PORT || 8080;

// One surface world -- the Dark Woods and the Killing Fields are REGIONS of
// it, not zones, so you walk between them. The Spider Den stays a zone of
// its own: a cave you descend into is a door, and the only one left.
const ZONES = { blackroot, spiderden };
const START_ZONE = 'blackroot';
function zoneOf(ent) { return ZONES[ent.zoneId]; }

// --- fog of war -------------------------------------------------------------
// A "place" is what the world map names and what counts as discovered: a region
// of a zone that has them, and the zone itself when it has none. The Dark Woods
// and the Killing Fields are two places you walk between; the Spider Den is a
// place you go through a door to reach.
function placesOf(zone) {
  if (zone.regions && zone.regions.length) return zone.regions;
  return [{ id: zone.id, name: zone.name, subtitle: zone.subtitle, bounds: zone.bounds, boundary: zone.boundary }];
}
function placeAt(zone, x, z, y) {
  return regionAt(zone, x, z, y) || placesOf(zone)[0];
}
function fogOf(p, zone) {
  const d = fogDims(zone);
  let bits = p.fog[zone.id];
  // A zone whose bounds changed gets a fresh grid rather than a misaligned one:
  // the same reason applySave puts a player back on the road when the map moved
  // under them. Better to re-walk it than to have the fog lifted off the wrong
  // ground.
  if (!bits || bits.length !== fogBytes(d)) { bits = newFog(d); p.fog[zone.id] = bits; }
  return { d, bits };
}
// Called as the player moves. Collects the cells this uncovered so the snapshot
// can send just those, and records the place for the world map.
function revealFog(p, zone) {
  const { d, bits } = fogOf(p, zone);
  // Standing still uncovers nothing, so do not walk the disc for it: the cell
  // under your feet is the whole of the state that matters here, and this runs
  // for every player on every tick.
  const cell = fogCellOf(d, p.x, p.z);
  if (cell === p._fogCell && zone.id === p._fogZone) return;
  p._fogCell = cell; p._fogZone = zone.id;

  for (const i of revealDisc(d, bits, p.x, p.z, sightOf(zone))) {
    if (p._fogNew.length >= 4000) break;      // a client that never drains cannot grow this forever
    p._fogNew.push(i);
  }
  const place = placeAt(zone, p.x, p.z, p.y);
  if (place && !p.visited.has(place.id)) {
    p.visited.add(place.id);
    p._visitedNew = true;
  }
}
// Everything the world map needs, which is the shape of each place and the
// doors between them -- never the contents, because that is what the region map
// and its fog are for.
function worldAtlas() {
  const zones = [];
  for (const [id, z] of Object.entries(ZONES)) {
    zones.push({
      id, name: z.name, bounds: z.bounds,
      places: placesOf(z).map(r => ({
        id: r.id, name: r.name, subtitle: r.subtitle || '',
        bounds: r.bounds, boundary: r.boundary || null, underground: !!r.underground,
      })),
      portals: (z.portals || []).map(q => ({ x: q.x, z: q.z, to: q.to })),
    });
  }
  return { start: START_ZONE, zones };
}
function fogPayload(p, zone) {
  const { d, bits } = fogOf(p, zone);
  p._fogNew.length = 0; p._visitedNew = false; // the full picture supersedes any pending delta
  return { zoneId: zone.id, cell: d.cell, minX: d.minX, minZ: d.minZ, w: d.w, h: d.h, bits: fogToB64(bits) };
}

// Uniformly scale a zone's layout by k (linear). Everything the server and the
// client read from the zone — bounds, boundary, POIs, paths, spawns, radii — is
// multiplied in place, and content counts grow with area so density holds. Runs
function buildWorld() {
  // An underground zone is authored as rooms and tunnels; the engine only
  // understands `boundary`, so trace the union of those shapes into one before
  // anything -- collision, walls, spawn placement -- goes looking for it.
  for (const zone of Object.values(ZONES)) {
    if (zone.cavern && !zone.boundary) {
      zone.boundary = caveOutline(zone.cavern, zone.bounds);
      console.log(`[worldgen] ${zone.name}: ${zone.cavern.rooms.length} chambers traced into `
        + `a ${zone.boundary.length}-point outline`);
    }
  }
  prepareZone(blackroot);
  // A quest objective names the place it means -- 'darkwoods', 'spiderden' --
  // and those were zone ids until the surface became one world with regions in
  // it. Fourteen objectives across eight quests then pointed at a zone that no
  // longer exists, and nothing said so: recordReach compares the objective's
  // zone against the player's, the two never matched, and the Shrine Grove
  // simply could not be reached. So a region id is resolved to the zone that
  // holds it, once, here -- the quests go on naming regions, which is what a
  // quest is actually about.
  const zoneOfRegion = {};
  for (const [zid, zn] of Object.entries(ZONES)) {
    zoneOfRegion[zid] = zid;
    for (const r of (zn.regions || [])) zoneOfRegion[r.id] = zid;
  }
  let moved = 0;
  for (const q of Object.values(QUESTS)) {
    for (const o of (q.objectives || [])) {
      if (!o.zone) continue;
      const to = zoneOfRegion[o.zone];
      if (!to) { console.error(`[quests] ${q.id}: objective names '${o.zone}', which is neither a zone nor a region`); continue; }
      if (to !== o.zone) { o.zone = to; moved++; }
    }
  }
  if (moved) console.log(`[quests] ${moved} objectives pointed at a region; resolved to its zone`);
}
buildWorld();

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
    if (!opts.passive && inSafeZone(zone, x, z)) continue;   // pens sit inside the safe village
    if (keepOut && dist2(x, z, zone.spawn.x, zone.spawn.z) < keepOut * keepOut) continue;
    if ((zone.rocks || []).some(o => dist2(x, z, o.x, o.z) < (o.r + 2) ** 2)) continue;
    if (riversOf(zone).some(r => closestOnPolyline(x, z, r.points).dist < riverWaterHalf(r.width) + 1)) continue;
    if (zone.terrain && terrainClearance(zone, x, z, c => !isSolid(c), 5) < 4) continue;
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
  const pos = spawnInRegion(zone, spec.region, { passive, cave: spec.cave });
  const id = nextId++;
  const m = {
    id, kind: 'monster', zoneId: spec.zoneId, type: spec.type,
    name: spec.name || MONSTER_TEMPLATES[spec.type].name,
    elite: !!spec.elite, level: spec.level, cave: !!spec.cave,
    roam: spec.roam, // wander leash (roamers around a camp get a wide one)
    y: spec.cave ? CAVE_FLOOR_Y : 0, // cave mobs stand on the chamber floor
    x: pos.x, z: pos.z, home: { x: pos.x, z: pos.z }, yaw: rand(0, Math.PI * 2),
    hp: stats.hp, maxHp: stats.hp, dmg: stats.dmg, speed: stats.speed,
    aggro: stats.aggro, xp: stats.xp, passive: !!MONSTER_TEMPLATES[spec.type].passive,
    evil: MONSTER_TEMPLATES[spec.type].evil || null,   // 'undead' / 'demon': what Cleric holy magic bites hardest
    // OSRS combat stats (accuracy rolls + max hit).
    atkLevel: stats.atkLevel, defLevel: stats.defLevel, atkBonus: stats.atkBonus,
    defBonus: stats.defBonus, maxHit: stats.maxHit, attackSpeed: stats.attackSpeed,
    arch: archOf(spec.type),   // how it fights: warrior, archer, caster, brute...
    threat: new Map(), abilityCd: rand(2, 6),
    respawn: spec.respawn != null ? spec.respawn : Math.round((MONSTER_TEMPLATES[spec.type].respawn || RESPAWN_TIME) * (zone.respawnMult || 1)),
    alive: true, state: 'idle', targetId: null, atkTimer: 0,
    wanderTimer: rand(1, 4), wanderDir: { x: 0, z: 0 }, respawnTimer: 0,
    editSpawnId: spec.editSpawnId || null, // links back to an editor-placed spawn region
    spec,
  };
  monsters.set(id, m);
  return m;
}

// A portal that lands you inside a wall is an entry loop, not a mistake you
// notice later: collision shoves you back toward the arch you arrived through,
// which sends you down again. The Spider Den's exit did exactly this once the
// chokepoint squeeze put rock around its mouth. So every portal's landing spot
// is checked against the world it lands in and moved if it has to be -- loudly,
// because a portal that needed moving means the terrain under it changed.
//
// This runs with populate() rather than buildWorld(): standableAt reads consts
// that are still in their temporal dead zone while buildWorld is running.
function checkPortals() {
  for (const zone of Object.values(ZONES)) {
    for (const portal of (zone.portals || [])) {
      const to = ZONES[portal.to];
      if (!to || !portal.spawn) continue;
      if (standableAt(to, portal.spawn.x, portal.spawn.z)) continue;
      let moved = null;
      for (let r = 2; r <= 40 && !moved; r += 2) {
        for (let i = 0; i < 24; i++) {
          const a = i / 24 * Math.PI * 2;
          const nx = portal.spawn.x + Math.cos(a) * r, nz = portal.spawn.z + Math.sin(a) * r;
          if (standableAt(to, nx, nz)) { moved = { x: +nx.toFixed(1), z: +nz.toFixed(1) }; break; }
        }
      }
      if (moved) {
        console.log(`[worldgen] portal into ${to.name} landed in solid ground at `
          + `(${portal.spawn.x}, ${portal.spawn.z}); moved to (${moved.x}, ${moved.z})`);
        portal.spawn.x = moved.x; portal.spawn.z = moved.z;
      } else {
        console.log(`[worldgen] !! portal into ${to.name} has nowhere to land near `
          + `(${portal.spawn.x}, ${portal.spawn.z})`);
      }
    }
  }
}

function populate() {
  for (const zoneId of Object.keys(ZONES)) {
    const zone = ZONES[zoneId];
    for (const s of (zone.spawns || [])) {
      for (let i = 0; i < s.count; i++) {
        makeMonster({ zoneId, type: s.type, level: s.level, region: { cx: s.cx, cz: s.cz, r: s.r }, cave: s.cave, roam: s.roam });
      }
    }
    for (const e of (zone.elites || [])) populateElite(zoneId, e);
    // The seamless world pre-generates these (per source zone) before the merge.
    zone._trees = zone._trees || generateTrees(zone);
    zone._scatter = zone._scatter || generateScatter(zone);
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

// ---------------------------------------------------------------------------
// World editor (Edit Mode). Player-placed objects live in a per-zone overrides
// file and merge into the live world. Edits are authoritative and gated by a key
// (?edit=<key> on the client). Rendered as individual meshes client-side so they
// can be moved/deleted one at a time.
// ---------------------------------------------------------------------------
// No default. These commands hand out any item in the game, set your level,
// teleport you and write zone files to disk -- a key checked into the repo is
// no key at all, and with accounts and trading an injected item is permanent
// and can be passed to anybody. Unset means the editor simply is not there.
const EDIT_KEY = process.env.BLACKROOT_EDIT_KEY || null;
// Constant-time-ish and null-safe: an absent key matches nothing, including a
// client that sends no key at all or sends the string "null".
const EDIT_KEY_BUF = EDIT_KEY ? Buffer.from(EDIT_KEY) : null;
function editAllowed(key) {
  if (!EDIT_KEY_BUF || typeof key !== 'string') return false;
  const buf = Buffer.from(key);
  // Compare byte lengths, not string lengths: two strings of equal UTF-16
  // length can encode to different byte counts, and timingSafeEqual throws on
  // a mismatch rather than returning false.
  if (buf.length !== EDIT_KEY_BUF.length) return false;
  return crypto.timingSafeEqual(buf, EDIT_KEY_BUF);
}
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
// Cluckifer, the secret chicken boss, and his brood (server/cluckifer.js).
Object.assign(MONSTER_TEMPLATES, BOSS_TEMPLATES);
for (const t of Object.values(BOSS_TEMPLATES)) if (!t.loot && !t.droptable) t.loot = [];
Object.assign(ITEMS, BOSS_ITEMS);
const MOB_TYPES = Object.keys(MONSTER_TEMPLATES);

// ---- Loot overrides: per mob type, an independent-roll drop table edited in
// game. Global (a type drops the same everywhere), stored in loot.overrides.json.
let LOOT_OVERRIDES = {};
const lootOverridesPath = () => path.join(__dirname, 'loot.overrides.json');
(function loadLootOverrides() { try { LOOT_OVERRIDES = JSON.parse(fs.readFileSync(lootOverridesPath(), 'utf8')) || {}; } catch { LOOT_OVERRIDES = {}; } })();
function saveLootOverrides() { try { fs.writeFileSync(lootOverridesPath(), JSON.stringify(LOOT_OVERRIDES, null, 2)); } catch (e) { console.error('saveLootOverrides:', e.message); } }
const LOOT_ITEMS = ['Coins', ...Object.keys(ITEMS)];
const lootItemOk = (name) => name === 'Coins' || Object.hasOwn(ITEMS, name);
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
  for (const p of players.values()) if (p.zoneId === zoneId && p.ws.readyState === p.ws.OPEN) sendRaw(p.ws, s);
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
checkPortals();

// ---------------------------------------------------------------------------
// Networking helpers
// ---------------------------------------------------------------------------
function sendRaw(ws, data, sceneControl = false) {
  // No backlog: transient events are omitted and durable/UI state is rebuilt
  // on readiness. This also lets the >1 MiB welcome drain without a second send.
  if (sceneLoading(ws) && !sceneControl) return;
  if (outbound) { outbound.push([ws, data, sceneControl]); return; }
  if (ws.readyState !== ws.OPEN) return;
  if (ws.bufferedAmount > 1024 * 1024) { ws.terminate(); return; }
  ws.send(data, error => { if (error) ws.terminate(); });
}
function send(ws, obj) { sendRaw(ws, JSON.stringify(obj)); }
function sendScene(p, message) {
  p.ws.sceneToken ||= crypto.randomBytes(16).toString('hex');
  message.scene = beginSceneLoad(p.ws, p.zoneId, p.ws.sceneToken);
  sendRaw(p.ws, JSON.stringify(message), true);
}
function sendSceneState(p) {
  sendBag(p); // includes current quests
  sendSkills(p); sendAbilities(p); sendStatus(p); sendPassives(p); sendObjects(p);
  send(p.ws, { t: 'fog:sync', fog: fogPayload(p, zoneOf(p)), visited: [...p.visited] });
  p._fogNew.length = 0; p._visitedNew = false;
  const party = partyOf(p);
  if (party) sendParty(party);
  else send(p.ws, { t: 'party', leader: null, members: [] });
  const trade = tradeOf(p);
  send(p.ws, trade ? tradePayload(trade, p.id) : { t: 'trade', closed: true });
  for (const [key, type] of [['partyInvite', 'party:invite'], ['duelChallenge', 'duel:challenge'], ['tradeRequest', 'trade:request']]) {
    const pending = p[key];
    send(p.ws, pending && pending.t > 0
      ? { t: type, from: pending.from, name: pending.name, seconds: pending.t }
      : { t: type, expired: true });
  }
  if (p._loginNotice) { notice(p, p._loginNotice); delete p._loginNotice; }
  notice(p, 'The world kept running while this scene loaded. Check your health and surroundings.');
}
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) if (p.ws.readyState === p.ws.OPEN) sendRaw(p.ws, s);
}
function systemChat(msg) { broadcast({ t: 'chat', from: 'System', msg, sys: true }); }
// One line of yellow text to one person. The six local `notice`/`no` closures
// that used to rebuild this payload each delegate here instead.
function notice(p, text) { if (p && p.ws) send(p.ws, { t: 'event', kind: 'notice', text }); }

// ---------------------------------------------------------------------------
// Combat & progression
// ---------------------------------------------------------------------------
function grantXp(p, amount) {
  if (!(amount > 0)) return;   // a creature you have long outgrown: no xp, and no "+0" to explain
  p.xp += amount; // Keep total XP banked, including above the current alpha class cap.
  send(p.ws, { t: 'event', kind: 'xp', amount });
  let leveled = false;
  while (p.level < classLevelForXp(p.xp)) {
    p.level++; leveled = true;
    const old = p.maxHp; p.maxHp = classStats(p.cls, p.level).hp; p.hp = Math.min(p.maxHp, p.hp + (p.maxHp - old));
    send(p.ws, { t: 'event', kind: 'levelup', level: p.level, cls: classDef(p.cls).name });
    systemChat(`${p.name} is now a level ${p.level} ${classDef(p.cls).name}!`);
  }
  if (leveled) { sendSkills(p); sendAbilities(p); }
}

// ---------------------------------------------------------------------------
// Accounts
//
// A name plus a password. The password is never stored and never logged: what
// goes on disk is a scrypt hash of it with its own random salt per account, and
// checking one is a constant-time compare so a wrong guess tells an attacker
// nothing by how long it took. Logging in with a name nobody has taken creates
// the account; logging in with one that exists has to match.
//
// NOTE: the websocket is plain ws://. On this machine that is fine, but the
// password crosses the wire in the clear, so put this behind wss:// (TLS)
// before letting anyone reach it over a network.
// ---------------------------------------------------------------------------
const DATA_DIR = process.env.BLACKROOT_DATA_DIR || path.join(__dirname, '..');
const ACCOUNT_DIR = path.join(DATA_DIR, 'accounts');
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const PASS_MIN = 6, PASS_MAX = 128;
const LOGIN_TRIES = 6;                 // wrong guesses before a name goes quiet
const LOGIN_LOCK_MS = 60 * 1000;
const loginFails = new Map();          // account slug -> { n, until }

const accountPath = (name) => path.join(ACCOUNT_DIR, saveSlug(name) + '.json');
async function hashPass(pass, salt) { return (await scryptAsync(pass, salt, SCRYPT.keylen, SCRYPT)).toString('hex'); }
function readAccount(name) {
  const a = readJson(accountPath(name));
  if (!a && fs.existsSync(accountPath(name) + '.bak')) throw new Error('Account record missing; explicit backup recovery required');
  if (a && (a.v !== 1 || a.name !== name || !/^[a-f0-9]{32}$/.test(a.salt) || !/^[a-f0-9]{128}$/.test(a.hash))) throw new Error('Invalid or conflicting account record');
  return a;
}
function writeAccount(a) { atomicWrite(accountPath(a.name), a); }
// Returns { ok: true } or { error } -- never anything derived from the stored
// password, and the same wording whether the name or the password was wrong.
async function authenticate(name, pass) {
  const slug = saveSlug(name);
  const lock = loginFails.get(slug);
  if (lock && lock.until > Date.now()) {
    return { error: `Too many attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 1000)}s.` };
  }
  if (typeof pass !== 'string' || pass.length < PASS_MIN) return { error: `Password must be at least ${PASS_MIN} characters.` };
  if (pass.length > PASS_MAX) return { error: 'That password is too long.' };
  const acct = readAccount(name);
  // saveSlug is lossy: "Bob Smith", "Bob-Smith" and "bob_smith" all key the
  // same file. Whoever registered the slug owns it, and a different spelling of
  // it is a different person -- refuse before the password is even weighed, or
  // one player's password opens another player's character.
  if (acct && acct.name !== name) {
    return { error: 'That name is too close to an existing character. Pick another.' };
  }
  if (!acct) {
    const salt = crypto.randomBytes(16).toString('hex');
    writeAccount({ v: 1, name, salt, hash: await hashPass(pass, salt), created: Date.now() });
    return { ok: true, created: true };
  }
  const got = Buffer.from(await hashPass(pass, acct.salt), 'hex');
  const want = Buffer.from(acct.hash, 'hex');
  const good = got.length === want.length && crypto.timingSafeEqual(got, want);
  if (!good) {
    const f = loginFails.get(slug) || { n: 0, until: 0 };
    f.n++; if (f.n >= LOGIN_TRIES) { f.until = Date.now() + LOGIN_LOCK_MS; f.n = 0; }
    if (loginFails.size >= 10000) loginFails.delete(loginFails.keys().next().value);
    loginFails.set(slug, f);
    return { error: 'That name is taken, and the password does not match it.' };
  }
  loginFails.delete(slug);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Saved characters
//
// A character is its name. Log in with a name that has been here before and
// you get that character back -- where you stood, what you carried, what you
// had learned and how far through every errand you were. Account passwords
// authenticate access before the durable character is restored.
//
// Session combat state is dropped. Ownership is checkpointed across every
// character, grave and ground item together; pending trade escrow is refunded
// to its original owner in the durable representation.
// ---------------------------------------------------------------------------
// Beside the repo, not beside whatever directory the process happens to have
// been started from -- the same anchor CLIENT_DIR uses.
const SAVE_DIR = path.join(DATA_DIR, 'saves');
const worldStore = new WorldStore(SAVE_DIR);
const SAVE_EVERY = 45;                 // seconds between background saves
const saveSlug = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) || 'adventurer';
const savePath = (name) => path.join(SAVE_DIR, saveSlug(name) + '.json');

function serialisePlayer(p) {
  return {
    v: 1, name: p.name, cls: p.cls, look: p.look,
    zoneId: p.zoneId, x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: p.y || 0, yaw: +p.yaw.toFixed(2),
    level: p.level, xp: p.xp, gold: p.gold,
    hp: Math.round(p.hp), mana: Math.round(p.mana || 0),
    inventory: p.inventory.slice(), equipment: { ...p.equipment },
    known: [...p.known], passives: sanitizePassives(p, p.passives),
    miningXp: p.miningXp, fishingXp: p.fishingXp, cookingXp: p.cookingXp,
    meditation: { ...p.meditation },
    // Quests: the live map of progress, plus everything already finished and
    // every flag and kill tally the objectives read from.
    quests: [...p.quests.entries()],
    questDone: [...p.questDone], questKills: p.questKills,
    questFlags: [...p.questFlags], questAnnounced: [...p.questAnnounced],
    openedChests: [...p.openedChests], usedObjects: [...p.usedObjects],
    // The map you come back to is the map you left: the ground seen in each
    // zone, and the places named on the world map.
    fog: Object.fromEntries(Object.entries(p.fog || {}).map(([id, bits]) => [id, fogToB64(bits)])),
    visited: [...(p.visited || [])],
    savedAt: Date.now(),
  };
}
// savePlayer stages a departing player; commitWorld writes ALL owners together.
function savePlayer(p) {
  if (p && p.name) { worldStore.state.characters[p.name] = durablePlayer(p); checkpointRequested = true; }
}
function loadSave(name) { return Object.hasOwn(worldStore.state.characters, name) ? worldStore.state.characters[name] : null; }
function durablePlayer(p) {
  const d = serialisePlayer(p), t = tradeOf(p);
  // Pending trades are canceled on recovery: escrow is owned by its offerer.
  if (t) { d.inventory.push(...(t.items[p.id] || [])); d.gold += t.gold[p.id] || 0; }
  return d;
}
// A lightweight projection for dirty detection. In particular, do not encode
// fog or build a full character save on every input packet and simulation tick.
// Escrow has exactly the same canonical ownership here and in durablePlayer.
function ownershipOf(p, live = false) {
  const t = live ? tradeOf(p) : null;
  return [t ? p.inventory.concat(t.items[p.id] || []) : p.inventory,
    p.equipment, p.gold + (t ? t.gold[p.id] || 0 : 0),
    [...p.known], p.passives || [], p.xp, p.miningXp, p.fishingXp, p.cookingXp,
    [...(p.quests || [])], [...(p.questDone || [])], [...(p.questFlags || [])], p.questKills, p.meditation,
    [...(p.visited || [])], [...(p.openedChests || [])], [...(p.usedObjects || [])]];
}
let lastOwnership = '', lastCheckpoint = 0, checkpointRequested = false;
function commitWorld(force = false) {
  const owned = Object.fromEntries(Object.entries(worldStore.state.characters).map(([name, d]) => [name, ownershipOf(d)]));
  for (const p of players.values()) Object.defineProperty(owned, p.name, { value: ownershipOf(p, true), enumerable: true, writable: true, configurable: true });
  // Movement, regen, fog and timer decrements need only periodic persistence;
  // any ownership/progression transition commits the complete world immediately.
  const ownership = JSON.stringify({ characters: owned,
    graves: [...graves.values()].map(({ ttl, owner, ...g }) => g),
    groundItems: [...groundItems.values()].map(({ ttl, owner, ...g }) => g) });
  if (!force && !checkpointRequested && ownership === lastOwnership && Date.now() - lastCheckpoint < SAVE_EVERY * 1000) return;
  // Full serialization, including fog, happens only on the actual write path.
  const characters = { ...worldStore.state.characters };
  for (const p of players.values()) Object.defineProperty(characters, p.name, { value: durablePlayer(p), enumerable: true, writable: true, configurable: true });
  const state = { v: 1, characters, graves: [...graves.values()].map(g => ({ ...g, owner: null })),
    groundItems: [...groundItems.values()].map(g => ({ ...g, owner: null })) };
  worldStore.commit(state); checkpointRequested = false; lastOwnership = ownership; lastCheckpoint = Date.now();
}
let outbound = null;
function transaction(fn) {
  if (outbound) return fn();
  outbound = [];
  try {
    const result = fn(); commitWorld();
    const messages = outbound; outbound = null;
    for (const [ws, data, sceneControl] of messages) sendRaw(ws, data, sceneControl);
    return result;
  } catch (error) {
    // Never checkpoint a partially executed operation or acknowledge it. A
    // restart recovers the last complete generation, including both owners.
    outbound = null; console.error('[transaction] fail closed:', error);
    process.exit(1);
  }
}
// Put a loaded save onto a freshly built player. The player is built first with
// all its defaults so anything a save predates simply keeps the new default.
function applySave(p, d) {
  const zone = Object.hasOwn(ZONES, d.zoneId) ? d.zoneId : START_ZONE;
  p.cls = Object.hasOwn(CLASSES, d.cls) ? d.cls : p.cls;
  if (d.look) p.look = sanitizeLook(d.look);
  p.zoneId = zone;
  p.level = clampClassLevel(d.level);
  p.xp = Math.max(0, +d.xp || 0);
  p.gold = Math.max(0, Math.floor(d.gold));
  const cs = classStats(p.cls, p.level);
  p.maxHp = cs.hp; p.manaMax = cs.mana; p.rageMax = cs.rage;
  // Somebody who logged out dead comes back on their feet at the zone's spawn
  // rather than face down where they fell.
  const dead = !(d.hp > 0);
  p.hp = dead ? p.maxHp : Math.min(p.maxHp, d.hp);
  p.mana = Math.min(p.manaMax || 0, Math.max(0, d.mana | 0));
  // Somebody who logged out dead comes back at the graveyard of the place they
  // went down in, the same as anyone who dies and waits it out -- not at the
  // zone's arrival point, which in a two-region world is the wrong region half
  // the time. Their saved position is where they fell, so it names the place.
  const zrec = ZONES[zone];
  const fellIn = dead ? placeAt(zrec, +d.x || zrec.spawn.x, +d.z || zrec.spawn.z, +d.y || 0) : null;
  const sp = (dead && fellIn && fellIn.graveyard) || zrec.graveyard || zrec.spawn;
  p.x = dead ? sp.x : (+d.x || sp.x); p.z = dead ? sp.z : (+d.z || sp.z);
  p.y = dead ? 0 : (+d.y || 0); p.yaw = +d.yaw || sp.yaw;
  // A save holds where you stood on the map as it was. Redraw the map -- move a
  // river, raise a cliff, change the coastline -- and that spot may now be open
  // water, solid rock or outside the world. Rather than drop somebody into it,
  // put them back at the zone's arrival point.
  if (!dead && !standableAt(ZONES[zone], p.x, p.z)) {
    p.x = sp.x; p.z = sp.z; p.y = 0; p.yaw = sp.yaw || 0;
    p._movedByRevamp = true;
  }
  p.inventory = Array.isArray(d.inventory) ? d.inventory.filter(n => Object.hasOwn(ITEMS, n)) : p.inventory;
  if (d.equipment) { p.equipment = emptySlots(); for (const slot of Object.keys(p.equipment)) { const item = d.equipment[slot]; if (typeof item === 'string' && Object.hasOwn(ITEMS, item) && slotsFor(slotOf(item)).includes(slot)) p.equipment[slot] = item; } p.gear = gearOf(p.equipment); }
  // Only starting abilities are free. Restore valid purchased abilities,
  // never silently unlock every trainer skill eligible at this level.
  p.known = new Set(classDef(p.cls).abilities.filter(a => a.level <= 1).map(a => a.id));
  for (const id of (d.known || [])) if (classDef(p.cls).abilities.some(a => a.id === id && a.level <= p.level)) p.known.add(id);
  p.passives = restorePassives(p, d.passives);
  p.miningXp = +d.miningXp || 0; p.fishingXp = +d.fishingXp || 0; p.cookingXp = +d.cookingXp || 0;
  if (d.meditation) p.meditation = { level: d.meditation.level | 0 || 1, xp: +d.meditation.xp || 0 };
  // Fog is restored per zone and only where the grid still fits: a zone whose
  // bounds moved gets a blank one rather than a picture lifted off the wrong
  // ground (fogOf drops a mismatched grid the same way).
  p.fog = {};
  for (const [zid, b64] of Object.entries(d.fog || {})) {
    if (!Object.hasOwn(ZONES, zid)) continue;
    p.fog[zid] = fogFromB64(b64, fogBytes(fogDims(ZONES[zid])));
  }
  p.visited = new Set((d.visited || []).filter(v => typeof v === 'string'));
  p.quests = new Map((d.quests || []).filter(([id]) => Object.hasOwn(QUESTS, id)));
  p.questDone = new Set((d.questDone || []).filter(id => Object.hasOwn(QUESTS, id)));
  p.questKills = d.questKills && typeof d.questKills === 'object' ? d.questKills : {};
  p.questFlags = new Set(d.questFlags || []);
  p.questAnnounced = new Set(d.questAnnounced || []);
  p.openedChests = new Set(d.openedChests || []);
  p.usedObjects = new Set(d.usedObjects || []);
}

// ---------------------------------------------------------------------------
// Trading
//
// Two people, two offers, and nothing moves until both have said yes. What an
// offer holds has actually left the bag -- it sits in escrow on the trade and
// comes straight back if anything goes wrong -- so the same sword cannot be
// offered to two people, or sold out from under a trade half way through.
//
// Changing either offer clears both acceptances. That is the old rule from
// every game that ever had a trade window, and it exists because the alternative
// is somebody swapping the gold for a rock while your finger is over the button.
// ---------------------------------------------------------------------------
const trades = new Map();              // id -> { id, a, b, items: {}, gold: {}, ok: {} }
let nextTradeId = 1;
const TRADE_REQUEST_TTL = 30;
const TRADE_START_RANGE = 12;          // how close you must be to ask
const TRADE_BREAK_RANGE = 16;          // how far apart calls it off

// A closed socket may leave a combat body in the world; it cannot consent.
function interactionReady(p) { return !!p && p.alive && p.lingerT == null && !!p.ws && p.ws.readyState === p.ws.OPEN; }
function tradePairValid(a, b, range) {
  return interactionReady(a) && interactionReady(b) && a !== b && a.zoneId === b.zoneId
    && !duelOf(a) && !duelOf(b) && dist2(a.x, a.z, b.x, b.z) <= range * range;
}
function tradeOf(p) { return (p && p.tradeId && trades.get(p.tradeId)) || null; }
function tradePair(t) { return [players.get(t.a), players.get(t.b)]; }
function tradePayload(t, forId) {
  const other = t.a === forId ? t.b : t.a;
  const who = players.get(other);
  return { t: 'trade', with: other, name: who ? who.name : '',
    mine: bagStacks(t.items[forId] || []), theirs: bagStacks(t.items[other] || []),
    myGold: t.gold[forId] || 0, theirGold: t.gold[other] || 0,
    myOk: !!t.ok[forId], theirOk: !!t.ok[other] };
}
function sendTrade(t) { for (const q of tradePair(t)) if (q && q.ws.readyState === q.ws.OPEN) send(q.ws, tradePayload(t, q.id)); }
// Any change to what is on the table puts both acceptances back to nothing.
function tradeTouched(t) { t.ok[t.a] = false; t.ok[t.b] = false; }

function tradeRequest(from, toId) {
  const to = players.get(Number(toId));
  const no = (text) => notice(from, text);
  if (!to || to === from) return no('There is nobody there to trade with.');
  if (to.zoneId !== from.zoneId) return no(`${to.name} is not in this zone.`);
  if (!from.alive || !to.alive) return no('Not while one of you is dead.');
  if (tradeOf(from) || tradeOf(to)) return no('One of you is already trading.');
  if (duelOf(from) || duelOf(to)) return no('Not in the middle of a duel.');
  if (dist2(from.x, from.z, to.x, to.z) > TRADE_START_RANGE * TRADE_START_RANGE) return no(`${to.name} is too far away.`);
  if (to.tradeRequest && to.tradeRequest.t > 0) return no(`${to.name} is already being asked.`);
  to.tradeRequest = { from: from.id, name: from.name, t: TRADE_REQUEST_TTL };
  send(to.ws, { t: 'trade:request', from: from.id, name: from.name, seconds: TRADE_REQUEST_TTL });
  no(`You ask ${to.name} to trade.`);
}
function tradeAccept(p) {
  const rq = p.tradeRequest; p.tradeRequest = null;
  if (!rq || rq.t <= 0) return send(p.ws, { t: 'event', kind: 'notice', text: 'That offer to trade has lapsed.' });
  const from = players.get(rq.from);
  if (!tradePairValid(from, p, TRADE_START_RANGE)) return notice(p, 'They are in no state to trade, or too far away.');
  if (tradeOf(from) || tradeOf(p)) return send(p.ws, { t: 'event', kind: 'notice', text: 'One of you is already trading.' });
  const t = { id: nextTradeId++, a: from.id, b: p.id, items: { [from.id]: [], [p.id]: [] }, gold: { [from.id]: 0, [p.id]: 0 }, ok: {} };
  trades.set(t.id, t); from.tradeId = t.id; p.tradeId = t.id;
  sendTrade(t);
}
function tradeDecline(p) {
  const rq = p.tradeRequest; p.tradeRequest = null;
  if (!rq) return;
  const from = players.get(rq.from);
  if (from) send(from.ws, { t: 'event', kind: 'notice', text: `${p.name} does not want to trade.` });
}
// Put one of something on the table: it leaves the bag now, not at the end.
function tradeAdd(p, name) {
  const t = tradeOf(p); if (!t) return;
  const i = p.inventory.indexOf(String(name)); if (i < 0) return;
  p.inventory.splice(i, 1);
  t.items[p.id].push(String(name));
  tradeTouched(t); sendBag(p); sendTrade(t);
}
function tradeTake(p, name) {
  const t = tradeOf(p); if (!t) return;
  const i = t.items[p.id].indexOf(String(name)); if (i < 0) return;
  t.items[p.id].splice(i, 1);
  p.inventory.push(String(name));
  tradeTouched(t); sendBag(p); sendTrade(t);
}
function tradeGold(p, n) {
  const t = tradeOf(p); if (!t) return;
  const want = Math.max(0, Math.floor(Number(n) || 0));
  const pool = (t.gold[p.id] || 0) + p.gold;          // what is on the table plus what is in the purse
  const set = Math.min(want, pool);
  p.gold = pool - set; t.gold[p.id] = set;
  tradeTouched(t); sendBag(p); sendTrade(t);
}
function tradeOk(p, on) {
  const t = tradeOf(p); if (!t) return;
  t.ok[p.id] = !!on;
  if (t.ok[t.a] && t.ok[t.b]) return tradeCommit(t);
  sendTrade(t);
}
// Both said yes. Everything is already in escrow, so this is just handing each
// pile to the other person -- there is nothing left that can fail half way.
function tradeCommit(t) {
  const [a, b] = tradePair(t);
  if (!trades.has(t.id)) return;
  if (!tradePairValid(a, b, TRADE_BREAK_RANGE)) return tradeCancel(t, 'The trade fell through.');
  for (const [from, to] of [[a, b], [b, a]]) {
    for (const name of t.items[from.id]) to.inventory.push(name);
    to.gold += t.gold[from.id] || 0;
  }
  trades.delete(t.id);
  for (const q of [a, b]) { q.tradeId = null; send(q.ws, { t: 'trade', closed: true }); sendBag(q); send(q.ws, { t: 'event', kind: 'notice', text: 'The trade is done.' }); }
}
// However it ends short, everything goes back where it came from.
function tradeCancel(t, why) {
  if (!t || !trades.has(t.id)) return;
  trades.delete(t.id);
  for (const q of tradePair(t)) {
    if (!q) continue;
    q.tradeId = null;
    for (const name of (t.items[q.id] || [])) q.inventory.push(name);
    q.gold += t.gold[q.id] || 0;
    send(q.ws, { t: 'trade', closed: true }); sendBag(q);
    send(q.ws, { t: 'event', kind: 'notice', text: why || 'The trade is off.' });
  }
}
function tradeAbort(p, why) { const t = tradeOf(p); if (t) tradeCancel(t, why || `${p.name} called the trade off.`); }
function stepTrades() {
  for (const t of [...trades.values()]) {
    const [a, b] = tradePair(t);
    if (!tradePairValid(a, b, TRADE_BREAK_RANGE)) tradeCancel(t, 'The trade is off: you can no longer trade.');
  }
}

// ---------------------------------------------------------------------------
// Duels
//
// A duel is a fight between two players that nobody dies in. It borrows the
// whole of the existing combat path -- weapon speed, the attack table, the
// swing and its impact frame, every single-target ability -- by letting an
// opponent stand in wherever that code expects a monster. The two places that
// had to know the difference are applyHit, which is the one door all player
// damage goes through, and the target lookup, which used to read straight out
// of the monsters map.
//
// Nobody dies: at a tenth of their health the loser yields, both are put back
// to full, and neither drops so much as a copper.
// ---------------------------------------------------------------------------
const duels = new Map();               // id -> { id, a, b, state, t, zoneId }
let nextDuelId = 1;
const DUEL_YIELD = 0.10;               // yield at a tenth of your health
const DUEL_COUNTDOWN = 3;              // seconds of salute before it starts
const DUEL_CHALLENGE_TTL = 30;
const DUEL_START_RANGE = 20;           // how close you must be to challenge
const DUEL_BREAK_RANGE = 50;           // how far apart ends it

function duelOf(p) { return (p && p.duelId && duels.get(p.duelId)) || null; }
function duelFoe(p) {
  const d = duelOf(p); if (!d || d.state !== 'fighting') return null;
  return players.get(d.a === p.id ? d.b : d.a) || null;
}
// The thing this player is fighting, whether it breathes fire or pays tax.
function combatTargetOf(p) {
  if (p.combatId == null) return null;
  const m = monsters.get(p.combatId);
  if (m) return m;
  const foe = duelFoe(p);
  return foe && foe.id === p.combatId ? foe : null;
}
function duelPair(d) { return [players.get(d.a), players.get(d.b)]; }
function duelSay(d, text) { for (const q of duelPair(d)) if (q) send(q.ws, { t: 'event', kind: 'notice', text }); }

function inPveCombat(p) {
  return p.combatId != null || (p.combatTimer || 0) > 0
    || (p.engagedWith != null && (p.engagedT || 0) > 0);
}
function duelPairReady(a, b, range) {
  return interactionReady(a) && interactionReady(b) && a !== b && a.zoneId === b.zoneId
    && !tradeOf(a) && !tradeOf(b) && !inPveCombat(a) && !inPveCombat(b)
    && dist2(a.x, a.z, b.x, b.z) <= range * range;
}
function duelChallenge(from, toId) {
  const to = players.get(Number(toId));
  const no = (text) => notice(from, text);
  if (!to || to === from) return no('There is nobody there to challenge.');
  if (to.zoneId !== from.zoneId) return no(`${to.name} is not in this zone.`);
  if (!from.alive || !to.alive) return no('Not while one of you is dead.');
  if (duelOf(from) || duelOf(to)) return no('One of you is already in a duel.');
  if (!duelPairReady(from, to, DUEL_START_RANGE)) return no('You cannot duel while fighting, trading, disconnected, or too far apart.');
  if (dist2(from.x, from.z, to.x, to.z) > DUEL_START_RANGE * DUEL_START_RANGE) return no(`${to.name} is too far away.`);
  if (to.duelChallenge && to.duelChallenge.t > 0) return no(`${to.name} has already been challenged.`);
  to.duelChallenge = { from: from.id, name: from.name, t: DUEL_CHALLENGE_TTL };
  send(to.ws, { t: 'duel:challenge', from: from.id, name: from.name, seconds: DUEL_CHALLENGE_TTL });
  no(`You challenge ${to.name} to a duel.`);
}
function duelAccept(p) {
  const ch = p.duelChallenge; p.duelChallenge = null;
  if (!ch || ch.t <= 0) return send(p.ws, { t: 'event', kind: 'notice', text: 'That challenge has lapsed.' });
  const from = players.get(ch.from);
  if (!duelPairReady(from, p, DUEL_START_RANGE)) return notice(p, 'You can no longer start this duel.');
  if (duelOf(from) || duelOf(p)) return send(p.ws, { t: 'event', kind: 'notice', text: 'One of you is already in a duel.' });
  const d = { id: nextDuelId++, a: from.id, b: p.id, state: 'countdown', t: DUEL_COUNTDOWN, zoneId: p.zoneId };
  duels.set(d.id, d); from.duelId = d.id; p.duelId = d.id;
  for (const q of duelPair(d)) if (q) { q.combatId = null; q.swing = null; q.queued = null; }
  broadcast({ t: 'event', kind: 'duelstart', a: d.a, b: d.b, names: [from.name, p.name], seconds: DUEL_COUNTDOWN });
  duelSay(d, `${from.name} and ${p.name} step up to duel.`);
}
function duelDecline(p) {
  const ch = p.duelChallenge; p.duelChallenge = null;
  if (!ch) return;
  const from = players.get(ch.from);
  if (from) send(from.ws, { t: 'event', kind: 'notice', text: `${p.name} declined your challenge.` });
}
// A started duel restores both players. Cancelling the salute must not heal
// anyone or erase PvE combat that began during the countdown.
function duelEnd(d, winnerId, how) {
  if (!duels.has(d.id)) return;
  duels.delete(d.id);
  const [a, b] = duelPair(d);
  for (const q of [a, b]) {
    if (!q) continue;
    q.duelId = null;
    if (d.state !== 'fighting') continue;
    q.swing = null; q.queued = null;
    if (q.combatId != null && (q.combatId === d.a || q.combatId === d.b)) q.combatId = null;
    if (q.alive) { q.hp = q.maxHp; if (q.manaMax) q.mana = q.manaMax; q.rage = 0; q.combatTimer = 0; sendStatus(q); }
  }
  const win = winnerId != null ? players.get(winnerId) : null;
  const lose = win ? (win.id === d.a ? b : a) : null;
  if (win && lose) systemChat(`${win.name} wins the duel against ${lose.name}.`);
  else systemChat(how || 'The duel is over.');
  broadcast({ t: 'event', kind: 'duelend', a: d.a, b: d.b, winner: winnerId != null ? winnerId : undefined });
}
function duelForfeit(p, how) {
  const d = duelOf(p); if (!d) return;
  const other = d.a === p.id ? d.b : d.a;
  duelEnd(d, d.state === 'fighting' ? other : null, how || `${p.name} withdraws from the duel.`);
}
// A duelling opponent's defensive sheet: their own kit and class, not a
// monster archetype. A shield in the off hand is a shield in a duel too.
function playerDefence(t, from) {
  const eq = equipStats(t.equipment), cs = classStats(t.cls, t.level);
  const shield = !!(t.equipment && t.equipment.offhand);
  return {
    level: cs.def || t.level,
    dodge: 0.05, parry: 0.06, block: shield ? 0.22 : 0,
    blockAmt: shield ? Math.round(3 + t.level * 1.4) : 0,
    armour: eq.def || 0,
    facing: from ? facing(t.x, t.z, t.yaw, from.x, from.z) : true,
  };
}
// A blow landed on a duelling opponent. Never lethal: the moment it would take
// them under the yield line the duel is over and they are put back together.
function duelHit(p, t, dmg, crit, kind, res) {
  const d = duelOf(p);
  if (!d || d.state !== 'fighting') return;
  p.lastCombat = Date.now(); p.combatTimer = REGEN.combatLockout;
  dmg = Math.max(0, Math.round(dmg * braceDamageMult(t) * passiveDirectMult(t)));
  const floor = Math.max(1, Math.round(t.maxHp * DUEL_YIELD));
  let done = false;
  if (dmg > 0) {
    if (t.hp - dmg <= floor) { dmg = Math.max(0, t.hp - floor); done = true; }
    t.hp -= dmg;
    t.combatTimer = REGEN.combatLockout; t.lastCombat = Date.now();
    if (classDef(t.cls).rage) addRage(t, dmg * classDef(t.cls).rage.damageTaken);
    if (classDef(p.cls).rage) addRage(p, (classDef(p.cls).rage || {}).autoHit || 0);
  }
  broadcast({ t: 'event', kind: 'hit', by: p.id, target: t.id, dmg, crit: !!crit, targetKind: 'player',
              hitKind: kind || null, res: res ? res.outcome : (dmg > 0 ? 'hit' : 'miss'), blocked: (res && res.blocked) || 0, duel: 1 });
  if (crit) { savageTrigger(p); procOnCrit(p); }
  if (done) duelEnd(d, p.id);
}
function stepDuels(dt) {
  for (const d of [...duels.values()]) {
    const [a, b] = duelPair(d);
    if (!a || !b) { duelEnd(d, null, 'The duel is called off.'); continue; }
    if (d.state === 'countdown' && (!duelPairReady(a, b, DUEL_START_RANGE) || a.zoneId !== d.zoneId)) {
      duelEnd(d, null, 'The duel is called off before the fight.'); continue;
    }
    if (!a.alive || !b.alive) { duelEnd(d, a.alive ? a.id : b.id, null); continue; }
    if (a.zoneId !== b.zoneId) { duelEnd(d, null, `${a.name} and ${b.name} part without a winner.`); continue; }
    if (dist2(a.x, a.z, b.x, b.z) > DUEL_BREAK_RANGE * DUEL_BREAK_RANGE) { duelEnd(d, null, `${a.name} and ${b.name} lose each other, and the duel with it.`); continue; }
    if (d.state === 'countdown') {
      d.t -= dt;
      if (d.t <= 0) { d.state = 'fighting'; duelSay(d, 'Fight!'); broadcast({ t: 'event', kind: 'duelgo', a: d.a, b: d.b }); }
    }
  }
}

// ---------------------------------------------------------------------------
// Sitting down
//
// A stool is sat on, a bed is lain on. The server owns it so that everyone in
// the room sees you in the chair, and so that the first thing you do -- move,
// swing, cast, get hit -- puts you back on your feet.
// ---------------------------------------------------------------------------
const SEAT_REACH = 1.9;
// Every seat in a zone: the stools and beds inside houses, and the bedrolls
// laid out in the camps. A bedroll is a bed on the floor, so it gets the same
// treatment with a different lift.
function zoneSeats(zone) {
  if (zone._seats) return zone._seats;
  zone._seats = [];
  const SEAT_PROP = { Bedroll: 'bedroll', 'props/Bedroll': 'bedroll', Camp_Stool: 'stool', 'props/Camp_Stool': 'stool' };
  for (const pr of (zone.props || [])) {
    const k = SEAT_PROP[pr.m]; if (!k) continue;
    zone._seats.push({ id: `${k}:${zone._seats.length}`, k, x: pr.x, z: pr.z, yaw: pr.yaw || 0 });
  }
  return zone._seats;
}
function seatById(zone, id) { return zoneSeats(zone).find(s => s.id === id) || null; }
// Where you stand to use it: on the stool itself, or beside the bed at the
// foot end so lying down does not walk you through the headboard.
function seatApproach(seat) {
  if (seat.k === 'stool') return { x: seat.x, z: seat.z };
  return { x: seat.x + Math.sin(seat.yaw) * 1.25, z: seat.z + Math.cos(seat.yaw) * 1.25 };
}
function sitDown(p, seat) {
  p.seat = { id: seat.id, k: seat.k, x: seat.x, z: seat.z, yaw: seat.yaw };
  p.x = seat.x; p.z = seat.z;
  // A bed is lain along its length, so the body turns a quarter across the
  // furniture's own facing to put the head on the pillow.
  p.yaw = seat.k === 'stool' ? seat.yaw : seat.yaw + Math.PI / 2;
  p.moveTo = null; p._nav = null; p.combatId = null;
  send(p.ws, { t: 'event', kind: 'notice', text: seat.k === 'stool' ? 'You sit down.' : 'You lie down.' });
}
function standUp(p, quiet) {
  if (!p.seat) return;
  const was = p.seat; p.seat = null; p.pendingSeat = null;
  if (was.k !== 'stool') { p.x = was.x + Math.sin(was.yaw) * 1.25; p.z = was.z + Math.cos(was.yaw) * 1.25; }
  if (!quiet) send(p.ws, { t: 'event', kind: 'notice', text: 'You get up.' });
}

// ---------------------------------------------------------------------------
// Parties
//
// A party is a handful of players who share what they kill. It is deliberately
// thin: a leader, a member list, and an invite that expires if nobody answers.
// Everything else -- who can see whose health, who gets the xp -- reads off
// those three facts.
// ---------------------------------------------------------------------------
const parties = new Map();            // id -> { id, leader, members: [playerId] }
let nextPartyId = 1;
const PARTY_MAX = 5;
const PARTY_INVITE_TTL = 30;          // seconds before an unanswered invite lapses
const PARTY_SHARE_RANGE = 80;         // how far a member can be and still share a kill

function partyOf(p) { return (p && p.partyId && parties.get(p.partyId)) || null; }
function partyMembers(party) { return (party ? party.members : []).map(id => players.get(id)).filter(Boolean); }
// Everything a client needs to draw the party: who is in it, in what order, and
// how each of them is doing. Sent to every member whenever any of that changes.
function partyPayload(party) {
  if (!party) return { t: 'party', members: [] };
  return { t: 'party', leader: party.leader, members: partyMembers(party).map(m => ({
    id: m.id, name: m.name, cls: m.cls, level: m.level, hp: Math.round(m.hp), maxHp: m.maxHp,
    mana: m.manaMax ? Math.round(m.mana || 0) : undefined, manaMax: m.manaMax || undefined,
    alive: m.alive, zoneId: m.zoneId })) };
}
// One payload, sent raw to each member -- send() would stringify it a second
// time and the client would parse a string with no message type on it.
function sendParty(party) {
  const pay = JSON.stringify(partyPayload(party));
  for (const m of partyMembers(party)) if (m.ws.readyState === m.ws.OPEN) sendRaw(m.ws, pay);
}
function partyNotice(party, text) { for (const m of partyMembers(party)) send(m.ws, { t: 'event', kind: 'notice', text }); }

function clearPartyInvitesFrom(id) {
  for (const q of players.values()) if (q.partyInvite?.from === id) q.partyInvite = null;
}
function partyInvite(from, toId) {
  const to = players.get(Number(toId));
  if (!to || to === from) return send(from.ws, { t: 'event', kind: 'notice', text: 'There is nobody there to invite.' });
  if (to.zoneId !== from.zoneId) return send(from.ws, { t: 'event', kind: 'notice', text: `${to.name} is not in this zone.` });
  if (partyOf(to)) return send(from.ws, { t: 'event', kind: 'notice', text: `${to.name} is already in a party.` });
  const mine = partyOf(from);
  if (mine && mine.leader !== from.id) return send(from.ws, { t: 'event', kind: 'notice', text: 'Only the party leader can invite.' });
  if (mine && mine.members.length >= PARTY_MAX) return send(from.ws, { t: 'event', kind: 'notice', text: 'Your party is full.' });
  if (to.partyInvite && to.partyInvite.t > 0) return send(from.ws, { t: 'event', kind: 'notice', text: `${to.name} already has an invitation pending.` });
  to.partyInvite = { from: from.id, partyId: mine ? mine.id : null, name: from.name, t: PARTY_INVITE_TTL };
  send(to.ws, { t: 'party:invite', from: from.id, name: from.name, seconds: PARTY_INVITE_TTL });
  send(from.ws, { t: 'event', kind: 'notice', text: `You invite ${to.name} to your party.` });
}
function partyAccept(p) {
  const inv = p.partyInvite; p.partyInvite = null;
  if (!inv || inv.t <= 0) return send(p.ws, { t: 'event', kind: 'notice', text: 'That invitation has lapsed.' });
  const from = players.get(inv.from);
  if (!from) return send(p.ws, { t: 'event', kind: 'notice', text: 'They are no longer here.' });
  if (partyOf(p)) return send(p.ws, { t: 'event', kind: 'notice', text: 'You are already in a party.' });
  let party = partyOf(from);
  if ((party ? party.id : null) !== inv.partyId || (party && party.leader !== from.id)) return notice(p, 'That party invitation is no longer valid.');
  if (!party) {   // the inviter's party starts the moment someone says yes
    party = { id: nextPartyId++, leader: from.id, members: [from.id] };
    parties.set(party.id, party); from.partyId = party.id;
    // Other invitations from this solo leader now refer to this same party.
    for (const q of players.values()) if (q.partyInvite?.from === from.id && q.partyInvite.partyId === null) q.partyInvite.partyId = party.id;
  }
  if (party.members.length >= PARTY_MAX) return send(p.ws, { t: 'event', kind: 'notice', text: 'That party is full.' });
  clearPartyInvitesFrom(p.id);
  party.members.push(p.id); p.partyId = party.id;
  partyNotice(party, `${p.name} has joined the party.`);
  sendParty(party);
}
function partyDecline(p) {
  const inv = p.partyInvite; p.partyInvite = null;
  if (!inv) return;
  const from = players.get(inv.from);
  if (from) send(from.ws, { t: 'event', kind: 'notice', text: `${p.name} declined your invitation.` });
}
// Leaving, being kicked and disconnecting all come through here, because they
// all mean the same thing to everyone still in the party.
function partyRemove(p, why) {
  const party = partyOf(p); if (!party) return;
  clearPartyInvitesFrom(p.id);
  party.members = party.members.filter(id => id !== p.id);
  p.partyId = null;
  send(p.ws, partyPayload(null));
  if (party.members.length < 2) {            // a party of one is just a person
    for (const m of partyMembers(party)) { clearPartyInvitesFrom(m.id); m.partyId = null; send(m.ws, partyPayload(null)); send(m.ws, { t: 'event', kind: 'notice', text: 'The party has disbanded.' }); }
    parties.delete(party.id);
    return;
  }
  if (party.leader === p.id) {               // the next one along takes over
    party.leader = party.members[0];
    const lead = players.get(party.leader);
    if (lead) partyNotice(party, `${lead.name} now leads the party.`);
  }
  partyNotice(party, why || `${p.name} has left the party.`);
  sendParty(party);
}
function partyKick(leader, id) {
  const party = partyOf(leader);
  if (!party || party.leader !== leader.id) return send(leader.ws, { t: 'event', kind: 'notice', text: 'Only the party leader can remove members.' });
  const t = players.get(Number(id)); if (!t || t.partyId !== party.id || t === leader) return;
  send(t.ws, { t: 'event', kind: 'notice', text: 'You have been removed from the party.' });
  partyRemove(t, `${t.name} was removed from the party.`);
}
// Who shares a kill: everyone in the party who is alive, in the same zone and
// near enough to have been part of it. The killer always counts.
function killShare(killer) {
  const party = partyOf(killer);
  if (!party) return [killer];
  const share = partyMembers(party).filter(m => m.alive && m.zoneId === killer.zoneId
    && dist2(m.x, m.z, killer.x, killer.z) < PARTY_SHARE_RANGE * PARTY_SHARE_RANGE);
  return share.length ? share : [killer];
}
// Splitting a kill costs the group a little, but grouping pays it back: each
// extra pair of hands adds a tenth, so a full party of five is earning 1.4x
// what one of them would alone, spread between them.
function partyXpSplit(n) { return n <= 1 ? 1 : (1 + 0.1 * (n - 1)) / n; }

function killMonster(m, killer) {
  m.alive = false; m.state = 'dead'; m.provoked = false; m.debuffs = null; m.stagger = 0;
  if (m.minion) onMinionKilled(bossCtx, m);
  if (m.boss === 'cluckifer') onBossKilled(bossCtx, m);
  if (killer && killer.kind === 'player') savageTrigger(killer);
  for (const p of players.values()) if (p.engagedWith === m.id) p.engagedWith = null;
  m.respawnTimer = m.elite ? Math.max(90, m.respawn * 2) : m.respawn;
  m.hp = 0;
  if (killer) {
    // Everyone who shares the kill is paid against their own level, so the
    // veteran carrying a friend earns what a veteran earns and the friend
    // earns what the fight was actually worth to them.
    const share = killShare(killer), split = partyXpSplit(share.length);
    for (const m2 of share) grantXp(m2, Math.round(xpForKill(m2.level, m.level, m.xp) * split));
    notifyQuestProgress(killer, recordKill(killer, m));
  }

  // Roll the loot table and drop items on the ground where it fell.
  const drops = rollMobLoot(m.type);
  // A chicken has a 1-in-300 chance of being... more than a chicken.
  if (m.type === 'chicken' && killer && killer.kind === 'player') maybeSpawnCluckifer(bossCtx, m, killer);
  for (const g of rollGear(m.type, !!m.elite)) drops.push(g);   // Dark Woods armour / weapon drops
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

// What every item is, for bag tooltips / Examine: sent once on join.
// Weapons carry their combat profile to the client as well as their bonus:
// how often they swing, what kind of damage they do and whether they need two
// hands is the difference between two weapons with the same +atk.
const ITEM_CATALOG = Object.fromEntries(Object.entries(ITEMS).map(([n, d]) => {
  const w = d.slot === 'weapon' ? weaponProfile(n) : null;
  return [n, {
    slot: d.slot || null, atk: d.atk || 0, def: d.def || 0, level: d.level || 1, value: d.value || 0,
    heal: d.heal || 0, desc: d.desc || null, gear: d.gear || null, model: d.model || null, len: d.len || null, tier: d.tier || 0, set: d.set || null, rarity: d.rarity || null,
    spd: w ? +swingSeconds(w).toFixed(1) : undefined, dmgType: w ? w.type : undefined,
    hands: w ? w.hands : undefined, reach: w && w.reach ? w.reach : undefined, rangedAt: w && w.range ? w.range : undefined, arch: w ? w.arch : undefined,
  }];
}));
function sendBag(p) {
  const w = weaponOf(p), cs = classStats(p.cls, p.level), eq = equipStats(p.equipment);
  const [lo, hi] = swingBand(w, cs.str, eq.atk || 0);
  send(p.ws, { t: 'bag', items: p.inventory, stacks: bagStacks(p.inventory), gold: p.gold,
    equipment: p.equipment, stats: eq, slots: SLOT_INFO, doll: DOLL,
    swing: { sec: +swingSeconds(w).toFixed(1), type: w.type, lo, hi, reach: +reachOf(p).toFixed(1), hands: w.hands } });
  // A 'collect' objective reads straight off the inventory, so any bag change
  // can complete (or un-complete) a quest.
  sendQuests(p);
  // ...and so does which ROD and which PICK they hold, both of which live in
  // the bag and are sent with the skills. Without this the client's copy went
  // stale the moment one was dropped or picked up: it still offered "Fish" to
  // someone who had just thrown their rod away, because the last skills packet
  // said they had one.
  sendSkills(p);
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
  p.equipment[slot] = name; p.gear = gearOf(p.equipment);
  send(p.ws, { t: 'event', kind: 'equip', slot, item: name });
  sendBag(p);
}

function unequipItem(p, slot) {
  if (!SLOTS.includes(slot)) return;
  const name = p.equipment[slot];
  if (!name) return;
  p.equipment[slot] = null; p.gear = gearOf(p.equipment);
  p.inventory.push(name);
  send(p.ws, { t: 'event', kind: 'unequip', slot, item: name });
  sendBag(p);
}

// Sell to a merchant NPC you're standing next to. Equipped gear is never sold.
// Sell one, or the whole stack — nobody wants to click thirty times to empty
// a mining run into a merchant's hands.
function sellItem(p, name, all) {
  const merchant = (zoneOf(p).npcs || []).find(n => n.trade);
  if (!merchant) return;
  if (dist2(p.x, p.z, merchant.x, merchant.z) > NPC_TALK_RADIUS * NPC_TALK_RADIUS) return;
  if (valueOf(name) === 0) return notice(p, 'That item has no resale value.');
  const each = Math.max(1, Math.round(valueOf(name) * 0.4));   // merchants buy low
  let n = 0;
  do {
    const idx = p.inventory.indexOf(name);
    if (idx < 0) break;
    p.inventory.splice(idx, 1); p.gold += each; n++;
  } while (all && stackable(name));
  if (!n) return;
  send(p.ws, { t: 'event', kind: 'sold', text: `Sold ${n > 1 ? n + ' × ' : ''}${name} for ${each * n} gold.`, gold: p.gold });
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
  const fp = fishingLevelFromXp(p.fishingXp), cp = cookingLevelFromXp(p.cookingXp);
  send(p.ws, { t: 'skills', mining: { level: st.level, xp: p.miningXp, into: st.into, next: st.next, pick: st.pick },
    fishing: { level: fp.level, into: fp.into, next: fp.next, rod: fisherStats(p).rod },
    cooking: { level: cp.level, into: cp.into, next: cp.next },
    cls: { id: p.cls, name: classDef(p.cls).name, icon: classDef(p.cls).icon, desc: classDef(p.cls).desc, level: p.level, xp: Math.floor(p.xp), into: Math.floor(p.xp - xpTotalForLevel(p.level)), next: classXpForLevel(p.level), maxLevel: MAX_CLASS_LEVEL },
    meditation: { level: p.meditation.level, xp: Math.floor(p.meditation.xp), into: Math.floor(p.meditation.xp - xpTotalForLevel(p.meditation.level)), next: xpForLevel(p.meditation.level) },
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
// How long the reel-in takes. The fish has to travel from the water to the
// rod and be seen doing it, which is most of a second.
const REEL_TIME = 0.9;
// The beat between a fish taking and the line coming up: the float ducks, the
// rod tip knocks, and then it is on.
const BITE_TIME = 0.55;
function fishCast(p, spot) {
  const st = fisherStats(p);
  if (!st.rod) { send(p.ws, { t: 'event', kind: 'notice', text: 'You need a fishing rod.' }); p.pendingFish = null; return true; }
  // A spot names a tier; the species table is keyed by name. Both of these
  // used to pass spot.tier straight in, which indexed a name-keyed object with
  // a number -- undefined every time, for every spot.
  const key = fishForTier(spot.tier);
  const fish = FISH[key];
  if (!fish || st.level < fish.level) {
    send(p.ws, { t: 'event', kind: 'notice',
      text: fish ? `You need Fishing level ${fish.level} to fish here.`
                 : 'There is nothing worth catching here.' });
    p.pendingFish = null; return true;
  }
  send(p.ws, { t: 'event', kind: 'fishcast', id: spot.id });
  if (Math.random() >= catchChance(key, st.level, st.power)) return false;
  // A fish does not appear in your hand the instant it takes. It takes, the
  // float goes under, and THEN you strike -- and that beat is the whole tell
  // of fishing. The catch is held here for it; stepFishing lands it when the
  // bite runs out.
  p.fishBite = BITE_TIME;
  p.fishOnLine = { item: fish.item, xp: fish.xp };
  return false; // keep fishing this spot (spots never deplete)
}
function stepFishing(p) {
  // The reel-in outlives the cast that earned it, so it ticks down even after
  // the player has stopped fishing -- otherwise the flourish is cut off the
  // moment they walk away from the water.
  if (p.fishReel > 0) p.fishReel = Math.max(0, p.fishReel - DT);
  // The bite runs down whether or not they are still stood at the water --
  // walking off mid-bite loses the fish, which is fair and needs no message.
  if (p.fishBite > 0) {
    p.fishBite = Math.max(0, p.fishBite - DT);
    if (p.fishBite === 0 && p.fishOnLine) {
      const got = p.fishOnLine; p.fishOnLine = null;
      if (p.pendingFish != null && p.alive) {
        p.inventory.push(got.item);
        p.fishReel = REEL_TIME;               // the flourish everyone can see
        p.fishCaught = got.item;
        send(p.ws, { t: 'event', kind: 'caught', item: got.item, xp: got.xp });
        grantFishingXp(p, got.xp);
        sendBag(p);
      }
    }
  }
  if (p.pendingFish == null) { p.fishing = null; return; }
  const zone = zoneOf(p);
  const spot = (zone.fishingSpots || []).find(s => s.id === p.pendingFish);
  if (!spot) { p.pendingFish = null; p.fishing = null; return; }
  // Walking in is not fishing. The rod only comes out once they are on the bank.
  if (Math.hypot(spot.x - p.x, spot.z - p.z) > FISHING.reach) { p.fishing = null; return; }
  p.yaw = Math.atan2(spot.x - p.x, spot.z - p.z);
  const st = fisherStats(p);
  // No rod, no fishing STATE -- not a state with a borrowed rod in it.
  //
  // The line below used to read `rod: st.rod || 'Fishing Rod'`, so a player
  // with an empty bag got a fishing rod in the snapshot, and every client in
  // the zone drew one in their hand. A tick later fishCast refused them and it
  // vanished. The refusal has to happen before the state exists: a snapshot
  // that says someone is holding a rod is the game asserting they have one.
  if (!st.rod) {
    send(p.ws, { t: 'event', kind: 'notice', text: 'You need a fishing rod.' });
    p.pendingFish = null; p.fishing = null; return;
  }
  const dur = castTime(st.power || 1);
  // What everyone in the zone needs to draw it: which rod, where the line goes,
  // and how far through the cast they are. Without this in the snapshot only
  // the fisher's own client knew anything was happening, so to every other
  // player they stood at the water doing nothing at all.
  p.fishing = { spot: spot.id, x: spot.x, z: spot.z, rod: st.rod, dur };
  // Nothing new happens while a fish is already on the line or coming in.
  if (p.fishBite > 0 || p.fishReel > 0) return;
  p.fishTimer -= DT;
  if (p.fishTimer <= 0) { p.fishTimer = dur; if (fishCast(p, spot)) p.pendingFish = null; }
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

// Optional objectives pay their own bonus when you hand the quest in.
function questBonus(p, q) {
  let gold = 0, xp = 0;
  for (const o of (q.objectives || [])) {
    if (!o.optional || !o.bonus) continue;
    if (!objectiveProgress(p, q, o).done) continue;
    gold += o.bonus.gold || 0; xp += o.bonus.xp || 0;
  }
  return { gold, xp };
}
function notifyQuestProgress(p, ids) {
  if (!ids || !ids.length) return;
  for (const id of new Set(ids)) {
    const q = Object.hasOwn(QUESTS, id) ? QUESTS[id] : null; if (!q) continue;
    const pr = questProgress(p, q);
    const line = pr.objectives.filter(o => !o.done || o.need > 1)
      .map(o => `${o.label} ${o.have}/${o.need}`).join(', ');
    send(p.ws, { t: 'event', kind: 'questprogress', id, name: q.name, text: line });
  }
  sendQuests(p);
}

function npcFor(zone, giverId) { return (zone?.npcs || []).find(n => n.id === giverId); }

// Resolve the NPC in the player's current zone, never from a client-provided
// location. Conversation can consume delivery items, so it needs the same
// living-player and distance checks as accepting work.
function nearNpc(p, npcId) {
  if (!p || !p.alive) return false;
  const npc = npcFor(zoneOf(p), npcId);
  if (!npc) return false;
  const distance = dist2(p.x, p.z, npc.x, npc.z);
  return Number.isFinite(distance) && distance <= NPC_TALK_RADIUS * NPC_TALK_RADIUS;
}
function nearGiver(p, q) { return nearNpc(p, q.giver); }

function talkToNpc(p, npcId) {
  if (!nearNpc(p, npcId)) return;
  const moved = recordTalk(p, npcId);
  if (moved.length) { sendBag(p); notifyQuestProgress(p, moved); }
}

function acceptQuest(p, id) {
  const reply = (ok, reason) => send(p.ws, { t: 'quest:accept', id, ok, ...(reason ? { reason } : {}) });
  if (!p.alive) return reply(false, 'You cannot accept a quest while dead.');
  const q = Object.hasOwn(QUESTS, id) ? QUESTS[id] : null;
  if (!q) return reply(false, 'That quest is no longer available.');
  if (!canStart(p, q)) return reply(false, 'You cannot accept that quest now. Check your quest log.');
  if (!nearGiver(p, q)) return reply(false, 'Move closer to the quest giver to accept this quest.');
  p.quests.set(id, true);
  p.questKills[id] = p.questKills[id] || {};
  send(p.ws, { t: 'event', kind: 'questaccepted', id, name: q.name });
  systemChat(`${p.name} started "${q.name}".`);
  sendQuests(p);
  reply(true);
}

function turnInQuest(p, id) {
  const q = Object.hasOwn(QUESTS, id) ? QUESTS[id] : null;
  if (!q || !p.quests.has(id)) return;
  // Say why, rather than doing nothing: "walk back to them" is a fair thing
  // for the game to tell you.
  if (!nearGiver(p, q)) return send(p.ws, { t: 'event', kind: 'notice', text: `You need to speak to ${q.giver} in person.` });
  if (!questProgress(p, q).complete) return send(p.ws, { t: 'event', kind: 'notice', text: `"${q.name}" is not finished yet.` });

  const bonus = questBonus(p, q);      // read before the tallies are cleared
  consumeQuestItems(p, q);
  p.quests.delete(id);
  p.questDone.add(id);
  p.questAnnounced.delete(id);
  delete p.questKills[id];

  const r = q.reward || {};
  const gold = (r.gold || 0) + bonus.gold, xp = (r.xp || 0) + bonus.xp;
  if (gold) p.gold += gold;
  for (const it of (r.items || [])) p.inventory.push(it);
  send(p.ws, { t: 'event', kind: 'questcomplete', id, name: q.name,
    text: q.done, xp, gold, items: r.items || [], bonus: (bonus.gold || bonus.xp) ? bonus : undefined });
  if (xp) grantXp(p, xp);              // may level the player up
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
// The weapon in the player's hand, as combat sees it: speed, damage type,
// reach and grip all come from the item itself (see server/combat.js), so
// swapping a dagger for a maul changes the whole rhythm of the fight.
function weaponOf(p) { return weaponProfile(p.equipment && p.equipment.weapon); }
function playerAttackSpeed(p) {
  const mo = classDef(p.cls).momentum, k = mo && passiveValue(p, 'momentum') ? 1 - mo.atkSpeedPerStack * (p.momentum || 0) : 1;
  return swingSeconds(weaponOf(p)) * k * atkSpeedMult(p);
}
// How far this player can reach their target: a spear fights from a step back,
// a bow from across the clearing.
function reachOf(p) { return weaponRange(weaponOf(p), ATTACK_RANGE); }
// The player's defensive sheet. Dodging comes from keeping your feet, parrying
// needs something in your hand, blocking needs a shield on your arm — so what
// you wear decides which lines of the attack table you ever see.
function defenceProfile(p, srcX, srcZ) {
  const eq = equipStats(p.equipment), cs = classStats(p.cls, p.level);
  const shield = p.equipment && p.equipment.offhand && (itemDef(p.equipment.offhand) || {});
  const armed = !weaponOf(p).unarmed;
  return {
    level: cs.def,
    dodge: 0.03 + cs.def * 0.0012 + buffStat(p, 'dodge'),
    parry: (armed ? 0.04 + cs.def * 0.0010 : 0) + buffStat(p, 'parry'),
    block: shield && shield.def ? 0.14 + cs.def * 0.0015 + buffStat(p, 'block') : 0,
    blockAmt: shield && shield.def ? Math.round(shield.def * 1.8 + p.level * 0.8) : 0,
    armour: eq.def || 0,
    facing: srcX == null ? true : facing(p.x, p.z, p.yaw, srcX, srcZ),
  };
}
// Sum one defensive stat across the player's active buffs (Shield Wall and
// friends push dodge/parry/block up for their duration).
function buffStat(p, key) {
  let v = 0;
  for (const b of Object.values(p.buffs || {})) if (b.t > 0 && b[key]) v += b[key] * songAmp(p, b);
  return v;
}
// Meditation trains as you rest to heal: xp scales with HP recovered.
function addMeditationXp(p, amount) {
  const sk = p.meditation; sk.xp += amount; let leveled = false;
  while (sk.level < levelForXp(sk.xp)) { sk.level++; leveled = true; }
  if (leveled) { send(p.ws, { t: 'event', kind: 'medlevel', level: sk.level }); sendSkills(p); }
}
// Single-way combat (OSRS rules): unless the zone is flagged multiCombat, a
// player can only be fought by one monster at a time, and can't turn on a
// second monster while the first is still on them. An engagement is kept
// alive for ENGAGE_T seconds by every blow exchanged between the two.
const ENGAGE_T = 8;
function engage(p, m) { p.engagedWith = m.id; p.engagedT = ENGAGE_T; }
function engagedElsewhere(p, m) {
  return p.engagedWith != null && p.engagedWith !== m.id && (p.engagedT || 0) > 0 && !zoneOf(p).multiCombat;
}


// ---------------------------------------------------------------------------
// Navigation: a lazily-built walkability grid over the surface (1m cells,
// probed with the real collision so fences, walls, rocks, trees, furniture
// and rivers all count), A* over it with no corner cutting, and string-pulled
// paths so walkers cut straight across open ground. Line-of-sight for attacks
// uses the same probe with a thin radius.
// ---------------------------------------------------------------------------
const NAV_CELL = 1.0, NAV_CHUNK = 16, NAV_MAX_NODES = 7000;
function navGrid(zone) {
  if (!zone._nav) zone._nav = { chunks: new Map() };
  return zone._nav;
}
function navCellBlocked(zone, cx, cz) {
  const nav = navGrid(zone), kx = Math.floor(cx / NAV_CHUNK), kz = Math.floor(cz / NAV_CHUNK), key = kx + ',' + kz;
  let ch = nav.chunks.get(key);
  if (!ch) {
    ch = new Uint8Array(NAV_CHUNK * NAV_CHUNK);
    for (let j = 0; j < NAV_CHUNK; j++) for (let i = 0; i < NAV_CHUNK; i++) {
      const x = (kx * NAV_CHUNK + i + 0.5) * NAV_CELL, z = (kz * NAV_CHUNK + j + 0.5) * NAV_CELL;
      ch[j * NAV_CHUNK + i] = navBlocked(zone, x, z) ? 1 : 0;
    }
    nav.chunks.set(key, ch);
  }
  const i = cx - kx * NAV_CHUNK, j = cz - kz * NAV_CHUNK;
  return ch[j * NAV_CHUNK + i] === 1;
}
// Can two combatants reach each other (nothing solid between them)? Thin probe,
// and the ends are skipped so the bodies themselves don't count.
function hasLos(zone, ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az); if (d < 1.2) return true;
  const n = Math.ceil(d / 0.4);
  for (let i = 1; i < n; i++) { const t = i / n; const x = ax + (bx - ax) * t, z = az + (bz - az) * t; if (Math.hypot(x - ax, z - az) < 0.6 || Math.hypot(x - bx, z - bz) < 0.6) continue; if (navBlocked(zone, x, z, 0.15)) return false; }
  return true;
}
function nearestFreeCell(zone, cx, cz) {
  if (!navCellBlocked(zone, cx, cz)) return [cx, cz];
  for (let r = 1; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    if (!navCellBlocked(zone, cx + dx, cz + dz)) return [cx + dx, cz + dz];
  }
  return null;
}
// A* from (ax,az) to (bx,bz). Returns waypoints (world coords, excluding the
// start) or null. If the goal can't be reached within the node budget, the path
// to the closest explored cell is returned instead.
function findPath(zone, ax, az, bx, bz) {
  const s0 = nearestFreeCell(zone, Math.floor(ax / NAV_CELL), Math.floor(az / NAV_CELL));
  const g0 = nearestFreeCell(zone, Math.floor(bx / NAV_CELL), Math.floor(bz / NAV_CELL));
  if (!s0 || !g0) return null;
  const key = (x, z) => x + ',' + z;
  const open = [], gS = new Map(), came = new Map(), closed = new Set();
  const h = (x, z) => { const dx = Math.abs(x - g0[0]), dz = Math.abs(z - g0[1]); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const push = (x, z, g, f) => { open.push({ x, z, g, f }); gS.set(key(x, z), g); };
  push(s0[0], s0[1], 0, h(s0[0], s0[1]));
  let best = { x: s0[0], z: s0[1], h: h(s0[0], s0[1]) }, expanded = 0, found = null;
  while (open.length && expanded < NAV_MAX_NODES) {
    let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
    const ck = key(cur.x, cur.z); if (closed.has(ck)) continue; closed.add(ck); expanded++;
    if (cur.x === g0[0] && cur.z === g0[1]) { found = cur; break; }
    const hh = h(cur.x, cur.z); if (hh < best.h) best = { x: cur.x, z: cur.z, h: hh };
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cur.x + dx, nz = cur.z + dz;
      if (navCellBlocked(zone, nx, nz)) continue;
      if (dx && dz && (navCellBlocked(zone, cur.x + dx, cur.z) || navCellBlocked(zone, cur.x, cur.z + dz))) continue; // no corner cutting
      const ng = cur.g + ((dx && dz) ? 1.414 : 1), nk = key(nx, nz);
      if (closed.has(nk) || (gS.has(nk) && gS.get(nk) <= ng)) continue;
      came.set(nk, ck); push(nx, nz, ng, ng + h(nx, nz));
    }
  }
  const end = found ? key(found.x, found.z) : key(best.x, best.z);
  if (!found && best.x === s0[0] && best.z === s0[1]) return null;
  const cells = []; let k = end;
  while (k && k !== key(s0[0], s0[1])) { const [x, z] = k.split(',').map(Number); cells.push([x, z]); k = came.get(k); }
  cells.reverse();
  const pts = cells.map(([x, z]) => ({ x: (x + 0.5) * NAV_CELL, z: (z + 0.5) * NAV_CELL }));
  if (found) pts.push({ x: bx, z: bz }); // finish exactly on the goal
  // String-pull: drop waypoints the walker can see straight past.
  const out = []; let from = { x: ax, z: az }, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineClear(zone, from.x, from.z, pts[j].x, pts[j].z)) j--;
    out.push(pts[j]); from = pts[j]; i = j + 1;
  }
  return { pts: out, partial: !found };
}
// Walk an entity toward (tx,tz) around obstacles. Keeps a cached route on the
// entity (ent._nav) and recomputes when the goal moves or it gets stuck.
// Returns true if it moved.
function navStep(zone, ent, tx, tz, stopDist, speed) {
  const d = Math.hypot(tx - ent.x, tz - ent.z);
  if (d <= stopDist) { ent._nav = null; return false; }
  const face = (x, z) => { ent.yaw = Math.atan2(x - ent.x, z - ent.z); };
  const walk = (x, z) => { face(x, z); const dd = Math.hypot(x - ent.x, z - ent.z) || 1; const st = Math.min(dd, speed * DT); ent.x += (x - ent.x) / dd * st; ent.z += (z - ent.z) / dd * st; };
  const before = { x: ent.x, z: ent.z };
  const underground = (ent.y || 0) < -6;
  if (underground || lineClear(zone, ent.x, ent.z, tx, tz)) { ent._nav = null; walk(tx, tz); return true; }
  let nav = ent._nav;
  const goalMoved = nav && Math.hypot(nav.tx - tx, nav.tz - tz) > 1.5;
  if (!nav || goalMoved || nav.age > 2.5 || nav.stuck > 0.6) {
    const r = findPath(zone, ent.x, ent.z, tx, tz);
    nav = ent._nav = { tx, tz, pts: r ? r.pts : [{ x: tx, z: tz }], i: 0, age: 0, stuck: 0 };
  }
  nav.age += DT;
  while (nav.i < nav.pts.length - 1 && Math.hypot(nav.pts[nav.i].x - ent.x, nav.pts[nav.i].z - ent.z) < 0.5) nav.i++;
  const wp = nav.pts[Math.min(nav.i, nav.pts.length - 1)];
  walk(wp.x, wp.z);
  resolveCollision(zone, ent, PLAYER_RADIUS);
  const movedBy = Math.hypot(ent.x - before.x, ent.z - before.z);
  nav.stuck = movedBy < speed * DT * 0.25 ? nav.stuck + DT : 0;
  return true;
}

// ---------------------------------------------------------------------------
// NPC routes -- the village walks about.
//
// An NPC without a hand-written route gets a small one built on first tick: a
// ring of points around wherever it was placed, keeping only those that are
// walkable and that it can reach from its post in a straight line, so nobody
// strolls into the river or through a wall. The stops are walked in order with
// a dwell at each, which reads as a beat rather than a wander, and the post
// itself is one of them and the longest -- a merchant is never far from the
// stall and a quest giver is where the map says.
//
// They move by the same navStep the monsters use, so n.x/n.z stay live and
// every proximity check in the game (talk, trade, train) keeps working.
// ---------------------------------------------------------------------------
const NPC_SPEED = PLAYER_SPEED * 0.4;      // unhurried: they are not going anywhere
function npcStrollRadius(n) {
  if (n.stroll != null) return n.stroll;
  if (n.trade || n.trainer) return 3.0;    // they have a post to keep
  return 6.5;
}
function buildNpcRoute(zone, n) {
  n._yaw0 = n.yaw || 0;
  // Somebody placed inside a crate or half through a tent wall can go nowhere,
  // because every direction out of a solid cell is solid. Step them to the
  // nearest clear ground first -- it is a nudge of a metre or two, and without
  // it they stand frozen while the rest of the village walks about.
  if (navBlocked(zone, n.x, n.z)) {
    outer: for (let r = 0.6; r <= 3.0; r += 0.6) {
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6, x = n.x + Math.sin(a) * r, z = n.z + Math.cos(a) * r;
        if (!navBlocked(zone, x, z)) { n.x = x; n.z = z; break outer; }
      }
    }
  }
  const home = { x: n.x, z: n.z, wait: [8, 16] };
  const stops = [home];
  if (!n.static) {
    if (Array.isArray(n.route) && n.route.length) {
      for (const w of n.route) stops.push({ x: w.x, z: w.z, wait: w.wait || [3, 9] });
    } else {
      // Try the full radius first, then draw in: someone posted in a doorway or
      // penned between a cart and a fence should still shift their feet rather
      // than stand frozen while the rest of the village walks about.
      const R0 = npcStrollRadius(n), turn = Math.PI * 2 / 12, start = Math.random() * Math.PI * 2;
      for (const scale of [1, 0.55, 0.3]) {
        for (let i = 0; i < 12 && stops.length < 4; i++) {
          const a = start + i * turn, r = R0 * scale * (0.55 + Math.random() * 0.45);
          const x = home.x + Math.sin(a) * r, z = home.z + Math.cos(a) * r;
          if (navBlocked(zone, x, z)) continue;                      // a wall, a tree, the water
          if (!lineClear(zone, home.x, home.z, x, z)) continue;      // and it has to be able to get back
          stops.push({ x, z, wait: [3, 9] });
        }
        if (stops.length > 1) break;
      }
    }
  }
  return { stops, i: 0, wait: Math.random() * 8, speed: NPC_SPEED * (0.85 + Math.random() * 0.3) };
}
function stepNpc(zone, n, dt) {
  const r = n._route || (n._route = buildNpcRoute(zone, n));
  if (r.stops.length < 2) { n.moving = false; return; }            // nowhere safe to go: stay put
  if (r.wait > 0) {
    r.wait -= dt; n.moving = false;
    // Standing about, they settle back to the way they were facing.
    const d = Math.atan2(Math.sin(n._yaw0 - n.yaw), Math.cos(n._yaw0 - n.yaw));
    n.yaw += d * Math.min(1, dt * 1.5);
    return;
  }
  const s = r.stops[r.i];
  n.moving = navStep(zone, n, s.x, s.z, 0.4, r.speed);
  if (!n.moving) {                                                  // arrived: dwell, then on to the next
    r.i = (r.i + 1) % r.stops.length;
    r.wait = s.wait[0] + Math.random() * (s.wait[1] - s.wait[0]);
    n._nav = null;
  }
}

// A swing is two moments, not one: the wind-up the client animates, and the
// impact where the damage actually happens. Splitting them is what stops the
// game showing a number before the axe has reached anybody. IMPACT_AT is how
// far through the swing the blow lands.
const IMPACT_AT = 0.42;
function impactDelay(p) { return Math.max(0.2, Math.min(0.75, playerAttackSpeed(p) * IMPACT_AT)); }
function doPlayerAttack(p, m) {
  if (p.atkTimer > 0 || p.swing) return;
  if (m.untargetable) return;   // out of reach mid-leap
  if (m.kind === 'player') {    // a duel: no threat table, nothing to provoke
    const w2 = weaponOf(p), delay2 = impactDelay(p);
    p.atkTimer = playerAttackSpeed(p);
    p.swing = { id: m.id, t: delay2 };
    broadcast({ t: 'event', kind: 'swing', by: p.id, target: m.id, dur: delay2, arch: w2.arch, type: w2.type, ranged: !!w2.range });
    return;
  }
  if (engagedElsewhere(p, m)) {
    const other = monsters.get(p.engagedWith);
    if (other && other.alive) {
      send(p.ws, { t: 'event', kind: 'notice', text: `You're already under attack by ${other.elite ? other.name : 'a ' + other.name}.` });
      p.combatId = null; return;
    }
    p.engagedWith = null; // the other one is gone
  }
  const w = weaponOf(p), delay = impactDelay(p);
  p.atkTimer = playerAttackSpeed(p);
  p.swing = { id: m.id, t: delay };
  m.state = 'combat'; m.provoked = true;               // it fights back even on a miss
  addThreat(m, p.id, 1); retarget(m);
  engage(p, m);
  broadcast({ t: 'event', kind: 'swing', by: p.id, target: m.id, dur: delay, arch: w.arch, type: w.type, ranged: !!w.range });
}
// The impact frame: resolve the attack table and land the blow.
function landPlayerSwing(p) {
  const sw = p.swing; p.swing = null;
  const foe = duelFoe(p);
  const m = monsters.get(sw.id) || (foe && foe.id === sw.id ? foe : null);
  if (!p.alive || !m || !m.alive || m.zoneId !== p.zoneId) return;
  const w = weaponOf(p);
  if (dist2(p.x, p.z, m.x, m.z) > (weaponRange(w, ATTACK_RANGE) + 1.5) ** 2) return;   // they broke away mid-swing
  playerSwing(p, m, 1);
}
// One swing of the player at a monster, rolled on the attack table.
function playerSwing(p, m, dmgMult) {
  const eq = equipStats(p.equipment), bonus = eq.atk || 0, cs = classStats(p.cls, p.level), w = weaponOf(p);
  const res = resolveAttack({
    level: cs.atk, hitBonus: bonus * 0.004, type: w.type,
    crit: critChance(p) + (w.crit || 0), critMult: classDef(p.cls).critMult || 2.0,
    band: swingBand(w, cs.str, bonus),
    mult: dmgMult * (1 + dmgBuff(p, false)) * takenMult(m) * passiveWeaponMult(p, m),
  }, monsterDefence(m, p));
  applyHit(p, m, res.dmg, res.outcome === 'crit', w.type, res);
  if (res.dmg > 0) { addRage(p, (classDef(p.cls).rage || {}).autoHit || 0); spendSongCharges(clericCtx, p, 'weapon'); }   // landing a blow feeds the rage (and spends Blade Rhythm)
  return res.dmg;
}
// A monster's defensive sheet. Archetypes decide which lines it gets: a
// shielded defender blocks, a scuttling spider dodges, a beast does neither.
function monsterDefence(m, from) {
  if (m.kind === 'player') return playerDefence(m, from);
  const a = MOB_DEF[m.arch] || MOB_DEF.beast;
  // A defender that has just raised its shield is much harder to get through.
  const wall = (m.debuffs && m.debuffs.mob_shield_wall > 0) ? 0.25 : 0;
  return {
    level: monsterDef(m),
    dodge: a.dodge * ((m.debuffs && m.debuffs.crushed_armor > 0) ? 0.8 : 1),
    parry: a.parry, block: a.block + wall,
    blockAmt: Math.round((a.block ? 3 + (m.level || 1) * 1.4 : 0)),
    armour: m.defBonus || 0,
    facing: from ? facing(m.x, m.z, m.yaw, from.x, from.z) : true,
  };
}
function addRage(p, n) { const R = classDef(p.cls).rage; if (!R || !n) return; p.rage = Math.min(R.max, (p.rage || 0) + n * (1 + passiveValue(p, 'rageGain'))); p.rageIdle = 0; }
// The class resource on the bar: rage for the Fighter, mana for the Cleric.
function resOf(p) { return classDef(p.cls).mana ? (p.mana || 0) : (p.rage || 0); }
function spendRes(p, n) { if (classDef(p.cls).mana) p.mana = Math.max(0, (p.mana || 0) - n); else p.rage = Math.max(0, (p.rage || 0) - n); }
function refundRes(p, n) { if (classDef(p.cls).mana) p.mana = Math.min(p.manaMax || 0, (p.mana || 0) + n); else p.rage = Math.min(p.rageMax || 0, (p.rage || 0) + n); }
// Monster effective defence, with Crushed Armour.
function monsterDef(m) { return (m.defLevel || 1) * ((m.debuffs && m.debuffs.crushed_armor > 0) ? 0.92 : 1) * bardMonsterDefMult(m); }
function takenMult(m) { if (m.kind === 'player') return 1; return ((m.debuffs && m.debuffs.split_guard > 0) ? 1.08 : 1) * bardMonsterTakenMult(m); }
// Damage bonus from the player's active buffs (heavy: the ability spends
// Weapon Flow; spell: a cast, which weapon-only songs don't help).
function dmgBuff(p, heavy, spell) {
  let b = 0;
  for (const [id, bf] of Object.entries(p.buffs)) {
    if (!(bf.t > 0) || !bf.dmg) continue;
    if (bf.heavyOnly && !heavy) continue;
    if (bf.meleeOnly && spell) continue;
    b += bf.dmg * songAmp(p, bf);
  }
  return b;
}
function critChance(p) { let c = (classDef(p.cls).critBase || 0.05) + passiveValue(p, 'crit'); for (const bf of Object.values(p.buffs)) if (bf.t > 0 && bf.crit) c += bf.crit * songAmp(p, bf); return c; }
function incomingMult(p) { let m = 1; for (const bf of Object.values(p.buffs)) if (bf.t > 0 && bf.taken) m += bf.taken; return m; }
// Deep water, either a lake cell or one of the traced channels. A player in it
// is swimming: slower, and with both hands busy.
const SWIM_SPEED = 0.55;
// Breath. You have about a minute of easy swimming, less if you are working at
// it, and then you start going under. Out of the water it comes back quickly.
const BREATH_MAX = 100;
const BREATH_TREAD = 1.15;    // per second, held under and still
const BREATH_SWIM  = 2.4;     // per second, held under and struggling
const BREATH_REGAIN = 9;      // per second, once your head is up
// How high off the ground a character's head is, so "under water" can be asked
// of the water level rather than guessed at from the swim state.
const HEAD_HEIGHT = 2.1;
const DROWN_DPS = 7;          // once the breath is gone
// How deep is it here, roughly: 0 dry, 1 out of your depth. Shallow water is
// something you WADE -- the fen never makes you swim, and neither does the
// first stride off a bank.
// Are you standing on something laid OVER the water -- a bridge deck or a plank
// walk? The river loop below already knew about bridges, but the terrain test
// above it did not, and a bridge whose cell the trace calls deep water made you
// swim across your own bridge: deck underfoot at the right height, full swim
// stroke, combat dropped, breath draining. So the question is asked once, here,
// and it covers the boardwalks too -- the client lifts you onto those and the
// server never knew they existed.
// `grow` widens every deck by that much. Standing on a plank is a HARD test --
// on it or not -- and it sets the water depth to zero, so a player at the edge
// of a boardwalk crossed a 0-to-1 step with every centimetre of collision
// jitter. The depth hysteresis below cannot help with that: both of its
// thresholds are crossed in the same tick. Someone already dry keeps their
// footing a little past the planks, which closes it.
// Swimming has hysteresis: you go out of your depth well inside the water and
// find your feet again only once you are properly back on the shelf. Without
// it a player stood on the line flickers in and out, which spammed the chat.
const SWIM_IN = 0.82, SWIM_OUT = 0.55;
// How long the new answer has to hold before the state actually changes. The
// depth hysteresis handles a player drifting across the swim line; this handles
// the case it cannot -- an input that JUMPS, like stepping off the edge of a
// plank walk, where both thresholds are crossed in one tick and the state
// flickers at the tick rate. The chat filled with "You wade in and start to
// swim. / You climb out, dripping." over and over. A third of a second is not
// noticeable on a real transition and no flicker survives it.
const SWIM_DWELL = 0.35;
function swimNow(zone, p) {
  // Always a boolean. `p.swimming` is undefined on a fresh player, and while
  // the dwell below was holding, returning it raw made `undefined !== false`
  // true in the caller -- so every tick of the hold announced "You climb out,
  // dripping." Six of them on every login, which is the same chat spam this
  // dwell was added to stop.
  const now = !!p.swimming;
  // Dry feet keep their footing a little past the planks; a swimmer has to be
  // properly on them to count as out.
  const d = waterDepthAt(zone, p.x, p.z, now ? 0 : 0.4);
  const want = now ? d > SWIM_OUT : d >= SWIM_IN;
  if (want === now) { p.swimHold = 0; return now; }
  p.swimHold = (p.swimHold || 0) + DT;
  if (p.swimHold < SWIM_DWELL) return now;
  p.swimHold = 0;
  return want;
}
function moveMult(p) {
  let m = (p.swimming ? SWIM_SPEED : 1) * (1 + passiveValue(p, 'moveSpeed'));
  for (const bf of Object.values(p.buffs)) { if (!(bf.t > 0) || !bf.move) continue; const v = bf.moveCombat != null && (p.combatTimer || 0) > 0 ? bf.moveCombat : bf.move; m += v * songAmp(p, bf); }
  if (p.channel) m *= 0.6; if (p.slow && p.slow.t > 0) m *= p.slow.k; return m;
}
function addBuff(p, spec) { p.buffs[spec.id] = { ...spec, t: spec.dur, charges: spec.charges || 0, since: 0 }; if (p.ws) sendStatus(p); }
// A landed hit: damage, xp, splat, kill; momentum / savage triggers.
function applyHit(p, m, dmg, crit, kind, res) {
  if (m.kind === 'player') return duelHit(p, m, dmg, crit, kind, res);   // a duel: same blow, nobody dies
  p.lastCombat = Date.now(); p.combatTimer = REGEN.combatLockout;
  if (m.vulnerable > 0 && dmg > 0) dmg = Math.round(dmg * 1.5);   // a stunned boss takes it hard
  if (dmg > 0) {
    m.hp -= dmg; m.provoked = true;
    if (m.debuffs && m.debuffs.asleep) delete m.debuffs.asleep;   // a blow wakes a lullaby
    addThreat(m, p.id, dmg * (res && res.threat != null ? res.threat : threatMult(p)));
    if (!m.boss) { m.state = 'combat'; retarget(m); }
    spendSongCharges(clericCtx, p, 'offensive');
  }
  broadcast({ t: 'event', kind: 'hit', by: p.id, target: m.id, dmg, crit: !!crit, targetKind: 'monster',
              hitKind: kind || null, res: res ? res.outcome : (dmg > 0 ? 'hit' : 'miss'), blocked: res && res.blocked || 0 });
  if (crit) { savageTrigger(p); procOnCrit(p); }
  if (m.hp <= 0) killMonster(m, p);
}
// How loudly this player's damage registers on a threat table. Defensive
// stances shout; the abilities that drop threat whisper.
function threatMult(p) {
  let k = 1;
  for (const b of Object.values(p.buffs || {})) if (b.t > 0 && b.threat) k *= b.threat;
  return k;
}
// Healing is loud. Every monster already fighting the person you patched up
// hears about it, which is why a healer needs a tank standing in front of them.
function healThreat(by, healed, amount) {
  for (const m of monsters.values()) {
    if (!m.alive || m.zoneId !== by.zoneId) continue;
    if (m.targetId !== healed.id && !threatOf(m, healed.id)) continue;
    if (dist2(m.x, m.z, by.x, by.z) > 40 ** 2) continue;
    addThreat(m, by.id, amount * 0.5);
    retarget(m);
  }
}
// Pick the monster's target off its threat table and turn it on them.
function retarget(m) {
  const id = topThreat(m,
    (pid) => { const t = players.get(pid); return !!(t && t.alive && t.zoneId === m.zoneId); },
    (pid) => { const t = players.get(pid); return !!t && dist2(t.x, t.z, m.x, m.z) <= (ATTACK_RANGE + 2) ** 2; });
  if (id == null || id === m.targetId) return;
  const was = m.targetId;
  m.targetId = id; m.state = 'combat';
  // Announce a pull so whoever just lost (or took) aggro can see it happen.
  if (was != null) broadcast({ t: 'event', kind: 'aggro', monster: m.id, target: id, from: was });
}
function addMomentum(p, n) {
  const mo = classDef(p.cls).momentum; if (!mo || !passiveValue(p, 'momentum')) return; // the passive has to be learned too
  p.momentum = Math.min(mo.max, (p.momentum || 0) + n); p.momentumT = mo.dur;
}
// A crit can open a window: the classic "your next one is free" flash that
// makes a rotation react to luck instead of running on rails. Each class gets
// one, and it is spent by the ability it lights up (see spendCharges / the
// free-cost check in useAbility).
const CRIT_PROCS = {
  fighter: { id: 'opening', chance: 0.25, dur: 8,  name: 'Opening', dmg: 0.30, chargeTrigger: 'ability', charges: 1, text: 'An opening! Your next ability strikes for +30%.' },
  cleric:  { id: 'blessed_hands',   chance: 0.20, dur: 10, name: 'Blessed Hands', heal: 0.30, charges: 1, text: 'Your hands blaze with light!' },
  bard:    { id: 'encore',          chance: 0.22, dur: 10, name: 'Encore', free: true, charges: 1, text: 'Encore! Your next song is free.' },
};
function procOnCrit(p) {
  const d = CRIT_PROCS[p.cls];
  if (!d || Math.random() >= d.chance) return;
  const have = p.buffs[d.id];
  if (have && have.t > 0) { have.t = d.dur; return; }   // already lit: just refresh it
  addBuff(p, { id: d.id, dur: d.dur, charges: d.charges, chargeTrigger: d.chargeTrigger, dmg: d.dmg || 0, heal: d.heal || 0, free: !!d.free, proc: true, vis: 'proc' });
  send(p.ws, { t: 'event', kind: 'proc', id: d.id, name: d.name, text: d.text });
}
// The global cooldown: the deliberate beat classic combat is built on. Most
// abilities set it; interrupts, emergency buttons and pure reactions are off
// it, so the thing you need in a hurry is never locked behind the last thing
// you pressed. Haste shortens it, but never below three quarters of a second.
function gcdFor(p, a) {
  if (a.offGcd || a.passive) return 0;
  return Math.max(0.75, (classDef(p.cls).gcd || 1.5) * castTimeMult(p));
}
function savageTrigger(p) {
  const w = p.buffs.savage_watcher; if (!w || !(w.t > 0) || (p.savageCd || 0) > 0) return;
  p.savageCd = 20; addBuff(p, { id: 'savage', dur: 300, chargeTrigger: 'ability', charges: 6, dmg: 0.08, move: 0.12 });
}
// Spend one charge from every charge-limited buff that a melee ability consumes.
function spendCharges(p, ab) {
  for (const [id, bf] of Object.entries(p.buffs)) {
    if (!(bf.t > 0) || !bf.charges || bf.chargeTrigger !== 'ability') continue;
    if (bf.heavyOnly && !ab.heavy) continue;
    bf.charges--; if (bf.charges <= 0) delete p.buffs[id];
  }
}
// One ability hit on one monster: OSRS accuracy first, then flat×levelScale + weapon roll.
function abilityHit(p, m, ab, extra = {}) {
  const eq = equipStats(p.equipment), bonus = eq.atk || 0, cs = classStats(p.cls, p.level);
  const ar = attackRoll(cs.atk, bonus), dr = defenceRoll(monsterDef(m), m.defBonus || 0);
  if (Math.random() >= hitChance(ar, dr)) { applyHit(p, m, 0, false); return 0; }
  const L = p.level, scale = 0.25 + 0.75 * Math.min(19, L - 1) / 19;
  const wroll = maxHit(cs.str, bonus) * (0.6 + 0.4 * Math.random());
  let base = (ab.flat || 0) * scale + (ab.wd || 0) * wroll;
  if (extra.flat) base += extra.flat * scale; if (extra.wd) base += extra.wd * wroll;
  let mult = (1 + dmgBuff(p, !!ab.heavy)) * takenMult(m) * (extra.mult || 1) * passiveWeaponMult(p, m);
  const crit = Math.random() < critChance(p) + (extra.crit || 0);
  if (crit) mult *= (classDef(p.cls).critMult || 1.5) + (extra.critDmg || 0);
  const dmg = Math.max(1, Math.round(base * mult));
  applyHit(p, m, dmg, crit);
  addRage(p, (classDef(p.cls).rage || {}).abilityHit || 0);   // every blow that lands builds a little more
  spendSongCharges(clericCtx, p, 'weapon');
  p.lastHit = { dmg, crit };   // Heavy Swing's extra stack on a crit reads this
  return dmg;
}
function monstersNear(p, x, z, r, cap, coneDeg) {
  const out = [];
  for (const m of monsters.values()) {
    if (!m.alive || m.zoneId !== p.zoneId || m.passive) continue;
    if (dist2(m.x, m.z, x, z) > r * r) continue;
    if (coneDeg) { // in front of the player only
      const a = Math.atan2(m.x - p.x, m.z - p.z); let d = a - p.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      if (Math.abs(d) > (coneDeg / 2) * Math.PI / 180) continue;
    }
    out.push(m);
  }
  out.sort((a, b) => dist2(a.x, a.z, x, z) - dist2(b.x, b.z, x, z));
  return out.slice(0, cap || out.length);
}
function aoeRadius(p, ab) { let r = ab.radius || 0; const br = p.buffs.berserkers_roar; if (br && br.t > 0 && br.radius) r += br.radius; return r; }


// Passive effects are server-owned, with at most three class-specific choices.
function passiveLockReason(p) {
  if (!interactionReady(p)) return 'You must be alive and connected to change passives.';
  if (duelOf(p)) return 'Finish your duel before changing passives.';
  if (inPveCombat(p) || (p.engagedT || 0) > 0) return 'Leave combat before changing passives.';
  for (const m of monsters.values()) if (m.alive && m.zoneId === p.zoneId && (m.targetId === p.id || (m.state === 'combat' && threatOf(m, p.id) > 0))) return 'An enemy is still fighting you.';
  if (p.windup || p.channel || p.swing || p.queued) return 'Finish your action before changing passives.';
  if (Object.values(p.dots || {}).some(d => d && d.t > 0)) return 'Wait for damaging effects to end before changing passives.';
  return null;
}
function sendPassives(p, changedOnly = false) {
  const reason = passiveLockReason(p);
  const catalogue = (PASSIVES[p.cls] || []).map(a => ({ id: a.id, name: a.name, desc: a.desc, level: a.level,
    available: passiveAvailable(p, a), unavailableReason: passiveAvailable(p, a) ? null : p.level < a.level ? `Unlocks at level ${a.level}.` : `Learn ${a.name} from your trainer at level ${a.level}.` }));
  const payload = { t: 'passives', catalogue, equipped: sanitizePassives(p, p.passives), limit: passiveSlotLimit(p), slotLevels: PASSIVE_SLOT_LEVELS, locked: !!reason, reason };
  const key = JSON.stringify(payload);
  if (!changedOnly || p._passiveState !== key) { p._passiveState = key; send(p.ws, payload); }
}
function clearPassiveOwnedEffects(p) {
  // Clear only effects placed by this caster. Never cleanse penalties, other
  // casters' protection, damage-over-time, cooldowns or proc lockouts.
  for (const q of players.values()) {
    let changed = false;
    for (const [id, b] of Object.entries(q.buffs || {})) {
      if (b.by === p.id && id !== 'revival_sickness' && !(b.taken > 0)) { delete q.buffs[id]; changed = true; }
    }
    if (changed) sendStatus(q);
  }
  for (const zone of Object.values(ZONES)) if (zone._sanct) zone._sanct = zone._sanct.filter(s => s.by !== p.id);
  p.momentum = 0; p.momentumT = 0; p.songs = []; p.songHistory = [];
}

function setPassives(p, ids, requestId) {
  const reject = reason => { send(p.ws, { t: 'passives:result', ok: false, reason, requestId }); sendPassives(p); };
  const clean = sanitizePassives(p, ids);
  if (!Array.isArray(ids) || ids.length > PASSIVE_LIMIT || clean.length !== ids.length || new Set(ids).size !== ids.length) return reject(`Choose up to ${passiveSlotLimit(p)} different unlocked passives from your class. Slots unlock at levels 5, 15 and 30.`);
  const reason = passiveLockReason(p); if (reason) return reject(reason);
  if (JSON.stringify([...clean].sort()) !== JSON.stringify([...(p.passives || [])].sort())) {
    clearPassiveOwnedEffects(p);
    p.passives = clean; checkpointRequested = true; sendStatus(p); sendAbilities(p);
  }
  sendPassives(p); send(p.ws, { t: 'passives:result', ok: true, requestId });
}

// ---- Abilities (the action bar) ----
function abilityList(p) {
  return classDef(p.cls).abilities.map(a => ({ id: a.id, name: a.name, level: a.level, cd: a.cd || 0, cost: isSpell(a) ? costOf(p, a) : Math.round((a.cost || 0) * (isBardSpell(a) ? 1 - passiveValue(p, 'bardCost') : 1)), desc: a.desc,
    passive: !!a.passive, kind: a.kind || null, known: p.known.has(a.id), price: abilityCost(a),
    locked: p.level < a.level || !p.known.has(a.id), left: Math.max(0, p.cooldowns[a.id] || 0) }));
}
// Buy an ability from the class trainer standing nearby.
function learnAbility(p, id) {
  const say = (text) => notice(p, text);
  const a = classDef(p.cls).abilities.find(x => x.id === id); if (!a) return;
  const trainer = (zoneOf(p).npcs || []).find(n => n.trainer === p.cls && dist2(n.x, n.z, p.x, p.z) < 8 * 8);
  if (!trainer) return say('Find your class trainer to learn that.');
  if (p.known.has(id)) return say(`You already know ${a.name}.`);
  if (p.level < a.level) return say(`${a.name} needs level ${a.level}.`);
  const price = abilityCost(a);
  if (p.gold < price) return say(`${a.name} costs ${price} gp — you have ${p.gold}.`);
  p.gold -= price; p.known.add(id);
  send(p.ws, { t: 'event', kind: 'learned', id, name: a.name, price });
  sendBag(p); sendAbilities(p); sendPassives(p);
}
function sendAbilities(p) {
  const c = classDef(p.cls);
  send(p.ws, { t: 'abilities', cls: c.name, clsId: p.cls, icon: c.icon, background: c.background, resource: c.resource || 'Stamina', gcd: c.gcd || 0, list: abilityList(p), gcdLeft: p.gcd || 0 });
}
function sendStatus(p) { // buffs / momentum / rage, for the HUD
  const buffs = Object.entries(p.buffs).filter(([, b]) => b.t > 0).map(([id, b]) => ({ id, t: Math.round(b.t), charges: b.charges || 0 }));
  send(p.ws, { t: 'status', momentum: p.momentum || 0, buffs, riposte: !!(p.buffs.riposte_ready && p.buffs.riposte_ready.t > 0) });
}
// A press that lands just before you're free shouldn't be thrown away — the
// difference between combat that feels deliberate and combat that feels
// broken. Anything inside this window waits its turn instead of being lost.
const QUEUE_WINDOW = 0.75;
function queueAbility(p, id) { p.queued = { id, t: QUEUE_WINDOW + 0.25 }; send(p.ws, { t: 'event', kind: 'queued', id }); }
function stepQueue(p) {
  const q = p.queued; if (!q) return;
  q.t -= DT;
  if (q.t <= 0) { p.queued = null; send(p.ws, { t: 'event', kind: 'queued', id: null }); return; }
  if ((p.gcd || 0) > 0 || p.windup || p.channel) return;
  p.queued = null; send(p.ws, { t: 'event', kind: 'queued', id: null });
  useAbility(p, q.id, true);
}
function useAbility(p, id, fromQueue) {
  const c = classDef(p.cls), a = c.abilities.find(x => x.id === id);
  const say = (text) => notice(p, text);
  if (!a || !p.alive || a.passive) return;
  if (!p.known.has(id)) return say(`You haven't learned ${a.name}.`);
  if (p.level < a.level) return say(`${a.name} unlocks at level ${a.level}.`);
  // Busy, but nearly free: hold the press instead of dropping it.
  const busy = Math.max(a.offGcd ? 0 : p.gcd || 0, p.windup ? p.windup.t : 0, p.channel ? 0.2 : 0);
  if (!fromQueue && busy > 0 && busy <= QUEUE_WINDOW && (p.cooldowns[id] || 0) <= busy) return queueAbility(p, id);
  if (p.swimming) return say('Not while you are swimming.');
  if ((p.cooldowns[id] || 0) > 0) return say(`${a.name} is not ready.`);
  if (p.channel || p.windup) return say('You are busy.');
  if (!a.offGcd && (p.gcd || 0) > 0) return;
  if (a.requires && !(p.buffs[a.requires] && p.buffs[a.requires].t > 0)) return say(`${a.name} needs an enemy to have just missed you.`);
  const freeProc = Object.values(p.buffs).find(b => b.t > 0 && b.free && b.charges > 0);
  const cost = freeProc ? 0 : (isSpell(a) ? costOf(p, a) : Math.round((a.cost || 0) * (isBardSpell(a) ? 1 - passiveValue(p, 'bardCost') : 1)));
  if (resOf(p) < cost) return say(`Not enough ${(c.resource || 'rage').toLowerCase()}.`);
  if (isSpell(a)) { const err = checkCast(clericCtx, p, a); if (err) return say(err); }
  if (isBardSpell(a)) { const err = checkBardCast(clericCtx, p, a); if (err) return say(err); }
  const target = combatTargetOf(p);
  const inReach = target && target.alive && dist2(p.x, p.z, target.x, target.z) <= reachOf(p) ** 2;
  const needTarget = ['melee', 'execute', 'cone', 'rush'].includes(a.kind);
  if (needTarget && !(target && target.alive)) return say('You need a target.');
  if (needTarget && target.untargetable) return say(`${target.name} is out of reach!`);
  if (['melee', 'execute', 'cone'].includes(a.kind) && !inReach) return say('You need to be in reach.');
  if (a.kind === 'execute' && target.hp > target.maxHp * 0.3) return say(`${a.name} needs the target at 30% health or less.`);
  if (a.kind === 'rush' && dist2(p.x, p.z, target.x, target.z) > a.range * a.range) return say('Too far to rush.');
  if (a.kind === 'rush' && !lineClear(zoneOf(p), p.x, p.z, target.x, target.z)) return say('No clear path to rush.');

  const fire = () => {
    if (isSpell(a)) { castSpell(clericCtx, p, a); sendStatus(p); return; }
    if (isBardSpell(a)) { castBard(clericCtx, p, a); sendStatus(p); return; }
    const t = combatTargetOf(p);
    if (['melee', 'execute'].includes(a.kind) && !(t && t.alive && dist2(p.x, p.z, t.x, t.z) <= reachOf(p) ** 2)) return;
    switch (a.kind) {
      case 'melee': {
        const extra = {};
        if (id === 'heavy_riposte') { const r = p.buffs.riposte_ready; if (r && r.since <= 3) extra.crit = 0.15; delete p.buffs.riposte_ready; }
        if (id === 'titan_chop' && (p.momentum || 0) >= 3) extra.critDmg = 0.2;
        if (id === 'perfect_masterstroke') {
          const n = p.momentum || 0; extra.flat = a.spendMomentum.flat * n; extra.wd = a.spendMomentum.wd * n; p.momentum = 0;
          if (t.debuffs && t.debuffs.split_guard > 0) extra.mult = 1.15;
        }
        if (a.interrupt) interruptMonster(t, p);
        const before = t.hp, dmg = abilityHit(p, t, a, extra);
        if (a.debuff && dmg > 0) { t.debuffs = t.debuffs || {}; t.debuffs[a.debuff.id] = a.debuff.dur; if (a.debuff.id === 'bonebreak') t.debuffs.bonebreak_atk = 8; }
        if (a.selfDebuff) addBuff(p, a.selfDebuff);
        if (a.momentum && dmg > 0) addMomentum(p, a.momentum + (id === 'heavy_swing' && p.lastHit && p.lastHit.crit ? 1 : 0));
        if (id === 'perfect_masterstroke' && before > 0 && !t.alive && !t.passive) p.rage = Math.min(p.rageMax, p.rage + 50);
        break;
      }
      case 'execute': {
        const missing = 1 - t.hp / t.maxHp;                      // 0.7 .. 1
        const bonus = Math.min(0.75, Math.max(0, (missing - 0.7) / 0.3) * 0.75);
        const dmg = abilityHit(p, t, a, { mult: 1 + bonus });
        if (dmg > 0) addMomentum(p, t.alive ? 1 : 2);
        if (!t.alive) p.rage = Math.min(p.rageMax, p.rage + 30);
        break;
      }
      case 'cone': {
        const hits = monstersNear(p, p.x, p.z, ATTACK_RANGE + aoeRadius(p, a), a.cap, a.cone);
        let landed = 0; for (const m of hits) if (abilityHit(p, m, a) > 0) landed++;
        if (a.momentumIf2 && landed >= 2) addMomentum(p, a.momentumIf2);
        break;
      }
      case 'aoe': {
        const hits = monstersNear(p, p.x, p.z, aoeRadius(p, a), a.cap);
        let landed = 0;
        for (const m of hits) {
          const extra = (m.debuffs && m.debuffs.crushed_armor > 0) ? { mult: 1.1 } : {};
          if (a.interrupt || a.stagger) interruptMonster(m, p);   // a stagger breaks concentration
          if (abilityHit(p, m, a, extra) > 0) { landed++; if (a.stagger && !m.elite) m.stagger = Math.max(m.stagger || 0, a.stagger); else if (a.stagger) m.stagger = Math.max(m.stagger || 0, 0.3); }
        }
        if (a.momentumIf2 && landed >= 2) addMomentum(p, a.momentumIf2);
        break;
      }
      case 'channel': {
        p.channel = { id, ticks: a.ticks, t: 1, landed2: false }; p.moveTo = null;
        break;
      }
      case 'rush': {
        if (a.interrupt) interruptMonster(t, p);   // a shoulder in the chest stops a spell dead
        if (a.threatSpike) { addThreat(t, p.id, a.threatSpike); retarget(t); }
        // Charge: land just short of the target, facing it, and take it as the fight.
        const d = Math.hypot(t.x - p.x, t.z - p.z); if (d > 1.6) { const k = (d - 1.4) / d; p.x += (t.x - p.x) * k; p.z += (t.z - p.z) * k; }
        p.yaw = Math.atan2(t.x - p.x, t.z - p.z); p.combatId = t.id; p.moveTo = null;
        addBuff(p, a.buff);
        break;
      }
      case 'self': {
        if (a.buff) addBuff(p, a.buff);
        // A roar that everything in earshot takes personally.
        if (a.taunt) {
          for (const m of monstersNear(p, p.x, p.z, a.taunt, 12)) { taunt(m, p.id); m.provoked = true; retarget(m); }
          broadcast({ t: 'event', kind: 'taunt', by: p.id, r: a.taunt });
        }
        break;
      }
    }
    if (['melee', 'execute', 'cone', 'aoe'].includes(a.kind)) spendCharges(p, a);
  };
  spendRes(p, cost);
  // Spending a proc: only an ability that would actually have cost something
  // burns the free cast, so a free cantrip can't eat the window.
  if (freeProc && (isSpell(a) ? costOf(p, a) : (a.cost || 0)) > 0) {
    freeProc.charges--; if (freeProc.charges <= 0) delete p.buffs[freeProc.id];
  }
  p.cooldowns[id] = a.cd || 0; p.gcd = Math.max(p.gcd || 0, gcdFor(p, a));
  const gcd = p.gcd;
  let windup = a.windup || a.cast || 0;
  if (windup && a.cast) windup = Math.max(Math.min(windup, 1), windup * castTimeMult(p));   // Battle Hymn quickens casts, never under a second
  if (windup) { p.windup = { id, t: windup, dur: windup, cost, fire }; broadcast({ t: 'event', kind: 'ability', by: p.id, id, name: a.name, windup, gcd }); }
  else { broadcast({ t: 'event', kind: 'ability', by: p.id, id, name: a.name, gcd }); fire(); }
  sendAbilities(p); sendStatus(p);
}
// Per-tick class upkeep: rage, cooldowns, buffs, momentum, wind-ups, channels.
function stepClass(p, inCombat) {
  const c = classDef(p.cls), R = c.rage, M = c.mana;
  const cs = classStats(p.cls, p.level);
  p.rageMax = cs.rage; p.manaMax = cs.mana;
  if (p.rage == null) p.rage = 0;
  if (R) {
    // Rage builds while in a fight and bleeds away a while after it ends.
    if (inCombat) { p.rage = Math.min(p.rageMax, p.rage + R.combatTick * DT * (1 + passiveValue(p, 'rageGain'))); p.rageIdle = 0; }
    else { p.rageIdle = (p.rageIdle || 0) + DT; if (p.rageIdle > R.decayDelay) p.rage = Math.max(0, p.rage - R.decay * DT); }
  }
  if (M) {
    // Mana: a share of the pool every few seconds, far more of it out of a fight.
    if (p.mana == null) p.mana = p.manaMax;
    const rate = (inCombat ? M.combatRegen : M.idleRegen) * (p.resting ? 1.5 : 1) * manaRegenMult(p, inCombat) / M.period;
    p.mana = Math.min(p.manaMax, p.mana + p.manaMax * rate * DT);
  }
  stepHots(clericCtx, p, DT); stepSongs(clericCtx, p, DT);
  p.gcd = Math.max(0, (p.gcd || 0) - DT);
  stepQueue(p);
  p.savageCd = Math.max(0, (p.savageCd || 0) - DT);
  if (p.slow && p.slow.t > 0) p.slow.t -= DT;
  if (p.dots) for (const [k, d] of Object.entries(p.dots)) {   // bleeds / burns tick every 1.5 s
    d.t -= DT; d.acc += DT;
    if (d.acc >= 1.5) { d.acc -= 1.5; hurtPlayer(p, Math.round(d.dps * 1.5), null, k, undefined, { isPeriodic: true }); }
    if (d.t <= 0) delete p.dots[k];
  }
  for (const k of Object.keys(p.cooldowns)) if (p.cooldowns[k] > 0) p.cooldowns[k] = Math.max(0, p.cooldowns[k] - DT);
  let statusDirty = false;
  for (const [k, bf] of Object.entries(p.buffs)) {
    if (typeof bf !== 'object') { delete p.buffs[k]; continue; }
    bf.t -= DT; bf.since = (bf.since || 0) + DT;
    if (bf.t <= 0) { delete p.buffs[k]; statusDirty = true; }
  }
  if ((p.momentum || 0) > 0) { p.momentumT -= DT; if (p.momentumT <= 0) { p.momentum = 0; statusDirty = true; } }
  if (p.windup) {
    p.windup.t -= DT;
    if (p.moving) { // moving breaks the wind-up: give the resource and cooldown back
      const a = c.abilities.find(x => x.id === p.windup.id);
      if (a) { refundRes(p, p.windup.cost != null ? p.windup.cost : (a.cost || 0)); p.cooldowns[a.id] = 0; }
      p.windup = null; send(p.ws, { t: 'event', kind: 'notice', text: 'Interrupted.' }); sendAbilities(p);
      broadcast({ t: 'event', kind: 'ability', by: p.id, id: a ? a.id : null, cancel: true });
    } else if (p.windup.t <= 0) { const w = p.windup; p.windup = null; w.fire(); }
  }
  if (p.channel) {
    const ch = p.channel, a = c.abilities.find(x => x.id === ch.id);
    if (p.moving && a && a.kind === 'hymn') { p.channel = null; send(p.ws, { t: 'event', kind: 'notice', text: 'Interrupted.' }); broadcast({ t: 'event', kind: 'ability', by: p.id, id: a.id, cancel: true }); }
    else {
      ch.t -= DT;
      if (ch.t <= 0 && a) {
        ch.t += ch.period || 1; ch.ticks--;
        if (a.kind === 'hymn') hymnTick(clericCtx, p, a);
        else {
          const hits = monstersNear(p, p.x, p.z, aoeRadius(p, a), a.cap);
          let landed = 0; for (const m of hits) if (abilityHit(p, m, a) > 0) landed++;
          if (landed >= 2) ch.landed2 = true;
        }
        if (ch.ticks <= 0) { if (ch.landed2) addMomentum(p, 1); if (a.kind !== 'hymn') spendCharges(p, a); p.channel = null; }
      }
    }
  }
  if (statusDirty) sendStatus(p);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
// Hurt a player from any source (a monster, a hazard, a boss mechanic):
// health, combat lockout, rage, the hit splat, and death.
const LOGOUT_COMBAT_WAIT = 30;   // seconds out of combat before a player may log out
const VIS_BUFFS = new Set(['renewing_prayer', 'prayer_of_mending', 'divine_intervention', 'guardian_prayer', 'avatar_of_mercy']);   // buffs the client draws on the body

// A monster reaching for its trick. Returns true if it started something and
// the ordinary step should stand down this tick.
function tryMonsterAbility(m, target, d, arch) {
  // Cornered and bleeding: some things find a second wind rather than a trick.
  if (arch.enrage && !m.enraged && m.hp <= m.maxHp * arch.enrage) {
    m.enraged = true; m.dmgMult = (m.dmgMult || 1) * 1.5; m.attackSpeed = Math.max(2, (m.attackSpeed || 4) * 0.7);
    broadcast({ t: 'event', kind: 'enrage', monster: m.id, name: m.name });
    systemChat(`${m.elite ? m.name : 'The ' + m.name} goes berserk!`);
  }
  m.abilityCd = Math.max(0, (m.abilityCd || 0) - DT);
  if (m.abilityCd > 0 || (m.debuffs && m.debuffs.silenced > 0)) return false;
  // A healer that sees a hurt friend fixes that before anything else.
  let ab = arch.ability;
  if (ab && ab.heal && !woundedAlly(m)) ab = arch.ability2;
  else if (arch.ability2 && Math.random() < 0.4) ab = arch.ability2;
  if (!ab) return false;
  m.abilityCd = ab.cd;
  if (!ab.cast) { fireMonsterAbility(m, ab, target); return false; }
  m.cast = { ab, t: ab.cast, dur: ab.cast, targetId: target.id };
  broadcast({ t: 'event', kind: 'mobcast', by: m.id, name: ab.name, dur: ab.cast, interruptible: !!ab.interruptible, telegraph: ab.telegraph || null });
  return true;
}
// The most wounded friend within earshot of a healer, if any.
function woundedAlly(m) {
  let best = null, worst = 0.85;
  for (const o of monsters.values()) {
    if (!o.alive || o.zoneId !== m.zoneId || o.passive) continue;
    if (dist2(o.x, o.z, m.x, m.z) > 18 ** 2) continue;
    const frac = o.hp / o.maxHp;
    if (frac < worst) { worst = frac; best = o; }
  }
  return best;
}
function stepMonsterCast(m) {
  const c = m.cast;
  c.t -= DT;
  const t = players.get(c.targetId);
  if (!t || !t.alive || t.zoneId !== m.zoneId) { m.cast = null; broadcast({ t: 'event', kind: 'mobcast', by: m.id, cancel: true }); return; }
  m.yaw = Math.atan2(t.x - m.x, t.z - m.z);
  if (c.t <= 0) { m.cast = null; fireMonsterAbility(m, c.ab, t); }
}
// Break a monster's cast. Any stun, sleep, fear or dedicated interrupt does
// it; the monster is then locked out of that trick for a few seconds, which is
// what makes an interrupt worth holding a cooldown for.
function interruptMonster(m, by, lockout = 5) {
  if (!m || !m.cast) return false;
  const name = m.cast.ab.name;
  m.cast = null; m.abilityCd = Math.max(m.abilityCd || 0, lockout);
  broadcast({ t: 'event', kind: 'mobcast', by: m.id, cancel: true, interrupted: true, name });
  if (by && by.ws) send(by.ws, { t: 'event', kind: 'notice', text: `Interrupted ${m.elite ? m.name : 'the ' + m.name}'s ${name}!` });
  return true;
}
function fireMonsterAbility(m, ab, target) {
  const arch = MOB_ARCH[m.arch] || MOB_ARCH.warrior;
  if (ab.self) { m.debuffs = m.debuffs || {}; m.debuffs[ab.self.id] = ab.self.dur; broadcast({ t: 'event', kind: 'mobbuff', by: m.id, id: ab.self.id, name: ab.name, dur: ab.self.dur }); return; }
  if (ab.heal) {
    const friend = woundedAlly(m) || m;
    const amt = Math.round(friend.maxHp * ab.heal);
    friend.hp = Math.min(friend.maxHp, friend.hp + amt);
    broadcast({ t: 'event', kind: 'mobheal', by: m.id, target: friend.id, amount: amt, name: ab.name });
    return;
  }
  if (!target || !target.alive || target.zoneId !== m.zoneId) return;
  monsterStrike(m, target, { mult: ab.mult || 1, poison: ab.poison, name: ab.name, type: arch.dmgType });
}

// One monster blow landing on a player, rolled on the same attack table the
// player's own swings use — so a shield or a well-timed dodge reads the same
// from either side of the fight.
function monsterStrike(m, target, o = {}) {
  const arch = MOB_ARCH[m.arch] || MOB_ARCH.warrior;
  const mid = (m.maxHit || 1) * 0.5 * (o.mult || 1) * (m.dmgMult || 1);
  const res = resolveAttack({
    level: m.atkLevel || 1, hitBonus: (m.atkBonus || 0) * 0.004, type: o.type || arch.dmgType,
    crit: m.elite ? 0.08 : 0.05, critMult: 1.8,
    band: [Math.max(1, Math.round(mid * 0.72)), Math.max(2, Math.round(mid * 1.28))],
    mult: incomingMult(target),
  }, defenceProfile(target, m.x, m.z));
  target.lastCombat = Date.now();
  // A swing that goes nowhere is an opening — Heavy Riposte reads this.
  if (res.dmg <= 0) addBuff(target, { id: 'riposte_ready', dur: 300 });
  if (res.dmg > 0) {
    hurtPlayer(target, res.dmg, m, o.kind || o.type || arch.dmgType, res);
    if (o.poison && target.alive) addDot(target, 'poison', 12, o.poison / 3);
  } else {
    engage(target, m);
    broadcast({ t: 'event', kind: 'hit', by: m.id, target: target.id, dmg: 0, targetKind: 'player', res: res.outcome, spell: o.name || null });
  }
  // Auto-retaliate: if the player isn't already fighting, strike back.
  if (target.alive && target.combatId == null && !target.pendingMine) { target.combatId = m.id; target.moveTo = null; }
  return res;
}
// The impact frame of a monster's ordinary swing.
function landMonsterSwing(m) {
  const sw = m.swing; m.swing = null;
  const t = players.get(sw.id);
  const arch = MOB_ARCH[m.arch] || MOB_ARCH.warrior;
  const reach = (arch.range || ATTACK_RANGE) + 1.5;
  if (!t || !t.alive || t.zoneId !== m.zoneId || dist2(t.x, t.z, m.x, m.z) > reach ** 2) return;
  monsterStrike(m, t);
}

// Element / hitKind is visual; only explicit metadata marks periodic damage.
function hurtPlayer(p, dmg, m, kind, res, damage = {}) {
  if (!p.alive || dmg <= 0) return;
  if (m && m.debuffs) dmg = Math.max(1, Math.round(dmg * monsterDmgMult(m) * bardMonsterDmgMult(m)));
  const mit = mitigate(clericCtx, p, dmg, m, damage); dmg = mit.dmg;
  if (dmg >= p.hp) dmg = onLethal(clericCtx, p, dmg);
  p.hp -= dmg; p.combatTimer = REGEN.combatLockout; p.lastCombat = Date.now();
  if (classDef(p.cls).rage) addRage(p, (dmg + mit.absorbed) * classDef(p.cls).rage.damageTaken);
  if (m) engage(p, m);
  broadcast({ t: 'event', kind: 'hit', by: m ? m.id : null, target: p.id, dmg, absorbed: mit.absorbed || undefined, targetKind: 'player',
              hitKind: kind || null, res: res ? res.outcome : (dmg > 0 ? 'hit' : 'miss'), blocked: (res && res.blocked) || 0, spell: (res && res.spell) || undefined });
  if (p.alive && p.hp > 0) afterHit(clericCtx, p, dmg + mit.absorbed, damage);
  if (mit.changed) sendStatus(p);
  if (p.hp <= 0) {
    if (m) { m.targetId = null; m.provoked = false; m.state = 'idle'; }
    killPlayer(p, `was slain by ${m ? (m.elite ? m.name : 'a ' + m.name) : (kind === 'poison' ? 'poison' : 'fire')}`);
  }
}
// Death. Everything the player carried and wore goes into a gravestone where
// they fell; it stands for GRAVE_TTL seconds, and only they can dig it up.
const GRAVE_TTL = 120;
const graves = new Map();
for (const g of worldStore.state.graves) { const id = nextId++; graves.set(id, { ...g, id, owner: null }); }
for (const g of worldStore.state.groundItems) { const id = nextId++; groundItems.set(id, { ...g, id, owner: null }); }
function killPlayer(p, how) {
  // Escrow is still carried property: return it before taking the grave snapshot.
  // Gold stays in the purse on death, including refunded trade gold.
  tradeAbort(p, 'The trade is off.');
  if (p.buffs) delete p.buffs.brace; // A short defensive stance ends when its owner falls.
  p.hp = 0; p.alive = false; p.deathTimer = RESPAWN_TIME; p.engagedWith = null;
  // Where you fell, so you can be put back on the ground that belongs to it.
  // Taken here rather than at respawn because by then you have been lying in
  // the dark for five seconds and nothing says your corpse is where it died.
  p.diedAt = { zoneId: p.zoneId, x: p.x, z: p.z, y: p.y || 0 };
  // The fishing STATE, not just the intent to fish. `fishing` is what the
  // snapshot sends and stepFishing is the only thing that clears it -- and
  // stepFishing does not run for a corpse. A dead player lay on the bank
  // frozen a quarter of the way through a cast, rod still in hand, until they
  // respawned.
  p.pendingFish = null; p.fishing = null; p.fishBite = 0; p.fishOnLine = null; p.fishReel = 0;
  p.swing = null; p.queued = null;
  for (const m of monsters.values()) if (m.zoneId === p.zoneId) { dropThreat(m, p.id); if (m.targetId === p.id) { m.targetId = null; retarget(m); } }
  systemChat(`${p.name} ${how}.`);
  const items = p.inventory.slice(), equipment = { ...p.equipment };
  const hasGear = items.length || Object.values(equipment).some(Boolean);
  if (hasGear) {
    const id = nextId++;
    graves.set(id, { id, zoneId: p.zoneId, x: +p.x.toFixed(2), z: +p.z.toFixed(2), name: p.name, owner: p.id, items, equipment, ttl: GRAVE_TTL });
    p.inventory = []; p.equipment = emptySlots(); p.gear = gearOf(p.equipment);
    sendBag(p);
    send(p.ws, { t: 'event', kind: 'grave', id, text: `Your belongings lie in a grave where you fell. You have ${GRAVE_TTL / 60} minutes to get back to them.` });
  }
  send(p.ws, { t: 'event', kind: 'death' });
}
function stepGraves() {
  for (const [id, g] of graves) {
    g.ttl -= DT;
    if (g.ttl <= 0) {
      graves.delete(id);
      const owner = [...players.values()].find(q => q.name === g.name);
      if (owner) send(owner.ws, { t: 'event', kind: 'notice', text: 'Your grave has crumbled away, and everything in it with it.' });
    }
  }
}
function lootGrave(p, id) {
  const g = graves.get(id); if (!g || g.zoneId !== p.zoneId) return;
  const say = (text) => notice(p, text);
  if (dist2(p.x, p.z, g.x, g.z) > 3.5 * 3.5) return say('You need to be at the grave.');
  if (g.name !== p.name) return say(`This is ${g.name}'s grave. It is not yours to open.`);
  let n = 0;
  for (const [slot, name] of Object.entries(g.equipment)) { if (!name) continue; if (!p.equipment[slot]) p.equipment[slot] = name; else p.inventory.push(name); n++; }
  for (const name of g.items) { p.inventory.push(name); n++; }
  p.gear = gearOf(p.equipment);
  graves.delete(id);
  send(p.ws, { t: 'event', kind: 'loot', text: `You recover ${n} item${n === 1 ? '' : 's'} from your grave.`, gold: p.gold });
  sendBag(p);
}
function graveList(zid) {
  const out = [];
  for (const g of graves.values()) if (g.zoneId === zid) out.push({ id: g.id, x: g.x, z: g.z, name: g.name, owner: g.owner, ttl: Math.ceil(g.ttl) });
  return out;
}
function addSlow(p, t, k) { const ck = controlMult(p); if (ck < 1) spendSongCharges(clericCtx, p, 'control'); p.slow = { t: t * ck, k }; }
function addDot(p, kind, t, dps) { if (!p.alive || resistsDot(clericCtx, p)) return; p.dots = p.dots || {}; p.dots[kind] = { t, dps, acc: 0 }; }
// What the Cleric module needs from the world.
const clericCtx = {
  players, monsters, send, broadcast, systemChat, zoneOf, addBuff, applyHit, critChance, sendStatus, dmgBuff, interruptMonster, addThreat, healThreat,
  nextId: () => nextId++,
};
const bossCtx = {
  players, monsters, zoneOf, broadcast, send, systemChat, makeMonster, killMonster, hurtPlayer, addSlow, addDot,
  resolveCollision, navStep, dist2, incomingMult, nextId: () => nextId++,
};

function stepMonster(m) {
  const zone = zoneOf(m);
  if (!m.alive) {
    m.respawnTimer -= DT;
    if (m.respawn >= 999999) { if (m.respawnTimer < 999999 - 8) monsters.delete(m.id); return; }   // a boss or its brood: gone for good after the corpse fades
    if (m.respawnTimer <= 0) {
      const pos = spawnInRegion(zone, m.spec.region, { passive: m.passive });
      m.x = pos.x; m.z = pos.z; m.home = { x: pos.x, z: pos.z }; m._nav = null;
      m.hp = m.maxHp; m.alive = true; m.state = 'idle'; m.targetId = null; m.atkTimer = 0;
      m.swing = null; m.cast = null; m.enraged = false; m.dmgMult = 1; m.abilityCd = rand(2, 6); clearThreat(m);
      // A respawn is a new creature: give it a new id, or the client would
      // interpolate the old corpse sliding over to the spawn point.
      monsters.delete(m.id); m.id = nextId++; monsters.set(m.id, m);
    }
    return;
  }
  m.atkTimer = Math.max(0, m.atkTimer - DT);
  if (m.swing) { m.swing.t -= DT; if (m.swing.t <= 0) landMonsterSwing(m); }   // the blow arrives
  // Debuffs wind down before anything branches. Boss, minion and ordinary
  // monsters each used to carry their own copy of this line; they are mutually
  // exclusive, so hoisting it changes nothing except the number of copies.
  if (m.debuffs) for (const k of Object.keys(m.debuffs)) { m.debuffs[k] -= DT; if (m.debuffs[k] <= 0) delete m.debuffs[k]; }
  if (m.boss === 'cluckifer') {
    stepCluckifer(bossCtx, m, DT); resolveCollision(zone, m, 1.2); return;
  }
  if (m.minion) {
    if (fleeStep(clericCtx, zone, m, DT)) { resolveCollision(zone, m, 0.5); return; }
    if (m.debuffs && m.debuffs.asleep > 0) return;
    stepMinion(bossCtx, m, DT); if (m.alive && m.speed > 0) resolveCollision(zone, m, 0.5); return;
  }
  if ((m.stagger || 0) > 0) { m.stagger -= DT; return; }   // staggered: can't move or swing
  if (fleeStep(clericCtx, zone, m, DT)) { resolveCollision(zone, m, PLAYER_RADIUS); return; }   // turned by a Cleric: running
  if (m.debuffs && m.debuffs.asleep > 0) { m.targetId = null; m.state = 'idle'; return; }   // a Bard's lullaby: out cold until struck
  const slowK = ((m.debuffs && m.debuffs.bonebreak > 0) ? 0.6 : 1) * bardMonsterSpeedMult(m);

  decayThreat(m, DT);
  if (m.cast) { stepMonsterCast(m); if (m.cast) { resolveCollision(zone, m, PLAYER_RADIUS); return; } }   // mid-cast: rooted to the spot

  retarget(m);   // whoever is top of the threat table is who it wants
  let target = m.targetId ? players.get(m.targetId) : null;
  if (target && (!target.alive || target.zoneId !== m.zoneId)) { target = null; m.targetId = null; dropThreat(m, m.targetId); }
  if (!target && !m.passive) { // passive mobs only fight when attacked
    let best = null, bestD = m.aggro ** 2;
    for (const p of players.values()) {
      if (!p.alive || p.zoneId !== m.zoneId || inSafeZone(zone, p.x, p.z)) continue; // safe zones block aggro
      if (engagedElsewhere(p, m)) continue;                                            // single-way: they're taken
      const d = dist2(m.x, m.z, p.x, p.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best) { target = best; m.targetId = best.id; m.state = 'combat'; addThreat(m, best.id, 1); }
  }

  if (target) {
    const d = Math.hypot(target.x - m.x, target.z - m.z);
    // Passive mobs have aggro 0, which used to give them a zero-length leash:
    // one step from home and they reset to full health, so a cow could almost
    // never be killed. Every mob gets a real minimum.
    const leash = m.elite ? ELITE.leash : Math.max(m.passive ? 20 : 12, m.aggro * 2.2);
    // A safe zone stops a monster hunting a player there, but not one hitting
    // back at whoever is attacking it (the penned cows never fought back, and
    // "returning" home from where they stood healed them to full each time).
    if (dist2(m.x, m.z, m.home.x, m.home.z) > leash ** 2) {
      m.targetId = null; m.provoked = false; m.state = 'return'; m.resetHp = true;
    } else if (!m.provoked && inSafeZone(zone, target.x, target.z)) {
      m.targetId = null; m.state = 'return';
    } else if (engagedElsewhere(target, m)) {
      m.targetId = null; m.provoked = false; m.state = 'idle';   // someone else has them; wait our turn
    } else {
      m.yaw = Math.atan2(target.x - m.x, target.z - m.z);
      const arch = MOB_ARCH[m.arch] || MOB_ARCH.warrior;
      const reach = arch.range || (ATTACK_RANGE - 0.5);
      const los = d <= reach && hasLos(zone, m.x, m.z, target.x, target.z);
      // Its own trick first: a shaman heals, an archer backs off, a berserker
      // works itself up. Only then does it fall back on swinging.
      if (los && tryMonsterAbility(m, target, d, arch)) { resolveCollision(zone, m, PLAYER_RADIUS); return; }
      if (arch.range && los && d < arch.kite) {
        // Archers and casters give ground rather than trade blows up close.
        const a = Math.atan2(m.x - target.x, m.z - target.z);
        const nx = m.x + Math.sin(a) * m.speed * slowK * DT, nz = m.z + Math.cos(a) * m.speed * slowK * DT;
        if (dist2(nx, nz, m.home.x, m.home.z) < (m.roam || 15) ** 2) { m.x = nx; m.z = nz; }
      } else if (d > reach || !los) {
        navStep(zone, m, target.x, target.z, los ? reach : 0.9, m.speed * slowK); // round fences, not through them
      } else if (m.atkTimer <= 0 && !m.swing) {
        m.atkTimer = (m.attackSpeed || 4) * TICK * ((m.debuffs && m.debuffs.bonebreak_atk > 0) ? 1.15 : 1) * bardMonsterAtkSpeedMult(m);
        const delay = Math.max(0.2, Math.min(0.7, m.atkTimer * IMPACT_AT));
        m.swing = { id: target.id, t: delay };
        broadcast({ t: 'event', kind: 'swing', by: m.id, target: target.id, dur: delay, arch: m.arch || 'warrior', type: arch.dmgType || 'crush', ranged: !!arch.range });
      }
      resolveCollision(zone, m, PLAYER_RADIUS);
      return;
    }
  }

  // Wander near home / return home.
  m.wanderTimer -= DT;
  if (m.state === 'return') {
    const dx = m.home.x - m.x, dz = m.home.z - m.z, d = Math.hypot(dx, dz);
    if (d < 1) { m.state = 'idle'; if (m.resetHp) m.hp = m.maxHp; m.resetHp = false; }
    else { m.yaw = Math.atan2(dx, dz); m.x += (dx / d) * m.speed * DT; m.z += (dz / d) * m.speed * DT; }
  } else if (m.wanderTimer <= 0) {
    m.wanderTimer = rand(2, 5);
    if (Math.random() < 0.5) { m.state = 'idle'; }
    else { const a = rand(0, Math.PI * 2); m.wanderDir = { x: Math.sin(a), z: Math.cos(a) }; m.yaw = a; m.state = 'wander'; }
  }
  if (m.state === 'wander') {
    m.x += m.wanderDir.x * m.speed * 0.4 * DT;
    m.z += m.wanderDir.z * m.speed * 0.4 * DT;
    if (dist2(m.x, m.z, m.home.x, m.home.z) > (m.roam || 15) ** 2) m.state = 'return';
  }
  resolveCollision(zone, m, PLAYER_RADIUS);
}

function stepPlayer(p) {
  sendPassives(p, true);
  if (!p.alive) { p.deathTimer -= DT; return; }
  const zone = zoneOf(p);
  p.canSwim = true;
  const wasSwimming = !!p.swimming;
  p.swimming = swimNow(zone, p);
  if (p.swimming !== wasSwimming) {
    // Out of the water you pick your weapon back up; into it you cannot fight.
    if (p.swimming) { p.combatId = null; p.windup = null; p.swing = null; p.channel = null; }
    send(p.ws, { t: 'event', kind: 'notice', text: p.swimming ? 'You wade in and start to swim.' : 'You climb out, dripping.' });
  }
  // --- breath -------------------------------------------------------------
  // Breath is AIR, and it only goes when your head is under the water. This
  // used to drain for the whole time you were swimming, which made it a swim
  // endurance bar wearing the word "Breath": you floated on the surface with
  // your head in plain sight, watching it empty, and then drowned standing in
  // a pond you could see over. Reported exactly that way.
  //
  // A swimmer floats -- the client draws the head clear of the surface and the
  // stroke to match -- so swimming costs nothing now. What still costs is being
  // UNDER: on the bed, feet down, with the surface over your head. The server
  // keeps p.y on the bed whether you are swimming or not, so that is the water
  // column against your own height, and it is only reachable when something
  // holds you down there -- you go out of your depth and start swimming well
  // before a channel gets that deep.
  if (p.breath == null) p.breath = BREATH_MAX;
  const head = (p.y || 0) + HEAD_HEIGHT;
  const under = !p.swimming && waterLevelAt(zone, p.x, p.z) > head && !onDeck(zone, p.x, p.z, 0.4);
  if (under) {
    const hard = !!(p.moving || (p.input && (p.input.f !== 0 || p.input.r !== 0)) || p.moveTo);
    p.breath = Math.max(0, p.breath - (hard ? BREATH_SWIM : BREATH_TREAD) * DT);
    if (p.breath <= 0) {
      // Going under. It hurts, and it keeps hurting until you reach a bank.
      p.drownAccum = (p.drownAccum || 0) + DROWN_DPS * DT;
      if (p.drownAccum >= 1) {
        const d = Math.floor(p.drownAccum); p.drownAccum -= d;
        p.hp -= d;
        p.combatTimer = REGEN.combatLockout;          // no resting it off mid-lake
        send(p.ws, { t: 'event', kind: 'hazard', dmg: d, hazard: 'drowning' });
        if (p.hp <= 0) { killPlayer(p, 'drowned'); return; }
        if (!p.drownSaid || Date.now() - p.drownSaid > 3000) {
          p.drownSaid = Date.now();
          send(p.ws, { t: 'event', kind: 'notice', text: 'You cannot get a breath!' });
        }
      }
    } else if (p.breath < BREATH_MAX * 0.28 && !p.breathWarned) {
      p.breathWarned = true;
      send(p.ws, { t: 'event', kind: 'notice', text: 'Your chest is burning — get your head up.' });
    }
  } else {
    p.drownAccum = 0;
    if (p.breath < BREATH_MAX) {
      p.breath = Math.min(BREATH_MAX, p.breath + BREATH_REGAIN * DT);
      if (p.breath > BREATH_MAX * 0.5) p.breathWarned = false;
    }
  }
  p.atkTimer = Math.max(0, p.atkTimer - DT);
  if (p.swing) { p.swing.t -= DT; if (p.swing.t <= 0) landPlayerSwing(p); }   // the axe reaches the target
  if (p.portalCd > 0) p.portalCd -= DT;
  let moved = false;
  const inp = p.input;
  // Meditating ends the moment the player wants to act (move / fight / interact)
  // or gets hit — you can't rest in the middle of a scrap.
  // Sitting ends the same way meditating does: the first thing you want to do
  // that is not sitting puts you back on your feet.
  if (p.seat) {
    const up = (inp && (inp.f !== 0 || inp.r !== 0)) || p.moveTo || p.combatId != null ||
      p.pendingChest || p.pendingPickup != null || p.pendingMine != null ||
      p.pendingFish != null || p.pendingCook != null || p.pendingUse || (p.combatTimer || 0) > 0 || !p.alive;
    if (up) standUp(p, true);
    // On a stool he swivels: the input packet carries the way the camera is
    // looking, so he turns with it and you are always seeing his front. A bed
    // keeps the yaw it was lain down with -- you do not pivot on a mattress.
    else if (p.seat.k === 'stool' && inp && typeof inp.yaw === 'number') p.yaw = inp.yaw;
  }
  if (p.resting) {
    const wantsAction = (inp && (inp.f !== 0 || inp.r !== 0)) || p.moveTo || p.combatId != null ||
      p.pendingChest || p.pendingPickup != null || p.pendingMine != null ||
      p.pendingFish != null || p.pendingCook != null;
    if (wantsAction || (p.combatTimer || 0) > 0) { p.resting = false; sendSkills(p); }
  }
  const step = (tx, tz, stopDist) => navStep(zone, p, tx, tz, stopDist, PLAYER_SPEED * moveMult(p));
  // Heading for a chair: walk to it, then sit when you arrive.
  if (p.pendingSeat && !p.seat) {
    const seat = seatById(zone, p.pendingSeat);
    if (!seat) p.pendingSeat = null;
    else {
      const a = seatApproach(seat);
      if (dist2(p.x, p.z, a.x, a.z) > SEAT_REACH * SEAT_REACH) { moved = step(a.x, a.z, SEAT_REACH * 0.8) || moved; }
      else { p.pendingSeat = null; sitDown(p, seat); }
    }
  }

  if (inp && (inp.f !== 0 || inp.r !== 0)) {
    // Manual WASD overrides click-to-move / combat.
    p.moveTo = null; p.combatId = null; p.pendingChest = null; p.pendingPickup = null; p.pendingMine = null; p.pendingFish = null; p.pendingCook = null; p._nav = null;
    // ...and the fishing STATE, not just the intent. Clearing pendingFish stops
    // the casting loop, but `fishing` is what the snapshot sends, and stepFishing
    // is the only thing that clears it -- which does not run for a corpse. A
    // dead player lay on the bank frozen a quarter of the way through a cast,
    // rod in hand, until they respawned.
    p.fishing = null; p.fishBite = 0; p.fishOnLine = null; p.fishReel = 0;
    const yaw = inp.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = Math.sin(yaw - Math.PI / 2), rz = Math.cos(yaw - Math.PI / 2);
    let mx = fx * inp.f + rx * inp.r, mz = fz * inp.f + rz * inp.r;
    const len = Math.hypot(mx, mz);
    if (len > 1e-4) {
      mx /= len; mz /= len;
      p.x += mx * PLAYER_SPEED * moveMult(p) * DT; p.z += mz * PLAYER_SPEED * moveMult(p) * DT;
      p.yaw = Math.atan2(mx, mz); moved = true;
    }
  } else if (p.combatId != null) {
    const m = combatTargetOf(p);
    if (!m || !m.alive || m.zoneId !== p.zoneId) { p.combatId = null; }
    else {
      // Walk into range AND into line of sight — no swinging through a fence;
      // the route goes round (through the gate) instead.
      const reach = reachOf(p) - 0.4;
      const inRange = dist2(p.x, p.z, m.x, m.z) <= reach ** 2, los = inRange && hasLos(zone, p.x, p.z, m.x, m.z);
      if (!inRange || !los) { if (p.windup || p.channel || p.swing) p.yaw = Math.atan2(m.x - p.x, m.z - p.z); /* casting: hold here */ else if (step(m.x, m.z, los ? reach : 0.9)) moved = true; }
      else if (p.swimming) { p.combatId = null; }   // both hands are busy staying afloat
      else { p._nav = null; p.yaw = Math.atan2(m.x - p.x, m.z - p.z); doPlayerAttack(p, m); }
    }
  } else if (p.pendingUse) {
    // Walk to the thing, then put your hands on it.
    const o = worldObject(zone, p.pendingUse);
    if (!o) { p.pendingUse = null; }
    else if (step(o.x, o.z, Math.max(1.2, (o.reach || 3.5) - 1.2))) { moved = true; }
    else { p.yaw = Math.atan2(o.x - p.x, o.z - p.z); const id = p.pendingUse; p.pendingUse = null; useWorldObject(p, id); }
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
    } else if (p.moveTo) {
    if (step(p.moveTo.x, p.moveTo.z, 0.5)) moved = true;
    else p.moveTo = null;
  }
  p.moving = moved;
  resolveCollision(zone, p, PLAYER_RADIUS);
  // Stand on the floor beneath us: step/ramp up onto surfaces, fall off ledges.
  const floor = floorHeightAt(zone, p.x, p.z, p.y || 0);
  if (floor >= (p.y || 0) - 0.01) p.y = floor; else p.y = Math.max(floor, (p.y || 0) - 16 * DT);

  // Ground seen. Before the portal check, so the step that carries you into a
  // cave mouth still uncovers the mouth on the map you are leaving.
  revealFog(p, zone);

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
        if (p.hp <= 0) killPlayer(p, `succumbed to the ${inHazard.label}`);
      }
    } else p.hazardAccum = 0;
  }

  // Healing: meditation (R) only, and never within a few seconds of a hit.
  // Food heals on eating (see 'eat'). There is no passive regen at all.
  p.combatTimer = Math.max(0, (p.combatTimer || 0) - DT);
  if (p.resting && p.hp < p.maxHp && p.combatTimer <= 0) {
    // Meditation: a heal tick every MEDITATION.tick seconds, with Meditation xp
    // for the tick and for the hitpoints recovered.
    p.medT = (p.medT || 0) + DT;
    if (p.medT >= MEDITATION.tick) {
      p.medT -= MEDITATION.tick;
      const heal = Math.min(p.maxHp - p.hp, Math.round(meditationHealPerTick(p.meditation.level) * meditationMult(p)));   // Perfect Harmony hastens it
      p.hp += heal; spendSongCharges(clericCtx, p, 'recovery');
      const xp = MEDITATION.xpPerTick + heal * MEDITATION.xpPerHp;
      addMeditationXp(p, xp);
      send(p.ws, { t: 'event', kind: 'medtick', heal, xp });
      if (p.hp >= p.maxHp) { p.resting = false; p.medT = 0; sendSkills(p); } // fully rested
    }
  } else p.medT = 0;
  // No passive regen: HP only comes back from food or meditating.
  p.inSafe = safe;
  p.engagedT = Math.max(0, (p.engagedT || 0) - DT);
  if (p.engagedT <= 0) p.engagedWith = null;
  stepClass(p, (p.combatTimer || 0) > 0 || p.combatId != null || (p.engagedT || 0) > 0);
}

// Every place buries its own. A zone with regions has one spawn point for all
// of them, so dying at Saint's Ruin woke you 1,100 m west in the Dark Woods and
// the whole walk back was the punishment. The region you died in has a
// graveyard; that is where you come to.
function graveyardFor(p) {
  const zone = ZONES[(p.diedAt && p.diedAt.zoneId) || p.zoneId] || zoneOf(p);
  const where = p.diedAt && p.diedAt.zoneId === zone.id ? p.diedAt : p;
  const place = placeAt(zone, where.x, where.z, where.y);
  return { zone, at: (place && place.graveyard) || zone.graveyard || zone.spawn };
}
// Relocations start from the destination floor, never the ledge we left.
// Authored y selects a raised storey; absent y selects ground/step-height floors.
function relocatePlayer(p, zone, at) {
  p.x = at.x; p.z = at.z;
  p.y = floorHeightAt(zone, p.x, p.z, Number.isFinite(at.y) ? at.y : 0);
  p.relocation = (p.relocation || 0) + 1;
}
function respawnPlayer(p) {
  const { zone, at } = graveyardFor(p);
  // Nothing moves a corpse, so the zone you died in is the one you are in --
  // but a disconnect or an editor teleport could break that, and waking up
  // inside another zone's coordinates would put you under the map.
  if (zone.id !== p.zoneId) { transitionPlayer(p, zone.id, at); p.alive = true; p.hp = p.maxHp; p.diedAt = null; return; }
  p.swing = null; p.queued = null;
  p.diedAt = null;
  relocatePlayer(p, zone, at); p.yaw = at.yaw != null ? at.yaw : p.yaw; p.hp = p.maxHp; p.rage = 0; p.mana = Math.round((p.manaMax || 0) * 0.5); p.buffs = {}; p.dots = null; p.slow = null; p.channel = null; p.windup = null; p.alive = true; p.moving = false; p.resting = false;
  p.moveTo = null; p.combatId = null; p.pendingChest = null; p.pendingPickup = null;
  send(p.ws, { t: 'event', kind: 'respawned' });
}

function transitionPlayer(p, toId, spawn) {
  const to = ZONES[toId];
  if (!to) { p.portalCd = 2; return; } // destination zone not built yet — ignore
  p.zoneId = toId;
  relocatePlayer(p, to, spawn); p.yaw = spawn.yaw || 0;
  p.input = { f: 0, r: 0, yaw: 0 }; p.moving = false; p.hazardAccum = 0;
  p.moveTo = null; p.combatId = null; p.pendingChest = null; p.pendingPickup = null; p.pendingMine = null;
  p.portalCd = 2; // don't immediately re-trigger the return portal
  revealFog(p, to);   // arriving is seeing: the cave mouth is on the map you land on
  sendScene(p, { t: 'transition', zone: zoneForClient(to), fog: fogPayload(p, to), visited: [...p.visited] });
  sendObjects(p);
  sendQuests(p); // giver markers are per-zone
  systemChat(`${p.name} entered ${to.name}.`);
}

// ---------------------------------------------------------------------------
// World objects: the things a quest asks you to put your hands on — a trail
// lantern to light, tracks to read, a signal fire to douse, a growth to cut
// back. Some are one-shot per player and stay done; the gathering ones (a
// clump of glowcaps) give an item and grow back for everyone after a while.
// ---------------------------------------------------------------------------
function worldObject(zone, id) { return (zone.objects || []).find(o => o.id === id); }
function objectReady(zone, o) { return !o._until || o._until <= Date.now(); }
function useWorldObject(p, id) {
  const zone = zoneOf(p), o = worldObject(zone, id);
  const say = (text) => notice(p, text);
  if (!o) return;
  if (dist2(p.x, p.z, o.x, o.z) > (o.reach || 3.5) ** 2) return say(`You need to be closer to the ${o.name.toLowerCase()}.`);
  // A toggle is world state, not yours: everyone standing there sees it go on
  // and off, and it does not care whose quest is running.
  if (o.toggle) {
    o._on = !o._on;
    // Lighting one counts for the errand that asked; putting it out again does
    // not un-count it. This branch returned before it ever reached recordUse,
    // so a toggled object could not advance a quest at all -- 'Trail lanterns
    // lit' sat at 0/3 however many lanterns you lit.
    const moved = o._on ? recordUse(p, o) : [];
    send(p.ws, { t: 'event', kind: 'used', id: o.id, tag: o.tag || null,
      text: o._on ? (o.textOn || `You light the ${o.name.toLowerCase()}.`) : (o.textOff || `You put the ${o.name.toLowerCase()} out.`) });
    broadcastObjects(zone);
    if (moved.length) notifyQuestProgress(p, moved); else sendQuests(p);
    return;
  }
  if (o.once && p.usedObjects.has(o.id)) return say(`You have already dealt with the ${o.name.toLowerCase()}.`);
  if (!objectReady(zone, o)) return say(`There is nothing left to take here yet.`);
  // Some things only make sense while you are on the errand that asked for them.
  if (o.quest && !p.quests.has(o.quest)) return say(o.idleText || 'You have no reason to touch that.');
  if (o.needDead && !((p.questKills[o.quest] || {})['★' + o.needDead] > 0)) return say(`${o.needDead} is still standing.`);
  if (o.need) {
    const have = p.inventory.filter(n => n === o.need.item).length;
    if (have < (o.need.count || 1)) return say(`You need ${o.need.count || 1} × ${o.need.item}.`);
    for (let i = 0; i < (o.need.count || 1); i++) p.inventory.splice(p.inventory.indexOf(o.need.item), 1);
  }
  if (o.gives) { for (let i = 0; i < (o.gives.count || 1); i++) p.inventory.push(o.gives.item); }
  if (o.hurt) hurtPlayer(p, o.hurt, null, 'poison');   // the red ones bite back
  if (o.respawn) o._until = Date.now() + o.respawn * 1000;
  if (o.once) { /* recorded below */ }
  const moved = recordUse(p, o);
  send(p.ws, { t: 'event', kind: 'used', id: o.id, tag: o.tag || null, text: o.text || null, item: o.gives ? o.gives.item : null });
  if (o.gives || o.need) sendBag(p);
  if (moved.length) notifyQuestProgress(p, moved);
  else sendQuests(p);
  broadcastObjects(zone);
}
// The world's shared view of these: which gathering nodes are picked clean.
function sendObjects(p) {
  const zone = zoneOf(p);
  const spent = (zone.objects || []).filter(o => !objectReady(zone, o)).map(o => o.id);
  const lit = (zone.objects || []).filter(o => o._on).map(o => o.id);   // shared: lanterns anyone has lit
  send(p.ws, { t: 'objects', spent, lit, used: [...p.usedObjects] });
}
function broadcastObjects(zone) { for (const q of players.values()) if (q.zoneId === zone.id) sendObjects(q); }

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
// Stopping the server should not cost anybody their evening.
let shuttingDown = false;
function saveEveryoneAndExit(sig, code = 0) {
  if (shuttingDown) return; shuttingDown = true;
  let n = 0;
  for (const p of [...players.values()]) {
    // Hand back anything sitting in escrow first, or the save writes it away.
    try { tradeAbort(p, 'The server is closing. The trade is off.'); } catch { /* keep saving */ }
    try { savePlayer(p); n++; } catch (e) { console.error(`[save] ${p.name} failed:`, e && e.message); }
  }
  console.log(`[save] ${sig}: wrote ${n} character${n === 1 ? '' : 's'}`);
  commitWorld(true);
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => saveEveryoneAndExit(sig));
// A fatal exception may leave partial in-memory ownership changes. Never save
// that state: stop and recover the last complete checkpoint on restart.
process.on('uncaughtException', (err) => { console.error('[fatal] recovering last complete checkpoint', err); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error('[fatal] unhandled rejection', err); process.exit(1); });
// Taking somebody out of the world, the only way it should be done.
//
// Order matters and used to be wrong: anything a player has on a trade table
// has already left their bag, so unwinding the trade has to happen BEFORE the
// save or the escrowed items and gold are written out of existence. The duel
// and the party come off first for the same reason -- what they hand back
// belongs in the file.
function leaveWorld(p) {
  clearPassiveOwnedEffects(p);
  tradeAbort(p, `${p.name} leaves. The trade is off.`);
  duelForfeit(p, `${p.name} leaves the duel.`);
  partyRemove(p, `${p.name} has left the party.`);
  savePlayer(p);
  players.delete(p.id);
  systemChat(`${p.name} has left the world.`);
}

setInterval(() => transaction(() => {
  if (DAY_NIGHT_CYCLE) dayTime = (dayTime + DT / DAY_LENGTH) % 1;
  weatherTimer -= DT;
  if (weatherTimer <= 0) {
    weather = WEATHER_POOL[Math.floor(Math.random() * WEATHER_POOL.length)];
    weatherTimer = 90 + Math.random() * 150;
  }
  stepVeins();
  for (const m of monsters.values()) stepMonster(m);
  for (const zone of Object.values(ZONES)) { stepHazards(bossCtx, zone, DT); stepSanctuaries(zone, DT); }
  for (const zone of Object.values(ZONES)) {          // only where somebody is around to see it
    let watched = false; for (const p of players.values()) if (p.zoneId === zone.id) { watched = true; break; }
    if (watched) for (const n of (zone.npcs || [])) stepNpc(zone, n, DT);
  }
  stepGraves();
  for (const p of players.values()) stepPlayer(p);
  for (const [id, p] of players) {   // bodies left behind by a mid-fight disconnect
    if (p.lingerT == null) continue;
    p.lingerT -= DT;
    if (p.lingerT <= 0 || !p.alive) leaveWorld(p);
  }
  for (const [id, it] of groundItems) { it.ttl -= DT; if (it.ttl <= 0) groundItems.delete(id); }
  for (const p of players.values()) {
    if (p.partyInvite) {
      p.partyInvite.t -= DT;
      if (p.partyInvite.t <= 0) { p.partyInvite = null; send(p.ws, { t: 'party:invite', expired: true }); }
    }
    if (p.duelChallenge) {
      p.duelChallenge.t -= DT;
      if (p.duelChallenge.t <= 0) { p.duelChallenge = null; send(p.ws, { t: 'duel:challenge', expired: true }); }
    }
    if (p.tradeRequest) {
      p.tradeRequest.t -= DT;
      if (p.tradeRequest.t <= 0) { p.tradeRequest = null; send(p.ws, { t: 'trade:request', expired: true }); }
    }
  }
  stepDuels(DT);
  stepTrades();
  // transaction() checkpoints the whole world every 45s, or immediately
  // when ownership/progression changes; per-character save slots are unsafe.

  const now = Date.now();
  if (now - lastSnap >= 1000 / SNAPSHOT_HZ || [...players.values()].some(p => p.ws.readyState === p.ws.OPEN && p.ws.sceneLoad?.needsSnapshot)) {
    lastSnap = now;
    // Build one snapshot per zone; each player only sees entities in their zone.
    const byZone = {};
    const zoneSnap = (zid) => {
      if (byZone[zid]) return byZone[zid];
      const ps = [], ms = [];
      for (const p of players.values()) {
        if (p.zoneId !== zid) continue;
        ps.push({ id: p.id, relocation: p.relocation || 0, name: p.name, x: +p.x.toFixed(2), z: +p.z.toFixed(2), y: +(p.y || 0).toFixed(2),
          yaw: +p.yaw.toFixed(2), hp: Math.round(p.hp), maxHp: p.maxHp, level: p.level,
          cls: p.cls,
          xp: p.xp - xpTotalForLevel(p.level), xpNext: classXpForLevel(p.level), classMaxLevel: MAX_CLASS_LEVEL, gold: p.gold, alive: p.alive,
          rage: Math.round(p.rage || 0), rageMax: p.rageMax || 0, momentum: p.momentum || 0,
          mana: p.manaMax ? Math.round(p.mana || 0) : undefined, manaMax: p.manaMax || undefined,
          channel: p.channel ? p.channel.id : null, windup: p.windup ? p.windup.id : null,
          castT: p.windup ? p.windup.dur : p.channel ? p.channel.dur : undefined,
          ward: (() => { let a = 0; for (const b of Object.values(p.buffs)) if (b.t > 0 && b.absorb > 0) a += b.absorb; return Math.round(a) || undefined; })(),
          fx: (() => { const o = []; for (const [k, b] of Object.entries(p.buffs)) if (b.t > 0 && (b.vis || VIS_BUFFS.has(k))) o.push(k); return o.length ? o : undefined; })(),
          swing: p.atkTimer > 0 ? { t: +p.atkTimer.toFixed(2), d: +playerAttackSpeed(p).toFixed(2) } : undefined,
          tgt: p.combatId != null ? p.combatId : undefined,   // who they are actually fighting
          seat: p.seat ? { k: p.seat.k, yaw: +p.seat.yaw.toFixed(2) } : undefined,
          duel: (() => { const d = duelOf(p); return d ? { foe: d.a === p.id ? d.b : d.a, ready: d.state === 'fighting' } : undefined; })(),
          moving: p.moving, swim: !!p.swimming || undefined,
          breath: p.breath != null && p.breath < BREATH_MAX ? Math.round(p.breath) : undefined, inSafe: !!p.inSafe, resting: !!p.resting, inCombat: (p.combatTimer || 0) > 0 || p.combatId != null,
          combatWait: p.lastCombat ? Math.max(0, Math.ceil(LOGOUT_COMBAT_WAIT - (Date.now() - p.lastCombat) / 1000)) : 0,
          weapon: p.equipment.weapon || null,     // held item for the paperdoll
          // Fishing, for everyone's client: the rod in hand, where the line is
          // going, how far through the cast, and the reel-in when one bites.
          fish: p.fishing ? {
            x: +p.fishing.x.toFixed(2), z: +p.fishing.z.toFixed(2), rod: p.fishing.rod,
            p: +Math.max(0, Math.min(1, 1 - p.fishTimer / (p.fishing.dur || 1))).toFixed(3),
            bite: p.fishBite > 0 ? +(p.fishBite / BITE_TIME).toFixed(2) : undefined,
            reel: p.fishReel > 0 ? +(p.fishReel / REEL_TIME).toFixed(2) : undefined,
            got: p.fishReel > 0 ? p.fishCaught : undefined,
          } : (p.fishReel > 0 ? { reel: +(p.fishReel / REEL_TIME).toFixed(2), got: p.fishCaught } : undefined),
          look: lookOf(p) });                        // hair / outfit / colours + worn armour
      }
      for (const m of monsters.values()) {
        if (m.zoneId !== zid) continue;
        ms.push({ id: m.id, type: m.type, name: m.name, level: m.level, elite: m.elite,
          x: +m.x.toFixed(2), z: +m.z.toFixed(2), yaw: +m.yaw.toFixed(2), y: +(m.y || 0).toFixed(2), cave: m.cave || undefined,
          hp: Math.round(m.hp), maxHp: m.maxHp, alive: m.alive,
          boss: m.boss || undefined, phase: m.phase || undefined, stun: m.stunT > 0 || undefined, hidden: m.untargetable || undefined, grow: m.grow != null ? +m.grow.toFixed(2) : undefined,
          asleep: (m.debuffs && m.debuffs.asleep > 0) || undefined, deb: hasBardDebuff(m) || undefined,
          arch: m.arch || undefined, enraged: m.enraged || undefined, tgt: m.targetId || undefined,
          cast: m.cast ? { n: m.cast.ab.name, t: +m.cast.t.toFixed(2), d: m.cast.dur, i: !!m.cast.ab.interruptible } : undefined });
      }
      const items = [];
      for (const it of groundItems.values()) {
        if (it.zoneId !== zid) continue;
        items.push({ id: it.id, name: it.name, qty: it.qty, x: +it.x.toFixed(2), z: +it.z.toFixed(2) });
      }
      const npcs = [];   // only the ones with somewhere to be; the rest never left their mark
      for (const n of (ZONES[zid].npcs || [])) {
        if (!n._route || n._route.stops.length < 2) continue;
        npcs.push({ id: n.id, x: +n.x.toFixed(2), z: +n.z.toFixed(2), yaw: +(n.yaw || 0).toFixed(2), m: n.moving ? 1 : undefined });
      }
      return (byZone[zid] = JSON.stringify({ t: 'snapshot', now, players: ps, monsters: ms, items, npcs,
        depleted: depletedIds(ZONES[zid]),
        hazards: hazardList(ZONES[zid]),
        sanct: sanctuaryList(ZONES[zid]),
        graves: graveList(zid),
        time: +dayTime.toFixed(4), weather }));
    };
    for (const p of players.values()) {
      if (p.ws.readyState !== p.ws.OPEN || sceneLoading(p.ws)) continue;
      sendRaw(p.ws, zoneSnap(p.zoneId));
      if (p.ws.sceneLoad) p.ws.sceneLoad.needsSnapshot = false;
      // The snapshot is built once per zone and shared by everyone in it, so
      // the fog -- which is one player's own -- rides separately. Only the cells
      // uncovered since the last tick, which is a handful while walking and
      // nothing at all while standing still.
      if (p._fogNew.length || p._visitedNew) {
        send(p.ws, { t: 'fog:add', zoneId: p.zoneId,
                     cells: p._fogNew.length ? p._fogNew : undefined,
                     visited: p._visitedNew ? [...p.visited] : undefined });
        p._fogNew.length = 0; p._visitedNew = false;
      }
    }
    // Party frames show health, so they ride along with the snapshot. One
    // payload per party, not per member.
    for (const party of parties.values()) sendParty(party);
  }
}), 1000 / TICK_HZ);

// Death timers are advanced only by stepPlayer at the simulation rate.

// ---------------------------------------------------------------------------
// HTTP static host + WebSocket
// ---------------------------------------------------------------------------
// Only the client and shared roots are public; private server data is never
// routed here. Unversioned assets revalidate rather than hiding hotfixes.
const httpServer = http.createServer(createStaticHandler(CLIENT_DIR, SHARED_DIR));

// Every model a zone needs: its scenery list plus the art of every monster
// that spawns in it (and the boss set, which can turn up anywhere).
function mobModelsFor(zone) {
  const out = new Set(zone.models || []);
  // The fish a spot holds are visible swimming in it, so the zone has to ship
  // their models. Derived from the spots' own tiers rather than listed, the
  // same way the monsters' art is -- add a fishing spot and its fish comes
  // with it.
  // Every species, not just the ones the spots hold: fish swim in ALL of a
  // zone's water, and which one turns up where depends on how deep it is.
  if ((zone.fishingSpots || []).length || (zone.terrain && !zone.enclosed))
    for (let tier = 1; tier <= 4; tier++) {
      const fish = fishForTier(tier);
      if (fish) out.add('items/Raw_' + fish.replace(/\s+/g, '_'));
    }
  const types = new Set(ALWAYS_ART);
  for (const s of (zone.spawns || [])) types.add(s.type);
  for (const e of (zone.elites || [])) types.add(e.type);
  for (const s of (zone._editSpawns || [])) types.add(s.type);
  for (const t of types) {
    const art = MOB_ART[t];
    if (art) out.add(art.model);
    else console.warn(`[worldgen] ${zone.name}: no art for monster type '${t}'`);
  }
  return [...out];
}
function zoneForClient(zone) {
  return {
    id: zone.id, name: zone.name, subtitle: zone.subtitle, spawn: zone.spawn,
    bounds: zone.bounds, boundary: zone.boundary, pois: zone.pois, path: zone.path, river: zone.river,
    paths: pathSpecsOf(zone), rivers: riversOf(zone), hills: zone.hills || [], terrain: zone.terrain || null,
    // The waterline. The client contours its shoreline off these and the
    // server decides swimming off them, which was the whole point of moving
    // them into the zone -- and then this never sent them, so the client fell
    // back to its own hardcoded copy. The two agreed only because the numbers
    // happened to be identical; retuning the waterline in the builder would
    // have moved the server's shore and left the drawn one where it was, which
    // is exactly the 766 cells of swimming on dry land all over again.
    waterEdge: zone.waterEdge || null,
    rocks: zone.rocks, hazards: zone.hazards, pools: zone.pools, chests: zone.chests, objects: zone.objects,
    fishingSpots: zone.fishingSpots || [], campfires: zone.campfires || [],
    regions: zone.regions || null,
    env: zone.env, enclosed: !!zone.enclosed, ceilingY: zone.ceilingY,
    // Without the walk state: the route, its cached path and the live moving
    // flag are the server's business, and snapshots carry the positions.
    npcs: (zone.npcs || []).map(({ _route, _nav, _yaw0, moving, ...n }) => n),
    trees: zone._trees || [],
    scatter: zone._scatter || [],
    hanging: zone._hanging || [],
    // The zone's models, PLUS the art for everything that can stand in it. The
    // zone file lists scenery only, so not one mob model was ever requested and
    // every monster in the game came out as the red placeholder box. Derived
    // from the spawns rather than listed, so adding a monster to a zone brings
    // its model with it.
    models: mobModelsFor(zone),
    mobArt: MOB_ART,
    structures: zone.structures || [],
    pads: zone.pads || [],
    decks: zone.decks || [],
    seats: zoneSeats(zone),
    dirt: zone.dirt || [],
    fences: zone.fences || [],
    editObjects: zone._editObjects || [],
    editSpawns: zone._editSpawns || [],
  };
}

// 16 KB is a couple of orders of magnitude more than the largest thing a client
// ever legitimately sends (a chat line, an edit command); ws otherwise defaults
// to 100 MB per frame, which an unauthenticated socket can make us allocate.
const MAX_MSG_BYTES = 16 * 1024;
// A client sends input at the tick rate plus whatever the person clicks. This
// allows far more than that and still stops a socket spinning the whole server
// on chat or ability spam. Over the limit the frames are dropped, not the
// connection -- a laggy burst should not boot somebody mid-fight.
const MSG_BURST = 120, MSG_WINDOW_MS = 1000;

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MSG_BYTES });
// ws raises 'error' on the socket for a protocol fault -- an oversized frame,
// a bad opcode, a truncated close. Node turns an unhandled 'error' event into a
// thrown exception, so a socket without this listener is a crash waiting for a
// malformed packet. One listener per socket, and one for the server itself.
wss.on('error', (e) => console.warn('[ws] server error:', e && e.message));
httpServer.on('clientError', (e, socket) => { try { socket.destroy(); } catch { /* already gone */ } });

const pendingLogins = new Set(), authByIp = new Map();
let activeAuth = 0, authWindow = 0, authCount = 0;
function allowAuth(ip) {
  const now = Date.now();
  if (now - authWindow >= 1000) { authWindow = now; authCount = 0; }
  for (const [key, value] of authByIp) if (now - value.start >= 60000) authByIp.delete(key);
  const bucket = authByIp.get(ip) || { start: now, count: 0 };
  if (activeAuth >= 2 || authCount >= 16 || bucket.count >= 12 || (!authByIp.has(ip) && authByIp.size >= 10000)) return false;
  bucket.count++; authCount++; authByIp.set(ip, bucket); return true;
}
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (heartbeatExpired(ws)) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 10000);
heartbeat.unref();
wss.on('connection', (ws, request) => {
  const ip = request.socket.remoteAddress;
  ws.isAlive = true; ws.connectedAt = Date.now();
  ws.on('pong', () => { ws.isAlive = true; });
  if ([...wss.clients].filter(s => s.remoteIp === ip).length >= 8) { ws.terminate(); return; }
  ws.remoteIp = ip;
  let player = null;
  let msgCount = 0, msgWindow = Date.now(), floodNoted = 0;
  ws.on('error', (e) => {
    console.warn(`[ws] ${player ? player.name : 'a socket'}: ${e && e.message}`);
    try { ws.terminate(); } catch { /* already gone */ }   // the 'close' handler does the cleanup
  });
  ws.on('message', async (raw) => {
    const now = Date.now();
    if (now - msgWindow >= MSG_WINDOW_MS) { msgCount = 0; msgWindow = now; }
    if (++msgCount > MSG_BURST) {
      if (now - floodNoted > 5000) { floodNoted = now; console.warn(`[flood] dropping messages from ${player ? player.name : 'a socket'}`); }
      return;
    }
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (!validMessage(msg)) { send(ws, { t: 'error', text: 'Invalid message.' }); return; }
    // Loading is an output/input gate, never a simulation or damage exemption.
    if (player && sceneLoading(ws) && msg.t !== 'scene:ready' && msg.t !== 'logout') return;
    let auth;
    if (msg.t === 'join') {
      if (player || ws.authPending) return;
      msg.name = msg.name.slice(0, 16).replace(/[^\w \-]/g, '').replace(/\s+/g, ' ').trim();
      const slug = saveSlug(msg.name);
      if (!msg.name || pendingLogins.has(slug) || [...players.values()].some(q => saveSlug(q.name) === slug)) { send(ws, { t: 'loginfail', text: 'Name unavailable or already logged in.' }); return; }
      if (!allowAuth(ip)) { send(ws, { t: 'loginfail', text: 'Too many login attempts. Try again later.' }); return; }
      ws.authPending = true; pendingLogins.add(slug); activeAuth++;
      try { auth = await authenticate(msg.name, msg.pass); }
      catch (error) { console.warn('[account] login refused:', error.message); auth = { error: 'Account data unavailable. Contact the administrator.' }; }
      finally { activeAuth--; pendingLogins.delete(slug); ws.authPending = false; }
      if (ws.readyState !== ws.OPEN) return;
      if (!auth.ok) { send(ws, { t: 'loginfail', text: auth.error }); return; }
    }
    transaction(() => {
    switch (msg.t) {
      case 'join': {
        if (player) return;
        const name = String(msg.name || '').slice(0, 16).replace(/[^\w \-]/g, '').replace(/\s+/g, ' ').trim();
        if (!name) { send(ws, { t: 'loginfail', text: 'Pick a name.' }); break; }
        // Already in the world: refuse rather than have two of the same person
        // walking about writing over each other's save.
        if ([...players.values()].some(q => saveSlug(q.name) === saveSlug(name))) {
          send(ws, { t: 'loginfail', text: `${name} is already logged in.` }); break;
        }
        if (!auth.ok) { send(ws, { t: 'loginfail', text: auth.error }); break; }
        const id = nextId++;
        const look = sanitizeLook(msg.look);
        const cls = Object.hasOwn(CLASSES, msg.cls) ? String(msg.cls) : DEFAULT_CLASS;
        const start = ZONES[START_ZONE];
        player = {
          id, ws, kind: 'player', name, look, zoneId: START_ZONE,
          x: start.spawn.x, z: start.spawn.z, y: 0, yaw: start.spawn.yaw || 0, moving: false,
          // One class, one class level: `level`/`xp` ARE the class (see CLASSES).
          cls, level: 1, xp: 0, gold: 0, openedChests: new Set(), usedObjects: new Set(),
          // What this player has seen: a bitset of ground per zone (the fog on
          // the region map) and the set of places entered at all (what the
          // world map is allowed to name). Both are per player and both save.
          fog: {}, visited: new Set(), _fogNew: [], _fogCell: -1, _fogZone: null,
          known: new Set(classDef(cls).abilities.filter(a => a.level <= 1).map(a => a.id)), // learned abilities
          passives: [], cooldowns: {}, buffs: {}, gcd: 0, momentum: 0, momentumT: 0, rage: 0, rageMax: classStats(cls, 1).rage, rageIdle: 0,
          mana: classStats(cls, 1).mana, manaMax: classStats(cls, 1).mana, friendId: null,
          partyId: null, partyInvite: null, duelId: null, duelChallenge: null, tradeId: null, tradeRequest: null,
          meditation: { level: 1, xp: 0 }, resting: false,
          // Everyone starts able to mine and fish; better tools are earned. The
          // pickaxe rides in the bag (it counts for mining from there); the
          // class's own weapon is what's in hand.
          inventory: [...STARTING_INVENTORY],
          equipment: emptySlots(), gear: {},
          miningXp: 0, pendingMine: null, mineTimer: 0,
          fishingXp: 0, pendingFish: null, fishTimer: 0, fishing: null, fishReel: 0, fishCaught: null,
          fishBite: 0, fishOnLine: null,
          cookingXp: 0, pendingCook: null, cookTimer: 0,
          quests: new Map(), questDone: new Set(), questKills: {},
          questFlags: new Set(), questAnnounced: new Set(),
          maxHp: classStats(cls, 1).hp, hp: classStats(cls, 1).hp, alive: true,
          atkTimer: 0, regen: 0, combatTimer: 0, deathTimer: 0, portalCd: 0, inSafe: true,
          moveTo: null, combatId: null, pendingChest: null, pendingPickup: null, input: { f: 0, r: 0, yaw: 0 },
        };
        // A name that has been here before picks its character back up: the
        // class and look on the save win over whatever the login screen was
        // showing, because the character is the thing being resumed.
        const saved = loadSave(name);
        if (saved) applySave(player, saved);
        // Creation-only: reconnects and existing saves never replenish a kit.
        else { player.equipment = starterEquipment(player.cls); player.gear = gearOf(player.equipment); }
        players.set(id, player); ws.joined = true;
        for (const g of graves.values()) if (g.name === name) g.owner = id;
        const here = ZONES[player.zoneId] || start;
        revealFog(player, here);   // you can see where you are standing before you move
        sendScene(player, { t: 'welcome', id, tickRate: SNAPSHOT_HZ, zone: zoneForClient(here), items: ITEM_CATALOG,
                   atlas: worldAtlas(), fog: fogPayload(player, here), visited: [...player.visited] });
        sendBag(player); // sends the quest payload too
        sendSkills(player);
        sendAbilities(player); sendStatus(player); sendPassives(player);
        sendObjects(player);
        player._loginNotice = auth.created ? `Account created for ${player.name}. Use the same password next time.`
          : saved ? `Welcome back, ${player.name}.` : null;
        // Say so rather than let somebody wonder why they woke up somewhere else.
        if (player._movedByRevamp) {
          delete player._movedByRevamp;
          player._loginNotice = `${player._loginNotice || ''} The woods have changed since you were last here. You have been set back on the road.`;
        }
        systemChat(`${name} has entered ${here.name}.`);
        break;
      }
      case 'scene:ready': {
        if (player && acceptSceneReady(ws, msg, player.zoneId)) sendSceneState(player);
        break;
      }
      case 'passives:set': { if (player) setPassives(player, msg.ids, msg.requestId); break; }
      case 'input': {
        if (!player) return;
        player.input = {
          f: clamp(Number(msg.f) || 0, -1, 1),
          r: clamp(Number(msg.r) || 0, -1, 1),
          yaw: Number.isFinite(+msg.yaw) ? +msg.yaw : 0,   // 1e999 parses to Infinity, and sin(Infinity) is NaN
        };
        break;
      }
      case 'attack': {
        if (!player || !player.alive) break;
        // A person can be a target, but only the one you are duelling -- this
        // is the whole of the game's PvP and it stays inside the ropes.
        const foe = duelFoe(player);
        const m = monsters.get(Number(msg.target)) || (foe && foe.id === Number(msg.target) ? foe : null);
        if (m && m.alive && m.zoneId === player.zoneId) {
          player.combatId = m.id; player.moveTo = null; player.pendingChest = null; player.pendingPickup = null; player.pendingMine = null;
        }
        break;
      }
      case 'ability': {
        if (!player) break;
        useAbility(player, String(msg.id || ''));
        break;
      }
      case 'learn': { if (player && player.alive) learnAbility(player, String(msg.id || '')); break; }
      case 'sit': {
        if (!player || !player.alive) break;
        const seat = seatById(zoneOf(player), String(msg.id || ''));
        if (!seat) break;
        // The seat you are already on gets you off it; any other one gets you
        // up and walking over to that one instead.
        if (player.seat) { const same = player.seat.id === seat.id; standUp(player, !same); if (same) break; }
        player.pendingSeat = seat.id; player.moveTo = null; player.combatId = null; player._nav = null;
        break;
      }
      case 'stand': { if (player) standUp(player); break; }
      // Looking someone over: the same sheet you see of your own kit, for
      // theirs. Read-only, and it says nothing their character is not wearing
      // in plain sight.
      case 'inspect': {
        if (!player) break;
        const t = players.get(Number(msg.id));
        if (!t || t.zoneId !== player.zoneId) break;
        const w = weaponOf(t), cs = classStats(t.cls, t.level), eq = equipStats(t.equipment);
        const [lo, hi] = swingBand(w, cs.str, eq.atk || 0);
        send(player.ws, { t: 'inspect', id: t.id, name: t.name, cls: t.cls, level: t.level,
          equipment: t.equipment, stats: eq, slots: SLOT_INFO, doll: DOLL,
          swing: { sec: +swingSeconds(w).toFixed(1), type: w.type, lo, hi } });
        break;
      }
      case 'trade:request': { if (player) tradeRequest(player, msg.id); break; }
      case 'trade:accept':  { if (player) tradeAccept(player); break; }
      case 'trade:decline': { if (player) tradeDecline(player); break; }
      case 'trade:add':     { if (player) tradeAdd(player, msg.item); break; }
      case 'trade:take':    { if (player) tradeTake(player, msg.item); break; }
      case 'trade:gold':    { if (player) tradeGold(player, msg.gold); break; }
      case 'trade:ok':      { if (player) tradeOk(player, msg.on); break; }
      case 'trade:cancel':  { if (player) tradeAbort(player); break; }
      case 'duel:challenge': { if (player) duelChallenge(player, msg.id); break; }
      case 'duel:accept':    { if (player) duelAccept(player); break; }
      case 'duel:decline':   { if (player) duelDecline(player); break; }
      case 'duel:yield':     { if (player) duelForfeit(player, `${player.name} yields.`); break; }
      case 'party:invite': { if (player) partyInvite(player, msg.id); break; }
      case 'party:accept': { if (player) partyAccept(player); break; }
      case 'party:decline': { if (player) partyDecline(player); break; }
      case 'party:leave':  { if (player) partyRemove(player); break; }
      case 'party:kick':   { if (player) partyKick(player, msg.id); break; }
      case 'target': {   // a friendly target for the Cleric's spells (null = yourself)
        if (!player) break;
        const t = msg.id != null ? players.get(Number(msg.id)) : null;
        player.friendId = t && t !== player ? t.id : null;
        break;
      }
      case 'rest': {
        if (!player || !player.alive) break;
        // Toggle meditation. Can't start resting mid-fight.
        player.resting = !player.resting && (player.combatTimer || 0) <= 0 && player.combatId == null;
        if (player.resting) { // sitting down is stopping: drop whatever we were walking to
          player.moveTo = null; player._nav = null; player.pendingChest = null; player.pendingPickup = null; player.pendingMine = null; player.pendingFish = null; player.pendingCook = null;
          player.medT = 0;
        }
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
      case 'talk': {
        if (player) talkToNpc(player, String(msg.npc || ''));
        break;
      }
      case 'useobject': {
        if (!player || !player.alive) break;
        player.pendingUse = String(msg.id || ''); player.combatId = null; player.moveTo = null; player.pendingChest = null; player.pendingPickup = null; player.pendingMine = null;
        break;
      }
      case 'openchest': {
        if (!player || !player.alive) break;
        player.pendingChest = String(msg.id || ''); player.combatId = null; player.moveTo = null; player.pendingPickup = null; player.pendingMine = null;
        break;
      }
      case 'lootgrave': { if (player && player.alive) lootGrave(player, Number(msg.id)); break; }
      case 'pickup': {
        if (!player || !player.alive) break;
        player.pendingPickup = Number(msg.id); player.combatId = null; player.moveTo = null; player.pendingChest = null; player.pendingMine = null;
        break;
      }
      case 'fish': {
        if (!player || !player.alive) break;
        const spot = (zoneOf(player).fishingSpots || []).find(s => s.id === String(msg.id || ''));
        if (!spot) break;
        // Told now rather than after the walk. The tick guard below is the
        // authority; this is so a player without a rod does not cross the zone
        // to be refused at the water.
        if (!fisherStats(player).rod) {
          send(player.ws, { t: 'event', kind: 'notice', text: 'You need a fishing rod.' });
          break;
        }
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
      case 'drop': {
        // Drop one of an item at the player's feet; it lies there like loot
        // (anyone can pick it up) until the ground item times out.
        if (!player || !player.alive) break;
        const name = String(msg.item || '');
        const i = player.inventory.indexOf(name);
        if (i < 0) break;
        player.inventory.splice(i, 1);
        const a = Math.random() * Math.PI * 2;
        dropItem(player.zoneId, player.x + Math.sin(a) * 0.8, player.z + Math.cos(a) * 0.8, name, 1, null);
        sendBag(player);
        break;
      }
      // --- World editor (gated by EDIT_KEY) ---
      case 'spawnboss': {   // editor tool: summon Cluckifer beside the player / set his health, to test the fight
        if (!player || !editAllowed(msg.key)) break;
        if (msg.god) { player.maxHp = 100000; player.hp = 100000; break; }   // an observer that survives the fight
        if (msg.hp != null) __test.setBossHp(+msg.hp); else __test.forceCluckifer();
        break;
      }
      case 'give': {   // editor tool: hand the player any item, to test gear without grinding for it
        if (!player || !editAllowed(msg.key) || !Object.hasOwn(ITEMS, msg.item)) break;
        for (let i = 0; i < Math.min(28, Math.max(1, msg.qty | 0)); i++) player.inventory.push(String(msg.item));
        sendBag(player); break;
      }
      case 'tp': {   // editor tool: stand somewhere, to test a fight without the walk
        if (!player || !editAllowed(msg.key)) break;
        const b = zoneOf(player).bounds;
        relocatePlayer(player, zoneOf(player), { x: clamp(Number(msg.x) || 0, b.minX, b.maxX), z: clamp(Number(msg.z) || 0, b.minZ, b.maxZ) });
        player.moveTo = null; player._nav = null; player.combatId = null;
        break;
      }
      case 'setlevel': {   // editor tool: jump to a class level with every ability learned, to test a class
        if (!player || !editAllowed(msg.key)) break;
        const L = clampClassLevel(msg.level); player.level = L; player.xp = xpTotalForLevel(L);
        const cs = classStats(player.cls, L); player.maxHp = cs.hp; player.hp = cs.hp; player.manaMax = cs.mana; player.mana = cs.mana;
        for (const a of classDef(player.cls).abilities) if (a.level <= L) player.known.add(a.id);
        sendAbilities(player); sendBag(player); break;
      }
      case 'edit:list': {
        if (editAllowed(msg.key)) send(ws, { t: 'models', models: MODEL_MANIFEST, mobs: MOB_TYPES, items: LOOT_ITEMS, loot: allLootTables() });
        break;
      }
      case 'edit:loot:set': {
        if (!editAllowed(msg.key) || !Object.hasOwn(MONSTER_TEMPLATES, msg.type) || !Array.isArray(msg.table)) break;
        const table = msg.table.filter(e => e && lootItemOk(e.item)).map(e => ({
          item: String(e.item), min: Math.max(0, Math.min(9999, (+e.min | 0) || 1)),
          max: Math.max(1, Math.min(9999, (+e.max | 0) || 1)), chance: Math.max(1, Math.min(100000, (+e.chance | 0) || 1)),
        }));
        LOOT_OVERRIDES[msg.type] = table; saveLootOverrides();
        broadcast({ t: 'loot', type: msg.type, table }); // sync any other editors
        break;
      }
      case 'edit:spawn:place': {
        if (!player || !editAllowed(msg.key) || !Object.hasOwn(MONSTER_TEMPLATES, msg.type)) break;
        const z = zoneOf(player);
        const sp = { id: 's' + (editSeq++), type: String(msg.type), cx: +(+msg.x).toFixed(2), cz: +(+msg.z).toFixed(2),
          r: +(+(msg.r || 8)).toFixed(1), count: Math.max(1, Math.min(20, +(msg.count || 3) | 0)),
          level: Math.max(1, Math.min(20, +(msg.level || 1) | 0)), respawn: Math.max(2, Math.min(600, +(msg.respawn || 20) | 0)) };
        (z._editSpawns = z._editSpawns || []).push(sp);
        spawnEditorRegion(z, sp); saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'spawn', sp });
        break;
      }
      case 'edit:spawn:update': {
        if (!player || !editAllowed(msg.key)) break;
        const z = zoneOf(player); const sp = (z._editSpawns || []).find(s => s.id === msg.id); if (!sp) break;
        if (msg.type != null && Object.hasOwn(MONSTER_TEMPLATES, msg.type)) sp.type = String(msg.type);
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
        if (!player || !editAllowed(msg.key)) break;
        const z = zoneOf(player); const i = (z._editSpawns || []).findIndex(s => s.id === msg.id); if (i < 0) break;
        const [sp] = z._editSpawns.splice(i, 1); despawnEditorRegion(sp.id);
        saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'spawn:delete', id: sp.id });
        break;
      }
      case 'edit:place': {
        if (!player || !editAllowed(msg.key) || !msg.m) break;
        const z = zoneOf(player);
        const o = { id: 'e' + (editSeq++), m: String(msg.m), x: +(+msg.x).toFixed(2), z: +(+msg.z).toFixed(2),
          yaw: +(+(msg.yaw || 0)).toFixed(3), s: +(+(msg.s || 1)).toFixed(3), c: +(+(msg.c || 0)).toFixed(2) };
        o.y = clamp(+(msg.y || 0), -20, 100); // height offset above the ground (stacking)
        // Builder primitives (prim:floor / prim:wall / prim:block) carry box dims.
        if (o.m.startsWith('prim:')) { o.w = clamp(+msg.w || 4, 0.2, 200); o.h = clamp(+msg.h || 3, 0.2, 60); o.d = clamp(+msg.d || 4, 0.2, 200); }
        z._editObjects.push(o); saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'place', obj: o });
        break;
      }
      case 'edit:update': {
        if (!player || !editAllowed(msg.key)) break;
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
        saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'update', obj: o });
        break;
      }
      case 'edit:delete': {
        if (!player || !editAllowed(msg.key)) break;
        const z = zoneOf(player); const i = (z._editObjects || []).findIndex(o => o.id === msg.id); if (i < 0) break;
        z._editObjects.splice(i, 1); saveOverrides(z); broadcastZone(player.zoneId, { t: 'edit', op: 'delete', id: msg.id });
        break;
      }
      case 'equip': if (player && player.alive) equipItem(player, String(msg.item || ''), msg.slot ? String(msg.slot) : null); break;
      case 'unequip': if (player && player.alive) unequipItem(player, String(msg.slot || '')); break;
      case 'sell': if (player && player.alive) sellItem(player, String(msg.item || ''), !!msg.all); break;
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
      case 'questaccept': if (player) acceptQuest(player, String(msg.id || '')); break;
      case 'questturnin': if (player && player.alive) turnInQuest(player, String(msg.id || '')); break;
      case 'questsync': if (player) { sendQuests(player); sendObjects(player); } break;
      case 'respawn': if (player && !player.alive && player.deathTimer <= 0) respawnPlayer(player); break;
      case 'logout': {
        if (!player) return;
        const wait = player.lastCombat ? LOGOUT_COMBAT_WAIT - (Date.now() - player.lastCombat) / 1000 : 0;
        if (player.alive && wait > 0) { send(ws, { t: 'event', kind: 'notice', text: `You can't log out in combat. Wait ${Math.ceil(wait)}s.` }); break; }
        sendRaw(ws, JSON.stringify({ t: 'logout' }), true); leaveWorld(player); player = null; ws.joined = false; ws.sceneLoad = null; ws.connectedAt = Date.now();
        break;
      }
      case 'chat': {
        if (!player) return;
        const text = String(msg.msg || '').slice(0, 200);
        if (text.trim()) broadcast({ t: 'chat', from: player.name, msg: text });
        break;
      }
    }
    });
  });
  ws.on('close', () => transaction(() => {
    if (!player) return;
    const wait = player.lastCombat ? LOGOUT_COMBAT_WAIT - (Date.now() - player.lastCombat) / 1000 : 0;
    if (player.alive && wait > 0) {
      // Closed the game mid-fight: the character stays in the world, defenceless,
      // for the rest of the combat wait. Monsters may finish the job.
      player.input = { f: 0, r: 0, yaw: player.yaw };
      player.pendingChest = player.pendingPickup = player.pendingMine = player.pendingFish = player.pendingCook = player.pendingUse = player.pendingSeat = null;
      player.lingerT = wait; player.moveTo = null; player._nav = null; player.combatId = null;
      systemChat(`${player.name} tried to flee the fight — their body lingers.`);
      return;
    }
    leaveWorld(player);
  }));
});

httpServer.listen(PORT, () => {
  console.log(`\n  Blackroot — ${ZONES[START_ZONE].name}`);
  console.log(`  Open http://localhost:${PORT} in your browser.`);
  console.log(`  Open it in two windows to see multiplayer.\n`);
});

// Test hooks (headless smoke tests only): force the secret boss to appear and
// knock its health down to reach its phases without a real fight.
export const __test = {
  forceCluckifer() {
    const p = [...players.values()][0]; if (!p) return null;
    const fake = { zoneId: p.zoneId, x: p.x + 4, z: p.z + 4, id: -1 };
    const orig = Math.random; Math.random = () => 0;
    try { return maybeSpawnCluckifer(bossCtx, fake, p); } finally { Math.random = orig; }
  },
  setBossHp(frac) { for (const m of monsters.values()) if (m.boss === 'cluckifer' && m.alive) m.hp = Math.round(m.maxHp * frac); },
};
