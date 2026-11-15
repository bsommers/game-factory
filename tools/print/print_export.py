"""print_export.py - build watertight, 3D-printable OBJ(+MTL)/STL models from the game GLBs.

Run:  blender -b -P tools/blender/print_export.py -- [build|verify|contact|all] [--only a,b] [--skip-existing]
  build    characters, weapons, props, squad plate  -> dist/print/{characters,weapons,props}/
  verify   re-import every dist/print/**/*.obj (incl. levels from tools/print_levels.mjs), measure, write
           dist/print/manifest.json (+ docs/PRINTING.md table)
  contact  Workbench contact sheets -> out/previews/print-models/
Units: 1 OBJ/STL unit = 1 millimetre. Source GLBs are the exported game models (game/assets/models), opened
in rest pose; LOD1 copies, eyes, whiskers, patches and the armature are dropped. Pipeline per model:
join -> scale to mm -> add plinth -> voxel remesh (fuse into ONE shell) -> dilate (min feature size)
-> voxel remesh again -> per-face colour from nearest source face -> export.
"""
import bpy, bmesh, sys, os, json, math, re, time
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(ROOT, 'game/assets/models')
DIST = os.path.join(ROOT, 'dist/print')
PREV = os.path.join(ROOT, 'out/previews/print-models')

VOXEL = 0.5          # mm, remesh resolution
DILATE = 0.60        # mm per side added to guarantee >= ~1.2 mm features
PLINTH_H = 3.0       # mm
HERO_MM = 75.0       # hero height at print scale
CHAR_K = None        # mm per metre for characters (set from hero mesh height)
PROP_RATIO = 35.0    # 1:35
MIN_PROP_MM = 25.0   # props/weapons smaller than this are scaled up (documented)

SQUAD_K = 0.8   # squad-plate figures are 80% of single-figure size so 7 fit on 200x200 mm
SPEC_H = {'rat_boss': 3.2}   # in-game height (m) where the rest-pose mesh is shorter than spec
CHARS = ['hero', 'rat_mouse', 'rat_sewer', 'rat_trooper', 'rat_officer', 'rat_panzer', 'rat_boss']
WEAPONS = ['weapon_claws', 'weapon_pistol', 'weapon_yarn', 'weapon_gatling', 'weapon_laser']
# props that stand on their own flat bottom get no plinth
PROPS_FLAT = ['crate', 'barrel', 'cheese_wheel', 'brie_wheel', 'cheese_stack', 'table', 'chair', 'pillar',
              'sandbags', 'shelf', 'cauldron', 'ammo_box', 'battery']
PROPS_PLINTH = ['key_gold', 'key_silver', 'cheese_wedge', 'cheese_crown', 'candelabra', 'catnip', 'fish_treat',
                'tuna', 'yarn_ammo', 'mousetrap', 'statue', 'torch', 'ammo_clip', 'lamp']
DROP_RE = re.compile(r'LOD1|Icosphere|Eyes|Whisker|Patch|Fur|Shell', re.I)

# ------------------------------------------------------------------ helpers
def log(*a):
    print('[print]', *a, flush=True)

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def load_glb(name):
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, name + '.glb'))
    # NOTE: keep the pose the glTF importer builds from the node transforms (the as-authored idle pose); forcing
    # the armature REST pose explodes some rigs (boss), because their bind data is not the authored pose.
    for o in bpy.data.objects:
        if o.type == 'ARMATURE':
            o.data.pose_position = 'POSE'
            for a in list(bpy.data.actions):
                pass
    bpy.context.view_layer.update()

def mat_color(m):
    try:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == 'BSDF_PRINCIPLED':
                    c = n.inputs['Base Color'].default_value
                    return (c[0], c[1], c[2], 1.0)
    except Exception:
        pass
    return (0.7, 0.7, 0.7, 1.0)

