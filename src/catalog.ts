// Everything that can be put on the table. All models are built from
// primitives at runtime, so the game ships with no art assets.
import * as THREE from 'three';

export interface BlockDef { name: string; color: string; h?: number; opacity?: number; glow?: number; rough?: number }

export const BLOCKS: Record<string, BlockDef> = {
  grass: { name: 'Grass', color: '#6aa84f' },
  dirt: { name: 'Dirt', color: '#8a5a3c' },
  stone: { name: 'Stone', color: '#8d9199' },
  cobble: { name: 'Cobble', color: '#5d6068' },
  brick: { name: 'Brick', color: '#a5523f' },
  wood: { name: 'Planks', color: '#b98a52' },
  sand: { name: 'Sand', color: '#e2cf96' },
  snow: { name: 'Snow', color: '#f1f5f9' },
  water: { name: 'Water', color: '#3b8fd9', h: 0.82, opacity: 0.7, rough: 0.15 },
  lava: { name: 'Lava', color: '#ff6a1a', h: 0.9, glow: 0.9 },
  marble: { name: 'Marble', color: '#d9d4cc', rough: 0.3 },
  obsidian: { name: 'Obsidian', color: '#2b2438', rough: 0.25 },
};

const mat = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

function part(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const ball = (r: number, seg = 12) => new THREE.SphereGeometry(r, seg, Math.max(6, seg - 4));
const cone = (r: number, h: number, seg = 10) => new THREE.ConeGeometry(r, h, seg);

function group(...parts: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.add(...parts);
  return g;
}

export interface PropDef { name: string; icon: string; make: () => THREE.Group }

export const PROPS: Record<string, PropDef> = {
  tree: {
    name: 'Tree', icon: '🌳',
    make: () => group(
      part(cyl(0.09, 0.13, 0.7, 7), mat('#6b4a2b'), 0, 0.35, 0),
      part(ball(0.42, 8), mat('#3f8a3a', { flatShading: true }), 0, 0.95, 0),
      part(ball(0.28, 7), mat('#4c9c45', { flatShading: true }), 0.18, 1.25, 0.08),
    ),
  },
  pine: {
    name: 'Pine', icon: '🌲',
    make: () => group(
      part(cyl(0.07, 0.1, 0.4, 6), mat('#5c3d24'), 0, 0.2, 0),
      part(cone(0.42, 0.6, 8), mat('#2f6b3a', { flatShading: true }), 0, 0.6, 0),
      part(cone(0.33, 0.55, 8), mat('#357a42', { flatShading: true }), 0, 0.95, 0),
      part(cone(0.22, 0.5, 8), mat('#3d8a4a', { flatShading: true }), 0, 1.3, 0),
    ),
  },
  bush: {
    name: 'Bush', icon: '🌿',
    make: () => group(
      part(ball(0.26, 7), mat('#4a9a4a', { flatShading: true }), -0.1, 0.2, 0),
      part(ball(0.22, 7), mat('#57a955', { flatShading: true }), 0.15, 0.18, 0.1),
      part(ball(0.18, 7), mat('#3f8a3f', { flatShading: true }), 0.02, 0.3, -0.14),
    ),
  },
  rock: {
    name: 'Rock', icon: '🪨',
    make: () => {
      const a = part(new THREE.DodecahedronGeometry(0.3), mat('#80848c', { flatShading: true }), -0.05, 0.2, 0);
      a.scale.set(1.2, 0.8, 1);
      const b = part(new THREE.DodecahedronGeometry(0.17), mat('#6c7078', { flatShading: true }), 0.25, 0.12, 0.15);
      return group(a, b);
    },
  },
  barrel: {
    name: 'Barrel', icon: '🛢️',
    make: () => group(
      part(cyl(0.24, 0.24, 0.6, 12), mat('#8a5c33'), 0, 0.3, 0),
      part(cyl(0.255, 0.255, 0.05, 12), mat('#3a3a40', { metalness: 0.6 }), 0, 0.14, 0),
      part(cyl(0.255, 0.255, 0.05, 12), mat('#3a3a40', { metalness: 0.6 }), 0, 0.46, 0),
    ),
  },
  crate: {
    name: 'Crate', icon: '📦',
    make: () => group(
      part(box(0.6, 0.6, 0.6), mat('#a47a45'), 0, 0.3, 0),
      part(box(0.64, 0.08, 0.64), mat('#7c5a31'), 0, 0.56, 0),
      part(box(0.64, 0.08, 0.64), mat('#7c5a31'), 0, 0.04, 0),
    ),
  },
  chest: {
    name: 'Chest', icon: '🧰',
    make: () => {
      const lid = part(cyl(0.2, 0.2, 0.6, 10, ), mat('#8a5a2a'), 0, 0.3, 0);
      lid.rotation.z = Math.PI / 2;
      return group(
        part(box(0.6, 0.3, 0.4), mat('#7a4d22'), 0, 0.15, 0),
        lid,
        part(box(0.1, 0.14, 0.03), mat('#e8c04a', { metalness: 0.7, roughness: 0.3 }), 0, 0.28, 0.21),
      );
    },
  },
  campfire: {
    name: 'Campfire', icon: '🔥',
    make: () => {
      const a = part(cyl(0.05, 0.05, 0.55, 6), mat('#5a3b21'), 0, 0.06, 0);
      a.rotation.z = Math.PI / 2;
      const b = part(cyl(0.05, 0.05, 0.55, 6), mat('#5a3b21'), 0, 0.08, 0);
      b.rotation.x = Math.PI / 2;
      const fire = { emissive: new THREE.Color('#ff7a1a'), emissiveIntensity: 1.2 };
      return group(
        a, b,
        part(cone(0.16, 0.42, 6), mat('#ff8a1f', fire), 0, 0.32, 0),
        part(cone(0.09, 0.3, 6), mat('#ffd34a', { emissive: new THREE.Color('#ffd34a'), emissiveIntensity: 1.4 }), 0.03, 0.3, 0.03),
      );
    },
  },
  pillar: {
    name: 'Pillar', icon: '🏛️',
    make: () => group(
      part(box(0.6, 0.12, 0.6), mat('#cfcac0'), 0, 0.06, 0),
      part(cyl(0.2, 0.22, 0.78, 10), mat('#dedad2'), 0, 0.5, 0),
      part(box(0.56, 0.1, 0.56), mat('#cfcac0'), 0, 0.95, 0),
    ),
  },
  torch: {
    name: 'Torch', icon: '🕯️',
    make: () => group(
      part(cyl(0.04, 0.05, 0.8, 6), mat('#5a3b21'), 0, 0.4, 0),
      part(ball(0.09, 8), mat('#ffb02e', { emissive: new THREE.Color('#ff9a1f'), emissiveIntensity: 1.5 }), 0, 0.86, 0),
    ),
  },
  table: {
    name: 'Table', icon: '🪑',
    make: () => group(
      part(box(0.85, 0.07, 0.6), mat('#9b6b3a'), 0, 0.42, 0),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => part(box(0.07, 0.4, 0.07), mat('#7a5230'), x * 0.36, 0.2, z * 0.24)),
    ),
  },
  door: {
    name: 'Door', icon: '🚪',
    make: () => group(
      part(box(0.12, 1, 0.12), mat('#6c7078'), -0.44, 0.5, 0),
      part(box(0.12, 1, 0.12), mat('#6c7078'), 0.44, 0.5, 0),
      part(box(0.76, 0.92, 0.07), mat('#8a5c33'), 0, 0.46, 0),
      part(ball(0.04, 6), mat('#e8c04a', { metalness: 0.7 }), 0.26, 0.45, 0.06),
    ),
  },
  fence: {
    name: 'Fence', icon: '🪵',
    make: () => group(
      part(box(0.09, 0.55, 0.09), mat('#8a623a'), -0.45, 0.275, 0),
      part(box(0.09, 0.55, 0.09), mat('#8a623a'), 0.45, 0.275, 0),
      part(box(1, 0.07, 0.05), mat('#9b6f42'), 0, 0.42, 0),
      part(box(1, 0.07, 0.05), mat('#9b6f42'), 0, 0.2, 0),
    ),
  },
};

