# Miniatures made by other people (assets/cc0): rigged, animated models, brought to the table
# as posed statues like every other piece. The pose is one frame of one of the model's own
# animations; colour comes from its materials or its texture and is baked into the vertices,
# so the figure draws with the same material as the rest of the kit.
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from kitlib import COL

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cc0')


def _linear(c):
    c = np.asarray(c, dtype=float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


class Imported:
    def __init__(self, name, file, action='Idle', frame=0, height=0.9, fit=0.92, hide=(), turn=0.0, ao=0.45, tris=0, lift=0.0):
        """`height` is how tall it stands; `fit` the widest it may be across, which wins."""
        self.name, self.file, self.action, self.frame = name, os.path.join(ROOT, file), action, frame
        self.height, self.fit, self.hide, self.turn, self.ao, self.tris, self.lift = height, fit, set(hide), turn, ao, tris, lift

    def build(self):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=self.file)
        new = [o for o in bpy.data.objects if o not in before]
        for o in new:
            if o.type == 'ARMATURE':
                act = next((a for a in bpy.data.actions if a.name.split('|')[-1] == self.action), None)
                if act:
                    o.animation_data_create()
                    o.animation_data.action = act
                    try:
                        o.animation_data.action_slot = act.slots[0]
                    except (AttributeError, IndexError):
                        pass
                    bpy.context.scene.frame_set(int(act.frame_range[0]) + self.frame)
        dg = bpy.context.evaluated_depsgraph_get()
        bm = bmesh.new()
        col = bm.loops.layers.float_color.new(COL)
        for o in new:
            if o.type != 'MESH' or o.name.split('.')[0] in self.hide or o.name.startswith('Icosphere'):
                continue
            e = o.evaluated_get(dg)
            me = e.to_mesh()
            uv = me.uv_layers.active
            paints = []
            for m in me.materials:  # each material: a flat colour, or a picture to read
                flat, pixels = (0.8, 0.8, 0.8), None
                if m and m.use_nodes:
                    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                    if bsdf:
                        flat = tuple(bsdf.inputs['Base Color'].default_value[:3])
                        link = bsdf.inputs['Base Color'].links
                        img = link[0].from_node.image if link and link[0].from_node.type == 'TEX_IMAGE' else None
                        if img:
                            w, h = img.size
                            pixels = _linear(np.array(img.pixels[:]).reshape(h, w, 4)[..., :3])
                paints.append((flat, pixels))
            base = len(bm.verts)
            vs = [bm.verts.new(e.matrix_world @ v.co) for v in me.vertices]
            for p in me.polygons:
                try:
                    f = bm.faces.new([vs[i] for i in p.vertices])
                except ValueError:
                    continue
                f.smooth = p.use_smooth
                flat, pixels = paints[p.material_index] if paints else ((0.8, 0.8, 0.8), None)
                for l, li in zip(f.loops, p.loop_indices):
                    c = flat
                    if pixels is not None and uv:
                        u, v = uv.data[li].uv
                        h, w = pixels.shape[:2]
                        c = pixels[int(v % 1 * h) % h, int(u % 1 * w) % w]
                    l[col] = (c[0], c[1], c[2], 1.0)
            e.to_mesh_clear()
            del base
        for o in new:
            bpy.data.objects.remove(o)
        # Stand it on the table, centred, at table scale.
        lo = Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
        hi = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
        s = min(self.height / (hi.z - lo.z), self.fit / max(hi.x - lo.x, hi.y - lo.y))
        c, sn = math.cos(self.turn), math.sin(self.turn)
        for v in bm.verts:
            x, y, z = (v.co.x - (lo.x + hi.x) / 2) * s, (v.co.y - (lo.y + hi.y) / 2) * s, (v.co.z - lo.z) * s
            v.co = (x * c - y * sn, x * sn + y * c, z + self.lift)  # `lift`: fliers hang in the air
        bm.normal_update()
        # Soft shading in the creases, as on the rest of the kit.
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        tree = BVHTree.FromBMesh(bm)
        rng = np.random.default_rng(11)
        dirs = [Vector(d).normalized() for d in rng.normal(size=(24, 3))]
        cache = {}
        for f in bm.faces:
            centre = f.calc_center_median()
            for l in f.loops:
                k = cache.get(l.vert.index)
                if k is None:
                    n = l.vert.normal
                    p = l.vert.co.lerp(centre, 0.1) + n * 0.004
                    hit = tot = 0.0
                    for d in dirs:
                        w = d.dot(n)
                        if w <= 0.08:
                            continue
                        tot += w
                        loc, _, _, dist = tree.ray_cast(p, d, 0.22)
                        if loc is not None:
                            hit += w * (1 - dist / 0.22) ** 0.5
                    k = cache[l.vert.index] = 1 - self.ao * (hit / tot if tot else 0)
                q = l[col]
                l[col] = (q[0] * k, q[1] * k, q[2] * k, q[3])
        mesh = bpy.data.meshes.new(self.name)
        bm.to_mesh(mesh)
        bm.free()
        attr = mesh.color_attributes[COL]
        mesh.color_attributes.active_color = attr
        mesh.color_attributes.render_color_index = list(mesh.color_attributes).index(attr)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        have = sum(len(p.vertices) - 2 for p in mesh.polygons)
        if self.tris and have > self.tris:  # more detail than a phone can use at this size
            mod = obj.modifiers.new('thin', 'DECIMATE')
            mod.ratio = self.tris / have
            thin = bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
            obj.modifiers.remove(mod)
            obj.data = thin
            bpy.data.meshes.remove(mesh)
            thin.name = self.name
            attr = thin.color_attributes[COL]
            thin.color_attributes.active_color = attr
        return obj


