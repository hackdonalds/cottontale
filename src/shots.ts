// Things that fly: arrows, thrown rocks, fire bolts, magic missiles.
//
// A shot is for show. It changes nothing on the table and nothing in the store: one small live
// message says who shot what at whom, and every device flies it for itself along a path that
// follows from the two ends alone (a formula, no physics engine). What it does on arrival
// (rock the target, a puff, a thud) is worked out the same way, so nothing has to agree
// between devices beyond the table they already share.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MINIS } from './catalog';
import { canControl, openTo, type MiniVal } from './rules';
import type { Store } from './store';

type Vec = [number, number, number];
/** What is sent: the kind, who shoots (a mini), and at what (a mini, or a spot on the table in half cells). */
export interface Shot { k: string; a: string; b: string | Vec }

interface Kind {
  name: string; icon: string;
  /** Cells per second. */
  speed: number;
  /** How high it rises on the way, as a share of the distance, plus a fixed lift. */
  arc: number; lift?: number;
  /** How far it swings out to the side on the way, as a share of the distance (a homing curve). */
  curve?: number;
  /** Starts slow and gathers speed, like something that seeks its target. */
  seek?: boolean;
  /** Copies trailing behind it, each smaller than the last. */
  trail?: number;
  /** Points the way it is going (otherwise it tumbles, or is round and does not care). */
  points?: boolean; tumbles?: boolean;
  /** How hard it rocks what it hits. */
  push: number;
  color: string; glows?: boolean;
}
export const SHOTS: Record<string, Kind> = {
  arrow: { name: 'Arrow', icon: '🏹', speed: 24, arc: 0.05, points: true, push: 2.2, color: '#d8c49a' },
  rock: { name: 'Rock', icon: '🪨', speed: 9, arc: 0.38, lift: 0.3, tumbles: true, push: 3.2, color: '#8d8a84' },
  fire: { name: 'Fire bolt', icon: '🔥', speed: 13, arc: 0.04, trail: 4, push: 2.8, color: '#ff9a3c', glows: true },
  missile: { name: 'Magic missile', icon: '✨', speed: 10, arc: 0.12, curve: 0.3, seek: true, trail: 5, push: 2, color: '#c9a2ff', glows: true },
  frost: { name: 'Ice shard', icon: '❄️', speed: 18, arc: 0.02, trail: 2, points: true, push: 2.4, color: '#a8e4ff', glows: true },
};
const kindOf = (k: unknown): Kind | undefined => (typeof k === 'string' && Object.hasOwn(SHOTS, k) ? SHOTS[k] : undefined);

/** How long the flight takes: never so quick it cannot be seen, never so slow the table waits for it. */
export function shotTime(kind: string, a: Vec, b: Vec): number {
  return Math.max(0.22, Math.min(2.4, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / SHOTS[kind].speed));
}

/** Where a shot is when it is share `u` of the way (0 = leaving, 1 = arriving). Written into `out`. */
export function shotAt(kind: string, a: Vec, b: Vec, u: number, out: Vec = [0, 0, 0]): Vec {
  const k = SHOTS[kind], dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const w = k.seek ? u * u * (3 - 2 * u) : u, len = Math.hypot(dx, dy, dz), flat = Math.hypot(dx, dz);
  const rise = 4 * (k.arc * len + (k.lift ?? 0)) * w * (1 - w);
  const side = k.curve && flat > 1e-6 ? (k.curve * len * Math.sin(Math.PI * w)) / flat : 0;
  out[0] = a[0] + dx * w - dz * side;
  out[1] = a[1] + dy * w + rise;
  out[2] = a[2] + dz * w + dx * side;
  return out;
}

const half = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n * 2);
/**
 * Check a shot that came in from player `by` against the table. Null unless it is a known kind,
 * shot by a mini that player may play, at another mini or at a sane spot.
 */
export function readShot(store: Store, msg: { k?: unknown; a?: unknown; b?: unknown }, by: string): Shot | null {
  const mini = (id: unknown) => {
    const v = typeof id === 'string' ? store.get<MiniVal>(`m:${id}`) : undefined;
    return v && MINIS[v.k] ? v : null;
  };
  const from = mini(msg.a), b = msg.b;
  if (!kindOf(msg.k) || !from || !canControl(store, by, from)) return null;
  if (typeof b === 'string') return b !== msg.a && mini(b) ? { k: msg.k as string, a: msg.a as string, b } : null;
  if (!Array.isArray(b) || b.length !== 3 || !b.every(half)) return null;
  if (Math.abs(b[0]) > 200 || Math.abs(b[2]) > 200 || b[1] < 0 || b[1] > 64) return null;
  return { k: msg.k as string, a: msg.a as string, b: [b[0], b[1], b[2]] };
}

