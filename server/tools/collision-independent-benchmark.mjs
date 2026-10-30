// Actual baseline/current collision functions, identical zones, ordering and inputs.
// Run: node tools/collision-independent-benchmark.mjs [samples=1500] [rounds=5]
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as current from '../collision.js';
import * as original from '../test/fixtures/collision-linear-oracle.js';
import { prepareZone, caveOutline, mulberry32 } from '../worldgen.js';
import { blackroot } from '../zones/blackroot.js';
import { spiderden } from '../zones/spiderden.js';
const count=Number(process.argv[2]||1500),rounds=Number(process.argv[3]||5),rng=mulberry32(7853);
const median = a => a.slice().sort((a,b)=>a-b)[Math.floor(a.length/2)];
for(const source of [blackroot,spiderden]) {
 const zone=structuredClone(source);
 if(zone.cavern && !zone.boundary) zone.boundary=caveOutline(zone.cavern,zone.bounds);
 prepareZone(zone);
 const b=zone.bounds;
 const inputs=Array.from({length:count},(_,i)=>({x:b.minX+rng()*(b.maxX-b.minX),z:b.minZ+rng()*(b.maxZ-b.minZ),canSwim:!!(i%2),y:0}));
 const cold=[],warm=[];
 for(let i=0;i<11;i++){current.invalidateCollisionScenery(zone);let e={...inputs[0]};let t=performance.now();current.resolveCollision(zone,e,0.55);cold.push(performance.now()-t);e={...inputs[0]};t=performance.now();current.resolveCollision(zone,e,0.55);warm.push(performance.now()-t);}
 console.log(JSON.stringify({zone:zone.id,kind:'index build plus first query vs warm single query',rounds:11,coldMedianMs:+median(cold).toFixed(3),warmMedianMs:+median(warm).toFixed(3)}));
 for(const kind of ['resolveCollision','navBlocked','lineClear']) {
  const run = fn => {let sum=0; const start=performance.now();for(const input of inputs) {
   if(kind==='resolveCollision'){const e={...input};fn(zone,e,0.55);sum+=e.x+e.z;}
   else if(kind==='navBlocked')sum+=Number(fn(zone,input.x,input.z,0.495,input.canSwim));
   else sum+=Number(fn(zone,input.x,input.z,input.x+1,input.z+1,0.495));
  }return {ms:performance.now()-start,sum};};
  assert.equal(run(original[kind]).sum,run(current[kind]).sum);
  const old=[],now=[];
  for(let i=0;i<rounds;i++){const pair=i%2?[current,original]:[original,current];for(const impl of pair){const result=run(impl[kind]);(impl===original?old:now).push(result.ms);}}
  const a=median(old),c=median(now);
  console.log(JSON.stringify({zone:zone.id,trees:zone._trees.length,scatter:zone._scatter.length,kind,count,rounds,baselineMedianMs:+a.toFixed(3),optimizedMedianMs:+c.toFixed(3),speedup:+(a/c).toFixed(2),baselineMs:old.map(x=>+x.toFixed(3)),optimizedMs:now.map(x=>+x.toFixed(3))}));
 }
}
