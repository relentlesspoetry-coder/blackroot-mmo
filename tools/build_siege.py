#!/usr/bin/env python3
"""The siege kit: what the Killing Fields is named for.

The blueprint draws about ten broken siege machines across the Killing Ground,
a windmill over Broken Harvest, a scaffold on Gallows Rise, a winch in the
Ironroot Quarry, wagons in the ditches and dry-stone walls dividing every crop
field. None of it exists in the 339 models we have -- the nearest thing to a
catapult is a farm handcart.

STYLE: Old School RuneScape, which is what the rest of this world is built to
(the ground itself is commented "low-poly faceted, vertex-coloured, Old School
RuneScape style"). That means: chunky beams you could read from across a field,
flat facets and no bevels, three or four flat colours per object, no detail
smaller than about 8 cm, and a silhouette that says what the thing is before
you can see any of it. A trebuchet here is nine boxes, not nine hundred
triangles of joinery. glbkit gives them flat per-face normals, which is the
other half of that look.

MATERIALS ARE NAMED for what they are made of, not numbered. The client picks a
surface's detail texture off its material name (DETAIL_RULES -> detailFor), so
`Siege timber | weathered oak` gets wood grain and `Drystone | grey granite`
gets rock. Numbered names fall through to a stone fallback, which is how every
plank in the Murkfen boardwalk ended up grained like granite.

Conventions: metres, Y up, base at y = 0, colour in glTF materials (vertex
colours are stripped by the client's bakeModel). trimesh cylinders are Z-UP and
have to be laid down by hand.

Run:  tools/.venv/bin/python tools/build_siege.py
Writes client/models/siege/<Name>.glb
"""
import math
import random
from pathlib import Path

import numpy as np
import trimesh

import glbkit

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'models' / 'siege'

# Flat, slightly dirty colours -- the palette is small on purpose.
# Pushed well apart. The first pass had oak, pale oak, rope and canvas within
# a few percent of each other and the whole kit came out one tan colour -- which
# is the opposite of the look: OSRS reads at a distance because each material is
# a flat, unmistakably different block of colour.
OAK        = ((0.40, 0.28, 0.16), 'Siege timber | weathered oak')
OAK_PALE   = ((0.62, 0.48, 0.30), 'Split timber | pale oak')
OAK_DARK   = ((0.21, 0.15, 0.09), 'Shadowed timber | dark oak')
CHARRED    = ((0.10, 0.09, 0.09), 'Charred beam | burnt oak')
IRON       = ((0.22, 0.23, 0.27), 'Iron fittings | dark')
RUST       = ((0.48, 0.24, 0.11), 'Rusted iron bands')
ROPE       = ((0.68, 0.60, 0.38), 'Rope | hemp')
CANVAS     = ((0.78, 0.74, 0.62), 'Sailcloth | canvas')
STONE      = ((0.52, 0.51, 0.48), 'Drystone | grey granite')
STONE_DARK = ((0.39, 0.38, 0.36), 'Drystone shadow | granite')
MILL       = ((0.58, 0.56, 0.50), 'Millstone | pale granite')


