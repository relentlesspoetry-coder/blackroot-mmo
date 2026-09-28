#!/usr/bin/env python3
"""Build server/zones/darkwoods.js from the Dark Woods blueprint.

The drawing is the specification. Two things feed this:

  * tools/darkwoods.terrain.json, traced off the blueprint by
    tools/trace_blueprint.py -- the ground itself: water, marsh, cliff, forest,
    open, and where the zone stops.
  * the tables below, read off the drawing in its own pixels -- the nine
    landmarks, the four ways out, the watercourses and the road network. Those
    cannot be guessed from colour: a chapel roof and a shadowed rock are the
    same grey blob, and a road and a trail are the same brown line at different
    widths.

Roads are not traced. They are ROUTED: A* over the traced grid between the
places the drawing joins up, so a road always follows ground you can actually
walk, crosses water only at its bridges, and bends around the cliffs rather
than through them. The drawing says what connects to what; the terrain says how.

The zone is authored at its FINAL size. There is no scale pass any more -- the
old build authored small and multiplied by 1.7 at load, which meant every
coordinate in the file was a lie about where it would end up.

Run:  python3 tools/build_darkwoods.py     (needs numpy)
"""
import heapq
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRID = ROOT / 'tools' / 'darkwoods.terrain.json'
OUT = ROOT / 'server' / 'zones' / 'darkwoods.js'

# --- landmarks, in blueprint pixels ---------------------------------------
# (key, name, subtitle, px, py, kind, radius in world units)
POIS = [
    ('camp',      'Witchlight Camp',  'Traders, rest, supplies',      868, 505, 'safe',   34),
    ('ravenwater', 'Ravenwater Pool', 'Deep waters, darker secrets',  560, 268, 'water',  46),
    ('chapel',    'Fallen Chapel',    'Haunted ruins, whispers remain', 912, 228, 'ruin',  30),
    ('grimroot',  'Grimroot Thicket', 'Cursed trees, strange phenomena', 1243, 279, 'cursed', 38),
    ('wolfsnag',  'Wolfsnag Pass',    'Narrow cliffs, wild territory',  535, 440, 'pass',  30),
    ('murkfen',   'Murkfen',          'Shallow marshes, unstable ground', 1240, 492, 'marsh', 52),
    ('crowhill',  'Crow Hill',        'Old lookout, wide views',        545, 685, 'lookout', 32),
    ('briar',     'Briar Camp',       'Bandits or goblins',            1180, 700, 'enemy',  30),
    ('spiderden', 'Spider Den',       'Cave entrance, spider activity',  870, 860, 'cave',  26),
]

# The four ways out, and the side of the map each one leaves by.
EXITS = [
    ('north_trail', 'North Trail', 'To Fogmire',           712,  60, 'north'),
    ('east_path',   'East Path',   'To Blackroot Hollows', 1395, 350, 'east'),
    ('west_road',   'West Road',   'To Oakhaven',           318, 505, 'west'),
    ('south_track', 'South Track', 'To Old Barrow',        1092, 920, 'south'),
]

# The drawing's contour numbers: (px, py, metres). The blueprint runs 40 m to
# 340 m, which as literal game height would be a cliff face across the whole
# zone, so it is compressed into something walkable and the shape is what
# survives rather than the numbers.
CONTOURS = [
    (600, 140, 80), (963, 145, 280), (902, 285, 200), (1190, 265, 180),
    (1165, 340, 240), (424, 428, 220), (437, 568, 120), (368, 610, 150),
    (545, 685, 340), (712, 817, 190), (1163, 505, 60), (1183, 790, 160),   # 340 moved onto Crow Hill itself
    (1386, 553, 160),
]
# The contours are read against a REFERENCE elevation, not against the lowest
# one. Measuring everything up from 40 m made every contour a hill -- including
# the Murkfen, which the drawing marks 60 m, the LOWEST ground on the map, and
# which came out as a three-unit dome. Low contours have to go below zero or the
# map has no low ground, and a fen sitting above the waterline is not a fen.
LOW_M, HIGH_M, MAX_RISE = 40.0, 340.0, 52.0
REF_M = 150.0            # roughly the median contour: the zone's own sea level
# Hills rise at full scale; basins sink at a fraction of it. Not artistic licence
# -- the water surface is ONE plane across the whole zone, so a basin cannot be
# deep without filling to the brim and becoming a lake. The Murkfen has to sit a
# wader's depth under that plane, not fifteen units under it.
BASIN_SCALE = 0.20

# Ground that goes DOWN. A hill with a negative height is a bowl, and the descent
# is the one piece of Hero-Cycle architecture the zone had none of: the Spider
# Den was drawn as a cave mouth and built as a label on flat grass. Sinking the
# ground around it means the approach is a descent you can feel, and the mouth
# sits at the bottom of it rather than on a lawn. Ravenwater gets a shallower
# basin so the pool sits in the land instead of on it.
# (px, py, radius, depth)
HOLLOWS = [
    (870, 860, 78, -16.0),     # the Spider Den -- the way down
    (560, 268, 96,  -5.0),     # Ravenwater Pool's basin
    # (the Murkfen needs no hollow now -- its own 60 m contour is the basin)
]

# Hand-placed rises, in WORLD metres rather than blueprint pixels, for the few
# places the contours leave a shoreline sitting within centimetres of the water
# line. Murkfen's spit was one: the ground you stand on ran 0.4 to 0.5 m UNDER
# the fen on its eastern side, so the water sheet was drawn across it and
# finished in a face hanging over the mud. Arguing with the water surface there
# was the wrong end of it -- a shore is dry because the ground is higher, so
# this is the ground being higher.
#
# (x, z, radius, height). Sized by simulating the dome against the real terrain
# before building it: at r 10 / h 1.1 it dries about 80 m2 of shallow margin and
# nothing that was over a metre deep, while r 12 / h 1.3 starts filling water
# that is meant to be there.
BANKS = [
    (233.0, 6.0, 13.0, 2.0),   # Murkfen: the spit east of the landing
]
# How much of a bank's radius is stamped dry in the trace. The rest is the
# dome's skirt, which the blur feathers into the water.
BANK_CORE = 0.8

# --- the water ------------------------------------------------------------
# Lakes and marsh come out of the trace; these are the CHANNELS, which are one
# or two pixels wide on the drawing and would vanish into any grid.
RIVERS = [
    ('Blackroot Creek', 9.0, [
        (655, 268), (700, 252), (733, 263), (775, 301), (818, 346), (858, 392),
        (900, 425), (958, 452), (1030, 470), (1100, 479), (1168, 486)]),
    # The Sallows is Ravenwater's inlet -- its sheet's "rocky inlet, feeds the
    # pool". It used to stop five metres short of the water, so the pool had a
    # stream pointing at it and nothing flowing in. The last two points carry
    # it over the eastern lip and into the pool proper.
    ('The Sallows', 7.0, [
        (712, 118), (703, 158), (686, 196), (668, 233), (656, 262),
        (650, 267), (642, 271)]),
    # Re-traced by scanning the drawing for its blue centreline. The first pass
    # ran this almost straight south from the camp and was up to 125 px adrift --
    # which is why the bridge authored at (845, 640) had nothing under it. The
    # real watercourse starts as the waterfall under the WEST ROAD bridge, drops
    # south-east past Crow Hill and runs out at the South Track.
    ('Crowwater', 8.0, [
        (522, 524), (524, 548), (526, 563), (556, 569), (578, 576), (604, 584),
        (630, 591), (663, 593), (686, 604), (710, 620), (721, 641), (749, 661),
        (753, 681), (781, 701), (846, 721), (874, 741), (878, 761), (891, 781),
        (956, 801), (1007, 821), (1031, 841), (1047, 861), (1062, 881), (1081, 901)]),
]

# Where the DRAWING shows a crossing. These do not place bridges any more -- the
# bridges are computed from where the routed roads actually meet the rivers (see
# river_bridges in main). What these do is make those cells cheap for the router,
# so it prefers to cross where the drawing crosses.
BRIDGES = [
    (718, 240), (826, 356), (955, 452),      # the Blackroot Creek crossings
    (522, 520),                              # the WEST ROAD bridge, over the falls
    (735, 650), (900, 793),                  # the Crowwater crossings
]
# The two Murkfen sites that used to sit here were never river bridges -- the
# drawing crosses the fen on PLANK WALKS, which the decks section lays.

# The blueprint marks two chokepoints, and a chokepoint is not decoration: it is
# the place the road narrows to a single gap in the rock, so that getting through
# is an event rather than a walk. The first build carved the cliffs out of the
# road's way wholesale and destroyed both of them. Roads now cut a gap only as
# wide as they need, and at a chokepoint narrower still -- the rock either side
# is left standing.
CHOKEPOINTS = [
    ('wolfsnag_gap', 428, 479, 3.0),      # the X on the drawing, west of Wolfsnag Pass
    ('wolfsnag_pass', 535, 440, 2.4),     # the pass ITSELF -- see CLEAR below
    ('den_throat',   870, 812, 3.2),      # the neck of rock above the Spider Den
    ('den_mouth',    870, 860, 2.8),      # the approach right at the cave mouth
    ('grimroot_way', 1243, 279, 3.0),     # the thicket's "narrow paths"
]
ROAD_CUT, TRAIL_CUT = 3.4, 2.4            # half-width of the gap a path may cut

# --- the network ----------------------------------------------------------
# What joins to what. The route between is found, not drawn.
ROADS = [
    ('north_trail', 'chapel'), ('chapel', 'camp'), ('camp', 'wolfsnag'),
    ('wolfsnag', 'west_road'), ('camp', 'murkfen'), ('murkfen', 'east_path'),
    ('camp', 'spiderden'), ('spiderden', 'south_track'),
]
# Places in the Murkfen worth walking to. They are NOT landmarks -- they carry
# no name, no map marker and no discovery -- they exist so the router has a
# reason to lay plank walk out across the fen. Drawing spans that lead nowhere
# is what made the first boardwalk network an island; giving the fen somewhere
# to go produces the same walks as a consequence of them being useful.
#
# Every one was measured off the trace rather than picked by eye: the two
# islands are the only dry ground in the fen ringed on 10+ of 12 bearings by
# water, and the pockets are the deepest open water in it.
WAYPOINTS = {
    'fen_shrine': (1233, 472),   # island, ring 11/12 wet -- the drowned shrine
    'fen_cache':  (1159, 559),   # island, ring 10/12 wet -- the fenman's cache
    'fen_deep_e': (1313, 501),   # deep pocket, east
    'fen_deep_w': (1163, 472),   # deep pocket, west
    # Dry ground on the NORTH bank of Ravenwater's outflow. Putting it on the
    # north bank is the whole point: the pool's anchor sits on the south shore,
    # so anything routed to the south side never has to cross the water and the
    # outflow stays unbridged -- which is where the sheet draws its bridge.
    'raven_east': (686, 227),
}

TRAILS = [
    # out across the fen: two chains, so the walks reach across it rather than
    # clustering on one crossing
    ('murkfen', 'fen_shrine'), ('fen_shrine', 'fen_deep_e'),
    ('murkfen', 'fen_cache'), ('fen_cache', 'fen_deep_w'),
    ('chapel', 'grimroot'), ('grimroot', 'east_path'), ('ravenwater', 'north_trail'),
    ('ravenwater', 'wolfsnag'), ('wolfsnag', 'crowhill'), ('crowhill', 'spiderden'),
    ('murkfen', 'briar'), ('briar', 'south_track'), ('camp', 'ravenwater'),
    # Round the pool's east side and over the outflow. Every approach to
    # Ravenwater used to converge on one point on the SOUTH shore and stop, so
    # the east end -- where the Sallows comes in, the creek goes out, and the
    # sheet draws its wooden bridge -- had no reason for anyone to be there.
    ('ravenwater', 'raven_east'), ('raven_east', 'chapel'),
]


# --- what lives there -----------------------------------------------------
# Spawns are anchored to the landmarks the drawing labels, so the Thicket is
# cursed, the Briar Camp holds bandits and the Den holds spiders -- the map's
# own notes are the design brief.
# Levels are graded by how far the landmark sits from the camp, because that is
# the hierarchy the space is meant to teach: the further you walk from the fire,
# the worse it gets. The first pass scattered levels 1 to 16 around a flat ring
# -- cows at the far edge, a level 12 ogre beside a level 3 goblin -- so the
# walk out taught you nothing. Ravenwater is the exception on purpose: the
# nearest water is where a new character is safe to potter about.
# Somewhere to put a spawn that is not a landmark. Measured, not guessed: this
# patch of ground is 100% open on the trace and sits 78 units out from the camp
# centre, which clears its 40-unit safe radius with room to spare -- close
# enough to be the camp's grazing, far enough that the cows still spawn.
SPAWN_ANCHORS = {
    'cowfield': (770, 470),      # open ground west of Witchlight Camp
    'henyard':  (938, 505),      # Maggie's hens, 52 units east of the camp
    # The walk BETWEEN landmarks was empty. Measured: nine hundred-metre cells
    # of fully walkable ground with nothing in them at all, each 76 to 129
    # units from the nearest landmark -- the zone was dense islands with dead
    # ground in between. These nine anchors sit on open ground 22 to 49 units
    # off a path, so what lives there is on the way rather than hidden.
    'wood_north':  (793, 139),   # the north woods, chapel to Ravenwater
    'wood_grim_w': (1018, 214),  # deep forest west of Grimroot
    'wood_grim_e': (1151, 214),  # the cursed edge
    'wood_mid_e':  (1018, 294),  # between chapel, Grimroot and the fen
    'road_west':   (713, 374),   # the camp road, out toward Wolfsnag
    'west_gate':   (349, 508),   # the last of the woods before the West Road
    'wood_crow_n': (456, 642),   # the climb to Crow Hill
    'wood_crow_s': (590, 775),   # south of Crow Hill, toward the Den
    'south_road':  (1114, 749),  # the South Track, past Briar
}

SPAWNS = [
    # (poi | spawn anchor, type, level, count, radius, roam)
    ('grimroot',     'venom_spider',13, 7, 42, 26),
    ('grimroot',   'goblin_shaman',15, 3, 38, 20),
    ('briar',           'bandit', 9, 6, 32, 22),
    ('briar',   'goblin_warrior',10, 4, 30, 18),
    ('briar',    'goblin_archer',10, 3, 30, 18),
    # Chief Rattlecap asks you to kill eight warriors and two "goblin brutes"
    # before you get to him -- and the only goblin_chief in the zone WAS him,
    # so the line meant killing the same named elite twice and waiting out his
    # respawn to do it. Brutes are ordinary mobs: two of them, guarding him.
    ('briar',    'goblin_chief', 12, 2, 22, 12),
    # the hollow outside the mouth: what has come up out of it, not the den
    ('spiderden',           'spider', 8, 5, 34, 24),
    ('spiderden',     'venom_spider',10, 2, 30, 20),
    ('murkfen', 'goblin_scavenger', 5, 7, 50, 30),
    ('murkfen',           'spider', 6, 4, 46, 26),
    ('wolfsnag',           'guard', 9, 3, 34, 20),
    ('wolfsnag',           'goblin', 6, 6, 36, 24),
    ('wolfsnag',     'goblin_miner', 7, 5, 38, 22),
    ('chapel',              'bat', 3, 6, 30, 22),
    ('chapel',           'spider', 4, 3, 28, 18),
    ('crowhill',    'goblin_archer',11, 4, 34, 22),
    ('crowhill',           'goblin', 9, 5, 34, 22),   # a lookout needs a garrison
    # Ravenwater was the one named landmark in the zone with nothing in it at
    # all: no mob, no elite, a chest and two fishing spots. Its own sheet calls
    # it a haunted pool whose deep water "conceals hidden secrets", and the
    # cows that used to graze it have gone to the camp's pasture where they
    # belong. Bats over the water, spiders in the dead trees round the shore.
    ('ravenwater',            'bat', 5, 7, 44, 26),
    ('ravenwater',         'spider', 6, 5, 42, 22),
    ('chapel',                'bat', 4, 4, 30, 22),   # more of them in the nave
    # The cows used to graze Ravenwater Pool, which its own sheet calls "deep
    # waters, darker secrets" -- and no livestock appears anywhere in the zone
    # blueprint. They are quest fauna (a quest wants cow hide), so they move to
    # open ground east of Witchlight Camp rather than being cut: far enough out
    # of the camp that they still spawn and are still killable.
    ('cowfield',               'cow', 1, 5, 30, 22),
    # Maggie's hens. Two level-1 quests -- her henhouse and Alric's Feathers and
    # Hide, the first quest in his chain -- ask for Eggs and Feathers, and those
    # drop from ONE creature: the chicken. Not one had ever spawned in this
    # zone, so both quests were unfinishable from the day the world was rebuilt.
    ('henyard',            'chicken', 1, 7, 22, 14),
    # --- the roads between places ---------------------------------------
    ('wood_north',             'bat', 4, 5, 34, 26),
    ('wood_north',          'spider', 5, 4, 32, 22),
    ('wood_grim_w',         'spider', 8, 5, 34, 24),
    ('wood_grim_e',   'venom_spider',12, 5, 34, 24),
    ('wood_mid_e', 'goblin_scavenger',6, 5, 34, 26),
    ('road_west',           'bandit', 8, 4, 32, 24),   # highwaymen on the camp road
    ('west_gate',           'goblin', 7, 5, 34, 26),
    ('wood_crow_n',          'guard',10, 2, 30, 20),   # hill ogres on the climb
    ('wood_crow_s',   'goblin_archer',10, 4, 32, 24),
    ('south_road',          'bandit',10, 5, 34, 26),
]

