// Can you WALK there? — reachability with a body, at the runtime's own answer.
//
//   node tools/walkcheck.mjs [--step 1.25] [--pockets 12]
//
// Two earlier checks said this map was fine while a quest-giver stood behind a
// sealed ring of rock: the builder's own check works on 2.5 m terrain cells and
// has no body, and a scratch tool re-implemented "blocked" in its own words. So
// this one imports `resolveCollision` from the server and floods the map on a
// lattice with a real player radius. If the game would push a body out of a
// spot, this tool calls that spot solid too.
//
// Exits non-zero if anything the player is meant to walk to cannot be walked to.
import { darkwoods } from '../server/zones/darkwoods.js';
import { spiderden } from '../server/zones/spiderden.js';
import { prepareZone, caveOutline } from '../server/worldgen.js';
import { navBlocked } from '../server/collision.js';
import { terrainAt, T_ROCK, T_OFF } from '../server/worldgen.js';
import { PLAYER } from '../server/balance.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : +process.argv[i + 1]; };
const STEP = arg('step', 1.25);
const SHOW = arg('pockets', 12);
const R = PLAYER.radius;

export function walkable(z, step = STEP, radius = R) {
  const b = z.bounds;
  const W = Math.floor((b.maxX - b.minX) / step) + 1;
  const H = Math.floor((b.maxZ - b.minZ) / step) + 1;
  const xOf = i => b.minX + i * step, zOf = j => b.minZ + j * step;
  const open = new Uint8Array(W * H);
  let openN = 0;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = xOf(i), zz = zOf(j);
    // Cheap reject first: rock and off-map are solid whatever else is there
    // (deep water is NOT -- a player swims). An optimisation only; anything it
    // lets through still faces the real collision below.
    if (z.terrain) { const c = terrainAt(z, x, zz); if (c === T_ROCK || c === T_OFF) continue; }
    if (navBlocked(z, x, zz, radius, true)) continue;
    open[j * W + i] = 1; openN++;
  }
  // Flood from the arrival point. If the spawn itself is solid nothing is
  // reachable, which is a failure worth saying out loud rather than a crash.
  const si = Math.round((z.spawn.x - b.minX) / step), sj = Math.round((z.spawn.z - b.minZ) / step);
  const seen = new Uint8Array(W * H);
  const start = sj * W + si;
  let reached = 0;
  if (open[start]) {
    const q = [start]; seen[start] = 1; reached = 1;
    for (let head = 0; head < q.length; head++) {
      const k = q[head], i = k % W, j = (k - i) / W;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni;
        if (seen[nk] || !open[nk]) continue;
        seen[nk] = 1; reached++; q.push(nk);
      }
    }
  }
  // Nearest reachable lattice point to a spot, searched in rings so it stops
  // early; capped so a hopeless case does not scan the map.
  const nearest = (x, zz, cap = 40) => {
    const ci = Math.round((x - b.minX) / step), cj = Math.round((zz - b.minZ) / step);
    const rings = Math.ceil(cap / step);
    let best = Infinity;
    for (let r = 0; r <= rings; r++) {
      if (best <= r * step) break;                 // no ring further out can win
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        if (!seen[nj * W + ni]) continue;
        const d = Math.hypot(x - xOf(ni), zz - zOf(nj));
        if (d < best) best = d;
      }
    }
    return best;
  };
  // The sealed-off pockets: open ground the flood never entered.
  const pockets = () => {
    const mark = new Uint8Array(W * H), out = [];
    for (let k0 = 0; k0 < W * H; k0++) {
      if (!open[k0] || seen[k0] || mark[k0]) continue;
      const st = [k0]; mark[k0] = 1; let n = 0, sx = 0, sz = 0;
      while (st.length) {
        const k = st.pop(), i = k % W, j = (k - i) / W;
        n++; sx += xOf(i); sz += zOf(j);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
          const nk = nj * W + ni;
          if (open[nk] && !seen[nk] && !mark[nk]) { mark[nk] = 1; st.push(nk); }
        }
      }
      out.push({ n, area: Math.round(n * step * step), x: Math.round(sx / n), z: Math.round(sz / n) });
    }
    return out.sort((a, c) => c.n - a.n);
  };
  return { W, H, step, openN, reached, nearest, pockets,
           reachableNear: (x, zz, within) => nearest(x, zz, within + step * 2) <= within };
}

