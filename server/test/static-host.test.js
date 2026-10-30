import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, open, rm, utimes, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaticHandler, validators, notModified } from '../static-host.js';

const current = { ETag: 'W/"abc"', 'Last-Modified': 'Fri, 30 Oct 2026 20:00:00 GMT' };
test('GET/HEAD weak validators, lists, wildcard and If-None-Match precedence', () => {
  for (const value of ['W/"abc"', '"abc"', '"a,b", W/"abc"', '*']) {
    for (const method of ['GET', 'HEAD']) assert.equal(notModified(method, { 'if-none-match': value }, current), true);
  }
  assert.equal(notModified('POST', { 'if-none-match': '*' }, current), false);
  assert.equal(notModified('GET', { 'if-none-match': '"old"', 'if-modified-since': current['Last-Modified'] }, current), false);
  assert.equal(notModified('GET', { 'if-none-match': '', 'if-modified-since': current['Last-Modified'] }, current), false);
  const exact = { mtimeNs: BigInt(Date.parse(current['Last-Modified'])) * 1000000n, ctimeNs: BigInt(Date.parse(current['Last-Modified'])) * 1000000n };
  assert.equal(notModified('GET', { 'if-modified-since': current['Last-Modified'] }, current, exact), true);
  for (const field of ['mtimeNs', 'ctimeNs']) assert.equal(notModified('GET', { 'if-modified-since': current['Last-Modified'] }, current, { ...exact, [field]: exact[field] + 1n }), false);
  assert.equal(notModified('GET', { 'if-modified-since': 'Thu, 29 Oct 2026 20:00:00 GMT' }, current), false);
  assert.equal(notModified('GET', { 'if-modified-since': 'nonsense' }, current), false);
  assert.equal(notModified('GET', {}, current), false);
});
test('high precision metadata catches same-size same-second updates and replacements', () => {
  const base = { dev: 1n, ino: 2n, size: 123n, mtimeNs: 1793390400000000000n, ctimeNs: 1793390400000000000n };
  for (const field of ['ino', 'size', 'mtimeNs', 'ctimeNs']) {
    assert.notEqual(validators(base).ETag, validators({ ...base, [field]: base[field] + 1n }).ETag);
  }
  assert.equal(validators(base)['Cache-Control'], 'no-cache');
});

test('live HTTP revalidates assets without body reads; preserves public roots and errors', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'blackroot-http-'));
  const client = path.join(dir, 'client'), shared = path.join(dir, 'shared');
  await mkdir(client); await mkdir(shared); await mkdir(path.join(dir, 'server'));
  const asset = path.join(client, 'model.glb');
  await writeFile(asset, Buffer.alloc(65536, 1));
  await writeFile(path.join(client, 'index.html'), '<html>test</html>');
  await writeFile(path.join(shared, 'math.js'), 'export const a = 1;');
  await writeFile(path.join(dir, 'server', 'accounts.json'), 'PRIVATE');
  let reads = 0, closes = 0;
  const server = http.createServer(createStaticHandler(client, shared, async (...args) => {
    const file = await open(...args);
    return { stat: (...a) => file.stat(...a), readFile: (...a) => { reads++; return file.readFile(...a); }, close: () => { closes++; return file.close(); } };
  }));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const request = (pathname, headers = {}, method = 'GET') => new Promise((resolve, reject) => {
    http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method, headers }, res => {
      const chunks = [];
      res.on('data', b => chunks.push(b));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject).end();
  });
  const first = await request('/model.glb');
  assert.equal(first.status, 200); assert.equal(first.body.length, 65536);
  assert.equal(first.headers['content-type'], 'model/gltf-binary');
  assert.equal(first.headers['cache-control'], 'no-cache');
  assert.ok(first.headers.etag.startsWith('W/')); assert.ok(first.headers['last-modified']);
  const readCount = reads;
  const cached = await request('/model.glb', { 'If-None-Match': first.headers.etag });
  assert.equal(cached.status, 304); assert.equal(cached.body.length, 0); assert.equal(reads, readCount);
  assert.equal(cached.headers.etag, first.headers.etag); assert.equal(cached.headers['cache-control'], 'no-cache');
  const head = await request('/model.glb', {}, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(head.headers['content-length'], '65536'); assert.equal(reads, readCount);
  assert.equal((await request('/model.glb', { 'If-None-Match': '*' }, 'HEAD')).status, 304);
  assert.equal((await request('/model.glb', { 'If-Modified-Since': first.headers['last-modified'] })).status, 200); // conservative date-only fallback
  const precedence = await request('/model.glb', { 'If-None-Match': '"old"', 'If-Modified-Since': first.headers['last-modified'] });
  assert.equal(precedence.status, 200);
  const oldStat = await stat(asset);
  await writeFile(asset, Buffer.alloc(65536, 3));
  await utimes(asset, oldStat.atime, oldStat.mtime);
  const preserved = await request('/model.glb', { 'If-None-Match': first.headers.etag });
  assert.equal(preserved.status, 200); assert.equal(preserved.body[0], 3);
  assert.equal((await request('/model.glb', { 'If-Modified-Since': first.headers['last-modified'] })).status, 200);
  await writeFile(asset, Buffer.alloc(65536, 2));
  await utimes(asset, oldStat.atime, new Date(oldStat.mtimeMs + 2000));
  const changed = await request('/model.glb', { 'If-None-Match': first.headers.etag });
  assert.equal(changed.status, 200); assert.equal(changed.body[0], 2); assert.notEqual(changed.headers.etag, first.headers.etag);
  assert.equal((await request('/model.glb', { 'If-Modified-Since': first.headers['last-modified'] })).status, 200);
  for (const pathname of ['/server/accounts.json', '/../server/accounts.json', '/%2e%2e/server/accounts.json', '/shared/../../server/accounts.json', '/missing']) {
    const response = await request(pathname); assert.equal(response.status, 404); assert.equal(response.body.toString(), 'Not found');
  }
  assert.equal((await request('/%zz')).status, 400);
  assert.equal((await request('/shared/')).status, 404);
  const home = await request('/'); assert.equal(home.status, 200); assert.equal(home.headers['content-type'], 'text/html');
  const module = await request('/shared/math.js?v=1'); assert.equal(module.status, 200); assert.equal(module.headers['content-type'], 'text/javascript');
  assert.equal((await request('/missing', {}, 'HEAD')).body.length, 0);
  assert.ok(closes >= reads);
  t.diagnostic(`Unchanged GLB body bytes: 200=${first.body.length}, 304=${cached.body.length}; no body read for 304 or HEAD.`);
});
