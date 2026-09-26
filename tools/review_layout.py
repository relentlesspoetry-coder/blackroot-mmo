#!/usr/bin/env python3
"""Render the BUILT Dark Woods top-down, in the blueprint's own palette.

The point is comparison, not prettiness: put this next to
tools/blueprints/dark_woods.webp and the differences between what was drawn and
what got built are visible rather than argued about. Everything here is read
back out of server/zones/darkwoods.js -- the shipped zone, not the trace it came
from -- so what you see is what the game actually loads.

Run:  python3 tools/review_layout.py
Writes tools/darkwoods.built.png
"""
import json
import math
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'tools' / 'darkwoods.built.png'
PX_PER_UNIT = 1.45

# The drawing's own colours, near enough to read side by side.
PAPER = (240, 233, 214)
OPEN = (170, 186, 122)
WOOD = (104, 134, 78)
DENSE = (54, 84, 50)
WATER = (104, 166, 212)
MARSH = (132, 182, 190)
ROCK = (152, 152, 149)
ROAD = (139, 104, 60)
TRAIL = (188, 92, 70)
RIVER = (74, 142, 196)
POI = (196, 62, 48)
DECK = (150, 116, 72)
RUIN = (110, 108, 102)


def load_zone():
    """Pull the zone out of the ES module by asking node for JSON."""
    js = ("import('./server/zones/darkwoods.js').then(m=>"
          "process.stdout.write(JSON.stringify(m.darkwoods)))")
    r = subprocess.run(['node', '-e', js], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr[:500])
    return json.loads(r.stdout)


def main():
    z = load_zone()
    T = z['terrain']
    b = z['bounds']
    W = int((b['maxX'] - b['minX']) * PX_PER_UNIT)
    H = int((b['maxZ'] - b['minZ']) * PX_PER_UNIT)

    def px(x, zz):
        return ((x - b['minX']) * PX_PER_UNIT, (zz - b['minZ']) * PX_PER_UNIT)

    im = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(im)

    # --- the ground, cell by cell ----------------------------------------
    fill = {' ': PAPER, '.': OPEN, 'f': WOOD, 'F': DENSE,
            'W': WATER, 'w': MARSH, 'R': ROCK}
    cw = T['cell'] * PX_PER_UNIT
    for gz, row in enumerate(T['rows']):
        y0 = (T['minZ'] + gz * T['cell'] - b['minZ']) * PX_PER_UNIT
        for gx, c in enumerate(row):
            if c == ' ':
                continue
            x0 = (T['minX'] + gx * T['cell'] - b['minX']) * PX_PER_UNIT
            d.rectangle([x0, y0, x0 + cw + 1, y0 + cw + 1], fill=fill.get(c, OPEN))

    # --- rivers ------------------------------------------------------------
    for r in z.get('rivers', []):
        pts = [px(p['x'], p['z']) for p in r['points']]
        d.line(pts, fill=RIVER, width=max(2, int(r['width'] * PX_PER_UNIT * 0.8)), joint='curve')
        for br in r.get('bridges', []):
            bx, bz = px(br['x'], br['z'])
            d.rectangle([bx - 7, bz - 4, bx + 7, bz + 4], fill=(120, 86, 52), outline=(70, 50, 30))

    # --- the boardwalks ----------------------------------------------------
    for dk in z.get('decks', []):
        x, y = px(dk['x'], dk['z'])
        d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=DECK)

    # --- roads and trails --------------------------------------------------
    for p in z.get('paths', []):
        pts = [px(q['x'], q['z']) for q in p['points']]
        if p.get('kind') == 'trail':
            # dashed, like the drawing's minor paths
            for i in range(len(pts) - 1):
                (ax, ay), (bx, by) = pts[i], pts[i + 1]
                seg = math.hypot(bx - ax, by - ay)
                n = max(1, int(seg / 9))
                for k in range(n):
                    if k % 2:
                        continue
                    t0, t1 = k / n, min(1.0, (k + 0.6) / n)
                    d.line([(ax + (bx - ax) * t0, ay + (by - ay) * t0),
                            (ax + (bx - ax) * t1, ay + (by - ay) * t1)], fill=TRAIL, width=2)
        else:
            d.line(pts, fill=ROAD, width=5, joint='curve')

    # --- structures and landmarks -----------------------------------------
    for s in z.get('structures', []):
        x, y = px(s['x'], s['z'])
        d.rectangle([x - 9, y - 9, x + 9, y + 9], fill=RUIN, outline=(40, 40, 40))

    for p in z.get('pois', []):
        x, y = px(p['x'], p['z'])
        exit_ = p.get('kind') == 'exit'
        r = 5 if exit_ else 8
        col = (60, 90, 170) if exit_ else POI
        d.polygon([(x, y - r), (x + r, y), (x, y + r), (x - r, y)], fill=col, outline=(30, 30, 30))
        d.text((x + r + 3, y - 6), p['name'], fill=(30, 30, 30))

    im.save(OUT)
    print(f'wrote {OUT.relative_to(ROOT)}  {W}x{H}')
    print(f'  zone {b["maxX"]-b["minX"]:.0f} x {b["maxZ"]-b["minZ"]:.0f} units at {PX_PER_UNIT} px/unit')
    counts = {}
    for row in T['rows']:
        for c in row:
            counts[c] = counts.get(c, 0) + 1
    tot = sum(v for k, v in counts.items() if k != ' ')
    print('  ground: ' + '  '.join(
        f'{k}={v * 100 // tot}%' for k, v in sorted(counts.items(), key=lambda kv: -kv[1]) if k != ' '))


if __name__ == '__main__':
    main()
