#!/usr/bin/env python3
"""Build server/zones/killingfields.js from the Killing Fields blueprint.

The drawing is the specification, the same way it is for the Dark Woods. Two
things feed this:

  * tools/killingfields.terrain.json, traced off the sheet by
    tools/trace_blueprint.py -- the ground: water, marsh, cliff, woodland, open,
    and where the zone stops.
  * the tables below, read off the drawing in its own pixels -- the twelve
    landmarks, the four ways out, the river and the road network. Those cannot
    come from colour: a keep and a cliff are the same grey, and a road and a
    trail are the same tan line at two widths.

Roads are ROUTED, not drawn: A* over the traced grid between the places the
sheet joins up, so a road follows ground you can walk, crosses the river at its
bridge or its ford, and bends round the cliffs instead of through them. The
drawing says what connects to what; the terrain says how. The router itself
lives in tools/zonekit.py, shared with the Dark Woods.

Authored at its FINAL size. No scale pass.

Run:  tools/.venv/bin/python tools/build_killingfields.py
"""
import json
import math
import random
from pathlib import Path

from zonekit import (DECK_COST, FORD_COST, STEP_COST, make_xform, route,
                     simplify)

ROOT = Path(__file__).resolve().parent.parent
GRID = ROOT / 'tools' / 'killingfields.terrain.json'
OUT = ROOT / 'server' / 'zones' / 'killingfields.js'

# --- the twelve landmarks, in blueprint pixels -------------------------------
# (key, name, subtitle, px, py, kind, radius in world units)
POIS = [
    ('lastwatch',  'Lastwatch Camp',    'Rest, traders, supplies',       565, 645, 'safe',    34),
    ('harvest',    'Broken Harvest',    'Ruined farms, scavengers',      675, 375, 'ruin',    40),
    ('orchard',    'Ashen Orchard',     'Charred trees, ambushes',       610, 165, 'cursed',  42),
    ('ford',       "Widow's Ford",      'Shallow river crossing',        560, 530, 'water',   22),
    ('bridge',     'Redwater Bridge',   'Contested chokepoint',          886, 700, 'pass',    20),
    ('trenches',   'The Long Trenches', 'Fortifications, patrols',       855, 575, 'enemy',   46),
    ('gallows',    'Gallows Rise',      'Lookout, exposed approach',     925, 255, 'lookout', 30),
    ('killing',    'The Killing Ground','Open battlefield, roaming elites', 1120, 490, 'enemy', 58),
    ('saints',     "Saint's Ruin",      'Haunted chapel, crypt access', 1300, 700, 'ruin',    32),
    ('barrows',    'Mourning Barrows',  'Burial mounds, hidden passage',  770, 825, 'cave',   38),
    ('quarry',     'Ironroot Quarry',   'Ore deposits, cliff trails',   1230, 170, 'pass',    44),
    ('redoubt',    "Warlord's Redoubt", 'Boss arena, fortified ruins',  1335, 392, 'enemy',   40),
]

# The four ways out, and the side each leaves by.
EXITS = [
    ('woodland_road', 'Woodland Road', 'To the Dark Woods',    306, 690, 'west'),
    ('ashen_pass',    'Ashen Pass',    'To the Northern Marches', 758, 34, 'north'),
    ('war_road',      'War Road',      'To Blackroot Hollows', 1488, 470, 'east'),
    ('barrow_track',  'Barrow Track',  'To Old Barrow',        1224, 898, 'south'),
]

# --- the water ---------------------------------------------------------------
# Unlike the Dark Woods' creeks, this river IS in the trace -- it is drawn wide
# enough to survive the blur -- so its centreline was read back out of the
# traced water rather than eyeballed off the drawing: the mean position of the
# water cells in each slab across the NW-SE axis, 23 of them.
#
# The bridge and the ford are the only two places a road may cross, which is
# what the sheet says and what makes Redwater Bridge a chokepoint worth the
# name.
RIVERS = [
    ('The Redwater', 10.0, [
        (372, 207), (406, 227), (418, 285), (421, 355), (423, 420), (475, 437),
        (524, 450), (552, 482), (648, 526), (677, 567), (718, 588), (761, 611),
        (804, 631), (849, 654), (898, 671), (900, 736), (939, 768), (976, 800),
        (1012, 828), (1056, 854), (1101, 871), (1143, 894), (1193, 901)],
     [(886, 700)],          # bridges: Redwater Bridge
     [(556, 487)]),         # fords: Widow's Ford
]

