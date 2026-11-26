// Tiny in-memory Nostr relay for local development, tests, or LAN play.
// Not for production: it does not verify signatures or persist anything.
//   npm run relay            → ws://localhost:7777
import { WebSocketServer } from 'ws';

const port = Number(process.env.PORT ?? 7777);
const stored = new Map(); // addressable events by kind:pubkey:d
const subs = new Map(); // socket → Map(subId → filters)

const tagVal = (ev, name) => ev.tags.find((t) => t[0] === name)?.[1] ?? '';
function matches(ev, f) {
  if (f.kinds && !f.kinds.includes(ev.kind)) return false;
  if (f.authors && !f.authors.includes(ev.pubkey)) return false;
  if (f.since && ev.created_at < f.since) return false;
  for (const [k, vals] of Object.entries(f)) {
    if (k[0] === '#' && !ev.tags.some((t) => t[0] === k.slice(1) && vals.includes(t[1]))) return false;
  }
  return true;
}

const wss = new WebSocketServer({ port });
wss.on('connection', (ws) => {
  subs.set(ws, new Map());
  ws.on('close', () => subs.delete(ws));
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const [type, a, ...rest] = msg;
    if (type === 'EVENT') {
      const ev = a;
      if (ev.kind >= 30000 && ev.kind < 40000) {
        const key = `${ev.kind}:${ev.pubkey}:${tagVal(ev, 'd')}`;
        const old = stored.get(key);
        if (!old || old.created_at <= ev.created_at) stored.set(key, ev);
      }
      ws.send(JSON.stringify(['OK', ev.id, true, '']));
      for (const [sock, m] of subs) {
        for (const [id, filters] of m) if (filters.some((f) => matches(ev, f))) sock.send(JSON.stringify(['EVENT', id, ev]));
      }
    } else if (type === 'REQ') {
      subs.get(ws)?.set(a, rest);
      for (const ev of stored.values()) if (rest.some((f) => matches(ev, f))) ws.send(JSON.stringify(['EVENT', a, ev]));
      ws.send(JSON.stringify(['EOSE', a]));
    } else if (type === 'CLOSE') {
      subs.get(ws)?.delete(a);
    }
  });
});
console.log(`relay listening on ws://localhost:${port}`);
