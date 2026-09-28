#!/usr/bin/env python3
"""Repair an authored .glb in place: winding first, then normals.

    python3 tools/glbrepair.py client/models/Moth.glb

For the models NOTHING generates. The generated kits get this right at build
time in tools/glbkit.py; an authored GLB has no build step to fix, so it is
repaired here instead.

The two repairs are one tool, in this order, because the second is computed
FROM the first. A normal is the cross product of a triangle's edges, so it
points whichever way the triangle is wound: fix the winding after writing the
normals and the normals are silently stale, pointing into the mesh they were
supposed to light.

  WINDING. Triangles mirrored to make the other half of a model, without
  reversing their vertex order, come out inside out -- the signed volume of
  the part goes negative. Faces are re-wound to agree with their neighbours,
  then each connected shell is flipped as a whole if it still encloses
  negative volume. Only the ORDER of a triangle's three indices changes:
  same vertices, same positions, same UVs, same triangle count.

  NORMALS. A glTF may leave the NORMAL accessor off a primitive; three then
  lights the mesh off vec3(0.0), normalize() of which is NaN, and it renders
  pure BLACK -- immune to colour, to emissive, to light.

The normals are SMOOTH -- area-weighted across the faces meeting at each
vertex, the same thing three's computeVertexNormals() does, and the same thing
the client's loader has been computing for this file every load. That is
deliberate, and it is the opposite of the choice glbkit makes:

  - glbkit's art is low-poly stone and plank, a few hundred triangles a piece,
    and it wants every facet to read. Flat normals need per-face vertices.
  - This is for dense authored meshes. The moth is 61k triangles across 31k
    vertices; per-face vertices would be 183k of them and take the file from
    1.2 MB to 6.4 MB, for a critter you see at night at forty metres. Its
    sibling Butterfly.glb ships smooth normals for the same reason.

Nothing else in the file is touched: same vertices, same positions, same UVs,
same triangle count, same nodes, same animations, same materials. That is what
makes it safe to run on art nobody here authored -- and the tool re-reads what
it wrote and proves it, every run, rather than asserting it.
"""
import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np

JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942
FLOAT, USHORT, UINT, UBYTE = 5126, 5123, 5125, 5121
NP = {FLOAT: np.float32, USHORT: np.uint16, UINT: np.uint32, UBYTE: np.uint8}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read_glb(path):
    d = Path(path).read_bytes()
    if d[:4] != b'glTF':
        raise SystemExit(f'{path}: not a binary glTF')
    off, js, bin_ = 12, None, b''
    while off + 8 <= len(d):
        ln, ty = struct.unpack_from('<II', d, off)
        blob = d[off + 8:off + 8 + ln]
        if ty == JSON_CHUNK:
            js = json.loads(blob)
        elif ty == BIN_CHUNK:
            bin_ = blob
        off += 8 + ln
    return js, bytearray(bin_)


def write_glb(path, js, bin_):
    def pad(b, fill):
        return bytes(b) + fill * ((4 - len(b) % 4) % 4)
    j = pad(json.dumps(js, separators=(',', ':')).encode('utf-8'), b' ')
    b = pad(bin_, b'\x00')
    total = 12 + 8 + len(j) + (8 + len(b) if b else 0)
    out = bytearray(struct.pack('<4sII', b'glTF', 2, total))
    out += struct.pack('<II', len(j), JSON_CHUNK) + j
    if b:
        out += struct.pack('<II', len(b), BIN_CHUNK) + b
    Path(path).write_bytes(out)
    return total


