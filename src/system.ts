// Game systems as data. A system is a plain JSON file (see `public/systems`) that says what a
// character sheet holds, which dice are thrown and how they are read, what conditions do and
// what happens by itself at the table. Nothing in here knows any particular game.
//
// A picked system is copied whole into the store (`set:system`), so it arrives from other
// people and is not trusted: `parseSystem` is strict, bounded, and drops what it does not
// understand. Everything is pure and uses whole numbers only, so every device derives the
// same sheet and reads the same dice.
//
// What is stored on a piece is only what somebody entered or what happened to it (`sv`, `cn`,
// and the old `hp`/`mhp`/`ini`). Everything else (modifiers, pools, armour) is derived
// on each device by `derive`.
import type { Kind } from './dice';
import type { MiniVal } from './rules';

// ---- limits (a system comes from the network) -------------------------------------------

const LIM = 1_000_000_000;      // every number in the rules maths stays within ± this
const EXPR_LEN = 240, EXPR_NODES = 96, EXPR_DEPTH = 24;
/** How many steps one expression may take; a whole sheet gets `SHEET_STEPS`. */
export const EXPR_STEPS = 2000;
const SHEET_STEPS = 40000;
const DICE_LEN = 120, DICE_TERMS = 8, DICE_COUNT = 100, DICE_SIDES = 1000;
const MAX_REAL = 12;            // dice in one physical throw (MAX_DICE in dice.ts)
const BURSTS = 40;              // extra dice one term can gain by exploding
const SECTIONS = 12, FIELDS = 24, ROLLS = 40, MODES = 8, CONDS = 40, MODS = 8, TRIGGERS = 40, EDITS = 8, OPTIONS = 12;
const SCRIPTS = 16, SCRIPT_LEN = 8192, SCRIPTS_LEN = 49152; // scripts a system may carry, and their size in characters
const CONDS_ON = 16;            // conditions one piece can carry
const FX = 6;                   // event ids a piece remembers (see `fire`)

const int = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? Math.max(-LIM, Math.min(LIM, Math.trunc(x))) : 0);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// ---- expressions -------------------------------------------------------------------------
// A small language for derived stats, conditions and triggers. Whole numbers only.
//
//   numbers        12
//   names          str   str.mod   hp.max   target.ac   roll.total     (unknown names are 0)
//   arithmetic     + - * / %      `/` rounds down (towards minus infinity); x/0 is 0
//   rounding       floor(a/b)  ceil(a/b)  round(a/b)   decide how that one division rounds
//   comparisons    < <= > >= == !=    give 1 or 0
//   logic          && || !  and  cond ? a : b
//   functions      min(a, …) max(a, …) abs(x) clamp(x, lo, hi) has(condition)
//
// An expression can only read numbers through the `Scope` it is given: it has no access to
// anything else, cannot loop, and is cut off (giving 0) after a fixed number of steps.

type Node =
  | { t: 'n'; v: number }
  | { t: 'id'; v: string }
  | { t: 'has'; v: string }
  | { t: 'un'; o: string; a: Node }
  | { t: 'bin'; o: string; a: Node; b: Node }
  | { t: 'if'; c: Node; a: Node; b: Node }
  | { t: 'fn'; f: string; a: Node[] };

/** What an expression can see: numbers by name, and whether a condition is on. */
export interface Scope { num(name: string): number; has(cond: string): boolean }
export interface Budget { n: number }

