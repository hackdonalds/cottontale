import { describe, expect, it } from 'vitest';
import type { BlobRef, ServerOutcome } from './blob';
import type { Msg } from './net';
import { MAX_FILE_REF, parseEffect, parseRecipe, type Effect, type Scape, type Sound, type SoundBank } from './sound';
import {
  BUDGET, MAX_MIX, MAX_TABLE_SOUNDS, TableSounds, checkBudget, decodeRef, encodeRef, isTableSoundId, mixRecipe, newSoundId, parseMixPresets, parseSound,
  readTableSounds, readWav, resampleMono, shrinkWav, soundFormat, tableBank, writeWav, type TableSound,
} from './sounds';
import { parseTheme } from './theme';

const { readFile } = await import('node:fs/promises' as string) as { readFile: (path: string, enc: string) => Promise<string> };
const H = 'ab'.repeat(32);
const ref = (over: Partial<BlobRef> = {}): BlobRef => ({ h: H, n: 50_028, m: 'audio/mpeg', ...over });
const sine = (n: number, rate: number, hz = 440) => Float32Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate) * 0.5);

describe('references to recordings', () => {
  it('go into a recipe as text and come back the same', () => {
    const r = ref({ s: ['https://nostr.download', 'https://blossom.data.haus'] });
    const text = encodeRef(r);
    expect(text.length).toBeLessThanOrEqual(MAX_FILE_REF);
    expect(decodeRef(text)).toEqual(r);
    expect(decodeRef(encodeRef(ref()))).toEqual(ref());
    // and the recipe parsers keep it
    expect(parseRecipe({ name: 'Song', file: text, loop: false, gain: 3 })).toEqual({ name: 'Song', file: text, loop: false, gain: 1 });
    expect(parseEffect({ file: text, gain: 0.5 })).toEqual({ voices: [], file: text, gain: 0.5 });
    expect(parseEffect({ file: '' })).toBeNull();
  });
  it('leave servers out rather than grow too long for a recipe', () => {
    const s = [1, 2, 3, 4].map((i) => `https://files-${i}.example.org/${'x'.repeat(150)}`);
    const text = encodeRef(ref({ s }));
    expect(text.length).toBeLessThanOrEqual(MAX_FILE_REF);
    expect(decodeRef(text)?.s?.length).toBeGreaterThan(0);
    expect(decodeRef(text)?.s?.length).toBeLessThan(4);
  });
  it('are refused unless they name an audio file within budget', () => {
    expect(decodeRef(encodeRef(ref({ m: 'image/png' })))).toBeNull();
    expect(decodeRef(encodeRef(ref({ n: BUDGET.track.bytes + 29 })))).toBeNull();
    expect(decodeRef(encodeRef(ref({ n: BUDGET.track.bytes + 28 })))).not.toBeNull();
    expect(decodeRef(encodeRef(ref({ n: 200_000 })), BUDGET.effect.bytes)).toBeNull();
    expect(decodeRef(JSON.stringify({ h: 'nope', n: 100, m: 'audio/mpeg' }))).toBeNull();
    for (const junk of ['', 'local:1', '{', 'null', '[]', 7, null, `{"h":"${H}","n":100,"m":"audio/mpeg","s":"x"}`, `{"pad":"${'x'.repeat(600)}"}`]) expect(decodeRef(junk)).toBeNull();
    expect(decodeRef(JSON.stringify({ ...ref(), s: ['javascript:alert(1)', 'https://ok.example'] }))?.s).toEqual(['https://ok.example']);
  });
});

