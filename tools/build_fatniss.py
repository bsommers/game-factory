# EXAMPLE: procedural Blender character -> rigged, animated glb (Bevy/Godot ready), fully deterministic, no sculpting or downloads.
# Pattern: lin() palette, primitive/bmesh body parts with vertex colours, armature with bone weights, actions Idle/Run/Shoot,
# glTF export (Blender Z-up -> glTF Y-up facing +Z), then `--verify` re-imports the glb and renders preview PNGs.
# Copy and rename for a new character; keep the verify step. Original: Fatniss Colberdeen (archer cat) in Cheesemageddon.
# Fatniss Colberdeen - procedural Blender builder.
#   build:   /snap/bin/blender --background --python tools/build_fatniss.py
#   verify:  /snap/bin/blender --background --python tools/build_fatniss.py -- --verify
# Writes assets/models/fatniss_colberdeen.glb (skinned, 3 actions: Idle, Run, Shoot) and, in verify mode,
# re-imports the glb, checks actions/tri count and renders previews into assets/models/fatniss_preview/.
# Blender is Z-up, the cat faces -Y; glTF export converts to Y-up facing +Z. Fully deterministic.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
GLB = os.path.join(ROOT, 'assets', 'models', 'fatniss_colberdeen.glb')
PREV = os.path.join(ROOT, 'assets', 'models', 'fatniss_preview')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
FPS = 30
FOOT_Y = -0.06  # shift so the origin is the centre of the four feet


# ------------------------------------------------------------------ colour helpers
def lin(r, g, b):
    f = lambda c: ((c / 255 + 0.055) / 1.055) ** 2.4 if c / 255 > 0.04045 else c / 255 / 12.92
    return (f(r), f(g), f(b))


ORANGE = lin(222, 128, 44)
ORANGE_D = lin(168, 78, 20)
ORANGE_L = lin(240, 168, 82)
WHITE = lin(244, 236, 224)
PINK = lin(232, 148, 150)
EYE = lin(86, 176, 58)
BLACK = lin(10, 10, 10)
JACKET = lin(62, 76, 46)
JACKET_D = lin(40, 52, 32)
STRAP = lin(34, 30, 26)
METAL = lin(176, 176, 170)
WOOD = lin(112, 70, 38)
WOOD_D = lin(78, 48, 26)
LEATHER = lin(86, 54, 34)
SHAFT = lin(206, 176, 124)
FEATHER_R = lin(190, 52, 44)
FEATHER_W = lin(236, 234, 224)
STRING = lin(224, 214, 190)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def sstep(x, a, b):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def hash3(x, y, z):
    s = math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
    return s - math.floor(s)


def vnoise(x, y, z, f):
    return 0.5 + 0.5 * math.sin(x * f * 1.3 + math.sin(y * f * 0.9) * 2.0) * math.sin(z * f * 1.1 + math.sin(x * f * 0.7) * 2.0)


def fur(co, white=None, stripes=1.0):
    x, y, z = co
    t = math.sin(y * 70 + math.sin(z * 26 + x * 11) * 1.7 + 0.6 * math.sin(y * 19))
    s = sstep(t, 0.30, 0.80) * stripes
    s *= sstep(z, 0.17, 0.26)  # fade towards belly
    c = mix(ORANGE, ORANGE_D, s * 1.0)
    c = mix(c, ORANGE_L, (vnoise(x, y, z, 55) - 0.5) * 0.5 + 0.12)
    n = (hash3(round(x * 400), round(y * 400), round(z * 400)) - 0.5) * 0.16
    c = tuple(max(0.0, v * (1 + n)) for v in c)
    if white:
        w = white(co)
        c = mix(c, tuple(v * (0.96 + 0.08 * hash3(x * 900, y * 900, z * 900)) for v in WHITE), w)
    return c


def flat(col, noise=0.06):
    def f(co):
        n = (hash3(round(co[0] * 300), round(co[1] * 300), round(co[2] * 300)) - 0.5) * noise
        return tuple(max(0.0, v * (1 + n)) for v in col)
    return f


def cloth(co):
    x, y, z = co
    c = mix(JACKET, JACKET_D, vnoise(x, y, z, 70) * 0.5 + sstep(math.sin(y * 150) * math.sin(x * 150), 0.2, 1) * 0.15)
    n = (hash3(round(x * 500), round(y * 500), round(z * 500)) - 0.5) * 0.12
    return tuple(max(0.0, v * (1 + n)) for v in c)


# ------------------------------------------------------------------ mesh helpers
def ellipsoid(bm, c, r, rot=(0, 0, 0), u=20, v=14):
    g = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    m = Matrix.Translation(Vector(c)) @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal((r[0], r[1], r[2], 1))
    bmesh.ops.transform(bm, matrix=m, verts=g['verts'])


def ellipsoid_along(bm, a, b, thick, width, u=10, v=8):
    a, b = Vector(a), Vector(b)
    d = b - a
    q = d.normalized().to_track_quat('Z', 'Y')
    g = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=1.0)
    m = Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((thick, width, d.length / 2, 1))
    bmesh.ops.transform(bm, matrix=m, verts=g['verts'])


def cone(bm, base, direction, r1, r2, length, flatten=1.0, seg=12):
    g = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=length)
    d = Vector(direction).normalized()
    q = d.to_track_quat('Z', 'Y')
    m = Matrix.Translation(Vector(base) + d * length / 2) @ q.to_matrix().to_4x4() @ Matrix.Diagonal((1, flatten, 1, 1))
    bmesh.ops.transform(bm, matrix=m, verts=g['verts'])


