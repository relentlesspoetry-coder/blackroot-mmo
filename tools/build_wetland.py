#!/usr/bin/env python3
"""The Murkfen boardwalk: a parametric generator for plank walkways.

The blueprint draws plank walks threading the Murkfen, and the asset pack has
nothing of the sort -- the nearest thing is a cave web bridge. So this builds
them, and builds them the way Nylund (Proseduraalisesti generoidut 3D mallit
peleissa, Metropolia 2026) argues for: one generator with parameters rather than
one hand-made model, because the win from procedural modelling is precisely in
"varioitujen toistuvien assettien luonti" -- varied repeating assets. A
boardwalk is nothing but a repeating asset that must not look repeated.

So `deck()` takes the parameters -- how many planks, how wide the gaps, how much
the boards warp, how many are missing, how the pilings lean -- and the variants
below are the same generator run with different numbers and a different seed.
Change a parameter here and every variant moves together.

The deck is 4 m long, matching the ruin kit's grid, so the two kits interleave.

Conventions: metres, Y up, length along local X, base at y = 0, colour in glTF
materials (vertex colours are stripped by the client's bakeModel).

Run:  python3 tools/build_wetland.py        (needs trimesh + numpy)
Writes client/models/wetland/<Name>.glb
"""
import math
from pathlib import Path

import numpy as np
import trimesh

import glbkit

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'models' / 'wetland'

UNIT = 4.0          # deck length -- the same grid the ruin kit uses
DECK_W = 2.4        # walkable width
DECK_Y = 0.55       # top of the planks above the piece's base

WOOD = (0.40, 0.30, 0.19)
WOOD_PALE = (0.52, 0.41, 0.27)
WOOD_GREY = (0.44, 0.42, 0.36)
WOOD_DARK = (0.27, 0.20, 0.13)
MOSS = (0.28, 0.38, 0.20)
ROPE = (0.46, 0.40, 0.26)


