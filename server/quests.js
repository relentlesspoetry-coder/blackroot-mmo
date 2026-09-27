// Blackroot — quests.
//
// A quest is a giver (an NPC keyed to a zone POI), a list of objectives, and a
// reward. Progress is derived, never stored as a running tally: kill counts are
// the one thing we accumulate, everything else (items held, places reached,
// chests opened) is read back out of the player's own state. That means quest
// progress can't desync from the world, and nothing needs migrating when a
// quest definition changes.

export const QUESTS = {
  // ==========================================================================
  // DARK WOODS OUTPOST — the zone's story, run from Warden Rowan's camp.
  //
  // These quests carry a `talk` script: the conversation as it is actually
  // spoken, a line at a time, with the player's own replies. `n` is the NPC
  // speaking, `y` is you, `s` is the world telling you something.
  // ==========================================================================
  dw_lanterns: {
    id: 'dw_lanterns', name: 'A Lantern for the Road', giver: 'rowan', minLevel: 1,
    summary: 'Gather glowcaps and relight the three trail lanterns around the outpost.',
    intro: 'Our trail lanterns have gone dark. Glowcaps grow around the old trees nearby — crush a few into the lantern oil and they will burn for days.',
    active: 'Six glowcaps, and the three lanterns on the east trail, the old bridge and the north trail.',
    done: 'I can see the northern lantern from here.',
    talk: [
      ['n', 'You there. New arrival?'],
      ['y', 'Just got here.'],
      ['n', "Then here's your first lesson about the Dark Woods."],
      ['n', 'Never walk these roads without light.'],
      ['y', 'Because of the animals?'],
      ['n', 'The animals I understand.'],
      ['n', "It's what moves when the animals go quiet that bothers me."],
      ['y', 'Comforting.'],
      ['n', "You'll fit in."],
      ['n', 'Our trail lanterns have gone dark. Glowcaps grow around the old trees nearby. Crush a few into the lantern oil and they will burn for days.'],
      ['n', 'Gather six glowcaps and relight the three lanterns surrounding the outpost.'],
    ],
    accept: 'Good. Stay near the paths until you learn what lives beyond them.',
    outro: [
      ['n', 'I can see the northern lantern from here.'],
      ['y', 'All three are lit.'],
      ['n', 'Good.'],
      ['n', 'Most newcomers think a sword is what keeps you alive out here.'],
      ['n', "It isn't."],
      ['y', 'What does?'],
      ['n', 'Seeing trouble before it sees you.'],
    ],
    objectives: [
      { type: 'gather', tag: 'glowcap', count: 6, label: 'Glowcaps gathered' },
      { type: 'use', tag: 'lantern', count: 3, label: 'Trail lanterns lit' },
    ],
    reward: { xp: 150, gold: 40, items: ['Minor Healing Potion', 'Minor Healing Potion'] },
  },

  // --- GOBLIN TROUBLE -------------------------------------------------------
  // A straightforward enemy after the corruption's opening questions: raids,
  // stolen stores, and a chief who only knows the hard way.
  dw_supplies: {
    id: 'dw_supplies', name: 'Missing Supplies', giver: 'tessa', minLevel: 2, requires: ['dw_lanterns'],
    summary: 'Find the supply cart that never arrived, and get back what the goblins left.',
    intro: "Yesterday's supply cart never arrived. Find the cart — and if goblins took the stores, bring back whatever hasn't been eaten, burned, or worn as a hat.",
    active: 'The cart went missing on the eastern road. Read the scene, thin out the raiders, and recover four crates.',
    done: 'Four crates. That is four more than I expected.',
    talk: [
      ['n', 'We have a problem.'],
      ['y', 'The forest?'],
      ['n', 'A different problem.'],
      ['y', 'Goblins?'],
      ['n', "You're getting disturbingly good at this."],
      ['n', "Yesterday's supply cart never arrived."],
      ['n', 'Find the cart.'],
      ['n', "If goblins took the supplies, bring back whatever hasn't been eaten, burned, or worn as a hat."],
    ],
    accept: 'East road, past the thicket. Mind the ditch.',
    outro: [
      ['n', 'Four crates?'],
      ['y', "That's what survived."],
      ['n', 'Food?'],
      ['y', 'Mostly.'],
      ['n', 'Medicine?'],
      ['y', 'Some.'],
      ['n', 'My coffee?'],
      ['y', '...No.'],
      ['n', 'Those monsters.'],
    ],
    objectives: [
      { type: 'use', tag: 'cart', count: 3, label: 'The cart, read over' },
      { type: 'kill', target: 'goblin', count: 6, label: 'Woodfang goblins slain' },
      { type: 'collect', item: 'Supply Crate', count: 4, label: 'Supply crates recovered' },
    ],
    reward: { xp: 350, gold: 100, items: ["Hunter's Rations", "Hunter's Rations"] },
  },
  dw_pib: {
    id: 'dw_pib', name: 'A Goblin Named Pib', giver: 'tessa', minLevel: 3, requires: ['dw_supplies'],
    summary: 'Talk to the goblin by the creek — and pay his price.',
    intro: 'One of the scouts saw a goblin hiding near the creek. He was not armed. Apparently he waved. Go and talk to him before somebody shoots him.',
    active: 'Pib is down by Blackroot Creek. He wants three redberries and a honeycake before he says a word.',
    done: 'You traded food to a goblin.',
    talk: [
      ['n', 'One of the scouts saw a goblin hiding near the creek.'],
      ['y', "I'll deal with him."],
      ['n', 'Wait.'],
      ['n', "He wasn't armed."],
      ['y', 'A goblin?'],
      ['n', 'Apparently he waved.'],
      ['y', "That's suspicious."],
      ['n', 'Extremely.'],
      ['n', 'Go and talk to him before somebody shoots him.'],
    ],
    accept: 'Down by the creek, west of here. Try not to be the one who shoots him.',
    outro: [
      ['n', 'You traded food to a goblin.'],
      ['y', 'It worked.'],
      ['n', "I suppose I can't argue with that."],
      ['y', 'Three signal fires protect their camp.'],
      ['n', "Then we'd better put them out."],
    ],
    objectives: [
      { type: 'talk', npc: 'pib', label: 'Speak with Pib' },
      { type: 'gather', tag: 'redberry', count: 3, label: 'Redberries picked' },
      { type: 'use', object: 'honeycake', label: 'A honeycake from the larder' },
      { type: 'give', npc: 'pib', items: [{ item: 'Redberry', count: 3 }, { item: 'Honeycake', count: 1 }], label: 'Pay Pib his price' },
    ],
    reward: { xp: 300, gold: 80 },
  },
  dw_smoke: {
    id: 'dw_smoke', name: 'Smoke on the Ridge', giver: 'lysa', minLevel: 4, requires: ['dw_pib'],
    summary: "Put out the goblin signal fires so Rattlecap can't call for help.",
    intro: 'Three fires on the ridge above the Wolf Den. Put them out and Rattlecap cannot summon reinforcements. Quietly, preferably.',
    active: 'Three signal fires on the ridge, and the lookouts watching them.',
    done: 'No smoke. No reinforcements.',
    talk: [
      ['n', 'So Pib gave us the camp layout.'],
      ['y', 'For a cake.'],
      ['n', "I've worked for less."],
      ['y', "What's the plan?"],
      ['n', 'Three fires.'],
      ['n', 'Put them out and Rattlecap cannot summon reinforcements.'],
      ['y', 'Quietly?'],
      ['n', 'Preferably.'],
      ['y', "And if quiet doesn't work?"],
      ['n', 'Then loudly.'],
    ],
    accept: 'Up the ridge, east. I will be watching the smoke.',
    outro: [
      ['n', 'No smoke.'],
      ['y', 'No reinforcements.'],
      ['n', 'Excellent.'],
      ['n', 'Now comes the fun part.'],
      ['y', 'Your definition of fun worries me.'],
    ],
    objectives: [
      { type: 'use', tag: 'signalfire', count: 3, label: 'Signal fires doused' },
      { type: 'kill', target: 'goblin_archer', count: 3, label: 'Goblin lookouts killed' },
    ],
    reward: { xp: 450, gold: 110 },
  },
  dw_rattlecap: {
    id: 'dw_rattlecap', name: 'Chief Rattlecap', giver: 'rowan', minLevel: 5, requires: ['dw_smoke'],
    summary: "Take the Wolf Den camp, kill the chief, and bring the outpost's banner home.",
    intro: 'The signal fires are out and Rattlecap is isolated. His raids have cost us food, medicine, weapons and people. End it — and bring back our banner.',
    active: 'The camp at the Wolf Den: the warriors, his two brutes, the chief himself, and the banner he strung up.',
    done: "That's our banner.",
    talk: [
      ['n', 'The signal fires are out.'],
      ['y', "Rattlecap's isolated."],
      ['n', "Then we're ending this."],
      ['n', 'His raids have cost us food, medicine, weapons, and people.'],
      ['y', "I'll bring him down."],
      ['n', 'One more thing.'],
      ['y', 'What?'],
      ['n', 'He stole our banner.'],
      ['y', "That's what you're worried about?"],
      ['n', 'No.'],
      ['n', "But I'd like it back."],
    ],
    accept: 'Then go. We will keep a fire lit for you.',
    outro: [
      ['n', "That's our banner."],
      ['y', "And Rattlecap won't be raiding anyone again."],
      ['n', 'Good work.'],
      ['y', 'Something strange happened at the camp.'],
      ['n', 'What?'],
      ['y', 'Several goblins had black roots growing through their armour.'],
      ['n', 'So the corruption reached them too.'],
      ['y', 'Or they reached it.'],
    ],
    objectives: [
      { type: 'kill', target: 'goblin_warrior', count: 8, label: 'Woodfang goblins slain' },
      { type: 'kill', target: 'goblin_chief', count: 2, label: 'Goblin brutes slain' },
      { type: 'slay', name: 'Chief Rattlecap', label: 'Chief Rattlecap killed' },
      { type: 'use', object: 'banner', label: 'Outpost banner recovered' },
    ],
    reward: { xp: 750, gold: 225, items: ["Rattlecap's Trophy"] },
  },

  // --- Old Fenwick, and the difference between a mushroom and a mistake ------
  dw_mushrooms: {
    id: 'dw_mushrooms', name: 'Mushroom Business', giver: 'fenwick', minLevel: 3,
    summary: 'Pick browncaps and mooncaps for Fenwick. Leave the red ones alone.',
    intro: 'Brown ones are safe. Blue ones are safe. Red ones depend on how attached you are to your organs. Five of each of the first two, and use your eyes.',
    active: 'Five browncaps, five mooncaps, and not one rotcap if you can help it.',
    done: "Browncaps. Mooncaps. Let's see what else you brought me.",
    talk: [
      ['n', 'You know mushrooms?'],
      ['y', 'A little.'],
      ['n', 'Good.'],
      ['n', 'Then you know the brown ones are safe.'],
      ['y', 'Right.'],
      ['n', 'And the blue ones?'],
      ['y', 'Safe?'],
      ['n', 'Correct.'],
      ['y', 'And the red ones?'],
      ['n', 'Depends.'],
      ['y', 'On what?'],
      ['n', 'How attached you are to your organs.'],
      ['y', "I'll avoid the red ones."],
      ['n', "You're a natural."],
    ],
    accept: 'Five of each. Take your time; the woods are not going anywhere.',
    outro: [
      ['n', "Let's see."],
      ['n', 'Browncaps.'],
      ['n', 'Mooncaps.'],
      ['y', 'And no rotcaps.'],
      ['n', 'We shall see. I can smell it when you are lying.'],
    ],
    objectives: [
      { type: 'collect', item: 'Browncap', count: 5, label: 'Browncaps' },
      { type: 'collect', item: 'Mooncap', count: 5, label: 'Mooncaps' },
      { type: 'avoid', tag: 'rotcap', label: 'Not one rotcap picked', optional: true, bonus: { gold: 45 } },
    ],
    reward: { xp: 250, gold: 65, items: ['Mushroom Stew', 'Mushroom Stew', 'Mushroom Stew'] },
  },

  // --- Warden Alric, Entrance Clearing -------------------------------------
  feathers: {
    id: 'feathers', name: 'Feathers and Hide', giver: 'alric', minLevel: 1,
    summary: 'Gather what the clearing’s livestock leaves behind.',
    intro: 'You’ll not last an hour out there empty-handed. Start small — the fowl and cattle by the clearing. Bring me feathers and a couple of hides and I’ll see you armed.',
    active: 'Feathers from the chickens, hide from the cows. They won’t fight back.',
    done: 'Good. You can hold a blade without dropping it. Now the real work.',
    objectives: [
      { type: 'collect', item: 'Feather', count: 5, label: 'Feathers gathered' },
      { type: 'collect', item: 'Cowhide', count: 2, label: 'Cowhides gathered' },
    ],
    reward: { xp: 60, gold: 30 },
  },
  trail: {
    id: 'trail', name: 'Thin the Trail', giver: 'alric', minLevel: 1, requires: ['feathers'],
    summary: 'Clear the goblins from the Old Hunter’s Trail.',
    intro: 'Goblins have the old hunter’s trail. Small ones, alone mostly — cut down six and bring me their ears so I know you didn’t just run past them.',
    active: 'Six goblins on the trail, and four ears to prove it.',
    done: 'Ears counted. The trail’s passable again — take the dagger, you’ve earned it.',
    objectives: [
      { type: 'kill', target: 'goblin', count: 6, label: 'Goblins slain' },
      { type: 'collect', item: 'Goblin Ear', count: 4, label: 'Goblin ears' },
    ],
    reward: { xp: 180, gold: 60, items: ['Bronze Dagger'] },
  },
  shrine: {
    id: 'shrine', name: 'The Shrine Grove', giver: 'alric', minLevel: 2, requires: ['trail'],
    summary: 'Follow the trail south to the Shrine Grove.',
    intro: 'Keep to the path south, past the creek. There’s a grove with an old shrine — a hermit keeps it. He’ll have work, and the grove is safe ground if the woods turn on you.',
    active: 'Follow the path south to the Shrine Grove.',
    done: 'You found it. Rest here when the woods get hungry — nothing aggresses on holy ground.',
    objectives: [
      { type: 'reach', zone: 'darkwoods', poi: 'chapel', label: 'Reach the Shrine Grove' },
    ],
    reward: { xp: 120, gold: 20 },
  },

  // --- The Farmstead: Old Maggie & Farmhand Bram ---------------------------
  henhouse: {
    id: 'henhouse', name: 'Foxes in the Hen House', giver: 'maggie', minLevel: 1,
    summary: 'Drive the egg-thieving scavengers off the farm.',
    intro: 'Goblin scavengers have been slinking out of the trees to raid my hens — half my eggs gone before dawn! Put a few of the little thieves down and gather what eggs you can find, there’s a love.',
    active: 'Five scavengers off my hens, and four eggs back in the basket.',
    done: 'Bless you. The hens can roost easy again. Take this — it kept my late husband warm.',
    objectives: [
      { type: 'kill', target: 'goblin_scavenger', count: 5, label: 'Scavengers driven off' },
      { type: 'collect', item: 'Egg', count: 4, label: 'Eggs recovered' },
    ],
    reward: { xp: 120, gold: 50, items: ['Goblin Mail'] },
  },
  mending: {
    id: 'mending', name: 'Mending the Fences', giver: 'bram', minLevel: 2, requires: ['henhouse'],
    summary: 'Scavenge the goblins’ leavings to repair the farm.',
    intro: 'Them goblins wrecked the west fence gettin’ at the cows. I can mend it, but I need cordage and hide — and the goblins carry plenty, if you’re handy with a blade. Bring me rope and leather scraps.',
    active: 'Four coils of rope and three leather scraps off the goblins.',
    done: 'That’ll hold the herd. Obliged — here’s a bit of coin from the sale of the last calf.',
    objectives: [
      { type: 'collect', item: 'Rope', count: 4, label: 'Rope gathered' },
      { type: 'collect', item: 'Leather Scraps', count: 3, label: 'Leather scraps gathered' },
    ],
    reward: { xp: 200, gold: 90 },
  },

  // --- Prospector Dorn, Root-Choked Ravine ---------------------------------
  claimjumpers: {
    id: 'claimjumpers', name: 'Claim Jumpers', giver: 'dorn', minLevel: 4, requires: ['shrine'],
    summary: 'Run the goblin miners out of the ravine and haul out iron.',
    intro: 'Goblins have jumped my claim in the Root-Choked Ravine — a whole dig-crew stripping my iron seam. Clear the miners out and bring me five loads of iron ore, mined or looted off their carcasses, I don’t care which.',
    active: 'Four goblin miners cleared, and five loads of iron ore for Dorn.',
    done: 'The seam’s mine again. Take my old steel pick — she bites deeper than whatever you’re swinging.',
    objectives: [
      { type: 'kill', target: 'goblin_miner', count: 4, label: 'Goblin miners cleared' },
      { type: 'collect', item: 'Iron Ore', count: 5, label: 'Iron ore hauled' },
    ],
    reward: { xp: 500, gold: 160, items: ['Steel Pickaxe'] },
  },

  // --- Ranger Sela, Fallen Watchtower --------------------------------------
  wolfraid: {
    id: 'wolfraid', name: 'The Wolf Den', giver: 'sela', minLevel: 4, requires: ['trail'],
    summary: 'Break the goblin war-camp at the Wolf Den.',
    intro: 'The goblins have made a war-camp of the old Wolf Den, east past the creek — warriors and archers both, under banners. Thin them out before they march on the trail: their warriors, their bowmen, and bring me a fistful of teeth to prove it.',
    active: 'Four goblin warriors, two archers, and six teeth from the Wolf Den camp.',
    done: 'That will slow them. Take the bow — a goblin string, but it shoots true enough.',
    objectives: [
      { type: 'kill', target: 'goblin_warrior', count: 4, label: 'Goblin warriors slain' },
      { type: 'kill', target: 'goblin_archer', count: 2, label: 'Goblin archers slain' },
      { type: 'collect', item: 'Goblin Tooth', count: 6, label: 'Goblin teeth' },
    ],
    reward: { xp: 550, gold: 180, items: ['Goblin Shortbow'] },
  },

  // --- The Hermit, Shrine Grove --------------------------------------------
  rotfen: {
    id: 'rotfen', name: 'Rotfen Pickings', giver: 'hermit', minLevel: 3, requires: ['shrine'],
    summary: 'Break up the bandit camp east of the shrine.',
    intro: 'Bandits in the Rotfen, east of here. They’ve been robbing pilgrims on the road — the pendants they carry belong to the dead. Take five of them down and bring back three pendants.',
    active: 'Five bandits, three stolen pendants. Mind the rot — the thicket itself is poison.',
    done: 'The pendants go back in the shrine. Wear the leather; you’ll need it further south.',
    objectives: [
      { type: 'kill', target: 'bandit', count: 5, label: 'Bandits slain' },
      { type: 'collect', item: 'Stolen Pendant', count: 3, label: 'Stolen pendants' },
    ],
    reward: { xp: 420, gold: 150, items: ['Leather Body'] },
  },
  ogres: {
    id: 'ogres', name: 'Ogre Season', giver: 'hermit', minLevel: 5, requires: ['rotfen'],
    summary: 'Cull the hill ogres before they reach the gate.',
    intro: 'Hill ogres have come down into the ravine, and more sit on the south gate approach. Four of them, and the road south opens again.',
    active: 'Four hill ogres. Take them one at a time — two will kill you.',
    done: 'Four. The gate road is walkable again, for a while.',
    objectives: [
      { type: 'kill', target: 'guard', count: 4, label: 'Hill ogres slain' },
    ],
    reward: { xp: 900, gold: 250, items: ['Big Bones'] },
  },
  guardian: {
    id: 'guardian', name: 'The Rootbound Guardian', giver: 'hermit', minLevel: 7, requires: ['ogres'],
    summary: 'Put down the thing in the Ancient Stone Circle.',
    intro: 'There is a thing in the stone circle that the roots have grown through and kept walking. It was a man once. Free it, if you can — but go at full strength.',
    active: 'The Rootbound Guardian waits in the Ancient Stone Circle. Go rested.',
    done: 'Then it’s done, and the circle is quiet. Keep the heartwood — it remembers.',
    objectives: [
      { type: 'slay', name: 'The Rootbound Guardian', label: 'Slay the Rootbound Guardian' },
    ],
    reward: { xp: 1600, gold: 500, items: ['Guardian\'s Heartwood'] },
  },

  // --- The Wandering Merchant, Abandoned Camp -------------------------------
  intothedark: {
    id: 'intothedark', name: 'Into the Dark', giver: 'merchant', minLevel: 4, requires: ['shrine'],
    summary: 'Find the Spider Den and recover the smugglers’ cache from its mouth.',
    intro: 'There’s an arch of stone south of the camp with a hole under it — my partners went in with my stock and didn’t come out. The niche they used is just outside the mouth. Fetch what’s mine and I’ll not ask what you keep.',
    active: 'The stone arch south of the camp. The Smuggler’s Niche is by the mouth.',
    done: 'My cache, at last. The chambers below are yours to plunder, if you’ve the nerve.',
    objectives: [
      { type: 'chest', zone: 'darkwoods', chest: 'smug', label: 'Open the Smuggler\'s Niche' },
    ],
    reward: { xp: 500, gold: 120 },
  },
  caches: {
    id: 'caches', name: 'Caches of the Blackroot', giver: 'merchant', minLevel: 5, requires: ['intothedark'],
    summary: 'Recover the four hidden caches scattered across the Dark Woods.',
    intro: 'The woods are littered with old stashes — a soldier’s footlocker at the fallen watchtower, a bandit hoard in the Rotfen, the goblins’ plunder at the Wolf Den, and something older ringed by the stone circle. Crack all four and I’ll make it worth your while.',
    active: 'Four caches: the Fallen Watchtower, the Rotfen Thicket, the Wolf Den, and the Ancient Stone Circle. Keep what you find inside — I only want to know they’re opened.',
    done: 'All four, opened and emptied. You’ve a nose for buried coin — here, a little something for the road.',
    objectives: [
      { type: 'chest', zone: 'darkwoods', chest: 'watchtower', label: 'Loot the Fallen Watchtower cache' },
      { type: 'chest', zone: 'darkwoods', chest: 'rotfen', label: 'Loot the Rotfen Thicket stash' },
      { type: 'chest', zone: 'darkwoods', chest: 'wolfden', label: 'Loot the Wolf Den plunder' },
      { type: 'chest', zone: 'darkwoods', chest: 'stones', label: 'Loot the Stone Circle hoard' },
    ],
    reward: { xp: 700, gold: 300, items: ['Smuggler\'s Cache'] },
  },
  silk: {
    id: 'silk', name: 'Silk and Venom', giver: 'merchant', minLevel: 5, requires: ['intothedark'],
    summary: 'Harvest spider silk and venom from inside the Spider Den.',
    intro: 'Spider silk sells better than anything I’ve carried. Venom glands too, if your hands are steady. Go through the arch — the gallery under it is thick with them.',
    active: 'Four bundles of silk, two venom glands. The ones below the arch carry the best.',
    done: 'Steady hands after all. Pleasure doing business.',
    objectives: [
      { type: 'collect', item: 'Spider Silk', count: 4, label: 'Spider silk' },
      // 'Venom Sac' is a real item but NOTHING drops it and no one sells it, so
      // this quest could never be finished. The spiders carry venom GLANDS.
      { type: 'collect', item: 'Venom Gland', count: 2, label: 'Venom glands' },
    ],
    reward: { xp: 700, gold: 300 },
  },

  // ==========================================================================
  // THE SPIDER DEN — the descent. `intothedark` only ever got you to the niche
  // outside the mouth, because for a long time there was nothing behind it.
  // There is now: eight chambers down to the brood.
  // ==========================================================================
  dw_denmouth: {
    id: 'dw_denmouth', name: 'Down the Throat', giver: 'merchant', minLevel: 8, requires: ['intothedark'],
    summary: 'Go through the arch, into the den, and find what my partners left in the larder.',
    intro: 'You fetched my cache from the doorstep. My partners got further than that. There is a side chamber past the first gallery where they kept the good stock — cocoons hanging in it now, I am told. I am not going. You are.',
    active: 'Through the arch. Past the gallery, into the larder.',
    done: 'They kept better stock than I remembered. You have earned the difference.',
    objectives: [
      { type: 'reach', zone: 'spiderden', poi: 'gallery', label: 'Reach the webbed gallery' },
      { type: 'chest', zone: 'spiderden', chest: 'den_larder', label: 'Open the larder cache' },
      { type: 'kill', target: 'spider', count: 8, label: 'Cave spiders' },
    ],
    reward: { xp: 900, gold: 220 },
  },
  dw_deepden: {
    id: 'dw_deepden', name: 'What the Shaft Goes Down To', giver: 'alric', minLevel: 10, requires: ['dw_denmouth'],
    summary: 'Follow the shaft down to the hollow and the seep, and come back able to describe them.',
    intro: 'Nine places on this map will kill you and I can name them all. I cannot name what is under that arch, and it has started bothering me. Go down the shaft. Find the bottom of it. Come back and tell me the shape of the place.',
    active: 'Down the shaft: the hollow, then the seep beyond it.',
    done: 'A hall, and a wet room with crystals in it. Good. Now I can name it.',
    objectives: [
      { type: 'reach', zone: 'spiderden', poi: 'hollow', label: 'Reach the hollow' },
      { type: 'reach', zone: 'spiderden', poi: 'seep', label: 'Reach the seep' },
      { type: 'chest', zone: 'spiderden', chest: 'den_seep', label: 'Open the cache in the seep' },
      { type: 'kill', target: 'venom_spider', count: 10, label: 'Venom spiders' },
    ],
    reward: { xp: 1300, gold: 320, items: ['Pristine Silk'] },
  },
  dw_webbound: {
    id: 'dw_webbound', name: 'The Web-Bound', giver: 'alric', minLevel: 13, requires: ['dw_deepden'],
    summary: 'Something on the bone floor is wearing the last party that went down there.',
    intro: 'You described a floor of bones. You did not describe what is standing on it, which tells me you did not look. Something down there is wrapped in enough silk to stand up on its own. Put it down.',
    active: 'The bone floor, east off the hollow. Whatever is standing on it.',
    done: 'Wrapped in silk and still moving. I have seen a great deal and I had not seen that.',
    objectives: [
      { type: 'slay', name: 'The Web-Bound', label: 'Destroy The Web-Bound' },
      { type: 'collect', item: 'Sticky Webbing', count: 3, label: 'Silk from the wrapping' },
    ],
    reward: { xp: 1700, gold: 420, items: ['Bone Charm'] },
  },
  dw_denmother: {
    id: 'dw_denmother', name: 'The Den Mother', giver: 'alric', minLevel: 14, requires: ['dw_webbound'],
    summary: 'Everything in the den came from one chamber at the bottom of it. End that.',
    intro: 'Egg clusters in every room, and nothing that laid them anywhere you looked. They all came from the same place. It is at the bottom, past the hollow, and it is still laying. Finish this before the woods have to.',
    active: 'The brood chamber, at the very bottom. She is in it.',
    done: 'Then it is done, and the Dark Woods is one horror shorter. That is not nothing.',
    objectives: [
      { type: 'reach', zone: 'spiderden', poi: 'brood', label: 'Reach the brood chamber' },
      { type: 'slay', name: 'The Den Mother', label: 'Slay The Den Mother' },
      { type: 'chest', zone: 'spiderden', chest: 'den_brood', label: 'Take what is in her nest' },
    ],
    reward: { xp: 2400, gold: 650, items: ['Spiderfang Dagger'] },
  },

  // ==========================================================================
  // GEDD MARROW — the survivor at the den mouth. He was placed there to give
  // the cave a voice and a turn-in point, and then given nothing to say: the
  // only NPC below ground, standing in the dark, with no reason to talk to
  // him. His line is about the people who did not come back out, and they are
  // in the larder, because the larder IS the cocoons.
  // ==========================================================================
  dw_larder: {
    id: 'dw_larder', name: 'Five Went In', giver: 'gedd', minLevel: 9, requires: ['dw_denmouth'],
    summary: 'Cut open the cocoons in the larder and bring Gedd back his company\u2019s tags.',
    intro: 'Six of us took the contract. I am the one who came back up, and I have been stood here since working out how to say that to anybody. They are still in there — the side chamber off the gallery, the one with the shapes hanging in it. I cannot go back in. Cut them down. Bring me the tags so I have something to hand their people.',
    active: 'The larder, west off the gallery. The cocoons are hanging in it.',
    done: 'Five. That is all of them, then. I will carry these out myself — it is the last thing I can do for them, and it is not much.',
    objectives: [
      { type: 'use', tag: 'cocoon', count: 5, label: 'Cocoons cut open' },
      { type: 'collect', item: 'Company Tag', count: 5, label: 'Company tags recovered' },
      { type: 'kill', target: 'spider', count: 6, label: 'Cave spiders killed' },
    ],
    reward: { xp: 1100, gold: 280, items: ['Minor Healing Potion', 'Minor Healing Potion'] },
  },
  dw_cavecrop: {
    id: 'dw_cavecrop', name: 'What Grows Down There', giver: 'gedd', minLevel: 9, requires: ['dw_larder'],
    summary: 'Gedd is not going home empty-handed. Bring him cave mushrooms and quartz out of the seep.',
    intro: 'I am not walking out of here with nothing but tin tags. There is fungus on the gallery walls that Pedlar Ovric pays for, and the wet chamber past the hollow glitters — quartz, right there in the seam, no pick needed. If I am going to have been down here, I would like it to have been worth something.',
    active: 'Mushrooms on the walls, quartz in the seep. Neither of them fights back.',
    done: 'That is a season\u2019s wage in a sack. It does not make it square. It makes it payable.',
    objectives: [
      { type: 'gather', tag: 'denfungus', count: 6, label: 'Cave mushrooms cut' },
      { type: 'gather', tag: 'glimmer', count: 5, label: 'Quartz worked loose' },
      { type: 'collect', item: 'Cave Mushroom', count: 6, label: 'Cave Mushrooms' },
      { type: 'collect', item: 'Uncut Quartz', count: 5, label: 'Uncut Quartz' },
    ],
    reward: { xp: 1000, gold: 340 },
  },
  dw_burnbrood: {
    id: 'dw_burnbrood', name: 'Burn What She Laid', giver: 'gedd', minLevel: 13, requires: ['dw_denmother'],
    summary: 'The Den Mother is dead. What she laid is not. Burn the clusters out of the hollow and the nest.',
    intro: 'You killed her. Good. Now go and look at the floor of the brood chamber, because she spent a long time down here and she was not idle. Clusters of them, in the hollow as well. Kill the mother and leave the eggs and in a year we are stood here having this conversation again. Take a torch to every one you find.',
    active: 'Egg clusters in the hollow and the brood chamber. They burst when they burn.',
    done: 'Then it is finished properly. I have been in this cave a long time and that is the first thing anyone has done that will still matter next spring.',
    objectives: [
      { type: 'use', tag: 'eggs', count: 5, label: 'Egg clusters burned' },
      { type: 'kill', target: 'venom_spider', count: 8, label: 'Venom spiders killed' },
    ],
    reward: { xp: 2000, gold: 520, items: ['Bone Charm'] },
  },

  // ==========================================================================
  // RAVENWATER POOL — the pool had nothing in it at all until recently, and
  // nothing sent you to it either.
  // ==========================================================================
  dw_ravenwater: {
    id: 'dw_ravenwater', name: 'Deep Waters', giver: 'alric', minLevel: 8, requires: ['shrine'],
    summary: 'Walk the shore of Ravenwater and find out what is living in the dead trees.',
    intro: 'The pool north-west of here. Dead trees standing in it, marsh all round the edge, and every so often somebody who fishes it does not come back up the path. Walk the shore. Tell me what is in there.',
    active: 'The shore of Ravenwater. There is a cache somewhere on the bank, if the stories are right.',
    done: 'Bats in the dead trees and spiders in the reeds. That is the half of it I can do something about.',
    objectives: [
      { type: 'reach', zone: 'darkwoods', poi: 'ravenwater', label: 'Reach Ravenwater Pool' },
      { type: 'kill', target: 'bat', count: 8, label: 'Bats over the water' },
      { type: 'chest', zone: 'darkwoods', chest: 'ravenmere', label: 'Find the cache on the bank' },
    ],
    reward: { xp: 850, gold: 200 },
  },
  dw_drowned: {
    id: 'dw_drowned', name: 'The Drowned Warden', giver: 'alric', minLevel: 11, requires: ['dw_ravenwater'],
    summary: 'Something has been at the bottom of Ravenwater long enough to go green.',
    intro: 'You said bats and spiders. Somebody else said a shape standing in the shallows that did not move when they shouted at it, and was closer when they looked again. One of you is wrong and I would rather it was not you.',
    active: 'Ravenwater. Whatever is standing in the shallows.',
    done: 'Moss to the shoulders and still walking. The pool can keep its other secrets.',
    objectives: [
      { type: 'slay', name: 'The Drowned Warden', label: 'Put down The Drowned Warden' },
    ],
    reward: { xp: 1400, gold: 360, items: ['Crystalline Relic'] },
  },

  // ==========================================================================
  // THE MURKFEN — the plank walks now go somewhere, so somebody should send
  // you out along them.
  // ==========================================================================
  dw_plankroad: {
    id: 'dw_plankroad', name: 'The Plank Road', giver: 'hermit', minLevel: 6, requires: ['rotfen'],
    summary: 'Walk the plank road out across the fen and see what is left on the islands.',
    intro: 'The walks hold. Mostly. There are two patches of dry ground out in the middle and men have been leaving things on both of them for longer than I have lived here. Scavengers are at one of the caches now. Get there first.',
    active: 'Out along the planks. The cache is on the southern island.',
    done: 'Dry, and you kept your feet. That puts you ahead of most.',
    objectives: [
      { type: 'chest', zone: 'darkwoods', chest: 'fencache', label: 'Open the cache on the island' },
      { type: 'kill', target: 'goblin_scavenger', count: 9, label: 'Fen scavengers' },
    ],
    reward: { xp: 620, gold: 170 },
  },

  // ==========================================================================
  // THE FALLEN CHAPEL — it grew a graveyard and an altar, and neither had a
  // reason to walk into the nave.
  // ==========================================================================
  dw_reliquary: {
    id: 'dw_reliquary', name: 'What the Chapel Kept', giver: 'rowan', minLevel: 8, requires: ['dw_rattlecap'],
    summary: 'The chapel on the hill still has its altar. Find out whether it still has what was on it.',
    intro: 'The east window is still standing up there, which means the altar under it is too. There was a reliquary on that altar when this was somebody’s chapel. I would rather we had it than whatever is nesting in the nave.',
    active: 'The Fallen Chapel. The altar is at the east end, under the big window.',
    done: 'Still in one piece after all this time. Keep the lamp lit on the way back down.',
    objectives: [
      { type: 'reach', zone: 'darkwoods', poi: 'chapel', label: 'Reach the Fallen Chapel' },
      { type: 'chest', zone: 'darkwoods', chest: 'reliquary', label: 'Recover the reliquary' },
      { type: 'kill', target: 'bat', count: 6, label: 'Clear the nave' },
    ],
    reward: { xp: 900, gold: 240 },
  },
};

