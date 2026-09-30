#!/usr/bin/env python3
"""The props the Dark Woods location sheets ask for and the library did not have.

Each of the nine landmarks has a concept sheet, and each sheet carries a "key
props" strip. Most of those strips were already covered -- the ruin kit has the
arch, the altar and the broken column, the cave kit has the webs and the
crystals, the props kit has the tents and the crates. These are the ones with
nothing behind them at all, which is why the Fallen Chapel had a graveyard in
its drawing and not a single gravestone in the game.

  Fallen Chapel     gravestones (four variants), path lantern
  Ravenwater Pool   lily pads, fallen log, rock spire, mossy boulder
  Murkfen / Briar   the watchtower on stilts both sheets draw
  Wolfsnag / Crow
  Hill / Witchlight their three banners, and Crow Hill's watchfire brazier

These are grey-box stand-ins in the sense Hofer (Game Art Asset Creation, p.66)
means it -- right proportions, right silhouette, no polygon flow worth defending.
Drop a real .glb in over any of them under the SAME FILE NAME and every
placement in tools/build_darkwoods.py keeps working.

Conventions, both learned the hard way and both non-negotiable:
  * colour lives in glTF MATERIALS. Vertex colours are stripped by the client's
    bakeModel and the model renders black.
  * trimesh builds cylinders along Z. The game is Y-up. Rotate every one.
Also: metres, base at y = 0, front facing -Z.

Run:  python3 tools/build_darkwoods_props.py      (needs trimesh + numpy)
Writes client/models/darkwoods/<Name>.glb
"""
import math
from pathlib import Path

import numpy as np
import trimesh

import glbkit

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'models' / 'darkwoods'

# Pulled off the sheets' own colour strips.
STONE      = (0.57, 0.56, 0.53)
STONE_DK   = (0.44, 0.43, 0.41)
STONE_LT   = (0.68, 0.67, 0.63)
STONE_MOSS = (0.36, 0.44, 0.30)
MOSS       = (0.28, 0.40, 0.22)
WOOD       = (0.40, 0.30, 0.19)
WOOD_DK    = (0.26, 0.19, 0.12)
WOOD_PALE  = (0.52, 0.41, 0.27)
CANVAS     = (0.62, 0.57, 0.45)
LILY       = (0.30, 0.47, 0.28)
LILY_LT    = (0.40, 0.56, 0.33)
BLOOM      = (0.92, 0.90, 0.86)
IRON       = (0.22, 0.22, 0.24)
FLAME      = (0.95, 0.55, 0.16)
CLOTH_RED  = (0.55, 0.14, 0.13)
CLOTH_BLUE = (0.17, 0.21, 0.42)
CLOTH_GREY = (0.40, 0.40, 0.44)
BONE       = (0.80, 0.78, 0.70)
ASH        = (0.15, 0.10, 0.08)

# What each colour IS -- see tools/glbkit.py. Without these the kit's materials
# are named by index and every one of them, from the brazier's iron to the lily
# pads, is grained like stone.
MAT = {
    STONE:      'Stone | grey granite',
    STONE_DK:   'Stone shadow | granite',
    STONE_LT:   'Stone highlight | pale granite',
    STONE_MOSS: 'Moss on stone',
    MOSS:       'Moss',
    WOOD:       'Timber | weathered oak',
    WOOD_DK:    'Timber | dark oak',
    WOOD_PALE:  'Timber | pale oak',
    CANVAS:     'Canvas awning',
    LILY:       'Lily leaf',
    LILY_LT:    'Lily leaf | pale',
    BLOOM:      'Lily flower | petal',
    IRON:       'Iron | dark',
    FLAME:      'Flame',
    CLOTH_RED:  'Banner cloth | red',
    CLOTH_BLUE: 'Banner cloth | blue',
    CLOTH_GREY: 'Banner cloth | grey',
    BONE:       'Old bone',
    # Not "charcoal" (the metal rule matches `coal` inside it) and not "ash
    # bed" (the wood rule matches `bed`). The rules test substrings, so a
    # material name is a sentence two other rules are also reading.
    ASH:        'Cold ash',
}


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
    m.metadata['mat'] = MAT.get(tuple(colour))
    return m