def bridge(bm, rings, closed=True, caps=True):
    """rings: list of equal-length vertex-position lists. Faces between consecutive rings."""
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(vr[0])
    last = n if closed else n - 1
    for i in range(len(vr) - 1):
        for j in range(last):
            k = (j + 1) % n
            try:
                bm.faces.new((vr[i][j], vr[i][k], vr[i + 1][k], vr[i + 1][j]))
            except ValueError:
                pass
    if caps and closed:
        for ring in (vr[0], vr[-1]):
            cen = sum((v.co for v in ring), Vector()) / len(ring)
            cv = bm.verts.new(cen)
            for j in range(n):
                try:
                    bm.faces.new((ring[j], ring[(j + 1) % n], cv))
                except ValueError:
                    pass
    return vr


def ring_y(y, zc, rx, rz, n=28, a0=None, a1=None, xc=0.0):
    pts = []
    if a0 is None:
        for j in range(n):
            t = 2 * math.pi * j / n
            pts.append(Vector((xc + rx * math.sin(t), y, zc + rz * math.cos(t))))
    else:
        for j in range(n + 1):
            t = a0 + (a1 - a0) * j / n
            pts.append(Vector((xc + rx * math.sin(t), y, zc + rz * math.cos(t))))
    return pts


def tube(bm, pts, radii, sides=10, scale=(1, 1), caps=True):
    pts = [Vector(p) for p in pts]
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        t.normalize()
        if prev_n is None:
            ref = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
            nn = t.cross(ref).normalized()
        else:
            nn = (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = nn
        bb = t.cross(nn).normalized()
        r = radii[i]
        rings.append([p + (nn * math.cos(2 * math.pi * j / sides) * scale[0] + bb * math.sin(2 * math.pi * j / sides) * scale[1]) * r
                      for j in range(sides)])
    bridge(bm, rings, True, caps)


def catmull(pts, n):
    out = []
    P = [pts[0]] + list(pts) + [pts[-1]]
    for i in range(1, len(P) - 2):
        for s in range(n):
            t = s / n
            a, b, c, d = Vector(P[i - 1]), Vector(P[i]), Vector(P[i + 1]), Vector(P[i + 2])
            out.append(0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3))
    out.append(Vector(pts[-1]))
    return out


# ------------------------------------------------------------------ rig
BONES = {}  # name -> (head, tail, parent)


def B(name, head, tail, parent=None):
    BONES[name] = (Vector(head), Vector(tail), parent)


def define_bones():
    B('Root', (0, 0.06, 0.0), (0, 0.06, 0.10))
    B('Spine1', (0, 0.24, 0.29), (0, 0.12, 0.30), 'Root')
    B('Spine2', (0, 0.12, 0.30), (0, 0.0, 0.30), 'Spine1')
    B('Spine3', (0, 0.0, 0.30), (0, -0.12, 0.31), 'Spine2')
    B('Neck', (0, -0.12, 0.31), (0, -0.17, 0.38), 'Spine3')
    B('Head', (0, -0.17, 0.38), (0, -0.28, 0.40), 'Neck')
    for s, n in ((1, 'L'), (-1, 'R')):
        B(f'Front{n}_Upper', (s * 0.075, -0.06, 0.27), (s * 0.075, -0.045, 0.14), 'Spine3')
        B(f'Front{n}_Lower', (s * 0.075, -0.045, 0.14), (s * 0.075, -0.07, 0.02), f'Front{n}_Upper')
        B(f'Hind{n}_Upper', (s * 0.09, 0.18, 0.27), (s * 0.09, 0.21, 0.13), 'Spine1')
        B(f'Hind{n}_Lower', (s * 0.09, 0.21, 0.13), (s * 0.09, 0.18, 0.02), f'Hind{n}_Upper')
    B('Tail1', (0, 0.23, 0.30), (0, 0.29, 0.33), 'Spine1')
    B('Tail2', (0, 0.29, 0.33), (0, 0.33, 0.38), 'Tail1')
    B('Tail3', (0, 0.33, 0.38), (0, 0.33, 0.46), 'Tail2')
    B('Braid1', (0.05, -0.17, 0.36), (0.06, -0.145, 0.30), 'Neck')
    B('Braid2', (0.06, -0.145, 0.30), (0.065, -0.125, 0.245), 'Braid1')
    B('Braid3', (0.065, -0.125, 0.245), (0.065, -0.115, 0.185), 'Braid2')
    B('Bow', (0.16, 0.05, 0.30), (0.16, 0.05, 0.34), 'Spine3')
    B('String', (0.185, 0.05, 0.30), (0.185, 0.05, 0.34), 'Bow')


