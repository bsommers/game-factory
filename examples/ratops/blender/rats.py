# RAT OPS enemy models: mouse, trooper, officer, sewer, panzer, boss.
# Usage:  blender -b -P tools/blender/rats.py -- [kind ...|all] [--preview] [--no-export]
# Writes game/assets/models/rat_<kind>.glb (LOD0 + LOD1 skinned meshes, weapon mesh, shared armature,
# clips as separate actions). Procedural textures are generated with numpy into out/rat_tex/ and embedded.
# Everything is deterministic (fixed seeds) so the models are reproducible from this text.
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix, Euler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MODELS = os.path.join(ROOT, 'game', 'assets', 'models')
TEX = os.path.join(ROOT, 'out', 'rat_tex')
PREV = os.path.join(ROOT, 'out', 'previews', 'model-rats')
FPS = 30

# ---------------------------------------------------------------- kinds
KINDS = {
    'mouse':   dict(height=1.40, head=1.25, snout=0.72, ear=1.55, girth=0.86, belly=1.0, fur=(0.46, 0.45, 0.44),
                    skin=(0.86, 0.62, 0.60), eye=(0.01, 0.01, 0.012), weapon='rifle', hunch=0.0, mange=0.0),
    'trooper': dict(height=1.70, head=1.0, snout=1.0, ear=1.0, girth=1.0, belly=1.0, fur=(0.33, 0.23, 0.15),
                    skin=(0.78, 0.55, 0.52), eye=(0.01, 0.01, 0.01), weapon='smg', hunch=0.0, mange=0.0),
    'officer': dict(height=1.76, head=0.97, snout=1.08, ear=0.95, girth=0.84, belly=0.95, fur=(0.86, 0.84, 0.79),
                    skin=(0.92, 0.66, 0.66), eye=(0.55, 0.03, 0.05), weapon='pistol', hunch=0.0, mange=0.0),
    'sewer':   dict(height=1.55, head=1.02, snout=1.12, ear=0.9, girth=0.92, belly=0.9, fur=(0.13, 0.11, 0.09),
                    skin=(0.62, 0.44, 0.40), eye=(0.75, 0.04, 0.02), weapon='claws', hunch=1.0, mange=1.0),
    'panzer':  dict(height=2.20, head=0.95, snout=0.95, ear=0.85, girth=1.38, belly=1.15, fur=(0.24, 0.21, 0.19),
                    skin=(0.70, 0.50, 0.47), eye=(0.01, 0.01, 0.01), weapon='cannon', hunch=0.15, mange=0.2),
    'boss':    dict(height=3.20, head=1.05, snout=0.95, ear=0.9, girth=1.42, belly=2.1, fur=(0.40, 0.34, 0.28),
                    skin=(0.80, 0.56, 0.52), eye=(0.02, 0.01, 0.0), weapon='gatling2', hunch=0.0, mange=0.1),
}
CLIPS = ['idle', 'walk', 'run', 'aim_idle', 'fire', 'reload', 'hurt', 'death_a', 'death_b', 'take_cover', 'melee', 'taunt']
BOSS_CLIPS = ['charge', 'slam']
S = 1.0  # metres per base unit for the kind being built (base rat = 1.7 m)
G = {}   # per-kind build context


def V(x, y, z):
    return Vector((x, y, z)) * S


# ---------------------------------------------------------------- textures (numpy, tileable)
def fnoise(n, fx, fy=None, seed=0):
    fy = fx if fy is None else fy
    w = np.random.default_rng(seed).standard_normal((n, n))
    kx = np.fft.fftfreq(n)[None, :] * n
    ky = np.fft.fftfreq(n)[:, None] * n
    filt = np.exp(-((kx / fx) ** 2 + (ky / fy) ** 2))
    r = np.real(np.fft.ifft2(np.fft.fft2(w) * filt))
    r -= r.min(); r /= max(r.max(), 1e-9)
    return r


def height_to_normal(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def save_png(name, rgb, noncolor=False):
    path = os.path.join(TEX, name + '.png')
    if not os.path.exists(path):
        n = rgb.shape[0]
        img = bpy.data.images.new(name + '_tmp', n, n, alpha=False)
        a = np.ones((n, n, 4), np.float32)
        a[..., :3] = np.clip(rgb, 0, 1)
        img.pixels.foreach_set(a.ravel())
        img.filepath_raw = path
        img.file_format = 'PNG'
        img.save()
        bpy.data.images.remove(img)
    img = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        img.colorspace_settings.name = 'Non-Color'
    return img


TEXN = 512


def tex_detail(kind_slot):
    """Return (height, albedo_mod, rough) arrays for a surface family."""
    n = TEXN
    fam = kind_slot
    if fam == 'fur':
        strands = fnoise(n, 90, 6, 1) * 0.6 + fnoise(n, 160, 14, 2) * 0.4
        clumps = fnoise(n, 10, 10, 3)
        h = strands * 0.7 + clumps * 0.3
        alb = 0.62 + 0.55 * strands * (0.6 + 0.4 * clumps)
        rough = 0.75 + 0.15 * (1 - strands)
    elif fam == 'skin':
        cells = fnoise(n, 60, 60, 4)
        h = cells
        alb = 0.85 + 0.25 * fnoise(n, 12, 12, 5) - 0.12 * (cells > 0.7)
        rough = 0.45 + 0.2 * cells
    elif fam == 'cloth':
        u = np.arange(n)[None, :] * (2 * np.pi * 96 / n)
        v = np.arange(n)[:, None] * (2 * np.pi * 96 / n)
        weave = 0.5 + 0.25 * np.sin(u + v) + 0.25 * np.sin(u - v) * np.sign(np.sin(v * 0.5))
        grime = fnoise(n, 6, 6, 6)
        h = weave * 0.6 + fnoise(n, 120, 120, 7) * 0.4
        alb = (0.85 + 0.15 * weave) * (1.0 - 0.28 * grime ** 2) * (0.9 + 0.2 * fnoise(n, 30, 30, 8))
        rough = 0.82 + 0.1 * grime
    elif fam == 'leather':
        creases = fnoise(n, 40, 40, 9)
        h = creases
        alb = 0.75 + 0.35 * fnoise(n, 8, 8, 10) - 0.2 * (np.abs(creases - 0.5) < 0.03)
        rough = 0.38 + 0.3 * creases
    elif fam == 'metal':
        scratches = fnoise(n, 200, 4, 11)
        pits = fnoise(n, 50, 50, 12)
        h = pits * 0.5 + scratches * 0.5
        alb = 0.8 + 0.25 * fnoise(n, 6, 6, 13) - 0.25 * (pits > 0.78)
        rough = 0.28 + 0.35 * fnoise(n, 10, 10, 14) + 0.2 * (scratches > 0.7)
    elif fam == 'wood':
        u = np.arange(n)[None, :] / n
        grain = fnoise(n, 3, 60, 15)
        rings = 0.5 + 0.5 * np.sin(2 * np.pi * (u * 6 + grain * 3))
        h = rings
        alb = 0.7 + 0.35 * rings
        rough = 0.5 + 0.2 * rings
    elif fam == 'cheese':
        rng = np.random.default_rng(16)
        yy, xx = np.mgrid[0:n, 0:n] / n
        holes = np.zeros((n, n))
        for _ in range(28):
            cx, cy, r = rng.random(), rng.random(), 0.015 + rng.random() * 0.05
            for ox in (-1, 0, 1):
                for oy in (-1, 0, 1):
                    d = np.sqrt((xx - cx - ox) ** 2 + (yy - cy - oy) ** 2)
                    holes = np.maximum(holes, np.clip(1 - d / r, 0, 1))
        h = 1 - holes ** 0.5
        alb = (0.9 + 0.1 * fnoise(n, 20, 20, 17)) * (1 - 0.45 * (holes > 0))
        rough = 0.35 + 0.3 * (holes > 0)
    else:
        h = fnoise(n, 30, 30, 18)
        alb = np.ones((n, n))
        rough = np.full((n, n), 0.5)
    return h, alb, np.clip(rough, 0.05, 1)


def emblem_rgb(n=512):
    yy, xx = np.mgrid[0:n, 0:n] / n
    rgb = np.zeros((n, n, 3)); rgb[...] = (0.55, 0.04, 0.04)
    cx = (xx * 2) % 1.0  # two emblems across U (bands wrap around arms)
    d = np.sqrt((cx - 0.5) ** 2 + ((yy - 0.5) * 2) ** 2)
    disc = d < 0.40
    rgb[disc] = (0.92, 0.9, 0.86)
    # black cheese wedge: triangle with three round holes
    px, py = cx - 0.5, (yy - 0.5) * 2
    tri = (py > -0.22) & (py < 0.22) & (px > -0.26) & (px < 0.26 - (py + 0.22) * 1.0) & disc
    holes = np.zeros_like(tri)
    for hx, hy, hr in ((-0.12, -0.05, 0.05), (0.0, -0.13, 0.035), (-0.15, 0.12, 0.03)):
        holes |= np.sqrt((px - hx) ** 2 + (py - hy) ** 2) < hr
    rgb[tri & ~holes] = (0.03, 0.03, 0.03)
    ring = (d > 0.40) & (d < 0.43)
    rgb[ring] = (0.05, 0.05, 0.05)
    return rgb


# ---------------------------------------------------------------- materials
MAT_DEFS = {}  # slot -> (family, tint, metallic, rough_mul, extra)


def make_material(slot, family, tint, metallic=0.0, rough_mul=1.0, emission=None, kind='x', alpha=None):
    m = bpy.data.materials.get(slot)
    if m:
        return m
    m = bpy.data.materials.new(slot)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    out = nt.nodes.get('Material Output')
    if family == 'emblem':
        img = save_png('emblem', emblem_rgb())
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = img
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.8
    elif family in ('eye', 'plain'):
        bsdf.inputs['Base Color'].default_value = (*tint, 1)
        bsdf.inputs['Roughness'].default_value = 0.08 * rough_mul if family == 'eye' else 0.45 * rough_mul
        bsdf.inputs['Metallic'].default_value = metallic
    else:
        h, alb, rough = tex_detail(family)
        key = '%s_%s' % (kind, slot)
        col = alb[..., None] * np.array(tint)[None, None, :]
        a = save_png('rat_%s_albedo' % key, col)
        nrm = save_png('rat_%s_normal' % family, height_to_normal(h, {'fur': 6, 'cloth': 4, 'metal': 2, 'cheese': 12}.get(family, 3)), True)
        orm = np.stack([np.ones_like(rough), np.clip(rough * rough_mul, 0.04, 1), np.full_like(rough, metallic)], -1)
        o = save_png('rat_%s_orm_%d_%d' % (family, int(rough_mul * 100), int(metallic * 100)), orm, True)
        ta = nt.nodes.new('ShaderNodeTexImage'); ta.image = a
        tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = n_img = nrm
        to = nt.nodes.new('ShaderNodeTexImage'); to.image = o
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 0.8
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        nt.links.new(to.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = 2.0
    m.diffuse_color = (*tint, 1)
    return m


def kind_materials(kind, k):
    fur = k['fur']
    if k['mange']:
        pass
    pal = {
        'mouse':   dict(tunic=(0.36, 0.38, 0.33), pants=(0.30, 0.32, 0.28), helmet=(0.30, 0.33, 0.28), leather=(0.20, 0.13, 0.08)),
        'trooper': dict(tunic=(0.34, 0.36, 0.32), pants=(0.27, 0.28, 0.26), helmet=(0.26, 0.29, 0.25), leather=(0.14, 0.10, 0.07)),
        'officer': dict(tunic=(0.06, 0.06, 0.065), pants=(0.12, 0.12, 0.13), helmet=(0.20, 0.21, 0.24), leather=(0.035, 0.032, 0.03)),
        'sewer':   dict(tunic=(0.2, 0.2, 0.2), pants=(0.2, 0.2, 0.2), helmet=(0.25, 0.25, 0.25), leather=(0.10, 0.07, 0.05)),
        'panzer':  dict(tunic=(0.22, 0.22, 0.21), pants=(0.18, 0.18, 0.17), helmet=(0.42, 0.42, 0.43), leather=(0.12, 0.08, 0.05)),
        'boss':    dict(tunic=(0.88, 0.86, 0.80), pants=(0.82, 0.80, 0.74), helmet=(0.95, 0.72, 0.30), leather=(0.08, 0.05, 0.03)),
    }[kind]
    wet = kind == 'sewer'
    M = {}
    M['fur'] = make_material('fur', 'fur', fur, 0.0, 0.82 if wet else 1.0, kind=kind)
    M['skin'] = make_material('skin', 'skin', k['skin'], 0.0, 0.6 if wet else 1.0, kind=kind)
    M['eye'] = make_material('eye', 'eye', k['eye'], 0.0, 1.0, emission=k['eye'] if kind in ('sewer',) else None)
    M['teeth'] = make_material('teeth', 'plain', (0.85, 0.55, 0.18))
    M['whisker'] = make_material('whisker', 'plain', (0.85, 0.83, 0.78) if kind != 'sewer' else (0.1, 0.09, 0.08))
    M['cloth_tunic'] = make_material('cloth_tunic', 'cloth', pal['tunic'], kind=kind)
    M['cloth_pants'] = make_material('cloth_pants', 'cloth', pal['pants'], kind=kind)
    M['leather'] = make_material('leather', 'leather', pal['leather'], kind=kind)
    metal_tint = pal['helmet']
    M['metal'] = make_material('metal', 'metal', metal_tint, 0.55 if kind in ('mouse', 'trooper') else 0.9, kind=kind)
    M['metal_gun'] = make_material('metal_gun', 'metal', (0.16, 0.16, 0.17), 1.0, 1.1, kind=kind)
    M['metal_gold'] = make_material('metal_gold', 'metal', (1.0, 0.76, 0.33), 1.0, 0.7, kind=kind)
    M['wood'] = make_material('wood', 'wood', (0.36, 0.20, 0.10), kind=kind)
    M['emblem'] = make_material('emblem', 'emblem', (1, 1, 1))
    M['cheese'] = make_material('cheese', 'cheese', (1.0, 0.78, 0.25), kind=kind)
    M['cloth_cape'] = make_material('cloth_cape', 'cloth', (0.50, 0.04, 0.05), kind=kind)
    M['glass'] = make_material('glass', 'eye', (0.05, 0.08, 0.06), 0.0, 1.0)
    M['ember'] = make_material('ember', 'plain', (0.9, 0.3, 0.05), emission=(1.0, 0.35, 0.05))
    return M


# ---------------------------------------------------------------- mesh helpers
class Parts:
    """Accumulates bmesh geometry with per-face material slot names."""

    def __init__(self):
        self.bm = bmesh.new()

    def add_bm(self, bm2, mat):
        me = bpy.data.meshes.new('tmp')
        bm2.to_mesh(me)
        bm2.free()
        self.add_mesh(me, mat)
        bpy.data.meshes.remove(me)

    def add_mesh(self, me, mat):
        n0 = len(self.bm.faces)
        self.bm.from_mesh(me)
        self.bm.faces.ensure_lookup_table()
        lay = self.bm.faces.layers.int.get('slot') or self.bm.faces.layers.int.new('slot')
        idx = slot_index(mat)
        for f in self.bm.faces[n0:]:
            f[lay] = idx


SLOTS = []


def slot_index(name):
    if name not in SLOTS:
        SLOTS.append(name)
    return SLOTS.index(name)


def bm_sphere(c, r, rot=None, seg=16, ring=10):
    bm = bmesh.new()
    rx, ry, rz = (r, r, r) if not hasattr(r, '__len__') else r
    m = Matrix.Translation(c) @ (rot.to_4x4() if rot else Matrix()) @ Matrix.Diagonal(Vector((rx, ry, rz, 1.0)))
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=1.0, matrix=m)
    return bm


def bm_capsule(a, b, ra, rb, seg=14):
    bm = bmesh.new()
    pts = []
    for c, r in ((a, ra), (b, rb)):
        for i in range(seg // 2 + 1):
            th = math.pi * i / (seg // 2)
            for j in range(seg):
                ph = 2 * math.pi * j / seg
                pts.append(c + Vector((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th))) * r)
    vs = [bm.verts.new(p) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs)
    junk = list({v for v in res['geom_interior'] + res['geom_unused'] if isinstance(v, bmesh.types.BMVert)})
    bmesh.ops.delete(bm, geom=junk, context='VERTS')
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return bm


def frame_from(d, up_hint=Vector((0, 0, 1))):
    d = d.normalized()
    up = up_hint if abs(d.dot(up_hint)) < 0.95 else Vector((0, 1, 0))
    x = d.cross(up).normalized()
    z = x.cross(d).normalized()
    return x, z


def bm_tube(points, radii, seg=8, cap=True, close_start=True):
    """Tube along a polyline; returns (bm, per-ring param). UV: u around, v along length."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    rings = []
    n = len(points)
    prev_x = None
    lengths = [0.0]
    for i in range(1, n):
        lengths.append(lengths[-1] + (points[i] - points[i - 1]).length)
    L = max(lengths[-1], 1e-6)
    for i, p in enumerate(points):
        d = (points[min(i + 1, n - 1)] - points[max(i - 1, 0)])
        if prev_x is None:
            x, z = frame_from(d)
        else:
            x = (prev_x - d.normalized() * prev_x.dot(d.normalized())).normalized()
            z = x.cross(d.normalized()).normalized()
        prev_x = x
        ring = [bm.verts.new(p + (x * math.cos(2 * math.pi * j / seg) + z * math.sin(2 * math.pi * j / seg)) * radii[i]) for j in range(seg)]
        rings.append(ring)
    for i in range(n - 1):
        for j in range(seg):
            f = bm.faces.new((rings[i][j], rings[i][(j + 1) % seg], rings[i + 1][(j + 1) % seg], rings[i + 1][j]))
            for lp, (a, b) in zip(f.loops, ((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                lp[uvl].uv = (a / seg, lengths[b] / L * (L / 0.05))
    if cap:
        for ring, rev in ((rings[0], True), (rings[-1], False)):
            if close_start or not rev:
                try:
                    bm.faces.new(list(reversed(ring)) if rev else ring)
                except ValueError:
                    pass
    return bm, [l / L for l in lengths]


def bm_lathe(profile, c, axis_rot=None, seg=24, deform=None):
    """profile: list of (r, z). Revolved around local Z, transformed to centre c."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * j / seg), r * math.sin(2 * math.pi * j / seg), z)) for j in range(seg)])
    for a, b in zip(rings[:-1], rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for j in range(seg):
                bm.faces.new((a[0], b[j], b[(j + 1) % seg]))
        elif len(b) == 1:
            for j in range(seg):
                bm.faces.new((a[j], a[(j + 1) % seg], b[0]))
        else:
            for j in range(seg):
                bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]))
    if deform:
        for v in bm.verts:
            v.co = deform(v.co)
    m = Matrix.Translation(c) @ (axis_rot.to_4x4() if axis_rot else Matrix())
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def bm_box(c, size, rot=None):
    bm = bmesh.new()
    m = Matrix.Translation(c) @ (rot.to_4x4() if rot else Matrix()) @ Matrix.Diagonal(Vector((*size, 1.0)))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
    return bm


