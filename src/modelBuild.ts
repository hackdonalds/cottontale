// Reading a `model` piece's file and standing it on the table (see model.ts). Fetched with the
// first model that is actually drawn.
//
// The file came through the table, so anybody may have written it: before the glTF loader
// sees it, it is checked against the narrow shape our own importer writes (glb.ts) — one mesh,
// inside the triangle budget, at most one picture of a size we would make, everything inside
// the file. And the loader is given a manager that goes nowhere: a model never makes this
// device fetch anything.
//
// What comes out is ONE geometry and ONE material for the piece, shared by every copy on the
// table. A model without a texture uses the one material all such models share.
import * as THREE from 'three';
import { GLB_MIME, GlbReader, ModelError, inspect, splitGlb } from './glb';
import { BASE_LIFT, budgetOf, fitScale, type ModelFields } from './model';
import type { Built, Entry, Group } from './packs';

/** A model as stored: its longest side one unit, standing on y = 0 around the origin. */
export interface Decoded {
  pos: Float32Array; nrm: Float32Array; col: Uint8Array; uv: Uint16Array | null; index: Uint16Array | Uint32Array;
  texture: THREE.Texture | null; rough: number; tris: number;
}

/** The material of every imported model that has no texture: colours in the vertices, as the built-in pieces have. */
export const PLAIN = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
const OURS = new Set(['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp']);

/** Is this a file our importer could have written, for this budget? Throws if not. */
export function checkStored(bytes: Uint8Array, set: boolean): void {
  const budget = budgetOf(set), { json, bin } = splitGlb(bytes), seen = inspect(json, budget.tris), no = () => { throw new ModelError('not a model this table takes'); };
  if (seen.instances.length !== 1 || seen.parts !== 1 || seen.animated || seen.skipped) no();
  for (const k of ['cameras', 'animations', 'skins']) if (Array.isArray(json[k]) && json[k].length) no();
  for (const ext of [...(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []), ...(Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [])]) if (!OURS.has(ext)) no();
  const prim = json.meshes[seen.instances[0].mesh].primitives.find((p: { mode?: number }) => (p.mode ?? 4) === 4);
  const points = json.accessors[prim.attributes.POSITION]?.count;
  if (!(points > 0 && points <= budget.tris * 3)) no();
  const images = Array.isArray(json.images) ? json.images : [];
  if (images.length > 1 || (Array.isArray(json.textures) && json.textures.length > 1) || (Array.isArray(json.materials) && json.materials.length > 1)) no();
  if (images.length) {
    const im = new GlbReader(json, bin).image(0);
    if (!im || Math.max(im.w, im.h) > budget.atlas) no();
  }
}

let loader: Promise<{ parse(data: ArrayBuffer): Promise<{ scene: THREE.Object3D }> }> | undefined;
function gltf(): NonNullable<typeof loader> {
  // The same loader and decoder the kit's packs come through (kit.ts), with a manager that follows nothing but what is in the file.
  return (loader ??= Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]).then(([{ GLTFLoader }, { MeshoptDecoder }]) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => (/^(blob|data):/.test(url) ? url : 'data:,'));
    const l = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
    return { parse: (data: ArrayBuffer) => l.parseAsync(data, '') };
  }));
}

