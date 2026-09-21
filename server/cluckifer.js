// Blackroot — Cluckifer, the secret chicken boss.
//
// A giant black chicken with red plumage that has a 1-in-300 chance to burst
// out of any chicken a player kills. Level 10, two phases, a signature set of
// mechanics and an ultimate. Everything here is authoritative: the boss runs a
// scripted action queue (each ability is a list of timed steps), hazards are
// server objects that hurt players standing in them, and every visual is a
// `boss` event the client turns into animation + VFX.
//
// The server hands this module a context (ctx) with the handful of world
// functions it needs, so the boss stays self-contained.

export const CLUCKIFER_CHANCE = 300;   // 1 in N chicken kills

export const BOSS_TEMPLATES = {
  // (templates are level-scaled like every monster: at level 10 this is ~1600 hp, ~2900 xp)
  cluckifer: { name: 'Cluckifer', hp: 430, dmg: [8, 16], speed: 6.0, aggro: 26, xp: 700, respawn: 999999, boss: 'cluckifer',
    attackSpeed: 4, rolls: 4,
    loot: [ { item: 'Coins', min: 300, max: 900, w: 40 }, { item: 'Hellfeather', min: 2, max: 6, w: 40 }, { item: 'Infernal Egg', min: 1, max: 3, w: 30 },
            { item: 'Cluckifer’s Talon', w: 6 }, { item: 'Brimstone Comb', w: 4 } ] },
  hell_chick:  { name: 'Hellspawn Chick', hp: 12, dmg: [3, 6], speed: 7.5, aggro: 30, xp: 14, respawn: 999999, minion: 'chick', attackSpeed: 3 },
  brood_chick: { name: 'Sacrificial Chick', hp: 14, dmg: [1, 1], speed: 3.2, aggro: 0, xp: 12, respawn: 999999, minion: 'brood', passive: true },
  ruin_egg:    { name: 'Egg of Ruin', hp: 18, dmg: [1, 1], speed: 0, aggro: 0, xp: 10, respawn: 999999, minion: 'ruin_egg', passive: true },
  rotten_egg:  { name: 'Rotten Egg', hp: 36, dmg: [1, 1], speed: 0, aggro: 0, xp: 30, respawn: 999999, minion: 'rotten_egg', passive: true },
};
export const BOSS_ITEMS = {
  'Hellfeather':        { value: 120, desc: 'A feather that is still smouldering. It never quite goes out.' },
  'Infernal Egg':       { value: 90, heal: 60, desc: 'Warm. Very warm. Tastes of brimstone and, somehow, chicken.' },
  'Cluckifer’s Talon': { slot: 'weapon', atk: 17, level: 8, tier: 5, rarity: 'Legendary', value: 3200, model: '16_Twin_Claws', len: 0.55,
    desc: 'A talon torn from the Devil Chicken. It scratches at the air on its own.' },
  'Brimstone Comb':     { slot: 'helmet', def: 9, atk: 4, level: 8, tier: 5, rarity: 'Legendary', value: 3600, gear: '18_Ember_Sorcerer__Helmet',
    desc: 'Cluckifer’s crimson crest, worn as a crown. It smoulders in the dark.' },
};

const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- spawning
export function maybeSpawnCluckifer(ctx, chicken, killer) {
  if (Math.random() * CLUCKIFER_CHANCE >= 1) return null;
  for (const m of ctx.monsters.values()) if (m.boss === 'cluckifer' && m.alive) return null;   // one at a time
  const boss = ctx.makeMonster({ zoneId: chicken.zoneId, type: 'cluckifer', level: 10, region: { cx: chicken.x, cz: chicken.z, r: 0.1 }, respawn: 999999 });
  boss.boss = 'cluckifer'; boss.elite = true; boss.provoked = true; boss.targetId = killer ? killer.id : null; boss.state = 'combat';
  boss.arena = { x: chicken.x, z: chicken.z, r: 26 };
  boss.cds = {}; boss.script = null; boss.gcd = 2.0; boss.phase = 1; boss.ultDone = false; boss.stunT = 0; boss.untargetable = false; boss.vulnerable = 0;
  boss.spawnedFrom = chicken.id;
  ctx.broadcast({ t: 'event', kind: 'boss', id: boss.id, fx: 'arrive', x: boss.x, z: boss.z });
  ctx.systemChat('The chicken’s corpse splits open. Something enormous, black and burning claws its way out: CLUCKIFER has come.');
  return boss;
}

