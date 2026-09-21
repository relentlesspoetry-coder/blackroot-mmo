#!/usr/bin/env python3
"""Build the game's 50 weapon GLBs from the two BlackRoot concept sheets.

The packs the sheets shipped with were primitive stacks with no materials or
normals, so they rendered as dark, unlit lumps. This rebuilds every weapon as a
single flat-shaded, vertex-coloured mesh (metalness 0) that follows the sheet:
the parts, the silhouette and the palette of each one.

Conventions match what the client expects from the packs: metres, the weapon's
length runs along +Z with the grip near the origin (blade/head toward +Z), X is
the blade's width and Y its thickness (the "flat" of a blade faces ±Y).

Run:  python3 tools/build_weapons.py           (needs trimesh + numpy)
Writes client/models/weapons/<file>.glb for the 20-pack and
client/models/weapons30/<file>.glb for the 30 rarity weapons.
"""
import json, math, struct, sys, os
from pathlib import Path
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parent.parent
OUT20 = ROOT / 'client' / 'models' / 'weapons'
OUT30 = ROOT / 'client' / 'models' / 'weapons'   # same folder: the client loads every weapon from models/weapons/

# ---------------------------------------------------------------- palette (sRGB)
C = {
    'steel': (168, 174, 186), 'steel_hi': (225, 230, 238), 'steel_lo': (98, 104, 118), 'dark': (52, 52, 62),
    'black': (32, 32, 40), 'iron': (120, 124, 132), 'rust': (150, 92, 58), 'rust2': (110, 66, 40),
    'wood': (108, 70, 40), 'wood_lo': (76, 48, 28), 'wood_hi': (150, 104, 62), 'ash': (150, 120, 85),
    'leather': (86, 48, 30), 'leather_red': (128, 40, 36), 'leather_blue': (40, 70, 150), 'leather_green': (60, 110, 55),
    'gold': (222, 170, 52), 'gold_hi': (250, 214, 110), 'gold_lo': (160, 118, 34), 'bronze': (190, 130, 60), 'copper': (206, 116, 70),
    'blue': (58, 108, 220), 'blue_hi': (120, 170, 250), 'cyan': (90, 205, 250), 'ice': (170, 225, 255), 'teal': (44, 118, 132), 'teal_hi': (80, 190, 200),
    'red': (210, 46, 40), 'red_hi': (250, 100, 80), 'orange': (240, 120, 30), 'ember': (255, 150, 40),
    'green': (68, 150, 60), 'green_hi': (120, 215, 90), 'olive': (70, 90, 50),
    'purple': (140, 60, 215), 'purple_hi': (200, 130, 255), 'violet': (88, 40, 150), 'shadow': (40, 30, 56),
    'white': (240, 240, 236), 'tan': (200, 170, 120), 'string': (230, 215, 170), 'stone': (88, 84, 92), 'stone_lo': (58, 55, 62),
}

def srgb_to_linear(c):
    out = []
    for v in c:
        v = v / 255.0
        out.append(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4)
    return out

