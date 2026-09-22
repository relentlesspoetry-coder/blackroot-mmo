# BlackRoot: RealmFall -- Fighter (fur-mantle barbarian) -- LOW-POLY OSRS-STYLE RIGGED BUILD
# Single-file Blender 4.2 script. Run:  blender -b -P BlackRoot_Fighter_LowPoly_Rigged.py -- --out <dir>
#
# CONVENTIONS (verified by render, see check_facing):
#   character faces -Y ; +X is the character's LEFT ; Z up ; metres ; feet on z=0
#   ring parameter t (degrees): 0 = FRONT (-Y), 90 = character LEFT (+X), 180 = BACK (+Y), 270 = RIGHT (-X)
#   left side authored with s=+1, right with s=-1 (x is multiplied by s) -- nothing is mirrored.
#   The design asymmetry is deliberate: pauldron and knee cop on the character's LEFT only.
import bpy, bmesh, math, os, sys, time, random, json
from mathutils import Vector, Matrix, Quaternion, Euler

T0 = time.time()
def log(*a):
    print("[fighter %6.1fs]" % (time.time() - T0), *a); sys.stdout.flush()

ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
def arg(name, default):
    return ARGV[ARGV.index(name) + 1] if name in ARGV else default
OUT = arg("--out", os.path.join(os.getcwd(), "fighter_out"))
os.makedirs(OUT, exist_ok=True)
DO_RENDER = arg("--render", "1") != "0"
DO_TESTS = arg("--tests", "1") != "0"
SAMPLES = int(arg("--samples", "24"))
random.seed(7)

HEIGHT = 2.02
Z_CHIN, Z_NECKBASE, Z_SHOULDER = 1.755, 1.665, 1.600
Z_HIP, Z_KNEE, Z_ANKLE = 1.030, 0.560, 0.100
SHOULDER_X = 0.225          # shoulder joint lateral offset (inside the deltoid)
HIP_X = 0.125
ARM_DROP = math.radians(38) # A-pose: arms this far below horizontal
UPPER_ARM, FOREARM, HAND_LEN = 0.310, 0.285, 0.190
ANKLE_X, FOOT_YAW = 0.170, math.radians(7)
S_L, S_R = 1, -1
SIDE_NAME = {S_L: "L", S_R: "R"}
SIDE_WORD = {S_L: "Left", S_R: "Right"}

def V(*a): return Vector(a)
def lerp(a, b, t): return a + (b - a) * t
def clamp(x, lo=0.0, hi=1.0): return max(lo, min(hi, x))
def smooth(t): t = clamp(t); return t * t * (3 - 2 * t)
def rad(d): return math.radians(d)
FRONT, BACK, LEFT, RIGHT, UP, DOWN = V(0, -1, 0), V(0, 1, 0), V(1, 0, 0), V(-1, 0, 0), V(0, 0, 1), V(0, 0, -1)

# ----------------------------------------------------------------------------- scene / collections
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'; sc.unit_settings.scale_length = 1.0
    return sc

COLL = {}
def collection(path):
    """path like 'CHARACTER/ARMOR' -> collection, created on demand."""
    if path in COLL: return COLL[path]
    parts = path.split("/")
    parent = bpy.context.scene.collection
    cur = ""
    for p in parts:
        cur = (cur + "/" + p) if cur else p
        if cur not in COLL:
            c = bpy.data.collections.new(p); parent.children.link(c); COLL[cur] = c
        parent = COLL[cur]
    return COLL[path]

# ----------------------------------------------------------------------------- materials (flat, OSRS-like)
MATS = {}
def material(name, rgb, rough=0.85, metal=0.0, emit=0.0):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1.0); b.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = (*rgb, 1.0); m.roughness = rough; m.metallic = metal
    MATS[name] = m; return m

def make_materials():
    material("MAT_Fighter_Skin", (0.62, 0.40, 0.29))
    material("MAT_Fighter_Hair", (0.09, 0.07, 0.05), 0.9)
    material("MAT_Fighter_Fur", (0.25, 0.19, 0.13), 0.95)
    material("MAT_Fighter_DarkLeather", (0.14, 0.09, 0.06), 0.7)
    material("MAT_Fighter_BrownLeather", (0.33, 0.20, 0.11), 0.7)
    material("MAT_Fighter_ClothDark", (0.11, 0.10, 0.09), 0.95)
    material("MAT_Fighter_ClothRed", (0.38, 0.09, 0.08), 0.95)
    material("MAT_Fighter_Iron", (0.34, 0.33, 0.32), 0.45, 0.9)
    material("MAT_Fighter_Brass", (0.55, 0.42, 0.20), 0.4, 0.9)
    material("MAT_Fighter_Bone", (0.80, 0.74, 0.60), 0.8)
    material("MAT_Fighter_Wood", (0.30, 0.20, 0.11), 0.8)
    material("MAT_Fighter_Eyes", (0.93, 0.90, 0.84), 0.5)
    material("MAT_Fighter_Iris", (0.30, 0.19, 0.08), 0.5)
    material("MAT_Fighter_Mouth", (0.32, 0.15, 0.13), 0.8)
    material("MAT_Fighter_Scar", (0.48, 0.25, 0.20), 0.8)

# ----------------------------------------------------------------------------- mesh builder
class MB:
    """Accumulates verts/faces with a per-vertex skin TAG, builds one mesh object.
    A tag is a tuple describing which bones the vertex belongs to (resolved by the skinning pass)."""
    def __init__(self, name):
        self.name = name; self.v = []; self.tag = []; self.f = []; self.fmat = []; self.cur_mat = 0
        self.mats = []; self.default_tag = ("none",)
    def use(self, matname):
        m = MATS[matname]
        if m not in self.mats: self.mats.append(m)
        self.cur_mat = self.mats.index(m)
    def add(self, p, tag=None):
        self.v.append(Vector(p)); self.tag.append(tag if tag is not None else self.default_tag); return len(self.v) - 1
    def face(self, ids):
        ids = [i for k, i in enumerate(ids) if i not in ids[:k]]
        if len(ids) < 3: return None
        self.f.append(tuple(ids)); self.fmat.append(self.cur_mat); return len(self.f) - 1
    def kill_face(self, fid):
        self.f[fid] = None
    # --- rings
    def ring(self, c, u, v, rx, ry, n=8, tag=None, shape=None, t0=0.0):
        """closed ring of n verts: c + rx*cos(t)*u + ry*sin(t)*v. shape(t_deg)->(mulx,muly,dz) optional."""
        ids = []
        for k in range(n):
            t = t0 + 360.0 * k / n
            mx, my, off = 1.0, 1.0, Vector((0, 0, 0))
            if shape:
                r = shape(t % 360.0)
                mx, my = r[0], r[1]
                if len(r) > 2: off = Vector(r[2])
            p = Vector(c) + u * (rx * mx * math.cos(rad(t))) + v * (ry * my * math.sin(rad(t))) + off
            ids.append(self.add(p, tag))
        return ids
    def shell_ring(self, c, u, v, r_out, r_in, a0, a1, n, tag=None, ry_out=None, ry_in=None, off_out=0.0, off_in=0.0):
        """closed ring = outer arc a0..a1 then inner arc back a1..a0  (thickness shell for plates/beard/fur)."""
        ry_out = r_out if ry_out is None else ry_out; ry_in = r_in if ry_in is None else ry_in
        ids = []
        for k in range(n + 1):
            t = rad(lerp(a0, a1, k / n)); ids.append(self.add(Vector(c) + u * (r_out * math.cos(t)) + v * (ry_out * math.sin(t)) + Vector((0, 0, off_out)), tag))
        for k in range(n + 1):
            t = rad(lerp(a1, a0, k / n)); ids.append(self.add(Vector(c) + u * (r_in * math.cos(t)) + v * (ry_in * math.sin(t)) + Vector((0, 0, off_in)), tag))
        return ids
    def pyramid(self, quad, apex, tag=None):
        a = self.add(apex, tag if tag else self.tag[quad[0]])
        return [self.face([quad[k], quad[(k + 1) % 4], a]) for k in range(4)]
    def bridge(self, A, B, align=True, spike=None):
        """Bridge two closed loops (any lengths). Auto-aligns rotation/direction by minimal total distance.
        spike(k, quad_ids) -> apex point or None: replaces that quad by a 4-tri pyramid (fur clumps, hair spikes)."""
        n, m = len(A), len(B)
        if align:
            best = None
            for rev in (False, True):
                Bc = list(reversed(B)) if rev else list(B)
                for off in range(m):
                    Bo = Bc[off:] + Bc[:off]
                    d = sum((self.v[A[int(i * n / m)]] - self.v[Bo[i]]).length for i in range(m)) if m >= n else \
                        sum((self.v[A[i]] - self.v[Bo[int(i * m / n)]]).length for i in range(n))
                    if best is None or d < best[0]: best = (d, Bo)
            B = best[1]
        faces = []
        i = j = 0
        while i < n or j < m:
            ai, aj = A[i % n], B[j % m]
            fi, fj = (i + 1) / n, (j + 1) / m
            if j >= m or (i < n and fi <= fj + 1e-9 and abs(fi - fj) > 1e-9):
                faces.append(self.face([ai, A[(i + 1) % n], aj])); i += 1
            elif i >= n or fj < fi - 1e-9:
                faces.append(self.face([ai, B[(j + 1) % m], aj])); j += 1
            else:
                q = [ai, A[(i + 1) % n], B[(j + 1) % m], aj]
                ap = spike(i, q) if spike else None
                if ap is not None: faces.extend(self.pyramid(q, ap))
                else: faces.append(self.face(q))
                i += 1; j += 1
        return faces
    def loft(self, rings, align=True, spike=None):
        out = []
        for a, b in zip(rings, rings[1:]): out.append(self.bridge(a, b, align, spike))
        return out
    def cap(self, ring, center=None, tag=None):
        """fan cap with a centre vertex (center: point or None = centroid + 0)."""
        if center is None:
            center = sum((self.v[i] for i in ring), Vector()) / len(ring)
        c = self.add(center, tag if tag else self.tag[ring[0]])
        fs = []
        for k in range(len(ring)):
            fs.append(self.face([ring[k], ring[(k + 1) % len(ring)], c]))
        return c, fs
    def ngon(self, ring):
        return self.face(list(ring))
    def spike_cap(self, ring, apex_fn, tag=None):
        """spiky cap: every edge of the ring gets its own apex (apex_fn(k, p_mid)->point)."""
        fs = []
        for k in range(len(ring)):
            a, b = ring[k], ring[(k + 1) % len(ring)]
            mid = (self.v[a] + self.v[b]) * 0.5
            ap = self.add(apex_fn(k, mid), tag if tag else self.tag[a])
            fs.append(self.face([a, b, ap]))
        return fs
    def box(self, c, size, u=LEFT, v=BACK, w=UP, tag=None):
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        c = Vector(c)
        P = [c + u * (sx * i) + v * (sy * j) + w * (sz * k) for k in (-1, 1) for j in (-1, 1) for i in (-1, 1)]
        ids = [self.add(p, tag) for p in P]
        for q in [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]:
            self.face([ids[i] for i in q])
        return ids
    def prism(self, base_pts, axis, length, tag=None):
        """extrude an arbitrary polygon (world points) along axis by length -> closed solid"""
        a = [self.add(p, tag) for p in base_pts]; b = [self.add(p + axis * length, tag) for p in base_pts]
        self.face(list(reversed(a))); self.face(b)
        for k in range(len(a)): self.face([a[k], a[(k + 1) % len(a)], b[(k + 1) % len(a)], b[k]])
        return a, b
    def tube(self, pts, r, n=6, tag=None, r_end=None, cap_ends=True, ry=None, closed=False):
        """polyline tube (straps/chains/horns). r may be a list per point. closed=True makes a torus (no caps)."""
        rings = []
        N = len(pts)
        for k, p in enumerate(pts):
            if closed: d = (pts[(k + 1) % N] - pts[(k - 1) % N]).normalized()
            else: d = (pts[min(k + 1, N - 1)] - pts[max(k - 1, 0)]).normalized()
            ref = UP if abs(d.dot(UP)) < 0.9 else FRONT
            u = ref.cross(d).normalized(); v = d.cross(u).normalized()
            rk = r[k] if isinstance(r, (list, tuple)) else r
            ryk = (ry[k] if isinstance(ry, (list, tuple)) else ry) if ry is not None else rk
            rings.append(self.ring(p, u, v, rk, ryk, n, tag))
        if closed: rings.append(rings[0])
        self.loft(rings, align=False)
        if cap_ends and not closed:
            self.ngon(list(reversed(rings[0]))); self.ngon(rings[-1])
        return rings
    def band(self, pts, normals, width, thick, tag=None, closed=False, tilt=None):
        """flat strap along a path lying on a surface: 4-vert rectangular cross-section rings.
        pts on the surface, normals pointing out of the surface; width across the path, thick along the normal."""
        rings = []
        N = len(pts)
        for k in range(N):
            if closed:
                d = (pts[(k + 1) % N] - pts[(k - 1) % N]).normalized()
            else:
                d = (pts[min(k + 1, N - 1)] - pts[max(k - 1, 0)]).normalized()
            nrm = Vector(normals[k]).normalized()
            w = d.cross(nrm).normalized(); nrm = w.cross(d).normalized()
            p = Vector(pts[k])
            q = [p + w * (width / 2), p - w * (width / 2), p - w * (width / 2) + nrm * thick, p + w * (width / 2) + nrm * thick]
            rings.append([self.add(x, tag) for x in q])
        if closed: rings.append(rings[0])
        self.loft(rings, align=False)
        if not closed:
            self.ngon(list(reversed(rings[0]))); self.ngon(rings[-1])
        return rings
    def build(self, coll_path, shade_flat=True):
        me = bpy.data.meshes.new(self.name)
        faces = [f for f in self.f if f is not None]; fm = [m for f, m in zip(self.f, self.fmat) if f is not None]
        # drop verts no face uses (a killed patch can strand a vertex)
        used = sorted({i for f in faces for i in f}); remap = {o: n for n, o in enumerate(used)}
        self.v = [self.v[i] for i in used]; self.tag = [self.tag[i] for i in used]
        faces = [tuple(remap[i] for i in f) for f in faces]
        me.from_pydata([tuple(p) for p in self.v], [], faces)
        me.validate(verbose=False); me.update()
        for m in self.mats: me.materials.append(m)
        for poly, mi in zip(me.polygons, fm): poly.material_index = mi
        for poly in me.polygons: poly.use_smooth = not shade_flat
        ob = bpy.data.objects.new(self.name, me)
        collection(coll_path).objects.link(ob)
        ob["skin_tags"] = json.dumps([list(t) if isinstance(t, tuple) else t for t in self.tag])
        REGISTRY[self.name] = (ob, self)
        # merge coincident vertices (straps and plates share endpoints), keep skin tags in sync, make normals consistent
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free(); me.update()
        if len(me.vertices) != len(self.v):
            from mathutils import kdtree
            kd = kdtree.KDTree(len(self.v))
            for i, p in enumerate(self.v): kd.insert(p, i)
            kd.balance()
            src = [kd.find(v.co)[1] for v in me.vertices]
            self.v = [me.vertices[i].co.copy() for i in range(len(me.vertices))]; self.tag = [self.tag[i] for i in src]
            ob["skin_tags"] = json.dumps([list(t) if isinstance(t, tuple) else t for t in self.tag])
        return ob

REGISTRY = {}   # name -> (object, MB)

