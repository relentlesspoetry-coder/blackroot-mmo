// Blackroot — the shape of the world.
//
// This file exists because of a bug class. The client drew the ground and the
// server decided what you could walk on, each from its own copy of the same
// maths, and the copies were never quite the same shape: 766 cells of swimming
// on dry land, fishing spots rendering their ripples on grass, 371 cells of
// invisible wall, a chest sealed inside a cliff. Every one of them was two
// implementations of one rule disagreeing, and every one was fixed by moving
// the rule to one place.
//
// So this is that one place. The SERVER imports it directly; the CLIENT imports
// it over HTTP from /shared/terrain.js. There is no second copy to drift.
//
// Everything takes `zone` and is a pure function of it. Caches hang off the
// zone object (`_fields`, `_pads`, `_lattice`, and `_prof` on each river), so a
// zone can be handed to either side and answer the same way.

// --- the traced grid --------------------------------------------------------
// One character per cell, straight off the blueprint.
export const T_OFF = ' ', T_DEEP = 'W', T_MARSH = 'w', T_ROCK = 'R',
             T_DENSE = 'F', T_WOOD = 'f', T_OPEN = '.';
export function terrainAt(zone, x, z) {
  const t = zone && zone.terrain;
  if (!t) return T_OPEN;
  const gx = Math.floor((x - t.minX) / t.cell), gz = Math.floor((z - t.minZ) / t.cell);
  if (gz < 0 || gz >= t.h || gx < 0 || gx >= t.w) return T_OFF;
  return t.rows[gz][gx] || T_OFF;
}
export function isWater(c) { return c === T_DEEP || c === T_MARSH; }

// --- the blurred fields -----------------------------------------------------
// A cell is 2.5 m and the drawing's edges are curves, so every question about
// "how wooded / how wet / how rocky is it here" is asked of a blurred field
// rather than of the cell. Two separable box blurs -- four passes -- which is
// close enough to a gaussian, and the radius is per field: the canopy fields
// fall away over ten metres instead of two and a half.
const FIELD_BLUR = { deep: 3, wet: 3, rock: 3, dense: 2, open: 2 };
const FIELD_OF = {
  deep:  c => c === T_DEEP ? 1 : 0,
  wet:   c => (c === T_DEEP || c === T_MARSH) ? 1 : 0,
  rock:  c => c === T_ROCK ? 1 : 0,
  dense: c => c === T_DENSE ? 1 : (c === T_WOOD ? 0.45 : 0),
  open:  c => c === T_OPEN ? 1 : 0,
};
export function buildFields(zone) {
  const t = zone && zone.terrain; if (!t) return null;
  const F = {};
  for (const [name, f] of Object.entries(FIELD_OF)) {
    const raw = new Float32Array(t.w * t.h);
    for (let gz = 0; gz < t.h; gz++) for (let gx = 0; gx < t.w; gx++) raw[gz * t.w + gx] = f(t.rows[gz][gx] || T_OFF);
    const R = FIELD_BLUR[name], tmp = new Float32Array(t.w * t.h), out = new Float32Array(t.w * t.h);
    const pass = (src, dst, horiz) => {
      for (let gz = 0; gz < t.h; gz++) for (let gx = 0; gx < t.w; gx++) {
        let sum = 0, n = 0;
        for (let d = -R; d <= R; d++) {
          const ix = horiz ? gx + d : gx, iz = horiz ? gz : gz + d;
          if (ix < 0 || ix >= t.w || iz < 0 || iz >= t.h) continue;
          sum += src[iz * t.w + ix]; n++;
        }
        dst[gz * t.w + gx] = n ? sum / n : 0;
      }
    };
    pass(raw, tmp, true); pass(tmp, out, false);
    pass(out, tmp, true); pass(tmp, out, false);
    F[name] = out;
  }
  return F;
}
export function terrainFieldAt(zone, x, z, name) {
  const t = zone && zone.terrain; if (!t) return 0;
  if (!zone._fields) zone._fields = buildFields(zone);
  const g = zone._fields && zone._fields[name]; if (!g) return 0;
  // bilinear between cell CENTRES
  const fx = (x - t.minX) / t.cell - 0.5, fz = (z - t.minZ) / t.cell - 0.5;
  const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
  const at = (ix, iz) => (iz < 0 || iz >= t.h || ix < 0 || ix >= t.w) ? 0 : g[iz * t.w + ix];
  const a = at(x0, z0) * (1 - tx) + at(x0 + 1, z0) * tx;
  const b = at(x0, z0 + 1) * (1 - tx) + at(x0 + 1, z0 + 1) * tx;
  return a * (1 - tz) + b * tz;
}

