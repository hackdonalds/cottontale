// Scripts a game system may bring (`scripts` in the system's JSON, named by `{ script }` edits).
//
// A system is data from the network, so its scripts are a stranger's code. They never run in
// the page: they run in QuickJS inside a worker of their own (src/script.worker.ts,
// src/scriptbox.ts), get a snapshot of the event, and can only hand back edits from the closed
// set triggers use. This file is the app's side of that: who may run them, the worker's life,
// and the budgets around it. It is loaded only at a table whose system has scripts, and the
// engine only once a script is actually due on this device, which is the one applying the
// rules (see `authority`), after its user has allowed this very set of scripts.
import type { Ask } from './script.worker';
import { TOO_LONG, type BoxResult } from './scriptbox';
import type { ScriptCtx, ScriptRunner, System } from './system';

/**
 * A call the worker has begun and not answered by now is taken to be stuck: the worker is ended
 * and a new one made when next needed. (The box interrupts a script long before this; this is
 * for what the box cannot interrupt.) A worker that does not even begin gets `BEGIN_MS`.
 */
export const CALL_MS = 500, BEGIN_MS = 5000;
/** How long the engine may take to arrive and start (a phone on a slow line). */
export const LOAD_MS = 30_000;
/** Calls one script may make in a minute, all of a system's scripts together, and how many may wait in line. */
export const PER_MINUTE = 30, ALL_PER_MINUTE = 120, QUEUE = 16;
/** A script that ran out of time this often within `REST_MS` is left alone for as long. */
export const STRIKES = 3, REST_MS = 300_000;
const TELL_MS = 3000; // at most one line about scripts in the chat this often

type Reply = { id: number; started?: boolean; result?: BoxResult; said?: string | null };
type Question = Ask extends infer A ? (A extends { id: number } ? Omit<A, 'id'> : never) : never;

// ---- the worker ------------------------------------------------------------------------------

class Engine {
  private w: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private last: Promise<unknown> = Promise.resolve();
  private n = 0;
  waiting = 0;

  private start(): Promise<boolean> {
    if (this.ready) return this.ready;
    let w: Worker;
    try { w = this.w = new Worker(new URL('./script.worker.ts', import.meta.url), { type: 'module' }); } catch { return Promise.resolve(false); }
    return this.ready = new Promise<boolean>((done) => {
      const t = setTimeout(() => done(false), LOAD_MS);
      w.addEventListener('message', (e) => { if (e.data && 'ready' in e.data) { clearTimeout(t); done(e.data.ready === true); } });
      w.addEventListener('error', () => { clearTimeout(t); done(false); });
    }).then((ok) => { if (!ok && this.w === w) this.stop(); return ok; });
  }
  stop(): void { this.w?.terminate(); this.w = null; this.ready = null; }
  /** Ask the worker one thing, after whatever was asked before. Null if it could not start or did not answer in time. */
  ask(what: Question): Promise<Reply | null> {
    const go = async (): Promise<Reply | null> => {
      if (!(await this.start())) return null;
      const w = this.w, id = ++this.n;
      if (!w) return null;
      return new Promise<Reply | null>((done) => {
        const end = (r: Reply | null) => { clearTimeout(t); w.removeEventListener('message', on); done(r); };
        // (An answer that is already waiting behind a busy page gets one more moment.)
        const giveUp = () => setTimeout(() => { if (this.w === w) this.stop(); end(null); }, 50);
        const on = (e: MessageEvent) => {
          if (e.data?.id !== id) return;
          if (e.data.started) { clearTimeout(t); t = setTimeout(giveUp, CALL_MS); } else end(e.data as Reply);
        };
        let t = setTimeout(giveUp, BEGIN_MS);
        w.addEventListener('message', on);
        w.postMessage({ id, ...what });
      });
    };
    this.waiting++;
    const p = this.last.then(go, go).finally(() => { this.waiting--; });
    this.last = p.catch(() => null);
    return p;
  }
}

export interface Runner {
  /** Give this to `setScriptRunner`. Resolves to edits (unchecked data), or to none; never rejects. */
  run: ScriptRunner;
  /** End the worker. The runner still works: a later call starts a new one. */
  stop(): void;
}
/**
 * A runner for one system's scripts. Nothing is loaded until the first call. `tell` gets a
 * terse line when a script fails, is stopped or logs something (rate-limited); `seen` gets
 * every result, with the dice the script rolled.
 */
export function makeRunner(scripts: Record<string, string>, tell: (text: string) => void = () => {}, seen?: (name: string, result: BoxResult) => void): Runner {
  const engine = new Engine(), calls = new Map<string, number[]>(), strikes = new Map<string, number[]>();
  let told = 0, all: number[] = [];
  const say = (text: string) => { const now = Date.now(); if (now - told < TELL_MS) return; told = now; tell(text.slice(0, 200)); };
  const run = async (name: string, ctx: ScriptCtx): Promise<unknown> => {
    try {
      if (!Object.prototype.hasOwnProperty.call(scripts, name)) { say(`Script "${name}" is not in these rules.`); return []; }
      const now = Date.now(), recent = (calls.get(name) ?? []).filter((t) => now - t < 60_000), slow = (strikes.get(name) ?? []).filter((t) => now - t < REST_MS);
      calls.set(name, recent);
      strikes.set(name, slow);
      all = all.filter((t) => now - t < 60_000);
      if (slow.length >= STRIKES) { say(`Script "${name}" keeps running too long: it is left out for a while.`); return []; }
      if (recent.length >= PER_MINUTE || all.length >= ALL_PER_MINUTE || engine.waiting >= QUEUE) { say(`Script "${name}" is asked for too often: skipped.`); return []; }
      recent.push(now);
      all.push(now);
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      const reply = await engine.ask({ run: { source: scripts[name], ctx, seed } });
      const result = reply?.result;
      const strike = () => { strikes.set(name, [...(strikes.get(name) ?? []), Date.now()]); };
      if (!result) { strike(); say(`Script "${name}" did not answer and was stopped.`); return []; }
      if (result.fatal) engine.stop();
      if (result.error === TOO_LONG) strike();
      seen?.(name, result);
      if (result.error) { say(`Script "${name}": ${result.error}`); return []; }
      if (result.logs.length) say(`Script "${name}": ${result.logs.join(' · ')}`);
      return Array.isArray(result.edits) ? result.edits : [];
    } catch { return []; }
  };
  return { run, stop: () => engine.stop() };
}

