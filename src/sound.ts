// Sound, all synthesised in the browser: no audio files to download.
// Soundscapes are chosen by the GM for the whole table; each device decides
// whether it wants to hear anything at all.
//
// What a soundscape or an effect sounds like is data, a "recipe", played by the one
// engine below: layers of looped filtered noise, drones, and patterns of timed notes and
// noise bursts. No recipe is written into the app: the ones on offer are files
// (public/sounds/*.json, listed in index.json, and effects.json) and a theme may bring its
// own. Either way it is somebody else's data: `parseRecipe` and `parseEffect` keep what they
// understand and clamp every number, so a recipe can be neither deafening nor a burden.

// ---- recipes: the data the engine plays ---------------------------------------------------

export type Wave = 'sine' | 'triangle' | 'square' | 'sawtooth';
export type Pass = 'lowpass' | 'highpass' | 'bandpass';
/** One value, or anywhere between two (drawn afresh each time it sounds). */
export type Span = number | [lo: number, hi: number];
export interface Filter { type: Pass; freq: number; q?: number }
/** Looped noise through filters. `mod` drifts it: every so many ms the first filter and the gain glide somewhere new. */
export interface Layer { filters: Filter[]; gain: number; mod?: { every: number; freq?: [number, number]; gain?: [number, number] } }
/** A steady tone behind a lowpass (400 Hz unless `lp` says otherwise). */
export interface Drone { wave: Wave; freq: number; gain: number; lp?: number }
/**
 * One sound: a note (an oscillator with a soft attack and a dying tail) or a burst of filtered noise.
 * - `scale`: semitones above `freq`, one picked each time · `glide`: slide to this many times the pitch, `glideTo`: to this pitch
 * - in a pattern: `p` the chance it sounds on a beat, `on` the beats it may sound on (a row of 0/1 that repeats),
 *   `lp` a lowpass it plays through, `echo` whether it goes to the echo
 * - in an effect: `at` ms after the effect starts, `vel` how much louder a harder knock makes it
 */
export interface Voice {
  kind: 'note' | 'burst'; wave?: Wave; type?: Pass; freq: Span; gain: Span; dur: Span;
  attack?: number; glide?: number; glideTo?: number; scale?: number[];
  p?: number; on?: number[]; lp?: number; echo?: boolean;
  at?: number; vel?: number;
}
/** A timer: every `every` ms is a beat, and each voice may sound on it. */
export interface Pattern { every: number; voices: Voice[] }
/**
 * A soundscape. `name` is what the picker calls it (it may lead with an emoji).
 * Instead of (or besides) being synthesised it may be a recording: `file` is a reference only the
 * app's file store understands (see `Sound.resolver`), looped unless `loop` is false, at `gain`.
 */
export interface Scape {
  name: string; layers?: Layer[]; drones?: Drone[]; patterns?: Pattern[];
  echo?: { time: number; feedback: number; mix: number };
  file?: string; loop?: boolean; gain?: number;
}
/** A one-shot effect: voices, or a short recording (`file`, as in a soundscape, played once at `gain`), or both. */
export interface Effect { voices: Voice[]; file?: string; gain?: number }
export interface SoundBank { scapes?: Record<string, Scape>; effects?: Record<string, Effect> }

/** The most a recipe may ask of a phone. */
export const SOUND_LIMITS = { layers: 6, filters: 3, drones: 6, patterns: 6, voices: 6, timers: 8, perSecond: 40, live: 24, steps: 32, scale: 16 } as const;
const WAVES: readonly Wave[] = ['sine', 'triangle', 'square', 'sawtooth'], PASSES: readonly Pass[] = ['lowpass', 'highpass', 'bandpass'];
const ID = /^[a-z0-9][a-z0-9:_-]{0,23}$/;
/** A recording this short is decoded whole, so it loops without a gap; anything longer is streamed. */
const SHORT_LOOP = 30;
/** The longest reference to a recording a recipe may carry. */
export const MAX_FILE_REF = 512;
/** An effect's recording is decoded whole: only so long, and only so many are kept decoded. */
const MAX_SAMPLE = 12, MAX_SAMPLES = 8;
/** The gains of a soundscape may add up to this much; past it the whole of it is turned down to fit. */
const LOUD = 2;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const list = (v: unknown, max: number): unknown[] => (Array.isArray(v) ? v.slice(0, max) : []);
const num = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const pair = (v: unknown, lo: number, hi: number): [number, number] | undefined => {
  const a = Array.isArray(v) && v.length === 2 ? num(v[0], lo, hi) : undefined, b = a === undefined ? undefined : num((v as unknown[])[1], lo, hi);
  return a === undefined || b === undefined ? undefined : [Math.min(a, b), Math.max(a, b)];
};
const span = (v: unknown, lo: number, hi: number): Span | undefined => (Array.isArray(v) ? pair(v, lo, hi) : num(v, lo, hi));
const top = (s: Span): number => (typeof s === 'number' ? s : s[1]);
/** Copy the keys that were given and understood: what comes out of a parser has no `undefined` in it. */
function some<T extends object>(o: { [K in keyof T]: T[K] | undefined }): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o as T;
}

