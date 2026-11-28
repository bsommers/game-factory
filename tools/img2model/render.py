# Headless Workbench renders (no GPU needed): front / side / three-quarter / back, plus skeleton-in-xray views.
import os, math
import bpy
from mathutils import Vector


def _cam(scene, pos, target, scale):
    cd = bpy.data.cameras.new('cam'); cd.type = 'ORTHO'; cd.ortho_scale = scale
    co = bpy.data.objects.new('cam', cd); scene.collection.objects.link(co)
    co.location = Vector(pos)
    d = Vector(target) - Vector(pos)
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = co
    return co


def _setup(scene, w, h):
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = w; scene.render.resolution_y = h
    scene.render.image_settings.file_format = 'PNG'
    sh = scene.display.shading
    sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_object_outline = False
    scene.world = scene.world or bpy.data.worlds.new('w')
    scene.world.color = (0.62, 0.62, 0.66)


def render_all(out, name, mesh, arm, B, h, size=(640, 780)):
    scene = bpy.context.scene
    _setup(scene, *size)
    c = (0, 0, h * 0.5); scale = h * 1.25
    views = {'front': (0, -4, h * 0.5), 'side': (4, 0, h * 0.5), 'threeq': (2.6, -2.6, h * 0.62), 'back': (0, 4, h * 0.5)}
    shots = []
    arm.hide_render = True
    for vn, pos in views.items():
        cam = _cam(scene, pos, c, scale)
        scene.render.filepath = os.path.join(out, f'{name}_view_{vn}.png'); bpy.ops.render.render(write_still=True); shots.append(scene.render.filepath)
        bpy.data.objects.remove(cam)
    # skeleton as bevelled curves, mesh in light xray
    bones = []
    for b in B:
        cu = bpy.data.curves.new('b', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 0.006 * h
        sp = cu.splines.new('POLY'); sp.points.add(1)
        sp.points[0].co = (*b['head'], 1); sp.points[1].co = (*b['tail'], 1)
        ob = bpy.data.objects.new('b_' + b['name'], cu); scene.collection.objects.link(ob)
        n = b['name']
        ob.color = (1, 0.1, 0.8, 1) if n.startswith('Tail') else (0.1, 0.4, 1, 1) if n.startswith('Left') else (0.1, 0.8, 0.2, 1) if n.startswith('Right') else (1, 0.9, 0, 1)
        bones.append(ob)
    mesh.color = (0.85, 0.85, 0.85, 1)
    sh = scene.display.shading; sh.color_type = 'OBJECT'; sh.show_xray = True; sh.xray_alpha = 0.35
    for vn in ('front', 'side'):
        cam = _cam(scene, views[vn], c, scale)
        scene.render.filepath = os.path.join(out, f'{name}_skeleton_{vn}.png'); bpy.ops.render.render(write_still=True); shots.append(scene.render.filepath)
        bpy.data.objects.remove(cam)
    for ob in bones: bpy.data.objects.remove(ob)
    arm.hide_render = False
    sh.show_xray = False; sh.color_type = 'TEXTURE'
    return shots
