"""Pull the river channels out of the blueprint.

The drawing's rivers are thin blue lines, broken wherever a bridge or a tree
canopy is drawn over them. Take the water mask, set the big blobs aside as
lakes, fit a centreline to each remaining fragment, then join fragments whose
ends meet and whose directions agree -- which puts the channels back together.
"""
from PIL import Image, ImageFilter
import numpy as np, math, json, os
IMG=os.path.join('tools','blueprints','dark_woods.webp')
X0,Y0,X1,Y1=300,18,1440,972
ZW=270.0
im=Image.open(IMG).convert('RGB')
hsv=np.asarray(im.filter(ImageFilter.GaussianBlur(2)).convert('HSV')).astype(np.float32)
hue,sat,val=hsv[...,0]*360/255,hsv[...,1]/255,hsv[...,2]/255
sheet=np.zeros(hue.shape,bool); sheet[Y0:Y1,X0:X1]=True
for (x0,y0,x1,y1) in [(0,0,302,1086),(0,0,1448,16),(0,972,1448,1086),(1266,816,1448,980),(513,996,907,1086),(1323,326,1448,427)]:
    sheet[y0:y1,x0:x1]=False
water=((hue>170)&(hue<235)&(sat>0.22)&(val<0.76))&sheet
land=sheet & ~((val>0.86)&(sat<0.12))
ys,xs=np.nonzero(land); px0,py0=xs.min(),ys.min(); S=ZW/(xs.max()-px0); ZH=(ys.max()-py0)*S
TZ=lambda x,y:(round(-ZW/2+(x-px0)*S,1), round(-ZH/2+(y-py0)*S,1))

H,W=water.shape; lab=np.zeros(water.shape,np.int32); n=0; comps={}
for sy in range(H):
    for sx in np.nonzero(water[sy]&(lab[sy]==0))[0]:
        if lab[sy,sx]: continue
        n+=1; st=[(sy,sx)]; lab[sy,sx]=n; cells=[]
        while st:
            y,x=st.pop(); cells.append((y,x))
            for dy,dx in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                ny,nx=y+dy,x+dx
                if 0<=ny<H and 0<=nx<W and water[ny,nx] and not lab[ny,nx]: lab[ny,nx]=n; st.append((ny,nx))
        comps[n]=cells

LAKE=5200            # a blob this big is a lake, not a channel
frags=[]
for k,cells in comps.items():
    if len(cells)<260 or len(cells)>=LAKE: continue
    a=np.array(cells,float)                                  # (y,x)
    c=a.mean(0); d=a-c
    cov=np.cov(d.T); ev,evec=np.linalg.eigh(cov)
    axis=evec[:,np.argmax(ev)]                               # principal direction
    t=d@axis
    if t.max()-t.min() < 26: continue                        # too stubby to be a channel
    # width across the axis, and a centreline sampled along it
    perp=d@np.array([-axis[1],axis[0]])
    half=float(np.percentile(np.abs(perp),85))
    order=np.argsort(t); pts=[]
    for f in np.linspace(0,1,max(3,int((t.max()-t.min())/26)+2)):
        lo=t.min()+(t.max()-t.min())*f
        sel=a[np.abs(t-lo)<13]
        if len(sel): pts.append(sel.mean(0))
    if len(pts)<2: continue
    frags.append({'pts':[TZ(p[1],p[0]) for p in pts], 'half':round(half*S,1),
                  'a':(pts[0][1],pts[0][0]), 'b':(pts[-1][1],pts[-1][0]), 'px':len(cells)})
print(f'{len(frags)} channel fragments (from {len(comps)} water components)')

# join fragments end to end where the ends meet and the directions agree
def ang(p,q): return math.atan2(q[1]-p[1], q[0]-p[0])
used=[False]*len(frags); chains=[]
for i,f in enumerate(frags):
    if used[i]: continue
    used[i]=True; chain=[i]; 
    for _ in range(8):
        tail=frags[chain[-1]]; best=None; bd=70
        for j,g in enumerate(frags):
            if used[j]: continue
            for ga,gb in ((g['a'],g['b']),(g['b'],g['a'])):
                d=math.hypot(ga[0]-tail['b'][0], ga[1]-tail['b'][1])
                if d>=bd: continue
                da=ang(tail['a'],tail['b']); db=ang(ga,gb)
                if abs(((da-db+math.pi)%(2*math.pi))-math.pi)>1.1: continue
                bd=d; best=(j, ga!=g['a'])
        if not best: break
        j,flip=best; used[j]=True
        if flip: frags[j]['pts']=frags[j]['pts'][::-1]; frags[j]['a'],frags[j]['b']=frags[j]['b'],frags[j]['a']
        chain.append(j)
    chains.append(chain)
rivers=[]
for ch in chains:
    pts=[]; halves=[]
    for i in ch: pts+= [p for p in frags[i]['pts'] if not pts or p!=pts[-1]]; halves.append(frags[i]['half'])
    if len(pts)<3: continue
    span=math.hypot(pts[-1][0]-pts[0][0], pts[-1][1]-pts[0][1])
    if span < 22: continue
    rivers.append({'points':[{'x':p[0],'z':p[1]} for p in pts], 'width':round(max(5.0,2*sum(halves)/len(halves)),1)})
rivers.sort(key=lambda r:-len(r['points']))
json.dump(rivers, open('/tmp/rivers.json','w'))
print(f'{len(rivers)} channels reconstructed:')
for r in rivers: print(f"   {len(r['points']):2d} pts, width {r['width']:4.1f}")