const FUNCS: Record<string, [least: number, most: number]> = { min: [1, 8], max: [1, 8], abs: [1, 1], floor: [1, 1], ceil: [1, 1], round: [1, 1], clamp: [3, 3] };
const TOKEN = /\s*(\d+|@?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*|<=|>=|==|!=|&&|\|\||[-+*/%()<>!?:,])/y;
const LEVELS: string[][] = [['||'], ['&&'], ['==', '!=', '<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

const parsed = new Map<string, Node | null>();

/** Parse an expression, or null if it is not one (or is too long or too deep). */
export function parseExpr(src: unknown): Node | null {
  if (typeof src !== 'string' || !src.trim() || src.length > EXPR_LEN) return null;
  const hit = parsed.get(src);
  if (hit !== undefined) return hit;
  let out: Node | null = null;
  try { out = parseTokens(src); } catch { out = null; }
  if (parsed.size > 2000) parsed.clear();
  parsed.set(src, out);
  return out;
}

function parseTokens(src: string): Node {
  const toks: string[] = [];
  TOKEN.lastIndex = 0;
  for (let at = 0; at < src.length;) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(src);
    if (!m) { if (src.slice(at).trim()) throw 0; break; }
    if (/^\d/.test(m[1]) && m[1].length > 9) throw 0;
    toks.push(m[1]);
    at = TOKEN.lastIndex;
  }
  let i = 0, nodes = 0;
  const made = <T extends Node>(n: T): T => { if (++nodes > EXPR_NODES) throw 0; return n; };
  const eat = (t: string) => { if (toks[i] !== t) throw 0; i++; };
  const ternary = (depth: number): Node => {
    if (depth > EXPR_DEPTH) throw 0;
    const c = binary(0, depth + 1);
    if (toks[i] !== '?') return c;
    i++;
    const a = ternary(depth + 1);
    eat(':');
    return made({ t: 'if', c, a, b: ternary(depth + 1) });
  };
  const binary = (level: number, depth: number): Node => {
    if (level === LEVELS.length) return unary(depth);
    let a = binary(level + 1, depth);
    while (LEVELS[level].includes(toks[i])) {
      const o = toks[i++];
      a = made({ t: 'bin', o, a, b: binary(level + 1, depth) });
    }
    return a;
  };
  const unary = (depth: number): Node => {
    if (depth > EXPR_DEPTH) throw 0;
    if (toks[i] === '-' || toks[i] === '!') { const o = toks[i++]; return made({ t: 'un', o, a: unary(depth + 1) }); }
    return primary(depth);
  };
  const primary = (depth: number): Node => {
    const t = toks[i++];
    if (t === undefined) throw 0;
    if (/^\d/.test(t)) return made({ t: 'n', v: +t });
    if (t === '(') { const n = ternary(depth + 1); eat(')'); return n; }
    if (!/^[@A-Za-z_]/.test(t)) throw 0;
    const name = t.replace(/^@/, '');
    if (toks[i] !== '(') return made({ t: 'id', v: name });
    i++;
    if (name === 'has') {
      const c = toks[i++];
      if (!c || !/^[@A-Za-z_]/.test(c)) throw 0;
      eat(')');
      return made({ t: 'has', v: c.replace(/^@/, '') });
    }
    const f = own(FUNCS, name) ? FUNCS[name] : null;
    if (!f) throw 0;
    const a: Node[] = [ternary(depth + 1)];
    while (toks[i] === ',') { i++; a.push(ternary(depth + 1)); }
    eat(')');
    if (a.length < f[0] || a.length > f[1]) throw 0;
    if (name === 'floor' || name === 'ceil' || name === 'round') {
      // Rounding is a property of a division: floor(a/b), ceil(a/b), round(a/b).
      const d = a[0];
      return d.t === 'bin' && d.o === '/' ? made({ t: 'bin', o: name, a: d.a, b: d.b }) : d;
    }
    return made({ t: 'fn', f: name, a });
  };
  const out = ternary(0);
  if (i !== toks.length) throw 0;
  return out;
}

const OVER = { over: true };
const mod = (a: number, b: number) => ((a % b) + b) % b;
const divFloor = (a: number, b: number) => (b === 0 ? 0 : (a - mod(a, b)) / b);

function run(n: Node, sc: Scope, b: Budget): number {
  if (--b.n < 0) throw OVER;
  switch (n.t) {
    case 'n': return n.v;
    case 'id': return int(sc.num(n.v));
    case 'has': return sc.has(n.v) ? 1 : 0;
    case 'un': { const a = run(n.a, sc, b); return n.o === '-' ? -a : a ? 0 : 1; }
    case 'if': return run(n.c, sc, b) ? run(n.a, sc, b) : run(n.b, sc, b);
    case 'fn': {
      const a = n.a.map((x) => run(x, sc, b));
      if (n.f === 'min') return Math.min(...a);
      if (n.f === 'max') return Math.max(...a);
      if (n.f === 'abs') return Math.abs(a[0]);
      return Math.max(a[1], Math.min(a[2], a[0])); // clamp
    }
    case 'bin': {
      if (n.o === '&&') return run(n.a, sc, b) && run(n.b, sc, b) ? 1 : 0;
      if (n.o === '||') return run(n.a, sc, b) || run(n.b, sc, b) ? 1 : 0;
      const x = run(n.a, sc, b), y = run(n.b, sc, b);
      switch (n.o) {
        case '+': return int(x + y);
        case '-': return int(x - y);
        case '*': return int(x * y);
        case '/': case 'floor': return divFloor(x, y);
        case 'ceil': return -divFloor(-x, y);
        case 'round': return y === 0 ? 0 : y < 0 ? divFloor(-2 * x - y, -2 * y) : divFloor(2 * x + y, 2 * y); // halves go up
        case '%': return y === 0 ? 0 : mod(x, y);
        case '<': return x < y ? 1 : 0;
        case '<=': return x <= y ? 1 : 0;
        case '>': return x > y ? 1 : 0;
        case '>=': return x >= y ? 1 : 0;
        case '==': return x === y ? 1 : 0;
        default: return x !== y ? 1 : 0;
      }
    }
  }
}

const NOTHING: Scope = { num: () => 0, has: () => false };

/** The value of an expression: 0 if it does not parse or runs out of steps. Never throws. */
export function evalExpr(src: number | string, scope: Scope = NOTHING, budget: Budget = { n: EXPR_STEPS }): number {
  if (typeof src === 'number') return int(src);
  const n = parseExpr(src);
  if (!n) return 0;
  try { return int(run(n, scope, budget)); } catch { return 0; } // out of steps, or a scope that failed
}

// ---- dice notation -----------------------------------------------------------------------
// Which dice to throw, and how to read the faces they land on.
//
//   2d6+3            two six-sided dice and three
//   d20+@str.mod     `@name` is a stat of whoever rolls; `(expression)` works anywhere a number does
//   (@pool)d6        a pool sized by a stat          d(@die)   a die chosen by a stat     d% = d100
//   2d20kh1          keep the highest 1 (kl lowest; dh / dl drop the highest / lowest)
//   5d6!             a die showing its highest face explodes: roll another (`!5`: on 5 or more)
//   5d6>=5           count the dice showing 5 or more instead of adding them up (>= <= > < =)
//   5d6!>=5          both: sixes explode, count 5+
//
// `planRoll` works the numbers out for one actor and says which dice are physical ones
// (d4 d6 d8 d10 d12 d20 d100, up to twelve in a throw): those tumble on the table and the faces
// that land are the result. `readRoll` reads them. Only what has no physical die (a d7, the
// thirteenth die, the extra dice of an explosion) is rolled as plain numbers by the thrower's
// device and sent along with the throw, so every device reads the same result.

/** A number written into a system: a literal, or the source of an expression. */
export type Num = number | string;
export type Cmp = '>=' | '<=' | '>' | '<' | '=';
interface DiceTerm { s: 1 | -1; n: Num; d: Num; keep?: { hi: boolean; drop: boolean; n: number }; x?: number; c?: [Cmp, number] }
interface NumTerm { s: 1 | -1; v: Num }
export interface DiceAst { terms: (DiceTerm | NumTerm)[] }

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/;

export function parseDice(src: unknown): DiceAst | null {
  if (typeof src !== 'string' || src.length > DICE_LEN) return null;
  const s = src.trim().toLowerCase();
  let i = 0;
  const ws = () => { while (s[i] === ' ') i++; };
  const digits = (most = 4): number | null => {
    const m = /^\d+/.exec(s.slice(i));
    if (!m || m[0].length > most) return null;
    i += m[0].length;
    return +m[0];
  };
  const num = (): Num | null => {
    if (s[i] === '@') {
      const m = IDENT.exec(s.slice(i + 1));
      if (!m) return null;
      i += 1 + m[0].length;
      return m[0];
    }
    if (s[i] === '(') {
      let depth = 0, j = i;
      for (; j < s.length; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')' && --depth === 0) break;
      }
      if (j >= s.length) return null;
      const inner = s.slice(i + 1, j);
      if (!parseExpr(inner)) return null;
      i = j + 1;
      return inner;
    }
    return digits();
  };
  const terms: (DiceTerm | NumTerm)[] = [];
  for (;;) {
    ws();
    let sign: 1 | -1 = 1;
    if (s[i] === '+' || s[i] === '-') { if (s[i] === '-') sign = -1; i++; ws(); } else if (terms.length) return null;
    if (terms.length >= DICE_TERMS) return null;
    const isDie = () => s[i] === 'd' && /[\d%(@]/.test(s[i + 1] ?? '');
    let n: Num | null = 1;
    if (!isDie()) {
      n = num();
      if (n === null) return null;
      ws();
    }
    if (!isDie()) terms.push({ s: sign, v: n });
    else {
      i++;
      let d: Num | null;
      if (s[i] === '%') { d = 100; i++; } else d = num();
      if (d === null || (typeof d === 'number' && (d < 2 || d > DICE_SIDES))) return null;
      if (typeof n === 'number' && n > DICE_COUNT) return null;
      const t: DiceTerm = { s: sign, n, d };
      for (;;) { // how to read them
        const two = s.slice(i, i + 2), m = /^(>=|<=|>|<|=)/.exec(s.slice(i));
        if (two === 'kh' || two === 'kl' || two === 'dh' || two === 'dl' || s[i] === 'k') {
          if (t.keep) return null;
          i += s[i] === 'k' && two !== 'kh' && two !== 'kl' ? 1 : 2;
          const k = /^\d/.test(s[i] ?? '') ? digits(3) : 1;
          if (k === null) return null;
          t.keep = { hi: two !== 'kl' && two !== 'dh', drop: two[0] === 'd', n: k };
        } else if (s[i] === '!') {
          if (t.x !== undefined) return null;
          i++;
          const x = /^\d/.test(s[i] ?? '') ? digits() : 0;
          if (x === null) return null;
          t.x = x;
        } else if (m) {
          if (t.c) return null;
          i += m[1].length;
          const c = digits();
          if (c === null) return null;
          t.c = [m[1] as Cmp, c];
        } else break;
      }
      terms.push(t);
    }
    ws();
    if (i >= s.length) break;
  }
  return terms.length ? { terms } : null;
}

export interface PlanDice { s: 1 | -1; n: number; d: number; keep?: { hi: boolean; n: number }; x?: number; c?: [Cmp, number]; real: boolean }
export interface PlanNum { s: 1 | -1; v: number }
/** A roll with every number worked out. `kinds` are the physical dice to throw; `text` is the notation for exactly this roll. */
export interface RollPlan { terms: (PlanDice | PlanNum)[]; kinds: Kind[]; text: string }

const REAL = [4, 6, 8, 10, 12, 20, 100];

/**
 * Work a roll out for one actor. A `mode` (advantage, a pushed roll…) changes every term of
 * its die that does not already say which dice to keep.
 */
export function planRoll(ast: DiceAst, scope: Scope = NOTHING, mode: Mode | null = null): RollPlan {
  const budget = { n: EXPR_STEPS };
  const terms: (PlanDice | PlanNum)[] = [], kinds: Kind[] = [];
  let used = 0;
  for (const t of ast.terms) {
    if ('v' in t) { terms.push({ s: t.s, v: evalExpr(t.v, scope, budget) }); continue; }
    const d = Math.max(2, Math.min(DICE_SIDES, evalExpr(t.d, scope, budget)));
    const base = Math.max(0, Math.min(DICE_COUNT, evalExpr(t.n, scope, budget)));
    let n = base, keep = t.keep ? { hi: t.keep.hi, n: Math.max(0, t.keep.drop ? base - t.keep.n : t.keep.n) } : undefined;
    if (mode && mode.die === d && !keep) {
      n = Math.max(0, Math.min(DICE_COUNT, base + mode.add));
      if (mode.keep) keep = { hi: mode.keep === 'h', n: base };
    }
    if (keep && keep.n >= n) keep = undefined;
    const cost = n * (d === 100 ? 2 : 1), real = n > 0 && REAL.includes(d) && used + cost <= MAX_REAL;
    if (real) {
      used += cost;
      for (let i = 0; i < n; i++) kinds.push(...(d === 100 ? ['d100', 'd10'] as Kind[] : [`d${d}` as Kind]));
    }
    terms.push({ s: t.s, n, d, ...(keep ? { keep } : {}), ...(t.x !== undefined ? { x: t.x } : {}), ...(t.c ? { c: t.c } : {}), real });
  }
  // (A bonus of nothing is left out: `d20`, not `d20+0`.)
  const text = terms.filter((t) => !('v' in t) || t.v !== 0 || terms.length === 1).map((t, i) => {
    if ('v' in t) { const v = t.s * t.v; return `${v < 0 ? '-' : i ? '+' : ''}${Math.abs(v)}`; }
    return `${t.s < 0 ? '-' : i ? '+' : ''}${t.n}d${t.d}${t.keep ? `k${t.keep.hi ? 'h' : 'l'}${t.keep.n}` : ''}${t.x === undefined ? '' : `!${t.x || ''}`}${t.c ? t.c.join('') : ''}`;
  }).join('');
  return { terms, kinds, text };
}

/** One die of a roll that has been read. */
export interface DieRead { d: number; v: number; kept: boolean; hit?: boolean; burst?: boolean }
export interface RollRead {
  /** The result: the sum, or the number of successes when the roll counts them. */
  total: number;
  counted: boolean;
  /** The highest face kept in the first group of dice (a "natural 20"), and how many dice show a 1. */
  nat: number;
  ones: number;
  terms: { s: 1 | -1; value: number; dice?: DieRead[] }[];
  /** The numbers used for what had no physical die, in order: they travel with the throw. */
  extra: number[];
}

const cmp = (v: number, [op, n]: [Cmp, number]) => (op === '>=' ? v >= n : op === '<=' ? v <= n : op === '>' ? v > n : op === '<' ? v < n : v === n);

/**
 * Read a planned roll. `faces` are what the physical dice landed on, one per die in the order
 * of `plan.kinds` (a tens die and its d10 count as one: see `rollValues` in dice.ts). `extra`
 * are the recorded numbers for the rest; the thrower passes `rng` to make them, everyone else
 * replays the list. A missing number reads as 1 and a malformed one is clamped, never trusted.
 */
export function readRoll(plan: RollPlan, faces: number[], extra: number[] = [], rng?: (sides: number) => number): RollRead {
  const used: number[] = [];
  let f = 0, e = 0;
  const face = (d: number, v: unknown) => Math.max(1, Math.min(d, int(v) || 1));
  const more = (d: number): number => {
    const v = face(d, e < extra.length ? extra[e] : rng ? rng(d) : 1);
    e++;
    used.push(v);
    return v;
  };
  const out: RollRead = { total: 0, counted: false, nat: 0, ones: 0, terms: [], extra: used };
  let first = true;
  for (const t of plan.terms) {
    if ('v' in t) { out.terms.push({ s: t.s, value: t.v }); out.total += t.s * t.v; continue; }
    const dice: DieRead[] = [];
    for (let i = 0; i < t.n; i++) dice.push({ d: t.d, v: t.real ? face(t.d, faces[f++]) : more(t.d), kept: true });
    if (t.x !== undefined) {
      const at = t.x || t.d;
      // The scripted and the replayed reading stop at the same die: when the recorded numbers run out.
      for (let i = 0, bursts = 0; i < dice.length && bursts < BURSTS; i++) {
        if (dice[i].v < at || (!rng && e >= extra.length)) continue;
        dice[i].burst = true;
        dice.push({ d: t.d, v: more(t.d), kept: true });
        bursts++;
      }
    }
    if (t.keep) {
      const order = dice.map((_, i) => i).sort((a, b) => (t.keep!.hi ? dice[b].v - dice[a].v : dice[a].v - dice[b].v) || a - b);
      order.slice(t.keep.n).forEach((i) => { dice[i].kept = false; });
    }
    let value = 0;
    for (const die of dice) {
      if (die.v === 1) out.ones++;
      if (!die.kept) continue;
      if (first) out.nat = Math.max(out.nat, die.v);
      if (t.c) { die.hit = cmp(die.v, t.c); if (die.hit) value++; } else value += die.v;
    }
    if (t.c) out.counted = true;
    first = false;
    out.terms.push({ s: t.s, value, dice });
    out.total += t.s * value;
  }
  out.total = int(out.total);
  return out;
}

/** A read roll as plain text: `[14 (5)] + 3`. Dropped dice are in brackets, exploded ones marked `!`. */
export function rollText(r: RollRead): string {
  return r.terms.map((t, i) => {
    const sign = t.s < 0 ? '− ' : i ? '+ ' : '';
    if (!t.dice) { const v = t.s * t.value; return `${v < 0 ? '− ' : i ? '+ ' : ''}${Math.abs(v)}`; }
    return `${sign}[${t.dice.map((d) => `${d.kept ? '' : '('}${d.v}${d.burst ? '!' : ''}${d.kept ? '' : ')'}`).join(' ')}]`;
  }).join(' ');
}

// ---- the format --------------------------------------------------------------------------

export type FieldType = 'number' | 'resource' | 'text' | 'toggle' | 'choice' | 'derived';
export type StatValue = number | string | boolean;
/**
 * One thing on the sheet.
 *  - number    a whole number someone enters (`min`, `max`, `def`)
 *  - resource  something spent and regained, with a maximum. `max` as a number or a formula
 *              fixes the maximum; without it the maximum is entered too (as `<id>.max`).
 *              `up` counts up from nothing (wounds taken) instead of down from full.
 *  - text      a few words          - toggle  on or off (1 or 0 in formulas)
 *  - choice    one of `options` (its position, from 0, in formulas)
 *  - derived   `formula`, never stored
 * `roll` makes it tappable: dice notation, thrown under the field's name.
 */
export interface Field {
  id: string; name: string; type: FieldType;
  short?: string; hide?: boolean;
  min?: number; max?: Num; def?: StatValue; up?: boolean;
  options?: { id: string; name: string }[];
  formula?: string;
  roll?: string;
}
export interface Section { name: string; fields: Field[] }
/** A named roll. With `vs` (an expression, usually about the `target.`) the result is called `win` or `lose`. `into: 'ini'` puts the total into the turn order. */
export interface RollDef { id: string; name: string; dice: string; vs?: string; win?: string; lose?: string; into?: 'ini' }
/** A way of rolling: every roll of `die` gains `add` dice and, with `keep`, keeps as many as it started with ('h'ighest or 'l'owest). */
export interface Mode { id: string; name: string; die: number; add: number; keep?: 'h' | 'l'; cancels?: string }
export type Op = 'add' | 'mul' | 'set' | 'min' | 'max';
/**
 * A change a condition makes to a stat while it is on. `mul` may carry `div` (multiply, then
 * divide rounding down: `mul 1 div 2` halves). `min` caps the stat at the value, `max` raises
 * it to at least the value.
 */
export interface Mod { target: string; op: Op; value: Num; priority?: number; div?: number }
export interface Condition { id: string; name: string; icon?: string; mods: Mod[]; mode?: string }
export type Who = 'self' | 'target';
/** What a trigger may do: a closed set. */
export type Edit =
  | { stat: string; op: Op; value: Num; who?: Who }
  | { cond: string; on: boolean; who?: Who }
  | { say: string }
  | { roll: string; name?: string }
  /** Extension point: handed to an injected runner (see `ScriptRunner`); ignored without one. */
  | { script: string };
export const TRIGGER_ON = ['turn.start', 'turn.end', 'roll', 'hp.zero'] as const;
export type TriggerOn = (typeof TRIGGER_ON)[number];
/** When `on` happens (for 'roll': optionally only the named `roll`) and `if` holds, `do` the edits in order. */
export interface Trigger { on: TriggerOn; roll?: string; if?: string; do: Edit[] }
export interface System {
  v: 1; id: string; name: string; about?: string;
  /** The resource drawn as the bar over a piece, stored in the piece's old `hp`/`mhp`. */
  hp?: string;
  /** The dice the tray offers. */
  dice: number[];
  sections: Section[]; rolls: RollDef[]; modes: Mode[]; conditions: Condition[]; triggers: Trigger[];
  /** Small programs a trigger's `{ script }` can name: JavaScript source, run boxed in on one device (src/script.ts). */
  scripts?: Record<string, string>;
}
export interface SystemRef { id: string; name: string; about?: string; file: string }

const FIELD_ID = /^[a-z][a-z0-9_]{0,15}(\.[a-z][a-z0-9_]{0,7})?$/;
const PLAIN_ID = /^[a-z][a-z0-9_]{0,15}$/;
const RESERVED = new Set(['target', 'roll', 'self', 'name', 'has', ...Object.keys(FUNCS)]);
const OPS: Op[] = ['set', 'mul', 'add', 'min', 'max']; // also the order they apply in at equal priority

const text = (x: unknown, most: number): string => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, most) : '');
const whole = (x: unknown, lo: number, hi: number): number | undefined => (typeof x === 'number' && Number.isInteger(x) ? Math.max(lo, Math.min(hi, x)) : undefined);
function list(x: unknown, most: number, where: string, notes: string[]): unknown[] {
  if (x === undefined) return [];
  if (!Array.isArray(x)) { notes.push(`${where}: not a list`); return []; }
  if (x.length > most) notes.push(`${where}: only the first ${most} are kept`);
  return x.slice(0, most);
}
function known(o: Record<string, unknown>, keys: string[], where: string, notes: string[]): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) notes.push(`${where}: unknown "${k.slice(0, 20)}"`);
}
/** A number or an expression that parses; undefined otherwise. */
function numOrExpr(x: unknown): Num | undefined {
  if (typeof x === 'number') return whole(x, -LIM, LIM);
  return typeof x === 'string' && parseExpr(x) ? x : undefined;
}