const fileRef = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= MAX_FILE_REF ? v : undefined);

function parseVoice(raw: unknown, fx: boolean): Voice | null {
  const r = obj(raw), kind = r.kind === 'note' || r.kind === 'burst' ? r.kind : null;
  const freq = span(r.freq, 20, 12000), gain = span(r.gain, 0, 1), dur = span(r.dur, 0.01, fx ? 3 : 8);
  if (!kind || freq === undefined || gain === undefined || dur === undefined) return null;
  const scale = list(r.scale, SOUND_LIMITS.scale).map((n) => num(n, -24, 48)).filter((n): n is number => n !== undefined);
  const on = list(r.on, SOUND_LIMITS.steps).map((n) => (n ? 1 : 0));
  return some<Voice>({
    kind,
    wave: kind === 'note' && WAVES.includes(r.wave as Wave) ? r.wave as Wave : undefined,
    type: kind === 'burst' && PASSES.includes(r.type as Pass) ? r.type as Pass : undefined,
    freq, gain, dur,
    attack: kind === 'note' ? num(r.attack, 0.001, 2) : undefined,
    glide: kind === 'note' ? num(r.glide, 0.05, 20) : undefined,
    glideTo: kind === 'note' ? num(r.glideTo, 20, 12000) : undefined,
    scale: scale.length ? scale : undefined,
    p: fx ? undefined : num(r.p, 0, 1),
    on: !fx && on.length ? on : undefined,
    lp: fx ? undefined : num(r.lp, 50, 12000),
    echo: !fx && r.echo === true ? true : undefined,
    at: fx ? num(r.at, 0, 2000) : undefined,
    vel: fx ? num(r.vel, 0, 1) : undefined,
  });
}

/**
 * Read a soundscape somebody else wrote. Null if it is not one; otherwise only what the engine
 * understands, every number within bounds: gains, pitches, how many layers, drones and timers,
 * and how many sounds a second its patterns may start.
 */
export function parseRecipe(raw: unknown): Scape | null {
  const r = obj(raw), name = typeof r.name === 'string' ? r.name.trim().slice(0, 24) : '';
  if (!name) return null;
  let timers = 0, rate = 0;
  const layers: Layer[] = [], drones: Drone[] = [], patterns: Pattern[] = [];
  for (const l of list(r.layers, SOUND_LIMITS.layers).map(obj)) {
    const gain = num(l.gain, 0, 1), filters: Filter[] = [];
    for (const f of list(l.filters, SOUND_LIMITS.filters).map(obj)) {
      const freq = num(f.freq, 20, 12000);
      if (PASSES.includes(f.type as Pass) && freq !== undefined) filters.push(some<Filter>({ type: f.type as Pass, freq, q: num(f.q, 0.1, 8) }));
    }
    if (gain === undefined) continue;
    const m = obj(l.mod), every = num(m.every, 200, 60000), mf = pair(m.freq, 20, 12000), mg = pair(m.gain, 0, 1);
    const mod = every !== undefined && (mf || mg) && timers < SOUND_LIMITS.timers ? some<NonNullable<Layer['mod']>>({ every, freq: mf, gain: mg }) : undefined;
    if (mod) timers++;
    layers.push(some<Layer>({ filters, gain, mod }));
  }
  for (const d of list(r.drones, SOUND_LIMITS.drones).map(obj)) {
    const freq = num(d.freq, 20, 2000), gain = num(d.gain, 0, 0.5);
    if (WAVES.includes(d.wave as Wave) && freq !== undefined && gain !== undefined) drones.push(some<Drone>({ wave: d.wave as Wave, freq, gain, lp: num(d.lp, 50, 12000) }));
  }
  for (const p of list(r.patterns, SOUND_LIMITS.patterns).map(obj)) {
    const every = num(p.every, 60, 60000), voices = list(p.voices, SOUND_LIMITS.voices).map((v) => parseVoice(v, false)).filter((v): v is Voice => !!v);
    if (every === undefined || !voices.length || timers >= SOUND_LIMITS.timers) continue;
    const adds = voices.reduce((n, v) => n + (v.p ?? 1), 0) * 1000 / every;
    if (rate + adds > SOUND_LIMITS.perSecond) continue; // too busy for a phone: left out
    rate += adds;
    timers++;
    patterns.push({ every, voices });
  }
  const e = obj(r.echo), echo = r.echo === undefined ? undefined : { time: num(e.time, 0.05, 1) ?? 0.34, feedback: num(e.feedback, 0, 0.7) ?? 0.38, mix: num(e.mix, 0, 1) ?? 0.5 };
  const file = fileRef(r.file);
  if (!layers.length && !drones.length && !patterns.length && !file) return null;
  return some<Scape>({
    name, layers: layers.length ? layers : undefined, drones: drones.length ? drones : undefined, patterns: patterns.length ? patterns : undefined, echo,
    file, loop: file && typeof r.loop === 'boolean' ? r.loop : undefined, gain: file ? num(r.gain, 0, 1) : undefined,
  });
}

