// Blackroot — the combat core.
//
// Classic MMO combat: you pick a target, close to range, and your character
// swings on its own while you spend the fight on abilities, cooldowns and
// position. Nothing here aims anything; what it does is decide how a swing
// turns out and make each weapon feel like a different tool in the hand.
//
// Three things live here:
//   * weapon profiles   — speed, damage type, reach and grip per weapon
//   * the attack table  — miss / dodge / parry / block / glance / crit / hit
//   * the threat table  — who a monster is actually angry at
//
// The attack table is rolled in order, EverQuest/WoW style: each outcome eats
// its slice of the 0..1 roll and the rest falls through to an ordinary hit. A
// swing that lands never does 0 damage — that is what "miss" is for — which is
// the whole reason hits feel like they connect.

import { TICK, DEFAULT_ATTACK_SPEED, maxHit, mitigate } from './balance.js';

// ---------------------------------------------------------------------------
// Weapon profiles
// ---------------------------------------------------------------------------
// `spd` is in game ticks (0.6 s), so 3 = a 1.8 s dagger and 7 = a 4.2 s maul.
// Damage per swing is scaled by the same number, so a slow weapon lands the
// same damage over time in far heavier pieces — the point of carrying one.
// `reach` adds to melee range (polearms and whips fight from a step back);
// `range` marks a weapon that fights from across the clearing instead.
const ARCH = {
  dagger:    { spd: 3, type: 'pierce', hands: 1, reach: 0,   crit: 0.03, name: 'dagger' },
  claw:      { spd: 3, type: 'slash',  hands: 1, reach: 0,   crit: 0.03, name: 'claws' },
  whip:      { spd: 3, type: 'slash',  hands: 1, reach: 0.6, crit: 0.01, name: 'whip' },
  wand:      { spd: 3, type: 'magic',  hands: 1, reach: 1.5, crit: 0.02, name: 'wand' },
  sword:     { spd: 4, type: 'slash',  hands: 1, reach: 0,   crit: 0.01, name: 'sword' },
  sickle:    { spd: 4, type: 'slash',  hands: 1, reach: 0,   crit: 0.01, name: 'sickle' },
  axe:       { spd: 5, type: 'slash',  hands: 1, reach: 0,   crit: 0,    name: 'axe' },
  mace:      { spd: 5, type: 'crush',  hands: 1, reach: 0,   crit: 0,    name: 'mace' },
  flail:     { spd: 5, type: 'crush',  hands: 1, reach: 0.3, crit: 0,    name: 'flail' },
  spear:     { spd: 5, type: 'pierce', hands: 2, reach: 1.2, crit: 0,    name: 'spear' },
  polearm:   { spd: 6, type: 'slash',  hands: 2, reach: 1.2, crit: 0,    name: 'polearm' },
  staff:     { spd: 5, type: 'crush',  hands: 2, reach: 0.4, crit: 0,    name: 'staff' },
  greatsword:{ spd: 6, type: 'slash',  hands: 2, reach: 0.5, crit: 0.01, name: 'greatsword' },
  greataxe:  { spd: 7, type: 'slash',  hands: 2, reach: 0.4, crit: 0,    name: 'greataxe' },
  maul:      { spd: 7, type: 'crush',  hands: 2, reach: 0.3, crit: 0,    name: 'maul' },
  bow:       { spd: 4, type: 'pierce', hands: 2, reach: 0,   crit: 0.02, name: 'bow',      range: 12 },
  crossbow:  { spd: 6, type: 'pierce', hands: 2, reach: 0,   crit: 0.02, name: 'crossbow', range: 14 },
  thrown:    { spd: 4, type: 'slash',  hands: 1, reach: 0,   crit: 0.01, name: 'thrown',   range: 9 },
  fist:      { spd: 4, type: 'crush',  hands: 1, reach: 0,   crit: 0,    name: 'fists' },
};
// Longest match first, so "greataxe" never gets read as "axe" and "throwing
// axe" never as a war axe. Names come from the two weapon packs plus the older
// hand-written items, and new weapons fall through to a sensible archetype.
const ARCH_WORDS = [
  ['greataxe', 'greataxe'], ['great axe', 'greataxe'], ['kingsguard', 'greataxe'],
  ['greatsword', 'greatsword'], ['claymore', 'greatsword'], ['relicblade', 'greatsword'], ['reaver', 'polearm'],
  ['maul', 'maul'], ['warhammer', 'maul'], ['war hammer', 'maul'], ['stone maul', 'maul'],
  ['halberd', 'polearm'], ['glaive', 'polearm'], ['scythe', 'polearm'],
  ['spear', 'spear'], ['pike', 'spear'], ['lance', 'spear'], ['trident', 'spear'],
  ['crossbow', 'crossbow'], ['greatbow', 'bow'], ['shortbow', 'bow'], ['bow', 'bow'],
  ['throwing', 'thrown'],
  ['staff', 'staff'], ['wand', 'wand'],
  ['dagger', 'dagger'], ['dirk', 'dagger'], ['fang', 'dagger'], ['stiletto', 'dagger'],
  ['claw', 'claw'], ['talon', 'claw'],
  ['whip', 'whip'],
  ['flail', 'flail'],
  ['mace', 'mace'], ['club', 'mace'], ['hammer', 'mace'], ['cudgel', 'mace'],
  ['axe', 'axe'],
  ['sickle', 'sickle'],
  ['scimitar', 'sword'], ['longsword', 'sword'], ['sword', 'sword'], ['blade', 'sword'], ['sabre', 'sword'],
];
const profileCache = new Map();
// The weapon in a hand, as combat sees it. Unarmed is a real profile too.
export function weaponProfile(name) {
  if (!name) return { ...ARCH.fist, arch: 'fist', unarmed: true };
  if (profileCache.has(name)) return profileCache.get(name);
  const n = String(name).toLowerCase();
  let arch = 'sword';
  for (const [word, a] of ARCH_WORDS) if (n.includes(word)) { arch = a; break; }
  const prof = { ...ARCH[arch], arch };
  profileCache.set(name, prof);
  return prof;
}
export function swingSeconds(prof) { return prof.spd * TICK; }
// How far this weapon can reach a target from. Melee weapons add their reach
// to the base melee range; bows and crossbows fight from their own range.
export function weaponRange(prof, meleeRange) { return prof.range || meleeRange + (prof.reach || 0); }

