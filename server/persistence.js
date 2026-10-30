// A checkpoint is the ownership transaction: never recover individual accounts
// from different generations. Legacy files remain untouched after migration.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validMessage } from './protocol.js';

export function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    // Preserve the previous complete generation, without truncating it.
    if (fs.existsSync(file)) {
      const backup = `${tmp}.bak`;
      fs.copyFileSync(file, backup);
      const b = fs.openSync(backup, 'r'); try { fs.fsyncSync(b); } finally { fs.closeSync(b); }
      fs.renameSync(backup, `${file}.bak`);
    }
    fs.renameSync(tmp, file);
    const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}
export function readJson(file) {
  try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object'); return data; }
  catch (e) { if (e.code === 'ENOENT') return null; throw new Error(`Cannot read durable state ${file}: ${e.message}`); }
}
export function validateCharacter(d) {
  if (!d || d.v !== 1 || typeof d.name !== 'string' || !d.name || !Array.isArray(d.inventory) ||
      !d.inventory.every(n => typeof n === 'string') || !d.equipment || typeof d.equipment !== 'object' || Array.isArray(d.equipment) ||
      !Number.isFinite(d.gold) || d.gold < 0 || !Array.isArray(d.known)) throw new Error('Invalid character checkpoint');
  if (d.look !== undefined && !validMessage({t:'join',name:'validation',pass:'validation',look:d.look})) throw new Error('Invalid saved appearance');
  if (!Object.values(d.equipment).every(v => v === null || typeof v === 'string') || !d.known.every(v => typeof v === 'string')) throw new Error('Invalid equipment or abilities');
  for (const key of ['x', 'z', 'y', 'yaw', 'level', 'xp', 'hp', 'mana', 'miningXp', 'fishingXp', 'cookingXp']) if (d[key] !== undefined && !Number.isFinite(d[key])) throw new Error(`Invalid saved ${key}`);
  for (const field of ['quests', 'questDone', 'questFlags', 'questAnnounced', 'openedChests', 'usedObjects', 'visited']) {
    if (d[field] !== undefined && (!Array.isArray(d[field]) || (field !== 'quests' && !d[field].every(v => typeof v === 'string')))) throw new Error(`Invalid saved ${field}`);
  }
  if (d.quests && !d.quests.every(e => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string')) throw new Error('Invalid saved quests');
  return d;
}
export class WorldStore {
  constructor(directory) {
    this.file = path.join(directory, 'world.checkpoint.json');
    let state = readJson(this.file);
    if (!state) {
      // A backup without a primary is not a new world. Require operator recovery.
      if (fs.existsSync(this.file + '.bak')) throw new Error('World checkpoint missing; restore a complete backup explicitly');
      state = { v: 1, characters: {}, graves: [], groundItems: [] };
      if (fs.existsSync(directory)) for (const file of fs.readdirSync(directory)) {
        if (!file.endsWith('.json') || file === 'world.checkpoint.json') continue;
        const d = validateCharacter(readJson(path.join(directory, file)));
        if (Object.hasOwn(state.characters, d.name)) throw new Error('Duplicate legacy character');
        Object.defineProperty(state.characters, d.name, { value: d, enumerable: true, writable: true, configurable: true });
      }
    }
    if (state.v !== 1 || !state.characters || typeof state.characters !== 'object' || Array.isArray(state.characters) ||
        !Array.isArray(state.graves) || !Array.isArray(state.groundItems)) throw new Error('Invalid world checkpoint');
    for (const [name, d] of Object.entries(state.characters)) if (validateCharacter(d).name !== name) throw new Error('Character key mismatch');
    for (const g of [...state.graves, ...state.groundItems]) if (!g || !Number.isSafeInteger(g.id) || !Number.isFinite(g.ttl) || g.ttl <= 0 || typeof g.zoneId !== 'string' || !Number.isFinite(g.x) || !Number.isFinite(g.z)) throw new Error('Invalid world inventory');
    for (const g of state.graves) if (typeof g.name !== 'string' || !Object.hasOwn(state.characters, g.name) || !Array.isArray(g.items) || !g.items.every(n => typeof n === 'string') || !g.equipment || typeof g.equipment !== 'object' || !Object.values(g.equipment).every(n => n === null || typeof n === 'string')) throw new Error('Invalid grave inventory');
    for (const g of state.groundItems) if (typeof g.name !== 'string' || !Number.isSafeInteger(g.qty) || g.qty < 1) throw new Error('Invalid ground inventory');
    this.state = state;
  }
  commit(state) { atomicWrite(this.file, state); this.state = state; }
}
