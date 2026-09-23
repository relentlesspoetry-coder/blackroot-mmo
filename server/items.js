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
//
// The doll faces the viewer, so the character's left is on the viewer's right:
// the L slots sit in the right-hand column. Mirror x about 125 to turn it
// around again.
export const DOLL = { w: 300, h: 328, slot: 50 };
export const SLOT_INFO = {
  helmet:   { label: 'Helmet',    x: 125, y: 0 },
  necklace: { label: 'Necklace',  x: 125, y: 58 },
  chest:    { label: 'Chest',     x: 125, y: 116 },
  legs:     { label: 'Legs',      x: 125, y: 190 },
  boots:    { label: 'Boots',     x: 125, y: 248 },
  earring_l:{ label: 'L Earring', x: 202, y: 14 },
  shoulders:{ label: 'Shoulders', x: 202, y: 104 },
  ring_l:   { label: 'L Ring',    x: 202, y: 162 },
  gloves:   { label: 'Gloves',    x: 202, y: 220 },
  weapon:   { label: 'Weapon',    x: 202, y: 278 },
  earring_r:{ label: 'R Earring', x: 48,  y: 14 },
  cape:     { label: 'Cape',      x: 48,  y: 104 },
  ring_r:   { label: 'R Ring',    x: 48,  y: 162 },
  offhand:  { label: 'Offhand',   x: 48,  y: 220 },
  belt:     { label: 'Belt',      x: 48,  y: 278 },
};
export const SLOTS = Object.keys(SLOT_INFO);

// Paired slots: an item declaring the base slot may go in either side, and
// equipping picks the empty one. Rings and earrings come in twos.
export const SLOT_PAIRS = { ring: ['ring_l', 'ring_r'], earring: ['earring_l', 'earring_r'] };
export function slotsFor(slot) { return SLOT_PAIRS[slot] || [slot]; }
// What piles up in one bag slot. Anything you wear or wield is its own thing —
// two swords are two swords — but ore, fish, logs, food and the rest of the raw
// material of the world stack, the way a pouch of ore should.
export function stackable(name) {
  const d = ITEMS[name];
  return !!d && !d.slot;
}
// The bag as slots rather than loose items: identical stackables share one,
// keeping the order things were picked up in.
export function bagStacks(inventory) {
  const out = [], at = new Map();
  for (const name of inventory) {
    if (stackable(name)) {
      const i = at.get(name);
      if (i != null) { out[i].qty++; continue; }
      at.set(name, out.length);
    }
    out.push({ name, qty: 1 });
  }
  return out;
}
export function emptySlots() {
  const eq = {};
  for (const s of SLOTS) eq[s] = null;
  return eq;
}


