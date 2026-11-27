# Pictures of the pieces for the library:
#   blender -b --factory-startup -P assets/blender/thumbs.py -- <set> <out.webp> <out.json>
# One square per family (its first member), all on one transparent sheet. The json says which
# square is whose: {"size": px, "cols": n, "at": {family: index}}.
import importlib
import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[sys.argv.index('--') + 1:]
pieces = importlib.import_module(f'pieces_{args[0]}').PIECES
out, index = os.path.abspath(args[1]), os.path.abspath(args[2])
SIZE, COLS = 112, 12

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = SIZE
sc.render.film_transparent = True
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w')
sc.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.85, 1, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.85
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 3.2
sun.data.color = (1, 0.96, 0.88)
sun.rotation_euler = (0.85, 0.1, 0.6)
sc.collection.objects.link(sun)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
sc.collection.objects.link(cam)
sc.camera = cam
paint = bpy.data.materials.new('paint')
paint.use_nodes = True
bsdf = next(n for n in paint.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
vc = paint.node_tree.nodes.new('ShaderNodeVertexColor')
vc.layer_name = 'Color'
paint.node_tree.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.85

tmp = os.path.join(tempfile.mkdtemp(), 'shot.png')
names = sorted(n for n in pieces if n.endswith('~0') and not n.startswith('g_'))
rows = math.ceil(len(names) / COLS)
sheet = np.zeros((rows * SIZE, COLS * SIZE, 4), dtype=np.float32)
at = {}
look = Vector((0.62, -1, 0.62)).normalized()  # from the front, a little to one side and above
for i, name in enumerate(names):
    o = pieces[name]().build()
    o.data.materials.append(paint)
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector([min(p[k] for p in pts) for k in range(3)])
    hi = Vector([max(p[k] for p in pts) for k in range(3)])
    centre = (lo + hi) / 2
    cam.location = centre + look * 20
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    # Fit what the camera sees of it: the widest reach of any vertex from the middle of the view.
    inv = cam.matrix_world.inverted()
    reach = max(max(abs((inv @ p).x), abs((inv @ p).y)) for p in pts)
    cam.data.ortho_scale = reach * 2.12
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(SIZE, SIZE, 4)
    bpy.data.images.remove(img)
    r, c = divmod(i, COLS)
    sheet[(rows - 1 - r) * SIZE:(rows - r) * SIZE, c * SIZE:(c + 1) * SIZE] = px
    at[name.split('~')[0]] = i
    bpy.data.objects.remove(o)
    print('THUMB', name)

img = bpy.data.images.new('thumbs', COLS * SIZE, rows * SIZE, alpha=True)
img.pixels = sheet.ravel().tolist()
img.filepath_raw = out
img.file_format = 'WEBP'
sc.render.image_settings.quality = 82
img.save()
json.dump({'size': SIZE, 'cols': COLS, 'rows': rows, 'at': at}, open(index, 'w'), separators=(',', ':'))
print('SHEET', out, len(names))
