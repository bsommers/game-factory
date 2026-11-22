# blender -b --python tools/img2model/build.py -- '<json params>'
# image (front+side sheet) -> silhouettes -> visual hull -> mesh -> inferred skeleton -> weights -> projected texture -> GLB + .blend
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import bpy, bmesh
from mathutils import Vector
from common import *
import hull, skeleton, rig, render


def to_gltf(p):  # Blender (x, y, z up) -> glTF (x, z, -y)
    return [float(p[0]), float(p[2]), float(-p[1])]


def make_texture(rgb, g, out_png, pad=14, bleed=40, back_color=None, back_color2=None):
    fb, sb = g.fb, g.sb
    fx0, fy0, fx1, fy1 = fb[0] - pad, fb[1] - pad, fb[2] + pad + 1, fb[3] + pad + 1
    sx0, sy0, sx1, sy1 = sb[0] - pad, sb[1] - pad, sb[2] + pad + 1, sb[3] + pad + 1
    Wf, Hf, Ws, Hs = fx1 - fx0, fy1 - fy0, sx1 - sx0, sy1 - sy0
    Wa, Ha = Wf + Ws + 32, max(Hf, Hs)
    atlas = np.tile(np.array(rgb[0, 0], dtype=np.float32), (Ha, Wa, 1))
    mask = np.zeros((Ha, Wa), dtype=bool)
    atlas[:Hf, :Wf] = rgb[fy0:fy1, fx0:fx1]; mask[:Hf, :Wf] = g.front[fy0:fy1, fx0:fx1]
    atlas[:Hs, Wf:Wf + Ws] = rgb[sy0:sy1, sx0:sx1]; mask[:Hs, Wf:Wf + Ws] = g.side[sy0:sy1, sx0:sx1]
    if back_color is not None:
        atlas[:, Wf + Ws:Wf + Ws + 16] = back_color; atlas[:, Wf + Ws + 16:] = back_color2; mask[:, Wf + Ws:] = True
    filled = mask.copy()
    for _ in range(bleed):  # edge bleed: background pixels take the nearest silhouette colour so edge texels never sample the grey
        if filled.all(): break
        acc = np.zeros_like(atlas); cnt = np.zeros(filled.shape, dtype=np.float32)
        for sh in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            f = np.roll(filled, sh, (0, 1)); c = np.roll(atlas, sh, (0, 1))
            acc += c * f[..., None]; cnt += f
        new = (~filled) & (cnt > 0)
        atlas[new] = acc[new] / cnt[new][:, None]; filled |= new
    save_png(np.clip(atlas, 0, 255).astype(np.uint8), out_png)
    return dict(Wa=Wa, Ha=Ha, Wf=Wf, Hf=Hf, Ws=Ws, Hs=Hs, fx0=fx0, fy0=fy0, sx0=sx0, sy0=sy0)


def project_uvs(me, g, T, use_back=False, zmax=1e9):
    me.calc_loop_triangles()
    nl = len(me.loops)
    vi = np.empty(nl, dtype=np.int32); me.loops.foreach_get('vertex_index', vi)
    co = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    pn = np.empty(len(me.polygons) * 3, dtype=np.float32); me.polygons.foreach_get('normal', pn); pn = pn.reshape(-1, 3)
    ls = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('loop_start', ls)
    lt = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('loop_total', lt)
    poly_of_loop = np.repeat(np.arange(len(me.polygons)), lt)
    use_front = (np.abs(pn[:, 1]) >= np.abs(pn[:, 0]))[poly_of_loop]
    p = co[vi]
    fu = g.px_fx(p[:, 0]) - T['fx0']; fv = g.row_f(p[:, 2]) - T['fy0']
    su = T['Wf'] + g.px_sy(p[:, 1]) - T['sx0']; sv = g.row_s(p[:, 2]) - T['sy0']
    u = np.where(use_front, np.clip(fu, 1, T['Wf'] - 1), np.clip(su, T['Wf'] + 1, T['Wf'] + T['Ws'] - 1))
    v = np.where(use_front, fv, sv)
    if use_back:  # back-facing faces: solid cape colour patch (the hidden back is unknown; the cape covers it on this kind of character)
        pz = co[vi][:, 2]; pzc = np.add.reduceat(pz, ls) / lt
        bk = (pn[:, 1] > 0.35)[poly_of_loop]; low = (pzc < zmax)[poly_of_loop]
        u = np.where(bk, T['Wf'] + T['Ws'] + np.where(low, 8, 24), u); v = np.where(bk, 8, v)
    uv = np.stack([u / T['Wa'], 1.0 - v / T['Ha']], axis=1).astype(np.float32)
    layer = me.uv_layers.new(name='UVMap')
    layer.data.foreach_set('uv', uv.ravel())
    return float(use_front[::3].mean())


