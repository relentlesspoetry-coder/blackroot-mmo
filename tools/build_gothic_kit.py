#!/usr/bin/env python3
"""Gothic pieces for the Fallen Chapel, and a timber top for the Crow Hill tower.

The first ruin kit was generic: coursed boxes, a rectangular door, a square
window. Stood next to its own concept sheet the chapel was plainly the wrong
building -- the sheet draws POINTED arches, a great traceried east window, a
rose over the altar and buttresses down the flanks, and none of that survives
being approximated with a box. Crow Hill had the same problem the other way
round: its sheet's tower is stone for three storeys and then TIMBER, an
overhanging gallery under a pitched shingle roof, and a stone stump reads as a
chimney instead.

So these are the shapes the drawings actually contain. They extend the same
4 m grid as tools/build_ruin_kit.py and write into the same folder, so the two
kits interleave and `RUIN_KIT` in tools/build_darkwoods.py just grows.

The arches are real two-centred arches -- voussoirs laid along the curve rather
than a triangle standing in for one. That matters more than it sounds: the
pointed arch IS the silhouette of this building, and it is what you read from
across the graveyard.

Conventions (shared with the other kits, both learned the hard way):
  * colour lives in glTF MATERIALS -- bakeModel strips vertex colours and the
    model renders black
  * trimesh builds cylinders along Z; the game is Y-up, so rotate them
  * metres, Y up, base at y = 0, a wall runs along local X and faces -Z

Run:  python3 tools/build_gothic_kit.py        (needs trimesh + numpy)
Writes client/models/ruin/<Name>.glb
"""
import math
from pathlib import Path

import numpy as np
import trimesh

import glbkit

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'models' / 'ruin'

U = 4.0            # the grid, same as the ruin kit
THICK = 0.6        # wall thickness
TALL = 7.0         # a Gothic nave wall -- taller than the old kit's 5 m

STONE = (0.57, 0.56, 0.53)
STONE_DK = (0.45, 0.44, 0.42)
STONE_LT = (0.67, 0.66, 0.62)
STONE_MOSS = (0.38, 0.45, 0.32)
VOID = (0.09, 0.10, 0.12)          # a window with nothing behind it reads as dark
WOOD = (0.38, 0.28, 0.18)
WOOD_DK = (0.25, 0.18, 0.11)
SHINGLE = (0.30, 0.26, 0.23)
SHINGLE_LT = (0.38, 0.33, 0.29)


def box(sx, sy, sz, at=(0, 0, 0), colour=STONE, yaw=0.0, tilt=0.0, roll=0.0):
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


def cyl(r, h, at=(0, 0, 0), colour=STONE, sections=8, tilt=0.0, yaw=0.0):
    # trimesh builds cylinders along Z; stand them up for a Y-up game.
    m = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
    m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
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


# --------------------------------------------------------------- the arch
def arch_apex(span, spring):
    """Height of the point of a two-centred (equilateral) arch."""
    return spring + math.sqrt(span * span - (span / 2) ** 2)


def arch_ring(span, spring, colour=STONE, segs=7, band=0.42, depth=THICK + 0.06,
              x0=0.0, z0=0.0):
    """Voussoirs following a two-centred pointed arch: two arcs of radius `span`
    struck from the opposite springing points, meeting at a point. Each stone is
    laid TANGENT to its arc, which is what makes the curve read as masonry
    rather than as a staircase of blocks."""
    R = span
    half = span / 2
    apex = arch_apex(span, spring)
    a_end = math.atan2(apex - spring, half)
    seg_len = R * a_end / segs * 1.18          # a little overlap, so no gaps
    out = []
    for side in (1, -1):
        cx = x0 - side * half
        for i in range(segs):
            a = (i + 0.5) / segs * a_end
            x = cx + side * R * math.cos(a)
            y = spring + R * math.sin(a)
            out.append(box(seg_len, band, depth, (x, y, z0),
                           colour if i % 2 else STONE_LT, tilt=side * a + math.pi / 2))
    return out


def opening(span, spring, colour=VOID, depth=THICK - 0.1, x0=0.0, z0=0.0, segs=6):
    """The dark behind a window: the shaft below the springing plus a stepped
    fill following the arch, so the hole is the shape of the arch and not a
    rectangle behind it."""
    out = [box(span - 0.16, spring - 0.1, depth, (x0, spring / 2 + 0.05, z0), colour)]
    apex = arch_apex(span, spring)
    for i in range(segs):
        t0 = i / segs
        y0 = spring + (apex - spring) * t0
        y1 = spring + (apex - spring) * (i + 1) / segs
        # width of the arch at this height, from the two arcs
        dy = y0 - spring
        w = 2 * (math.sqrt(max(0.0, span * span - dy * dy)) - span / 2)
        if w <= 0.05:
            continue
        out.append(box(w - 0.14, (y1 - y0) + 0.04, depth, (x0, (y0 + y1) / 2, z0), colour))
    return out


