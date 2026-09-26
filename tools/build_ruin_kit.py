#!/usr/bin/env python3
"""A modular ruin kit: the pieces the Dark Woods' ruins are assembled from.

Pitkakangas (Implementation of a 3D Game Environment, Kajaani UAS 2014, ch. 3.5)
makes the case these follow: build the world from carefully-made smaller pieces
that fit together, and you get a detailed whole in less time, a consistent look,
fixes that propagate to every ruin at once, and -- because every copy is an
instance of the same asset -- no extra memory or extra batch per copy. He also
notes a piece can be reused outside its original purpose, which is why the
column here doubles as a door jamb and a gate post.

THE GRID. The wall unit is 4 m. Every piece is a whole number of units along its
length, and the small details are 2 m or 1 m so they divide the big ones, which
is his rule for making modular assets snap together.

Each piece is authored so that:
  * its length runs along local X, its thickness along local Z
  * the ORIGIN is the centre of the footprint, base at y = 0
  * a yaw of 0 leaves the wall running east-west, facing -Z

These are still grey-box stand-ins -- replace any file with real art under the
same name and the layouts in tools/build_darkwoods.py keep working.

Run:  python3 tools/build_ruin_kit.py        (needs trimesh + numpy)
Writes client/models/ruin/<Name>.glb
"""
import math
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'models' / 'ruin'

UNIT = 4.0          # the grid: one wall unit
THICK = 0.6         # wall thickness
TALL = 5.0          # a full-height wall

STONE = (0.57, 0.56, 0.53)
STONE_DK = (0.45, 0.44, 0.42)
STONE_LT = (0.67, 0.66, 0.62)