export const QUEST_IDS = Object.keys(QUESTS);

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
function countIn(list, name) { let n = 0; for (const it of list) if (it === name) n++; return n; }
// How many of a tagged set of world objects this player has dealt with.
function countUsed(p, tag) { let n = 0; for (const key of p.usedObjects) if (key.startsWith(tag + ':')) n++; return n; }

// How far along one objective is, for a given player.
export function objectiveProgress(p, q, obj) {
  const need = obj.count || 1;
  let have = 0;
  switch (obj.type) {
    case 'kill':   have = (p.questKills[q.id] && p.questKills[q.id][obj.target]) || 0; break;
    case 'slay':   have = (p.questKills[q.id] && p.questKills[q.id]['★' + obj.name]) || 0; break;
    case 'collect': have = countIn(p.inventory, obj.item); break;
    case 'reach':  have = p.questFlags.has(`reach:${obj.zone}:${obj.poi}`) ? 1 : 0; break;
    case 'chest':  have = p.openedChests.has(`${obj.zone}:${obj.chest}`) ? 1 : 0; break;
    // Things in the world you put your hands on: lanterns lit, tracks read,
    // signal fires doused, growths cut back. Either one named object or any
    // `count` of a tagged set.
    case 'use':    have = obj.object ? (p.usedObjects.has(obj.object) ? 1 : 0) : countUsed(p, obj.tag); break;
    // Work done rather than goods held: six glowcaps picked stay picked even
    // after the lanterns burn them.
    case 'gather': have = (p.questKills[q.id] && p.questKills[q.id]['@' + obj.tag]) || 0; break;
    // A bonus for what you did NOT do — pick the red ones, in Fenwick's case.
    case 'avoid':  have = ((p.questKills[q.id] && p.questKills[q.id]['@' + obj.tag]) || 0) === 0 ? 1 : 0; break;
    case 'talk':   have = p.questFlags.has(`talk:${obj.npc}`) ? 1 : 0; break;
    // Goods handed to someone other than the quest giver (a goblin, say).
    case 'give':   have = p.questFlags.has(`give:${q.id}:${obj.npc}`) ? 1 : 0; break;
  }
  return { have: Math.min(have, need), need, label: obj.label, done: have >= need };
}

