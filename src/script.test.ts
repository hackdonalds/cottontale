// The box scripts run in, tried directly under node (the worker around it is tried in e2e).
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import KNOCKS from '../public/systems/hard-knocks.json';
import { CALL_MS, makeRunner, PER_MINUTE, scriptsHash, STRIKES } from './script';
import { checkScript, LIMITS, runScript, seeded } from './scriptbox';
import { fire, parseEdits, parseSystem, runEdits, scriptCtx, type GameEvent } from './system';

let qjs: QuickJSWASMModule;
beforeAll(async () => { qjs = await newQuickJSWASMModuleFromVariant(variant); });
const ctx = { on: 'turn.start', event: 'e1', self: { id: 'a', name: 'Moss', stats: { hp: 3, grit: 2 }, conds: ['bleeding'] } };
// (Patient by default: these tests are about what a script may do, and the machine running them may be busy.)
const PATIENT = { ...LIMITS, cpuMs: 20_000 };
const run = (source: string, seed = 7, lim = PATIENT) => runScript(qjs, source, ctx, seed, lim);
const says = (source: string) => { const r = run(`return [{ say: String(${source}) }];`); return r.error ?? (r.edits[0] as { say: string }).say; };

describe('a script in its box', () => {
  it('reads the snapshot and hands back edits', () => {
    const r = run('return [{ stat: "hp", op: "add", value: -ctx.self.stats.grit }, { say: ctx.self.name + " on " + ctx.on }];');
    expect(r).toEqual({ edits: [{ stat: 'hp', op: 'add', value: -2 }, { say: 'Moss on turn.start' }], rolls: [], logs: [] });
    expect(parseEdits(r.edits)).toHaveLength(2);
    expect(run('').edits).toEqual([]); // nothing to do is not an error
    expect(run('').error).toBeUndefined();
  });
  it('may be written as a module with one exported function and helpers around it', () => {
    const r = run('const T = [0, 10, 20];\nfunction pick(n) { return T[n]; }\nexport default function (ctx, roll, log) {\n  log("hello");\n  return [{ say: "t" + pick(2) + ctx.self.stats.hp }];\n}\nconst after = 1;');
    expect(r).toEqual({ edits: [{ say: 't203' }], rolls: [], logs: ['hello'] });
  });
  it('computes freely: loops, tables, closures, maps', () => {
    expect(says('[3, 1, 2].sort().map((x) => x * 2).join("") + new Map([[1, "m"]]).get(1) + JSON.stringify({ a: 1 }) + 2 ** 10 + (ctx?.self?.stats?.nope ?? "?")')).toBe('246m{"a":1}1024?');
    expect(says('(() => { let n = 0; for (let i = 0; i < 1000; i++) n += i; return n; })()')).toBe('499500');
  });
  it('sees nothing of the app, the network, storage or time', () => {
    for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'self', 'window', 'document', 'process', 'require', 'module', 'localStorage', 'indexedDB', 'crypto', 'navigator',
      'postMessage', 'setTimeout', 'setInterval', 'queueMicrotask', 'console', 'Date', 'performance', 'Promise', 'eval', 'WebAssembly', 'Worker', 'SharedArrayBuffer', 'Atomics', 'Proxy', 'os', 'std']) {
      expect(says(`typeof ${name}`), name).toBe('undefined');
      expect(says(`typeof globalThis[${JSON.stringify(name)}]`), name).toBe('undefined');
    }
    // Code made from text is still code inside the same box.
    expect(says('(function () {}).constructor("return typeof fetch + (this === globalThis)")()')).toBe('undefinedtrue');
    expect(says('Object.getOwnPropertyNames(globalThis).filter((k) => /fetch|socket|http|import|storage|worker|process/i.test(k)).length')).toMatch(/RegExp are not supported/);
    expect(says('Object.getOwnPropertyNames(globalThis).join()')).toBe('Error,EvalError,RangeError,ReferenceError,SyntaxError,TypeError,URIError,InternalError,AggregateError,Array,Object,Function,Iterator,parseInt,parseFloat,isNaN,isFinite,decodeURI,decodeURIComponent,encodeURI,encodeURIComponent,escape,unescape,Infinity,NaN,undefined,Number,Boolean,String,Math,Reflect,Symbol,globalThis,BigInt,JSON,Map,Set,WeakMap,WeakSet');
    expect(run('return [{ say: String(Math.random()) }];').error).toMatch(/use roll/);
    // Only data crosses: the two functions it is given are not doors to ours.
    expect(says('[typeof roll, typeof log, Object.keys(roll).length, roll.constructor === Function, roll.constructor("return this")() === globalThis].join()')).toBe('function,function,0,true,true');
  });
  it('gets a snapshot it cannot change, and nothing is left for the next call', () => {
    expect(run('ctx.self.stats.hp = 99; return [];').error).toMatch(/read-only/);
    expect(run('ctx.extra = 1; return [];').error).toMatch(/TypeError/);
    expect(run('globalThis.left = 1; Object.prototype.left = 1; Array.prototype.push = null; return [{ say: "x" }];').edits).toHaveLength(1);
    expect(says('typeof left + typeof [].push')).toBe('undefinedfunction');
  });
  it('is interrupted when it will not stop', () => {
    for (const source of ['while (true) {}', 'for (;;) { ctx.self.stats.hp + 1; }', '}); while (true) {} (function () {', 'export default (function () { while (true) {} })();', 'return { toJSON() { while (true) {} } };']) {
      const t0 = Date.now(), r = run(source, 7, LIMITS);
      expect(r, source).toMatchObject({ edits: [], error: 'it ran too long' });
      expect(Date.now() - t0, source).toBeLessThan(LIMITS.cpuMs + 2000); // (a busy machine is slow to notice, not slow to stop)
    }
    expect(run('function f() { return f() + 1; } return f();')).toMatchObject({ edits: [], error: expect.stringMatching(/stack overflow/) });
    expect(says('1 + 1')).toBe('2'); // and the next call is fine
  });
  it('is stopped when it eats memory', () => {
    for (const source of ['const a = []; while (true) a.push([1, 2, 3, 4, 5, 6, 7, 8]);', 'const a = []; while (true) a.push({ n: a.length });', 'let s = "x"; while (true) s += s;', 'return [{ say: "x".repeat(1e9) }];']) {
      const r = run(source, 1); // (patient, so that it is memory that runs out, not time)
      expect(r.edits, source).toEqual([]);
      expect(r.error, source).toMatch(/out of memory|string too long|invalid/i);
    }
    expect(run('const a = []; while (true) a.push([1, 2, 3, 4, 5, 6, 7, 8]);', 1, LIMITS)).toMatchObject({ edits: [], error: expect.any(String) }); // with the usual deadline, whichever comes first
    expect(says('1 + 1')).toBe('2');
  }, 60_000);
  it('cannot answer with more than a little', () => {
    expect(run('return [{ say: "x".repeat(100000) }];')).toMatchObject({ edits: [], error: expect.stringMatching(/too much output/) });
    expect(run('return new Array(9).fill({ say: "a" });')).toMatchObject({ edits: [], error: expect.stringMatching(/too many edits/) });
    expect(run('return new Array(8).fill({ say: "a" });').edits).toHaveLength(8);
    for (const source of ['return "edits";', 'return 5;', 'return { say: "x" };', 'return function () {};', 'return Symbol();', 'export default 5;']) expect(run(source), source).toMatchObject({ edits: [], error: expect.any(String) });
    // Things in the list that are not edits are dropped here already; a script cannot start a script.
    expect(run('return [1, "x", null, [2], { script: "again" }, { say: "ok" }];').edits).toEqual([{ say: 'ok' }]);
    expect(run('x'.repeat(LIMITS.source + 1)).error).toBe('script too long');
  });
  it('gives no edits when it throws or does not parse', () => {
    expect(run('throw new Error("boom");')).toEqual({ edits: [], rolls: [], logs: [], error: 'Error: boom' });
    expect(run('roll(6); log("so far"); null.x;')).toMatchObject({ edits: [], rolls: [{ d: 6 }], logs: ['so far'], error: expect.stringMatching(/TypeError/) });
    expect(run('return [}').error).toMatch(/SyntaxError/);
    expect(run('throw { toString() { while (true) {} } };').edits).toEqual([]);
    expect(run('throw "x".repeat(5000);').error!.length).toBeLessThanOrEqual(120);
  });
  it('rolls seeded dice, and every roll is on record', () => {
    const source = 'var a = roll(20), b = roll(6), c = roll(6); return [{ say: [a, b, c].join() }];';
    const one = run(source, 42), two = run(source, 42), other = run(source, 43);
    expect(one).toEqual(two);
    expect(one.rolls.map((r) => r.d)).toEqual([20, 6, 6]);
    expect((one.edits[0] as { say: string }).say).toBe(one.rolls.map((r) => r.v).join());
    expect(other.rolls).not.toEqual(one.rolls);
    const die = seeded(5), seen = new Set<number>();
    for (let i = 0; i < 600; i++) { const v = die(6); expect(v >= 1 && v <= 6 && Number.isInteger(v)).toBe(true); seen.add(v); }
    expect(seen.size).toBe(6);
    // Odd dice are made sane; too many rolls end the call even if the script swallows the complaint.
    expect(run('roll(); roll("x"); roll(1e9); roll(-3); roll(2.9); return [];').rolls.map((r) => r.d)).toEqual([6, 6, 1000, 2, 2]);
    expect(run(`try { for (var i = 0; i < 1000; i++) roll(6); } catch (e) {} return [{ say: "x" }];`)).toMatchObject({ edits: [], error: 'too many rolls' });
    expect(run(`for (var i = 0; i < ${LIMITS.rolls}; i++) roll(6); return [{ say: "x" }];`).edits).toHaveLength(1);
  });
  it('logs a little', () => {
    const r = run('for (var i = 0; i < 100; i++) log("line " + i); log({}); log("x".repeat(1e6)); return [];');
    expect(r.logs).toHaveLength(LIMITS.logs);
    expect(run('log("y".repeat(1000)); log(5); log(true); log({ a: 1 }); log(); return [];').logs).toEqual(['y'.repeat(LIMITS.logLen), '5', 'true']);
  });
  it('checks a script without running it', () => {
    expect(checkScript(qjs, 'return [{ say: "x" }];')).toBeNull();
    expect(checkScript(qjs, 'export default function (ctx) { return []; }')).toBeNull();
    expect(checkScript(qjs, 'while (true) {}')).toBeNull(); // compiled, never run
    expect(checkScript(qjs, 'return [}')).toMatch(/SyntaxError/);
    expect(checkScript(qjs, 'export default function (ctx) { return [ }')).toMatch(/SyntaxError/);
    expect(checkScript(qjs, ' ')).toBe('empty');
    expect(checkScript(qjs, 'x'.repeat(9000))).toBe('script too long');
  });
  it('holds up over many calls', () => {
    for (let i = 0; i < 200; i++) expect(run(i % 3 ? 'return [{ say: "n" + roll(6) }];' : 'null.x', i).fatal).toBeUndefined();
  });
});

