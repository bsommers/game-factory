# img2model shared code (runs inside Blender's Python: numpy + bpy, no PIL/scipy).
# Frames: image rows go down; world (Blender) is X right (cat's LEFT), Y depth (-Y = the way the cat faces), Z up, feet at z=0.
import sys, os, json, math
import numpy as np

try:
    import bpy
except ImportError:  # unit use outside Blender is not supported
    bpy = None


def emit(obj):
    print('GF_JSON ' + json.dumps(obj, default=float), flush=True)


def parse_params():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    return json.loads(a[0]) if a else {}


# ---------------------------------------------------------------- image io
def load_rgb(path):
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[::-1, :, :3]  # top-down rows
    rgb = np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8)
    bpy.data.images.remove(img)
    return np.ascontiguousarray(rgb)


def save_png(rgb, path):
    h, w = rgb.shape[:2]
    if rgb.ndim == 2:
        rgb = np.repeat(rgb[:, :, None], 3, axis=2)
    img = bpy.data.images.new('tmp_' + os.path.basename(path), w, h, alpha=True)
    buf = np.ones((h, w, 4), dtype=np.float32)
    buf[:, :, :3] = rgb[::-1, :, :3].astype(np.float32) / 255.0
    img.pixels.foreach_set(buf.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


# ---------------------------------------------------------------- morphology / CC
def _shift_reduce(a, r, axis, fn):
    out = a.copy()
    for o in range(1, r + 1):
        for s in (o, -o):
            sh = np.roll(a, s, axis=axis)
            # neutralise wrap-around rows/cols
            idx = [slice(None)] * a.ndim
            if s > 0: idx[axis] = slice(0, s)
            else: idx[axis] = slice(s, None)
            sh[tuple(idx)] = a[tuple(idx)]
            out = fn(out, sh)
    return out


def erode(m, r):
    if r <= 0: return m
    return _shift_reduce(_shift_reduce(m, r, 0, np.logical_and), r, 1, np.logical_and)


def dilate(m, r):
    if r <= 0: return m
    return _shift_reduce(_shift_reduce(m, r, 0, np.logical_or), r, 1, np.logical_or)


def opening(m, r):
    return dilate(erode(m, r), r)


def label_components(mask):
    """4-connected components by run-length union-find. Returns (labels int32 [0=bg], areas list indexed by label)."""
    H, W = mask.shape
    d = np.diff(np.pad(mask.astype(np.int8), ((0, 0), (1, 1))), axis=1)
    r1, st = np.nonzero(d == 1)
    r2, en = np.nonzero(d == -1)
    st = st.tolist(); en = en.tolist()
    n = len(st)
    parent = list(range(n))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x

    first = np.searchsorted(r1, np.arange(H + 1)).tolist()
    for y in range(1, H):
        i, a1, j, b1 = first[y - 1], first[y], first[y], first[y + 1]
        while i < a1 and j < b1:
            if st[i] < en[j] and st[j] < en[i]:
                ri, rj = find(i), find(j)
                if ri != rj: parent[rj] = ri
            if en[i] <= en[j]: i += 1
            else: j += 1
    roots = {}
    labels = np.zeros((H, W), dtype=np.int32)
    areas = [0]
    rows = r1.tolist()
    for k in range(n):
        rt = find(k)
        lab = roots.get(rt)
        if lab is None:
            lab = len(areas); roots[rt] = lab; areas.append(0)
        labels[rows[k], st[k]:en[k]] = lab
        areas[lab] += en[k] - st[k]
    return labels, areas


def fill_holes(mask):
    labels, _ = label_components(~mask)
    border = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]])).tolist())
    holes = (labels > 0) & ~np.isin(labels, list(border))
    return mask | holes


# ---------------------------------------------------------------- segmentation
def estimate_background(rgb, border=12):
    strips = np.concatenate([rgb[:border].reshape(-1, 3), rgb[-border:].reshape(-1, 3), rgb[:, :border].reshape(-1, 3), rgb[:, -border:].reshape(-1, 3)]).astype(np.float32)
    med = np.median(strips, axis=0)
    dist = np.sqrt(((strips - med) ** 2).sum(1))
    return med, float(np.percentile(dist, 99))