def bm_cyl(a, b, r1, r2=None, seg=12):
    r2 = r1 if r2 is None else r2
    bm = bmesh.new()
    d = b - a
    rot = d.to_track_quat('Z', 'Y').to_matrix()
    m = Matrix.Translation((a + b) / 2) @ rot.to_4x4()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=d.length, matrix=m)
    return bm


def bm_torus(c, normal, R, r, seg=24, ring=8):
    pts = []
    x, z = frame_from(normal)
    for i in range(seg + 1):
        a = 2 * math.pi * i / seg
        pts.append(c + (x * math.cos(a) + z * math.sin(a)) * R)
    bm, _ = bm_tube(pts, [r] * len(pts), ring, cap=False)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=r * 0.3)
    return bm


def obj_from_bm(name, bm, mats, slot_layer=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def finish_parts(name, parts, smooth=True):
    """Turn a Parts accumulator into an object with material slots from SLOTS names."""
    bm = parts.bm
    lay = bm.faces.layers.int.get('slot')
    used = sorted({f[lay] for f in bm.faces}) if lay else []
    remap = {s: i for i, s in enumerate(used)}
    for f in bm.faces:
        f.material_index = remap[f[lay]] if lay else 0
        f.smooth = smooth
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for s in used:
        me.materials.append(G['M'][SLOTS[s]])
    return ob


def mesh_np(me):
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32); me.vertices.foreach_get('co', co)
    return co.reshape(-1, 3).astype(np.float64)


def box_uv(me, tile=0.3, only_missing=True):
    if me.uv_layers and only_missing:
        return
    uvl = me.uv_layers.new(name='UVMap') if not me.uv_layers else me.uv_layers[0]
    co = mesh_np(me)
    nl = len(me.loops)
    lv = np.empty(nl, np.int32); me.loops.foreach_get('vertex_index', lv)
    fn = np.empty(len(me.polygons) * 3, np.float32); me.polygons.foreach_get('normal', fn); fn = fn.reshape(-1, 3)
    ls = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('loop_start', ls)
    lt = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', lt)
    face_of_loop = np.repeat(np.arange(len(me.polygons)), lt)
    ax = np.argmax(np.abs(fn), 1)[face_of_loop]
    p = co[lv]
    uv = np.where(ax[:, None] == 0, p[:, [1, 2]], np.where(ax[:, None] == 1, p[:, [0, 2]], p[:, [0, 1]])) / tile
    uvl.data.foreach_set('uv', uv.astype(np.float32).ravel())


# ---------------------------------------------------------------- joints / armature
def make_joints(k):
    g, hs, sn, ear = k['girth'], k['head'], k['snout'], k['ear']
    top = 1.50 + 0.145 * hs
    global S
    S = k['height'] / top
    J = {}
    J['pelvis'] = V(0, 0, 0.92); J['spine0'] = V(0, 0.005, 1.03); J['chest0'] = V(0, 0.0, 1.19)
    J['neck0'] = V(0, -0.01, 1.39); J['head0'] = V(0, -0.035, 1.49)
    J['headtop'] = V(0, -0.06, 1.49 + 0.14 * hs)
    J['cranium'] = V(0, -0.055, 1.49 + 0.055 * hs)
    sw = 0.175 * g * max(1.0, k['belly'] ** 0.3)
    for sd, sx in (('L', 1), ('R', -1)):
        J['clav_' + sd] = V(0.035 * sx, 0.005, 1.335)
        J['shoulder_' + sd] = V(sw * sx, 0.012, 1.33)
        J['elbow_' + sd] = V((sw + 0.125) * sx, 0.03, 1.10)
        J['wrist_' + sd] = V((sw + 0.19) * sx, 0.0, 0.885)
        J['handtip_' + sd] = V((sw + 0.215) * sx, -0.015, 0.78)
        hx = 0.095 * g
        J['hip_' + sd] = V(hx * sx, 0.0, 0.88)
        J['knee_' + sd] = V((hx + 0.02) * sx, -0.035, 0.50)
        J['ankle_' + sd] = V((hx + 0.03) * sx, 0.025, 0.10)
        J['ball_' + sd] = V((hx + 0.035) * sx, -0.10, 0.03)
        J['toe_' + sd] = V((hx + 0.04) * sx, -0.165, 0.018)
        # head features (relative to head0, scaled by head size)
        J['ear_' + sd] = J['head0'] + V(0.075 * sx, 0.015, 0.105) * hs
        J['eartip_' + sd] = J['ear_' + sd] + V(0.03 * sx, 0.01, 0.11) * hs * ear
        J['eye_' + sd] = J['head0'] + V(0.052 * sx, -0.112, 0.068) * hs
    h0 = J['head0']
    J['snout_a'] = h0 + V(0, -0.085, 0.035) * hs
    J['nose'] = h0 + V(0, -0.10 - 0.17 * sn, 0.0) * hs
    J['jaw0'] = h0 + V(0, -0.045, -0.02) * hs
    J['jawtip'] = h0 + V(0, -0.075 - 0.13 * sn, -0.045) * hs
    # tail curve (Catmull-Rom resampled)
    ctrl = [V(0, 0.12 * g, 0.90), V(0, 0.28, 0.72), V(0.03, 0.46, 0.40), V(0.10, 0.66, 0.12),
            V(0.22, 0.88, 0.035), V(0.42, 1.02, 0.03), V(0.62, 1.05, 0.03)]
    J['tail'] = catmull(ctrl, 96)
    return J


def catmull(c, n):
    pts = [c[0]] + c + [c[-1]]
    out = []
    segs = len(c) - 1
    for i in range(n):
        t = i / (n - 1) * segs
        k = min(int(t), segs - 1); u = t - k
        p0, p1, p2, p3 = pts[k], pts[k + 1], pts[k + 2], pts[k + 3]
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3))
    return out


NTAIL = 8
FWD = Vector((0, -1, 0)); UP = Vector((0, 0, 1)); DOWN = Vector((0, 0, -1))


def bone_specs(J, k):
    g = k['girth']; hs = k['head']; b = k['belly']
    sp = []  # name, head, tail, parent, roll_vec, radius(base units), deform
    sp.append(('root', V(0, 0, 0), V(0, -0.15, 0), None, UP, 0.1, False))
    sp.append(('hips', J['pelvis'], J['spine0'], 'root', FWD, 0.15 * g * b ** 0.5, True))
    sp.append(('spine', J['spine0'], J['chest0'], 'hips', FWD, 0.15 * g * b ** 0.5, True))
    sp.append(('chest', J['chest0'], J['neck0'], 'spine', FWD, 0.165 * g, True))
    sp.append(('neck', J['neck0'], J['head0'], 'chest', FWD, 0.075 * g, True))
    sp.append(('head', J['head0'], J['headtop'], 'neck', FWD, 0.11 * hs, True))
    sp.append(('jaw', J['jaw0'], J['jawtip'], 'head', DOWN, 0.04 * hs, True))
    for sd in ('L', 'R'):
        sp.append(('ear_' + sd, J['ear_' + sd], J['eartip_' + sd], 'head', FWD, 0.03, True))
        sp.append(('shoulder_' + sd, J['clav_' + sd], J['shoulder_' + sd], 'chest', FWD, 0.08 * g, True))
        sp.append(('upper_arm_' + sd, J['shoulder_' + sd], J['elbow_' + sd], 'shoulder_' + sd, FWD, 0.06 * g, True))
        sp.append(('lower_arm_' + sd, J['elbow_' + sd], J['wrist_' + sd], 'upper_arm_' + sd, FWD, 0.045 * g, True))
        sp.append(('hand_' + sd, J['wrist_' + sd], J['handtip_' + sd], 'lower_arm_' + sd, FWD, 0.035 * g, True))
        sp.append(('thigh_' + sd, J['hip_' + sd], J['knee_' + sd], 'hips', FWD, 0.09 * g, True))
        sp.append(('shin_' + sd, J['knee_' + sd], J['ankle_' + sd], 'thigh_' + sd, FWD, 0.055 * g, True))
        sp.append(('foot_' + sd, J['ankle_' + sd], J['ball_' + sd], 'shin_' + sd, UP, 0.035 * g, True))
        sp.append(('toe_' + sd, J['ball_' + sd], J['toe_' + sd], 'foot_' + sd, UP, 0.02 * g, True))
    tp = J['tail']
    idx = [int(round(i * (len(tp) - 1) / NTAIL)) for i in range(NTAIL + 1)]
    for i in range(NTAIL):
        sp.append(('tail_%02d' % (i + 1), tp[idx[i]], tp[idx[i + 1]], 'hips' if i == 0 else 'tail_%02d' % i, UP, 0.03 * g, True))
    G['tail_idx'] = idx
    return sp