function parseField(raw: unknown, where: string, taken: Set<string>, notes: string[]): Field | null {
  const drop = (why: string) => { notes.push(`${where}: ${why}`); return null; };
  if (!isObj(raw)) return drop('not a field');
  const id = raw.id, type = raw.type as FieldType;
  if (typeof id !== 'string' || !FIELD_ID.test(id) || RESERVED.has(id.split('.')[0]) || id.endsWith('.max')) return drop('bad id');
  if (taken.has(id)) return drop(`"${id}" is already used`);
  if (!['number', 'resource', 'text', 'toggle', 'choice', 'derived'].includes(type)) return drop(`"${id}" has an unknown type`);
  known(raw, ['id', 'name', 'type', 'short', 'hide', 'min', 'max', 'def', 'up', 'options', 'formula', 'roll'], `${where} "${id}"`, notes);
  const f: Field = { id, name: text(raw.name, 24) || id, type };
  if (text(raw.short, 6)) f.short = text(raw.short, 6);
  if (raw.hide === true) f.hide = true;
  if (type === 'number') {
    const min = whole(raw.min, -LIM, LIM), max = whole(raw.max, -LIM, LIM), def = whole(raw.def, -LIM, LIM);
    if (min !== undefined) f.min = min;
    if (max !== undefined && max >= (min ?? -LIM)) f.max = max;
    if (def !== undefined) f.def = def;
  } else if (type === 'resource') {
    if (raw.max !== undefined) {
      const max = numOrExpr(raw.max);
      if (max === undefined) return drop(`"${id}" has a maximum that is not a number or a formula`);
      f.max = max;
    }
    if (raw.up === true) f.up = true;
  } else if (type === 'text') {
    if (text(raw.def, 60)) f.def = text(raw.def, 60);
  } else if (type === 'toggle') {
    if (raw.def === true) f.def = true;
  } else if (type === 'choice') {
    const options: { id: string; name: string }[] = [];
    for (const o of list(raw.options, OPTIONS, `${where} "${id}" options`, notes)) {
      if (isObj(o) && typeof o.id === 'string' && PLAIN_ID.test(o.id) && !options.some((p) => p.id === o.id)) options.push({ id: o.id, name: text(o.name, 24) || o.id });
      else notes.push(`${where} "${id}": bad option`);
    }
    if (!options.length) return drop(`"${id}" has no options`);
    f.options = options;
    if (options.some((o) => o.id === raw.def)) f.def = raw.def as string;
  } else {
    if (typeof raw.formula !== 'string' || !parseExpr(raw.formula)) return drop(`"${id}" has a formula that does not parse`);
    f.formula = raw.formula;
  }
  if (raw.roll !== undefined) {
    if (typeof raw.roll === 'string' && parseDice(raw.roll)) f.roll = raw.roll;
    else notes.push(`${where} "${id}": roll does not parse`);
  }
  taken.add(id);
  return f;
}