describe('the table’s sound entries', () => {
  const file = encodeRef(ref());
  it('are read strictly', () => {
    const track = parseSound({ v: 1, name: '  Tavern night  ', kind: 'music', scape: { name: 'ignored', file, loop: false, gain: 0.7, junk: 1 }, extra: true });
    expect(track).toEqual({ v: 1, name: 'Tavern night', kind: 'music', scape: { name: 'Tavern night', file, loop: false, gain: 0.7 } });
    const fx = parseSound({ v: 1, name: 'Roar', kind: 'effect', fx: { file: encodeRef(ref({ n: 90_000 })), gain: 2 }, as: 'emote:cheer' });
    expect(fx).toEqual({ v: 1, name: 'Roar', kind: 'effect', fx: { voices: [], file: encodeRef(ref({ n: 90_000 })), gain: 1 }, as: 'emote:cheer' });
    expect(parseSound({ v: 1, name: 'Roar', kind: 'effect', fx: { file }, as: 'rm -rf' })?.as).toBeUndefined();
    expect(parseSound({ v: 1, name: 'Zap', kind: 'effect', fx: { voices: [{ kind: 'note', freq: 99999, gain: 9, dur: 0.2 }] } })?.fx?.voices[0]).toEqual({ kind: 'note', freq: 12000, gain: 1, dur: 0.2 });
    // not entries
    expect(parseSound({ v: 2, name: 'New', kind: 'music', scape: { file } })).toBeNull();
    expect(parseSound({ v: 1, name: '', kind: 'music', scape: { file } })).toBeNull();
    expect(parseSound({ v: 1, name: 'X', kind: 'noise', scape: { file } })).toBeNull();
    expect(parseSound({ v: 1, name: 'X', kind: 'music' })).toBeNull();
    expect(parseSound({ v: 1, name: 'X', kind: 'music', scape: { file: 'https://evil.example/track.mp3' } })).toBeNull();
    expect(parseSound({ v: 1, name: 'X', kind: 'effect', fx: { file: encodeRef(ref({ n: 2_000_000 })) } })).toBeNull(); // too heavy for an effect
    expect(parseSound({ v: 1, name: 'X', kind: 'effect', scape: { file } })).toBeNull();
    for (const junk of [null, 7, 'x', []]) expect(parseSound(junk)).toBeNull();
    expect(parseSound({ v: 1, name: 'x'.repeat(80), kind: 'ambience', scape: { drones: [{ wave: 'sine', freq: 50, gain: 0.1 }] } })?.name.length).toBe(24);
  });
  it('are capped in number and in bytes, oldest first', () => {
    const one = (i: number): [string, unknown] => [newSoundId(1_700_000_000_000 + i * 1000, 0), { v: 1, name: `S${i}`, kind: 'ambience', scape: { drones: [{ wave: 'sine', freq: 50 + i, gain: 0.1 }] } }];
    const rows = Array.from({ length: 40 }, (_, i) => one(i)).reverse();
    const got = readTableSounds([...rows, ['bad id!', rows[0][1]], ['zzzz', { v: 1, name: 'broken' }]]);
    expect(got.size).toBe(MAX_TABLE_SOUNDS);
    expect([...got.values()].map((s) => s.name).slice(0, 3)).toEqual(['S0', 'S1', 'S2']);
    // entries as fat as the parser lets them be: only so many bytes of them are listened to
    const fat = (i: number): [string, unknown] => [`fat${String(i).padStart(3, '0')}`, { v: 1, name: `F${i}`, kind: 'ambience', scape: {
      patterns: Array.from({ length: 6 }, () => ({ every: 60000, voices: Array.from({ length: 6 }, () => ({ kind: 'note', freq: [20.123456789, 11999.123456789], gain: [0.0123456789, 0.123456789], dur: [0.123456789, 7.123456789], scale: Array.from({ length: 16 }, (_, k) => k + 0.123456789), on: Array(32).fill(1) })) })),
    } }];
    const heavy = readTableSounds(Array.from({ length: 24 }, (_, i) => fat(i)));
    expect(heavy.size).toBeGreaterThan(2);
    expect(heavy.size).toBeLessThan(24);
    expect([...heavy.values()].reduce((n, s) => n + JSON.stringify(s).length, 0)).toBeLessThanOrEqual(64 * 1024);
  });
  it('become the engine’s bank: soundscapes and soundboard effects as t:<id>, re-voiced effects by name too', () => {
    const sounds = readTableSounds([
      ['aaaa1111', { v: 1, name: 'Song', kind: 'music', scape: { file } }],
      ['bbbb2222', { v: 1, name: 'Roar', kind: 'effect', fx: { file: encodeRef(ref({ n: 9000 })) } }],
      ['cccc3333', { v: 1, name: 'Clink', kind: 'effect', fx: { file: encodeRef(ref({ n: 8000 })) }, as: 'clack' }],
    ]);
    const bank = tableBank(sounds);
    expect(Object.keys(bank.scapes!)).toEqual(['t:aaaa1111']);
    expect(Object.keys(bank.effects!).sort()).toEqual(['clack', 't:bbbb2222', 't:cccc3333']);
    expect(bank.effects!.clack).toBe(bank.effects!['t:cccc3333']);
    expect(isTableSoundId('t:aaaa1111')).toBe(true);
    for (const no of ['rain', 't:', 't:AB12', 't:a b c', 'x:aaaa1111', 't:' + 'a'.repeat(13), 7]) expect(isTableSoundId(no)).toBe(false);
    expect(newSoundId()).toMatch(/^[a-z0-9]{10}$/);
    expect(newSoundId(1000) < newSoundId(2000)).toBe(true);
  });
  it('a board’s or a theme’s soundscape may name one', () => {
    const known = { block: () => false, prop: () => false, mini: () => false, gen: () => false, amb: (id: string) => id === 'rain' || isTableSoundId(id) };
    expect(parseTheme({ v: 1, id: 'x', name: 'X', mood: { amb: 't:aaaa1111' } }, known)?.mood.amb).toBe('t:aaaa1111');
    expect(parseTheme({ v: 1, id: 'x', name: 'X', mood: { amb: 't:not an id' } }, known)?.mood.amb).toBe('off');
  });
});

