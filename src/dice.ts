// Physics dice.
//
// The thrower's device simulates the whole throw up front (rigid bodies
// bouncing on the real terrain), records it, and reads the result off the
// dice. The recording travels in the roll message and everyone plays it back,
// so all players watch the exact same tumble and land on the same faces —
// no cross-device physics determinism needed, and viewers never load the
// physics engine at all.
import * as THREE from 'three';
import { BLOCKS } from './catalog';
import type { Store } from './store';

export type Kind = 'd2' | 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';
type V3 = [number, number, number];

/** A recorded throw: per die, delta-coded [x,y,z (cm from origin), qx,qy,qz,qw (‰)] per frame. */
export interface Throw { o: V3; k: Kind[]; n: number; q: number[][] }

export const MAX_DICE = 12;
const FPS = 30;
const MAX_FRAMES = 190;
const PHI = (1 + Math.sqrt(5)) / 2;

// ---- shapes ------------------------------------------------------------------

interface Shape {
  verts: THREE.Vector3[];
  faces: number[][]; // vertex indices, counter-clockwise seen from outside
  normals: THREE.Vector3[];
  /** What each face (d4: each vertex) reads as. */
  labels: number[];
}

/** Faces of a convex solid, found by brute force (the solids are tiny). */
function hull(verts: THREE.Vector3[]): { faces: number[][]; normals: THREE.Vector3[] } {
  const faces: number[][] = [], normals: THREE.Vector3[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) for (let k = j + 1; k < verts.length; k++) {
    const n = a.subVectors(verts[j], verts[i]).cross(b.subVectors(verts[k], verts[i])).clone();
    if (n.lengthSq() < 1e-9) continue;
    n.normalize();
    let d = n.dot(verts[i]), above = false, below = false;
    for (const v of verts) {
      const s = n.dot(v) - d;
      if (s > 1e-6) above = true;
      else if (s < -1e-6) below = true;
    }
    if (above && below) continue; // cuts through the solid: not a face
    if (above) { n.negate(); d = -d; }
    if (normals.some((m) => m.dot(n) > 0.9999)) continue;
    const idx = verts.map((_, x) => x).filter((x) => Math.abs(n.dot(verts[x]) - d) < 1e-6);
    const c = idx.reduce((s, x) => s.add(verts[x]), new THREE.Vector3()).divideScalar(idx.length);
    const u = verts[idx[0]].clone().sub(c).normalize(), w = n.clone().cross(u);
    const ang = (x: number) => Math.atan2(b.subVectors(verts[x], c).dot(w), b.dot(u));
    faces.push(idx.sort((p, q) => ang(p) - ang(q)));
    normals.push(n);
  }
  return { faces, normals };
}

const RADIUS: Record<Kind, number> = { d2: 0.46, d4: 0.44, d6: 0.42, d8: 0.42, d10: 0.42, d100: 0.42, d12: 0.44, d20: 0.46 };

function points(kind: Kind): V3[] {
  const s = [-1, 1];
  switch (kind) {
    // A coin: a squat twelve-sided prism lying flat, thick enough for the physics to hold on to.
    // Its rim comes to a ridge, so it cannot stand on edge and spoil the flip.
    case 'd2': return [0.2, 0, -0.2].flatMap((y) => Array.from({ length: 12 }, (_, i) => { const r = y ? 0.86 : 1; return [r * Math.cos((i * Math.PI) / 6), y, r * Math.sin((i * Math.PI) / 6)] as V3; }));
    case 'd4': return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    case 'd6': return s.flatMap((x) => s.flatMap((y) => s.map((z) => [x, y, z] as V3)));
    case 'd8': return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    case 'd10': case 'd100': {
      // Pentagonal trapezohedron: two tips and a zigzag ring, at the height that makes the kites flat.
      const c = Math.cos(Math.PI / 5), h = (1 - c) / (1 + c);
      return [[0, 0, 1], [0, 0, -1], ...Array.from({ length: 10 }, (_, i) => [Math.cos((i * Math.PI) / 5), Math.sin((i * Math.PI) / 5), i % 2 ? -h : h] as V3)];
    }
    case 'd12': return [
      ...s.flatMap((x) => s.flatMap((y) => s.map((z) => [x, y, z] as V3))),
      ...s.flatMap((p) => s.flatMap((q) => [[0, p / PHI, q * PHI], [p / PHI, q * PHI, 0], [p * PHI, 0, q / PHI]] as V3[])),
    ];
    case 'd20': return s.flatMap((p) => s.flatMap((q) => [[0, p, q * PHI], [p, q * PHI, 0], [p * PHI, 0, q]] as V3[]));
  }
}

