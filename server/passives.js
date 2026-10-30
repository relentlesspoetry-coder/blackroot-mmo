// Alpha passive loadouts. Small, additive bonuses; no maximum-resource changes.
export const PASSIVE_LIMIT = 3;
export const PASSIVE_SLOT_LEVELS = Object.freeze([5, 15, 30]);
export function passiveSlotLimit(p) { return PASSIVE_SLOT_LEVELS.filter(level => Number.isFinite(p?.level) && p.level >= level).length; }
const make = (id, name, desc, effect, value, extra = {}) => ({ id, name, desc, effect, value, level: 1, ...extra });
export const PASSIVES = {
  fighter: [
    make('momentum', 'Momentum', 'Heavy attacks build up to 5 Momentum: 2% attack speed each. Learn from your trainer at level 5.', 'momentum', 1, { level: 5, learned: true }),
    make('heavy_hands', 'Heavy Hands', '+3% weapon damage.', 'weaponDamage', .03),
    make('keen_edge', 'Keen Edge', '+2 percentage points of critical chance.', 'crit', .02),
    make('ironhide', 'Ironhide', 'Take 3% less direct damage. Does not reduce periodic damage.', 'directDR', .03),
    make('last_stand', 'Last Stand', 'Below 35% health, take 3% less direct damage.', 'woundedDR', .03),
    make('fighting_spirit', 'Fighting Spirit', 'Generate 6% more Rage from combat. Does not increase refunds or the Rage cap.', 'rageGain', .06),
    make('executioner', 'Executioner', '+4% weapon damage against targets below 30% health.', 'executeDamage', .04),
  ],
  cleric: [
    make('grace', 'Grace', '+3% healing done.', 'healing', .03),
    make('light_touch', 'Light Touch', 'Healing spells cost 3% less mana.', 'healingCost', .03),
    make('firm_wards', 'Firm Wards', 'Your shields absorb 4% more damage.', 'absorb', .04),
    make('holy_conviction', 'Holy Conviction', '+4% holy damage.', 'holyDamage', .04),
    make('composure', 'Composure', 'Cast spells 3% faster.', 'castSpeed', .03),
    make('devotion', 'Devotion', 'Natural mana regeneration is 4% faster.', 'manaRegen', .04),
    make('resolve', 'Resolve', 'Take 3% less direct damage. Does not reduce periodic damage.', 'directDR', .03),
  ],
  bard: [
    make('resonance', 'Resonance', '+4% sonic damage.', 'sonicDamage', .04),
    make('frugal_verse', 'Frugal Verse', 'Bard abilities cost 3% less mana.', 'bardCost', .03),
    make('quick_rhythm', 'Quick Rhythm', 'Weapon attacks are 3% faster.', 'attackSpeed', .03),
    make('nimble_performer', 'Nimble Performer', 'Move 3% faster.', 'moveSpeed', .03),
    make('meditative_melody', 'Meditative Melody', 'Natural mana regeneration is 4% faster.', 'manaRegen', .04),
    make('resilience', 'Resilience', 'Take 3% less direct damage. Does not reduce periodic damage.', 'directDR', .03),
    make('songcraft', 'Songcraft', 'Your healing songs restore 3% more health.', 'songHealing', .03),
  ],
};
// Catalogue order is the alpha progression: one new choice every five levels.
for (const list of Object.values(PASSIVES)) list.forEach((passive, i) => { passive.level = (i + 1) * 5; });
export function passiveAvailable(p, a) { return !!a && p.level >= a.level && (!a.learned || !!p.known?.has(a.id)); }
export function sanitizePassives(p, ids) {
  if (!Array.isArray(ids)) return [];
  const catalogue = PASSIVES[p.cls] || [];
  return [...new Set(ids.filter(id => typeof id === 'string' && passiveAvailable(p, catalogue.find(a => a.id === id))))].slice(0, passiveSlotLimit(p));
}
export function restorePassives(p, ids) {
  // Only old characters who already bought Momentum keep it equipped by default.
  return ids === undefined ? (p.cls === 'fighter' && p.known?.has('momentum') && p.level >= 5 ? ['momentum'] : []) : sanitizePassives(p, ids);
}
export function passiveValue(p, effect) {
  return sanitizePassives(p, p.passives).reduce((sum, id) => {
    const a = PASSIVES[p.cls].find(a => a.id === id);
    return sum + (a.effect === effect ? a.value : 0);
  }, 0);
}
export function passiveDirectMult(p, damage = {}) {
  if (damage.isPeriodic) return 1;
  const dr = passiveValue(p, 'directDR') + (p.hp < p.maxHp * .35 ? passiveValue(p, 'woundedDR') : 0);
  return 1 - Math.min(.1, dr);
}
export function passiveWeaponMult(p, target) {
  return 1 + passiveValue(p, 'weaponDamage') + (target && target.hp < target.maxHp * .3 ? passiveValue(p, 'executeDamage') : 0);
}