/** The edits of a trigger (or what a script hands back): only the closed set survives. */
export function parseEdits(raw: unknown, notes: string[] = [], where = 'edits'): Edit[] {
  const out: Edit[] = [];
  for (const e of list(raw, EDITS, where, notes)) {
    const bad = () => { notes.push(`${where}: an edit was not understood`); };
    if (!isObj(e)) { bad(); continue; }
    const who: { who?: Who } = e.who === 'target' ? { who: 'target' } : {};
    if (e.who !== undefined && e.who !== 'self' && e.who !== 'target') { bad(); continue; }
    if (typeof e.stat === 'string') {
      const value = numOrExpr(e.value);
      if (!FIELD_ID.test(e.stat) || !OPS.includes(e.op as Op) || value === undefined) { bad(); continue; }
      known(e, ['stat', 'op', 'value', 'who'], where, notes);
      out.push({ stat: e.stat, op: e.op as Op, value, ...who });
    } else if (typeof e.cond === 'string') {
      if (!PLAIN_ID.test(e.cond) || typeof e.on !== 'boolean') { bad(); continue; }
      known(e, ['cond', 'on', 'who'], where, notes);
      out.push({ cond: e.cond, on: e.on, ...who });
    } else if (typeof e.say === 'string') {
      if (!text(e.say, 160)) { bad(); continue; }
      known(e, ['say'], where, notes);
      out.push({ say: text(e.say, 160) });
    } else if (typeof e.roll === 'string') {
      if (!parseDice(e.roll)) { bad(); continue; }
      known(e, ['roll', 'name'], where, notes);
      out.push({ roll: e.roll, ...(text(e.name, 24) ? { name: text(e.name, 24) } : {}) });
    } else if (typeof e.script === 'string') {
      if (!/^[\w.-]{1,40}$/.test(e.script)) { bad(); continue; }
      known(e, ['script'], where, notes);
      out.push({ script: e.script });
    } else bad();
  }
  return out;
}

