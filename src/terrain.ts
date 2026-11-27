// Natural ground as one continuous surface.
//
// The table is still a grid of stacked cells (that is what the rules, the minis and
// the network see), but ground is not drawn as cubes. Every cell keeps a flat pad
// at its own height, so a mini stands level, and the rim of the cell is shared with
// its neighbours: a step up becomes a bank, grass shades into sand or bare earth,
// steep faces turn to rock. Pure geometry from the columns it is given.
import * as THREE from 'three';

/** Blocks that are ground: their colour, and what the surface is made of (2 earth/stone, 3 growth). */
export const GROUND: Record<string, { color: string; kind: number }> = {
  grass: { color: '#7da04c', kind: 3 }, meadow: { color: '#5c8a44', kind: 3 }, moss: { color: '#74875c', kind: 3 },
  dirt: { color: '#8b5e3c', kind: 2 }, mud: { color: '#5b4636', kind: 2 }, sand: { color: '#e2cf96', kind: 2 },
  gravel: { color: '#9a958c', kind: 2 }, clay: { color: '#b5651d', kind: 2 }, basalt: { color: '#3a3d45', kind: 2 },
  snow: { color: '#f1f5f9', kind: 2 },
};

/** The topmost visible block of a column: `y` is the block's own level, so its surface is at `y + 1`. */
export interface Column { y: number; id: string }

export interface Terrain {
  geometry: THREE.BufferGeometry;
  /** For each triangle: the cell it belongs to, and whether it is a bank side rather than walkable top. */
  cells: [x: number, y: number, z: number][];
  side: boolean[];
  /** Cells ("x,z") whose rim is not level: small things should keep to the pad in the middle. */
  sloped: Set<string>;
  /** For cells in a hollow: how far the highest point of the rim stands above the cell's own level. */
  hollow: Map<string, number>;
}

const PAD = 0.3; // half the width of the level pad in the middle of a cell
const EARTH = new THREE.Color('#8b6a48'), ROCK = new THREE.Color('#857a6c'), CUT = new THREE.Color('#6f4f36');
/** What shows where ground is cut through: earth under soil, stone under rock. */
const CUT_ROCK = new THREE.Color('#4a4a52'), WET = new THREE.Color('#6b5a44');
const STONY = new Set(['basalt', 'gravel']);
/** How far below the top of its block the water lies (water blocks are drawn 0.82 high). */
const WATERLINE = 0.24;
const ck = (x: number, z: number) => `${x},${z}`;

/**
 * @param columns every column's topmost visible block, keyed "x,z"
 * @param worn how trodden a ground cell is, 0..1 (near walls, floors and paths): it shades to bare earth
 */
