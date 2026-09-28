// Invariants for the Dark Woods. Every one of these is here because it broke:
// they are regression tests, not a style guide.
//
//   node tools/zonecheck.mjs
//
// Exits non-zero if any invariant fails, so it can gate a build.
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import { darkwoods as z } from '../server/zones/darkwoods.js';
import { spiderden } from '../server/zones/spiderden.js';
import { terrainAt, terrainFieldAt, isSolid, rockSolidAt, rockRiseAt, rockEdgeOf, groundSlopeAt } from '../server/worldgen.js';
import { ITEMS } from '../server/items.js';
import { FISH, TIERS } from '../server/fishing.js';
import { QUESTS } from '../server/quests.js';
import { MOB_ART } from '../server/balance.js';
import { existsSync } from 'fs';

let failures = 0;
const { resolveCollision: resolveCollisionFn } = await import('../server/collision.js');
const segMin = (x, zz, pts) => { let b = Infinity;
  for (let i = 0; i < pts.length - 1; i++) b = Math.min(b, segDistPts(x, zz, pts[i], pts[i + 1])); return b; };
const segDistPts = (x, zz, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
  const t2 = Math.max(0, Math.min(1, ((x - a.x) * dx + (zz - a.z) * dz) / L2));
  return Math.hypot(x - (a.x + dx * t2), zz - (a.z + dz * t2)); };
const ok = (name, pass, detail) => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) failures++;
};

const T = z.terrain;
const segDist = (x, zz, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (zz - a.z) * dz) / L2));
  return Math.hypot(x - (a.x + dx * t), zz - (a.z + dz * t));
};
const toPath = (x, zz) => {
  let best = 1e9;
  for (const p of z.paths) for (let i = 0; i < p.points.length - 1; i++)
    best = Math.min(best, segDist(x, zz, p.points[i], p.points[i + 1]));
  return best;
};
// A cave zone's walkable space is its chambers and the tunnels joining them --
// there is no terrain grid to ask. Anything outside both is inside the rock.
const inCavern = (zone, x, zz) => {
  const C = zone.cavern; if (!C) return true;
  const room = k => C.rooms.find(r => r.key === k);
  for (const r of C.rooms) if (Math.hypot(x - r.x, zz - r.z) <= r.r) return true;
  for (const t of C.tunnels) {
    const a = room(t.from), b = room(t.to); if (!a || !b) continue;
    if (segDist(x, zz, a, b) <= (t.w || C.tunnelWidth || 10) / 2) return true;
  }
  return false;
};
const onDeck = (x, zz) => {
  for (const r of (z.rivers || [])) for (const b of (r.bridges || [])) {
    const s = b.span || 12;
    if ((x - b.x) ** 2 + (zz - b.z) ** 2 < s * s / 4) return true;
  }
  for (const d of (z.decks || [])) {
    const dx = x - d.x, dz = zz - d.z, sn = Math.sin(d.yaw || 0), cs = Math.cos(d.yaw || 0);
    if (Math.abs(dx * cs + dz * sn) <= (d.len || 4) / 2
     && Math.abs(-dx * sn + dz * cs) <= (d.w || 2.4) / 2) return true;
  }
  return false;
};

console.log('\nThe Dark Woods — zone invariants\n');

// --- water -----------------------------------------------------------------
// The client contours its shoreline off `waterEdge` and the server decides
// swimming off the same numbers. When those two came apart there were 766 cells
// of open ground you swam across.
{
  const E = z.waterEdge;
  ok('zone carries waterEdge', !!(E && E.deep && E.marsh && E.fade),
      E ? `deep ${E.deep} marsh ${E.marsh} fade ${E.fade}` : 'missing');
  // ...and it has to REACH the client, or the client quietly uses its own copy
  // and the two shores drift apart the moment anyone retunes the waterline.
  {
    const src = readFileSync(new URL('../server/server.js', import.meta.url), 'utf8');
    const sends = /function zoneForClient[\s\S]*?\n\}/.exec(src);
    ok('the client is sent waterEdge', !!(sends && /waterEdge/.test(sends[0])),
        sends && /waterEdge/.test(sends[0]) ? 'in zoneForClient' : 'zoneForClient does not send it');
    // and the fallback in the shared module must agree with the zone, for the
    // case where an older zone file has none. It used to live in the client,
    // in the client's own copy of the terrain maths; there is one copy now and
    // this is where it is.
    const sh = readFileSync(new URL('../shared/terrain.js', import.meta.url), 'utf8');
    const fb = /WATER_EDGE_FALLBACK = \{([^}]*)\}/.exec(sh);
    const num = (k) => { const m = fb && new RegExp(k + ':\\s*([0-9.]+)').exec(fb[1]); return m ? +m[1] : null; };
    const same = fb && num('deep') === E.deep && num('marsh') === E.marsh && num('fade') === E.fade;
    ok('the shared fallback waterline matches the zone', !!same,
        fb ? `fallback deep ${num('deep')} marsh ${num('marsh')} fade ${num('fade')}` : 'no fallback found');
    // The client must IMPORT that module rather than carry its own maths. This
    // is the whole point of shared/terrain.js: the client drew the ground and
    // the server decided what you could walk on, each from its own copy, and
    // the copies drifted -- 766 cells of swimming on dry land, fishing spots
    // rippling on grass, 371 cells of invisible wall.
    const cli = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
    const imports = /import \* as TERRAIN from '\/shared\/terrain\.js'/.test(cli);
    const ownMaths = ['function terrainHeight(', 'function landBaseY(', 'function groundMeshY(',
                      'function terrainFieldAt(', 'function riverProfile(']
                     .filter(s => cli.includes(s));
    ok('the client imports the shared terrain and keeps no copy of it',
      imports && ownMaths.length === 0,
      !imports ? 'no import of /shared/terrain.js' : ownMaths.length ? `own copy of: ${ownMaths.join(', ')}` : 'one implementation');
  }

