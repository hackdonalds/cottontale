// The modelled kit: pieces built in Blender (assets/blender), shipped as one
// compressed pack per theme and drawn with a single material. Colour and soft
// shading are baked into the vertices, so a piece costs no textures.
import * as THREE from 'three';

/** Geometry by piece id (`b_` blocks, `p_` props, `m_` minis, `g_` ground cover): every member of the family. */
export const kit = new Map<string, THREE.BufferGeometry[]>();

// ---- surface detail -----------------------------------------------------------
// Flat colour alone looks like plastic. One small texture, synthesised here rather
// than downloaded, holds three tiling patterns (red: wood grain, green: stone
// speckle, blue: leaf dapple). Each vertex says which one its surface wants, and
// the pattern lightens and darkens the paint underneath.

/** Smooth noise that wraps: a `px` by `py` lattice of random values stretched over the unit square. */
function lattice(px: number, py: number, seed: number): (u: number, v: number) => number {
  const g = new Float32Array(px * py);
  let s = seed >>> 0;
  for (let i = 0; i < g.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; g[i] = s / 4294967296; }
  const ease = (t: number) => t * t * (3 - 2 * t);
  return (u, v) => {
    const x = u * px, y = v * py, x0 = Math.floor(x), y0 = Math.floor(y), fx = ease(x - x0), fy = ease(y - y0);
    const at = (i: number, j: number) => g[(((j % py) + py) % py) * px + (((i % px) + px) % px)];
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
}

function detailTexture(): THREE.DataTexture {
  const N = 256, data = new Uint8Array(N * N * 4);
  const grainA = lattice(3, 40, 1), grainB = lattice(7, 96, 2), grainC = lattice(2, 9, 3), knots = lattice(5, 5, 4);
  const st = [lattice(6, 6, 5), lattice(14, 14, 6), lattice(36, 36, 7), lattice(90, 90, 8)], pits = lattice(48, 48, 9);
  const lf = [lattice(5, 5, 10), lattice(13, 13, 11), lattice(34, 34, 12), lattice(80, 80, 13)], blades = lattice(110, 28, 14);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, i = (y * N + x) * 4;
      // Wood: long streaks along u, wandering a little, with the odd darker band.
      const wander = v + (knots(u, v) - 0.5) * 0.05;
      const wood = 0.5 + (grainA(u, wander) - 0.5) * 0.75 + (grainB(u, wander) - 0.5) * 0.45 + (grainC(u, wander) - 0.5) * 0.35;
      // Stone: mottled, gritty, pocked with small pits.
      const pit = Math.max(0, pits(u, v) - 0.74) * 2.6;
      const stone = 0.5 + (st[0](u, v) - 0.5) * 0.5 + (st[1](u, v) - 0.5) * 0.4 + (st[2](u, v) - 0.5) * 0.35 + (st[3](u, v) - 0.5) * 0.3 - pit;
      // Leaves and grass: soft dabs of lighter and darker green, with fine flecks.
      const leaf = 0.5 + (lf[0](u, v) - 0.5) * 0.45 + (lf[1](u, v) - 0.5) * 0.45 + (lf[2](u, v) - 0.5) * 0.4 + (lf[3](u, v) - 0.5) * 0.25 + (blades(u, v) - 0.5) * 0.25;
      data[i] = Math.max(0, Math.min(255, wood * 255));
      data[i + 1] = Math.max(0, Math.min(255, stone * 255));
      data[i + 2] = Math.max(0, Math.min(255, leaf * 255));
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

let detail: THREE.DataTexture | undefined;

/** The time of year, shared by every kit material: 0 summer, 1 spring, 2 autumn, 3 winter. */
const SEASON = { value: 0 };
export const SEASONS = ['summer', 'spring', 'autumn', 'winter'] as const;
export type Season = typeof SEASONS[number];
export function setSeason(name: Season): void { SEASON.value = Math.max(0, SEASONS.indexOf(name)); }

/**
 * Teach a material to paint surface detail over its vertex colours. The geometry
 * needs a `kind` per vertex (0 plain, 2 stone, 3 leaf, 4 evergreen, 7 glowing
 * things such as flame, and wood with its grain along x 1, y 5 or z 6). Where on the pattern a point falls is worked out from
 * its position and which way its face points, so nothing needs texture coordinates.
 */
export function withDetail<T extends THREE.MeshStandardMaterial>(mat: T, terrain = false): T {
  if (terrain) mat.defines = { ...mat.defines, TERRAIN: '' };
  const shared = 'varying vec3 vDetailPos;\nvarying vec3 vDetailDir;\nvarying float vKind;\nvarying float vGround;\nvarying vec3 vLiving;';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.detailMap = { value: (detail ??= detailTexture()) };
    shader.uniforms.season = SEASON;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float kind;\n${shared}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vDetailPos = position;
        vDetailDir = normal;
        vKind = kind;
        vGround = 0.0;
        vLiving = vec3(0.0);
        #if defined(TERRAIN)
          // The terrain mesh is already in world space; its upward faces are open ground.
          vGround = step(0.5, normal.y);
        #elif defined(USE_INSTANCING)
          // Floors and paving are one surface, not a row of tiles: lay their detail out in world space.
          vDetailPos = (instanceMatrix * vec4(position, 1.0)).xyz;
          vDetailDir = mat3(instanceMatrix) * normal;
          vGround = step(0.5, normal.y);
        #else
          // Every copy of a piece starts somewhere else in the pattern: no two barrels share a grain.
          vec3 home = modelMatrix[3].xyz;
          vDetailPos += fract(sin(vec3(dot(home, vec3(12.9898, 78.233, 37.719)), dot(home, vec3(39.346, 11.135, 83.155)), dot(home, vec3(73.156, 52.235, 9.151)))) * 43758.5453) * 16.0;
          // A standing thing lives through the seasons: its own roll of the dice, and how much sky each face sees.
          vLiving = vec3(1.0, fract(sin(dot(home, vec3(4.898, 7.23, 3.71))) * 43758.5453), smoothstep(0.1, 0.6, normal.y));
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D detailMap;\nuniform float season;\n${shared}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float glow = step(6.5, vKind);
        float wood = step(0.5, vKind) * step(vKind, 1.5) + step(4.5, vKind) * (1.0 - glow);
        vec3 detailMask = vec3(wood, 1.0 - min(abs(vKind - 2.0), 1.0), (1.0 - min(abs(min(vKind, 3.0) - 3.0), 1.0)) * step(vKind, 4.5));
        float detailOn = detailMask.x + detailMask.y + detailMask.z;
        // Lay the pattern flat on whichever way the face mostly points, with wood grain running along u.
        float grain = vKind < 1.5 ? 0.0 : (vKind < 5.5 ? 1.0 : 2.0);
        vec3 facing = abs(vDetailDir);
        vec2 detailUv = facing.y >= facing.x && facing.y >= facing.z ? (grain > 1.5 ? vDetailPos.zx : vDetailPos.xz)
          : facing.x >= facing.z ? (grain > 1.5 ? vDetailPos.zy : vDetailPos.yz)
          : (grain > 0.5 && grain < 1.5 ? vDetailPos.yx : vDetailPos.xy);
        detailUv *= 0.5;
        // The pattern is read three times at unrelated sizes (and, except along wood grain, a
        // different angle), so the mix never lines up with itself: nothing visibly repeats.
        vec2 skew = mix(mat2(0.8, -0.6, 0.6, 0.8) * detailUv * 0.37, detailUv * vec2(0.29, 0.43), detailMask.x) + 0.17;
        float fine = dot(texture2D(detailMap, detailUv).rgb, detailMask) * 0.6 + dot(texture2D(detailMap, skew).rgb, detailMask) * 0.4;
        vec3 far = texture2D(detailMap, mat2(0.6, 0.8, -0.8, 0.6) * detailUv * 0.071 + 0.31).rgb;
        float broad = dot(far, detailMask);
        // Grain reads strongest on wood; foliage only wants a gentle dapple.
        float strength = dot(vec3(1.1, 0.85, 0.55), detailMask);
        diffuseColor.rgb *= mix(1.0, (1.0 + (fine - 0.5) * strength) * (0.84 + broad * 0.32), min(detailOn, 1.0));
        // Open ground is not one green: it drifts between lush, dry and clovered patches.
        vec3 lie = texture2D(detailMap, detailUv * 0.023 + 0.7).rgb;
        float patchy = vGround * detailMask.z;
        float dry = smoothstep(0.5, 0.64, lie.r * 0.6 + far.g * 0.4);
        float lush = smoothstep(0.5, 0.66, lie.g * 0.55 + far.b * 0.45);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.2, 1.07, 0.6), dry * 0.5 * patchy) * mix(vec3(1.0), vec3(0.7, 0.9, 0.8), lush * 0.5 * patchy);
        // Flame and magic light themselves, whatever the hour.
        totalEmissiveRadiance += diffuseColor.rgb * glow * 1.6;
        // The seasons: leaves (kind 3) turn; evergreens (kind 4) only ever gather snow.
        float leafy = (1.0 - min(abs(vKind - 3.0), 1.0)) * vLiving.x;
        float evergreen = (1.0 - min(abs(vKind - 4.0), 1.0)) * vLiving.x;
        float light = dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
        if (season > 0.5 && season < 1.5) { // spring: fresh leaf, and some trees in blossom
          vec3 blossom = mix(vec3(1.0, 0.72, 0.82), vec3(1.0, 0.96, 0.9), step(0.8, vLiving.y)) * (0.5 + light * 1.7);
          diffuseColor.rgb = mix(diffuseColor.rgb * mix(vec3(1.0), vec3(1.06, 1.14, 0.82), leafy), blossom, leafy * step(0.58, vLiving.y) * 0.9);
        } else if (season > 1.5 && season < 2.5) { // autumn: gold through orange to red, a few still green
          vec3 turned = mix(vec3(0.98, 0.76, 0.16), vec3(0.8, 0.22, 0.08), smoothstep(0.2, 0.95, vLiving.y)) * (0.3 + light * 2.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, turned, leafy * step(0.1, vLiving.y) * 0.92);
        } else if (season > 2.5) { // winter: snow lying on whatever still has needles or leaves
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), max(leafy, evergreen) * vLiving.z * (0.3 + 0.5 * smoothstep(0.42, 0.56, fine)));
        }`)
      // Relief: the same pattern that tints the surface also dents it, so stone and timber
      // catch the light across their grain instead of lying flat. Worked out from how the
      // pattern changes across the screen, so no tangents or normal maps are needed.
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float dent = (fine - 0.5) * (detailMask.x * 0.045 + detailMask.y * 0.075) + (broad - 0.5) * detailMask.y * 0.05;
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1);
          normal = normalize(abs(det) * normal - sign(det) * (dFdx(dent) * r1 + dFdy(dent) * r2));
        }`);
  };
  mat.customProgramCacheKey = () => (terrain ? 'kit-relief-terrain' : 'kit-relief');
  return mat;
}

