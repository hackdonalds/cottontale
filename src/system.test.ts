import { describe, expect, it } from 'vitest';
import type { MiniVal } from './rules';
import { Store } from './store';
import {
  EXPR_STEPS, authority, derive, evalExpr, face, fire, modeFor, parseDice, parseEdits, parseExpr, parseIndex, parseSystem, planRoll, readRoll,
  rollText, runEdits, scopeOf, scriptCtx, setCond, setStat, type GameEvent, type Piece, type Scope, type System,
} from './system';
import INDEX from '../public/systems/index.json';
import LANTERN from '../public/systems/lantern-d20.json';
import SIX from '../public/systems/six-sides.json';
import HEARTS from '../public/systems/three-hearts.json';

const scope = (vals: Record<string, number>, conds: string[] = []): Scope => ({ num: (n) => vals[n] ?? 0, has: (c) => conds.includes(c) });
const mini = (extra: Partial<MiniVal> = {}): MiniVal => ({ x: 0, y: 0, z: 0, k: 'knight', c: '#fff', n: '', r: 0, s: 1, ...extra });
const sys = (raw: unknown): System => parseSystem(raw)!;
const lantern = sys(LANTERN), six = sys(SIX), hearts = sys(HEARTS);

describe('expressions', () => {
  it('does whole-number arithmetic with the usual precedence', () => {
    expect(evalExpr('1 + 2 * 3')).toBe(7);
    expect(evalExpr('(1 + 2) * 3')).toBe(9);
    expect(evalExpr('10 - 4 - 3')).toBe(3);
    expect(evalExpr('-3 + 5')).toBe(2);
    expect(evalExpr('7 % 3')).toBe(1);
    expect(evalExpr('-7 % 3')).toBe(2);
    expect(evalExpr(12)).toBe(12);
  });
  it('rounds division down unless told otherwise', () => {
    expect(evalExpr('7 / 2')).toBe(3);
    expect(evalExpr('-7 / 2')).toBe(-4);
    expect(evalExpr('floor((8 - 10) / 2)')).toBe(-1);
    expect(evalExpr('floor((7 - 10) / 2)')).toBe(-2);
    expect(evalExpr('ceil(7 / 2)')).toBe(4);
    expect(evalExpr('ceil(-7 / 2)')).toBe(-3);
    expect(evalExpr('round(7 / 2)')).toBe(4);
    expect(evalExpr('round(5 / 4)')).toBe(1);
    expect(evalExpr('round(-7 / 2)')).toBe(-3);
    expect(evalExpr('round(7 / -2)')).toBe(-3);
    expect(evalExpr('floor(5)')).toBe(5);
    expect(evalExpr('5 / 0')).toBe(0);
    expect(evalExpr('5 % 0')).toBe(0);
  });
  it('compares, chooses and calls the built-in functions', () => {
    expect(evalExpr('3 >= 3 && 2 < 1')).toBe(0);
    expect(evalExpr('3 >= 3 || 2 < 1')).toBe(1);
    expect(evalExpr('!0 + !5')).toBe(1);
    expect(evalExpr('2 == 2 ? 10 : 20')).toBe(10);
    expect(evalExpr('2 != 2 ? 10 : 1 ? 20 : 30')).toBe(20);
    expect(evalExpr('min(4, 2, 9) + max(1, 7) + abs(-3) + clamp(15, 0, 10)')).toBe(22);
  });
  it('reads names only through the scope it is given', () => {
    const sc = scope({ str: 16, 'str.mod': 3, 'target.ac': 14 }, ['prone']);
    expect(evalExpr('floor((str - 10) / 2) == str.mod', sc)).toBe(1);
    expect(evalExpr('@str + target.ac', sc)).toBe(30);
    expect(evalExpr('has(prone) ? 1 : 2', sc)).toBe(1);
    expect(evalExpr('has(blind) ? 1 : 2', sc)).toBe(2);
    expect(evalExpr('nothing + 1', sc)).toBe(1);
  });
  it('gives 0 for anything that is not an expression', () => {
    for (const bad of ['', '   ', '1 +', '(1', '1)', '1 2', '1.5', 'a..b', '2d6', '"x"', 'x = 1', 'f(1)', 'min()', 'clamp(1,2)', 'has(1)', 'a[0]', 'a;b', '1e9', '`x`', '${1}', 'x => x', '12345678901']) {
      expect(parseExpr(bad), bad).toBeNull();
      expect(evalExpr(bad), bad).toBe(0);
    }
    for (const bad of [null, undefined, {}, [], 5, true]) expect(parseExpr(bad)).toBeNull();
  });
  it('cannot reach anything but numbers', () => {
    // Names that would be dangerous as property lookups are just names nobody defined.
    const real = derive(lantern, { sv: JSON.parse('{"__proto__": 5, "constructor": 7, "str": 14}') });
    const sc = scopeOf(real);
    for (const name of ['constructor', '__proto__', 'toString', 'constructor.constructor', 'prototype', 'window', 'globalThis', 'process']) expect(evalExpr(name, sc), name).toBe(0);
    expect(parseExpr('constructor("return 1")()')).toBeNull();
    expect(parseExpr('toString()')).toBeNull();
    expect(evalExpr('str', sc)).toBe(14);
    // A scope that misbehaves cannot make evaluation throw or return a non-number.
    expect(evalExpr('x + 1', { num: () => { throw new Error('no'); }, has: () => false })).toBe(0);
    expect(evalExpr('x + 1', { num: () => NaN, has: () => false })).toBe(1);
    expect(evalExpr('x', { num: () => 'boom' as unknown as number, has: () => false })).toBe(0);
    expect(evalExpr('x', { num: () => Infinity, has: () => false })).toBe(0);
  });
  it('is bounded: length, depth, steps and size of numbers', () => {
    expect(parseExpr('1' + '+1'.repeat(200))).toBeNull(); // too long
    expect(parseExpr('('.repeat(40) + '1' + ')'.repeat(40))).toBeNull(); // too deep
    expect(parseExpr('-'.repeat(60) + '1')).toBeNull();
    expect(parseExpr('1' + '+1'.repeat(110))).toBeNull(); // too many nodes
    const long = '1' + '+1'.repeat(40);
    expect(evalExpr(long)).toBe(41);
    expect(evalExpr(long, undefined, { n: 10 })).toBe(0); // out of steps: cut off, not half an answer
    const budget = { n: EXPR_STEPS };
    evalExpr(long, undefined, budget);
    expect(budget.n).toBeLessThan(EXPR_STEPS);
    expect(evalExpr('999999999 * 999999999 * 999999999')).toBe(1_000_000_000);
    expect(evalExpr('0 - 999999999 * 999999999')).toBe(-1_000_000_000);
    expect(Number.isInteger(evalExpr('999999999 * 999999999 / 7'))).toBe(true);
  });
});