# --- the network -------------------------------------------------------------
# What joins to what. The route between is found, not drawn.
ROADS = [
    ('woodland_road', 'lastwatch'), ('lastwatch', 'harvest'), ('harvest', 'ford'),
    ('ford', 'gallows'), ('gallows', 'killing'), ('killing', 'redoubt'),
    ('redoubt', 'war_road'), ('lastwatch', 'bridge'), ('bridge', 'saints'),
    ('saints', 'barrow_track'),
]
TRAILS = [
    ('harvest', 'orchard'), ('orchard', 'ashen_pass'), ('orchard', 'gallows'),
    ('gallows', 'quarry'), ('quarry', 'redoubt'), ('trenches', 'ford'),
    ('trenches', 'killing'), ('trenches', 'bridge'), ('lastwatch', 'barrows'),
    ('barrows', 'bridge'), ('barrows', 'barrow_track'), ('killing', 'saints'),
]
ROAD_CUT, TRAIL_CUT = 3.4, 2.4      # half-width of the gap a path cuts through cover

# --- the shape of the ground -------------------------------------------------
# (px, py, radius in world units, height). The sheet's contours say where the
# high ground is; these are those contours, as the few bumps that matter.
HILLS = [
    (1335, 392, 62, 14),      # the redoubt plateau -- reached by a ramp, not an island
    (925, 255, 44, 11),       # Gallows Rise
    (1230, 170, 70, -9),      # the quarry, cut down into the rock
    (770, 825, 30, 5),        # Mourning Barrows, a low swell under the mounds
    (610, 165, 50, 4),        # the orchard terrace
    (1120, 490, 80, -2),      # the killing ground, a shallow basin
]

# Where the water line sits and where rock becomes a wall. One pair of numbers
# each, carried into the zone so the client's shoreline and the server's
# swimming and this builder's fishing spots all agree by construction.
WATER_EDGE = {'deep': 0.41, 'marsh': 0.44, 'fade': 0.41, 'blur': 3}
ROCK_EDGE = {'rise': 15.0, 'walkSlope': 0.84}


# --- what lives there --------------------------------------------------------
# Levels run 14 to 24: the Dark Woods tops out at 15, so this is the zone you
# come to next and the danger rises toward the redoubt, which is what the
# sheet's own design intent says.
SPAWNS = [
    ('bandit',          15, 9,  'harvest',  44, 24),
    ('bandit',          16, 7,  'trenches', 40, 22),
    ('goblin_scavenger',14, 8,  'orchard',  46, 26),
    ('goblin_warrior',  18, 8,  'trenches', 42, 20),
    ('goblin_archer',   17, 7,  'killing',  54, 26),
    ('goblin_warrior',  19, 9,  'killing',  56, 28),
    ('guard',           21, 4,  'killing',  50, 30),
    ('goblin_archer',   18, 5,  'gallows',  32, 18),
    ('goblin_miner',    16, 6,  'quarry',   46, 22),
    ('bat',             14, 8,  'quarry',   44, 26),
    ('spider',          15, 7,  'barrows',  38, 20),
    ('venom_spider',    17, 5,  'saints',   34, 18),
    ('goblin_warrior',  20, 6,  'redoubt',  38, 16),
    ('goblin_archer',   20, 5,  'redoubt',  36, 16),
    # the farm gone feral -- the sheet draws Broken Harvest as farmland, and
    # something has to still be living in it
    ('cow',              3, 4,  'harvest',  38, 16),
    ('chicken',          2, 6,  'harvest',  30, 14),
]

ELITES = [
    ('guard',        'Warlord Harn',      24, 'redoubt'),
    ('goblin_chief', 'Sergeant Kelm',     19, 'trenches'),
    ('venom_spider', 'The Crypt Widow',   18, 'saints'),
]

