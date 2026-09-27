// Validate every quest against the shipped world data. Run: node tools/questcheck.mjs
// Checks each quest's giver, prerequisite chain, objectives and rewards resolve
// against real NPCs / mobs / POIs / chests / items, and simulates completing
// each quest so the progress logic is exercised end-to-end. Exit code 1 on any
// error, so it doubles as a CI gate.

import { QUESTS, QUEST_IDS, questProgress, canStart, recordUse } from '../server/quests.js';
import { ITEMS } from '../server/items.js';
import { MONSTER_TEMPLATES, STARTING_INVENTORY } from '../server/balance.js';
import { ORES, oreFromModel, PICKAXES } from '../server/mining.js';
import { FISH, RODS } from '../server/fishing.js';
import { COOKABLES } from '../server/cooking.js';
import { darkwoods } from '../server/zones/darkwoods.js';
import { spiderden } from '../server/zones/spiderden.js';

const ZONES = { darkwoods, spiderden };

// Lookups from the real world data.
const npcs = new Set(), pois = new Set(), chests = new Set(), spawnTypes = new Set(), eliteNames = new Set(), dropItems = new Set();
const objectIds = new Set(), objectTags = new Map(), roamingTypes = new Set();
const eliteCount = new Map(), eliteLevel = new Map();
for (const [zid, z] of Object.entries(ZONES)) {
  for (const n of (z.npcs || [])) npcs.add(n.id);
  for (const p of (z.pois || [])) pois.add(`${zid}:${p.key}`);
  for (const c of (z.chests || [])) chests.add(`${zid}:${c.id}`);
  for (const s of (z.spawns || [])) { spawnTypes.add(s.type); roamingTypes.add(s.type); }
  for (const o of (z.objects || [])) {
    objectIds.add(o.id);
    if (o.tag) objectTags.set(o.tag, (objectTags.get(o.tag) || 0) + 1);
  }
  for (const e of (z.elites || [])) {
    spawnTypes.add(e.type); if (e.name) eliteNames.add(e.name);
    eliteCount.set(e.type, (eliteCount.get(e.type) || 0) + 1);
    if (e.name) eliteLevel.set(e.name, e.level);
  }
}
for (const t of Object.values(MONSTER_TEMPLATES)) {
  for (const d of (t.droptable || [])) if (d.item) dropItems.add(d.item);
  for (const l of (t.loot || [])) if (l.item) dropItems.add(l.item);
}
const canObtainItem = (name) => !!ITEMS[name] || dropItems.has(name);

// What a player can actually come by: dropped by something that SPAWNS in a
// zone, or picked up off the ground / a node rather than a corpse.
const droppedBySpawning = new Set();
for (const [key, t] of Object.entries(MONSTER_TEMPLATES)) {
  if (!spawnTypes.has(key)) continue;
  for (const d of [...(t.droptable || []), ...(t.loot || [])]) if (d.item) droppedBySpawning.add(d.item);
}
// Gathered rather than killed: picked off a world object, mined out of a vein,
// pulled out of the water, cooked, or lifted out of a chest.
//
// This USED to be a list I typed out by hand, and it was the same class of bug
// it existed to catch. It excused 'Egg' and 'Feather' -- both of which drop
// from chickens and nothing else, and no chicken spawned anywhere in the zone,
// so Maggie's henhouse and the first quest in Alric's chain were both dead. The
// list said they were fine because I had written them down. Derive it instead:
// if the world does not actually hand the item over somewhere, nothing here
// gets to say otherwise.
const gatherable = new Set();
const source = new Map();                       // item -> where it comes from
const note = (item, where) => { if (!item) return; gatherable.add(item); if (!source.has(item)) source.set(item, where); };
for (const [zid, z] of Object.entries(ZONES)) {
  for (const o of (z.objects || [])) if (o.gives) note(o.gives.item, `${zid} object ${o.id}`);
  for (const c of (z.chests || [])) if (c.item) note(c.item, `${zid} chest ${c.id}`);
  // A vein's ore is the item; a fishing spot's tier decides which fish.
  for (const oreKey of Object.keys(ORES)) {
    if ((z.scatter || []).some(sc => oreFromModel(sc.m) === oreKey)) note(oreKey, `${zid} ore veins`);
  }
  if ((z.fishingSpots || []).length) for (const [k, f] of Object.entries(FISH)) note(f.item || k, `${zid} fishing`);
}
// What you start with is a source like any other -- and for fishing it is the
// ONLY one. No mob drops a rod, no chest holds one and merchants only buy, so
// every fish in the game hangs off one line of the character-creation code.
for (const it of STARTING_INVENTORY) note(it, 'starting kit');
// Cooking turns a raw item into a cooked one, so the cooked side is obtainable
// whenever the raw side is. (This read `cooked.item`. The field is `cooked`, so
// `out` was an object, the typeof guard rejected it, and the whole branch had
// never contributed a single item -- a derived check quietly deriving nothing,
// which is the same failure as the hand-written list it replaced. It stayed
// invisible until a quest actually asked for a cooked item.)
for (const [raw, rec] of Object.entries(COOKABLES)) {
  const out = typeof rec === 'string' ? rec : rec.cooked;
  if (typeof out === 'string' && (gatherable.has(raw) || dropItems.has(raw))) note(out, `cooked from ${raw}`);
}
// Fishing and cooking chain: a raw fish is gathered, so its cooked form is too.
for (const [raw, rec] of Object.entries(COOKABLES)) {
  const out = typeof rec === 'string' ? rec : rec.cooked;
  if (typeof out === 'string' && gatherable.has(raw)) note(out, `cooked from ${raw}`);
}