export function questProgress(p, q) {
  const objs = q.objectives.map(o => ({ ...objectiveProgress(p, q, o), optional: !!o.optional }));
  // Optional lines are for the bonus, not for finishing the job.
  return { objectives: objs, complete: objs.every(o => o.optional || o.done) };
}

export function canStart(p, q) {
  if (p.questDone.has(q.id)) return false;
  if (p.quests.has(q.id)) return false;
  if (q.minLevel && p.level < q.minLevel) return false;
  for (const r of (q.requires || [])) if (!p.questDone.has(r)) return false;
  return true;
}

// Everything the client needs to draw the log, the NPC markers and the dialogue.
export function questPayload(p) {
  const active = [], available = [], completed = [], ready = {};
  for (const id of QUEST_IDS) {
    const q = QUESTS[id];
    if (p.questDone.has(id)) { completed.push({ id, name: q.name, giver: q.giver }); continue; }
    if (p.quests.has(id)) {
      const pr = questProgress(p, q);
      active.push({
        id, name: q.name, giver: q.giver, summary: q.summary,
        text: pr.complete ? q.done : q.active,
        objectives: pr.objectives, complete: pr.complete,
        reward: q.reward,
        talk: pr.complete ? (q.outro || null) : null,   // the conversation when you come back with it done
      });
      if (pr.complete) ready[q.giver] = true;
      continue;
    }
    if (canStart(p, q)) {
      available.push({ id, name: q.name, giver: q.giver, summary: q.summary, intro: q.intro,
        minLevel: q.minLevel || 1, reward: q.reward, talk: q.talk || null, accept: q.accept || null,
        objectives: q.objectives.map(o => ({ label: o.label, need: o.count || 1 })) });
    }
  }
  // Per-giver marker: '!' = has something to offer, '?' = has a turn-in waiting.
  const markers = {};
  for (const a of available) markers[a.giver] = markers[a.giver] || 'offer';
  for (const g of Object.keys(ready)) markers[g] = 'turnin';
  return { t: 'quests', active, available, completed, markers };
}

