"""bvh: deterministic SAH-binned BVH over triangles or AABBs (port of bvh.js; spec/v3/bvh.md).

Build math is f64; node bounds are stored as f32 rounded OUTWARD. ``serialize`` produces the little-endian GPU buffer
(``bytes``) byte-identical to the reference. Triangle input: flat 9 numbers per triangle; AABB input: flat 6 per box.
Query results report ORIGINAL primitive indices.
"""
from __future__ import annotations

import math
import struct
from typing import Any, Dict, List, Optional

from . import collision3d as C3

INF = float("inf")
MAGIC = 0x33485642
VERSION = 1
KIND_TRI, KIND_AABB = 0, 1
NODE_WORDS, HEADER_WORDS = 8, 16
BINS = 16


# ---- float32 helpers ---------------------------------------------------------------------------------------------
def _f32(x: float) -> float:
    try:
        return struct.unpack("<f", struct.pack("<f", x))[0]
    except OverflowError:
        return math.copysign(INF, x)


def _bits(r: float) -> int:
    return struct.unpack("<I", struct.pack("<f", r))[0]


def _from_bits(u: int) -> float:
    return struct.unpack("<f", struct.pack("<I", u & 0xFFFFFFFF))[0]


def f32_down(x: float) -> float:
    r = _f32(x)
    if r > x:
        u = _bits(r)
        r = _from_bits(u - 1 if r > 0 else (0x80000001 if r == 0 else u + 1))
    return r


def f32_up(x: float) -> float:
    r = _f32(x)
    if r < x:
        u = _bits(r)
        r = _from_bits((1 if r == 0 else u + 1) if r >= 0 else u - 1)
    return r


def fnv1a32(data: bytes) -> int:
    h = 0x811C9DC5
    for b in data:
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


class Bvh:
    """Built BVH. ``nf``/``nu``: node words (8 per node) as f32-valued floats / u32 ints (bounds words in ``nf``,
    leftFirst/count words in ``nu``)."""

    def __init__(self, kind, count, stride, node_count, nf, nu, order, prims, src):
        self.kind, self.count, self.stride, self.node_count = kind, count, stride, node_count
        self.nf, self.nu, self.order, self.prims, self.src = nf, nu, order, prims, src


def _prim_bounds(kind, src, n):
    mn, mx = [0.0] * (n * 3), [0.0] * (n * 3)
    for i in range(n):
        for k in range(3):
            if kind == KIND_TRI:
                a, b, c = src[i * 9 + k], src[i * 9 + 3 + k], src[i * 9 + 6 + k]
                lo, hi = min(a, b, c), max(a, b, c)
            else:
                lo, hi = src[i * 6 + k], src[i * 6 + 3 + k]
            if not (math.isfinite(lo) and math.isfinite(hi)):
                raise ValueError("bvh: non-finite primitive %d" % i)
            mn[i * 3 + k], mx[i * 3 + k] = lo, hi
    return mn, mx


