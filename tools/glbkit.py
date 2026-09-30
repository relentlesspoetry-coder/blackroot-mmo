"""One place a generated kit turns its parts into a .glb.

Six build_*.py scripts carried a copy of this function that differed only in a
roughness constant -- and every one of them shipped meshes with no NORMAL
accessor, because trimesh leaves normals out of a GLB unless you ask for them.
three then lights the mesh off vec3(0.0); normalize() of that is NaN, and the
mesh renders pure BLACK: not dim, not mistinted, black, and immune to colour,
to emissive, to light. 230 primitives across 63 of our GLBs were doing exactly
that -- the whole ruin kit, most of the darkwoods props, the blockouts, every
fish. The client now computes normals at load so nothing can render black
again, but an asset that is only right because the loader repairs it is an
asset that is wrong, and the loader cannot give back what the file never said.

Which is the second half of this: the normals are FLAT.

Unmerged to per-face vertices, so every facet keeps its own normal. That is
what this art is -- low-poly stone, plank and bone, the same choice
build_weapons.py makes and for the same reason. The alternative is what the
loader's fallback has been doing all along: computeVertexNormals() on an
indexed mesh averages every face meeting at a vertex, so a stone block welded
to eight corner vertices shades like a pebble. Every wall, gravestone and
boardwalk plank in the zone has been softened that way since it was built.
"""
from pathlib import Path

import numpy as np
import trimesh

from glbrepair import fix_winding


def flat_normals(m):
    """Per-face normals, by giving every face its own three vertices.

    trimesh's own vertex_normals would area-average across the seam (and on a
    box that is the whole model), so the normals are written here rather than
    left to it. After unmerge_vertices each vertex belongs to exactly one
    face, which makes the assignment unambiguous.
    """
    m.unmerge_vertices()
    n = np.zeros((len(m.vertices), 3), np.float64)
    n[m.faces.reshape(-1)] = np.repeat(m.face_normals, 3, axis=0)
    m.vertex_normals = n
    return m


def save(out_dir, name, parts, roughness=0.95, pbr=None):
    """Group `parts` by their metadata['colour'], one mesh and one PBR material
    per colour -- NOT vertex colours, which the client's bakeModel strips (the
    model would render black).

    A part may also carry metadata['mat'], a NAME for what the surface is made
    of, and it is worth carrying. The material name is the only thing the client
    has to go on when it decides which detail texture a surface gets
    (DETAIL_RULES -> detailFor), and a name like `Boardwalk_A_0` says nothing --
    149 of the 214 materials this function had named fell through to the stone
    fallback, the whole boardwalk kit among them, so every plank in the Murkfen
    is grained like granite. Name it `Planks | weathered oak` and it gets wood.

    `pbr` may be a callable taking the colour tuple and returning
    (metallic, roughness), for kits with a metal in the palette; without one
    everything is non-metallic at `roughness`. Returns (path, triangles).
    """
    groups = {}
    for part in parts:
        groups.setdefault(tuple(part.metadata['colour']), []).append(part)
    # the first member of a colour group that says what it is names the material
    named = {}
    for part in parts:
        k = tuple(part.metadata['colour'])
        if k not in named and part.metadata.get('mat'):
            named[k] = part.metadata['mat']
    scene = trimesh.Scene()
    faces = 0
    for i, (colour, members) in enumerate(groups.items()):
        m = trimesh.util.concatenate(members) if len(members) > 1 else members[0].copy()
        m.merge_vertices()          # weld the duplicates the parts arrive with
        faces += len(m.faces)
        # Winding BEFORE normals, because the normal is derived from it: a
        # part built inside out gets normals pointing into itself, and no
        # amount of care further down fixes that. Ruin_Gable was exactly this
        # -- one eight-face shell wound backwards, lit from within.
        wound, st = fix_winding(np.asarray(m.vertices), np.asarray(m.faces))
        if st['faces_changed']:
            m.faces = wound
        flat_normals(m)             # ...then split the vertices, per face
        metallic, rough = pbr(colour) if pbr else (0.0, roughness)
        m.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
            name=named.get(colour, f'{name}_{i}'),
            baseColorFactor=[int(round(c * 255)) for c in colour] + [255],
            metallicFactor=metallic, roughnessFactor=rough))
        scene.add_geometry(m, node_name=f'{name}_{i}')
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f'{name}.glb'
    scene.export(p, include_normals=True)
    return p, faces
