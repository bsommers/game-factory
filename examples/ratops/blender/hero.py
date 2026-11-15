# Major Marmalade -- hero model, rig, LODs, baked textures and animation clips.
# Run:  blender -b -P tools/blender/hero.py            (writes game/assets/models/hero.glb + hero_*.png)
#       HERO_PREVIEW=1 blender -b -P tools/blender/hero.py   (also renders previews to out/previews/model-hero/)
# Authoring frame: Blender Z up, character faces +Y, character right = +X (left side = -X).
# glTF export (Y up) turns that into Godot: faces -Z, right +X, up +Y.  1 unit = 1 m.
import bpy, bmesh, math, os, sys, time
from mathutils import Vector, Matrix, Quaternion, Euler
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

T0 = time.time()
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MODELS = os.path.join(REPO, "game", "assets", "models")
PREV = os.path.join(REPO, "out", "previews", "model-hero")
SCRATCH = os.path.join(REPO, "out", "model-hero")
for d in (MODELS, PREV, SCRATCH):
    os.makedirs(d, exist_ok=True)
FPS = 30
MB_K = 0.575  # metaball surface radius / element radius (stiffness 2, threshold 0.6), measured


def log(*a):
    print("[hero %6.1fs]" % (time.time() - T0), *a, flush=True)


V = Vector
SIDES = (("Left", -1.0), ("Right", 1.0))


def nrm(v):
    v = V(v)
    return v.normalized() if v.length > 1e-9 else V((0, 0, 1))


def orth(v, axis):
    v = V(v); a = nrm(axis)
    return nrm(v - a * v.dot(a))


def basis(u, n):
    u = nrm(u); n = orth(n, u); w = u.cross(n)
    return Matrix((u, n, w)).transposed()


def align_q(u0, n0, u1, n1):
    return (basis(u1, n1) @ basis(u0, n0).transposed()).to_quaternion()


def E(rx=0.0, ry=0.0, rz=0.0):
    return Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_quaternion()


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
COL = scene.collection


def link(ob):
    COL.objects.link(ob); return ob


def set_active(ob):
    bpy.context.view_layer.update()
    for o in list(bpy.context.view_layer.objects):
        if o is not None:
            o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# --------------------------------------------------------------------------- skeleton layout
J = {}
J["Root"] = (V((0, 0, 0)), V((0, 0.15, 0)), None)
J["Hips"] = (V((0, 0, 0.95)), V((0, 0, 1.08)), "Root")
J["Spine"] = (V((0, 0, 1.08)), V((0, 0.01, 1.22)), "Hips")
J["Chest"] = (V((0, 0.01, 1.22)), V((0, 0.01, 1.35)), "Spine")
J["UpperChest"] = (V((0, 0.01, 1.35)), V((0, 0.01, 1.47)), "Chest")
J["Neck"] = (V((0, 0.01, 1.47)), V((0, 0.035, 1.60)), "UpperChest")
J["Head"] = (V((0, 0.035, 1.60)), V((0, 0.035, 1.82)), "Neck")
J["Jaw"] = (V((0, 0.08, 1.605)), V((0, 0.165, 1.585)), "Head")
HEAD_C = V((0, 0.03, 1.68))
EYE_R = 0.027
TAIL_PTS = [V(p) for p in ((0, -0.13, 0.93), (0, -0.25, 0.87), (0, -0.37, 0.80), (0, -0.49, 0.76),
                           (0, -0.61, 0.78), (0, -0.71, 0.85), (0, -0.78, 0.95))]
for i in range(6):
    J["Tail%d" % (i + 1)] = (TAIL_PTS[i], TAIL_PTS[i + 1], "Hips" if i == 0 else "Tail%d" % i)

HAND = {}
for side, s in SIDES:
    J[side + "Eye"] = (V((s * 0.06, 0.142, 1.69)), V((s * 0.06, 0.19, 1.69)), "Head")
    J[side + "Ear"] = (V((s * 0.085, 0.0, 1.765)), V((s * 0.15, -0.015, 1.925)), "Head")
    J[side + "Shoulder"] = (V((s * 0.04, 0.01, 1.44)), V((s * 0.21, 0, 1.47)), "UpperChest")
    SH, EL, WR = V((s * 0.22, 0, 1.47)), V((s * 0.44, -0.045, 1.255)), V((s * 0.635, 0.03, 1.06))
    J[side + "UpperArm"] = (SH, EL, side + "Shoulder")
    J[side + "LowerArm"] = (EL, WR, side + "UpperArm")
    d0 = nrm(WR - EL)
    n0 = orth(V((-s * 0.707, 0, -0.707)), d0)       # palm normal (palm faces the thigh)
    a = d0.cross(n0).normalized()
    a = a if a.y > 0 else -a                        # spread axis, pointing forward (thumb side)
    K = WR + d0 * 0.085
    J[side + "Hand"] = (WR, K, side + "LowerArm")
    HAND[side] = dict(d0=d0, n0=n0, a=a, K=K, W=WR, curl=d0.cross(n0).normalized())
    for fname, off, sc in (("Index", 0.022, 0.95), ("Middle", 0.0075, 1.0), ("Ring", -0.0075, 0.95), ("Little", -0.022, 0.85)):
        p = K + a * off - d0 * (0.006 if fname in ("Index", "Little") else 0.0)
        dirv = d0.copy()
        parent = side + "Hand"
        for seg, ln in (("Proximal", 0.028), ("Intermediate", 0.021), ("Distal", 0.018)):
            dirv = (Quaternion(HAND[side]["curl"], math.radians(12)) @ dirv).normalized()
            q = p + dirv * ln * sc
            nm = side + fname + seg
            J[nm] = (p.copy(), q.copy(), parent)
            parent = nm; p = q
    t0 = nrm(d0 * 0.55 + a * 0.65 + n0 * 0.40)
    p = WR + d0 * 0.018 + a * 0.024 + n0 * 0.010
    parent = side + "Hand"
    for seg, ln in (("Metacarpal", 0.028), ("Proximal", 0.024), ("Distal", 0.019)):
        q = p + t0 * ln
        nm = side + "Thumb" + seg
        J[nm] = (p.copy(), q.copy(), parent)
        parent = nm; p = q
        t0 = (Quaternion(nrm(t0.cross(n0)), math.radians(10)) @ t0).normalized()
    HAND[side]["t0"] = nrm(J[side + "ThumbMetacarpal"][1] - J[side + "ThumbMetacarpal"][0])
    HIP, KNEE, HOCK, BALL, TOE = (V((s * 0.13, 0, 0.95)), V((s * 0.13, 0.08, 0.56)), V((s * 0.13, -0.09, 0.17)),
                                  V((s * 0.13, 0.09, 0.035)), V((s * 0.13, 0.165, 0.02)))
    J[side + "UpperLeg"] = (HIP, KNEE, "Hips")
    J[side + "LowerLeg"] = (KNEE, HOCK, side + "UpperLeg")
    J[side + "Foot"] = (HOCK, BALL, side + "LowerLeg")
    J[side + "Toes"] = (BALL, TOE, side + "Foot")

ORDER = []


def _ord(n):
    if n in ORDER:
        return
    p = J[n][2]
    if p:
        _ord(p)
    ORDER.append(n)


for n in J:
    _ord(n)

arm_data = bpy.data.armatures.new("HeroRig")
ARM = link(bpy.data.objects.new("HeroRig", arm_data))
set_active(ARM)
bpy.ops.object.mode_set(mode="EDIT")
for n in ORDER:
    h, t, p = J[n]
    eb = arm_data.edit_bones.new(n)
    eb.head, eb.tail = h, t
    # roll: keep local Z pointing forward-ish for limbs/spine (stable twist axis)
    up = V((0, 1, 0)) if abs(nrm(t - h).y) < 0.8 else V((0, 0, 1))
    eb.align_roll(up)
    if p:
        eb.parent = arm_data.edit_bones[p]
        eb.use_connect = (arm_data.edit_bones[p].tail - h).length < 1e-5 and n not in ("Hips",)
bpy.ops.object.mode_set(mode="OBJECT")
NODEFORM = {"Root"}
for b in arm_data.bones:
    b.use_deform = b.name not in NODEFORM
REST = {b.name: b.matrix_local.to_3x3().to_quaternion() for b in arm_data.bones}
log("armature", len(arm_data.bones), "bones")

# --------------------------------------------------------------------------- body: metaballs
mb = bpy.data.metaballs.new("BodyMB")
mb.resolution = 0.006
mb.render_resolution = 0.006
mb.threshold = 0.6
MBO = link(bpy.data.objects.new("BodyMB", mb))


def ball(c, r, neg=False, stiff=2.0):
    e = mb.elements.new(type="BALL"); e.co = c; e.radius = r / MB_K; e.stiffness = stiff
    e.use_negative = neg
    return e


def ellip(c, sx, sy, sz, rot=None, stiff=2.0):
    r = max(sx, sy, sz)
    e = mb.elements.new(type="ELLIPSOID"); e.co = c; e.radius = r / MB_K; e.stiffness = stiff
    e.size_x, e.size_y, e.size_z = sx / r, sy / r, sz / r
    if rot is not None:
        e.rotation = rot
    return e


def sweep(a, b, ra, rb, step=0.35):
    a, b = V(a), V(b)
    L = (b - a).length
    n = max(2, int(L / (min(ra, rb) * step)) + 1)
    for i in range(n):
        t = i / (n - 1)
        ball(a.lerp(b, t), lerp(ra, rb, t))


# torso (broad, heroic; slight barrel chest)
ellip((0, -0.01, 0.97), 0.18, 0.145, 0.12)                # pelvis
ellip((0, 0.025, 1.12), 0.175, 0.15, 0.14)                # belly
ellip((0, 0.03, 1.30), 0.215, 0.16, 0.16)                 # chest
ellip((0, -0.01, 1.42), 0.27, 0.13, 0.09)                # shoulder girdle / traps
ellip((0, 0.075, 1.30), 0.15, 0.09, 0.12)                 # pecs
for s in (-1, 1):
    ball((s * 0.075, -0.085, 0.92), 0.095)                # glutes
    ellip((s * 0.15, -0.04, 1.32), 0.08, 0.10, 0.13)      # lats
sweep((0, 0.0, 1.45), (0, 0.035, 1.60), 0.085, 0.08)      # neck
ellip((0, 0.065, 1.515), 0.12, 0.075, 0.075)              # chest ruff
# head
ellip(HEAD_C, 0.135, 0.125, 0.115)                        # cranium
ellip((0, -0.01, 1.70), 0.12, 0.10, 0.10)                 # back of skull
for s in (-1, 1):
    ellip((s * 0.095, 0.075, 1.625), 0.075, 0.065, 0.06)  # cheeks / jowls (tom cat)
    ball((s * 0.028, 0.165, 1.626), 0.034)                # whisker pads
    ball((s * 0.06, 0.168, 1.695), EYE_R * 1.05, neg=True)  # eye sockets
    ellip((s * 0.062, 0.135, 1.725), 0.04, 0.03, 0.018)   # brow ridge
