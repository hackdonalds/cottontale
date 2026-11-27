// The rolling boulder: a GM's trap.
//
// Built on the dice pattern (see dice.ts). The GM's device simulates the whole
// roll up front over the real terrain, records it, and sends the recording in a
// live message; everyone plays it back, so all players watch the same rock take
// the same path. What it does to the table (figures bowled over) is worked out
// from the recording by the GM's device alone and written as ordinary edits.
import * as THREE from 'three';
import { BLOCKS, MINIS } from './catalog';
import { columns, type Solid } from './dice';
import { EDGES, edgeBetween, type CellVal, type EdgeVal, type MiniVal } from './rules';
import type { Store } from './store';

type V3 = [number, number, number];

/** A recorded roll: delta-coded [x,y,z (cm from origin), qx,qy,qz,qw (‰)] per frame. */
export interface Roll { o: V3; n: number; q: number[] }

export const BOULDER_R = 0.9;
/** How far around the start the terrain is made solid; the boulder stops if it gets that far. */
export const BOULDER_REACH = 24;
const FPS = 30;
const MAX_FRAMES = 240; // 8 seconds
const MIN_PUSH = 3, MAX_PUSH = 12;

// ---- recording ------------------------------------------------------------------

/** The boulder's path, frame by frame, or null if the recording is malformed. */
export function decodeRoll(t: Roll): { pos: THREE.Vector3[]; rot: THREE.Quaternion[] } | null {
  if (!t || !Array.isArray(t.o) || !Array.isArray(t.q)) return null;
  const n = t.n;
  if (!Number.isInteger(n) || n < 1 || n > MAX_FRAMES || t.q.length !== n * 7) return null;
  if (t.o.length !== 3 || !t.o.every(Number.isFinite) || !t.q.every(Number.isFinite)) return null;
  const acc = [0, 0, 0, 0, 0, 0, 0], pos: THREE.Vector3[] = [], rot: THREE.Quaternion[] = [];
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < 7; c++) acc[c] += t.q[f * 7 + c];
    pos.push(new THREE.Vector3(t.o[0] + acc[0] / 100, t.o[1] + acc[1] / 100, t.o[2] + acc[2] / 100));
    if (!acc[3] && !acc[4] && !acc[5] && !acc[6]) return null; // not a rotation
    rot.push(new THREE.Quaternion(acc[3], acc[4], acc[5], acc[6]).normalize());
  }
  return { pos, rot };
}

// ---- simulation (the GM's device only) ---------------------------------------------

/**
 * Stacks of blocks joined into as few boxes as possible: neighbours of the same height become
 * one slab [x, y, z, w, h, d]. A flat floor is then one box, not a thousand, which keeps the
 * physics quick on a phone and leaves the boulder no seams to trip on.
 */
export function slabs(cols: [number, number, number, number][]): [x: number, y: number, z: number, w: number, h: number, d: number][] {
  const levels = new Map<string, Set<string>>();
  for (const [x, y, z, h] of cols) {
    const k = `${y},${h}`;
    if (!levels.has(k)) levels.set(k, new Set());
    levels.get(k)!.add(`${x},${z}`);
  }
  const out: [number, number, number, number, number, number][] = [];
  for (const [k, left] of levels) {
    const [y, h] = k.split(',').map(Number);
    for (const cell of [...left]) {
      if (!left.has(cell)) continue;
      const [x, z] = cell.split(',').map(Number);
      let w = 1, d = 1;
      while (left.has(`${x + w},${z}`)) w++;
      const row = (zz: number) => { for (let i = 0; i < w; i++) if (!left.has(`${x + i},${zz}`)) return false; return true; };
      while (row(z + d)) d++;
      for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) left.delete(`${x + i},${z + j}`);
      out.push([x, y, z, w, h, d]);
    }
  }
  return out;
}

/**
 * Let a boulder go at `start` with a push of `vel` (units/s, flat) and record where it rolls.
 * `solids` are the walls and furniture in its way (not the figures: it ploughs through those).
 * It stops when it comes to rest, leaves the built area, or after eight seconds.
 */
