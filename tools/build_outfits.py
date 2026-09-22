#!/usr/bin/env python3
"""Generate the three class starting outfits (skinned, for the modular human).

The wardrobe pack has no fur mantles, hoods, long coats or gowns, so the
starting kits from the class concept sheets are built here: garments are cut
from the human base body itself (a body piece's vertices pushed out along
their normals keep the body's skin weights, so they deform exactly with it),
plus hanging panels (skirts, loincloth, hood, cape) and ornaments (pauldron,
skull boss, studs, circlet) that borrow the weights of the nearest body
vertex. Output goes to client/models/human/items/ as ordinary skinned GLBs
in the pack's format, and outfits.json gains the three outfits.

Run:  <venv>/python tools/build_outfits.py     (numpy, trimesh, pygltflib)
"""
import json, math, struct, sys
from pathlib import Path
import numpy as np
import trimesh
import pygltflib as pg

ROOT = Path(__file__).resolve().parent.parent
HUMAN = ROOT / 'client' / 'models' / 'human'
BASE = HUMAN / 'Human_Male_Modular_Base.glb'
OUT = HUMAN / 'items'

# ---------------------------------------------------------------- colours (sRGB 0..255)
C = {
    'fur_dark': (58, 42, 30), 'fur_brown': (92, 66, 44), 'fur_pale': (150, 130, 105),
    'leather_dark': (52, 36, 26), 'leather': (86, 58, 38), 'leather_red': (120, 40, 34), 'leather_worn': (74, 54, 40),
    'iron': (110, 112, 118), 'iron_dark': (70, 72, 78), 'silver': (196, 200, 208), 'silver_lo': (140, 146, 156),
    'gold': (214, 168, 58), 'gold_hi': (240, 206, 110), 'bone': (222, 212, 186), 'skin_dark': (150, 110, 84),
    'cloth_dark': (34, 44, 40), 'cloth_maroon': (86, 28, 44), 'cloth_maroon_hi': (112, 40, 58), 'cloth_ivory': (232, 226, 210),
    'cloth_white': (244, 240, 232), 'cloth_grey': (60, 58, 62), 'cloth_black': (28, 26, 30), 'cloth_cream': (214, 206, 186),
    'blue_gem': (70, 120, 230), 'blue_gem_hi': (150, 190, 255), 'red_cloth': (122, 34, 40),
}
def lin(c): return [((v / 255) / 12.92 if v / 255 <= 0.04045 else ((v / 255 + 0.055) / 1.055) ** 2.4) for v in c] + [1.0]

# ---------------------------------------------------------------- the base body
def readglb(path):
    b = open(path, 'rb').read(); ln = struct.unpack('<I', b[12:16])[0]; js = json.loads(b[20:20 + ln]); off = 20 + ln
    ln2 = struct.unpack('<I', b[off:off + 4])[0]; return js, b[off + 8:off + 8 + ln2]
BJS, BBIN = readglb(BASE)
CT = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = BJS['accessors'][i]; bv = BJS['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = np.dtype(CT[a['componentType']])
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); stride = bv.get('byteStride', n * dt.itemsize)
    return np.array([np.frombuffer(BBIN, dt, n, off + k * stride) for k in range(a['count'])])
PIECES = {}
for m in BJS['meshes']:
    if not m['name'].startswith('Body_'): continue
    p = m['primitives'][0]
    PIECES[m['name']] = dict(pos=acc(p['attributes']['POSITION']).astype(np.float32), nrm=acc(p['attributes']['NORMAL']).astype(np.float32),
                            j=acc(p['attributes']['JOINTS_0']).astype(np.uint16), w=acc(p['attributes']['WEIGHTS_0']).astype(np.float32),
                            idx=acc(p['indices']).reshape(-1, 3).astype(np.uint32))
ALL_POS = np.vstack([p['pos'] for p in PIECES.values()]); ALL_J = np.vstack([p['j'] for p in PIECES.values()]); ALL_W = np.vstack([p['w'] for p in PIECES.values()])
SKIN = BJS['skins'][0]; JOINT_NODES = SKIN['joints']
def joint_index(name): return [BJS['nodes'][j]['name'] for j in JOINT_NODES].index(name)

def nearest_weights(pts):
    """Skin weights borrowed from the nearest body vertex of each point."""
    pts = np.asarray(pts, np.float32); j = np.zeros((len(pts), 4), np.uint16); w = np.zeros((len(pts), 4), np.float32)
    for k in range(0, len(pts), 256):
        d = ((pts[k:k + 256, None, :] - ALL_POS[None, :, :]) ** 2).sum(-1); n = d.argmin(1)
        j[k:k + 256] = ALL_J[n]; w[k:k + 256] = ALL_W[n]
    return j, w