describe('dice notation', () => {
  const plan = (src: string, vals: Record<string, number> = {}) => planRoll(parseDice(src)!, scope(vals));
  it('parses the grammar and rejects what is not dice', () => {
    for (const ok of ['2d6+3', 'd20', 'D20 + 5', 'd20+@str.mod', '2d20kh1', '2d20kl1+2', '4d6dl1', '3d6dh1', '2d20k1', '5d6!', '5d6!5', '5d6>=5', '5d6!>=5', '(@pool)d6', '@pool d6', '(body + fight - 1)d6!>=5', 'd%', '1d(@die)+@dmg', '3d6-1d4-2', '10', '-2+d4', '0d6']) {
      expect(parseDice(ok), ok).not.toBeNull();
    }
    for (const bad of ['', 'd', '2d', 'd1', 'd1001', '101d6', '2d6+', '2d6++3', 'hello', '2d6!!', '2d6>=', '2d6>=5>=6', '2d6kh1kl1', '(1d6', '@', '2 d6 extra', 'd20+@', '2d6;alert(1)', '1d6+(', 'd6'.repeat(80), '1+1+1+1+1+1+1+1+1']) {
      expect(parseDice(bad), bad).toBeNull();
    }
    expect(parseDice(null)).toBeNull();
    expect(parseDice(42)).toBeNull();
  });
  it('works the numbers out for an actor and writes the roll back as plain notation', () => {
    expect(plan('d20+@str.mod', { 'str.mod': 3 }).text).toBe('1d20+3');
    expect(plan('d20+@str.mod', { 'str.mod': -1 }).text).toBe('1d20-1');
    expect(plan('d20+@str.mod').text).toBe('1d20'); // a bonus of nothing is left out
    expect(plan('(@pool)d6!>=5', { pool: 4 }).text).toBe('4d6!>=5');
    expect(plan('@pool d6', { pool: 3 }).text).toBe('3d6');
    expect(plan('(body+fight-hurt)d6!>=5', { body: 3, fight: 2, hurt: 1 }).text).toBe('4d6!>=5');
    expect(plan('1d(@die)+@dmg', { die: 10, dmg: 2 }).text).toBe('1d10+2');
    expect(plan('4d6dl1').text).toBe('4d6kh3');
    expect(plan('3d6dh1').text).toBe('3d6kl2');
    expect(plan('2d20kh1 - 2 + d%').text).toBe('2d20kh1-2+1d100');
    expect(plan('(0-5)d6').text).toBe('0d6'); // never a negative number of dice
    expect(plan('5').text).toBe('5');
    expect(plan('(@n)d6', { n: 5000 }).terms[0]).toMatchObject({ n: 100 });
    // The plain notation means the same roll to whoever receives it.
    for (const src of ['2d20kh1+3', '4d6!>=5', '12d6+1d100-2', '3d7!5>=6', '0d6', '4d6kh3']) {
      const p = plan(src), again = planRoll(parseDice(p.text)!);
      expect(again).toEqual(p);
    }
  });
  it('maps onto the physical dice where there are any', () => {
    expect(plan('2d6+3').kinds).toEqual(['d6', 'd6']);
    expect(plan('d20+d4+d8+d10+d12').kinds).toEqual(['d20', 'd4', 'd8', 'd10', 'd12']);
    expect(plan('d%').kinds).toEqual(['d100', 'd10']);
    expect(plan('3d7').kinds).toEqual([]); // no such die: plain numbers
    expect(plan('3d7').terms[0]).toMatchObject({ real: false });
    expect(plan('12d6').kinds.length).toBe(12);
    expect(plan('13d6').kinds).toEqual([]); // more than a hand holds
    expect(plan('7d100').kinds).toEqual([]);
    const mixed = plan('10d6+4d8+2d4');
    expect(mixed.kinds.length).toBe(12); // the d8s do not fit, the d4s after them still do
    expect(mixed.terms.map((t) => 'real' in t && t.real)).toEqual([true, false, true]);
    expect(plan('(@pool)d6', { pool: 0 }).kinds).toEqual([]);
  });
  it('reads the faces that landed', () => {
    expect(readRoll(plan('2d6+3'), [4, 5]).total).toBe(12);
    expect(readRoll(plan('3d6-1d4-2'), [6, 6, 6, 3]).total).toBe(13);
    const adv = readRoll(plan('2d20kh1+2'), [7, 15]);
    expect(adv.total).toBe(17);
    expect(adv.nat).toBe(15);
    expect(adv.terms[0].dice!.map((d) => d.kept)).toEqual([false, true]);
    expect(readRoll(plan('2d20kl1+2'), [7, 15]).total).toBe(9);
    expect(readRoll(plan('2d20kh1'), [9, 9]).terms[0].dice!.filter((d) => d.kept).length).toBe(1);
    expect(readRoll(plan('4d6dl1'), [1, 6, 3, 4]).total).toBe(13);
    expect(readRoll(plan('d%'), [100]).total).toBe(100);
    const pool = readRoll(plan('5d6>=5'), [5, 6, 1, 4, 5]);
    expect(pool).toMatchObject({ total: 3, counted: true, ones: 1 });
    expect(readRoll(plan('4d6<=2'), [1, 2, 3, 2]).total).toBe(3);
    expect(readRoll(plan('4d6=6'), [6, 2, 6, 6]).total).toBe(3);
    expect(rollText(adv)).toBe('[(7) 15] + 2');
    expect(rollText(readRoll(plan('d20-@pen', { pen: 2 }), [10]))).toBe('[10] − 2');
  });
  it('explodes with extra dice that travel with the throw', () => {
    // Two sixes explode; one of the new dice explodes again.
    const p = plan('4d6!>=5'), made = [6, 2, 5];
    const thrower = readRoll(p, [6, 3, 6, 5], [], () => made.shift()!);
    expect(thrower.extra).toEqual([6, 2, 5]);
    expect(thrower.total).toBe(5); // 6 6 5 + 6 5
    expect(thrower.terms[0].dice!.map((d) => d.v)).toEqual([6, 3, 6, 5, 6, 2, 5]);
    expect(thrower.terms[0].dice!.filter((d) => d.burst).length).toBe(3);
    // Everyone else replays the recorded numbers and reads the same thing, with no dice of their own.
    const watcher = readRoll(p, [6, 3, 6, 5], thrower.extra);
    expect(watcher).toEqual(thrower);
    expect(readRoll(plan('3d6!'), [6, 6, 1], [4, 2]).total).toBe(19);
    expect(readRoll(plan('2d6!5'), [5, 1], [3]).total).toBe(9);
    // A die that always explodes is cut off, not followed for ever.
    const mad = readRoll(plan('2d6!1'), [1, 1], [], () => 6);
    expect(mad.terms[0].dice!.length).toBe(42);
    // No physical die: every value is a recorded number.
    const odd = plan('3d7+1');
    const first = readRoll(odd, [], [], () => 7);
    expect(first).toMatchObject({ total: 22, extra: [7, 7, 7] });
    expect(readRoll(odd, [], first.extra).total).toBe(22);
  });
  it('never trusts what it is handed', () => {
    const p = plan('2d6+1');
    expect(readRoll(p, [99, -4]).total).toBe(8); // clamped to the faces a d6 has
    expect(readRoll(p, []).total).toBe(3); // a missing die reads as 1
    expect(readRoll(p, [NaN, 'x'] as unknown as number[]).total).toBe(3);
    expect(readRoll(plan('2d6!'), [6, 6], []).total).toBe(12); // nothing recorded: nothing explodes
    expect(readRoll(plan('2d7'), [], [1e12, 2.9]).total).toBe(9);
    expect(readRoll(plan('1d6!'), [6], [6, 6, 6, 6, 6, 6, 3, 5, 5, 5]).terms[0].dice!.length).toBe(8);
  });
  it('applies a way of rolling: advantage, disadvantage, a pushed pool', () => {
    const adv = lantern.modes[0], dis = lantern.modes[1], push = six.modes[0], hard = six.modes[1];
    expect(planRoll(parseDice('d20+@m')!, scope({ m: 2 }), adv).text).toBe('2d20kh1+2');
    expect(planRoll(parseDice('d20+@m')!, scope({ m: 2 }), dis).text).toBe('2d20kl1+2');
    expect(planRoll(parseDice('1d8+2')!, scope({}), adv).text).toBe('1d8+2'); // not its die
    expect(planRoll(parseDice('2d20kh1')!, scope({}), dis).text).toBe('2d20kh1'); // already says what to keep
    expect(planRoll(parseDice('3d6!>=5')!, scope({}), push).text).toBe('5d6!>=5');
    expect(planRoll(parseDice('1d6>=5')!, scope({}), hard).text).toBe('0d6>=5');
    expect(modeFor(lantern, null, [])).toBeNull();
    expect(modeFor(lantern, 'adv', [])?.id).toBe('adv');
    expect(modeFor(lantern, null, ['poisoned'])?.id).toBe('dis');
    expect(modeFor(lantern, 'adv', ['poisoned'])).toBeNull(); // they cancel
    expect(modeFor(lantern, 'adv', ['inspired', 'prone'])?.id).toBe('adv');
    expect(modeFor(lantern, 'nonsense', [])).toBeNull();
  });
});