def collect_bm(keep=lambda o: True):
    """Evaluated (rest pose) world-space geometry of all kept meshes -> one bmesh (metres, Z up) + material list."""
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    mats, colors = [], []
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or DROP_RE.search(o.name) or not keep(o):
            continue
        eo = o.evaluated_get(dg)
        me = eo.to_mesh()
        me.transform(eo.matrix_world)
        slot_map = {}
        for i, s in enumerate(o.material_slots):
            m = s.material
            key = m.name if m else 'default'
            if key not in mats:
                mats.append(key); colors.append(mat_color(m))
            slot_map[i] = mats.index(key)
        if not mats:
            mats.append('default'); colors.append((0.7, 0.7, 0.7, 1.0))
        tmp = bmesh.new(); tmp.from_mesh(me)
        for f in tmp.faces:
            f.material_index = slot_map.get(f.material_index, 0)
        tmp.to_mesh(me); tmp.free()
        # append faces into bm
        vmap = [bm.verts.new(v.co) for v in me.vertices]
        for p in me.polygons:
            try:
                f = bm.faces.new([vmap[i] for i in p.vertices]); f.material_index = slot_map.get(p.material_index, 0)
            except ValueError:
                pass
        eo.to_mesh_clear()
    return bm, mats, colors

def thicken_open(bm, t=1.0):
    """Zero-thickness sheets (capes, decals, flat plates) are open surfaces and vanish/ragged in a voxel remesh.
    Split every component with boundary edges into its own mesh, run the Solidify modifier (even thickness) on it,
    and merge back with the closed components. Returns a new bmesh (the input is freed)."""
    open_faces = set()
    for comp in components(bm):
        if any(e.is_boundary for v in comp for e in v.link_edges):
            open_faces.update(f for v in comp for f in v.link_faces)
    if not open_faces:
        return bm
    bm.faces.index_update()
    bm_open = bm.copy()
    bm_open.faces.ensure_lookup_table()
    # in the copy keep only the open faces; in the original delete them
    idx = {f.index for f in open_faces}
    bmesh.ops.delete(bm_open, geom=[f for f in bm_open.faces if f.index not in idx], context='FACES_ONLY')
    bm_open.verts.ensure_lookup_table()
    bmesh.ops.delete(bm_open, geom=[v for v in bm_open.verts if not v.link_faces], context='VERTS')
    bmesh.ops.delete(bm, geom=list(open_faces), context='FACES_ONLY')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    o_open = to_object(bm_open, 'open_sheets')
    m = o_open.modifiers.new('sol', 'SOLIDIFY')
    m.thickness = t; m.offset = 0.0; m.use_even_offset = False; m.nonmanifold_thickness_mode = 'FIXED'
    apply_mod(o_open, m)
    o_closed = to_object(bm, 'closed')
    for o in bpy.context.selected_objects:
        o.select_set(False)
    o_open.select_set(True); o_closed.select_set(True)
    bpy.context.view_layer.objects.active = o_closed
    bpy.ops.object.join()
    out = bmesh.new(); out.from_mesh(o_closed.data)
    bpy.data.objects.remove(o_closed, do_unlink=True)
    bm_open.free(); bm.free()
    log('  solidified %d open faces' % len(open_faces))
    return out

def make_plinth_mesh(bm, cx, cy, rx, ry, ztop, h, shape='ellipse', seg=48):
    if shape == 'rect':
        ret = bmesh.ops.create_cube(bm, size=1.0)
        for v in ret['verts']:
            v.co = Vector((cx + v.co.x * 2 * rx, cy + v.co.y * 2 * ry, ztop - h / 2 + v.co.z * h))
    else:
        ret = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=1.0, radius2=1.0, depth=1.0)
        for v in ret['verts']:
            v.co = Vector((cx + v.co.x * rx, cy + v.co.y * ry, ztop - h / 2 + v.co.z * h))
    return ret['verts']

def to_object(bm, name='print', colors=None, mats=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    return ob

def apply_mod(ob, mod):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)

def voxel_remesh(ob, size=VOXEL):
    m = ob.modifiers.new('rm', 'REMESH')
    m.mode = 'VOXEL'; m.voxel_size = size; m.adaptivity = 0.0; m.use_smooth_shade = False
    apply_mod(ob, m)

def dilate(ob, amount=DILATE):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()
    m = ob.modifiers.new('dl', 'DISPLACE')
    m.direction = 'NORMAL'; m.strength = amount; m.mid_level = 0.0
    apply_mod(ob, m)