let checker: Engine | null = null;
/** For an editor: compile a script in the box, without running it. Resolves to null if it is sound, else to what is wrong with it. */
export async function checkScript(source: string): Promise<string | null> {
  const reply = await (checker ??= new Engine()).ask({ check: source });
  return reply ? reply.said ?? null : 'the check did not answer';
}

// ---- trust: one question per set of scripts, per device -------------------------------------------

const KEY = 'cottontale:scripts';
function allowed(): string[] {
  try { const x: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(x) ? x.filter((h): h is string => typeof h === 'string') : []; } catch { return []; }
}
function remember(hash: string, on: boolean): void {
  try { localStorage.setItem(KEY, JSON.stringify([...allowed().filter((h) => h !== hash), ...(on ? [hash] : [])].slice(-40))); } catch { /* storage full or blocked: asked again next time */ }
}
/** Names this exact set of scripts. Empty where the browser cannot hash (then nothing is remembered). */
export async function scriptsHash(sys: Pick<System, 'id' | 'scripts'>): Promise<string> {
  const text = JSON.stringify([sys.id, Object.entries(sys.scripts ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))]);
  try {
    const sum = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(sum).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return ''; }
}

/** What this module needs from the app (src/main.ts). */
export interface ScriptHost {
  system(): System | null;
  /** Would this device apply the rules for something it did itself, right now? */
  referee(): boolean;
  /** A line in this device's chat only. */
  say(html: string): void;
  setRunner(fn: ScriptRunner | null): void;
  /** Have `fn` draw under the list of systems whenever that is drawn (`setPickerNote` in src/ui/sheet.ts). */
  setNote(fn: ((el: HTMLElement) => void) | null): void;
  /** Draw the list of systems again where it is showing. */
  redraw(): void;
}

let host: ScriptHost | null = null;
let seen: System | null = null, hash = '', hashed = false;
let choice: 'ask' | 'yes' | 'no' = 'ask';
let runner: Runner | null = null;
const refused = new Set<string>(); // "Not now" lasts until the page is closed

function arm(): void {
  runner?.stop();
  runner = null;
  if (choice === 'yes' && seen?.scripts) {
    runner = makeRunner(seen.scripts, (text) => { const s = document.createElement('span'); s.className = 'sys'; s.textContent = text; host?.say(s.outerHTML); });
  }
  host?.setRunner(runner?.run ?? null);
}
function choose(c: 'yes' | 'no'): void {
  choice = c;
  if (hash) { remember(hash, c === 'yes'); if (c === 'no') refused.add(hash); else refused.delete(hash); }
  arm();
  host?.redraw();
}
function note(el: HTMLElement): void {
  if (!host || !seen?.scripts || !hashed || host.system() !== seen || !host.referee()) return;
  const box = document.createElement('div'), p = document.createElement('p'), row = document.createElement('span');
  box.className = 'scriptask';
  p.className = 'hint';
  row.className = 'row';
  p.textContent = choice === 'ask' ? 'This system brings scripts. They run only on your device, boxed in, and can only change stats and conditions.'
    : choice === 'yes' ? 'This system’s scripts are allowed on this device.' : 'This system’s scripts are off on this device.';
  const button = (text: string, what: string, click: () => void) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.dataset.scripts = what;
    b.onclick = click;
    row.append(b);
  };
  if (choice !== 'yes') button('Allow', 'allow', () => choose('yes'));
  if (choice === 'ask') button('Not now', 'later', () => choose('no'));
  if (choice === 'yes') button('Turn off', 'off', () => choose('no'));
  box.append(p, row);
  el.append(box);
}

/**
 * Follow the table: call whenever the store has settled. Sets the script runner when the
 * table's system has scripts this device's user has allowed, and takes it (and the worker)
 * away when the system changes or goes.
 */
export function syncScripts(h: ScriptHost): void {
  host = h;
  h.setNote(note);
  const sys = h.system();
  if (sys === seen) return;
  seen = sys;
  hash = '';
  hashed = false;
  choice = 'ask';
  arm();
  if (!sys?.scripts) return;
  void scriptsHash(sys).then((x) => {
    if (seen !== sys) return;
    hash = x;
    hashed = true;
    choice = x && allowed().includes(x) ? 'yes' : refused.has(x) ? 'no' : 'ask';
    arm();
    h.redraw();
    // Someone who will referee but is not looking at the list of systems is told where to find the question.
    if (choice === 'ask') setTimeout(() => {
      if (seen === sys && choice === 'ask' && h.referee() && !document.querySelector<HTMLElement>('.scriptask')?.offsetParent) h.say('<span class="sys">These rules bring scripts. Open Rules to allow them.</span>');
    }, 2500);
  });
}
