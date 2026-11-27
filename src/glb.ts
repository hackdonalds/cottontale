// Reading a .glb somebody handed us, without trusting a byte of it. Everything here is pure
// and runs under node (unit tests): the header and JSON chunk, the checks made before
// anything is unpacked (how many triangles, where the data lives), bounds-checked reads of
// accessors, the sums that pack several pictures into one atlas, and writing a GLB back out.
//
// Used by the import worker (ingest.ts) on the GM's file, and again by every device on the
// processed file it is sent (modelBuild.ts): that one came through the table, so it is checked
// just as hard, against the narrow shape our own writer produces.
//
// Nothing here ever follows a URI. A model whose data or pictures are in other files is refused.
import { imageSize } from './pixels';

/** A reason in words for the person who chose the file. Anything else thrown is a bug. */
export class ModelError extends Error {}
const bad = (why: string): never => { throw new ModelError(why); };

/** What is taken in at all: checked before anything is unpacked. */
export const INPUT_BYTES = 25 * 1024 * 1024, INPUT_TRIS = 300_000, IMAGE_SIDE = 8192;
const JSON_BYTES = 8 * 1024 * 1024, MAX_NODES = 20_000, MAX_VISITS = 50_000, MAX_COUNT = 4_000_000, MAX_IMAGES = 256;

export { GLB_MIME, PIECE, SET, type ModelBudget } from './modelBudget';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;
const list = (v: unknown): Json[] => (Array.isArray(v) ? v : []);
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const index = (v: unknown, n: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < n ? v : -1);
const count = (n: number) => n.toLocaleString('en-US');

// ---- the container -------------------------------------------------------------------------------

/** Where the JSON chunk is, from a file's first 20 bytes. */
export function glbHeader(b: Uint8Array, fileSize = b.length): { jsonAt: number; jsonLen: number; length: number } {
  if (fileSize > INPUT_BYTES) bad(`That file is too large (${(fileSize / 1024 / 1024).toFixed(1)} MB; at most 25 MB).`);
  const u32 = (i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  if (b.length >= 1 && (b[0] === 0x7b || b[0] === 0xef)) bad('That is a .gltf, which keeps its data in other files. Export the model as a single .glb.');
  if (b.length < 20 || u32(0) !== 0x46546c67) bad('That is not a .glb model.');
  if (u32(4) !== 2) bad('That .glb is of a version this app cannot read (only glTF 2).');
  const length = u32(8), jsonLen = u32(12);
  if (length > fileSize || length < 20) bad('That file is cut short.');
  if (u32(16) !== 0x4e4f534a || jsonLen < 2) bad('That .glb is damaged.');
  if (jsonLen > JSON_BYTES) bad('That model is too complicated (its description alone is over 8 MB).');
  if (20 + jsonLen > length) bad('That file is cut short.');
  return { jsonAt: 20, jsonLen, length };
}

export function parseJson(chunk: Uint8Array): Json {
  let json: unknown;
  try { json = JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(chunk)); } catch { return bad('That .glb is damaged (its description cannot be read).'); }
  return isObj(json) ? json : bad('That .glb is damaged.');
}

/** A whole .glb: its JSON and its binary chunk (a view into `b`, or null when it has none). */
export function splitGlb(b: Uint8Array): { json: Json; bin: Uint8Array | null } {
  const { jsonAt, jsonLen, length } = glbHeader(b);
  const json = parseJson(b.subarray(jsonAt, jsonAt + jsonLen)), at = jsonAt + jsonLen + ((4 - (jsonLen % 4)) % 4);
  if (at + 8 > length) return { json, bin: null };
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(at, true);
  if (dv.getUint32(at + 4, true) !== 0x004e4942) return { json, bin: null };
  if (at + 8 + n > length) bad('That file is cut short.');
  return { json, bin: b.subarray(at + 8, at + 8 + n) };
}

/** Put a GLB together from its JSON and binary chunk. */
export function packGlb(json: Json, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json)), jl = (text.length + 3) & ~3, bl = (bin.length + 3) & ~3;
  const out = new Uint8Array(12 + 8 + jl + 8 + bl), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jl);
  out.set(text, 20);
  dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004e4942, true);
  out.set(bin, 28 + jl);
  return out;
}

// ---- 4×4 matrices (column-major, as glTF writes them) --------------------------------------------