# ---------------------------------------------------------------- part builders
class W:
    """A weapon under construction: a list of coloured trimesh parts."""
    def __init__(self):
        self.parts = []
    def add(self, mesh, color):
        mesh = mesh.copy()
        # every part must face outward: hand-built prisms/gems/frusta can come
        # out inside-out, which culls their faces and lights them wrong
        if mesh.is_watertight and mesh.volume < 0: mesh.invert()
        mesh.visual.face_colors = np.tile(np.array(list(color) + [255], dtype=np.uint8), (len(mesh.faces), 1))
        self.parts.append(mesh)
        return mesh

    # --- primitives, all placed in the length-along-Z frame ---
    def rod(self, z0, z1, r, color, n=8, x=0, y=0, r2=None):
        """Cylinder from z0 to z1, or a frustum when r2 (the radius at z1) is
        given; r2=0 makes a point."""
        L = abs(z1 - z0)
        if L < 1e-6: return None
        m = trimesh.creation.cylinder(radius=r, height=L, sections=n) if r2 is None else self._frustum(r, max(r2, 0.002), L, n)
        if z1 < z0: m.apply_transform(trimesh.transformations.rotation_matrix(math.pi, (1, 0, 0)))
        m.apply_translation((x, y, (z0 + z1) / 2))
        return self.add(m, color)
    def _frustum(self, r1, r2, L, n):
        a = np.linspace(0, 2 * math.pi, n, endpoint=False)
        bot = np.c_[np.cos(a) * r1, np.sin(a) * r1, np.full(n, -L / 2)]
        top = np.c_[np.cos(a) * r2, np.sin(a) * r2, np.full(n, L / 2)]
        v = np.vstack([bot, top, [[0, 0, -L / 2]], [[0, 0, L / 2]]])
        f = []
        for i in range(n):
            j = (i + 1) % n
            f += [[i, j, n + j], [i, n + j, n + i], [2 * n, j, i], [2 * n + 1, n + i, n + j]]
        return trimesh.Trimesh(v, np.array(f), process=False)
    def box(self, ext, center, color, rot=None):
        m = trimesh.creation.box(extents=ext)
        if rot is not None: m.apply_transform(rot)
        m.apply_translation(center)
        return self.add(m, color)
    def prism(self, pts, thick, color, y=0, taper=1.0):
        """Extrude an XZ polygon (any simple outline, concave included) through
        Y. taper<1 pinches both faces inward so the edge makes a diamond
        section, like a bevelled blade."""
        import shapely.geometry as sg
        n = len(pts)
        pts = np.array(pts, float)
        cx, cz = pts.mean(axis=0)
        poly = sg.Polygon(pts)
        if not poly.is_valid: poly = poly.buffer(0)
        if poly.geom_type != 'Polygon': poly = max(poly.geoms, key=lambda g: g.area)
        ring = np.array(poly.exterior.coords[:-1])
        if poly.exterior.is_ccw is False: ring = ring[::-1]
        # drop repeated points (a pinched blade tip) so the sides stay closed
        keep = [0] + [i for i in range(1, len(ring)) if np.linalg.norm(ring[i] - ring[i - 1]) > 1e-5]
        if np.linalg.norm(ring[keep[-1]] - ring[keep[0]]) <= 1e-5: keep = keep[:-1]
        ring = ring[keep]
        n = len(ring)
        cap_v, cap_f = trimesh.creation.triangulate_polygon(sg.Polygon(ring), engine='earcut')
        # map cap vertices back onto ring indices (earcut keeps the input order)
        v = []
        for yy, t in ((y - thick / 2, taper), (y + thick / 2, taper)):
            for x, z in ring: v.append([cx + (x - cx) * t, yy, cz + (z - cz) * t])
        if taper < 1:
            for x, z in ring: v.append([x, y, z])
        f = []
        for a, b, c in cap_f:
            f.append([a, c, b]); f.append([n + a, n + b, n + c])
        if taper < 1:
            for i in range(n):
                j = (i + 1) % n
                f += [[i, j, 2 * n + j], [i, 2 * n + j, 2 * n + i], [2 * n + i, 2 * n + j, n + j], [2 * n + i, n + j, n + i]]
        else:
            for i in range(n):
                j = (i + 1) % n
                f += [[i, j, n + j], [i, n + j, n + i]]
        m = trimesh.Trimesh(np.array(v), np.array(f), process=False)
        m.merge_vertices()
        return self.add(m, color)
    def blade(self, z0, z1, w, color=None, tip=0.14, thick=0.05, taper=0.55, ridge=True, y=0, x=0, notches=0, hi=None):
        """A straight double-edged blade: a bevelled body plus a lighter ridge."""
        color = color or C['steel']; hi = hi or C['steel_hi']
        hw = w / 2
        if notches:
            # jagged edges: teeth bitten out of both sides
            L, R = [], []
            n = notches
            for i in range(n + 1):
                t = i / n
                zz = z0 + (z1 - tip - z0) * t
                inset = 0.0 if i % 2 == 0 else hw * 0.45
                L.append((x - hw + inset, zz)); R.append((x + hw - inset, zz))
            pts = R + [(x, z1)] + L[::-1]
        else:
            pts = [(x - hw, z0), (x + hw, z0), (x + hw * 0.92, z1 - tip), (x, z1), (x - hw * 0.92, z1 - tip)]
        self.prism(pts, thick, color, y=y, taper=taper)
        if ridge:
            self.prism([(x - hw * 0.14, z0), (x + hw * 0.14, z0), (x, z1 - tip * 0.6)], thick * 1.15, hi, y=y)
    def curved_blade(self, z0, z1, w, curve, color=None, thick=0.045, back=None, segs=9, taper=0.6, x0=0, hi=None):
        """A scimitar-style blade: the edge bows out to +X by `curve` and comes
        back to a point."""
        color = color or C['steel']
        pts_edge, pts_back = [], []
        for i in range(segs + 1):
            t = i / segs
            zz = z0 + (z1 - z0) * t
            bow = math.sin(t * math.pi) * curve + t * t * curve * 0.9
            ww = w * (1 - t * t * 0.9) * (1 if t < 0.9 else (1 - t) * 10)
            pts_edge.append((x0 + bow + ww * 0.5, zz)); pts_back.append((x0 + bow - ww * 0.5, zz))
        pts = pts_edge + pts_back[::-1]
        self.prism(pts, thick, color, taper=taper)
        if back:
            bk = [(bx - 0.0, bz) for bx, bz in pts_back]
            inner = [(bx + w * 0.09 * (1 - (i / segs) ** 2), bz) for i, (bx, bz) in enumerate(pts_back)]
            self.prism(bk + inner[::-1], thick * 1.1, back)
    def crossguard(self, z, w, color, h=0.07, d=0.09, tips=None, curl=0):
        self.box((w, d, h), (0, 0, z), color)
        if tips:
            for sx in (-1, 1):
                self.gem((sx * (w / 2), 0, z), 0.045, tips)
        if curl:
            for sx in (-1, 1):
                self.rod(z, z + curl, 0.03, color, n=6, x=sx * (w / 2 - 0.02), r2=0.012)
    def grip(self, z0, z1, r, color, bands=None, band_color=None):
        self.rod(z0, z1, r, color, n=8)
        if bands:
            for i in range(bands):
                zz = z0 + (z1 - z0) * (i + 0.5) / bands
                self.rod(zz - 0.012, zz + 0.012, r * 1.12, band_color or C['leather'], n=8)
    def pommel(self, z, color, size=0.06, gem=None, shape='cube', x=0):
        if shape == 'cube':
            self.box((size * 1.6, size * 1.4, size * 1.6), (x, 0, z), color)
        elif shape == 'sphere':
            self.add(trimesh.creation.icosphere(subdivisions=1, radius=size).apply_translation((x, 0, z)), color)
        elif shape == 'spike':
            self.rod(z + size, z - size * 2.2, size * 0.9, color, n=6, x=x, r2=0)
        if gem:
            self.gem((x, -size * 0.75, z), size * 0.5, gem)
    def gem(self, center, size, color, stretch=1.0):
        """A little octahedral gem."""
        s = size
        v = np.array([[s, 0, 0], [-s, 0, 0], [0, s, 0], [0, -s, 0], [0, 0, s * stretch], [0, 0, -s * stretch]], float)
        f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]
        m = trimesh.Trimesh(v, np.array(f), process=False); m.apply_translation(center)
        return self.add(m, color)
    def crystal(self, base, direction, length, r, color, n=6):
        """A hexagonal crystal shard growing from `base` along `direction`."""
        d = np.array(direction, float); d /= np.linalg.norm(d)
        body = self._frustum(r, r * 0.75, length * 0.7, n); body.apply_translation((0, 0, length * 0.35))
        tipm = trimesh.creation.cone(radius=r * 0.75, height=length * 0.3, sections=n); tipm.apply_translation((0, 0, length * 0.7))
        m = trimesh.util.concatenate([body, tipm])
        T = trimesh.geometry.align_vectors([0, 0, 1], d)
        if T is not None: m.apply_transform(T)
        m.apply_translation(base)
        return self.add(m, color)
    def spikes(self, center, r, n, length, color, ring_z_offsets=(0,), phase=0.0, tilt=0.0):
        for zo in ring_z_offsets:
            for i in range(n):
                a = phase + i * 2 * math.pi / n
                d = np.array([math.cos(a), math.sin(a), tilt]); d /= np.linalg.norm(d)
                base = np.array(center) + np.array([0, 0, zo]) + d * (r * 0.85)
                self.crystal(base, d, length, length * 0.32, color, n=4)
    def ball(self, center, r, color, sub=1):
        return self.add(trimesh.creation.icosphere(subdivisions=sub, radius=r).apply_translation(center), color)
    def chain(self, p0, p1, links, color, r=0.02):
        p0, p1 = np.array(p0, float), np.array(p1, float)
        d = p1 - p0; L = np.linalg.norm(d); d /= L
        T = trimesh.geometry.align_vectors([0, 0, 1], d)
        for i in range(links):
            c = p0 + d * (L * (i + 0.5) / links)
            m = trimesh.creation.torus(major_radius=r * 1.7, minor_radius=r * 0.55, major_sections=8, minor_sections=5)
            m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0)))
            if i % 2: m.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (0, 0, 1)))
            if T is not None: m.apply_transform(T)
            m.apply_translation(c)
            self.add(m, color)
    def ribbon(self, z, color, length=0.35, side=1):
        """A little pennant hanging off the shaft below a spearhead."""
        for k in range(2):
            self.prism([(side * 0.03, z - k * 0.02), (side * 0.10, z - 0.04 - k * 0.03), (side * (0.16 + k * 0.03), z - length * (0.9 + k * 0.15)), (side * (0.08 + k * 0.03), z - length * (0.75 + k * 0.1))], 0.012, color, y=(k - 0.5) * 0.03)
    def leaf_head(self, z0, z1, w, color, thick=0.05, hi=None):
        pts = [(0, z0), (w * 0.5, z0 + (z1 - z0) * 0.35), (0, z1), (-w * 0.5, z0 + (z1 - z0) * 0.35)]
        self.prism(pts, thick, color, taper=0.5)
        if hi: self.prism([(0, z0 + 0.02), (w * 0.12, z0 + (z1 - z0) * 0.35), (0, z1 - 0.03), (-w * 0.12, z0 + (z1 - z0) * 0.35)], thick * 1.15, hi)
    def axe_head(self, z, side, reach, height, color, edge=None, back=0.0, thick=0.09, beard=0.0):
        """One axe blade at height z, flaring out to `side` (±1)."""
        s = side
        pts = [(s * 0.06, z + height * 0.45), (s * reach * 0.62, z + height * 0.55), (s * reach, z + height * 0.15),
               (s * reach * 0.98, z - height * 0.25), (s * reach * 0.7, z - height * 0.5 - beard), (s * 0.06, z - height * 0.35)]
        self.prism(pts, thick, color, taper=0.55)
        if edge:
            e = [(s * reach * 0.62, z + height * 0.55), (s * reach, z + height * 0.15), (s * reach * 0.98, z - height * 0.25), (s * reach * 0.7, z - height * 0.5 - beard),
                 (s * reach * 0.62, z - height * 0.42 - beard), (s * reach * 0.86, z - height * 0.22), (s * reach * 0.88, z + height * 0.12), (s * reach * 0.6, z + height * 0.45)]
            self.prism(e, thick * 1.12, edge)
    def hammer_head(self, z, w, h, d, color, bands=None, face=None):
        self.box((w, d, h), (0, 0, z), color)
        if bands:
            for sx in (-1, 1):
                self.box((0.05, d * 1.08, h * 1.06), (sx * (w * 0.3), 0, z), bands)
        if face:
            for sx in (-1, 1):
                self.box((0.04, d * 0.9, h * 0.9), (sx * (w / 2), 0, z), face)
    def bow_limbs(self, r, span, color, thick=0.035, string=None, wraps=None, cheek=0.0):
        """A bow drawn in the XZ plane, bending toward -Y... kept flat: the limbs
        arc in X with the string along the chord."""
        n = 12
        pts = []
        for i in range(n + 1):
            t = i / n
            zz = -span / 2 + span * t
            xx = -math.sin(t * math.pi) * r - cheek * math.sin(t * math.pi * 3) * 0.08
            pts.append((xx, 0, zz))
        for i in range(n):
            self.seg(pts[i], pts[i + 1], thick, color, n=6)
        if string:
            self.seg(pts[0], pts[-1], 0.006, string, n=4)
        if wraps:
            for t in (0.22, 0.5, 0.78):
                i = int(t * n)
                self.seg(pts[i], pts[min(n, i + 1)], thick * 1.6, wraps, n=6)
        return pts
    def seg(self, p0, p1, r, color, n=6):
        p0, p1 = np.array(p0, float), np.array(p1, float)
        v = p1 - p0; L = np.linalg.norm(v)
        if L < 1e-6: return
        m = trimesh.creation.cylinder(radius=r, height=L, sections=n)
        T = trimesh.geometry.align_vectors([0, 0, 1], v / L)
        if T is not None: m.apply_transform(T)
        m.apply_translation((p0 + p1) / 2)
        return self.add(m, color)
    def claw(self, base, direction, length, r, color):
        """A curved talon: three tapering segments bending toward -X."""
        p = np.array(base, float); d = np.array(direction, float); d /= np.linalg.norm(d)
        bend = np.array([-0.35, 0, 0.0])
        for i in range(3):
            q = p + (d + bend * i) / np.linalg.norm(d + bend * i) * (length / 3)
            self.seg(p, q, r * (1 - i * 0.28), color, n=5)
            p = q
        self.crystal(p, (d + bend * 3) / np.linalg.norm(d + bend * 3), length * 0.25, r * 0.3, color, n=4)

    # --- output ---
    def mesh(self):
        m = trimesh.util.concatenate(self.parts)
        m.unmerge_vertices()          # per-face vertices -> flat normals
        return m