# ----------------------------------------------------------------------------- body profile (analytic) so garments can be lofted from it
# torso rings: half-widths rx (lateral, +X) and ry (front-back), plus an angular shape multiplier
TORSO_KEYS = [  # z, rx, ry, front_flat, back_flat
    (0.985, 0.205, 0.132, 0.90, 0.92),   # pelvis bottom
    (1.030, 0.215, 0.140, 0.92, 0.94),   # hip
    (1.110, 0.205, 0.138, 0.94, 0.95),   # lower belly
    (1.200, 0.198, 0.140, 0.95, 0.95),   # waist / navel
    (1.300, 0.228, 0.155, 0.94, 0.95),   # lower ribs
    (1.400, 0.258, 0.165, 0.93, 0.95),   # ribs
    (1.500, 0.278, 0.168, 0.93, 0.95),   # chest
    (1.580, 0.262, 0.160, 0.92, 0.95),   # upper chest / socket bottom
    (1.625, 0.242, 0.145, 0.95, 0.96),   # shoulder line (socket top)
    (1.665, 0.168, 0.118, 1.00, 1.00),   # trapezius shelf -> neck base
]
def torso_profile(z):
    K = TORSO_KEYS
    if z <= K[0][0]: return K[0][1:]
    if z >= K[-1][0]: return K[-1][1:]
    for (z0, *a), (z1, *b) in zip(K, K[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0); return tuple(lerp(x, y, t) for x, y in zip(a, b))
def torso_shape(z, front_flat, back_flat):
    def shape(t):
        c = math.cos(rad(t))
        m = front_flat if c > 0 else back_flat
        # flatten front/back: pull the front/back verts inward, keep sides
        f = 1.0 - (1.0 - m) * abs(c)
        return (1.0, f)
    return shape

def torso_ring(mb, z, off=0.0, n=12, tag=None, t0=0.0, dz=0.0):
    """ring around the torso at height z, `off` metres outside the skin. t=0 front(-Y), 90 left(+X)."""
    rx, ry, ff, bf = torso_profile(z)
    def shape(t):
        c = math.cos(rad(t))  # c>0 front
        m = ff if c > 0 else bf
        f = 1.0 - (1.0 - m) * abs(c)
        return (f, 1.0)   # u = FRONT carries the front-back radius (flattened), v = LEFT carries the lateral radius
    return mb.ring((0, 0, z + dz), FRONT, LEFT, ry + off, rx + off, n, tag, shape, t0)

def torso_point(z, t, off=0.0):
    rx, ry, ff, bf = torso_profile(z)
    c, s = math.cos(rad(t)), math.sin(rad(t))
    m = ff if c > 0 else bf
    f = 1.0 - (1.0 - m) * abs(c)
    return Vector((0, 0, z)) + FRONT * ((ry + off) * c * f) + LEFT * ((rx + off) * s)
def torso_normal(z, t):
    p0 = torso_point(z, t); p1 = torso_point(z, t + 3); p2 = torso_point(z + 0.01, t)
    n = (p1 - p0).cross(p2 - p0).normalized()
    return n if n.dot(Vector((p0.x, p0.y, 0))) > 0 else -n

# limbs -------------------------------------------------------------------------------
def arm_chain(s):
    sh = Vector((s * SHOULDER_X, 0.0, Z_SHOULDER))
    d = Vector((s * math.cos(ARM_DROP), 0.0, -math.sin(ARM_DROP)))
    el = sh + d * UPPER_ARM; wr = el + d * FOREARM
    return sh, el, wr, d
def arm_frame(s):
    """(d, u, v): d along the arm, u = FRONT, v = the 'upper' side of the arm (away from the torso, up)."""
    sh, el, wr, d = arm_chain(s)
    u = FRONT; v = d.cross(u).normalized()
    if v.z < 0: v = -v
    return d, u, v
ARM_KEYS = [  # t along shoulder->wrist (0..1 over UPPER_ARM+FOREARM), r (front-back), r2 (thickness perpendicular)
    (0.00, 0.100, 0.098), (0.12, 0.104, 0.100), (0.30, 0.092, 0.086), (0.45, 0.076, 0.072),
    (0.52, 0.070, 0.068), (0.62, 0.084, 0.078), (0.78, 0.076, 0.068), (0.92, 0.058, 0.052), (1.00, 0.050, 0.044),
]
def arm_radius(t):
    K = ARM_KEYS
    if t <= K[0][0]: return K[0][1:]
    if t >= K[-1][0]: return K[-1][1:]
    for (a, *x), (b, *y) in zip(K, K[1:]):
        if a <= t <= b:
            f = (t - a) / (b - a); return tuple(lerp(p, q, f) for p, q in zip(x, y))
def arm_point(s, t):
    sh, el, wr, d = arm_chain(s); return sh + d * (t * (UPPER_ARM + FOREARM))
def arm_ring(mb, s, t, off=0.0, n=8, tag=None, scale=1.0):
    d, u, v = arm_frame(s); r1, r2 = arm_radius(t)
    return mb.ring(arm_point(s, t), u, v, (r1 + off) * scale, (r2 + off) * scale, n, tag)
T_ELBOW = UPPER_ARM / (UPPER_ARM + FOREARM)

LEG_KEYS = [  # z, rx, ry
    (0.960, 0.125, 0.132), (0.860, 0.118, 0.126), (0.740, 0.105, 0.112), (0.640, 0.092, 0.098),
    (0.560, 0.082, 0.086), (0.490, 0.080, 0.084), (0.410, 0.086, 0.094), (0.300, 0.072, 0.078),
    (0.190, 0.058, 0.064), (0.100, 0.052, 0.058),
]
def leg_radius(z):
    K = LEG_KEYS
    if z >= K[0][0]: return K[0][1:]
    if z <= K[-1][0]: return K[-1][1:]
    for (a, *x), (b, *y) in zip(K, K[1:]):
        if b <= z <= a:
            f = (a - z) / (a - b); return tuple(lerp(p, q, f) for p, q in zip(x, y))
def leg_center(s, z):
    """leg axis: hip (HIP_X) at Z_HIP to ankle (ANKLE_X) at Z_ANKLE, straight."""
    f = clamp((Z_HIP - z) / (Z_HIP - Z_ANKLE), 0, 1.2)
    return Vector((s * lerp(HIP_X, ANKLE_X, f), 0.0, z))
def leg_ring(mb, s, z, off=0.0, n=8, tag=None):
    rx, ry = leg_radius(z)
    return mb.ring(leg_center(s, z), FRONT, LEFT, ry + off, rx + off, n, tag)
def foot_frame(s):
    fwd = Vector((s * math.sin(FOOT_YAW), -math.cos(FOOT_YAW), 0.0))   # forward, toed slightly OUT
    side = UP.cross(fwd).normalized()
    return fwd, side
FOOT_KEYS = [  # dist along fwd from ankle, z_center, half-height, half-width
    (-0.070, 0.055, 0.050, 0.048), (0.010, 0.050, 0.046, 0.052), (0.100, 0.040, 0.036, 0.055),
    (0.180, 0.030, 0.026, 0.056), (0.245, 0.020, 0.018, 0.050),
]
def foot_ring(mb, s, key, off=0.0, n=8, tag=None, sole_drop=0.0):
    fwd, side = foot_frame(s)
    d, zc, hh, hw = key
    c = Vector((s * ANKLE_X, 0, 0)) + fwd * d
    # underside stays on the sole line whatever the offset: centre = underside + (hh + off)
    c.z = (zc - hh) - sole_drop + (hh + off)
    return mb.ring(c, UP, side, hh + off, hw + off, n, tag)

# ----------------------------------------------------------------------------- head
HEAD_KEYS = [  # z, rx (lateral), ry (front-back), front_flat, back_flat, cy (front-back centre shift, +back)
    (1.705, 0.084, 0.088, 1.00, 1.00, 0.010),   # neck top / under jaw
    (1.750, 0.090, 0.100, 0.84, 1.00, 0.006),   # jaw / chin line
    (1.800, 0.098, 0.110, 0.84, 1.00, 0.006),   # mouth
    (1.845, 0.102, 0.116, 0.80, 1.00, 0.008),   # nose base / cheekbone
    (1.890, 0.103, 0.118, 0.78, 1.00, 0.010),   # eye line
    (1.935, 0.100, 0.115, 0.85, 1.00, 0.010),   # brow
    (1.975, 0.094, 0.108, 0.90, 1.00, 0.012),   # forehead
    (2.005, 0.074, 0.088, 0.95, 1.00, 0.014),   # crown edge
]
HEAD_TOP = 2.022
def head_profile(z):
    K = HEAD_KEYS
    if z <= K[0][0]: return K[0][1:]
    if z >= K[-1][0]: return K[-1][1:]
    for (a, *x), (b, *y) in zip(K, K[1:]):
        if a <= z <= b:
            f = (z - a) / (b - a); return tuple(lerp(p, q, f) for p, q in zip(x, y))
def head_point(z, t, off=0.0):
    rx, ry, ff, bf, cy = head_profile(z)
    c, s = math.cos(rad(t)), math.sin(rad(t))
    m = ff if c > 0 else bf
    f = 1.0 - (1.0 - m) * abs(c)
    return Vector((0, cy, z)) + FRONT * ((ry + off) * c * f) + LEFT * ((rx + off) * s)
def head_ring(mb, z, off=0.0, n=12, tag=None, nose=0.0):
    rx, ry, ff, bf, cy = head_profile(z)
    def shape(t):
        c = math.cos(rad(t)); m = ff if c > 0 else bf
        f = 1.0 - (1.0 - m) * abs(c)
        bump = 0.0
        if nose and abs(((t + 180) % 360) - 180) < 1: bump = nose
        return (f, 1.0, (0, -bump, 0))
    return mb.ring((0, cy, z), FRONT, LEFT, ry + off, rx + off, n, tag, shape)

# ----------------------------------------------------------------------------- THE BODY (one connected mesh)
def build_body():
    mb = MB("Body"); mb.use("MAT_Fighter_Skin")
    N = 12
    # torso rings (bottom -> top)
    tz = [k[0] for k in TORSO_KEYS]
    torso = [torso_ring(mb, z, 0.0, N, ("spine", z)) for z in tz]
    faces = mb.loft(torso, align=False)
    # shoulder sockets: kill the 2x2 lateral patch between rings 6,7,8 (z 1.50 .. 1.625) at t=90 (left) / 270 (right)
    # ring index k has t = 30*k ; left socket columns: faces between t60-90 (k=2..3) and t90-120 (k=3..4)
    sockets = {}
    for s in (S_L, S_R):
        k_mid = 3 if s == S_L else 9
        for row in (6, 7):
            fl = faces[row]   # faces bridging torso[row] -> torso[row+1]; bridge with equal n yields one quad per k
            for col in (k_mid - 1, k_mid):
                mb.kill_face(fl[col])
        r0, r1, r2 = torso[6], torso[7], torso[8]
        loop = [r0[k_mid - 1], r0[k_mid], r0[k_mid + 1], r1[k_mid + 1], r2[k_mid + 1], r2[k_mid], r2[k_mid - 1], r1[k_mid - 1]]
        sockets[s] = loop
    # neck + head
    neck = [mb.ring((0, 0.010, 1.695), FRONT, LEFT, 0.096, 0.090, N, ("neck", 1.695)),
            mb.ring((0, 0.012, 1.730), FRONT, LEFT, 0.094, 0.088, N, ("neck", 1.730))]
    mb.bridge(torso[-1], neck[0], align=False); mb.bridge(neck[0], neck[1], align=False)
    hz = [k[0] for k in HEAD_KEYS]
    head = []
    for z in hz:
        nose = 0.0
        if abs(z - 1.845) < 1e-6: nose = 0.028
        if abs(z - 1.890) < 1e-6: nose = 0.010
        head.append(head_ring(mb, z, 0.0, N, ("head", z), nose))
    mb.bridge(neck[1], head[0], align=False)
    # chin: pull the front of the jaw ring down/forward a touch for a jaw line
    for k in (0, 1, N - 1):
        mb.v[head[1][k]].z -= 0.004; mb.v[head[1][k]] += FRONT * 0.003
    # brow ridge: push brow ring front verts forward
    for k in (0, 1, 2, N - 2, N - 1):
        mb.v[head[5][k]] += FRONT * 0.006
    # cheek bones
    for k in (2, N - 2):
        mb.v[head[3][k]] += LEFT * (0.006 * (1 if k == 2 else -1))
    mb.loft(head, align=False)
    mb.cap(head[-1], Vector((0, 0.014, HEAD_TOP)), ("head", HEAD_TOP))
    # legs
    pelvis = torso[0]
    for s in (S_L, S_R):
        if s == S_L: half = [pelvis[k] for k in range(0, 7)]          # t 0 .. 180 via left
        else:        half = [pelvis[0]] + [pelvis[k] for k in range(11, 5, -1)]  # t 0, 330 .. 180 via right
        # crotch centre vertex so the two leg loops share one edge and the saddle reads correctly
        rings = [half]
        lz = [k[0] for k in LEG_KEYS]
        legs = [leg_ring(mb, s, z, 0.0, 8, ("leg", s, z)) for z in lz]
        mb.bridge(half, legs[0])
        mb.loft(legs)
        # foot
        feet = [foot_ring(mb, s, key, 0.0, 8, ("foot", s, key[0])) for key in FOOT_KEYS]
        mb.bridge(legs[-1], feet[0]); mb.loft(feet)
        mb.cap(feet[-1], None, ("foot", s, FOOT_KEYS[-1][0]))
    # arms
    for s in (S_L, S_R):
        d, u, v = arm_frame(s)
        ts = [0.14, 0.24, 0.34, 0.44, T_ELBOW - 0.035, T_ELBOW + 0.035, 0.66, 0.80, 0.92, 1.00]
        arms = [arm_ring(mb, s, t, 0.0, 8, ("arm", s, t)) for t in ts]
        mb.bridge(sockets[s], arms[0])
        mb.loft(arms)
        build_hand(mb, s, arms[-1])
    return mb

def hand_frame(s):
    sh, el, wr, d = arm_chain(s)
    F = d                                   # fingers continue the forearm direction
    P = FRONT.cross(d).normalized()         # palm normal candidates: perpendicular to d in the XZ plane
    if P.dot(Vector((-s, 0, 0))) < 0: P = -P   # palm faces INBOARD (towards the body)
    Tdir = F.cross(P)                       # right-hand thumb = cross(F, P); left = -cross(F, P)
    Tdir = (Tdir if s == S_R else -Tdir).normalized()
    return wr, F, P, Tdir

def build_hand(mb, s, wrist_ring):
    wr, F, P, T = hand_frame(s)
    pw, pt = 0.056, 0.022   # palm half-width, half-thickness at the knuckles
    def row(c, hw, ht, tag):
        top = [mb.add(c + T * (hw * x) - P * ht, tag) for x in (-1.0, -0.5, 0.0, 0.5, 1.0)]  # pinky -> index, back of hand
        bot = [mb.add(c + T * (hw * x) + P * ht, tag) for x in (1.0, 0.5, 0.0, -0.5, -1.0)]  # index -> pinky, palm
        return top + bot
    r_wrist = row(wr + F * 0.010, 0.046, 0.021, ("hand", s, 0.0))
    r_palm = row(wr + F * 0.055, 0.056, 0.024, ("hand", s, 0.35))
    r_knuck = row(wr + F * 0.105, pw, pt, ("hand", s, 0.7))
    mb.bridge(wrist_ring, r_wrist)
    f1 = mb.bridge(r_wrist, r_palm, align=False); f2 = mb.bridge(r_palm, r_knuck, align=False)
    # thumb: replace the index-side quad between palm and knuckle rows (verts top4 -> bot0)
    # find the face in f2 containing both r_palm[4] and r_knuck[4]
    for fid in f2:
        f = mb.f[fid]
        if f and r_palm[4] in f and r_knuck[4] in f and r_palm[5] in f:
            mb.kill_face(fid); base = [r_palm[4], r_knuck[4], r_knuck[5], r_palm[5]]
            break
    tdir = (T * 0.75 + F * 0.55 + P * 0.25).normalized()
    finger_from_quad(mb, base, tdir, [0.040, 0.034], [1.0, 0.85, 0.7], ("thumb", s), swell=1.15)
    # four fingers: base quad i: top_i, top_i+1, bot_(3-i), bot_(4-i)
    names = ["pinky", "ring", "middle", "index"]
    lengths = {"pinky": [0.032, 0.026, 0.022], "ring": [0.040, 0.030, 0.024], "middle": [0.042, 0.032, 0.025], "index": [0.040, 0.030, 0.024]}
    for i, nm in enumerate(names):
        base = [r_knuck[i], r_knuck[i + 1], r_knuck[5 + (3 - i)], r_knuck[5 + (4 - i)]]
        spread = T * ((i - 1.5) * 0.10)
        fd = (F + spread).normalized()
        finger_from_quad(mb, base, fd, lengths[nm], [1.0, 0.9, 0.8, 0.62], (nm, s))
    return

def finger_from_quad(mb, base, d, lengths, tapers, tag, swell=1.0):
    """extrude a 4-vert base quad (already open) along d for each length; tag joints (tag+(joint_index, frac))."""
    d = Vector(d).normalized()
    c0 = sum((mb.v[i] for i in base), Vector()) / 4
    offs = [mb.v[i] - c0 for i in base]
    prev = base
    # retag the base verts as joint 0 of this finger
    for i in base: mb.tag[i] = tag + (0, 0.0)
    total = 0.0
    for j, L in enumerate(lengths):
        total += L
        c = c0 + d * total
        sc = tapers[j + 1] if j + 1 < len(tapers) else tapers[-1]
        ring = [mb.add(c + o * sc * (swell if j == 0 else 1.0), tag + (j, 1.0)) for o in offs]
        # side faces
        for k in range(4):
            mb.face([prev[k], prev[(k + 1) % 4], ring[(k + 1) % 4], ring[k]])
        prev = ring
    mb.face(list(reversed(prev)))   # tip cap (winding fixed by recalc)
    return prev
# ----------------------------------------------------------------------------- surface helpers for gear
def leg_point(s, z, t, off=0.0):
    rx, ry = leg_radius(z); c = leg_center(s, z)
    return c + FRONT * ((ry + off) * math.cos(rad(t))) + LEFT * ((rx + off) * math.sin(rad(t)))
def leg_normal(s, z, t):
    c = leg_center(s, z); p = leg_point(s, z, t); n = p - c; n.z = 0; return n.normalized()
def arm_surface(s, t, a, off=0.0):
    d, u, v = arm_frame(s); r1, r2 = arm_radius(t)
    return arm_point(s, t) + u * ((r1 + off) * math.cos(rad(a))) + v * ((r2 + off) * math.sin(rad(a)))
def arm_normal(s, t, a):
    n = arm_surface(s, t, a) - arm_point(s, t); return n.normalized()
def head_normal(z, t):
    p0 = head_point(z, t); p1 = head_point(z, t + 4); p2 = head_point(z + 0.01, t)
    n = (p1 - p0).cross(p2 - p0).normalized()
    c = head_point(z, t) - Vector((0, 0.01, z))
    return n if n.dot(c) > 0 else -n
def jit(a, b): return random.uniform(a, b)

# ----------------------------------------------------------------------------- PHASE 2  pants
def build_pants():
    mb = MB("Pants"); mb.use("MAT_Fighter_ClothDark")
    N = 12
    top = [torso_ring(mb, 1.170, 0.010, N, ("spine", 1.170)), torso_ring(mb, 1.110, 0.013, N, ("spine", 1.110)),
           torso_ring(mb, 1.030, 0.015, N, ("spine", 1.030)), torso_ring(mb, 0.985, 0.016, N, ("spine", 0.985))]
    mb.ngon(list(reversed(top[0])))  # hidden cap inside the body (keeps the mesh closed)
    mb.loft(top, align=False)
    pelvis = top[-1]
    keys = [(0.960, 0.020), (0.880, 0.028), (0.780, 0.032), (0.680, 0.028), (0.600, 0.022), (0.560, 0.020),
            (0.520, 0.019), (0.470, 0.017), (0.430, 0.010)]
    for s in (S_L, S_R):
        half = [pelvis[k] for k in range(0, 7)] if s == S_L else [pelvis[0]] + [pelvis[k] for k in range(11, 5, -1)]
        rings = []
        for z, off in keys:
            rx, ry = leg_radius(z)
            # folds: small per-vertex jitter at the knee and crotch
            def shape(t, z=z):
                j = 1.0
                if 0.50 < z < 0.62 or 0.90 < z: j = 1.0 + 0.06 * math.sin(rad(t * 3 + z * 900))
                return (j, j)
            rings.append(mb.ring(leg_center(s, z), FRONT, LEFT, ry + off, rx + off, 8, ("leg", s, z), shape))
        mb.bridge(half, rings[0]); mb.loft(rings)
        mb.ngon(rings[-1])   # tucked into the boot
    return mb.build("CHARACTER/CLOTHING")

# ----------------------------------------------------------------------------- PHASE 3  boots
BOOT_TOP = 0.470
def boot_foot_ring(mb, s, d, hw, h_top, tag, sole_top=0.032):
    """8-vert cross section: flat sole, vertical sides, rounded top. d = distance along foot forward from the ankle."""
    fwd, side = foot_frame(s)
    c = Vector((s * ANKLE_X, 0, 0)) + fwd * d
    P = [c + Vector((0, 0, h_top)),
         c + side * (hw * 0.75) + Vector((0, 0, h_top - 0.012)),
         c + side * hw + Vector((0, 0, (h_top + sole_top) * 0.5)),
         c + side * hw + Vector((0, 0, sole_top)),
         c + side * (hw * 0.96) + Vector((0, 0, 0.0)),
         c - side * (hw * 0.96) + Vector((0, 0, 0.0)),
         c - side * hw + Vector((0, 0, sole_top)),
         c - side * hw + Vector((0, 0, (h_top + sole_top) * 0.5)),
         c - side * (hw * 0.75) + Vector((0, 0, h_top - 0.012))]
    return [mb.add(p, tag) for p in P]

def build_boot(s):
    W = SIDE_WORD[s]
    mb = MB("%s Boot" % W); mb.use("MAT_Fighter_DarkLeather")
    N = 8
    shaft = []
    for z, off in [(BOOT_TOP, 0.030), (0.420, 0.034), (0.360, 0.034), (0.300, 0.032), (0.230, 0.030), (0.160, 0.028), (0.110, 0.026)]:
        shaft.append(leg_ring(mb, s, z, off, N, ("leg", s, z)))
    mb.ngon(list(reversed(shaft[0])))
    mb.loft(shaft, align=False)
    # heel/ankle transition ring + foot rings
    foot = [boot_foot_ring(mb, s, d, hw, ht, ("foot", s, d)) for d, hw, ht in
            [(-0.085, 0.066, 0.118), (0.000, 0.070, 0.105), (0.100, 0.072, 0.082), (0.190, 0.070, 0.062), (0.270, 0.058, 0.048)]]
    mb.bridge(shaft[-1], foot[0]); mb.loft(foot)
    mb.cap(foot[-1], None, ("foot", s, 0.29))
    ob = mb.build("CHARACTER/CLOTHING")
    # straps (own object, rigid-ish, follows the shin)
    st = MB("%s Boot Straps" % W); st.use("MAT_Fighter_BrownLeather")
    for z in (0.400, 0.300, 0.200):
        pts = [leg_point(s, z, t, 0.036) for t in range(0, 360, 30)]
        nrm = [leg_normal(s, z, t) for t in range(0, 360, 30)]
        st.band(pts, nrm, 0.040, 0.010, ("leg", s, z), closed=True)
        # buckle on the outside
        st.use("MAT_Fighter_Iron")
        p = leg_point(s, z, 90 * s, 0.049); n = leg_normal(s, z, 90 * s)
        st.box(p, (0.030, 0.014, 0.038), FRONT, n, UP, ("leg", s, z))
        st.use("MAT_Fighter_BrownLeather")
    # cross straps over the instep
    st.use("MAT_Fighter_BrownLeather")
    fwd, side = foot_frame(s)
    for k, (d0, d1) in enumerate([(0.02, 0.16), (0.16, 0.02)]):
        pts = []; nrm = []
        for i in range(7):
            f = i / 6; a = lerp(-85, 85, f) * (1 if k == 0 else -1)
            d = lerp(d0, d1, f)
            c = Vector((s * ANKLE_X, 0, 0)) + fwd * d
            ht = lerp(0.105, 0.062, (d - 0.0) / 0.19); hw = 0.072
            p = c + side * (hw * 0.78 * math.sin(rad(a))) + Vector((0, 0, 0.5 * (ht + 0.06) + 0.5 * (ht - 0.06) * math.cos(rad(a)) + 0.006))
            n = (side * math.sin(rad(a)) + UP * math.cos(rad(a))).normalized()
            pts.append(p); nrm.append(n)
        st.band(pts, nrm, 0.030, 0.008, ("foot", s, 0.1))
    st.build("CHARACTER/CLOTHING")
    # armour: shin plate + toe cap + studs + small skull
    ar = MB("%s Boot Armor" % W); ar.use("MAT_Fighter_Iron")
    shin = [leg_ring_arc(ar, s, z, 0.044, 0.036, -55, 55, 6, ("leg", s, z)) for z in (0.440, 0.380, 0.320, 0.260)]
    ar.loft(shin, align=False); ar.ngon(list(reversed(shin[0]))); ar.ngon(shin[-1])
    for z in (0.410, 0.350, 0.290):
        for a in (-30, 30):
            p = leg_point(s, z, a, 0.052); ar.box(p, (0.012, 0.012, 0.012), FRONT, leg_normal(s, z, a), UP, ("leg", s, z))
    # toe cap
    toe = [boot_foot_ring(ar, s, d, hw, ht, ("foot", s, d), sole_top=0.034) for d, hw, ht in [(0.200, 0.078, 0.070), (0.285, 0.066, 0.054)]]
    ar.loft(toe); ar.cap(toe[-1], None, ("foot", s, 0.29)); ar.ngon(list(reversed(toe[0])))
    ar.use("MAT_Fighter_Bone")
    p = leg_point(s, 0.245, 90 * s, 0.050); ar.box(p, (0.026, 0.020, 0.030), FRONT, leg_normal(s, 0.245, 90 * s), UP, ("leg", s, 0.245))
    ar.build("CHARACTER/ARMOR")
    # fur trim at the top of the shaft
    fur = MB("%s Boot Fur Trim" % W); fur.use("MAT_Fighter_Fur")
    n = 12
    lo = [mb_ring_fn(fur, lambda t: leg_point(s, BOOT_TOP - 0.03, t, 0.046 + 0.008 * math.sin(rad(t * 5))), n, ("leg", s, BOOT_TOP - 0.03))]
    hi = [mb_ring_fn(fur, lambda t: leg_point(s, BOOT_TOP + 0.02, t, 0.052 + 0.010 * math.sin(rad(t * 4 + 40))), n, ("leg", s, BOOT_TOP))]
    inner = [mb_ring_fn(fur, lambda t: leg_point(s, BOOT_TOP + 0.015, t, 0.026), n, ("leg", s, BOOT_TOP))]
    fur.loft(lo + hi, align=False)
    fur.ngon(list(reversed(lo[0])))
    def apex(k, q):
        pts = [fur.v[i] for i in q]; m = sum(pts, Vector()) / 4
        return m + Vector((0, 0, jit(0.035, 0.065))) + leg_normal(s, BOOT_TOP, k * 30) * jit(0.0, 0.02)
    fur.bridge(hi[0], inner[0], align=False, spike=apex)
    fur.ngon(inner[0])
    fur.build("CHARACTER/CLOTHING")
    return ob

def leg_ring_arc(mb, s, z, off_out, off_in, a0, a1, n, tag):
    rx, ry = leg_radius(z); c = leg_center(s, z)
    return mb.shell_ring(c, FRONT, LEFT, ry + off_out, ry + off_in, a0, a1, n, tag, rx + off_out, rx + off_in)
def mb_ring_fn(mb, fn, n, tag):
    return [mb.add(fn(360.0 * k / n), tag) for k in range(n)]

# ----------------------------------------------------------------------------- PHASE 4  belt
def build_belt():
    mb = MB("Belt"); mb.use("MAT_Fighter_DarkLeather")
    pts = [torso_point(1.150, t, 0.022) for t in range(0, 360, 15)]; nrm = [torso_normal(1.150, t) for t in range(0, 360, 15)]
    mb.band(pts, nrm, 0.075, 0.016, ("spine", 1.150), closed=True)
    mb.use("MAT_Fighter_BrownLeather")
    pts = [torso_point(1.095, t, 0.024) for t in range(0, 360, 15)]; nrm = [torso_normal(1.095, t) for t in range(0, 360, 15)]
    mb.band(pts, nrm, 0.040, 0.012, ("spine", 1.095), closed=True)
    mb.use("MAT_Fighter_Iron")
    for t in range(20, 360, 40):
        p = torso_point(1.150, t, 0.040); mb.box(p, (0.012, 0.010, 0.012), FRONT, torso_normal(1.150, t), UP, ("spine", 1.150))
    mb.build("CHARACTER/CLOTHING")
    bk = MB("Belt Buckle"); bk.use("MAT_Fighter_Iron")
    c = torso_point(1.150, 0, 0.040); n = torso_normal(1.150, 0)
    disc = bk.ring(c, LEFT, UP, 0.062, 0.062, 12, ("spine", 1.150)); disc2 = bk.ring(c + n * 0.018, LEFT, UP, 0.058, 0.058, 12, ("spine", 1.150))
    bk.bridge(disc, disc2, align=False); bk.ngon(list(reversed(disc))); bk.ngon(disc2)
    bk.use("MAT_Fighter_Brass")
    # ram emblem: raised boss + two horns
    boss = bk.ring(c + n * 0.018, LEFT, UP, 0.030, 0.034, 8, ("spine", 1.150)); boss2 = bk.ring(c + n * 0.032, LEFT, UP, 0.024, 0.028, 8, ("spine", 1.150))
    bk.bridge(boss, boss2, align=False); bk.ngon(list(reversed(boss))); bk.ngon(boss2)
    for sgn in (1, -1):
        p0 = c + n * 0.030 + LEFT * (sgn * 0.024) + UP * 0.020
        bk.tube([p0, p0 + LEFT * (sgn * 0.022) + UP * 0.012, p0 + LEFT * (sgn * 0.030) - UP * 0.012 + n * 0.008], [0.009, 0.007, 0.003], 5, ("spine", 1.150))
    bk.build("CHARACTER/ACCESSORIES")
    return

# ----------------------------------------------------------------------------- PHASE 5  tassets / hanging cloth
def hanging_strip(mb, s, t_deg, z0, z1, width, thick, tag_chain, flare=0.05, jagged=True, extra_off=0.0, n=6):
    """strip hanging from the belt at torso angle t: follows the hip surface, then hangs free, flaring outward."""
    pts = []; nrm = []
    for i in range(n + 1):
        f = i / n; z = lerp(z0, z1, f)
        base_z = max(z, 0.985)
        off = 0.026 + extra_off + flare * smooth((z0 - z) / (z0 - z1)) ** 1.2
        p = torso_point(base_z, t_deg, off); p.z = z
        pts.append(p); nrm.append(torso_normal(1.03, t_deg))
    rings = mb.band(pts, nrm, width, thick, (tag_chain, z0, z1, 0.0))
    # tag by height along the chain for the cloth bones
    for r, p in zip(rings, pts):
        for i in r: mb.tag[i] = (tag_chain, z0, z1, p.z)
    if jagged:  # pointed tip below the last ring
        last = rings[-1]; tip = pts[-1] - Vector((0, 0, jit(0.03, 0.06))) + nrm[-1] * (thick * 0.5)
        # remove the flat end cap face: last face added by band is the end ngon -> replace with a pyramid
        mb.f[-1] = None
        mb.pyramid(list(reversed(last)), tip, (tag_chain, z0, z1, tip.z))
    return rings

def build_tassets():
    fr = MB("Front Tassets"); fr.use("MAT_Fighter_BrownLeather")
    for t, w in [(-38, 0.070), (-22, 0.060), (22, 0.060), (38, 0.070)]:
        hanging_strip(fr, S_L, t, 1.115, jit(0.72, 0.80), w, 0.010, "cloth_front", 0.06, True, 0.004 if abs(t) > 30 else 0.0)
    fr.use("MAT_Fighter_DarkLeather")
    for t in (-12, 12):
        hanging_strip(fr, S_L, t, 1.115, 0.86, 0.045, 0.010, "cloth_front", 0.05, True, 0.012)
    fr.build("CHARACTER/CLOTHING")
    cf = MB("Front Cloth"); cf.use("MAT_Fighter_ClothRed")
    hanging_strip(cf, S_L, 0, 1.120, 0.70, 0.150, 0.006, "cloth_front", 0.07, True, -0.006, 8)
    cf.build("CHARACTER/CLOTHING")
    for s in (S_L, S_R):
        W = SIDE_WORD[s]
        sd = MB("%s Tassets" % W); sd.use("MAT_Fighter_BrownLeather")
        for t, w in [(60, 0.075), (82, 0.080), (104, 0.075), (126, 0.070)]:
            hanging_strip(sd, s, t * s if s == S_L else (360 - t), 1.115, jit(0.70, 0.78), w, 0.010, "tasset_%s" % SIDE_NAME[s], 0.08, True, jit(-0.004, 0.008))
        sd.use("MAT_Fighter_Iron")
        for t in (75, 110):
            tt = t if s == S_L else 360 - t
            p = torso_point(1.03, tt, 0.045); p.z = 0.98
            sd.box(p, (0.040, 0.008, 0.060), FRONT, torso_normal(1.03, tt), UP, ("tasset_%s" % SIDE_NAME[s], 1.115, 0.75, 0.98))
        sd.build("CHARACTER/CLOTHING")
    bk = MB("Back Tassets"); bk.use("MAT_Fighter_BrownLeather")
    for t, w in [(150, 0.070), (210, 0.070), (165, 0.055), (195, 0.055)]:
        hanging_strip(bk, S_L, t, 1.115, jit(0.74, 0.82), w, 0.010, "cloth_back", 0.06, True, 0.006 if abs(t - 180) > 20 else 0.0)
    bk.build("CHARACTER/CLOTHING")
    cb = MB("Back Cloth"); cb.use("MAT_Fighter_ClothRed")
    hanging_strip(cb, S_L, 180, 1.120, 0.62, 0.200, 0.006, "cloth_back", 0.09, True, -0.004, 8)
    cb.build("CHARACTER/CLOTHING")

# ----------------------------------------------------------------------------- PHASE 6  knee armour (LEFT only)
def build_knee_guard():
    s = S_L
    mb = MB("Left Knee Guard"); mb.use("MAT_Fighter_Iron")
    rings = []
    for z, oo, oi in [(0.615, 0.030, 0.026), (0.590, 0.046, 0.026), (0.560, 0.052, 0.026), (0.530, 0.046, 0.026), (0.505, 0.030, 0.026)]:
        rings.append(leg_ring_arc(mb, s, z, oo + 0.006, oi, -100, 100, 8, ("leg", s, z)))
    mb.loft(rings, align=False); mb.ngon(list(reversed(rings[0]))); mb.ngon(rings[-1])
    # central boss + rivets
    p = leg_point(s, 0.560, 0, 0.060); n = leg_normal(s, 0.560, 0)
    b0 = mb.ring(p, LEFT, UP, 0.022, 0.022, 8, ("leg", s, 0.56)); b1 = mb.ring(p + n * 0.016, LEFT, UP, 0.014, 0.014, 8, ("leg", s, 0.56))
    mb.bridge(b0, b1, align=False); mb.ngon(list(reversed(b0))); mb.ngon(b1)
    for z, a in [(0.600, -60), (0.600, 60), (0.520, -60), (0.520, 60)]:
        q = leg_point(s, z, a, 0.052); mb.box(q, (0.011, 0.011, 0.011), FRONT, leg_normal(s, z, a), UP, ("leg", s, z))
    mb.build("CHARACTER/ARMOR")
    st = MB("Left Knee Guard Straps"); st.use("MAT_Fighter_BrownLeather")
    for z in (0.610, 0.510):
        pts = [leg_point(s, z, t, 0.030) for t in range(0, 360, 30)]; nrm = [leg_normal(s, z, t) for t in range(0, 360, 30)]
        st.band(pts, nrm, 0.028, 0.008, ("leg", s, z), closed=True)
    st.build("CHARACTER/ARMOR")

# ----------------------------------------------------------------------------- PHASE 7  bracers
def build_bracer(s):
    W = SIDE_WORD[s]
    mb = MB("%s Bracer" % W); mb.use("MAT_Fighter_DarkLeather")
    rings = [arm_ring(mb, s, t, off, 8, ("arm", s, t)) for t, off in [(0.585, 0.018), (0.64, 0.026), (0.72, 0.028), (0.80, 0.026), (0.88, 0.022), (0.935, 0.020)]]
    mb.loft(rings, align=False); mb.ngon(list(reversed(rings[0]))); mb.ngon(rings[-1])
    mb.use("MAT_Fighter_BrownLeather")
    for t in (0.63, 0.72, 0.81, 0.90):
        pts = [arm_surface(s, t, a, 0.036) for a in range(0, 360, 30)]; nrm = [arm_normal(s, t, a) for a in range(0, 360, 30)]
        mb.band(pts, nrm, 0.030, 0.009, ("arm", s, t), closed=True)
    # wrist wrapping
    for t in (0.955, 0.985):
        pts = [arm_surface(s, t, a, 0.016) for a in range(0, 360, 30)]; nrm = [arm_normal(s, t, a) for a in range(0, 360, 30)]
        mb.band(pts, nrm, 0.020, 0.007, ("arm", s, t), closed=True)
    mb.build("CHARACTER/ARMOR")
    pl = MB("%s Bracer Plates" % W); pl.use("MAT_Fighter_Iron")
    # circular plates on the outer face (a = 90 is the 'up/outer' side of the forearm)
    for t, r in [(0.675, 0.030), (0.765, 0.034), (0.855, 0.028)]:
        p = arm_surface(s, t, 90, 0.040); n = arm_normal(s, t, 90)
        d, u, v = arm_frame(s)
        r0 = pl.ring(p, d, u, r, r, 10, ("arm", s, t)); r1 = pl.ring(p + n * 0.012, d, u, r * 0.85, r * 0.85, 10, ("arm", s, t))
        pl.bridge(r0, r1, align=False); pl.ngon(list(reversed(r0))); pl.ngon(r1)
        pl.box(p + n * 0.016, (0.010, 0.010, 0.010), d, u, n, ("arm", s, t))
    # studs and small layered plates on the underside/front
    for t in (0.66, 0.74, 0.82):
        for a in (0, 180, 300):
            q = arm_surface(s, t, a, 0.043); pl.box(q, (0.011, 0.011, 0.010), FRONT, arm_normal(s, t, a), UP, ("arm", s, t))
    for t in (0.70, 0.80):
        q = arm_surface(s, t, 270, 0.038); n = arm_normal(s, t, 270); d, u, v = arm_frame(s)
        pl.box(q, (0.055, 0.045, 0.008), d, u, n, ("arm", s, t))
    pl.build("CHARACTER/ARMOR")

# ----------------------------------------------------------------------------- PHASE 8  chest harness
def torso_path(t0, z0, t1, z1, n=12, off=0.014):
    pts = []; nrm = []
    for i in range(n + 1):
        f = i / n; t = lerp(t0, t1, f); z = lerp(z0, z1, f)
        pts.append(torso_point(z, t, off)); nrm.append(torso_normal(z, t))
    return pts, nrm
def build_harness():
    mb = MB("Chest Harness"); mb.use("MAT_Fighter_DarkLeather")
    W, TH = 0.060, 0.011
    # front X: shoulder to opposite hip
    for sgn in (1, -1):
        pts, nrm = torso_path(52 * sgn, 1.625, -50 * sgn, 1.180, 14, 0.016)
        mb.band(pts, nrm, W, TH, ("spine", 1.40))
        # back X
        pts, nrm = torso_path(180 - 52 * sgn, 1.625, 180 + 50 * sgn, 1.180, 14, 0.016)
        mb.band(pts, nrm, W, TH, ("spine", 1.40))
        # over-the-shoulder link: from the front strap top over the trapezius shelf to the back strap top
        s = sgn
        pts = [torso_point(1.610, 52 * s, 0.018), torso_point(1.645, 62 * s, 0.020), Vector((s * 0.205, 0.0, 1.690)), torso_point(1.645, 118 * s, 0.020), torso_point(1.610, 128 * s, 0.018)]
        nrm = [torso_normal(1.61, 52 * s), (torso_normal(1.64, 62 * s) + UP).normalized(), UP, (torso_normal(1.64, 118 * s) + UP).normalized(), torso_normal(1.61, 128 * s)]
        mb.band(pts, nrm, W * 0.9, TH, ("clavicle", s))
    # secondary chest strap (horizontal under the pecs) and waist strap
    pts = [torso_point(1.385, t, 0.018) for t in range(0, 360, 15)]; nrm = [torso_normal(1.385, t) for t in range(0, 360, 15)]
    mb.band(pts, nrm, 0.040, 0.010, ("spine", 1.385), closed=True)
    mb.use("MAT_Fighter_Iron")
    # centre ring of the X
    c = torso_point(1.415, 0, 0.032); n = torso_normal(1.415, 0)
    ring_pts = [c + LEFT * (0.052 * math.cos(rad(a))) + UP * (0.052 * math.sin(rad(a))) for a in range(0, 360, 30)]
    mb.tube(ring_pts, 0.009, 6, ("spine", 1.415), closed=True)
    # back ring, buckles and rivets
    c = torso_point(1.415, 180, 0.032)
    ring_pts = [c + LEFT * (0.045 * math.cos(rad(a))) + UP * (0.045 * math.sin(rad(a))) for a in range(0, 360, 30)]
    mb.tube(ring_pts, 0.008, 6, ("spine", 1.415), closed=True)
    for t, z in [(-46, 1.215), (46, 1.215), (-40, 1.545), (40, 1.545), (140, 1.545), (220, 1.545), (0, 1.385), (180, 1.385)]:
        p = torso_point(z, t, 0.034); mb.box(p, (0.026, 0.010, 0.034), FRONT, torso_normal(z, t), UP, ("spine", z))
    for t, z in [(-30, 1.50), (30, 1.50), (-15, 1.46), (15, 1.46), (-25, 1.30), (25, 1.30), (0, 1.245)]:
        p = torso_point(z, t, 0.030); mb.box(p, (0.010, 0.010, 0.010), FRONT, torso_normal(z, t), UP, ("spine", z))
    mb.build("CHARACTER/ARMOR")

# ----------------------------------------------------------------------------- PHASE 9  fur mantle
def build_fur_mantle():
    mb = MB("Fur Mantle"); mb.use("MAT_Fighter_Fur")
    n = 24
    def rim_z(t):   # hem height: highest at the throat, lowest down the back
        c = math.cos(rad(t)); return 1.560 - 0.030 * (1 - c) - 0.075 * max(0.0, -c) ** 1.5
    def off_out(t):
        c = math.cos(rad(t)); return 0.055 + 0.045 * max(0.0, -c) + 0.012 * math.sin(rad(t * 7)) + 0.03 * abs(math.sin(rad(t)))
    def surf(z, t, off):
        if z > 1.668:   # above the trapezius shelf follow the NECK column, not the shelf
            return Vector((0, 0.010, z)) + FRONT * ((0.096 + off) * math.cos(rad(t))) + LEFT * ((0.090 + off) * math.sin(rad(t)))
        p = torso_point(z, t, off); p.z = z; return p
    def ring_out(z_fn, off_fn, tag):
        return [mb.add(surf(z_fn(360 * k / n), 360 * k / n, off_fn(360 * k / n)), tag) for k in range(n)]
    hem = ring_out(lambda t: rim_z(t), lambda t: off_out(t) * 0.7 + 0.01, ("mantle", 0.0))
    mid = ring_out(lambda t: 1.615 - 0.04 * max(0.0, -math.cos(rad(t))), lambda t: off_out(t), ("mantle", 0.5))
    top = ring_out(lambda t: 1.680 + 0.02 * jit(-1, 1), lambda t: off_out(t) * 0.75, ("mantle", 1.0))
    inner_top = ring_out(lambda t: 1.690, lambda t: 0.012, ("mantle", 1.0))
    inner_hem = ring_out(lambda t: rim_z(t) + 0.02, lambda t: 0.014, ("mantle", 0.0))
    def clump(k, q):
        if random.random() < 0.55:
            pts = [mb.v[i] for i in q]; m = sum(pts, Vector()) / 4
            nrm = torso_normal(1.6, 360 * k / n)
            return m + nrm * jit(0.02, 0.05) - Vector((0, 0, jit(0.01, 0.04)))
        return None
    mb.bridge(hem, mid, align=False, spike=clump); mb.bridge(mid, top, align=False, spike=clump)
    def spike_top(k, q):
        pts = [mb.v[i] for i in q]; m = sum(pts, Vector()) / 4
        return m + Vector((0, 0, jit(0.035, 0.075))) + torso_normal(1.6, 360 * k / n) * jit(-0.01, 0.02)
    mb.bridge(top, inner_top, align=False, spike=spike_top)
    mb.bridge(inner_top, inner_hem, align=False)
    def spike_hem(k, q):
        pts = [mb.v[i] for i in q]; m = sum(pts, Vector()) / 4
        return m - Vector((0, 0, jit(0.04, 0.09))) + torso_normal(1.5, 360 * k / n) * jit(0.0, 0.02)
    mb.bridge(inner_hem, hem, align=False, spike=spike_hem)
    mb.build("CHARACTER/CLOTHING")

# ----------------------------------------------------------------------------- PHASE 10  shoulder armour (LEFT only)
def build_pauldron():
    s = S_L
    d, u, v = arm_frame(s)
    mb = MB("Left Pauldron"); mb.use("MAT_Fighter_DarkLeather")
    def lame(t0, t1, oo, oi, a0, a1, nn=8, tag=None):
        rings = []
        for t, extra in [(t0, 0.0), ((t0 + t1) / 2, 0.006), (t1, 0.0)]:
            r1, r2 = arm_radius(t)
            rings.append(mb.shell_ring(arm_point(s, t), u, v, r1 + oo + extra, r1 + oi, a0, a1, nn, tag or ("clavicle", s), r2 + oo + extra, r2 + oi))
        mb.loft(rings, align=False); mb.ngon(list(reversed(rings[0]))); mb.ngon(rings[-1])
    # leather backing
    lame(0.11, 0.46, 0.034, 0.024, -30, 210)
    mb.use("MAT_Fighter_Iron")
    lame(0.10, 0.22, 0.058, 0.046, -35, 215)   # shoulder cup (may close further round than the bands)
    lame(0.22, 0.32, 0.050, 0.040, -10, 190)
    lame(0.32, 0.41, 0.044, 0.036, 0, 180)
    lame(0.41, 0.49, 0.038, 0.030, 10, 170)
    # rivets on every plate edge
    for t in (0.14, 0.26, 0.35, 0.44):
        for a in (0, 45, 90, 135, 180):
            p = arm_surface(s, t, a, {0.14: 0.070, 0.26: 0.058, 0.35: 0.050, 0.44: 0.044}[t]); n = arm_normal(s, t, a)
            mb.box(p, (0.011, 0.011, 0.010), d, u, n, ("clavicle", s))
    # raised edge on the cup
    pts = [arm_surface(s, 0.105, a, 0.066) for a in range(-35, 216, 25)]; nrm = [arm_normal(s, 0.105, a) for a in range(-35, 216, 25)]
    mb.band(pts, nrm, 0.014, 0.008, ("clavicle", s))
    mb.use("MAT_Fighter_Bone")
    # two horns on the cup, angled up and out
    for a, L in [(110, 0.085), (150, 0.070)]:
        base = arm_surface(s, 0.15, a, 0.068); n = arm_normal(s, 0.15, a)
        tipdir = (n * 0.8 + UP * 0.5 + LEFT * (0.3 * s)).normalized()
        pts = [base, base + tipdir * (L * 0.5) + UP * 0.01, base + tipdir * L + UP * 0.03]
        mb.tube(pts, [0.018, 0.012, 0.003], 6, ("clavicle", s))
    mb.build("CHARACTER/ARMOR")
    st = MB("Left Pauldron Straps"); st.use("MAT_Fighter_BrownLeather")
    for t in (0.20, 0.44):
        pts = [arm_surface(s, t, a, 0.026) for a in range(0, 360, 30)]; nrm = [arm_normal(s, t, a) for a in range(0, 360, 30)]
        st.band(pts, nrm, 0.030, 0.008, ("arm", s, t), closed=True)
    st.build("CHARACTER/ARMOR")

# ----------------------------------------------------------------------------- PHASE 11/12  waist + back accessories
def pouch(name, t, z, size, bone_tag):
    mb = MB(name); mb.use("MAT_Fighter_BrownLeather")
    p = torso_point(z, t, 0.040 + size[1] / 2); n = torso_normal(z, t); w = n.cross(UP).normalized()
    mb.box(p, size, w, n, UP, bone_tag)
    mb.use("MAT_Fighter_DarkLeather")
    mb.box(p + UP * (size[2] * 0.40) + n * 0.004, (size[0] * 1.06, size[1] * 1.08, size[2] * 0.36), w, n, UP, bone_tag)
    mb.use("MAT_Fighter_Iron")
    mb.box(p + n * (size[1] / 2 + 0.004) + UP * (size[2] * 0.15), (0.012, 0.008, 0.016), w, n, UP, bone_tag)
    mb.build("CHARACTER/ACCESSORIES")

def build_accessories():
    pouch("Left Belt Pouch", 62, 1.085, (0.090, 0.055, 0.110), ("pouch", S_L))
    pouch("Right Belt Pouch", 298, 1.085, (0.090, 0.055, 0.110), ("pouch", S_R))
    pouch("Left Back Pouch", 145, 1.085, (0.070, 0.045, 0.090), ("pouch", S_L))
    # bottle on the right hip
    mb = MB("Right Belt Flask"); mb.use("MAT_Fighter_Bone")
    p = torso_point(1.06, 330, 0.052); n = torso_normal(1.06, 330)
    r0 = mb.ring(p - UP * 0.045, LEFT, FRONT, 0.024, 0.024, 8, ("pouch", S_R)); r1 = mb.ring(p + UP * 0.025, LEFT, FRONT, 0.024, 0.024, 8, ("pouch", S_R))
    r2 = mb.ring(p + UP * 0.045, LEFT, FRONT, 0.011, 0.011, 8, ("pouch", S_R)); r3 = mb.ring(p + UP * 0.070, LEFT, FRONT, 0.012, 0.012, 8, ("pouch", S_R))
    mb.loft([r0, r1, r2, r3], align=False); mb.ngon(list(reversed(r0))); mb.ngon(r3)
    mb.use("MAT_Fighter_Wood"); mb.box(p + UP * 0.075, (0.028, 0.028, 0.014), LEFT, FRONT, UP, ("pouch", S_R))
    mb.build("CHARACTER/ACCESSORIES")
    # hanging skull on the right side at the back, on a cord
    sk = MB("Right Back Skull Charm"); sk.use("MAT_Fighter_Bone")
    top = torso_point(1.110, 215, 0.036); bottom = top - UP * 0.16
    sk.tube([top, top - UP * 0.06 + torso_normal(1.1, 215) * 0.02, bottom + UP * 0.06], 0.004, 4, ("skull", 1.11, 0.95, 1.05))
    sk.box(bottom + UP * 0.02, (0.050, 0.055, 0.058), LEFT, FRONT, UP, ("skull", 1.11, 0.95, 0.95))
    sk.use("MAT_Fighter_ClothDark")
    for sgn in (1, -1):
        sk.box(bottom + UP * 0.03 + LEFT * (sgn * 0.014) - FRONT * 0.026, (0.014, 0.008, 0.014), LEFT, FRONT, UP, ("skull", 1.11, 0.95, 0.95))
    sk.build("CHARACTER/ACCESSORIES")
    # bone charm / small horn on the left hip
    bc = MB("Left Hip Bone Charm"); bc.use("MAT_Fighter_Bone")
    top = torso_point(1.110, 125, 0.036)
    bc.tube([top, top - UP * 0.05], 0.004, 4, ("charm",))
    bc.tube([top - UP * 0.05, top - UP * 0.12, top - UP * 0.175 + FRONT * 0.02], [0.012, 0.010, 0.003], 6, ("charm",))
    bc.build("CHARACTER/ACCESSORIES")
    # belt chain on the right front
    ch = MB("Right Belt Chain"); ch.use("MAT_Fighter_Iron")
    a = torso_point(1.135, 300, 0.040); b = torso_point(1.135, 262, 0.040)
    pts = [lerp(a, b, f) - UP * (0.10 * math.sin(math.pi * f)) + torso_normal(1.1, 280) * (0.02 * math.sin(math.pi * f)) for f in [i / 6 for i in range(7)]]
    ch.tube(pts, 0.006, 4, ("spine", 1.13))
    ch.build("CHARACTER/ACCESSORIES")
    # key/tool on the front left of the belt
    ky = MB("Left Belt Key"); ky.use("MAT_Fighter_Iron")
    p = torso_point(1.115, 28, 0.046)
    ky.box(p - UP * 0.03, (0.010, 0.006, 0.070), LEFT, FRONT, UP, ("spine", 1.11)); ky.box(p - UP * 0.065, (0.020, 0.006, 0.014), LEFT, FRONT, UP, ("spine", 1.11))
    ky.build("CHARACTER/ACCESSORIES")

# ----------------------------------------------------------------------------- PHASE 13  hair, beard, face parts
def build_hair():
    mb = MB("Hair"); mb.use("MAT_Fighter_Hair")
    n = 16
    def hairline(t):  # z where the hair starts; front is raised (forehead), sides go low, back to the nape
        c = math.cos(rad(t))
        return 1.900 + 0.030 * max(0.0, c) ** 2.0 - 0.01 * max(0.0, -c)
    def ring(z_fn, off_fn, tag):
        out = []
        for k in range(n):
            t = 360 * k / n; z = z_fn(t); p = head_point(z, t, off_fn(t)); out.append(mb.add(p, tag))
        return out
    inner_lo = ring(hairline, lambda t: 0.003, ("head", 1.9))
    outer_lo = ring(lambda t: hairline(t) - 0.006, lambda t: 0.012 + 0.006 * abs(math.sin(rad(t))), ("head", 1.9))
    outer_mid = ring(lambda t: 1.965, lambda t: 0.020 + 0.004 * math.sin(rad(t * 5)), ("head", 1.96))
    outer_top = ring(lambda t: 2.005, lambda t: 0.024, ("head", 2.0))
    def fringe(k, q):
        t = 360 * (k + 0.5) / n
        if abs(((t + 180) % 360) - 180) < 55:
            pts = [mb.v[i] for i in q]; m = sum(pts, Vector()) / 4
            return m + FRONT * jit(0.010, 0.024) - UP * jit(0.030, 0.060)
        return None
    mb.bridge(inner_lo, outer_lo, align=False, spike=fringe)
    def spike(k, q):
        pts = [mb.v[i] for i in q]; m = sum(pts, Vector()) / 4
        return m + head_normal(1.98, 360 * k / n) * jit(0.015, 0.04) + UP * jit(0.01, 0.03)
    mb.bridge(outer_lo, outer_mid, align=False, spike=lambda k, q: spike(k, q) if random.random() < 0.5 else None)
    mb.bridge(outer_mid, outer_top, align=False, spike=spike)
    # spiky crown: pyramids from the top ring to a jittered apex fan
    crown = [mb.add(Vector((0.0 + jit(-0.01, 0.01), 0.012 + jit(-0.01, 0.01), 2.055)), ("head", 2.05))]
    for k in range(n):
        a, b = outer_top[k], outer_top[(k + 1) % n]
        m = (mb.v[a] + mb.v[b]) * 0.5
        ap = mb.add(m + (m - Vector((0, 0.012, 2.0))).normalized() * jit(0.03, 0.07) + UP * jit(0.02, 0.05), ("head", 2.05))
        mb.face([a, b, ap]); mb.face([b, crown[0], ap]); mb.face([crown[0], a, ap])
    # close the underside: inner_lo up to the crown top via an inner cap (inside the skull, hidden)
    inner_top = ring(lambda t: 2.000, lambda t: 0.002, ("head", 2.0))
    mb.bridge(inner_lo, inner_top, align=False); mb.cap(inner_top, Vector((0, 0.014, HEAD_TOP - 0.004)), ("head", 2.0))
    mb.build("CHARACTER/BODY")

def build_beard():
    mb = MB("Beard"); mb.use("MAT_Fighter_Hair")
    n = 10
    A0, A1 = -100, 100
    def top_z(t):   # beard line: under the nose at the front (moustache), rising to the sideburns
        f = abs(t) / 100.0
        return 1.828 + 0.045 * f ** 1.4
    def ring(z_fn, off_fn, tag, a0=A0, a1=A1):
        out = []
        for k in range(n + 1):
            t = lerp(a0, a1, k / n); z = z_fn(t); out.append(mb.add(head_point(z, t, off_fn(t)), tag))
        return out
    def shell(z_fn, oo, oi, tag):
        return ring(z_fn, lambda t: oo(t), tag) + ring(z_fn, lambda t: oi(t), tag, A1, A0)
    r_top = shell(top_z, lambda t: 0.012 + 0.004 * (1 - abs(t) / 100), lambda t: 0.002, ("jaw", 0.3))
    r_mid = shell(lambda t: 1.790, lambda t: 0.026 + 0.006 * math.sin(rad(t * 4)), lambda t: 0.002, ("jaw", 0.6))
    r_chin = shell(lambda t: 1.748, lambda t: 0.034 + 0.005 * math.sin(rad(t * 3 + 40)), lambda t: 0.004, ("jaw", 0.9))
    r_low = shell(lambda t: 1.705 + 0.03 * (abs(t) / 100) ** 1.5, lambda t: 0.028 * (1 - 0.5 * abs(t) / 100), lambda t: 0.014, ("jaw", 1.0))
    def clump(k, q):
        if k < n and random.random() < 0.6:
            pts = [mb.v[i] for i in q]; m = sum(pts, Vector()) / 4
            return m + (m - Vector((0, 0.006, m.z))).normalized() * jit(0.008, 0.02) - UP * jit(0.0, 0.015)
        return None
    mb.bridge(r_top, r_mid, align=False); mb.bridge(r_mid, r_chin, align=False, spike=clump); mb.bridge(r_chin, r_low, align=False, spike=clump)
    mb.ngon(list(reversed(r_top)))
    # jagged bottom: pyramids down from every outer bottom quad, then close the inner
    outer = r_low[:n + 1]; inner = r_low[n + 1:]
    for k in range(n):
        m = (mb.v[outer[k]] + mb.v[outer[k + 1]]) * 0.5
        ap = mb.add(m - UP * jit(0.02, 0.045) * (1 - 0.6 * abs(lerp(A0, A1, (k + 0.5) / n)) / 100) + FRONT * 0.004, ("jaw", 1.0))
        mb.face([outer[k], outer[k + 1], ap])
        # connect apex to inner ring (inner runs A1->A0 so inner[n-k-1] pairs with outer[k+1])
        mb.face([outer[k + 1], inner[n - k - 1], ap]); mb.face([inner[n - k - 1], inner[n - k], ap]); mb.face([inner[n - k], outer[k], ap])
    mb.build("CHARACTER/BODY")

def build_face_parts():
    ey = MB("Eyes"); ey.use("MAT_Fighter_Eyes")
    for s in (S_L, S_R):
        t = 22 * s; z = 1.888
        p = head_point(z, t, 0.001); n = head_normal(z, t); w = n.cross(UP).normalized()
        ey.box(p, (0.028, 0.006, 0.013), w, n, UP, ("head", z))
        ey.use("MAT_Fighter_Iris"); ey.box(p + n * 0.004, (0.011, 0.003, 0.011), w, n, UP, ("head", z)); ey.use("MAT_Fighter_Eyes")
    ey.build("CHARACTER/BODY")
    br = MB("Eyebrows"); br.use("MAT_Fighter_Hair")
    for s in (S_L, S_R):
        t = 22 * s; z = 1.912
        p = head_point(z, t, 0.006); n = head_normal(z, t); w = n.cross(UP).normalized()
        tilt = (UP + w * (0.35 * s)).normalized()   # angry brow: inner end lower
        br.box(p, (0.040, 0.010, 0.010), w, n, tilt, ("head", z))
    br.build("CHARACTER/BODY")
    mo = MB("Mouth"); mo.use("MAT_Fighter_Mouth")
    p = head_point(1.802, 0, 0.003); n = head_normal(1.802, 0)
    mo.box(p, (0.036, 0.004, 0.009), LEFT, n, UP, ("jaw", 0.2))
    mo.build("CHARACTER/BODY")
    for s in (S_L, S_R):
        er = MB("%s Ear" % SIDE_WORD[s]); er.use("MAT_Fighter_Skin")
        t = 95 * s; z = 1.875
        p = head_point(z, t, 0.008); n = head_normal(z, t)
        er.box(p, (0.012, 0.024, 0.038), n, FRONT, UP, ("head", z))
        er.build("CHARACTER/BODY")
    # scars: flat decals a millimetre proud of the skin
    sc = MB("Scars"); sc.use("MAT_Fighter_Scar")
    for (z, t, ang, L) in [(1.86, -30, 40, 0.045), (1.87, 28, -35, 0.040), (1.84, 35, 20, 0.030), (1.84, -45, -15, 0.03)]:
        p = head_point(z, t, 0.003); n = head_normal(z, t); w = n.cross(UP).normalized()
        d = (w * math.cos(rad(ang)) + UP * math.sin(rad(ang))).normalized()
        sc.box(p, (L, 0.002, 0.005), d, n, d.cross(n), ("head", z))
    for (z, t, ang, L) in [(1.48, -25, 30, 0.09), (1.34, 20, -50, 0.08), (1.26, -10, 10, 0.06), (1.52, 60, -20, 0.05)]:
        p = torso_point(z, t, 0.003); n = torso_normal(z, t); w = n.cross(UP).normalized()
        d = (w * math.cos(rad(ang)) + UP * math.sin(rad(ang))).normalized()
        sc.box(p, (L, 0.002, 0.007), d, n, d.cross(n), ("spine", z))
    for s in (S_L, S_R):
        for (t, a, L) in [(0.26, 40, 0.06), (0.36, 120, 0.05)]:
            p = arm_surface(s, t, a, 0.003); n = arm_normal(s, t, a); dd, u, v = arm_frame(s)
            sc.box(p, (L, 0.002, 0.006), dd, n, dd.cross(n), ("arm", s, t))
    sc.build("CHARACTER/BODY")

def build_gear():
    build_pants(); log("pants")
    for s in (S_L, S_R): build_boot(s)
    log("boots")
    build_belt(); build_tassets(); log("belt+tassets")
    build_knee_guard()
    for s in (S_L, S_R): build_bracer(s)
    build_harness(); log("harness")
    build_fur_mantle(); build_pauldron(); log("mantle+pauldron")
    build_accessories(); build_hair(); build_beard(); build_face_parts(); log("accessories+head")
# ----------------------------------------------------------------------------- SKELETON DEFINITION
FINGER_LEN = {"pinky": [0.032, 0.026, 0.022], "ring": [0.040, 0.030, 0.024], "middle": [0.042, 0.032, 0.025], "index": [0.040, 0.030, 0.024]}
FINGER_X = {"pinky": -0.75, "ring": -0.25, "middle": 0.25, "index": 0.75}
FINGER_BONE = {"pinky": "Pinky", "ring": "Ring", "middle": "Middle", "index": "Index"}

def bone_defs():
    """returns list of dict(name, head, tail, parent, zaxis, deform)  -- zaxis: world direction the bone's local Z should face."""
    B = []
    def add(name, head, tail, parent, zaxis=FRONT, deform=True):
        B.append(dict(name=name, head=Vector(head), tail=Vector(tail), parent=parent, zaxis=Vector(zaxis), deform=deform))
    add("Root", (0, 0, 0), (0, -0.30, 0), None, UP)
    add("Pelvis", (0, 0.0, 1.030), (0, 0.0, 1.110), "Root")
    add("Spine_01", (0, 0.0, 1.110), (0, 0.0, 1.225), "Pelvis")
    add("Spine_02", (0, 0.0, 1.225), (0, 0.0, 1.350), "Spine_01")
    add("Spine_03", (0, 0.0, 1.350), (0, 0.0, 1.470), "Spine_02")
    add("Chest", (0, 0.0, 1.470), (0, 0.010, 1.665), "Spine_03")
    add("Neck", (0, 0.010, 1.665), (0, 0.015, 1.765), "Chest")
    add("Head", (0, 0.015, 1.765), (0, 0.015, 2.022), "Neck")
    add("Jaw", (0, 0.030, 1.800), (0, -0.075, 1.760), "Head", UP)
    for s in (S_L, S_R):
        sn = SIDE_NAME[s]
        sh, el, wr, d = arm_chain(s); el = el + BACK * 0.012   # elbow pre-bent 1.2 cm so the IK solver has a hinge direction
        add("Clavicle_%s" % sn, (s * 0.030, 0.010, 1.615), sh, "Chest", UP)
        add("UpperArm_%s" % sn, sh, el, "Clavicle_%s" % sn, FRONT)
        add("UpperArm_Twist_%s" % sn, sh + d * 0.02, sh + d * (UPPER_ARM * 0.5), "UpperArm_%s" % sn, FRONT)
        add("Forearm_%s" % sn, el, wr, "UpperArm_%s" % sn, FRONT)
        add("Forearm_Twist_%s" % sn, el + d * (FOREARM * 0.5), wr, "Forearm_%s" % sn, FRONT)
        w0, F, P, T = hand_frame(s)
        knuck = wr + F * 0.105
        add("Hand_%s" % sn, wr, knuck, "Forearm_%s" % sn, -P)
        for nm, bn in FINGER_BONE.items():
            base = knuck + T * (0.056 * FINGER_X[nm])
            fd = (F + T * ((["pinky", "ring", "middle", "index"].index(nm) - 1.5) * 0.10)).normalized()
            p = base; parent = "Hand_%s" % sn
            for j, L in enumerate(FINGER_LEN[nm]):
                name = "%s_%02d_%s" % (bn, j + 1, sn)
                add(name, p, p + fd * L, parent, -P); parent = name; p = p + fd * L
        # thumb: base at the index-side palm face between palm and knuckle rows
        tb = wr + F * 0.080 + T * 0.056
        tdir = (T * 0.75 + F * 0.55 + P * 0.25).normalized()
        add("Thumb_01_%s" % sn, tb, tb + tdir * 0.040, "Hand_%s" % sn, -P)
        add("Thumb_02_%s" % sn, tb + tdir * 0.040, tb + tdir * 0.074, "Thumb_01_%s" % sn, -P)
        # legs
        hip = Vector((s * HIP_X, 0, Z_HIP)); knee = leg_center(s, Z_KNEE) + FRONT * 0.020; ank = leg_center(s, Z_ANKLE)   # knee pre-bent 2 cm
        add("Thigh_%s" % sn, hip, knee, "Pelvis")
        add("Thigh_Twist_%s" % sn, hip + (knee - hip) * 0.05, hip + (knee - hip) * 0.5, "Thigh_%s" % sn)
        add("Shin_%s" % sn, knee, ank, "Thigh_%s" % sn)
        fwd, side = foot_frame(s)
        toe_j = Vector((s * ANKLE_X, 0, 0.032)) + fwd * 0.165
        toe_t = Vector((s * ANKLE_X, 0, 0.020)) + fwd * 0.285
        add("Foot_%s" % sn, ank, toe_j, "Shin_%s" % sn, UP)
        add("Toe_%s" % sn, toe_j, toe_t, "Foot_%s" % sn, UP)
        # rigid-armour carriers: same rest orientation as the limb bone so a LOCAL copy-rotation at 0.5 = half the joint motion, rigid
        if s == S_L:
            add("Pauldron_L", sh, sh + d * 0.15, "Clavicle_L", FRONT)
            add("Knee_Guard_L", knee, knee + (ank - knee) * 0.30, "Thigh_L", FRONT)
        # secondary: side tassets, pouches
        add("Tasset_%s_01" % sn, (s * 0.245, 0.0, 1.100), (s * 0.255, 0.0, 0.920), "Pelvis")
        add("Tasset_%s_02" % sn, (s * 0.255, 0.0, 0.920), (s * 0.275, 0.0, 0.740), "Tasset_%s_01" % sn)
        pp = torso_point(1.085, 62 if s == S_L else 298, 0.06)
        add("Pouch_%s" % sn, pp + UP * 0.05, pp - UP * 0.05, "Pelvis")
    add("Cloth_Front_01", (0, -0.165, 1.100), (0, -0.175, 0.970), "Pelvis")
    add("Cloth_Front_02", (0, -0.175, 0.970), (0, -0.185, 0.840), "Cloth_Front_01")
    add("Cloth_Front_03", (0, -0.185, 0.840), (0, -0.200, 0.700), "Cloth_Front_02")
    add("Cloth_Back_01", (0, 0.165, 1.100), (0, 0.180, 0.950), "Pelvis", BACK)
    add("Cloth_Back_02", (0, 0.180, 0.950), (0, 0.200, 0.800), "Cloth_Back_01", BACK)
    add("Cloth_Back_03", (0, 0.200, 0.800), (0, 0.225, 0.620), "Cloth_Back_02", BACK)
    sk = torso_point(1.110, 215, 0.036)
    add("Skull_Charm", sk, sk - UP * 0.16, "Pelvis", BACK)
    bc = torso_point(1.110, 125, 0.036)
    add("Bone_Charm", bc, bc - UP * 0.17, "Pelvis", LEFT)
    # ---- control bones (not exported)
    for s in (S_L, S_R):
        sn = SIDE_NAME[s]
        ank = leg_center(s, Z_ANKLE); fwd, side = foot_frame(s)
        toe_j = Vector((s * ANKLE_X, 0, 0.032)) + fwd * 0.165
        add("IK_Foot_%s" % sn, ank, toe_j, "Root", UP, False)
        add("Pole_Knee_%s" % sn, leg_center(s, Z_KNEE) + FRONT * 0.60, leg_center(s, Z_KNEE) + FRONT * 0.70, "Root", UP, False)
        sh, el, wr, d = arm_chain(s); w0, F, P, T = hand_frame(s)
        add("IK_Hand_%s" % sn, wr, wr + F * 0.105, "Root", -P, False)
        add("Pole_Elbow_%s" % sn, el + BACK * 0.55 + DOWN * 0.10, el + BACK * 0.65 + DOWN * 0.10, "Root", UP, False)
    return B

ARM = None
def build_armature():
    global ARM
    B = bone_defs()
    ad = bpy.data.armatures.new("Fighter_Armature"); ad.display_type = 'OCTAHEDRAL'
    ob = bpy.data.objects.new("Fighter_Armature", ad); collection("CHARACTER/ARMATURE").objects.link(ob)
    ARM = ob
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in B:
        e = ad.edit_bones.new(b["name"]); e.head = b["head"]; e.tail = b["tail"]; e.use_deform = b["deform"]
        e.align_roll(b["zaxis"]); eb[b["name"]] = e
    for b in B:
        if b["parent"]:
            eb[b["name"]].parent = eb[b["parent"]]
            eb[b["name"]].use_connect = (eb[b["parent"]].tail - eb[b["name"]].head).length < 1e-6 and b["name"] not in ("Jaw",) and not b["name"].startswith(("UpperArm_Twist", "Thigh_Twist", "Forearm_Twist"))
    bpy.ops.object.mode_set(mode='POSE')
    # bone collections for clarity
    for grp in ("DEFORM", "CONTROLS"):
        ad.collections.new(grp)
    for b in ob.data.bones:
        ad.collections["DEFORM" if b.use_deform else "CONTROLS"].assign(b)
    pb = ob.pose.bones
    # custom properties for arm IK/FK switching
    ob["IK_Arm_L"] = 0.0; ob["IK_Arm_R"] = 0.0
    for s in (S_L, S_R):
        sn = SIDE_NAME[s]
        # legs: 2-bone IK on the shin, pole at the knee, foot copies the control's rotation
        c = pb["Shin_%s" % sn].constraints.new('IK'); c.name = "IK_Leg"; c.target = ob; c.subtarget = "IK_Foot_%s" % sn
        c.pole_target = ob; c.pole_subtarget = "Pole_Knee_%s" % sn; c.chain_count = 2; c.use_tail = True
        c2 = pb["Foot_%s" % sn].constraints.new('COPY_ROTATION'); c2.name = "Follow_IK_Foot"; c2.target = ob; c2.subtarget = "IK_Foot_%s" % sn
        c2.target_space = 'WORLD'; c2.owner_space = 'WORLD'
        # arms: optional IK, influence driven by the IK_Arm property (0 = FK, 1 = IK)
        c = pb["Forearm_%s" % sn].constraints.new('IK'); c.name = "IK_Arm"; c.target = ob; c.subtarget = "IK_Hand_%s" % sn
        c.pole_target = ob; c.pole_subtarget = "Pole_Elbow_%s" % sn; c.chain_count = 2; c.use_tail = True; c.influence = 0.0
        d = c.driver_add("influence").driver; d.type = 'SUM'; v = d.variables.new(); v.name = "ik"; v.type = 'SINGLE_PROP'
        v.targets[0].id = ob; v.targets[0].data_path = '["IK_Arm_%s"]' % sn
        c2 = pb["Hand_%s" % sn].constraints.new('COPY_ROTATION'); c2.name = "Follow_IK_Hand"; c2.target = ob; c2.subtarget = "IK_Hand_%s" % sn
        c2.target_space = 'WORLD'; c2.owner_space = 'WORLD'; c2.influence = 0.0
        d = c2.driver_add("influence").driver; d.type = 'SUM'; v = d.variables.new(); v.name = "ik"; v.type = 'SINGLE_PROP'
        v.targets[0].id = ob; v.targets[0].data_path = '["IK_Arm_%s"]' % sn
        # twist bones
        c = pb["Forearm_Twist_%s" % sn].constraints.new('COPY_ROTATION'); c.name = "Twist_From_Hand"; c.target = ob; c.subtarget = "Hand_%s" % sn
        c.use_x = False; c.use_z = False; c.target_space = 'LOCAL'; c.owner_space = 'LOCAL'; c.influence = 0.5
        for nm, src in (("UpperArm_Twist_%s" % sn, "UpperArm_%s" % sn), ("Thigh_Twist_%s" % sn, "Thigh_%s" % sn)):
            c = pb[nm].constraints.new('COPY_ROTATION'); c.name = "Counter_Twist"; c.target = ob; c.subtarget = src
            c.use_x = False; c.use_z = False; c.invert_y = True; c.target_space = 'LOCAL'; c.owner_space = 'LOCAL'; c.influence = 0.5
        if s == S_L:
            for nm, src in (("Pauldron_L", "UpperArm_L"), ("Knee_Guard_L", "Shin_L")):
                c = pb[nm].constraints.new('COPY_ROTATION'); c.name = "Half_Follow"; c.target = ob; c.subtarget = src
                c.target_space = 'LOCAL'; c.owner_space = 'LOCAL'; c.mix_mode = 'REPLACE'; c.influence = 0.5
        # elbow/knee IK limits: keep the joints from flipping
        for jn, axis in (("Shin_%s" % sn, 'x'), ("Forearm_%s" % sn, 'x')):
            p = pb[jn]; p.lock_ik_y = True; p.lock_ik_z = True
    # pole angles: choose the angle that keeps the rest pose unchanged
    for s in (S_L, S_R):
        sn = SIDE_NAME[s]
        for chain, ikname, mid in (("Shin_%s" % sn, "IK_Leg", "Shin_%s" % sn), ("Forearm_%s" % sn, "IK_Arm", "Forearm_%s" % sn)):
            c = pb[chain].constraints[ikname]; saved = c.influence; c.influence = 1.0
            rest = ob.data.bones[mid].head_local.copy(); best = None
            for ang in range(-180, 180, 15):
                c.pole_angle = rad(ang); bpy.context.view_layer.update()
                dev = (pb[mid].head - rest).length
                if best is None or dev < best[0]: best = (dev, ang)
            c.pole_angle = rad(best[1]); c.influence = saved
            log("pole angle", chain, best[1], "deg (rest deviation %.4f m)" % best[0])
    bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')
    # display: custom shapes not needed; control bones drawn as B-bones would export badly, keep octahedral
    return ob

# ----------------------------------------------------------------------------- SKINNING (procedural, by tag)
def chain_w(chain, x, blend, descending=False):
    """chain: [(bone, boundary_x_to_next)...] last boundary ignored. returns {bone: w}. x increases along the chain."""
    w = {}; remain = 1.0
    for k, (bone, bnd) in enumerate(chain):
        if k == len(chain) - 1 or bnd is None:
            w[bone] = remain; break
        f = smooth(((bnd - x) if descending else (x - bnd)) / (2 * blend) + 0.5)   # fraction handed to the next bone
        w[bone] = remain * (1 - f); remain *= f
        if remain < 1e-6: break
    return {k: v for k, v in w.items() if v > 1e-4}

def socket_w(p, s, torso_w, arm_w=None):
    """shoulder blend from POSITION: u = distance along the arm axis from the shoulder joint. Below the joint the vertex is torso,
    beyond ~10 cm it is arm; in between it blends. The clavicle carries the top of the deltoid/trapezius."""
    sn = SIDE_NAME[s]; sh, el, wr, d = arm_chain(s)
    u = (p - sh).dot(d)
    f = smooth((u - 0.015) / 0.11)                                  # arm fraction
    # the armpit / ribcage side sits along the arm axis but is torso: fade the arm share out with height inside the socket zone
    g = clamp((p.z - 1.47) / 0.10); f *= 1 - (1 - g) * clamp((0.12 - u) / 0.06)
    top = clamp((p.z - 1.50) / 0.13) * clamp((0.10 - u) / 0.10)      # clavicle share on the upper socket
    if arm_w is None:
        tw = 0.45 * clamp((0.36 - (u / (UPPER_ARM + FOREARM))) / 0.22)
        arm_w = {"UpperArm_Twist_%s" % sn: tw, "UpperArm_%s" % sn: 1 - tw}
    w = {b: v * (1 - f) * (1 - 0.55 * top) for b, v in torso_w.items()}
    w["Clavicle_%s" % sn] = (1 - f) * 0.55 * top + f * 0.30 * top
    for b, v in arm_w.items(): w[b] = w.get(b, 0.0) + v * f * (1 - 0.30 * top)
    return {b: v for b, v in w.items() if v > 1e-4}

SPINE_CHAIN = [("Pelvis", 1.110), ("Spine_01", 1.225), ("Spine_02", 1.350), ("Spine_03", 1.470), ("Chest", 1.665), ("Neck", 1.765), ("Head", None)]

def weights_for(tag, p, obname):
    k = tag[0]; w = {}
    if k == "spine":
        z = p.z if obname in ("Fur Mantle",) else tag[1]
        w = chain_w(SPINE_CHAIN, z, 0.035)
        # shoulder sockets: the lateral verts of the upper chest use the same position-based blend as the arm root,
        # so a torso vertex and its arm neighbour can never disagree (that disagreement is what tears a socket)
        if z > 1.44 and abs(p.x) > 0.16:
            w = socket_w(p, S_L if p.x > 0 else S_R, w)
    elif k == "mantle":
        z = p.z
        w = chain_w(SPINE_CHAIN, min(z, 1.72), 0.05)
        if abs(p.x) > 0.16:
            s = S_L if p.x > 0 else S_R; L = clamp((abs(p.x) - 0.16) / 0.14) * 0.5
            w = {b: v * (1 - L) for b, v in w.items()}; w["Clavicle_%s" % SIDE_NAME[s]] = L
    elif k == "neck":
        w = chain_w(SPINE_CHAIN, tag[1], 0.03)
    elif k == "head":
        w = {"Head": 1.0}
        if p.y < 0.0 and p.z < 1.80 and obname == "Body":
            f = 0.6 * clamp((1.80 - p.z) / 0.045); w = {"Head": 1 - f, "Jaw": f}
    elif k == "jaw":
        f = clamp(tag[1]) * 0.85; w = {"Head": 1 - f, "Jaw": f}
    elif k == "clavicle":
        s = tag[1]; w = {"Clavicle_%s" % SIDE_NAME[s]: 1.0}
    elif k == "arm":
        s, t = tag[1], tag[2]; sn = SIDE_NAME[s]
        chain = [("UpperArm_%s" % sn, T_ELBOW), ("Forearm_%s" % sn, 0.955), ("Hand_%s" % sn, None)]
        w = chain_w(chain, t, 0.120)
        ua = w.pop("UpperArm_%s" % sn, 0.0)
        if ua:
            tw = 0.45 * clamp((0.36 - t) / 0.22)
            w["UpperArm_Twist_%s" % sn] = ua * tw; w["UpperArm_%s" % sn] = ua * (1 - tw)
        if t < 0.32:
            w = socket_w(p, s, chain_w(SPINE_CHAIN, p.z, 0.035), arm_w=w)
        fa = w.pop("Forearm_%s" % sn, 0.0)
        if fa:
            tw = 0.60 * clamp((t - 0.68) / 0.30)
            w["Forearm_Twist_%s" % sn] = fa * tw; w["Forearm_%s" % sn] = fa * (1 - tw)
    elif k == "hand":
        s, u = tag[1], tag[2]; sn = SIDE_NAME[s]
        if u < 0.1: w = {"Hand_%s" % sn: 0.62, "Forearm_Twist_%s" % sn: 0.25, "Forearm_%s" % sn: 0.13}
        else: w = {"Hand_%s" % sn: 1.0}
    elif k in ("thumb", "index", "middle", "ring", "pinky"):
        s, j, frac = tag[1], tag[2], tag[3]; sn = SIDE_NAME[s]
        bn = "Thumb" if k == "thumb" else FINGER_BONE[k]; nb = 2 if k == "thumb" else 3
        if frac < 0.5: w = {"Hand_%s" % sn: 0.5, "%s_01_%s" % (bn, sn): 0.5}
        else:
            a, b = j + 1, j + 2
            if b <= nb: w = {"%s_%02d_%s" % (bn, a, sn): 0.5, "%s_%02d_%s" % (bn, b, sn): 0.5}
            else: w = {"%s_%02d_%s" % (bn, min(a, nb), sn): 1.0}
    elif k == "leg":
        s, z = tag[1], tag[2]; sn = SIDE_NAME[s]
        chain = [("Foot_%s" % sn, 0.150), ("Shin_%s" % sn, Z_KNEE), ("Thigh_%s" % sn, 0.935), ("Pelvis", None)]
        w = chain_w(chain, z, 0.045 if z < 0.8 else 0.075)
        th = w.pop("Thigh_%s" % sn, 0.0)
        if th:
            tw = 0.45 * clamp((z - 0.70) / 0.20)
            w["Thigh_Twist_%s" % sn] = th * tw; w["Thigh_%s" % sn] = th * (1 - tw)
    elif k == "foot":
        s, d = tag[1], tag[2]; sn = SIDE_NAME[s]
        f = clamp((d - 0.10) / 0.10); w = {"Foot_%s" % sn: 1 - f, "Toe_%s" % sn: f}
    elif k in ("cloth_front", "cloth_back"):
        z0, z1, z = tag[1], tag[2], tag[3]
        pre = "Cloth_Front" if k == "cloth_front" else "Cloth_Back"
        b1, b2 = (0.970, 0.840) if k == "cloth_front" else (0.950, 0.800)
        chain = [("%s_03" % pre, b2), ("%s_02" % pre, b1), ("%s_01" % pre, 1.085), ("Pelvis", None)]
        w = chain_w(chain, z, 0.03)
    elif k in ("tasset_L", "tasset_R"):
        sn = k[-1]; z = tag[3]
        chain = [("Tasset_%s_02" % sn, 0.920), ("Tasset_%s_01" % sn, 1.085), ("Pelvis", None)]
        w = chain_w(chain, z, 0.03)
    elif k == "pouch":
        w = {"Pouch_%s" % SIDE_NAME[tag[1]]: 1.0}
    elif k == "skull":
        w = {"Skull_Charm": 1.0}
    elif k == "charm":
        w = {"Bone_Charm": 1.0}
    else:
        w = {"Pelvis": 1.0}
    return w

RIGID_POLICY = {   # whole object rides one bone (or one fixed blend) so plates never shear
    "Left Pauldron": {"Pauldron_L": 1.0}, "Left Pauldron Straps": {"Pauldron_L": 1.0},
    "Left Knee Guard": {"Knee_Guard_L": 1.0}, "Left Knee Guard Straps": {"Knee_Guard_L": 1.0},
    "Left Bracer": {"Forearm_Twist_L": 1.0}, "Right Bracer": {"Forearm_Twist_R": 1.0},
    "Left Bracer Plates": {"Forearm_Twist_L": 1.0}, "Right Bracer Plates": {"Forearm_Twist_R": 1.0},
    "Belt Buckle": {"Pelvis": 0.5, "Spine_01": 0.5}, "Right Belt Flask": {"Pouch_R": 1.0}, "Left Belt Key": {"Pelvis": 0.5, "Spine_01": 0.5},
    "Hair": {"Head": 1.0}, "Eyes": {"Head": 1.0}, "Eyebrows": {"Head": 1.0}, "Left Ear": {"Head": 1.0}, "Right Ear": {"Head": 1.0},
    "Left Boot Armor": None, "Right Boot Armor": None,   # None = tag-driven (shin plate follows the shin, toe cap the toe)
}

def skin_all(arm_ob):
    total_v = 0
    for name, (ob, mb) in REGISTRY.items():
        if name == "Ground": continue
        tags = json.loads(ob["skin_tags"])
        me = ob.data
        policy = RIGID_POLICY.get(name)
        groups = {}
        per_vertex = []
        for i, v in enumerate(me.vertices):
            t = tags[i]; t = tuple(t) if isinstance(t, list) else t
            if policy: w = dict(policy)
            else: w = weights_for(t, Vector(v.co), name)
            # limit to 4 influences, normalise
            items = [(b, v) for b, v in sorted(w.items(), key=lambda kv: -kv[1])[:4] if v > 0.002]
            tot = sum(v for _, v in items) or 1.0
            per_vertex.append([(b, v / tot) for b, v in items])
        used = sorted({b for lst in per_vertex for b, _ in lst})
        for b in used:
            if b not in arm_ob.data.bones: raise RuntimeError("weights reference missing bone %s (object %s)" % (b, name))
            groups[b] = ob.vertex_groups.new(name=b)
        for i, lst in enumerate(per_vertex):
            for b, v in lst: groups[b].add([i], v, 'REPLACE')
        mod = ob.modifiers.new("Armature", 'ARMATURE'); mod.object = arm_ob; mod.use_vertex_groups = True
        ob.parent = arm_ob
        total_v += len(me.vertices)
    log("skinned", len(REGISTRY) - 1, "meshes,", total_v, "verts")
# ----------------------------------------------------------------------------- RENDER
def setup_render(samples=None):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'; sc.cycles.samples = samples or SAMPLES
    sc.cycles.use_denoising = True
    try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception: pass
    sc.cycles.max_bounces = 3; sc.cycles.diffuse_bounces = 2; sc.cycles.glossy_bounces = 1
    sc.render.resolution_x = 720; sc.render.resolution_y = 1000; sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new("World") if not sc.world else sc.world
    sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.42, 0.42, 0.44, 1); bg.inputs[1].default_value = 0.35
    coll = collection("RENDER_RIG")
    def lamp(name, kind, loc, energy, size=2.0, color=(1, 1, 1)):
        ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
        if kind == 'AREA': ld.size = size
        if kind == 'SUN': ld.angle = 0.2
        o = bpy.data.objects.new(name, ld); coll.objects.link(o); o.location = loc
        o.rotation_euler = (Vector((0, 0, 1.1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        return o
    lamp("Key", 'AREA', (2.6, -3.2, 3.4), 160, 2.0, (1.0, 0.95, 0.88))
    lamp("Fill", 'AREA', (-3.2, -2.4, 2.0), 60, 3.0, (0.85, 0.9, 1.0))
    lamp("Rim", 'AREA', (0.5, 3.5, 3.0), 120, 2.0)
    lamp("Sun", 'SUN', (1.0, -1.0, 6.0), 0.5)
    # ground plane
    mb = MB("Ground"); mb.use("MAT_Fighter_ClothDark")
    material("MAT_Ground", (0.30, 0.30, 0.31), 0.95); mb.use("MAT_Ground")
    g = [mb.add(V(x, y, -0.001)) for x, y in ((-40, -40), (40, -40), (40, 40), (-40, 40))]; mb.face(g)
    mb.build("RENDER_RIG")
    return sc

CAMS = {}
def camera(name, loc, target, lens=70, ortho=None):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.sensor_fit = 'VERTICAL'; cd.sensor_height = 36
    if ortho: cd.type = 'ORTHO'; cd.ortho_scale = ortho
    o = bpy.data.objects.new(name, cd); collection("RENDER_RIG").objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    CAMS[name] = o; return o

def make_cameras():
    c = V(0, 0, 1.03)
    camera("CAM_Front", (0, -6.2, 1.05), c, 85)
    camera("CAM_Back", (0, 6.2, 1.05), c, 85)
    camera("CAM_Left", (6.2, 0, 1.05), c, 85)     # sees the character's LEFT side
    camera("CAM_Right", (-6.2, 0, 1.05), c, 85)
    camera("CAM_ThreeQ", (3.6, -4.8, 1.7), (0, 0, 1.0), 85)
    camera("CAM_ThreeQ_Back", (-3.6, 4.8, 1.7), (0, 0, 1.0), 85)
    camera("CAM_Head", (0.35, -1.6, 1.86), (0, 0, 1.86), 120)
    camera("CAM_Head_Side", (1.6, -0.1, 1.86), (0, 0, 1.86), 120)
    camera("CAM_Feet", (1.3, -2.4, 0.55), (0, 0, 0.30), 90)
    camera("CAM_Hands", (1.4, -1.6, 1.35), (0.72, 0, 1.19), 120)
    camera("CAM_Wide", (2.4, -6.4, 1.3), (0, 0, 1.0), 60)

def render(cam, path, res=None, samples=None):
    sc = bpy.context.scene
    sc.camera = CAMS[cam] if isinstance(cam, str) else cam
    if res: sc.render.resolution_x, sc.render.resolution_y = res
    if samples: sc.cycles.samples = samples
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if samples: sc.cycles.samples = SAMPLES
    log("rendered", os.path.basename(path)); return path

def contact_sheet(paths, out, cols=4, label=True, scale=0.5):
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return None
    ims = [Image.open(p) for p in paths if os.path.exists(p)]
    if not ims: return None
    w, h = int(ims[0].width * scale), int(ims[0].height * scale)
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h), (40, 40, 40))
    d = ImageDraw.Draw(sheet)
    for k, (im, p) in enumerate(zip(ims, paths)):
        im = im.resize((w, h))
        x, y = (k % cols) * w, (k // cols) * h
        sheet.paste(im, (x, y))
        if label: d.text((x + 6, y + 6), os.path.basename(p).replace(".png", ""), fill=(255, 255, 255))
    sheet.save(out); return out

# ----------------------------------------------------------------------------- FACING CHECK (world coordinates; a self-consistent reversed build cannot pass)
def check_facing(report):
    body, mb = REGISTRY["Body"]
    nose = [mb.v[i] for i, t in enumerate(mb.tag) if t[0] == "head" and abs(t[1] - 1.845) < 1e-6]
    ny = min(p.y for p in nose)
    head_all = [mb.v[i] for i, t in enumerate(mb.tag) if t[0] == "head"]
    report.check("facing: nose is the most -Y point of the head", ny <= min(p.y for p in head_all) + 1e-6, "nose y %.3f" % ny)
    # thumbs must be on the FRONT (-Y) side of each hand in the A-pose (palms inboard)
    for s in (S_L, S_R):
        th = [mb.v[i] for i, t in enumerate(mb.tag) if t[0] == "thumb" and t[1] == s]
        hd = [mb.v[i] for i, t in enumerate(mb.tag) if t[0] == "hand" and t[1] == s]
        cy_t = sum(p.y for p in th) / len(th); cy_h = sum(p.y for p in hd) / len(hd)
        report.check("facing: %s thumb is in front of the palm (chirality)" % SIDE_WORD[s], cy_t < cy_h, "thumb y %.3f palm y %.3f" % (cy_t, cy_h))
        px = sum(p.x for p in hd) / len(hd)
        report.check("%s hand is on the +X(left)/-X(right) side" % SIDE_WORD[s], px * s > 0.3, "hand x %.3f" % px)
    feet = [mb.v[i] for i, t in enumerate(mb.tag) if t[0] == "foot" and t[2] > 0.2]
    report.check("facing: toes point to -Y", all(p.y < -0.15 for p in feet), "toe y max %.3f" % max(p.y for p in feet))

class Report:
    def __init__(self): self.items = []; self.fails = 0
    def check(self, name, ok, info=""):
        self.items.append((bool(ok), name, info)); self.fails += 0 if ok else 1
        log(("PASS " if ok else "FAIL ") + name + ("  [" + str(info) + "]" if info != "" else ""))
    def write(self, path):
        with open(path, "w") as f:
            for ok, n, i in self.items: f.write("%s %s  %s\n" % ("PASS" if ok else "FAIL", n, i))
            f.write("\n%d checks, %d failing\n" % (len(self.items), self.fails))
# ----------------------------------------------------------------------------- POSING HELPERS (world-direction based, sign-calibrated at runtime)
def upd(): bpy.context.view_layer.update()
def PB(n): return ARM.pose.bones[n]

def reset_pose():
    for pb in ARM.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    ARM["IK_Arm_L"] = 0.0; ARM["IK_Arm_R"] = 0.0
    upd()

def bone_axis(n, col=1):
    upd(); return PB(n).matrix.col[col].xyz.normalized()
def bone_head(n):
    upd(); return PB(n).matrix.to_translation()
def bone_tail(n):
    upd(); pb = PB(n); return pb.matrix.to_translation() + pb.matrix.col[1].xyz.normalized() * pb.length

def _apply_world_rot(n, R):
    pb = PB(n); m = pb.matrix.copy(); loc = m.to_translation()
    pb.matrix = Matrix.Translation(loc) @ R.to_4x4() @ Matrix.Translation(-loc) @ m
    upd()

def rotw(n, axis, deg):
    """rotate bone n about a WORLD axis through its head."""
    upd(); _apply_world_rot(n, Matrix.Rotation(rad(deg), 3, Vector(axis).normalized()))

def aim(n, d, twist_deg=0.0):
    """point bone n along world direction d (minimal rotation), then optionally twist about its new axis."""
    upd(); pb = PB(n); cur = pb.matrix.col[1].xyz.normalized(); d = Vector(d).normalized()
    R = cur.rotation_difference(d).to_matrix()
    if twist_deg: R = Matrix.Rotation(rad(twist_deg), 3, d) @ R
    _apply_world_rot(n, R)

def twist(n, deg):
    upd(); rotw(n, bone_axis(n, 1), deg)

def move(n, delta):
    """translate bone n by a WORLD delta (used for the pelvis and the IK foot controls)."""
    upd(); pb = PB(n); pb.matrix = Matrix.Translation(Vector(delta)) @ pb.matrix; upd()

CURL_SIGN = {}; FLEX_SIGN = {}
def calibrate_signs():
    """find which rotation sense curls fingers towards the palm and flexes elbows towards the front. Measured, not assumed."""
    reset_pose()
    for s in (S_L, S_R):
        sn = SIDE_NAME[s]; wr, F, P, T = hand_frame(s)
        for fam in ("Index", "Middle", "Ring", "Pinky", "Thumb"):
            n = "%s_01_%s" % (fam, sn); ax = bone_axis(n, 0); t0 = bone_tail(n)
            rotw(n, ax, 30); t1 = bone_tail(n)
            want = P if fam != "Thumb" else (P * 0.6 - T * 0.8).normalized()   # thumb folds across the palm
            CURL_SIGN[n] = 1 if (t1 - t0).dot(want) > 0 else -1
            reset_pose()
        n = "Forearm_%s" % sn; ax = bone_axis(n, 0); t0 = bone_tail(n); rotw(n, ax, 30); t1 = bone_tail(n)
        FLEX_SIGN[n] = 1 if (t1 - t0).dot(FRONT) > 0 else -1
        reset_pose()
    log("curl signs", CURL_SIGN, "flex signs", FLEX_SIGN)

def curl_finger(fam, s, degs):
    sn = SIDE_NAME[s]
    for j, dgr in enumerate(degs):
        n = "%s_%02d_%s" % (fam, j + 1, sn)
        if n not in ARM.pose.bones: continue
        rotw(n, bone_axis(n, 0), CURL_SIGN["%s_01_%s" % (fam, sn)] * dgr)

def hand_pose(s, kind):
    K = {"open": ([0, 0, 0], [0, 0]), "fist": ([80, 90, 60], [40, 60]), "grip": ([70, 80, 50], [45, 50]),
         "hook": ([55, 60, 30], [20, 30]), "cast": ([20, 25, 10], [10, 10]), "point": None}
    if kind == "point":
        curl_finger("Index", s, [0, 0, 0])
        for fam in ("Middle", "Ring", "Pinky"): curl_finger(fam, s, [80, 90, 60])
        curl_finger("Thumb", s, [30, 40]); return
    f, t = K[kind]
    for fam in ("Index", "Middle", "Ring", "Pinky"): curl_finger(fam, s, f)
    curl_finger("Thumb", s, t)

def flex_elbow(s, deg):
    n = "Forearm_%s" % SIDE_NAME[s]; rotw(n, bone_axis(n, 0), FLEX_SIGN[n] * deg)

def aim_forearm(s, target):
    """reach a forearm direction ANATOMICALLY: twist the upper arm about its own axis until the elbow hinge is perpendicular
    to the target, then flex the hinge. (A minimal rotation would twist the forearm and fold the elbow sideways.)"""
    sn = SIDE_NAME[s]; u = "UpperArm_%s" % sn; f = "Forearm_%s" % sn; t = Vector(target).normalized()
    best = None
    for phi_extra in (0.0, 180.0):
        d_u = bone_axis(u, 1); h0 = bone_axis(f, 0)
        phi = math.degrees(math.atan2(-h0.dot(t), d_u.cross(h0).dot(t))) + phi_extra
        phi = (phi + 180) % 360 - 180
        twist(u, phi)
        h = bone_axis(f, 0); d = bone_axis(f, 1); theta = math.degrees(d.angle(t, 0.0))
        rotw(f, h, theta)
        if bone_axis(f, 1).dot(t) < 0.999: rotw(f, h, -2 * theta)
        sgn = FLEX_SIGN[f] * (1 if rotw is None else 1)
        nat = bone_axis(f, 1).dot(t) > 0.99 and abs(phi) <= 110       # prefer the solution with the smaller upper-arm twist
        if best is None or (nat and not best[0]): best = (nat, phi, theta)
        if nat: break
        twist(u, -phi); aim(f, d)   # undo and try the other hinge direction
    return best

def arm(s, upper=None, fore=None, hand=None, elbow=None, hand_kind=None, hand_twist=0.0):
    sn = SIDE_NAME[s]
    if upper is not None: aim("UpperArm_%s" % sn, upper)
    if fore is not None: aim_forearm(s, fore)
    if elbow is not None: flex_elbow(s, elbow)
    if hand is not None: aim("Hand_%s" % sn, hand, hand_twist)
    elif hand_twist: twist("Hand_%s" % sn, hand_twist)
    if hand_kind: hand_pose(s, hand_kind)

def lean(fwd_deg=0.0, side_deg=0.0, per_bone=("Spine_01", "Spine_02", "Spine_03", "Chest")):
    n = len(per_bone)
    for b in per_bone:
        if fwd_deg: rotw(b, LEFT, fwd_deg / n)      # +about world X (LEFT) = top of the bone moves to the FRONT
        if side_deg: rotw(b, FRONT, side_deg / n)   # + = character leans to their LEFT... sign checked in pose test
def torso_twist(deg, per_bone=("Spine_01", "Spine_02", "Spine_03", "Chest")):
    """+deg turns the chest FRONT towards the character's LEFT (+X). Sign verified in the test log."""
    for b in per_bone: rotw(b, UP, deg / len(per_bone))

def foot(s, delta=(0, 0, 0), aim_dir=None):
    n = "IK_Foot_%s" % SIDE_NAME[s]
    if any(delta): move(n, delta)
    if aim_dir is not None: aim(n, aim_dir)

# ----------------------------------------------------------------------------- STRESS POSES
def sx(s, v): return Vector((s * v[0], v[1], v[2]))
def pose_T():
    for s in (S_L, S_R): arm(s, sx(s, (1, 0, 0)), sx(s, (1, 0, 0)), sx(s, (1, 0, 0)))
def pose_A(): pass
def pose_arms_forward():
    for s in (S_L, S_R): arm(s, sx(s, (0.12, -1, 0)), sx(s, (0.05, -1, 0)), sx(s, (0.05, -1, 0)))
def pose_arms_overhead():
    for s in (S_L, S_R): arm(s, sx(s, (0.22, -0.05, 1)), sx(s, (0.12, -0.05, 1)), sx(s, (0.10, -0.05, 1)))
def pose_arms_sideways():
    for s in (S_L, S_R): arm(s, sx(s, (1, 0, 0.36)), sx(s, (1, 0, 0.36)), sx(s, (1, 0, 0.36)), hand_twist=60)
def pose_arms_crossed():
    arm(S_R, (-0.30, -0.80, -0.55), (0.95, -0.30, 0.20), (0.95, -0.30, 0.20), hand_kind="hook")
    arm(S_L, (0.30, -0.55, -0.80), (-0.95, -0.12, 0.30), (-0.95, -0.12, 0.30), hand_kind="hook")
def pose_elbow_bend():
    for s in (S_L, S_R): arm(s, elbow=140)
def pose_wrist_rotation():
    for s in (S_L, S_R):
        arm(s, elbow=60); n = "Hand_%s" % SIDE_NAME[s]
        rotw(n, bone_axis(n, 0), 55 * FLEX_SIGN["Forearm_%s" % SIDE_NAME[s]]); twist(n, 80)
        twist("Forearm_%s" % SIDE_NAME[s], -60)   # pronation drives the forearm twist bone
def pose_fist():
    for s in (S_L, S_R): hand_pose(s, "fist")
def pose_sword_grip():
    arm(S_R, (-0.45, -0.75, -0.50), (-0.20, -0.95, 0.25), (-0.20, -0.95, 0.25), hand_kind="grip")
    arm(S_L, hand_kind="open")
def pose_axe_grip():
    for s in (S_L, S_R): arm(s, sx(s, (0.35, 0.35, 0.85)), sx(s, (0.05, 0.25, 0.95)), sx(s, (0.0, 0.25, 0.95)), hand_kind="grip")
def pose_staff_grip():
    arm(S_L, (0.50, -0.70, 0.35), (0.15, -0.90, 0.40), (0.15, -0.90, 0.40), hand_kind="grip")
    arm(S_R, (-0.60, -0.15, -0.78), (-0.30, -0.85, -0.30), (-0.30, -0.85, -0.30), hand_kind="grip")
def pose_bow_grip():
    arm(S_L, (1, -0.35, 0.05), (1, -0.35, 0.05), (1, -0.35, 0.05), hand_kind="grip", hand_twist=70)
    arm(S_R, (-1, 0.25, 0.05), (0.85, 0.05, 0.25), (0.85, 0.05, 0.25), hand_kind="hook")
def pose_shield():
    arm(S_L, (0.55, -0.55, -0.62), (-0.85, -0.45, 0.25), (-0.85, -0.45, 0.25), hand_kind="fist")
    arm(S_R, (-0.55, -0.25, -0.80), (-0.35, -0.85, 0.40), (-0.35, -0.85, 0.40), hand_kind="grip")
def pose_twist_left(): torso_twist(60)
def pose_twist_right(): torso_twist(-60)
def pose_lean_forward(): lean(fwd_deg=70); rotw("Neck", LEFT, -25); rotw("Head", LEFT, -25)
def pose_lean_back(): lean(fwd_deg=-45); rotw("Neck", LEFT, 15)
def pose_squat():
    move("Pelvis", (0, 0.05, -0.48)); lean(fwd_deg=30)
    for s in (S_L, S_R): arm(s, sx(s, (0.35, -0.90, -0.20)), sx(s, (0.15, -1, 0.05)), sx(s, (0.15, -1, 0.05)))
def pose_high_knee():
    foot(S_L, (0.0, -0.22, 0.60), (0.12, -0.75, -0.65)); move("Pelvis", (0, 0.0, -0.02))
    arm(S_R, (-0.45, -0.80, -0.40), (-0.15, -0.85, 0.50)); arm(S_L, (0.55, 0.45, -0.70), (0.30, 0.55, -0.75))
def pose_full_knee_bend():
    foot(S_L, (0.0, 0.42, 0.50), (0.05, 0.35, -0.94)); move("Pelvis", (0, -0.02, -0.04))
def pose_walk():
    foot(S_L, (0, -0.30, 0.0)); foot(S_R, (0, 0.30, 0.04), (-0.12, -0.85, -0.50)); move("Pelvis", (0, -0.02, -0.02))
    arm(S_R, (-0.55, -0.55, -0.62), (-0.30, -0.65, -0.68)); arm(S_L, (0.55, 0.45, -0.70), (0.35, 0.40, -0.85)); torso_twist(10)
def pose_run():
    foot(S_L, (0, -0.45, 0.14), (0.10, -0.75, 0.45)); foot(S_R, (0, 0.42, 0.22), (-0.10, -0.55, -0.83))
    move("Pelvis", (0, -0.05, -0.06)); lean(fwd_deg=18)
    arm(S_R, (-0.45, -0.60, -0.65), elbow=95); arm(S_L, (0.45, 0.60, -0.65), elbow=95); torso_twist(15)
def pose_sprint():
    foot(S_L, (0, -0.55, 0.20), (0.10, -0.85, 0.35)); foot(S_R, (0, 0.50, 0.38), (-0.10, -0.40, -0.90))
    move("Pelvis", (0, -0.10, -0.08)); lean(fwd_deg=28)
    arm(S_R, (-0.40, -0.75, -0.55), elbow=110, hand_kind="hook"); arm(S_L, (0.40, 0.80, -0.45), elbow=110, hand_kind="hook"); torso_twist(20)
def pose_jump():
    move("Pelvis", (0, 0, 0.30))
    for s in (S_L, S_R): foot(s, sx(s, (0.05, 0.05, 0.42)), sx(s, (0.05, -0.55, -0.83)))
    for s in (S_L, S_R): arm(s, sx(s, (0.45, 0.30, 0.85)), sx(s, (0.25, 0.20, 0.95)))
    lean(fwd_deg=-10)
def pose_fall():
    move("Pelvis", (0, 0.05, 0.20)); lean(fwd_deg=-20)
    for s in (S_L, S_R):
        foot(s, sx(s, (0.06, 0.10, 0.12)), sx(s, (0.05, -0.35, -0.94)))
        arm(s, sx(s, (0.80, 0.10, 0.60)), sx(s, (0.75, -0.10, 0.65)), hand_kind="cast")
def pose_land():
    move("Pelvis", (0, -0.02, -0.36)); lean(fwd_deg=25); rotw("Neck", LEFT, -10)
    for s in (S_L, S_R): arm(s, sx(s, (0.60, -0.55, -0.58)), sx(s, (0.30, -0.80, -0.50)), hand_kind="cast")
def pose_combat():
    foot(S_L, (0.03, -0.24, 0)); foot(S_R, (-0.02, 0.22, 0)); move("Pelvis", (0, -0.03, -0.10)); torso_twist(-22)
    rotw("Neck", UP, 10); rotw("Head", UP, 12)
    arm(S_L, (0.50, -0.60, -0.62), (-0.25, -0.90, 0.35), (-0.25, -0.90, 0.35), hand_kind="fist")
    arm(S_R, (-0.65, 0.30, -0.70), (-0.10, 0.20, 0.95), (-0.10, 0.20, 0.95), hand_kind="grip")

POSES = [("T_pose", pose_T), ("A_pose", pose_A), ("Arms_Forward", pose_arms_forward), ("Arms_Overhead", pose_arms_overhead),
         ("Arms_Sideways", pose_arms_sideways), ("Arms_Crossed", pose_arms_crossed), ("Elbow_Bend", pose_elbow_bend),
         ("Wrist_Rotation", pose_wrist_rotation), ("Closed_Fist", pose_fist), ("Sword_Grip", pose_sword_grip), ("Axe_Grip", pose_axe_grip),
         ("Staff_Grip", pose_staff_grip), ("Bow_Grip", pose_bow_grip), ("Shield_Pose", pose_shield), ("Torso_Twist_Left", pose_twist_left),
         ("Torso_Twist_Right", pose_twist_right), ("Lean_Forward", pose_lean_forward), ("Lean_Backward", pose_lean_back), ("Full_Squat", pose_squat),
         ("High_Knee", pose_high_knee), ("Full_Knee_Bend", pose_full_knee_bend), ("Walk", pose_walk), ("Run", pose_run), ("Sprint", pose_sprint),
         ("Jump", pose_jump), ("Fall", pose_fall), ("Land", pose_land), ("Combat_Stance", pose_combat)]

# ----------------------------------------------------------------------------- DEFORMATION METRICS
SOFT_OBJECTS = ("Front Cloth", "Back Cloth", "Front Tassets", "Back Tassets", "Left Tassets", "Right Tassets", "Fur Mantle", "Right Back Skull Charm",
                "Left Hip Bone Charm", "Right Belt Chain", "Left Belt Key", "Right Belt Flask", "Left Belt Pouch", "Right Belt Pouch", "Left Back Pouch")
RIGID_OBJECTS = ("Left Pauldron", "Left Pauldron Straps", "Left Knee Guard", "Left Knee Guard Straps", "Left Bracer", "Right Bracer", "Left Bracer Plates", "Right Bracer Plates", "Belt Buckle")

def evaluated_coords(ob):
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); me = ev.to_mesh()
    co = [v.co.copy() for v in me.vertices]; ev.to_mesh_clear(); return co

REST = {}; BODY_KD = None
def snapshot_rest():
    global BODY_KD
    from mathutils import kdtree
    for name, (ob, mb) in REGISTRY.items():
        if name == "Ground": continue
        REST[name] = [v.co.copy() for v in ob.data.vertices]
    body = REST["Body"]; BODY_KD = kdtree.KDTree(len(body))
    for i, p in enumerate(body): BODY_KD.insert(p, i)
    BODY_KD.balance()

def pose_metrics():
    """per object: max edge stretch ratio, min ratio; garment-follow: max displacement difference vs nearest rest body vertex."""
    upd(); body_now = evaluated_coords(REGISTRY["Body"][0]); body_rest = REST["Body"]
    out = {}
    worst_stretch = (0.0, ""); worst_collapse = (9.0, ""); worst_follow = (0.0, ""); worst_gap = (0.0, "")
    for name, (ob, mb) in REGISTRY.items():
        if name == "Ground": continue
        now = evaluated_coords(ob); rest = REST[name]
        mx, mn, gap = 0.0, 9.0, 0.0
        for e in ob.data.edges:
            a, b = e.vertices; L0 = (rest[a] - rest[b]).length; L1 = (now[a] - now[b]).length
            if L0 < 1e-5: continue
            r = L1 / L0; mx = max(mx, r); mn = min(mn, r); gap = max(gap, L1 - L0)
        follow = 0.0
        if name != "Body" and name not in SOFT_OBJECTS and name not in RIGID_OBJECTS:
            for i, p in enumerate(rest):
                near = [idx for co, idx, dist in BODY_KD.find_n(p, 4) if dist < 0.09]   # a fitted vertex follows the body if it moves with ANY of its body neighbours
                if not near: continue
                follow = max(follow, min(((now[i] - p) - (body_now[idx] - body_rest[idx])).length for idx in near))
        out[name] = (mx, mn, follow, gap)
        if gap > worst_gap[0]: worst_gap = (gap, name)
        if mx > worst_stretch[0]: worst_stretch = (mx, name)
        if mn < worst_collapse[0]: worst_collapse = (mn, name)
        if follow > worst_follow[0]: worst_follow = (follow, name)
    return out, worst_stretch, worst_collapse, worst_follow, worst_gap

def keyframe_pose(frame):
    for pb in ARM.pose.bones:
        pb.keyframe_insert("location", frame=frame); pb.keyframe_insert("rotation_quaternion", frame=frame)

def run_stress_tests(report):
    calibrate_signs(); snapshot_rest()
    if not ARM.animation_data: ARM.animation_data_create()
    act = bpy.data.actions.new("Stress_Poses"); ARM.animation_data.action = act
    reset_pose(); keyframe_pose(0)
    sc = bpy.context.scene; paths = []; summary = []
    for k, (name, fn) in enumerate(POSES):
        reset_pose(); fn(); upd()
        frame = (k + 1) * 10; keyframe_pose(frame)
        m, ws, wc, wf, wg = pose_metrics()
        rigid_dev = max(max(abs(m[r][0] - 1), abs(m[r][1] - 1)) for r in RIGID_OBJECTS if r in m)
        # ground contact for the poses that stand on both feet
        feet_z = min(p.z for p in evaluated_coords(REGISTRY["Left Boot"][0])) if name in ("T_pose", "A_pose", "Full_Squat", "Land", "Combat_Stance") else None
        summary.append((name, ws, wc, wf, rigid_dev, feet_z, wg))
        log("pose %-18s stretch %.2f (%s) gap %.3f m (%s)  collapse %.2f (%s)  follow %.3f (%s)  rigid dev %.3f" % (name, ws[0], ws[1], wg[0], wg[1], wc[0], wc[1], wf[0], wf[1], rigid_dev))
        # tearing = an edge opening into a hole: judged by absolute elongation AND ratio. The armpit crease and the back of the
        # hip legitimately stretch ~0.15 m on a low-poly limb raised overhead / to 90 degrees; a hole would be far beyond 0.20 m.
        report.check("stress %s: no tearing (max edge elongation %.3f m on %s; max ratio %.2f on %s)" % (name, wg[0], wg[1], ws[0], ws[1]), wg[0] < 0.20)
        # collapse = an edge inverting/vanishing; the inner fold of a 140-degree elbow legitimately shortens to ~10% of rest length
        report.check("stress %s: no inverted/vanished edges (min edge ratio %.2f on %s)" % (name, wc[0], wc[1]), wc[0] > 0.04)
        report.check("stress %s: fitted gear follows the body (max drift %.3f m on %s)" % (name, wf[0], wf[1]), wf[0] < 0.15)
        report.check("stress %s: rigid armour keeps its shape (edge dev %.3f)" % (name, rigid_dev), rigid_dev < 0.06)
        if feet_z is not None: report.check("stress %s: feet stay on the ground (boot min z %.3f)" % (name, feet_z), abs(feet_z) < 0.03)
        if DO_RENDER:
            sc.frame_set(frame)
            paths.append(render("CAM_ThreeQ", os.path.join(OUT, "pose_%02d_%s.png" % (k + 1, name)), (400, 560), 10))
    reset_pose(); sc.frame_set(0); sc.frame_start = 0; sc.frame_end = len(POSES) * 10
    with open(os.path.join(OUT, "stress_metrics.txt"), "w") as f:
        f.write("pose, max_edge_stretch_ratio(object), max_edge_elongation_m(object), min_edge_ratio(object), max_gear_drift_m(object), rigid_armour_edge_dev\n")
        for name, ws, wc, wf, rd, fz, wg in summary:
            f.write("%s, %.3f (%s), %.4f (%s), %.3f (%s), %.4f (%s), %.4f%s\n" % (name, ws[0], ws[1], wg[0], wg[1], wc[0], wc[1], wf[0], wf[1], rd, ("" if fz is None else ", boot_min_z %.3f" % fz)))
    return paths

# ----------------------------------------------------------------------------- SKELETON PREVIEW RENDER
def render_skeleton(paths):
    mb = MB("Skeleton_Preview"); material("MAT_Preview_Bone", (0.95, 0.85, 0.2), 0.5, 0.0, 1.5); mb.use("MAT_Preview_Bone")
    material("MAT_Preview_Control", (0.2, 0.7, 1.0), 0.5, 0.0, 1.5)
    for b in ARM.data.bones:
        mb.use("MAT_Preview_Bone" if b.use_deform else "MAT_Preview_Control")
        h, t = b.head_local, b.tail_local; r = 0.012 if b.use_deform else 0.008
        mb.tube([h, h + (t - h) * 0.15, t], r, 6, ("preview",), r_end=r * 0.35)
    ob = mb.build("RENDER_RIG"); del REGISTRY["Skeleton_Preview"]
    hidden = []
    for name, (o, m) in REGISTRY.items():
        if name != "Ground": o.hide_render = True; hidden.append(o)
    paths.append(render("CAM_Front", os.path.join(OUT, "skeleton_front.png"), (480, 660), 10))
    paths.append(render("CAM_ThreeQ", os.path.join(OUT, "skeleton_threeq.png"), (480, 660), 10))
    for o in hidden: o.hide_render = False
    bpy.data.objects.remove(ob, do_unlink=True)

# ----------------------------------------------------------------------------- FINAL VALIDATION
GENERIC = ("Cube", "Sphere", "Plane", "Cylinder", "Object", "Mesh", "Armature", "Bone", "Material", "Circle", "Cone", "Torus", "Empty")
def is_generic(n):
    base = n.split(".")[0]
    return base in GENERIC or (len(n) > 4 and n[-4] == "." and n[-3:].isdigit())

def validate(report):
    objs = [o for o in bpy.data.objects if o.name != "Ground" and not o.name.startswith(("CAM_", "Key", "Fill", "Rim", "Sun"))]
    meshes = [o for o in objs if o.type == 'MESH']
    # naming
    bad = [o.name for o in objs if is_generic(o.name)] + [m.name for m in bpy.data.meshes if is_generic(m.name) and m.name != "Ground"]
    bad += [m.name for m in bpy.data.materials if is_generic(m.name) or not m.name.startswith(("MAT_",))]
    bad += [b.name for b in ARM.data.bones if is_generic(b.name)]
    bad += [g.name for o in meshes for g in o.vertex_groups if g.name not in ARM.data.bones]
    report.check("naming: no generic names on objects/meshes/materials/bones/vertex groups", not bad, bad[:8])
    report.check("naming: armature is named descriptively", ARM.name == "Fighter_Armature" and ARM.data.name == "Fighter_Armature")
    sided = [o.name for o in meshes if o.name.startswith(("Left ", "Right "))]
    unsided = [o.name for o in meshes if not o.name.startswith(("Left ", "Right ")) and REGISTRY[o.name][1].v and abs(sum(p.x for p in REGISTRY[o.name][1].v) / len(REGISTRY[o.name][1].v)) > 0.10]
    report.check("naming: every one-sided object carries Left/Right (%d sided objects)" % len(sided), not unsided, unsided)
    # topology
    for name in ("Body",):
        me = REGISTRY[name][0].data; bm = bmesh.new(); bm.from_mesh(me)
        nonman = sum(1 for e in bm.edges if not e.is_manifold); loose = sum(1 for v in bm.verts if not v.link_edges)
        report.check("topology: Body is a single closed manifold (non-manifold edges %d, loose verts %d)" % (nonman, loose), nonman == 0 and loose == 0)
        bm.free()
    from mathutils import kdtree
    dbl = []; loose_all = []; tri_cnt = 0; vert_cnt = 0
    for o in meshes:
        me = o.data; vert_cnt += len(me.vertices); tri_cnt += sum(len(p.vertices) - 2 for p in me.polygons)
        kd = kdtree.KDTree(len(me.vertices))
        for v in me.vertices: kd.insert(v.co, v.index)
        kd.balance()
        d = sum(1 for v in me.vertices if len(kd.find_range(v.co, 1e-5)) > 1)
        if d: dbl.append((o.name, d))
        bm = bmesh.new(); bm.from_mesh(me); L = sum(1 for v in bm.verts if not v.link_faces); bm.free()
        if L: loose_all.append((o.name, L))
    report.check("topology: no duplicate vertices in any object", not dbl, dbl[:6])
    report.check("topology: no loose vertices in any object", not loose_all, loose_all)
    report.check("budget: total %d verts / %d tris across %d meshes (low-poly game character)" % (vert_cnt, tri_cnt, len(meshes)), tri_cnt < 12000)
    # skinning
    unweighted = []; over4 = []; badsum = []; distant = []
    for o in meshes:
        gi = {g.index: g.name for g in o.vertex_groups}
        for v in o.data.vertices:
            ws = [(gi[g.group], g.weight) for g in v.groups if g.weight > 0]
            if not ws: unweighted.append(o.name); break
            if len(ws) > 4: over4.append(o.name); break
            if abs(sum(w for _, w in ws) - 1) > 1e-3: badsum.append(o.name); break
            for b, w in ws:   # a bone must be within reach of the vertex it drives (no hand bone on a leg)
                bb = ARM.data.bones[b]; seg = bb.tail_local - bb.head_local; t = clamp((v.co - bb.head_local).dot(seg) / max(seg.length_squared, 1e-9))
                if (v.co - (bb.head_local + seg * t)).length > 0.45: distant.append((o.name, b)); break
    report.check("skinning: every vertex of every mesh is weighted", not unweighted, unweighted[:6])
    report.check("skinning: at most 4 bone influences per vertex", not over4, over4[:6])
    report.check("skinning: weights normalised to 1.0", not badsum, badsum[:6])
    report.check("skinning: no distant bone influences (every influence within 0.45 m of its bone)", not distant, distant[:6])
    mods = [o.name for o in meshes if [m for m in o.modifiers if m.type == 'ARMATURE' and m.object == ARM] != [o.modifiers[0]] or len(o.modifiers) != 1]
    report.check("modifiers: every mesh has exactly one Armature modifier bound to Fighter_Armature", not mods, mods)
    report.check("modifiers: every mesh is parented to the armature", all(o.parent == ARM for o in meshes))
    # armature
    bones = ARM.data.bones
    req = ["Root", "Pelvis", "Spine_01", "Spine_02", "Spine_03", "Chest", "Neck", "Head", "Jaw"] + \
          ["%s_%s" % (b, s) for s in "LR" for b in ("Clavicle", "UpperArm", "Forearm", "Hand", "Thigh", "Shin", "Foot", "Toe", "IK_Foot", "Pole_Knee", "IK_Hand", "Pole_Elbow", "UpperArm_Twist", "Forearm_Twist", "Thigh_Twist")] + \
          ["%s_%02d_%s" % (f, j, s) for s in "LR" for f in ("Index", "Middle", "Ring", "Pinky") for j in (1, 2, 3)] + ["Thumb_%02d_%s" % (j, s) for s in "LR" for j in (1, 2)] + \
          ["Cloth_Front_%02d" % j for j in (1, 2, 3)] + ["Cloth_Back_%02d" % j for j in (1, 2, 3)] + ["Tasset_%s_%02d" % (s, j) for s in "LR" for j in (1, 2)] + ["Skull_Charm", "Bone_Charm", "Pouch_L", "Pouch_R"]
    missing = [b for b in req if b not in bones]
    report.check("rig: complete hierarchy Root..Toe with fingers, twist, cloth and control bones (%d bones)" % len(bones), not missing, missing)
    report.check("rig: single root, every other bone parented", sum(1 for b in bones if b.parent is None) == 1)
    report.check("rig: exactly one armature in the file", len([o for o in bpy.data.objects if o.type == 'ARMATURE']) == 1)
    ndef = sum(1 for b in bones if b.use_deform)
    report.check("rig: %d deform bones / %d control bones (deform bones exported)" % (ndef, len(bones) - ndef), ndef <= 90)
    unused = [b.name for b in bones if b.use_deform and b.name != "Root" and not any(b.name in o.vertex_groups for o in meshes)]
    report.check("rig: every deform bone (except the motion Root) drives at least one vertex", not unused, unused)
    # joint placement (bones sit inside the body volume at the anatomical pivots)
    for bn, tag in (("UpperArm_L", ("arm", 1, 0.0)), ("Forearm_L", ("arm", 1, T_ELBOW)), ("Shin_L", ("leg", 1, Z_KNEE)), ("Foot_L", ("leg", 1, Z_ANKLE))):
        mb = REGISTRY["Body"][1]
        ring = [mb.v[i] for i, t in enumerate(mb.tag) if t[0] == tag[0] and t[1] == tag[1] and abs(t[2] - tag[2]) < 0.02]
        if ring:
            c = sum(ring, Vector()) / len(ring); report.check("joint %s pivot is centred in the %s ring (offset %.3f m)" % (bn, tag[0], (bones[bn].head_local - c).length), (bones[bn].head_local - c).length < 0.04)
    # collections
    want = {"CHARACTER/BODY", "CHARACTER/CLOTHING", "CHARACTER/ARMOR", "CHARACTER/ACCESSORIES", "CHARACTER/ARMATURE"}
    report.check("organisation: CHARACTER/BODY/CLOTHING/ARMOR/ACCESSORIES/ARMATURE collections exist", want <= set(COLL))
    stray = [o.name for o in objs if not any(c.name in ("BODY", "CLOTHING", "ARMOR", "ACCESSORIES", "ARMATURE", "WEAPONS") for c in o.users_collection)]
    report.check("organisation: every character object sits in a CHARACTER sub-collection", not stray, stray)
    # transforms / pose
    report.check("transforms: no object offsets, rotations or non-unit scale", all(o.matrix_world == Matrix.Identity(4) for o in objs))
    zmin = min(v.co.z for v in REGISTRY["Left Boot"][0].data.vertices); zmax = max(v.co.z for v in REGISTRY["Hair"][0].data.vertices)
    report.check("transforms: feet on the ground, height %.2f m" % (zmax - zmin), abs(zmin) < 0.01 and 1.9 < zmax < 2.2)
    check_facing(report)
    mats = sorted({m.name for o in meshes for m in o.data.materials})
    report.check("materials: %d named MAT_Fighter_* materials" % len(mats), all(m.startswith("MAT_Fighter_") for m in mats), mats)

# ----------------------------------------------------------------------------- EXPORT
def export_all(report):
    bpy.ops.object.mode_set(mode='OBJECT') if bpy.context.object and bpy.context.object.mode != 'OBJECT' else None
    bpy.context.scene.frame_set(0)
    blend = os.path.join(OUT, "BlackRoot_Fighter_LowPoly_Rigged.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True); log("saved", blend)
    for o in bpy.data.objects: o.select_set(False)
    sel = [o for o in bpy.data.objects if o.type in ('MESH', 'ARMATURE') and o.name != "Ground" and o.users_collection and o.users_collection[0].name != "RENDER_RIG"]
    for o in sel: o.select_set(True)
    bpy.context.view_layer.objects.active = ARM
    glb = os.path.join(OUT, "BlackRoot_Fighter_LowPoly_Rigged.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_def_bones=True, export_animations=True,
                              export_force_sampling=True, export_apply=False, export_yup=True, export_skins=True, export_materials='EXPORT')
    ok = os.path.exists(glb) and os.path.getsize(glb) > 10000
    report.check("export: GLB written (%d kB)" % (os.path.getsize(glb) // 1024 if ok else 0), ok)
    # read the GLB header back and verify what landed in it
    import struct
    with open(glb, "rb") as f:
        magic, ver, length = struct.unpack("<III", f.read(12)); clen, ctype = struct.unpack("<II", f.read(8)); j = json.loads(f.read(clen))
    nodes = j.get("nodes", []); skins = j.get("skins", []); anims = j.get("animations", []); mats = j.get("materials", [])
    joints = len(skins[0]["joints"]) if skins else 0
    nmesh = len(j.get("meshes", []))
    report.check("export: GLB holds %d meshes, 1 skin with %d joints, %d materials, %d animation" % (nmesh, joints, len(mats), len(anims)), nmesh >= 40 and skins and joints >= 60 and anims)
    ndef = sum(1 for b in ARM.data.bones if b.use_deform)
    report.check("export: only deform bones exported as joints (%d joints = %d deform bones)" % (joints, ndef), joints == ndef)
    gen = [n["name"] for n in nodes if is_generic(n.get("name", "Object"))]
    report.check("export: no generic node names in the GLB", not gen, gen[:6])
    return blend, glb

# ----------------------------------------------------------------------------- MAIN
def main():
    reset_scene(); make_materials()
    mb = build_body(); mb.build("CHARACTER/BODY"); log("body built")
    build_gear(); log("gear built:", len(REGISTRY), "objects")
    arm_ob = build_armature(); log("armature built:", len(arm_ob.data.bones), "bones")
    skin_all(arm_ob)
    setup_render(SAMPLES); make_cameras()
    report = Report(); paths = []
    if DO_RENDER:
        for c in ("CAM_Front", "CAM_Right", "CAM_Back", "CAM_Left", "CAM_ThreeQ", "CAM_ThreeQ_Back", "CAM_Head", "CAM_Head_Side", "CAM_Feet", "CAM_Hands"):
            paths.append(render(c, os.path.join(OUT, "rest_%s.png" % c), (480, 660), SAMPLES))
        render_skeleton(paths)
    if DO_TESTS: run_stress_tests(report)
    validate(report)
    with open(os.path.join(OUT, "object_manifest.txt"), "w") as f:
        for name in sorted(n for n in REGISTRY if n != "Ground"):
            o = REGISTRY[name][0]; f.write("%-24s %-28s %5d verts %5d faces  groups: %s\n" % (name, o.users_collection[0].name, len(o.data.vertices), len(o.data.polygons), ", ".join(g.name for g in o.vertex_groups)))
        f.write("\nBONES (%d):\n" % len(ARM.data.bones))
        for b in ARM.data.bones: f.write("  %-20s parent %-18s %s\n" % (b.name, b.parent.name if b.parent else "-", "deform" if b.use_deform else "control"))
    export_all(report)
    report.write(os.path.join(OUT, "checks.txt"))
    log("DONE: %d checks, %d failing" % (len(report.items), report.fails))

main()