// --- the levels a zone is built to ------------------------------------------
// Where the shoreline goes, as a contour of the traced wetness field, and where
// rock stops being scenery. Both come from the zone so the drawing, the server
// and the builder cannot hold different numbers.
const WATER_EDGE_FALLBACK = { deep: 0.41, marsh: 0.44, fade: 0.41, blur: 3 };
const ROCK_EDGE_FALLBACK = { rise: 17, walkSlope: 0.84 };
export function waterEdgeOf(zone) { return (zone && zone.waterEdge) || WATER_EDGE_FALLBACK; }
// How far either side of the marsh contour a river's surface takes to rise to
// the body it runs into, in units of the wet field. The field moves about 0.028
// per metre at Murkfen, so this is a ramp four or five metres long rather than
// a step -- see waterLevelAt.
const MARSH_BLEND = 0.06;
const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
export function rockEdgeOf(zone) { return (zone && zone.rockEdge) || ROCK_EDGE_FALLBACK; }
// Rock stands above the land it sits on; water cuts down through it.
export const WATER_CUT = 4.6, MARSH_CUT = 2.0;
// How much rock the drawing puts at (x, z), in metres.
export function rockRiseAt(zone, x, z) {
  const E = rockEdgeOf(zone), f = terrainFieldAt(zone, x, z, 'rock');
  return E.rise * f * f;
}

// --- rivers -----------------------------------------------------------------
export const RIVER_WATER_Y = -0.5, RIVER_BANK = 4, RIVER_LIP = 2.0;
export const LAKE_Y = RIVER_WATER_Y;   // the traced bodies; their basins are faded flat
const RIVER_DEPTH = 1.7;        // surface to bed
const RIVER_BELOW_BANK = 0.9;   // how far the surface sits below the bank top
const RIVER_VALLEY = 17;        // over how far the land settles into the valley
const RIVER_MOUTH = 10;         // over how far a river's level blends to a lake's
// The whole carved channel is flooded, so the water is wider than the drawn line.
export function riverWaterHalf(width) { return width / 2 + RIVER_BANK; }
export function riversOf(zone) { return (zone && (zone.rivers || (zone.river ? [zone.river] : []))) || []; }
export function hillsOf(zone) { return (zone && zone.hills) || []; }

export function distToPolyline(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, az = pts[i].z, bx = pts[i + 1].x, bz = pts[i + 1].z;
    const abx = bx - ax, abz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + abx * t), z - (az + abz * t)));
  }
  return best;
}
// Nearest point on a polyline, with WHERE along it: a river's level varies with
// distance downstream, so the plain distance is not enough.
export function nearestOnPolyline(x, z, pts) {
  let bd = Infinity, bi = 0, bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, az = pts[i].z, bx = pts[i + 1].x, bz = pts[i + 1].z;
    const abx = bx - ax, abz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz || 1)));
    const d = Math.hypot(x - (ax + abx * t), z - (az + abz * t));
    if (d < bd) { bd = d; bi = i; bt = t; }
  }
  return { dist: bd, i: bi, t: bt };
}

