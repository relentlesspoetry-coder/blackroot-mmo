#!/usr/bin/env python3
"""Generate the game's surface detail textures.

Every surface in Blackroot is flat/vertex coloured; these tiles add grain on
top. Each is a seamless 256x256 greyscale tile centred on mid-grey (the
shader multiplies the surface colour by 2*value, so 0.5 leaves the colour
alone), packed into one 4x4 atlas the client samples triplanar in world space
so nothing needs UVs. Tile order (index = row*4 + col) is TILES below and is
mirrored by DETAIL_TILES in client/index.html.

Run:  python3 tools/build_textures.py   (numpy + Pillow)
Writes client/textures/detail_atlas.png and the individual tiles.
"""
import math
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'client' / 'textures'
S = 256

# ---------------------------------------------------------------- seamless noise
def _lattice(n, rng):
    return rng.random((n, n))

def value_noise(size, cells, rng, smooth=True):
    """Tileable value noise: a cells x cells random lattice, bilinearly (smooth-
    stepped) interpolated, wrapping at the edges."""
    lat = _lattice(cells, rng)
    y, x = np.mgrid[0:size, 0:size] * (cells / size)
    x0 = np.floor(x).astype(int) % cells; y0 = np.floor(y).astype(int) % cells
    x1 = (x0 + 1) % cells; y1 = (y0 + 1) % cells
    fx = x - np.floor(x); fy = y - np.floor(y)
    if smooth: fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    a = lat[y0, x0]; b = lat[y0, x1]; c = lat[y1, x0]; d = lat[y1, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def fbm(size, base_cells, octaves, rng, gain=0.5, lacunarity=2):
    out = np.zeros((size, size)); amp = 1; total = 0; cells = base_cells
    for _ in range(octaves):
        out += value_noise(size, int(cells), rng) * amp; total += amp
        amp *= gain; cells *= lacunarity
    return out / total

def worley(size, points, rng, wrap=True):
    """Distance to the nearest of `points` random feature points (tiling)."""
    pts = rng.random((points, 2)) * size
    y, x = np.mgrid[0:size, 0:size].astype(float)
    best = np.full((size, size), 1e9); second = np.full((size, size), 1e9); nearest = np.zeros((size, size), int)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(x - px); dy = np.abs(y - py)
        if wrap: dx = np.minimum(dx, size - dx); dy = np.minimum(dy, size - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < best
        second = np.where(closer, best, np.minimum(second, d)); nearest = np.where(closer, i, nearest); best = np.where(closer, d, best)
    return best, second, nearest

def norm(a, lo=0.0, hi=1.0):
    a = (a - a.min()) / (a.max() - a.min() + 1e-9)
    return lo + a * (hi - lo)

def centre(a, contrast):
    """Map to mid-grey +- contrast/2 so the overlay only modulates colour."""
    return 0.5 + (norm(a) - 0.5) * contrast

def stripes(size, count, wobble, rng, axis=0):
    """Tileable grain lines along one axis, wobbled by low-frequency noise."""
    y, x = np.mgrid[0:size, 0:size].astype(float)
    t = (y if axis == 0 else x) / size
    w = value_noise(size, 4, rng) * wobble
    return 0.5 + 0.5 * np.sin((t + w) * count * 2 * math.pi)

# ---------------------------------------------------------------- the tiles
def t_grass(rng):
    """Turf as clumps, not cloth.

    The old tile crossed two sets of straight stripes, which at ground level
    read as woven fabric. This builds it the way turf actually looks: worley
    cells for the tufts, each clump given its own tone so the sward is patchy,
    a heavily wobbled fine grain for the blades themselves (wavy, never a
    grid), speckle for what you see underfoot and a couple of broad octaves
    that still read from across a field.
    """
    d1, _d2, idx = worley(S, 44, rng)
    tuft = 1.0 - norm(d1)                                  # bright at each tuft's crown
    tone = rng.random(44)[idx] * 0.55                      # every clump its own value
    blades = stripes(S, 165, 0.30, rng, axis=1) * 0.16     # wavy blade grain
    blades += stripes(S, 140, 0.34, rng, axis=0) * 0.07    # a hint the other way, far weaker than the old crosshatch
    speck = value_noise(S, 110, rng, smooth=False) * 0.20
    broad = fbm(S, 5, 3, rng) * 0.60
    return centre(tuft * 0.80 + tone + blades + speck + broad, 0.66)
def t_dirt(rng):
    d1, d2, _ = worley(S, 40, rng); clods = norm(d1) * 0.5; cracks = np.clip((d2 - d1) / 9, 0, 1) * 0.6
    return centre(fbm(S, 6, 4, rng) * 0.9 + clods * 0.6 + cracks + value_noise(S, 64, rng, smooth=False) * 0.3, 0.9)
def t_rock(rng):
    d1, d2, _ = worley(S, 26, rng); cracks = np.clip((d2 - d1) / 12, 0, 1)
    return centre(fbm(S, 8, 4, rng) * 0.7 + cracks * 0.9 + fbm(S, 40, 2, rng) * 0.2, 0.76)
def t_stone(rng):
    d1, d2, idx = worley(S, 14, rng); mortar = np.clip((d2 - d1) / 6, 0, 1)
    tone = rng.random(14)[idx] * 0.3
    return centre(mortar * 0.9 + tone + fbm(S, 24, 2, rng) * 0.25, 0.72)
def t_wood(rng):
    y, x = np.mgrid[0:S, 0:S].astype(float)
    rings = 0.5 + 0.5 * np.sin((x / S + value_noise(S, 3, rng) * 0.35) * 14 * 2 * math.pi)
    grain = stripes(S, 90, 0.03, rng, axis=1)
    return centre(rings * 0.6 + grain * 0.35 + fbm(S, 16, 2, rng) * 0.3, 0.61)
def t_bark(rng):
    ridges = stripes(S, 22, 0.12, rng, axis=1); d1, _, _ = worley(S, 40, rng)
    return centre(ridges * 0.7 + norm(d1) * 0.4 + fbm(S, 10, 3, rng) * 0.5, 0.83)
def t_leaf(rng):
    d1, d2, _ = worley(S, 60, rng); veins = np.clip((d2 - d1) / 5, 0, 1)
    return centre(veins * 0.6 + fbm(S, 12, 3, rng) * 0.6 + value_noise(S, 48, rng) * 0.3, 0.58)
def t_hay(rng):
    a = stripes(S, 70, 0.25, rng, axis=1); b = stripes(S, 60, 0.3, rng, axis=0)
    return centre(np.maximum(a, b * 0.8) * 0.8 + fbm(S, 20, 2, rng) * 0.4, 0.72)
def t_skin(rng):
    pores = value_noise(S, 96, rng, smooth=False)
    return centre(fbm(S, 6, 3, rng) * 0.7 + pores * 0.25, 0.25)
def t_cloth(rng):
    weave = (stripes(S, 64, 0.0, rng, axis=0) * stripes(S, 64, 0.0, rng, axis=1))
    return centre(weave * 0.6 + fbm(S, 8, 2, rng) * 0.4, 0.36)
def t_leather(rng):
    d1, d2, _ = worley(S, 120, rng); grain = np.clip((d2 - d1) / 4, 0, 1)
    return centre(grain * 0.5 + fbm(S, 10, 3, rng) * 0.6, 0.47)
def t_metal(rng):
    brushed = stripes(S, 120, 0.02, rng, axis=0) * 0.5; dents = fbm(S, 5, 3, rng)
    return centre(brushed + dents * 0.6 + value_noise(S, 128, rng, smooth=False) * 0.15, 0.43)
def t_water(rng):
    d1, d2, _ = worley(S, 30, rng); caustic = np.clip((d2 - d1) / 10, 0, 1) ** 2
    return centre(caustic * 0.8 + fbm(S, 8, 3, rng) * 0.5, 0.65)
def t_sand(rng):
    return centre(value_noise(S, 128, rng, smooth=False) * 0.4 + fbm(S, 10, 3, rng) * 0.6, 0.4)
def t_fur(rng):
    return centre(stripes(S, 80, 0.4, rng, axis=0) * 0.6 + fbm(S, 12, 3, rng) * 0.5, 0.54)
def t_bone(rng):
    return centre(fbm(S, 6, 3, rng) * 0.7 + stripes(S, 30, 0.2, rng, axis=1) * 0.15 + value_noise(S, 96, rng) * 0.15, 0.29)

TILES = ['grass', 'dirt', 'rock', 'stone', 'wood', 'bark', 'leaf', 'hay', 'skin', 'cloth', 'leather', 'metal', 'water', 'sand', 'fur', 'bone']
MAKERS = { 'grass': t_grass, 'dirt': t_dirt, 'rock': t_rock, 'stone': t_stone, 'wood': t_wood, 'bark': t_bark, 'leaf': t_leaf, 'hay': t_hay,
           'skin': t_skin, 'cloth': t_cloth, 'leather': t_leather, 'metal': t_metal, 'water': t_water, 'sand': t_sand, 'fur': t_fur, 'bone': t_bone }

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    atlas = np.full((S * 4, S * 4), 0.5)
    for i, name in enumerate(TILES):
        rng = np.random.default_rng(1000 + i)
        tile = np.clip(MAKERS[name](rng), 0, 1)
        r, c = divmod(i, 4)
        atlas[r * S:(r + 1) * S, c * S:(c + 1) * S] = tile
        Image.fromarray((tile * 255).astype(np.uint8), 'L').save(OUT / f'{name}.png')
        print(f'{name:8s} mean {tile.mean():.3f} std {tile.std():.3f}')
    Image.fromarray((atlas * 255).astype(np.uint8), 'L').save(OUT / 'detail_atlas.png')
    print('atlas ->', OUT / 'detail_atlas.png')

if __name__ == '__main__':
    main()
