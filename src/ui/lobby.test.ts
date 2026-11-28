import { describe, expect, it } from 'vitest';
import { MIN_CODE, randomCode, readInvite, readRelays } from './lobby';

describe('the lobby', () => {
  it('makes table codes nobody will guess', () => {
    const a = randomCode(), b = randomCode();
    expect(a).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(a.length).toBeGreaterThanOrEqual(MIN_CODE);
    expect(a).not.toBe(b);
  });

  it('reads a pasted invite link or a bare code', () => {
    expect(readInvite('  abcd-efgh-jkmn ')).toEqual({ code: 'abcd-efgh-jkmn' });
    expect(readInvite('https://example.org/?ui=2#room=abcd-efgh-jkmn')).toEqual({ code: 'abcd-efgh-jkmn', relays: undefined });
    expect(readInvite('https://example.org/#room=my%20table&relays=wss://a.example,ws://b.example')).toEqual({ code: 'my table', relays: ['wss://a.example', 'ws://b.example'] });
    expect(readInvite('room=abcdef')).toEqual({ code: 'abcdef', relays: undefined });
    expect(readInvite('https://example.org/somewhere').code).toBe(''); // a link, but not an invite
  });

  it('keeps only what could be a relay', () => {
    expect(readRelays('wss://a.example\n  ws://b.example, http://no.example javascript:alert(1) wss://')).toEqual(['wss://a.example', 'ws://b.example']);
    expect(readRelays('')).toEqual([]);
  });
});