def bone_weights(n, name):
    j = np.zeros((n, 4), np.uint16); w = np.zeros((n, 4), np.float32); j[:, 0] = joint_index(name); w[:, 0] = 1; return j, w

# ---------------------------------------------------------------- a garment under construction
class Garment:
    def __init__(self, name): self.name = name; self.prims = []
    def add(self, pos, nrm, j, w, idx, mat):
        self.prims.append(dict(pos=np.asarray(pos, np.float32), nrm=np.asarray(nrm, np.float32), j=np.asarray(j, np.uint16), w=np.asarray(w, np.float32), idx=np.asarray(idx, np.uint32).reshape(-1, 3), mat=mat))
    # A body piece (or several) pushed out along its normals; `sel(pos)` keeps a
    # subset of vertices (faces with any dropped vertex go). `grow` scales the
    # offset with height so a hem can flare.
    def shell(self, pieces, t, mat, sel=None, jitter=0.0, seed=1):
        rng = np.random.default_rng(seed)
        for name in ([pieces] if isinstance(pieces, str) else pieces):
            P = PIECES[name]; pos, nrm = P['pos'], P['nrm']
            keep = np.ones(len(pos), bool) if sel is None else np.array([bool(sel(p)) for p in pos])
            # the body has split normals along its hard edges; push duplicates of a
            # position along one averaged normal (and the same jitter) so the shell
            # stays closed instead of tearing along every crease
            key = np.round(pos, 4); uniq, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.reshape(-1)
            avg = np.zeros((len(uniq), 3), np.float32); np.add.at(avg, inv, nrm); avg /= np.linalg.norm(avg, axis=1, keepdims=True) + 1e-9
            tt_u = t + (rng.random(len(uniq)) - 0.5) * 2 * jitter if jitter else np.full(len(uniq), t)
            newpos = pos + avg[inv] * tt_u[inv][:, None]
            remap = -np.ones(len(pos), int); remap[keep] = np.arange(keep.sum())
            faces = P['idx']; fk = keep[faces].all(1); faces = remap[faces[fk]]
            if not len(faces): continue
            self.add(newpos[keep], nrm[keep], P['j'][keep], P['w'][keep], faces, mat)
    # Flat-shaded free geometry (a trimesh), weighted from the body.
    def mesh(self, m, mat, bone=None):
        m = m.copy()
        if m.is_watertight and m.volume < 0: m.invert()
        m.unmerge_vertices()
        pos = np.asarray(m.vertices, np.float32); nrm = np.asarray(m.vertex_normals, np.float32)
        j, w = bone_weights(len(pos), bone) if bone else nearest_weights(pos)
        self.add(pos, nrm, j, w, m.faces, mat)
    # A strip of quads between two rings of points (closed rings), flat shaded.
    def strip(self, rings, mat, closed=True, bone=None, double=True):
        rings = [np.asarray(r, np.float32) for r in rings]; tris = []
        n = len(rings[0])
        for a, b in zip(rings[:-1], rings[1:]):
            for i in range(n if closed else n - 1):
                k = (i + 1) % n
                tris += [[a[i], a[k], b[k]], [a[i], b[k], b[i]]]
        tris = np.array(tris, np.float32)
        m = trimesh.Trimesh(tris.reshape(-1, 3), np.arange(len(tris) * 3).reshape(-1, 3), process=False)
        if double: m = trimesh.util.concatenate([m, trimesh.Trimesh(m.vertices, m.faces[:, ::-1], process=False)])
        pos = np.asarray(m.vertices, np.float32); nrm = np.asarray(m.face_normals, np.float32).repeat(3, 0)
        j, w = bone_weights(len(pos), bone) if bone else nearest_weights(pos)
        self.add(pos, nrm, j, w, m.faces, mat)

def ring(cx, cy, cz, rx, rz, n, y_fn=None, r_fn=None, a0=0.0, a1=2 * math.pi):
    out = []
    for i in range(n):
        a = a0 + (a1 - a0) * (i / n if abs(a1 - a0 - 2 * math.pi) < 1e-6 else i / (n - 1))
        k = r_fn(a) if r_fn else 1.0
        y = cy + (y_fn(a) if y_fn else 0)
        out.append((cx + math.sin(a) * rx * k, y, cz + math.cos(a) * rz * k))
    return out
