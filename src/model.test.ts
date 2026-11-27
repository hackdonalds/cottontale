import { describe, expect, it } from 'vitest';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { GLB_MIME, GlbReader, INPUT_BYTES, ModelError, PIECE, SET, glbHeader, inspect, packAtlas, packGlb, splitGlb, type Json } from './glb';
import { ingest, type AtlasJob } from './ingest';
import { cellsFor, fitScale, parseModel, turned } from './model';
import { checkStored } from './modelBuild';

// ---- models made here -------------------------------------------------------------------------------

interface Part { pos: number[]; idx: number[]; rgb?: [number, number, number]; uv?: number[]; image?: number; at?: [number, number, number] }

function box(w: number, h: number, d: number): { pos: number[]; idx: number[] } {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < 8; i++) pos.push(i & 1 ? w : 0, i & 2 ? h : 0, i & 4 ? d : 0);
  for (const [a, b, c, e] of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) idx.push(a, b, c, a, c, e);
  return { pos, idx };
}
function sphere(seg: number, r = 1): { pos: number[]; idx: number[]; uv: number[] } {
  const pos: number[] = [], idx: number[] = [], uv: number[] = [], rows = seg / 2;
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= seg; x++) {
    const a = (x / seg) * Math.PI * 2, b = (y / rows) * Math.PI;
    pos.push(Math.cos(a) * Math.sin(b) * r, Math.cos(b) * r, Math.sin(a) * Math.sin(b) * r);
    uv.push(x / seg, y / rows);
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < seg; x++) {
    const i = y * (seg + 1) + x;
    idx.push(i, i + 1, i + seg + 1, i + 1, i + seg + 2, i + seg + 1);
  }
  return { pos, idx, uv };
}
/** A PNG's first bytes: enough to say how big it is. */
function pngHead(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33), dv = new DataView(b.buffer);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  dv.setUint32(16, w); dv.setUint32(20, h);
  return b;
}
/** A plain GLB: one mesh, one material and one node for each part. */
function model(parts: Part[], images: Uint8Array[] = [], more: (json: Json) => void = () => {}): Uint8Array {
  const chunks: Uint8Array[] = [], views: Json[] = [], accessors: Json[] = [];
  let at = 0;
  const view = (bytes: Uint8Array) => { views.push({ buffer: 0, byteOffset: at, byteLength: bytes.length }); chunks.push(bytes); at += (bytes.length + 3) & ~3; return views.length - 1; };
  const acc = (a: Float32Array | Uint32Array, type: string) => { accessors.push({ bufferView: view(new Uint8Array(a.buffer)), componentType: a instanceof Float32Array ? 5126 : 5125, count: a.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3 } as Record<string, number>)[type], type }); return accessors.length - 1; };
  const json: Json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: parts.map((_, i) => i) }], nodes: [], meshes: [], materials: [], accessors, bufferViews: views };
  parts.forEach((p, i) => {
    const attributes: Json = { POSITION: acc(Float32Array.from(p.pos), 'VEC3') };
    if (p.uv) attributes.TEXCOORD_0 = acc(Float32Array.from(p.uv), 'VEC2');
    json.meshes.push({ primitives: [{ attributes, indices: acc(Uint32Array.from(p.idx), 'SCALAR'), material: i }] });
    json.materials.push({ pbrMetallicRoughness: { baseColorFactor: [...(p.rgb ?? [1, 1, 1]), 1], ...(p.image !== undefined ? { baseColorTexture: { index: p.image } } : {}) } });
    json.nodes.push({ mesh: i, ...(p.at ? { translation: p.at } : {}) });
  });
  if (images.length) {
    json.images = images.map((b) => ({ bufferView: view(b), mimeType: 'image/png' }));
    json.textures = images.map((_, i) => ({ source: i }));
  }
  const bin = new Uint8Array(at);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += (c.length + 3) & ~3; }
  json.buffers = [{ byteLength: at }];
  more(json);
  return packGlb(json, bin);
}
const BOXES = (): Part[] => [{ ...box(1, 2, 1), rgb: [1, 0, 0] }, { ...box(0.5, 0.5, 0.5), rgb: [0, 0, 1], at: [2, 0, 0] }, { ...box(1, 1, 1), rgb: [0, 1, 0], at: [0, 0, 3] }];
/** What a processed file holds, read the way glb.ts reads anything. */
async function read(glb: Uint8Array) {
  await MeshoptDecoder.ready;
  const { json, bin } = splitGlb(glb), r = new GlbReader(json, bin, (t, n, s, src, mode, filter) => MeshoptDecoder.decodeGltfBuffer(t, n, s, src, mode, filter));
  const prim = json.meshes[0].primitives[0], pos = r.floats(prim.attributes.POSITION, 3);
  return { json, pos, col: r.floats(prim.attributes.COLOR_0), uv: prim.attributes.TEXCOORD_0 !== undefined ? r.floats(prim.attributes.TEXCOORD_0, 2) : null, idx: r.indices(prim.indices, pos.count) };
}
const refuses = async (p: Promise<unknown> | (() => unknown), why: RegExp) => {
  let err: unknown;
  try { await (typeof p === 'function' ? p() : p); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(ModelError);
  expect((err as Error).message).toMatch(why);
};

// ---- the container and the checks before unpacking ------------------------------------------------------

describe('a .glb is looked at before it is unpacked', () => {
  it('reads the header and splits the chunks', () => {
    const glb = model(BOXES()), head = glbHeader(glb.subarray(0, 20), glb.length);
    expect(head.jsonAt).toBe(20);
    expect(head.length).toBe(glb.length);
    const { json, bin } = splitGlb(glb);
    expect(json.meshes).toHaveLength(3);
    expect(bin!.length).toBe(json.buffers[0].byteLength);
  });
  it('refuses what is not a model, cut short, of another version, or too large', async () => {
    const glb = model(BOXES());
    await refuses(() => glbHeader(new TextEncoder().encode('{"asset":{"version":"2.0"}}        ')), /\.gltf/);
    await refuses(() => glbHeader(new Uint8Array(40)), /not a \.glb/);
    await refuses(() => glbHeader(glb.subarray(0, 20), glb.length - 8), /cut short/);
    const v1 = glb.slice(); v1[4] = 1;
    await refuses(() => glbHeader(v1), /version/);
    await refuses(() => glbHeader(glb.subarray(0, 20), INPUT_BYTES + 1), /too large/);
    const long = glb.slice(); new DataView(long.buffer).setUint32(12, 0x7fffffff, true);
    await refuses(() => glbHeader(long), /too complicated|cut short/);
    const junk = glb.slice(); junk.fill(0x21, 20, 60);
    await refuses(() => splitGlb(junk), /damaged/);
  });
  it('counts triangles once for every node that shows a mesh', () => {
    const seen = inspect(splitGlb(model(BOXES(), [], (j) => { j.nodes.push({ mesh: 0, translation: [9, 0, 0] }); j.scenes[0].nodes.push(3); })).json);
    expect(seen.triangles).toBe(48);
    expect(seen.parts).toBe(4);
    expect(seen.instances).toHaveLength(4);
    expect([...seen.instances[3].matrix.slice(12, 15)]).toEqual([9, 0, 0]);
    expect(seen.animated).toBe(false);
  });
  it('says when a model had animations, skins or morph targets', () => {
    expect(inspect(splitGlb(model(BOXES(), [], (j) => { j.animations = [{}]; })).json).animated).toBe(true);
    expect(inspect(splitGlb(model(BOXES(), [], (j) => { j.meshes[0].primitives[0].targets = [{}]; })).json).animated).toBe(true);
  });
  it('refuses data and pictures kept in other files, without ever asking for them', async () => {
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.buffers.push({ byteLength: 10, uri: 'https://example.com/a.bin' }); })).json), /other files/);
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.buffers[0].uri = 'scene.bin'; })).json), /other files/);
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.images = [{ uri: '//example.com/a.png' }]; })).json), /pictures in other files/);
  });
  it('refuses Draco and extensions it would get wrong, by name', async () => {
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.extensionsRequired = ['KHR_draco_mesh_compression']; })).json), /Draco/);
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.meshes[1].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0 } }; })).json), /Draco/);
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.extensionsRequired = ['VENDOR_strange']; })).json), /VENDOR_strange/);
  });
  it('refuses more triangles than can be taken in, from the description alone', async () => {
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.accessors[1].count = 900_003; })).json), /more than 300,000 triangles/);
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.accessors[1].count = 2 ** 31; })).json), /far too large/);
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.accessors[1].count = -3; })).json), /damaged/);
    // The same mesh shown ten thousand times is ten thousand times the triangles.
    await refuses(() => inspect(splitGlb(model([{ ...sphere(8) }], [], (j) => { for (let i = 0; i < 10_000; i++) { j.nodes.push({ mesh: 0 }); j.scenes[0].nodes.push(i + 1); } })).json), /more than 300,000/);
  });
  it('refuses graphs that go round in circles or branch without end', async () => {
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.nodes[0].children = [0]; })).json), /nested too deep/);
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => {
      j.meshes.push({ primitives: [{ attributes: { POSITION: 0 }, mode: 0 }] }); // points: nothing to count, so only the visits can stop it
      for (let i = 0; i < 40; i++) j.nodes.push({ children: i < 39 ? [j.nodes.length + 1, j.nodes.length + 1] : [], mesh: 3 });
      j.scenes[0].nodes = [3];
    })).json), /nested too deep or too often/);
    await refuses(() => inspect(splitGlb(model(BOXES(), [], (j) => { j.scenes[0].nodes = [77]; })).json), /damaged/);
    await refuses(() => inspect(splitGlb(model([{ pos: [0, 0, 0], idx: [] }])).json), /nothing to draw/);
  });
  it('checks every length a file states against what is really there', async () => {
    const reader = (more: (j: Json) => void) => { const { json, bin } = splitGlb(model(BOXES(), [], more)); return new GlbReader(json, bin); };
    await refuses(() => reader((j) => { j.accessors[0].count = 5000; }).floats(0, 3), /past the end/);
    await refuses(() => reader((j) => { j.bufferViews[0].byteLength = 1e9; }).floats(0, 3), /past the end/);
    await refuses(() => reader((j) => { j.bufferViews[0].byteOffset = -4; }).floats(0, 3), /past the end/);
    await refuses(() => reader((j) => { j.accessors[0].byteOffset = 90; }).floats(0, 3), /past the end/);
    await refuses(() => reader((j) => { j.accessors[0].type = 'MAT9'; }).floats(0, 3), /not of the kind/);
    await refuses(() => reader((j) => { j.accessors[0].sparse = { count: 1 }; }).floats(0, 3), /sparse/);
    await refuses(() => reader(() => {}).indices(1, 4), /point that is not there/);
    await refuses(() => reader((j) => { j.bufferViews[0].extensions = { EXT_meshopt_compression: { buffer: 0, byteLength: 8, byteStride: 12, count: 1e9 } }; }).floats(0, 3), /packed data makes no sense/);
    await refuses(() => reader((j) => { j.bufferViews[0].buffer = 1; j.buffers.push({ byteLength: 4, uri: 'file:///etc/passwd' }); }).floats(0, 3), /other files/);
    expect(reader(() => {}).floats(0, 3).count).toBe(8);
    expect([...reader(() => {}).indices(1, 8).slice(0, 3)]).toEqual([0, 2, 3]);
  });
  it('reads a picture\'s size from its header and refuses an absurd one', async () => {
    const r = (w: number, h: number) => { const { json, bin } = splitGlb(model(BOXES(), [pngHead(w, h)])); return new GlbReader(json, bin); };
    expect(r(640, 480).image(0)).toMatchObject({ w: 640, h: 480, mime: 'image/png' });
    await refuses(() => r(60000, 60000).image(0), /at most 8,192 a side/);
    expect(r(4, 4).image(3)).toBeNull();
  });
});