# Declarative dressing. worldgen fits these to the ground, keeps them off the
# roads and out of the water, so the builder does not have to.
SCATTER = [
    # the battlefield itself
    ('siege/Catapult_Wreck',      7,  'killing',  56),
    ('siege/Trebuchet_Wreck',     3,  'killing',  52),
    ('siege/Ballista',            5,  'killing',  50),
    ('siege/Supply_Wagon',        6,  'killing',  58),
    ('darkwoods/Banner_Wolf',     6,  'killing',  54),
    ('darkwoods/Banner_Crow',     5,  'killing',  54),
    ('Spike_Barricade',          10,  'trenches', 44),
    ('siege/Supply_Wagon',        3,  'trenches', 40),
    ('siege/Ballista',            3,  'trenches', 38),
    # the fields
    ('siege/Drystone_Wall',      26,  'harvest',  60),
    ('siege/Drystone_Wall_Broken',22, 'harvest',  60),
    ('siege/Drystone_Wall_Broken',14, 'ford',     48),
    ('farm/Round_Hay_Bale',       7,  'harvest',  44),
    ('farm/Square_Hay_Bale',      6,  'harvest',  42),
    ('farm/Farm_Handcart',        4,  'harvest',  40),
    ('farm/Wheelbarrow',          3,  'harvest',  36),
    ('farm/Scarecrow',            3,  'harvest',  46),
    ('farm/Grain_Barrel',         5,  'harvest',  34),
    ('Dead_Bush',                18,  'orchard',  50),
    ('Twisted_Dead_Tree',        16,  'orchard',  52),
    ('darkwoods/Fallen_Log',      9,  'orchard',  48),
    # the barrows and the chapel
    ('blockout/Blockout_Standing_Stones', 7, 'barrows', 34),
    ('darkwoods/Gravestone_Slab',  9, 'saints',   30),
    ('darkwoods/Gravestone_Cross', 7, 'saints',   28),
    ('darkwoods/Gravestone_Broken',6, 'saints',   28),
    ('darkwoods/Tomb_Slab',        4, 'barrows',  30),
    # the quarry
    ('cave/Iron_Ore_Vein',         8, 'quarry',   46),
    ('cave/Coal_Ore_Vein',         6, 'quarry',   44),
    ('cave/Copper_Ore_Vein',       5, 'quarry',   42),
    ('cave/Tin_Ore_Vein',          4, 'quarry',   40),
    ('cave/Rubble_Pile',          10, 'quarry',   48),
    ('cave/Timber_Support',        5, 'quarry',   40),
    ('darkwoods/Rock_Spire',       8, 'quarry',   50),
]

# The hero pieces, placed by hand at the landmark that is named for them.
# (model, poi, dx, dz, yaw, scale, collision radius)
PROPS = [
    ('siege/Windmill_Ruined', 'harvest',   -8,  -6, 0.4, 1.0, 2.6),
    ('siege/Gallows',         'gallows',     0,   4, 0.8, 1.0, 1.6),
    ('siege/Quarry_Winch',    'quarry',      6, -10, 2.1, 1.0, 1.4),
    ('siege/Trebuchet_Wreck', 'redoubt',   -26,  18, 1.2, 1.0, 2.2),
    ('siege/Catapult_Wreck',  'bridge',     14,  -9, 0.3, 1.0, 1.8),
    ('darkwoods/Stilt_Watchtower', 'gallows', -7, -6, 0.2, 1.0, 1.9),
    ('darkwoods/Stilt_Watchtower', 'lastwatch', 12, -10, 2.6, 1.0, 1.9),
    ('darkwoods/Brazier',     'redoubt',     8,   6, 0.0, 1.0, 0.8),
    ('darkwoods/Brazier',     'redoubt',    -8,   6, 0.0, 1.0, 0.8),
    ('darkwoods/Banner_Wolf', 'redoubt',     0, -14, 0.0, 1.2, 0.6),
]

NPCS = [
    ('serin',  'Quartermaster Serin', 'Female', 'lastwatch',  -6,  4,
     "Everything east of the ford is somebody else's problem. Mine is keeping you fed."),
    ('holt',   'Sergeant Holt',       'Male',   'lastwatch',   7, -3,
     'Twelve of us walked out to the trenches last spring. I walked back.'),
    ('mared',  'Field Surgeon Mared', 'Female', 'lastwatch',  -2, -9,
     'Bring them to me breathing and I will do the rest.'),
    ('cobb',   'Scavenger Cobb',      'Male',   'harvest',     5,  6,
     'The farms are picked clean. The battlefield is not. Think about that.'),
    ('vane',   'Brother Vane',        'Male',   'saints',     -5,  7,
     'The crypt is shut. It has been shut a long time. Leave it so.'),
]