def build_armature(specs):
    arm = bpy.data.armatures.new('rat_rig')
    ob = bpy.data.objects.new('rat_rig', arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, h, t, par, roll, r, deform in specs:
        eb = arm.edit_bones.new(name)
        eb.head = h; eb.tail = t
        eb.align_roll(roll)
        eb.use_deform = deform
        if par:
            eb.parent = arm.edit_bones[par]
    # muzzle helpers (non-deform)
    for name, pos, d, par in G['muzzles']:
        eb = arm.edit_bones.new(name)
        eb.head = pos; eb.tail = pos + d.normalized() * 0.06 * S
        eb.align_roll(UP); eb.use_deform = False
        eb.parent = arm.edit_bones[par]
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


# ---------------------------------------------------------------- body
def body_primitives(J, k):
    g, hs, sn, b = k['girth'], k['head'], k['snout'], k['belly']
    P = Parts()
    add = lambda bm: P.add_bm(bm, 'fur')
    pel = J['pelvis']
    add(bm_sphere(pel + V(0, 0.01, -0.01), (0.155 * S * g * b ** 0.3, 0.135 * S * g * b ** 0.35, 0.125 * S)))
    add(bm_sphere(V(0, -0.03 * (b - 1) - 0.01, 1.03), (0.15 * S * g * b ** 0.35, 0.13 * S * g * b ** 0.9, 0.15 * S * b ** 0.45)))
    add(bm_sphere(V(0, 0.01, 1.235), (0.17 * S * g, 0.125 * S * g * max(1, b ** 0.4), 0.165 * S)))
    add(bm_capsule(pel, J['chest0'] + V(0, 0, 0.08), 0.12 * S * g, 0.13 * S * g))
    add(bm_capsule(J['chest0'] + V(0, 0.0, 0.10), J['head0'] + V(0, 0.01, 0.0), 0.085 * S * g, 0.07 * S * hs))
    for sd, sx in (('L', 1), ('R', -1)):
        add(bm_sphere(J['shoulder_' + sd] + V(-0.01 * sx, 0, 0.0), 0.072 * S * g))
        add(bm_capsule(J['shoulder_' + sd], J['elbow_' + sd], 0.06 * S * g, 0.045 * S * g))
        add(bm_capsule(J['elbow_' + sd], J['wrist_' + sd], 0.046 * S * g, 0.032 * S * g))
        add(bm_capsule(J['hip_' + sd] + V(0, 0.01, 0.02), J['knee_' + sd], 0.10 * S * g, 0.06 * S * g))
        add(bm_capsule(J['knee_' + sd], J['ankle_' + sd], 0.058 * S * g, 0.035 * S * g))
        mid = J['knee_' + sd].lerp(J['ankle_' + sd], 0.3) + V(0, 0.03, 0)
        add(bm_sphere(mid, (0.05 * S * g, 0.055 * S * g, 0.11 * S)))
    # head
    h0 = J['head0']
    add(bm_sphere(J['cranium'], (0.095 * S * hs, 0.11 * S * hs, 0.088 * S * hs)))
    add(bm_capsule(J['snout_a'], J['nose'] + V(0, 0.012, 0.006) * hs, 0.068 * S * hs, 0.024 * S * hs))
    add(bm_capsule(J['jaw0'] + V(0, -0.02, 0) * hs, J['jawtip'], 0.045 * S * hs, 0.018 * S * hs))
    for sx in (1, -1):
        add(bm_sphere(h0 + V(0.055 * sx, -0.07, 0.0) * hs, 0.052 * S * hs))
        add(bm_sphere(h0 + V(0.032 * sx, -0.15 * sn - 0.04, 0.012) * hs, (0.03 * S * hs, 0.05 * S * hs, 0.03 * S * hs)))
    return P


def remesh(ob, voxel, smooth_iter=6, target_tris=None):
    md = ob.modifiers.new('rm', 'REMESH'); md.mode = 'VOXEL'; md.voxel_size = voxel; md.use_smooth_shade = True
    sm = ob.modifiers.new('sm', 'SMOOTH'); sm.factor = 0.7; sm.iterations = smooth_iter
    apply_mods(ob)
    if target_tris:
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if tris > target_tris:
            dm = ob.modifiers.new('dec', 'DECIMATE'); dm.ratio = target_tris / tris
            apply_mods(ob)


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def bone_arrays(names):
    B = G['bones']
    A = np.array([B[n][0] for n in names]); Bt = np.array([B[n][1] for n in names]); R = np.array([B[n][2] for n in names])
    return A, Bt, R


def seg_dist(co, A, Bt):
    ab = Bt - A  # (nb,3)
    ap = co[:, None, :] - A[None]  # (n,nb,3)
    t = np.clip((ap * ab[None]).sum(-1) / np.maximum((ab * ab).sum(-1), 1e-12)[None], 0, 1)
    d = np.linalg.norm(ap - t[..., None] * ab[None], axis=-1)
    return d, t


BODY_BONES = None


def body_bone_list():
    names = ['hips', 'spine', 'chest', 'neck', 'head']
    for sd in ('L', 'R'):
        names += ['shoulder_' + sd, 'upper_arm_' + sd, 'lower_arm_' + sd, 'hand_' + sd, 'thigh_' + sd, 'shin_' + sd, 'foot_' + sd, 'toe_' + sd]
    return names


def labels(co):
    names = body_bone_list()
    A, Bt, R = bone_arrays(names)
    d, t = seg_dist(co, A, Bt)
    dn = d / R[None]
    lab = np.argmin(dn, 1)
    return names, lab, t[np.arange(len(co)), lab]


def soft_weights(co, names, power=6.0, top=3, jaw=False):
    A, Bt, R = bone_arrays(names)
    d, _ = seg_dist(co, A, Bt)
    dn = d / R[None]
    w = 1.0 / (dn + 0.15) ** power
    if top < len(names):
        cut = -np.sort(-w, 1)[:, top - 1:top]
        w = np.where(w >= cut, w, 0)
    w /= w.sum(1, keepdims=True)
    W = {n: w[:, i] for i, n in enumerate(names)}
    if jaw and 'head' in W:
        # lower jaw region: below the mouth line, in front of the hinge
        J = G['J']
        h0 = np.array(J['head0']); nose = np.array(J['nose']); j0 = np.array(J['jaw0'])
        y0, z0 = j0[1] - 0.005 * S, j0[2] + 0.025 * S
        y1, z1 = nose[1], nose[2] - 0.018 * S
        y, z = co[:, 1], co[:, 2]
        lt = np.clip((y - y0) / (y1 - y0), 0, 1.2)
        line = z0 + (z1 - z0) * lt
        fwd = y < y0 + 0.01 * S
        headish = W['head'] + W['neck'] * 0.0
        s = np.clip((line - z) / (0.012 * S) + 0.5, 0, 1) * fwd * (np.abs(co[:, 0]) < 0.09 * S * G['k']['head'])
        jw = headish * s
        W['head'] = W['head'] - jw
        W['jaw'] = jw
    return W


def assign_weights(ob, W):
    for n, w in W.items():
        vg = ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n)
        idx = np.nonzero(w > 0.004)[0]
        for i in idx:
            vg.add([int(i)], float(w[i]), 'REPLACE')


def rigid(ob, bone):
    vg = ob.vertex_groups.new(name=bone)
    vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')


# ---------------------------------------------------------------- shells (clothes from body)
def shell(name, mask, offset, mat, solid=0.0, tile=0.25, cyl_axis=None, normals_scale=None):
    body = G['body']
    me = body.data
    co = G['co']; nrm = G['nrm']
    keep = mask
    faces = [p.vertices[:] for p in me.polygons if all(keep[i] for i in p.vertices)]
    used = sorted({i for f in faces for i in f})
    if not faces:
        return None
    remap = {o: n for n, o in enumerate(used)}
    off = offset if not hasattr(offset, '__len__') else offset[used]
    verts = co[used] + nrm[used] * (np.array(off)[:, None] if hasattr(off, '__len__') else off)
    me2 = bpy.data.meshes.new(name)
    me2.from_pydata(verts.tolist(), [], [[remap[i] for i in f] for f in faces])
    me2.update()
    ob = bpy.data.objects.new(name, me2)
    bpy.context.scene.collection.objects.link(ob)
    me2.materials.append(G['M'][mat])
    if cyl_axis is not None:
        cyl_uv(me2, *cyl_axis)
    else:
        box_uv(me2, tile)
    if solid:
        md = ob.modifiers.new('so', 'SOLIDIFY'); md.thickness = solid * S; md.offset = -1.0
        md.use_rim = True
    for p in me2.polygons:
        p.use_smooth = True
    apply_mods(ob)
    G['cover'].append(mask)
    G['soft'].append(ob)
    return ob


def cyl_uv(me, a, b, vrange):
    uvl = me.uv_layers.new(name='UVMap')
    co = mesh_np(me)
    lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', lv)
    a = np.array(a); b = np.array(b); ax = (b - a) / np.linalg.norm(b - a)
    x, z = frame_from(Vector(ax))
    x = np.array(x); z = np.array(z)
    p = co[lv] - a
    ang = np.arctan2(p @ z, p @ x) / (2 * np.pi) + 0.5
    t = (p @ ax) / np.linalg.norm(b - a)
    v = (t - vrange[0]) / (vrange[1] - vrange[0])
    uvl.data.foreach_set('uv', np.stack([ang, v], 1).astype(np.float32).ravel())


def lab_mask(*names, tmin=-1, tmax=2):
    L = G['labnames']
    ids = [L.index(n) for n in names]
    return np.isin(G['lab'], ids) & (G['t'] >= tmin) & (G['t'] <= tmax)