const shapes = new Map<Kind, Shape>();
export function shape(kind: Kind): Shape {
  let sh = shapes.get(kind);
  if (sh) return sh;
  const raw = points(kind).map((p) => new THREE.Vector3(...p));
  const scale = RADIUS[kind] / Math.max(...raw.map((v) => v.length()));
  const verts = raw.map((v) => v.multiplyScalar(scale));
  const { faces, normals } = hull(verts);
  let labels: number[];
  if (kind === 'd4') labels = [1, 2, 3, 4]; // read from the vertex pointing up
  else if (kind === 'd2') labels = faces.map((f, i) => (f.length === 4 ? 0 : normals[i].y > 0 ? 1 : 2)); // heads, tails; the rim reads as nothing
  else {
    // Like real dice: opposite faces add up to the same total.
    const ten = kind === 'd10' || kind === 'd100';
    const seq = faces.map((_, i) => (ten ? i : i + 1));
    labels = new Array(faces.length).fill(-1);
    let next = 0;
    faces.forEach((_, f) => {
      if (labels[f] >= 0) return;
      labels[f] = seq[next];
      labels[normals.findIndex((m) => m.dot(normals[f]) < -0.9999)] = seq[seq.length - 1 - next];
      next++;
    });
  }
  sh = { verts, faces, normals, labels };
  shapes.set(kind, sh);
  return sh;
}

/** Which label a die shows when resting with this orientation. */
export function reading(kind: Kind, q: THREE.Quaternion): number {
  const sh = shape(kind);
  const dirs = kind === 'd4' ? sh.verts : sh.normals;
  const v = new THREE.Vector3();
  let best = 0, top = -Infinity;
  dirs.forEach((d, i) => {
    if (kind === 'd2' && !sh.labels[i]) return; // a coin on its rim still shows a side: the one leaning up
    const y = v.copy(d).applyQuaternion(q).y;
    if (y > top) { top = y; best = i; }
  });
  return sh.labels[best];
}

// ---- recording ------------------------------------------------------------------

/** The path of every die of a recorded throw, frame by frame, or null if the recording is malformed. */
export function decode(t: Throw): { pos: THREE.Vector3[][]; rot: THREE.Quaternion[][] } | null {
  if (!t || !Array.isArray(t.k) || !Array.isArray(t.q) || !Array.isArray(t.o)) return null;
  const n = t.n;
  if (!Number.isInteger(n) || n < 1 || n > MAX_FRAMES || !t.k.length || t.k.length > MAX_DICE || t.q.length !== t.k.length) return null;
  if (t.o.length !== 3 || !t.o.every(Number.isFinite) || !t.k.every((k) => Object.prototype.hasOwnProperty.call(RADIUS, k))) return null;
  const pos: THREE.Vector3[][] = [], rot: THREE.Quaternion[][] = [];
  for (const d of t.q) {
    if (!Array.isArray(d) || d.length !== n * 7 || !d.every(Number.isFinite)) return null;
    const acc = [0, 0, 0, 0, 0, 0, 0], P: THREE.Vector3[] = [], R: THREE.Quaternion[] = [];
    for (let f = 0; f < n; f++) {
      for (let c = 0; c < 7; c++) acc[c] += d[f * 7 + c];
      P.push(new THREE.Vector3(t.o[0] + acc[0] / 100, t.o[1] + acc[1] / 100, t.o[2] + acc[2] / 100));
      R.push(new THREE.Quaternion(acc[3], acc[4], acc[5], acc[6]).normalize());
    }
    pos.push(P);
    rot.push(R);
  }
  return { pos, rot };
}

/** The labels the dice of a recorded throw came to rest on, or null if the recording is malformed. */
export function results(t: Throw): number[] | null {
  const d = decode(t);
  return d && t.k.map((k, i) => reading(k, d.rot[i][t.n - 1]));
}