// What the player is meant to be able to walk to, and how close they must get
// for it to count. The radii are the server's own interaction distances -- a
// landmark you can only see from 12 m away is not somewhere you arrived.
export function features(z) {
  const f = [];
  // 9 m for a landmark is the server's own QUEST_REACH_RADIUS -- the distance a
  // 'reach this place' objective is satisfied at. It is deliberately wider than
  // a body, because the centre of a landmark is usually occupied BY the landmark:
  // the Grimroot pin has a Magic_Tree standing on it with a 6.7 m trunk.
  for (const p of (z.pois || [])) f.push({ kind: 'poi', id: p.key, x: p.x, z: p.z, within: 9 });
  for (const n of (z.npcs || [])) f.push({ kind: 'npc', id: n.id, x: n.x, z: n.z, within: 10 });
  for (const c of (z.chests || [])) f.push({ kind: 'chest', id: c.id, x: c.x, z: c.z, within: 4 });
  for (const o of (z.objects || [])) f.push({ kind: 'object', id: o.id, x: o.x, z: o.z, within: o.reach || 3.5 });
  for (const p of (z.portals || [])) f.push({ kind: 'portal', id: p.to, x: p.x, z: p.z, within: p.r || 4 });
  for (const s of (z.campfires || [])) f.push({ kind: 'campfire', id: `${s.x},${s.z}`, x: s.x, z: s.z, within: 5 });
  return f;
}

import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
const RUN_DIRECT = realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
// Stand a zone up exactly as the server does, so a check can see its trees.
export function ready(z) {
  if (z.cavern && !z.boundary) z.boundary = caveOutline(z.cavern, z.bounds);
  prepareZone(z);
  return z;
}

export function report(z, show = SHOW) {
  const t0 = Date.now();
  const w = walkable(z);
  const pct = (w.reached * 100 / Math.max(1, w.openN)).toFixed(1);
  console.log(`\n  ${z.name}: ${w.W}x${w.H} lattice at ${w.step} m, body radius ${R} m`);
  console.log(`  open ${w.openN} nodes, ${w.reached} reachable from the arrival point (${pct}%)`
    + `   [${((Date.now() - t0) / 1000).toFixed(1)}s]\n`);

  const fs = features(z);
  const bad = [];
  for (const f of fs) {
    if (w.reachableNear(f.x, f.z, f.within)) continue;
    bad.push({ ...f, gap: w.nearest(f.x, f.z) });
  }
  if (bad.length) {
    console.log(`  CANNOT BE WALKED TO — ${bad.length} of ${fs.length}:`);
    for (const b of bad) console.log(`    ${b.kind.padEnd(9)} ${String(b.id).padEnd(16)} `
      + `needs ${b.within} m, nearest walkable ground ${Number.isFinite(b.gap) ? b.gap.toFixed(1) + ' m' : '> 40 m'} away`);
  } else {
    console.log(`  PASS  all ${fs.length} landmarks, NPCs, chests, objects and portals can be walked to`);
  }
  if (show > 0) {
    const pk = w.pockets();
    const sealed = pk.reduce((a, p) => a + p.area, 0);
    console.log(`\n  ${pk.length} sealed pockets, ${sealed} m2 of open ground behind walls:`);
    for (const p of pk.slice(0, show)) console.log(`    ${String(p.area).padStart(6)} m2 around (${p.x}, ${p.z})`);
  }
  return bad;
}

if (RUN_DIRECT) {
  let bad = 0;
  for (const z of [darkwoods, spiderden]) bad += report(ready(z)).length;
  process.exit(bad ? 1 : 0);
}