export async function simulateBoulder(start: V3, vel: V3, store: Store, solids: Solid[] = []): Promise<Roll> {
  const C = await import('cannon-es');
  const world = new C.World({ gravity: new C.Vec3(0, -32, 0), allowSleep: true });
  world.defaultContactMaterial.friction = 0.6;
  world.defaultContactMaterial.restitution = 0.18; // rock, not rubber
  const R = BOULDER_R;
  const fixed = (shape: InstanceType<typeof C.Shape>, x: number, y: number, z: number, ex = 0) => {
    const b = new C.Body({ type: C.Body.STATIC, shape, position: new C.Vec3(x, y, z) });
    b.quaternion.setFromEuler(ex, 0, 0);
    world.addBody(b);
  };
  fixed(new C.Plane(), 0, 0, 0, -Math.PI / 2); // the table top

  // The terrain, and with it the built area: beyond it there is nothing to roll over.
  const cols = columns(store, Math.floor(start[0]), Math.floor(start[2]), BOULDER_REACH);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, ground = 0;
  for (const [x, y, z, h] of cols) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1);
    // What the boulder is set down on: the highest ground under it that is not above it.
    if (Math.abs(x + 0.5 - start[0]) < 0.5 + R * 0.7 && Math.abs(z + 0.5 - start[2]) < 0.5 + R * 0.7 && y + h <= start[1] + 0.5) ground = Math.max(ground, y + h);
  }
  for (const [x, y, z, w, h, d] of slabs(cols)) fixed(new C.Box(new C.Vec3(w / 2, h / 2, d / 2)), x + w / 2, y + h / 2, z + d / 2);
  const o: V3 = [Math.round(start[0] * 100) / 100, Math.round(Math.max(start[1], ground + R) * 100) / 100, Math.round(start[2] * 100) / 100];
  // A piece the boulder starts inside of is left out: it would be shot out of it.
  for (const s of solids) {
    const [hx, hy, hz] = s.round ? [s.h[0], s.h[1], s.h[0]] : s.h;
    if (Math.abs(o[0] - s.p[0]) < hx + R && Math.abs(o[1] - s.p[1]) < hy + R && Math.abs(o[2] - s.p[2]) < hz + R) continue;
    fixed(s.round ? new C.Cylinder(s.h[0], s.h[0], s.h[1] * 2, 8) : new C.Box(new C.Vec3(hx, hy, hz)), ...s.p);
  }

  // The push: along the flick, already turning as if it had been rolling all along.
  const push = new THREE.Vector3(vel[0], 0, vel[2]);
  if (push.lengthSq() > 0) push.clampLength(MIN_PUSH, MAX_PUSH);
  const body = new C.Body({
    mass: 400,
    shape: new C.Sphere(R),
    position: new C.Vec3(...o),
    velocity: new C.Vec3(push.x, 0, push.z),
    angularVelocity: new C.Vec3(push.z / R, 0, -push.x / R),
    linearDamping: 0.4, angularDamping: 0.4, // rough ground: it does not roll for ever
    allowSleep: true, sleepSpeedLimit: 0.35, sleepTimeLimit: 0.3,
  });
  world.addBody(body);

  // How far outside what has been built a spot is. A boulder let go out on the bare table just rolls there.
  const outside = (x: number, z: number) => (x0 > x1 ? 0 : Math.max(x0 - x, x - x1, z0 - z, z - z1));
  const began = outside(o[0], o[2]) <= 0;
  const q: number[] = [];
  let last = [0, 0, 0, 0, 0, 0, 0], n = 0, quiet = 0, slice = performance.now();
  for (let step = 0; n < MAX_FRAMES; step++) {
    if (step % 2 === 0) {
      const p = body.position, r = body.quaternion;
      const now = [
        Math.round((p.x - o[0]) * 100), Math.round((p.y - o[1]) * 100), Math.round((p.z - o[2]) * 100),
        Math.round(r.x * 1000), Math.round(r.y * 1000), Math.round(r.z * 1000), Math.round(r.w * 1000),
      ];
      let still = true;
      for (let c = 0; c < 7; c++) {
        const d = now[c] - last[c];
        if (Math.abs(d) > (c < 3 ? 1 : 6)) still = false;
        q.push(d);
      }
      last = now;
      n++;
      quiet = still ? quiet + 1 : 0;
      if (n > 10 && (quiet >= 12 || body.sleepState === C.Body.SLEEPING)) break;
      // Off the edge of what has been built (or of what was made solid): gone.
      if ((began && outside(p.x, p.z) > R + 1) || Math.abs(p.x - o[0]) > BOULDER_REACH - 1 || Math.abs(p.z - o[2]) > BOULDER_REACH - 1) break;
    }
    world.step(1 / (FPS * 2));
    if (performance.now() - slice > 10) { // stay responsive on slow phones
      await new Promise((r) => setTimeout(r));
      slice = performance.now();
    }
  }
  return { o, n, q };
}

// ---- what it does to the table --------------------------------------------------------

/** A figure in the boulder's way: at frame `f` it goes down, and ends up in cell `to`. */
export interface Hit { f: number; id: string; from: V3; to: V3 }

/**
 * The figures a recorded roll bowls over, in the order it reaches them. Each is knocked down
 * and shoved one cell the way the boulder was going, if that cell is free and no wall or
 * window stands in between; off a ledge it drops to the ground below. Whole numbers only.
 */
