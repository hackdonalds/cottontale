// The 3D table: renders the shared Store and turns pointer input into edits.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BLOCKS, MINIS, PROPS, STANDIN_HEIGHT, makeMini, makeProp } from './catalog';
import { KIT, TINT_COLORS, WILD, kit, kitPending, onKitPack, rand, setSeason, setWind, withDetail, type Season } from './kit';
import { Glide, ambientDue, ambientLive, flicker, nudge, outOfView, readView, safeArea, type Ambience } from './glide';
import { GROUND, buildTerrain, type Column, type Terrain } from './terrain';
import { BoulderView } from './boulder';
import { DiceView, type Solid, type Kind, type Start } from './dice';
import { Debris } from './debris';
import { BREAK_KEY, broken, debrisOf, seedOf, shatter } from './breaking';
import { SHOTS, ShotsView, shotPath, type Shot } from './shots';
import { buzz } from './haptics';
import { LIGHT_LEVELS, nextLight } from './rules';
import { RISE, SQUASH, TOPPLE, hopAt, hopPlan, nearestDir, riseAt, squashAt, toppleAt } from './feel';
import { EDGES, columnTop, ek, eyesOf, fogged, grow, levelTo, measure, miniShown, parseEdge, playerEyes, regions, resurface, roomEdges, sculpt, shownToPlayers, type CellVal, type EdgeVal, type MiniVal, type Side } from './rules';
import type { Store } from './store';
import { heading, land } from './forces';
import { areaKeys, boundsOf, copyEdits, kindOf, moveEdits, present, removeEdits, turnAreaEdits, turnEdits, whereIs, type Picked } from './pick';
import { Look } from './look';
import { onRegistry } from './registry';
import { standees } from './standee';
import type { DiceLook, Fog, Grade, Light } from './theme';
import { LooseView } from './looseview';
import { decodeLoose } from './loose';
import { TABLE_SPAN, tableTexture } from './table';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type { CellVal, MiniVal };
/** `pick` is Build with nothing in hand: a tap selects what is there, a drag on anything else moves the camera. */
export type Tool = 'move' | 'build' | 'mini' | 'ruler' | 'fog' | 'pick';
export type Vec = [number, number, number];
export type RulerMode = 'line' | 'circle' | 'cone';
export interface Ruler { a: Vec; b: Vec; m: RulerMode }
export type Sky = 'day' | 'dusk' | 'night';
/** A copied chunk of the build: cells relative to its corner. */
export interface Slab { w: number; h: number; d: number; cells: [number, number, number, CellVal][] }
export const EMOTES: Record<string, string> = { attack: '⚔️', hurt: '💥', cheer: '🎉', wave: '👋', think: '❓', love: '❤️', sleep: '💤' };
const SLAB_MAX = 4000;

export interface BoardHooks {
  onSelect(id: string | null): void;
  onLiveMove(id: string, p: Vec): void;
  onPing(p: Vec): void;
  /** Template for a mini about to be placed at a cell. */
  newMini(): Omit<MiniVal, 'x' | 'y' | 'z'>;
  /** May this player drag that mini? */
  canMove(id: string): boolean;
  /** The player touched the table with dice in hand. */
  onGrab(): void;
  /** The dice left the hand at these poses with this velocity (units/s). */
  onThrow(starts: Start[], vel: Vec): void;
  /** The GM let a boulder go here with this velocity (units/s). */
  onBoulder(start: Vec, vel: Vec): void;
  /** The local ruler changed (null = put away). Called often while measuring. */
  onRuler(r: Ruler | null): void;
  /** An area was copied with the copy brush. */
  onSlab(slab: Slab): void;
  /** The scatter brush was tapped at a spot (`a` = `b`) or dragged from `a` to `b`: pour loose pieces out there. */
  onPour?(a: Vec, b: Vec): void;
  /** A light was stepped to another strength with the light brush. */
  onLight(name: string): void;
  /** A carried mini touched down (`mine`: this player put it there). */
  onLand(mine: boolean): void;
  /** The picture was just redrawn: anything pinned to a spot on the table should follow. */
  onView(): void;
  /** A mini set down by hand had nothing under it and fell this many cells. */
  onFall(id: string, cells: number): void;
  /** The player pointed which way to shove a mini (`sx`, `sz` each -1, 0 or 1; both 0 = never mind). */
  onShove(id: string, sx: number, sz: number): void;
  /** The pieces selected with the pick tool changed (none = an empty list), or a move of them ended. */
  onPick?(keys: string[]): void;
  /** An area was dragged out with the pick tool: how many pieces it took (0 = none there), or null when it held too many to take. */
  onArea?(n: number | null): void;
  /** A tap of the fog tool hid or revealed this many columns (0: nothing changed); `room`: a whole room or region, not one column. */
  onFog?(cells: number, hide: boolean, room: boolean): void;
}

const LIMIT = 96;
const MAX_Y = 40;
const ck = (x: number, y: number, z: number) => `b:${x},${y},${z}`;
const parse = (key: string) => key.slice(2).split(',').map(Number) as Vec;
type Edge = [x: number, y: number, z: number, s: Side];
// What an edge wall and its corner post look like if the kit could not be fetched. Like the
// modelled pieces, they sit on the low-z side (the low corner) of a cell centred on the origin.
const PLAIN_WALL = new THREE.BoxGeometry(1, 1, 0.11).translate(0, 0.5, -0.5);
const PLAIN_POST = new THREE.BoxGeometry(0.26, 1, 0.26).translate(-0.5, 0.5, -0.5);
const ROOM_MAX = 24;
/** Props that shed light: its colour, its strength, and how high above the floor it burns. */
const GLOWS: Record<string, [color: string, power: number, height: number]> = {
  torch: ['#ffae5e', 11, 1.0], campfire: ['#ff9440', 14, 0.45], candles: ['#ffc98a', 6, 0.5], cauldron: ['#9dff8a', 5, 0.6],
  crystal: ['#7fd8ff', 7, 0.6], portal: ['#b594ff', 9, 0.8], hoard: ['#ffd76a', 3, 0.3],
};
/** Brushes that shape or dress the land (see rules.ts). */
const LAND = new Set(['raise', 'lower', 'level', 'grow']);
function noise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Many copies of one shape as a single draw call, refilled from scratch whenever its contents change. */
export class Swarm {
  mesh: THREE.InstancedMesh;
  /** What each copy stands for (a cell key), by instance number. */
  keys: string[] = [];
  private cap = 64;

  constructor(private geo: THREE.BufferGeometry, private mat: THREE.Material, private scene: THREE.Scene, private shadow: boolean) {
    this.mesh = this.make();
  }
  private make(): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, this.mat, this.cap);
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false;
    m.castShadow = this.shadow;
    m.receiveShadow = true;
    m.userData.swarm = this;
    this.scene.add(m);
    return m;
  }
  /** Start over, with room for `n` copies. */
  begin(n: number): void {
    if (n > this.cap) {
      while (n > this.cap) this.cap *= 2;
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = this.make();
    }
    this.keys.length = 0;
  }
  add(m: THREE.Matrix4, c: THREE.Color, key = ''): void {
    const i = this.keys.push(key) - 1;
    this.mesh.setMatrixAt(i, m);
    this.mesh.setColorAt(i, c);
  }
  end(): void {
    this.mesh.count = this.keys.length;
    this.mesh.visible = this.keys.length > 0; // an empty swarm should not cost a draw call
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.boundingSphere = null;
    this.mesh.boundingBox = null;
  }
}

/** All blocks of one material. A modelled block is a family of shapes: one swarm for each member. */
class Layer {
  cells = new Set<string>();
  dirty = false;
  swarms: Swarm[];
  private base: THREE.Color;
  /** How much each block's shade wanders. Modelled blocks get their variety from shape and surface detail instead. */
  private tint: number;
  /** How many ways a modelled block may be turned: any quarter, or (boards, which have a direction) end for end. */
  private turns: number;

  constructor(id: string, scene: THREE.Scene, private hidden: (x: number, y: number, z: number) => boolean) {
    const d = BLOCKS[id];
    const h = d.h ?? 1;
    // A modelled block carries its own paint; a plain one is a box tinted per instance.
    const family = kit.get(`b_${id}`);
    this.base = new THREE.Color(family ? '#ffffff' : d.color);
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: d.rough ?? 0.9, vertexColors: !!family,
      transparent: d.opacity !== undefined, opacity: d.opacity ?? 1,
      emissive: d.glow ? this.base : new THREE.Color(0), emissiveIntensity: d.glow ?? 0,
    });
    if (family) withDetail(mat);
    this.tint = family ? 0 : 0.07;
    this.turns = !family ? 1 : id === 'wood' ? 2 : 4;
    this.swarms = (family ?? [new THREE.BoxGeometry(1, h, 1).translate(0, h / 2, 0)]).map((g) => new Swarm(g, mat, scene, !mat.transparent));
  }
  /** Its kind of block has left the library (see registry.ts): take its meshes off the table. */
  dispose(scene: THREE.Scene): void {
    for (const w of this.swarms) { scene.remove(w.mesh); w.mesh.dispose(); }
    (this.swarms[0]?.mesh.material as THREE.Material | undefined)?.dispose();
  }
  rebuild(): void {
    this.dirty = false;
    // Which member of the family a block is, and which way it is turned, follow from where it lies.
    const lots: Vec[][] = this.swarms.map(() => []);
    for (const key of this.cells) {
      const [x, y, z] = parse(key);
      if (this.hidden(x, y, z)) continue; // above the cutaway, or under fog
      lots[Math.floor(rand(x, y, z, 11) * lots.length)].push([x, y, z]);
    }
    const m = new THREE.Matrix4(), c = new THREE.Color();
    this.swarms.forEach((swarm, i) => {
      swarm.begin(lots[i].length);
      for (const [x, y, z] of lots[i]) {
        m.makeRotationY(Math.floor(rand(x, y, z, 12) * this.turns) * (Math.PI * 2 / this.turns)).setPosition(x + 0.5, y, z + 0.5);
        swarm.add(m, c.copy(this.base).offsetHSL(0, 0, (noise(x, y, z) - 0.5) * this.tint), ck(x, y, z));
      }
      swarm.end();
    });
  }
}

/** A smooth field over the table in [0, 1): the same hills and hollows of chance for everyone. */
function field(x: number, z: number, size: number, salt: number): number {
  const u = x / size, v = z / size, x0 = Math.floor(u), z0 = Math.floor(v);
  const fx = (u - x0) * (u - x0) * (3 - 2 * (u - x0)), fz = (v - z0) * (v - z0) * (3 - 2 * (v - z0));
  const at = (i: number, j: number) => rand(x0 + i, salt, z0 + j, 97);
  return (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fz) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fz;
}

interface Undo { k: string; prev: unknown }
/** One pointer's journey from down to up. */
interface Gesture {
  id: number; x: number; y: number; button: number;
  touch: boolean; moved: boolean;
  /** Already handled (long-press ping): releasing does nothing more. */
  done: boolean;
  /** A mini being dragged, or one that was only tapped (not ours to move). */
  mini: string | null;
  tapMini: string | null;
  /** Holding dice: recent hand positions, to measure the fling. */
  throwing: { t: number; p: THREE.Vector3 }[] | null;
  /** Measuring: where the ruler started. */
  measure: Vec | null;
  /** Dragging with a finger (or the mouse, in ruler/fog) is the tool, not the camera. */
  drags: boolean;
  /** Touch editing: what the first contact pointed at, and the flat layer a drag paints on. */
  first: Vec | null;
  stroke: { level: number; plane: number } | null;
  /** Scattering: where on the table the finger came down. Wiping: the stroke began on loose pieces, and clears only those. */
  from?: Vec | null;
  wipe?: boolean;
  /** Shaping the land: the columns this stroke has already touched (each changes once a stroke). */
  shaped?: Set<string>;
  /** Drawing a wall: the edge the finger started on. The run stays in line with it. */
  edge?: Edge | null;
  press?: ReturnType<typeof setTimeout>;
  /** Carrying the selected pieces to another spot. */
  piece?: boolean;
  /** Dragging out an area to select (the pick tool, with `areaPick` on). */
  area?: boolean;
}
const TOUCH_LIFT = 44; // px a dragged mini floats above the fingertip so it stays visible
const LONG_PRESS = 550;

/** A piece rocking after a knock: how far it leans (radians, toward +x and +z) and how fast that is changing. */
interface Wobble { x: number; z: number; vx: number; vz: number; base?: THREE.Quaternion; obj?: THREE.Object3D }
const DIE = 0.45; // about the radius of a die
const BAND = 0.5;

/**
 * Rough solid shape of a prop for dice to bounce off: one box per half-cell of height, each as
 * wide as the model is there (so a tree is a trunk under a canopy, not one big block).
 */
/** Where a wall edge or a cell is, from its key (`side` is empty for a cell). */
const pieceAt = (key: string): [x: number, y: number, z: number, side: Side | ''] => (key.startsWith('w:') ? parseEdge(key) : [...parse(key), '']);
function propSolids(g: THREE.Group): Solid[] {
  g.updateMatrixWorld(true);
  const y0 = g.position.y, bands: number[][] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  const put = (v: THREE.Vector3, i: number) => {
    if (i < 0 || i > 7) return;
    const m = (bands[i] ??= [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]);
    m[0] = Math.min(m[0], v.x); m[1] = Math.max(m[1], v.x);
    m[2] = Math.min(m[2], v.y); m[3] = Math.max(m[3], v.y);
    m[4] = Math.min(m[4], v.z); m[5] = Math.max(m[5], v.z);
  };
  // An edge reaches into every band it passes through, at the points where it crosses between them.
  const edge = (u: THREE.Vector3, v: THREE.Vector3) => {
    const lo = Math.floor((Math.min(u.y, v.y) - y0) / BAND), hi = Math.floor((Math.max(u.y, v.y) - y0) / BAND);
    put(u, Math.floor((u.y - y0) / BAND));
    for (let i = lo + 1; i <= hi; i++) {
      p.lerpVectors(u, v, (y0 + i * BAND - u.y) / (v.y - u.y));
      put(p, i - 1);
      put(p, i);
    }
  };
  g.traverse((o) => {
    const mesh = o as THREE.Mesh, pos = mesh.geometry?.getAttribute('position'), mat = mesh.material as THREE.Material | undefined;
    if (!mesh.isMesh || !pos || (o as THREE.InstancedMesh).isInstancedMesh || mat?.transparent) return;
    const idx = mesh.geometry.index, n = idx ? idx.count : pos.count;
    const at = (v: THREE.Vector3, i: number) => v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    for (let i = 0; i + 2 < n; i += 3) {
      at(a, i); at(b, i + 1); at(c, i + 2);
      edge(a, b); edge(b, c); edge(c, a);
    }
  });
  const out: Solid[] = [];
  bands.forEach((m, i) => {
    const under = bands[i - 1];
    if (m[3] - m[2] < 0.12) { // a sliver: part of what it sits on, or (rugs, petals) nothing to bounce off
      if (under && out.length) { const b = out[out.length - 1]; b.p[1] += (m[3] - m[2]) / 2; b.h[1] += (m[3] - m[2]) / 2; }
      return;
    }
    out.push({ p: [(m[0] + m[1]) / 2, (m[2] + m[3]) / 2, (m[4] + m[5]) / 2], h: [(m[1] - m[0]) / 2, (m[3] - m[2]) / 2, (m[5] - m[4]) / 2] });
  });
  return out;
}

interface Mini extends Feel { group: THREE.Group; target: THREE.Vector3; val: MiniVal; sig: string }
/** What a mini is in the middle of, for show only (see `src/feel.ts`): each is gone again once it has played out. */
interface Feel {
  /** Falling over, or (`up`) getting back up: seconds in. */
  fall?: { t: number; up: boolean };
  /** Seconds since it landed. */
  squash?: number;
  /** In the air between two spots: where it left from, the arc, and which way it is going. */
  hop?: { from: THREE.Vector3; t: number; dur: number; h: number; dx: number; dz: number };
  /** How fast it was being carried last frame, to feel the pull when that changes. */
  vel?: [x: number, z: number];
}

// Shared by every mini: one base shape, one material per base colour, one invisible hit area.
const BASE = new THREE.CylinderGeometry(0.38, 0.4, 0.08, 24);
const HIT = new THREE.CylinderGeometry(0.56, 0.56, 1, 10).translate(0, 0.5, 0);
const UNSEEN = new THREE.MeshBasicMaterial({ visible: false });
const baseMaterials = new Map<string, THREE.MeshStandardMaterial>();
function baseMaterial(color: string): THREE.MeshStandardMaterial {
  let m = baseMaterials.get(color);
  if (!m) baseMaterials.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.5 })));
  return m;
}
const SUN_OFFSET = new THREE.Vector3(22, 40, 14);

/**
 * Labels, speech bubbles and editing aids are see-through flat things. The finished look works
 * out shadowing and focus from how deep each pixel is, and to that a see-through label is a
 * solid slab: it came out as a dark box. So they live on a layer of their own, which is drawn
 * over the finished picture instead of through it.
 */
const OVERLAY = 1;
function textSprite(draw: (g: CanvasRenderingContext2D) => void, w: number, h: number, scale: number): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  draw(g);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(scale, (scale * h) / w, 1);
  s.layers.set(OVERLAY);
  return s;
}

/** What is drawn over a mini besides its name: its bar, and marks for the conditions it is under. */
export interface Face { hp?: number; mhp?: number; marks?: string }

/** Name plate with an optional hit-point bar, floating over a mini. Marks sit in a row above it, on the same plate. */
function plate(v: MiniVal, f: Face = v): THREE.Sprite {
  const bar = typeof f.mhp === 'number' && f.mhp > 0;
  const marks = f.marks ?? '', up = marks ? 40 : 0;
  const s = textSprite((g) => {
    if (marks) {
      g.font = '28px system-ui, sans-serif';
      const w = Math.min(244, g.measureText(marks).width + 20);
      g.fillStyle = 'rgba(15,17,23,.72)';
      g.beginPath();
      g.roundRect(128 - w / 2, 2, w, 36, 12);
      g.fill();
      g.fillStyle = '#fff';
      g.fillText(marks, 128, 21, 232);
      g.translate(0, up);
    }
    if (v.n) {
      g.font = '600 30px system-ui, sans-serif';
      const w = Math.min(244, g.measureText(v.n).width + 24);
      g.fillStyle = 'rgba(15,17,23,.72)';
      g.beginPath();
      g.roundRect(128 - w / 2, 4, w, 44, 14);
      g.fill();
      g.fillStyle = '#fff';
      g.fillText(v.n, 128, 27, 232);
    }
    if (bar) {
      const hp = f.hp ?? 0, mhp = f.mhp!;
      const full = Math.max(0, Math.min(1, hp / mhp));
      g.fillStyle = 'rgba(15,17,23,.85)';
      g.beginPath();
      g.roundRect(38, 56, 180, 30, 10);
      g.fill();
      g.fillStyle = full > 0.5 ? '#46a758' : full > 0.25 ? '#f2a33a' : '#e5484d';
      g.beginPath();
      g.roundRect(42, 60, Math.max(8, 172 * full), 22, 7);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '700 20px system-ui, sans-serif';
      g.fillText(`${hp}/${mhp}`, 128, 72);
    }
  }, 256, 96 + up, 1.6);
  s.center.set(0.5, 48 / (96 + up)); // the extra row grows upwards: name and bar stay where they were
  s.visible = !!v.n || bar || !!marks;
  return s;
}

/**
 * `spill`: how far fire and magic glow into the picture; `sheen`: how much of the room shows in polished things.
 * These three are what a sky looks like unless the board's theme brings a light of its own (see theme.ts).
 */