def box(ext, center, color=None, rot=None):
    m = trimesh.creation.box(extents=ext)
    if rot is not None: m.apply_transform(rot)
    m.apply_translation(center); return m
def ball(center, r, sub=1):
    return trimesh.creation.icosphere(subdivisions=sub, radius=r).apply_translation(center)
def cone(base, direction, length, r, n=6):
    d = np.asarray(direction, float); d /= np.linalg.norm(d)
    m = trimesh.creation.cone(radius=r, height=length, sections=n)
    T = trimesh.geometry.align_vectors([0, 0, 1], d); m.apply_transform(T); m.apply_translation(base); return m
def torus(center, R, r, rot=None):
    m = trimesh.creation.torus(major_radius=R, minor_radius=r, major_sections=24, minor_sections=8)
    if rot is not None: m.apply_transform(rot)
    m.apply_translation(center); return m
RX = lambda a: trimesh.transformations.rotation_matrix(a, (1, 0, 0))
RY = lambda a: trimesh.transformations.rotation_matrix(a, (0, 1, 0))
RZ = lambda a: trimesh.transformations.rotation_matrix(a, (0, 0, 1))

# Hip / waist outline of the body at a height: an ellipse that matches Body_Hips.
def hip_ring(y, n=20, pad=0.0, flare=1.0, y_fn=None):
    return ring(0, y, 0, (0.22 + pad) * flare, (0.115 + pad) * flare, n, y_fn=y_fn)

# ---------------------------------------------------------------- the writer
def write_item(g: Garment, hide_body):
    gltf = pg.GLTF2(); buf = bytearray()
    def view(data, target=None):
        data = np.ascontiguousarray(data); off = len(buf); buf.extend(data.tobytes())
        while len(buf) % 4: buf.append(0)
        gltf.bufferViews.append(pg.BufferView(buffer=0, byteOffset=off, byteLength=data.nbytes, target=target)); return len(gltf.bufferViews) - 1
    def accessor(data, ctype, atype, target=None, minmax=False):
        bv = view(data, target); a = pg.Accessor(bufferView=bv, componentType=ctype, count=len(data), type=atype)
        if minmax: a.min = data.min(0).tolist(); a.max = data.max(0).tolist()
        gltf.accessors.append(a); return len(gltf.accessors) - 1
    # joints: copy the base skeleton's node subtree so the file stands on its own
    keep = set(JOINT_NODES); parent = {}
    for i, n in enumerate(BJS['nodes']):
        for c in n.get('children', []): parent[c] = i
    order = sorted(keep); remap = {old: new for new, old in enumerate(order)}
    for old in order:
        n = BJS['nodes'][old]; node = pg.Node(name=n['name'], children=[remap[c] for c in n.get('children', []) if c in keep])
        for k in ('translation', 'rotation', 'scale'):
            if k in n: setattr(node, k, n[k])
        gltf.nodes.append(node)
    ibm = acc(SKIN['inverseBindMatrices']).astype(np.float32)
    ibm_acc = accessor(ibm.reshape(-1, 16), pg.FLOAT, 'MAT4')
    gltf.skins.append(pg.Skin(name='Human_Male_Rig', joints=[remap[j] for j in JOINT_NODES], inverseBindMatrices=ibm_acc))
    prims = []; mats = {}
    for p in g.prims:
        if p['mat'] not in mats:
            gltf.materials.append(pg.Material(name=p['mat'], pbrMetallicRoughness=pg.PbrMetallicRoughness(baseColorFactor=lin(C[p['mat'].split(':')[-1]] if p['mat'] not in C else C[p['mat']]), metallicFactor=0.0, roughnessFactor=0.9)))
            mats[p['mat']] = len(gltf.materials) - 1
        prims.append(pg.Primitive(attributes=pg.Attributes(
            POSITION=accessor(p['pos'], pg.FLOAT, 'VEC3', pg.ARRAY_BUFFER, True), NORMAL=accessor(p['nrm'], pg.FLOAT, 'VEC3', pg.ARRAY_BUFFER),
            JOINTS_0=accessor(p['j'], pg.UNSIGNED_SHORT, 'VEC4', pg.ARRAY_BUFFER), WEIGHTS_0=accessor(p['w'], pg.FLOAT, 'VEC4', pg.ARRAY_BUFFER)),
            indices=accessor(p['idx'].reshape(-1).astype(np.uint32), pg.UNSIGNED_INT, 'SCALAR', pg.ELEMENT_ARRAY_BUFFER), material=mats[p['mat']]))
    gltf.meshes.append(pg.Mesh(name=g.name, primitives=prims))
    root_joint = remap[JOINT_NODES[0]]
    gltf.nodes.append(pg.Node(name=g.name, mesh=0, skin=0)); mesh_node = len(gltf.nodes) - 1
    gltf.nodes.append(pg.Node(name='Human_Male_Rig', children=[root_joint, mesh_node])); rig = len(gltf.nodes) - 1
    gltf.scenes.append(pg.Scene(nodes=[rig])); gltf.scene = 0
    gltf.buffers.append(pg.Buffer(byteLength=len(buf)))
    gltf.set_binary_blob(bytes(buf))
    gltf.save(OUT / f'{g.name}.glb')
    tris = sum(len(p['idx']) for p in g.prims); verts = sum(len(p['pos']) for p in g.prims)
    print(f'{g.name:34s} {tris:5d} tris {verts:5d} verts')
    return dict(id=g.name, file=f'Items/{g.name}.glb', hide_body=hide_body, triangles=int(tris), vertices=int(verts))