def write_glb(mesh, path):
    """Export a single flat-shaded, vertex-coloured primitive with a
    non-metallic material. Vertex colours are written linear, as glTF wants."""
    v = np.asarray(mesh.vertices, np.float32)
    f = np.asarray(mesh.faces, np.uint32)
    fn = np.asarray(mesh.face_normals, np.float32)
    nrm = np.repeat(fn, 3, axis=0).astype(np.float32)   # unmerged: 3 verts per face in order
    # unmerge_vertices leaves faces as [3i,3i+1,3i+2]; guard if not
    if not np.array_equal(f.flatten(), np.arange(len(f) * 3, dtype=np.uint32)):
        v = v[f.flatten()]; f = np.arange(len(f) * 3, dtype=np.uint32).reshape(-1, 3)
    fc = np.asarray(mesh.visual.face_colors)[:, :3] / 255.0
    lin = np.where(fc <= 0.04045, fc / 12.92, ((fc + 0.055) / 1.055) ** 2.4)
    col = np.repeat(lin, 3, axis=0).astype(np.float32)
    col4 = np.c_[col, np.ones(len(col), np.float32)]
    idx = f.flatten().astype(np.uint32)
    def pad(b): return b + b'\x00' * ((4 - len(b) % 4) % 4)
    blobs = [pad(v.tobytes()), pad(nrm.tobytes()), pad(col4.tobytes()), pad(idx.tobytes())]
    offs, o = [], 0
    for b in blobs: offs.append(o); o += len(b)
    bin_ = b''.join(blobs)
    gltf = {
        'asset': {'version': '2.0', 'generator': 'blackroot build_weapons.py'},
        'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': path.stem}],
        'meshes': [{'name': path.stem, 'primitives': [{'attributes': {'POSITION': 0, 'NORMAL': 1, 'COLOR_0': 2}, 'indices': 3, 'material': 0}]}],
        'materials': [{'name': 'Flat', 'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.7}}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': offs[0], 'byteLength': len(blobs[0]), 'target': 34962},
            {'buffer': 0, 'byteOffset': offs[1], 'byteLength': len(blobs[1]), 'target': 34962},
            {'buffer': 0, 'byteOffset': offs[2], 'byteLength': len(blobs[2]), 'target': 34962},
            {'buffer': 0, 'byteOffset': offs[3], 'byteLength': len(blobs[3]), 'target': 34963},
        ],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': len(v), 'type': 'VEC3', 'min': v.min(axis=0).tolist(), 'max': v.max(axis=0).tolist()},
            {'bufferView': 1, 'componentType': 5126, 'count': len(nrm), 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5126, 'count': len(col4), 'type': 'VEC4'},
            {'bufferView': 3, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'},
        ],
        'buffers': [{'byteLength': len(bin_)}],
    }
    js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, 'wb') as fh:
        fh.write(struct.pack('<III', 0x46546C67, 2, total))
        fh.write(struct.pack('<II', len(js), 0x4E4F534A)); fh.write(js)
        fh.write(struct.pack('<II', len(bin_), 0x004E4942)); fh.write(bin_)

# ---------------------------------------------------------------- shared weapon templates
def sword(w, *, blade_len, width, blade=None, hi=None, guard=C['gold'], guard_w=0.34, guard_gem=None, grip=C['leather'], grip_len=0.22, grip_bands=3,
          pommel=C['gold'], pommel_gem=None, notches=0, thick=0.05, tip=0.14, guard_curl=0, blade_gems=(), ridge=True, pommel_shape='cube'):
    z = 0.0
    w.pommel(z - grip_len - 0.05, pommel, 0.05, gem=pommel_gem, shape=pommel_shape)
    w.grip(z - grip_len, z, 0.032, grip, bands=grip_bands, band_color=C['dark'] if grip in (C['leather_blue'], C['leather_red']) else C['wood_lo'])
    w.crossguard(z + 0.035, guard_w, guard, curl=guard_curl)
    if guard_gem: w.gem((0, -0.06, z + 0.035), 0.035, guard_gem)
    w.blade(z + 0.07, z + 0.07 + blade_len, width, blade, tip=tip, thick=thick, notches=notches, ridge=ridge, hi=hi)
    for gz, gc in blade_gems: w.gem((0, -thick * 0.55, z + 0.07 + blade_len * gz), 0.03, gc)

def dagger(w, blade=C['steel'], guard=C['gold'], grip=C['leather'], pommel=C['gold'], gem=None, blade_len=0.32):
    sword(w, blade_len=blade_len, width=0.09, blade=blade, guard=guard, guard_w=0.17, grip=grip, grip_len=0.14, grip_bands=3, pommel=pommel, pommel_gem=gem, guard_gem=gem, thick=0.035, tip=0.1)