/** Values of a throw: a tens die followed by a d10 is one percentile roll; a lone d10's 0 is ten. */
export function rollValues(kinds: Kind[], labels: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === 'd100' && kinds[i + 1] === 'd10') { out.push(labels[i] * 10 + labels[i + 1] || 100); i++; }
    else out.push(kinds[i] === 'd10' ? labels[i] || 10 : labels[i]);
  }
  return out;
}
/** What to show floating above each die once it has landed. */
function faceTexts(kinds: Kind[], labels: number[]): string[] {
  return kinds.map((k, i) => (k === 'd2' ? 'HT'[labels[i] - 1] : k === 'd100' ? `${labels[i]}0` : k === 'd10' && kinds[i - 1] !== 'd100' ? String(labels[i] || 10) : String(labels[i])));
}
export function kindsFor(n: number, sides: number): Kind[] | null {
  const k: Kind[] = sides === 100 ? ['d100', 'd10'] : [`d${sides}` as Kind];
  if (!Object.prototype.hasOwnProperty.call(RADIUS, k[0]) || sides === 1 || n * k.length > MAX_DICE) return null;
  return Array.from({ length: n }, () => k).flat();
}

/**
 * Something standing on the table that dice bounce off: a box (`h` = half extents) or, with
 * `round`, an upright cylinder (`h[0]` radius, `h[1]` half height). `p` is its centre; `q`
 * turns it, for things that lie as they fell.
 */
export interface Solid { p: V3; h: V3; round?: boolean; q?: [number, number, number, number] }

/** Where a held die is when it leaves the hand. */
export interface Start { p: V3; q: [number, number, number, number] }

// ---- simulation (thrower only) ------------------------------------------------------

/**
 * The blocks around a spot as boxes for a physics world: [x, y, z, height] of each run of
 * stacked blocks (one tall box has fewer seams to snag on than a pile of cubes).
 */
export function columns(store: Store, cx: number, cz: number, edge: number): [number, number, number, number][] {
  const solid = (x: number, y: number, z: number) => {
    const v = store.get<{ i: string }>(`b:${x},${y},${z}`);
    return !!v && !!BLOCKS[v.i];
  };
  const out: [number, number, number, number][] = [];
  for (let x = cx - edge; x <= cx + edge; x++) for (let z = cz - edge; z <= cz + edge; z++) {
    for (let y = 0; y < 40; y++) {
      if (!solid(x, y, z)) continue;
      let top = y;
      while (solid(x, top + 1, z)) top++;
      out.push([x, y, z, top - y + 1]);
      y = top;
    }
  }
  return out;
}

const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
const spread = (r: number) => (rnd() * 2 - 1) * r;

/**
 * Fling dice from where they were held, with the velocity of the hand, and
 * record what happens. `center`/`tray` describe the visible patch of table the
 * dice are kept on. The physics engine is loaded on first use, keeping it out
 * of the initial download.
 */
