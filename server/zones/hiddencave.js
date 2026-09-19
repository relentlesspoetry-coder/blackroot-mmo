// Blackroot — Hidden Cave (interior of the Dark Woods' hidden cave)
// From the blueprint's internal cave map: Upper Cavern, Echo Pool,
// Smuggler's Niche, Crystal Hollow, Deep Chamber. Optional deeper content —
// higher-level spiders, glittering crystals, and treasure. Risk vs. reward.
//
// Same coordinate convention: -Z is "up/north" (the entry), +Z goes deeper.

export const hiddencave = {
  id: 'hiddencave',
  name: 'The Hidden Cave',
  subtitle: 'Optional Depths',

  models: [
    'Cave_Spider', 'Venom_Spider', 'Crystal_Spider', 'Bat',
    'Moss_Cave_Giant', 'Crystal_Cave_Giant', 'Cave_Guardian',
    'cave/Stalagmite_Large', 'cave/Stalagmite_Cluster', 'cave/Stalagmite_Small',
    'cave/Stalactite_Single', 'cave/Stalactite_Cluster', 'cave/Cave_Column',
    'cave/Wall_Boulder_Tall', 'cave/Wall_Boulder_Wide', 'cave/Rock_Arch',
    'cave/Rubble_Pile', 'cave/Floor_Rock_Slab', 'cave/Shallow_Pool',
    'cave/Brown_Mushrooms', 'cave/Luminous_Mushrooms', 'cave/Teal_Crystals',
    'cave/Violet_Crystals', 'cave/Timber_Support', 'cave/Hanging_Roots',
    'cave/Corner_Cobweb',
    'cave/Iron_Ore_Vein', 'cave/Coal_Ore_Vein', 'cave/Copper_Ore_Vein',
    'cave/Tin_Ore_Vein', 'cave/Silver_Ore_Vein', 'cave/Gold_Ore_Vein',
    'cave/Mithril_Ore_Vein', 'cave/Adamantite_Ore_Vein', 'cave/Runite_Ore_Vein',
    // Drop models for what dies down here.
    'items/Chitin_Fragment', 'items/Spider_Fang', 'items/Venomous_Fang',
    'items/Venom_Gland', 'items/Spider_Silk', 'items/Pristine_Silk',
    'items/Sticky_Webbing', 'items/Hardened_Carapace', 'items/Uncut_Quartz',
    'items/Crystal_Heart', 'items/Cave_Mushroom', 'items/Broodmothers_Signet',
    'items/Spiderfang_Dagger', 'items/Spiderling_Pet_Egg',
    // Ore, and what the giants leave behind.
    'items/Copper_Ore', 'items/Tin_Ore', 'items/Iron_Ore', 'items/Silver_Ore',
    'items/Coal', 'items/Gold_Ore', 'items/Mithril_Ore', 'items/Adamantite_Ore',
    'items/Runite_Ore',
    'items/Giant_Bones', 'items/Giant_Tusk', 'items/Rough_Hide', 'items/Cave_Moss',
    'items/Stone_Fragment', 'items/Leather_Straps', 'items/Crystal_Shard',
    'items/Uncut_Emerald', 'items/Living_Crystal_Core', 'items/Cave_Giant_Pet_Stone',
    'items/Giants_Stone_Maul', 'items/Guardians_Iron_Shield', 'items/Ancient_Giants_Signet',
  ],

  bounds: { minX: -55, maxX: 55, minZ: -65, maxZ: 65 },

  // Lumpy cavern outline (clockwise) — connected chambers, not a box.
  boundary: [
    { x: -10, z: -60 }, { x: 12, z: -58 }, { x: 22, z: -40 }, { x: 46, z: -24 },
    { x: 52, z: -2 }, { x: 34, z: 12 }, { x: 42, z: 34 }, { x: 22, z: 60 },
    { x: 0, z: 64 }, { x: -22, z: 56 }, { x: -42, z: 52 }, { x: -46, z: 22 },
    { x: -50, z: -4 }, { x: -40, z: -28 }, { x: -24, z: -46 }, { x: -16, z: -54 },
  ],
  spawn: { x: 0, z: -42, yaw: 0 }, // Upper Cavern floor, below the exit shaft

  enclosed: true,   // build perimeter rock walls + a ceiling
  ceilingY: 13,
  treeCount: 0,     // no forest underground

  // Dark, cold, lit mainly by glowing crystals.
  env: { bg: 0x161c26, fogNear: 22, fogFar: 95, hemiSky: 0x4a5a72, hemiGround: 0x1a1c22, hemiInt: 0.9, sun: 0x5a6a8a, sunInt: 0.4 },

  pois: [
    { key: 'upper',    name: 'Upper Cavern',      x: 0,   z: -52, kind: 'exitup' },
    { key: 'echo',     name: 'Echo Pool',         x: -32, z: -8,  kind: 'pool' },
    { key: 'smuggler', name: "Smuggler's Niche",  x: 34,  z: -10, kind: 'cache' },
    { key: 'crystal',  name: 'Crystal Hollow',    x: -30, z: 40,  kind: 'crystal' },
    { key: 'deep',     name: 'Deep Chamber',      x: 6,   z: 50,  kind: 'deep' },
  ],

  // Walked path down through the cave (lighter cave floor).
  path: [
    { x: 0, z: -52 }, { x: 0, z: -28 }, { x: -10, z: -8 }, { x: -4, z: 18 },
    { x: 4, z: 40 }, { x: 6, z: 50 },
  ],

  // Water body (Echo Pool). Visual only.
  pools: [
    { x: -32, z: -8, r: 10 },
  ],

  // Stalagmite pillars / boulders (collision).
  rocks: [
    { x: -14, z: -34, r: 3 }, { x: 16, z: -30, r: 3.5 }, { x: 26, z: 6, r: 3 },
    { x: -20, z: 12, r: 3 }, { x: 2, z: 26, r: 2.5 }, { x: 20, z: 30, r: 3.2 },
    { x: -12, z: 52, r: 3 }, { x: 30, z: 48, r: 3 }, { x: -40, z: 24, r: 3.5 },
  ],

  // Treasure caches (click to open — one reward per player).
  chests: [
    { id: 'smug', x: 34, z: -10, gold: 120, item: "Smuggler's Cache" },
    { id: 'deep', x: 6, z: 54, gold: 260, item: 'Crystalline Relic' },
  ],

  safeSpawnRadius: 14, // the shaft floor stays clear so you aren't ambushed on arrival

  // Cave spiders; deeper = higher level. Each chamber has its own species so
  // the descent reads visually, not just on the nameplates.
  spawns: [
    { type: 'bat',            count: 6, cx: 0,   cz: -30, r: 14, level: 3, expect: 5, hint: 'Upper Cavern' },
    { type: 'spider',         count: 4, cx: -30, cz: -8,  r: 12, level: 4, expect: 5, hint: 'Echo Pool' },
    { type: 'spider',         count: 3, cx: 34,  cz: -10, r: 10, level: 5, expect: 6, hint: "Smuggler's Niche" },
    { type: 'venom_spider',   count: 4, cx: 34,  cz: -10, r: 11, level: 5, expect: 6, hint: "Smuggler's Niche" },
    { type: 'cave_giant',     count: 2, cx: -8,  cz: 14,  r: 12, level: 6, expect: 7, hint: 'Middle Passage' },
    { type: 'crystal_spider', count: 5, cx: -30, cz: 40,  r: 12, level: 6, expect: 7, hint: 'Crystal Hollow' },
    { type: 'venom_spider',   count: 4, cx: 6,   cz: 42,  r: 12, level: 7, expect: 8, hint: 'Deep Chamber' },
    { type: 'crystal_giant',  count: 2, cx: -26, cz: 46,  r: 10, level: 7, expect: 8, hint: 'Crystal Hollow' },
  ],

  // Spiders are squishy, so the Broodmother carries her own multipliers rather
  // than the generic elite ones — otherwise she dies faster than a Hill Ogre.
  elites: [
    { type: 'spider', name: 'The Broodmother', cx: 6, cz: 52, level: 9, expect: 9, hpMult: 4.3, dmgMult: 2.2 },
    { type: 'cave_giant', name: 'The Cave Guardian', cx: -30, cz: 40, level: 8, expect: 8, hpMult: 1.8, dmgMult: 0.95,
      drops: ["Guardian's Iron Shield", "Ancient Giant's Signet"] },
  ],

  // Scattered cave dressing. Generated deterministically on the server (like
  // the Dark Woods trees) so the big pieces can be solid and every client sees
  // the same cave. `r` is the collision radius; 0 means decorative.
  scatterSeed: 8831,
  scatter: [
    { model: 'Stalagmite_Large',   count: 26, r: 0.9,  scale: [0.9, 1.6] },
    { model: 'Stalagmite_Cluster', count: 20, r: 0.8,  scale: [0.9, 1.5] },
    { model: 'Stalagmite_Small',   count: 34, r: 0,    scale: [0.8, 1.6] },
    { model: 'Cave_Column',        count: 10, r: 1.1,  scale: [1.2, 2.2] },
    { model: 'Wall_Boulder_Tall',  count: 12, r: 1.0,  scale: [0.9, 1.5] },
    { model: 'Wall_Boulder_Wide',  count: 12, r: 1.2,  scale: [0.9, 1.4] },
    { model: 'Rock_Arch',          count: 4,  r: 0,    scale: [1.2, 1.8] },
    { model: 'Rubble_Pile',        count: 18, r: 0,    scale: [0.8, 1.4] },
    { model: 'Floor_Rock_Slab',    count: 16, r: 0,    scale: [0.9, 1.6] },
    { model: 'Brown_Mushrooms',    count: 22, r: 0,    scale: [0.7, 1.3] },
    { model: 'Luminous_Mushrooms', count: 20, r: 0,    scale: [0.8, 1.4] },
    { model: 'Teal_Crystals',      count: 16, r: 0,    scale: [0.8, 1.6], near: 'crystal' },
    { model: 'Violet_Crystals',    count: 14, r: 0,    scale: [0.8, 1.6], near: 'crystal' },
    { model: 'Timber_Support',     count: 8,  r: 0,    scale: [1.0, 1.3], near: 'smuggler' },
    { model: 'Shallow_Pool',       count: 7,  r: 0,    scale: [1.0, 1.8] },
    { model: 'Iron_Ore_Vein',      count: 8,  r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Coal_Ore_Vein',      count: 7,  r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Copper_Ore_Vein',    count: 6,  r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Tin_Ore_Vein',       count: 6,  r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Silver_Ore_Vein', rare: true,    count: 4,  r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Gold_Ore_Vein', rare: true,      count: 3,  r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Mithril_Ore_Vein', rare: true,   count: 2,  r: 0.8,  scale: [1.0, 1.2], near: 'deep' },
    { model: 'Adamantite_Ore_Vein', rare: true, count: 2, r: 0.8,  scale: [1.0, 1.2], near: 'deep' },
    { model: 'Runite_Ore_Vein', rare: true,    count: 1,  r: 0.8,  scale: [1.1, 1.3], near: 'deep' },
  ],

  // Ceiling-mounted dressing — hung from ceilingY, not placed on the floor.
  hanging: [
    { model: 'Stalactite_Single',  count: 40, scale: [0.8, 1.8] },
    { model: 'Stalactite_Cluster', count: 22, scale: [0.9, 1.6] },
    { model: 'Hanging_Roots',      count: 14, scale: [0.9, 1.5] },
    { model: 'Corner_Cobweb',      count: 16, scale: [0.9, 1.8] },
  ],

  portals: [
    { x: 0, z: -58, r: 5, to: 'darkwoods', spawn: { x: -54, z: 52, yaw: 1.2 } },
  ],
};
