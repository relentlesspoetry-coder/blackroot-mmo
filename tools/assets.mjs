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
// The LIVE world, not a region's builder output. This read darkwoods.js while
// the server ran blackroot.js -- the fourth checker in this repo caught doing
// it -- so it reported on a map nobody was playing and called the Killing
// Fields' models unreferenced.
import { blackroot } from '../server/zones/blackroot.js';
import { spiderden } from '../server/zones/spiderden.js';
import { MONSTER_TEMPLATES, MOB_ART } from '../server/balance.js';
import { ITEMS, WEAPON_ITEMS } from '../server/items.js';
import { ORES } from '../server/mining.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'client', 'models');
const ZONES = [blackroot, spiderden];

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

// A ground item does NOT have to be in the zone's preload list. makeItemMesh
// draws a themed stand-in and streams the GLB in behind it, then swaps -- which
// is deliberate, and has a comment saying so. This check demanded the preload
// anyway and raised 35 failures against a client doing exactly what it meant
// to, which is how it came to exit 1 as a matter of course and stopped being
// read at all. What actually has to be true is that the stream can succeed:
// the file is on disk under the name the client will ask for.
let modelled = 0, shard = 0;
for (const [item] of [...dropZones].sort()) {
  if (exists('items/' + key(item))) modelled++; else shard++;
}
console.log(`${dropZones.size} droppable items — ${modelled} have a model, ${shard} use the generic shard`);

console.log('\n=== unreferenced models ===');
const referenced = new Set();
for (const m of CORE) referenced.add(m.split('/').pop());
for (const z of ZONES) for (const m of (z.models || [])) referenced.add(m.split('/').pop());
// Mob bodies are not in zone.models; the server derives them from the zone's
// spawns (server.js mobModelsFor) out of MOB_ART.
//
// This used to scrape `const MOB_MODEL = {...}` out of the client. That table
// was moved to the server long ago -- the client's own comment says that while
// it lived there not one mob model was ever requested -- so the regex matched
// nothing, MOB was empty, and every creature in the game was listed here as an
// unused file. Twenty "unused" lines nobody reads is also how a real one hides:
// the egg mobs pointed at 'Egg', which is an ITEM model living in items/, and
// the world asked for models/Egg.glb and got a 404 on every single login.
// Import the table instead of pattern-matching a copy of it, and check it.
for (const [type, art] of Object.entries(MOB_ART)) {
  if (!exists(art.model)) flag(`MOB_ART '${type}' declares ${art.model}, which is not on disk`);
  referenced.add(art.model.split('/').pop());
}
// Likewise the wardrobe, the tree mixes and the bush list.
for (const listName of ['TREES_WET', 'TREES_DEEP', 'TREES_LIGHT', 'BUSH_SPECIES', 'AMBIENT_SPECIES']) {
  const m = clientSrc.match(new RegExp(`const ${listName}\\s*=\\s*\\[(.*?)\\];`, 's'));
  if (m) for (const q of m[1].matchAll(/'([^']+)'/g)) referenced.add(q[1].split('/').pop());
}
const ITEM_FILES = new Set(Object.keys(ITEMS).map(key));
const bareOf = (f) => f.replace('.glb', '');
// Weapon-folder art is referenced from three places, and reading only the
// first called the fishing rods and the bard's lute unused: WEAPON_ITEMS, the
// weapon-slot entries declared in plain ITEMS (both rods live there), and the
// client loading one by name for a held prop (weapons/00_Lute).
const weaponModels = new Set([
  ...Object.values(WEAPON_ITEMS).map(d => d.model),
  ...Object.values(ITEMS).map(d => d && d.model).filter(Boolean),
  ...[...clientSrc.matchAll(/'weapons\/([A-Za-z0-9_]+)'/g)].map(m => m[1]),
]);
const walk = (dir, prefix = '') => {
  for (const f of fs.readdirSync(path.join(MODELS, dir))) {
    const rel = path.join(dir, f);
    if (fs.statSync(path.join(MODELS, rel)).isDirectory()) { walk(rel, prefix); continue; }
    if (!f.endsWith('.glb')) continue;
    if (rel.startsWith('human/hair/')) continue; // hairstyles load on demand by the look picker
    if (rel.startsWith('human/armor/')) continue; // the armour wardrobe streams in per worn piece (items.js ARMOR_ITEMS)
    if (rel.startsWith('weapons/')) { if (!weaponModels.has(bareOf(f))) console.log(`  unused: ${rel}`); continue; } // held/ground weapon models (items.js WEAPON_ITEMS)
    // items/ streams on demand from the item's own name (makeItemMesh), so a
    // file there is referenced if an item is named after it -- it is never in
    // anybody's preload list and every one of them was being listed as unused.
    if (dir === 'items' && ITEM_FILES.has(f.replace('.glb', ''))) continue;
    const bare = f.replace('.glb', '');
    if (!referenced.has(bare)) console.log(`  unused: ${rel}`);
  }
};
walk('.');

console.log(`\n${problems === 0 ? 'ASSET WIRING OK' : problems + ' PROBLEM(S)'}\n`);
process.exit(problems === 0 ? 0 : 1);