# Scatter: `near` anchors a spec to a landmark, otherwise it is spread over the
# whole zone and rejection-sampled against everything already down.
SCATTER = [
    # zone-wide woodland floor
    ('Normal_Bush', 150, None, 0), ('Berry_Bush', 70, None, 0),
    ('Dark_Fern', 130, None, 0), ('Green_Fern', 130, None, 0),
    ('Hollow_Stump', 55, None, 0), ('Exposed_Roots', 60, None, 0),
    ('Dead_Bush', 60, None, 0), ('Poison_Mushrooms', 45, None, 0),
    ('Wildflower_Patch', 90, None, 0), ('Meadow_Grass', 120, None, 0),
    ('Thorn_Bush', 70, None, 0), ('Darkroot_Bush', 55, None, 0),
    ('Hosta_Plant', 50, None, 0), ('Foxglove_Clump', 40, None, 0),
    ('Blackberry_Bramble', 45, None, 0), ('Twisted_Dead_Tree', 35, None, 0),
    # --- the shaded understorey -----------------------------------------
    # Twenty plant models were in the library and not one placement used them,
    # so the Dark Woods was dressed out of the same eight species everywhere.
    # These are sorted by the light they want rather than sprinkled: what grows
    # under a closed canopy is not what grows in a clearing, and the blueprint
    # already traced which is which.
    ('Broadleaf_Plant', 85, None, 0),          # big soft leaves, deep shade
    ('Creeping_Bellflowers', 60, None, 0),     # shaded banks
    ('Blue_Hydrangea', 34, None, 0),           # damp shade
    # --- the clearings, which want light --------------------------------
    ('Poppy_Patch', 60, None, 0, 'open'),
    ('Goldenrod_Patch', 50, None, 0, 'open'),
    ('Meadow_Shrub', 48, None, 0, 'open'),
    ('Strawberry_Patch', 38, None, 0, 'open'),  # woodland edge, in the light
    ('Flowering_Bush', 44, None, 0, 'open'),
    # The only two assets in the library that would look wrong standing still,
    # so the client drifts them (see FLYERS / updateFlyers). Butterflies belong
    # over the flowers in the light; moths belong under the canopy, which is
    # the whole difference between the two and the reason they are two specs.
    ('Butterfly', 70, None, 0, 'open'),
    ('Moth', 55, None, 0),
    # Grimroot Thicket: the drawing paints it purple and calls it cursed
    ('Twisted_Dead_Tree', 22, 'grimroot', 40), ('Poison_Mushrooms', 26, 'grimroot', 38),
    ('Darkroot_Bush', 24, 'grimroot', 40), ('Bone_Pile', 8, 'grimroot', 34),
    # Murkfen and Ravenwater: reeds and sedge at the waterline
    ('Pond_Reeds', 60, 'murkfen', 54), ('Meadow_Sedge', 55, 'murkfen', 54),
    ('Pond_Reeds', 34, 'ravenwater', 48),
    # Fallen Chapel: bones and dead ground
    ('Bone_Pile', 10, 'chapel', 26), ('Dead_Bush', 18, 'chapel', 28),
    # Witchlight Camp is LAID OUT, not scattered -- see camp_layout(). What is
    # left here is only the ground cover its plan does not place by hand.
    ('Clover_Patch', 22, 'camp', 26), ('Meadow_Grass', 30, 'camp', 28),
    # Briar Camp is laid out too -- see briar_layout().
    ('Dead_Bush', 14, 'briar', 28), ('Meadow_Grass', 20, 'briar', 28),
    # --- from the location concept sheets ---------------------------------
    # Ravenwater Pool: "twisted, dead trees rise from the water", a shore of
    # scattered rocks, and roots and stumps at the margin. The dead trees are
    # the sheet's headline image, so they are allowed to stand IN the water --
    # see WADERS in server.js, which otherwise pulls dressing back onto land.
    ('Twisted_Dead_Tree', 20, 'ravenwater', 44),
    # its sheet's key props, rather than the cave kit's grey boulders standing in
    # for them: spires out in the water, mossy boulders and logs on the shore,
    # lily pads on the surface
    ('Rock_Spire', 9, 'ravenwater', 42), ('Lily_Pads', 22, 'ravenwater', 43),
    # ON THE BANK, not scattered through the pool -- see `shore` in worldgen.js
    ('Mossy_Boulder', 14, 'ravenwater', 54, True),
    ('Fallen_Log', 8, 'ravenwater', 54, True),
    ('Hollow_Stump', 9, 'ravenwater', 54, True),
    ('Exposed_Roots', 14, 'ravenwater', 54, True),
    ('Weeping_Willow', 8, 'ravenwater', 56, True),
    ('Meadow_Sedge', 26, 'ravenwater', 48),
    # Fallen Chapel: fallen stone around the nave, dead trees crowding it, and
    # a lantern on the west approach the way the sheet draws it.
    ('Ruin_Rubble', 14, 'chapel', 26), ('Ruin_Column', 6, 'chapel', 26),
    ('Twisted_Dead_Tree', 10, 'chapel', 28), ('Path_Lantern', 4, 'chapel', 28),
    # The graveyard. Half the chapel sheet is gravestones and there was not one
    # in the game -- the hilltop clearing was an empty lawn around a ruin.
    # Same capacity arithmetic as the pass and the den mouth: inside 27 units
    # of the chapel, once its own footprint is taken out, there is room for
    # about forty stones and these asked for a hundred and sixteen. Seven of
    # the twenty-four slabs were being dropped. A churchyard that outgrew its
    # wall is the right answer here -- the graves spread out under the trees.
    ('Gravestone_Slab', 24, 'chapel', 38), ('Gravestone_Cross', 13, 'chapel', 36),
    ('Gravestone_Broken', 11, 'chapel', 40), ('Tomb_Slab', 4, 'chapel', 30),
    ('Gravestone_Tall', 2, 'chapel', 24),
    # Grimroot Thicket: the sheet's "corruption growth" is a magic source, and
    # the cave kit's crystals are exactly that. Roots as the obstacle layer,
    # thorns as the chokepoint layer -- its elevation guide names both.
    ('Violet_Crystals', 16, 'grimroot', 36), ('Teal_Crystals', 6, 'grimroot', 34),
    ('Exposed_Roots', 26, 'grimroot', 38), ('Thorn_Bush', 22, 'grimroot', 38),
    # Wolfsnag Pass had NOTHING on it -- a named chokepoint dressed as empty
    # rock. The sheet gives it spiked barricades, bones and a warning at the
    # mouth: wild territory somebody has already tried to hold.
    # ...and then it had a tenth of it, because the pass is a DEFILE. Only
    # 581 m2 within 28 units of it is standable -- room for about sixteen solid
    # pieces, against the sixty these asked for -- so the barricades placed 3 of
    # 10 and nobody was told. The dressing belongs on the APPROACHES anyway: you
    # meet the warning sign and the barricades on the way in, not stacked in a
    # four-metre gap where they would wall the road.
    ('Banner_Wolf', 5, 'wolfsnag', 44),          # whose territory this is
    ('Spike_Barricade', 10, 'wolfsnag', 52), ('Bone_Pile', 6, 'wolfsnag', 46),
    ('Warning_Sign', 2, 'wolfsnag', 40), ('Dead_Bush', 12, 'wolfsnag', 50),
    ('Rubble_Pile', 8, 'wolfsnag', 48),
    # Murkfen: dead trees standing in the marsh, rotted pilings where a walk
    # has gone, and lanterns along the ones that remain.
    ('Twisted_Dead_Tree', 24, 'murkfen', 50), ('Boardwalk_Piling', 12, 'murkfen', 50),
    ('Path_Lantern', 7, 'murkfen', 48), ('Lily_Pads', 14, 'murkfen', 48),
    # Witchlight Camp: the sheet draws a wagon and bedrolls in the tents.

    ('Camp_Lantern', 4, 'briar', 24),
    # --- plants that belong to a PLACE rather than to a habitat ----------
    # A churchyard keeps its planting long after the roof goes. Roses gone
    # feral over the graves and box hedging that has not been cut in a century
    # say "somebody tended this" louder than another fern would.
    ('Rose_Bush', 12, 'chapel', 34), ('Round_Box_Bush', 9, 'chapel', 30),
    # Witchlight Camp is lived in: a herb bed by the fire and a hedge along the
    # line Bram Holt keeps complaining about mending.
    ('Lavender_Clump', 9, 'camp', 26), ('Sage_Bush', 8, 'camp', 26),
    ('Tall_Hedgerow', 16, 'camp', 34), ('Round_Box_Bush', 5, 'camp', 24),
    # Heather takes the thin poor soil nothing else wants -- the exposed
    # ground on the hill and in the pass, which is most of what is up there.
    ('Heather_Clump', 34, 'crowhill', 46), ('Heather_Clump', 26, 'wolfsnag', 48),
    # Crow Hill: rail fences along the ascent path and fallen stone on the crown.
    ('Rough_Fence', 14, 'crowhill', 30), ('Ruin_Rubble', 10, 'crowhill', 28),
    ('Banner_Crow', 3, 'crowhill', 26),
    # Crow Hill and the Den
    ('Warning_Sign', 3, 'crowhill', 30), ('Bone_Pile', 7, 'spiderden', 24),
    # The Spider Den. The descent only pays off if there is something down
    # there: webs thicken and the nests appear as you reach the floor of the
    # hollow, so the bottom reads as inhabited rather than as a dip in a field.
    # These radii are not a style choice, they are capacity. The mouth is 58%
    # cliff, and the disc these used to share held about 111 pieces of dressing
    # at the 3 m spacing the scatterer enforces -- while the specs below asked
    # for 134. Rejection sampling gives up after count x 40 tries, so whatever
    # sampled last simply got nothing and said nothing about it: Floor_Web
    # placed 2 of 16, Webbed_Bones 1 of 8 and the ten Luminous_Mushrooms placed
    # NONE. So the webbing spreads out from the entrance instead of ringing it,
    # which is what an approach should look like anyway: thick at the mouth,
    # thinning into the wood. The nests and egg clusters stay close in.
    ('Floor_Web', 16, 'spiderden', 46), ('Funnel_Web', 9, 'spiderden', 40),
    ('Ground_Cocoon', 7, 'spiderden', 32), ('Hanging_Cocoon', 6, 'spiderden', 28),
    ('Egg_Cluster', 6, 'spiderden', 24), ('Brood_Nest', 4, 'spiderden', 20),
    ('Layered_Web_Nest', 3, 'spiderden', 18), ('Webbed_Bones', 8, 'spiderden', 38),
    ('Webbed_Boulder', 7, 'spiderden', 42), ('Broken_Web_Strands', 11, 'spiderden', 50),
    ('Stalagmite_Cluster', 9, 'spiderden', 44), ('Stalagmite_Large', 6, 'spiderden', 40),
    ('Luminous_Mushrooms', 10, 'spiderden', 44), ('Rubble_Pile', 8, 'spiderden', 48),
    ('Dead_Bush', 14, 'spiderden', 52),
]

# Pieces placed by hand rather than scattered: things whose exact spot and
# facing matter. The Spider Den's mouth is the one bit of Hero-Cycle
# architecture the zone can have today without new art -- Rock_Arch already
# exists in the cave pack, and set into the north wall of the hollow it reads as
# the way down. (px, py, model, yaw, scale, collision radius)
PROPS = [
    # The Central Grimroot. Its sheet marks it "Landmark Tree" and builds the
    # whole thicket around it, so it is placed by hand at the POI rather than
    # scattered, and it is big enough to navigate by.
    (1243, 279, 'Magic_Tree', 0.0, 2.8, 2.4),
    # The Murkfen sheet stands two watchtowers over the marsh -- one at the west
    # approach, one on the east side -- and Briar Camp's layout plan puts the
    # same structure at its gate as a Watch Post. Placed by hand, because a
    # landmark somebody built belongs where they built it, not wherever the
    # scatter seed drops it.
    (1152, 692, 'Stilt_Watchtower', 1.1, 1.0, 1.9),   # Briar Camp's watch post
    # Crow Hill's watchfire, on the overlook east of the tower rather than
    # inside it -- the sheet draws the brazier out on the open platform.
    (566, 694, 'Brazier', 0.0, 1.0, 0.9),
    (870, 830, 'Rock_Arch', 0.0, 2.6, 0),        # the den mouth, facing into the bowl
    (852, 836, 'Wall_Boulder_Tall', 0.6, 1.8, 1.4),
    (890, 834, 'Wall_Boulder_Tall', 2.3, 1.6, 1.4),
    (861, 845, 'Wall_Boulder_Wide', 1.1, 1.5, 1.6),
    (881, 847, 'Rubble_Pile', 2.9, 1.3, 0),
]

# Structures, assembled from the modular ruin kit (tools/build_ruin_kit.py) on
# its 4 m grid. A layout is a list of pieces in the structure's own space:
#   (model, dx, dy, dz, yaw, wall, gap)
# `wall` is the length of collision the piece contributes (0 = you walk through
# it), `gap` a doorway at its middle. Only pieces at dy == 0 collide -- an upper
# course of a tower is something you look at, not something you bump into.
U = 4.0          # the grid unit the kit is built to


# ---------------------------------------------------------------- the camps
# Both camp sheets ship a top-down LAYOUT PLAN, and a plan is the one thing
# random scatter can never produce: tents facing the fire, stalls along the
# path, a palisade with a gate in it rather than a fence with holes. Scattering
# the camps gave two rings of furniture at random bearings. These lay them out.
#
# Offsets are METRES from the POI, +Z south. A prop's yaw of 0 faces -Z.
# Returns (model, dx, dz, yaw, scale, collide).

def _ring(model, n, r, y0=0.0, yaw_out=True, scale=1.0, coll=0.0, width=None):
    """Copies evenly around a circle of radius r. `yaw_out` turns each piece to
    face outward along the radius; otherwise it lies TANGENT, which is what a
    fence panel or a barricade has to do or the ring reads as a starburst.

    Pass `width` (the model's real footprint along its length) and the count is
    worked out so the panels ABUT. The first pass spaced twenty fence panels
    round a 20 m ring -- 6.3 m apart, and the panel is 1.96 m wide, so the
    'palisade' was two thirds fresh air and you could stroll between any two of
    them. A fence is only a fence if it closes."""
    if width:
        n = max(3, int(math.ceil(math.tau * r / (width * 0.95))))
    out = []
    for i in range(n):
        a = y0 + i / n * math.tau
        dx, dz = math.cos(a) * r, math.sin(a) * r
        yaw = -a if yaw_out else -(a + math.pi / 2)
        out.append((model, round(dx, 2), round(dz, 2), round(yaw, 3), scale, coll))
    return out


# --- the farmyards ----------------------------------------------------------
# A yard is a SQUARE. It was a ring, because _ring was to hand, and a circular
# chicken run is not a thing anyone has ever built.
#
# And a fence is a WALL, not a row of bollards. Every panel carried its own
# collision circle, and circles in a row do not stop you: standing between two
# of them the two pushes point along the row in opposite directions, cancel,
# and you walk straight through the fence. That is why it could be crossed at
# any point. The panels you see and the wall you bump into now come out of one
# description, below, and the wall is a real segment.
# Which way a piece of the farm kit FACES. Measured in the game, not assumed:
# the raised coop's ramp and the walk-in house's door both come out on the
# model's local +Z, where every CHARACTER model in the library faces -Z. Taking
# the character convention put every coop's door against the fence, which is
# what "the houses are facing the wrong way" meant. three.js rotation.y by t
# sends local +Z to (sin t, cos t), so yaw pi faces world -Z.
FACE_N, FACE_E, FACE_S, FACE_W = math.pi, math.pi / 2, 0.0, -math.pi / 2
YARD_FENCE = {
    'henyard':  {'hw': 13.0, 'hd': 11.5, 'gate': 'north', 'gatew': 3.8},
    'cowfield': {'hw': 17.5, 'hd': 14.0, 'gate': 'north', 'gatew': 3.8},
}
# The four sides, anticlockwise from the north-west corner, as (x0, z0, x1, z1).
def _fence_sides(spec):
    hw, hd = spec['hw'], spec['hd']
    return {'north': (-hw, -hd,  hw, -hd),
            'east':  ( hw, -hd,  hw,  hd),
            'south': ( hw,  hd, -hw,  hd),
            'west':  (-hw,  hd, -hw, -hd)}

def _rect_fence(spec, model='Farm_Fence', gate='Farm_Gate', width=2.0, scale=1.0):
    """Panels abutting along the four sides, and the gate standing in the hole.

    A panel's length runs along its own local +X, and three.js rotation.y by t
    sends local +X to (cos t, -sin t) -- so a run along world +X is yaw 0 and a
    run along world +Z is yaw -pi/2. Getting that sign wrong is what turns a
    fence into a starburst.
    """
    out = []
    step = width * 0.98
    gx, gz = _gate_point(spec)
    for name, (x0, z0, x1, z1) in _fence_sides(spec).items():
        L = math.hypot(x1 - x0, z1 - z0)
        yaw = 0.0 if abs(z1 - z0) < 1e-6 else -math.pi / 2
        n = max(1, int(round(L / step)))
        for i in range(n):
            t = (i + 0.5) / n
            px, pz = x0 + (x1 - x0) * t, z0 + (z1 - z0) * t
            # the gate is a HOLE: nothing else stands in it
            if math.hypot(px - gx, pz - gz) < spec['gatew'] / 2:
                continue
            out.append((model, round(px, 2), round(pz, 2), yaw, scale, 0.0))
    gyaw = 0.0 if spec['gate'] in ('north', 'south') else -math.pi / 2
    out.append((gate, round(gx, 2), round(gz, 2), gyaw, scale, 0.0))
    return out

def _gate_point(spec):
    x0, z0, x1, z1 = _fence_sides(spec)[spec['gate']]
    return ((x0 + x1) / 2, (z0 + z1) / 2)


def camp_layout():
    """Witchlight Camp. Its plan puts the fire in the middle with seating round
    it, the big trader's tent behind it, market stalls down the west side where
    the Wolfsnag road comes in, and stores to the east toward the Murkfen
    bridge. The palisade is a broken ring: the sheet's three paths leave through
    three gaps, which is why the fence skips those bearings."""
    p = []
    # the central fire (cf_camp lights it) with stools drawn up around it
    p += _ring('Camp_Stool', 6, 3.4, y0=0.3)
    p.append(('Cooking_Tripod', 2.6, 2.2, 0.4, 1.0, 0.0))
    # the trader's hall, north of the fire and facing it, flanked by its banners
    p.append(('Supply_Pavilion', 0.0, -10.5, math.pi, 2.0, 2.6))   # the trader's hall
    p.append(('Banner_Moon', -4.2, -12.0, 0.0, 1.0, 0.5))
    p.append(('Banner_Moon', 4.2, -12.0, 0.0, 1.0, 0.5))
    # sleeping tents, all turned in toward the fire
    for dx, dz in ((-9.5, -6.5), (9.5, -6.5), (-12.0, 2.0), (11.5, 2.5), (6.5, 9.0)):
        p.append(('Small_Canvas_Tent', dx, dz, math.atan2(-dx, -dz), 1.0, 1.7))
        p.append(('Rolled_Bedroll', dx * 0.86, dz * 0.86, 0.0, 1.0, 0.0))
    # market stalls down the west side, facing the road they trade with
    for dz in (-4.0, 1.5, 7.0):
        p.append(('Market_Stall', -15.5, dz, math.pi / 2, 1.0, 1.6))
    p.append(('Farm_Handcart', -17.0, -8.5, 0.9, 1.0, 1.1))
    # stores to the east, toward the Murkfen bridge
    for i, (dx, dz) in enumerate(((13.5, -2.0), (15.0, -4.2), (12.5, -5.6),
                                  (14.2, 6.0), (16.0, 3.4))):
        p.append(('Supply_Crate', dx, dz, 0.4 * i, 1.0, 0.7))
    for dx, dz in ((10.5, -9.0), (16.5, 0.5), (-13.5, -2.0)):
        p.append(('Water_Barrel', dx, dz, 0.0, 1.0, 0.6))
    # lanterns on the perimeter, and the palisade with its three gateways:
    # west to Wolfsnag, east to the Murkfen bridge, south to the river
    p += _ring('Camp_Lantern', 8, 17.5, y0=0.4)
    # A closed ring: the gateways are cut afterwards, where the roads really are.
    p += _ring('Rough_Fence', 0, 20.0, yaw_out=False, coll=0.4, width=1.96)
    return p


def briar_layout():
    """Briar Camp. Its plan is a ring of hide tents round a fire inside a spiked
    palisade, with the gate on the WEST where the Crow Hill path arrives -- the
    sheet draws the skull over that gate, so the totem stands beside it."""
    p = []
    p += _ring('Goblin_Hide_Tent', 5, 9.5, y0=0.5, yaw_out=False, coll=1.8)
    p += _ring('Bone_Pile', 4, 6.0, y0=1.1)
    p.append(('Unlit_Fire_Pit', -3.2, 4.4, 0.0, 1.0, 0.0))       # a second, cold fire
    # the gate: totem and banners either side of the western gap
    p.append(('Goblin_Totem', -14.5, -2.6, 0.2, 1.0, 0.9))
    p.append(('Goblin_Totem', -14.5, 2.6, -0.2, 1.0, 0.9))
    for dx, dz in ((-11.0, -6.5), (-11.0, 6.5), (8.0, -9.5), (9.5, 7.0)):
        p.append(('Goblin_Banner', dx, dz, math.atan2(-dx, -dz), 1.0, 0.5))
    for i, (dx, dz) in enumerate(((6.5, 2.5), (8.0, 4.2), (5.2, 5.4), (10.5, -3.0))):
        p.append(('Supply_Crate', dx, dz, 0.5 * i, 1.0, 0.7))
    # the spiked palisade, open only at the west gate
    p += _ring('Spike_Barricade', 0, 15.0, yaw_out=False, coll=0.5, width=2.0)
    return p


