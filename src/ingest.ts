// From somebody's .glb to a piece a phone can afford: the whole pipeline, run in a worker
// (ingest.worker.ts) and, without pictures, under node (unit tests).
//
//   read and check → unpack every mesh where its node puts it (animations, skins, morph targets,
//   cameras and lights are simply never read) → paint each material's colour into the vertices →
//   put the base-colour pictures on ONE atlas and point the UVs at it → stand the model on the
//   ground, one unit across → weld → simplify to the budget → quantise, Meshopt-compress and
//   write one small GLB with one mesh, one material and at most one texture.
//
// Hand-rolled on `meshoptimizer` (simplifier, encoder, decoder) and glb.ts rather than
// glTF-Transform: a third of the code to ship, and every length a file states is checked here.
// A model that cannot be brought inside the budget is refused with the reason, never mangled.
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { GlbReader, ModelError, PIECE, SET, inspect, packAtlas, packGlb, splitGlb, type Json, type Mat4, type ModelBudget, type Rect } from './glb';

export interface AtlasJob {
  size: number;
  items: { bytes: Uint8Array; mime: string; x: number; y: number; w: number; h: number }[];
  /** A patch to paint plain white: where parts without a picture point their UVs. */
  white: Rect;
  /** The most the encoded picture may weigh. */
  maxBytes: number;
}
export interface IngestHooks {
  /** Called as each step begins, with words for the person waiting. */
  step?(text: string): void;
  /** Draw and encode an atlas; null if it cannot be made that small. Without this hook, pictures are left out. */
  atlas?(job: AtlasJob): Promise<{ bytes: Uint8Array; mime: string } | null>;
}
export interface IngestStats {
  trisIn: number; trisOut: number; bytesIn: number; bytesOut: number;
  /** The model had animations, skins or morph targets (left out). */
  animated: boolean;
  /** It has a texture: the side of its atlas (0: colours in the vertices only). */
  atlas: number;
  /** Its size as stored (the longest is 1). */
  size: [x: number, y: number, z: number];
  /** Things the GM should know, in words. */
  notes: string[];
}
export interface Ingested { glb: Uint8Array; stats: IngestStats }

const bad = (why: string): never => { throw new ModelError(why); };
const num = (n: number) => n.toLocaleString('en-US');

interface Paint { rgb: [number, number, number]; image: number; set: number; xf: [ox: number, oy: number, a: number, b: number, c: number, d: number] | null; rough: number }

/** What a material paints with: its colour, and its base-colour picture if it has one we can place. */
function paintOf(json: Json, mi: unknown): Paint {
  const m = (Array.isArray(json.materials) && typeof mi === 'number' ? json.materials[mi] : null) ?? {};
  const pbr = m.pbrMetallicRoughness ?? {}, old = m.extensions?.KHR_materials_pbrSpecularGlossiness;
  const factor = old?.diffuseFactor ?? pbr.baseColorFactor, ref = old?.diffuseTexture ?? pbr.baseColorTexture;
  const rgb: [number, number, number] = Array.isArray(factor) && factor.length >= 3 && factor.slice(0, 3).every((v: unknown) => typeof v === 'number' && Number.isFinite(v))
    ? [factor[0], factor[1], factor[2]].map((v) => Math.min(1, Math.max(0, v))) as [number, number, number] : [1, 1, 1];
  const paint: Paint = { rgb, image: -1, set: 0, xf: null, rough: typeof pbr.roughnessFactor === 'number' ? Math.min(1, Math.max(0, pbr.roughnessFactor)) : old ? 0.8 : 1 };
  const tex = ref && Array.isArray(json.textures) ? json.textures[ref.index] : null;
  if (tex && typeof tex === 'object') {
    const src = tex.extensions?.EXT_texture_webp?.source ?? tex.source;
    if (typeof src === 'number' && Number.isInteger(src) && src >= 0) {
      paint.image = src;
      const t = ref.extensions?.KHR_texture_transform;
      paint.set = Number.isInteger(t?.texCoord ?? ref.texCoord) ? t?.texCoord ?? ref.texCoord : 0;
      if (t && typeof t === 'object') {
        const [ox, oy] = Array.isArray(t.offset) ? t.offset : [0, 0], [sx, sy] = Array.isArray(t.scale) ? t.scale : [1, 1], r = typeof t.rotation === 'number' ? t.rotation : 0;
        const xf = [ox, oy, Math.cos(r) * sx, Math.sin(r) * sy, -Math.sin(r) * sx, Math.cos(r) * sy].map(Number) as NonNullable<Paint['xf']>;
        if (xf.every(Number.isFinite)) paint.xf = xf;
      }
    }
  }
  return paint;
}