export type Mat4 = Float64Array;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const nums = (v: unknown, n: number): number[] | null => (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);
export function mul(a: ArrayLike<number>, b: ArrayLike<number>): Mat4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
/** A node's own transform: its matrix, or translation × rotation × scale. */
export function nodeMatrix(node: Json): Mat4 {
  const m = nums(node.matrix, 16);
  if (m) return Float64Array.from(m);
  const t = nums(node.translation, 3) ?? [0, 0, 0], q = nums(node.rotation, 4) ?? [0, 0, 0, 1], s = nums(node.scale, 3) ?? [1, 1, 1];
  const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
  return Float64Array.from([
    (1 - (y * y2 + z * z2)) * s[0], (x * y2 + w * z2) * s[0], (x * z2 - w * y2) * s[0], 0,
    (x * y2 - w * z2) * s[1], (1 - (x * x2 + z * z2)) * s[1], (y * z2 + w * x2) * s[1], 0,
    (x * z2 + w * y2) * s[2], (y * z2 - w * x2) * s[2], (1 - (x * x2 + y * y2)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ]);
}

// ---- looking before unpacking ---------------------------------------------------------------------

const KNOWN = /^(KHR_mesh_quantization|EXT_meshopt_compression|KHR_meshopt_compression|KHR_texture_transform|EXT_texture_webp|KHR_texture_basisu|KHR_materials_\w+|KHR_lights_punctual|KHR_xmp_json_ld|EXT_mesh_gpu_instancing)$/;
const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

export interface Instance { mesh: number; matrix: Mat4 }
export interface Inspect {
  /** Triangles drawn, counting a mesh once for every node that shows it. */
  triangles: number;
  /** Mesh parts with triangles, counted the same way. */
  parts: number;
  /** What is drawn: each mesh with where its node puts it. */
  instances: Instance[];
  /** Animations, skins or morph targets: left out of a static piece. */
  animated: boolean;
  /** Points and lines, which a piece does not have. */
  skipped: number;
}

/** How many triangles a mesh part has (0 for points and lines). Throws on one that is not a mesh part at all. */
function partTriangles(json: Json, prim: Json): number {
  const accessors = list(json.accessors);
  if (!isObj(prim) || !isObj(prim.attributes)) return bad('That model is damaged (a mesh without points).');
  if (isObj(prim.extensions) && prim.extensions.KHR_draco_mesh_compression) bad('That model is Draco-compressed, which this app does not unpack. Export it without Draco compression (plain or Meshopt).');
  const mode = prim.mode === undefined ? 4 : prim.mode;
  const at = index(prim.indices ?? prim.attributes.POSITION, accessors.length);
  if (at < 0) return bad('That model is damaged (a mesh points at nothing).');
  const n = accessors[at].count;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return bad('That model is damaged.');
  if (n > MAX_COUNT) return bad(`That model is far too large (one part alone has ${count(n)} points).`);
  return mode === 4 ? Math.floor(n / 3) : mode === 5 || mode === 6 ? Math.max(0, n - 2) : 0;
}

/**
 * Read what a model's description says about it and refuse what cannot be taken in, before a
 * single vertex is unpacked: data in other files, Draco, extensions we would get wrong, graphs
 * that go round in circles, and more triangles than `maxTris`.
 */
export function inspect(json: Json, maxTris = INPUT_TRIS): Inspect {
  if (!isObj(json.asset) || !/^2(\.|$)/.test(String(json.asset.version))) bad('That .glb is of a version this app cannot read (only glTF 2).');
  for (const ext of list(json.extensionsRequired) as unknown[]) {
    if (ext === 'KHR_draco_mesh_compression') bad('That model is Draco-compressed, which this app does not unpack. Export it without Draco compression (plain or Meshopt).');
    if (typeof ext !== 'string' || !KNOWN.test(ext)) bad(`That model needs “${String(ext).slice(0, 40)}”, which this app cannot read.`);
  }
  const buffers = list(json.buffers), nodes = list(json.nodes), meshes = list(json.meshes);
  for (const b of buffers) {
    if (!isObj(b) || (b.uri !== undefined && !(typeof b.uri === 'string' && b.uri.startsWith('data:')))) bad('That model keeps its data in other files. Export it as a single .glb with everything inside.');
  }
  if (list(json.images).length > MAX_IMAGES) bad('That model has too many pictures.');
  for (const im of list(json.images)) {
    if (!isObj(im) || (im.uri !== undefined && !(typeof im.uri === 'string' && im.uri.startsWith('data:')))) bad('That model keeps its pictures in other files. Export it as a single .glb with everything inside.');
  }
  if (nodes.length > MAX_NODES) bad('That model is too complicated (too many parts).');
  // The scene to show: the one named, else the first, else every node nothing else holds.
  const scenes = list(json.scenes), scene = scenes[index(json.scene ?? 0, scenes.length)];
  let roots: unknown[];
  if (isObj(scene)) roots = list(scene.nodes);
  else {
    const held = new Set<number>();
    for (const n of nodes) for (const c of list(n?.children) as unknown[]) held.add(c as number);
    roots = nodes.map((_, i) => i).filter((i) => !held.has(i));
  }
  const out: Inspect = { triangles: 0, parts: 0, instances: [], animated: list(json.animations).length > 0 || list(json.skins).length > 0, skipped: 0 };
  const meshTris = new Map<number, [tris: number, parts: number, skipped: number]>();
  const stack: [node: number, parent: ArrayLike<number>, depth: number][] = [];
  for (const r of [...roots].reverse()) stack.push([r as number, IDENTITY, 0]);
  let visits = 0;
  while (stack.length) {
    const [ni, parent, depth] = stack.pop()!, node = nodes[index(ni, nodes.length)];
    if (!isObj(node)) return bad('That model is damaged (it names a part it does not have).');
    // A graph that holds itself, or the same branch a thousand times over, is not a model.
    if (++visits > MAX_VISITS || depth > 64) return bad('That model is too complicated (its parts are nested too deep or too often).');
    const world = mul(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mi = index(node.mesh, meshes.length), mesh = meshes[mi];
      if (!isObj(mesh)) return bad('That model is damaged (it names a mesh it does not have).');
      let t = meshTris.get(mi);
      if (!t) {
        t = [0, 0, 0];
        for (const prim of list(mesh.primitives)) {
          const n = partTriangles(json, prim);
          if (n) { t[0] += n; t[1]++; } else t[2]++;
          if (isObj(prim) && list(prim.targets).length) out.animated = true;
        }
        meshTris.set(mi, t);
      }
      out.triangles += t[0]; out.parts += t[1]; out.skipped += t[2];
      if (out.triangles > maxTris) return bad(`That model has more than ${count(maxTris)} triangles. Make it simpler in the app it came from first.`);
      if (t[0]) out.instances.push({ mesh: mi, matrix: world });
    }
    const kids = list(node.children) as unknown[];
    for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i] as number, world, depth + 1]);
  }
  if (!out.triangles) bad('That model has nothing to draw (no triangles).');
  return out;
}