/**
 * Read a system from untrusted data. Returns null if it is not one at all (wrong version, no
 * name, nothing on the sheet); otherwise whatever in it is understood, cut to size. `notes`
 * collects a line for everything that was dropped or ignored.
 */
export function parseSystem(raw: unknown, notes: string[] = []): System | null {
  if (!isObj(raw) || raw.v !== 1) return null;
  const name = text(raw.name, 40);
  if (!name) return null;
  known(raw, ['v', 'id', 'name', 'about', 'hp', 'dice', 'sections', 'rolls', 'modes', 'conditions', 'triggers', 'scripts'], 'system', notes);
  const sys: System = { v: 1, id: typeof raw.id === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(raw.id) ? raw.id : 'custom', name, dice: [], sections: [], rolls: [], modes: [], conditions: [], triggers: [] };
  if (text(raw.about, 200)) sys.about = text(raw.about, 200);

  const taken = new Set<string>();
  list(raw.sections, SECTIONS, 'sections', notes).forEach((s, i) => {
    if (!isObj(s)) { notes.push(`section ${i + 1}: not a section`); return; }
    known(s, ['name', 'fields'], `section ${i + 1}`, notes);
    const fields = list(s.fields, FIELDS, `section ${i + 1}`, notes).map((f) => parseField(f, `section ${i + 1}`, taken, notes)).filter((f): f is Field => !!f);
    if (fields.length) sys.sections.push({ name: text(s.name, 24), fields });
  });
  if (!sys.sections.length) return null;
  const fields = new Map(sys.sections.flatMap((s) => s.fields).map((f) => [f.id, f]));
  /** Can a condition or a trigger change this? */
  const numeric = (id: string) => (id.endsWith('.max') ? fields.get(id.slice(0, -4))?.type === 'resource' : ['number', 'resource', 'derived', 'toggle'].includes(fields.get(id)?.type ?? ''));

  if (raw.hp !== undefined) {
    if (typeof raw.hp === 'string' && fields.get(raw.hp)?.type === 'resource') sys.hp = raw.hp;
    else notes.push('hp: not a resource on the sheet');
  }
  const dice = raw.dice === undefined ? REAL : list(raw.dice, REAL.length, 'dice', notes);
  for (const d of dice) {
    if (typeof d === 'number' && REAL.includes(d) && !sys.dice.includes(d)) sys.dice.push(d);
    else notes.push('dice: not a die the tray has');
  }

  const modeIds = new Set<string>();
  for (const m of list(raw.modes, MODES, 'modes', notes)) {
    const die = isObj(m) ? whole(m.die, 2, DICE_SIDES) : undefined, add = isObj(m) ? whole(m.add, -10, 10) : undefined;
    if (!isObj(m) || typeof m.id !== 'string' || !PLAIN_ID.test(m.id) || modeIds.has(m.id) || die === undefined || add === undefined) { notes.push('modes: one was not understood'); continue; }
    known(m, ['id', 'name', 'die', 'add', 'keep', 'cancels'], `mode "${m.id}"`, notes);
    modeIds.add(m.id);
    sys.modes.push({ id: m.id, name: text(m.name, 24) || m.id, die, add, ...(m.keep === 'h' || m.keep === 'l' ? { keep: m.keep } : {}), ...(typeof m.cancels === 'string' && PLAIN_ID.test(m.cancels) ? { cancels: m.cancels } : {}) });
  }

  const rollIds = new Set<string>();
  for (const r of list(raw.rolls, ROLLS, 'rolls', notes)) {
    if (!isObj(r) || typeof r.id !== 'string' || !PLAIN_ID.test(r.id) || rollIds.has(r.id) || !parseDice(r.dice)) { notes.push('rolls: one was not understood'); continue; }
    known(r, ['id', 'name', 'dice', 'vs', 'win', 'lose', 'into'], `roll "${r.id}"`, notes);
    const def: RollDef = { id: r.id, name: text(r.name, 24) || r.id, dice: r.dice as string };
    if (r.vs !== undefined) {
      if (typeof r.vs === 'string' && parseExpr(r.vs)) { def.vs = r.vs; def.win = text(r.win, 16) || 'Success'; def.lose = text(r.lose, 16) || 'Failure'; }
      else notes.push(`roll "${r.id}": vs does not parse`);
    }
    if (r.into !== undefined) { if (r.into === 'ini') def.into = 'ini'; else notes.push(`roll "${r.id}": unknown into`); }
    rollIds.add(r.id);
    sys.rolls.push(def);
  }

  const condIds = new Set<string>();
  for (const c of list(raw.conditions, CONDS, 'conditions', notes)) {
    if (!isObj(c) || typeof c.id !== 'string' || !PLAIN_ID.test(c.id) || condIds.has(c.id)) { notes.push('conditions: one was not understood'); continue; }
    const where = `condition "${c.id}"`;
    known(c, ['id', 'name', 'icon', 'mods', 'mode'], where, notes);
    const cond: Condition = { id: c.id, name: text(c.name, 24) || c.id, mods: [] };
    if (text(c.icon, 8)) cond.icon = [...text(c.icon, 8)].slice(0, 4).join('');
    for (const m of list(c.mods, MODS, where, notes)) {
      const value = isObj(m) ? numOrExpr(m.value) : undefined;
      if (!isObj(m) || typeof m.target !== 'string' || !numeric(m.target) || !OPS.includes(m.op as Op) || value === undefined) { notes.push(`${where}: a modifier was not understood`); continue; }
      known(m, ['target', 'op', 'value', 'priority', 'div'], where, notes);
      const priority = whole(m.priority, -100, 100), div = m.op === 'mul' ? whole(m.div, 1, 1000) : undefined;
      cond.mods.push({ target: m.target, op: m.op as Op, value, ...(priority ? { priority } : {}), ...(div && div > 1 ? { div } : {}) });
    }
    if (c.mode !== undefined) { if (typeof c.mode === 'string' && modeIds.has(c.mode)) cond.mode = c.mode; else notes.push(`${where}: unknown mode`); }
    condIds.add(c.id);
    sys.conditions.push(cond);
  }

  list(raw.triggers, TRIGGERS, 'triggers', notes).forEach((t, i) => {
    const where = `trigger ${i + 1}`;
    if (!isObj(t) || !TRIGGER_ON.includes(t.on as TriggerOn)) { notes.push(`${where}: not understood`); return; }
    known(t, ['on', 'roll', 'if', 'do'], where, notes);
    if (t.if !== undefined && (typeof t.if !== 'string' || !parseExpr(t.if))) { notes.push(`${where}: its condition does not parse`); return; }
    if (t.roll !== undefined && (t.on !== 'roll' || typeof t.roll !== 'string' || !(rollIds.has(t.roll) || fields.get(t.roll)?.roll))) { notes.push(`${where}: unknown roll`); return; }
    const edits = parseEdits(t.do, notes, where).filter((e) => {
      const ok = 'stat' in e ? numeric(e.stat) && fields.get(e.stat)?.type !== 'derived' : 'cond' in e ? condIds.has(e.cond) : true;
      if (!ok) notes.push(`${where}: an edit names something that is not on the sheet`);
      return ok;
    });
    if (!edits.length) { notes.push(`${where}: does nothing`); return; }
    sys.triggers.push({ on: t.on as TriggerOn, ...(t.roll ? { roll: t.roll as string } : {}), ...(t.if ? { if: t.if as string } : {}), do: edits });
  });

  // ---- scripts: source text only, kept or dropped whole; nothing here runs it (src/script.ts) ----
  if (raw.scripts !== undefined) {
    const scripts: Record<string, string> = {};
    let n = 0, size = 0;
    for (const [k, src] of isObj(raw.scripts) ? Object.entries(raw.scripts) : []) {
      if (!PLAIN_ID.test(k) || typeof src !== 'string' || !src.trim() || src.length > SCRIPT_LEN || n >= SCRIPTS || size + src.length > SCRIPTS_LEN) { notes.push('scripts: one was dropped (bad name, empty, too long or too many)'); continue; }
      scripts[k] = src; n++; size += src.length;
    }
    if (n) sys.scripts = scripts; else notes.push('scripts: none understood');
  }
  // ---- end of scripts ----
  return sys;
}