export async function simulate(kinds: Kind[], starts: Start[], vel: V3, center: V3, store: Store, tray = 6, solids: Solid[] = []): Promise<Throw> {
  const C = await import('cannon-es');
  const world = new C.World({ gravity: new C.Vec3(0, -32, 0), allowSleep: true });
  world.defaultContactMaterial.friction = 0.32;
  world.defaultContactMaterial.restitution = 0.38;
  const o = center.map((v) => Math.round(v * 100) / 100) as V3;

  // The table, an invisible tray so dice stay in view, and the terrain around the landing spot.
  const fixed = (shape: InstanceType<typeof C.Shape>, x: number, y: number, z: number, ex = 0, ey = 0) => {
    const b = new C.Body({ type: C.Body.STATIC, shape, position: new C.Vec3(x, y, z) });
    b.quaternion.setFromEuler(ex, ey, 0);
    world.addBody(b);
    return b;
  };
  const TRAY = tray, EDGE = Math.ceil(tray) + 1;
  fixed(new C.Plane(), 0, 0, 0, -Math.PI / 2);
  fixed(new C.Plane(), o[0] - TRAY, 0, o[2], 0, Math.PI / 2);
  fixed(new C.Plane(), o[0] + TRAY, 0, o[2], 0, -Math.PI / 2);
  fixed(new C.Plane(), o[0], 0, o[2] - TRAY, 0, 0);
  fixed(new C.Plane(), o[0], 0, o[2] + TRAY, 0, Math.PI);
  const tops = new Map<string, number>();
  for (const [x, y, z, h] of columns(store, Math.floor(o[0]), Math.floor(o[2]), EDGE)) {
    fixed(new C.Box(new C.Vec3(0.5, h / 2, 0.5)), x + 0.5, y + h / 2, z + 0.5);
    tops.set(`${x},${z}`, y + h);
  }

  // Let go: every die leaves with the hand's velocity plus a little of its own. A
  // plain tap (no fling) still gets a gentle toss so the dice tumble.
  const fling = new THREE.Vector3(vel[0], 0, vel[2]);
  if (fling.length() < 2) fling.set(spread(1), 0, spread(1)).setLength(2 + rnd());
  fling.clampLength(0, 16);
  const spin = 10 + fling.length() * 1.6;
  const bodies = kinds.map((kind, i) => {
    const sh = shape(kind), st = starts[i];
    const clamp = (v: number, c: number) => Math.min(c + TRAY - 0.6, Math.max(c - TRAY + 0.6, v));
    const x = clamp(st.p[0], o[0]), z = clamp(st.p[2], o[2]);
    const ground = tops.get(`${Math.floor(x)},${Math.floor(z)}`) ?? 0;
    // A coin is flipped, not rolled: tossed higher and slower, turning end over end about an
    // axis lying in its own plane (as near as that gets to square across the throw).
    const coin = kind === 'd2';
    const turn = new THREE.Vector3(spread(spin), spread(spin), spread(spin));
    if (coin) {
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(...st.q));
      turn.set(-fling.z, 0, fling.x).addScaledVector(up, -up.dot(turn));
      if (turn.lengthSq() < 0.01) turn.set(0, 1, 0); // on edge, facing the throw: spin it like a top
      turn.setLength(18 + rnd() * 10).add(new THREE.Vector3(spread(3), spread(3), spread(3)));
    }
    const push = coin ? 0.6 : 1;
    const body = new C.Body({
      mass: 1,
      shape: new C.ConvexPolyhedron({ vertices: sh.verts.map((v) => new C.Vec3(v.x, v.y, v.z)), faces: sh.faces.map((f) => [...f]) }),
      position: new C.Vec3(x, Math.max(st.p[1], ground + 0.7), z),
      quaternion: new C.Quaternion(...st.q),
      velocity: new C.Vec3(fling.x * push * (0.85 + rnd() * 0.3) + spread(0.8), coin ? 6 + rnd() * 3 : 1.5 + rnd() * 1.5, fling.z * push * (0.85 + rnd() * 0.3) + spread(0.8)),
      angularVelocity: new C.Vec3(turn.x, turn.y, turn.z),
      linearDamping: 0.12, angularDamping: coin ? 0.4 : 0.12, // a coin lying flat would otherwise spin on like a top
      allowSleep: true, sleepSpeedLimit: 0.25, sleepTimeLimit: 0.3,
    });
    world.addBody(body);
    return body;
  });

  // Pieces on the table. One a die starts inside of is left out: it would be shot out of it.
  const reach = 0.5;
  for (const s of solids) {
    const [hx, hy, hz] = s.round ? [s.h[0], s.h[1], s.h[0]] : s.h;
    if (bodies.some((b) => Math.abs(b.position.x - s.p[0]) < hx + reach && Math.abs(b.position.y - s.p[1]) < hy + reach && Math.abs(b.position.z - s.p[2]) < hz + reach)) continue;
    const b = fixed(s.round ? new C.Cylinder(s.h[0], s.h[0], s.h[1] * 2, 8) : new C.Box(new C.Vec3(hx, hy, hz)), ...s.p);
    if (s.q) b.quaternion.set(...s.q);
  }

  const q: number[][] = kinds.map(() => []);
  const last = kinds.map(() => [0, 0, 0, 0, 0, 0, 0]);
  let n = 0, quiet = 0, slice = performance.now();
  for (let step = 0; n < MAX_FRAMES; step++) {
    if (step % 2 === 0) {
      let still = true;
      bodies.forEach((b, i) => {
        const now = [
          Math.round((b.position.x - o[0]) * 100), Math.round((b.position.y - o[1]) * 100), Math.round((b.position.z - o[2]) * 100),
          Math.round(b.quaternion.x * 1000), Math.round(b.quaternion.y * 1000), Math.round(b.quaternion.z * 1000), Math.round(b.quaternion.w * 1000),
        ];
        for (let c = 0; c < 7; c++) {
          const d = now[c] - last[i][c];
          if (Math.abs(d) > (c < 3 ? 1 : 6)) still = false;
          q[i].push(d);
        }
        last[i] = now;
      });
      n++;
      // Done when the engine puts every die to sleep, or when nothing has visibly
      // moved for half a second (dice leaning on each other can jitter forever).
      quiet = still ? quiet + 1 : 0;
      if (n > 20 && (quiet >= 15 || bodies.every((b) => b.sleepState === C.Body.SLEEPING))) break;
    }
    world.step(1 / (FPS * 2));
    if (performance.now() - slice > 10) { // stay responsive on slow phones
      await new Promise((r) => setTimeout(r));
      slice = performance.now();
    }
  }
  return { o, k: kinds, n, q };
}