def henyard_layout():
    """Maggie Byrne's hen yard.

    A whole farm kit -- twenty-two models -- sat in client/models/farm and not
    one placement used any of it, while seven hens I had just put in the world
    pecked at bare grass fifty metres from a camp whose poultry-keeper's only
    line is "Something has been at the birds again". A hen yard is a coop, a
    run, feeders, nesting boxes and a fence with a gate in it; that is what the
    kit is for and what the NPC is talking about.

    Footprints measured off the GLBs, not guessed: the fence panel is 2.00 m
    wide, which is what closes the ring.
    """
    p = []
    # A square yard with a gate in the north side, where the camp road comes in.
    p += _rect_fence(YARD_FENCE['henyard'])
    # The housing stands along the BACK (south) fence out of the wind, squared
    # up to it and facing in across the yard. They used to be set at loose
    # angles along the same wall with their doors to the fence, which is what
    # "the houses are facing the wrong way" means: a coop opens onto its run.
    p += [('Walk_In_Chicken_House', -6.4, 8.6, FACE_N, 1.0, 1.3),
          ('Raised_Chicken_Coop', 1.6, 9.2, FACE_N, 1.0, 0.9),
          ('Covered_Chicken_Run', 8.2, 8.4, FACE_N, 1.0, 1.0),
          ('Nesting_Boxes', -11.0, 3.0, FACE_E, 1.0, 0.8),
          ('Chicken_Cage', -2.6, 10.6, FACE_N, 1.0, 0.0)]
    # feed and water where the birds actually stand
    p += [('Chicken_Feeder', -2.6, 1.2, 0.0, 1.0, 0.0),
          ('Chicken_Feeder', 4.4, -1.8, 0.7, 1.0, 0.0),
          ('Chicken_Waterer', -0.4, -3.2, 0.0, 1.0, 0.0),
          ('Chicken_Waterer', 6.2, 2.6, 1.1, 1.0, 0.0),
          ('Grain_Barrel', -7.6, -1.0, 0.0, 1.0, 0.5),
          ('Grain_Sack', -8.4, 0.6, 0.4, 1.0, 0.0),
          ('Grain_Sack', -7.0, 1.4, 2.1, 1.0, 0.0),
          ('Egg_Basket', -9.0, 3.4, 0.0, 1.0, 0.0),
          ('Egg_Basket', 3.0, 7.8, 0.9, 1.0, 0.0)]
    # the work of the place, left where it was put down
    p += [('Wheelbarrow', 8.4, -3.0, 2.4, 1.0, 0.5),
          ('Pitchfork', -6.2, -5.4, 0.3, 1.0, 0.0),
          ('Vegetable_Crate', 9.0, -6.0, 0.6, 1.0, 0.0),
          ('Vegetable_Crate', 9.8, -4.8, 1.9, 1.0, 0.0),
          ('Hay_Pile', -9.6, -6.2, 0.0, 1.0, 0.7),
          ('Square_Hay_Bale', 5.6, -7.6, 0.4, 1.0, 0.4),
          # and the thing that watches the wood, which is the point of the yard
          ('Scarecrow', 0.6, -9.6, 0.0, 1.0, 0.4)]
    return p


def cowfield_layout():
    """The clearing west of the camp where the cattle are.

    Bram Holt's one line is that fences do not mend themselves. Here are the
    fences. A byre needs troughs, hay and a way in; the cows had none of it.
    """
    p = []
    p += _rect_fence(YARD_FENCE['cowfield'])
    p += [('Water_Trough', -6.0, 4.0, 0.0, 1.0, 0.6),
          ('Water_Trough', 7.4, -2.2, 1.57, 1.0, 0.6),
          ('Feeding_Trough', -2.0, -6.4, 0.0, 1.0, 0.6),
          ('Feeding_Trough', 4.6, 6.8, 0.9, 1.0, 0.6)]
    # a winter's hay, stacked against the fence
    p += [('Tall_Haystack', -11.0, -8.0, 0.0, 1.0, 1.0),
          ('Stacked_Hay_Bales', -12.4, -4.6, 0.3, 1.0, 0.8),
          ('Round_Hay_Bale', -10.0, -2.0, 0.0, 1.0, 0.6),
          ('Round_Hay_Bale', -12.0, -0.4, 1.2, 1.0, 0.6),
          ('Square_Hay_Bale', 9.6, 7.4, 0.5, 1.0, 0.4),
          ('Hay_Pile', 10.6, 4.2, 0.0, 1.0, 0.7),
          ('Pitchfork', -9.2, -6.2, 2.8, 1.0, 0.0),
          ('Wheelbarrow', 11.0, -6.6, 1.1, 1.0, 0.5),
          ('Grain_Barrel', 8.0, 9.4, 0.0, 1.0, 0.5),
          ('Vegetable_Crate', 6.8, 10.2, 0.8, 1.0, 0.0)]
    return p


LAYOUTS = [('camp', camp_layout), ('briar', briar_layout),
           ('henyard', henyard_layout), ('cowfield', cowfield_layout)]

# A yard fronts ONTO the road; it is not bisected by one. Anchored on where the
# animals were put, the hen yard's centre came out 7.2 m from a road and the
# cow field's 12.9 m, against ring radii of 13 and 17 -- so both roads ran
# straight through the middle and the path-clearing rule quietly deleted the
# coop, the run and the nesting boxes, which is the entire point of a hen yard.
#
# So the yard is not authored facing anywhere. It is pushed off the road until
# its fence clears, and turned so the GATE is the side the road is on. Which
# road, and which way, is measured at build time.
#   key -> (ring radius, how far clear of the road the fence should stand)
ROAD_FACING = {'henyard': (13.0, 5.0), 'cowfield': (17.0, 5.0)}


def chapel_layout():
    """The Fallen Chapel, rebuilt to its concept sheet.

    A three-bay nave twenty metres long, standing at the EAST -- where the great
    traceried window still holds its full height -- and fallen away westward.
    The south flank keeps its lancets and its arched door; the north flank is
    down, and what is left of its arcade stands free in the gap, which is the
    image the sheet leads on: "broken arches rise from moss-covered stones".

    The first version of this was the generic ruin kit -- flat lintels, square
    windows, a plain gable. It was a shed. Everything here that reads as a
    chapel is a POINTED arch, and there is no approximating that with a box.
    """
    p = []
    hx, hz = 1.5 * U, 2.5 * U                     # half-width 6 m, half-length 10 m
    xs = (-U, 0.0, U)                             # three bays across
    zs = (-2 * U, -U, 0.0, U, 2 * U)              # five bays along

    # --- the east end: the one wall still standing, and the window in it -----
    p.append(('Ruin_Lancet', -U, 0, -hz, 0, U, 0))
    p.append(('Ruin_East_Window', 0.0, 0, -hz, 0, U, 0))
    p.append(('Ruin_Lancet', U, 0, -hz, 0, U, 0))

    # --- the west end: collapsed, and the way in is through the breach -------
    for x in (-U, U):
        p.append(('Ruin_Wall_Low', x, 0, hz, 0, U, 0))
    p.append(('Ruin_Rubble', -0.6, 0, hz - 1.0, 0.4, 0, 0))
    p.append(('Ruin_Rubble', 1.1, 0, hz - 1.9, 2.1, 0, 0))
    # the sheet's west approach climbs to the chapel, so it arrives at a stair
    p.append(('Ruin_Steps_Wide', 0.0, 0, hz + 2.2, 0, 0, 0))

    # --- the south flank: intact, stepping down westward ---------------------
    south = ['Ruin_Lancet', 'Ruin_Rose', 'Ruin_Door_Arch', 'Ruin_Wall_Half', 'Ruin_Wall_Low']
    for z, m in zip(zs, south):
        gap = 1.9 if m == 'Ruin_Door_Arch' else 0
        p.append((m, hx, 0, z, math.pi / 2, U, gap))

    # --- the north flank: down, with its arcade left standing in the gaps ----
    north = ['Ruin_Lancet', 'Ruin_Wall_Half', None, None, 'Ruin_Wall_Low']
    for z, m in zip(zs, north):
        if m is None:
            p.append(('Ruin_Arcade', -hx, 0, z, math.pi / 2, 0, 0))
            p.append(('Ruin_Rubble', -hx + 1.3, 0, z + 1.4, 1.1, 0, 0))
            continue
        p.append((m, -hx, 0, z, math.pi / 2, U, 0))

    # --- buttresses at the bay joints, outside both flanks -------------------
    for z in (-1.5 * U, -0.5 * U, 0.5 * U):
        p.append(('Ruin_Buttress', hx + 0.42, 0, z, math.pi / 2, 0, 0))
    for z in (-1.5 * U, -0.5 * U):
        p.append(('Ruin_Buttress', -hx - 0.42, 0, z, -math.pi / 2, 0, 0))

    # --- inside: paving, the nave piers, the altar ---------------------------
    for x in xs:
        for z in zs:
            p.append(('Ruin_Floor', x, 0, z, 0, 0, 0))
    for z in (-U, 0.0, U):
        for x in (-U * 0.66, U * 0.66):
            p.append(('Ruin_Pier', x, 0, z, 0, 0.9, 0))
    p.append(('Ruin_Altar', 0, 0.3, -hz + 2.4, 0, 0, 0))
    p.append(('Ruin_Rubble', -1.9, 0, 1.6, 2.2, 0, 0))
    p.append(('Ruin_Rubble', 2.2, 0, -2.4, 0.7, 0, 0))
    return p


def tower_layout():
    """Crow Hill's lookout, rebuilt to its concept sheet.

    Two stone storeys with arrow slits, then it changes material: an
    OVERHANGING timber gallery and a pitched shingle roof, with the crow
    banners hung on the face you see from the ascent. That change from stone to
    timber is the whole silhouette on the sheet, and the old version -- three
    courses of stone with the top one broken -- read as a chimney.
    """
    p = []
    h = U                                          # 8 m across
    offs = (-U / 2, U / 2)
    STONE_H = 5.0
    sides = [(0, -h, 0), (0, h, 0), (-h, 0, math.pi / 2), (h, 0, math.pi / 2)]

    for ci, y in enumerate((0.0, STONE_H)):
        for si, (sx, sz, yaw) in enumerate(sides):
            for oi, o in enumerate(offs):
                dx = sx + (o if yaw == 0 else 0)
                dz = sz + (0 if yaw == 0 else o)
                # the way in: south face, ground course, first bay
                if ci == 0 and si == 1 and oi == 0:
                    m, gap = 'Tower_Door', 1.7
                elif (si + oi + ci) % 2 == 0:
                    m, gap = 'Tower_Slit', 0
                else:
                    m, gap = 'Ruin_Wall', 0
                p.append((m, dx, y, dz, yaw, U if ci == 0 else 0, gap))

    # the timber storey and its roof, sitting on the stone
    p.append(('Tower_Gallery', 0, 2 * STONE_H, 0, 0, 0, 0))
    p.append(('Tower_Roof', 0, 2 * STONE_H + 2.95, 0, 0, 0, 0))

    # the crow banners, on the south face the ascent path arrives at
    for sx in (-1, 1):
        p.append(('Banner_Crow', sx * 2.3, 0, h + 0.55, math.pi, 0, 0))

    for x in offs:
        for z in offs:
            p.append(('Ruin_Floor', x, 0, z, 0, 0, 0))
    # The stair lands on the DOOR, not on the middle of the south wall -- the
    # doorway is the first bay, one half-unit west of centre.
    p.append(('Ruin_Stair', -U / 2, 0, h + 2.0, math.pi, 0, 0))
    # the overlook: a low ruined wall curving out east of the tower, which is
    # where its sheet puts the watchfire platform
    for i in range(5):
        a = -0.55 + i * 0.30
        p.append(('Ruin_Wall_Low', math.cos(a) * (h + 5.5), 0, math.sin(a) * (h + 5.5),
                  -(a + math.pi / 2), U, 0))
    p.append(('Ruin_Rubble', -h - 1.4, 0, -h - 0.8, 0.9, 0, 0))
    return p


def fen_shrine_layout():
    """A drowned shrine on the fen's north island. Small, low and broken -- the
    Murkfen sheet's legend carries "Ruins / Debris" and its east view promises
    "ruined structures" out in the water, and this is the thing at the end of
    the longest plank walk.

    It takes NO levelling pad. A pad would pull the surrounding marsh up to the
    island's height and drain a ring round the shrine; without one the pieces
    sit at the island's own level and the outer ones stand in the water, which
    is the whole idea.
    """
    p = []
    # three low walls in an L, open to the walk that arrives from the west
    for dz in (-U / 2, U / 2):
        p.append(('Ruin_Wall_Low', U * 0.8, 0, dz, math.pi / 2, U, 0))
    p.append(('Ruin_Wall_Low', 0.0, 0, -U, 0, U, 0))
    p.append(('Ruin_Arch', 0.0, 0, U * 0.9, 0, 0, 0))          # the threshold
    p.append(('Ruin_Altar', 0.0, 0, -U * 0.25, 0, 0, 0))
    for sx, dz, yaw in ((-1, -U * 0.5, 0.3), (1, U * 0.35, -0.2)):
        p.append(('Ruin_Column', sx * U * 0.7, 0, dz, yaw, 0.9, 0))
    for dx, dz, r in ((-2.4, 2.1, 0.7), (2.8, -2.6, 2.2), (-3.1, -1.4, 1.3)):
        p.append(('Ruin_Rubble', dx, 0, dz, r, 0, 0))
    p.append(('Ruin_Floor', 0.0, 0, 0.0, 0, 0, 0))
    p.append(('Ruin_Floor', 0.0, 0, -U, 0, 0, 0))
    return p


# (key, px, py, yaw, pad half-width, pad half-depth, layout)
# The pad has to cover every PIECE, not just the building. All pieces are set
# at the height of the structure's own centre, so anything standing outside the
# levelled rectangle floats or sinks by however much the hillside moved: the
# chapel's west steps and the tower's overlook wall both reach well past the
# walls they belong to.
STRUCTURES = [
    ('chapel_ruin', 912, 228, 0.0, 8.5, 15.0, chapel_layout),
    ('crow_tower',  545, 685, 0.6, 12.0, 12.0, tower_layout),
    # no pad: the fen has to stay wet right up to the stones
    ('fen_shrine',  1233, 472, 0.9, 0, 0, fen_shrine_layout),
]

# The Murkfen's plank walks, as polylines in blueprint pixels. The drawing shows
# them threading the marsh; spans are laid along these at one grid unit apart and
# turned to follow the line, cycling through the generator's variants so no two
# neighbours are the same board. A deck is walkable -- see `decks` in the client.
# The plank walks are no longer drawn here. They are laid on the ROADS wherever
# a road crosses the fen -- see the decks section of the emitter -- because
# drawn by hand they became an island: 29 of 71 spans stood on dry ground or
# bare rock, and all four ends of the network finished between 14 and 42 metres
# from the nearest path. A walk that is the crossing cannot come adrift of it.
#
# The fen is made plankable for the router instead (deck_cells, DECK_COST), so
# it takes the direct line across the marsh rather than skirting it.
BOARDWALK_VARIANTS = ['Boardwalk_A', 'Boardwalk_B', 'Boardwalk_C', 'Boardwalk_D']
WETLAND_KIT = BOARDWALK_VARIANTS + ['Boardwalk_Corner', 'Boardwalk_Jetty', 'Boardwalk_Piling']

# Ore. The drawing calls Wolfsnag "narrow cliffs"; broken rock is where you dig.
# (model, poi, count, radius)
ORE = [
    ('Copper_Ore_Vein', 'wolfsnag', 5, 30), ('Tin_Ore_Vein', 'wolfsnag', 5, 30),
    ('Iron_Ore_Vein', 'wolfsnag', 4, 28), ('Coal_Ore_Vein', 'wolfsnag', 3, 26),
    ('Copper_Ore_Vein', 'crowhill', 3, 28), ('Iron_Ore_Vein', 'crowhill', 3, 26),
    ('Silver_Ore_Vein', 'crowhill', 2, 22), ('Coal_Ore_Vein', 'spiderden', 3, 26),
    ('Gold_Ore_Vein', 'grimroot', 1, 24),
]

# Somewhere to fish: the deep pool, the fen, and the creek where it slows.
# (id, px, py, tier)
FISHING = [
    ('fs_ravenwater_n', 520, 250, 2), ('fs_ravenwater_s', 596, 292, 2),
    ('fs_murkfen_w',   1150, 508, 1), ('fs_murkfen_e',   1300, 486, 1),
    ('fs_jetty',       1274, 566, 3),
    ('fs_fen_deep_e',  1313, 501, 3), ('fs_fen_deep_w', 1163, 472, 2),
    ('fs_creek',        860, 396, 1), ('fs_crowwater',    848, 646, 2),
    # Tier 4 is PIKE, and there was no tier 4 spot anywhere -- a species with a
    # level, an xp value, an item, a cooked form and a model, and nowhere in
    # the world to catch one. Pike lie in the deepest, stillest water, which is
    # Ravenwater; these two sit out from its north and west shores where the
    # pool is darkest.
    ('fs_ravenwater_deep', 556, 214, 4), ('fs_ravenwater_w', 486, 276, 4),
]

# Threshold markers: the two chokepoints the drawing calls out, and a waystone
# at each way out. Cheap, and they are what turn a gap in the trees into a
# doorway you notice yourself going through.
MARKERS = [
    ('Blockout_Standing_Stones', 428, 479, 0.3),
    ('Blockout_Standing_Stones', 870, 812, 1.9),
    ('Blockout_Waystone', 712,  76, 0.0),
    ('Blockout_Waystone', 1379, 350, 1.57),
    ('Blockout_Waystone', 334, 505, 1.57),
    ('Blockout_Waystone', 1092, 904, 0.0),
]

# Where a model lives under client/models, for anything not in the top folder.
# The props the location sheets asked for that nothing in the library covered.
# Built by tools/build_darkwoods_props.py; replace any file with real art under
# the same name and these placements keep working.
DARKWOODS_KIT = [
    'Gravestone_Slab', 'Gravestone_Cross', 'Gravestone_Tall', 'Gravestone_Broken',
    'Tomb_Slab', 'Path_Lantern', 'Lily_Pads', 'Fallen_Log', 'Rock_Spire',
    'Mossy_Boulder', 'Stilt_Watchtower', 'Banner_Wolf', 'Banner_Crow',
    'Banner_Moon', 'Brazier', 'Market_Stall',
]

RUIN_KIT = ['Ruin_Wall', 'Ruin_Wall_Half', 'Ruin_Wall_Low', 'Ruin_Wall_Door',
            'Ruin_Wall_Window', 'Ruin_Gable', 'Ruin_Column', 'Ruin_Arch',
            'Ruin_Floor', 'Ruin_Rubble', 'Ruin_Altar', 'Ruin_Stair',
            # the Gothic pieces, from tools/build_gothic_kit.py
            'Ruin_Wall_Tall', 'Ruin_Lancet', 'Ruin_East_Window', 'Ruin_Rose',
            'Ruin_Arcade', 'Ruin_Buttress', 'Ruin_Pier', 'Ruin_Steps_Wide',
            'Ruin_Door_Arch', 'Tower_Slit', 'Tower_Gallery', 'Tower_Roof',
            'Tower_Door']

MODEL_DIR = {
    **{k: 'darkwoods' for k in DARKWOODS_KIT},
    **{k: 'ruin' for k in RUIN_KIT},
    **{k: 'wetland' for k in WETLAND_KIT},
    **{o[0]: 'cave' for o in ORE},
    'Blockout_Standing_Stones': 'blockout', 'Blockout_Waystone': 'blockout',
    'Rock_Arch': 'cave', 'Wall_Boulder_Tall': 'cave', 'Wall_Boulder_Wide': 'cave',
    'Rubble_Pile': 'cave', 'Floor_Web': 'cave', 'Funnel_Web': 'cave',
    'Ground_Cocoon': 'cave', 'Hanging_Cocoon': 'cave', 'Egg_Cluster': 'cave',
    'Brood_Nest': 'cave', 'Layered_Web_Nest': 'cave', 'Webbed_Bones': 'cave',
    'Webbed_Boulder': 'cave', 'Broken_Web_Strands': 'cave',
    'Stalagmite_Cluster': 'cave', 'Stalagmite_Large': 'cave',
    'Luminous_Mushrooms': 'cave',
    'Violet_Crystals': 'cave', 'Teal_Crystals': 'cave',
    **{k: 'farm' for k in (
        'Farm_Handcart', 'Farm_Fence', 'Farm_Gate', 'Walk_In_Chicken_House',
        'Raised_Chicken_Coop', 'Covered_Chicken_Run', 'Nesting_Boxes',
        'Chicken_Cage', 'Chicken_Feeder', 'Chicken_Waterer', 'Grain_Barrel',
        'Grain_Sack', 'Egg_Basket', 'Wheelbarrow', 'Pitchfork',
        'Vegetable_Crate', 'Hay_Pile', 'Square_Hay_Bale', 'Round_Hay_Bale',
        'Stacked_Hay_Bales', 'Tall_Haystack', 'Scarecrow', 'Water_Trough',
        'Feeding_Trough')},
    'Bedroll': 'props',
    'Small_Canvas_Tent': 'props', 'Supply_Pavilion': 'props', 'Camp_Lantern': 'props',
    'Cooking_Tripod': 'props', 'Supply_Crate': 'props', 'Water_Barrel': 'props',
    'Camp_Stool': 'props', 'Rolled_Bedroll': 'props', 'Goblin_Hide_Tent': 'props',
    'Unlit_Fire_Pit': 'props', 'Campfire': 'props', 'Brown_Mushrooms': 'cave',
}

