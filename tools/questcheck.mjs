// Validate every quest against the shipped world data. Run: node tools/questcheck.mjs
// Checks each quest's giver, prerequisite chain, objectives and rewards resolve
// against real NPCs / mobs / POIs / chests / items, and simulates completing
// each quest so the progress logic is exercised end-to-end. Exit code 1 on any
// error, so it doubles as a CI gate.

import { QUESTS, QUEST_IDS, questProgress, canStart } from '../server/quests.js';
import { ITEMS } from '../server/items.js';
import { MONSTER_TEMPLATES } from '../server/balance.js';
import { darkwoods } from '../server/zones/darkwoods.js';
import { hiddencave } from '../server/zones/hiddencave.js';
import { killingfields } from '../server/zones/killingfields.js';

const ZONES = { darkwoods, hiddencave, killingfields };

// Lookups from the real world data.
const npcs = new Set(), pois = new Set(), chests = new Set(), spawnTypes = new Set(), eliteNames = new Set(), dropItems = new Set();
for (const [zid, z] of Object.entries(ZONES)) {
  for (const n of (z.npcs || [])) npcs.add(n.id);
  for (const p of (z.pois || [])) pois.add(`${zid}:${p.key}`);
  for (const c of (z.chests || [])) chests.add(`${zid}:${c.id}`);
  for (const s of (z.spawns || [])) spawnTypes.add(s.type);
  for (const e of (z.elites || [])) { spawnTypes.add(e.type); if (e.name) eliteNames.add(e.name); }
}
for (const t of Object.values(MONSTER_TEMPLATES)) {
  for (const d of (t.droptable || [])) if (d.item) dropItems.add(d.item);
  for (const l of (t.loot || [])) if (l.item) dropItems.add(l.item);
}
const canObtainItem = (name) => !!ITEMS[name] || dropItems.has(name);

let errors = 0, warns = 0;
const err = (id, m) => { console.log(`  ✗ [${id}] ${m}`); errors++; };
const warn = (id, m) => { console.log(`  ! [${id}] ${m}`); warns++; };

for (const id of QUEST_IDS) {
  const q = QUESTS[id];
  if (q.id !== id) err(id, `id mismatch (${q.id})`);
  if (!npcs.has(q.giver)) err(id, `giver '${q.giver}' is not a real NPC`);
  for (const r of (q.requires || [])) if (!QUESTS[r]) err(id, `requires unknown quest '${r}'`);
  for (const it of (q.reward?.items || [])) if (!ITEMS[it]) err(id, `reward item '${it}' not in ITEMS`);
  for (const o of q.objectives) {
    if (o.type === 'collect') { if (!canObtainItem(o.item)) err(id, `collect item '${o.item}' is not obtainable`); }
    else if (o.type === 'kill') { if (!MONSTER_TEMPLATES[o.target]) err(id, `kill target '${o.target}' has no template`); else if (!spawnTypes.has(o.target)) warn(id, `kill target '${o.target}' never spawns`); }
    else if (o.type === 'slay') { if (!eliteNames.has(o.name)) err(id, `slay target '${o.name}' is not a named elite`); }
    else if (o.type === 'reach') { if (!pois.has(`${o.zone}:${o.poi}`)) err(id, `reach POI '${o.zone}:${o.poi}' does not exist`); }
    else if (o.type === 'chest') { if (!chests.has(`${o.zone}:${o.chest}`)) err(id, `chest '${o.zone}:${o.chest}' does not exist`); }
    else err(id, `unknown objective type '${o.type}'`);
  }
  // Simulate completing every objective; the quest must then report complete.
  const p = { level: q.minLevel || 1, inventory: [], questKills: { [id]: {} }, questFlags: new Set(), openedChests: new Set(), questDone: new Set(), quests: new Map() };
  for (const o of q.objectives) {
    if (o.type === 'collect') for (let i = 0; i < (o.count || 1); i++) p.inventory.push(o.item);
    else if (o.type === 'kill') p.questKills[id][o.target] = (o.count || 1);
    else if (o.type === 'slay') p.questKills[id]['★' + o.name] = (o.count || 1);
    else if (o.type === 'reach') p.questFlags.add(`reach:${o.zone}:${o.poi}`);
    else if (o.type === 'chest') p.openedChests.add(`${o.zone}:${o.chest}`);
  }
  if (!questProgress(p, q).complete) err(id, 'objectives satisfied but quest does not report complete');
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
