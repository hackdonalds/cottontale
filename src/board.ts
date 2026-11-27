// The 3D table: renders the shared Store and turns pointer input into edits.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BLOCKS, MINIS, PROPS, makeMini, makeProp } from './catalog';
import { KIT, TINT_COLORS, WILD, kit, kitPending, onKitPack, rand, setSeason, withDetail, type Season } from './kit';
import { GROUND, buildTerrain, type Column, type Terrain } from './terrain';
import { DiceView, type Kind, type Start } from './dice';
import { EDGES, columnTop, ek, eyesOf, fogged, grow, levelTo, measure, miniShown, parseEdge, resurface, roomEdges, sculpt, type CellVal, type EdgeVal, type MiniVal, type Side } from './rules';
import type { Store } from './store';
import { Look } from './look';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type { CellVal, MiniVal };
export type Tool = 'move' | 'build' | 'mini' | 'ruler' | 'fog';
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
  /** The local ruler changed (null = put away). Called often while measuring. */
  onRuler(r: Ruler | null): void;
  /** An area was copied with the copy brush. */
  onSlab(slab: Slab): void;
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
class Swarm {
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
  /** Shaping the land: the columns this stroke has already touched (each changes once a stroke). */
  shaped?: Set<string>;
  /** Drawing a wall: the edge the finger started on. The run stays in line with it. */
  edge?: Edge | null;
  press?: ReturnType<typeof setTimeout>;
}
const TOUCH_LIFT = 44; // px a dragged mini floats above the fingertip so it stays visible
const LONG_PRESS = 550;

interface Mini { group: THREE.Group; target: THREE.Vector3; val: MiniVal; sig: string }

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
  return s;
}

/** Name plate with an optional hit-point bar, floating over a mini. */
function plate(v: MiniVal): THREE.Sprite {
  const bar = typeof v.mhp === 'number' && v.mhp > 0;
  const s = textSprite((g) => {
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
      const f = Math.max(0, Math.min(1, (v.hp ?? 0) / v.mhp!));
      g.fillStyle = 'rgba(15,17,23,.85)';
      g.beginPath();
      g.roundRect(38, 56, 180, 30, 10);
      g.fill();
      g.fillStyle = f > 0.5 ? '#46a758' : f > 0.25 ? '#f2a33a' : '#e5484d';
      g.beginPath();
      g.roundRect(42, 60, Math.max(8, 172 * f), 22, 7);
      g.fill();
      g.fillStyle = '#fff';
      g.font = '700 20px system-ui, sans-serif';
      g.fillText(`${v.hp ?? 0}/${v.mhp}`, 128, 72);
    }
  }, 256, 96, 1.6);
  s.visible = !!v.n || bar;
  return s;
}