// What level a quest really lets you in at: its own minLevel, or the highest
// one anywhere behind it, whichever is greater.
const effectiveLevel = (id, seen = new Set()) => {
  if (seen.has(id) || !QUESTS[id]) return 0;
  seen.add(id);
  let m = QUESTS[id].minLevel || 1;
  for (const r of (QUESTS[id].requires || [])) m = Math.max(m, effectiveLevel(r, seen));
  return m;
};

let errors = 0, warns = 0;
const err = (id, m) => { console.log(`  ✗ [${id}] ${m}`); errors++; };
const warn = (id, m) => { console.log(`  ! [${id}] ${m}`); warns++; };

for (const id of QUEST_IDS) {
  const q = QUESTS[id];
  if (q.id !== id) err(id, `id mismatch (${q.id})`);
  if (!npcs.has(q.giver)) err(id, `giver '${q.giver}' is not a real NPC`);
  for (const r of (q.requires || [])) if (!QUESTS[r]) err(id, `requires unknown quest '${r}'`);
  // A quest states the level it was written for. If its prerequisite chain does
  // not let you in until much later, it is being served in the wrong band --
  // What the Chapel Kept says 8 and was six bats and a chest, but it hung off
  // Chief Rattlecap, so raising HIM to match his level 14 elite dragged it to
  // 12 with him. A chain should order content, not relevel it.
  {
    const open = effectiveLevel(id), own = q.minLevel || 1;
    if (open - own >= 4)
      warn(id, `written for level ${own} but its chain does not open until ${open}`);
  }
  for (const it of (q.reward?.items || [])) if (!ITEMS[it]) err(id, `reward item '${it}' not in ITEMS`);
  for (const o of q.objectives) {
    if (o.type === 'collect') {
      // "Is it a real item" is not the same question as "can a player get one".
      // 'Venom Sac' is a defined item that nothing drops and nobody sells, and
      // the Silk and Venom quest asked for two of them -- it passed this check
      // for months and could never be finished.
      if (!canObtainItem(o.item)) err(id, `collect item '${o.item}' is not obtainable`);
      else if (!gatherable.has(o.item) && !droppedBySpawning.has(o.item))
        err(id, `collect item '${o.item}' exists but nothing that spawns drops it`);
    }
    else if (o.type === 'kill') {
      if (!MONSTER_TEMPLATES[o.target]) err(id, `kill target '${o.target}' has no template`);
      else if (!spawnTypes.has(o.target)) warn(id, `kill target '${o.target}' never spawns`);
      // Elite types were folded into spawnTypes, so "kill goblin_chief x2"
      // looked satisfiable while the only goblin_chief in the world was Chief
      // Rattlecap -- meaning the line read "kill this named boss twice, waiting
      // out his respawn in between". A kill objective wants ordinary mobs; a
      // named one is what `slay` is for.
      else if (!roamingTypes.has(o.target)) {
        const n = eliteCount.get(o.target) || 0;
        if ((o.count || 1) > n)
          err(id, `kill target '${o.target}' x${o.count || 1} only exists as ${n} named elite(s) — that is farming a boss, not killing mobs`);
      }
    }
    else if (o.type === 'slay') {
      if (!eliteNames.has(o.name)) err(id, `slay target '${o.name}' is not a named elite`);
      // The level a quest OPENS at is the highest minLevel anywhere in its
      // prerequisite chain, not its own. Chief Rattlecap was a level 14 elite
      // behind a chain that opened at 5, and The Rootbound Guardian a level 16
      // behind one that opened at 7 -- both nine levels over the head of the
      // player the quest invited in. A boss is meant to be a stretch, not a
      // wall.
      else {
        const lvl = eliteLevel.get(o.name) || 0, open = effectiveLevel(id);
        if (lvl - open >= 4)
          err(id, `slay '${o.name}' is level ${lvl} but the quest chain opens at ${open} — ${lvl - open} levels over your head`);
      }
    }
    else if (o.type === 'reach') { if (!pois.has(`${o.zone}:${o.poi}`)) err(id, `reach POI '${o.zone}:${o.poi}' does not exist`); }
    else if (o.type === 'chest') { if (!chests.has(`${o.zone}:${o.chest}`)) err(id, `chest '${o.zone}:${o.chest}' does not exist`); }
    // The checker only knew the first five types while quests.js grew five
    // more, so every quest using them reported as broken whether it was or not
    // -- which made the tool useless exactly when the map was rebuilt under it.
    // A tag with nothing in the world wearing it is the quietest broken quest
    // there is: no error anywhere, the line just never moves. Dark Woods
    // shipped with zone.objects EMPTY and six quests asking it for glowcaps,
    // lanterns, carts, berries, signal fires and a banner. Counting matters
    // too -- 'use' with count 3 needs three DISTINCT tagged objects, because
    // progress is the number of different ones you have touched.
    else if (o.type === 'use') {
      if (!o.object && !o.tag) err(id, `use objective needs an object or a tag`);
      else if (o.object && !objectIds.has(o.object)) err(id, `use object '${o.object}' is not in any zone`);
      else if (o.tag) {
        const have = objectTags.get(o.tag) || 0, need = o.count || 1;
        if (!have) err(id, `use tag '${o.tag}' — nothing in any zone carries it`);
        else if (have < need) err(id, `use tag '${o.tag}' needs ${need} distinct objects, world has ${have}`);
      }
    }
    else if (o.type === 'gather' || o.type === 'avoid') {
      if (!o.tag) err(id, `${o.type} objective needs a tag`);
      else if (!objectTags.has(o.tag)) err(id, `${o.type} tag '${o.tag}' — nothing in any zone carries it`);
      // Gathering counts what the nodes HAND OVER, so a node that gives nothing
      // can never fill a gather line however many times you pick it.
      else if (o.type === 'gather') {
        let yield_ = 0;
        for (const z of Object.values(ZONES))
          for (const ob of (z.objects || [])) if (ob.tag === o.tag && ob.gives) yield_ += (ob.gives.count || 1);
        if (!yield_) err(id, `gather tag '${o.tag}' — its objects give nothing`);
      }
    }
    else if (o.type === 'talk' || o.type === 'give') {
      if (!npcs.has(o.npc)) err(id, `${o.type} target '${o.npc}' is not a real NPC`);
      // Goods handed to a third party got no obtainability check at all, so a
      // 'give' could ask for something the world never produces and the only
      // symptom would be a player standing in front of Pib with nothing to
      // hand him. Same test the collect lines get.
      for (const g of (o.items || [])) {
        if (!canObtainItem(g.item)) err(id, `give item '${g.item}' is not obtainable`);
        else if (!gatherable.has(g.item) && !droppedBySpawning.has(g.item))
          err(id, `give item '${g.item}' exists but nothing in the world hands it over`);
      }
    }
    else err(id, `unknown objective type '${o.type}'`);
  }
  // Simulate completing every objective; the quest must then report complete.
  const p = { level: q.minLevel || 1, inventory: [], questKills: { [id]: {} }, questFlags: new Set(), openedChests: new Set(), questDone: new Set(), quests: new Map([[id, {}]]), usedObjects: new Set(), talkedTo: new Set() };
  // Every object in the world, so the 'use' and 'gather' lines can be walked
  // with the REAL ones instead of invented ones.
  const worldObjects = Object.values(ZONES).flatMap(zz => zz.objects || []);
  for (const o of q.objectives) {
    if (o.type === 'collect') for (let i = 0; i < (o.count || 1); i++) p.inventory.push(o.item);
    else if (o.type === 'kill') p.questKills[id][o.target] = (o.count || 1);
    else if (o.type === 'slay') p.questKills[id]['★' + o.name] = (o.count || 1);
    else if (o.type === 'reach') p.questFlags.add(`reach:${o.zone}:${o.poi}`);
    else if (o.type === 'chest') p.openedChests.add(`${o.zone}:${o.chest}`);
    // Hand-filling usedObjects and questKills made this an assertion that
    // questProgress agrees with itself -- it could not fail. Put the player's
    // hands on the objects the zone actually contains and let recordUse, the
    // same function the server calls, do the counting.
    else if (o.type === 'use' || o.type === 'gather') {
      const pool = o.object ? worldObjects.filter(w => w.id === o.object)
                            : worldObjects.filter(w => w.tag === o.tag);
      let touched = 0;
      for (const w of pool) {
        if (touched >= (o.count || 1)) break;
        recordUse(p, w);
        if (w.gives) for (let i = 0; i < (w.gives.count || 1); i++) p.inventory.push(w.gives.item);
        touched++;
      }
    }
    else if (o.type === 'talk') p.questFlags.add(`talk:${o.npc}`);
    else if (o.type === 'give') p.questFlags.add(`give:${id}:${o.npc}`);
    // `avoid` is satisfied by doing nothing, which is already the start state.
  }
  if (!questProgress(p, q).complete) err(id, 'objectives satisfied but quest does not report complete');
}