describe('parseSystem', () => {
  const base = () => ({ v: 1, name: 'T', sections: [{ name: 'S', fields: [{ id: 'a', name: 'A', type: 'number', def: 5 }, { id: 'life', type: 'resource' }] }] });
  it('ships three systems that parse with nothing dropped', () => {
    interface Raw { id: string; name: string; sections: { fields: unknown[] }[]; rolls: unknown[]; conditions: unknown[]; triggers: { do: unknown[] }[] }
    for (const raw of [LANTERN, SIX, HEARTS] as unknown as Raw[]) {
      const notes: string[] = [];
      const s = parseSystem(raw, notes)!;
      expect(notes, raw.name).toEqual([]);
      expect(s.id).toBe(raw.id);
      expect(s.sections.flatMap((x) => x.fields).length).toBe(raw.sections.flatMap((x) => x.fields).length);
      expect(s.rolls.length).toBe(raw.rolls.length);
      expect(s.conditions.length).toBe(raw.conditions.length);
      expect(s.triggers.length).toBe(raw.triggers.length);
      expect(s.triggers.flatMap((t) => t.do).length).toBe(raw.triggers.flatMap((t) => t.do).length);
      // What is kept is plain data: it survives the store and parses to itself.
      const again: string[] = [];
      expect(parseSystem(JSON.parse(JSON.stringify(s)), again)).toEqual(s);
      expect(again).toEqual([]);
    }
    expect(parseIndex(INDEX).map((r) => r.id)).toEqual(['lantern-d20', 'six-sides', 'three-hearts']);
    expect(parseIndex([{ file: '../../etc/passwd', name: 'x' }, { file: 'ok.json' }, 5, { file: 'fine-1.json', name: 'Fine' }])).toEqual([{ id: 'fine-1', name: 'Fine', file: 'fine-1.json' }]);
    expect(parseIndex('nope')).toEqual([]);
  });
  it('refuses what is not a system at all', () => {
    for (const bad of [null, 5, 'x', [], {}, { v: 2, name: 'T', sections: base().sections }, { v: 1, sections: base().sections }, { v: 1, name: 'T' }, { v: 1, name: 'T', sections: [] }, { v: 1, name: 'T', sections: [{ name: 'S', fields: [{ id: '!!', type: 'number' }] }] }, { ...base(), v: '1' }]) {
      expect(parseSystem(bad)).toBeNull();
    }
    expect(parseSystem(base())).not.toBeNull();
  });
  it('drops fields it does not understand and says so', () => {
    const notes: string[] = [];
    const s = parseSystem({
      ...base(), extra: 1,
      sections: [{ name: 'S', junk: true, fields: [
        { id: 'a', type: 'number', min: 0, max: 10, def: 3 },
        { id: 'a', type: 'number' },                          // duplicate
        { id: 'target', type: 'number' },                     // reserved
        { id: 'roll.total', type: 'number' },                 // reserved
        { id: 'min', type: 'number' },                        // a function's name
        { id: 'hp.max', type: 'number' },                     // a resource's maximum is spelled this way
        { id: 'Bad Id', type: 'number' },
        { id: '__proto__', type: 'number' },
        { id: 'constructor', type: 'spell' },                 // unknown type
        { id: 'b', type: 'derived', formula: 'a +' },         // does not parse
        { id: 'c', type: 'derived' },                         // no formula
        { id: 'd', type: 'choice', options: [] },
        { id: 'e', type: 'resource', max: 'oops(' },
        { id: 'f', type: 'derived', formula: 'a * 2', roll: 'not dice', colour: 'red' },
        { id: 'g', type: 'choice', options: [{ id: 'x', name: 'X' }, { id: 'x' }, { id: 'Y!' }, 7], def: 'nope' },
        7, null,
      ] }, 'not a section', { name: 'Empty', fields: [] }],
    }, notes)!;
    expect(s.sections.length).toBe(1);
    expect(s.sections[0].fields.map((f) => f.id)).toEqual(['a', 'f', 'g']);
    expect(s.sections[0].fields[1]).toEqual({ id: 'f', name: 'f', type: 'derived', formula: 'a * 2' });
    expect(s.sections[0].fields[2].options).toEqual([{ id: 'x', name: 'X' }]);
    expect(s.sections[0].fields[2].def).toBeUndefined();
    expect(notes.length).toBeGreaterThanOrEqual(18);
    expect(notes.some((n) => n.includes('unknown "extra"'))).toBe(true);
    expect(notes.some((n) => n.includes('unknown "colour"'))).toBe(true);
  });
  it('drops rolls, conditions, modes and triggers that do not hold together', () => {
    const notes: string[] = [];
    const s = parseSystem({
      ...base(), hp: 'a', dice: [6, 7, 6, 'd20', 20],
      modes: [{ id: 'adv', name: 'Adv', die: 20, add: 1, keep: 'h' }, { id: 'adv', die: 20, add: 1 }, { id: 'x', die: 'd20', add: 1 }, { id: 'y', die: 20 }, 'adv'],
      rolls: [{ id: 'hit', name: 'Hit', dice: 'd20+@a', vs: 'target.a' }, { id: 'hit', dice: 'd20' }, { id: 'bad', dice: 'banana' }, { id: 'worse', dice: 'd20', vs: ')(' , into: 'hp' }, { dice: 'd6' }],
      conditions: [
        { id: 'weak', name: 'Weak', icon: '😵‍💫😵‍💫😵‍💫', mode: 'adv', mods: [
          { target: 'a', op: 'add', value: -2 }, { target: 'zz', op: 'add', value: 1 }, { target: 'a', op: 'pow', value: 2 }, { target: 'a', op: 'add', value: 'a +' },
          { target: 'a', op: 'mul', value: 1, div: 2, priority: 3 }, { target: 'life.max', op: 'add', value: 'a' }, { target: 'a', op: 'add', value: 1, div: 2 }, 'x',
        ] },
        { id: 'weak' }, { id: 'odd', mode: 'none' }, { name: 'nameless' },
      ],
      triggers: [
        { on: 'turn.start', if: 'has(weak)', do: [{ stat: 'life', op: 'add', value: -1 }, { cond: 'weak', on: false }, { say: 'hi {name}' }, { roll: '1d4' }, { script: 'heal.v1' }] },
        { on: 'full.moon', do: [{ say: 'howl' }] },
        { on: 'roll', roll: 'missing', do: [{ say: 'x' }] },
        { on: 'turn.end', roll: 'hit', do: [{ say: 'x' }] },
        { on: 'roll', roll: 'hit', if: '1 +', do: [{ say: 'x' }] },
        { on: 'hp.zero', do: [{ stat: 'nope', op: 'add', value: 1 }, { cond: 'nope', on: true }, { eval: 'alert(1)' }, { say: '' }, { script: 'rm -rf /' }, { stat: 'a', op: 'add', value: 1, who: 'everyone' }, { cond: 'weak', on: 'yes' }] },
        { on: 'roll', roll: 'hit', do: [{ stat: 'a', op: 'set', value: 'roll.total', who: 'target' }] },
      ],
    }, notes)!;
    expect(s.hp).toBeUndefined(); // not a resource
    expect(s.dice).toEqual([6, 20]);
    expect(s.modes.map((m) => m.id)).toEqual(['adv']);
    expect(s.rolls).toEqual([{ id: 'hit', name: 'Hit', dice: 'd20+@a', vs: 'target.a', win: 'Success', lose: 'Failure' }, { id: 'worse', name: 'worse', dice: 'd20' }]);
    expect(s.conditions.map((c) => c.id)).toEqual(['weak', 'odd']);
    expect([...s.conditions[0].icon!].length).toBeLessThanOrEqual(4);
    expect(s.conditions[0].mods).toEqual([{ target: 'a', op: 'add', value: -2 }, { target: 'a', op: 'mul', value: 1, priority: 3, div: 2 }, { target: 'life.max', op: 'add', value: 'a' }, { target: 'a', op: 'add', value: 1 }]);
    expect(s.conditions[1].mode).toBeUndefined();
    expect(s.triggers.map((t) => t.on)).toEqual(['turn.start', 'roll']);
    expect(s.triggers[0].do.length).toBe(5);
    expect(s.triggers[1]).toEqual({ on: 'roll', roll: 'hit', do: [{ stat: 'a', op: 'set', value: 'roll.total', who: 'target' }] });
    expect(notes.length).toBeGreaterThan(15);
  });
  it('cuts everything to size', () => {
    const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i));
    const notes: string[] = [];
    const s = parseSystem({
      v: 1, id: 'x'.repeat(99), name: 'N'.repeat(500), about: 'A'.repeat(5000),
      sections: many(40, (i) => ({ name: 'S'.repeat(300), fields: many(60, (j) => ({ id: `f${i}x${j}`, name: 'F'.repeat(300), type: 'text', def: 'D'.repeat(900), short: 'SSSSSSSSSS' })) })),
      rolls: many(200, (i) => ({ id: `r${i}`, dice: 'd6', name: 'R'.repeat(99) })),
      modes: many(50, (i) => ({ id: `m${i}`, die: 6, add: 99 })),
      conditions: many(200, (i) => ({ id: `c${i}`, mods: many(50, () => ({ target: 'f0x0', op: 'add', value: 1 })) })),
      triggers: many(200, () => ({ on: 'turn.start', do: many(50, () => ({ say: 'x'.repeat(999) })) })),
    }, notes)!;
    expect(s.id).toBe('custom');
    expect(s.name.length).toBe(40);
    expect(s.about!.length).toBe(200);
    expect(s.sections.length).toBe(12);
    expect(s.sections[0].fields.length).toBe(24);
    expect(s.sections[0].name.length).toBe(24);
    expect(s.sections[0].fields[0]).toMatchObject({ name: 'F'.repeat(24), def: 'D'.repeat(60), short: 'SSSSSS' });
    expect(s.rolls.length).toBe(40);
    expect(s.modes.length).toBe(8);
    expect(s.modes[0].add).toBe(10);
    expect(s.conditions.length).toBe(40);
    expect(s.conditions[0].mods.length).toBe(0); // a text cannot be modified
    expect(s.triggers.length).toBe(40);
    expect(s.triggers[0].do.length).toBe(8);
    expect((s.triggers[0].do[0] as { say: string }).say.length).toBe(160);
    expect(JSON.stringify(s).length).toBeLessThan(200_000);
    expect(notes.length).toBeGreaterThan(5);
  });
  it('keeps only edits from the closed set', () => {
    expect(parseEdits([{ stat: 'hp', op: 'add', value: -3, who: 'target' }, { cond: 'prone', on: true }, { say: 'ouch' }, { roll: '2d6' , name: 'Fire' }, { script: 'a.b' }]).length).toBe(5);
    expect(parseEdits([{ stat: 'hp', op: 'add' }, { stat: 'hp', op: 'explode', value: 1 }, { stat: 'HP', op: 'add', value: 1 }, { fetch: 'http://x' }, { script: '../x y' }, { roll: 'x' }, { cond: 'a b', on: true }, 'say', null, [1]])).toEqual([]);
    expect(parseEdits('nope')).toEqual([]);
    expect(parseEdits(undefined)).toEqual([]);
    expect(parseEdits(Array.from({ length: 30 }, () => ({ say: 'x' }))).length).toBe(8);
  });
});