def box(sx, sy, sz, at=(0, 0, 0), colour=WOOD, yaw=0.0, tilt=0.0, roll=0.0):
    m = trimesh.creation.box(extents=(sx, sy, sz))
    if tilt:
        m.apply_transform(trimesh.transformations.rotation_matrix(tilt, (0, 0, 1)))
    if roll:
        m.apply_transform(trimesh.transformations.rotation_matrix(roll, (1, 0, 0)))
    if yaw:
        m.apply_transform(trimesh.transformations.rotation_matrix(yaw, (0, 1, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = colour
    return m


def save(name, parts):
    """One mesh per colour, each with its own PBR material -- and FLAT normals.
    See tools/glbkit.py for why both of those matter."""
    return glbkit.save(OUT, name, parts, roughness=0.94)


# --------------------------------------------------------------- the generator
def deck(seed, planks=9, gap=0.06, warp=0.035, missing=1, moss=0.25,
         lean=0.05, rail=None, length=UNIT, width=DECK_W, posts=True):
    """One span of boardwalk.

    Every argument is a knob. The variants at the bottom of the file are this
    same function with different numbers -- which is the whole point: a hundred
    spans that are visibly not the same span.

    planks   how many boards across the span      gap    space between them
    warp     how far a board may sag or lift      missing how many are gone
    moss     chance a board has gone green        lean   how drunk the pilings are
    rail     None, 'low' or 'rope'                posts  pilings under the deck
    """
    rng = np.random.default_rng(seed)
    p = []

    # two bearers running the length, carrying everything
    for sz in (-1, 1):
        p.append(box(length, 0.16, 0.18, (0, DECK_Y - 0.12, sz * (width / 2 - 0.16)), WOOD_DARK))

    # the boards themselves, laid across
    pitch = length / planks
    board_w = pitch - gap
    gone = set(rng.choice(planks, size=min(missing, planks - 3), replace=False)) if missing else set()
    for i in range(planks):
        if i in gone:
            continue
        x = -length / 2 + pitch * (i + 0.5)
        dy = (rng.random() - 0.5) * 2 * warp          # a board that has lifted or sagged
        roll = (rng.random() - 0.5) * 0.05
        col = MOSS if rng.random() < moss else (WOOD_PALE if rng.random() < 0.4 else WOOD)
        p.append(box(board_w, 0.09, width, (x, DECK_Y + dy, 0), col, roll=roll))

    # pilings, driven down into whatever is under the water
    if posts:
        for sx in (-1, 1):
            for sz in (-1, 1):
                lx = sx * (length / 2 - 0.3)
                lz = sz * (width / 2 - 0.18)
                p.append(box(0.22, 1.9, 0.22,
                             (lx + (rng.random() - 0.5) * 0.12, DECK_Y - 0.95, lz),
                             WOOD_DARK, tilt=(rng.random() - 0.5) * 2 * lean))

    # a handrail on the spans that have one
    if rail == 'low':
        for sz in (-1, 1):
            for sx in (-1, 1):
                p.append(box(0.14, 0.9, 0.14, (sx * (length / 2 - 0.35), DECK_Y + 0.45,
                                               sz * (width / 2 - 0.1)), WOOD_DARK))
            p.append(box(length - 0.4, 0.1, 0.12, (0, DECK_Y + 0.88, sz * (width / 2 - 0.1)), WOOD_GREY))
    elif rail == 'rope':
        for sz in (-1, 1):
            for sx in (-1, 1):
                p.append(box(0.13, 1.0, 0.13, (sx * (length / 2 - 0.35), DECK_Y + 0.5,
                                               sz * (width / 2 - 0.1)), WOOD_DARK))
            # the rope sags between the posts, in three straight runs
            for k, (o, dy) in enumerate([(-0.3, -0.13), (0.0, -0.19), (0.3, -0.13)]):
                p.append(box((length - 0.7) / 3, 0.07, 0.07,
                             (o * (length - 0.7), DECK_Y + 0.95 + dy, sz * (width / 2 - 0.1)), ROPE))
    return p


def corner(seed):
    """A right-angle turn: half a span each way, sharing the pivot."""
    rng = np.random.default_rng(seed)
    p = deck(seed, planks=5, length=UNIT / 2, missing=0, rail=None, posts=False)
    for m in p:
        m.apply_translation((UNIT / 4, 0, 0))
    arm = deck(seed + 1, planks=5, length=UNIT / 2, missing=0, rail=None, posts=False)
    for m in arm:
        m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (0, 1, 0)))
        m.apply_translation((0, 0, UNIT / 4))
    p += arm
    for sx, sz in ((-1, -1), (1, -1), (-1, 1)):
        p.append(box(0.24, 1.9, 0.24, (sx * 0.95, DECK_Y - 0.95, sz * 0.95), WOOD_DARK,
                     tilt=(rng.random() - 0.5) * 0.08))
    return p


def jetty_head(seed):
    """The wide end of a walk: somewhere to stand and fish from."""
    rng = np.random.default_rng(seed)
    p = deck(seed, planks=11, length=UNIT, width=3.6, missing=0, rail='rope', posts=False)
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.append(box(0.26, 2.1, 0.26, (sx * 1.7, DECK_Y - 1.05, sz * 1.5), WOOD_DARK,
                         tilt=(rng.random() - 0.5) * 0.06))
    p.append(box(0.9, 0.5, 0.9, (1.2, DECK_Y + 0.3, -1.0), WOOD_PALE))     # a crate to sit on
    return p


def piling(seed):
    """A clump of old posts standing in the water, going nowhere. Marks where a
    walk has rotted away."""
    rng = np.random.default_rng(seed)
    p = []
    for i in range(4):
        a = rng.random() * math.tau
        r = rng.random() * 0.7
        h = 1.2 + rng.random() * 1.3
        p.append(box(0.22, h, 0.22, (math.cos(a) * r, h / 2, math.sin(a) * r),
                     WOOD_DARK if i % 2 else WOOD_GREY, tilt=(rng.random() - 0.5) * 0.22))
    return p


def main():
    made = [
        # the same generator, different numbers -- that is the variation
        # `missing` is 0 on every walking span. A hole in the planks is an
        # excellent detail on a ruin and a bad one on a floor: the deck is solid
        # to walk on, so a gap you can see through is the game telling you a lie
        # about where you may put your feet. The weathering carries the age
        # instead -- warp, moss and the gaps between boards, none of which read
        # as somewhere you would fall.
        ('Boardwalk_A', deck(11, planks=9, missing=0, moss=0.25, rail=None)),
        ('Boardwalk_B', deck(23, planks=8, gap=0.09, warp=0.055, missing=0, moss=0.45, rail=None)),
        ('Boardwalk_C', deck(37, planks=10, gap=0.04, warp=0.02, missing=0, moss=0.12, rail='low')),
        ('Boardwalk_D', deck(51, planks=9, warp=0.045, missing=0, moss=0.35, rail='rope')),
        ('Boardwalk_Corner', corner(67)),
        ('Boardwalk_Jetty', jetty_head(83)),
        ('Boardwalk_Piling', piling(97)),
    ]
    total = 0
    for name, parts in made:
        p, faces = save(name, parts)
        total += faces
        b = trimesh.load(p).bounds
        d = [round(float(b[1][i] - b[0][i]), 1) for i in range(3)]
        print(f'  {p.relative_to(ROOT)}  {faces:4d} tris  {d[0]} x {d[1]} x {d[2]} m')
    print(f'{len(made)} wetland pieces, {total} triangles — deck top at {DECK_Y} m')


if __name__ == '__main__':
    main()