// ---- the sums ----------------------------------------------------------------------------------------------

describe('pictures are packed onto one atlas', () => {
  const apart = (rects: { x: number; y: number; w: number; h: number }[], size: number, pad: number) => {
    for (const [i, a] of rects.entries()) {
      expect(a.x >= pad && a.y >= pad && a.x + a.w <= size - pad && a.y + a.h <= size - pad).toBe(true);
      for (const b of rects.slice(i + 1)) expect(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y).toBe(true);
    }
  };
  it('at their own size in the smallest square that holds them', () => {
    const a = packAtlas([{ w: 200, h: 100 }, { w: 100, h: 100 }, { w: 8, h: 8, fixed: true }], 1024);
    expect(a.scale).toBe(1);
    expect(a.size).toBe(256);
    expect(a.rects[0]).toMatchObject({ w: 200, h: 100 });
    apart(a.rects, a.size, 2);
  });
  it('all shrunk alike when they are too many pixels, never the fixed patch, never over the limit', () => {
    const items = [{ w: 4096, h: 4096 }, { w: 2048, h: 1024 }, { w: 2048, h: 2048 }, { w: 8, h: 8, fixed: true }];
    for (const max of [1024, 2048]) {
      const a = packAtlas(items, max);
      expect(a.size).toBe(max);
      expect(a.scale).toBeLessThan(0.5);
      expect(a.rects[3]).toMatchObject({ w: 8, h: 8 });
      expect(a.rects[0].w / a.rects[1].w).toBeCloseTo(2, 1);
      apart(a.rects, a.size, 2);
      // Most of the atlas is in use: nothing was shrunk more than it had to be by much.
      expect(a.rects.reduce((n, r) => n + r.w * r.h, 0)).toBeGreaterThan(max * max * 0.45);
    }
  });
  it('one picture larger than the atlas is fitted to it', () => {
    const a = packAtlas([{ w: 8192, h: 512 }], 1024);
    expect(a.rects[0].w).toBeLessThanOrEqual(1020);
    expect(a.rects[0].w).toBeGreaterThan(900);
  });
});

