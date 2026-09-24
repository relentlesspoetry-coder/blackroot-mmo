// Blackroot — the Bard's songs.
// Numbers live in balance.js CLASSES.bard; this is what the songs do. A song
// is cast once and settles on every ally in range as a buff carrying the
// song's effect (`fx` in the definition): damage / attack speed / crit / move
// bonuses that the combat code in server.js reads off the buff, regen ticks
// that run here, and charges that the relevant action spends. Debuffs sit on
// the monster (`m.debuffs[id]` seconds left, `m.dval[id]` strength) and the
// monster code reads them the same way.
import { spellScale, classDef } from './balance.js';
import { dist2 } from './worldgen.js';

export const BARD_KINDS = new Set(['note', 'song', 'sonic', 'lullaby', 'dirge', 'echo', 'weave', 'crescendo']);
export const isBardSpell = (a) => !!a && BARD_KINDS.has(a.kind);
// Debuff ids a Bard can leave on a monster (Final Refrain extends these).
const BARD_DEBUFFS = ['dissonant', 'mournful', 'dirge', 'dirge_slow', 'lull_slow', 'lull_atk'];

const buffOn = (p, id) => { const b = p.buffs && p.buffs[id]; return b && b.t > 0 ? b : null; };
// Dreamsong on the ally: the Bard's songs on them are stronger.
export function songAmp(p, bf) { return bf && bf.song && buffOn(p, 'dreamsong') ? 1 + (p.buffs.dreamsong.amp || 0.35) : 1; }