describe('scripts in a system', () => {
  const base = (scripts: unknown) => ({ v: 1, name: 'T', sections: [{ fields: [{ id: 'life', type: 'resource' }] }], scripts });
  it('are parsed strictly: named like ids, few, and small', () => {
    const notes: string[] = [];
    const s = parseSystem(base({ ok: 'return [];', 'Bad Name': 'return [];', __proto__x: 'return [];', empty: '  ', num: 5, long: 'x'.repeat(8193), fits: 'y'.repeat(8192) }), notes)!;
    expect(Object.keys(s.scripts!)).toEqual(['ok', 'fits']);
    expect(notes.filter((n) => n.startsWith('scripts:'))).toHaveLength(5);
    expect(parseSystem(base({}))!.scripts).toBeUndefined();
    expect(parseSystem(base(['return [];']))!.scripts).toBeUndefined();
    expect(parseSystem(base('return [];'))!.scripts).toBeUndefined();
    expect(parseSystem({ ...base(undefined) })!.scripts).toBeUndefined();
    const many = parseSystem(base(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`s${i}`, 'return [];']))))!;
    expect(Object.keys(many.scripts!)).toHaveLength(16);
    const big = parseSystem(base(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`s${i}`, 'z'.repeat(8000)]))))!;
    expect(Object.values(big.scripts!).join('').length).toBeLessThanOrEqual(49152);
    expect(Object.keys(big.scripts!)).toHaveLength(6);
    // Parsing again (as every device does with the copy in the store) changes nothing.
    expect(parseSystem(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it('are named by a hash that changes with any of them', async () => {
    const a = await scriptsHash({ id: 'x', scripts: { one: 'return [];', two: 'return [1];' } });
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await scriptsHash({ id: 'x', scripts: { two: 'return [1];', one: 'return [];' } })).toBe(a);
    expect(await scriptsHash({ id: 'x', scripts: { one: 'return [];', two: 'return [2];' } })).not.toBe(a);
    expect(await scriptsHash({ id: 'y', scripts: { one: 'return [];', two: 'return [1];' } })).not.toBe(a);
  });

  // The example system: what its scripts do is in the file, not in the app.
  const knocks = parseSystem(KNOCKS)!;
  const piece = (id: string, name: string, extra: object = {}) => ({ id, name, v: { k: 'knight', x: 0, y: 0, z: 0, r: 0, hp: 8, mhp: 8, ...extra } as never });
  /** Fire an event and follow its scripts the way the referee does (src/ui/sheet.ts). */
  function referee(ev: GameEvent, seed: number) {
    const first = fire(knocks, ev);
    expect(first.scripts).toHaveLength(1);
    const boxed = runScript(qjs, knocks.scripts![first.scripts[0]], scriptCtx(knocks, ev), seed, PATIENT);
    expect(boxed.error).toBeUndefined();
    const after = (p?: { id: string }) => first.minis.find((m) => m.id === p?.id) ?? (p as GameEvent['self']);
    const out = runEdits(knocks, { ...ev, id: `${ev.id}~0`, self: after(ev.self), target: after(ev.target) }, parseEdits(boxed.edits));
    return { boxed, out };
  }
  it('ships an example whose scripts parse with nothing dropped and compile', () => {
    const notes: string[] = [];
    expect(Object.keys(parseSystem(KNOCKS, notes)!.scripts!)).toEqual(['bleed', 'crit']);
    expect(notes).toEqual([]);
    for (const source of Object.values(knocks.scripts!)) expect(checkScript(qjs, source)).toBeNull();
  });
  it('example: bleeding costs 1 a turn until a save stops it', () => {
    let stopped = 0, bled = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { boxed, out } = referee({ on: 'turn.start', id: `ts:${seed}`, self: piece('a', 'Moss', { cn: ['bleeding'] }) }, seed);
      const die = boxed.rolls[0].v, v = out.minis[0].v;
      expect(boxed.rolls).toHaveLength(1);
      if (die + 2 >= 12) { stopped++; expect(v.cn ?? []).toEqual([]); expect(v.hp).toBe(8); expect(out.lines[0]).toBe(`Moss staunches the wound (${die} + 2 = ${die + 2}).`); }
      else { bled++; expect(v.cn).toEqual(['bleeding']); expect(v.hp).toBe(7); expect(out.lines[0]).toMatch(/^Moss bleeds: 1 Vigour lost/); }
    }
    expect(stopped).toBeGreaterThan(0);
    expect(bled).toBeGreaterThan(0);
    expect(fire(knocks, { on: 'turn.start', id: 'x', self: piece('a', 'Moss') }).scripts).toEqual([]); // not bleeding: nothing to run
  });
  it('example: a natural 20 looks up the critical table, which may roll again', () => {
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const ev: GameEvent = { on: 'roll', id: `r:${seed}`, self: piece('a', 'Moss'), target: piece('b', 'Orc', { hp: 30, mhp: 30 }), roll: { id: 'attack', total: 23, nat: 20, ones: 0, vs: 12 } };
      const { boxed, out } = referee(ev, seed);
      const orc = out.minis.find((m) => m.id === 'b')?.v, line = out.lines.at(-1)!;
      expect(line).toMatch(/^Critical on Orc: /);
      if (line.includes('a flurry')) { kinds.add('flurry'); expect(boxed.rolls.length).toBeGreaterThanOrEqual(3); }
      if (line.includes('a deep cut')) { kinds.add('cut'); expect(orc!.cn).toContain('bleeding'); }
      if (line.includes('swept')) { kinds.add('swept'); expect(orc!.cn).toContain('prone'); }
      if (line.includes('crushing')) { kinds.add('crush'); expect(orc!.hp).toBeLessThan(30); }
      const more = /\((\d+) more\)/.exec(line);
      expect(orc?.hp ?? 30).toBe(30 - (more ? +more[1] : 0));
    }
    expect([...kinds].sort()).toEqual(['crush', 'cut', 'flurry', 'swept']);
    expect(fire(knocks, { on: 'roll', id: 'x', self: piece('a', 'Moss'), target: piece('b', 'Orc'), roll: { id: 'attack', total: 20, nat: 17, ones: 0 } }).scripts).toEqual([]);
  });
});

