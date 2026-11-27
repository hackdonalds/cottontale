// The box a game system's scripts run in: QuickJS, a whole JavaScript engine compiled to
// WebAssembly. A script is somebody else's code that arrived over the network, so it gets an
// engine of its own with nothing of ours in it: no DOM, no network, no storage, no keys, no
// clock. It is handed a frozen snapshot of what happened, may roll seeded dice and write a few
// log lines, and hands back a list of edits as JSON text. That text is all that comes out.
//
// This file is the core and is the same in the worker (src/script.worker.ts) and in the unit
// tests under node: it is given the loaded engine and only imports types.
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten-core';

export interface Limits {
  /** Bytes of source one script may have. */
  source: number;
  /** Bytes the engine may allocate, and bytes of stack. */
  memory: number; stack: number;
  /**
   * Milliseconds the script itself may compute before it is interrupted. The engine asks at
   * loop ends and calls, not inside a built-in (sorting a huge array, say): what one built-in
   * can cost is bounded by `memory`, and the worker's keeper ends a call that still does not
   * answer (`CALL_MS` in src/script.ts).
   */
  cpuMs: number;
  /** Characters of JSON a call may hand back, and how many edits may be in it. */
  output: number; edits: number;
  /** Dice one call may roll; log lines it may write, and their length. */
  rolls: number; logs: number; logLen: number;
}
export const LIMITS: Limits = {
  source: 8192, memory: 8 << 20, stack: 256 << 10, cpuMs: 50, output: 16384, edits: 8, rolls: 64, logs: 8, logLen: 200,
};

export interface BoxResult {
  /** What the script handed back: plain data, still to be checked by `parseEdits`. Empty on any failure. */
  edits: unknown[];
  /** Every die the script rolled, in order. */
  rolls: { d: number; v: number }[];
  logs: string[];
  /** Why there are no edits, in a few words. */
  error?: string;
  /** The engine itself broke (not just the script): throw it away and load a new one. */
  fatal?: boolean;
}

// What of the language a script gets. No Date (no clock), no Promise (nothing to wait for), no
// Proxy or typed arrays. `Eval` is what compiles the script itself; RegExp is off because a
// pattern that backtracks for ever is native code the interrupt cannot stop.
const INTRINSICS = { BaseObjects: true, Eval: true, JSON: true, MapSet: true, StringNormalize: true };

// Runs first, in the script's engine. It keeps the few built-ins the hand-over needs out of the
// script's reach, takes away what is left of chance and code-from-text, and returns the one
// function the host calls.
const PRELUDE = `(function () {
  "use strict";
  var S = JSON.stringify, P = JSON.parse, F = Object.freeze, K = Object.keys;
  function deep(o) { if (o && typeof o === "object") { var k = K(o); for (var i = 0; i < k.length; i++) deep(o[k[i]]); F(o); } return o; }
  Math.random = function () { throw new Error("no Math.random here: use roll(sides)"); };
  delete globalThis.eval;
  return function (fn, json, roll, log) {
    if (typeof fn !== "function") throw new Error("a script is a function body, or exports one function");
    var r = fn(deep(P(json)), roll, log);
    return S(r === undefined || r === null ? [] : r);
  };
})()`;

// A script is either the body of `function (ctx, roll, log)`, or it is written like a module
// with one `export default function (ctx, roll, log)` and helpers around it. There is nothing
// to import, so the second form is turned into the first by naming the export.
const EXPORT = /^[ \t]*export\s+default\s+/m;
const wrap = (source: string) => (EXPORT.test(source)
  ? `(function () {"use strict"; var __main;\n${source.replace(EXPORT, '__main = ')}\n;return __main; })()`
  : `(function (ctx, roll, log) {"use strict";\n${source}\n})`);

/** What `error` says when a script was interrupted. */
export const TOO_LONG = 'it ran too long';

/** A small seeded generator (mulberry32): the same seed rolls the same dice. */
export function seeded(seed: number): (sides: number) => number {
  let a = seed >>> 0;
  return (sides) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return 1 + Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * sides);
  };
}

const brief = (e: unknown): string => {
  const m = e && typeof e === 'object' ? `${(e as { name?: unknown }).name ?? 'Error'}: ${(e as { message?: unknown }).message ?? ''}` : String(e);
  return m.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120);
};