export interface MiniDef { name: string; icon: string; make: () => THREE.Object3D[]; height: number }

const SKIN = '#e8b98f';
const eyes = (y: number, z: number, dx = 0.07, r = 0.028, c = '#1b1b1f') => [
  part(ball(r, 6), mat(c), -dx, y, z),
  part(ball(r, 6), mat(c), dx, y, z),
];
function person(body: string, o: { skin?: string; h?: number; w?: number } = {}): THREE.Object3D[] {
  const h = o.h ?? 0.5, w = o.w ?? 0.17;
  return [
    part(cyl(w * 0.75, w, h, 10), mat(body), 0, 0.08 + h / 2, 0),
    part(ball(0.14, 10), mat(o.skin ?? SKIN), 0, 0.08 + h + 0.1, 0),
    ...eyes(0.08 + h + 0.12, 0.125, 0.055, 0.022),
  ];
}
function tilt(o: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Object3D {
  o.rotation.set(x, y, z);
  return o;
}

export const MINIS: Record<string, MiniDef> = {
  knight: {
    name: 'Knight', icon: '🛡️', height: 0.9,
    make: () => [
      ...person('#9aa3ad'),
      part(ball(0.155, 10), mat('#b4bcc6', { metalness: 0.6, roughness: 0.4 }), 0, 0.71, -0.02),
      part(box(0.05, 0.3, 0.24), mat('#3567b0'), -0.22, 0.38, 0.05),
      part(box(0.035, 0.46, 0.035), mat('#e3e7ec', { metalness: 0.8, roughness: 0.3 }), 0.22, 0.5, 0.05),
    ],
  },
  mage: {
    name: 'Mage', icon: '🧙', height: 1.1,
    make: () => [
      part(cone(0.24, 0.56, 10), mat('#6b3fa8'), 0, 0.36, 0),
      part(ball(0.14, 10), mat(SKIN), 0, 0.68, 0),
      ...eyes(0.7, 0.125, 0.055, 0.022),
      part(cyl(0.24, 0.24, 0.025, 12), mat('#52308a'), 0, 0.78, 0),
      part(cone(0.13, 0.34, 10), mat('#52308a'), 0, 0.95, 0),
      part(cyl(0.02, 0.02, 0.8, 6), mat('#6b4a2b'), 0.25, 0.48, 0.05),
      part(ball(0.055, 8), mat('#7df2ff', { emissive: new THREE.Color('#44d7ee'), emissiveIntensity: 1 }), 0.25, 0.92, 0.05),
    ],
  },
  rogue: {
    name: 'Rogue', icon: '🗡️', height: 0.9,
    make: () => [
      ...person('#3d4a3a'),
      part(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), mat('#2a332a'), 0, 0.69, -0.02),
      tilt(part(box(0.03, 0.2, 0.03), mat('#d9dde2', { metalness: 0.8 }), 0.2, 0.34, 0.08), 0.5),
      tilt(part(box(0.03, 0.2, 0.03), mat('#d9dde2', { metalness: 0.8 }), -0.2, 0.34, 0.08), 0.5),
    ],
  },
  ranger: {
    name: 'Ranger', icon: '🏹', height: 0.9,
    make: () => [
      ...person('#4f7a3a'),
      part(cone(0.15, 0.2, 8), mat('#3d6a2e'), 0, 0.84, 0),
      tilt(part(new THREE.TorusGeometry(0.2, 0.015, 5, 12, Math.PI), mat('#6b4a2b'), -0.22, 0.42, 0.04), 0, Math.PI / 2, Math.PI / 2),
    ],
  },
  cleric: {
    name: 'Cleric', icon: '✨', height: 0.9,
    make: () => [
      ...person('#eee6d2'),
      part(box(0.05, 0.3, 0.02), mat('#e0b93a', { metalness: 0.5 }), 0, 0.38, 0.165),
      part(box(0.18, 0.05, 0.02), mat('#e0b93a', { metalness: 0.5 }), 0, 0.44, 0.165),
      part(new THREE.TorusGeometry(0.11, 0.015, 5, 16), mat('#ffe27a', { emissive: new THREE.Color('#ffd84a'), emissiveIntensity: 0.9 }), 0, 0.88, 0)
        .rotateX(Math.PI / 2),
    ],
  },
  bard: {
    name: 'Bard', icon: '🎻', height: 0.9,
    make: () => [
      ...person('#c2452d'),
      part(cyl(0.2, 0.2, 0.02, 12), mat('#3a6ea8'), 0, 0.79, 0),
      part(cyl(0.1, 0.12, 0.1, 10), mat('#3a6ea8'), 0, 0.84, 0),
      tilt(part(cone(0.02, 0.26, 4), mat('#f2f2f2'), 0.1, 0.94, 0), 0, 0, -0.5),
      tilt(part(ball(0.09, 8), mat('#b98a52'), 0.19, 0.36, 0.1), 0, 0, 0.4),
    ],
  },
  bunny: {
    name: 'Bunny', icon: '🐇', height: 0.75,
    make: () => {
      const body = part(ball(0.2, 10), mat('#f4f1ea'), 0, 0.27, -0.03);
      body.scale.set(1, 1.05, 1.15);
      const ear = (x: number) => {
        const e = part(ball(0.05, 8), mat('#f4f1ea'), x, 0.72, -0.02);
        e.scale.set(0.8, 3, 0.6);
        e.rotation.z = -x * 2;
        return e;
      };
      return [
        body,
        part(ball(0.14, 10), mat('#f4f1ea'), 0, 0.5, 0.1),
        ear(-0.07), ear(0.07),
        ...eyes(0.53, 0.22, 0.06, 0.022),
        part(ball(0.025, 6), mat('#f29bb0'), 0, 0.48, 0.24),
        part(ball(0.07, 8), mat('#ffffff'), 0, 0.22, -0.25),
      ];
    },
  },
  goblin: {
    name: 'Goblin', icon: '👺', height: 0.7,
    make: () => [
      ...person('#6b4a2b', { skin: '#7fb04a', h: 0.34 }),
      tilt(part(cone(0.05, 0.2, 5), mat('#7fb04a'), -0.18, 0.54, 0), 0, 0, 1.2),
      tilt(part(cone(0.05, 0.2, 5), mat('#7fb04a'), 0.18, 0.54, 0), 0, 0, -1.2),
      part(box(0.04, 0.3, 0.04), mat('#5a3b21'), 0.2, 0.32, 0.06),
    ],
  },
  skeleton: {
    name: 'Skeleton', icon: '💀', height: 0.9,
    make: () => [
      part(cyl(0.03, 0.03, 0.5, 6), mat('#e9e4d4'), 0, 0.33, 0),
      ...[0.3, 0.38, 0.46].map((y) => part(box(0.26, 0.035, 0.14), mat('#e9e4d4'), 0, y, 0)),
      part(box(0.2, 0.05, 0.1), mat('#e9e4d4'), 0, 0.12, 0),
      part(ball(0.14, 10), mat('#f1ecdd'), 0, 0.68, 0),
      ...eyes(0.7, 0.115, 0.055, 0.035, '#111'),
    ],
  },
  orc: {
    name: 'Orc', icon: '👹', height: 1,
    make: () => [
      ...person('#5a4634', { skin: '#5d8f4a', h: 0.56, w: 0.22 }),
      part(cone(0.025, 0.08, 5), mat('#fff'), -0.05, 0.68, 0.13),
      part(cone(0.025, 0.08, 5), mat('#fff'), 0.05, 0.68, 0.13),
      part(box(0.04, 0.6, 0.04), mat('#5a3b21'), 0.28, 0.45, 0.05),
      part(box(0.04, 0.2, 0.22), mat('#9aa3ad', { metalness: 0.7 }), 0.28, 0.68, 0.1),
    ],
  },
  wolf: {
    name: 'Wolf', icon: '🐺', height: 0.65,
    make: () => [
      part(box(0.22, 0.22, 0.52), mat('#7b7f88'), 0, 0.36, -0.03),
      part(box(0.2, 0.2, 0.22), mat('#8b8f98'), 0, 0.48, 0.3),
      part(box(0.1, 0.09, 0.14), mat('#6b6f78'), 0, 0.43, 0.44),
      part(cone(0.04, 0.1, 4), mat('#6b6f78'), -0.07, 0.62, 0.28),
      part(cone(0.04, 0.1, 4), mat('#6b6f78'), 0.07, 0.62, 0.28),
      tilt(part(cone(0.05, 0.3, 5), mat('#6b6f78'), 0, 0.46, -0.38), -2),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => part(box(0.06, 0.22, 0.06), mat('#6b6f78'), x * 0.08, 0.17, z * 0.2 - 0.03)),
      ...eyes(0.52, 0.415, 0.055, 0.02, '#ffd34a'),
    ],
  },
  slime: {
    name: 'Slime', icon: '🟢', height: 0.55,
    make: () => {
      const b = part(ball(0.3, 14), mat('#58d68d', { transparent: true, opacity: 0.8, roughness: 0.15 }), 0, 0.25, 0);
      b.scale.set(1, 0.7, 1);
      return [b, ...eyes(0.3, 0.25, 0.08, 0.035)];
    },
  },
  spider: {
    name: 'Spider', icon: '🕷️', height: 0.5,
    make: () => [
      part(ball(0.18, 10), mat('#2b2530'), 0, 0.3, -0.1),
      part(ball(0.11, 8), mat('#3a3240'), 0, 0.27, 0.13),
      ...eyes(0.3, 0.22, 0.04, 0.022, '#ff3b3b'),
      ...[-1, 1].flatMap((s) => [-0.6, -0.2, 0.2, 0.6].map((a) =>
        tilt(part(box(0.3, 0.025, 0.025), mat('#2b2530'), s * 0.22, 0.22, a * 0.2), 0, -s * a, s * -0.5))),
    ],
  },
  dragon: {
    name: 'Dragon', icon: '🐉', height: 1,
    make: () => {
      const body = part(ball(0.24, 10), mat('#b8322a'), 0, 0.36, -0.05);
      body.scale.set(1, 1, 1.5);
      const wing = (s: number) => {
        const w = part(cone(0.3, 0.02, 3), mat('#8a2420', { side: THREE.DoubleSide }), s * 0.32, 0.6, -0.08);
        w.scale.set(1, 1, 1.2);
        w.rotation.z = s * 0.5;
        return w;
      };
      return [
        body,
        tilt(part(cyl(0.09, 0.13, 0.32, 8), mat('#b8322a'), 0, 0.6, 0.25), 0.7),
        part(box(0.18, 0.15, 0.28), mat('#c43c32'), 0, 0.76, 0.42),
        part(cone(0.03, 0.12, 5), mat('#f1ecdd'), -0.06, 0.88, 0.34),
        part(cone(0.03, 0.12, 5), mat('#f1ecdd'), 0.06, 0.88, 0.34),
        ...eyes(0.8, 0.52, 0.07, 0.025, '#ffd34a'),
        wing(-1), wing(1),
        tilt(part(cone(0.1, 0.5, 6), mat('#b8322a'), 0, 0.3, -0.55), -1.7),
      ];
    },
  },
  ghost: {
    name: 'Ghost', icon: '👻', height: 0.85,
    make: () => {
      const g = { transparent: true, opacity: 0.75, emissive: new THREE.Color('#9fd8ff'), emissiveIntensity: 0.25 };
      return [
        part(cyl(0.2, 0.26, 0.4, 12), mat('#eef6ff', g), 0, 0.36, 0),
        part(ball(0.2, 12), mat('#eef6ff', g), 0, 0.56, 0),
        ...eyes(0.58, 0.18, 0.07, 0.035),
      ];
    },
  },
  marker: {
    name: 'Marker', icon: '📍', height: 0.5,
    make: () => [part(cone(0.12, 0.3, 8), mat('#f1f5f9'), 0, 0.25, 0).rotateX(Math.PI), part(ball(0.1, 8), mat('#f1f5f9'), 0, 0.42, 0)],
  },
};