describe('a model entry', () => {
  const ref = { h: 'a'.repeat(64), n: 5000, m: GLB_MIME };
  it('is read strictly', () => {
    expect(parseModel({ h: 0.9, cells: 1, tris: 14900, ref })).toEqual({ h: 0.9, cells: 1, tris: 14900 });
    expect(parseModel({ h: 2.126, cells: 4, tris: 50000, set: true, yaw: 3, up: true, tex: true, ref, extra: 1 })).toEqual({ h: 2.13, cells: 4, tris: 50000, set: true, yaw: 3, up: true, tex: true });
    for (const wrong of [{ h: 0.1 }, { h: 5 }, { h: '1' }, { h: NaN }, { cells: 0 }, { cells: 5 }, { cells: 1.5 }, { tris: 0 }, { tris: 15001 }, { tris: 1.5 }, { yaw: 4 }, { yaw: -1 }, { yaw: 0.5 }, { ref: { ...ref, m: 'image/png' } }, { ref: undefined }]) {
      expect(parseModel({ h: 0.9, cells: 1, tris: 100, ref, ...wrong })).toBeNull();
    }
    expect(parseModel(null)).toBeNull();
    expect(parseModel({ h: 1, cells: 1, tris: 15001, set: true, ref })).not.toBeNull(); // a set piece has the larger budget
    expect(parseModel({ h: 1, cells: 1, tris: 50001, set: true, ref })).toBeNull();
  });
  it('is scaled to its height, or to fit its cells', () => {
    expect(fitScale([0.4, 1, 0.3], 0.9, 1)).toBeCloseTo(0.9);
    expect(fitScale([1, 0.5, 0.2], 0.9, 1)).toBeCloseTo(0.96); // too wide for its cell at that height: as wide as the cell
    expect(fitScale([1, 0.5, 0.2], 0.9, 2)).toBeCloseTo(1.8);
    expect(cellsFor([0.4, 1, 0.3], 0.9)).toBe(1);
    expect(cellsFor([1, 0.5, 1], 0.9)).toBe(2);
    expect(cellsFor([1, 0.1, 1], 4)).toBe(4);
    expect(turned([1, 2, 3], false, 0)).toEqual([1, 2, 3]);
    expect(turned([1, 2, 3], true, 0)).toEqual([1, 3, 2]);
    expect(turned([1, 2, 3], true, 1)).toEqual([2, 3, 1]);
  });
});