describe('budgets and formats', () => {
  it('say plainly what is too long or too heavy', () => {
    expect(checkBudget('effect', 100_000, 4)).toBeNull();
    expect(checkBudget('effect', 150 * 1024, 10)).toBeNull();
    expect(checkBudget('effect', 150 * 1024 + 1, 2)).toMatch(/147 KB.*up to 146 KB|150 KB/);
    expect(checkBudget('effect', 1000, 14)).toMatch(/14 s long.*up to 10 s/);
    expect(checkBudget('music', 4 * 1024 * 1024, 300)).toBeNull();
    expect(checkBudget('ambience', 6.2 * 1024 * 1024, 200)).toMatch(/6\.2 MB.*up to 4\.0 MB/);
    expect(checkBudget('music', 1000, 301)).toMatch(/5:01 min long.*up to 5:00 min/);
    expect(checkBudget('music', 9e9, null)).toMatch(/up to 4\.0 MB/);
  });
  it('a sound file is known by its first bytes', () => {
    const b = (...parts: (string | number)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'number' ? [p] : [...p].map((c) => c.charCodeAt(0)))).concat(Array(16).fill(0)));
    expect(soundFormat(b('RIFF', 0, 0, 0, 0, 'WAVE'))?.mime).toBe('audio/wav');
    expect(soundFormat(b('ID3', 3))?.mime).toBe('audio/mpeg');
    expect(soundFormat(b(0xff, 0xfb, 0x90))?.id).toBe('mp3');
    expect(soundFormat(b(0xff, 0xf1, 0x50))?.id).toBe('aac');
    expect(soundFormat(b(0, 0, 0, 0x20, 'ftypM4A '))?.mime).toBe('audio/mp4');
    expect(soundFormat(b(0, 0, 0, 0x18, 'ftyp3gp4'))?.warn).toBeTruthy();
    expect(soundFormat(b('OggS'))?.warn).toMatch(/older iPhones/);
    expect(soundFormat(b(0x1a, 0x45, 0xdf, 0xa3))?.id).toBe('webm');
    expect(soundFormat(b('fLaC'))?.id).toBe('flac');
    for (const id of ['mp3', 'm4a', 'wav'] as const) expect(soundFormat(b(...({ mp3: ['ID3'], m4a: [0, 0, 0, 0, 'ftypisom'], wav: ['RIFF', 0, 0, 0, 0, 'WAVE'] })[id]))?.warn).toBeUndefined();
    expect(soundFormat(b('RIFF', 0, 0, 0, 0, 'AVI '))).toBeNull();
    expect(soundFormat(b(0x89, 'PNG'))).toBeNull();
    expect(soundFormat(new Uint8Array(4))).toBeNull();
  });
});