# ---------------------------------------------------------------- shared bits
ARMS = ['Body_Upperarm_L', 'Body_Upperarm_R', 'Body_Forearm_L', 'Body_Forearm_R']
LEGS = ['Body_Thigh_L', 'Body_Thigh_R', 'Body_Shin_L', 'Body_Shin_R']
FEET = ['Body_Foot_L', 'Body_Foot_R']
def belt(g, mat, y0=0.94, y1=1.02, t=0.02):
    g.shell(['Body_Hips', 'Body_Torso'], t, mat, sel=lambda p: y0 <= p[1] <= y1)
def bracers(g, mat, t=0.02, sel=None):
    g.shell(['Body_Forearm_L', 'Body_Forearm_R'], t, mat, sel=sel)
def boots(g, mat, top=0.42, t=0.02):
    g.shell(FEET, t, mat); g.shell(['Body_Shin_L', 'Body_Shin_R'], t, mat, sel=lambda p: p[1] <= top)
def studs(g, pts, r, mat):
    for p in pts: g.mesh(ball(p, r, 0), mat)
# Hanging panels round the hips: `n` strips each spanning arc [a0,a1], from the
# waist ring down to `bottom`, flaring out; the hem can be ragged.
def skirt(g, mat, y_top, y_bot, pad=0.03, flare=1.35, arcs=((0, 2 * math.pi),), segs=24, rag=0.0, seed=3, rows=3, front_gap=0.0):
    rng = np.random.default_rng(seed)
    for a0, a1 in arcs:
        rings = []
        for r in range(rows + 1):
            u = r / rows; y = y_top + (y_bot - y_top) * u
            def yf(a, u=u): return (rng.random() - 0.5) * rag if (u >= 1 and rag) else 0
            rings.append(ring(0, y, 0, (0.22 + pad) * (1 + (flare - 1) * u), (0.115 + pad) * (1 + (flare - 1) * u), segs, y_fn=yf, a0=a0, a1=a1))
        g.strip(rings, mat, closed=abs(a1 - a0 - 2 * math.pi) < 1e-6)

