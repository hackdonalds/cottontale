// Drawing the loose pieces (loose.ts): every piece of one kind is a copy in a single
// instanced mesh, so a heap of rubble costs one draw call however many stones are in it.
// It also plays back recorded pours (pour.ts), and takes care that a piece is never drawn
// twice, falling and already lying there, when its key arrives before the fall has ended.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Swarm } from './board';
import type { Solid } from './dice';
import { KIT, TINT_COLORS, kit, kitPending } from './kit';
import { LOOSE, MAX_LOOSE, POUR_FPS, decodeLoose, decodePour, nearRay, type Loose, type V3 } from './loose';

/** A plain shape painted one colour (the kit's pieces carry their paint in their vertices; these do too). */
function painted(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g, n = out.getAttribute('position').count, c = new THREE.Color(color);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(colors, i * 3);
  out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  out.deleteAttribute('uv');
  return out;
}

/** What each kind looks like when the kit has no model for it (or never will: nobody modelled a coin). */
const PLAIN: Record<string, () => THREE.BufferGeometry> = {
  stone: () => { const g = painted(new THREE.DodecahedronGeometry(1, 0), '#8d8a84'); g.computeVertexNormals(); return g; },
  coin: () => painted(new THREE.CylinderGeometry(1, 1, 2, 12), '#e8b93a'),
  bone: () => painted(mergeGeometries([
    new THREE.CylinderGeometry(0.42, 0.42, 1.5, 6).rotateZ(Math.PI / 2),
    ...[-1, 1].flatMap((x) => [-1, 1].map((z) => new THREE.SphereGeometry(0.62, 6, 5).translate(x * 0.78, 0, z * 0.42))),
  ]), '#e9e2d0'),
  crate: () => painted(new THREE.BoxGeometry(2, 2, 2), '#9a6b3c'),
  barrel: () => painted(new THREE.CylinderGeometry(0.86, 0.86, 2, 10), '#8a5a33'),
};
/** The kit piece a kind borrows its shape from, shrunk to the size of its collider. */
const MODEL: Record<string, string> = { stone: 'p_rock', crate: 'p_crate', barrel: 'p_barrel' };

const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7 });

/** The shape for a kind, sized so that it just fills its collider and centred on the collider's middle. */
function build(kind: string): { geo: THREE.BufferGeometry; mat: THREE.Material; model: boolean } {
  const def = LOOSE[kind], family = MODEL[kind], model = family ? kit.get(family)?.[0] : undefined;
  if (family && !model) kitPending(family); // start fetching its pack; the view is rebuilt when it lands
  const geo = (model ?? PLAIN[kind]()).clone();
  geo.computeBoundingBox();
  const box = geo.boundingBox!, mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  geo.translate(-mid.x, -mid.y, -mid.z).scale((def.h[0] * 2) / size.x, (def.h[1] * 2) / size.y, ((def.round ? def.h[0] : def.h[2]) * 2) / size.z);
  return { geo, mat: model ? KIT : kind === 'coin' ? metal : plain, model: !!model };
}

/** A recorded pour being played back, and afterwards waiting for its pieces to turn up in the table. */
interface Play { kind: string; ids: string[]; n: number; frames: Float32Array[]; t: number; done: () => void; ended: number }
/** How long (ms) pieces that have landed are still shown if their keys never arrive (the pourer dropped out). */
const WAIT = 10_000;

export class LooseView {
  /** The pieces lying on this board, by id. */
  pieces = new Map<string, Loose>();
  playing: Play[] = [];
  /** Called when a falling piece lands on something, with how hard (for sound). */
  onHit: (strength: number) => void = () => {};
  private swarms = new Map<string, { swarm: Swarm; model: boolean }>();
  private dirty = false;
  private m = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private q = new THREE.Quaternion();
  private one = new THREE.Vector3(1, 1, 1);

  /**
   * `make` gives a swarm (see board.ts) for a shape; `hidden` says whether a cell is one this
   * player may not see into (fog, cutaway): pieces lying or falling there are not drawn.
   */
  constructor(private make: (geo: THREE.BufferGeometry, mat: THREE.Material) => Swarm, private hidden: (x: number, y: number, z: number) => boolean) {}

  /** Pieces on the board, counting those still in the air. */
  get count(): number {
    let n = this.pieces.size;
    for (const p of this.playing) for (const id of p.ids) if (!this.pieces.has(id)) n++;
    return n;
  }

  /** A stored piece changed (null or anything malformed: it is gone). */
  set(id: string, value: unknown): void {
    const v = decodeLoose(value);
    if (v) this.pieces.set(id, v);
    else this.pieces.delete(id);
    this.dirty = true;
  }

  /** What is visible may have changed (fog, role, cutaway). */
  refresh(): void { this.dirty = true; }

  /** A pack of kit models arrived: kinds drawn as plain stand-ins take their real shape. */
  kitChanged(): void {
    for (const [kind, s] of this.swarms) {
      if (s.model || !MODEL[kind] || !kit.get(MODEL[kind])) continue;
      s.swarm.mesh.removeFromParent();
      s.swarm.mesh.dispose();
      s.swarm.mesh.geometry.dispose();
      this.swarms.delete(kind);
      this.dirty = true;
    }
  }

  /** Forget everything (another board is about to be shown). */
  clear(): void {
    this.pieces.clear();
    for (const p of this.playing) p.done();
    this.playing.length = 0;
    this.dirty = true;
  }

