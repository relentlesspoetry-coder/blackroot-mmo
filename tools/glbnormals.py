#!/usr/bin/env python3
"""Write normals into a .glb that shipped without them, in place.

    python3 tools/glbnormals.py client/models/Moth.glb

For the models NOTHING generates. A glTF may leave the NORMAL accessor off a
primitive; three then lights the mesh off vec3(0.0), normalize() of which is
NaN, and it renders pure BLACK -- immune to colour, to emissive, to light.
The generated kits get theirs from tools/glbkit.py at build time; an authored
GLB has no build step to fix, so it is repaired here instead.

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

So this tool never changes the geometry. Same vertices, same indices, same
nodes, same animations, same materials -- one accessor added per primitive
that was missing one. Everything else in the file is copied through
untouched, which is what makes it safe to run on art nobody here authored.
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
    rows = np.frombuffer(bin_, np.uint8, n * stride, base).reshape(n, stride)
    return rows[:, :comps * dt.itemsize].copy().view(dt).reshape(n, comps)


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


def add_normals(js, bin_):
    """One NORMAL accessor per primitive that lacks one. Appends to the buffer;
    every existing bufferView keeps its offset, so nothing else moves."""
    if len(js.get('buffers', [])) != 1 or 'uri' in js['buffers'][0]:
        raise SystemExit('expected one embedded buffer')
    done = 0
    for mesh in js.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if 'NORMAL' in prim['attributes'] or prim.get('mode', 4) != 4:
                continue
            if 'indices' not in prim:
                raise SystemExit(f"{mesh.get('name')}: non-indexed primitive")
            pos = read_accessor(js, bin_, prim['attributes']['POSITION']).astype(np.float64)
            idx = read_accessor(js, bin_, prim['indices']).reshape(-1, 3).astype(np.int64)
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
            done += 1
    js['buffers'][0]['byteLength'] = len(bin_) + ((4 - len(bin_) % 4) % 4)
    return done


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('files', nargs='+', type=Path)
    ap.add_argument('--check', action='store_true',
                    help='report what is missing and change nothing')
    args = ap.parse_args()
    touched = 0
    for f in args.files:
        js, bin_ = read_glb(f)
        bare = [(m.get('name', '?'), p) for m in js.get('meshes', [])
                for p in m.get('primitives', []) if 'NORMAL' not in p['attributes']]
        if not bare:
            print(f'  {f}: every primitive already has normals')
            continue
        if args.check:
            print(f'  {f}: {len(bare)} primitives without NORMAL '
                  f'({", ".join(sorted({n for n, _ in bare}))})')
            touched += 1
            continue
        before = f.stat().st_size
        n = add_normals(js, bin_)
        after = write_glb(f, js, bin_)
        print(f'  {f}: {n} primitives given smooth normals   '
              f'{before / 1024:.0f} -> {after / 1024:.0f} KiB')
        touched += 1
    return 1 if (args.check and touched) else 0


if __name__ == '__main__':
    sys.exit(main())