/** Read a one-shot effect (a dice clack, a ping, an emote's sting) somebody else wrote. Null if it is not one. */
export function parseEffect(raw: unknown): Effect | null {
  const r = obj(raw), file = fileRef(r.file);
  const voices = list(r.voices, SOUND_LIMITS.voices).map((v) => parseVoice(v, true)).filter((v): v is Voice => !!v);
  return voices.length || file ? some<Effect>({ voices, file, gain: file ? num(r.gain, 0, 1) : undefined }) : null;
}

/** Read a set of recipes (`{ scapes: { id: recipe }, effects: { name: recipe } }`), such as a theme brings. Undefined if there is nothing in it. */
export function parseSounds(raw: unknown, maxScapes = 4, maxEffects = 12): SoundBank | undefined {
  const each = <T>(from: unknown, max: number, parse: (v: unknown) => T | null): Record<string, T> | undefined => {
    const out: Record<string, T> = {};
    for (const [id, v] of Object.entries(obj(from))) {
      const got = ID.test(id) && id !== 'off' && Object.keys(out).length < max ? parse(v) : null;
      if (got) out[id] = got;
    }
    return Object.keys(out).length ? out : undefined;
  };
  const bank = some<SoundBank>({ scapes: each(obj(raw).scapes, maxScapes, parseRecipe), effects: each(obj(raw).effects, maxEffects, parseEffect) });
  return bank.scapes || bank.effects ? bank : undefined;
}

/**
 * The soundscapes this device has loaded, id → name: what "is this soundscape known" is asked of
 * (`id in SOUNDSCAPES`), and what the picker lists. Silence is always there; the rest arrive with `addSounds`.
 */
export const SOUNDSCAPES: Record<string, string> = { off: '🔇 Silence' };
const SCAPES: Record<string, Scape> = {}, EFFECTS: Record<string, Effect> = {};
/** Offer these recipes on this device (see `loadSounds`). */
export function addSounds(bank: SoundBank): void {
  for (const [id, s] of Object.entries(bank.scapes ?? {})) { SCAPES[id] = s; SOUNDSCAPES[id] = s.name; }
  Object.assign(EFFECTS, bank.effects);
}

/** The recipes on offer: `<dir>/index.json` lists the soundscapes, one file each; `<dir>/effects.json` holds the effects. A missing or broken one is skipped. */
export async function loadSounds(dir: string, get: (url: string) => Promise<unknown> = async (url) => (await fetch(url)).json()): Promise<SoundBank> {
  const [names, effects] = await Promise.all([get(`${dir}/index.json`).catch(() => null), get(`${dir}/effects.json`).catch(() => null)]);
  const files = (Array.isArray(names) ? names : []).filter((n): n is string => typeof n === 'string' && /^[a-z0-9_-]+$/.test(n)).slice(0, 64);
  const scapes: Record<string, unknown> = {};
  await Promise.all(files.map(async (n) => { scapes[n] = await get(`${dir}/${n}.json`).catch(() => null); }));
  return parseSounds({ scapes: Object.fromEntries(files.map((n) => [n, scapes[n]])), effects }, 64, 64) ?? {};
}

