import { describe, expect, it } from 'vitest';
import { deriveRoom, seal, unseal } from './net';
import { Store, type Row } from './store';

describe('Store', () => {
  it('converges regardless of delivery order', () => {
    const rows: Row[] = [
      ['b:0,0,0', { i: 'grass' }, 10, 'aa'],
      ['b:0,0,0', { i: 'stone' }, 12, 'bb'],
      ['b:0,0,0', null, 11, 'cc'],
      ['m:1', { x: 1 }, 5, 'aa'],
      ['m:1', { x: 2 }, 5, 'bb'], // same time: higher author id wins
    ];
    const a = new Store('a'), b = new Store('b');
    rows.forEach((r) => a.merge(r));
    [...rows].reverse().forEach((r) => b.merge(r));
    expect(a.dump().sort()).toEqual(b.dump().sort());
    expect(a.get('b:0,0,0')).toEqual({ i: 'stone' });
    expect(a.get('m:1')).toEqual({ x: 2 });
  });

  it('keeps deletions as tombstones that beat older writes', () => {
    const s = new Store('a');
    s.merge(['k', 1, 10, 'x']);
    s.merge(['k', null, 20, 'x']);
    expect(s.merge(['k', 2, 15, 'y'])).toBe(false);
    expect(s.get('k')).toBeNull();
    expect([...s.keys('k')]).toEqual([]);
  });

  it('local writes always win over what was seen before', () => {
    const s = new Store('a');
    const out: Row[] = [];
    s.onLocal = (r) => out.push(r);
    s.merge(['k', 1, Date.now() + 60_000, 'z']); // a peer with a fast clock
    s.set('k', 2);
    expect(s.get('k')).toBe(2);
    expect(out).toHaveLength(1);
  });
});

describe('room crypto', () => {
  it('round-trips small and large payloads, and rejects other rooms', async () => {
    const a = await deriveRoom('Secret-Code-1');
    const same = await deriveRoom('  secret-code-1 ');
    const other = await deriveRoom('secret-code-2');
    expect(same.tag).toBe(a.tag);
    expect(other.tag).not.toBe(a.tag);
    const big = Array.from({ length: 2000 }, (_, i) => [`b:${i},0,0`, { i: 'grass' }, i, 'aa']);
    for (const data of [{ y: 'chat', m: 'hi 🐇' }, big]) {
      const sealed = await seal(a.key, data);
      expect(await unseal(same.key, sealed)).toEqual(data);
      await expect(unseal(other.key, sealed)).rejects.toThrow();
    }
  });
});