/** Vertex normals from the triangles around each vertex (for parts that came without). */
function normalsOf(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    for (const v of [a, b, c]) { n[v] += x; n[v + 1] += y; n[v + 2] += z; }
  }
  return n;
}

/** The whole model as one indexed mesh, in the space of its scene. */
interface Soup {
  pos: Float32Array; nrm: Float32Array; uv: Float32Array; col: Float32Array; idx: Uint32Array;
  /** Which vertices use which picture (-1: none). */
  runs: { from: number; to: number; image: number }[];
  rough: number;
}

function gather(r: GlbReader, instances: { mesh: number; matrix: Mat4 }[]): Soup {
  const parts: { pos: Float32Array; nrm: Float32Array; uv: Float32Array; col: Float32Array; idx: Uint32Array; image: number }[] = [];
  const json = r.json;
  let verts = 0, tris = 0, rough = 0;
  for (const { mesh, matrix: m } of instances) {
    for (const prim of json.meshes[mesh].primitives as Json[]) {
      const mode = prim.mode === undefined ? 4 : prim.mode;
      if (mode !== 4 && mode !== 5 && mode !== 6) continue;
      const P = r.floats(prim.attributes.POSITION, 3), n = P.count, paint = paintOf(json, prim.material);
      let pos = P.data;
      let idx: Uint32Array;
      if (prim.indices !== undefined) idx = r.indices(prim.indices, n);
      else { idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
      if (mode !== 4) { // strips and fans, as plain triangles
        const out = new Uint32Array(Math.max(0, idx.length - 2) * 3);
        for (let i = 2, o = 0; i < idx.length; i++) {
          if (mode === 6) { out[o++] = idx[0]; out[o++] = idx[i - 1]; out[o++] = idx[i]; } else if (i % 2 === 0) { out[o++] = idx[i - 2]; out[o++] = idx[i - 1]; out[o++] = idx[i]; } else { out[o++] = idx[i - 1]; out[o++] = idx[i - 2]; out[o++] = idx[i]; }
        }
        idx = out;
      } else if (idx.length % 3) idx = idx.subarray(0, idx.length - (idx.length % 3));
      if (!idx.length) continue;
      const given = prim.attributes.NORMAL !== undefined ? r.floats(prim.attributes.NORMAL, 3) : null;
      let nrm = given && given.count === n ? given.data : normalsOf(pos, idx);
      const colour = prim.attributes.COLOR_0 !== undefined ? r.floats(prim.attributes.COLOR_0) : null;
      let col = new Float32Array(n * 3);
      const own = colour && colour.count === n && colour.comps >= 3 ? colour : null;
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) col[i * 3 + c] = paint.rgb[c] * (own ? Math.min(1, Math.max(0, own.data[i * own.comps + c])) : 1);
      const coords = paint.image >= 0 && prim.attributes[`TEXCOORD_${paint.set}`] !== undefined ? r.floats(prim.attributes[`TEXCOORD_${paint.set}`], 2) : null;
      let uv: Float32Array = new Float32Array(n * 2), image = -1;
      if (coords && coords.count === n) {
        image = paint.image;
        uv = coords.data;
        let tiled = false;
        for (let i = 0; i < n * 2; i += 2) {
          let u = uv[i], v = uv[i + 1];
          if (paint.xf) { const [ox, oy, a, b, c, d] = paint.xf; [u, v] = [ox + a * u + b * v, oy + c * u + d * v]; }
          if (!Number.isFinite(u) || !Number.isFinite(v)) u = v = 0;
          uv[i] = u; uv[i + 1] = v;
          if (u < -0.002 || u > 1.002 || v < -0.002 || v > 1.002) tiled = true;
        }
        if (tiled) {
          // A picture that repeats cannot repeat inside an atlas: give every triangle corners of its
          // own and move each triangle back onto the picture's first copy.
          const k = idx.length, p2 = new Float32Array(k * 3), n2 = new Float32Array(k * 3), c2 = new Float32Array(k * 3), u2 = new Float32Array(k * 2);
          for (let t = 0; t < k; t += 3) {
            const fu = Math.floor(Math.min(uv[idx[t] * 2], uv[idx[t + 1] * 2], uv[idx[t + 2] * 2]) + 1e-4), fv = Math.floor(Math.min(uv[idx[t] * 2 + 1], uv[idx[t + 1] * 2 + 1], uv[idx[t + 2] * 2 + 1]) + 1e-4);
            for (let e = t; e < t + 3; e++) {
              const s = idx[e];
              p2.set(pos.subarray(s * 3, s * 3 + 3), e * 3); n2.set(nrm.subarray(s * 3, s * 3 + 3), e * 3); c2.set(col.subarray(s * 3, s * 3 + 3), e * 3);
              u2[e * 2] = uv[s * 2] - fu; u2[e * 2 + 1] = uv[s * 2 + 1] - fv;
              idx[e] = e;
            }
          }
          pos = p2; nrm = n2; col = c2; uv = u2;
        }
        for (let i = 0; i < uv.length; i++) uv[i] = Math.min(1, Math.max(0, uv[i]));
      }
      // Where the node puts it: points by its matrix, normals by the matrix's cofactors (which
      // keeps them square to the surface under any stretch), and a mirror turns triangles over.
      const c00 = m[5] * m[10] - m[6] * m[9], c01 = m[6] * m[8] - m[4] * m[10], c02 = m[4] * m[9] - m[5] * m[8];
      const c10 = m[2] * m[9] - m[1] * m[10], c11 = m[0] * m[10] - m[2] * m[8], c12 = m[1] * m[8] - m[0] * m[9];
      const c20 = m[1] * m[6] - m[2] * m[5], c21 = m[2] * m[4] - m[0] * m[6], c22 = m[0] * m[5] - m[1] * m[4];
      const det = m[0] * c00 + m[1] * c01 + m[2] * c02, sign = det < 0 ? -1 : 1;
      const wp = new Float32Array(pos.length), wn = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        wp[i] = m[0] * x + m[4] * y + m[8] * z + m[12]; wp[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; wp[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        const a = nrm[i], b = nrm[i + 1], c = nrm[i + 2];
        let nx = (c00 * a + c10 * b + c20 * c) * sign, ny = (c01 * a + c11 * b + c21 * c) * sign, nz = (c02 * a + c12 * b + c22 * c) * sign;
        const l = Math.hypot(nx, ny, nz);
        if (l > 1e-20 && Number.isFinite(l)) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 1; nz = 0; }
        wn[i] = nx; wn[i + 1] = ny; wn[i + 2] = nz;
      }
      if (det < 0) for (let t = 0; t < idx.length; t += 3) { const s = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = s; }
      parts.push({ pos: wp, nrm: wn, uv, col, idx, image });
      verts += wp.length / 3;
      tris += idx.length / 3;
      rough += paint.rough * idx.length;
    }
  }
  if (!tris) bad('That model has nothing to draw (no triangles).');
  const out: Soup = { pos: new Float32Array(verts * 3), nrm: new Float32Array(verts * 3), uv: new Float32Array(verts * 2), col: new Float32Array(verts * 3), idx: new Uint32Array(tris * 3), runs: [], rough: rough / (tris * 3) };
  let v = 0, t = 0;
  for (const p of parts) {
    out.pos.set(p.pos, v * 3); out.nrm.set(p.nrm, v * 3); out.uv.set(p.uv, v * 2); out.col.set(p.col, v * 3);
    for (let i = 0; i < p.idx.length; i++) out.idx[t + i] = p.idx[i] + v;
    out.runs.push({ from: v, to: v + p.pos.length / 3, image: p.image });
    v += p.pos.length / 3;
    t += p.idx.length;
  }
  return out;
}

