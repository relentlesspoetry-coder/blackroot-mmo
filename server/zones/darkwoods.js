// Blackroot — Zone 1: The Dark Woods
// Hand-authored from the Dark Woods Zone Layout Blueprint.
//
// Coordinate system: North (top of the blueprint) is -Z, South is +Z,
// West is -X, East is +X. The player enters at the north Entrance Clearing
// and progresses south to the South Gate. Difficulty ramps up toward the south.

export const darkwoods = {
  id: 'darkwoods',
  name: 'The Dark Woods',
  subtitle: 'Zone I',
  // Client assets this zone needs. Fetched on entry, cached after that.
  models: [
    'Goblin', 'Bandit', 'Hill_Ogre', 'Cow', 'Chicken',
    'Oak_Tree', 'Willow_Tree', 'Yew_Tree', 'Maple_Tree', 'Magic_Tree', 'Normal_Tree', 'Tree',
    'Normal_Bush', 'Berry_Bush', 'Flowering_Bush', 'Thorn_Bush', 'Darkroot_Bush', 'Dead_Bush',
    'cave/Copper_Ore_Vein', 'cave/Tin_Ore_Vein', 'cave/Iron_Ore_Vein',
    'items/Copper_Ore', 'items/Tin_Ore', 'items/Iron_Ore',
  ],

  treeSeed: 1337,
  treeCount: 120, // thinned, well-spaced, and solid

  // Axis-aligned bounds (used for spawn sampling / grid sizing).
  bounds: { minX: -90, maxX: 90, minZ: -105, maxZ: 105 },

  // Organic landmass outline (clockwise). The zone is this shape, not a square.
  boundary: [
    { x: -28, z: -96 }, { x: 10, z: -101 }, { x: 44, z: -88 }, { x: 68, z: -76 },
    { x: 86, z: -52 }, { x: 76, z: -22 }, { x: 88, z: 8 }, { x: 78, z: 38 },
    { x: 86, z: 68 }, { x: 56, z: 92 }, { x: 16, z: 103 }, { x: -18, z: 96 },
    { x: -52, z: 101 }, { x: -84, z: 74 }, { x: -74, z: 40 }, { x: -88, z: 6 },
    { x: -78, z: -30 }, { x: -86, z: -60 }, { x: -58, z: -84 },
  ],

  spawn: { x: 5, z: -92, yaw: 0 }, // Entrance Clearing, facing south

  // Rendering atmosphere — bright, readable, Old School RuneScape style.
  env: { bg: 0x9fc4dc, fogNear: 90, fogFar: 320, hemiSky: 0xcfe4f0, hemiGround: 0x5f6f3e, hemiInt: 1.25, sun: 0xfff3d6, sunInt: 1.2 },

  // Zone transitions — step onto the cave mouth to descend.
  portals: [
    { x: -60, z: 58, r: 5, to: 'hiddencave', spawn: { x: 0, z: -42, yaw: 0 } },
  ],

  // ------------------------------------------------------------------
  // Points of interest. `kind` drives both server rules and client visuals.
  //   safe     — rest/safe area: no aggro, boosted regen (has radius r)
  //   landmark — labelled marker
  //   boss     — elite encounter site (Ancient Stone Circle)
  //   cave     — hidden cave descent (marker only for now)
  //   gate     — zone exit
  // ------------------------------------------------------------------
  pois: [
    { key: 'entrance',   name: 'Entrance Clearing',    x: 5,   z: -92, kind: 'safe', r: 10 },
    { key: 'hunter',     name: "Old Hunter's Trail",   x: -26, z: -62, kind: 'landmark' },
    { key: 'watchtower', name: 'Fallen Watchtower',    x: 50,  z: -72, kind: 'landmark', optional: true },
    { key: 'creek',      name: 'Blackroot Creek',      x: -40, z: -22, kind: 'landmark' },
    { key: 'rotfen',     name: 'Rotfen Thicket',       x: 48,  z: -30, kind: 'landmark', optional: true },
    { key: 'shrine',     name: 'Shrine Grove',         x: 6,   z: 2,   kind: 'safe', r: 11 },
    { key: 'camp',       name: 'Abandoned Camp',       x: -50, z: 12,  kind: 'safe', r: 9, merchant: true, optional: true },
    { key: 'stones',     name: 'Ancient Stone Circle', x: 24,  z: 36,  kind: 'boss', optional: true },
    { key: 'wolfden',    name: 'Wolf Den',             x: 62,  z: 28,  kind: 'landmark', hidden: true },
    { key: 'ravine',     name: 'Root-Choked Ravine',   x: -36, z: 44,  kind: 'landmark' },
    { key: 'cave',       name: 'Hidden Cave Entrance', x: -60, z: 58,  kind: 'cave', hidden: true },
    { key: 'bridge',     name: 'Mossy Bridge',         x: 2,   z: 66,  kind: 'landmark' },
    { key: 'southgate',  name: 'South Gate',           x: 6,   z: 98,  kind: 'gate', exit: true },
  ],

  // NPCs. `id` matches a quest's `giver`; the client builds a figure here and
  // floats a ! / ? marker over it when that giver has something for you.
  npcs: [
    { id: 'alric',    name: 'Warden Alric',        x: 11,   z: -88, poi: 'entrance', tint: 0x5a6f4a,
      idle: 'Keep to the path, and keep your blade where you can reach it.' },
    { id: 'hermit',   name: 'Hermit of the Grove', x: 9,    z: 4,   poi: 'shrine',   tint: 0xb8a97a,
      idle: 'The shrine holds. Not much else out here does.' },
    { id: 'merchant', name: 'Wandering Merchant',  x: -51.5, z: 9,  poi: 'camp',     tint: 0x8a5cc0, trade: true,
      idle: 'Wares? Aye, soon enough, traveller. Mind the woods.' },
  ],

  // Primary progression path (winding). Rendered as a dirt trail; also used to
  // keep the forest clear along the route.
  path: [
    { x: 5, z: -92 }, { x: -6, z: -76 }, { x: -22, z: -62 }, { x: -30, z: -42 },
    { x: -34, z: -24 }, { x: -20, z: -8 }, { x: 6, z: 2 }, { x: 6, z: 22 },
    { x: -14, z: 40 }, { x: -6, z: 54 }, { x: 2, z: 66 }, { x: 5, z: 82 }, { x: 6, z: 98 },
  ],

  // Blackroot Creek — a river running down the western-centre of the zone.
  // The Mossy Bridge (near z=66) is the only crossing; elsewhere it blocks
  // movement, so the route funnels through the bridge.
  river: {
    width: 6,
    points: [
      { x: -48, z: -30 }, { x: -40, z: -18 }, { x: -30, z: -2 }, { x: -18, z: 16 },
      { x: -8, z: 36 }, { x: -1, z: 54 }, { x: 2, z: 66 }, { x: 6, z: 84 }, { x: 9, z: 105 },
    ],
    bridge: { x: 2, z: 66, halfWidth: 5 }, // crossing gap at the Mossy Bridge
  },

  // Impassable rocks/cliffs (collision). Trees are visual-only.
  rocks: [
    { x: -18, z: -70, r: 3 }, { x: 30, z: -55, r: 3.5 }, { x: 44, z: -44, r: 3 },
    { x: -48, z: -8, r: 3 }, { x: 20, z: -14, r: 2.5 }, { x: 40, z: 8, r: 3.5 },
    { x: -30, z: 30, r: 3 }, { x: 34, z: 48, r: 3 }, { x: 55, z: 40, r: 3.5 },
    { x: -20, z: 60, r: 2.5 }, { x: 26, z: 74, r: 3 }, { x: -46, z: 46, r: 3 },
  ],

  // No aggressive mob may spawn within this radius of `spawn` — the first
  // thing a new character meets is livestock, not a goblin.
  safeSpawnRadius: 30,

  // Surface ore, so mining can be started before the cave is survivable. The
  // richer seams are all underground.
  scatterSeed: 4412,
  scatter: [
    // Anchored on landmarks the player actually walks past. The creek reads as
    // the obvious spot for surface ore, but its POI sits on the river itself,
    // which is the one thing you cannot walk through.
    { model: 'Copper_Ore_Vein', count: 6, r: 0.8, scale: [0.9, 1.2], near: 'hunter' },
    { model: 'Tin_Ore_Vein',    count: 6, r: 0.8, scale: [0.9, 1.2], near: 'hunter' },
    { model: 'Iron_Ore_Vein',   count: 5, r: 0.8, scale: [0.9, 1.2], rare: true, near: 'ravine' },
  ],

  // Monster spawn regions. Level rises toward the south. `hint` labels the area
  // and `expect` is the player level the area is tuned for (see tools/balance.mjs).
  spawns: [
    // --- Entrance: passive livestock only, inside the first 30m ---
    { type: 'chicken', count: 6, cx: 16,  cz: -80, r: 11, level: 1, expect: 1, hint: 'Entrance Clearing' },
    { type: 'cow',     count: 5, cx: -20, cz: -74, r: 14, level: 1, expect: 1, hint: 'Entrance meadow' },
    { type: 'chicken', count: 4, cx: -48, cz: 12,  r: 8,  level: 1, expect: 5, hint: 'Abandoned Camp' },
    // --- First real fights: lone level-1 goblins along the trail ---
    { type: 'goblin',  count: 5, cx: -20, cz: -56, r: 16, level: 1, expect: 2, hint: "Old Hunter's Trail" },
    { type: 'goblin',  count: 4, cx: -34, cz: -22, r: 18, level: 2, expect: 3, hint: 'Blackroot Creek' },
    // --- The ramp proper ---
    { type: 'bandit',  count: 6, cx: 48,  cz: -30, r: 16, level: 3, expect: 4, hint: 'Rotfen Thicket' },
    { type: 'bandit',  count: 4, cx: 24,  cz: 18,  r: 20, level: 3, expect: 4, hint: 'Central Woods' },
    { type: 'bandit',  count: 6, cx: 62,  cz: 28,  r: 14, level: 4, expect: 5, hint: 'Wolf Den' },
    { type: 'guard',   count: 3, cx: -32, cz: 44,  r: 16, level: 5, expect: 6, hint: 'Root-Choked Ravine' },
    { type: 'guard',   count: 3, cx: 8,   cz: 82,  r: 18, level: 6, expect: 7, hint: 'South Gate approach' },
  ],

  // Named elite / boss encounter.
  elites: [
    { type: 'guard', name: 'The Rootbound Guardian', cx: 24, cz: 36, level: 8, expect: 8 },
  ],

  // Environmental hazards (damage-over-time areas). Intensity rises southward.
  hazards: [
    { key: 'rotfen',  type: 'poison', x: 48,  z: -30, r: 12, dps: 4, label: 'Rotfen Thicket' },
    { key: 'ravine',  type: 'poison', x: -36, z: 44,  r: 11, dps: 6, label: 'Choking Roots' },
    { key: 'southbog', type: 'poison', x: 10, z: 82,  r: 13, dps: 8, label: 'Blighted Bog' },
  ],
};