export function buildTerrain(columns: Map<string, Column>, worn: (x: number, z: number) => number): Terrain {
  const pos: number[] = [], col: number[] = [], kind: number[] = [], index: number[] = [];
  const cells: Terrain['cells'] = [], side: boolean[] = [], sloped = new Set<string>(), hollow = new Map<string, number>();
  const ground = (x: number, z: number) => { const c = columns.get(ck(x, z)); return c && GROUND[c.id] ? c : null; };
  const shared = new Map<string, number>();
  const tmp = new THREE.Color();

  /** A point on the rim of the grid, at half-cell coordinates (even = cell corner): shared by every cell that touches it. */
  const rim = (hx: number, hz: number): { i: number; h: number } => {
    const key = `${hx},${hz}`;
    // The cells this point belongs to: four around a corner, two across an edge.
    const xs = hx % 2 === 0 ? [hx / 2 - 1, hx / 2] : [(hx - 1) / 2];
    const zs = hz % 2 === 0 ? [hz / 2 - 1, hz / 2] : [(hz - 1) / 2];
    let n = 0, h = 0, lo = Infinity, hi = -Infinity, k = 0, w = 0;
    const c = new THREE.Color(0, 0, 0);
    let wet = 0;
    for (const x of xs) for (const z of zs) {
      const g = ground(x, z);
      if (!g) {
        // Water draws the bank down to meet it: the shore slopes in instead of standing as a kerb.
        const o = columns.get(ck(x, z));
        if (o?.id === 'water') { wet++; h += o.y + 1 - WATERLINE; lo = Math.min(lo, o.y); hi = Math.max(hi, o.y); }
        continue; // built blocks and bare table neither lift nor lower the ground beside them
      }
      n++;
      h += g.y + 1;
      lo = Math.min(lo, g.y);
      hi = Math.max(hi, g.y);
      c.add(tmp.set(GROUND[g.id].color));
      k += GROUND[g.id].kind;
      w += worn(x, z);
    }
    h /= n + wet;
    const had = shared.get(key);
    if (had !== undefined) return { i: had, h };
    c.multiplyScalar(1 / n);
    k /= n;
    // A drop of one level is a grassy bank with earth showing through; more than that is a rock face.
    const steep = Math.min(1, (hi - lo) / 2);
    c.lerp(steep > 0.5 ? ROCK : EARTH, steep > 0.5 ? steep * 0.85 : steep * 0.7).lerp(EARTH, (w / n) * 0.6);
    if (wet) c.lerp(WET, 0.75); // damp earth at the water's edge
    k += (2 - k) * Math.max(steep, (w / n) * 0.6);
    const i = pos.length / 3;
    pos.push(hx / 2, h, hz / 2);
    col.push(c.r, c.g, c.b);
    kind.push(k);
    shared.set(key, i);
    return { i, h };
  };
  const own = (x: number, y: number, z: number, c: THREE.Color, k: number): number => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
    kind.push(k);
    return pos.length / 3 - 1;
  };
  const tri = (a: number, b: number, c: number, cell: Terrain['cells'][number], isSide: boolean) => {
    index.push(a, b, c);
    cells.push(cell);
    side.push(isSide);
  };

  for (const [key, top] of columns) {
    const g = GROUND[top.id];
    if (!g) continue;
    const [x, z] = key.split(',').map(Number), h = top.y + 1, cell: Terrain['cells'][number] = [x, top.y, z];
    // The rim, anticlockwise seen from above starting at the low-x low-z corner: corner, edge, corner, ...
    const around = [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2], [2, 1], [2, 0], [1, 0]].map(([dx, dz]) => rim(x * 2 + dx, z * 2 + dz));
    if (around.every((p) => Math.abs(p.h - h) < 1e-6)) {
      tri(around[0].i, around[2].i, around[4].i, cell, false);
      tri(around[0].i, around[4].i, around[6].i, cell, false);
    } else {
      sloped.add(key);
      const over = Math.max(...around.map((p) => p.h)) - h;
      if (over > 0.01) hollow.set(key, over);
      const w = worn(x, z), c = tmp.set(g.color).clone().lerp(EARTH, w * 0.45), k = g.kind + (2 - g.kind) * w * 0.45;
      const cx = x + 0.5, cz = z + 0.5;
      const pad = [[-PAD, -PAD], [-PAD, PAD], [PAD, PAD], [PAD, -PAD]].map(([dx, dz]) => own(cx + dx, h, cz + dz, c, k));
      tri(pad[0], pad[1], pad[2], cell, false);
      tri(pad[0], pad[2], pad[3], cell, false);
      for (let s = 0; s < 4; s++) { // the bank from the pad out to each edge
        const a = around[s * 2], m = around[s * 2 + 1], b = around[(s * 2 + 2) % 8], i0 = pad[s], i1 = pad[(s + 1) % 4];
        tri(i0, a.i, m.i, cell, false);
        tri(i0, m.i, i1, cell, false);
        tri(i1, m.i, b.i, cell, false);
      }
    }
    // Where the ground ends against something lower that is not ground (a floor, water, the bare
    // table), close the gap with a cut face of earth, like the edge of a diorama.
    const edges: [number, number, number][] = [[-1, 0, 0], [0, 1, 2], [1, 0, 4], [0, -1, 6]];
    for (const [dx, dz, s] of edges) {
      if (ground(x + dx, z + dz)) continue;
      const other = columns.get(ck(x + dx, z + dz)), floor = other ? other.y + 1 : 0;
      const pts = [around[s], around[s + 1], around[(s + 2) % 8]];
      if (pts.every((p) => p.h <= floor + 0.01)) continue;
      const at = pts.map((p) => [pos[p.i * 3], pos[p.i * 3 + 2]]);
      for (let e = 0; e < 2; e++) {
        const [ax, az] = at[e], [bx, bz] = at[e + 1], ah = pts[e].h, bh = pts[e + 1].h;
        const shade = (y: number) => tmp.copy(STONY.has(top.id) ? CUT_ROCK : CUT).multiplyScalar(0.65 + 0.35 * Math.min(1, (y - floor) / 1.2)).clone();
        const a0 = own(ax, ah, az, shade(ah), 2), b0 = own(bx, bh, bz, shade(bh), 2);
        const a1 = own(ax, floor, az, shade(floor), 2), b1 = own(bx, floor, bz, shade(floor), 2);
        tri(a0, a1, b0, cell, true);
        tri(b0, a1, b1, cell, true);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setAttribute('kind', new THREE.Float32BufferAttribute(kind, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return { geometry, cells, side, sloped, hollow };
}