// ---------------------------------------------------------------- hazards
// Fire / poison patches players are hurt standing in. Live in zone._bossHazards.
export function addHazard(ctx, zone, h) {
  zone._bossHazards = zone._bossHazards || [];
  h.id = ctx.nextId(); zone._bossHazards.push(h);
  ctx.broadcast({ t: 'event', kind: 'boss', fx: 'hazard', id: h.id, x: +h.x.toFixed(2), z: +h.z.toFixed(2), r: h.r, kind2: h.kind, dur: h.t });
  return h;
}
export function stepHazards(ctx, zone, dt) {
  const list = zone._bossHazards; if (!list || !list.length) return;
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i]; h.t -= dt;
    if (h.t <= 0) { list.splice(i, 1); continue; }
    if (h.delay > 0) { h.delay -= dt; continue; }   // a telegraphed patch that hasn't lit yet
    for (const p of ctx.players.values()) {
      if (!p.alive || p.zoneId !== zone.id) continue;
      if (ctx.dist2(p.x, p.z, h.x, h.z) > h.r * h.r) continue;
      p._hazAcc = (p._hazAcc || 0) + h.dps * dt;
      if (p._hazAcc >= 1) { const d = Math.floor(p._hazAcc); p._hazAcc -= d; ctx.hurtPlayer(p, d, null, h.kind === 'poison' ? 'poison' : 'burn'); }
    }
  }
}
export function hazardList(zone) { return (zone._bossHazards || []).map(h => ({ id: h.id, x: +h.x.toFixed(1), z: +h.z.toFixed(1), r: h.r, k: h.kind, t: +h.t.toFixed(1) })); }

// ---------------------------------------------------------------- helpers
function playersNear(ctx, m, r) {
  const out = [];
  for (const p of ctx.players.values()) if (p.alive && p.zoneId === m.zoneId && ctx.dist2(p.x, p.z, m.x, m.z) <= r * r) out.push(p);
  return out;
}
function playersInCone(ctx, m, yaw, halfAngle, r) {
  return playersNear(ctx, m, r).filter(p => Math.abs(wrap(Math.atan2(p.x - m.x, p.z - m.z) - yaw)) <= halfAngle);
}
function playersInLane(ctx, m, yaw, len, halfW) {
  const out = [];
  for (const p of ctx.players.values()) {
    if (!p.alive || p.zoneId !== m.zoneId) continue;
    const dx = p.x - m.x, dz = p.z - m.z, along = dx * Math.sin(yaw) + dz * Math.cos(yaw), across = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    if (along > 0 && along < len && Math.abs(across) < halfW) out.push(p);
  }
  return out;
}
function knockback(ctx, zone, p, fromX, fromZ, dist) {
  const dx = p.x - fromX, dz = p.z - fromZ, d = Math.hypot(dx, dz) || 1;
  const tx = p.x + (dx / d) * dist, tz = p.z + (dz / d) * dist;
  const probe = { x: tx, z: tz, y: p.y || 0 }; ctx.resolveCollision(zone, probe, 0.45);
  p.x = probe.x; p.z = probe.z; p.moveTo = null; p._nav = null;
  ctx.send(p.ws, { t: 'event', kind: 'boss', fx: 'knock', x: p.x, z: p.z });
}
function target(ctx, m) {
  let t = m.targetId ? ctx.players.get(m.targetId) : null;
  if (t && (!t.alive || t.zoneId !== m.zoneId)) t = null;
  if (!t) { let best = null, bd = 1e9; for (const p of ctx.players.values()) { if (!p.alive || p.zoneId !== m.zoneId) continue; const d = ctx.dist2(p.x, p.z, m.x, m.z); if (d < bd) { bd = d; best = p; } } t = best; m.targetId = t ? t.id : null; }
  return t;
}
function face(m, p) { if (p) m.yaw = Math.atan2(p.x - m.x, p.z - m.z); }
function bossFx(ctx, m, fx, extra = {}) { ctx.broadcast({ t: 'event', kind: 'boss', id: m.id, fx, x: +m.x.toFixed(2), z: +m.z.toFixed(2), yaw: +m.yaw.toFixed(3), ...extra }); }
function inArena(m, x, z) { return Math.hypot(x - m.arena.x, z - m.arena.z) <= m.arena.r; }
function arenaPoint(m, minR = 3) { const a = rand(0, Math.PI * 2), r = minR + Math.sqrt(Math.random()) * (m.arena.r - minR); return { x: m.arena.x + Math.cos(a) * r, z: m.arena.z + Math.sin(a) * r }; }
function spawnMinion(ctx, m, type, x, z, extra = {}) {
  const c = ctx.makeMonster({ zoneId: m.zoneId, type, level: type === 'rotten_egg' ? 10 : 6, region: { cx: x, cz: z, r: 0.1 }, respawn: 999999 });
  c.minion = BOSS_TEMPLATES[type].minion; c.ownerId = m.id; c.provoked = true; c.life = extra.life || 0; c.state = 'combat';
  Object.assign(c, extra);
  bossFx(ctx, m, 'minion', { mid: c.id, type, mx: +x.toFixed(2), mz: +z.toFixed(2) });
  return c;
}
function hit(ctx, m, p, dmg, kind) { if (!p || !p.alive) return 0; const d = Math.max(1, Math.round(dmg * ctx.incomingMult(p))); ctx.hurtPlayer(p, d, m, kind); return d; }
function heal(ctx, m, n) { m.hp = Math.min(m.maxHp, m.hp + n); bossFx(ctx, m, 'heal', { n: Math.round(n) }); }