// Record a kill against every active quest that cares about it. Returns the
// quest ids whose progress actually moved, so the caller can notify.
export function recordKill(p, monster) {
  const touched = [];
  for (const id of p.quests.keys()) {
    const q = QUESTS[id]; if (!q) continue;
    for (const obj of q.objectives) {
      let key = null;
      if (obj.type === 'kill' && obj.target === monster.type) key = obj.target;
      else if (obj.type === 'slay' && monster.elite && monster.name === obj.name) key = '★' + obj.name;
      if (!key) continue;
      const need = obj.count || 1;
      p.questKills[id] = p.questKills[id] || {};
      if ((p.questKills[id][key] || 0) >= need) continue; // already satisfied
      p.questKills[id][key] = (p.questKills[id][key] || 0) + 1;
      touched.push(id);
    }
  }
  return touched;
}

// Called when a player stands near a POI. Returns quest ids that advanced.
export function recordReach(p, zoneId, poiKey) {
  const flag = `reach:${zoneId}:${poiKey}`;
  if (p.questFlags.has(flag)) return [];
  let relevant = false;
  for (const id of p.quests.keys()) {
    const q = QUESTS[id]; if (!q) continue;
    if (q.objectives.some(o => o.type === 'reach' && o.zone === zoneId && o.poi === poiKey)) relevant = true;
  }
  if (!relevant) return [];
  p.questFlags.add(flag);
  return [...p.quests.keys()].filter(id =>
    QUESTS[id].objectives.some(o => o.type === 'reach' && o.zone === zoneId && o.poi === poiKey));
}