def box(sx, sy, sz, at=(0, 0, 0), colour=STONE, yaw=0.0, tilt=0.0):
    m = trimesh.creation.box(extents=(sx, sy, sz))
    if tilt:
        m.apply_transform(trimesh.transformations.rotation_matrix(tilt, (0, 0, 1)))
    if yaw:
        m.apply_transform(trimesh.transformations.rotation_matrix(yaw, (0, 1, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = colour
    return m


def cyl(r, h, at=(0, 0, 0), colour=STONE, sections=10):
    # trimesh builds cylinders along Z; the game is Y-up, so turn it.
    m = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
    m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = colour
    return m


def save(name, parts):
    """One mesh per colour, each with its own PBR material -- NOT vertex colours,
    which the client's bakeModel strips (the model would render black)."""
    groups = {}
    for part in parts:
        groups.setdefault(tuple(part.metadata['colour']), []).append(part)
    scene = trimesh.Scene()
    faces = 0
    for i, (colour, members) in enumerate(groups.items()):
        m = trimesh.util.concatenate(members) if len(members) > 1 else members[0].copy()
        m.merge_vertices()
        m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=f'{name}_{i}',
            baseColorFactor=[int(round(c * 255)) for c in colour] + [255],
            metallicFactor=0.0, roughnessFactor=0.95))
        scene.add_geometry(m, node_name=f'{name}_{i}')
        faces += len(m.faces)
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f'{name}.glb'
    scene.export(p)
    return p, faces


def coursed(w, h, z=0.0, courses=3, colour=STONE, alt=STONE_DK):
    """A wall as stacked courses rather than one tall box. Hofer p.60: a big flat
    face shades badly and a single change in direction smears across all of it;
    the courses also stop a blank wall reading as cardboard."""
    out, y = [], 0.0
    for i in range(courses):
        ch = h / courses
        # Inset the THICKNESS, never the width. Insetting the width shaved a
        # few centimetres off each course's end, and where two wall pieces abut
        # that left a crack straight through the building -- measurable on the
        # Crow Hill tower as a slot you could see the hillside through.
        inset = 0.0 if i == 0 else 0.04 * i
        out.append(box(w, ch, THICK - inset, (0, y + ch / 2, z),
                       colour if i % 2 == 0 else alt))
        y += ch
    return out


def wall():
    return coursed(UNIT, TALL, courses=4)


def wall_half():
    """Broken to about waist-and-a-half: you see over it, not through it."""
    p = coursed(UNIT, 3.0, courses=3)
    p.append(box(UNIT * 0.42, 0.5, THICK, (-UNIT * 0.2, 3.2, 0), STONE_LT))   # ragged crown
    return p


def wall_low():
    """A ruined course. Still solid -- a knee-high wall you walk round."""
    p = coursed(UNIT, 1.5, courses=2)
    p.append(box(UNIT * 0.55, 0.35, THICK, (UNIT * 0.16, 1.62, 0), STONE_LT))
    return p


def wall_door():
    """A 2.2 m doorway in a 4 m wall. The collision gap in the zone data must
    match this opening, or you get a door you cannot walk through."""
    gap, head = 2.2, 3.0
    side = (UNIT - gap) / 2
    p = []
    for sx in (-1, 1):
        p += [box(side, TALL, THICK, (sx * (gap + side) / 2, TALL / 2, 0),
                  STONE if sx < 0 else STONE_DK)]
    p.append(box(gap + 0.5, TALL - head, THICK, (0, head + (TALL - head) / 2, 0), STONE))  # lintel
    for sx in (-1, 1):   # jambs -- the column reused as a door frame
        p.append(box(0.34, head, THICK + 0.14, (sx * gap / 2, head / 2, 0), STONE_LT))
    return p


def wall_window():
    w, h, sill = 1.4, 1.4, 2.2
    p = coursed(UNIT, TALL, courses=4)
    p.append(box(w, h, THICK + 0.2, (0, sill + h / 2, 0), (0.10, 0.11, 0.13)))   # the hole, read as dark
    p.append(box(w + 0.5, 0.22, THICK + 0.16, (0, sill - 0.1, 0), STONE_LT))     # sill
    return p


def gable():
    """The triangular top that closes a nave's end wall. Sits on a full wall."""
    v = np.array([[-UNIT / 2, 0, -THICK / 2], [UNIT / 2, 0, -THICK / 2], [0, 3.0, -THICK / 2],
                  [-UNIT / 2, 0, THICK / 2], [UNIT / 2, 0, THICK / 2], [0, 3.0, THICK / 2]], float)
    f = np.array([[0, 1, 2], [5, 4, 3], [0, 3, 4], [0, 4, 1], [1, 4, 5], [1, 5, 2], [2, 5, 3], [2, 3, 0]])
    m = trimesh.Trimesh(vertices=v, faces=f, process=False)
    m.metadata['colour'] = STONE
    return [m]


def column():
    """Free-standing. Doubles as a door jamb and a gate post -- Pitkakangas's
    point about reusing a piece outside its original purpose."""
    return [
        box(1.0, 0.3, 1.0, (0, 0.15, 0), STONE_DK),
        cyl(0.36, 3.9, (0, 2.1, 0), STONE, sections=10),
        box(0.9, 0.28, 0.9, (0, 4.2, 0), STONE_LT),
    ]


def arch():
    """A free-standing arch spanning one unit. The threshold piece."""
    p = []
    for sx in (-1, 1):
        p.append(box(0.7, 3.4, THICK + 0.2, (sx * (UNIT / 2 - 0.35), 1.7, 0), STONE))
    p.append(box(UNIT, 0.8, THICK + 0.2, (0, 3.8, 0), STONE_DK))
    p.append(box(UNIT - 1.4, 0.5, THICK + 0.26, (0, 3.35, 0), STONE_LT))   # springing
    return p


def floor():
    return [box(UNIT, 0.3, UNIT, (0, 0.15, 0), STONE_DK),
            box(UNIT - 0.6, 0.06, UNIT - 0.6, (0, 0.32, 0), STONE)]


def rubble():
    p = []
    for i, (x, z, s, r) in enumerate([(-0.6, -0.3, 1.1, 0.4), (0.5, 0.35, 0.8, 1.2),
                                      (0.1, -0.6, 0.6, 2.3), (-0.3, 0.6, 0.5, 0.9)]):
        p.append(box(s, s * 0.55, s * 0.8, (x, s * 0.28, z),
                     STONE if i % 2 else STONE_DK, yaw=r))
    return p


def altar():
    return [box(2.4, 0.9, 1.2, (0, 0.45, 0), STONE_LT),
            box(2.8, 0.22, 1.5, (0, 1.0, 0), STONE),
            box(1.9, 0.18, 0.9, (0, 0.12, 0), STONE_DK)]


def stair():
    """Two metres of rise in half-metre steps -- for getting into a tower whose
    threshold sits above the ground."""
    p = []
    for i in range(4):
        p.append(box(2.0, 0.5, 0.7 * (4 - i), (0, 0.25 + i * 0.5, -0.35 * i), STONE if i % 2 else STONE_DK))
    return p


def main():
    kit = [
        ('Ruin_Wall', wall()), ('Ruin_Wall_Half', wall_half()), ('Ruin_Wall_Low', wall_low()),
        ('Ruin_Wall_Door', wall_door()), ('Ruin_Wall_Window', wall_window()),
        ('Ruin_Gable', gable()), ('Ruin_Column', column()), ('Ruin_Arch', arch()),
        ('Ruin_Floor', floor()), ('Ruin_Rubble', rubble()), ('Ruin_Altar', altar()),
        ('Ruin_Stair', stair()),
    ]
    total = 0
    for name, parts in kit:
        p, faces = save(name, parts)
        total += faces
        b = trimesh.load(p).bounds
        d = [round(float(b[1][i] - b[0][i]), 1) for i in range(3)]
        print(f'  {p.relative_to(ROOT)}  {faces:4d} tris  {d[0]} x {d[1]} x {d[2]} m')
    print(f'{len(kit)} kit pieces, {total} triangles — grid unit {UNIT} m')


if __name__ == '__main__':
    main()