def polearm_shaft(w, z0, z1, color, r=0.022, wraps=None, wrap_color=None):
    w.rod(z0, z1, r, color, n=8)
    if wraps:
        for zz in wraps: w.rod(zz - 0.03, zz + 0.03, r * 1.4, wrap_color or C['leather'], n=8)

def spiked_ball(w, center, r, color, spike_color, n=8, rings=(-0.35, 0.35)):
    w.ball(center, r, color, sub=1)
    w.spikes(center, r, n, r * 0.9, spike_color, ring_z_offsets=tuple(o * r for o in rings), phase=0.3)
    w.crystal((center[0], center[1], center[2] + r * 0.85), (0, 0, 1), r * 0.9, r * 0.3, spike_color, n=4)

# ---------------------------------------------------------------- the 20-pack
def w_short_sword(w):  sword(w, blade_len=0.62, width=0.14, guard_gem=C['blue'], pommel_gem=C['blue'], grip=C['leather'])
def w_scimitar(w):
    w.pommel(-0.24, C['gold'], 0.045, gem=C['red'])
    w.grip(-0.2, 0, 0.03, C['leather'], bands=3, band_color=C['wood_lo'])
    w.crossguard(0.03, 0.22, C['gold'], curl=0.07)
    w.curved_blade(0.06, 0.82, 0.14, 0.16, back=C['red'])
def w_longsword(w):   sword(w, blade_len=0.82, width=0.13, guard_gem=C['blue'], pommel_gem=C['blue'], grip=C['leather_blue'], grip_len=0.26)
def w_greatsword(w):
    sword(w, blade_len=1.05, width=0.22, blade=C['steel_lo'], hi=C['iron'], guard=C['dark'], guard_w=0.42, guard_gem=C['red'], grip=C['leather_red'], grip_len=0.3, grip_bands=4,
          pommel=C['dark'], pommel_gem=C['red'], notches=8, thick=0.07, blade_gems=((0.3, C['red']), (0.6, C['red'])))
def w_dagger(w):      sword(w, blade_len=0.34, width=0.09, blade=C['steel_lo'], guard=C['dark'], guard_w=0.14, guard_gem=C['green_hi'], grip=C['leather_green'], grip_len=0.14, pommel=C['dark'], pommel_gem=C['green_hi'], thick=0.035, tip=0.1)
def w_battle_axe(w):
    polearm_shaft(w, -0.55, 0.62, C['wood'], r=0.024, wraps=(-0.3,), wrap_color=C['leather'])
    w.pommel(-0.57, C['dark'], 0.04, gem=C['blue'], shape='spike')
    w.box((0.1, 0.09, 0.28), (0, 0, 0.5), C['dark'])
    w.axe_head(0.5, 1, 0.52, 0.56, C['steel'], edge=C['steel_hi'], beard=0.1)
    w.gem((0.22, -0.06, 0.54), 0.035, C['blue']); w.prism([(0.14, 0.4), (0.34, 0.64), (0.4, 0.54), (0.22, 0.34)], 0.1, C['blue'])
    w.crystal((-0.05, 0, 0.5), (-1, 0, 0.1), 0.18, 0.05, C['dark'], n=4)
    w.crystal((0, 0, 0.64), (0, 0, 1), 0.12, 0.04, C['steel'], n=4)
def w_greataxe(w):
    polearm_shaft(w, -0.7, 0.7, C['wood_lo'], r=0.028, wraps=(-0.25, -0.45), wrap_color=C['leather_red'])
    w.pommel(-0.72, C['dark'], 0.045, gem=C['red'], shape='spike')
    w.box((0.14, 0.1, 0.34), (0, 0, 0.55), C['dark'])
    for s in (-1, 1):
        w.axe_head(0.55, s, 0.46, 0.5, C['steel'], edge=C['orange'], beard=0.08)
    w.crystal((0, 0, 0.72), (0, 0, 1), 0.16, 0.05, C['steel'], n=4)
def w_mace(w):
    w.pommel(-0.42, C['gold'], 0.04, shape='cube')
    w.grip(-0.4, -0.1, 0.028, C['dark'], bands=3, band_color=C['black'])
    w.rod(-0.1, 0.12, 0.03, C['gold'], n=8)
    spiked_ball(w, (0, 0, 0.24), 0.13, C['black'], C['tan'], n=8)
def w_warhammer(w):
    polearm_shaft(w, -0.6, 0.55, C['wood'], r=0.026, wraps=(-0.35,), wrap_color=C['leather'])
    w.pommel(-0.62, C['gold'], 0.045)
    w.hammer_head(0.52, 0.46, 0.2, 0.2, C['stone'], bands=C['gold'], face=C['steel_lo'])
    w.gem((0, -0.11, 0.52), 0.05, C['gold_hi'])   # sun emblem
    w.box((0.1, 0.22, 0.24), (0, 0, 0.52), C['dark'])
def w_spear(w):
    polearm_shaft(w, -0.95, 0.72, C['wood'], r=0.02)
    w.rod(-0.95, -1.08, 0.03, C['steel_lo'], n=6, r2=0)
    w.rod(0.66, 0.74, 0.032, C['steel_lo'], n=8)
    w.leaf_head(0.72, 1.12, 0.12, C['steel'], hi=C['steel_hi'])
    w.ribbon(0.66, C['blue'])
def w_halberd(w):
    polearm_shaft(w, -1.0, 0.75, C['dark'], r=0.022, wraps=(-0.6,), wrap_color=C['gold'])
    w.pommel(-1.02, C['gold'], 0.035)
    w.rod(0.68, 0.78, 0.032, C['steel_lo'], n=8)
    w.axe_head(0.78, 1, 0.3, 0.34, C['steel'], edge=C['steel_hi'])
    w.crystal((-0.02, 0, 0.72), (-1, 0, 0.3), 0.16, 0.04, C['steel'], n=4)
    w.blade(0.9, 1.22, 0.07, C['steel'], tip=0.12, thick=0.04, ridge=False)
    w.ribbon(0.66, C['green'], side=-1)
def w_bow(w):
    w.bow_limbs(0.28, 1.3, C['wood'], thick=0.028, string=C['string'], wraps=C['green'])
    w.box((0.06, 0.06, 0.16), (-0.28, 0, 0), C['leather'])
def w_crossbow(w):
    w.box((0.09, 0.07, 0.72), (0, 0, 0.05), C['wood'])            # stock
    w.box((0.06, 0.05, 0.3), (0, -0.05, -0.2), C['wood_lo'])       # butt
    w.prism([(-0.5, 0.3), (-0.3, 0.36), (0.3, 0.36), (0.5, 0.3), (0.45, 0.26), (-0.45, 0.26)], 0.04, C['steel'])
    w.seg((-0.5, 0, 0.3), (0, 0, 0.0), 0.006, C['string'], n=4); w.seg((0.5, 0, 0.3), (0, 0, 0.0), 0.006, C['string'], n=4)
    w.rod(0.1, 0.5, 0.012, C['wood_hi'], n=6); w.crystal((0, 0, 0.5), (0, 0, 1), 0.08, 0.02, C['orange'], n=4)
    w.gem((0, 0.05, 0.32), 0.03, C['orange'])
