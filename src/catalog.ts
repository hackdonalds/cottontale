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

export const PLAYER_COLORS = ['#e5484d', '#f2a33a', '#f5d90a', '#46a758', '#12a594', '#3e63dd', '#8e4ec6', '#e93d82', '#f1f5f9', '#30323a'];