// ---- the engine ----------------------------------------------------------------------------

type Stop = () => void;
/** Turns a recording's reference into a URL an audio element can play (an object URL), or null if it cannot be had. Whoever makes the URL revokes it. */
export type Resolver = (ref: string) => Promise<string | null>;
const pick = (s: Span): number => (typeof s === 'number' ? s : s[0] + Math.random() * (s[1] - s[0]));

export class Sound {
  enabled = true;
  /**
   * How recordings are fetched (`Scape.file`). Nothing here knows where files live: the app sets this
   * once it has a file store. Until then a soundscape's recording is silently left out.
   */
  resolver?: Resolver;
  /** Told when the engine is done with a URL the resolver gave it, once for every URL it was given. */
  release?: (ref: string) => void;
  /** The soundscape now sounding ('off' when silent, whatever the table asked for; 'trial' while one is being tried out here). */
  playing = 'off';
  /** How the recording of the soundscape now sounding is doing: there is none, it is being fetched, it plays, or it cannot be had (it is tried again). */
  recording: 'none' | 'loading' | 'playing' | 'failed' = 'none';
  /** Called when `playing` or `recording` changed. */
  onState?: () => void;
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private want = 'off';
  private recipe?: Scape;
  private own: SoundBank = {};
  private ownKey = '';
  private tab: SoundBank = {};
  private trial?: Scape;
  private hidden = false;
  private samples = new Map<string, AudioBuffer | Promise<AudioBuffer | null>>();
  private missed = new Map<string, number>();
  private stop: Stop = () => {};
  private live = 0;
  /** How many effects this device has sounded (for tests and the curious). */
  effects = 0;
  // Two audio elements for recordings, so one can fade out while the next fades in. Made on the first tap (iOS only lets a tapped element play).
  private els: { el: HTMLAudioElement; node?: MediaElementAudioSourceNode; turn: number; wanted: boolean }[] = [];
  private elTurn = 0;

  /** Browsers only allow audio after a tap: call this from the first one. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      if (typeof Audio !== 'undefined') for (let i = 0; i < 2; i++) { const el = new Audio(); el.preload = 'auto'; el.load(); this.els.push({ el, turn: 0, wanted: false }); }
      // The system may stop and restart audio on its own (a phone call, the lock screen): follow it.
      this.ctx.onstatechange = () => this.apply();
    }
    if (this.hidden) return;
    for (const e of this.els) if (e.wanted && e.el.paused) void e.el.play().catch(() => {}); // a recording that was refused without a tap
    void this.ctx.resume().then(() => this.apply());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.unlock();
    else this.apply();
  }

  /** Switch the table's soundscape (cross-fades). One this device has no recipe for is silence. */
  scape(id: string): void {
    this.want = id;
    this.apply();
  }

  /** The recipes the table's theme brings: they come before the loaded ones of the same name. Null when it brings none. */
  theme(bank: SoundBank | null | undefined): void {
    const key = bank ? JSON.stringify(bank) : '';
    if (key === this.ownKey) return;
    this.ownKey = key;
    this.own = bank ?? {};
    this.apply();
  }

  /**
   * The table's own recipes (the GM's recordings and mixes): they come before the theme's and the loaded ones.
   * Compared by identity: hand in the same object until something in it changed.
   */
  table(bank: SoundBank | null | undefined): void {
    if ((bank ?? this.tab) === this.tab) return;
    this.tab = bank ?? {};
    this.apply();
  }

  /** Try a soundscape out on this device only, whatever the table is playing; null goes back to the table's. */
  audition(r: Scape | null): void {
    this.trial = r ?? undefined;
    this.apply();
  }
  /** Is this the soundscape being tried out? */
  auditioning(r: Scape): boolean { return this.trial === r; }

  /** More recipes have loaded (`addSounds`): start what the table was waiting to hear. */
  refresh(): void { this.apply(); }

  /** Whether there is a recipe for this soundscape, the theme's or a loaded one. */
  knows(id: string): boolean { return id === 'off' || !!this.find(id); }
  private find(id: string): Scape | undefined { return this.tab.scapes?.[id] ?? this.own.scapes?.[id] ?? SCAPES[id]; }

