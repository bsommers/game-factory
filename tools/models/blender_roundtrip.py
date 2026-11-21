# Headless Blender import check: blender -b --python tools/models/blender_roundtrip.py -- <file> [<file> ...]
# Prints one line "GF_JSON {...}" with, per file: imported (bool), via, tris, bounds (Blender units, Z up), volume, manifold.
# 3MF has no built-in importer in Blender: it is parsed with zipfile+xml instead (via="fallback-3mf-parser") and flagged so.
import sys, os, json, zipfile, re
import bpy, bmesh

def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def meshes():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']

def import_file(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.obj':
        bpy.ops.wm.obj_import(filepath=path, forward_axis='Y', up_axis='Z'); return 'wm.obj_import'
    if ext == '.stl':
        bpy.ops.wm.stl_import(filepath=path, forward_axis='Y', up_axis='Z'); return 'wm.stl_import'
    if ext == '.ply':
        bpy.ops.wm.ply_import(filepath=path, forward_axis='Y', up_axis='Z'); return 'wm.ply_import'
    if ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=path); return 'import_scene.gltf'
    if ext == '.3mf':
        for mod, fn in (('import_mesh', 'threemf'), ('wm', 'threemf_import')):
            try:
                getattr(getattr(bpy.ops, mod), fn)(filepath=path); return f'{mod}.{fn}'
            except (RuntimeError, AttributeError):
                pass
        return load_3mf(path)
    raise ValueError('unsupported extension ' + ext)

def load_3mf(path):
    z = zipfile.ZipFile(path)
    bad = z.testzip()
    if bad: raise ValueError('zip CRC failure: ' + bad)
    s = z.read('3D/3dmodel.model').decode('utf8')
    unit = re.search(r'unit="(\w+)"', s).group(1)
    k = {'millimeter': 1.0, 'meter': 1000.0, 'centimeter': 10.0, 'inch': 25.4}.get(unit, 1.0)
    vs = [(float(a) * k, float(b) * k, float(c) * k) for a, b, c in re.findall(r'<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"', s)]
    fs = [(int(a), int(b), int(c)) for a, b, c in re.findall(r'<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"', s)]
    me = bpy.data.meshes.new('3mf'); me.from_pydata(vs, [], fs); me.update()
    ob = bpy.data.objects.new('3mf', me); bpy.context.scene.collection.objects.link(ob)
    return 'fallback-3mf-parser'

def report():
    obs = meshes()
    deps = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    for o in obs:
        me = o.evaluated_get(deps).to_mesh()
        me.transform(o.matrix_world)
        bm.from_mesh(me)
        o.evaluated_get(deps).to_mesh_clear()
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    tris = sum(len(f.verts) - 2 for f in bm.faces)
    if not bm.verts:
        bm.free(); return {'objects': len(obs), 'tris': 0}
    xs = [v.co for v in bm.verts]
    mn = [min(c[i] for c in xs) for i in range(3)]; mx = [max(c[i] for c in xs) for i in range(3)]
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    nonman = sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary)
    vol = bm.calc_volume(signed=True)
    bm.free()
    return {'objects': len(obs), 'tris': tris, 'min': mn, 'max': mx, 'size': [mx[i] - mn[i] for i in range(3)],
            'volume': vol, 'boundaryEdges': boundary, 'nonManifoldEdges': nonman, 'manifold': boundary == 0 and nonman == 0}

files = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out = {'blender': bpy.app.version_string, 'files': {}}
for f in files:
    clear()
    try:
        via = import_file(f)
        r = report(); r['imported'] = True; r['via'] = via
        r['nativeImport'] = not via.startswith('fallback')
    except Exception as e:
        r = {'imported': False, 'error': str(e)[:300]}
    out['files'][f] = r
print('GF_JSON ' + json.dumps(out))