/** `spill`: how far fire and magic glow into the picture; `sheen`: how much of the room shows in polished things. */
const SKIES: Record<Sky, { bg: string; sun: string; sunI: number; hemi: string; hemiI: number; spill: number; sheen: number }> = {
  day: { bg: '#100e0d', sun: '#ffdcae', sunI: 3.9, hemi: '#a9bdea', hemiI: 0.85, spill: 0.14, sheen: 0.32 },
  dusk: { bg: '#120b0f', sun: '#ff9a58', sunI: 2.3, hemi: '#b79fc9', hemiI: 0.55, spill: 0.3, sheen: 0.2 },
  night: { bg: '#05060b', sun: '#8fb0ff', sunI: 0.75, hemi: '#6f84c6', hemiI: 0.32, spill: 0.44, sheen: 0.08 }, // dark enough for torches to matter
};

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
  readonly dice: DiceView;
  /** Dice picked up and waiting to be thrown: while set, a drag on the table throws them. */
  hand: Kind[] = [];
  diceColor = '#ffffff';
  /** Cutaway: blocks, props and minis at this height or above are not drawn (Infinity = show all). */
  cut = Infinity;

  private me = '';
  private full = true;
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
  /** How strongly fires, torches and crystals light the table: the GM's dial, 0 (out) to 2. */
  private glow = 1;
  private litAt = new THREE.Vector3(1e9, 0, 0);
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private ground: THREE.Mesh;
  private layers = new Map<string, Layer>();
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
  private marquee: THREE.Mesh;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private twist = 0;
  /** A pinch always wobbles a little: only start turning once the fingers have clearly twisted. */
  private twistSlack = 0;
  private zoomGoal: number | null = null;
  private shadowDirty = true;
  /** Ground cover (tufts, flowers, pebbles): not stored anywhere, grown from the lie of the land. */
  private cover: { tuft: Swarm[]; flower: Swarm[]; pebble: Swarm[] } | null = null;
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
  private lastLive = 0;
  private lastRuler = 0;
  private undoStack: Undo[][] = [];
  private redoStack: Undo[][] = [];
  private batch: Undo[] | null = null;
  private dirty = true;
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
    this.scene.fog = new THREE.Fog('#000', 60, 170);
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
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#2a2420'; // a dark table top: the scene is the bright thing on it
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#463c35';
    g.lineWidth = 6; // half of it falls outside the tile, leaving a 3px line per edge
    g.strokeRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.setScalar(LIMIT * 2);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(LIMIT * 2, LIMIT * 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }),
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
    this.scene.add(this.ghost, this.marquee);

    this.camera.position.set(7, 9, 11);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 90;
    this.controls.target.set(0, 0, 0);
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

    const hidden = (x: number, y: number, z: number) => this.cellHidden(x, y, z);
    // Ground under the smooth surface is not drawn as cubes as well.
    const buried = (x: number, y: number, z: number) => {
      const top = this.columns.get(`${x},${z}`);
      return this.cellHidden(x, y, z) || (!!top && !!GROUND[top.id] && y <= top.y);
    };
    for (const id of Object.keys(BLOCKS)) this.layers.set(id, new Layer(id, this.scene, GROUND[id] ? buried : hidden));
    this.dice = new DiceView(this.scene);
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
      this.touched();
    });

    // Capture phase so we can claim a drag before OrbitControls sees it.
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), true);
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.abortGesture(); });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.hideGhost(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Wheel and trackpad zoom glide to their target instead of jumping a step per notch.
    // (Caught on the way down from the document, so the camera controls never see the raw wheel.)
    document.addEventListener('wheel', (e) => {
      if (e.target !== canvas) return;
      e.preventDefault();
      e.stopPropagation();
      const px = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
      const from = this.zoomGoal ?? this.camera.position.distanceTo(this.controls.target);
      this.zoomGoal = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, from * Math.exp(px * (e.ctrlKey ? 0.012 : 0.0016))));
    }, { capture: true, passive: false });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- what this player gets to see ------------------------------------------

  /** Who is looking: their player id, and whether they have GM powers (always true in free play). */
  setRole(me: string, full: boolean): void {
    this.me = me;
    this.full = full;
    this.refresh();
  }

  /** Re-evaluate everything that depends on role, fog, cutaway or line-of-sight settings. */
  refresh(): void {
    for (const l of this.layers.values()) l.dirty = true;
    this.coverDirty = this.terrainDirty = this.edgesDirty = true;
    for (const [key, g] of this.props) g.visible = !this.cellHidden(...parse(key));
    for (const [id, m] of this.minis) this.applyMini(id, m.val); // ghosting depends on the role
    this.fogDirty = this.visDirty = true;
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

  setSky(name: Sky): void {
    const s = SKIES[name] ?? SKIES.day;
    (this.scene.background as THREE.Color).set(s.bg);
    this.scene.fog!.color.set(s.bg);
    this.sun.color.set(s.sun);
    this.sun.intensity = s.sunI;
    this.hemi.color.set(s.hemi);
    this.hemi.intensity = s.hemiI;
    this.spill = s.spill;
    this.scene.environmentIntensity = s.sheen;
    this.look?.setGlow(this.spill * (0.5 + 0.5 * Math.min(this.glow, 2)));
    this.invalidate();
  }

  setTurn(id: string | null): void {
    if (this.turnId) this.minis.get(this.turnId)?.group.remove(this.turnRing);
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
    const eyes = this.full ? null : eyesOf(this.store, this.me);
    for (const [id, m] of this.minis) {
      const show = m.val.y < this.cut && miniShown(this.store, this.me, m.val, eyes) !== 'no';
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
    this.rulers.clear();
    this.pings.length = this.anims.length = 0;
    this.undoStack.length = this.redoStack.length = 0;
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
      const glow = GLOWS[this.store.get<CellVal>(key)?.i ?? ''];
      if (glow && g.visible) near.push({ d: g.position.distanceToSquared(at), p: g.position, glow });
    }
    near.sort((a, b) => a.d - b.d);
    let moved = false;
    this.lamps.forEach((lamp, i) => {
      const n = near[i];
      lamp.intensity = n ? n.glow[1] * this.glow : 0;
      lamp.visible = !!n && this.glow > 0; // a lamp with nothing to light costs nothing
      if (!n) return;
      const y = n.p.y + n.glow[2];
      if (lamp.position.x !== n.p.x || lamp.position.y !== y || lamp.position.z !== n.p.z) moved = true;
      lamp.color.set(n.glow[0]);
      lamp.position.set(n.p.x, y, n.p.z);
    });
    return moved; // their shadows need drawing again
  }

  /** Ask for a redraw. The board only renders when something changed. */
  invalidate(): void { this.dirty = true; }
  /** The table itself changed (not just the camera): shadows need redrawing too. */
  private touched(): void { this.dirty = this.shadowDirty = true; }
  private hideGhost(): void {
    if (this.ghost.visible) this.invalidate();
    this.ghost.visible = false;
  }

  apply(key: string, value: unknown, prev: unknown): void {
    this.touched();
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
      this.cover = { tuft: swarms('g_tuft'), flower: swarms('g_flower'), pebble: swarms('g_pebble') };
    }
    const cover = this.cover;
    const lots = new Map<Swarm, THREE.Matrix4[]>();
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    let salt = 0;
    const grow = (kind: 'tuft' | 'flower' | 'pebble', x: number, y: number, z: number, px: number, pz: number, pick?: number, scale = 1) => {
      const family = cover[kind], i = salt++;
      const swarm = family[pick ?? Math.floor(rand(x, y, z, 40 + i) * family.length)];
      const size = (0.8 + rand(x, y, z, 50 + i) * 0.7) * scale;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(px, y + 1, pz), q.setFromAxisAngle(up, rand(x, y, z, 80 + i) * Math.PI * 2), new THREE.Vector3(size, size, size));
      if (!lots.has(swarm)) lots.set(swarm, []);
      lots.get(swarm)!.push(m);
    };
    for (const [key, top] of this.columns) {
      if (GROUND[top.id]?.kind !== 3) continue; // only growing ground
      const [x, z] = key.split(',').map(Number), y = top.y;
      // On a bank only the level pad in the middle of the cell is at the cell's own height.
      const reach = this.terrain?.sloped.has(key) ? 0.5 : 0.84;
      const on = this.what(x, y + 1, z);
      salt = 0;
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
      const n = Math.floor(rand(x, y, z, 20) * (paved ? 2.4 : 0.9 + thick * 5.5));
      for (let i = 0; i < n; i++) {
        const r = rand(x, y, z, 30 + i);
        const kind = paved ? (r < 0.6 ? 'pebble' : 'tuft') : !crowded && drift > 0.62 && r < 0.5 ? 'flower' : r > 0.93 ? 'pebble' : 'tuft';
        // Flowers of a drift share a colour; everything else is drawn from its whole family.
        grow(kind, x, y, z, x + 0.5 + (rand(x, y, z, 60 + i) - 0.5) * reach, z + 0.5 + (rand(x, y, z, 70 + i) - 0.5) * reach,
          kind === 'flower' ? Math.floor(field(x, z, 11, 3) * cover.flower.length * 0.999) : undefined);
      }
    }
    const white = new THREE.Color('#ffffff');
    for (const swarm of Object.values(cover).flat()) {
      const list = lots.get(swarm) ?? [];
      swarm.begin(list.length);
      for (const m of list) swarm.add(m, white);
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
    if (prev && BLOCKS[prev.i]) {
      const l = this.layers.get(prev.i)!;
      l.cells.delete(key);
      l.dirty = true;
    }
    const old = this.props.get(key);
    if (old) {
      this.scene.remove(old);
      this.props.delete(key);
    }
    if (!v || typeof v.i !== 'string') return;
    const [x, y, z] = parse(key);
    if (![x, y, z].every(Number.isInteger)) return;
    if (BLOCKS[v.i]) {
      const l = this.layers.get(v.i)!;
      l.cells.add(key);
      l.dirty = true;
    } else if (PROPS[v.i]) {
      this.placeProp(key, v);
    }
  }

  private applyMini(id: string, v: MiniVal | null): void {
    let m = this.minis.get(id);
    if (!v || !MINIS[v.k]) {
      if (m) {
        this.scene.remove(m.group);
        this.minis.delete(id);
        if (this.selected === id) this.select(null);
      }
      return;
    }
    const ghost = this.full && !!v.h;
    const fly = Math.max(0, Math.min(12, v.e || 0));
    const sig = [v.k, v.c, v.n, v.s, v.hp, v.mhp, fly, ghost, !!v.d].join('|');
    const pos = new THREE.Vector3(v.x + 0.5, v.y, v.z + 0.5);
    if (!m || m.sig !== sig) {
      const group = new THREE.Group();
      const def = MINIS[v.k], s = v.s || 1;
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
      const label = plate(v);
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
      m = { group, target: pos, val: v, sig };
      this.minis.set(id, m);
      this.scene.add(group);
      if (this.selected === id) this.attachRing(m);
      if (this.turnId === id) this.setTurn(id);
      this.visDirty = true;
    }
    m.val = v;
    if (this.gesture?.mini !== id) m.target.copy(pos);
    this.pose(m);
  }

  /** A mini's resting pose: facing, flying height, and lying down when knocked out. */
  private pose(m: Mini): void {
    const body = m.group.children[0], v = m.val;
    body.rotation.set(v.d ? -Math.PI / 2 : 0, ((v.r || 0) * Math.PI) / 4, 0, 'YXZ');
    body.position.set(0, Math.max(0, Math.min(12, v.e || 0)) + (v.d ? 0.22 * (v.s || 1) : 0), 0);
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
      const body = m.group.children[0], s = m.val.s || 1, top = (m.val.e || 0) + MINIS[m.val.k].height * s;
      const w = Math.sin(Math.min(1, u * 2) * Math.PI); // one swell over the first half
      if (!m.val.d) switch (a.kind) {
        case 'attack': body.translateZ(w * 0.45); body.rotateX(w * 0.35); break;
        case 'hurt': body.position.x += Math.sin(a.t * 55) * 0.07 * (1 - u); body.rotateX(-w * 0.3); break;
        case 'cheer': body.position.y += Math.abs(Math.sin(u * Math.PI * 2)) * 0.4; body.rotateY(u * Math.PI * 2); break;
        case 'sleep': body.rotateZ(w * 0.35); break;
        default: body.rotateZ(Math.sin(u * Math.PI * 4) * 0.22 * (1 - u));
      }
      a.bubble.position.set(0, top + 0.9 + u * 0.5, 0);
      (a.bubble.material as THREE.SpriteMaterial).opacity = Math.min(1, (1 - u) * 3);
    }
    return this.anims.length > 0;
  }

  /** Another player is dragging a mini: show it moving before they drop it. */
  liveMove(id: string, p: Vec): void {
    const m = this.minis.get(id);
    if (m && this.gesture?.mini !== id && p.every(Number.isFinite)) m.target.set(p[0] + 0.5, p[1] + 0.3, p[2] + 0.5);
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
    if (this.selected) this.minis.get(this.selected)?.group.remove(this.ring);
    this.selected = id && this.minis.has(id) ? id : null;
    if (this.selected) this.attachRing(this.minis.get(this.selected)!);
    this.invalidate();
    this.hooks.onSelect(this.selected);
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
      this.edit(ck(...c), PROPS[v.i] ? { i: v.i, ...(((v.r ?? 0) + 4 - r) % 4 ? { r: ((v.r ?? 0) + 4 - r) % 4 } : {}) } : v);
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

  setTool(t: Tool): void {
    this.tool = t;
    this.hideGhost();
    if (t !== 'move') this.select(null);
    if (t !== 'ruler' && this.rulers.has('me')) {
      this.showRuler('me', null, '');
      this.hooks.onRuler(null);
    }
    // In every tool but Move, one finger is the tool and two fingers are the camera.
    this.controls.touches.ONE = t === 'move' ? THREE.TOUCH.ROTATE : (-1 as THREE.TOUCH);
    // Ruler, fog and the copy marquee are drag tools for the mouse as well (right-drag and wheel still move the camera).
    this.controls.mouseButtons.LEFT = t === 'ruler' || t === 'fog' || this.copying || this.rooming ? (-1 as THREE.MOUSE) : THREE.MOUSE.ROTATE;
    this.marquee.visible = false;
    this.canvas.style.cursor = t === 'move' ? 'grab' : 'crosshair';
  }

  /**
   * Put a generated scene on the table as one undo step: everything built inside its
   * bounds, and whatever is left of the scene it replaces (`old`), makes way for it.
   */
  applyScene(edits: [string, unknown][], [x0, x1, z0, z1]: number[], old: Set<string>, frame = true): void {
    if (!this.full) return;
    const scene = new Map(edits);
    this.batch = [];
    this.undoStack.push(this.batch);
    for (const prefix of ['b:', 'w:']) for (const k of [...this.store.keys(prefix)]) {
      if (scene.has(k)) continue;
      const [x, , z] = k.slice(2).split(',').map(Number);
      if (old.has(k) || (x >= x0 && x <= x1 + 1 && z >= z0 && z <= z1 + 1)) this.edit(k, null);
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
  undo(): void { this.replay(this.undoStack, this.redoStack); }
  redo(): void { this.replay(this.redoStack, this.undoStack); }
  private replay(from: Undo[][], to: Undo[][]): void {
    const group = from.pop();
    if (!group) return;
    const inverse: Undo[] = [];
    for (const u of [...group].reverse()) {
      inverse.push({ k: u.k, prev: this.store.get(u.k) });
      this.store.set(u.k, u.prev);
    }
    to.push(inverse);
  }
  private edit(k: string, v: unknown): void {
    if (!this.full) return; // building and fog are the GM's once a table has one
    const u = { k, prev: this.store.get(k) };
    if (this.batch) this.batch.push(u);
    else this.undoStack.push([u]);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this.store.set(k, v);
    if (this.gesture?.touch) navigator.vibrate?.(6);
  }

  /** Where thrown dice should land (the middle of the view) and where the thrower stands. */
  throwSpot(): { target: Vec; cam: Vec; tray: number } {
    this.ray.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const p = this.pickSurface()?.point ?? this.controls.target;
    // Size the invisible dice tray to what this screen shows there (narrow on a portrait phone).
    const half = Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.position.distanceTo(p);
    const tray = Math.min(6, Math.max(2, half * Math.min(1, this.camera.aspect) * 0.8));
    return { target: [p.x, Math.max(0, p.y), p.z], cam: this.camera.position.toArray(), tray };
  }

  /** Bring a mini to the middle of the view. */
  focusMini(id: string): void {
    const m = this.minis.get(id);
    if (!m || !m.group.visible) return;
    const d = m.target.clone().sub(this.controls.target);
    this.controls.target.add(d);
    this.camera.position.add(d);
    this.invalidate();
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
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.zoomGoal = null;
    if (this.pointers.size > 1) {
      // A second finger means a camera gesture, never an edit.
      this.abortGesture();
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
    if (this.hand.length) {
      // Dice in hand: this finger holds them over the table until it lets go.
      g.throwing = [];
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
      this.hooks.onGrab();
      const at = this.holdPoint(e, g);
      if (at) this.dice.hold(this.hand, this.diceColor, at);
      return;
    }
    this.aim(e);
    switch (this.tool) {
      case 'move': {
        const id = this.pickMini();
        if (id && this.hooks.canMove(id)) {
          g.mini = id;
          this.controls.enabled = false;
          this.canvas.setPointerCapture(e.pointerId);
        } else if (id) g.tapMini = id; // someone else's: tap to look at it, but it stays put
        else {
          // Press and hold on the table to ping the spot for everyone.
          const at = { clientX: e.clientX, clientY: e.clientY };
          g.press = setTimeout(() => {
            if (this.gesture !== g || g.moved || this.pointers.size !== 1) return;
            this.aim(at);
            const s = this.pickSurface();
            if (!s) return;
            g.done = true;
            navigator.vibrate?.(15);
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
        if (!touch) break;
        // No hover on touch: show where the edit will land as soon as the finger is down.
        this.updateGhost();
        if (this.pasting) break;
        if (this.edging) { g.edge = this.pickEdge(); break; }
        if (this.shaping) break;
        if (this.erasing) { const t = this.eraseTarget(); g.first = t && !t.startsWith('w:') ? parse(t) : null; }
        else if (this.tool === 'build') g.first = this.pickSurface()?.place ?? null;
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
      if (at) this.dice.moveHold(at);
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
      if (performance.now() - this.lastLive > 180) {
        this.lastLive = performance.now();
        this.hooks.onLiveMove(g.mini, pos);
      }
      return;
    }
    if (!g.drags || g.button !== 0) return;
    this.aim(e);
    if (this.tool === 'ruler') this.stretchRuler(g, false);
    else if (this.tool === 'fog') { if (g.moved) this.paintFog(); }
    else if (this.copying) this.stretchCopy(g, false);
    else if (this.rooming) this.stretchRoom(g, false);
    else if (this.edging) { if (g.moved) this.paintEdges(g); }
    else if (this.shaping) { if (g.moved) { this.shape(g); this.updateGhost(); } }
    else if (this.tool === 'mini' || this.pasting) this.updateGhost();
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
    if ((this.tool !== 'build' && this.tool !== 'mini') || this.copying || this.rooming) return;
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
      const [x, y, z] = parse(t);
      mat.color.set('#ff5a5a');
      this.ghost.scale.setScalar(1.04);
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
      const starts = this.dice.holdStarts();
      if (starts.length) this.hooks.onThrow(starts, vel);
      return;
    }
    if (g.mini) {
      this.controls.enabled = true;
      const m = this.minis.get(g.mini);
      const p = this.dragPos;
      this.dragPos = null;
      if (m && g.moved && p) this.store.set(`m:${g.mini}`, { ...m.val, x: p[0], y: p[1], z: p[2] });
      else if (m) m.target.set(m.val.x + 0.5, m.val.y, m.val.z + 0.5);
      this.select(g.mini);
      return;
    }
    if (g.button !== 0) return;
    this.aim(e);
    if (this.tool === 'ruler') {
      // A drag measures and leaves the ruler out; a tap puts it away.
      if (g.moved) this.stretchRuler(g, true);
      else { this.showRuler('me', null, ''); this.hooks.onRuler(null); }
      return;
    }
    if (this.tool === 'fog') {
      this.paintFog(); // a tap fogs one column; a drag has been painting all along
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
    if (g.moved && !(g.touch && (this.tool === 'mini' || this.pasting))) { this.hideGhost(); return; }
    this.gesture = g; // so edit() knows whether to give haptic feedback
    switch (this.tool) {
      case 'move':
        this.select(g.tapMini);
        break;
      case 'build': {
        if (this.pasting) {
          const at = this.pickSurface()?.place;
          if (at) this.pasteAt(at);
          break;
        }
        if (this.brush === 'paste') break;
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
        if (this.erasing) {
          const t = this.eraseTarget();
          if (t) this.edit(t, null);
          break;
        }
        const p = this.pickSurface()?.place;
        if (p && p[1] >= 0 && p[1] < Math.min(MAX_Y, this.cut)) this.edit(ck(...p), this.brushValue());
        break;
      }
      case 'mini': {
        const p = this.standing();
        if (!p || !this.full) break;
        const id = crypto.randomUUID().slice(0, 12);
        this.store.set(`m:${id}`, { ...this.hooks.newMini(), x: p[0], y: p[1], z: p[2] });
        break;
      }
    }
    this.gesture = null;
    if (g.touch) this.hideGhost();
    else this.updateGhost();
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
    if (g?.throwing) this.dice.endHold(); // back in the hand
  }

  /** Where held dice hover for this pointer: above the surface under it (and above the fingertip). */
  private holdPoint(e: PointerEvent, g: Gesture): THREE.Vector3 | null {
    this.aim(e, g.touch ? TOUCH_LIFT : 0);
    const p = this.pickSurface()?.point ?? this.ray.ray.intersectPlane(new THREE.Plane(THREE.Object3D.DEFAULT_UP, 0), new THREE.Vector3());
    if (!p || p.distanceTo(this.camera.position) > 120) return null;
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
    let moving = this.controls.update();
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
    if (this.animate(dt)) changed = true;
    if (this.fogDirty) { this.rebuildFog(); changed = true; }
    if (this.visDirty) { this.refreshMinis(); changed = true; }
    if (this.terrainDirty) { this.rebuildTerrain(); changed = true; }
    for (const l of this.layers.values()) if (l.dirty) { l.rebuild(); changed = true; }
    if (this.edgesDirty) { this.rebuildEdges(); changed = true; }
    if (this.coverDirty) { this.rebuildCover(); changed = true; }
    if ((changed || this.controls.target.distanceToSquared(this.litAt) > 4) && this.relight()) changed = true;
    const k = 1 - Math.exp(-dt * 14);
    for (const m of this.minis.values()) {
      if (m.group.position.distanceToSquared(m.target) < 1e-6) continue;
      m.group.position.lerp(m.target, k);
      changed = true;
    }
    let busy = moving || changed || this.dirty;
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
    // Idle tables cost no GPU time (and no battery).
    if (!busy) { this.wasBusy = false; return; }
    if (this.wasBusy) this.adapt(elapsed); // only judge frames that follow another drawn frame
    this.wasBusy = true;
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
    if (this.look) this.look.render(this.camera.position.distanceTo(this.controls.target));
    else this.renderer.render(this.scene, this.camera);
  }
  private wasBusy = false;
}
