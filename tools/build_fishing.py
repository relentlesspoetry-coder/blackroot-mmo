#!/usr/bin/env python3
"""The fishing kit: two rods and the four species that come out of the water.

Fishing was made to work a few commits ago -- nine spots, four species, a rod
in everyone's starting bag -- and then there was nothing to SHOW. No rod model,
so the pole could not be put in anyone's hands; no fish models, so a catch was
a line of chat and a shard on the ground. This is the art that was missing.

  Fishing_Rod    the one every character starts with: ash blank, cork grip
  Feathered_Rod  the Hermit's father's rod -- darker blank, brass reel, and
                 the feather at the butt it is named for
  Raw_Shrimp / Raw_Trout / Raw_Salmon / Raw_Pike, and their cooked forms

Grey-box stand-ins in the usual sense: right proportions, right silhouette, no
polygon flow worth defending. Drop a real .glb in over any of them under the
SAME FILE NAME and every placement keeps working.

Conventions, both learned the hard way and both non-negotiable:
  * colour lives in glTF MATERIALS. Vertex colours are stripped by the client's
    bakeModel and the model renders black.
  * trimesh builds cylinders along Z. The game is Y-up. Rotate every one.
The rods follow the weapon pack instead: length along +Z with the GRIP at the
origin and the tip out at +Z, because that is what buildHeldWeapon expects and
how every sword in weapons/ is built (measured: 01_Short_Sword runs z -0.31 to
+0.69 with the fist at zero).

Run:  tools/.venv/bin/python tools/build_fishing.py
Writes client/models/weapons/*.glb and client/models/items/*.glb
"""
import math
from pathlib import Path

import numpy as np
import trimesh

import glbkit

ROOT = Path(__file__).resolve().parent.parent
WEAPONS = ROOT / 'client' / 'models' / 'weapons'
ITEMS = ROOT / 'client' / 'models' / 'items'

CORK       = (0.66, 0.51, 0.32)
ASH        = (0.74, 0.66, 0.50)
ASH_DK     = (0.46, 0.36, 0.24)
WALNUT     = (0.31, 0.20, 0.13)
BRASS      = (0.72, 0.58, 0.24)
IRON       = (0.26, 0.26, 0.29)
LINE       = (0.86, 0.85, 0.80)
FEATHER    = (0.74, 0.69, 0.58)

TROUT      = (0.52, 0.56, 0.44)
TROUT_BELLY= (0.83, 0.81, 0.72)
SALMON     = (0.68, 0.45, 0.40)
SALMON_BK  = (0.40, 0.44, 0.50)
PIKE       = (0.36, 0.45, 0.30)
PIKE_BELLY = (0.78, 0.76, 0.62)
SHRIMP     = (0.80, 0.53, 0.42)
COOKED     = (0.78, 0.56, 0.36)
COOKED_DK  = (0.58, 0.38, 0.22)
EYE        = (0.10, 0.10, 0.11)


def box(sx, sy, sz, at=(0, 0, 0), colour=ASH, yaw=0.0, tilt=0.0, roll=0.0):
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


def rod_seg(r0, r1, length, at=(0, 0, 0), colour=ASH, sections=6):
    """A tapering section lying along +Z -- the weapon pack's axis, so no
    rotation here. A blank is a cone frustum, not a cylinder: a rod that does
    not taper reads as a broom handle."""
    m = trimesh.creation.cone(radius=max(r0, r1), height=length, sections=sections)
    v = m.vertices.copy()
    # cone() is a point at +Z; rebuild it as a frustum by lifting the tip out
    zmin, zmax = v[:, 2].min(), v[:, 2].max()
    span = (zmax - zmin) or 1.0
    for i in range(len(v)):
        t = (v[i, 2] - zmin) / span
        want = r0 + (r1 - r0) * t
        rad = math.hypot(v[i, 0], v[i, 1])
        if rad > 1e-6:
            k = want / rad
            v[i, 0] *= k; v[i, 1] *= k
    m = trimesh.Trimesh(vertices=v, faces=m.faces, process=False)
    m.apply_translation((0, 0, -zmin))            # base at z = 0
    m.apply_translation(at)
    m.metadata['colour'] = colour
    return m


def ring(r, tube, at=(0, 0, 0), colour=IRON, sections=6):
    m = trimesh.creation.annulus(r_min=max(0.001, r - tube), r_max=r, height=tube * 1.2,
                                 sections=sections)
    m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = colour
    return m


