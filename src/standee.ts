// Standees: flat tokens made from a picture, at almost no cost to a phone.
//
// Every standee picture lives in a cell of a shared atlas page (2048×2048, cells of 256 px,
// 64 to a page; a large token takes four). A page is one texture, one material and ONE
// InstancedMesh: all the standees on the board whose pictures are on that page are drawn in a
// single draw call, however many there are. What the registry holds for a standee (its
// "ready mesh", see registry.ts) is only an invisible, pickable card: the board places and
// animates it like any other piece, and `standees` copies where those cards stand into the
// page's instances whenever the table changes (never when only the camera moves).
//
// A card is upright, shows its picture on both sides (mirrored on the back, as a real one
// would) and is alpha-tested, so nothing needs sorting. It casts no shadow of its own: a
// figure has its base for that. A hidden figure the GM can still see is drawn half there
// (every other pixel), again without sorting.
//
// A "flat" piece is the other use of a picture: laid on the ground as a map tile or decal,
// up to 2048 px, with a texture of its own.
import * as THREE from 'three';
import { clampNum, registerPieceKind, type Built, type Entry } from './packs';
import { TILE_BYTES, TILE_PX, TOKEN_BYTES, fit, imageSize } from './pixels';

export const PAGE_PX = 2048, CELL_PX = 256, PER_PAGE = 64;
/** Kept clear around each picture, so its neighbours never show at a card's edge from far away. */
const PAD = 2;
/** How high a figure's card stands off the ground: the top of its base (see BASE in board.ts). */
const LIFT = 0.08;

// ---- where pictures go on the pages (pure) ------------------------------------------------------

export interface Slot { page: number; /** Position in Z-order: the first 16 are the top-left quarter. */ index: number; /** 1 = one cell, 2 = two by two. */ span: 1 | 2; x: number; y: number }

/** Cell column and row of a Z-order index (bits interleaved, x first). */
export function cellOf(index: number): [x: number, y: number] {
  let x = 0, y = 0;
  for (let b = 0; b < 3; b++) { x |= ((index >> (2 * b)) & 1) << b; y |= ((index >> (2 * b + 1)) & 1) << b; }
  return [x, y];
}

/**
 * Hands out cells. Cells are numbered in Z-order, so a page fills from its top-left quarter
 * outwards (a page with sixteen pictures or fewer only needs a 1024 px texture), and four
 * cells in a row whose first is a multiple of four are always a square block.
 */
export class AtlasAlloc {
  /** One entry per page: which of its cells are taken. */
  private used: boolean[][] = [];

  alloc(span: 1 | 2 = 1): Slot {
    const n = span * span;
    for (let page = 0; ; page++) {
      const u = (this.used[page] ??= new Array<boolean>(PER_PAGE).fill(false));
      for (let i = 0; i + n <= PER_PAGE; i += n) {
        if (u.slice(i, i + n).some(Boolean)) continue;
        u.fill(true, i, i + n);
        const [x, y] = cellOf(i);
        return { page, index: i, span, x, y };
      }
    }
  }

  free(s: Slot): void {
    this.used[s.page]?.fill(false, s.index, s.index + s.span * s.span);
  }

  /** How many cells of a page are taken. */
  count(page: number): number { return this.used[page]?.filter(Boolean).length ?? 0; }
  get pages(): number { return this.used.length; }
  /** The side a page's texture needs: 1024 while only the first quarter is in use, else 2048. 0 for an empty page. */
  extent(page: number): number {
    const last = this.used[page]?.lastIndexOf(true) ?? -1;
    return last < 0 ? 0 : last < PER_PAGE / 4 ? PAGE_PX / 2 : PAGE_PX;
  }
}

// ---- the pages -----------------------------------------------------------------------------------

/** What a standee's invisible card carries (in its geometry's userData) for the batch to draw it. */
interface Card { slot: Slot; /** The picture in its page, in pixels. */ rect: [x: number, y: number, w: number, h: number]; /** Card size and lift, applied after the piece's own placing. */ local: THREE.Matrix4 }

const QUAD = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
/** The card the registry hands out: there to be placed and picked, never drawn. */
const UNDRAWN = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });

class Page {
  canvas: HTMLCanvasElement | null = null;
  g: CanvasRenderingContext2D | null = null;
  size = 0;
  texture = new THREE.CanvasTexture(null as unknown as HTMLCanvasElement);
  material: THREE.MeshLambertMaterial;
  mesh: THREE.InstancedMesh | null = null;
  cap = 0;
  n = 0;
  mats = new Float32Array(0);
  rects = new Float32Array(0);
  fades = new Float32Array(0);
  stale = true;