def _build(kind, inp, max_leaf_size=4) -> Bvh:
    src = [float(v) for v in inp]
    st = 9 if kind == KIND_TRI else 6
    n = len(src) // st
    max_leaf = max(1, 4 if max_leaf_size is None else max_leaf_size)
    mn, mx = _prim_bounds(kind, src, n)
    order = list(range(n))
    max_nodes = max(1, 2 * n)
    nf = [0.0] * (max_nodes * NODE_WORDS)
    nu = [0] * (max_nodes * NODE_WORDS)
    used = 1
    stack = [(0, 0, n)]

    def cen(i, k): return 0.5 * (mn[i * 3 + k] + mx[i * 3 + k])

    while stack:
        node, s, e = stack.pop()
        cnt = e - s
        bmin, bmax = [INF] * 3, [-INF] * 3
        for j in range(s, e):
            i = order[j]
            for k in range(3):
                if mn[i * 3 + k] < bmin[k]: bmin[k] = mn[i * 3 + k]
                if mx[i * 3 + k] > bmax[k]: bmax[k] = mx[i * 3 + k]
        o = node * NODE_WORDS
        if cnt == 0:
            for k in range(3):
                nf[o + k] = 0.0
                nf[o + 4 + k] = 0.0
            nu[o + 3] = 0
            nu[o + 7] = 0
            continue
        for k in range(3):
            nf[o + k] = f32_down(bmin[k])
            nf[o + 4 + k] = f32_up(bmax[k])
        if cnt <= max_leaf:
            nu[o + 3] = s
            nu[o + 7] = cnt
            continue
        cmin, cmax = [INF] * 3, [-INF] * 3
        for j in range(s, e):
            i = order[j]
            for k in range(3):
                c = cen(i, k)
                if c < cmin[k]: cmin[k] = c
                if c > cmax[k]: cmax[k] = c
        best_cost, best_axis, best_split = INF, -1, -1
        for ax in range(3):
            ext = cmax[ax] - cmin[ax]
            if not ext > 0:
                continue
            bc = [0] * BINS
            bl = [INF] * (BINS * 3)
            bh = [-INF] * (BINS * 3)
            scale = BINS / ext
            for j in range(s, e):
                i = order[j]
                b = math.floor((cen(i, ax) - cmin[ax]) * scale)
                if b >= BINS: b = BINS - 1
                if b < 0: b = 0
                bc[b] += 1
                for k in range(3):
                    if mn[i * 3 + k] < bl[b * 3 + k]: bl[b * 3 + k] = mn[i * 3 + k]
                    if mx[i * 3 + k] > bh[b * 3 + k]: bh[b * 3 + k] = mx[i * 3 + k]
            lA, lC = [0.0] * (BINS - 1), [0] * (BINS - 1)
            c0 = 0
            lo, hi = [INF] * 3, [-INF] * 3
            for b in range(BINS - 1):
                c0 += bc[b]
                if bc[b]:
                    for k in range(3):
                        lo[k] = min(lo[k], bl[b * 3 + k])
                        hi[k] = max(hi[k], bh[b * 3 + k])
                lC[b] = c0
                dx, dy, dz = hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]
                lA[b] = (dx * dy + dy * dz + dz * dx) if c0 else 0
            c1 = 0
            lo2, hi2 = [INF] * 3, [-INF] * 3
            for b in range(BINS - 1, 0, -1):
                c1 += bc[b]
                if bc[b]:
                    for k in range(3):
                        lo2[k] = min(lo2[k], bl[b * 3 + k])
                        hi2[k] = max(hi2[k], bh[b * 3 + k])
                sp = b - 1
                if lC[sp] == 0 or c1 == 0:
                    continue
                dx, dy, dz = hi2[0] - lo2[0], hi2[1] - lo2[1], hi2[2] - lo2[2]
                cost = lC[sp] * lA[sp] + c1 * (dx * dy + dy * dz + dz * dx)
                if cost < best_cost or (cost == best_cost and ax == best_axis and sp < best_split):
                    best_cost, best_axis, best_split = cost, ax, sp
        if best_axis < 0:
            mid = s + (cnt >> 1)
        else:
            ext = cmax[best_axis] - cmin[best_axis]
            scale = BINS / ext
            left, right = [], []
            for j in range(s, e):
                i = order[j]
                b = math.floor((cen(i, best_axis) - cmin[best_axis]) * scale)
                if b >= BINS: b = BINS - 1
                if b < 0: b = 0
                (left if b <= best_split else right).append(i)
            order[s:e] = left + right
            mid = s + len(left)
        lft = used
        used += 2
        nu[o + 3] = lft
        nu[o + 7] = 0
        stack.append((lft + 1, mid, e))
        stack.append((lft, s, mid))
    return _finish(kind, src, n, order, nf, nu, used)


def _finish(kind, src, n, order, nf, nu, used):
    st = 9 if kind == KIND_TRI else 6
    prims = [0.0] * (n * st)
    for j in range(n):
        for q in range(st):
            prims[j * st + q] = src[order[j] * st + q]
    return Bvh(kind, n, st, used, nf[:used * NODE_WORDS], nu[:used * NODE_WORDS], order, prims, src)


def build_triangles(tris, max_leaf_size=4): return _build(KIND_TRI, tris, max_leaf_size)
def build_aabbs(boxes, max_leaf_size=4): return _build(KIND_AABB, boxes, max_leaf_size)


