"""Trace the Dark Woods blueprint into the zone's terrain grid.

The drawing is the specification. This reads it rather than approximating it
by eye: classify every pixel by colour, blur into regions (the forest is drawn
as individual tree symbols, so raw pixels are speckle), and emit one character
per cell for server/zones/darkwoods.js `terrain`.

Needs numpy + pillow.  python3 tools/trace_blueprint.py
"""
"""Emit the blueprint as a terrain grid: one character per cell, straight off
the drawing. This is the zone's ground truth -- no eyeballed circles."""
from PIL import Image, ImageFilter
import numpy as np, math, json
import os
import sys
# One tracer, one set of rules, a profile per sheet. The alternative was a
# second copy of this file with four constants changed, which is how the terrain
# and the shoreline and the deck spans each came to have two implementations.
PROFILES = {
  'darkwoods': dict(
    img='dark_woods.webp', out='darkwoods',
    # The blueprint calls the zone 1.7 km x 1.3 km. Built at that size the
    # primary loop is a nine-minute walk and the forest runs to tens of
    # thousands of trunks, which the server's per-entity collision scan cannot
    # carry. Half the drawing keeps every proportion exactly.
    sheet=(300,18,1440,972), zw=850.0,
    panels=[(0,0,302,1086),(0,0,1448,16),(0,972,1448,1086),(1266,816,1448,980),
            (513,996,907,1086),(1323,326,1448,427)],
    # (px, py, radius) -- the chapel, the camp halls, the Crow Hill tower.
    # Drawn in the same grey as the cliffs, so excluded by WHERE they are.
    buildings=[(912,205,62),(870,495,78),(508,615,52)],
    # The Dark Woods draws its cliffs as MANY SMALL rock symbols, so the floor
    # that separates a cliff from a roof has to sit low; 2600 threw away a
    # quarter of the drawn stone, the whole Crow Hill massif among it.
    rockfloor=800, rocksat=0.12, rockval=(0.40,0.84),
  ),
  'killingfields': dict(
    img='killing_fields.png', out='killingfields',
    # A shade wider than the Dark Woods and shallower, which is what the sheet's
    # own proportions give: an open basin rather than a forest.
    sheet=(252,10,1530,945), zw=900.0,
    panels=[(0,0,252,1024),(0,0,1536,12),(0,938,1536,1024),(1392,880,1536,1024),
            (586,946,940,1024),(1230,890,1380,940),(1410,448,1536,536),
            (752,8,940,50),(248,696,392,744),
            # the title and its subtitle sit ON the sheet, and black serif
            # glyphs read as dense forest (val < 0.32) if they are left in
            (252,0,540,150),
            # ...and the twelve numbered landmark cards, which are cream boxes
            # with a grey rule round them sitting ON the map. The box interior
            # fills back in as land, but the rule reads as low-saturation stone
            # and put a cliff in the middle of the Killing Ground.
            (476,644,634,696),(501,371,659,419),(521,186,704,232),(516,471,676,516),
            (911,694,1069,739),(776,524,939,569),(891,294,1069,339),(1031,474,1219,519),
            (1186,754,1364,799),(781,824,979,869),(1186,144,1359,194),(1261,351,1424,402)],
    # The keep, the chapel, the quarry sheds and the watchtowers are drawn in
    # cliff grey like everything else built of stone.
    buildings=[(1330,400,70),(1300,720,60),(1100,180,70),(920,300,40),(560,640,60)],
    # This sheet draws its cliffs as long connected hachured bands along the
    # north and east rim, so the floor can sit high -- and it has to, because
    # the open ground is full of small grey things that are siege wrecks,
    # trench revetments and label boxes rather than rock. At 800 the battlefield
    # came out speckled with cliffs you could not walk through.
    # Measured off the sheet rather than guessed: the cliff bands sit at
    # saturation 0.12-0.15 while the open battlefield is 0.29, the crop fields
    # 0.35 and the woodland 0.34, so the line goes at 0.20. At the Dark Woods'
    # 0.12 the entire northern and eastern rim scored as open ground -- every
    # cliff on the sheet simply was not there.
    rockfloor=1500, rocksat=0.20, rockval=(0.40,0.78),
  ),
}
CELL=2.5
NAME = sys.argv[1] if len(sys.argv) > 1 else 'darkwoods'
P = PROFILES[NAME]
IMG=os.path.join(os.path.dirname(__file__), 'blueprints', P['img'])
X0,Y0,X1,Y1 = P['sheet']
PANELS = P['panels']
ZW = P['zw']

