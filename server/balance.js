// Blackroot — combat & progression maths.
// Split out of server.js so the numbers can be measured without booting the
// server (see tools/balance.mjs). Nothing in here has side effects.

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
import { ARMOR_ITEMS, WEAPON_ITEMS } from './items.js';

export const PLAYER = {
  speed: 8,
  radius: 0.6,
  attackRange: 3.0,
  attackCooldown: 1.5,   // seconds between swings (deliberate, OSRS-ish pace)
  hitChance: 0.85,       // 15% miss
  respawnTime: 5,
};

export function maxHpForLevel(level) { return 80 + (level - 1) * 28; }
// One XP curve for everything that levels — the adventure level, the combat
// skills, meditation, mining, fishing and cooking: the OSRS table, levels
// 1..99 (83 xp to level 2, 1,154 to 10, 13,363 to 30, 101,333 to 50,
// 13,034,431 to 99). Skills bank a running TOTAL of xp; level, progress into
// the level and the cost of the next one are all read off the table.
export const MAX_LEVEL = 99;
export const XP_TABLE = (() => {           // XP_TABLE[level] = total xp at which that level is reached
  const t = [0, 0]; let pts = 0;
  for (let l = 1; l < MAX_LEVEL; l++) { pts += Math.floor(l + 300 * Math.pow(2, l / 7)); t[l + 1] = Math.floor(pts / 4); }
  return t;
})();
export function xpTotalForLevel(level) { return XP_TABLE[Math.max(1, Math.min(MAX_LEVEL, level))]; }
export function xpForLevel(level) { return level >= MAX_LEVEL ? Infinity : XP_TABLE[level + 1] - XP_TABLE[level]; } // xp from this level to the next
export function levelForXp(total) { let l = 1; while (l < MAX_LEVEL && total >= XP_TABLE[l + 1]) l++; return l; }
export function progressForXp(total) { const level = levelForXp(total); return { level, into: total - XP_TABLE[level], next: xpForLevel(level) }; }

