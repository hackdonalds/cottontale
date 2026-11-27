// The table's own sounds: the GM's music, ambience and effects, and soundscapes mixed on the phone.
//
// Each is one table-wide store entry, `snd:<id>` → { v: 1, name, kind, scape | fx, as?, mix? }:
//   - music / ambience carry a soundscape recipe (`scape`, see sound.ts). It is either a recording
//     (`scape.file`, a reference into the file store: blob.ts) or a mix of the engine's own layers;
//   - an effect carries an effect recipe (`fx`), a short recording as a rule. With `as` it re-voices
//     a built-in effect for the table (`clack`, `ping`, `emote:cheer` …); without, it is a button on
//     the soundboard, played for everyone with a live message ({ y: 'sfx', id }), never a store write.
// To the engine a table soundscape is `t:<id>`: that is what a board's `amb` names, and no shipped or
// theme recipe can have such an id by accident (`isTableSoundId`).
//
// Anyone at the table may have written an entry, so it is read strictly (`parseSound`): the recipe
// parsers of sound.ts clamp the numbers, a recording must be a well-formed reference to an audio
// file within budget, and only so many entries (and so many bytes of them) are listened to.
// The first half of this file is pure and runs under node (unit tests).
import { OVERHEAD, parseRef, type BlobRef, type ServerOutcome } from './blob';
import type { Msg } from './net';
import { MAX_FILE_REF, parseEffect, parseRecipe, type Effect, type Scape, type Sound, type SoundBank, type Span } from './sound';

export type SoundKind = 'music' | 'ambience' | 'effect';
export interface MixPick { id: string; vol: number; tone: number }
export interface TableSound {
  v: 1; name: string; kind: SoundKind;
  /** music, ambience: the soundscape (its `name` is the entry's). */
  scape?: Scape;
  /** effect: what it sounds like. */
  fx?: Effect;
  /** effect: the built-in effect it stands in for at this table. Without it, it is a soundboard button. */
  as?: string;
  /** A soundscape mixed here: the presets it was made of, so it can be opened in the mixer again. */
  mix?: MixPick[];
}

export const SOUND_FORMAT = 1;
export const MAX_TABLE_SOUNDS = 24;
/** All the entries together, as JSON. (The recordings themselves are not in the store.) */
export const MAX_TABLE_SOUND_BYTES = 64 * 1024;
export const MAX_SOUND_NAME = 24;
/** What a recording may weigh: an effect is decoded whole on every device, music is streamed. */
export const BUDGET = { effect: { seconds: 10, bytes: 150 * 1024 }, track: { seconds: 300, bytes: 4 * 1024 * 1024 } } as const;
export const budgetOf = (kind: SoundKind) => (kind === 'effect' ? BUDGET.effect : BUDGET.track);
/** The built-in effects a table effect may re-voice. */
export const REVOICE = /^(?:clack|thud|ping|emote(?::[a-z]{1,12})?)$/;
const ENTRY_ID = /^[a-z0-9]{4,12}$/;

