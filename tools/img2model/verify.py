# blender -b --python tools/img2model/verify.py -- '{"glb": "...", "triangleBudget": 12000?}'
# Re-imports a rigged GLB and reports triangles, bounds, joints, weight sanity, and a pose (bake) test.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import bpy
from common import emit, parse_params
import rig


def run(p):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=p['glb'])
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    rep = {'meshes': len([m for m in meshes if m.vertex_groups]), 'armatures': len(arms)}
    if not meshes or not arms:
        return rep
    meshes.sort(key=lambda o: -len(o.data.vertices))  # the importer may add bone-shape helper meshes
    mo, ao = meshes[0], arms[0]
    me = mo.data; me.calc_loop_triangles()
    co = np.array([v.co[:] for v in me.vertices])
    rep['triangles'] = len(me.loop_triangles); rep['vertices'] = len(me.vertices)
    rep['boundsMin'] = [float(x) for x in co.min(0)]; rep['boundsMax'] = [float(x) for x in co.max(0)]
    rep['size'] = [float(x) for x in (co.max(0) - co.min(0))]
    names = [b.name for b in ao.data.bones]
    rep['joints'] = len(names); rep['boneNames'] = names
    W = rig.read_weights(mo, names)
    s = W.sum(axis=1)
    rep['unweightedVertices'] = int((s <= 1e-6).sum())
    rep['maxWeightSumError'] = float(np.abs(s - 1).max())
    rep['maxInfluences'] = int((W > 1e-6).sum(axis=1).max())
    rep['bonesWithoutWeights'] = [names[j] for j in range(len(names)) if W[:, j].max() <= 1e-4]
    rep['hasMaterialTexture'] = any(n.type == 'TEX_IMAGE' and n.image for m in me.materials if m and m.node_tree for n in m.node_tree.nodes)
    rep['hasUV'] = len(me.uv_layers) > 0
    tests = [t for t in [('LeftArm', 'X', 50), ('LeftUpLeg', 'X', 35), ('Tail3', 'X', 30), ('Head', 'Z', 25)] if t[0] in names]
    rep['poseTest'] = rig.pose_test(ao, mo, tests)
    return rep


if __name__ == '__main__':
    emit({'ok': True, 'report': run(parse_params())})
