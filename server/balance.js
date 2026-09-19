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
  attackCooldown: 0.6,   // seconds between swings
  hitChance: 0.85,       // 15% miss
  respawnTime: 5,
};

export function maxHpForLevel(level) { return 80 + (level - 1) * 28; }
export function xpForLevel(level) { return Math.floor(50 * Math.pow(level, 1.6)); }

// Damage scales with level — without this the player's dps is frozen at level 1
// while monsters keep scaling, which makes everything past the creek unwinnable.
// A weapon's `atk` shifts the whole roll up.
export function playerDamageRange(level, atkBonus = 0) {
  return [3 + level + atkBonus, 8 + Math.round(2.2 * level) + atkBonus];
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

// `passive` mobs never initiate combat (classic cows/chickens); `respawn` is
// seconds; `loot` is a weighted table rolled on death (an entry with item
// 'Coins' drops a coin pile; item null = nothing that roll).
export const MONSTER_TEMPLATES = {
  goblin: { name: 'Goblin', hp: 35, dmg: [2, 5], speed: 4.5, aggro: 12, xp: 28, respawn: 25, rolls: 1,
    loot: [ { item: 'Coins', min: 5, max: 20, w: 55 }, { item: 'Bronze Dagger', w: 10 }, { item: 'Goblin Mail', w: 6 }, { item: 'Goblin Ear', w: 26 }, { item: null, w: 30 } ] },
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
    loot: [ { item: 'Coins', min: 50, max: 140, w: 50 }, { item: 'Big Bones', w: 30 }, { item: 'Uncut Quartz', w: 16 }, { item: 'Cave Mushroom', w: 18 }, { item: 'Steel Pickaxe', w: 6 }, { item: null, w: 24 } ] },
  crystal_giant: { name: 'Crystal Cave Giant', hp: 170, dmg: [9, 16], speed: 3.6, aggro: 14, xp: 240, respawn: 70, rolls: 2,
    loot: [ { item: 'Coins', min: 70, max: 180, w: 48 }, { item: 'Uncut Quartz', w: 26 }, { item: 'Crystal Heart', w: 12 }, { item: 'Big Bones', w: 22 }, { item: 'Steel Pickaxe', w: 7 }, { item: 'Mithril Pickaxe', w: 2 }, { item: null, w: 20 } ] },
  cow: { name: 'Cow', hp: 40, dmg: [1, 3], speed: 3, aggro: 0, xp: 20, respawn: 25, passive: true, rolls: 2,
    loot: [ { item: 'Cowhide', w: 70 }, { item: 'Raw Beef', w: 60 }, { item: 'Coins', min: 1, max: 8, w: 20 } ] },
  chicken: { name: 'Chicken', hp: 12, dmg: [1, 1], speed: 3, aggro: 0, xp: 8, respawn: 18, passive: true, rolls: 2,
    loot: [ { item: 'Feather', min: 5, max: 15, w: 80 }, { item: 'Raw Chicken', w: 60 }, { item: 'Bones', w: 80 } ] },
};

export function scaledMonster(type, level) {
  const t = MONSTER_TEMPLATES[type];
  const fh = 1 + MONSTER.hpScale * (level - 1);
  const fd = 1 + MONSTER.dmgScale * (level - 1);
  return {
    hp: Math.round(t.hp * fh),
    dmg: [Math.max(1, Math.round(t.dmg[0] * fd)), Math.max(1, Math.round(t.dmg[1] * fd))],
    speed: t.speed, aggro: t.aggro,
    xp: Math.round(t.xp * (1 + MONSTER.xpScale * (level - 1))),
  };
}

export function rollLoot(type) {
  const t = MONSTER_TEMPLATES[type]; const drops = [];
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
