// Blackroot — items.
//
// Anything with a `slot` can be worn; everything else is material or trash that
// exists to be sold or handed in. Bonuses are deliberately flat and readable:
// `atk` is added to both ends of the player's damage roll, `def` is subtracted
// from each incoming hit (never below 1, so armour can't make you immortal).

// Full equipment layout. `col` and `row` place the slot in the client's
// paper-doll window; the server itself only cares about the list.
// Full equipment layout. `x`/`y` place the slot on the paper doll, in a
// 300x328 stage the client draws the character silhouette behind — helmet at
// the head, gloves and rings out at the hands, boots at the feet. The server
// only cares about the list; the coordinates are here so the layout stays one
// authored thing rather than being half in the client.
export const DOLL = { w: 300, h: 328, slot: 50 };
export const SLOT_INFO = {
  helmet:   { label: 'Helmet',    x: 125, y: 0 },
  necklace: { label: 'Necklace',  x: 125, y: 58 },
  chest:    { label: 'Chest',     x: 125, y: 116 },
  legs:     { label: 'Legs',      x: 125, y: 190 },
  boots:    { label: 'Boots',     x: 125, y: 248 },
  earring_l:{ label: 'L Earring', x: 48,  y: 14 },
  shoulders:{ label: 'Shoulders', x: 48,  y: 104 },
  ring_l:   { label: 'L Ring',    x: 48,  y: 162 },
  gloves:   { label: 'Gloves',    x: 48,  y: 220 },
  weapon:   { label: 'Weapon',    x: 48,  y: 278 },
  earring_r:{ label: 'R Earring', x: 202, y: 14 },
  cape:     { label: 'Cape',      x: 202, y: 104 },
  ring_r:   { label: 'R Ring',    x: 202, y: 162 },
  offhand:  { label: 'Offhand',   x: 202, y: 220 },
};
export const SLOTS = Object.keys(SLOT_INFO);

// Paired slots: an item declaring the base slot may go in either side, and
// equipping picks the empty one. Rings and earrings come in twos.
export const SLOT_PAIRS = { ring: ['ring_l', 'ring_r'], earring: ['earring_l', 'earring_r'] };
export function slotsFor(slot) { return SLOT_PAIRS[slot] || [slot]; }
export function emptySlots() {
  const eq = {};
  for (const s of SLOTS) eq[s] = null;
  return eq;
}

