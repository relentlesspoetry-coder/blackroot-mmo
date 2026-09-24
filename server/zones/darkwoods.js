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
  // Raised from 120: with clearings and groves the count is a budget spread
  // unevenly, so the dense stands need headroom to actually read as dense.
  treeCount: 240, // scaled up with the zone at load


  // A low-level farming zone: mobs respawn quickly so grinding stays smooth.
  respawnMult: 0.4,

  // Axis-aligned bounds (used for spawn sampling / grid sizing).
  // 270 x 210 zone units = 459 x 357 metres once scaled: the blueprint's
  // 1.7:1.3 proportion, at a density the forest and the framerate can carry.
  bounds: { minX: -135, maxX: 135, minZ: -113.2, maxZ: 113.2 },

  // The zone outline, traced from the same drawing: the edge of the land
  // mask, so the boundary wall stands exactly where the blueprint ends.
  boundary: [
    { x: 136.3, z: -0.4 }, { x: 134.9, z: 13.6 }, { x: 136.5, z: 28.2 }, { x: 128.7, z: 40.8 },
    { x: 121.2, z: 52.8 }, { x: 112.1, z: 63.4 }, { x: 108.4, z: 76.8 }, { x: 95.6, z: 84 },
    { x: 85.2, z: 92.1 }, { x: 73.3, z: 97.8 }, { x: 69.6, z: 114.6 }, { x: 47.7, z: 102.4 },
    { x: 37.3, z: 107.3 }, { x: 27.2, z: 113.3 }, { x: 15, z: 111.7 }, { x: 3.5, z: 108.8 },
    { x: -7.3, z: 108.6 }, { x: -18, z: 108.8 }, { x: -29.3, z: 110.2 }, { x: -42.2, z: 114.7 },
    { x: -53.6, z: 111.4 }, { x: -66.4, z: 110.3 }, { x: -83.3, z: 113.3 }, { x: -94, z: 105.3 },
    { x: -106.1, z: 98.4 }, { x: -120, z: 92.1 }, { x: -132.2, z: 83.1 }, { x: -136.5, z: 68.7 },
    { x: -136.4, z: 53.1 }, { x: -136.7, z: 38.8 }, { x: -136.3, z: 25.2 }, { x: -136.7, z: 12.3 },
    { x: -133.6, z: -0.4 }, { x: -136.7, z: -13.2 }, { x: -131.9, z: -25.2 }, { x: -136.7, z: -39.7 },
    { x: -130.2, z: -51.3 }, { x: -135.8, z: -69.2 }, { x: -126, z: -79.8 }, { x: -110.7, z: -85.3 },
    { x: -98.7, z: -91.9 }, { x: -85, z: -95.2 }, { x: -73.3, z: -99.2 }, { x: -61.1, z: -101.2 },
    { x: -50.4, z: -104.6 }, { x: -40.9, z: -111.2 }, { x: -30, z: -114.7 }, { x: -18.5, z: -114.9 },
    { x: -7.3, z: -110.2 }, { x: 3.6, z: -110.4 }, { x: 13.7, z: -105.9 }, { x: 25.5, z: -108.4 },
    { x: 38.2, z: -110.2 }, { x: 52.3, z: -111.8 }, { x: 65.8, z: -109.8 }, { x: 79.1, z: -105.6 },
    { x: 93.2, z: -100.9 }, { x: 103.1, z: -91 }, { x: 117.1, z: -83.5 }, { x: 124.6, z: -70.9 },
    { x: 122.6, z: -54.2 }, { x: 109.3, z: -35.8 }, { x: 109.3, z: -23.6 }, { x: 128.9, z: -13.8 },
  ],

  // ------------------------------------------------------------------
  // TERRAIN, traced from the Dark Woods Zone Layout Blueprint by
  // tools/trace_blueprint.py: the drawing read pixel by pixel and classified
  // by colour, rather than approximated by hand in circles and lines.
  //
  // One character per 1.5-unit cell, origin (minX, minZ), row 0 is north:
  //   ' ' off the map   'W' deep water   'w' shallow marsh   'R' rock
  //   'F' dense forest  'f' ordinary wood  '.' open ground
  // ------------------------------------------------------------------
  terrain: {
    cell: 1.5, w: 180, h: 151, minX: -135.0, minZ: -113.2,
    rows: [
      'RRRRRRRRRRRRRRRR                                               RRRRRRRRRRRRRRRRRRR                                                                                                  ',
      'RRRRRRRRRRRRRRRRR                                             .RRRRRRRRRRRRRRRRRRR.                                  ........                                                       ',
      'RRRRRRRRRRRRRRRRR                                             .RRR.RRRRRRRRRRRRRRR...RRRRRRR.               .RRRRRRRRRRRRRRRRRRRR....                                               ',
      'RRRRRRRRRRRRRRRRR                                             .RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR           ..RRRRRRRRRRRRRRRRRRRRRR..RRRRRR.                                          ',
      'RRRRRRRRRRRRRRRRR                                            ..RRRRRRR....RRRRRRRRRRRR......RRR        .RRRR.....RR......ff.........RRRRRRR.                                        ',
      'RRRRRRRRRRRRRRRRR                                       RRRRRRRRRRRRRRRRRRRRRRRRRRR..f.......RRRRRRRRRRRRR......f....fFFFFFFFF..........RRRRR.                                      ',
      'RRRRRRRRRRRRRRRR                                      RRRRRRRRR................RR..fFFFffFFf...RRRRRRRR.........FFFFFFFFFFFFFFFf..fFFFfff..RRRR..                                   ',
      'RRRRRRRRRRRRRR.                                     .RRRR...RR.................fFFFFFFFFFFFFf...............ff...fFFFFFFFFFFFFFFFFFFFFFFFF...RRRRRR..                               ',
      'RRRRRRRRRRRRRR                                 ..RRRRRR........................FFFFFFFFF.fFFFF.........fFFFFFFF...FFFFff.....ffFFFFFFFFFFFFf...RRRRRRRRR..                          ',
      'RRRRRRRRRRRRR                            ....RRRRRRR....fFf...................fFFFFFFFFF.fFF......f...fFFFFFFFFf..FFFf..........fFFFFFFFFFFF..f.....RRRRRRR                         ',
      'RRRRRRRRRRRR.                        .RRRRRRRRRR.........FF....................ffffFFFFFffFf.....fFf.fFFFFFFFFFf..ff..............FFFFFFFFFFFFFFFf.......RRR                        ',
      '  ..........                     ..RRRRRRRRRRR...........fF........................fFFFFF.f.......f.fFFFFFFFFFFf......................FFFFFFFFFFFFf..ff....RR                       ',
      '  ...........              ..RRRRRRRRR......ffFff........fF.........................FFFFf...........FFFFFffFFFF.......................FFFFFFFFFFFFf.FFFFf..RR                       ',
      '  ...........            RRRRRRRRR.....fffFFFFFFFF....................fFFf...........Fff............FFFFF.fFFFF..........................fFFFFFFFFFFFFFFFF.RR.                      ',
      '  ...........          RRRRRR........FFFFFFFFFFFFFf..................fFFFF......f.........ff.......FFFFFFFFFFFf.....f....f..FFf...........fFFFFFFFFFFFFFFFfRRR                      ',
      '                     .RRRR.....fFf..FFFFFFFFFFFFFFF....ff......w.....FFFFFFFF..FF.........ff.......FFFFFfFFFF......FFf..fFFFFF.............fffFFFFFF...FFFF.RR.                     ',
      '                   .RRR....FFFFFFFFFFFFFFFFFFFFFFFFf...FF..Ff..w....fFFFFFFFFFFFF...................ff....FFf.......f...FFF......................fF....FFFFf.RRR.                   ',
      '                  .RRR...FFFFFFFFFFFF.FFFFFf....fff....FFFFFF....ff..FFFFFFFFFFFf.......................................ff........fFf..................FFFFF..RRRR.                 ',
      '                .RRR...fFFFFFFFFFFFFFf................FFFFFFFF...fF..fFFFFF.FFFF......Ff......................fFf.................FFF..................FFFFFf..RRRRR.               ',
      '           ..RRRRRR..fFFFFFFFFFFFFFFFFf...............ffFFFFFFFf.W....Ff......................................FFFf.........FFf..FFFFFff..ff............fFFFFFFf...RRRR.             ',
      '         .RRRRRRR..fFFFFFFFFFFFFFFFFFFF...............f.FFFFFFFF.WW............................................FFf.........FFFffFFFFFFF.fFFf....fFf.....ffFFFFFFF...RRRR            ',
      '        RRRRRR....fFFFFffFf.ff.fFFFFFFF..............FFFFFffFFFFFWW......................................................fFFFFFFFFFFFFFfFFF.....FFFF.........FFFFFfF..RRR           ',
      '      .RRR..ff.ffFFFFf.........fFFFFFFf...f..........FFFFF..FFFFF.W.....................................................FFFFFFFFFFFFFFFFFFf.....FFFFf.........fFFFFFF..RRR          ',
      '     .RR..fFFFFFFFfff........WW.FF.......FFF.........fFFFf..FFFF............f..............F...........................FFFF.FFFFFFFFFFFFFF......fFf............fFFFFFf..RR.         ',
      '    .RR...FFFFFFFf......WW..WWW.Ff......FFFFffFf............FFFF............F..............F......................f....Fff..FFFFFFFFFFFFff..............fff......fff.....RR         ',
      '   RRR...FFFFFFFF...WWWWWWW.WWWfFf......FFFFFFFf....f.......FFFF..................fF..............................F.......fFFFFFFFFFFFf................FFFFFF............RR.        ',
      '  .RR.fFFFFFFFFF...WWWWWWWWWWW.FFf.......FFFFFf.....FF......FFF.................ff........................................FFFFFfFFFf.......fFF.........FFFFFFFff..........RR        ',
      ' .RR.fFFFFFFFFFf...WWWWWWWWWWW.f.........fFFF......fFF.....fFF..................ff......................................fFFFFF..FFF........FFFF.......fFFFFFFFFFFFFF......RR        ',
      ' RR..FFFFFFFFf....WWWWWWWWWWWWW...fFf.............fFFFF....fFF....................................................fF...fFFFFF...FFF.......fFFFFF......FFFFFFFFFFFFFFf.....RR        ',
      '.RR.fFFFFFFFf....WWWWWWWWWWWWWW...............WWW.FFFFFf.W..FF............fFF..................................fFFFF...fFF......fFFf.....fFFFFFF......FFFFFFFF.fFFFFF.....RR        ',
      '.RR.FFFFFF.....WWWWWWWWWWWWWWWWWWWWWW..WWWWWWWWWW.fFFFF..WW.ff...........fFFf.................................fFFFFF...FFF....fFFFFf.....fFFFFFFF....FFFFFFFF..FFFFFF.....RR        ',
      'RR..FFFFF....WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW...f...WW.............fFFFf.............RRRRRRRR............FFFFFf...FFF..fFFFFFFF.......ffFFFF..fFFFFFFFFFFFFFFFFF....RRR        ',
      'RRRfFFFFf....WWWWWWWWFfWWWWWWWWWWWWWWWWWW..WWWWWWWWWWWWWWWW............FFFFF.............RRRRRRRRRRRRR.......fFFFf.....FFFFFFFFFFFFFFF........fffFFFFFFFFFFFFFFFFFFFF....RR.        ',
      'RRRFFFFf....WWWW.WWWWF.WWWWWWWWWWWWWWWW.....WWWWWWWWWWWWWWW............FFFFF.............RRRRRRRRRRRRRR......FFF.......FFFFFFFFFFFFFFFf....fF....FFFFFFFFFFFFFFFFFFFF...RRR         ',
      '.RRfFFFf.....WW...WW.F..WWWWWWWWWWWWWW......WWWWWWWWWWWWWWW............fFFFFf............RRRRRRRRRRRRRRR.....ff.......fFFFFFF...FFFFFFFf..fff.....RRRRRRRRRRR.FFFFFFf...RR.         ',
      ' RR.fFFf.......ff...fF...fF.WWWWWWWWWWWW...WWWWWWWWWWWWWWWW..............fFFFFF...........RRRRRRRRRRRRR..............fFFFFFF....FFFFFFFF....RRRRRRRRRRRRRRRRRRRFFFFFf...RR          ',
      ' .RR.FFF.......Ff....Ff...f.WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.....WW........FFF..fFf......RRRRRRRRRRRRR...............fffff.....FFFFFFFFf...RRRRRRRRRRRRRRRRRRRfFFFF....RR.         ',
      '  RRRfFFFf.....f...WW.....WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW...WWW............FFFFf......RRRRRRRRRRRR........................fFFFFFFFFf...RRRRRRRRRRRRRRRRRRRfFFFF....RR.         ',
      '  .RR.fFFFFF.WWW...WWWWWWWWWWWWWwwwWwwwwwWwwwwwwWWWWWWWWWWWWWWW.WWWWW...........fFFFF........RRRRR.............................FFFFFFFFFF...RRRRRRRRRRRRRRRRRRRfFFFF....RRR         ',
      '   RR..FFFFFfWWWWW....WWWWWWWWWwwwwwwwwwwwwwwwwwwWWWWWWWWWWWW....WWWW....fFF......FFF..........................................fff.FFFFFFf..RRRRRRRRRRRRRRRRRRRFFFFF....RRR         ',
      '   RR.fFFFFF.WWWWW.....WWWWWWWwww..............wwwwWWWWWWWWWW.....WWW....FFF......FFf...................f...........................FFFFFfFRRRRRRRRRRRRRRRRRRR.FFFFF....RRR         ',
      '  .RR.fFFF....WWWWWW...WWWWWWww..................wwwwWWWWWWW.......WWW..fFf.......FF..................fFFF..................FF.......fFFffFRRRRRRRRRRRRRRRRRRRfFFFFf....RR.         ',
      '  .RR..FFF.f...WWWWWWWWWWWWWwwww....wwwwwwwwwww...wwwWWWWWW........WWWW.....FF...fFF................fFFFFf..................FF.......fFF..f.RRRRRRRRRRRRRRRRRRFFFFf.....RR.         ',
      ' .RR.....fFFF....WWWWWWWWWWWWwwwwwwwwwwwwwwwwwwwwwwwWWWWWW..........wWWww...FFf..fFFF.............FFFfff...................fFF........Ff.fFf.RRRRRRRRRRRRRRRffFFF.......RR          ',
      ' RR......FFFFF.....WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW.............wwwWWWff....FFFF...........FFf.............fF.fFf...fFFFf.........fFFFFF..FFFFFFFFFFFFFFff.......RRR          ',
      'RRR..fFFFFFFFFFFF........WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW................WWW......fFFFf.......FFFF...........fFFFFFfFFFfFFFFFFfFFf...fFfFFffFFf.FFFFFFFFFffFFf.........RR.          ',
      'RR..FFFFFFFFFFFFf.........WWWWWWWWWWWWWWWWWWWW.WWWWWWWWWF......w..........WW........ff..ff...FFFF...........fFFFFFFFFFFFFFFFFf.FFf...FFFFf..FFFFFFFFFFf............fF.RRR           ',
      'RRfFF.f..fff........Ff...FFFFWWWWWWWWWWWWWWWWW..WWWWWWWfF.WW...w........................FFFFFFFFF...........FFFFFFFFFFFFFFFFF..FF.....f.....fFFFFFFFF..............FfRRR            ',
      'RRfFFf.............FFF..FFFFFFFF...WWWWFFWWWWWWWWWWWWWWFF.....................................fFF......fFFFFFFFFFFffFFFFFFFFF.fFf............fFFFFFF............fF...RR             ',
      'RRFFFF.............FFF...fFFFFFF.......FF..WWWWWWWWWW.fFF..........fFF.........................fF......fFFFFFFFFFf..FFFFFFFFf.ff..............FFFFF......fFFfFffFf                  ',
      'RRRFFF........f...FFFf.....f..FF......fFF............fFFF.........FFFFF.......WW.......................fFFFFFFFFFf...FFFFFFF...................FFf.......fFFFFFFF.                  ',
      'RRRfFF......fFFFFFFFF.........fFffff.FFFF.........f.f......ff.....fFFFF.......WWW.....fF...............fFFFfFFFFFF...FFFFFFFf.......f..........FFff.........fFFf..                  ',
      ' RRRFFF....fFFFFFFFFF.........fFFFFFFFFFF........FFFF......FF...............f.WWWW...fFFf.ffff..........fFF.fFFFFFf.FFFFFFFFF.......F.........FFFFFF..............                  ',
      ' .RRfFFf...FFFFffffFf........fFFFFFFFFFFF.....fFFFFFF.....fFF..................WWWW..FFFFFFFFFF..........fFFFFFFFFFFFFFFFFFFFf......F.........FFFFFF..............                  ',
      '  RRRFFFF..fFf................Ff..ff.fFFf..fFFFFF.fFFFF....FF...................WWWWWWfffFFFFFF.........fFFFFFFFFFFFFFFFFFff..................fFFFFF..............                  ',
      '  .RRfFFF.............................f...FFFFFFf..FFFFf...fF....................WWWWWWWWW.fff.........fFFFFFFFFFFFFFFFFF.................fFf..FFFFf..............                  ',
      '  .RR.FFF...FF.....RR.................ff..fffFFf...FFFF.....f.....fFFf..........FF.WWWWWWWW............fFFFFFFf......fFF..................fFf.fFFFf.......ff......                  ',
      '  .RR.FFf.FFFFF.ff.RRRR...........................FFFFf.........ffFFFF...f.......f....WWWWWW...........FFFFFf..................................ff......fFFFFFf....                  ',
      '  .RRfFFFFFFFFFFFF..RRR...........................fFFF.........fFFFFFFffFFf...........fFWWWWW..........FFFFf...........................................FFFFFFF....                  ',
      '  RR.FFFFFffFFFfFFf.RRRR..............................ff.......FFFFFFFFFFF............FFFWWWW..........FFF.................ff.........................fFFFFFFFf...                  ',
      ' .RR.FFFF..........RRRRRR...............RRR...F.....FFFFf.....fFFFFFFFFFFFFF..........fFF..W.....WW..............Ff.......FFFF.........................fFFFFFFF...                  ',
      ' .RR..ff............R..RRRRR..........RRRRRR.fF....fFFFFF.......fFFF.fFFFFFf....................WWWW...........fFFFF....fFFFFf...........................ffFFFFF..                  ',
      ' RR.................fF..RRRRR......RRRRRRRRRRfF.....fFFFF..............ffFf.....................WWWWW........fFFFFFFFf.FF...........Ff.......................fFFF.                  ',
      '.RR....fFf..........FFf..RRRR.....RRRRRRRRRR.fFf........f.........................................WWW........FFFFFFFFf.f............f........fff...............fFf                  ',
      'RR..fFFFF..........fFFF..RRRR.....RRR.RRRRRR.FFF..............................................................f.fFFf........................fFFFf................f                  ',
      'RR..FFFF...........fFFf.RRRRRRRRRRRRRRRRRRRR.fFf.........................................................WWW.................................FFF..................fFFFFFFFf..R.     ',
      'R..FFFF................RRRRRRRRRRRRRRRRRRRRRR.f..........................................................WWWW...............ww.......................................ffFFFFf.RR     ',
      'R..FFFF................RRRRRRRRRRRRRRRRRRRRRR...f.........f...............................................WWWW..............www......................ww....ww...........fFFF..R.    ',
      'R..FFFF..Ff............RRRRRRRRRRRRRRRRRRRRRR..FFFf.....FFFf..ff...........................................WWWW.....WWW.....wwWW....................www....wwww..........FFF..RR    ',
      'RR.FFFFFFFF............RRRRRRRRRRRRRRRRRRRRR...fFFFf...FFFFF..FFF.......................................f...WWWw...WWWWW......WWW...WWWW...........wwwww...wwwww..............RRR   ',
      'RRR.FFFFFFF.............RRRRRRRRRRRRRRRRRRR.....FFFFf..FFFFFfFFFF.....................................fFFf.....w....WWWW......WW....WWWWWWW...WWWWWWwwww.....www...............RR.  ',
      '.RRR.FFFFFFF.............RRRRRRRRRRRRRRRRRR.....fFFFFf....FFFFF.......................................FFFF..........WWWWW.....WW.....WWWWWWWWWWWWWWWwwww.....................f.RRR  ',
      ' .RRR.FFFFFFF............RRRRRRRRRRRRRRRRR........FFFF....fFFFF......................................fFFFFf..........WWWWWWWWwWW......WWWWWWWWWWWW......w.........WW.........F..RRR ',
      ' ..RRR.FFFFFFF............RRRRRRRRRRRR....fFFf....fFFFff..FFFFFf......................................fFFFF..........WWWWWWW..www........WWWWWWWWwwwwwwwwww.......WWWww..........RRR',
      ' R..RR.FFFFFFF.............RRRRRRRRR...FFFFFFFF...F...FFfff.fFFf.......................................fFFF..fF...........................WWWWWWwwwwwwwwwwwwww.......ww........fFRRR',
      'RRR.RR..fFFFFf....f.........RRRRRRR...FFFFFFFFFFfFFf...f.....fF...................RRRRRRRRRRRRRR........FFF..FF............................WWWWWwww..wwwwwwwwwWWW...www.........f.RR',
      'RRR.RR....ff.....fFf............RRRR..FFFFFFFFFFFff..............................RRRRRRRRRRRRRRRR.......fFF..f...................WWW........WWWwww.........wwwWWWWW.www...........RR',
      'RRRRRR............................RRR..FFFFFFFFf................................RRRRRRRRRRRRRRRRRR.......FF.............fF..WW..WWWW.........Wwww...........wwWWWWW.ww............RR',
      'RRRRRR...........................................................................RRRRRRRRRRRRRRRR........ff.......wWWWW.ff.WWWWWWWW...W......wwww...........wwwWWW..w...........F.RR',
      'RRRRRR...............................................................................RRRRRRRR.....................wWWWWW...WWWWWWWww..W......wwwwwwww.......wwwWW...............fRRR',
      'RRRRR.....f..........f..ff..........................................................................f................WWW...WWWwWwwww.ww.......wwwwwwwwww...wwwww.......fF........RRR',
      'RRRRR....FFFf.......fFf.FF....F..................ff....f............................................F.................WWWWWWWwwwwww..wwwWW....wwwwwwwwww...wwww........fF........RR.',
      'RRR....fFFFFFFFFFf.fFFFFFF...fFf..WW............FFFF..FFf........................................FFFF..............ff.WWWWWWWWwwww....wwWW........W........ww...................RR. ',
      'RR....fFFFFFFFFFFF.FFFFFf.....Ff..WWW..Ff.....fFFFFFFFfFffFff....................................FFFF.............WW...WWWWWWWww......wwW.................www...................RR. ',
      '.....FFFFFFFFFFFFF.fFFFf..........WWW..FF.....fFFFfFFF...FFFFF.....................................f..............WW...WWWW.........WW.ww..W....ww......wwwww...................RR. ',
      '..fFFFFFFFFFFFFFFf................WWw...f......Ff...FF..FFFFFFFf.....................................................ff.WWWW......WWWWW...WWW...ww......wwww...w.................R. ',
      'FFFFFFFFFFFFFFFFF.................wwww.........FF.......FFFFFFFF.f......................ff...........................FF.WWWWWWWWWWWWWWWWWWWWW....WWWWWWWWWW...www................RR ',
      'FFFFFFFFFFFFFFFFFFf................www........FFFf......fFFFFFFfFFFffff...............FFFF....................wW.....ff.WWWWWWWWWWWWWWWWWWW........WWW..WWWWWwwwww...............RR.',
      'FFFFFFFFFFFFFFFFFFF....................FFF...fFFFF..f.....f.fFf.FFFFFFFF...........fFFFFFFF......................WWWWWWWWWWWWWWWWWWWWWWWWWW................wwwwwwww............f.RRR',
      'FFFFFFFFFFFFFFFFFFFF...................fFFFffFFFFFFFFF..........fFFFFFFFf......f..FFFFFFFFF.....f...FF............WWWWWWW........W...WWWWWW................wwwwwwww............Ff.RR',
      'FfFFFFFFFfffFf..FFFF......................fFFFFFFFFFFF...........FFFFFFF.....fFFfFFFFFFFFFF...fFFF.fFF.............WWW.........f.......WWWWW....................www.........fFFFf.RR',
      'FFFFFFf.........fFFf........................FFFFFFFFFFFF.WWW.....FFFFFf.....FFFFFFFFFFFFFFf.FFFFFFFFFFf................fFFFf............WWWW...............................fFFFFf.RR',
      'FFFFf........................................fFFFFFFFFFFF.WWWWW...fFFf......FFFFFFFFFFFFFf..ffFFFFFFFFF...f............FFFf..............WWWWW.....WWWWWWWWWW..............fFFFFf.RR',
      'FFF............................fF..............FFFFFFFFFF...WWW................FFFFFFFFFFf....fFFFFFFf....Fff..........ff.................WWWW......WWWWWWWWWW..............fFFFfRRR',
      'FFf....................Ff......FFf...............FFFFFFFFf...WW.w.................FFFFFFFf....FFFFFFF......fFf.................Ff...........WW.......WWWWWWWW.................fFfRR.',
      'FF....................fFf......fF.................fFFFFFFFf....www..f......f.......fFFf.......FFFFFFF...FFfFFFf..............fFFFFf..................WWWWWWWWW.......WWWWWWww..FfRR.',
      'f.....f............ff..f.......FF...................fffFFFFf...www.fFF.....F..................fFFFFFF...FFFFFFF............FFFFFFFFF................WWWWWWWWWW......WWWWWWWww...RRR ',
      '....fFF...........FFFf.........FF......................FFFFF...wwW.fFf....fF................FF.fFfff....FFFFFFF............fFFFFFFFFFf...............WWWWWWWWW..................RR. ',
      'FFFFFFF..........fFFFf.........FF......................fFFFF....wWw.......FF........FF....fFFF........fFFFFFf..................FFFFFFFFf.................ff....................RR.  ',
      'FFFFFFFf.........FFFF......f..fFF.......................FFff....www................fFFF...FFFF........FFFFFf....................fFFFFFFF...............fFFF....f..............RRR   ',
      'FFFFFFFF......ffFFFFf.....FFFFFFf.......................fF..f................f.....FFFFffFFFFFFFF..ff.fFFFf.......................fFFFFFf............fFFFFFF..FFFFFFFF....F...RR    ',
      'FFFFFFFF.....FFFFFFf.....fFFFff.........................fFFFF...............fFf...fFFFFFFFFFFFfFF..f........................fF.....fFFFFFfff.........fFFFFFFFFFFFFFFFFF.....RR.     ',
      'FFFFf.FF..fFFFFFff.......fFf.............................FFFF.........www...FFf...fFFFFFFFFFFf.f.....................................FFFffFFf.........FFFFFFFFFFFFFFFFFFf..RRR      ',
      'FFFF..f...FFFFFf..........f.........................f......Ff........WWWW...FFF...fFffFFFFFFFf......F.....................................fFF..........fFFFFFFFFFFFFFFFFF..RR       ',
      'FFFF......FFFf......................................F................WWWWw..FF....FF...ffFFFFFf.....f...........................................fF.......FFFFFf..FFFFFFFF..R.       ',
      'FFFFf.....fFF.....f...ff............................f..............f..Wwwww.......Ff.........FF....f........fF..................................fFF........ffF...fFFFFFFf.RR        ',
      'FFFFF.....fFF....FFFffFF.........................................fFFF..wwww..................fFFffFFf........f..FF...............................fFFf.............fFFFFf..RR        ',
      'FFFFf......f....FFFFFFFF....................................ff.fFFFFf...wwww...WW......F.....FFFFFFFF...........FFF................................FFf.............FFFF..RR.        ',
      'FFFFf..........fFFFFFFFf....................................fFFFFFFF......w..F.WWWW...fFf....FFFFFFf.............ff.................................FF.............fFF..RR.         ',
      'FFFF..........fFFFFF.........................................FFFFFFf...FF...FFf.WW....WFF....fFFFFF..................................................F.....f...........RRR          ',
      'FFFF...........FFFFf.........................................fFFFFf....FFFFfFF.......WWFF.....fffFf.......................................................FFf..........RR           ',
      'FFFF............FFFf...........................................FFFf.fffFFFFF.....f.....FWWW..........FFF.................................................FFFf..f......RR            ',
      'FFFFFff..........fFF..........................f.................fff....FFFFF...........FfWW.........FFFFf............FF.................................FFFFFFFFF....RR             ',
      'FFFFFFFf..........ff......................ff.FF.........................fFF......FFf.....WW........FFFFFf............FFf...............................fFfFFFFFFFf..RR.             ',
      'FFFFFFFf..FFFf...................F...fFf.FFF..................................fFFFFFf....wwww.....FFFFFF..............................................fFFFFFFFF....RR.              ',
      'FFFFFFFf.fFFFF..................fFf.fFFFFff....................................fFFFFf....wwww....FFFfFFF......fFF....................................fFFFFFFFFf...RR.               ',
      'FFFFFFF..fFFFF..................FFF..Ff.............................fFf..........FFFFFf...WW.....FF...f......FFFFF................................fFFFFFFFFFFFf...RR                ',
      'FFFFFFFf.FFFFFf.....f...........FFFf.........................FFFFF.fFFFf...........fFFF..WWWW...............fFF.FF..............................fFFFFFFFFFFFFFF...RR                ',
      'FFFFFFFFFFFFFF......f....ff.....FFF.........................fFFFF..fFFFFf...........fFFf.WWWW..............fFFF.FFFfFFf.........................FFF.fFFFfFFFFFF...RR                ',
      'fFFFFFFFFFFFF...........FFFF...FFFF....................fFFFfFFFFf...FFFFF...Fffff....fff..wWw..............fFFF.FFFFFFF.........................FFf..FFf.FFFFFf...RR                ',
      'fFFFFFFFFFFFfff........fFFFFffFFFFFfff................fFFFFFFFFF....FFFFF..FFFFFFf........wwww...............f...fFFFF........ff................FFf..FFFfFFFFFf...R.                ',
      '.FFFFFFFFff..FFF.......fFFFFFFFFFFFFFFF...............fFFFFFFFFf......fFF..fffFFFf...........w.....................fF.....ff.fFF.................f..fFFFFFFFFFF..RR.                ',
      '.FFFFF.......fFFF.......FFFFf.FFFFFFFFF.................FFFFFFFf....................f..................W.................fFFFFFFF..................FFFFFFFFFFFF..RR                 ',
      '.fFFf........fFFFFFf..........fFFFFFFf..................fFFFFf.....................fFF..f.............WWWw..............FFFFFFFFFFF................fFFFFFFFFFFf..RR                 ',
      '..FF.........FFFFFFFf..........FFFFff..................fFFFf.......................FFFFFFFf............Wwwww..W.........FFFFFFFFFFFf...............FFFFFFFFFFFf.RR.                 ',
      '..f.........fFFFFFFFFf...........................fFFffFFFF..........................ffFFFFFF.............wwwWWWWW.......FFFFFFFFFFFf..............fFFFFFFFFFFF...R                  ',
      'RR..........FFFFFFFFFFFF...f....................fFFFFFFFf..............................ffFFFFFf.........f....WWWWW......fFFFFFFFFFFF.......fFf..fFFFFFFF.                           ',
      'RR.........fFFFFFFFFFFFFFffFFf..................FFFFFFF..............fF..................fFFFFF.........ff....WWWW.......FFFFFFFFFFFF......FFF..FFFFFFFF.                           ',
      '.RR........FFFFFFFFFFFFFFFFFFFF................fFFFFFFF..............FF.........ff........fFFFFf....ff....f....WWWW.......FFFFFFFFFFFFFf..fFFF.FFFFFffF..                           ',
      ' .RR.....fFFFFFFFFFFF.FFFFFFFFFf...f...........fFFFFFFFFf..f.........F.........FFFF........FFFF....FFFFf.fFf....WWWWW........fFFFFFFFFFFFFFFFFFFFFFF.....                           ',
      '  RR....fFFFFFFFFFFFFfFFFFFFFFF...fFF.fFF.......fFFFFFFFF.fFf.........RR.......FFFFf.RRRR..fFf....fFFFFF.fFf...F.WWWW..........FFFFFFFFFFFFFFFFFFFFFFf...                           ',
      '  .RR...fFFFFFFFFFFFFFFFFFFFf....fFFFFFFFf.........Ff...ffFF..RR......RRR.....fFFFF.RRRRRRR.......FFFf....f...fFFfWWWW...........fFFF.FFFFFFFFfFFFFFFFf..                           ',
      '   .RR...ff..fFFFFf.FFFFFFFFFFFFfFFFFFFFFf...............FFf..RRR....RRRR.....fFFFFRRRRRRRRRRR....FFf.........fFFF.WWWW...........FFFFFFFFFFFFfFFFf.f....                           ',
      '     RRRR.....fFFFf..FFFFFFFFFFFFFFFFFFFf...............f....RRRRRRRRRRRRff....FFFRRRRRRRRRRRRRR...............FFFf.WWWW...........FFFFFFFFFFFFFf..RRRRR                            ',
      '      .RRR.....fFFF..FFFFFFFFFFFFFFFFFF............fffFFF....RRRRRRRRRRR.FF......fRRRRRRRRRRRRRRR...............ff...WWWW..........FFFFFFFFFFFf..RRRRRRR                            ',
      '        .RR.....FFFFFFFFFFffFFFFFFFFFFf............FFFFFFff..RRRRRRRRRRR.fF.......RRRRRRRRRRRRRRRR.......f............WWW..........fFFFFFFFFF..RRRRR.                               ',
      '          .RR....fffFFFFFFFFFFFFFFFFFF..fFf.......FFFFFFFFFF..RRRRRRRRRR.........RRRRRRRRRRRRRRRRR......FFF............WWW........fFFFFFFFFf..RRR.                                  ',
      '           .RRRR......fFFFFFFFFFFFFFFF..FFFF......fFFFFFFFFFF...RRRRRRRR..........RRRRRRRRRRRRRRRR...ffFFFFFFFf.......wwWW........FFFFFFff..RRR.                                    ',
      '             .RRRRR.....FFFFFFFFFFFF....FFFFF......ffFFFFFFFFf...RRRRRRR...........RRRRRRRRRRRRRR..FFFFFFFFFFFFf.....Rwww.........FFFFf...RRRR.                                     ',
      '                .RRRRRR..FFFFFFFFFFf...fFFFFFf...........FFFFF...RRR.RR.............RRRRRRRRRRRR..fFFFFFf...fff......RRwwwwwwR......RRRRRRRR.                                       ',
      '                   ..RRRR.fFFFFFFFFF....FFFFf.............FFFF...RRR........fFFFf....RRRRRRRR.....FFFFFF..............RRRwwwwRRRRRRRRRRRR.                                          ',
      '                      .RRR.fFFFFFFFF....FFf........ff.....FFFf....R.........FFFFFf.fFfRR...fffFFFFFFFFF.......ffFf...RRRRRwwwRRRRRRRR...                                            ',
      '                        RRR.fFFFFFFFF..FFF.......FFFFF.................ff.fFFFFFFFFFFF....fFFFFFFF...FFf....fFFFFf...RRRRR..RRRRRRRR.                                               ',
      '                         RRR..FFFFFFFFFFFF..RRR.fFFFFFF...............fFFfFFFFFFFFFFFf.RR..fFFFFFF....FFF...FFFFF..RRR.        .RRRR.                                               ',
      '                          .RR..FFFFFFFFFFF.RRRRR.fFFFFFF..............fFf..fff.fff....RRRRR..fFFffff..fFFf.fFFFf..RR.          .RRRR.                                               ',
      '                            RR..FFFFFFFFFF.RRRRRRR...fff................RRRRRRRRRRRRRRRRRRRRRRR....f..FFFF.FFf..RRR.         RRRRRRRRRRRRRRR                                        ',
      '                            .RR..ffFFFFFFf.RRRRRRRRRRR....fF..FF.....RRRRRRRRRRRRRRRRRR....RRRRRRRRRRR.ff....RRRRR          RRRRRRRRRRRRRRRRR                                       ',
      '                             .RRR...ff...RRRRR....RRRRRRR..f.fFf..RRRRRR...    .....         ..RRRRRRRRRRRRRRRRR.           RRRRRRRRRRRRRRRRR.                                      ',
      '                               RRRRRRRRRRRRR.       ..RRRRRR..RRRRRR.                             .RRRRRRRRRRR.             .RRRRRRRRRRRRRRRRR                                      ',
      '                                ..RRRRRRR.              .RRRRRRRR.                                    ......                 RRRRRRRRRRRRRRRRR                                      ',
      '                                                           .RRR.                                                              ....RR.RRRRRRR.                                       ',
    ],
  },

  // The continuous rock wall's foot sits on the boundary line, so the player is
  // stopped right at the rock by the boundary itself — no inset gap needed.
  boundaryInset: 0,

  spawn: { x: -100.5, z: 49.5, yaw: 1.2 }, // beside the bed, inside the Hearthstead farmhouse (see farm.houses)

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
    { key: 'northtrail', name: 'North Trail',           x: -47, z: -98.1, kind: 'landmark' },
    { key: 'entrance',   name: 'Hearthstead Farm',      x: -77.5, z: 59.5, kind: 'safe', r: 26 },
    { key: 'hunter',     name: "Old Hunter's Trail",    x: -37.2, z: -62.1, kind: 'landmark' },
    // --- North: the pool, the chapel, the cursed thicket ---
    { key: 'ravenwater', name: 'Ravenwater Pool',       x: -48, z: -27.5, kind: 'landmark' },   // marked from the quiet north shore
    { key: 'shrine',     name: 'Fallen Chapel',         x: 34,  z: -78, kind: 'safe', r: 12 },
    { key: 'stones',     name: 'Grimroot Thicket',      x: 91,  z: -68, kind: 'boss', optional: true },
    // --- The main road west to east ---
    { key: 'westroad',   name: 'West Road',             x: -120.9, z: 4.4,  kind: 'landmark' },
    { key: 'wolfsnag',   name: 'Wolfsnag Pass',         x: -87.7, z: -23.3, kind: 'landmark' },
    { key: 'ravine',     name: 'Root-Choked Ravine',    x: -114, z: -16, kind: 'mine', art: 'mine', optional: true },
    { key: 'creek',      name: 'Blackroot Creek',       x: -30, z: -21.5, kind: 'landmark' },   // the ford, south bank
    { key: 'outpost',    name: 'Witchlight Camp',       x: 1,   z: -6,  kind: 'safe', r: 14 },
    { key: 'rotfen',     name: 'Murkfen',               x: 88,  z: 3,   kind: 'landmark', optional: true },
    { key: 'eastpath',   name: 'East Path',             x: 108.2, z: -45.2, kind: 'landmark' },
    // --- South: the lookout, the war camp, the den ---
    { key: 'watchtower', name: 'Crow Hill',             x: -84, z: 26,  kind: 'landmark', optional: true },
    { key: 'bridge',     name: 'Mossy Ford',              x: 24.4,  z: 29.3,  kind: 'landmark' },
    { key: 'wolfden',    name: 'Briar Camp',            x: 63,  z: 35,  kind: 'landmark' },
    { key: 'camp',       name: 'Wayside Camp',          x: -14, z: 56,  kind: 'safe', r: 9, merchant: true, optional: true },
    { key: 'cave',       name: 'Spider Den',            x: 1,   z: 71.5,  kind: 'cave' },
    { key: 'southgate',  name: 'South Track',           x: 50.5,  z: 86,  kind: 'gate', exit: true },
    // --- Mining scrapes, off the road and worth the walk ---
    { key: 'copperhollow', name: 'Copper Hollow',       x: 106.5, z: -46, kind: 'mine', art: 'mine', optional: true },
    { key: 'tinscrape',    name: 'Tin Scrape',          x: -122, z: -14, kind: 'mine', art: 'mine', optional: true },
  ],

  // NPCs. `id` matches a quest's `giver`; the client builds a figure here and
  // floats a ! / ? marker over it when that giver has something for you.
  npcs: [
    { id: 'alric',    name: 'Warden Alric',        x: -91.5,  z: 68.5, poi: 'entrance', model: 'Male', yaw: 3.1,
      // Looks mix the modular outfit pack by slot (outfit numbers; see client OUTFITS) with per-slot recolours.
      look: { hairColor: '#2b1d14', skin: '#c49a76', outfit: 4, hair: 'Hair_Crop', beard: 'Beard_Short' },   // Royal Knight — the warden of the clearing in plate
      idle: 'Keep to the path, and keep your blade where you can reach it.' },
    // Farmstead folk at the Entrance Clearing.
    { id: 'garrick',  name: 'Drillmaster Garrick',  x: -67.5,    z: 69.5, poi: 'entrance', model: 'Male', yaw: 3.1, trainer: 'fighter',
      look: { hairColor: '#3a2a1a', skin: '#b58a66', outfit: 6, hair: 'Hair_Undercut', beard: 'Beard_Full' },   // Sellsword — the drillmaster in a mercenary's brigandine
      idle: 'Swinging a stick is free. Swinging it properly costs coin. Come learn.' },
    { id: 'aldis',    name: 'Mother Aldis',         x: -79.5,   z: 74.5, poi: 'entrance', model: 'Female', yaw: 3.0, trainer: 'cleric',
      look: { hairColor: '#d9d2c4', skin: '#d4b394', outfit: 31, hair: 'Hair_Bowl' },   // Temple Acolyte — undyed long tunic and circlet
      idle: 'The Light asks little of us: mend what is broken, and stand between the dark and those who cannot.' },
    { id: 'lark',     name: 'Lark the Minstrel',    x: -57.5,   z: 76.5, poi: 'entrance', model: 'Male', yaw: 3.4, trainer: 'bard',
      look: { hairColor: '#7a4a22', skin: '#d2a67f', outfit: 19, hair: 'Hair_Swept', beard: 'Beard_Goatee' },   // Rose Bard — doublet and feathered cape
      idle: 'Every fight has a rhythm, friend. Learn to hear it and the whole party keeps time.' },
    { id: 'maggie',   name: 'Old Maggie',          x: -53.5,   z: 55.5, poi: 'entrance', model: 'Female', yaw: 3.0,
      look: { hairColor: '#b9b2a4', skin: '#d4b394', outfit: 1, hair: 'Hair_Topknot' },   // Village Farmhand
      idle: 'Mind the hens, love — and shut the gate on your way out.' },
    { id: 'bram',     name: 'Farmhand Bram',       x: -90.5,  z: 57.5, poi: 'entrance', model: 'Male', yaw: 1.4,
      look: { hairColor: '#8a5a2b', skin: '#d9ab86', outfit: 1, hair: 'Hair_Bowl' },   // Village Farmhand
      idle: 'Cows need feedin’, fences need mendin’. No rest out here.' },
    // --- Dark Woods Outpost: the warden's camp, and the zone's story ---
    { id: 'rowan',    name: 'Warden Rowan',        x: 1,  z: -5.5, poi: 'outpost', model: 'Male', yaw: 3.14,
      look: { hairColor: '#4a4038', skin: '#bc8f68', outfit: 47, hair: 'Hair_Receding', beard: 'Beard_Short' },   // Steel Vanguard — the outpost's warden
      idle: 'Never walk these roads without light. The animals I understand — it is what moves when they go quiet that bothers me.' },
    { id: 'brann',    name: 'Hunter Brann',        x: -5.0,  z: -8.0, poi: 'outpost', model: 'Male', yaw: 1.2,
      look: { hairColor: '#5a3a1e', skin: '#c08a5e', outfit: 3, hair: 'Hair_Ponytail', beard: 'Beard_Stubble' },   // Forest Ranger — jerkin, hood and cloak
      idle: 'Lift your boot. You are standing in a track, and a very big one.' },
    { id: 'lysa',     name: 'Scout Lysa',          x: 6.0,   z: -9.0, poi: 'outpost', model: 'Female', yaw: 0.6,
      look: { hairColor: '#2e1d12', skin: '#c99a74', outfit: 36, hair: 'Hair_Ponytail' },   // Snow Scout — fur vest and hood
      idle: 'The trees in the old grove are changing. Black bark, purple veins under the roots.' },
    { id: 'mira',     name: 'Mira Thorn',          x: -6.7,  z: -3.3, poi: 'outpost', model: 'Female', yaw: 2.4,
      look: { hairColor: '#6b4a24', skin: '#d0a57e', outfit: 9, hair: 'Hair_Mane' },   // Grey Wanderer — a herbalist's robe
      idle: 'A disease kills something. This is changing it. That is the difference, and it is the whole problem.' },
    { id: 'tessa',    name: 'Quartermaster Tessa', x: 5,   z: -4.5, poi: 'outpost', model: 'Female', yaw: 3.6,
      look: { hairColor: '#3a2a1a', skin: '#c9996f', outfit: 29, hair: 'Hair_Braids' },   // Wine Merchant — a quartermaster's surcoat
      idle: 'Food, medicine, weapons, coffee. Ask me which one I miss most.' },
    { id: 'alden',    name: 'Brother Alden',       x: -2.0,  z: -11.0, poi: 'outpost', model: 'Male', yaw: 0.2,
      look: { hairColor: '#8a8276', skin: '#c7a081', outfit: 42, hair: 'Hair_Receding', beard: 'Beard_Full' },   // Crimson Cardinal — the priest
      idle: 'Have you heard the bell? It has been abandoned twenty years, and still it rings.' },
    { id: 'fenwick',  name: 'Old Fenwick',         x: 9,   z: -11.5, poi: 'outpost', model: 'Male', yaw: 4.2,
      look: { hairColor: '#b9b2a4', skin: '#b98f6a', outfit: 28, hair: 'Hair_Mane', beard: 'Beard_Full' },   // Bog Hermit — the old woodsman
      idle: 'Brown ones are safe. Blue ones are safe. Red ones depend on how attached you are to your organs.' },
    // Far enough from his own camp's roamers that a level-3 errand isn't a fight.
    { id: 'pib',      name: 'Pib',                 x: -16.0,  z: -20.0, poi: 'creek', model: 'Goblin_Scavenger', yaw: 1.0, h: 1.5,
      idle: 'Pib not fighting. Pib waving. Keep doing nothing, is good.' },
    { id: 'sela',     name: 'Ranger Sela',         x: -86.0,   z: 28.0, poi: 'watchtower', model: 'Female', yaw: 2.2,
      look: { hairColor: '#2e1d12', skin: '#c99a74', outfit: 3, hair: 'Hair_Braids' },   // Forest Ranger
      idle: 'From the old tower you can see their fires. The Wolf Den grows bolder every night.' },
    { id: 'dorn',     name: 'Prospector Dorn',     x: -118.0, z: -17.0,  poi: 'ravine',   model: 'Male', yaw: 5.0,
      look: { hairColor: '#b9b2a4', skin: '#b98f6a', outfit: 32, hair: 'Hair_Crop', beard: 'Beard_Full' },   // Blacksmith — apron and headband
      idle: 'That iron seam is mine by right — but the goblins dig it faster than I can chase them off.' },
    { id: 'hermit',   name: 'Hermit of the Grove', x: 37.0,    z: -76.0,   poi: 'shrine',   model: 'Male',
      look: { hairColor: '#9a9a90', skin: '#c9a07c', outfit: 28, wear: { boots: 0 } },   // Bog Hermit, barefoot
      idle: 'The shrine holds. Not much else out here does.' },
    { id: 'merchant', name: 'Wandering Merchant',  x: -15.5, z: 55.5,  poi: 'camp',     model: 'Female', trade: true,
      look: { hairColor: '#4a2e1a', skin: '#d0a57e', outfit: 29, hair: 'Hair_Topknot' },   // Wine Merchant
      idle: 'Wares? Aye, soon enough, traveller. Mind the woods.' },
  ],

  // The road network. Two kinds, as the legend names them: a major path (road)
  // and a minor path (trail). Every route is A*-routed over the traced terrain
  // between its landmarks, so a road goes where the ground actually allows --
  // through Wolfsnag Pass rather than into the cliff beside it.
  paths: [
    // West Road -> Wolfsnag Pass -> Witchlight Camp -> Murkfen -> East Path
    { kind: 'road', points: [
      { x: -123.8, z: -4.5 }, { x: -123.8, z: -9 }, { x: -120.8, z: -12 }, { x: -120.8, z: -13.5 },
      { x: -114.8, z: -13.5 }, { x: -113.3, z: -15 }, { x: -105.8, z: -18 }, { x: -107.3, z: -18 },
      { x: -110.3, z: -21 }, { x: -110.3, z: -30 }, { x: -107.3, z: -33 }, { x: -102.8, z: -33 },
      { x: -101.3, z: -31.5 }, { x: -99.8, z: -31.5 }, { x: -93.8, z: -25.5 }, { x: -92.3, z: -25.5 },
      { x: -86.3, z: -21 }, { x: -84.8, z: -21 }, { x: -84.8, z: -22.5 }, { x: -83.3, z: -24 },
      { x: -80.3, z: -24 }, { x: -75.8, z: -27 }, { x: -69.8, z: -27 }, { x: -62.3, z: -21 },
      { x: -59.3, z: -21 }, { x: -56.3, z: -18 }, { x: -51.8, z: -18 }, { x: -50.3, z: -16.5 },
      { x: -29.3, z: -16.5 }, { x: -21.8, z: -12 }, { x: -11.3, z: -12 }, { x: -0.8, z: -6 },
      { x: 23.3, z: -6 }, { x: 24.8, z: -4.5 }, { x: 24.8, z: -6 }, { x: 21.8, z: -9 },
      { x: 11.3, z: -9 }, { x: 5.3, z: -15 }, { x: -9.8, z: -15 }, { x: -17.3, z: -22.5 },
      { x: -17.3, z: -28.5 }, { x: -21.8, z: -33 }, { x: -21.8, z: -39 }, { x: -20.3, z: -39 },
      { x: -20.3, z: -40.5 }, { x: -18.8, z: -40.5 }, { x: -18.8, z: -42 }, { x: -14.3, z: -42 },
      { x: -11.3, z: -39 }, { x: -8.3, z: -39 }, { x: -6.8, z: -37.5 }, { x: -2.3, z: -37.5 },
      { x: -0.8, z: -36 }, { x: 5.3, z: -36 }, { x: 9.8, z: -33 }, { x: 23.3, z: -33 },
      { x: 26.3, z: -30 }, { x: 29.3, z: -30 }, { x: 33.8, z: -27 }, { x: 38.3, z: -27 },
      { x: 39.8, z: -25.5 }, { x: 41.3, z: -25.5 }, { x: 41.3, z: -24 }, { x: 42.8, z: -22.5 },
      { x: 42.8, z: -18 }, { x: 47.3, z: -13.5 }, { x: 48.8, z: -9 }, { x: 50.3, z: -10.5 },
      { x: 50.3, z: -13.5 }, { x: 60.8, z: -25.5 }, { x: 66.8, z: -25.5 }, { x: 68.3, z: -27 },
      { x: 75.8, z: -27 }, { x: 77.3, z: -25.5 }, { x: 78.8, z: -25.5 }, { x: 92.3, z: -12 },
      { x: 92.3, z: -10.5 }, { x: 93.8, z: -9 }, { x: 93.8, z: -6 }, { x: 83.3, z: 4.5 },
      { x: 81.8, z: 4.5 }, { x: 78.8, z: 7.5 }, { x: 75.8, z: 7.5 }, { x: 68.3, z: 0 },
      { x: 65.3, z: 0 }, { x: 65.3, z: -1.5 }, { x: 65.3, z: 0 }, { x: 68.3, z: 0 },
      { x: 75.8, z: 7.5 }, { x: 78.8, z: 7.5 }, { x: 90.8, z: -4.5 }, { x: 90.8, z: -9 },
      { x: 89.3, z: -9 }, { x: 90.8, z: -9 }, { x: 98.3, z: -16.5 }, { x: 102.8, z: -18 },
      { x: 102.8, z: -21 }, { x: 104.3, z: -22.5 }, { x: 104.3, z: -40.5 }, { x: 107.3, z: -43.5 },
      { x: 111.8, z: -45 },
    ] },
    // North Trail -> south to Witchlight Camp
    { kind: 'road', points: [
      { x: -39.8, z: -100.5 }, { x: -39.8, z: -99 }, { x: -44.3, z: -93 }, { x: -44.3, z: -79.5 },
      { x: -45.8, z: -78 }, { x: -45.8, z: -75 }, { x: -41.3, z: -70.5 }, { x: -41.3, z: -61.5 },
      { x: -30.8, z: -61.5 }, { x: -24.8, z: -55.5 }, { x: -21.8, z: -55.5 }, { x: -17.3, z: -49.5 },
      { x: -17.3, z: -46.5 }, { x: -18.8, z: -45 }, { x: -18.8, z: -40.5 }, { x: -26.3, z: -40.5 },
      { x: -30.8, z: -45 }, { x: -33.8, z: -45 }, { x: -33.8, z: -46.5 }, { x: -36.8, z: -46.5 },
      { x: -38.3, z: -48 }, { x: -36.8, z: -46.5 }, { x: -33.8, z: -46.5 }, { x: -33.8, z: -43.5 },
      { x: -27.8, z: -37.5 }, { x: -27.8, z: -31.5 }, { x: -15.8, z: -19.5 }, { x: -15.8, z: -18 },
      { x: -14.3, z: -16.5 }, { x: -12.8, z: -16.5 }, { x: -3.8, z: -7.5 }, { x: 0.8, z: -6 },
    ] },
    // Witchlight Camp -> Mossy Bridge -> Spider Den -> South Track
    { kind: 'road', points: [
      { x: 1, z: -6 }, { x: -0.8, z: -4.5 }, { x: -12.8, z: -4.5 }, { x: -18.8, z: 1.5 },
      { x: -18.8, z: 4.5 }, { x: -14.3, z: 9 }, { x: -9.8, z: 9 }, { x: -8.3, z: 10.5 },
      { x: 5.3, z: 10.5 }, { x: 5.3, z: 9 }, { x: 5.3, z: 19.5 }, { x: 2.3, z: 24 },
      { x: 2.3, z: 31.5 }, { x: -2.3, z: 36 }, { x: -2.3, z: 42 }, { x: -3.8, z: 43.5 },
      { x: -17.3, z: 43.5 }, { x: -20.3, z: 46.5 }, { x: -20.3, z: 51 }, { x: -15.8, z: 55.5 },
      { x: -9.8, z: 55.5 }, { x: -8.3, z: 57 }, { x: -6.8, z: 57 }, { x: -5.3, z: 58.5 },
      { x: -5.3, z: 66 }, { x: -2.3, z: 69 }, { x: 0.8, z: 69 }, { x: 0.8, z: 70.5 },
      { x: 8.3, z: 73.5 }, { x: 12.8, z: 76.5 }, { x: 14.3, z: 76.5 }, { x: 14.3, z: 79.5 },
      { x: 26.3, z: 79.5 }, { x: 29.3, z: 82.5 }, { x: 30.8, z: 82.5 }, { x: 29.3, z: 82.5 },
      { x: 26.3, z: 79.5 }, { x: 14.3, z: 79.5 }, { x: 14.3, z: 76.5 }, { x: 8.3, z: 66 },
      { x: 8.3, z: 61.5 }, { x: 6.8, z: 61.5 }, { x: 6.8, z: 60 }, { x: 5.3, z: 58.5 },
      { x: 5.3, z: 52.5 }, { x: 3.8, z: 52.5 }, { x: 3.8, z: 46.5 }, { x: 2.3, z: 45 },
      { x: 2.3, z: 37.5 }, { x: 5.3, z: 37.5 }, { x: 6.8, z: 36 }, { x: 15.8, z: 36 },
      { x: 17.3, z: 37.5 }, { x: 18.8, z: 37.5 }, { x: 26.3, z: 45 }, { x: 44.3, z: 64.5 },
      { x: 44.3, z: 76.5 }, { x: 45.8, z: 78 }, { x: 48.8, z: 85.5 },
    ] },
    // Chapel spur
    { kind: 'trail', points: [
      { x: -40, z: -58 }, { x: -39.8, z: -60 }, { x: -38.3, z: -61.5 }, { x: -32.3, z: -61.5 },
      { x: -27.8, z: -66 }, { x: -9.8, z: -66 }, { x: 0.8, z: -72 }, { x: 11.3, z: -72 },
      { x: 18.8, z: -76.5 }, { x: 30.8, z: -76.5 }, { x: 32.3, z: -78 }, { x: 33.8, z: -78 },
    ] },
    // Grimroot spur
    { kind: 'trail', points: [
      { x: 48.8, z: -7.5 }, { x: 50.3, z: -9 }, { x: 50.3, z: -13.5 }, { x: 57.8, z: -21 },
      { x: 59.3, z: -25.5 }, { x: 66.8, z: -33 }, { x: 66.8, z: -34.5 }, { x: 69.8, z: -39 },
      { x: 69.8, z: -48 }, { x: 71.3, z: -49.5 }, { x: 71.3, z: -61.5 }, { x: 75.8, z: -64.5 },
      { x: 81.8, z: -64.5 }, { x: 86.3, z: -67.5 }, { x: 90.8, z: -67.5 },
    ] },
    // Crow Hill spur
    { kind: 'trail', points: [
      { x: -2, z: 42 }, { x: -3.8, z: 43.5 }, { x: -9.8, z: 43.5 }, { x: -11.3, z: 42 },
      { x: -12.8, z: 42 }, { x: -17.3, z: 37.5 }, { x: -39.8, z: 37.5 }, { x: -44.3, z: 33 },
      { x: -56.3, z: 33 }, { x: -63.8, z: 28.5 }, { x: -77.3, z: 28.5 }, { x: -78.8, z: 27 },
      { x: -83.3, z: 25.5 },
    ] },
    // Briar Camp spur
    { kind: 'trail', points: [
      { x: 2, z: 26 }, { x: 3.8, z: 27 }, { x: 15.8, z: 27 }, { x: 17.3, z: 28.5 },
      { x: 36.8, z: 28.5 }, { x: 41.3, z: 31.5 }, { x: 47.3, z: 31.5 }, { x: 50.3, z: 34.5 },
      { x: 63.8, z: 34.5 },
    ] },
    // Fen causeway
    { kind: 'trail', points: [
      { x: 63, z: 35 }, { x: 66.8, z: 31.5 }, { x: 80.3, z: 31.5 }, { x: 80.3, z: 22.5 },
      { x: 77.3, z: 22.5 }, { x: 80.3, z: 18 }, { x: 80.3, z: 13.5 }, { x: 81.8, z: 13.5 },
      { x: 81.8, z: 7.5 }, { x: 87.8, z: 1.5 }, { x: 87.8, z: -1.5 }, { x: 89.3, z: -3 },
      { x: 89.3, z: -9 },
    ] },
    // South-western sweep to Hearthstead
    { kind: 'trail', points: [
      { x: -84, z: 26 }, { x: -81.8, z: 27 }, { x: -66.8, z: 42 }, { x: -65.3, z: 42 },
      { x: -63.8, z: 43.5 }, { x: -60.8, z: 43.5 }, { x: -59.3, z: 45 }, { x: -51.8, z: 48 },
      { x: -48.8, z: 51 }, { x: -45.8, z: 51 }, { x: -39.8, z: 55.5 }, { x: -27.8, z: 55.5 },
      { x: -24.8, z: 58.5 }, { x: -20.3, z: 58.5 }, { x: -18.8, z: 57 }, { x: -14.3, z: 55.5 },
    ] },
  ],

  // No authored rivers. The blueprint's water is all in the traced terrain
  // now -- carrying a second, hand-drawn river system on top of it put water
  // where the drawing has none. (The Killing Fields still has its own.)
  rivers: [],


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


  // Impassable rock (collision) left over for the cave mouth's mound. The
  // Wolfsnag boulders are gone -- that ground is a cliff wall now.
  rocks: [
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
    { id: 'camp_lantern_1', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: -0.8, z: -3.9, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_2', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: 6.9, z: -5.1, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_3', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: 6.86, z: -9.38, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_4', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: 1.0, z: -12.76, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_5', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: -4.86, z: -9.38, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
    { id: 'camp_lantern_6', tag: 'lantern', toggle: true, name: 'Camp Lantern', m: 'props/Camp_Lantern', x: -4.9, z: -5.1, s: 1.35, c: 0.5, reach: 3.0, verb: 'Light', verbOff: 'Put out', examine: 'A lantern on a pole at the edge of the camp.' },
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
    ...[[-6.4, -3.0], [-11.0, -4.0], [-5.0, -14.0], [7.0, -14.0], [13.0, -6.0], [22.3, -6.7], [-15.0, 10.0], [3.0, 8.0], [21.0, -12.0], [-9.0, -18.0]]
      .map(([x, z], i) => ({ id: 'glowcap_' + i, tag: 'glowcap', name: 'Glowcaps', m: 'cave/Luminous_Mushrooms', x, z, s: 2.6, c: 0, reach: 3,
        verb: 'Gather', gives: { item: 'Glowcap' }, respawn: 45, light: 0x7fe8c8,
        text: 'The mushroom gives off a faint blue-green glow.' })),
  ],

  // Treasure chests reward exploring the optional landmarks. Loot scales with
  // how deep/dangerous the spot is. Positions are pre-scale like everything else.
  chests: [
    { id: 'watchtower', x: -78, z: 31,  gold: 70,  item: 'Leather Body' },        // old soldier's kit on Crow Hill
    { id: 'rotfen',     x: 98,  z: -22, gold: 110, item: 'Battered Iron Shield' }, // stash on the dry ground above Murkfen
    { id: 'wolfden',    x: 66,  z: 33,  gold: 160, item: 'Iron Sword' },           // goblin plunder at Briar Camp
    { id: 'stones',     x: 88,  z: -71, gold: 240, item: 'Crystal Heart' },        // the Guardian's hoard in Grimroot Thicket
  ],

  // Fishing spots, fished from the bank: the deep pool in the north-west, then
  // down Blackroot Creek as it runs east. Tier gates which fish lands.
  fishingSpots: [
    { id: 'fs_shr1', tier: 'Shrimp', x: -59, z: -38 },   // Ravenwater Pool, south bank
    { id: 'fs_shr2', tier: 'Shrimp', x: -52, z: -34 },   // the creek below the ford
    { id: 'fs_tro1', tier: 'Trout',  x: 14,  z: -14 },
    { id: 'fs_sal1', tier: 'Salmon', x: 33,  z: -4 },    // where the creek slows into the fen
  ],

  // Campfire cooking stations. Stand near one to cook raw meat/fish.
  campfires: [
    { id: 'cf_farm',    x: -51.5,  z: 54.5 },  // Hearthstead's yard fire (early cooking)
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
      { s: 1.45, m: 'Small_Canvas_Tent', x: 2.07, z: -4.41, yaw: 3.58, c: 1.0 },
      { s: 1.45, m: 'Small_Canvas_Tent', x: 4.5, z: -7.06, yaw: 4.36, c: 1.0 },
      { s: 1.45, m: 'Small_Canvas_Tent', x: 4.34, z: -10.66, yaw: 5.15, c: 1.0 },
      { s: 1.45, m: 'Small_Canvas_Tent', x: 1.69, z: -13.09, yaw: 5.93, c: 1.0 },
      // A bedroll inside each tent, laid along it on the same bearing, head to
      // the back wall.
      { s: 1.25, m: 'Bedroll', x: 2.16, z: -4.22, yaw: 3.58 },
      { s: 1.25, m: 'Bedroll', x: 4.7, z: -6.99, yaw: 4.36 },
      { s: 1.25, m: 'Bedroll', x: 4.53, z: -10.75, yaw: 5.15 },
      { s: 1.25, m: 'Bedroll', x: 1.76, z: -13.29, yaw: 5.93 },
      // The fire: a pot over it and stools pulled up round it.
      { m: 'Cooking_Tripod', x: 0.08, z: -8.67, yaw: 0.00, c: 0.35 },
      { m: 'Camp_Stool', x: 0.79, z: -7.45, yaw: 3.67 },
      { m: 'Camp_Stool', x: 0.79, z: -9.89, yaw: 5.76 },
      { m: 'Camp_Stool', x: -1.33, z: -8.67, yaw: 1.57 },
      // Stores under the pavilion on the sheltered side, crates stacked against it.
      { s: 1.35, m: 'Supply_Pavilion', x: -4.07, z: -10.18, yaw: 1.22 },
      { m: 'Supply_Crate', x: -3.14, z: -10.84, yaw: 0.98, c: 0.5 },
      { m: 'Supply_Crate', x: -4.78, z: -11.04, yaw: 1.12, c: 0.5 },
      { m: 'Supply_Crate', x: -5.33, z: -9.82, yaw: 1.36, c: 0.5 },
      { m: 'Supply_Crate', x: -3.91, z: -8.95, yaw: 1.50, c: 0.5 },
      { m: 'Water_Barrel', x: -3.5, z: -11.9, yaw: 0.84, c: 0.4 },
      { m: 'Water_Barrel', x: -4.98, z: -8.49, yaw: 1.61, c: 0.4 },
      // A rough fence across the two open approaches, and a sign on the road.
      { m: 'Rough_Fence', x: -1.2, z: -15.91, yaw: 0.17, c: 0.8 },
      { m: 'Rough_Fence', x: -3.03, z: -15.33, yaw: 0.44, c: 0.8 },
      { m: 'Rough_Fence', x: -4.65, z: -14.3, yaw: 0.70, c: 0.8 },
      { m: 'Rough_Fence', x: -6.29, z: -4.99, yaw: 2.09, c: 0.8 },
      { m: 'Rough_Fence', x: -5.12, z: -3.47, yaw: 2.36, c: 0.8 },
      { m: 'Rough_Fence', x: -3.6, z: -2.3, yaw: 2.62, c: 0.8 },
      { m: 'Warning_Sign', x: 0.08, z: -16.2, yaw: 0.00, c: 0.25 },
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
    { type: 'chicken', count: 6, cx: -59.5,  cz: 62.5, r: 4, level: 1, expect: 1, hint: 'Chicken pen' },
    { type: 'cow',     count: 3, cx: -79.5, cz: 63.5, r: 5, level: 1, expect: 1, hint: 'Cow pen' },
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
    { type: 'goblin', count: 6, cx: 56.2, cz: -28.7, r: 10, level: 3, expect: 3, fixed: true, hint: 'Supply road raiders (Woodfang goblins)' },
    // --- Hill ogres squatting on the South Track approach ---
    { type: 'guard',   count: 3, cx: 45.3, cz: 77.2, r: 8,  level: 6, expect: 7, fixed: true, hint: 'Ogre hollow (core)' },
    { type: 'guard',   count: 1, cx: 45.3, cz: 77.2, r: 20, level: 5, expect: 6, roam: 24, fixed: true, hint: 'Ogre hollow (roamer)' },
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
      { x1: -105.5, z1: 42.5, x2: -41.5,  z2: 42.5 },   // north
      { x1: -41.5,  z1: 42.5, x2: -41.5,  z2: 72.5 },   // east
      { x1: -113.5, z1: 48.5, x2: -105.5, z2: 42.5 },   // north-west corner
      { x1: -113.5, z1: 48.5, x2: -113.5, z2: 72.5 },   // west
      { x1: -113.5, z1: 72.5, x2: -97.3, z2: 72.5 }, // south-west (up to the double gate)
      { x1: -93.7, z1: 72.5, x2: -41.5, z2: 72.5 },  // south-east (from the double gate)
      // Cow pen (west of the yard), set back from the houses — opening on its north side.
      { x1: -87.5, z1: 56.5, x2: -81.5, z2: 56.5 }, { x1: -77.5, z1: 56.5, x2: -71.5, z2: 56.5 },
      { x1: -87.5, z1: 56.5, x2: -87.5, z2: 70.5 }, { x1: -71.5, z1: 56.5, x2: -71.5, z2: 70.5 },
      { x1: -87.5, z1: 70.5, x2: -71.5,   z2: 70.5 },
      // Chicken pen (east of the yard), well clear of the Warden's hut — opening on its west side.
      { x1: -65.5,  z1: 56.5, x2: -54.5, z2: 56.5 }, { x1: -65.5, z1: 68.5, x2: -54.5, z2: 68.5 },
      { x1: -54.5, z1: 56.5, x2: -54.5, z2: 68.5 },
      { x1: -65.5,  z1: 56.5, x2: -65.5,  z2: 59.5 }, { x1: -65.5, z1: 63.5, x2: -65.5, z2: 68.5 },
    ],
    gate: { x: -95.5, z: 72.5, yaw: 0, double: true, seg: { x1: -97.3, z1: 72.5, x2: -93.7, z2: 72.5 } },
    // Footpaths from each doorstep to the road. Authored so they walk AROUND
    // the pens (never through a fence): the yard lane runs along z=-83 north of
    // both pens; the Warden's hut path skirts south of the chicken pen.
    // Doorsteps sit ~2.5m in FRONT of each front wall (walls: Bram -83.35,
    // Maggie -83.06, hut west wall x 23.35), the lane runs through the front
    // yard between the houses and the pens, and spurs lead into each pen's opening.
    trails: [
      [ { x: -53.5, z: 52.95 }, { x: -63.5, z: 53.1 }, { x: -73.5, z: 52.65 }, { x: -85.5, z: 53.6 }, { x: -96.5, z: 57.0 } ], // yard lane: Maggie's door -> Bram's door -> road
      [ { x: -49.65, z: 67.5 }, { x: -49.6, z: 62.5 }, { x: -50.5, z: 56.3 }, { x: -53.0, z: 53.2 } ],                 // Warden's hut door -> lane (east of the chicken pen)
      [ { x: -79.5, z: 57.7 }, { x: -79.5, z: 53.4 } ],                                                              // cow pen opening -> lane
      [ { x: -64.3, z: 61.5 }, { x: -67.3, z: 61.5 }, { x: -67.3, z: 55.0 }, { x: -66.0, z: 53.05 } ],                    // chicken pen opening -> lane
    ],
    // Enterable houses: axis-aligned, `door` is the side the doorway is on.
    // Furniture offsets (dx,dz) are metres from the house centre.
    houses: [
      { key: 'farmhouse', name: 'Farmhouse', x: -97.5, z: 50.5, w: 16, d: 12, h: 3.4, door: 'south', roof: 0x8a5a3a, wall: 0xd9cfb6,
        furn: [
          { k: 'bed',       dx: -5.2, dz: -3.6, yaw: 0 },     // the player's bed (west room)
          { k: 'chest',     dx: -6.8, dz: -0.2, yaw: 1.57 },
          { k: 'table',     dx: 3.2,  dz: -1.6, yaw: 0 },
          { k: 'stool',     dx: 3.2,  dz: 0.6,  yaw: 0 }, { k: 'stool', dx: 5.0, dz: -1.6, yaw: 0 },
          { k: 'hearth',    dx: 6.6,  dz: -4.4, yaw: 0 },
          { k: 'shelf',     dx: -1.0, dz: -5.0, yaw: 0 },
        ] },
      { key: 'maggie',    name: "Maggie's Cottage", x: -53.5, z: 48.5, w: 12, d: 10, h: 3.2, door: 'south', roof: 0x6f5a48, wall: 0xcdc3a8,
        furn: [ { k: 'bed', dx: -3.4, dz: -3.0, yaw: 0 }, { k: 'table', dx: 2.6, dz: -0.6, yaw: 0 }, { k: 'stool', dx: 2.6, dz: 1.4, yaw: 0 }, { k: 'hearth', dx: 4.6, dz: -3.6, yaw: 0 } ] },
      { key: 'bram',      name: "Bram's Cottage",   x: -73.5, z: 48.5, w: 11, d: 9,  h: 3.1, door: 'south', roof: 0x7a6248, wall: 0xd2c8ae,
        furn: [ { k: 'bed', dx: 3.0, dz: -2.6, yaw: 0 }, { k: 'chest', dx: -3.8, dz: -2.8, yaw: 0 }, { k: 'table', dx: -2.4, dz: 0.8, yaw: 0 }, { k: 'stool', dx: -0.6, dz: 0.8, yaw: 0 } ] },
      { key: 'guardhut',  name: "Warden's Hut",     x: -45.5, z: 67.5, w: 9,  d: 8,  h: 3.0, door: 'west',  roof: 0x5a5148, wall: 0xc9c2ae,
        furn: [ { k: 'bed', dx: 2.4, dz: -2.0, yaw: 0 }, { k: 'table', dx: -1.6, dz: 1.4, yaw: 0 }, { k: 'chest', dx: 2.6, dz: 2.2, yaw: 0 } ] },
    ],
    // A tilled field of crops west of the cow pen.
    field: { x: -106.5, z: 63.5, w: 22, d: 20, crops: ['Strawberry_Patch', 'Meadow_Sedge', 'Goldenrod_Patch'] },
    // Nature inside the fence: a few trees and bushes/flowers around the yard
    // (worldgen keeps the wild forest out of the farm, so these are placed by hand).
    trees: [
      { x: -83.5, z: 44.0, s: 1.0 }, { x: -63.5, z: 44.0, s: 1.05 }, { x: -44.0, z: 46.5, s: 0.95 },
      { x: -110.5, z: 55.5, s: 0.9 }, { x: -43.0, z: 59.5, s: 1.0 }, { x: -68.5, z: 70.9, s: 0.85 }, { x: -107.5, z: 71.3, s: 0.8 },
      { x: -73.5, z: 43.3, s: 0.8 }, { x: -49.5, z: 43.7, s: 0.9 }, { x: -101.5, z: 44.0, s: 0.85 }, { x: -38.5, z: 73.5, s: 0.85 },
      { x: -91.5, z: 70.9, s: 0.75 }, { x: -57.5, z: 70.9, s: 0.8 },
    ],
    plants: [
      { m: 'Rose_Bush',        x: -102.5,  z: 54.2, s: 1.0 }, { m: 'Rose_Bush',        x: -92.5,  z: 54.2, s: 1.0 },
      { m: 'Lavender_Clump',   x: -78.1, z: 51.2, s: 1.0 }, { m: 'Lavender_Clump',   x: -68.9,  z: 51.2, s: 1.0 },
      { m: 'Flowering_Bush',   x: -58.3, z: 51.5, s: 1.0 }, { m: 'Flowering_Bush',   x: -48.9, z: 51.5, s: 1.0 },
      { m: 'Wildflower_Patch', x: -79.5,   z: 46.0, s: 1.1 }, { m: 'Wildflower_Patch', x: -58.5,   z: 46.0, s: 1.1 },
      { m: 'Clover_Patch',     x: -91.5,  z: 46.5,   s: 1.2 }, { m: 'Clover_Patch',     x: -47.5,   z: 54.5,   s: 1.1 },
      { m: 'Berry_Bush',       x: -42.5,   z: 70.0, s: 0.9 }, { m: 'Round_Box_Bush',   x: -45.5,   z: 71.2, s: 0.8 },
      { m: 'Meadow_Shrub',     x: -111.5,  z: 48.5,   s: 1.0 }, { m: 'Poppy_Patch',      x: -104.5,  z: 71.3, s: 1.0 },
      { m: 'Hosta_Plant',      x: -89.5,  z: 53.9, s: 1.0 }, { m: 'Green_Fern',       x: -41.5,   z: 48.5,   s: 1.0 },
      { m: 'Strawberry_Patch', x: -104.5,  z: 54.1, s: 1.0 }, { m: 'Wildflower_Patch', x: -107.5,  z: 51.5,   s: 1.1 },
      { m: 'Normal_Bush',      x: -112.5,  z: 64.5,   s: 0.9 }, { m: 'Meadow_Shrub',     x: -112.5,  z: 70.5,   s: 0.9 },
      { m: 'Clover_Patch',     x: -70.0,  z: 45.0, s: 1.2 }, { m: 'Poppy_Patch',      x: -61.5,   z: 50.0, s: 1.0 },
      { m: 'Heather_Clump',    x: -43.5,   z: 52.0, s: 1.0 }, { m: 'Goldenrod_Patch',  x: -45.5,   z: 63.0, s: 0.9 },
      { m: 'Sage_Bush',        x: -68.7,  z: 68.5,   s: 0.9 }, { m: 'Creeping_Bellflowers', x: -77.5, z: 71.1, s: 1.0 },
      { m: 'Green_Fern',       x: -82.5,  z: 44.7, s: 1.0 }, { m: 'Lavender_Clump',   x: -56.5,   z: 44.1, s: 1.0 },
      { m: 'Round_Box_Bush',   x: -83.5,  z: 49.9, s: 0.8 }, { m: 'Berry_Bush',       x: -62.5,    z: 68.0, s: 0.85 },
    ],
    props: [
      // Chicken pen: coop, house, nests, feeders.
      { m: 'Walk_In_Chicken_House', x: -58.0, z: 59.5, yaw: 3.14, s: 1.0, c: 2.2 },
      { m: 'Raised_Chicken_Coop',   x: -61.5,  z: 66.0, yaw: 3.6, s: 1.0, c: 1.3 },
      { m: 'Nesting_Boxes',         x: -56.5,  z: 66.5, yaw: 4.0,  s: 1.0, c: 0.8 },
      { m: 'Chicken_Feeder',        x: -59.5,  z: 63.0, yaw: 0,  s: 1.0, c: 0.4 },
      { m: 'Chicken_Waterer',       x: -57.0, z: 63.5, yaw: 0,   s: 1.0, c: 0.4 },
      // Cow pen: troughs and hay.
      { m: 'Feeding_Trough',        x: -84.5, z: 66.5, yaw: 1.57, s: 1.0, c: 0.7 },
      { m: 'Water_Trough',          x: -74.5,  z: 67.5, yaw: 1.57, s: 1.0, c: 0.7 },
      { m: 'Round_Hay_Bale',        x: -84.5, z: 59.5, yaw: 0.5,  s: 1.0, c: 0.7 },
      // Yard clutter around the square and the houses.
      { m: 'Tall_Haystack',         x: -63.5,   z: 46.5, yaw: 0,    s: 1.0, c: 1.1 },
      { m: 'Stacked_Hay_Bales',     x: -60.5,  z: 49.5, yaw: 1.2,  s: 1.0, c: 0.9 },
      { m: 'Hay_Pile',              x: -44.5,  z: 54.5, yaw: 0,    s: 1.0, c: 0.7 },
      { m: 'Scarecrow',             x: -106.5, z: 63.5, yaw: 3.14, s: 1.0, c: 0.4 },
      { m: 'Grain_Barrel',          x: -88.5, z: 48.5, yaw: 0,    s: 1.0, c: 0.5 },
      { m: 'Grain_Sack',            x: -86.5, z: 47.5, yaw: 0.8,  s: 1.0, c: 0.0 },
      { m: 'Vegetable_Crate',       x: -90.5, z: 47.5, yaw: 0.3,  s: 1.0, c: 0.5 },
      { m: 'Wheelbarrow',           x: -83.5, z: 50.5, yaw: 2.2,  s: 1.0, c: 0.4 },
      { m: 'Farm_Handcart',         x: -67.5,   z: 50.5, yaw: 1.0,  s: 1.0, c: 0.6 },
      { m: 'Pitchfork',             x: -87.5, z: 60.5, yaw: 0.3,  s: 1.0, c: 0.0 },
      { m: 'Water_Barrel',          x: -45.5,  z: 70.5, yaw: 0,    s: 1.0, c: 0.5 },
    ],
  },

  // No environmental hazards — the poison damage areas (and their green circles)
  // were removed.
  hazards: [],
};
