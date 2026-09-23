#!/usr/bin/env python3
"""Build the game's hair: one skinned GLB holding every style.

The wardrobe covers everything a character wears but not what grows on their
head, so hair is cut here from the base body itself. A style starts as the
scalp — the head's own triangles above a hairline — pushed out along its
welded normals, which keeps the body's skin weights and so deforms exactly
with the head. Anything that hangs (a tail, a bun, braids, a mohawk ridge) is
added as free geometry weighted to the Head bone.

Everything is one flat-shaded material (`MAT_Hair`, near-white) so the client
can tint a style to any hair colour, the same way it tints skin.

Run:  <venv>/python tools/build_hair.py        (numpy + pygltflib)
Writes client/models/human/Hair.glb — meshes named Hair_<Style> / Beard_<Style>
— and hair.json listing the styles for the client and the character card.
"""
import json, math, struct
from pathlib import Path
import numpy as np
import pygltflib as pg

ROOT = Path(__file__).resolve().parent.parent
HUMAN = ROOT / 'client' / 'models' / 'human'
BASE = HUMAN / 'Male_Base.glb'
OUT = HUMAN / 'Hair.glb'

# ---------------------------------------------------------------- the base body
def readglb(path):
    b = open(path, 'rb').read(); ln = struct.unpack('<I', b[12:16])[0]
    js = json.loads(b[20:20 + ln]); off = 20 + ln
    ln2 = struct.unpack('<I', b[off:off + 4])[0]
    return js, b[off + 8:off + 8 + ln2]

BJS, BBIN = readglb(BASE)
CT = {5121: 'B', 5123: 'H', 5125: 'I', 5126: 'f'}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def acc(i):
    a = BJS['accessors'][i]; bv = BJS['bufferViews'][a['bufferView']]
    n = NC[a['type']]; dt = np.dtype(CT[a['componentType']])
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', n * dt.itemsize)
    return np.array([np.frombuffer(BBIN, dt, n, off + k * stride) for k in range(a['count'])])

BODY = [m for m in BJS['meshes'] if m['name'] == 'Body'][0]['primitives'][0]
POS = acc(BODY['attributes']['POSITION']).astype(np.float32)
NRM = acc(BODY['attributes']['NORMAL']).astype(np.float32)
JNT = acc(BODY['attributes']['JOINTS_0']).astype(np.uint16)
WGT = acc(BODY['attributes']['WEIGHTS_0']).astype(np.float32)
IDX = acc(BODY['indices']).reshape(-1, 3).astype(np.uint32)
SKIN = BJS['skins'][0]
JOINT_NODES = SKIN['joints']
JOINT_NAMES = [BJS['nodes'][j]['name'] for j in JOINT_NODES]
HEAD = JOINT_NAMES.index('Head')

# The head, measured rather than assumed: the face looks down +Z, the skull
# tops out a little over two metres, the ears sit at ±x.
JAW = JOINT_NAMES.index('Jaw')
DOM = JNT[np.arange(len(JNT)), WGT.argmax(1)]
SCALP = DOM == HEAD
FACE = (DOM == HEAD) | (DOM == JAW)     # a beard grows on the jaw, which is its own bone
HEAD_TOP = float(POS[SCALP][:, 1].max())          # ~2.02
HEAD_W = float(np.abs(POS[SCALP][:, 0]).max())    # ~0.105
BROW = 1.915                                       # the eyebrows' height
BACK = float(POS[SCALP][:, 2].min())               # ~-0.128
FRONT = float(POS[SCALP][:, 2].max())              # ~0.113
HEAD_MID = np.array([0.0, (HEAD_TOP + BROW) / 2, (BACK + FRONT) / 2], np.float32)

# Welded normals: the body has split normals along its hard edges, so a shell
# pushed along the raw ones tears at every crease.
KEY = np.round(POS, 4)
UNIQ, INV = np.unique(KEY, axis=0, return_inverse=True)
INV = INV.reshape(-1)
AVG = np.zeros((len(UNIQ), 3), np.float32)
np.add.at(AVG, INV, NRM)
AVG /= np.linalg.norm(AVG, axis=1, keepdims=True) + 1e-9