def w_magic_staff(w):
    polearm_shaft(w, -0.85, 0.55, C['wood'], r=0.024, wraps=(-0.2, 0.15), wrap_color=C['wood_lo'])
    w.rod(-0.85, -0.98, 0.028, C['wood_lo'], n=6, r2=0)
    for a in (0.5, 2.6, 4.7):
        d = (math.cos(a) * 0.5, math.sin(a) * 0.5, 1)
        w.crystal((0, 0, 0.52), d, 0.3, 0.025, C['wood'], n=5)
    w.gem((0, 0, 0.8), 0.15, C['purple'], stretch=1.5)
    w.gem((0.1, 0.05, 0.94), 0.035, C['purple_hi']); w.gem((-0.09, -0.04, 0.9), 0.03, C['purple_hi'])
def w_wand(w):
    w.pommel(-0.26, C['gold'], 0.028)
    w.grip(-0.24, 0, 0.018, C['dark'], bands=2, band_color=C['black'])
    w.gem((0, 0, 0.02), 0.04, C['red'])
    w.rod(0.03, 0.3, 0.016, C['dark'], n=6, r2=0.012)
    w.crystal((0, 0, 0.3), (0, 0, 1), 0.16, 0.035, C['red'], n=5)
    for (x, y, z) in ((0.08, 0, 0.36), (-0.07, 0.03, 0.42), (0.05, -0.05, 0.48)): w.gem((x, y, z), 0.02, C['red_hi'], stretch=1.6)
def w_twin_claws(w):
    for sx, x in ((-1, -0.13), (1, 0.13)):
        w.box((0.09, 0.09, 0.2), (x, 0, -0.1), C['dark'])
        w.rod(-0.16, -0.12, 0.052, C['red'], n=8, x=x); w.rod(-0.02, 0.02, 0.052, C['red'], n=8, x=x)
        for k, dx in enumerate((-0.035, 0, 0.035)):
            w.crystal((x + dx, 0, 0.0), (0, 0, 1), 0.34 - abs(dx) * 1.5, 0.014, C['steel'], n=4)
def w_flail(w):
    w.pommel(-0.42, C['gold'], 0.04)
    w.grip(-0.4, 0.0, 0.028, C['dark'], bands=3, band_color=C['black'])
    w.rod(0.0, 0.06, 0.034, C['gold'], n=8)
    w.chain((0, 0, 0.06), (0.06, 0, 0.36), 6, C['iron'])
    spiked_ball(w, (0.08, 0, 0.5), 0.12, C['black'], C['tan'], n=8)
def w_sickle(w):
    w.add(trimesh.creation.torus(major_radius=0.035, minor_radius=0.01, major_sections=8, minor_sections=5).apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0))).apply_translation((0, 0, -0.3)), C['dark'])
    w.grip(-0.28, 0.02, 0.026, C['leather_green'], bands=3, band_color=C['olive'])
    w.rod(0.02, 0.08, 0.03, C['dark'], n=8)
    # crescent: a hook that sweeps up and back over to -X
    pts = []
    for i in range(9):
        t = i / 8; a = t * 2.2
        pts.append((0.04 - math.sin(a) * 0.3, 0.08 + (1 - math.cos(a)) * 0.24 + t * 0.06))
    inner = [(x + 0.07 * (1 - (i / 8) ** 2) + 0.02, z - 0.03 * (1 - i / 8)) for i, (x, z) in enumerate(pts)]
    w.prism(pts + inner[::-1], 0.03, C['steel'], taper=0.6)
def w_whip(w):
    w.rod(-0.3, -0.34, 0.03, C['steel_lo'], n=6, r2=0)
    w.grip(-0.3, -0.05, 0.022, C['dark'], bands=4, band_color=C['black'])
    # a coiled lash: a spiral of segments in the XZ plane
    pts = []
    for i in range(26):
        t = i / 25
        a = t * math.pi * 2.2
        rr = 0.22 * (1 - t * 0.35)
        pts.append((math.sin(a) * rr, math.cos(a * 0.7) * 0.03, -0.05 + t * 0.55 + (1 - math.cos(a)) * 0.1))
    for i in range(25):
        w.seg(pts[i], pts[i + 1], 0.02 * (1 - i / 40), C['rust2'], n=6)
        if i % 3 == 1: w.crystal(pts[i], (math.cos(i), math.sin(i), 0.3), 0.04, 0.012, C['red'], n=4)
    w.crystal(pts[-1], (0, 0, 1), 0.07, 0.02, C['red'], n=4)
def w_throwing_axe(w):
    polearm_shaft(w, -0.36, 0.3, C['wood'], r=0.02, wraps=(-0.2,), wrap_color=C['leather'])
    w.pommel(-0.38, C['dark'], 0.03, gem=C['blue'], shape='cube')
    w.box((0.08, 0.07, 0.2), (0, 0, 0.2), C['dark'])
    w.axe_head(0.2, 1, 0.3, 0.3, C['steel'], edge=C['steel_hi'], beard=0.04)
    w.prism([(0.1, 0.14), (0.22, 0.28), (0.25, 0.22), (0.15, 0.1)], 0.1, C['blue'])

# ---------------------------------------------------------------- the 30 rarity weapons
def r_rusted_training_sword(w): sword(w, blade_len=0.6, width=0.13, blade=C['iron'], hi=C['rust'], guard=C['iron'], guard_w=0.3, grip=C['leather'], pommel=C['iron'], pommel_shape='sphere', blade_gems=((0.5, C['rust2']),))
def r_ashwood_club(w):
    w.rod(-0.55, -0.15, 0.03, C['wood_lo'], n=8)
    w.rod(-0.32, -0.18, 0.036, C['tan'], n=8)
    w.rod(-0.15, 0.45, 0.045, C['wood_hi'], n=8, r2=0.075)
    w.ball((0, 0, 0.47), 0.075, C['wood_hi'], sub=1)
    for i, (a, z) in enumerate(((0.3, 0.1), (2.2, 0.28), (4.1, 0.2), (1.2, 0.42), (5.2, 0.4))):
        w.crystal((math.cos(a) * 0.06, math.sin(a) * 0.06, z), (math.cos(a), math.sin(a), 0.2), 0.1, 0.028, C['iron'], n=4)
def r_copper_dagger(w): dagger(w, blade=C['copper'], guard=C['gold'], grip=C['leather'], pommel=C['copper'], gem=None, blade_len=0.34)
def r_hunter_shortbow(w):
    w.bow_limbs(0.24, 1.15, C['wood'], thick=0.026, string=C['string'], wraps=C['green'])
def r_iron_spear(w):
    polearm_shaft(w, -0.95, 0.72, C['wood'], r=0.02)
    w.rod(-0.95, -1.1, 0.032, C['iron'], n=6, r2=0)
    w.rod(0.66, 0.74, 0.032, C['iron'], n=8)
    w.leaf_head(0.72, 1.14, 0.12, C['steel'], hi=C['steel_hi'])
    w.ribbon(0.66, C['blue'])
def r_bronze_war_axe(w):
    polearm_shaft(w, -0.62, 0.62, C['wood_lo'], r=0.026, wraps=(-0.2, -0.4), wrap_color=C['bronze'])
    w.pommel(-0.64, C['bronze'], 0.045)
    w.box((0.09, 0.08, 0.2), (0, 0, 0.48), C['wood_lo'])
    for s in (-1, 1): w.axe_head(0.48, s, 0.42, 0.48, C['bronze'], edge=C['gold_hi'], beard=0.06)
    w.crystal((0, 0, 0.64), (0, 0, 1), 0.14, 0.04, C['bronze'], n=4)
