import { xpForLevel, progressForXp } from './balance.js';
// Blackroot — fishing.
//
// Fishing mirrors mining: its own skill/level, gated catches, a rod that sets
// how fast and how reliably you reel, and fishing spots dotted along the water
// that you work by clicking. Spots never deplete — fish are infinite — you just
// cast, wait, and roll for a catch scaled by level and rod.

export const FISHING = {
  castTime: 3.0,   // seconds per cast at rod power 1.0
  reach: 4.5,      // how close to the spot you must stand (fish from the bank)
  maxLevel: 99,
};

// `level` gates the fish, `xp` per catch, `item` is what lands, `difficulty`
// scales the catch chance (see catchChance).
export const FISH = {
  Shrimp: { level: 1,  xp: 15, item: 'Raw Shrimp', difficulty: 1.0 },
  Trout:  { level: 10, xp: 40, item: 'Raw Trout',  difficulty: 1.6 },
  Salmon: { level: 22, xp: 65, item: 'Raw Salmon', difficulty: 2.3 },
  Pike:   { level: 34, xp: 90, item: 'Raw Pike',   difficulty: 3.0 },
};

// Fishing rods. `power` is both reel speed and how well you hook a fish.
export const RODS = {
  'Fishing Rod':      { level: 1,  power: 1.0 },
  'Feathered Rod':    { level: 15, power: 1.6 },
};

export function bestRod(items, fishingLevel) {
  let best = null;
  for (const name of items) {
    const r = RODS[name];
    if (!r || r.level > fishingLevel) continue;
    if (!best || r.power > RODS[best].power) best = name;
  }
  return best;
}

// Flatter than combat, like mining — a two-zone game.
export function xpForFishingLevel(level) { return xpForLevel(level); } // the shared 1..99 table (balance.js)
export function fishingLevelFromXp(xp) { return progressForXp(xp); }

// Chance one cast lands a fish, scaled by how far past the requirement you are
// and by the rod. Floored/capped so no spot is hopeless or automatic.
export function catchChance(fishKey, fishingLevel, rodPower) {
  const f = FISH[fishKey];
  if (!f || fishingLevel < f.level) return 0;
  const over = fishingLevel - f.level;
  const base = (0.30 + over * 0.012) * (rodPower / f.difficulty);
  return Math.max(0.05, Math.min(0.85, base));
}

export function castTime(rodPower) { return FISHING.castTime / rodPower; }
export function canFish(fishKey, fishingLevel) { const f = FISH[fishKey]; return !!f && fishingLevel >= f.level; }
