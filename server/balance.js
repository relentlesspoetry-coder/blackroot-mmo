// Blackroot — combat & progression maths.
// Split out of server.js so the numbers can be measured without booting the
// server (see tools/balance.mjs). Nothing in here has side effects.

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
export const PLAYER = {
  speed: 8,
  radius: 0.6,
  attackRange: 3.0,
  attackCooldown: 1.5,   // seconds between swings (deliberate, OSRS-ish pace)
  hitChance: 0.85,       // 15% miss
  respawnTime: 5,
};

export function maxHpForLevel(level) { return 80 + (level - 1) * 28; }
export function xpForLevel(level) { return Math.floor(50 * Math.pow(level, 1.6)); }

// ---------------------------------------------------------------------------
// OSRS-style combat maths
// ---------------------------------------------------------------------------
export const TICK = 0.6;               // one game tick, seconds (OSRS)
export const DEFAULT_ATTACK_SPEED = 4; // ticks between swings for a typical weapon
// Attack-style stances: each grants a hidden +bonus to a stat and trains a skill.
export const STYLES = {
  accurate:   { atk: 3, str: 0, def: 0, train: 'attack' },
  aggressive: { atk: 0, str: 3, def: 0, train: 'strength' },
  defensive:  { atk: 0, str: 0, def: 3, train: 'defence' },
  controlled: { atk: 1, str: 1, def: 1, train: 'shared' },
};
export const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'];
// Hitpoints starts at level 10 (like OSRS); HP scales from there.
export function hpForHitpoints(hpLevel) { return 80 + (hpLevel - 10) * 10; }
export function combatLevel(sk) {
  return Math.floor(0.25 * (sk.defence.level + sk.hitpoints.level) + 0.325 * (sk.attack.level + sk.strength.level));
}
// Max hit from strength. The divisor is tuned (vs OSRS's 640) so this game's
// HP pools die at a similar pace to the old damage model.
export function maxHit(strLevel, strBonus, styleStr) {
  const eff = strLevel + styleStr + 8;
  return Math.max(1, Math.floor(0.5 + eff * (strBonus + 64) / 120));
}
export function attackRoll(atkLevel, atkBonus, styleAtk) {
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
export function rollSwing(atk, str, atkBonus, strBonus, style, defLevel, defBonus) {
  const s = STYLES[style] || STYLES.controlled;
  const ar = attackRoll(atk, atkBonus, s.atk);
  const dr = defenceRoll(defLevel, defBonus);
  if (Math.random() >= hitChance(ar, dr)) return 0;
  return Math.floor(Math.random() * (maxHit(str, strBonus, s.str) + 1));
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
  // Wild woodland rabbit: skittish, quick, harmless — small game for early XP.
  rabbit: { name: 'Rabbit', hp: 8, dmg: [1, 1], speed: 6, aggro: 0, xp: 6, respawn: 15, passive: true,
    loot: [ { item: 'Raw Rabbit', w: 55 }, { item: 'Rabbit Pelt', w: 40 }, { item: 'Bones', w: 20 }, { item: 'Coins', min: 1, max: 4, w: 15 } ] },
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
export const MEDITATION = {
  baseHp: 3,        // hp/sec at level 1
  perLevel: 0.6,    // extra hp/sec per Meditation level
  xpPerHp: 2,       // Meditation xp earned per point of HP recovered
};
export function meditationHealRate(level) { return MEDITATION.baseHp + (level - 1) * MEDITATION.perLevel; }