/** How kit pieces are drawn into the shadow map: everything casts a shadow except what glows. */
const SHADOW = new THREE.MeshDepthMaterial();
/** The same for the shadows thrown by a lamp: a flame must not shade the light burning inside it. */
const LAMP_SHADOW = new THREE.MeshDistanceMaterial();
SHADOW.onBeforeCompile = LAMP_SHADOW.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float kind;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (kind > 6.5) transformed = vec3(0.0);');
};

/** The kit's one material, in a few slightly different mixes of paint: each copy of a piece takes one. */
/** The same mixes as plain colours, for pieces drawn as instances of one material. */
export const TINT_COLORS = ['#ffffff', '#f3ede2', '#e9efe6', '#fff6e4', '#e4e0dc', '#f0f4ea'].map((c) => new THREE.Color(c));
const TINTS = TINT_COLORS.map((color) =>
  withDetail(new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.86 })));
export const KIT = TINTS[0];

/** A steady pseudo-random number in [0, 1) for a place on the table: every device rolls the same. */
export function rand(x: number, y: number, z: number, salt = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Plain float attributes in the piece's own space (packs are quantised and carry their scale in a node). */
function unpack(mesh: THREE.Mesh): THREE.BufferGeometry {
  const src = mesh.geometry, out = new THREE.BufferGeometry();
  const copy = (name: string, size: number, from = 0) => {
    const a = src.getAttribute(name), arr = new Float32Array(a.count * size);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < size; c++) arr[i * size + c] = a.getComponent(i, from + c);
    return new THREE.BufferAttribute(arr, size);
  };
  out.setAttribute('position', copy('position', 3).applyMatrix4(mesh.matrixWorld));
  out.setAttribute('normal', copy('normal', 3).applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)));
  out.setAttribute('color', copy('color', 3));
  // The colour's alpha says what the surface is made of, in eighths (see withDetail); alpha 1 is plain.
  const kind = copy('color', 1, 3);
  for (let i = 0; i < kind.count; i++) kind.setX(i, Math.round(kind.getX(i) * 8) % 8);
  out.setAttribute('kind', kind);
  if (src.getAttribute('uv')) out.setAttribute('uv', copy('uv', 2)); // painted figures
  out.setIndex(src.index);
  return out;
}