// ---------------------------------------------------------------- the mechanics
// Each returns a script: [{ at: seconds, do: fn }] run from when it starts.
// `busy` is how long the boss stands committed to it.
const M = {};
M.hell_peck = (ctx, m, t) => ({ busy: 0.9, cd: 4, steps: [
  { at: 0, do: () => { face(m, t); bossFx(ctx, m, 'hell_peck'); } },
  { at: 0.45, do: () => { for (const p of playersInCone(ctx, m, m.yaw, 0.6, 4.2)) hit(ctx, m, p, 18, 'peck'); } },
] });
M.wing = (ctx, m, t) => ({ busy: 1.4, cd: 12, steps: [
  { at: 0, do: () => { face(m, t); bossFx(ctx, m, 'wing', { r: 7 }); } },
  { at: 0.8, do: () => { for (const p of playersInCone(ctx, m, m.yaw, 1.05, 7)) { hit(ctx, m, p, 14, 'wing'); knockback(ctx, ctx.zoneOf(m), p, m.x, m.z, 6); } } },
] });
M.scratch = (ctx, m, t) => ({ busy: 1.3, cd: 9, steps: [
  { at: 0, do: () => { face(m, t); bossFx(ctx, m, 'scratch'); } },
  { at: 0.35, do: () => { for (const p of playersInCone(ctx, m, m.yaw, 0.7, 4)) hit(ctx, m, p, 7, 'scratch'); } },
  { at: 0.6, do: () => { for (const p of playersInCone(ctx, m, m.yaw, 0.7, 4)) hit(ctx, m, p, 7, 'scratch'); } },
  { at: 0.85, do: () => { for (const p of playersInCone(ctx, m, m.yaw, 0.7, 4)) { hit(ctx, m, p, 8, 'scratch'); ctx.addDot(p, 'bleed', 5, 3); } } },
] });
M.fire_egg = (ctx, m, t) => { const at = t ? { x: t.x, z: t.z } : arenaPoint(m); return { busy: 1.0, cd: 14, steps: [
  { at: 0, do: () => { face(m, t); bossFx(ctx, m, 'fire_egg', { tx: +at.x.toFixed(2), tz: +at.z.toFixed(2), delay: 1.6 }); } },
  { at: 1.6, do: () => { for (const p of ctx.players.values()) if (p.alive && p.zoneId === m.zoneId && ctx.dist2(p.x, p.z, at.x, at.z) < 9) hit(ctx, m, p, 20, 'burn');
    addHazard(ctx, ctx.zoneOf(m), { x: at.x, z: at.z, r: 2.6, t: 9, dps: 5, kind: 'fire' }); bossFx(ctx, m, 'egg_burst', { tx: +at.x.toFixed(2), tz: +at.z.toFixed(2), r: 3 }); } },
] }; };
M.demon_cluck = (ctx, m, t) => ({ busy: 1.8, cd: 18, steps: [
  { at: 0, do: () => bossFx(ctx, m, 'demon_cluck', { r: 9 }) },
  { at: 1.0, do: () => { for (const p of playersNear(ctx, m, 9)) { hit(ctx, m, p, 15, 'screech'); ctx.addSlow(p, 3, 0.55); } } },
] });
M.chicks = (ctx, m, t) => ({ busy: 1.2, cd: 30, steps: [
  { at: 0, do: () => bossFx(ctx, m, 'summon') },
  { at: 0.7, do: () => { for (let i = 0; i < 3; i++) { const a = m.yaw + (i - 1) * 0.9; spawnMinion(ctx, m, 'hell_chick', m.x + Math.sin(a) * 3, m.z + Math.cos(a) * 3, { life: 9 }); } } },
] });
M.barrage = (ctx, m, t) => { const lanes = []; const base = t ? Math.atan2(t.x - m.x, t.z - m.z) : m.yaw; for (let i = -3; i <= 3; i++) { if (i === -1 || i === 2) continue; lanes.push(base + i * 0.42); }   // gaps to dodge through
  return { busy: 2.0, cd: 20, steps: [
    { at: 0, do: () => { face(m, t); bossFx(ctx, m, 'barrage', { lanes: lanes.map(a => +a.toFixed(3)), len: 15, delay: 1.2 }); } },
    { at: 1.2, do: () => { for (const a of lanes) { for (const p of playersInLane(ctx, m, a, 15, 1.4)) hit(ctx, m, p, 16, 'burn'); for (let d = 5; d <= 14; d += 4.5) addHazard(ctx, ctx.zoneOf(m), { x: m.x + Math.sin(a) * d, z: m.z + Math.cos(a) * d, r: 1.6, t: 5, dps: 4, kind: 'fire' }); } } },
  ] }; };