CHESTS = [('lastwatch_store', 'lastwatch', 10, 6), ('orchard_cache', 'orchard', -12, 8),
          ('trench_cache', 'trenches', 8, -12), ('quarry_strongbox', 'quarry', -14, 6),
          ('saints_crypt', 'saints', 6, -8), ('redoubt_hoard', 'redoubt', 0, 10),
          ('barrow_hoard', 'barrows', -9, -5)]


# --- the three buildings -----------------------------------------------------
# The ruin kit is built to a 4 m grid and every piece is 4 m wide, so a layout
# is a list of (model, dx, dy, dz, yaw, wall, gap): `wall` is how long a
# collision segment that piece contributes and `gap` is the doorway cut in it.
U = 4.0


def saints_ruin():
    """A roofless chapel and the way down into its crypt.

    Smaller than the Fallen Chapel in the Dark Woods on purpose -- that is a
    three-bay nave and this is a country chapel, two bays, with its east window
    still up and its west end in the grass. The sheet calls it "haunted chapel,
    crypt access", so the stair down is the point of the building and everything
    else exists to make it worth walking to.
    """
    p = []
    hx, hz = 1.5 * U, 1.5 * U
    zs = (-U, 0.0, U)
    # the east end still stands, and the window in it
    p.append(('Ruin_Lancet', -U, 0, -hz, 0, U, 0))
    p.append(('Ruin_East_Window', 0.0, 0, -hz, 0, U, 0))
    p.append(('Ruin_Lancet', U, 0, -hz, 0, U, 0))
    # the south flank keeps its door; the north is down to its footings
    for z, m in zip(zs, ('Ruin_Lancet', 'Ruin_Door_Arch', 'Ruin_Wall_Half')):
        p.append((m, hx, 0, z, math.pi / 2, U, 1.9 if m == 'Ruin_Door_Arch' else 0))
    for z, m in zip(zs, ('Ruin_Wall_Low', None, 'Ruin_Wall_Low')):
        if m is None:
            p.append(('Ruin_Arcade', -hx, 0, z, math.pi / 2, 0, 0))
            p.append(('Ruin_Rubble', -hx + 1.4, 0, z + 1.2, 1.0, 0, 0))
            continue
        p.append((m, -hx, 0, z, math.pi / 2, U, 0))
    # the west end is a breach you walk in through
    p.append(('Ruin_Wall_Low', -U, 0, hz, 0, U, 0))
    p.append(('Ruin_Rubble', 0.7, 0, hz - 0.8, 0.5, 0, 0))
    p.append(('Ruin_Steps_Wide', 0.0, 0, hz + 2.2, 0, 0, 0))
    # the altar, and behind it the stair down
    p.append(('Ruin_Altar', 0.0, 0, -hz + 2.6, 0, 0, 0))
    p.append(('Ruin_Stair', 2.2, 0, 1.6, math.pi, 0, 0))
    for x in (-hx - 0.42, hx + 0.42):
        p.append(('Ruin_Buttress', x, 0, -U / 2, math.pi / 2, 0, 0))
    return p