// ---- reading the data --------------------------------------------------------------------------------

export type MeshoptDecode = (target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string) => void;

/** Bounds-checked reads of a model's buffers. Every length a file states is checked against what is really there. */
export class GlbReader {
  private buffers = new Map<number, Uint8Array>();
  private views = new Map<number, { bytes: Uint8Array; stride: number }>();
  constructor(readonly json: Json, private bin: Uint8Array | null, private meshopt?: MeshoptDecode) {}

  private buffer(i: number): Uint8Array {
    let b = this.buffers.get(i);
    if (b) return b;
    const def = list(this.json.buffers)[index(i, list(this.json.buffers).length)];
    if (!isObj(def)) return bad('That model is damaged (it names data it does not have).');
    if (def.uri === undefined) {
      if (i !== 0 || !this.bin) return bad('That model is damaged (its data is missing).');
      b = this.bin;
    } else if (typeof def.uri === 'string' && def.uri.startsWith('data:')) {
      const comma = def.uri.indexOf(',');
      if (comma < 0 || !/;base64$/i.test(def.uri.slice(0, comma))) return bad('That model is damaged (its data cannot be read).');
      try { b = Uint8Array.from(atob(def.uri.slice(comma + 1)), (c) => c.charCodeAt(0)); } catch { return bad('That model is damaged (its data cannot be read).'); }
    } else return bad('That model keeps its data in other files. Export it as a single .glb with everything inside.');
    this.buffers.set(i, b);
    return b;
  }