# Every tree the client can choose must be downloaded, or the habitat mix picks
# a species the player never receives and that patch of wood renders empty. The
# client sorts these into wet / deep / light stands; the manifest just has to
# carry all of them.
TREE_SPECIES = ['Ancient_Forest_Tree', 'Broad_Crown_Oak', 'Tall_Leafy_Birch',
                'Twisted_Darkwood', 'Weeping_Willow', 'Willow_Tree',
                'Yew_Tree', 'Oak_Tree', 'Maple_Tree', 'Normal_Tree', 'Tree']

# The people. These ids are the ones server/quests.js hands its quests to, so
# the names are fixed even though the map they stood on is new -- every one of
# them is re-homed onto a landmark the blueprint actually draws.
# (id, display name, model, idle line, anchor POI, dx, dz)
NPCS = [
    ('alric',    'Warden Alric',      'Male',   'Nine places on this map will kill you. I can name them all.', 'camp', -7, 3),
    ('rowan',    'Rowan Ash',         'Female', 'Keep a lantern lit. The dark out here has opinions.', 'camp', 6, -4),
    ('tessa',    'Tessa Quill',       'Female', 'Half my supplies never reach the camp. Half.', 'camp', 2, 9),
    ('merchant', 'Pedlar Ovric',      'Male',   'I buy what you drag back. I ask nothing about it.', 'camp', -4, -8),
    ('maggie',   'Maggie Byrne',      'Female', 'Something has been at the birds again.', 'camp', 11, 4),
    ('bram',     'Bram Holt',         'Male',   'Fences do not mend themselves, more is the pity.', 'camp', -12, -2),
    ('dorn',     'Dorn Pike',         'Male',   'That is my claim they are jumping, and I want it back.', 'camp', 9, 11),
    ('fenwick',  'Fenwick Dell',      'Male',   'Brown caps good. Red caps, you leave alone.', 'camp', -9, 10),
    ('lysa',     'Scout Lysa',        'Female', 'Smoke on the ridge again. Someone is camped up there.', 'crowhill', 4, 5),
    ('sela',     'Huntress Sela',     'Female', 'The den is west, through the cliffs. Go loud or go home.', 'wolfsnag', 3, 4),
    ('hermit',   'The Fen Hermit',    'Male',   'The water remembers everything that walks into it.', 'murkfen', -6, 6),
    # Not everyone in the woods with green skin wants a fight.
    ('pib',      'Pib',               'Goblin', 'Pib did not steal it. Pib FOUND it. Different.', 'briar', -22, -16),
]

# Chests the quests send you after. Each one lands on the landmark its name has
# always implied -- the watchtower cache on Crow Hill's lookout, the smuggler's
# niche at the mouth of the Spider Den.
CHESTS = [
    ('watchtower', 'crowhill',  4, -5), ('rotfen', 'murkfen', 8, -9),
    ('wolfden',    'wolfsnag', -5,  6), ('stones', 'grimroot', -7, 8),
    ('smug',       'spiderden', 5,  4),
    ('fencache',   'fen_cache',  1,  1),      # out on the fen's south island
    ('ravenmere',  'ravenwater', -11, 7),     # "deep waters conceal hidden secrets"
    ('reliquary',  'chapel',      0, -7),     # at the altar, in the standing east end
]

# The two named things the quests ask you to put down.
ELITES = [
    ('goblin_chief',  'Chief Rattlecap',        14, 'briar',    0, -6),
    ('cave_guardian', 'The Rootbound Guardian', 16, 'grimroot', 6,  4),
    # The Den Mother has moved underground, where she belongs: the Spider Den is
    # a real cave now (tools/build_spiderden.py) and she is in the brood chamber
    # at the bottom of it. What is left up here is the approach.
    # Ravenwater's "deep, dark waters conceal hidden secrets". Something has
    # been down there long enough to go green.
    ('cave_giant',    'The Drowned Warden',     11, 'ravenwater', 9, -13),
]


# --------------------------------------------------------------- quest objects
# The things a quest asks you to put your hands on: mushroom clumps to pick,
# trail lanterns to light, a goblin's signal fire to kick out.
#
# The machinery for these survived the rebuild on both sides -- the server's
# useWorldObject knows about gives / hurt / respawn / needDead, and the client
# knows a lit lantern keeps its flame and a picked clump stays gone until it
# grows back. What did not survive was the objects. `zone.objects` came out of
# the new build empty, and SIX quests -- a quarter of the list -- ask for them:
# Rowan's glowcaps and lanterns, Tessa's carts and her goblin's honeycake,
# Lysa's signal fires, Rowan's banner and Fenwick's mushrooms. Every one of
# them was unfinishable from the day Dark Woods was regenerated, and none of
# them errored: an empty list is a quiet list.
#
# Nothing below is placed by pixel. Each kind states what it wants to stand
# near -- a road, deep wood, a creek bank, a hilltop, a goblin camp -- and how
# many of it there should be; the placement walks the routed paths and the
# traced grid to find that ground. So it survives the next rebuild, the way the
# bridges and gateways and jetties had to learn to.
#
# (key, n, model, where, gives, extra)
#   where:  'road' / 'trail' along the routed lines, 'wood' deep forest off
#           them, 'bank' dry ground at the water's edge, 'hill' a raised crown,
#           'poi:<key>' inside a landmark.
#   gives:  (item, count) pushed into the bag, or None.
#   extra:  passed through to the emitted object -- respawn seconds, a light
#           colour, hurt, the quest it is gated behind, the model it becomes
#           once it is spent.
NODES = [
    # Rowan wants six glowcaps for lantern oil. They grow where it is darkest,
    # which is off the road rather than on it.
    ('glowcap', 16, 'Luminous_Mushrooms', 'wood', ('Glowcap', 1), dict(
        name='Glowcap Cluster', respawn=150, light=0x4fe0a8, s=1.0, reach=3.2,
        text='You twist the glowcaps loose. They go on shining in your bag.')),
    # Fenwick's two safe ones. Browncaps are common and mooncaps are not.
    ('browncap', 13, 'Brown_Mushrooms', 'wood', ('Browncap', 1), dict(
        name='Browncaps', respawn=110, s=1.0, reach=3.2,
        text='Browncaps. The safe ones, if Fenwick is to be believed.')),
    ('mooncap', 9, 'Luminous_Mushrooms', 'wood', ('Mooncap', 1), dict(
        name='Mooncaps', respawn=190, light=0x9fc8ff, s=0.78, reach=3.2,
        text='Pale blue and cold to the touch. You pick them carefully.')),
    # And the one he is paying you NOT to pick. It is deliberately in the same
    # ground as the others and deliberately looks like money -- the bonus on
    # Mushroom Business is for telling them apart. It bites.
    ('rotcap', 10, 'Poison_Mushrooms', 'wood', ('Rotcap', 1), dict(
        name='Rotcaps', respawn=140, s=0.95, reach=3.2, hurt=5,
        text='Red, swollen, and it bursts. Fenwick warned you about these.')),
    # "Sharp little berries from the creek bank" -- so, the creek bank.
    ('redberry', 9, 'Red_Berry_Bush', 'bank', ('Redberry', 1), dict(
        name='Redberry Bush', respawn=120, s=1.0, reach=3.4,
        text='You strip a handful of redberries off the bush.')),
    # Rowan's lanterns stand on the roads, which is the whole point of them:
    # the light is for the people walking between places. Shared state -- your
    # lantern stays lit for everyone who comes along after you.
    ('lantern', 8, 'Path_Lantern', 'road', None, dict(
        name='Trail Lantern', toggle=True, s=1.0, reach=3.6,
        textOn='The wick catches. A circle of road comes back.',
        textOff='You pinch the wick out. The dark closes in again.')),
    # Tessa's missing supplies: three wagons that never arrived, standing where
    # the road runs and the goblins do.
    ('cart', 3, 'Farm_Handcart', 'road', None, dict(
        name='Abandoned Handcart', once=True, s=1.0, reach=3.8,
        quest='dw_supplies', idleText='A broken cart. Someone else\u2019s problem.',
        text='Axle cut, not broken. Whoever took the load knew what they were doing.')),
    # ...and the load itself, in the goblin camp at Briar Hollow.
    ('crate', 6, 'Supply_Crate', 'poi:briar', ('Supply Crate', 1), dict(
        name='Outpost Crate', respawn=200, s=1.0, reach=3.4,
        quest='dw_supplies', idleText='Goblin spoil. Not yours to carry off.',
        text='Outpost markings, still legible under the mud.')),
    # Lysa's signal fires burn on the high ground, because that is where smoke
    # is worth making. Doused, they become a cold pit and stay one.
    ('signalfire', 3, 'Campfire', 'hill', None, dict(
        name='Goblin Signal Fire', once=True, s=1.0, reach=4.0,
        light=0xff8a3c, doused='Unlit_Fire_Pit', quest='dw_smoke',
        idleText='A goblin watchfire. Someone is being told something.',
        text='You kick the fire apart. Whatever it was saying, it has stopped.')),
    # Chief Rattlecap's banner, and you are not cutting it down while he is
    # still standing under it -- the server checks.
    ('banner', 1, 'Banner_Wolf', 'poi:briar', None, dict(
        name='Woodfang Banner', once=True, s=1.0, reach=3.6,
        quest='dw_rattlecap', needDead='Chief Rattlecap',
        idleText='Woodfang colours. Leave them until their chief is down.',
        text='You cut the banner down. The hollow goes very quiet.')),
    # One honeycake, in the camp larder, for one greedy goblin.
    ('honeycake', 1, 'Water_Barrel', 'poi:camp', ('Honeycake', 1), dict(
        name='Camp Larder', once=True, s=1.0, reach=3.2,
        quest='dw_pib', idleText='Tessa keeps the larder counted. Stay out of it.',
        text='One honeycake, still sticky. Pib had better be worth it.')),
]


def load_grid():
    d = json.loads(GRID.read_text())
    stamp_banks(d)
    return d


def stamp_banks(d):
    """Write the BANKS into the traced grid, as LAND.

    A dome on its own does nothing inside traced water, and it took a while to
    see why. landBaseY multiplies the hills by

        LF = max(0, 1 - wet / fade)

    so the moment the wetness passes the shoreline level the land height is
    multiplied by ZERO -- deliberately, because that is what keeps "the ground
    is under the waterline" and "the drawing says water here" the same test.
    The bank at Murkfen sat at wet 0.468 against a fade of 0.41, so its 1.1 m
    was erased before anything drew it.

    The drawing is the source of truth for where water is, so a bank has to be
    in the drawing. Stamping it into the grid here rather than repainting
    darkwoods.trace.png keeps the blueprint the artist's, and every reader
    follows from the one edit: the blurred fields, the water sheet, the swim
    test, the walk grid and the hills all read this grid.

    The stamped core is smaller than the dome. The core says "this is land" and
    the blur feathers it out; the dome gives the ground its shape over the same
    ground. Stamping the full radius would put a hard disc of dry cells in the
    fen, which is the same mistake in the other direction.
    """
    if not BANKS:
        return
    cell, W, H = d['cell'], d['w'], d['h']
    minX, minZ = d['minX'], d['minZ']
    rows = [list(r) for r in d['rows']]
    changed = 0
    for bx, bz, r, _h in BANKS:
        core = r * BANK_CORE
        for gz in range(H):
            cz = minZ + (gz + 0.5) * cell
            if abs(cz - bz) > core:
                continue
            for gx in range(W):
                cx = minX + (gx + 0.5) * cell
                if math.hypot(cx - bx, cz - bz) > core:
                    continue
                if rows[gz][gx] in 'Ww':
                    rows[gz][gx] = '.'
                    changed += 1
    d['rows'] = [''.join(r) for r in rows]
    print(f'  {changed} cells stamped to land by {len(BANKS)} bank(s)')


def make_xform(d):
    p = d['px']
    S = p['unitsPerPx']

    def world(px, py):
        return (round((px - p['x0']) * S + d['minX'], 1),
                round((py - p['y0']) * S + d['minZ'], 1))
    return world


# ----------------------------------------------------------------- routing
# Cost of standing on each terrain class. Water and rock are not walls to the
# router -- they are expensive -- so a road will cross a stream if the detour
# round it is absurd, and the bridge list is what makes those crossings cheap.
STEP_COST = {'.': 1.0, 'f': 1.25, 'F': 2.1, 'w': 9.0, 'W': 40.0, 'R': 60.0, ' ': 400.0}

# Wading a river costs this much per cell. It has to be dear enough that the
# router will walk a long way round to reach a bridge, but not so dear that a
# landmark on the far bank becomes unreachable -- so it is a cost, not a wall.
FORD_COST = 26.0


# What a span of plank walk costs the router per cell. Dearer than open ground
# (you would not detour into a marsh for fun) but far cheaper than wading it, so
# where the direct line lies across the fen the road takes it -- on planks.
# WHERE THE WATER IS, as one set of numbers. The zone carries these to the
# client (which contours its shoreline off them) and the server (which decides
# swimming off them) -- and now the builder snaps fishing spots with them too,
# so all three agree by construction rather than by coincidence.
WATER_EDGE = {'deep': 0.41, 'marsh': 0.44, 'fade': 0.41, 'blur': 3}
# Where rock stops being scenery and starts being a wall. `rise` is how tall the
# client draws it (y += rise * field^2). They are one pair of numbers because
# they describe one thing -- the cliff.
# `walkSlope` is rise over run: 0.84 is 40 degrees. Blocking by how much ROCK
# was under you was the wrong quantity -- measured across every cell that
# blocked, 47% were gentler than 30 degrees and 735 were flat, which is a grassy
# mound you walk into like a wall. What stops a person is steepness.
ROCK_EDGE = {'rise': 17.0, 'walkSlope': 0.84}

DECK_COST = 2.4


def route(d, a, b, bridge_cells, river_cells=(), deck_cells=()):
    """A* from cell a to cell b over the traced grid.

    river_cells matters more than it looks. The trace classifies the LAKE and the
    fen as water, but the streams are drawn as thin blue lines that the trace's
    blur washes out -- so as far as the grid is concerned the Crowwater is dry
    open ground. The first build therefore let every road stroll straight across
    every river: five crossings, five fords, and six bridges standing in fields
    nobody walked through. Rivers are rasterised from their POLYLINES and made
    expensive here, so a road goes round to a bridge or pays for the ford.
    """
    W, H, rows = d['w'], d['h'], d['rows']
    (ax, az), (bx, bz) = a, b

    def cost(x, z):
        c = rows[z][x]
        k = STEP_COST.get(c, 4.0)
        wet = c in 'Ww' or (x, z) in river_cells
        if wet:
            if (x, z) in bridge_cells:
                k = 1.4                               # a bridge deck, not a ford
            elif (x, z) in deck_cells:
                k = DECK_COST                         # planked: the Murkfen walks
            elif (x, z) in river_cells:
                k = max(k, FORD_COST)
        return k

    def h(x, z):
        return math.hypot(x - bx, z - bz)

    start = (ax, az)
    goal = (bx, bz)
    best = {start: 0.0}
    came = {}
    pq = [(h(*start), start)]
    seen = set()
    NB = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)]
    while pq:
        _, cur = heapq.heappop(pq)
        if cur in seen:
            continue
        seen.add(cur)
        if cur == goal:
            break
        cx, cz = cur
        for dx, dz in NB:
            nx, nz = cx + dx, cz + dz
            if nx < 0 or nz < 0 or nx >= W or nz >= H:
                continue
            diag = dx and dz
            if diag:
                # never cut a diagonal past a blocked corner: a road that does
                # it looks like it walks through the rock it is going round
                if rows[cz][nx] == ' ' or rows[nz][cx] == ' ':
                    continue
            step = (1.414 if diag else 1.0) * cost(nx, nz)
            g = best[cur] + step
            if g < best.get((nx, nz), 1e18):
                best[(nx, nz)] = g
                came[(nx, nz)] = cur
                heapq.heappush(pq, (g + h(nx, nz), (nx, nz)))
    if goal not in came and goal != start:
        return None
    path = [goal]
    while path[-1] != start:
        path.append(came[path[-1]])
    path.reverse()
    return path


def simplify(pts, tol):
    """Douglas-Peucker, then a pass that puts back any corner the simplifier
    cut across -- a straightened road that clips a cliff is worse than a
    slightly wobbly one."""
    if len(pts) < 3:
        return pts[:]
    a, b = pts[0], pts[-1]
    dx, dz = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dz * dz or 1.0
    worst, wi = -1.0, 0
    for i in range(1, len(pts) - 1):
        px, pz = pts[i]
        t = max(0.0, min(1.0, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2))
        d = math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t))
        if d > worst:
            worst, wi = d, i
    if worst <= tol:
        return [a, b]
    return simplify(pts[:wi + 1], tol)[:-1] + simplify(pts[wi:], tol)


