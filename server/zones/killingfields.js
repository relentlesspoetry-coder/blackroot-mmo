// Blackroot — Zone 2: The Killing Fields
// Hand-authored from the Killing Fields Zone Layout Blueprint.
//
// A blighted stretch of open farmland and grave-fields south of the Dark Woods:
// broken windmills, scarecrow ridges, burial trenches and gallows. Raiders and
// bandits have overrun the homesteads. Progression runs north -> south, from the
// North Road Entrance down to the South Marsh Gate (into the Gloom Wood Swamp).
//
// Coordinate system matches Dark Woods: North = -Z, South = +Z, West = -X.
// Authored at final scale (not run through scaleZone).

export const killingfields = {
  id: 'killingfields',
  name: 'The Killing Fields',
  subtitle: 'Zone II',

  models: [
    'Bandit', 'Goblin', 'Goblin_Warrior', 'Goblin_Archer', 'Goblin_Scavenger', 'Hill_Ogre', 'Cow',
    // Sparse, blighted flora — mostly dead.
    'Dead_Bush', 'Thorn_Bush', 'Darkroot_Bush',
    'Ancient_Forest_Tree', 'Broad_Crown_Oak', 'Tall_Leafy_Birch', 'Twisted_Darkwood', 'Weeping_Willow',
    // Farmstead / raider-camp props.
    'props/Goblin_Hide_Tent', 'props/Small_Canvas_Tent', 'props/Unlit_Fire_Pit', 'props/Campfire',
    'props/Supply_Crate', 'props/Water_Barrel', 'props/Supply_Pavilion', 'props/Camp_Lantern', 'props/Cooking_Tripod',
    'cave/Copper_Ore_Vein', 'cave/Tin_Ore_Vein', 'cave/Iron_Ore_Vein',
    'items/Copper_Ore', 'items/Tin_Ore', 'items/Iron_Ore',
  ],

  treeSeed: 8821,
  treeCount: 90, // sparse — this is open field, not forest

  respawnMult: 0.5, // still farm-friendly, a touch slower than the Dark Woods

  bounds: { minX: -140, maxX: 140, minZ: -165, maxZ: 165 },

  // Open field outline — broad and rolling, less jagged than the woods.
  boundary: [
    { x: -30, z: -156 }, { x: 24, z: -160 }, { x: 74, z: -150 }, { x: 108, z: -128 },
    { x: 126, z: -88 }, { x: 118, z: -38 }, { x: 132, z: 6 }, { x: 120, z: 54 },
    { x: 130, z: 104 }, { x: 96, z: 140 }, { x: 40, z: 160 }, { x: -14, z: 156 },
    { x: -60, z: 162 }, { x: -104, z: 138 }, { x: -126, z: 96 }, { x: -118, z: 46 },
    { x: -132, z: 2 }, { x: -122, z: -46 }, { x: -128, z: -92 }, { x: -96, z: -128 }, { x: -58, z: -148 },
  ],

  spawn: { x: 0, z: -150, yaw: 0 }, // North Road Entrance, facing south

  boundaryInset: 0,

  // Overcast, desaturated farmland — greyer and browner than the woods.
  env: { bg: 0x8a94a0, fogNear: 120, fogFar: 400, hemiSky: 0xb4bcc4, hemiGround: 0x6a6048, hemiInt: 1.15, sun: 0xf0e6cf, sunInt: 1.05 },

  portals: [
    // North Road back up into the Dark Woods (arrive near its South Gate).
    { x: 0, z: -160, r: 6, to: 'darkwoods', spawn: { x: 10, z: 150, yaw: 0 } },
    // South Marsh Gate down into the Gloom Wood Swamp.
    { x: 6, z: 160, r: 6, to: 'gloomwood', spawn: { x: 0, z: -150, yaw: 0 } },
  ],

  pois: [
    { key: 'entrance',   name: 'North Road Entrance', x: 0,   z: -150, kind: 'safe', r: 12 },
    { key: 'windmill',   name: 'Broken Windmill',     x: 84,  z: -120, kind: 'landmark' },
    { key: 'orchard',    name: 'Blighted Orchard',    x: -86, z: -116, kind: 'landmark', optional: true },
    { key: 'scarecrow',  name: 'Scarecrow Ridge',     x: -34, z: -84,  kind: 'landmark' },
    { key: 'harvest',    name: 'Harvest Road',        x: 20,  z: -70,  kind: 'landmark' },
    { key: 'watchhut',   name: 'Burned Watch Hut',    x: 74,  z: -60,  kind: 'landmark', optional: true },
    { key: 'millford',   name: "Miller's Ford",       x: -44, z: -30,  kind: 'landmark' },
    { key: 'homestead',  name: 'Abandoned Homestead',  x: -70, z: 6,   kind: 'safe', r: 10, merchant: true, optional: true },
    { key: 'shrine',     name: 'Field Shrine',        x: 6,   z: -4,   kind: 'safe', r: 11 },
    { key: 'wagon',      name: 'War Wagon Wreck',     x: 78,  z: -8,   kind: 'landmark', optional: true },
    { key: 'furrows',    name: 'Blood Furrows',       x: 58,  z: 30,   kind: 'boss', optional: true },
    { key: 'well',       name: 'Old Well',            x: -66, z: 44,   kind: 'landmark', hidden: true },
    { key: 'threshing',  name: 'Threshing Yard',      x: -14, z: 40,   kind: 'landmark' },
    { key: 'crowhollow', name: "Crow's Hollow",       x: -92, z: 78,   kind: 'landmark', hidden: true },
    { key: 'gallows',    name: 'Gallows Field',       x: 72,  z: 84,   kind: 'landmark', optional: true },
    { key: 'trenches',   name: 'Buried Trenches',     x: -30, z: 90,   kind: 'landmark' },
    { key: 'massgrave',  name: 'Mass Grave',          x: 18,  z: 108,  kind: 'boss', optional: true },
    { key: 'tunnels',    name: 'Old Farm Tunnels',    x: 86,  z: 118,  kind: 'cave', hidden: true },
    { key: 'southgate',  name: 'South Marsh Gate',    x: 6,   z: 150,  kind: 'gate', exit: true },
  ],

  // Cooking campfire at the homestead (the animated fire; stand near it to cook).
  campfires: [
    { id: 'cf_homestead', x: -66, z: 9 },
  ],

  npcs: [
    { id: 'kf_sentry',  name: 'Road Sentry Bram', x: 6,   z: -144, poi: 'entrance', model: 'Male',
      look: { hairColor: '#1e1712', skin: '#b78b68', outfit: 47, hair: 'Hair_Crop', beard: 'Beard_Stubble' },   // Steel Vanguard — the road sentry
      idle: 'The fields eat the careless. Keep moving, keep your guard up.' },
    { id: 'kf_widow',   name: 'The Field Widow',  x: -68, z: 3,   poi: 'homestead', model: 'Female', trade: true,
      look: { hairColor: '#3a3a38', skin: '#c9a07c', outfit: 39, hair: 'Hair_Mane' },   // Grave Digger — in mourning
      idle: 'Raiders took everything but my wares. Buy something, aye?' },
  ],

  // Winding cart-road down the fields.
  path: [
    { x: 0, z: -150 }, { x: 12, z: -122 }, { x: 20, z: -92 }, { x: 10, z: -64 },
    { x: -6, z: -40 }, { x: 6, z: -4 }, { x: 20, z: 24 }, { x: 4, z: 52 },
    { x: -12, z: 80 }, { x: 0, z: 108 }, { x: 8, z: 130 }, { x: 6, z: 150 },
  ],

  // Miller's Ford — a stream cutting across the fields, crossed at the ford.
  river: {
    width: 7,
    points: [
      { x: -120, z: -20 }, { x: -80, z: -26 }, { x: -44, z: -30 }, { x: -10, z: -20 },
      { x: 20, z: -6 }, { x: 40, z: 14 }, { x: 70, z: 22 }, { x: 110, z: 20 },
    ],
    bridge: { x: -44, z: -30, halfWidth: 6 }, // Miller's Ford crossing
  },

  // Impassable wrecks / rubble mounds (collision).
  rocks: [
    { x: 40, z: -110, r: 3.5 }, { x: -60, z: -70, r: 3 }, { x: 30, z: -30, r: 3 },
    { x: 90, z: 4, r: 4 }, { x: -30, z: 20, r: 3 }, { x: 50, z: 56, r: 3.5 },
    { x: -80, z: 60, r: 3 }, { x: 40, z: 100, r: 3 }, { x: -40, z: 120, r: 3.5 },
    { x: 96, z: 96, r: 3 },
  ],

  safeSpawnRadius: 26,

  scatterSeed: 5570,
  // NOTE: `r` is the piece's collision radius (0 = decor), `nearR` its spread.
  scatter: [
    // Surface ore among the furrows.
    { model: 'Copper_Ore_Vein', count: 8, r: 0.8, scale: [0.9, 1.2], near: 'millford', nearR: 24 },
    { model: 'Tin_Ore_Vein',    count: 8, r: 0.8, scale: [0.9, 1.2], near: 'threshing', nearR: 24 },
    { model: 'Iron_Ore_Vein',   count: 6, r: 0.8, scale: [0.9, 1.2], rare: true, near: 'gallows', nearR: 22 },

    // Raider war-camp at Blood Furrows.
    { model: 'Goblin_Hide_Tent', count: 3, r: 1.4, scale: [1.0, 1.1], near: 'furrows', nearR: 16 },
    { model: 'Unlit_Fire_Pit',  count: 2, r: 0, scale: [1.0, 1.0], near: 'furrows', nearR: 12 },
    { model: 'Supply_Crate',    count: 4, r: 0.8, scale: [0.9, 1.1], near: 'furrows', nearR: 16 },
    { model: 'Supply_Pavilion', count: 1, r: 1.6, scale: [1.0, 1.0], near: 'furrows', nearR: 10 },
    // Ruined homestead dressing.
    { model: 'Small_Canvas_Tent', count: 1, r: 1.4, scale: [1.0, 1.0], near: 'homestead', nearR: 10 },
    { model: 'Water_Barrel', count: 2, r: 0.7, scale: [1.0, 1.0], near: 'homestead', nearR: 10 },
    { model: 'Camp_Lantern', count: 1, r: 0, scale: [1.0, 1.0], near: 'homestead', nearR: 10 },
    { model: 'Cooking_Tripod', count: 1, r: 0, scale: [1.0, 1.0], near: 'homestead', nearR: 10 },
    // A camp at the watch hut too.
    { model: 'Goblin_Hide_Tent', count: 2, r: 1.4, scale: [1.0, 1.1], near: 'watchhut', nearR: 12 },
    { model: 'Supply_Crate',    count: 3, r: 0.8, scale: [0.9, 1.1], near: 'watchhut', nearR: 12 },
  ],

  // Level 3-8, ramping toward the southern grave-fields.
  spawns: [
    { type: 'cow',              count: 6, cx: -30, cz: -120, r: 16, level: 2, expect: 3, hint: 'Blighted pasture' },
    { type: 'goblin_scavenger', count: 6, cx: 20,  cz: -92,  r: 18, level: 3, expect: 3, hint: 'Harvest Road' },
    { type: 'goblin_scavenger', count: 5, cx: -34, cz: -84,  r: 16, level: 3, expect: 4, hint: 'Scarecrow Ridge' },
    { type: 'bandit',           count: 7, cx: 20,  cz: -50,  r: 20, level: 4, expect: 5, hint: 'Harvest Road raiders' },
    { type: 'goblin_archer',    count: 5, cx: 74,  cz: -60,  r: 14, level: 4, expect: 5, hint: 'Burned Watch Hut' },
    { type: 'bandit',           count: 6, cx: -44, cz: -30,  r: 18, level: 5, expect: 6, hint: "Miller's Ford" },
    { type: 'goblin_warrior',   count: 6, cx: 58,  cz: 30,   r: 18, level: 6, expect: 6, hint: 'Blood Furrows camp' },
    { type: 'goblin_archer',    count: 4, cx: 64,  cz: 22,   r: 12, level: 6, expect: 6, hint: 'Blood Furrows camp' },
    { type: 'bandit',           count: 6, cx: -30, cz: 90,   r: 20, level: 6, expect: 7, hint: 'Buried Trenches' },
    { type: 'guard',            count: 4, cx: 72,  cz: 84,   r: 16, level: 7, expect: 8, hint: 'Gallows Field' },
    { type: 'guard',            count: 3, cx: 8,   cz: 132,  r: 18, level: 8, expect: 8, hint: 'South Marsh approach' },
  ],

  elites: [
    { type: 'guard',         name: 'The Gallows Warden', cx: 72, cz: 84, level: 9, expect: 9 },
    { type: 'goblin_warrior', name: 'Raid-Chief Skarn',  cx: 58, cz: 30, level: 8, expect: 8, hpMult: 3, dmgMult: 1.6 },
  ],
};