def read_accessor(js, bin_, i):
    """Accessor -> numpy array. Handles interleaved bufferViews via byteStride."""
    a = js['accessors'][i]
    if 'sparse' in a:
        raise SystemExit('sparse accessors are not handled')
    n, comps = a['count'], NCOMP[a['type']]
    dt = np.dtype(NP[a['componentType']])
    bv = js['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or comps * dt.itemsize
    if stride == comps * dt.itemsize:
        return np.frombuffer(bin_, dt, n * comps, base).reshape(n, comps)
    # The LAST element of an interleaved range does not need its trailing
    # padding, so the range is (n-1) strides plus one element -- asking for
    # n strides runs off the end of the buffer on a well-formed file.
    width = comps * dt.itemsize
    raw = np.frombuffer(bin_, np.uint8, (n - 1) * stride + width, base)
    rows = np.zeros((n, stride), np.uint8)
    rows.reshape(-1)[:len(raw)] = raw
    return rows[:, :width].copy().view(dt).reshape(n, comps)


def signed_volume(pos, idx):
    """Six times the volume each shell encloses, by its winding. Negative means
    the triangles face inward."""
    t = pos[idx]
    return float(np.einsum('ij,ij->i', t[:, 0], np.cross(t[:, 1], t[:, 2])).sum())


def fix_winding(pos, idx):
    """Re-wind faces so neighbours agree, then flip any CLOSED shell that is
    still inside out.

    trimesh.repair does this, but it wants networkx and the project's venv is
    numpy and trimesh alone -- and a repair tool that needs a dependency the
    repo does not have is a repair nobody can reproduce. It is thirty lines
    with an edge table anyway.

    Two triangles sharing an edge are wound consistently when they traverse
    that edge in OPPOSITE directions -- which is the whole rule, applied
    outward from one face per shell. Consistency alone does not say which way
    is OUT, though, and the thing that does -- the sign of the volume the
    shell encloses -- only means anything if the shell is closed. An open
    surface has no inside, so its orientation is left exactly as found: the
    first pass over the models flipped a third of them on a number that was
    noise, which is the kind of repair that is worse than the defect.

    Returns (faces, stats).
    """
    idx = idx.copy()
    n = len(idx)
    # Adjacency is built on WELDED positions, not on the indices as written.
    # A model exported with a duplicated vertex down a seam has two indices for
    # one point, so matching edges by index makes the seam look like a boundary
    # and splits the surface into open patches.
    _, weld = np.unique(np.round(pos, 6), axis=0, return_inverse=True)
    key_idx = weld.reshape(-1)[idx]
    # every directed edge, and whether the face states it in sorted order
    e = np.concatenate([key_idx[:, [0, 1]], key_idx[:, [1, 2]], key_idx[:, [2, 0]]])
    face_of = np.tile(np.arange(n), 3)
    fwd = e[:, 0] < e[:, 1]                       # traversed low->high?
    key = np.sort(e, axis=1)
    order = np.lexsort((key[:, 1], key[:, 0]))
    key, face_of, fwd = key[order], face_of[order], fwd[order]
    starts = np.flatnonzero(np.r_[True, np.any(key[1:] != key[:-1], axis=1)])
    ends = np.r_[starts[1:], len(key)]
    nbr = [[] for _ in range(n)]
    loose = np.zeros(n, bool)                     # touches a boundary/non-manifold edge
    bad_edges = 0
    for a, b in zip(starts, ends):
        if b - a != 2:
            loose[face_of[a:b]] = True
            continue
        f1, f2, same = face_of[a], face_of[a + 1], bool(fwd[a] == fwd[a + 1])
        if same:
            bad_edges += 1
        if f1 != f2:
            nbr[f1].append((f2, same))
            nbr[f2].append((f1, same))
    flip = np.zeros(n, bool)
    seen = np.zeros(n, bool)
    inverted = open_shells = 0
    turned = []
    for root in range(n):
        if seen[root]:
            continue
        seen[root] = True
        shell, stack = [root], [root]
        while stack:
            f = stack.pop()
            for g, same in nbr[f]:
                # `same` means both faces walk the shared edge the same way,
                # which is exactly when one of them has to turn round
                if seen[g]:
                    continue
                seen[g] = True
                flip[g] = flip[f] ^ same
                shell.append(g)
                stack.append(g)
        shell = np.array(shell)
        if loose[shell].any():
            open_shells += 1
            continue                              # no inside, so no way round to prefer
        sub = np.where(flip[shell, None], idx[shell][:, [0, 2, 1]], idx[shell])
        if signed_volume(pos, sub) < 0:
            flip[shell] = ~flip[shell]
            inverted += 1
            turned.append(idx[shell].reshape(-1))
    idx[flip] = idx[flip][:, [0, 2, 1]]
    return idx, {'bad_edges': bad_edges, 'faces_changed': int(flip.sum()),
                 'shells_inverted': inverted, 'open_shells': open_shells,
                 'turned_verts': (np.unique(np.concatenate(turned)) if turned
                                  else np.zeros(0, np.int64))}


def smooth_normals(pos, idx):
    """Area-weighted vertex normals -- the cross product of each triangle's
    edges is already proportional to twice its area, so summing them per
    vertex weights big faces more, which is what three does too."""
    tri = pos[idx]
    face = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    out = np.zeros_like(pos, np.float64)
    for k in range(3):
        np.add.at(out, idx[:, k], face)
    ln = np.linalg.norm(out, axis=1, keepdims=True)
    # A vertex used only by degenerate faces has no direction to point in.
    # Up beats NaN, which is the whole reason this tool exists.
    return np.where(ln > 1e-12, out / np.where(ln > 0, ln, 1.0), np.array([0.0, 1.0, 0.0]))


def _index_users(js):
    """How many primitives reference each index accessor.

    Mirrored halves of a model SHARE their index buffer -- the moth's left and
    right wings are one topology with two POSITION accessors -- and mirroring
    is exactly what puts the winding wrong. So the two halves need OPPOSITE
    windings out of one buffer, and re-winding them in place means the second
    one repaired overwrites the first. That read as the fix not working: the
    left wing came out inverted by precisely the amount the right was fixed.
    A shared buffer has to be forked instead.
    """
    n = {}
    for mesh in js.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if 'indices' in prim:
                n[prim['indices']] = n.get(prim['indices'], 0) + 1
    return n


def _exclusive_view(js, acc_i):
    """True if this accessor is the only thing in its bufferView, so its bytes
    can be overwritten without disturbing anything else."""
    a = js['accessors'][acc_i]
    if a.get('byteOffset', 0):
        return False
    users = sum(1 for o in js['accessors'] if o.get('bufferView') == a['bufferView'])
    return users == 1


def _users(js, key):
    """How many primitives reference each accessor under `key` ('indices', or
    an attribute name).

    Mirrored halves of a model SHARE their buffers -- the moth's left and right
    wings are one topology with two POSITION accessors -- and mirroring is
    exactly what puts the winding wrong. So the two halves need OPPOSITE
    windings out of one buffer, and re-winding them in place means the second
    one repaired overwrites the first. That read as the fix not working: the
    left wing came out inverted by precisely the amount the right was fixed.
    A shared buffer has to be forked instead.
    """
    n = {}
    for mesh in js.get('meshes', []):
        for prim in mesh.get('primitives', []):
            a = prim.get('indices') if key == 'indices' else prim['attributes'].get(key)
            if a is not None:
                n[a] = n.get(a, 0) + 1
    return n


def _exclusive_view(js, acc_i):
    """True if this accessor is the only thing in its bufferView, so its bytes
    can be overwritten without disturbing anything else."""
    a = js['accessors'][acc_i]
    if a.get('byteOffset', 0):
        return False
    return sum(1 for o in js['accessors'] if o.get('bufferView') == a['bufferView']) == 1


def _put(js, bin_, prim, key, data, fork, target):
    """Write an accessor's data back for one primitive.

    Forked into a new accessor when the buffer is shared with another
    primitive, appended when the bufferView is shared with another accessor,
    and written in place only when this accessor owns its bytes outright --
    because silently overwriting what another primitive reads is how a repair
    tool becomes the bug.
    """
    acc_i = prim['indices'] if key == 'indices' else prim['attributes'][key]
    a = js['accessors'][acc_i]
    blob = data.reshape(-1).astype(np.dtype(NP[a['componentType']])).tobytes()
    if not fork and _exclusive_view(js, acc_i):
        bv = js['bufferViews'][a['bufferView']]
        off = bv.get('byteOffset', 0)
        assert len(blob) == bv['byteLength'], f'{key} length changed'
        bin_[off:off + len(blob)] = blob
        return
    while len(bin_) % 4:
        bin_ += b'\x00'
    js['bufferViews'].append({'buffer': 0, 'byteOffset': len(bin_),
                              'byteLength': len(blob), 'target': target})
    bin_ += blob
    view = len(js['bufferViews']) - 1
    if fork:
        js['accessors'].append(dict(a))
        js['accessors'][-1]['bufferView'] = view
        js['accessors'][-1].pop('byteOffset', None)
        if key == 'indices':
            prim['indices'] = len(js['accessors']) - 1
        else:
            prim['attributes'][key] = len(js['accessors']) - 1
    else:
        a['bufferView'] = view
        a.pop('byteOffset', None)


def repair(js, bin_, reshade=False):
    """Winding, then normals, primitive by primitive. Appends to the buffer, so
    every existing bufferView keeps its offset and nothing else moves."""
    if len(js.get('buffers', [])) != 1 or 'uri' in js['buffers'][0]:
        raise SystemExit('expected one embedded buffer')
    wound = normals = 0
    detail, declined = [], []
    idx_users, nrm_users = _users(js, 'indices'), _users(js, 'NORMAL')
    for mesh in js.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if prim.get('mode', 4) != 4:
                continue
            if 'indices' not in prim:
                raise SystemExit(f"{mesh.get('name')}: non-indexed primitive")
            name = mesh.get('name', '?')
            pos = read_accessor(js, bin_, prim['attributes']['POSITION']).astype(np.float64)
            idx = read_accessor(js, bin_, prim['indices']).reshape(-1, 3).astype(np.int64)
            fixed, st = fix_winding(pos, idx)
            has_normals = 'NORMAL' in prim['attributes']
            if st['faces_changed'] and has_normals and st['bad_edges'] and not reshade:
                # The normals already in the file were authored or generated
                # against the OLD winding. When the change is whole shells
                # turning over, the matching normals are just the negation --
                # exact, and it keeps whatever smoothing was authored. When it
                # is faces disagreeing along a seam, there is no such mapping:
                # the only way to keep them in step would be to recompute the
                # primitive's shading wholesale, which is a decision about
                # someone's art, not a repair. Left alone and reported.
                declined.append(f'{name} ({st["bad_edges"]} disagreeing seams, with normals already)')
                continue
            # --reshade says: recompute this primitive's shading from the
            # repaired winding. It is a deliberate choice, not a default,
            # because it discards whatever smoothing the file was authored
            # with -- fine on a prop, not something to do to a character
            # behind the author's back.
            reshading = reshade and has_normals and st['bad_edges'] and st['faces_changed']
            if st['faces_changed']:
                _put(js, bin_, prim, 'indices', fixed,
                     idx_users.get(prim['indices'], 1) > 1, 34963)
                idx = fixed
                wound += 1
                detail.append(f"{name}: {st['faces_changed']} faces re-wound"
                              + (f", {st['bad_edges']} disagreeing seams" if st['bad_edges'] else '')
                              + (f", {st['shells_inverted']} shell(s) turned outside out"
                                 if st['shells_inverted'] else ''))
                if has_normals and len(st['turned_verts']):
                    nrm = read_accessor(js, bin_, prim['attributes']['NORMAL']).astype(np.float32).copy()
                    nrm[st['turned_verts']] *= -1.0
                    _put(js, bin_, prim, 'NORMAL', nrm,
                         nrm_users.get(prim['attributes']['NORMAL'], 1) > 1, 34962)
            if reshading:
                _put(js, bin_, prim, 'NORMAL', smooth_normals(pos, idx).astype(np.float32),
                     nrm_users.get(prim['attributes']['NORMAL'], 1) > 1, 34962)
                normals += 1
            if not has_normals:
                nrm = smooth_normals(pos, idx).astype(np.float32)
                while len(bin_) % 4:
                    bin_ += b'\x00'
                off, blob = len(bin_), nrm.tobytes()
                bin_ += blob
                js['bufferViews'].append({'buffer': 0, 'byteOffset': off,
                                          'byteLength': len(blob), 'target': 34962})
                js['accessors'].append({'bufferView': len(js['bufferViews']) - 1,
                                        'componentType': FLOAT, 'count': len(nrm),
                                        'type': 'VEC3'})
                prim['attributes']['NORMAL'] = len(js['accessors']) - 1
                normals += 1
    js['buffers'][0]['byteLength'] = len(bin_) + ((4 - len(bin_) % 4) % 4)
    return wound, normals, detail, declined


def survey(js, bin_):
    """What is wrong with this file, as numbers. Used to report before the
    repair and to prove it after."""
    bare = shells = 0
    seams = 0
    for mesh in js.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if prim.get('mode', 4) != 4 or 'indices' not in prim:
                continue
            if 'NORMAL' not in prim['attributes']:
                bare += 1
            pos = read_accessor(js, bin_, prim['attributes']['POSITION']).astype(np.float64)
            idx = read_accessor(js, bin_, prim['indices']).reshape(-1, 3).astype(np.int64)
            _, st = fix_winding(pos, idx)
            if st['bad_edges']:
                seams += 1
            if st['faces_changed'] and not st['bad_edges']:
                shells += 1
    return {'primitives without NORMAL': bare,
            'primitives wound inconsistently': seams,
            'closed primitives inside out': shells}


def prove(before, after):
    """Re-read what was written and show it is the same model.

    Every triangle must still be the same three vertices -- a re-wound face is
    a rotation or a reflection of its index triple, never a different triple --
    and nothing outside the mesh data may have moved.
    """
    ojs, ob = before
    njs, nb = after
    bad = []
    for k in ('nodes', 'animations', 'materials', 'meshes', 'skins', 'images', 'textures'):
        if len(ojs.get(k, [])) != len(njs.get(k, [])):
            bad.append(f'{k} count changed')
    if ojs.get('nodes') != njs.get('nodes') or ojs.get('scenes') != njs.get('scenes'):
        bad.append('node graph changed')
    if ojs.get('animations') != njs.get('animations'):
        bad.append('animations changed')
    prims = 0
    for om, nm in zip(ojs.get('meshes', []), njs.get('meshes', [])):
        for op, npm in zip(om.get('primitives', []), nm.get('primitives', [])):
            prims += 1
            name = nm.get('name', '?')
            opos = read_accessor(ojs, ob, op['attributes']['POSITION'])
            npos = read_accessor(njs, nb, npm['attributes']['POSITION'])
            if not np.array_equal(opos, npos):
                bad.append(f'{name}: positions changed')
            for attr in op['attributes']:
                if attr == 'NORMAL':
                    continue
                if not np.array_equal(read_accessor(ojs, ob, op['attributes'][attr]),
                                      read_accessor(njs, nb, npm['attributes'][attr])):
                    bad.append(f'{name}: {attr} changed')
            if 'indices' not in op:
                continue
            oi = read_accessor(ojs, ob, op['indices']).reshape(-1, 3)
            ni = read_accessor(njs, nb, npm['indices']).reshape(-1, 3)
            if oi.shape != ni.shape:
                bad.append(f'{name}: triangle count changed')
            elif not np.array_equal(np.sort(oi, axis=1), np.sort(ni, axis=1)):
                bad.append(f'{name}: triangles are not the same triangles')
            nrm = read_accessor(njs, nb, npm['attributes']['NORMAL'])
            ln = np.linalg.norm(nrm.astype(np.float64), axis=1)
            if len(nrm) != len(npos) or not np.all(np.isfinite(nrm)) or np.any(np.abs(ln - 1) > 1e-4):
                bad.append(f'{name}: normals are not unit-length and finite')
    return prims, bad


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('files', nargs='+', type=Path)
    ap.add_argument('--check', action='store_true',
                    help='report what is wrong and change nothing')
    ap.add_argument('--reshade', action='store_true',
                    help='also recompute normals where re-winding a seam makes '
                         'the stored ones meaningless (discards authored shading)')
    args = ap.parse_args()
    touched = 0
    for f in args.files:
        js, bin_ = read_glb(f)
        found = survey(js, bin_)
        if not any(found.values()):
            print(f'  {f}: nothing to repair')
            continue
        note = ', '.join(f'{v} {k}' for k, v in found.items() if v)
        if args.check:
            print(f'  {f}: {note}')
            touched += 1
            continue
        print(f'  {f}: {note}')
        before = (json.loads(json.dumps(js)), bytes(bin_))
        size = f.stat().st_size
        wound, normals, detail, declined = repair(js, bin_, args.reshade)
        after = write_glb(f, js, bin_)
        for d in detail:
            print(f'      {d}')
        for d in declined:
            print(f'      left alone, needs a decision: {d}')
        left = survey(*read_glb(f))
        prims, bad = prove(before, read_glb(f))
        print(f'    re-wound {wound}, given normals {normals}   '
              f'{size / 1024:.0f} -> {after / 1024:.0f} KiB')
        print(f'    left: {", ".join(f"{v} {k}" for k, v in left.items()) or "nothing"}')
        print(f'    proof: {prims} primitives, same positions, same attributes, '
              f'same triangles, normals unit-length'
              if not bad else '    PROOF FAILED: ' + '; '.join(bad))
        if bad or any(v for k, v in left.items() if not declined):
            return 1
        touched += 1
    return 1 if (args.check and touched) else 0


if __name__ == '__main__':
    sys.exit(main())
