// The 3D table: renders the shared Store and turns pointer input into edits.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BLOCKS, MINIS, PROPS } from './catalog';
import { DiceView, type Kind, type Start } from './dice';
import { eyesOf, fogged, measure, miniShown, type CellVal, type MiniVal } from './rules';
import type { Store } from './store';

export type { CellVal, MiniVal };
export type Tool = 'move' | 'build' | 'mini' | 'ruler' | 'fog';
export type Vec = [number, number, number];
export type RulerMode = 'line' | 'circle' | 'cone';
export interface Ruler { a: Vec; b: Vec; m: RulerMode }
export type Sky = 'day' | 'dusk' | 'night';

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
}

const LIMIT = 96;
const MAX_Y = 40;
const ck = (x: number, y: number, z: number) => `b:${x},${y},${z}`;
const parse = (key: string) => key.slice(2).split(',').map(Number) as Vec;
function noise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** All blocks of one material, drawn as a single instanced mesh. */
class Layer {
  cells = new Set<string>();
  order: string[] = [];
  dirty = false;
  cap = 256;
  mesh: THREE.InstancedMesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshStandardMaterial;
  private base: THREE.Color;

  constructor(id: string, private scene: THREE.Scene, private hidden: (x: number, y: number, z: number) => boolean) {
    const d = BLOCKS[id];
    const h = d.h ?? 1;
    this.geo = new THREE.BoxGeometry(1, h, 1).translate(0, h / 2, 0);
    this.base = new THREE.Color(d.color);
    this.mat = new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: d.rough ?? 0.9,
      transparent: d.opacity !== undefined, opacity: d.opacity ?? 1,
      emissive: d.glow ? this.base : new THREE.Color(0), emissiveIntensity: d.glow ?? 0,
    });
    this.mesh = this.make();
  }
  private make(): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo, this.mat, this.cap);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = !this.mat.transparent;
    m.receiveShadow = true;
    m.userData.layer = this;
    this.scene.add(m);
    return m;
  }
  rebuild(): void {
    this.dirty = false;
    if (this.cells.size > this.cap) {
      while (this.cells.size > this.cap) this.cap *= 2;
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      this.mesh = this.make();
    }
    const m = new THREE.Matrix4(), c = new THREE.Color();
    let i = 0;
    this.order.length = 0;
    for (const key of this.cells) {
      const [x, y, z] = parse(key);
      if (this.hidden(x, y, z)) continue; // above the cutaway, or under fog
      m.makeTranslation(x + 0.5, y, z + 0.5);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, c.copy(this.base).offsetHSL(0, 0, (noise(x, y, z) - 0.5) * 0.07));
      this.order.push(key);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.boundingSphere = null;
    this.mesh.boundingBox = null;
  }
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
  press?: ReturnType<typeof setTimeout>;
}
const TOUCH_LIFT = 44; // px a dragged mini floats above the fingertip so it stays visible
const LONG_PRESS = 550;

interface Mini { group: THREE.Group; target: THREE.Vector3; val: MiniVal; sig: string }

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

const SKIES: Record<Sky, { bg: string; sun: string; sunI: number; hemi: string; hemiI: number }> = {
  day: { bg: '#1b2233', sun: '#fff2dd', sunI: 2.1, hemi: '#dfeaff', hemiI: 1.25 },
  dusk: { bg: '#2b1d2e', sun: '#ff9d5c', sunI: 1.5, hemi: '#ffc9a8', hemiI: 0.7 },
  night: { bg: '#080b14', sun: '#8fb0ff', sunI: 0.55, hemi: '#7f95d6', hemiI: 0.42 },
};

export class Board {
  tool: Tool = 'move';
  /** A block or prop id, or 'erase'. */
  brush = 'grass';
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
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private ground: THREE.Mesh;
  private layers = new Map<string, Layer>();
  private props = new Map<string, THREE.Group>();
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
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private twist = 0;
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
    this.renderer.shadowMap.enabled = !lowEnd;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color();
    this.scene.fog = new THREE.Fog('#000', 60, 170);