// The worker's keeper (src/script.ts), with a worker made of cardboard: what it does when the
// real one is slow, silent or broken. (The real worker and engine are tried in e2e.)
describe('the runner around the worker', () => {
  type Listener = (e: { data: unknown }) => void;
  let made: FakeWorker[] = [], answer: (ask: { id: number; run: { source: string } }) => unknown = () => undefined;
  class FakeWorker {
    on = new Set<Listener>(); asked = 0; dead = false;
    constructor() { made.push(this); setTimeout(() => this.emit({ ready: true })); }
    emit(data: unknown) { if (!this.dead) for (const f of [...this.on]) f({ data }); }
    addEventListener(type: string, f: Listener) { if (type === 'message') this.on.add(f); }
    removeEventListener(_: string, f: Listener) { this.on.delete(f); }
    postMessage(ask: { id: number; run: { source: string } }) { this.asked++; setTimeout(() => this.emit({ id: ask.id, started: true })); const r = answer(ask); if (r !== undefined) setTimeout(() => this.emit({ id: ask.id, result: r })); }
    terminate() { this.dead = true; }
  }
  const ok = (edits: unknown[]) => ({ edits, rolls: [], logs: [] });
  const ev = { on: 'turn.start' as const, event: 'e' };
  afterEach(() => { vi.unstubAllGlobals(); made = []; });
  const setup = () => { vi.stubGlobal('Worker', FakeWorker); const told: string[] = []; return { told, r: makeRunner({ a: 'A', b: 'B' }, (t) => told.push(t)) }; };

  it('starts no worker until a script is due, and hands back what the box answers', async () => {
    const { r, told } = setup();
    answer = (ask) => ok([{ say: ask.run.source }]);
    expect(made).toHaveLength(0);
    expect(await r.run('nope', ev)).toEqual([]); // not one of this system's scripts
    expect(made).toHaveLength(0);
    expect(await r.run('a', ev)).toEqual([{ say: 'A' }]);
    expect(await Promise.all([r.run('b', ev), r.run('a', ev)])).toEqual([[{ say: 'B' }], [{ say: 'A' }]]);
    expect(made).toHaveLength(1);
    expect(told).toEqual(['Script "nope" is not in these rules.']);
    r.stop();
    expect(made[0].dead).toBe(true);
  });
  it('ends a worker that does not answer, says so once, and makes a new one for the next call', async () => {
    const { r, told } = setup();
    answer = () => undefined; // it begins, then silence
    const t0 = Date.now();
    expect(await r.run('a', ev)).toEqual([]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(CALL_MS - 20);
    expect(Date.now() - t0).toBeLessThan(CALL_MS + 1000);
    expect(made[0].dead).toBe(true);
    expect(told).toEqual(['Script "a" did not answer and was stopped.']);
    answer = () => ok([{ say: 'back' }]);
    expect(await r.run('a', ev)).toEqual([{ say: 'back' }]);
    expect(made).toHaveLength(2);
    // Errors and a broken engine: no edits; a broken engine is replaced. The chat is not flooded.
    answer = () => ({ ...ok([{ say: 'never' }]), error: 'boom', fatal: true });
    expect(await r.run('a', ev)).toEqual([]);
    expect(made[1].dead).toBe(true);
    expect(told).toHaveLength(1); // the second line came too soon after the first
    r.stop();
  });
  it('gives each script only so many calls a minute', async () => {
    const { r, told } = setup();
    answer = () => ok([{ say: 'x' }]);
    for (let i = 0; i < PER_MINUTE; i++) expect(await r.run('a', ev)).toHaveLength(1);
    expect(await r.run('a', ev)).toEqual([]);
    expect(await r.run('a', ev)).toEqual([]);
    expect(made[0].asked).toBe(PER_MINUTE);
    expect(told).toEqual(['Script "a" is asked for too often: skipped.']);
    expect(await r.run('b', ev)).toHaveLength(1); // another script has a budget of its own
    // A storm all at once: only so many wait in line.
    const storm = await Promise.all(Array.from({ length: 25 }, () => r.run('b', ev)));
    expect(storm.filter((x) => (x as unknown[]).length).length).toBeLessThanOrEqual(16);
    r.stop();
  });
  it('leaves out a script that keeps running out of time', async () => {
    const { r, told } = setup();
    answer = () => ({ ...ok([]), error: 'it ran too long' });
    for (let i = 0; i < STRIKES; i++) expect(await r.run('a', ev)).toEqual([]);
    expect(made[0].asked).toBe(STRIKES);
    answer = () => ok([{ say: 'x' }]);
    expect(await r.run('a', ev)).toEqual([]); // not even asked
    expect(made[0].asked).toBe(STRIKES);
    expect(told[0]).toBe('Script "a": it ran too long');
    expect(await r.run('b', ev)).toHaveLength(1);
    r.stop();
  });
  it('never rejects, whatever the worker does', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('no workers here'); } });
    const r = makeRunner({ a: 'A' });
    expect(await r.run('a', ev)).toEqual([]);
    vi.stubGlobal('Worker', FakeWorker);
    answer = () => ({ edits: 'not a list' });
    expect(await makeRunner({ a: 'A' }).run('a', ev)).toEqual([]);
  });
});
