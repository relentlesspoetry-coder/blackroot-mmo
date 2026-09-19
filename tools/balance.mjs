// Measure the combat curve. Run: node tools/balance.mjs
// Prints, for every spawn group in every zone, how long a fight takes and how
// long the player survives it. No guessing — these are the shipped numbers.

import {
  MONSTER_TEMPLATES, playerDps, playerDamageRange, monsterDps, monsterHp,
  maxHpForLevel, xpForLevel, scaledMonster, ELITE, PLAYER_REGEN_PER_SEC,
} from '../server/balance.js';
import { ITEMS, equipStats, expectedGear } from '../server/items.js';
import { darkwoods } from '../server/zones/darkwoods.js';
import { hiddencave } from '../server/zones/hiddencave.js';

const GEAR = process.env.BARE ? () => ({ atk: 0, def: 0 }) : (l) => equipStats(expectedGear(l));

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 6, d = 1) => String(v.toFixed(d)).padStart(n);

function fight(type, mobLevel, playerLevel, elite = false, over = {}) {
  const hpM = elite ? (over.hpMult || ELITE.hp) / ELITE.hp : 1;
  const dmgM = elite ? (over.dmgMult || ELITE.dmg) / ELITE.dmg : 1;
  const gear = GEAR(playerLevel);
  const hp = Math.round(monsterHp(type, mobLevel, elite) * hpM);
  const ttk = hp / playerDps(playerLevel, gear.atk);
  // Regen is locked out during a fight now, so it doesn't offset incoming
  // damage here. Set REGEN=1 to see the old, softer numbers.
  const regen = process.env.REGEN ? PLAYER_REGEN_PER_SEC : 0;
  const incoming = monsterDps(type, mobLevel, elite, gear.def) * dmgM - regen;
  const ttd = incoming <= 0 ? Infinity : maxHpForLevel(playerLevel) / incoming;
  return { hp, ttk, ttd, ratio: ttd / ttk };
}

function verdict(r, elite) {
  if (r.ttd === Infinity) return 'trivial';
  if (elite) return r.ratio < 1 ? 'UNWINNABLE' : r.ratio < 2.2 ? 'tense (intended)' : 'soft for a boss';
  if (r.ratio < 1.5) return 'TOO HARD';
  if (r.ratio < 3) return 'dangerous';
  if (r.ratio < 8) return 'fair';
  return 'gentle';
}

console.log(`\n=== Player power by level ===${process.env.BARE ? '  (BARE — no equipment)' : '  (with expected equipment)'}`);
console.log(pad('lvl', 5) + pad('hp', 6) + pad('hit', 12) + pad('dps', 7) + pad('atk', 5) + pad('def', 5) + 'gear');
for (const l of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  const g = GEAR(l);
  const [lo, hi] = playerDamageRange(l, g.atk);
  const worn = Object.values(expectedGear(l)).filter(Boolean);
  console.log(pad(l, 5) + pad(maxHpForLevel(l), 6) + pad(`${lo}-${hi}`, 12) +
    num(playerDps(l, g.atk), 5, 1) + '  ' + pad('+' + g.atk, 5) + pad('+' + g.def, 5) +
    (process.env.BARE ? '—' : worn.join(', ') || '—'));
}

console.log('\n=== Equipment ===');
console.log(pad('item', 24) + pad('slot', 9) + pad('atk', 6) + pad('def', 6) + pad('lv', 4) + 'value');
for (const [name, d] of Object.entries(ITEMS)) {
  if (!d.slot) continue;
  console.log(pad(name, 24) + pad(d.slot, 9) + pad(d.atk ? '+' + d.atk : '—', 6) +
    pad(d.def ? '+' + d.def : '—', 6) + pad(d.level || 1, 4) + (d.value || 0) + ' gp');
}

for (const zone of [darkwoods, hiddencave]) {
  console.log(`\n=== ${zone.name} — expected fights ===`);
  console.log(pad('area', 26) + pad('mob', 12) + pad('mLv', 5) + pad('pLv', 5) +
              pad('mobHP', 7) + pad('kill s', 8) + pad('die s', 8) + pad('ratio', 7) + 'verdict');
  for (const s of zone.spawns) {
    const pLv = s.expect || s.level + 1;
    const r = fight(s.type, s.level, pLv);
    console.log(pad(s.hint || '—', 26) + pad(MONSTER_TEMPLATES[s.type].name, 12) +
      pad(s.level, 5) + pad(pLv, 5) + pad(r.hp, 7) + num(r.ttk, 7) + '' +
      pad(r.ttd === Infinity ? '  never' : num(r.ttd, 7), 8) +
      pad(r.ttd === Infinity ? '   —' : num(r.ratio, 5, 1), 7) +
      (MONSTER_TEMPLATES[s.type].passive ? 'passive' : verdict(r, false)));
  }
  for (const e of (zone.elites || [])) {
    const pLv = e.expect || e.level;
    const r = fight(e.type, e.level, pLv, true, e);
    console.log(pad('★ ' + e.name, 26) + pad(MONSTER_TEMPLATES[e.type].name, 12) +
      pad(e.level, 5) + pad(pLv, 5) + pad(r.hp, 7) + num(r.ttk, 7) + '' +
      pad(num(r.ttd, 7), 8) + pad(num(r.ratio, 5, 1), 7) + verdict(r, true));
  }
}

console.log('\n=== XP economy (one full clear, no respawns) ===');
let total = 0;
for (const zone of [darkwoods, hiddencave]) {
  let z = 0;
  for (const s of zone.spawns) z += s.count * scaledMonster(s.type, s.level).xp;
  for (const e of (zone.elites || [])) z += Math.round(scaledMonster(e.type, e.level).xp * ELITE.xp);
  console.log(pad(zone.name, 26) + num(z, 8, 0) + ' xp');
  total += z;
}
let cum = 0, reached = 1;
for (let l = 1; l <= 14; l++) { if (cum + xpForLevel(l) > total) break; cum += xpForLevel(l); reached = l + 1; }
console.log(pad('TOTAL', 26) + num(total, 8, 0) + ' xp  ->  reaches level ' + reached +
            ' (needs ' + cum + ' xp; next level costs ' + xpForLevel(reached) + ')');
console.log('');
