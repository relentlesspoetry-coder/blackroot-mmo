import { passiveValue, passiveDirectMult } from './passives.js';
// Blackroot — the Cleric's spells.
// The class definition (numbers, costs, cooldowns) lives in balance.js
// CLASSES.cleric; this is what each spell kind actually does when it lands,
// plus the pieces of the damage pipeline a Cleric touches: wards that absorb,
// prayers that soften or answer a blow, and the save that stops a killing
// one. Everything takes a `ctx` handed in by server.js (players, monsters,
// send/broadcast and the combat helpers) so nothing here reaches for globals.
import { spellScale, classDef, classStats } from './balance.js';
import { dist2 } from './worldgen.js';

// Spell kinds this module resolves (everything else on an action bar is the
// Fighter's melee machinery in server.js).
export const SPELL_KINDS = new Set(['heal', 'holy', 'hot', 'cleanse', 'ward', 'turn', 'mending', 'sanctuary', 'aoeheal', 'barrier', 'intervention', 'hymn', 'guardian', 'revive', 'avatar']);
export const isSpell = (a) => !!a && SPELL_KINDS.has(a.kind);
// Casts that count as "healing / ward / cleanse actions" for Avatar of Mercy.
const MERCY_KINDS = new Set(['heal', 'hot', 'cleanse', 'ward', 'mending', 'sanctuary', 'aoeheal', 'barrier', 'intervention', 'hymn', 'guardian', 'revive']);
const HEAL_COST_KINDS = new Set(['heal', 'hot', 'aoeheal', 'hymn', 'mending', 'revive']);   // "healing spells cost 15% less"
// Removable afflictions, worst first (the spec's cleanse priority).
const CLEANSE_ORDER = ['poison', 'burn', 'bleed', 'slow'];

const buffOn = (p, id) => { const b = p.buffs && p.buffs[id]; return b && b.t > 0 ? b : null; };
const evil = (m) => !!(m && m.evil);

// Mana cost after Avatar of Mercy.
export function costOf(p, a) {
  let c = a.cost || 0;
  const av = buffOn(p, 'avatar_of_mercy'); if (av && HEAL_COST_KINDS.has(a.kind)) c = Math.round(c * (1 - (av.manaOff || 0)));
  return Math.max(0, Math.round(c * (1 - (HEAL_COST_KINDS.has(a.kind) ? passiveValue(p, 'healingCost') : 0))));
}

// ---------------------------------------------------------------------------
// Targeting
// ---------------------------------------------------------------------------
// Friendly spells go to the player the caster has targeted (client 'target'
// message), or to the caster. Returns { t } or { err }.
function friendly(ctx, p, a) {
  const range = a.range || 30;
  if (p.friendId != null) {
    const t = ctx.players.get(p.friendId);
    if (!t || t.zoneId !== p.zoneId) { p.friendId = null; return { t: p }; }
    if (!t.alive) return { err: `${t.name} is dead.` };
    if (dist2(p.x, p.z, t.x, t.z) > range * range) return { err: `${t.name} is too far away.` };
    return { t };
  }
  return { t: p };
}
function hostile(ctx, p, a) {
  const m = p.combatId != null ? ctx.monsters.get(p.combatId) : null;
  if (!(m && m.alive && m.zoneId === p.zoneId)) return { err: 'You need a target.' };
  if (m.untargetable) return { err: `${m.name} is out of reach!` };
  const range = a.range || 30;
  if (dist2(p.x, p.z, m.x, m.z) > range * range) return { err: 'Too far away.' };
  return { m };
}
function fallen(ctx, p, a) {
  const range = a.range || 30;
  let t = p.friendId != null ? ctx.players.get(p.friendId) : null;
  if (t && (t.alive || t.zoneId !== p.zoneId)) t = null;
  if (!t) { // nearest fallen ally in range
    let best = range * range;
    for (const q of ctx.players.values()) { if (q.alive || q.zoneId !== p.zoneId || q === p) continue; const d = dist2(p.x, p.z, q.x, q.z); if (d < best) { best = d; t = q; } }
  }
  if (!t) return { err: 'There is no fallen ally near you.' };
  if (dist2(p.x, p.z, t.x, t.z) > range * range) return { err: `${t.name} is too far away.` };
  if ((p.combatTimer || 0) > 0) return { err: "You can't revive in combat." };
  return { t };
}
// Check a cast before the mana goes. Returns an error string or null.
export function checkCast(ctx, p, a) {
  switch (a.kind) {
    case 'holy': return hostile(ctx, p, a).err || null;
    case 'turn': return hostile(ctx, p, a).err || null;
    case 'revive': return fallen(ctx, p, a).err || null;
    case 'sanctuary': case 'aoeheal': case 'hymn': case 'avatar': return null;
    default: return friendly(ctx, p, a).err || null;
  }
}