// ---- the wider library -------------------------------------------------------
// Everything below is more of the same: a few primitives per piece, so the whole
// library still downloads in the blink of an eye on a phone.

Object.assign(BLOCKS, {
  meadow: { name: 'Dark grass', color: '#4b8a3c' },
  mud: { name: 'Mud', color: '#5b4636' },
  gravel: { name: 'Gravel', color: '#9a958c' },
  moss: { name: 'Mossy stone', color: '#6f8459' },
  clay: { name: 'Clay', color: '#b5651d' },
  basalt: { name: 'Basalt', color: '#3a3d45' },
  ice: { name: 'Ice', color: '#bfe6f5', opacity: 0.78, rough: 0.1 },
  darkwood: { name: 'Dark planks', color: '#6e4a2b' },
  thatch: { name: 'Thatch', color: '#c9a84f' },
  roof: { name: 'Roof tiles', color: '#8c3b2e' },
  slate: { name: 'Slate', color: '#4f5d73' },
  plaster: { name: 'Plaster', color: '#e6dfd0' },
  sandstone: { name: 'Sandstone', color: '#d1b37a' },
  iron: { name: 'Iron', color: '#6b7078', rough: 0.4 },
  gold: { name: 'Gold', color: '#e3b53c', rough: 0.3 },
  carpet: { name: 'Carpet', color: '#9b2c3a' },
  glass: { name: 'Glass', color: '#cfeaf2', opacity: 0.35, rough: 0.05 },
} satisfies Record<string, BlockDef>);

const glow = (c: string, i = 1.2) => mat(c, { emissive: new THREE.Color(c), emissiveIntensity: i });
const flat = (c: string) => mat(c, { flatShading: true });
const metal = (c: string) => mat(c, { metalness: 0.6, roughness: 0.4 });
const lay = (o: THREE.Mesh, x = 0, y = 0, z = 0) => tilt(o, x, y, z) as THREE.Mesh;
const squash = (o: THREE.Mesh, x: number, y: number, z: number) => { o.scale.set(x, y, z); return o; };
const legs4 = (c: string, w: number, d: number, h: number, t = 0.06) =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => part(box(t, h, t), mat(c), x * w, h / 2, z * d));