export const soundKey = (id: string) => `snd:${id}`;
/** What the engine, and a board's `amb`, call a table sound. */
export const tableSoundId = (id: string) => `t:${id}`;
export const isTableSoundId = (id: unknown): id is string => typeof id === 'string' && id.startsWith('t:') && ENTRY_ID.test(id.slice(2));
/** A new entry id. They sort by when they were made. */
export function newSoundId(now = Date.now(), rnd = Math.random()): string {
  return (now.toString(36).padStart(8, '0').slice(-8) + Math.floor(rnd * 1296).toString(36).padStart(2, '0')).toLowerCase();
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const clamp = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

// ---- references to recordings ---------------------------------------------------------------

/**
 * A recording's reference as a recipe carries it (`Scape.file`, `Effect.file`): the blob reference as JSON.
 * The servers that took the file are part of it; if they make it too long for a recipe, the last ones are left out.
 */
export function encodeRef(ref: BlobRef): string {
  const s = [...(ref.s ?? [])];
  for (;;) {
    const text = JSON.stringify(s.length ? { h: ref.h, n: ref.n, m: ref.m, s } : { h: ref.h, n: ref.n, m: ref.m });
    if (text.length <= MAX_FILE_REF || !s.length) return text;
    s.pop();
  }
}
/** Read a recording's reference. Null unless it is a well-formed reference to an audio file no bigger than `max` bytes. */
export function decodeRef(text: unknown, max: number = BUDGET.track.bytes): BlobRef | null {
  if (typeof text !== 'string' || text.length > MAX_FILE_REF || text[0] !== '{') return null;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const ref = parseRef(raw, max);
  return ref && ref.m.startsWith('audio/') ? ref : null;
}
/** How big the recording a reference names is, in bytes. */
export const refBytes = (ref: BlobRef) => ref.n - OVERHEAD;

// ---- entries --------------------------------------------------------------------------------

/** Read one entry of the table's sound library. Null if it is not one this app understands. */
export function parseSound(raw: unknown): TableSound | null {
  const r = obj(raw), name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_SOUND_NAME) : '';
  const kind = r.kind === 'music' || r.kind === 'ambience' || r.kind === 'effect' ? r.kind : null;
  if (r.v !== SOUND_FORMAT || !name || !kind) return null;
  if (kind === 'effect') {
    const fx = parseEffect(r.fx);
    if (!fx || (fx.file !== undefined && !decodeRef(fx.file, BUDGET.effect.bytes))) return null;
    return { v: 1, name, kind, fx, ...(typeof r.as === 'string' && REVOICE.test(r.as) ? { as: r.as } : {}) };
  }
  const scape = parseRecipe({ ...obj(r.scape), name });
  if (!scape || (scape.file !== undefined && !decodeRef(scape.file))) return null;
  const mix = (Array.isArray(r.mix) ? r.mix.slice(0, MAX_MIX) : []).map(parsePick).filter((p): p is MixPick => !!p);
  return { v: 1, name, kind, scape, ...(mix.length && !scape.file ? { mix } : {}) };
}

/**
 * The table's library, from its store entries: the ones that parse, oldest first, as many as the table
 * may have and as fit its budget. `[id, raw]` pairs in; what is left out is simply not listened to.
 */
export function readTableSounds(rows: Iterable<[id: string, raw: unknown]>, parse: (id: string, raw: unknown) => TableSound | null = (_, raw) => parseSound(raw)): Map<string, TableSound> {
  const out = new Map<string, TableSound>();
  let bytes = 0;
  for (const [id, raw] of [...rows].filter(([id]) => ENTRY_ID.test(id)).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (out.size >= MAX_TABLE_SOUNDS) break;
    const s = parse(id, raw);
    if (!s) continue;
    const n = JSON.stringify(s).length;
    if (bytes + n > MAX_TABLE_SOUND_BYTES) continue;
    bytes += n;
    out.set(id, s);
  }
  return out;
}

/** The library as the engine takes it: soundscapes and soundboard effects as `t:<id>`, and re-voiced effects under the name they stand in for. */
export function tableBank(sounds: Iterable<[id: string, s: TableSound]>): SoundBank {
  const scapes: Record<string, Scape> = {}, effects: Record<string, Effect> = {};
  for (const [id, s] of sounds) {
    if (s.scape) scapes[tableSoundId(id)] = s.scape;
    if (s.fx) { effects[tableSoundId(id)] = s.fx; if (s.as) effects[s.as] = s.fx; }
  }
  return { scapes, effects };
}

// ---- budgets and formats --------------------------------------------------------------------