// Every mesh the renderer lights has to HAVE a normal.
//
// A glTF may leave the NORMAL accessor off a primitive, and 230 of ours do --
// the whole ruin kit, most of the darkwoods props, the blockouts, the moth,
// every fish. three then lights the mesh off vec3(0.0), normalize() of which
// is NaN, and it renders BLACK: not dim, not mistinted, black, and immune to
// colour, to emissive, to light. The fish were that for as long as they
// existed, and the failure reads as "too faint", which is why it survived
// three rounds of making them brighter.
//
// The generators could emit normals, but the loader is the one place every
// model in the game passes through, so that is where it is fixed -- and this
// check is what says the fix is still there. It counts the assets that depend
// on it so the number is visible rather than assumed.
const PARSED = [];
{
  const glbs = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    if (e.isDirectory()) walk(f); else if (e.name.endsWith('.glb')) glbs.push(f);
  } };
  const modelDir = fileURLToPath(new URL('../client/models', import.meta.url));
  walk(modelDir);
  let missing = 0, files = 0;
  const bare = [];
  for (const f of glbs) {
    const d = readFileSync(f);
    if (d.length < 12 || d.toString('utf8', 0, 4) !== 'glTF') continue;
    let off = 12, js = null, bin = null;
    while (off + 8 <= d.length) {
      const len = d.readUInt32LE(off), ty = d.readUInt32LE(off + 4);
      if (ty === 0x4E4F534A) js = JSON.parse(d.toString('utf8', off + 8, off + 8 + len));
      else if (ty === 0x004E4942) bin = d.subarray(off + 8, off + 8 + len);
      off += 8 + len;
    }
    if (!js) continue;
    PARSED.push([relative(modelDir, f), js, bin]);
    let n = 0;
    for (const m of (js.meshes || [])) for (const pr of (m.primitives || [])) if (!('NORMAL' in (pr.attributes || {}))) n++;
    if (n) { missing += n; files++; bare.push(`${relative(modelDir, f)} (${n})`); }
  }
  const cli = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  const fixes = /ensureNormals\(g\.scene\)/.test(cli)
    && /function ensureNormals[\s\S]{0,400}?computeVertexNormals\(\)/.test(cli);
  // The generators emit them now (tools/glbkit.py), so this should be empty or
  // close to it. The loader assertion stays whatever the count says: it is the
  // net under the models NOTHING generates, which is where the next one will
  // come from -- and it is named here rather than summed, because one bare
  // file hidden inside a total is how 63 of them went unnoticed.
  ok('nothing reaches the renderer without normals', fixes,
    (fixes ? 'the loader computes any that are missing' : 'THE LOADER DOES NOT COMPUTE MISSING NORMALS -- those meshes render black')
      + (missing ? `; ${missing} primitives still ship none: ${bare.join(', ')}`
                   + ' -- repair with: python3 tools/glbrepair.py <file>'
                 : `; all ${glbs.length} GLBs ship their own`));
}