  constructor() {
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshLambertMaterial({ map: this.texture, alphaTest: 0.5, side: THREE.DoubleSide });
    // Each instance shows its own part of the page, and may be faded (a hidden figure, to the GM).
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aRect;\nattribute float aFade;\nvarying float vFade;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv = aRect.xy + uv * aRect.zw;\n#endif\n\tvFade = aFade;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFade;')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\tif ( vFade < 0.99 && mod( floor( gl_FragCoord.x ) + floor( gl_FragCoord.y ), 2.0 ) < 0.5 ) discard;');
    };
    this.material.customProgramCacheKey = () => 'standee';
  }

  /** Make the canvas at least `size` a side, keeping what is on it (cells keep their pixels; only the UVs change). */
  grow(size: number): void {
    if (size <= this.size) return;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d')!;
    if (this.canvas) g.drawImage(this.canvas, 0, 0);
    this.canvas = c;
    this.g = g;
    this.size = size;
    this.texture.dispose(); // a texture cannot change size in place
    this.texture.image = c;
    this.texture.needsUpdate = true;
  }

  private room(n: number): void {
    if (n <= this.cap) return;
    const cap = Math.max(16, this.cap * 2, n), keep = (old: Float32Array, per: number) => { const a = new Float32Array(cap * per); a.set(old.subarray(0, this.n * per)); return a; };
    this.mats = keep(this.mats, 16);
    this.rects = keep(this.rects, 4);
    this.fades = keep(this.fades, 1);
    this.cap = cap;
    this.stale = true;
  }

  add(m: THREE.Matrix4, card: Card, fade: number): void {
    this.room(this.n + 1);
    const [x, y, w, h] = card.rect, s = this.size || 1;
    m.toArray(this.mats, this.n * 16);
    this.rects.set([x / s, 1 - (y + h) / s, w / s, h / s], this.n * 4);
    this.fades[this.n] = fade;
    this.n++;
  }

  /** Show what was added since `n` was set to zero. */
  flush(scene: THREE.Scene): void {
    if (!this.n) { if (this.mesh) this.mesh.visible = false; return; }
    if (this.stale || !this.mesh) {
      this.mesh?.removeFromParent();
      this.mesh?.geometry.dispose();
      this.mesh?.dispose();
      const geo = QUAD.clone();
      geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(this.rects, 4));
      geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(this.fades, 1));
      this.mesh = new THREE.InstancedMesh(geo, this.material, this.cap);
      this.mesh.instanceMatrix = new THREE.InstancedBufferAttribute(this.mats, 16);
      this.mesh.frustumCulled = false; // its instances are all over the table
      this.mesh.userData.standees = true;
      this.stale = false;
    }
    const mesh = this.mesh;
    if (mesh.parent !== scene) scene.add(mesh);
    mesh.visible = true;
    mesh.count = this.n;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.geometry.getAttribute('aRect').needsUpdate = true;
    mesh.geometry.getAttribute('aFade').needsUpdate = true;
  }
}

const alloc = new AtlasAlloc(), pages: Page[] = [];
let cards = 0;
const tmp = new THREE.Matrix4();

function cardOf(o: THREE.Object3D): Card | undefined {
  return ((o as THREE.Mesh).geometry?.userData as { standee?: Card } | undefined)?.standee;
}

/**
 * The batch the board draws standees with. After the table changed:
 * `begin()`, then `add(root, fade)` for every prop group and mini group that is showing, then `end(scene)`.
 */
export const standees = {
  /** Is there any standee picture loaded at all? (Nothing to do otherwise.) */
  get any(): boolean { return cards > 0 || pages.some((p) => p.mesh?.visible); },
  begin(): void { for (const p of pages) p.n = 0; },
  /** Draw the standee cards under `root` (a prop's group, or a mini's). `fade` under 1 draws them half there. */
  add(root: THREE.Object3D, fade = 1): void {
    if (!root.visible) return;
    for (const a of root.children) {
      const own = cardOf(a);
      if (own) { put(a, own, fade); continue; }
      if ((a as THREE.Mesh).isMesh) continue;
      for (const b of a.children) { const c = cardOf(b); if (c) put(b, c, fade); }
    }
  },
  end(scene: THREE.Scene): void { for (const p of pages) p.flush(scene); },
  /** For looking at from outside (tests): pages in use and instances drawn. */
  stats(): { pages: number; drawn: number[]; sizes: number[] } {
    return { pages: pages.filter((p) => p.size).length, drawn: pages.map((p) => (p.mesh?.visible ? p.n : 0)), sizes: pages.map((p) => p.size) };
  },
};
function put(o: THREE.Object3D, card: Card, fade: number): void {
  const page = pages[card.slot.page];
  if (!page) return;
  o.updateWorldMatrix(true, false);
  page.add(tmp.multiplyMatrices(o.matrixWorld, card.local), card, fade);
}