def clean(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # keep only the largest connected component (drops stray bits)
    comps = components(bm)
    if len(comps) > 1:
        comps.sort(key=len, reverse=True)
        log('  clean: dropping %d stray components (sizes %s)' % (len(comps) - 1, [len(c) for c in comps[1:6]]))
        for c in comps[1:]:
            bmesh.ops.delete(bm, geom=list(c), context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data); bm.free()

def components(bm):
    seen, out = set(), []
    for v in bm.verts:
        if v.index in seen and False:
            continue
    bm.verts.index_update()
    seen = [False] * len(bm.verts)
    for v in bm.verts:
        if seen[v.index]:
            continue
        stack = [v]; seen[v.index] = True; comp = []
        while stack:
            a = stack.pop(); comp.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if not seen[b.index]:
                    seen[b.index] = True; stack.append(b)
        out.append(comp)
    return out


def ncomp_big(ob, dust=0.02):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    cs = components(bm); bm.free()
    if not cs:
        return 0
    m = max(len(c) for c in cs)
    return sum(1 for c in cs if len(c) > dust * m)

def fuse(bm, name, grow, vox=VOXEL, gs=(0.0, 0.8, 1.6, 2.6, 4.0, 6.0)):
    """remesh -> grow(+g) -> remesh -> shrink(-(g-grow)) -> remesh; increase closing radius g until ONE solid
    (parts separated by gaps < 2g are bridged). Net growth is `grow` mm per side (min-feature thickening)."""
    last = None
    for extra in gs:
        g = grow + extra
        ob = to_object(bm, name)
        voxel_remesh(ob, vox)
        dilate(ob, g)
        voxel_remesh(ob, vox)
        if extra > 0:
            dilate(ob, -extra)
            voxel_remesh(ob, vox)
        log('  fuse pass g=%.1f: %d verts' % (g, len(ob.data.vertices)))
        n = ncomp_big(ob)
        if n <= 1:
            clean(ob)
            if extra > 0:
                log('  closing radius %.1f mm used for %s' % (g, name))
            return ob
        log('  %d solids at g=%.1f for %s' % (n, g, name))
        if last is not None:
            bpy.data.objects.remove(last, do_unlink=True)
        last = ob
    clean(last)
    return last

def assign_colors(ob, src_bm, mats, colors, plinth_z=None):
    """Per-face material from the nearest source face; faces below plinth_z get the 'plinth' material."""
    tri = src_bm.copy()
    bmesh.ops.triangulate(tri, faces=tri.faces)
    tree = BVHTree.FromBMesh(tri)
    tri.faces.ensure_lookup_table()
    me = ob.data
    names = list(mats) + ['plinth']
    pcol = (0.55, 0.55, 0.58, 1.0)
    me.materials.clear()
    for n, c in zip(names, list(colors) + [pcol]):
        m = bpy.data.materials.get('P_' + n) or bpy.data.materials.new('P_' + n)
        m.diffuse_color = c
        m.use_nodes = True
        for nd in m.node_tree.nodes:
            if nd.type == 'BSDF_PRINCIPLED':
                nd.inputs['Base Color'].default_value = c
        me.materials.append(m)
    pidx = len(names) - 1
    for p in me.polygons:
        c = p.center
        if plinth_z is not None and c.z < plinth_z:
            p.material_index = pidx
            continue
        loc, nrm, idx, d = tree.find_nearest(c)
        p.material_index = tri.faces[idx].material_index if idx is not None else 0
    tri.free()

def analyze(ob, samples=1500):
    """Manifold checks + volume + bbox + inward-ray min wall estimate. Mesh must be in mm."""
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bm.edges.ensure_lookup_table()
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    nonman_v = sum(1 for v in bm.verts if not v.is_manifold)
    comps = len(components(bm))
    vol = bm.calc_volume(signed=True)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    bbox = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    # min wall estimate: shoot from sampled verts inward along -normal
    tri = bm.copy(); bmesh.ops.triangulate(tri, faces=tri.faces)
    tree = BVHTree.FromBMesh(tri)
    step = max(1, len(bm.verts) // samples)
    ds = []
    bm.verts.ensure_lookup_table()
    for v in list(bm.verts)[::step]:
        n = v.normal
        if n.length < 1e-6:
            continue
        o = v.co - n * 0.02
        hit = tree.ray_cast(o, -n, 60.0)
        if hit[0] is not None:
            ds.append(hit[3] + 0.02)
    tri.free(); bm.free()
    ds.sort()
    minw = ds[int(len(ds) * 0.01)] if ds else 0.0
    return dict(tris=tris, bbox=[round(b, 2) for b in bbox], volume=round(vol, 1), nonmanifold_edges=nonman,
                nonmanifold_verts=nonman_v, components=comps, min_wall_mm=round(minw, 2),
                manifold=bool(nonman == 0 and nonman_v == 0 and comps == 1 and vol > 0))

def export(ob, folder, base):
    d = os.path.join(DIST, folder); os.makedirs(d, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True); bpy.context.view_layer.objects.active = ob
    obj = os.path.join(d, base + '.obj'); stl = os.path.join(d, base + '.stl')
    bpy.ops.wm.obj_export(filepath=obj, export_selected_objects=True, export_materials=True, export_uv=False,
                          export_normals=False, apply_modifiers=False, forward_axis='Y', up_axis='Z',
                          global_scale=1.0)
    bpy.ops.wm.stl_export(filepath=stl, export_selected_objects=True, ascii_format=False, apply_modifiers=False,
                          forward_axis='Y', up_axis='Z', global_scale=1.0)
    return obj, stl

# ------------------------------------------------------------------ model builders
def finish(bm, mats, colors, folder, base, plinth=True, shape='ellipse', pad=3.0, min_r=7.0, scale_mm=None,
           plinth_h=PLINTH_H, center=True):
    """bm already in mm with feet at z=0. Adds plinth, fuses, dilates, colours, exports; returns record."""
    ext = max(max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3))
    sc = max(0.5, (ext - 2 * DILATE) / ext)       # compensate the dilation so final size matches the target
    for v in bm.verts:
        v.co.x *= sc; v.co.y *= sc; v.co.z *= sc
    src = bm.copy()  # colour source (without plinth)
    bm = thicken_open(bm, 1.0)
    zmin = min(v.co.z for v in bm.verts)
    ztop = 0.6
    if plinth:
        feet = [v.co for v in bm.verts if v.co.z < zmin + 2.0]
        xs = [c.x for c in feet]; ys = [c.y for c in feet]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        rx = max((max(xs) - min(xs)) / 2 + pad, min_r); ry = max((max(ys) - min(ys)) / 2 + pad, min_r)
        pv = make_plinth_mesh(bm, cx, cy, rx, ry, zmin + 0.6, plinth_h, shape)
    ob = fuse(bm, base, DILATE)
    # shift so the underside sits at z=0
    bb = [v.co.z for v in ob.data.vertices]
    ob.data.transform(Matrix.Translation((0, 0, -min(bb))))
    assign_colors(ob, src, mats, colors, plinth_z=(plinth_h - 0.6 - 0.2) if plinth else None)
    rec = analyze(ob)
    obj, stl = export(ob, folder, base)
    rec.update(file=os.path.relpath(obj, DIST), stl=os.path.relpath(stl, DIST))
    log(base, rec)
    src.free(); bm.free()
    return rec, ob

def source_bm(glb, keep=lambda o: True):
    load_glb(glb)
    bm, mats, colors = collect_bm(keep)
    return bm, mats, colors

def place_feet(bm, scale):
    """metres -> mm, centre xy on bbox, feet to z=0."""
    for v in bm.verts:
        v.co *= scale
    zs = [v.co.z for v in bm.verts]; xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((-(max(xs) + min(xs)) / 2, -(max(ys) + min(ys)) / 2, -min(zs))))

