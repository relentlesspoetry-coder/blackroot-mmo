// Blackroot — fog of war: which ground a player has actually seen.
//
// This module is imported by the server directly and by the client over HTTP,
// for the reason every other shared module exists here: the server decides what
// is revealed and the client draws it, and two copies of the grid maths would
// put the fog somewhere other than where you walked. One grid, one index, one
// encoding.
//
// The state is a bitset over a coarse grid laid on the zone's bounds. It is
// per player and it is saved, so the map you come back to is the map you left.

// Metres per cell. Small enough that the revealed edge follows a road rather
// than a staircase, big enough that a zone's worth of bits is a kilobyte:
// Blackroot is 1690 x 962, which comes to 212 x 121 cells -- 3.2 KB of bits,
// sent once when you enter and saved as base64.
export const FOG_CELL = 8;

// How far you can see here. Not a number invented for the fog: it is the zone's
// own fogNear, the distance at which the world starts washing out into the
// atmosphere, which is exactly the ground you can be said to have looked at.
// That makes the woods reveal 60 m at a time and the Spider Den 12 -- a cave
// explored at torchlight range, without anybody tuning a second constant.
export const DEFAULT_SIGHT = 60;
export function sightOf(zone) {
  const n = zone && zone.env && zone.env.fogNear;
  return n > 0 ? n : DEFAULT_SIGHT;
}

// The grid for a zone, derived from its bounds. Both sides call this rather
// than passing dimensions around, so a zone whose bounds change gets a new grid
// on both sides at once.
export function fogDims(zone) {
  const b = zone.bounds;
  return {
    cell: FOG_CELL, minX: b.minX, minZ: b.minZ,
    w: Math.max(1, Math.ceil((b.maxX - b.minX) / FOG_CELL)),
    h: Math.max(1, Math.ceil((b.maxZ - b.minZ) / FOG_CELL)),
  };
}
export function fogBytes(d) { return Math.ceil((d.w * d.h) / 8); }
export function newFog(d) { return new Uint8Array(fogBytes(d)); }

export function fogCellOf(d, x, z) {
  const gx = Math.floor((x - d.minX) / d.cell), gz = Math.floor((z - d.minZ) / d.cell);
  if (gx < 0 || gz < 0 || gx >= d.w || gz >= d.h) return -1;
  return gz * d.w + gx;
}
export function fogHas(bits, i) {
  return i >= 0 && (bits[i >> 3] & (1 << (i & 7))) !== 0;
}
// Returns true only when this call is what set the bit, so callers can collect
// exactly the cells that are newly revealed and send those.
export function fogSet(bits, i) {
  if (i < 0) return false;
  const byte = i >> 3, mask = 1 << (i & 7);
  if (bits[byte] & mask) return false;
  bits[byte] |= mask;
  return true;
}

// Reveal a disc of ground and report what it uncovered. The disc is walked in
// cell space, so the cost is the area of the sight radius in cells and not the
// size of the zone: 60 m at 8 m a cell is about 177 cells, and only the handful
// on the leading edge come back as new.
export function revealDisc(d, bits, x, z, radius) {
  const fresh = [];
  const r = Math.max(1, Math.ceil(radius / d.cell));
  const cx = Math.floor((x - d.minX) / d.cell), cz = Math.floor((z - d.minZ) / d.cell);
  for (let gz = cz - r; gz <= cz + r; gz++) {
    if (gz < 0 || gz >= d.h) continue;
    for (let gx = cx - r; gx <= cx + r; gx++) {
      if (gx < 0 || gx >= d.w) continue;
      const dx = gx - cx, dz = gz - cz;
      if (dx * dx + dz * dz > r * r) continue;          // a disc, not a square
      const i = gz * d.w + gx;
      if (fogSet(bits, i)) fresh.push(i);
    }
  }
  return fresh;
}

// Base64, written once for both runtimes. The server saves and sends it; the
// browser only ever decodes.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function fogToB64(bits) {
  let out = '';
  for (let i = 0; i < bits.length; i += 3) {
    const a = bits[i], b = i + 1 < bits.length ? bits[i + 1] : 0, c = i + 2 < bits.length ? bits[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)]
        + (i + 1 < bits.length ? B64[((b & 15) << 2) | (c >> 6)] : '=')
        + (i + 2 < bits.length ? B64[c & 63] : '=');
  }
  return out;
}
export function fogFromB64(str, bytes) {
  const out = new Uint8Array(bytes);
  if (typeof str !== 'string') return out;
  let o = 0, acc = 0, n = 0;
  for (const ch of str) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;                                 // '=' and any stray
    acc = (acc << 6) | v; n += 6;
    if (n >= 8) { n -= 8; if (o < bytes) out[o++] = (acc >> n) & 255; }
  }
  return out;
}

// --- places -----------------------------------------------------------------
// Which region of a zone a point is in. The client had this as currentRegion()
// to title the map and announce a crossing, and the server needed the same
// answer to decide what counts as discovered -- two copies of one containment
// rule, which is how the map comes to disagree with the world about where you
// are standing. One rule, both callers.
//
// Null when the zone has no regions at all: the caller decides what that means
// (the server treats the zone itself as the place, the client falls back to
// announcing the zone).
export function regionAt(zone, x, z, y) {
  const regs = zone && zone.regions;
  if (!regs || !regs.length) return null;
  // Below the surface you are in the zone's underground region whatever the
  // footprint above you says -- a cave's outline overlaps the wood on top of it.
  if (y != null && y < -6) { const u = regs.find(r => r.underground); if (u) return u; }
  return regs.find(r => !r.underground && x >= r.bounds.minX && x <= r.bounds.maxX
                                       && z >= r.bounds.minZ && z <= r.bounds.maxZ) || regs[0];
}