export function fmtBytes(n: number): string {
  return n < 1000 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export function fmtTime(s: number): string {
  return s < 60 ? `${s < 10 ? s.toFixed(1) : Math.round(s)} s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} min`;
}

/** Why a recording cannot be taken as it is (said to the GM as written), or null if it fits. `seconds` null: not known. */
export function checkBudget(kind: SoundKind, bytes: number, seconds: number | null): string | null {
  const b = budgetOf(kind), what = kind === 'effect' ? 'An effect' : 'Music and ambience';
  if (seconds !== null && seconds > b.seconds + 0.05) {
    return `This is ${fmtTime(seconds)} long. ${what} can be up to ${fmtTime(b.seconds)}${kind === 'effect' ? ': trim it, or add it as ambience instead.' : ': trim it first.'}`;
  }
  if (bytes > b.bytes) {
    return `This file is ${fmtBytes(bytes)}. ${what} can be up to ${fmtBytes(b.bytes)}${kind === 'effect' ? ': a short MP3 or WAV works best.' : ': save it as MP3 or M4A at a lower quality (96 kbps is plenty for the table), or trim it.'}`;
  }
  return null;
}

export interface SoundFormat {
  id: 'mp3' | 'm4a' | 'aac' | 'wav' | 'ogg' | 'webm' | 'flac' | '3gp';
  /** The type the file is stored as. */
  mime: string;
  name: string;
  /** What to ask `canPlayType`. */
  probe: string;
  /** A plain warning for the GM when not every phone plays it. */
  warn?: string;
}
const FORMATS: Record<SoundFormat['id'], SoundFormat> = {
  mp3: { id: 'mp3', mime: 'audio/mpeg', name: 'MP3', probe: 'audio/mpeg' },
  m4a: { id: 'm4a', mime: 'audio/mp4', name: 'M4A', probe: 'audio/mp4; codecs="mp4a.40.2"' },
  aac: { id: 'aac', mime: 'audio/aac', name: 'AAC', probe: 'audio/aac' },
  wav: { id: 'wav', mime: 'audio/wav', name: 'WAV', probe: 'audio/wav' },
  ogg: { id: 'ogg', mime: 'audio/ogg', name: 'Ogg', probe: 'audio/ogg; codecs="opus"', warn: 'Ogg files do not play on older iPhones and iPads. MP3 or M4A plays everywhere.' },
  webm: { id: 'webm', mime: 'audio/webm', name: 'WebM', probe: 'audio/webm; codecs="opus"', warn: 'WebM files do not play on older iPhones and iPads. MP3 or M4A plays everywhere.' },
  flac: { id: 'flac', mime: 'audio/flac', name: 'FLAC', probe: 'audio/flac', warn: 'FLAC files are large and do not play on older phones. MP3 or M4A plays everywhere.' },
  '3gp': { id: '3gp', mime: 'audio/3gpp', name: 'phone recording (3GP)', probe: 'audio/3gpp', warn: 'This kind of phone recording may not play on other devices. MP3 or M4A plays everywhere.' },
};
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** What kind of sound file this is, from its first bytes (16 are enough; names and types lie). Null if it is none this app takes. */
export function soundFormat(head: Uint8Array): SoundFormat | null {
  if (head.length < 12) return null;
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return FORMATS.wav;
  if (ascii(head, 0, 4) === 'OggS') return FORMATS.ogg;
  if (ascii(head, 0, 4) === 'fLaC') return FORMATS.flac;
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return FORMATS.webm;
  if (ascii(head, 4, 4) === 'ftyp') return ascii(head, 8, 2) === '3g' ? FORMATS['3gp'] : FORMATS.m4a;
  if (ascii(head, 0, 3) === 'ID3') return FORMATS.mp3;
  if (head[0] === 0xff && (head[1] & 0xf6) === 0xf0) return FORMATS.aac; // ADTS
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return FORMATS.mp3; // a bare MPEG audio frame
  return null;
}

// ---- WAV, read and written by hand (short effects only) --------------------------------------

export interface Pcm { rate: number; channels: Float32Array[] }

/** Read an uncompressed WAV (8, 16, 24, 32-bit or float). Null for anything else. */
export function readWav(bytes: Uint8Array): Pcm | null {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { tag: number; ch: number; rate: number; bits: number; align: number } | null = null;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = ascii(bytes, at, 4), size = v.getUint32(at + 4, true), body = at + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
      let tag = v.getUint16(body, true);
      if (tag === 0xfffe && size >= 26 && body + 26 <= bytes.length) tag = v.getUint16(body + 24, true); // "extensible": the real format is further in
      fmt = { tag, ch: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), align: v.getUint16(body + 12, true), bits: v.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt || fmt.ch < 1 || fmt.ch > 8 || fmt.rate < 1000 || fmt.rate > 192000) return null;
      const width = fmt.bits / 8, float = fmt.tag === 3;
      if (!(fmt.tag === 1 && [1, 2, 3, 4].includes(width)) && !(float && width === 4)) return null;
      const frame = width * fmt.ch, frames = Math.floor(Math.min(size, bytes.length - body) / frame);
      const channels = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
      for (let i = 0, p = body; i < frames; i++) {
        for (let c = 0; c < fmt.ch; c++, p += width) {
          channels[c][i] = float ? v.getFloat32(p, true)
            : width === 1 ? (v.getUint8(p) - 128) / 128
              : width === 2 ? v.getInt16(p, true) / 32768
                : width === 3 ? ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16))) / 8388608
                  : v.getInt32(p, true) / 2147483648;
        }
      }
      return { rate: fmt.rate, channels };
    }
    at = body + size + (size & 1);
  }
  return null;
}

