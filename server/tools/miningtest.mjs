// Focused skill-level-one mining contract near a real, runtime-prepared vein.
// Saved combat level protects this mechanics fixture in the goblin mining camp;
// this is NOT a spawn-to-mine travel or fresh-character progression test.
import assert from 'node:assert/strict';
import { blackroot } from '../zones/blackroot.js';
import { prepareZone } from '../worldgen.js';
import { navBlocked, lineClear } from '../collision.js';
import { ORES, miningLevelFromXp } from '../mining.js';
import { runTest, sleep } from './test-fixture.mjs';
prepareZone(blackroot);
const copper = blackroot._scatter.filter(o => o.m === 'Copper_Ore_Vein')
  .sort((a,b)=>Math.hypot(a.x-blackroot.spawn.x,a.z-blackroot.spawn.z)-Math.hypot(b.x-blackroot.spawn.x,b.z-blackroot.spawn.z));
let start, vein;
for (const v of copper) {
  for (let k=0;k<16;k++) {
    const a=k*Math.PI/8, x=v.x+5*Math.sin(a), z=v.z+5*Math.cos(a);
    if (!navBlocked(blackroot,x,z) && lineClear(blackroot,x,z,v.x,v.z)) { start={x,z};vein=v;break; }
  }
  if (start) break;
}
assert.ok(start, 'a verified standable five-metre approach to a real copper vein');
await runTest(async f => {
  const s=f.state, mined=()=>s.events.filter(e=>e.kind==='mined'&&e.id===vein.i);
  assert.equal(s.skills.mining.level,1); assert.equal(s.skills.mining.pick,'Bronze Pickaxe');
  assert.ok(s.bag.items.includes('Bronze Pickaxe'));
  assert.ok(s.zone.scatter.some(o=>o.i===vein.i&&o.m==='Copper_Ore_Vein'));
  const ids=s.zone.scatter.map(o=>o.i); assert.equal(new Set(ids).size,ids.length);
  const xp=s.skills.mining.xp, count=s.bag.items.filter(n=>n==='Copper Ore').length;
  console.log(`Mining at real vein ${vein.i} from verified nearby fixture ${JSON.stringify(start)}; long-distance travel excluded`);
  f.send({t:'mine',id:vein.i});
  await f.wait('five-metre approach and first mining swing',()=>s.events.some(e=>e.kind==='mineswing'&&e.id===vein.i),30000);
  await f.wait('full multi-ore copper yield and depletion',()=>s.snapshot.depleted.includes(vein.i),180000);
  const yielded=mined().length;
  assert.ok(yielded>=ORES.Copper.yield[0]&&yielded<=ORES.Copper.yield[1],`yield ${yielded} within current ore definition`);
  assert.equal(s.bag.items.filter(n=>n==='Copper Ore').length,count+yielded);
  assert.equal(s.skills.mining.xp,xp+yielded*ORES.Copper.xp);
  f.send({t:'mine',id:vein.i}); await sleep(500); assert.equal(mined().length,yielded,'depleted vein rejects additional mining');
  await f.wait('depleted vein respawns',()=>!s.snapshot.depleted.includes(vein.i),45000);
  const iron=s.zone.scatter.find(o=>o.m==='Iron_Ore_Vein'); assert.ok(iron);
  f.send({t:'mine',id:iron.i});
  await f.wait('iron level gate',()=>s.events.some(e=>e.kind==='notice'&&/Mining level/.test(e.text)));
  const far=copper.find(v=>Math.hypot(v.x-s.me.x,v.z-s.me.z)>25); assert.ok(far);
  const before=s.events.filter(e=>e.kind==='mined').length;
  f.send({t:'mine',id:far.i}); await sleep(600);
  assert.equal(s.events.filter(e=>e.kind==='mined').length,before,'no instant remote mining');
  assert.equal(miningLevelFromXp(s.skills.mining.xp).level,s.skills.mining.level);
  console.log('E2E telemetry:',JSON.stringify(f.telemetry()));
}, {prefix:'Miner',save:{...start,level:20,inventory:['Bronze Pickaxe','Fishing Rod']},timeout:300000});