  /** The bytes of a buffer view (unpacked, if Meshopt packed them) and how far apart its elements are (0: tightly packed). */
  view(i: number): { bytes: Uint8Array; stride: number } {
    let v = this.views.get(i);
    if (v) return v;
    const views = list(this.json.bufferViews), def = views[index(i, views.length)];
    if (!isObj(def)) return bad('That model is damaged (it names data it does not have).');
    const range = (d: Json): Uint8Array => {
      const buf = this.buffer(d.buffer), at = d.byteOffset ?? 0, n = d.byteLength;
      if (index(at, buf.length + 1) < 0 || index(n, buf.length + 1) < 0 || at + n > buf.length) return bad('That model is damaged (its data runs past the end of the file).');
      return buf.subarray(at, at + n);
    };
    const packed = isObj(def.extensions) ? def.extensions.EXT_meshopt_compression ?? def.extensions.KHR_meshopt_compression : undefined;
    if (isObj(packed)) {
      const n = packed.count, size = packed.byteStride;
      if (index(n, MAX_COUNT + 1) < 0 || index(size, 257) < 1 || n * size > 64 * 1024 * 1024) return bad('That model is damaged (its packed data makes no sense).');
      if (!this.meshopt) return bad('That model is Meshopt-compressed, which cannot be unpacked here.');
      const bytes = new Uint8Array(n * size);
      try { this.meshopt(bytes, n, size, range(packed), typeof packed.mode === 'string' ? packed.mode : 'ATTRIBUTES', typeof packed.filter === 'string' ? packed.filter : 'NONE'); } catch (e) {
        if (e instanceof ModelError) throw e;
        return bad('That model is damaged (its packed data cannot be unpacked).');
      }
      v = { bytes, stride: packed.mode === 'ATTRIBUTES' || packed.mode === undefined ? size : 0 };
    } else v = { bytes: range(def), stride: index(def.byteStride ?? 0, 256) > 0 ? def.byteStride : 0 };
    this.views.set(i, v);
    return v;
  }

  /** An accessor as plain numbers: `comps` to an element (0: whatever it has), integers scaled to 0–1 where the file says so. */
  floats(i: number, comps = 0): { data: Float32Array; comps: number; count: number } {
    const accessors = list(this.json.accessors), a = accessors[index(i, accessors.length)];
    if (!isObj(a)) return bad('That model is damaged (it names data it does not have).');
    const have = SIZES[a.type as string], size = BYTES[a.componentType as number], n = a.count;
    if (!have || !size || (comps && have !== comps) || index(n, MAX_COUNT + 1) < 0) return bad('That model is damaged (its data is not of the kind it should be).');
    if (a.sparse !== undefined) return bad('That model uses “sparse” data, which this app cannot read.');
    const data = new Float32Array(n * have);
    if (a.bufferView === undefined) return { data, comps: have, count: n };
    const { bytes, stride } = this.view(a.bufferView), step = stride || have * size, at = a.byteOffset ?? 0;
    if (index(at, bytes.length + 1) < 0 || (n > 0 && at + (n - 1) * step + have * size > bytes.length)) return bad('That model is damaged (its data runs past the end of the file).');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), t = a.componentType as number, norm = a.normalized === true;
    const k = !norm ? 1 : t === 5120 ? 1 / 127 : t === 5121 ? 1 / 255 : t === 5122 ? 1 / 32767 : t === 5123 ? 1 / 65535 : 1;
    for (let e = 0, o = 0; e < n; e++) {
      for (let c = 0, p = at + e * step; c < have; c++, p += size) {
        const v = t === 5126 ? dv.getFloat32(p, true) : t === 5123 ? dv.getUint16(p, true) : t === 5121 ? dv.getUint8(p) : t === 5122 ? dv.getInt16(p, true) : t === 5120 ? dv.getInt8(p) : dv.getUint32(p, true);
        data[o++] = norm && v * k < -1 ? -1 : v * k;
      }
    }
    return { data, comps: have, count: n };
  }

  /** An index accessor; every index is below `limit`. */
  indices(i: number, limit: number): Uint32Array {
    const accessors = list(this.json.accessors), a = accessors[index(i, accessors.length)];
    if (!isObj(a) || a.type !== 'SCALAR' || ![5121, 5123, 5125].includes(a.componentType) || index(a.count, MAX_COUNT + 1) < 0 || a.sparse !== undefined || a.bufferView === undefined) return bad('That model is damaged (its triangles cannot be read).');
    const { bytes } = this.view(a.bufferView), size = BYTES[a.componentType as number], at = a.byteOffset ?? 0, n = a.count as number;
    if (index(at, bytes.length + 1) < 0 || at + n * size > bytes.length) return bad('That model is damaged (its data runs past the end of the file).');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Uint32Array(n);
    for (let e = 0; e < n; e++) {
      const v = size === 4 ? dv.getUint32(at + e * 4, true) : size === 2 ? dv.getUint16(at + e * 2, true) : dv.getUint8(at + e);
      if (v >= limit) return bad('That model is damaged (a triangle uses a point that is not there).');
      out[e] = v;
    }
    return out;
  }

  /** A picture inside the model, with the size its header states. Null for one that is not a PNG, JPEG or WebP we can place. */
  image(i: number): { bytes: Uint8Array; mime: string; w: number; h: number } | null {
    const images = list(this.json.images), def = images[index(i, images.length)];
    if (!isObj(def)) return null;
    let bytes: Uint8Array;
    if (def.bufferView !== undefined) bytes = this.view(def.bufferView).bytes;
    else if (typeof def.uri === 'string' && def.uri.startsWith('data:')) {
      const comma = def.uri.indexOf(',');
      try { bytes = Uint8Array.from(atob(def.uri.slice(comma + 1)), (c) => c.charCodeAt(0)); } catch { return null; }
    } else return null;
    const size = imageSize(bytes.subarray(0, 512 * 1024));
    if (!size || size.type === 'gif') return null;
    if (Math.max(size.w, size.h) > IMAGE_SIDE) return bad(`That model has a picture of ${count(size.w)} × ${count(size.h)} pixels; at most ${count(IMAGE_SIDE)} a side can be taken in.`);
    return { bytes, mime: `image/${size.type}`, w: size.w, h: size.h };
  }
}