def warlord_redoubt():
    """A breached keep with a courtyard you can actually fight in.

    The sheet is explicit that this is a boss arena "reachable by a ramp, not an
    isolated island", so the curtain is a real enclosure with ONE way in at the
    south and one breach at the west, and the middle is left empty. Everything
    that would clutter the floor -- braziers, the standard, the trebuchet that
    threw at it -- is placed outside the walls or against them.
    """
    p = []
    R = 3 * U                                     # 12 m from the middle to a wall
    xs = (-2 * U, -U, 0.0, U, 2 * U)
    # north curtain: tall and unbroken, the face you see coming up the ramp
    for x in xs:
        p.append(('Ruin_Wall_Tall', x, 0, -R, 0, U, 0))
    # south curtain: the gate
    for x in xs:
        m = 'Ruin_Wall_Door' if x == 0.0 else 'Ruin_Wall'
        p.append((m, x, 0, R, 0, U, 2.2 if x == 0.0 else 0))
    # east curtain intact, west curtain breached in the middle two bays
    for z in xs:
        p.append(('Ruin_Wall', R, 0, z, math.pi / 2, U, 0))
    for z, m in zip(xs, ('Ruin_Wall', 'Ruin_Wall_Half', None, None, 'Ruin_Wall')):
        if m is None:
            p.append(('Ruin_Rubble', -R + 1.2, 0, z, 0.9 + z * 0.1, 0, 0))
            continue
        p.append((m, -R, 0, z, math.pi / 2, U, 0))
    # two corner towers still up, two down to their stumps
    for (cx, cz) in ((-R, -R), (R, -R)):
        p.append(('Tower_Slit', cx, 0, cz, 0, 0, 0))
        p.append(('Tower_Slit', cx, 4.6, cz, 0, 0, 0))
        p.append(('Tower_Gallery', cx, 9.2, cz, 0, 0, 0))
        p.append(('Tower_Roof', cx, 12.0, cz, 0, 0, 0))
    for (cx, cz) in ((-R, R), (R, R)):
        p.append(('Tower_Slit', cx, 0, cz, 0, 0, 0))
        p.append(('Ruin_Rubble', cx + 1.4, 0, cz - 1.2, 2.0, 0, 0))
    # the ramp up to the gate, which is what makes it an arena and not an island
    p.append(('Ruin_Steps_Wide', 0.0, 0, R + 2.4, math.pi, 0, 0))
    p.append(('Ruin_Steps_Wide', 0.0, 0, R + 6.0, math.pi, 0, 0))
    return p


def lastwatch_camp():
    """The safe camp: one watchtower and a low breastwork, open to the road.

    A safe camp has to READ as safe from outside it, which means a silhouette
    you can see over -- a tower and a waist-high wall, not a stockade. The gap
    in the south is deliberate and the road routes through it.
    """
    p = []
    p.append(('Tower_Door', -2 * U, 0, -U, 0, 0, 0))
    p.append(('Tower_Slit', -2 * U, 4.6, -U, 0, 0, 0))
    p.append(('Tower_Gallery', -2 * U, 9.2, -U, 0, 0, 0))
    p.append(('Tower_Roof', -2 * U, 12.0, -U, 0, 0, 0))
    # a breastwork round the north and east, open to the road in the south-west
    for x in (-U, 0.0, U, 2 * U):
        p.append(('Ruin_Wall_Low', x, 0, -2 * U, 0, U, 0))
    for z in (-U, 0.0, U):
        p.append(('Ruin_Wall_Low', 2.5 * U, 0, z, math.pi / 2, U, 0))
    p.append(('Ruin_Wall_Low', 2 * U, 0, 2 * U, 0.8, U, 0))
    return p


# (key, px, py, yaw, padW, padD, layout)
STRUCTURES = [
    ('saints_ruin',     1300, 700, 0.35, 9.0, 11.0, saints_ruin),
    ('warlord_redoubt', 1335, 392, 0.0, 30.0, 30.0, warlord_redoubt),
    ('lastwatch_camp',   565, 645, 2.4, 22.0, 20.0, lastwatch_camp),
]

# The camp's tents and gear, which are props rather than architecture.
CAMP_PROPS = [
    ('props/Supply_Pavilion', 'lastwatch', -4, 6, 0.3, 1.0, 2.0),
    ('props/Small_Canvas_Tent', 'lastwatch', 4, 7, 1.9, 1.0, 1.4),
    ('props/Small_Canvas_Tent', 'lastwatch', 9, 3, 0.6, 1.0, 1.4),
    ('props/Goblin_Hide_Tent', 'lastwatch', -9, 2, 2.2, 1.0, 1.5),
    ('props/Supply_Crate', 'lastwatch', 2, -2, 0.4, 1.0, 0.7),
    ('props/Water_Barrel', 'lastwatch', -2, -4, 0.0, 1.0, 0.6),
    ('props/Camp_Stool', 'lastwatch', 1, 3, 1.1, 1.0, 0.4),
    ('props/Rolled_Bedroll', 'lastwatch', -6, -1, 0.9, 1.0, 0.5),
    ('darkwoods/Market_Stall', 'lastwatch', 7, -5, 2.9, 1.0, 1.6),
    ('props/Camp_Lantern', 'lastwatch', 0, 8, 0.0, 1.0, 0.4),
    ('props/Supply_Crate', 'redoubt', 12, -4, 1.2, 1.0, 0.7),
    ('props/Unlit_Fire_Pit', 'redoubt', 0, 0, 0.0, 1.0, 0.9),
    ('darkwoods/Brazier', 'saints', 4, 3, 0.0, 1.0, 0.8),
]