// ---- the pipeline ---------------------------------------------------------------------------------------------

describe('a model is made into a piece', () => {
  it('joins parts and materials into one mesh, colours in the vertices, on the ground', async () => {
    const steps: string[] = [], { glb, stats } = await ingest(model(BOXES()), {}, { step: (t) => steps.push(t) });
    expect(stats).toMatchObject({ trisIn: 36, trisOut: 36, animated: false, atlas: 0 });
    expect(stats.bytesOut).toBe(glb.length);
    expect(glb.length).toBeLessThan(3000);
    expect(steps[0]).toMatch(/Checking/);
    expect(steps.join()).toMatch(/Unpacking 36 triangles in 3 parts/);
    const out = await read(glb);
    expect(out.json.meshes).toHaveLength(1);
    expect(out.json.meshes[0].primitives).toHaveLength(1);
    expect(out.json.materials).toHaveLength(1);
    expect(out.json.images).toBeUndefined();
    expect(out.idx.length).toBe(108);
    const colours = new Set<string>();
    for (let i = 0; i < out.col.count; i++) colours.add([...out.col.data.slice(i * out.col.comps, i * out.col.comps + 3)].map((v) => Math.round(v)).join());
    expect([...colours].sort()).toEqual(['0,0,1', '0,1,0', '1,0,0']);
    // Stored on the ground, centred, its longest side (4 units of depth here) made one.
    const lo = [9, 9, 9], hi = [-9, -9, -9], t = out.json.nodes[0].translation;
    for (let i = 0; i < out.pos.data.length; i++) { const v = out.pos.data[i] + t[i % 3]; lo[i % 3] = Math.min(lo[i % 3], v); hi[i % 3] = Math.max(hi[i % 3], v); }
    expect(lo[1]).toBeCloseTo(0, 3);
    expect(hi[2] - lo[2]).toBeCloseTo(1, 3);
    expect(lo[0] + hi[0]).toBeCloseTo(0, 3);
    expect(stats.size.map((v) => +v.toFixed(3))).toEqual([0.625, 0.5, 1]);
    checkStored(glb, false);
  });
  it('simplifies to the budget of a piece, and leaves a set piece more', async () => {
    const big = model([{ ...sphere(200), rgb: [0.8, 0.6, 0.2] }, { ...box(0.4, 0.4, 0.4), rgb: [0, 0, 1], at: [2, 0, 0] }]);
    const piece = await ingest(big);
    expect(piece.stats.trisIn).toBe(40_012);
    expect(piece.stats.trisOut).toBeLessThanOrEqual(PIECE.tris);
    expect(piece.stats.trisOut).toBeGreaterThan(PIECE.tris * 0.7);
    expect(piece.glb.length).toBeLessThan(200_000);
    expect(inspect(splitGlb(piece.glb).json).triangles).toBe(piece.stats.trisOut);
    checkStored(piece.glb, false);
    // Still a ball: every point of it as far from its middle as before.
    const out = await read(piece.glb);
    let off = 0;
    for (let i = 0; i < out.pos.count; i++) { const [x, y, z] = out.pos.data.slice(i * 3, i * 3 + 3); if (x < 0.6) off = Math.max(off, Math.abs(Math.hypot(x - 1 / 3.4, y - 1 / 3.4, z - 0.5) - 1 / 3.4)); }
    expect(off).toBeLessThan(0.02);
    const set = await ingest(big, { set: true });
    expect(set.stats.trisOut).toBeGreaterThan(30_000);
    expect(set.stats.trisOut).toBeLessThanOrEqual(SET.tris);
    await refuses(() => checkStored(set.glb, false), /more than 15,000|not a model/);
    checkStored(set.glb, true);
  }, 60_000);
  it('refuses a model it cannot bring inside the budget, with the reason', async () => {
    // Twenty thousand large triangles that share nothing: there is no simpler shape to be had.
    const pos: number[] = [], idx: number[] = [];
    let s = 7;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 20_000 * 3; i++) { pos.push(rnd(), rnd(), rnd()); idx.push(i); }
    await refuses(ingest(model([{ pos, idx }])), /cannot be made simple enough.*20,000 triangles.*15,000.*set piece/s);
  }, 60_000);
  it('puts base-colour pictures on one atlas and points the UVs at it', async () => {
    const ball = sphere(16), jobs: AtlasJob[] = [];
    const src = model([{ ...ball, image: 0 }, { ...ball, image: 1, at: [3, 0, 0], uv: ball.uv.map((v) => v * 3) }, { ...box(1, 1, 1), rgb: [1, 0, 0], at: [0, 0, 3] }], [pngHead(512, 256), pngHead(64, 64)]);
    const { glb, stats } = await ingest(src, {}, { atlas: async (job) => { jobs.push(job); return { bytes: pngHead(job.size, job.size), mime: 'image/png' }; } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].size).toBe(1024);
    expect(jobs[0].items.map((i) => [i.w, i.h])).toEqual([[512, 256], [64, 64]]);
    expect(jobs[0].maxBytes).toBeGreaterThan(1_400_000);
    expect(stats.atlas).toBe(1024);
    const out = await read(glb);
    expect(out.json.images).toHaveLength(1);
    expect(out.json.materials[0].pbrMetallicRoughness.baseColorTexture.index).toBe(0);
    // Every UV is inside one of the two pictures or on the white patch.
    const inside = (u: number, v: number, r: { x: number; y: number; w: number; h: number }) => u * 1024 >= r.x - 0.01 && u * 1024 <= r.x + r.w + 0.01 && v * 1024 >= r.y - 0.01 && v * 1024 <= r.y + r.h + 0.01;
    const hits = [0, 0, 0];
    for (let i = 0; i < out.uv!.count; i++) {
      const u = out.uv!.data[i * 2], v = out.uv!.data[i * 2 + 1], k = [jobs[0].items[0], jobs[0].items[1], jobs[0].white].findIndex((r) => inside(u, v, r));
      expect(k).toBeGreaterThanOrEqual(0);
      hits[k]++;
    }
    expect(hits.every((n) => n > 0)).toBe(true);
    checkStored(glb, false);
    // Without anything to draw pictures with (or a picture nobody can read), the colours alone are kept, and it says so.
    const plain = await ingest(src);
    expect(plain.stats.atlas).toBe(0);
    expect(plain.stats.notes.join()).toMatch(/plain colours/);
  });
  it('halves the atlas when the picture will not fit the bytes, and gives up with the reason', async () => {
    const src = model([{ ...sphere(16), image: 0 }], [pngHead(4096, 4096)]), sizes: number[] = [];
    const { stats } = await ingest(src, {}, { atlas: async (job) => { sizes.push(job.size); return job.size > 256 ? null : { bytes: pngHead(256, 256), mime: 'image/png' }; } });
    expect(sizes).toEqual([1024, 512, 256]);
    expect(stats.atlas).toBe(256);
    expect(stats.notes.join()).toMatch(/smaller to share one of 256/);
    await refuses(ingest(src, {}, { atlas: async () => null }), /pictures cannot be made small enough/);
  });
  it('says so when animations were left out, and a stored file is not taken for more than it is', async () => {
    const { stats, glb } = await ingest(model(BOXES(), [], (j) => { j.animations = [{ channels: [], samplers: [] }]; j.skins = [{ joints: [0] }]; j.cameras = [{}]; }));
    expect(stats.animated).toBe(true);
    expect(stats.notes.join()).toMatch(/animations/);
    checkStored(glb, false);
    // What other devices check before a stored file goes anywhere near the loader.
    await refuses(() => checkStored(model(BOXES()), false), /not a model this table takes/);
    const { json, bin } = splitGlb(glb);
    json.images = [{ uri: 'https://example.com/track.png' }];
    await refuses(() => checkStored(packGlb(json, bin!), false), /other files/);
  });
});