M.rush = (ctx, m, t) => { const dir = t ? Math.atan2(t.x - m.x, t.z - m.z) : m.yaw; const zone = ctx.zoneOf(m); const hitIds = new Set(); let stunned = false;
  const steps = [{ at: 0, do: () => { m.yaw = dir; bossFx(ctx, m, 'rush', { dir: +dir.toFixed(3) }); } }];
  for (let k = 1; k <= 24; k++) steps.push({ at: 0.5 + k * 0.05, do: () => {
    if (stunned) return;
    const nx = m.x + Math.sin(dir) * 1.1, nz = m.z + Math.cos(dir) * 1.1;
    const probe = { x: nx, z: nz, y: 0 }; ctx.resolveCollision(zone, probe, 1.2);
    if (Math.hypot(probe.x - nx, probe.z - nz) > 0.2 || !inArena(m, nx, nz)) { stunned = true; m.stunT = 3.0; bossFx(ctx, m, 'stunned', { t: 3 }); return; }   // hit a wall / the arena's edge
    m.x = probe.x; m.z = probe.z;
    for (const p of playersNear(ctx, m, 2.4)) if (!hitIds.has(p.id)) { hitIds.add(p.id); hit(ctx, m, p, 20, 'rush'); knockback(ctx, zone, p, m.x, m.z, 4); }
  } });
  return { busy: 1.9, cd: 22, steps }; };