# ---------------------------------------------------------------- FIGHTER: the barbarian
def fighter():
    items = []
    # Top: leather cross-straps over a bare chest, a round iron boss where they meet.
    g = Garment('32_Barbarian__Top')
    for sgn in (1, -1):
        g.shell('Body_Torso', 0.018, 'leather_dark', sel=lambda p, s=sgn: abs((p[0] * s * 0.62 + (p[1] - 1.26) * 0.78)) < 0.03 and p[1] > 1.06 and abs(p[2]) > 0.02)
    g.mesh(ball((0, 1.27, 0.125), 0.045, 1), 'iron'); g.mesh(ball((0, 1.27, 0.15), 0.02, 1), 'iron_dark')
    for p in [(0.11, 1.4, 0.11), (-0.11, 1.4, 0.11), (0.14, 1.12, 0.1), (-0.14, 1.12, 0.1)]: g.mesh(ball(p, 0.014, 0), 'iron_dark')
    items.append(write_item(g, []))
    # Accessory: the fur mantle over the shoulders and upper back, ragged hem, and a
    # spiked iron pauldron on the left shoulder.
    g = Garment('32_Barbarian__Accessory')
    g.shell('Body_Torso', 0.07, 'fur_dark', sel=lambda p: p[1] > 1.24 - abs(p[0]) * 0.3 and not (p[2] > 0.04 and abs(p[0]) < 0.11 and p[1] < 1.42), jitter=0.03)
    g.shell('Body_Torso', 0.05, 'fur_brown', sel=lambda p: p[1] > 1.36 and p[2] < 0, jitter=0.02, seed=4)
    g.shell(['Body_Upperarm_L', 'Body_Upperarm_R'], 0.065, 'fur_dark', sel=lambda p: abs(p[0]) < 0.46 and p[1] > 1.26, jitter=0.03)
    g.shell('Body_Head_Neck', 0.05, 'fur_brown', sel=lambda p: p[1] < 1.52 and p[2] < 0.07, jitter=0.02)
    # pauldron: a domed plate on the left shoulder with three horn spikes
    dome = trimesh.creation.icosphere(subdivisions=2, radius=0.16); dome.apply_transform(np.diag([1.0, 0.7, 1.0, 1.0]))
    dome = dome.slice_plane([0, 0, 0], [0, 1, 0]); dome.apply_translation((0.34, 1.37, 0.0)); g.mesh(dome, 'iron', bone='UpperArm.L')
    g.mesh(torus((0.34, 1.375, 0), 0.155, 0.014, RX(math.pi / 2)), 'iron_dark', bone='UpperArm.L')
    for p in [(0.34 + math.cos(a) * 0.11, 1.44, math.sin(a) * 0.11) for a in np.linspace(0, 2 * math.pi, 6, endpoint=False)]: g.mesh(ball(p, 0.012, 0), 'iron_dark', bone='UpperArm.L')
    for (bx, bz, dx, dz) in [(0.40, 0.0, 0.6, 0), (0.32, 0.09, 0.2, 0.6), (0.32, -0.09, 0.2, -0.6)]:
        g.mesh(cone((bx, 1.46, bz), (dx, 1.0, dz), 0.14, 0.03), 'bone', bone='UpperArm.L')
    items.append(write_item(g, []))
    # Gloves: studded leather bracers.
    g = Garment('32_Barbarian__Gloves')
    bracers(g, 'leather', 0.022, sel=lambda p: abs(p[0]) < 0.78)
    pts = [(sx * x, 1.31, z) for sx in (1, -1) for x in (0.6, 0.66, 0.72) for z in (0.0,)] + [(sx * x, 1.22, 0.065) for sx in (1, -1) for x in (0.6, 0.66, 0.72)]
    studs(g, pts, 0.011, 'iron')
    items.append(write_item(g, []))
    # Trousers: dark hide legs, a red loincloth front and back, a hide tasset strip each side.
    g = Garment('32_Barbarian__Trousers')
    g.shell(LEGS, 0.012, 'leather_dark'); g.shell('Body_Hips', 0.012, 'leather_dark')
    skirt(g, 'red_cloth', 0.98, 0.58, pad=0.035, flare=1.15, arcs=((-0.7, 0.7), (math.pi - 0.7, math.pi + 0.7)), segs=9, rag=0.07, seed=5)
    skirt(g, 'leather_worn', 0.98, 0.7, pad=0.045, flare=1.2, arcs=((math.pi / 2 - 0.4, math.pi / 2 + 0.4), (-math.pi / 2 - 0.4, -math.pi / 2 + 0.4)), segs=5, rag=0.05, seed=6)
    items.append(write_item(g, ['Body_Hips', 'Body_Thigh_L', 'Body_Thigh_R', 'Body_Shin_L', 'Body_Shin_R']))
    # Belt: a wide studded belt with a skull boss.
    g = Garment('32_Barbarian__Belt')
    belt(g, 'leather', 0.93, 1.03, 0.025)
    skull = ball((0, 0.985, 0.155), 0.045, 1); skull.apply_transform(np.diag([1, 1.1, 0.8, 1])); g.mesh(skull, 'bone', bone='Pelvis')
    for sx in (1, -1): g.mesh(ball((sx * 0.018, 0.99, 0.19), 0.012, 0), 'iron_dark', bone='Pelvis')
    studs(g, [(math.sin(a) * 0.245, 0.985, math.cos(a) * 0.14) for a in np.linspace(0.6, 2 * math.pi - 0.6, 9)], 0.012, 'iron')
    for sx in (1, -1): g.mesh(cone((sx * 0.2, 0.92, 0.06), (0, -1, 0), 0.12, 0.02, 4), 'bone', bone='Pelvis')   # a bone toggle either side
    items.append(write_item(g, []))
    # Boots: dark hide with fur cuffs and strap buckles.
    g = Garment('32_Barbarian__Boots')
    boots(g, 'leather_dark', top=0.5, t=0.02)
    g.shell(['Body_Shin_L', 'Body_Shin_R'], 0.045, 'fur_brown', sel=lambda p: 0.44 <= p[1] <= 0.54, jitter=0.015, seed=8)
    studs(g, [(sx * 0.13, y, 0.1) for sx in (1, -1) for y in (0.3, 0.38)], 0.012, 'iron')
    items.append(write_item(g, ['Body_Foot_L', 'Body_Foot_R']))
    return dict(id='32_Barbarian', cut='harness', accessory='fur_mantle', items=[dict(it, slot=s) for it, s in zip(items, ['Top', 'Accessory', 'Gloves', 'Trousers', 'Belt', 'Boots'])])