def coursed(w, h, courses=4, z=0.0, colour=STONE, alt=STONE_DK, thick=THICK):
    """A wall as stacked courses rather than one tall face."""
    out, y = [], 0.0
    for i in range(courses):
        ch = h / courses
        # thickness only -- insetting the width cracks abutting pieces open
        inset = 0.0 if i == 0 else 0.03 * i
        out.append(box(w, ch, thick - inset, (0, y + ch / 2, z),
                       colour if i % 2 == 0 else alt))
        y += ch
    return out


# ------------------------------------------------------------- the chapel
def wall_tall():
    """A plain nave wall at the new height, so a lancet bay has something to
    stand beside without a step in the wall head."""
    p = coursed(U, TALL, courses=6)
    p.append(box(U * 0.5, 0.35, THICK, (-U * 0.18, TALL + 0.16, 0), STONE_LT))   # ragged head
    return p


def lancet():
    """A nave bay: one tall pointed window with a moulded surround. This is the
    piece the whole building is made of, so it carries the mouldings."""
    span, spring = 1.35, 3.30
    apex = arch_apex(span, spring)
    p = []
    # the wall either side of the opening, in courses
    side_w = (U - span) / 2
    for sx in (-1, 1):
        for i in range(6):
            ch = TALL / 6
            p.append(box(side_w, ch, THICK - 0.03 * i,
                         (sx * (span + side_w) / 2, ch / 2 + i * ch, 0),
                         STONE if i % 2 == 0 else STONE_DK))
    p += opening(span, spring)
    p += arch_ring(span, spring)
    # jambs and sill
    for sx in (-1, 1):
        p.append(box(0.22, spring, THICK + 0.12, (sx * (span / 2 + 0.05), spring / 2, 0), STONE_LT))
    p.append(box(span + 0.7, 0.22, THICK + 0.18, (0, spring - 0.28, 0), STONE_LT))
    # the wall above the arch, and a weathered head
    head = TALL - apex
    if head > 0.2:
        p.append(box(U, head - 0.1, THICK - 0.14, (0, apex + head / 2, 0), STONE_DK))
    p.append(box(U * 0.46, 0.34, THICK, (U * 0.2, TALL + 0.15, 0), STONE_LT))
    return p


def east_window():
    """The great east window. Its sheet makes this the hero of the ruin -- the
    one thing standing at full height with the light coming through it -- so it
    is nearly the whole bay, with a mullion and tracery in the head."""
    span, spring = 2.55, 4.10
    apex = arch_apex(span, spring)
    H = 9.4
    p = []
    side_w = (U - span) / 2
    for sx in (-1, 1):
        for i in range(7):
            ch = H / 7
            p.append(box(side_w, ch, THICK - 0.02 * i,
                         (sx * (span + side_w) / 2, ch / 2 + i * ch, 0),
                         STONE if i % 2 == 0 else STONE_DK))
    p += opening(span, spring, segs=7)
    p += arch_ring(span, spring, segs=9, band=0.46)
    # two mullions dividing it into three lights
    for mx in (-span / 6, span / 6):
        p.append(box(0.16, spring - 0.15, THICK + 0.02, (mx, (spring - 0.15) / 2 + 0.05, 0), STONE_LT))
    # tracery in the head: a small arch over each pair, and a quatrefoil above
    p += arch_ring(span / 2.1, spring + 0.1, segs=5, band=0.16, depth=THICK + 0.02,
                   x0=-span / 5.0)
    p += arch_ring(span / 2.1, spring + 0.1, segs=5, band=0.16, depth=THICK + 0.02,
                   x0=span / 5.0)
    for a in range(8):
        th = a / 8 * math.tau
        p.append(box(0.17, 0.17, THICK + 0.02,
                     (math.cos(th) * 0.42, apex - 1.15 + math.sin(th) * 0.42, 0), STONE_LT))
    for sx in (-1, 1):                                    # jambs
        p.append(box(0.26, spring, THICK + 0.16, (sx * (span / 2 + 0.06), spring / 2, 0), STONE_LT))
    p.append(box(span + 0.9, 0.26, THICK + 0.22, (0, spring - 0.32, 0), STONE_LT))
    p.append(box(U, H - apex - 0.1, THICK - 0.12, (0, apex + (H - apex) / 2, 0), STONE_DK))
    p.append(box(U * 0.55, 0.36, THICK, (-U * 0.15, H + 0.16, 0), STONE_MOSS))
    return p