ellip((0, 0.158, 1.67), 0.026, 0.05, 0.026)               # nose bridge
ball((0, 0.196, 1.648), 0.016)                            # nose leather
ellip((0, 0.148, 1.588), 0.032, 0.035, 0.022)             # chin
# arms
for side, s in SIDES:
    ball((s * 0.24, -0.005, 1.435), 0.095)               # deltoid
    sweep(J[side + "UpperArm"][0], J[side + "UpperArm"][1], 0.074, 0.056)
    ellip((s * 0.30, 0.015, 1.36), 0.05, 0.05, 0.07, stiff=1.6)  # biceps bulk
    sweep(J[side + "LowerArm"][0], J[side + "LowerArm"][1], 0.056, 0.040)
    h = HAND[side]
    fr = basis(h["d0"], h["n0"])  # cols: d0, n0, d0 x n0  -> ellipsoid axes (x=len, y=thick, z=width)
    q = fr.to_quaternion()
    ellip(h["W"] + h["d0"] * 0.045, 0.048, 0.024, 0.042, rot=q)       # palm
    ellip(h["W"] + h["d0"] * 0.045 + h["n0"] * 0.012, 0.024, 0.012, 0.03, rot=q)  # palm pad
    for f in ("Index", "Middle", "Ring", "Little"):
        for seg, ra, rb in (("Proximal", 0.0145, 0.0135), ("Intermediate", 0.0135, 0.0125), ("Distal", 0.0125, 0.0105)):
            a_, b_, _ = J[side + f + seg]
            sweep(a_, b_, ra, rb, step=0.5)
    for seg, ra, rb in (("Metacarpal", 0.016, 0.013), ("Proximal", 0.013, 0.012), ("Distal", 0.012, 0.010)):
        a_, b_, _ = J[side + "Thumb" + seg]
        sweep(a_, b_, ra, rb, step=0.5)
    # legs (digitigrade-ish: raised hock, long foot)
    sweep(J[side + "UpperLeg"][0], J[side + "UpperLeg"][1], 0.115, 0.072)
    ellip((s * 0.14, -0.01, 0.80), 0.10, 0.11, 0.15, stiff=1.6)  # thigh muscle
    sweep(J[side + "LowerLeg"][0], J[side + "LowerLeg"][1], 0.062, 0.038)
    ball((s * 0.13, 0.03, 0.47), 0.058)                   # calf
    sweep(J[side + "Foot"][0], J[side + "Foot"][1], 0.038, 0.04)
    ellip((s * 0.13, 0.10, 0.03), 0.05, 0.06, 0.03)       # foot pad
    for k, xo in enumerate((-0.033, -0.011, 0.011, 0.033)):
        ball((s * 0.13 + xo, 0.15 - abs(xo) * 0.5, 0.024), 0.021)  # toes
# tail (fluffy, tapering)
for i in range(6):
    sweep(TAIL_PTS[i], TAIL_PTS[i + 1], lerp(0.055, 0.036, i / 6), lerp(0.055, 0.036, (i + 1) / 6))
ball(TAIL_PTS[-1] + V((0, -0.01, 0.02)), 0.03)
log("metaball elements", len(mb.elements))

dg = bpy.context.evaluated_depsgraph_get()
body_me = bpy.data.meshes.new_from_object(MBO.evaluated_get(dg))
BODY = link(bpy.data.objects.new("Hero_Body", body_me))
bpy.data.objects.remove(MBO)
log("metaball mesh verts", len(body_me.vertices))


# ears: flattened cones joined before remesh
def make_ear(side, s):
    B, T = J[side + "Ear"][0] + V((0, 0, -0.03)), J[side + "Ear"][1]
    u = nrm(T - B)
    f = orth(V((s * 0.35, 1, 0.1)), u)
    w = u.cross(f)
    bm = bmesh.new()
    rings = []
    for lv, h in enumerate((0.0, 0.25, 0.5, 0.72, 0.88)):
        wid = 0.058 * (1 - h) ** 0.85 + 0.005
        dep = 0.026 * (1 - h) ** 0.9 + 0.007
        ring = []
        for k in range(16):
            ang = 2 * math.pi * k / 16
            cx, cy = math.cos(ang) * wid, math.sin(ang) * dep
            if cy > 0:
                cy *= 0.25  # flat-ish front (inner ear)
            p = B + u * (h * (T - B).length) + w * cx + f * cy
            ring.append(bm.verts.new(p))
        rings.append(ring)
    tip = bm.verts.new(T)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(16):
            bm.faces.new((r0[k], r0[(k + 1) % 16], r1[(k + 1) % 16], r1[k]))
    for k in range(16):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % 16], tip))
    bm.faces.new(list(reversed(rings[0])))
    me = bpy.data.meshes.new("ear")
    bm.to_mesh(me); bm.free()
    return link(bpy.data.objects.new("ear_" + side, me))


ears = [make_ear(sd, s) for sd, s in SIDES]
set_active(BODY)
for e in ears:
    e.select_set(True)
bpy.ops.object.join()
BODY = bpy.context.view_layer.objects.active
rm = BODY.modifiers.new("remesh", "REMESH")
rm.mode = "VOXEL"; rm.voxel_size = 0.0055; rm.adaptivity = 0.0
sm = BODY.modifiers.new("smooth", "SMOOTH"); sm.iterations = 2; sm.factor = 0.5
apply_mods(BODY)
HI = BODY.copy(); HI.data = BODY.data.copy(); HI.name = "Body_HI"; link(HI)  # kept for gear extraction
log("remeshed tris", tri_count(BODY))
dec = BODY.modifiers.new("dec", "DECIMATE"); dec.ratio = min(1.0, 43000 / max(1, tri_count(BODY)))
dec.use_collapse_triangulate = True
apply_mods(BODY)
log("body LOD0 tris", tri_count(BODY))

# --------------------------------------------------------------------------- region helpers


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def near_arm(p, extra=0.0):
    for side, s in SIDES:
        a, b, _ = J[side + "UpperArm"]
        if seg_dist(p, a, b) < 0.088 + extra:
            return True
        a2, b2, _ = J[side + "LowerArm"]
        if seg_dist(p, a2, b2) < 0.075 + extra:
            return True
    return False


def vest_region(p):
    ax = abs(p.x)
    if 1.035 <= p.z <= 1.455 and ax < 0.30 and not near_arm(p):
        return True
    if 1.40 <= p.z <= 1.56 and 0.075 <= ax <= 0.165 and abs(p.y) < 0.16 and not near_arm(p, -0.02):
        return True
    return False


def belt_region(p):
    return 0.93 <= p.z <= 0.995 and abs(p.x) < 0.30 and p.y > -0.2 and seg_dist(p, TAIL_PTS[0], TAIL_PTS[1]) > 0.065 and not near_arm(p)


def gear_covered(p):
    return vest_region(p) or belt_region(p)


# --------------------------------------------------------------------------- body materials, regions, fur length
def mat(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    return m


M_FUR, M_SKIN = mat("fur"), mat("skin")
BODY.data.materials.append(M_FUR)
BODY.data.materials.append(M_SKIN)
me = BODY.data
me.calc_loop_triangles()
nose_c = V((0, 0.198, 1.648))
pads = []
for side, s in SIDES:
    h = HAND[side]
    pads.append((h["W"] + h["d0"] * 0.045 + h["n0"] * 0.02, h["n0"]))
for p in me.polygons:
    c, n = p.center, p.normal
    skin = False
    if (c - nose_c).length < 0.02 and n.y > 0.2:
        skin = True                                            # nose leather
    for pc, pn in pads:
        if (c - pc).length < 0.03 and n.dot(pn) > 0.5:
            skin = True                                        # palm pads
    if c.z < 0.03 and n.z < -0.5:
        skin = True                                            # foot pads
    for side, s in SIDES:
        B, Tp, _ = J[side + "Ear"]
        if c.z > 1.775 and (c - (B.lerp(Tp, 0.45))).length < 0.06 and n.y > 0.55 and abs(c.x) > 0.06:
            skin = True                                        # inner ear
    p.material_index = 1 if skin else 0

col_reg = me.color_attributes.new("region", "FLOAT_COLOR", "POINT")
col_fur = me.color_attributes.new("fur_length", "FLOAT_COLOR", "POINT")
vnorm = [v.normal.copy() for v in me.vertices]
for v in me.vertices:
    p, n = v.co, vnorm[v.index]
    belly = 0.0
    if 0.95 < p.z < 1.52 and abs(p.x) < 0.16 and n.y > 0.35:
        belly = smooth((n.y - 0.35) / 0.4) * smooth((0.16 - abs(p.x)) / 0.08)
    for c, r in ((V((0, 0.15, 1.595)), 0.05), (V((0, 0.17, 1.625)), 0.05), (V((0, 0.08, 1.52)), 0.08)):
        d = (p - c).length
        if d < r:
            belly = max(belly, smooth((r - d) / (r * 0.6)))
    tail = 1.0 if (p.y < -0.17 and 0.7 < p.z < 1.06 and abs(p.x) < 0.09) else 0.0
    head = 0.0
    if (p - HEAD_C).length < 0.19 and p.z > 1.70 and p.y < 0.155:
        head = smooth((p.z - 1.70) / 0.03)
    col_reg.data[v.index].color = (belly, tail, head, 1.0)
    L = 1.0
    if gear_covered(p):
        L = 0.0
    elif (p - nose_c).length < 0.06:
        L = 0.15
    elif (p - HEAD_C).length < 0.2 and p.y > 0.12:
        L = 0.35                                               # face, short fur
    elif p.z > 1.76 and (abs(p.x) > 0.06):
        L = 0.4                                                # ears
    for side, s in SIDES:
        if (p - HAND[side]["K"]).length < 0.09:
            L = min(L, 0.35)
    if p.z < 0.09:
        L = min(L, 0.45)
    if p.z < 0.025 and n.z < -0.4:
        L = 0.0
    col_fur.data[v.index].color = (L, L, L, 1.0)
me.color_attributes.active_color = col_fur
log("regions assigned")

# --------------------------------------------------------------------------- eyes, whiskers


def uv_sphere(name, center, r, seg, rings, matname):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(-90), 3, "X"))
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops:
            co = l.vert.co / r
            l[uvl].uv = (0.5 + co.x * 0.5, 0.5 + co.z * 0.5)
    bmesh.ops.translate(bm, verts=bm.verts, vec=center)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(mat(matname))
    return me


def make_eyes(name, seg, rings):
    obs = []
    for side, s in SIDES:
        c = J[side + "Eye"][0]
        obs.append(link(bpy.data.objects.new(name + side, uv_sphere(name + side, c, EYE_R, seg, rings, "eye"))))
    set_active(obs[0]); obs[1].select_set(True); bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active; ob.name = name
    return ob


