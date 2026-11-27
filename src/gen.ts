// Whole scenes from a seed: a wood, a dungeon, a cave, a tavern.
//
// A scene is a pure function of its options. Everything is worked out in whole numbers
// (no floating point, no Math.random), so the same seed gives the same scene on every
// device and a scene can be shared as a handful of numbers. The result is a list of
// ordinary edits (blocks, props, edge walls), so a generated scene is just a table that
// someone built very quickly: every brush still works on it afterwards.
import { dressing, ek, roomEdges, type Side } from './rules';

export type Theme = 'forest' | 'dungeon' | 'cave' | 'tavern';
/** The three sliders run 0..4. What they mean depends on the theme (see THEMES). */
export interface GenOpts { theme: Theme; seed: number; size: number; density: number; detail: number }
export type Edit = [key: string, value: unknown];
/** A room of a scene. Its furnishing has a seed of its own, so one room can be redone; a locked room survives a new layout. */
export interface GenRoom { kind: string; x0: number; x1: number; z0: number; z1: number; seed: number; lock?: boolean }
export const ROOM_NAMES: Record<string, string> = {
  guard: 'Guard room', store: 'Store', crypt: 'Crypt', shrine: 'Shrine', treasure: 'Treasury',
  cell: 'Cells', lair: 'Lair', hall: 'Hall', bedroom: 'Bedroom',
};
export interface Scene { edits: Edit[]; bounds: [x0: number, x1: number, z0: number, z1: number]; rooms: GenRoom[] }

/** `icon` names a drawing in the app's icon set. */
export const THEMES: Record<Theme, { name: string; icon: string; sliders: [string, string, string] }> = {
  forest: { name: 'Wilderness', icon: 'tree', sliders: ['Size', 'Growth', 'Hills'] },
  dungeon: { name: 'Dungeon', icon: 'key', sliders: ['Size', 'Rooms', 'Clutter'] },
  cave: { name: 'Cave', icon: 'cave', sliders: ['Size', 'Openness', 'Clutter'] },
  tavern: { name: 'Tavern', icon: 'mug', sliders: ['Size', 'Tables', 'Clutter'] },
};

// ---- chance, in whole numbers --------------------------------------------------------