def find_split(mask):
    """Auto split column: centre of the longest empty column run whose centre lies in the middle 30-70% of the width."""
    W = mask.shape[1]
    occ = mask.any(axis=0)
    best = None
    x = int(W * 0.30)
    hi = int(W * 0.70)
    while x < hi:
        if not occ[x]:
            s = x
            while x < W and not occ[x]: x += 1
            e = x
            if best is None or (e - s) > (best[1] - best[0]): best = (s, e)
        else:
            x += 1
    return ((best[0] + best[1]) // 2, best) if best else (W // 2, None)


def keep_figure(mask, min_frac):
    """Keep the largest component plus big ones; drop small stuff (text labels) and anything wholly below the figure's feet."""
    labels, areas = label_components(mask)
    if len(areas) <= 1: return mask, []
    big = int(np.argmax(areas[1:])) + 1
    ys = np.nonzero((labels == big).any(axis=1))[0]
    feet = int(ys.max())
    keep = np.zeros(len(areas), dtype=bool); keep[big] = True
    dropped = []
    for lab in range(1, len(areas)):
        if lab == big: continue
        yy, xx = np.nonzero(labels == lab) if areas[lab] < areas[big] else (None, None)
        top = int(yy.min()) if yy is not None else 0
        if areas[lab] >= min_frac * areas[big] and top <= feet:
            keep[lab] = True
        else:
            dropped.append({'area': int(areas[lab]), 'bbox': [int(xx.min()), int(yy.min()), int(xx.max()), int(yy.max())]})
    return keep[labels], dropped


def bbox(mask):
    ys = np.nonzero(mask.any(axis=1))[0]; xs = np.nonzero(mask.any(axis=0))[0]
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def segment(rgb, params):
    H, W = rgb.shape[:2]
    bg, noise = estimate_background(rgb)
    thr = params.get('threshold') or (30.0 + 3.0 * noise)
    dist = np.sqrt(((rgb.astype(np.float32) - bg) ** 2).sum(-1))
    fg = dist > thr
    clean = int(params.get('cleanRadius', 4))
    close_r = int(params.get('closeRadius', 6))
    fg = erode(dilate(fg, close_r), close_r)  # bridge hairline gaps in the outline so interior light fills are not 'outside'
    split_info = None
    if params.get('splitX'):
        sx = int(params['splitX'])
    else:
        sx, split_info = find_split(fg)
    min_frac = float(params.get('minComponentFraction', 0.05))
    out = {}
    removed = {}
    for name, (a, b) in (('front', (0, sx)), ('side', (sx, W))):
        m = np.zeros((H, W), dtype=bool)
        m[:, a:b] = fg[:, a:b]
        m, dropped = keep_figure(m, min_frac)
        m = fill_holes(m)
        m = opening(m, clean)  # last: removes whiskers / thin stray lines that stick out of the silhouette
        m, _ = keep_figure(m, min_frac)
        out[name] = m
        removed[name] = dropped
    return {'masks': out, 'bg': [float(v) for v in bg], 'bgNoise': noise, 'threshold': float(thr), 'splitX': int(sx),
            'splitGap': [int(split_info[0]), int(split_info[1])] if split_info else None, 'removed': removed, 'size': [W, H]}


# ---------------------------------------------------------------- optional cape separation (colour heuristic)
def hue_sat(rgb):
    f = rgb.astype(np.float32) / 255.0
    mx = f.max(-1); mn = f.min(-1); d = mx - mn
    s = np.where(mx > 0, d / np.maximum(mx, 1e-6), 0)
    r, g_, b = f[..., 0], f[..., 1], f[..., 2]
    hue = np.where(mx == r, ((g_ - b) / np.maximum(d, 1e-6)) % 6, np.where(mx == g_, (b - r) / np.maximum(d, 1e-6) + 2, (r - g_) / np.maximum(d, 1e-6) + 4)) * 60.0
    return hue, s, mx


def detect_cape(rgb, masks, params):
    """Find a saturated, uniformly coloured cloth region (the cape) in both views. Returns {'front': mask, 'side': mask, 'color': ...} or None.
    Heuristic: take the most saturated hue cluster (HSV s >= capeSat) that forms large connected areas in BOTH views."""
    hue, sat, val = hue_sat(rgb)
    lo, hi, smin = params.get('capeHue', [14.0, 24.0]), None, float(params.get('capeSat', 0.925))
    lo, hi = float(lo[0]), float(lo[1])
    cand = (sat >= smin) & (hue >= lo) & (hue <= hi) & (val > 0.3)
    out = {}
    for k in ('front', 'side'):
        m = cand & masks[k]
        m = erode(dilate(m, 5), 5)
        lab, areas = label_components(m)
        if len(areas) <= 1: return None
        big = max(areas[1:])
        keep = np.array([False] + [a >= 0.2 * big for a in areas[1:]])
        m = keep[lab]
        m = fill_holes(m)
        out[k] = dilate(m, 4) & masks[k]
    fa = out['front'].sum() / max(masks['front'].sum(), 1); sa = out['side'].sum() / max(masks['side'].sum(), 1)
    if fa < 0.04 or sa < 0.04: return None
    out['frontFraction'] = float(fa); out['sideFraction'] = float(sa)
    return out


def body_without_cape(mask, cape, r=4, min_frac=0.02):
    b = mask & ~cape
    b = opening(b, r)
    b, _ = keep_figure(b, min_frac)
    return fill_holes(b)


# ---------------------------------------------------------------- geometry registration
class Geo:
    """Maps between image pixels (front/side) and metres. Front: X = (px-cx_f)/ppm_f. Side: Y = (px-sref)/ppm_s (image right = rear)."""

    def __init__(self, front, side, height, front_body=None, side_body=None, cape_f=None, cape_s=None):
        self.h = height
        self.front, self.side = front, side
        self.front_b = front if front_body is None else front_body
        self.side_b = side if side_body is None else side_body
        self.cape_f, self.cape_s = cape_f, cape_s
        self.fb, self.sb = bbox(front), bbox(side)
        self.hf_px = self.fb[3] - self.fb[1] + 1
        self.hs_px = self.sb[3] - self.sb[1] + 1
        self.ppm_f = self.hf_px / height
        self.ppm_s = self.hs_px / height
        self.cx_f = (self.fb[0] + self.fb[2] + 1) / 2.0
        self.feet_f = self.fb[3] + 1
        self.feet_s = self.sb[3] + 1
        # side reference (body centre in depth): mid of the mask extent over the pelvis/belly band, cape-capped by front width.
        zs = np.linspace(0.12 * height, 0.40 * height, 12)
        mids = []
        for z in zs:
            ext = self.side_extent(z, True)
            fw = self.front_extent(z, True)
            if ext is None or fw is None: continue
            depth = ext[1] - ext[0]
            eff = min(depth, (fw[1] - fw[0]) * 1.05)
            mids.append(ext[0] + eff / 2.0)
        # side_extent is in px relative to sref=0 at this point, so mids are px
        self.sref = float(np.median(mids)) if mids else (self.sb[0] + self.sb[2]) / 2.0

    # raw pixel rows
    def frow_px(self, z):
        return int(np.clip(self.feet_f - z * self.ppm_f, 0, self.front.shape[0] - 1))

    def srow_px(self, z):
        return int(np.clip(self.feet_s - z * self.ppm_s, 0, self.side.shape[0] - 1))

    def front_extent(self, z, body=False):
        xs = np.nonzero((self.front_b if body else self.front)[self.frow_px(z)])[0]
        return (xs.min() - 0.0, xs.max() + 1.0) if len(xs) else None

    def side_extent(self, z, body=False):
        xs = np.nonzero((self.side_b if body else self.side)[self.srow_px(z)])[0]
        return (xs.min() - 0.0, xs.max() + 1.0) if len(xs) else None

    # metres
    def fx(self, px): return (px - self.cx_f) / self.ppm_f
    def sy(self, px): return (px - self.sref) / self.ppm_s
    def px_fx(self, x): return self.cx_f + x * self.ppm_f
    def px_sy(self, y): return self.sref + y * self.ppm_s
    def row_f(self, z): return self.feet_f - z * self.ppm_f
    def row_s(self, z): return self.feet_s - z * self.ppm_s

    def front_runs_m(self, z, minpx=3, body=False):
        return [(self.fx(a), self.fx(b)) for a, b in runs_1d((self.front_b if body else self.front)[self.frow_px(z)], minpx)]

    def side_runs_m(self, z, minpx=3, body=False):
        return [(self.sy(a), self.sy(b)) for a, b in runs_1d((self.side_b if body else self.side)[self.srow_px(z)], minpx)]


def runs_1d(row, minlen=1):
    d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]]))
    s = np.nonzero(d == 1)[0]; e = np.nonzero(d == -1)[0]
    return [(int(a), int(b)) for a, b in zip(s, e) if b - a >= minlen]


# ---------------------------------------------------------------- drawing (debug overlays)
def draw_line(img, p0, p1, color, th=2):
    n = int(max(abs(p1[0] - p0[0]), abs(p1[1] - p0[1]))) + 1
    xs = np.linspace(p0[0], p1[0], n).astype(int); ys = np.linspace(p0[1], p1[1], n).astype(int)
    H, W = img.shape[:2]
    for dx in range(-th, th + 1):
        for dy in range(-th, th + 1):
            x = np.clip(xs + dx, 0, W - 1); y = np.clip(ys + dy, 0, H - 1)
            img[y, x] = color


def draw_dot(img, p, color, r=6):
    H, W = img.shape[:2]
    x0, x1 = int(max(p[0] - r, 0)), int(min(p[0] + r + 1, W)); y0, y1 = int(max(p[1] - r, 0)), int(min(p[1] + r + 1, H))
    img[y0:y1, x0:x1] = color


def contour_overlay(rgb, mask, color=(255, 0, 0)):
    edge = mask & ~erode(mask, 2)
    out = rgb.copy(); out[edge] = color
    return out
