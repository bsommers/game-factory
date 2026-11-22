# Visual-hull carve (lofted elliptical cross-sections) + surface-nets meshing. numpy only.
import numpy as np
from common import runs_1d


def _gauss_kernel(sigma):
    r = max(1, int(np.ceil(3 * sigma)))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-0.5 * (x / sigma) ** 2); k /= k.sum()
    return k, r


def blur3(f, sigma):
    if sigma <= 0: return f
    k, r = _gauss_kernel(sigma)
    for ax in range(3):
        pad = [(0, 0)] * 3; pad[ax] = (r, r)
        p = np.pad(f, pad, mode='edge')
        out = np.zeros_like(f)
        for i, w in enumerate(k):
            sl = [slice(None)] * 3; sl[ax] = slice(i, i + f.shape[ax])
            out += w * p[tuple(sl)]
        f = out
    return f


def carve(g, N=128, exponent=2.4, margin=4, min_run=2, tail=None):
    """Occupancy grid [nx, ny, nz] (bool) + origin/voxel size. For each z slice, every front run x side run pair gives a
    super-ellipse cross-section (half-axes = half run widths). Runs much narrower than the widest are 'appendages'
    (tail in the side view, hands in the front view) and get a circular section instead of a fin."""
    h = g.h; vs = h / N
    xmin = g.fx(g.fb[0]) - margin * vs; xmax = g.fx(g.fb[2] + 1) + margin * vs
    ymin = g.sy(g.sb[0]) - margin * vs; ymax = g.sy(g.sb[2] + 1) + margin * vs
    nx = int(np.ceil((xmax - xmin) / vs)); ny = int(np.ceil((ymax - ymin) / vs))
    occ = np.zeros((nx, ny, N), dtype=bool)
    ix = np.arange(nx) + 0.5; iy = np.arange(ny) + 0.5
    pxc = np.clip((g.px_fx(xmin + ix * vs)).astype(int), 0, g.front.shape[1] - 1)
    pyc = np.clip((g.px_sy(ymin + iy * vs)).astype(int), 0, g.side.shape[1] - 1)
    x0 = (0 - xmin) / vs  # x=0 in voxel units
    for k in range(N):
        z = (k + 0.5) * vs
        fr = runs_1d(g.front_b[g.frow_px(z)][pxc], min_run)
        sr = runs_1d(g.side_b[g.srow_px(z)][pyc], min_run)
        sl = np.zeros((nx, ny), dtype=bool)
        if g.cape_f is not None and g.cape_s is not None:
            cs_runs = runs_1d(g.cape_s[g.srow_px(z)][pyc], min_run); fe = runs_1d(g.front[g.frow_px(z)][pxc], min_run)
            if cs_runs and fe:
                xa, xb = fe[0][0], fe[-1][1]
                for c, d in cs_runs:
                    t = float(np.clip(0.85 * (d - c), 2.5, 0.09 * N)); cc = (c + d) / 2
                    u = np.abs((ix - (xa + xb) / 2) / ((xb - xa) / 2))[:, None] ** 4
                    v = np.abs((iy - cc) / (t / 2))[None, :] ** 4
                    sl |= (u + v) <= 1.0
        if not fr or not sr:
            occ[:, :, k] = sl; continue
        fw = [b - a for a, b in fr]; sw = [b - a for a, b in sr]
        fmain = [r for r, w in zip(fr, fw) if w >= 0.5 * max(fw)]
        smain = [r for r, w in zip(sr, sw) if w >= 0.5 * max(sw)]
        fapp = [r for r in fr if r not in fmain]
        sapp = [r for r in sr if r not in smain]
        for a, b in fmain:
            cf, rf = (a + b) / 2, (b - a) / 2
            u = np.abs((ix - cf) / rf)[:, None] ** exponent
            for c, d in smain:
                cs, rs = (c + d) / 2, (d - c) / 2
                v = np.abs((iy - cs) / rs)[None, :] ** exponent
                sl |= (u + v) <= 1.0
        # appendages: circular sections
        big_s = max(smain, key=lambda r: r[1] - r[0]); cs_main = (big_s[0] + big_s[1]) / 2; rs_main = (big_s[1] - big_s[0]) / 2
        big_f = max(fmain, key=lambda r: r[1] - r[0]); rf_main = (big_f[1] - big_f[0]) / 2
        for a, b in fapp:  # e.g. hands/arms: depth guessed equal to width, centred on the main body depth
            cf, rf = (a + b) / 2, (b - a) / 2
            r = min(rf, rs_main)
            sl |= (((ix - cf) / r)[:, None] ** 2 + ((iy - cs_main) / r)[None, :] ** 2) <= 1.0
        for c, d in sapp:  # e.g. tail: width guessed equal to depth, centred on x=0
            cs, rs = (c + d) / 2, (d - c) / 2
            r = min(rs, rf_main)
            sl |= (((ix - x0) / r)[:, None] ** 2 + ((iy - cs) / r)[None, :] ** 2) <= 1.0
        occ[:, :, k] = sl
    if tail is not None:  # round tail swept along the inferred tail chain (also bridges tail root into the body)
        pts, r = tail
        dense = []
        for a, b in zip(pts[:-1], pts[1:]):
            n = max(2, int(np.linalg.norm(b - a) / (vs * 0.5)))
            dense += [a + (b - a) * t for t in np.linspace(0, 1, n)]
        gx, gy, gz = np.meshgrid((xmin + (np.arange(nx) + 0.5) * vs), (ymin + (np.arange(ny) + 0.5) * vs), ((np.arange(N) + 0.5) * vs), indexing='ij')
        for q in dense:
            sl = (slice(max(int((q[0] - r - xmin) / vs) - 1, 0), int((q[0] + r - xmin) / vs) + 2), slice(max(int((q[1] - r - ymin) / vs) - 1, 0), int((q[1] + r - ymin) / vs) + 2), slice(max(int((q[2] - r) / vs) - 1, 0), int((q[2] + r) / vs) + 2))
            d2 = (gx[sl] - q[0]) ** 2 + (gy[sl] - q[1]) ** 2 + (gz[sl] - q[2]) ** 2
            occ[sl] |= d2 <= r * r
    return occ, (xmin, ymin, 0.0), vs