interface Rng { int(n: number): number; chance(num: number, den: number): boolean; pick<T>(from: readonly T[]): T }
function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  return { int: (n) => next() % n, chance: (num, den) => next() % den < num, pick: (from) => from[next() % from.length] };
}
function hash(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const div = (a: number, b: number) => Math.floor(a / b);
/** Smooth chance over the table, 0..255: lattice values `step` cells apart, blended between. */
function noise(x: number, z: number, step: number, seed: number): number {
  const x0 = div(x, step), z0 = div(z, step), fx = x - x0 * step, fz = z - z0 * step;
  const v = (i: number, j: number) => hash(x0 + i, z0 + j, seed) & 255;
  return div((v(0, 0) * (step - fx) + v(1, 0) * fx) * (step - fz) + (v(0, 1) * (step - fx) + v(1, 1) * fx) * fz, step * step);
}

/** The scene being built: later writes to a key replace earlier ones. */
class Build {
  private map = new Map<string, unknown>();
  block(x: number, y: number, z: number, i: string): void { this.map.set(`b:${x},${y},${z}`, { i }); }
  prop(x: number, y: number, z: number, i: string, r = 0): void { this.map.set(`b:${x},${y},${z}`, r ? { i, r } : { i }); }
  edge(x: number, y: number, z: number, s: Side, i: string): void { this.map.set(ek(x, y, z, s), { i }); }
  set(key: string, value: unknown): void { this.map.set(key, value); }
  has(x: number, y: number, z: number): boolean { return this.map.has(`b:${x},${y},${z}`); }
  drop(x: number, y: number, z: number): void { this.map.delete(`b:${x},${y},${z}`); }
  edits(): Edit[] { return [...this.map]; }
}
const NEAR: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const ck = (x: number, z: number) => `${x},${z}`;

// ---- wilderness ------------------------------------------------------------------------

function forest(o: GenOpts): Scene {
  const b = new Build(), r = rng(o.seed), half = 8 + o.size * 2;
  const stream = r.chance(3, 4), bend = r.int(1000), across = r.chance(1, 2);
  // The stream wanders about a line through the scene; the path crosses it the other way.
  const wander = (t: number, salt: number, reach: number) => div((noise(t, salt, 6, o.seed + salt) - 128) * reach, 128);
  const streamAt = (z: number) => wander(z + bend, 3, div(half, 2)) + div(half, 3) * (across ? 1 : -1);
  const pathAt = (x: number) => wander(x, 5, 3);
  const level = (x: number, z: number): number => {
    if (x * x + z * z < 20) return 0; // a level clearing in the middle
    const lift = div((noise(x, z, 7, o.seed) - 118) * o.detail, 70);
    return Math.max(0, Math.min(3, lift));
  };
  const wet = (x: number, z: number) => stream && x === streamAt(z);
  for (let x = -half; x < half; x++) for (let z = -half; z < half; z++) {
    const path = z === pathAt(x), n = noise(x, z, 9, o.seed + 1);
    const ground = n < 62 ? 'moss' : n > 205 ? 'meadow' : n > 192 ? 'dirt' : 'grass';
    if (wet(x, z)) { b.block(x, 0, z, 'water'); continue; }
    const banks = stream && Math.abs(x - streamAt(z)) <= 1;
    const h = banks || path ? Math.min(level(x, z), banks ? 0 : 1) : level(x, z);
    for (let y = 0; y <= h; y++) b.block(x, y, z, path ? 'dirt' : ground);
    if (path || x * x + z * z < 10) continue;
    // Growth: more passes of the same dressing rule make a thicker wood.
    const beside = NEAR.some(([dx, dz]) => wet(x + dx, z + dz));
    const passes = o.density >= 3 ? o.density - 1 : 1;
    for (let p = 0; p < passes; p++) {
      const prop = dressing(ground, x, z, beside, p * 7);
      if (!prop) continue;
      if (o.density < 2 && hash(x, z, o.seed + 9) % 4 > o.density + 1) break; // thinned out
      b.prop(x, h + 1, z, prop);
      break;
    }
  }
  return { edits: b.edits(), bounds: [-half, half - 1, -half, half - 1], rooms: [] };
}

// ---- dungeon ---------------------------------------------------------------------------

const DUNGEON_ROOMS: Record<string, { centre?: string; walls: string[]; floor: string[] }> = {
  guard: { centre: 'table', walls: ['barrel', 'crate', 'bench'], floor: ['chair'] },
  store: { walls: ['crate', 'barrel', 'sacks', 'barrel', 'crate'], floor: ['crate'] },
  crypt: { centre: 'coffin', walls: ['coffin', 'bones', 'candles'], floor: ['bones'] },
  shrine: { centre: 'altar', walls: ['candles', 'pillar', 'candles'], floor: ['rug'] },
  treasure: { centre: 'hoard', walls: ['chest', 'chest', 'potion'], floor: ['spikes'] },
  cell: { walls: ['cage', 'bones', 'cage'], floor: ['bones'] },
  lair: { centre: 'campfire', walls: ['bones', 'sacks', 'crate'], floor: ['bones'] },
};

function dungeon(o: GenOpts, prior: GenRoom[], fixed: boolean): Scene {
  // Layout, kinds and corridors each draw from their own run of chance, so keeping the
  // rooms where they are also keeps the corridors between them.
  const b = new Build(), r = rng(o.seed), dig_r = rng(o.seed + 2), half = 9 + o.size * 2 + (o.size >> 1);
  const want = 3 + o.density * 2 + o.size, rooms: GenRoom[] = prior.filter((q) => fixed || q.lock).map((q) => ({ ...q }));
  for (let tries = 0; !fixed && tries < 300 && rooms.length < want; tries++) {
    const w = 3 + r.int(4), d = 3 + r.int(4), x0 = -half + 1 + r.int(2 * half - w - 1), z0 = -half + 1 + r.int(2 * half - d - 1);
    const room = { kind: '', x0, x1: x0 + w - 1, z0, z1: z0 + d - 1, seed: 0 };
    if (rooms.some((q) => room.x0 <= q.x1 + 2 && room.x1 >= q.x0 - 2 && room.z0 <= q.z1 + 2 && room.z1 >= q.z0 - 2)) continue;
    rooms.push(room);
  }
  rooms.sort((a, c) => a.x0 + a.x1 - c.x0 - c.x1 || a.z0 - c.z0);
  const kinds = Object.keys(DUNGEON_ROOMS), kind_r = rng(o.seed + 1);
  rooms.forEach((room, i) => {
    if (room.kind) return; // kept from before
    room.kind = i === 0 ? 'guard' : kind_r.pick(kinds);
    room.seed = hash(room.x0, room.z0, o.seed) % 100000;
  });
  // Which room a cell belongs to (-1: a corridor), for every cell of floor.
  const floor = new Map<string, number>();
  rooms.forEach((q, i) => { for (let x = q.x0; x <= q.x1; x++) for (let z = q.z0; z <= q.z1; z++) floor.set(ck(x, z), i); });
  const doors = new Set<string>(), doorway = new Set<string>();
  const step = (ax: number, az: number, bx: number, bz: number) => {
    const from = floor.get(ck(ax, az)) ?? -1;
    if (!floor.has(ck(bx, bz))) floor.set(ck(bx, bz), -1);
    const to = floor.get(ck(bx, bz))!;
    if (from !== to) { // crossing a room's wall: that is a doorway
      doors.add(ax !== bx ? ek(Math.max(ax, bx), 1, az, 'w') : ek(ax, 1, Math.max(az, bz), 'n'));
      doorway.add(ck(ax, az)).add(ck(bx, bz));
    }
  };
  const dig = (a: GenRoom, c: GenRoom) => {
    let x = a.x0 + dig_r.int(a.x1 - a.x0 + 1), z = a.z0 + dig_r.int(a.z1 - a.z0 + 1);
    const tx = c.x0 + dig_r.int(c.x1 - c.x0 + 1), tz = c.z0 + dig_r.int(c.z1 - c.z0 + 1), xFirst = dig_r.chance(1, 2);
    for (let leg = 0; leg < 2; leg++) {
      if ((leg === 0) === xFirst) while (x !== tx) { const nx = x + Math.sign(tx - x); step(x, z, nx, z); x = nx; }
      else while (z !== tz) { const nz = z + Math.sign(tz - z); step(x, z, x, nz); z = nz; }
    }
  };
  for (let i = 1; i < rooms.length; i++) dig(rooms[i - 1], rooms[i]);
  for (let i = 2; i < rooms.length; i++) if (dig_r.chance(1, 4)) dig(rooms[i], rooms[dig_r.int(i - 1)]); // a few ways round
  for (const [key, room] of floor) {
    const [x, z] = key.split(',').map(Number);
    b.block(x, 0, z, room < 0 ? 'cobble' : 'stone');
    for (const [dx, dz] of NEAR) {
      const other = floor.get(ck(x + dx, z + dz));
      if (other === room) continue;
      const edge = dx ? ek(Math.max(x, x + dx), 1, z, 'w') : ek(x, 1, Math.max(z, z + dz), 'n');
      b.set(edge, { i: other !== undefined && doors.has(edge) ? 'walldoor' : 'wall' });
    }
  }
  // A room is furnished from its own seed alone, so it comes out the same wherever the
  // corridors happen to enter; then whatever stands in a doorway is taken away.
  rooms.forEach((q, i) => furnish(b, rng(q.seed), q, DUNGEON_ROOMS[q.kind], o.detail, new Set(), floor, i));
  for (const k of doorway) {
    const [x, z] = k.split(',').map(Number);
    b.drop(x, 1, z);
  }
  const lo = (pick: (q: GenRoom) => number) => Math.min(-half, ...rooms.map(pick)) - 1, hi = (pick: (q: GenRoom) => number) => Math.max(half, ...rooms.map(pick)) + 1;
  return { edits: b.edits(), bounds: [lo((q) => q.x0), hi((q) => q.x1), lo((q) => q.z0), hi((q) => q.z1)], rooms };
}

/** Fill a room: a centrepiece, things along the walls, the odd thing on the floor. Doorways stay clear. */
function furnish(b: Build, r: Rng, q: GenRoom, kit: { centre?: string; walls: string[]; floor: string[] }, clutter: number,
  keepClear: Set<string>, floor: Map<string, number> | null, id: number): void {
  const free = (x: number, z: number) => !b.has(x, 1, z) && !keepClear.has(ck(x, z)) && !NEAR.some(([dx, dz]) => keepClear.has(ck(x + dx, z + dz)))
    && (!floor || floor.get(ck(x, z)) === id);
  const cx = (q.x0 + q.x1) >> 1, cz = (q.z0 + q.z1) >> 1;
  if (kit.centre && q.x1 - q.x0 >= 2 && q.z1 - q.z0 >= 2 && free(cx, cz)) b.prop(cx, 1, cz, kit.centre, r.int(4));
  const along: [number, number][] = [], inner: [number, number][] = [];
  for (let x = q.x0; x <= q.x1; x++) for (let z = q.z0; z <= q.z1; z++) {
    (x === q.x0 || x === q.x1 || z === q.z0 || z === q.z1 ? along : inner).push([x, z]);
  }
  const area = (q.x1 - q.x0 + 1) * (q.z1 - q.z0 + 1);
  // Pieces are modelled facing +z. Against a wall they turn their backs to it and face the room.
  const facing = (x: number, z: number) => (z === q.z0 ? 0 : z === q.z1 ? 2 : x === q.x0 ? 1 : x === q.x1 ? 3 : r.int(4));
  const place = (cells: [number, number][], from: string[], count: number) => {
    for (let n = 0, tries = 0; n < count && tries < 40 && cells.length; tries++) {
      const [x, z] = cells[r.int(cells.length)];
      if (!free(x, z)) continue;
      b.prop(x, 1, z, r.pick(from), facing(x, z));
      n++;
    }
  };
  place(along, kit.walls, div(area * (clutter + 1), 14));
  place(inner, kit.floor, div(area * clutter, 40));
  if (clutter && free(q.x0, q.z0)) b.prop(q.x0, 1, q.z0, 'torch');
}

// ---- cave ------------------------------------------------------------------------------

function cave(o: GenOpts): Scene {
  const b = new Build(), r = rng(o.seed), half = 9 + o.size * 2, n = half * 2;
  let open = new Uint8Array(n * n);
  const at = (g: Uint8Array, x: number, z: number) => (x < 1 || z < 1 || x >= n - 1 || z >= n - 1 ? 0 : g[x + z * n]);
  for (let i = 0; i < n * n; i++) open[i] = r.int(100) < 41 + o.density * 3 ? 1 : 0;
  for (let pass = 0; pass < 4; pass++) { // rock gathers into walls, gaps into chambers
    const next = new Uint8Array(n * n);
    for (let x = 1; x < n - 1; x++) for (let z = 1; z < n - 1; z++) {
      let rock = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && !at(open, x + dx, z + dz)) rock++;
      next[x + z * n] = rock >= 5 ? 0 : 1;
    }
    open = next;
  }
  // Keep the biggest cave; pockets nobody could walk into are filled back in.
  const group = new Int32Array(n * n).fill(-1);
  let best = -1, bestSize = 0;
  for (let i = 0; i < n * n; i++) {
    if (!open[i] || group[i] >= 0) continue;
    const todo = [i];
    let size = 0;
    group[i] = i;
    while (todo.length) {
      const c = todo.pop()!, x = c % n, z = div(c, n);
      size++;
      for (const [dx, dz] of NEAR) {
        const j = x + dx + (z + dz) * n;
        if (at(open, x + dx, z + dz) && group[j] < 0) { group[j] = i; todo.push(j); }
      }
    }
    if (size > bestSize) { best = i; bestSize = size; }
  }
  const isOpen = (x: number, z: number) => at(open, x, z) === 1 && group[x + z * n] === best;
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
    const wx = x - half, wz = z - half;
    if (isOpen(x, z)) {
      const damp = noise(wx, wz, 5, o.seed + 4);
      const edge = NEAR.some(([dx, dz]) => !isOpen(x + dx, z + dz));
      if (damp < 34 && !edge) { b.block(wx, 0, wz, 'water'); continue; }
      b.block(wx, 0, wz, damp < 70 ? 'mud' : damp > 150 ? 'dirt' : 'gravel');
      if (!o.detail) continue;
      const roll = hash(wx, wz, o.seed + 6) % 100, much = o.detail * 3;
      const prop = edge ? (roll < much * 2 ? 'stalagmite' : roll < much * 2 + 3 ? 'crystal' : roll < much * 3 + 2 ? 'rock' : null)
        : roll < much ? (damp < 90 ? 'mushroom' : 'rock') : roll < much + 1 ? 'bones' : null;
      if (prop) b.prop(wx, 1, wz, prop);
      continue;
    }
    // Rock: a bank where it faces the cave, climbing behind that. Solid rock further in is not built at all.
    let near = 3;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (isOpen(x + dx, z + dz)) near = Math.min(near, Math.max(Math.abs(dx), Math.abs(dz)));
    if (near > 2) continue;
    for (let y = 0; y <= near + 1; y++) b.block(wx, y, wz, 'basalt');
  }
  return { edits: b.edits(), bounds: [-half, half - 1, -half, half - 1], rooms: [] };
}

