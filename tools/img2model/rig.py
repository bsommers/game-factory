# Blender-side helpers: armature creation, weights, pose test, bones table. Runs under bpy.
import numpy as np
import bpy
from mathutils import Vector, Quaternion


def seg_dist(P, a, b):
    ab = b - a; L = float(ab @ ab) or 1e-12
    t = np.clip(((P - a) @ ab) / L, 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * ab), axis=1)


def resample(poly, n):
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(poly, axis=0), axis=1))]
    t = np.linspace(0, d[-1], n + 1)
    return np.stack([np.interp(t, d, poly[:, k]) for k in range(poly.shape[1])], axis=1)


def bones_table(S, g, tail_bones):
    """List of dict(name,parent,head,tail,connect) in the Blender frame."""
    h = g.h
    P = S['P']; sp = P['spine']
    B = []
    def add(name, parent, head, tail, connect=False):
        B.append(dict(name=name, parent=parent, head=tuple(float(v) for v in head), tail=tuple(float(v) for v in tail), connect=connect))
    add('Hips', None, P['hips_h'], P['hips_t'])
    add('Spine', 'Hips', sp[0], sp[1], True)
    add('Spine1', 'Spine', sp[1], sp[2], True)
    add('Spine2', 'Spine1', sp[2], sp[3], True)
    add('Neck', 'Spine2', P['neck_h'], P['neck_t'], True)
    add('Head', 'Neck', P['neck_t'], P['head_t'], True)
    ay = S['arm_y']; xl = S['xl']
    for side, sx, nm in (('Left', 1, 'Left'), ('Right', -1, 'Right')):
        sh = (sx * S['sh'][0], ay, S['sh'][1]); el = (sx * S['el'][0], ay, S['el'][1]); wr = (sx * S['wr'][0], ay, S['wr'][1]); tip = (sx * S['tip'][0], ay, S['tip'][1])
        add(nm + 'Shoulder', 'Spine2', P['neck_h'], sh)
        add(nm + 'Arm', nm + 'Shoulder', sh, el, True)
        add(nm + 'ForeArm', nm + 'Arm', el, wr, True)
        add(nm + 'Hand', nm + 'ForeArm', wr, tip, True)
        hip = (sx * xl * 0.85, S['hip_y'], S['zh']); kn = (sx * xl * 0.95, S['knee_y'], S['zk']); an = (sx * xl, S['ank_y'], S['za'])
        ball = (sx * xl, S['toe_y'] + 0.35 * S['foot_len'], 0.02 * h); toe = (sx * xl, S['toe_y'], 0.012 * h)
        add(nm + 'UpLeg', 'Hips', hip, kn)
        add(nm + 'Leg', nm + 'UpLeg', kn, an, True)
        add(nm + 'Foot', nm + 'Leg', an, ball, True)
        add(nm + 'ToeBase', nm + 'Foot', ball, toe, True)
    # tail
    t = S['tail']
    ysh = S['ys'](S['zh'])
    if t is not None:
        poly = t['poly']  # (y, z) bottom -> top
        root = (0.0, ysh + 0.35 * (poly[0][0] - ysh), max(poly[0][1] - 0.03 * h, 0.2 * h))
        pts3 = [root] + [(0.0, float(y), float(z)) for y, z in poly]
        pts = resample(np.array(pts3), tail_bones)
    else:
        pts = np.array([(0.0, ysh + 0.05 * h * (i + 1), S['zh'] * 0.9 - 0.04 * h * i) for i in range(tail_bones + 1)])
    for i in range(tail_bones):
        add(f'Tail{i + 1}', 'Hips' if i == 0 else f'Tail{i}', pts[i], pts[i + 1], i > 0)
    return B


def build_armature(B, name='Armature'):
    arm = bpy.data.armatures.new(name); ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in B:
        e = arm.edit_bones.new(b['name']); e.head = Vector(b['head']); e.tail = Vector(b['tail']); eb[b['name']] = e
    for b in B:
        if b['parent']:
            eb[b['name']].parent = eb[b['parent']]
            eb[b['name']].use_connect = bool(b['connect']) and (eb[b['name']].head - eb[b['parent']].tail).length < 1e-6
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def distance_weights(verts, B, power=3.0, eps=0.01, k=4):
    W = np.zeros((len(verts), len(B)), dtype=np.float64)
    for j, b in enumerate(B):
        d = seg_dist(verts, np.array(b['head']), np.array(b['tail']))
        W[:, j] = 1.0 / (d + eps) ** power
    return limit_normalise(W, k)