export const SKIES: Record<Sky, { bg: string; sun: string; sunI: number; hemi: string; hemiI: number; spill: number; sheen: number }> = {
  day: { bg: '#100e0d', sun: '#ffdcae', sunI: 3.9, hemi: '#a9bdea', hemiI: 0.85, spill: 0.14, sheen: 0.32 },
  dusk: { bg: '#120b0f', sun: '#ff9a58', sunI: 2.3, hemi: '#b79fc9', hemiI: 0.55, spill: 0.3, sheen: 0.2 },
  night: { bg: '#05060b', sun: '#8fb0ff', sunI: 0.75, hemi: '#6f84c6', hemiI: 0.32, spill: 0.44, sheen: 0.08 }, // dark enough for torches to matter
};
/** Where the haze starts and ends unless a theme says otherwise: far out, only to lose the table's edge in the dark. */
export const HAZE = { near: 60, far: 170 };

export class Board {
  tool: Tool = 'move';
  /** A block or prop id, or 'erase', 'copy' (drag out an area) or 'paste' (stamp the copied slab). */
  brush = 'grass';
  slab: Slab | null = null;
  rot = 0;
  rulerMode: RulerMode = 'line';
  /** Fog tool: true paints fog, false reveals. */
  fogHide = true;
  selected: string | null = null;
  /** The pieces selected with the pick tool, by store key (a selected mini is `selected`, as in play). */
  picked: string[] = [];
  /** Pick from the scene: the next tap with a brush in hand takes what it lands on (`onSample`) instead of building. */
  sampling = false;
  onSample: (key: string) => void = () => {};
  /** Armed by the chrome's Move: the next touch on the table says where the selection goes. */
  placing = false;
  /** Armed by the chrome's Select area (`pickArea`): one finger drags a rectangle, and what stands in it is picked. */
  areaPick = false;
  /** Where a finger took hold of several picked pieces (a cell on their lowest level): they keep their place under it. */
  private grab: Vec | null = null;
  readonly dice: DiceView;
  readonly shots: ShotsView;
  /** Set while a shot is being aimed: the next tap in play names its target (a mini, or a spot in half cells) instead of selecting. */
  aimed: ((target: string | Vec) => void) | null = null;
  /** Dice picked up and waiting to be thrown: while set, a drag on the table throws them. */
  hand: Kind[] = [];
  /** How a piece's bar and marks follow from what it carries. A game system (src/system.ts) sets this; by default they are the piece's own. */
  face: (v: MiniVal) => Face = (v) => v;
  diceColor = '#ffffff';
  readonly boulder: BoulderView;
  /** The GM has a boulder ready: while set, a drag on the table lets it go (as with dice in hand). */
  boulderArmed = false;
  /** Cutaway: blocks, props and minis at this height or above are not drawn (Infinity = show all). */
  cut = Infinity;

