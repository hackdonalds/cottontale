import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { kindsFor, reading, results, rollValues, shape, simulate, type Kind, type Throw } from './dice';
import { rollBuzz, ticker } from './haptics';
import { Store } from './store';

describe('coin', () => {
  it('is a flat prism with two faces that count', () => {
    const sh = shape('d2');
    expect(sh.faces.length).toBe(26); // heads, tails and a ridged rim
    const caps = sh.faces.map((f, i) => i).filter((i) => sh.labels[i]);
    expect(caps.map((i) => sh.labels[i]).sort()).toEqual([1, 2]);
    expect(sh.normals[caps[0]].dot(sh.normals[caps[1]])).toBeCloseTo(-1);
    for (const i of caps) expect(sh.faces[i].length).toBe(12);
    // Far wider than it is thick.
    const ys = sh.verts.map((v) => Math.abs(v.y)), rs = sh.verts.map((v) => Math.hypot(v.x, v.z));
    expect(Math.max(...rs)).toBeGreaterThan(Math.max(...ys) * 4);
  });

  it('reads heads or tails, even on its rim', () => {
    const up = new THREE.Vector3(0, 1, 0);
    expect(reading('d2', new THREE.Quaternion())).toBe(1);
    expect(reading('d2', new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI))).toBe(2);
    // Standing on each bit of rim, leaning a hair one way or the other: never "rim", always the side that leans up.
    const sh = shape('d2');
    sh.normals.forEach((n, f) => {
      if (sh.labels[f]) return;
      const onRim = new THREE.Quaternion().setFromUnitVectors(n, up);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(onRim).cross(up).normalize();
      for (const lean of [0.02, -0.02]) {
        const q = new THREE.Quaternion().setFromAxisAngle(axis, lean).multiply(onRim);
        const heads = new THREE.Vector3(0, 1, 0).applyQuaternion(q).y > 0;
        expect(reading('d2', q)).toBe(heads ? 1 : 2);
      }
    });
  });

  it('goes in the hand like any die', () => {
    expect(kindsFor(3, 2)).toEqual(['d2', 'd2', 'd2']);
    expect(kindsFor(13, 2)).toBeNull();
    expect(rollValues(['d2', 'd6', 'd2'], [2, 5, 1])).toEqual([2, 5, 1]);
    // Names that are not dice are turned away, however object-like they look.
    expect(kindsFor(1, 1)).toBeNull();
    expect(results({ o: [0, 0, 0], k: ['constructor' as Kind], n: 1, q: [[0, 0, 0, 0, 0, 0, 1000]] })).toBeNull();
    expect(results({ o: [0, 0, 0], k: ['d3' as Kind], n: 1, q: [[0, 0, 0, 0, 0, 0, 1000]] })).toBeNull(); // a die from a newer version
    expect(results({ o: [0, 0, 0], k: ['d2'], n: 1, q: [[0, 0, 0, 1000, 0, 0, 0]] })).toEqual([2]); // lying face down
  });

  it('flips high, lands flat and comes up both ways', async () => {
    const store = new Store('a');
    const seen = new Set<number>();
    const height = (t: Throw, die: number) => {
      let y = 0, top = 0;
      for (let f = 0; f < t.n; f++) { y += t.q[die][f * 7 + 1]; top = Math.max(top, y); }
      return { top: top / 100, end: y / 100 };
    };
    let lift = 0, dieLift = 0;
    for (let round = 0; round < 6; round++) {
      const kinds: Kind[] = ['d2', 'd2', 'd2', 'd6'];
      const starts = kinds.map((_, i) => ({ p: [-1.5 + i, 1.5, 2] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number] }));
      const t = await simulate(kinds, starts, [0, 0, -6], [0, 0, 0], store);
      const labels = results(t)!;
      expect(results(JSON.parse(JSON.stringify(t)))).toEqual(labels); // survives the wire
      labels.slice(0, 3).forEach((l, i) => {
        expect([1, 2]).toContain(l);
        seen.add(l);
        const h = height(t, i);
        lift += h.top / 18;
        expect(h.end).toBeLessThan(1); // back down on the table (or on another coin), not hung in the air
      });
      dieLift += height(t, 3).top / 6;
    }
    expect(seen.size).toBe(2);
    expect(lift).toBeGreaterThan(dieLift + 0.2); // tossed up, where a die is just let go
  });
});

describe('haptics', () => {
  it('thins impacts to one tick per 60 ms, harder hits ticking longer', () => {
    const tick = ticker();
    expect(tick(1, 1000)).toBe(18);
    expect(tick(1, 1030)).toBe(0); // too soon
    expect(tick(0.5, 1060)).toBe(11);
    expect(tick(0.02, 2000)).toBe(0); // too faint to bother the motor
    expect(tick(0.1, 2001)).toBeGreaterThan(0); // and a skipped one does not hold up the next
    expect(tick(NaN, 3000)).toBe(0);
  });

  it('marks a top roll with a long buzz and a 1 on a d20 with a double tick', () => {
    const long = rollBuzz(['d20'], [20])!, double = rollBuzz(['d20'], [1])!;
    expect(long.length).toBe(3);
    expect(Math.max(...long)).toBeGreaterThan(Math.max(...double));
    expect(double).toEqual([double[0], double[1], double[0]]);
    expect(rollBuzz(['d20'], [12])).toBeNull();
    expect(rollBuzz(['d6', 'd6'], [1, 3])).toBeNull(); // a 1 only stings on a d20
    expect(rollBuzz(['d6', 'd6'], [1, 6])).toEqual(long);
    expect(rollBuzz(['d20', 'd20'], [1, 20])).toEqual(long); // the good news wins
    expect(rollBuzz(['d100', 'd10', 'd20'], [100, 1])).toEqual(long); // percentile pairs count once
    expect(rollBuzz(['d100', 'd10', 'd20'], [10, 1])).toEqual(double);
    expect(rollBuzz(['d100', 'd10', 'd10'], [10, 4])).toBeNull();
    expect(rollBuzz(['d2'], [2])).toBeNull(); // tails is not a triumph
  });
});
