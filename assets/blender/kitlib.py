# Building blocks for the Cottontale kit. Every piece is modelled by code so the
# whole library can be rebuilt, restyled and diffed.
#
# Conventions (Blender space, Z up; the exporter turns it into three.js Y up):
#   - one table cell is 1 x 1 units, a storey step is 1 unit
#   - a piece's origin is the centre of its cell at floor level
#   - the front of a piece or figure faces -Y (three.js +Z)
#   - colour lives in the vertices ("Color"), with soft shading baked in, so the
#     whole kit draws with one material and no textures
import math
import random

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

COL = 'Color'
# What a surface is made of. The app paints matching detail over the flat colour
# (grain, speckle, dapple), working out where from the shape itself, so pieces carry
# no texture coordinates. The kind travels in the colour's alpha channel, in eighths.
# Leaf turns with the seasons, needle does not. Wood also says which way its grain
# runs once the part is in place: along three.js x, y (up) or z.
KINDS = {None: 1.0, 'stone': 0.25, 'leaf': 0.375, 'needle': 0.5, 'glow': 0.875}  # glow: flame, embers, magic; it lights itself
GRAIN = {0: 0.125, 2: 0.625, 1: 0.75}  # Blender axis the grain follows -> kind


def hexcol(h):
    """'#rrggbb' (sRGB) to linear RGB, which is what vertex colours hold."""
    h = h.lstrip('#')
    return tuple(((int(h[i:i + 2], 16) / 255) ** 2.2) for i in (0, 2, 4))


def mul(c, f):
    return (c[0] * f, c[1] * f, c[2] * f)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