/** One channel out of several (their mean), at another sample rate. Going down, each new sample is the mean of the old ones it covers. */
export function resampleMono(pcm: Pcm, rate: number): Float32Array {
  const n = pcm.channels[0]?.length ?? 0, ch = pcm.channels.length, step = pcm.rate / rate;
  const out = new Float32Array(Math.max(0, Math.round(n / step)));
  const at = (i: number) => { let s = 0; for (let c = 0; c < ch; c++) s += pcm.channels[c][i]; return s / ch; };
  for (let o = 0; o < out.length; o++) {
    const from = o * step, to = Math.min(n, (o + 1) * step);
    if (step <= 1) { // going up (or staying): between the two nearest
      const i = Math.min(n - 1, Math.floor(from)), j = Math.min(n - 1, i + 1), f = from - i;
      out[o] = at(i) * (1 - f) + at(j) * f;
      continue;
    }
    let sum = 0, count = 0;
    for (let i = Math.floor(from); i < to; i++, count++) sum += at(i);
    out[o] = count ? sum / count : 0;
  }
  return out;
}

/** A 16-bit mono WAV file of these samples. */
export function writeWav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2), v = new DataView(out.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return out;
}

/** The sample rates a re-encoded effect may have, best first. 8 kHz still carries a knock or a growl. */
export const SHRINK_RATES = [22050, 16000, 11025, 8000] as const;
/**
 * Make a WAV effect fit: one channel, 16 bits, at the best sample rate that brings it under `maxBytes`.
 * Null if it is not a WAV this can read, or nothing brings it under.
 */
export function shrinkWav(bytes: Uint8Array, maxBytes: number = BUDGET.effect.bytes): { bytes: Uint8Array; rate: number; seconds: number } | null {
  const pcm = readWav(bytes), frames = pcm?.channels[0].length ?? 0;
  if (!pcm || !frames) return null;
  const seconds = frames / pcm.rate;
  for (const rate of [...new Set([Math.min(pcm.rate, SHRINK_RATES[0]), ...SHRINK_RATES.filter((r) => r < pcm.rate)])]) {
    if (44 + Math.round(seconds * rate) * 2 > maxBytes) continue;
    return { bytes: writeWav(resampleMono(pcm, rate), rate), rate, seconds };
  }
  return null;
}

// ---- the mixer ------------------------------------------------------------------------------

/** How many presets one mix may layer. */
export const MAX_MIX = 4;
/**
 * A building block of the mixer: a piece of a soundscape recipe (layers, drones, patterns, an echo), and how far
 * its tone slider reaches: every pitch in it times `tone[0]` at one end and `tone[1]` at the other.
 * They are data (public/sounds/mixer.json), not code.
 */
