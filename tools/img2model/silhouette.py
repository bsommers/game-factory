# blender -b --python tools/img2model/silhouette.py -- '<json params>'
# params: {image, outDir, splitX?, threshold?, cleanRadius?, minComponentFraction?, name?}
# Prints GF_JSON {...}; writes <name>_mask_front.png, <name>_mask_side.png, <name>_silhouette_overlay.png into outDir.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from common import *


def run(p):
    rgb = load_rgb(p['image'])
    seg = segment(rgb, p)
    out = p['outDir']; os.makedirs(out, exist_ok=True)
    name = p.get('name', 'model')
    fm, sm = seg['masks']['front'], seg['masks']['side']
    files = []
    for k, m in (('front', fm), ('side', sm)):
        f = os.path.join(out, f'{name}_mask_{k}.png'); save_png((m * 255).astype(np.uint8), f); files.append(f)
    ov = contour_overlay(contour_overlay(rgb, fm, (255, 0, 0)), sm, (0, 160, 255))
    sx = seg['splitX']; ov[:, sx - 1:sx + 1] = (0, 200, 0)
    f = os.path.join(out, f'{name}_silhouette_overlay.png'); save_png(ov, f); files.append(f)
    h = float(p.get('heightMeters', 1.0))
    g = Geo(fm, sm, h)
    rep = {'image': p['image'], 'size': seg['size'], 'background': seg['bg'], 'backgroundNoise': seg['bgNoise'], 'threshold': seg['threshold'],
           'splitX': seg['splitX'], 'splitGap': seg['splitGap'], 'splitAuto': not bool(p.get('splitX')),
           'front': {'bbox': g.fb, 'areaPx': int(fm.sum()), 'heightPx': g.hf_px, 'widthPx': g.fb[2] - g.fb[0] + 1, 'removedComponents': seg['removed']['front']},
           'side': {'bbox': g.sb, 'areaPx': int(sm.sum()), 'heightPx': g.hs_px, 'widthPx': g.sb[2] - g.sb[0] + 1, 'removedComponents': seg['removed']['side']},
           'heightRatioFrontOverSide': g.hf_px / g.hs_px, 'files': files}
    rep['warnings'] = []
    if abs(rep['heightRatioFrontOverSide'] - 1) > 0.06: rep['warnings'].append('front and side heights differ by more than 6%: views may not share a scale or the feet line')
    return rep


if __name__ == '__main__':
    emit({'ok': True, 'report': run(parse_params())})
