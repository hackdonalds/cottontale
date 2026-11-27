// Breaking things: what the GM can smash in play, what is left behind, and how the pieces fly.
//
// The break itself is one ordinary edit to the shared table (so it syncs, and undo puts the
// piece back). The burst of debris is for show: every device works it out for itself from
// which piece broke, and nothing about it is stored or needs to match between devices.
import { BLOCKS, PROPS } from './catalog';
import { GROUND } from './terrain';
import { EDGES, type CellVal } from './rules';

type V3 = [number, number, number];

/** Props of stone leave a boulder behind, and what held a body leaves its bones. Everything else is simply gone. */
const STONE = new Set(['pillar', 'statue', 'well', 'fountain', 'tombstone', 'altar', 'arch', 'stalagmite']);
const GRIM = new Set(['coffin', 'cage']);
const LIQUID = new Set(['water', 'lava']);

/**
 * What breaking the piece `id` at `key` leaves in its place: another piece, `null` for nothing,
 * or `undefined` if it cannot be broken (the ground itself, water, or nothing we know).
 */
export function broken(key: string, id: string): CellVal | null | undefined {
  if (key.startsWith('w:')) return EDGES[id] ? null : undefined;
  if (!key.startsWith('b:')) return undefined;
  if (BLOCKS[id]) return GROUND[id] || LIQUID.has(id) ? undefined : null;
  if (!PROPS[id]) return undefined;
  return STONE.has(id) ? { i: 'rock' } : GRIM.has(id) ? { i: 'bones' } : null;
}

/** A live "this just broke" may only name a wall edge or a cell, in whole numbers. */
export const BREAK_KEY = /^(b:-?\d+,\d+,-?\d+|w:-?\d+,\d+,-?\d+,[nw])$/;

const WOOD = ['#8a6238', '#6e4a28', '#a57a48'], ROCK = ['#8d9199', '#73777f', '#a3a7ad'];
const LEAFY = new Set(['tree', 'birch', 'poplar', 'pine', 'palm', 'bush', 'reeds', 'flowers', 'cactus']);
const METAL = new Set(['cage', 'anvil', 'cauldron', 'spikes', 'gate']);
/** The colours a piece's debris comes in, and whether it cracks like wood or crumbles like stone. */
export function debrisOf(key: string, id: string): { tones: string[]; wood: boolean } {
  if (key.startsWith('w:')) {
    const timber = !!EDGES[id]?.timber, glass = id === 'wallwin' || id === 'woodwin';
    return { tones: [...(timber ? [...WOOD, '#e6dcc6'] : ROCK), ...(glass ? ['#bfe3ee'] : [])], wood: timber };
  }
  const block = BLOCKS[id];
  if (block) return { tones: [block.color], wood: /wood|thatch|roof|carpet/.test(id) };
  if (STONE.has(id) || id === 'rock') return { tones: ROCK, wood: false };
  if (id === 'crystal') return { tones: ['#b58cf0', '#8e6bd8', '#d9c4ff'], wood: false };
  if (id === 'bones' || id === 'mushroom') return { tones: ['#e8e2d0', '#cfc7b0'], wood: true };
  if (METAL.has(id)) return { tones: ['#5d636e', '#7c838f', '#3f444d'], wood: false };
  if (LEAFY.has(id)) return { tones: ['#4f7f3a', '#6a9a48', ...WOOD.slice(0, 2)], wood: true };
  return { tones: WOOD, wood: true };
}

// ---- how the pieces fly ----------------------------------------------------------

/**
 * One piece of debris. Its whole flight follows from these numbers (see `chunkAt`): nothing
 * is stepped frame by frame, so a slow phone shows the same arc with fewer pictures of it.
 */
export interface Chunk {
  p: V3; v: V3;
  /** The height it comes to rest at: the top of what it lands on, plus half of itself. */
  floor: number;
  size: number;
  /** The axis it tumbles about, and how fast (radians a second). */
  axis: V3; spin: number;
  /** 0–1: picks its colour and shade. */
  tone: number;
  /** Seconds until it is gone; it shrinks away over the last `FADE` of them. */
  life: number;
}
export interface ChunkPose { p: V3; scale: number; angle: number }