// ---- several pictures into one ----------------------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }
export interface Atlas { /** The side of the (square) atlas. */ size: number; /** How much the pictures were shrunk (1: not at all). */ scale: number; rects: Rect[] }

function shelves(items: readonly { w: number; h: number; fixed?: boolean }[], k: number, size: number, pad: number): Rect[] | null {
  const dims = items.map((it) => (it.fixed ? { w: it.w, h: it.h } : { w: Math.max(4, Math.round(it.w * k)), h: Math.max(4, Math.round(it.h * k)) }));
  const order = dims.map((_, i) => i).sort((a, b) => dims[b].h - dims[a].h || a - b), rects: Rect[] = new Array(items.length);
  let x = pad, y = pad, row = 0;
  for (const i of order) {
    const { w, h } = dims[i];
    if (w + pad * 2 > size) return null;
    if (x + w + pad > size) { y += row + pad; x = pad; row = 0; }
    if (y + h + pad > size) return null;
    rects[i] = { x, y, w, h };
    x += w + pad;
    row = Math.max(row, h);
  }
  return rects;
}

/**
 * Lay pictures out in one square atlas of at most `max` pixels a side, `pad` pixels apart:
 * at their own size in the smallest square that holds them, else all shrunk alike until
 * they fit the largest. A `fixed` item is never shrunk.
 */
export function packAtlas(items: readonly { w: number; h: number; fixed?: boolean }[], max: number, pad = 2): Atlas {
  if (!items.length || items.some((it) => !(it.w >= 1 && it.h >= 1))) return bad('That model has a picture without a size.');
  for (let size = 64; size <= max; size *= 2) {
    const rects = shelves(items, 1, size, pad);
    if (rects) return { size, scale: 1, rects };
  }
  const area = items.reduce((n, it) => n + (it.w + pad) * (it.h + pad), 0), side = Math.max(...items.map((it) => Math.max(it.w, it.h)));
  for (let k = Math.min(1, Math.sqrt((max * max) / area), (max - pad * 2) / side); k > 0.001; k *= 0.93) {
    const rects = shelves(items, k, max, pad);
    if (rects) return { size: max, scale: k, rects };
  }
  return bad('That model has too many pictures to fit on one.');
}