im=Image.open(IMG).convert('RGB')
hsv=np.asarray(im.filter(ImageFilter.GaussianBlur(5)).convert('HSV')).astype(np.float32)
hue,sat,val=hsv[...,0]*360/255,hsv[...,1]/255,hsv[...,2]/255
sheet=np.zeros(hue.shape,bool); sheet[Y0:Y1,X0:X1]=True
# Panels that sit ON the drawing -- the landmark cards, the title -- hide real
# terrain rather than sitting beside it. They are masked out of the
# classification either way, but the cells they cover are remembered so they can
# be filled from their surroundings instead of coming out as holes. Widow's Ford
# is a river crossing and its own label card put a gap in the river.
hidden=np.zeros(hue.shape,bool)
for (x0,y0,x1,y1) in PANELS:
    hidden[y0:y1,x0:x1]=True
    sheet[y0:y1,x0:x1]=False
def box(src,r):
    p=np.pad(src.astype(np.float32),r,mode='edge'); c=np.cumsum(np.cumsum(p,0),1); c=np.pad(c,((1,0),(1,0)))
    return (c[2*r+1:,2*r+1:]-c[:-2*r-1,2*r+1:]-c[2*r+1:,:-2*r-1]+c[:-2*r-1,:-2*r-1])/((2*r+1)**2)
def clean(m,er,cl): return ((box((box(m,er)>0.60),cl)>0.32)) & sheet

land  = clean(sheet & ~((val>0.86)&(sat<0.12)), 3, 11)
water = clean(land&(hue>170)&(hue<235)&(sat>0.25)&(val<0.74), 2, 4)
marsh = clean(land&(hue>168)&(hue<232)&(sat>0.08)&(val>=0.50)&~water, 2, 5)
rest  = land&~water&~marsh
rock  = clean(rest&(sat<P['rocksat'])&(val>P['rockval'][0])&(val<P['rockval'][1]), 3, 6) & rest
# The drawing renders buildings and ruins in grey too -- the chapel, the camp
# halls, the Crow Hill tower. They classify as stone but they are not cliffs,
# so drop every rock blob too small to be a rock wall.
# The drawing renders buildings in the same grey as cliffs, which is why this
# filter exists -- but it was set at 2600 px, and the drawing draws cliffs as
# MANY SMALL rock symbols rather than solid masses. Measured: 78 rock blobs, and
# a 2600 px floor threw away 66 of them, a quarter of all the drawn stone, with
# the largest casualty two pixels under the line. The whole Crow Hill massif
# went that way. So the floor drops to a size that only catches a roof, and the
# three actual buildings are excluded by WHERE they are instead.
BUILDING_SITES = P['buildings']
def drop_small(mask, minpx, sites=()):
    lab=np.zeros(mask.shape,np.int32); n=0; keep=np.zeros(mask.shape,bool)
    H,W=mask.shape
    for sy in range(H):
        for sx in range(W):
            if not mask[sy,sx] or lab[sy,sx]: continue
            n+=1; stack=[(sy,sx)]; lab[sy,sx]=n; cells=[(sy,sx)]
            while stack:
                y,x=stack.pop()
                for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                    ny,nx=y+dy,x+dx
                    if 0<=ny<H and 0<=nx<W and mask[ny,nx] and not lab[ny,nx]:
                        lab[ny,nx]=n; stack.append((ny,nx)); cells.append((ny,nx))
            if len(cells)<minpx: continue
            cy=sum(c[0] for c in cells)/len(cells); cx=sum(c[1] for c in cells)/len(cells)
            # a compact grey blob sitting on a known building is a roof, not a cliff
            if any((cx-sx)**2+(cy-sy)**2 < r*r for (sx,sy,r) in sites) and len(cells)<9000:
                continue
            for (y,x) in cells: keep[y,x]=True
    return keep
# Fill the holes the sheet's own labels punch in the land. The Killing Fields
# draws each landmark in a solid cream box sitting on the map, and a box of
# paper inside the boundary is not a hole in the world -- it is a label. Flood
# from outside the hull; whatever the flood cannot reach is interior.
def fill_holes(mask):
    H,W=mask.shape
    out=np.ones((H+2,W+2),bool); out[1:-1,1:-1]=~mask
    seen=np.zeros_like(out); stack=[(0,0)]; seen[0,0]=True
    while stack:
        y,x=stack.pop()
        for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
            ny,nx=y+dy,x+dx
            if 0<=ny<out.shape[0] and 0<=nx<out.shape[1] and out[ny,nx] and not seen[ny,nx]:
                seen[ny,nx]=True; stack.append((ny,nx))
    return mask | (~seen[1:-1,1:-1] & ~mask)
