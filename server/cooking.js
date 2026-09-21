// Blackroot — cooking.
//
// Cook raw meat and fish at a campfire. Its own skill/level: higher Cooking
// means fewer burnt meals. Each raw food maps to a cooked result, an xp reward,
// a level requirement, and the level past which you stop burning it.

export const COOKING = {
  cookTime: 2.2,   // seconds per item cooked
  reach: 3.5,      // how close to the fire you must stand
  maxLevel: 60,
};

// raw -> { cooked, level, xp, noBurn } . `noBurn` is the Cooking level at which
// this food stops burning entirely; below it, burn chance scales down to there.
export const COOKABLES = {
  'Raw Shrimp':   { cooked: 'Shrimp',         level: 1,  xp: 15, noBurn: 12, heal: 12 },
  'Raw Chicken':  { cooked: 'Cooked Chicken', level: 1,  xp: 20, noBurn: 15, heal: 18 },
  'Raw Beef':     { cooked: 'Cooked Beef',    level: 2,  xp: 22, noBurn: 16, heal: 20 },
  'Raw Trout':    { cooked: 'Trout',          level: 10, xp: 40, noBurn: 28, heal: 28 },
  'Raw Salmon':   { cooked: 'Salmon',         level: 22, xp: 60, noBurn: 42, heal: 40 },
  'Raw Pike':     { cooked: 'Pike',           level: 34, xp: 85, noBurn: 55, heal: 55 },
};
export const BURNT = 'Burnt Food';

export function xpForCookingLevel(level) { return Math.floor(12 * Math.pow(level, 1.35)); }
export function cookingLevelFromXp(xp) {
  let level = 1, need = xpForCookingLevel(1), spent = 0;
  while (level < COOKING.maxLevel && xp >= spent + need) { spent += need; level++; need = xpForCookingLevel(level); }
  return { level, into: xp - spent, next: need };
}

// Chance a cook burns. Starts around 45% at the food's own level, falls linearly
// to 0 at its noBurn level.
export function burnChance(rawItem, cookingLevel) {
  const c = COOKABLES[rawItem];
  if (!c) return 1;
  if (cookingLevel >= c.noBurn) return 0;
  const span = Math.max(1, c.noBurn - c.level);
  const t = Math.max(0, (cookingLevel - c.level)) / span;   // 0 at req level, 1 at noBurn
  return Math.max(0, 0.45 * (1 - t));
}

// The raw foods a player is carrying that they can cook now (level met).
export function cookableInInventory(inventory, cookingLevel) {
  const out = [];
  for (const it of inventory) { const c = COOKABLES[it]; if (c && cookingLevel >= c.level && !out.includes(it)) out.push(it); }
  return out;
}
