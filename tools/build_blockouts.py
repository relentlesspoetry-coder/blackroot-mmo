#!/usr/bin/env python3
"""Grey-box stand-ins for the four structures the Dark Woods still needs.

These are PLACEHOLDERS, not art. Hofer (Game Art Asset Creation, FH Joanneum
2006, p.66) describes the step exactly: model a very rough version, don't care
about polygon flow, just get the proportions right, and hand the raw model to
the world-builders. That is what these are for -- so placement, scale and
silhouette can be judged in the running game before anyone spends a day on
stonework. Replace each one with the real asset under the same file name and
nothing else has to change.

Everything is flat grey on purpose. If a blockout looks like finished art, it
will get left in.

Conventions the client enforces (both learned the hard way):
  * colour lives in glTF MATERIALS -- bakeModel strips vertex colours and the
    model renders black
  * Y up, front faces -Z, metres, base at y = 0

Run:  python3 tools/build_blockouts.py      (needs trimesh + numpy)
Writes client/models/blockout/<Name>.glb
"""
import math
from pathlib import Path

import numpy as np
import trimesh

import glbkit

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'models' / 'blockout'

STONE = (0.56, 0.55, 0.52)
STONE_DK = (0.44, 0.43, 0.41)
STONE_LT = (0.66, 0.65, 0.61)


def box(sx, sy, sz, at=(0, 0, 0), colour=STONE, yaw=0.0, tilt=0.0):
    m = trimesh.creation.box(extents=(sx, sy, sz))
    if tilt:
        m.apply_transform(trimesh.transformations.rotation_matrix(tilt, (0, 0, 1)))
    if yaw:
        m.apply_transform(trimesh.transformations.rotation_matrix(yaw, (0, 1, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = colour
    return m


def save(name, parts):
    """One mesh per colour, each with its own PBR material -- and FLAT normals.
    See tools/glbkit.py for why both of those matter."""
    return glbkit.save(OUT, name, parts, roughness=0.95)


def chapel_ruin():
    """Roofless nave, 14 x 20 m, one gable end standing, altar at the east.

    The door is the SOUTH side and the NORTH wall is the collapsed one, which is
    what the zone's structure entry declares -- keep those two sides if you
    remodel it, or the collision stops matching the art.
    """
    W, D, H = 14.0, 20.0, 7.0
    t = 0.8
    p = []
    # side walls, broken down to a lower course toward the west (ruined end)
    for sx in (-1, 1):
        for i, (z0, h) in enumerate([(-8.0, H), (-3.5, H * 0.82), (1.0, H * 0.55), (5.5, H * 0.3)]):
            p.append(box(t, h, 4.2, (sx * (W / 2 - t / 2), h / 2, z0), STONE if i % 2 else STONE_DK))
    # east gable end -- the one piece still at full height
    p.append(box(W, H, t, (0, H / 2, -D / 2 + t / 2), STONE))
    p.append(box(W * 0.72, 3.2, t, (0, H + 1.6, -D / 2 + t / 2), STONE_LT))   # gable peak
    # south wall with the doorway left open by the gap in the collision
    for sx in (-1, 1):
        p.append(box(W / 2 - 1.3, H * 0.45, t, (sx * (W / 4 + 0.65), H * 0.225, D / 2 - t / 2), STONE_DK))
    # altar block at the east end, and a scatter of fallen stone
    p.append(box(2.6, 1.1, 1.4, (0, 0.55, -D / 2 + 2.8), STONE_LT))
    for i, (x, z, r) in enumerate([(-3.4, 4.0, 0.5), (2.8, -1.2, 1.1), (4.6, 6.2, 2.0), (-5.0, -4.5, 2.7)]):
        p.append(box(1.8, 0.7, 1.2, (x, 0.35, z), STONE_DK, yaw=r))
    p.append(box(W - 2 * t, 0.25, D - 2 * t, (0, 0.12, 0), STONE_DK))          # floor slab
    return p


def watchtower_ruin():
    """Square tower, 6 x 6 m, 14 m to the broken crown.

    Stepped rather than one tall box: Hofer p.60 -- a big change in direction
    straight onto a flat face smears the shading across the whole face. The
    steps also stop it reading as a chimney from the camp.
    """
    p = []
    courses = [(0.0, 4.5, 6.0), (4.5, 4.0, 5.5), (8.5, 3.4, 5.0), (11.9, 1.6, 5.4)]
    for i, (y0, h, w) in enumerate(courses):
        p.append(box(w, h, w, (0, y0 + h / 2, 0), STONE if i % 2 else STONE_DK))
    # broken crown: three merlons, one of them gone
    for i, (dx, dz) in enumerate([(-1.7, -1.7), (1.7, -1.7), (1.7, 1.7)]):
        p.append(box(1.5, 1.1 + 0.5 * (i % 2), 1.5, (dx, 14.0, dz), STONE_LT))
    p.append(box(7.0, 0.6, 7.0, (0, 0.3, 0), STONE_DK))                        # plinth
    p.append(box(1.9, 3.0, 0.5, (0, 1.9, 3.0), STONE_LT))                      # doorway reveal
    return p


def standing_stones():
    """A leaning pair with a fallen third. Reads as a threshold from a distance,
    which is the whole job -- it marks the chokepoint you are crossing."""
    p = [
        box(1.1, 4.0, 0.7, (-1.7, 2.0, 0), STONE, tilt=0.10),
        box(1.0, 3.6, 0.7, (1.7, 1.8, 0.2), STONE_DK, tilt=-0.13),
        box(3.4, 0.7, 0.9, (0.3, 0.35, 1.6), STONE_DK, yaw=0.35),              # fallen
        box(5.2, 0.35, 2.4, (0, 0.17, 0.4), STONE_LT),                         # worn ground
    ]
    return p


def waystone():
    """A boundary marker for the four ways out. Small, cheap, and it turns a gap
    in the trees into a threshold."""
    return [
        box(0.62, 1.5, 0.5, (0, 0.75, 0), STONE),
        box(0.74, 0.22, 0.62, (0, 1.6, 0), STONE_LT),                          # cap
        box(0.9, 0.24, 0.8, (0, 0.12, 0), STONE_DK),                           # footing
        box(0.36, 0.5, 0.06, (0, 0.95, -0.27), STONE_LT),                      # carved face
    ]


def main():
    made = [
        ('Blockout_Chapel_Ruin', chapel_ruin()),
        ('Blockout_Watchtower_Ruin', watchtower_ruin()),
        ('Blockout_Standing_Stones', standing_stones()),
        ('Blockout_Waystone', waystone()),
    ]
    for name, parts in made:
        p, faces = save(name, parts)
        b = trimesh.load(p).bounds
        dims = [round(float(b[1][i] - b[0][i]), 1) for i in range(3)]
        print(f'  {p.relative_to(ROOT)}  {faces} tris  {dims[0]} x {dims[1]} x {dims[2]} m')
    print(f'{len(made)} stand-ins — replace with real art under the same names')


if __name__ == '__main__':
    main()