land = fill_holes(land)
rest = land&~water&~marsh
rock = clean(rest&(sat<P['rocksat'])&(val>P['rockval'][0])&(val<P['rockval'][1]), 3, 6) & rest
rock = drop_small(rock, P['rockfloor'], BUILDING_SITES)
green = rest&~rock
forest= green&(val<0.32)

ys,xs=np.nonzero(land); px0,px1,py0,py1=xs.min(),xs.max(),ys.min(),ys.max()
PW,PH=px1-px0,py1-py0; S=ZW/PW; ZH=PH*S
gw,gh=int(math.ceil(ZW/CELL)),int(math.ceil(ZH/CELL))
minX,minZ=-ZW/2,-ZH/2
# ' ' off-map  W deep water  w shallow marsh  R rock  F dense forest  f wood  . open
rows=[]
for gy in range(gh):
    row=''
    for gx in range(gw):
        cx=px0+int(((gx+0.5)*CELL)/S); cy=py0+int(((gy+0.5)*CELL)/S)
        r=max(1,int(CELL/S/2))
        x0,x1=max(0,cx-r),min(land.shape[1],cx+r+1); y0,y1=max(0,cy-r),min(land.shape[0],cy+r+1)
        if hidden[y0:y1,x0:x1].mean()>0.5 and land[y0:y1,x0:x1].mean()>=0.45: row+='?'; continue
        if land[y0:y1,x0:x1].mean()<0.45: row+=' '; continue
        fr={'W':water[y0:y1,x0:x1].mean(),'w':marsh[y0:y1,x0:x1].mean(),'R':rock[y0:y1,x0:x1].mean()}
        best=max(fr,key=fr.get)
        # Rock needs a lower bar than water. The drawing renders cliffs as many
        # small symbols, so a cell is rarely MOSTLY stone even where the map is
        # plainly a cliff face -- at a 0.42 majority the Crow Hill massif scored
        # zero. A third of a cell of drawn rock means there is rock there.
        if best=='R' and fr['R']>0.26: row+='R'; continue
        if fr[best]>0.42: row+=best; continue
        fd=forest[y0:y1,x0:x1].mean()
        row += 'F' if fd>0.55 else ('f' if fd>0.20 else '.')
    rows.append(row)
# Fill what the cards were covering with the majority of what is around it, a
# ring at a time. Nothing is invented: a card over the river gets river back
# because river is what is on every side of it.
grid=[list(r) for r in rows]
for _ in range(24):
    todo=[(y,x) for y in range(gh) for x in range(gw) if grid[y][x]=='?']
    if not todo: break
    upd=[]
    for (y,x) in todo:
        tally={}
        for dy in (-1,0,1):
            for dx in (-1,0,1):
                ny,nx=y+dy,x+dx
                if 0<=ny<gh and 0<=nx<gw:
                    c=grid[ny][nx]
                    if c not in '?': tally[c]=tally.get(c,0)+1
        if tally: upd.append((y,x,max(tally,key=tally.get)))
    if not upd: break
    for (y,x,c) in upd: grid[y][x]=c
rows=[''.join(r).replace('?','.') for r in grid]
cnt={c:sum(r.count(c) for r in rows) for c in ' WwRFf.'}
print(f'grid {gw} x {gh} cells of {CELL} units -> zone {ZW:.0f} x {ZH:.0f}')
print('cells:', {k:v for k,v in cnt.items()})
json.dump({'cell':CELL,'w':gw,'h':gh,'minX':minX,'minZ':round(minZ,1),'rows':rows,
           'px':{'x0':int(px0),'y0':int(py0),'x1':int(px1),'y1':int(py1),'unitsPerPx':S}},
          open(os.path.join(os.path.dirname(__file__), P['out']+'.terrain.json'),'w'))
print(f"wrote tools/{P['out']}.terrain.json")
PAL={' ':(247,240,224),'W':(46,110,168),'w':(120,170,200),'R':(130,130,130),
     'F':(28,80,38),'f':(92,142,72),'.':(206,198,150)}
prev=np.zeros((gh,gw,3),np.uint8)
for gy,r in enumerate(rows):
    for gx,c in enumerate(r): prev[gy,gx]=PAL[c]
Image.fromarray(prev).resize((gw*2,gh*2),Image.NEAREST).save(
    os.path.join(os.path.dirname(__file__), P['out']+'.trace.png'))
print(f"wrote tools/{P['out']}.trace.png")
