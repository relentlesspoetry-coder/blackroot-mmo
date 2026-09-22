// Headless: walk to the Wolf Den camp and fight archers/shamans at level 12.
import WebSocket from 'ws';
const PORT = process.env.P || 8099;
const ws = new WebSocket(`ws://localhost:${PORT}`);
const send = (o) => ws.send(JSON.stringify(o));
const out = { events: [], monsters: new Map(), sys: [] };
let id = null, me = null;
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'welcome') { id = m.id; start(); }
  if (m.t === 'snapshot') { for (const mo of m.monsters || []) out.monsters.set(mo.id, mo); const p = (m.players || []).find(x => x.id === id); if (p) me = p; }
  if (m.t === 'event') out.events.push(m);
  if (m.t === 'chat') out.sys.push(`${m.from}: ${m.msg}`);
});
ws.on('open', () => send({ t: 'join', name: 'Brawler', cls: 'fighter', look: {} }));
// Wolf Den camp is at zone (62,28); the zone is scaled x1.7 at load.
const CAMP = { x: 62 * 1.7, z: 28 * 1.7 };
function start() {
  send({ t: 'setlevel', key: 'letmebuild', level: 12 });
  setTimeout(() => send({ t: 'give', key: 'letmebuild', item: 'Greataxe', qty: 1 }), 300);
  setTimeout(() => {
    const sh = [...out.monsters.values()].find(m => m.type === 'goblin_shaman' && m.alive);
    const ar = [...out.monsters.values()].find(m => m.type === 'goblin_archer' && m.alive);
    const t = sh || ar;
    console.log('target camp at', t && `${t.type} (${t.x},${t.z})`);
    if (t) { CAMP.x = t.x; CAMP.z = t.z; send({ t: 'tp', key: 'letmebuild', x: t.x - 4, z: t.z - 4 }); }
  }, 1500);
  const tick = setInterval(() => {
    if (!me) return;
    const near = [...out.monsters.values()].filter(m => m.alive && Math.hypot(m.x - me.x, m.z - me.z) < 16 && !['cow','chicken'].includes(m.type));
    if (near.length && me.hp > 20) {
      const shaman = near.find(m => m.arch === 'caster') || near.find(m => m.arch === 'archer') || near[0];
      send({ t: 'attack', target: shaman.id });
      if (Math.random() < 0.5) send({ t: 'ability', id: 'heavy_swing' });
      if (Math.random() < 0.3) send({ t: 'ability', id: 'groundbreaker' });
      if (Math.random() < 0.3) send({ t: 'ability', id: 'battle_rush' });
    } else if (!near.length) send({ t: 'tp', key: 'letmebuild', x: CAMP.x - 6, z: CAMP.z - 6 });
  }, 1200);
  setTimeout(() => {
    clearInterval(tick);
    const k = {};
    for (const e of out.events) k[e.kind] = (k[e.kind] || 0) + 1;
    const res = {};
    for (const e of out.events) if (e.kind === 'hit') res[e.res] = (res[e.res] || 0) + 1;
    console.log('event kinds:', JSON.stringify(k));
    console.log('outcomes:', JSON.stringify(res));
    console.log('mob casts:', out.events.filter(e => e.kind === 'mobcast').slice(0, 6).map(e => e.cancel ? `CANCEL${e.interrupted ? '(interrupted ' + e.name + ')' : ''}` : `${e.name} ${e.dur}s${e.interruptible ? ' [int]' : ''}`).join(' | '));
    console.log('mob heals:', out.events.filter(e => e.kind === 'mobheal').length, 'enrages:', out.events.filter(e => e.kind === 'enrage').length, 'aggro swaps:', out.events.filter(e => e.kind === 'aggro').length);
    console.log('procs:', out.events.filter(e => e.kind === 'proc').map(e => e.name).slice(0, 3).join(','), 'queued:', out.events.filter(e => e.kind === 'queued' && e.id).length);
    console.log('me:', me && `lv${me.level} hp${me.hp}/${me.maxHp} inCombat=${me.inCombat} swing=${JSON.stringify(me.swing)}`);
    console.log('sys:', out.sys.slice(-5).join(' | '));
    process.exit(0);
  }, 30000);
}
