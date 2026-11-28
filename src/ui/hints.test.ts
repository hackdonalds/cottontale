import { describe, expect, it } from 'vitest';
import { MAX_SEEN, MAX_WAITING, done, next, offer, readSeen, start, withdraw, type Hints } from './hints';

const h = (id: string) => ({ id, text: `about ${id}` });
/** Show whatever is next and let it have its time. */
const show = (st: Hints): [Hints, string | null] => { const [a, hint] = next(st); return [done(a), hint?.id ?? null]; };

describe('hints', () => {
  it('shows one at a time, in the order their moments came', () => {
    let st = offer(offer(start(), h('build')), h('brush'));
    const [a, first] = next(st);
    expect(first?.id).toBe('build');
    expect(a.showing).toBe('build');
    expect(next(a)[1]).toBeNull(); // the screen is taken
    let second: string | null;
    [st, second] = show(done(a));
    expect(second).toBe('brush');
    expect(show(st)[1]).toBeNull();
    expect(st.seen).toEqual(['build', 'brush']);
  });

  it('shows each once per device', () => {
    let st = offer(start(['build']), h('build'));
    expect(st.queue).toEqual([]);
    st = offer(offer(st, h('dice')), h('dice'));
    expect(st.queue.length).toBe(1);
    const [a] = next(st);
    expect(offer(a, h('dice'))).toBe(a); // on screen: not again
    expect(offer(done(a), h('dice')).queue).toEqual([]);
    expect(readSeen(JSON.stringify(done(a).seen))).toEqual(['build', 'dice']);
  });

  it('is never a tour: few wait, and one whose moment passed waits for the next time', () => {
    let st = start();
    for (const id of ['a', 'b', 'c', 'd']) st = offer(st, h(id));
    expect(st.queue.map((q) => q.id)).toEqual(['a', 'b', 'c', 'd'].slice(0, MAX_WAITING));
    st = withdraw(st, 'a');
    expect(withdraw(st, 'nope')).toBe(st);
    const [after, shown] = show(st);
    expect(shown).toBe('b');
    expect(after.seen).toEqual(['b']); // 'a' was never shown, so it may still be
    expect(offer(after, h('a')).queue.map((q) => q.id)).toEqual(['a']);
  });

  it('reads what local storage held as untrusted', () => {
    expect(readSeen(null)).toEqual([]);
    expect(readSeen('{')).toEqual([]);
    expect(readSeen('{"a":1}')).toEqual([]);
    expect(readSeen('["a",3,null,"b"]')).toEqual(['a', 'b']);
    expect(readSeen(JSON.stringify(Array.from({ length: MAX_SEEN + 9 }, (_, i) => `h${i}`))).length).toBe(MAX_SEEN);
  });
});