# ---------------------------------------------------------------- BARD: the minstrel's coat
def bard():
    items = []
    # Top: a dark long coat — sleeves, body, gold-edged lapels, a maroon shirt at the throat, coat skirts to the knee split at the front.
    g = Garment('33_Minstrel__Top')
    g.shell('Body_Torso', 0.02, 'cloth_dark'); g.shell(ARMS, 0.018, 'cloth_dark')
    g.shell('Body_Torso', 0.026, 'cloth_maroon', sel=lambda p: p[2] > 0.02 and abs(p[0]) < 0.09 and 1.3 < p[1] < 1.5)      # the shirt at the throat
    g.shell('Body_Torso', 0.024, 'gold', sel=lambda p: p[2] > 0.03 and 0.07 < abs(p[0]) < 0.13 and 1.22 < p[1] < 1.48)   # lapel edging
    g.shell(['Body_Forearm_L', 'Body_Forearm_R'], 0.022, 'gold', sel=lambda p: abs(p[0]) > 0.76)                        # cuffs
    skirt(g, 'cloth_dark', 1.0, 0.56, pad=0.03, flare=1.3, arcs=((0.12, math.pi - 0.15), (math.pi + 0.15, 2 * math.pi - 0.12)), segs=12, seed=11)
    skirt(g, 'gold', 0.58, 0.55, pad=0.03 + 0.008, flare=1.3, arcs=((0.12, math.pi - 0.15), (math.pi + 0.15, 2 * math.pi - 0.12)), segs=12, rows=1, seed=12)
    items.append(write_item(g, ['Body_Torso', 'Body_Upperarm_L', 'Body_Upperarm_R', 'Body_Forearm_L', 'Body_Forearm_R']))
    # Accessory: the maroon hooded mantle over the shoulders, the hood hanging down the back, a gold clasp.
    g = Garment('33_Minstrel__Accessory')
    g.shell('Body_Torso', 0.045, 'cloth_maroon', sel=lambda p: p[1] > 1.33 - abs(p[0]) * 0.15 and not (p[2] > 0.05 and abs(p[0]) < 0.08))
    g.shell(['Body_Upperarm_L', 'Body_Upperarm_R'], 0.04, 'cloth_maroon', sel=lambda p: abs(p[0]) < 0.37 and p[1] > 1.3)
    g.shell('Body_Torso', 0.05, 'gold', sel=lambda p: 1.29 < p[1] < 1.32 and not (p[2] > 0.05 and abs(p[0]) < 0.1))   # gold hem of the mantle
    # the hood: a soft pouch behind the neck and head, pointed at the bottom
    hood = [ring(0, 1.62, -0.06, 0.16, 0.10, 12, a0=math.pi * 0.35, a1=math.pi * 1.65),
            ring(0, 1.5, -0.12, 0.17, 0.11, 12, a0=math.pi * 0.35, a1=math.pi * 1.65),
            ring(0, 1.36, -0.16, 0.13, 0.08, 12, a0=math.pi * 0.35, a1=math.pi * 1.65),
            ring(0, 1.24, -0.19, 0.03, 0.02, 12, a0=math.pi * 0.35, a1=math.pi * 1.65)]
    g.strip(hood, 'cloth_maroon', closed=False)
    g.mesh(ball((0, 1.43, 0.13), 0.022, 1), 'gold'); g.mesh(ball((0, 1.43, 0.15), 0.011, 0), 'blue_gem')
    items.append(write_item(g, []))
    # Gloves: tooled leather bracers with a gold line.
    g = Garment('33_Minstrel__Gloves')
    bracers(g, 'leather', 0.02, sel=lambda p: abs(p[0]) < 0.76)
    bracers(g, 'gold', 0.024, sel=lambda p: 0.63 < abs(p[0]) < 0.65)
    items.append(write_item(g, []))
    # Trousers: dark grey hose.
    g = Garment('33_Minstrel__Trousers'); g.shell(LEGS, 0.012, 'cloth_grey'); g.shell('Body_Hips', 0.012, 'cloth_grey')
    items.append(write_item(g, ['Body_Hips', 'Body_Thigh_L', 'Body_Thigh_R', 'Body_Shin_L', 'Body_Shin_R']))
    # Belt: a brown belt with a brass buckle, a songbook on the left hip, a scroll case on the right.
    g = Garment('33_Minstrel__Belt')
    belt(g, 'leather', 0.95, 1.01, 0.024); g.mesh(box((0.05, 0.05, 0.02), (0, 0.98, 0.14)), 'gold', bone='Pelvis')
    g.mesh(box((0.09, 0.11, 0.035), (0.2, 0.9, 0.06), rot=RY(0.4)), 'leather_red', bone='Pelvis'); g.mesh(box((0.08, 0.1, 0.006), (0.2, 0.9, 0.08), rot=RY(0.4)), 'gold', bone='Pelvis')
    g.mesh(trimesh.creation.cylinder(radius=0.02, height=0.16, sections=8).apply_transform(RZ(0.3)).apply_translation((-0.22, 0.86, 0.02)), 'leather_worn', bone='Pelvis')
    items.append(write_item(g, []))
    # Boots: brown leather to below the knee, folded tops, brass buckles.
    g = Garment('33_Minstrel__Boots')
    boots(g, 'leather', top=0.5, t=0.02); g.shell(['Body_Shin_L', 'Body_Shin_R'], 0.032, 'leather_worn', sel=lambda p: 0.45 <= p[1] <= 0.53)
    studs(g, [(sx * 0.14, y, 0.095) for sx in (1, -1) for y in (0.28, 0.36, 0.44)], 0.011, 'gold')
    items.append(write_item(g, ['Body_Foot_L', 'Body_Foot_R']))
    return dict(id='33_Minstrel', cut='longcoat', accessory='hood', items=[dict(it, slot=s) for it, s in zip(items, ['Top', 'Accessory', 'Gloves', 'Trousers', 'Belt', 'Boots'])])

