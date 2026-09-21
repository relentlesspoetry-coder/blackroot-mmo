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
    'Goblin', 'Bandit', 'Hill_Ogre', 'Cow', 'Chicken', 'Male', 'Female',
    // Low-level goblin-kin variants
    'Goblin_Scavenger', 'Goblin_Warrior', 'Goblin_Archer', 'Goblin_Shaman', 'Goblin_Miner',
    // Full-canopy tree models + every bush species
    'Ancient_Forest_Tree', 'Broad_Crown_Oak', 'Tall_Leafy_Birch', 'Twisted_Darkwood', 'Weeping_Willow',
    'Normal_Bush', 'Berry_Bush', 'Flowering_Bush', 'Thorn_Bush', 'Darkroot_Bush', 'Dead_Bush',
    // Campsite props (Abandoned Camp + goblin camps)
    'props/Campfire', 'props/Unlit_Fire_Pit', 'props/Cooking_Tripod', 'props/Bedroll', 'props/Rolled_Bedroll',
    'props/Camp_Stool', 'props/Camp_Lantern', 'props/Small_Canvas_Tent', 'props/Goblin_Hide_Tent',
    'props/Supply_Crate', 'props/Water_Barrel',
    // Dark Woods decor + goblin-camp dressing (new asset pack)
    'Twisted_Dead_Tree', 'Hollow_Stump', 'Exposed_Roots', 'Dark_Fern', 'Poison_Mushrooms', 'Bone_Pile',
    'Rough_Fence', 'Warning_Sign', 'Spike_Barricade', 'Goblin_Banner', 'Goblin_Totem',
    // Meadow plants & bushes (undergrowth pack, batches 1 & 2)
    'Broadleaf_Plant', 'Clover_Patch', 'Green_Fern', 'Lavender_Clump', 'Meadow_Grass', 'Meadow_Shrub',
    'Pond_Reeds', 'Red_Berry_Bush', 'Round_Box_Bush', 'Tall_Hedgerow', 'Wildflower_Patch',
    'Blackberry_Bramble', 'Blue_Hydrangea', 'Creeping_Bellflowers', 'Foxglove_Clump', 'Goldenrod_Patch',
    'Heather_Clump', 'Hosta_Plant', 'Meadow_Sedge', 'Poppy_Patch', 'Rose_Bush', 'Sage_Bush', 'Strawberry_Patch',
    // Ambient flying critters (butterflies by day, moths by night)
    'Butterfly', 'Moth',
    // Wild woodland rabbits (small game)
    'Rabbit',
    'cave/Copper_Ore_Vein', 'cave/Tin_Ore_Vein', 'cave/Iron_Ore_Vein',
    'items/Copper_Ore', 'items/Tin_Ore', 'items/Iron_Ore',
    // Farmstead at the Entrance Clearing (Farm_Assets pack)
    'farm/Farm_Fence', 'farm/Farm_Gate', 'farm/Raised_Chicken_Coop', 'farm/Walk_In_Chicken_House',
    'farm/Nesting_Boxes', 'farm/Chicken_Feeder', 'farm/Chicken_Waterer', 'farm/Feeding_Trough',
    'farm/Water_Trough', 'farm/Tall_Haystack', 'farm/Round_Hay_Bale', 'farm/Stacked_Hay_Bales',
    'farm/Hay_Pile', 'farm/Scarecrow', 'farm/Grain_Barrel', 'farm/Grain_Sack', 'farm/Vegetable_Crate',
    'farm/Wheelbarrow', 'farm/Farm_Handcart', 'farm/Pitchfork',
  ],

  treeSeed: 1337,
  treeCount: 120, // scaled up with the zone at load

  // A low-level farming zone: mobs respawn quickly so grinding stays smooth.
  respawnMult: 0.4,

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

  // The continuous rock wall's foot sits on the boundary line, so the player is
  // stopped right at the rock by the boundary itself — no inset gap needed.
  boundaryInset: 0,

  spawn: { x: -29, z: -85, yaw: 1.2 }, // beside the bed, inside the Hearthstead farmhouse (see farm.houses)

  // Rendering atmosphere — bright, readable, Old School RuneScape style.
  // Deeper woods: pull the clear-weather fog in so distant trees fade into a
  // soft haze (depth + mood) without going dark. A hint of warm, mossy green.
  env: { bg: 0x9fc4dc, fogNear: 32, fogFar: 210, hemiSky: 0xcfe4f0, hemiGround: 0x5f6f3e, hemiInt: 1.25, sun: 0xfff3d6, sunInt: 1.2 },

  // Zone transitions — step onto the cave mouth to descend, or the South Gate
  // to cross into the Killing Fields. (Portal locations scale with the zone; the
  // `spawn` destinations are in the other, unscaled zones and are left as-is.)
  portals: [
    { x: -60, z: 58, r: 5, to: 'hiddencave', spawn: { x: 0, z: -152, yaw: 0 } },
    { x: 6, z: 98, r: 5, to: 'killingfields', spawn: { x: 0, z: -150, yaw: 0 } },
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
    { key: 'entrance',   name: 'Hearthstead Farm',     x: -4,  z: -78, kind: 'safe', r: 24 },
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
    { key: 'bridge',     name: 'Mossy Bridge',         x: -8,  z: 35,  kind: 'landmark' },
    { key: 'southgate',  name: 'South Gate',           x: 6,   z: 98,  kind: 'gate', exit: true },
  ],

  // NPCs. `id` matches a quest's `giver`; the client builds a figure here and
  // floats a ! / ? marker over it when that giver has something for you.
  npcs: [
    { id: 'alric',    name: 'Warden Alric',        x: -12,  z: -66, poi: 'entrance', model: 'Male', yaw: 3.1,
      idle: 'Keep to the path, and keep your blade where you can reach it.' },
    // Farmstead folk at the Entrance Clearing.
    { id: 'maggie',   name: 'Old Maggie',          x: 18,   z: -79, poi: 'entrance', model: 'Female', yaw: 3.0,
      idle: 'Mind the hens, love — and shut the gate on your way out.' },
    { id: 'bram',     name: 'Farmhand Bram',       x: -19,  z: -77, poi: 'entrance', model: 'Male', yaw: 1.4,
      idle: 'Cows need feedin’, fences need mendin’. No rest out here.' },
    { id: 'sela',     name: 'Ranger Sela',         x: 48,   z: -70, poi: 'watchtower', model: 'Female', yaw: 2.2,
      idle: 'From the old tower you can see their fires. The Wolf Den grows bolder every night.' },
    { id: 'tam',      name: 'Trapper Tam',         x: -24,  z: -60, poi: 'hunter',   model: 'Male', yaw: 1.2,
      idle: 'Set my snares at dawn, find them sprung and empty by noon. Goblins, most like.' },
    { id: 'dorn',     name: 'Prospector Dorn',     x: -34,  z: 42,  poi: 'ravine',   model: 'Male', yaw: 5.0,
      idle: 'That iron seam is mine by right — but the goblins dig it faster than I can chase them off.' },
    { id: 'hermit',   name: 'Hermit of the Grove', x: 9,    z: 4,   poi: 'shrine',   model: 'Male',
      idle: 'The shrine holds. Not much else out here does.' },
    { id: 'merchant', name: 'Wandering Merchant',  x: -51.5, z: 9,  poi: 'camp',     model: 'Female', trade: true,
      idle: 'Wares? Aye, soon enough, traveller. Mind the woods.' },
  ],

  // Primary progression path (winding). Rendered as a dirt trail; also used to
  // keep the forest clear along the route.
  path: [
    { x: 3, z: -84 }, { x: 3, z: -66 }, { x: -8, z: -63 }, { x: -18, z: -54 }, { x: -30, z: -42 },
    { x: -34, z: -24 }, { x: -20, z: -8 }, { x: 6, z: 2 }, { x: 6, z: 22 },
    // A straight run through the Mossy Bridge crossing so the deck lines up.
    { x: -2, z: 30 }, { x: -8, z: 35 }, { x: -14, z: 40 },
    { x: -6, z: 54 }, { x: 2, z: 66 }, { x: 5, z: 82 }, { x: 6, z: 98 },
  ],

  // Blackroot Creek — flows in from the west, crosses the trail once at the
  // Mossy Bridge, then bends away to the east so it never runs over the path.
  river: {
    width: 6,
    // First & last points run past the zone bounds (minX -90 / maxX 90) so the
    // river flows in and out under the boundary treeline instead of dead-ending
    // in a pool in the middle of the woods.
    points: [
      { x: -98, z: 2 }, { x: -78, z: 8 }, { x: -58, z: 14 }, { x: -38, z: 20 }, { x: -20, z: 28 },
      { x: -8, z: 35 }, { x: 10, z: 44 }, { x: 30, z: 54 }, { x: 52, z: 62 }, { x: 72, z: 72 }, { x: 98, z: 85 },
    ],
    bridge: { x: -8, z: 35, halfWidth: 5 }, // the single crossing, on the trail
  },

  // Impassable rocks/cliffs (collision). Trees are visual-only.
  // The scattered decorative boulders were removed (too large/ugly); only the
  // Hidden Cave entrance mound remains. Its mouth (the portal at -60,58) is the
  // only way in — these blocks stop you walking through the rock face.
  rocks: [
    { x: -64, z: 60, r: 6 }, { x: -59, z: 64, r: 3 }, { x: -67, z: 56, r: 3 },
  ],

  // Treasure chests reward exploring the optional landmarks. Loot scales with
  // how deep/dangerous the spot is. Positions are pre-scale like everything else.
  chests: [
    { id: 'watchtower', x: 52, z: -74, gold: 70,  item: 'Leather Body' },        // old soldier's kit at the Fallen Watchtower
    { id: 'rotfen',     x: 50, z: -32, gold: 110, item: 'Battered Iron Shield' }, // bandit stash in the Rotfen Thicket
    { id: 'wolfden',    x: 64, z: 30,  gold: 160, item: 'Iron Sword' },           // goblin plunder at the Wolf Den
    { id: 'stones',     x: 20, z: 38,  gold: 240, item: 'Crystal Heart' },        // the Guardian's hoard at the Stone Circle
  ],

  // Fishing spots along Blackroot Creek (fished from the bank). Tier gates which
  // fish lands; positions are pre-scale like everything else.
  fishingSpots: [
    { id: 'fs_shr1', tier: 'Shrimp', x: -20, z: 24 },
    { id: 'fs_shr2', tier: 'Shrimp', x: 2,   z: 39 },
    { id: 'fs_tro1', tier: 'Trout',  x: 28,  z: 49 },
    { id: 'fs_sal1', tier: 'Salmon', x: 52,  z: 58 },
  ],

  // Campfire cooking stations. Stand near one to cook raw meat/fish.
  campfires: [
    { id: 'cf_farm',   x: 20,  z: -80 },  // by the Entrance Clearing (early cooking)
    { id: 'cf_camp',   x: -48, z: 14 },   // Abandoned Camp
    { id: 'cf_shrine', x: 10,  z: 3 },    // Shrine Grove
  ],

  // No aggressive mob may spawn within this radius of `spawn` — the first
  // thing a new character meets is livestock, not a goblin.
  safeSpawnRadius: 30,

  // Surface ore, so mining can be started before the cave is survivable. The
  // richer seams are all underground.
  scatterSeed: 4412,
  // NOTE: in generateScatter, `r` is the piece's COLLISION radius (0 = walk
  // through / pure decor) and `nearR` is how far it spreads around its anchor.
  scatter: [
    // Surface ore veins (small mineable-node collision).
    { model: 'Copper_Ore_Vein', count: 6, r: 0.8, scale: [0.9, 1.2], near: 'hunter', nearR: 24 },
    { model: 'Tin_Ore_Vein',    count: 6, r: 0.8, scale: [0.9, 1.2], near: 'hunter', nearR: 24 },
    { model: 'Iron_Ore_Vein',   count: 5, r: 0.8, scale: [0.9, 1.2], rare: true, near: 'ravine', nearR: 22 },

    // The Abandoned Camp — a little campsite of props (tight spread, light collision).
    { model: 'Small_Canvas_Tent', count: 1, r: 1.4, scale: [1.0, 1.0], near: 'camp', nearR: 10 },
    { model: 'Campfire',       count: 1, r: 0, scale: [0.9, 1.1], near: 'camp', nearR: 8 },
    { model: 'Cooking_Tripod', count: 1, r: 0, scale: [0.9, 1.1], near: 'camp', nearR: 9 },
    { model: 'Bedroll',        count: 2, r: 0, scale: [1.0, 1.0], near: 'camp', nearR: 10 },
    { model: 'Camp_Stool',     count: 2, r: 0, scale: [1.0, 1.0], near: 'camp', nearR: 10 },
    { model: 'Camp_Lantern',   count: 1, r: 0, scale: [1.0, 1.0], near: 'camp', nearR: 10 },
    { model: 'Supply_Crate',   count: 2, r: 0.8, scale: [0.9, 1.1], near: 'camp', nearR: 11 },
    { model: 'Water_Barrel',   count: 1, r: 0.7, scale: [1.0, 1.0], near: 'camp', nearR: 10 },
    { model: 'Rolled_Bedroll', count: 1, r: 0, scale: [1.0, 1.0], near: 'camp', nearR: 10 },

    // Goblin war-camp at the Wolf Den — tents, totem, banners, crude defenses.
    { model: 'Goblin_Hide_Tent', count: 2, r: 1.4, scale: [1.0, 1.1], near: 'wolfden', nearR: 14 },
    { model: 'Goblin_Totem',    count: 1, r: 0.6, scale: [1.0, 1.1], near: 'wolfden', nearR: 8 },
    { model: 'Goblin_Banner',   count: 2, r: 0.4, scale: [1.0, 1.1], near: 'wolfden', nearR: 14 },
    { model: 'Unlit_Fire_Pit',  count: 1, r: 0, scale: [1.0, 1.0], near: 'wolfden', nearR: 9 },
    { model: 'Supply_Crate',    count: 2, r: 0.8, scale: [0.9, 1.1], near: 'wolfden', nearR: 14 },
    { model: 'Spike_Barricade', count: 3, r: 0.8, scale: [1.0, 1.1], near: 'wolfden', nearR: 16 },
    { model: 'Rough_Fence',     count: 4, r: 0.5, scale: [1.0, 1.1], near: 'wolfden', nearR: 16 },
    { model: 'Warning_Sign',    count: 1, r: 0, scale: [1.0, 1.0], near: 'wolfden', nearR: 16 },

    // Rotfen bandit thicket — a small camp.
    { model: 'Goblin_Hide_Tent', count: 1, r: 1.4, scale: [1.0, 1.1], near: 'rotfen', nearR: 12 },
    { model: 'Unlit_Fire_Pit',  count: 1, r: 0, scale: [1.0, 1.0], near: 'rotfen', nearR: 10 },
    { model: 'Rough_Fence',     count: 3, r: 0.5, scale: [1.0, 1.1], near: 'rotfen', nearR: 14 },

    // Root-Choked Ravine — the goblins' stolen dig site: crates of hauled ore,
    // barricades, a cold fire pit, bones and the exposed roots that name it.
    { model: 'Supply_Crate',    count: 3, r: 0.8, scale: [0.9, 1.1], near: 'ravine', nearR: 12 },
    { model: 'Spike_Barricade', count: 2, r: 0.8, scale: [1.0, 1.1], near: 'ravine', nearR: 13 },
    { model: 'Unlit_Fire_Pit',  count: 1, r: 0,   scale: [1.0, 1.0], near: 'ravine', nearR: 10 },
    { model: 'Goblin_Banner',   count: 1, r: 0.4, scale: [1.0, 1.1], near: 'ravine', nearR: 12 },
    { model: 'Bone_Pile',       count: 2, r: 0,   scale: [1.0, 1.2], near: 'ravine', nearR: 12 },
    { model: 'Exposed_Roots',   count: 5, r: 0,   scale: [1.0, 1.4], near: 'ravine', nearR: 14 },

    // Blackroot Creek — a reedy, marshy bend of the river: reeds, ferns, sedge
    // and damp-loving flowers cluster where the water meets the trail.
    { model: 'Pond_Reeds',      count: 10, r: 0, scale: [1.0, 1.5], near: 'creek', nearR: 14 },
    { model: 'Meadow_Sedge',    count: 8,  r: 0, scale: [1.0, 1.4], near: 'creek', nearR: 14 },
    { model: 'Green_Fern',      count: 8,  r: 0, scale: [1.0, 1.4], near: 'creek', nearR: 15 },
    { model: 'Blue_Hydrangea',  count: 4,  r: 0.6, scale: [1.0, 1.2], near: 'creek', nearR: 13 },
    { model: 'Hollow_Stump',    count: 2,  r: 0.8, scale: [1.0, 1.2], near: 'creek', nearR: 14 },

    // Fallen Watchtower — an abandoned lookout gone to ruin: toppled fence,
    // broken barricades, scattered crates, a warning sign and bleached bones.
    { model: 'Spike_Barricade', count: 3, r: 0.8, scale: [1.0, 1.2], near: 'watchtower', nearR: 12 },
    { model: 'Rough_Fence',     count: 4, r: 0.5, scale: [1.0, 1.1], near: 'watchtower', nearR: 14 },
    { model: 'Supply_Crate',    count: 3, r: 0.8, scale: [0.9, 1.1], near: 'watchtower', nearR: 12 },
    { model: 'Warning_Sign',    count: 1, r: 0,   scale: [1.0, 1.0], near: 'watchtower', nearR: 10 },
    { model: 'Bone_Pile',       count: 2, r: 0,   scale: [1.0, 1.3], near: 'watchtower', nearR: 12 },
    { model: 'Twisted_Dead_Tree', count: 3, r: 0.9, scale: [1.0, 1.4], near: 'watchtower', nearR: 16 },

    // Ancient Stone Circle — the Rootbound Guardian's grove: goblin totems, dead
    // trees, bones and poison mushrooms give it an ominous, ritual feel.
    { model: 'Goblin_Totem',    count: 3, r: 0.6, scale: [1.0, 1.2], near: 'stones', nearR: 12 },
    { model: 'Twisted_Dead_Tree', count: 4, r: 0.9, scale: [1.1, 1.5], near: 'stones', nearR: 15 },
    { model: 'Bone_Pile',       count: 3, r: 0,   scale: [1.0, 1.3], near: 'stones', nearR: 13 },
    { model: 'Poison_Mushrooms', count: 6, r: 0,  scale: [1.0, 1.4], near: 'stones', nearR: 14 },
    { model: 'Exposed_Roots',   count: 4, r: 0,   scale: [1.0, 1.4], near: 'stones', nearR: 13 },

    // Atmospheric flora & bones scattered zone-wide (no anchor).
    { model: 'Twisted_Dead_Tree', count: 10, r: 0.9, scale: [0.9, 1.3] },
    { model: 'Hollow_Stump',      count: 7,  r: 0.8, scale: [0.9, 1.2] },
    { model: 'Exposed_Roots',     count: 10, r: 0,   scale: [0.9, 1.3] },
    { model: 'Dark_Fern',         count: 16, r: 0,   scale: [0.9, 1.4] },
    { model: 'Poison_Mushrooms',  count: 10, r: 0,   scale: [0.9, 1.3] },
    { model: 'Bone_Pile',         count: 7,  r: 0,   scale: [0.9, 1.2] },

    // Meadow undergrowth — lush low plants, flowers & bushes scattered zone-wide
    // to fill out the forest floor (Meadow Plants & Bushes pack, batches 1 & 2).
    // Ground plants & ferns are pure decor (walk-through); bushes block lightly.
    { model: 'Green_Fern',          count: 22, r: 0,   scale: [0.8, 1.3] },
    { model: 'Broadleaf_Plant',     count: 20, r: 0,   scale: [0.8, 1.2] },
    { model: 'Hosta_Plant',         count: 16, r: 0,   scale: [0.8, 1.2] },
    { model: 'Clover_Patch',        count: 18, r: 0,   scale: [0.9, 1.3] },
    { model: 'Meadow_Grass',        count: 24, r: 0,   scale: [0.8, 1.3] },
    { model: 'Meadow_Sedge',        count: 16, r: 0,   scale: [0.8, 1.2] },
    { model: 'Wildflower_Patch',    count: 18, r: 0,   scale: [0.8, 1.2] },
    { model: 'Poppy_Patch',         count: 12, r: 0,   scale: [0.8, 1.2] },
    { model: 'Lavender_Clump',      count: 12, r: 0,   scale: [0.8, 1.1] },
    { model: 'Heather_Clump',       count: 12, r: 0,   scale: [0.8, 1.2] },
    { model: 'Goldenrod_Patch',     count: 10, r: 0,   scale: [0.8, 1.1] },
    { model: 'Foxglove_Clump',      count: 10, r: 0,   scale: [0.8, 1.1] },
    { model: 'Creeping_Bellflowers',count: 12, r: 0,   scale: [0.8, 1.2] },
    { model: 'Strawberry_Patch',    count: 10, r: 0,   scale: [0.8, 1.2] },
    // Bushes & shrubs — light collision so they read as solid cover.
    { model: 'Meadow_Shrub',        count: 14, r: 0.7, scale: [0.9, 1.3] },
    { model: 'Round_Box_Bush',      count: 10, r: 0.7, scale: [0.9, 1.2] },
    { model: 'Sage_Bush',           count: 10, r: 0.7, scale: [0.9, 1.2] },
    { model: 'Red_Berry_Bush',      count: 10, r: 0.7, scale: [0.9, 1.2] },
    { model: 'Blackberry_Bramble',  count: 8,  r: 0.8, scale: [0.9, 1.3] },
    { model: 'Rose_Bush',           count: 8,  r: 0.7, scale: [0.9, 1.2] },
    { model: 'Blue_Hydrangea',      count: 8,  r: 0.7, scale: [0.9, 1.2] },
    { model: 'Tall_Hedgerow',       count: 8,  r: 0.9, scale: [0.9, 1.3] },
    // Reeds hug the water's edge but are decor; a few dotted around damp ground.
    { model: 'Pond_Reeds',          count: 12, r: 0,   scale: [0.9, 1.3] },
  ],

  // Monster spawn regions. Level rises toward the south. `hint` labels the area
  // and `expect` is the player level the area is tuned for (see tools/balance.mjs).
  // Spawn regions — spread out and low-density (a farming zone, not a mosh pit).
  // Counts are per-group before the zone scale; regions are wide so mobs are not
  // packed together. Each area is its own creature so groups don't stack.
  spawns: [
    // --- The farmstead at the Entrance Clearing: livestock penned in the yard ---
    { type: 'chicken', count: 6, cx: 13,  cz: -74, r: 5, level: 1, expect: 1, hint: 'Chicken pen' },
    { type: 'cow',     count: 3, cx: -8,  cz: -73, r: 5, level: 1, expect: 1, hint: 'Cow pen' },
    // --- Wild rabbits: small game scattered through the open woods ---
    { type: 'rabbit',  count: 5, cx: -18, cz: -40, r: 30, level: 1, expect: 1, hint: 'Woodland rabbits' },
    { type: 'rabbit',  count: 5, cx: 20,  cz: 10,  r: 32, level: 1, expect: 1, hint: 'Woodland rabbits' },
    // --- Trail: lone goblins & scavengers, well spaced ---
    { type: 'goblin',           count: 4, cx: -22, cz: -56, r: 20, level: 1, expect: 2, hint: "Old Hunter's Trail" },
    { type: 'goblin_scavenger', count: 4, cx: 14,  cz: -40, r: 22, level: 2, expect: 2, hint: 'Trail scavengers' },
    { type: 'goblin',           count: 3, cx: -38, cz: -18, r: 20, level: 2, expect: 3, hint: 'Blackroot Creek' },
    // --- Bandits through the central woods ---
    { type: 'bandit',  count: 4, cx: 50,  cz: -30, r: 22, level: 3, expect: 4, hint: 'Rotfen Thicket' },
    { type: 'bandit',  count: 3, cx: 24,  cz: 18,  r: 24, level: 4, expect: 4, hint: 'Central Woods' },
    // --- Ravine miners + a goblin camp out at the Wolf Den ---
    { type: 'goblin_miner',   count: 3, cx: -34, cz: 42, r: 18, level: 4, expect: 5, hint: 'Ravine miners' },
    { type: 'goblin_warrior', count: 4, cx: 62,  cz: 26, r: 20, level: 4, expect: 5, hint: 'Wolf Den camp' },
    { type: 'goblin_archer',  count: 2, cx: 72,  cz: 36, r: 14, level: 5, expect: 5, hint: 'Wolf Den camp' },
    // --- Guards toward the south gate ---
    { type: 'guard',   count: 2, cx: -32, cz: 46,  r: 18, level: 5, expect: 6, hint: 'Root-Choked Ravine' },
    { type: 'guard',   count: 2, cx: 10,  cz: 82,  r: 22, level: 6, expect: 7, hint: 'South Gate approach' },
  ],

  // A single low-level optional elite — the zone's capstone, nothing harder.
  elites: [
    { type: 'guard', name: 'The Rootbound Guardian', cx: 24, cz: 36, level: 6, expect: 6 },
  ],

  // The farmstead ringing the Entrance Clearing. Coords are pre-scale like the
  // rest of the zone; server buildFarm() (after scaleZone) tiles Farm_Fence
  // panels along each segment, adds wall collision, and drops the props in.
  //   fences: perimeter segments (gate gap left open on the south edge)
  //   gate:   the swing-gate prop that sits in that gap (walkable)
  //   props:  m=model, yaw, s=scale, c=collision radius (0 = pure decor)
  farm: {
    // Hearthstead: a fenced farm village at the Entrance Clearing. The player
    // wakes up in the farmhouse. Positions are zone units (scaled ×1.7 at load);
    // house sizes / furniture offsets are world metres and are NOT scaled.
    fences: [
      // Village perimeter (north edge is tucked inside the mountain boundary).
      { x1: -34, z1: -92, x2: 30,  z2: -92 },   // north
      { x1: 30,  z1: -92, x2: 30,  z2: -62 },   // east
      { x1: -42, z1: -86, x2: -34, z2: -92 },   // north-west corner
      { x1: -42, z1: -86, x2: -42, z2: -62 },   // west
      { x1: -42, z1: -62, x2: -8.7, z2: -62 },  // south-west (up to the gate)
      { x1: -7.3, z1: -62, x2: 30,  z2: -62 },  // south-east (from the gate)
      // Cow pen (west of the yard) — opening on its north side.
      { x1: -16, z1: -80, x2: -10, z2: -80 }, { x1: -6, z1: -80, x2: 0, z2: -80 },
      { x1: -16, z1: -80, x2: -16, z2: -66 }, { x1: 0, z1: -80, x2: 0, z2: -66 },
      { x1: -16, z1: -66, x2: 0,   z2: -66 },
      // Chicken pen (east of the yard) — opening on its west side.
      { x1: 6,  z1: -80, x2: 20, z2: -80 }, { x1: 6, z1: -68, x2: 20, z2: -68 },
      { x1: 20, z1: -80, x2: 20, z2: -68 },
      { x1: 6,  z1: -80, x2: 6,  z2: -76 }, { x1: 6, z1: -72, x2: 6, z2: -68 },
    ],
    gate: { x: -8, z: -62, yaw: 0, s: 0.9, seg: { x1: -8.7, z1: -62, x2: -7.3, z2: -62 } },
    // Enterable houses: axis-aligned, `door` is the side the doorway is on.
    // Furniture offsets (dx,dz) are metres from the house centre.
    houses: [
      { key: 'farmhouse', name: 'Farmhouse', x: -26, z: -84, w: 16, d: 12, h: 3.4, door: 'south', roof: 0x8a5a3a, wall: 0xd9cfb6,
        furn: [
          { k: 'bed',       dx: -5.2, dz: -3.6, yaw: 0 },     // the player's bed (west room)
          { k: 'chest',     dx: -6.8, dz: -0.2, yaw: 1.57 },
          { k: 'table',     dx: 3.2,  dz: -1.6, yaw: 0 },
          { k: 'stool',     dx: 3.2,  dz: 0.6,  yaw: 0 }, { k: 'stool', dx: 5.0, dz: -1.6, yaw: 0 },
          { k: 'hearth',    dx: 6.6,  dz: -4.4, yaw: 0 },
          { k: 'shelf',     dx: -1.0, dz: -5.0, yaw: 0 },
        ] },
      { key: 'maggie',    name: "Maggie's Cottage", x: 18, z: -86, w: 12, d: 10, h: 3.2, door: 'south', roof: 0x6f5a48, wall: 0xcdc3a8,
        furn: [ { k: 'bed', dx: -3.4, dz: -3.0, yaw: 0 }, { k: 'table', dx: 2.6, dz: -0.6, yaw: 0 }, { k: 'stool', dx: 2.6, dz: 1.4, yaw: 0 }, { k: 'hearth', dx: 4.6, dz: -3.6, yaw: 0 } ] },
      { key: 'bram',      name: "Bram's Cottage",   x: -2, z: -86, w: 11, d: 9,  h: 3.1, door: 'south', roof: 0x7a6248, wall: 0xd2c8ae,
        furn: [ { k: 'bed', dx: 3.0, dz: -2.6, yaw: 0 }, { k: 'chest', dx: -3.8, dz: -2.8, yaw: 0 }, { k: 'table', dx: -2.4, dz: 0.8, yaw: 0 }, { k: 'stool', dx: -0.6, dz: 0.8, yaw: 0 } ] },
      { key: 'guardhut',  name: "Warden's Hut",     x: 24, z: -68, w: 9,  d: 8,  h: 3.0, door: 'west',  roof: 0x5a5148, wall: 0xc9c2ae,
        furn: [ { k: 'bed', dx: 2.4, dz: -2.0, yaw: 0 }, { k: 'table', dx: -1.6, dz: 1.4, yaw: 0 }, { k: 'chest', dx: 2.6, dz: 2.2, yaw: 0 } ] },
    ],
    // A tilled field of crops west of the cow pen.
    field: { x: -29, z: -71, w: 30, d: 20, crops: ['Strawberry_Patch', 'Meadow_Sedge', 'Goldenrod_Patch'] },
    props: [
      // Chicken pen: coop, house, nests, feeders.
      { m: 'Walk_In_Chicken_House', x: 16,  z: -77, yaw: 3.14, s: 1.0, c: 2.2 },
      { m: 'Raised_Chicken_Coop',   x: 10,  z: -71, yaw: 3.6,  s: 1.0, c: 1.3 },
      { m: 'Nesting_Boxes',         x: 18,  z: -70, yaw: 4.0,  s: 1.0, c: 0.8 },
      { m: 'Chicken_Feeder',        x: 12,  z: -76, yaw: 0,    s: 1.0, c: 0.4 },
      { m: 'Chicken_Waterer',       x: 14,  z: -73, yaw: 0,    s: 1.0, c: 0.4 },
      // Cow pen: troughs and hay.
      { m: 'Feeding_Trough',        x: -13, z: -70, yaw: 1.57, s: 1.0, c: 0.7 },
      { m: 'Water_Trough',          x: -3,  z: -69, yaw: 1.57, s: 1.0, c: 0.7 },
      { m: 'Round_Hay_Bale',        x: -12, z: -77, yaw: 0.5,  s: 1.0, c: 0.7 },
      // Yard clutter around the square and the houses.
      { m: 'Tall_Haystack',         x: 8,   z: -88, yaw: 0,    s: 1.0, c: 1.1 },
      { m: 'Stacked_Hay_Bales',     x: 11,  z: -85, yaw: 1.2,  s: 1.0, c: 0.9 },
      { m: 'Hay_Pile',              x: 26,  z: -78, yaw: 0,    s: 1.0, c: 0.7 },
      { m: 'Scarecrow',             x: -29, z: -71, yaw: 3.14, s: 1.0, c: 0.4 },
      { m: 'Grain_Barrel',          x: -17, z: -86, yaw: 0,    s: 1.0, c: 0.5 },
      { m: 'Grain_Sack',            x: -15, z: -87, yaw: 0.8,  s: 1.0, c: 0.0 },
      { m: 'Vegetable_Crate',       x: -19, z: -87, yaw: 0.3,  s: 1.0, c: 0.5 },
      { m: 'Wheelbarrow',           x: -12, z: -84, yaw: 2.2,  s: 1.0, c: 0.4 },
      { m: 'Farm_Handcart',         x: 4,   z: -84, yaw: 1.0,  s: 1.0, c: 0.6 },
      { m: 'Pitchfork',             x: -16, z: -74, yaw: 0.3,  s: 1.0, c: 0.0 },
      { m: 'Water_Barrel',          x: 26,  z: -64, yaw: 0,    s: 1.0, c: 0.5 },
    ],
  },

  // No environmental hazards — the poison damage areas (and their green circles)
  // were removed.
  hazards: [],
};