def run(p):
    out = p['outDir']; os.makedirs(out, exist_ok=True)
    name = p.get('name', 'model')
    h = float(p.get('heightMeters', 1.0)); budget = int(p.get('triangleBudget', 10000)); N = int(p.get('detail', 128))
    log = {}
    rgb = load_rgb(p['image'])
    seg = segment(rgb, p)
    fm, sm = seg['masks']['front'], seg['masks']['side']
    cape = detect_cape(rgb, seg['masks'], p) if p.get('separateCape', True) else None
    if cape:
        # keep the collar (cape rows just under its top edge) as body, so the neck/shoulders are not hollowed out
        for k, m in (('front', fm), ('side', sm)):
            fr_ = np.nonzero(m.any(axis=1))[0]; rows = np.nonzero(cape[k].any(axis=1))[0]; cut = int(rows.min() + 0.05 * (fr_.max() - fr_.min()))
            cape[k][:cut] = False
        g = Geo(fm, sm, h, body_without_cape(fm, cape['front']), body_without_cape(sm, cape['side']), cape['front'], cape['side'])
        log['cape'] = {'detected': True, 'frontFraction': cape['frontFraction'], 'sideFraction': cape['sideFraction'], 'model': 'thin double-sided sheet at the rear of the body (colour heuristic)'}
    else:
        g = Geo(fm, sm, h); log['cape'] = {'detected': False}
    log['silhouette'] = {'splitX': seg['splitX'], 'frontBBox': g.fb, 'sideBBox': g.sb, 'heightRatioFrontOverSide': g.hf_px / g.hs_px, 'sideRefPx': g.sref}

    if cape:
        dbg = rgb.copy(); sxx = seg['splitX']
        for m, col in ((cape['front'], (255, 0, 255)), (cape['side'], (255, 0, 255))): dbg[m] = (0.5 * dbg[m] + 0.5 * np.array(col)).astype(np.uint8)
        for m, col in ((g.front_b, (0, 255, 0)), (g.side_b, (0, 255, 0))): e = m & ~erode(m, 2); dbg[e] = col
        save_png(dbg, os.path.join(out, f'{name}_cape_body_split.png'))
    # --- hull
    S = skeleton.infer(g, tail_bones=int(p.get('tailBones', 6)))
    B = rig.bones_table(S, g, int(p.get('tailBones', 6)))
    tail_pts = [np.array(b_['head']) for b_ in B if b_['name'].startswith('Tail')] + [np.array([b_ for b_ in B if b_['name'].startswith('Tail')][-1]['tail'])]
    tail_r = max((S['tail']['thick'] / 2 * 0.95) if S['tail'] else 0.02 * h, 2.2 * h / N)
    occ, origin, vs = hull.carve(g, N=N, exponent=float(p.get('crossSectionExponent', 2.4)), tail=(tail_pts, tail_r))
    field = hull.blur3(occ.astype(np.float32), float(p.get('smooth', 1.1)))
    v, t = hull.surface_nets(field)
    world = np.stack([origin[0] + (v[:, 0] + 0.5) * vs, origin[1] + (v[:, 1] + 0.5) * vs, origin[2] + (v[:, 2] + 0.5) * vs], axis=1)
    log['hull'] = {'grid': list(occ.shape), 'voxel': vs, 'voxels': int(occ.sum()), 'rawTris': int(len(t))}

    bpy.ops.wm.read_factory_settings(use_empty=True)
    me = bpy.data.meshes.new(name)
    me.from_pydata(world.tolist(), [], t.tolist()); me.update()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    # decimate to budget
    ntri = len(me.polygons)
    if ntri > budget:
        md = ob.modifiers.new('dec', 'DECIMATE'); md.ratio = budget / ntri
        bpy.ops.object.modifier_apply(modifier=md.name)
    tm = ob.modifiers.new('tri', 'TRIANGULATE'); bpy.ops.object.modifier_apply(modifier=tm.name)
    for pg in me.polygons: pg.use_smooth = True
    me.update()
    log['mesh'] = {'triangles': len(me.polygons), 'vertices': len(me.vertices)}

    # --- skeleton
    arm = rig.build_armature(B, 'Armature')

    # --- texture (projected from the source views) + UVs
    tex_png = os.path.join(out, f'{name}_texture.png')
    back_color = back_color2 = None
    if cape:
        back_color = np.median(rgb[g.cape_f], axis=0)  # cape cloth colour for the (unseen) lower back
        rr = slice(int(g.row_s(0.88 * h)), int(g.row_s(0.76 * h)))
        back_color2 = np.median(rgb[rr][g.side[rr]], axis=0)  # fur colour from the side-view head for the back of the head
    T = make_texture(rgb, g, tex_png, back_color=back_color, back_color2=back_color2)
    frac = project_uvs(me, g, T, use_back=bool(cape), zmax=S['det'].get('neckZ', 0.72 * h) - 0.02 * h)
    img = bpy.data.images.load(tex_png); img.pack()
    mat = bpy.data.materials.new(name + '_mat'); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes.get('Principled BSDF')
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = img; tn.interpolation = 'Linear'; tn.extension = 'EXTEND'
    nt.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    for k in ('Specular IOR Level', 'Specular'):
        if k in bsdf.inputs: bsdf.inputs[k].default_value = 0.1
    me.materials.append(mat)
    log['texture'] = {'method': 'planar projection of the source front/side crops via per-face UVs (front-facing faces use the front view, side-facing the side view); hidden back: solid cape colour when a cape was detected, else mirrored from the front', 'atlas': [T['Wa'], T['Ha']], 'frontFaceFraction': frac}

    # --- skin
    verts = np.array([v.co[:] for v in me.vertices])
    method = rig.skin(ob, arm, B, verts, prefer_auto=not p.get('forceDistanceWeights'))
    log['skinning'] = method
    log['poseTest'] = rig.pose_test(arm, ob)

    # --- outputs
    blend = os.path.join(out, f'{name}.blend'); glb = os.path.join(out, f'{name}.glb')
    sk = {'format': 'img2model-skeleton@1', 'units': 'm', 'frame': 'glTF: Y up, character faces +Z, Left = +X', 'height': h, 'naming': 'Mixamo/Meshy style + Tail1..N',
          'bones': [{'name': b['name'], 'parent': b['parent'], 'head': to_gltf(b['head']), 'tail': to_gltf(b['tail'])} for b in B],
          'landmarks': {'neckZ': S['det'].get('neckZ'), 'hipZ': S['zh'], 'shoulderZ': S['zsh'], 'det': S['det']}, 'notes': S['notes']}
    sj = os.path.join(out, f'{name}_skeleton.json'); json.dump(sk, open(sj, 'w'), indent=1, default=float)
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    for o in bpy.context.scene.objects: o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_skins=True, export_animations=False, export_apply=False, export_image_format='AUTO')
    # debug overlay: skeleton on the source views
    ov = rgb.copy(); sx = seg['splitX']
    for b in B:
        a, c = b['head'], b['tail']
        col = (255, 0, 255) if b['name'].startswith('Tail') else (0, 120, 255) if b['name'].startswith('Left') else (0, 200, 60) if b['name'].startswith('Right') else (255, 255, 0)
        draw_line(ov, (g.px_fx(a[0]), g.row_f(a[2])), (g.px_fx(c[0]), g.row_f(c[2])), col, 3)
        draw_dot(ov, (g.px_fx(a[0]), g.row_f(a[2])), (255, 255, 255), 6)
        draw_line(ov, (g.px_sy(a[1]), g.row_s(a[2])), (g.px_sy(c[1]), g.row_s(c[2])), col, 3)
        draw_dot(ov, (g.px_sy(a[1]), g.row_s(a[2])), (255, 255, 255), 6)
    skov = os.path.join(out, f'{name}_skeleton_overlay.png'); save_png(ov, skov)
    shots = []
    if p.get('render', True):
        shots = render.render_all(out, name, ob, arm, B, h)
    rep = {'files': {'glb': glb, 'blend': blend, 'skeleton': sj, 'texture': tex_png, 'skeletonOverlay': skov}, 'screens': shots, 'triangles': len(me.polygons), 'vertices': len(me.vertices),
           'joints': len(B), 'bones': [b['name'] for b in B], 'skinning': method, 'poseTest': log['poseTest'], 'log': log, 'notes': S['notes'],
           'bounds': {'min': [float(x) for x in verts.min(0)], 'max': [float(x) for x in verts.max(0)], 'frame': 'Blender Z-up'}}
    return rep


if __name__ == '__main__':
    emit({'ok': True, 'report': run(parse_params())})
