# Skeleton inference from the two silhouettes (slice-width analysis). Returns bones in the Blender frame (X right=cat left, -Y front, Z up).
# Naming follows Mixamo/Meshy (Hips, Spine, Spine1, Spine2, Neck, Head, LeftShoulder/Arm/ForeArm/Hand, LeftUpLeg/Leg/Foot/ToeBase) + Tail1..TailN.
import numpy as np
from common import runs_1d


def _smooth(a, k=5):
    p = np.pad(a, k // 2, mode='edge'); return np.convolve(p, np.ones(k) / k, mode='valid')


def infer(g, tail_bones=6, log=None):
    h = g.h
    notes = []; det = {}
    zs = np.linspace(0.01 * h, 0.99 * h, 240)

    def fw(z):
        e = g.front_extent(z); return (g.fx(e[1]) - g.fx(e[0])) if e else 0.0

    W = _smooth(np.array([fw(z) for z in zs]), 7)

    # ---- neck: width minimum between shoulders and the widest head slice
    sel = (zs > 0.70 * h) & (zs < 0.95 * h)
    zpeak = zs[sel][np.argmax(W[sel])]
    sel2 = (zs > 0.60 * h) & (zs <= zpeak)
    zneck = float(zs[sel2][np.argmin(W[sel2])])
    det['headWidestZ'] = float(zpeak); det['neckZ'] = zneck
    if not (0.62 * h < zneck < zpeak - 0.02 * h):
        zneck = 0.72 * h; notes.append('neck: no clear width minimum, used 0.72*height')
        det['neckZ'] = zneck; det['neckFallback'] = True

    # ---- body-centre depth at z (cape-capped, see Geo.sref)
    def ys(z):
        ext = g.side_extent(z, True); f = g.front_extent(z, True)
        if ext is None: return 0.0
        d = ext[1] - ext[0]
        if f is not None: d = min(d, (f[1] - f[0]) * 1.05)
        return g.sy(ext[0] + d / 2.0)

    def head_y(z):
        r = g.side_runs_m(z, 3, True)
        if not r: return ys(z)
        a, b = max(r, key=lambda t: t[1] - t[0]); return (a + b) / 2

    zh = 0.30 * h  # hip height (fraction: not observable in silhouettes of a clothed, caped character)
    zsh = zneck - 0.07 * h
    zn0 = zneck - 0.04 * h
    zhead = zneck + 0.02 * h

    P = {}
    P['hips_h'] = (0, ys(zh - 0.05 * h), zh - 0.05 * h); P['hips_t'] = (0, float(np.clip(ys(zh), ys(zh - 0.05 * h) - 0.02 * h, ys(zh - 0.05 * h) + 0.02 * h)), zh)
    zsp = np.linspace(zh, zn0, 4)
    yv = np.array([ys(z) for z in zsp]); med = float(np.median(yv))
    sp = [(0, float(np.clip(y, med - 0.02 * h, med + 0.02 * h)), z) for y, z in zip(yv, zsp)]  # keep the spine near-vertical: slice centres are noisy where clothes/cape widen the side view
    P['spine'] = sp
    P['hips_t'] = sp[0]; P['hips_h'] = (0, sp[0][1], zh - 0.05 * h)
    P['neck_h'] = (0, sp[-1][1], zn0); P['neck_t'] = (0, head_y(zhead + 0.04 * h), zhead)
    P['head_t'] = (0, head_y(0.8 * h), h - 0.015 * h)

    # ---- legs: two front runs near the feet
    za = 0.06 * h
    runs = [r for r in g.front_runs_m(0.035 * h, 6)]
    runs = sorted(runs, key=lambda r: r[0] - r[1])[:2]  # two widest
    cx = sorted([(a + b) / 2 for a, b in runs])
    if len(cx) == 2 and cx[1] - cx[0] > 0.05 * h:
        xl = (abs(cx[0]) + abs(cx[1])) / 2; det['legX'] = float(xl)
    else:
        xl = 0.11 * h; notes.append('legs: feet not separable in the front view, used +-0.11*height'); det['legXFallback'] = True
    ext = g.side_extent(0.03 * h)
    toe_y = g.sy(ext[0]) if ext else -0.05 * h
    foot_len = min(0.09 * h, (g.sy(ext[1]) - toe_y) if ext else 0.09 * h)
    ank_y = toe_y + 0.6 * foot_len
    hip_y = med; zk = (zh + za) / 2 + 0.01 * h
    knee_y = (hip_y + ank_y) / 2

    # ---- arms: widest point below the shoulders, rows 0.25h..0.65h
    best = {'L': (0, zh), 'R': (0, zh)}
    for z in np.linspace(0.25 * h, 0.66 * h, 60):
        e = g.front_extent(z)
        if e is None: continue
        xr, xl_ = g.fx(e[1]), g.fx(e[0])
        if xr > best['L'][0]: best['L'] = (xr, z)
        if xl_ < best['R'][0]: best['R'] = (xl_, z)
    hand_x = (abs(best['L'][0]) + abs(best['R'][0])) / 2; hand_z = (best['L'][1] + best['R'][1]) / 2
    det['handTip'] = [float(hand_x), float(hand_z)]
    fe = g.front_extent(zsh); hw_sh = (g.fx(fe[1]) - g.fx(fe[0])) / 2
    sh_x = 0.55 * hw_sh
    arm_y = med - 0.02 * h
    wr = (hand_x * 0.93, hand_z + 0.05 * h); tip = (hand_x, hand_z)
    sh = (sh_x, zsh)
    el = ((sh[0] + wr[0]) / 2 * 1.05, (sh[1] + wr[1]) / 2)

    # ---- tail from the side view: seed at the right-most mask pixel, follow the run upward and downward
    tail = _tail(g, notes, det, h)
    return dict(P=P, zh=zh, zsh=zsh, zn0=zn0, xl=xl, za=za, zk=zk, hip_y=hip_y, knee_y=knee_y, ank_y=ank_y, toe_y=toe_y, foot_len=foot_len,
                arm_y=arm_y, sh=sh, el=el, wr=wr, tip=tip, tail=tail, notes=notes, det=det, ys=ys)


def _tail(g, notes, det, h):
    side = g.side
    cols = np.nonzero(side.any(axis=0))[0]
    xmax = int(cols.max())
    rows = np.nonzero(side[:, xmax])[0]
    r0 = int(rows[len(rows) // 2])
    pts = []  # (row, centre col, width)

    def run_at(r, lo, hi):
        for a, b in runs_1d(side[r], 1):
            if a < hi and b > lo: return a, b
        return None
    cur = (xmax - 4, xmax + 1)
    # upward
    up = []; lo, hi = cur
    for r in range(r0, g.sb[1] - 1, -1):
        rr = run_at(r, lo, hi)
        if rr is None: break
        # only follow the right-most overlapping run
        up.append((r, (rr[0] + rr[1]) / 2, rr[1] - rr[0])); lo, hi = rr
    # downward until it merges (width jumps) with the body/cape
    dn = []; lo, hi = cur
    w_ref = None
    for r in range(r0 + 1, g.feet_s):
        rr = run_at(r, lo, hi)
        if rr is None: break
        w = rr[1] - rr[0]
        if w_ref is None: w_ref = max(w, 1)
        if w > 1.9 * np.median([p[2] for p in up + dn]) + 6: break
        dn.append((r, (rr[0] + rr[1]) / 2, w)); lo, hi = rr
    allp = list(reversed(dn)) + up  # bottom -> top
    allp = [p for p in allp]
    if len(allp) < 20:
        notes.append('tail: could not follow the tail in the side view; used a default drooping tail')
        det['tailFallback'] = True
        return None
    # tail pixels -> metres; the very top rows are the rounded tip: skip the outer half-width
    poly = np.array([[g.sy(c), (g.feet_s - r) / g.ppm_s] for r, c, w in allp])
    thick = float(np.median([w for _, _, w in allp]) / g.ppm_s)
    det['tailPoints'] = len(allp); det['tailThickness'] = thick
    return {'poly': poly, 'thick': thick}