M.eggs_of_ruin = (ctx, m, t) => ({ busy: 1.2, cd: 35, steps: [
  { at: 0, do: () => bossFx(ctx, m, 'lay') },
  { at: 0.8, do: () => { for (let i = 0; i < 3; i++) { const p = arenaPoint(m, 4); spawnMinion(ctx, m, 'ruin_egg', p.x, p.z, { life: 6 }); } } },
] });
M.roost = (ctx, m, t) => { const at = t ? { x: t.x, z: t.z } : arenaPoint(m); return { busy: 2.4, cd: 25, steps: [
  { at: 0, do: () => { face(m, t); bossFx(ctx, m, 'roost_jump', { tx: +at.x.toFixed(2), tz: +at.z.toFixed(2), r: 6.5, delay: 2.0 }); m.untargetable = true; } },
  { at: 2.0, do: () => { m.x = at.x; m.z = at.z; m.untargetable = false; bossFx(ctx, m, 'roost_land', { r: 6.5 });
    for (const p of playersNear(ctx, m, 6.5)) { hit(ctx, m, p, 30, 'slam'); knockback(ctx, ctx.zoneOf(m), p, m.x, m.z, 3); }
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; addHazard(ctx, ctx.zoneOf(m), { x: at.x + Math.cos(a) * 5, z: at.z + Math.sin(a) * 5, r: 2.2, t: 8, dps: 5, kind: 'fire' }); } } },
] }; };
M.chicken_run = (ctx, m, t) => { const zone = ctx.zoneOf(m); let dir = rand(0, Math.PI * 2); const steps = [{ at: 0, do: () => bossFx(ctx, m, 'run_start', { t: 5 }) }]; let trailT = 0;
  for (let k = 1; k <= 100; k++) steps.push({ at: k * 0.05, do: () => {
    const sp = 9 * 0.05; let nx = m.x + Math.sin(dir) * sp, nz = m.z + Math.cos(dir) * sp;
    const probe = { x: nx, z: nz, y: 0 }; ctx.resolveCollision(zone, probe, 1.2);
    if (Math.hypot(probe.x - nx, probe.z - nz) > 0.05 || !inArena(m, nx, nz)) { dir = wrap(dir + Math.PI + rand(-0.9, 0.9)); bossFx(ctx, m, 'bounce'); return; }   // bounce off
    m.x = probe.x; m.z = probe.z; m.yaw = dir;
    trailT += 0.05; if (trailT >= 0.45) { trailT = 0; addHazard(ctx, zone, { x: m.x, z: m.z, r: 1.7, t: 6, dps: 4, kind: 'fire' }); }
    for (const p of playersNear(ctx, m, 2.2)) if (!p._runHitT || p._runHitT < Date.now() - 800) { p._runHitT = Date.now(); hit(ctx, m, p, 8, 'rush'); knockback(ctx, zone, p, m.x, m.z, 2.5); }
  } });
  steps.push({ at: 5.1, do: () => bossFx(ctx, m, 'run_end') });
  return { busy: 5.2, cd: 45, steps }; };
M.peckening = (ctx, m, t) => { if (!t) return null; const zone = ctx.zoneOf(m); const steps = [{ at: 0, do: () => bossFx(ctx, m, 'mark', { pid: t.id, t: 3.4 }) }];
  for (let k = 0; k < 4; k++) steps.push({ at: 0.8 + k * 0.7, do: () => {
    if (!t.alive) return;
    const a = Math.atan2(t.x - m.x, t.z - m.z); const lx = t.x - Math.sin(a) * 2.2, lz = t.z - Math.cos(a) * 2.2;
    const from = { x: m.x, z: m.z }; m.x = lx; m.z = lz; m.yaw = a; ctx.resolveCollision(zone, m, 1.2);
    bossFx(ctx, m, 'lunge', { fx0: +from.x.toFixed(2), fz0: +from.z.toFixed(2) });
    const inReach = ctx.dist2(t.x, t.z, m.x, m.z) < 3.4 * 3.4 && Math.abs(wrap(Math.atan2(t.x - m.x, t.z - m.z) - m.yaw)) < 0.7;
    if (inReach) hit(ctx, m, t, 12, 'peck');
    else { bossFx(ctx, m, 'miss_blast', { r: 2.4 }); for (const p of playersNear(ctx, m, 2.4)) hit(ctx, m, p, 6, 'burn'); }
  } });
  return { busy: 3.6, cd: 40, steps }; };
M.rotten_egg = (ctx, m, t) => ({ busy: 1.0, cd: 50, steps: [
  { at: 0, do: () => bossFx(ctx, m, 'lay') },
  { at: 0.7, do: () => { const p = arenaPoint(m, 5); spawnMinion(ctx, m, 'rotten_egg', p.x, p.z, { life: 11, grow: 0 }); } },
] });
M.brood = (ctx, m, t) => ({ busy: 1.2, cd: 55, steps: [
  { at: 0, do: () => bossFx(ctx, m, 'summon', { brood: true }) },
  { at: 0.7, do: () => { for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4; spawnMinion(ctx, m, 'brood_chick', m.x + Math.sin(a) * 11, m.z + Math.cos(a) * 11, { life: 0 }); } } },
] });
// phase 2
M.molt = (ctx, m, t) => { const zone = ctx.zoneOf(m); return { busy: 1.4, cd: 30, steps: [
  { at: 0, do: () => bossFx(ctx, m, 'molt') },
  { at: 0.6, do: () => { for (let i = 0; i < 9; i++) { const p = arenaPoint(m, 2); const h = addHazard(ctx, zone, { x: p.x, z: p.z, r: 2.0, t: 11, dps: 4, kind: 'fire', delay: 1.2 }); } } },
] }; };
M.crow = (ctx, m, t) => { const gaps = [rand(0, Math.PI * 2), rand(0, Math.PI * 2)]; const ring = (r) => () => { for (const p of playersNear(ctx, m, r + 1.3)) { const d = Math.hypot(p.x - m.x, p.z - m.z); if (Math.abs(d - r) > 1.3) continue; const a = Math.atan2(p.x - m.x, p.z - m.z); if (gaps.some(g => Math.abs(wrap(a - g)) < 0.42)) continue; hit(ctx, m, p, 18, 'screech'); } };
  return { busy: 3.6, cd: 28, steps: [
    { at: 0, do: () => bossFx(ctx, m, 'crow', { gaps: gaps.map(g => +g.toFixed(3)), radii: [5, 10, 15] }) },
    { at: 1.2, do: ring(5) }, { at: 2.1, do: ring(10) }, { at: 3.0, do: ring(15) },
  ] }; };