/** The list of systems on offer (`public/systems/index.json`). */
export function parseIndex(raw: unknown): SystemRef[] {
  const out: SystemRef[] = [];
  for (const r of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    if (isObj(r) && typeof r.file === 'string' && /^[a-z0-9][a-z0-9-]{0,31}\.json$/.test(r.file) && text(r.name, 40)) {
      out.push({ id: r.file.slice(0, -5), name: text(r.name, 40), file: r.file, ...(text(r.about, 200) ? { about: text(r.about, 200) } : {}) });
    }
  }
  return out;
}

// ---- the sheet: derived on every device ----------------------------------------------------

/** What of a piece the rules read. */
export type Vals = Pick<MiniVal, 'sv' | 'cn' | 'hp' | 'mhp'>;
export interface Sheet {
  /** Every numeric stat by name, modifiers applied, with `<resource>.max` beside each resource. */
  num: Map<string, number>;
  /** Texts and choices as entered. */
  str: Map<string, string>;
  /** The conditions that are on, in the system's order. */
  conds: string[];
  /** What is left of the bar resource and its maximum (absent: no bar). */
  hp?: number; mhp?: number;
}

interface Index {
  fields: Map<string, Field>;
  conds: Map<string, Condition>;
  /** Modifiers by target, already in the order they apply. */
  mods: Map<string, { cond: string; m: Mod }[]>;
}
const indexes = new WeakMap<System, Index>();
function index(sys: System): Index {
  let ix = indexes.get(sys);
  if (ix) return ix;
  const sorted: { cond: string; m: Mod; c: number; i: number }[] = [];
  sys.conditions.forEach((cond, c) => cond.mods.forEach((m, i) => sorted.push({ cond: cond.id, m, c, i })));
  // The fixed order: by priority (lowest first), then set, mul, add, min, max, then the order written.
  sorted.sort((a, b) => (a.m.priority ?? 0) - (b.m.priority ?? 0) || OPS.indexOf(a.m.op) - OPS.indexOf(b.m.op) || a.c - b.c || a.i - b.i);
  const mods = new Map<string, { cond: string; m: Mod }[]>();
  for (const s of sorted) mods.set(s.m.target, [...(mods.get(s.m.target) ?? []), s]);
  ix = { fields: new Map(sys.sections.flatMap((s) => s.fields).map((f) => [f.id, f])), conds: new Map(sys.conditions.map((c) => [c.id, c])), mods };
  indexes.set(sys, ix);
  return ix;
}
export const fieldOf = (sys: System, id: string): Field | undefined => index(sys).fields.get(id);

function applyMod(cur: number, m: Mod, v: number): number {
  switch (m.op) {
    case 'set': return v;
    case 'mul': return divFloor(int(cur * v), m.div ?? 1);
    case 'add': return int(cur + v);
    case 'min': return Math.min(cur, v);
    case 'max': return Math.max(cur, v);
  }
}
const numBounds = (f: Field): [number, number] => [f.min ?? -9999, typeof f.max === 'number' ? f.max : 9999];

/**
 * The sheet of a piece: what was entered, the formulas worked out, and the modifiers of its
 * conditions applied. A stat's modifiers apply in a fixed order: lowest `priority` first, and
 * at equal priority set, then mul, add, min, max, then the order they are written in. Formulas
 * see the modified values of what they read. Anything circular reads as 0.
 */
