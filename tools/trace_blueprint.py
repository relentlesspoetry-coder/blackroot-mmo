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
IMG=os.path.join(os.path.dirname(__file__), 'blueprints', 'dark_woods.webp')
X0,Y0,X1,Y1=300,18,1440,972
PANELS=[(0,0,302,1086),(0,0,1448,16),(0,972,1448,1086),(1266,816,1448,980),(513,996,907,1086),(1323,326,1448,427)]
ZW=270.0; CELL=2.5

im=Image.open(IMG).convert('RGB')
hsv=np.asarray(im.filter(ImageFilter.GaussianBlur(5)).convert('HSV')).astype(np.float32)
hue,sat,val=hsv[...,0]*360/255,hsv[...,1]/255,hsv[...,2]/255
sheet=np.zeros(hue.shape,bool); sheet[Y0:Y1,X0:X1]=True
for (x0,y0,x1,y1) in PANELS: sheet[y0:y1,x0:x1]=False
def box(src,r):
    p=np.pad(src.astype(np.float32),r,mode='edge'); c=np.cumsum(np.cumsum(p,0),1); c=np.pad(c,((1,0),(1,0)))
    return (c[2*r+1:,2*r+1:]-c[:-2*r-1,2*r+1:]-c[2*r+1:,:-2*r-1]+c[:-2*r-1,:-2*r-1])/((2*r+1)**2)
def clean(m,er,cl): return ((box((box(m,er)>0.60),cl)>0.32)) & sheet

land  = clean(sheet & ~((val>0.86)&(sat<0.12)), 3, 11)
water = clean(land&(hue>170)&(hue<235)&(sat>0.25)&(val<0.74), 2, 4)
marsh = clean(land&(hue>168)&(hue<232)&(sat>0.08)&(val>=0.50)&~water, 2, 5)
rest  = land&~water&~marsh
rock  = clean(rest&(sat<0.12)&(val>0.40)&(val<0.84), 3, 6) & rest
# The drawing renders buildings and ruins in grey too -- the chapel, the camp
# halls, the Crow Hill tower. They classify as stone but they are not cliffs,
# so drop every rock blob too small to be a rock wall.
def drop_small(mask, minpx):
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
            if len(cells)>=minpx:
                for (y,x) in cells: keep[y,x]=True
    return keep
rock = drop_small(rock, 2600)
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
        if land[y0:y1,x0:x1].mean()<0.45: row+=' '; continue
        fr={'W':water[y0:y1,x0:x1].mean(),'w':marsh[y0:y1,x0:x1].mean(),'R':rock[y0:y1,x0:x1].mean()}
        best=max(fr,key=fr.get)
        if fr[best]>0.42: row+=best; continue
        fd=forest[y0:y1,x0:x1].mean()
        row += 'F' if fd>0.55 else ('f' if fd>0.20 else '.')
    rows.append(row)
cnt={c:sum(r.count(c) for r in rows) for c in ' WwRFf.'}
print(f'grid {gw} x {gh} cells of {CELL} units -> zone {ZW:.0f} x {ZH:.0f}')
print('cells:', {k:v for k,v in cnt.items()})
json.dump({'cell':CELL,'w':gw,'h':gh,'minX':minX,'minZ':round(minZ,1),'rows':rows}, open('/tmp/grid.json','w'))
for gy in range(0,gh,3): print('  '+''.join(rows[gy][gx] for gx in range(0,gw,2)))