describe('the sheet', () => {
  it('derives the d20 sheet from what was entered', () => {
    const s = derive(lantern, { sv: { str: 16, dex: 13, armour: 2, level: 5 }, hp: 7, mhp: 20 });
    expect(s.num.get('str.mod')).toBe(3);
    expect(s.num.get('dex.mod')).toBe(1);
    expect(s.num.get('con.mod')).toBe(0); // 10 by default
    expect(s.num.get('ac')).toBe(13);
    expect(s.num.get('skill')).toBe(3);
    expect(s.num.get('atk')).toBe(6);
    expect(s.num.get('hp')).toBe(7);
    expect(s.num.get('hp.max')).toBe(20);
    expect(s).toMatchObject({ hp: 7, mhp: 20, conds: [] });
    expect(derive(lantern, { sv: { str: 8, weapon: 'finesse', dex: 18, trained: false } }).num.get('atk')).toBe(4);
    expect(derive(lantern, { sv: { str: 7 } }).num.get('str.mod')).toBe(-2);
  });
  it('works with pieces from before there was a system', () => {
    const old = mini({ hp: 12, mhp: 30, ini: 14, st: ['AC 15'] });
    const s = derive(lantern, old);
    expect(s).toMatchObject({ hp: 12, mhp: 30 });
    expect(s.num.get('str')).toBe(10);
    expect(face(lantern, old)).toEqual({ hp: 12, mhp: 30, marks: '' });
    expect(face(null, old)).toEqual({ hp: 12, mhp: 30, marks: '' });
    expect(derive(lantern, mini()).mhp).toBeUndefined(); // no maximum entered: no bar, as before
    // Rubbish on a piece reads as the defaults.
    const junk = derive(lantern, { sv: { str: 'big', dex: null, weapon: 5, trained: 'yes', notes: 42 } as never, cn: ['nope', 7, 'prone'] as never, hp: 'x' as never, mhp: -5 });
    expect(junk.num.get('str')).toBe(10);
    expect(junk.conds).toEqual(['prone']);
    expect(junk.str.get('notes')).toBe('');
    expect(derive(lantern, { sv: [] as never, cn: 'prone' as never }).conds).toEqual([]);
    expect(derive(lantern, { sv: { str: 99999 } }).num.get('str')).toBe(30);
  });
  it('counts wounds up while the bar counts what is left', () => {
    const fresh = derive(six, { sv: { body: 3 } });
    expect(fresh.num.get('wounds')).toBe(0);
    expect(fresh.num.get('wounds.max')).toBe(5);
    expect(fresh).toMatchObject({ hp: 5, mhp: 5 });
    const hurt = setStat(six, mini({ sv: { body: 3 } }), 'wounds', 2);
    expect(hurt.hp).toBe(3); // stored as what is left, so the bar and the ring still work
    const s = derive(six, hurt);
    expect(s.num.get('wounds')).toBe(2);
    expect(s.num.get('hurt')).toBe(1);
    expect(s).toMatchObject({ hp: 3, mhp: 5 });
    expect(derive(six, { ...hurt, hp: 2 }).num.get('wounds')).toBe(3); // the ring took a hit point
    expect(setStat(six, hurt, 'wounds', 99).hp).toBe(0);
    expect(derive(six, { sv: { body: 3, luck: 1 } }).num.get('luck')).toBe(1);
    expect(derive(six, { sv: { body: 3 } }).num.get('luck')).toBe(3);
  });
  it('has three hearts and no numbers to speak of', () => {
    expect(derive(hearts, mini())).toMatchObject({ hp: 3, mhp: 3 });
    expect(derive(hearts, mini({ hp: 1 })).hp).toBe(1);
    expect(derive(hearts, mini({ hp: 9 })).hp).toBe(3);
    expect(derive(hearts, mini()).str.get('trait')).toBe('Being brave');
    expect(face(hearts, mini({ cn: ['sleepy', 'cheered'] }))).toEqual({ hp: 3, mhp: 3, marks: '😴🎉' });
  });
  it('applies conditions and lets formulas see the result', () => {
    const v = { sv: { dex: 14, speed: 7 }, cn: ['prone', 'guarded'] };
    const s = derive(lantern, v);
    expect(s.num.get('speed')).toBe(3); // halved, rounded down
    expect(s.num.get('ac')).toBe(12);   // 10 + 2 - 2 + 2
    expect(derive(lantern, { ...v, cn: ['prone', 'snared'] }).num.get('speed')).toBe(0);
    expect(face(lantern, mini(v)).marks).toBe('⤵🛡');
    // A modifier on a stat reaches what is derived from it.
    const t = sys({ v: 1, name: 'T', sections: [{ fields: [{ id: 'str', type: 'number', def: 10 }, { id: 'mod', type: 'derived', formula: 'floor((str - 10) / 2)' }, { id: 'atk', type: 'derived', formula: 'mod + 2' }] }],
      conditions: [{ id: 'giant', mods: [{ target: 'str', op: 'add', value: 4 }] }, { id: 'weak', mods: [{ target: 'atk', op: 'add', value: '0 - mod' }] }] });
    expect(derive(t, { cn: ['giant'] }).num.get('atk')).toBe(4);
    expect(derive(t, { cn: ['giant', 'weak'] }).num.get('atk')).toBe(2);
    expect(derive(t, { cn: [] }).num.get('atk')).toBe(2);
  });
  it('applies modifiers in a fixed order, whatever order they arrive in', () => {
    const order = (mods: unknown[][], on: string[]) => derive(sys({
      v: 1, name: 'T', sections: [{ fields: [{ id: 'x', type: 'number', def: 10 }] }],
      conditions: mods.map((m, i) => ({ id: `c${i}`, mods: m })),
    }), { cn: on }).num.get('x');
    const all = ['c0', 'c1', 'c2', 'c3', 'c4'];
    // At equal priority: set, then mul, then add, then min, then max, however they are written.
    const mixed = [[{ target: 'x', op: 'max', value: 12 }], [{ target: 'x', op: 'min', value: 11 }], [{ target: 'x', op: 'add', value: 2 }], [{ target: 'x', op: 'mul', value: 3 }], [{ target: 'x', op: 'set', value: 4 }]];
    expect(order(mixed, all)).toBe(12);                                  // ((4 * 3) + 2) capped at 11, raised to 12
    expect(order(mixed, [...all].reverse())).toBe(12);                   // the order on the piece does not matter
    expect(order([...mixed].reverse(), all)).toBe(12);                   // nor the order in the file
    expect(order(mixed, ['c2', 'c3'])).toBe(32);                         // (10 * 3) + 2
    expect(order(mixed, ['c1', 'c2', 'c3'])).toBe(11);
    // Priority comes first: lower runs earlier.
    expect(order([[{ target: 'x', op: 'add', value: 5, priority: -1 }], [{ target: 'x', op: 'set', value: 1 }]], all)).toBe(1);
    expect(order([[{ target: 'x', op: 'add', value: 5, priority: 1 }], [{ target: 'x', op: 'set', value: 1 }]], all)).toBe(6);
    expect(order([[{ target: 'x', op: 'mul', value: 2, priority: 2 }], [{ target: 'x', op: 'add', value: 1, priority: 1 }]], all)).toBe(22);
    // Same priority, same op: the order written. Halving twice rounds down each time.
    expect(order([[{ target: 'x', op: 'mul', value: 1, div: 2 }, { target: 'x', op: 'mul', value: 3, div: 2 }]], all)).toBe(7);
    expect(order([[{ target: 'x', op: 'add', value: 'x' }]], all)).toBe(10); // a modifier that reads its own stat sees 0
  });
  it('survives formulas that go in circles or run away', () => {
    const t = sys({ v: 1, name: 'T', sections: [{ fields: [
      { id: 'a', type: 'derived', formula: 'b + 1' }, { id: 'b', type: 'derived', formula: 'a + 1' }, { id: 'c', type: 'derived', formula: 'c + 1' },
      { id: 'pool', type: 'resource', max: 'pool + 1' },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, type: 'derived', formula: i ? Array.from({ length: 8 }, () => `d${i - 1}`).join('+') : '1' })),
    ] }] });
    const s = derive(t, {});
    for (const v of s.num.values()) expect(Number.isInteger(v)).toBe(true);
    expect(s.num.get('c')).toBe(1);
    expect(s.num.get('d19')).toBe(1_000_000_000); // 8^19, clamped
    expect(Math.abs(s.num.get('a')! - s.num.get('b')!)).toBe(1);
  });
  it('enters values clamped to what the field allows', () => {
    const v = mini();
    expect(setStat(lantern, v, 'str', 18).sv).toEqual({ str: 18 });
    expect(setStat(lantern, v, 'str', 99).sv).toEqual({ str: 30 });
    expect(setStat(lantern, v, 'str', -5).sv).toEqual({ str: 1 });
    expect(setStat(lantern, v, 'str', 12.7).sv).toEqual({ str: 12 });
    expect(setStat(lantern, v, 'weapon', 'finesse').sv).toEqual({ weapon: 'finesse' });
    expect(setStat(lantern, v, 'trained', false).sv).toEqual({ trained: false });
    expect(setStat(lantern, v, 'notes', 'x'.repeat(500)).sv!.notes).toHaveLength(60);
    // The bar resource lives in the old fields.
    const max = setStat(lantern, v, 'hp.max', 20);
    expect(max).toMatchObject({ mhp: 20 });
    expect(max.sv).toBeUndefined();
    expect(setStat(lantern, max, 'hp', 50).hp).toBe(20);
    expect(setStat(lantern, max, 'hp', -3).hp).toBe(0);
    expect(setStat(lantern, { ...max, hp: 15 }, 'hp.max', 10)).toMatchObject({ hp: 10, mhp: 10 });
    // What does not fit changes nothing.
    for (const [id, val] of [['str', 'strong'], ['weapon', 'laser'], ['ac', 30], ['nope', 1], ['str.max', 5], ['wounds.max', 5], ['notes', 5], ['__proto__', 1], ['hp', 'full']] as const) expect(setStat(lantern, v, id, val), id).toBe(v);
    expect(setStat(six, mini(), 'wounds.max', 9)).toEqual(mini()); // a maximum that is a formula is not entered
    expect(setStat(lantern, setStat(lantern, v, 'str', 12), 'str', 12).sv).toEqual({ str: 12 });
    expect(Object.keys(setStat(lantern, v, 'str', 12))).not.toContain('__proto__');
  });
  it('puts conditions on and takes them off', () => {
    const v = mini();
    const on = setCond(lantern, v, 'prone', true);
    expect(on.cn).toEqual(['prone']);
    expect(setCond(lantern, on, 'prone', true)).toBe(on);
    expect(setCond(lantern, on, 'nonsense', true)).toBe(on);
    expect(setCond(lantern, setCond(lantern, on, 'burning', true), 'prone', false).cn).toEqual(['burning']);
    expect('cn' in setCond(lantern, on, 'prone', false)).toBe(false);
    let many = v;
    for (const c of lantern.conditions) many = setCond(lantern, many, c.id, true);
    expect(many.cn!.length).toBe(lantern.conditions.length);
  });
});