class Style:
    """One hairstyle under construction: a list of flat-shaded primitives."""
    def __init__(self, name):
        self.name = name; self.prims = []

    def add(self, pos, nrm, j, w, idx):
        if not len(idx): return
        self.prims.append(dict(pos=np.asarray(pos, np.float32), nrm=np.asarray(nrm, np.float32),
                               j=np.asarray(j, np.uint16), w=np.asarray(w, np.float32),
                               idx=np.asarray(idx, np.uint32).reshape(-1, 3)))

    def scalp(self, keep_fn, t=0.012, jitter=0.0, seed=1, lift=0.0, on=None):
        """The head's own triangles above a hairline, pushed out along the
        welded normals so the cap sits on the skull and moves with it. `on`
        picks which vertices are eligible — the scalp, or the whole face for a
        beard (the jaw is its own bone)."""
        rng = np.random.default_rng(seed)
        src = SCALP if on is None else on
        keep = np.array([src[i] and bool(keep_fn(POS[i])) for i in range(len(POS))])
        if not keep.any(): return
        tt = t + (rng.random(len(UNIQ)) - 0.5) * 2 * jitter if jitter else np.full(len(UNIQ), t)
        newpos = POS + AVG[INV] * tt[INV][:, None]
        if lift: newpos = newpos + np.array([0, lift, 0], np.float32) * np.clip((POS[:, 1] - BROW) / (HEAD_TOP - BROW), 0, 1)[:, None]
        remap = -np.ones(len(POS), int); remap[keep] = np.arange(keep.sum())
        fk = keep[IDX].all(1)
        faces = remap[IDX[fk]]
        self.add(newpos[keep], NRM[keep], JNT[keep], WGT[keep], faces)

    def solid(self, verts, faces):
        """Free geometry (a tail, a bun, a ridge) hung off the head bone."""
        verts = np.asarray(verts, np.float32); faces = np.asarray(faces, np.uint32).reshape(-1, 3)
        # flat shading: every triangle gets its own three vertices
        tri = verts[faces]
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        pos = tri.reshape(-1, 3); nrm = np.repeat(n, 3, axis=0)
        j = np.zeros((len(pos), 4), np.uint16); w = np.zeros((len(pos), 4), np.float32)
        j[:, 0] = HEAD; w[:, 0] = 1
        self.add(pos, nrm, j, w, np.arange(len(pos)).reshape(-1, 3))

    def tube(self, path, radii, sides=6, twist=0.0):
        """A tapered tube along a path of points — a tail, a braid, a lock."""
        path = np.asarray(path, np.float32); rings = []
        for k, (c, r) in enumerate(zip(path, radii)):
            d = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)])
            d /= np.linalg.norm(d) + 1e-9
            up = np.array([0, 0, 1], np.float32) if abs(d[1]) > 0.9 else np.array([0, 1, 0], np.float32)
            u = np.cross(d, up); u /= np.linalg.norm(u) + 1e-9
            v = np.cross(d, u)
            ring = [c + (math.cos(a) * u + math.sin(a) * v) * r
                    for a in (2 * math.pi * i / sides + twist * k for i in range(sides))]
            rings.append(ring)
        verts, faces = [], []
        for a, b in zip(rings[:-1], rings[1:]):
            base = len(verts); verts.extend(a); verts.extend(b)
            for i in range(sides):
                k = (i + 1) % sides
                faces.append([base + i, base + k, base + sides + k])
                faces.append([base + i, base + sides + k, base + sides + i])
        # cap the far end so a tail isn't hollow
        base = len(verts); verts.extend(rings[-1]); c = np.mean(rings[-1], axis=0); verts.append(c)
        for i in range(sides):
            faces.append([base + i, base + (i + 1) % sides, len(verts) - 1])
        self.solid(verts, faces)

    def blob(self, centre, r, squash=(1.0, 1.0, 1.0), rings=5, seg=8):
        """A rough ball — a bun, or the volume of a curl."""
        c = np.asarray(centre, np.float32); verts = [c + np.array([0, r * squash[1], 0])]
        for i in range(1, rings):
            phi = math.pi * i / rings
            for k in range(seg):
                th = 2 * math.pi * k / seg
                verts.append(c + np.array([math.sin(phi) * math.cos(th) * r * squash[0],
                                           math.cos(phi) * r * squash[1],
                                           math.sin(phi) * math.sin(th) * r * squash[2]], np.float32))
        verts.append(c - np.array([0, r * squash[1], 0]))
        faces = []
        for k in range(seg):
            faces.append([0, 1 + (k + 1) % seg, 1 + k])
        for i in range(rings - 2):
            a, b = 1 + i * seg, 1 + (i + 1) * seg
            for k in range(seg):
                kk = (k + 1) % seg
                faces.append([a + k, a + kk, b + kk]); faces.append([a + k, b + kk, b + k])
        last = 1 + (rings - 2) * seg
        for k in range(seg):
            faces.append([last + k, last + (k + 1) % seg, len(verts) - 1])
        self.solid(verts, faces)


