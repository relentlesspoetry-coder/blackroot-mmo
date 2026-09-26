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
}

SPAWNS = [
    # (poi | spawn anchor, type, level, count, radius, roam)
    ('grimroot',     'venom_spider',13, 7, 42, 26),
    ('grimroot',   'goblin_shaman',15, 3, 38, 20),
    ('briar',           'bandit', 9, 6, 32, 22),
    ('briar',   'goblin_warrior',10, 4, 30, 18),
    ('briar',    'goblin_archer',10, 3, 30, 18),
    ('spiderden',           'spider', 8, 8, 34, 24),
    ('spiderden',     'venom_spider',10, 3, 30, 20),
    ('murkfen', 'goblin_scavenger', 5, 7, 50, 30),
    ('murkfen',           'spider', 6, 4, 46, 26),
    ('wolfsnag',           'guard', 9, 3, 34, 20),
    ('wolfsnag',           'goblin', 6, 6, 36, 24),
    ('wolfsnag',     'goblin_miner', 7, 5, 38, 22),
    ('chapel',              'bat', 3, 6, 30, 22),
    ('chapel',           'spider', 4, 3, 28, 18),
    ('crowhill',    'goblin_archer',11, 4, 34, 22),
    # The cows used to graze Ravenwater Pool, which its own sheet calls "deep
    # waters, darker secrets" -- and no livestock appears anywhere in the zone
    # blueprint. They are quest fauna (a quest wants cow hide), so they move to
    # open ground east of Witchlight Camp rather than being cut: far enough out
    # of the camp that they still spawn and are still killable.
    ('cowfield',               'cow', 1, 5, 30, 22),
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
    ('Gravestone_Slab', 24, 'chapel', 27), ('Gravestone_Cross', 13, 'chapel', 27),
    ('Gravestone_Broken', 11, 'chapel', 27), ('Tomb_Slab', 4, 'chapel', 24),
    ('Gravestone_Tall', 2, 'chapel', 20),
    # Grimroot Thicket: the sheet's "corruption growth" is a magic source, and
    # the cave kit's crystals are exactly that. Roots as the obstacle layer,
    # thorns as the chokepoint layer -- its elevation guide names both.
    ('Violet_Crystals', 16, 'grimroot', 36), ('Teal_Crystals', 6, 'grimroot', 34),
    ('Exposed_Roots', 26, 'grimroot', 38), ('Thorn_Bush', 22, 'grimroot', 38),
    # Wolfsnag Pass had NOTHING on it -- a named chokepoint dressed as empty
    # rock. The sheet gives it spiked barricades, bones and a warning at the
    # mouth: wild territory somebody has already tried to hold.
    ('Banner_Wolf', 5, 'wolfsnag', 28),          # whose territory this is
    ('Spike_Barricade', 10, 'wolfsnag', 28), ('Bone_Pile', 6, 'wolfsnag', 28),
    ('Warning_Sign', 2, 'wolfsnag', 26), ('Dead_Bush', 12, 'wolfsnag', 28),
    ('Rubble_Pile', 8, 'wolfsnag', 28),
    # Murkfen: dead trees standing in the marsh, rotted pilings where a walk
    # has gone, and lanterns along the ones that remain.
    ('Twisted_Dead_Tree', 24, 'murkfen', 50), ('Boardwalk_Piling', 12, 'murkfen', 50),
    ('Path_Lantern', 7, 'murkfen', 48), ('Lily_Pads', 14, 'murkfen', 48),
    # Witchlight Camp: the sheet draws a wagon and bedrolls in the tents.

    ('Camp_Lantern', 4, 'briar', 24),
    # Crow Hill: rail fences along the ascent path and fallen stone on the crown.
    ('Rough_Fence', 14, 'crowhill', 30), ('Ruin_Rubble', 10, 'crowhill', 28),
    ('Banner_Crow', 3, 'crowhill', 26),
    # Crow Hill and the Den
    ('Warning_Sign', 3, 'crowhill', 30), ('Bone_Pile', 7, 'spiderden', 24),
    # The Spider Den. The descent only pays off if there is something down
    # there: webs thicken and the nests appear as you reach the floor of the
    # hollow, so the bottom reads as inhabited rather than as a dip in a field.
    ('Floor_Web', 16, 'spiderden', 30), ('Funnel_Web', 9, 'spiderden', 26),
    ('Ground_Cocoon', 7, 'spiderden', 24), ('Hanging_Cocoon', 6, 'spiderden', 22),
    ('Egg_Cluster', 6, 'spiderden', 20), ('Brood_Nest', 4, 'spiderden', 18),
    ('Layered_Web_Nest', 3, 'spiderden', 16), ('Webbed_Bones', 8, 'spiderden', 26),
    ('Webbed_Boulder', 7, 'spiderden', 30), ('Broken_Web_Strands', 11, 'spiderden', 34),
    ('Stalagmite_Cluster', 9, 'spiderden', 32), ('Stalagmite_Large', 6, 'spiderden', 30),
    ('Luminous_Mushrooms', 10, 'spiderden', 28), ('Rubble_Pile', 8, 'spiderden', 34),
    ('Dead_Bush', 14, 'spiderden', 26),
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


LAYOUTS = [('camp', camp_layout), ('briar', briar_layout)]


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
    'Farm_Handcart': 'farm', 'Bedroll': 'props',
    'Small_Canvas_Tent': 'props', 'Supply_Pavilion': 'props', 'Camp_Lantern': 'props',
    'Cooking_Tripod': 'props', 'Supply_Crate': 'props', 'Water_Barrel': 'props',
    'Camp_Stool': 'props', 'Rolled_Bedroll': 'props', 'Goblin_Hide_Tent': 'props',
    'Unlit_Fire_Pit': 'props',
}