export interface MixPreset { id: string; name: string; icon: string; tone: [number, number]; part: Omit<Scape, 'name'> }

function parsePick(raw: unknown): MixPick | null {
  const r = obj(raw);
  return typeof r.id === 'string' && /^[a-z0-9_-]{1,16}$/.test(r.id) ? { id: r.id, vol: clamp(r.vol, 0, 1, 0.5), tone: clamp(r.tone, 0, 1, 0.5) } : null;
}

/** Read the mixer's presets (`{ presets: [...] }`). What is not understood is left out. */
export function parseMixPresets(raw: unknown): MixPreset[] {
  const out: MixPreset[] = [];
  for (const p of (Array.isArray(obj(raw).presets) ? obj(raw).presets as unknown[] : []).slice(0, 16).map(obj)) {
    const id = typeof p.id === 'string' && /^[a-z0-9_-]{1,16}$/.test(p.id) ? p.id : '', name = typeof p.name === 'string' ? p.name.trim().slice(0, 16) : '';
    const recipe = parseRecipe({ name: 'x', layers: p.layers, drones: p.drones, patterns: p.patterns, echo: p.echo });
    if (!id || !name || !recipe || out.some((q) => q.id === id)) continue;
    const t = Array.isArray(p.tone) ? p.tone : [], lo = clamp(t[0], 0.1, 1, 0.5), hi = clamp(t[1], 1, 8, 2);
    const { name: _, ...part } = recipe;
    out.push({ id, name, icon: typeof p.icon === 'string' ? [...p.icon].slice(0, 4).join('') : '', tone: [lo, hi], part });
  }
  return out;
}

const times = (s: Span, f: number): Span => (typeof s === 'number' ? s * f : [s[0] * f, s[1] * f]);
const opt = <T>(v: T | undefined, fn: (v: T) => T): T | undefined => (v === undefined ? undefined : fn(v));

/**
 * The soundscape a mix stands for: each picked preset at its volume (0..1, the middle is as written, the top
 * twice that) and its tone (0..1 across the preset's range), layered. Null if nothing in it sounds.
 * It goes through `parseRecipe`, so it is within what a phone may be asked to play.
 */
export function mixRecipe(name: string, picks: MixPick[], presets: MixPreset[]): Scape | null {
  const mix: Required<Pick<Scape, 'layers' | 'drones' | 'patterns'>> & Pick<Scape, 'echo'> = { layers: [], drones: [], patterns: [] };
  const seen = new Set<string>();
  for (const pick of picks.slice(0, MAX_MIX)) {
    const p = presets.find((q) => q.id === pick.id);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    const g = Math.max(0, Math.min(1, pick.vol)) * 2, f = p.tone[0] * (p.tone[1] / p.tone[0]) ** Math.max(0, Math.min(1, pick.tone));
    for (const l of p.part.layers ?? []) {
      mix.layers.push({
        filters: l.filters.map((x) => ({ ...x, freq: x.freq * f })), gain: l.gain * g,
        ...(l.mod && { mod: { every: l.mod.every, ...(l.mod.freq && { freq: [l.mod.freq[0] * f, l.mod.freq[1] * f] as [number, number] }), ...(l.mod.gain && { gain: [l.mod.gain[0] * g, l.mod.gain[1] * g] as [number, number] }) } }),
      });
    }
    for (const d of p.part.drones ?? []) mix.drones.push({ ...d, freq: d.freq * f, gain: d.gain * g, ...(d.lp !== undefined && { lp: d.lp * f }) });
    for (const pt of p.part.patterns ?? []) {
      mix.patterns.push({ every: pt.every, voices: pt.voices.map((v) => {
        const out = { ...v, freq: times(v.freq, f), gain: times(v.gain, g) };
        const glideTo = opt(v.glideTo, (x) => x * f), lp = opt(v.lp, (x) => x * f);
        if (glideTo !== undefined) out.glideTo = glideTo;
        if (lp !== undefined) out.lp = lp;
        return out;
      }) });
    }
    mix.echo ??= p.part.echo;
  }
  if (mix.layers.every((l) => l.gain === 0) && mix.drones.every((d) => d.gain === 0) && mix.patterns.every((p) => p.voices.every((v) => v.gain === 0 || (Array.isArray(v.gain) && v.gain[1] === 0)))) return null;
  return parseRecipe({ name: name.trim() || 'Mix', ...mix });
}