def build_armature():
    arm = bpy.data.armatures.new('FatnissRig')
    rig = bpy.data.objects.new('Fatniss_Rig', arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n, (h, t, p) in BONES.items():
        b = arm.edit_bones.new(n)
        b.head, b.tail = h, t
        eb[n] = b
    for n, (h, t, p) in BONES.items():
        if p:
            eb[n].parent = eb[p]
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def seg_dist(co, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (co - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (co - (a + ab * t)).length


def soft(names, power=3.0, top=3):
    def f(co):
        c = Vector(co)
        ws = []
        for n in names:
            h, t, _ = BONES[n]
            ws.append((1.0 / (seg_dist(c, h, t) + 0.012) ** power, n))
        ws.sort(reverse=True)
        ws = ws[:top]
        s = sum(w for w, _ in ws)
        return {n: w / s for w, n in ws}
    return f


def rigid(name):
    return lambda co: {name: 1.0}


# ------------------------------------------------------------------ materials
MATS = {}


def material(name, rough=0.8, metal=0.0, coat=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    col = nt.nodes.new('ShaderNodeVertexColor')
    col.layer_name = 'Col'
    nt.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    MATS[name] = m
    return m


# ------------------------------------------------------------------ parts
PARTS = []


class Part:
    def __init__(self, group, name, mat, colfn, wfn, sub=0):
        self.group, self.name, self.mat, self.colfn, self.wfn, self.sub = group, name, mat, colfn, wfn, sub
        self.bm = bmesh.new()


def part(group, name, mat, colfn, wfn, sub=0):
    p = Part(group, name, mat, colfn, wfn, sub)
    PARTS.append(p)
    return p


def finalize(p):
    bm = p.bm
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(p.name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(p.name, me)
    bpy.context.collection.objects.link(ob)
    for poly in me.polygons:
        poly.use_smooth = True
    if p.sub:
        md = ob.modifiers.new('sub', 'SUBSURF')
        md.levels = p.sub
        md.render_levels = p.sub
        dg = bpy.context.evaluated_depsgraph_get()
        new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        ob.modifiers.remove(md)
        old = ob.data
        ob.data = new
        bpy.data.meshes.remove(old)
        for poly in ob.data.polygons:
            poly.use_smooth = True
    me = ob.data
    me.materials.append(p.mat)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    flatcol = []
    for v in me.vertices:
        flatcol.extend(p.colfn(tuple(v.co)) + (1.0,))
    ca.data.foreach_set('color', flatcol)
    for n in BONES:
        pass
    vgs = {}
    for v in me.vertices:
        for bn, w in p.wfn(tuple(v.co)).items():
            if w < 0.01:
                continue
            vg = vgs.get(bn) or ob.vertex_groups.new(name=bn)
            vgs[bn] = vg
            vg.add([v.index], w, 'REPLACE')
    return ob


# ------------------------------------------------------------------ the cat
def torso_white(co):
    x, y, z = co
    belly = sstep(0.235 - z, -0.02, 0.05) * sstep(0.13 - y, 0.0, 0.08)
    chest = sstep(-0.075 - y, 0.0, 0.05) * sstep(0.34 - z, 0.0, 0.07)
    return max(belly, chest)


def leg_white(co):
    return sstep(0.075 - co[2], -0.02, 0.03)


def make_body():
    # torso loft (chubby): chest -> neck -> belly -> rump
    prof = [  # y, zc, rx, rz
        (-0.205, 0.372, 0.03, 0.035), (-0.17, 0.355, 0.055, 0.062), (-0.135, 0.325, 0.088, 0.105),
        (-0.085, 0.312, 0.118, 0.135), (0.0, 0.296, 0.130, 0.148), (0.09, 0.296, 0.126, 0.146),
        (0.17, 0.298, 0.122, 0.140), (0.225, 0.292, 0.092, 0.108), (0.255, 0.288, 0.04, 0.05)]
    p = part('body', 'torso', material('Fur', 0.92), lambda co: fur(co, torso_white),
             soft(['Spine1', 'Spine2', 'Spine3', 'Neck'], 3.0, 3), sub=1)
    bridge(p.bm, [ring_y(y, zc, rx, rz, 24) for (y, zc, rx, rz) in prof], True, True)

    # head (wide chubby face)
    def head_white(co):
        x, y, z = co
        muzzle = sstep(-0.245 - y, 0.0, 0.03) * sstep(0.425 - z, 0.0, 0.03)
        chin = sstep(0.385 - z, -0.01, 0.015) * sstep(-0.2 - y, 0, 0.04)
        blaze = sstep(0.02 - abs(x), 0, 0.02) * sstep(-0.22 - y, -0.01, 0.03) * sstep(z, 0.40, 0.43) * 0.0
        return max(muzzle, chin, blaze)

    def head_col(co):
        x, y, z = co
        c = fur(co, head_white, stripes=0.0)
        # forehead M tabby marks
        if z > 0.425 and y < -0.17:
            s = sstep(math.sin(x * 120 + 0.4), 0.3, 0.85) * sstep(z, 0.425, 0.445)
            c = mix(c, ORANGE_D, s * 0.8)
        return c

    h = part('body', 'head', material('Fur', 0.92), head_col, rigid('Head'), sub=1)
    ellipsoid(h.bm, (0, -0.205, 0.405), (0.098, 0.088, 0.082), u=26, v=18)
    for s in (1, -1):  # cheek fluff
        ellipsoid(h.bm, (s * 0.068, -0.235, 0.385), (0.04, 0.04, 0.036), u=14, v=10)
    # muzzle
    m = part('body', 'muzzle', material('Fur', 0.92), lambda co: fur(co, lambda c: 1.0), rigid('Head'), sub=1)
    ellipsoid(m.bm, (0, -0.268, 0.385), (0.05, 0.042, 0.034), u=18, v=12)
    for s in (1, -1):
        ellipsoid(m.bm, (s * 0.018, -0.278, 0.378), (0.024, 0.022, 0.02), u=12, v=8)
    # ears
    for s in (1, -1):
        e = part('body', f'ear{s}', material('Fur', 0.92), lambda co: fur(co, None, 0.3), rigid('Head'))
        cone(e.bm, (s * 0.06, -0.185, 0.455), (s * 0.25, 0.1, 1.0), 0.04, 0.007, 0.07, 0.42, 12)
        ei = part('body', f'earin{s}', material('Skin', 0.7), flat(PINK), rigid('Head'))
        cone(ei.bm, (s * 0.058, -0.2, 0.455), (s * 0.25, 0.1, 1.0), 0.028, 0.005, 0.055, 0.3, 10)
    # eyes
    for s in (1, -1):
        e = part('body', f'eye{s}', material('Eye', 0.08), flat(EYE, 0.02), rigid('Head'))
        ellipsoid(e.bm, (s * 0.043, -0.272, 0.418), (0.0185, 0.012, 0.019), u=14, v=10)
        pu = part('body', f'pupil{s}', material('Pupil', 0.05), flat(BLACK, 0), rigid('Head'))
        ellipsoid(pu.bm, (s * 0.043, -0.2825, 0.418), (0.0065, 0.004, 0.0155), u=10, v=8)
        lid = part('body', f'brow{s}', material('Fur', 0.92), lambda co: fur(co, None, 1.0), rigid('Head'))
        ellipsoid(lid.bm, (s * 0.043, -0.266, 0.436), (0.026, 0.016, 0.0085), (0, 0, 0), u=12, v=8)
    # nose, mouth
    n = part('body', 'nose', material('Skin', 0.45), flat(PINK), rigid('Head'))
    ellipsoid(n.bm, (0, -0.307, 0.392), (0.013, 0.009, 0.0095), u=12, v=8)
    mo = part('body', 'mouth', material('Pupil', 0.5), flat(lin(90, 40, 40), 0), rigid('Head'))
    for s in (1, -1):
        tube(mo.bm, [(0, -0.31, 0.384), (s * 0.006, -0.312, 0.372), (s * 0.02, -0.308, 0.367), (s * 0.034, -0.295, 0.368)],
             [0.0013] * 4, 4, caps=True)
    # whiskers
    w = part('body', 'whiskers', material('Whisker', 0.4), flat(WHITE, 0), rigid('Head'))
    for s in (1, -1):
        for i, (dz, dy) in enumerate(((0.012, 0.0), (0.0, 0.0), (-0.011, 0.0))):
            a = (-0.07 + 0.07 * i)
            base = Vector((s * 0.03, -0.29, 0.384 + dz))
            end = base + Vector((s * 0.115, -0.045 + 0.02 * i, dz * 3 + a * 0.5 + 0.0))
            mid = (base + end) / 2 + Vector((0, -0.004, 0.012))
            tube(w.bm, [base, mid, end], [0.0009, 0.0007, 0.0003], 4, caps=True)
    # legs
    def leg(name_n, upper, lower, pts, radii, paw_c, paw_r, front):
        lg = part('body', f'leg_{name_n}', material('Fur', 0.92), lambda co: fur(co, leg_white), soft([upper, lower], 5.0, 2), sub=1)
        tube(lg.bm, pts, radii, 10)
        pw = part('body', f'paw_{name_n}', material('Fur', 0.92), lambda co: fur(co, lambda c: 1.0), rigid(lower), sub=1)
        ellipsoid(pw.bm, paw_c, paw_r, u=14, v=10)

    for s, n in ((1, 'L'), (-1, 'R')):
        x = s * 0.075
        leg(f'F{n}', f'Front{n}_Upper', f'Front{n}_Lower',
            [(x, -0.06, 0.29), (x, -0.055, 0.21), (x, -0.048, 0.14), (x, -0.06, 0.07), (x, -0.07, 0.04)],
            [0.058, 0.046, 0.034, 0.03, 0.031], (x, -0.078, 0.021), (0.032, 0.048, 0.022), True)
        x = s * 0.09
        leg(f'H{n}', f'Hind{n}_Upper', f'Hind{n}_Lower',
            [(x, 0.17, 0.30), (x + s * 0.01, 0.19, 0.22), (x, 0.215, 0.13), (x, 0.19, 0.07), (x, 0.178, 0.04)],
            [0.085, 0.066, 0.036, 0.03, 0.03], (x, 0.168, 0.021), (0.03, 0.05, 0.022), False)
    # tail
    def tail_white(co):
        return sstep(co[2], 0.405, 0.435)
    tl = part('body', 'tail', material('Fur', 0.92), lambda co: fur(co, tail_white, 0.0) if False else tail_col(co), soft(['Tail1', 'Tail2', 'Tail3'], 3.0, 2), sub=1)
    pts = [(0, 0.225, 0.30), (0, 0.27, 0.315), (0, 0.315, 0.35), (0, 0.335, 0.40), (0, 0.33, 0.455), (0, 0.325, 0.47)]
    tube(tl.bm, pts, [0.05, 0.048, 0.05, 0.047, 0.036, 0.01], 12)


def tail_col(co):
    x, y, z = co
    c = fur(co, None, 0.0)
    # rings
    r = sstep(math.sin(z * 90 + y * 20), 0.4, 0.9) * 0.55 * sstep(z, 0.31, 0.34)
    c = mix(c, ORANGE_D, r)
    return mix(c, WHITE, sstep(z, 0.405, 0.43))


def make_braid():
    pts = catmull([(0.05, -0.17, 0.365), (0.058, -0.152, 0.325), (0.063, -0.135, 0.275), (0.066, -0.122, 0.225), (0.066, -0.114, 0.18)], 4)
    pb = part('braid', 'braid', material('Fur', 0.92), lambda co: braid_col(co),
              soft(['Braid1', 'Braid2', 'Braid3'], 3.0, 2), sub=0)
    n = 9
    for i in range(n):
        t = i / (n - 1)
        idx = t * (len(pts) - 1)
        a = pts[int(idx)]
        b = pts[min(int(idx) + 1, len(pts) - 1)]
        c = a.lerp(b, idx - int(idx))
        r = 0.0125 * (1 - 0.35 * t)
        ellipsoid(pb.bm, c, (r * 1.15, r, r * 1.35), (0.3, 0, 0), u=12, v=8)
    ellipsoid(pb.bm, pts[-1] + Vector((0, 0.002, -0.014)), (0.014, 0.012, 0.014), u=10, v=8)  # tie tuft


def braid_col(co):
    x, y, z = co
    c = fur(co, None, 0.0)
    return mix(c, ORANGE_D, sstep(math.sin(z * 260), 0.0, 0.8) * 0.7 + 0.1)


def make_jacket():
    prof = [  # y, zc, rx, rz, gap  (gap = open arc at belly)
        (-0.13, 0.327, 0.100, 0.118, 0.10), (-0.085, 0.315, 0.131, 0.150, 0.10), (-0.03, 0.299, 0.1445, 0.163, 0.12),
        (0.03, 0.297, 0.146, 0.164, 0.30), (0.08, 0.297, 0.142, 0.162, 0.55), (0.125, 0.298, 0.138, 0.158, 0.70)]
    J = material('Cloth', 0.88)

    def jc(co):
        return cloth(co)

    wf = soft(['Spine1', 'Spine2', 'Spine3', 'Neck'], 3.0, 3)
    p = part('jacket', 'jacket_body', J, jc, wf, sub=1)
    rings = [ring_y(y, zc, rx, rz, 20, a0=-(math.pi - g), a1=math.pi - g) for (y, zc, rx, rz, g) in prof]
    bridge(p.bm, rings, closed=False, caps=False)
    # thickness: second shell slightly inside, joined at edges via solidify
    bm = p.bm
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.008)
    # hem roll
    hem = part('jacket', 'hem', J, lambda co: mix(cloth(co), JACKET_D, 0.5), wf)
    last = prof[-1]
    pts = [Vector((last[2] * math.sin(t) * 1.02, last[0] + 0.0, last[1] + last[3] * math.cos(t) * 1.02))
           for t in [(-(math.pi - last[4]) + 2 * (math.pi - last[4]) * k / 20) for k in range(21)]]
    tube(hem.bm, pts, [0.0075] * len(pts), 6, caps=True)
    # collar + hood (hood bunched behind the head)
    col = part('jacket', 'collar', J, jc, rigid('Neck'), sub=1)
    bridge(col.bm, [ring_y(-0.115, 0.34, 0.098, 0.112, 20), ring_y(-0.15, 0.36, 0.08, 0.092, 20), ring_y(-0.18, 0.375, 0.062, 0.07, 20)], True, False)
    bmesh.ops.solidify(col.bm, geom=list(col.bm.faces), thickness=0.01)
    hood = part('jacket', 'hood', J, jc, soft(['Spine3', 'Neck'], 2.0, 2), sub=1)
    ellipsoid(hood.bm, (0, -0.095, 0.425), (0.092, 0.055, 0.06), (0.25, 0, 0), u=16, v=12)
    ellipsoid(hood.bm, (0.0, -0.06, 0.435), (0.07, 0.045, 0.04), u=12, v=8)
    # sleeves (front legs)
    for s, n in ((1, 'L'), (-1, 'R')):
        x = s * 0.075
        sl = part('jacket', f'sleeve{n}', J, jc, soft([f'Front{n}_Upper', f'Front{n}_Lower'], 5.0, 2), sub=1)
        tube(sl.bm, [(x, -0.06, 0.305), (x, -0.055, 0.22), (x, -0.049, 0.16), (x, -0.052, 0.125)],
             [0.07, 0.058, 0.047, 0.044], 12, caps=False)
        cf = part('jacket', f'cuff{n}', J, lambda co: mix(cloth(co), JACKET_D, 0.55), rigid(f'Front{n}_Lower'))
        tube(cf.bm, [(x, -0.051, 0.133), (x, -0.053, 0.115)], [0.047, 0.044], 12, caps=False)
    # zipper strip + pull
    z = part('jacket', 'zipper', material('Metal', 0.35, 1.0), flat(METAL, 0.04), soft(['Spine2', 'Spine3', 'Neck'], 3.0, 2))
    pts = [Vector((0, y, zc - rz - 0.004)) for (y, zc, rx, rz, g) in prof[:3]] + [Vector((0, -0.145, 0.262))]
    pts = [Vector((0, -0.17, 0.30)), Vector((0, -0.145, 0.25)), Vector((0, -0.12, 0.205)), Vector((0, -0.085, 0.165)),
           Vector((0, -0.03, 0.138)), Vector((0, 0.02, 0.131))]
    pts = catmull(pts, 3)
    tube(z.bm, pts, [0.0045] * len(pts), 6, scale=(2.6, 1.0))
    tube(z.bm, [(0, -0.115, 0.205), (0, -0.108, 0.19), (0, -0.104, 0.172)], [0.006, 0.004, 0.003], 6)
    # straps (backpack/quiver straps over the shoulders)
    st = part('jacket', 'straps', material('Strap', 0.7), flat(STRAP, 0.1), soft(['Spine2', 'Spine3'], 3.0, 2))
    for (y, g) in ((-0.045, 0.1), (0.05, 0.5)):
        rx, rz, zc = 0.1385, 0.158, 0.2985
        arc = [Vector((rx * math.sin(t) * 1.0, y, zc + rz * math.cos(t) * 1.0)) for t in
               [(-(math.pi - g) + 2 * (math.pi - g) * k / 22) for k in range(23)]]
        tube(st.bm, arc, [0.0028] * len(arc), 4, scale=(1, 3.4))
    # diagonal chest strap
    tube(st.bm, catmull([(0.1, -0.1, 0.4), (0.1, -0.06, 0.35), (0.1, -0.02, 0.28), (0.09, 0.02, 0.2)], 4), [0.0028] * 13, 4, scale=(1, 3.0))


def make_gear():
    # quiver
    qv = part('gear', 'quiver', material('Leather', 0.6), flat(LEATHER, 0.1), soft(['Spine3', 'Spine2'], 2.0, 2))
    A, Bp = Vector((0.045, 0.115, 0.375)), Vector((0.075, -0.01, 0.525))
    d = (Bp - A).normalized()
    pts = [A + (Bp - A) * (i / 6) for i in range(7)]
    tube(qv.bm, pts, [0.026, 0.03, 0.032, 0.033, 0.033, 0.034, 0.036], 14)
    rim = part('gear', 'quiver_rim', material('Strap', 0.5), flat(STRAP, 0.05), soft(['Spine3'], 2.0, 1))
    tube(rim.bm, [Bp - d * 0.012, Bp + d * 0.004], [0.037, 0.037], 14, caps=False)
    sh = part('gear', 'arrow_shafts', material('Wood', 0.6), flat(SHAFT, 0.1), soft(['Spine3'], 2.0, 1))
    fr = part('gear', 'arrow_fletch', material('Feather', 0.9), flat(FEATHER_R, 0.15), soft(['Spine3'], 2.0, 1))
    fw = part('gear', 'arrow_fletch_w', material('Feather', 0.9), flat(FEATHER_W, 0.1), soft(['Spine3'], 2.0, 1))
    fan = [(0.012, 0.0, 0.1), (-0.012, 0.012, 0.02), (0.0, -0.012, 0.12), (0.02, 0.012, -0.05), (-0.02, -0.01, 0.0), (0.004, 0.02, 0.07)]
    for i, (dx, dy, dl) in enumerate(fan):
        top0 = Bp + Vector((dx * 1.0, dy, 0.0)) - d * 0.03
        dirv = (d + Vector((dx * 3.0, dy * 3.0, 0))).normalized()
        a = top0 - dirv * 0.02
        b = top0 + dirv * (0.085 + dl)
        tube(sh.bm, [a, b], [0.0028, 0.0028], 5)
        tgt = fr if i % 2 == 0 else fw
        for k in range(3):
            ang = k * 2 * math.pi / 3 + i
            ortho = dirv.cross(Vector((0, 0, 1)) if abs(dirv.z) < 0.9 else Vector((1, 0, 0))).normalized()
            ortho2 = dirv.cross(ortho)
            off = (ortho * math.cos(ang) + ortho2 * math.sin(ang)) * 0.008
            ellipsoid_along(tgt.bm, b - dirv * 0.035 + off, b - dirv * 0.002 + off, 0.0012, 0.0075, 8, 6)
    # bow (slung at the right flank; grip at C)
    C = Vector((0.16, 0.05, 0.30))
    stave = []
    for k in range(21):
        s = -0.2 + 0.4 * k / 20
        x = C.x + 0.07 * (1 - (s / 0.2) ** 2) + 0.026 * (abs(s) / 0.2) ** 6 - 0.012
        stave.append(Vector((x, C.y + s, C.z)))
    bw = part('gear', 'bow', material('Wood', 0.55), flat(WOOD, 0.15), rigid('Bow'))
    radii = [0.0042 + 0.0048 * math.sin(math.pi * k / 20) ** 0.7 for k in range(21)]
    tube(bw.bm, stave, radii, 8)
    gr = part('gear', 'bow_grip', material('Leather', 0.6), flat(LEATHER, 0.1), rigid('Bow'))
    tube(gr.bm, [C + Vector((0.045, -0.035, 0)), C + Vector((0.045, 0.035, 0))], [0.0105, 0.0105], 10)
    tip0, tip1 = stave[0], stave[-1]
    xs = C.x + 0.014
    sg = part('gear', 'bow_string', material('String', 0.6), flat(STRING, 0.05),
              lambda co: ({'Bow': 1.0} if abs(co[1] - C.y) > 0.16 else
                          {'String': sstep(0.16 - abs(co[1] - C.y), 0.0, 0.16), 'Bow': 1 - sstep(0.16 - abs(co[1] - C.y), 0.0, 0.16)}))
    nock = Vector((xs, C.y, C.z))
    tube(sg.bm, [Vector((xs, tip0.y, C.z)) + Vector((0, 0.0, 0))] + [Vector((xs, C.y - 0.2 + 0.2 * k / 4, C.z)) for k in range(1, 4)] + [nock] +
         [Vector((xs, C.y + 0.05 * k / 3 * 4, C.z)) for k in range(1, 5)][:0] +
         [Vector((xs, C.y + 0.2 * k / 4, C.z)) for k in range(1, 4)] + [Vector((xs, tip1.y, C.z))],
         [0.0011] * 9, 4)
    nk = part('gear', 'bow_nocks', material('Wood', 0.6), flat(WOOD_D, 0.1), rigid('Bow'))
    for t in (tip0, tip1):
        ellipsoid(nk.bm, t + Vector((0.012, 0, 0)), (0.006, 0.006, 0.006), u=8, v=6)
    # bow keeps its string nock bead on the String bone
    nb = part('gear', 'nock_bead', material('Strap', 0.5), flat(STRAP, 0), rigid('String'))
    ellipsoid(nb.bm, nock, (0.004, 0.004, 0.005), u=8, v=6)


def build_all():
    define_bones()
    rig = build_armature()
    make_body()
    make_braid()
    make_jacket()
    make_gear()
    groups = {}
    for p in PARTS:
        ob = finalize(p)
        groups.setdefault(p.group, []).append(ob)
    objs = []
    names = {'body': 'Fatniss_Body', 'braid': 'Fatniss_Braid', 'jacket': 'Fatniss_Jacket', 'gear': 'Fatniss_Gear'}
    for g, obs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = obs[0]
        bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = names[g]
        j.data.name = names[g]
        j.parent = rig
        md = j.modifiers.new('Armature', 'ARMATURE')
        md.object = rig
        objs.append(j)
    rig.location = (0, FOOT_Y, 0)
    return rig, objs


# ------------------------------------------------------------------ animation
def wrot(pb, rx=0.0, ry=0.0, rz=0.0):
    Rb = pb.bone.matrix_local.to_3x3()
    Rg = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_matrix()
    pb.rotation_quaternion = (Rb.inverted() @ Rg @ Rb).to_quaternion()


def wloc(pb, v):
    Rb = pb.bone.matrix_local.to_3x3()
    pb.location = Rb.inverted() @ Vector(v)


def reset(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def key(rig, f):
    for pb in rig.pose.bones:
        pb.keyframe_insert('rotation_quaternion', frame=f, group=pb.name)
        pb.keyframe_insert('location', frame=f, group=pb.name)
        pb.keyframe_insert('scale', frame=f, group=pb.name)


def pose_idle(rig, ph):
    P = rig.pose.bones
    s = math.sin(ph)
    wrot(P['Spine2'], 1.2 * s)
    wrot(P['Spine3'], -1.5 * s)
    wrot(P['Neck'], 2.0 * s, 0, 3 * math.sin(ph * 0.5))
    wrot(P['Head'], -1.0 * s, 0, 4 * math.sin(ph * 0.5 + 1.0))
    wloc(P['Root'], (0, 0, 0.003 * s))
    for i, n in enumerate(('Tail1', 'Tail2', 'Tail3')):
        wrot(P[n], 2.0 * math.sin(ph + i), 0, 9 * math.sin(ph * 0.5 + 0.7 * i))
    for n in ('Braid1', 'Braid2', 'Braid3'):
        wrot(P[n], 2.0 * s)
    for sd in 'LR':
        wrot(P[f'Front{sd}_Upper'], 1.0 * s)
    wrot(P['Bow'], 0)


def pose_run(rig, ph):
    P = rig.pose.bones
    s = math.sin(ph)
    wloc(P['Root'], (0, 0, 0.022 * math.sin(2 * ph + 0.6) - 0.012))
    wrot(P['Root'], 4 * math.sin(2 * ph + 1.4))
    wrot(P['Spine1'], 7 * math.sin(ph + 2.4))
    wrot(P['Spine2'], 6 * math.sin(ph + 2.0))
    wrot(P['Spine3'], 5 * math.sin(ph + 1.4))
    wrot(P['Neck'], -6 * math.sin(ph + 1.4) - 4)
    wrot(P['Head'], -5 * math.sin(ph + 1.8) + 3)
    for sd, off in (('L', 0.0), ('R', 0.35)):
        a = ph + off
        wrot(P[f'Front{sd}_Upper'], -42 * math.sin(a))
        wrot(P[f'Front{sd}_Lower'], 38 * (0.5 + 0.5 * math.sin(a + 1.9)))
        b = ph + 2.3 + off
        wrot(P[f'Hind{sd}_Upper'], -44 * math.sin(b))
        wrot(P[f'Hind{sd}_Lower'], 50 * (0.5 + 0.5 * math.sin(b + 1.7)))
    for i, n in enumerate(('Tail1', 'Tail2', 'Tail3')):
        wrot(P[n], -8 + 6 * math.sin(ph + 1 + i * 0.8), 0, 10 * math.sin(ph + 0.9 * i))
    for i, n in enumerate(('Braid1', 'Braid2', 'Braid3')):
        wrot(P[n], 10 * math.sin(2 * ph + i * 0.9) + 8)
    wrot(P['Bow'], 2 * math.sin(2 * ph))


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def pose_shoot(rig, f, n=30):
    P = rig.pose.bones
    raise_ = ease(f / 6.0) * (1 - ease((f - 24) / 5.0))   # bow up / body crouch
    draw = ease((f - 6) / 12.0)                            # string drawn
    rel = ease((f - 18) / 2.0)                             # released
    drawn = draw * (1 - rel)
    recoil = math.sin(math.pi * max(0.0, min(1.0, (f - 18) / 8.0))) * (1 - ease((f - 24) / 5.0))
    wloc(P['Root'], (0, 0, -0.045 * raise_ - 0.005 * recoil))
    wrot(P['Spine1'], -8 * raise_)
    wrot(P['Spine2'], 8 * raise_ + 2 * recoil)
    wrot(P['Spine3'], 10 * raise_ - 6 * drawn - 3 * recoil)
    wrot(P['Neck'], -12 * raise_, 0, 8 * raise_)
    wrot(P['Head'], -4 * raise_ + 3 * recoil, 0, -6 * raise_)
    for sd in 'LR':
        wrot(P[f'Front{sd}_Upper'], 16 * raise_)
        wrot(P[f'Front{sd}_Lower'], 18 * raise_)
        wrot(P[f'Hind{sd}_Upper'], 24 * raise_)
        wrot(P[f'Hind{sd}_Lower'], -34 * raise_)
    # bow: swing from slung (limbs along Y) up in front of the shoulder, limbs vertical, belly facing forward (-Y)
    bw = P['Bow']
    Rb = bw.bone.matrix_local.to_3x3()
    Rg = Euler((0, math.radians(-90 * raise_), 0), 'XYZ').to_matrix() @ Euler((0, 0, math.radians(-90 * raise_)), 'XYZ').to_matrix()
    bw.rotation_quaternion = (Rb.inverted() @ Rg @ Rb).to_quaternion()
    wloc(bw, (-0.07 * raise_, -0.16 * raise_, 0.07 * raise_))
    # string pull: along world +Y after the bow has turned (belly -Y); local string bone shifts along -x of bow frame
    sb = P['String']
    Rs = sb.bone.matrix_local.to_3x3()
    pull = Vector((-0.085 * drawn, 0, 0))
    ov = 0.012 * math.sin(math.pi * max(0.0, min(1.0, (f - 18) / 6.0))) * rel
    sb.location = Rs.inverted() @ (pull + Vector((ov, 0, 0)))
    for i, nme in enumerate(('Tail1', 'Tail2', 'Tail3')):
        wrot(P[nme], -4 * raise_ + 5 * recoil, 0, 5 * raise_ * math.sin(i + f * 0.3))
    for nme in ('Braid1', 'Braid2', 'Braid3'):
        wrot(P[nme], 12 * raise_ - 8 * recoil)


def make_action(rig, name, frames, fn, cyclic):
    act = bpy.data.actions.new(name)
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = act
    for f in frames:
        reset(rig)
        fn(f)
        key(rig, f)
    act.use_frame_range = True
    act.frame_start = frames[0]
    act.frame_end = frames[-1]
    act.use_cyclic = cyclic
    for fc in act.layers[0].strips[0].channelbags[0].fcurves if hasattr(act, 'layers') and act.layers else []:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR' if not cyclic else 'BEZIER'
    return act


def animate(rig):
    bpy.context.scene.render.fps = FPS
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    acts = []
    n = 60
    acts.append(make_action(rig, 'Idle', list(range(0, n, 3)) + [n - 1 if False else n - 3 + 3 - 3 + 0][:0] or list(range(0, n, 3)),
                            lambda f: pose_idle(rig, 2 * math.pi * f / n), True))
    n = 24
    acts.append(make_action(rig, 'Run', list(range(0, n)), lambda f: pose_run(rig, 2 * math.pi * f / n), True))
    acts.append(make_action(rig, 'Shoot', list(range(0, 30)), lambda f: pose_shoot(rig, f), False))
    bpy.ops.object.mode_set(mode='OBJECT')
    reset(rig)
    # park actions in NLA tracks so every action is exported
    rig.animation_data.action = None
    for a in acts:
        tr = rig.animation_data.nla_tracks.new()
        tr.name = a.name
        st = tr.strips.new(a.name, int(a.frame_start), a)
        st.name = a.name
    return acts


# ------------------------------------------------------------------ export
def export(rig, objs):
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(GLB), exist_ok=True)
    kw = dict(filepath=GLB, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
              export_animations=True, export_animation_mode='ACTIONS', export_skins=True,
              export_image_format='AUTO', export_materials='EXPORT', export_force_sampling=True,
              export_optimize_animation_size=False, export_frame_range=True)
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = {k: v for k, v in kw.items() if k in props}
    if 'export_vertex_color' in props:
        kw['export_vertex_color'] = 'MATERIAL'
    if 'export_active_vertex_color_when_no_material' in props:
        pass
    bpy.ops.export_scene.gltf(**kw)
    print('exported', GLB, os.path.getsize(GLB))


# ------------------------------------------------------------------ verify / previews
def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_render(w=900, h=700):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = 48
    sc.cycles.device = 'CPU'
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.image_settings.file_format = 'PNG'
    wd = bpy.data.worlds.new('w')
    sc.world = wd
    wd.use_nodes = True
    bg = wd.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.32, 0.38, 0.34, 1)
    bg.inputs['Strength'].default_value = 1.0
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 4.0
    so = bpy.data.objects.new('sun', sun)
    bpy.context.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    fill = bpy.data.lights.new('fill', 'AREA')
    fill.energy = 60
    fill.size = 2
    fo = bpy.data.objects.new('fill', fill)
    bpy.context.collection.objects.link(fo)
    fo.location = (-1.5, -1.2, 0.8)
    fo.rotation_euler = (math.radians(70), 0, math.radians(-50))
    gp = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=3)
    bm.to_mesh(gp)
    go = bpy.data.objects.new('ground', gp)
    bpy.context.collection.objects.link(go)
    gm = bpy.data.materials.new('g')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.08, 0.1, 0.06, 1)
    go.data.materials.append(gm)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 55
    co = bpy.data.objects.new('cam', cam)
    bpy.context.collection.objects.link(co)
    sc.camera = co
    return co


def aim(co, loc, target=(0, 0, 0.27)):
    co.location = loc
    d = Vector(target) - Vector(loc)
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def verify():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=GLB)
    acts = sorted(a.name for a in bpy.data.actions)
    print('ACTIONS', acts)
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            me = o.data
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
    print('TRIS', tris)
    rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    print('BONES', len(rig.data.bones), sorted(b.name for b in rig.data.bones))
    xs = [v[0] for o in bpy.context.scene.objects if o.type == 'MESH' for v in (o.matrix_world @ Vector(c) for c in o.bound_box)]
    ys = [v[1] for o in bpy.context.scene.objects if o.type == 'MESH' for v in (o.matrix_world @ Vector(c) for c in o.bound_box)]
    zs = [v[2] for o in bpy.context.scene.objects if o.type == 'MESH' for v in (o.matrix_world @ Vector(c) for c in o.bound_box)]
    print('BBOX x', min(xs), max(xs), 'y(blender)', min(ys), max(ys), 'z', min(zs), max(zs))
    co = setup_render()
    os.makedirs(PREV, exist_ok=True)
    only = [a for a in ARGS if a.startswith('--shots=')]
    views = {'bow': (1.4, -1.3, 0.55), 'front': (0.0, -2.0, 0.5), '3q': (-1.4, -1.5, 0.62), 'side': (-2.0, 0.0, 0.42)}
    # blender-space imported: cat faces -Y after import? glTF +Z forward -> Blender -Y forward: same as build
    for name, loc in views.items():
        aim(co, loc)
        bpy.context.scene.render.filepath = os.path.join(PREV, f'{name}.png')
        bpy.ops.render.render(write_still=True)
    # pose previews
    for actname, frame in (('Run', 4), ('Run', 16), ('Shoot', 17), ('Shoot', 19)):
        a = bpy.data.actions[actname]
        if rig.animation_data is None:
            rig.animation_data_create()
        for t in list(rig.animation_data.nla_tracks):
            t.mute = True
        rig.animation_data.action = a
        try:
            rig.animation_data.action_slot = a.slots[0]
        except Exception:
            pass
        bpy.context.scene.frame_set(frame)
        aim(co, (-1.8, -1.0, 0.55) if actname == 'Run' else (1.4, -1.5, 0.62))
        bpy.context.scene.render.filepath = os.path.join(PREV, f'{actname.lower()}_{frame}.png')
        bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None


def main():
    if '--verify' in ARGS:
        verify()
        return
    clear_scene()
    rig, objs = build_all()
    animate(rig)
    export(rig, objs)
    import mathutils
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    print('BUILD BBOX', [round(min(p[i] for p in pts), 3) for i in range(3)], [round(max(p[i] for p in pts), 3) for i in range(3)])
    if '--save-blend' in ARGS:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(os.environ.get('CLAUDE_CODE_TMPDIR', '/datanapps/claude-tmp'), 'fatniss.blend'))


main()