def r_falcon_scimitar(w):
    w.pommel(-0.26, C['gold'], 0.045, gem=C['blue'])
    w.grip(-0.22, 0, 0.03, C['leather_red'], bands=3, band_color=C['dark'])
    w.crossguard(0.03, 0.24, C['gold'], curl=0.1)
    w.gem((0, -0.06, 0.03), 0.035, C['blue'])
    w.curved_blade(0.06, 0.98, 0.17, 0.2)
def r_guard_mace(w):
    w.pommel(-0.46, C['gold'], 0.04, gem=C['blue'])
    w.grip(-0.44, -0.12, 0.028, C['black'], bands=3, band_color=C['gold'])
    w.rod(-0.12, 0.1, 0.03, C['gold'], n=8)
    spiked_ball(w, (0, 0, 0.24), 0.14, C['black'], C['tan'], n=8)
    w.rod(0.08, 0.12, 0.05, C['gold'], n=8)
def r_steel_longsword(w): sword(w, blade_len=0.85, width=0.13, hi=C['white'], guard_gem=C['blue'], pommel_gem=C['blue'], grip=C['leather_blue'], grip_len=0.26)
def r_ranger_crossbow(w):
    w.box((0.09, 0.07, 0.72), (0, 0, 0.05), C['wood'])
    w.box((0.06, 0.05, 0.3), (0, -0.05, -0.2), C['wood_lo'])
    w.prism([(-0.52, 0.3), (-0.3, 0.37), (0.3, 0.37), (0.52, 0.3), (0.46, 0.25), (-0.46, 0.25)], 0.045, C['steel'])
    w.seg((-0.52, 0, 0.3), (0, 0, 0.0), 0.006, C['string'], n=4); w.seg((0.52, 0, 0.3), (0, 0, 0.0), 0.006, C['string'], n=4)
    w.gem((0, 0.05, 0.2), 0.035, C['green_hi']); w.gem((-0.5, 0, 0.3), 0.03, C['green']); w.gem((0.5, 0, 0.3), 0.03, C['green'])
    w.rod(0.1, 0.5, 0.012, C['wood_hi'], n=6); w.crystal((0, 0, 0.5), (0, 0, 1), 0.08, 0.02, C['steel'], n=4)
def r_knight_halberd(w):
    polearm_shaft(w, -1.0, 0.78, C['wood'], r=0.022, wraps=(-0.5,), wrap_color=C['gold'])
    w.rod(-1.0, -1.15, 0.03, C['steel_lo'], n=6, r2=0)
    w.rod(0.7, 0.8, 0.032, C['steel_lo'], n=8)
    w.axe_head(0.8, 1, 0.32, 0.36, C['steel'], edge=C['steel_hi'])
    w.crystal((-0.02, 0, 0.74), (-1, 0, 0.3), 0.16, 0.04, C['steel'], n=4)
    w.blade(0.92, 1.26, 0.07, C['steel'], tip=0.12, thick=0.04, ridge=False)
    w.ribbon(0.66, C['blue'], side=-1)
def r_moonfang_twin_daggers(w):
    for x in (-0.14, 0.14):
        w.pommel(-0.2, C['iron'], 0.03, shape='sphere', x=x)
        w.rod(-0.18, 0, 0.026, C['leather_blue'], n=8, x=x)
        w.box((0.16, 0.06, 0.05), (x, 0, 0.03), C['gold']); w.gem((x, -0.05, 0.03), 0.03, C['blue'])
        w.curved_blade(0.06, 0.48, 0.09, 0.06 * (1 if x > 0 else -1), thick=0.03, x0=x)
def r_stormcaller_staff(w):
    polearm_shaft(w, -0.9, 0.6, C['wood_lo'], r=0.024, wraps=(-0.25, 0.1, 0.35), wrap_color=C['leather_blue'])
    w.crystal((0, 0, -0.9), (0, 0, -1), 0.14, 0.035, C['blue_hi'], n=6)
    for a, L in ((0.3, 0.42), (2.4, 0.34), (4.3, 0.3)):
        w.crystal((0, 0, 0.58), (math.cos(a) * 0.35, math.sin(a) * 0.35, 1), L, 0.028, C['wood'], n=5)
    w.crystal((0, 0, 0.72), (0, 0, 1), 0.36, 0.06, C['ice'], n=6)
    w.crystal((0.06, 0.02, 0.7), (0.5, 0.2, 1), 0.22, 0.035, C['blue_hi'], n=6)
    w.crystal((-0.06, -0.02, 0.68), (-0.5, -0.2, 1), 0.18, 0.03, C['cyan'], n=6)
    w.gem((0.14, 0.0, 1.05), 0.025, C['ice'], stretch=1.8); w.gem((-0.12, 0.04, 0.98), 0.02, C['ice'], stretch=1.8)
def r_ember_warhammer(w):
    polearm_shaft(w, -0.62, 0.55, C['leather_red'], r=0.028, wraps=(-0.4,), wrap_color=C['gold'])
    w.pommel(-0.64, C['dark'], 0.045, shape='spike')
    w.hammer_head(0.52, 0.5, 0.24, 0.24, C['stone_lo'], bands=C['orange'], face=C['stone'])
    w.gem((0, -0.13, 0.52), 0.06, C['orange'], stretch=1.3)
    for sx in (-1, 1): w.box((0.03, 0.26, 0.05), (sx * 0.12, 0, 0.6), C['ember'])
def r_serpent_whip(w):
    w.pommel(-0.3, C['gold'], 0.03, gem=C['green_hi'])
    w.grip(-0.28, -0.04, 0.024, C['olive'], bands=3, band_color=C['gold'])
    pts = []
    for i in range(24):
        t = i / 23; a = t * math.pi * 1.9
        pts.append((math.sin(a) * 0.24 * (1 - t * 0.3), math.cos(a) * 0.02, -0.02 + t * 0.6 + (1 - math.cos(a)) * 0.08))
    for i in range(23):
        w.seg(pts[i], pts[i + 1], 0.024 * (1 - i / 50), C['olive'] if i % 2 else C['shadow'], n=6)
        if i % 4 == 2: w.crystal(pts[i], (math.cos(i * 1.3), math.sin(i * 1.3), 0.2), 0.05, 0.014, C['gold'], n=4)
    head = np.array(pts[-1]); w.box((0.06, 0.05, 0.1), head + np.array([0, 0, 0.04]), C['olive']); w.gem(head + np.array([0.02, -0.03, 0.06]), 0.012, C['green_hi'])
    w.crystal(head + np.array([0, 0, 0.09]), (0.1, 0, 1), 0.06, 0.008, C['red'], n=4)
def r_crystal_greatbow(w):
    pts = w.bow_limbs(0.34, 1.5, C['shadow'], thick=0.036, string=C['cyan'], wraps=C['gold'])
    for i in (2, 4, 8, 10):
        p = np.array(pts[i]); d = np.array([-1.0, 0, (i - 6) * 0.15]); w.crystal(p, d, 0.16 + (i % 3) * 0.04, 0.03, C['ice'], n=6)
        w.crystal(p, (-0.4, 0.5, 0), 0.1, 0.02, C['cyan'], n=6)
    w.gem((-0.34, -0.03, 0), 0.06, C['blue']); w.box((0.07, 0.07, 0.18), (-0.33, 0, 0), C['gold'])
