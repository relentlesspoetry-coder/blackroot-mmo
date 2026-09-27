#!/usr/bin/env python3
"""The Spider Den, as an actual cave.

Its concept sheet is unambiguous: "A hidden cave network beneath jagged stone,
home to giant spiders. Webbed tunnels descend into darkness." What the zone had
was a dip in a field with cobwebs scattered over it and a rock arch standing in
for a mouth -- readable as a den only if you already knew it was meant to be
one. You could not go in, because there was no in.

So this is a second zone, reached through the arch. It is authored as ROOMS AND
TUNNELS rather than one open cavern, which is how the old Hidden Cave was built
before the world was wiped: every creature gets a chamber instead of nine spawn
circles overlapping in the middle of one room, and the passages between them
are where the webs do their work.

The chambers follow the sheet's own three panels -- a wide webbed mouth, a
descent, and the dark at the bottom of it:

    mouth     the way in, daylight behind you, webs across the opening
    gallery   the first real chamber, webbed and lived-in
    larder    the cocoons, off to one side
    shaft     the descent proper, narrow and steep
    hollow    the deep hall
    brood     the nest at the bottom. The Den Mother is here.
    seep      a wet side chamber, coal in the walls
    bones     what is left of everything that came before

The tunnel graph MUST stay a tree -- caveOutline traces the union of these
shapes by marching squares and chains the result into one ring, and a loop in
the graph gives it a hole it cannot chain.

Run:  python3 tools/build_spiderden.py
Writes server/zones/spiderden.js
"""
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'server' / 'zones' / 'spiderden.js'

CEILING = 9.0

# (key, x, z, r) -- a chamber. Laid out so the den descends southward from the
# mouth, which is where the Dark Woods arch drops you.
ROOMS = [
    ('mouth',   0,   -128, 24),
    ('gallery', 4,    -62, 31),
    ('larder', -74,   -78, 26),
    ('shaft',  16,     -4, 22),
    ('hollow', -8,     66, 34),
    ('seep',   -96,    40, 27),
    ('bones',  92,     44, 25),
    ('brood',   6,    152, 33),
]

# (from, to, width) -- a tree, never a loop.
TUNNELS = [
    ('mouth',   'gallery', 14),
    ('gallery', 'larder',  11),
    ('gallery', 'shaft',   10),     # the descent: the narrowest way on
    ('shaft',   'hollow',  13),
    ('hollow',  'seep',    11),
    ('hollow',  'bones',   11),
    ('hollow',  'brood',   15),     # opens out into the nest
]

# (type, level, count, room, radius, roam)
SPAWNS = [
    ('spider',        7,  5, 'gallery', 22, 14),
    ('bat',           6,  6, 'gallery', 24, 16),
    ('spider',        8,  4, 'larder',  18, 12),
    ('venom_spider',  9,  4, 'shaft',   16, 10),
    ('venom_spider', 10,  6, 'hollow',  26, 16),
    ('bat',           7,  5, 'hollow',  26, 18),
    ('crystal_spider',11, 3, 'seep',    19, 12),
    ('spider',        9,  4, 'bones',   18, 12),
    ('venom_spider', 11,  6, 'brood',   26, 15),
]

ELITES = [
    ('broodmother', 'The Den Mother', 13, 'brood', 0, 8),
    ('cave_guardian', 'The Web-Bound', 15, 'bones', 3, -4),
]

CHESTS = [
    ('den_larder', 'larder', 4, -3),
    ('den_seep',   'seep',  -5,  6),
    ('den_brood',  'brood',  9, 14),
]

ORE = [
    ('Coal_Ore_Vein',   'seep',   5, 20),
    ('Iron_Ore_Vein',   'seep',   3, 20),
    ('Silver_Ore_Vein', 'bones',  2, 16),
    ('Copper_Ore_Vein', 'shaft',  3, 16),
]