# ---------------------------------------------------------------- hairlines
# A hairline is "how high does the hair start" at a point on the skull: high
# across the brow, lower at the back of the neck, with the ears left clear.
def hairline(front, back, temple=None, peak=0.0):
    temple = front if temple is None else temple
    def keep(p):
        x, y, z = p
        u = np.clip((z - BACK) / (FRONT - BACK), 0, 1)          # 0 back .. 1 front
        side = np.clip(abs(x) / HEAD_W, 0, 1)
        line = back + (front - back) * (u ** 1.4)
        line += (temple - front) * side * u                      # temples can sit higher
        if peak and u > 0.75:                                    # a widow's peak dips at the centre
            line -= peak * (1 - side) * (u - 0.75) / 0.25
        return y >= line
    return keep


STYLES = {}
def style(name):
    s = Style(name); STYLES[name] = s; return s

# --- short and tidy -------------------------------------------------------
s = style('Hair_Crop')
s.scalp(hairline(front=1.945, back=1.815), t=0.010)

s = style('Hair_Swept')
s.scalp(hairline(front=1.955, back=1.800), t=0.016, lift=0.012)

s = style('Hair_Bowl')
s.scalp(hairline(front=1.905, back=1.800, temple=1.880), t=0.018)

s = style('Hair_Receding')
s.scalp(hairline(front=1.985, back=1.805, temple=2.000, peak=0.045), t=0.011)

s = style('Hair_Undercut')
s.scalp(hairline(front=1.940, back=1.900, temple=1.965), t=0.017)

# --- volume ---------------------------------------------------------------
s = style('Hair_Curls')
s.scalp(hairline(front=1.935, back=1.795), t=0.024, jitter=0.009, seed=4)

s = style('Hair_Afro')
s.scalp(hairline(front=1.940, back=1.800), t=0.035, jitter=0.010, seed=7)
for c, r in [((0, 2.020, -0.010), 0.062), ((0.070, 1.975, -0.020), 0.052), ((-0.070, 1.975, -0.020), 0.052),
             ((0, 1.975, -0.105), 0.055), ((0.050, 1.990, 0.045), 0.045), ((-0.050, 1.990, 0.045), 0.045)]:
    s.blob(c, r, squash=(1.0, 0.9, 1.0), rings=4, seg=7)

s = style('Hair_Mane')       # long, loose, falls past the jaw
s.scalp(hairline(front=1.930, back=1.760), t=0.020, jitter=0.004, seed=11)
for sgn in (-1, 1):
    s.tube([(sgn * 0.085, 1.86, -0.02), (sgn * 0.096, 1.77, -0.03), (sgn * 0.096, 1.68, -0.03), (sgn * 0.090, 1.60, -0.02)],
           [0.045, 0.049, 0.045, 0.034], sides=6)
s.tube([(0, 1.83, -0.115), (0, 1.73, -0.125), (0, 1.63, -0.120), (0, 1.55, -0.105)], [0.075, 0.080, 0.070, 0.050], sides=8)