// ...and the generators emit them, rather than relying on that net.
//
// Six build_*.py scripts each had their own copy of the same export function
// and every copy dropped the normals, which is how one mistake became 62
// files. They go through tools/glbkit.py now. This is what stops a seventh
// copy: a generator that builds a scene and exports it itself is a generator
// that will ship bare meshes again, and the loader would quietly cover for it.
{
  const toolDir = fileURLToPath(new URL('.', import.meta.url));
  const kit = readFileSync(join(toolDir, 'glbkit.py'), 'utf8');
  const asks = /include_normals=True/.test(kit) && /def flat_normals/.test(kit);
  const rogue = [];
  for (const f of readdirSync(toolDir).filter(n => /^build_.*\.py$/.test(n))) {
    const src = readFileSync(join(toolDir, f), 'utf8');
    if (!/trimesh\.Scene\(\)/.test(src)) continue;          // not a kit exporter
    if (!/import glbkit/.test(src) || /scene\.export\(/.test(src)) rogue.push(f);
  }
// No plant stands on a modelled mound of dirt.
//
// Six of the bushes shipped sitting on a flattened brown disc 1.37 m across,
// named "Base soil | <the bush>" in the file. That is how you present a plant
// on a white background; in a world that already has ground it is a crater,
// and there are now hundreds of each of them scattered through the meadows.
//
// Keyed on the material NAME, which is what the asset calls it, rather than on
// colour or size -- the same brown is on spider legs and an oak trunk, and a
// wide flat thing at the base of a model is sometimes a model. Repair with:
//   python3 tools/glbrepair.py --drop-material "Base soil" <file>
{
  const bad = [];
  for (const [name, js] of PARSED) {
    const soil = new Set((js.materials || [])
      .map((m, i) => [i, (m.name || '').toLowerCase()])
      .filter(([, n]) => n.includes('base soil'))
      .map(([i]) => i));
    if (!soil.size) continue;
    const n = (js.meshes || []).reduce((a, m) =>
      a + (m.primitives || []).filter(p => soil.has(p.material)).length, 0);
    if (n) bad.push(`${name} (${n})`);
  }
  ok('no plant stands on a mound of dirt', bad.length === 0,
    bad.length ? `${bad.join(', ')} -- strip with: python3 tools/glbrepair.py --drop-material "Base soil" <file>`
               : `${PARSED.length} GLBs, none carrying a soil disc`);
}

// Nothing is wound inside out.
//
// Mirroring half a model without reversing its triangles leaves that half
// enclosing NEGATIVE volume: its faces point into itself, so it lights from
// within, and on a single-sided material it is simply not there. The moth's
// wings were this, and so were four spiders' second legs, the Fighter's left
// pauldron, the Broodmother's right horn and both her tibias, two of the
// chicken's shells and one generated ruin gable -- every one of them a
// mirrored part, which is the signature.
//
// Two different faults, measured separately, because they are not repaired
// the same way: triangles DISAGREEING with their neighbours along a seam, and
// a shell that agrees with itself but faces inward. Both need the edge table,
// and the edge table has to be built on WELDED positions -- a duplicated
// vertex down a seam makes it look like a boundary and hides everything on
// the other side.
{
  const F32 = (js, bin, i) => {          // accessor -> Float32Array rows of `comps`
    const a = js.accessors[i], bv = js.bufferViews[a.bufferView];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || comps * 4;
    const out = new Float32Array(a.count * comps);
    for (let k = 0; k < a.count; k++)
      for (let c = 0; c < comps; c++) out[k * comps + c] = bin.readFloatLE(base + k * stride + c * 4);
    return out;
  };
  const IDX = (js, bin, i) => {
    const a = js.accessors[i], bv = js.bufferViews[a.bufferView];
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const rd = a.componentType === 5125 ? (o) => bin.readUInt32LE(o)
             : a.componentType === 5123 ? (o) => bin.readUInt16LE(o)
             : (o) => bin.readUInt8(o);
    const w = a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : 1;
    const out = new Uint32Array(a.count);
    for (let k = 0; k < a.count; k++) out[k] = rd(base + k * w);
    return out;
  };
  const bad = [];
  for (const [name, js, bin] of PARSED) {
    if (!bin) continue;
    let seams = 0, inverted = 0;
    for (const mesh of (js.meshes || [])) for (const pr of (mesh.primitives || [])) {
      if ((pr.mode ?? 4) !== 4 || pr.indices === undefined) continue;
      const pos = F32(js, bin, pr.attributes.POSITION), idx = IDX(js, bin, pr.indices);
      const nv = pos.length / 3, nf = idx.length / 3;
      // weld by position, to a micrometre
      const weld = new Int32Array(nv), seenPos = new Map();
      for (let v = 0; v < nv; v++) {
        const k = `${Math.round(pos[v*3]*1e6)},${Math.round(pos[v*3+1]*1e6)},${Math.round(pos[v*3+2]*1e6)}`;
        let w = seenPos.get(k); if (w === undefined) { w = seenPos.size; seenPos.set(k, w); }
        weld[v] = w;
      }
      // union-find over welded vertices: one set per connected shell
      const par = new Int32Array(seenPos.size).map((_, i) => i);
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      const uni = (a2, b2) => { a2 = find(a2); b2 = find(b2); if (a2 !== b2) par[a2] = b2; };
      const edge = new Map();
      for (let f = 0; f < nf; f++) {
        const w0 = weld[idx[f*3]], w1 = weld[idx[f*3+1]], w2 = weld[idx[f*3+2]];
        uni(w0, w1); uni(w1, w2);
        for (const [u, v] of [[w0, w1], [w1, w2], [w2, w0]]) {
          const lo = Math.min(u, v), hi = Math.max(u, v), k = lo * 4294967296 + hi;
          const e = edge.get(k);
          if (e === undefined) edge.set(k, { n: 1, fwd: u < v ? 1 : 0 });
          else { e.n++; if ((u < v ? 1 : 0) === e.fwd) e.same = true; }
        }
      }
      const openShell = new Set();
      for (const [k, e] of edge) {
        if (e.n === 2 && e.same) seams++;
        if (e.n !== 2) openShell.add(find(Math.floor(k / 4294967296)));
      }
      const vol = new Map();
      for (let f = 0; f < nf; f++) {
        const a2 = idx[f*3], b2 = idx[f*3+1], c2 = idx[f*3+2];
        const cx = pos[b2*3+1]*pos[c2*3+2] - pos[b2*3+2]*pos[c2*3+1];
        const cy = pos[b2*3+2]*pos[c2*3]   - pos[b2*3]  *pos[c2*3+2];
        const cz = pos[b2*3]  *pos[c2*3+1] - pos[b2*3+1]*pos[c2*3];
        const s2 = pos[a2*3]*cx + pos[a2*3+1]*cy + pos[a2*3+2]*cz;
        const g = find(weld[a2]);
        vol.set(g, (vol.get(g) || 0) + s2);
      }
      for (const [g, v] of vol) if (!openShell.has(g) && v < -1e-9) inverted++;
    }
    if (seams || inverted) bad.push(`${name} (${[seams && `${seams} seams`, inverted && `${inverted} inside out`].filter(Boolean).join(', ')})`);
  }
  ok('nothing is wound inside out', bad.length === 0,
    bad.length ? `${bad.join('; ')} -- repair with: python3 tools/glbrepair.py <file>`
               : `${PARSED.length} GLBs, every closed shell facing out and every seam agreeing`);
}

  ok('every generated kit exports through glbkit', asks && rogue.length === 0,
    !asks ? 'glbkit.py does not ask trimesh for normals'
          : rogue.length ? `${rogue.join(', ')} build a scene and export it themselves`
                         : 'one exporter, flat normals, for every kit');
}
  // The real test has to reproduce the CLIENT's shoreline, which is the ground
  // crossing the waterline -- not just restate the server's rule, which would
  // be comparing a number with itself and could never fail.
  const RIVER_WATER_Y = -0.5, RIVER_BED_Y = -2.2, RIVER_BANK = 4, RIVER_LIP = 2.0;
  const ROCK_RISE = 17, WATER_CUT = 4.6, MARSH_CUT = 2.0;
  const dFall = Math.log(0.5 / WATER_CUT) / Math.log(E.deep);
  const mFall = Math.log(0.5 / MARSH_CUT) / Math.log(E.marsh);
  const polyDist = (x, zz, pts) => {
    let m = 1e9;
    for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, segDist(x, zz, pts[i], pts[i + 1]));
    return m;
  };
  const landHeight = (x, zz) => {
    let h = 0;
    for (const k of (z.hills || [])) {
      const d = Math.hypot(x - k.x, zz - k.z);
      if (d >= k.r) continue;
      const t = 1 - d / k.r;
      h += k.h * t * t * (3 - 2 * t);
    }
    return h;
  };
  const terrainHeight = (x, zz) => {
    const wet = terrainFieldAt(z, x, zz, 'wet'), deep = terrainFieldAt(z, x, zz, 'deep');
    const rock = terrainFieldAt(z, x, zz, 'rock');
    const LF = Math.max(0, 1 - wet / E.fade);
    let y = LF * (landHeight(x, zz) + ROCK_RISE * rock * rock);
    y -= WATER_CUT * Math.pow(deep, dFall)
       + MARSH_CUT * Math.max(0, Math.pow(wet, mFall) - Math.pow(deep, mFall));
    for (const r of (z.rivers || [])) {
      const half = r.width / 2 + RIVER_BANK, H = half + RIVER_LIP;
      const d = polyDist(x, zz, r.points);
      if (d >= H) continue;
      const h = d >= half
        ? RIVER_WATER_Y + (0 - RIVER_WATER_Y) * ((d - half) / RIVER_LIP)
        : RIVER_BED_Y + (RIVER_WATER_Y - RIVER_BED_Y) * Math.pow(d / half, 3);
      if (h < 0 && h < y) y = h;
    }
    return y;
  };
  let swimDry = 0, wadeDry = 0;
  if (E) for (let gz = 0; gz < T.h; gz++) for (let gx = 0; gx < T.w; gx++) {
    if (T.rows[gz][gx] === ' ') continue;
    const x = T.minX + (gx + 0.5) * T.cell, zz = T.minZ + (gz + 0.5) * T.cell;
    if (onDeck(x, zz)) continue;
    // the server makes you swim here
    if (terrainFieldAt(z, x, zz, 'deep') < E.deep) continue;
    // ...so the client must be drawing its deep sheet here too
    const drawn = Math.min(RIVER_WATER_Y + 0.02 - terrainHeight(x, zz),
                           (terrainFieldAt(z, x, zz, 'deep') - E.deep) * 24) >= 0;
    if (!drawn) swimDry++;
  }
  ok('no swimming without water drawn', swimDry === 0, `${swimDry} cells`);
}

