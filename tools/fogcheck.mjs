// Check the fog of war and what counts as discovered. Run: node tools/fogcheck.mjs
//
// The fog is the one piece of world state that is per player and invisible to
// every other checker: zonecheck reads the world, walkcheck reads the ground,
// and neither can tell you whether the map you are shown matches the ground you
// walked. These are the invariants that would make it lie -- a region no
// containment rule can name, a grid that does not survive being saved, a sight
// radius that clears the world in one walk.

import { blackroot } from '../server/zones/blackroot.js';
import { spiderden } from '../server/zones/spiderden.js';
import { fogDims, newFog, revealDisc, sightOf, regionAt, fogToB64, fogFromB64, fogBytes, fogCellOf, fogHas } from '../shared/fog.js';

let fail = 0;
const ok = (name, cond, detail='') => { console.log(`  ${cond?'PASS':'FAIL'}  ${name}${detail?'  — '+detail:''}`); if(!cond) fail++; };

// 1. every region is reachable by the containment rule, and the two do not claim the same ground
const seen = new Set();
for (const r of blackroot.regions) {
  const cx = (r.bounds.minX+r.bounds.maxX)/2, cz = (r.bounds.minZ+r.bounds.maxZ)/2;
  const got = regionAt(blackroot, cx, cz, 0);
  if (got) seen.add(got.id);
  ok(`the centre of ${r.id} is in ${r.id}`, got && got.id === r.id, got ? got.id : 'null');
}
ok('both regions are reachable', seen.size === blackroot.regions.length, [...seen].join(', '));
ok('a regionless zone has no region', regionAt(spiderden, 0, 0, 0) === null);

// 2. walking the spawn -> killing fields line discovers the second region
const kf = blackroot.regions.find(r=>r.id==='killingfields');
const d = fogDims(blackroot), bits = newFog(d);
const visited = new Set();
let x = blackroot.spawn.x, z = blackroot.spawn.z;
const tx = (kf.bounds.minX+kf.bounds.maxX)/2, tz = (kf.bounds.minZ+kf.bounds.maxZ)/2;
const steps = 900;
for (let i=0;i<=steps;i++){
  const px = x + (tx-x)*0, pz = z + (tz-z)*0;
  const cx2 = x + (tx-x)*(i/steps), cz2 = z + (tz-z)*(i/steps);
  revealDisc(d, bits, cx2, cz2, sightOf(blackroot));
  const r = regionAt(blackroot, cx2, cz2, 0); if (r) visited.add(r.id);
}
ok('walking east discovers the Killing Fields', visited.has('killingfields') && visited.has('darkwoods'), [...visited].join(', '));

// 3. the walk reveals a corridor, not the whole map
let set=0; for (let i=0;i<d.w*d.h;i++) if (fogHas(bits,i)) set++;
const pct = set/(d.w*d.h)*100;
ok('one crossing reveals a corridor, not the world', pct > 1 && pct < 35, `${set} of ${d.w*d.h} cells (${pct.toFixed(1)}%)`);

// 4. somewhere far off the line is still dark
const far = fogCellOf(d, blackroot.bounds.minX+20, blackroot.bounds.maxZ-20);
ok('ground nowhere near the walk stays hidden', !fogHas(bits, far));

// 5. round trip through base64 keeps every bit
const rt = fogFromB64(fogToB64(bits), fogBytes(d));
let same = true; for (let i=0;i<bits.length;i++) if (bits[i]!==rt[i]) same=false;
ok('a saved and reloaded map is the same map', same);

// 6. the den keeps its own grid, at its own sight range
const dd = fogDims(spiderden), db = newFog(dd);
revealDisc(dd, db, spiderden.spawn.x, spiderden.spawn.z, sightOf(spiderden));
let dset=0; for (let i=0;i<dd.w*dd.h;i++) if (fogHas(db,i)) dset++;
ok('the den reveals at torchlight range, not woodland range',
   sightOf(spiderden) < sightOf(blackroot) && dset > 0 && dset < 40,
   `${sightOf(spiderden)}m, ${dset} cells vs the woods' ${sightOf(blackroot)}m`);

console.log(fail ? `\n${fail} FAILED\n` : '\nfog holds\n');
process.exit(fail?1:0);