EYES = make_eyes("Hero_Eyes", 20, 14)
EYES1 = make_eyes("Hero_Eyes_LOD1", 10, 8)


def make_whiskers():
    bm = bmesh.new()
    def strand(root, dirv, droop, length, r0):
        prev = None
        side_a = orth(V((0, 0, 1)), dirv)
        side_b = dirv.cross(side_a)
        pts = []
        for i in range(7):
            t = i / 6
            p = root + dirv * (length * t) + V((0, 0, -droop * t * t))
            rr = r0 * (1 - 0.85 * t)
            ring = [bm.verts.new(p + (side_a * math.cos(a) + side_b * math.sin(a)) * rr) for a in (0, 2.094, 4.189)]
            if prev:
                for k in range(3):
                    bm.faces.new((prev[k], prev[(k + 1) % 3], ring[(k + 1) % 3], ring[k]))
            prev = ring
    for side, s in SIDES:
        for k in range(5):
            root = V((s * (0.035 + 0.004 * k), 0.178 - 0.004 * k, 1.636 - 0.007 * k))
            dirv = nrm(V((s * 1.0, 0.25 - 0.08 * k, 0.12 - 0.07 * k)))
            strand(root, dirv, 0.02 + 0.006 * k, 0.15 - 0.008 * abs(k - 2), 0.0011)
        for k in range(2):
            root = V((s * (0.045 + 0.02 * k), 0.15, 1.737))
            strand(root, nrm(V((s * 0.6, 0.3, 0.75))), 0.012, 0.07, 0.0009)
    me = bpy.data.meshes.new("Hero_Whiskers"); bm.to_mesh(me); bm.free()
    me.materials.append(mat("whisker"))
    return link(bpy.data.objects.new("Hero_Whiskers", me))


WHISK = make_whiskers()

# --------------------------------------------------------------------------- gear (vest, belt, pouches, patch)


def extract_shell(src, region, offset, thick, name, target_tris):
    ob = src.copy(); ob.data = src.data.copy(); ob.name = name; link(ob)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    kill = [v for v in bm.verts if not region(v.co)]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    # drop tiny islands
    bm.verts.ensure_lookup_table()
    seen = set(); islands = []
    for v in bm.verts:
        if v in seen:
            continue
        stack = [v]; isl = []
        seen.add(v)
        while stack:
            x = stack.pop(); isl.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o not in seen:
                    seen.add(o); stack.append(o)
        islands.append(isl)
    small = [v for isl in islands if len(isl) < 200 for v in isl]
    if small:
        bmesh.ops.delete(bm, geom=small, context="VERTS")
    for v in bm.verts:
        v.co += v.normal * offset
    bm.to_mesh(ob.data); bm.free()
    ob.data.materials.clear()
    so = ob.modifiers.new("smooth", "SMOOTH"); so.iterations = 4; so.factor = 0.6
    sd = ob.modifiers.new("solid", "SOLIDIFY"); sd.thickness = thick; sd.offset = 1.0; sd.use_rim = True
    apply_mods(ob)
    if tri_count(ob) > target_tris:
        d = ob.modifiers.new("dec", "DECIMATE"); d.ratio = target_tris / tri_count(ob); d.use_collapse_triangulate = True
        apply_mods(ob)
    return ob


M_CLOTH, M_LEATHER, M_METAL, M_EMBLEM = mat("cloth_vest"), mat("leather"), mat("metal"), mat("emblem")
VEST = extract_shell(HI, vest_region, 0.02, 0.009, "vest", 7000)
VEST.data.materials.append(M_CLOTH)
BELT = extract_shell(HI, belt_region, 0.022, 0.008, "belt", 2200)
BELT.data.materials.append(M_LEATHER)
bpy.data.objects.remove(HI)
gear_bvh = BVHTree.FromObject(VEST, bpy.context.evaluated_depsgraph_get())
belt_bvh = BVHTree.FromObject(BELT, bpy.context.evaluated_depsgraph_get())


def surf(bvh, x, z, from_dir=V((0, 1, 0))):
    o = V((x, 0, z)) + from_dir * 0.6
    hit = bvh.ray_cast(o, -from_dir, 2.0)
    if hit[0] is None:
        return V((x, 0.18, z)), from_dir.copy()
    return hit[0], hit[1]


def box(name, center, normal, w, d, h, material, bevel=0.006, up=V((0, 0, 1))):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(w, d, h), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel, segments=2, affect="EDGES")
    yax = nrm(normal)
    zax = orth(up, yax); xax = yax.cross(zax)
    R = Matrix((xax, yax, zax)).transposed().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center + yax * (d * 0.5 - 0.004)) @ R, verts=bm.verts)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(material)
    return link(bpy.data.objects.new(name, me))


parts = [VEST, BELT]
for i, x in enumerate((-0.085, 0.0, 0.085)):
    c, n = surf(gear_bvh, x, 1.17)
    parts.append(box("mag%d" % i, c, n, 0.072, 0.034, 0.11, M_CLOTH))
    c2 = c + nrm(n) * 0.03 + V((0, 0, 0.05))
    parts.append(box("flap%d" % i, c2 - nrm(n) * 0.026, n, 0.076, 0.012, 0.035, M_CLOTH, bevel=0.004))
    parts.append(box("snap%d" % i, c2 + nrm(n) * 0.002 - V((0, 0, 0.01)), n, 0.014, 0.006, 0.01, M_METAL, bevel=0.002))
c, n = surf(gear_bvh, 0.125, 1.33)
parts.append(box("radio", c, n, 0.05, 0.04, 0.10, M_CLOTH))
parts.append(box("antenna", c + V((0.012, 0, 0.11)) + nrm(n) * 0.02, n, 0.008, 0.008, 0.12, M_METAL, bevel=0.002))
for s in (-1, 1):
    dirv = nrm(V((s * 1.0, 0.35, 0)))
    o = V((s * 0.0, 0, 0.96)) + dirv * 0.6
    hit = belt_bvh.ray_cast(o, -dirv, 2.0)
    if hit[0] is not None:
        parts.append(box("beltpouch%d" % (s > 0), hit[0], hit[1], 0.075, 0.04, 0.075, M_CLOTH))
c, n = surf(belt_bvh, 0.0, 0.962)
parts.append(box("buckle", c, n, 0.065, 0.012, 0.045, M_METAL, bevel=0.003))
for s in (-1, 1):  # shoulder strap buckles
    c, n = surf(gear_bvh, s * 0.12, 1.43)
    parts.append(box("strapbuckle%d" % (s > 0), c, n, 0.03, 0.008, 0.02, M_METAL, bevel=0.002))
set_active(parts[0])
for p in parts[1:]:
    p.select_set(True)
bpy.ops.object.join()
GEAR = bpy.context.view_layer.objects.active
GEAR.name = "Hero_Gear"; GEAR.data.name = "Hero_Gear"
log("gear tris", tri_count(GEAR))

# patch (cheese-wedge insignia, no real-world insignia)
c, n = surf(gear_bvh, -0.115, 1.345)
n = nrm(n); zax = orth(V((0, 0, 1)), n); xax = n.cross(zax)
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
W_, H_ = 0.07, 0.06
vs = [bm.verts.new(c + n * 0.004 + xax * (u - 0.5) * W_ + zax * (v - 0.5) * H_) for u, v in ((0, 0), (1, 0), (1, 1), (0, 1))]
f = bm.faces.new(vs)
for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    l[uvl].uv = uv
me = bpy.data.meshes.new("Hero_Patch"); bm.to_mesh(me); bm.free()
me.materials.append(M_EMBLEM)
PATCH = link(bpy.data.objects.new("Hero_Patch", me))
log("gear done")

# --------------------------------------------------------------------------- UVs