function alliesNear(ctx, p, r, cap) {
  const out = [];
  for (const q of ctx.players.values()) { if (!q.alive || q.zoneId !== p.zoneId) continue; if (dist2(q.x, q.z, p.x, p.z) <= r * r) out.push(q); }
  out.sort((a, b) => dist2(a.x, a.z, p.x, p.z) - dist2(b.x, b.z, p.x, p.z));
  return out.slice(0, cap || out.length);
}
function hostile(ctx, p, a) {
  const m = p.combatId != null ? ctx.monsters.get(p.combatId) : null;
  if (!(m && m.alive && m.zoneId === p.zoneId)) return { err: 'You need a target.' };
  if (m.untargetable) return { err: `${m.name} is out of reach!` };
  const range = a.range || 28;
  if (dist2(p.x, p.z, m.x, m.z) > range * range) return { err: 'Too far away.' };
  return { m };
}
export function checkBardCast(ctx, p, a) {
  switch (a.kind) {
    case 'note': case 'sonic': case 'lullaby': case 'dirge': return hostile(ctx, p, a).err || null;
    case 'weave': return (p.songHistory || []).length >= 2 ? null : 'You need two songs behind you to weave.';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------
// Drop one of this Bard's songs from everyone.
function liftSong(ctx, p, id) {
  for (const q of ctx.players.values()) { const b = q.buffs[id]; if (b && b.by === p.id) { delete q.buffs[id]; ctx.sendStatus(q); } }
}
// Lay a song (a buff built from `fx`) on the allies in range, keeping to the
// Bard's song limit: the oldest major song falls off when a third starts.
function playSong(ctx, p, id, fx, o) {
  const L = p.level, S = spellScale(L);
  p.songs = (p.songs || []).filter(s => s !== id);
  if (o.replaces) { liftSong(ctx, p, o.replaces); p.songs = p.songs.filter(s => s !== o.replaces); }   // Chorus of War takes Hymn of Courage's place
  const limit = classDef(p.cls).songLimit || 2;
  while (p.songs.length >= limit) liftSong(ctx, p, p.songs.shift());
  p.songs.push(id);
  let charges = o.charges || 0;
  const echo = buffOn(p, 'echoing_verse'); if (echo && o.major) { charges = Math.ceil(charges * (echo.chargeK || 1.5)); delete p.buffs.echoing_verse; }
  for (const t of alliesNear(ctx, p, o.radius, o.cap)) {
    const b = { id, by: p.id, song: true, vis: true, dur: o.dur, charges, ...fx };
    if (fx.hot) { b.tick = fx.tick; b.acc = 0; b.heal = fx.healPct ? t.maxHp * fx.healPct : (fx.heal || 0) * S; b.cap = fx.capPct ? Math.round(t.maxHp * fx.capPct) : Infinity; b.done = 0; if (fx.ticksLeft) b.ticksLeft = fx.ticksLeft; }
    if (fx.mtick) { b.macc = 0; b.manaPct = L >= 20 && fx.manaPct20 ? fx.manaPct20 : fx.manaPct; }
    if (fx.absorb != null) { b.absorb = Math.round(fx.absorb * S + t.maxHp * (fx.absorbPct || 0)); b.absorbMax = b.absorb; }
    if (o.replaces && t.buffs[o.replaces] && t.buffs[o.replaces].by === p.id) delete t.buffs[o.replaces];
    ctx.addBuff(t, b);
  }
  p.songHistory = [...(p.songHistory || []).filter(s => s !== id), id].slice(-2);
}
// Sonic damage: no accuracy roll, level-scaled, crits; stronger under Dreamsong.
function sonicHit(ctx, p, m, a, extra = {}) {
  let mult = (1 + (extra.mult || 0)) * (1 + ctx.dmgBuff(p, false, true));
  const ds = buffOn(p, 'dreamsong'); if (ds && ds.sonic) mult *= 1 + ds.sonic;
  if (buffOn(p, 'revival_sickness')) mult *= 0.85;
  const crit = Math.random() < ctx.critChance(p);
  if (crit) mult *= classDef(p.cls).critMult || 1.5;
  // the Bard's numbers climb a little slower than the Cleric's (the spec's level-20 targets sit lower)
  const dmg = Math.max(1, Math.round(a.dmg * (1 + (spellScale(p.level) - 1) * 0.8) * mult * (0.9 + Math.random() * 0.2)));
  ctx.applyHit(p, m, dmg, crit, 'sonic');
  return dmg;
}
export function hasBardDebuff(m) { return !!(m.debuffs && BARD_DEBUFFS.some(k => m.debuffs[k] > 0)); }
function setDebuff(p, m, id, val, dur) {
  const ds = buffOn(p, 'dreamsong'); if (ds && ds.ampDebuff) val *= 1 + ds.ampDebuff;
  m.debuffs = m.debuffs || {}; m.dval = m.dval || {}; m.dmax = m.dmax || {};
  m.debuffs[id] = dur; m.dval[id] = val; m.dmax[id] = dur;
}

export function castBard(ctx, p, a) {
  const notice = (text) => ctx.send(p.ws, { t: 'event', kind: 'notice', text });
  const fx = (kind, extra = {}) => ctx.broadcast({ t: 'event', kind: 'spell', spell: a.id, fx: kind, by: p.id, ...extra });
  let r;
  switch (a.kind) {
    case 'note': {
      r = hostile(ctx, p, a); if (r.err) return notice(r.err);
      sonicHit(ctx, p, r.m, a, { mult: hasBardDebuff(r.m) ? a.debuffed : 0 });
      fx('note', { target: r.m.id });
      break;
    }
    case 'sonic': {
      r = hostile(ctx, p, a); if (r.err) return notice(r.err);
      const m = r.m;
      let extra = {};
      if (a.execute && m.hp <= m.maxHp * 0.3) extra.mult = a.execute;
      sonicHit(ctx, p, m, a, extra);
      if (a.debuff && m.alive) {
        const d = a.debuff;
        if (m.boss) { if (d.boss) setDebuff(p, m, d.id, d.boss[0], d.boss[1]); else setDebuff(p, m, d.id, d.val * (d.bossHalf ? 0.5 : 1), d.dur); }
        else if (m.elite && d.elite) setDebuff(p, m, d.id, d.elite[0], d.elite[1]);
        else setDebuff(p, m, d.id, d.val, d.dur);
        if (d.mres) m.dval.mournful_res = (m.boss && d.bossHalf ? 0.5 : 1) * d.mres;
      }
      if (a.extend && m.alive && m.debuffs) {   // Final Refrain: the Bard's debuffs on it linger
        for (const k of BARD_DEBUFFS) if (m.debuffs[k] > 0) m.debuffs[k] = Math.min((m.dmax && m.dmax[k] || m.debuffs[k]) * 1.5, m.debuffs[k] + a.extend);
      }
      fx(a.id === 'final_refrain' ? 'refrain' : 'sonic', { target: m.id });
      break;
    }
    case 'lullaby': {
      r = hostile(ctx, p, a); if (r.err) return notice(r.err);
      const m = r.m;
      if (m.boss) { setDebuff(p, m, 'lull_atk', a.bossAtk, a.bossDur); notice(`${m.name} only yawns.`); }
      else if (m.elite) { setDebuff(p, m, 'lull_slow', a.eliteSlow, a.eliteDur); setDebuff(p, m, 'lull_atk', a.eliteAtk, a.eliteDur); }
      else { m.debuffs = m.debuffs || {}; m.debuffs.asleep = a.sleep; m.targetId = null; m.state = 'idle'; m.provoked = false; p.combatId = null; ctx.interruptMonster && ctx.interruptMonster(m, p); }   // and the Bard stops swinging at it
      fx('lullaby', { target: m.id });
      break;
    }
    case 'dirge': {
      r = hostile(ctx, p, a); if (r.err) return notice(r.err);
      const c = r.m, hits = [];
      for (const m of ctx.monsters.values()) { if (!m.alive || m.zoneId !== p.zoneId || m.passive && m !== c || m.untargetable) continue; if (dist2(m.x, m.z, c.x, c.z) <= a.radius * a.radius) hits.push(m); }
      hits.sort((x, y) => dist2(x.x, x.z, c.x, c.z) - dist2(y.x, y.z, c.x, c.z));
      for (const m of hits.slice(0, a.cap)) {
        sonicHit(ctx, p, m, a);
        if (!m.alive) continue;
        const d = a.debuff, [val, dur, slow] = m.boss ? d.boss : m.elite ? d.elite : [d.val, d.dur, d.slow];
        setDebuff(p, m, 'dirge', val, dur);
        if (slow) setDebuff(p, m, 'dirge_slow', slow, d.slowDur);
      }
      fx('dirge', { x: c.x, z: c.z, r: a.radius });
      break;
    }
    case 'song': {
      playSong(ctx, p, a.id, a.fx, a);
      fx('song', { family: a.family, x: p.x, z: p.z, r: a.radius });
      break;
    }
    case 'echo': {
      ctx.addBuff(p, { id: 'echoing_verse', dur: a.dur, chargeK: a.chargeK, vis: true });
      fx('echo');
      break;
    }
    case 'weave': {
      const defs = classDef(p.cls).abilities;
      const parts = (p.songHistory || []).map(id => defs.find(x => x.id === id)).filter(x => x && x.fx);
      if (parts.length < 2) return notice('You need two songs behind you to weave.');
      // half of each numeric effect; ticks keep their beat, the amounts halve
      const blend = {}; const half = ['dmg', 'atkSpeed', 'crit', 'move', 'moveCombat', 'dr', 'absorb', 'absorbPct', 'heal', 'healPct', 'capPct', 'manaPct', 'manaPct20', 'ragePct', 'medK', 'manaIdle', 'manaCombat', 'castK', 'controlK', 'resist'];
      for (const s of parts) for (const [k, v] of Object.entries(s.fx)) {
        if (typeof v === 'number' && half.includes(k)) blend[k] = (blend[k] || 0) + v * 0.5;
        else if (blend[k] == null) blend[k] = v;
      }
      blend.offensive = true; blend.ticksLeft = a.charges;
      playSong(ctx, p, 'songweave', blend, { ...a, major: true });
      fx('song', { family: 'weave', x: p.x, z: p.z, r: a.radius });
      break;
    }
    case 'crescendo': {
      for (const t of alliesNear(ctx, p, a.radius, a.cap)) ctx.addBuff(t, { id: 'dreamsong', by: p.id, vis: true, dur: a.dur, charges: a.charges, amp: a.ampBuff, ampDebuff: t === p ? a.ampDebuff : 0, sonic: t === p ? a.sonic : 0, offensive: true });
      fx('crescendo', { x: p.x, z: p.z, r: a.radius });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Readers and ticks
// ---------------------------------------------------------------------------
// Spend a charge from the buffs an action of this kind consumes.
export function spendSongCharges(ctx, p, kind) {
  let dirty = false;
  for (const [id, b] of Object.entries(p.buffs)) {
    if (!(b.t > 0) || !b.charges) continue;
    if (kind === 'offensive' && !b.offensive) continue;
    if (kind === 'weapon' && !b.weapon) continue;
    if (kind === 'recovery' && !b.recovery) continue;
    if (kind === 'control' && !b.controlK) continue;
    b.charges--; if (b.charges <= 0) { delete p.buffs[id]; dirty = true; }
  }
  if (dirty) ctx.sendStatus(p);
}
// Attack-speed multiplier (<1 = faster) from songs.
export function atkSpeedMult(p) { let k = 1; for (const b of Object.values(p.buffs)) if (b.t > 0 && b.atkSpeed) k -= b.atkSpeed * songAmp(p, b); return Math.max(0.5, k); }
export function castTimeMult(p) { let k = 1; for (const b of Object.values(p.buffs)) if (b.t > 0 && b.castK) k -= b.castK * songAmp(p, b); return Math.max(0.5, k); }
export function meditationMult(p) { let k = 1; for (const b of Object.values(p.buffs)) if (b.t > 0 && b.medK) k += b.medK * songAmp(p, b) * (buffOn(p, 'dreamsong') ? 2 : 1); return k; }
export function manaRegenMult(p, inCombat) { let k = 1; for (const b of Object.values(p.buffs)) if (b.t > 0 && (b.manaIdle || b.manaCombat)) k += (inCombat ? b.manaCombat || 0 : b.manaIdle || 0) * songAmp(p, b); return k; }
export function controlMult(p) { const b = Object.values(p.buffs).find(b => b.t > 0 && b.controlK); return b ? 1 - b.controlK : 1; }
// What a Bard's debuffs do to a monster.
export function bardMonsterDmgMult(m) { let k = 1; const d = m.debuffs, v = m.dval || {}; if (!d) return k; if (d.dissonant > 0) k *= 1 - (v.dissonant || 0.08); if (d.dirge > 0) k *= 1 - (v.dirge || 0.08); return k; }
export function bardMonsterDefMult(m) { const d = m.debuffs, v = m.dval || {}; return d && d.mournful > 0 ? 1 - (v.mournful || 0.08) : 1; }
export function bardMonsterTakenMult(m) { const d = m.debuffs, v = m.dval || {}; return d && d.mournful > 0 ? 1 + (v.mournful_res || 0.06) : 1; }
export function bardMonsterSpeedMult(m) { const d = m.debuffs, v = m.dval || {}; let k = 1; if (!d) return k; if (d.dirge_slow > 0) k *= 1 - (v.dirge_slow || 0.3); if (d.lull_slow > 0) k *= 1 - (v.lull_slow || 0.35); return k; }
export function bardMonsterAtkSpeedMult(m) { const d = m.debuffs, v = m.dval || {}; return d && d.lull_atk > 0 ? 1 + (v.lull_atk || 0.1) : 1; }
// Per-tick song upkeep on one player: mana ticks and the movement charges.
export function stepSongs(ctx, p, dt) {
  if (!p.alive) return;
  let dirty = false;
  for (const [id, b] of Object.entries(p.buffs)) {
    if (!(b.t > 0)) continue;
    if (b.mtick) {
      b.macc = (b.macc || 0) + dt;
      if (b.macc >= b.mtick) {
        b.macc -= b.mtick;
        const amp = songAmp(p, b);
        if (p.manaMax) p.mana = Math.min(p.manaMax, (p.mana || 0) + p.manaMax * (b.manaPct || 0) * amp);
        else if (p.rageMax && b.ragePct) p.rage = Math.min(p.rageMax, (p.rage || 0) + p.rageMax * b.ragePct * amp);
        if (b.charges) { b.charges--; if (b.charges <= 0) { delete p.buffs[id]; dirty = true; } }
        else if (b.ticksLeft != null && !b.hot) { if (--b.ticksLeft <= 0) { delete p.buffs[id]; dirty = true; } }
      }
    }
    if (b.moveTrigger && p.moving) {
      b.moveAcc = (b.moveAcc || 0) + dt;
      if (b.moveAcc >= b.moveTrigger) { b.moveAcc = 0; b.charges--; if (b.charges <= 0) { delete p.buffs[id]; dirty = true; } }
    }
  }
  if (dirty) ctx.sendStatus(p);
}
