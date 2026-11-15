# RAT OPS weapons and level props.
# Usage: blender -b -P tools/blender/props.py -- [name ...|all] [--preview] [--no-export]
# Writes game/assets/models/weapon_<id>.glb (with Muzzle + Grip empties) and prop_<name>.glb.
# Axes while authoring (Blender Z-up): weapons point along -Y (exports as -Z forward), props face -Y.
# Procedural numpy textures are generated per material slot and embedded. Deterministic (fixed seeds).
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(ROOT, 'game', 'assets', 'models')
TEX = os.path.join(ROOT, 'out', 'prop_tex')
PREV = os.path.join(ROOT, 'out', 'previews', 'model-weapons-props')

# ------------------------------------------------------------------ textures
def vnoise(n, cells, seed):
    r = np.random.RandomState(seed)
    g = r.rand(cells + 1, cells + 1)
    g[-1, :] = g[0, :]; g[:, -1] = g[:, 0]
    xs = np.linspace(0, cells, n, endpoint=False)
    i = xs.astype(int); f = xs - i; f = f * f * (3 - 2 * f)
    a = g[i][:, i]; b = g[i][:, i + 1]; c = g[i + 1][:, i]; d = g[i + 1][:, i + 1]
    fx = f[None, :]; fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def fbm(n, seed, base=4, octs=5):
    t = np.zeros((n, n)); amp = 1.0; tot = 0
    for o in range(octs):
        t += amp * vnoise(n, base * 2 ** o, seed + o); tot += amp; amp *= 0.5
    return t / tot