def rose_window():
    """The wheel over the altar. Its interior view puts one high on the end
    wall; a ring of stones with spokes reads as one from any distance that
    matters."""
    R, cy = 1.22, 4.60
    H = 7.6
    p = coursed(U, H, courses=6)
    p.append(cyl(R + 0.30, THICK + 0.06, (0, cy, 0), STONE_LT, sections=14,
                 tilt=math.pi / 2, yaw=math.pi / 2))       # the outer ring
    p.append(cyl(R, THICK + 0.14, (0, cy, 0), VOID, sections=14,
                 tilt=math.pi / 2, yaw=math.pi / 2))       # the dark
    for a in range(8):                                     # spokes
        th = a / 8 * math.tau
        p.append(box(R * 1.9, 0.13, THICK + 0.08, (0, cy, 0), STONE_LT, tilt=th))
    p.append(cyl(0.26, THICK + 0.16, (0, cy, 0), STONE_LT, sections=8,
                 tilt=math.pi / 2, yaw=math.pi / 2))       # the hub
    p.append(box(U * 0.5, 0.34, THICK, (U * 0.16, H + 0.15, 0), STONE_LT))
    return p


def arcade():
    """A free-standing pointed arch on two piers: the "broken arches" the sheet
    leads on. Spans one bay, so a row of them marches down the nave."""
    span, spring = 2.6, 4.0
    p = []
    for sx in (-1, 1):
        p.append(box(0.72, spring, 0.72, (sx * (span / 2 + 0.36), spring / 2, 0), STONE))
        p.append(box(0.92, 0.26, 0.92, (sx * (span / 2 + 0.36), 0.13, 0), STONE_DK))     # base
        p.append(box(0.88, 0.22, 0.88, (sx * (span / 2 + 0.36), spring + 0.11, 0), STONE_LT))  # cap
    p += arch_ring(span, spring + 0.22, segs=8, band=0.44, depth=0.66)
    apex = arch_apex(span, spring + 0.22)
    p.append(box(0.5, 0.4, 0.66, (0, apex + 0.18, 0), STONE_MOSS))   # broken crown
    return p


def buttress():
    """Stepped, and it leans against the wall it holds up. Placed OUTSIDE the
    nave at the bay joints; the sheet's flanks are all buttress and shadow."""
    p = []
    for i, (h, d, w) in enumerate([(2.2, 1.55, 1.05), (2.0, 1.15, 0.92), (1.7, 0.78, 0.80)]):
        y = sum(x[0] for x in [(2.2,), (2.0,), (1.7,)][:i])
        p.append(box(w, h, d, (0, y + h / 2, d / 2 - 0.15),
                     STONE if i % 2 == 0 else STONE_DK))
    # the weathered slope on each set-off, which is what a buttress is for
    for i, (y, d, w) in enumerate([(2.2, 1.55, 1.05), (4.2, 1.15, 0.92)]):
        p.append(box(w, 0.26, d * 0.7, (0, y + 0.1, d * 0.62), STONE_LT, roll=-0.5))
    p.append(box(0.74, 0.5, 0.7, (0, 5.9, 0.2), STONE_LT, roll=-0.6))
    return p


def pier():
    """A clustered pier: a core with engaged shafts. Replaces the plain drum in
    the nave, because a Gothic interior is read off its verticals."""
    H = 6.0
    p = [box(1.05, 0.30, 1.05, (0, 0.15, 0), STONE_DK),
         box(0.92, 0.22, 0.92, (0, 0.40, 0), STONE)]
    p.append(box(0.52, H, 0.52, (0, H / 2 + 0.5, 0), STONE))
    for a in range(4):
        th = a / 4 * math.tau + math.pi / 4
        p.append(cyl(0.15, H, (math.cos(th) * 0.30, H / 2 + 0.5, math.sin(th) * 0.30),
                     STONE_LT, sections=6))
    p.append(box(1.00, 0.26, 1.00, (0, H + 0.62, 0), STONE_LT))       # capital
    p.append(box(0.80, 0.20, 0.80, (0, H + 0.85, 0), STONE_MOSS))     # broken off above
    return p