/** Stand the model on the ground, centred, its longest side one unit. Returns its size. */
function settle(pos: Float32Array): [number, number, number] {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const v = pos[i], c = i % 3;
    if (!Number.isFinite(v) || Math.abs(v) > 1e12) return bad('That model is damaged (some of its points are nowhere).');
    if (v < lo[c]) lo[c] = v;
    if (v > hi[c]) hi[c] = v;
  }
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], longest = Math.max(...size);
  if (!(longest > 1e-9)) return bad('That model has no size (all its points are in one place).');
  const k = 1 / longest, off = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2];
  for (let i = 0; i < pos.length; i++) pos[i] = (pos[i] - off[i % 3]) * k;
  return [size[0] * k, size[1] * k, size[2] * k];
}

/** Join vertices that would be stored as the same one, and drop triangles that have collapsed. */
function weld(s: Soup, textured: boolean): Soup {
  const n = s.pos.length / 3, keys = new Int32Array(n * 4), q = (v: number, top: number) => Math.round(Math.min(1, Math.max(0, v)) * top);
  for (let i = 0; i < n; i++) {
    const p = i * 3, nq = (c: number) => q(s.nrm[p + c] * 0.5 + 0.5, 30);
    keys[i * 4] = q(s.pos[p] + 0.5, 65535) | (q(s.pos[p + 1], 65535) << 16);
    keys[i * 4 + 1] = q(s.pos[p + 2] + 0.5, 65535) | (nq(0) << 16) | (nq(1) << 21) | (nq(2) << 26);
    keys[i * 4 + 2] = (textured ? q(s.uv[i * 2], 4095) | (q(s.uv[i * 2 + 1], 4095) << 12) : 0) | (q(s.col[p], 255) << 24);
    keys[i * 4 + 3] = q(s.col[p + 1], 255) | (q(s.col[p + 2], 255) << 8);
  }
  let cap = 1024;
  while (cap < n * 2) cap *= 2;
  const table = new Int32Array(cap).fill(-1), remap = new Uint32Array(n), first = new Uint32Array(n);
  let unique = 0;
  for (let i = 0; i < n; i++) {
    const a = keys[i * 4], b = keys[i * 4 + 1], c = keys[i * 4 + 2], d = keys[i * 4 + 3];
    let h = Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca6b) ^ Math.imul(c, 0xc2b2ae35) ^ Math.imul(d, 0x27d4eb2f);
    h = (h ^ (h >>> 15)) & (cap - 1);
    for (;;) {
      const e = table[h];
      if (e < 0) { table[h] = unique; first[unique] = i; remap[i] = unique++; break; }
      const f = first[e] * 4;
      if (keys[f] === a && keys[f + 1] === b && keys[f + 2] === c && keys[f + 3] === d) { remap[i] = e; break; }
      h = (h + 1) & (cap - 1);
    }
  }
  const out: Soup = { pos: new Float32Array(unique * 3), nrm: new Float32Array(unique * 3), uv: new Float32Array(unique * 2), col: new Float32Array(unique * 3), idx: new Uint32Array(s.idx.length), runs: [], rough: s.rough };
  for (let u = 0; u < unique; u++) {
    const i = first[u];
    out.pos.set(s.pos.subarray(i * 3, i * 3 + 3), u * 3); out.nrm.set(s.nrm.subarray(i * 3, i * 3 + 3), u * 3); out.col.set(s.col.subarray(i * 3, i * 3 + 3), u * 3);
    out.uv.set(s.uv.subarray(i * 2, i * 2 + 2), u * 2);
  }
  let k = 0;
  for (let t = 0; t < s.idx.length; t += 3) {
    const a = remap[s.idx[t]], b = remap[s.idx[t + 1]], c = remap[s.idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    out.idx[k++] = a; out.idx[k++] = b; out.idx[k++] = c;
  }
  out.idx = out.idx.subarray(0, k);
  return out;
}

