// What does mining actually feel like? Run: node tools/mining.mjs
// Prints how long each ore takes per swing and per ore at the level it unlocks,
// what a pickaxe upgrade is worth, and how long the levels take.

import {
  ORES, PICKAXES, swingChance, swingTime, secondsPerOre,
  xpForMiningLevel, miningLevelFromXp,
} from '../server/mining.js';
import { darkwoods } from '../server/zones/darkwoods.js';
import { hiddencave } from '../server/zones/hiddencave.js';
import { generateScatter } from '../server/worldgen.js';
import { oreFromModel } from '../server/mining.js';

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(n);

console.log('\n=== Ore tiers (mined at the level that unlocks them, with the best legal pickaxe) ===');
console.log(pad('ore', 12) + pad('lvl', 5) + pad('xp', 6) + pad('pickaxe', 17) +
            pad('chance', 8) + pad('swing', 7) + pad('sec/ore', 9) + pad('respawn', 9) + 'xp/hr');
for (const [key, ore] of Object.entries(ORES)) {
  let pick = null;
  for (const [name, p] of Object.entries(PICKAXES)) {
    if (p.level <= ore.level && (!pick || p.power > PICKAXES[pick].power)) pick = name;
  }
  const power = PICKAXES[pick].power;
  const c = swingChance(key, ore.level, power);
  const spo = secondsPerOre(key, ore.level, power);
  // A vein has to come back before it can be mined again, so the real rate is
  // bounded by respawn unless there are several veins to rotate between.
  const cycle = spo + ore.respawn;
  console.log(pad(key, 12) + pad(ore.level, 5) + pad(ore.xp, 6) + pad(pick, 17) +
    pad((c * 100).toFixed(0) + '%', 8) + num(swingTime(power), 6, 2) + ' ' +
    num(spo, 8) + ' ' + pad(ore.respawn + 's', 9) +
    Math.round(ore.xp / cycle * 3600) + ' (one vein)');
}

console.log('\n=== What a pickaxe upgrade buys (mining Iron at level 15) ===');
for (const [name, p] of Object.entries(PICKAXES)) {
  const legal = p.level <= 15;
  const spo = secondsPerOre('Iron', 15, p.power);
  console.log(pad(name, 17) + pad('power ' + p.power, 12) +
    pad('needs lvl ' + p.level, 14) + num(spo, 6) + ' sec/ore' + (legal ? '' : '   (locked)'));
}

console.log('\n=== Levelling ===');
console.log(pad('level', 7) + pad('xp to next', 12) + pad('cumulative', 12) + 'copper ore needed for this level');
let cum = 0;
for (const l of [1, 5, 8, 12, 16, 22, 30, 38, 46]) {
  let c = 0;
  for (let i = 1; i < l; i++) c += xpForMiningLevel(i);
  console.log(pad(l, 7) + pad(xpForMiningLevel(l), 12) + pad(c, 12) +
    Math.ceil(xpForMiningLevel(l) / ORES.Copper.xp));
}

console.log('\n=== Veins in the world ===');
let problems = 0;
for (const zone of [darkwoods, hiddencave]) {
  const scatter = generateScatter(zone);
  const veins = scatter.filter(o => oreFromModel(o.m));
  const by = {};
  for (const v of veins) by[oreFromModel(v.m)] = (by[oreFromModel(v.m)] || 0) + 1;
  console.log(`${pad(zone.name, 20)} ${String(veins.length).padStart(3)} veins   ` +
    Object.entries(by).map(([k, n]) => `${k}:${n}`).join(' '));
  for (const [k, n] of Object.entries(by)) {
    if (!ORES[k]) { console.log(`  !! ${k} has no ore definition`); problems++; }
  }
  // ids must be unique, or two veins deplete as one
  const ids = veins.map(v => v.i);
  if (new Set(ids).size !== ids.length) { console.log('  !! duplicate vein ids'); problems++; }
}

// Can a fresh character actually start? Copper and tin must exist above ground.
const surface = generateScatter(darkwoods).filter(o => oreFromModel(o.m));
const starters = surface.filter(o => ORES[oreFromModel(o.m)].level === 1);
if (!starters.length) { console.log('  !! nothing minable at level 1 outside the cave'); problems++; }
else console.log(`\nA level-1 miner has ${starters.length} veins reachable without entering the cave.`);

console.log(`\n${problems === 0 ? 'NO PROBLEMS' : problems + ' PROBLEM(S)'}\n`);
process.exit(problems === 0 ? 0 : 1);