Object.assign(PROPS, {
  // nature
  deadtree: { name: 'Dead tree', icon: '🍂', make: () => group(
    part(cyl(0.07, 0.12, 0.9, 6), mat('#5a4a3c'), 0, 0.45, 0),
    lay(part(cyl(0.03, 0.05, 0.5, 5), mat('#5a4a3c'), 0.17, 0.85, 0), 0, 0, -0.9),
    lay(part(cyl(0.03, 0.05, 0.42, 5), mat('#5a4a3c'), -0.14, 0.7, 0.05), 0.3, 0, 0.8)) },
  palm: { name: 'Palm', icon: '🌴', make: () => group(
    lay(part(cyl(0.06, 0.09, 1.2, 6), mat('#8a6a45'), 0.06, 0.6, 0), 0, 0, -0.1),
    ...[0, 1, 2, 3, 4].map((i) => {
      const a = (i * Math.PI * 2) / 5;
      return lay(squash(part(cone(0.12, 0.6, 4), flat('#3f9a4a'), 0.12 + Math.cos(a) * 0.25, 1.18, Math.sin(a) * 0.25), 1, 1, 0.35), 0, -a, -1.9);
    })) },
  mushroom: { name: 'Giant mushroom', icon: '🍄', make: () => group(
    part(cyl(0.09, 0.12, 0.5, 8), mat('#eee6d2'), 0, 0.25, 0),
    part(new THREE.SphereGeometry(0.36, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('#c8372d'), 0, 0.45, 0),
    ...[[0.15, 0.1], [-0.18, -0.05], [0, -0.2]].map(([x, z]) => part(ball(0.05, 6), mat('#fff'), x, 0.74, z))) },
  flowers: { name: 'Flowers', icon: '🌼', make: () => group(
    ...[[-0.2, 0.1, '#f5d90a'], [0.15, -0.15, '#e93d82'], [0.2, 0.2, '#f1f5f9'], [-0.1, -0.22, '#8e4ec6']].flatMap(([x, z, c]) => [
      part(cyl(0.012, 0.012, 0.22, 4), mat('#3f8a3f'), x as number, 0.11, z as number),
      part(ball(0.05, 6), mat(c as string), x as number, 0.24, z as number)])) },
  reeds: { name: 'Tall grass', icon: '🌾', make: () => group(
    ...[[-0.25, 0], [0.2, 0.15], [0, -0.25], [0.25, -0.2], [-0.1, 0.25], [0.05, 0.05]].map(([x, z], i) =>
      part(cone(0.05, 0.35 + (i % 3) * 0.12, 4), flat(i % 2 ? '#6aa84f' : '#57963f'), x, 0.2 + (i % 3) * 0.06, z))) },
  log: { name: 'Log', icon: '🪵', make: () => group(
    lay(part(cyl(0.16, 0.16, 0.85, 10), mat('#7a5230'), 0, 0.16, 0), 0, 0, Math.PI / 2),
    lay(part(cyl(0.12, 0.12, 0.86, 10), mat('#c9a06a'), 0, 0.16, 0), 0, 0, Math.PI / 2)) },
  stump: { name: 'Stump', icon: '🪓', make: () => group(
    part(cyl(0.2, 0.25, 0.28, 9), mat('#6b4a2b'), 0, 0.14, 0),
    part(cyl(0.18, 0.18, 0.02, 9), mat('#c9a06a'), 0, 0.29, 0)) },
  cactus: { name: 'Cactus', icon: '🌵', make: () => group(
    part(cyl(0.12, 0.13, 0.9, 8), mat('#3f8f4f'), 0, 0.45, 0),
    part(cyl(0.07, 0.07, 0.3, 6), mat('#3f8f4f'), 0.24, 0.6, 0), lay(part(cyl(0.07, 0.07, 0.2, 6), mat('#3f8f4f'), 0.16, 0.46, 0), 0, 0, Math.PI / 2),
    part(cyl(0.06, 0.06, 0.24, 6), mat('#3f8f4f'), -0.22, 0.45, 0), lay(part(cyl(0.06, 0.06, 0.16, 6), mat('#3f8f4f'), -0.15, 0.34, 0), 0, 0, Math.PI / 2)) },
  crystal: { name: 'Crystals', icon: '💎', make: () => group(
    lay(part(cone(0.13, 0.7, 5), glow('#58d6e8', 0.8), 0, 0.35, 0), 0, 0, 0.1),
    lay(part(cone(0.09, 0.45, 5), glow('#7be3f2', 0.8), 0.2, 0.2, 0.1), 0, 0, -0.5),
    lay(part(cone(0.08, 0.38, 5), glow('#3bbfd6', 0.8), -0.18, 0.17, -0.1), 0.3, 0, 0.6)) },
  stalagmite: { name: 'Stalagmites', icon: '🗻', make: () => group(
    part(cone(0.2, 0.8, 6), flat('#7a7680'), -0.08, 0.4, 0), part(cone(0.13, 0.45, 6), flat('#8a8690'), 0.22, 0.22, 0.12), part(cone(0.1, 0.3, 6), flat('#6f6b75'), 0.05, 0.15, -0.26)) },
  // structures
  stairs: { name: 'Stairs', icon: '🪜', make: () => group(
    ...[0, 1, 2, 3].map((i) => part(box(1, 0.25 * (i + 1), 0.25), mat('#8d9199'), 0, 0.125 * (i + 1), -0.375 + i * 0.25))) },
  ladder: { name: 'Ladder', icon: '🧗', make: () => group(
    part(box(0.05, 1, 0.05), mat('#8a623a'), -0.22, 0.5, -0.42), part(box(0.05, 1, 0.05), mat('#8a623a'), 0.22, 0.5, -0.42),
    ...[0.15, 0.38, 0.61, 0.84].map((y) => part(box(0.44, 0.04, 0.04), mat('#9b6f42'), 0, y, -0.42))) },
  arch: { name: 'Archway', icon: '⛩️', make: () => group(
    part(box(0.16, 1, 0.3), mat('#8d9199'), -0.42, 0.5, 0), part(box(0.16, 1, 0.3), mat('#8d9199'), 0.42, 0.5, 0),
    part(box(1, 0.18, 0.34), mat('#7d8189'), 0, 0.91, 0)) },
  gate: { name: 'Portcullis', icon: '🚧', make: () => group(
    part(box(0.1, 1, 0.14), mat('#5d6068'), -0.45, 0.5, 0), part(box(0.1, 1, 0.14), mat('#5d6068'), 0.45, 0.5, 0),
    ...[-0.27, -0.09, 0.09, 0.27].map((x) => part(box(0.045, 0.96, 0.045), metal('#3a3a40'), x, 0.48, 0)),
    ...[0.3, 0.65].map((y) => part(box(0.8, 0.045, 0.05), metal('#3a3a40'), 0, y, 0))) },
  bridge: { name: 'Bridge', icon: '🌉', make: () => group(
    part(box(1, 0.08, 0.9), mat('#9b6f42'), 0, 0.06, 0),
    part(box(1, 0.05, 0.05), mat('#7a5230'), 0, 0.42, -0.43), part(box(1, 0.05, 0.05), mat('#7a5230'), 0, 0.42, 0.43),
    ...[[-0.45, -0.43], [0.45, -0.43], [-0.45, 0.43], [0.45, 0.43]].map(([x, z]) => part(box(0.06, 0.4, 0.06), mat('#7a5230'), x, 0.25, z))) },
  well: { name: 'Well', icon: '🪣', make: () => group(
    part(cyl(0.36, 0.38, 0.4, 12), mat('#8d9199'), 0, 0.2, 0), part(cyl(0.28, 0.28, 0.02, 12), mat('#2b5f9e'), 0, 0.36, 0),
    part(box(0.06, 0.6, 0.06), mat('#6b4a2b'), -0.32, 0.7, 0), part(box(0.06, 0.6, 0.06), mat('#6b4a2b'), 0.32, 0.7, 0),
    lay(part(cone(0.5, 0.28, 4), mat('#8c3b2e'), 0, 1.12, 0), 0, Math.PI / 4)) },
  tent: { name: 'Tent', icon: '⛺', make: () => group(
    lay(part(cone(0.62, 0.85, 4), flat('#c9b68a'), 0, 0.43, 0), 0, Math.PI / 4),
    part(box(0.22, 0.4, 0.02), mat('#3a2f25'), 0, 0.2, 0.44), part(cyl(0.02, 0.02, 0.2, 5), mat('#5a3b21'), 0, 0.93, 0)) },
  banner: { name: 'Banner', icon: '🚩', make: () => group(
    part(cyl(0.03, 0.03, 1.3, 6), mat('#5a3b21'), 0, 0.65, 0), part(box(0.4, 0.55, 0.02), mat('#b8322a'), 0.22, 0.95, 0),
    part(ball(0.05, 6), metal('#e3b53c'), 0, 1.32, 0)) },
  statue: { name: 'Statue', icon: '🗿', make: () => group(
    part(box(0.5, 0.2, 0.5), mat('#9a9aa2'), 0, 0.1, 0), part(cyl(0.13, 0.17, 0.5, 8), mat('#b0b0b8'), 0, 0.45, 0),
    part(ball(0.13, 8), mat('#b0b0b8'), 0, 0.8, 0), part(box(0.04, 0.5, 0.04), mat('#b0b0b8'), 0.2, 0.6, 0.05)) },
  fountain: { name: 'Fountain', icon: '⛲', make: () => group(
    part(cyl(0.46, 0.48, 0.22, 14), mat('#b9b4aa'), 0, 0.11, 0), part(cyl(0.4, 0.4, 0.02, 14), mat('#3b8fd9', { transparent: true, opacity: 0.8 }), 0, 0.23, 0),
    part(cyl(0.07, 0.09, 0.55, 8), mat('#b9b4aa'), 0, 0.4, 0), part(cyl(0.2, 0.1, 0.08, 10), mat('#b9b4aa'), 0, 0.68, 0)) },
  tombstone: { name: 'Tombstone', icon: '🪦', make: () => group(
    part(box(0.4, 0.45, 0.12), mat('#8a8d94'), 0, 0.23, 0), lay(part(cyl(0.2, 0.2, 0.12, 12), mat('#8a8d94'), 0, 0.45, 0), Math.PI / 2),
    part(box(0.5, 0.06, 0.3), mat('#5b4636'), 0, 0.03, 0.12)) },
  altar: { name: 'Altar', icon: '🕍', make: () => group(
    part(box(0.9, 0.5, 0.5), mat('#9a9aa2'), 0, 0.25, 0), part(box(0.5, 0.52, 0.52), mat('#7a2233'), 0, 0.26, 0),
    part(cyl(0.03, 0.03, 0.16, 5), mat('#eee6d2'), -0.33, 0.58, 0), part(ball(0.035, 6), glow('#ffb02e', 1.5), -0.33, 0.68, 0),
    part(cyl(0.03, 0.03, 0.16, 5), mat('#eee6d2'), 0.33, 0.58, 0), part(ball(0.035, 6), glow('#ffb02e', 1.5), 0.33, 0.68, 0)) },
  // furniture
  chair: { name: 'Chair', icon: '🪑', make: () => group(
    part(box(0.36, 0.05, 0.36), mat('#9b6b3a'), 0, 0.3, 0), part(box(0.36, 0.4, 0.05), mat('#8a5c33'), 0, 0.52, -0.16), ...legs4('#7a5230', 0.15, 0.15, 0.3, 0.05)) },
  bench: { name: 'Bench', icon: '🛋️', make: () => group(
    part(box(0.95, 0.06, 0.3), mat('#9b6b3a'), 0, 0.28, 0), ...legs4('#7a5230', 0.4, 0.11, 0.26)) },
  bed: { name: 'Bed', icon: '🛏️', make: () => group(
    part(box(0.6, 0.2, 0.96), mat('#7a5230'), 0, 0.14, 0), part(box(0.56, 0.1, 0.7), mat('#b8322a'), 0, 0.29, 0.11),
    part(box(0.44, 0.09, 0.2), mat('#f1f5f9'), 0, 0.3, -0.34), part(box(0.6, 0.45, 0.06), mat('#6b4a2b'), 0, 0.25, -0.46)) },
  bookshelf: { name: 'Bookshelf', icon: '📚', make: () => group(
    part(box(0.9, 1, 0.3), mat('#6e4a2b'), 0, 0.5, -0.3),
    ...[0.2, 0.5, 0.8].flatMap((y, r) => ['#b8322a', '#3567b0', '#4f7a3a', '#e3b53c', '#6b3fa8'].map((c, i) =>
      part(box(0.12, 0.2, 0.06), mat(c), -0.3 + ((i + r) % 5) * 0.15, y, -0.14)))) },
  throne: { name: 'Throne', icon: '👑', make: () => group(
    part(box(0.56, 0.36, 0.5), mat('#6b3fa8'), 0, 0.18, 0), part(box(0.56, 0.75, 0.1), mat('#e3b53c', { metalness: 0.5, roughness: 0.4 }), 0, 0.7, -0.22),
    part(box(0.08, 0.2, 0.44), metal('#e3b53c'), -0.28, 0.46, 0), part(box(0.08, 0.2, 0.44), metal('#e3b53c'), 0.28, 0.46, 0)) },
  cauldron: { name: 'Cauldron', icon: '🍲', make: () => group(
    squash(part(ball(0.3, 12), metal('#2b2b30'), 0, 0.3, 0), 1, 0.85, 1), part(cyl(0.24, 0.24, 0.02, 12), glow('#58d68d', 0.9), 0, 0.5, 0),
    ...[0, 1, 2].map((i) => part(box(0.05, 0.12, 0.05), metal('#2b2b30'), Math.cos(i * 2.1) * 0.2, 0.06, Math.sin(i * 2.1) * 0.2))) },
  anvil: { name: 'Anvil', icon: '⚒️', make: () => group(
    part(box(0.3, 0.2, 0.24), metal('#3f4248'), 0, 0.1, 0), part(box(0.16, 0.14, 0.16), metal('#3f4248'), 0, 0.27, 0),
    part(box(0.6, 0.14, 0.22), metal('#4f5258'), 0.04, 0.41, 0)) },
  rug: { name: 'Rug', icon: '🧶', make: () => group(
    part(box(0.94, 0.03, 0.7), mat('#9b2c3a'), 0, 0.02, 0), part(box(0.7, 0.035, 0.46), mat('#e3b53c'), 0, 0.02, 0), part(box(0.56, 0.04, 0.32), mat('#9b2c3a'), 0, 0.02, 0)) },
  candles: { name: 'Candles', icon: '🕯️', make: () => group(
    ...[[0, 0, 0.3], [0.14, 0.08, 0.2], [-0.12, 0.1, 0.16]].flatMap(([x, z, h]) => [
      part(cyl(0.04, 0.04, h, 6), mat('#eee6d2'), x, h / 2, z), part(ball(0.03, 6), glow('#ffb02e', 1.8), x, h + 0.03, z)])) },
  sacks: { name: 'Sacks', icon: '💰', make: () => group(
    squash(part(ball(0.2, 8), mat('#b89a6a'), -0.1, 0.17, 0), 1, 0.9, 1), squash(part(ball(0.16, 8), mat('#a88a5a'), 0.2, 0.14, 0.1), 1, 0.9, 1),
    part(cone(0.06, 0.1, 6), mat('#b89a6a'), -0.1, 0.38, 0)) },
  // dungeon & treasure
  hoard: { name: 'Gold pile', icon: '🪙', make: () => group(
    squash(part(ball(0.34, 10), metal('#e3b53c'), 0, 0.06, 0), 1, 0.45, 1),
    ...[[0.2, 0.1], [-0.15, 0.2], [0.05, -0.22]].map(([x, z]) => part(cyl(0.06, 0.06, 0.02, 8), metal('#f2cf5a'), x, 0.17, z)),
    part(new THREE.OctahedronGeometry(0.07), glow('#e5484d', 0.6), 0, 0.24, 0)) },
  potion: { name: 'Potions', icon: '🧪', make: () => group(
    ...[[-0.12, 0, '#e5484d'], [0.1, 0.08, '#3e63dd'], [0, -0.14, '#46a758']].flatMap(([x, z, c]) => [
      part(ball(0.08, 8), glow(c as string, 0.5), x as number, 0.09, z as number), part(cyl(0.025, 0.025, 0.08, 6), mat('#cfeaf2'), x as number, 0.19, z as number)])) },
  cage: { name: 'Cage', icon: '⛓️', make: () => group(
    part(box(0.8, 0.05, 0.8), metal('#3a3a40'), 0, 0.03, 0), part(box(0.8, 0.05, 0.8), metal('#3a3a40'), 0, 0.95, 0),
    ...Array.from({ length: 12 }, (_, i) => { const s = i % 3, e = Math.floor(i / 3); const t = -0.36 + s * 0.24 + (e % 2 ? 0.12 : 0);
      return part(cyl(0.02, 0.02, 0.9, 5), metal('#4a4a52'), e < 2 ? t : (e === 2 ? -0.37 : 0.37), 0.49, e < 2 ? (e === 0 ? -0.37 : 0.37) : t); })) },
  bones: { name: 'Bones', icon: '🦴', make: () => group(
    part(ball(0.1, 8), mat('#f1ecdd'), 0.1, 0.1, 0.05),
    lay(part(cyl(0.025, 0.025, 0.4, 5), mat('#e9e4d4'), -0.12, 0.03, 0.1), 0, 0.5, Math.PI / 2),
    lay(part(cyl(0.025, 0.025, 0.34, 5), mat('#e9e4d4'), 0, 0.03, -0.18), 0, -0.7, Math.PI / 2),
    lay(part(cyl(0.02, 0.02, 0.26, 5), mat('#e9e4d4'), -0.2, 0.03, -0.1), 0, 1.3, Math.PI / 2)) },
  spikes: { name: 'Spike trap', icon: '📌', make: () => group(
    part(box(0.9, 0.04, 0.9), mat('#4a4a52'), 0, 0.02, 0),
    ...[-0.28, 0, 0.28].flatMap((x) => [-0.28, 0, 0.28].map((z) => part(cone(0.05, 0.32, 5), metal('#c9ccd2'), x, 0.2, z)))) },
  portal: { name: 'Portal', icon: '🌀', make: () => group(
    part(new THREE.TorusGeometry(0.42, 0.06, 8, 24), mat('#5d6068'), 0, 0.52, 0),
    part(new THREE.CircleGeometry(0.4, 24), mat('#a66bff', { emissive: new THREE.Color('#8e4ec6'), emissiveIntensity: 1.3, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }), 0, 0.52, 0)) },
  coffin: { name: 'Coffin', icon: '⚰️', make: () => group(
    part(box(0.42, 0.24, 0.95), mat('#4a3526'), 0, 0.12, 0), part(box(0.46, 0.05, 0.99), mat('#5a4030'), 0, 0.26, 0),
    part(box(0.05, 0.02, 0.3), metal('#e3b53c'), 0, 0.29, -0.1), part(box(0.18, 0.02, 0.05), metal('#e3b53c'), 0, 0.29, -0.17)) },
} satisfies Record<string, PropDef>);

/** A four-legged animal facing +z. */
function beast(c: string, len: number, h: number, o: { head?: number; ears?: boolean; tail?: number; snout?: number } = {}): THREE.Object3D[] {
  const hd = o.head ?? 0.2, w = len * 0.42;
  return [
    part(box(w, h * 0.5, len), mat(c), 0, h * 0.75 + 0.08, 0),
    part(box(hd, hd, hd), mat(c), 0, h + 0.08 + hd * 0.2, len / 2 + hd * 0.25),
    ...(o.snout ? [part(box(hd * 0.55, hd * 0.45, o.snout), mat(c), 0, h + 0.05, len / 2 + hd * 0.7 + o.snout / 2)] : []),
    ...(o.ears === false ? [] : [-1, 1].map((s) => part(cone(hd * 0.2, hd * 0.4, 4), mat(c), s * hd * 0.3, h + 0.08 + hd * 0.85, len / 2 + hd * 0.2))),
    ...(o.tail ? [lay(part(cone(0.04, o.tail, 5), mat(c), 0, h * 0.9, -len / 2 - o.tail * 0.3), -2)] : []),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => part(box(w * 0.26, h * 0.55, w * 0.26), mat(c), x * w * 0.34, h * 0.28 + 0.08, z * len * 0.36)),
    ...eyes(h + 0.1 + hd * 0.3, len / 2 + hd * 0.76, hd * 0.25, 0.02),
  ];
}