def height_m(bm):
    zs = [v.co.z for v in bm.verts]
    return max(zs) - min(zs)

def build_character(cid, results, keep_weapon=True):
    global CHAR_K
    bm, mats, colors = source_bm(cid)
    if CHAR_K is None:
        CHAR_K = HERO_MM / hero_height()
    h = height_m(bm)
    k = CHAR_K * (SPEC_H[cid] / h if cid in SPEC_H else 1.0)   # boss: rest pose is hunched, scale to its 3.2 m spec
    place_feet(bm, k)
    hmm = h * k
    base = f'{cid}_h{hmm:.0f}mm_1to{1000/k:.0f}'
    rec, ob = finish(bm, mats, colors, 'characters', base, plinth=True, shape='ellipse')
    rec.update(kind='character', id=cid, scale=f'1:{1000/k:.1f}', height_mm=round(hmm, 1))
    results.append(rec)
    return rec

_hh = None
def hero_height():
    global _hh
    if _hh is None:
        load_glb('hero')
        bm, _, _ = collect_bm()
        _hh = height_m(bm); bm.free()
    return _hh

def build_prop(pid, glb, folder, results, plinth, kind):
    bm, mats, colors = source_bm(glb, keep=lambda o: o.type == 'MESH')
    if not bm.verts:
        log('SKIP empty', glb); return None
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]; zs = [v.co.z for v in bm.verts]
    longest = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    scale = 1000.0 / PROP_RATIO
    ratio = PROP_RATIO
    if longest * scale < MIN_PROP_MM:
        scale = MIN_PROP_MM / longest
        ratio = 1000.0 / scale
    place_feet(bm, scale)
    base = f'{pid}_1to{ratio:.0f}'
    rec, ob = finish(bm, mats, colors, folder, base, plinth=plinth, shape='rect', pad=1.5, min_r=3.0, plinth_h=2.0)
    rec.update(kind=kind, id=pid, scale=f'1:{ratio:.1f}', height_mm=rec['bbox'][2])
    results.append(rec)
    return rec