export function boulderHits(t: Roll, store: Store): Hit[] {
  const d = decodeRoll(t);
  if (!d) return [];
  const minis = new Map<string, MiniVal>();
  for (const k of store.keys('m:')) {
    const v = store.get<MiniVal>(k);
    if (v && [v.x, v.y, v.z].every(Number.isInteger)) minis.set(k.slice(2), v);
  }
  const taken = new Set([...minis.values()].map((v) => `${v.x},${v.y},${v.z}`));
  const cell = (x: number, y: number, z: number) => store.get<CellVal>(`b:${x},${y},${z}`);
  const out: Hit[] = [];
  for (let f = 0; f < d.pos.length && minis.size; f++) {
    const p = d.pos[f];
    for (const [id, v] of minis) {
      const s = v.s || 1, feet = v.y + (v.e || 0), tall = (MINIS[v.k]?.height ?? 0.9) * s;
      if (Math.hypot(p.x - v.x - 0.5, p.z - v.z - 0.5) >= BOULDER_R || p.y - BOULDER_R >= feet + tall || p.y + BOULDER_R <= feet) continue;
      minis.delete(id);
      const a = d.pos[Math.max(0, f - 3)], b = d.pos[Math.min(d.pos.length - 1, f + 3)];
      const dx = b.x - a.x, dz = b.z - a.z;
      let to: V3 = [v.x, v.y, v.z];
      if (Math.hypot(dx, dz) > 0.05) {
        // One cell along whichever way the boulder is mostly heading.
        const [tx, tz] = Math.abs(dx) >= Math.abs(dz) ? [v.x + Math.sign(dx), v.z] : [v.x, v.z + Math.sign(dz)];
        const wall = store.get<EdgeVal>(edgeBetween(v.y, v.x, v.z, tx, tz));
        let y = v.y;
        if (!cell(tx, y, tz) && !(wall && EDGES[wall.i] && wall.i !== 'walldoor')) {
          const solid = (yy: number) => { const c = cell(tx, yy, tz); return !!c && !!BLOCKS[c.i]; };
          while (y > 0 && !solid(y - 1)) y--;
          if (!taken.has(`${tx},${y},${tz}`) && (y === v.y || !cell(tx, y, tz))) to = [tx, y, tz];
        }
      }
      taken.delete(`${v.x},${v.y},${v.z}`);
      taken.add(to.join());
      out.push({ f, id, from: [v.x, v.y, v.z], to });
    }
  }
  return out;
}

// ---- rendering -------------------------------------------------------------------------

let rock: THREE.BufferGeometry | undefined, stone: THREE.MeshStandardMaterial | undefined;
/** One rough, faceted rock, shared by every boulder that is ever shown. */
function look(): [THREE.BufferGeometry, THREE.MeshStandardMaterial] {
  if (!rock) {
    rock = new THREE.IcosahedronGeometry(BOULDER_R, 1);
    const p = rock.getAttribute('position'), col: number[] = [];
    // Dent it: every corner is pulled in a little by an amount that depends only on where it is,
    // so the faces that share a corner still meet.
    const noise = (x: number, y: number, z: number) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < p.count; i++) {
      const x = Math.round(p.getX(i) * 100), y = Math.round(p.getY(i) * 100), z = Math.round(p.getZ(i) * 100);
      const k = 1 - noise(x, y, z) * 0.16;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    // Each facet its own shade of grey.
    for (let i = 0; i < p.count; i += 3) {
      const g = 0.8 + noise(i, 1, 2) * 0.3;
      for (let j = 0; j < 3; j++) col.push(g, g, g * 0.97);
    }
    rock.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    rock.computeVertexNormals();
    stone = new THREE.MeshStandardMaterial({ color: '#8b877d', vertexColors: true, flatShading: true, roughness: 0.95 });
  }
  return [rock, stone!];
}

interface Rolling { t: number; n: number; mesh: THREE.Mesh; pos: THREE.Vector3[]; rot: THREE.Quaternion[]; onFrame: (f: number) => void; frame: number }
const LINGER = 2; // seconds a boulder stays where it stopped before it goes

/** Shows boulders: the one the GM is about to let go, and recorded rolls playing back. */
export class BoulderView {
  private rolling: Rolling[] = [];
  private held: { mesh: THREE.Mesh; to: THREE.Vector3 } | null = null;
  private loud = false;
  private dir = new THREE.Vector3();
  /** How loudly the boulders are rumbling right now, 0–1 (0 once, when they stop). */
  onRumble: (level: number) => void = () => {};
  /** A boulder landed or hit something, and how hard. */
  onThud: (strength: number) => void = () => {};
  /** A boulder is passing this spot, moving this way (so the pieces beside it can shake). */
  onPass: (at: THREE.Vector3, dir: THREE.Vector3) => void = () => {};
  /** `hidden`: is this spot of the table kept from this player (fog)? The boulder is not drawn there. */
  constructor(private scene: THREE.Scene, private hidden: (x: number, z: number) => boolean = () => false) {}