KAY = 'kaykit-adventurers/'
IMPORTED = {
    'm_knight': lambda n: Imported(n, KAY + 'Knight.glb', height=0.95,
                                   hide=('1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield', '2H_Sword')),
    'm_barbarian': lambda n: Imported(n, KAY + 'Barbarian.glb', action='2H_Melee_Idle', height=0.98,
                                      hide=('1H_Axe_Offhand', '1H_Axe', 'Mug', 'Barbarian_Round_Shield')),
    'm_mage': lambda n: Imported(n, KAY + 'Mage.glb', height=1.0, hide=('Spellbook', '1H_Wand')),
    'm_rogue': lambda n: Imported(n, KAY + 'Rogue.glb', height=0.9, hide=('1H_Crossbow', '2H_Crossbow', 'Throwable')),
    'm_ranger': lambda n: Imported(n, KAY + 'Rogue_Hooded.glb', action='2H_Ranged_Aiming', height=0.9,
                                   hide=('Knife_Offhand', 'Knife', '1H_Crossbow', 'Throwable')),
    'm_skeleton': lambda n: Imported(n, 'kaykit-skeletons/Skeleton_Warrior.glb', height=0.95),
    'm_wolf': lambda n: Imported(n, 'quaternius/Wolf.glb', height=0.7, fit=1.05),
    'm_ogre': lambda n: Imported(n, 'quaternius/Orc.glb', height=1.3, fit=1.35, tris=5000),
    'm_ghost': lambda n: Imported(n, 'quaternius/Ghost.glb', action='Flying_Idle', height=0.95),
    'm_slime': lambda n: Imported(n, 'quaternius/Slime.glb', action='Slime_Idle', height=0.5, fit=0.8),
    'm_dog': lambda n: Imported(n, 'quaternius/Husky.glb', height=0.62, fit=1.0),
    'm_horse': lambda n: Imported(n, 'quaternius/Horse.glb', height=1.25, fit=1.45),
    'm_rat': lambda n: Imported(n, 'quaternius/Rat.glb', action='Rat_Idle', height=0.34, fit=0.85),
    'm_bat': lambda n: Imported(n, 'quaternius/Bat.glb', action='', height=0.6, fit=0.95, lift=0.4),
    'm_snake': lambda n: Imported(n, 'quaternius/Snake.glb', action='Snake_Idle', height=0.62, fit=0.85),
    'm_spider': lambda n: Imported(n, 'quaternius/Spider.glb', action='Spider_Idle', height=0.42, fit=1.0),
    'm_imp': lambda n: Imported(n, 'quaternius/Dragonling.glb', action='Flying_Idle', height=0.42, fit=0.95, lift=0.45),
    'm_bunny': lambda n: Imported(n, 'quaternius/Bunny.glb', height=0.78, tris=4500),
    'm_dragon': lambda n: Imported(n, 'quaternius/Dragon.glb', action='', height=1.55, fit=1.9),
    'm_troll': lambda n: Imported(n, 'quaternius/BlueDemon.glb', height=1.2, fit=1.3, tris=5000),
    'm_zombie': lambda n: Imported(n, 'quaternius/Zombie.glb', action='Walk', frame=8, height=0.92, fit=1.0, tris=4500),
    'm_pirate': lambda n: Imported(n, 'quaternius/Pirate.glb', action='', height=0.95, fit=1.0, tris=5000),
    'm_mimic': lambda n: Imported(n, 'quaternius/Mimic.glb', height=0.75, tris=4500),
}