def skirt(name, z_top, z_bot, mat, flare=0.07, open_front=False, seg=28, rings=9):
    """Coat skirt lofted around the hips/thighs, hanging (not split per leg)."""
    co = G['co'][lab_mask('hips', 'spine', 'chest', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R')]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    R = []
    for i in range(rings):
        f = i / (rings - 1)
        z = z_top + (z_bot - z_top) * f
        band = co[np.abs(co[:, 2] - z) < 0.03 * S]
        if len(band) == 0:
            band = co[np.abs(co[:, 2] - z_top) < 0.03 * S]
        cy = (band[:, 1].max() + band[:, 1].min()) / 2
        rx = np.abs(band[:, 0]).max() + (0.02 + flare * f) * S
        ry = (band[:, 1].max() - band[:, 1].min()) / 2 + (0.025 + flare * 0.8 * f) * S
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            wob = 1 + 0.025 * math.sin(a * 7 + f * 3) * f
            ring.append(bm.verts.new((rx * math.cos(a) * wob, cy + ry * math.sin(a) * wob, z)))
        R.append(ring)
    for i in range(rings - 1):
        for j in range(seg):
            if open_front and j == seg * 3 // 4:  # front slit (-Y)
                continue
            f = bm.faces.new((R[i][j], R[i][(j + 1) % seg], R[i + 1][(j + 1) % seg], R[i + 1][j]))
            f.smooth = True
            for lp, (u, v) in zip(f.loops, ((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                lp[uvl].uv = (u / seg * 6, v / rings * 3)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    me.materials.append(G['M'][mat])
    md = ob.modifiers.new('so', 'SOLIDIFY'); md.thickness = 0.006 * S; md.offset = 0
    apply_mods(ob)
    G['skirts'].append(ob)
    return ob


# ---------------------------------------------------------------- head details, hands, feet, tail
def head_details(J, k, props):
    hs, sn, ear = k['head'], k['snout'], k['ear']
    h0 = J['head0']
    nose = J['nose']
    props.append(('head', 'skin', bm_sphere(nose + V(0, -0.004, 0.008) * hs, (0.022 * S * hs, 0.018 * S * hs, 0.016 * S * hs))))
    for sd, sx in (('L', 1), ('R', -1)):
        e = J['eye_' + sd]
        props.append(('head', 'eye', bm_sphere(e, 0.019 * S * hs, seg=12, ring=8)))
        # ear: cupped two-sided disc
        base = J['ear_' + sd]; tip = J['eartip_' + sd]
        up = (tip - base).normalized()
        face = Vector((0.55 * sx, -1.0, 0.1)).normalized()
        side = up.cross(face).normalized(); face = side.cross(up).normalized()
        H = (tip - base).length; Wd = H * 0.95
        bm = bmesh.new()
        nr, na = 6, 18
        grid = []
        for i in range(nr + 1):
            r = i / nr
            row = []
            for j in range(na):
                a = 2 * math.pi * j / na
                lx, ly = math.cos(a) * r * Wd * 0.5, (math.sin(a) * r + 1.0) * H * 0.5
                cup = -0.28 * H * (1 - r * r) * 0.0 + 0.22 * H * r * r
                row.append(bm.verts.new(base + side * lx + up * ly + face * (cup - 0.05 * H)))
            grid.append(row)
        for i in range(nr):
            for j in range(na):
                if i == 0:
                    continue
                bm.faces.new((grid[i][j], grid[i][(j + 1) % na], grid[i + 1][(j + 1) % na], grid[i + 1][j]))
        bm.faces.new([grid[1][j] for j in range(na)])
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.006 * S)
        props.append(('ear_' + sd, 'skin', bm))
        # whiskers
        for w in range(6):
            root = h0 + V(0.03 * sx, -0.10 - 0.13 * sn, 0.0 + 0.008 * (w % 3) - 0.006) * hs
            dirv = Vector((sx * (0.9 + 0.15 * w), -0.25 + 0.12 * w, 0.18 - 0.09 * w)).normalized()
            L = (0.15 + 0.02 * (w % 3)) * S * hs
            pts = [root + dirv * L * f + Vector((0, 0, -1)) * (L * 0.18 * f * f) for f in np.linspace(0, 1, 6)]
            bm, _ = bm_tube(pts, list(np.linspace(0.0018, 0.0004, 6) * S), 3, cap=False)
            props.append(('head', 'whisker', bm))
    # incisors (orange, rat-like)
    tip = nose + V(0, 0.022, -0.03) * hs
    for sx in (1, -1):
        props.append(('head', 'teeth', bm_box(tip + V(0.0055 * sx, 0, 0) * hs, Vector((0.009, 0.006, 0.026)) * S * hs)))
        props.append(('jaw', 'teeth', bm_box(J['jawtip'] + V(0.004 * sx, 0.006, 0.012) * hs, Vector((0.007, 0.005, 0.018)) * S * hs)))


def hands_feet(J, k):
    P = Parts()
    g = k['girth']
    for sd, sx in (('L', 1), ('R', -1)):
        w = J['wrist_' + sd]; t = J['handtip_' + sd]
        d = (t - w).normalized()
        x, z = frame_from(d, Vector((0, -1, 0)))
        palm = w + (t - w) * 0.45
        rot = Matrix((x, d, z)).transposed()
        P.add_bm(bm_sphere(palm, (0.032 * S * g, 0.05 * S, 0.02 * S * g), rot=rot, seg=12, ring=8), 'skin')
        for f in range(4):
            a = (f - 1.5) * 0.45
            base = palm + d * 0.03 * S + x * (math.sin(a) * 0.022 * S * g)
            fd = (d * math.cos(a * 0.6) + x * math.sin(a * 0.6) * 0.6 + z * 0.35).normalized()
            L = (0.05 - 0.008 * abs(f - 1.5)) * S
            mid = base + fd * L
            end = mid + (fd + z * 0.9).normalized() * L * 0.6
            P.add_bm(bm_capsule(base, mid, 0.0085 * S, 0.007 * S, seg=8), 'skin')
            P.add_bm(bm_capsule(mid, end, 0.007 * S, 0.0055 * S, seg=8), 'skin')
            P.add_bm(bm_cyl(end, end + (fd + z).normalized() * 0.014 * S, 0.004 * S, 0.0005 * S, seg=6), 'teeth')
        # thumb
        tb = palm + z * 0.012 * S - x * 0.0
        P.add_bm(bm_capsule(palm, tb + d * 0.035 * S + z * 0.02 * S, 0.009 * S, 0.007 * S, seg=8), 'skin')
        # foot
        a = J['ankle_' + sd]; bl = J['ball_' + sd]
        fd = (bl - a); fd.z = 0; fd.normalize()
        fx = fd.cross(UP).normalized()
        rotf = Matrix((fx, fd, UP)).transposed()
        heel = a + V(0, 0.02, -0.06)
        P.add_bm(bm_capsule(heel, bl + V(0, 0, -0.005), 0.032 * S * g, 0.03 * S * g, seg=10), 'skin')
        P.add_bm(bm_sphere(heel.lerp(bl, 0.5) + V(0, 0, 0.005), (0.035 * S * g, 0.06 * S, 0.025 * S), rot=rotf, seg=10, ring=8), 'skin')
        for f in range(4):
            a2 = (f - 1.5) * 0.28
            tdir = (fd * math.cos(a2) + fx * math.sin(a2)).normalized()
            base = bl + fx * ((f - 1.5) * 0.017 * S * g)
            end = base + tdir * (0.065 - 0.01 * abs(f - 1.5)) * S
            end.z = 0.012 * S
            P.add_bm(bm_capsule(base, end, 0.011 * S, 0.008 * S, seg=8), 'skin')
            P.add_bm(bm_cyl(end, end + tdir * 0.018 * S + V(0, 0, -0.008), 0.006 * S, 0.0008 * S, seg=6), 'teeth')
    ob = finish_parts('hands_feet', P)
    box_uv(ob.data, 0.15)
    G['soft_extra'].append((ob, None))
    return ob


def tail(J, k):
    tp = J['tail']
    n = len(tp)
    g = k['girth']
    # dense resample for scale rings
    dense = catmull(tp[::4] + [tp[-1]], 180)
    L = sum((dense[i + 1] - dense[i]).length for i in range(len(dense) - 1))
    radii = []
    acc = 0.0
    for i, p in enumerate(dense):
        if i:
            acc += (p - dense[i - 1]).length
        u = min(1.0, acc / L)
        r = (0.036 * g * (1 - u) ** 0.85 + 0.004) * S
        ring = 1.0 + 0.05 * abs(math.sin(acc / (0.011 * S) * math.pi))
        radii.append(r * ring)
    bm, params = bm_tube(dense, radii, 10, cap=True)
    ob = obj_from_bm('tail', bm, None)
    ob.data.materials.append(G['M']['skin'])
    for p in ob.data.polygons:
        p.use_smooth = True
    # weights along the chain
    co = mesh_np(ob.data)
    tp_np = np.array(tp)
    idx = G['tail_idx']
    # param per vertex = nearest point on the bone chain
    names = ['tail_%02d' % (i + 1) for i in range(NTAIL)]
    A, Bt, R = bone_arrays(names)
    d, t = seg_dist(co, A, Bt)
    near = np.argmin(d, 1)
    tt = t[np.arange(len(co)), near]
    W = {nm: np.zeros(len(co)) for nm in names + ['hips']}
    for i in range(len(co)):
        b = near[i]; f = tt[i]
        if f > 0.5 and b < NTAIL - 1:
            W[names[b]][i] += 1.5 - f; W[names[b + 1]][i] += f - 0.5
        elif f < 0.5 and b > 0:
            W[names[b]][i] += 0.5 + f; W[names[b - 1]][i] += 0.5 - f
        elif f < 0.5 and b == 0:
            W[names[0]][i] += 0.5 + f; W['hips'][i] += 0.5 - f
        else:
            W[names[b]][i] += 1.0
    G['soft_extra'].append((ob, W))
    return ob


# ---------------------------------------------------------------- weapons (built in hand frame: x side, y forward, z up)
def hand_frame(side):
    w = G['J']['wrist_' + side]; t = G['J']['handtip_' + side]
    y = (t - w).normalized()
    z = (FWD - y * FWD.dot(y)).normalized()
    x = y.cross(z)
    grip = w + (t - w) * 0.5
    return Matrix((x, y, z)).transposed(), grip


def weapon_rifle(P, ws):
    bx = lambda c, s, m: P.add_bm(bm_box(Vector(c) * ws, Vector(s) * ws), m)
    cy = lambda a, b, r, m, r2=None: P.add_bm(bm_cyl(Vector(a) * ws, Vector(b) * ws, r * ws, (r2 or r) * ws), m)
    bx((0, -0.25, -0.03), (0.04, 0.32, 0.07), 'wood')    # stock
    bx((0, -0.42, -0.05), (0.045, 0.06, 0.12), 'wood')   # butt
    bx((0, 0.12, 0.035), (0.042, 0.52, 0.05), 'wood')    # fore-stock
    bx((0, 0.02, 0.07), (0.03, 0.20, 0.035), 'metal_gun')  # receiver
    cy((0, 0.0, 0.08), (0, 0.72, 0.08), 0.011, 'metal_gun', 0.009)  # barrel
    cy((0.03, -0.02, 0.08), (0.06, -0.02, 0.08), 0.007, 'metal_gun')  # bolt
    P.add_bm(bm_sphere(Vector((0.065, -0.02, 0.08)) * ws, 0.011 * ws), 'metal_gun')
    bx((0, 0.06, 0.02), (0.02, 0.06, 0.05), 'metal_gun')  # mag well / trigger guard
    cy((0, 0.72, 0.08), (0, 0.74, 0.08), 0.013, 'metal_gun')
    return Vector((0, 0.75, 0.08)) * ws


def weapon_smg(P, ws):
    bx = lambda c, s, m: P.add_bm(bm_box(Vector(c) * ws, Vector(s) * ws), m)
    cy = lambda a, b, r, m, r2=None: P.add_bm(bm_cyl(Vector(a) * ws, Vector(b) * ws, r * ws, (r2 or r) * ws), m)
    bx((0, 0.0, -0.02), (0.03, 0.05, 0.10), 'wood')       # pistol grip
    cy((0, -0.10, 0.06), (0, 0.24, 0.06), 0.022, 'metal_gun')  # receiver tube
    cy((0, 0.24, 0.06), (0, 0.40, 0.06), 0.012, 'metal_gun')
    cy((0, 0.24, 0.06), (0, 0.38, 0.06), 0.02, 'metal_gun')   # barrel shroud
    bx((0, 0.10, -0.05), (0.025, 0.035, 0.20), 'metal_gun')  # box magazine
    bx((0, -0.22, 0.04), (0.012, 0.22, 0.012), 'metal_gun')  # folding stock rails
    bx((0, -0.33, 0.0), (0.03, 0.012, 0.08), 'metal_gun')
    for i in range(6):
        cy((0, 0.25 + i * 0.022, 0.06), (0, 0.256 + i * 0.022, 0.06), 0.021, 'metal_gun')
    return Vector((0, 0.41, 0.06)) * ws


def weapon_pistol(P, ws):
    bx = lambda c, s, m, r=None: P.add_bm(bm_box(Vector(c) * ws, Vector(s) * ws, r), m)
    bx((0, -0.005, -0.02), (0.026, 0.035, 0.09), 'wood', Euler((math.radians(-20), 0, 0)).to_matrix())
    bx((0, 0.05, 0.035), (0.024, 0.16, 0.03), 'metal_gun')
    P.add_bm(bm_cyl(Vector((0, 0.1, 0.035)) * ws, Vector((0, 0.15, 0.035)) * ws, 0.007 * ws), 'metal_gun')
    P.add_bm(bm_sphere(Vector((0, -0.04, 0.04)) * ws, 0.012 * ws), 'metal_gun')
    return Vector((0, 0.15, 0.035)) * ws


def weapon_gatling(P, ws):
    cy = lambda a, b, r, m, r2=None: P.add_bm(bm_cyl(Vector(a) * ws, Vector(b) * ws, r * ws, (r2 or r) * ws), m)
    P.add_bm(bm_box(Vector((0, 0.0, -0.03)) * ws, Vector((0.035, 0.05, 0.11)) * ws), 'wood')
    cy((0, -0.15, 0.07), (0, 0.12, 0.07), 0.06, 'metal_gold')    # housing
    cy((0, -0.18, 0.07), (0, -0.15, 0.07), 0.045, 'metal_gun')
    for i in range(6):
        a = 2 * math.pi * i / 6
        o = (0.032 * math.cos(a), 0, 0.07 + 0.032 * math.sin(a))
        cy((o[0], 0.1, o[2]), (o[0], 0.62, o[2]), 0.011, 'metal_gun')
    for yy in (0.3, 0.55):
        cy((0, yy, 0.07), (0, yy + 0.02, 0.07), 0.05, 'metal_gold')
    P.add_bm(bm_cyl(Vector((0.07, -0.05, 0.07)) * ws, Vector((0.16, -0.05, 0.07)) * ws, 0.07 * ws, 0.07 * ws, seg=16), 'metal_gun')  # drum
    return Vector((0, 0.63, 0.07)) * ws


def build_weapons(kind, k):
    wt = k['weapon']
    G['muzzles'] = []
    ws = S
    objs = []
    if wt in ('rifle', 'smg', 'pistol', 'gatling2'):
        sides = ['R', 'L'] if wt == 'gatling2' else ['R']
        for sd in sides:
            P = Parts()
            fn = {'rifle': weapon_rifle, 'smg': weapon_smg, 'pistol': weapon_pistol, 'gatling2': weapon_gatling}[wt]
            muz = fn(P, ws * (0.9 if wt == 'gatling2' else 1.0))
            M, grip = hand_frame(sd)
            T = Matrix.Translation(grip) @ M.to_4x4()
            bmesh.ops.transform(P.bm, matrix=T, verts=P.bm.verts)
            ob = finish_parts('weapon_' + sd if wt == 'gatling2' else 'weapon', P, smooth=False)
            box_uv(ob.data, 0.15)
            rigid(ob, 'hand_' + sd)
            objs.append(ob)
            G['muzzles'].append(('muzzle_' + sd, T @ muz, M @ Vector((0, 1, 0)), 'hand_' + sd))
    elif wt == 'cannon':
        J = G['J']
        P = Parts()
        sh = J['shoulder_R'] + V(-0.13, 0.0, 0.12)
        a = sh + V(0, 0.45, -0.02); b = sh + V(0, -0.75, 0.0)
        P.add_bm(bm_cyl(a, b, 0.085 * S, 0.08 * S, seg=20), 'metal')
        P.add_bm(bm_cyl(b, b + V(0, -0.07, 0), 0.105 * S, 0.11 * S, seg=20), 'metal')  # muzzle bell
        P.add_bm(bm_cyl(b + V(0, -0.07, 0), b + V(0, -0.072, 0), 0.08 * S, 0.08 * S, seg=20), 'cheese')
        for f in (0.15, 0.5, 0.8):
            c = a.lerp(b, f)
            P.add_bm(bm_cyl(c, c + V(0, -0.03, 0), 0.092 * S, 0.092 * S, seg=20), 'metal_gun')
            for r in range(8):
                ang = 2 * math.pi * r / 8
                P.add_bm(bm_sphere(c + V(0.093 * math.cos(ang), -0.015, 0.093 * math.sin(ang)), 0.008 * S, seg=6, ring=4), 'metal_gun')
        P.add_bm(bm_box(a.lerp(b, 0.35) + V(0, 0, -0.13), Vector((0.04, 0.06, 0.14)) * S), 'wood')  # grip
        P.add_bm(bm_box(a + V(0, -0.05, 0.0), Vector((0.2, 0.18, 0.2)) * S), 'metal_gun')  # breech/hopper
        P.add_bm(bm_cyl(a + V(0, -0.05, 0.10), a + V(0, -0.05, 0.25), 0.07 * S, 0.09 * S, seg=14), 'metal')  # cheese hopper
        P.add_bm(bm_sphere(a + V(0, -0.05, 0.25), (0.085 * S, 0.085 * S, 0.04 * S)), 'cheese')
        for i, (dx, dz, L) in enumerate(((0.05, -0.07, 0.10), (-0.04, -0.08, 0.16), (0.0, -0.09, 0.07), (0.07, -0.03, 0.05))):
            top = b + V(dx, -0.08, dz)
            pts = [top + V(0, 0, -L * f) for f in np.linspace(0, 1, 5)]
            bmt, _ = bm_tube(pts, [0.016 * S, 0.013 * S, 0.011 * S, 0.012 * S, 0.016 * S], 8)
            P.add_bm(bmt, 'cheese')
            P.add_bm(bm_sphere(pts[-1], 0.018 * S, seg=8, ring=6), 'cheese')
        ob = finish_parts('weapon', P, smooth=False)
        box_uv(ob.data, 0.2)
        rigid(ob, 'chest')
        objs.append(ob)
        G['muzzles'].append(('muzzle_R', b + V(0, -0.08, 0), FWD, 'chest'))
    for sd in ('R', 'L'):
        if not any(m[0] == 'muzzle_' + sd for m in G['muzzles']):
            M, grip = hand_frame(sd)
            G['muzzles'].append(('muzzle_' + sd, grip + M @ Vector((0, 0.08, 0)) * S, M @ Vector((0, 1, 0)), 'hand_' + sd))
    return objs


# ---------------------------------------------------------------- outfits
def helmet(J, k, props, scale=1.0):
    hs = k['head']
    R = 0.118 * S * hs * scale
    c = J['cranium'] + V(0, 0.012, 0.025) * hs
    prof = [(0, 1.0), (0.35, 0.96), (0.65, 0.84), (0.88, 0.62), (1.0, 0.36), (1.04, 0.08), (1.08, -0.05),
            (1.2, -0.22), (1.26, -0.30), (1.22, -0.31), (1.12, -0.22), (1.0, -0.08), (0.96, 0.08), (0.93, 0.36), (0.85, 0.6), (0.6, 0.8), (0.0, 0.94)]
    prof = [(r * R, z * R) for r, z in prof]

    def deform(p):
        # front rim higher than the neck guard
        fwd = max(0.0, -p.y / max(R, 1e-6))
        if p.z < 0.1 * R:
            p.z += 0.22 * R * fwd * fwd * (0.1 * R - p.z) / (0.4 * R) * 2.0
        return p
    bm = bm_lathe(prof, c, Euler((math.radians(-8), 0, 0)).to_matrix(), seg=28, deform=deform)
    props.append(('head', 'metal', bm))
    # chinstrap
    for sx in (1, -1):
        a = c + Vector((0.95 * R * sx, 0.0, -0.15 * R))
        b = J['jaw0'] + V(0.035 * sx, -0.03, -0.035) * hs
        props.append(('head', 'leather', bm_tube([a, a.lerp(b, 0.5) + V(0.01 * sx, 0, 0), b], [0.005 * S] * 3, 4)[0]))
    # small side vent rivets
    for sx in (1, -1):
        props.append(('head', 'metal', bm_sphere(c + Vector((0.97 * R * sx, 0.1 * R, 0.25 * R)), 0.008 * S * scale, seg=8, ring=6)))


def peaked_cap(J, k, props):
    hs = k['head']
    R = 0.10 * S * hs
    c = J['cranium'] + V(0, 0.01, 0.055) * hs
    prof = [(0, 0.95), (0.9, 0.95), (1.28, 0.88), (1.32, 0.80), (1.18, 0.62), (1.0, 0.42), (1.0, 0.12), (0.96, 0.10), (0.96, 0.40), (0.0, 0.40)]
    prof = [(r * R, z * R) for r, z in prof]
    rot = Euler((math.radians(-10), 0, 0)).to_matrix()
    props.append(('head', 'leather', bm_lathe(prof, c, rot, seg=28)))
    band = [(1.015 * R, 0.13 * R), (1.015 * R, 0.40 * R)]
    bm = bm_lathe([(1.0 * R, 0.12 * R), (1.02 * R, 0.13 * R), (1.02 * R, 0.40 * R), (1.0 * R, 0.41 * R)], c, rot, seg=28)
    props.append(('head', 'cloth_cape', bm))
    # visor
    bm = bmesh.new()
    pts_out, pts_in = [], []
    for j in range(13):
        a = math.pi * (1.05 + 0.9 * j / 12)
        pts_in.append(Vector((math.cos(a) * R * 1.0, math.sin(a) * R * 1.0, 0.13 * R)))
        pts_out.append(Vector((math.cos(a) * R * 1.05, math.sin(a) * R * 1.55, 0.02 * R)))
    vi = [bm.verts.new(p) for p in pts_in]; vo = [bm.verts.new(p) for p in pts_out]
    for j in range(12):
        bm.faces.new((vi[j], vi[j + 1], vo[j + 1], vo[j]))
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.006 * S)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ rot.to_4x4(), verts=bm.verts)
    props.append(('head', 'leather', bm))
    # badge: cheese wedge emblem disc + gold cords
    front = c + rot @ Vector((0, -1.03 * R, 0.62 * R))
    props.append(('head', 'emblem', bm_cyl(front + V(0, 0.003, 0), front + V(0, -0.006, 0), 0.03 * S * hs, seg=16)))
    props.append(('head', 'metal_gold', bm_torus(c + rot @ Vector((0, 0, 0.27 * R)), rot @ Vector((0, 0, 1)), 1.03 * R, 0.005 * S, seg=32, ring=5)))


def goggles(J, k, props):
    hs = k['head']
    for sx in (1, -1):
        e = J['eye_' + sx_side(sx)] + V(0.004 * sx, -0.012, 0.012) * hs
        d = Vector((0.35 * sx, -1, 0.0)).normalized()
        props.append(('head', 'metal_gun', bm_cyl(e - d * 0.01 * S, e + d * 0.03 * S, 0.03 * S * hs, 0.028 * S * hs, seg=16)))
        props.append(('head', 'glass', bm_cyl(e + d * 0.028 * S, e + d * 0.034 * S, 0.024 * S * hs, seg=16)))
    c = J['cranium']
    props.append(('head', 'leather', bm_torus(c + V(0, 0.0, 0.0), Vector((0, 0.05, 1)), 0.104 * S * hs, 0.009 * S, seg=28, ring=4)))


def sx_side(sx):
    return 'L' if sx > 0 else 'R'


def outfit(kind, k, J, props):
    co, nrm = G['co'], G['nrm']
    z = co[:, 2]
    waist = 1.0 * S
    torso = lab_mask('hips', 'spine', 'chest')
    arms_u = lab_mask('shoulder_L', 'shoulder_R', 'upper_arm_L', 'upper_arm_R')
    arms_l = lab_mask('lower_arm_L', 'lower_arm_R', tmax=0.86)
    neck_lo = lab_mask('neck', tmax=0.35)
    legs = lab_mask('thigh_L', 'thigh_R') | lab_mask('shin_L', 'shin_R', tmax=0.86)
    if kind == 'sewer':
        c = J['neck0'].lerp(J['head0'], 0.35)
        props.append(('neck', 'leather', bm_torus(c, Vector((0, -0.25, 1)), 0.083 * S * k['girth'], 0.016 * S, seg=28, ring=6)))
        for i in range(10):
            a = 2 * math.pi * i / 10
            p = c + Vector((math.cos(a), math.sin(a), 0)) * 0.098 * S * k['girth']
            props.append(('neck', 'metal', bm_cyl(p, p + Vector((math.cos(a), math.sin(a), 0)) * 0.035 * S, 0.008 * S, 0.0008 * S, seg=8)))
        tag = c + V(0, -0.10, -0.05)
        bm = bmesh.new()
        tri = [Vector((-0.03, 0, 0.0)), Vector((0.03, 0, 0.0)), Vector((0.0, 0, -0.05))]
        vs = [bm.verts.new(tag + p * S) for p in tri]
        bm.faces.new(vs)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.012 * S)
        props.append(('neck', 'cheese', bm))
        return
    tunic_mask = (torso & (z > waist - 0.13 * S)) | arms_u | arms_l | neck_lo
    pants_mask = (torso & (z < waist + 0.04 * S)) | legs
    shell('cloth_pants', pants_mask, 0.010 * S, 'cloth_pants')
    tunic_mat = 'leather' if kind == 'officer' else 'cloth_tunic'
    shell('tunic', tunic_mask, 0.018 * S, tunic_mat)
    # cuffs
    cuff = lab_mask('lower_arm_L', 'lower_arm_R', tmin=0.74, tmax=0.86)
    shell('cuffs', cuff, 0.026 * S, 'metal_gold' if kind == 'boss' else tunic_mat)
    # belt + buckle
    belt = torso & (np.abs(z - waist) < 0.032 * S)
    shell('belt', belt, 0.03 * S, 'leather' if kind != 'officer' else 'metal_gun' if False else 'leather')
    bz = co[belt]
    front = bz[np.argmin(bz[:, 1])] if len(bz) else np.array([0, -0.15 * S, waist])
    props.append(('spine', 'metal', bm_box(Vector(front) + V(0, -0.03, 0), Vector((0.07, 0.012, 0.05)) * S)))
    if kind != 'boss':
        arm = lab_mask('upper_arm_L', tmin=0.30, tmax=0.55)
        a, b = G['bones']['upper_arm_L'][0], G['bones']['upper_arm_L'][1]
        shell('armband', arm, 0.026 * S, 'emblem', solid=0.002, cyl_axis=(a, b, (0.30, 0.55)))
    if kind in ('trooper', 'officer'):
        skirt('coat_skirt', waist - 0.06 * S, J['knee_L'].z + 0.05 * S, tunic_mat, flare=0.08, open_front=True)
    if kind in ('mouse', 'trooper'):
        helmet(J, k, props, scale=1.22 if kind == 'mouse' else 1.0)
        # ammo pouches on the belt
        for sx in (1, -1):
            for i in range(2 if kind == 'mouse' else 3):
                p = Vector((sx * (0.07 + i * 0.045) * S * k['girth'], 0, waist))
                bz2 = co[belt & (np.abs(co[:, 0] - p.x) < 0.02 * S) & (co[:, 1] < 0)]
                y = bz2[:, 1].min() if len(bz2) else -0.15 * S
                props.append(('spine', 'leather', bm_box(Vector((p.x, y - 0.025 * S, waist - 0.01 * S)), Vector((0.04, 0.03, 0.055)) * S)))
    if kind == 'trooper':
        # diagonal bandolier with cartridges
        p0 = np.array(J['shoulder_L']); p1 = np.array(Vector((-0.12 * S, 0, 0.96 * S)))
        d = p1 - p0; n = np.array([d[2], 0, -d[0]]); n /= np.linalg.norm(n)
        strap = (torso | lab_mask('shoulder_L')) & (np.abs((co - p0) @ n) < 0.028 * S) & (z > waist + 0.02 * S)
        shell('bandolier', strap, 0.032 * S, 'leather')
        sel = np.nonzero(strap & (co[:, 1] < -0.05 * S))[0]
        for i in sel[::max(1, len(sel) // 9)][:9]:
            p = Vector(co[i] + nrm[i] * 0.045 * S)
            props.append(('chest', 'metal_gold', bm_cyl(p - Vector(n) * 0.012 * S, p + Vector(n) * 0.012 * S, 0.0065 * S, seg=6)))
    if kind == 'officer':
        peaked_cap(J, k, props)
        # monocle on the right eye + chain
        e = J['eye_R'] + V(-0.004, -0.016, 0.002)
        props.append(('head', 'metal_gold', bm_torus(e, Vector((-0.3, -1, 0)), 0.021 * S, 0.0022 * S, seg=24, ring=4)))
        props.append(('head', 'glass', bm_cyl(e + V(0, 0.001, 0), e + V(0, -0.001, 0), 0.02 * S, seg=16)))
        # shoulder boards + collar tabs
        for sd in ('L', 'R'):
            sh = J['shoulder_' + sd] + V(0, 0, 0.065 * k['girth'])
            props.append(('shoulder_' + sd, 'metal_gold', bm_box(sh, Vector((0.09, 0.045, 0.01)) * S)))
        # holster on the right hip
        props.append(('hips', 'leather', bm_box(J['hip_R'] + V(-0.09, 0.02, 0.06), Vector((0.035, 0.08, 0.13)) * S)))
    if kind == 'panzer':
        chest_front = lab_mask('chest', 'spine') & (z > waist + 0.03 * S) & (z < J['neck0'].z) & (nrm[:, 1] < 0.35)
        plate = shell('breastplate', chest_front, 0.05 * S, 'metal', solid=0.012)
        back = lab_mask('chest', 'spine') & (z > waist + 0.06 * S) & (z < J['neck0'].z - 0.02 * S) & (nrm[:, 1] > 0.5)
        shell('backplate', back, 0.05 * S, 'metal', solid=0.012)
        # rivets along plate edges and a centre ridge
        sel = np.nonzero(chest_front & (co[:, 1] < -0.02 * S))[0]
        rng = np.random.default_rng(3)
        rim = [i for i in sel if abs(co[i, 0]) > 0.12 * S * k['girth'] or abs(co[i, 2] - (waist + 0.05 * S)) < 0.02 * S]
        for i in (rim[::max(1, len(rim) // 26)][:26] if rim else []):
            p = Vector(co[i] + nrm[i] * 0.066 * S)
            props.append(('chest', 'metal_gun', bm_sphere(p, 0.009 * S, seg=8, ring=5)))
        for sd, sx in (('L', 1), ('R', -1)):
            sh = J['shoulder_' + sd] + V(0.02 * sx, 0, 0.03)
            for i in range(2):
                props.append(('shoulder_' + sd, 'metal', bm_sphere(sh + V(0.012 * sx * i, 0, -0.035 * i), (0.075 * S * k['girth'] - 0.006 * S * i, 0.08 * S * k['girth'], 0.035 * S), seg=14, ring=8)))
        goggles(J, k, props)
    if kind == 'boss':
        # cheese-plate armour: breastplate and pauldrons in cheese, gold trim
        chest_front = lab_mask('chest', 'spine') & (z > waist + 0.05 * S) & (z < J['neck0'].z - 0.01 * S) & (nrm[:, 1] < 0.2)
        shell('cheese_plate', chest_front, 0.045 * S, 'cheese', solid=0.03)
        for sd, sx in (('L', 1), ('R', -1)):
            sh = J['shoulder_' + sd] + V(0.02 * sx, 0, 0.04)
            props.append(('shoulder_' + sd, 'cheese', bm_sphere(sh, (0.11 * S * k['girth'], 0.11 * S * k['girth'], 0.065 * S), seg=16, ring=10)))
            props.append(('shoulder_' + sd, 'metal_gold', bm_torus(sh + V(0, 0, -0.015), Vector((0, 0, 1)), 0.105 * S * k['girth'], 0.007 * S, seg=28, ring=5)))
            for f in range(7):  # epaulette fringe
                a = math.pi * (0.15 + 0.7 * f / 6)
                p = sh + Vector((math.cos(a) * sx * 0.0 + sx * 0.10 * S * k['girth'] * math.sin(a), -math.cos(a) * 0.10 * S * k['girth'], -0.04 * S))
                props.append(('shoulder_' + sd, 'metal_gold', bm_cyl(p, p + V(0, 0, -0.06), 0.006 * S, seg=6)))
        # aiguillette across the chest
        pts = [J['shoulder_R'] + V(0.02, -0.08, 0.0), J['chest0'] + V(-0.07, -0.20 * k['girth'], 0.02), J['chest0'] + V(0.05, -0.21 * k['girth'], -0.02)]
        props.append(('chest', 'metal_gold', bm_tube(catmull(pts, 10), [0.007 * S] * 10, 5)[0]))
        # medals
        for i in range(4):
            p = J['chest0'] + V(0.06 + 0.035 * (i % 2), -0.19 * k['girth'] - 0.02, 0.07 - 0.05 * (i // 2))
            props.append(('chest', 'cloth_cape', bm_box(p + V(0, 0, 0.02), Vector((0.02, 0.008, 0.025)) * S)))
            props.append(('chest', 'metal_gold', bm_cyl(p + V(0, 0.002, -0.01), p + V(0, -0.006, -0.01), 0.014 * S, seg=12)))
        # cheese-wheel crown with wedge cut and gold rim
        c = J['cranium'] + V(0, 0.015, 0.07)
        R = 0.10 * S * k['head']
        prof = [(0, 0.55 * R), (0.95 * R, 0.55 * R), (1.0 * R, 0.5 * R), (1.0 * R, 0.0), (0.95 * R, -0.05 * R), (0, -0.05 * R)]
        props.append(('head', 'cheese', bm_lathe(prof, c, Euler((math.radians(-8), 0, 0)).to_matrix(), seg=32)))
        props.append(('head', 'metal_gold', bm_torus(c + V(0, 0, 0.0), Vector((0, -0.14, 1)), 1.01 * R, 0.008 * S, seg=32, ring=5)))
        for i in range(8):
            a = 2 * math.pi * i / 8
            p = c + Vector((math.cos(a) * R, math.sin(a) * R, 0.55 * R))
            props.append(('head', 'metal_gold', bm_cyl(p, p + V(0, 0, 0.035), 0.012 * S, 0.002 * S, seg=6)))
        # cigar with ember
        m = J['jaw0'].lerp(J['jawtip'], 0.6) + V(-0.03, -0.01, 0.02)
        a, b = m, m + V(-0.09, -0.08, -0.01)
        props.append(('head', 'leather', bm_cyl(a, b, 0.011 * S, seg=10)))
        props.append(('head', 'ember', bm_cyl(b, b + (b - a).normalized() * 0.006 * S, 0.0105 * S, seg=10)))
        # cape
        cape(J, k)


def cape(J, k):
    co = G['co']
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    rows, cols = 10, 16
    top_z = J['neck0'].z - 0.02 * S
    bot_z = J['knee_L'].z - 0.05 * S
    grid = []
    for i in range(rows):
        f = i / (rows - 1)
        z = top_z + (bot_z - top_z) * f
        band = co[(np.abs(co[:, 2] - z) < 0.04 * S) & (co[:, 1] > 0)]
        ymax = band[:, 1].max() if len(band) else 0.2 * S
        xw = (np.abs(band[:, 0]).max() if len(band) else 0.3 * S)
        width = max(J['shoulder_L'].x * 1.15, xw) + 0.06 * S * f
        row = []
        for j in range(cols):
            u = j / (cols - 1) * 2 - 1
            fold = 0.025 * S * math.sin(u * math.pi * 3.5) * f
            y = ymax + 0.05 * S + 0.05 * S * f - 0.18 * S * (abs(u) ** 2.2) * (1 - 0.3 * f) + fold
            row.append(bm.verts.new((u * width, y, z)))
        grid.append(row)
    for i in range(rows - 1):
        for j in range(cols - 1):
            fc = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            fc.smooth = True
            for lp, (u, v) in zip(fc.loops, ((j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i))):
                lp[uvl].uv = (u / cols * 4, v / rows * 4)
    me = bpy.data.meshes.new('cape'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('cape', me); bpy.context.scene.collection.objects.link(ob)
    me.materials.append(G['M']['cloth_cape'])
    md = ob.modifiers.new('so', 'SOLIDIFY'); md.thickness = 0.008 * S
    apply_mods(ob)
    G['capes'].append(ob)


# ---------------------------------------------------------------- build one kind
def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    SLOTS.clear()


def build(kind):
    clear_scene()
    k = KINDS[kind]
    G.clear(); G['k'] = k; G['kind'] = kind
    G['cover'] = []; G['soft'] = []; G['soft_extra'] = []; G['skirts'] = []; G['capes'] = []
    G['M'] = kind_materials(kind, k)
    J = make_joints(k); G['J'] = J
    specs = bone_specs(J, k)
    G['bones'] = {s[0]: (np.array(s[1]), np.array(s[2]), s[5] * S) for s in specs}
    weapons = build_weapons(kind, k)
    rig = build_armature(specs)
    # body
    P = body_primitives(J, k)
    body = finish_parts('body', P)
    remesh(body, 0.0105 * S, smooth_iter=5, target_tris={'boss': 33000, 'panzer': 16000}.get(kind, 21000))
    me = body.data
    me.materials.clear(); me.materials.append(G['M']['fur'])
    co = mesh_np(me)
    if k['mange'] > 0:
        nrm0 = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('normal', nrm0); nrm0 = nrm0.reshape(-1, 3)
        rng = np.random.default_rng(7)
        # clumpy, matted fur: low-frequency bumps along normals
        f1 = np.sin(co @ np.array([31.0, 17.0, 23.0]) / S) * np.sin(co @ np.array([-13.0, 29.0, 19.0]) / S)
        f2 = np.sin(co @ np.array([71.0, -53.0, 61.0]) / S)
        co = co + nrm0 * ((0.004 * f1 + 0.002 * f2) * S * k['mange'])[:, None]
        me.vertices.foreach_set('co', co.astype(np.float32).ravel())
        me.update()
    nrm = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('normal', nrm)
    G['body'] = body; G['co'] = co; G['nrm'] = nrm.reshape(-1, 3).astype(np.float64)
    names, lab, t = labels(co)
    G['labnames'] = names; G['lab'] = lab; G['t'] = t
    props = []
    head_details(J, k, props)
    outfit(kind, k, J, props)
    # delete body faces fully hidden under clothes (eroded by two rings so seams stay closed)
    if G['cover']:
        cov = np.zeros(len(co), bool)
        for m in G['cover']:
            cov |= m
        ev = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get('vertices', ev); ev = ev.reshape(-1, 2)
        for _ in range(3):
            bad = ~cov
            nb = np.zeros(len(co), bool)
            nb[ev[bad[ev[:, 0]], 1]] = True; nb[ev[bad[ev[:, 1]], 0]] = True
            cov &= ~nb
        bm = bmesh.new(); bm.from_mesh(me)
        kill = [f for f in bm.faces if all(cov[v.index] for v in f.verts)]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(me); bm.free()
        co = mesh_np(me)
    box_uv(me, 0.3)
    hands_feet(J, k)
    tl = tail(J, k)
    # weights
    bb = body_bone_list()
    assign_weights(body, soft_weights(co, bb, jaw=True))
    for ob in G['soft']:
        assign_weights(ob, soft_weights(mesh_np(ob.data), bb))
    for ob, W in G['soft_extra']:
        if W is None:
            W = soft_weights(mesh_np(ob.data), bb)
        assign_weights(ob, W)
    for ob in G['skirts']:
        cs = mesh_np(ob.data)
        W = soft_weights(cs, ['hips', 'thigh_L', 'thigh_R', 'shin_L', 'shin_R'], power=3, top=3)
        hip = W['hips']
        for n in W:
            W[n] = W[n] * 0.45 + (0.55 if n == 'hips' else 0.0)
        assign_weights(ob, W)
    for ob in G['capes']:
        cs = mesh_np(ob.data)
        assign_weights(ob, soft_weights(cs, ['chest', 'spine', 'hips', 'shoulder_L', 'shoulder_R', 'thigh_L', 'thigh_R'], power=3, top=3))
    prop_objs = []
    for i, (bone, mat, bm) in enumerate(props):
        P2 = Parts(); P2.add_bm(bm, mat)
        ob = finish_parts('prop_%d' % i, P2, smooth=mat not in ('metal_gun',))
        box_uv(ob.data, 0.2)
        if bone == 'head' and mat in ('leather',) and False:
            pass
        rigid(ob, bone)
        prop_objs.append(ob)
    # join everything except weapons into LOD0
    parts = [body] + G['soft'] + [o for o, _ in G['soft_extra']] + G['skirts'] + G['capes'] + prop_objs
    for o in parts:
        if not o.data.uv_layers:
            box_uv(o.data, 0.25)
        if o.data.uv_layers[0].name != 'UVMap':
            o.data.uv_layers[0].name = 'UVMap'
        while len(o.data.uv_layers) > 1:
            o.data.uv_layers.remove(o.data.uv_layers[1])
    print('PARTS', sorted([(o.name, tri_count(o)) for o in parts], key=lambda x: -x[1])[:12])
    lod0 = join(parts, 'rat_%s_LOD0' % kind)
    lod1 = lod0.copy(); lod1.data = lod0.data.copy(); lod1.name = 'rat_%s_LOD1' % kind
    bpy.context.scene.collection.objects.link(lod1)
    t0 = tri_count(lod0)
    dm = lod1.modifiers.new('dec', 'DECIMATE'); dm.ratio = min(1.0, 10000 / t0)
    apply_mods(lod1)
    lod1.data.validate()
    lod0.data.validate()
    for o in [lod0, lod1] + weapons:
        o.parent = rig
        md = o.modifiers.new('Armature', 'ARMATURE'); md.object = rig
        normalize_groups(o)
    stats = dict(lod0=t0, lod1=tri_count(lod1), weapon=sum(tri_count(w) for w in weapons))
    to_game_frame(rig, [lod0, lod1] + weapons)
    animate(rig, kind, k)
    return rig, lod0, lod1, weapons, stats


def godot_name(n):
    side = {'L': 'Left', 'R': 'Right'}
    base = {'root': 'Root', 'hips': 'Hips', 'spine': 'Spine', 'chest': 'Chest', 'neck': 'Neck', 'head': 'Head', 'jaw': 'Jaw',
            'ear': 'Ear', 'shoulder': 'Shoulder', 'upper_arm': 'UpperArm', 'lower_arm': 'LowerArm', 'hand': 'Hand',
            'thigh': 'UpperLeg', 'shin': 'LowerLeg', 'foot': 'Foot', 'toe': 'Toes', 'muzzle': 'Muzzle'}
    if n.startswith('tail_'):
        return 'Tail%d' % int(n[5:])
    if n[-2:] in ('_L', '_R'):
        return side[n[-1]] + base[n[:-2]]
    return base[n]


def to_game_frame(rig, objs):
    """Turn to face +Y (glTF/Godot -Z, contract section 4; same frame as hero.py) and rename bones to the
    Godot SkeletonProfileHumanoid names hero.py uses (Hips, LeftUpperArm, Tail1, ...)."""
    R = Matrix.Rotation(math.pi, 4, 'Z')
    for o in objs:
        o.data.transform(R)
    rig.data.transform(R)
    for o in objs:
        for vg in o.vertex_groups:
            vg.name = godot_name(vg.name)
    for b in rig.data.bones:
        b.name = godot_name(b.name)


def normalize_groups(ob):
    names = {vg.index: vg.name for vg in ob.vertex_groups}
    for v in ob.data.vertices:
        s = sum(g.weight for g in v.groups)
        if s <= 0:
            continue
        for g in v.groups:
            g.weight /= s
    unweighted = sum(1 for v in ob.data.vertices if not v.groups)
    if unweighted:
        vg = ob.vertex_groups.get('hips') or ob.vertex_groups.new(name='hips')
        vg.add([v.index for v in ob.data.vertices if not v.groups], 1.0, 'REPLACE')


def join(objs, name):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    act = objs[0]
    bpy.context.view_layer.objects.active = act
    with bpy.context.temp_override(active_object=act, selected_editable_objects=objs, selected_objects=objs, object=act):
        bpy.ops.object.join()
    act.name = name; act.data.name = name
    return act


def tri_count(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


# ---------------------------------------------------------------- animation
MIRROR = lambda r: (r[0], -r[1], -r[2])


def stance(kind, k, aim=0.0):
    """Arm/torso pose for weapon handling; aim 0 = carry, 1 = aimed."""
    wt = k['weapon']
    L = lambda a, b: a + (b - a) * aim
    p = {}
    if wt == 'rifle':
        p['upper_arm_R'] = (L(18, 68), 0, L(-10, -14)); p['lower_arm_R'] = (L(72, 22), 0, 0); p['hand_R'] = (L(0, 0), 0, 0)
        p['upper_arm_L'] = (L(32, 58), 0, L(-32, -40)); p['lower_arm_L'] = (L(70, 38), 0, 0)
        p['head'] = (L(0, 9), L(0, -6), 0); p['chest'] = (0, L(0, 8), 0)
    elif wt == 'smg':
        p['upper_arm_R'] = (L(15, 28), 0, L(-8, -8)); p['lower_arm_R'] = (L(70, 62), 0, 0)
        p['upper_arm_L'] = (L(25, 40), 0, L(-28, -32)); p['lower_arm_L'] = (L(75, 62), 0, 0)
        p['chest'] = (L(0, 4), L(0, 6), 0)
    elif wt == 'pistol':
        p['upper_arm_R'] = (L(10, 86), 0, L(-4, -6)); p['lower_arm_R'] = (L(55, 4), 0, 0)
        p['upper_arm_L'] = (-22, 0, -10); p['lower_arm_L'] = (85, 0, 0)  # hand behind the back
        p['head'] = (L(-3, 2), 0, 0); p['spine'] = (-3, 0, 0)
    elif wt == 'claws':
        for sd in ('L', 'R'):
            p['upper_arm_' + sd] = (L(40, 62), 0, L(-6, -10)); p['lower_arm_' + sd] = (L(48, 30), 0, 0); p['hand_' + sd] = (L(10, -10), 0, 0)
    elif wt == 'cannon':
        p['upper_arm_R'] = (L(32, 40), 0, L(2, 4)); p['lower_arm_R'] = (L(105, 112), 0, 0)
        p['upper_arm_L'] = (L(42, 55), 0, L(-26, -30)); p['lower_arm_L'] = (L(80, 70), 0, 0)
        p['chest'] = (0, L(0, 5), 0); p['head'] = (L(0, 4), 0, 0)
    elif wt == 'gatling2':
        for sd in ('L', 'R'):
            p['upper_arm_' + sd] = (L(12, 26), 0, L(14, 10)); p['lower_arm_' + sd] = (L(70, 64), 0, 0)
    h = k['hunch']
    if h:
        add(p, 'spine', (18 * h, 0, 0)); add(p, 'chest', (14 * h, 0, 0)); add(p, 'neck', (-14 * h, 0, 0)); add(p, 'head', (-18 * h, 0, 0))
        for sd in ('L', 'R'):
            add(p, 'thigh_' + sd, (22 * h, 0, 0)); add(p, 'shin_' + sd, (-34 * h, 0, 0)); add(p, 'foot_' + sd, (12 * h, 0, 0))
    p['_drop'] = leg_drop(22 * h, -34 * h)
    return p


def leg_drop(tx, sx):
    J = G['J']
    Lt = (J['hip_L'] - J['knee_L']).length; Ls = (J['knee_L'] - J['ankle_L']).length
    a1 = math.radians(tx); a2 = math.radians(tx + sx)
    return (Lt + Ls) - (Lt * math.cos(a1) + Ls * math.cos(a2))


def add(p, b, r):
    o = p.get(b, (0, 0, 0))
    p[b] = (o[0] + r[0], o[1] + r[1], o[2] + r[2])


def merged(base, over):
    p = dict(base)
    for b, r in over.items():
        if b.startswith('_'):
            p[b] = r if b != '_drop' else p.get(b, 0) + r
        else:
            add(p, b, r)
    return p


def tail_wave(p, t, amp=10, speed=1.0, lift=0.0):
    for i in range(NTAIL):
        add(p, 'tail_%02d' % (i + 1), (lift * (1 - i / NTAIL), amp * math.sin(2 * math.pi * t * speed - i * 0.55), 0))


def walk_pose(t, amp, knee, bob, lean):
    p = {}
    ph = 2 * math.pi * t
    for sd, s in (('L', 1), ('R', -1)):
        sw = math.sin(ph) * s
        p['thigh_' + sd] = (amp * sw + lean * 0.4, 0, 0)
        p['shin_' + sd] = (-8 - knee * max(0.0, math.cos(ph) * s), 0, 0)
        p['foot_' + sd] = (-0.35 * amp * sw * 0.5 + 6 * max(0, -math.cos(ph) * s), 0, 0)
    p['hips'] = (lean * 0.3, 6 * math.sin(ph), 0)
    p['spine'] = (lean * 0.4, -4 * math.sin(ph), 0)
    p['chest'] = (lean * 0.3, -3 * math.sin(ph), 0)
    p['head'] = (-lean * 0.5, 2 * math.sin(ph), 0)
    p['_bob'] = bob * (1 - abs(math.cos(ph))) - bob * 0.5
    return p


def clip_frames(clip, kind, k):
    carry = stance(kind, k, 0.0)
    aim = stance(kind, k, 1.0)
    out = []  # (frame, pose)
    if clip == 'idle':
        for i in range(9):
            t = i / 8
            p = merged(carry, {'chest': (2 * math.sin(2 * math.pi * t), 0, 0), 'head': (0, 6 * math.sin(2 * math.pi * t * 0.5 + 0.3) if i < 8 else 6 * math.sin(0.3), 0),
                               'ear_L': (8 * max(0, math.sin(2 * math.pi * t * 2)) ** 4, 0, 0)})
            tail_wave(p, t, 8)
            out.append((round(t * 60), p))
    elif clip in ('walk', 'run', 'charge'):
        n, dur, amp, knee, bob, lean = {'walk': (8, 32, 26, 40, 0.03, 4), 'run': (8, 20, 42, 80, 0.06, 14), 'charge': (8, 18, 46, 85, 0.08, 24)}[clip]
        for i in range(n + 1):
            t = i / n
            p = merged(carry, walk_pose(t, amp, knee, bob * S, lean))
            if clip == 'charge':
                for sd in ('L', 'R'):
                    add(p, 'upper_arm_' + sd, (-20, 0, 6))
            if k['weapon'] == 'claws':
                s = math.sin(2 * math.pi * t)
                add(p, 'upper_arm_L', (-25 * s, 0, 0)); add(p, 'upper_arm_R', (25 * s, 0, 0))
            tail_wave(p, t, 14 if clip == 'walk' else 20)
            out.append((round(t * dur), p))
    elif clip == 'aim_idle':
        for i in range(5):
            t = i / 4
            p = merged(aim, {'chest': (1.2 * math.sin(2 * math.pi * t), 0, 0), 'upper_arm_R': (0.8 * math.sin(2 * math.pi * t + 1), 0, 0)})
            tail_wave(p, t, 5)
            out.append((round(t * 48), p))
    elif clip == 'fire':
        kick = 14 if k['weapon'] in ('cannon',) else 6 if k['weapon'] != 'pistol' else 9
        out = [(0, merged(aim, {})), (1, merged(aim, {'chest': (-kick * 0.5, 0, 0), 'upper_arm_R': (kick, 0, 0), 'upper_arm_L': (kick * 0.6, 0, 0), 'head': (-2, 0, 0)})),
               (4, merged(aim, {'chest': (-kick * 0.15, 0, 0), 'upper_arm_R': (kick * 0.3, 0, 0)})), (8, merged(aim, {}))]
        if k['weapon'] == 'claws':  # bite lunge
            out = [(0, merged(aim, {})), (4, merged(aim, {'spine': (14, 0, 0), 'neck': (14, 0, 0), 'jaw': (28, 0, 0), '_fwd': 0.12 * S})), (9, merged(aim, {'jaw': (0, 0, 0)}))]
    elif clip == 'reload':
        out = [(0, carry),
               (10, merged(carry, {'upper_arm_L': (-20, 0, 18), 'lower_arm_L': (-30, 0, 0), 'hand_R': (0, 25, 0)})),
               (24, merged(carry, {'upper_arm_L': (-26, 0, 20), 'lower_arm_L': (-45, 0, 0), 'head': (12, 0, 0), 'hand_R': (0, 30, 0)})),
               (36, merged(carry, {'upper_arm_L': (5, 0, 4), 'lower_arm_L': (10, 0, 0), 'head': (14, 0, 0), 'hand_R': (0, 25, 0)})),
               (44, merged(carry, {'upper_arm_L': (8, 0, 0), 'chest': (-3, 0, 0), 'hand_R': (0, 10, 0)})), (60, carry)]
        if k['weapon'] == 'claws':  # groom/scratch instead
            out = [(0, carry), (15, merged(carry, {'head': (20, 25, 0), 'upper_arm_R': (40, 0, 0), 'lower_arm_R': (40, 0, 0)})), (30, merged(carry, {'head': (20, -10, 0), 'upper_arm_R': (50, 0, 0), 'lower_arm_R': (50, 0, 0)})), (60, carry)]
    elif clip == 'hurt':
        hit = {'spine': (-12, 6, 0), 'chest': (-10, 0, 0), 'head': (-24, 10, 0), 'jaw': (18, 0, 0), 'upper_arm_L': (-10, 0, 20), 'upper_arm_R': (-6, 0, 14),
               'ear_L': (-25, 0, 0), 'ear_R': (-25, 0, 0)}
        p1 = merged(carry, hit); tail_wave(p1, 0.25, 0, lift=25)
        out = [(0, carry), (3, p1), (8, merged(carry, {'spine': (-4, 2, 0), 'head': (-8, 0, 0)})), (15, carry)]
    elif clip in ('death_a', 'death_b'):
        J = G['J']
        floor = 0.17 * S * k['girth'] * max(1, k['belly'] ** 0.5)
        down = J['pelvis'].z - floor
        if clip == 'death_a':
            f1 = merged(carry, {'hips': (-25, 0, 0), 'head': (-30, 0, 0), 'jaw': (25, 0, 0), 'upper_arm_L': (-10, 0, 45), 'upper_arm_R': (-10, 0, 40), '_drop': 0.15 * S})
            f2 = {'hips': (-82, 8, 0), 'spine': (-6, 0, 0), 'head': (-25, 20, 0), 'jaw': (30, 0, 0), 'upper_arm_L': (20, 0, 70), 'upper_arm_R': (30, 0, 55),
                  'lower_arm_L': (25, 0, 0), 'lower_arm_R': (40, 0, 0), 'thigh_L': (30, 0, 6), 'shin_L': (-45, 0, 0), 'thigh_R': (8, 0, -4), 'shin_R': (-10, 0, 0),
                  'ear_L': (-30, 0, 0), 'ear_R': (-20, 0, 0), '_drop': down, '_fwd': -0.10 * S}
            f3 = merged(f2, {'head': (-6, 4, 0), 'thigh_L': (-6, 0, 0), 'shin_L': (8, 0, 0)})
            tail_wave(f2, 0.0, 0, lift=-20); tail_wave(f3, 0.3, 8, lift=-30)
            out = [(0, carry), (7, f1), (18, f2), (24, f3), (45, f3)]
        else:
            kneel = {'thigh_L': (75, 0, 0), 'shin_L': (-120, 0, 0), 'thigh_R': (70, 0, 0), 'shin_R': (-115, 0, 0), 'foot_L': (40, 0, 0), 'foot_R': (40, 0, 0),
                     'spine': (20, 0, 0), 'head': (25, 0, 0), 'upper_arm_L': (-20, 0, 10), 'upper_arm_R': (-20, 0, 10), 'lower_arm_L': (-30, 0, 0), 'lower_arm_R': (-30, 0, 0)}
            f1 = merged({}, kneel); f1['_drop'] = leg_drop(72, -118)
            f2 = {'hips': (84, -6, 0), 'spine': (5, 0, 0), 'head': (-10, 25, 0), 'thigh_L': (-2, 0, 0), 'thigh_R': (6, 0, 0), 'shin_R': (-20, 0, 0), 'foot_L': (40, 0, 0), 'foot_R': (40, 0, 0),
                  'upper_arm_L': (120, 0, 20), 'upper_arm_R': (100, 0, 30), 'lower_arm_L': (20, 0, 0), 'lower_arm_R': (30, 0, 0), '_drop': down, '_fwd': 0.25 * S}
            tail_wave(f2, 0.2, 10, lift=20)
            out = [(0, carry), (10, f1), (22, f2), (48, f2)]
    elif clip == 'take_cover':
        crouch = {'thigh_L': (88, 0, 4), 'shin_L': (-125, 0, 0), 'foot_L': (36, 0, 0), 'thigh_R': (40, 0, -8), 'shin_R': (-110, 0, 0), 'foot_R': (70, 0, 0),
                  'spine': (22, 0, 0), 'chest': (10, 0, 0), 'head': (-22, 0, 0), 'ear_L': (-30, 0, 0), 'ear_R': (-30, 0, 0)}
        c = merged(carry, crouch); c['_drop'] = leg_drop(88, -125) * 0.92
        tail_wave(c, 0.0, 0, lift=-15)
        mid = merged(carry, {b: tuple(x * 0.5 for x in r) for b, r in crouch.items()}); mid['_drop'] = c['_drop'] * 0.45
        out = [(0, carry), (8, mid), (16, c), (30, merged(c, {'head': (4, 10, 0)}))]
    elif clip == 'melee':
        if k['weapon'] == 'claws':
            out = [(0, carry), (6, merged(carry, {'chest': (-10, 30, 0), 'upper_arm_R': (60, 0, 40), 'lower_arm_R': (-20, 0, 0)})),
                   (10, merged(carry, {'chest': (15, -35, 0), 'upper_arm_R': (70, 0, -40), 'spine': (10, 0, 0), 'jaw': (25, 0, 0), '_fwd': 0.1 * S})),
                   (14, merged(carry, {'chest': (-5, -20, 0), 'upper_arm_L': (60, 0, -40), 'upper_arm_R': (30, 0, 0)})), (24, carry)]
        else:
            out = [(0, carry), (7, merged(carry, {'chest': (-8, 35, 0), 'spine': (0, 10, 0), 'upper_arm_R': (40, 0, 20), 'upper_arm_L': (20, 0, 10)})),
                   (11, merged(carry, {'chest': (14, -30, 0), 'spine': (8, -10, 0), 'upper_arm_R': (70, 0, -10), 'upper_arm_L': (60, 0, -10), 'lower_arm_R': (-30, 0, 0), '_fwd': 0.12 * S})),
                   (16, merged(carry, {'chest': (6, -15, 0)})), (24, carry)]
    elif clip == 'taunt':
        out = []
        for i in range(9):
            t = i / 8
            shake = 18 * math.sin(2 * math.pi * t * 3)
            p = merged(carry, {'upper_arm_L': (150, 0, 15), 'lower_arm_L': (40 + shake, 0, 0), 'hand_L': (-20, 0, 0), 'head': (-18, 10 * math.sin(2 * math.pi * t), 0),
                               'jaw': (22 * abs(math.sin(2 * math.pi * t * 2)), 0, 0), 'chest': (-8, 0, 0), 'ear_L': (15, 0, 0), 'ear_R': (15, 0, 0),
                               '_drop': 0.02 * S * abs(math.sin(2 * math.pi * t * 2))})
            if i in (0, 8):
                p = merged(carry, {})
            tail_wave(p, t * 2, 25, lift=20)
            out.append((round(t * 60), p))
    elif clip == 'slam':
        up = merged(carry, {'upper_arm_L': (160, 0, 10), 'upper_arm_R': (160, 0, 10), 'lower_arm_L': (20, 0, 0), 'lower_arm_R': (20, 0, 0), 'spine': (-12, 0, 0), 'head': (-20, 0, 0), 'jaw': (25, 0, 0)})
        hit = {'upper_arm_L': (70, 0, 0), 'upper_arm_R': (70, 0, 0), 'lower_arm_L': (5, 0, 0), 'lower_arm_R': (5, 0, 0), 'spine': (32, 0, 0), 'chest': (12, 0, 0), 'head': (-25, 0, 0),
               'thigh_L': (60, 0, 8), 'thigh_R': (60, 0, -8), 'shin_L': (-90, 0, 0), 'shin_R': (-90, 0, 0), 'foot_L': (30, 0, 0), 'foot_R': (30, 0, 0)}
        hp = merged({}, hit); hp['_drop'] = leg_drop(60, -90)
        out = [(0, carry), (16, up), (22, hp), (34, hp), (48, carry)]
    return out


def animate(rig, kind, k):
    global INV
    INV = {godot_name(n): n for n in G['bones']}
    INV.update({godot_name(m[0]): m[0] for m in G['muzzles']})
    rig.animation_data_create()
    pbs = rig.pose.bones
    for pb in pbs:
        pb.rotation_mode = 'QUATERNION'
    clips = CLIPS + (BOSS_CLIPS if kind == 'boss' else [])
    for clip in clips:
        act = bpy.data.actions.new(clip)
        act.use_fake_user = True
        rig.animation_data.action = act
        frames = clip_frames(clip, kind, k)
        for fr, pose in frames:
            for pb in pbs:
                old = INV[pb.name]
                if old.startswith('muzzle') or old == 'root':
                    continue
                r = pose.get(old, (0, 0, 0))
                if old.endswith('_R'):
                    r = MIRROR(r)
                pb.rotation_quaternion = Euler([math.radians(a) for a in r], 'XYZ').to_quaternion()
                pb.location = (0, 0, 0)
                if old == 'hips':
                    drop = pose.get('_drop', 0.0) + pose.get('_bob', 0.0)
                    pb.location = (0, -drop, pose.get('_fwd', 0.0))
                pb.keyframe_insert('rotation_quaternion', frame=fr + 1, group=pb.name)
                pb.keyframe_insert('location', frame=fr + 1, group=pb.name)
        tr = rig.animation_data.nla_tracks.new(); tr.name = clip
        st = tr.strips.new(clip, 1, act); tr.mute = True
        rig.animation_data.action = None
    for pb in pbs:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)


# ---------------------------------------------------------------- export
def export(kind, rig, objs):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in [rig] + objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    path = os.path.join(MODELS, 'rat_%s.glb' % kind)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
              export_animations=True, export_animation_mode='ACTIONS', export_skins=True, export_force_sampling=True,
              export_def_bones=False, export_image_format='AUTO', export_materials='EXPORT', export_extras=False)
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        print('gltf kw fallback:', e)
        for bad in ('export_def_bones', 'export_extras', 'export_force_sampling'):
            kw.pop(bad, None)
        bpy.ops.export_scene.gltf(**kw)
    return path


# ---------------------------------------------------------------- preview (imports the exported .glb files)
def preview(kinds, clip_pose='aim_idle', entries=None, out_prefix='lineup', frame_frac=None):
    clear_scene()
    entries = entries or [(kd, clip_pose) for kd in kinds]
    sc = bpy.context.scene
    x = 0.0
    rigs = []
    for kind, clip_pose in entries:
        path = os.path.join(MODELS, 'rat_%s.glb' % kind)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        arm = [o for o in new if o.type == 'ARMATURE'][0]
        for o in new:
            if 'LOD1' in o.name:
                o.hide_render = True
        w = KINDS[kind]['height'] * 0.33 + 0.12
        x += w
        arm.location.x = x
        x += w
        rigs.append((kind, arm, clip_pose))
    xc = x / 2
    for kind, arm, clip_pose in rigs:
        arm.location.x -= xc
        ad = arm.animation_data
        tr = ad.nla_tracks.get(clip_pose) if ad else None
        if tr and tr.strips:
            act = tr.strips[0].action
            ad.action = act
            try:
                ad.action_slot = act.slots[0]
            except Exception:
                pass
            if frame_frac is not None:
                # bake the chosen frame into the NLA-free pose: offset the action so frame 2 shows frame_frac of the clip
                f0, f1 = act.frame_range
                strip_frame = f0 + (f1 - f0) * frame_frac
                for fc in act.fcurves if hasattr(act, 'fcurves') else []:
                    pass
                arm['_show_frame'] = strip_frame
    if frame_frac is not None:
        # every clip is shown at its own last frame: evaluate each rig separately and freeze it with a pose copy
        for kind, arm, clip_pose in rigs:
            sc.frame_set(int(round(arm.get('_show_frame', 2))))
            bpy.context.view_layer.update()
            for pb in arm.pose.bones:
                pb['_m'] = [list(r) for r in pb.matrix_basis]
        for kind, arm, clip_pose in rigs:
            arm.animation_data.action = None
            for pb in arm.pose.bones:
                pb.matrix_basis = Matrix(pb['_m'])
    else:
        sc.frame_set(2)
    # studio
    bpy.ops.mesh.primitive_plane_add(size=60)
    floor = bpy.context.active_object
    fm = bpy.data.materials.new('floor'); fm.use_nodes = True
    fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.31, 0.30, 1)
    fm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.6
    floor.data.materials.append(fm)
    world = bpy.data.worlds.new('w'); sc.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.42, 0.45, 0.5, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    def light(t, loc, rot, e, size=4):
        ld = bpy.data.lights.new(t, 'AREA' if t != 'sun' else 'SUN'); ld.energy = e
        if t != 'sun':
            ld.size = size
        lo = bpy.data.objects.new(t, ld); sc.collection.objects.link(lo); lo.location = loc; lo.rotation_euler = [math.radians(a) for a in rot]
    light('sun', (0, 0, 10), (50, 10, 145), 3.5)
    light('key', (4, 6, 5), (55, 0, 145), 900, 5)
    light('rim', (-5, -6, 4), (-60, 0, -30), 700, 4)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    sc.render.resolution_x, sc.render.resolution_y = 1920, 900
    os.makedirs(PREV, exist_ok=True)
    engines = ['BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT', 'BLENDER_WORKBENCH']
    for e in engines:
        try:
            sc.render.engine = e
            break
        except TypeError:
            continue
    print('engine', sc.render.engine)
    span = x
    dist = span * 0.5 / math.tan(math.radians(18)) + 1.0
    shots = {'lineup_front': ((0, dist, 1.75), (88, 0, 180)), 'lineup_34': ((dist * 0.55, dist * 0.8, 3.2), (78, 0, 180 - 34))}
    for name, (loc, rot) in shots.items():
        cam.location = loc; cam.rotation_euler = [math.radians(a) for a in rot]
        if out_prefix != 'lineup' and name != 'lineup_34':
            continue
        sc.render.filepath = os.path.join(PREV, name.replace('lineup', out_prefix) + '.png')
        bpy.ops.render.render(write_still=True)
    return rigs


def preview_heads(kinds):
    """Close-up of heads (rest-ish pose) to check snout/ears/whiskers/helmets."""
    sc = bpy.context.scene
    cam = sc.camera
    sc.render.resolution_x, sc.render.resolution_y = 1920, 640
    # move rigs into a row at equal head heights is complex; just frame the trooper/officer/mouse heads
    cam.data.lens = 85
    cam.location = (-1.0, -6.0, 1.55); cam.rotation_euler = [math.radians(a) for a in (88, 0, -8)]
    sc.render.filepath = os.path.join(PREV, 'heads.png')
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------- main
def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    kinds = [a for a in argv if not a.startswith('--')]
    if not kinds or 'all' in kinds:
        kinds = list(KINDS)
    os.makedirs(MODELS, exist_ok=True); os.makedirs(TEX, exist_ok=True)
    if '--preview-only' not in argv:
        for kind in kinds:
            rig, lod0, lod1, weapons, st = build(kind)
            nb = len(rig.data.bones)
            if '--debug-pose' in argv:
                rig.animation_data.action = bpy.data.actions['aim_idle']
                bpy.context.scene.frame_set(1)
                bpy.context.view_layer.update()
                for b in ('RightUpperArm', 'RightLowerArm', 'RightHand', 'LeftHand'):
                    pb = rig.pose.bones[b]
                    print('DBG', b, 'rest', tuple(round(x, 2) for x in rig.data.bones[b].head_local), 'pose', tuple(round(x, 2) for x in pb.head), tuple(round(x, 2) for x in pb.tail), tuple(round(x,2) for x in pb.rotation_quaternion))
            if '--no-export' not in argv:
                export(kind, rig, [lod0, lod1] + weapons)
            print('RAT %s tris LOD0=%d LOD1=%d weapon=%d bones=%d actions=%d height=%.2f' % (
                kind, st['lod0'], st['lod1'], st['weapon'], nb, len([a for a in bpy.data.actions]), max((lod0.matrix_world @ Vector(c)).z for c in lod0.bound_box)))
    if '--preview' in argv or '--preview-only' in argv:
        allk = [k for k in KINDS if os.path.exists(os.path.join(MODELS, 'rat_%s.glb' % k))]
        pose = next((a.split('=')[1] for a in argv if a.startswith('--pose=')), 'aim_idle')
        preview(allk, pose)
    if '--clips' in argv:
        kd = next((a.split('=')[1] for a in argv if a.startswith('--clip-kind=')), 'trooper')
        ent = [(kd, c) for c in ['idle', 'walk', 'run', 'fire', 'reload', 'hurt', 'take_cover', 'melee', 'taunt', 'death_a', 'death_b']]
        preview([], entries=ent, out_prefix='clips_' + kd, frame_frac=0.45)


main()