// ---- packs ---------------------------------------------------------------------
// The kit ships as themed packs. 'core' (ground, floors, minis) loads when you sit
// down; the rest are fetched the first time the table shows a piece from them, so
// nobody downloads a dungeon to play in a meadow.

let dir = '';
/** Which pack holds each family (public/kit/index.json, written by `npm run kit`). */
let index: Record<string, string> = {};
/** Packs whose figures are painted on a texture (`<pack>.png`) instead of in their vertices. */
let atlases: string[] = [];
const packs = new Map<string, Promise<void>>();
const failed = new Set<string>();
let arrived: (pack: string) => void = () => {};
/** Be told whenever a pack has finished loading (or failed), so waiting pieces can be stood up. */
export function onKitPack(fn: (pack: string) => void): void { arrived = fn; }

function loadPack(name: string): Promise<void> {
  let job = packs.get(name);
  if (!job) {
    // The loader and decoder come along only with the first pack, so they stay out of the first paint.
    job = Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')])
      .then(([{ GLTFLoader }, { MeshoptDecoder }]) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${dir}/${name}.glb`))
      .then(({ scene }) => {
        scene.updateMatrixWorld(true);
        for (const node of scene.children) {
          if (!node.name) continue;
          node.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh || !mesh.geometry.getAttribute('color')) return;
            const [id, v] = node.name.split('~'); // `p_tree~3`: the fourth tree of the family
            if (!kit.has(id)) kit.set(id, []);
            const geo = unpack(mesh);
            if (geo.getAttribute('uv') && atlases.includes(name)) geo.userData.atlas = name;
            kit.get(id)![+v || 0] = geo;
          });
        }
      })
      .catch(() => { failed.add(name); }) // offline, or a broken pack: its pieces fall back to plain shapes
      .then(() => arrived(name));
    packs.set(name, job);
  }
  return job;
}

/** Find out what packs there are and load the one every table needs. */
export async function loadKit(from: string): Promise<void> {
  dir = from;
  ({ families: index, atlases } = await (await fetch(`${dir}/index.json`)).json());
  await loadPack('core');
}

/** Is a model for this family on its way? Asking is what starts the download. */
export function kitPending(family: string): boolean {
  const pack = index[family];
  if (!pack || kit.has(family) || failed.has(pack)) return false;
  void loadPack(pack);
  return true;
}

const paints = new Map<string, THREE.MeshStandardMaterial>();
/** The material for a pack's painted figures: its sheet of paint over plain white. */
function painted(pack: string): THREE.MeshStandardMaterial {
  let m = paints.get(pack);
  if (!m) {
    const map = new THREE.TextureLoader().load(`${dir}/${pack}.png`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.flipY = false; // the packs follow glTF, which counts texture rows from the top
    map.anisotropy = 4;
    paints.set(pack, (m = withDetail(new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.8 }))));
  }
  return m;
}

/** A kit piece ready for the table (the first of its family), or null if the kit has no model for it. */
export function kitMesh(id: string): THREE.Mesh | null {
  const geo = kit.get(id)?.[0];
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, geo.userData.atlas ? painted(geo.userData.atlas) : KIT);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.customDepthMaterial = SHADOW;
  mesh.customDistanceMaterial = LAMP_SHADOW;
  return mesh;
}

/** Things that grow or lie where they like: turned any which way, some bigger, some leaning. */
export const WILD: Record<string, { size: number; lean: number; sink: number; bare?: boolean }> = {
  tree: { size: 0.22, lean: 0.07, sink: 0.02, bare: true }, birch: { size: 0.2, lean: 0.06, sink: 0.02, bare: true },
  poplar: { size: 0.2, lean: 0.03, sink: 0.02, bare: true }, deadtree: { size: 0.22, lean: 0.08, sink: 0.02 },
  pine: { size: 0.25, lean: 0.05, sink: 0.02 }, rock: { size: 0.3, lean: 0, sink: 0.05 },
};

/**
 * A prop for one spot on the table. Which member of its family it is, its tint, and
 * (for wild things) its turn, size and lean all follow from the spot, so a forest or
 * a wall never looks stamped, and moving a piece lets it settle into its new place.
 */
export function kitProp(id: string, x: number, y: number, z: number, crowd?: [number, number]): THREE.Mesh | null {
  // In winter the trees that drop their leaves stand bare.
  const family = (SEASON.value === 3 && WILD[id]?.bare && kit.get('p_deadtree')) || kit.get(`p_${id}`);
  if (!family?.length) return null;
  const mesh = new THREE.Mesh(family[Math.floor(rand(x, y, z, 1) * family.length)], TINTS[Math.floor(rand(x, y, z, 2) * TINTS.length)]);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.customDepthMaterial = SHADOW;
  mesh.customDistanceMaterial = LAMP_SHADOW;
  const wild = WILD[id];
  if (wild) {
    mesh.rotation.set((rand(x, y, z, 3) - 0.5) * wild.lean, rand(x, y, z, 4) * Math.PI * 2, (rand(x, y, z, 5) - 0.5) * wild.lean, 'YXZ');
    mesh.scale.setScalar(1 + (rand(x, y, z, 6) - 0.4) * wild.size * 2).multiply(new THREE.Vector3(1, 1 + (rand(x, y, z, 7) - 0.5) * wild.size, 1));
    mesh.position.y = -wild.sink; // bedded in, not balanced on top
    // Hemmed in by a wall or another trunk, it grows smaller and away from it.
    if (crowd && (crowd[0] || crowd[1])) {
      mesh.scale.multiplyScalar(0.8);
      mesh.position.x = crowd[0] * 0.14;
      mesh.position.z = crowd[1] * 0.14;
    }
  }
  return mesh;
}
