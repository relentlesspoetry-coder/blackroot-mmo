import test from 'node:test';
import assert from 'node:assert/strict';
import * as current from '../collision.js';
import * as original from './fixtures/collision-linear-oracle.js';
import { prepareZone, caveOutline, mulberry32 } from '../worldgen.js';
import { blackroot } from '../zones/blackroot.js';
import { spiderden } from '../zones/spiderden.js';

const random = mulberry32(0x1de9);
const between = (a,b) => a + (b-a)*random();
const empty = () => ({bounds:{minX:-10000,maxX:10000,minZ:-10000,maxZ:10000}});
let comparisons = 0;
function parity(zone, input, radius = 0.55, label = '') {
  const expected = {...input}, actual = {...input};
  original.resolveCollision(zone, expected, radius);
  current.resolveCollision(zone, actual, radius);
  comparisons++;
  assert.deepEqual(actual, expected, `${label}; input=${JSON.stringify(input)} radius=${radius}`);
}

export const prepared = [structuredClone(blackroot), structuredClone(spiderden)];
for (const zone of prepared) {
  if(zone.cavern && !zone.boundary) zone.boundary=caveOutline(zone.cavern,zone.bounds);
  prepareZone(zone);
}

test('independent oracle: real zones, object centers/tangencies, boundaries and all entity radii', () => {
  for (const zone of prepared) {
    const b=zone.bounds;
    for(let i=0;i<1600;i++) parity(zone,{x:between(b.minX-1,b.maxX+1),z:between(b.minZ-1,b.maxZ+1),y:i%4,canSwim:!!(i%2)},[0,0.1,0.495,0.55,1,3,20][i%7],zone.id);
    for(const list of [zone._trees,zone._scatter]) for(let i=0;i<list.length;i+=Math.max(1,Math.floor(list.length/200))) {
      const o=list[i];
      for(const offset of [0,0.00001,0.0001,0.1,0.55,2,8]) parity(zone,{x:o.x+offset,z:o.z,y:0,canSwim:true},0.55,`${zone.id} object ${i}`);
    }
    for(let i=0;i<80;i++) {
      const x=between(b.minX,b.maxX),z=between(b.minZ,b.maxZ);
      assert.equal(current.navBlocked(zone,x,z,0.495,!!(i%2)),original.navBlocked(zone,x,z,0.495,!!(i%2)));
      const bx=x+between(-5,5),bz=z+2;
      assert.equal(current.lineClear(zone,x,z,bx,bz),original.lineClear(zone,x,z,bx,bz));
    }
  }
});

test('independent oracle: ordered cascades, mixed blockers, cell edges and overlapping randomized objects', () => {
  for(let scene=0;scene<80;scene++) {
    const zone=empty();
    zone._trees=Array.from({length:180},()=>({x:between(-40,40),z:between(-40,40),s:between(0.1,9)}));
    zone._scatter=Array.from({length:180},(_,i)=>({x:between(-40,40),z:between(-40,40),c:i%7?between(0.1,5):0,s:between(0.1,6)}));
    zone.rocks=[{x:0,z:0,r:4}];
    zone._editObjects=[{m:'prim:box',c:1,x:6,z:0,s:2,w:4,h:5,d:8,yaw:0.8}];
    zone._walls=[{x1:-4,z1:-20,x2:-4,z2:20,r:0.4,gap:3}];
    for(let i=0;i<150;i++) parity(zone,{x:between(-60,60),z:between(-60,60),y:i%5},[0,0.55,2,10,40][i%5],`random scene ${scene}`);
  }
  for(const field of ['_trees','_scatter']) {
    const zone=empty();
    zone[field]=Array.from({length:100},(_,i)=>({x:i*3-1,z:0,s:4,c:1}));
    for(const x of [-32,-16,-8,-1,0,8,16,32]) for(const eps of [-1e-8,0,1e-8]) parity(zone,{x:x+eps,z:0.1},2,field+' cascade');
    zone[field].reverse(); // Fresh identity because the public contract treats generated lists as static.
    zone[field]=zone[field].slice();
    parity(zone,{x:0,z:0.1},2,field+' reversed cascade');
  }
});

test('independent oracle: deterministic 400-tick movement replay across each real zone', () => {
  for(const zone of prepared) {
    let a={x:zone.spawn.x,z:zone.spawn.z,canSwim:true},b={...a};
    for(let tick=0;tick<400;tick++) {
      const dx=Math.sin(tick*0.071)*0.35,dz=Math.cos(tick*0.043)*0.35;
      a.x+=dx;a.z+=dz;b.x+=dx;b.z+=dz;
      original.resolveCollision(zone,a,0.55);current.resolveCollision(zone,b,0.55);
      assert.deepEqual(b,a,`${zone.id} replay tick ${tick}`);
    }
  }
});

test.after(()=>console.log(`Independent collision oracle comparisons: ${comparisons}; plus 800 movement ticks and 320 nav/line checks`));

test('independent oracle: cache identity/length rebuild, explicit in-place invalidation and uncached live editor changes', () => {
 const zone=empty();zone._trees=[{x:100,z:100,s:1}];zone._scatter=[{x:-100,z:-100,c:2,s:1}];
 const check=label=>{for(const x of [0.1,1,15.99999999,16,16.00000001,101])parity(zone,{x,z:0.1,y:0},0.55,label);};
 check('warm');
 zone._trees.push({x:0,z:0,s:4});zone._scatter.push({x:16,z:0,s:2,c:3});check('append');
 zone._trees.pop();zone._scatter.splice(0,1);check('remove');
 zone._trees=[{x:16,z:0,s:4}];zone._scatter=[{x:0,z:0,s:2,c:3}];check('replace same length');
 zone._trees[0].x=0;zone._trees[0].s=8;zone._scatter[0].x=16;zone._scatter[0].c=8;
 current.invalidateCollisionScenery(zone);check('mutate position scale solidity');
 zone._scatter.push({x:0,z:0,s:4,c:3});check('warm reorder');zone._scatter.reverse();current.invalidateCollisionScenery(zone);check('reorder');
 zone._editObjects=[];check('warm editor');zone._editObjects.push({x:1,z:0,c:5,s:1});check('place editor');
 Object.assign(zone._editObjects[0],{x:16,m:'prim:box',w:10,h:4,d:10,yaw:1});check('update editor');
 zone._editObjects.splice(0,1);check('delete editor');
});

test('independent oracle: odd scales, huge scenery overflow and exotic entity radius fallback', () => {
 for(const field of ['_trees','_scatter'])for(const scale of [undefined,0,-2,0.000001,10000,Infinity,NaN]) {
  const zone=empty();zone[field]=[{x:0,z:0,s:scale,c:2},{x:16,z:16,s:1,c:3}];
  for(const radius of [-1,0,0.55,10000,Infinity,NaN])parity(zone,{x:0.1,z:0.1},radius,field+' exotic');
 }
});

test('independent oracle: coercible object coordinates and radius retain baseline narrow-phase behavior', () => {
 for(const field of ['_trees','_scatter'])for(const coordinate of ['0','16',null,NaN,Infinity]) {
  const zone=empty();zone[field]=[{x:coordinate,z:0,s:1,c:2}];
  for(const radius of [0.55,'0.55',null])parity(zone,{x:0.1,z:0.1},radius,field+' coercion');
 }
});
