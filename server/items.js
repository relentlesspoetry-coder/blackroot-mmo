// Blackroot — items.
//
// Anything with a `slot` can be worn; everything else is material or trash that
// exists to be sold or handed in. Bonuses are deliberately flat and readable:
// `atk` is added to both ends of the player's damage roll, `def` is subtracted
// from each incoming hit (never below 1, so armour can't make you immortal).

export const SLOTS = ['weapon', 'body', 'trinket'];

export const ITEMS = {
  // --- weapons ---
  'Bronze Dagger':        { slot: 'weapon',  atk: 2,  level: 1, value: 30,
    desc: 'Short, light, and better than your fists.' },
  'Iron Sword':           { slot: 'weapon',  atk: 4,  level: 3, value: 160,
    desc: 'Honest iron. Bandits carry them; bandits lose them.' },
  'Ogre Club':            { slot: 'weapon',  atk: 7, level: 6, value: 420,
    desc: 'A tree with a grip worn into it. Heavy going.' },

  // --- body ---
  'Goblin Mail':          { slot: 'body',    def: 2,  level: 1, value: 45,
    desc: 'Scavenged scraps, lashed together. Smells of goblin.' },
  'Leather Body':         { slot: 'body',    def: 4,  level: 3, value: 190,
    desc: 'Boiled leather. Turns a blade more often than not.' },

  // --- trinkets ---
  'Smuggler\u2019s Trinket': { slot: 'trinket', def: 1, atk: 1, level: 1, value: 80,
    desc: 'Someone wanted this badly enough to hide it.' },
  'Smuggler\'s Cache':    { slot: 'trinket', def: 2,  level: 2, value: 140,
    desc: 'The contents of a niche nobody came back for.' },
  'Crystalline Relic':    { slot: 'trinket', def: 5,  level: 6, value: 600,
    desc: 'Cold to hold. The light inside it moves on its own.' },
  'Guardian\'s Heartwood': { slot: 'trinket', atk: 3, def: 3, level: 8, value: 900,
    desc: 'Rootbound heartwood, still warm. It remembers being a man.' },

  // --- materials & trash (no slot) ---
  'Cowhide':      { value: 6 },
  'Raw Beef':     { value: 5 },
  'Raw Chicken':  { value: 4 },
  'Feather':      { value: 1 },
  'Bones':        { value: 2 },
  'Big Bones':    { value: 9 },
  'Spider Silk':  { value: 18 },
  'Venom Sac':    { value: 26 },
  'Goblin Ear':   { value: 4 },
  'Stolen Pendant': { value: 35 },
  'Kebab':        { value: 8 },
};

export function itemDef(name) { return ITEMS[name] || null; }
export function slotOf(name) { const d = ITEMS[name]; return d && d.slot ? d.slot : null; }
export function valueOf(name) {
  const d = ITEMS[name];
  if (d && d.value) return d.value;
  return /Trophy/.test(name) ? 250 : 5; // elite trophies are the fallback case
}

// Summed bonuses for a set of equipped item names, e.g. {weapon:'Iron Sword'}.
export function equipStats(equipment) {
  let atk = 0, def = 0;
  for (const slot of SLOTS) {
    const d = ITEMS[equipment[slot]];
    if (!d) continue;
    atk += d.atk || 0;
    def += d.def || 0;
  }
  return { atk, def };
}

// What a player at this level can realistically be wearing — used by
// tools/balance.mjs so the fight table reflects a geared character, not a
// naked one.
export function expectedGear(level) {
  const eq = {};
  if (level >= 6) eq.weapon = 'Ogre Club';
  else if (level >= 3) eq.weapon = 'Iron Sword';
  else if (level >= 2) eq.weapon = 'Bronze Dagger';
  if (level >= 3) eq.body = 'Leather Body';
  else if (level >= 2) eq.body = 'Goblin Mail';
  if (level >= 6) eq.trinket = 'Crystalline Relic';
  else if (level >= 2) eq.trinket = 'Smuggler\'s Cache';
  return eq;
}