// ---- tavern ----------------------------------------------------------------------------

function tavern(o: GenOpts, prior: GenRoom[]): Scene {
  const b = new Build(), r = rng(o.seed), w = 6 + o.size + r.int(2), d = 6 + (o.size >> 1) + r.int(2), timber = r.chance(1, 2);
  const x0 = -(w >> 1), x1 = x0 + w - 1, z0 = -(d >> 1), z1 = z0 + d - 1, yard = 4;
  const door = x0 + ((w - 1) >> 1);
  for (let x = x0 - yard; x <= x1 + yard; x++) for (let z = z0 - yard; z <= z1 + yard; z++) {
    const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1;
    const path = x === door && z > z1;
    b.block(x, 0, z, inside ? 'wood' : path ? 'stone' : 'grass');
    if (inside || path || Math.abs(x - door) < 2 && z > z1) continue;
    const far = Math.max(x0 - x, x - x1, z0 - z, z - z1);
    const prop = far >= 2 ? dressing('grass', x, z, false, o.seed % 97) : null;
    if (prop && hash(x, z, o.seed) % 3 === 0) b.prop(x, 1, z, prop);
  }
  for (const [k, piece] of roomEdges(x0, x1, z0, z1, 1, timber)) b.set(k, { i: piece });
  // Two back rooms behind a partition, each with its own doorway into the hall.
  const back = z0 + 1, split = x0 + (w >> 1), solid = timber ? 'wallwood' : 'wall';
  // The building follows from the scene's seed; each room's furnishing from the room's own.
  const was = (kind: string, salt: number) => {
    const q = prior.find((p) => p.kind === kind);
    return { seed: q ? q.seed : o.seed + salt, ...(q?.lock ? { lock: true } : {}) };
  };
  const rooms: GenRoom[] = [
    { kind: 'hall', x0, x1, z0: back + 1, z1, ...was('hall', 11) },
    { kind: 'store', x0, x1: split - 1, z0, z1: back, ...was('store', 12) },
    { kind: 'bedroom', x0: split, x1, z0, z1: back, ...was('bedroom', 13) },
  ];
  const doors = [x0 + r.int(split - x0), split + r.int(x1 - split + 1)], clear = new Set<string>([ck(door, z1)]);
  for (let x = x0; x <= x1; x++) {
    const open = doors.includes(x);
    b.edge(x, 1, back + 1, 'n', open ? 'walldoor' : solid);
    if (open) clear.add(ck(x, back)).add(ck(x, back + 1));
  }
  for (let z = z0; z <= back; z++) b.edge(split, 1, z, 'w', solid);
  // The hall: tables with seats around them, more of them as the slider goes up.
  const hall = rooms[0], spots: [number, number][] = [], hall_r = rng(hall.seed);
  for (let x = hall.x0 + 1; x <= hall.x1 - 1; x += 3) for (let z = hall.z0 + 1; z <= hall.z1 - 1; z += 3) spots.push([x, z]);
  const tables = Math.max(1, div(spots.length * (o.density + 1), 5));
  for (let i = 0; i < tables && spots.length; i++) {
    const [x, z] = spots.splice(hall_r.int(spots.length), 1)[0];
    if (clear.has(ck(x, z)) || x === door) continue;
    b.prop(x, 1, z, 'table', hall_r.int(2));
    for (const [dx, dz, turn] of [[1, 0, 3], [-1, 0, 1], [0, 1, 2], [0, -1, 0]] as const) { // each seat faces the table
      const sx = x + dx, sz = z + dz;
      if (sx < hall.x0 || sx > hall.x1 || sz < hall.z0 || sz > hall.z1 || clear.has(ck(sx, sz)) || sx === door || b.has(sx, 1, sz) || !hall_r.chance(2, 3)) continue;
      b.prop(sx, 1, sz, hall_r.chance(1, 4) ? 'bench' : 'chair', turn);
    }
  }
  const none = new Set<string>();
  for (const k of clear) {
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of NEAR) none.add(ck(x + dx, z + dz));
  }
  for (const k of clear) none.add(k);
  furnish(b, rng(hall.seed + 1), hall, { walls: ['barrel', 'barrel', 'bookshelf', 'candles', 'cauldron', 'crate'], floor: ['rug'] }, o.detail, none, null, 0);
  furnish(b, rng(rooms[1].seed), rooms[1], { walls: ['barrel', 'crate', 'sacks', 'crate', 'barrel'], floor: ['sacks'] }, o.detail + 1, none, null, 0);
  const bed = rooms[2];
  if (!none.has(ck(bed.x1, bed.z0))) b.prop(bed.x1, 1, bed.z0, 'bed'); // headboard to the back wall
  furnish(b, rng(bed.seed), bed, { walls: ['chest', 'bookshelf', 'candles'], floor: ['rug'] }, o.detail, none, null, 0);
  return { edits: b.edits(), bounds: [x0 - yard, x1 + yard, z0 - yard, z1 + yard], rooms };
}

/**
 * Build a scene. Sliders outside 0..4 are brought into range.
 * @param prior the rooms of the scene this one replaces: a locked room is kept as it is
 * @param fixed keep every prior room where it is (redoing one room's furnishing, not the layout)
 */
export function generate(opts: GenOpts, prior: GenRoom[] = [], fixed = false): Scene {
  const c = (v: number) => Math.max(0, Math.min(4, Math.floor(v) || 0));
  const o = { ...opts, seed: opts.seed >>> 0, size: c(opts.size), density: c(opts.density), detail: c(opts.detail) };
  return o.theme === 'dungeon' ? dungeon(o, prior, fixed) : o.theme === 'tavern' ? tavern(o, prior) : o.theme === 'cave' ? cave(o) : forest(o);
}