// The reward curve must not go backwards. A quest's xp is set once, when it is
// written, and then the level it opens at moves underneath it -- Chief
// Rattlecap was written at level 5 for 750 xp, and when he was raised to 12 to
// match his elite he sat between a 1400 and a 1700 still paying 750. Compare
// band medians rather than individual quests, so one deliberately small errand
// in a band does not cry wolf.
{
  const byBand = {};
  for (const id of QUEST_IDS) {
    const l = effectiveLevel(id);
    (byBand[l] = byBand[l] || []).push({ id, xp: QUESTS[id].reward?.xp || 0 });
  }
  const bands = Object.keys(byBand).map(Number).sort((a, b) => a - b);
  let prev = 0, prevBand = null;
  for (const l of bands) {
    const v = byBand[l].map(q => q.xp).sort((a, b) => a - b);
    const med = v[Math.floor(v.length / 2)];
    if (med < prev)
      warn(byBand[l][0].id, `level ${l} pays a median of ${med} xp, less than level ${prevBand}'s ${prev} — the reward curve goes backwards here`);
    prev = med; prevBand = l;
  }
}

// A gathering skill needs a tool, and a tool that exists in no drop table, no
// chest, no shop and no starting kit makes the whole skill unreachable however
// many nodes the world puts down. The Dark Woods has nine fishing spots and
// four catchable species behind a rod that only character creation hands out.
{
  const reachable = (item) => droppedBySpawning.has(item) || gatherable.has(item);
  for (const [skill, tools] of [['fishing', Object.keys(RODS)], ['mining', Object.keys(PICKAXES)]]) {
    const usedBy = QUEST_IDS.filter(id => (QUESTS[id].objectives || []).some(o => {
      if (o.type !== 'collect') return false;
      return skill === 'fishing'
        ? Object.values(FISH).some(f => (f.item || '') === o.item)
        : Object.keys(ORES).some(k => `${k} Ore` === o.item);
    }));
    if (!usedBy.length) continue;                   // nothing asks for it; not this check's business
    const have = tools.filter(reachable);
    if (!have.length)
      err(usedBy[0], `${skill} is asked for but no ${skill} tool is obtainable anywhere (${tools.join(', ')})`);
  }
}

// Prereq chains must resolve without cycles.
const seen = {}, resolve = (id, stack = []) => {
  if (seen[id] === 'ok') return true;
  if (stack.includes(id)) { err(id, `requires cycle: ${[...stack, id].join(' -> ')}`); return false; }
  for (const r of (QUESTS[id].requires || [])) if (!QUESTS[r] || !resolve(r, [...stack, id])) return false;
  seen[id] = 'ok'; return true;
};
for (const id of QUEST_IDS) resolve(id);

// Every quest must become startable once its prerequisites are done.
const done = new Set(), pending = new Set(QUEST_IDS); let progress = true;
while (progress) {
  progress = false;
  for (const id of [...pending]) {
    if (canStart({ level: 99, questDone: done, quests: new Map() }, QUESTS[id])) { done.add(id); pending.delete(id); progress = true; }
  }
}
for (const id of pending) err(id, `never becomes startable (prereqs: ${(QUESTS[id].requires || []).join(', ')})`);

console.log(`\n${QUEST_IDS.length} quests checked — ${errors} error(s), ${warns} warning(s).`);
console.log(errors ? 'FAIL' : 'ALL QUESTS PASS');
process.exit(errors ? 1 : 0);