// ---------------------------------------------------------------------------
// Healing
// ---------------------------------------------------------------------------
// How much more (or less) the healer's spells do on this target.
export function healMult(ctx, by, t) {
  let k = 1 + passiveValue(by, 'healing');
  if (buffOn(t, 'holy_ward')) k += 0.05;
  const gp = buffOn(t, 'guardian_prayer'); if (gp && gp.by === by.id) k += gp.healIn || 0;
  const sanct = sanctuaryAt(ctx.zoneOf(t), t.x, t.z); if (sanct && sanct.by === by.id) k += sanct.healIn || 0;
  const av = buffOn(by, 'avatar_of_mercy'); if (av) k += av.healBonus || 0;
  const bh = buffOn(by, 'blessed_hands'); if (bh) k += bh.heal || 0;   // the crit proc: one empowered heal
  if (buffOn(by, 'revival_sickness')) k -= 0.15;
  return Math.max(0.1, k);
}
// Heal a player. Returns the health actually restored. `o.crit` false turns
// the crit roll off (ticks); `o.id` names the spell for the client's effect.
export function healPlayer(ctx, by, t, amount, o = {}) {
  if (!t.alive) return 0;
  let amt = amount * healMult(ctx, by, t);
  const crit = o.crit !== false && Math.random() < ctx.critChance(by);
  if (crit) amt *= classDef(by.cls).critHealMult || 1.5;
  amt = Math.max(1, Math.round(amt));
  const real = Math.max(0, Math.min(amt, t.maxHp - t.hp));
  t.hp = Math.min(t.maxHp, t.hp + real);
  ctx.broadcast({ t: 'event', kind: 'heal', by: by.id, target: t.id, amount: amt, over: amt - real, crit, spell: o.id || null, tick: !!o.tick });
  // One effective healing event consumes Blessed Hands: a HoT tick or the
  // first injured recipient of an AoE counts; overheal and invalid targets do not.
  if (real > 0 && buffOn(by, 'blessed_hands')) { delete by.buffs.blessed_hands; ctx.sendStatus(by); }
  if (real > 0 && ctx.healThreat) ctx.healThreat(by, t, real);   // a healer is never invisible
  return real;
}
function spendMercy(p, a) {
  const av = buffOn(p, 'avatar_of_mercy'); if (!av || !MERCY_KINDS.has(a.kind)) return;
  av.charges--; if (av.charges <= 0) delete p.buffs.avatar_of_mercy;
}
function absorbMult(p) { const av = buffOn(p, 'avatar_of_mercy'); return (1 + (av ? av.absorbBonus || 0 : 0)) * (1 + passiveValue(p, 'absorb')); }
function alliesNear(ctx, p, x, z, r, exclude) {
  const out = [];
  for (const q of ctx.players.values()) { if (!q.alive || q.zoneId !== p.zoneId || q === exclude) continue; if (dist2(q.x, q.z, x, z) <= r * r) out.push(q); }
  return out;
}
const mostHurt = (list) => list.slice().sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);