def build_squad(results):
    """Hero + 6 rats on one 200x200 mm base (shelf-packed), fused with the base in one voxel remesh."""
    global CHAR_K
    items = []
    for cid in CHARS:
        bm, mats, colors = source_bm(cid)
        if CHAR_K is None:
            CHAR_K = HERO_MM / hero_height()
        hm = height_m(bm)
        place_feet(bm, SQUAD_K * CHAR_K * (SPEC_H[cid] / hm if cid in SPEC_H else 1.0))
        xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]
        items.append((cid, bm, mats, colors, max(xs) - min(xs), max(ys) - min(ys)))
    # two rows: back row = tall/wide (boss, panzer, officer), front row = hero, trooper, sewer, mouse
    rows = [['rat_boss', 'rat_panzer', 'rat_officer'], ['hero', 'rat_trooper', 'rat_sewer', 'rat_mouse']]
    by = {i[0]: i for i in items}
    PLATE = 200.0; MARGIN = 6.0; GAP = 3.0
    allbm = bmesh.new(); allmats, allcols = [], []
    ycur = -PLATE / 2 + MARGIN
    for r in reversed(rows):  # front row first (towards -y)
        depth = max(by[c][5] for c in r)
        total = sum(by[c][4] for c in r) + GAP * (len(r) - 1)
        scale_x = 1.0
        if total > PLATE - 2 * MARGIN:
            log('WARN row too wide', r, total)
        x = -total / 2
        yc = ycur + depth / 2
        for c in r:
            _, bm, mats, colors, w, d = by[c]
            for m, col in zip(mats, colors):
                if m not in allmats:
                    allmats.append(m); allcols.append(col)
            remap = {i: allmats.index(m) for i, m in enumerate(mats)}
            vm = {}
            for v in bm.verts:
                vm[v] = allbm.verts.new(v.co + Vector((x + w / 2, yc, 0.0)))
            for f in bm.faces:
                try:
                    nf = allbm.faces.new([vm[v] for v in f.verts]); nf.material_index = remap.get(f.material_index, 0)
                except ValueError:
                    pass
            x += w + GAP
        ycur += depth + GAP
    # feet planted on the plate: figures start at z=0; plate occupies [-PLINTH_H+0.6, 0.6]
    src = allbm.copy()
    ret = bmesh.ops.create_cube(allbm, size=1.0)
    for v in ret['verts']:
        v.co = Vector((v.co.x * PLATE, v.co.y * PLATE, 0.6 - 3.0 / 2 + v.co.z * 3.0))
    ob = fuse(allbm, 'squad', 0.35, vox=0.8, gs=(0.0, 0.8))
    bb = [v.co.z for v in ob.data.vertices]
    ob.data.transform(Matrix.Translation((0, 0, -min(bb))))
    assign_colors(ob, src, allmats, allcols, plinth_z=2.0)
    rec = analyze(ob)
    base = 'squad_plate_200x200mm_1to%.0f' % (1000 / (SQUAD_K * CHAR_K))
    obj, stl = export(ob, 'characters', base)
    rec.update(file=os.path.relpath(obj, DIST), stl=os.path.relpath(stl, DIST), kind='squad', id='squad', scale='1:%.0f' % (1000 / (SQUAD_K * CHAR_K)),
               height_mm=rec['bbox'][2])
    log(base, rec)
    results.append(rec)