// ---------------------------------------------------------------------------
// The Dark Woods armour wardrobe (Male_20_Armored_Outfits pack): 20 sets of 8
// pieces, five tiers each of leather, plate, padded cloth and magic robes. The
// pieces are generated from this table rather than written out 160 times.
// `gear` names the pack item the client dresses the character in; `def`/`atk`
// feed the OSRS-style rolls (+64 base), so a full tier-5 plate set is a real
// upgrade without making anyone untouchable.
// ---------------------------------------------------------------------------
export const ARMOR_SETS = [
  // [id, name, category, tier]
  ['01_Frontier_Hide',   'Frontier Hide',   'Leather', 1], ['02_Brigand_Studded', 'Brigand Studded', 'Leather', 2],
  ['03_Forest_Tracker',  'Forest Tracker',  'Leather', 3], ['04_Nightstalker',    'Nightstalker',    'Leather', 4],
  ['05_Drakehide_Warden','Drakehide Warden','Leather', 5],
  ['06_Bronze_Recruit',  'Bronze Recruit',  'Plate', 1],   ['07_Iron_Vanguard',   'Iron Vanguard',   'Plate', 2],
  ['08_Steel_Chevalier', 'Steel Chevalier', 'Plate', 3],   ['09_Gilded_Paladin',  'Gilded Paladin',  'Plate', 4],
  ['10_Obsidian_Warlord','Obsidian Warlord','Plate', 5],
  ['11_Padded_Militia',  'Padded Militia',  'Cloth', 1],   ['12_Crimson_Duelist', 'Crimson Duelist', 'Cloth', 2],
  ['13_Desert_Sentinel', 'Desert Sentinel', 'Cloth', 3],   ['14_Azure_Battleguard','Azure Battleguard','Cloth', 4],
  ['15_Royal_Warcoat',   'Royal Warcoat',   'Cloth', 5],
  ['16_Hedge_Mage',      'Hedge Mage',      'Magic', 1],   ['17_Azure_Arcanist',  'Azure Arcanist',  'Magic', 2],
  ['18_Ember_Sorcerer',  'Ember Sorcerer',  'Magic', 3],   ['19_Verdant_Oracle',  'Verdant Oracle',  'Magic', 4],
  ['20_Astral_Archmage', 'Astral Archmage', 'Magic', 5],
];
// Pack piece -> equipment slot, defence share of the set, and what the piece
// is called in each armour family.
export const ARMOR_PIECES = [
  // [packSlot, equipSlot, defShare, { Leather, Plate, Cloth, Magic }]
  ['Top',       'chest',     1.00, { Leather: 'Jerkin',         Plate: 'Cuirass',   Cloth: 'Tunic',      Magic: 'Robe' }],
  ['Trousers',  'legs',      0.80, { Leather: 'Leggings',       Plate: 'Greaves',   Cloth: 'Breeches',   Magic: 'Trousers' }],
  ['Helmet',    'helmet',    0.60, { Leather: 'Cap',            Plate: 'Helm',      Cloth: 'Hood',       Magic: 'Hat' }],
  ['Shoulders', 'shoulders', 0.50, { Leather: 'Shoulder Guards',Plate: 'Pauldrons', Cloth: 'Mantle',     Magic: 'Mantle' }],
  ['Boots',     'boots',     0.40, { Leather: 'Boots',          Plate: 'Sabatons',  Cloth: 'Boots',      Magic: 'Boots' }],
  ['Gloves',    'gloves',    0.35, { Leather: 'Gloves',         Plate: 'Gauntlets', Cloth: 'Gloves',     Magic: 'Gloves' }],
  ['Overlayer', 'cape',      0.40, { Leather: 'Cape',           Plate: 'Tassets',   Cloth: 'Coat Skirt', Magic: 'Robe Skirt' }],
  ['Belt',      'belt',      0.25, { Leather: 'Belt',           Plate: 'Belt',      Cloth: 'Sash',       Magic: 'Sash' }],
];
const ARMOR_TIER_DEF = [4, 7, 10, 14, 18];          // a plate Top at each tier
const ARMOR_TIER_LEVEL = [1, 3, 5, 7, 9];
const ARMOR_TIER_VALUE = [40, 120, 320, 800, 2000]; // a Top; other pieces scale by share
const ARMOR_FAMILY = {                              // defence multiplier, and a little attack for the fighting cloth / casting robes
  Leather: { def: 0.7,  atk: 0 },
  Plate:   { def: 1.0,  atk: 0 },
  Cloth:   { def: 0.55, atk: 1 },
  Magic:   { def: 0.4,  atk: 2 },
};
const ARMOR_DESC = {
  Leather: ['Cured hide, stitched for the road.', 'Studded leather; stops a knife, usually.', 'Tracker leather, dyed to the woods.', 'Black leather that drinks the light.', 'Drake scale over boiled hide. Turns fire.'],
  Plate:   ['Bronze plate, dented from the drill yard.', 'Iron plate. Heavy, honest, loud.', 'Steel plate with a knight\'s polish.', 'Gilded steel, fit for a temple guard.', 'Obsidian-black plate. Warlords wore this.'],
  Cloth:   ['Quilted militia padding.', 'Crimson duelling cloth, cut to move.', 'Sun-bleached sentinel cloth.', 'Azure battleguard cloth, silver-threaded.', 'A royal warcoat. Someone important lost it.'],
  Magic:   ['A hedge mage\'s homespun weave.', 'Arcanist blue, faintly humming.', 'Ember-red robes, warm to the touch.', 'Verdant oracle weave, alive with runes.', 'Astral robes. The runes move when you look away.'],
};
export const ARMOR_ITEMS = {};
for (const [id, setName, fam, tier] of ARMOR_SETS) {
  for (const [packSlot, slot, share, names] of ARMOR_PIECES) {
    const F = ARMOR_FAMILY[fam], name = `${setName} ${names[fam]}`;
    const def = Math.max(1, Math.round(ARMOR_TIER_DEF[tier - 1] * share * F.def));
    const atk = F.atk ? Math.max(1, Math.round(F.atk * tier * (share >= 0.8 ? 1 : 0.5))) : 0;
    const d = { slot, def, level: ARMOR_TIER_LEVEL[tier - 1], value: Math.round(ARMOR_TIER_VALUE[tier - 1] * (0.4 + 0.6 * share)),
      desc: ARMOR_DESC[fam][tier - 1], gear: `${id}__${packSlot}`, tier, family: fam, set: setName };
    if (atk) d.atk = atk;
    ARMOR_ITEMS[name] = d;
  }
}

