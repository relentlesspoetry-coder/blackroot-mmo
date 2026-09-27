// Check the asset wiring. Run: node tools/assets.mjs
//
// Three ways this can silently go wrong, none of which a syntax check catches:
// a zone declares a model that isn't on disk (it just never appears), an item
// has a model on disk that no zone loads (it falls back to the generic shard
// wherever it drops), or a model sits in the repo that nothing references at
// all (dead weight in the download).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { darkwoods } from '../server/zones/darkwoods.js';
import { spiderden } from '../server/zones/spiderden.js';
import { MONSTER_TEMPLATES } from '../server/balance.js';
import { ITEMS, WEAPON_ITEMS } from '../server/items.js';
import { ORES } from '../server/mining.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'client', 'models');
const ZONES = [darkwoods, spiderden];

let problems = 0;
const flag = (msg) => { console.log('  !! ' + msg); problems++; };
const key = (name) => name.replace(/['\u2019]/g, '').replace(/\s+/g, '_');
const exists = (rel) => fs.existsSync(path.join(MODELS, rel + '.glb'));

// The client's always-loaded set, read from the client itself so the two can't
// drift apart.
const clientSrc = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
const coreMatch = clientSrc.match(/const CORE_MODELS = \[(.*?)\];/s);
const CORE = coreMatch ? [...coreMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];

console.log('\n=== declared models ===');
console.log(`core (always loaded)   ${CORE.join(', ') || '(none)'}`);
for (const z of ZONES) {
  const list = z.models || [];
  console.log(`${z.name.padEnd(22)} ${String(list.length).padStart(3)} models`);
  for (const m of list) if (!exists(m)) flag(`${z.name} declares ${m}, which is not on disk`);
}
for (const m of CORE) if (!exists(m)) flag(`CORE_MODELS declares ${m}, which is not on disk`);

// Which models can the player actually see, in which zone?
const loadedIn = new Map(); // zone id -> Set of bare model names
for (const z of ZONES) {
  loadedIn.set(z.id, new Set([...CORE, ...(z.models || [])].map(m => m.split('/').pop())));
}

console.log('\n=== droppable items ===');
// Everything that can end up on the ground, and where.
const dropZones = new Map(); // item -> Set(zone id)
const addDrop = (item, zid) => {
  if (!dropZones.has(item)) dropZones.set(item, new Set());
  dropZones.get(item).add(zid);
};
for (const z of ZONES) {
  const types = new Set([...(z.spawns || []).map(s => s.type), ...(z.elites || []).map(e => e.type)]);
  for (const t of types) {
    for (const entry of (MONSTER_TEMPLATES[t]?.loot || [])) if (entry.item) addDrop(entry.item, z.id);
  }
  for (const e of (z.elites || [])) for (const d of (e.drops || [])) addDrop(d, z.id);
  // mined ore drops straight into the bag, but still renders from the bag icon
  for (const spec of (z.scatter || [])) {
    const m = /^(\w+?)_Ore_Vein$/.exec(spec.model);
    if (m && ORES[m[1]]) addDrop(ORES[m[1]].ore, z.id);
  }
}

let modelled = 0, shard = 0;
const missingInZone = [];
for (const [item, zids] of [...dropZones].sort()) {
  const k = key(item);
  if (!exists('items/' + k)) { shard++; continue; }
  modelled++;
  for (const zid of zids) {
    if (!loadedIn.get(zid).has(k)) missingInZone.push(`${item} drops in ${zid} but ${k} is not loaded there`);
  }
}
console.log(`${dropZones.size} droppable items — ${modelled} have a model, ${shard} use the generic shard`);
for (const m of missingInZone) flag(m);

console.log('\n=== unreferenced models ===');
const referenced = new Set();
for (const m of CORE) referenced.add(m.split('/').pop());
for (const z of ZONES) for (const m of (z.models || [])) referenced.add(m.split('/').pop());
const bareOf = (f) => f.replace('.glb', '');
const weaponModels = new Set(Object.values(WEAPON_ITEMS).map(d => d.model));
const walk = (dir, prefix = '') => {
  for (const f of fs.readdirSync(path.join(MODELS, dir))) {
    const rel = path.join(dir, f);
    if (fs.statSync(path.join(MODELS, rel)).isDirectory()) { walk(rel, prefix); continue; }
    if (!f.endsWith('.glb')) continue;
    if (rel.startsWith('human/hair/')) continue; // hairstyles load on demand by the look picker
    if (rel.startsWith('human/armor/')) continue; // the armour wardrobe streams in per worn piece (items.js ARMOR_ITEMS)
    if (rel.startsWith('weapons/')) { if (!weaponModels.has(bareOf(f))) console.log(`  unused: ${rel}`); continue; } // held/ground weapon models (items.js WEAPON_ITEMS)
    const bare = f.replace('.glb', '');
    if (!referenced.has(bare)) console.log(`  unused: ${rel}`);
  }
};
walk('.');

console.log(`\n${problems === 0 ? 'ASSET WIRING OK' : problems + ' PROBLEM(S)'}\n`);
process.exit(problems === 0 ? 0 : 1);