// --- the sky ----------------------------------------------------------------
// The sky has to reach everywhere you can stand.
//
// The dome is a BackSide sphere of radius 420 and it stood at the WORLD ORIGIN
// while the Dark Woods reaches 527 m out to the far side of its own boundary.
// So on 15% of the map you were standing OUTSIDE the sky, and the shell came
// down through the ground as a curved blue wall across the middle of the world.
// You walked straight through it -- it has no collision, it is the sky -- but
// it is opaque and it is nearer than everything behind it, so it won the depth
// test and painted over the entire mountain range. It read as the edge of the
// map, 130 m in from the real edge.
//
// There are two ways to be right and the client may pick either. Ride the
// camera, and the shell is always exactly its own radius away, so the only
// question is whether that fits inside the far plane. Or stand still, and it
// has to be bigger than the world. This checks whichever one is being done --
// and the trap is that each rule alone looks satisfied by the broken code:
// 420 is comfortably inside the 440 m far plane, and it is only NOT riding the
// camera that makes 420 the wrong number.
{
  const cli = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  const sky = cli.slice(cli.indexOf('function buildSky()'));
  const num = (re, hay) => { const m = re.exec(hay); return m ? +m[1] : NaN; };
  const domeR = num(/new THREE\.SphereGeometry\(\s*([\d.]+)/, sky);
  const starR = num(/\bph\s*=[^;]*?,\s*r\s*=\s*([\d.]+)\s*;/, sky);
  const camArgs = (/new THREE\.PerspectiveCamera\(([^)]*)\)/.exec(cli) || [, ''])[1].split(',');
  const far = +camArgs[camArgs.length - 1];
  const rides = (o) => new RegExp(`sky\\.${o}\\.position\\.copy\\(camP\\)`).test(cli);

  // How far from the origin an open-air zone can put you. The boundary polygon
  // is the real answer: the server stops you at it and the camera is clamped
  // inside it.
  const openAir = [z, spiderden].filter(zn => !zn.enclosed);
  let worldR = 0, worstZone = '';
  for (const zn of openAir) {
    const pts = (zn.boundary && zn.boundary.length) ? zn.boundary
      : [[zn.bounds.minX, zn.bounds.minZ], [zn.bounds.minX, zn.bounds.maxZ],
         [zn.bounds.maxX, zn.bounds.minZ], [zn.bounds.maxX, zn.bounds.maxZ]].map(([x, zz]) => ({ x, z: zz }));
    for (const q of pts) { const d = Math.hypot(q.x, q.z); if (d > worldR) { worldR = d; worstZone = zn.name; } }
  }

  for (const [part, R] of [['dome', domeR], ['stars', starR]]) {
    const onCam = rides(part);
    const pass = Number.isFinite(R) && Number.isFinite(far)
      && (onCam ? R < far : R >= worldR);
    ok(`the sky ${part === 'dome' ? 'dome' : 'field'} reaches everywhere you can stand`, pass,
      !Number.isFinite(R) ? `could not read the ${part} radius out of buildSky()`
      : onCam ? `rides the camera at ${R} m, inside the ${far} m far plane`
                + (pass ? '' : ` -- EVERY frame clips it, the sky has a hole in it`)
              : `fixed at the origin at ${R} m, but ${worstZone} reaches ${worldR.toFixed(1)} m`
                + (pass ? '' : ` -- ${(worldR - R).toFixed(0)} m of the map stands outside the sky`));
  }
  // Stars painted on the inside of the dome: outside it they are the one thing
  // that still draws (depthWrite is off on both), so they would hang in front
  // of the sky instead of on it.
  ok('the stars sit inside the dome', starR < domeR, `${starR} m inside ${domeR} m`);
}

// --- crossings -------------------------------------------------------------
// A bridge belongs where a road meets a river and nowhere else.
{
  let fords = 0, offLine = 0, bridges = 0;
  for (const r of z.rivers) {
    for (const b of (r.bridges || [])) {
      bridges++;
      let d = 1e9;
      for (let i = 0; i < r.points.length - 1; i++) d = Math.min(d, segDist(b.x, b.z, r.points[i], r.points[i + 1]));
      if (d > 2) offLine++;
    }
    for (const p of z.paths) for (let i = 0; i < p.points.length - 1; i++) {
      for (let j = 0; j < r.points.length - 1; j++) {
        const a1 = p.points[i], a2 = p.points[i + 1], b1 = r.points[j], b2 = r.points[j + 1];
        const d = (a2.x - a1.x) * (b2.z - b1.z) - (a2.z - a1.z) * (b2.x - b1.x);
        if (Math.abs(d) < 1e-9) continue;
        const t = ((b1.x - a1.x) * (b2.z - b1.z) - (b1.z - a1.z) * (b2.x - b1.x)) / d;
        const u = ((b1.x - a1.x) * (a2.z - a1.z) - (b1.z - a1.z) * (a2.x - a1.x)) / d;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const hx = a1.x + (a2.x - a1.x) * t, hz = a1.z + (a2.z - a1.z) * t;
        if (!(r.bridges || []).some(b => Math.hypot(b.x - hx, b.z - hz) < 12)) fords++;
      }
    }
  }
  ok('every path/river crossing is bridged', fords === 0, `${fords} fords, ${bridges} bridges`);
  ok('every bridge sits on its centreline', offLine === 0, `${offLine} adrift`);
}

// --- the fen ---------------------------------------------------------------
{
  const D = z.decks || [];
  let gaps = 0, adrift = 0;
  for (const d of D) {
    let nearest = 1e9;
    for (const e of D) if (e !== d) nearest = Math.min(nearest, Math.hypot(d.x - e.x, d.z - e.z));
    if (nearest > 4.3) gaps++;
    let ends = 0;
    for (const e of D) if (e !== d && Math.hypot(d.x - e.x, d.z - e.z) < 5) ends++;
    if (ends <= 1 && toPath(d.x, d.z) > 6 && d.m !== 'Boardwalk_Jetty') adrift++;
  }
  ok('plank walk has no gaps', gaps === 0, `${D.length} spans, ${gaps} isolated`);
  ok('every walk end meets a path', adrift === 0, `${adrift} adrift`);
}

// --- buildings -------------------------------------------------------------
// Every piece is set at the height of its structure's CENTRE, so anything
// outside the levelled pad floats or sinks with the hillside.
{
  let overflow = 0, sealed = 0;
  for (const b of z.structures) {
    let mx = 0, mz = 0;
    for (const pc of b.pieces) { mx = Math.max(mx, Math.abs(pc.dx)); mz = Math.max(mz, Math.abs(pc.dz)); }
    if (b.padW && (mx > b.padW || mz > b.padD)) overflow++;
    const walls = b.pieces.filter(pc => pc.wall && !(pc.dy > 0.01));
    if (walls.length > 6 && !walls.some(pc => pc.gap)) sealed++;
  }
  ok('structure pads cover their pieces', overflow === 0, `${overflow} overflowing`);
  ok('enclosed structures have a doorway', sealed === 0, `${sealed} sealed`);
}