// ---- rendering -----------------------------------------------------------------------

const geometries = new Map<Kind, THREE.BufferGeometry>();
const CELL = 128;
const grid = (kind: Kind) => { const cols = Math.ceil(Math.sqrt(shape(kind).faces.length)); return { cols, rows: Math.ceil(shape(kind).faces.length / cols) }; };

/** 2D frame on a face: where its corners sit in a unit square, with "up" chosen so numbers read well. */
function faceFrame(kind: Kind, f: number): { pts: THREE.Vector2[] } {
  const sh = shape(kind), idx = sh.faces[f], n = sh.normals[f];
  const c = idx.reduce((s, x) => s.add(sh.verts[x]), new THREE.Vector3()).divideScalar(idx.length);
  const up = kind === 'd6' ? sh.verts[idx[0]].clone().add(sh.verts[idx[1]]).multiplyScalar(0.5).sub(c) : sh.verts[idx[0]].clone().sub(c);
  up.normalize();
  const right = up.clone().cross(n);
  const rel = idx.map((x) => sh.verts[x].clone().sub(c));
  const r = Math.max(...rel.map((v) => v.length()));
  return { pts: rel.map((v) => new THREE.Vector2(v.dot(right) / r, v.dot(up) / r)) };
}

function geometry(kind: Kind): THREE.BufferGeometry {
  let g = geometries.get(kind);
  if (g) return g;
  const sh = shape(kind), { cols, rows } = grid(kind);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  sh.faces.forEach((idx, f) => {
    const { pts } = faceFrame(kind, f), n = sh.normals[f];
    const u = (p: THREE.Vector2) => [((f % cols) + 0.5 + p.x * 0.47) / cols, 1 - (Math.floor(f / cols) + 0.5 - p.y * 0.47) / rows];
    for (let t = 1; t < idx.length - 1; t++) for (const k of [0, t, t + 1]) {
      pos.push(...sh.verts[idx[k]].toArray());
      nor.push(n.x, n.y, n.z);
      uv.push(...u(pts[k]));
    }
  });
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometries.set(kind, g);
  return g;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();
/** `blank` dice have no numbers: what players see when the GM rolls in secret. */
function material(kind: Kind, color: string, blank = false): THREE.MeshStandardMaterial {
  const key = `${kind}|${color}|${blank}`;
  let m = materials.get(key);
  if (m) return m;
  const sh = shape(kind), { cols, rows } = grid(kind);
  const cv = document.createElement('canvas');
  cv.width = cols * CELL;
  cv.height = rows * CELL;
  const g = cv.getContext('2d')!;
  g.fillStyle = color;
  g.fillRect(0, 0, cv.width, cv.height);
  const c = new THREE.Color(color);
  g.fillStyle = c.r * 0.299 + c.g * 0.587 + c.b * 0.114 > 0.5 ? '#14161c' : '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = (s: string, px: number) => {
    g.font = `800 ${px}px system-ui, sans-serif`;
    g.fillText(s, 0, 0);
    if (sh.faces.length > 8 && (s === '6' || s === '9')) g.fillRect(-px * 0.26, px * 0.48, px * 0.52, px * 0.09); // tell 6 from 9
  };
  if (!blank) sh.faces.forEach((idx, f) => {
    const x = ((f % cols) + 0.5) * CELL, y = (Math.floor(f / cols) + 0.5) * CELL;
    if (kind === 'd4') {
      // Each corner carries its vertex's number; the corner pointing up is the result.
      faceFrame(kind, f).pts.forEach((p, k) => {
        g.save();
        g.translate(x + p.x * CELL * 0.26, y - p.y * CELL * 0.26);
        g.rotate(Math.atan2(p.x, p.y));
        text(String(sh.labels[idx[k]]), CELL * 0.24);
        g.restore();
      });
      return;
    }
    if (kind === 'd2') {
      // Heads and tails, ringed like a struck coin; the rim stays plain.
      if (!sh.labels[f]) return;
      g.save();
      g.translate(x, y);
      g.lineWidth = CELL * 0.035;
      g.strokeStyle = g.fillStyle as string;
      g.beginPath();
      g.arc(0, 0, CELL * 0.36, 0, Math.PI * 2);
      g.stroke();
      text('HT'[sh.labels[f] - 1], CELL * 0.4);
      g.restore();
      return;
    }
    const label = kind === 'd100' ? `${sh.labels[f]}0` : String(sh.labels[f]);
    g.save();
    g.translate(x, y);
    text(label, CELL * (kind === 'd6' ? 0.56 : kind === 'd12' ? 0.42 : label.length > 1 ? 0.27 : 0.34));
    g.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05 });
  materials.set(key, m);
  return m;
}

