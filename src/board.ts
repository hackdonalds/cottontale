// The 3D table: renders the shared Store and turns pointer input into edits.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BLOCKS, MINIS, PROPS } from './catalog';
import type { Store } from './store';

export type Tool = 'move' | 'build' | 'erase' | 'mini' | 'ping';
export type Vec = [number, number, number];
export interface CellVal { i: string; r?: number }
export interface MiniVal { x: number; y: number; z: number; k: string; c: string; n: string; r: number; s: number }

export interface BoardHooks {
  onSelect(id: string | null): void;
  onLiveMove(id: string, p: Vec): void;
  onPing(p: Vec): void;
  /** Template for a mini about to be placed at a cell. */
  newMini(): Omit<MiniVal, 'x' | 'y' | 'z'>;
}

const LIMIT = 96;
const MAX_Y = 40;
const ck = (x: number, y: number, z: number) => `b:${x},${y},${z}`;
const parse = (key: string) => key.slice(2).split(',').map(Number) as Vec;
function noise(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

class Layer {
  cells = new Set<string>();
  order: string[] = [];
  dirty = false;
  cap = 256;
  mesh: THREE.InstancedMesh;
  private geo: THREE.BufferGeometry;
  private mat: THREE.MeshStandardMaterial;
  private base: THREE.Color;

  constructor(id: string, private scene: THREE.Scene) {
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

interface Mini { group: THREE.Group; target: THREE.Vector3; val: MiniVal; sig: string; label: THREE.Sprite }

function labelSprite(text: string): THREE.Sprite {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const g = cv.getContext('2d')!;
  g.font = '600 30px system-ui, sans-serif';
  const w = Math.min(244, g.measureText(text).width + 24);
  g.fillStyle = 'rgba(15,17,23,.72)';
  g.beginPath();
  g.roundRect(128 - w / 2, 10, w, 44, 14);
  g.fill();
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 33, 232);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(1.6, 0.4, 1);
  s.visible = !!text;
  return s;
}

export class Board {
  tool: Tool = 'move';
  brush = 'grass';
  rot = 0;
  selected: string | null = null;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private ground: THREE.Mesh;
  private layers = new Map<string, Layer>();
  private props = new Map<string, THREE.Group>();
  private minis = new Map<string, Mini>();
  private ray = new THREE.Raycaster();
  private ghost: THREE.Mesh;
  private ring: THREE.Mesh;
  private pings: { mesh: THREE.Mesh; t: number }[] = [];
  private down: { x: number; y: number; id: string | null; moved: boolean } | null = null;
  private dragPos: Vec | null = null;
  private lastLive = 0;
  private undoStack: { k: string; prev: unknown }[] = [];
  private last = performance.now();

  constructor(private canvas: HTMLCanvasElement, private store: Store, private hooks: BoardHooks) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene.background = new THREE.Color('#1b2233');
    this.scene.fog = new THREE.Fog('#1b2233', 60, 170);

    this.scene.add(new THREE.HemisphereLight('#dfeaff', '#3a3344', 1.25));
    this.sun = new THREE.DirectionalLight('#fff2dd', 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -36;
    sc.right = sc.top = 36;
    sc.far = 140;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(LIMIT * 2, LIMIT * 2).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#34415a', roughness: 1 }),
    );
    this.ground.receiveShadow = true;
    const grid = new THREE.GridHelper(LIMIT * 2, LIMIT * 2, '#aab6cf', '#8794ad');
    grid.position.y = 0.003;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    this.scene.add(this.ground, grid);

    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.46, 0.035, 8, 32).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffe066' }),
    );
    this.ring.position.y = 0.06;
    this.scene.add(this.ghost);

    this.camera.position.set(7, 9, 11);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 90;
    this.controls.target.set(0, 0, 0);

    for (const id of Object.keys(BLOCKS)) this.layers.set(id, new Layer(id, this.scene));

    // Capture phase so we can claim a drag before OrbitControls sees it.
    canvas.addEventListener('pointerdown', (e) => this.onDown(e), true);
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => this.cancelDrag());
    canvas.addEventListener('pointerleave', () => { this.ghost.visible = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---- store → scene -------------------------------------------------------

  apply(key: string, value: unknown, prev: unknown): void {
    if (key.startsWith('b:')) this.applyCell(key, value as CellVal | null, prev as CellVal | null);
    else if (key.startsWith('m:')) this.applyMini(key.slice(2), value as MiniVal | null);
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
    const sig = `${v.k}|${v.c}|${v.n}|${v.s}`;
    const pos = new THREE.Vector3(v.x + 0.5, v.y, v.z + 0.5);
    if (!m || m.sig !== sig) {
      const group = new THREE.Group();
      const def = MINIS[v.k];
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.08, 24), new THREE.MeshStandardMaterial({ color: v.c, roughness: 0.5 }));
      base.position.y = 0.04;
      base.castShadow = base.receiveShadow = true;
      const body = new THREE.Group();
      body.add(base, ...def.make());
      body.scale.setScalar(v.s || 1);
      const label = labelSprite(v.n);
      label.position.y = def.height * (v.s || 1) + 0.35;
      group.add(body, label);
      group.userData.mini = id;
      group.position.copy(m ? m.group.position : pos);
      if (m) {
        if (this.selected === id) m.group.remove(this.ring);
        this.scene.remove(m.group);
      }
      m = { group, target: pos, val: v, sig, label };
      this.minis.set(id, m);
      this.scene.add(group);
      if (this.selected === id) this.attachRing(m);
    }
    m.val = v;
    m.target.copy(pos);
    m.group.children[0].rotation.y = ((v.r || 0) * Math.PI) / 4;
  }

  /** Another player is dragging a mini: show it moving before they drop it. */
  liveMove(id: string, p: Vec): void {
    const m = this.minis.get(id);
    if (m && p.every(Number.isFinite)) m.target.set(p[0] + 0.5, p[1] + 0.3, p[2] + 0.5);
  }

  ping(p: Vec, color: string): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, depthTest: false, side: THREE.DoubleSide }),
    );
    mesh.position.set(p[0], p[1] + 0.05, p[2]);
    mesh.renderOrder = 10;
    this.scene.add(mesh);
    this.pings.push({ mesh, t: 0 });
  }

  // ---- selection / editing -------------------------------------------------

  select(id: string | null): void {
    if (this.selected) this.minis.get(this.selected)?.group.remove(this.ring);
    this.selected = id && this.minis.has(id) ? id : null;
    if (this.selected) this.attachRing(this.minis.get(this.selected)!);
    this.hooks.onSelect(this.selected);
  }
  private attachRing(m: Mini): void {
    this.ring.scale.setScalar(m.val.s || 1);
    m.group.add(this.ring);
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.ghost.visible = false;
    if (t !== 'move') this.select(null);
    this.canvas.style.cursor = t === 'move' ? 'grab' : 'crosshair';
  }

  undo(): void {
    const u = this.undoStack.pop();
    if (u) this.store.set(u.k, u.prev);
  }
  private edit(k: string, v: unknown): void {
    this.undoStack.push({ k, prev: this.store.get(k) });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.store.set(k, v);
  }

  focus(x: number, y: number, z: number): void {
    const d = new THREE.Vector3(x, y, z).sub(this.controls.target);
    this.controls.target.add(d);
    this.camera.position.add(d);
  }

  // ---- picking ---------------------------------------------------------------

  private aim(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
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
    const hit = this.ray.intersectObjects([...this.props.values()], true)[0];
    if (!hit) return null;
    let o: THREE.Object3D | null = hit.object;
    while (o && !o.userData.cell) o = o.parent;
    return o ? { key: o.userData.cell, dist: hit.distance } : null;
  }

  private pickMini(): string | null {
    const hit = this.ray.intersectObjects([...this.minis.values()].map((m) => m.group), true)[0];
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

  /** Where a mini would stand if dropped under the pointer. */
  private standing(): Vec | null {
    const s = this.pickSurface();
    if (!s) return null;
    let [x, y, z] = s.place;
    while (y > 0 && !this.isBlock(x, y - 1, z)) y--;
    return [x, y, z];
  }

  // ---- pointer input -----------------------------------------------------------

  private onDown(e: PointerEvent): void {
    this.down = { x: e.clientX, y: e.clientY, id: null, moved: false };
    if (e.button !== 0 || this.tool !== 'move') return;
    this.aim(e);
    const id = this.pickMini();
    if (id) {
      this.down.id = id;
      this.controls.enabled = false;
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  private onMove(e: PointerEvent): void {
    const d = this.down;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
    this.aim(e);
    if (d?.id) {
      if (!d.moved) return;
      const p = this.standing();
      const m = this.minis.get(d.id);
      if (!p || !m) return;
      this.dragPos = p;
      m.target.set(p[0] + 0.5, p[1] + 0.3, p[2] + 0.5);
      if (performance.now() - this.lastLive > 180) {
        this.lastLive = performance.now();
        this.hooks.onLiveMove(d.id, p);
      }
      return;
    }
    if (e.pointerType === 'mouse' && !e.buttons) this.updateGhost();
  }

  private updateGhost(): void {
    this.ghost.visible = false;
    if (this.tool === 'move' || this.tool === 'ping') return;
    const mat = this.ghost.material as THREE.MeshBasicMaterial;
    if (this.tool === 'erase') {
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
  }

  private eraseTarget(): string | null {
    const s = this.pickSurface();
    const p = this.pickProp();
    if (p && (!s || p.dist <= s.point.distanceTo(this.ray.ray.origin))) return p.key;
    return s?.cell ? ck(...s.cell) : null;
  }

  private onUp(e: PointerEvent): void {
    const d = this.down;
    this.down = null;
    if (!d) return;
    if (d.id) {
      this.controls.enabled = true;
      const m = this.minis.get(d.id);
      const p = this.dragPos;
      this.dragPos = null;
      if (m && d.moved && p) this.store.set(`m:${d.id}`, { ...m.val, x: p[0], y: p[1], z: p[2] });
      else if (m) m.target.set(m.val.x + 0.5, m.val.y, m.val.z + 0.5);
      this.select(d.id);
      return;
    }
    if (d.moved || e.button !== 0) return;
    this.aim(e);
    switch (this.tool) {
      case 'move':
        this.select(null);
        break;
      case 'build': {
        const p = this.pickSurface()?.place;
        if (!p || p[1] < 0 || p[1] >= MAX_Y) break;
        const v: CellVal = { i: this.brush };
        if (PROPS[this.brush] && this.rot) v.r = this.rot;
        this.edit(ck(...p), v);
        break;
      }
      case 'erase': {
        const t = this.eraseTarget();
        if (t) this.edit(t, null);
        break;
      }
      case 'mini': {
        const p = this.standing();
        if (!p) break;
        const id = crypto.randomUUID().slice(0, 12);
        this.store.set(`m:${id}`, { ...this.hooks.newMini(), x: p[0], y: p[1], z: p[2] });
        break;
      }
      case 'ping': {
        const s = this.pickSurface();
        if (s) this.hooks.onPing([+s.point.x.toFixed(2), +s.point.y.toFixed(2), +s.point.z.toFixed(2)]);
        break;
      }
    }
    this.updateGhost();
  }

  private cancelDrag(): void {
    const d = this.down;
    this.down = null;
    this.dragPos = null;
    this.controls.enabled = true;
    const m = d?.id ? this.minis.get(d.id) : null;
    if (m) m.target.set(m.val.x + 0.5, m.val.y, m.val.z + 0.5);
  }

  // ---- frame ---------------------------------------------------------------------

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    for (const l of this.layers.values()) if (l.dirty) l.rebuild();
    const k = 1 - Math.exp(-dt * 14);
    for (const m of this.minis.values()) m.group.position.lerp(m.target, k);
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
    }
    this.controls.update();
    this.sun.position.copy(this.controls.target).add(new THREE.Vector3(22, 40, 14));
    this.sun.target.position.copy(this.controls.target);
    this.renderer.render(this.scene, this.camera);
  }
}