// The 20 low-poly weapons (BlackRoot_20_LowPoly_Weapons pack). `model` is the
// pack file the client holds in the hand and lays on the ground; `len` is the
// length it should be scaled to (the pack's models are not to scale).
export const WEAPON_ITEMS = {
  // tier 1
  'Dagger':        { atk: 3,  level: 1, tier: 1, value: 35,   model: '05_Dagger',        len: 0.45, desc: 'A plain steel dagger. Quick in the hand.' },
  'Short Sword':   { atk: 4,  level: 1, tier: 1, value: 60,   model: '01_Short_Sword',   len: 0.8,  desc: 'The sword every recruit is handed first.' },
  'Sickle':        { atk: 3,  level: 1, tier: 1, value: 30,   model: '18_Sickle',        len: 0.6,  desc: 'A harvest blade. It cuts more than wheat.' },
  'Wand':          { atk: 3,  level: 1, tier: 1, value: 70,   model: '15_Wand',          len: 0.45, desc: 'A carved wand with a chip of crystal set in the tip.' },
  // tier 2
  'Whip':          { atk: 5,  level: 2, tier: 2, value: 110,  model: '19_Whip',          len: 1.2,  desc: 'Braided leather. Reaches further than it looks.' },
  'Throwing Axe':  { atk: 5,  level: 2, tier: 2, value: 90,   model: '20_Throwing_Axe',  len: 0.5,  desc: 'Balanced to fly. Works fine up close too.' },
  'Scimitar':      { atk: 6,  level: 2, tier: 2, value: 160,  model: '02_Scimitar',      len: 0.9,  desc: 'A curved blade that favours the fast.' },
  'Mace':          { atk: 7,  level: 3, tier: 2, value: 180,  model: '08_Mace',          len: 0.75, desc: 'Flanged iron on a short haft. Armour hates it.' },
  'Spear':         { atk: 7,  level: 3, tier: 2, value: 170,  model: '10_Spear',         len: 1.9,  desc: 'A long ash spear with a leaf-shaped head.' },
  // tier 3
  'Longsword':     { atk: 9,  level: 4, tier: 3, value: 380,  model: '03_Longsword',     len: 1.1,  desc: 'A knight\'s longsword, well balanced.' },
  'Battle Axe':    { atk: 10, level: 4, tier: 3, value: 400,  model: '06_Battle_Axe',    len: 0.9,  desc: 'A bearded axe that bites deep.' },
  'Bow':           { atk: 8,  level: 4, tier: 3, value: 340,  model: '12_Bow',           len: 1.4,  desc: 'A yew longbow with a hunter\'s draw.' },
  'Twin Claws':    { atk: 9,  level: 5, tier: 3, value: 420,  model: '16_Twin_Claws',    len: 0.5,  desc: 'Paired claw blades strapped to the forearm.' },
  'Flail':         { atk: 11, level: 5, tier: 3, value: 460,  model: '17_Flail',         len: 0.9,  desc: 'A spiked ball on a chain. Mind your own shins.' },
  // tier 4
  'Magic Staff':   { atk: 12, level: 6, tier: 4, value: 900,  model: '14_Magic_Staff',   len: 1.7,  desc: 'A staff crowned with a glowing crystal.' },
  'Crossbow':      { atk: 12, level: 6, tier: 4, value: 850,  model: '13_Crossbow',      len: 0.8,  desc: 'A heavy crossbow. Slow, but it goes through things.' },
  'Warhammer':     { atk: 14, level: 7, tier: 4, value: 1100, model: '09_Warhammer',     len: 1.0,  desc: 'A hammer that ends arguments with plate.' },
  'Halberd':       { atk: 15, level: 7, tier: 4, value: 1250, model: '11_Halberd',       len: 2.0,  desc: 'Axe, spike and hook on a long pole.' },
  // tier 5
  'Greataxe':      { atk: 18, level: 8, tier: 5, value: 2400, model: '07_Greataxe',      len: 1.3,  desc: 'A double-bitted greataxe. Two hands, no mercy.' },
  'Greatsword':    { atk: 20, level: 9, tier: 5, value: 3000, model: '04_Greatsword',    len: 1.5,  desc: 'A blade as tall as a man. Whoever carried it, carried the field.' },
};
// The 30 rarity weapons (BlackRoot_30_Rarity_Weapons pack), Common through
// Mythic. Rarity maps onto the same tiers as the armour (Mythic is a sixth
// tier above anything else in the game).
const RARITY_TIER = { Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Legendary: 5, Mythic: 6 };
const RARITY_WEAPONS = [
  // [name, rarity, atk, level, value, model, len, desc]
  ['Rusted Training Sword', 'Common', 3, 1, 25, '01_Rusted_Training_Sword', 0.8, 'The drill yard\'s cast-off. It still has an edge, mostly.'],
  ['Ashwood Club', 'Common', 4, 1, 30, '02_Ashwood_Club', 0.75, 'A knotted ash club studded with nails.'],
  ['Copper Dagger', 'Common', 3, 1, 35, '03_Copper_Dagger', 0.45, 'Soft metal, sharp enough.'],
  ['Hunter Shortbow', 'Common', 4, 1, 60, '04_Hunter_Shortbow', 1.1, 'A hunter\'s bow, wrapped in green cord.'],
  ['Iron Spear', 'Uncommon', 6, 2, 120, '05_Iron_Spear', 1.9, 'An iron-headed spear with a blue pennant.'],
  ['Bronze War Axe', 'Uncommon', 7, 2, 150, '06_Bronze_War_Axe', 0.95, 'A double-bitted bronze axe.'],
  ['Falcon Scimitar', 'Uncommon', 7, 3, 180, '07_Falcon_Scimitar', 0.95, 'A curved blade with a falcon-wing guard.'],
  ['Guard Mace', 'Uncommon', 8, 3, 200, '08_Guard_Mace', 0.8, 'Town guard issue. Dents helmets and skulls alike.'],
  ['Steel Longsword', 'Rare', 10, 4, 420, '09_Steel_Longsword', 1.1, 'Bright steel, gold-hilted, blue-wrapped.'],
  ['Ranger Crossbow', 'Rare', 10, 4, 440, '10_Ranger_Crossbow', 0.8, 'A ranger\'s crossbow set with green stones.'],
  ['Knight Halberd', 'Rare', 11, 5, 500, '11_Knight_Halberd', 2.0, 'A knight\'s halberd with a blue pennant.'],
  ['Moonfang Twin Daggers', 'Rare', 10, 5, 520, '12_Moonfang_Twin_Daggers', 0.5, 'A matched pair of curved steel fangs.'],
  ['Stormcaller Staff', 'Rare', 11, 5, 560, '13_Stormcaller_Staff', 1.7, 'Ice-blue crystal crowns a storm-scarred staff.'],
  ['Ember Warhammer', 'Rare', 12, 6, 620, '14_Ember_Warhammer', 1.0, 'A stone hammer head veined with living ember.'],
  ['Serpent Whip', 'Epic', 13, 6, 1100, '15_Serpent_Whip', 1.2, 'A segmented whip that ends in a serpent\'s head.'],
  ['Crystal Greatbow', 'Epic', 14, 7, 1300, '16_Crystal_Greatbow', 1.5, 'A greatbow grown over with ice crystal.'],
  ['Sunforged Claymore', 'Epic', 16, 7, 1500, '17_Sunforged_Claymore', 1.5, 'A claymore whose guard is a blazing sun.'],
  ['Void Pike', 'Epic', 15, 7, 1400, '18_Void_Pike', 2.0, 'A black pike tipped with void crystal.'],
  ['Runebound Flail', 'Epic', 16, 8, 1600, '19_Runebound_Flail', 0.9, 'A flail whose head is bound with purple runes.'],
  ['Shadow Reaver Scythe', 'Epic', 17, 8, 1800, '20_Shadow_Reaver_Scythe', 1.8, 'A reaper\'s scythe edged in violet shadow.'],
  ['Dragonfire Blade', 'Legendary', 19, 8, 3200, '21_Dragonfire_Blade', 1.1, 'A blade cracked with dragonfire that never cools.'],
  ['Frostbite Maul', 'Legendary', 21, 9, 3600, '22_Frostbite_Maul', 1.05, 'A maul sheathed in ice that never melts.'],
  ['Phoenix Talons', 'Legendary', 19, 9, 3400, '23_Phoenix_Talons', 0.5, 'Gold talons on crimson gauntlets, hot to the touch.'],
  ['Leviathan Trident', 'Legendary', 20, 9, 3600, '24_Leviathan_Trident', 1.9, 'A trident from the deep, still wet.'],
  ['Celestial Wand', 'Legendary', 18, 9, 3800, '25_Celestial_Wand', 0.5, 'A gold ring holding a star that never sets.'],
  ['Kingsguard Greataxe', 'Mythic', 25, 10, 8000, '26_Kingsguard_Greataxe', 1.4, 'The lion-crested axe of the old Kingsguard.'],
  ['Arcane Crescent Staff', 'Mythic', 24, 10, 8500, '27_Arcane_Crescent_Staff', 1.8, 'A crescent moon of black stone cradling arcane crystal.'],
  ['Doomspike Lance', 'Mythic', 27, 10, 9000, '28_Doomspike_Lance', 2.1, 'A barbed black lance with a blood-red spike.'],
  ['Worldroot Glaive', 'Mythic', 26, 10, 9000, '29_Worldroot_Glaive', 1.9, 'A glaive grown, not forged, from the Worldroot.'],
  ['Crownbreaker Relicblade', 'Mythic', 30, 10, 12000, '30_Crownbreaker_Relicblade', 1.4, 'The relic blade that ended a dynasty.'],
];
for (const [name, rarity, atk, level, value, model, len, desc] of RARITY_WEAPONS) {
  WEAPON_ITEMS[name] = { atk, level, tier: RARITY_TIER[rarity], rarity, value, model, len, desc };
}
for (const d of Object.values(WEAPON_ITEMS)) d.slot = 'weapon';

