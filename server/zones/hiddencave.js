// The Hidden Cave — zone 2.
//
// Authored as rooms and tunnels rather than one open cavern, so every creature
// gets a chamber of its own instead of nine spawn circles overlapping in the
// middle of a single room. server/worldgen.js traces the union of these shapes
// into the `boundary` polygon the engine already uses for collision and walls,
// so nothing downstream had to change.
//
// The tunnel graph must stay a tree — see caveOutline() for why.

export const hiddencave = {
  id: 'hiddencave',
  name: 'The Hidden Cave',
  subtitle: 'Something dug these passages, and not recently',

  enclosed: true,
  ceilingY: 8.5,
  bounds: { minX: -160, maxX: 160, minZ: -200, maxZ: 200 },
  spawn: { x: 0, z: -146, yaw: 0 },
  safeSpawnRadius: 22,

  // Rooms are discs, tunnels are capsules between them. Everything else in this
  // file is placed relative to them.
  cavern: {
    tunnelWidth: 13,
    rooms: [
      { key: 'entrance', x: 0,    z: -150, r: 27 },
      { key: 'fungal',   x: 0,    z: -62,  r: 32 },
      { key: 'echo',     x: -98,  z: -96,  r: 31 },
      { key: 'smuggler', x: 96,   z: -90,  r: 28 },
      { key: 'hall',     x: 0,    z: 14,   r: 36 },
      { key: 'crystal',  x: -108, z: 62,   r: 35 },
      { key: 'workings', x: -72,  z: 152,  r: 29 },
      { key: 'deep',     x: 104,  z: 74,   r: 33 },
      { key: 'nest',     x: 8,    z: 148,  r: 31 },
    ],
    tunnels: [
      { from: 'entrance', to: 'fungal' },
      { from: 'fungal',   to: 'echo' },
      { from: 'fungal',   to: 'smuggler' },
      { from: 'fungal',   to: 'hall',     w: 15 },
      { from: 'hall',     to: 'crystal' },
      { from: 'hall',     to: 'deep' },
      { from: 'hall',     to: 'nest',     w: 15 },
      { from: 'crystal',  to: 'workings' },
    ],
  },

  // Dark and enclosed — much dimmer than the surface. These keys match what the
  // client's loadZone() reads (bg/fog/hemi/sun); the day-night cycle never runs
  // underground (the client skips it for enclosed zones), so this is static.
  // Light comes from crystals, campfires and the entrance shaft, not the sky.
  env: {
    bg: 0x121821, fogNear: 12, fogFar: 95,
    hemiSky: 0x4a5666, hemiGround: 0x1a2028, hemiInt: 0.8,
    sun: 0x56658a, sunInt: 0.42,
  },

  models: [
    'Cave_Spider', 'Venom_Spider', 'Crystal_Spider', 'Bat', 'Cave_Broodmother',
    'Moss_Cave_Giant', 'Crystal_Cave_Giant', 'Cave_Guardian',
    'cave/Brood_Nest', 'cave/Egg_Cluster', 'cave/Ground_Cocoon', 'cave/Webbed_Bones',
    'cave/Floor_Web', 'cave/Round_Wall_Web', 'cave/Hanging_Cocoon', 'cave/Hanging_Web_Curtain',
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

  pois: [
    { key: 'entrance', name: 'Entrance Cavern',    x: 0,    z: -172, kind: 'exitup' },
    // `art` overrides which visual the client builds; without it every 'deep'
    // room would grow the same altar and egg sacs.
    { key: 'fungal',   name: 'Fungal Gallery',     x: 0,    z: -62,  kind: 'deep', art: 'none' },
    { key: 'echo',     name: 'Echo Pool',          x: -98,  z: -96,  kind: 'pool' },
    { key: 'smuggler', name: "Smuggler's Niche",   x: 96,   z: -90,  kind: 'cache' },
    { key: 'hall',     name: 'Collapsed Hall',     x: 0,    z: 14,   kind: 'deep', art: 'collapsed' },
    { key: 'crystal',  name: 'Crystal Hollow',     x: -108, z: 62,   kind: 'crystal' },
    { key: 'workings', name: 'Old Workings',       x: -72,  z: 152,  kind: 'cache' },
    { key: 'deep',     name: 'Deep Chamber',       x: 104,  z: 74,   kind: 'deep', art: 'none' },
    { key: 'nest',     name: "Broodmother's Nest", x: 8,    z: 148,  kind: 'deep' },
  ],

  portals: [
    { x: 0, z: -170, r: 6, to: 'darkwoods', spawn: { x: 4, z: 74, yaw: 1.2 } },   // out of the Spider Den, on the south road
  ],

  pools: [
    { x: -98, z: -96, r: 16 },
  ],

  rocks: [
    { x: -20, z: -104, r: 4 }, { x: 22, z: -98, r: 4.5 },
    { x: -34, z: 6, r: 4 }, { x: 30, z: 22, r: 4.5 },
    { x: -120, z: 44, r: 4 }, { x: -92, z: 82, r: 4 },
    { x: 118, z: 56, r: 4.5 }, { x: 88, z: 92, r: 4 },
    { x: -8, z: 168, r: 4 }, { x: -86, z: 136, r: 4.5 },
  ],

  chests: [
    { id: 'smug', x: 96,  z: -90 },
    { id: 'deep', x: 104, z: 80 },
    { id: 'work', x: -72, z: 156 },
  ],

  // One creature per chamber. The whole point of the rebuild.
  spawns: [
    { type: 'bat',            count: 8, cx: 0,    cz: -62,  r: 26, level: 3, expect: 5, hint: 'Fungal Gallery' },
    { type: 'spider',         count: 7, cx: -98,  cz: -96,  r: 25, level: 4, expect: 5, hint: 'Echo Pool' },
    { type: 'venom_spider',   count: 6, cx: 96,   cz: -90,  r: 22, level: 5, expect: 6, hint: "Smuggler's Niche" },
    { type: 'cave_giant',     count: 4, cx: 0,    cz: 14,   r: 28, level: 6, expect: 7, hint: 'Collapsed Hall' },
    { type: 'crystal_spider', count: 8, cx: -108, cz: 62,   r: 28, level: 6, expect: 7, hint: 'Crystal Hollow' },
    { type: 'crystal_giant',  count: 4, cx: -72,  cz: 152,  r: 22, level: 7, expect: 8, hint: 'Old Workings' },
    { type: 'venom_spider',   count: 7, cx: 104,  cz: 74,   r: 26, level: 7, expect: 8, hint: 'Deep Chamber' },
    { type: 'spider',         count: 6, cx: 8,    cz: 148,  r: 24, level: 8, expect: 9, hint: "Broodmother's Nest" },
  ],

  elites: [
    { type: 'broodmother', name: 'The Broodmother', cx: 8, cz: 154, level: 9, expect: 9,
      hpMult: 4.3, dmgMult: 2.2, drops: ["Broodmother's Signet"] },
    { type: 'cave_guardian', name: 'The Cave Guardian', cx: 104, cz: 74, level: 8, expect: 8,
      hpMult: 1.8, dmgMult: 0.95,
      drops: ["Guardian's Iron Shield", "Ancient Giant's Signet"] },
  ],

  scatterSeed: 8831,
  scatter: [
    { model: 'Stalagmite_Large',   count: 60, r: 0.9,  scale: [0.9, 1.6] },
    { model: 'Stalagmite_Cluster', count: 46, r: 0.8,  scale: [0.9, 1.5] },
    { model: 'Stalagmite_Small',   count: 80, r: 0,    scale: [0.8, 1.6] },
    { model: 'Cave_Column',        count: 24, r: 1.1,  scale: [1.2, 2.2] },
    { model: 'Wall_Boulder_Tall',  count: 28, r: 1.0,  scale: [0.9, 1.5] },
    { model: 'Wall_Boulder_Wide',  count: 28, r: 1.2,  scale: [0.9, 1.4] },
    { model: 'Rock_Arch',          count: 10, r: 0,    scale: [1.2, 1.8] },
    { model: 'Rubble_Pile',        count: 42, r: 0,    scale: [0.8, 1.4] },
    { model: 'Floor_Rock_Slab',    count: 38, r: 0,    scale: [0.9, 1.6] },
    { model: 'Brown_Mushrooms',    count: 34, r: 0,    scale: [0.7, 1.3], near: 'fungal' },
    { model: 'Luminous_Mushrooms', count: 34, r: 0,    scale: [0.8, 1.4], near: 'fungal' },
    { model: 'Teal_Crystals',      count: 28, r: 0,    scale: [0.8, 1.6], near: 'crystal' },
    { model: 'Violet_Crystals',    count: 24, r: 0,    scale: [0.8, 1.6], near: 'crystal' },
    { model: 'Timber_Support',     count: 18, r: 0,    scale: [1.0, 1.3], near: 'workings' },
    { model: 'Shallow_Pool',       count: 14, r: 0,    scale: [1.0, 1.8] },
    { model: 'Iron_Ore_Vein',      count: 14, r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Coal_Ore_Vein',      count: 12, r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Copper_Ore_Vein',    count: 10, r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Tin_Ore_Vein',       count: 10, r: 0.8,  scale: [0.9, 1.2] },
    { model: 'Silver_Ore_Vein',    count: 7,  r: 0.8,  scale: [0.9, 1.2], rare: true },
    { model: 'Gold_Ore_Vein',      count: 6,  r: 0.8,  scale: [0.9, 1.2], rare: true, near: 'crystal' },
    { model: 'Mithril_Ore_Vein',   count: 5,  r: 0.8,  scale: [1.0, 1.2], rare: true, near: 'workings' },
    { model: 'Adamantite_Ore_Vein', count: 4, r: 0.8,  scale: [1.0, 1.2], rare: true, near: 'workings' },
    { model: 'Runite_Ore_Vein',    count: 2,  r: 0.8,  scale: [1.1, 1.3], rare: true, near: 'nest' },
    // The Broodmother's Nest — webbed and cocooned.
    { model: 'Brood_Nest',    count: 1,  r: 2,  scale: [1.4, 1.7], near: 'nest', nearR: 8 },
    { model: 'Egg_Cluster',   count: 10, r: 0.6, scale: [0.8, 1.3], near: 'nest' },
    { model: 'Ground_Cocoon', count: 9,  r: 0,  scale: [0.8, 1.2], near: 'nest' },
    { model: 'Webbed_Bones',  count: 6,  r: 0,  scale: [0.8, 1.2], near: 'nest' },
    { model: 'Floor_Web',     count: 16, r: 0,  scale: [0.9, 1.5], near: 'nest' },
    { model: 'Round_Wall_Web', count: 8, r: 0,  scale: [0.9, 1.4], near: 'nest' },
  ],

  hanging: [
    { model: 'Stalactite_Single',  count: 90, scale: [0.8, 1.8] },
    { model: 'Stalactite_Cluster', count: 50, scale: [0.9, 1.6] },
    { model: 'Hanging_Roots',      count: 30, scale: [0.9, 1.5] },
    { model: 'Corner_Cobweb',      count: 36, scale: [0.9, 1.8] },
    { model: 'Hanging_Cocoon',       count: 10, scale: [0.9, 1.4], near: 'nest' },
    { model: 'Hanging_Web_Curtain',  count: 8,  scale: [0.9, 1.5], near: 'nest' },
  ],
};