export function derive(sys: System, v: Vals): Sheet {
  const ix = index(sys), sv: Record<string, unknown> = isObj(v.sv) ? v.sv : {};
  const on = new Set((Array.isArray(v.cn) ? v.cn : []).filter((c) => typeof c === 'string'));
  const conds = sys.conditions.filter((c) => on.has(c.id)).map((c) => c.id);
  const budget = { n: SHEET_STEPS }, memo = new Map<string, number>(), busy = new Set<string>();
  const stored = (id: string) => (own(sv, id) ? sv[id] : undefined);
  const scope: Scope = { num, has: (c) => conds.includes(c) };
  function base(name: string): number {
    const isMax = name.endsWith('.max'), f = ix.fields.get(isMax ? name.slice(0, -4) : name);
    if (!f) return 0;
    if (isMax) {
      if (f.type !== 'resource') return 0;
      if (f.max !== undefined) return Math.max(0, evalExpr(f.max, scope, budget));
      return Math.max(0, Math.min(9999, int(sys.hp === f.id ? v.mhp : stored(name))));
    }
    switch (f.type) {
      case 'number': { const [lo, hi] = numBounds(f), s = stored(f.id); return Math.max(lo, Math.min(hi, int(typeof s === 'number' ? s : f.def ?? 0))); }
      case 'toggle': return (stored(f.id) ?? f.def) === true ? 1 : 0;
      case 'choice': return Math.max(0, f.options!.findIndex((o) => o.id === (stored(f.id) ?? f.def)));
      case 'derived': return evalExpr(f.formula!, scope, budget);
      case 'resource': {
        const max = num(`${f.id}.max`), cap = (x: number) => Math.max(0, max > 0 ? Math.min(max, x) : x);
        const s = stored(f.id);
        if (sys.hp !== f.id) return cap(int(typeof s === 'number' ? s : f.up ? 0 : max));
        const left = cap(int(typeof v.hp === 'number' ? v.hp : max)); // the bar holds what is left
        return f.up ? max - left : left;
      }
      default: return 0;
    }
  }
  function num(name: string): number {
    const hit = memo.get(name);
    if (hit !== undefined) return hit;
    if (busy.has(name)) return 0;
    busy.add(name);
    let out = base(name);
    for (const { cond, m } of ix.mods.get(name) ?? []) if (on.has(cond)) out = applyMod(out, m, evalExpr(m.value, scope, budget));
    busy.delete(name);
    memo.set(name, out = int(out));
    return out;
  }
  const sheet: Sheet = { num: new Map(), str: new Map(), conds };
  for (const f of ix.fields.values()) {
    if (f.type === 'text') { sheet.str.set(f.id, text(stored(f.id) ?? f.def, 60)); continue; }
    sheet.num.set(f.id, num(f.id));
    if (f.type === 'choice') sheet.str.set(f.id, f.options![num(f.id)].id);
    if (f.type === 'resource') sheet.num.set(`${f.id}.max`, num(`${f.id}.max`));
  }
  const bar = sys.hp && ix.fields.get(sys.hp);
  if (bar && num(`${bar.id}.max`) > 0) {
    sheet.mhp = num(`${bar.id}.max`);
    sheet.hp = bar.up ? sheet.mhp - num(bar.id) : num(bar.id);
  }
  return sheet;
}

/** What formulas, rolls and triggers can read: the actor's stats, `target.…` and `roll.…`. */
export function scopeOf(self: Sheet | null, target: Sheet | null = null, roll: RollFacts | null = null): Scope {
  const facts = (name: string): number => {
    if (!roll) return 0;
    switch (name) {
      case 'total': return roll.total;
      case 'nat': return roll.nat;
      case 'ones': return roll.ones;
      case 'vs': return roll.vs ?? 0;
      case 'ok': return roll.vs === undefined || roll.total >= roll.vs ? 1 : 0;
      case 'target': return target ? 1 : 0;
      default: return 0;
    }
  };
  const cut = (name: string): [Sheet | null, string] => (name.startsWith('target.') ? [target, name.slice(7)] : [self, name.startsWith('self.') ? name.slice(5) : name]);
  return {
    num: (name) => { if (name.startsWith('roll.')) return facts(name.slice(5)); const [s, n] = cut(name); return s?.num.get(n) ?? 0; },
    has: (name) => { const [s, n] = cut(name); return !!s && s.conds.includes(n); },
  };
}

/** What the board draws over a piece: the bar, and the icons of its conditions. */
export function face(sys: System | null, v: MiniVal): { hp?: number; mhp?: number; marks: string } {
  if (!sys) return { hp: v.hp, mhp: v.mhp, marks: '' };
  const s = derive(sys, v), ix = index(sys);
  return { hp: s.hp, mhp: s.mhp, marks: s.conds.map((c) => ix.conds.get(c)!.icon ?? '').filter(Boolean).slice(0, 5).join('') };
}

// ---- writing: only what was entered ---------------------------------------------------------

function withSv(v: MiniVal, id: string, value: StatValue): MiniVal {
  const sv = isObj(v.sv) ? v.sv : {};
  return sv[id] === value ? v : { ...v, sv: { ...sv, [id]: value } };
}

/**
 * Enter a value on a piece's sheet (`<resource>.max` for a maximum that is entered). The value
 * is clamped to what the field allows; anything that does not fit returns the piece unchanged.
 * The bar resource is written to the old `hp`/`mhp`, so the bar, the ring and tables without
 * the system keep working.
 */
export function setStat(sys: System, v: MiniVal, id: string, value: StatValue): MiniVal {
  const isMax = id.endsWith('.max'), f = fieldOf(sys, isMax ? id.slice(0, -4) : id);
  if (!f) return v;
  const bar = sys.hp === f.id;
  if (isMax) {
    if (f.type !== 'resource' || f.max !== undefined || typeof value !== 'number') return v;
    const max = Math.max(0, Math.min(9999, int(value)));
    if (!bar) return withSv(v, id, max);
    return v.mhp === max ? v : { ...v, mhp: max, ...(v.hp === undefined ? {} : { hp: Math.min(v.hp, max) }) };
  }
  switch (f.type) {
    case 'number': { const [lo, hi] = numBounds(f); return typeof value === 'number' ? withSv(v, id, Math.max(lo, Math.min(hi, int(value)))) : v; }
    case 'text': return typeof value === 'string' ? withSv(v, id, text(value, 60)) : v;
    case 'toggle': return typeof value === 'boolean' ? withSv(v, id, value) : typeof value === 'number' ? withSv(v, id, value !== 0) : v;
    case 'choice': return typeof value === 'string' && f.options!.some((o) => o.id === value) ? withSv(v, id, value) : v;
    case 'resource': {
      if (typeof value !== 'number') return v;
      const max = derive(sys, v).num.get(`${id}.max`) ?? 0;
      const cur = Math.max(0, max > 0 ? Math.min(max, int(value)) : int(value));
      if (!bar) return withSv(v, id, cur);
      const left = f.up ? Math.max(0, max - cur) : cur;
      return v.hp === left ? v : { ...v, hp: left };
    }
    default: return v; // derived: nothing to enter
  }
}