  private me = '';
  private full = true;
  /** The powers this player really has, and whether they are set aside to see as players (`preview`): `full` is the one without the other. */
  private powers = true;
  private asPlayers = false;
  /** May this player change the scene? The GM may, and everyone where the table says so (`canBuild` in rules.ts). */
  private build = true;
  /** The same, before "see as players" sets it aside. */
  private builds = true;
  private turnId: string | null = null;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  private controls: OrbitControls;
  private look: Look | null = null;
  /** 0 the full look, 1 its light version, 2 plain. */
  private lookLevel = 2;
  private lamps: THREE.PointLight[] = [];
  private spill = 0.2;
  /** What the sky was last set to, so setting it again costs nothing. */
  private skySig = '';
  /** What a panel covers of the screen (see setInset). */
  private inset = { bottom: 0, right: 0 };
  /** How strongly fires, torches and crystals light the table: the GM's dial, 0 (out) to 2. */
  private glow = 1;
  private litAt = new THREE.Vector3(1e9, 0, 0);
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private ground: THREE.Mesh;
  private layers = new Map<string, Layer>();
  private layerFor!: (id: string) => Layer;
  private props = new Map<string, THREE.Group>();
  /** Thin walls on cell edges (see rules.ts): what stands on each, drawn as one swarm per shape. */
  private edges = new Map<string, string>();
  private edgeSwarms = new Map<string, Swarm>();
  private edgesDirty = false;
  /** Rooms dragged out with the room brush are half-timbered rather than stone. */
  roomTimber = false;
  /** With a block brush: repaint the surface of the ground instead of stacking another block on it. */
  surface = false;
  /** How far the land brushes reach around the cell touched, in cells (0 = just that cell). */
  reach = 0;
  private minis = new Map<string, Mini>();
  /** Small things lying where they fell (loose.ts), one swarm for each kind. */
  readonly loose: LooseView;
  private rulers = new Map<string, THREE.Group>();
  private fog: THREE.InstancedMesh | null = null;
  private fogDirty = false;
  private visDirty = false;
  private ray = new THREE.Raycaster();
  private ghost: THREE.Mesh;
  private ring: THREE.Mesh;
  private turnRing: THREE.Mesh;
  private pings: { mesh: THREE.Mesh; t: number }[] = [];
  private anims: { id: string; kind: string; t: number; bubble: THREE.Sprite }[] = [];
  /** Pieces rocking after a knock, by mini id or prop cell. Not shared: every device works them out alike. */
  private wobbles = new Map<string, Wobble>();
  private marquee: THREE.Mesh;
  /** The outline around the picked pieces: one box, whatever is in it. */
  private pickBox: THREE.LineSegments;
  private lastDrag = '';
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private twist = 0;
  /** A pinch always wobbles a little: only start turning once the fingers have clearly twisted. */
  private twistSlack = 0;
  private zoomGoal: number | null = null;
  private shadowDirty = true;
  /** Ground cover (tufts, flowers, pebbles): not stored anywhere, grown from the lie of the land. */
  private cover: { tuft: Swarm[]; flower: Swarm[]; pebble: Swarm[]; sward: Swarm[] } | null = null;
  private coverDirty = true;
  private season: Season = 'summer';
  /** Natural ground, drawn as one smooth surface instead of cubes (see terrain.ts). */
  private columns = new Map<string, Column>();
  private terrain: (Terrain & { mesh: THREE.Mesh }) | null = null;
  private terrainMat = withDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), true);
  private terrainDirty = true;
  private sunAt = new THREE.Vector3(1e9, 0, 0);
  /** Rendering resolution steps down if this device cannot keep up (see `adapt`). */
  private quality = 0;
  private slow = 0;
  private dragPos: Vec | null = null;
  /** The mini this player has just let go of: its landing is felt as well as heard. */
  private landing: string | null = null;
  private lastLive = 0;
  private lastRuler = 0;
  private undoStack: Undo[][] = [];
  private redoStack: Undo[][] = [];
  private batch: Undo[] | null = null;
  /** Goes up with every undoable edit made here: how the chrome knows there is something new to take back. */
  stamp = 0;
  private dirty = true;
  /** Frames drawn so far (for the checks: an idle table must not add to it). */
  frames = 0;
  /** Leaves sway and fires flicker, a few frames a second, while nothing else is going on. Local, not shared. */
  ambient = false;
  /** Glide to the mini whose turn it has become, if it is out of view. Local, not shared. */
  followTurns = true;
  private glide: Glide | null = null;
  /** With a glide under way: what the camera moves besides (a new angle or distance, see `flyTo`). */
  private swing: Glide | null = null;
  /** The camera moved (by hand or by itself). Never called while the view is still. */
  onCamera: () => void = () => {};
  /** Is there anything on the table that sways or flickers? Looked up again only once the table is at rest. */
  private alive = false;
  private lifeDirty = true;
  /** adapt() has had to give up quality: this device has nothing to spare for ambience. */
  private slowed = false;
  /** Was the last frame an ambient one, and how many of those have run long (see frame). */
  private stirred = false;
  private stirSlow = 0;
  private drawn = 0;
  private calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private coarse = matchMedia('(pointer: coarse)').matches;
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement, private store: Store, private hooks: BoardHooks) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const lowEnd = this.coarse && ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 3;
    // Keep painted colours rich in bright light instead of washing out to white.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = !lowEnd;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Shadows only change when the table does, not when the camera moves: redraw them on demand.
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.background = new THREE.Color();
    this.scene.fog = new THREE.Fog('#000', HAZE.near, HAZE.far);
    // The finished look costs a few screenfuls of work a frame: phones start on the light
    // version, the weakest draw plain, and adapt() steps down if frames run long.
    this.lookLevel = lowEnd ? 2 : this.coarse ? 1 : 0;
    if (this.lookLevel < 2) {
      this.look = new Look(this.renderer, this.scene, this.camera);
      this.look.setLevel(this.lookLevel);
    }
    // A plain lit room for polished things to reflect: water, metal and glaze stop looking like
    // matt plastic. It is baked once into a small map, so it costs nothing per frame.
    if (!lowEnd) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    // Fire and magic light what stands near them. A fixed handful of lamps is handed to
    // whichever sources are nearest the middle of the view (see relight).
    for (let i = 0; i < (this.coarse ? 2 : 4); i++) {
      const lamp = new THREE.PointLight('#ffb46b', 0, 7.5, 2);
      // On a desktop the lamps throw shadows too, so firelight stops at a wall instead of
      // shining through it. Like the sun's, they are only redrawn when the table changes.
      if (!this.coarse) {
        lamp.castShadow = true;
        lamp.shadow.mapSize.setScalar(512);
        lamp.shadow.camera.near = 0.08;
        lamp.shadow.camera.far = 8;
        lamp.shadow.bias = -0.006;
        lamp.shadow.normalBias = 0.03;
        lamp.shadow.radius = 2;
      }
      this.lamps.push(lamp);
      this.scene.add(lamp);
    }

    this.hemi = new THREE.HemisphereLight('#fff', '#6b5a4c', 1); // warm light bounced up off the table
    this.sun = new THREE.DirectionalLight('#fff', 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(this.coarse ? 1024 : 4096);
    this.sun.shadow.radius = 3; // soft-edged, like a lamp over a table
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -36;
    sc.right = sc.top = 36;
    sc.far = 140;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.setSky('day');

    // The grid is painted into the ground texture (not hairline GL lines), so
    // its thickness scales with the cells and stays visible on high-DPI phones.
    // A wooden table top, at a size a phone can hold.
    const tex = tableTexture(this.coarse ? 512 : 1024);
    tex.repeat.setScalar((LIMIT * 2) / TABLE_SPAN);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(LIMIT * 2, LIMIT * 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62 }), // oiled wood: a soft sheen from the room
    );
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ghost.visible = false;
    const torus = (r: number, color: string) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 32).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color }));
      m.position.y = 0.06;
      return m;
    };
    this.ring = torus(0.46, '#ffe066');
    this.turnRing = torus(0.56, '#58d68d');
    this.marquee = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5),
      new THREE.MeshBasicMaterial({ color: '#58d6e8', transparent: true, opacity: 0.28, depthWrite: false }),
    );
    this.marquee.visible = false;
    this.ghost.layers.set(OVERLAY);
    this.marquee.layers.set(OVERLAY);
    this.pickBox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5)),
      new THREE.LineBasicMaterial({ color: '#ffe066', depthTest: false, transparent: true }),
    );
    this.pickBox.visible = false;
    this.pickBox.renderOrder = 14;
    this.pickBox.layers.set(OVERLAY);
    this.scene.add(this.ghost, this.marquee, this.pickBox);

    this.camera.position.set(7, 9, 11);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 90;
    this.controls.target.set(0, 0, 0);
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.addEventListener('change', () => this.onCamera());

    const hidden = (x: number, y: number, z: number) => this.cellHidden(x, y, z);
    // Ground under the smooth surface is not drawn as cubes as well.
    const buried = (x: number, y: number, z: number) => {
      const top = this.columns.get(`${x},${z}`);
      return this.cellHidden(x, y, z) || (!!top && !!GROUND[top.id] && y <= top.y);
    };
    for (const id of Object.keys(BLOCKS)) this.layers.set(id, new Layer(id, this.scene, GROUND[id] ? buried : hidden));
    this.layerFor = (id) => { // a block that registered after the table was laid
      let l = this.layers.get(id);
      if (!l) this.layers.set(id, (l = new Layer(id, this.scene, hidden)));
      return l;
    };
    this.dice = new DiceView(this.scene);
    this.loose = new LooseView((geo, mat) => new Swarm(geo, mat, this.scene, true), hidden);
    this.dice.onBump = (at, dv) => this.bump(at, dv);
    this.debris = new Debris(this.scene);
    this.shots = new ShotsView(this.scene);
    this.boulder = new BoulderView(this.scene, (x, z) => !this.full && fogged(this.store, x, z));
    this.boulder.onPass = (at, dir) => this.shake(at, dir);
    // A pack of models has arrived: stand up the pieces that were waiting for it.
    onKitPack(() => {
      for (const [key, g] of this.props) {
        const v = this.store.get<CellVal>(key);
        if (v && g.userData.pending) this.placeProp(key, v);
      }
      for (const [id, m] of this.minis) { // and any figures: rebuild them from what the kit now holds
        m.sig = '';
        this.applyMini(id, m.val);
      }
      this.coverDirty = this.edgesDirty = true;
      this.loose.kitChanged();
      this.touched();
    });
    // A pack of pieces has registered, changed or left: draw what this board has of it afresh,
    // as the real thing or as stand-ins.
    onRegistry((ns) => {
      const mine = (id: unknown) => typeof id === 'string' && id.startsWith(`${ns}:`);
      for (const [id, l] of this.layers) {
        if (mine(id)) { l.dispose(this.scene); this.layers.delete(id); }
      }
      for (const key of [...this.store.keys('b:')]) {
        const v = this.store.get<CellVal>(key);
        if (v && mine(v.i)) this.applyCell(key, v, null);
      }
      for (const [id, m] of this.minis) {
        if (mine(m.val.k)) { m.sig = ''; this.applyMini(id, m.val); }
      }
      this.visDirty = true;
      this.touched();
    });

    // Capture phase so we can claim a drag before OrbitControls sees it.
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), true);
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.abortGesture(); });
    // The app went to the background mid-touch: those fingers never come up for us.
    addEventListener('blur', () => { if (this.pointers.size) { this.pointers.clear(); this.abortGesture(); } });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.hideGhost(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Wheel and trackpad zoom glide to their target instead of jumping a step per notch.
    // (Caught on the way down from the document, so the camera controls never see the raw wheel.)
    document.addEventListener('wheel', (e) => {
      if (e.target !== canvas) return;
      e.preventDefault();
      e.stopPropagation();
      const px = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      this.glide = null;
      const from = this.zoomGoal ?? this.camera.position.distanceTo(this.controls.target);
      this.zoomGoal = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, from * Math.exp(px * (e.ctrlKey ? 0.012 : 0.0016))));
    }, { capture: true, passive: false });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- what this player gets to see ------------------------------------------

  /** Who is looking: their player id, and whether they have GM powers (always true in free play). */
  setRole(me: string, full: boolean, build = full): void {
    this.me = me;
    this.powers = full;
    this.asPlayers &&= full;
    this.full = full && !this.asPlayers;
    this.builds = build;
    this.build = build && !this.asPlayers; // looking as the players do, nothing is built either
    if (!this.full) this.offer(null);
    this.refresh();
  }

  /**
   * See as players: draw the table as someone without the GM's powers would see it (fog solid,
   * hidden minis gone, line of sight if it is on). Only a view: nothing shared changes, and
   * while it is on no brush of this device edits anything. It belongs to the fog tool and
   * goes when the tool does.
   */
  preview(on: boolean): void {
    on &&= this.powers;
    if (on === this.asPlayers) return;
    this.asPlayers = on;
    this.setRole(this.me, this.powers, this.builds);
  }
  get previewing(): boolean { return this.asPlayers; }

  /** Re-evaluate everything that depends on role, fog, cutaway or line-of-sight settings. */
  refresh(): void {
    for (const l of this.layers.values()) l.dirty = true;
    this.coverDirty = this.terrainDirty = this.edgesDirty = true;
    for (const [key, g] of this.props) g.visible = !this.cellHidden(...parse(key));
    for (const [id, m] of this.minis) this.applyMini(id, m.val); // ghosting depends on the role
    this.fogDirty = this.visDirty = true;
    this.loose.refresh();
    this.touched();
  }

  setCut(level: number): void {
    this.cut = level;
    this.refresh();
  }

  /** One above the highest block on the table: the first cutaway level that hides nothing. */
  maxHeight(): number {
    let top = 0;
    for (const l of this.layers.values()) for (const k of l.cells) top = Math.max(top, parse(k)[1] + 1);
    return top;
  }

  private cellHidden(x: number, y: number, z: number): boolean {
    return y >= this.cut || (!this.full && fogged(this.store, x, z));
  }

  /** The time of year: leaves turn, blossom or fall, and snow settles on the evergreens. */
  setSeason(name: Season): void {
    if (name === this.season) return;
    this.season = name;
    setSeason(name);
    // Trees that drop their leaves change shape in and out of winter: stand them all again.
    for (const [key, g] of this.props) {
      const v = this.store.get<CellVal>(key);
      if (v && WILD[v.i]?.bare) { delete g.userData.seat; this.placeProp(key, v); }
    }
    this.coverDirty = true;
    this.touched();
  }

  /** The sky, and with it the light: a named one, with whatever the board's theme changes about it (and its haze). */
  setSky(name: Sky, light?: Light, haze?: Fog): void {
    const sig = JSON.stringify([name, light, haze]);
    if (sig === this.skySig) return;
    this.skySig = sig;
    const s = { ...(SKIES[name] ?? SKIES.day), ...light }, fog = this.scene.fog as THREE.Fog;
    (this.scene.background as THREE.Color).set(s.bg);
    fog.color.set(haze?.color ?? s.bg);
    fog.near = haze?.near ?? HAZE.near;
    fog.far = haze?.far ?? HAZE.far;
    this.sun.color.set(s.sun);
    this.sun.intensity = s.sunI;
    this.hemi.color.set(s.hemi);
    this.hemi.intensity = s.hemiI;
    this.spill = s.spill;
    this.scene.environmentIntensity = s.sheen;
    this.look?.setGlow(this.spill * (0.5 + 0.5 * Math.min(this.glow, 2)));
    this.invalidate();
  }

  /** The finished picture's grade, where a theme has one of its own (nothing to do on a device that draws plain). */
  setGrade(grade?: Grade): void {
    if (this.look?.setGrade(grade)) this.invalidate();
  }
  /** The table's dice (see theme.ts): the next ones picked up or thrown wear it. */
  setDice(look?: DiceLook): void { this.dice.setLook(look); }
  /**
   * Leave part of the screen to a panel (CSS pixels it covers at the bottom and on the right; less
   * than nothing leans the other way): the picture, and where dice land, centre on what is left.
   */
  setInset(bottom = 0, right = 0): void {
    if (bottom === this.inset.bottom && right === this.inset.right) return;
    this.inset = { bottom, right };
    this.resize();
  }

  setTurn(id: string | null): void {
    if (this.turnId) this.minis.get(this.turnId)?.group.remove(this.turnRing);
    if (id && id !== this.turnId) this.follow(id);
    this.turnId = id;
    const m = id ? this.minis.get(id) : null;
    if (m) {
      this.turnRing.scale.setScalar(m.val.s || 1);
      m.group.add(this.turnRing);
    }
    this.invalidate();
  }

  /** Fog tiles: an opaque "unexplored" floor for players, a see-through tint on top of everything for the GM. */
  private rebuildFog(): void {
    this.fogDirty = false;
    const cols = [...this.store.keys('f:')];
    if (this.fog) {
      this.scene.remove(this.fog);
      this.fog.dispose();
      (this.fog.material as THREE.Material).dispose();
      this.fog = null;
    }
    if (!cols.length) return;
    const mat = this.full
      ? new THREE.MeshBasicMaterial({ color: '#8e4ec6', transparent: true, opacity: 0.38, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: '#0c0f17', roughness: 1 });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.1, 1).translate(0, 0.05, 0), mat, cols.length);
    const m = new THREE.Matrix4();
    cols.forEach((k, i) => {
      const [x, z] = k.slice(2).split(',').map(Number);
      let top = 0;
      if (this.full) for (let y = Math.min(MAX_Y, this.cut) - 1; y >= 0; y--) if (this.isBlock(x, y, z)) { top = y + 1; break; }
      mesh.setMatrixAt(i, m.makeTranslation(x + 0.5, top + 0.02, z + 0.5));
    });
    mesh.frustumCulled = false;
    mesh.receiveShadow = !this.full;
    this.fog = mesh;
    this.scene.add(mesh);
  }

  /** Decide which minis this player sees (hidden, fogged, out of sight, above the cutaway). */
  private refreshMinis(): void {
    this.visDirty = false;
    const eyes = this.asPlayers ? playerEyes(this.store) : this.full ? null : eyesOf(this.store, this.me);
    for (const [id, m] of this.minis) {
      const show = m.val.y < this.cut && (this.asPlayers ? shownToPlayers(this.store, m.val, eyes) : miniShown(this.store, this.me, m.val, eyes)) !== 'no';
      m.group.visible = show;
      if (!show && this.selected === id) this.select(null);
    }
  }

  /** Empty the table view (before showing a different board). The store is not touched. */
  clear(): void {
    this.select(null);
    this.setTurn(null);
    for (const l of this.layers.values()) { l.cells.clear(); l.dirty = true; }
    this.coverDirty = this.terrainDirty = true;
    for (const g of this.props.values()) this.scene.remove(g);
    for (const m of this.minis.values()) this.scene.remove(m.group);
    for (const g of this.rulers.values()) this.scene.remove(g);
    for (const p of this.pings) this.scene.remove(p.mesh);
    for (const a of this.anims) a.bubble.removeFromParent();
    this.props.clear();
    this.edges.clear();
    this.edgesDirty = true;
    this.minis.clear();
    this.loose.clear();
    this.rulers.clear();
    this.pings.length = this.anims.length = 0;
    this.wobbles.clear();
    this.debris.clear();
    this.breaking.clear();
    this.offer(null);
    this.shots.clear();
    this.boulder.clear();
    this.undoStack.length = this.redoStack.length = 0;
    this.picked = [];
    this.placing = false;
    this.pickBox.visible = false;
    this.fogDirty = this.visDirty = true;
    this.touched();
  }

  // ---- store → scene -------------------------------------------------------

  /** Turn the table's firelight up or down (1 is as modelled). */
  setGlow(strength: number): void {
    const k = Math.max(0, Math.min(2, Number.isFinite(strength) ? strength : 1));
    if (k === this.glow) return;
    this.glow = k;
    this.look?.setGlow(this.spill * (0.5 + 0.5 * k));
    this.relight();
    this.invalidate();
  }

  /** Hand the lamps to the fires, torches and crystals nearest the middle of the view. */
  private relight(): boolean {
    const at = this.litAt.copy(this.controls.target), near: { d: number; p: THREE.Vector3; glow: (typeof GLOWS)[string] }[] = [];
    for (const [key, g] of this.props) {
      const v = this.store.get<CellVal>(key), kind = GLOWS[v?.i ?? ''];
      if (!kind || !g.visible || v!.l === 0) continue; // not a light, out of sight, or put out
      const glow: (typeof GLOWS)[string] = [kind[0], kind[1] * (v!.l ?? 1), kind[2]];
      near.push({ d: g.position.distanceToSquared(at), p: g.position, glow });
    }
    near.sort((a, b) => a.d - b.d);
    let moved = false;
    this.lamps.forEach((lamp, i) => {
      const n = near[i];
      lamp.intensity = lamp.userData.base = n ? n.glow[1] * this.glow : 0; // (breathe() flickers around the base)
      lamp.visible = !!n && this.glow > 0; // a lamp with nothing to light costs nothing
      if (!n) return;
      const y = n.p.y + n.glow[2];
      if (lamp.position.x !== n.p.x || lamp.position.y !== y || lamp.position.z !== n.p.z) moved = true;
      lamp.distance = 7.5 * Math.sqrt(Math.max(0.5, n.glow[1] / GLOWS.torch[1])); // a brighter light reaches further
      lamp.color.set(n.glow[0]);
      lamp.position.set(n.p.x, y, n.p.z);
    });
    return moved; // their shadows need drawing again
  }

  /** Ask for a redraw. The board only renders when something changed. */
  invalidate(): void { this.dirty = true; }
  /** The table itself changed (not just the camera): shadows need redrawing too. */
  private touched(): void { this.dirty = this.shadowDirty = this.lifeDirty = true; }
  private hideGhost(): void {
    if (this.ghost.visible) this.invalidate();
    this.ghost.visible = false;
  }

  apply(key: string, value: unknown, prev: unknown): void {
    this.touched();
    if (this.breaking.size || this.offered) this.applyBreak(key, value, prev);
    if (key.startsWith('b:')) {
      this.applyCell(key, value as CellVal | null, prev as CellVal | null);
      this.visDirty = this.fogDirty = true; // walls change sight lines and fog heights
    } else if (key.startsWith('m:')) {
      this.applyMini(key.slice(2), value as MiniVal | null);
      this.visDirty = true;
    } else if (key.startsWith('w:')) {
      const v = value as EdgeVal | null;
      if (v && EDGES[v.i]) this.edges.set(key, v.i);
      else this.edges.delete(key);
      this.edgesDirty = this.visDirty = this.terrainDirty = this.coverDirty = true;
    } else if (key.startsWith('l:')) {
      this.loose.set(key.slice(2), value);
    } else if (key.startsWith('f:')) {
      this.fogDirty = this.visDirty = true;
      if (!this.full) this.refresh();
    }
  }

  /**
   * Stand the edge walls up. Which member of its family each stretch is, which face it shows
   * and its tint follow from where it stands; corner posts are not stored at all, they grow
   * wherever stone walls meet at an angle or come to an end.
   */
  private rebuildEdges(): void {
    this.edgesDirty = false;
    const lots = new Map<string, { geo: THREE.BufferGeometry; at: [THREE.Matrix4, THREE.Color, string][] }>();
    const add = (family: string, x: number, y: number, z: number, turn: number, cx: number, cz: number, key: string) => {
      const shapes = kit.get(`p_${family}`) ?? (kitPending(`p_${family}`) ? null : [family === 'post' ? PLAIN_POST : PLAIN_WALL]);
      if (!shapes) return; // its pack is on the way: the arrival rebuilds this
      const i = Math.floor(rand(x, y, z, 31 + turn) * shapes.length), id = `${family}#${i}`;
      let lot = lots.get(id);
      if (!lot) lots.set(id, (lot = { geo: shapes[i], at: [] }));
      lot.at.push([new THREE.Matrix4().makeRotationY((turn * Math.PI) / 2).setPosition(cx, y, cz), TINT_COLORS[Math.floor(rand(x, y, z, 41 + turn) * TINT_COLORS.length)], key]);
    };
    // Per grid corner: how many walls run into it along x and along z, and whether any is stone.
    const corners = new Map<string, [nx: number, nz: number, stone: boolean]>();
    const meet = (x: number, y: number, z: number, along: 0 | 1, stone: boolean) => {
      const k = `${x},${y},${z}`, c = corners.get(k) ?? [0, 0, false];
      c[along]++;
      c[2] ||= stone;
      corners.set(k, c);
    };
    for (const [key, piece] of this.edges) {
      const [x, y, z, s] = parseEdge(key);
      if (![x, y, z].every(Number.isInteger) || this.cellHidden(x, y, z)) continue;
      const def = EDGES[piece], flip = !def.see && rand(x, y, z, s === 'n' ? 21 : 22) < 0.5;
      if (s === 'n') {
        add(piece, x, y, z, flip ? 2 : 0, x + 0.5, flip ? z - 0.5 : z + 0.5, key);
        meet(x, y, z, 0, !def.timber); meet(x + 1, y, z, 0, !def.timber);
      } else {
        add(piece, x, y, z, flip ? 3 : 1, flip ? x - 0.5 : x + 0.5, z + 0.5, key);
        meet(x, y, z, 1, !def.timber); meet(x, y, z + 1, 1, !def.timber);
      }
    }
    for (const [k, [nx, nz, stone]] of corners) {
      if (!stone || !((nx && nz) || nx + nz === 1)) continue;
      const [x, y, z] = k.split(',').map(Number);
      add('post', x, y, z, 0, x + 0.5, z + 0.5, '');
    }
    for (const [id, swarm] of this.edgeSwarms) if (!lots.has(id)) { swarm.begin(0); swarm.end(); }
    for (const [id, lot] of lots) {
      let swarm = this.edgeSwarms.get(id);
      if (!swarm) this.edgeSwarms.set(id, (swarm = new Swarm(lot.geo, KIT, this.scene, true)));
      swarm.begin(lot.at.length);
      for (const [m, c, key] of lot.at) swarm.add(m, c, key);
      swarm.end();
    }
  }

  /** What stands in a cell, if anything. */
  private what(x: number, y: number, z: number): string | undefined {
    return this.store.get<CellVal>(ck(x, y, z))?.i;
  }

  /**
   * Rebuild the smooth ground from the blocks. Also works out how trodden each ground
   * cell is, so the surface can wear to bare earth along walls, floors and under trees.
   */
  private rebuildTerrain(): void {
    this.terrainDirty = false;
    this.columns.clear();
    for (const [id, l] of this.layers) {
      for (const key of l.cells) {
        const [x, y, z] = parse(key);
        if (this.cellHidden(x, y, z)) continue; // above the cutaway, or under fog
        const k = `${x},${z}`, top = this.columns.get(k);
        if (!top || y > top.y) this.columns.set(k, { y, id });
      }
      if (GROUND[id]) l.dirty = true; // which of its cubes are buried may have changed
    }
    const worn = (x: number, z: number): number => {
      const top = this.columns.get(`${x},${z}`)!;
      const on = this.what(x, top.y + 1, z);
      let w = on && (WILD[on] || /^(wall|wood|post|door|gate|fence)/.test(on)) ? (WILD[on] ? 0.55 : 1) : 0;
      const lv = top.y + 1; // a wall along any side of the cell: bare earth at its foot
      if (this.edges.has(ek(x, lv, z, 'n')) || this.edges.has(ek(x, lv, z, 'w')) || this.edges.has(ek(x, lv, z + 1, 'n')) || this.edges.has(ek(x + 1, lv, z, 'w'))) w = Math.max(w, 0.8);
      for (let dx = -1; dx <= 1 && w < 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const beside = this.columns.get(`${x + dx},${z + dz}`);
        // Paving and floors at about this level: feet have been here.
        if (beside && !GROUND[beside.id] && Math.abs(beside.y - top.y) <= 1) w = Math.max(w, dx && dz ? 0.4 : 0.9);
      }
      return w;
    };
    const built = buildTerrain(this.columns, worn);
    if (this.terrain) {
      this.scene.remove(this.terrain.mesh);
      this.terrain.geometry.dispose();
    }
    const mesh = new THREE.Mesh(built.geometry, this.terrainMat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.visible = built.cells.length > 0;
    this.scene.add(mesh);
    this.terrain = { ...built, mesh };
  }

  /**
   * Scatter small growth over open ground, and settle the things that stand on it.
   * It is environment-aware rather than random: thick in some patches and bare in
   * others, pebbly along paths and floors, flowers gathered in drifts of one colour
   * out in the open, and a fringe of grass around every trunk, boulder and wall foot
   * so that nothing looks stuck into the ground.
   */
  private rebuildCover(): void {
    this.coverDirty = false;
    this.seatProps();
    if (!this.cover) {
      if (!kit.get('g_tuft')) return;
      const mat = withDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
      const swarms = (id: string) => (kit.get(id) ?? []).map((g) => new Swarm(g, mat, this.scene, false));
      this.cover = { tuft: swarms('g_tuft'), flower: swarms('g_flower'), pebble: swarms('g_pebble'), sward: swarms('g_sward') };
    }
    const cover = this.cover;
    const lots = new Map<Swarm, [THREE.Matrix4, THREE.Color][]>();
    const plain = new THREE.Color('#ffffff');
    let shade = plain; // grass takes on the colour of the ground it grows from
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let salt = 0;
    const grow = (kind: 'tuft' | 'flower' | 'pebble' | 'sward', x: number, y: number, z: number, px: number, pz: number, pick?: number, scale = 1) => {
      if (!cover[kind].length) return; // an older kit without this kind of growth
      const family = cover[kind], i = salt++;
      const swarm = family[pick ?? Math.floor(rand(x, y, z, 40 + i) * family.length)];
      const size = (0.8 + rand(x, y, z, 50 + i) * 0.7) * scale;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(px, y + 1, pz), q.setFromAxisAngle(up, rand(x, y, z, 80 + i) * Math.PI * 2), new THREE.Vector3(size, size, size));
      if (!lots.has(swarm)) lots.set(swarm, []);
      const grass = kind === 'tuft' || kind === 'sward';
      lots.get(swarm)!.push([m, grass ? shade.clone().multiplyScalar(0.84 + rand(x, y, z, 90 + i) * 0.26) : plain]);
    };
    for (const [key, top] of this.columns) {
      if (GROUND[top.id]?.kind !== 3) continue; // only growing ground
      const [x, z] = key.split(',').map(Number), y = top.y;
      // On a bank only the level pad in the middle of the cell is at the cell's own height.
      const reach = this.terrain?.sloped.has(key) ? 0.5 : 0.84;
      const on = this.what(x, y + 1, z);
      salt = 0;
      shade = new THREE.Color(GROUND[top.id].color).multiplyScalar(1.5).lerp(plain, 0.45);
      if (on) {
        if (WILD[on]) { // a fringe around the foot of a trunk or boulder
          const n = 3 + Math.floor(rand(x, y, z, 21) * 4), r0 = on === 'rock' ? 0.36 : 0.2;
          for (let i = 0; i < n; i++) {
            const a = (i + rand(x, y, z, 22 + i)) * Math.PI * 2 / n, r = Math.min(reach / 2, r0 + rand(x, y, z, 26 + i) * 0.1);
            grow('tuft', x, y, z, x + 0.5 + Math.cos(a) * r, z + 0.5 + Math.sin(a) * r, undefined, 0.9);
          }
        } else if (/^(wall|woodwin)/.test(on) && reach > 0.6) { // grass growing up against the foot of a wall
          const turn = (this.store.get<CellVal>(ck(x, y + 1, z))?.r ?? 0) * Math.PI / 2;
          for (let i = 0, n = 1 + Math.floor(rand(x, y, z, 21) * 3); i < n; i++) {
            const along = (rand(x, y, z, 22 + i) - 0.5) * 0.9, off = -0.36 + rand(x, y, z, 26 + i) * 0.1;
            // The wall stands along the far (-z) edge of the cell before it is turned.
            grow(rand(x, y, z, 28 + i) < 0.25 ? 'pebble' : 'tuft', x, y, z, x + 0.5 + along * Math.cos(turn) + off * Math.sin(turn), z + 0.5 - along * Math.sin(turn) + off * Math.cos(turn));
          }
        }
        continue;
      }
      let paved = false, crowded = false;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const beside = this.columns.get(`${x + dx},${z + dz}`);
        if (!(dx && dz) && beside && !GROUND[beside.id] && Math.abs(beside.y - y) <= 1) paved = true;
        if (this.what(x + dx, y + 1, z + dz)) crowded = true;
      }
      const thick = field(x, z, 5, 1), drift = field(x, z, 7, 2);
      // The lawn itself: patches of short grass, thinner where feet have worn it and on phones.
      if (!paved) {
        const swards = Math.round((this.coarse ? 1.4 : 4.4) * (0.35 + thick) * (crowded ? 0.7 : 1));
        for (let i = 0; i < swards; i++) grow('sward', x, y, z, x + 0.5 + (rand(x, y, z, 110 + i) - 0.5) * reach, z + 0.5 + (rand(x, y, z, 120 + i) - 0.5) * reach, undefined, 1.1);
      }
      const n = Math.floor(rand(x, y, z, 20) * (paved ? 2.4 : 1.4 + thick * 6.5));
      for (let i = 0; i < n; i++) {
        const r = rand(x, y, z, 30 + i);
        const kind = paved ? (r < 0.6 ? 'pebble' : 'tuft') : !crowded && drift > 0.62 && r < 0.5 ? 'flower' : r > 0.93 ? 'pebble' : 'tuft';
        // Flowers of a drift share a colour; everything else is drawn from its whole family.
        grow(kind, x, y, z, x + 0.5 + (rand(x, y, z, 60 + i) - 0.5) * reach, z + 0.5 + (rand(x, y, z, 70 + i) - 0.5) * reach,
          kind === 'flower' ? Math.floor(field(x, z, 11, 3) * cover.flower.length * 0.999) : undefined);
      }
    }
    for (const swarm of Object.values(cover).flat()) {
      const list = lots.get(swarm) ?? [];
      swarm.begin(list.length);
      for (const [m, c] of list) swarm.add(m, c);
      swarm.end();
    }
  }

  /**
   * Trees and boulders make room for what is next to them: hemmed in by a wall, a
   * building or another trunk, they grow smaller and lean away instead of poking through it.
   */
  private seatProps(): void {
    for (const [key, g] of this.props) {
      const v = this.store.get<CellVal>(key);
      if (!v || !WILD[v.i]) continue;
      const [x, y, z] = parse(key);
      let cx = 0, cz = 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = this.what(x + dx, y, z + dz);
        if (n && !GROUND[n]) { cx -= dx; cz -= dz; }
      }
      // In a hollow the banks would swallow the trunk: stand it up on the fill instead.
      const lift = Math.min(0.9, (this.terrain?.hollow.get(`${x},${z}`) ?? 0) * 0.7);
      const seat = `${cx},${cz},${lift.toFixed(2)}`;
      if ((g.userData.seat ?? '0,0,0.00') === seat) continue;
      if (g.userData.pending) continue; // its model is still on the way
      const fresh = this.placeProp(key, v, [cx, cz]);
      if (fresh.children[0]) fresh.children[0].position.y += lift;
      fresh.userData.seat = seat;
    }
  }

  private placeProp(key: string, v: CellVal, crowd?: [number, number]): THREE.Group {
    const old = this.props.get(key);
    if (old) this.scene.remove(old);
    const [x, y, z] = parse(key);
    const g = makeProp(v.i, [x, y, z], crowd);
    g.position.set(x + 0.5, y, z + 0.5);
    g.rotation.y = WILD[v.i] ? 0 : ((v.r ?? 0) * Math.PI) / 2; // wild things already face any which way
    g.userData.cell = key;
    g.visible = !this.cellHidden(x, y, z);
    this.scene.add(g);
    this.props.set(key, g);
    return g;
  }

  private applyCell(key: string, v: CellVal | null, prev: CellVal | null): void {
    this.coverDirty = this.terrainDirty = true; // whatever changed, the ground and growth around it may want to change too
    const was = prev && typeof prev.i === 'string' ? this.layers.get(prev.i) : undefined;
    if (was) {
      was.cells.delete(key);
      was.dirty = true;
    }
    const old = this.props.get(key);
    if (old) {
      this.scene.remove(old);
      this.props.delete(key);
    }
    if (!v || typeof v.i !== 'string') return;
    const [x, y, z] = parse(key);
    if (![x, y, z].every(Number.isInteger)) return;
    if (Object.hasOwn(BLOCKS, v.i)) {
      const l = this.layerFor(v.i);
      l.cells.add(key);
      l.dirty = true;
    } else {
      this.placeProp(key, v); // a prop, or the stand-in for a piece this device does not have (yet)
    }
  }

  private applyMini(id: string, v: MiniVal | null): void {
    let m = this.minis.get(id);
    if (!v || typeof v.k !== 'string') {
      if (m) {
        this.scene.remove(m.group);
        this.minis.delete(id);
        if (this.selected === id) this.select(null);
      }
      return;
    }
    const was = m?.val ?? v; // before a rebuild forgets it
    const ghost = this.full && !!v.h;
    const fly = Math.max(0, Math.min(12, v.e || 0));
    const face = this.face(v);
    const sig = [v.k, v.c, v.n, v.s, face.hp, face.mhp, face.marks, fly, ghost, !!v.d].join('|');
    const pos = new THREE.Vector3(v.x + 0.5, v.y, v.z + 0.5);
    if (!m || m.sig !== sig) {
      const group = new THREE.Group();
      // A kind this device does not have (yet) stands as a plain marker until its pack registers.
      const def = Object.hasOwn(MINIS, v.k) ? MINIS[v.k] : { height: STANDIN_HEIGHT }, s = v.s || 1;
      const base = new THREE.Mesh(BASE, baseMaterial(v.c));
      base.position.y = 0.04;
      base.castShadow = base.receiveShadow = true;
      // Generous invisible hit area: minis are small targets for a fingertip.
      const hit = new THREE.Mesh(HIT, UNSEEN);
      hit.scale.y = def.height + 0.15;
      const body = new THREE.Group();
      body.add(base, hit, ...makeMini(v.k));
      body.scale.setScalar(s);
      body.position.y = fly;
      const label = plate(v, face);
      label.position.y = fly + def.height * s + 0.5;
      group.add(body, label);
      if (fly) { // a stalk down to the spot it hovers over
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, fly, 6), new THREE.MeshBasicMaterial({ color: v.c, transparent: true, opacity: 0.7 }));
        stalk.position.y = fly / 2;
        const foot = new THREE.Mesh(new THREE.CircleGeometry(0.3 * s, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: v.c, transparent: true, opacity: 0.45 }));
        foot.position.y = 0.03;
        group.add(stalk, foot);
      }
      if (ghost) { // the GM sees hidden minis as see-through
        body.traverse((o) => {
          const mesh = o as THREE.Mesh, mat = mesh.material as THREE.Material | undefined;
          if (!mat?.visible) return;
          mesh.material = mat.clone(); // materials are shared between minis: fade a copy
          Object.assign(mesh.material, { transparent: true, opacity: 0.38, depthWrite: false });
          mesh.castShadow = false;
        });
      }
      group.userData.mini = id;
      group.position.copy(m ? m.group.position : pos);
      group.visible = m ? m.group.visible : false; // decided by refreshMinis before the next frame
      if (m) this.scene.remove(m.group);
      m = { group, target: pos, val: v, sig, fall: m?.fall, squash: m?.squash, hop: m?.hop, vel: m?.vel }; // a rebuilt figure carries on with what it was doing
      this.minis.set(id, m);
      this.scene.add(group);
      if (this.selected === id) this.attachRing(m);
      if (this.turnId === id) this.setTurn(id);
      this.visDirty = true;
    }
    m.val = v;
    if (!!was.d !== !!v.d) m.fall = { t: 0, up: !v.d }; // knocked down, or helped up
    if (this.gesture?.mini !== id) {
      m.target.copy(pos);
      if (was.x !== v.x || was.y !== v.y || was.z !== v.z) this.hop(m, v.x - was.x, v.z - was.z);
    }
    this.pose(m);
  }

  /** A mini's resting pose: facing, flying height, and lying down when knocked out. */
  private pose(m: Mini): void {
    const body = m.group.children[0], v = m.val;
    body.rotation.set(v.d ? -Math.PI / 2 : 0, ((v.r || 0) * Math.PI) / 4, 0, 'YXZ');
    body.position.set(0, Math.max(0, Math.min(12, v.e || 0)) + (v.d ? 0.22 * (v.s || 1) : 0), 0);
    this.posture(m);
  }

  /** Play a short emote on a mini: a little movement and an emoji popping up over its head. */
  emote(id: string, kind: string): void {
    const m = this.minis.get(id);
    if (!m || !EMOTES[kind] || !m.group.visible) return;
    const bubble = textSprite((g) => { g.font = '72px system-ui, sans-serif'; g.fillText(EMOTES[kind], 48, 52); }, 96, 96, 0.7);
    (bubble.material as THREE.SpriteMaterial).depthTest = false;
    bubble.renderOrder = 18;
    m.group.add(bubble);
    this.anims = this.anims.filter((a) => { if (a.id === id) a.bubble.removeFromParent(); return a.id !== id; });
    this.anims.push({ id, kind, t: 0, bubble });
    this.invalidate();
  }
  private animate(dt: number): boolean {
    for (let i = this.anims.length - 1; i >= 0; i--) {
      const a = this.anims[i], m = this.minis.get(a.id);
      a.t += dt;
      const u = a.t / 1.1;
      if (!m || u >= 1) {
        a.bubble.removeFromParent();
        if (m) this.pose(m);
        this.anims.splice(i, 1);
        continue;
      }
      this.pose(m);
      const body = m.group.children[0], s = m.val.s || 1, top = (m.val.e || 0) + (MINIS[m.val.k]?.height ?? STANDIN_HEIGHT) * s;
      const w = Math.sin(Math.min(1, u * 2) * Math.PI); // one swell over the first half
      if (!m.val.d) switch (a.kind) {
        case 'attack': this.lunge(a.id, m, w * 0.45, w * 0.35) || (body.translateZ(w * 0.45), body.rotateX(w * 0.35)); break;
        case 'hurt': body.position.x += Math.sin(a.t * 55) * 0.07 * (1 - u); this.lunge(a.id, m, -w * 0.25, -w * 0.3) || body.rotateX(-w * 0.3); break;
        case 'cheer': body.position.y += Math.abs(Math.sin(u * Math.PI * 2)) * 0.4; body.rotateY(u * Math.PI * 2); break;
        case 'sleep': body.rotateZ(w * 0.35); break;
        default: body.rotateZ(Math.sin(u * Math.PI * 4) * 0.22 * (1 - u));
      }
      a.bubble.position.set(0, top + 0.9 + u * 0.5, 0);
      (a.bubble.material as THREE.SpriteMaterial).opacity = Math.min(1, (1 - u) * 3);
    }
    return this.anims.length > 0;
  }

  // ---- knocks ----------------------------------------------------------------
  // Dice bounce off the pieces on the table, and a piece that is hit rocks and settles. The
  // rocking is for show: it is worked out on each device from what everyone already shares
  // (the recorded throw, the moves), so nothing extra is sent and nothing on the table changes.

  /** What thrown dice can run into around a spot: the minis, props and walls this player can see. */
  solidsNear(c: Vec, reach: number, minis = true): Solid[] {
    const out: Solid[] = [], near = (x: number, z: number) => Math.abs(x - c[0]) <= reach && Math.abs(z - c[2]) <= reach;
    for (const m of minis ? this.minis.values() : []) {
      const v = m.val, s = v.s || 1, h = MINIS[v.k].height * s, y = v.y + Math.max(0, Math.min(12, v.e || 0));
      if (!m.group.visible || v.h || !near(v.x + 0.5, v.z + 0.5)) continue; // a hidden mini must not give itself away
      out.push(v.d ? { p: [v.x + 0.5, y + 0.2 * s, v.z + 0.5], h: [0.5 * s, 0.2 * s, 0], round: true } : { p: [v.x + 0.5, y + h / 2, v.z + 0.5], h: [0.36 * s, h / 2, 0], round: true });
    }
    for (const [key, g] of this.props) {
      const [x, , z] = parse(key);
      if (!g.visible || g.userData.pending || !near(x + 0.5, z + 0.5) || this.wobbles.has(key)) continue;
      out.push(...((g.userData.solids as Solid[] | undefined) ?? (g.userData.solids = propSolids(g))));
    }
    for (const [key, piece] of this.edges) {
      const [x, y, z, side] = parseEdge(key);
      if (piece === 'walldoor' || !near(x + 0.5, z + 0.5) || this.cellHidden(x, y, z)) continue; // doorways stand open
      out.push(side === 'n' ? { p: [x + 0.5, y + 0.5, z], h: [0.5, 0.5, 0.1] } : { p: [x, y + 0.5, z + 0.5], h: [0.1, 0.5, 0.5] });
    }
    out.push(...this.loose.solids(c, reach));
    return out;
  }

  /** A die was knocked sideways here: whatever it ran into is pushed the other way. */
  private bump(at: THREE.Vector3, dv: THREE.Vector3): void {
    const push = Math.min(4, Math.hypot(dv.x, dv.z) * 0.8) / Math.hypot(dv.x, dv.z);
    for (const [id, m] of this.minis) {
      const v = m.val, s = v.s || 1, y = v.y + (v.e || 0);
      if (!m.group.visible || v.d || at.y < y - DIE || at.y > y + MINIS[v.k].height * s + DIE) continue;
      if (Math.hypot(at.x - v.x - 0.5, at.z - v.z - 0.5) < 0.36 * s + DIE + 0.12) this.kick(id, -dv.x * push, -dv.z * push);
    }
    for (const [key, g] of this.props) {
      if (!g.visible || Math.abs(at.x - g.position.x) > 1.5 || Math.abs(at.z - g.position.z) > 1.5) continue;
      const hit = ((g.userData.solids as Solid[] | undefined) ?? (this.wobbles.has(key) ? [] : (g.userData.solids = propSolids(g))))
        .some((b) => Math.abs(at.x - b.p[0]) < b.h[0] + DIE + 0.12 && Math.abs(at.y - b.p[1]) < b.h[1] + DIE + 0.12 && Math.abs(at.z - b.p[2]) < b.h[2] + DIE + 0.12);
      if (hit) this.kick(key, -dv.x * push * 0.35, -dv.z * push * 0.35); // furniture is heavier than a figure
    }
  }

  /** A boulder is rolling past here: the figures it brushes are set rocking, the way it is going. */
  private shake(at: THREE.Vector3, dir: THREE.Vector3): void {
    const k = 2.4 / Math.hypot(dir.x, dir.z);
    for (const [id, m] of this.minis) {
      const v = m.val, y = v.y + (v.e || 0);
      if (!m.group.visible || v.d || this.wobbles.has(id) || at.y < y - 1 || at.y > y + MINIS[v.k].height * (v.s || 1) + 1) continue;
      if (Math.hypot(at.x - v.x - 0.5, at.z - v.z - 0.5) < 1.6) this.kick(id, dir.x * k, dir.z * k);
    }
  }

  /** Set a mini (by id) or a prop (by cell) rocking: `vx`, `vz` is how fast it starts to lean, and which way. */
  private kick(key: string, vx: number, vz: number): void {
    const w = this.wobbles.get(key) ?? { x: 0, z: 0, vx: 0, vz: 0 };
    w.vx += vx;
    w.vz += vz;
    this.wobbles.set(key, w);
    this.invalidate();
  }

  /** Rock a mini (by id) or a prop (by cell key) from outside the board, e.g. one that was shoved and would not budge. */
  nudge(key: string, vx: number, vz: number): void { if (this.minis.has(key) || this.props.has(key)) this.kick(key, vx, vz); }

  /** A blast went off here: the furniture in range rocks away from it, hardest close by. For show only. */
  rock(c: Vec, radius: number): void {
    for (const [key, g] of this.props) {
      const [x, y, z] = parse(key), dx = x - c[0], dz = z - c[2], far = Math.hypot(dx, dz);
      if (!g.visible || g.userData.pending || far > radius + 0.5 || Math.abs(y - c[1]) > radius) continue;
      const push = 1.6 - far / (radius + 1);
      this.kick(key, far ? (dx / far) * push : push, far ? (dz / far) * push : 0);
    }
  }

  /** Several edits as one step of undo (a blast moves many minis at once). */
  editAll(edits: [string, unknown][]): void {
    if (!this.full || !edits.length) return;
    this.batch = [];
    this.undoStack.push(this.batch);
    for (const [k, v] of edits) this.edit(k, v);
    this.batch = null;
  }

  /** The mini waiting to be shoved: the next tap on the table says which way. */
  shoving: string | null = null;
  /** Wait for that tap (null calls it off). False if this player may not move the mini. */
  aimShove(id: string | null): boolean {
    this.shoving = id && this.hooks.canMove(id) ? id : null;
    return !!this.shoving;
  }
  /** The tap came. On another mini it means "shoved by this one", so away from it; anywhere else, towards the tap. */
  private pointShove(): void {
    const id = this.shoving!, v = this.minis.get(id)?.val;
    this.shoving = null;
    const other = this.pickMini(), o = other && other !== id ? this.minis.get(other)!.val : null, s = this.pickSurface();
    const back = v && o && heading(o.x, o.z, v.x + 0.5, v.z + 0.5);
    const way = !v || other === id || !this.hooks.canMove(id) ? null : o ? back : s && heading(v.x, v.z, s.point.x, s.point.z);
    this.hooks.onShove(id, way?.[0] ?? 0, way?.[1] ?? 0);
  }

  private tilt = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  /** Rock the knocked pieces: each is a damped spring pulling it back upright. */
  private wobble(dt: number): boolean {
    for (const [key, w] of this.wobbles) {
      const mini = this.minis.get(key), obj = mini ? mini.group.children[0] : this.props.get(key);
      if (!obj || (w.obj && w.obj !== obj && !mini)) { this.wobbles.delete(key); continue; }
      if (!w.base && !mini) w.base = obj.quaternion.clone();
      w.obj = obj;
      for (let t = dt; t > 0; t -= 1 / 120) { // small steps: the spring is stiff
        const h = Math.min(t, 1 / 120);
        w.vx += (-190 * w.x - 6.5 * w.vx) * h;
        w.vz += (-190 * w.z - 6.5 * w.vz) * h;
        w.x += w.vx * h;
        w.z += w.vz * h;
      }
      const lean = Math.hypot(w.x, w.z), done = lean < 0.004 && Math.hypot(w.vx, w.vz) < 0.05;
      if (mini && !this.anims.some((a) => a.id === key)) this.pose(mini);
      else if (w.base) obj.quaternion.copy(w.base);
      if (done) { this.wobbles.delete(key); continue; }
      const angle = Math.min(lean, 0.45);
      obj.quaternion.premultiply(this.tilt.setFromAxisAngle(this.axis.set(w.z, 0, -w.x).normalize(), angle));
    }
    return this.wobbles.size > 0;
  }

  // ---- breaking ---------------------------------------------------------------
  // In play, whoever runs the table can tap a wall, a door or a thing and break it. The break
  // is one ordinary edit, so it syncs and can be undone. The debris is for show, and a removal
  // alone cannot tell a break from an eraser stroke, an undo or a new scene: so the breaker
  // also says "this broke" in a live message, and each device bursts the piece when it sees it go.

  /** The piece on offer to be broken (a `b:` or `w:` key), marked on the table. */
  offered: string | null = null;
  /** The offer changed, or the view of it moved: the UI shows, moves or hides its Break button. */
  onOffer: (key: string | null) => void = () => {};
  /** This device broke a piece: tell the others which, so they see it burst too. */
  onBreak: (key: string, id: string) => void = () => {};
  /** A piece burst where this player can see it (`wood` cracks, stone crumbles). */
  onCrumble: (wood: boolean) => void = () => {};
  debris!: Debris;
  /** Pieces said to be breaking whose removal has not reached this device yet, and until when we wait for it. */
  private breaking = new Map<string, { id: string; until: number }>();

  /** What a tap in play would break: the wall, thing or built block under the pointer. */
  private breakTarget(): string | null {
    if (!this.full) return null;
    const key = this.eraseTarget(), v = key && this.store.get<CellVal>(key);
    return key && v && broken(key, v.i) !== undefined ? key : null;
  }
  private offer(key: string | null): void {
    if (key === this.offered) return;
    this.offered = key;
    if (!key) this.hideGhost();
    this.onOffer(key);
  }
  /** Show which piece the Break button is about. */
  private markOffer(): void {
    const key = this.offered;
    if (!key) return;
    if (key.startsWith('w:')) { this.edgeGhost(parseEdge(key), '#ff5a5a'); return; }
    const [x, y, z] = parse(key);
    (this.ghost.material as THREE.MeshBasicMaterial).color.set('#ff5a5a');
    this.ghost.scale.setScalar(1.04);
    this.ghost.position.set(x + 0.5, y - 0.02, z + 0.5);
    this.ghost.visible = true;
    this.invalidate();
  }
  /** Where the Break button goes, in CSS pixels: just above the piece on offer. */
  offerSpot(): { x: number; y: number } | null {
    const key = this.offered;
    if (!key) return null;
    const [x, y, z, side] = pieceAt(key);
    const p = new THREE.Vector3(side === 'w' ? x : x + 0.5, y + 1.05, side === 'n' ? z : z + 0.5).project(this.camera);
    if (p.z > 1) return null; // behind the camera
    return { x: ((p.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - p.y) / 2) * this.canvas.clientHeight };
  }
  /** Break the piece on offer: one edit, and word to the table that it was a break. */
  breakOffered(): void {
    const key = this.offered, v = key && this.store.get<CellVal>(key), next = key && v ? broken(key, v.i) : undefined;
    this.offer(null);
    if (!key || !v || next === undefined || !this.full) return;
    this.breaking.set(key, { id: v.i, until: performance.now() + 3000 });
    this.edit(key, next);
    this.onBreak(key, v.i);
  }
  /** Someone broke the piece `id` at `key`. Their edit may arrive before or after this does. */
  broke(key: string, id: string): void {
    if (!BREAK_KEY.test(key) || broken(key, id) === undefined) return;
    if (this.store.get<CellVal>(key)?.i === id) this.breaking.set(key, { id, until: performance.now() + 3000 }); // still standing: wait for the edit
    else this.crumble(key, id);
  }
  /** A cell or edge changed while a break is on offer or expected. */
  private applyBreak(key: string, value: unknown, prev: unknown): void {
    if (key === this.offered) this.offer(null); // it changed under the button
    const due = this.breaking.get(key), now = performance.now();
    for (const [k, b] of this.breaking) if (k === key || now > b.until) this.breaking.delete(k); // this one, and word of breaks that never came
    if (due && now < due.until && (prev as CellVal | null)?.i === due.id && (value as CellVal | null)?.i !== due.id) this.crumble(key, due.id);
  }
  private box = new THREE.Box3();
  /** Burst a piece into debris and rock what stands near, if this player can see the spot at all. */
  private crumble(key: string, id: string): void {
    const [x, y, z, side] = pieceAt(key);
    if (![x, y, z].every(Number.isInteger) || this.cellHidden(x, y, z)) return; // under fog or above the cutaway: not a sound, not a speck
    let at: Vec = [x + 0.5, y + 0.5, z + 0.5], half: Vec = [0.42, 0.45, 0.42];
    if (side === 'n') { at = [x + 0.5, y + 0.5, z]; half = [0.48, 0.48, 0.08]; }
    else if (side === 'w') { at = [x, y + 0.5, z + 0.5]; half = [0.08, 0.48, 0.48]; }
    else if (PROPS[id]) {
      // As big as the thing was, if it is still standing here to be measured.
      const g = this.props.get(key), b = g && !g.userData.pending && g.children.length ? this.box.setFromObject(g) : null;
      half = [0.3, 0.35, 0.3];
      if (b && !b.isEmpty()) half = [Math.min(0.5, (b.max.x - b.min.x) / 2), Math.min(1, (b.max.y - y) / 2), Math.min(0.5, (b.max.z - b.min.z) / 2)];
      at[1] = y + half[1];
    }
    // Chunks land on what is really there, but a fogged column must not show its height through them.
    const top = (cx: number, cz: number) => (!this.full && fogged(this.store, cx, cz) ? y : Math.min(this.cut, (columnTop(this.store, cx, cz)?.y ?? -1) + 1));
    const kind = debrisOf(key, id);
    this.debris.burst(shatter(seedOf(key) + this.debris.count, at, half, top), kind.tones);
    for (const [mid, m] of this.minis) {
      const dx = m.val.x + 0.5 - at[0], dz = m.val.z + 0.5 - at[2], d = Math.hypot(dx, dz);
      if (!m.group.visible || m.val.d || d > 1.6 || Math.abs(m.val.y - y) > 1.5) continue;
      const push = (3.4 * (1 - d / 2.2)) / (d || 1);
      this.kick(mid, d ? dx * push : 2, dz * push);
    }
    for (const [pk, g] of this.props) {
      const dx = g.position.x - at[0], dz = g.position.z - at[2], d = Math.hypot(dx, dz);
      if (pk === key || !g.visible || g.userData.pending || d > 1.6 || d < 0.01 || Math.abs(g.position.y - y) > 1.5) continue;
      const push = (1.3 * (1 - d / 2.2)) / d; // furniture is heavier than a figure
      this.kick(pk, dx * push, dz * push);
    }
    this.onCrumble(kind.wood);
    this.invalidate();
  }

  /**
   * Fly a shot from a mini to another mini or a spot, and rock the mini it lands on. Only between
   * minis this player is shown: a hidden one neither shoots, nor is shot at, nor flinches. False if not drawn.
   */
  shoot(shot: Shot): boolean {
    if (this.visDirty) this.refreshMinis();
    const seen = (id: string) => { const m = this.minis.get(id); return m?.group.visible ? m.val : null; };
    const from = seen(shot.a), at = shot.b, to = typeof at === 'string' ? seen(at) : at;
    if (!from || !to || !SHOTS[shot.k]) return false;
    const path = shotPath(this.store, from, to);
    this.shots.fire(shot.k, path.a, path.b, (vx, vz) => {
      const push = SHOTS[shot.k].push;
      if (path.hit && typeof at === 'string' && seen(at) && !seen(at)!.d) this.kick(at, vx * push, vz * push);
    });
    this.invalidate();
    return true;
  }

  /** Another player is dragging a mini: show it moving before they drop it. */
  liveMove(id: string, p: Vec): void {
    const m = this.minis.get(id);
    if (m && this.gesture?.mini !== id && p.every(Number.isFinite)) { m.target.set(p[0] + 0.5, p[1] + 0.3, p[2] + 0.5); m.hop = undefined; }
  }

  // ---- feel ------------------------------------------------------------------
  // Minis hop from cell to cell, swing in the hand, land with a squash and fall over when knocked
  // down. Like the knocks above it is for show, worked out here from the moves everyone already
  // shares, and it always ends on the resting pose.

  /** The passing part of a mini's pose: part-way through falling or getting up, squashed from a landing. */
  private posture(m: Mini): void {
    const body = m.group.children[0], v = m.val, s = v.s || 1;
    if (m.fall) {
      const a = m.fall.up ? riseAt(m.fall.t) : toppleAt(m.fall.t);
      body.rotation.x = (-Math.PI / 2) * a;
      body.position.y = Math.max(0, Math.min(12, v.e || 0)) + 0.22 * s * Math.max(0, Math.min(1, a));
    }
    const q = m.squash === undefined || v.d ? 1 : squashAt(m.squash);
    body.scale.set(s / Math.sqrt(q), s * q, s / Math.sqrt(q));
  }

  /** Send a mini to its target in an arc from wherever it is now. `dx`, `dz` is the way it is travelling. */
  private hop(m: Mini, dx: number, dz: number): void {
    const from = m.group.position.clone(), dist = Math.hypot(m.target.x - from.x, m.target.z - from.z);
    m.hop = { from, t: 0, ...hopPlan(dist, m.target.y - from.y), dx, dz };
    m.vel = undefined;
    this.invalidate();
  }

  /** A mini has come down: it squashes and rocks the way it was going, and the ones standing next to it shiver. */
  private land(id: string, m: Mini, dx: number, dz: number): void {
    const v = m.val, far = Math.hypot(dx, dz);
    if (v.d) return;
    m.squash = 0;
    if (far) this.kick(id, (dx / far) * 2.4, (dz / far) * 2.4);
    if (!m.group.visible) return; // a mini this player cannot see must not give itself away
    this.hooks.onLand(this.landing === id); // heard by all who see it, felt by whoever set it down
    if (this.landing === id) this.landing = null;
    for (const [oid, o] of this.minis) {
      const ox = o.val.x - v.x, oz = o.val.z - v.z, d = Math.hypot(ox, oz);
      if (oid !== id && d && d < 1.6 && Math.abs(o.val.y - v.y) <= 1 && o.group.visible && !o.val.d) this.kick(oid, (ox / d) * 0.5, (oz / d) * 0.5);
    }
  }

  /**
   * Lean and step a mini toward the nearest other mini within about two cells (away from it, if
   * negative). False if nobody is that close. Hidden minis do not count, so the GM's table shows
   * the same move as everyone else's.
   */
  private lunge(id: string, m: Mini, step: number, lean: number): boolean {
    const v = m.val, near: [number, number][] = [];
    for (const [oid, o] of this.minis) if (oid !== id && o.group.visible && !o.val.h && Math.abs(o.val.y - v.y) <= 2) near.push([o.val.x, o.val.z]);
    const dir = nearestDir(v.x, v.z, near, 2.5), body = m.group.children[0];
    if (!dir) return false;
    body.position.x += dir[0] * step;
    body.position.z += dir[1] * step;
    body.quaternion.premultiply(this.tilt.setFromAxisAngle(this.axis.set(dir[1], 0, -dir[0]), lean));
    return true;
  }

  /** Play out the falls, getting-ups and landings. True while any is still going. */
  private feel(dt: number): boolean {
    let busy = false;
    for (const m of this.minis.values()) {
      if (!m.fall && m.squash === undefined) continue;
      if (m.fall && (m.fall.t += dt) >= (m.fall.up ? RISE : TOPPLE)) m.fall = undefined;
      if (m.squash !== undefined && (m.squash += dt) >= SQUASH) m.squash = undefined;
      this.pose(m);
      busy = true;
    }
    return busy;
  }

  /** Move each mini toward where it should be: along its arc if it is hopping, else carried there. True while any moves. */
  private travel(dt: number): boolean {
    let moving = false;
    const k = 1 - Math.exp(-dt * 14);
    for (const [id, m] of this.minis) {
      if (this.gesture?.mini === id) m.hop = undefined; // picked up in mid-air
      const at = m.group.position, h = m.hop;
      if (h) {
        h.t += dt;
        at.set(...hopAt(h.from.toArray(), m.target.toArray(), h.h, h.t / h.dur));
        if (h.t >= h.dur) { m.hop = undefined; this.land(id, m, h.dx, h.dz); }
        moving = true;
        continue;
      }
      if (at.distanceToSquared(m.target) < 1e-6) { m.vel = undefined; continue; }
      const x = at.x, z = at.z;
      at.lerp(m.target, k);
      moving = true;
      if (dt < 1e-4 || m.val.d) continue;
      // Carried, it hangs like a pendulum from the hand: it leans against every change of speed.
      const vx = (at.x - x) / dt, vz = (at.z - z) / dt, [px, pz] = m.vel ?? [0, 0];
      this.kick(id, (px - vx) * 0.18, (pz - vz) * 0.18);
      m.vel = [vx, vz];
    }
    return moving;
  }

  ping(p: Vec, color: string): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, side: THREE.DoubleSide }),
    );
    mesh.position.set(p[0], p[1] + 0.05, p[2]);
    mesh.renderOrder = 10;
    this.invalidate();
    this.scene.add(mesh);
    this.pings.push({ mesh, t: 0 });
  }

  /** Draw (or with null, remove) a player's ruler. Everyone at the table sees everyone's. */
  showRuler(owner: string, r: Ruler | null, color: string): void {
    const old = this.rulers.get(owner);
    if (old) {
      this.scene.remove(old);
      old.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); });
      this.rulers.delete(owner);
    }
    this.invalidate();
    if (!r || ![...r.a, ...r.b].every(Number.isFinite)) return;
    const a = new THREE.Vector3(...r.a), b = new THREE.Vector3(...r.b);
    const { cells, feet } = measure(r.a, r.b);
    if (cells > 400) return;
    const g = new THREE.Group();
    const mat = (opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide });
    const add = (geo: THREE.BufferGeometry, at: THREE.Vector3, opacity = 1) => {
      const m = new THREE.Mesh(geo, mat(opacity));
      m.position.copy(at);
      m.renderOrder = 15;
      g.add(m);
      return m;
    };
    const lift = new THREE.Vector3(0, 0.12, 0);
    const flat = Math.max(0.01, Math.hypot(b.x - a.x, b.z - a.z));
    const heading = Math.atan2(b.z - a.z, b.x - a.x);
    // The measured line itself, as a bar thick enough to see on a phone.
    const bar = add(new THREE.BoxGeometry(1, 0.07, 0.07), a.clone().add(b).multiplyScalar(0.5).add(lift));
    bar.scale.x = Math.max(0.01, cells);
    if (cells > 0.01) bar.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), b.clone().sub(a).normalize());
    add(new THREE.SphereGeometry(0.11, 12, 8), a.clone().add(lift));
    add(new THREE.SphereGeometry(0.11, 12, 8), b.clone().add(lift));
    if (r.m === 'circle') {
      add(new THREE.RingGeometry(Math.max(0, flat - 0.07), flat + 0.07, 64).rotateX(-Math.PI / 2), a.clone().add(lift));
      add(new THREE.CircleGeometry(flat, 48).rotateX(-Math.PI / 2), a.clone().add(lift), 0.16);
    } else if (r.m === 'cone') {
      // A cone as wide at its end as it is long (the common tabletop rule): about 53°.
      const spread = 2 * Math.atan(0.5);
      add(new THREE.CircleGeometry(flat, 24, -heading - spread / 2, spread).rotateX(-Math.PI / 2), a.clone().add(lift), 0.3);
    }
    const text = `${cells.toFixed(1)} · ${feet} ft`;
    const label = textSprite((c) => {
      c.fillStyle = 'rgba(15,17,23,.88)';
      c.beginPath();
      c.roundRect(4, 4, 248, 56, 16);
      c.fill();
      c.fillStyle = '#fff';
      c.font = '700 32px system-ui, sans-serif';
      c.fillText(text, 128, 34, 236);
    }, 256, 64, 1.9);
    (label.material as THREE.SpriteMaterial).depthTest = false;
    label.renderOrder = 16;
    label.position.copy(b).add(new THREE.Vector3(0, 1.1, 0));
    g.add(label);
    this.rulers.set(owner, g);
    this.scene.add(g);
  }

  // ---- selection / editing -------------------------------------------------

  select(id: string | null): void {
    if (id && this.picked.length) this.pick([]);
    if (id !== this.shoving) this.shoving = null;
    if (this.selected) this.minis.get(this.selected)?.group.remove(this.ring);
    this.selected = id && this.minis.has(id) ? id : null;
    if (this.selected) this.offer(null);
    if (this.selected) this.attachRing(this.minis.get(this.selected)!);
    this.invalidate();
    this.hooks.onSelect(this.selected);
  }
  /** Select pieces with the pick tool (an empty list lets go of them). Only whoever may build can. */
  pick(keys: string[]): void {
    const next = this.build ? present(this.store, keys) : [];
    if (next.length && this.selected) this.select(null);
    this.picked = next;
    if (!next.length) this.placing = false;
    this.showPick();
    this.hooks.onPick?.(this.picked);
  }
  /** What the selection tools act on: the picked pieces, or else the selected mini. */
  selection(): string[] {
    return this.picked.length ? this.picked : this.selected ? [`m:${this.selected}`] : [];
  }
  private showPick(): void {
    const b = boundsOf(this.store, this.picked);
    this.pickBox.visible = !!b;
    if (b) {
      // A wall or a coin is thinner than its cell, but the cell is what a finger aims at.
      this.pickBox.position.set(b.min[0] - 0.03, b.min[1] - 0.03, b.min[2] - 0.03);
      this.pickBox.scale.set(b.max[0] - b.min[0] + 1.06, b.max[1] - b.min[1] + 1.06, b.max[2] - b.min[2] + 1.06);
    }
    this.invalidate();
  }
  /** How far the pointer would carry the selection, in cells: a single prop or mini follows the ground, anything else slides on its own level. */
  private carry(): Vec | null {
    const keys = this.selection(), from = keys.length ? whereIs(this.store, keys[0]) : null;
    if (!from) return null;
    const kind = kindOf(keys[0]), v = this.store.get<CellVal>(keys[0]);
    let to: Vec | null = null;
    if (keys.length > 1) {
      // Several pieces slide on their own level, as one: by as far as the finger has come since it
      // took hold, or (Move, then a touch) with their middle on the column the finger points at.
      const b = boundsOf(this.store, keys);
      if (!b) return null;
      if (!this.grab) {
        const c = this.pickSurface()?.place;
        return c ? [c[0] - ((b.min[0] + b.max[0] + 1) >> 1), 0, c[2] - ((b.min[2] + b.max[2] + 1) >> 1)] : null;
      }
      const pt = this.onLevel(b.min[1]);
      return pt && [Math.floor(pt.x) - this.grab[0], 0, Math.floor(pt.z) - this.grab[2]];
    }
    if (keys.length === 1 && kind === 'mini') to = this.standing();
    else if (keys.length === 1 && kind === 'cell' && PROPS[v?.i ?? '']) to = this.pickSurface()?.place ?? null;
    else {
      const pt = this.onLevel(from[1] + (kind === 'cell' ? 0.5 : 0));
      to = pt && [Math.floor(pt.x), from[1], Math.floor(pt.z)];
    }
    return to && [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  }
  private carried = '';
  /** Show where the selection would land: white where it fits, red where it does not. */
  private carryGhost(): void {
    const d = this.carry();
    // (A big selection is only measured again when the finger reaches another cell.)
    if (d && this.ghost.visible && this.carried === d.join()) return;
    const b = d && boundsOf(this.store, this.selection());
    if (!d || !b) { this.hideGhost(); return; }
    this.carried = d.join();
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(moveEdits(this.store, this.selection(), d) ? '#ffffff' : '#ff5a5a');
    const w = b.max[0] - b.min[0] + 1, h = b.max[1] - b.min[1] + 1, dp = b.max[2] - b.min[2] + 1;
    this.ghost.scale.set(w, h, dp);
    this.ghost.position.set(b.min[0] + d[0] + w / 2, b.min[1] + d[1], b.min[2] + d[2] + dp / 2);
    this.ghost.visible = true;
    this.invalidate();
  }
  /** Write what a selection tool worked out, as one step of undo, and keep hold of the result. */
  private took(out: Picked | null): boolean {
    if (!out || !this.build) return false;
    const mini = this.selected;
    this.write(out.edits);
    if (mini && out.keys.length === 1 && out.keys[0].startsWith('m:')) this.select(out.keys[0].slice(2));
    else this.pick(out.keys);
    return true;
  }
  /** Move the selection by whole cells. False if the table has no room there. */
  movePicked(d: Vec): boolean { return this.took(moveEdits(this.store, this.selection(), d)); }
  /** Turn each selected piece a step where it stands; pieces spread over several cells go round their middle together. */
  turnPicked(): boolean {
    const keys = this.selection(), b = boundsOf(this.store, keys);
    const wide = !!b && (b.max[0] > b.min[0] || b.max[2] > b.min[2]);
    return this.took(wide ? turnAreaEdits(this.store, keys) : turnEdits(this.store, keys));
  }
  /** Copy the selection onto the nearest free spot; the copy becomes the selection. */
  copyPicked(): boolean { return this.took(copyEdits(this.store, this.selection(), () => crypto.randomUUID().replace(/-/g, '').slice(0, 12))); }
  /** Take the selection off the table. */
  removePicked(): boolean {
    const out = removeEdits(this.store, this.selection());
    if (!out || !this.build) return false;
    this.write(out.edits);
    this.select(null);
    this.pick([]);
    return true;
  }
  /** The piece under the pointer that a tap would select: a wall, a thing, a loose piece, or the block touched. */
  private pickTarget(): string | null {
    const t = this.eraseTarget();
    if (!t?.startsWith('b:')) return t;
    // A finger that lands on the ground a thing stands on meant the thing: small props are hard to hit.
    const s = this.pickSurface(), above = s ? ck(...s.place) : '';
    return PROPS[this.store.get<CellVal>(above)?.i ?? ''] ? above : t;
  }

  private attachRing(m: Mini): void {
    this.ring.scale.setScalar(m.val.s || 1);
    m.group.add(this.ring);
  }

  private get erasing(): boolean { return this.tool === 'build' && this.brush === 'erase'; }
  private get copying(): boolean { return this.tool === 'build' && this.brush === 'copy'; }
  private get pasting(): boolean { return this.tool === 'build' && this.brush === 'paste' && !!this.slab; }
  /** The brush is a wall piece: it goes on the edge of a cell, not in it. */
  private get edging(): boolean { return this.tool === 'build' && !!EDGES[this.brush]; }
  private get rooming(): boolean { return this.tool === 'build' && this.brush === 'room'; }
  /** The brush that steps a torch, fire or crystal through its strengths. */
  private get lighting(): boolean { return this.tool === 'build' && this.brush === 'light'; }
  /** The brush that pours loose pieces out where the table is touched. */
  private get pouring(): boolean { return this.tool === 'build' && this.brush === 'pour'; }
  /** A spot on the table for the scatter brush: where the pointer meets the ground or a block. */
  private pourSpot(): Vec | null {
    const p = this.pickSurface()?.point;
    return p && this.build && p.y < Math.min(MAX_Y, this.cut) ? [+p.x.toFixed(2), +Math.max(0, p.y).toFixed(2), +p.z.toFixed(2)] : null;
  }
  /** The loose pieces under the pointer: a fingertip covers more than one coin, so all that it covers. */
  private looseAt(): string[] {
    const s = this.pickSurface(), far = s ? s.point.distanceTo(this.ray.ray.origin) + 0.2 : Infinity;
    return this.loose.near(this.ray.ray, this.coarse ? 0.34 : 0.24, far).map((id) => `l:${id}`);
  }
  /** Dragging the eraser over loose pieces sweeps them up, as one undo step. */
  private wipe(g: Gesture): void {
    const keys = this.looseAt();
    if (!keys.length) return;
    if (!g.stroke) {
      g.stroke = { level: 0, plane: 0 };
      this.batch = [];
      this.undoStack.push(this.batch);
    }
    for (const k of keys) this.edit(k, null);
  }
  private stepLight(): void {
    const p = this.pickProp(), v = p && this.store.get<CellVal>(p.key);
    if (!p || !v || !GLOWS[v.i]) return;
    const next = nextLight(v);
    this.edit(p.key, next);
    this.hooks.onLight(LIGHT_LEVELS.find(([l]) => l === (next.l ?? 1))![1]);
  }
  /** The brush shapes or dresses the land rather than placing a piece. */
  private get shaping(): boolean {
    return this.tool === 'build' && (LAND.has(this.brush) || (this.surface && !!BLOCKS[this.brush]));
  }
  /** The column under the pointer. */
  private pickColumn(): [x: number, z: number] | null {
    const s = this.pickSurface(), c = s && (s.cell ?? s.place);
    return c ? [c[0], c[2]] : null;
  }
  /** Apply the land brush around the pointer. A drag is one stroke: every column changes once. */
  private shape(g: Gesture): void {
    const at = this.pickColumn();
    if (!at) return;
    if (!g.stroke) {
      g.stroke = { level: columnTop(this.store, at[0], at[1])?.y ?? 0, plane: 0 };
      g.shaped = new Set();
      this.batch = [];
      this.undoStack.push(this.batch);
    }
    const put = (k: string, v: unknown) => this.edit(k, v), r = this.reach;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > r * r + r) continue; // a round brush
      const x = at[0] + dx, z = at[1] + dz, k = `${x},${z}`;
      if (g.shaped!.has(k) || Math.abs(x) >= LIMIT || Math.abs(z) >= LIMIT) continue;
      g.shaped!.add(k);
      if (this.brush === 'raise') sculpt(this.store, x, z, 1, put);
      else if (this.brush === 'lower') sculpt(this.store, x, z, -1, put);
      else if (this.brush === 'level') levelTo(this.store, x, z, g.stroke.level, put);
      else if (this.brush === 'grow') grow(this.store, x, z, put);
      else resurface(this.store, x, z, this.brush, put);
    }
  }

  /** The wall under the pointer, if there is one. */
  private pickWall(): { key: string; dist: number } | null {
    if (this.edgesDirty) this.rebuildEdges();
    const meshes = [...this.edgeSwarms.values()].filter((w) => w.mesh.count).map((w) => w.mesh);
    for (const hit of this.ray.intersectObjects(meshes, false)) {
      const key = (hit.object.userData.swarm as Swarm).keys[hit.instanceId!];
      if (key) return { key, dist: hit.distance }; // posts have no key: look past them
    }
    return null;
  }
  /** The edge a wall would go on: the wall being pointed at, or else the nearest side of the cell touched. */
  private pickEdge(): Edge | null {
    const s = this.pickSurface(), w = this.pickWall();
    if (w && (!s || w.dist <= s.point.distanceTo(this.ray.ray.origin))) return parseEdge(w.key);
    if (!s) return null;
    const [cx, y, cz] = s.place;
    if (y < 0 || y >= Math.min(MAX_Y, this.cut)) return null;
    const fx = Math.min(1, Math.max(0, s.point.x - cx)), fz = Math.min(1, Math.max(0, s.point.z - cz));
    const d = [fz, 1 - fz, fx, 1 - fx], i = d.indexOf(Math.min(...d));
    return i === 0 ? [cx, y, cz, 'n'] : i === 1 ? [cx, y, cz + 1, 'n'] : i === 2 ? [cx, y, cz, 'w'] : [cx + 1, y, cz, 'w'];
  }
  private setEdge([x, y, z, s]: Edge): void {
    if (Math.abs(x) >= LIMIT || Math.abs(z) >= LIMIT || y < 0 || y >= MAX_Y) return;
    const key = ek(x, y, z, s);
    if (this.store.get<EdgeVal>(key)?.i !== this.brush) this.edit(key, { i: this.brush });
  }
  private edgeGhost([x, y, z, s]: Edge, color: string): void {
    (this.ghost.material as THREE.MeshBasicMaterial).color.set(color);
    this.ghost.scale.set(s === 'n' ? 1 : 0.16, 1, s === 'n' ? 0.16 : 1);
    this.ghost.position.set(s === 'n' ? x + 0.5 : x, y, s === 'n' ? z : z + 0.5);
    this.ghost.visible = true;
    this.invalidate();
  }
  /** Where the pointer is on the level a drag started on. */
  private onLevel(y: number): THREE.Vector3 | null {
    const pt = this.ray.ray.intersectPlane(new THREE.Plane(THREE.Object3D.DEFAULT_UP, -y), new THREE.Vector3());
    return pt && pt.distanceTo(this.camera.position) <= 120 ? pt : null;
  }
  /** Dragging a finger draws a straight run of wall from the edge it started on. */
  private paintEdges(g: Gesture): void {
    if (!g.edge) return;
    const [x0, y, z0, s] = g.edge;
    if (!g.stroke) {
      g.stroke = { level: y, plane: y };
      this.batch = [];
      this.undoStack.push(this.batch);
    }
    const pt = this.onLevel(y);
    if (!pt) return;
    const from = s === 'n' ? x0 : z0, to = Math.max(from - ROOM_MAX, Math.min(from + ROOM_MAX, Math.floor(s === 'n' ? pt.x : pt.z)));
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) this.setEdge(s === 'n' ? [i, y, z0, s] : [x0, y, i, s]);
    this.edgeGhost(s === 'n' ? [to, y, z0, s] : [x0, y, to, s], '#ffffff');
  }
  /** Drag out a room: on release it gets a floor, walls with windows in a rhythm, and a doorway. */
  private stretchRoom(g: Gesture, done: boolean): void {
    const a = g.first, pt = a && this.onLevel(a[1]);
    if (!a || !pt) { if (done) this.marquee.visible = false; return; }
    const clamp = (v: number, c: number) => Math.max(c - ROOM_MAX + 1, Math.min(c + ROOM_MAX - 1, v));
    const bx = clamp(Math.floor(pt.x), a[0]), bz = clamp(Math.floor(pt.z), a[2]), y = a[1];
    const x0 = Math.min(a[0], bx), x1 = Math.max(a[0], bx), z0 = Math.min(a[2], bz), z1 = Math.max(a[2], bz);
    this.marquee.position.set(x0, y, z0);
    this.marquee.scale.set(x1 - x0 + 1, 1.02, z1 - z0 + 1);
    this.marquee.visible = !done;
    this.invalidate();
    if (!done || !g.moved || y >= Math.min(MAX_Y, this.cut)) return;
    this.batch = [];
    this.undoStack.push(this.batch);
    if (y > 0) {
      // The floor replaces the ground it is laid on (and bridges any gap under the room).
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = ck(x, y - 1, z), cur = this.store.get<CellVal>(k);
        if (!cur || GROUND[cur.i]) this.edit(k, { i: this.roomTimber ? 'wood' : 'stone' });
      }
    }
    for (const [k, piece] of roomEdges(x0, x1, z0, z1, y, this.roomTimber)) this.edit(k, { i: piece });
    this.batch = null;
  }

  /** Footprint of the slab as it would be pasted with the current rotation. */
  private slabSize(): Vec {
    const s = this.slab!;
    return this.rot % 2 ? [s.d, s.h, s.w] : [s.w, s.h, s.d];
  }
  private pasteAt(p: Vec): void {
    const s = this.slab!, r = this.rot;
    this.batch = [];
    this.undoStack.push(this.batch);
    for (const [dx, dy, dz, v] of s.cells) {
      const [x, z] = r === 1 ? [s.d - 1 - dz, dx] : r === 2 ? [s.w - 1 - dx, s.d - 1 - dz] : r === 3 ? [dz, s.w - 1 - dx] : [dx, dz];
      const c: Vec = [p[0] + x, p[1] + dy, p[2] + z];
      if (Math.abs(c[0]) >= LIMIT || Math.abs(c[2]) >= LIMIT || c[1] >= MAX_Y) continue;
      this.edit(ck(...c), PROPS[v.i] ? { i: v.i, ...(((v.r ?? 0) + 4 - r) % 4 ? { r: ((v.r ?? 0) + 4 - r) % 4 } : {}), ...(v.l !== undefined ? { l: v.l } : {}) } : v);
    }
    this.batch = null;
  }
  /** Stretch the copy marquee between two columns; on release, lift everything inside into the slab. */
  private stretchCopy(g: Gesture, done: boolean): void {
    const s = this.pickSurface(), a = g.first;
    const b = s && (s.cell ?? s.place);
    if (!a || !b) { if (done) this.marquee.visible = false; return; }
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]);
    const top = Math.max(1, this.maxHeight());
    this.marquee.position.set(x0, 0, z0);
    this.marquee.scale.set(x1 - x0 + 1, top + 0.05, z1 - z0 + 1);
    this.marquee.visible = !done;
    this.invalidate();
    if (!done) return;
    const found: [Vec, CellVal][] = [];
    for (const k of this.store.keys('b:')) {
      const c = parse(k);
      if (c[0] >= x0 && c[0] <= x1 && c[2] >= z0 && c[2] <= z1 && !this.cellHidden(...c)) found.push([c, this.store.get<CellVal>(k)!]);
    }
    if (!found.length || found.length > SLAB_MAX) return;
    const y0 = Math.min(...found.map(([c]) => c[1])), y1 = Math.max(...found.map(([c]) => c[1]));
    this.slab = { w: x1 - x0 + 1, h: y1 - y0 + 1, d: z1 - z0 + 1, cells: found.map(([c, v]) => [c[0] - x0, c[1] - y0, c[2] - z0, v]) };
    this.hooks.onSlab(this.slab);
  }

  /**
   * Select by area (the pick tool): while on, one finger drags a rectangle and everything standing
   * in it is picked. Two fingers are the camera, as with every tool. It turns itself off once
   * something is picked.
   */
  pickArea(on: boolean): void {
    on = on && this.full && this.tool === 'pick';
    if (on) { this.select(null); this.pick([]); }
    this.areaPick = on;
    if (this.tool !== 'pick') return;
    this.controls.touches.ONE = on ? (-1 as THREE.TOUCH) : THREE.TOUCH.ROTATE;
    this.controls.mouseButtons.LEFT = on ? (-1 as THREE.MOUSE) : THREE.MOUSE.ROTATE;
    this.marquee.visible = false;
    this.canvas.style.cursor = on ? 'crosshair' : 'grab';
    this.invalidate();
  }
  /** Stretch the marquee from the column the finger started on; on release, pick what stands in it, from the level touched up. */
  private stretchArea(g: Gesture, done: boolean): void {
    const s = this.pickSurface(), a = g.first, b = s && (s.cell ?? s.place);
    if (!a || !b) { if (done) this.marquee.visible = false; return; }
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[2], b[2]), z1 = Math.max(a[2], b[2]);
    this.marquee.position.set(x0, a[1], z0);
    this.marquee.scale.set(x1 - x0 + 1, Math.max(1, this.maxHeight() - a[1]) + 0.05, z1 - z0 + 1);
    this.marquee.visible = !done;
    this.invalidate();
    if (!done) return;
    const found = areaKeys(this.store, x0, x1, z0, z1, a[1], (x, y, z) => this.cellHidden(x, y, z));
    if (found?.length) {
      this.pickArea(false);
      // One figure alone is a figure selected, as a tap on it would have.
      if (found.length === 1 && found[0].startsWith('m:')) this.select(found[0].slice(2));
      else this.pick(found);
    }
    this.hooks.onArea?.(found ? found.length : null);
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.areaPick = false;
    this.offer(null);
    this.hideGhost();
    if (t !== 'move' && t !== 'pick') this.select(null);
    if (t !== 'pick' && this.picked.length) this.pick([]);
    this.placing = false;
    if (t !== 'fog') this.preview(false);
    if (t !== 'ruler' && this.rulers.has('me')) {
      this.showRuler('me', null, '');
      this.hooks.onRuler(null);
    }
    // In every tool but Move, one finger is the tool and two fingers are the camera.
    this.controls.touches.ONE = t === 'move' || t === 'pick' ? THREE.TOUCH.ROTATE : (-1 as THREE.TOUCH);
    // Ruler, fog and the copy marquee are drag tools for the mouse as well (right-drag and wheel still move the camera).
    this.controls.mouseButtons.LEFT = t === 'ruler' || t === 'fog' || this.copying || this.rooming ? (-1 as THREE.MOUSE) : THREE.MOUSE.ROTATE;
    this.marquee.visible = false;
    this.canvas.style.cursor = t === 'move' || t === 'pick' ? 'grab' : 'crosshair';
  }

  /**
   * Put a generated scene on the table as one undo step: everything built inside its
   * bounds, and whatever is left of the scene it replaces (`old`), makes way for it.
   */
  applyScene(edits: [string, unknown][], [x0, x1, z0, z1]: number[], old: Set<string>, frame = true): void {
    if (!this.build) return;
    const scene = new Map(edits);
    this.batch = [];
    this.undoStack.push(this.batch);
    for (const prefix of ['b:', 'w:']) for (const k of [...this.store.keys(prefix)]) {
      if (scene.has(k)) continue;
      const [x, , z] = k.slice(2).split(',').map(Number);
      if (old.has(k) || (x >= x0 && x <= x1 + 1 && z >= z0 && z <= z1 + 1)) this.edit(k, null);
    }
    for (const k of [...this.store.keys('l:')]) { // loose pieces would be left buried in the new ground, or hanging over it
      const p = decodeLoose(this.store.get(k))?.p;
      if (!p || (p[0] >= x0 && p[0] <= x1 + 1 && p[2] >= z0 && p[2] <= z1 + 1)) this.edit(k, null);
    }
    for (const [k, v] of edits) if (JSON.stringify(this.store.get(k)) !== JSON.stringify(v)) this.edit(k, v);
    this.batch = null;
    this.touched();
    if (!frame) return;
    // Stand back far enough to see all of it, looking the way the camera already looks.
    const t = this.controls.target, away = this.camera.position.clone().sub(t).normalize();
    t.set((x0 + x1 + 1) / 2, 0.5, (z0 + z1 + 1) / 2);
    const half = Math.tan((this.camera.fov * Math.PI) / 360) * Math.min(1, this.camera.aspect); // a phone held upright sees a narrow slice
    this.camera.position.copy(t).addScaledVector(away, Math.min(this.controls.maxDistance, (Math.max(x1 - x0, z1 - z0) + 2) * 0.62 / half));
    this.controls.update();
    this.touched();
  }

  /** Turn the camera to a spot on the table, keeping its distance and angle. */
  lookAt(x: number, y: number, z: number): void {
    const t = this.controls.target, off = this.camera.position.clone().sub(t);
    t.set(x, y, z);
    this.camera.position.copy(t).add(off);
    this.controls.update();
    this.invalidate();
  }

  /** Undo the last edit; a whole painted stroke counts as one. */
  /** Undo the last step. Returns how many things it changed (0: there was nothing to undo), for whoever wants to say so. */
  undo(): number { return this.replay(this.undoStack, this.redoStack); }
  redo(): number { return this.replay(this.redoStack, this.undoStack); }
  get canUndo(): boolean { return this.undoStack.some((g) => g.length > 0); }
  get canRedo(): boolean { return this.redoStack.some((g) => g.length > 0); }
  private replay(from: Undo[][], to: Undo[][]): number {
    let group = from.pop();
    while (group && !group.length) group = from.pop(); // a stroke that changed nothing is not a step
    if (!group) return 0;
    const inverse: Undo[] = [];
    for (const u of [...group].reverse()) {
      inverse.push({ k: u.k, prev: this.store.get(u.k) });
      this.store.set(u.k, u.prev);
    }
    to.push(inverse);
    // The picked pieces went with the step (a move or a copy taken back): what it put back is picked instead.
    if (this.picked.some((k) => this.store.get(k) === null)) this.pick([...new Set(group.map((u) => u.k))]);
    else this.showPick();
    return new Set(group.map((u) => u.k)).size;
  }
  /**
   * Edits made by something on the table rather than a brush (a trap going off). They join one
   * undo step: pass back the step this returned to add later edits to it.
   */
  commit(edits: [key: string, value: unknown][], step: Undo[] = []): Undo[] {
    return this.full ? this.write(edits, step) : step;
  }
  /** As `commit`, for edits anyone may make to what is theirs (a player moving or changing their own mini). */
  write(edits: [key: string, value: unknown][], step: Undo[] = []): Undo[] {
    if (!edits.length) return step;
    if (!this.undoStack.includes(step)) this.undoStack.push(step);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.stamp++;
    this.redoStack.length = 0;
    for (const [k, v] of edits) {
      step.push({ k, prev: this.store.get(k) });
      this.store.set(k, v);
    }
    return step;
  }
  private edit(k: string, v: unknown): void {
    if (!this.build) return; // building is the GM's once a table has one, unless the GM shares it
    const u = { k, prev: this.store.get(k) };
    if (this.batch) this.batch.push(u);
    else this.undoStack.push([u]);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.stamp++;
    this.store.set(k, v);
    if (this.gesture?.touch) buzz(6);
  }

  /** Throw the dice in hand with no finger on the table (a shake of the phone): they appear over `at` and leave at `vel`. */
  toss(at: Vec, vel: Vec): void {
    if (!this.hand.length || this.gesture?.throwing) return; // a finger holding them has the say
    this.dice.hold(this.hand, this.diceColor, new THREE.Vector3(...at));
    this.dice.update(0); // puts them in place, so the throw starts from there
    this.hooks.onThrow(this.dice.holdStarts(), vel);
    this.invalidate();
  }

  /** Where thrown dice should land (the middle of the view) and where the thrower stands. */
  throwSpot(): { target: Vec; cam: Vec; tray: number } {
    // The middle of what a panel leaves of the screen (see setInset); without one, the middle of the screen.
    this.ray.setFromCamera(new THREE.Vector2(-this.inset.right / this.canvas.clientWidth || 0, this.inset.bottom / this.canvas.clientHeight || 0), this.camera);
    const p = this.pickSurface()?.point ?? this.controls.target;
    // Size the invisible dice tray to what this screen shows there (narrow on a portrait phone).
    const half = Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.distanceTo(p);
    const tray = Math.min(6, Math.max(2, half * Math.min(1, this.camera.aspect) * 0.8));
    return { target: [p.x, Math.max(0, p.y), p.z], cam: this.camera.position.toArray(), tray };
  }

  /** Bring a mini to the middle of the view. */
  /** Where a mini is on the screen, in CSS pixels: the middle of its figure, and how tall it looks. */
  spotOf(id: string): { x: number; y: number; size: number } | null {
    const m = this.minis.get(id);
    if (!m || !m.group.visible) return null;
    const h = (m.val.e || 0) + (MINIS[m.val.k]?.height ?? STANDIN_HEIGHT) * (m.val.s || 1);
    const mid = m.group.position.clone().setY(m.group.position.y + h * 0.5).project(this.camera);
    const top = m.group.position.clone().setY(m.group.position.y + h).project(this.camera);
    if (mid.z > 1) return null; // behind the camera
    const w = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    return { x: ((mid.x + 1) / 2) * w, y: ((1 - mid.y) / 2) * ch, size: Math.abs(top.y - mid.y) * ch };
  }
  /**
   * Slide the camera, if it must, so a mini sits between two heights on the screen (CSS pixels
   * from the top): clear of the bar above it and of whatever has opened below.
   */
  keepInView(id: string, top: number, bottom: number): void {
    const m = this.minis.get(id), spot = this.spotOf(id);
    if (!m || !spot || bottom - top < 40) return;
    const want = Math.max(top, Math.min(bottom, spot.y));
    if (Math.abs(want - spot.y) < 2) return;
    // Which spot on the mini's own level is under the place it should be? Move the view by the difference.
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, level = m.group.position.y;
    this.ray.setFromCamera(new THREE.Vector2((spot.x / w) * 2 - 1, 1 - (want / h) * 2), this.camera);
    const under = this.ray.ray.intersectPlane(new THREE.Plane(THREE.Object3D.DEFAULT_UP, -level), new THREE.Vector3());
    this.ray.setFromCamera(new THREE.Vector2((spot.x / w) * 2 - 1, 1 - (spot.y / h) * 2), this.camera);
    const now = this.ray.ray.intersectPlane(new THREE.Plane(THREE.Object3D.DEFAULT_UP, -level), new THREE.Vector3());
    if (!under || !now || under.distanceTo(now) > 40) return;
    const d = now.sub(under);
    this.controls.target.add(d);
    this.camera.position.add(d);
    this.controls.update();
    this.invalidate();
  }
  focusMini(id: string): void {
    const m = this.minis.get(id);
    if (!m || !m.group.visible) return;
    const d = m.target.clone().sub(this.controls.target);
    this.controls.target.add(d);
    this.camera.position.add(d);
    this.invalidate();
  }

  // ---- camera moves and ambient life ---------------------------------------------
  // Both are this device's own business (see glide.ts): nothing is stored or sent.

  /** Where a point on the table is on the screen, in CSS pixels (it may be off it), or null behind the camera. */
  private screen(p: THREE.Vector3): { x: number; y: number } | null {
    this.camera.updateMatrixWorld();
    const v = p.clone().project(this.camera);
    return v.z > 1 ? null : { x: ((v.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - v.y) / 2) * this.canvas.clientHeight };
  }
  /** Is the player busy with the table (a finger down, dice in hand)? Then the camera is theirs alone. */
  private handsOn(): boolean { return this.pointers.size > 0 || this.hand.length > 0; }
  /** Slide the whole view by `d`, smoothly. Any touch on the table stops it where it is (see onDown). */
  private glideBy(d: THREE.Vector3): void {
    if (d.lengthSq() < 1e-4 || d.length() > 2 * LIMIT) return;
    this.glide = new Glide([d.x, d.y, d.z], this.calm ? 0 : 0.5);
    this.swing = null;
    this.invalidate();
  }
  /** Where the camera stands and what it looks at, to the centimetre. */
  view(): { p: Vec; t: Vec } {
    const r = (v: THREE.Vector3): Vec => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
    return { p: r(this.camera.position), t: r(this.controls.target) };
  }
  /** Take up another view, smoothly: stand at `p`, look at `t`. As with any glide, a touch on the table stops it where it is. */
  flyTo(p: unknown, t: unknown): void {
    const v = readView(p, t, LIMIT, this.controls.minDistance, this.controls.maxDistance);
    if (!v || this.handsOn()) return;
    const dt = new THREE.Vector3(...v.t).sub(this.controls.target), dp = new THREE.Vector3(...v.p).sub(this.camera.position).sub(dt);
    if (dt.lengthSq() + dp.lengthSq() < 1e-4) return;
    const seconds = this.calm ? 0 : 0.6;
    this.zoomGoal = null;
    this.glide = new Glide([dt.x, dt.y, dt.z], seconds);
    this.swing = new Glide([dp.x, dp.y, dp.z], seconds);
    this.invalidate();
  }
  /** The turn has passed to a mini: go to it, but only if it is out of view and the player is not busy. */
  private follow(id: string): void {
    const m = this.minis.get(id);
    if (!this.followTurns || !m || !m.group.visible || this.handsOn()) return;
    if (!outOfView(this.screen(m.target), safeArea(this.canvas.clientWidth, this.canvas.clientHeight))) return;
    this.glideBy(m.target.clone().sub(this.controls.target));
  }
  /**
   * This player's own dice have come to rest at these spots: if some lie outside the view (the
   * camera was turned during the roll), slide it just far enough to show them. Other players'
   * throws never move the camera.
   */
  revealDice(at: THREE.Vector3[]): void {
    if (!at.length || this.handsOn()) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, pad = 24;
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }, mid = new THREE.Vector3();
    let lost = false;
    for (const p of at) {
      const s = this.screen(p);
      mid.addScaledVector(p, 1 / at.length);
      if (!s) { lost = true; continue; }
      box.x0 = Math.min(box.x0, s.x - pad); box.x1 = Math.max(box.x1, s.x + pad);
      box.y0 = Math.min(box.y0, s.y - pad); box.y1 = Math.max(box.y1, s.y + pad);
    }
    const [dx, dy] = lost ? [1, 1] : nudge(box, safeArea(w, h));
    if (!dx && !dy) return;
    // Which spot on the dice's own level should come to the middle of the screen? Slide by the difference.
    const level = new THREE.Plane(THREE.Object3D.DEFAULT_UP, -mid.y);
    const under = (x: number, y: number) => {
      this.ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, 1 - (y / h) * 2), this.camera);
      return this.ray.ray.intersectPlane(level, new THREE.Vector3());
    };
    const now = under(w / 2, h / 2), then = lost ? null : under(w / 2 - dx, h / 2 - dy);
    // Behind the camera or over the horizon there is no "just enough": go and look at them.
    if (now && then && now.distanceTo(then) < 40) this.glideBy(then.sub(now));
    else this.glideBy(mid.sub(this.controls.target).setY(0));
  }
  /** Hand out this frame's share of a camera move. True while one is under way. */
  private slide(dt: number): boolean {
    const s = this.glide?.step(dt);
    if (!s) { this.glide = this.swing = null; return false; }
    const c = this.swing?.step(dt) ?? [0, 0, 0];
    this.controls.target.x += s[0]; this.controls.target.y += s[1]; this.controls.target.z += s[2];
    this.camera.position.x += s[0] + c[0]; this.camera.position.y += s[1] + c[1]; this.camera.position.z += s[2] + c[2];
    return true;
  }

  /** Switch ambient motion on or off. Off, everything comes to rest and an idle table draws nothing. */
  setAmbient(on: boolean): void {
    this.ambient = on;
    this.invalidate();
  }
  /** What decides whether the table stirs. `fresh` looks the table over again if it has changed (only done at rest). */
  private ambience(fresh = false): Ambience {
    if (fresh && this.lifeDirty && this.ambient) {
      this.lifeDirty = false;
      this.alive = this.lamps.some((l) => l.visible) || this.stirs();
    }
    return { on: this.ambient, hidden: document.hidden, slowed: this.slowed, alive: this.alive };
  }
  /** Is there a piece in sight with leaves, needles or flame on it? (Each model is looked through once.) */
  private stirs(): boolean {
    for (const g of this.props.values()) {
      if (!g.visible) continue;
      let found = false;
      g.traverse((o) => {
        const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined, kind = geo?.getAttribute('kind');
        if (!geo || !kind || (o as THREE.InstancedMesh).isInstancedMesh) return;
        if (geo.userData.stirs === undefined) {
          geo.userData.stirs = false;
          for (let i = 0; i < kind.count && !geo.userData.stirs; i++) { const k = kind.getX(i); geo.userData.stirs = k === 3 || k === 4 || k === 7; }
        }
        found ||= geo.userData.stirs;
      });
      if (found) return true;
    }
    return false;
  }
  /** Set the breeze and the firelight for the frame about to be drawn (still, if ambience is not live). */
  private breathe(now: number): void {
    const live = ambientLive(this.ambience()), s = now / 1000;
    setWind(live ? s : 0, live ? 1 : 0);
    this.lamps.forEach((lamp, i) => { lamp.intensity = (lamp.userData.base ?? 0) * (live ? flicker(s, i) : 1); });
    this.drawn = now;
    this.frames++;
  }

  // ---- picking ---------------------------------------------------------------

  private aim(e: { clientX: number; clientY: number }, lift = 0): void {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - lift - r.top) / r.height) * 2 + 1), this.camera);
  }

  /** What solid surface is under the pointer: the block hit (if any) and the empty cell in front of it. */
  private pickSurface(): { cell: Vec | null; place: Vec; point: THREE.Vector3 } | null {
    const targets: THREE.Object3D[] = [this.ground];
    if (this.terrainDirty) this.rebuildTerrain();
    if (this.terrain) targets.push(this.terrain.mesh);
    for (const l of this.layers.values()) {
      if (l.dirty) l.rebuild(); // never pick against a stale mesh
      for (const w of l.swarms) if (w.mesh.count) targets.push(w.mesh);
    }
    const hit = this.ray.intersectObjects(targets, false)[0];
    if (!hit) return null;
    if (hit.object === this.ground) {
      const place: Vec = [Math.floor(hit.point.x), 0, Math.floor(hit.point.z)];
      return Math.abs(place[0]) < LIMIT && Math.abs(place[2]) < LIMIT ? { cell: null, place, point: hit.point } : null;
    }
    if (this.terrain && hit.object === this.terrain.mesh) {
      // Ground: touching its top builds on it; touching a cut face builds beside it, at the height touched.
      const cell = this.terrain.cells[hit.faceIndex!];
      if (!this.terrain.side[hit.faceIndex!]) return { cell, place: [cell[0], cell[1] + 1, cell[2]], point: hit.point };
      const out = hit.face!.normal;
      return { cell, place: [cell[0] + Math.round(out.x), Math.max(0, Math.min(cell[1], Math.floor(hit.point.y))), cell[2] + Math.round(out.z)], point: hit.point };
    }
    const key = (hit.object.userData.swarm as Swarm).keys[hit.instanceId!];
    if (!key) return null;
    const cell = parse(key);
    // Which side of the cell was touched: judged from where the finger landed, since
    // modelled blocks have bevels and details whose faces point every which way.
    const off = [hit.point.x - cell[0] - 0.5, hit.point.y - cell[1] - 0.5, hit.point.z - cell[2] - 0.5];
    const axis = off.reduce((best, v, i) => (Math.abs(v) > Math.abs(off[best]) ? i : best), 0);
    const place: Vec = [cell[0], cell[1], cell[2]];
    place[axis] += Math.sign(off[axis]) || 1;
    return { cell, place, point: hit.point };
  }

  private pickProp(): { key: string; dist: number } | null {
    const hit = this.ray.intersectObjects([...this.props.values()].filter((g) => g.visible), true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.cell) o = o.parent;
    return o ? { key: o.userData.cell, dist: hit.distance } : null;
  }

  private pickMini(): string | null {
    if (this.visDirty) this.refreshMinis();
    const hit = this.ray.intersectObjects([...this.minis.values()].filter((m) => m.group.visible).map((m) => m.group), true)[0];
    if (!hit) return null;
    const surf = this.pickSurface();
    if (surf && surf.point.distanceTo(this.ray.ray.origin) < hit.distance - 0.01) return null; // hidden behind terrain
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.mini) o = o.parent;
    return o?.userData.mini ?? null;
  }

  private isBlock(x: number, y: number, z: number): boolean {
    const v = this.store.get<CellVal>(ck(x, y, z));
    return !!v && !!BLOCKS[v.i];
  }

  /** Where a mini would stand if dropped under the pointer (never somewhere this player cannot see). */
  private standing(): Vec | null {
    const s = this.pickSurface();
    if (!s) return null;
    let [x, y, z] = s.place;
    if (!this.full && fogged(this.store, x, z)) return null;
    while (y > 0 && !this.isBlock(x, y - 1, z)) y--;
    return [x, y, z];
  }

  // ---- pointer input -----------------------------------------------------------

  private onDown(e: PointerEvent): void {
    // A first finger coming down means no other finger is on the glass. One we still count was
    // lifted where we could not see it (over a page that had opened, or taken by the phone):
    // forget it, or every touch from now on would read as a second finger and move only the camera.
    if (e.isPrimary && this.pointers.size) { this.pointers.clear(); this.abortGesture(); }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.zoomGoal = this.glide = null; // a finger on the table always wins over a camera move
    if (this.pointers.size > 1) {
      // A second finger means a camera gesture, never an edit.
      const claimed = !this.controls.enabled;
      this.abortGesture();
      // The first finger was ours (dragging a mini, holding dice), so the camera never saw it
      // land: hand it over now, or the pinch reads as a one-finger drag.
      if (claimed) this.handToCamera(e.pointerId);
      this.twist = this.twistAngle();
      this.twistSlack = 0.14;
      return;
    }
    const touch = e.pointerType !== 'mouse';
    const g: Gesture = {
      id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, touch, moved: false, done: false,
      mini: null, tapMini: null, throwing: null, measure: null, first: null, stroke: null,
      drags: this.tool === 'ruler' || this.tool === 'fog' || this.copying || this.rooming || (touch && this.tool !== 'move'),
    };
    this.gesture = g;
    if (e.button !== 0) return;
    if (this.hand.length || this.boulderArmed) {
      // Dice in hand (or a boulder ready): this finger holds them over the table until it lets go.
      g.throwing = [];
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
      this.hooks.onGrab();
      const at = this.holdPoint(e, g);
      if (at && this.boulderArmed) this.boulder.hold(at);
      else if (at) this.dice.hold(this.hand, this.diceColor, at);
      return;
    }
    this.aim(e);
    switch (this.tool) {
      case 'move': case 'pick': {
        if (this.areaPick && this.tool === 'pick') { // an area is being dragged out: the finger picks nothing up
          const s = this.pickSurface();
          g.area = true;
          g.first = s && s.place;
          this.canvas.setPointerCapture(e.pointerId);
          break;
        }
        if (this.placing && this.selection().length) { // Move was tapped: this touch says where the selection goes
          this.grab = null;
          g.piece = true;
          this.controls.enabled = false;
          this.canvas.setPointerCapture(e.pointerId);
          this.carryGhost();
          break;
        }
        const id = this.shoving ? null : this.pickMini(); // waiting for a direction: this touch points, it does not pick up
        if (id && this.picked.includes(`m:${id}`)) this.holdPicked(g, e); // one of the picked: they all come along
        else if (id && !this.aimed && this.hooks.canMove(id)) { // (while aiming, a tap on a mini picks a target: nothing is dragged)
          g.mini = id;
          this.controls.enabled = false;
          this.canvas.setPointerCapture(e.pointerId);
        } else if (id) g.tapMini = id; // someone else's: tap to look at it, but it stays put
        else if (this.tool === 'pick') {
          // A finger on the selection carries it; anywhere else it is the camera's (and a tap selects).
          const t = this.picked.length ? this.pickTarget() : null;
          if (t && (this.picked.includes(t) || this.overPicked())) this.holdPicked(g, e);
        } else {
          // Press and hold on the table to ping the spot for everyone.
          const at = { clientX: e.clientX, clientY: e.clientY };
          g.press = setTimeout(() => {
            if (this.gesture !== g || g.moved || this.pointers.size !== 1) return;
            this.aim(at);
            const s = this.pickSurface();
            if (!s) return;
            g.done = true;
            buzz(15);
            this.hooks.onPing([+s.point.x.toFixed(2), +s.point.y.toFixed(2), +s.point.z.toFixed(2)]);
          }, LONG_PRESS);
        }
        break;
      }
      case 'ruler': {
        const p = this.standing();
        g.measure = p && [p[0] + 0.5, p[1], p[2] + 0.5];
        this.canvas.setPointerCapture(e.pointerId);
        break;
      }
      case 'fog':
        this.canvas.setPointerCapture(e.pointerId);
        break;
      default:
        if (this.copying) {
          const s = this.pickSurface();
          g.first = s && (s.cell ?? s.place);
          this.canvas.setPointerCapture(e.pointerId);
          break;
        }
        if (this.rooming) {
          g.first = this.pickSurface()?.place ?? null;
          this.canvas.setPointerCapture(e.pointerId);
          break;
        }
        if (this.pouring) g.from = this.pourSpot();
        if (!touch) break;
        // No hover on touch: show where the edit will land as soon as the finger is down.
        this.updateGhost();
        if (this.pasting || this.pouring) break;
        if (this.edging) { g.edge = this.pickEdge(); break; }
        if (this.shaping || this.lighting) break;
        if (this.erasing) { const t = this.eraseTarget(); g.wipe = !!t?.startsWith('l:'); g.first = t && !/^[wl]:/.test(t) ? parse(t) : null; }
        else if (this.tool === 'build') g.first = this.pickSurface()?.place ?? null;
    }
  }

  /** A finger came down on the picked pieces: it carries them. */
  private holdPicked(g: Gesture, e: PointerEvent): void {
    const b = boundsOf(this.store, this.picked), pt = b && this.onLevel(b.min[1]);
    this.grab = pt ? [Math.floor(pt.x), 0, Math.floor(pt.z)] : null;
    g.piece = true;
    this.controls.enabled = false;
    this.canvas.setPointerCapture(e.pointerId);
  }
  /** Several pieces are picked and the pointer is on the ground among them: an area is held by any part of it. */
  private overPicked(): boolean {
    const b = this.picked.length > 1 ? boundsOf(this.store, this.picked) : null, c = this.pickSurface()?.place;
    return !!b && !!c && c[0] >= b.min[0] && c[0] <= b.max[0] && c[2] >= b.min[2] && c[2] <= b.max[2] && c[1] >= b.min[1] && c[1] <= b.max[1] + 1;
  }

  /** Replay the other fingers' pointerdown to OrbitControls (it ignores pointers that land while it is disabled). */
  private handToCamera(except: number): void {
    const c = this.controls as unknown as { _pointers: number[]; _onPointerDown(e: object): void };
    for (const [id, p] of this.pointers) {
      if (id === except || c._pointers.includes(id)) continue;
      c._onPointerDown({ pointerId: id, pointerType: 'touch', button: 0, clientX: p.x, clientY: p.y, pageX: p.x + scrollX, pageY: p.y + scrollY });
    }
  }

  private twistAngle(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (this.pointers.size === 2 && e.pointerType !== 'mouse') {
      // Two-finger twist turns the table (pinch and pan are handled by OrbitControls).
      const a = this.twistAngle();
      let d = a - this.twist;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.twist = a;
      if (this.twistSlack > 0) { // still inside the wobble of an ordinary pinch
        this.twistSlack -= Math.abs(d);
        return;
      }
      const t = this.controls.target;
      this.camera.position.sub(t).applyAxisAngle(THREE.Object3D.DEFAULT_UP, d).add(t);
      return;
    }
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) {
      if (e.pointerType === 'mouse' && !e.buttons) { this.aim(e); this.updateGhost(); }
      return;
    }
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) > (g.touch ? 12 : 6)) g.moved = true;
    if (g.done) return;
    if (g.throwing) {
      const at = this.holdPoint(e, g);
      if (at) { this.dice.moveHold(at); this.boulder.moveHold(at); }
      return;
    }
    if (g.mini) {
      if (!g.moved) return;
      this.aim(e, g.touch ? TOUCH_LIFT : 0);
      const pos = this.standing();
      const m = this.minis.get(g.mini);
      if (!pos || !m) return;
      this.dragPos = pos;
      m.target.set(pos[0] + 0.5, pos[1] + 0.3, pos[2] + 0.5);
      // How far it has come, shown while it is carried: no ruler needed to count a move.
      if (this.lastDrag !== pos.join()) {
        this.lastDrag = pos.join();
        const far = pos[0] !== m.val.x || pos[2] !== m.val.z;
        this.showRuler('drag', far ? { a: [m.val.x + 0.5, m.val.y, m.val.z + 0.5], b: [pos[0] + 0.5, pos[1], pos[2] + 0.5], m: 'line' } : null, m.val.c);
      }
      if (performance.now() - this.lastLive > 180) {
        this.lastLive = performance.now();
        this.hooks.onLiveMove(g.mini, pos);
      }
      return;
    }
    if (g.piece) {
      if (!g.moved && !this.placing) return;
      this.aim(e, g.touch && g.moved && this.selection().length === 1 ? TOUCH_LIFT : 0); // (one piece floats clear of the fingertip; an area stays under it)
      this.carryGhost();
      return;
    }
    if (g.area) { this.aim(e); this.stretchArea(g, false); return; }
    if (!g.drags || g.button !== 0 || this.sampling) return;
    this.aim(e);
    if (this.tool === 'ruler') this.stretchRuler(g, false);
    else if (this.tool === 'fog') { if (g.moved) this.paintFog(); }
    else if (this.copying) this.stretchCopy(g, false);
    else if (this.rooming) this.stretchRoom(g, false);
    else if (this.edging) { if (g.moved) this.paintEdges(g); }
    else if (this.shaping) { if (g.moved) { this.shape(g); this.updateGhost(); } }
    else if (this.tool === 'mini' || this.pasting || this.pouring) this.updateGhost();
    else if (g.wipe) { if (g.moved) this.wipe(g); }
    else if (this.tool === 'build' && g.moved) this.paint(g);
  }

  private stretchRuler(g: Gesture, final: boolean): void {
    const p = this.standing();
    if (!g.measure || !p) return;
    const r: Ruler = { a: g.measure, b: [p[0] + 0.5, p[1], p[2] + 0.5], m: this.rulerMode };
    this.showRuler('me', r, this.diceColor);
    if (final || performance.now() - this.lastRuler > 150) {
      this.lastRuler = performance.now();
      this.hooks.onRuler(r);
    }
  }

  /** Fog is painted per column: it hides everything from the floor up. */
  private paintFog(): void {
    const s = this.pickSurface();
    const c = s && (s.cell ?? s.place);
    if (!c) return;
    const key = `f:${c[0]},${c[2]}`;
    if ((this.store.get(key) === true) === this.fogHide) return;
    if (!this.batch) { this.batch = []; this.undoStack.push(this.batch); }
    this.edit(key, this.fogHide ? true : null);
  }

  /**
   * A tap with the fog tool hides or reveals the whole room under the finger (`regions`), as
   * one step of undo. On open ground, where there is no room to speak of, it is one column.
   */
  private tapFog(): void {
    const s = this.pickSurface();
    if (!s || !this.full) { this.hooks.onFog?.(0, this.fogHide, false); return; }
    const room = regions(this.store, ...s.place), c = s.cell ?? s.place;
    const keys = (room ?? [[c[0], c[2]]]).map(([x, z]) => `f:${x},${z}`).filter((k) => (this.store.get(k) === true) !== this.fogHide);
    if (keys.length) this.editAll(keys.map((k) => [k, this.fogHide ? true : null]));
    this.hooks.onFog?.(keys.length, this.fogHide, !!room);
  }

  /** Dragging a finger paints (or erases) a flat layer at the height of the first cell. */
  private paint(g: Gesture): void {
    if (!g.first) return;
    const build = !this.erasing;
    if (!g.stroke) {
      const prop = !build && !!PROPS[this.store.get<CellVal>(ck(...g.first))?.i ?? ''];
      g.stroke = { level: g.first[1], plane: g.first[1] + (build ? 0 : prop ? 0.3 : 1) };
      this.batch = [];
      this.undoStack.push(this.batch);
      this.paintCell(g.first, build);
    }
    const pt = this.ray.ray.intersectPlane(new THREE.Plane(THREE.Object3D.DEFAULT_UP, -g.stroke.plane), new THREE.Vector3());
    if (!pt || pt.distanceTo(this.camera.position) > 120) return;
    this.paintCell([Math.floor(pt.x), g.stroke.level, Math.floor(pt.z)], build);
  }

  private paintCell(c: Vec, build: boolean): void {
    if (Math.abs(c[0]) >= LIMIT || Math.abs(c[2]) >= LIMIT || c[1] < 0 || c[1] >= MAX_Y) return;
    const key = ck(...c);
    const has = this.store.get(key) !== null;
    if (build && !has) this.edit(key, this.brushValue());
    else if (!build && has) this.edit(key, null);
    this.ghost.position.set(c[0] + 0.5, c[1], c[2] + 0.5);
    this.invalidate();
  }

  private brushValue(): CellVal {
    const v: CellVal = { i: this.brush };
    if (PROPS[this.brush] && this.rot) v.r = this.rot;
    return v;
  }

  private updateGhost(): void {
    this.hideGhost();
    if (this.offered) { this.markOffer(); return; }
    if ((this.tool !== 'build' && this.tool !== 'mini') || this.copying || this.rooming || this.lighting) return;
    if (this.edging) {
      const e = this.pickEdge();
      if (e) this.edgeGhost(e, '#ffffff');
      return;
    }
    if (this.shaping) { // a flat patch on the ground, as wide as the brush reaches
      const at = this.pickColumn();
      if (!at) return;
      const w = this.reach * 2 + 1, y = (columnTop(this.store, at[0], at[1])?.y ?? -1) + 1;
      (this.ghost.material as THREE.MeshBasicMaterial).color.set('#ffe066');
      this.ghost.scale.set(w, 0.12, w);
      this.ghost.position.set(at[0] + 0.5, y, at[1] + 0.5);
      this.ghost.visible = true;
      this.invalidate();
      return;
    }
    const mat = this.ghost.material as THREE.MeshBasicMaterial;
    if (this.pasting) {
      const p = this.pickSurface()?.place;
      if (!p) return;
      const [w, h, d] = this.slabSize();
      mat.color.set('#58d6e8');
      this.ghost.scale.set(w, h, d);
      this.ghost.position.set(p[0] + w / 2, p[1], p[2] + d / 2);
    } else if (this.erasing) {
      const t = this.eraseTarget();
      if (!t) return;
      if (t.startsWith('w:')) { this.edgeGhost(parseEdge(t), '#ff5a5a'); return; }
      const lp = t.startsWith('l:') ? this.loose.pieces.get(t.slice(2))?.p : null;
      const [x, y, z] = lp ? [lp[0] - 0.5, lp[1] - 0.25, lp[2] - 0.5] : parse(t);
      mat.color.set('#ff5a5a');
      this.ghost.scale.setScalar(lp ? 0.5 : 1.04);
      this.ghost.position.set(x + 0.5, y - 0.02, z + 0.5);
    } else {
      const p = this.tool === 'mini' ? this.standing() : this.pickSurface()?.place;
      if (!p || p[1] >= MAX_Y) return;
      mat.color.set('#ffffff');
      this.ghost.scale.set(1, this.tool === 'mini' ? 0.15 : 1, 1);
      this.ghost.position.set(p[0] + 0.5, p[1], p[2] + 0.5);
    }
    this.ghost.visible = true;
    this.invalidate();
  }

  private eraseTarget(): string | null {
    const s = this.pickSurface(), far = s ? s.point.distanceTo(this.ray.ray.origin) : Infinity;
    const p = this.pickProp(), w = this.pickWall();
    if (w && w.dist <= far && (!p || w.dist <= p.dist)) return w.key;
    if (p && p.dist <= far) return p.key;
    const l = this.looseAt()[0]; // lying on the ground or on a block: they go before what they lie on
    if (l) return l;
    return s?.cell ? ck(...s.cell) : null;
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    this.gesture = null;
    clearTimeout(g.press);
    if (g.done) return;
    if (g.throwing) {
      this.controls.enabled = true;
      this.holdPoint(e, g);
      // The fling is how far the hand travelled over the last ~120 ms.
      const s = g.throwing, last = s[s.length - 1];
      const from = s.find((x) => last.t - x.t <= 120) ?? last;
      const dt = Math.max((last?.t - from?.t) / 1000, 0.03);
      const vel: Vec = last && from !== last ? [(last.p.x - from.p.x) / dt, 0, (last.p.z - from.p.z) / dt] : [0, 0, 0];
      const rock = this.boulder.holdAt();
      if (rock && this.boulderArmed && last) {
        // A slow, deliberate drag counts as well as a flick (and is all a struggling phone can measure):
        // the push is then along the drag, harder the longer it was.
        const drag = last.p.clone().sub(s[0].p).setY(0).multiplyScalar(2);
        this.hooks.onBoulder(rock, Math.hypot(vel[0], vel[2]) >= drag.length() ? vel : [drag.x, 0, drag.z]);
        return;
      }
      const starts = this.dice.holdStarts();
      if (starts.length) this.hooks.onThrow(starts, vel);
      return;
    }
    if (g.mini) {
      this.controls.enabled = true;
      const m = this.minis.get(g.mini);
      const p = this.dragPos;
      this.dragPos = null;
      if (m && g.moved && p) {
        this.landing = g.mini;
        // Set down over a drop, it falls.
        const l = land(this.store, { ...m.val, x: p[0], y: p[1], z: p[2] });
        this.write([[`m:${g.mini}`, l.v]]);
        if (l.fell) this.hooks.onFall(g.mini, l.fell);
      }
      else if (m) m.target.set(m.val.x + 0.5, m.val.y, m.val.z + 0.5);
      this.endDrag();
      this.select(g.mini);
      return;
    }
    if (g.piece) {
      this.controls.enabled = true;
      const placing = this.placing;
      this.placing = false;
      if (g.moved || placing) {
        this.aim(e, g.touch && g.moved && this.selection().length === 1 ? TOUCH_LIFT : 0);
        const d = this.carry();
        if (!d || !this.movePicked(d)) buzz(20); // no room there: it stays where it was
      }
      this.hideGhost();
      this.hooks.onPick?.(this.picked);
      return;
    }
    if (g.button !== 0) return;
    this.aim(e);
    if (g.area) { this.stretchArea(g, true); return; }
    if (this.tool === 'ruler') {
      // A drag measures and leaves the ruler out; a tap puts it away.
      if (g.moved) this.stretchRuler(g, true);
      else { this.showRuler('me', null, ''); this.hooks.onRuler(null); }
      return;
    }
    if (this.tool === 'fog') {
      if (g.moved) this.paintFog(); // a drag has been painting all along
      else this.tapFog(); // a tap takes the whole room
      this.batch = null;
      return;
    }
    if (this.copying) { this.stretchCopy(g, true); return; }
    if (this.rooming) { this.stretchRoom(g, true); return; }
    if (g.stroke) { // the drag already did the editing
      this.batch = null;
      this.hideGhost();
      return;
    }
    // A moved pointer was a camera drag, except a finger sliding a mini's landing spot.
    if (g.moved && !(g.touch && (this.tool === 'mini' || this.pasting || this.pouring))) { this.hideGhost(); return; }
    this.gesture = g; // so edit() knows whether to give haptic feedback
    switch (this.tool) {
      case 'move': {
        if (this.shoving) { this.pointShove(); break; }
        if (!this.aimed) {
          this.select(g.tapMini);
          this.offer(g.tapMini ? null : this.breakTarget()); // a tap on a wall or a thing offers to break it
          break;
        }
        const at = g.tapMini ? null : this.pickSurface()?.point;
        const target: string | Vec | null = g.tapMini ?? (at ? [Math.round(at.x * 2) / 2, Math.round(at.y * 2) / 2, Math.round(at.z * 2) / 2] : null);
        if (target) this.aimed(target);
        break;
      }
      case 'build': {
        if (this.sampling) {
          const t = this.pickMini();
          const key = t ? `m:${t}` : this.pickTarget();
          this.sampling = false;
          if (key) this.onSample(key);
          break;
        }
        if (this.pasting) {
          const at = this.pickSurface()?.place;
          if (at) this.pasteAt(at);
          break;
        }
        if (this.brush === 'paste') break;
        if (this.pouring) {
          const to = this.pourSpot(), from = g.touch && g.moved ? g.from ?? to : to;
          if (from && to) this.hooks.onPour?.(from, to);
          break;
        }
        if (this.edging) {
          const edge = this.pickEdge();
          if (edge) this.setEdge(edge);
          break;
        }
        if (this.shaping) {
          this.shape(g);
          this.batch = null;
          break;
        }
        if (this.lighting) { this.stepLight(); break; }
        if (this.erasing) {
          const t = this.eraseTarget();
          if (t?.startsWith('l:') && this.build) this.write(this.looseAt().map((k) => [k, null]));
          else if (t) this.edit(t, null);
          break;
        }
        const p = this.pickSurface()?.place;
        if (p && p[1] >= 0 && p[1] < Math.min(MAX_Y, this.cut)) this.edit(ck(...p), this.brushValue());
        break;
      }
      case 'mini': {
        const p = this.standing();
        if (!p || !this.build) break;
        const id = crypto.randomUUID().slice(0, 12);
        this.edit(`m:${id}`, { ...this.hooks.newMini(), x: p[0], y: p[1], z: p[2] });
        break;
      }
      case 'pick': {
        if (g.tapMini) { this.select(g.tapMini); break; }
        const t = this.build ? this.pickTarget() : null;
        this.select(null);
        this.pick(t ? [t] : []);
        break;
      }
    }
    this.gesture = null;
    if (g.touch) this.hideGhost();
    else this.updateGhost();
    this.markOffer();
  }

  /** Drop whatever the current pointer was doing (second finger landed, or the OS took over). */
  private abortGesture(): void {
    const g = this.gesture;
    this.gesture = null;
    this.batch = null;
    this.dragPos = null;
    this.controls.enabled = true;
    this.hideGhost();
    this.marquee.visible = false;
    clearTimeout(g?.press);
    const m = g?.mini ? this.minis.get(g.mini) : null;
    if (m) m.target.set(m.val.x + 0.5, m.val.y, m.val.z + 0.5);
    this.endDrag();
    if (g?.throwing) { this.dice.endHold(); this.boulder.endHold(); } // back in the hand
  }

  /** A carried mini was set down or let go of: its distance line goes. */
  private endDrag(): void {
    this.lastDrag = '';
    if (this.rulers.has('drag')) this.showRuler('drag', null, '');
  }

  /** Where held dice hover for this pointer: above the surface under it (and above the fingertip). */
  private holdPoint(e: PointerEvent, g: Gesture): THREE.Vector3 | null {
    this.aim(e, g.touch ? TOUCH_LIFT : 0);
    let p = this.pickSurface()?.point ?? this.ray.ray.intersectPlane(new THREE.Plane(THREE.Object3D.DEFAULT_UP, 0), new THREE.Vector3());
    if (!p || p.distanceTo(this.camera.position) > 120) {
      // A finger on the sky, or far past the table with the camera low: the dice must still come to
      // hand, so they hover out that way, as far as an arm would reach.
      const cam = this.camera.position, d = this.ray.ray.direction, flat = new THREE.Vector3(d.x, 0, d.z);
      if (flat.lengthSq() < 1e-6) return null;
      p = new THREE.Vector3(cam.x, 0, cam.z).addScaledVector(flat.normalize(), 40);
    }
    const at = p.clone().setY(Math.max(0, p.y) + 1.5);
    g.throwing!.push({ t: performance.now(), p: at });
    if (g.throwing!.length > 24) g.throwing!.shift();
    return at;
  }

  // ---- frame ---------------------------------------------------------------------

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.look?.setSize(w, h, this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.inset.bottom || this.inset.right) this.camera.setViewOffset(w, h, this.inset.right / 2, this.inset.bottom / 2, w, h);
    else if (this.camera.view) this.camera.clearViewOffset();
    this.invalidate();
  }

  /**
   * Keep the camera moving smoothly on weak phones: if frames keep taking too
   * long while something is moving, render at a lower resolution, and as a last
   * resort drop shadows. It never steps back up, so quality does not flicker.
   */
  private adapt(frameMs: number): void {
    this.slow = frameMs > 34 ? this.slow + 1 : Math.max(0, this.slow - 2);
    if (this.slow < 24 || this.quality >= 3) return;
    this.slow = 0;
    this.slowed = true;
    if (this.look) { // the finished look goes first: it is the most work for the least loss
      if (++this.lookLevel >= 2) this.look = null;
      else this.look.setLevel(this.lookLevel);
      this.invalidate();
      return;
    }
    this.quality++;
    const base = Math.min(devicePixelRatio, 2);
    if (this.quality === 3) this.renderer.shadowMap.enabled = false;
    else this.renderer.setPixelRatio(Math.max(1, base * (this.quality === 1 ? 0.75 : 0.5)));
    if (this.quality === 3) this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    this.resize();
  }

  private frame(): void {
    const now = performance.now();
    const elapsed = now - this.last;
    const dt = Math.min(elapsed / 1000, 0.1);
    this.last = now;
    // An ambient frame that holds up the next one is more than this device can spare: after a few, stop.
    if (this.stirred) {
      this.stirSlow = elapsed > 40 ? this.stirSlow + 1 : Math.max(0, this.stirSlow - 1);
      if (this.stirSlow >= 6) this.slowed = true;
      this.stirred = false;
    }
    const slid = this.slide(dt);
    let moving = this.controls.update() || slid;
    if (this.zoomGoal !== null) {
      const t = this.controls.target, dist = this.camera.position.distanceTo(t);
      const next = Math.abs(this.zoomGoal - dist) < 0.01 ? this.zoomGoal : dist + (this.zoomGoal - dist) * (1 - Math.exp(-dt * 16));
      this.camera.position.sub(t).setLength(next).add(t);
      if (next === this.zoomGoal) this.zoomGoal = null;
      moving = true;
    }
    // Things that change the table (and so its shadows), as opposed to the view of it.
    let changed = this.shadowDirty;
    if (this.dice.update(dt)) changed = true;
    if (this.boulder.update(dt)) changed = true;
    if (this.feel(dt)) changed = true;
    if (this.animate(dt)) changed = true;
    if (this.wobble(dt)) changed = true;
    if (this.debris.update(dt)) this.dirty = true; // drawn, but it casts no shadow to redraw
    if (this.loose.update(dt)) changed = true;
    if (this.fogDirty) { this.rebuildFog(); changed = true; }
    if (this.visDirty) { this.refreshMinis(); changed = true; }
    if (this.terrainDirty) { this.rebuildTerrain(); changed = true; }
    for (const l of this.layers.values()) if (l.dirty) { l.rebuild(); changed = true; }
    if (this.edgesDirty) { this.rebuildEdges(); changed = true; }
    if (this.coverDirty) { this.rebuildCover(); changed = true; }
    if ((changed || this.controls.target.distanceToSquared(this.litAt) > 4) && this.relight()) changed = true;
    if (this.travel(dt)) changed = true;
    // Standees (standee.ts) are drawn a page of pictures at a time: tell the pages where their cards stand now.
    if (changed && standees.any) {
      standees.begin();
      for (const g of this.props.values()) standees.add(g);
      for (const m of this.minis.values()) standees.add(m.group, this.full && m.val.h ? 0.5 : 1);
      standees.end(this.scene);
    }
    let busy = moving || changed || this.dirty;
    if (this.shots.update(dt)) busy = true; // in the air, they cast no shadow: the table itself is unchanged
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const p = this.pings[i];
      p.t += dt;
      const s = 1 + ((p.t * 1.6) % 1) * 2.2;
      p.mesh.scale.set(s, 1, s);
      (p.mesh.material as THREE.Material).opacity = Math.max(0, 1 - p.t / 2.4);
      if (p.t > 2.4) {
        this.scene.remove(p.mesh);
        this.pings.splice(i, 1);
      }
      busy = true;
    }
    // Idle tables cost no GPU time (and no battery) — unless ambience is on and there are leaves
    // or flames to stir, and then only a few frames a second, with no shadows or labels redone.
    const stir = !busy;
    if (stir && !ambientDue(this.ambience(true), now, this.drawn)) { this.wasBusy = false; return; }
    if (this.wasBusy && !stir) this.adapt(elapsed); // only judge frames that follow another drawn frame
    this.wasBusy = !stir; // (an ambient frame is late on purpose: it must not count as a slow one)
    this.stirred = stir;
    this.breathe(now);
    this.dirty = false;
    // The sun follows the camera target in coarse steps, so panning rarely moves the shadows.
    const t = this.controls.target, sx = Math.round(t.x / 6) * 6, sz = Math.round(t.z / 6) * 6;
    if (sx !== this.sunAt.x || sz !== this.sunAt.z) {
      this.sunAt.set(sx, 0, sz);
      this.sun.position.copy(this.sunAt).add(SUN_OFFSET);
      this.sun.target.position.copy(this.sunAt);
      changed = true;
    }
    if (changed) this.renderer.shadowMap.needsUpdate = true;
    this.shadowDirty = false;
    if (this.look) {
      this.camera.layers.set(0);
      this.look.render(this.camera.position.distanceTo(this.controls.target));
      // Then the labels and aids, straight onto the finished picture.
      this.camera.layers.set(OVERLAY);
      // (A scene with a background colour wipes the picture before drawing, so it goes without one for this pass.)
      const sky = this.scene.background;
      this.scene.background = null;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = true;
      this.scene.background = sky;
    }
    this.camera.layers.enable(0);
    this.camera.layers.enable(OVERLAY);
    if (!this.look) this.renderer.render(this.scene, this.camera);
    if (!stir) this.hooks.onView();
    if (this.offered) this.onOffer(this.offered); // its button follows the piece across the screen
  }
  private wasBusy = false;
}