def r_sunforged_claymore(w):
    sword(w, blade_len=1.1, width=0.2, blade=C['white'], hi=C['gold_hi'], guard=C['gold'], guard_w=0.4, grip=C['leather_red'], grip_len=0.3, grip_bands=4, pommel=C['gold'], pommel_gem=None, thick=0.06, tip=0.2)
    w.gem((0, -0.07, 0.035), 0.06, C['gold_hi']); w.box((0.14, 0.05, 0.14), (0, 0, 0.035), C['gold'])
    for a in (0.4, 1.2, 1.95, 2.75): w.crystal((0, 0, 0.035), (math.cos(a), 0, math.sin(a) * 0.4 + 0.2), 0.12, 0.025, C['gold'], n=4); w.crystal((0, 0, 0.035), (-math.cos(a), 0, math.sin(a) * 0.4 + 0.2), 0.12, 0.025, C['gold'], n=4)
def r_void_pike(w):
    polearm_shaft(w, -1.0, 0.78, C['black'], r=0.022, wraps=(-0.5, 0.5), wrap_color=C['violet'])
    w.crystal((0, 0, -1.0), (0, 0, -1), 0.14, 0.03, C['purple'], n=4)
    w.blade(0.78, 1.28, 0.14, C['violet'], hi=C['purple_hi'], tip=0.22, thick=0.05, notches=0)
    for s in (-1, 1): w.crystal((s * 0.03, 0, 0.85), (s, 0, 0.7), 0.2, 0.03, C['violet'], n=4)
    w.gem((0, -0.04, 0.95), 0.04, C['purple_hi'])
def r_runebound_flail(w):
    w.pommel(-0.45, C['iron'], 0.04, shape='spike')
    w.grip(-0.42, 0.0, 0.028, C['leather_red'], bands=4, band_color=C['black'])
    w.rod(0.0, 0.06, 0.036, C['iron'], n=8)
    w.chain((0, 0, 0.06), (0.06, 0, 0.36), 6, C['iron'])
    spiked_ball(w, (0.08, 0, 0.52), 0.13, C['black'], C['purple'], n=8)
    w.gem((0.08, -0.11, 0.52), 0.03, C['purple_hi'])
def r_shadow_reaver_scythe(w):
    polearm_shaft(w, -1.05, 0.5, C['wood_lo'], r=0.024, wraps=(-0.3, 0.2), wrap_color=C['violet'])
    w.crystal((0, 0, -1.05), (0, 0, -1), 0.16, 0.035, C['violet'], n=4)
    w.box((0.1, 0.08, 0.14), (0, 0, 0.52), C['shadow']); w.gem((0, -0.06, 0.52), 0.04, C['purple_hi'])
    # the blade: a long crescent sweeping out to -X and curling up at the tip
    outer, inner = [], []
    for i in range(11):
        t = i / 10; a = t * 2.3
        outer.append((0.0 - math.sin(a) * 0.9, 0.5 + (1 - math.cos(a)) * 0.42))
        wdt = 0.3 * (1 - t) ** 0.7 + 0.012
        inner.append((outer[-1][0] + wdt * math.cos(a * 0.5), outer[-1][1] - wdt * math.sin(a * 0.5 + 0.3) - 0.04 * (1 - t)))
    w.prism(outer + inner[::-1], 0.035, C['shadow'], taper=0.6)
    edge_in = [(x + 0.05 * (1 - (i / 10)) + 0.005, z - 0.02) for i, (x, z) in enumerate(outer)]
    w.prism(outer + edge_in[::-1], 0.04, C['purple'])
    w.crystal((-0.06, 0, 0.56), (-1, 0, -0.5), 0.16, 0.03, C['violet'], n=4)
def r_dragonfire_blade(w):
    sword(w, blade_len=0.88, width=0.16, blade=C['dark'], hi=C['orange'], guard=C['gold'], guard_w=0.34, guard_gem=C['red'], grip=C['leather'], grip_len=0.24, pommel=C['gold'], pommel_gem=None, thick=0.055, tip=0.18, notches=4, blade_gems=((0.35, C['red']), (0.6, C['ember'])))
def r_frostbite_maul(w):
    polearm_shaft(w, -0.65, 0.5, C['dark'], r=0.028, wraps=(-0.2, -0.45), wrap_color=C['blue'])
    w.pommel(-0.67, C['steel_lo'], 0.045, shape='spike')
    w.hammer_head(0.5, 0.5, 0.26, 0.26, C['steel'], bands=C['steel_lo'], face=C['steel_hi'])
    for (x, y, z, d) in ((0.2, 0.1, 0.62, (0.3, 0.2, 1)), (-0.15, -0.08, 0.64, (-0.2, -0.1, 1)), (0.26, -0.1, 0.5, (1, -0.3, 0.2)), (-0.26, 0.08, 0.5, (-1, 0.3, 0.2)), (0.05, 0.14, 0.58, (0, 1, 0.5)), (0.0, -0.14, 0.4, (0, -1, -0.3))):
        w.crystal((x, y, z), d, 0.2, 0.04, C['ice'], n=6)
def r_phoenix_talons(w):
    for sx, x in ((-1, -0.16), (1, 0.16)):
        w.box((0.12, 0.1, 0.22), (x, 0, -0.08), C['leather_red'])
        w.box((0.13, 0.11, 0.05), (x, 0, 0.0), C['gold']); w.gem((x, -0.07, -0.04), 0.03, C['red'])
        for k, dx in enumerate((-0.04, 0, 0.04)):
            w.claw((x + dx, 0, 0.02), (0, 0, 1), 0.3 - abs(dx) * 1.2, 0.016, C['gold'])
def r_leviathan_trident(w):
    polearm_shaft(w, -1.0, 0.7, C['teal'], r=0.022, wraps=(-0.6, 0.45), wrap_color=C['gold'])
    w.crystal((0, 0, -1.0), (0, 0, -1), 0.14, 0.03, C['teal_hi'], n=4)
    w.box((0.32, 0.08, 0.08), (0, 0, 0.74), C['gold']); w.gem((0, -0.06, 0.74), 0.035, C['cyan'])
    for x in (-0.14, 0, 0.14):
        w.blade(0.76, 1.12 + (0.08 if x == 0 else 0), 0.07, C['teal_hi'], hi=C['ice'], tip=0.12, thick=0.04, ridge=False, x=x)
    w.ribbon(0.66, C['cyan'])
def r_celestial_wand(w):
    w.pommel(-0.28, C['gold'], 0.03, gem=C['purple'])
    w.grip(-0.26, -0.02, 0.018, C['gold_lo'], bands=2, band_color=C['gold'])
    w.rod(-0.02, 0.26, 0.016, C['gold'], n=6)
    ring = trimesh.creation.torus(major_radius=0.08, minor_radius=0.016, major_sections=12, minor_sections=6)
    ring.apply_transform(trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0))); ring.apply_translation((0, 0, 0.34)); w.add(ring, C['gold'])
    w.gem((0, 0, 0.34), 0.05, C['purple'])
    for (x, y, z) in ((0.12, 0.02, 0.42), (-0.1, -0.03, 0.44), (0.02, 0.05, 0.47), (-0.13, 0.02, 0.28)): w.gem((x, y, z), 0.018, C['purple_hi'], stretch=1.8)
def r_kingsguard_greataxe(w):
    polearm_shaft(w, -0.75, 0.72, C['dark'], r=0.028, wraps=(-0.3, -0.55), wrap_color=C['gold'])
    w.pommel(-0.77, C['gold'], 0.045)
    w.box((0.16, 0.12, 0.36), (0, 0, 0.55), C['gold'])
    for s in (-1, 1): w.axe_head(0.55, s, 0.48, 0.52, C['steel'], edge=C['steel_hi'], beard=0.08)
    w.gem((0, -0.08, 0.58), 0.06, C['gold_hi'])   # lion emblem
    w.crystal((0, 0, 0.74), (0, 0, 1), 0.16, 0.05, C['gold'], n=4)
    w.ribbon(0.36, C['blue']); w.ribbon(0.36, C['blue'], side=-1)