// --- camp palisades --------------------------------------------------------
// A fence across the road is the farm-gate bug: the gateways are cut by the
// paths, so none of them may stand on one.
{
  const barriers = z.props.filter(o => /Rough_Fence|Spike_Barricade/.test(o.m));
  const blocking = barriers.filter(o => toPath(o.x, o.z) < 2.8).length;
  ok('no barrier stands on a path', blocking === 0, `${barriers.length} barriers, ${blocking} blocking`);
}

// --- interactables ---------------------------------------------------------
{
  // This asked the TRACED GRID whether a spot was wet, and counted anything
  // within RIVER_BANK of a river as wet too. Both are the wrong question. The
  // client contours its shoreline off the BLURRED field against waterEdge and
  // the server decides swimming off the same numbers, so a lone 'W' cell with
  // dry ground round it has no water drawn on it at all -- and this check said
  // it was fine. fs_murkfen_w was a 'W' cell whose blurred value was 0.256
  // against a 0.44 waterline: ripple rings on grass, and a player stood in a
  // field casting into it, which is how it was finally noticed. Ask the
  // question the game answers.
  const E = z.waterEdge;
  const spots = z.fishingSpots || [];
  const inChannel = (x, zz) => (z.rivers || []).some(r => {
    for (let i = 0; i < r.points.length - 1; i++)
      if (segDist(x, zz, r.points[i], r.points[i + 1]) < r.width / 2) return true;
    return false;
  });
  const drawn = (x, zz) => terrainFieldAt(z, x, zz, 'wet') >= E.marsh
                        || terrainFieldAt(z, x, zz, 'deep') >= E.deep
                        || inChannel(x, zz);
  const dry = spots.filter(f => !drawn(f.x, f.z));
  ok('every fishing spot is in water the game draws', dry.length === 0,
      dry.length ? dry.map(f => `${f.id} (wet ${terrainFieldAt(z, f.x, f.z, 'wet').toFixed(2)} < ${E.marsh})`).join(', ')
                 : `${spots.length} spots, 0 on land`);
  // ...and you have to be able to STAND somewhere to fish it. A spot in the
  // middle of a lake is as unusable as one in a field.
  // "A bank to stand on" was the wrong rule twice over. Asking for DRY land
  // called the jetty unreachable -- it is a plank walk built out over the fen
  // precisely so you can stand where there is water under you -- and asking
  // the blurred field instead passed fs_creek on ground a metre and a half
  // UNDER the waterline, because beside a carved channel the field says "not
  // water" over a submerged bed.
  //
  // The rule that actually matters is the one the player feels: can you fish
  // it without swimming? Wading is fine. That is waterDepthAt, which is purely
  // field-based, so it can be reproduced here exactly rather than approximated.
  const FISH_REACH = 4.5, DEEP_RAMP = 0.29, SWIM_IN = 0.82;
  const wadeDepth = (x, zz) => {
    let d = 0;
    for (const r of (z.rivers || [])) {
      let m = 1e9;
      for (let i = 0; i < r.points.length - 1; i++) m = Math.min(m, segDist(x, zz, r.points[i], r.points[i + 1]));
      if (m < r.width / 2) d = Math.max(d, Math.min(1, 0.45 + (1 - m / (r.width / 2)) * 0.8));
    }
    const dg = terrainFieldAt(z, x, zz, 'deep'), wg = terrainFieldAt(z, x, zz, 'wet');
    if (dg >= E.deep) { const t = Math.min(1, (dg - E.deep) / DEEP_RAMP); d = Math.max(d, 0.30 + 0.70 * (t * t * (3 - 2 * t))); }
    else if (wg >= E.marsh) d = Math.max(d, 0.35);
    return d;
  };
  const unreachable = spots.filter(f => {
    for (let a = 0; a < 24; a++) {
      const ang = a / 24 * Math.PI * 2;
      for (const rr of [1.6, 2.4, 3.2, 4.0, FISH_REACH - 0.1]) {
        const x = f.x + Math.cos(ang) * rr, zz = f.z + Math.sin(ang) * rr;
        if (onDeck(x, zz)) return false;                       // the planks
        if (terrainAt(z, x, zz) === ' ' || rockSolidAt(z, x, zz)) continue;   // cliff or off-map
        if (wadeDepth(x, zz) < SWIM_IN) return false;          // you can stand here
      }
    }
    return true;
  });
  ok('every fishing spot can be fished without swimming', unreachable.length === 0,
      unreachable.length ? unreachable.map(f => f.id).join(', ') : `${spots.length} spots wadeable`);

  // Every species the game can catch needs water to catch it in. Pike had a
  // level, an xp value, an item, a cooked form and a model, and no tier 4 spot
  // anywhere in the world -- the same dead-content shape as an item nothing
  // drops, one layer further out.
  {
    const tiers = new Set(spots.map(f => f.tier));
    const homeless = TIERS.map((name, i) => [name, i + 1])
      .filter(([, t]) => !tiers.has(t))
      .map(([name, t]) => `${name} (tier ${t}, needs Fishing ${FISH[name].level})`);
    ok('every catchable species has water to catch it in', homeless.length === 0,
        homeless.length ? homeless.join(', ') : `${TIERS.length} species, ${tiers.size} tiers stocked`);
  }

  const ore = (z.scatter || []).filter(o => /Ore_Vein/.test(o.model || o.m || ''));
  ok('ore specs exist', ore.length > 0, `${ore.length} vein specs`);

  // Anything you have to walk up to must stand on ground you can stand on.
  // Two chests had been sealed inside cliffs -- unopenable, and silent about it.
  const sealedIn = [
    ...(z.chests || []).map(c => ['chest ' + c.id, c.x, c.z]),
    ...(z.elites || []).map(e => ['elite ' + e.name, e.cx, e.cz]),
    ...(z.npcs || []).map(n => ['npc ' + n.name, n.x, n.z]),
  ].filter(([, x, zz]) => terrainAt(z, x, zz) === ' ' || rockSolidAt(z, x, zz));
  ok('chests, elites and NPCs stand on reachable ground', sealedIn.length === 0,
      sealedIn.length ? sealedIn.map(r => r[0]).join(', ')
                      : `${z.chests.length} chests, ${z.elites.length} elites, ${z.npcs.length} npcs`);

  // A named landmark with nothing in it is a signpost, not a place.
  const barren = z.pois.filter(p => p.kind !== 'exit' && p.kind !== 'safe').filter(p => {
    const mobs = (z.spawns || []).filter(sp => Math.hypot(sp.cx - p.x, sp.cz - p.z) < p.r + 20)
                                 .reduce((a, sp) => a + sp.count, 0);
    return mobs === 0;
  });
  ok('every landmark has something in it', barren.length === 0,
      barren.length ? barren.map(p => p.key).join(', ') : `${z.pois.length - 5} landmarks populated`);
}