# ------------------------------------------------------------------ build / verify / contact
def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    mode = argv[0] if argv and not argv[0].startswith('--') else 'all'
    opts = {'only': None, 'skip': '--skip-existing' in argv}
    if '--only' in argv:
        opts['only'] = set(argv[argv.index('--only') + 1].split(','))
    return mode, opts

def build(opts):
    only = opts['only']
    os.makedirs(os.path.join(DIST, 'characters'), exist_ok=True)
    res_path = os.path.join(DIST, 'build_records.json')
    results = []
    if os.path.exists(res_path):
        results = json.load(open(res_path))
    done_ids = {r['id'] for r in results}
    def want(i):
        if only and i not in only:
            return False
        if opts['skip'] and i in done_ids:
            return False
        return True
    def save():
        json.dump(results, open(res_path, 'w'), indent=1)
    def replace(i):
        results[:] = [r for r in results if r['id'] != i]
    t0 = time.time()
    for cid in CHARS:
        if want(cid):
            replace(cid); build_character(cid, results); save()
    for w in WEAPONS:
        if want(w):
            replace(w); build_prop(w, w, 'weapons', results, True, 'weapon'); save()
    for p in PROPS_FLAT + PROPS_PLINTH:
        pid = 'prop_' + p
        if want(pid):
            replace(pid)
            try:
                build_prop(pid, pid, 'props', results, p in PROPS_PLINTH, 'prop')
            except Exception as ex:
                log('FAIL', pid, ex)
            save()
    if want('squad'):
        replace('squad'); build_squad(results); save()
    log('build done in %.0fs' % (time.time() - t0))

def import_obj(path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path, forward_axis='Y', up_axis='Z')
    new = [o for o in bpy.data.objects if o not in before]
    return new[0]

def verify():
    reset()
    rows = []
    for dp, dn, fn in os.walk(DIST):
        for f in sorted(fn):
            if f.endswith('.obj'):
                rows.append(os.path.join(dp, f))
    rows.sort()
    table = []
    for p in rows:
        reset()
        ob = import_obj(p)
        r = analyze(ob)
        stl = p[:-4] + '.stl'
        r.update(file=os.path.relpath(p, DIST), stl_exists=os.path.exists(stl),
                 obj_mb=round(os.path.getsize(p) / 1e6, 2), stl_mb=round(os.path.getsize(stl) / 1e6, 2) if os.path.exists(stl) else 0)
        table.append(r)
        log('verify', r['file'], r['manifold'], r['tris'])
    json.dump(table, open(os.path.join(DIST, 'manifest.json'), 'w'), indent=1)
    lines = ['| file | triangles | bbox mm (x y z) | volume mm3 | manifold | min wall mm (est) | STL MB |', '|---|---|---|---|---|---|---|']
    for r in table:
        lines.append('| %s | %d | %.1f x %.1f x %.1f | %.0f | %s | %.2f | %.1f |' % (
            r['file'], r['tris'], r['bbox'][0], r['bbox'][1], r['bbox'][2], r['volume'],
            'yes' if r['manifold'] else 'NO', r['min_wall_mm'], r['stl_mb']))
    open(os.path.join(DIST, 'verify_table.md'), 'w').write('\n'.join(lines) + '\n')
    log('verified', len(table), 'files;', sum(1 for r in table if not r['manifold']), 'not manifold')