/** Put a condition on a piece or take it off. */
export function setCond(sys: System, v: MiniVal, cond: string, on: boolean): MiniVal {
  if (!index(sys).conds.has(cond)) return v;
  const cur = (Array.isArray(v.cn) ? v.cn : []).filter((c) => typeof c === 'string');
  if (cur.includes(cond) === on) return v;
  const cn = on ? [...cur, cond].slice(-CONDS_ON) : cur.filter((c) => c !== cond);
  const { cn: _, ...rest } = v;
  return cn.length ? { ...rest, cn } : rest;
}

/** The way a roll is made: what the player picked and what the actor's conditions impose, less whatever cancels out. */
export function modeFor(sys: System, picked: string | null, conds: string[]): Mode | null {
  const ix = index(sys), ids = new Set<string>(picked ? [picked] : []);
  for (const c of conds) { const m = ix.conds.get(c)?.mode; if (m) ids.add(m); }
  const modes = sys.modes.filter((m) => ids.has(m.id));
  const left = modes.filter((m) => !modes.some((o) => o.id !== m.id && (m.cancels === o.id || o.cancels === m.id)));
  return left[0] ?? null;
}

// ---- who applies what ------------------------------------------------------------------------
// Triggers, and anything that changes a piece its actor does not control, are applied by one
// device only: the GM's (with several GMs here, the one with the lowest id), or with no GM
// present, the device of whoever acted. Every device works this out the same way from who is
// present, so exactly one of them acts.

export function authority(gms: string[], present: string[], actor: string): string {
  const here = gms.filter((g) => present.includes(g)).sort();
  return here[0] ?? actor;
}

// ---- triggers ----------------------------------------------------------------------------------

export interface Piece { id: string; v: MiniVal; name?: string }
export interface RollFacts { id: string; total: number; nat: number; ones: number; vs?: number }
/** Something that happened at the table. `id` names this one happening, the same on every device. */
export interface GameEvent { on: TriggerOn; id: string; self?: Piece; target?: Piece; roll?: RollFacts }
/** What the triggers decided: pieces as they should now be stored, lines for the chat, scripts to run. */
export interface Fired { minis: Piece[]; lines: string[]; scripts: string[] }

/**
 * Extension point. A trigger's `{ script: name }` is handed to a runner injected by the app
 * (none by default: the edit is ignored). The runner gets plain data and may answer with edits
 * from the same closed set a trigger can do; they go through `parseEdits` like any other.
 */
export interface ScriptCtx {
  on: TriggerOn; event: string;
  self?: { id: string; name: string; stats: Record<string, number>; conds: string[] };
  target?: { id: string; name: string; stats: Record<string, number>; conds: string[] };
  roll?: RollFacts;
}
export type ScriptRunner = (name: string, ctx: ScriptCtx) => Promise<unknown>;

export function scriptCtx(sys: System, ev: GameEvent): ScriptCtx {
  const one = (p?: Piece) => { if (!p) return undefined; const s = derive(sys, p.v); return { id: p.id, name: p.name ?? p.v.n ?? '', stats: Object.fromEntries(s.num), conds: s.conds }; };
  return { on: ev.on, event: ev.id, self: one(ev.self), target: one(ev.target), ...(ev.roll ? { roll: ev.roll } : {}) };
}

const applied = (p: Piece | undefined, id: string) => !!p && Array.isArray(p.v.fx) && p.v.fx.includes(id);

/**
 * Do a list of edits for an event. Edits run in order and each sees what the ones before it
 * did. The result holds whole pieces to store, never differences, each marked with the event's
 * id (a piece remembers the last few): an event that already marked a piece does nothing, so
 * applying one twice, or late, is harmless.
 */
export function runEdits(sys: System, ev: GameEvent, edits: Edit[], rng: (sides: number) => number = () => 1): Fired {
  const out: Fired = { minis: [], lines: [], scripts: [] };
  if (applied(ev.self, ev.id) || applied(ev.target, ev.id)) return out;
  let self = ev.self?.v, target = ev.target?.v, roll = ev.roll ?? null;
  const scope = () => scopeOf(self ? derive(sys, self) : null, target ? derive(sys, target) : null, roll);
  const nameOf = (p?: Piece) => p?.name || p?.v.n || 'Someone';
  for (const e of edits.slice(0, TRIGGERS * EDITS)) {
    if ('script' in e) { out.scripts.push(e.script); continue; }
    if ('say' in e) {
      out.lines.push(e.say.replace(/\{([^{}]{1,80})\}/g, (_, x: string) => (x === 'name' ? nameOf(ev.self) : x === 'target' ? nameOf(ev.target) : String(evalExpr(x, scope())))).slice(0, 200));
      continue;
    }
    if ('roll' in e) {
      const plan = planRoll(parseDice(e.roll)!, scope());
      for (const t of plan.terms) if ('real' in t) t.real = false; // nobody throws these: they are rolled as numbers
      const read = readRoll(plan, [], [], rng);
      roll = { id: '', total: read.total, nat: read.nat, ones: read.ones };
      out.lines.push(`${nameOf(ev.self)} · ${e.name ?? e.roll}: ${read.total} ${rollText(read)}`.slice(0, 200));
      continue;
    }
    const cur = e.who === 'target' ? target : self;
    if (!cur) continue;
    let next: MiniVal;
    if ('cond' in e) next = setCond(sys, cur, e.cond, e.on);
    else {
      // A stat is changed as it was entered: the modifiers of conditions stay on top of it.
      const raw = derive(sys, { ...cur, cn: [] }).num.get(e.stat) ?? 0;
      next = setStat(sys, cur, e.stat, applyMod(raw, { target: e.stat, op: e.op, value: 0 }, evalExpr(e.value, scope())));
    }
    if (e.who === 'target') target = next; else self = next;
  }
  const mark = (v: MiniVal): MiniVal => ({ ...v, fx: [...(Array.isArray(v.fx) ? v.fx : []), ev.id].slice(-FX) });
  const did = out.lines.length > 0 || out.scripts.length > 0;
  // Something that only spoke still marks the piece it was about, so it is not said again.
  if (ev.self && self && (self !== ev.self.v || (did && (!ev.target || target === ev.target.v)))) out.minis.push({ ...ev.self, v: mark(self) });
  if (ev.target && target && (target !== ev.target.v || (did && !ev.self))) out.minis.push({ ...ev.target, v: mark(target) });
  return out;
}

/** Everything the system's triggers do about an event. */
export function fire(sys: System, ev: GameEvent, rng: (sides: number) => number = () => 1): Fired {
  const edits: Edit[] = [];
  const scope = scopeOf(ev.self ? derive(sys, ev.self.v) : null, ev.target ? derive(sys, ev.target.v) : null, ev.roll ?? null);
  for (const t of sys.triggers) {
    if (t.on !== ev.on || (t.roll && t.roll !== ev.roll?.id)) continue;
    if (t.if && !evalExpr(t.if, scope)) continue;
    edits.push(...t.do);
  }
  return edits.length ? runEdits(sys, ev, edits, rng) : { minis: [], lines: [], scripts: [] };
}