// Called when a player uses a world object (a lantern, a signal fire, a set of
// tracks). Returns the quest ids that advanced.
export function recordUse(p, obj) {
  const keys = [obj.id, obj.tag ? obj.tag + ':' + obj.id : null].filter(Boolean);
  for (const k of keys) p.usedObjects.add(k);
  const touched = [];
  for (const id of p.quests.keys()) {
    const q = QUESTS[id]; if (!q) continue;
    for (const o of (q.objectives || [])) {
      if (o.type === 'use' && (o.object === obj.id || (o.tag && o.tag === obj.tag))) { touched.push(id); continue; }
      if ((o.type === 'gather' || o.type === 'avoid') && o.tag === obj.tag) {
        if (o.type === 'avoid') { const key = '@' + o.tag; p.questKills[id] = p.questKills[id] || {}; p.questKills[id][key] = (p.questKills[id][key] || 0) + 1; touched.push(id); continue; }
        const key = '@' + o.tag, need = o.count || 1;
        p.questKills[id] = p.questKills[id] || {};
        if ((p.questKills[id][key] || 0) >= need) continue;
        p.questKills[id][key] = (p.questKills[id][key] || 0) + (obj.gives && obj.gives.count || 1);
        touched.push(id);
      }
    }
  }
  return [...new Set(touched)];
}
// Called when a player opens a conversation with an NPC.
export function recordTalk(p, npcId) {
  const touched = [];
  const flag = `talk:${npcId}`;
  const wantTalk = [...p.quests.keys()].filter(id => (QUESTS[id].objectives || []).some(o => o.type === 'talk' && o.npc === npcId));
  if (wantTalk.length && !p.questFlags.has(flag)) { p.questFlags.add(flag); touched.push(...wantTalk); }
  // Anything you were asked to bring them changes hands as you speak.
  for (const id of p.quests.keys()) {
    const q = QUESTS[id]; if (!q) continue;
    for (const o of (q.objectives || [])) {
      if (o.type !== 'give' || o.npc !== npcId) continue;
      const gflag = `give:${id}:${npcId}`;
      if (p.questFlags.has(gflag)) continue;
      if (!(o.items || []).every(it => countIn(p.inventory, it.item) >= (it.count || 1))) continue;
      for (const it of (o.items || [])) for (let n = it.count || 1; n > 0; n--) p.inventory.splice(p.inventory.indexOf(it.item), 1);
      p.questFlags.add(gflag); touched.push(id);
    }
  }
  return [...new Set(touched)];
}

// Consume the items a collect objective asked for. Called on turn-in only.
export function consumeQuestItems(p, q) {
  for (const obj of q.objectives) {
    if (obj.type !== 'collect') continue;
    let left = obj.count || 1;
    for (let i = p.inventory.length - 1; i >= 0 && left > 0; i--) {
      if (p.inventory[i] === obj.item) { p.inventory.splice(i, 1); left--; }
    }
  }
}