/** Where a shot leaves a mini, and where one lands on it: the middle of its body. */
function chest(v: MiniVal): Vec {
  const s = v.s || 1, h = MINIS[v.k]?.height ?? 1;
  return [v.x + 0.5, v.y + (v.e ?? 0) + (v.d ? 0.2 : 0.6 * h) * s, v.z + 0.5];
}

/**
 * The two ends of a shot. If a block or a solid wall stands in the straight line, it ends there
 * instead (`hit` false): windows and doorways let it through, as they let the eye through.
 */
export function shotPath(store: Store, from: MiniVal, to: MiniVal | Vec): { a: Vec; b: Vec; hit: boolean } {
  const a = chest(from), b: Vec = Array.isArray(to) ? [to[0], to[1] + 0.1, to[2]] : chest(to);
  const open = openTo(store, a, b);
  if (open === 1) return { a, b, hit: true };
  return { a, b: [a[0] + (b[0] - a[0]) * open, a[1] + (b[1] - a[1]) * open, a[2] + (b[2] - a[2]) * open], hit: false };
}

// ---- the view ---------------------------------------------------------------------
// One shape and one material per kind, made the first time it is shot and shared ever after.
// Each shot in flight is a single draw call (itself and its trail are instances of one mesh),
// and so is each burst.

const shapes = new Map<string, THREE.BufferGeometry>();
const paints = new Map<string, THREE.Material>();
function shape(kind: string): THREE.BufferGeometry {
  let g = shapes.get(kind);
  if (g) return g;
  switch (kind) {
    case 'arrow': { // along +z: a shaft, a head, two crossed feathers
      const shaft = new THREE.CylinderGeometry(0.014, 0.014, 0.7, 5).rotateX(Math.PI / 2);
      const head = new THREE.ConeGeometry(0.04, 0.12, 5).rotateX(Math.PI / 2).translate(0, 0, 0.4);
      const feather = () => new THREE.BoxGeometry(0.1, 0.008, 0.16).translate(0, 0, -0.28);
      g = mergeGeometries([shaft, head, feather(), feather().rotateZ(Math.PI / 2)]);
      break;
    }
    case 'rock': g = new THREE.DodecahedronGeometry(0.13); break;
    case 'fire': g = new THREE.SphereGeometry(0.14, 10, 8); break;
    case 'missile': g = new THREE.OctahedronGeometry(0.11); break;
    default: g = new THREE.ConeGeometry(0.07, 0.42, 5).rotateX(Math.PI / 2);
  }
  shapes.set(kind, g);
  return g;
}
function paint(kind: string): THREE.Material {
  let m = paints.get(kind);
  if (!m) {
    const k = SHOTS[kind];
    m = k.glows ? new THREE.MeshBasicMaterial({ color: k.color, toneMapped: false }) : new THREE.MeshStandardMaterial({ color: k.color, roughness: 0.85, flatShading: true });
    paints.set(kind, m);
  }
  return m;
}
let spark: THREE.BufferGeometry | undefined;

const SPARKS = 8, BURST = 0.42, LAG = 0.032, MAX_LIVE = 6;
interface Flying { kind: string; mesh: THREE.InstancedMesh; a: Vec; b: Vec; t: number; dur: number; landed: (vx: number, vz: number) => void }
interface Burst { mesh: THREE.InstancedMesh; at: Vec; t: number }

export class ShotsView {
  private flying: Flying[] = [];
  private bursts: Burst[] = [];
  /** Called when a shot leaves (`hit` false) and when it lands (`hit` true), for sound. */
  onSound: (kind: string, hit: boolean) => void = () => {};
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private p: Vec = [0, 0, 0];
  private ahead: Vec = [0, 0, 0];
  constructor(private scene: THREE.Scene) {}

  /** How many things are in the air or bursting right now. */
  get live(): number { return this.flying.length + this.bursts.length; }