def contact():
    os.makedirs(PREV, exist_ok=True)
    SQUAD_OBJ = [f for f in os.listdir(os.path.join(DIST, 'characters')) if f.startswith('squad') and f.endswith('.obj')][0]
    groups = {
        'characters': [f for f in sorted(os.listdir(os.path.join(DIST, 'characters'))) if f.endswith('.obj') and not f.startswith('squad')],
        'squad': [SQUAD_OBJ],
        'weapons_props': None,
        'levels': None,
    }
    def files(g):
        if g == 'weapons_props':
            return [os.path.join('weapons', f) for f in sorted(os.listdir(os.path.join(DIST, 'weapons'))) if f.endswith('.obj')] + \
                   [os.path.join('props', f) for f in sorted(os.listdir(os.path.join(DIST, 'props'))) if f.endswith('.obj')]
        if g == 'levels':
            d = os.path.join(DIST, 'levels')
            return [os.path.join('levels', f) for f in sorted(os.listdir(d)) if f.endswith('.obj')] if os.path.isdir(d) else []
        if g == 'squad':
            return [os.path.join('characters', f) for f in groups[g]]
        return [os.path.join('characters', f) for f in groups[g]]
    for g in groups:
        fl = files(g)
        if not fl:
            continue
        reset()
        n = len(fl); cols = min(n, 5 if g != 'squad' else 1); rowsn = math.ceil(n / cols)
        sizes = []
        objs = []
        for f in fl:
            o = import_obj(os.path.join(DIST, f)); objs.append(o)
            sizes.append(max(o.dimensions))
        cell = max(sizes) * 1.15 if g in ('characters', 'squad') else max(sorted(sizes)[len(sizes)//2] * 2.2, 40)
        if g == 'weapons_props':
            cell = 60
        if g == 'levels':
            cell = max(sizes) * 1.1
        for i, o in enumerate(objs):
            r, c = divmod(i, cols)
            bb = [o.matrix_world @ Vector(v) for v in o.bound_box]
            cx = (min(b.x for b in bb) + max(b.x for b in bb)) / 2; cy = (min(b.y for b in bb) + max(b.y for b in bb)) / 2
            o.location.x = c * cell - cx - (cols - 1) * cell / 2
            o.location.y = -r * cell - cy + (rowsn - 1) * cell / 2
            # object colour mode: show per-material colour
            for ms in o.material_slots:
                m = ms.material
                if m and m.use_nodes:
                    for nd in m.node_tree.nodes:
                        if nd.type == 'BSDF_PRINCIPLED':
                            m.diffuse_color = nd.inputs['Base Color'].default_value
            if g in ('characters', 'squad'):
                o.rotation_euler.z = math.pi   # figures face -Y in the print files; turn them to the camera
        sc = bpy.context.scene
        sc.render.engine = 'BLENDER_WORKBENCH'
        sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_cavity = True
        sc.display.shading.background_type = 'WORLD'
        w = bpy.data.worlds.new('w'); w.color = (0.12, 0.13, 0.15); sc.world = w
        sc.render.resolution_x = 1800; sc.render.resolution_y = int(1800 * (rowsn * 0.8 / cols + 0.12))
        if g == 'levels':
            sc.render.resolution_y = 1400
        cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'
        co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
        W = cols * cell; H = rowsn * cell
        cam.ortho_scale = max(W, H * sc.render.resolution_x / sc.render.resolution_y) * 1.03
        tilt = math.radians(62 if g not in ('levels',) else 40)
        co.rotation_euler = (tilt, 0, 0)
        dist = 2000
        co.location = (0, -dist * math.cos(math.radians(90) - tilt) * 1, dist * math.sin(math.radians(90) - tilt) * 1 + 0)
        co.location = (0, -dist * math.sin(tilt), dist * math.cos(tilt))
        co.location.y -= 0; co.location.z += 0
        cam.clip_end = 10000
        sc.render.filepath = os.path.join(PREV, g + '.png')
        bpy.ops.render.render(write_still=True)
        log('contact', g, sc.render.filepath)

if __name__ == '__main__':
    mode, opts = parse_args()
    if mode in ('build', 'all'):
        build(opts)
    if mode in ('verify', 'all'):
        verify()
    if mode in ('contact', 'all'):
        contact()
