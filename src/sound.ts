// Sound, all synthesised in the browser: no audio files to download.
// Soundscapes are chosen by the GM for the whole table; each device decides
// whether it wants to hear anything at all.

export const SOUNDSCAPES: Record<string, string> = {
  off: '🔇 Silence', rain: '🌧️ Rain', wind: '🌬️ Wind', fire: '🔥 Campfire', cave: '💧 Cave', calm: '🎵 Calm', battle: '🥁 Battle',
};

type Stop = () => void;

export class Sound {
  enabled = true;
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private want = 'off';
  private playing = 'off';
  private stop: Stop = () => {};

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
    }
    void this.ctx.resume().then(() => this.apply());
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.unlock();
    else this.apply();
  }

  /** Switch the table's soundscape (cross-fades). */
  scape(id: string): void {
    this.want = SOUNDSCAPES[id] ? id : 'off';
    this.apply();
  }

  /** The phone went to sleep or the tab was hidden: stop making noise. */
  suspend(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else if (this.enabled) void this.ctx.resume();
  }

  private apply(): void {
    const next = this.enabled && this.ctx?.state === 'running' ? this.want : 'off';
    if (next === this.playing) return;
    this.stop();
    this.stop = () => {};
    this.playing = next;
    if (next !== 'off') this.stop = this.start(next);
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
  /** A short note with a soft attack and an exponential tail. */
  private note(out: AudioNode, type: OscillatorType, freq: number, vol: number, dur: number, attack = 0.01, glideTo?: number): void {
    const c = this.ctx!, t = c.currentTime, o = c.createOscillator(), g = this.gain(0);
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
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.chain(s, this.filter(type, freq, 1), g, out);
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }

  private start(id: string): Stop {
    const c = this.ctx!, bus = this.gain(0), timers: ReturnType<typeof setInterval>[] = [], nodes: AudioScheduledSourceNode[] = [];
    bus.connect(this.master!);
    bus.gain.linearRampToValueAtTime(1, c.currentTime + 1.2);
    const loop = (...n: AudioNode[]) => { const s = this.src(); this.chain(s, ...n, bus); s.start(0, Math.random()); nodes.push(s); };
    const drone = (type: OscillatorType, f: number, v: number, lp = 400) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      this.chain(o, this.filter('lowpass', lp), this.gain(v), bus);
      o.start();
      nodes.push(o);
    };
    const every = (ms: number, fn: () => void) => timers.push(setInterval(fn, ms));
    // A feedback delay gives the sparse sounds some room.
    const echo = c.createDelay(1);
    echo.delayTime.value = 0.34;
    const fb = this.gain(0.38);
    this.chain(echo, fb, echo);
    this.chain(echo, this.gain(0.5), bus);
    const wet = this.gain(1);
    wet.connect(bus);
    wet.connect(echo);

    switch (id) {
      case 'rain':
        loop(this.filter('highpass', 600), this.filter('lowpass', 7000), this.gain(0.22));
        loop(this.filter('lowpass', 260), this.gain(0.3));
        break;
      case 'wind': {
        const band = this.filter('bandpass', 420, 1.4), g = this.gain(0.4);
        loop(band, g);
        every(900, () => {
          const t = c.currentTime;
          band.frequency.linearRampToValueAtTime(260 + Math.random() * 700, t + 0.9);
          g.gain.linearRampToValueAtTime(0.2 + Math.random() * 0.45, t + 0.9);
        });
        break;
      }
      case 'fire':
        loop(this.filter('lowpass', 320), this.gain(0.4));
        every(110, () => { if (Math.random() < 0.45) this.burst(bus, 1400 + Math.random() * 2500, 0.05 + Math.random() * 0.14, 0.03 + Math.random() * 0.05); });
        break;
      case 'cave':
        drone('sine', 55, 0.12);
        loop(this.filter('bandpass', 180, 2), this.gain(0.12));
        every(700, () => { if (Math.random() < 0.4) { const f = 900 + Math.random() * 900; this.note(wet, 'sine', f, 0.12, 0.16, 0.005, f * 0.6); } });
        break;
      case 'calm': {
        const scale = [0, 2, 4, 7, 9, 12, 14, 16], lp = this.filter('lowpass', 1400);
        lp.connect(wet);
        drone('sine', 110, 0.06);
        every(1900, () => {
          const n = scale[Math.floor(Math.random() * scale.length)];
          this.note(lp, 'triangle', 220 * 2 ** (n / 12), 0.11, 3.2, 0.5);
          if (Math.random() < 0.4) this.note(lp, 'sine', 110 * 2 ** (scale[Math.floor(Math.random() * 5)] / 12), 0.09, 4, 0.8);
        });
        break;
      }
      case 'battle': {
        const kick = [1, 0, 0, 1, 0, 1, 0, 0], snare = [0, 0, 1, 0, 0, 0, 1, 0], minor = [0, 3, 5, 7, 10, 12];
        const lp = this.filter('lowpass', 1000);
        lp.connect(wet);
        drone('sawtooth', 73.4, 0.07, 260);
        let step = 0;
        every(210, () => {
          const i = step++ % 8;
          if (kick[i]) this.note(bus, 'sine', 130, 0.55, 0.16, 0.004, 42);
          if (snare[i]) this.burst(bus, 1800, 0.18, 0.09);
          if (i % 2 === 0 && Math.random() < 0.45) this.note(lp, 'square', 146.8 * 2 ** (minor[Math.floor(Math.random() * minor.length)] / 12), 0.045, 0.14);
        });
        break;
      }
    }
    return () => {
      for (const t of timers) clearInterval(t);
      const end = c.currentTime + 0.9;
      bus.gain.cancelScheduledValues(c.currentTime);
      bus.gain.setValueAtTime(bus.gain.value, c.currentTime);
      bus.gain.linearRampToValueAtTime(0, end);
      for (const n of nodes) n.stop(end + 0.05);
      setTimeout(() => bus.disconnect(), 1200);
    };
  }

  // ---- one-shot effects ----

  private ready(): boolean { return this.enabled && this.ctx?.state === 'running'; }
  /** A die knocking on the table. */
  clack(strength: number): void {
    if (this.ready()) this.burst(this.master!, 2200 + Math.random() * 1500, 0.1 + strength * 0.35, 0.035, 'bandpass');
  }
  ping(): void {
    if (this.ready()) this.note(this.master!, 'sine', 880, 0.18, 0.5, 0.005, 1320);
  }
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
  /** A little sting for an emote. */
  emote(kind: string): void {
    if (!this.ready()) return;
    const m = this.master!;
    if (kind === 'attack') this.burst(m, 3000, 0.25, 0.12);
    else if (kind === 'hurt') this.note(m, 'sawtooth', 220, 0.14, 0.22, 0.005, 90);
    else if (kind === 'cheer') [523, 659, 784].forEach((f, i) => setTimeout(() => this.ready() && this.note(m, 'triangle', f, 0.14, 0.25), i * 90));
    else this.note(m, 'sine', kind === 'think' ? 520 : 700, 0.1, 0.25, 0.01, kind === 'think' ? 780 : 560);
  }
}