describe('WAV by hand', () => {
  it('writes 16-bit mono and reads it back', () => {
    const s = sine(800, 8000), wav = writeWav(s, 8000);
    expect(wav.length).toBe(44 + 1600);
    expect(soundFormat(wav)?.id).toBe('wav');
    const back = readWav(wav)!;
    expect(back.rate).toBe(8000);
    expect(back.channels.length).toBe(1);
    expect(back.channels[0].length).toBe(800);
    for (let i = 0; i < 800; i += 37) expect(back.channels[0][i]).toBeCloseTo(s[i], 3);
    expect(readWav(writeWav(Float32Array.from([2, -2]), 8000))!.channels[0][0]).toBeCloseTo(1, 3); // clipped, not wrapped
  });
  it('reads other sample sizes, stereo, and files with extra chunks', () => {
    // 24-bit stereo at 48 kHz with a LIST chunk before the data: left is +0.5, right is −0.25
    const frames = 4, head = [...'RIFF'].map((c) => c.charCodeAt(0));
    const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255], u16 = (n: number) => [n & 255, (n >> 8) & 255];
    const tag = (s: string) => [...s].map((c) => c.charCodeAt(0));
    const s24 = (x: number) => { const n = Math.round(x * 8388608) & 0xffffff; return [n & 255, (n >> 8) & 255, (n >> 16) & 255]; };
    const data = Array.from({ length: frames }, () => [...s24(0.5), ...s24(-0.25)]).flat();
    const bytes = Uint8Array.from([...head, ...u32(0), ...tag('WAVE'), ...tag('fmt '), ...u32(16), ...u16(1), ...u16(2), ...u32(48000), ...u32(48000 * 6), ...u16(6), ...u16(24),
      ...tag('LIST'), ...u32(3), 1, 2, 3, 0, ...tag('data'), ...u32(data.length), ...data]);
    const pcm = readWav(bytes)!;
    expect(pcm.rate).toBe(48000);
    expect(pcm.channels.map((c) => c.length)).toEqual([4, 4]);
    expect(pcm.channels[0][2]).toBeCloseTo(0.5, 5);
    expect(pcm.channels[1][2]).toBeCloseTo(-0.25, 5);
    expect(resampleMono(pcm, 24000)).toEqual(Float32Array.from([0.125, 0.125]));
    // not PCM (a compressed WAV), or not a WAV at all
    const adpcm = bytes.slice();
    adpcm[20] = 2;
    expect(readWav(adpcm)).toBeNull();
    expect(readWav(new Uint8Array(100))).toBeNull();
    expect(readWav(bytes.slice(0, 40))).toBeNull();
  });
  it('re-encodes an effect that is too heavy at the best rate that fits', () => {
    // 3 s of 44.1 kHz mono 16-bit is 265 KB: at 22.05 kHz it is 132 KB and fits
    const big = writeWav(sine(44100 * 3, 44100), 44100);
    expect(big.length).toBeGreaterThan(BUDGET.effect.bytes);
    const small = shrinkWav(big)!;
    expect(small.rate).toBe(22050);
    expect(small.bytes.length).toBeLessThanOrEqual(BUDGET.effect.bytes);
    expect(small.seconds).toBeCloseTo(3, 3);
    const back = readWav(small.bytes)!;
    expect(back.channels[0].length).toBe(22050 * 3);
    let peak = 0;
    for (const x of back.channels[0]) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeGreaterThan(0.4); // still the same tone, not silence
    expect(peak).toBeLessThan(0.55);
    // 8 s only fits at 8 kHz; 10 s fits at none of the rates
    expect(shrinkWav(writeWav(sine(16000 * 8, 16000), 16000))?.rate).toBe(8000);
    expect(shrinkWav(writeWav(new Float32Array(11025 * 10), 11025))).toBeNull();
    // a tiny buffer, and a budget of its own
    const tiny = shrinkWav(writeWav(sine(64, 32000), 32000), 120)!;
    expect(tiny.rate).toBe(16000);
    expect(tiny.bytes.length).toBe(44 + 64);
    expect(shrinkWav(new Uint8Array(64))).toBeNull();
  });
});