export const ITEMS = {
  ...ARMOR_ITEMS,
  ...WEAPON_ITEMS,
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
  'Egg':          { value: 3 },
  'Bones':        { value: 2 },
  // --- raw fish (from fishing) ---
  'Raw Shrimp':   { value: 3 },
  'Raw Trout':    { value: 8 },
  'Raw Salmon':   { value: 16 },
  'Raw Pike':     { value: 28 },
  // --- cooked food (from cooking; `heal` restores HP when eaten) ---
  'Shrimp':         { value: 5,  heal: 12 },
  'Cooked Chicken': { value: 6,  heal: 18 },
  'Cooked Beef':    { value: 8,  heal: 20 },
  'Trout':          { value: 14, heal: 28 },
  'Salmon':         { value: 26, heal: 40 },
  'Pike':           { value: 44, heal: 55 },
  'Burnt Food':   { value: 1 },
  // --- fishing rods (tools; held in the weapon slot, but fishing checks the bag) ---
  'Fishing Rod':   { slot: 'weapon', atk: 0, level: 1, value: 40, desc: 'A simple rod. Find water and a fishing spot.' },
  'Feathered Rod': { slot: 'weapon', atk: 0, level: 1, value: 260, desc: 'A finer rod — hooks the wary fish more often.' },
  'Big Bones':    { value: 9 },
  'Spider Silk':  { value: 18 },
  'Venom Sac':    { value: 26 },
  'Goblin Ear':   { value: 4 },
  // --- Dark Woods Outpost ---------------------------------------------------
  'Glowcap':      { value: 3,  desc: 'A mushroom that keeps a faint blue-green light of its own. Crushed into lantern oil it burns for days.' },
  'Minor Healing Potion': { value: 30, heal: 45, desc: 'A small vial of red. Mira makes them by the crate and still runs out.' },
  "Hunter's Rations": { value: 12, heal: 26, desc: 'Smoked meat and hard bread, wrapped in cloth. Brann swears by it.' },
  'Supply Crate':  { value: 25, desc: "Outpost stores, prised back out of a goblin camp. Tessa will want to count it." },
  'Redberry':      { value: 2,  heal: 4, desc: 'Sharp little berries from the creek bank. A goblin would trade for these.' },
  'Honeycake':     { value: 14, heal: 20, desc: 'Dense, sticky and worth more than its weight to the right goblin.' },
  'Browncap':      { value: 4,  heal: 8,  desc: 'The safe one. Fenwick says so, and he still has all his organs.' },
  'Mooncap':       { value: 7,  heal: 12, desc: 'Pale blue and cold to the touch. Also safe, apparently.' },
  'Rotcap':        { value: 1,  desc: 'Red, swollen, and it smells like a mistake.' },
  'Mushroom Stew': { value: 20, heal: 38, desc: "Fenwick's stew. Better than it looks, which is not saying much." },
  "Scout's Bandage": { value: 16, heal: 30, desc: "Lysa's field dressing — linen, pitch and no patience." },
  "Rattlecap's Trophy": { slot: 'necklace', def: 2, atk: 1, level: 5, value: 260, rarity: 'Uncommon',
    desc: "The chief's rattling charm of bones and stolen coins. It still rattles." },
  'Stolen Pendant': { value: 35 },
  'Kebab':        { value: 8, heal: 22 },
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
  // --- goblin loot (Goblin_Loot_Items pack) ---
  'Ragged Cloth':   { value: 3 },
  'Leather Scraps': { value: 5 },
  'Rope':           { value: 6 },
  'Wooden Arrow Shafts': { value: 2 },
  'Iron Arrowheads': { value: 6 },
  'Goblin Tooth':   { value: 9 },
  'Rusty Dagger':   { slot: 'weapon', atk: 1, level: 1, value: 14,
    desc: 'A pitted goblin blade. Barely better than a sharp rock.' },
  'Worn Pickaxe':   { slot: 'weapon', atk: 1, level: 1, value: 40,
    desc: 'A chipped mining pick, still swingable.' },
  'Goblin Shortbow': { slot: 'weapon', atk: 3, level: 2, value: 70,
    desc: 'A crude but serviceable goblin shortbow.' },
  'Battered Iron Shield': { slot: 'offhand', def: 4, level: 3, value: 95,
    desc: 'Dented iron, scavenged and re-strapped.' },
  'Bone Charm':     { slot: 'necklace', def: 1, level: 2, value: 130,
    desc: 'A charm of lashed bones. The goblins swear it wards off spirits.' },
  "Shaman's Spirit Stone": { slot: 'ring', atk: 2, def: 2, level: 4, value: 520,
    desc: 'A humming stone the shamans channel their rites through.' },
  "Chief's Bronze Signet": { slot: 'ring', atk: 3, def: 2, level: 5, value: 950,
    desc: "The war-chief's seal of rank, taken from a cold green hand." },
  'Goblin Pet Totem': { value: 5000,
    desc: 'A tiny idol said to summon a loyal goblin companion. Extremely rare.' },
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