// Holy damage: no accuracy roll (the light finds its mark), scaled by level,
// stronger on the undead and the demonic, crits like everything else.
function holyHit(ctx, p, m, a) {
  const L = p.level;
  let mult = (1 + (evil(m) ? a.evil || 0 : 0)) * (1 + ctx.dmgBuff(p, false, true)) * (1 + passiveValue(p, 'holyDamage'));   // Bard songs lift holy damage too
  const av = buffOn(p, 'avatar_of_mercy'); if (av) mult += av.holyBonus || 0;
  if (buffOn(p, 'revival_sickness')) mult -= 0.15;
  const crit = Math.random() < ctx.critChance(p);
  if (crit) mult *= classDef(p.cls).critMult || 1.5;
  const dmg = Math.max(1, Math.round(a.dmg * spellScale(L) * mult * (0.9 + Math.random() * 0.2)));
  if (a.interrupt && ctx.interruptMonster) ctx.interruptMonster(m, p);
  ctx.applyHit(p, m, dmg, crit, 'holy');
  return dmg;
}

// ---------------------------------------------------------------------------
// The casts
// ---------------------------------------------------------------------------
// Fire a spell that has already been checked and paid for. Casts with a
// wind-up re-resolve their target here, so a target that died or walked
// away mid-cast just fizzles with a notice.
export function castSpell(ctx, p, a) {
  const notice = (text) => ctx.send(p.ws, { t: 'event', kind: 'notice', text });
  const L = p.level, S = spellScale(L);
  const fx = (kind, t, extra = {}) => ctx.broadcast({ t: 'event', kind: 'spell', spell: a.id, fx: kind, by: p.id, target: t ? t.id : undefined, x: extra.x, z: extra.z, r: extra.r });
  let r;
  switch (a.kind) {
    case 'heal': {
      r = friendly(ctx, p, a); if (r.err) return notice(r.err);
      let amt = a.heal * S;
      if (a.woundedBonus && r.t.hp < r.t.maxHp * 0.4) amt *= 1 + a.woundedBonus;
      healPlayer(ctx, p, r.t, amt, { id: a.id });
      break;
    }
    case 'holy': {
      r = hostile(ctx, p, a); if (r.err) return notice(r.err);
      const m = r.m, dmg = holyHit(ctx, p, m, a);
      if (a.weaken && evil(m)) { m.debuffs = m.debuffs || {}; m.debuffs.exorcised = a.weakenDur || 8; }
      if (a.leech && dmg > 0) {   // Judgment Light: the most hurt ally nearby is healed for a share
        const hurt = mostHurt(alliesNear(ctx, p, p.x, p.z, a.leechR || 25)).filter(q => q.hp < q.maxHp)[0];
        if (hurt) healPlayer(ctx, p, hurt, dmg * a.leech * (evil(m) ? 1 + (a.evil || 0) : 1), { id: a.id, crit: false });
      }
      fx('holy', m);
      break;
    }
    case 'hot': {
      r = friendly(ctx, p, a); if (r.err) return notice(r.err);
      const t = r.t;
      ctx.addBuff(t, { id: 'renewing_prayer', dur: a.dur, by: p.id, hot: true, tick: a.tick, acc: 0, heal: a.heal * S, cap: Math.round(t.maxHp * a.capPct), done: 0 });
      fx('hot', t);
      break;
    }
    case 'cleanse': {
      r = friendly(ctx, p, a); if (r.err) return notice(r.err);
      const t = r.t; let removed = 0;
      for (const k of CLEANSE_ORDER) {
        if (removed >= a.n) break;
        if (k === 'slow') { if (t.slow && t.slow.t > 0) { t.slow = null; removed++; } }
        else if (t.dots && t.dots[k]) { delete t.dots[k]; removed++; }
      }
      if (!removed) {
        if (a.refund) { p.mana = Math.min(p.manaMax, p.mana + Math.round(costOf(p, a) * a.refund)); }
        notice(`${t === p ? 'You have' : t.name + ' has'} nothing to cleanse.`);
        return;
      }
      if (a.resist) ctx.addBuff(t, { id: 'purified_soul', dur: a.dur, charges: a.charges, resist: a.resist });
      ctx.send(t.ws, { t: 'event', kind: 'notice', text: `${p === t ? 'You are' : p.name + ' has'} cleansed${p === t ? '' : ' you'}.` });
      fx('cleanse', t);
      break;
    }
    case 'ward': {
      r = friendly(ctx, p, a); if (r.err) return notice(r.err);
      const t = r.t, amt = Math.round((a.absorb * S + t.maxHp * a.absorbPct) * absorbMult(p));
      const cur = buffOn(t, 'holy_ward');
      if (cur && cur.absorb >= amt) return notice(`${t === p ? 'Your' : t.name + "'s"} ward is already stronger.`);
      ctx.addBuff(t, { id: 'holy_ward', dur: a.dur, by: p.id, absorb: amt, absorbMax: amt });
      fx('ward', t);
      break;
    }
    case 'turn': {
      r = hostile(ctx, p, a); if (r.err) return notice(r.err);
      const m = r.m; let turned = 0;
      for (const q of ctx.monsters.values()) {
        if (!q.alive || q.zoneId !== p.zoneId || !evil(q) || dist2(q.x, q.z, m.x, m.z) > a.radius * a.radius) continue;
        q.debuffs = q.debuffs || {};
        if (a.interrupt && ctx.interruptMonster) ctx.interruptMonster(q, p);
        if (q.boss) q.debuffs.turn_weak = 6;                 // bosses shrug it off: a small damage penalty
        else if (q.elite) q.debuffs.turn_weak = a.fear;      // elites: no fear, 15% less damage
        else { q.debuffs.turned = a.fear; q.targetId = null; }
        turned++;
      }
      for (const q of alliesNear(ctx, p, m.x, m.z, a.radius + 4)) ctx.addBuff(q, { id: 'undead_ward', dur: a.dur, charges: a.charges });
      if (!turned) notice('Nothing unholy stirs here.');
      fx('turn', m, { r: a.radius });
      break;
    }
    case 'mending': {
      r = friendly(ctx, p, a); if (r.err) return notice(r.err);
      // one prayer per Cleric: an older copy elsewhere is lifted
      for (const q of ctx.players.values()) { const b = buffOn(q, 'prayer_of_mending'); if (b && b.by === p.id) delete q.buffs.prayer_of_mending; }
      ctx.addBuff(r.t, { id: 'prayer_of_mending', dur: a.dur, by: p.id, charges: a.charges, heal: a.heal * S, jump: a.jump });
      fx('mending', r.t);
      break;
    }
    case 'sanctuary': {
      const zone = ctx.zoneOf(p);
      zone._sanct = (zone._sanct || []).filter(s => s.by !== p.id);
      zone._sanct.push({ id: ctx.nextId(), by: p.id, x: p.x, z: p.z, r: a.radius, t: a.dur, charges: a.charges, dr: a.dr, healIn: a.healIn });
      fx('sanctuary', null, { x: p.x, z: p.z, r: a.radius });
      break;
    }
    case 'aoeheal': {
      const list = mostHurt(alliesNear(ctx, p, p.x, p.z, a.radius)).slice(0, a.cap);
      for (const t of list) healPlayer(ctx, p, t, a.heal * S * (a.woundedBonus && t.hp < t.maxHp * 0.4 ? 1 + a.woundedBonus : 1), { id: a.id });
      fx('aoeheal', null, { x: p.x, z: p.z, r: a.radius });
      break;
    }
    case 'barrier': {
      r = friendly(ctx, p, a); if (r.err) return notice(r.err);
      const list = mostHurt(alliesNear(ctx, p, r.t.x, r.t.z, a.radius)).slice(0, a.cap);
      for (const t of list) {
        const amt = Math.round((a.absorb * S + t.maxHp * a.absorbPct) * absorbMult(p));
        const cur = buffOn(t, 'blessed_barrier'); if (cur && cur.absorb >= amt) continue;
        ctx.addBuff(t, { id: 'blessed_barrier', dur: a.dur, by: p.id, absorb: amt, absorbMax: amt });
        fx('ward', t);
      }
      break;
    }
    case 'intervention': {
      r = friendly(ctx, p, a); if (r.err) return notice(r.err);
      for (const q of ctx.players.values()) { const b = buffOn(q, 'divine_intervention'); if (b && b.by === p.id) delete q.buffs.divine_intervention; }
      ctx.addBuff(r.t, { id: 'divine_intervention', dur: a.dur, by: p.id, mendPct: a.mendPct, mendDur: a.mendDur, dr: a.dr, drCharges: a.charges });
      fx('intervention', r.t);
      break;
    }
    case 'hymn': {
      p.channel = { id: a.id, ticks: a.ticks, t: a.period, period: a.period, dur: a.ticks * a.period }; p.moveTo = null;
      fx('hymn', null, { x: p.x, z: p.z, r: a.radius });
      break;
    }
    case 'guardian': {
      r = friendly(ctx, p, a); if (r.err) return notice(r.err);
      for (const q of ctx.players.values()) { const b = buffOn(q, 'guardian_prayer'); if (b && b.by === p.id) delete q.buffs.guardian_prayer; }
      ctx.addBuff(r.t, { id: 'guardian_prayer', dur: a.dur, by: p.id, charges: a.charges, dr: a.dr, healIn: a.healIn });
      fx('guardian', r.t);
      break;
    }
    case 'revive': {
      r = fallen(ctx, p, a); if (r.err) return notice(r.err);
      const t = r.t;
      t.alive = true; t.deathTimer = 0; t.hp = Math.max(1, Math.round(t.maxHp * a.hpPct));
      if (classDef(t.cls).mana) t.mana = Math.round((t.manaMax || classStats(t.cls, t.level).mana) * a.resPct); else t.rage = Math.round((t.rageMax || 0) * a.resPct);
      t.buffs = {}; t.dots = null; t.slow = null; t.channel = null; t.windup = null; t.moveTo = null; t.combatId = null; t.moving = false; t.resting = false;
      ctx.addBuff(t, { id: 'revival_sickness', dur: a.sickness });
      ctx.send(t.ws, { t: 'event', kind: 'respawned', revived: true, by: p.name });
      ctx.systemChat(`${p.name} raises ${t.name} from the dead.`);
      fx('revive', t);
      break;
    }
    case 'avatar': {
      ctx.addBuff(p, { id: 'avatar_of_mercy', dur: a.dur, charges: a.charges, healBonus: a.healBonus, absorbBonus: a.absorbBonus, holyBonus: a.holyBonus, manaOff: a.manaOff });
      fx('avatar', p);
      break;
    }
  }
  spendMercy(p, a);
}

