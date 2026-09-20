// Blackroot — quests.
//
// A quest is a giver (an NPC keyed to a zone POI), a list of objectives, and a
// reward. Progress is derived, never stored as a running tally: kill counts are
// the one thing we accumulate, everything else (items held, places reached,
// chests opened) is read back out of the player's own state. That means quest
// progress can't desync from the world, and nothing needs migrating when a
// quest definition changes.

export const QUESTS = {
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
      { type: 'reach', zone: 'darkwoods', poi: 'shrine', label: 'Reach the Shrine Grove' },
    ],
    reward: { xp: 120, gold: 20 },
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
    summary: 'Find the hidden cave and recover the smugglers’ cache.',
    intro: 'There’s a cave mouth west of the ravine — my partners went in with my stock and didn’t come out. The niche they used is just inside. Fetch what’s mine and I’ll not ask what you keep.',
    active: 'Find the cave mouth west of the ravine, then the Smuggler’s Niche inside.',
    done: 'My cache, at last. The deeper chambers are yours to plunder, if you’ve the nerve.',
    objectives: [
      { type: 'chest', zone: 'hiddencave', chest: 'smug', label: 'Open the Smuggler\'s Niche' },
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
    summary: 'Harvest spider silk and venom from the Crystal Hollow.',
    intro: 'Spider silk sells better than anything I’ve carried. Venom sacs too, if your hands are steady. The deep chambers are thick with them.',
    active: 'Four bundles of silk, two venom sacs. The deep spiders carry the best.',
    done: 'Steady hands after all. Pleasure doing business.',
    objectives: [
      { type: 'collect', item: 'Spider Silk', count: 4, label: 'Spider silk' },
      { type: 'collect', item: 'Venom Sac', count: 2, label: 'Venom sacs' },
    ],
    reward: { xp: 700, gold: 300 },
  },
};

export const QUEST_IDS = Object.keys(QUESTS);

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------
function countIn(list, name) { let n = 0; for (const it of list) if (it === name) n++; return n; }

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
  }
  return { have: Math.min(have, need), need, label: obj.label, done: have >= need };
}

export function questProgress(p, q) {
  const objs = q.objectives.map(o => objectiveProgress(p, q, o));
  return { objectives: objs, complete: objs.every(o => o.done) };
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
      });
      if (pr.complete) ready[q.giver] = true;
      continue;
    }
    if (canStart(p, q)) {
      available.push({ id, name: q.name, giver: q.giver, summary: q.summary, intro: q.intro,
        minLevel: q.minLevel || 1, reward: q.reward,
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