Object.assign(MINIS, {
  // heroes
  paladin: { name: 'Paladin', icon: '⚜️', height: 0.95, make: () => [
    ...person('#e3e7ec'), part(ball(0.155, 10), metal('#e3b53c'), 0, 0.71, -0.02),
    part(box(0.06, 0.34, 0.28), metal('#e3b53c'), -0.23, 0.38, 0.05), part(box(0.05, 0.5, 0.05), metal('#c9ccd2'), 0.23, 0.5, 0.05),
    part(box(0.12, 0.12, 0.12), metal('#c9ccd2'), 0.23, 0.78, 0.05)] },
  barbarian: { name: 'Barbarian', icon: '🪓', height: 1, make: () => [
    ...person('#8a5a3c', { h: 0.54, w: 0.21 }), part(box(0.34, 0.1, 0.24), mat('#6b4a2b'), 0, 0.36, 0),
    part(box(0.04, 0.7, 0.04), mat('#5a3b21'), 0.28, 0.5, 0.05), part(box(0.04, 0.22, 0.26), metal('#9aa3ad'), 0.28, 0.76, 0.1),
    part(cone(0.15, 0.14, 8), mat('#b8322a'), 0, 0.86, 0)] },
  druid: { name: 'Druid', icon: '🌿', height: 1.05, make: () => [
    part(cone(0.24, 0.56, 10), mat('#4f7a3a'), 0, 0.36, 0), part(ball(0.14, 10), mat(SKIN), 0, 0.68, 0), ...eyes(0.7, 0.125, 0.055, 0.022),
    lay(part(cone(0.03, 0.2, 4), mat('#c9a06a'), -0.1, 0.84, 0), 0, 0, 0.5), lay(part(cone(0.03, 0.2, 4), mat('#c9a06a'), 0.1, 0.84, 0), 0, 0, -0.5),
    part(cyl(0.025, 0.03, 0.9, 6), mat('#6b4a2b'), 0.25, 0.5, 0.05), part(ball(0.08, 6), flat('#57a955'), 0.25, 0.98, 0.05)] },
  monk: { name: 'Monk', icon: '🥋', height: 0.9, make: () => [
    ...person('#d98a2b'), part(box(0.36, 0.06, 0.3), mat('#7a2233'), 0, 0.3, 0), part(cyl(0.02, 0.02, 0.95, 6), mat('#6b4a2b'), 0.24, 0.5, 0.05)] },
  // folk
  villager: { name: 'Villager', icon: '🧑‍🌾', height: 0.9, make: () => [
    ...person('#7d6a55'), part(cyl(0.22, 0.24, 0.03, 12), mat('#c9a84f'), 0, 0.78, 0), part(cyl(0.11, 0.13, 0.1, 10), mat('#c9a84f'), 0, 0.83, 0)] },
  merchant: { name: 'Merchant', icon: '🧳', height: 0.9, make: () => [
    ...person('#3a6ea8', { w: 0.2 }), part(cyl(0.13, 0.15, 0.1, 10), mat('#7a2233'), 0, 0.82, 0),
    squash(part(ball(0.13, 8), mat('#b89a6a'), 0.24, 0.2, 0.05), 1, 0.9, 1)] },
  king: { name: 'Noble', icon: '👑', height: 0.95, make: () => [
    part(cone(0.25, 0.56, 10), mat('#7a2233'), 0, 0.36, 0), part(ball(0.14, 10), mat(SKIN), 0, 0.68, 0), ...eyes(0.7, 0.125, 0.055, 0.022),
    part(cyl(0.12, 0.11, 0.1, 8), metal('#e3b53c'), 0, 0.84, 0), part(box(0.5, 0.08, 0.3), mat('#f1f5f9'), 0, 0.56, -0.02)] },
  child: { name: 'Child', icon: '🧒', height: 0.65, make: () => [...person('#e0b93a', { h: 0.3, w: 0.14 }), part(ball(0.15, 8), mat('#6b4a2b'), 0, 0.52, -0.03)] },
  guard: { name: 'Guard', icon: '💂', height: 1, make: () => [
    ...person('#b8322a'), part(cyl(0.15, 0.16, 0.14, 10), metal('#9aa3ad'), 0, 0.8, 0),
    part(cyl(0.02, 0.02, 1, 6), mat('#6b4a2b'), 0.24, 0.55, 0.05), part(cone(0.05, 0.16, 5), metal('#c9ccd2'), 0.24, 1.12, 0.05)] },
  pirate: { name: 'Pirate', icon: '🏴‍☠️', height: 0.95, make: () => [
    ...person('#2b2b30'), part(box(0.44, 0.04, 0.2), mat('#1b1b1f'), 0, 0.8, 0), part(cyl(0.12, 0.14, 0.1, 8), mat('#1b1b1f'), 0, 0.85, 0),
    part(box(0.34, 0.07, 0.3), mat('#b8322a'), 0, 0.34, 0), lay(part(box(0.03, 0.36, 0.05), metal('#c9ccd2'), 0.22, 0.42, 0.1), 0.6)] },
  witch: { name: 'Witch', icon: '🧹', height: 1.1, make: () => [
    part(cone(0.24, 0.56, 10), mat('#2b2530'), 0, 0.36, 0), part(ball(0.14, 10), mat('#a8c98a'), 0, 0.68, 0), ...eyes(0.7, 0.125, 0.055, 0.022),
    part(cyl(0.26, 0.26, 0.025, 12), mat('#1b1b1f'), 0, 0.78, 0), lay(part(cone(0.13, 0.4, 10), mat('#1b1b1f'), 0.03, 0.97, 0), 0, 0, -0.2),
    lay(part(cyl(0.02, 0.02, 0.8, 5), mat('#8a623a'), 0.25, 0.4, 0), 0.2), part(cone(0.07, 0.2, 6), mat('#c9a84f'), 0.25, 0.1, -0.07)] },
  // beasts
  bear: { name: 'Bear', icon: '🐻', height: 0.8, make: () => beast('#6b4a2b', 0.62, 0.5, { head: 0.26, snout: 0.1 }) },
  horse: { name: 'Horse', icon: '🐴', height: 0.95, make: () => [
    ...beast('#8a5c33', 0.66, 0.62, { head: 0.2, snout: 0.16, tail: 0.3 }), part(box(0.05, 0.2, 0.3), mat('#3a2f25'), 0, 0.92, 0.2)] },
  cat: { name: 'Cat', icon: '🐈', height: 0.45, make: () => beast('#d98a2b', 0.34, 0.22, { head: 0.15, tail: 0.3 }) },
  dog: { name: 'Dog', icon: '🐕', height: 0.55, make: () => beast('#c9a06a', 0.42, 0.3, { head: 0.17, snout: 0.09, tail: 0.2 }) },
  rat: { name: 'Giant rat', icon: '🐀', height: 0.4, make: () => beast('#6f6b75', 0.36, 0.18, { head: 0.14, snout: 0.08, tail: 0.36 }) },
  boar: { name: 'Boar', icon: '🐗', height: 0.6, make: () => [
    ...beast('#5a4636', 0.5, 0.34, { head: 0.22, snout: 0.1 }),
    lay(part(cone(0.025, 0.1, 4), mat('#f1ecdd'), -0.07, 0.42, 0.42), -0.6), lay(part(cone(0.025, 0.1, 4), mat('#f1ecdd'), 0.07, 0.42, 0.42), -0.6)] },
  bat: { name: 'Bat', icon: '🦇', height: 0.7, make: () => [
    part(ball(0.12, 8), mat('#3a3240'), 0, 0.5, 0), ...eyes(0.53, 0.1, 0.045, 0.02, '#ff3b3b'),
    ...[-1, 1].map((s) => lay(squash(part(cone(0.22, 0.02, 3), mat('#2b2530', { side: THREE.DoubleSide }), s * 0.26, 0.52, 0), 1.2, 1, 0.8), 0, 0, s * 0.3)),
    part(cone(0.03, 0.08, 4), mat('#3a3240'), -0.06, 0.63, 0), part(cone(0.03, 0.08, 4), mat('#3a3240'), 0.06, 0.63, 0)] },
  snake: { name: 'Snake', icon: '🐍', height: 0.45, make: () => [
    part(new THREE.TorusGeometry(0.2, 0.06, 6, 14), mat('#4f8a3a'), 0, 0.14, 0).rotateX(Math.PI / 2),
    part(new THREE.TorusGeometry(0.13, 0.055, 6, 12), mat('#57963f'), 0, 0.24, 0).rotateX(Math.PI / 2),
    lay(part(cyl(0.05, 0.06, 0.24, 6), mat('#4f8a3a'), 0, 0.38, 0.08), 0.5), part(ball(0.07, 8), mat('#57963f'), 0, 0.5, 0.16), ...eyes(0.53, 0.21, 0.035, 0.018, '#ffd34a')] },
  // monsters
  zombie: { name: 'Zombie', icon: '🧟', height: 0.9, make: () => [
    ...person('#5d6b5a', { skin: '#8fae7a' }),
    lay(part(box(0.06, 0.28, 0.06), mat('#8fae7a'), -0.17, 0.46, 0.14), -1.3), lay(part(box(0.06, 0.28, 0.06), mat('#8fae7a'), 0.17, 0.46, 0.14), -1.3)] },
  troll: { name: 'Troll', icon: '👾', height: 1.15, make: () => [
    ...person('#5a6b4a', { skin: '#7d9468', h: 0.66, w: 0.27 }), part(ball(0.08, 6), mat('#7d9468'), 0, 0.84, 0.13),
    lay(part(cyl(0.05, 0.09, 0.7, 6), mat('#5a3b21'), 0.36, 0.4, 0.1), 0.4)] },
  imp: { name: 'Imp', icon: '😈', height: 0.65, make: () => [
    ...person('#a8322a', { skin: '#c43c32', h: 0.3, w: 0.14 }),
    part(cone(0.03, 0.12, 5), mat('#2b2530'), -0.08, 0.6, 0), part(cone(0.03, 0.12, 5), mat('#2b2530'), 0.08, 0.6, 0),
    ...[-1, 1].map((s) => lay(squash(part(cone(0.16, 0.02, 3), mat('#7a1f1a', { side: THREE.DoubleSide }), s * 0.2, 0.36, -0.1), 1, 1, 0.8), 0, 0, s * 0.5))] },
  golem: { name: 'Golem', icon: '🗿', height: 1.15, make: () => [
    part(box(0.5, 0.5, 0.36), flat('#7d8189'), 0, 0.5, 0), part(box(0.26, 0.24, 0.26), flat('#8d9199'), 0, 0.88, 0),
    part(box(0.16, 0.5, 0.18), flat('#6d7179'), -0.34, 0.45, 0), part(box(0.16, 0.5, 0.18), flat('#6d7179'), 0.34, 0.45, 0),
    part(box(0.18, 0.26, 0.2), flat('#6d7179'), -0.13, 0.2, 0), part(box(0.18, 0.26, 0.2), flat('#6d7179'), 0.13, 0.2, 0),
    ...eyes(0.9, 0.135, 0.06, 0.03, '#58d6e8')] },
  treant: { name: 'Treant', icon: '🌳', height: 1.3, make: () => [
    part(cyl(0.15, 0.22, 0.8, 7), mat('#6b4a2b'), 0, 0.48, 0), part(ball(0.36, 8), flat('#3f8a3a'), 0, 1.08, 0),
    lay(part(cyl(0.04, 0.06, 0.45, 5), mat('#6b4a2b'), -0.28, 0.6, 0), 0, 0, 1), lay(part(cyl(0.04, 0.06, 0.45, 5), mat('#6b4a2b'), 0.28, 0.6, 0), 0, 0, -1),
    ...eyes(0.66, 0.17, 0.06, 0.03, '#ffd34a')] },
  mimic: { name: 'Mimic', icon: '🧰', height: 0.6, make: () => [
    part(box(0.6, 0.26, 0.42), mat('#7a4d22'), 0, 0.21, 0), lay(part(box(0.6, 0.16, 0.42), mat('#8a5a2a'), 0, 0.46, -0.06), -0.45),
    ...[-0.2, -0.07, 0.07, 0.2].map((x) => part(cone(0.03, 0.09, 4), mat('#f1ecdd'), x, 0.38, 0.18)),
    part(box(0.3, 0.03, 0.2), mat('#c43c6a'), 0, 0.35, 0.1), ...eyes(0.5, 0.16, 0.12, 0.035, '#ffd34a')] },
  elemental: { name: 'Fire elemental', icon: '🔥', height: 1.05, make: () => [
    part(cone(0.28, 0.75, 7), glow('#ff7a1a', 1.1), 0, 0.45, 0), part(cone(0.18, 0.5, 6), glow('#ffd34a', 1.3), 0.03, 0.62, 0.03),
    part(cone(0.1, 0.3, 5), glow('#ff9a1f', 1.2), -0.2, 0.38, 0.05), part(cone(0.1, 0.3, 5), glow('#ff9a1f', 1.2), 0.2, 0.42, 0), ...eyes(0.6, 0.15, 0.06, 0.03)] },
  ogre: { name: 'Ogre', icon: '👹', height: 1.2, make: () => [
    ...person('#7a5a3c', { skin: '#c9a06a', h: 0.7, w: 0.3 }), part(box(0.5, 0.12, 0.4), mat('#5a3b21'), 0, 0.4, 0),
    lay(part(cyl(0.06, 0.11, 0.8, 6), mat('#6b4a2b'), 0.4, 0.45, 0.1), 0.3)] },
  // markers
  flag: { name: 'Flag', icon: '🚩', height: 0.8, make: () => [part(cyl(0.02, 0.02, 0.75, 5), mat('#f1f5f9'), 0, 0.45, 0), part(box(0.26, 0.18, 0.015), mat('#e5484d'), 0.14, 0.72, 0)] },
  cross: { name: 'Cross mark', icon: '❌', height: 0.3, make: () => [
    lay(part(box(0.6, 0.05, 0.1), mat('#e5484d'), 0, 0.12, 0), 0, Math.PI / 4), lay(part(box(0.6, 0.05, 0.1), mat('#e5484d'), 0, 0.12, 0), 0, -Math.PI / 4)] },
} satisfies Record<string, MiniDef>);