def steps_wide():
    """The flight up to the west door. Its sheet walks you up a stair to the
    chapel platform, and a door you step straight into has no arrival."""
    p = []
    n = 5
    for i in range(n):
        p.append(box(U, 0.24, 0.62 * (n - i) + 0.4,
                     (0, 0.12 + i * 0.24, -0.31 * i),
                     STONE if i % 2 else STONE_DK))
    for sx in (-1, 1):                                   # cheek walls
        p.append(box(0.34, 1.35, 2.2, (sx * (U / 2 + 0.17), 0.68, -0.62), STONE_LT, roll=0.18))
    return p


def door_arch():
    """A 4 m wall with a POINTED doorway. The old kit's door has a flat lintel,
    which is the one thing a Gothic chapel would not have."""
    span, spring = 1.9, 2.35
    apex = arch_apex(span, spring)
    p = []
    side_w = (U - span) / 2
    for sx in (-1, 1):
        for i in range(6):
            ch = TALL / 6
            p.append(box(side_w, ch, THICK - 0.03 * i,
                         (sx * (span + side_w) / 2, ch / 2 + i * ch, 0),
                         STONE if i % 2 == 0 else STONE_DK))
    p += arch_ring(span, spring, segs=7, band=0.38)
    for sx in (-1, 1):
        p.append(box(0.24, spring, THICK + 0.16, (sx * (span / 2 + 0.04), spring / 2, 0), STONE_LT))
    p.append(box(U, TALL - apex - 0.1, THICK - 0.12, (0, apex + (TALL - apex) / 2, 0), STONE_DK))
    p.append(box(U * 0.44, 0.32, THICK, (-U * 0.2, TALL + 0.14, 0), STONE_LT))
    return p


# ---------------------------------------------------------------- the tower
def tower_slit():
    """A 4 m wall with an arrow slit -- the tower's windows on its sheet are
    slots, not the chapel's traceried lights."""
    p = coursed(U, 5.0, courses=4)
    p.append(box(0.26, 1.55, THICK + 0.1, (0, 2.85, 0), VOID))
    p.append(box(0.62, 0.18, THICK + 0.14, (0, 2.00, 0), STONE_LT))     # sill
    p.append(box(0.62, 0.18, THICK + 0.14, (0, 3.72, 0), STONE_LT))     # head
    return p


def tower_gallery():
    """The timber storey. Its sheet's tower changes material at the top: posts,
    an OVERHANGING boarded gallery and an open rail -- the overhang is the whole
    silhouette, so it projects a clear 0.7 m past the stone below.

    Built for an 8 m square tower, authored about its own centre."""
    S = 8.0
    over = S / 2 + 0.70
    p = []
    # the joists that carry the overhang, poking out under the floor
    for i in range(7):
        t = -1 + 2 * i / 6
        p.append(box(over * 2 + 0.3, 0.20, 0.20, (0, 0.10, t * (S / 2 - 0.3)), WOOD_DK))
        p.append(box(0.20, 0.20, over * 2 + 0.3, (t * (S / 2 - 0.3), 0.10, 0), WOOD_DK))
    p.append(box(over * 2, 0.20, over * 2, (0, 0.30, 0), WOOD))              # the deck
    for i in range(9):                                                        # boards
        t = -1 + 2 * i / 8
        p.append(box(over * 2 - 0.1, 0.07, over * 2 / 9.4,
                     (0, 0.44, t * (over - 0.5)), WOOD_DK if i % 2 else WOOD))
    # corner posts and rail
    H = 2.45
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.append(box(0.26, H, 0.26, (sx * (over - 0.2), H / 2 + 0.45, sz * (over - 0.2)), WOOD_DK))
    for sz in (-1, 1):
        p.append(box(over * 2 - 0.3, 0.16, 0.14, (0, 1.42, sz * (over - 0.2)), WOOD))
        p.append(box(0.14, 0.16, over * 2 - 0.3, (sz * (over - 0.2), 1.42, 0), WOOD))
    # a half-height boarded screen, open above it -- you look out over the rail
    for sz in (-1, 1):
        p.append(box(over * 2 - 0.3, 0.85, 0.10, (0, 0.95, sz * (over - 0.16)), WOOD))
        p.append(box(0.10, 0.85, over * 2 - 0.3, (sz * (over - 0.16), 0.95, 0), WOOD))
    # mid posts, so the rail does not span four metres unsupported
    for sx in (-1, 0, 1):
        for sz in (-1, 1):
            if sx == 0:
                p.append(box(0.18, H, 0.18, (0, H / 2 + 0.45, sz * (over - 0.2)), WOOD_DK))
                p.append(box(0.18, H, 0.18, (sz * (over - 0.2), H / 2 + 0.45, 0), WOOD_DK))
    return p