// ---------------------------------------------------------------------------
// OSRS-style combat maths
// ---------------------------------------------------------------------------
export const TICK = 0.6;               // one game tick, seconds (OSRS)
export const DEFAULT_ATTACK_SPEED = 4; // ticks between swings for a typical weapon
// ---------------------------------------------------------------------------
// Classes. There are no separate attack/strength/defence/hitpoints skills:
// a character has one class and one class level (the OSRS 1..99 curve), and
// the class says what that level is worth in the OSRS combat rolls below —
// effective attack / strength / defence and the HP pool — plus which
// abilities sit on the action bar and when they unlock.
// ---------------------------------------------------------------------------
export const CLASSES = {
  fighter: {
    name: 'Fighter', icon: 'ui/fighter/emblem.png', background: 'ui/fighter/background.jpg',
    desc: 'A two-handed melee bruiser: heavy swings, cleaves, staggers and execute pressure, paid for with rage and exposure. Not a tank.',
    resource: 'Rage',
    atk: (L) => 6 + L,             // effective levels fed to the OSRS accuracy / max-hit rolls
    str: (L) => 6 + L,
    def: (L) => 4 + L,             // light armour: a little behind the hitting stats
    hp:  (L) => 80 + (L - 1) * 10, // max hitpoints
    // Rage: starts empty and is built by fighting — landing blows, taking
    // blows, and simply being in the fight — then bleeds away once the fight
    // is over. Every ability spends it.
    rage: { max: 100, autoHit: 8, abilityHit: 4, damageTaken: 0.6, combatTick: 2.5, decay: 6, decayDelay: 8 },
    gcd: 1.5,                      // global cooldown between abilities
    // (class xp comes from kills — each monster's xp value — never per hit)
    critBase: 0.05, critMult: 1.5,
    // Momentum: heavy attacks stack it (max 5, 5 min), +2% attack speed a stack;
    // some abilities spend it.
    momentum: { max: 5, dur: 300, atkSpeedPerStack: 0.02 },
    // Ability damage = flat × levelScale + wd × (weapon roll). The weapon roll is
    // 60–100% of the class max hit; levelScale runs 0.25 at level 1 to 1.0 at 20
    // so the flat part grows into the spec's level-20 numbers. Every hit still
    // passes an OSRS accuracy roll first. `heavy` abilities spend Weapon Flow.
    abilities: [
      { id: 'heavy_swing', name: 'Heavy Swing', level: 1, cost: 12, cd: 3, kind: 'melee', flat: 16, wd: 1.5, momentum: 1, heavy: true,
        desc: 'A slow, heavy two-handed strike. Generates Momentum (2 on a crit).' },
      { id: 'cleave', name: 'Cleave', level: 2, cost: 18, cd: 6, kind: 'cone', cone: 100, cap: 3, flat: 10, wd: 1.05, momentumIf2: 1,
        desc: 'Swing in a wide arc, hitting up to 3 enemies in front of you. Generates Momentum if it hits 2+.' },
      { id: 'battle_rush', name: 'Battle Rush', level: 3, cost: 20, cd: 20, kind: 'rush', range: 20, buff: { id: 'rushing_force', dur: 300, charges: 1, dmg: 0.25 },
        desc: 'Charge to a target within 20m. Your next melee ability deals +25% damage.' },
      { id: 'crushing_blow', name: 'Crushing Blow', level: 4, cost: 26, cd: 10, kind: 'melee', flat: 24, wd: 1.35, momentum: 1, heavy: true, debuff: { id: 'crushed_armor', dur: 12 },
        desc: 'Smash the enemy, reducing its armour by 8% for 12s. Generates Momentum.' },
      { id: 'momentum', name: 'Momentum', level: 5, passive: true,
        desc: 'Passive. Heavy attacks build Momentum (max 5, 5 min): +2% attack speed per stack. Some abilities spend it.' },
      { id: 'groundbreaker', name: 'Groundbreaker', level: 6, cost: 38, cd: 18, kind: 'aoe', radius: 6, cap: 5, flat: 34, wd: 1.2, stagger: 0.75, momentumIf2: 1, heavy: true,
        desc: 'Slam the ground: damages and staggers (0.75s) up to 5 enemies within 6m. More vs Crushed Armour.' },
      { id: 'reckless_strike', name: 'Reckless Strike', level: 7, cost: 34, cd: 12, kind: 'melee', flat: 40, wd: 2.2, momentum: 1, heavy: true, selfDebuff: { id: 'reckless_exposure', dur: 8, taken: 0.08 },
        desc: 'A brutal strike. You take +8% damage for 8s afterwards.' },
      { id: 'heavy_riposte', name: 'Heavy Riposte', level: 8, cost: 18, cd: 8, kind: 'melee', flat: 30, wd: 1.8, momentum: 1, requires: 'riposte_ready',
        desc: 'After an enemy misses you, answer with a heavy counter. +15% crit chance if used within 3s.' },
      { id: 'weapon_flow', name: 'Weapon Flow', level: 9, cost: 45, cd: 45, kind: 'self', buff: { id: 'weapon_flow', dur: 300, charges: 2, dmg: 0.18, heavyOnly: true },
        desc: 'Your next 2 heavy-weapon abilities deal +18% damage.' },
      { id: 'armor_splitter', name: 'Armor Splitter', level: 10, cost: 52, cd: 18, kind: 'melee', flat: 46, wd: 1.6, momentum: 1, debuff: { id: 'split_guard', dur: 10 },
        desc: 'Drive through the guard: the target takes +8% physical damage for 10s.' },
      { id: 'savage_momentum', name: 'Savage Momentum', level: 11, cost: 60, cd: 60, kind: 'self', buff: { id: 'savage_watcher', dur: 1800 },
        desc: 'For 30 min, killing or critically hitting an enemy grants +12% move speed and +8% melee damage for 6 melee abilities (once per 20s).' },
      { id: 'bonebreaker', name: 'Bonebreaker', level: 12, cost: 64, cd: 25, kind: 'melee', flat: 42, wd: 1.45, momentum: 1, debuff: { id: 'bonebreak', dur: 10 },
        desc: 'Crush the limbs: the target moves 40% slower for 10s and attacks 15% slower for 8s.' },
      { id: 'whirlwind_cleave', name: 'Whirlwind Cleave', level: 13, cost: 82, cd: 30, kind: 'channel', radius: 6, cap: 6, ticks: 3, flat: 55, wd: 0.7,
        desc: 'Spin for 3s, hitting up to 6 enemies within 6m each second. You move at 60% while spinning.' },
      { id: 'final_swing', name: 'Final Swing', level: 14, cost: 76, cd: 12, kind: 'execute', flat: 62, wd: 1.9, momentum: 1,
        desc: 'Only on targets at or below 30% HP: up to +75% damage the closer they are to death. Refunds 30 rage on a kill.' },
      { id: 'bloodrush', name: 'Bloodrush', level: 15, cost: 90, cd: 180, kind: 'self', buff: { id: 'bloodrush', dur: 300, charges: 10, dmg: 0.18, crit: 0.12, taken: 0.08 },
        desc: '+18% melee damage and +12% crit chance for 10 melee abilities. You take +8% damage while it lasts.' },
      { id: 'shatter_guard', name: 'Shatter Guard', level: 16, cost: 92, cd: 30, kind: 'melee', flat: 70, wd: 1.75, momentum: 1,
        desc: 'A heavy impact that breaks a defensive shield or guard if the enemy has one (+30% damage when it does).' },
      { id: 'titan_chop', name: 'Titan Chop', level: 17, cost: 110, cd: 45, kind: 'melee', windup: 1, flat: 100, wd: 3.0, momentum: 1, heavy: true,
        desc: 'A 1s wind-up overhead strike for massive damage. Crits deal +20% at 3+ Momentum.' },
      { id: 'unstoppable_footwork', name: 'Unstoppable Footwork', level: 18, cost: 70, cd: 90, kind: 'self', buff: { id: 'footwork', dur: 300, move: 0.10 },
        desc: 'Break free of snares and move 10% faster for 5 min.' },
      { id: 'berserkers_roar', name: "Berserker's Roar", level: 19, cost: 120, cd: 300, kind: 'self', buff: { id: 'berserkers_roar', dur: 300, charges: 8, dmg: 0.15, taken: 0.10, radius: 2 },
        desc: '+15% melee damage and +2m to cleave radius for 8 melee abilities. You take +10% damage.' },
      { id: 'perfect_masterstroke', name: 'Perfect Masterstroke', level: 20, cost: 160, cd: 120, kind: 'melee', flat: 150, wd: 2.8, spendMomentum: { flat: 30, wd: 0.35 }, heavy: true,
        desc: 'The capstone: spends all Momentum for +30 damage and +35% weapon damage per stack. +15% vs Split Guard. Refunds 50 rage on a kill.' },
    ],
  },
};
// Learning: only the level-1 ability is known from the start; everything
// else is bought from the class trainer once the level is reached.
export function abilityCost(a) { return a.level <= 1 ? 0 : 15 + a.level * a.level * 4; } // L2 31gp .. L10 415gp .. L20 1,615gp
export const DEFAULT_CLASS = 'fighter';
export function classDef(id) { return CLASSES[id] || CLASSES[DEFAULT_CLASS]; }
export function classStats(id, level) {
  const c = classDef(id);
  return { atk: c.atk(level), str: c.str(level), def: c.def(level), hp: c.hp(level), rage: c.rage ? c.rage.max : 0 };
}
// Max hit from strength. The divisor is tuned (vs OSRS's 640) so this game's
// HP pools die at a similar pace to the old damage model.
export function maxHit(strLevel, strBonus, styleStr = 0) {
  const eff = strLevel + styleStr + 8;
  return Math.max(1, Math.floor(0.5 + eff * (strBonus + 64) / 120));
}
export function attackRoll(atkLevel, atkBonus, styleAtk = 0) {
  return (atkLevel + styleAtk + 8) * (atkBonus + 64);
}
export function defenceRoll(defLevel, defBonus) {
  return (defLevel + 8) * (defBonus + 64);
}
// Chance a swing lands, given the attacker's roll vs the defender's roll.
export function hitChance(atkRoll, defRoll) {
  return atkRoll > defRoll ? 1 - (defRoll + 2) / (2 * (atkRoll + 1)) : atkRoll / (2 * (defRoll + 1));
}
// One swing. Returns damage (0 = a miss / blocked hit -> blue "0" splat).
export function rollSwing(atk, str, atkBonus, strBonus, defLevel, defBonus, dmgMult = 1) {
  const ar = attackRoll(atk, atkBonus);
  const dr = defenceRoll(defLevel, defBonus);
  if (Math.random() >= hitChance(ar, dr)) return 0;
  return Math.floor(Math.random() * (Math.floor(maxHit(str, strBonus) * dmgMult) + 1));
}
// A monster's swing: accuracy from its levels/bonuses, damage 0..its max hit.
export function rollMonsterSwing(atkLevel, atkBonus, mh, defLevel, defBonus) {
  const ar = attackRoll(atkLevel, atkBonus, 0), dr = defenceRoll(defLevel, defBonus);
  if (Math.random() >= hitChance(ar, dr)) return 0;
  return Math.floor(Math.random() * (mh + 1));
}