describe('who applies the rules', () => {
  it('is one device, the same from everyone\'s point of view', () => {
    expect(authority([], ['ann', 'bob'], 'bob')).toBe('bob');               // free play: whoever acted
    expect(authority(['gm1'], ['ann', 'gm1', 'bob'], 'bob')).toBe('gm1');   // the GM
    expect(authority(['gm2', 'gm1'], ['gm2', 'ann', 'gm1'], 'ann')).toBe('gm1'); // several: the lowest id
    expect(authority(['gm1', 'gm2'], ['gm2', 'ann'], 'ann')).toBe('gm2');   // of those who are here
    expect(authority(['gm1'], ['ann', 'bob'], 'ann')).toBe('ann');          // the GM is away: whoever acted
    const present = ['p3', 'gm9', 'p1', 'gm4'];
    for (const viewer of present) expect(authority(['gm9', 'gm4'], [...present].sort(() => (viewer > 'p2' ? 1 : -1)), 'p1')).toBe('gm4');
  });
  it('can tell who wrote a key, and when', () => {
    const s = new Store('me');
    expect(s.stamp('turn')).toBeNull();
    s.merge(['turn', { id: 'a', round: 1 }, 50, 'bob']);
    expect(s.stamp('turn')).toEqual({ t: 50, b: 'bob' });
    s.setBoard('b2');
    expect(s.stamp('turn')).toBeNull(); // another board has its own turn
    s.set('turn', { id: 'x', round: 1 });
    expect(s.stamp('turn')!.b).toBe('me');
  });
});