# --- tied back ------------------------------------------------------------
s = style('Hair_Ponytail')
s.scalp(hairline(front=1.945, back=1.815), t=0.012)
s.blob((0, 1.905, -0.128), 0.030, squash=(1.0, 0.8, 0.9))       # the gather at the crown
s.tube([(0, 1.895, -0.140), (0, 1.830, -0.175), (0, 1.740, -0.185), (0, 1.640, -0.170), (0, 1.565, -0.145)],
       [0.030, 0.034, 0.031, 0.024, 0.012], sides=6)

s = style('Hair_Topknot')
s.scalp(hairline(front=1.950, back=1.835), t=0.011)
s.blob((0, 2.055, -0.045), 0.042, squash=(1.0, 0.85, 1.0))

s = style('Hair_Braids')
s.scalp(hairline(front=1.940, back=1.820), t=0.012)
for sgn in (-1, 1):
    s.tube([(sgn * 0.088, 1.890, -0.030), (sgn * 0.102, 1.810, -0.020), (sgn * 0.104, 1.720, 0.000), (sgn * 0.100, 1.640, 0.015)],
           [0.024, 0.027, 0.023, 0.012], sides=5, twist=0.55)

s = style('Hair_Mohawk')
s.scalp(hairline(front=1.990, back=1.950), t=0.005)   # shaved down to stubble either side
# the crest: a row of blades along the midline, tallest over the crown
CREST = [(0.055, 1.985), (0.030, 2.010), (0.000, 2.022), (-0.035, 2.018), (-0.070, 2.000), (-0.100, 1.960)]
for k, (z, y) in enumerate(CREST):
    h = 0.075 * math.sin(math.pi * (k + 0.6) / (len(CREST) + 0.2)) + 0.025
    w, d = 0.018, 0.026
    s.solid([(-w, y - 0.01, z - d), (w, y - 0.01, z - d), (w, y - 0.01, z + d), (-w, y - 0.01, z + d),
             (-w * 0.35, y + h, z - d * 0.5), (w * 0.35, y + h, z - d * 0.5),
             (w * 0.35, y + h, z + d * 0.5), (-w * 0.35, y + h, z + d * 0.5)],
            [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0]])

# --- beards ---------------------------------------------------------------
def jawline(top, chin_only=False, width=1.0, mouth=True):
    def keep(p):
        x, y, z = p
        if y > top or y < 1.700: return False
        if z < -0.030: return False                     # nothing on the back of the neck
        # leave the mouth clear: it sits around y 1.80 at the front of the face
        if mouth and z > 0.070 and 1.792 <= y <= 1.812 and abs(x) < 0.030: return False
        if chin_only and (abs(x) > 0.045 or z < 0.040): return False
        return abs(x) <= HEAD_W * width
    return keep

# The jaw is only a handful of vertices, so a beard is the shell plus a little
# built mass on the chin — otherwise it comes out patchy and lopsided.
def chin(s, r=0.040, y=1.755, z=0.062, squash=(1.15, 0.95, 0.95)):
    s.blob((0, y, z), r, squash=squash, rings=4, seg=7)
def tache(s, r=0.013):
    for sgn in (-1, 1): s.blob((sgn * 0.020, 1.818, 0.082), r, squash=(1.5, 0.7, 0.8), rings=3, seg=6)

s = style('Beard_Stubble'); s.scalp(jawline(1.845), t=0.005, on=FACE)
s = style('Beard_Short')
s.scalp(jawline(1.855), t=0.013, on=FACE); chin(s, r=0.034, y=1.762); tache(s)
s = style('Beard_Goatee')
chin(s, r=0.036, y=1.748, z=0.068, squash=(0.85, 1.25, 0.95)); tache(s)
s = style('Beard_Full')
s.scalp(jawline(1.870), t=0.020, jitter=0.004, seed=3, on=FACE)
chin(s, r=0.046, y=1.750, z=0.058); tache(s, r=0.015)
s.tube([(0, 1.745, 0.070), (0, 1.690, 0.066), (0, 1.640, 0.050)], [0.042, 0.038, 0.020], sides=6)