def smart_uv(ob, margin):
    set_active(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


smart_uv(BODY, 0.002)
smart_uv(GEAR, 0.003)
uv_area = 0.0
for p in BODY.data.polygons:
    pass
log("uv done")

# --------------------------------------------------------------------------- weights


def weight_body():
    set_active(ARM)
    for b in arm_data.bones:
        b.use_deform = b.name not in NODEFORM and not b.name.endswith("Eye")
    BODY.select_set(True)
    set_active(BODY); ARM.select_set(True); bpy.context.view_layer.objects.active = ARM
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for b in arm_data.bones:
        b.use_deform = b.name not in NODEFORM


weight_body()
log("auto weights done")
DEF_BONES = [b.name for b in arm_data.bones if b.use_deform and not b.name.endswith("Eye")]
SEGS = {n: (J[n][0], J[n][1]) for n in DEF_BONES}


def fallback_weights(p):
    ds = sorted(((seg_dist(p, a, b), n) for n, (a, b) in SEGS.items()))[:2]
    w0 = 1 / max(ds[0][0], 1e-4) ** 4; w1 = 1 / max(ds[1][0], 1e-4) ** 4
    return {ds[0][1]: w0 / (w0 + w1), ds[1][1]: w1 / (w0 + w1)}


def clean_weights(ob, limit=4):
    gi = {g.index: g.name for g in ob.vertex_groups}
    fixed = 0
    table = []
    for v in ob.data.vertices:
        ws = {gi[g.group]: g.weight for g in v.groups if g.weight > 1e-4 and gi[g.group] in SEGS}
        if sum(ws.values()) < 1e-3:
            ws = fallback_weights(v.co); fixed += 1
        top = sorted(ws.items(), key=lambda kv: -kv[1])[:limit]
        tot = sum(w for _, w in top)
        table.append([(n, w / tot) for n, w in top])
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    groups = {n: ob.vertex_groups.new(name=n) for n in DEF_BONES}
    for v, ws in zip(ob.data.vertices, table):
        for n, w in ws:
            groups[n].add([v.index], w, "REPLACE")
    return fixed


log("body fallback-weighted verts", clean_weights(BODY))


def transfer_weights(dst, src, k=4):
    kd = KDTree(len(src.data.vertices))
    for v in src.data.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    gi = {g.index: g.name for g in src.vertex_groups}
    srcw = [{gi[g.group]: g.weight for g in v.groups} for v in src.data.vertices]
    for g in list(dst.vertex_groups):
        dst.vertex_groups.remove(g)
    groups = {n: dst.vertex_groups.new(name=n) for n in DEF_BONES}
    for v in dst.data.vertices:
        acc = {}
        for co, idx, d in kd.find_n(v.co, k):
            wt = 1.0 / max(d, 1e-4) ** 2
            for n, w in srcw[idx].items():
                acc[n] = acc.get(n, 0.0) + w * wt
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(w for _, w in top) or 1.0
        for n, w in top:
            groups[n].add([v.index], w / tot, "REPLACE")


def bind(ob):
    ob.parent = ARM
    m = ob.modifiers.new("Armature", "ARMATURE"); m.object = ARM


def rigid(ob, rules):
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    groups = {}
    for v in ob.data.vertices:
        n = rules(v.co)
        if n not in groups:
            groups[n] = ob.vertex_groups.new(name=n)
        groups[n].add([v.index], 1.0, "REPLACE")


transfer_weights(GEAR, BODY); bind(GEAR)
transfer_weights(PATCH, BODY); bind(PATCH)
rigid(EYES, lambda p: "LeftEye" if p.x < 0 else "RightEye"); bind(EYES)
rigid(EYES1, lambda p: "LeftEye" if p.x < 0 else "RightEye"); bind(EYES1)
rigid(WHISK, lambda p: "Head"); bind(WHISK)
log("weights done")

# --------------------------------------------------------------------------- textures (baked)
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 4
scene.render.bake.margin = 6


def new_img(name, size, noncolor=False):
    img = bpy.data.images.get(name) or bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    return img


class NT:
    def __init__(self, m):
        self.m = m; self.t = m.node_tree; self.t.nodes.clear()
        self.out = self.n("ShaderNodeOutputMaterial", (900, 0))

    def n(self, typ, loc=(0, 0), **kw):
        nd = self.t.nodes.new(typ); nd.location = loc
        for k, v in kw.items():
            if k.startswith("in_"):
                nd.inputs[k[3:].replace("_", " ")].default_value = v
            else:
                setattr(nd, k, v)
        return nd

    def l(self, a, ai, b, bi):
        self.t.links.new(a.outputs[ai], b.inputs[bi])

    def math(self, op, a, b=None, val=None):
        nd = self.n("ShaderNodeMath", operation=op)
        for i, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                nd.inputs[i].default_value = x
            else:
                self.t.links.new(x, nd.inputs[i])
        return nd.outputs[0]

    def mix(self, a, b, fac):
        nd = self.n("ShaderNodeMix", data_type="RGBA")
        for sock, x in ((6, a), (7, b), (0, fac)):
            if isinstance(x, (tuple, list)):
                nd.inputs[sock].default_value = x
            elif isinstance(x, (int, float)):
                nd.inputs[sock].default_value = x
            else:
                self.t.links.new(x, nd.inputs[sock])
        return nd.outputs[2]

    def emit(self, col):
        em = self.n("ShaderNodeEmission", (700, 0))
        if isinstance(col, tuple):
            em.inputs[0].default_value = col
        else:
            self.t.links.new(col, em.inputs[0])
        self.t.links.new(em.outputs[0], self.out.inputs[0])

    def target(self, img):
        tx = self.n("ShaderNodeTexImage", (700, 300)); tx.image = img
        self.t.nodes.active = tx
        return tx


def lin(c):
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (1.0,)


def tabby_tree(m, img):
    t = NT(m)
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ"); t.l(tc, "Object", sep, 0)
    reg = t.n("ShaderNodeAttribute", attribute_name="region")
    rsep = t.n("ShaderNodeSeparateColor"); t.l(reg, "Color", rsep, 0)
    nz = t.n("ShaderNodeTexNoise", in_Scale=3.5, in_Detail=3.0); t.l(tc, "Object", nz, 0)
    nz2 = t.n("ShaderNodeTexNoise", in_Scale=7.0, in_Detail=2.0); t.l(tc, "Object", nz2, 0)
    nzf = t.n("ShaderNodeTexNoise", in_Scale=60.0, in_Detail=4.0); t.l(tc, "Object", nzf, 0)
    dist = t.math("SUBTRACT", nz.outputs["Fac"], 0.5)

    def stripes(coord, freq, amp, width):
        ph = t.math("ADD", t.math("MULTIPLY", coord, freq), t.math("MULTIPLY", dist, amp))
        s = t.math("SINE", ph)
        mr = t.n("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
        mr.inputs[1].default_value = width; mr.inputs[2].default_value = width + 0.35
        t.t.links.new(s, mr.inputs[0])
        return mr.outputs[0]
    s_body = stripes(sep.outputs[2], 2 * math.pi / 0.085, 16.0, 0.45)
    s_tail = stripes(sep.outputs[1], 2 * math.pi / 0.09, 8.0, 0.25)
    s_head = stripes(sep.outputs[0], 2 * math.pi / 0.035, 3.0, 0.35)
    s = t.mix(s_body, s_tail, rsep.outputs[1])
    s = t.mix(s, s_head, rsep.outputs[2])
    sfac = t.n("ShaderNodeSeparateColor"); t.t.links.new(s, sfac.inputs[0])
    brk = t.n("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP"); brk.inputs[1].default_value = 0.42; brk.inputs[2].default_value = 0.62
    t.l(nz2, "Fac", brk, 0)
    sval = t.math("MULTIPLY", sfac.outputs[0], t.math("ADD", t.math("MULTIPLY", brk.outputs[0], 0.55), 0.45))
    base = t.mix(lin((0.84, 0.40, 0.09)), lin((0.93, 0.55, 0.20)), nz2.outputs["Fac"])
    base = t.mix(base, lin((0.60, 0.24, 0.05)), t.math("MULTIPLY", sval, 0.85))
    base = t.mix(base, lin((0.97, 0.86, 0.68)), rsep.outputs[0])
    fine = t.math("ADD", t.math("MULTIPLY", nzf.outputs["Fac"], 0.35), 0.82)
    bc = t.n("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY"); bc.inputs[0].default_value = 1.0
    t.t.links.new(base, bc.inputs[6]); t.t.links.new(fine, bc.inputs[7])
    t.emit(bc.outputs[2])
    t.target(img)


def flat_tree(m, img, color, grain=0.15, scale=80.0):
    t = NT(m)
    tc = t.n("ShaderNodeTexCoord")
    nz = t.n("ShaderNodeTexNoise", in_Scale=scale, in_Detail=4.0); t.l(tc, "Object", nz, 0)
    c = t.mix(lin(color), tuple(x * (1 - grain) for x in lin(color)[:3]) + (1.0,), nz.outputs["Fac"])
    t.emit(c)
    t.target(img)


def attr_tree(m, img, attr):
    t = NT(m)
    a = t.n("ShaderNodeAttribute", attribute_name=attr)
    t.l(a, "Color", t.n("ShaderNodeEmission", (700, 0)), 0)
    em = t.t.nodes[-1]; t.l(em, 0, t.out, 0)
    t.target(img)


def gear_bake_tree(m, img, kind):
    t = NT(m)
    tc = t.n("ShaderNodeTexCoord")
    sep = t.n("ShaderNodeSeparateXYZ"); t.l(tc, "Object", sep, 0)
    nz = t.n("ShaderNodeTexNoise", in_Scale=12.0, in_Detail=6.0); t.l(tc, "Object", nz, 0)
    nzf = t.n("ShaderNodeTexNoise", in_Scale=350.0, in_Detail=2.0); t.l(tc, "Object", nzf, 0)
    if kind == "cloth":
        webs = t.math("SINE", t.math("MULTIPLY", sep.outputs[2], 2 * math.pi / 0.026))
        mr = t.n("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP"); mr.inputs[1].default_value = 0.2; mr.inputs[2].default_value = 0.6
        t.t.links.new(webs, mr.inputs[0])
        col = t.mix(lin((0.40, 0.37, 0.26)), lin((0.30, 0.28, 0.19)), nz.outputs["Fac"])
        col = t.mix(col, lin((0.25, 0.23, 0.16)), t.math("MULTIPLY", mr.outputs[0], 0.5))
        h = t.math("ADD", t.math("MULTIPLY", mr.outputs[0], 1.0), t.math("MULTIPLY", nzf.outputs["Fac"], 0.6))
        strength = 0.6
    elif kind == "leather":
        col = t.mix(lin((0.30, 0.17, 0.09)), lin((0.18, 0.10, 0.05)), nz.outputs["Fac"])
        h = t.math("MULTIPLY", nzf.outputs["Fac"], 1.0); strength = 0.35
    else:
        col = t.mix(lin((0.22, 0.22, 0.21)), lin((0.12, 0.12, 0.12)), nz.outputs["Fac"])
        h = t.math("MULTIPLY", nzf.outputs["Fac"], 0.5); strength = 0.2
    bump = t.n("ShaderNodeBump", in_Strength=strength, in_Distance=0.002); t.t.links.new(h, bump.inputs["Height"])
    bs = t.n("ShaderNodeBsdfPrincipled")
    t.t.links.new(col, bs.inputs["Base Color"]); t.l(bump, 0, bs, "Normal")
    em = t.n("ShaderNodeEmission"); t.t.links.new(col, em.inputs[0])
    t.m["_bsdf"] = bs.name; t.m["_emit"] = em.name
    t.l(em, 0, t.out, 0)
    t.target(img)
    return t


def bake(ob, typ):
    set_active(ob)
    kw = dict(type=typ, margin=6, use_clear=True)
    if typ == "NORMAL":
        kw.update(normal_space="TANGENT")
    bpy.ops.object.bake(**kw)


def save_img(img, fname):
    img.filepath_raw = os.path.join(MODELS, fname)
    img.file_format = "PNG"
    img.save()


# body albedo + fur length
IMG_BODY = new_img("hero_body_albedo", 2048)
tabby_tree(M_FUR, IMG_BODY)
flat_tree(M_SKIN, IMG_BODY, (0.78, 0.47, 0.45), 0.25, 40.0)
bake(BODY, "EMIT"); save_img(IMG_BODY, "hero_body_albedo.png")
log("baked body albedo")
IMG_FUR = new_img("hero_fur_length", 1024, noncolor=True)
attr_tree(M_FUR, IMG_FUR, "fur_length")
attr_tree(M_SKIN, IMG_FUR, "fur_length")
bake(BODY, "EMIT"); save_img(IMG_FUR, "hero_fur_length.png")
log("baked fur length")
# gear albedo + normal
IMG_GA = new_img("hero_gear_albedo", 1024)
IMG_GN = new_img("hero_gear_normal", 1024, noncolor=True)
gts = {k: gear_bake_tree(m, IMG_GA, k) for k, m in (("cloth", M_CLOTH), ("leather", M_LEATHER), ("metal", M_METAL))}
bake(GEAR, "EMIT"); save_img(IMG_GA, "hero_gear_albedo.png")
for k, m in (("cloth", M_CLOTH), ("leather", M_LEATHER), ("metal", M_METAL)):
    t = m.node_tree
    t.links.new(t.nodes[m["_bsdf"]].outputs[0], [n for n in t.nodes if n.type == "OUTPUT_MATERIAL"][0].inputs[0])
    [n for n in t.nodes if n.type == "TEX_IMAGE"][0].image = IMG_GN
bake(GEAR, "NORMAL"); save_img(IMG_GN, "hero_gear_normal.png")
log("baked gear")

# eye + emblem textures (computed directly)


def pix_img(name, size, fn, noncolor=False):
    img = new_img(name, size, noncolor)
    px = [0.0] * (size * size * 4)
    for j in range(size):
        v = (j + 0.5) / size
        for i in range(size):
            u = (i + 0.5) / size
            r, g, b = fn(u, v)
            k = (j * size + i) * 4
            px[k], px[k + 1], px[k + 2], px[k + 3] = r, g, b, 1.0
    img.pixels.foreach_set(px)
    save_img(img, name + ".png")
    return img


def eye_fn(u, v):
    a, b = (u - 0.5) * 2, (v - 0.5) * 2
    r = math.hypot(a, b)
    if r > 0.78:
        return lin((0.55, 0.42, 0.20))[:3]
    if r > 0.70:
        return lin((0.10, 0.07, 0.03))[:3]
    ang = math.atan2(b, a)
    streak = 0.5 + 0.5 * math.sin(ang * 23 + r * 9)
    c0, c1 = (0.95, 0.70, 0.18), (0.55, 0.62, 0.20)
    t = smooth(r / 0.7)
    col = [lerp(c0[i], c1[i], t * 0.6) * (0.85 + 0.15 * streak) for i in range(3)]
    slit_w = 0.11 * math.sqrt(max(0.0, 1 - (b / 0.62) ** 2))
    if abs(a) < slit_w:
        return (0.005, 0.004, 0.003)
    return lin(tuple(col))[:3]


def emblem_fn(u, v):
    x, y = u, v
    bg = (0.30, 0.31, 0.20)
    if min(x, y, 1 - x, 1 - y) < 0.06:
        return lin((0.17, 0.17, 0.11))[:3]          # stitched border
    if min(x, y, 1 - x, 1 - y) < 0.075 and int((x + y) * 60) % 2 == 0:
        return lin((0.62, 0.58, 0.40))[:3]          # stitching
    # cheese wedge: triangle (0.18,0.25)-(0.82,0.25)-(0.82,0.78), with a rind band and holes
    inside = 0.18 <= x <= 0.82 and 0.25 <= y <= 0.78 and (y - 0.25) <= (x - 0.18) * (0.53 / 0.64)
    edge = 0.16 <= x <= 0.84 and 0.23 <= y <= 0.80 and (y - 0.23) <= (x - 0.16) * (0.57 / 0.68) + 0.02
    if inside:
        for hx, hy, hr in ((0.66, 0.40, 0.06), (0.52, 0.31, 0.04), (0.75, 0.62, 0.035), (0.42, 0.30, 0.025)):
            if math.hypot(x - hx, y - hy) < hr:
                return lin((0.78, 0.55, 0.10))[:3]
        if y < 0.30:
            return lin((0.92, 0.60, 0.10))[:3]
        return lin((0.98, 0.82, 0.25))[:3]
    if edge:
        return lin((0.05, 0.04, 0.02))[:3]
    return lin(bg)[:3]


IMG_EYE = pix_img("hero_eye_albedo", 256, eye_fn)
IMG_EMB = pix_img("hero_emblem", 256, emblem_fn)
log("pixel textures done")

# --------------------------------------------------------------------------- export materials


def pbr(m, albedo=None, color=None, rough=0.5, metal=0.0, normal=None, sss=0.0, sheen=0.0, spec=0.5):
    t = NT(m)
    bs = t.n("ShaderNodeBsdfPrincipled", (400, 0))
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    if "Subsurface Weight" in bs.inputs:
        bs.inputs["Subsurface Weight"].default_value = sss
    if albedo is not None:
        tx = t.n("ShaderNodeTexImage", (0, 200)); tx.image = albedo
        t.l(tx, 0, bs, "Base Color")
    elif color is not None:
        bs.inputs["Base Color"].default_value = lin(color)
    if normal is not None:
        tn = t.n("ShaderNodeTexImage", (0, -200)); tn.image = normal
        nm = t.n("ShaderNodeNormalMap", (200, -200))
        t.l(tn, 0, nm, "Color"); t.l(nm, 0, bs, "Normal")
    t.l(bs, 0, t.out, 0)


pbr(M_FUR, albedo=IMG_BODY, rough=0.72)
pbr(M_SKIN, albedo=IMG_BODY, rough=0.45, sss=0.25)
pbr(M_CLOTH, albedo=IMG_GA, normal=IMG_GN, rough=0.88)
pbr(M_LEATHER, albedo=IMG_GA, normal=IMG_GN, rough=0.55)
pbr(M_METAL, albedo=IMG_GA, normal=IMG_GN, rough=0.35, metal=1.0)
pbr(M_EMBLEM, albedo=IMG_EMB, rough=0.8)
pbr(mat("eye"), albedo=IMG_EYE, rough=0.05)
pbr(mat("whisker"), color=(0.92, 0.90, 0.84), rough=0.4)
log("materials done")

# --------------------------------------------------------------------------- LOD1


def lod_copy(ob, name, target):
    c = ob.copy(); c.data = ob.data.copy(); c.name = name; c.data.name = name; link(c)
    c.modifiers.clear()
    d = c.modifiers.new("dec", "DECIMATE"); d.ratio = min(1.0, target / tri_count(c)); d.use_collapse_triangulate = True
    apply_mods(c)
    bind(c)
    return c


BODY1 = lod_copy(BODY, "Hero_Body_LOD1", 11000)
GEAR1 = lod_copy(GEAR, "Hero_Gear_LOD1", 3300)
PATCH1 = PATCH.copy(); PATCH1.data = PATCH.data.copy(); PATCH1.name = "Hero_Patch_LOD1"; link(PATCH1)
BODY.data.name = "Hero_Body"
LOD0 = [BODY, GEAR, PATCH, EYES, WHISK]
LOD1 = [BODY1, GEAR1, PATCH1, EYES1]
for ob in LOD0 + LOD1:
    if ob.parent != ARM:
        ob.parent = ARM
    if not any(m.type == "ARMATURE" for m in ob.modifiers):
        m = ob.modifiers.new("Armature", "ARMATURE"); m.object = ARM
TRIS0 = sum(tri_count(o) for o in LOD0)
TRIS1 = sum(tri_count(o) for o in LOD1)
log("LOD0 tris", TRIS0, "LOD1 tris", TRIS1)

# --------------------------------------------------------------------------- animation: pose builder
B = {n: arm_data.bones[n] for n in J}
HEAD_OF = {n: J[n][0] for n in J}
TAIL_OF = {n: J[n][1] for n in J}


def ik2(S, E0, W0, T, pole):
    L1, L2 = (E0 - S).length, (W0 - E0).length
    d = T - S
    dist = max(1e-4, min(d.length, (L1 + L2) * 0.999, ))
    dist = max(dist, abs(L1 - L2) + 1e-3)
    dn = nrm(d)
    ca = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist)
    sa = math.sqrt(max(0.0, 1 - ca * ca))
    p = orth(pole, dn)
    E = S + (dn * ca + p * sa) * L1
    Tc = S + dn * dist
    n0 = nrm((E0 - S).cross(W0 - E0))
    n1 = nrm((E - S).cross(Tc - E))
    Q1 = align_q(E0 - S, n0, E - S, n1)
    Q2 = align_q(W0 - E0, n0, Tc - E, n1)
    return Q1, Q2


def hand_rest(side):
    h = HAND[side]; return h["d0"], h["n0"]


def solve_arm(side, Qd, target, hdir, hnorm, pole, shrug=None):
    sh = side + "Shoulder"
    qsh = shrug if shrug is not None else Quaternion()
    Qd[sh] = qsh
    Hs = HEAD_OF[sh]
    inv = qsh.inverted()
    T = Hs + inv @ (V(target) - Hs)
    S, E0, W0 = HEAD_OF[side + "UpperArm"], HEAD_OF[side + "LowerArm"], HEAD_OF[side + "Hand"]
    Q1, Q2 = ik2(S, E0, W0, T, inv @ V(pole))
    d0, n0 = hand_rest(side)
    Q3 = align_q(d0, n0, inv @ V(hdir), inv @ V(hnorm))
    Qd[side + "UpperArm"] = Q1
    Qd[side + "LowerArm"] = Q1.inverted() @ Q2
    Qd[side + "Hand"] = Q2.inverted() @ Q3


def solve_leg(side, Qd, qh, hips_pos, ball, heel_up=0.0, toes_flat=True, yaw=0.0):
    H0 = HEAD_OF["Hips"]
    inv = qh.inverted()
    Fw = E(0, 0, yaw) @ E(-heel_up, 0, 0)
    hock_w = V(ball) + Fw @ (HEAD_OF[side + "Foot"] - HEAD_OF[side + "Toes"])
    T = H0 + inv @ (hock_w - hips_pos)
    S, E0, W0 = HEAD_OF[side + "UpperLeg"], HEAD_OF[side + "LowerLeg"], HEAD_OF[side + "Foot"]
    s = -1 if side == "Left" else 1
    Q1, Q2 = ik2(S, E0, W0, T, V((s * 0.12, 1, 0)))
    Fh = inv @ Fw
    Qd[side + "UpperLeg"] = Q1
    Qd[side + "LowerLeg"] = Q1.inverted() @ Q2
    Qd[side + "Foot"] = Q2.inverted() @ Fh
    Tw = E(0, 0, yaw) if toes_flat and V(ball).z < 0.06 else Fw
    Qd[side + "Toes"] = Fh.inverted() @ (inv @ Tw)


FINGERS = ("Index", "Middle", "Ring", "Little")


def fingers(side, Qd, curl, spread=0.0, thumb=None):
    h = HAND[side]
    ax = h["curl"]
    for k, f in enumerate(FINGERS):
        sp = (1.5 - k) * spread
        for j, seg in enumerate(("Proximal", "Intermediate", "Distal")):
            amt = curl * (65, 80, 55)[j]
            q = Quaternion(ax, math.radians(amt))
            if j == 0 and sp:
                q = q @ Quaternion(h["n0"], math.radians(sp * (1 if side == "Right" else -1)))
            Qd[side + f + seg] = q
    tc = curl if thumb is None else thumb
    tax = nrm(h["t0"].cross(h["n0"]))
    for j, seg in enumerate(("Metacarpal", "Proximal", "Distal")):
        Qd[side + "Thumb" + seg] = Quaternion(tax, math.radians(tc * (25, 40, 45)[j]))


# gun-frame hand placements (gun frame: +Y muzzle, +Z up, +X right)
GUN = {
    "rifle": dict(R=(V((0, 0, 0)), V((0, 0.55, -0.83)), V((-1, 0, 0))),
                  L=(V((-0.005, 0.25, -0.03)), V((0.55, 0.83, 0.05)), V((0.2, 0, 1)))),
    "pistol": dict(R=(V((0, 0, 0)), V((0, 0.55, -0.83)), V((-1, 0, 0))),
                   L=(V((-0.03, 0.0, -0.02)), V((0.35, 0.6, -0.7)), V((1, 0, 0.1)))),
}
PLACE = {  # grip position in chest frame + gun orientation (pitch, roll, yaw) degrees
    "aim": (V((0.10, 0.22, 1.40)), (0, 0, 8)),
    "low": (V((0.12, 0.17, 1.24)), (-32, 0, 18)),
    "pistol": (V((0.04, 0.47, 1.40)), (0, 0, 2)),
    "port": (V((0.10, 0.20, 1.30)), (60, 0, 45)),
    "reload": (V((0.10, 0.22, 1.30)), (-12, -25, 15)),
}


def gun_targets(kind, place, recoil=0.0, extra=None):
    pos, (p, r, y) = PLACE[place] if isinstance(place, str) else place
    p += recoil * 9
    R = E(0, 0, y) @ E(p, 0, 0) @ E(0, r, 0)
    pos = V(pos) + R @ V((0, -0.035 * recoil, 0.01 * recoil))
    out = {}
    for side in ("R", "L"):
        o, dv, nv = GUN[kind][side]
        out[side] = (pos + R @ o, R @ dv, R @ nv)
    return out


def build(P):
    """P: pose params -> (dict bone -> local quaternion, hips local offset)."""
    Qd = {n: Quaternion() for n in J}
    hips_off = V(P.get("hips", (0, 0, 0)))
    qh = E(*P.get("hips_rot", (0, 0, 0)))
    Qd["Hips"] = qh
    sp = P.get("spine", (0, 0, 0))
    for n, f in (("Spine", 0.3), ("Chest", 0.35), ("UpperChest", 0.35)):
        Qd[n] = E(sp[0] * f, sp[1] * f, sp[2] * f)
    nk, hd = P.get("neck", (0, 0, 0)), P.get("head", (0, 0, 0))  # +X = nod down
    Qd["Neck"] = E(-nk[0], nk[1], nk[2])
    Qd["Head"] = E(-hd[0], hd[1], hd[2])
    Qd["Jaw"] = E(-P.get("jaw", 0.0), 0, 0)
    # arms
    hands = P.get("hands")
    if hands:
        for side, key in (("Right", "R"), ("Left", "L")):
            if key in hands:
                tgt, dv, nv = hands[key]
                pole = P.get("pole_" + key, V(((1 if key == "R" else -1) * 0.45, -0.35, -1)))
                solve_arm(side, Qd, tgt, dv, nv, pole, P.get("shrug_" + key))
    for side, key in (("Right", "R"), ("Left", "L")):
        c = P.get("curl_" + key, 0.75)
        fingers(side, Qd, c, P.get("spread_" + key, 0.0), P.get("thumb_" + key))
    # legs
    hips_pos = HEAD_OF["Hips"] + hips_off
    if "legs_fk" in P:
        for n, e in P["legs_fk"].items():
            Qd[n] = E(*e)
    else:
        for side, key in (("Left", "L"), ("Right", "R")):
            s = -1 if side == "Left" else 1
            ball, heel, flat = P.get("foot_" + key, ((s * 0.13, 0.09, 0.035), 0.0, True))
            solve_leg(side, Qd, qh, hips_pos, ball, heel, flat, P.get("foot_yaw_" + key, 0.0))
    # tail: list of eulers per segment (base elevation + sway)
    tl = P.get("tail", [(0, 0, 0)] * 6)
    for i in range(6):
        Qd["Tail%d" % (i + 1)] = E(*tl[i])
    for side, key in (("Left", "L"), ("Right", "R")):
        Qd[side + "Ear"] = E(*P.get("ear_" + key, (0, 0, 0)))
    loc = {}
    out = {}
    for n in J:
        R = REST[n]
        out[n] = R.inverted() @ Qd[n] @ R
    loc["Hips"] = REST["Hips"].inverted() @ hips_off
    return out, loc


# --------------------------------------------------------------------------- clip definitions
def tail_wave(t, amp=8.0, freq=0.5, lift=0.0, curl=0.0):
    return [(-lift / (i + 1) - curl * (i / 5), 0, amp * math.sin(2 * math.pi * freq * t - i * 0.7) * (0.4 + i * 0.15)) for i in range(6)]


def base(t, place="low", kind="rifle", recoil=0.0, breathe=1.0):
    g = gun_targets(kind, place, recoil)
    br = math.sin(2 * math.pi * t / 2.0) * breathe
    return {
        "hips": (0, 0, -0.01 + 0.004 * br), "spine": (-3 - 1.2 * br, 0, 0), "neck": (2, 0, 0), "head": (-2 + 0.8 * br, 0, 0),
        "hands": g, "curl_R": 0.85, "curl_L": 0.7, "thumb_L": 0.4,
        "tail": tail_wave(t, 6, 0.5, 8, -6), "ear_L": (0, 0, 0), "ear_R": (0, 0, 0),
    }


def gait(t, period, stance, stride, lift, bob, lean, place="low", kind="rifle", heel=25.0, crouch=0.0, yf=0.04, arms_free=False):
    ph = (t / period) % 1.0
    P = base(t, place, kind, breathe=0.3)
    for key, s, off in (("L", -1, 0.0), ("R", 1, 0.5)):
        u = (ph + off) % 1.0
        if u < stance:
            w = u / stance
            y = stride / 2 - stride * w
            z = 0.035
            hu = heel * smooth((w - 0.55) / 0.45) * 0.8
        else:
            w = (u - stance) / (1 - stance)
            y = -stride / 2 + stride * smooth(w)
            z = 0.035 + lift * math.sin(math.pi * w)
            hu = heel * (1 - w) * 0.9
        P["foot_" + key] = ((s * 0.125, 0.09 + yf + y, z), hu, True)
    P["hips"] = (0.012 * math.sin(2 * math.pi * ph), 0, -0.03 - crouch + bob * math.cos(4 * math.pi * ph))
    P["hips_rot"] = (-lean * 0.4, 2 * math.sin(2 * math.pi * ph), 5 * math.sin(2 * math.pi * ph))
    P["spine"] = (-lean * 0.6 - 3, 0, -5 * math.sin(2 * math.pi * ph))
    P["head"] = (lean * 0.5, 0, 0)
    P["tail"] = tail_wave(t, 10, 1 / period, 10, -4)
    return P, ph


def crouch_pose(t, P):
    P["hips"] = (0, -0.02, -0.33)
    P["hips_rot"] = (-14, 0, 0)
    P["spine"] = (-14, 0, 0)
    P["head"] = (18, 0, 0)
    P["foot_L"] = ((-0.15, 0.20, 0.035), 5.0, True)
    P["foot_R"] = ((0.15, -0.16, 0.035), 40.0, True)
    return P


def clip_idle(t):
    P = base(t)
    P["foot_L"] = ((-0.14, 0.11, 0.035), 0.0, True); P["foot_R"] = ((0.14, 0.05, 0.035), 0.0, True)
    P["foot_yaw_L"] = 8; P["foot_yaw_R"] = -10
    tw = smooth((t - 1.2) / 0.08) * (1 - smooth((t - 1.35) / 0.1))
    P["ear_R"] = (12 * tw, 0, -15 * tw)
    P["head"] = (-2, 0, 3 * math.sin(2 * math.pi * t / 2.0))
    return P


def clip_walk(t):
    return gait(t, 1.0, 0.6, 0.6, 0.07, 0.012, 4)[0]


def clip_run(t):
    return gait(t, 0.66, 0.42, 0.82, 0.14, 0.025, 14, heel=35)[0]


def clip_sprint(t):
    P, ph = gait(t, 0.56, 0.36, 0.98, 0.18, 0.03, 22, place="port", heel=40, yf=0.07)
    sw = math.sin(2 * math.pi * ph)
    # left arm pumps free; right keeps the weapon at port arms
    P["hands"] = {"R": P["hands"]["R"],
                  "L": (V((-0.2, 0.12 + 0.22 * sw, 1.18 + 0.08 * max(0, sw))), V((0, 0.6, -0.8)), V((0.8, 0, 0)))}
    P["curl_L"] = 0.9
    P["ear_L"] = (35, 0, 0); P["ear_R"] = (35, 0, 0)
    return P


def clip_crouch_idle(t):
    P = crouch_pose(t, base(t, "low"))
    return P


def clip_crouch_walk(t):
    P, ph = gait(t, 1.2, 0.65, 0.5, 0.06, 0.01, 22, crouch=0.30, heel=30)
    P["hips"] = (P["hips"][0], -0.02, P["hips"][2])
    P["head"] = (20, 0, 0)
    return P


def clip_jump(t):
    P = base(t, "low", breathe=0)
    c = smooth(t / 0.12) * (1 - smooth((t - 0.12) / 0.1))
    ext = smooth((t - 0.12) / 0.12)
    tuck = smooth((t - 0.28) / 0.17)
    P["hips"] = (0, 0, -0.14 * c + 0.03 * ext * (1 - tuck))
    P["hips_rot"] = (-10 * c, 0, 0)
    P["spine"] = (-10 * c + 4 * ext, 0, 0)
    for key, s in (("L", -1), ("R", 1)):
        P["foot_" + key] = ((s * 0.13, 0.09 + 0.04 * tuck, 0.035 + 0.22 * tuck + (0.06 * ext * (1 - tuck))), 45 * ext * (1 - tuck) + 15 * tuck, False)
    P["tail"] = tail_wave(t, 4, 1, 10 + 25 * tuck)
    P["ear_L"] = (20 * tuck, 0, 0); P["ear_R"] = (20 * tuck, 0, 0)
    return P


def clip_fall(t):
    P = base(t, "low", breathe=0)
    k = math.sin(2 * math.pi * t / 0.8)
    P["hips"] = (0, 0, 0.02)
    P["spine"] = (4, 0, 0)
    P["foot_L"] = ((-0.14, 0.12 + 0.04 * k, 0.18 + 0.04 * k), 25, False)
    P["foot_R"] = ((0.14, 0.04 - 0.04 * k, 0.12 - 0.03 * k), 30, False)
    P["tail"] = tail_wave(t, 15, 1.25, 30)
    P["ear_L"] = (40, 0, 0); P["ear_R"] = (40, 0, 0)
    P["hands"] = gun_targets("rifle", (PLACE["low"][0] + V((0, 0, 0.08)), (-15, 0, 18)))
    return P


def clip_land(t):
    P = base(t, "low", breathe=0)
    c = smooth(t / 0.07) * (1 - smooth((t - 0.1) / 0.32))
    P["hips"] = (0, -0.02 * c, -0.01 - 0.22 * c)
    P["hips_rot"] = (-14 * c, 0, 0)
    P["spine"] = (-3 - 14 * c, 0, 0)
    P["head"] = (12 * c, 0, 0)
    P["foot_L"] = ((-0.15, 0.11, 0.035), 0, True); P["foot_R"] = ((0.15, 0.07, 0.035), 0, True)
    P["tail"] = tail_wave(t, 4, 1, 10 - 15 * c)
    return P


def clip_aim_idle(t):
    P = base(t, "aim", breathe=0.5)
    P["spine"] = (-2, 0, 0); P["head"] = (8, 0, -4); P["neck"] = (4, 0, 0)
    P["foot_L"] = ((-0.15, 0.16, 0.035), 0, True); P["foot_R"] = ((0.15, -0.02, 0.035), 10, True)
    P["foot_yaw_L"] = 5; P["foot_yaw_R"] = -20
    P["curl_L"] = 0.75
    P["ear_L"] = (-6, 0, 0); P["ear_R"] = (-6, 0, 0)
    return P


def clip_aim_walk(t):
    P, ph = gait(t, 1.0, 0.6, 0.5, 0.06, 0.008, 4, place="aim")
    P["spine"] = (-2, 0, -2 * math.sin(2 * math.pi * ph))  # keep the gun steady
    P["hips_rot"] = (0, 1, 3 * math.sin(2 * math.pi * ph))
    P["head"] = (8, 0, -4); P["neck"] = (4, 0, 0)
    return P


def clip_fire_pistol(t):
    r = math.exp(-t / 0.05) * smooth(t / 0.015)
    P = base(t, "pistol", "pistol", recoil=r * 1.4, breathe=0)
    P["spine"] = (-2 + 2.5 * r, 0, 0); P["head"] = (6, 0, 0)
    P["foot_L"] = ((-0.15, 0.13, 0.035), 0, True); P["foot_R"] = ((0.15, 0.0, 0.035), 8, True)
    P["curl_L"] = 0.8
    return P


def clip_fire_rifle(t):
    r = math.exp(-t / 0.04) * smooth(t / 0.012)
    P = clip_aim_idle(0)
    P["hands"] = gun_targets("rifle", "aim", recoil=r)
    P["spine"] = (-2 + 3 * r, 0, 1.5 * r)
    P["head"] = (8 - 2 * r, 0, -4)
    return P


def clip_reload(t):
    P = clip_aim_idle(0)
    g = gun_targets("rifle", "reload")
    magwell = g["R"][0] + V((-0.02, 0.10, -0.06))
    pouch = V((-0.13, 0.17, 1.12))
    keys = [(0.0, g["L"][0]), (0.3, magwell), (0.65, pouch), (1.05, pouch), (1.4, magwell), (1.55, magwell + V((0, 0, 0.035))),
            (1.7, magwell), (2.0, g["L"][0])]
    for (ta, pa), (tb, pb) in zip(keys, keys[1:]):
        if ta <= t <= tb:
            pos = pa.lerp(pb, smooth((t - ta) / (tb - ta)))
            break
    else:
        pos = keys[-1][1]
    near_grip = 1 - smooth(t / 0.3) + smooth((t - 1.7) / 0.3)
    dv = g["L"][1].lerp(V((0.2, 0.4, -0.9)), 1 - near_grip).normalized()
    nv = g["L"][2].lerp(V((0.9, 0.1, 0.2)), 1 - near_grip).normalized()
    P["hands"] = {"R": g["R"], "L": (pos, dv, nv)}
    P["head"] = (22 * smooth(t / 0.3) * (1 - smooth((t - 1.6) / 0.3)), 0, 6)
    P["curl_L"] = 0.7 + 0.25 * (1 - near_grip)
    P["tail"] = tail_wave(t, 8, 0.5, 8)
    return P


def clip_melee_slash(t):
    P = base(t, "low", breathe=0)
    wind = smooth(t / 0.22)
    hit = smooth((t - 0.22) / 0.14)
    rec = smooth((t - 0.45) / 0.25)
    a = V((0.38, -0.02, 1.70)); b = V((-0.22, 0.48, 1.08)); rest = V((0.2, 0.28, 1.22))
    pR = V((0.25, 0.25, 1.25)).lerp(a, wind).lerp(b, hit).lerp(rest, rec)
    P["hands"] = {"R": (pR, nrm(V((0.0, 0.4, 1.0)).lerp(V((-0.6, 0.6, -0.4)), hit)), V((-1, 0.2, 0)) if hit < 0.5 else V((0, 0, -1))),
                  "L": (V((-0.22, 0.30, 1.28)), V((0.3, 0.7, -0.4)), V((0.8, 0, 0.2)))}
    P["pole_R"] = V((1, -0.5, -0.4))
    P["curl_R"] = 0.05; P["spread_R"] = 12.0; P["thumb_R"] = 0.1
    P["curl_L"] = 0.5
    P["spine"] = (-6 * hit, 0, -25 * wind * (1 - hit) + 30 * hit * (1 - rec))
    P["hips_rot"] = (0, 0, -10 * wind * (1 - hit) + 12 * hit * (1 - rec))
    P["foot_L"] = ((-0.16, 0.20, 0.035), 0, True); P["foot_R"] = ((0.15, -0.10, 0.035), 20, True)
    P["hips"] = (0, 0.02, -0.05 * hit * (1 - rec))
    P["ear_L"] = (35 * wind * (1 - rec), 0, 0); P["ear_R"] = (35 * wind * (1 - rec), 0, 0)
    P["jaw"] = 18 * hit * (1 - rec)
    return P


def clip_hurt(t):
    P = base(t, "low", breathe=0)
    h = smooth(t / 0.06) * (1 - smooth((t - 0.1) / 0.3))
    P["hands"] = gun_targets("rifle", (PLACE["low"][0] + V((0.02, -0.04, 0.05)) * h, (-32 + 18 * h, 10 * h, 18)))
    P["spine"] = (-3 + 14 * h, 6 * h, -8 * h)
    P["head"] = (-12 * h, 0, 10 * h)
    P["hips"] = (0, -0.03 * h, -0.03 * h)
    P["foot_L"] = ((-0.14, 0.11, 0.035), 0, True); P["foot_R"] = ((0.14, 0.05, 0.035), 0, True)
    P["ear_L"] = (50 * h, 0, 0); P["ear_R"] = (50 * h, 0, 0)
    P["jaw"] = 20 * h
    P["tail"] = tail_wave(t, 4, 1, 8 + 25 * h)
    return P


def lerp_pose(keys, t):
    """keys: list of (time, dict of numeric tuples) -> interpolated dict."""
    if t <= keys[0][0]:
        return dict(keys[0][1])
    for (ta, A), (tb, Bp) in zip(keys, keys[1:]):
        if t <= tb:
            u = smooth((t - ta) / (tb - ta))
            out = {}
            for k in A:
                a, b = A[k], Bp.get(k, A[k])
                if isinstance(a, (int, float)):
                    out[k] = lerp(a, b, u)
                elif isinstance(a, dict):
                    out[k] = {kk: tuple(lerp(x, y, u) for x, y in zip(a[kk], b[kk])) for kk in a}
                elif isinstance(a, list):
                    out[k] = [tuple(lerp(x, y, u) for x, y in zip(aa, bb)) for aa, bb in zip(a, b)]
                else:
                    out[k] = tuple(lerp(x, y, u) for x, y in zip(a, b))
            return out
    return dict(keys[-1][1])


def fk_leg(th, sh, ft, to, side):
    return {side + "UpperLeg": th, side + "LowerLeg": sh, side + "Foot": ft, side + "Toes": to}


def legs(thL, shL, ftL, thR, shR, ftR):
    d = {}
    d.update(fk_leg(thL, shL, ftL, (0, 0, 0), "Left")); d.update(fk_leg(thR, shR, ftR, (0, 0, 0), "Right"))
    return d


ZT = [(0, 0, 0)] * 6
DEATH_A = [
    (0.0, dict(hips=(0, 0, 0), hips_rot=(0, 0, 0), spine=(-3, 0, 0), head=(0, 0, 0), legs_fk=legs((0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0), (0, 0, 0)),
               hR=(0.12, 0.2, 1.22), hL=(0.0, 0.34, 1.10), tail=[(-8, 0, 0)] * 6, ears=(0, 0, 0), jaw=0)),
    (0.25, dict(hips=(0, -0.05, -0.05), hips_rot=(12, 0, 0), spine=(18, 0, 6), head=(-25, 0, 10), legs_fk=legs((10, 0, 0), (-10, 0, 0), (0, 0, 0), (-5, 0, 0), (-25, 0, 0), (10, 0, 0)),
                hR=(0.45, 0.15, 1.55), hL=(-0.42, 0.2, 1.5), tail=[(-25, 0, 5)] * 6, ears=(50, 0, 0), jaw=25)),
    (0.7, dict(hips=(0, -0.35, -0.45), hips_rot=(45, 0, 6), spine=(15, 0, 6), head=(-15, 0, 15), legs_fk=legs((40, 0, 0), (-45, 0, 0), (20, 0, 0), (25, 0, 5), (-60, 0, 0), (20, 0, 0)),
                hR=(0.5, 0.1, 1.6), hL=(-0.5, 0.1, 1.55), tail=[(-5, 0, 10)] * 6, ears=(50, 0, 0), jaw=20)),
    (1.15, dict(hips=(0, -0.62, -0.77), hips_rot=(84, 0, 8), spine=(4, 0, 4), head=(-8, 0, 30), legs_fk=legs((8, 0, -6), (-18, 0, 0), (25, 0, 0), (14, 0, 8), (-30, 0, 0), (25, 0, 0)),
                 hR=(0.55, 0.02, 1.55), hL=(-0.52, 0.12, 1.62), tail=[(2, 0, 12)] * 6, ears=(40, 0, 0), jaw=12)),
    (1.5, dict(hips=(0, -0.62, -0.78), hips_rot=(86, 0, 8), spine=(4, 0, 4), head=(-10, 0, 35), legs_fk=legs((8, 0, -6), (-18, 0, 0), (28, 0, 0), (14, 0, 8), (-30, 0, 0), (28, 0, 0)),
                hR=(0.56, 0.0, 1.55), hL=(-0.53, 0.12, 1.62), tail=[(2, 0, 12)] * 6, ears=(40, 0, 0), jaw=12)),
]
DEATH_B = [
    (0.0, DEATH_A[0][1]),
    (0.35, dict(hips=(0, 0.05, -0.32), hips_rot=(-10, 0, -5), spine=(-25, 0, -8), head=(15, 0, -10), legs_fk=legs((30, 0, 0), (-75, 0, 0), (35, 0, 0), (25, 0, 0), (-70, 0, 0), (30, 0, 0)),
                hR=(0.2, 0.3, 1.1), hL=(-0.18, 0.3, 1.05), tail=[(-5, 0, -5)] * 6, ears=(45, 0, 0), jaw=20)),
    (0.65, dict(hips=(0, 0.12, -0.48), hips_rot=(-15, 0, -5), spine=(-35, 0, -8), head=(20, 0, -10), legs_fk=legs((40, 0, 0), (-110, 0, 0), (40, 0, 0), (35, 0, 0), (-105, 0, 0), (40, 0, 0)),
                hR=(0.25, 0.45, 1.05), hL=(-0.25, 0.45, 1.0), tail=[(5, 0, -5)] * 6, ears=(45, 0, 0), jaw=15)),
    (1.2, dict(hips=(0, 0.35, -0.75), hips_rot=(-82, 0, -10), spine=(-6, 0, -6), head=(-25, 0, -35), legs_fk=legs((-6, 0, 3), (-18, 0, 0), (40, 0, 0), (0, 0, -4), (-30, 0, 0), (45, 0, 0)),
                hR=(0.45, 0.35, 1.45), hL=(-0.42, 0.45, 1.25), tail=[(4, 0, -12)] * 6, ears=(40, 0, 0), jaw=10)),
    (1.6, dict(hips=(0, 0.36, -0.76), hips_rot=(-84, 0, -10), spine=(-6, 0, -6), head=(-28, 0, -38), legs_fk=legs((-6, 0, 3), (-18, 0, 0), (42, 0, 0), (0, 0, -4), (-30, 0, 0), (46, 0, 0)),
                hR=(0.46, 0.35, 1.45), hL=(-0.43, 0.45, 1.25), tail=[(4, 0, -12)] * 6, ears=(40, 0, 0), jaw=10)),
]


def clip_death(keys):
    def f(t):
        K = lerp_pose(keys, t)
        P = {k: K[k] for k in ("hips", "hips_rot", "spine", "head", "legs_fk", "tail", "jaw")}
        P["hands"] = {"R": (V(K["hR"]), V((0.3, 0.5, -0.8)), V((-1, 0, 0))), "L": (V(K["hL"]), V((-0.3, 0.5, -0.8)), V((1, 0, 0)))}
        P["ear_L"] = K["ears"]; P["ear_R"] = K["ears"]
        P["curl_R"] = 0.5; P["curl_L"] = 0.4
        P["pole_R"] = V((0.6, -0.4, -0.7)); P["pole_L"] = V((-0.6, -0.4, -0.7))
        return P
    return f


def clip_victory(t):
    P = base(t, "low", breathe=0)
    pump = 0.5 - 0.5 * math.cos(2 * math.pi * t / 1.2)
    up = smooth(t / 0.3)
    P["hands"] = {"R": (V((0.25, 0.10, 1.25)).lerp(V((0.30, 0.10, 1.95 - 0.12 * pump)), up), V((0, 0.1, 1)), V((-0.2, -1, 0))),
                  "L": (V((-0.36, -0.02, 1.08)), V((0.4, 0.1, -0.9)), V((0.9, 0, 0.2)))}
    P["pole_R"] = V((1, 0, -0.3)); P["pole_L"] = V((-1, -0.6, 0))
    P["curl_R"] = 1.0; P["thumb_R"] = 0.8; P["curl_L"] = 0.6
    P["spine"] = (4 + 2 * pump, 0, -4); P["head"] = (-10, 0, -6); P["jaw"] = 10 * pump
    P["foot_L"] = ((-0.17, 0.10, 0.035), 0, True); P["foot_R"] = ((0.17, 0.06, 0.035), 0, True)
    P["foot_yaw_L"] = 12; P["foot_yaw_R"] = -12
    P["tail"] = [(-25 if i == 0 else 6, 0, 6 * math.sin(2 * math.pi * t / 1.2 - i * 0.6)) for i in range(6)]
    P["ear_L"] = (-10, 0, 0); P["ear_R"] = (-10, 0, 0)
    return P


CLIPS = [  # name, function(t seconds), length seconds, loop
    ("idle", clip_idle, 2.0, True), ("walk", clip_walk, 1.0, True), ("run", clip_run, 0.66, True),
    ("sprint", clip_sprint, 0.56, True), ("crouch_idle", clip_crouch_idle, 2.0, True), ("crouch_walk", clip_crouch_walk, 1.2, True),
    ("jump", clip_jump, 0.45, False), ("fall", clip_fall, 0.8, True), ("land", clip_land, 0.45, False),
    ("aim_idle", clip_aim_idle, 2.0, True), ("aim_walk", clip_aim_walk, 1.0, True), ("fire_pistol", clip_fire_pistol, 0.25, False),
    ("fire_rifle", clip_fire_rifle, 0.2, False), ("reload", clip_reload, 2.0, False), ("melee_slash", clip_melee_slash, 0.7, False),
    ("hurt", clip_hurt, 0.4, False), ("death_a", clip_death(DEATH_A), 1.5, False), ("death_b", clip_death(DEATH_B), 1.6, False),
    ("victory", clip_victory, 2.4, True),
]

ARM.animation_data_create()
ARM.rotation_mode = "QUATERNION"
for pb in ARM.pose.bones:
    pb.rotation_mode = "QUATERNION"
ACTIONS = {}
for name, fn, length, loop in CLIPS:
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ARM.animation_data.action = act
    nfr = max(2, int(round(length * FPS)))
    prev = {}
    for fr in range(nfr + 1):
        t = (fr / FPS) if not loop else (fr / nfr) * length
        if loop and fr == nfr:
            t = 0.0  # exact loop closure
        rots, locs = build(fn(t))
        for pb in ARM.pose.bones:
            q = rots[pb.name]
            if pb.name in prev:
                q.make_compatible(prev[pb.name])
            prev[pb.name] = q
            pb.rotation_quaternion = q
            pb.location = locs.get(pb.name, V((0, 0, 0)))
            pb.keyframe_insert("rotation_quaternion", frame=fr, group=pb.name)
            if pb.name in ("Hips",):
                pb.keyframe_insert("location", frame=fr, group=pb.name)
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, nfr
    act.use_cyclic = loop
    ACTIONS[name] = act
    tr = ARM.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 0, act); tr.mute = True