describe('triggers', () => {
  const hero = (extra: Partial<MiniVal> = {}): Piece => ({ id: 'h', name: 'Hero', v: mini({ hp: 10, mhp: 10, ...extra }) });
  const ogre = (extra: Partial<MiniVal> = {}): Piece => ({ id: 'o', name: 'Ogre', v: mini({ hp: 20, mhp: 30, ...extra }) });
  const damage = (total: number, id = 'r:1', target = ogre()): GameEvent => ({ on: 'roll', id, self: hero(), target, roll: { id: 'damage', total, nat: total, ones: 0 } });

  it('applies damage to the target and says so', () => {
    const out = fire(lantern, damage(6));
    expect(out.lines).toEqual(['Ogre takes 6 damage.']);
    expect(out.minis.map((p) => p.id)).toEqual(['o']); // only the piece that changed is written
    expect(out.minis[0].v).toMatchObject({ hp: 14, mhp: 30, fx: ['r:1'] });
    expect(fire(lantern, damage(500)).minis[0].v.hp).toBe(0);
    expect(fire(lantern, damage(-4)).lines).toEqual(['Ogre takes 0 damage.']); // never healed by a bad roll
    expect(fire(lantern, damage(-4)).minis.map((p) => [p.id, p.v.hp])).toEqual([['h', 10]]);
  });
  it('does nothing when its condition does not hold or the roll is another', () => {
    const noTarget: GameEvent = { on: 'roll', id: 'r:2', self: hero(), roll: { id: 'damage', total: 6, nat: 6, ones: 0 } };
    expect(fire(lantern, noTarget)).toEqual({ minis: [], lines: [], scripts: [] });
    expect(fire(lantern, { ...damage(6), roll: { id: 'str', total: 6, nat: 6, ones: 0 } })).toEqual({ minis: [], lines: [], scripts: [] });
    expect(fire(lantern, { on: 'roll', id: 'r:3', self: hero(), roll: { id: 'attack', total: 21, nat: 19, ones: 0 } }).lines).toEqual([]);
    const crit = fire(lantern, { on: 'roll', id: 'r:4', self: hero(), roll: { id: 'attack', total: 23, nat: 20, ones: 0 } });
    expect(crit.lines).toEqual(['Hero strikes true: a natural 20!']);
    expect(crit.minis[0].v.fx).toEqual(['r:4']); // it only spoke, and still will not speak twice
    expect(crit.minis[0].v.hp).toBe(10);
  });
  it('is harmless applied twice, or late', () => {
    const first = fire(lantern, damage(6));
    const after = first.minis[0];
    // The same event again, against the table as it now is: nothing.
    expect(fire(lantern, damage(6, 'r:1', after))).toEqual({ minis: [], lines: [], scripts: [] });
    // Two devices that both believed they were the one, working from the same table, write the same piece.
    expect(fire(lantern, damage(6)).minis).toEqual(first.minis);
    // Another event still applies, and both are remembered.
    const second = fire(lantern, damage(3, 'r:2', after));
    expect(second.minis[0].v).toMatchObject({ hp: 11, fx: ['r:1', 'r:2'] });
    // A piece remembers only the last few.
    let p = ogre();
    for (let i = 0; i < 10; i++) p = fire(lantern, damage(1, `r:${i}`, p)).minis[0];
    expect(p.v.hp).toBe(10);
    expect(p.v.fx).toEqual(['r:4', 'r:5', 'r:6', 'r:7', 'r:8', 'r:9']);
    expect(fire(lantern, damage(1, 'r:9', p)).minis).toEqual([]);
  });
  it('runs edits in order, each seeing the one before', () => {
    const burning: GameEvent = { on: 'turn.start', id: 'ts:9:h', self: hero({ cn: ['burning'] }) };
    const out = fire(lantern, burning, () => 3);
    expect(out.lines).toEqual(['Hero · Burning: 3 [3]']);
    expect(out.minis).toEqual([{ id: 'h', name: 'Hero', v: { ...burning.self!.v, hp: 7, fx: ['ts:9:h'] } }]);
    expect(fire(lantern, { ...burning, self: hero() })).toEqual({ minis: [], lines: [], scripts: [] });
    const end = fire(lantern, { on: 'turn.end', id: 'te:9:h', self: hero({ cn: ['guarded', 'prone'] }) });
    expect(end.minis[0].v.cn).toEqual(['prone']);
    expect(fire(lantern, { on: 'turn.end', id: 'te:9:h', self: hero({ cn: ['prone'] }) }).minis).toEqual([]);
  });
  it('knows a piece is down, in each game\'s own words', () => {
    const down = fire(lantern, { on: 'hp.zero', id: 'z:1:h', self: hero({ hp: 0 }) });
    expect(down.lines).toEqual(['Hero is down!']);
    expect(down.minis[0].v.cn).toEqual(['down']);
    expect(fire(hearts, { on: 'hp.zero', id: 'z:1:h', self: { id: 'h', v: mini({ hp: 0, n: 'Pip' }) } })).toMatchObject({ lines: ['Pip needs a rest.'] });
    expect(fire(hearts, { on: 'roll', id: 'r:6', self: { id: 'h', v: mini() }, roll: { id: 'trait', total: 6, nat: 6, ones: 0 } }).lines).toEqual(['A six! Someone does it with style.']);
  });
  it('wounds by how well a strike beat the guard', () => {
    const striker = { id: 's', name: 'Rook', v: mini({ sv: { body: 3, fight: 2 } }) }, foe = { id: 'f', name: 'Brute', v: mini({ sv: { body: 4 } }) };
    const ev = (total: number): GameEvent => ({ on: 'roll', id: `r:${total}`, self: striker, target: foe, roll: { id: 'strike', total, nat: 6, ones: 0, vs: 2 } });
    expect(derive(six, foe.v).num.get('guard')).toBe(2);
    expect(fire(six, ev(1))).toEqual({ minis: [], lines: [], scripts: [] });
    const hit = fire(six, ev(4));
    expect(hit.lines).toEqual(['Brute is wounded.']);
    expect(derive(six, hit.minis[0].v).num.get('wounds')).toBe(2);
    expect(hit.minis[0].v.hp).toBe(4); // six to begin with
  });
  it('changes a stat as it was entered, under whatever conditions modify it', () => {
    const t = sys({ v: 1, name: 'T', sections: [{ fields: [{ id: 'gold', type: 'number', def: 10, min: 0 }, { id: 'lit', type: 'toggle' }] }],
      conditions: [{ id: 'rich', mods: [{ target: 'gold', op: 'mul', value: 2 }] }],
      triggers: [{ on: 'turn.start', do: [{ stat: 'gold', op: 'add', value: 'gold' }, { stat: 'gold', op: 'min', value: 25 }, { stat: 'lit', op: 'set', value: 1 }, { say: '{name} has {gold}, lit {lit}' }] }] });
    const out = fire(t, { on: 'turn.start', id: 'e', self: { id: 'a', v: mini({ sv: { gold: 5 }, cn: ['rich'] }) } });
    // Entered 5, shown 10; add the shown 10 to the entered 5; cap what is entered at 25.
    expect(out.minis[0].v.sv).toEqual({ gold: 15, lit: true });
    expect(out.lines).toEqual(['Someone has 30, lit 1']);
  });
  it('leaves scripts to a runner, and checks what one hands back', () => {
    const t = sys({ v: 1, name: 'T', hp: 'life', sections: [{ fields: [{ id: 'life', type: 'resource', max: 5 }] }], conditions: [{ id: 'odd' }],
      triggers: [{ on: 'turn.start', do: [{ script: 'regrow' }, { stat: 'life', op: 'add', value: -1 }] }] });
    const ev: GameEvent = { on: 'turn.start', id: 'e1', self: { id: 'a', name: 'Moss', v: mini() } };
    const out = fire(t, ev);
    expect(out.scripts).toEqual(['regrow']); // with no runner this is all that happens to it
    expect(out.minis[0].v.hp).toBe(4);
    expect(scriptCtx(t, ev)).toEqual({ on: 'turn.start', event: 'e1', self: { id: 'a', name: 'Moss', stats: { life: 5, 'life.max': 5 }, conds: [] }, target: undefined });
    // What a script answers is data like any other: parsed, then applied under an id of its own.
    const answer = parseEdits(JSON.parse('[{"stat":"life","op":"add","value":2},{"cond":"odd","on":true},{"exec":"rm"},{"say":"{name} regrows"}]'));
    const follow = runEdits(t, { ...ev, id: 'e1~0', self: out.minis[0] }, answer);
    expect(follow.minis[0].v).toMatchObject({ hp: 5, cn: ['odd'], fx: ['e1', 'e1~0'] });
    expect(follow.lines).toEqual(['Moss regrows']);
    expect(runEdits(t, { ...ev, id: 'e1~0', self: follow.minis[0] }, answer).minis).toEqual([]);
  });
  it('cannot be made to write outside the sheet', () => {
    const out = runEdits(lantern, damage(1), parseEdits([{ stat: 'x', op: 'set', value: 1 }, { stat: 'ac', op: 'set', value: 99 }, { cond: 'nope', on: true }, { stat: 'hp', op: 'set', value: '999999999 * 999999999', who: 'target' }, { stat: 'str', op: 'set', value: 500 }]));
    expect(out.minis.map((p) => [p.id, p.v.hp, p.v.sv])).toEqual([['h', 10, { str: 30 }], ['o', 30, undefined]]);
    for (const p of out.minis) expect(Object.keys(p.v).sort()).toEqual(Object.keys({ ...mini(), hp: 1, mhp: 1, fx: 1, ...(p.id === 'h' ? { sv: 1 } : {}) }).sort());
  });
});