def tower_roof():
    """A pitched shingle roof with a deep eave, sitting on the gallery. Four
    slopes to a ridge; the overhang is what makes it read as a roof and not as
    a lid."""
    S = 9.4 / 2 + 0.55          # eave reaches past the gallery
    RISE = 2.9
    p = []
    # four trapezoid slopes, each built as a stack of narrowing shingle courses
    n = 7
    for i in range(n):
        t0, t1 = i / n, (i + 1) / n
        y0, y1 = RISE * t0, RISE * t1
        w0 = S * (1 - t0),
        w = S * (1 - (t0 + t1) / 2)
        p.append(box(w * 2 + 0.12, (y1 - y0) + 0.10, w * 2 + 0.12,
                     (0, 0.10 + (y0 + y1) / 2, 0),
                     SHINGLE if i % 2 else SHINGLE_LT))
    p.append(box(S * 2 + 0.5, 0.18, S * 2 + 0.5, (0, 0.09, 0), WOOD_DK))   # the eave board
    p.append(box(0.5, 0.34, 0.5, (0, RISE + 0.12, 0), WOOD_DK))            # ridge finial
    p.append(box(0.22, 0.9, 0.22, (0, RISE + 0.55, 0), WOOD_DK))
    return p


def tower_door():
    """The round-headed door at the tower's foot. Squatter and heavier than the
    chapel's -- a lookout, not a church."""
    span, spring = 1.7, 2.1
    p = []
    side_w = (U - span) / 2
    for sx in (-1, 1):
        for i in range(4):
            ch = 5.0 / 4
            p.append(box(side_w, ch, THICK - 0.03 * i,
                         (sx * (span + side_w) / 2, ch / 2 + i * ch, 0),
                         STONE if i % 2 == 0 else STONE_DK))
    # a round head: a half-circle of voussoirs, radius = half the span
    R = span / 2
    for i in range(9):
        a = math.pi * (i + 0.5) / 9
        p.append(box(R * math.pi / 9 * 1.2, 0.40, THICK + 0.08,
                     (R * math.cos(a), spring + R * math.sin(a), 0),
                     STONE if i % 2 else STONE_LT, tilt=a + math.pi / 2))
    p.append(box(span - 0.1, spring, THICK - 0.1, (0, spring / 2, 0), VOID))
    for i in range(6):
        a = math.pi * (i + 0.5) / 6
        w = 2 * R * math.sin(a) * 0.9
        p.append(box(w, R * 0.9 / 6 + 0.04, THICK - 0.1,
                     (0, spring + R * math.cos(math.pi - a) * 0 + R * (i + 0.5) / 6, 0), VOID))
    for sx in (-1, 1):
        p.append(box(0.26, spring, THICK + 0.14, (sx * (span / 2 + 0.05), spring / 2, 0), STONE_LT))
    p.append(box(U, 5.0 - (spring + R) - 0.1, THICK - 0.12,
                 (0, (spring + R) + (5.0 - spring - R) / 2, 0), STONE_DK))
    return p


def main():
    kit = [
        ('Ruin_Wall_Tall', wall_tall()),
        ('Ruin_Lancet', lancet()),
        ('Ruin_East_Window', east_window()),
        ('Ruin_Rose', rose_window()),
        ('Ruin_Arcade', arcade()),
        ('Ruin_Buttress', buttress()),
        ('Ruin_Pier', pier()),
        ('Ruin_Steps_Wide', steps_wide()),
        ('Ruin_Door_Arch', door_arch()),
        ('Tower_Slit', tower_slit()),
        ('Tower_Gallery', tower_gallery()),
        ('Tower_Roof', tower_roof()),
        ('Tower_Door', tower_door()),
    ]
    total = 0
    for name, parts in kit:
        p, faces = save(name, parts)
        total += faces
        b = trimesh.load(p).bounds
        d = [round(float(b[1][i] - b[0][i]), 1) for i in range(3)]
        print(f'  {p.relative_to(ROOT)}  {faces:4d} tris  {d[0]} x {d[1]} x {d[2]} m')
    print(f'{len(kit)} Gothic/tower pieces, {total} triangles — grid unit {U} m')


if __name__ == '__main__':
    main()