// Damage scales with level — without this the player's dps is frozen at level 1
// while monsters keep scaling, which makes everything past the creek unwinnable.
// A weapon's `atk` shifts the whole roll up.
export function playerDamageRange(level, atkBonus = 0) {
  // A level-1 hits softly (1-5); damage ramps with level and gear.
  return [1 + Math.floor(level * 0.5) + atkBonus, 3 + Math.round(2.4 * level) + atkBonus];
}
export function rollPlayerDamage(level, atkBonus = 0) {
  const [lo, hi] = playerDamageRange(level, atkBonus);
  if (Math.random() >= PLAYER.hitChance) return 0;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

// Armour reduces each incoming hit by a percentage with diminishing returns —
// flat subtraction collapsed the whole curve once a player had any gear at all
// (a +10 shield turned a Hill Ogre into a rounding error). A landed blow always
// does at least 1, so defence can never make a player untouchable.
export const DEF_SOFTCAP = 25;
export function damageReduction(defBonus = 0) {
  return defBonus <= 0 ? 0 : defBonus / (defBonus + DEF_SOFTCAP);
}
export function mitigate(damage, defBonus = 0) {
  if (damage <= 0) return 0;
  return Math.max(1, Math.round(damage * (1 - damageReduction(defBonus))));
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------
export const MONSTER = {
  hpScale: 0.30,      // hp multiplier per level above 1
  dmgScale: 0.16,     // damage grows slower than hp, so fights get longer,
  xpScale: 0.35,      // not spikier, as you move south
  attackCooldown: 1.2,
  hitChance: 0.80,
};

// Elites are the named encounters. Tuned so a player at the elite's level wins
// with roughly a tenth of their health left — see tools/balance.mjs.
export const ELITE = { hp: 2.2, dmg: 1.0, xp: 4, leash: 14 };

// ---------------------------------------------------------------------------
// Independent-roll drop tables. Unlike the weighted `loot` table (one pick per
// roll), every entry here rolls on its own, so a single kill can drop several
// items. `always` = guaranteed; `chance: N` = 1/N per kill.
// Specs are [item, minQty, maxQty, [chanceA, chanceB, chanceC]] where a chance
// of 0 means guaranteed and the array columns are the creature variants.
// ---------------------------------------------------------------------------
function buildDropTable(spec, col) {
  return spec.map(([item, min, max, ch]) => {
    const c = ch[col], e = { item };
    if (!(min === 1 && max === 1)) { e.min = min; e.max = max; }
    if (c === 0) e.always = true; else e.chance = c;
    return e;
  });
}
// Cave / Venom / Crystal spiders.
const SPIDER_DROPS = [
  ['Spider Silk', 1, 3, [0, 0, 0]],
  ['Spider Fang', 1, 1, [0, 0, 0]],
  ['Coins', 5, 25, [3, 4, 5]],
  ['Chitin Fragment', 1, 2, [5, 8, 6]],
  ['Sticky Webbing', 1, 1, [10, 15, 20]],
  ['Cave Mushroom', 1, 2, [20, 35, 50]],
  ['Venom Gland', 1, 1, [75, 12, 150]],
  ['Uncut Quartz', 1, 1, [100, 200, 25]],
  ['Pristine Silk', 1, 1, [150, 175, 125]],
  ['Hardened Carapace', 1, 1, [250, 350, 100]],
  ['Venomous Fang', 1, 1, [750, 200, 1000]],
  ['Spiderfang Dagger', 1, 1, [1000, 800, 1250]],
  ['Crystal Heart', 1, 1, [2500, 3000, 500]],
  ["Broodmother's Signet", 1, 1, [5000, 4000, 3500]],
  ['Spiderling Pet Egg', 1, 1, [10000, 10000, 10000]],
];
// Moss / Crystal cave giants and the Cave Guardian.
const GIANT_DROPS = [
  ['Giant Bones', 1, 1, [0, 0, 0]],
  ['Rough Hide', 1, 3, [0, 0, 0]],
  ['Coins', 20, 80, [3, 4, 2]],
  ['Stone Fragment', 2, 5, [5, 6, 10]],
  ['Iron Ore', 1, 3, [12, 15, 8]],
  ['Cave Moss', 1, 2, [8, 60, 80]],
  ['Crystal Shard', 1, 2, [75, 10, 100]],
  ['Leather Straps', 1, 2, [25, 40, 15]],
  ['Giant Tusk', 1, 1, [60, 75, 50]],
  ['Uncut Emerald', 1, 1, [200, 125, 250]],
  ["Giant's Stone Maul", 1, 1, [400, 1200, 1000]],
  ["Guardian's Iron Shield", 1, 1, [1500, 2000, 500]],
  ['Living Crystal Core', 1, 1, [3000, 750, 4000]],
  ["Ancient Giant's Signet", 1, 1, [5000, 4500, 3500]],
  ['Cave Giant Pet Stone', 1, 1, [10000, 10000, 10000]],
];
// Goblin loot (Goblin_Loot_Items pack). One shared table across the six goblin
// variants; the chance columns are [Scavenger, Miner, Warrior, Archer, Shaman,
// Chief] and a chance of 1 means guaranteed. Every entry rolls independently.
const GOB = { scavenger: 0, miner: 1, warrior: 2, archer: 3, shaman: 4, chief: 5 };
const GOBLIN_DROPS = [
  ['Bones', 1, 1, [1, 1, 1, 1, 1, 1]],
  ['Coins', 5, 30, [2, 2, 2, 2, 2, 2]],
  ['Ragged Cloth', 1, 3, [4, 8, 10, 6, 4, 12]],
  ['Leather Scraps', 1, 2, [6, 8, 5, 4, 12, 8]],
  ['Rope', 1, 1, [12, 8, 25, 10, 30, 20]],
  ['Iron Ore', 1, 3, [25, 4, 20, 40, 50, 15]],
  ['Coal', 1, 3, [35, 6, 30, 50, 60, 20]],
  ['Wooden Arrow Shafts', 5, 15, [20, 40, 30, 4, 50, 25]],
  ['Iron Arrowheads', 5, 10, [40, 25, 20, 8, 80, 20]],
  ['Cave Mushroom', 1, 2, [15, 12, 35, 25, 6, 20]],
  ['Goblin Tooth', 1, 1, [30, 35, 20, 30, 40, 12]],
  ['Uncut Quartz', 1, 1, [150, 40, 200, 200, 100, 60]],
  ['Rusty Dagger', 1, 1, [80, 200, 150, 250, 300, 150]],
  ['Worn Pickaxe', 1, 1, [300, 100, 500, 500, 750, 250]],
  ['Goblin Shortbow', 1, 1, [400, 600, 500, 125, 750, 300]],
  ['Battered Iron Shield', 1, 1, [500, 600, 150, 600, 800, 200]],
  ['Bone Charm', 1, 1, [600, 750, 500, 650, 175, 250]],
  ["Shaman's Spirit Stone", 1, 1, [3000, 3000, 2500, 3000, 500, 1000]],
  ["Chief's Bronze Signet", 1, 1, [5000, 5000, 4000, 5000, 3500, 750]],
  ['Goblin Pet Totem', 1, 1, [15000, 15000, 15000, 15000, 15000, 7500]],
];

// `passive` mobs never initiate combat (classic cows/chickens); `respawn` is
// seconds; `loot` is a weighted table rolled on death (an entry with item
// 'Coins' drops a coin pile; item null = nothing that roll). Cave creatures use
// `droptable` (independent rolls) instead — assigned just below.
export const MONSTER_TEMPLATES = {
  goblin: { name: 'Goblin', hp: 35, dmg: [2, 5], speed: 4.5, aggro: 12, xp: 28, respawn: 25,
    droptable: buildDropTable(GOBLIN_DROPS, GOB.scavenger) },
  bandit: { name: 'Bandit', hp: 55, dmg: [4, 9], speed: 5.5, aggro: 15, xp: 48, respawn: 35, rolls: 1,
    loot: [ { item: 'Coins', min: 15, max: 60, w: 55 }, { item: 'Leather Body', w: 10 }, { item: 'Iron Sword', w: 7 }, { item: 'Kebab', w: 12 }, { item: 'Stolen Pendant', w: 14 }, { item: null, w: 26 } ] },
  guard: { name: 'Hill Ogre', hp: 95, dmg: [6, 11], speed: 4.0, aggro: 14, xp: 130, respawn: 55, rolls: 2,
    loot: [ { item: 'Coins', min: 40, max: 120, w: 55 }, { item: 'Ogre Club', w: 8 }, { item: 'Big Bones', w: 30 }, { item: 'Iron Pickaxe', w: 7 }, { item: null, w: 25 } ] },
  spider: { name: 'Cave Spider', hp: 48, dmg: [3, 7], speed: 5.5, aggro: 13, xp: 45, respawn: 35, rolls: 1,
    loot: [ { item: 'Coins', min: 5, max: 25, w: 45 }, { item: 'Spider Silk', w: 22 }, { item: 'Chitin Fragment', w: 20 }, { item: 'Spider Fang', w: 10 }, { item: null, w: 30 } ] },
  venom_spider: { name: 'Venom Spider', hp: 44, dmg: [5, 10], speed: 6.2, aggro: 15, xp: 62, respawn: 35, rolls: 1,
    loot: [ { item: 'Coins', min: 10, max: 35, w: 40 }, { item: 'Venom Gland', w: 20 }, { item: 'Venomous Fang', w: 14 }, { item: 'Sticky Webbing', w: 18 }, { item: null, w: 28 } ] },
  crystal_spider: { name: 'Crystal Spider', hp: 70, dmg: [4, 9], speed: 4.8, aggro: 12, xp: 78, respawn: 40, rolls: 2,
    loot: [ { item: 'Coins', min: 15, max: 45, w: 40 }, { item: 'Uncut Quartz', w: 24 }, { item: 'Crystal Heart', w: 8 }, { item: 'Hardened Carapace', w: 9 }, { item: null, w: 30 } ] },
  bat: { name: 'Cave Bat', hp: 22, dmg: [2, 5], speed: 7.5, aggro: 16, xp: 22, respawn: 20, rolls: 1,
    loot: [ { item: 'Coins', min: 2, max: 12, w: 40 }, { item: 'Cave Mushroom', w: 25 }, { item: 'Bones', w: 35 }, { item: null, w: 35 } ] },
  cave_giant: { name: 'Moss Cave Giant', hp: 140, dmg: [8, 14], speed: 3.8, aggro: 14, xp: 190, respawn: 60, rolls: 2,
    loot: [ { item: 'Coins', min: 50, max: 140, w: 46 }, { item: 'Giant Bones', w: 28 }, { item: 'Cave Moss', w: 24 },
            { item: 'Rough Hide', w: 18 }, { item: 'Stone Fragment', w: 22 }, { item: 'Giant Tusk', w: 9 },
            { item: 'Leather Straps', w: 14 }, { item: 'Steel Pickaxe', w: 6 }, { item: null, w: 22 } ] },
  crystal_giant: { name: 'Crystal Cave Giant', hp: 170, dmg: [9, 16], speed: 3.6, aggro: 14, xp: 240, respawn: 70, rolls: 2,
    loot: [ { item: 'Coins', min: 70, max: 180, w: 44 }, { item: 'Crystal Shard', w: 26 }, { item: 'Giant Bones', w: 20 },
            { item: 'Uncut Emerald', w: 10 }, { item: 'Stone Fragment', w: 18 }, { item: 'Living Crystal Core', w: 4 },
            { item: "Giant's Stone Maul", w: 3 }, { item: 'Mithril Pickaxe', w: 2 },
            { item: 'Cave Giant Pet Stone', w: 1 }, { item: null, w: 18 } ] },
  cow: { name: 'Cow', hp: 40, dmg: [1, 3], speed: 3, aggro: 0, xp: 20, respawn: 25, passive: true, rolls: 2,
    loot: [ { item: 'Cowhide', w: 70 }, { item: 'Raw Beef', w: 60 }, { item: 'Coins', min: 1, max: 8, w: 20 } ] },
  chicken: { name: 'Chicken', hp: 12, dmg: [1, 1], speed: 3, aggro: 0, xp: 8, respawn: 18, passive: true,
    // Independent-roll drop table (Chicken_Loot_Pack): each entry rolls on its own.
    droptable: [
      { item: 'Feather', min: 2, max: 6, always: true }, // 2–6, guaranteed
      { item: 'Bones', always: true },                   // 1, guaranteed
      { item: 'Raw Chicken', chance: 1.25 },             // 1, 4/5 (80%)
      { item: 'Egg', chance: 12 },                       // 1, 1/12 (~8.3%)
    ] },
  // The Cave Guardian — a hulking variant that guards the Deep Chamber.
  cave_guardian: { name: 'Cave Guardian', hp: 210, dmg: [10, 18], speed: 3.6, aggro: 14, xp: 300, respawn: 80, rolls: 1,
    loot: [ { item: 'Coins', min: 40, max: 120, w: 1 } ] },
  // The Broodmother — the spiders' queen, guarding her nest.
  broodmother: { name: 'Broodmother', hp: 90, dmg: [6, 11], speed: 5.0, aggro: 14, xp: 110, respawn: 120, rolls: 1,
    loot: [ { item: 'Coins', min: 20, max: 60, w: 1 } ] },
  // --- Goblin-kin variants that populate the deeper Dark Woods camps ---
  goblin_scavenger: { name: 'Goblin Scavenger', hp: 28, dmg: [2, 5], speed: 6.0, aggro: 13, xp: 30, respawn: 22,
    droptable: buildDropTable(GOBLIN_DROPS, GOB.scavenger) },
  goblin_warrior: { name: 'Goblin Warrior', hp: 62, dmg: [5, 9], speed: 4.8, aggro: 14, xp: 58, respawn: 30,
    droptable: buildDropTable(GOBLIN_DROPS, GOB.warrior) },
  goblin_archer: { name: 'Goblin Archer', hp: 42, dmg: [5, 10], speed: 5.2, aggro: 16, xp: 52, respawn: 30,
    droptable: buildDropTable(GOBLIN_DROPS, GOB.archer) },
  goblin_shaman: { name: 'Goblin Shaman', hp: 50, dmg: [6, 11], speed: 4.6, aggro: 15, xp: 66, respawn: 34,
    droptable: buildDropTable(GOBLIN_DROPS, GOB.shaman) },
  goblin_miner: { name: 'Goblin Miner', hp: 46, dmg: [3, 7], speed: 4.6, aggro: 12, xp: 48, respawn: 30,
    droptable: buildDropTable(GOBLIN_DROPS, GOB.miner) },
  goblin_chief: { name: 'Goblin Chief', hp: 130, dmg: [7, 13], speed: 4.4, aggro: 16, xp: 165, respawn: 60,
    droptable: buildDropTable(GOBLIN_DROPS, GOB.chief) },
  // Wyrms lairing at the edges of the woods — rare, dangerous elites.
  ember_dragon: { name: 'Ember Dragon', hp: 420, dmg: [14, 26], speed: 5.0, aggro: 18, xp: 900, respawn: 240, rolls: 3,
    loot: [ { item: 'Coins', min: 200, max: 500, w: 50 }, { item: 'Giant Bones', w: 24 }, { item: 'Crystal Heart', w: 14 }, { item: 'Uncut Emerald', w: 12 }, { item: 'Living Crystal Core', w: 6 }, { item: "Giant's Stone Maul", w: 3 } ] },
  frost_dragon: { name: 'Frost Dragon', hp: 460, dmg: [12, 24], speed: 4.6, aggro: 18, xp: 940, respawn: 260, rolls: 3,
    loot: [ { item: 'Coins', min: 220, max: 520, w: 50 }, { item: 'Giant Bones', w: 24 }, { item: 'Crystal Shard', w: 16 }, { item: 'Uncut Emerald', w: 12 }, { item: 'Living Crystal Core', w: 6 }, { item: 'Mithril Pickaxe', w: 3 } ] },
  venom_dragon: { name: 'Venom Dragon', hp: 380, dmg: [15, 28], speed: 5.6, aggro: 19, xp: 880, respawn: 240, rolls: 3,
    loot: [ { item: 'Coins', min: 180, max: 460, w: 50 }, { item: 'Venom Gland', w: 22 }, { item: 'Crystal Heart', w: 14 }, { item: 'Uncut Emerald', w: 12 }, { item: 'Living Crystal Core', w: 6 }, { item: "Giant's Stone Maul", w: 3 } ] },
};

// Independent drop tables for the cave creatures (see SPIDER_DROPS / GIANT_DROPS).
MONSTER_TEMPLATES.spider.droptable = buildDropTable(SPIDER_DROPS, 0);
MONSTER_TEMPLATES.venom_spider.droptable = buildDropTable(SPIDER_DROPS, 1);
MONSTER_TEMPLATES.crystal_spider.droptable = buildDropTable(SPIDER_DROPS, 2);
MONSTER_TEMPLATES.cave_giant.droptable = buildDropTable(GIANT_DROPS, 0);
MONSTER_TEMPLATES.crystal_giant.droptable = buildDropTable(GIANT_DROPS, 1);
MONSTER_TEMPLATES.cave_guardian.droptable = buildDropTable(GIANT_DROPS, 2);
MONSTER_TEMPLATES.broodmother.droptable = buildDropTable(SPIDER_DROPS, 0);

export function scaledMonster(type, level) {
  const t = MONSTER_TEMPLATES[type];
  const fh = 1 + MONSTER.hpScale * (level - 1);
  const fd = 1 + MONSTER.dmgScale * (level - 1);
  const dmg = [Math.max(1, Math.round(t.dmg[0] * fd)), Math.max(1, Math.round(t.dmg[1] * fd))];
  return {
    hp: Math.round(t.hp * fh),
    dmg,
    speed: t.speed, aggro: t.aggro,
    xp: Math.round(t.xp * (1 + MONSTER.xpScale * (level - 1))),
    // OSRS-style combat stats: attack/defence levels & bonuses scale with level;
    // maxHit comes from the template's top-end damage. Kept modest so a fresh
    // player still lands blows reliably on low-level foes.
    atkLevel: Math.round(1 + level * 1.2),
    defLevel: level,
    atkBonus: Math.round(level * 1.2),
    defBonus: Math.round(level * 1.2),
    maxHit: dmg[1],
    attackSpeed: t.attackSpeed || 4, // ticks
  };
}

// ---------------------------------------------------------------------------
// Dark Woods gear drops: the armour wardrobe and the 20 weapons, layered on
// top of every creature's own loot. Each entry is one independent 1-in-N roll
// for a random piece of that tier (armour = any of the 32 pieces of the four
// sets at that tier; weapon = any weapon of that tier). Rarity climbs with the
// camps: the creek goblins spill tier-1 kit, the ogre hollow and the zone's
// elite are where tier 4-5 turns up, and every step up is a longer shot. The
// 30 rarity weapons share these tiers (Common..Legendary = 1..5); Mythic is a
// sixth tier only the top creatures and elites can drop, at very long odds.
// ---------------------------------------------------------------------------
const GEAR_DROPS = {
  goblin:           [['armor', 1, 40],  ['weapon', 1, 60],  ['armor', 2, 400], ['weapon', 2, 500]],
  goblin_scavenger: [['armor', 1, 45],  ['weapon', 1, 70],  ['armor', 2, 300], ['weapon', 2, 400]],
  bandit:           [['armor', 1, 60],  ['weapon', 1, 90],  ['armor', 2, 120], ['weapon', 2, 160], ['armor', 3, 700], ['weapon', 3, 900]],
  goblin_miner:     [['armor', 2, 110], ['weapon', 2, 150], ['armor', 3, 600], ['weapon', 3, 800]],
  goblin_warrior:   [['armor', 2, 100], ['weapon', 2, 140], ['armor', 3, 300], ['weapon', 3, 400], ['armor', 4, 1500], ['weapon', 4, 2000]],
  goblin_archer:    [['armor', 2, 100], ['weapon', 2, 140], ['armor', 3, 300], ['weapon', 3, 400], ['armor', 4, 1500], ['weapon', 4, 2000]],
  goblin_chief:     [['armor', 3, 60],  ['weapon', 3, 80],  ['armor', 4, 250], ['weapon', 4, 350], ['armor', 5, 2000], ['weapon', 5, 2500], ['weapon', 6, 12000]],
  guard:            [['armor', 3, 120], ['weapon', 3, 160], ['armor', 4, 500], ['weapon', 4, 700], ['armor', 5, 3000], ['weapon', 5, 4000], ['weapon', 6, 15000]],
  cow:              [['armor', 1, 400], ['weapon', 1, 600]],
  chicken:          [['armor', 1, 800], ['weapon', 1, 1200]],
  // dragons at the woods' edge: the top of the table, and not stingy about it
  ember_dragon:     [['armor', 4, 12], ['weapon', 4, 16], ['armor', 5, 60], ['weapon', 5, 80], ['weapon', 6, 500]],
  frost_dragon:     [['armor', 4, 12], ['weapon', 4, 16], ['armor', 5, 60], ['weapon', 5, 80], ['weapon', 6, 500]],
  venom_dragon:     [['armor', 4, 12], ['weapon', 4, 16], ['armor', 5, 60], ['weapon', 5, 80], ['weapon', 6, 500]],
};
// A named elite rolls its type's gear table at much better odds and always
// gets one extra shot at the tier above its best.
const ELITE_GEAR_LUCK = 8;
let gearPools = null;   // { armor: { tier: [names] }, weapon: { tier: [names] } }, built lazily from items.js
function buildGearPools() {
  gearPools = { armor: {}, weapon: {} };
  for (const [name, d] of Object.entries(ARMOR_ITEMS)) (gearPools.armor[d.tier] ||= []).push(name);
  for (const [name, d] of Object.entries(WEAPON_ITEMS)) (gearPools.weapon[d.tier] ||= []).push(name);
}
export function rollGear(type, elite = false) {
  if (!gearPools) buildGearPools();
  const table = GEAR_DROPS[type]; if (!table) return [];
  const drops = [];
  let top = 0;
  for (const [kind, tier, chance] of table) {
    top = Math.max(top, tier);
    if (Math.random() < 1 / (elite ? Math.max(1, chance / ELITE_GEAR_LUCK) : chance)) {
      const pool = gearPools[kind][tier]; if (pool && pool.length) drops.push({ item: pool[Math.floor(Math.random() * pool.length)], qty: 1 });
    }
  }
  if (elite) {
    // (mythic weapons are the sixth tier; armour stops at five)
    const tier = Math.min(6, top + 1), kind = tier > 5 || Math.random() >= 0.6 ? 'weapon' : 'armor';
    if (Math.random() < 1 / 3) { const pool = gearPools[kind][tier]; if (pool && pool.length) drops.push({ item: pool[Math.floor(Math.random() * pool.length)], qty: 1 }); }
  }
  return drops;
}
// For tooling / the loot editor: the gear table of a type as [kind, tier, 1-in-N].
export function gearTableOf(type) { return GEAR_DROPS[type] || []; }

export function rollLoot(type) {
  const t = MONSTER_TEMPLATES[type]; const drops = [];
  // Independent-roll table: each entry rolls on its own (may drop several).
  if (t.droptable) {
    for (const e of t.droptable) {
      if (e.always || Math.random() < 1 / e.chance) {
        const qty = e.min != null ? e.min + Math.floor(Math.random() * (e.max - e.min + 1)) : 1;
        drops.push({ item: e.item, qty });
      }
    }
    return drops;
  }
  const rolls = t.rolls || 1;
  for (let n = 0; n < rolls; n++) {
    let total = 0; for (const e of t.loot) total += e.w;
    let r = Math.random() * total, pick = null;
    for (const e of t.loot) { r -= e.w; if (r <= 0) { pick = e; break; } }
    if (!pick || pick.item == null) continue;
    const qty = pick.min != null ? pick.min + Math.floor(Math.random() * (pick.max - pick.min + 1)) : 1;
    drops.push({ item: pick.item, qty });
  }
  return drops;
}

// ---------------------------------------------------------------------------
// Analysis helpers (used by tools/balance.mjs and by nothing at runtime)
// ---------------------------------------------------------------------------
export function playerDps(level, atkBonus = 0) {
  const [lo, hi] = playerDamageRange(level, atkBonus);
  return ((lo + hi) / 2) * PLAYER.hitChance / PLAYER.attackCooldown;
}
// Incoming dps after armour. Mitigation is per hit, so it has to be applied to
// the average hit rather than to the dps total.
export function monsterDps(type, level, elite = false, defBonus = 0) {
  const s = scaledMonster(type, level);
  const mult = elite ? ELITE.dmg : 1;
  const avgHit = ((s.dmg[0] + s.dmg[1]) / 2) * mult;
  return mitigate(avgHit, defBonus) * MONSTER.hitChance / MONSTER.attackCooldown;
}
export function monsterHp(type, level, elite = false) {
  const s = scaledMonster(type, level);
  return Math.round(s.hp * (elite ? ELITE.hp : 1));
}
// Regen. It used to tick straight through a fight, which quietly paid for about
// a third of the incoming damage and made every boss softer than intended.
// Taking a hit now locks it out for a few seconds.
export const REGEN = {
  perSec: 2,            // outside a safe zone
  safePerSec: 17,       // resting at a campfire/shrine
  combatLockout: 5,     // seconds after being hit before regen resumes
};
export const PLAYER_REGEN_PER_SEC = REGEN.perSec;

// Meditation: sit and rest (R) to recover HP. The heal rate starts modest and
// scales with the Meditation level, so it ramps up slowly at low levels and
// heals much faster once trained. Meditating to heal is what trains the skill.
// Meditation heals in ticks, slowly: every `tick` seconds you recover
// `healPerTick(level)` hitpoints and earn Meditation xp (on the OSRS 1..99
// curve like every other skill). Level 1 is 1 HP every 2.4 s (80 HP in a bit
// over three minutes); level 20 is 6 HP a tick.
export const MEDITATION = {
  tick: 2.4,                       // seconds between heal ticks (4 game ticks)
  xpPerTick: 5,                    // base Meditation xp per tick
  xpPerHp: 2,                      // plus xp per hitpoint recovered
};
export function meditationHealPerTick(level) { return 1 + Math.floor(level / 4); }
export function meditationHealRate(level) { return meditationHealPerTick(level) / MEDITATION.tick; } // hp/sec, for tooling