def main():
    d = load_grid()
    world = make_xform(d)
    cell, W, H = d['cell'], d['w'], d['h']
    minX, minZ = d['minX'], d['minZ']
    rows = d['rows']

    def to_cell(px, py):
        wx, wz = world(px, py)
        return (max(0, min(W - 1, int((wx - minX) / cell))),
                max(0, min(H - 1, int((wz - minZ) / cell))))

    # Nudge a landmark onto ground a road can actually start from.
    _fld = {}

    def _field(name):
        if name in _fld:
            return _fld[name]
        want = {'wet': 'Ww', 'deep': 'W', 'rock': 'R'}[name]
        raw = [[1.0 if rows[gz][gx] in want else 0.0 for gx in range(W)] for gz in range(H)]
        R = int(WATER_EDGE['blur'])

        def hpass(src):
            dst = [[0.0] * W for _ in range(H)]
            for gz in range(H):
                row = src[gz]
                for gx in range(W):
                    lo, hi = max(0, gx - R), min(W - 1, gx + R)
                    dst[gz][gx] = sum(row[lo:hi + 1]) / (hi - lo + 1)
            return dst

        def vpass(src):
            dst = [[0.0] * W for _ in range(H)]
            for gx in range(W):
                col = [src[gz][gx] for gz in range(H)]
                for gz in range(H):
                    lo, hi = max(0, gz - R), min(H - 1, gz + R)
                    dst[gz][gx] = sum(col[lo:hi + 1]) / (hi - lo + 1)
            return dst
        # TWO separable box blurs -- four passes -- which is what both
        # worldgen.terrainFieldAt and the client's buildTerrainFields do. One
        # separable blur is a visibly different field: at the Ravenwater shore
        # it read 0.437 where the game reads 0.514, which is the difference
        # between "dry, stand here" and "water, you are swimming", and it is
        # why the first two attempts at snapping the fishing spots put them
        # somewhere the runtime disagreed with.
        out = vpass(hpass(raw))
        out = vpass(hpass(out))
        _fld[name] = out
        return out

    def field_at(wx, wz, name):
        """Bilinear between cell CENTRES -- byte for byte what
        worldgen.terrainFieldAt does at runtime.

        This sampled the containing cell instead, and that one difference put
        the answers either side of the waterline: 1.6 m from the Ravenwater
        spot the cell read 0.429 (dry, stand here) while the interpolated value
        the game actually uses read above 0.44 (water, you would be swimming).
        Two implementations of one rule is the same mistake as two copies of
        the waterline, which is what put the fishing spots on grass to begin
        with."""
        g = _field(name)
        fx = (wx - minX) / cell - 0.5
        fz = (wz - minZ) / cell - 0.5
        x0 = math.floor(fx)
        z0 = math.floor(fz)
        tx, tz = fx - x0, fz - z0

        def at(ix, iz):
            if ix < 0 or iz < 0 or ix >= W or iz >= H:
                return 0.0
            return g[iz][ix]
        a = at(x0, z0) * (1 - tx) + at(x0 + 1, z0) * tx
        b = at(x0, z0 + 1) * (1 - tx) + at(x0 + 1, z0 + 1) * tx
        return a * (1 - tz) + b * tz


    # --- what you can walk on --------------------------------------------
    # Not the traced cell: the rock the client DRAWS. The grid is the drawing,
    # the blur is what the drawing becomes on screen, and the wall is where that
    # is steeper than ROCK_EDGE['walkSlope'] -- the same rule the server applies through
    # worldgen.rockSolidAt, off the same two numbers written into the zone.
    # A road is the authored exception: a chokepoint is three to five metres of
    # gap through a cliff, which is narrower than the blur can resolve, so
    # without it every pass on the map would read as solid stone.
    paths = []
    _wm = {'key': None, 'g': None}

    def walk_grid():
        key = (hash(tuple(rows)), len(paths))
        if _wm['key'] == key:
            return _wm['g']
        _fld.clear()
        rise = ROCK_EDGE['rise']
        lim = ROCK_EDGE['walkSlope']
        rock = _field('rock')
        # The slope of the DRAWN ground, which is what stops a person. Only the
        # rock term is taken: the hills are broad smooth domes and the water
        # cuts are shallow, so the rock rise is where all the steepness is. It
        # is an approximation and it is used only to decide where the builder
        # may put things -- tools/walkcheck.mjs asks the real collision.
        h = [[rise * frow[gx] ** 2 for gx in range(W)] for frow in rock]
        g = [[False] * W for _ in range(H)]
        for gz in range(H):
            grow = g[gz]
            rrow = rows[gz]
            for gx in range(W):
                ch = rrow[gx]
                if ch == ' ' or ch == 'W':
                    continue
                gx0, gx1 = max(0, gx - 1), min(W - 1, gx + 1)
                gz0, gz1 = max(0, gz - 1), min(H - 1, gz + 1)
                dx = (h[gz][gx1] - h[gz][gx0]) / ((gx1 - gx0) * cell or 1)
                dz = (h[gz1][gx] - h[gz0][gx]) / ((gz1 - gz0) * cell or 1)
                grow[gx] = math.hypot(dx, dz) <= lim
        for kind, _a, _b, pts in paths:
            half = ROAD_CUT if kind == 'road' else TRAIL_CUT
            rc = max(1, int(half / cell))
            for i in range(len(pts) - 1):
                (x0, z0), (x1, z1) = pts[i], pts[i + 1]
                steps = max(1, int(math.dist(pts[i], pts[i + 1]) / (cell * 0.5)))
                for s in range(steps + 1):
                    wx = x0 + (x1 - x0) * s / steps
                    wz = z0 + (z1 - z0) * s / steps
                    cx, cz = int((wx - minX) / cell), int((wz - minZ) / cell)
                    for dz in range(-rc, rc + 1):
                        for dx in range(-rc, rc + 1):
                            if dx * dx + dz * dz > rc * rc:
                                continue
                            gx, gz = cx + dx, cz + dz
                            if 0 <= gx < W and 0 <= gz < H and rows[gz][gx] not in ' W':
                                g[gz][gx] = True
        _wm['key'] = key
        _wm['g'] = g
        return g

    def dry_walk(gx, gz):
        """Somewhere you can stand, at the cell's own centre."""
        return 0 <= gx < W and 0 <= gz < H and walk_grid()[gz][gx]

    # Somewhere you can PUT something. Deliberately stricter than dry_walk: the
    # builder measures the slope from the blurred rock field on 2.5 m centres,
    # and the game measures it on the ground MESH, whose triangles amplify the
    # local gradient -- a shoulder that reads 32 degrees here came out at 43 in
    # the game and a glowcap ended up on a cliff face. Routing and reachability
    # still use the real limit; only placement backs off, because a mushroom
    # two metres further down the slope costs nothing and a mushroom you cannot
    # reach costs a quest.
    PLACE_SLOPE = 0.45
    def place_slope(wx, wz):
        rise = ROCK_EDGE['rise']
        hh = lambda x, z: rise * field_at(x, z, 'rock') ** 2
        dx = (hh(wx + cell, wz) - hh(wx - cell, wz)) / (2 * cell)
        dz = (hh(wx, wz + cell) - hh(wx, wz - cell)) / (2 * cell)
        return math.hypot(dx, dz)

    def stand_at(wx, wz):
        """The same question at world coordinates, for placing something."""
        if not dry_walk(int((wx - minX) / cell), int((wz - minZ) / cell)):
            return False
        return place_slope(wx, wz) <= PLACE_SLOPE

    def walkable_cell(px, py):
        cx, cz = to_cell(px, py)
        if dry_walk(cx, cz) and rows[cz][cx] != 'w':
            return (cx, cz)
        for r in range(1, 26):
            for i in range(0, 360, 10):
                a = math.radians(i)
                nx, nz = cx + int(math.cos(a) * r), cz + int(math.sin(a) * r)
                if dry_walk(nx, nz) and rows[nz][nx] != 'w':
                    return (nx, nz)
        return (cx, cz)

    # The drawing renders buildings, ruins and the map's own rim in the same grey
    # as the cliffs, so the trace calls the Fallen Chapel a rock wall and the
    # West Road a dead end. A labelled place is somewhere you GO: clear the stone
    # out of its footprint before anything is routed through it. Wolfsnag Pass
    # keeps most of its rock -- it is cliffs by design -- but a pass you cannot
    # walk is not a pass, so a corridor is opened through it.
    # How much rock a landmark clears out of its own footprint before anything
    # is routed. This is the single number that decides whether a "pass" is a
    # pass: at 15 it punched a thirty-metre hole in the Wolfsnag cliffs and the
    # walkable corridor came out 23 m wide, against a sheet that says 3-5 m and
    # calls it a dangerous chokepoint. Clear only enough for the router to find
    # a way in, and let the ROAD cut the gap -- narrowed at the chokepoints
    # above -- so the defile exists because the road threads it.
    CLEAR = {'wolfsnag': 10, 'grimroot': 11, 'spiderden': 13,
             'murkfen': 26, 'ravenwater': 20}
    rowlist = [list(r) for r in rows]
    cleared = 0
    def clear_rock(px, py, radius):
        nonlocal cleared
        cx, cz = to_cell(px, py)
        rc = int(radius / cell)
        for dz in range(-rc, rc + 1):
            for dx in range(-rc, rc + 1):
                if dx * dx + dz * dz > rc * rc:
                    continue
                x, z = cx + dx, cz + dz
                if 0 <= x < W and 0 <= z < H and rowlist[z][x] == 'R':
                    rowlist[z][x] = '.'
                    cleared += 1
    for key, name, sub, px, py, kind, r in POIS:
        clear_rock(px, py, CLEAR.get(key, 24))
    for key, name, sub, px, py, side in EXITS:
        clear_rock(px, py, 26)          # a way out has to be a way out
    rows = [''.join(r) for r in rowlist]
    d['rows'] = rows
    print(f'  cleared {cleared} rock cells from landmarks and exits')

    # The one piece of ground everything has to hang off: whatever you can walk
    # to from the camp. Nudging a landmark onto "the nearest walkable cell" is
    # not enough on its own -- Ravenwater's nearest dry land is an ISLAND in the
    # middle of the pool, and a road routed to an island is a road to nowhere.
    # The Murkfen is the one body of water you cross ON something rather than
    # going round: its sheet calls the plank walks "primary traversable routes
    # across the marsh". So the fen's wet cells are plankable, and the router
    # is allowed to take the direct line over them. The walks are then laid on
    # whatever line it actually chose -- which is the whole point, because the
    # first version drew them by hand on the blueprint and they ended up an
    # island: 29 of 71 spans on dry ground, and every end of the network
    # between 14 and 42 metres from the nearest path.
    fen = [q for q in POIS if q[0] == 'murkfen'][0]
    fen_w = world(fen[3], fen[4])
    DECK_REACH = 86.0
    deck_cells = set()
    for gz in range(H):
        for gx in range(W):
            if rows[gz][gx] not in 'Ww':
                continue
            wx = minX + (gx + 0.5) * cell
            wz = minZ + (gz + 0.5) * cell
            if math.hypot(wx - fen_w[0], wz - fen_w[1]) < DECK_REACH:
                deck_cells.add((gx, gz))
    print(f'  the Murkfen offers {len(deck_cells)} cells that can be planked')


    # A plankable fen cell counts as walkable ground: you get there on the walk.
    # Without this a waypoint in a deep pocket is dragged to the nearest bank,
    # the trail stops there, and the fishing head ends up fifty metres out in
    # open water with no way to reach it.
    # (plankable fen cells count as walkable: you get there on the walk)
    def walkable(nx, nz):
        return dry_walk(nx, nz) or (nx, nz) in deck_cells

    def main_component(seed):
        comp = {seed}
        stack = [seed]
        while stack:
            x, z = stack.pop()
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, nz = x + dx, z + dz
                if 0 <= nx < W and 0 <= nz < H and (nx, nz) not in comp and walkable(nx, nz):
                    comp.add((nx, nz))
                    stack.append((nx, nz))
        return comp

    camp_cell = walkable_cell(*[(q[3], q[4]) for q in POIS if q[0] == 'camp'][0])
    mainland = main_component(camp_cell)
    print(f'  mainland: {len(mainland)} cells')

    def anchor_cell(px, py):
        """The nearest cell you could actually walk to from the camp."""
        cx, cz = to_cell(px, py)
        if (cx, cz) in mainland:
            return (cx, cz)
        for r in range(1, 90):
            for i in range(0, 360, 6):
                a = math.radians(i)
                nx, nz = cx + int(math.cos(a) * r), cz + int(math.sin(a) * r)
                if (nx, nz) in mainland:
                    return (nx, nz)
        return walkable_cell(px, py)

    nodes = {}
    for key, name, sub, px, py, kind, r in POIS:
        nodes[key] = anchor_cell(px, py)
    for key, name, sub, px, py, side in EXITS:
        nodes[key] = anchor_cell(px, py)
    for key, (px, py) in WAYPOINTS.items():
        nodes[key] = anchor_cell(px, py)

    bridge_cells = set()
    for px, py in BRIDGES:
        bx, bz = to_cell(px, py)
        for dx in range(-3, 4):
            for dz in range(-3, 4):
                bridge_cells.add((bx + dx, bz + dz))

    # The rivers in world units, and the cells they cover. BRIDGES marks where
    # the drawing shows a crossing, so those cells stay cheap and the router is
    # drawn to them; every other river cell is a ford and costs.
    rivers_w = [(name, width, [world(px, py) for px, py in pts])
                for name, width, pts in RIVERS]
    river_cells = set()
    for name, width, wp in rivers_w:
        half = width / 2 + 1.0
        for i in range(len(wp) - 1):
            (x0, z0), (x1, z1) = wp[i], wp[i + 1]
            steps = max(1, int(math.dist(wp[i], wp[i + 1]) / (cell * 0.4)))
            for t in range(steps + 1):
                wx = x0 + (x1 - x0) * t / steps
                wz = z0 + (z1 - z0) * t / steps
                rc = max(1, int(half / cell))
                gx, gz = int((wx - minX) / cell), int((wz - minZ) / cell)
                for dz in range(-rc, rc + 1):
                    for dx in range(-rc, rc + 1):
                        if dx * dx + dz * dz <= rc * rc:
                            river_cells.add((gx + dx, gz + dz))
    print(f'  rivers cover {len(river_cells)} cells; fording one costs {FORD_COST}')

    for kind, pairs, tol in (('road', ROADS, 1.1), ('trail', TRAILS, 1.6)):
        for a, b in pairs:
            p = route(d, nodes[a], nodes[b], bridge_cells, river_cells, deck_cells)
            if not p:
                print(f'  !! no route {a} -> {b}')
                continue
            pts = [(minX + (x + 0.5) * cell, minZ + (z + 0.5) * cell) for x, z in p]
            pts = simplify(pts, tol)
            paths.append((kind, a, b, pts))

    # A road through a cliff is not a road. The router is allowed to cross rock
    # because refusing outright would leave whole landmarks unreachable -- but
    # wherever it chose to, the rock is cut away into a pass. That is what the
    # drawing shows at Wolfsnag: a road threading a gap in the cliffs. The pass
    # exists BECAUSE the road goes through it.
    rowlist = [list(r) for r in rows]
    carved = 0
    for kind, a, b, pts in paths:
        half = ROAD_CUT if kind == 'road' else TRAIL_CUT
        for i in range(len(pts) - 1):
            (x0, z0), (x1, z1) = pts[i], pts[i + 1]
            steps = max(1, int(math.dist(pts[i], pts[i + 1]) / (cell * 0.5)))
            for t in range(steps + 1):
                wx = x0 + (x1 - x0) * t / steps
                wz = z0 + (z1 - z0) * t / steps
                cx, cz = int((wx - minX) / cell), int((wz - minZ) / cell)
                h = half
                for _, cpx, cpy, cw in CHOKEPOINTS:
                    cwx, cwz = world(cpx, cpy)
                    if math.hypot(wx - cwx, wz - cwz) < 26:
                        h = min(h, cw)          # squeeze to a defile
                rc = max(1, int(h / cell))
                for dz in range(-rc, rc + 1):
                    for dx in range(-rc, rc + 1):
                        if dx * dx + dz * dz > rc * rc:
                            continue
                        x, z = cx + dx, cz + dz
                        if 0 <= x < W and 0 <= z < H and rowlist[z][x] == 'R':
                            rowlist[z][x] = '.'
                            carved += 1
    rows = [''.join(r) for r in rowlist]
    d['rows'] = rows
    print(f'  carved {carved} rock cells into passes along the roads')

    # --- and then squeeze the chokepoints back shut -----------------------
    # The carve is one-directional: it takes rock OUT of the road's way. At a
    # chokepoint that is only half the job, because a defile needs rock on both
    # sides and the ground beside the Wolfsnag road is naturally open -- not
    # clearing it was not enough, the corridor still measured 23 m against a
    # sheet that says three to five.
    #
    # A 3-5 m slot is one or two cells, below what a 2.5 m trace can carry, so
    # it cannot come from the drawing: it has to be authored. Here every open
    # cell inside a chokepoint that is not within reach of the road becomes
    # rock, which leaves exactly the slot the road threads.
    rowlist = [list(r) for r in rows]
    landmark_keep = []
    for key, name, sub, px, py, kind, r in POIS:
        lx, lz = world(px, py)
        landmark_keep.append((lx, lz, CLEAR.get(key, 24)))
    for key, name, sub, px, py, side in EXITS:
        lx, lz = world(px, py)
        landmark_keep.append((lx, lz, 26.0))
    squeezed = 0
    for cname, cpx, cpy, cw in CHOKEPOINTS:
        awx, awz = world(cpx, cpy)
        # Snap the chokepoint ONTO the road. Authored at the map pin it walled
        # the landmark instead of pinching it: the Wolfsnag road runs 21 m to
        # one side of its own POI, so squeezing around the pin turned the pass
        # into a solid outcrop with the road going past it. A defile is a place
        # the road is narrow, which means it has to be measured from the road.
        cwx, cwz = awx, awz
        best = 1e9
        for _k, _a, _b, pts in paths:
            for i in range(len(pts) - 1):
                (x0, z0), (x1, z1) = pts[i], pts[i + 1]
                ddx, ddz = x1 - x0, z1 - z0
                L2 = ddx * ddx + ddz * ddz or 1.0
                t = max(0.0, min(1.0, ((awx - x0) * ddx + (awz - z0) * ddz) / L2))
                qx, qz = x0 + ddx * t, z0 + ddz * t
                dd = math.hypot(awx - qx, awz - qz)
                if dd < best:
                    best, cwx, cwz = dd, qx, qz
        rad = 18.0
        rc = int(rad / cell)
        ccx, ccz = int((cwx - minX) / cell), int((cwz - minZ) / cell)
        for dz in range(-rc, rc + 1):
            for dx in range(-rc, rc + 1):
                if dx * dx + dz * dz > rc * rc:
                    continue
                gx, gz = ccx + dx, ccz + dz
                if not (0 <= gx < W and 0 <= gz < H):
                    continue
                if rowlist[gz][gx] not in '.f':
                    continue
                wx = minX + (gx + 0.5) * cell
                wz = minZ + (gz + 0.5) * cell
                # A chokepoint squeezes the ROAD, never a landmark's own ground.
                # Grimroot Thicket's pin and its chokepoint are the same point on
                # the blueprint, so the squeeze closed the clearing down to a
                # single 2.5 m slot -- and the Magic_Tree that IS the landmark
                # has a 6.7 m collision radius, which plugged it solid. The
                # thicket was a place you could see and not enter.
                if any(math.hypot(wx - lx, wz - lz) < lr for lx, lz, lr in landmark_keep):
                    continue
                near = 1e9
                for _k, _a, _b, pts in paths:
                    for i in range(len(pts) - 1):
                        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
                        ddx, ddz = x1 - x0, z1 - z0
                        L2 = ddx * ddx + ddz * ddz or 1.0
                        t = max(0.0, min(1.0, ((wx - x0) * ddx + (wz - z0) * ddz) / L2))
                        near = min(near, math.hypot(wx - (x0 + ddx * t), wz - (z0 + ddz * t)))
                        if near <= cw + 1.6:
                            break
                    if near <= cw + 1.6:
                        break
                if near > cw + 1.6:
                    rowlist[gz][gx] = 'R'
                    squeezed += 1
    rows = [''.join(r) for r in rowlist]
    d['rows'] = rows
    print(f'  squeezed {squeezed} cells back to rock at {len(CHOKEPOINTS)} chokepoints')

    # (There used to be a pass here that turned walkable ground into rock
    # wherever the client drew a cliff over it, and another that opened rock
    # that did not stand up. Both were patching the gap between a grid that
    # blocked by the cell and a client that drew by the blur. The gap is gone:
    # ROCK_EDGE is one level and both sides read it. See walk_grid above.)

    # --- and then make sure nothing got walled in -------------------------
    # Carving and squeezing are both local edits, and a local edit can close a
    # basin: Wolfsnag Pass came out as a bowl of open ground with rock all the
    # way round it, holding a POI, a quest-giver and a chest. The build did not
    # notice, because the only reachability it checked was of the ROUTING nodes
    # -- and those are snapped to the mainland before routing, so they are on
    # the right side of the wall by construction while the landmark is not.
    #
    # So: flood the map, find every pocket the flood never reached, and cut the
    # cheapest corridor out of each one that either holds something authored or
    # is big enough to be somewhere. The corridor is one cell -- 2.5 m -- so a
    # reconnected defile stays a defile.
    MIN_POCKET = 16                      # 100 m2: below this it is a crevice
    keep_cells = set()
    for key, name, sub, px, py, kind, r in POIS:
        keep_cells.add(to_cell(px, py))
    for key, name, sub, px, py, side in EXITS:
        keep_cells.add(to_cell(px, py))
    for key, (px, py) in WAYPOINTS.items():
        keep_cells.add(to_cell(px, py))
    for key, (px, py) in SPAWN_ANCHORS.items():
        keep_cells.add(to_cell(px, py))

    def _anchor_world(key):
        if key in WAYPOINTS:
            return world(*WAYPOINTS[key])
        if key in SPAWN_ANCHORS:
            return world(*SPAWN_ANCHORS[key])
        q = [r for r in POIS if r[0] == key]
        return world(q[0][3], q[0][4]) if q else None

    def _cell_of_world(wx, wz):
        return (int((wx - minX) / cell), int((wz - minZ) / cell))

    for tbl, take in ((NPCS, lambda r: (r[4], r[5], r[6])),
                      (CHESTS, lambda r: (r[1], r[2], r[3])),
                      (ELITES, lambda r: (r[3], r[4], r[5]))):
        for row in tbl:
            akey, adx, adz = take(row)
            aw = _anchor_world(akey)
            if aw:
                keep_cells.add(_cell_of_world(aw[0] + adx, aw[1] + adz))

    rowlist = [list(r) for r in rows]

    def components():
        seen_c = {}
        comps = []
        for z0 in range(H):
            for x0 in range(W):
                if not walkable(x0, z0) or (x0, z0) in seen_c:
                    continue
                stack, cells = [(x0, z0)], []
                seen_c[(x0, z0)] = len(comps)
                while stack:
                    x, z = stack.pop()
                    cells.append((x, z))
                    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, nz = x + dx, z + dz
                        if 0 <= nx < W and 0 <= nz < H and (nx, nz) not in seen_c \
                           and walkable(nx, nz):
                            seen_c[(nx, nz)] = len(comps)
                            stack.append((nx, nz))
                comps.append(cells)
        return comps, seen_c

    def carve_to_main(cells, main_set):
        """Dijkstra out of a pocket, paying one per rock cell; carve what it crosses."""
        INF = 10 ** 9
        best = {c: 0 for c in cells}
        prev = {c: None for c in cells}
        done = set()
        pq = [(0, c) for c in cells]
        heapq.heapify(pq)
        goal = None
        while pq:
            cost, cur = heapq.heappop(pq)
            if cur in done or cost > best.get(cur, INF):
                continue
            done.add(cur)
            if cur in main_set:
                goal = cur
                break
            x, z = cur
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, nz = x + dx, z + dz
                if not (0 <= nx < W and 0 <= nz < H):
                    continue
                ch = rowlist[nz][nx]
                if ch == ' ' or ch == 'W':        # off-map, or a swim: not a corridor
                    continue
                step = 0 if walkable(nx, nz) else 1
                nc = cost + step
                if nc < best.get((nx, nz), INF):
                    best[(nx, nz)] = nc
                    prev[(nx, nz)] = cur
                    heapq.heappush(pq, (nc, (nx, nz)))
        if goal is None:
            return 0
        # Widen as it goes. A single-cell corridor is 2.5 m, which a 0.6 m body
        # fits through on paper and nothing else does: the reachability lattice
        # steps 1.25 m and can miss it entirely, the client draws the cliff
        # closing over the top of it, and one tree in the slot shuts it. Three
        # cells -- 7.5 m -- is a pass you can see and walk.
        cut = 0
        cur = goal
        while cur is not None:
            x, z = cur
            for dx, dz in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, nz = x + dx, z + dz
                if 0 <= nx < W and 0 <= nz < H and rowlist[nz][nx] == 'R':
                    rowlist[nz][nx] = '.'
                    cut += 1
            cur = prev.get(cur)
        return cut

    comps, owner = components()
    main_idx = owner.get(camp_cell)
    main_set = set(comps[main_idx])
    opened = 0
    walled = []
    left = []
    for i, cells in enumerate(comps):
        if i == main_idx:
            continue
        holds = any(c in keep_cells for c in cells)
        if not holds and len(cells) < MIN_POCKET:
            left.append(len(cells))
            continue
        cut = carve_to_main(cells, main_set)
        if cut:
            opened += 1
            continue
        wx = sum(minX + (c[0] + 0.5) * cell for c in cells) / len(cells)
        wz = sum(minZ + (c[1] + 0.5) * cell for c in cells) / len(cells)
        # No dry way in. If it touches water it is an island and a player swims
        # to it -- both of Ravenwater's are, and the sheet draws them. If it does
        # not, it is drawn land the map cannot be walked to from anywhere, and
        # leaving it is worse than losing it: the client grasses it over and the
        # player finds a lawn behind an invisible wall. Erase it to off-map.
        wet = any(rowlist[nz][nx] in 'Ww'
                  for x, z in cells
                  for nx, nz in ((x + 1, z), (x - 1, z), (x, z + 1), (x, z - 1))
                  if 0 <= nx < W and 0 <= nz < H)
        if wet:
            walled.append((len(cells), round(wx), round(wz), 'an island; swim'))
            continue
        for x, z in cells:
            rowlist[z][x] = ' '
        walled.append((len(cells), round(wx), round(wz), 'no way in at all; erased'))
    rows = [''.join(r) for r in rowlist]
    d['rows'] = rows
    print(f'  {len(comps) - 1} pockets off the mainland: opened {opened} with a corridor, '
          f'{len(walled)} sealed by water or the map edge, {len(left)} crevices left alone')
    for n, wx, wz, note in sorted(walled, reverse=True):
        print(f'    {n * cell * cell:.0f} m2 around ({wx}, {wz}): {note}')

    # A landmark is emitted where you can STAND, not where the pin is. East
    # Path's pin fell outside the drawn map -- 44 m of void between it and the
    # nearest ground -- so the road stopped at the map edge while the marker
    # floated off it, and nobody could find the way out. The routing node is
    # already snapped to walkable ground; the marker now agrees with it.
    final_main = main_component(camp_cell)
    stood = []

    def stand_world(key, px, py):
        wx, wz = world(px, py)
        gx0, gz0 = to_cell(px, py)
        # Water is not a wall: a player swims. Ravenwater's marker belongs on the
        # black pool the sheet draws, not dragged 44 m onto the bank, so only a
        # pin in the rock or off the edge of the drawing gets moved.
        if (gx0, gz0) in final_main or rows[gz0][gx0] in 'Ww':
            return wx, wz
        gx, gz = nodes.get(key, (-1, -1))
        if (gx, gz) in final_main:
            sx = round(minX + (gx + 0.5) * cell, 1)
            sz = round(minZ + (gz + 0.5) * cell, 1)
            stood.append((key, round(math.hypot(sx - wx, sz - wz), 1)))
            return sx, sz
        return wx, wz

    # --- bridges ----------------------------------------------------------
    # A bridge belongs where a road MEETS a river, and nowhere else. Placing them
    # by hand off the drawing put all six in the wrong place -- up to 13 units
    # off the water and 14 to 71 units from the nearest path -- while all five
    # real crossings stayed fords. So they are computed: intersect every path
    # with every river, snap the hit onto the centreline, and merge hits that
    # land on top of each other. BRIDGES above no longer places anything; it only
    # tells the router where the drawing says to cross.
    def seg_hit(p1, p2, p3, p4):
        d1x, d1z = p2[0] - p1[0], p2[1] - p1[1]
        d2x, d2z = p4[0] - p3[0], p4[1] - p3[1]
        den = d1x * d2z - d1z * d2x
        if abs(den) < 1e-9:
            return None
        t = ((p3[0] - p1[0]) * d2z - (p3[1] - p1[1]) * d2x) / den
        u = ((p3[0] - p1[0]) * d1z - (p3[1] - p1[1]) * d1x) / den
        if not (0.0 <= t <= 1.0 and 0.0 <= u <= 1.0):
            return None
        return (p1[0] + d1x * t, p1[1] + d1z * t)

    def on_centreline(pt, wp):
        """The nearest point ON the polyline, so a deck is never beside the water."""
        best, bd = pt, 1e18
        for i in range(len(wp) - 1):
            (ax0, az0), (bx0, bz0) = wp[i], wp[i + 1]
            dx, dz = bx0 - ax0, bz0 - az0
            L2 = dx * dx + dz * dz or 1.0
            t = max(0.0, min(1.0, ((pt[0] - ax0) * dx + (pt[1] - az0) * dz) / L2))
            q = (ax0 + dx * t, az0 + dz * t)
            dd = math.hypot(pt[0] - q[0], pt[1] - q[1])
            if dd < bd:
                best, bd = q, dd
        return best

    river_bridges = {}
    crossings = 0
    for name, width, wp in rivers_w:
        hits = []
        for kind, a, b, pts in paths:
            for i in range(len(pts) - 1):
                for j in range(len(wp) - 1):
                    h = seg_hit(pts[i], pts[i + 1], wp[j], wp[j + 1])
                    if h is None:
                        continue
                    crossings += 1
                    q = on_centreline(h, wp)
                    # one deck per crossing: a road that wanders in and out of
                    # the water must not grow a row of bridges
                    if any(math.hypot(q[0] - e[0], q[1] - e[1]) < 14 for e in hits):
                        continue
                    hits.append(q)
        river_bridges[name] = hits
    built = sum(len(v) for v in river_bridges.values())
    print(f'  {crossings} path/river crossings -> {built} bridges, '
          f'one per crossing, all on the centreline')

    # --- hills ------------------------------------------------------------
    hills = []
    for px, py, r, depth in HOLLOWS:
        wx, wz = world(px, py)
        hills.append((round(wx, 1), round(wz, 1), float(r), float(depth)))
    for wx, wz, r, h in BANKS:
        hills.append((wx, wz, float(r), float(h)))
    for px, py, m in CONTOURS:
        wx, wz = world(px, py)
        hgt = (m - REF_M) / (HIGH_M - LOW_M) * MAX_RISE
        if hgt < 0:
            hgt *= BASIN_SCALE
        # A 340 m peak is a tight crown; a 60 m dip in the fen is a broad swell.
        # a peak is a tight crown, a basin is a broad swell either way
        rad = 120 + (1.0 - abs(m - REF_M) / (HIGH_M - REF_M)) * 90
        hills.append((round(wx, 1), round(wz, 1), round(rad, 1), round(hgt, 1)))

    # --- boundary ---------------------------------------------------------
    # The outline of everything the trace calls land, as a ray cast out from the
    # middle. The zone is broadly convex, so this follows the drawn edge closely
    # and cannot come out self-intersecting the way a marching outline can.
    # 96 rays, but each vertex is the FURTHEST land in its whole sector rather
    # than the land on one ray. A ray every 3.75 degrees is 26 m apart out at the
    # rim, and the chord between two rays cuts the corner off every bulge of
    # drawn land -- which is an invisible wall standing on ground the blueprint
    # says you can walk: 766 m2 of it in one piece on the south-west rim, plus
    # eight smaller slices. Circumscribing instead can only ever include VOID,
    # and void is off-map terrain, which collision already refuses. So the
    # polygon is now a backstop and the trace does the work, which is the right
    # way round.
    cx0, cz0 = W / 2, H / 2
    NRAY, SUB = 96, 7
    boundary = []
    rmax = math.hypot(W, H)
    for i in range(NRAY):
        best = None
        for s in range(SUB):
            a = (i + (s - (SUB - 1) / 2) / SUB) / NRAY * math.tau
            r = rmax
            while r > 2:
                x, z = int(cx0 + math.cos(a) * r), int(cz0 + math.sin(a) * r)
                if 0 <= x < W and 0 <= z < H and rows[z][x] != ' ':
                    break
                r -= 1
            if r > 2 and (best is None or r > best):
                best = r
        if best is None:
            continue
        # half a cell of slack, so the rim cell's own centre is safely inside
        a = i / NRAY * math.tau
        rr = best + 0.75
        boundary.append((round(minX + (cx0 + math.cos(a) * rr + 0.5) * cell, 1),
                         round(minZ + (cz0 + math.sin(a) * rr + 0.5) * cell, 1)))

    # --- write it out -----------------------------------------------------
    L = []
    A = L.append
    A('// The Dark Woods.')
    A('//')
    A('// GENERATED by tools/build_darkwoods.py from tools/blueprints/dark_woods.webp')
    A('// and the trace in tools/darkwoods.terrain.json. Do not hand-edit: change')
    A('// the tables in the tool and re-run it.')
    A('//')
    A(f'// {d["w"] * cell:.0f} x {d["h"] * cell:.0f} units, authored at final size --')
    A('// there is no scale pass, so what is written here is where it ends up.')
    A('')
    A('export const darkwoods = {')
    A("  id: 'darkwoods',")
    A("  name: 'The Dark Woods',")
    A("  subtitle: 'A shadowed woodland of ancient paths, cursed groves, ruins and hidden danger.',")
    camp = [p for p in POIS if p[0] == 'camp'][0]
    sx, sz = world(camp[3], camp[4])
    # You arrive on the camp's south road, facing in toward the fire.
    A(f'  spawn: {{ x: {sx}, z: {sz + 12}, yaw: 3.14 }},')
    A(f'  bounds: {{ minX: {minX}, maxX: {round(minX + W * cell, 1)}, '
      f'minZ: {minZ}, maxZ: {round(minZ + H * cell, 1)} }},')
    A('  boundaryInset: 0,')
    A('  safeSpawnRadius: 40,')
    A('')
    A('  boundary: [')
    for i in range(0, len(boundary), 6):
        chunk = boundary[i:i + 6]
        A('    ' + ' '.join('{ x: %g, z: %g },' % p for p in chunk))
    A('  ],')
    A('')
    A('  // The drawing\'s contour numbers, compressed into ground you can walk.')
    A('  hills: [')
    for x, z, r, h in hills:
        A(f'    {{ x: {x}, z: {z}, r: {r}, h: {h} }},')
    A('  ],')
    A('')
    A('  pois: [')
    for key, name, sub, px, py, kind, r in POIS:
        wx, wz = stand_world(key, px, py)
        A(f"    {{ key: '{key}', name: '{name}', note: '{sub}', "
          f"x: {wx}, z: {wz}, kind: '{kind}', r: {r} }},")
    for key, name, sub, px, py, side in EXITS:
        wx, wz = stand_world(key, px, py)
        A(f"    {{ key: '{key}', name: '{name}', note: '{sub}', "
          f"x: {wx}, z: {wz}, kind: 'exit', side: '{side}', r: 14 }},")
    A('  ],')
    if stood:
        print('  markers moved onto ground you can stand on: '
              + ', '.join(f'{k} ({d} u)' for k, d in stood))
    A('')
    A('  rivers: [')
    for name, width, wp in rivers_w:
        pstr = ', '.join('{ x: %g, z: %g }' % p for p in wp)
        brs = [(round(x, 1), round(z, 1)) for x, z in river_bridges.get(name, [])]
        bstr = ', '.join('{ x: %g, z: %g }' % b for b in brs)
        A(f"    {{ name: '{name}', width: {width}, bridges: [{bstr}],")
        A(f'      points: [{pstr}] }},')
    A('  ],')
    A('')
    A('  paths: [')
    for kind, a, b, pts in paths:
        pstr = ', '.join('{ x: %g, z: %g }' % (round(p[0], 1), round(p[1], 1)) for p in pts)
        A(f"    {{ kind: '{kind}', from: '{a}', to: '{b}', points: [{pstr}] }},")
    A('  ],')
    A('')
    # The traced grid carries every cliff, so there are no separate collision
    # rocks -- but the client iterates both of these without a guard, and an
    # absent array is a crash rather than an empty one.
    # The way into the Spider Den. Its sheet is a cave network you descend, and
    # for a long time the arch was decoration with a bowl of webs behind it --
    # there was no in. Standing in the arch now takes you to zone 2.
    A('  portals: [')
    arch = [pr for pr in PROPS if pr[2] == 'Rock_Arch'][0]
    awx, awz = world(arch[0], arch[1])
    A(f"    {{ x: {awx}, z: {round(awz + 1.5, 1)}, r: 4.2, to: 'spiderden', "
      "spawn: { x: 0, z: -136, yaw: 3.14 } },")
    A('  ],')
    A('')
    A('  rocks: [],')
    A('  hazards: [],')
    # A hand-typed 4200 of which the generator could only ever place 2266. The
    # spacing rule caps a wood at one tree per 9 m (6.5 m where the blueprint
    # traced dense forest), and over the 124,000 m2 of wood on this map that
    # allows around 2400 -- so the number asked for nearly double what the
    # rules permit and the build reported neither the ask nor the shortfall.
    # Derived from the traced grid instead: count the wooded cells and divide
    # by the area one tree is given.
    wooded = sum(1 for r in rows for c in r if c in 'fF')
    dense_n = sum(1 for r in rows for c in r if c == 'F')
    cell_a = cell * cell
    # 9 m spacing in light wood, 6.5 m where it is dense. The 0.58 is the
    # packing fraction the rejection sampler actually reaches, measured rather
    # than assumed: asking for more than this makes it grind without placing
    # anything extra -- 2200 places 2115, 2800 still places only 2182.
    cap = ((wooded - dense_n) * cell_a / (math.pi * 4.5 ** 2)
           + dense_n * cell_a / (math.pi * 3.25 ** 2)) * 0.58
    tree_n = int(cap)
    A(f'  treeCount: {tree_n},')
    print(f'  {wooded} wooded cells ({dense_n} dense) -> asking for {tree_n} trees')
    A('  treeSeed: 20260925,')
    A('  scatterSeed: 7,')
    A('')
    def nearest_path(x, z):
        """(distance, unit vector from the point toward the nearest path)."""
        best, vec = 1e9, (0.0, 1.0)
        for _k, _a, _b, pts in paths:
            for i in range(len(pts) - 1):
                (x0, z0), (x1, z1) = pts[i], pts[i + 1]
                ddx, ddz = x1 - x0, z1 - z0
                L2 = ddx * ddx + ddz * ddz or 1.0
                t = max(0.0, min(1.0, ((x - x0) * ddx + (z - z0) * ddz) / L2))
                px, pz = x0 + ddx * t, z0 + ddz * t
                d = math.hypot(x - px, z - pz)
                if d < best:
                    best = d
                    n = d or 1.0
                    vec = ((px - x) / n, (pz - z) / n)
        return best, vec

    # Where each fenced yard actually ends up, solved ONCE. The fence, the gate
    # and the animals all have to agree on it: the first pass moved the yard off
    # the road and left the birds standing where they had always stood, which
    # put every hen outside its own fence, and the cows 20 m outside theirs.
    YARDS = {}
    for key, (ring_r, clear) in ROAD_FACING.items():
        ax, az = world(*SPAWN_ANCHORS[key])
        d, (vx, vz) = nearest_path(ax, az)
        if d < ring_r + clear:
            push = (ring_r + clear) - d
            ax, az = round(ax - vx * push, 1), round(az - vz * push, 1)
            d, (vx, vz) = nearest_path(ax, az)
        # the layout's gate sits at -dz, so turn -dz toward the road
        YARDS[key] = (ax, az, math.atan2(vx, vz) - math.pi)
        print(f'  {key}: fronts its road, fence {d:.1f}u clear of it')

    A('  spawns: [')
    for key, typ, lvl, n, r, roam in SPAWNS:
        if key in YARDS:
            wx, wz, _spin = YARDS[key]
            # Penned animals stay in the pen. Their roam radius was wider than
            # the ring that was later built round them.
            r = min(r, ROAD_FACING[key][0] - 2.5)
            roam = min(roam, ROAD_FACING[key][0] - 3.5)
        elif key in SPAWN_ANCHORS:
            wx, wz = world(*SPAWN_ANCHORS[key])
        else:
            poi = [q for q in POIS if q[0] == key][0]
            wx, wz = world(poi[3], poi[4])
        A(f"    {{ type: '{typ}', level: {lvl}, count: {n}, "
          f'cx: {wx}, cz: {wz}, r: {round(r, 1)}, roam: {round(roam, 1)} }},')
    A('  ],')
    A('')
    A('  scatter: [')
    for model, near, n, r in ORE:
        A(f"    {{ model: '{model}', count: {n}, near: '{near}', nearR: {r} }},")
    for spec in SCATTER:
        model, n, near, nearR = spec[0], spec[1], spec[2], spec[3]
        flag = spec[4] if len(spec) > 4 else None
        extra = f", near: '{near}', nearR: {nearR}" if near else ''
        # True is the old spelling of 'shore'. 'open' is the inverse bias: it
        # sends a species toward the clearings instead of under the canopy.
        if flag is True or flag == 'shore':
            extra += ', shore: 1, shoreR: 8'
        elif flag == 'open':
            extra += ', open: 1'
        A(f"    {{ model: '{model}', count: {n}{extra} }},")
    A('  ],')
    A('')
    # --- the boardwalks -----------------------------------------------
    A('  // Plank walks over the Murkfen. Laid along the drawing\'s own lines,')
    A('  // one span per grid unit, turned to follow. These are DECKS: the client')
    A('  // renders them at terrain height and lifts you onto them.')
    A('  decks: [')
    # The walks are laid on the ROADS, wherever a road runs over the fen. That
    # makes them the crossing rather than scenery beside it: both ends join a
    # path because they ARE the path, and no span can end up on dry rock
    # because a span is only laid where the ground is wet.
    SPAN, HALF_W = 3.9, 2.4          # 3.9 so consecutive decks overlap slightly
    LANDFALL = 3.2                   # carry the walk this far onto the bank
    deck_rows, spans = [], 0

    def wet_here(x, z):
        gx = int((x - minX) / cell)
        gz = int((z - minZ) / cell)
        if gx < 0 or gz < 0 or gx >= W or gz >= H:
            return False
        return (gx, gz) in deck_cells

    for kind, a, b, pts in paths:
        # walk the route finely and find the stretches that are over the fen
        samples = []
        for i in range(len(pts) - 1):
            (x0, z0), (x1, z1) = pts[i], pts[i + 1]
            seg_len = math.hypot(x1 - x0, z1 - z0)
            n = max(1, int(seg_len / 0.8))
            for k in range(n):
                t = k / n
                samples.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))
        samples.append(pts[-1])

        runs, cur = [], []
        for (x, z) in samples:
            if wet_here(x, z):
                cur.append((x, z))
            elif cur:
                runs.append(cur)
                cur = []
        if cur:
            runs.append(cur)

        for run in runs:
            # arc length of this stretch, plus a landfall at each end so the
            # walk finishes on the bank instead of at the waterline
            if len(run) < 2:
                continue
            total = sum(math.dist(run[i], run[i + 1]) for i in range(len(run) - 1))
            if total < 6.0:
                continue                       # a puddle, not a crossing
            def at(dist):
                """A point `dist` along the run, extrapolating past either end."""
                if dist <= 0:
                    (ax, az), (bx, bz) = run[0], run[min(1, len(run) - 1)]
                    seg_len = math.hypot(bx - ax, bz - az) or 1.0
                    return (ax + (ax - bx) / seg_len * -dist, az + (az - bz) / seg_len * -dist)
                acc = 0.0
                for i in range(len(run) - 1):
                    seg_len = math.dist(run[i], run[i + 1])
                    if acc + seg_len >= dist:
                        t = (dist - acc) / (seg_len or 1.0)
                        return (run[i][0] + (run[i + 1][0] - run[i][0]) * t,
                                run[i][1] + (run[i + 1][1] - run[i][1]) * t)
                    acc += seg_len
                (ax, az), (bx, bz) = run[-2], run[-1]
                seg_len = math.hypot(bx - ax, bz - az) or 1.0
                over = dist - total
                return (bx + (bx - ax) / seg_len * over, bz + (bz - az) / seg_len * over)

            start, end = -LANDFALL, total + LANDFALL
            n = max(2, int(round((end - start) / SPAN)))
            prev_yaw = None
            for k in range(n):
                d0 = start + (end - start) * k / n
                d1 = start + (end - start) * (k + 1) / n
                (px0, pz0), (px1, pz1) = at(d0), at(d1)
                x, z = (px0 + px1) / 2, (pz0 + pz1) / 2
                yaw = math.atan2(px1 - px0, pz1 - pz0) - math.pi / 2
                # a turn sharper than about 25 degrees gets the corner piece,
                # which is what the kit's Boardwalk_Corner is for and what the
                # first pass never once used
                turn = None
                if prev_yaw is not None:
                    dyaw = (yaw - prev_yaw + math.pi) % math.tau - math.pi
                    if abs(dyaw) > 0.44:
                        turn = True
                m = 'Boardwalk_Corner' if turn else BOARDWALK_VARIANTS[spans % len(BOARDWALK_VARIANTS)]
                deck_rows.append((m, round(x, 1), round(z, 1), round(yaw, 4), HALF_W))
                prev_yaw = yaw
                spans += 1

    # The fishing head, and a short spur out to it. Its position is COMPUTED
    # from the laid walk rather than authored: pick the span standing in the
    # deepest water and step off it into the fen. Authored by pixel, the jetty
    # belonged to the old hand-drawn network and was left stranded 45 metres
    # from anything the moment the walk was routed properly -- and a 45 metre
    # spur to reach it would have run most of its length over dry ground.
    def cell_at(x, z):
        gx = int((x - minX) / cell)
        gz = int((z - minZ) / cell)
        if gx < 0 or gz < 0 or gx >= W or gz >= H:
            return ' '
        return rows[gz][gx]

    # Search for the best head rather than guessing an offset: the crossings the
    # roads take are narrow, so a fixed step to the side lands on the bank. Score
    # every wet spot within reach of the walk by how deep it is and how far out
    # it stands, and run a spur to the winner.
    jx = jz = None
    if deck_rows:
        best, best_score = None, -1.0
        for anchor in deck_rows:
            for i in range(24):
                a = i / 24 * math.tau
                for reach in (4.5, 6.0, 7.5, 9.0, 10.5):
                    cx = anchor[1] + math.cos(a) * reach
                    cz = anchor[2] + math.sin(a) * reach
                    c = cell_at(cx, cz)
                    if c not in 'Ww':
                        continue
                    # how much open water is around it? a head wants a view
                    wet = sum(1 for j in range(8)
                              if cell_at(cx + math.cos(j / 8 * math.tau) * 5.0,
                                         cz + math.sin(j / 8 * math.tau) * 5.0) in 'Ww')
                    score = wet * 2 + (3 if c == 'W' else 0) + reach * 0.2
                    if score > best_score:
                        best_score, best = score, (anchor, cx, cz, reach)
        if best:
            anchor, jx, jz, reach = best
            ax, az = anchor[1], anchor[2]
            yaw = math.atan2(jx - ax, jz - az) - math.pi / 2
            n = max(1, int(round(reach / SPAN)))
            for k in range(1, n + 1):
                t = k / (n + 1)
                deck_rows.append((BOARDWALK_VARIANTS[spans % len(BOARDWALK_VARIANTS)],
                                  round(ax + (jx - ax) * t, 1), round(az + (jz - az) * t, 1),
                                  round(yaw, 4), HALF_W))
                spans += 1
    if jx is None:                            # nothing wet enough: leave it put
        jx, jz = world(*[(f[1], f[2]) for f in FISHING if f[0] == 'fs_jetty'][0])
    jetty_at = (round(jx, 1), round(jz, 1))

    # A wide head at each deep pocket the walks now reach. These are the ends of
    # the trails out into the fen, so there is already plank up to them; the
    # head is what makes an end of a walk somewhere to stand rather than a stop.
    for key in ('fen_deep_e', 'fen_deep_w'):
        hx, hz = world(*WAYPOINTS[key])
        if deck_rows:
            near = min(deck_rows, key=lambda r: math.hypot(r[1] - hx, r[2] - hz))
            yaw = math.atan2(hx - near[1], hz - near[2]) - math.pi / 2
        else:
            yaw = 0.0
        deck_rows.append(('Boardwalk_Jetty', round(hx, 1), round(hz, 1), round(yaw, 4), 3.6))

    for m, x, z, yaw, w in deck_rows:
        A(f"    {{ m: '{m}', x: {x}, z: {z}, yaw: {yaw}, len: 4.0, w: {w} }},")
    A(f"    {{ m: 'Boardwalk_Jetty', x: {round(jx,1)}, z: {round(jz,1)}, yaw: 0, len: 4.0, w: 3.6 }},")
    A('  ],')
    print(f'  {len(deck_rows) + 1} plank spans laid on the fen crossings')
    A('')
    A('  props: [')
    for px, py, model, yaw, sc, coll in PROPS:
        wx, wz = world(px, py)
        A(f"    {{ m: '{model}', x: {wx}, z: {wz}, yaw: {yaw}, s: {sc}, c: {coll} }},")
    for model, px, py, yaw in MARKERS:
        wx, wz = world(px, py)
        A(f"    {{ m: '{model}', x: {wx}, z: {wz}, yaw: {yaw}, s: 1, c: 1.2 }},")
    # The Murkfen's two watchtowers stand BESIDE the plank walk -- its sheet
    # puts them over the marsh watching the crossing, and authored by pixel they
    # ended up 31 and 57 metres from the walk once it was routed properly. So
    # they are hung off the laid decks: a third and two thirds of the way along,
    # set off to one side so they do not block the planks.
    if len(deck_rows) >= 6:
        for frac in (0.33, 0.72):
            r = deck_rows[int(len(deck_rows) * frac)]
            ox, oz = math.cos(r[3]) * 4.6, -math.sin(r[3]) * 4.6
            A(f"    {{ m: 'Stilt_Watchtower', x: {round(r[1] + ox, 1)}, "
              f'z: {round(r[2] + oz, 1)}, yaw: {round(r[3], 4)}, s: 1, c: 1.9 }},')
    # The camps, laid out to their sheets rather than scattered.
    #
    # The gateways are NOT authored. A palisade with hand-placed gaps is the
    # farm fence bug waiting to happen -- guess the bearing the road leaves on,
    # and the road walks into a fence with no gate. So the ring goes all the way
    # round and anything solid standing where a path runs is removed: the
    # gateway is wherever the road actually is, by construction.
    def path_clear(x, z, want):
        near = 1e9
        for _k, _a, _b, pts in paths:
            for i in range(len(pts) - 1):
                (x0, z0), (x1, z1) = pts[i], pts[i + 1]
                ddx, ddz = x1 - x0, z1 - z0
                L2 = ddx * ddx + ddz * ddz or 1.0
                t = max(0.0, min(1.0, ((x - x0) * ddx + (z - z0) * ddz) / L2))
                near = min(near, math.hypot(x - (x0 + ddx * t), z - (z0 + ddz * t)))
        return near >= want

    laid = 0
    gateways = 0
    for key, fn in LAYOUTS:
        # A layout may sit on a landmark OR on a spawn anchor -- the hen yard
        # and the cow field are anchored to where their animals actually are,
        # not to a POI, because that is what the fence has to enclose.
        if key in SPAWN_ANCHORS:
            ax, az = world(*SPAWN_ANCHORS[key])
        else:
            poi = [q for q in POIS if q[0] == key][0]
            ax, az = world(poi[3], poi[4])
        if key in YARDS:
            ax, az, spin = YARDS[key]
        else:
            spin = 0.0
        cs, sn = math.cos(spin), math.sin(spin)
        pieces = fn()
        # A GATE HAS TO BE A HOLE. The fence ring is laid with its panels
        # abutting -- that is what makes it a fence rather than a row of posts
        # -- and the gate was then placed ON TOP of it rather than instead of
        # it. Measured: the widest gap in either farmyard ring was eleven
        # CENTIMETRES, so both were sealed and a player could not get in.
        # Maggie's henhouse quest sends you in there for eggs.
        #
        # The same lesson as the camp palisade, which learned it by having its
        # gateways cut by the roads that actually run through it: do not author
        # an opening, REMOVE what is standing in it.
        gates = [(dx0, dz0) for m, dx0, dz0, *_ in pieces if m.endswith('_Gate')]
        GATE_HALF = 1.6              # Farm_Gate is 1.85 m wide; clear a little more
        for model, dx0, dz0, yaw0, sc, coll in pieces:
            if coll > 0 and not model.endswith('_Gate') \
               and any(math.hypot(dx0 - gx, dz0 - gz) < GATE_HALF for gx, gz in gates):
                gateways += 1
                continue
            dx, dz = dx0 * cs + dz0 * sn, -dx0 * sn + dz0 * cs
            yaw = yaw0 + spin
            wx, wz = round(ax + dx, 1), round(az + dz, 1)
            if coll > 0 and not path_clear(wx, wz, 3.6):
                gateways += 1
                continue
            A(f"    {{ m: '{model}', x: {wx}, z: {wz}, "
              f'yaw: {yaw}, s: {sc}, c: {coll} }},')
            laid += 1
    A('  ],')
    A('')
    # --- the fences, as WALLS --------------------------------------------
    # A row of collision circles is not a fence: standing between two of them
    # the two pushes point along the row, cancel, and you walk through. These
    # are the same four sides the panels were laid on, as segments, with a hole
    # wherever the gate is or a road crosses -- the gateway is where the road
    # actually is, not where anyone guessed it would be.
    A('  // The farmyard fences as solid runs. The panels above are what you')
    A('  // SEE; these are what you bump into. One description makes both.')
    A('  fences: [')
    fence_runs = 0
    for key, spec in YARD_FENCE.items():
        ax, az = world(*SPAWN_ANCHORS[key]) if key in SPAWN_ANCHORS else (0.0, 0.0)
        if key in YARDS:
            ax, az, spin = YARDS[key]
        else:
            spin = 0.0
        cs, sn = math.cos(spin), math.sin(spin)
        gx, gz = _gate_point(spec)
        def to_world(lx, lz):
            return (ax + lx * cs + lz * sn, az - lx * sn + lz * cs)
        for side, (x0, z0, x1, z1) in _fence_sides(spec).items():
            run_len = math.hypot(x1 - x0, z1 - z0)   # not `L`: that is the output
            n = max(2, int(run_len / 0.5))
            open_at = []
            for i in range(n + 1):
                tt = i / n
                lx, lz = x0 + (x1 - x0) * tt, z0 + (z1 - z0) * tt
                wx, wz = to_world(lx, lz)
                open_at.append(math.hypot(lx - gx, lz - gz) < spec['gatew'] / 2
                               or not path_clear(wx, wz, 3.2))
            i = 0
            while i <= n:
                if open_at[i]:
                    i += 1
                    continue
                j = i
                while j + 1 <= n and not open_at[j + 1]:
                    j += 1
                if (j - i) / n * run_len >= 1.0:          # a stub shorter than a stride is not a wall
                    ax0, az0 = to_world(x0 + (x1 - x0) * (i / n), z0 + (z1 - z0) * (i / n))
                    ax1, az1 = to_world(x0 + (x1 - x0) * (j / n), z0 + (z1 - z0) * (j / n))
                    A(f'    {{ x1: {round(ax0, 1)}, z1: {round(az0, 1)}, '
                      f'x2: {round(ax1, 1)}, z2: {round(az1, 1)}, r: 0.35 }},')
                    fence_runs += 1
                i = j + 1
    A('  ],')
    A('')
    # --- the worn ground inside them ------------------------------------
    # Anywhere animals are kept and fed, the grass goes. The dirt field the
    # roads are drawn with takes discs as well as lines, and it was only ever
    # given lines -- so the pens were lawns with hens standing on them.
    A('  // Ground the stock has worn bare: the same dirt field the roads use,')
    A('  // so a patch that meets the gateway is one piece with the road.')
    A('  dirt: [')
    patches = 0
    for key, spec in YARD_FENCE.items():
        if key in YARDS:
            ax, az, spin = YARDS[key]
        elif key in SPAWN_ANCHORS:
            ax, az = world(*SPAWN_ANCHORS[key]); spin = 0.0
        else:
            continue
        cs, sn = math.cos(spin), math.sin(spin)
        gx, gz = _gate_point(spec)
        hw, hd = spec['hw'], spec['hd']
        # Where the birds actually stand: the gateway, the middle of the yard,
        # and a scuff under each side of the housing. Radii are a fraction of
        # the pen so a bigger yard wears a bigger patch.
        # PATCHES, not a blanket: the first pass gave the middle a radius of a
        # third of the pen and fed it a three-metre feather, and six of those
        # overlapped into one bare lot with a fence round it.
        spots = [(gx * 0.80, gz * 0.80, hw * 0.17), (0.0, 0.0, hw * 0.19),
                 (-hw * 0.46, hd * 0.55, hw * 0.13), (hw * 0.44, hd * 0.52, hw * 0.12),
                 (hw * 0.50, -hd * 0.44, hw * 0.11), (-hw * 0.52, -hd * 0.40, hw * 0.10),
                 (hw * 0.10, hd * 0.24, hw * 0.09), (-hw * 0.22, -hd * 0.18, hw * 0.08)]
        for lx, lz, r in spots:
            wx = round(ax + lx * cs + lz * sn, 1)
            wz = round(az - lx * sn + lz * cs, 1)
            A(f'    {{ x: {wx}, z: {wz}, r: {round(r, 1)}, fr: {round(r * 0.55, 1)} }},')
            patches += 1
    A('  ],')
    A('')
    print(f'  farmyard fences: {fence_runs} solid runs with their gateways cut, '
          f'{patches} patches of worn ground inside them')
    A('  // Assembled from the modular ruin kit on its 4 m grid. Collision comes')
    A('  // from the pieces themselves -- see _walls in server.js.')
    A('  structures: [')
    for key, px, py, yaw, padw, padd, layout in STRUCTURES:
        wx, wz = world(px, py)
        A(f"    {{ key: '{key}', x: {wx}, z: {wz}, yaw: {yaw}, padW: {padw}, padD: {padd},")
        A('      pieces: [')
        for m, dx, dy, dz, pyaw, wall, gap in layout():
            A(f"        {{ m: '{m}', dx: {round(dx,2)}, dy: {round(dy,2)}, dz: {round(dz,2)}, "
              f"yaw: {round(pyaw,4)}, wall: {wall}, gap: {gap} }},")
        A('      ] },')
    A('  ],')
    A('')
    # A fishing spot on dry land is just a confusing prompt in a field, and
    # three of them were: two in the Murkfen and one that had been authored
    # against the OLD Crowwater centreline and was left 54 metres from the
    # river when that got re-traced. So the authored pixel is a hint and the
    # generator snaps it to the nearest water -- a wet cell or a river channel.
    # Where the game actually DRAWS water, which is not the same as where the
    # traced grid says 'W'. The client contours the BLURRED field against
    # waterEdge and the server decides swimming off the same numbers, so a lone
    # wet cell with dry ground all round it blurs away to nothing: there is no
    # water on it, you cannot swim in it, and you cannot fish it.
    #
    # fs_murkfen_w sat on a 'W' cell whose blurred wet value was 0.256 against
    # a 0.44 waterline. The spot passed every check there was, rendered its
    # ripple rings on grass, and a player stood in a field casting into it.
    # This is the same lesson as the 766 cells of swimming on dry land, in the
    # one place that had not learned it yet.
    def water_drawn(wx, wz, margin=0.0):
        """True where the client would draw water and the server would let you
        swim -- the contour, not the cell.

        `margin` asks for water with something in hand. The sheet is only built
        where the surface is above the GROUND as well as inside the contour, and
        at the very edge of the contour the carve has barely begun: fs_murkfen_w
        passed every field test while its ground sat three centimetres above the
        waterline, so no sheet was drawn over it and its ripple rings sat on
        grass. The builder cannot evaluate terrainHeight -- that lives in the
        client -- but the field and the carve rise together, so asking for a
        little depth in the field asks for a little water over the bed."""
        if field_at(wx, wz, 'wet') >= WATER_EDGE['marsh'] + margin:
            return True
        if field_at(wx, wz, 'deep') >= WATER_EDGE['deep'] + margin:
            return True
        for _name, width, wp in rivers_w:         # a river channel is always water
            q = on_centreline((wx, wz), wp)
            if math.hypot(wx - q[0], wz - q[1]) < width / 2:
                return True
        return False

    def snap_to_water(wx, wz, limit=70):
        if water_drawn(wx, wz):
            return (wx, wz), 0.0
        best, bd = None, 1e18
        for name, width, wp in rivers_w:
            q = on_centreline((wx, wz), wp)
            d = math.hypot(wx - q[0], wz - q[1])
            if d < width / 2:
                return (wx, wz), 0.0             # already in the channel
            if d < bd:
                bd, best = d, q
        # Search the GRID for the nearest wet cell and stand on its CENTRE. An
        # angular spiral gets close but not on: it found water at radius two and
        # put the spot at radius two along that bearing, which landed 1.3 m
        # short of the cell and still read as dry ground.
        gx0 = int((wx - minX) / cell)
        gz0 = int((wz - minZ) / cell)
        rc = int(limit / cell)
        for ring in range(1, rc):
            found = None
            for dz in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    if max(abs(dx), abs(dz)) != ring:
                        continue
                    gx, gz = gx0 + dx, gz0 + dz
                    if gx < 0 or gz < 0 or gx >= W or gz >= H:
                        continue
                    cx = minX + (gx + 0.5) * cell
                    cz = minZ + (gz + 0.5) * cell
                    if not water_drawn(cx, cz):
                        continue
                    dd = math.hypot(cx - wx, cz - wz)
                    if found is None or dd < found[1]:
                        found = ((cx, cz), dd)
            if found:
                if found[1] < bd:
                    bd, best = found[1], found[0]
                break
        if best is None:
            return (wx, wz), 0.0
        return (round(best[0], 1), round(best[1], 1)), bd

    # Anything you have to REACH must stand on ground you can stand on. Rock is
    # solid and deep water is solid to anything that cannot swim, so a chest or
    # an elite placed there is unopenable or gets shoved somewhere arbitrary by
    # collision. Two chests had been sealed in cliffs since before this pass --
    # the Grimroot cache and the smuggler's chest at the Den -- and squeezing
    # the chokepoints put more rock around both.
    def snap_to_ground(wx, wz, limit=40):
        if stand_at(wx, wz):
            return (wx, wz), 0.0
        gx0 = int((wx - minX) / cell)
        gz0 = int((wz - minZ) / cell)
        for ring in range(1, int(limit / cell)):
            found = None
            for dz in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    if max(abs(dx), abs(dz)) != ring:
                        continue
                    gx, gz = gx0 + dx, gz0 + dz
                    if gx < 0 or gz < 0 or gx >= W or gz >= H:
                        continue
                    cx = minX + (gx + 0.5) * cell
                    cz = minZ + (gz + 0.5) * cell
                    # stand_at, not dry_walk: this is where something is going
                    # to be PUT, and the slope margin is the whole point.
                    if not stand_at(cx, cz):
                        continue
                    dd = math.hypot(cx - wx, cz - wz)
                    if found is None or dd < found[1]:
                        found = ((cx, cz), dd)
            if found:
                return (round(found[0][0], 1), round(found[0][1], 1)), found[1]
        return (wx, wz), 0.0

    # You fish a spot from the BANK -- fishing.js says so in as many words and
    # puts the reach at 4.5 m. A spot further than that from anywhere you can
    # stand can only be reached by swimming out to it, which is not fishing.
    # Both Ravenwater spots were out in the open pool.
    FISH_REACH = 4.5

    # How far inside the contour a fishing spot has to sit before there is
    # reliably water over the bed rather than a damp field. Measured: at the
    # bare contour the ground can still be above the waterline.
    WET_MARGIN = 0.055

    def standable(x, z):
        if water_drawn(x, z):
            return False
        return stand_at(x, z)

    def near_deck(x, z):
        for m, dx, dz, dyaw, dw in deck_rows:
            cs, sn = math.cos(dyaw), math.sin(dyaw)
            ox, oz = x - dx, z - dz
            if abs(ox * cs + oz * sn) <= 2.0 and abs(-ox * sn + oz * cs) <= dw / 2 + 0.5:
                return True
        return False

    def has_bank(x, z):
        for i in range(24):
            a = i / 24 * math.tau
            for rr in (1.6, 2.4, 3.2, 4.0, FISH_REACH - 0.1):
                px2, pz2 = x + math.cos(a) * rr, z + math.sin(a) * rr
                if near_deck(px2, pz2) or standable(px2, pz2):
                    return True
        return False

    def on_deck(x, z):
        """Actually standing ON the planks, rather than beside them."""
        for m, dx, dz, dyaw, dw in deck_rows:
            cs, sn = math.cos(dyaw), math.sin(dyaw)
            ox, oz = x - dx, z - dz
            if abs(ox * cs + oz * sn) <= 2.0 and abs(-ox * sn + oz * cs) <= dw / 2:
                return True
        return False

    def place_spot(x, z, limit=60.0):
        """Where a fishing spot belongs: in the water, at the EDGE of it, within
        a cast of somewhere a person is standing.

        This used to be three passes that each fixed one thing and undid the
        next -- snap onto water, wade out until it is deep enough, then drag
        back until a bank is in range -- and the last of them deliberately took
        the FURTHEST offset still within reach, which is how spots ended up as
        far out as the rule allowed. Three of them also came to rest on top of
        the fen's plank walks, because the water test knows about the contour
        and nothing about the planks, so the ripples were drawn on the decking.

        One pass and one objective instead: of every position that is properly
        in the water, is not on the boarding, and has somewhere to stand within
        casting reach, take the one nearest the place the sheet put it, and
        among those the one closest in to the bank. A fishing spot is a thing
        at the water's edge.
        """
        STAND_OFF = 3.0          # how far out from the bank we would like it
        best, bscore = None, 1e18
        step = cell / 2
        rings = int(limit / step)
        for ring in range(0, rings):
            n = max(8, ring * 10)
            for i in range(n):
                a = i / n * math.tau
                cx = x + math.cos(a) * ring * step
                cz = z + math.sin(a) * ring * step
                if on_deck(cx, cz):
                    continue                      # not on the planks
                if not water_drawn(cx, cz, WET_MARGIN):
                    continue                      # and in real water, not a damp field
                # how far to the nearest place a person can be
                stand = 1e18
                for j in range(24):
                    b = j / 24 * math.tau
                    for rr in (0.8, 1.6, 2.4, 3.2, 4.0, FISH_REACH - 0.2):
                        sx, sz = cx + math.cos(b) * rr, cz + math.sin(b) * rr
                        if standable(sx, sz) or near_deck(sx, sz):
                            stand = min(stand, rr)
                            break
                if stand > FISH_REACH - 0.2:
                    continue
                d = math.hypot(cx - x, cz - z)
                score = d + abs(stand - STAND_OFF) * 1.5
                if score < bscore:
                    bscore, best = score, (cx, cz, stand)
            if best and ring * step > bscore:
                break                              # no further ring can win
        if not best:
            print(f'    !! nowhere to fish within {limit:.0f}u of ({x:.1f},{z:.1f})')
            return (x, z), 0.0, -1.0
        return (round(best[0], 1), round(best[1], 1)), math.hypot(best[0] - x, best[1] - z), best[2]

    A('  fishingSpots: [')
    moved = 0
    offs = []
    for fid, px, py, tier in FISHING:
        # the jetty spot rides with the jetty, which is computed off the walk
        wx, wz = jetty_at if fid == 'fs_jetty' else world(px, py)
        (wx, wz), shift, stand = place_spot(wx, wz)
        if shift > 0.5:
            moved += 1
        offs.append(stand)
        A(f"    {{ id: '{fid}', x: {wx}, z: {wz}, tier: {tier} }},")
    A('  ],')
    A('')
    good = [o for o in offs if o >= 0]
    print(f'  {len(FISHING)} fishing spots, {moved} moved onto the water\'s edge; '
          f'a bank is {min(good):.1f}-{max(good):.1f} m away from each')
    A('  campfires: [')
    # Crow Hill's sheet draws a lit watchfire on the overlook platform -- the
    # thing that makes an abandoned lookout read as still watched. Its fire is
    # offset onto that platform so the light lands on the brazier rather than
    # inside the tower that stands on the POI itself.
    CAMPFIRE_AT = {'crowhill': (566, 694)}
    for key in ('camp', 'briar', 'crowhill'):
        poi = [q for q in POIS if q[0] == key][0]
        wx, wz = world(*CAMPFIRE_AT.get(key, (poi[3], poi[4])))
        A(f"    {{ id: 'cf_{key}', x: {wx}, z: {wz} }},")
    A('  ],')
    A('')
    def poi_world(key):
        if key in WAYPOINTS:
            return world(*WAYPOINTS[key])
        if key in SPAWN_ANCHORS:
            return world(*SPAWN_ANCHORS[key])
        q = [r for r in POIS if r[0] == key][0]
        return world(q[3], q[4])

    A('  npcs: [')
    for nid, nname, nmodel, idle, anchor, dx, dz in NPCS:
        ax, az = poi_world(anchor)
        A(f"    {{ id: '{nid}', name: '{nname}', x: {round(ax + dx, 1)}, z: {round(az + dz, 1)}, "
          f"model: '{nmodel}', poi: '{anchor}', yaw: 0,")
        A(f"      idle: '{idle}' }},")
    A('  ],')
    A('')
    A('  chests: [')
    dug = 0
    for cid, anchor, dx, dz in CHESTS:
        ax, az = poi_world(anchor)
        (cx, cz), shift = snap_to_ground(ax + dx, az + dz)
        if shift > 0.5:
            dug += 1
        A(f"    {{ id: '{cid}', x: {cx}, z: {cz} }},")
    if dug:
        print(f'  {dug} chest(s) dug out of solid ground')
    A('  ],')
    A('')
    A('  elites: [')
    shoved = 0
    for etype, ename, elvl, anchor, dx, dz in ELITES:
        ax, az = poi_world(anchor)
        (cx, cz), shift = snap_to_ground(ax + dx, az + dz)
        if shift > 0.5:
            shoved += 1
        A(f"    {{ type: '{etype}', name: '{ename}', level: {elvl}, "
          f'cx: {cx}, cz: {cz} }},')
    if shoved:
        print(f'  {shoved} elite(s) moved onto ground they can stand on')
    A('  ],')
    A('')
    # ----------------------------------------------------- quest objects
    # The placement, not the authoring. Every candidate is measured off the
    # routed paths and the traced grid, so a rebuild that moves a road moves
    # the lanterns standing along it.
    def path_dist(x, z):
        best = 1e9
        for _k, _a, _b, pts in paths:
            for i in range(len(pts) - 1):
                (x0, z0), (x1, z1) = pts[i], pts[i + 1]
                vx, vz = x1 - x0, z1 - z0
                L2 = vx * vx + vz * vz
                t = 0.0 if L2 < 1e-9 else max(0.0, min(1.0, ((x - x0) * vx + (z - z0) * vz) / L2))
                best = min(best, math.hypot(x - (x0 + vx * t), z - (z0 + vz * t)))
        return best

    def line_walk(kinds, step):
        """Points every `step` metres along the routed lines, with a bearing."""
        out, carry = [], 0.0
        for kind, _a, _b, pts in paths:
            if kind not in kinds:
                continue
            carry = 0.0
            for i in range(len(pts) - 1):
                (x0, z0), (x1, z1) = pts[i], pts[i + 1]
                seg = math.hypot(x1 - x0, z1 - z0)
                if seg < 1e-6:
                    continue
                yaw = math.atan2(x1 - x0, z1 - z0)
                t = carry
                while t < seg:
                    f = t / seg
                    out.append((x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, yaw))
                    t += step
                carry = t - seg
        return out

    # Dry cells with water within two cells of them: the creek banks, without
    # having to guess where a river ended up after it was traced.
    def bank_cells():
        out = []
        for gz in range(1, H - 1):
            for gx in range(1, W - 1):
                if rows[gz][gx] not in '.fF':
                    continue
                wet = any(rows[gz + dz][gx + dx] in 'wW'
                          for dz in (-2, -1, 0, 1, 2) for dx in (-2, -1, 0, 1, 2)
                          if 0 <= gz + dz < H and 0 <= gx + dx < W)
                if wet:
                    out.append((minX + (gx + 0.5) * cell, minZ + (gz + 0.5) * cell))
        return out

    def wood_cells():
        out = []
        for gz in range(H):
            for gx in range(W):
                if rows[gz][gx] in 'Ff':
                    out.append((minX + (gx + 0.5) * cell, minZ + (gz + 0.5) * cell))
        return out

    _banks, _woods = bank_cells(), wood_cells()
    # A lantern inside the chapel wall or a bush inside a tent is the trees-in-
    # the-tower bug again, so structure footprints are out of bounds.
    pads = []
    for key, fn in LAYOUTS:
        ax, az = poi_world(key)
        pads.append((ax, az, 17.0))
    for key in ('chapel', 'crowhill', 'fenshrine'):
        q = [t for t in POIS if t[0] == key]
        if q:
            wx, wz = world(q[0][3], q[0][4])
            pads.append((wx, wz, 15.0))

    def free_of_pads(x, z):
        return all(math.hypot(x - px, z - pz) > r for px, pz, r in pads)

    placed = []          # every object so far, so kinds do not stack on each other
    obj_rows = []
    rng = random.Random(90125)

    def take(cands, n, minsep, kind_sep=5.0):
        """Thin a candidate list down to n well-spread points."""
        rng.shuffle(cands)
        out = []
        for c in cands:
            x, z = c[0], c[1]
            if not free_of_pads(x, z):
                continue
            if any(math.hypot(x - o[0], z - o[1]) < minsep for o in out):
                continue
            if any(math.hypot(x - o[0], z - o[1]) < kind_sep for o in placed):
                continue
            out.append(c)
            placed.append((x, z))
            if len(out) >= n:
                break
        return out

    short = []
    for key, n, model, where, gives, extra in NODES:
        if where in ('road', 'trail'):
            # Off to the verge, alternating sides, so a cart is beside the road
            # rather than standing in it.
            pts = line_walk({where}, 26.0)
            cands = []
            for i, (x, z, yaw) in enumerate(pts):
                off = 3.4 if i % 2 else -3.4
                cands.append((round(x + math.cos(yaw) * off, 1),
                              round(z - math.sin(yaw) * off, 1), yaw))
            got = take(cands, n, 55.0)
        elif where == 'wood':
            # Deep enough in to feel like foraging, near enough to find.
            cands = [(round(x, 1), round(z, 1), 0.0) for x, z in _woods
                     if 9.0 <= path_dist(x, z) <= 26.0]
            got = take(cands, n, 34.0)
        elif where == 'bank':
            cands = [(round(x, 1), round(z, 1), 0.0) for x, z in _banks
                     if path_dist(x, z) <= 34.0]
            got = take(cands, n, 30.0)
        elif where == 'hill':
            crowns = sorted([h for h in hills if h[3] > 1.5], key=lambda h: -h[3])
            cands = [(h[0], h[1], 0.0) for h in crowns]
            got = take(cands, n, 40.0)
        else:                                   # poi:<key>
            ax, az = poi_world(where.split(':', 1)[1])
            cands = []
            for r in (13.0, 17.0, 21.0, 25.0):
                for i in range(0, 360, 18):
                    a = math.radians(i)
                    x, z = round(ax + math.cos(a) * r, 1), round(az + math.sin(a) * r, 1)
                    if stand_at(x, z) and cell_at(x, z) != 'w':
                        cands.append((x, z, a + math.pi))
            # A landmark's own objects DO belong inside its pad.
            saved, pads[:] = list(pads), []
            got = take(cands, n, 6.0, kind_sep=4.0)
            pads[:] = saved
        if len(got) < n:
            short.append(f'{key} {len(got)}/{n}')
        for i, (x, z, yaw) in enumerate(got):
            (gx, gz), _ = snap_to_ground(x, z)
            # There is only one camp larder and one Woodfang banner, and the
            # quests name them outright -- `object: 'banner'`, not a tag. So a
            # kind with a single member keeps the bare id; only sets get
            # numbered. questcheck compares the two lists now, which is how
            # 'banner' vs 'banner_1' turned up at all.
            oid = key if n == 1 else f'{key}_{i + 1}'
            f = [f"id: '{oid}'", f"tag: '{key}'", f"m: '{model}'",
                 f'x: {gx}', f'z: {gz}', f'yaw: {round(yaw, 3)}']
            for k in ('name', 'text', 'textOn', 'textOff', 'idleText', 'quest',
                      'needDead', 'doused'):
                if k in extra:
                    f.append(f"{k}: '{extra[k]}'")
            for k in ('s', 'reach', 'respawn', 'hurt'):
                if k in extra:
                    f.append(f'{k}: {extra[k]}')
            if extra.get('toggle'):
                f.append('toggle: 1')
            if extra.get('once'):
                f.append('once: 1')
            if 'light' in extra:
                f.append(f"light: 0x{extra['light']:06x}")
            if gives:
                f.append(f"gives: {{ item: '{gives[0]}', count: {gives[1]} }}")
            obj_rows.append('    { ' + ', '.join(f) + ' },')

    A('  // What a quest asks you to put your hands on. Placed off the routed')
    A('  // paths and the traced grid, never by pixel -- see NODES in the builder.')
    A('  objects: [')
    for r in obj_rows:
        A(r)
    A('  ],')
    A('')
    print(f'  {len(obj_rows)} quest objects placed'
          + (f'  !! SHORT: {", ".join(short)}' if short else ''))

    # Everything placed anywhere has to be listed, or the client never downloads
    # it and the piece is simply absent -- placed, positioned, invisible. Moving
    # the camp furniture out of SCATTER and into LAYOUTS dropped it off this set
    # and emptied both camps of tents, stools and crates without a single error.
    used = sorted({m for m, *_ in SCATTER} | {pr[2] for pr in PROPS}
                  | {mk[0] for mk in MARKERS} | set(RUIN_KIT) | set(WETLAND_KIT)
                  | set(DARKWOODS_KIT) | {o[0] for o in ORE}
                  | {piece[0] for _key, fn in LAYOUTS for piece in fn()}
                  | {n[2] for n in NODES}
                  | {n[5]['doused'] for n in NODES if 'doused' in n[5]})
    models = [f'{MODEL_DIR[m]}/{m}' if m in MODEL_DIR else m for m in used] + TREE_SPECIES
    A('  models: [')
    for i in range(0, len(models), 4):
        A('    ' + ' '.join(f"'{m}'," for m in models[i:i + 4]))
    A('  ],')
    A('')
    A('  env: { fogNear: 60, fogFar: 320, ambient: 0.42 },')
    A('')
    A('  // WHERE THE WATER ENDS, as a contour of the blurred terrain field, and')
    A('  // the one place that decides it. The client draws its shoreline here and')
    A('  // the server decides swimming here, so the two cannot drift apart -- they')
    A("  // did, and the gap between them was 766 cells of dry ground you swam in.")
    A('  // The levels are measured: these two contours reproduce the areas the')
    A('  // blueprint draws (5.6% deep, 7.2% wetted) to within a tenth of a point.')
    A('  // `fade` is the level by which the LAND has faded out entirely. It makes')
    A('  // "ground under the waterline" and "inside the drawn edge" the same test,')
    A('  // so the drawn shore and the swimming rule cannot come apart.')
    A(f"  waterEdge: {{ deep: {WATER_EDGE['deep']}, marsh: {WATER_EDGE['marsh']}, "
      f"fade: {WATER_EDGE['fade']}, blur: {WATER_EDGE['blur']} }},")
    A('')
    A('  // Rock: how tall the client draws it, and how steep is too steep to')
    A('  // walk. One pair of numbers for one cliff -- the client draws by')
    A('  // the field; the server stops you where that surface is steeper than')
    A(f'  // walkSlope ({math.degrees(math.atan(ROCK_EDGE["walkSlope"])):.0f} degrees). A road is the one exception: see rockSolidAt.')
    A(f"  rockEdge: {{ rise: {ROCK_EDGE['rise']}, walkSlope: {ROCK_EDGE['walkSlope']} }},")
    A('')
    A('  // Traced straight off the drawing: one character per cell.')
    A("  // ' ' off-map   W deep water   w marsh   R rock   F dense forest   f wood   . open")
    A(f'  terrain: {{ cell: {cell}, w: {W}, h: {H}, minX: {minX}, minZ: {minZ}, rows: [')
    for r in rows:
        A("    '" + r + "',")
    A('  ] },')
    A('};')

    OUT.write_text('\n'.join(L) + '\n')
    print(f'wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size} bytes)')
    print(f'  zone {W * cell:.0f} x {H * cell:.0f} units   spawn ({sx}, {sz + 12})')
    print(f'  {len(POIS)} landmarks, {len(EXITS)} exits, {len(hills)} hills, '
          f'{len(RIVERS)} rivers, {len(boundary)} boundary points')
    # Can you actually walk there? A zone whose landmarks are sealed off behind
    # their own cliffs is the bug that is easiest to ship and hardest to notice,
    # so the build refuses to be quiet about it.
    seen = main_component(camp_cell)          # recomputed: the carving opened passes
    land = sum(1 for gz in range(H) for gx in range(W) if walkable(gx, gz))
    unreachable = []
    for key, cellpos in nodes.items():
        if cellpos not in seen:
            unreachable.append(key)
    print(f'  reachable on foot from the camp: {len(seen)} of {land} walkable cells '
          f'({len(seen) * 100 // max(1, land)}%)')
    if unreachable:
        print('  !! UNREACHABLE: ' + ', '.join(unreachable))
    else:
        print('  every landmark and exit is reachable on foot')

    roads = [p for p in paths if p[0] == 'road']
    trails = [p for p in paths if p[0] == 'trail']
    tot = sum(sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1)) for _, _, _, p in roads)
    print(f'  {len(roads)} roads ({tot:.0f} units of it), {len(trails)} trails')
    print(f'  camps: {laid} pieces laid out, {gateways} pulled aside to leave the paths open')


if __name__ == '__main__':
    main()