def streaks(n, seed, freq=3, stretch=24):
    r = np.random.RandomState(seed)
    g = r.rand(n // stretch + 1, freq * 8 + 1)
    xs = np.linspace(0, g.shape[1] - 1.001, n); ys = np.linspace(0, g.shape[0] - 1.001, n)
    xi = xs.astype(int); yi = ys.astype(int)
    return g[yi][:, xi]

def make_tex(name, family, tint, n=256, seed=1):
    os.makedirs(TEX, exist_ok=True)
    t = np.array(tint[:3], dtype=np.float32)
    f1 = fbm(n, seed); f2 = fbm(n, seed + 50, 8, 4)
    if family == 'wood':
        grain = streaks(n, seed, 2, 40)
        v = 0.75 + 0.4 * grain * 0.6 + 0.3 * (f1 - 0.5)
        img = t[None, None, :] * v[..., None]
    elif family == 'metal':
        s = streaks(n, seed, 4, 12)
        v = 0.8 + 0.2 * (s - 0.5) + 0.5 * (f2 - 0.5) * 0.5
        img = t[None, None, :] * v[..., None]
        rust = np.clip((f1 - 0.62) * 5, 0, 1)[..., None]
        img = img * (1 - 0.35 * rust) + rust * 0.35 * np.array([0.35, 0.16, 0.07])
        edge = (f2 > 0.7)[..., None] * 0.1
        img = img + edge
    elif family == 'stone':
        v = 0.7 + 0.5 * (f1 - 0.5) + 0.25 * (f2 - 0.5)
        img = t[None, None, :] * v[..., None]
        yy = np.arange(n)[:, None]; xx = np.arange(n)[None, :]
        mortar = ((yy % (n // 4) < 3) | ((xx + (yy // (n // 4)) * (n // 8)) % (n // 2) < 3))[..., None]
        img = np.where(mortar, img * 0.55, img)
    elif family == 'cloth':
        yy = np.arange(n)[:, None]; xx = np.arange(n)[None, :]
        weave = 0.9 + 0.1 * (((xx // 2 + yy // 2) % 2) * 1.0)
        v = weave * (0.85 + 0.3 * (f2 - 0.5))
        img = t[None, None, :] * v[..., None]
    elif family == 'cheese':
        v = 0.9 + 0.25 * (f1 - 0.5) + 0.1 * (f2 - 0.5)
        img = t[None, None, :] * v[..., None]
    elif family == 'fur':
        v = 0.8 + 0.5 * (streaks(n, seed, 6, 6) - 0.5)
        img = t[None, None, :] * v[..., None]
    elif family == 'leather':
        v = 0.8 + 0.5 * (f2 - 0.5) + 0.3 * (f1 - 0.5)
        img = t[None, None, :] * v[..., None]
    else:
        v = 0.92 + 0.16 * (f1 - 0.5)
        img = t[None, None, :] * v[..., None]
    img = np.clip(img, 0, 1) ** (1 / 2.2) if False else np.clip(img, 0, 1)
    rgba = np.ones((n, n, 4), dtype=np.float32); rgba[..., :3] = img
    im = bpy.data.images.new(name, n, n, alpha=False)
    im.pixels = rgba.ravel().tolist()
    p = os.path.join(TEX, name + '.png')
    im.filepath_raw = p; im.file_format = 'PNG'; im.save(); im.pack()
    return im

# family, tint, metallic, roughness, emission
MATS = {
    'wood':        ('wood',    (0.46, 0.29, 0.15), 0.0, 0.75, None),
    'wood_dark':   ('wood',    (0.24, 0.14, 0.08), 0.0, 0.7, None),
    'wood_pale':   ('wood',    (0.72, 0.55, 0.34), 0.0, 0.8, None),
    'metal':       ('metal',   (0.55, 0.56, 0.58), 1.0, 0.38, None),
    'metal_dark':  ('metal',   (0.14, 0.14, 0.15), 1.0, 0.45, None),
    'iron':        ('metal',   (0.22, 0.22, 0.23), 1.0, 0.6, None),
    'brass':       ('metal',   (0.78, 0.58, 0.22), 1.0, 0.32, None),
    'gold':        ('metal',   (0.95, 0.72, 0.18), 1.0, 0.22, None),
    'silver':      ('metal',   (0.82, 0.84, 0.88), 1.0, 0.2, None),
    'chrome':      ('metal',   (0.9, 0.9, 0.92), 1.0, 0.08, None),
    'stone':       ('stone',   (0.55, 0.52, 0.47), 0.0, 0.9, None),
    'stone_pale':  ('stone',   (0.72, 0.68, 0.6), 0.0, 0.85, None),
    'cloth_red':   ('cloth',   (0.62, 0.07, 0.07), 0.0, 0.9, None),
    'cloth_olive': ('cloth',   (0.28, 0.3, 0.16), 0.0, 0.95, None),
    'cloth_sand':  ('cloth',   (0.62, 0.54, 0.38), 0.0, 0.95, None),
    'cloth_grey':  ('cloth',   (0.4, 0.4, 0.42), 0.0, 0.95, None),
    'cloth_white': ('cloth',   (0.85, 0.83, 0.78), 0.0, 0.95, None),
    'cloth_pink':  ('cloth',   (0.9, 0.3, 0.55), 0.0, 0.95, None),
    'cloth_teal':  ('cloth',   (0.1, 0.65, 0.62), 0.0, 0.95, None),
    'cloth_yellow': ('cloth',  (0.92, 0.75, 0.15), 0.0, 0.95, None),
    'leather':     ('leather', (0.26, 0.15, 0.09), 0.0, 0.6, None),
    'fur':         ('fur',     (0.85, 0.5, 0.2), 0.0, 0.95, None),
    'fur_grey':    ('fur',     (0.5, 0.48, 0.46), 0.0, 0.95, None),
    'cheese':      ('cheese',  (0.95, 0.72, 0.16), 0.0, 0.35, None),
    'cheese_brie': ('cheese',  (0.93, 0.9, 0.78), 0.0, 0.5, None),
    'cheese_rind': ('cheese',  (0.78, 0.5, 0.12), 0.0, 0.55, None),
    'cheese_hole': ('cheese',  (0.7, 0.45, 0.08), 0.0, 0.5, None),
    'plastic_red': ('plain',   (0.7, 0.08, 0.06), 0.0, 0.4, None),
    'plastic_dark': ('plain',  (0.06, 0.06, 0.07), 0.0, 0.5, None),
    'terracotta':  ('plain',   (0.65, 0.3, 0.17), 0.0, 0.85, None),
    'leaf':        ('plain',   (0.18, 0.5, 0.15), 0.0, 0.7, None),
    'candle':      ('plain',   (0.92, 0.88, 0.75), 0.0, 0.7, None),
    'glass':       ('plain',   (0.8, 0.9, 0.9), 0.0, 0.1, None),
    'milk':        ('plain',   (0.95, 0.95, 0.92), 0.0, 0.2, None),
    'emblem':      ('plain',   (0.95, 0.8, 0.2), 0.0, 0.5, None),
    'paper':       ('plain',   (0.8, 0.75, 0.6), 0.0, 0.9, None),
    'glow_red':    ('plain',   (1.0, 0.1, 0.05), 0.0, 0.3, ((1.0, 0.08, 0.04), 6.0)),
    'glow_flame':  ('plain',   (1.0, 0.7, 0.25), 0.0, 0.3, ((1.0, 0.6, 0.2), 8.0)),
    'glow_green':  ('plain',   (0.4, 1.0, 0.3), 0.0, 0.3, ((0.3, 1.0, 0.2), 4.0)),
    'glow_cheese': ('plain',   (1.0, 0.85, 0.3), 0.0, 0.3, ((1.0, 0.75, 0.2), 2.0)),
}
_mat_cache = {}

def material(name):
    if name in _mat_cache:
        return _mat_cache[name]
    fam, tint, met, rough, em = MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; bsdf = nt.nodes['Principled BSDF']
    seed = (sum(ord(c) for c in name) * 7) % 1000
    im = make_tex('pt_' + name, fam, tint, 256, seed)
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = im
    nt.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Metallic'].default_value = met
    bsdf.inputs['Roughness'].default_value = rough
    if em:
        bsdf.inputs['Emission Color'].default_value = (*em[0], 1)
        bsdf.inputs['Emission Strength'].default_value = em[1]
    _mat_cache[name] = m
    return m

# ------------------------------------------------------------------ geometry builder
def R(rx=0, ry=0, rz=0):
    return Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_matrix().to_4x4()

def T(x=0, y=0, z=0):
    return Matrix.Translation((x, y, z))

def Sc(x=1, y=1, z=1):
    return Matrix.Diagonal((x, y, z, 1))

def align(a, b):
    a = Vector(a); b = Vector(b); d = b - a
    L = d.length
    q = d.normalized().to_track_quat('Z', 'Y')
    return T(*((a + b) / 2)) @ q.to_matrix().to_4x4(), L


class B:
    """Builder: one bmesh per material. All primitives take a material name."""
    def __init__(self, name):
        self.name = name; self.bms = {}; self.empties = []; self.bevel = 0.0; self.smooth = True

    def bm(self, mat):
        if mat not in self.bms:
            self.bms[mat] = bmesh.new()
        return self.bms[mat]

    def box(self, mat, c, s, rot=(0, 0, 0)):
        bmesh.ops.create_cube(self.bm(mat), size=1.0, matrix=T(*c) @ R(*rot) @ Sc(*s))

    def cyl(self, mat, a, b, r1, r2=None, seg=16, caps=True):
        m, L = align(a, b)
        r2 = r1 if r2 is None else r2
        bmesh.ops.create_cone(self.bm(mat), cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=L, matrix=m)

    def sph(self, mat, c, r, scale=(1, 1, 1), rot=(0, 0, 0), seg=16, rings=10):
        bmesh.ops.create_uvsphere(self.bm(mat), u_segments=seg, v_segments=rings, radius=r, matrix=T(*c) @ R(*rot) @ Sc(*scale))

    def lathe(self, mat, prof, c=(0, 0, 0), rot=(0, 0, 0), seg=24, scale=(1, 1, 1)):
        """prof: [(radius, z)] bottom to top; radius 0 ends are closed."""
        bm = self.bm(mat); M = T(*c) @ R(*rot) @ Sc(*scale)
        rings = []
        for r, z in prof:
            if r < 1e-6:
                rings.append(bm.verts.new(M @ Vector((0, 0, z))))
            else:
                rings.append([bm.verts.new(M @ Vector((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z))) for i in range(seg)])
        for k in range(len(prof) - 1):
            A, Bb = rings[k], rings[k + 1]
            for i in range(seg):
                j = (i + 1) % seg
                try:
                    if isinstance(A, list) and isinstance(Bb, list):
                        bm.faces.new((A[i], A[j], Bb[j], Bb[i]))
                    elif isinstance(A, list):
                        bm.faces.new((A[i], A[j], Bb))
                    elif isinstance(Bb, list):
                        bm.faces.new((A, Bb[j], Bb[i]))
                except ValueError:
                    pass
        return bm

    def torus(self, mat, c, R_, r, rot=(0, 0, 0), seg=28, ring=8):
        bm = self.bm(mat); M = T(*c) @ R(*rot)
        vs = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            row = []
            for j in range(ring):
                b = 2 * math.pi * j / ring
                x = (R_ + r * math.cos(b)) * math.cos(a); y = (R_ + r * math.cos(b)) * math.sin(a); z = r * math.sin(b)
                row.append(bm.verts.new(M @ Vector((x, y, z))))
            vs.append(row)
        for i in range(seg):
            for j in range(ring):
                i2 = (i + 1) % seg; j2 = (j + 1) % ring
                bm.faces.new((vs[i][j], vs[i2][j], vs[i2][j2], vs[i][j2]))

    def prism(self, mat, pts, z0, z1, c=(0, 0, 0), rot=(0, 0, 0)):
        """Extrude a convex 2D polygon (xy) from z0 to z1."""
        bm = self.bm(mat); M = T(*c) @ R(*rot)
        lo = [bm.verts.new(M @ Vector((x, y, z0))) for x, y in pts]
        hi = [bm.verts.new(M @ Vector((x, y, z1))) for x, y in pts]
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
        bm.faces.new(list(reversed(lo))); bm.faces.new(hi)

    def empty(self, name, loc, rot=(0, 0, 0)):
        self.empties.append((name, loc, rot))

    def build(self):
        mats = list(self.bms.keys())
        me = bpy.data.meshes.new(self.name)
        total = bmesh.new()
        for i, k in enumerate(mats):
            bm = self.bms[k]
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
            for f in bm.faces:
                f.material_index = i
            tmp = bpy.data.meshes.new('t'); bm.to_mesh(tmp); total.from_mesh(tmp); bpy.data.meshes.remove(tmp); bm.free()
        total.to_mesh(me); total.free()
        for k in mats:
            me.materials.append(material(k))
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        bpy.context.view_layer.objects.active = ob
        for o in bpy.context.selected_objects:
            o.select_set(False)
        ob.select_set(True)
        if self.bevel > 0:
            md = ob.modifiers.new('bev', 'BEVEL')
            md.width = self.bevel; md.segments = 2; md.limit_method = 'ANGLE'; md.angle_limit = math.radians(35)
            bpy.ops.object.modifier_apply(modifier='bev')
        for p in me.polygons:
            p.use_smooth = True
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        except Exception:
            pass
        # UVs: per-face box projection through smart project
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
        bpy.ops.object.mode_set(mode='OBJECT')
        objs = [ob]
        for n, loc, rot in self.empties:
            e = bpy.data.objects.new(n, None); e.empty_display_type = 'ARROWS'; e.empty_display_size = 0.05
            bpy.context.scene.collection.objects.link(e)
            e.location = loc; e.rotation_euler = [math.radians(a) for a in rot]
            e.parent = ob
            objs.append(e)
        return objs


def tri_count(ob):
    me = ob.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)

# ------------------------------------------------------------------ weapons
# Forward = -Y, up = +Z. Origin at the grip centre-ish. Dimensions in metres (chunky, slightly toy-like but real proportions).
def w_claws():
    b = B('weapon_claws'); b.bevel = 0.004
    # a leather-and-steel claw gauntlet: forearm guard, knuckle plate, 4 curved steel claws
    b.cyl('leather', (0, 0.14, 0), (0, -0.02, 0), 0.052, 0.058, 20)
    b.box('metal_dark', (0, 0.05, 0.05), (0.09, 0.14, 0.012))
    b.box('leather', (0, 0.0, 0.0), (0.11, 0.05, 0.08))
    for i in range(3):
        b.cyl('metal', (-0.04 + i * 0.04, 0.08, 0.052), (-0.04 + i * 0.04, 0.08, 0.052), 0.0, 0.0) if False else None
        b.cyl('brass', (-0.045, 0.1 - i * 0.04, 0.056), (0.045, 0.1 - i * 0.04, 0.056), 0.007, 0.007, 8)
    b.box('metal', (0, -0.055, 0.0), (0.12, 0.03, 0.085))   # knuckle plate
    for i in range(4):
        x = -0.045 + i * 0.03
        prev = (x, -0.065, 0.0)
        for k in range(1, 7):
            t = k / 6
            p = (x, -0.065 - 0.2 * t, -0.012 * k * 0.0 + 0.09 * t * t - 0.01 * t)
            r0 = 0.009 * (1 - (k - 1) / 6) + 0.0008; r1 = 0.009 * (1 - t) + 0.0008
            b.cyl('metal', prev, p, r0, r1, 8)
            prev = p
        b.sph('metal', (x, -0.065, 0.0), 0.011, seg=8, rings=6)
    for i in range(5):
        b.box('metal_dark', (-0.05 + i * 0.025, -0.0, 0.043), (0.007, 0.009, 0.009))  # rivets
    b.box('leather', (0, 0.15, -0.045), (0.06, 0.07, 0.01))
    b.empty('Muzzle', (0, -0.3, 0.07)); b.empty('Grip', (0, 0.0, -0.02))
    return b

def w_pistol():
    b = B('weapon_pistol'); b.bevel = 0.003
    # chunky blued slide pistol with open breech, wood grips, hairball visible
    b.box('metal_dark', (0, -0.02, 0.045), (0.034, 0.24, 0.036))                # slide
    b.box('metal', (0, -0.13, 0.045), (0.036, 0.03, 0.038))
    b.box('metal_dark', (0, 0.02, 0.0), (0.03, 0.2, 0.03))                      # frame
    for i in range(6):
        b.box('metal', (0, 0.07 + i * 0.012, 0.047), (0.037, 0.004, 0.034))      # rear serrations
    b.cyl('metal', (0, -0.13, 0.045), (0, -0.2, 0.045), 0.011, 0.011, 14)       # barrel
    b.cyl('plastic_dark', (0, -0.2, 0.045), (0, -0.202, 0.045), 0.006, 0.006, 12)
    b.sph('fur_grey', (0, -0.015, 0.068), 0.026, seg=14, rings=8)               # hairball in the open breech
    for i in range(14):
        a = i * 0.9; b.cyl('fur_grey', (0.014 * math.cos(a), -0.015 + 0.012 * math.sin(a * 1.7), 0.068), (0.034 * math.cos(a), -0.015 + 0.03 * math.sin(a * 1.7), 0.068 + 0.03 * math.sin(a)), 0.002, 0.0005, 5)
    b.box('metal_dark', (0, -0.0, 0.07), (0.01, 0.07, 0.004), (0, 0, 0))
    # grip
    b.box('wood', (0, 0.115, -0.065), (0.036, 0.062, 0.12), (-12, 0, 0))
    for i in range(5):
        b.box('wood_dark', (0.0185, 0.108 + i * 0.002, -0.04 - i * 0.02), (0.002, 0.05, 0.007), (-12, 0, 0))
        b.box('wood_dark', (-0.0185, 0.108 + i * 0.002, -0.04 - i * 0.02), (0.002, 0.05, 0.007), (-12, 0, 0))
    b.box('metal_dark', (0, 0.123, -0.13), (0.04, 0.066, 0.012), (-12, 0, 0))   # mag base
    # trigger guard
    b.torus('metal_dark', (0, 0.0, -0.022), 0.022, 0.0035, (0, 90, 0), 18, 6)
    b.box('metal', (0, 0.0, -0.008), (0.006, 0.006, 0.02), (20, 0, 0))
    b.box('metal', (0, -0.022, 0.022), (0.006, 0.008, 0.014))                   # front sight
    b.box('metal', (0, 0.1, 0.067), (0.012, 0.01, 0.01))
    b.box('brass', (0.019, 0.0, 0.052), (0.003, 0.04, 0.014))                   # ejection port
    b.empty('Muzzle', (0, -0.205, 0.045), (0, 0, 0)); b.empty('Grip', (0, 0.115, -0.05))
    return b

def w_gatling():
    b = B('weapon_gatling'); b.bevel = 0.004
    n = 6; rb = 0.045
    # barrel cluster
    for i in range(n):
        a = 2 * math.pi * i / n
        x, z = rb * math.cos(a), rb * math.sin(a)
        b.cyl('metal_dark', (x, 0.0, z), (x, -0.55, z), 0.0155, 0.0135, 12)
        b.cyl('metal', (x, -0.5, z), (x, -0.57, z), 0.0175, 0.0175, 12)
        b.cyl('plastic_dark', (x, -0.57, z), (x, -0.572, z), 0.009, 0.009, 10)
    for yy in (-0.18, -0.38):
        b.torus('iron', (0, yy, 0), rb, 0.011, (90, 0, 0), 32, 8)
    b.cyl('iron', (0, 0.05, 0), (0, -0.55, 0), 0.02, 0.02, 12)                    # centre spindle
    # housing
    b.cyl('metal', (0, 0.24, 0), (0, 0.0, 0), 0.085, 0.07, 24)
    b.cyl('metal_dark', (0, 0.0, 0), (0, -0.04, 0), 0.075, 0.075, 24)
    b.box('iron', (0, 0.18, 0.1), (0.1, 0.22, 0.05))                              # top plate
    b.box('metal_dark', (0, 0.24, 0.0), (0.2, 0.12, 0.2))                         # motor housing
    b.cyl('brass', (0.1, 0.2, 0.0), (0.12, 0.2, 0.0), 0.04, 0.04, 16)
    # side ammo drum (hairball tin)
    b.cyl('brass', (-0.18, 0.2, -0.03), (-0.11, 0.2, -0.03), 0.07, 0.07, 24)
    b.torus('iron', (-0.18, 0.2, -0.03), 0.067, 0.008, (0, 90, 0), 24, 6)
    # fish-bone crank
    b.cyl('metal', (0.12, 0.2, 0.0), (0.22, 0.2, 0.0), 0.012, 0.012, 10)
    b.cyl('metal', (0.22, 0.2, 0.0), (0.22, 0.2, -0.1), 0.012, 0.012, 10)
    b.cyl('cloth_white', (0.22, 0.2, -0.1), (0.3, 0.2, -0.1), 0.014, 0.014, 10)
    for k in range(5):
        s = 1 if k % 2 == 0 else -1
        b.cyl('cloth_white', (0.26, 0.2, -0.1), (0.26 + 0.0, 0.2 + s * 0.03, -0.1 - 0.02 + 0.0), 0.004, 0.0015, 6) if False else None
    for k in range(4):
        yv = 0.2 + (k - 1.5) * 0.012
        b.cyl('cloth_white', (0.265, yv, -0.1), (0.265, yv + 0.0, -0.1 + 0.035), 0.003, 0.001, 5)
        b.cyl('cloth_white', (0.265, yv, -0.1), (0.265, yv + 0.0, -0.1 - 0.035), 0.003, 0.001, 5)
    b.sph('cloth_white', (0.31, 0.2, -0.1), 0.02, (0.6, 1.0, 1.4))               # fish head
    # grips + carry handle
    b.cyl('leather', (-0.03, 0.34, -0.04), (-0.03, 0.34, -0.15), 0.02, 0.02, 10)
    b.cyl('leather', (0.03, 0.30, -0.04), (0.03, 0.30, -0.16), 0.02, 0.02, 10)
    b.torus('iron', (0, 0.22, 0.14), 0.06, 0.009, (0, 90, 0), 24, 6)
    # feed hose
    prev = (-0.14, 0.2, -0.03)
    for k in range(1, 9):
        t = k / 8
        p = (-0.14 + 0.1 * t, 0.2 + 0.0, -0.03 + 0.1 * math.sin(t * math.pi) * 0.5 + 0.02 * t)
        b.cyl('leather', prev, p, 0.017, 0.017, 8); prev = p
    b.empty('Muzzle', (0, -0.575, 0)); b.empty('Grip', (0, 0.32, -0.1))
    return b

def w_yarn():
    b = B('weapon_yarn'); b.bevel = 0.004
    # fat-barrelled launcher: wide tube with muzzle ring, yarn ball in muzzle, stock, pump, drum
    b.lathe('metal_dark', [(0.0, 0.0), (0.08, 0.0), (0.085, -0.04), (0.07, -0.08), (0.07, -0.5), (0.08, -0.52), (0.092, -0.55), (0.092, -0.58), (0.0, -0.58)][::1] and
            [(0.05, 0.12), (0.075, 0.1), (0.075, 0.0), (0.07, -0.05), (0.07, -0.42), (0.08, -0.44), (0.09, -0.47), (0.09, -0.5), (0.074, -0.5)], rot=(90, 0, 0), seg=28)
    b.cyl('metal_dark', (0, -0.5, 0), (0, -0.2, 0), 0.058, 0.058, 24, caps=False)
    b.torus('brass', (0, -0.32, 0), 0.075, 0.009, (90, 0, 0), 28, 6)
    b.torus('brass', (0, -0.12, 0), 0.077, 0.009, (90, 0, 0), 28, 6)
    b.sph('cloth_pink', (0, -0.47, 0), 0.065, seg=24, rings=14)                  # yarn ball in the muzzle
    for i in range(5):
        b.torus('cloth_pink', (0, -0.47, 0), 0.066, 0.004, (i * 36, i * 33 % 90, i * 41 % 120), 16, 4)
    b.cyl('cloth_pink', (0.04, -0.52, 0.05), (0.09, -0.58, 0.1), 0.004, 0.003, 5)
    # wooden foregrip pump
    b.cyl('wood', (0, -0.24, 0), (0, -0.36, 0), 0.092, 0.092, 24)
    for i in range(6):
        b.torus('wood_dark', (0, -0.25 - i * 0.02, 0), 0.093, 0.003, (90, 0, 0), 24, 4)
    # receiver, trigger group, grip, stock
    b.box('metal', (0, 0.06, -0.01), (0.11, 0.2, 0.14))
    b.box('wood', (0, 0.12, -0.12), (0.045, 0.06, 0.13), (-18, 0, 0))
    b.torus('metal_dark', (0, 0.03, -0.07), 0.03, 0.004, (0, 90, 0), 18, 6)
    b.box('wood', (0, 0.34, -0.03), (0.07, 0.3, 0.12), (4, 0, 0))
    b.box('leather', (0, 0.5, -0.04), (0.075, 0.03, 0.14))
    b.box('metal', (0, -0.1, 0.092), (0.012, 0.04, 0.025))                         # sight
    b.box('metal', (0, 0.1, 0.082), (0.03, 0.04, 0.025))
    b.cyl('brass', (0.056, 0.06, 0.02), (0.07, 0.06, 0.02), 0.022, 0.022, 14)      # loading knob
    for s in (-1, 1):
        b.box('iron', (s * 0.057, 0.06, 0.0), (0.004, 0.19, 0.1))
    b.empty('Muzzle', (0, -0.58, 0)); b.empty('Grip', (0, 0.12, -0.1))
    return b

def w_laser():
    b = B('weapon_laser'); b.bevel = 0.002
    # chrome laser pointer: long knurled tube, clip, lens with red glow, button
    b.cyl('chrome', (0, 0.12, 0), (0, -0.1, 0), 0.016, 0.016, 28)
    for i in range(14):
        b.torus('metal', (0, 0.1 - i * 0.008, 0), 0.0165, 0.0013, (90, 0, 0), 20, 4)  # knurling rings
    b.cyl('chrome', (0, -0.1, 0), (0, -0.2, 0), 0.016, 0.011, 28)
    b.cyl('metal_dark', (0, -0.2, 0), (0, -0.235, 0), 0.012, 0.013, 24)
    b.cyl('glow_red', (0, -0.235, 0), (0, -0.2385, 0), 0.008, 0.008, 20)
    b.lathe('metal', [(0.0, -0.2385), (0.0105, -0.2385), (0.0135, -0.23), (0.0125, -0.21)], rot=(90, 0, 0), seg=1) if False else None
    b.cyl('chrome', (0, 0.12, 0), (0, 0.17, 0), 0.016, 0.0135, 28)
    b.cyl('metal_dark', (0, 0.17, 0), (0, 0.19, 0), 0.0125, 0.0125, 20)
    # pocket clip
    b.box('chrome', (0, 0.0, 0.0185), (0.012, 0.15, 0.003))
    b.sph('chrome', (0, -0.08, 0.0185), 0.0075, seg=10, rings=6)
    # button
    b.cyl('plastic_red', (0, 0.0, 0.016), (0, 0.0, 0.026), 0.0055, 0.005, 12) if False else b.cyl('plastic_red', (0, 0.03, 0.0), (0, 0.03, -0.0) if False else (0, 0.03, -0.0), 0.0, 0.0) if False else None
    b.box('plastic_red', (0, -0.035, -0.016), (0.014, 0.022, 0.006))
    b.box('gold', (0, 0.06, -0.0168), (0.012, 0.006, 0.002))
    # engraved bands
    b.torus('plastic_red', (0, 0.035, 0), 0.0165, 0.0014, (90, 0, 0), 20, 4)
    b.torus('plastic_red', (0, -0.14, 0), 0.0145, 0.0014, (90, 0, 0), 20, 4)
    b.empty('Muzzle', (0, -0.24, 0)); b.empty('Grip', (0, 0.02, 0))
    return b

# ------------------------------------------------------------------ props
# Props: origin at floor centre, +Z up, front = -Y.
def cheese_holes(b, mat, centre_fn, pts, r=0.02):
    for (x, y, z, rr) in pts:
        b.sph(mat, (x, y, z), rr, (1, 1, 0.6), seg=8, rings=6)

def p_cheese_wheel():
    b = B('prop_cheese_wheel'); b.bevel = 0.004
    b.lathe('cheese_rind', [(0.0, 0.0), (0.27, 0.0), (0.285, 0.015), (0.29, 0.05), (0.29, 0.1), (0.285, 0.14), (0.27, 0.155), (0.0, 0.155)], seg=40)
    b.lathe('cheese', [(0.0, 0.1555), (0.262, 0.1555), (0.0, 0.1555)], seg=1) if False else None
    b.cyl('cheese', (0, 0, 0.1555), (0, 0, 0.158), 0.255, 0.255, 40)
    rng = np.random.RandomState(4)
    for i in range(9):
        a = rng.rand() * 6.28; d = 0.05 + rng.rand() * 0.17
        b.sph('cheese_hole', (d * math.cos(a), d * math.sin(a), 0.159), 0.012 + rng.rand() * 0.03, (1, 1, 0.3), seg=10, rings=6)
    for i in range(6):
        a = rng.rand() * 6.28
        b.sph('cheese_hole', (0.288 * math.cos(a), 0.288 * math.sin(a), 0.03 + rng.rand() * 0.09), 0.02, (0.3, 1, 1), rot=(0, 0, a * 57.3), seg=8, rings=6)
    return b

def p_cheese_wedge():
    b = B('prop_cheese_wedge'); b.bevel = 0.003
    a0, a1 = -0.55, 0.55; R_ = 0.34; h = 0.12
    pts = [(0, 0)] + [(R_ * math.cos(a0 + (a1 - a0) * i / 8), R_ * math.sin(a0 + (a1 - a0) * i / 8)) for i in range(9)]
    # sector is convex for <180deg
    b.prism('cheese', pts, 0.0, h, c=(-0.13, 0, 0.015), rot=(0, 0, 0))
    arc = pts[1:]
    b.prism('cheese_rind', [(R_ * 0.985 * math.cos(a0 + (a1 - a0) * i / 8), R_ * 0.985 * math.sin(a0 + (a1 - a0) * i / 8)) for i in range(9)] +
            [(R_ * 1.01 * math.cos(a1 - (a1 - a0) * i / 8), R_ * 1.01 * math.sin(a1 - (a1 - a0) * i / 8)) for i in range(9)], 0.0, h, c=(-0.13, 0, 0.015))
    rng = np.random.RandomState(9)
    for i in range(8):
        x = -0.1 + rng.rand() * 0.22; y = (rng.rand() - 0.5) * 0.3 * (0.3 + x + 0.2)
        b.sph('cheese_hole', (x - 0.13 + 0.1, y, 0.015 + h + 0.0), 0.012 + rng.rand() * 0.02, (1, 1, 0.3), seg=8, rings=6)
    for i in range(3):
        b.sph('cheese_hole', (0.19 - 0.0, (i - 1) * 0.0, 0.015 + 0.03 + i * 0.03), 0.02 - i * 0.003, (0.3, 1, 1), seg=8, rings=6) if False else None
    b.box('cloth_white', (0.0, 0, 0.007), (0.5, 0.5, 0.014)) if False else b.lathe('cloth_white', [(0.34, 0.0), (0.34, 0.012), (0.0, 0.012)] if False else [(0.2, 0.0), (0.38, 0.0), (0.38, 0.012), (0.2, 0.012)] , seg=12) if False else None
    b.cyl('cloth_white', (0, 0, 0.0), (0, 0, 0.012), 0.33, 0.33, 24)                    # doily
    return b

def p_brie_wheel():
    b = B('prop_brie_wheel'); b.bevel = 0.003
    b.cyl('silver', (0, 0, 0.0), (0, 0, 0.018), 0.34, 0.34, 40)
    b.torus('silver', (0, 0, 0.018), 0.34, 0.012, (0, 0, 0), 40, 6)
    # brie wheel with a wedge removed (270 deg arc) — build as prism of a fan
    R_ = 0.29; h = 0.1
    pts = [(0, 0)] + [(R_ * math.cos(math.radians(a)), R_ * math.sin(math.radians(a))) for a in range(0, 100, 12)]
    b.prism('cheese_brie', pts, 0, h, c=(0, 0, 0.02), rot=(0, 0, 0))
    big = [(0, 0)] + [(R_ * math.cos(math.radians(a)), R_ * math.sin(math.radians(a))) for a in range(100, 260, 20)]
    b.prism('cheese_brie', big, 0, h, c=(0, 0, 0.02))
    big2 = [(0, 0)] + [(R_ * math.cos(math.radians(a)), R_ * math.sin(math.radians(a))) for a in range(260, 361, 20)]
    b.prism('cheese_brie', big2, 0, h, c=(0, 0, 0.02))
    # cut faces show creamy interior
    b.box('cheese', (0.0, -0.0, 0.07), (0.01, 0.01, 0.1)) if False else None
    b.prism('cheese', [(0, 0), (R_ * 0.99, 0), (R_ * 0.99, -0.003), (0, -0.003)], 0.0, h * 0.98, c=(0, 0, 0.02), rot=(0, 0, 0)) if False else None
    return b

def p_cheese_crown():
    b = B('prop_cheese_crown'); b.bevel = 0.003
    b.lathe('gold', [(0.17, 0.0), (0.18, 0.02), (0.19, 0.07), (0.185, 0.1), (0.165, 0.1), (0.17, 0.07), (0.16, 0.02)], seg=32)
    for i in range(8):
        a = 2 * math.pi * i / 8
        x, y = 0.185 * math.cos(a), 0.185 * math.sin(a)
        b.cyl('gold', (x, y, 0.1), (x * 1.1, y * 1.1, 0.21), 0.03, 0.006, 8)
        b.sph('cheese', (x * 1.1, y * 1.1, 0.215), 0.022, seg=8, rings=6)
        gm = 'plastic_red' if i % 2 == 0 else 'leaf'
        b.sph(gm, (x * 1.01, y * 1.01, 0.05), 0.018, seg=8, rings=6)
    b.cyl('cheese', (0, 0, 0.03), (0, 0, 0.08), 0.12, 0.12, 24)  # cheese-wheel pad inside
    b.cyl('cloth_red', (0, 0, 0.0), (0, 0, 0.02), 0.16, 0.17, 24)
    return b

def p_ammo_box():
    b = B('prop_ammo_box'); b.bevel = 0.006
    b.box('wood_dark', (0, 0, 0.11), (0.5, 0.34, 0.22))
    b.box('wood', (0, 0, 0.225), (0.52, 0.36, 0.02))
    for x in (-0.2, 0.2):
        b.box('metal_dark', (x, 0, 0.11), (0.03, 0.352, 0.224))
    b.box('metal', (0, -0.178, 0.17), (0.07, 0.01, 0.045))
    b.cyl('leather', (-0.1, -0.18, 0.2), (0.1, -0.18, 0.2), 0.012, 0.012, 8)
    # stencilled paw (white): pad + four toes
    b.sph('cloth_white', (0, -0.1755, 0.09), 0.045, (1, 0.05, 0.8), seg=12, rings=8)
    for x, z in ((-0.058, 0.145), (-0.02, 0.17), (0.02, 0.17), (0.058, 0.145)):
        b.sph('cloth_white', (x, -0.1755, z - 0.02), 0.017, (1, 0.05, 1.2), seg=8, rings=6)
    # heaped hairballs on the lid
    rng = np.random.RandomState(2)
    for i in range(7):
        b.sph('fur_grey', ((rng.rand() - 0.5) * 0.3, (rng.rand() - 0.5) * 0.18, 0.255 + rng.rand() * 0.03), 0.04, seg=10, rings=7)
    return b

def p_ammo_clip():
    b = B('prop_ammo_clip'); b.bevel = 0.003
    b.lathe('metal', [(0.0, 0.0), (0.075, 0.0), (0.08, 0.01), (0.08, 0.075), (0.075, 0.085), (0.0, 0.085)], seg=28)
    b.torus('metal_dark', (0, 0, 0.0), 0.078, 0.005, (0, 0, 0), 28, 6)
    b.cyl('plastic_red', (0, 0, 0.0855), (0, 0, 0.09), 0.065, 0.065, 28)
    b.sph('fur_grey', (0, 0, 0.1), 0.05, (1, 1, 0.8), seg=12, rings=8)
    b.box('cloth_white', (0, -0.0805, 0.04), (0.06, 0.003, 0.035))
    return b

def p_battery():
    b = B('prop_battery'); b.bevel = 0.005
    b.box('plastic_red', (0, 0, 0.1), (0.15, 0.15, 0.2))
    b.box('metal_dark', (0, 0, 0.215), (0.1, 0.1, 0.03))
    b.cyl('chrome', (-0.03, 0, 0.23), (-0.03, 0, 0.26), 0.014, 0.014, 12)
    b.cyl('chrome', (0.03, 0, 0.23), (0.03, 0, 0.26), 0.014, 0.014, 12)
    b.box('glow_red', (0, -0.0755, 0.1), (0.04, 0.002, 0.14))                   # charge stripe
    b.box('cloth_white', (0, -0.0755, 0.03), (0.1, 0.002, 0.03))
    b.box('plastic_dark', (0.0, 0.0, 0.01), (0.152, 0.152, 0.02))
    return b

def p_yarn_ammo():
    b = B('prop_yarn_ammo'); b.bevel = 0.004
    b.lathe('wood_pale', [(0.0, 0.0), (0.2, 0.0), (0.24, 0.12), (0.26, 0.2), (0.235, 0.2), (0.215, 0.12), (0.0, 0.01)][:1] + [(0.2, 0.0), (0.245, 0.15), (0.255, 0.22), (0.235, 0.22), (0.19, 0.03), (0.0, 0.03)], seg=24)
    b.torus('wood', (0, 0, 0.22), 0.245, 0.012, (0, 0, 0), 24, 6)
    for i, (mat, x, y) in enumerate((('cloth_pink', -0.08, -0.04), ('cloth_teal', 0.09, -0.03), ('cloth_yellow', 0.0, 0.09))):
        z = 0.2
        b.sph(mat, (x, y, z), 0.095, seg=16, rings=10)
        for k in range(4):
            b.torus(mat, (x, y, z), 0.096, 0.005, (k * 45, k * 47 % 90, k * 31), 16, 4)
        b.cyl(mat, (x, y - 0.09, z - 0.02), (x - 0.04, y - 0.2, 0.03), 0.004, 0.003, 5)
    return b

def p_fish_treat():
    b = B('prop_fish_treat'); b.bevel = 0.002
    b.lathe('cloth_white', [(0.0, 0.0), (0.12, 0.0), (0.13, 0.008), (0.1, 0.016), (0.0, 0.016)], seg=28)
    b.sph('wood_pale', (0, 0, 0.04), 0.07, (1.9, 0.5, 0.75), seg=18, rings=10)
    b.prism('wood_pale', [(0.12, 0.0), (0.175, 0.045), (0.175, -0.045)], 0.025, 0.045, c=(0, 0, 0)) if False else b.prism('wood_pale', [(0.11, 0.0), (0.17, 0.04), (0.17, -0.04)], 0.03, 0.05)
    b.sph('plastic_dark', (-0.09, -0.032, 0.05), 0.008, seg=8, rings=6)
    b.sph('plastic_dark', (-0.09, 0.032, 0.05), 0.008, seg=8, rings=6)
    return b

def p_tuna():
    b = B('prop_tuna'); b.bevel = 0.004
    b.lathe('metal', [(0.0, 0.0), (0.09, 0.0), (0.095, 0.004), (0.095, 0.09), (0.09, 0.094), (0.0, 0.094)], seg=32)
    for z in (0.02, 0.045, 0.07):
        b.torus('metal_dark', (0, 0, z), 0.095, 0.003, (0, 0, 0), 32, 4)
    b.cyl('glow_cheese', (0, 0, 0.0945), (0, 0, 0.0955), 0.002, 0.002, 4) if False else None
    b.cyl('cheese_rind', (0, 0, 0.09), (0, 0, 0.098), 0.082, 0.082, 28)           # pink-ish fish meat is rind tone
    b.torus('metal', (0, 0, 0.094), 0.088, 0.004, (0, 0, 0), 32, 5)
    b.sph('silver', (0.02, 0.0, 0.11), 0.05, (1.4, 0.45, 0.6), rot=(0, 0, 25), seg=14, rings=8)  # fish peeking out
    b.sph('plastic_dark', (0.065, -0.012, 0.125), 0.007, seg=8, rings=6)
    # pull ring
    b.torus('metal', (-0.04, 0, 0.1), 0.028, 0.004, (0, 0, 0), 20, 5)
    b.box('metal', (-0.06, 0, 0.098), (0.06, 0.02, 0.003))
    return b

def p_catnip():
    b = B('prop_catnip'); b.bevel = 0.004
    b.lathe('cloth_olive', [(0.0, 0.0), (0.08, 0.0), (0.13, 0.08), (0.12, 0.17), (0.07, 0.2), (0.045, 0.24), (0.07, 0.27), (0.0, 0.27)][:1] + [(0.0, 0.0), (0.1, 0.01), (0.14, 0.08), (0.12, 0.17), (0.06, 0.21), (0.05, 0.225), (0.0, 0.225)], seg=20, scale=(1, 0.6, 1))
    b.torus('leather', (0, 0, 0.215), 0.052, 0.006, (0, 0, 0), 20, 5)
    for i in range(7):
        a = i * 0.9
        pos = (0.0, 0.0, 0.225)
        tip = (0.12 * math.cos(a), 0.12 * math.sin(a), 0.38 + 0.03 * (i % 3))
        b.cyl('glow_green', pos, tip, 0.012, 0.002, 6)
        b.sph('glow_green', tip, 0.026, (1, 0.6, 1.3), rot=(0, 0, a * 57), seg=8, rings=6)
    b.sph('glow_green', (0, -0.09, 0.1), 0.03, (1, 0.2, 1.3), seg=8, rings=6)
    return b

def _key(b, bow, shaft_mat):
    # bow at +Z? keys lie flat: shaft along +X
    b.box(shaft_mat, (0.0, 0, 0.012), (0.2, 0.014, 0.014))
    b.box(shaft_mat, (0.085, 0, -0.005), (0.016, 0.014, 0.022))
    b.box(shaft_mat, (0.065, 0, -0.003), (0.016, 0.014, 0.026))
    b.sph(shaft_mat, (-0.1, 0, 0.012), 0.013, seg=10, rings=6)

def p_key_gold():
    b = B('prop_key_gold'); b.bevel = 0.0015
    # shaft along +X, bell bow at -X
    b.cyl('gold', (-0.02, 0, 0), (0.18, 0, 0), 0.01, 0.009, 12)
    for x, hh in ((0.14, 0.032), (0.16, 0.024), (0.178, 0.03)):
        b.box('gold', (x, 0, -hh / 2 - 0.004), (0.012, 0.012, hh))
    b.sph('gold', (-0.07, 0, 0), 0.045, seg=20, rings=12)                          # cat bell
    b.torus('metal_dark', (-0.07, 0, 0), 0.045, 0.003, (0, 0, 0), 24, 5)
    b.box('metal_dark', (-0.07, 0, -0.02), (0.05, 0.003, 0.005), (0, 0, 90)) if False else b.box('metal_dark', (-0.07, 0, -0.025), (0.003, 0.05, 0.004))
    b.sph('metal_dark', (-0.07, 0, -0.045), 0.006, seg=8, rings=6)
    b.torus('gold', (-0.115, 0, 0), 0.016, 0.005, (90, 0, 0), 12, 5)
    b.cyl('gold', (-0.02, 0, 0), (0.0, 0, 0), 0.014, 0.014, 12)
    return b

def p_key_silver():
    b = B('prop_key_silver'); b.bevel = 0.0015
    b.cyl('silver', (-0.02, 0, 0), (0.18, 0, 0), 0.01, 0.009, 12)
    for x, hh in ((0.14, 0.032), (0.16, 0.024), (0.178, 0.03)):
        b.box('silver', (x, 0, -hh / 2 - 0.004), (0.012, 0.012, hh))
    # fish-shaped bow: oval body with a tail and eye hole
    b.sph('silver', (-0.075, 0, 0), 0.05, (1.2, 0.18, 0.75), seg=20, rings=12)
    b.prism('silver', [(0, 0), (-0.05, 0.035), (-0.05, -0.035)], -0.009, 0.009, c=(0, 0, 0), rot=(90, 0, 0)) if False else b.prism('silver', [(0.0, 0.0), (-0.055, 0.04), (-0.055, -0.04)], -0.006, 0.006, c=(-0.12, 0, 0), rot=(90, 0, 0))
    b.sph('plastic_dark', (-0.05, -0.012, 0.015), 0.007, seg=8, rings=6)
    b.sph('plastic_dark', (-0.05, 0.012, 0.015), 0.007, seg=8, rings=6)
    return b

def p_crate():
    b = B('prop_crate'); b.bevel = 0.008
    w = 0.9
    for i in range(5):
        z = 0.09 + i * 0.18
        b.box('wood', (0, -w / 2 + 0.01, z), (w, 0.03, 0.17)) ; b.box('wood', (0, w / 2 - 0.01, z), (w, 0.03, 0.17))
        b.box('wood', (-w / 2 + 0.01, 0, z), (0.03, w - 0.05, 0.17)); b.box('wood', (w / 2 - 0.01, 0, z), (0.03, w - 0.05, 0.17))
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box('wood_dark', (sx * (w / 2 - 0.045), sy * (w / 2 - 0.045), 0.45), (0.09, 0.09, 0.9))
    b.box('wood_dark', (0, 0, 0.02), (w - 0.1, w - 0.1, 0.04))
    b.box('wood_dark', (0, 0, 0.9 - 0.02), (w - 0.06, w - 0.06, 0.03))
    for sy in (-1, 1):
        b.box('wood', (0, sy * (w / 2 + 0.002), 0.45), (0.06, 0.012, 0.78), (0, 0, 0)) if False else None
        b.box('wood_dark', (0, sy * (w / 2 + 0.003), 0.45), (w * 1.2, 0.01, 0.07), (0, 0, 0)) if False else b.box('wood_dark', (0, sy * (w / 2 + 0.003), 0.45), (0.07, 0.01, 0.8), (0, 0, 0))
        b.cyl('leather', (-0.15, sy * (w / 2 + 0.03), 0.62), (0.15, sy * (w / 2 + 0.03), 0.62), 0.016, 0.016, 8)
    # paw stencil crossed out
    b.box('cloth_white', (0, -w / 2 - 0.004, 0.45), (0.22, 0.004, 0.2)) if False else None
    b.sph('cloth_white', (0, -w / 2 - 0.008, 0.38), 0.07, (1, 0.05, 0.8), seg=10, rings=6)
    for x, z in ((-0.09, 0.5), (-0.03, 0.55), (0.03, 0.55), (0.09, 0.5)):
        b.sph('cloth_white', (x, -w / 2 - 0.008, z), 0.026, (1, 0.05, 1.2), seg=8, rings=6)
    b.box('cloth_red', (0, -w / 2 - 0.012, 0.45), (0.5, 0.005, 0.04), (0, 25, 0))
    b.box('cloth_red', (0, -w / 2 - 0.012, 0.45), (0.5, 0.005, 0.04), (0, -25, 0))
    return b

def p_barrel():
    b = B('prop_barrel'); b.bevel = 0.004
    prof = [(0.0, 0.0), (0.27, 0.0), (0.3, 0.1), (0.335, 0.3), (0.35, 0.45), (0.335, 0.6), (0.3, 0.8), (0.27, 0.9), (0.0, 0.9)]
    b.lathe('wood', prof, seg=28)
    for z, r in ((0.08, 0.292), (0.25, 0.332), (0.65, 0.332), (0.82, 0.292)):
        b.lathe('iron', [(r - 0.005, z - 0.025), (r + 0.011, z - 0.025), (r + 0.011, z + 0.025), (r - 0.005, z + 0.025)], seg=28)
    b.cyl('wood_dark', (0, 0, 0.895), (0, 0, 0.91), 0.26, 0.26, 28)
    b.cyl('wood_dark', (0.0, 0, 0.904), (0, 0, 0.907), 0.2, 0.2, 28) if False else None
    b.box('wood_dark', (0, 0, 0.912), (0.52, 0.02, 0.006), (0, 0, 0))
    b.box('wood_dark', (0, 0, 0.912), (0.02, 0.52, 0.006), (0, 0, 0))
    b.cyl('emblem', (0, -0.352, 0.45), (0, -0.356, 0.45), 0.09, 0.09, 24)              # branded cheese emblem
    b.cyl('wood_dark', (0, -0.355, 0.45), (0, -0.358, 0.45), 0.06, 0.06, 24)
    b.prism('emblem', [(0, 0), (0.05, 0.02), (0.05, -0.02)], 0.0, 0.004, c=(-0.025, -0.357, 0.45), rot=(90, 0, 0)) if False else None
    b.cyl('iron', (0.0, 0.31, 0.45), (0, 0.36, 0.45), 0.02, 0.02, 10) if False else None
    return b

def p_shelf():
    b = B('prop_shelf'); b.bevel = 0.006
    W, D, H = 1.6, 0.4, 2.0
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box('wood_dark', (sx * (W / 2 - 0.04), sy * (D / 2 - 0.04), H / 2), (0.07, 0.07, H))
    for z in (0.12, 0.7, 1.28, 1.88):
        b.box('wood', (0, 0, z), (W, D, 0.04))
    b.box('wood_dark', (0, D / 2 - 0.01, H / 2), (W - 0.1, 0.02, H - 0.1))
    # contents: cheese wheels, tins, bottles
    rng = np.random.RandomState(6)
    for z in (0.14, 0.72, 1.30):
        x = -0.65
        while x < 0.65:
            k = rng.randint(0, 4)
            if k == 0:
                b.cyl('cheese_rind', (x, 0, z + 0.0), (x, 0, z + 0.1), 0.11, 0.11, 18); x += 0.26
            elif k == 1:
                b.cyl('metal', (x, 0, z), (x, 0, z + 0.12), 0.05, 0.05, 14); x += 0.13
            elif k == 2:
                b.cyl('glass', (x, 0, z), (x, 0, z + 0.2), 0.035, 0.035, 12); b.cyl('glass', (x, 0, z + 0.2), (x, 0, z + 0.27), 0.035, 0.012, 12); x += 0.1
            else:
                b.box('paper', (x, 0, z + 0.07), (0.16, 0.2, 0.14)); x += 0.2
    return b

def p_table():
    b = B('prop_table'); b.bevel = 0.006
    b.lathe('wood', [(0.0, 0.74), (0.55, 0.74), (0.56, 0.73), (0.56, 0.69), (0.0, 0.69)], seg=36)
    b.cyl('wood_dark', (0, 0, 0.0), (0, 0, 0.69), 0.07, 0.05, 14)
    b.lathe('wood_dark', [(0.0, 0.0), (0.3, 0.0), (0.32, 0.03), (0.08, 0.1), (0.07, 0.15)], seg=4)
    for k in range(3):
        a = k * 120 + 30
        b.cyl('wood_dark', (0, 0, 0.5), (0.35 * math.cos(math.radians(a)), 0.35 * math.sin(math.radians(a)), 0.02), 0.035, 0.035, 8)
    # cheese platter + candle
    b.cyl('silver', (0, 0.12, 0.74), (0, 0.12, 0.755), 0.25, 0.25, 28)
    b.cyl('cheese_brie', (-0.1, 0.12, 0.755), (-0.1, 0.12, 0.8), 0.1, 0.1, 22)
    b.prism('cheese', [(0, 0), (0.12, 0.05), (0.12, -0.05)], 0.0, 0.05, c=(0.05, 0.1, 0.755))
    b.cyl('brass', (0.2, -0.2, 0.74), (0.2, -0.2, 0.755), 0.05, 0.05, 14)
    b.cyl('candle', (0.2, -0.2, 0.755), (0.2, -0.2, 0.86), 0.022, 0.022, 12)
    b.sph('glow_flame', (0.2, -0.2, 0.885), 0.015, (1, 1, 1.8), seg=8, rings=6)
    return b

def p_chair():
    b = B('prop_chair'); b.bevel = 0.005
    for sx in (-1, 1):
        for sy in (-1, 1):
            b.box('wood', (sx * 0.19, sy * 0.19, 0.22), (0.045, 0.045, 0.44))
    b.box('wood', (0, 0, 0.45), (0.46, 0.46, 0.04))
    b.box('cloth_red', (0, 0, 0.485), (0.42, 0.42, 0.04))
    for sx in (-1, 1):
        b.box('wood', (sx * 0.19, 0.19, 0.72), (0.045, 0.045, 0.55))
    b.box('wood', (0, 0.205, 0.95), (0.46, 0.04, 0.12))
    for z in (0.7, 0.8):
        b.box('wood', (0, 0.205, z), (0.36, 0.025, 0.04))
    for z in (0.12,):
        b.box('wood_dark', (0, -0.19, z), (0.36, 0.03, 0.03)); b.box('wood_dark', (0, 0.19, z), (0.36, 0.03, 0.03))
    return b

def p_lamp():
    b = B('prop_lamp'); b.bevel = 0.003
    b.lathe('brass', [(0.0, 0.0), (0.2, 0.0), (0.2, 0.02), (0.1, 0.05), (0.03, 0.12), (0.025, 0.2)], seg=28)
    b.cyl('brass', (0, 0, 0.0), (0, 0, 1.4), 0.022, 0.018, 12)
    for z in (0.35, 0.8, 1.15):
        b.sph('brass', (0, 0, z), 0.04, (1, 1, 0.8), seg=12, rings=8)
    b.cyl('brass', (0, 0, 1.4), (0, 0, 1.45), 0.05, 0.05, 14)
    # cheese-wedge shade: wedge prism lying on its back, emissive
    b.prism('glow_cheese', [(-0.15, -0.12), (0.17, -0.12), (0.17, 0.12), (-0.15, 0.0)], 1.45, 1.70, c=(0, 0, 0), rot=(0, 0, 0)) if False else None
    b.prism('glow_cheese', [(0.0, 0.0), (0.22, 0.12), (0.22, -0.12)], 0.0, 0.26, c=(-0.1, 0, 1.45))
    for i in range(4):
        b.sph('cheese_hole', (0.12 - 0.1, -0.1 + i * 0.07 if False else 0.0, 1.5 + i * 0.05), 0.0, seg=3, rings=3) if False else None
    b.sph('glow_flame', (0, 0, 1.58), 0.03, seg=8, rings=6) if False else None
    b.cyl('brass', (0, 0, 1.45), (0, 0, 1.47), 0.03, 0.03, 10)
    return b

def p_torch():
    b = B('prop_torch'); b.bevel = 0.003
    # wall torch: iron bracket + wooden handle + flame (origin at wall plane, bracket points -Y)
    b.box('iron', (0, 0.015, 0.0), (0.12, 0.03, 0.2))
    b.cyl('wood_dark', (0, 0.0, -0.12), (0, -0.13, 0.28), 0.032, 0.04, 10)
    b.lathe('iron', [(0.0, 0.0), (0.055, 0.0), (0.06, 0.04), (0.05, 0.1), (0.0, 0.1)], c=(0, -0.13, 0.28), seg=12) if False else None
    b.cyl('iron', (0, -0.1, 0.22), (0, -0.14, 0.34), 0.04, 0.062, 14)
    b.torus('iron', (0, -0.1, 0.13), 0.04, 0.007, (-17, 0, 0), 16, 5)
    b.torus('iron', (0, -0.04, -0.0), 0.04, 0.007, (-17, 0, 0), 16, 5)
    b.cyl('iron', (0, 0.0, 0.0), (0, -0.07, 0.0), 0.012, 0.012, 8)
    b.sph('glow_flame', (0, -0.14, 0.42), 0.055, (1, 1, 2.0), seg=12, rings=8)
    b.sph('glow_red', (0, -0.14, 0.36), 0.04, (1, 1, 1.2), seg=10, rings=6)
    return b

def p_banner():
    b = B('prop_banner'); b.bevel = 0.0
    # wall banner (hangs on +Y wall plane): pole, red cloth with white disc and black cheese wedge (generic emblem)
    b.cyl('wood_dark', (-0.4, 0.02, 1.9), (0.4, 0.02, 1.9), 0.02, 0.02, 10)
    b.sph('brass', (-0.42, 0.02, 1.9), 0.03, seg=8, rings=6); b.sph('brass', (0.42, 0.02, 1.9), 0.03, seg=8, rings=6)
    # cloth with a gentle wave
    nx, nz = 6, 14
    bm = b.bm('cloth_red')
    verts = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            x = -0.36 + 0.72 * i / nx; z = 1.88 - 1.5 * j / nz
            y = 0.03 - 0.02 * math.sin(j * 0.6 + i * 0.4)
            row.append(bm.verts.new((x, y, z)))
        verts.append(row)
    for j in range(nz):
        for i in range(nx):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    b.cyl('cloth_white', (0, -0.001, 1.38), (0, -0.01, 1.38), 0.22, 0.22, 28) if False else None
    b.cyl('cloth_white', (0, 0.004, 1.38), (0, -0.006, 1.38), 0.2, 0.2, 30) if False else None
    b.prism('cloth_white', [(0.2 * math.cos(2 * math.pi * k / 24), 0.2 * math.sin(2 * math.pi * k / 24)) for k in range(24)], 0.0, 0.004, c=(0, -0.012, 1.38), rot=(90, 0, 0))
    b.prism('plastic_dark', [(-0.1, -0.07), (0.1, -0.07), (0.1, 0.0), (-0.04, 0.09)], 0.0, 0.004, c=(0, -0.017, 1.38), rot=(90, 0, 0))
    for k in range(3):
        b.sph('cloth_white', (-0.04 + k * 0.04, -0.0225, 1.35 + k * 0.01), 0.012, (1, 0.2, 1), seg=8, rings=6)
    # tassels
    for i in range(4):
        x = -0.3 + i * 0.2
        b.cyl('gold', (x, 0.02, 0.38), (x, 0.02, 0.28), 0.012, 0.01, 6)
    return b

def p_sandbags():
    b = B('prop_sandbags'); b.bevel = 0.0
    rng = np.random.RandomState(12)
    rows = [(0.0, 5, 0.0), (0.2, 4, 0.2), (0.4, 3, 0.4)]
    for z, n, off in rows:
        for i in range(n):
            x = -0.5 * (n - 1) / 2 * 2 * 0.5 + i * 0.5 - 0.0
            x = (i - (n - 1) / 2) * 0.5
            mat = 'cloth_sand' if (i + int(z * 10)) % 2 == 0 else 'cloth_olive'
            b.sph(mat, (x, 0, z + 0.1), 0.25, (1.0, 0.7, 0.42), rot=(0, 0, rng.randn() * 2), seg=16, rings=10)
            b.torus('leather', (x - 0.22, 0, z + 0.1), 0.0, 0.0, seg=3, ring=3) if False else None
            b.box('leather', (x + 0.24, 0, z + 0.11), (0.03, 0.12, 0.05))   # tied end
    return b

def p_pipes():
    b = B('prop_pipes'); b.bevel = 0.003
    # a run of pipes along X (wall pipes) with flanges and a valve; origin at wall
    for k, (z, r, mat) in enumerate(((0.3, 0.07, 'iron'), (0.55, 0.05, 'brass'), (0.78, 0.09, 'iron'))):
        b.cyl(mat, (-1.0, -r - 0.05, z), (1.0, -r - 0.05, z), r, r, 20)
        for x in (-0.7, -0.2, 0.5, 0.95):
            b.cyl('iron', (x - 0.015, -r - 0.05, z), (x + 0.015, -r - 0.05, z), r * 1.35, r * 1.35, 20)
            b.box('iron', (x, -0.0, z), (0.06, 0.06, 0.04)) if False else b.box('iron', (x, -0.01, z), (0.05, 0.04, 0.05))
    b.cyl('iron', (0.0, -0.14, 0.78), (0.0, -0.14, 1.2), 0.04, 0.04, 14)
    b.cyl('iron', (0.0, -0.14, 1.2), (0.0, -0.14, 1.35), 0.08, 0.08, 12) if False else None
    b.torus('plastic_red', (0, -0.14, 1.28), 0.07, 0.01, (90, 0, 0), 20, 6) if False else None
    b.torus('plastic_red', (0, -0.14, 1.25), 0.075, 0.01, (0, 0, 0), 20, 6)
    b.cyl('iron', (-0.07, -0.14, 1.25), (0.07, -0.14, 1.25), 0.008, 0.008, 6)
    b.cyl('iron', (0, -0.21, 1.25), (0, -0.07, 1.25), 0.008, 0.008, 6)
    b.cyl('iron', (0, -0.14, 1.2), (0, -0.14, 1.27), 0.012, 0.012, 8)
    return b

def p_rug():
    b = B('prop_rug'); b.bevel = 0.0
    b.box('cloth_red', (0, 0, 0.008), (2.0, 3.0, 0.016))
    b.box('gold', (0, 0, 0.0165), (1.8, 2.8, 0.002)) if False else None
    for (sx, sy, mat) in ((1.8, 2.8, 'emblem'), (1.64, 2.64, 'cloth_red'), (1.5, 2.5, 'plastic_dark'), (1.46, 2.46, 'cloth_red')):
        z = 0.0168 + 0.0005 * (4 - len([1]))
    b.box('emblem', (0, 0, 0.017), (1.82, 2.82, 0.002))
    b.box('cloth_red', (0, 0, 0.0185), (1.7, 2.7, 0.002))
    b.box('plastic_dark', (0, 0, 0.02), (1.5, 2.5, 0.002))
    b.box('cloth_red', (0, 0, 0.0215), (1.46, 2.46, 0.003))
    b.prism('emblem', [(0, 0.65), (0.4, 0), (0, -0.65), (-0.4, 0)], 0.0, 0.003, c=(0, 0, 0.0245))
    b.prism('cloth_red', [(0, 0.45), (0.25, 0), (0, -0.45), (-0.25, 0)], 0.0, 0.003, c=(0, 0, 0.0275))
    b.cyl('cheese', (0, 0, 0.0305), (0, 0, 0.0335), 0.12, 0.12, 20)
    for sx in (-1, 1):
        for k in range(14):
            b.cyl('cloth_white', (sx * 1.0, -1.3 + k * 0.2, 0.01), (sx * 1.07, -1.3 + k * 0.2, 0.01), 0.008, 0.008, 4)
    return b

def p_statue():
    b = B('prop_statue'); b.bevel = 0.006
    b.box('stone_pale', (0, 0, 0.2), (0.9, 0.9, 0.4))
    b.box('stone', (0, 0, 0.45), (0.75, 0.75, 0.1))
    # standing heroic cat: hind legs, torso, arms, head with ears
    for s in (-1, 1):
        b.cyl('stone_pale', (s * 0.1, 0, 0.5), (s * 0.11, 0, 1.0), 0.07, 0.06, 12)
        b.box('stone_pale', (s * 0.1, -0.06, 0.52), (0.1, 0.2, 0.06))
    b.sph('stone_pale', (0, 0, 1.12), 0.2, (1.0, 0.8, 1.1), seg=18, rings=12)
    b.lathe('stone_pale', [(0.0, 1.05), (0.21, 1.15), (0.24, 1.35), (0.17, 1.55), (0.0, 1.58)], seg=20, scale=(1, 0.8, 1))
    # raised arm holding a cheese wheel, other on hip
    b.cyl('stone_pale', (0.2, 0, 1.45), (0.35, -0.05, 1.85), 0.055, 0.05, 10)
    b.cyl('stone_pale', (0.35, -0.05, 1.85), (0.38, -0.05, 2.05), 0.05, 0.045, 10)
    b.cyl('stone', (0.38, -0.05, 2.05), (0.38, -0.05, 2.1), 0.15, 0.15, 24)
    b.cyl('stone_pale', (-0.2, 0, 1.45), (-0.3, -0.1, 1.2), 0.055, 0.05, 10)
    b.cyl('stone_pale', (-0.3, -0.1, 1.2), (-0.15, -0.14, 1.1), 0.05, 0.05, 10)
    b.sph('stone_pale', (0, -0.02, 1.76), 0.14, (1, 0.95, 0.95), seg=16, rings=10)
    b.sph('stone_pale', (0, -0.14, 1.72), 0.065, (1, 1, 0.8), seg=10, rings=6)
    for s in (-1, 1):
        b.cyl('stone_pale', (s * 0.08, 0, 1.84), (s * 0.12, 0.0, 1.98), 0.06, 0.005, 6)
    b.cyl('stone_pale', (0, 0.15, 1.0), (0.0, 0.5, 0.58), 0.03, 0.01, 8)    # tail
    b.box('stone', (0, -0.451, 0.2), (0.4, 0.01, 0.12))
    return b

def p_pillar():
    b = B('prop_pillar'); b.bevel = 0.005
    H = 3.6
    b.box('stone', (0, 0, 0.15), (0.9, 0.9, 0.3))
    b.lathe('stone_pale', [(0.0, 0.3), (0.36, 0.3), (0.36, 0.36), (0.31, 0.4), (0.3, 0.55), (0.28, H - 0.7), (0.3, H - 0.55), (0.31, H - 0.5)], seg=20)
    for k in range(20):    # fluting
        a = 2 * math.pi * k / 20
        b.box('stone', (0.3 * math.cos(a), 0.3 * math.sin(a), (0.55 + H - 0.7) / 2), (0.02, 0.02, H - 1.35), (0, 0, k * 18))
    # carved cheese-wedge capital
    b.lathe('stone', [(0.31, H - 0.5), (0.4, H - 0.45), (0.5, H - 0.25), (0.55, H - 0.1)], seg=20)
    for k in range(8):
        a = 2 * math.pi * k / 8
        b.prism('cheese_rind', [(0, 0), (0.12, 0.06), (0.12, -0.06)], 0.0, 0.2, c=(0.43 * math.cos(a), 0.43 * math.sin(a), H - 0.4), rot=(0, 0, math.degrees(a)))
    b.box('stone_pale', (0, 0, H - 0.03), (1.15, 1.15, 0.06))
    return b

def p_doorway():
    b = B('prop_doorway'); b.bevel = 0.008
    W, H, D = 1.6, 2.6, 0.5
    b.box('stone_pale', (-W / 2 - 0.2, 0, H / 2), (0.4, D, H))
    b.box('stone_pale', (W / 2 + 0.2, 0, H / 2), (0.4, D, H))
    b.box('stone_pale', (0, 0, H + 0.2), (W + 0.8, D, 0.4))
    b.box('stone', (0, -D / 2 - 0.02, H + 0.43), (W + 0.9, 0.12, 0.06))
    for s in (-1, 1):
        b.box('stone', (s * (W / 2 + 0.2), -D / 2 - 0.03, 0.12), (0.5, 0.1, 0.24))
        b.box('stone', (s * (W / 2 + 0.2), -D / 2 - 0.03, H - 0.05), (0.5, 0.1, 0.1))
    b.prism('cheese_rind', [(0, 0), (0.18, 0.1), (0.18, -0.1)], 0.0, 0.08, c=(-0.09, -D / 2 - 0.03, H + 0.2), rot=(90, 0, 0)) if False else b.cyl('cheese_rind', (0, -D / 2 - 0.01, H + 0.2), (0, -D / 2 - 0.05, H + 0.2), 0.14, 0.14, 24)
    b.cyl('cheese', (0, -D / 2 - 0.05, H + 0.2), (0, -D / 2 - 0.06, H + 0.2), 0.11, 0.11, 24)
    return b

def p_chandelier():
    b = B('prop_chandelier'); b.bevel = 0.003
    b.torus('iron', (0, 0, 0.0), 0.5, 0.025, (0, 0, 0), 36, 8)
    b.torus('iron', (0, 0, -0.1), 0.3, 0.015, (0, 0, 0), 28, 6)
    for k in range(4):
        a = k * 90
        b.cyl('iron', (0, 0, 0.6), (0.5 * math.cos(math.radians(a)), 0.5 * math.sin(math.radians(a)), 0.0), 0.008, 0.008, 6)
    b.cyl('iron', (0, 0, 0.6), (0, 0, 1.0), 0.012, 0.012, 6)
    for k in range(8):
        a = 2 * math.pi * k / 8
        x, y = 0.5 * math.cos(a), 0.5 * math.sin(a)
        b.cyl('brass', (x, y, 0.02), (x, y, 0.07), 0.03, 0.02, 10)
        b.cyl('candle', (x, y, 0.07), (x, y, 0.2), 0.016, 0.016, 8)
        b.sph('glow_flame', (x, y, 0.23), 0.016, (1, 1, 1.8), seg=8, rings=6)
    return b

def p_candelabra():
    b = B('prop_candelabra'); b.bevel = 0.003
    b.lathe('iron', [(0.0, 0.0), (0.18, 0.0), (0.18, 0.03), (0.08, 0.07), (0.03, 0.15)], seg=20)
    b.cyl('iron', (0, 0, 0.0), (0, 0, 1.2), 0.025, 0.018, 10)
    for z in (0.4, 0.8):
        b.sph('iron', (0, 0, z), 0.04, seg=10, rings=6)
    for k, a in enumerate((-1, 0, 1)):
        x = a * 0.22
        arm = (x, 0, 1.12 + (0.0 if a == 0 else -0.04))
        b.cyl('iron', (0, 0, 1.05), (x, 0, 1.15 if a == 0 else 1.15), 0.014, 0.014, 6)
        b.cyl('iron', (x, 0, 1.15), (x, 0, 1.2), 0.035, 0.03, 10)
        b.cyl('candle', (x, 0, 1.2), (x, 0, 1.36), 0.02, 0.02, 10)
        b.sph('glow_flame', (x, 0, 1.39), 0.018, (1, 1, 1.9), seg=8, rings=6)
    return b

def p_cheese_stack():
    b = B('prop_cheese_stack'); b.bevel = 0.003
    for k, (z, r) in enumerate(((0.0, 0.42), (0.18, 0.4), (0.36, 0.38))):
        b.lathe('cheese_rind', [(0.0, z), (r - 0.02, z), (r, z + 0.02), (r, z + 0.16), (r - 0.02, z + 0.18), (0.0, z + 0.18)], seg=36)
        if k < 2:
            continue
    b.cyl('cheese', (0, 0, 0.54), (0, 0, 0.545), 0.36, 0.36, 36)
    b.prism('cheese_rind', [(0, 0), (0.4, 0.14), (0.4, -0.14)], 0.0, 0.18, c=(0, 0, 0.36)) if False else None
    rng = np.random.RandomState(3)
    for i in range(8):
        a = rng.rand() * 6.28; d = 0.05 + rng.rand() * 0.28
        b.sph('cheese_hole', (d * math.cos(a), d * math.sin(a), 0.546), 0.02 + rng.rand() * 0.03, (1, 1, 0.3), seg=10, rings=6)
    return b

def p_cauldron():
    b = B('prop_cauldron'); b.bevel = 0.004
    b.lathe('iron', [(0.0, 0.1), (0.2, 0.1), (0.4, 0.25), (0.5, 0.5), (0.48, 0.78), (0.5, 0.82), (0.45, 0.84), (0.43, 0.8)], seg=28)
    b.cyl('glow_cheese', (0, 0, 0.78), (0, 0, 0.785), 0.43, 0.43, 28)
    rng = np.random.RandomState(8)
    for i in range(6):
        a = rng.rand() * 6.28; d = rng.rand() * 0.3
        b.sph('glow_cheese', (d * math.cos(a), d * math.sin(a), 0.79), 0.04 + rng.rand() * 0.03, (1, 1, 0.5), seg=10, rings=6)
    for k in range(3):
        a = math.radians(k * 120 + 20)
        b.cyl('iron', (0.3 * math.cos(a), 0.3 * math.sin(a), 0.2), (0.4 * math.cos(a), 0.4 * math.sin(a), 0.0), 0.04, 0.025, 8)
    b.torus('iron', (0.0, 0, 0.8), 0.49, 0.015, (0, 0, 0), 28, 6)
    b.torus('iron', (0.5, 0, 0.7), 0.06, 0.012, (90, 0, 0), 16, 5)
    b.torus('iron', (-0.5, 0, 0.7), 0.06, 0.012, (90, 0, 0), 16, 5)
    return b

def p_mousetrap():
    b = B('prop_mousetrap'); b.bevel = 0.002
    b.box('wood_pale', (0, 0, 0.012), (0.22, 0.12, 0.024))
    b.cyl('metal', (-0.08, -0.05, 0.026), (-0.08, 0.05, 0.026), 0.003, 0.003, 6)
    b.torus('metal', (0.0, 0.0, 0.03), 0.05, 0.003, (0, 0, 0), 16, 4) if False else b.cyl('metal', (-0.08, -0.05, 0.03), (0.08, -0.05, 0.03), 0.003, 0.003, 6)
    b.cyl('metal', (-0.08, 0.05, 0.03), (0.08, 0.05, 0.03), 0.003, 0.003, 6)
    b.cyl('metal', (0.08, -0.05, 0.03), (0.08, 0.05, 0.03), 0.003, 0.003, 6)
    b.box('metal', (0.0, 0.0, 0.026), (0.025, 0.03, 0.006))
    b.box('cheese', (0.075, 0, 0.034), (0.03, 0.025, 0.02))
    b.cyl('metal', (-0.1, 0, 0.026), (-0.08, 0, 0.026), 0.008, 0.008, 8)
    return b

BUILDERS = {
    'weapon_claws': w_claws, 'weapon_pistol': w_pistol, 'weapon_gatling': w_gatling, 'weapon_yarn': w_yarn, 'weapon_laser': w_laser,
    'prop_cheese_wheel': p_cheese_wheel, 'prop_cheese_wedge': p_cheese_wedge, 'prop_brie_wheel': p_brie_wheel, 'prop_cheese_crown': p_cheese_crown,
    'prop_ammo_box': p_ammo_box, 'prop_ammo_clip': p_ammo_clip, 'prop_battery': p_battery, 'prop_yarn_ammo': p_yarn_ammo,
    'prop_fish_treat': p_fish_treat, 'prop_tuna': p_tuna, 'prop_catnip': p_catnip,
    'prop_key_gold': p_key_gold, 'prop_key_silver': p_key_silver,
    'prop_crate': p_crate, 'prop_barrel': p_barrel, 'prop_shelf': p_shelf, 'prop_table': p_table, 'prop_chair': p_chair, 'prop_lamp': p_lamp,
    'prop_torch': p_torch, 'prop_banner': p_banner, 'prop_sandbags': p_sandbags, 'prop_pipes': p_pipes, 'prop_rug': p_rug,
    'prop_statue': p_statue, 'prop_pillar': p_pillar, 'prop_doorway': p_doorway, 'prop_chandelier': p_chandelier,
    'prop_candelabra': p_candelabra, 'prop_cheese_stack': p_cheese_stack, 'prop_cauldron': p_cauldron, 'prop_mousetrap': p_mousetrap,
}

def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)

def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    names = [a for a in argv if not a.startswith('--')]
    if not names or names == ['all']:
        names = list(BUILDERS)
    names = [n if n in BUILDERS else ('prop_' + n if 'prop_' + n in BUILDERS else 'weapon_' + n) for n in names]
    os.makedirs(MODELS, exist_ok=True)
    report = []
    for n in names:
        clear()
        objs = BUILDERS[n]().build()
        ob = objs[0]
        t = tri_count(ob)
        report.append((n, t))
        if '--no-export' in argv:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, n + '.glb'), export_format='GLB', use_selection=True,
                                  export_yup=True, export_apply=True, export_image_format='AUTO')
    for n, t in report:
        print('PROPS %-22s tris=%d' % (n, t))
    if '--preview' in argv:
        preview(names)

def preview(names):
    clear()
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = 2400; sc.render.resolution_y = 1100
    sc.display.shading.show_cavity = False
    wd = bpy.data.worlds.new('w'); wd.color = (0.42, 0.44, 0.48); sc.world = wd
    cols = 10
    rows = (len(names) + cols - 1) // cols
    sp = 2.4
    for i, n in enumerate(names):
        pre = len(bpy.data.objects)
        objs = BUILDERS[n]().build()
        ob = objs[0]
        # weapons point -Y: rotate to read side-on and scale up to roughly the cell
        dims = ob.dimensions
        s = 1.8 / max(dims.x, dims.y, dims.z)
        if n.startswith('weapon'):
            ob.rotation_euler = (0, 0, math.radians(90))
        ob.scale = (s, s, s)
        bpy.context.view_layer.update()
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        cx = sum(v.x for v in bb) / 8; cy = sum(v.y for v in bb) / 8; zmin = min(v.z for v in bb)
        ob.location = (i % cols * sp - cx, -cy, -zmin - (i // cols) * sp * 1.1)
        for e in objs[1:]:
            e.hide_viewport = True; e.hide_render = True
    cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = cols * sp * 1.02
    co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
    co.location = ((cols - 1) * sp / 2, -40, -(rows - 1) * sp * 0.55 + 0.9)
    co.rotation_euler = (math.radians(90), 0, 0)
    os.makedirs(PREV, exist_ok=True)
    sc.render.filepath = os.path.join(PREV, 'contact.png')
    bpy.ops.render.render(write_still=True)
    print('PREVIEW', sc.render.filepath)

main()