// A river runs downhill. Its level used to be one number for the whole map and
// the ground was cut down to it wherever a river passed -- on flat ground that
// is a river, across a hillside a twelve-metre slot with a blue ribbon at the
// bottom. The traced bodies never had the problem because the land fades out
// under them; a river is a polyline with no traced cells, so it got none of it.
export function riverProfile(zone, r) {
  if (r._prof) return r._prof;
  const pts = r.points, n = pts.length;
  const H = riverWaterHalf(r.width) + RIVER_LIP, OFF = H + 4;
  const E = waterEdgeOf(zone);
  // The land either side, read far enough out that the river's own valley has
  // not lowered it, and the lower of the two banks -- water finds the low side.
  const lvl = new Float64Array(n), inBody = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const nx = -dz, nz = dx;
    const bank = Math.min(landBaseY(zone, pts[i].x + nx * OFF, pts[i].z + nz * OFF),
                          landBaseY(zone, pts[i].x - nx * OFF, pts[i].z - nz * OFF));
    inBody[i] = terrainFieldAt(zone, pts[i].x, pts[i].z, 'wet') >= E.marsh ? 1 : 0;
    lvl[i] = inBody[i] ? LAKE_Y : bank - RIVER_BELOW_BANK;
  }
  // A river surface does not step: smooth, but never move a point the lake owns.
  for (let pass = 0; pass < 10; pass++) {
    const s = Float64Array.from(lvl);
    for (let i = 1; i < n - 1; i++) if (!inBody[i]) lvl[i] = (s[i - 1] + 2 * s[i] + s[i + 1]) / 4;
  }
  // ...and it does not flow uphill: walk from the high end to the low one.
  const step = lvl[0] >= lvl[n - 1] ? 1 : -1;
  const from = step === 1 ? 1 : n - 2, to = step === 1 ? n : -1;
  for (let i = from; i !== to; i += step) if (lvl[i] > lvl[i - step]) lvl[i] = lvl[i - step];
  // The monotonic pass does not get to overrule a lake.
  for (let i = 0; i < n; i++) if (inBody[i]) lvl[i] = LAKE_Y;
  r._prof = lvl;
  return lvl;
}
export function riverAt(zone, r, x, z) {
  const c = nearestOnPolyline(x, z, r.points), p = riverProfile(zone, r);
  const a = p[c.i], b = p[Math.min(p.length - 1, c.i + 1)];
  return { dist: c.dist, level: a + (b - a) * c.t };
}
// The level of whatever water covers (x, z): a river's own surface inside its
// corridor, the lake level outside, blended across the mouth so the two meet.
export function waterLevelAt(zone, x, z) {
  let best = null, bd = Infinity, bh = 0;
  for (const r of riversOf(zone)) {
    const c = riverAt(zone, r, x, z);
    if (c.dist < bd) { bd = c.dist; best = c; bh = riverWaterHalf(r.width) + RIVER_LIP; }
  }
  if (!best || bd >= bh + RIVER_MOUTH) return LAKE_Y;
  const k = Math.min(1, Math.max(0, (bh + RIVER_MOUTH - bd) / RIVER_MOUTH));
  const lvl = LAKE_Y + (best.level - LAKE_Y) * (k * k * (3 - 2 * k));
  // Inside a lake or the fen you are standing in the BODY, whatever a stream
  // running past is doing: a river may raise the surface locally, never lower
  // it below the water the drawing already puts there.
  //
  // But that cannot be a SWITCH. `wet` is a smooth blurred field and `>= marsh`
  // is a hard line drawn across it, so the surface jumped the whole difference
  // the instant you crossed the contour. Measured on the spit at Murkfen, where
  // a river runs 1.2 m below the fen: the water level went from -1.77 to -0.50
  // in half a metre, over ground that moved 2 cm. That step is a vertical wall
  // of water standing on the bank -- the sheet hanging in the air with a face
  // on it, which no amount of work on the mesh could fix, because the mesh was
  // drawing exactly what it was told.
  //
  // Blended over a band of the same field instead, so the river's surface rises
  // to meet the body it runs into.
  const t = clamp01((terrainFieldAt(zone, x, z, 'wet') - (waterEdgeOf(zone).marsh - MARSH_BLEND))
                    / (2 * MARSH_BLEND));
  return lvl + Math.max(0, LAKE_Y - lvl) * (t * t * (3 - 2 * t));
}