  /** Send one off from `a` to `b`. `landed` is told which way it was going (flat, unit length) when it arrives. */
  fire(kind: string, a: Vec, b: Vec, landed: (vx: number, vz: number) => void = () => {}): void {
    if (!kindOf(kind)) return;
    while (this.flying.length >= MAX_LIVE) this.drop(this.flying.shift()!.mesh); // a volley too many: the oldest just vanish
    const mesh = new THREE.InstancedMesh(shape(kind), paint(kind), 1 + (SHOTS[kind].trail ?? 0));
    mesh.frustumCulled = false; // it moves every frame: not worth keeping its bounds up to date
    const f: Flying = { kind, mesh, a, b, t: 0, dur: shotTime(kind, a, b), landed };
    this.place(f);
    this.scene.add(mesh);
    this.flying.push(f);
    this.onSound(kind, false);
  }

  private drop(mesh: THREE.InstancedMesh): void {
    this.scene.remove(mesh);
    mesh.dispose(); // its own instance buffer only: shape and material are shared
  }

  private place(f: Flying): void {
    const k = SHOTS[f.kind], n = f.mesh.count;
    for (let j = 0; j < n; j++) {
      const u = Math.max(0, Math.min(1, (f.t - j * LAG) / f.dur));
      shotAt(f.kind, f.a, f.b, u, this.p);
      this.q.identity();
      if (k.points) {
        const e = u < 0.98 ? 0.02 : -0.02;
        shotAt(f.kind, f.a, f.b, u + e, this.ahead);
        this.v.set(this.ahead[0] - this.p[0], this.ahead[1] - this.p[1], this.ahead[2] - this.p[2]).multiplyScalar(Math.sign(e));
        if (this.v.lengthSq() > 1e-12) this.q.setFromUnitVectors(this.s.set(0, 0, 1), this.v.normalize());
      } else if (k.tumbles || f.kind === 'missile') this.q.setFromAxisAngle(this.s.set(0.6, 0.3, 0.74).normalize(), f.t * 13);
      this.m.compose(this.v.set(this.p[0], this.p[1], this.p[2]), this.q, this.s.setScalar(1 - (j / n) * 0.85));
      f.mesh.setMatrixAt(j, this.m);
    }
    f.mesh.instanceMatrix.needsUpdate = true;
  }

  private burst(kind: string, at: Vec): void {
    spark ??= new THREE.OctahedronGeometry(0.055);
    const mesh = new THREE.InstancedMesh(spark, paint(kind), SPARKS + 1);
    mesh.frustumCulled = false;
    const b: Burst = { mesh, at, t: 0 };
    this.puff(b);
    this.scene.add(mesh);
    this.bursts.push(b);
  }

  /** A flash that swells and goes, and a ring of bits thrown up and out that fall as they shrink. */
  private puff(b: Burst): void {
    const u = Math.min(1, b.t / BURST);
    this.q.identity();
    this.m.compose(this.v.set(b.at[0], b.at[1], b.at[2]), this.q, this.s.setScalar((1 + 5 * u) * (1 - u)));
    b.mesh.setMatrixAt(0, this.m);
    for (let i = 1; i <= SPARKS; i++) {
      const turn = i * 2.4, out = (0.9 + (i % 3) * 0.5) * b.t, up = (1.6 + (i % 4) * 0.5) * b.t - 5 * b.t * b.t;
      this.v.set(b.at[0] + Math.cos(turn) * out, b.at[1] + up, b.at[2] + Math.sin(turn) * out);
      this.m.compose(this.v, this.q, this.s.setScalar(1.2 * (1 - u)));
      b.mesh.setMatrixAt(i, this.m);
    }
    b.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Move everything along. True while there is anything to draw (so an idle table stays idle). */
  update(dt: number): boolean {
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      if (f.t < f.dur) { this.place(f); continue; }
      this.flying.splice(i, 1);
      this.drop(f.mesh);
      this.burst(f.kind, f.b);
      this.onSound(f.kind, true);
      const dx = f.b[0] - f.a[0], dz = f.b[2] - f.a[2], flat = Math.hypot(dx, dz) || 1;
      f.landed(dx / flat, dz / flat);
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      if (b.t < BURST) { this.puff(b); continue; }
      this.bursts.splice(i, 1);
      this.drop(b.mesh);
    }
    return this.live > 0;
  }

  /** Take everything out of the air (the table is being cleared for another board). */
  clear(): void {
    for (const f of this.flying) this.drop(f.mesh);
    for (const b of this.bursts) this.drop(b.mesh);
    this.flying = [];
    this.bursts = [];
  }
}