/** Keep only the vertices the triangles still use, in the order `order` gives them (old index → new, or 0xffffffff). */
function compact(s: Soup, order: Uint32Array, unique: number): Soup {
  const out: Soup = { pos: new Float32Array(unique * 3), nrm: new Float32Array(unique * 3), uv: new Float32Array(unique * 2), col: new Float32Array(unique * 3), idx: s.idx, runs: [], rough: s.rough };
  for (let i = 0; i < order.length; i++) {
    const u = order[i];
    if (u === 0xffffffff) continue;
    out.pos.set(s.pos.subarray(i * 3, i * 3 + 3), u * 3); out.nrm.set(s.nrm.subarray(i * 3, i * 3 + 3), u * 3); out.col.set(s.col.subarray(i * 3, i * 3 + 3), u * 3);
    out.uv.set(s.uv.subarray(i * 2, i * 2 + 2), u * 2);
  }
  return out;
}

/** Fewer triangles, keeping the shape (and, as far as it can, the colours and seams): at most `max`, or the reason it cannot be done. */
function simplify(s: Soup, max: number, textured: boolean): Soup {
  const n = s.pos.length / 3, stride = textured ? 8 : 6, attrs = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    attrs.set(s.nrm.subarray(i * 3, i * 3 + 3), i * stride);
    attrs.set(s.col.subarray(i * 3, i * 3 + 3), i * stride + 3);
    if (textured) attrs.set(s.uv.subarray(i * 2, i * 2 + 2), i * stride + 6);
  }
  const weights = [0.5, 0.5, 0.5, 0.4, 0.4, 0.4, ...(textured ? [1, 1] : [])], target = Math.floor(max * 0.98) * 3;
  let idx = s.idx;
  // Gently first, and only then letting go of loose crumbs smaller than the error allowed (a scan
  // is full of them); a model that needs more than this to fit would no longer be itself.
  for (const [error, prune] of [[0.01, false], [0.03, false], [0.05, true], [0.1, true]] as const) {
    [idx] = MeshoptSimplifier.simplifyWithAttributes(idx, s.pos, 3, attrs, stride, weights, null, target, error, prune ? ['Prune'] : []);
    if (idx.length / 3 <= max) break;
  }
  if (idx.length / 3 > max) {
    return bad(`This model cannot be made simple enough without wrecking its shape: it has ${num(s.idx.length / 3)} triangles, a piece may have ${num(max)}, and it stops at ${num(idx.length / 3)}. Make it simpler in the app it came from${max < SET.tris ? ', or bring it in as a set piece' : ''}.`);
  }
  if (!idx.length) return bad('Nothing was left of this model after making it simpler.');
  return { ...s, idx };
}