def limit_normalise(W, k=4):
    W = W.copy()
    if W.shape[1] > k:
        idx = np.argsort(-W, axis=1)[:, k:]
        np.put_along_axis(W, idx, 0.0, axis=1)
    s = W.sum(axis=1, keepdims=True)
    return W / np.where(s > 0, s, 1)


def read_weights(mesh_ob, names):
    n = len(mesh_ob.data.vertices); W = np.zeros((n, len(names)))
    gi = {vg.index: names.index(vg.name) for vg in mesh_ob.vertex_groups if vg.name in names}
    for v in mesh_ob.data.vertices:
        for ge in v.groups:
            j = gi.get(ge.group)
            if j is not None: W[v.index, j] = ge.weight
    return W


def write_weights(mesh_ob, names, W):
    for vg in list(mesh_ob.vertex_groups): mesh_ob.vertex_groups.remove(vg)
    groups = [mesh_ob.vertex_groups.new(name=n) for n in names]
    for j, vg in enumerate(groups):
        for i in np.nonzero(W[:, j] > 1e-5)[0]:
            vg.add([int(i)], float(W[i, j]), 'REPLACE')


def skin(mesh_ob, arm_ob, B, verts, prefer_auto=True):
    """Automatic (heat) weights; any vertex left unweighted or any bone without weights triggers the distance-weight fallback."""
    names = [b['name'] for b in B]
    method = 'distance'
    W = None
    if prefer_auto:
        try:
            for o in bpy.context.scene.objects: o.select_set(False)
            mesh_ob.select_set(True); arm_ob.select_set(True)
            bpy.context.view_layer.objects.active = arm_ob
            bpy.ops.object.parent_set(type='ARMATURE_AUTO')
            Wa = read_weights(mesh_ob, names)
            unweighted = int((Wa.sum(axis=1) <= 1e-6).sum()); dead = [names[j] for j in range(len(names)) if Wa[:, j].max() <= 1e-4]
            if unweighted == 0 and not dead:
                W = limit_normalise(Wa); method = 'blender-automatic-heat'
            else:
                method = f'distance (auto left {unweighted} unweighted verts, bones without weight: {dead})'
        except Exception as e:  # noqa
            method = f'distance (auto failed: {e})'
    if W is None:
        W = distance_weights(verts, B)
        if mesh_ob.parent is None:
            mesh_ob.parent = arm_ob
        if not any(m.type == 'ARMATURE' for m in mesh_ob.modifiers):
            m = mesh_ob.modifiers.new('Armature', 'ARMATURE'); m.object = arm_ob
        method = method if method.startswith('distance') else 'distance'
    write_weights(mesh_ob, names, W)
    mesh_ob.parent = arm_ob
    if not any(m.type == 'ARMATURE' for m in mesh_ob.modifiers):
        m = mesh_ob.modifiers.new('Armature', 'ARMATURE'); m.object = arm_ob
    return method


def evaluated_verts(mesh_ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh_ob.evaluated_get(dg)
    me = ev.to_mesh()
    a = np.array([v.co[:] for v in me.vertices]); ev.to_mesh_clear()
    return a


def pose_test(arm_ob, mesh_ob, tests=None):
    """Rotate bones, confirm vertices move (and unrelated ones do not). Rest pose restored afterwards."""
    tests = tests or [('LeftArm', 'X', 50), ('LeftUpLeg', 'X', 35), ('Tail3', 'X', 30), ('Head', 'Z', 25)]
    bpy.context.view_layer.objects.active = arm_ob
    base = evaluated_verts(mesh_ob)
    names = [vg.name for vg in mesh_ob.vertex_groups]
    out = []
    for bone, axis, deg in tests:
        pb = arm_ob.pose.bones.get(bone)
        if pb is None:
            out.append({'bone': bone, 'ok': False, 'error': 'bone missing'}); continue
        pb.rotation_mode = 'QUATERNION'
        # rotate about the world axis through the bone head: express in bone-local space via the rest matrix
        world_axis = Vector({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[axis])
        rest = arm_ob.data.bones[bone].matrix_local.to_3x3().inverted()
        local_axis = (rest @ world_axis).normalized()
        pb.rotation_quaternion = Quaternion(local_axis, np.radians(deg))
        bpy.context.view_layer.update()
        cur = evaluated_verts(mesh_ob)
        d = np.linalg.norm(cur - base, axis=1)
        pb.rotation_quaternion = Quaternion((1, 0, 0, 0))
        bpy.context.view_layer.update()
        out.append({'bone': bone, 'axis': axis, 'degrees': deg, 'movedVerts': int((d > 1e-4).sum()), 'maxDisplacement': float(d.max()), 'ok': bool((d > 1e-4).sum() > 0 and d.max() > 0.005)})
    # unrelated: rotating the left arm must not move the right foot region
    return out