# ---------------------------------------------------------------- the writer
def write(styles, path):
    gltf = pg.GLTF2(); buf = bytearray()
    def view(data, target=None):
        data = np.ascontiguousarray(data); off = len(buf); buf.extend(data.tobytes())
        while len(buf) % 4: buf.append(0)
        gltf.bufferViews.append(pg.BufferView(buffer=0, byteOffset=off, byteLength=data.nbytes, target=target))
        return len(gltf.bufferViews) - 1
    def accessor(data, ctype, atype, target=None, minmax=False):
        bv = view(data, target)
        a = pg.Accessor(bufferView=bv, componentType=ctype, count=len(data), type=atype)
        if minmax: a.min = data.min(0).tolist(); a.max = data.max(0).tolist()
        gltf.accessors.append(a); return len(gltf.accessors) - 1
    # the base skeleton, copied so the file stands on its own
    keep = set(JOINT_NODES)
    order = sorted(keep); remap = {old: new for new, old in enumerate(order)}
    for old in order:
        n = BJS['nodes'][old]
        node = pg.Node(name=n['name'], children=[remap[c] for c in n.get('children', []) if c in keep])
        for k in ('translation', 'rotation', 'scale'):
            if k in n: setattr(node, k, n[k])
        gltf.nodes.append(node)
    ibm = acc(SKIN['inverseBindMatrices']).astype(np.float32)
    ibm_acc = accessor(ibm.reshape(-1, 16), pg.FLOAT, 'MAT4')
    gltf.skins.append(pg.Skin(name='Human_Rig', joints=[remap[j] for j in JOINT_NODES], inverseBindMatrices=ibm_acc))
    # one near-white material: the client tints a style to the hair colour
    gltf.materials.append(pg.Material(name='MAT_Hair', pbrMetallicRoughness=pg.PbrMetallicRoughness(
        baseColorFactor=[0.82, 0.80, 0.78, 1.0], metallicFactor=0.0, roughnessFactor=0.95)))
    mesh_nodes = []
    for st in styles:
        if not st.prims: print(f'  {st.name:18s} EMPTY — skipped'); continue
        prims = [pg.Primitive(attributes=pg.Attributes(
            POSITION=accessor(p['pos'], pg.FLOAT, 'VEC3', pg.ARRAY_BUFFER, True),
            NORMAL=accessor(p['nrm'], pg.FLOAT, 'VEC3', pg.ARRAY_BUFFER),
            JOINTS_0=accessor(p['j'], pg.UNSIGNED_SHORT, 'VEC4', pg.ARRAY_BUFFER),
            WEIGHTS_0=accessor(p['w'], pg.FLOAT, 'VEC4', pg.ARRAY_BUFFER)),
            indices=accessor(p['idx'].reshape(-1).astype(np.uint32), pg.UNSIGNED_INT, 'SCALAR', pg.ELEMENT_ARRAY_BUFFER),
            material=0) for p in st.prims]
        gltf.meshes.append(pg.Mesh(name=st.name, primitives=prims))
        gltf.nodes.append(pg.Node(name=st.name, mesh=len(gltf.meshes) - 1, skin=0))
        mesh_nodes.append(len(gltf.nodes) - 1)
        tris = sum(len(p['idx']) for p in st.prims); verts = sum(len(p['pos']) for p in st.prims)
        print(f'  {st.name:18s} {tris:5d} tris {verts:5d} verts')
    gltf.nodes.append(pg.Node(name='Human_Rig', children=[remap[JOINT_NODES[0]]] + mesh_nodes))
    gltf.scenes.append(pg.Scene(nodes=[len(gltf.nodes) - 1])); gltf.scene = 0
    gltf.buffers.append(pg.Buffer(byteLength=len(buf)))
    gltf.set_binary_blob(bytes(buf))
    gltf.save(path)


if __name__ == '__main__':
    print('Hair from', BASE.name)
    styles = list(STYLES.values())
    write(styles, OUT)
    names = [s.name for s in styles if s.prims]
    (HUMAN / 'hair.json').write_text(json.dumps({
        'hair': [n for n in names if n.startswith('Hair_')],
        'beards': [n for n in names if n.startswith('Beard_')],
    }, indent=1))
    print(f'-> {OUT.relative_to(ROOT)}  ({OUT.stat().st_size // 1024} KB, {len(names)} styles)')