M.meteor = (ctx, m, t) => { const zone = ctx.zoneOf(m); const pts = []; for (let i = 0; i < 5; i++) pts.push(i === 0 && t ? { x: t.x, z: t.z } : arenaPoint(m, 3));
  const steps = [{ at: 0, do: () => bossFx(ctx, m, 'meteor', { pts: pts.map(p => [+p.x.toFixed(2), +p.z.toFixed(2)]), delay: 1.6, r: 2.8 }) }];
  pts.forEach((p, i) => steps.push({ at: 1.6 + i * 0.25, do: () => { for (const q of ctx.players.values()) if (q.alive && q.zoneId === m.zoneId && ctx.dist2(q.x, q.z, p.x, p.z) < 2.8 * 2.8) hit(ctx, m, q, 22, 'burn'); addHazard(ctx, zone, { x: p.x, z: p.z, r: 2.4, t: 7, dps: 5, kind: 'fire' }); bossFx(ctx, m, 'meteor_hit', { tx: +p.x.toFixed(2), tz: +p.z.toFixed(2), r: 2.8 }); } }));
  return { busy: 3.0, cd: 24, steps }; };
M.blood_peck = (ctx, m, t) => ({ busy: 1.7, cd: 10, steps: [
  { at: 0, do: () => { face(m, t); bossFx(ctx, m, 'blood_peck'); } },
  { at: 1.2, do: () => { for (const p of playersInCone(ctx, m, m.yaw, 0.55, 4.4)) { const d = hit(ctx, m, p, 34, 'peck'); if (d) heal(ctx, m, d * 1.0); } } },
] });
// the ultimate
M.final_cluck = (ctx, m, t) => { const zone = ctx.zoneOf(m); const c = m.arena; const steps = [];
  steps.push({ at: 0, do: () => { m.x = c.x; m.z = c.z; m.untargetable = true; bossFx(ctx, m, 'final_start', { t: 7 }); } });
  // rotating fire-feather lanes
  for (let k = 0; k < 12; k++) steps.push({ at: 1.0 + k * 0.5, do: () => { const base = k * 0.35; const lanes = [0, 1, 2, 3].map(i => base + i * Math.PI / 2); for (const a of lanes) for (const p of playersInLane(ctx, m, a, 26, 1.5)) hit(ctx, m, p, 9, 'burn'); bossFx(ctx, m, 'final_lanes', { lanes: lanes.map(a => +a.toFixed(3)), len: 26 }); } });
  // exploding eggs
  for (let k = 0; k < 4; k++) { const p = arenaPoint(m, 4); steps.push({ at: 1.5 + k * 1.2, do: () => bossFx(ctx, m, 'fire_egg', { tx: +p.x.toFixed(2), tz: +p.z.toFixed(2), delay: 1.4 }) }); steps.push({ at: 2.9 + k * 1.2, do: () => { for (const q of ctx.players.values()) if (q.alive && q.zoneId === m.zoneId && ctx.dist2(q.x, q.z, p.x, p.z) < 9) hit(ctx, m, q, 16, 'burn'); bossFx(ctx, m, 'egg_burst', { tx: +p.x.toFixed(2), tz: +p.z.toFixed(2), r: 3 }); } }); }
  // chicks
  steps.push({ at: 2.0, do: () => { for (let i = 0; i < 3; i++) { const a = i * 2.1; spawnMinion(ctx, m, 'hell_chick', c.x + Math.sin(a) * 6, c.z + Math.cos(a) * 6, { life: 8 }); } } });
  // expanding rings
  const gaps = [rand(0, Math.PI * 2), rand(0, Math.PI * 2)];
  const ring = (r) => () => { for (const p of playersNear(ctx, m, r + 1.3)) { const d = Math.hypot(p.x - c.x, p.z - c.z); if (Math.abs(d - r) > 1.3) continue; const a = Math.atan2(p.x - c.x, p.z - c.z); if (gaps.some(g => Math.abs(wrap(a - g)) < 0.45)) continue; hit(ctx, m, p, 18, 'screech'); } };
  steps.push({ at: 3.5, do: () => bossFx(ctx, m, 'crow', { gaps: gaps.map(g => +g.toFixed(3)), radii: [7, 14] }) }, { at: 4.7, do: ring(7) }, { at: 5.6, do: ring(14) });
  // the crash, then a stunned, vulnerable window
  steps.push({ at: 7.0, do: () => { m.untargetable = false; bossFx(ctx, m, 'roost_land', { r: 8 }); for (const p of playersNear(ctx, m, 8)) { hit(ctx, m, p, 40, 'slam'); knockback(ctx, zone, p, m.x, m.z, 4); } for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; addHazard(ctx, zone, { x: c.x + Math.cos(a) * 6.5, z: c.z + Math.sin(a) * 6.5, r: 2.3, t: 8, dps: 5, kind: 'fire' }); } m.stunT = 7; m.vulnerable = 7; bossFx(ctx, m, 'stunned', { t: 7, vulnerable: true }); } });
  return { busy: 7.2, cd: 9999, steps }; };