  /** Play a recorded pour; resolves when the pieces have come to rest (at once, if the recording is malformed). */
  play(t: unknown): Promise<void> {
    const d = decodePour(t);
    if (!d || this.playing.length >= 8) return Promise.resolve();
    return new Promise((done) => {
      this.playing.push({ ...d, t: 0, done, ended: 0 });
      this.dirty = true;
    });
  }

  private seen(p: ArrayLike<number>, at = 0): boolean {
    return !this.hidden(Math.floor(p[at]), Math.floor(p[at + 1]), Math.floor(p[at + 2]));
  }

  /** Advance the pours being played and redraw what changed. Returns true while something on screen is changing. */
  update(dt: number): boolean {
    let busy = false;
    for (let i = this.playing.length - 1; i >= 0; i--) {
      const p = this.playing[i], end = (p.n - 1) / POUR_FPS;
      if (!p.ended) {
        const was = p.t;
        p.t += dt;
        busy = this.dirty = true;
        // A piece that was falling and is no longer has just landed on something.
        const a = Math.floor(Math.min(p.t, end) * POUR_FPS), prev = Math.floor(Math.min(was, end) * POUR_FPS);
        if (a > prev && a >= 1 && a + 1 < p.n) {
          let hard = 0;
          for (const f of p.frames) {
            const down = f[a * 7 + 1] - f[(a - 1) * 7 + 1], up = f[(a + 1) * 7 + 1] - f[a * 7 + 1];
            if (down < -0.04 && up > down * 0.3 && this.seen(f, a * 7)) hard = Math.max(hard, Math.min(1, -down * 3));
          }
          if (hard) this.onHit(hard);
        }
        if (p.t >= end) {
          p.ended = performance.now();
          p.done(); // the pourer now writes the resting places into the table
        }
        continue;
      }
      // Landed. Each piece is handed over to the table as its key arrives; until then it stays as it fell.
      if (p.ids.every((id) => this.pieces.has(id)) || performance.now() - p.ended > WAIT) {
        this.playing.splice(i, 1);
        busy = this.dirty = true;
      }
    }
    if (this.dirty) { this.rebuild(); busy = true; }
    return busy;
  }

  private rebuild(): void {
    this.dirty = false;
    const lots = new Map<string, [THREE.Matrix4, THREE.Color][]>();
    const tint = (id: string) => TINT_COLORS[(id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % TINT_COLORS.length];
    const put = (kind: string, id: string, f: ArrayLike<number>, at: number) => {
      if (!this.seen(f, at)) return;
      let lot = lots.get(kind);
      if (!lot) lots.set(kind, (lot = []));
      this.m.compose(this.v.set(f[at], f[at + 1], f[at + 2]), this.q.set(f[at + 3], f[at + 4], f[at + 5], f[at + 6]).normalize(), this.one);
      lot.push([this.m.clone(), tint(id)]);
    };
    // Pieces in a pour that is playing are drawn by the pour, wherever the table says they lie.
    const flying = new Set<string>();
    for (const p of this.playing) {
      const f = Math.min(p.t * POUR_FPS, p.n - 1), a = Math.floor(f), b = Math.min(a + 1, p.n - 1), k = f - a;
      const pose = new Float32Array(7);
      p.ids.forEach((id, i) => {
        if (p.ended && this.pieces.has(id)) return; // handed over
        flying.add(id);
        const fr = p.frames[i];
        // (Quaternions a frame apart are close: a straight blend, normalised, is as good as a slerp.)
        const flip = fr[a * 7 + 3] * fr[b * 7 + 3] + fr[a * 7 + 4] * fr[b * 7 + 4] + fr[a * 7 + 5] * fr[b * 7 + 5] + fr[a * 7 + 6] * fr[b * 7 + 6] < 0 ? -1 : 1;
        for (let c = 0; c < 7; c++) pose[c] = fr[a * 7 + c] * (1 - k) + fr[b * 7 + c] * k * (c < 3 ? 1 : flip);
        put(p.kind, id, pose, 0);
      });
    }
    let n = 0;
    for (const [id, v] of this.pieces) {
      if (flying.has(id) || ++n > MAX_LOOSE) continue; // more than a board holds: someone is misbehaving
      put(v.kind, id, [...v.p, ...v.q], 0);
    }
    for (const kind of new Set([...lots.keys(), ...this.swarms.keys()])) {
      const lot = lots.get(kind) ?? [];
      let s = this.swarms.get(kind);
      if (!s) {
        if (!lot.length) continue;
        const { geo, mat, model } = build(kind);
        this.swarms.set(kind, (s = { swarm: this.make(geo, mat), model }));
      }
      s.swarm.begin(lot.length);
      for (const [m, c] of lot) s.swarm.add(m, c);
      s.swarm.end();
    }
  }

  /** The pieces lying near a spot that this player can see, as things for dice (and other pieces) to bounce off. */
  solids(c: V3, reach: number): Solid[] {
    const out: Solid[] = [];
    for (const v of this.pieces.values()) {
      if (Math.abs(v.p[0] - c[0]) > reach || Math.abs(v.p[2] - c[2]) > reach || !this.seen(v.p)) continue;
      const def = LOOSE[v.kind];
      out.push({ p: [...v.p], h: [...def.h], q: [...v.q], ...(def.round ? { round: true } : {}) });
    }
    return out;
  }

  /** The ids of the visible pieces within `radius` of a ray (a fingertip is wider than a coin), nearest first. */
  near(ray: THREE.Ray, radius: number, far = Infinity): string[] {
    const seen = [...this.pieces].filter(([, v]) => this.seen(v.p)).map(([id, v]) => [id, v.p] as [string, V3]);
    return nearRay(ray.origin.toArray(), ray.direction.toArray(), seen, radius, far);
  }
}
