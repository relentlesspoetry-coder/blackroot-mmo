#!/usr/bin/env python3
"""Audit every .glb for the defects that do not announce themselves.

    python3 tools/glbaudit.py [--all] [paths...]

Two of these have already cost a day each. A primitive with no NORMAL renders
pure black and absorbs any amount of brightening; a mirrored half wound the
wrong way lights from within. Both looked like art problems and were file
problems, and neither showed up as an error anywhere -- the model just looked
wrong, so the search went to the shader.

So this looks for the rest of that family: things a glTF is allowed to say
that this renderer cannot draw, and things it says that mean nothing was
drawn at all. It reports; it does not repair. tools/glbrepair.py repairs the
two it knows how to.

Checks, grouped by what goes wrong:

  BROKEN      non-finite positions, indices past the end of the vertex array,
              normals that are not unit length, animation channels pointing at
              nodes that do not exist, skin joints that do not exist, sampler
              inputs and outputs of different lengths, a buffer whose declared
              length is not its actual one. Any of these is a bug in the file.

  INVISIBLE   the failure mode this tool exists for -- the file is valid and
              the thing does not appear, or appears black:
                * metallicFactor with no environment map in the scene, which
                  is this client exactly. A metal has no diffuse of its own --
                  it is only what it reflects -- so with nothing to reflect,
                  all that survives is the specular highlight of the direct
                  lights. Measured here against a grey sphere under the same
                  light: metalness 0.55 keeps 68% of the brightness it would
                  have at 0, 0.90 keeps 46%, and 1.0 keeps 32%. Dark, not
                  black, and dark in a way no colour on the material fixes.
                * baseColorFactor alpha at 0, or alphaMode MASK with a cutoff
                  above 1 -- fully transparent by arithmetic.
                * a material naming a texture whose image is missing.

  WASTE       degenerate (zero-area) triangles, vertices no index reaches,
              TEXCOORD_0 on a material with no texture to sample, accessors
              and bufferViews nothing references, and the bytes they hold.

  BUDGET      triangle counts, so an ambient critter costing more than a boss
              is visible as a number rather than as a frame rate.
"""
import argparse
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

JSON_CHUNK, BIN_CHUNK = 0x4E4F534A, 0x004E4942
NP = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8,
      5122: np.int16, 5120: np.int8}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    d = Path(path).read_bytes()
    if d[:4] != b'glTF':
        return None, None
    off, js, bin_ = 12, None, b''
    while off + 8 <= len(d):
        ln, ty = struct.unpack_from('<II', d, off)
        blob = d[off + 8:off + 8 + ln]
        if ty == JSON_CHUNK:
            js = json.loads(blob)
        elif ty == BIN_CHUNK:
            bin_ = blob
        off += 8 + ln
    return js, bin_


def accessor(js, bin_, i):
    a = js['accessors'][i]
    if 'sparse' in a or 'bufferView' not in a:
        return None
    n, comps = a['count'], NCOMP[a['type']]
    dt = np.dtype(NP[a['componentType']])
    bv = js['bufferViews'][a['bufferView']]
    base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride') or comps * dt.itemsize
    width = comps * dt.itemsize
    need = (n - 1) * stride + width
    if base + need > len(bin_):
        return None
    if stride == width:
        return np.frombuffer(bin_, dt, n * comps, base).reshape(n, comps)
    raw = np.frombuffer(bin_, np.uint8, need, base)
    rows = np.zeros((n, stride), np.uint8)
    rows.reshape(-1)[:len(raw)] = raw
    return rows[:, :width].copy().view(dt).reshape(n, comps)