interface Box { rt: QuickJSRuntime; vm: QuickJSContext; held: QuickJSHandle[]; late(): boolean; /** Start the clock: the script's own code comes next. */ go(): void }
function open(qjs: QuickJSWASMModule, lim: Limits): Box {
  const rt = qjs.newRuntime();
  rt.setMemoryLimit(lim.memory);
  rt.setMaxStackSize(lim.stack);
  let until = Infinity, late = false;
  rt.setInterruptHandler(() => (late ||= Date.now() > until));
  return { rt, vm: rt.newContext({ intrinsics: INTRINSICS }), held: [], late: () => late, go: () => { until = Date.now() + lim.cpuMs; } };
}
/** Returns false if the engine could not be cleaned up: it is then not to be used again. */
function close(box: Box | undefined): boolean {
  if (!box) return true;
  try {
    for (const h of box.held.reverse()) if (h.alive) h.dispose();
    box.vm.dispose();
    box.rt.dispose();
    return true;
  } catch { return false; }
}
/** Compile the script inside the box and, unless `compileOnly`, evaluate it to its function. Throws what the engine says. */
function load(box: Box, source: string, compileOnly: boolean): QuickJSHandle {
  const res = box.vm.evalCode(wrap(source), 'script.js', { strict: true, ...(compileOnly ? { compileOnly } : {}) });
  if (res.error) { box.held.push(res.error); throw box.vm.dump(res.error); }
  box.held.push(res.value);
  return res.value;
}

/**
 * Run one script once, in an engine made for this call and thrown away after it. Never throws:
 * a script that fails, runs too long, asks for too much or answers with too much gives no
 * edits and says why in `error`.
 */
export function runScript(qjs: QuickJSWASMModule, source: string, ctx: unknown, seed: number, lim: Limits = LIMITS): BoxResult {
  const out: BoxResult = { edits: [], rolls: [], logs: [] };
  if (typeof source !== 'string' || source.length > lim.source) return { ...out, error: 'script too long' };
  let box: Box | undefined, over = '';
  try {
    const json = JSON.stringify(ctx ?? {});
    if (json.length > lim.output * 4) return { ...out, error: 'too much to tell it' };
    box = open(qjs, lim);
    const { vm, held } = box, die = seeded(seed);
    const keep = (h: QuickJSHandle) => { held.push(h); return h; };
    const call = vm.evalCode(PRELUDE, 'box.js');
    if (call.error) { held.push(call.error); throw vm.dump(call.error); }
    keep(call.value);
    const roll = keep(vm.newFunction('roll', (h) => {
      const n = h ? vm.getNumber(h) : NaN, d = Number.isFinite(n) ? Math.max(2, Math.min(1000, Math.trunc(n))) : 6;
      if (out.rolls.length >= lim.rolls) { over = 'too many rolls'; throw new Error(over); }
      const v = die(d);
      out.rolls.push({ d, v });
      return vm.newNumber(v);
    }));
    const log = keep(vm.newFunction('log', (h) => {
      const t = h ? vm.typeof(h) : '';
      if (out.logs.length >= lim.logs || !['string', 'number', 'boolean'].includes(t)) return;
      if (t === 'string') { const len = vm.getProp(h, 'length'), n = vm.getNumber(len); len.dispose(); if (n > lim.logLen * 10) return; }
      out.logs.push(vm.getString(h).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, lim.logLen));
    }));
    box.go();
    const fn = load(box, source, false);
    const res = vm.callFunction(call.value, vm.undefined, fn, keep(vm.newString(json)), roll, log);
    if (res.error) { held.push(res.error); throw vm.dump(res.error); }
    keep(res.value);
    if (over) throw new Error(over);
    if (vm.typeof(res.value) !== 'string') throw new Error('it did not answer with a list');
    if (vm.getNumber(keep(vm.getProp(res.value, 'length'))) > lim.output) throw new Error('too much output');
    const list: unknown = JSON.parse(vm.getString(res.value));
    if (!Array.isArray(list)) throw new Error('it did not answer with a list');
    if (list.length > lim.edits) throw new Error('too many edits');
    // A script may not start scripts: its answer is the end of the matter.
    out.edits = list.filter((e) => typeof e === 'object' && e !== null && !Array.isArray(e) && !('script' in e));
  } catch (e) {
    out.edits = [];
    out.error = over || (box?.late() ? TOO_LONG : brief(e));
  }
  if (!close(box)) out.fatal = true;
  return out;
}

/** Compile a script in the box without running it. Returns null if it is sound, else the engine's complaint. */
export function checkScript(qjs: QuickJSWASMModule, source: string, lim: Limits = LIMITS): string | null {
  if (typeof source !== 'string' || !source.trim()) return 'empty';
  if (source.length > lim.source) return 'script too long';
  let box: Box | undefined, said: string | null = null;
  try {
    box = open(qjs, lim);
    load(box, source, true);
  } catch (e) { said = brief(e); }
  close(box);
  return said;
}