// --- relief -----------------------------------------------------------------
// The blueprint is a hilly woodland. The zone authors that as a handful of
// broad domes, summed and smoothed.
export function landHeight(zone, x, z) {
  let h = 0;
  for (const k of hillsOf(zone)) {
    const d = Math.hypot(x - k.x, z - k.z);
    if (d >= k.r) continue;
    const t = 1 - d / k.r;
    h += k.h * t * t * (3 - 2 * t);          // smoothstep dome, flat at top and foot
  }
  return h;
}
// The land with no river in it: hills, rock, and the traced water cut. A river
// profile is read off THIS, or a river would lower its own banks and walk its
// level down the map.
export function landBaseY(zone, x, z) {
  if (!zone || zone.enclosed) return 0;
  const wet = terrainFieldAt(zone, x, z, 'wet'), rock = terrainFieldAt(zone, x, z, 'rock');
  const deep = terrainFieldAt(zone, x, z, 'deep');
  const E = waterEdgeOf(zone);
  // Land (and the rock standing on it) fades out completely by the time the
  // wetness reaches the shoreline level. That is what makes "the ground is
  // under the waterline" and "the drawing says water here" the SAME test.
  const LF = Math.max(0, 1 - wet / E.fade);
  let y = LF * (landHeight(zone, x, z) + rockEdgeOf(zone).rise * rock * rock);
  const dFall = Math.log(0.5 / WATER_CUT) / Math.log(E.deep);
  const mFall = Math.log(0.5 / MARSH_CUT) / Math.log(E.marsh);
  y -= WATER_CUT * Math.pow(deep, dFall)
     + MARSH_CUT * Math.max(0, Math.pow(wet, mFall) - Math.pow(deep, mFall));
  return y;
}
// Each pad's level is read off the UNPADDED ground, or the second ruin would be
// levelled against the first one's apron.
function padsOf(zone) {
  if (zone._pads) return zone._pads;
  const pads = ((zone && zone.pads) || []).map(p => ({
    x: (p.minX + p.maxX) / 2, z: (p.minZ + p.maxZ) / 2,
    hw: (p.maxX - p.minX) / 2, hd: (p.maxZ - p.minZ) / 2, fr: p.fr || 16, y: 0 }));
  for (const p of pads) p.y = landBaseY(zone, p.x, p.z);
  zone._pads = pads;
  return pads;
}
export function terrainHeight(zone, x, z) {
  if (!zone || zone.enclosed) return 0;
  let y = landBaseY(zone, x, z);
  // Rivers cut their own valley. Only ever DOWNWARD: where a river runs through
  // ground already lower than its bed (the fen), the fen wins and the river
  // becomes part of it, which is what the drawing shows.
  for (const r of riversOf(zone)) {
    const half = riverWaterHalf(r.width), H = half + RIVER_LIP;
    const c = riverAt(zone, r, x, z);
    if (c.dist >= H + RIVER_VALLEY) continue;
    const top = c.level + RIVER_BELOW_BANK;
    let prof;
    if (c.dist <= half) prof = c.level - RIVER_DEPTH * (1 - Math.pow(c.dist / half, 3));
    else if (c.dist <= H) prof = c.level + (top - c.level) * ((c.dist - half) / RIVER_LIP);
    else prof = top;
    const k = Math.min(1, Math.max(0, (H + RIVER_VALLEY - c.dist) / RIVER_VALLEY));
    y += (Math.min(prof, y) - y) * (k * k * (3 - 2 * k));
  }
  // A ruin you can walk into needs a level floor.
  for (const p of padsOf(zone)) {
    const dx = Math.abs(x - p.x) - p.hw, dz = Math.abs(z - p.z) - p.hd;
    if (dx >= p.fr || dz >= p.fr) continue;
    const d = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
    if (d >= p.fr) continue;
    const t = 1 - d / p.fr;
    y += (p.y - y) * (t * t * (3 - 2 * t));
  }
  return y;
}

// --- the surface that is actually DRAWN -------------------------------------
// terrainHeight is a continuous function; the ground MESH samples it on a
// lattice and draws triangles between. They are not the same surface, and
// anything standing on the ground has to follow the triangles -- the function
// dips below them in every hollow. The lattice comes from the zone's bounds, so
// this is the drawn height whether you are the renderer or the server.
export function latticeOf(zone) {
  if (zone._lattice) return zone._lattice;
  const b = zone.bounds;
  const W = b.maxX - b.minX, D = b.maxZ - b.minZ;
  const seg = Math.max(24, Math.round(Math.max(W, D) / (zone.enclosed ? 6 : 2.5)));
  const L = { minX: b.minX, minZ: b.minZ, dx: W / seg, dz: D / seg, nx: seg, nz: seg,
              h: new Float32Array((seg + 1) * (seg + 1)).fill(NaN) };
  zone._lattice = L;
  return L;
}
function latticeY(zone, L, i, j) {
  const k = j * (L.nx + 1) + i;
  let v = L.h[k];
  if (v !== v) { v = terrainHeight(zone, L.minX + i * L.dx, L.minZ + j * L.dz); L.h[k] = v; }
  return v;
}
export function groundMeshY(zone, x, z) {
  if (!zone || !zone.bounds) return terrainHeight(zone, x, z);
  const L = latticeOf(zone);
  const fx = (x - L.minX) / L.dx, fz = (z - L.minZ) / L.dz;
  const i = Math.max(0, Math.min(L.nx - 1, Math.floor(fx)));
  const j = Math.max(0, Math.min(L.nz - 1, Math.floor(fz)));
  const u = fx - i, v = fz - j;
  // three.js PlaneGeometry splits each quad (a,b,d)(b,c,d) with the diagonal
  // running from (i, j+1) to (i+1, j) -- the line u + v = 1.
  if (u + v <= 1) {
    const h00 = latticeY(zone, L, i, j);
    return h00 + u * (latticeY(zone, L, i + 1, j) - h00) + v * (latticeY(zone, L, i, j + 1) - h00);
  }
  const h11 = latticeY(zone, L, i + 1, j + 1);
  return h11 + (1 - u) * (latticeY(zone, L, i, j + 1) - h11) + (1 - v) * (latticeY(zone, L, i + 1, j) - h11);
}