// One swing's damage band. The average tracks the old uniform 0..maxHit roll
// (so nothing in the world suddenly dies twice as fast), but the spread is
// tight and the floor is never zero: a landed blow always lands. Two things
// then shape it — the weapon's own bite, so a better weapon is felt and not
// just read on a tooltip, and how slowly it swings, so a maul lands the same
// damage over time in far heavier pieces.
export function swingBand(prof, strLevel, strBonus) {
  const mid = (maxHit(strLevel, strBonus) * 0.5 + strBonus * 0.25) * (prof.spd / DEFAULT_ATTACK_SPEED);
  return [Math.max(1, Math.round(mid * 0.72)), Math.max(2, Math.round(mid * 1.28))];
}
export function rollBand([lo, hi]) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

// ---------------------------------------------------------------------------
// The attack table
// ---------------------------------------------------------------------------
// Rolled once per swing, in this order. Everything is a plain probability so a
// player can read their own sheet and see where their swings are going.
export const OUTCOMES = ['miss', 'dodge', 'parry', 'block', 'glance', 'crit', 'hit'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Miss climbs steeply against things above your level — the old "you cannot
// hit what you cannot handle" lesson, without making even fights a coin flip.
function missChance(atkLevel, defLevel, hitBonus = 0) {
  const d = defLevel - atkLevel;
  return clamp(0.05 + (d > 0 ? d * 0.022 : d * 0.004) - hitBonus, 0.02, 0.45);
}
// A hit from something well above you only ever lands a piece of its weight.
function glanceChance(atkLevel, defLevel) {
  const d = defLevel - atkLevel;
  return d <= 0 ? 0 : clamp(0.10 + d * 0.05, 0, 0.42);
}

// Resolve one swing. `atk` and `def` are plain stat blocks so this works the
// same for a player hitting a monster and a monster hitting a player:
//   atk: { level, hitBonus, crit, critMult, band:[lo,hi], type, mult }
//   def: { level, dodge, parry, block, blockAmt, armour, facing }
// Returns { outcome, dmg, blocked }. Damage is post-armour and never below 1
// on anything that landed.
export function resolveAttack(atk, def, rng = Math.random) {
  const type = atk.type || 'crush';
  // A war hammer beats a shield aside; a spear finds the gap a dodge leaves.
  const blockMod = type === 'crush' ? 0.7 : 1;
  const dodgeMod = type === 'pierce' ? 0.85 : 1;
  let r = rng();
  const miss = missChance(atk.level, def.level, atk.hitBonus || 0);
  if ((r -= miss) < 0) return { outcome: 'miss', dmg: 0 };
  if ((r -= (def.dodge || 0) * dodgeMod) < 0) return { outcome: 'dodge', dmg: 0 };
  // You can only parry what comes at your front, and only with something to
  // parry it with — this is the whole reason a tank turns a monster around.
  if (def.facing !== false && (r -= (def.parry || 0)) < 0) return { outcome: 'parry', dmg: 0 };

  let dmg = rollBand(atk.band) * (atk.mult || 1);
  let outcome = 'hit', blocked = 0;
  // A shield does not stop a blow outright, it eats a chunk of it.
  if (def.facing !== false && rng() < (def.block || 0) * blockMod) {
    blocked = Math.min(Math.round(dmg * 0.8), def.blockAmt || 0);
    dmg -= blocked; outcome = 'block';
  }
  if (outcome === 'hit' && rng() < glanceChance(atk.level, def.level)) {
    dmg *= 0.62 + rng() * 0.18; outcome = 'glance';
  } else if (outcome !== 'block' && rng() < (atk.crit || 0)) {
    dmg *= atk.critMult || 2.0; outcome = 'crit';
  }
  dmg = mitigate(Math.round(dmg), def.armour || 0);
  return { outcome, dmg: Math.max(1, dmg), blocked };
}

// Whether the defender is looking at the attacker — parries and blocks only
// work to the front, which is what makes flanking and tank facing mean
// something without asking anyone to aim.
export function facing(defX, defZ, defYaw, srcX, srcZ, halfAngle = 1.75) {
  const a = Math.atan2(srcX - defX, srcZ - defZ);
  let d = a - defYaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d) <= halfAngle;
}
// Behind the target — a rogue's home, and no parry or block reaches there.
export function behind(defX, defZ, defYaw, srcX, srcZ) { return !facing(defX, defZ, defYaw, srcX, srcZ, 1.05); }