def refit(bvh: Bvh, inp):
    st, n = bvh.stride, bvh.count
    if len(inp) < n * st:
        raise ValueError("bvh.refit: expected %d numbers" % (n * st))
    for i in range(n * st):
        bvh.src[i] = float(inp[i])
    for j in range(n):
        for q in range(st):
            bvh.prims[j * st + q] = bvh.src[bvh.order[j] * st + q]
    nf, nu, P = bvh.nf, bvh.nu, bvh.prims
    for node in range(bvh.node_count - 1, -1, -1):
        o = node * NODE_WORDS
        cnt = nu[o + 7]
        lo, hi = [INF] * 3, [-INF] * 3
        if cnt > 0:
            for j in range(nu[o + 3], nu[o + 3] + cnt):
                for k in range(3):
                    if bvh.kind == KIND_TRI:
                        x, y, z = P[j * 9 + k], P[j * 9 + 3 + k], P[j * 9 + 6 + k]
                        a, b = min(x, y, z), max(x, y, z)
                    else:
                        a, b = P[j * 6 + k], P[j * 6 + 3 + k]
                    if a < lo[k]: lo[k] = a
                    if b > hi[k]: hi[k] = b
        elif nu[o + 3] != 0:
            l = nu[o + 3] * NODE_WORDS
            r = l + NODE_WORDS
            for k in range(3):
                lo[k] = min(nf[l + k], nf[r + k])
                hi[k] = max(nf[l + 4 + k], nf[r + 4 + k])
        else:
            continue
        for k in range(3):
            nf[o + k] = f32_down(lo[k])
            nf[o + 4 + k] = f32_up(hi[k])
    return bvh


# ---- serialization -----------------------------------------------------------------------------------------------
def serialize(bvh: Bvh) -> bytes:
    st, nw, n = bvh.stride, bvh.node_count * NODE_WORDS, bvh.count
    nodes_off = HEADER_WORDS
    order_off = nodes_off + nw
    prims_off = order_off + n
    total = prims_off + n * st
    u = [0] * total
    u[0], u[1], u[2], u[3], u[4], u[5], u[6], u[7], u[8] = MAGIC, VERSION, bvh.kind, bvh.node_count, n, nodes_off, order_off, prims_off, st
    for i in range(bvh.node_count):
        o = i * NODE_WORDS
        for k in (0, 1, 2, 4, 5, 6):
            u[nodes_off + o + k] = _bits(bvh.nf[o + k])
        u[nodes_off + o + 3] = bvh.nu[o + 3]
        u[nodes_off + o + 7] = bvh.nu[o + 7]
    for j in range(n):
        u[order_off + j] = bvh.order[j]
    for i in range(n * st):
        u[prims_off + i] = _bits(bvh.prims[i])
    return struct.pack("<%dI" % total, *u)


