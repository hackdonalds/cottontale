# Build the kit:  blender -b --factory-startup -P assets/blender/build.py -- <set> <out dir> [sheet.png]
#   <set>      name of a pieces_<set>.py module next to this file
#   <out dir>  gets one <pack>.glb per pack (see packs.py): one node per piece, named with its
#              catalogue id, colour in the vertices
#   sheet.png  optional contact sheet, for judging the look without starting the app
import importlib
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[sys.argv.index('--') + 1:]
pack, out = args[0], os.path.abspath(args[1])
sheet = os.path.abspath(args[2]) if len(args) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
pieces = importlib.import_module(f'pieces_{pack}').PIECES
objs = []
painted = {}  # figures bring a painted square each; a pack's squares are tiled into one sheet
for name, make in pieces.items():
    piece = make()
    o = piece.build()
    if hasattr(piece, 'image'):
        painted[o.name] = piece.image
    objs.append(o)
    tris = sum(len(f.vertices) - 2 for f in o.data.polygons)
    print(f'PIECE {name} tris={tris}')

# One file per pack, written next to each other, plus a list of what went where.
from packs import pack_of  # noqa: E402
os.makedirs(out, exist_ok=True)
manifest = {}
for o in objs:
    manifest.setdefault(pack_of(o.name.split('~')[0]), []).append(o)
for name, members in manifest.items():
    figs = [o for o in members if o.name in painted]
    if figs:
        import numpy as np
        n = math.ceil(math.sqrt(len(figs)))
        size = painted[figs[0].name].shape[0]
        sheet_px = np.zeros((n * size, n * size, 4))
        sheet_px[..., 3] = 1
        for i, o in enumerate(figs):
            cx, cy = i % n, i // n
            sheet_px[cy * size:(cy + 1) * size, cx * size:(cx + 1) * size] = painted[o.name]
            for l in o.data.uv_layers.active.data:  # move the figure's patch of the sheet to its square
                l.uv = ((l.uv[0] + cx) / n, (l.uv[1] + cy) / n)
        img = bpy.data.images.new(name, n * size, n * size)
        img.pixels = sheet_px.ravel().tolist()
        img.filepath_raw, img.file_format = os.path.join(out, f'{name}.png'), 'PNG'
        img.save()
        print(f'ATLAS {name} {n * size}')
    bpy.ops.object.select_all(action='DESELECT')
    for o in members:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out, f'{name}.glb'), export_format='GLB', export_yup=True, export_apply=True, use_selection=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
        export_texcoords=True, export_animations=False,
    )
    print(f'PACK {name} ' + ' '.join(sorted({o.name.split("~")[0] for o in members})))

if sheet:
    mat = bpy.data.materials.new('paint')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    nt.links.new(vc.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    cols = 10
    for i, o in enumerate(objs):
        o.data.materials.append(mat)
        o.location = ((i % cols) * 1.7, -(i // cols) * 2.0, 0)
        if o.name.startswith('b_'):  # blocks: top flush with the table
            o.location.z = -1  # blocks: top flush with the table
    rows = (len(objs) + cols - 1) // cols
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, -0.001))
    g = bpy.data.materials.new('ground')
    g.use_nodes = True
    next(n for n in g.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].default_value = (0.09, 0.12, 0.19, 1)
    bpy.context.object.data.materials.append(g)
    bpy.ops.object.light_add(type='SUN', rotation=(0.85, 0.1, 0.5))
    bpy.context.object.data.energy = 3.4
    bpy.context.object.data.color = (1, 0.95, 0.86)
    bpy.context.object.data.angle = 0.2
    sc = bpy.context.scene
    w = bpy.data.worlds.new('w')
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.82, 1, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.75
    cam = bpy.data.cameras.new('c')
    cam.type = 'ORTHO'
    cam.ortho_scale = cols * 1.7 + 0.6
    co = bpy.data.objects.new('c', cam)
    sc.collection.objects.link(co)
    centre = Vector(((cols - 1) * 0.85, -(rows - 1) * 1.0 + 0.2, 0.45))
    co.location = centre + Vector((6, -11, 10))
    co.rotation_euler = (centre - co.location).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.resolution_x = 1800
    sc.render.resolution_y = int(1800 * (rows * 1.45 + 0.6) / (cols * 1.7 + 0.6))
    sc.render.filepath = sheet
    try:
        sc.view_settings.view_transform = 'Standard'
    except TypeError:
        pass
    bpy.ops.render.render(write_still=True)
    print('SHEET', sheet)