describe('the mixer', () => {
  it('its presets are data, and every one that ships is read whole', async () => {
    const raw = JSON.parse(await readFile('public/sounds/mixer.json', 'utf8')) as { presets: Record<string, unknown>[] };
    const presets = parseMixPresets(raw);
    expect(presets.map((p) => p.id)).toEqual(['rain', 'wind', 'drone', 'drips', 'crackle', 'heart', 'chimes']);
    for (const [i, p] of presets.entries()) {
      const { id: _i, name: _n, icon: _c, tone: _t, ...part } = raw.presets[i];
      expect(p.part, p.id).toEqual(part); // nothing dropped or clamped
      expect(p.tone[0]).toBeLessThan(1);
      expect(p.tone[1]).toBeGreaterThan(1);
    }
    expect(parseMixPresets({ presets: [{ id: 'x', name: 'Empty' }, { id: 'Bad Id', name: 'N', drones: [{ wave: 'sine', freq: 50, gain: 0.1 }] }, 7] })).toEqual([]);
    expect(parseMixPresets(null)).toEqual([]);
  });
  it('a mix is a recipe: each preset at its volume and tone', async () => {
    const presets = parseMixPresets(JSON.parse(await readFile('public/sounds/mixer.json', 'utf8')));
    const rain = presets.find((p) => p.id === 'rain')!, drone = presets.find((p) => p.id === 'drone')!;
    // in the middle a preset is exactly as written
    const plain = mixRecipe('Storm', [{ id: 'rain', vol: 0.5, tone: Math.log(1 / rain.tone[0]) / Math.log(rain.tone[1] / rain.tone[0]) }], presets)!;
    expect(plain.name).toBe('Storm');
    expect(plain.layers!.map((l) => l.gain)).toEqual(rain.part.layers!.map((l) => l.gain));
    plain.layers!.forEach((l, i) => l.filters.forEach((f, k) => expect(f.freq).toBeCloseTo(rain.part.layers![i].filters[k].freq, 6)));
    // volume scales gains, tone scales pitches across the preset's range
    const mix = mixRecipe('Deep', [{ id: 'drone', vol: 1, tone: 0 }, { id: 'rain', vol: 0.25, tone: 1 }, { id: 'drips', vol: 0.5, tone: 0.5 }], presets)!;
    expect(mix.drones![0].freq).toBeCloseTo(drone.part.drones![0].freq * drone.tone[0], 6);
    expect(mix.drones![0].gain).toBeCloseTo(drone.part.drones![0].gain * 2, 6);
    expect(mix.layers![0].gain).toBeCloseTo(rain.part.layers![0].gain * 0.5, 6);
    expect(mix.layers![0].filters[0].freq).toBeCloseTo(rain.part.layers![0].filters[0].freq * rain.tone[1], 6);
    expect(mix.patterns!.length).toBe(1);
    expect(parseRecipe(mix)).toEqual(mix); // already within what the engine takes
    // a table entry made of it is accepted, and remembers the mix
    const entry = parseSound({ v: 1, name: 'Deep', kind: 'ambience', scape: mix, mix: [{ id: 'drone', vol: 1, tone: 0 }, { id: 'rain', vol: 7, tone: 'x' }, { id: 'BAD' }] });
    expect(entry?.scape).toEqual(mix);
    expect(entry?.mix).toEqual([{ id: 'drone', vol: 1, tone: 0 }, { id: 'rain', vol: 1, tone: 0.5 }]);
    // bounds: no more than four layers, nothing twice, nothing unknown, nothing silent
    const all = mixRecipe('All', presets.map((p) => ({ id: p.id, vol: 1, tone: 1 })), presets)!;
    expect(parseRecipe(all)).toEqual(all);
    expect((all.layers?.length ?? 0) + (all.drones?.length ?? 0) + (all.patterns?.length ?? 0)).toBe(mixRecipe('Four', presets.slice(0, MAX_MIX).map((p) => ({ id: p.id, vol: 1, tone: 1 })), presets)!.layers!.length + 2 + 1);
    expect(mixRecipe('Twice', [{ id: 'drone', vol: 0.5, tone: 0.5 }, { id: 'drone', vol: 0.5, tone: 0.5 }], presets)!.drones!.length).toBe(drone.part.drones!.length);
    expect(mixRecipe('None', [{ id: 'nope', vol: 1, tone: 1 }], presets)).toBeNull();
    expect(mixRecipe('Mute', [{ id: 'rain', vol: 0, tone: 0.5 }, { id: 'heart', vol: 0, tone: 0.5 }], presets)).toBeNull();
    expect(mixRecipe('', [], presets)).toBeNull();
  });
});