// --- reachability ----------------------------------------------------------
// A landmark walled off behind its own cliffs is the easiest bug to ship.
{
  const WALK = new Set(['.', 'f', 'F', 'w']);
  const at = (gx, gz) => (gz < 0 || gz >= T.h || gx < 0 || gx >= T.w) ? ' ' : T.rows[gz][gx];
  const cell = (x, zz) => [Math.floor((x - T.minX) / T.cell), Math.floor((zz - T.minZ) / T.cell)];
  const walkable = (gx, gz) => WALK.has(at(gx, gz));
  const nearestWalkable = (x, zz) => {
    let [gx, gz] = cell(x, zz);
    if (walkable(gx, gz)) return [gx, gz];
    for (let r = 1; r < 40; r++) for (let i = 0; i < 360; i += 10) {
      const a = i * Math.PI / 180;
      const nx = gx + Math.round(Math.cos(a) * r), nz = gz + Math.round(Math.sin(a) * r);
      if (walkable(nx, nz)) return [nx, nz];
    }
    return null;
  };
  const camp = z.pois.find(p => p.key === 'camp');
  const seed = nearestWalkable(camp.x, camp.z);
  const seen = new Set([seed.join(',')]); const stack = [seed];
  while (stack.length) {
    const [gx, gz] = stack.pop();
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = gx + dx, nz = gz + dz, k = nx + ',' + nz;
      if (seen.has(k) || !walkable(nx, nz)) continue;
      seen.add(k); stack.push([nx, nz]);
    }
  }
  // A landmark counts as reached if ANY walkable cell in its vicinity is in the
  // camp's component -- not merely the nearest one, which can be a pocket
  // sealed inside its own cliffs (Wolfsnag's centre is solid rock by design).
  //
  // The vicinity has to be generous, because a pin is not always on ground you
  // can stand on: Ravenwater's sits on an isolated scrap of marsh out in the
  // pool with its nearest connected shore 43 m away, and an exit's sits on the
  // map boundary itself. The generator's own anchor search reaches 90 m, so
  // anything tighter than that reports landmarks stranded that plainly are not.
  const reached = (p) => {
    const [gx0, gz0] = cell(p.x, p.z);
    const rc = Math.ceil(60 / T.cell);
    for (let dz = -rc; dz <= rc; dz++) for (let dx = -rc; dx <= rc; dx++) {
      if (dx * dx + dz * dz > rc * rc) continue;
      if (seen.has((gx0 + dx) + ',' + (gz0 + dz))) return true;
    }
    return false;
  };
  const stranded = z.pois.filter(p => !reached(p));
  ok('every landmark reachable on foot from the camp', stranded.length === 0,
      stranded.length ? stranded.map(p => p.key).join(', ') : `${z.pois.length} landmarks`);
}

// --- manifest --------------------------------------------------------------
// Placement and the model manifest are separate lists, and the failure is
// silent: a piece placed but never downloaded is simply invisible.
{
  const used = new Set();
  for (const o of (z.scatter || [])) used.add(o.model || o.m);
  for (const o of (z.props || [])) used.add(o.m);
  for (const o of (z.decks || [])) used.add(o.m);
  for (const b of (z.structures || [])) for (const pc of b.pieces) used.add(pc.m);
  // Objects were missing from this set, which is how they would have gone out
  // placed-but-undownloaded: a glowcap clump you can click and cannot see.
  for (const o of (z.objects || [])) { used.add(o.m); if (o.doused) used.add(o.doused); }
  const listed = new Set(z.models.map(m => m.split('/').pop()));
  const missing = [...used].filter(m => m && !listed.has(m));
  ok('everything placed is in the model manifest', missing.length === 0,
      missing.length ? missing.join(', ') : `${used.size} models placed`);
}

// --- quest objects ----------------------------------------------------------
// zone.objects came out of the rebuild EMPTY and six quests wanted things from
// it. Nothing complained: an empty list looks exactly like a list with nothing
// wrong with it. These check the list exists, that what is in it can be walked
// up to, and that the ones a quest names by id are still named that.
{
  // Both zones. The Spider Den had NO objects at all while these ran only
  // against the Dark Woods, so a cave whose chambers are named after its
  // cocoons and its egg clusters passed a check that never looked at it.
  const ZS = { darkwoods: z, spiderden };
  const all = [], badGive = [], ghostQuest = [], badDead = [], sealed = [], dupes = [];
  let stacked = 0, emptyZones = [];
  for (const [zid, zone] of Object.entries(ZS)) {
    const objs = zone.objects || [];
    if (!objs.length) emptyZones.push(zid);
    const ids = new Set();
    for (const o of objs) {
      if (ids.size === ids.add(o.id).size) dupes.push(`${zid}:${o.id}`);
      all.push([zid, o]);
      if (o.gives && !ITEMS[o.gives.item]) badGive.push(`${o.id} -> ${o.gives.item}`);
      if (o.quest && !QUESTS[o.quest]) ghostQuest.push(`${o.id} -> ${o.quest}`);
      const eliteNames = new Set((zone.elites || []).map(e => e.name));
      if (o.needDead && !eliteNames.has(o.needDead)) badDead.push(`${o.id} -> ${o.needDead}`);
      // Above ground: buried in a cliff or sunk in the lake. Underground: the
      // cave is the walkable part, so anything outside the chambers and the
      // tunnels is inside solid rock.
      if (zone.enclosed) { if (!inCavern(zone, o.x, o.z)) sealed.push(`${zid}:${o.id}`); }
      else if (terrainAt(zone, o.x, o.z) === ' ' || terrainAt(zone, o.x, o.z) === 'W'
               || rockSolidAt(zone, o.x, o.z))
        sealed.push(`${zid}:${o.id}`);
    }
    for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++)
      if (Math.hypot(objs[i].x - objs[j].x, objs[i].z - objs[j].z) < 3.5) stacked++;
  }

  ok('every zone has quest objects', emptyZones.length === 0,
      emptyZones.length ? `${emptyZones.join(', ')} has none` : `${all.length} objects across ${Object.keys(ZS).length} zones`);

  ok('every object id is unique', dupes.length === 0,
      dupes.length ? dupes.join(', ') : `${all.length} ids`);

  ok('every object stands somewhere you can reach', sealed.length === 0,
      sealed.length ? sealed.join(', ') : `${all.length} clear`);

  // The reach is how close you must get. An object further from any walkable
  // route than a player will ever wander is decoration. (Only above ground --
  // a cave has no path network, its chambers ARE the route.)
  const stranded = (z.objects || []).filter(o => toPath(o.x, o.z) > 70);
  ok('no object is stranded away from the path network', stranded.length === 0,
      stranded.length ? stranded.map(o => `${o.id} ${toPath(o.x, o.z) | 0}u`).join(', ')
                      : `furthest ${Math.max(...(z.objects || []).map(o => toPath(o.x, o.z))) | 0}u off a path`);

  // Two nodes in the same spot read as one, so a 'gather 6' that looks like it
  // has ten sources can really have five.
  ok('no two objects stand on the same spot', stacked === 0, `${stacked} overlapping pairs`);

  // Anything that hands an item over must hand over an item that exists.
  ok('everything an object gives is a real item', badGive.length === 0,
      badGive.length ? badGive.join(', ') : `${all.filter(([, o]) => o.gives).length} give items`);

  // A once-only object gated behind a quest you cannot yet have is fine; one
  // gated behind a quest that does not exist is a dead prop.
  ok('every object gated behind a quest names a real one', ghostQuest.length === 0,
      ghostQuest.length ? ghostQuest.join(', ') : `${all.filter(([, o]) => o.quest).length} gated`);

  // needDead names an elite by its display name. Misspell it and the object
  // can never be used, because the kill it waits for never registers.
  ok('every needDead names a real elite', badDead.length === 0,
      badDead.length ? badDead.join(', ') : `${all.filter(([, o]) => o.needDead).length} gated on a kill`);
}

