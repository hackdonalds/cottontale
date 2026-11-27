// Tiny in-memory Blossom server (github.com/hzrd149/blossom) for local development and tests.
// Not for production: nothing is persisted and anyone may upload.
//   npm run blossom          → http://localhost:3334
// It speaks BUD-01 (GET/HEAD /<sha256>), BUD-02 (PUT /upload, with a signed kind 24242
// event in the Authorization header) and BUD-06 (HEAD /upload asks before sending).
// To act like a picky public server:
//   MAX_SIZE=200000                         refuse larger blobs (413)
//   REJECT_MIME=application/octet-stream    refuse these types, comma-separated (415)
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { verifyEvent } from 'nostr-tools/pure';

const port = Number(process.env.PORT ?? 3334);
const maxSize = Number(process.env.MAX_SIZE ?? 100 * 1024 * 1024);
const rejectMime = (process.env.REJECT_MIME ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const blobs = new Map(); // sha256 → { body, type, uploaded }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, *',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE',
  'Access-Control-Expose-Headers': 'X-Reason',
  'Access-Control-Max-Age': '86400',
};
const reply = (res, status, headers = {}, body) => { res.writeHead(status, { ...CORS, ...headers }); res.end(body); };
const refuse = (res, status, reason) => reply(res, status, { 'X-Reason': reason, 'Content-Type': 'text/plain' }, reason);

/** Why this upload is not allowed ([status, reason]), or null. `hash` is only certain once the body is in. */
function objection(req, { type, size, hash }) {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Nostr ')) return [401, 'Authorization header with a signed upload event required'];
  let ev;
  try { ev = JSON.parse(Buffer.from(auth.slice(6), 'base64').toString()); } catch { return [401, 'Unreadable authorization event']; }
  const tag = (name) => (Array.isArray(ev?.tags) ? ev.tags : []).filter((t) => t[0] === name).map((t) => t[1]);
  if (ev?.kind !== 24242 || !verifyEvent(ev)) return [401, 'Invalid authorization event'];
  if (!tag('t').includes('upload')) return [401, 'Authorization event is not for an upload'];
  if (!(Number(tag('expiration')[0]) > Date.now() / 1000)) return [401, 'Authorization event has expired'];
  if (hash && !tag('x').includes(hash)) return [401, 'Authorization event is for another blob'];
  if (size > maxSize) return [413, `File too large (limit ${maxSize} bytes)`];
  if (rejectMime.includes(type)) return [415, `File type not allowed: ${type}`];
  return null;
}

createServer((req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (req.method === 'OPTIONS') return reply(res, 204);

  if (path === '/upload' && req.method === 'HEAD') {
    const no = objection(req, { type: req.headers['x-content-type'] ?? '', size: Number(req.headers['x-content-length'] ?? 0), hash: req.headers['x-sha-256'] });
    return no ? reply(res, no[0], { 'X-Reason': no[1] }) : reply(res, 200);
  }
  if (path === '/upload' && req.method === 'PUT') {
    const parts = [];
    let size = 0;
    req.on('data', (d) => { if ((size += d.length) <= maxSize) parts.push(d); });
    req.on('end', () => {
      const body = Buffer.concat(parts);
      const type = (req.headers['content-type'] ?? 'application/octet-stream').split(';')[0];
      const sha256 = createHash('sha256').update(body).digest('hex');
      const no = objection(req, { type, size, hash: sha256 });
      if (no) return refuse(res, no[0], no[1]);
      if (!blobs.has(sha256)) blobs.set(sha256, { body, type, uploaded: Math.floor(Date.now() / 1000) });
      const b = blobs.get(sha256);
      reply(res, 200, { 'Content-Type': 'application/json' }, JSON.stringify({ url: `http://localhost:${port}/${sha256}`, sha256, size: b.body.length, type: b.type, uploaded: b.uploaded }));
    });
    return;
  }
  const hash = /^\/([0-9a-f]{64})(\.\w+)?$/.exec(path)?.[1];
  if (hash && (req.method === 'GET' || req.method === 'HEAD')) {
    const blob = blobs.get(hash);
    if (!blob) return refuse(res, 404, 'Blob not found');
    return reply(res, 200, { 'Content-Type': blob.type, 'Content-Length': blob.body.length }, req.method === 'GET' ? blob.body : undefined);
  }
  if (hash && req.method === 'DELETE') { blobs.delete(hash); return reply(res, 204); }
  refuse(res, 404, 'Not found');
}).listen(port, () => console.log(`blossom listening on http://localhost:${port}`));