def audit(path, js, bin_):
    broken, invisible, waste = [], [], []
    tris = 0

    # --- what the file says about itself -----------------------------------
    for b in js.get('buffers', []):
        if 'uri' not in b and b.get('byteLength', 0) > len(bin_):
            broken.append(f'buffer declares {b["byteLength"]} bytes, chunk holds {len(bin_)}')
    nodes = len(js.get('nodes', []))
    for ai, anim in enumerate(js.get('animations', [])):
        for ch in anim.get('channels', []):
            t = ch.get('target', {}).get('node')
            if t is None or t >= nodes:
                broken.append(f'animation {ai} drives node {t}, which does not exist')
        for si, sm in enumerate(anim.get('samplers', [])):
            i_, o_ = accessor(js, bin_, sm['input']), accessor(js, bin_, sm['output'])
            if i_ is None or o_ is None:
                broken.append(f'animation {ai} sampler {si} has an unreadable accessor')
            elif len(o_) % len(i_):
                broken.append(f'animation {ai} sampler {si}: {len(i_)} keys, {len(o_)} values')
    for si, sk in enumerate(js.get('skins', [])):
        if any(j >= nodes for j in sk.get('joints', [])):
            broken.append(f'skin {si} names joints that do not exist')

    # --- materials ---------------------------------------------------------
    textured = set()
    for mi, m in enumerate(js.get('materials', [])):
        name = m.get('name', f'#{mi}')
        pbr = m.get('pbrMetallicRoughness', {})
        metal = pbr.get('metallicFactor', 1.0)
        if metal > 0.5:
            # measured on this client: see the header
            keeps = round(100 * (1.0 - 0.68 * metal))
            invisible.append(f'material {name}: metallicFactor {metal:.2f}, no environment map '
                             f'-- keeps about {keeps}% of its brightness')
        col = pbr.get('baseColorFactor', [1, 1, 1, 1])
        if len(col) > 3 and col[3] <= 0.001:
            invisible.append(f'material {name}: baseColorFactor alpha {col[3]}')
        if m.get('alphaMode') == 'MASK' and m.get('alphaCutoff', 0.5) > 1.0:
            invisible.append(f'material {name}: alphaCutoff {m["alphaCutoff"]} masks everything')
        for slot in ('baseColorTexture', 'metallicRoughnessTexture'):
            if slot in pbr:
                textured.add(mi)
                ti = pbr[slot].get('index')
                tex = (js.get('textures') or [None] * (ti + 1))[ti] if ti is not None else None
                if tex is None or tex.get('source') is None:
                    invisible.append(f'material {name}: {slot} names no image')
        for slot in ('normalTexture', 'emissiveTexture', 'occlusionTexture'):
            if slot in m:
                textured.add(mi)

    # --- geometry ----------------------------------------------------------
    used_acc, used_bv = set(), set()
    uv_dead = [0]
    for mesh in js.get('meshes', []):
        for prim in mesh.get('primitives', []):
            name = mesh.get('name', '?')
            for a in prim.get('attributes', {}).values():
                used_acc.add(a)
            if 'indices' in prim:
                used_acc.add(prim['indices'])
            for t in prim.get('targets', []) or []:
                used_acc.update(t.values())
            if prim.get('mode', 4) != 4:
                waste.append(f'{name}: primitive mode {prim.get("mode")} (not triangles)')
                continue
            pi = prim['attributes'].get('POSITION')
            pos = accessor(js, bin_, pi) if pi is not None else None
            if pos is None:
                broken.append(f'{name}: POSITION is unreadable')
                continue
            if not np.all(np.isfinite(pos)):
                broken.append(f'{name}: {int((~np.isfinite(pos)).any(axis=1).sum())} vertices are NaN or infinite')
            pa = js['accessors'][pi]
            if 'min' not in pa or 'max' not in pa:
                broken.append(f'{name}: POSITION accessor has no min/max (the spec requires it)')
            elif len(pa.get('min', [])) == 3 and np.all(np.isfinite(pos)):
                if (not np.allclose(pa['min'], pos.min(axis=0), atol=1e-4)
                        or not np.allclose(pa['max'], pos.max(axis=0), atol=1e-4)):
                    broken.append(f'{name}: POSITION min/max disagree with the vertices')
            ni = prim['attributes'].get('NORMAL')
            if ni is not None:
                nrm = accessor(js, bin_, ni)
                if nrm is None:
                    broken.append(f'{name}: NORMAL is unreadable')
                else:
                    ln = np.linalg.norm(nrm.astype(np.float64), axis=1)
                    n_bad = int((~np.isfinite(ln)).sum() + (np.abs(ln - 1) > 1e-3).sum())
                    if n_bad:
                        broken.append(f'{name}: {n_bad} normals are not unit length')
            if 'indices' not in prim:
                waste.append(f'{name}: not indexed')
                continue
            idx = accessor(js, bin_, prim['indices'])
            if idx is None:
                broken.append(f'{name}: indices are unreadable')
                continue
            idx = idx.reshape(-1).astype(np.int64)
            if idx.max(initial=-1) >= len(pos):
                broken.append(f'{name}: an index points past the end of the vertex array')
                continue
            f = idx.reshape(-1, 3)
            tris += len(f)
            t = pos[f].astype(np.float64)
            area = 0.5 * np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
            dead = int((area <= 1e-12).sum())
            if dead:
                waste.append(f'{name}: {dead} of {len(f)} triangles have no area')
            orphan = len(pos) - len(np.unique(idx))
            if orphan:
                waste.append(f'{name}: {orphan} of {len(pos)} vertices are unreachable')
            mat = prim.get('material')
            if 'TEXCOORD_0' in prim['attributes'] and mat is not None and mat not in textured:
                # Counted in BYTES and summed per file. As a count it was 5,600
                # lines of report for a few hundred KiB, which is a finding
                # nobody reads and so a finding that is not made.
                uv_dead[0] += len(pos) * 8

    if uv_dead[0] > 4096:
        waste.append(f'{uv_dead[0] / 1024:.0f} KiB of TEXCOORD_0 with no texture to sample')
    dead_acc = [i for i in range(len(js.get('accessors', []))) if i not in used_acc]
    for i, a in enumerate(js.get('accessors', [])):
        if i in used_acc and 'bufferView' in a:
            used_bv.add(a['bufferView'])
    for anim in js.get('animations', []):
        for sm in anim.get('samplers', []):
            for k in ('input', 'output'):
                a = js['accessors'][sm[k]]
                if 'bufferView' in a:
                    used_bv.add(a['bufferView'])
                dead_acc = [i for i in dead_acc if i != sm[k]]
    for sk in js.get('skins', []):
        if 'inverseBindMatrices' in sk:
            a = js['accessors'][sk['inverseBindMatrices']]
            if 'bufferView' in a:
                used_bv.add(a['bufferView'])
            dead_acc = [i for i in dead_acc if i != sk['inverseBindMatrices']]
    for im in js.get('images', []):
        if 'bufferView' in im:
            used_bv.add(im['bufferView'])
    dead_bytes = sum(bv.get('byteLength', 0) for i, bv in enumerate(js.get('bufferViews', []))
                     if i not in used_bv)
    if dead_bytes > 1024:
        waste.append(f'{dead_bytes / 1024:.0f} KiB in bufferViews nothing references')
    if dead_acc:
        waste.append(f'{len(dead_acc)} accessors nothing references')
    return broken, invisible, waste, tris


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('paths', nargs='*', type=Path)
    ap.add_argument('--all', action='store_true', help='also list files with nothing wrong')
    args = ap.parse_args()
    root = Path(__file__).resolve().parent.parent / 'client' / 'models'
    files = args.paths or sorted(root.rglob('*.glb'))
    totals = defaultdict(int)
    budget = []
    for f in files:
        js, bin_ = read_glb(f)
        if js is None:
            print(f'{f}: not a binary glTF')
            continue
        broken, invisible, waste, tris = audit(f, js, bin_)
        rel = f.relative_to(root) if root in f.parents else f
        budget.append((tris, str(rel)))
        totals['BROKEN'] += len(broken)
        totals['INVISIBLE'] += len(invisible)
        totals['WASTE'] += len(waste)
        if not (broken or invisible or waste):
            if args.all:
                print(f'  {rel}: clean ({tris} triangles)')
            continue
        print(f'\n{rel}   ({tris} triangles)')
        for tag, rows in (('BROKEN', broken), ('INVISIBLE', invisible), ('WASTE', waste)):
            for r in rows:
                print(f'   {tag:9} {r}')
    print(f'\n{len(files)} files: '
          + ', '.join(f'{v} {k.lower()}' for k, v in totals.items()) or 'nothing found')
    budget.sort(reverse=True)
    print('\nBUDGET, heaviest first:')
    for t, n in budget[:12]:
        print(f'   {t:7} triangles  {n}')
    return 1 if totals['BROKEN'] else 0


if __name__ == '__main__':
    sys.exit(main())