# (model, count, room, radius)
SCATTER = [
    ('Floor_Web', 10, 'mouth', 20), ('Torn_Wall_Web', 6, 'mouth', 20),
    ('Broken_Web_Strands', 8, 'mouth', 22), ('Rubble_Pile', 6, 'mouth', 20),

    ('Floor_Web', 14, 'gallery', 27), ('Funnel_Web', 8, 'gallery', 26),
    ('Corner_Cobweb', 9, 'gallery', 27), ('Stalagmite_Cluster', 8, 'gallery', 28),
    ('Stalagmite_Small', 10, 'gallery', 28), ('Luminous_Mushrooms', 7, 'gallery', 26),

    ('Ground_Cocoon', 9, 'larder', 22), ('Webbed_Bones', 7, 'larder', 22),
    ('Layered_Web_Nest', 4, 'larder', 20), ('Floor_Web', 9, 'larder', 22),

    ('Tunnel_Web_Barrier', 4, 'shaft', 16), ('Broken_Web_Strands', 7, 'shaft', 18),
    ('Stalagmite_Large', 4, 'shaft', 18), ('Rubble_Pile', 6, 'shaft', 18),

    ('Stalagmite_Cluster', 11, 'hollow', 30), ('Stalagmite_Large', 7, 'hollow', 30),
    ('Cave_Column', 5, 'hollow', 28), ('Floor_Web', 12, 'hollow', 30),
    ('Webbed_Boulder', 8, 'hollow', 30), ('Luminous_Mushrooms', 9, 'hollow', 30),
    ('Wall_Boulder_Wide', 6, 'hollow', 32),

    ('Shallow_Pool', 5, 'seep', 22), ('Brown_Mushrooms', 10, 'seep', 23),
    ('Luminous_Mushrooms', 8, 'seep', 23), ('Teal_Crystals', 7, 'seep', 22),
    ('Violet_Crystals', 5, 'seep', 22), ('Hanging_Roots', 6, 'seep', 22),

    ('Webbed_Bones', 11, 'bones', 21), ('Bone_Pile', 9, 'bones', 21),
    ('Ground_Cocoon', 6, 'bones', 20), ('Floor_Web', 8, 'bones', 21),

    ('Brood_Nest', 6, 'brood', 27), ('Egg_Cluster', 12, 'brood', 28),
    ('Ground_Cocoon', 10, 'brood', 28), ('Layered_Web_Nest', 6, 'brood', 27),
    ('Floor_Web', 14, 'brood', 29), ('Webbed_Bones', 8, 'brood', 28),
    ('Funnel_Web', 7, 'brood', 28),
]

# Hung from the ceiling. (model, count, room, radius)
HANGING = [
    ('Hanging_Web_Curtain', 5, 'mouth', 20),
    ('Stalactite_Cluster', 8, 'gallery', 27), ('Ceiling_Web_Canopy', 5, 'gallery', 26),
    ('Hanging_Cocoon', 8, 'larder', 22),
    ('Stalactite_Single', 7, 'shaft', 17),
    ('Stalactite_Cluster', 10, 'hollow', 30), ('Stalactite_Single', 9, 'hollow', 30),
    ('Hanging_Roots', 7, 'seep', 22),
    ('Hanging_Cocoon', 6, 'bones', 20),
    ('Hanging_Cocoon', 11, 'brood', 28), ('Ceiling_Web_Canopy', 7, 'brood', 28),
]

MODEL_DIR = {}
for m, *_ in SCATTER + HANGING:
    MODEL_DIR[m] = 'cave'
for m, *_ in ORE:
    MODEL_DIR[m] = 'cave'

# The Dark Woods end of the pair: the Rock_Arch standing in the den's hollow.
# Coming out puts you a few metres in FRONT of it rather than inside it.
RETURN_TO = 'darkwoods'
DARKWOODS_MOUTH = (-0.4, 266.0)   # measured: walkable, and 13.7 m clear of the arch


