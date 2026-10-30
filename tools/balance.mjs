// Seeded, unbuffed auto-attack diagnostics using the live combat attack table.
// This is not a playtest or a verdict about encounter difficulty.
import { CLASSES, DEFAULT_CLASS, classDef, classStats, scaledMonster, ELITE, TICK,
  MONSTER_TEMPLATES } from '../server/balance.js';
import { ITEMS, equipStats, expectedGear, slotsFor } from '../server/items.js';
import { weaponProfile, swingSeconds, swingBand, resolveAttack, MOB_DEF, MOB_ARCH, archOf } from '../server/combat.js';
import { mulberry32 } from '../server/worldgen.js';
import { blackroot } from '../server/zones/blackroot.js';
import { spiderden } from '../server/zones/spiderden.js';

const cls = process.env.CLASS || DEFAULT_CLASS;
if (!CLASSES[cls]) throw new Error(`Unknown CLASS=${cls}; choose ${Object.keys(CLASSES).join(', ')}`);
const seed = Number(process.env.SEED ?? 20261030);
if (!Number.isSafeInteger(seed)) throw new Error('SEED must be a safe integer');
const samples = 10000;
const bare = process.env.BARE === '1';
const pad = (s, n) => String(s).padEnd(n);
const num = n => Number.isFinite(n) ? n.toFixed(2) : 'infinite';

// expectedGear is only an illustrative legacy progression loadout, not evidence
// that a class has earned this gear. Canonicalise its slots from item metadata.
function equipment(level) {
  if (bare) return {};
  const eq = {};
  for (const name of Object.values(expectedGear(level))) {
    const item = ITEMS[name];
    if (item?.slot && (item.level || 1) <= level) eq[slotsFor(item.slot)[0]] = name;
  }
  if (!eq.weapon && classDef(cls).startWeapon) eq.weapon = classDef(cls).startWeapon;
  if (weaponProfile(eq.weapon).hands === 2) delete eq.offhand;
  return eq;
}
function player(level) {
  const eq = equipment(level), gear = equipStats(eq), cs = classStats(cls, level);
  const weapon = weaponProfile(eq.weapon), shield = ITEMS[eq.offhand];
  return {
    eq, gear, cs, weapon,
    attack: {
      level: cs.atk, hitBonus: (gear.atk || 0) * 0.004, type: weapon.type,
      crit: (classDef(cls).critBase || 0.05) + (weapon.crit || 0),
      critMult: classDef(cls).critMult || 2,
      band: swingBand(weapon, cs.str, gear.atk || 0), mult: 1,
    },
    defence: {
      level: cs.def, dodge: 0.03 + cs.def * 0.0012,
      parry: weapon.unarmed ? 0 : 0.04 + cs.def * 0.001,
      block: shield?.def ? 0.14 + cs.def * 0.0015 : 0,
      blockAmt: shield?.def ? Math.round(shield.def * 1.8 + level * 0.8) : 0,
      armour: gear.def || 0, facing: true,
    },
  };
}
function monster(spec, elite) {
  const m = scaledMonster(spec.type, spec.level), arch = archOf(spec.type);
  if (elite) {
    m.hp = Math.round(m.hp * (spec.hpMult || ELITE.hp));
    m.maxHit = Math.max(1, Math.round(m.maxHit * (spec.dmgMult || ELITE.dmg)));
    m.atkBonus = Math.round(m.atkBonus * 1.5);
    m.defBonus = Math.round(m.defBonus * 1.5);
  }
  const a = MOB_DEF[arch] || MOB_DEF.beast, mid = m.maxHit * 0.5;
  return {
    ...m,
    attack: {
      level: m.atkLevel || 1, hitBonus: (m.atkBonus || 0) * 0.004,
      type: (MOB_ARCH[arch] || MOB_ARCH.warrior).dmgType,
      crit: elite ? 0.08 : 0.05, critMult: 1.8,
      band: [Math.max(1, Math.round(mid * 0.72)), Math.max(2, Math.round(mid * 1.28))], mult: 1,
    },
    defence: {
      level: m.defLevel || 1, dodge: a.dodge, parry: a.parry, block: a.block,
      blockAmt: Math.round(a.block ? 3 + spec.level * 1.4 : 0),
      armour: m.defBonus || 0, facing: true,
    },
  };
}
function meanDamage(attack, defence, rng) {
  let total = 0;
  for (let i = 0; i < samples; i++) total += resolveAttack(attack, defence, rng).dmg;
  return total / samples;
}

console.log(`\n=== ${CLASSES[cls].name}: seeded auto-attack estimate (seed ${seed}, ${samples} swings/direction) ===`);
console.log('Live zones: Blackroot (composed surface) and Spider Den. Facing head-on, no active buffs.');
console.log('Excludes abilities, spells, momentum, healing/regen, enrage, movement, AI and adds.');
console.log('Times are HP / sampled DPS, not simulated fight completion or a win/loss verdict.');
console.log(bare ? 'Loadout: completely unequipped.' : 'Loadout: illustrative expectedGear progression (not class progression validation), with class starter weapon fallback.');
if (process.env.REGEN) console.log('REGEN is obsolete and has no effect; this model excludes healing.');
console.log('\n' + pad('level', 7) + pad('HP', 7) + pad('swing band', 13) + pad('period s', 12) + 'equipment');
for (let level = 1; level <= 10; level++) {
  const p = player(level);
  console.log(pad(level, 7) + pad(p.cs.hp, 7) + pad(p.attack.band.join('-'), 13) + pad(num(swingSeconds(p.weapon)), 12) + (Object.values(p.eq).join(', ') || 'none'));
}
for (const zone of [blackroot, spiderden]) {
  console.log(`\n=== ${zone.name} ===`);
  console.log(pad('encounter', 35) + pad('mLv/pLv', 10) + pad('HP', 8) + pad('out DPS', 10) + pad('in DPS', 10) + pad('kill s', 11) + pad('survive s', 12) + 'survive/kill');
  for (const [elite, specs] of [[false, zone.spawns || []], [true, zone.elites || []]]) {
    for (const spec of specs) {
      const level = spec.expect || (elite ? spec.level : spec.level + 1);
      const p = player(level), m = monster(spec, elite), rng = mulberry32(seed);
      const outgoing = meanDamage(p.attack, m.defence, rng) / swingSeconds(p.weapon);
      const incoming = meanDamage(m.attack, p.defence, rng) / (m.attackSpeed * TICK);
      const kill = m.hp / outgoing, survive = p.cs.hp / incoming;
      const label = (elite ? '★ ' : '') + (spec.name || spec.hint || MONSTER_TEMPLATES[spec.type].name);
      console.log(pad(label, 35) + pad(`${spec.level}/${level}`, 10) + pad(m.hp, 8) + pad(num(outgoing), 10) + pad(num(incoming), 10) + pad(num(kill), 11) + pad(num(survive), 12) + num(survive / kill) + (MONSTER_TEMPLATES[spec.type].passive ? ' (passive until attacked)' : ''));
    }
  }
}