def drum(r, h, at=(0, 0, 0), colour=BRASS, sections=10):
    """The reel: a cylinder lying across the rod, so its axis is X."""
    m = trimesh.creation.cylinder(radius=r, height=h, sections=sections)
    m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (0, 1, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = colour
    return m


def blob(rx, ry, rz, at=(0, 0, 0), colour=TROUT, seed=0, rough=0.0, subdiv=1, yaw=0.0):
    rng = np.random.default_rng(seed)
    m = trimesh.creation.icosphere(subdivisions=subdiv, radius=1.0)
    v = m.vertices.copy()
    if rough:
        v *= 1.0 + (rng.random(v.shape[0])[:, None] - 0.5) * 2 * rough
    v[:, 0] *= rx; v[:, 1] *= ry; v[:, 2] *= rz
    m = trimesh.Trimesh(vertices=v, faces=m.faces, process=False)
    if yaw:
        m.apply_transform(trimesh.transformations.rotation_matrix(yaw, (0, 1, 0)))
    m.apply_translation(at)
    m.metadata['colour'] = colour
    return m


def save(out_dir, name, parts):
    """One mesh per colour, each with its own PBR material -- and FLAT normals.
    See tools/glbkit.py for why both of those matter."""
    metal = lambda colour: (0.55, 0.45) if colour in (BRASS, IRON) else (0.0, 0.9)
    return glbkit.save(out_dir, name, parts, pbr=metal)


# ------------------------------------------------------------------- rods
# Grip at the origin, butt back to -Z, tip forward to +Z. Overall about 1.9 m
# of rod, which the client scales to the item's authored `len`.
def _rod(blank_col, grip_col, reel_col, feathered=False):
    p = []
    # butt cap and grip: the part inside the fist
    p.append(rod_seg(0.020, 0.022, 0.05, (0, 0, -0.30), grip_col))
    p.append(rod_seg(0.022, 0.019, 0.25, (0, 0, -0.25), grip_col, sections=8))
    # reel seat, and the reel hanging under the rod
    p.append(rod_seg(0.016, 0.016, 0.06, (0, 0, 0.00), reel_col))
    p.append(drum(0.045, 0.030, (0, -0.052, 0.03), reel_col))
    p.append(drum(0.022, 0.040, (0, -0.052, 0.03), IRON, sections=8))
    p.append(box(0.010, 0.050, 0.010, (0, -0.026, 0.03), reel_col))     # the stem
    p.append(box(0.026, 0.008, 0.008, (0.030, -0.066, 0.03), IRON))     # the handle you wind
    # the blank, in three tapering sections so the profile bends toward the tip
    p.append(rod_seg(0.016, 0.011, 0.58, (0, 0, 0.06), blank_col, sections=6))
    p.append(rod_seg(0.011, 0.007, 0.55, (0, 0, 0.64), blank_col, sections=6))
    p.append(rod_seg(0.007, 0.0035, 0.45, (0, 0, 1.19), blank_col, sections=5))
    # line guides: fewer and smaller toward the tip, which is what a real rod does
    for z, r in ((0.22, 0.026), (0.52, 0.022), (0.86, 0.018), (1.18, 0.014), (1.48, 0.011)):
        p.append(ring(r, 0.004, (0, -r * 0.8, z), IRON))
    # the tip ring, and a stub of line hanging off it
    p.append(ring(0.008, 0.003, (0, -0.007, 1.635), IRON))
    if feathered:
        # the feather the rod is named for, whipped to the butt
        for i, a in enumerate((-0.30, 0.0, 0.30)):
            p.append(box(0.004, 0.030, 0.10, (math.sin(a) * 0.02, 0.018, -0.26),
                         FEATHER, tilt=a))
        p.append(box(0.016, 0.016, 0.03, (0, 0.004, -0.26), WALNUT))
    return p


def fishing_rod():
    return _rod(ASH, CORK, IRON)


def feathered_rod():
    return _rod(WALNUT, CORK, BRASS, feathered=True)


# ------------------------------------------------------------------ fish
# Length along Z, belly at y = 0 so a fish laid on the ground sits on it.
def _fish(L, H, W, back, belly, seed, spots=None):
    p = []
    p.append(blob(W, H, L, (0, H, 0), back, seed=seed, subdiv=2))
    p.append(blob(W * 0.82, H * 0.45, L * 0.80, (0, H * 0.68, 0), belly, seed=seed + 1, subdiv=2))
    # tail: two triangles off the back
    p.append(box(W * 0.14, H * 1.5, L * 0.30, (0, H * 1.15, -L * 1.02), back, tilt=0.30))
    p.append(box(W * 0.14, H * 1.2, L * 0.26, (0, H * 0.70, -L * 1.00), back, tilt=-0.30))
    # dorsal and pectoral
    p.append(box(W * 0.12, H * 0.85, L * 0.34, (0, H * 1.75, L * 0.02), back))
    p.append(box(W * 0.55, H * 0.14, L * 0.20, (0, H * 0.72, L * 0.30), back, yaw=0.35))
    # eyes
    for sx in (-1, 1):
        p.append(blob(W * 0.17, H * 0.20, L * 0.045,
                      (sx * W * 0.72, H * 1.25, L * 0.70), EYE, seed=seed + 2))
    if spots:
        rng = np.random.default_rng(seed + 7)
        for i in range(9):
            t = rng.random()
            p.append(blob(W * 0.10, H * 0.10, L * 0.035,
                          ((rng.random() - 0.5) * W * 1.3, H * (0.9 + rng.random() * 0.7),
                           (t - 0.5) * L * 1.5), spots, seed=seed + 20 + i))
    return p


def raw_trout():   return _fish(0.16, 0.045, 0.030, TROUT, TROUT_BELLY, 31, spots=(0.30, 0.33, 0.26))
def raw_salmon():  return _fish(0.22, 0.058, 0.038, SALMON_BK, SALMON, 32)
def raw_pike():    return _fish(0.30, 0.060, 0.040, PIKE, PIKE_BELLY, 33, spots=(0.24, 0.30, 0.20))


def raw_shrimp():
    """Curled, the way a shrimp is when it comes out of the net."""
    p = []
    for i in range(7):
        t = i / 6.0
        a = -0.9 + t * 1.9                        # the curl
        r = 0.030 * (1.0 - t * 0.55)
        p.append(blob(r, r, 0.016, (math.sin(a) * 0.045, 0.030 + math.cos(a) * 0.020,
                                    -0.02 + t * 0.075), SHRIMP, seed=40 + i))
    for sx in (-1, 1):                            # antennae
        p.append(box(0.003, 0.003, 0.055, (sx * 0.006, 0.040, 0.075), SHRIMP, yaw=sx * 0.35))
    for sx in (-1, 1):
        p.append(blob(0.006, 0.007, 0.006, (sx * 0.012, 0.042, 0.052), EYE, seed=48))
    return p


def _cook(fn):
    """The cooked form: the same fish, browned, with the fins crisped off."""
    def build():
        out = []
        for m in fn():
            c = tuple(m.metadata['colour'])
            m.metadata['colour'] = EYE if c == EYE else (COOKED if sum(c) > 1.6 else COOKED_DK)
            out.append(m)
        return out
    return build


SHAPES = [
    (WEAPONS, 'Fishing_Rod', fishing_rod),
    (WEAPONS, 'Feathered_Rod', feathered_rod),
    (ITEMS, 'Raw_Shrimp', raw_shrimp),
    (ITEMS, 'Raw_Trout', raw_trout),
    (ITEMS, 'Raw_Salmon', raw_salmon),
    (ITEMS, 'Raw_Pike', raw_pike),
    (ITEMS, 'Shrimp', _cook(raw_shrimp)),
    (ITEMS, 'Trout', _cook(raw_trout)),
    (ITEMS, 'Salmon', _cook(raw_salmon)),
    (ITEMS, 'Pike', _cook(raw_pike)),
]


def main():
    total = 0
    for out_dir, name, fn in SHAPES:
        parts = fn()
        p, faces = save(out_dir, name, parts)
        b = trimesh.load(p, force='scene').bounds
        size = b[1] - b[0]
        total += faces
        print(f'  {name:<16}{faces:>5} faces   '
              f'{size[0]:.2f} x {size[1]:.2f} x {size[2]:.2f} m   '
              f'-> {p.relative_to(ROOT)}')
    print(f'{len(SHAPES)} models, {total} faces')


if __name__ == '__main__':
    main()