/** How the library is shelved in the palettes (phones show one shelf at a time). */
export const BLOCK_SHELVES: Record<string, string[]> = {
  Terrain: ['grass', 'meadow', 'dirt', 'mud', 'sand', 'gravel', 'stone', 'moss', 'clay', 'basalt', 'snow', 'ice', 'water', 'lava'],
  Building: ['cobble', 'brick', 'wood', 'darkwood', 'plaster', 'sandstone', 'marble', 'slate', 'roof', 'thatch', 'carpet', 'iron', 'gold', 'glass', 'obsidian'],
};
export const PROP_SHELVES: Record<string, string[]> = {
  Nature: ['tree', 'pine', 'palm', 'deadtree', 'bush', 'reeds', 'flowers', 'mushroom', 'cactus', 'rock', 'stalagmite', 'crystal', 'log', 'stump'],
  Structures: ['door', 'gate', 'arch', 'stairs', 'ladder', 'fence', 'bridge', 'pillar', 'well', 'fountain', 'statue', 'tent', 'banner', 'tombstone', 'altar'],
  Furniture: ['table', 'chair', 'bench', 'bed', 'bookshelf', 'throne', 'rug', 'barrel', 'crate', 'sacks', 'cauldron', 'anvil', 'candles'],
  Dungeon: ['torch', 'campfire', 'chest', 'hoard', 'potion', 'cage', 'bones', 'spikes', 'coffin', 'portal'],
};
export const MINI_SHELVES: Record<string, string[]> = {
  Heroes: ['knight', 'paladin', 'barbarian', 'mage', 'cleric', 'druid', 'rogue', 'ranger', 'monk', 'bard'],
  Folk: ['villager', 'merchant', 'guard', 'king', 'child', 'pirate', 'witch'],
  Beasts: ['bunny', 'cat', 'dog', 'wolf', 'bear', 'boar', 'horse', 'rat', 'bat', 'snake', 'spider'],
  Monsters: ['goblin', 'orc', 'ogre', 'troll', 'skeleton', 'zombie', 'ghost', 'imp', 'slime', 'mimic', 'golem', 'treant', 'elemental', 'dragon'],
  Markers: ['marker', 'flag', 'cross'],
};

export const PLAYER_COLORS = ['#e5484d', '#f2a33a', '#f5d90a', '#46a758', '#12a594', '#3e63dd', '#8e4ec6', '#e93d82', '#f1f5f9', '#30323a'];