def box(sx, sy, sz, at=(0, 0, 0), mat=OAK, yaw=0.0, tilt=0.0, roll=0.0):
    m = trimesh.creation.box(extents=(sx, sy, sz))
    if tilt:
        m.apply_transform(trimesh.transformations.rotation_matrix(tilt, (0, 0, 1)))
    if roll:
        m.apply_transform(trimesh.transformations.rotation_matrix(roll, (1, 0, 0)))
    if yaw:
        m.apply_transform(trimesh.transformations.rotation_matrix(yaw, (0, 1, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = mat[0]
    m.metadata['mat'] = mat[1]
    return m


def disc(radius, thick, at=(0, 0, 0), mat=OAK, axis='x', sides=10):
    """A wheel. trimesh builds cylinders along Z, so they are laid over by hand
    -- the trap that put the town kit's barrels on their ends."""
    m = trimesh.creation.cylinder(radius=radius, height=thick, sections=sides)
    if axis == 'x':
        m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (0, 1, 0)))
    elif axis == 'y':
        m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = mat[0]
    m.metadata['mat'] = mat[1]
    return m


def cartwheel(r, at, mat=OAK, axis='x', spokes=6):
    """Rim, hub and spokes -- six of them, because at this scale a seventh is
    invisible and costs the same as the sixth."""
    parts = [disc(r, 0.09, at, mat, axis, sides=10),
             disc(r * 0.26, 0.15, at, mat, axis, sides=6)]
    for i in range(spokes):
        a = math.pi * i / spokes
        if axis == 'x':
            parts.append(box(0.07, r * 1.8, 0.07, at, mat, roll=a))
        else:
            parts.append(box(r * 1.8, 0.07, 0.07, at, mat, yaw=a))
    return parts


def ground(parts):
    """Drop the piece so its lowest point sits on y = 0."""
    lo = min(float(p.vertices[:, 1].min()) for p in parts)
    for p in parts:
        p.apply_translation((0, -lo, 0))
    return parts


# ------------------------------------------------------------------ the pieces
def catapult_wreck(seed=1):
    """An onager, tipped and missing a wheel. The first pass sat so low it read
    as a handcart with sticks in it; the frame is up on its wheels now and the
    throwing arm stands clear of it at an angle you can see from the side."""
    rng = random.Random(seed)
    p = []
    # chassis
    for dz in (-0.62, 0.62):
        p.append(box(3.2, 0.26, 0.30, (0, 0.78, dz), OAK))
    for dx in (-1.3, 0.1, 1.4):
        p.append(box(0.26, 0.24, 1.5, (dx, 0.78, 0), OAK_DARK))
    for (dx, dz) in ((-1.15, -0.72), (-1.15, 0.72), (1.25, 0.72)):
        p += cartwheel(0.74, (dx, 0.74, dz), OAK_DARK)
    p += cartwheel(0.74, (2.3, 0.11, -1.6), OAK_DARK, axis='y')      # the wheel it lost
    # the A-frame the arm swings against -- tall enough to be a silhouette
    for dz in (-0.62, 0.62):
        p.append(box(0.24, 2.4, 0.24, (-0.55, 1.95, dz), OAK, tilt=0.30))
        p.append(box(0.24, 2.4, 0.24, (0.55, 1.95, dz), OAK, tilt=-0.30))
    p.append(box(0.22, 0.22, 1.5, (0, 3.05, 0), IRON))
    # THE ARM: pale, long, caught against the frame
    p.append(box(3.6, 0.30, 0.30, (0.9, 2.05, 0), OAK_PALE, tilt=0.5))
    p.append(box(0.62, 0.55, 0.62, (2.55, 2.85, 0), OAK_PALE))       # the bucket
    p.append(disc(0.26, 1.2, (-1.45, 1.25, 0), IRON, axis='z', sides=8))  # winch drum
    p.append(box(2.4, 0.10, 0.10, (0.3, 1.55, 0.34), ROPE, tilt=-0.3))
    for _ in range(3):                                                # splinters
        p.append(box(rng.uniform(0.4, 0.9), 0.14, 0.14,
                     (rng.uniform(-2.0, 2.4), 0.08, rng.uniform(-1.8, 1.8)),
                     OAK_PALE, yaw=rng.uniform(0, 3.1)))
    return ground(p)


def trebuchet_wreck(seed=2):
    """The big silhouette of the zone. The first pass buried the throwing beam
    inside the frame and the whole thing read as scaffolding -- so the beam is
    the piece now: eight metres of it, up at a steep angle, with the
    counterweight a heavy dark block hanging under the pivot. Frame second."""
    p = []
    for dz in (-1.25, 1.25):                                   # sleepers
        p.append(box(4.6, 0.34, 0.38, (0, 0.17, dz), OAK_DARK))
    for dx in (-1.7, 1.7):
        p.append(box(0.34, 0.32, 2.9, (dx, 0.17, 0), OAK_DARK))
    # two leaning legs each side, meeting at the pivot 5 m up
    for dz in (-1.2, 1.2):
        p.append(box(0.30, 5.6, 0.30, (-1.05, 2.75, dz), OAK, tilt=0.37))
        p.append(box(0.30, 5.6, 0.30, (1.05, 2.75, dz), OAK, tilt=-0.37))
    p.append(box(0.28, 0.28, 2.8, (0, 5.05, 0), IRON))          # the axle
    # THE BEAM: long, pale against the dark frame, dropped nose-down
    p.append(box(8.6, 0.38, 0.38, (0.9, 3.45, 0), OAK_PALE, tilt=0.42))
    p.append(box(0.9, 0.5, 0.5, (4.6, 1.75, 0), OAK_PALE, tilt=0.42))   # the sling head
    # counterweight: a big dark block, still slung under the short arm
    p.append(box(1.7, 1.6, 1.7, (-3.0, 1.35, 0), STONE_DARK))
    for dz in (-0.55, 0.55):
        p.append(box(0.14, 1.9, 0.14, (-3.0, 3.0, dz), IRON, tilt=0.42))
    p.append(box(3.4, 0.11, 0.11, (5.6, 0.9, 0), ROPE, tilt=0.30))      # the sling, slack
    p.append(box(2.0, 0.16, 0.16, (-1.1, 0.9, 1.9), OAK_PALE, yaw=0.5)) # a snapped brace
    return ground(p)


def ballista(seed=3):
    """Small, still upright, and the one piece that does not read as a wreck --
    useful as cover on an open field."""
    p = []
    p.append(box(1.5, 0.22, 0.9, (0, 0.75, 0), OAK))               # body
    for dz in (-0.5, 0.5):                                          # legs
        p.append(box(0.18, 0.75, 0.18, (-0.4, 0.38, dz), OAK_DARK, tilt=0.16))
        p.append(box(0.18, 0.75, 0.18, (0.45, 0.38, dz), OAK_DARK, tilt=-0.16))
    p.append(box(2.3, 0.18, 0.18, (0, 1.0, 0), OAK_PALE, yaw=0.0))  # bow arms
    for s in (-1, 1):
        p.append(box(0.9, 0.16, 0.16, (0.15, 1.02, s * 1.0), OAK_PALE, yaw=s * 0.5))
        p.append(disc(0.20, 0.30, (0.15, 1.0, s * 0.62), IRON, axis='z', sides=8))
    p.append(box(1.9, 0.12, 0.12, (0.15, 1.16, 0), IRON))           # the bolt on the stock
    p.append(box(2.0, 0.07, 0.07, (0.1, 1.0, 0), ROPE))             # the string
    return ground(p)


def supply_wagon(seed=4):
    """Four-wheeled, one wheel off the axle, the bed sagging. Rolled on its side
    it is the other half of the Killing Ground's cover."""
    rng = random.Random(seed)
    p = []
    p.append(box(3.2, 0.20, 1.5, (0, 0.85, 0), OAK))                 # bed
    for dz in (-0.72, 0.72):                                          # sideboards
        p.append(box(3.2, 0.55, 0.14, (0, 1.18, dz), OAK_PALE))
    p.append(box(0.14, 0.55, 1.5, (-1.55, 1.18, 0), OAK_PALE))        # tailboard
    for dx in (-1.05, 1.05):                                          # axles
        p.append(box(0.16, 0.16, 2.0, (dx, 0.62, 0), IRON))
    for (dx, dz) in ((-1.05, -0.95), (-1.05, 0.95), (1.05, 0.95)):
        p += cartwheel(0.62, (dx, 0.62, dz), OAK_DARK)
    p += cartwheel(0.62, (2.1, 0.1, -1.5), OAK_DARK, axis='y')        # the lost wheel
    p.append(box(1.8, 0.14, 0.14, (2.3, 0.72, 0), OAK, tilt=-0.12))   # shaft
    for _ in range(3):                                                # spilled crates
        p.append(box(0.5, 0.45, 0.5, (rng.uniform(-1.2, 1.2), 1.18,
                                      rng.uniform(-0.4, 0.4)), OAK_DARK,
                     yaw=rng.uniform(0, 1.5)))
    return ground(p)


def windmill(seed=5):
    """Broken Harvest's landmark: a stone tower you see from the river, its cap
    knocked askew, two of four sails still on the hub.

    The first pass built the sails with a dead branch in the expression and they
    came out as boxes flying off sideways from nothing. They are built off the
    hub properly now -- arms in the plane of the sail wheel, canvas on the two
    that survive, stubs on the two that did not.
    """
    p = []
    # tapered tower in four faceted drums -- eight-sided, not smooth, on purpose
    for i, (r, y, h) in enumerate(((1.85, 0.0, 1.7), (1.68, 1.7, 1.7),
                                   (1.50, 3.4, 1.7), (1.33, 5.1, 1.5))):
        m = trimesh.creation.cylinder(radius=r, height=h, sections=8)
        m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
        m.apply_translation((0, y + h / 2, 0))
        mat = MILL if i % 2 == 0 else STONE
        m.metadata['colour'] = mat[0]; m.metadata['mat'] = mat[1]
        p.append(m)
    p.append(box(2.5, 1.0, 2.5, (0.18, 7.1, 0), OAK_DARK, tilt=0.14))   # the cap, askew
    p.append(box(1.0, 1.9, 1.4, (1.7, 0.95, 0), OAK_DARK))              # door hood
    # the sail wheel: a hub on the front face, arms in the Y-Z plane
    HUB = (0, 6.95, 1.55)
    p.append(disc(0.34, 0.5, HUB, IRON, axis='x', sides=8))
    # An arm at angle `a` runs along (0, sin a, cos a). A box built along +Y and
    # rolled about X by (pi/2 - a) points exactly there. The first pass picked
    # between a Y-long box and a Z-long box instead, which is only correct at 0
    # and 90 degrees -- the other two arms came out as slabs pointing at
    # nothing, which is what a sail wheel must never look like.
    for a, reach in ((0.55, 3.6), (0.55 + math.pi, 3.6),
                     (0.55 + math.pi / 2, 1.1), (0.55 - math.pi / 2, 0.8)):
        roll = math.pi / 2 - a
        mid = (HUB[0], HUB[1] + math.sin(a) * reach / 2, HUB[2] + math.cos(a) * reach / 2)
        p.append(box(0.20, reach, 0.20, mid, OAK, roll=roll))
        if reach > 2.0:                                   # canvas only where a sail survived
            p.append(box(0.06, reach * 0.78, 0.95, mid, CANVAS, roll=roll))
    p.append(box(3.0, 0.20, 0.20, (2.2, 0.35, -2.6), OAK, yaw=0.7))     # a sail down in the grass
    p.append(box(2.2, 0.06, 0.9, (2.2, 0.42, -2.6), CANVAS, yaw=0.7))
    return ground(p)


def gallows(seed=6):
    """What Gallows Rise is named for. Two posts, a beam, a brace and a rope --
    and a platform, so it reads as a structure rather than a goalpost."""
    p = []
    p.append(box(2.8, 0.45, 2.0, (0, 0.22, 0), OAK_DARK))              # platform
    for dx in (-1.15, 1.15):
        p.append(box(0.28, 3.4, 0.28, (dx, 2.15, 0), OAK))             # posts
    p.append(box(3.0, 0.30, 0.30, (0, 3.9, 0), OAK))                   # head beam
    for dx in (-0.85, 0.85):
        p.append(box(0.8, 0.18, 0.18, (dx, 3.55, 0), OAK_PALE, tilt=-0.7 if dx > 0 else 0.7))
    p.append(box(0.07, 1.1, 0.07, (0.35, 3.2, 0), ROPE))               # the rope
    p.append(box(0.24, 0.24, 0.24, (0.35, 2.62, 0), ROPE))
    for i in range(3):                                                  # steps
        p.append(box(0.9, 0.16, 0.42, (1.75 + i * 0.05, 0.08 + i * 0.15, -0.9 + i * 0.42), OAK_DARK))
    p.append(box(0.2, 1.4, 0.2, (-1.7, 0.9, 0.8), CHARRED, tilt=0.35)) # a burnt stake beside it
    return ground(p)


def drystone_wall(seed=7, length=4.0, broken=False):
    """The field boundaries. Built as a course of irregular blocks rather than
    one box, because a dry-stone wall read from ten metres is its lumpy top
    edge and nothing else.

    4 m long to sit on the same grid as the ruin kit and the boardwalks.
    """
    rng = random.Random(seed)
    p = []
    x = -length / 2
    gap_at = rng.uniform(0.3, 0.7) * length - length / 2 if broken else 1e9
    while x < length / 2 - 0.05:
        w = rng.uniform(0.34, 0.62)
        w = min(w, length / 2 - x)
        if broken and gap_at <= x <= gap_at + 1.1:
            x += w
            continue
        h = rng.uniform(0.62, 0.92) * (0.55 if broken else 1.0)
        for (yy, hh) in ((h * 0.28, h * 0.56), (h * 0.78, h * 0.44)):
            p.append(box(w * rng.uniform(0.85, 1.0), hh, rng.uniform(0.42, 0.56),
                         (x + w / 2, yy, rng.uniform(-0.05, 0.05)),
                         STONE if rng.random() < 0.6 else STONE_DARK,
                         yaw=rng.uniform(-0.09, 0.09)))
        x += w
    if broken:                                                          # spill
        for _ in range(5):
            p.append(box(rng.uniform(0.28, 0.44), 0.22, rng.uniform(0.28, 0.4),
                         (gap_at + rng.uniform(-0.4, 1.5), 0.11, rng.uniform(-1.0, 1.0)),
                         STONE_DARK, yaw=rng.uniform(0, 3.1)))
    return ground(p)


def quarry_winch(seed=8):
    """Ironroot Quarry. A timber gantry with a drum and a bucket on a rope."""
    p = []
    for dz in (-0.9, 0.9):                                              # legs
        p.append(box(0.24, 3.2, 0.24, (-0.7, 1.6, dz), OAK, tilt=0.20))
        p.append(box(0.24, 3.2, 0.24, (0.7, 1.6, dz), OAK, tilt=-0.20))
    p.append(box(0.26, 0.26, 2.2, (0, 3.15, 0), OAK_DARK))              # head
    p.append(box(2.6, 0.22, 0.22, (0.9, 3.05, 0), OAK, tilt=0.12))      # jib out over the face
    p.append(disc(0.34, 1.3, (0, 1.9, 0), OAK_DARK, axis='z', sides=8)) # drum
    p.append(box(0.9, 0.12, 0.12, (-0.75, 1.9, 0), IRON, yaw=0.9))      # crank
    p.append(box(0.08, 2.0, 0.08, (2.05, 2.0, 0), ROPE))                # rope
    p.append(box(0.7, 0.6, 0.7, (2.05, 0.75, 0), RUST))                 # bucket
    for dz in (-0.9, 0.9):                                              # ground sleepers
        p.append(box(2.2, 0.20, 0.26, (0, 0.10, dz), OAK_DARK))
    return ground(p)


PIECES = {
    'Catapult_Wreck':    catapult_wreck,
    'Trebuchet_Wreck':   trebuchet_wreck,
    'Ballista':          ballista,
    'Supply_Wagon':      supply_wagon,
    'Windmill_Ruined':   windmill,
    'Gallows':           gallows,
    'Drystone_Wall':     lambda s=7: drystone_wall(s, broken=False),
    'Drystone_Wall_Broken': lambda s=9: drystone_wall(s, broken=True),
    'Quarry_Winch':      quarry_winch,
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, fn in PIECES.items():
        parts = fn()
        path, faces = glbkit.save(OUT, name, parts, roughness=0.93)
        total += faces
        print(f'  {name:<22} {faces:5d} tris  {len(parts):3d} parts')
    print(f'{len(PIECES)} pieces, {total} triangles -> {OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