def deserialize(buf: bytes) -> Bvh:
    u = struct.unpack("<%dI" % (len(buf) // 4), buf[:len(buf) // 4 * 4])
    if u[0] != MAGIC:
        raise ValueError("bvh: bad magic")
    if u[1] != VERSION:
        raise ValueError("bvh: unsupported version %d" % u[1])
    kind, node_count, n, nodes_off, order_off, prims_off = u[2], u[3], u[4], u[5], u[6], u[7]
    st = 9 if kind == KIND_TRI else 6
    if u[8] != st or len(buf) < (prims_off + n * st) * 4:
        raise ValueError("bvh: corrupt buffer")
    nf, nu = [0.0] * (node_count * NODE_WORDS), [0] * (node_count * NODE_WORDS)
    for i in range(node_count):
        for k in range(NODE_WORDS):
            w = u[nodes_off + i * NODE_WORDS + k]
            if k in (3, 7):
                nu[i * NODE_WORDS + k] = w
            else:
                nf[i * NODE_WORDS + k] = _from_bits(w)
    order = list(u[order_off:order_off + n])
    prims = [_from_bits(u[prims_off + i]) for i in range(n * st)]
    src = [0.0] * (n * st)
    for j in range(n):
        for q in range(st):
            src[order[j] * st + q] = prims[j * st + q]
    return Bvh(kind, n, st, node_count, nf, nu, order, prims, src)


# ---- queries -----------------------------------------------------------------------------------------------------
def _slab(nf, o, ox, oy, oz, ix, iy, iz, tmax):
    tn, tf = 0, INF
    for (oo, i, lo, hi) in ((ox, ix, nf[o], nf[o + 4]), (oy, iy, nf[o + 1], nf[o + 5]), (oz, iz, nf[o + 2], nf[o + 6])):
        if i == 0:
            if oo < lo or oo > hi:
                return -1
        else:
            t1, t2 = (lo - oo) * i, (hi - oo) * i
            l, h = (t1, t2) if t1 < t2 else (t2, t1)
            if l > tn: tn = l
            if h < tf: tf = h
    tf = tf * (1 + 1e-6) + 1e-30
    return tn if (tn <= tf and tn <= tmax) else -1


def _inv(d): return 0 if d == 0 else 1 / d


def _prim_ray(bvh, j, ox, oy, oz, dx, dy, dz, tmax, cull, out):
    if bvh.kind == KIND_TRI:
        return C3.ray_triangle_flat(ox, oy, oz, dx, dy, dz, bvh.prims, j * 9, 0, tmax, cull, out)
    P, q = bvh.prims, j * 6
    O, D = (ox, oy, oz), (dx, dy, dz)
    tn, tf = 0, tmax
    for i in range(3):
        if D[i] == 0:
            if O[i] < P[q + i] or O[i] > P[q + 3 + i]:
                return -1
            continue
        t1, t2 = (P[q + i] - O[i]) / D[i], (P[q + 3 + i] - O[i]) / D[i]
        if t1 > t2:
            t1, t2 = t2, t1
        if t1 > tn: tn = t1
        if t2 < tf: tf = t2
    return tn if tn <= tf else -1


def raycast(bvh: Bvh, o, d, any_hit=False, cull_back=False, tmax=INF):
    """Closest hit ``{t, index, u, v, front, point}`` or None; equal-t ties go to the lowest original index."""
    cull = bool(cull_back)
    if bvh.count == 0:
        return None
    nf, nu = bvh.nf, bvh.nu
    ix, iy, iz = _inv(d[0]), _inv(d[1]), _inv(d[2])
    best = None
    tmp = [0, 0, 0]
    if _slab(nf, 0, o[0], o[1], o[2], ix, iy, iz, tmax) < 0:
        return None
    stack = [0]
    while stack:
        node = stack.pop()
        w = node * NODE_WORDS
        cnt = nu[w + 7]
        if cnt > 0:
            for j in range(nu[w + 3], nu[w + 3] + cnt):
                t = _prim_ray(bvh, j, o[0], o[1], o[2], d[0], d[1], d[2], tmax, cull, tmp)
                if t < 0:
                    continue
                idx = bvh.order[j]
                if best is None or t < best["t"] or (t == best["t"] and idx < best["index"]):
                    best = {"t": t, "index": idx, "u": tmp[0], "v": tmp[1], "front": tmp[2] > 0}
                    tmax = t
                    if any_hit:
                        best["point"] = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t]
                        return best
        else:
            l = nu[w + 3]
            r = l + 1
            tl = _slab(nf, l * NODE_WORDS, o[0], o[1], o[2], ix, iy, iz, tmax)
            tr = _slab(nf, r * NODE_WORDS, o[0], o[1], o[2], ix, iy, iz, tmax)
            if tl >= 0 and tr >= 0:
                if tr < tl:
                    stack.append(l)
                    stack.append(r)
                else:
                    stack.append(r)
                    stack.append(l)
            elif tl >= 0:
                stack.append(l)
            elif tr >= 0:
                stack.append(r)
    if best:
        best["point"] = [o[0] + d[0] * best["t"], o[1] + d[1] * best["t"], o[2] + d[2] * best["t"]]
    return best


def ray_any(bvh, o, d, cull_back=False, tmax=INF):
    return raycast(bvh, o, d, any_hit=True, cull_back=cull_back, tmax=tmax) is not None


def _walk(bvh, node_test, prim_test):
    out: List[int] = []
    if bvh.count == 0:
        return out
    nf, nu = bvh.nf, bvh.nu
    stack = [0]
    while stack:
        node = stack.pop()
        w = node * NODE_WORDS
        if not node_test(nf, w):
            continue
        cnt = nu[w + 7]
        if cnt > 0:
            for j in range(nu[w + 3], nu[w + 3] + cnt):
                if prim_test(j):
                    out.append(bvh.order[j])
        else:
            stack.append(nu[w + 3] + 1)
            stack.append(nu[w + 3])
    out.sort()
    return out


def _prim_box(bvh, j):
    P = bvh.prims
    if bvh.kind == KIND_AABB:
        return [P[j * 6], P[j * 6 + 1], P[j * 6 + 2], P[j * 6 + 3], P[j * 6 + 4], P[j * 6 + 5]]
    q = j * 9
    return [min(P[q + k], P[q + 3 + k], P[q + 6 + k]) for k in range(3)] + [max(P[q + k], P[q + 3 + k], P[q + 6 + k]) for k in range(3)]


def query_aabb(bvh, box):
    """Ascending original indices of prims overlapping the box (inclusive). Triangles: exact SAT."""
    lo, hi = box["min"], box["max"]

    def node_test(nf, w):
        return nf[w] <= hi[0] and nf[w + 4] >= lo[0] and nf[w + 1] <= hi[1] and nf[w + 5] >= lo[1] and nf[w + 2] <= hi[2] and nf[w + 6] >= lo[2]

    def prim_test(j):
        if bvh.kind == KIND_AABB:
            b = _prim_box(bvh, j)
            return b[0] <= hi[0] and b[3] >= lo[0] and b[1] <= hi[1] and b[4] >= lo[1] and b[2] <= hi[2] and b[5] >= lo[2]
        q, P = j * 9, bvh.prims
        return C3.aabb_triangle_overlap(box, [[P[q], P[q + 1], P[q + 2]], [P[q + 3], P[q + 4], P[q + 5]], [P[q + 6], P[q + 7], P[q + 8]]])

    return _walk(bvh, node_test, prim_test)


def query_sphere(bvh, c, r):
    """Prims within distance ``r`` (inclusive) of centre ``c``."""
    r2 = r * r

    def d2box(lo0, lo1, lo2, hi0, hi1, hi2):
        x, y, z = max(lo0 - c[0], 0, c[0] - hi0), max(lo1 - c[1], 0, c[1] - hi1), max(lo2 - c[2], 0, c[2] - hi2)
        return x * x + y * y + z * z

    def node_test(nf, w):
        return d2box(nf[w], nf[w + 1], nf[w + 2], nf[w + 4], nf[w + 5], nf[w + 6]) <= r2

    def prim_test(j):
        if bvh.kind == KIND_AABB:
            b = _prim_box(bvh, j)
            return d2box(b[0], b[1], b[2], b[3], b[4], b[5]) <= r2
        q, P = j * 9, bvh.prims
        p = C3.closest_point_triangle(c, [P[q], P[q + 1], P[q + 2]], [P[q + 3], P[q + 4], P[q + 5]], [P[q + 6], P[q + 7], P[q + 8]])
        x, y, z = p[0] - c[0], p[1] - c[1], p[2] - c[2]
        return x * x + y * y + z * z <= r2

    return _walk(bvh, node_test, prim_test)


def _query_bounds(bvh, lo, hi):
    def node_test(nf, w):
        return nf[w] <= hi[0] and nf[w + 4] >= lo[0] and nf[w + 1] <= hi[1] and nf[w + 5] >= lo[1] and nf[w + 2] <= hi[2] and nf[w + 6] >= lo[2]

    def prim_test(j):
        b = _prim_box(bvh, j)
        return b[0] <= hi[0] and b[3] >= lo[0] and b[1] <= hi[1] and b[4] >= lo[1] and b[2] <= hi[2] and b[5] >= lo[2]

    return _walk(bvh, node_test, prim_test)


def as_world(bvh):
    """World adapter for collision3d sweeps / character controller (triangle BVHs only)."""
    if bvh.kind != KIND_TRI:
        raise ValueError("bvh.asWorld: triangle BVH required")
    return {"tris": bvh.src, "count": bvh.count, "candidates": lambda mn, mx: _query_bounds(bvh, mn, mx)}


def stats(bvh):
    leaves = max_depth = max_leaf = 0
    st = [(0, 1)]
    while st:
        n, d = st.pop()
        max_depth = max(max_depth, d)
        w = n * NODE_WORDS
        c = bvh.nu[w + 7]
        if c > 0:
            leaves += 1
            max_leaf = max(max_leaf, c)
        elif bvh.nu[w + 3]:
            st.append((bvh.nu[w + 3], d + 1))
            st.append((bvh.nu[w + 3] + 1, d + 1))
    return {"nodes": bvh.node_count, "leaves": leaves, "maxDepth": max_depth, "maxLeaf": max_leaf}