const PHASE1 = ['hell_peck', 'wing', 'scratch', 'fire_egg', 'demon_cluck', 'chicks', 'barrage', 'rush', 'eggs_of_ruin', 'roost', 'chicken_run', 'peckening', 'rotten_egg', 'brood'];
const PHASE2 = PHASE1.concat(['molt', 'crow', 'meteor', 'blood_peck']);
const MELEE = new Set(['hell_peck', 'wing', 'scratch', 'blood_peck']);

// ---------------------------------------------------------------- per-tick boss AI
export function stepCluckifer(ctx, m, dt) {
  const zone = ctx.zoneOf(m);
  for (const k of Object.keys(m.cds)) if (m.cds[k] > 0) m.cds[k] -= dt;
  if (m.vulnerable > 0) m.vulnerable -= dt;
  // phase 2 at half health
  if (m.phase === 1 && m.hp <= m.maxHp * 0.5) { m.phase = 2; m.speed = 7.2; bossFx(ctx, m, 'phase2'); ctx.systemChat('Cluckifer’s feathers ignite. The Devil Chicken is unleashed!'); }
  // running script
  if (m.script) {
    const s = m.script; s.t += dt;
    while (s.i < s.steps.length && s.steps[s.i].at <= s.t) { try { s.steps[s.i].do(); } catch (e) { console.error('boss step', e); } s.i++; }
    if (s.t >= s.busy) { m.script = null; m.gcd = m.phase === 2 ? 1.0 : 1.6; }
    return;
  }
  if (m.stunT > 0) { m.stunT -= dt; return; }
  const t = target(ctx, m);
  if (!t) { m.state = 'idle'; return; }
  // the ultimate, once, at low health
  if (!m.ultDone && m.hp <= m.maxHp * 0.2) { m.ultDone = true; startScript(m, M.final_cluck(ctx, m, t)); return; }
  m.gcd = Math.max(0, (m.gcd || 0) - dt);
  const d = Math.hypot(t.x - m.x, t.z - m.z);
  face(m, t);
  if (m.gcd <= 0) {
    const pool = (m.phase === 2 ? PHASE2 : PHASE1).filter(id => !(m.cds[id] > 0) && (d <= 4.2 || !MELEE.has(id)));
    if (pool.length) {
      // weight: basic pecks often, big set pieces less
      const weight = (id) => id === 'hell_peck' ? 5 : id === 'blood_peck' ? 4 : MELEE.has(id) ? 3 : ['chicken_run', 'peckening', 'rotten_egg', 'brood', 'roost', 'eggs_of_ruin'].includes(id) ? 1 : 2;
      let total = 0; for (const id of pool) total += weight(id);
      let r = Math.random() * total, pick = pool[0]; for (const id of pool) { r -= weight(id); if (r <= 0) { pick = id; break; } }
      const sc = M[pick](ctx, m, t);
      if (sc) { m.cds[pick] = sc.cd; startScript(m, sc); return; }
    }
  }
  // otherwise close in
  if (d > 3.6) ctx.navStep(zone, m, t.x, t.z, 3.2, m.speed);
}
function startScript(m, sc) { m.script = { steps: sc.steps.slice().sort((a, b) => a.at - b.at), i: 0, t: 0, busy: sc.busy }; }