// --- portals ----------------------------------------------------------------
// A portal that lands you inside a wall is an entry LOOP: collision shoves you
// back toward the arch you came through, which sends you down again. The Spider
// Den's exit did this once the chokepoint squeeze put rock around its mouth.
{
  const ZONES = { darkwoods: z, spiderden };
  const bad = [];
  for (const [zid, zone] of Object.entries(ZONES)) {
    for (const p of (zone.portals || [])) {
      const to = ZONES[p.to];
      if (!to) { bad.push(`${zid} -> unknown zone '${p.to}'`); continue; }
      if (!p.spawn) { bad.push(`${zid} -> ${p.to} has no spawn`); continue; }
      if (to.terrain && (terrainAt(to, p.spawn.x, p.spawn.z) === ' ' || rockSolidAt(to, p.spawn.x, p.spawn.z)))
        bad.push(`${zid} -> ${p.to} lands in solid ground`);
      // and it must not drop you back inside the portal you came out of
      for (const back of (to.portals || [])) {
        if (back.to !== zid) continue;
        const d = Math.hypot(back.x - p.spawn.x, back.z - p.spawn.z);
        if (d < back.r + 2) bad.push(`${zid} -> ${p.to} lands ${d.toFixed(1)}u from the return portal (r ${back.r}) — a loop`);
      }
    }
  }
  const total = Object.values(ZONES).reduce((n, zz) => n + (zz.portals || []).length, 0);
  ok('portals land somewhere you can stand, clear of the way back', bad.length === 0,
      bad.length ? bad.join('; ') : `${total} portals`);
}

// Every monster a zone can spawn needs art, and the art has to be a file that
// exists. This table lived in the client, so the server never knew a zone had
// to ship Cave_Spider with it -- not one mob model was ever requested and every
// monster in the game rendered as the red placeholder box.
for (const zone of [z, spiderden]) {
  const types = new Set();
  for (const s of (zone.spawns || [])) types.add(s.type);
  for (const e of (zone.elites || [])) types.add(e.type);
  const noArt = [...types].filter(t2 => !MOB_ART[t2]);
  const noFile = [...types].filter(t2 => MOB_ART[t2]
    && !existsSync(new URL(`../client/models/${MOB_ART[t2].model}.glb`, import.meta.url)));
  ok(`${zone.name}: every monster has art on disk`, noArt.length === 0 && noFile.length === 0,
    noArt.length || noFile.length
      ? `no art: ${noArt.join(', ') || 'none'}; no file: ${noFile.map(t2 => MOB_ART[t2].model).join(', ') || 'none'}`
      : `${types.size} monster types`);
}

// What blocks is what is STEEP, and the steepness is measured on the surface
// the player can see. (There used to be a check here that nothing blocks
// without drawn rock over it and nothing drawn is walked through; it was for
// the rule where rock blocked by how much of it was under you, and under the
// slope rule the two quantities are unrelated by design. The invariant that
// replaced it is "every object stands somewhere you can reach", which uses
// rockSolidAt and caught a glowcap on a 43-degree face the moment the rule
// changed.)
{
  const T2 = z.terrain, E2 = rockEdgeOf(z);
  let steepWalkable = [], gentleBlocked = 0;
  for (let gz = 0; gz < T2.h; gz += 2) for (let gx = 0; gx < T2.w; gx += 2) {
    if (T2.rows[gz][gx] === ' ') continue;
    const x = T2.minX + (gx + 0.5) * T2.cell, zz = T2.minZ + (gz + 0.5) * T2.cell;
    const steep = groundSlopeAt(z, x, zz) > E2.walkSlope;
    const blocks = rockSolidAt(z, x, zz);
    if (steep && !blocks && toPath(x, zz) > 5) steepWalkable.push(`(${x.toFixed(0)}, ${zz.toFixed(0)})`);
    if (!steep && blocks) gentleBlocked++;
  }
  ok('what blocks is what is too steep to walk, and only that',
    steepWalkable.length === 0 && gentleBlocked === 0,
    `${gentleBlocked} gentle cells blocking, ${steepWalkable.length} steep cells walkable off-road`
    + (steepWalkable.length ? ' at ' + steepWalkable.slice(0, 4).join(' ') : ''));
}