def room(key):
    for k, x, z, r in ROOMS:
        if k == key:
            return (x, z, r)
    raise KeyError(key)


def main():
    L = []
    A = L.append
    A('// The Spider Den.')
    A('//')
    A('// GENERATED by tools/build_spiderden.py. Do not hand-edit: change the')
    A('// tables in the tool and re-run it.')
    A('//')
    A('// Rooms and tunnels, not one open cavern -- worldgen.js traces the union')
    A('// of these shapes into the `boundary` polygon the engine already uses for')
    A('// collision and walls. The tunnel graph must stay a TREE.')
    A('')
    A('export const spiderden = {')
    A("  id: 'spiderden',")
    A("  name: 'The Spider Den',")
    A("  subtitle: 'Webbed tunnels, descending into the dark.',")
    A('')
    A('  enclosed: true,')
    A(f'  ceilingY: {CEILING},')
    xs = [x for _k, x, _z, r in ROOMS]
    zs = [z for _k, _x, z, r in ROOMS]
    rs = max(r for *_a, r in ROOMS)
    A(f'  bounds: {{ minX: {min(xs) - rs - 30}, maxX: {max(xs) + rs + 30}, '
      f'minZ: {min(zs) - rs - 30}, maxZ: {max(zs) + rs + 30} }},')
    mx, mz, _mr = room('mouth')
    A(f'  spawn: {{ x: {mx}, z: {mz - 8}, yaw: 3.14 }},')
    A('  safeSpawnRadius: 16,')
    A('  multiCombat: true,')
    A('')
    A('  cavern: {')
    A('    tunnelWidth: 12,')
    A('    rooms: [')
    for k, x, z, r in ROOMS:
        A(f"      {{ key: '{k}', x: {x}, z: {z}, r: {r} }},")
    A('    ],')
    A('    tunnels: [')
    for a, b, w in TUNNELS:
        A(f"      {{ from: '{a}', to: '{b}', w: {w} }},")
    A('    ],')
    A('  },')
    A('')
    A('  // Underground: no sky, no day-night cycle, so this is static. The values')
    A('  // are set by MEASUREMENT, not taste -- the client multiplies them by')
    A('  // WORLD_EXPOSURE (~0.55), so the old cave numbers came out at an')
    A('  // effective hemisphere of 0.43 and a sun of 0.21 and you could see')
    A('  // nothing but the nameplates. Dark, but you can read the walls.')
    A('  env: { bg: 0x0e1319, fogNear: 12, fogFar: 78,')
    A('         hemiSky: 0x5d6b7e, hemiGround: 0x2b333d, hemiInt: 1.55,')
    A('         sun: 0x6d7ba4, sunInt: 0.62 },')
    A('')
    A('  pois: [')
    NAMES = {
        'mouth': ('The Mouth', 'Daylight, and the last of it'),
        'gallery': ('The Gallery', 'Webbed and lived in'),
        'larder': ('The Larder', 'What it keeps, it keeps wrapped'),
        'shaft': ('The Shaft', 'The way down narrows'),
        'hollow': ('The Hollow', 'A hall under the hill'),
        'seep': ('The Seep', 'Wet stone and glowcaps'),
        'bones': ('The Bone Floor', 'Everything that came before'),
        'brood': ('The Brood', 'She is here'),
    }
    for k, x, z, r in ROOMS:
        name, note = NAMES[k]
        kind = 'safe' if k == 'mouth' else ('boss' if k == 'brood' else 'cave')
        A(f"    {{ key: '{k}', name: '{name}', note: '{note}', "
          f"x: {x}, z: {z}, kind: '{kind}', r: {r} }},")
    A('  ],')
    A('')
    A('  // The way back out. Standing in it returns you to the Dark Woods, just')
    A('  // OUTSIDE the arch -- step back in front of it and you would bounce')
    A('  // straight back down, which is what portalCd exists to survive.')
    A('  portals: [')
    A(f"    {{ x: {mx}, z: {mz - 15}, r: 5.0, to: '{RETURN_TO}', "
      f"spawn: {{ x: {DARKWOODS_MOUTH[0]}, z: {DARKWOODS_MOUTH[1]}, yaw: 0 }} }},")
    A('  ],')
    A('')
    A('  spawns: [')
    for typ, lvl, n, rk, r, roam in SPAWNS:
        x, z, _r = room(rk)
        A(f"    {{ type: '{typ}', level: {lvl}, count: {n}, cx: {x}, cz: {z}, "
          f'r: {r}, roam: {roam} }},')
    A('  ],')
    A('')
    A('  elites: [')
    for typ, name, lvl, rk, dx, dz in ELITES:
        x, z, _r = room(rk)
        A(f"    {{ type: '{typ}', name: '{name}', level: {lvl}, "
          f'cx: {x + dx}, cz: {z + dz} }},')
    A('  ],')
    A('')
    A('  chests: [')
    for cid, rk, dx, dz in CHESTS:
        x, z, _r = room(rk)
        A(f"    {{ id: '{cid}', x: {x + dx}, z: {z + dz} }},")
    A('  ],')
    A('')
    A('  scatter: [')
    # `near` takes a POI key, and every chamber is emitted as a POI above, so a
    # chamber name is all the anchor a spec needs.
    for model, rk, n, r in ORE:
        A(f"    {{ model: '{model}', count: {n}, near: '{rk}', nearR: {r} }},")
    for model, n, rk, r in SCATTER:
        A(f"    {{ model: '{model}', count: {n}, near: '{rk}', nearR: {r} }},")
    A('  ],')
    A('')
    A('  hanging: [')
    for model, n, rk, r in HANGING:
        A(f"    {{ model: '{model}', count: {n}, near: '{rk}', nearR: {r} }},")
    A('  ],')
    A('')
    A('  rocks: [],')
    A('  hazards: [],')
    A('  treeCount: 0,')
    A('  scatterSeed: 31,')
    A('')
    used = sorted({m for m, *_ in SCATTER} | {m for m, *_ in HANGING} | {o[0] for o in ORE})
    models = [f'{MODEL_DIR[m]}/{m}' for m in used] + [
        'Cave_Spider', 'Venom_Spider', 'Crystal_Spider', 'Bat', 'Cave_Broodmother',
        'Cave_Guardian']
    A('  models: [')
    for i in range(0, len(models), 4):
        A('    ' + ' '.join(f"'{m}'," for m in models[i:i + 4]))
    A('  ],')
    A('};')

    OUT.write_text('\n'.join(L) + '\n')
    area = sum(math.pi * r * r for *_a, r in ROOMS)
    print(f'wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size} bytes)')
    print(f'  {len(ROOMS)} chambers, {len(TUNNELS)} tunnels, about {area:.0f} sq units of floor')
    print(f'  {sum(s[2] for s in SPAWNS)} monsters, {len(ELITES)} elites, {len(CHESTS)} chests')
    print(f'  {sum(s[1] for s in SCATTER)} pieces of dressing, '
          f'{sum(h[1] for h in HANGING)} hung from the ceiling')
    # the graph has to be a tree, or caveOutline cannot chain the ring
    keys = [k for k, *_ in ROOMS]
    if len(TUNNELS) != len(keys) - 1:
        print(f'  !! {len(TUNNELS)} tunnels for {len(keys)} rooms -- a tree needs exactly {len(keys) - 1}')
    seen, stack = {keys[0]}, [keys[0]]
    adj = {}
    for a, b, _w in TUNNELS:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    while stack:
        n = stack.pop()
        for m in adj.get(n, []):
            if m not in seen:
                seen.add(m)
                stack.append(m)
    if len(seen) != len(keys):
        print(f'  !! UNREACHABLE CHAMBERS: {sorted(set(keys) - seen)}')
    else:
        print('  every chamber connects back to the mouth')


if __name__ == '__main__':
    main()
