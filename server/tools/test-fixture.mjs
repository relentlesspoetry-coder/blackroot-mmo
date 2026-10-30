// Disposable, authenticated local E2E fixture. Never connects to a user's server.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import WebSocket from 'ws';
import { xpTotalForLevel } from '../balance.js';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitFor(label, predicate, timeout = 10000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = predicate(); if (value) return value; await sleep(100); }
  throw new Error(`Timed out after ${timeout}ms: ${label}`);
}
export async function fixture({ prefix = 'Test', save, timeout = 420000 } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'blackroot-e2e-'));
  const name = prefix.slice(0, 6) + randomBytes(4).toString('hex');
  const pass = randomBytes(24).toString('hex');
  const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  let child, ws, monitor, log = '', closed = false;
  const cleanup = async () => {
    if (closed) return; closed = true; clearTimeout(watchdog); clearInterval(monitor);
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    if (ws) ws.terminate();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
      await once(child, 'exit').catch(() => {}); clearTimeout(kill);
    }
    await rm(dir, { recursive: true, force: true });
  };
  const interrupt = () => { cleanup().finally(() => process.exit(130)); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const watchdog = setTimeout(() => { console.error(`E2E deadline exceeded (${timeout}ms)\n${log.slice(-4000)}`); cleanup().finally(() => process.exit(1)); }, timeout);
  try {
    if (save) {
      await mkdir(path.join(dir, 'saves'), { recursive: true });
      await writeFile(path.join(dir, 'saves', name.toLowerCase() + '.json'), JSON.stringify({ v: 1, name, cls: 'fighter', zoneId: 'blackroot', level: 1, xp: xpTotalForLevel(save.level || 1), gold: 0, hp: 999, known: [], equipment: {}, x: -1.9, z: 19.9, ...save }));
    }
    child = spawn(process.execPath, ['server.js'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, PORT: String(port), BLACKROOT_DATA_DIR: dir, DATA_DIR: dir, EDITOR_ENABLED: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { log = (log + b).slice(-16000); });
    child.stderr.on('data', b => { log = (log + b).slice(-16000); });
    await waitFor('isolated server startup', () => {
      if (child.exitCode !== null) throw new Error(`Server exited ${child.exitCode}: ${log}`);
      return /listening|localhost:/i.test(log);
    }, 30000);
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const timeline = [];
    const state = { snapshotCount: 0, connectedAt: Date.now(), id: null, me: null, snapshot: null, zone: null, bag: null, quests: null, skills: null, events: [] };
    let failure;
    ws.on('error', e => { failure = e; });
    ws.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome' || m.t === 'transition') ws.send(JSON.stringify({ t: 'scene:ready', ...m.scene }));
      if (m.t === 'loginfail') failure = new Error(`Login rejected: ${m.text}`);
      if (m.t === 'welcome') { state.id = m.id; state.zone = m.zone; }
      if (m.t === 'transition') state.zone = m.zone;
      if (m.t === 'snapshot') { state.snapshotCount++; state.lastSnapshotAt = Date.now(); state.snapshot = m; state.me = m.players.find(p => p.id === state.id); }
      if (['bag', 'quests', 'skills', 'abilities'].includes(m.t)) state[m.t] = m;
      if (m.t === 'abilities') state.abilitiesAt = Date.now();
      if (m.t === 'event') state.events.push(m);
    });
    await once(ws, 'open');
    const send = value => ws.send(JSON.stringify(value));
    send({ t: 'join', name, pass, cls: 'fighter' });
    const wait = async (label, predicate, ms) => {
      try { return await waitFor(label, () => { if (failure) throw failure; return predicate(); }, ms); }
      catch (e) { throw new Error(`${e.message}; player=${JSON.stringify(state.me)}; events=${JSON.stringify(state.events.slice(-8))}`); }
    };
    await wait('authenticated welcome, player, bag, quests and skills', () => state.id && state.me && state.bag && state.quests && state.skills, 15000);
    monitor = setInterval(() => { timeline.push({ elapsed: +((Date.now()-state.connectedAt)/1000).toFixed(1), snapshots: state.snapshotCount, x: state.me?.x, z: state.me?.z, targetHp: state.snapshot?.monsters.find(m=>m.id===state.me?.tgt)?.hp }); if (timeline.length > 24) timeline.shift(); }, 5000);
    const telemetry = () => ({ timeline, elapsedSeconds: +((Date.now()-state.connectedAt)/1000).toFixed(1), snapshots: state.snapshotCount, snapshotHz: +(state.snapshotCount/((Date.now()-state.connectedAt)/1000)).toFixed(2), lastSnapshotAgeMs: Date.now()-state.lastSnapshotAt, position: {x:state.me?.x,z:state.me?.z}, target:state.snapshot?.monsters.find(m=>m.id===state.me?.tgt) });
    return { state, send, wait, cleanup, dir, port, name, pass, telemetry, log: () => log };
  } catch (e) { await cleanup(); throw e; }
}
export async function runTest(fn, options) {
  const f = await fixture(options);
  try { await fn(f); console.log('ALL CHECKS PASSED'); }
  catch (e) { console.error('E2E telemetry:', JSON.stringify(f.telemetry())); throw e; }
  finally { await f.cleanup(); }
}
export async function walk(f, x, z, tolerance = 3, ms = 45000) {
  f.send({ t: 'move', x, z });
  await f.wait(`walk to (${x}, ${z})`, () => Math.hypot(f.state.me.x - x, f.state.me.z - z) <= tolerance, ms);
}