  private make(): THREE.Mesh {
    const m = new THREE.Mesh(...look());
    m.castShadow = true;
    this.scene.add(m);
    return m;
  }

  /** The GM holds a boulder over the table at `at` until it is let go. */
  hold(at: THREE.Vector3): void {
    this.endHold();
    const mesh = this.make();
    mesh.position.copy(at);
    this.held = { mesh, to: at.clone() };
  }
  moveHold(at: THREE.Vector3): void { this.held?.to.copy(at); }
  /** Where the held boulder is, so the roll starts where the hand let go. */
  holdAt(): V3 | null { return this.held ? this.held.mesh.position.toArray() : null; }
  endHold(): void {
    if (this.held) this.scene.remove(this.held.mesh);
    this.held = null;
  }

  /** Play a roll. `onFrame` is told each recorded frame as it is reached. False if the recording is malformed. */
  play(t: Roll, onFrame: (f: number) => void = () => {}): boolean {
    const d = decodeRoll(t);
    if (!d) return false;
    const mesh = this.make();
    mesh.position.copy(d.pos[0]);
    mesh.quaternion.copy(d.rot[0]);
    mesh.visible = !this.hidden(Math.floor(d.pos[0].x), Math.floor(d.pos[0].z));
    this.rolling.push({ t: 0, n: t.n, mesh, ...d, onFrame, frame: -1 });
    return true;
  }

  /** The table was swapped for another: nothing is rolling any more. */
  clear(): void {
    for (const r of this.rolling) this.scene.remove(r.mesh);
    this.rolling.length = 0;
    this.endHold();
    if (this.loud) this.onRumble(0);
    this.loud = false;
  }

  /** Advance animations. Returns true while something on screen is changing. */
  update(dt: number): boolean {
    let busy = false, level = 0;
    const h = this.held;
    if (h) {
      const before = h.mesh.position.distanceToSquared(h.to);
      h.mesh.position.lerp(h.to, 1 - Math.exp(-dt * 18));
      if (before > 1e-6) busy = true;
    }
    for (let i = this.rolling.length - 1; i >= 0; i--) {
      const r = this.rolling[i], end = (r.n - 1) / FPS;
      const was = r.t;
      r.t += dt;
      if (was < end || r.frame < r.n - 1) {
        const f = Math.min(r.t * FPS, r.n - 1), a = Math.floor(f), b = Math.min(a + 1, r.n - 1);
        for (let k = r.frame + 1; k <= a; k++) {
          const P = r.pos;
          if (k >= 1 && k + 1 < r.n) {
            // Falling and now not: it has come down on something. Or its sideways speed changed sharply.
            const down = P[k].y - P[k - 1].y, up = P[k + 1].y - P[k].y;
            const jolt = Math.hypot(P[k + 1].x - 2 * P[k].x + P[k - 1].x, P[k + 1].z - 2 * P[k].z + P[k - 1].z) * FPS;
            if (down < -0.06 && up > down * 0.3) this.onThud(Math.min(1, -down * 3));
            else if (jolt > 2) this.onThud(Math.min(1, jolt / 8));
          }
          if (k + 1 < r.n && this.dir.subVectors(P[k + 1], P[k]).setY(0).lengthSq() > 1e-4) this.onPass(P[k], this.dir.multiplyScalar(FPS));
          r.onFrame(k);
        }
        r.frame = a;
        r.mesh.position.lerpVectors(r.pos[a], r.pos[b], f - a);
        r.mesh.quaternion.slerpQuaternions(r.rot[a], r.rot[b], f - a);
        r.mesh.visible = !this.hidden(Math.floor(r.mesh.position.x), Math.floor(r.mesh.position.z));
        if (b > a) level = Math.max(level, Math.min(1, r.pos[b].distanceTo(r.pos[a]) * FPS / 8));
        busy = true;
      }
      const fade = r.t - end - LINGER;
      if (fade > 0) {
        // It sinks away into the table, so the shared material never has to turn see-through.
        const s = Math.max(0, 1 - fade / 0.5);
        r.mesh.scale.setScalar(s);
        r.mesh.position.y = r.pos[r.n - 1].y - (1 - s) * BOULDER_R;
        busy = true;
        if (s === 0) {
          this.scene.remove(r.mesh);
          this.rolling.splice(i, 1);
        }
      }
    }
    if (level > 0 || this.loud) this.onRumble(level);
    this.loud = level > 0;
    return busy;
  }
}
