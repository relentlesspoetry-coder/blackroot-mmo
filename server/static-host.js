import { open } from 'node:fs/promises';
import path from 'node:path';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav' };

export function validators(stat) {
  // High-resolution change time also catches same-size rewrites whose mtime is
  // restored by deployment tools. No asset bytes or unbounded cache are needed.
  return {
    ETag: `W/"${[stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(n => n.toString(16)).join('-')}"`,
    'Last-Modified': new Date(Number(stat.mtimeNs / 1000000n)).toUTCString(),
    'Cache-Control': 'no-cache',
  };
}

export function notModified(method, headers, current, stat) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (headers['if-none-match'] !== undefined) {
    const value = headers['if-none-match'];
    if (value.trim() === '*') return true;
    // Entity tags may contain commas, so split by the quoted-tag grammar, not
    // by commas. GET/HEAD use weak comparison, including strong client tags.
    const tags = value.match(/(?:W\/)?"[^"\x00-\x20\x7f]*"/g) || [];
    return tags.some(tag => tag.replace(/^W\//, '') === current.ETag.replace(/^W\//, ''));
  }
  const since = Date.parse(headers['if-modified-since']);
  // HTTP dates lose subsecond precision. Only trust a date-only validator when
  // both modification and change time prove the representation predates it;
  // otherwise send 200 rather than hiding rapid or preserved-mtime hotfixes.
  return Number.isFinite(since) && !!stat
    && stat.mtimeNs <= BigInt(since) * 1000000n
    && stat.ctimeNs <= BigInt(since) * 1000000n;
}

export function createStaticHandler(clientDir, sharedDir, openFile = open) {
  return async (req, res) => {
    const fail = (status, text) => { res.writeHead(status); res.end(req.method === 'HEAD' ? undefined : text); };
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
    catch { fail(400, 'Bad request'); return; }
    if (urlPath === '/') urlPath = '/index.html';
    const clean = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const root = clean.startsWith('/shared/') || clean.startsWith('\\shared\\') ? sharedDir : clientDir;
    const filePath = root === sharedDir
      ? path.join(sharedDir, clean.slice('/shared'.length))
      : path.join(clientDir, clean);
    const relative = path.relative(root, filePath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      fail(403, 'Forbidden'); return;
    }
    let file;
    try {
      file = await openFile(filePath, 'r');
      // Stat and read the same opened file, even if a deployment replaces its
      // pathname between requests. Directories and missing assets stay 404.
      const stat = await file.stat({ bigint: true });
      if (!stat.isFile()) { fail(404, 'Not found'); return; }
      const headers = validators(stat);
      if (notModified(req.method, req.headers, headers, stat)) {
        res.writeHead(304, headers); res.end(); return;
      }
      headers['Content-Type'] = MIME[path.extname(filePath)] || 'application/octet-stream';
      if (req.method === 'HEAD') {
        headers['Content-Length'] = stat.size.toString();
        res.writeHead(200, headers); res.end(); return;
      }
      const data = await file.readFile();
      headers['Content-Length'] = data.length;
      res.writeHead(200, headers); res.end(data);
    } catch {
      if (!res.headersSent) fail(404, 'Not found');
      else res.destroy();
    } finally {
      if (file) await file.close().catch(() => {});
    }
  };
}