    this.hemi = new THREE.HemisphereLight('#fff', '#3a3344', 1);
    this.sun = new THREE.DirectionalLight('#fff', 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(this.coarse ? 1024 : 2048);
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
    g.fillStyle = '#34415a';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#5b6a88';
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
    this.scene.add(this.ghost);

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
    for (const id of Object.keys(BLOCKS)) this.layers.set(id, new Layer(id, this.scene, hidden));
    this.dice = new DiceView(this.scene);

    // Capture phase so we can claim a drag before OrbitControls sees it.
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), true);
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => { this.pointers.delete(e.pointerId); this.abortGesture(); });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.hideGhost(); });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
    for (const [key, g] of this.props) g.visible = !this.cellHidden(...parse(key));
    for (const [id, m] of this.minis) this.applyMini(id, m.val); // ghosting depends on the role
    this.fogDirty = this.visDirty = true;
    this.invalidate();
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

  setSky(name: Sky): void {
    const s = SKIES[name] ?? SKIES.day;
    (this.scene.background as THREE.Color).set(s.bg);
    this.scene.fog!.color.set(s.bg);
    this.sun.color.set(s.sun);
    this.sun.intensity = s.sunI;
    this.hemi.color.set(s.hemi);
    this.hemi.intensity = s.hemiI;
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

  // ---- store → scene -------------------------------------------------------

  /** Ask for a redraw. The board only renders when something changed. */
  invalidate(): void { this.dirty = true; }
  private hideGhost(): void {
    if (this.ghost.visible) this.invalidate();
    this.ghost.visible = false;
  }

  apply(key: string, value: unknown, prev: unknown): void {
    this.invalidate();
    if (key.startsWith('b:')) {
      this.applyCell(key, value as CellVal | null, prev as CellVal | null);
      this.visDirty = this.fogDirty = true; // walls change sight lines and fog heights
    } else if (key.startsWith('m:')) {
      this.applyMini(key.slice(2), value as MiniVal | null);
      this.visDirty = true;
    } else if (key.startsWith('f:')) {
      this.fogDirty = this.visDirty = true;
      if (!this.full) this.refresh();
    }
  }

  private applyCell(key: string, v: CellVal | null, prev: CellVal | null): void {
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
      const g = PROPS[v.i].make();
      g.position.set(x + 0.5, y, z + 0.5);
      g.rotation.y = ((v.r ?? 0) * Math.PI) / 2;
      g.userData.cell = key;
      g.visible = !this.cellHidden(x, y, z);
      this.scene.add(g);
      this.props.set(key, g);
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
    const sig = [v.k, v.c, v.n, v.s, v.hp, v.mhp, fly, ghost].join('|');
    const pos = new THREE.Vector3(v.x + 0.5, v.y, v.z + 0.5);
    if (!m || m.sig !== sig) {
      const group = new THREE.Group();
      const def = MINIS[v.k], s = v.s || 1;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.08, 24), new THREE.MeshStandardMaterial({ color: v.c, roughness: 0.5 }));
      base.position.y = 0.04;
      base.castShadow = base.receiveShadow = true;
      // Generous invisible hit area: minis are small targets for a fingertip.
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, def.height + 0.15, 10), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = (def.height + 0.15) / 2;
      const body = new THREE.Group();
      body.add(base, hit, ...def.make());
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
          const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
          if (mat?.visible) { mat.transparent = true; mat.opacity = 0.38; mat.depthWrite = false; }
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
    m.group.children[0].rotation.y = ((v.r || 0) * Math.PI) / 4;
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
    // Ruler and fog are drag tools for the mouse as well (right-drag and wheel still move the camera).
    this.controls.mouseButtons.LEFT = t === 'ruler' || t === 'fog' ? (-1 as THREE.MOUSE) : THREE.MOUSE.ROTATE;
    this.canvas.style.cursor = t === 'move' ? 'grab' : 'crosshair';
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
    for (const l of this.layers.values()) {
      if (l.dirty) l.rebuild(); // never pick against a stale mesh
      if (l.mesh.count) targets.push(l.mesh);
    }
    const hit = this.ray.intersectObjects(targets, false)[0];
    if (!hit) return null;
    if (hit.object === this.ground) {
      const place: Vec = [Math.floor(hit.point.x), 0, Math.floor(hit.point.z)];
      return Math.abs(place[0]) < LIMIT && Math.abs(place[2]) < LIMIT ? { cell: null, place, point: hit.point } : null;
    }
    const layer = hit.object.userData.layer as Layer;
    const key = layer.order[hit.instanceId!];
    if (!key) return null;
    const cell = parse(key);
    const n = hit.face!.normal;
    const place: Vec = [cell[0] + Math.round(n.x), cell[1] + Math.round(n.y), cell[2] + Math.round(n.z)];
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
    if (this.pointers.size > 1) {
      // A second finger means a camera gesture, never an edit.
      this.abortGesture();
      this.twist = this.twistAngle();
      return;
    }
    const touch = e.pointerType !== 'mouse';
    const g: Gesture = {
      id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button, touch, moved: false, done: false,
      mini: null, tapMini: null, throwing: null, measure: null, first: null, stroke: null,
      drags: this.tool === 'ruler' || this.tool === 'fog' || (touch && this.tool !== 'move'),
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
        if (!touch) break;
        // No hover on touch: show where the edit will land as soon as the finger is down.
        this.updateGhost();
        if (this.erasing) { const t = this.eraseTarget(); g.first = t ? parse(t) : null; }
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
    else if (this.tool === 'mini') this.updateGhost();
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
    if (this.tool !== 'build' && this.tool !== 'mini') return;
    const mat = this.ghost.material as THREE.MeshBasicMaterial;
    if (this.erasing) {
      const t = this.eraseTarget();
      if (!t) return;
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
    const s = this.pickSurface();
    const p = this.pickProp();
    if (p && (!s || p.dist <= s.point.distanceTo(this.ray.ray.origin))) return p.key;
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
    if (g.stroke) { // the drag already did the editing
      this.batch = null;
      this.hideGhost();
      return;
    }
    // A moved pointer was a camera drag, except a finger sliding a mini's landing spot.
    if (g.moved && !(g.touch && this.tool === 'mini')) { this.hideGhost(); return; }
    this.gesture = g; // so edit() knows whether to give haptic feedback
    switch (this.tool) {
      case 'move':
        this.select(g.tapMini);
        break;
      case 'build': {
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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    let busy = this.controls.update() || this.dirty;
    if (this.dice.update(dt)) busy = true;
    if (this.fogDirty) { this.rebuildFog(); busy = true; }
    if (this.visDirty) { this.refreshMinis(); busy = true; }
    for (const l of this.layers.values()) if (l.dirty) { l.rebuild(); busy = true; }
    const k = 1 - Math.exp(-dt * 14);
    for (const m of this.minis.values()) {
      if (m.group.position.distanceToSquared(m.target) < 1e-6) continue;
      m.group.position.lerp(m.target, k);
      busy = true;
    }
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
    if (!busy) return;
    this.dirty = false;
    this.sun.position.copy(this.controls.target).add(new THREE.Vector3(22, 40, 14));
    this.sun.target.position.copy(this.controls.target);
    this.renderer.render(this.scene, this.camera);
  }
}