// --- how steep is it? -------------------------------------------------------
// What stops a person is STEEPNESS, not what the ground is made of. Blocking on
// the rock field instead meant 47% of everything that blocked was gentler than
// 30 degrees and 735 cells of it were flat: a grassy mound you walked into like
// a wall. The gradient is measured on the DRAWN surface over one lattice step,
// which is the slope you can see.
export function groundSlopeAt(zone, x, z) {
  const L = zone && zone.bounds ? latticeOf(zone) : null;
  const hx = L ? L.dx : 1.25, hz = L ? L.dz : 1.25;
  const dy_dx = (groundMeshY(zone, x + hx, z) - groundMeshY(zone, x - hx, z)) / (2 * hx);
  const dy_dz = (groundMeshY(zone, x, z + hz) - groundMeshY(zone, x, z - hz)) / (2 * hz);
  return Math.hypot(dy_dx, dy_dz);        // rise over run; tan of the angle
}
// The steepest ground you can walk up, as rise over run. 0.84 is 40 degrees --
// a scramble, but not a wall; the zone's own terrain has 1,821 cells between 30
// and 40 degrees and 1,312 between 40 and 50, so this is the shoulder of the
// rock rather than an arbitrary line. It lives on the zone beside `rise`,
// because those two numbers together are what a cliff IS.
export const MAX_WALK_SLOPE = 0.84;
export function walkSlopeOf(zone) {
  const w = rockEdgeOf(zone).walkSlope;
  return w > 0 ? w : MAX_WALK_SLOPE;
}
export function tooSteep(zone, x, z, limit) {
  return groundSlopeAt(zone, x, z) > (limit != null ? limit : walkSlopeOf(zone));
}

// Throw away everything cached on a zone (the fields, the pads, the lattice and
// every river's profile). Call it if a zone's terrain is edited in place.
export function resetTerrain(zone) {
  if (!zone) return;
  zone._fields = null; zone._pads = null; zone._lattice = null;
  for (const r of riversOf(zone)) r._prof = null;
}

// ---------------------------------------------------------------------------
// The boardwalk's footprint: where the planks are, and where you can stand.
// ---------------------------------------------------------------------------
// One rectangle, both sides. It was two, and they disagreed: the client's
// standable patch was len + 0.3 by w - 0.3 while the server's "dry feet" test
// was len by w. So a 15 cm strip inside each railing was deck to the server
// and open water to the client, and 15 cm at each end was the reverse -- you
// could only walk the intersection, and the railings read as fencing you in.
//
// DECK_TOP matches DECK_Y in tools/build_wetland.py: the top of the planks
// above the piece's own origin, which for this kit is the water line.
export const DECK_TOP = 0.55;
// The rail posts stand at w/2 - 0.1 and are 0.14 thick, so their inner face is
// 0.17 in from the plank edge. That, not the plank edge, is how wide the walk
// actually is -- which is the difference between a rail you walk beside and a
// rail you walk into.
export const DECK_POST_INSET = 0.17;
// Spans are laid 3.9 m apart and are 4 m long, so they already overlap; the
// seam allowance closes the joint for a body crossing it rather than a point.
export const DECK_SEAM = 0.15;
// Is (x, z) on this span's planks? `grow` widens it for the callers that ask a
// softer question (the swim test allows a little footing past the boards).
export function onDeckSpan(d, x, z, grow = 0) {
  const dx = x - d.x, dz = z - d.z;
  const sn = Math.sin(d.yaw || 0), cs = Math.cos(d.yaw || 0);
  const along = dx * cs + dz * sn, across = -dx * sn + dz * cs;
  return Math.abs(along) <= (d.len || 4) / 2 + DECK_SEAM + grow
      && Math.abs(across) <= (d.w || 2.4) / 2 - DECK_POST_INSET + grow;
}
