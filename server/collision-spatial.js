// Broad phase for generated, static circle scenery. Live editor objects are
// deliberately not cached. prepareZone replaces its generated arrays; callers
// editing generated objects in place must invalidate their array afterwards.
const CELL = 16, MAX_CELLS = 4096;
const indexes = new WeakMap();

export function invalidateSceneryArray(objects) {
  if (objects) indexes.delete(objects);
}

function build(objects, radiusOf) {
  const cells = new Map(), overflow = [];
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i], r = radiusOf(o);
    if (r === null) continue; // non-solid scatter
    const x0 = Math.floor((o.x - r) / CELL), x1 = Math.floor((o.x + r) / CELL);
    const z0 = Math.floor((o.z - r) / CELL), z1 = Math.floor((o.z + r) / CELL);
    // Exotic/huge obstacles stay in the candidate stream without allocating
    // unbounded grids. Their exact narrow-phase semantics are unchanged.
    if (!Number.isFinite(o.x) || !Number.isFinite(o.z) ||
        !Number.isFinite(x0 + x1 + z0 + z1) || r < 0 ||
        !Number.isSafeInteger(x0) || !Number.isSafeInteger(x1) ||
        !Number.isSafeInteger(z0) || !Number.isSafeInteger(z1) ||
        (x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELLS) {
      overflow.push(i); continue;
    }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const key = `${x},${z}`;
      let bucket = cells.get(key);
      if (!bucket) cells.set(key, bucket = []);
      bucket.push(i);
    }
  }
  return { length: objects.length, radiusOf, cells, overflow };
}

function nearby(index, x, z, radius, after) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius)) return null;
  // Expand slightly to make boundary rounding conservative. False positives
  // are harmless: collision.js still applies the original exact circle test.
  const pad = radius + 1e-7;
  const x0 = Math.floor((x - pad) / CELL), x1 = Math.floor((x + pad) / CELL);
  const z0 = Math.floor((z - pad) / CELL), z1 = Math.floor((z + pad) / CELL);
  if (!Number.isFinite(x0 + x1 + z0 + z1) || radius < 0 ||
      !Number.isSafeInteger(x0) || !Number.isSafeInteger(x1) ||
      !Number.isSafeInteger(z0) || !Number.isSafeInteger(z1) ||
      (x1 - x0 + 1) * (z1 - z0 + 1) > MAX_CELLS) return null;
  const found = new Set(index.overflow.filter(i => i > after));
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const bucket = index.cells.get(`${cx},${cz}`);
    if (bucket) for (const i of bucket) if (i > after) found.add(i);
  }
  return [...found].sort((a, b) => a - b);
}

// Preserve the old single forward pass, including cascades: after a push,
// query from the NEW position but only consider indices not yet passed. A
// once-per-call query misses later objects reached by earlier collisions;
// repeatedly resolving every neighbor incorrectly revisits earlier objects.
export function* sceneryCandidates(objects, ent, radius, radiusOf) {
  if (!objects) return;
  let index = indexes.get(objects);
  if (!index || index.length !== objects.length || index.radiusOf !== radiusOf) {
    index = build(objects, radiusOf);
    indexes.set(objects, index);
  }
  let after = -1;
  while (after < objects.length - 1) {
    const candidates = nearby(index, ent.x, ent.z, radius, after);
    if (candidates === null) {
      for (let i = after + 1; i < objects.length; i++) yield objects[i];
      return;
    }
    let moved = false;
    for (const i of candidates) {
      const x = ent.x, z = ent.z;
      after = i;
      yield objects[i];
      if (ent.x !== x || ent.z !== z) { moved = true; break; }
    }
    if (!moved) return;
  }
}