log("clips", len(ACTIONS))
ARM.animation_data.action = None
for pb in ARM.pose.bones:
    pb.rotation_quaternion = Quaternion(); pb.location = V((0, 0, 0))

# --------------------------------------------------------------------------- export
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SCRATCH, "hero.blend"))
glb = os.path.join(MODELS, "hero.glb")
props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
kw = dict(filepath=glb, export_format="GLB", use_selection=False, export_yup=True, export_apply=False,
          export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_range=False,
          export_skins=True, export_morph=False, export_texcoords=True, export_normals=True, export_tangents=True,
          export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True,
          export_image_format="AUTO", export_extras=False, export_cameras=False, export_lights=False,
          export_optimize_animation_size=False, export_anim_single_armature=True, export_reset_pose_bones=True,
          export_def_bones=False, export_rest_position_armature=True, export_nla_strips=False)
kw = {k: v for k, v in kw.items() if k == "filepath" or k in props}
set_active(ARM)
bpy.ops.export_scene.gltf(**kw)
log("exported", glb, os.path.getsize(glb) // 1024, "KB; LOD0 tris", TRIS0, "LOD1 tris", TRIS1)

# --------------------------------------------------------------------------- previews (optional)


def render_previews():
    import numpy as np
    sc = scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = int(os.environ.get("HERO_SAMPLES", "24"))
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 480, 640
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX" if "AgX" in [x.identifier for x in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    world = bpy.data.worlds.new("w"); sc.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.34, 0.38, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    fl = bpy.context.active_object; fm = mat("floor_preview"); pbr(fm, color=(0.35, 0.33, 0.30), rough=0.8); fl.data.materials.append(fm)
    for nm, loc, en, sz in (("key", (2.5, 3.0, 3.5), 900, 2.0), ("fill", (-3.0, 1.5, 2.0), 300, 3.0), ("rim", (0.5, -3.5, 3.0), 700, 1.5)):
        ld = bpy.data.lights.new(nm, "AREA"); ld.energy = en; ld.size = sz
        lo = link(bpy.data.objects.new(nm, ld)); lo.location = loc
        lo.rotation_euler = (V((0, 0, 1.0)) - V(loc)).to_track_quat("-Z", "Y").to_euler()
    cd = bpy.data.cameras.new("cam"); cd.lens = 55
    cam = link(bpy.data.objects.new("cam", cd)); sc.camera = cam
    for o in LOD1:
        o.hide_render = True

    def shoot(path, yaw, dist=4.3, z=1.0, tz=0.95):
        a = math.radians(yaw)
        cam.location = (math.sin(a) * dist, math.cos(a) * dist, z)
        cam.rotation_euler = (V((0, 0, tz)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        a_ = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
        bpy.data.images.remove(img)
        return a_

    def montage(tiles, cols, path):
        h, w = tiles[0].shape[:2]
        rows = (len(tiles) + cols - 1) // cols
        out = np.ones((rows * h, cols * w, 4), dtype=np.float32)
        for k, t in enumerate(tiles):
            r, c = rows - 1 - k // cols, k % cols
            out[r * h:(r + 1) * h, c * w:(c + 1) * w] = t
        img = bpy.data.images.new("montage", cols * w, rows * h, alpha=False)
        img.pixels.foreach_set(out.ravel()); img.filepath_raw = path; img.file_format = "PNG"; img.save()

    def pose(name, t):
        act = ACTIONS[name]
        ARM.animation_data.action = act
        if hasattr(ARM.animation_data, "action_slot") and len(getattr(act, "slots", [])):
            ARM.animation_data.action_slot = act.slots[0]
        sc.frame_set(int(round(t * FPS)))

    tmp = os.path.join(SCRATCH, "tiles"); os.makedirs(tmp, exist_ok=True)
    pose("idle", 0.0)
    tiles = [shoot(os.path.join(tmp, "turn_%03d.png" % y), y) for y in (0, 45, 90, 180, 270)]
    montage(tiles, 5, os.path.join(PREV, "turntable.png"))
    shots = [("aim_idle", 0.0, 30), ("walk", 0.25, 70), ("run", 0.15, 70), ("sprint", 0.2, 70), ("crouch_idle", 0.0, 40),
             ("reload", 0.65, 30), ("melee_slash", 0.32, 20), ("fire_pistol", 0.03, 35), ("jump", 0.4, 60), ("death_a", 1.5, 60),
             ("death_b", 1.6, 60), ("victory", 0.6, 20)]
    only = os.environ.get("HERO_POSES")
    if only:
        shots = [s_ for s_ in shots if s_[0] in only.split(",")]
    tiles = []
    for nm, t, yaw in shots:
        pose(nm, t)
        tiles.append(shoot(os.path.join(tmp, "pose_%s.png" % nm), yaw))
    montage(tiles, 6 if len(tiles) > 6 else len(tiles), os.path.join(PREV, "poses.png"))
    # close-up of the head
    pose("idle", 0.0)
    cd.lens = 120
    montage([shoot(os.path.join(tmp, "head_f.png"), 20, 3.0, 1.75, 1.66), shoot(os.path.join(tmp, "head_s.png"), 300, 3.0, 1.75, 1.66)], 2,
            os.path.join(PREV, "head.png"))
    log("previews written to", PREV)


if os.environ.get("HERO_PREVIEW"):
    render_previews()
log("done")