// ---- the table's library, live -----------------------------------------------------------------

/** As much of the store as the library needs. */
export interface SoundStore { get<T = unknown>(key: string): T | null; set(key: string, value: unknown): void; keys(prefix: string): Iterable<string> }
/** As much of the file store (blob.ts). */
export interface SoundFiles {
  put(data: Uint8Array, mime: string, opts?: { report?: (outcomes: ServerOutcome[]) => void }): Promise<BlobRef>;
  get(ref: unknown): Promise<Uint8Array>;
  objectUrl(ref: unknown): Promise<string>;
  release(ref: unknown): void;
  outcomes(hash: string): ServerOutcome[];
}
export interface SoundsHost {
  store: SoundStore;
  sound: Sound;
  blobs: SoundFiles;
  /** May this device change the table? (The GM, or anyone in free play.) */
  full(): boolean;
  /** Say something to everyone at the table, on whatever board they are. */
  send(msg: Msg): void;
}

const LOCAL = 'local:';

export class TableSounds {
  /** How many times a recording was handed to the engine as a URL (for tests and the curious). */
  resolved = 0;
  readonly sound: Sound;
  private sounds = new Map<string, TableSound>();
  private seen = new Map<string, { json: string; s: TableSound | null }>();
  private sig = '';
  private theBank: SoundBank = {};
  private locals = new Map<string, string>();
  private nextLocal = 0;
  private recent: number[] = [];
  /** Called when the library changed. */
  onChange: () => void = () => {};

  constructor(private o: SoundsHost) {
    this.sound = o.sound;
    // Recordings live in the file store; a device with sound off never gets here (the engine only asks when it is about to play).
    o.sound.resolver = async (ref) => {
      if (ref.startsWith(LOCAL)) return this.locals.get(ref) ?? null;
      const r = decodeRef(ref);
      if (!r) return null;
      try {
        const url = await o.blobs.objectUrl(r);
        this.resolved++;
        return url;
      } catch { return null; } // not to be had right now: the engine asks again
    };
    o.sound.release = (ref) => { const r = ref.startsWith(LOCAL) ? null : decodeRef(ref); if (r) o.blobs.release(r); };
    this.refresh();
  }

  /**
   * Read the library from the store again. Cheap when nothing changed; an entry that did not change keeps
   * its recipe object, so a soundscape that is playing is not restarted by an edit to another.
   */
  refresh(): boolean {
    const rows: [string, unknown][] = [];
    let sig = '';
    for (const k of this.o.store.keys('snd:')) {
      const id = k.slice(4), raw = this.o.store.get(k), json = JSON.stringify(raw);
      rows.push([id, raw]);
      sig += `${id}=${json.length}:${json}\n`;
      if (this.seen.get(id)?.json !== json) this.seen.set(id, { json, s: parseSound(raw) });
    }
    if (sig === this.sig) return false;
    this.sig = sig;
    for (const id of [...this.seen.keys()]) if (!rows.some(([i]) => i === id)) this.seen.delete(id);
    this.sounds = readTableSounds(rows, (id) => this.seen.get(id)?.s ?? null);
    this.theBank = tableBank(this.sounds);
    this.o.sound.table(this.theBank);
    this.onChange();
    return true;
  }