# --- the build ---------------------------------------------------------------
def load_grid():
    return json.loads(GRID.read_text())


def boundary_ring(d, points=72):
    """The zone outline, taken off the traced land rather than drawn.

    A ray out of the middle for each of `points` bearings, stopping at the last
    cell that is still land. The result is star-shaped, which is all a boundary
    has to be -- it exists so the camera and the server agree where the world
    stops.
    """
    rows, W, H, cell = d['rows'], d['w'], d['h'], d['cell']
    land = [[c != ' ' for c in r] for r in rows]
    cx = sum(x for z in range(H) for x in range(W) if land[z][x])
    cz = sum(z for z in range(H) for x in range(W) if land[z][x])
    n = sum(1 for z in range(H) for x in range(W) if land[z][x])
    cx, cz = cx / n, cz / n
    ring = []
    reach = math.hypot(W, H)
    for i in range(points):
        a = 2 * math.pi * i / points
        dx, dz = math.cos(a), math.sin(a)
        last = None
        t = 2.0
        while t < reach:
            x, z = int(cx + dx * t), int(cz + dz * t)
            if 0 <= x < W and 0 <= z < H and land[z][x]:
                last = (x, z)
            t += 0.5
        if last is None:
            continue
        # a little outside the last land cell, so the walkable edge is inside
        wx = round(d['minX'] + (last[0] + 0.5 + dx * 1.6) * cell, 1)
        wz = round(d['minZ'] + (last[1] + 0.5 + dz * 1.6) * cell, 1)
        ring.append({'x': wx, 'z': wz})
    return ring


def cell_of(d, wx, wz):
    return (int((wx - d['minX']) / d['cell']), int((wz - d['minZ']) / d['cell']))


def terrain_at(d, wx, wz):
    gx, gz = cell_of(d, wx, wz)
    if gz < 0 or gz >= d['h'] or gx < 0 or gx >= d['w']:
        return ' '
    return d['rows'][gz][gx] or ' '


def nearest_open(d, wx, wz, want='.fF'):
    """Nudge a point onto ground you can stand on. A landmark read off a drawing
    lands wherever the label was, which is sometimes in the river."""
    if terrain_at(d, wx, wz) in want:
        return (wx, wz)
    for r in range(1, 40):
        for i in range(max(8, r * 6)):
            a = 2 * math.pi * i / max(8, r * 6)
            x = round(wx + math.cos(a) * r * d['cell'], 1)
            z = round(wz + math.sin(a) * r * d['cell'], 1)
            if terrain_at(d, x, z) in want:
                return (x, z)
    return (wx, wz)


def push_to_edge(d, wx, wz, side):
    """An exit belongs ON the boundary, not near it."""
    step = d['cell']
    dx, dz = {'north': (0, -1), 'south': (0, 1), 'west': (-1, 0), 'east': (1, 0)}[side]
    x, z = wx, wz
    for _ in range(200):
        nx, nz = x + dx * step, z + dz * step
        if terrain_at(d, nx, nz) == ' ':
            break
        x, z = nx, nz
    return (round(x, 1), round(z, 1))


