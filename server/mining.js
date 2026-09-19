// Blackroot — mining.
//
// Ore veins are already part of the world (server/worldgen.js scatters them and
// they are solid). This turns them into something you work: a separate skill
// with its own level, gated ore tiers, pickaxes that decide how fast you swing,
// and veins that deplete and come back.
//
// Mining level is deliberately its own progression axis — it does not feed
// combat level and combat level does not gate it.

export const MINING = {
  swingTime: 2.4,        // seconds per swing at pickaxe speed 1.0
  reach: 3.5,            // how close you must stand to a vein
  maxLevel: 60,
};

// `level` gates the vein, `xp` is per ore mined, `respawn` is seconds, and
// `hardness` sets how often a swing actually yields (see rollSwing).
export const ORES = {
  Copper:     { level: 1,  xp: 18,  ore: 'Copper Ore',     respawn: 10, hardness: 1.0, value: 8 },
  Tin:        { level: 1,  xp: 18,  ore: 'Tin Ore',        respawn: 10, hardness: 1.0, value: 8 },
  Iron:       { level: 8,  xp: 35,  ore: 'Iron Ore',       respawn: 14, hardness: 1.5, value: 24 },
  Silver:     { level: 12, xp: 40,  ore: 'Silver Ore',     respawn: 60, hardness: 1.8, value: 60 },
  Coal:       { level: 16, xp: 50,  ore: 'Coal',           respawn: 30, hardness: 2.2, value: 45 },
  Gold:       { level: 22, xp: 65,  ore: 'Gold Ore',       respawn: 60, hardness: 2.6, value: 140 },
  Mithril:    { level: 30, xp: 80,  ore: 'Mithril Ore',    respawn: 120, hardness: 3.4, value: 320 },
  Adamantite: { level: 38, xp: 95,  ore: 'Adamantite Ore', respawn: 240, hardness: 4.2, value: 700 },
  Runite:     { level: 46, xp: 125, ore: 'Runite Ore',     respawn: 600, hardness: 5.5, value: 2400 },
};

// The model name a scatter spec uses maps straight to an ore.
export function oreFromModel(model) {
  const m = /^(\w+?)_Ore_Vein$/.exec(model || '');
  return m && ORES[m[1]] ? m[1] : null;
}

// Pickaxes. `power` is both swing speed and how well it bites.
export const PICKAXES = {
  'Bronze Pickaxe':  { level: 1,  power: 1.0 },
  'Iron Pickaxe':    { level: 6,  power: 1.35 },
  'Steel Pickaxe':   { level: 14, power: 1.8 },
  'Mithril Pickaxe': { level: 26, power: 2.4 },
};

// The best pickaxe the player is carrying (bag or equipped) and may use.
export function bestPickaxe(items, miningLevel) {
  let best = null;
  for (const name of items) {
    const p = PICKAXES[name];
    if (!p || p.level > miningLevel) continue;
    if (!best || p.power > PICKAXES[best].power) best = name;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Progression. A flatter curve than combat: mining is a grind by nature and
// this is a two-zone game, not a 99-level one.
// ---------------------------------------------------------------------------
// This is a two-zone game, not a 99-level one. An OSRS-shaped curve put the
// deep ores hundreds of hours away, which would have left the Mithril,
// Adamantite and Runite veins as scenery -- exactly what mining was added to
// stop them being. Scaled so a determined miner reaches Runite rather than
// theoretically could. See tools/mining.mjs.
export function xpForMiningLevel(level) { return Math.floor(12 * Math.pow(level, 1.35)); }

export function miningLevelFromXp(xp) {
  let level = 1, need = xpForMiningLevel(1), spent = 0;
  while (level < MINING.maxLevel && xp >= spent + need) {
    spent += need; level++; need = xpForMiningLevel(level);
  }
  return { level, into: xp - spent, next: need };
}

// Chance that one swing yields ore. Scales with how far past the requirement
// the miner is, and with the pickaxe. Always leaves a floor and a ceiling so
// no vein is ever hopeless or automatic.
export function swingChance(oreKey, miningLevel, pickPower) {
  const ore = ORES[oreKey];
  if (!ore || miningLevel < ore.level) return 0;
  const over = miningLevel - ore.level;
  const base = (0.28 + over * 0.012) * (pickPower / ore.hardness);
  return Math.max(0.05, Math.min(0.85, base));
}

export function swingTime(pickPower) { return MINING.swingTime / pickPower; }

// Expected seconds to mine one ore, ignoring travel and respawn.
export function secondsPerOre(oreKey, miningLevel, pickPower) {
  const c = swingChance(oreKey, miningLevel, pickPower);
  return c <= 0 ? Infinity : swingTime(pickPower) / c;
}

export function canMine(oreKey, miningLevel) {
  const ore = ORES[oreKey];
  return !!ore && miningLevel >= ore.level;
}