  /** The library as the engine takes it (the same object until the library changes). */
  bank(): SoundBank { return this.theBank; }
  list(): [id: string, s: TableSound][] { return [...this.sounds]; }
  get(id: string): TableSound | undefined { return this.sounds.get(id); }
  /** The table's soundscapes for a picker: engine id → name. */
  scapeNames(): Record<string, string> {
    return Object.fromEntries(this.list().filter(([, s]) => s.scape).map(([id, s]) => [tableSoundId(id), s.name]));
  }
  /** The soundboard: the effects that are buttons. */
  board(): [id: string, s: TableSound][] { return this.list().filter(([, s]) => s.fx && !s.as); }

  /** Add an entry, or change one. Returns why not (said to the GM as written), or null when it is saved. */
  save(id: string | null, entry: TableSound): string | null {
    if (!this.o.full()) return 'Only the GM can change the table’s sounds.';
    const clean = parseSound(entry);
    if (!clean) return 'That sound cannot be saved: give it a name.';
    if (!id && this.sounds.size >= MAX_TABLE_SOUNDS) return `This table already has ${MAX_TABLE_SOUNDS} sounds: remove one first.`;
    const others = this.list().filter(([i]) => i !== id).reduce((n, [, s]) => n + JSON.stringify(s).length, 0);
    if (others + JSON.stringify(clean).length > MAX_TABLE_SOUND_BYTES) return 'The table’s sound library is full: remove a sound first.';
    let key = id ?? newSoundId();
    if (!id) { // two made in the same instant still list in the order they were made
      const last = [...this.sounds.keys()].pop() ?? '';
      for (let now = Date.now() + 1, i = 0; key <= last && i < 50; i++) key = newSoundId(now++);
    }
    this.o.store.set(soundKey(key), clean);
    this.refresh();
    return null;
  }
  remove(id: string): void {
    if (!this.o.full()) return;
    this.o.store.set(soundKey(id), null);
    this.refresh();
  }

  /** A soundboard button was tapped here: sound it, and for everyone else at the table. */
  hit(id: string): void {
    if (!this.o.full() || !this.sounds.get(id)?.fx) return;
    this.o.sound.effect(tableSoundId(id));
    this.o.send({ y: 'sfx', id });
  }
  /** Someone tapped a soundboard button. `may`: they are the GM, or the table is in free play. A flood is not played. */
  heard(id: unknown, may: boolean, now = Date.now()): boolean {
    if (!may || typeof id !== 'string' || !this.sounds.get(id)?.fx) return false;
    this.recent = this.recent.filter((t) => now - t < 3000);
    if (this.recent.length >= 6) return false;
    this.recent.push(now);
    this.o.sound.effect(tableSoundId(id));
    return true;
  }

  /** A reference to a file that is only on this device yet, for trying it out before it is uploaded. `forget` it afterwards. */
  local(file: Blob): string {
    const ref = `${LOCAL}${++this.nextLocal}`;
    this.locals.set(ref, URL.createObjectURL(file));
    return ref;
  }
  forget(ref: string | undefined): void {
    const url = ref ? this.locals.get(ref) : undefined;
    if (!url || !ref) return;
    this.locals.delete(ref);
    setTimeout(() => URL.revokeObjectURL(url), 1500); // the engine may still be fading it out
  }

  /** Put a recording in the file store. `report` hears how each server answered. */
  async upload(bytes: Uint8Array, mime: string, report?: (outcomes: ServerOutcome[]) => void): Promise<string> {
    return encodeRef(await this.o.blobs.put(bytes, mime, { report }));
  }
  /** Offer a recording the table already has to the servers again. Returns the new reference (the same file, perhaps on more servers). */
  async reupload(file: string, report?: (outcomes: ServerOutcome[]) => void): Promise<string | null> {
    const ref = decodeRef(file);
    if (!ref) return null;
    try { return await this.upload(await this.o.blobs.get(ref), ref.m, report); } catch { return null; }
  }
  /** How the servers answered when this device last uploaded a recording (nothing if it was not uploaded from here). */
  outcomes(file: string | undefined): ServerOutcome[] {
    const ref = decodeRef(file);
    return ref ? this.o.blobs.outcomes(ref.h) : [];
  }
}