def surface_nets(field, iso=0.5):
    """Naive surface nets on a float field; returns (verts [n,3] in grid-index units, tris [m,3]) with outward winding."""
    F = np.pad(field.astype(np.float32), 2, mode='constant')
    s = F > iso
    nx, ny, nz = F.shape
    cs = (nx - 1, ny - 1, nz - 1)
    corners = [(a, b, c) for a in (0, 1) for b in (0, 1) for c in (0, 1)]
    cs_s = np.zeros(cs, dtype=np.int8)
    for a, b, c in corners:
        cs_s += s[a:a + cs[0], b:b + cs[1], c:c + cs[2]].astype(np.int8)
    active = (cs_s > 0) & (cs_s < 8)
    ci = np.argwhere(active)  # [M,3]
    M = len(ci)
    idx_map = -np.ones(cs, dtype=np.int32)
    idx_map[active] = np.arange(M, dtype=np.int32)
    cv = {}
    for a, b, c in corners:
        cv[(a, b, c)] = F[ci[:, 0] + a, ci[:, 1] + b, ci[:, 2] + c]
    acc = np.zeros((M, 3), dtype=np.float32); cnt = np.zeros(M, dtype=np.float32)
    for p in corners:
        for ax in range(3):
            if p[ax] == 0:
                q = list(p); q[ax] = 1; q = tuple(q)
                v0, v1 = cv[p], cv[q]
                cross = (v0 > iso) != (v1 > iso)
                t = (iso - v0) / np.where(np.abs(v1 - v0) < 1e-9, 1e-9, v1 - v0)
                pos = np.zeros((M, 3), dtype=np.float32)
                pos[:] = np.array(p, dtype=np.float32)
                pos[:, ax] = t
                acc += np.where(cross[:, None], pos, 0); cnt += cross
    verts = ci.astype(np.float32) + acc / np.maximum(cnt, 1)[:, None] - 2.0 + 0.0  # undo pad
    tris = []
    for ax in range(3):
        a1, a2 = (ax + 1) % 3, (ax + 2) % 3
        # grid edges along ax between lattice points p and p+e_ax
        lo = [slice(None)] * 3; hi = [slice(None)] * 3
        lo[ax] = slice(0, nx - 1 if ax == 0 else (ny - 1 if ax == 1 else nz - 1)); hi[ax] = slice(1, None)
        s_lo = s[tuple(lo)]; s_hi = s[tuple(hi)]
        e = np.argwhere(s_lo != s_hi)
        # keep edges whose 4 surrounding cells exist (a1,a2 index >= 1 and within cell range)
        ok = (e[:, a1] >= 1) & (e[:, a2] >= 1) & (e[:, a1] < cs[a1]) & (e[:, a2] < cs[a2]) & (e[:, ax] < cs[ax])
        e = e[ok]
        inside_lo = s_lo[tuple(e.T)]
        def cell(d1, d2):
            c = e.copy(); c[:, a1] += d1; c[:, a2] += d2
            return idx_map[c[:, 0], c[:, 1], c[:, 2]]
        q = np.stack([cell(-1, -1), cell(0, -1), cell(0, 0), cell(-1, 0)], axis=1)
        q = np.where(inside_lo[:, None], q, q[:, ::-1])
        good = (q >= 0).all(axis=1); q = q[good]
        tris.append(q[:, [0, 1, 2]]); tris.append(q[:, [0, 2, 3]])
    tris = np.concatenate(tris)
    return verts, tris