/** Unpack a stored model (after checking it). */
export async function decodeModel(bytes: Uint8Array, set: boolean): Promise<Decoded> {
  checkStored(bytes, set);
  const { scene } = await (await gltf()).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  scene.updateMatrixWorld(true);
  let mesh: THREE.Mesh | undefined;
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) mesh ??= o as THREE.Mesh; });
  const g = mesh?.geometry, P = g?.getAttribute('position'), I = g?.index;
  if (!mesh || !g || !P || !I || I.count / 3 > budgetOf(set).tris) throw new ModelError('not a model this table takes');
  const n = P.count, N = g.getAttribute('normal'), C = g.getAttribute('color'), U = g.getAttribute('uv'), v = new THREE.Vector3();
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Uint8Array(n * 3).fill(255);
  const mat = mesh.material as THREE.MeshStandardMaterial, texture = mat.map ?? null, uv = U && texture ? new Uint16Array(n * 2) : null;
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld).toArray(pos, i * 3);
    if (N) v.fromBufferAttribute(N, i).normalize().toArray(nrm, i * 3); else nrm[i * 3 + 1] = 1;
    if (C) for (let c = 0; c < 3; c++) col[i * 3 + c] = Math.round(Math.min(1, Math.max(0, C.getComponent(i, c))) * 255);
    if (uv) { uv[i * 2] = Math.round(Math.min(1, Math.max(0, U.getX(i))) * 65535); uv[i * 2 + 1] = Math.round(Math.min(1, Math.max(0, U.getY(i))) * 65535); }
  }
  const index = n <= 65535 ? Uint16Array.from(I.array) : Uint32Array.from(I.array);
  for (let i = 0; i < index.length; i++) if (index[i] >= n) throw new ModelError('not a model this table takes');
  if (texture) texture.anisotropy = 4;
  const rough = Math.min(1, Math.max(0.3, mat.roughness ?? 0.82));
  g.dispose();
  mat.dispose();
  return { pos, nrm, col, uv, index, texture, rough, tris: index.length / 3 };
}

/**
 * The geometry of a piece: the model stood up and turned as its entry says, scaled to its
 * height (or to fit its cells), centred, on the ground. `lift` raises it (a figure stands on
 * its base); a thing an even number of cells wide has its middle on a grid line.
 */
export function shape(d: Decoded, f: { h: number; cells: number; yaw?: number; up?: boolean }, group: Group): { geometry: THREE.BufferGeometry; height: number; size: [number, number, number] } {
  const n = d.pos.length / 3, pos = new Float32Array(n * 3), nrm = new Int8Array(n * 3), yaw = (f.yaw ?? 0) & 3;
  const turn = (a: Float32Array, i: number): [number, number, number] => {
    let x = a[i], y = a[i + 1], z = a[i + 2];
    if (f.up) [y, z] = [z, -y];
    for (let k = 0; k < yaw; k++) [x, z] = [z, -x];
    return [x, y, z];
  };
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n * 3; i += 3) {
    const p = turn(d.pos, i), q = turn(d.nrm, i);
    for (let c = 0; c < 3; c++) { pos[i + c] = p[c]; nrm[i + c] = Math.round(Math.max(-1, Math.min(1, q[c])) * 127); if (p[c] < lo[c]) lo[c] = p[c]; if (p[c] > hi[c]) hi[c] = p[c]; }
  }
  const size: [number, number, number] = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], s = fitScale(size, f.h, f.cells);
  const even = group === 'props' && f.cells % 2 === 0 ? 0.5 : 0, lift = group === 'minis' ? BASE_LIFT : 0;
  const off = [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2], add = [even, lift, even];
  for (let i = 0; i < n * 3; i++) pos[i] = (pos[i] - off[i % 3]) * s + add[i % 3];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(d.col, 3, true));
  if (d.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2, true));
  geometry.setIndex(new THREE.BufferAttribute(d.index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, height: size[1] * s + lift, size: [size[0] * s, size[1] * s, size[2] * s] };
}

/** The material a decoded model is drawn with: its own if it has a texture, else the one all plain models share. */
export function materialOf(d: Decoded): THREE.MeshStandardMaterial {
  return d.texture ? new THREE.MeshStandardMaterial({ map: d.texture, vertexColors: true, roughness: d.rough }) : PLAIN;
}

export async function buildModel(entry: Entry, bytes: Uint8Array, group: Group): Promise<Built> {
  if (entry.ref.m !== GLB_MIME) throw new ModelError('not a model');
  const f = entry as unknown as ModelFields, d = await decodeModel(bytes, f.set === true);
  const { geometry, height } = shape(d, f, group), material = materialOf(d);
  geometry.userData.model = { tris: d.tris, textured: !!d.texture };
  const def = { name: entry.name, icon: entry.icon ?? '🗿', mesh: { geometry, material } };
  return {
    ...(group === 'minis' ? { mini: { ...def, height } } : { prop: def }),
    dispose() {
      geometry.dispose();
      if (material !== PLAIN) material.dispose();
      d.texture?.dispose();
      (d.texture?.image as ImageBitmap | undefined)?.close?.();
    },
  };
}
