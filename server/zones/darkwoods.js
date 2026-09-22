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
    'Goblin', 'Bandit', 'Hill_Ogre', 'Cow', 'Chicken', 'Male', 'Female', 'items/Egg',
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
  // Combat is single-way here (one monster on a player at a time, OSRS rules);
  // set `multiCombat: true` on a zone to let several pile on.
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
    // Mining pits (see `mines` below): small, off the trail, worth the walk.
    { key: 'copperhollow', name: 'Copper Hollow',      x: 60,  z: -50, kind: 'mine', art: 'mine', optional: true },
    { key: 'tinscrape',    name: 'Tin Scrape',         x: -62, z: -42, kind: 'mine', art: 'mine', optional: true },
    { key: 'cave',       name: 'Hidden Cave Entrance', x: -60, z: 58,  kind: 'cave', hidden: true },
    { key: 'bridge',     name: 'Mossy Bridge',         x: -8,  z: 35,  kind: 'landmark' },
    { key: 'southgate',  name: 'South Gate',           x: 6,   z: 98,  kind: 'gate', exit: true },
  ],

  // NPCs. `id` matches a quest's `giver`; the client builds a figure here and
  // floats a ! / ? marker over it when that giver has something for you.
  npcs: [
    { id: 'alric',    name: 'Warden Alric',        x: -20,  z: -66, poi: 'entrance', model: 'Male', yaw: 3.1,
      // Looks mix the modular outfit pack by slot (outfit numbers; see client OUTFITS) with per-slot recolours.
      look: { hair: 8, hairColor: '#2b1d14', skin: '#c49a76', outfit: 21 },   // Town Guard
      idle: 'Keep to the path, and keep your blade where you can reach it.' },
    // Farmstead folk at the Entrance Clearing.
    { id: 'garrick',  name: 'Drillmaster Garrick',  x: 4,    z: -65, poi: 'entrance', model: 'Male', yaw: 3.1, trainer: 'fighter',
      look: { hair: 15, hairColor: '#3a2a1a', skin: '#b58a66', outfit: 25 },   // Sellsword
      idle: 'Swinging a stick is free. Swinging it properly costs coin. Come learn.' },
    { id: 'aldis',    name: 'Mother Aldis',         x: -8,   z: -60, poi: 'entrance', model: 'Female', yaw: 3.0, trainer: 'cleric',
      look: { hair: 3, hairColor: '#d9d2c4', skin: '#d4b394', outfit: 29, colors: { top: '#e8e0cc' } },   // a pilgrim in undyed linen
      idle: 'The Light asks little of us: mend what is broken, and stand between the dark and those who cannot.' },
    { id: 'maggie',   name: 'Old Maggie',          x: 18,   z: -79, poi: 'entrance', model: 'Female', yaw: 3.0,
      idle: 'Mind the hens, love — and shut the gate on your way out.' },
    { id: 'bram',     name: 'Farmhand Bram',       x: -19,  z: -77, poi: 'entrance', model: 'Male', yaw: 1.4,
      look: { hair: 5, hairColor: '#8a5a2b', skin: '#d9ab86', outfit: 1, slots: { boots: 2 } },   // Fieldhand in the orchard worker's boots
      idle: 'Cows need feedin’, fences need mendin’. No rest out here.' },
    { id: 'sela',     name: 'Ranger Sela',         x: 48,   z: -70, poi: 'watchtower', model: 'Female', yaw: 2.2,
      idle: 'From the old tower you can see their fires. The Wolf Den grows bolder every night.' },
    { id: 'dorn',     name: 'Prospector Dorn',     x: -34,  z: 42,  poi: 'ravine',   model: 'Male', yaw: 5.0,
      look: { hair: 1, hairColor: '#6b6b6b', skin: '#b8865f', outfit: 5 },    // Miner
      idle: 'That iron seam is mine by right — but the goblins dig it faster than I can chase them off.' },
    { id: 'hermit',   name: 'Hermit of the Grove', x: 9,    z: 4,   poi: 'shrine',   model: 'Male',
      look: { hair: 29, hairColor: '#9a9a90', skin: '#c9a07c', outfit: 29, slots: { boots: 0 }, colors: { top: '#6a6f5a' } },   // barefoot Pilgrim
      idle: 'The shrine holds. Not much else out here does.' },
    { id: 'merchant', name: 'Wandering Merchant',  x: -51.5, z: 9,  poi: 'camp',     model: 'Female', trade: true,
      idle: 'Wares? Aye, soon enough, traveller. Mind the woods.' },
  ],

  // Primary progression path (winding). Rendered as a dirt trail; also used to
  // keep the forest clear along the route.
  path: [
    { x: -26, z: -78.9 }, { x: -25, z: -70 }, { x: -24, z: -63 }, { x: -25, z: -55 }, { x: -30, z: -42 },
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
    { id: 'cf_camp',   x: -49, z: 7 },    // Abandoned Camp (on the bank beside the merchant, not in the river)
    { id: 'cf_shrine', x: 10,  z: 3 },    // Shrine Grove
  ],

  // No aggressive mob may spawn within this radius of `spawn` — the first
  // thing a new character meets is livestock, not a goblin.
  safeSpawnRadius: 30,

  // Mining pits: an open dirt scrape fenced off with a gap on the road side,
  // with a mix of ore seams spread out inside. `r` is the pit radius (zone
  // units, scaled with the zone); `veins` is how many of each seam; `inner`
  // keeps the middle clear (the goblin dig crew stands there). The pit sits at the
  // POI of the same key.
  mines: [
    { key: 'copperhollow', r: 9,  veins: { Copper: 4, Tin: 3, Iron: 1 } },
    { key: 'tinscrape',    r: 9,  veins: { Tin: 4, Copper: 3, Coal: 1 } },
    { key: 'ravine',       r: 12, inner: 3, veins: { Iron: 4, Tin: 2, Coal: 2, Silver: 1 } },
  ],

  // Surface ore, so mining can be started before the cave is survivable. The
  // richer seams are all underground.
  scatterSeed: 4412,
  // NOTE: in generateScatter, `r` is the piece's COLLISION radius (0 = walk
  // through / pure decor) and `nearR` is how far it spreads around its anchor.
  scatter: [
    // Surface ore veins (small mineable-node collision).
    // Ore is NOT scattered along the trail: it sits in three tight patches you
    // have to travel to — Copper Hollow (east, past the watchtower), Tin Scrape
    // (west, up the creek) and Dorn's iron seam in the ravine.
    // (the veins themselves come from `mines` below — fenced dirt pits with mixed seams)

    // The Abandoned Camp — a little campsite of props (tight spread, light collision).
    { model: 'Small_Canvas_Tent', count: 1, r: 1.4, scale: [1.0, 1.0], near: 'camp', nearR: 10 },
    // (the camp's fire is the cooking campfire `cf_camp` above — one fire, not a prop plus a station)
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
    { model: 'Blue_Hydrangea',  count: 4,  r: 0,   scale: [1.0, 1.2], near: 'creek', nearR: 13 },
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
    // Bushes & shrubs — walk-through (decor), like the ground plants.
    { model: 'Meadow_Shrub',        count: 14, r: 0,   scale: [0.9, 1.3] },
    { model: 'Round_Box_Bush',      count: 10, r: 0,   scale: [0.9, 1.2] },
    { model: 'Sage_Bush',           count: 10, r: 0,   scale: [0.9, 1.2] },
    { model: 'Red_Berry_Bush',      count: 10, r: 0,   scale: [0.9, 1.2] },
    { model: 'Blackberry_Bramble',  count: 8,  r: 0,   scale: [0.9, 1.3] },
    { model: 'Rose_Bush',           count: 8,  r: 0,   scale: [0.9, 1.2] },
    { model: 'Blue_Hydrangea',      count: 8,  r: 0,   scale: [0.9, 1.2] },
    { model: 'Tall_Hedgerow',       count: 8,  r: 0,   scale: [0.9, 1.3] },
    // Reeds hug the water's edge but are decor; a few dotted around damp ground.
    { model: 'Pond_Reeds',          count: 12, r: 0,   scale: [0.9, 1.3] },
  ],

  // Monster spawn regions. Level rises toward the south. `hint` labels the area
  // and `expect` is the player level the area is tuned for (see tools/balance.mjs).
  // Spawn regions — spread out and low-density (a farming zone, not a mosh pit).
  // Counts are per-group before the zone scale; regions are wide so mobs are not
  // packed together. Each area is its own creature so groups don't stack.
  spawns: [
    // Each hostile creature keeps to its own camp: a tight knot of them at
    // the centre ("core", small r) and a few that roam the woods around it
    // ("roamers": wider r and a larger wander leash). No two kinds share a camp.
    // --- The farmstead at the Entrance Clearing: livestock penned in the yard ---
    { type: 'chicken', count: 6, cx: 12,  cz: -72, r: 4, level: 1, expect: 1, hint: 'Chicken pen' },
    { type: 'cow',     count: 3, cx: -8,  cz: -71, r: 5, level: 1, expect: 1, hint: 'Cow pen' },
    // --- Goblin camp on Blackroot Creek, downhill from the Old Hunter's Trail ---
    { type: 'goblin',  count: 4, cx: -40, cz: -22, r: 5,  level: 1, expect: 2, fixed: true, hint: 'Goblin camp (core)' },
    { type: 'goblin',  count: 4, cx: -40, cz: -22, r: 22, level: 2, expect: 2, roam: 26, fixed: true, hint: 'Goblin camp (roamers)' },
    // --- Scavengers picking over Rotfen Thicket ---
    { type: 'goblin_scavenger', count: 3, cx: 48, cz: -30, r: 5,  level: 2, expect: 2, fixed: true, hint: 'Scavenger camp (core)' },
    { type: 'goblin_scavenger', count: 3, cx: 48, cz: -30, r: 20, level: 2, expect: 3, roam: 24, fixed: true, hint: 'Scavenger camp (roamers)' },
    // --- Bandit hideout in the central woods between the shrine and the thicket ---
    { type: 'bandit',  count: 4, cx: 30,  cz: -4,  r: 6,  level: 3, expect: 4, fixed: true, hint: 'Bandit hideout (core)' },
    { type: 'bandit',  count: 3, cx: 30,  cz: -4,  r: 20, level: 4, expect: 4, roam: 24, fixed: true, hint: 'Bandit hideout (roamers)' },
    // --- Goblin miners have jumped Dorn's claim in the Root-Choked Ravine ---
    { type: 'goblin_miner', count: 4, cx: -36, cz: 44, r: 6,  level: 4, expect: 5, fixed: true, hint: 'Ravine dig (core)' },
    { type: 'goblin_miner', count: 2, cx: -36, cz: 44, r: 16, level: 4, expect: 5, roam: 20, fixed: true, hint: 'Ravine dig (roamers)' },
    // --- The goblin war camp at the Wolf Den: warriors with archers behind them ---
    { type: 'goblin_warrior', count: 4, cx: 62, cz: 28, r: 6,  level: 4, expect: 5, fixed: true, hint: 'Wolf Den camp (core)' },
    { type: 'goblin_archer',  count: 3, cx: 66, cz: 32, r: 7,  level: 5, expect: 5, fixed: true, hint: 'Wolf Den camp (archers)' },
    { type: 'goblin_warrior', count: 2, cx: 62, cz: 28, r: 18, level: 4, expect: 5, roam: 22, fixed: true, hint: 'Wolf Den camp (roamers)' },
    // --- Hill ogres squatting on the South Gate approach ---
    { type: 'guard',   count: 3, cx: 10,  cz: 80,  r: 8,  level: 6, expect: 7, fixed: true, hint: 'Ogre hollow (core)' },
    { type: 'guard',   count: 1, cx: 10,  cz: 80,  r: 20, level: 5, expect: 6, roam: 24, fixed: true, hint: 'Ogre hollow (roamer)' },
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
      { x1: -42, z1: -62, x2: -25.8, z2: -62 }, // south-west (up to the double gate)
      { x1: -22.2, z1: -62, x2: 30, z2: -62 },  // south-east (from the double gate)
      // Cow pen (west of the yard), set back from the houses — opening on its north side.
      { x1: -16, z1: -78, x2: -10, z2: -78 }, { x1: -6, z1: -78, x2: 0, z2: -78 },
      { x1: -16, z1: -78, x2: -16, z2: -64 }, { x1: 0, z1: -78, x2: 0, z2: -64 },
      { x1: -16, z1: -64, x2: 0,   z2: -64 },
      // Chicken pen (east of the yard), well clear of the Warden's hut — opening on its west side.
      { x1: 6,  z1: -78, x2: 17, z2: -78 }, { x1: 6, z1: -66, x2: 17, z2: -66 },
      { x1: 17, z1: -78, x2: 17, z2: -66 },
      { x1: 6,  z1: -78, x2: 6,  z2: -75 }, { x1: 6, z1: -71, x2: 6, z2: -66 },
    ],
    gate: { x: -24, z: -62, yaw: 0, double: true, seg: { x1: -25.8, z1: -62, x2: -22.2, z2: -62 } },
    // Footpaths from each doorstep to the road. Authored so they walk AROUND
    // the pens (never through a fence): the yard lane runs along z=-83 north of
    // both pens; the Warden's hut path skirts south of the chicken pen.
    // Doorsteps sit ~2.5m in FRONT of each front wall (walls: Bram -83.35,
    // Maggie -83.06, hut west wall x 23.35), the lane runs through the front
    // yard between the houses and the pens, and spurs lead into each pen's opening.
    trails: [
      [ { x: 18, z: -81.55 }, { x: 8, z: -81.4 }, { x: -2, z: -81.85 }, { x: -14, z: -80.9 }, { x: -25, z: -77.5 } ], // yard lane: Maggie's door -> Bram's door -> road
      [ { x: 21.85, z: -67 }, { x: 21.9, z: -72 }, { x: 21, z: -78.2 }, { x: 18.5, z: -81.3 } ],                 // Warden's hut door -> lane (east of the chicken pen)
      [ { x: -8, z: -76.8 }, { x: -8, z: -81.1 } ],                                                              // cow pen opening -> lane
      [ { x: 7.2, z: -73 }, { x: 4.2, z: -73 }, { x: 4.2, z: -79.5 }, { x: 5.5, z: -81.45 } ],                    // chicken pen opening -> lane
    ],
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
      { key: 'guardhut',  name: "Warden's Hut",     x: 26, z: -67, w: 9,  d: 8,  h: 3.0, door: 'west',  roof: 0x5a5148, wall: 0xc9c2ae,
        furn: [ { k: 'bed', dx: 2.4, dz: -2.0, yaw: 0 }, { k: 'table', dx: -1.6, dz: 1.4, yaw: 0 }, { k: 'chest', dx: 2.6, dz: 2.2, yaw: 0 } ] },
    ],
    // A tilled field of crops west of the cow pen.
    field: { x: -35, z: -71, w: 22, d: 20, crops: ['Strawberry_Patch', 'Meadow_Sedge', 'Goldenrod_Patch'] },
    // Nature inside the fence: a few trees and bushes/flowers around the yard
    // (worldgen keeps the wild forest out of the farm, so these are placed by hand).
    trees: [
      { x: -12, z: -90.5, s: 1.0 }, { x: 8, z: -90.5, s: 1.05 }, { x: 27.5, z: -88, s: 0.95 },
      { x: -39, z: -79, s: 0.9 }, { x: 28.5, z: -75, s: 1.0 }, { x: 3, z: -63.6, s: 0.85 }, { x: -36, z: -63.2, s: 0.8 },
      { x: -2, z: -91.2, s: 0.8 }, { x: 22, z: -90.8, s: 0.9 }, { x: -30, z: -90.5, s: 0.85 }, { x: 29, z: -68, s: 0.85 },
      { x: -20, z: -63.6, s: 0.75 }, { x: 14, z: -63.6, s: 0.8 },
    ],
    plants: [
      { m: 'Rose_Bush',        x: -31,  z: -80.3, s: 1.0 }, { m: 'Rose_Bush',        x: -21,  z: -80.3, s: 1.0 },
      { m: 'Lavender_Clump',   x: -6.6, z: -83.3, s: 1.0 }, { m: 'Lavender_Clump',   x: 2.6,  z: -83.3, s: 1.0 },
      { m: 'Flowering_Bush',   x: 13.2, z: -83.0, s: 1.0 }, { m: 'Flowering_Bush',   x: 22.6, z: -83.0, s: 1.0 },
      { m: 'Wildflower_Patch', x: -8,   z: -88.5, s: 1.1 }, { m: 'Wildflower_Patch', x: 13,   z: -88.5, s: 1.1 },
      { m: 'Clover_Patch',     x: -20,  z: -88,   s: 1.2 }, { m: 'Clover_Patch',     x: 24,   z: -80,   s: 1.1 },
      { m: 'Berry_Bush',       x: 29,   z: -64.5, s: 0.9 }, { m: 'Round_Box_Bush',   x: 26,   z: -63.3, s: 0.8 },
      { m: 'Meadow_Shrub',     x: -40,  z: -86,   s: 1.0 }, { m: 'Poppy_Patch',      x: -33,  z: -63.2, s: 1.0 },
      { m: 'Hosta_Plant',      x: -18,  z: -80.6, s: 1.0 }, { m: 'Green_Fern',       x: 30,   z: -86,   s: 1.0 },
      { m: 'Strawberry_Patch', x: -33,  z: -80.4, s: 1.0 }, { m: 'Wildflower_Patch', x: -36,  z: -83,   s: 1.1 },
      { m: 'Normal_Bush',      x: -41,  z: -70,   s: 0.9 }, { m: 'Meadow_Shrub',     x: -41,  z: -64,   s: 0.9 },
      { m: 'Clover_Patch',     x: 1.5,  z: -89.5, s: 1.2 }, { m: 'Poppy_Patch',      x: 10,   z: -84.5, s: 1.0 },
      { m: 'Heather_Clump',    x: 28,   z: -82.5, s: 1.0 }, { m: 'Goldenrod_Patch',  x: 26,   z: -71.5, s: 0.9 },
      { m: 'Sage_Bush',        x: 2.8,  z: -66,   s: 0.9 }, { m: 'Creeping_Bellflowers', x: -6, z: -63.4, s: 1.0 },
      { m: 'Green_Fern',       x: -11,  z: -89.8, s: 1.0 }, { m: 'Lavender_Clump',   x: 15,   z: -90.4, s: 1.0 },
      { m: 'Round_Box_Bush',   x: -12,  z: -84.6, s: 0.8 }, { m: 'Berry_Bush',       x: 9,    z: -66.5, s: 0.85 },
    ],
    props: [
      // Chicken pen: coop, house, nests, feeders.
      { m: 'Walk_In_Chicken_House', x: 13.5, z: -75, yaw: 3.14, s: 1.0, c: 2.2 },
      { m: 'Raised_Chicken_Coop',   x: 10,  z: -68.5, yaw: 3.6, s: 1.0, c: 1.3 },
      { m: 'Nesting_Boxes',         x: 15,  z: -68, yaw: 4.0,  s: 1.0, c: 0.8 },
      { m: 'Chicken_Feeder',        x: 12,  z: -71.5, yaw: 0,  s: 1.0, c: 0.4 },
      { m: 'Chicken_Waterer',       x: 14.5, z: -71, yaw: 0,   s: 1.0, c: 0.4 },
      // Cow pen: troughs and hay.
      { m: 'Feeding_Trough',        x: -13, z: -68, yaw: 1.57, s: 1.0, c: 0.7 },
      { m: 'Water_Trough',          x: -3,  z: -67, yaw: 1.57, s: 1.0, c: 0.7 },
      { m: 'Round_Hay_Bale',        x: -13, z: -75, yaw: 0.5,  s: 1.0, c: 0.7 },
      // Yard clutter around the square and the houses.
      { m: 'Tall_Haystack',         x: 8,   z: -88, yaw: 0,    s: 1.0, c: 1.1 },
      { m: 'Stacked_Hay_Bales',     x: 11,  z: -85, yaw: 1.2,  s: 1.0, c: 0.9 },
      { m: 'Hay_Pile',              x: 27,  z: -80, yaw: 0,    s: 1.0, c: 0.7 },
      { m: 'Scarecrow',             x: -35, z: -71, yaw: 3.14, s: 1.0, c: 0.4 },
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