def main():
    d = load_grid()
    world = make_xform(d)
    cell, minX, minZ = d['cell'], d['minX'], d['minZ']
    W, H = d['w'], d['h']
    bounds = {'minX': minX, 'maxX': round(minX + W * cell, 1),
              'minZ': minZ, 'maxZ': round(minZ + H * cell, 1)}
    rng = random.Random(20260930)

    # --- the places
    pois, nodes = [], {}
    for key, name, note, px, py, kind, r in POIS:
        wx, wz = nearest_open(d, *world(px, py))
        pois.append({'key': key, 'name': name, 'note': note, 'x': wx, 'z': wz,
                     'kind': kind, 'r': r})
        nodes[key] = cell_of(d, wx, wz)
    for key, name, note, px, py, side in EXITS:
        wx, wz = push_to_edge(d, *world(px, py), side)
        wx, wz = nearest_open(d, wx, wz)
        pois.append({'key': key, 'name': name, 'note': note, 'x': wx, 'z': wz,
                     'kind': 'exit', 'r': 14})
        nodes[key] = cell_of(d, wx, wz)
    at = {p['key']: (p['x'], p['z']) for p in pois}

    # --- the water, and the two places a road may cross it
    rivers = []
    river_cells, bridge_cells = set(), set()
    for name, width, pts, bridges, fords in RIVERS:
        wp = [world(px, py) for px, py in pts]
        half = width / 2 + 1.0
        rc = max(1, int(half / cell))
        for i in range(len(wp) - 1):
            steps = max(1, int(math.dist(wp[i], wp[i + 1]) / (cell * 0.4)))
            for t in range(steps + 1):
                wx = wp[i][0] + (wp[i + 1][0] - wp[i][0]) * t / steps
                wz = wp[i][1] + (wp[i + 1][1] - wp[i][1]) * t / steps
                gx, gz = int((wx - minX) / cell), int((wz - minZ) / cell)
                for dz in range(-rc, rc + 1):
                    for dx in range(-rc, rc + 1):
                        if dx * dx + dz * dz <= rc * rc:
                            river_cells.add((gx + dx, gz + dz))
        crossings = []
        for px, py in bridges + fords:
            cxw, czw = world(px, py)
            gx, gz = cell_of(d, cxw, czw)
            for dz in range(-3, 4):
                for dx in range(-3, 4):
                    bridge_cells.add((gx + dx, gz + dz))
            crossings.append({'x': cxw, 'z': czw})
        rivers.append({'name': name, 'width': width,
                       'bridges': [{'x': x, 'z': z} for x, z in
                                   (world(px, py) for px, py in bridges)],
                       'points': [{'x': x, 'z': z} for x, z in wp]})
    print(f'  river covers {len(river_cells)} cells; {len(bridge_cells)} of them are crossings')

    # --- the network
    paths = []
    for kind, pairs, tol in (('road', ROADS, 1.1), ('trail', TRAILS, 1.6)):
        for a, b in pairs:
            p = route(d, nodes[a], nodes[b], bridge_cells, river_cells, ())
            if not p:
                print(f'  !! no route {a} -> {b}')
                continue
            pts = simplify([(minX + (x + 0.5) * cell, minZ + (z + 0.5) * cell)
                            for x, z in p], tol)
            paths.append({'kind': kind, 'from': a, 'to': b,
                          'points': [{'x': round(x, 1), 'z': round(z, 1)} for x, z in pts]})
    roads = sum(1 for p in paths if p['kind'] == 'road')
    print(f'  {roads} roads, {len(paths) - roads} trails')

    # --- the shape of the ground
    hills = []
    for px, py, r, h in HILLS:
        wx, wz = world(px, py)
        hills.append({'x': wx, 'z': wz, 'r': r, 'h': h})

    # --- who is there
    spawns = []
    for typ, lvl, cnt, poi, r, roam in SPAWNS:
        x, z = at[poi]
        spawns.append({'type': typ, 'level': lvl, 'count': cnt,
                       'cx': x, 'cz': z, 'r': r, 'roam': roam})
    elites = [{'type': t, 'name': n, 'level': l, 'cx': at[p][0], 'cz': at[p][1]}
              for t, n, l, p in ELITES]
    # The `models` list carries the folder (that is the path it is fetched
    # from); every reference to a model does NOT, because the client keys
    # LOADED by basename -- modelKey() strips the folder. Getting that wrong is
    # silent: bakeModel finds no model, returns null, and placeInstances skips
    # the whole group, so 93 siege wrecks simply were not there and nothing
    # said so.
    base = lambda m: m.rsplit('/', 1)[-1]
    scatter = [{'model': base(m), 'count': c, 'near': p, 'nearR': r} for m, c, p, r in SCATTER]
    structures = []
    for key, px, py, yaw, padw, padd, layout in STRUCTURES:
        wx, wz = nearest_open(d, *world(px, py))
        structures.append({'key': key, 'x': wx, 'z': wz, 'yaw': yaw,
                           'padW': padw, 'padD': padd,
                           'pieces': [{'m': m, 'dx': round(dx, 2), 'dy': round(dy, 2),
                                       'dz': round(dz, 2), 'yaw': round(pyaw, 4),
                                       'wall': wall, 'gap': gap}
                                      for m, dx, dy, dz, pyaw, wall, gap in layout()]})
    props = []
    for m, poi, dx, dz, yaw, s, c in PROPS + CAMP_PROPS:
        x, z = at[poi]
        px, pz = nearest_open(d, round(x + dx, 1), round(z + dz, 1))
        props.append({'m': base(m), 'x': px, 'z': pz, 'yaw': yaw, 's': s, 'c': c})
    npcs = [{'id': i, 'name': n, 'x': round(at[p][0] + dx, 1), 'z': round(at[p][1] + dz, 1),
             'model': mo, 'poi': p, 'yaw': 0, 'idle': idle}
            for i, n, mo, p, dx, dz, idle in NPCS]
    chests = [{'id': i, 'x': round(at[p][0] + dx, 1), 'z': round(at[p][1] + dz, 1)}
              for i, p, dx, dz in CHESTS]
    campfires = [{'id': 'cf_lastwatch', 'x': at['lastwatch'][0], 'z': at['lastwatch'][1]},
                 {'id': 'cf_trenches', 'x': round(at['trenches'][0] + 10, 1),
                  'z': round(at['trenches'][1] + 8, 1)}]

    # fishing along the Redwater, snapped to cells the trace actually calls water
    spots = []
    for i, (px, py) in enumerate(RIVERS[0][2][3::4]):
        wx, wz = world(px, py)
        spots.append({'id': f'fs_redwater_{i}', 'x': wx, 'z': wz, 'tier': 2 if i % 2 else 1})

    models = sorted({m for m, *_ in SCATTER} | {m for m, *_ in PROPS}
                    | {m for m, *_ in CAMP_PROPS}
                    | {pc['m'] for st in structures for pc in st['pieces']})

    zone = {
        'id': 'killingfields',
        'name': 'The Killing Fields',
        'subtitle': 'Abandoned farmlands, broken fortifications, and a battlefield that never rests.',
        'spawn': {'x': at['lastwatch'][0], 'z': round(at['lastwatch'][1] + 6, 1), 'yaw': 0},
        'bounds': bounds,
        'boundaryInset': 0,
        'safeSpawnRadius': 38,
        'boundary': boundary_ring(d),
        'hills': hills,
        'pois': pois,
        'rivers': rivers,
        'paths': paths,
        'portals': [],            # filled in below, both ways
        'rocks': [], 'hazards': [],
        'treeCount': 760, 'treeSeed': 20260930, 'scatterSeed': 11,
        'spawns': spawns,
        'scatter': scatter,
        'decks': [],
        'props': props,
        'fences': [], 'dirt': [], 'structures': structures,
        'fishingSpots': spots,
        'campfires': campfires,
        'npcs': npcs,
        'chests': chests,
        'elites': elites,
        'objects': [],
        'models': models,
        'env': {'fogNear': 90, 'fogFar': 360, 'ambient': 0.5,
                'bg': 0x2b3140, 'sun': 0xffeccf, 'sunInt': 1.45,
                'hemiSky': 0xc4d2e4, 'hemiGround': 0x6a6040, 'hemiInt': 1.1},
        'waterEdge': WATER_EDGE,
        'rockEdge': ROCK_EDGE,
        'terrain': {'cell': cell, 'w': W, 'h': H, 'minX': minX, 'minZ': minZ,
                    'rows': d['rows']},
    }
    # No portal west. This is one open world: the Killing Fields is composed
    # into the same coordinate space as the Dark Woods by tools/build_world.mjs
    # and you walk from one into the other. The region system already existed
    # for this -- "crossing into another region of the seamless world announces
    # it like a zone" -- and only ever had one region put in it.

    body = json.dumps(zone, separators=(',', ':'))
    OUT.write_text(
        '// GENERATED by tools/build_killingfields.py from the Killing Fields\n'
        '// blueprint. Do not edit by hand -- edit the tables in the builder and\n'
        '// run it again, or the next build will throw your changes away.\n'
        f'export const killingfields = {body};\n')
    print(f'  {len(pois)} landmarks, {len(spawns)} spawn groups, {len(scatter)} scatter rules, '
          f'{len(props)} placed props, {len(structures)} structures '
          f'({sum(len(st["pieces"]) for st in structures)} pieces), {len(models)} models')
    print(f'wrote {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