// A fishing spot belongs IN the water, at the edge of it, within a cast of
// somewhere a person is standing -- and not on top of the fen's plank walks,
// which is where three of them had come to rest, ripples drawn on the decking.
// The builder places them; this asks the runtime whether they landed.
{
  const REACH = 4.5, MIN_DEPTH = 0.30, SWIM_IN = 0.82, DEEP_RAMP = 0.29;
  const E = z.waterEdge;
  const onDeck = (x, zz) => {
    for (const r of (z.rivers || [])) for (const b of (r.bridges || []))
      if (Math.hypot(x - b.x, zz - b.z) < ((b.span || 12) / 2)) return true;
    for (const d of (z.decks || [])) {
      const dx = x - d.x, dz = zz - d.z, sn = Math.sin(d.yaw || 0), cs = Math.cos(d.yaw || 0);
      if (Math.abs(dx * cs + dz * sn) <= (d.len || 4) / 2 && Math.abs(-dx * sn + dz * cs) <= (d.w || 2.4) / 2) return true;
    }
    return false;
  };
  const depthAt = (x, zz) => {
    if (onDeck(x, zz)) return 0;
    let d = 0;
    const dg = terrainFieldAt(z, x, zz, 'deep'), wg = terrainFieldAt(z, x, zz, 'wet');
    if (dg >= E.deep) { const q = Math.min(1, (dg - E.deep) / DEEP_RAMP); d = Math.max(d, 0.30 + 0.70 * (q * q * (3 - 2 * q))); }
    else if (wg >= E.marsh) d = 0.35;
    for (const r of (z.rivers || [])) {
      const dd = segMin(x, zz, r.points);
      if (dd < r.width / 2) d = Math.max(d, Math.min(1, 0.45 + (1 - dd / (r.width / 2)) * 0.8));
    }
    return d;
  };
  const bad = [];
  for (const sp of (z.fishingSpots || [])) {
    const d = depthAt(sp.x, sp.z);
    if (onDeck(sp.x, sp.z)) { bad.push(`${sp.id} is on the planks`); continue; }
    if (d < MIN_DEPTH) { bad.push(`${sp.id} has ${d.toFixed(2)} m of water`); continue; }
    let near = Infinity;
    for (let a = 0; a < 360 && near > REACH; a += 4) for (let r = 0.5; r <= REACH; r += 0.25) {
      const x = sp.x + Math.cos(a * Math.PI / 180) * r, zz = sp.z + Math.sin(a * Math.PI / 180) * r;
      if (depthAt(x, zz) >= SWIM_IN) continue;
      const probe = { x, z: zz, y: 0, canSwim: true };
      resolveCollisionFn(z, probe, 0.6);
      if (Math.hypot(probe.x - x, probe.z - zz) <= 0.05) { near = Math.min(near, r); break; }
    }
    if (near > REACH) bad.push(`${sp.id} is ${near === Infinity ? '>' + REACH : near.toFixed(1)} m from anywhere to stand`);
  }
  ok('every fishing spot is in water at the edge, off the planks, within a cast',
    bad.length === 0, bad.length ? bad.join('; ') : `${(z.fishingSpots || []).length} spots`);
}

// A road through rock is not a road. Since rock blocks by the DRAWN field now,
// a road can never be blocked -- it is the one authored exception to that rule
// (worldgen.rockSolidAt), because a 3-5 m chokepoint is narrower than the blur
// can resolve. So the thing to guard is that the exception stays a safety net
// and not a crutch: a road must never be buried in a mountain. Measured: 18 of
// 5,289 samples lean on it at all, the worst under 4.9 m of stone.
{
  let worst = 0, worstAt = null, leaning = 0, samples = 0;
  for (const p of (z.paths || [])) {
    for (let i = 0; i < p.points.length - 1; i++) {
      const a = p.points[i], b = p.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z)));
      for (let k = 0; k <= n; k++) {
        const t2 = k / n, x = a.x + (b.x - a.x) * t2, zz = a.z + (b.z - a.z) * t2;
        samples++;
        if (terrainAt(z, x, zz) === ' ') { worst = Infinity; worstAt = `${p.from}->${p.to} off the map`; continue; }
        const h = rockRiseAt(z, x, zz);
        if (h > rockEdgeOf(z).rise * rockEdgeOf(z).solid ** 2) leaning++;
        if (h > worst) { worst = h; worstAt = `${p.from}->${p.to} at (${x.toFixed(0)}, ${zz.toFixed(0)})`; }
      }
    }
  }
  const BURIED = 8;
  ok('no road is buried in rock', worst <= BURIED,
    `${samples} samples, ${leaning} lean on the road exemption, worst ${Number.isFinite(worst) ? worst.toFixed(1) + ' m' : 'off-map'} — ${worstAt}`);
}

// The three "can you reach it" invariants above work on the 2.5 m terrain grid
// with no body, which is a weaker question than the game asks: they all passed
// while Huntress Sela stood in a sealed basin, the wolfden chest could not be
// opened and the East Path exit sat 44 m off the map. The real test floods the
// map at body resolution through the server's own collision, which costs about
// 40 seconds -- too slow to run on every save, so it lives in its own tool and
// runs here on request.
if (process.argv.includes('--walk')) {
  const { ready, report } = await import('./walkcheck.mjs');
  // A fence is a WALL, not a row of bollards, and the test has to be a WALKING
  // body rather than a probe dropped on a spot. Those are different questions
  // and the difference is the whole bug: a static probe says the old ring was
  // solid everywhere but its gate, while a body walking into it got out on
  // 359 of 360 bearings. A circle only pushes you radially, so once you are
  // level with two posts the correction has almost no component across the
  // fence and you keep going. Measured, old zone against new:
  //
  //   hen yard   359/360 bearings escape  ->  18/360 (the gate)
  //   cow field  360/360                  ->  19/360
  {
    const { resolveCollision } = await import('../server/collision.js');
    const { prepareZone } = await import('../server/worldgen.js');
    prepareZone(z);
    const DT = 1 / 20, SPEED = 5.5, R = 6 / 10;
    const escapes = (cx, cz, deg) => {
      const a = deg * Math.PI / 180, ent = { x: cx, z: cz, y: 0, canSwim: true };
      for (let t = 0; t < 400; t++) {
        ent.x += Math.cos(a) * SPEED * DT; ent.z += Math.sin(a) * SPEED * DT;
        resolveCollision(z, ent, R);
        if (Math.hypot(ent.x - cx, ent.z - cz) > 30) return true;
      }
      return false;
    };
    const seen = [], bad = [];
    for (const d of (z.dirt || []).slice().sort((a, b) => b.r - a.r)) {
      if (!(z.fences || []).some(f => Math.hypot((f.x1 + f.x2) / 2 - d.x, (f.z1 + f.z2) / 2 - d.z) < 30)) continue;
      if (seen.some(s => Math.hypot(s.x - d.x, s.z - d.z) < 40)) continue;
      seen.push(d);
      let out = 0;
      for (let deg = 0; deg < 360; deg++) if (escapes(d.x, d.z, deg)) out++;
      // one gate is a few tens of degrees; a fence you can cross anywhere is
      // most of the circle.
      if (out > 60) bad.push(`the yard at (${d.x.toFixed(0)}, ${d.z.toFixed(0)}) can be left on ${out} of 360 bearings`);
    }
    ok('a farmyard fence cannot be walked through', bad.length === 0,
      bad.length ? bad.join('; ') : `${seen.length} yards, each shut but for its gate`);
  }

  for (const zone of [z, spiderden]) {
    const bad = report(ready(zone), 6);
    ok(`${zone.name}: everything can be walked to with a body`, bad.length === 0,
      bad.length ? bad.map(b => `${b.kind} ${b.id}`).join(', ') : 'flood-filled at 1.25 m');
  }
} else {
  console.log('\n  NOTE  the three reachability invariants above use 2.5 m cells and no body.');
  console.log('        For the real question — can a player WALK there — run:');
  console.log('          node tools/walkcheck.mjs        (or: node tools/zonecheck.mjs --walk)');
}

console.log(`\n${failures ? failures + ' FAILED' : 'all invariants hold'}\n`);
process.exit(failures ? 1 : 0);