// ---------------------------------------------------------------------------
// Monster archetypes
// ---------------------------------------------------------------------------
// A fight should pose a question, not just present a health bar. Each
// archetype answers "what do I do about this one?" differently: the shaman has
// to be interrupted or killed first, the archer has to be closed on, the
// defender has to be worn down, the brute has to be braced for.
export const MOB_ARCH = {
  warrior:  { dmgType: 'slash' },
  brute:    { dmgType: 'crush', enrage: 0.3, ability: { id: 'overhead_smash', name: 'Overhead Smash', cast: 1.6, cd: 14, mult: 2.4, interruptible: false, telegraph: 'smash' } },
  defender: { dmgType: 'crush', ability: { id: 'shield_wall', name: 'Shield Wall', cast: 0, cd: 22, self: { id: 'mob_shield_wall', dur: 8, block: 0.25 }, interruptible: false } },
  archer:   { dmgType: 'pierce', range: 12, kite: 5, ability: { id: 'aimed_shot', name: 'Aimed Shot', cast: 1.8, cd: 9, mult: 2.0, interruptible: true, telegraph: 'aim' } },
  caster:   { dmgType: 'magic', range: 14, kite: 6, ability: { id: 'bloodroot_healing', name: 'Bloodroot Healing', cast: 2.5, cd: 12, heal: 0.25, interruptible: true, telegraph: 'heal' },
              ability2: { id: 'spirit_bolt', name: 'Spirit Bolt', cast: 1.5, cd: 7, mult: 1.8, interruptible: true, telegraph: 'bolt' } },
  rogue:    { dmgType: 'pierce', ability: { id: 'venom_strike', name: 'Venom Strike', cast: 0, cd: 11, mult: 1.3, poison: 4, interruptible: false } },
  swarm:    { dmgType: 'pierce' },
  beast:    { dmgType: 'crush' },
};
// Which archetype each creature fights as.
const MOB_ARCH_OF = {
  goblin: 'warrior', goblin_warrior: 'warrior', goblin_miner: 'warrior', bandit: 'warrior', goblin_chief: 'brute',
  goblin_archer: 'archer', goblin_shaman: 'caster', goblin_scavenger: 'rogue', venom_spider: 'rogue',
  cave_guardian: 'defender', guard: 'brute', cave_giant: 'brute', crystal_giant: 'brute',
  bat: 'swarm', spider: 'swarm', crystal_spider: 'swarm', broodmother: 'rogue',
  ember_dragon: 'brute', frost_dragon: 'brute', venom_dragon: 'brute',
  cow: 'beast', chicken: 'beast',
};
export function archOf(type) { return MOB_ARCH_OF[type] || 'warrior'; }
// dodge / parry / block per monster archetype.
export const MOB_DEF = {
  beast:    { dodge: 0.03, parry: 0,    block: 0 },
  swarm:    { dodge: 0.08, parry: 0,    block: 0 },
  warrior:  { dodge: 0.03, parry: 0.06, block: 0 },
  defender: { dodge: 0.02, parry: 0.05, block: 0.30 },
  archer:   { dodge: 0.06, parry: 0.02, block: 0 },
  caster:   { dodge: 0.04, parry: 0,    block: 0 },
  rogue:    { dodge: 0.10, parry: 0.05, block: 0 },
  brute:    { dodge: 0.01, parry: 0.03, block: 0 },
};