def r_arcane_crescent_staff(w):
    polearm_shaft(w, -0.9, 0.5, C['violet'], r=0.024, wraps=(-0.6, -0.1, 0.3), wrap_color=C['gold'])
    w.pommel(-0.92, C['gold'], 0.04, shape='spike')
    # the crescent: a thick arc open toward +X, horns pointing right
    R, r_in, cz = 0.26, 0.17, 0.66
    outer = [(math.cos(a) * R, cz + math.sin(a) * R) for a in np.linspace(-1.05, math.pi + 1.05, 16)]
    inner = [(math.cos(a) * r_in + 0.1, cz + math.sin(a) * r_in) for a in np.linspace(-1.2, math.pi + 1.2, 16)]
    w.prism(outer + inner[::-1], 0.06, C['shadow'])
    w.prism([(x * 1.03, cz + (z - cz) * 1.03) for x, z in outer] + [(x * 0.93, cz + (z - cz) * 0.93) for x, z in outer][::-1], 0.066, C['gold'])
    w.gem((0.06, 0, cz), 0.075, C['purple'], stretch=1.5)
    for (x, y, z) in ((0.14, 0.02, cz + 0.16), (-0.02, -0.04, cz + 0.2), (0.16, 0.04, cz - 0.1)): w.gem((x, y, z), 0.022, C['purple_hi'], stretch=1.7)
def r_doomspike_lance(w):
    polearm_shaft(w, -1.0, 0.7, C['black'], r=0.024, wraps=(-0.55, 0.15, 0.55), wrap_color=C['red'])
    w.crystal((0, 0, -1.0), (0, 0, -1), 0.16, 0.035, C['red'], n=4)
    w.blade(0.7, 1.3, 0.13, C['red'], hi=C['red_hi'], tip=0.26, thick=0.05, notches=0)
    for s in (-1, 1):
        w.crystal((s * 0.03, 0, 0.8), (s, 0, 0.5), 0.18, 0.03, C['dark'], n=4)
        w.crystal((s * 0.03, 0, 0.98), (s, 0, 0.6), 0.14, 0.025, C['dark'], n=4)
def r_worldroot_glaive(w):
    polearm_shaft(w, -1.0, 0.7, C['wood'], r=0.026)
    # vines spiralling the shaft
    for i in range(14):
        z = -0.9 + i * 0.11; a = i * 1.1
        w.seg((math.cos(a) * 0.03, math.sin(a) * 0.03, z), (math.cos(a + 1.1) * 0.03, math.sin(a + 1.1) * 0.03, z + 0.11), 0.012, C['green'], n=5)
        if i % 3 == 0: w.prism([(0, z), (0.05, z + 0.03), (0.09, z + 0.0), (0.05, z - 0.03)], 0.01, C['green_hi'], y=0.04)
    w.gem((0, -0.04, -0.3), 0.025, C['green_hi']); w.gem((0, -0.04, 0.2), 0.025, C['green_hi'])
    w.box((0.09, 0.08, 0.12), (0, 0, 0.72), C['wood_lo']); w.gem((0, -0.06, 0.72), 0.04, C['green_hi'])
    w.curved_blade(0.76, 1.32, 0.17, 0.12, color=C['steel'], thick=0.045)
def r_crownbreaker_relicblade(w):
    sword(w, blade_len=1.0, width=0.17, blade=C['steel_hi'], hi=C['white'], guard=C['gold'], guard_w=0.36, grip=C['dark'], grip_len=0.28, grip_bands=4, pommel=C['gold'], pommel_gem=C['purple'], thick=0.055, tip=0.2)
    w.gem((0, -0.07, 0.04), 0.06, C['gold_hi']); w.box((0.16, 0.05, 0.16), (0, 0, 0.04), C['gold'])
    for a in (0.3, 1.0, 1.7, 2.4, 3.1): w.crystal((0, 0, 0.04), (math.cos(a), 0, math.sin(a) * 0.5 + 0.1), 0.13, 0.025, C['gold'], n=4); w.crystal((0, 0, 0.04), (-math.cos(a), 0, math.sin(a) * 0.5 + 0.1), 0.13, 0.025, C['gold'], n=4)
    w.ribbon(-0.02, C['purple']); w.ribbon(-0.02, C['purple'], side=-1)

PACK20 = [
    ('01_Short_Sword', w_short_sword), ('02_Scimitar', w_scimitar), ('03_Longsword', w_longsword), ('04_Greatsword', w_greatsword),
    ('05_Dagger', w_dagger), ('06_Battle_Axe', w_battle_axe), ('07_Greataxe', w_greataxe), ('08_Mace', w_mace), ('09_Warhammer', w_warhammer),
    ('10_Spear', w_spear), ('11_Halberd', w_halberd), ('12_Bow', w_bow), ('13_Crossbow', w_crossbow), ('14_Magic_Staff', w_magic_staff),
    ('15_Wand', w_wand), ('16_Twin_Claws', w_twin_claws), ('17_Flail', w_flail), ('18_Sickle', w_sickle), ('19_Whip', w_whip), ('20_Throwing_Axe', w_throwing_axe),
]
PACK30 = [
    ('01_Rusted_Training_Sword', r_rusted_training_sword), ('02_Ashwood_Club', r_ashwood_club), ('03_Copper_Dagger', r_copper_dagger), ('04_Hunter_Shortbow', r_hunter_shortbow),
    ('05_Iron_Spear', r_iron_spear), ('06_Bronze_War_Axe', r_bronze_war_axe), ('07_Falcon_Scimitar', r_falcon_scimitar), ('08_Guard_Mace', r_guard_mace),
    ('09_Steel_Longsword', r_steel_longsword), ('10_Ranger_Crossbow', r_ranger_crossbow), ('11_Knight_Halberd', r_knight_halberd), ('12_Moonfang_Twin_Daggers', r_moonfang_twin_daggers),
    ('13_Stormcaller_Staff', r_stormcaller_staff), ('14_Ember_Warhammer', r_ember_warhammer), ('15_Serpent_Whip', r_serpent_whip), ('16_Crystal_Greatbow', r_crystal_greatbow),
    ('17_Sunforged_Claymore', r_sunforged_claymore), ('18_Void_Pike', r_void_pike), ('19_Runebound_Flail', r_runebound_flail), ('20_Shadow_Reaver_Scythe', r_shadow_reaver_scythe),
    ('21_Dragonfire_Blade', r_dragonfire_blade), ('22_Frostbite_Maul', r_frostbite_maul), ('23_Phoenix_Talons', r_phoenix_talons), ('24_Leviathan_Trident', r_leviathan_trident),
    ('25_Celestial_Wand', r_celestial_wand), ('26_Kingsguard_Greataxe', r_kingsguard_greataxe), ('27_Arcane_Crescent_Staff', r_arcane_crescent_staff), ('28_Doomspike_Lance', r_doomspike_lance),
    ('29_Worldroot_Glaive', r_worldroot_glaive), ('30_Crownbreaker_Relicblade', r_crownbreaker_relicblade),
]

def build(pack, out):
    out.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    for name, fn in pack:
        if only and not any(o in name for o in only): continue
        w = W(); fn(w); m = w.mesh()
        write_glb(m, out / f'{name}.glb')
        print(f'{name:32s} {len(m.faces):5d} tris')

if __name__ == '__main__':
    build(PACK20, OUT20)
    build(PACK30, OUT30)