// One wave of the Hymn (called from the channel tick).
export function hymnTick(ctx, p, a) {
  const S = spellScale(p.level);
  const list = mostHurt(alliesNear(ctx, p, p.x, p.z, a.radius)).slice(0, a.cap);
  for (const t of list) healPlayer(ctx, p, t, a.heal * S * (buffOn(t, 'renewing_prayer') ? 1 + (a.rpBonus || 0) : 1), { id: a.id, tick: true });
  ctx.broadcast({ t: 'event', kind: 'spell', spell: a.id, fx: 'hymn_wave', by: p.id, x: p.x, z: p.z, r: a.radius });
}

// ---------------------------------------------------------------------------
// The damage pipeline
// ---------------------------------------------------------------------------
export function sanctuaryAt(zone, x, z) {
  if (!zone || !zone._sanct) return null;
  for (const s of zone._sanct) if (s.t > 0 && s.charges > 0 && dist2(s.x, s.z, x, z) <= s.r * s.r) return s;
  return null;
}
export function stepSanctuaries(zone, dt) {
  if (!zone._sanct || !zone._sanct.length) return;
  for (const s of zone._sanct) s.t -= dt;
  zone._sanct = zone._sanct.filter(s => s.t > 0 && s.charges > 0);
}
export function sanctuaryList(zone) {
  return (zone._sanct || []).map(s => ({ id: s.id, x: +s.x.toFixed(1), z: +s.z.toFixed(1), r: s.r, by: s.by, charges: s.charges, t: Math.round(s.t) }));
}
// Prayers and wards take their share of a blow before it reaches health.
// Direct hits (independent of element / visual kind) spend "protected hit" charges; ticks don't.
// Returns { dmg, absorbed }.
export function braceDamageMult(p, damage = {}) {
  const brace = buffOn(p, 'brace');
  return !damage?.isPeriodic && brace ? 1 - brace.directDr : 1;
}
export function mitigate(ctx, p, dmg, m, damage = {}) {
  const direct = !damage?.isPeriodic; let k = 1, absorbed = 0, changed = false;
  const spent = []; // expire after absorption so the last protected hit gets its ward
  const spend = (b, key) => { if (!direct) return; b[key]--; if (b[key] <= 0) { spent.push(b.id); changed = true; } };
  // Brace is personal, timed protection against direct hits only. Stack
  // multiplicatively with existing protection before shields absorb damage.
  k *= braceDamageMult(p, damage) * passiveDirectMult(p, damage);
  const gp = buffOn(p, 'guardian_prayer'); if (gp) { k *= 1 - gp.dr; spend(gp, 'charges'); }
  const di = buffOn(p, 'divine_intervention'); if (di && di.fired) { k *= 1 - di.dr; if (direct) { di.drCharges--; if (di.drCharges <= 0) { delete p.buffs.divine_intervention; changed = true; } } }
  const uw = buffOn(p, 'undead_ward'); if (uw && evil(m)) { k *= 0.9; spend(uw, 'charges'); }
  const s = sanctuaryAt(ctx.zoneOf(p), p.x, p.z); if (s) { k *= 1 - s.dr; if (direct) s.charges--; }
  // a Bard's Resonant Shield (and a Songweave carrying it): reduction, then its absorb, per protected hit
  for (const b of Object.values(p.buffs)) if (b.t > 0 && b.song && b.dr) { k *= 1 - b.dr * (buffOn(p, 'dreamsong') ? 1.35 : 1); if (b.protect || b.charges) spend(b, 'charges'); }
  dmg = Math.max(0, Math.round(dmg * k));
  const wards = ['holy_ward', 'blessed_barrier', ...Object.keys(p.buffs).filter(id => p.buffs[id].song && p.buffs[id].absorb > 0)];
  for (const id of wards) {
    const w = buffOn(p, id); if (!w || !(w.absorb > 0) || dmg <= 0) continue;
    const take = Math.min(w.absorb, dmg); w.absorb -= take; dmg -= take; absorbed += take;
    if (w.absorb <= 0 && !w.song) { delete p.buffs[id]; changed = true; }
  }
  for (const id of spent) delete p.buffs[id];
  return { dmg, absorbed, changed };
}
// A blow that would kill: Divine Intervention answers it. Returns the damage
// to actually apply.
export function onLethal(ctx, p, dmg) {
  const di = buffOn(p, 'divine_intervention'); if (!di || di.fired) return dmg;
  di.fired = true; di.t = 20;   // the protection lingers just long enough for its 3 softened hits
  const by = ctx.players.get(di.by);
  ctx.addBuff(p, { id: 'di_mend', dur: di.mendDur, by: di.by, hot: true, tick: 1, acc: 0, heal: p.maxHp * di.mendPct / di.mendDur, cap: Infinity, done: 0 });
  ctx.broadcast({ t: 'event', kind: 'spell', spell: 'divine_intervention', fx: 'saved', by: di.by, target: p.id });
  ctx.systemChat(`${by ? by.name + "'s" : 'A'} prayer holds ${p.name} at the edge of death.`);
  return Math.max(0, p.hp - 1);
}
// After a direct hit lands: Prayer of Mending answers, then leaps on.
export function afterHit(ctx, p, dmg, damage = {}) {
  if (damage?.isPeriodic || dmg <= 0) return;
  const pm = buffOn(p, 'prayer_of_mending'); if (!pm) return;
  const by = ctx.players.get(pm.by); if (!by) { delete p.buffs.prayer_of_mending; return; }
  healPlayer(ctx, by, p, pm.heal, { id: 'prayer_of_mending', crit: false });
  ctx.broadcast({ t: 'event', kind: 'spell', spell: 'prayer_of_mending', fx: 'mend', by: pm.by, target: p.id });
  pm.charges--;
  delete p.buffs.prayer_of_mending;
  if (pm.charges <= 0) return;
  const next = mostHurt(alliesNear(ctx, p, p.x, p.z, pm.jump, p)).filter(q => q.hp < q.maxHp)[0] || p;
  ctx.addBuff(next, { ...pm, t: undefined, dur: pm.t });
  if (next !== p) ctx.broadcast({ t: 'event', kind: 'spell', spell: 'prayer_of_mending', fx: 'mend_jump', by: pm.by, target: next.id, from: p.id });
}
// Purified Soul: a chance to shrug off a fresh poison / burn / bleed.
export function resistsDot(ctx, p) {
  const ps = buffOn(p, 'purified_soul'); if (!ps || Math.random() >= ps.resist) return false;
  ps.charges--; if (ps.charges <= 0) delete p.buffs.purified_soul;
  ctx.send(p.ws, { t: 'event', kind: 'notice', text: 'You shrug it off.' });
  return true;
}
// Damage penalties on a monster the Cleric has judged.
export function monsterDmgMult(m) {
  let k = 1; const d = m.debuffs; if (!d) return k;
  if (d.exorcised > 0) k *= 0.92;
  if (d.turn_weak > 0) k *= m.boss ? 0.95 : 0.85;
  return k;
}
// A turned monster runs from the nearest player instead of fighting. Returns
// true if it handled the monster's step.
export function fleeStep(ctx, zone, m, dt) {
  if (!m.debuffs || !(m.debuffs.turned > 0)) return false;
  let near = null, best = Infinity;
  for (const p of ctx.players.values()) { if (!p.alive || p.zoneId !== m.zoneId) continue; const d = dist2(p.x, p.z, m.x, m.z); if (d < best) { best = d; near = p; } }
  if (near && best < 30 * 30) {
    const dx = m.x - near.x, dz = m.z - near.z, d = Math.hypot(dx, dz) || 1;
    m.yaw = Math.atan2(dx, dz); m.x += dx / d * m.speed * 0.9 * dt; m.z += dz / d * m.speed * 0.9 * dt;
  }
  m.targetId = null; m.state = 'idle';
  return true;
}
// Per-tick: heal-over-time buffs (Renewing Prayer, the Intervention mend).
export function stepHots(ctx, p, dt) {
  if (!p.alive) return;
  for (const [id, b] of Object.entries(p.buffs)) {
    if (!b.hot || !(b.t > 0)) continue;
    b.acc += dt; if (b.acc < b.tick) continue; b.acc -= b.tick;
    const by = ctx.players.get(b.by) || p;
    const left = b.cap - b.done; if (left < Math.max(1, b.heal * 0.15)) { delete p.buffs[id]; ctx.sendStatus(p); continue; }   // the cap is spent
    const got = healPlayer(ctx, by, p, Math.min(b.heal, left) * (b.song && buffOn(p, 'dreamsong') ? 1.35 : 1) * (b.song && by.id === b.by ? 1 + passiveValue(by, 'songHealing') : 1), { id, crit: false, tick: true });
    b.done += Math.max(got, Math.min(b.heal, left) * 0.5);   // overhealing still spends the cap, at half rate
    if (b.done >= b.cap) { delete p.buffs[id]; ctx.sendStatus(p); }
    else if (b.ticksLeft != null && --b.ticksLeft <= 0) { delete p.buffs[id]; ctx.sendStatus(p); }   // songs with a fixed number of ticks
  }
}