describe('the library at a table', () => {
  function table(full = true) {
    const rows = new Map<string, unknown>(), sent: Msg[] = [], played: string[] = [], banks: SoundBank[] = [];
    const store = {
      get: <T,>(k: string) => (rows.get(k) ?? null) as T | null,
      set: (k: string, v: unknown) => { if (v === null) rows.delete(k); else rows.set(k, v); },
      keys: function* (p: string) { for (const k of rows.keys()) if (k.startsWith(p)) yield k; },
    };
    const sound = { table: (b: SoundBank) => { banks.push(b); }, effect: (name: string) => { played.push(name); return true; } } as unknown as Sound;
    const urls: unknown[] = [], released: unknown[] = [];
    const blobs = {
      put: async (data: Uint8Array, mime: string, opts?: { report?: (o: ServerOutcome[]) => void }) => { opts?.report?.([{ url: 'https://a.example', ok: true }]); return ref({ n: data.length + 28, m: mime, s: ['https://a.example'] }); },
      get: async () => new Uint8Array(10),
      objectUrl: async (r: unknown) => { if ((r as BlobRef).n === 999) throw new Error('blob not available'); urls.push(r); return 'blob:x'; },
      release: (r: unknown) => { released.push(r); },
      outcomes: () => [],
    };
    const state = { full };
    const ts = new TableSounds({ store, sound, blobs, full: () => state.full, send: (m) => { sent.push(m); } });
    return { ts, store, rows, sent, played, banks, sound, urls, released, state };
  }
  const drone: Scape = { name: 'Hum', drones: [{ wave: 'sine', freq: 50, gain: 0.1 }] };
  const zap: Effect = { voices: [{ kind: 'note', freq: 300, gain: 0.2, dur: 0.2 }] };

  it('saves, lists, renames and removes; an entry that did not change keeps its recipe', () => {
    const t = table();
    expect(t.ts.save(null, { v: 1, name: 'Hum', kind: 'ambience', scape: drone })).toBeNull();
    expect(t.ts.save(null, { v: 1, name: 'Zap', kind: 'effect', fx: zap })).toBeNull();
    const [[hum, first], [zapId]] = t.ts.list();
    expect(Object.keys(t.ts.scapeNames())).toEqual([`t:${hum}`]);
    expect(t.ts.board().map(([, s]) => s.name)).toEqual(['Zap']);
    expect(t.ts.refresh()).toBe(false); // nothing changed: the engine is not bothered
    const banks = t.banks.length;
    expect(t.ts.save(zapId, { ...t.ts.get(zapId)!, name: 'Zzap', as: 'ping' })).toBeNull();
    expect(t.banks.length).toBe(banks + 1);
    expect(t.ts.get(hum)!.scape).toBe(first.scape); // the same object: a playing soundscape is not restarted
    expect(t.ts.board()).toEqual([]);
    expect(t.ts.bank().effects!.ping).toEqual(zap);
    expect(t.ts.save(null, { v: 1, name: '', kind: 'ambience', scape: drone })).toMatch(/name/);
    t.ts.remove(hum);
    expect(t.ts.list().map(([, s]) => s.name)).toEqual(['Zzap']);
    // another player's write arrives through the store
    t.store.set('snd:zzzz9999', { v: 1, name: 'Theirs', kind: 'music', scape: drone });
    expect(t.ts.refresh()).toBe(true);
    expect(t.ts.list().map(([, s]) => s.name)).toEqual(['Zzap', 'Theirs']);
  });
  it('holds no more than the table may have, and only the GM changes it', () => {
    const t = table();
    for (let i = 0; i < MAX_TABLE_SOUNDS; i++) t.store.set(`snd:${newSoundId(1_700_000_000_000 + i, 0)}`, { v: 1, name: `S${i}`, kind: 'ambience', scape: drone });
    t.ts.refresh();
    expect(t.ts.save(null, { v: 1, name: 'One more', kind: 'ambience', scape: drone })).toMatch(/already has 24/);
    const [id, s] = t.ts.list()[0];
    expect(t.ts.save(id, { ...s, name: 'Renamed' })).toBeNull(); // changing one is still fine
    t.state.full = false;
    expect(t.ts.save(id, { ...s, name: 'Mine now' })).toMatch(/Only the GM/);
    t.ts.remove(id);
    expect(t.ts.get(id)?.name).toBe('Renamed');
  });
  it('the soundboard is a live message, heard only from whoever may play it, and never a flood', () => {
    const t = table();
    t.ts.save(null, { v: 1, name: 'Zap', kind: 'effect', fx: zap });
    const [[id]] = t.ts.list();
    const rows = JSON.stringify([...t.rows]);
    t.ts.hit(id);
    expect(t.sent).toEqual([{ y: 'sfx', id }]);
    expect(t.played).toEqual([`t:${id}`]);
    expect(JSON.stringify([...t.rows])).toBe(rows); // not a store write
    expect(t.ts.heard(id, true, 1000)).toBe(true);
    expect(t.ts.heard(id, false, 1000)).toBe(false); // a player, at a table with a GM
    expect(t.ts.heard('nope', true, 1000)).toBe(false);
    expect(t.ts.heard({ id }, true, 1000)).toBe(false);
    for (let i = 0; i < 10; i++) t.ts.heard(id, true, 1001 + i);
    expect(t.played.length).toBe(1 + 6);
    expect(t.ts.heard(id, true, 5000)).toBe(true); // and again once it has gone quiet
    t.state.full = false;
    t.ts.hit(id);
    expect(t.sent.length).toBe(1);
  });
  it('hands the engine recordings from the file store, and gives them back', async () => {
    const t = table(), file = encodeRef(ref());
    expect(await t.sound.resolver!(file)).toBe('blob:x');
    expect(t.urls).toEqual([ref()]);
    expect(t.ts.resolved).toBe(1);
    t.sound.release!(file);
    expect(t.released).toEqual([ref()]);
    expect(await t.sound.resolver!('https://evil.example/a.mp3')).toBeNull();
    expect(await t.sound.resolver!(encodeRef(ref({ m: 'text/html' })))).toBeNull();
    expect(await t.sound.resolver!(encodeRef(ref({ n: 999 })))).toBeNull(); // not to be had right now: no error, the engine asks again
    expect(await t.sound.resolver!('local:1')).toBeNull();
    expect(t.urls.length).toBe(1);
    expect(decodeRef(await t.ts.upload(new Uint8Array(100), 'audio/wav'))).toEqual(ref({ n: 128, m: 'audio/wav', s: ['https://a.example'] }));
  });
});

describe('table sounds and the engine', () => {
  it('an entry’s type is what the store holds', () => {
    const s: TableSound = { v: 1, name: 'Hum', kind: 'ambience', scape: { name: 'Hum', drones: [{ wave: 'sine', freq: 50, gain: 0.1 }] } };
    expect(parseSound(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
});