// ---------------------------------------------------------------------------
// Threat
// ---------------------------------------------------------------------------
// Monsters keep a running tally of who has wronged them. Damage, healing and
// taunts all write to it; the monster fights whoever is at the top. A newcomer
// has to beat the current target by a margin to pull it off them, so aggro
// doesn't flicker between two people doing the same damage.
export const THREAT = {
  perDamage: 1,         // a point of damage is a point of threat
  perHeal: 0.5,         // healing is half as loud, and spread over everything fighting the healed
  meleeMargin: 1.10,    // beat the current target by 10% to take it (30% from range)
  rangedMargin: 1.30,
  decay: 0.02,          // per second, so a fight that drags doesn't fossilise its table
};
export function addThreat(m, id, amount) {
  if (!m || !m.alive || !(amount > 0)) return;
  if (!m.threat) m.threat = new Map();
  m.threat.set(id, (m.threat.get(id) || 0) + amount);
}
export function threatOf(m, id) { return (m.threat && m.threat.get(id)) || 0; }
// Wipe one player from a monster's table (they died, zoned, or were feigned).
export function dropThreat(m, id) { if (m.threat) m.threat.delete(id); }
export function clearThreat(m) { if (m.threat) m.threat.clear(); }
// Put a player firmly on top: a taunt sets them a margin above the leader.
export function taunt(m, id) {
  if (!m.threat) m.threat = new Map();
  let top = 0; for (const v of m.threat.values()) top = Math.max(top, v);
  m.threat.set(id, Math.max(threatOf(m, id), top * THREAT.meleeMargin + 10));
}
// Who the monster should be fighting. `reach(id)` says whether that player is
// close enough to be worth turning on; the current target keeps it unless
// someone clears the margin.
export function topThreat(m, isValid, inMelee) {
  if (!m.threat || !m.threat.size) return null;
  let best = null, bestV = 0;
  for (const [id, v] of m.threat) {
    if (!isValid(id)) { m.threat.delete(id); continue; }
    if (v > bestV) { bestV = v; best = id; }
  }
  if (best == null) return null;
  const cur = m.targetId;
  if (cur == null || cur === best || !isValid(cur)) return best;
  const margin = inMelee(best) ? THREAT.meleeMargin : THREAT.rangedMargin;
  return bestV > threatOf(m, cur) * margin ? best : cur;
}
export function decayThreat(m, dt) {
  if (!m.threat || !m.threat.size) return;
  const k = 1 - THREAT.decay * dt;
  for (const [id, v] of m.threat) { const n = v * k; if (n < 1) m.threat.delete(id); else m.threat.set(id, n); }
}
