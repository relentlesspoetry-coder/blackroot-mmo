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

  // Cave spiders; deeper = higher level.
  spawns: [
    { type: 'spider', count: 4, cx: -30, cz: -8, r: 12, level: 4, expect: 5, hint: 'Echo Pool' },
    { type: 'spider', count: 4, cx: 34,  cz: -10, r: 10, level: 5, expect: 6, hint: "Smuggler's Niche" },
    { type: 'spider', count: 5, cx: -30, cz: 40, r: 12, level: 6, expect: 7, hint: 'Crystal Hollow' },
    { type: 'spider', count: 4, cx: 6,   cz: 42, r: 12, level: 6, expect: 7, hint: 'Deep Chamber' },
  ],

  // Spiders are squishy, so the Broodmother carries her own multipliers rather
  // than the generic elite ones — otherwise she dies faster than a Hill Ogre.
  elites: [
    { type: 'spider', name: 'The Broodmother', cx: 6, cz: 52, level: 9, expect: 9, hpMult: 3.6, dmgMult: 1.9 },
  ],

  portals: [
    { x: 0, z: -58, r: 5, to: 'darkwoods', spawn: { x: -54, z: 52, yaw: 1.2 } },
  ],
};