# ---------------------------------------------------------------- CLERIC: the white-and-gold vestments
def cleric():
    items = []
    # Top: a white high-collared coat with silver pauldrons and a gold sun at the breast; gold seams.
    g = Garment('34_Templar__Top')
    g.shell('Body_Torso', 0.02, 'cloth_white'); g.shell(ARMS, 0.018, 'cloth_white')
    g.shell('Body_Head_Neck', 0.03, 'cloth_white', sel=lambda p: p[1] < 1.52)                                            # the standing collar
    g.shell('Body_Torso', 0.024, 'gold', sel=lambda p: p[2] > 0.03 and abs(p[0]) < 0.025 and 1.05 < p[1] < 1.44)      # centre seam
    g.shell(['Body_Upperarm_L', 'Body_Upperarm_R'], 0.03, 'silver', sel=lambda p: abs(p[0]) < 0.36 and p[1] > 1.3)      # pauldrons
    g.shell(['Body_Upperarm_L', 'Body_Upperarm_R'], 0.034, 'gold', sel=lambda p: 0.34 < abs(p[0]) < 0.37 and p[1] > 1.3)
    g.shell(['Body_Forearm_L', 'Body_Forearm_R'], 0.024, 'silver', sel=lambda p: abs(p[0]) > 0.7)                        # vambraces
    g.mesh(torus((0, 1.3, 0.13), 0.045, 0.008, RX(math.pi / 2)), 'gold'); g.mesh(ball((0, 1.3, 0.13), 0.02, 1), 'blue_gem')
    for a in np.linspace(0, 2 * math.pi, 8, endpoint=False): g.mesh(cone((math.sin(a) * 0.05, 1.3 + math.cos(a) * 0.05, 0.125), (math.sin(a), math.cos(a), 0), 0.035, 0.008, 4), 'gold')
    items.append(write_item(g, ['Body_Torso', 'Body_Upperarm_L', 'Body_Upperarm_R', 'Body_Forearm_L', 'Body_Forearm_R']))
    # Trousers: the gown — a long ivory skirt to the ankle with a gold hem, over dark hose.
    g = Garment('34_Templar__Trousers')
    g.shell(LEGS, 0.012, 'cloth_grey'); g.shell('Body_Hips', 0.012, 'cloth_ivory')
    skirt(g, 'cloth_ivory', 1.0, 0.16, pad=0.03, flare=1.9, segs=24, rows=4, seed=21)
    skirt(g, 'gold', 0.2, 0.15, pad=0.038, flare=1.9, segs=24, rows=1, seed=22)
    skirt(g, 'gold', 1.0, 0.16, pad=0.036, flare=1.9, arcs=((-0.04, 0.04),), segs=3, rows=4, seed=23)   # a gold line down the front
    items.append(write_item(g, ['Body_Hips', 'Body_Thigh_L', 'Body_Thigh_R', 'Body_Shin_L', 'Body_Shin_R']))
    # Belt: brown leather with a gold sun buckle and a pouch.
    g = Garment('34_Templar__Belt')
    belt(g, 'leather', 0.95, 1.01, 0.024); g.mesh(torus((0, 0.98, 0.14), 0.03, 0.008, RX(math.pi / 2)), 'gold', bone='Pelvis'); g.mesh(ball((0, 0.98, 0.14), 0.013, 0), 'blue_gem', bone='Pelvis')
    g.mesh(box((0.08, 0.09, 0.05), (0.17, 0.9, 0.09), rot=RY(0.3)), 'leather', bone='Pelvis'); g.mesh(box((0.085, 0.035, 0.055), (0.17, 0.935, 0.09), rot=RY(0.3)), 'leather_worn', bone='Pelvis')
    items.append(write_item(g, []))
    # Gloves: white gloves with a gold line.
    g = Garment('34_Templar__Gloves')
    bracers(g, 'cloth_white', 0.02, sel=lambda p: abs(p[0]) < 0.72); bracers(g, 'gold', 0.024, sel=lambda p: 0.66 < abs(p[0]) < 0.68)
    items.append(write_item(g, []))
    # Boots: silver with gold trim.
    g = Garment('34_Templar__Boots')
    boots(g, 'silver', top=0.46, t=0.02); g.shell(['Body_Shin_L', 'Body_Shin_R'], 0.026, 'gold', sel=lambda p: 0.43 <= p[1] <= 0.47)
    items.append(write_item(g, ['Body_Foot_L', 'Body_Foot_R']))
    # Accessory: a gold circlet with a gem at the brow, and a white half-cape down the back.
    g = Garment('34_Templar__Accessory')
    g.mesh(torus((0, 1.79, 0.0), 0.128, 0.008, RX(math.pi / 2)), 'gold', bone='Head'); g.mesh(ball((0, 1.79, 0.128), 0.014, 1), 'blue_gem', bone='Head')
    cape = [ring(0, 1.4, -0.04, 0.22, 0.13, 10, a0=math.pi * 0.6, a1=math.pi * 1.4), ring(0, 1.1, -0.06, 0.24, 0.14, 10, a0=math.pi * 0.6, a1=math.pi * 1.4),
            ring(0, 0.8, -0.06, 0.25, 0.15, 10, a0=math.pi * 0.6, a1=math.pi * 1.4), ring(0, 0.5, -0.06, 0.26, 0.16, 10, a0=math.pi * 0.6, a1=math.pi * 1.4)]
    g.strip(cape, 'cloth_ivory', closed=False)
    g.strip([ring(0, 0.5, -0.06, 0.262, 0.162, 10, a0=math.pi * 0.6, a1=math.pi * 1.4), ring(0, 0.47, -0.06, 0.262, 0.162, 10, a0=math.pi * 0.6, a1=math.pi * 1.4)], 'gold', closed=False)
    items.append(write_item(g, []))
    return dict(id='34_Templar', cut='vestments', accessory='circlet_cape', items=[dict(it, slot=s) for it, s in zip(items, ['Top', 'Trousers', 'Belt', 'Gloves', 'Boots', 'Accessory'])])

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    outfits = [fighter(), bard(), cleric()]
    mf = json.load(open(HUMAN / 'outfits.json'))
    mf['outfits'] = [o for o in mf['outfits'] if o['id'] not in {x['id'] for x in outfits}] + outfits
    json.dump(mf, open(HUMAN / 'outfits.json', 'w'), indent=2)
    print('outfits.json ->', [o['id'] for o in mf['outfits']][-3:])

if __name__ == '__main__':
    main()
