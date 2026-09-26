// Draw a zone's map from its own data. Run: node tools/map.mjs
// Writes standalone SVG files to ./maps. Nothing is hand-placed — the outline,
// rooms, spawn areas, ore and landmarks all come from the zone definition and
// the same generators the server runs, so the map cannot drift from the game.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateScatter, generateTrees } from '../server/worldgen.js';
import { oreFromModel, ORES } from '../server/mining.js';
import { MONSTER_TEMPLATES } from '../server/balance.js';
import { darkwoods } from '../server/zones/darkwoods.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'maps');
fs.mkdirSync(OUT, { recursive: true });

const RARE = new Set(['Runite', 'Adamantite', 'Mithril', 'Gold', 'Silver']);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;');

function draw(zone, opts = {}) {
  const b = zone.bounds;
  const pad = 70;
  const worldW = b.maxX - b.minX, worldD = b.maxZ - b.minZ;
  const scale = opts.scale || Math.min(900 / worldW, 900 / worldD);
  const W = Math.round(worldW * scale + pad * 2);
  const H = Math.round(worldD * scale + pad * 2 + 54);
  const X = (x) => (pad + (x - b.minX) * scale).toFixed(1);
  const Z = (z) => (pad + (z - b.minZ) * scale).toFixed(1);
  const R = (r) => (r * scale).toFixed(1);

  const parts = [];
  const add = (s) => parts.push(s);

  add(`<rect width="${W}" height="${H}" fill="#14120e"/>`);

  if (zone.boundary) {
    add(`<polygon points="${zone.boundary.map(p => `${X(p.x)},${Z(p.z)}`).join(' ')}" ` +
      `fill="#2b2a24" stroke="#6f5c3c" stroke-width="1.5"/>`);
  }
  for (const p of (zone.pools || [])) {
    add(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${R(p.r)}" fill="#1d4a63" opacity="0.55"/>`);
  }

  // Spawn areas, one tint per creature.
  const tint = {};
  const palette = ['#7f77dd', '#1d9e75', '#d85a30', '#378add', '#ba7517', '#d4537e', '#639922'];
  let ti = 0;
  for (const s of zone.spawns) {
    if (!tint[s.type]) tint[s.type] = palette[ti++ % palette.length];
    add(`<circle cx="${X(s.cx)}" cy="${Z(s.cz)}" r="${R(s.r)}" fill="${tint[s.type]}" opacity="0.13"/>`);
    add(`<circle cx="${X(s.cx)}" cy="${Z(s.cz)}" r="${R(s.r)}" fill="none" stroke="${tint[s.type]}" ` +
      `stroke-width="1" stroke-dasharray="4 5" opacity="0.65"/>`);
  }

  for (const r of (zone.rocks || [])) {
    add(`<circle cx="${X(r.x)}" cy="${Z(r.z)}" r="${R(r.r)}" fill="#4a4437" opacity="0.8"/>`);
  }
  if (zone.treeCount) {
    for (const t of generateTrees(zone)) {
      add(`<circle cx="${X(t.x)}" cy="${Z(t.z)}" r="${R(1.6)}" fill="#2f4a26" opacity="0.7"/>`);
    }
  }

  for (const o of generateScatter(zone)) {
    const ore = oreFromModel(o.m);
    if (!ore) continue;
    const rare = RARE.has(ore);
    add(`<circle cx="${X(o.x)}" cy="${Z(o.z)}" r="${rare ? 4.5 : 3}" ` +
      `fill="${rare ? '#efa227' : '#8a8378'}" opacity="${rare ? 1 : 0.75}"/>`);
  }

  for (const c of (zone.chests || [])) {
    add(`<rect x="${X(c.x) - 5}" y="${Z(c.z) - 5}" width="10" height="10" rx="2" ` +
      `fill="#c9a44a" stroke="#14120e" stroke-width="1"/>`);
  }
  for (const p of (zone.portals || [])) {
    add(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${R(p.r)}" fill="#7f77dd" opacity="0.5"/>`);
    add(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="6" fill="#cecbf6"/>`);
  }
  add(`<circle cx="${X(zone.spawn.x)}" cy="${Z(zone.spawn.z)}" r="7" fill="none" ` +
    `stroke="#ffe9b0" stroke-width="2"/>`);

  for (const e of (zone.elites || [])) {
    add(`<circle cx="${X(e.cx)}" cy="${Z(e.cz)}" r="13" fill="none" stroke="#e24b4a" stroke-width="2.5"/>`);
  }

  // Labels last so nothing draws over them.
  const byArea = new Map();
  for (const s of zone.spawns) {
    if (s.hint) byArea.set(s.hint, (byArea.get(s.hint) || []).concat(
      `${MONSTER_TEMPLATES[s.type].name} ×${s.count} · lv ${s.level}`));
  }
  for (const p of zone.pois) {
    const lines = byArea.get(p.name) || [];
    const lx = X(p.x), lz = Z(p.z);
    add(`<circle cx="${lx}" cy="${lz}" r="3.5" fill="#ffe9b0"/>`);
    add(`<text x="${lx}" y="${Number(lz) - 12}" text-anchor="middle" font-family="system-ui,sans-serif" ` +
      `font-size="15" font-weight="600" fill="#ffe9b0">${esc(p.name)}</text>`);
    lines.forEach((l, i) => {
      add(`<text x="${lx}" y="${Number(lz) + 20 + i * 15}" text-anchor="middle" ` +
        `font-family="system-ui,sans-serif" font-size="12" fill="#b9ad90">${esc(l)}</text>`);
    });
  }
  for (const e of (zone.elites || [])) {
    add(`<text x="${X(e.cx)}" y="${Number(Z(e.cz)) + 30}" text-anchor="middle" ` +
      `font-family="system-ui,sans-serif" font-size="12" font-weight="600" fill="#f09595">${esc(e.name)}</text>`);
  }

  // Footer
  const veins = generateScatter(zone).filter(o => oreFromModel(o.m)).length;
  add(`<text x="${pad}" y="34" font-family="system-ui,sans-serif" font-size="19" font-weight="600" ` +
    `fill="#e8d7ac">${esc(zone.name)}</text>`);
  add(`<text x="${W - pad}" y="34" text-anchor="end" font-family="system-ui,sans-serif" font-size="12" ` +
    `fill="#8a7d63">${worldW} × ${worldD} units` +
    ` · ${veins} ore veins</text>`);
  const ly = H - 20;
  const legend = [
    ['#efa227', 'circle', 'Rare ore'], ['#8a8378', 'circle', 'Common ore'],
    ['#c9a44a', 'rect', 'Chest'], ['#cecbf6', 'circle', 'Portal'],
    ['#e24b4a', 'ring', 'Elite'], ['#ffe9b0', 'ring', 'Arrival'],
  ];
  let lx = pad;
  for (const [col, shape, label] of legend) {
    if (shape === 'rect') add(`<rect x="${lx - 4}" y="${ly - 9}" width="9" height="9" rx="2" fill="${col}"/>`);
    else if (shape === 'ring') add(`<circle cx="${lx}" cy="${ly - 4}" r="5" fill="none" stroke="${col}" stroke-width="2"/>`);
    else add(`<circle cx="${lx}" cy="${ly - 4}" r="4" fill="${col}"/>`);
    add(`<text x="${lx + 12}" y="${ly}" font-family="system-ui,sans-serif" font-size="12" fill="#8a7d63">${label}</text>`);
    lx += 28 + label.length * 7.2;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

for (const zone of [darkwoods, darkwoods]) {
  const svg = draw(zone);
  const file = path.join(OUT, zone.id + '.svg');
  fs.writeFileSync(file, svg);
  console.log(`${zone.name.padEnd(18)} -> maps/${zone.id}.svg`);
}