// ---------------------------------------------------------------- minions
export function stepMinion(ctx, m, dt) {
  const zone = ctx.zoneOf(m);
  const owner = m.ownerId ? ctx.monsters.get(m.ownerId) : null;
  if (m.life > 0) { m.life -= dt; if (m.life <= 0) { minionExpire(ctx, m, owner); return; } }
  if (m.minion === 'chick') {
    const t = target(ctx, m); if (!t) return;
    m.yaw = Math.atan2(t.x - m.x, t.z - m.z);
    const d = Math.hypot(t.x - m.x, t.z - m.z);
    if (d > 1.6) ctx.navStep(zone, m, t.x, t.z, 1.4, m.speed);
    else { m.atkTimer = Math.max(0, (m.atkTimer || 0) - dt); if (m.atkTimer <= 0) { m.atkTimer = 1.2; hit(ctx, m, t, 4, 'peck'); } }
  } else if (m.minion === 'brood') {
    if (!owner || !owner.alive) { ctx.killMonster(m, null); return; }
    const d = Math.hypot(owner.x - m.x, owner.z - m.z);
    m.yaw = Math.atan2(owner.x - m.x, owner.z - m.z);
    if (d > 2.6) ctx.navStep(zone, m, owner.x, owner.z, 2.4, m.speed);
    else { heal(ctx, owner, owner.maxHp * 0.05); bossFx(ctx, owner, 'devour', { mid: m.id }); m.alive = false; m.hp = 0; m.state = 'dead'; m.respawnTimer = 999999; }
  } else if (m.minion === 'rotten_egg') {
    m.grow = Math.min(1, (m.grow || 0) + dt / 10);
  }
  // eggs just sit there
}
function minionExpire(ctx, m, owner) {
  const zone = ctx.zoneOf(m);
  if (m.minion === 'chick') { explode(ctx, m, 2.6, 12); }
  else if (m.minion === 'ruin_egg') { bossFx(ctx, owner || m, 'hatch', { mid: m.id }); if (owner && owner.alive) spawnMinion(ctx, owner, 'hell_chick', m.x, m.z, { life: 10 }); }
  else if (m.minion === 'rotten_egg') { bossFx(ctx, owner || m, 'rotten_burst', { mx: +m.x.toFixed(2), mz: +m.z.toFixed(2), r: 10 }); for (const p of playersNear(ctx, m, 10)) hit(ctx, m, p, 25, 'poison'); addHazard(ctx, zone, { x: m.x, z: m.z, r: 10, t: 13, dps: 6, kind: 'poison' }); }
  m.alive = false; m.hp = 0; m.state = 'dead'; m.respawnTimer = 999999;
}
function explode(ctx, m, r, dmg) {
  bossFx(ctx, m, 'chick_burst', { mx: +m.x.toFixed(2), mz: +m.z.toFixed(2), r });
  for (const p of playersNear(ctx, m, r)) hit(ctx, m, p, dmg, 'burn');
  addHazard(ctx, ctx.zoneOf(m), { x: m.x, z: m.z, r: 1.6, t: 4, dps: 3, kind: 'fire' });
}
// A minion killed by a player.
export function onMinionKilled(ctx, m) {
  if (m.minion === 'chick') explode(ctx, m, 2.6, 12);
  else if (m.minion === 'ruin_egg' || m.minion === 'rotten_egg') bossFx(ctx, m, 'egg_smash', { mx: +m.x.toFixed(2), mz: +m.z.toFixed(2) });
}
// The boss dies: clear its brood and the fires.
export function onBossKilled(ctx, m) {
  for (const c of ctx.monsters.values()) if (c.ownerId === m.id && c.alive) { c.alive = false; c.hp = 0; c.state = 'dead'; c.respawnTimer = 999999; }
  const zone = ctx.zoneOf(m); if (zone._bossHazards) zone._bossHazards.length = 0;
  bossFx(ctx, m, 'die');
  ctx.systemChat('CLUCKIFER has been slain. The woods fall quiet, save for one nervous cluck.');
}