const sprites = new Map<string, THREE.SpriteMaterial>();
function numberSprite(text: string): THREE.Sprite {
  let m = sprites.get(text);
  if (!m) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const g = cv.getContext('2d')!;
    g.fillStyle = 'rgba(15,17,23,.85)';
    g.beginPath();
    g.arc(48, 48, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd166';
    g.font = `800 ${text.length > 2 ? 38 : 50}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 48, 51);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    m = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    sprites.set(text, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.setScalar(0.62);
  s.renderOrder = 20;
  return s;
}

interface Playing {
  owner: string; t: number; n: number; kinds: Kind[]; done: () => void; settled: boolean;
  meshes: THREE.Object3D[]; pos: THREE.Vector3[][]; rot: THREE.Quaternion[][]; blank: boolean;
}
interface Held { meshes: THREE.Mesh[]; axes: THREE.Vector3[]; offs: THREE.Vector3[]; at: THREE.Vector3; to: THREE.Vector3 }
const LINGER = 12; // seconds the dice stay on the table after settling

/** Shows dice: the ones in your hand, and recorded throws playing back. */
export class DiceView {
  private playing: Playing[] = [];
  private held: Held | null = null;
  /** Called when a die bounces, with how hard and whose die it is (for sound and touch). */
  onHit: (strength: number, owner: string) => void = () => {};
  /** Called when a die is knocked sideways: where it was, and how its velocity changed (so what it hit can react). */
  onBump: (at: THREE.Vector3, dv: THREE.Vector3) => void = () => {};
  private dv = new THREE.Vector3();
  constructor(private scene: THREE.Scene) {}

  /** Pick the dice up: they hover and tumble at `at` until thrown. */
  hold(kinds: Kind[], color: string, at: THREE.Vector3): void {
    this.endHold();
    const meshes = kinds.map((kind) => {
      const m = new THREE.Mesh(geometry(kind), material(kind, color));
      m.castShadow = true;
      m.quaternion.setFromEuler(new THREE.Euler(spread(Math.PI), spread(Math.PI), spread(Math.PI)));
      this.scene.add(m);
      return m;
    });
    // A loose cluster (sunflower layout), so a dozen dice still read as one handful.
    const offs = kinds.map((_, i) => new THREE.Vector3(Math.cos(i * 2.4), 0, Math.sin(i * 2.4)).multiplyScalar(0.62 * Math.sqrt(i)).setY((i % 3) * 0.25));
    const axes = kinds.map(() => new THREE.Vector3(spread(1), spread(1), spread(1)).normalize());
    this.held = { meshes, axes, offs, at: at.clone(), to: at.clone() };
  }
  moveHold(at: THREE.Vector3): void { this.held?.to.copy(at); }
  /** Exact pose of each held die, so the throw starts where the hand let go. */
  holdStarts(): Start[] {
    return (this.held?.meshes ?? []).map((m) => ({ p: m.position.toArray(), q: m.quaternion.toArray() as Start['q'] }));
  }
  endHold(): void {
    for (const m of this.held?.meshes ?? []) this.scene.remove(m);
    this.held = null;
  }

  /** Play a throw; resolves when the dice have come to rest. Each player has one set of dice on the table. */
  play(t: Throw, color: string, owner: string, blank = false): Promise<void> {
    const d = decode(t);
    if (!d) return Promise.resolve();
    for (const p of this.playing) if (p.owner === owner) p.t = Math.max(p.t, p.n / FPS + LINGER);
    return new Promise((done) => {
      const meshes = t.k.map((kind, i) => {
        const m = new THREE.Mesh(geometry(kind), material(kind, color, blank));
        m.castShadow = true;
        m.position.copy(d.pos[i][0]);
        m.quaternion.copy(d.rot[i][0]);
        this.scene.add(m);
        return m;
      });
      this.playing.push({ owner, t: 0, n: t.n, kinds: t.k, meshes, ...d, done, settled: false, blank });
    });
  }

  /** Advance animations. Returns true while something on screen is changing. */
  update(dt: number): boolean {
    let busy = false;
    const h = this.held;
    if (h) {
      h.at.lerp(h.to, 1 - Math.exp(-dt * 18));
      h.meshes.forEach((m, i) => {
        m.position.copy(h.at).add(h.offs[i]);
        m.rotateOnWorldAxis(h.axes[i], dt * 7);
      });
      busy = true;
    }
    for (let i = this.playing.length - 1; i >= 0; i--) {
      const p = this.playing[i];
      const end = (p.n - 1) / FPS;
      const was = p.t;
      p.t += dt;
      if (was < end) {
        const f = Math.min(p.t * FPS, p.n - 1), a = Math.floor(f), b = Math.min(a + 1, p.n - 1);
        // A die that was falling and is now rising has just hit something.
        const prev = Math.floor(Math.min(was * FPS, p.n - 1));
        if (a > prev && a >= 1 && a + 1 < p.n) {
          for (const P of p.pos) {
            const down = P[a].y - P[a - 1].y, up = P[a + 1].y - P[a].y;
            if (down < -0.03 && up > down * 0.3) this.onHit(Math.min(1, -down * 4), p.owner);
          }
        }
        // A die whose sideways speed has changed sharply has run into something. Worked out from the
        // recording, so every player sees the same pieces get knocked.
        for (let i = Math.max(1, prev + 1); i <= a && i + 1 < p.n; i++) {
          for (const P of p.pos) {
            const dv = this.dv.copy(P[i + 1]).addScaledVector(P[i], -2).add(P[i - 1]).multiplyScalar(FPS);
            if (Math.hypot(dv.x, dv.z) > 1.2) this.onBump(P[i], dv);
          }
        }
        p.kinds.forEach((_, k) => {
          p.meshes[k].position.lerpVectors(p.pos[k][a], p.pos[k][b], f - a);
          p.meshes[k].quaternion.slerpQuaternions(p.rot[k][a], p.rot[k][b], f - a);
        });
        busy = true;
      }
      if (!p.settled && p.t >= end) {
        p.settled = true;
        // Float each die's number above it, so the roll reads at a glance from any angle.
        const labels = p.kinds.map((k, j) => reading(k, p.rot[j][p.n - 1]));
        if (!p.blank) faceTexts(p.kinds, labels).forEach((text, j) => {
          const s = numberSprite(text);
          s.position.copy(p.pos[j][p.n - 1]).y += 0.85;
          this.scene.add(s);
          p.meshes.push(s);
        });
        p.done();
        busy = true;
      }
      const fade = p.t - end - LINGER;
      if (fade > 0) {
        const s = Math.max(0, 1 - fade / 0.3);
        p.meshes.forEach((m, k) => m.scale.setScalar(s * (k < p.kinds.length ? 1 : 0.62)));
        busy = true;
        if (s === 0) {
          for (const m of p.meshes) this.scene.remove(m);
          this.playing.splice(i, 1);
        }
      }
    }
    return busy;
  }
}