  /** The phone went to sleep or the tab was hidden: stop making noise. */
  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    this.hidden = hidden;
    if (hidden) { void this.ctx.suspend(); for (const e of this.els) e.el.pause(); }
    else if (this.enabled) { void this.ctx.resume().then(() => this.apply()); for (const e of this.els) if (e.wanted) void e.el.play().catch(() => {}); }
  }

  private apply(): void {
    const recipe = this.ready() ? this.trial ?? (this.want !== 'off' ? this.find(this.want) : undefined) : undefined;
    if (this.ready()) this.warm();
    if (recipe === this.recipe) return;
    this.stop();
    this.stop = () => {};
    this.recipe = recipe;
    this.playing = recipe ? (recipe === this.trial ? 'trial' : this.want) : 'off';
    this.recording = recipe?.file && this.resolver ? 'loading' : 'none';
    // A soundscape the GM started is the game's own audio: an iPhone's silent switch should not mute it.
    // (Without one, the odd clack stays "ambient": muted by the switch, and no interruption to the owner's music.)
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = recipe ? 'playback' : 'auto';
    } catch { /* not every browser has it, or lets it be set */ }
    if (recipe) this.stop = this.start(recipe);
    this.onState?.();
  }
  private state(s: Sound['recording']): void {
    if (s === this.recording) return;
    this.recording = s;
    this.onState?.();
  }

  // ---- building blocks ----

  private src(loop = true): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise!;
    s.loop = loop;
    return s;
  }
  private filter(type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }
  private gain(v: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = v;
    return g;
  }
  private chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }
  /** Only so many sounds at once, whatever a recipe asks for. */
  private room(s: AudioScheduledSourceNode): boolean {
    if (this.live >= SOUND_LIMITS.live) return false;
    this.live++;
    s.onended = () => { this.live--; };
    return true;
  }
  /** A short note with a soft attack and an exponential tail. */
  private note(out: AudioNode, type: OscillatorType, freq: number, vol: number, dur: number, attack = 0.01, glideTo?: number): void {
    const c = this.ctx!, t = c.currentTime, o = c.createOscillator(), g = this.gain(0);
    if (!this.room(o)) return;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.chain(o, g, out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  /** A burst of filtered noise: crackles, snares, dice. */
  private burst(out: AudioNode, freq: number, vol: number, dur: number, type: BiquadFilterType = 'highpass'): void {
    const c = this.ctx!, t = c.currentTime, s = this.src(false), g = this.gain(vol);
    if (!this.room(s)) return;
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.chain(s, this.filter(type, freq, 1), g, out);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }
  /** Sound one voice of a recipe. `strength` (0..1) is how hard the knock was, for voices that care; `level` turns it down. */
  private voice(out: AudioNode, v: Voice, strength = 0, level = 1): void {
    const hz = (f: number) => Math.min(12000, Math.max(20, f));
    const base = pick(v.freq), freq = hz(v.scale ? base * 2 ** (v.scale[Math.floor(Math.random() * v.scale.length)] / 12) : base);
    const vol = Math.min(1, pick(v.gain) + (v.vel ?? 0) * strength) * level, dur = pick(v.dur);
    if (vol < 0.0002) return;
    if (v.kind === 'burst') this.burst(out, freq, vol, dur, v.type);
    else this.note(out, v.wave ?? 'sine', freq, vol, dur, Math.min(v.attack ?? 0.01, dur), v.glideTo ?? (v.glide ? hz(freq * v.glide) : undefined));
  }

  /** Play a soundscape's recipe until the returned function is called. */
  private start(r: Scape): Stop {
    const c = this.ctx!, bus = this.gain(0), timers: ReturnType<typeof setInterval>[] = [], nodes: AudioScheduledSourceNode[] = [];
    // However many layers a recipe piles up, together they are no louder than a soundscape should be.
    const sum = (r.layers ?? []).reduce((n, l) => n + Math.max(l.gain, l.mod?.gain?.[1] ?? 0), 0) + (r.drones ?? []).reduce((n, d) => n + d.gain, 0)
      + (r.patterns ?? []).reduce((n, p) => n + p.voices.reduce((m, v) => m + top(v.gain), 0), 0) + (r.file ? r.gain ?? 1 : 0);
    bus.connect(this.master!);
    bus.gain.linearRampToValueAtTime(Math.min(1, LOUD / Math.max(sum, 0.001)), c.currentTime + 1.2);
    const every = (ms: number, fn: () => void) => { if (timers.length < SOUND_LIMITS.timers) timers.push(setInterval(fn, ms)); };
    // A feedback delay gives the sparse sounds some room.
    const echo = c.createDelay(1);
    echo.delayTime.value = r.echo?.time ?? 0.34;
    const fb = this.gain(r.echo?.feedback ?? 0.38);
    this.chain(echo, fb, echo);
    this.chain(echo, this.gain(r.echo?.mix ?? 0.5), bus);
    const wet = this.gain(1);
    wet.connect(bus);
    wet.connect(echo);

    for (const l of r.layers ?? []) {
      const s = this.src(), filters = l.filters.map((f) => this.filter(f.type, f.freq, f.q)), g = this.gain(l.gain), mod = l.mod;
      this.chain(s, ...filters, g, bus);
      s.start(0, Math.random());
      nodes.push(s);
      if (mod) every(mod.every, () => {
        const t = c.currentTime + mod.every / 1000;
        if (mod.freq && filters[0]) filters[0].frequency.linearRampToValueAtTime(pick(mod.freq), t);
        if (mod.gain) g.gain.linearRampToValueAtTime(pick(mod.gain), t);
      });
    }
    for (const d of r.drones ?? []) {
      const o = c.createOscillator();
      o.type = d.wave;
      o.frequency.value = d.freq;
      this.chain(o, this.filter('lowpass', d.lp ?? 400), this.gain(d.gain), bus);
      o.start();
      nodes.push(o);
    }
    for (const p of r.patterns ?? []) {
      // Where each voice plays into is set up once; a beat only starts the sounds themselves.
      const outs = p.voices.map((v) => {
        const to = v.echo ? wet : bus;
        if (!v.lp) return to;
        const lp = this.filter('lowpass', v.lp);
        lp.connect(to);
        return lp;
      });
      let step = 0;
      every(p.every, () => {
        const i = step++;
        p.voices.forEach((v, k) => {
          if (v.on && !v.on[i % v.on.length]) return;
          if (v.p !== undefined && Math.random() >= v.p) return;
          this.voice(outs[k], v);
        });
      });
    }
    const quiet = r.file && this.resolver ? this.record(r, bus) : () => {};
    return () => {
      for (const t of timers) clearInterval(t);
      const end = c.currentTime + 0.9;
      bus.gain.cancelScheduledValues(c.currentTime);
      bus.gain.setValueAtTime(bus.gain.value, c.currentTime);
      bus.gain.linearRampToValueAtTime(0, end);
      for (const n of nodes) n.stop(end + 0.05);
      quiet();
      setTimeout(() => bus.disconnect(), 1200);
    };
  }

  /**
   * Play a soundscape's recording into `bus`. A short loop is decoded whole so it repeats without a gap;
   * anything longer is streamed through an audio element, never decoded into memory. Until the file is
   * here there is silence; it fades in when it starts, and one that cannot be had yet is asked for again.
   */
  private record(r: Scape, bus: AudioNode): Stop {
    const c = this.ctx!, out = this.gain(0), loop = r.loop !== false, turn = ++this.elTurn, file = r.file!;
    let dead = false, held = 0, decoded: AudioBufferSourceNode | undefined, slot: Sound['els'][number] | undefined, again: ReturnType<typeof setTimeout> | undefined;
    out.connect(bus);
    const mine = () => !dead && this.recipe === r;
    const sounding = () => {
      out.gain.setValueAtTime(0, c.currentTime);
      out.gain.linearRampToValueAtTime(r.gain ?? 1, c.currentTime + 1.2);
      if (mine()) this.state('playing');
    };
    const letGo = () => { for (; held > 0; held--) this.release?.(file); };
    const attempt = async (n: number): Promise<void> => {
      const url = await this.resolver!(file).catch(() => null);
      if (url) held++;
      if (dead) { letGo(); return; }
      if (!url) {
        // Not to be had right now (the GM's phone is asleep, a server is slow): keep the silence and ask again.
        this.state('failed');
        again = setTimeout(() => { if (mine()) this.state('loading'); void attempt(n + 1); }, Math.min(60, 4 * 2 ** n) * 1000);
        return;
      }
      // The element that is free, else the one that has been playing longest (it is fading out by now).
      const s = this.els.find((e) => !e.wanted) ?? [...this.els].sort((x, y) => x.turn - y.turn)[0];
      if (!s) return;
      const el = s.el;
      s.turn = turn;
      s.wanted = true;
      slot = s;
      el.loop = loop;
      el.src = url;
      await new Promise<void>((ok, no) => { el.onloadedmetadata = () => ok(); el.onerror = () => no(new Error('unreadable')); });
      if (dead || s.turn !== turn) return;
      if (loop && el.duration <= SHORT_LOOP) {
        try {
          const buffer = await c.decodeAudioData(await (await fetch(url)).arrayBuffer());
          if (dead) return;
          s.wanted = false; // the element is not needed after all
          slot = undefined;
          el.removeAttribute('src');
          el.load();
          decoded = c.createBufferSource();
          decoded.buffer = buffer;
          decoded.loop = true;
          decoded.connect(out);
          decoded.start();
          sounding();
          return;
        } catch { /* stream it instead */ }
      }
      if (dead || s.turn !== turn) return;
      s.node ??= c.createMediaElementSource(el);
      s.node.disconnect();
      s.node.connect(out);
      el.onplaying = () => { el.onplaying = null; if (!dead && s.turn === turn) sounding(); };
      if (!this.hidden) await el.play(); // refused without a tap on some phones: the next tap starts it (see unlock)
    };
    void attempt(0).catch(() => { if (mine()) this.state('failed'); });
    return () => {
      dead = true;
      clearTimeout(again);
      setTimeout(() => {
        try { decoded?.stop(); } catch { /* never started */ }
        out.disconnect();
        if (slot && slot.turn === turn) { // (else another recording has the element now)
          slot.wanted = false;
          slot.el.onplaying = null;
          slot.el.pause();
          slot.el.removeAttribute('src');
          slot.el.load();
        }
        letGo();
      }, 1000);
    };
  }

  // ---- one-shot effects ----

  private ready(): boolean { return this.enabled && this.ctx?.state === 'running'; }
  /** Play a named effect's recipe (the table's, else the theme's, else a loaded one). `strength` 0..1 is how hard the knock was. True if there is one. */
  effect(name: string, strength = 0): boolean {
    const fx = this.tab.effects?.[name] ?? this.own.effects?.[name] ?? EFFECTS[name];
    if (!fx) return false;
    this.tryEffect(fx, strength);
    return true;
  }
  /** Play an effect's recipe on this device, whether or not it has a name. */
  tryEffect(fx: Effect, strength = 0): void {
    if (!this.ready()) return;
    if (fx.file) {
      const at = Date.now(), had = this.samples.get(fx.file);
      const play = (b: AudioBuffer | null) => {
        if (!b || !this.ready() || Date.now() - at > 2500) return; // an effect that arrives late is not played late
        const s = this.ctx!.createBufferSource();
        if (!this.room(s)) return;
        s.buffer = b;
        this.chain(s, this.gain((fx.gain ?? 1) * (strength > 0 ? 0.4 + 0.6 * Math.min(1, strength) : 1)), this.master!);
        s.start();
        this.effects++;
      };
      if (had instanceof AudioBuffer) play(had); else void this.sample(fx.file, true).then(play);
    }
    if (!fx.voices.length) return;
    this.effects++;
    const sum = fx.voices.reduce((n, v) => n + top(v.gain) + (v.vel ?? 0), 0), level = Math.min(1, LOUD / Math.max(sum, 0.001));
    for (const v of fx.voices) {
      if (v.at) setTimeout(() => this.ready() && this.voice(this.master!, v, strength, level), v.at);
      else this.voice(this.master!, v, strength, level);
    }
  }
  /** An effect's recording, decoded (they are short). Asked for once; one that cannot be had is asked for again later. */
  private sample(file: string, now = false): Promise<AudioBuffer | null> {
    const had = this.samples.get(file);
    if (had) return Promise.resolve(had);
    if (!this.resolver || (!now && Date.now() - (this.missed.get(file) ?? -Infinity) < 30_000)) return Promise.resolve(null);
    const job = (async () => {
      const url = await this.resolver!(file).catch(() => null);
      if (!url) return null;
      try {
        const b = await this.ctx!.decodeAudioData(await (await fetch(url)).arrayBuffer());
        return b.duration <= MAX_SAMPLE ? b : null;
      } catch { return null; } finally { this.release?.(file); }
    })();
    this.samples.set(file, job);
    return job.then((b) => {
      if (this.samples.get(file) === job) { if (b) this.samples.set(file, b); else this.samples.delete(file); }
      if (b) this.missed.delete(file); else this.missed.set(file, Date.now());
      while (this.samples.size > MAX_SAMPLES) this.samples.delete(this.samples.keys().next().value!);
      return b;
    });
  }
  /** Fetch the recordings of the table's and the theme's effects ahead of time, so the first clack is on time. Only ever with sound on. */
  private warm(): void {
    let n = 0;
    for (const bank of [this.tab, this.own]) for (const fx of Object.values(bank.effects ?? {})) if (fx.file && n++ < MAX_SAMPLES) void this.sample(fx.file);
  }
  /** A die knocking on the table. */
  clack(strength: number): void { this.effect('clack', strength); }
  private roll?: { g: GainNode; s: AudioBufferSourceNode };
  /** A boulder rolling: a low growl that follows how fast it goes (0 lets it die away). */
  rumble(level: number): void {
    if (!this.roll && (!level || !this.ready())) return;
    const t = this.ctx!.currentTime;
    if (!this.ready()) level = 0; // sound was switched off mid-roll
    if (!this.roll) {
      const s = this.src(), g = this.gain(0);
      this.chain(s, this.filter('lowpass', 110, 1.2), g, this.master!);
      s.start(0, Math.random());
      this.roll = { g, s };
    }
    this.roll.g.gain.setTargetAtTime(level * 1.6, t, 0.08);
    if (!level) { this.roll.s.stop(t + 0.6); this.roll = undefined; }
  }
  /** Something heavy coming down. */
  thud(strength: number): void {
    if (!this.ready()) return;
    this.note(this.master!, 'sine', 90, 0.25 + strength * 0.5, 0.28, 0.004, 34);
    this.burst(this.master!, 240, 0.2 + strength * 0.4, 0.12, 'lowpass');
  }
  /** A mini set down on the table: a soft knock of plastic on wood (the effect recipe is still called `thud`). */
  knock(): void { this.effect('thud'); }
  ping(): void { this.effect('ping'); }
  /** Something on the table breaks: wood cracks and splinters, stone thuds and rattles down. */
  crumble(wood: boolean): void {
    if (!this.ready()) return;
    const m = this.master!;
    this.note(m, 'sine', wood ? 190 : 110, 0.5, wood ? 0.12 : 0.28, 0.004, wood ? 70 : 38);
    this.burst(m, wood ? 1900 : 420, 0.4, wood ? 0.09 : 0.3, wood ? 'bandpass' : 'lowpass');
    // The pieces coming down after it, each a little quieter.
    for (let i = 1; i <= (wood ? 3 : 6); i++) {
      setTimeout(() => this.ready() && this.burst(m, (wood ? 2400 : 900) + Math.random() * 1600, 0.2 / i + 0.03, 0.04 + Math.random() * 0.05, 'bandpass'), 60 + i * (wood ? 55 : 85) + Math.random() * 40);
    }
  }
  /** Something let fly (a whoosh, a twang, a hum), or landing (`hit`: a thud, a crackle, a chime). */
  shot(kind: string, hit: boolean): void {
    if (!this.ready()) return;
    const m = this.master!;
    if (kind === 'fire') {
      this.burst(m, hit ? 500 : 900, hit ? 0.4 : 0.22, hit ? 0.35 : 0.3, 'lowpass');
      if (hit) this.note(m, 'sine', 110, 0.3, 0.25, 0.004, 45);
    } else if (kind === 'missile') {
      if (hit) [988, 1319].forEach((f) => this.note(m, 'triangle', f, 0.1, 0.3));
      else this.note(m, 'sine', 420, 0.1, 0.4, 0.05, 1260);
    } else if (kind === 'frost') {
      if (hit) { this.burst(m, 5200, 0.2, 0.12); this.note(m, 'sine', 2100, 0.08, 0.3, 0.004, 1500); }
      else this.note(m, 'sine', 1900, 0.07, 0.25, 0.02, 950);
    } else if (hit) { // arrows and rocks: a knock, lower the heavier it is
      this.note(m, 'sine', kind === 'rock' ? 120 : 190, kind === 'rock' ? 0.45 : 0.3, 0.14, 0.004, 48);
      this.burst(m, kind === 'rock' ? 500 : 1500, 0.2, 0.06, 'bandpass');
    } else {
      this.burst(m, kind === 'rock' ? 500 : 1700, 0.14, kind === 'rock' ? 0.3 : 0.16, 'bandpass');
      if (kind === 'arrow') this.note(m, 'triangle', 240, 0.12, 0.09, 0.003, 150); // the string
    }
  }
  /** A little sting for an emote: its own (`emote:<kind>`), else the one for any emote (`emote`). */
  emote(kind: string): void { if (!this.effect(`emote:${kind}`)) this.effect('emote'); }
}