const pad4 = (n: number) => (n + 3) & ~3;

/** Quantise, compress and write: one mesh, one material, at most one picture. */
function write(s: Soup, tex: { bytes: Uint8Array; mime: string } | null): Uint8Array {
  // The order a GPU likes (and that compresses best), and only the vertices still in use.
  const [order, unique] = MeshoptEncoder.reorderMesh(s.idx, true, true);
  s = compact(s, order, unique);
  const n = unique, idx = s.idx, small = n <= 65535;
  const P = new Uint16Array(n * 4), N = new Float32Array(n * 4), C = new Uint8Array(n * 4), U = new Uint16Array(n * 2);
  const q = (v: number, top: number) => Math.round(Math.min(1, Math.max(0, v)) * top);
  for (let i = 0; i < n; i++) {
    P[i * 4] = q(s.pos[i * 3] + 0.5, 65535); P[i * 4 + 1] = q(s.pos[i * 3 + 1], 65535); P[i * 4 + 2] = q(s.pos[i * 3 + 2] + 0.5, 65535);
    N[i * 4] = s.nrm[i * 3]; N[i * 4 + 1] = s.nrm[i * 3 + 1]; N[i * 4 + 2] = s.nrm[i * 3 + 2];
    C[i * 4] = q(s.col[i * 3], 255); C[i * 4 + 1] = q(s.col[i * 3 + 1], 255); C[i * 4 + 2] = q(s.col[i * 3 + 2], 255); C[i * 4 + 3] = 255;
    U[i * 2] = q(s.uv[i * 2], 65535); U[i * 2 + 1] = q(s.uv[i * 2 + 1], 65535);
  }
  const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const I = small ? Uint16Array.from(idx) : idx;
  const chunks: Uint8Array[] = [], views: Json[] = [], accessors: Json[] = [];
  let at = 0, plain = 0;
  /** A Meshopt-packed view: its bytes in the file, and its place in the stand-in buffer a reader without Meshopt would look in. */
  const packed = (raw: Uint8Array, count: number, size: number, mode: 'ATTRIBUTES' | 'TRIANGLES', filter?: string) => {
    const data = MeshoptEncoder.encodeGltfBuffer(raw, count, size, mode);
    views.push({
      buffer: 1, byteOffset: plain, byteLength: count * size, ...(mode === 'ATTRIBUTES' ? { byteStride: size, target: 34962 } : { target: 34963 }),
      extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: at, byteLength: data.length, byteStride: size, count, mode, ...(filter ? { filter } : {}) } },
    });
    chunks.push(data);
    at += pad4(data.length);
    plain += pad4(count * size);
    return views.length - 1;
  };
  accessors.push({ bufferView: packed(bytesOf(I), idx.length, small ? 2 : 4, 'TRIANGLES'), componentType: small ? 5123 : 5125, count: idx.length, type: 'SCALAR' });
  accessors.push({ bufferView: packed(bytesOf(P), n, 8, 'ATTRIBUTES'), componentType: 5123, normalized: true, count: n, type: 'VEC3', min: [0, 0, 0], max: [65535, 65535, 65535] });
  accessors.push({ bufferView: packed(MeshoptEncoder.encodeFilterOct(N, n, 4, 8), n, 4, 'ATTRIBUTES', 'OCTAHEDRAL'), componentType: 5120, normalized: true, count: n, type: 'VEC3' });
  accessors.push({ bufferView: packed(C, n, 4, 'ATTRIBUTES'), componentType: 5121, normalized: true, count: n, type: 'VEC4' });
  const attributes: Json = { POSITION: 1, NORMAL: 2, COLOR_0: 3 };
  const material: Json = { pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: Math.round(Math.min(1, Math.max(0.3, s.rough)) * 100) / 100 } };
  const json: Json = {
    asset: { version: '2.0', generator: 'cottontale' },
    extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'], extensionsRequired: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [-0.5, 0, -0.5] }],
    meshes: [{ primitives: [{ attributes, indices: 0, material: 0, mode: 4 }] }], materials: [material], accessors, bufferViews: views,
  };
  if (tex) {
    accessors.push({ bufferView: packed(bytesOf(U), n, 4, 'ATTRIBUTES'), componentType: 5123, normalized: true, count: n, type: 'VEC2' });
    attributes.TEXCOORD_0 = 4;
    views.push({ buffer: 0, byteOffset: at, byteLength: tex.bytes.length });
    chunks.push(tex.bytes);
    at += pad4(tex.bytes.length);
    json.images = [{ bufferView: views.length - 1, mimeType: tex.mime }];
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
    if (tex.mime === 'image/webp') {
      json.textures = [{ sampler: 0, extensions: { EXT_texture_webp: { source: 0 } } }];
      json.extensionsUsed.push('EXT_texture_webp'); json.extensionsRequired.push('EXT_texture_webp');
    } else json.textures = [{ sampler: 0, source: 0 }];
    material.pbrMetallicRoughness.baseColorTexture = { index: 0 };
  }
  json.buffers = [{ byteLength: at }, { byteLength: plain, extensions: { EXT_meshopt_compression: { fallback: true } } }];
  const bin = new Uint8Array(at);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += pad4(c.length); }
  return packGlb(json, bin);
}