def cyl(r, h, at=(0, 0, 0), colour=STONE, sections=8, tilt=0.0, yaw=0.0):
    # trimesh builds cylinders along Z; turn them upright for a Y-up game.
    m = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
    m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
    if tilt:
        m.apply_transform(trimesh.transformations.rotation_matrix(tilt, (0, 0, 1)))
    if yaw:
        m.apply_transform(trimesh.transformations.rotation_matrix(yaw, (0, 1, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = colour
    m.metadata['mat'] = MAT.get(tuple(colour))
    return m


def rock(rx, ry, rz, at=(0, 0, 0), colour=STONE, seed=0, rough=0.22, yaw=0.0):
    """A boulder: an icosphere knocked out of true. Cheaper and better than a
    box for anything the sheets draw as natural stone."""
    rng = np.random.default_rng(seed)
    m = trimesh.creation.icosphere(subdivisions=1, radius=1.0)
    v = m.vertices.copy()
    v *= 1.0 + (rng.random(v.shape[0])[:, None] - 0.5) * 2 * rough
    v[:, 0] *= rx; v[:, 1] *= ry; v[:, 2] *= rz
    m = trimesh.Trimesh(vertices=v, faces=m.faces, process=False)
    if yaw:
        m.apply_transform(trimesh.transformations.rotation_matrix(yaw, (0, 1, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = colour
    m.metadata['mat'] = MAT.get(tuple(colour))
    return m


def save(name, parts):
    """One mesh per colour, each with its own PBR material -- and FLAT normals.
    See tools/glbkit.py for why both of those matter."""
    return glbkit.save(OUT, name, parts, roughness=0.93)


# ----------------------------------------------------------- the graveyard
# The chapel sheet draws a whole hillside of these and labels them "Gravestone
# Variants". Four, because a graveyard of one stone repeated reads as wallpaper;
# each leans a different way so a row of them never lines up.
def gravestone_slab(seed=1):
    rng = np.random.default_rng(seed)
    t = rng.uniform(-0.09, 0.09)
    return [
        box(0.78, 1.05, 0.16, (0, 0.53, 0), STONE, tilt=t),
        # the rounded top, faked with a squat cylinder lying on its side
        cyl(0.39, 0.16, (-math.sin(t) * 1.05, 1.05 + math.cos(t) * 0.02, 0),
            STONE, sections=10, tilt=t + math.pi / 2, yaw=math.pi / 2),
        box(0.98, 0.14, 0.34, (0, 0.07, 0), STONE_DK),         # footing in the turf
        box(0.44, 0.03, 0.02, (0, 0.62, -0.09), STONE_LT, tilt=t),   # worn inscription
        box(0.30, 0.03, 0.02, (0, 0.50, -0.09), STONE_LT, tilt=t),
    ]


def gravestone_cross(seed=2):
    rng = np.random.default_rng(seed)
    t = rng.uniform(-0.12, 0.12)
    p = [
        box(0.20, 1.55, 0.18, (0, 0.78, 0), STONE, tilt=t),          # shaft
        box(0.86, 0.20, 0.18, (-math.sin(t) * 1.2, 1.22, 0), STONE, tilt=t),  # arms
        box(0.96, 0.16, 0.38, (0, 0.08, 0), STONE_DK),               # base
    ]
    # the ring that makes it read as a celtic cross from a distance
    for a in range(10):
        th = a / 10 * math.tau
        p.append(box(0.16, 0.16, 0.14,
                     (-math.sin(t) * 1.22 + math.cos(th) * 0.34, 1.22 + math.sin(th) * 0.34, 0),
                     STONE_LT, tilt=t))
    return p


def gravestone_tall(seed=3):
    """The one the eye lands on: a tapered marker head and shoulders above the
    rest, so the graveyard has a focal point instead of a flat field."""
    rng = np.random.default_rng(seed)
    t = rng.uniform(-0.05, 0.05)
    return [
        box(1.10, 0.22, 0.80, (0, 0.11, 0), STONE_DK),
        box(0.86, 0.26, 0.62, (0, 0.33, 0), STONE),
        box(0.58, 1.70, 0.44, (0, 1.30, 0), STONE, tilt=t),
        box(0.44, 0.30, 0.34, (-math.sin(t) * 2.2, 2.28, 0), STONE_LT, tilt=t),
        box(0.22, 0.34, 0.20, (-math.sin(t) * 2.5, 2.58, 0), STONE_MOSS, tilt=t),   # capstone, gone green
    ]


def gravestone_broken(seed=4):
    """Snapped off at the knee, the top half lying where it fell."""
    rng = np.random.default_rng(seed)
    return [
        box(0.72, 0.46, 0.16, (0, 0.25, 0), STONE, tilt=0.06),
        box(0.66, 0.10, 0.18, (0.02, 0.50, 0), STONE_LT, tilt=0.14),    # jagged break
        box(0.92, 0.12, 0.32, (0, 0.06, 0), STONE_DK),
        # the fallen piece, face down in the grass
        box(0.68, 0.15, 0.62, (0.82, 0.08, 0.30), STONE_MOSS, yaw=rng.uniform(0.2, 0.9)),
    ]


def tomb_slab(seed=5):
    """A table tomb -- the chapel sheet puts a couple among the headstones, and
    they break up the silhouette of a field of uprights."""
    p = [box(2.10, 0.20, 1.10, (0, 0.10, 0), STONE_DK)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.append(box(0.22, 0.52, 0.22, (sx * 0.82, 0.46, sz * 0.38), STONE))
    p += [
        box(2.20, 0.22, 1.18, (0, 0.83, 0), STONE_LT),
        box(1.60, 0.04, 0.70, (0, 0.95, 0), STONE_MOSS),      # moss across the lid
    ]
    return p


def path_lantern(seed=6):
    """Post-mounted, unlike the camp's ground lantern. The chapel sheet hangs
    one at the west approach and the Murkfen sheet posts them along the walks."""
    return [
        box(0.44, 0.14, 0.44, (0, 0.07, 0), STONE_DK),
        cyl(0.07, 2.10, (0, 1.12, 0), WOOD_DK, sections=6),
        box(0.62, 0.09, 0.09, (0.22, 2.12, 0), WOOD_DK),        # the arm it hangs from
        cyl(0.02, 0.18, (0.48, 2.02, 0), IRON, sections=4),     # hook
        box(0.26, 0.30, 0.26, (0.48, 1.78, 0), FLAME),          # the glass, lit
        box(0.30, 0.06, 0.30, (0.48, 1.95, 0), IRON),           # cap
        box(0.30, 0.05, 0.30, (0.48, 1.61, 0), IRON),           # base
    ]


# ----------------------------------------------------------- Ravenwater Pool
def lily_pads(seed=7):
    """A cluster of pads with one bloom. Authored FLAT and barely above its own
    origin, because these are laid on a water surface, not on the ground."""
    rng = np.random.default_rng(seed)
    p = []
    for i in range(7):
        a = rng.random() * math.tau
        r = rng.random() * 1.35
        rad = rng.uniform(0.26, 0.46)
        p.append(cyl(rad, 0.035, (math.cos(a) * r, 0.02, math.sin(a) * r),
                     LILY if i % 2 else LILY_LT, sections=9))
        # the notch that makes a disc read as a lily pad
        p.append(box(rad * 0.5, 0.05, rad * 0.22,
                     (math.cos(a) * r + rad * 0.5, 0.019, math.sin(a) * r),
                     LILY_LT if i % 2 else LILY, yaw=rng.random() * math.tau))
    p.append(cyl(0.12, 0.16, (0.35, 0.10, -0.42), BLOOM, sections=7))
    p.append(cyl(0.05, 0.10, (0.35, 0.20, -0.42), FLAME, sections=5))
    return p


def fallen_log(seed=8):
    """Lying along local X, mossed on its upper side. A landmark you can see
    over -- the sheet uses them as cover and waymarks on the southwest shore."""
    rng = np.random.default_rng(seed)
    # cyl() stands its cylinder up along Y first, so ONE quarter turn about Z
    # lays it along X. Adding a yaw on top of that turned it a second time and
    # the log came out lying across Z instead of along its own length.
    p = [
        cyl(0.42, 4.60, (0, 0.42, 0), WOOD, sections=9, tilt=math.pi / 2),
        cyl(0.44, 0.10, (-2.30, 0.42, 0), WOOD_DK, sections=9, tilt=math.pi / 2),
        cyl(0.40, 0.10, (2.30, 0.42, 0), WOOD_DK, sections=9, tilt=math.pi / 2),
    ]
    for i in range(5):                                            # moss along the top
        x = -1.9 + i * 0.95
        p.append(box(0.80, 0.07, 0.52, (x, 0.80, rng.uniform(-0.08, 0.08)), MOSS))
    for i in range(3):                                            # broken branch stubs
        a = rng.uniform(0.4, 1.1)
        p.append(cyl(0.09, rng.uniform(0.5, 0.9), (-1.4 + i * 1.5, 0.66, 0.1),
                     WOOD_DK, sections=5, tilt=a, yaw=rng.random() * math.tau))
    return p


def rock_spire(seed=9):
    """Tall and thin, for standing IN the water -- the sheet's own label. Built
    tall enough (4.4 m) that it still clears the surface from a lake bed."""
    rng = np.random.default_rng(seed)
    p = []
    y = 0.0
    w = 0.95
    for i in range(5):
        h = rng.uniform(0.75, 1.05)
        p.append(rock(w, h * 0.62, w * 0.82, (rng.uniform(-0.1, 0.1), y + h / 2, rng.uniform(-0.1, 0.1)),
                      STONE if i % 2 else STONE_DK, seed=seed + i, rough=0.28,
                      yaw=rng.random() * math.tau))
        y += h
        w *= 0.80
    p.append(rock(w * 0.9, 0.55, w * 0.8, (0, y + 0.25, 0), STONE_LT, seed=seed + 9, rough=0.3))
    return p


def mossy_boulder(seed=10):
    rng = np.random.default_rng(seed)
    p = [rock(1.30, 0.92, 1.10, (0, 0.80, 0), STONE, seed=seed, rough=0.24,
              yaw=rng.random() * math.tau)]
    # a moss cap, not a moss coat: only the upper face goes green
    p.append(rock(1.16, 0.34, 0.98, (0, 1.42, 0), STONE_MOSS, seed=seed + 1, rough=0.30))
    p.append(rock(0.52, 0.34, 0.46, (1.05, 0.28, 0.42), STONE_DK, seed=seed + 2, rough=0.3,
                  yaw=rng.random() * math.tau))       # a split-off chunk at the foot
    return p


# ----------------------------------------------- Murkfen / Briar watchtower
def stilt_watchtower(seed=11):
    """Four legs, a ladder, a railed platform and a canopy. The Murkfen sheet
    stands two of these over the marsh and Briar Camp's sheet calls its own a
    Watch Post; it is the same structure, so it is one asset.

    The legs run 3 m BELOW the platform so it still reads as standing on stilts
    when it is dropped on ground that is under water."""
    rng = np.random.default_rng(seed)
    DECK, HALF = 3.4, 1.35
    p = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            lean = rng.uniform(-0.03, 0.03)
            p.append(box(0.22, DECK + 0.6, 0.22,
                         (sx * HALF, (DECK - 0.6) / 2, sz * HALF), WOOD_DK, tilt=lean))
    # cross-bracing, which is what stops it reading as a table
    for sz in (-1, 1):
        p.append(box(HALF * 2.6, 0.13, 0.13, (0, DECK * 0.42, sz * HALF), WOOD, tilt=0.50))
        p.append(box(HALF * 2.6, 0.13, 0.13, (0, DECK * 0.42, sz * HALF), WOOD, tilt=-0.50))
    p.append(box(HALF * 2.4, 0.16, HALF * 2.4, (0, DECK, 0), WOOD))            # deck
    for i in range(5):                                                          # planking
        p.append(box(HALF * 2.3, 0.06, 0.42, (0, DECK + 0.11, -1.1 + i * 0.55),
                     WOOD_PALE if i % 2 else WOOD))
    for sx in (-1, 1):                                                          # rail posts
        for sz in (-1, 1):
            p.append(box(0.14, 0.95, 0.14, (sx * (HALF - 0.1), DECK + 0.55, sz * (HALF - 0.1)), WOOD_DK))
    for sz in (-1, 1):
        p.append(box(HALF * 2.1, 0.10, 0.10, (0, DECK + 0.95, sz * (HALF - 0.1)), WOOD))
    p.append(box(0.10, 0.10, HALF * 2.1, (-(HALF - 0.1), DECK + 0.95, 0), WOOD))
    # ladder up the open side
    for i in range(7):
        p.append(box(0.62, 0.07, 0.07, (HALF + 0.30, 0.42 + i * 0.44, 0), WOOD_PALE))
    for sz in (-1, 1):
        p.append(box(0.09, DECK + 0.2, 0.09, (HALF + 0.30, (DECK + 0.2) / 2, sz * 0.28), WOOD_DK))
    # canopy over the platform
    for sx in (-1, 1):
        p.append(box(0.10, 1.05, 0.10, (sx * (HALF - 0.2), DECK + 1.6, 0), WOOD_DK))
    p.append(box(HALF * 2.5, 0.10, HALF * 2.3, (0, DECK + 2.14, 0), CANVAS))
    p.append(box(HALF * 2.0, 0.08, 0.16, (0, DECK + 2.26, 0), CLOTH_RED))       # a strip of colour
    p.append(box(0.22, 0.30, 0.22, (HALF - 0.3, DECK + 0.32, -(HALF - 0.3)), FLAME))  # the lamp
    return p


# ------------------------------------------------------------- the banners
def _banner(colour, mark, seed):
    """Pole, crossbar, hanging cloth, and a device on it. The three sheets draw
    the same banner with three different marks, so the shape is shared and only
    the colour and the device change."""
    rng = np.random.default_rng(seed)
    p = [
        box(0.44, 0.16, 0.44, (0, 0.08, 0), STONE_DK),
        cyl(0.08, 3.30, (0, 1.70, 0), WOOD_DK, sections=6, tilt=rng.uniform(-0.02, 0.02)),
        box(1.30, 0.10, 0.10, (0, 3.24, 0), WOOD),                  # crossbar
        box(1.16, 1.90, 0.05, (0, 2.24, 0.03), colour),             # the cloth
        box(1.16, 0.10, 0.06, (0, 1.30, 0.03), colour),             # frayed hem
    ]
    for (mx, my, mw, mh) in mark:
        p.append(box(mw, mh, 0.03, (mx, 2.24 + my, 0.06), BONE))
    return p


def banner_wolf(seed=12):
    # a blunt wolf's-head glyph: muzzle, ears, eyes -- readable at distance
    mark = [(0.0, 0.10, 0.52, 0.42), (-0.24, 0.40, 0.16, 0.24), (0.24, 0.40, 0.16, 0.24),
            (0.0, -0.22, 0.26, 0.30)]
    return _banner(CLOTH_RED, mark, seed)


def banner_crow(seed=13):
    # spread wings over a body
    mark = [(0.0, 0.06, 0.24, 0.62), (-0.34, 0.24, 0.46, 0.14), (0.34, 0.24, 0.46, 0.14),
            (0.0, -0.40, 0.14, 0.26)]
    return _banner(CLOTH_GREY, mark, seed)


def banner_moon(seed=14):
    # the crescent on Witchlight's tents -- a ring with a bite out of it
    p = _banner(CLOTH_BLUE, [], seed)
    for a in range(12):
        th = a / 12 * math.tau
        if -0.7 < math.cos(th) and abs(math.sin(th)) < 0.98 and math.cos(th) > 0.25:
            continue                        # the bite
        p.append(box(0.15, 0.15, 0.03,
                     (math.sin(th) * 0.40, 2.24 + math.cos(th) * 0.40, 0.06), BONE))
    return p


def brazier(seed=15):
    """Crow Hill's watchfire. A fire in a basket on legs, so it reads as kept
    rather than as a campfire somebody left."""
    p = []
    for a in range(3):
        th = a / 3 * math.tau
        p.append(box(0.14, 1.05, 0.14, (math.cos(th) * 0.34, 0.52, math.sin(th) * 0.34),
                     IRON, tilt=math.cos(th) * 0.12, roll=math.sin(th) * 0.12))
    for a in range(9):                                     # the basket
        th = a / 9 * math.tau
        p.append(box(0.16, 0.42, 0.14, (math.cos(th) * 0.50, 1.22, math.sin(th) * 0.50),
                     IRON, yaw=-th))
    p.append(cyl(0.52, 0.10, (0, 1.03, 0), IRON, sections=9))
    p.append(cyl(0.42, 0.22, (0, 1.20, 0), ASH, sections=9))   # ash bed
    for i, (r, h, y) in enumerate([(0.30, 0.44, 1.42), (0.20, 0.34, 1.68), (0.10, 0.24, 1.88)]):
        p.append(cyl(r, h, (0, y, 0), FLAME, sections=7))
    return p


def market_stall(seed=16):
    """Witchlight's "Canopy / Market Stall". The camp already has a pavilion;
    this is the smaller open-fronted stall its layout plan repeats."""
    rng = np.random.default_rng(seed)
    p = []
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.append(box(0.13, 2.10, 0.13, (sx * 1.25, 1.05, sz * 0.85), WOOD_DK))
    # awning, pitched toward the front
    p.append(box(2.90, 0.09, 2.00, (0, 2.22, 0.10), CANVAS, tilt=0.0, roll=0.16))
    p.append(box(2.90, 0.07, 0.30, (0, 2.06, 1.02), CLOTH_RED, roll=0.16))     # valance
    p.append(box(2.50, 0.14, 0.80, (0, 0.95, -0.40), WOOD))                     # counter
    for sx in (-1, 1):
        p.append(box(0.16, 0.95, 0.70, (sx * 1.10, 0.47, -0.40), WOOD_DK))
    for i in range(3):                                                          # goods
        p.append(box(0.34, 0.26, 0.30, (-0.7 + i * 0.7, 1.15, -0.40),
                     WOOD_PALE if i % 2 else CLOTH_BLUE, yaw=rng.uniform(-0.3, 0.3)))
    p.append(box(0.70, 0.34, 0.05, (0, 1.72, 0.94), WOOD_PALE))                 # the sign
    return p


def main():
    kit = [
        ('Gravestone_Slab', gravestone_slab()),
        ('Gravestone_Cross', gravestone_cross()),
        ('Gravestone_Tall', gravestone_tall()),
        ('Gravestone_Broken', gravestone_broken()),
        ('Tomb_Slab', tomb_slab()),
        ('Path_Lantern', path_lantern()),
        ('Lily_Pads', lily_pads()),
        ('Fallen_Log', fallen_log()),
        ('Rock_Spire', rock_spire()),
        ('Mossy_Boulder', mossy_boulder()),
        ('Stilt_Watchtower', stilt_watchtower()),
        ('Banner_Wolf', banner_wolf()),
        ('Banner_Crow', banner_crow()),
        ('Banner_Moon', banner_moon()),
        ('Brazier', brazier()),
        ('Market_Stall', market_stall()),
    ]
    total = 0
    for name, parts in kit:
        p, faces = save(name, parts)
        total += faces
        b = trimesh.load(p).bounds
        d = [round(float(b[1][i] - b[0][i]), 1) for i in range(3)]
        print(f'  {p.relative_to(ROOT)}  {faces:4d} tris  {d[0]} x {d[1]} x {d[2]} m')
    print(f'{len(kit)} props, {total} triangles — replace any of them with real art '
          f'under the same name')


if __name__ == '__main__':
    main()
