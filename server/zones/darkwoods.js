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
    'Goblin', 'Bandit', 'Hill_Ogre', 'Cow', 'Chicken', 'items/Egg',
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
  // 270 x 210 zone units = 459 x 357 metres once scaled: the blueprint's
  // 1.7:1.3 proportion, at a density the forest and the framerate can carry.
  bounds: { minX: -135, maxX: 135, minZ: -110, maxZ: 100 },

  // Organic landmass outline (clockwise), traced off the blueprint: the wide
  // north shoulder that holds Hearthstead, the eastern bulge behind Murkfen,
  // and the long south-western sweep under Crow Hill.
  boundary: [
    { x: -76, z: -104 }, { x: -46, z: -108 }, { x: -6, z: -108 }, { x: 30, z: -100 },
    { x: 70, z: -88 },   { x: 104, z: -68 },  { x: 126, z: -38 },
    { x: 124, z: -4 },   { x: 114, z: 30 },   { x: 90, z: 60 },
    { x: 56, z: 88 },    { x: 18, z: 97 },    { x: -22, z: 92 },
    { x: -60, z: 80 },   { x: -94, z: 58 },   { x: -118, z: 30 },
    { x: -131, z: 2 },   { x: -124, z: -32 }, { x: -106, z: -60 },
    { x: -90, z: -82 },
  ],

  // The continuous rock wall's foot sits on the boundary line, so the player is
  // stopped right at the rock by the boundary itself — no inset gap needed.
  boundaryInset: 0,

  spawn: { x: -49, z: -96, yaw: 1.2 }, // beside the bed, inside the Hearthstead farmhouse (see farm.houses)

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
    { x: 1, z: 69, r: 5, to: 'hiddencave', spawn: { x: 0, z: -152, yaw: 0 } },
    { x: 48, z: 86, r: 5, to: 'killingfields', spawn: { x: 0, z: -150, yaw: 0 } },
  ],

  // ------------------------------------------------------------------
  // Points of interest, laid out from the Dark Woods Zone Layout Blueprint.
  // The nine blueprint landmarks are here under the keys the quests, NPCs and
  // scatter already use, so the zone's content moved with its geography:
  //   ravenwater  Ravenwater Pool   (NW)  deep water, the creek's source
  //   shrine      Fallen Chapel     (N)   haunted ruins -- the hermit's ground
  //   stones      Grimroot Thicket  (NE)  cursed trees, the Rootbound Guardian
  //   wolfsnag    Wolfsnag Pass     (W)   narrow cliffs, the western chokepoint
  //   outpost     Witchlight Camp   (C)   traders, rest, supplies
  //   rotfen      Murkfen           (E)   shallow marsh, unstable ground
  //   watchtower  Crow Hill         (SW)  the old lookout
  //   wolfden     Briar Camp        (SE)  the goblin war camp
  //   cave        Spider Den        (S)   the descent
  //
  // `kind` drives both server rules and client visuals:
  //   safe     — rest/safe area: no aggro, boosted regen (has radius r)
  //   landmark — labelled marker
  //   boss     — elite encounter site
  //   cave     — descent to another zone
  //   gate     — zone exit
  // ------------------------------------------------------------------
  pois: [
    // --- The road in, and the farm the player wakes up on ---
    { key: 'northtrail', name: 'North Trail',           x: -44, z: -105, kind: 'landmark' },
    { key: 'entrance',   name: 'Hearthstead Farm',      x: -26, z: -86, kind: 'safe', r: 26 },
    { key: 'hunter',     name: "Old Hunter's Trail",    x: -40, z: -58, kind: 'landmark' },
    // --- North: the pool, the chapel, the cursed thicket ---
    { key: 'ravenwater', name: 'Ravenwater Pool',       x: -48, z: -30, kind: 'landmark' },   // marked from the quiet north shore
    { key: 'shrine',     name: 'Fallen Chapel',         x: 34,  z: -78, kind: 'safe', r: 12 },
    { key: 'stones',     name: 'Grimroot Thicket',      x: 91,  z: -68, kind: 'boss', optional: true },
    // --- The main road west to east ---
    { key: 'westroad',   name: 'West Road',             x: -128, z: 2,  kind: 'landmark' },
    { key: 'wolfsnag',   name: 'Wolfsnag Pass',         x: -84, z: -20, kind: 'landmark' },
    { key: 'ravine',     name: 'Root-Choked Ravine',    x: -114, z: -16, kind: 'mine', art: 'mine', optional: true },
    { key: 'creek',      name: 'Blackroot Creek',       x: -30, z: -24, kind: 'landmark' },   // the ford, south bank
    { key: 'outpost',    name: 'Witchlight Camp',       x: 1,   z: -6,  kind: 'safe', r: 14 },
    { key: 'rotfen',     name: 'Murkfen',               x: 88,  z: 3,   kind: 'landmark', optional: true },
    { key: 'eastpath',   name: 'East Path',             x: 120, z: -36, kind: 'landmark' },
    // --- South: the lookout, the war camp, the den ---
    { key: 'watchtower', name: 'Crow Hill',             x: -84, z: 26,  kind: 'landmark', optional: true },
    { key: 'bridge',     name: 'Mossy Bridge',          x: 20,  z: 27,  kind: 'landmark' },
    { key: 'wolfden',    name: 'Briar Camp',            x: 63,  z: 35,  kind: 'landmark' },
    { key: 'camp',       name: 'Wayside Camp',          x: -14, z: 56,  kind: 'safe', r: 9, merchant: true, optional: true },
    { key: 'cave',       name: 'Spider Den',            x: 1,   z: 69,  kind: 'cave' },
    { key: 'southgate',  name: 'South Track',           x: 48,  z: 86,  kind: 'gate', exit: true },
    // --- Mining scrapes, off the road and worth the walk ---
    { key: 'copperhollow', name: 'Copper Hollow',       x: 104, z: -46, kind: 'mine', art: 'mine', optional: true },
    { key: 'tinscrape',    name: 'Tin Scrape',          x: -112, z: -40, kind: 'mine', art: 'mine', optional: true },
  ],

  // NPCs. `id` matches a quest's `giver`; the client builds a figure here and
  // floats a ! / ? marker over it when that giver has something for you.
  npcs: [
    { id: 'alric',    name: 'Warden Alric',        x: -40.0,  z: -77.0, poi: 'entrance', model: 'Male', yaw: 3.1,
      // Looks mix the modular outfit pack by slot (outfit numbers; see client OUTFITS) with per-slot recolours.
      look: { hairColor: '#2b1d14', skin: '#c49a76', outfit: 4, hair: 'Hair_Crop', beard: 'Beard_Short' },   // Royal Knight — the warden of the clearing in plate
      idle: 'Keep to the path, and keep your blade where you can reach it.' },
    // Farmstead folk at the Entrance Clearing.
    { id: 'garrick',  name: 'Drillmaster Garrick',  x: -16.0,    z: -76.0, poi: 'entrance', model: 'Male', yaw: 3.1, trainer: 'fighter',
      look: { hairColor: '#3a2a1a', skin: '#b58a66', outfit: 6, hair: 'Hair_Undercut', beard: 'Beard_Full' },   // Sellsword — the drillmaster in a mercenary's brigandine
      idle: 'Swinging a stick is free. Swinging it properly costs coin. Come learn.' },
    { id: 'aldis',    name: 'Mother Aldis',         x: -28.0,   z: -71.0, poi: 'entrance', model: 'Female', yaw: 3.0, trainer: 'cleric',
      look: { hairColor: '#d9d2c4', skin: '#d4b394', outfit: 31, hair: 'Hair_Bowl' },   // Temple Acolyte — undyed long tunic and circlet
      idle: 'The Light asks little of us: mend what is broken, and stand between the dark and those who cannot.' },
    { id: 'lark',     name: 'Lark the Minstrel',    x: -6.0,   z: -69.0, poi: 'entrance', model: 'Male', yaw: 3.4, trainer: 'bard',
      look: { hairColor: '#7a4a22', skin: '#d2a67f', outfit: 19, hair: 'Hair_Swept', beard: 'Beard_Goatee' },   // Rose Bard — doublet and feathered cape
      idle: 'Every fight has a rhythm, friend. Learn to hear it and the whole party keeps time.' },
    { id: 'maggie',   name: 'Old Maggie',          x: -2.0,   z: -90.0, poi: 'entrance', model: 'Female', yaw: 3.0,
      look: { hairColor: '#b9b2a4', skin: '#d4b394', outfit: 1, hair: 'Hair_Topknot' },   // Village Farmhand
      idle: 'Mind the hens, love — and shut the gate on your way out.' },
    { id: 'bram',     name: 'Farmhand Bram',       x: -39.0,  z: -88.0, poi: 'entrance', model: 'Male', yaw: 1.4,
      look: { hairColor: '#8a5a2b', skin: '#d9ab86', outfit: 1, hair: 'Hair_Bowl' },   // Village Farmhand
      idle: 'Cows need feedin’, fences need mendin’. No rest out here.' },
    // --- Dark Woods Outpost: the warden's camp, and the zone's story ---
    { id: 'rowan',    name: 'Warden Rowan',        x: 1.0,  z: -3.0, poi: 'outpost', model: 'Male', yaw: 3.14,
      look: { hairColor: '#4a4038', skin: '#bc8f68', outfit: 47, hair: 'Hair_Receding', beard: 'Beard_Short' },   // Steel Vanguard — the outpost's warden
      idle: 'Never walk these roads without light. The animals I understand — it is what moves when they go quiet that bothers me.' },
    { id: 'brann',    name: 'Hunter Brann',        x: -5.0,  z: -8.0, poi: 'outpost', model: 'Male', yaw: 1.2,
      look: { hairColor: '#5a3a1e', skin: '#c08a5e', outfit: 3, hair: 'Hair_Ponytail', beard: 'Beard_Stubble' },   // Forest Ranger — jerkin, hood and cloak
      idle: 'Lift your boot. You are standing in a track, and a very big one.' },
    { id: 'lysa',     name: 'Scout Lysa',          x: 6.0,   z: -9.0, poi: 'outpost', model: 'Female', yaw: 0.6,
      look: { hairColor: '#2e1d12', skin: '#c99a74', outfit: 36, hair: 'Hair_Ponytail' },   // Snow Scout — fur vest and hood
      idle: 'The trees in the old grove are changing. Black bark, purple veins under the roots.' },
    { id: 'mira',     name: 'Mira Thorn',          x: -3.0,  z: 0.0, poi: 'outpost', model: 'Female', yaw: 2.4,
      look: { hairColor: '#6b4a24', skin: '#d0a57e', outfit: 9, hair: 'Hair_Mane' },   // Grey Wanderer — a herbalist's robe
      idle: 'A disease kills something. This is changing it. That is the difference, and it is the whole problem.' },
    { id: 'tessa',    name: 'Quartermaster Tessa', x: 5.0,   z: -2.0, poi: 'outpost', model: 'Female', yaw: 3.6,
      look: { hairColor: '#3a2a1a', skin: '#c9996f', outfit: 29, hair: 'Hair_Braids' },   // Wine Merchant — a quartermaster's surcoat
      idle: 'Food, medicine, weapons, coffee. Ask me which one I miss most.' },
    { id: 'alden',    name: 'Brother Alden',       x: -2.0,  z: -11.0, poi: 'outpost', model: 'Male', yaw: 0.2,
      look: { hairColor: '#8a8276', skin: '#c7a081', outfit: 42, hair: 'Hair_Receding', beard: 'Beard_Full' },   // Crimson Cardinal — the priest
      idle: 'Have you heard the bell? It has been abandoned twenty years, and still it rings.' },
    { id: 'fenwick',  name: 'Old Fenwick',         x: 9.0,   z: -14.0, poi: 'outpost', model: 'Male', yaw: 4.2,
      look: { hairColor: '#b9b2a4', skin: '#b98f6a', outfit: 28, hair: 'Hair_Mane', beard: 'Beard_Full' },   // Bog Hermit — the old woodsman
      idle: 'Brown ones are safe. Blue ones are safe. Red ones depend on how attached you are to your organs.' },
    // Far enough from his own camp's roamers that a level-3 errand isn't a fight.
    { id: 'pib',      name: 'Pib',                 x: -16.0,  z: -20.0, poi: 'creek', model: 'Goblin_Scavenger', yaw: 1.0, h: 1.5,
      idle: 'Pib not fighting. Pib waving. Keep doing nothing, is good.' },
    { id: 'sela',     name: 'Ranger Sela',         x: -86.0,   z: 28.0, poi: 'watchtower', model: 'Female', yaw: 2.2,
      look: { hairColor: '#2e1d12', skin: '#c99a74', outfit: 3, hair: 'Hair_Braids' },   // Forest Ranger
      idle: 'From the old tower you can see their fires. The Wolf Den grows bolder every night.' },
    { id: 'dorn',     name: 'Prospector Dorn',     x: -112.0, z: -11.0,  poi: 'ravine',   model: 'Male', yaw: 5.0,
      look: { hairColor: '#b9b2a4', skin: '#b98f6a', outfit: 32, hair: 'Hair_Crop', beard: 'Beard_Full' },   // Blacksmith — apron and headband
      idle: 'That iron seam is mine by right — but the goblins dig it faster than I can chase them off.' },
    { id: 'hermit',   name: 'Hermit of the Grove', x: 37.0,    z: -76.0,   poi: 'shrine',   model: 'Male',
      look: { hairColor: '#9a9a90', skin: '#c9a07c', outfit: 28, wear: { boots: 0 } },   // Bog Hermit, barefoot
      idle: 'The shrine holds. Not much else out here does.' },
    { id: 'merchant', name: 'Wandering Merchant',  x: -15.5, z: 53.0,  poi: 'camp',     model: 'Female', trade: true,
      look: { hairColor: '#4a2e1a', skin: '#d0a57e', outfit: 29, hair: 'Hair_Topknot' },   // Wine Merchant
      idle: 'Wares? Aye, soon enough, traveller. Mind the woods.' },
  ],

  // The road network. The blueprint draws a main road west-to-east through the
  // pass and the camp, with spurs to the chapel, the thicket, the hill, the war
  // camp and each of the four ways out -- so this is `paths` (many) rather than
  // the old single `path`. Every one is a dirt trail the forest keeps clear of.
  paths: [
    // Main road: West Road -> Wolfsnag Pass -> Witchlight Camp -> Murkfen -> East Path
    [ { x: -128, z: 2 }, { x: -112, z: -5 }, { x: -96, z: -15 }, { x: -84, z: -20 },
      { x: -62, z: -21 }, { x: -40, z: -17 }, { x: -20, z: -12 }, { x: 1, z: -6 },
      { x: 24, z: -4 }, { x: 48, z: -4 }, { x: 70, z: -4 }, { x: 86, z: -6 },
      { x: 102, z: -18 }, { x: 120, z: -36 } ],
    // North Trail -> Hearthstead's gate -> south to Witchlight Camp
    [ { x: -44, z: -105 }, { x: -44, z: -92 }, { x: -44, z: -80 }, { x: -44, z: -73 },
      { x: -42, z: -62 }, { x: -38, z: -48 }, { x: -28, z: -32 }, { x: -16, z: -18 },
      { x: 1, z: -6 } ],
    // Chapel spur, east off the north road
    [ { x: -40, z: -58 }, { x: -20, z: -66 }, { x: 2, z: -72 }, { x: 20, z: -76 }, { x: 34, z: -78 } ],
    // Grimroot spur, north-east off the main road
    [ { x: 48, z: -4 }, { x: 58, z: -22 }, { x: 70, z: -40 }, { x: 82, z: -56 }, { x: 91, z: -68 } ],
    // South road: Witchlight Camp -> Mossy Bridge -> Spider Den -> South Track
    [ { x: 1, z: -6 }, { x: 4, z: 8 }, { x: 2, z: 26 }, { x: -2, z: 42 },
      { x: -6, z: 56 }, { x: 1, z: 69 }, { x: 16, z: 78 }, { x: 32, z: 83 }, { x: 48, z: 86 } ],
    // Crow Hill spur, west off the south road
    [ { x: -2, z: 42 }, { x: -24, z: 38 }, { x: -46, z: 33 }, { x: -66, z: 29 }, { x: -84, z: 26 } ],
    // Briar Camp spur, east off the south road, over the Mossy Bridge
    [ { x: 2, z: 26 }, { x: 22, z: 29 }, { x: 42, z: 32 }, { x: 63, z: 35 } ],
    // Fen causeway: Briar Camp north along the shallows to the main road, which
    // closes the eastern half of the blueprint's loop.
    [ { x: 63, z: 35 }, { x: 74, z: 26 }, { x: 82, z: 14 }, { x: 87, z: 2 }, { x: 86, z: -6 } ],
    // The south-western sweep: Crow Hill round to the Wayside Camp, so the
    // hill is on the circuit instead of being a there-and-back spur.
    [ { x: -84, z: 26 }, { x: -68, z: 40 }, { x: -46, z: 51 }, { x: -28, z: 56 }, { x: -14, z: 56 } ],
  ],

  // Three bodies of water, as the blueprint draws them.
  //   Ravenwater Pool  deep, and therefore solid -- you walk around it
  //   Blackroot Creek  drains the pool east into the fen, crossed twice
  //   the south creek  runs down past the den, crossed at the Mossy Bridge
  // (Murkfen itself is shallow: see `pools` below, which you can wade.)
  rivers: [
    { name: 'Blackroot Creek', width: 8,
      points: [
        { x: -56, z: -45 }, { x: -44, z: -40 }, { x: -30, z: -35 }, { x: -16, z: -31 },
        { x: -2, z: -27 }, { x: 14, z: -23 }, { x: 30, z: -19 }, { x: 48, z: -15 },
        { x: 62, z: -16 }, { x: 72, z: -18 },
      ],
      // Where the north road and the Grimroot spur cross it.
      bridges: [ { x: -26, z: -34 }, { x: 51, z: -14 } ] },
    { name: 'Witchwater', width: 7,
      points: [
        { x: 14, z: 2 }, { x: 12, z: 20 }, { x: 10, z: 38 }, { x: 14, z: 56 },
        { x: 22, z: 74 }, { x: 34, z: 94 },
      ],
      // The Mossy Bridge on the Briar spur, and the south road's last crossing.
      bridges: [ { x: 11, z: 26 }, { x: 29, z: 86 } ] },
  ],

  // Standing water, drawn as the blueprint draws it rather than as a river made
  // fat enough to pretend. A deep lake is solid -- you walk around Ravenwater.
  // A shallow one is a fen: you wade it, and it slows nothing but your nerve.
  lakes: [
    { name: 'Ravenwater Pool', points: [
      { x: -118, z: -54 }, { x: -114, z: -66 }, { x: -104, z: -75 }, { x: -90, z: -80 },
      { x: -76, z: -80 }, { x: -68, z: -77 }, { x: -58, z: -62 }, { x: -54, z: -52 },
      { x: -58, z: -45 }, { x: -68, z: -38 }, { x: -82, z: -35 }, { x: -96, z: -38 },
      { x: -110, z: -45 },
    ] },
    { name: 'Murkfen', shallow: true, points: [
      { x: 40, z: -6 }, { x: 46, z: -18 }, { x: 58, z: -26 }, { x: 74, z: -30 },
      { x: 92, z: -29 }, { x: 108, z: -24 }, { x: 120, z: -14 }, { x: 124, z: -1 },
      { x: 120, z: 11 }, { x: 108, z: 19 }, { x: 92, z: 22 }, { x: 74, z: 20 },
      { x: 56, z: 14 }, { x: 44, z: 5 },
    ] },
  ],

  // ------------------------------------------------------------------
  // Relief. The blueprint labels its contours from 60 m in the fen up to
  // 340 m on Crow Hill; these are those readings as broad domes, at about a
  // quarter of true scale so the slopes stay walkable under this camera.
  // The land falls away east into Murkfen and north-west into the pool.
  // ------------------------------------------------------------------
  hills: [
    { x: -84, z: 26,  r: 62, h: 22 },   // Crow Hill -- 340 m, the zone's high point
    { x: -99, z: 14,  r: 40, h: 7 },    // its western shoulder (150 m)
    { x: -92, z: 48,  r: 44, h: 9 },    // and the ridge running south off it
    { x: 23,  z: -83, r: 52, h: 16 },   // the chapel's rise (280 m)
    { x: -108, z: -24, r: 46, h: 13 },  // the ground above Wolfsnag Pass (220 m)
    { x: 89,  z: -50, r: 46, h: 12 },   // east of Grimroot (240 m)
    { x: 59,  z: -62, r: 42, h: 9 },    // the thicket's shoulder (180 m)
    { x: 0,   z: -46, r: 48, h: 9 },    // the rise between creek and chapel (200 m)
    { x: -27, z: 67,  r: 46, h: 8 },    // above the Spider Den (190 m)
    { x: 78,  z: 58,  r: 44, h: 7 },    // behind Briar Camp (160 m)
    { x: 127, z: 9,   r: 34, h: 5 },    // the eastern rim (150 m)
  ],

  // Impassable rock (collision). Trees are visual-only.
  // Wolfsnag Pass is the blueprint's western chokepoint: two spurs of cliff
  // reaching in from north and south, leaving one gap the road threads. Walk
  // west and this is the only way through.
  rocks: [
    { x: -94, z: -36, r: 11 }, { x: -82, z: -39, r: 12 }, { x: -69, z: -37, r: 10 },
    { x: -100, z: 3, r: 11 }, { x: -86, z: 1, r: 12 },   { x: -72, z: -1, r: 10 },
    // The mound the Spider Den is cut into -- its mouth (the portal) is the only way in.
    { x: -6, z: 74, r: 6 }, { x: 3, z: 76, r: 3 }, { x: -7, z: 66, r: 3 },
  ],

  // Treasure chests reward exploring the optional landmarks. Loot scales with
  // how deep/dangerous the spot is. Positions are pre-scale like everything else.
  // Things in the world a quest can ask you to put your hands on. `tag` groups
  // a set (three lanterns, three signal fires); `once` means it stays done for
  // that player; `respawn` makes it a gathering node that grows back.
  //   m/yaw/s/c behave like props; `reach` is how close you must stand.
  objects: [
    // The outpost's own lanterns, on poles round the edge of the camp. Anyone
    // can light one or put it out again, and everyone standing there sees it:
    // this is world state, not a quest.
    { id: 'camp_lantern_1', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: 1.0, z: 0.76, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_2', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: 6.86, z: -2.62, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_3', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: 6.86, z: -9.38, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_4', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: 1.0, z: -12.76, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_5', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: -4.86, z: -9.38, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_6', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: -4.86, z: -2.62, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    // Warden Rowan's trail lanterns. Dark until someone crushes glowcaps into
    // the oil — the first thing the outpost asks of a newcomer.
    { id: 'lantern_east',  tag: 'lantern', name: 'Eastern Trail Lantern',  m: 'props/Camp_Lantern', x: 27.0,  z: -4.0, s: 1.6, c: 0.5, once: true,
      quest: 'dw_lanterns', need: { item: 'Glowcap', count: 2 }, verb: 'Light',
      text: 'You crush the Glowcaps into the lantern oil. The lantern flickers to life.',
      idleText: 'The lantern is dark. Warden Rowan would know what it needs.' },
    { id: 'lantern_bridge', tag: 'lantern', name: 'Old Bridge Lantern',    m: 'props/Camp_Lantern', x: -18, z: -21, s: 1.6, c: 0.5, once: true,
      quest: 'dw_lanterns', need: { item: 'Glowcap', count: 2 }, verb: 'Light',
      text: 'The oil catches. The dark trail becomes easier to see.',
      idleText: 'The lantern is dark. Warden Rowan would know what it needs.' },
    { id: 'lantern_north', tag: 'lantern', name: 'Northern Trail Lantern', m: 'props/Camp_Lantern', x: -39, z: -50, s: 1.6, c: 0.5, once: true,
      quest: 'dw_lanterns', need: { item: 'Glowcap', count: 2 }, verb: 'Light',
      text: 'The last lantern takes the flame. All three trail lanterns are burning.',
      idleText: 'The lantern is dark. Warden Rowan would know what it needs.' },
    // The supply cart the goblins jumped, on the eastern road. Read the scene,
    // then prise the crates back out of the ditch.
    { id: 'cart_wheel', tag: 'cart', name: 'Broken Wheel',    m: 'farm/Farm_Handcart', x: 51.0, z: -33.0, yaw: 0.6, s: 1.0, c: 1.2, once: true,
      quest: 'dw_supplies', verb: 'Inspect', reach: 4,
      text: 'The wheel is split through, and the axle with it. Nobody drove this off the road by accident.',
      idleText: 'A handcart, tipped into the ditch and stripped.' },
    { id: 'cart_tracks', tag: 'cart', name: 'Goblin Footprints', m: 'Bone_Pile', x: 54.0, z: -30.0, yaw: 2.2, s: 0.7, c: 0, once: true,
      quest: 'dw_supplies', verb: 'Inspect', reach: 4,
      text: 'Small feet, a dozen of them, all heading east into the thicket.',
      idleText: 'Churned mud, and something picked clean beside it.' },
    { id: 'cart_chest', tag: 'cart', name: 'Empty Supply Chest', m: 'props/Supply_Crate', x: 49.0, z: -29.0, yaw: 1.1, s: 1.0, c: 0.7, once: true,
      quest: 'dw_supplies', verb: 'Inspect', reach: 4,
      text: 'Lid off, straw everywhere, nothing left inside but a boot print.',
      idleText: 'An empty crate with its lid prised off.' },
    // What the raiders dropped on the way home — scattered along the thicket road.
    ...[[59.0, -34.0], [64.0, -30.0], [68.0, -26.0], [60.0, -30.0]].map(([x, z], i) => ({
      id: 'crate_' + i, tag: 'crate', name: 'Supply Crate', m: 'props/Supply_Crate', x, z, s: 1.0, c: 0.7, once: true, reach: 3.5,
      quest: 'dw_supplies', verb: 'Recover', gives: { item: 'Supply Crate' },
      text: 'You haul the crate out of the bracken. Still sealed.',
      idleText: 'A crate from the outpost stores, dropped in the bracken.' })),
    // Redberries on the creek bank, and a honeycake from the outpost stores —
    // a goblin's price for what he knows.
    ...[[-31.0, -24.0], [-37.0, -20.0], [-29.0, -22.0], [-40.0, -18.0]].map(([x, z], i) => ({
      id: 'redberry_' + i, tag: 'redberry', name: 'Redberry Bush', m: 'Red_Berry_Bush', x, z, s: 1.0, c: 0.6, reach: 3.2,
      verb: 'Pick', gives: { item: 'Redberry' }, respawn: 60,
      text: 'Sharp red berries, three or four to a handful.' })),
    { id: 'honeycake', tag: 'cake', name: 'Outpost Larder', m: 'props/Water_Barrel', x: 4.0, z: -4.0, s: 1.0, c: 0.6, once: true, reach: 3,
      quest: 'dw_pib', verb: 'Take a honeycake', gives: { item: 'Honeycake' },
      text: 'You take one honeycake from the larder. Tessa is counting, somewhere.',
      idleText: "The outpost larder. Tessa's, and she counts it." },
    // Rattlecap's signal fires on the ridge above the Wolf Den: three columns of
    // smoke that call the other camps in.
    ...[[57.0, 27.0], [67.0, 25.0], [62.0, 41.0]].map(([x, z], i) => ({
      id: 'signal_' + i, tag: 'signalfire', name: 'Goblin Signal Fire', m: 'props/Campfire', x, z, s: 1.2, c: 0.8, once: true, reach: 3.5,
      quest: 'dw_smoke', verb: 'Douse', doused: 'props/Unlit_Fire_Pit',
      text: 'You kick the fire apart and smother the smoke.',
      idleText: 'Green wood, banked to smoke rather than burn.' })),
    { id: 'banner', tag: 'banner', name: 'Dark Woods Outpost Banner', m: 'Goblin_Banner', x: 64.0, z: 34.0, s: 1.1, c: 0.5, once: true, reach: 3.5,
      quest: 'dw_rattlecap', verb: 'Take down', needDead: 'Chief Rattlecap',
      text: 'You cut the outpost banner down and fold it under your arm.',
      idleText: "The outpost's own banner, strung up as a goblin trophy." },
    // Fenwick's mushrooms: two worth picking, one that is not.
    ...[[-18.0, 20.0], [-12.0, 26.0], [-24.0, 16.0], [-8.0, 16.0], [-20.0, 30.0], [-14.0, 12.0]].map(([x, z], i) => ({
      id: 'browncap_' + i, tag: 'browncap', name: 'Browncaps', m: 'cave/Brown_Mushrooms', x, z, s: 2.2, c: 0, reach: 3,
      verb: 'Pick', gives: { item: 'Browncap' }, respawn: 60, text: 'Squat and brown. The safe one.' })),
    ...[[-22.0, 26.0], [-10.0, 22.0], [-27.0, 24.0], [-16.0, 32.0], [-6.0, 28.0], [-25.0, 12.0]].map(([x, z], i) => ({
      id: 'mooncap_' + i, tag: 'mooncap', name: 'Mooncaps', m: 'cave/Luminous_Mushrooms', x, z, s: 2.2, c: 0, reach: 3, light: 0x8ab4ff,
      verb: 'Pick', gives: { item: 'Mooncap' }, respawn: 60, text: 'Pale blue, and cold to the touch.' })),
    ...[[-15.0, 24.0], [-21.0, 22.0], [-11.0, 30.0]].map(([x, z], i) => ({
      id: 'rotcap_' + i, tag: 'rotcap', name: 'Rotcaps', m: 'Poison_Mushrooms', x, z, s: 1.4, c: 0, reach: 3,
      verb: 'Pick', gives: { item: 'Rotcap' }, respawn: 60, hurt: 6,
      text: 'The mushroom releases a foul green cloud. Wrong mushroom.' })),
    // Glowcaps: they grow in the shade of the old trees around the outpost and
    // come back in their own time, so the road can always be relit.
    ...[[-7.0, 2.0], [-11.0, -4.0], [-5.0, -14.0], [7.0, -14.0], [13.0, -6.0], [26.0, -10.0], [-15.0, 10.0], [3.0, 8.0], [21.0, -12.0], [-9.0, -18.0]]
      .map(([x, z], i) => ({ id: 'glowcap_' + i, tag: 'glowcap', name: 'Glowcaps', m: 'cave/Luminous_Mushrooms', x, z, s: 2.6, c: 0, reach: 3,
        verb: 'Gather', gives: { item: 'Glowcap' }, respawn: 45, light: 0x7fe8c8,
        text: 'The mushroom gives off a faint blue-green glow.' })),
  ],

  // Treasure chests reward exploring the optional landmarks. Loot scales with
  // how deep/dangerous the spot is. Positions are pre-scale like everything else.
  chests: [
    { id: 'watchtower', x: -80, z: 23,  gold: 70,  item: 'Leather Body' },        // old soldier's kit on Crow Hill
    { id: 'rotfen',     x: 98,  z: -22, gold: 110, item: 'Battered Iron Shield' }, // stash on the dry ground above Murkfen
    { id: 'wolfden',    x: 66,  z: 33,  gold: 160, item: 'Iron Sword' },           // goblin plunder at Briar Camp
    { id: 'stones',     x: 88,  z: -71, gold: 240, item: 'Crystal Heart' },        // the Guardian's hoard in Grimroot Thicket
  ],

  // Fishing spots, fished from the bank: the deep pool in the north-west, then
  // down Blackroot Creek as it runs east. Tier gates which fish lands.
  fishingSpots: [
    { id: 'fs_shr1', tier: 'Shrimp', x: -59, z: -38 },   // Ravenwater Pool, south bank
    { id: 'fs_shr2', tier: 'Shrimp', x: -30, z: -25 },   // the creek below the ford
    { id: 'fs_tro1', tier: 'Trout',  x: 14,  z: -14 },
    { id: 'fs_sal1', tier: 'Salmon', x: 33,  z: -4 },    // where the creek slows into the fen
  ],

  // Campfire cooking stations. Stand near one to cook raw meat/fish.
  campfires: [
    { id: 'cf_farm',    x: 0,  z: -91 },  // Hearthstead's yard fire (early cooking)
    { id: 'cf_camp',    x: -12, z: 54 },  // the Wayside Camp, above the Spider Den
    { id: 'cf_shrine',  x: 37, z: -75 },  // in the lee of the Fallen Chapel
    { id: 'cf_outpost', x: 1,  z: -6 },   // Witchlight Camp -- the warden's fire
  ],

  // No aggressive mob may spawn within this radius of `spawn` — the first
  // thing a new character meets is livestock, not a goblin.
  safeSpawnRadius: 30,

  // Mining pits: an open dirt scrape fenced off with a gap on the road side,
  // with a mix of ore seams spread out inside. `r` is the pit radius (zone
  // units, scaled with the zone); `veins` is how many of each seam; `inner`
  // keeps the middle clear (the goblin dig crew stands there). The pit sits at
  // the POI of the same key.
  mines: [
    { key: 'copperhollow', r: 9,  veins: { Copper: 4, Tin: 3, Iron: 1 } },
    { key: 'tinscrape',    r: 9,  veins: { Tin: 4, Copper: 3, Coal: 1 } },
    { key: 'ravine',       r: 12, inner: 3, veins: { Iron: 4, Tin: 2, Coal: 2, Silver: 1 } },
  ],

  // Surface ore, so mining can be started before the cave is survivable. The
  // richer seams are all underground.
  scatterSeed: 4412,
  // Two trees Witchlight Camp was built around rather than cleared: one out past
  // the stores, one up by the northern tents.
  trees: [
    { x: -0.62, z: -9.47, s: 1.05, r: 2.4 },
    { x: -0.41, z: -2.13, s: 0.88, r: 5.1 },
  ],
  // Ground the camps have worn through, part of the same dirt field as the
  // roads so it blends into them instead of sitting on top as a separate disc.
  dirt: [
    { x: 1, z: -6, r: 7.6, fr: 4.0 },     // Witchlight Camp floor, feathering into the grass
    { x: 1, z: -6, r: 2.4, fr: 1.4 },     // and a harder-trodden ring round the fire
    { x: 63, z: 35, r: 9.0, fr: 4.5 },    // Briar Camp, stamped flat by the war band
    { x: -14, z: 56, r: 5.0, fr: 3.0 },   // the Wayside Camp
    { x: 34, z: -78, r: 7.0, fr: 4.0 },   // the chapel's old floor, still bare
  ],
  // ---------------------------------------------------------------------
  // Witchlight Camp, placed rather than sprinkled. Offsets are from the camp
  // POI at (1, -6) and scale with the zone like everything else in this file;
  // the models themselves stay native metres.
  // ---------------------------------------------------------------------
  props: [
      // Four tents in an arc on the high side, each opening onto the fire.
      { s: 1.45, m: 'Small_Canvas_Tent', x: 2.99, z: -1.74, yaw: 3.58, c: 1.0 },
      { s: 1.45, m: 'Small_Canvas_Tent', x: 5.42, z: -4.39, yaw: 4.36, c: 1.0 },
      { s: 1.45, m: 'Small_Canvas_Tent', x: 5.26, z: -7.99, yaw: 5.15, c: 1.0 },
      { s: 1.45, m: 'Small_Canvas_Tent', x: 2.61, z: -10.42, yaw: 5.93, c: 1.0 },
      // A bedroll inside each tent, laid along it on the same bearing, head to
      // the back wall.
      { s: 1.25, m: 'Bedroll', x: 3.08, z: -1.55, yaw: 3.58 },
      { s: 1.25, m: 'Bedroll', x: 5.62, z: -4.32, yaw: 4.36 },
      { s: 1.25, m: 'Bedroll', x: 5.45, z: -8.08, yaw: 5.15 },
      { s: 1.25, m: 'Bedroll', x: 2.68, z: -10.62, yaw: 5.93 },
      // The fire: a pot over it and stools pulled up round it.
      { m: 'Cooking_Tripod', x: 1.0, z: -6.0, yaw: 0.00, c: 0.35 },
      { m: 'Camp_Stool', x: 1.71, z: -4.78, yaw: 3.67 },
      { m: 'Camp_Stool', x: 1.71, z: -7.22, yaw: 5.76 },
      { m: 'Camp_Stool', x: -0.41, z: -6.0, yaw: 1.57 },
      // Stores under the pavilion on the sheltered side, crates stacked against it.
      { s: 1.35, m: 'Supply_Pavilion', x: -3.15, z: -7.51, yaw: 1.22 },
      { m: 'Supply_Crate', x: -2.22, z: -8.17, yaw: 0.98, c: 0.5 },
      { m: 'Supply_Crate', x: -3.86, z: -8.37, yaw: 1.12, c: 0.5 },
      { m: 'Supply_Crate', x: -4.41, z: -7.15, yaw: 1.36, c: 0.5 },
      { m: 'Supply_Crate', x: -2.99, z: -6.28, yaw: 1.50, c: 0.5 },
      { m: 'Water_Barrel', x: -2.58, z: -9.23, yaw: 0.84, c: 0.4 },
      { m: 'Water_Barrel', x: -4.06, z: -5.82, yaw: 1.61, c: 0.4 },
      // A rough fence across the two open approaches, and a sign on the road.
      { m: 'Rough_Fence', x: -0.28, z: -13.24, yaw: 0.17, c: 0.8 },
      { m: 'Rough_Fence', x: -2.11, z: -12.66, yaw: 0.44, c: 0.8 },
      { m: 'Rough_Fence', x: -3.73, z: -11.63, yaw: 0.70, c: 0.8 },
      { m: 'Rough_Fence', x: -5.37, z: -2.32, yaw: 2.09, c: 0.8 },
      { m: 'Rough_Fence', x: -4.2, z: -0.8, yaw: 2.36, c: 0.8 },
      { m: 'Rough_Fence', x: -2.68, z: 0.37, yaw: 2.62, c: 0.8 },
      { m: 'Warning_Sign', x: 1.0, z: -13.53, yaw: 0.00, c: 0.25 },
  ],
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

    // (The Dark Woods Outpost is not scattered — it is laid out by hand in
    // `props` below. Scattering a camp gave nine bedrolls, nine lanterns,
    // three cooking pots and no tents at all: counts are multiplied by the
    // zone's area, and the rejection sampler drops whatever has a footprint
    // once the zero-radius clutter has filled the clearing.)

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
    // Murkfen -- standing water and the dead wood that grows out of it.
    { model: 'Pond_Reeds',      count: 16, r: 0,   scale: [1.1, 1.7], near: 'rotfen', nearR: 22 },
    { model: 'Meadow_Sedge',    count: 12, r: 0,   scale: [1.0, 1.5], near: 'rotfen', nearR: 22 },
    { model: 'Twisted_Dead_Tree', count: 6, r: 0.9, scale: [1.0, 1.4], near: 'rotfen', nearR: 20 },
    { model: 'Hollow_Stump',    count: 4, r: 0.8, scale: [1.0, 1.3], near: 'rotfen', nearR: 20 },
    { model: 'Dead_Bush',       count: 6, r: 0,   scale: [1.0, 1.3], near: 'rotfen', nearR: 20 },
    { model: 'Goblin_Hide_Tent', count: 1, r: 1.4, scale: [1.0, 1.1], near: 'rotfen', nearR: 12 },
    { model: 'Unlit_Fire_Pit',  count: 1, r: 0, scale: [1.0, 1.0], near: 'rotfen', nearR: 10 },

    // Ravenwater Pool -- a reedy, willow-hung shore.
    { model: 'Pond_Reeds',      count: 14, r: 0,   scale: [1.1, 1.6], near: 'ravenwater', nearR: 24 },
    { model: 'Weeping_Willow',  count: 3,  r: 1.2, scale: [1.0, 1.3], near: 'ravenwater', nearR: 26 },
    { model: 'Meadow_Sedge',    count: 10, r: 0,   scale: [1.0, 1.4], near: 'ravenwater', nearR: 24 },
    { model: 'Green_Fern',      count: 8,  r: 0,   scale: [1.0, 1.3], near: 'ravenwater', nearR: 22 },
    { model: 'Hollow_Stump',    count: 3,  r: 0.8, scale: [1.0, 1.2], near: 'ravenwater', nearR: 22 },

    // Wolfsnag Pass -- bare, wind-scoured ground between the cliffs, and the
    // signs somebody put up after the last people who came through.
    { model: 'Twisted_Dead_Tree', count: 5, r: 0.9, scale: [1.0, 1.4], near: 'wolfsnag', nearR: 18 },
    { model: 'Bone_Pile',       count: 3, r: 0,   scale: [1.0, 1.3], near: 'wolfsnag', nearR: 16 },
    { model: 'Warning_Sign',    count: 2, r: 0,   scale: [1.0, 1.0], near: 'wolfsnag', nearR: 14 },
    { model: 'Dark_Fern',       count: 8, r: 0,   scale: [1.0, 1.3], near: 'wolfsnag', nearR: 18 },
    { model: 'Exposed_Roots',   count: 4, r: 0,   scale: [1.0, 1.4], near: 'wolfsnag', nearR: 16 },

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

  // Spawn regions -- spread out and low-density (a farming zone, not a mosh pit).
  // Counts are per-group before the zone scale; regions are wide so mobs are not
  // packed together. Each hostile creature keeps to its own camp: a tight knot at
  // the centre ("core", small r) and a few that roam around it ("roamers": wider
  // r and a larger wander leash). No two kinds share a camp. `expect` is the
  // player level the area is tuned for (see tools/balance.mjs).
  spawns: [
    // --- Hearthstead, at the North Trail: livestock penned in the yard ---
    { type: 'chicken', count: 6, cx: -8,  cz: -83, r: 4, level: 1, expect: 1, hint: 'Chicken pen' },
    { type: 'cow',     count: 3, cx: -28, cz: -82, r: 5, level: 1, expect: 1, hint: 'Cow pen' },
    // --- Goblins on Blackroot Creek, downhill from the Old Hunter's Trail ---
    { type: 'goblin',  count: 4, cx: -34, cz: -22, r: 5,  level: 1, expect: 2, fixed: true, hint: 'Goblin camp (core)' },
    { type: 'goblin',  count: 4, cx: -34, cz: -22, r: 22, level: 2, expect: 2, roam: 26, fixed: true, hint: 'Goblin camp (roamers)' },
    // --- Scavengers picking over the drier hummocks of Murkfen ---
    { type: 'goblin_scavenger', count: 3, cx: 88, cz: 4, r: 5,  level: 2, expect: 2, fixed: true, hint: 'Murkfen scavengers (core)' },
    { type: 'goblin_scavenger', count: 3, cx: 88, cz: 4, r: 20, level: 2, expect: 3, roam: 24, fixed: true, hint: 'Murkfen scavengers (roamers)' },
    // --- Bandits in the woods between Crow Hill and the south road ---
    { type: 'bandit',  count: 4, cx: -40, cz: 34, r: 6,  level: 3, expect: 4, fixed: true, hint: 'Bandit hideout (core)' },
    { type: 'bandit',  count: 3, cx: -40, cz: 34, r: 20, level: 4, expect: 4, roam: 24, fixed: true, hint: 'Bandit hideout (roamers)' },
    // --- Goblin miners have jumped Dorn's claim in the Root-Choked Ravine ---
    { type: 'goblin_miner', count: 4, cx: -114, cz: -16, r: 6,  level: 4, expect: 5, fixed: true, hint: 'Ravine dig (core)' },
    { type: 'goblin_miner', count: 2, cx: -114, cz: -16, r: 16, level: 4, expect: 5, roam: 20, fixed: true, hint: 'Ravine dig (roamers)' },
    { type: 'goblin_shaman', count: 1, cx: -114, cz: -16, r: 7,  level: 4, expect: 5, fixed: true, hint: 'Ravine dig (shaman)' },
    // --- The goblin war camp at Briar Camp: warriors with archers behind them ---
    { type: 'goblin_warrior', count: 4, cx: 63, cz: 35, r: 6,  level: 4, expect: 5, fixed: true, hint: 'Briar Camp (core)' },
    { type: 'goblin_archer',  count: 3, cx: 67, cz: 39, r: 7,  level: 5, expect: 5, fixed: true, hint: 'Briar Camp (archers)' },
    { type: 'goblin_shaman',  count: 2, cx: 65, cz: 33, r: 5,  level: 5, expect: 6, fixed: true, hint: 'Briar Camp (shamans: heal the camp, interrupt them)' },
    { type: 'goblin_warrior', count: 2, cx: 63, cz: 35, r: 18, level: 4, expect: 5, roam: 22, fixed: true, hint: 'Briar Camp (roamers)' },
    { type: 'goblin_chief',   count: 2, cx: 63, cz: 35, r: 7,  level: 5, expect: 6, fixed: true, hint: "Briar Camp (Rattlecap's brutes)" },
    // The band that jumped the supply cart, still on the Grimroot spur with it.
    { type: 'goblin', count: 6, cx: 58, cz: -24, r: 10, level: 3, expect: 3, fixed: true, hint: 'Supply road raiders (Woodfang goblins)' },
    // --- Hill ogres squatting on the South Track approach ---
    { type: 'guard',   count: 3, cx: 38, cz: 84, r: 8,  level: 6, expect: 7, fixed: true, hint: 'Ogre hollow (core)' },
    { type: 'guard',   count: 1, cx: 38, cz: 84, r: 20, level: 5, expect: 6, roam: 24, fixed: true, hint: 'Ogre hollow (roamer)' },
  ],

  // Two low-level optional elites -- the zone's capstones, nothing harder.
  elites: [
    // The thing the cursed trees of Grimroot grew around.
    { type: 'guard', name: 'The Rootbound Guardian', cx: 91, cz: -68, level: 6, expect: 6 },
    // The chief who has been raiding the roads, in the middle of his own camp.
    { type: 'goblin_chief', name: 'Chief Rattlecap', cx: 63, cz: 35, level: 6, expect: 6 },
  ],

  farm: {
    // Hearthstead: a fenced farm village at the Entrance Clearing. The player
    // wakes up in the farmhouse. Positions are zone units (scaled ×1.7 at load);
    // house sizes / furniture offsets are world metres and are NOT scaled.
    fences: [
      // Village perimeter (north edge is tucked inside the mountain boundary).
      { x1: -54.0, z1: -103.0, x2: 10.0,  z2: -103.0 },   // north
      { x1: 10.0,  z1: -103.0, x2: 10.0,  z2: -73.0 },   // east
      { x1: -62.0, z1: -97.0, x2: -54.0, z2: -103.0 },   // north-west corner
      { x1: -62.0, z1: -97.0, x2: -62.0, z2: -73.0 },   // west
      { x1: -62.0, z1: -73.0, x2: -45.8, z2: -73.0 }, // south-west (up to the double gate)
      { x1: -42.2, z1: -73.0, x2: 10.0, z2: -73.0 },  // south-east (from the double gate)
      // Cow pen (west of the yard), set back from the houses — opening on its north side.
      { x1: -36.0, z1: -89.0, x2: -30.0, z2: -89.0 }, { x1: -26.0, z1: -89.0, x2: -20.0, z2: -89.0 },
      { x1: -36.0, z1: -89.0, x2: -36.0, z2: -75.0 }, { x1: -20.0, z1: -89.0, x2: -20.0, z2: -75.0 },
      { x1: -36.0, z1: -75.0, x2: -20.0,   z2: -75.0 },
      // Chicken pen (east of the yard), well clear of the Warden's hut — opening on its west side.
      { x1: -14.0,  z1: -89.0, x2: -3.0, z2: -89.0 }, { x1: -14.0, z1: -77.0, x2: -3.0, z2: -77.0 },
      { x1: -3.0, z1: -89.0, x2: -3.0, z2: -77.0 },
      { x1: -14.0,  z1: -89.0, x2: -14.0,  z2: -86.0 }, { x1: -14.0, z1: -82.0, x2: -14.0, z2: -77.0 },
    ],
    gate: { x: -44.0, z: -73.0, yaw: 0, double: true, seg: { x1: -45.8, z1: -73.0, x2: -42.2, z2: -73.0 } },
    // Footpaths from each doorstep to the road. Authored so they walk AROUND
    // the pens (never through a fence): the yard lane runs along z=-83 north of
    // both pens; the Warden's hut path skirts south of the chicken pen.
    // Doorsteps sit ~2.5m in FRONT of each front wall (walls: Bram -83.35,
    // Maggie -83.06, hut west wall x 23.35), the lane runs through the front
    // yard between the houses and the pens, and spurs lead into each pen's opening.
    trails: [
      [ { x: -2.0, z: -92.55 }, { x: -12.0, z: -92.4 }, { x: -22.0, z: -92.85 }, { x: -34.0, z: -91.9 }, { x: -45.0, z: -88.5 } ], // yard lane: Maggie's door -> Bram's door -> road
      [ { x: 1.85, z: -78.0 }, { x: 1.9, z: -83.0 }, { x: 1.0, z: -89.2 }, { x: -1.5, z: -92.3 } ],                 // Warden's hut door -> lane (east of the chicken pen)
      [ { x: -28.0, z: -87.8 }, { x: -28.0, z: -92.1 } ],                                                              // cow pen opening -> lane
      [ { x: -12.8, z: -84.0 }, { x: -15.8, z: -84.0 }, { x: -15.8, z: -90.5 }, { x: -14.5, z: -92.45 } ],                    // chicken pen opening -> lane
    ],
    // Enterable houses: axis-aligned, `door` is the side the doorway is on.
    // Furniture offsets (dx,dz) are metres from the house centre.
    houses: [
      { key: 'farmhouse', name: 'Farmhouse', x: -46.0, z: -95.0, w: 16, d: 12, h: 3.4, door: 'south', roof: 0x8a5a3a, wall: 0xd9cfb6,
        furn: [
          { k: 'bed',       dx: -5.2, dz: -3.6, yaw: 0 },     // the player's bed (west room)
          { k: 'chest',     dx: -6.8, dz: -0.2, yaw: 1.57 },
          { k: 'table',     dx: 3.2,  dz: -1.6, yaw: 0 },
          { k: 'stool',     dx: 3.2,  dz: 0.6,  yaw: 0 }, { k: 'stool', dx: 5.0, dz: -1.6, yaw: 0 },
          { k: 'hearth',    dx: 6.6,  dz: -4.4, yaw: 0 },
          { k: 'shelf',     dx: -1.0, dz: -5.0, yaw: 0 },
        ] },
      { key: 'maggie',    name: "Maggie's Cottage", x: -2.0, z: -97.0, w: 12, d: 10, h: 3.2, door: 'south', roof: 0x6f5a48, wall: 0xcdc3a8,
        furn: [ { k: 'bed', dx: -3.4, dz: -3.0, yaw: 0 }, { k: 'table', dx: 2.6, dz: -0.6, yaw: 0 }, { k: 'stool', dx: 2.6, dz: 1.4, yaw: 0 }, { k: 'hearth', dx: 4.6, dz: -3.6, yaw: 0 } ] },
      { key: 'bram',      name: "Bram's Cottage",   x: -22.0, z: -97.0, w: 11, d: 9,  h: 3.1, door: 'south', roof: 0x7a6248, wall: 0xd2c8ae,
        furn: [ { k: 'bed', dx: 3.0, dz: -2.6, yaw: 0 }, { k: 'chest', dx: -3.8, dz: -2.8, yaw: 0 }, { k: 'table', dx: -2.4, dz: 0.8, yaw: 0 }, { k: 'stool', dx: -0.6, dz: 0.8, yaw: 0 } ] },
      { key: 'guardhut',  name: "Warden's Hut",     x: 6.0, z: -78.0, w: 9,  d: 8,  h: 3.0, door: 'west',  roof: 0x5a5148, wall: 0xc9c2ae,
        furn: [ { k: 'bed', dx: 2.4, dz: -2.0, yaw: 0 }, { k: 'table', dx: -1.6, dz: 1.4, yaw: 0 }, { k: 'chest', dx: 2.6, dz: 2.2, yaw: 0 } ] },
    ],
    // A tilled field of crops west of the cow pen.
    field: { x: -55.0, z: -82.0, w: 22, d: 20, crops: ['Strawberry_Patch', 'Meadow_Sedge', 'Goldenrod_Patch'] },
    // Nature inside the fence: a few trees and bushes/flowers around the yard
    // (worldgen keeps the wild forest out of the farm, so these are placed by hand).
    trees: [
      { x: -32.0, z: -101.5, s: 1.0 }, { x: -12.0, z: -101.5, s: 1.05 }, { x: 7.5, z: -99.0, s: 0.95 },
      { x: -59.0, z: -90.0, s: 0.9 }, { x: 8.5, z: -86.0, s: 1.0 }, { x: -17.0, z: -74.6, s: 0.85 }, { x: -56.0, z: -74.2, s: 0.8 },
      { x: -22.0, z: -102.2, s: 0.8 }, { x: 2.0, z: -101.8, s: 0.9 }, { x: -50.0, z: -101.5, s: 0.85 }, { x: 13.0, z: -72.0, s: 0.85 },
      { x: -40.0, z: -74.6, s: 0.75 }, { x: -6.0, z: -74.6, s: 0.8 },
    ],
    plants: [
      { m: 'Rose_Bush',        x: -51.0,  z: -91.3, s: 1.0 }, { m: 'Rose_Bush',        x: -41.0,  z: -91.3, s: 1.0 },
      { m: 'Lavender_Clump',   x: -26.6, z: -94.3, s: 1.0 }, { m: 'Lavender_Clump',   x: -17.4,  z: -94.3, s: 1.0 },
      { m: 'Flowering_Bush',   x: -6.8, z: -94.0, s: 1.0 }, { m: 'Flowering_Bush',   x: 2.6, z: -94.0, s: 1.0 },
      { m: 'Wildflower_Patch', x: -28.0,   z: -99.5, s: 1.1 }, { m: 'Wildflower_Patch', x: -7.0,   z: -99.5, s: 1.1 },
      { m: 'Clover_Patch',     x: -40.0,  z: -99.0,   s: 1.2 }, { m: 'Clover_Patch',     x: 4.0,   z: -91.0,   s: 1.1 },
      { m: 'Berry_Bush',       x: 9.0,   z: -75.5, s: 0.9 }, { m: 'Round_Box_Bush',   x: 6.0,   z: -74.3, s: 0.8 },
      { m: 'Meadow_Shrub',     x: -60.0,  z: -97.0,   s: 1.0 }, { m: 'Poppy_Patch',      x: -53.0,  z: -74.2, s: 1.0 },
      { m: 'Hosta_Plant',      x: -38.0,  z: -91.6, s: 1.0 }, { m: 'Green_Fern',       x: 10.0,   z: -97.0,   s: 1.0 },
      { m: 'Strawberry_Patch', x: -53.0,  z: -91.4, s: 1.0 }, { m: 'Wildflower_Patch', x: -56.0,  z: -94.0,   s: 1.1 },
      { m: 'Normal_Bush',      x: -61.0,  z: -81.0,   s: 0.9 }, { m: 'Meadow_Shrub',     x: -61.0,  z: -75.0,   s: 0.9 },
      { m: 'Clover_Patch',     x: -18.5,  z: -100.5, s: 1.2 }, { m: 'Poppy_Patch',      x: -10.0,   z: -95.5, s: 1.0 },
      { m: 'Heather_Clump',    x: 8.0,   z: -93.5, s: 1.0 }, { m: 'Goldenrod_Patch',  x: 6.0,   z: -82.5, s: 0.9 },
      { m: 'Sage_Bush',        x: -17.2,  z: -77.0,   s: 0.9 }, { m: 'Creeping_Bellflowers', x: -26.0, z: -74.4, s: 1.0 },
      { m: 'Green_Fern',       x: -31.0,  z: -100.8, s: 1.0 }, { m: 'Lavender_Clump',   x: -5.0,   z: -101.4, s: 1.0 },
      { m: 'Round_Box_Bush',   x: -32.0,  z: -95.6, s: 0.8 }, { m: 'Berry_Bush',       x: -11.0,    z: -77.5, s: 0.85 },
    ],
    props: [
      // Chicken pen: coop, house, nests, feeders.
      { m: 'Walk_In_Chicken_House', x: -6.5, z: -86.0, yaw: 3.14, s: 1.0, c: 2.2 },
      { m: 'Raised_Chicken_Coop',   x: -10.0,  z: -79.5, yaw: 3.6, s: 1.0, c: 1.3 },
      { m: 'Nesting_Boxes',         x: -5.0,  z: -79.0, yaw: 4.0,  s: 1.0, c: 0.8 },
      { m: 'Chicken_Feeder',        x: -8.0,  z: -82.5, yaw: 0,  s: 1.0, c: 0.4 },
      { m: 'Chicken_Waterer',       x: -5.5, z: -82.0, yaw: 0,   s: 1.0, c: 0.4 },
      // Cow pen: troughs and hay.
      { m: 'Feeding_Trough',        x: -33.0, z: -79.0, yaw: 1.57, s: 1.0, c: 0.7 },
      { m: 'Water_Trough',          x: -23.0,  z: -78.0, yaw: 1.57, s: 1.0, c: 0.7 },
      { m: 'Round_Hay_Bale',        x: -33.0, z: -86.0, yaw: 0.5,  s: 1.0, c: 0.7 },
      // Yard clutter around the square and the houses.
      { m: 'Tall_Haystack',         x: -12.0,   z: -99.0, yaw: 0,    s: 1.0, c: 1.1 },
      { m: 'Stacked_Hay_Bales',     x: -9.0,  z: -96.0, yaw: 1.2,  s: 1.0, c: 0.9 },
      { m: 'Hay_Pile',              x: 7.0,  z: -91.0, yaw: 0,    s: 1.0, c: 0.7 },
      { m: 'Scarecrow',             x: -55.0, z: -82.0, yaw: 3.14, s: 1.0, c: 0.4 },
      { m: 'Grain_Barrel',          x: -37.0, z: -97.0, yaw: 0,    s: 1.0, c: 0.5 },
      { m: 'Grain_Sack',            x: -35.0, z: -98.0, yaw: 0.8,  s: 1.0, c: 0.0 },
      { m: 'Vegetable_Crate',       x: -39.0, z: -98.0, yaw: 0.3,  s: 1.0, c: 0.5 },
      { m: 'Wheelbarrow',           x: -32.0, z: -95.0, yaw: 2.2,  s: 1.0, c: 0.4 },
      { m: 'Farm_Handcart',         x: -16.0,   z: -95.0, yaw: 1.0,  s: 1.0, c: 0.6 },
      { m: 'Pitchfork',             x: -36.0, z: -85.0, yaw: 0.3,  s: 1.0, c: 0.0 },
      { m: 'Water_Barrel',          x: 6.0,  z: -75.0, yaw: 0,    s: 1.0, c: 0.5 },
    ],
  },

  // No environmental hazards — the poison damage areas (and their green circles)
  // were removed.
  hazards: [],
};