/** Make a piece of a .glb, inside the budget of a figure or thing, or of a set piece. Throws `ModelError` with the reason it cannot. */
export async function ingest(file: Uint8Array, opts: { set?: boolean } = {}, hooks: IngestHooks = {}): Promise<Ingested> {
  const budget: ModelBudget = opts.set ? SET : PIECE, step = (t: string) => hooks.step?.(t), notes: string[] = [];
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1), what = opts.set ? 'set piece' : 'piece';
  step('Checking the file');
  const { json, bin } = splitGlb(file), seen = inspect(json);
  await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const reader = new GlbReader(json, bin, (target, n, size, source, mode, filter) => MeshoptDecoder.decodeGltfBuffer(target, n, size, source, mode, filter));
  if (seen.animated) notes.push('It had animations or a skeleton: those are left out, and it stands as it was modelled.');
  if (seen.skipped) notes.push('Its loose points and lines are left out.');

  step(`Unpacking ${num(seen.triangles)} triangles in ${num(seen.parts)} part${seen.parts === 1 ? '' : 's'}`);
  const soup = gather(reader, seen.instances), trisIn = soup.idx.length / 3;

  // The pictures: every base-colour picture in use, once each, checked by its header before anything is decoded.
  const used = [...new Set(soup.runs.map((r) => r.image).filter((i) => i >= 0))];
  const pics = new Map<number, NonNullable<ReturnType<GlbReader['image']>>>();
  for (const i of used) { const im = reader.image(i); if (im) pics.set(i, im); }
  const textured = pics.size > 0 && !!hooks.atlas;
  if (used.length && !textured) notes.push('Its pictures are in a format this phone cannot read: it keeps its plain colours only.');
  else if (pics.size < used.length) notes.push('Some of its pictures are in a format this phone cannot read: those parts keep their plain colours.');

  step('Standing it on the ground');
  const size = settle(soup.pos);
  let atlas = 0;
  const finish = (glb: Uint8Array): Ingested => {
    if (glb.length > budget.bytes) return bad(`This model cannot be made small enough: it comes to ${mb(glb.length)} MB and a ${what} may be ${mb(budget.bytes)} MB.`);
    // What was written is read back the way every other device will read it: if it would be refused there, it is refused here.
    const trisOut = inspect(splitGlb(glb).json, budget.tris).triangles;
    return { glb, stats: { trisIn, trisOut, bytesIn: file.length, bytesOut: glb.length, animated: seen.animated, atlas, size, notes } };
  };
  const shrink = (mesh: Soup): Soup => {
    if (mesh.idx.length / 3 <= budget.tris) return mesh;
    step(`Simplifying ${num(mesh.idx.length / 3)} triangles to ${num(budget.tris)}`);
    return simplify(mesh, budget.tris, textured);
  };

  step('Joining the parts');
  if (!textured) {
    const mesh = shrink(weld(soup, false));
    step('Squeezing it small');
    return finish(write(mesh, null));
  }
  // Each picture gets its own patch of one atlas, and parts without a picture point at a white
  // patch. The geometry is welded and simplified with its UVs already there; what it leaves of
  // the byte budget is the picture's. If the picture cannot be encoded that small, the same
  // again with an atlas half the size.
  const order = [...pics.keys()], items = [...order.map((i) => ({ w: pics.get(i)!.w, h: pics.get(i)!.h })), { w: 8, h: 8, fixed: true }];
  for (let max = budget.atlas; max >= 128;) {
    const lay = packAtlas(items, max), side = lay.size, white = lay.rects[lay.rects.length - 1], uv = new Float32Array(soup.uv.length);
    for (const run of soup.runs) {
      const r = lay.rects[order.indexOf(run.image)] as Rect | undefined;
      for (let v = run.from; v < run.to; v++) {
        // Half a pixel in from each edge of its picture, so neighbours on the atlas never show.
        if (r && run.image >= 0) { uv[v * 2] = (r.x + 0.5 + soup.uv[v * 2] * (r.w - 1)) / side; uv[v * 2 + 1] = (r.y + 0.5 + soup.uv[v * 2 + 1] * (r.h - 1)) / side; } else { uv[v * 2] = (white.x + 4) / side; uv[v * 2 + 1] = (white.y + 4) / side; }
      }
    }
    const mesh = shrink(weld({ ...soup, uv }, true)), bare = write(mesh, null).length;
    step(`Packing ${pics.size} picture${pics.size === 1 ? '' : 's'} onto one of ${side} pixels`);
    const made = await hooks.atlas!({ size: side, white, maxBytes: budget.bytes - bare - 4096, items: order.map((i, k) => ({ bytes: pics.get(i)!.bytes, mime: pics.get(i)!.mime, ...lay.rects[k] })) });
    if (made) {
      step('Squeezing it small');
      const glb = write(mesh, made);
      if (glb.length <= budget.bytes) {
        const k = Math.min(...order.map((i, n) => lay.rects[n].w / pics.get(i)!.w));
        if (k < 0.999) notes.push(`Its pictures were made ${Math.round((1 - k) * 100)}% smaller to share one of ${side} pixels.`);
        atlas = side;
        return finish(glb);
      }
    }
    max = side / 2;
  }
  return bad(`This model's pictures cannot be made small enough for a ${what} (${mb(budget.bytes)} MB in all).${opts.set ? '' : ' Bring it in as a set piece, or with smaller pictures.'}`);
}