class Piece:
    """One model, built up from chunky bevelled parts."""

    def __init__(self, name, seed=1, ground=True):
        self.name = name
        self.bm = bmesh.new()
        self.col = self.bm.loops.layers.float_color.new(COL)
        # Foliage is lit as one mass, not leaf by leaf: every vertex of a crown is marked with
        # which head it belongs to, and build() gives the whole head one soft set of normals.
        self.bm.verts.layers.int.new('head')
        self.rng = random.Random(seed)
        # Pieces that stand on the table get a contact shadow baked in; blocks
        # that tile against each other do not.
        self.ground = ground

    # ---- helpers ------------------------------------------------------------
    def vary(self, c, amount=0.07):
        """The same paint, mixed slightly differently: keeps repeats from looking stamped."""
        if isinstance(c, str):
            c = hexcol(c)
        f = 1 + self.rng.uniform(-amount, amount)
        warm = self.rng.uniform(-amount, amount) * 0.4
        return (c[0] * f * (1 + warm), c[1] * f, c[2] * f * (1 - warm))

    def _begin(self):
        """A scratch mesh for one part, so its operations cannot disturb the rest of the piece."""
        return bmesh.new()

    def _finish(self, part, col, at, rot, grad, smooth, lift=0.0, tex=None, grain=2, head=0, ramp=None):
        part.normal_update()
        layer = part.loops.layers.float_color.new(COL)
        heads = part.verts.layers.int.new('head')
        for v in part.verts:
            v[heads] = head
        if tex == 'wood':  # which way the grain points once this part has been turned into place
            along = Euler(rot).to_matrix() @ Vector([1.0 if i == grain else 0.0 for i in range(3)])
            kind = GRAIN[max(range(3), key=lambda i: abs(along[i]))]
        else:
            kind = KINDS[tex]
        faces, verts = list(part.faces), list(part.verts)
        if isinstance(col, str):
            col = hexcol(col)
        zs = [v.co.z for v in verts]
        lo, hi = min(zs), max(zs)
        span = max(hi - lo, 1e-6)
        for f in faces:
            f.smooth = smooth
            # Bevels catch the light, like a dry-brushed edge on a painted model.
            n = f.normal
            edge = 1.1 if (not smooth and max(abs(n.x), abs(n.y), abs(n.z)) < 0.93) else 1.0
            for l in f.loops:
                t = (l.vert.co.z - lo) / span
                k = (1 - grad) + (grad + lift) * t
                if ramp:  # coloured by height across the whole crown, not part by part
                    lo_c, hi_c, z0, z1 = ramp
                    base = mix(lo_c, hi_c, min(1.0, max(0.0, (at[2] + l.vert.co.z - z0) / max(z1 - z0, 1e-6))))
                    l[layer] = (*mul(base, col[0] * k), kind)
                else:
                    l[layer] = (*mul(col, k * edge), kind)
        m = Matrix.Translation(Vector(at)) @ Euler(rot).to_matrix().to_4x4()
        bmesh.ops.transform(part, matrix=m, verts=verts)
        tmp = bpy.data.meshes.new('part')
        part.to_mesh(tmp)
        part.free()
        self.bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        self.col = self.bm.loops.layers.float_color[COL]

    # ---- parts ---------------------------------------------------------------
    def box(self, size, at=(0, 0, 0), col='#888888', bevel=0.025, rot=(0, 0, 0), grad=0.12, taper=1.0, tex=None, grain=None):
        """A block standing on `at` (centre of its underside)."""
        w, d, h = size
        part = self._begin()
        r = bmesh.ops.create_cube(part, size=1.0, matrix=Matrix.Translation((0, 0, h / 2)) @ Matrix.Diagonal((w, d, h, 1)))
        if taper != 1.0:
            for v in r['verts']:
                if v.co.z > h / 2:
                    v.co.x *= taper
                    v.co.y *= taper
        if bevel > 0 and min(w, d, h) >= 0.045:  # a bevel on something this thin is triangles nobody sees
            edges = list({e for v in r['verts'] for e in v.link_edges})
            bmesh.ops.bevel(part, geom=edges, offset=min(bevel, min(w, d, h) * 0.45), segments=1, affect='EDGES', profile=0.5)
        return self._finish(part, col, at, rot, grad, False, 0.0, tex, max(range(3), key=lambda i: size[i]) if grain is None else grain)

    def cyl(self, r, h, at=(0, 0, 0), col='#888888', seg=10, r2=None, bevel=0.02, rot=(0, 0, 0), grad=0.12, smooth=True, tex=None, jag=0.0, droop=0.0):
        """An upright cylinder (or cone, with r2=0) standing on `at`."""
        r2 = r if r2 is None else r2
        part = self._begin()
        res = bmesh.ops.create_cone(part, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r2, depth=h,
                                    matrix=Matrix.Translation((0, 0, h / 2)))
        if jag or droop:  # a ragged skirt: every other point of the rim pulled in, the rest sagging
            ring = sorted((v for v in res['verts'] if v.co.z < h / 2 and v.co.xy.length > 1e-6), key=lambda v: math.atan2(v.co.y, v.co.x))
            for i, v in enumerate(ring):
                if i % 2:
                    v.co.xy *= 1 - jag
                else:
                    v.co.z -= droop
        if bevel > 0 and r2 > 0:
            rim = [e for e in {e for v in res['verts'] for e in v.link_edges} if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6]
            bmesh.ops.bevel(part, geom=rim, offset=min(bevel, h * 0.4, min(r, r2) * 0.6), segments=1, affect='EDGES', profile=0.5)
        return self._finish(part, col, at, rot, grad, smooth, 0.0, tex, 2)

    def blob(self, r, at=(0, 0, 0), col='#888888', sub=2, scale=(1, 1, 1), rough=0.0, freq=2.0, rot=(0, 0, 0), grad=0.25, lift=0.12, smooth=False, tex=None, head=0, ramp=None):
        """A lumpy ball centred on `at`: foliage, rocks, heads."""
        part = self._begin()
        res = bmesh.ops.create_icosphere(part, subdivisions=sub, radius=r)
        off = Vector((self.rng.uniform(0, 50), self.rng.uniform(0, 50), self.rng.uniform(0, 50)))
        for v in res['verts']:
            if rough:
                v.co += v.co.normalized() * noise.noise(v.co * freq / max(r, 1e-6) * 0.5 + off) * rough * r
            v.co.x *= scale[0]
            v.co.y *= scale[1]
            v.co.z *= scale[2]
        return self._finish(part, col, at, rot, grad, smooth, lift, tex, 2, head, ramp)

    def leaf(self, at, along, across, length, width, col, facing, head=0, tex='leaf'):
        """
        One leaf of a crown's outer shell: a diamond with its foot at `at`, pointing `along`,
        `width` wide `across`, its face turned toward `facing`. Laid like shingles over a
        crown, and lit by the crown rather than one by one, these read as foliage, not cards.
        """
        part = self._begin()
        a, s = Vector(along).normalized(), Vector(across).normalized()
        pts = [Vector((0, 0, 0)), a * length * 0.42 + s * width / 2, a * length, a * length * 0.42 - s * width / 2]
        if (pts[1] - pts[0]).cross(pts[2] - pts[0]).dot(Vector(facing)) < 0:
            pts.reverse()
        part.faces.new([part.verts.new(q) for q in pts])
        return self._finish(part, col, at, (0, 0, 0), 0.0, True, 0.0, tex, 2, head)

    def lathe(self, profile, at=(0, 0, 0), col='#888888', seg=10, rot=(0, 0, 0), grad=0.12, lift=0.0, smooth=True, tex=None, rib=0.0, close=True):
        """
        A turned shape, like something off a potter's wheel: `profile` is its outline as
        (radius, height) points from the bottom up, spun round the upright axis. A radius of
        0 closes it to a point. `rib` pulls every other spoke in, for fluted or ribbed forms.
        Give an open outline from the inside out to get a surface that faces down.
        """
        part = self._begin()
        rings = []
        for radius, z in profile:
            if radius <= 1e-6:
                rings.append([part.verts.new((0, 0, z))])
            else:
                rings.append([part.verts.new((math.cos(i * math.tau / seg) * radius * (1 - rib * (i % 2)), math.sin(i * math.tau / seg) * radius * (1 - rib * (i % 2)), z)) for i in range(seg)])
        for a, b in zip(rings, rings[1:]):
            for i in range(seg):
                j = (i + 1) % seg
                if len(a) == 1 and len(b) == 1:
                    continue
                if len(a) == 1:
                    part.faces.new((a[0], b[j], b[i]) if profile[0][1] > profile[-1][1] else (a[0], b[i], b[j]))
                elif len(b) == 1:
                    part.faces.new((a[i], a[j], b[0]))
                else:
                    part.faces.new((a[i], a[j], b[j], b[i]))
        if close:
            if len(rings[0]) > 1:
                part.faces.new(list(reversed(rings[0])))
            if len(rings[-1]) > 1:
                part.faces.new(rings[-1])
            bmesh.ops.recalc_face_normals(part, faces=part.faces[:])
        return self._finish(part, col, at, rot, grad, smooth, lift, tex, 2)

    def quad(self, points, col, tex=None, head=0):
        """A single flat face through four points given anticlockwise as seen from its front: a frond, a sail, a flag."""
        part = self._begin()
        part.faces.new([part.verts.new(Vector(q)) for q in points])
        return self._finish(part, col, (0, 0, 0), (0, 0, 0), 0.0, True, 0.0, tex, 2, head)

    def fused(self, lobes, tris=320, voxel=0.05, rough=0.0, col='#888888', smooth=True, tex='leaf', head=0, ramp=None, squash=1.0):
        """
        Several rounded masses melted into ONE skin. Overlapping balls show a crease wherever
        they meet, and a crown made of them looks like a bunch of balls; fused, the same
        masses become a single lumpy form, like a cloud, with no seams. `lobes` are
        (centre, radius, height-radius); the result is thinned to about `tris` triangles.
        """
        raw = bmesh.new()
        for c, rx, rz in lobes:
            bmesh.ops.create_icosphere(raw, subdivisions=3, radius=1.0, matrix=Matrix.Translation(Vector(c)) @ Matrix.Diagonal((rx, rx, rz, 1)))
        mesh = bpy.data.meshes.new('fuse')
        raw.to_mesh(mesh)
        raw.free()
        ob = bpy.data.objects.new('fuse', mesh)
        bpy.context.scene.collection.objects.link(ob)
        remesh = ob.modifiers.new('fuse', 'REMESH')
        remesh.mode, remesh.voxel_size, remesh.use_smooth_shade = 'VOXEL', voxel, True
        skin = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        ob.modifiers.clear()
        ob.data = skin
        if rough:  # big soft swells, so the outline is not a sum of circles
            off = Vector((self.rng.uniform(0, 50), self.rng.uniform(0, 50), self.rng.uniform(0, 50)))
            for v in skin.vertices:
                v.co += v.normal * noise.noise(v.co * 2.2 + off) * rough + v.normal * noise.noise(v.co * 5.5 + off) * rough * 0.4
        thin = ob.modifiers.new('thin', 'DECIMATE')
        thin.ratio = min(1.0, tris / max(1, sum(len(f.vertices) - 2 for f in skin.polygons)))
        out = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        bpy.data.objects.remove(ob)
        part = self._begin()
        part.from_mesh(out)
        for m in (mesh, skin, out):
            bpy.data.meshes.remove(m)
        if squash != 1.0:
            for v in part.verts:
                v.co.z *= squash
        return self._finish(part, col, (0, 0, 0), (0, 0, 0), 0.0, smooth, 0.0, tex, 2, head, ramp)

    # ---- finishing -----------------------------------------------------------
    def build(self, ao=0.6, reach=0.45):
        """Bake soft shading into the colours and hand back a Blender object."""
        bm = self.bm
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        bm.normal_update()
        verts = [v.co.copy() for v in bm.verts]
        polys = [[v.index for v in f.verts] for f in bm.faces]
        if self.ground:
            n = len(verts)
            verts += [Vector((-9, -9, -0.002)), Vector((9, -9, -0.002)), Vector((9, 9, -0.002)), Vector((-9, 9, -0.002))]
            polys.append([n, n + 1, n + 2, n + 3])
        tree = BVHTree.FromPolygons(verts, polys, all_triangles=False)
        rng = random.Random(11)
        dirs = []
        while len(dirs) < 40:
            d = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
            if 0.05 < d.length <= 1:
                dirs.append(d.normalized())
        # Faces nobody can ever see are not worth sending to a phone: the back of a stone bedded
        # in mortar, the top of a core under its planks, the underside of anything standing on
        # the floor. A face is buried if every way out of it is blocked almost at once.
        buried = []
        for f in bm.faces:
            starts = [f.calc_center_median()] + [v.co.lerp(f.calc_center_median(), 0.2) for v in f.verts]
            if all(tree.ray_cast(q + f.normal * 0.003, d, 0.07)[0] is not None for q in starts for d in dirs if d.dot(f.normal) > 0.15):
                buried.append(f)
        self.buried = len(buried)
        bmesh.ops.delete(bm, geom=buried, context='FACES')
        bm.verts.ensure_lookup_table()
        bm.faces.ensure_lookup_table()
        cache = {}
        head_layer = bm.verts.layers.int['head']
        # Painted like a miniature: a dark wash settles in the creases and a lighter, warmer
        # drybrush catches the raised edges. How raised or sunken a corner is follows from
        # whether its neighbours lie below or above the surface there.
        bm.normal_update()
        relief = {}
        for v in bm.verts:
            s = n_ = 0
            for e in v.link_edges:
                d = e.other_vert(v).co - v.co
                if d.length > 1e-6:
                    s += v.normal.dot(d.normalized())
                    n_ += 1
            relief[v.index] = s / n_ if n_ else 0.0
        for f in bm.faces:
            centre = f.calc_center_median()
            for l in f.loops:
                n = l.vert.normal if f.smooth else f.normal
                key = (l.vert.index, round(n.x, 2), round(n.y, 2), round(n.z, 2))
                k = cache.get(key)
                if k is None:
                    # Start a little inside the face so neighbouring faces of the same corner do not count.
                    p = l.vert.co.lerp(centre, 0.12) + n * 0.006
                    hit = tot = 0.0
                    for d in dirs:
                        w = d.dot(n)
                        if w <= 0.08:
                            continue
                        tot += w
                        loc, _, _, dist = tree.ray_cast(p, d, reach)
                        if loc is not None:
                            hit += w * (1 - dist / reach) ** 0.5
                    k = 1 - ao * (hit / tot if tot else 0)
                    cache[key] = k
                if l.vert[head_layer]:
                    k = 1 - (1 - k) * 0.3  # leaves shade as a mass (see below), so only a hint of occlusion
                c = l[self.col]
                r = relief[l.vert.index]
                edge, crease = min(1.0, max(0.0, -r * 2.4)), min(1.0, max(0.0, r * 2.4))
                if l.vert[head_layer] or abs(c[3] - 0.875) < 0.01:  # leaves and flame take no wash
                    edge = crease = 0.0
                k *= (1 + 0.3 * edge) * (1 - 0.34 * crease)
                lift = 0.07 * edge  # the drybrush is a paler, warmer paint, not just the same one brighter
                l[self.col] = (c[0] * k + lift, c[1] * k + lift * 0.94, c[2] * k + lift * 0.8, c[3])
        mesh = bpy.data.meshes.new(self.name)
        heads = [v[bm.verts.layers.int['head']] for v in bm.verts]
        bm.to_mesh(mesh)
        bm.free()
        # The exporter writes the *active* colour attribute.
        attr = mesh.color_attributes[COL]
        mesh.color_attributes.active_color = attr
        mesh.color_attributes.render_color_index = list(mesh.color_attributes).index(attr)
        try:
            mesh.set_sharp_from_angle(angle=math.radians(42))
        except AttributeError:
            pass
        if any(heads):
            # One light for the whole head of leaves: normals radiate from a point low in the
            # crown and lean toward the sky, so the mass shades from a dark underside to a bright
            # top with no highlight on any single lump of it.
            boxes = {}
            for v, h in zip(mesh.vertices, heads):
                if h:
                    lo, hi = boxes.setdefault(h, (v.co.copy(), v.co.copy()))
                    for i in range(3):
                        lo[i], hi[i] = min(lo[i], v.co[i]), max(hi[i], v.co[i])
            normals = [n.vector.copy() for n in mesh.corner_normals]
            up = Vector((0, 0, 1))
            for i, loop in enumerate(mesh.loops):
                h = heads[loop.vertex_index]
                if not h:
                    continue
                lo, hi = boxes[h]
                c = (lo + hi) / 2
                c.z -= (hi.z - lo.z) * 0.3
                d = mesh.vertices[loop.vertex_index].co - c
                n = Vector((d.x / max(hi.x - lo.x, 0.1) ** 2, d.y / max(hi.y - lo.y, 0.1) ** 2, d.z / max(hi.z - lo.z, 0.1) ** 2))
                normals[i] = (n.normalized() if n.length > 1e-6 else up).lerp(up, 0.3).normalized()
            mesh.normals_split_custom_set(normals)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj
