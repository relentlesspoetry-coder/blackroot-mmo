// Reject hostile coercions before any gameplay handler sees a value. Only JSON
// primitives of the opcode's declared type are accepted. The historical trade
// gold field alone also accepts a bounded decimal string from older clients.
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const number = v => typeof v === 'number' && Number.isFinite(v);
const string = v => typeof v === 'string' && v.length <= 256 && !['__proto__', 'prototype', 'constructor'].includes(v);
const schemas = {
  join: { name: string, pass: v => typeof v === 'string' && v.length <= 128, cls: string,
    look: v => plain(v) && Object.entries(v).every(([k, x]) => k === 'wear' ? plain(x) && Object.values(x).every(y => y === null || y === 0 || string(y)) : k === 'outfit' ? number(x) : string(x)) },
  input: { f: number, r: number, yaw: number }, move: { x: number, z: number }, attack: { target: number },
  target: { id: v => v === null || number(v) }, chat: { msg: string },
  'trade:gold': { gold: v => number(v) || (typeof v === 'string' && /^\d{1,12}$/.test(v)) }, 'trade:ok': { on: v => typeof v === 'boolean' },
  sell: { item: string, all: v => typeof v === 'boolean' }, equip: { item: string, slot: string },
};
for (const t of ['ability','learn','sit','useobject','openchest','fish','cook','questaccept','questturnin','unequip']) schemas[t] = { [t === 'unequip' ? 'slot' : 'id']: string };
for (const t of ['inspect','trade:request','duel:challenge','party:invite','party:kick','lootgrave','pickup','mine']) schemas[t] = { id: number };
for (const t of ['trade:add','trade:take','eat','drop']) schemas[t] = { item: string };
schemas.talk = { npc: string };
for (const t of ['stand','trade:accept','trade:decline','trade:cancel','duel:accept','duel:decline','duel:yield','party:accept','party:decline','party:leave','rest','questsync','respawn','logout']) schemas[t] = {};
const editor = { key: string, id: string, item: string, type: string, m: string, god: v => typeof v === 'boolean' };
for (const key of ['hp','qty','x','z','y','yaw','s','c','w','h','d','cx','cz','r','count','level','respawn']) editor[key] = number;
editor.tex = v => plain(v) && Object.keys(v).length <= 16 && Object.entries(v).every(([k, x]) => string(k) && (string(x) || number(x) || typeof x === 'boolean'));
editor.table = v => Array.isArray(v) && v.length <= 100 && v.every(e => plain(e) && string(e.item) && ['min','max','chance'].every(k => e[k] === undefined || number(e[k])));
for (const t of ['spawnboss','give','tp','setlevel','edit:list','edit:loot:set','edit:spawn:place','edit:spawn:update','edit:spawn:delete','edit:place','edit:update','edit:delete']) schemas[t] = editor;
export function validMessage(msg) {
  if (!plain(msg) || typeof msg.t !== 'string' || !Object.hasOwn(schemas, msg.t)) return false;
  const schema = schemas[msg.t];
  for (const [key, value] of Object.entries(msg)) if (key !== 't' && (!Object.hasOwn(schema, key) || !schema[key](value))) return false;
  const required = { 'edit:place': ['m', 'x', 'z'], 'edit:spawn:place': ['type', 'x', 'z'], 'edit:loot:set': ['type', 'table'] };
  if (Object.hasOwn(required, msg.t) && required[msg.t].some(k => !Object.hasOwn(msg, k))) return false;
  if (msg.t === 'join' && (typeof msg.name !== 'string' || typeof msg.pass !== 'string')) return false;
  return true;
}