TREE_SPECIES = ['Ancient_Forest_Tree', 'Broad_Crown_Oak', 'Tall_Leafy_Birch',
                'Twisted_Darkwood', 'Weeping_Willow']

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
]

# The two named things the quests ask you to put down.
ELITES = [
    ('goblin_chief',  'Chief Rattlecap',        14, 'briar',    0, -6),
    ('cave_guardian', 'The Rootbound Guardian', 16, 'grimroot', 6,  4),
]


def load_grid():
    d = json.loads(GRID.read_text())
    return d


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
    def walkable_cell(px, py):
        cx, cz = to_cell(px, py)
        if rows[cz][cx] in '.fF':
            return (cx, cz)
        for r in range(1, 26):
            for i in range(0, 360, 10):
                a = math.radians(i)
                nx, nz = cx + int(math.cos(a) * r), cz + int(math.sin(a) * r)
                if 0 <= nx < W and 0 <= nz < H and rows[nz][nx] in '.fF':
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
    WALK = set('.fFw')
    def walkable(nx, nz):
        return rows[nz][nx] in WALK or (nx, nz) in deck_cells

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

    paths = []
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
    cx0, cz0 = W / 2, H / 2
    boundary = []
    for i in range(96):
        a = i / 96 * math.tau
        hit = None
        rmax = math.hypot(W, H)
        r = rmax
        while r > 2:
            x, z = int(cx0 + math.cos(a) * r), int(cz0 + math.sin(a) * r)
            if 0 <= x < W and 0 <= z < H and rows[z][x] != ' ':
                hit = (x, z)
                break
            r -= 1
        if hit:
            boundary.append((round(minX + (hit[0] + 0.5) * cell, 1),
                             round(minZ + (hit[1] + 0.5) * cell, 1)))

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
        wx, wz = world(px, py)
        A(f"    {{ key: '{key}', name: '{name}', note: '{sub}', "
          f"x: {wx}, z: {wz}, kind: '{kind}', r: {r} }},")
    for key, name, sub, px, py, side in EXITS:
        wx, wz = world(px, py)
        A(f"    {{ key: '{key}', name: '{name}', note: '{sub}', "
          f"x: {wx}, z: {wz}, kind: 'exit', side: '{side}', r: 14 }},")
    A('  ],')
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
    A('  rocks: [],')
    A('  hazards: [],')
    A('  treeCount: 4200,')
    A('  treeSeed: 20260925,')
    A('  scatterSeed: 7,')
    A('')
    A('  spawns: [')
    for key, typ, lvl, n, r, roam in SPAWNS:
        if key in SPAWN_ANCHORS:
            wx, wz = world(*SPAWN_ANCHORS[key])
        else:
            poi = [q for q in POIS if q[0] == key][0]
            wx, wz = world(poi[3], poi[4])
        A(f"    {{ type: '{typ}', level: {lvl}, count: {n}, "
          f'cx: {wx}, cz: {wz}, r: {r}, roam: {roam} }},')
    A('  ],')
    A('')
    A('  scatter: [')
    for model, near, n, r in ORE:
        A(f"    {{ model: '{model}', count: {n}, near: '{near}', nearR: {r} }},")
    for spec in SCATTER:
        model, n, near, nearR = spec[0], spec[1], spec[2], spec[3]
        shore = len(spec) > 4 and spec[4]
        extra = f", near: '{near}', nearR: {nearR}" if near else ''
        if shore:
            extra += ', shore: 1, shoreR: 8'
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
        poi = [q for q in POIS if q[0] == key][0]
        ax, az = world(poi[3], poi[4])
        for model, dx, dz, yaw, sc, coll in fn():
            wx, wz = round(ax + dx, 1), round(az + dz, 1)
            if coll > 0 and not path_clear(wx, wz, 3.6):
                gateways += 1
                continue
            A(f"    {{ m: '{model}', x: {wx}, z: {wz}, "
              f'yaw: {yaw}, s: {sc}, c: {coll} }},')
            laid += 1
    A('  ],')
    A('')
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
    def snap_to_water(wx, wz, limit=70):
        if cell_at(wx, wz) in 'Ww':
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
                    if rows[gz][gx] not in 'Ww':
                        continue
                    cx = minX + (gx + 0.5) * cell
                    cz = minZ + (gz + 0.5) * cell
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

    A('  fishingSpots: [')
    moved = 0
    for fid, px, py, tier in FISHING:
        # the jetty spot rides with the jetty, which is computed off the walk
        wx, wz = jetty_at if fid == 'fs_jetty' else world(px, py)
        (wx, wz), shift = snap_to_water(wx, wz)
        if shift > 0.5:
            moved += 1
        A(f"    {{ id: '{fid}', x: {wx}, z: {wz}, tier: {tier} }},")
    A('  ],')
    A('')
    if moved:
        print(f'  {moved} fishing spot(s) snapped onto water')
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
    for cid, anchor, dx, dz in CHESTS:
        ax, az = poi_world(anchor)
        A(f"    {{ id: '{cid}', x: {round(ax + dx, 1)}, z: {round(az + dz, 1)} }},")
    A('  ],')
    A('')
    A('  elites: [')
    for etype, ename, elvl, anchor, dx, dz in ELITES:
        ax, az = poi_world(anchor)
        A(f"    {{ type: '{etype}', name: '{ename}', level: {elvl}, "
          f'cx: {round(ax + dx, 1)}, cz: {round(az + dz, 1)} }},')
    A('  ],')
    A('')
    # Everything placed anywhere has to be listed, or the client never downloads
    # it and the piece is simply absent -- placed, positioned, invisible. Moving
    # the camp furniture out of SCATTER and into LAYOUTS dropped it off this set
    # and emptied both camps of tents, stools and crates without a single error.
    used = sorted({m for m, *_ in SCATTER} | {pr[2] for pr in PROPS}
                  | {mk[0] for mk in MARKERS} | set(RUIN_KIT) | set(WETLAND_KIT)
                  | set(DARKWOODS_KIT) | {o[0] for o in ORE}
                  | {piece[0] for _key, fn in LAYOUTS for piece in fn()})
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
    A('  waterEdge: { deep: 0.41, marsh: 0.44, fade: 0.41, blur: 3 },')
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
    land = sum(1 for r in rows for c in r if c in WALK)
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