// ---- the two kinds of piece a picture can be ------------------------------------------------------

const IMAGE = /^image\/(png|jpeg|webp)$/;
/** Decode a picture somebody sent, after checking what its header says: nothing oversized is ever decoded at full size. */
async function decode(entry: Entry, bytes: Uint8Array, max: number): Promise<ImageBitmap> {
  const size = imageSize(bytes);
  if (!IMAGE.test(entry.ref.m) || !size || size.type === 'gif' || Math.max(size.w, size.h) > 8192) throw new Error('not a picture this table takes');
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: entry.ref.m });
  const [w, h] = fit(size.w, size.h, max);
  if (w === size.w) return createImageBitmap(blob);
  try { return await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }); } catch { return createImageBitmap(blob); }
}

/** A standee entry: `{ kind: 'standee', h?: height in cells (default 1), big?: true (a 512 px picture) }`. */
registerPieceKind('standee', {
  budget: TOKEN_BYTES,
  parse(raw) {
    const r = raw as Record<string, unknown>;
    return { h: Math.round(clampNum(r.h, 0.3, 4, 1) * 100) / 100, ...(r.big === true ? { big: true } : {}) };
  },
  async build(entry, bytes, ctx): Promise<Built> {
    const span = entry.big === true ? 2 : 1, cell = CELL_PX * span, inner = cell - PAD * 2;
    const bmp = await decode(entry, bytes, inner);
    const slot = alloc.alloc(span), page = (pages[slot.page] ??= new Page());
    page.grow(alloc.extent(slot.page));
    const k = Math.min(1, inner / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const x = slot.x * CELL_PX + Math.floor((cell - w) / 2), y = slot.y * CELL_PX + Math.floor((cell - h) / 2);
    page.g!.clearRect(slot.x * CELL_PX, slot.y * CELL_PX, cell, cell);
    page.g!.drawImage(bmp, x, y, w, h);
    bmp.close();
    page.texture.needsUpdate = true;
    cards++;
    // The card in the world: as tall as the entry says, as wide as the picture makes it.
    const tall = entry.h as number, wide = Math.min(4, (tall * w) / h), lift = ctx.group === 'minis' ? LIFT : 0;
    const geometry = new THREE.BoxGeometry(wide, tall, 0.06).translate(0, tall / 2 + lift, 0);
    const card: Card = { slot, rect: [x, y, w, h], local: new THREE.Matrix4().makeTranslation(0, lift, 0).multiply(new THREE.Matrix4().makeScale(wide, tall, 1)) };
    geometry.userData.standee = card;
    const def = { name: entry.name, icon: entry.icon ?? '🖼️', mesh: { geometry, material: UNDRAWN } };
    return {
      ...(ctx.group === 'minis' ? { mini: { ...def, height: tall + lift } } : { prop: def }),
      dispose() {
        page.g?.clearRect(slot.x * CELL_PX, slot.y * CELL_PX, cell, cell);
        page.texture.needsUpdate = true;
        alloc.free(slot);
        geometry.dispose();
        cards--;
      },
    };
  },
});

/** A flat entry: `{ kind: 'flat', cells?: how many cells wide it lies (1–16, default 2) }`. Things only. */
registerPieceKind('flat', {
  budget: TILE_BYTES,
  groups: ['props'],
  parse(raw) {
    return { cells: Math.round(clampNum((raw as Record<string, unknown>).cells, 1, 16, 2)) };
  },
  async build(entry, bytes): Promise<Built> {
    const bmp = await decode(entry, bytes, TILE_PX);
    const texture = new THREE.Texture(bmp as unknown as HTMLImageElement);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // a decoded bitmap cannot be flipped on upload: the UVs are flipped below
    texture.needsUpdate = true;
    const wide = entry.cells as number, deep = Math.min(16, Math.max(0.25, (wide * bmp.height) / bmp.width));
    // On the grid: a tile an even number of cells across has its middle on a grid line, not in a cell.
    const off = (n: number) => (Math.round(n) % 2 === 0 ? 0.5 : 0);
    const geometry = new THREE.PlaneGeometry(wide, deep).rotateX(-Math.PI / 2).translate(off(wide), 0.04, off(deep));
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    // See-through where the picture is, drawn after the ground and never hiding what stands on it.
    const material = new THREE.MeshLambertMaterial({ map: texture, transparent: true, alphaTest: 0.03, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return {
      prop: { name: entry.name, icon: entry.icon ?? '🗺️', mesh: { geometry, material } },
      dispose() { texture.dispose(); material.dispose(); geometry.dispose(); bmp.close(); },
    };
  },
});