const G = 18, BOUNCE = 0.42, GRIP = 0.55, HOPS = 3, FADE = 0.35;
/** The longest any chunk lasts: a burst is over and costs nothing after this. */
export const DEBRIS_LIFE = 1.95;

/** A small repeatable random stream (so a test, or a replay, sees the same burst twice). */
export function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Break a box (centre `at`, half-sizes `half`) into 12–24 chunks flying outward. `top(x, z)`
 * is the height of the surface there: each chunk bounces on whatever is under the spot it
 * first comes down on, unless that stands higher than where it started.
 */
export function shatter(seed: number, at: V3, half: V3, top: (x: number, z: number) => number): Chunk[] {
  const r = stream(seed), n = 12 + Math.floor(r() * 13), out: Chunk[] = [];
  const base = at[1] - half[1];
  for (let i = 0; i < n; i++) {
    const o: V3 = [(r() * 2 - 1) * half[0], (r() * 2 - 1) * half[1], (r() * 2 - 1) * half[2]];
    // Away from the middle, measured in the box's own proportions: a thin wall bursts out of its two faces.
    let dx = o[0] / Math.max(half[0], 0.05) + (r() - 0.5) * 0.8, dz = o[2] / Math.max(half[2], 0.05) + (r() - 0.5) * 0.8;
    const len = Math.hypot(dx, dz) || 1, speed = 0.9 + r() * 2.3;
    dx *= speed / len;
    dz *= speed / len;
    const size = 0.07 + r() * 0.1, p: V3 = [at[0] + o[0], Math.max(base + size / 2, at[1] + o[1]), at[2] + o[2]];
    const vy = 1.5 + r() * 2.7;
    // Where it would first come down on the level the piece stood on, and what is under that spot.
    const air = (vy + Math.sqrt(vy * vy + 2 * G * (p[1] - base))) / G;
    let floor = top(Math.floor(p[0] + dx * air), Math.floor(p[2] + dz * air)) + size / 2;
    if (floor > p[1]) { floor = Math.min(p[1], base + size / 2); dx *= 0.25; dz *= 0.25; } // something tall in the way: drop at its foot
    const ax: V3 = [r() - 0.5, r() - 0.5, r() - 0.5], al = Math.hypot(...ax) || 1;
    // How long until it lies still: it lingers a moment after that, then shrinks away.
    let rest = 0, up = vy, h = p[1] - floor;
    for (let hop = 0; hop <= HOPS; hop++, h = 0) {
      const t = (up + Math.sqrt(up * up + 2 * G * h)) / G;
      rest += t;
      up = (G * t - up) * BOUNCE;
    }
    out.push({
      p, v: [dx, vy, dz], floor, size, axis: [ax[0] / al, ax[1] / al, ax[2] / al], spin: 5 + r() * 9,
      tone: r(), life: Math.min(DEBRIS_LIFE, rest + 0.4 + r() * 0.3),
    });
  }
  return out;
}

/**
 * Where a chunk is `t` seconds after the break: a thrown arc, a few lower hops, then rest.
 * Fills `out` and returns false once the chunk is gone.
 */
export function chunkAt(c: Chunk, t: number, out: ChunkPose): boolean {
  if (t >= c.life) return false;
  let x = c.p[0], z = c.p[2], y = c.floor, [vx, vy, vz] = c.v, h = Math.max(0, c.p[1] - c.floor), left = Math.max(0, t), spun = 0;
  for (let hop = 0; hop <= HOPS; hop++) {
    const air = (vy + Math.sqrt(vy * vy + 2 * G * h)) / G; // seconds until it comes down
    if (left < air) {
      x += vx * left;
      z += vz * left;
      y = c.floor + h + vy * left - (G * left * left) / 2;
      spun += left;
      break;
    }
    x += vx * air;
    z += vz * air;
    left -= air;
    spun += air;
    vy = (G * air - vy) * BOUNCE; // the speed it landed with, turned around and mostly lost
    vx *= GRIP;
    vz *= GRIP;
    h = 0;
  }
  out.p[0] = x;
  out.p[1] = Math.max(c.floor, y);
  out.p[2] = z;
  out.angle = spun * c.spin;
  out.scale = c.size * Math.min(1, (c.life - t) / FADE);
  return true;
}
