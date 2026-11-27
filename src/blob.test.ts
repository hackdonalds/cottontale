import { describe, expect, it } from 'vitest';
import { generateSecretKey, verifyEvent } from 'nostr-tools/pure';
import {
  Assembler, BlobCache, Blobs, CHUNK, MAX_BLOB, OVERHEAD, RELAY_CHUNK, b64, cleanMime, cleanServers, deriveBlobKey, evictions, matches,
  openBlob, parseRef, pickIce, pickServers, sealBlob, sha256hex, slices, unb64, uploadAuth, type Bin, type BlobRef, type Signal,
} from './blob';
import type { Msg } from './net';

const te = new TextEncoder();
/** Repeatable noise. */
function noise(n: number, seed = 1): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0, x = seed; i < n; i++) out[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 16;
  return out;
}
const H = (c: string) => c.repeat(64);

describe('blob references', () => {
  it('hashes like everyone else', async () => {
    expect(await sha256hex(te.encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('accepts a proper reference and drops what does not belong', () => {
    const ok = { h: H('a'), n: 1000, m: 'image/png' };
    expect(parseRef(ok)).toEqual(ok);
    expect(parseRef({ ...ok, s: ['https://files.example/', 'https://files.example', 'ftp://x', 'http://evil.example', 7], extra: 1 }))
      .toEqual({ ...ok, s: ['https://files.example'] });
  });

  it('refuses anything odd: these come from other devices', () => {
    const ok = { h: H('a'), n: 1000, m: 'image/png' };
    for (const bad of [
      null, 'x', 7, [], [ok],
      { ...ok, h: H('A') }, { ...ok, h: H('a').slice(1) }, { ...ok, h: `${H('a').slice(2)}/x` }, { ...ok, h: 5 },
      { ...ok, n: '1000' }, { ...ok, n: 10.5 }, { ...ok, n: OVERHEAD }, { ...ok, n: -1 }, { ...ok, n: NaN }, { ...ok, n: MAX_BLOB + OVERHEAD + 1 },
      { ...ok, m: 'png' }, { ...ok, m: 'Image/PNG' }, { ...ok, m: 'image/png; charset=x' }, { ...ok, m: 'text/html\n<script>' }, { ...ok, m: undefined },
      { ...ok, s: 'https://files.example' },
    ]) expect(parseRef(bad), JSON.stringify(bad)).toBeNull();
    expect(parseRef({ ...ok, n: MAX_BLOB + OVERHEAD })).not.toBeNull();
    expect(parseRef({ ...ok, n: 5000 }, 1000)).toBeNull(); // a table can set its own limit
  });

  it('tidies mime types and server lists', () => {
    expect(cleanMime('Image/PNG; q=1')).toBe('image/png');
    expect(cleanMime('model/gltf-binary')).toBe('model/gltf-binary');
    expect(cleanMime('nonsense')).toBe('');
    expect(cleanServers(['https://a.example/x/', 'http://localhost:3334', 'http://192.168.1.5:3334', 'https://u:p@a.example', 'https://a.example?x=1', 'javascript:alert(1)']))
      .toEqual(['https://a.example/x', 'http://localhost:3334', 'http://192.168.1.5:3334']);
    expect(cleanServers('https://a.example')).toEqual([]);
  });

  it('a device list beats the table setting, which beats the defaults; empty lists count', () => {
    const def = ['https://d.example'];
    expect(pickServers(null, null, def)).toEqual(def);
    expect(pickServers(null, ['https://t.example'], def)).toEqual(['https://t.example']);
    expect(pickServers(null, [], def)).toEqual([]);
    expect(pickServers('["https://mine.example"]', ['https://t.example'], def)).toEqual(['https://mine.example']);
    expect(pickServers('[]', ['https://t.example'], def)).toEqual([]);
    expect(pickServers('not json', ['https://t.example'], def)).toEqual(['https://t.example']);
    expect(pickIce(null)).toEqual(['stun:stun.l.google.com:19302']);
    expect(pickIce('[]')).toEqual([]);
    expect(pickIce('["stun:stun.example:3478", "https://x", 4]')).toEqual(['stun:stun.example:3478']);
  });
});

describe('blob encryption', () => {
  it('round-trips, and names the blob by its ciphertext', async () => {
    const key = await deriveBlobKey('table-code-1');
    const file = noise(5000);
    const cipher = await sealBlob(key, file, 'image/png');
    expect(cipher.length).toBe(file.length + OVERHEAD);
    expect(b64(cipher)).not.toContain(b64(file).slice(0, 40));
    expect(await openBlob(key, cipher, 'image/png')).toEqual(file);
    const ref: BlobRef = { h: await sha256hex(cipher), n: cipher.length, m: 'image/png' };
    expect(await matches(ref, cipher)).toBe(true);
    expect(await matches({ ...ref, n: ref.n + 1 }, cipher)).toBe(false);
  });

  it('gives the same blob for the same file at the same table, and a different one otherwise', async () => {
    const key = await deriveBlobKey('Table-Code-1 ');
    const same = await deriveBlobKey('table-code-1');
    const other = await deriveBlobKey('table-code-2');
    const file = noise(300);
    const a = await sha256hex(await sealBlob(key, file, 'image/png'));
    expect(await sha256hex(await sealBlob(same, file, 'image/png'))).toBe(a);
    expect(await sha256hex(await sealBlob(other, file, 'image/png'))).not.toBe(a);
    expect(await sha256hex(await sealBlob(key, file, 'image/webp'))).not.toBe(a);
    expect(await sha256hex(await sealBlob(key, noise(300, 2), 'image/png'))).not.toBe(a);
  });

  it('notices tampering, the wrong table and a wrong type', async () => {
    const key = await deriveBlobKey('table-code-1');
    const cipher = await sealBlob(key, noise(2000), 'image/png');
    const ref: BlobRef = { h: await sha256hex(cipher), n: cipher.length, m: 'image/png' };
    for (const at of [0, 12, 500, cipher.length - 1]) {
      const bad = cipher.slice();
      bad[at] ^= 1;
      expect(await matches(ref, bad)).toBe(false);
      await expect(openBlob(key, bad, 'image/png')).rejects.toThrow();
    }
    await expect(openBlob(await deriveBlobKey('table-code-2'), cipher, 'image/png')).rejects.toThrow();
    await expect(openBlob(key, cipher, 'text/html')).rejects.toThrow();
    await expect(openBlob(key, cipher.subarray(0, 20), 'image/png')).rejects.toThrow();
  });

  it('signs uploads the way Blossom servers expect', () => {
    const auth = uploadAuth(generateSecretKey(), H('b'), 1_700_000_000_000);
    expect(auth.startsWith('Nostr ')).toBe(true);
    const ev = JSON.parse(new TextDecoder().decode(unb64(auth.slice(6))));
    expect(verifyEvent(ev)).toBe(true);
    expect(ev.kind).toBe(24242);
    expect(ev.tags).toEqual([['t', 'upload'], ['x', H('b')], ['expiration', '1700000600']]);
  });
});

describe('blob pieces', () => {
  it('cuts and reassembles, in any order, with repeats', () => {
    const data = noise(CHUNK * 3 + 77);
    const parts = [...slices(data)];
    expect(parts.map((p) => p.length)).toEqual([CHUNK, CHUNK, CHUNK, 77]);
    const asm = new Assembler(data.length);
    for (const i of [2, 0, 2, 3]) expect(asm.add(i, parts[i])).toBe(true);
    expect(asm.done).toBe(false);
    expect(asm.loaded).toBe(CHUNK * 2 + 77);
    expect(asm.add(1, parts[1])).toBe(true);
    expect(asm.done).toBe(true);
    expect(asm.bytes()).toEqual(data);
  });

  it('refuses pieces that cannot belong', () => {
    const asm = new Assembler(RELAY_CHUNK * 2 + 5, RELAY_CHUNK);
    expect(asm.count).toBe(3);
    expect(asm.add(3, new Uint8Array(5))).toBe(false);
    expect(asm.add(-1, new Uint8Array(RELAY_CHUNK))).toBe(false);
    expect(asm.add(0.5, new Uint8Array(RELAY_CHUNK))).toBe(false);
    expect(asm.add('0' as unknown as number, new Uint8Array(RELAY_CHUNK))).toBe(false);
    expect(asm.add(0, new Uint8Array(RELAY_CHUNK - 1))).toBe(false);
    expect(asm.add(2, new Uint8Array(RELAY_CHUNK))).toBe(false); // the last piece is the short one
    expect(asm.add(2, new Uint8Array(5))).toBe(true);
    expect(asm.loaded).toBe(5);
    const exact = new Assembler(CHUNK * 2);
    expect(exact.count).toBe(2);
    expect(exact.add(1, new Uint8Array(CHUNK))).toBe(true);
  });

  it('base64 survives large pieces', () => {
    const data = noise(100_000);
    expect(unb64(b64(data))).toEqual(data);
  });
});

/** A stand-in for the browser's Cache API. */
function fakeBin(): Bin & { map: Map<string, Uint8Array>; fail?: boolean } {
  const map = new Map<string, Uint8Array>();
  const bin: Bin & { map: Map<string, Uint8Array>; fail?: boolean } = {
    map,
    match: async (url) => (map.has(url) ? new Response(map.get(url) as Uint8Array<ArrayBuffer>, { headers: { 'content-length': String(map.get(url)!.length) } }) : undefined),
    put: async (url, res) => { if (bin.fail) throw new Error('quota'); map.set(url, new Uint8Array(await res.arrayBuffer())); },
    delete: async (url) => map.delete(url),
    keys: async () => [...map.keys()].map((k) => ({ url: `http://localhost${k}` })),
  };
  return bin;
}

describe('blob cache', () => {
  it('drops the least recently used first, and blobs only we have last', () => {
    const index = [{ h: 'a', n: 40, t: 1 }, { h: 'b', n: 40, t: 2, k: 1 as const }, { h: 'c', n: 40, t: 3 }, { h: 'd', n: 40, t: 4 }];
    expect(evictions(index, 200)).toEqual([]);
    expect(evictions(index, 159)).toEqual(['a']);
    expect(evictions(index, 80)).toEqual(['a', 'c']);
    expect(evictions(index, 79)).toEqual(['a', 'c', 'd']);
    expect(evictions(index, 79, 'c')).toEqual(['a', 'd', 'b']); // what was just written stays
    expect(evictions(index, 0)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('keeps blobs on disk under the cap, by last use', async () => {
    const bin = fakeBin();
    const cache = new BlobCache(250, async () => bin);
    await cache.put(H('1'), noise(100, 1));
    await cache.put(H('2'), noise(100, 2));
    expect(await cache.get(H('1'))).toEqual(noise(100, 1)); // now 2 is the stalest
    await cache.put(H('3'), noise(100, 3));
    expect(await cache.has(H('2'))).toBe(false);
    expect(await cache.get(H('2'))).toBeNull();
    expect(bin.map.has(`/blob/${H('2')}`)).toBe(false);
    expect(cache.size).toBe(200);
    // A pinned blob outlives newer ones.
    await cache.pin(H('1'), true);
    await cache.put(H('4'), noise(100, 4));
    expect(cache.list().map((e) => e.h).sort()).toEqual([H('1'), H('4')]);
    // The index survives a restart, and blobs written behind its back are found.
    await cache.flush();
    bin.map.set(`/blob/${H('9')}`, noise(30, 9));
    const again = new BlobCache(250, async () => bin);
    expect(await again.get(H('4'))).toEqual(noise(100, 4));
    expect(again.list().find((e) => e.h === H('1'))?.k).toBe(1);
    expect(await again.get(H('9'))).toEqual(noise(30, 9));
    // Something the browser threw away is simply gone.
    bin.map.delete(`/blob/${H('4')}`);
    expect(await again.get(H('4'))).toBeNull();
    expect(await again.has(H('4'))).toBe(false);
  });

  it('falls back to memory when storage is unavailable or full', async () => {
    const none = new BlobCache(1000, async () => { throw new Error('private mode'); }, 150);
    await none.put(H('1'), noise(100, 1));
    expect(await none.get(H('1'))).toEqual(noise(100, 1));
    await none.put(H('2'), noise(100, 2)); // the memory budget is smaller
    expect(await none.has(H('1'))).toBe(false);
    expect(await none.get(H('2'))).toEqual(noise(100, 2));

    const bin = fakeBin();
    const full = new BlobCache(1000, async () => bin);
    bin.fail = true;
    await full.put(H('3'), noise(50, 3));
    expect(await full.get(H('3'))).toEqual(noise(50, 3));
    await full.drop(H('3'));
    expect(await full.get(H('3'))).toBeNull();
  });
});

/** A table channel in a box: what one player sends, the others hear a moment later. */
function table() {
  const seats: Signal[] = [];
  const log: Msg[] = [];
  const sit = (pk: string): Signal => {
    const me: Signal = {
      pk, taps: [], peers: { get size() { return seats.length - 1; } },
      send: async (msg) => {
        log.push(msg);
        const wire = JSON.parse(JSON.stringify(msg)) as Msg;
        for (const s of seats) if (s !== me) setTimeout(() => s.taps.forEach((tap) => tap(wire, pk)), 1);
      },
    };
    seats.push(me);
    return me;
  };
  return { sit, log };
}

describe('blobs between players', () => {
  const player = async (net: Signal | undefined, code = 'table-code-1') =>
    new Blobs({ key: deriveBlobKey(code), sk: generateSecretKey(), net, servers: () => [], cache: new BlobCache(1e6, async () => { throw new Error('none'); }) });

  it('a small blob crosses the relay in pieces when there is no WebRTC (as in node)', async () => {
    const t = table();
    const [gm, bo, cy] = [await player(t.sit('gm')), await player(t.sit('bo')), await player(t.sit('cy'))];
    const file = noise(30_000);
    const ref = await gm.put(file, 'image/webp');
    expect(ref).toEqual({ h: ref.h, n: 30_000 + OVERHEAD, m: 'image/webp' });
    expect(gm.outcomes(ref.h)).toEqual([]);
    const seen: number[] = [];
    bo.onProgress((h, loaded) => { if (h === ref.h) seen.push(loaded); });
    const [one, two] = await Promise.all([bo.get(ref), bo.get(ref)]);
    expect(one).toEqual(file);
    expect(two).toEqual(file);
    expect(bo.source(ref.h)).toBe('relay');
    expect(seen.at(-1)).toBe(ref.n);
    expect(t.log.filter((m) => m.y === 'bq')).toHaveLength(1); // two gets, one fetch
    expect(t.log.filter((m) => m.y === 'bc')).toHaveLength(Math.ceil(ref.n / RELAY_CHUNK));
    expect(await bo.get(ref)).toEqual(file);
    expect(bo.source(ref.h)).toBe('cache');
    // Anyone who has it can pass it on: the GM leaves, Bo serves Cy.
    gm.close();
    expect(await cy.get(JSON.parse(JSON.stringify(ref)))).toEqual(file);
  });

  it('refuses wrong bytes, wrong references and oversized files', async () => {
    const t = table();
    const [gm, bo] = [await player(t.sit('gm')), await player(t.sit('bo'))];
    const ref = await gm.put(noise(2000), 'audio/ogg');
    // A cache that was tampered with is not believed (and nobody else has this "blob").
    const forged = { ...ref, h: H('c') };
    await gm.cache.put(H('c'), noise(ref.n, 5));
    await expect(bo.get(forged)).rejects.toThrow('not available');
    await expect(bo.get({ ...ref, m: 'audio/mpeg' })).rejects.toThrow();
    await expect(bo.get({ h: 'nope', n: 100, m: 'image/png' })).rejects.toThrow('bad blob reference');
    await expect(gm.put(new Uint8Array(0), 'image/png')).rejects.toThrow('empty');
    await expect(gm.put(noise(10), 'what')).rejects.toThrow('mime');
    const small = new Blobs({ key: deriveBlobKey('x'), sk: generateSecretKey(), servers: () => [], maxSize: 100, cache: gm.cache });
    await expect(small.put(noise(101), 'image/png')).rejects.toThrow('too large');
    await expect(small.get(ref)).rejects.toThrow('bad blob reference'); // over this table's limit
  });

  it('alone at the table, a missing blob fails at once', async () => {
    const t = table();
    const solo = await player(t.sit('solo'));
    await expect(solo.get({ h: H('d'), n: 500, m: 'image/png' })).rejects.toThrow('not available');
    expect(t.log).toHaveLength(0);
  });
});