export const ITEMS = {
  // --- weapons ---
  'Bronze Dagger':        { slot: 'weapon',  atk: 2,  level: 1, value: 30,
    desc: 'Short, light, and better than your fists.' },
  'Iron Sword':           { slot: 'weapon',  atk: 4,  level: 3, value: 160,
    desc: 'Honest iron. Bandits carry them; bandits lose them.' },
  'Ogre Club':            { slot: 'weapon',  atk: 7, level: 6, value: 420,
    desc: 'A tree with a grip worn into it. Heavy going.' },

  // --- pickaxes (weapon slot; mining checks the bag, so you can swap freely) ---
  'Bronze Pickaxe':       { slot: 'weapon',  atk: 1,  level: 1, value: 60,
    desc: 'Blunt, heavy, and the only thing between you and the rock.' },
  'Iron Pickaxe':         { slot: 'weapon',  atk: 2,  level: 1, value: 220,
    desc: 'Bites deeper than bronze. Needs mining 10.' },
  'Steel Pickaxe':        { slot: 'weapon',  atk: 3,  level: 3, value: 700,
    desc: 'Properly tempered. Needs mining 25.' },
  'Mithril Pickaxe':      { slot: 'weapon',  atk: 5,  level: 5, value: 2200,
    desc: 'Light for its bite. Needs mining 45.' },

  "Giant's Stone Maul":   { slot: 'weapon',  atk: 10, level: 7, value: 1400,
    desc: 'A boulder lashed to a shaft. Swings like weather.' },

  // --- offhand ---
  "Guardian's Iron Shield": { slot: 'offhand', def: 6, level: 6, value: 900,
    desc: 'Taller than most men. The Guardian carried it like a plate.' },

  // --- body ---
  'Goblin Mail':          { slot: 'chest',    def: 2,  level: 1, value: 45,
    desc: 'Scavenged scraps, lashed together. Smells of goblin.' },
  'Leather Body':         { slot: 'chest',    def: 4,  level: 3, value: 190,
    desc: 'Boiled leather. Turns a blade more often than not.' },

  'Spiderfang Dagger':    { slot: 'weapon',  atk: 5,  level: 4, value: 260,
    desc: 'A fang the length of a forearm, bound to a grip. Still weeps.' },

  // --- jewellery & cape ---
  'Smuggler\u2019s Trinket': { slot: 'ring',    def: 1, atk: 1, level: 1, value: 80,
    desc: 'Someone wanted this badly enough to hide it.' },
  'Smuggler\'s Cache':    { slot: 'necklace', def: 2,  level: 2, value: 140,
    desc: 'The contents of a niche nobody came back for.' },
  'Hardened Carapace':    { slot: 'chest',   def: 5,  level: 5, value: 300,
    desc: 'Spider plate, boiled and strapped. Lighter than it looks.' },
  'Crystal Heart':        { slot: 'necklace', atk: 2, def: 2, level: 5, value: 380,
    desc: 'It keeps a slow beat you can feel through your glove.' },
  "Broodmother's Signet": { slot: 'ring',    atk: 5, def: 2, level: 8, value: 850,
    desc: 'Taken from the deep chamber. The spiders give it a wide berth.' },
  'Living Crystal Core':  { slot: 'necklace', atk: 3, def: 4, level: 8, value: 1100,
    desc: 'Still growing. It is warm on the side facing your chest.' },
  "Ancient Giant's Signet": { slot: 'ring',  atk: 4, def: 3, level: 9, value: 1600,
    desc: 'Sized for a finger thicker than your wrist. It resizes itself.' },
  'Crystalline Relic':    { slot: 'necklace', def: 5,  level: 6, value: 600,
    desc: 'Cold to hold. The light inside it moves on its own.' },
  'Guardian\'s Heartwood': { slot: 'cape', atk: 3, def: 3, level: 8, value: 900,
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
  'Chitin Fragment': { value: 12 },
  'Spider Fang':  { value: 22 },
  'Venomous Fang': { value: 40 },
  'Venom Gland':  { value: 34 },
  'Pristine Silk': { value: 55 },
  'Sticky Webbing': { value: 14 },
  'Uncut Quartz': { value: 30 },
  'Cave Mushroom': { value: 7 },
  'Spiderling Pet Egg': { value: 400 },
  'Cave Giant Pet Stone': { value: 900 },
  // --- cave giant materials ---
  'Giant Bones':    { value: 26 },
  'Giant Tusk':     { value: 85 },
  'Rough Hide':     { value: 45 },
  'Cave Moss':      { value: 9 },
  'Stone Fragment': { value: 6 },
  'Leather Straps': { value: 14 },
  'Crystal Shard':  { value: 70 },
  'Uncut Emerald':  { value: 180 },
  // --- ores (see server/mining.js for what yields them) ---
  'Copper Ore':     { value: 8 },
  'Tin Ore':        { value: 8 },
  'Iron Ore':       { value: 24 },
  'Silver Ore':     { value: 60 },
  'Coal':           { value: 45 },
  'Gold Ore':       { value: 140 },
  'Mithril Ore':    { value: 320 },
  'Adamantite Ore': { value: 700 },
  'Runite Ore':     { value: 2400 },
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
  // Only gear a player could actually be holding at this level. The shield,
  // the maul and both signets drop from the two elites, so listing them at the
  // level of the fight they come from assumed the player had already won it --
  // which made both bosses read a full point softer than they are.
  if (level >= 9) eq.weapon = "Giant's Stone Maul";
  else if (level >= 6) eq.weapon = 'Ogre Club';
  else if (level >= 3) eq.weapon = 'Iron Sword';
  else if (level >= 2) eq.weapon = 'Bronze Dagger';
  if (level >= 5) eq.body = 'Hardened Carapace';
  else if (level >= 3) eq.body = 'Leather Body';
  else if (level >= 2) eq.body = 'Goblin Mail';
  if (level >= 9) eq.offhand = "Guardian's Iron Shield";
  if (level >= 8) eq.cape = "Guardian's Heartwood";
  // The Broodmother's signet comes off the Broodmother, so it cannot be part
  // of the kit you bring to that fight.
  if (level >= 10) eq.ring_l = "Broodmother's Signet";
  else if (level >= 2) eq.ring_l = 'Smuggler\u2019s Trinket';
  if (level >= 6) eq.necklace = 'Crystalline Relic';
  else if (level >= 2) eq.necklace = "Smuggler's Cache";
  return eq;
}

