"""collision3d: deterministic 3D collision, Float64 (port of collision3d.js; spec/v3/collision3d.md).

Right-handed, Y UP. Vectors are ``[x, y, z]`` lists. Triangle soups are flat sequences, 9 numbers per triangle (CCW front).
Ray = ``o + t*d``. Contacts are ``{"normal", "depth"}``: translating shape A by ``normal*depth`` separates it from B.
Shapes are plain dicts with the JSON spec keys (``{"c", "r"}``, ``{"min", "max"}``, ``{"a", "b", "r"}``, OBB ``{"c", "h", "axes"}``).
Touching (depth 0) is not a contact. Same operation order as the JS reference.
"""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

sqrt = math.sqrt
INF = float("inf")
EPS = 1e-12
EPS2 = 1e-24
UP = (0, 1, 0)


# ---------------- vec3 ----------------
def sub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def add(a, b): return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
def mul(a, s): return [a[0] * s, a[1] * s, a[2] * s]
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def len2(a): return dot(a, a)
def length(a): return sqrt(dot(a, a))


def norm(a):
    l = length(a)
    return [a[0] / l, a[1] / l, a[2] / l] if l > 0 else [0, 0, 0]


def clamp(x, lo, hi): return lo if x < lo else hi if x > hi else x
def madd(a, b, s): return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
def _up(): return list(UP)


class vec3:
    add = staticmethod(add)
    sub = staticmethod(sub)
    scale = staticmethod(mul)
    dot = staticmethod(dot)
    cross = staticmethod(cross)
    len_sq = staticmethod(len2)
    len = staticmethod(length)
    normalize = staticmethod(norm)
    clamp = staticmethod(clamp)
    madd = staticmethod(madd)
    dist = staticmethod(lambda a, b: length(sub(a, b)))
    lerp = staticmethod(lambda a, b, t: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
    min = staticmethod(lambda a, b: [min(a[0], b[0]), min(a[1], b[1]), min(a[2], b[2])])
    max = staticmethod(lambda a, b: [max(a[0], b[0]), max(a[1], b[1]), max(a[2], b[2])])


# ---------------- primitive constructors ----------------
def aabb(mn, mx): return {"min": list(mn), "max": list(mx)}
def aabb_from_center(c, h): return {"min": [c[0] - h[0], c[1] - h[1], c[2] - h[2]], "max": [c[0] + h[0], c[1] + h[1], c[2] + h[2]]}
def sphere(c, r): return {"c": list(c), "r": r}
def capsule(a, b, r): return {"a": list(a), "b": list(b), "r": r}
def plane(n, d): return {"n": norm(n), "d": d}


def plane_from_points(a, b, c):
    n = norm(cross(sub(b, a), sub(c, a)))
    return {"n": n, "d": dot(n, a)}


def triangle(a, b, c): return [list(a), list(b), list(c)]


def obb(c, h, axes=((1, 0, 0), (0, 1, 0), (0, 0, 1))):
    return {"c": list(c), "h": list(h), "axes": [list(a) for a in axes]}


def obb_from_quat(c, h, q):
    n = math.hypot(q[0], q[1], q[2], q[3]) or 1
    x, y, z, w = q[0] / n, q[1] / n, q[2] / n, q[3] / n
    return obb(c, h, [[1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
                      [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
                      [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]])


def tri_normal(a, b, c): return norm(cross(sub(b, a), sub(c, a)))


def triangle_aabb(a, b, c):
    return {"min": [min(a[0], b[0], c[0]), min(a[1], b[1], c[1]), min(a[2], b[2], c[2])],
            "max": [max(a[0], b[0], c[0]), max(a[1], b[1], c[1]), max(a[2], b[2], c[2])]}


def aabb_overlap(a, b):
    return (a["min"][0] <= b["max"][0] and a["max"][0] >= b["min"][0] and a["min"][1] <= b["max"][1]
            and a["max"][1] >= b["min"][1] and a["min"][2] <= b["max"][2] and a["max"][2] >= b["min"][2])


def aabb_union(a, b): return {"min": vec3.min(a["min"], b["min"]), "max": vec3.max(a["max"], b["max"])}


# ---------------- closest points ----------------
def closest_point_segment(p, a, b):
    ab = sub(b, a)
    l = dot(ab, ab)
    t = clamp(dot(sub(p, a), ab) / l, 0, 1) if l > EPS2 else 0
    return madd(a, ab, t)


def closest_point_aabb(p, box):
    return [clamp(p[0], box["min"][0], box["max"][0]), clamp(p[1], box["min"][1], box["max"][1]), clamp(p[2], box["min"][2], box["max"][2])]


def closest_point_obb(p, o):
    d = sub(p, o["c"])
    out = list(o["c"])
    for i in range(3):
        k = clamp(dot(d, o["axes"][i]), -o["h"][i], o["h"][i])
        out[0] += o["axes"][i][0] * k
        out[1] += o["axes"][i][1] * k
        out[2] += o["axes"][i][2] * k
    return out


def closest_point_plane(p, pl): return madd(p, pl["n"], pl["d"] - dot(pl["n"], p))


def closest_point_sphere(p, s):
    d = sub(p, s["c"])
    l = length(d)
    return madd(s["c"], d, s["r"] / l) if l > 0 else [s["c"][0] + s["r"], s["c"][1], s["c"][2]]


def _finite_inv(x):
    try:
        return math.isfinite(1 / x)
    except (ZeroDivisionError, OverflowError):
        return False


def closest_point_triangle(p, a, b, c):
    """Ericson 5.1.5; zero-area triangles fall back to the three edges."""
    ab, ac, ap = sub(b, a), sub(c, a), sub(p, a)
    d1, d2 = dot(ab, ap), dot(ac, ap)
    if d1 <= 0 and d2 <= 0:
        return list(a)
    bp = sub(p, b)
    d3, d4 = dot(ab, bp), dot(ac, bp)
    if d3 >= 0 and d4 <= d3:
        return list(b)
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0:
        return madd(a, ab, d1 / (d1 - d3))
    cp = sub(p, c)
    d5, d6 = dot(ab, cp), dot(ac, cp)
    if d6 >= 0 and d5 <= d6:
        return list(c)
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0:
        return madd(a, ac, d2 / (d2 - d6))
    va = d3 * d6 - d5 * d4
    if va <= 0 and d4 - d3 >= 0 and d5 - d6 >= 0:
        return madd(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)))
    s = va + vb + vc
    if not (s > 0) or not _finite_inv(s):
        best, bd = None, INF
        for u, v in ((a, b), (b, c), (c, a)):
            q = closest_point_segment(p, u, v)
            dd = len2(sub(p, q))
            if dd < bd:
                bd, best = dd, q
        return best
    denom = 1 / s
    return add(a, add(mul(ab, vb * denom), mul(ac, vc * denom)))


def closest_seg_seg(p1, q1, p2, q2):
    """Ericson 5.1.9. ``{s, t, p1, p2, d2}``."""
    d1, d2, r = sub(q1, p1), sub(q2, p2), sub(p1, p2)
    a, e, f = dot(d1, d1), dot(d2, d2), dot(d2, r)
    if a <= EPS2 and e <= EPS2:
        s = t = 0
    elif a <= EPS2:
        s = 0
        t = clamp(f / e, 0, 1)
    else:
        c = dot(d1, r)
        if e <= EPS2:
            t = 0
            s = clamp(-c / a, 0, 1)
        else:
            b = dot(d1, d2)
            denom = a * e - b * b
            s = clamp((b * f - c * e) / denom, 0, 1) if denom > 0 else 0
            t = (b * s + f) / e
            if t < 0:
                t = 0
                s = clamp(-c / a, 0, 1)
            elif t > 1:
                t = 1
                s = clamp((b - c) / a, 0, 1)
    c1, c2 = madd(p1, d1, s), madd(p2, d2, t)
    return {"s": s, "t": t, "p1": c1, "p2": c2, "d2": len2(sub(c1, c2))}


def _bary_inside(p, a, b, c, eps=EPS):
    v0, v1, v2 = sub(c, a), sub(b, a), sub(p, a)
    d00, d01, d11, d20, d21 = dot(v0, v0), dot(v0, v1), dot(v1, v1), dot(v2, v0), dot(v2, v1)
    den = d00 * d11 - d01 * d01
    if not den > 0:
        return False
    u = (d11 * d20 - d01 * d21) / den
    v = (d00 * d21 - d01 * d20) / den
    return u >= -eps and v >= -eps and u + v <= 1 + eps


def closest_seg_tri(p, q, a, b, c):
    """Closest points between segment [p,q] and triangle: ``{d2, ps, pt, crossing, da?, db?}``."""
    n = cross(sub(b, a), sub(c, a))
    if len2(n) > 0:
        da, db = dot(sub(p, a), n), dot(sub(q, a), n)
        if (da < 0 and db > 0) or (da > 0 and db < 0):
            x = madd(p, sub(q, p), da / (da - db))
            if _bary_inside(x, a, b, c):
                nl = length(n)
                return {"d2": 0, "ps": x, "pt": x, "crossing": True, "da": da / nl, "db": db / nl}
    best: Optional[dict] = None

    def take(ps, pt):
        nonlocal best
        d2 = len2(sub(ps, pt))
        if best is None or d2 < best["d2"]:
            best = {"d2": d2, "ps": ps, "pt": pt, "crossing": False}

    take(p, closest_point_triangle(p, a, b, c))
    take(q, closest_point_triangle(q, a, b, c))
    for u, v in ((a, b), (b, c), (c, a)):
        r = closest_seg_seg(p, q, u, v)
        take(r["p1"], r["p2"])
    return best


# ---------------- overlap + contact ----------------
def sphere_sphere(A, B):
    d = sub(A["c"], B["c"])
    l2 = len2(d)
    R = A["r"] + B["r"]
    if not l2 < R * R:
        return None
    l = sqrt(l2)
    return {"normal": mul(d, 1 / l), "depth": R - l} if l > EPS else {"normal": _up(), "depth": R}


def sphere_plane(s, pl):
    dist = dot(pl["n"], s["c"]) - pl["d"]
    return {"normal": list(pl["n"]), "depth": s["r"] - dist} if dist < s["r"] else None


def capsule_plane(cp, pl):
    da, db = dot(pl["n"], cp["a"]) - pl["d"], dot(pl["n"], cp["b"]) - pl["d"]
    m = min(da, db)
    return {"normal": list(pl["n"]), "depth": cp["r"] - m} if m < cp["r"] else None


def aabb_plane(box, pl):
    c, h = mul(add(box["min"], box["max"]), 0.5), mul(sub(box["max"], box["min"]), 0.5)
    n = pl["n"]
    rad = h[0] * abs(n[0]) + h[1] * abs(n[1]) + h[2] * abs(n[2])
    dist = dot(n, c) - pl["d"]
    return {"normal": list(n), "depth": rad - dist} if dist < rad else None


def _sphere_box_local(c, r, h):
    q = [clamp(c[0], -h[0], h[0]), clamp(c[1], -h[1], h[1]), clamp(c[2], -h[2], h[2])]
    d = sub(c, q)
    l2 = len2(d)
    if l2 > 0:
        if l2 >= r * r:
            return None
        l = sqrt(l2)
        return mul(d, 1 / l), r - l
    ax, best = 0, h[0] - abs(c[0])
    for i in range(1, 3):
        g = h[i] - abs(c[i])
        if g < best:
            best, ax = g, i
    n = [0, 0, 0]
    n[ax] = 1 if c[ax] >= 0 else -1
    return n, r + best


def sphere_aabb(s, box):
    ctr, h = mul(add(box["min"], box["max"]), 0.5), mul(sub(box["max"], box["min"]), 0.5)
    r = _sphere_box_local(sub(s["c"], ctr), s["r"], h)
    return {"normal": r[0], "depth": r[1]} if r else None


def sphere_obb(s, o):
    d = sub(s["c"], o["c"])
    lc = [dot(d, o["axes"][0]), dot(d, o["axes"][1]), dot(d, o["axes"][2])]
    r = _sphere_box_local(lc, s["r"], o["h"])
    if not r:
        return None
    n = r[0]
    return {"normal": add(add(mul(o["axes"][0], n[0]), mul(o["axes"][1], n[1])), mul(o["axes"][2], n[2])), "depth": r[1]}


def aabb_aabb(A, B):
    depth, ax, sgn = INF, -1, 1
    for i in range(3):
        o = min(A["max"][i], B["max"][i]) - max(A["min"][i], B["min"][i])
        if not o > 0:
            return None
        if o < depth:
            depth, ax = o, i
            sgn = 1 if (A["min"][i] + A["max"][i]) >= (B["min"][i] + B["max"][i]) else -1
    n = [0, 0, 0]
    n[ax] = sgn
    return {"normal": n, "depth": depth}


def obb_obb(A, B):
    """15-axis SAT. Normal points from B to A."""
    t = sub(B["c"], A["c"])
    state = {"depth": INF, "best": None}

    def test(ax):
        l2 = len2(ax)
        if l2 < 1e-18:
            return True
        l = sqrt(l2)
        u = [ax[0] / l, ax[1] / l, ax[2] / l]
        rA = A["h"][0] * abs(dot(u, A["axes"][0])) + A["h"][1] * abs(dot(u, A["axes"][1])) + A["h"][2] * abs(dot(u, A["axes"][2]))
        rB = B["h"][0] * abs(dot(u, B["axes"][0])) + B["h"][1] * abs(dot(u, B["axes"][1])) + B["h"][2] * abs(dot(u, B["axes"][2]))
        dist = dot(t, u)
        o = rA + rB - abs(dist)
        if not o > 0:
            return False
        if o < state["depth"]:
            state["depth"] = o
            state["best"] = mul(u, -1) if dist > 0 else u
        return True

    for i in range(3):
        if not test(A["axes"][i]):
            return None
    for i in range(3):
        if not test(B["axes"][i]):
            return None
    for i in range(3):
        for j in range(3):
            if not test(cross(A["axes"][i], B["axes"][j])):
                return None
    return {"normal": state["best"], "depth": state["depth"]}


def sphere_capsule(s, cp):
    q = closest_point_segment(s["c"], cp["a"], cp["b"])
    d = sub(s["c"], q)
    l2 = len2(d)
    R = s["r"] + cp["r"]
    if not l2 < R * R:
        return None
    l = sqrt(l2)
    if l > EPS:
        return {"normal": mul(d, 1 / l), "depth": R - l}
    ax = norm(sub(cp["b"], cp["a"]))
    n = norm(cross(ax, _up() if abs(ax[1]) < 0.9 else [1, 0, 0])) if len2(ax) > 0 else _up()
    return {"normal": n, "depth": R}


def capsule_capsule(A, B):
    """Normal points from B to A; intersecting axes fall back to a direction perpendicular to both."""
    r = closest_seg_seg(A["a"], A["b"], B["a"], B["b"])
    R = A["r"] + B["r"]
    if not r["d2"] < R * R:
        return None
    l = sqrt(r["d2"])
    if l > EPS:
        return {"normal": mul(sub(r["p1"], r["p2"]), 1 / l), "depth": R - l}
    n = cross(sub(A["b"], A["a"]), sub(B["b"], B["a"]))
    if len2(n) < EPS2:
        ax = sub(A["b"], A["a"])
        n = cross(ax, _up() if abs(ax[1]) < 0.9 * length(ax) else [1, 0, 0]) if len2(ax) > EPS2 else _up()
    return {"normal": norm(n), "depth": R}


def sphere_triangle(s, tri):
    a, b, c = tri
    q = closest_point_triangle(s["c"], a, b, c)
    d = sub(s["c"], q)
    l2 = len2(d)
    if not l2 < s["r"] * s["r"]:
        return None
    l = sqrt(l2)
    if l > EPS:
        return {"normal": mul(d, 1 / l), "depth": s["r"] - l}
    n = tri_normal(a, b, c)
    return {"normal": n if len2(n) > 0 else _up(), "depth": s["r"]}


def _cap_tri_contact(pa, pb, r, a, b, c):
    res = closest_seg_tri(pa, pb, a, b, c)
    if res["crossing"]:
        n = tri_normal(a, b, c)
        s = (1 if res["da"] >= 0 else -1) if abs(res["da"]) >= abs(res["db"]) else (1 if res["db"] >= 0 else -1)
        return {"normal": mul(n, s), "depth": r + min(abs(res["da"]), abs(res["db"])), "crossing": True, "ps": res["ps"], "pt": res["pt"]}
    if not res["d2"] < r * r:
        return None
    l = sqrt(res["d2"])
    if l > EPS:
        return {"normal": mul(sub(res["ps"], res["pt"]), 1 / l), "depth": r - l, "ps": res["ps"], "pt": res["pt"]}
    n = tri_normal(a, b, c)
    return {"normal": n if len2(n) > 0 else _up(), "depth": r, "ps": res["ps"], "pt": res["pt"]}


def capsule_triangle(cp, tri):
    r = _cap_tri_contact(cp["a"], cp["b"], cp["r"], tri[0], tri[1], tri[2])
    return {"normal": r["normal"], "depth": r["depth"]} if r else None


def _box_tri_sat(bc, h, tri):
    """Box (centre bc, half h) vs triangle SAT (13 axes): ``(depth, normal)``; depth < 0 when separated."""
    v = [sub(tri[0], bc), sub(tri[1], bc), sub(tri[2], bc)]
    e = [sub(v[1], v[0]), sub(v[2], v[1]), sub(v[0], v[2])]
    axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1], cross(e[0], e[1])]
    for i in range(3):
        u = [0, 0, 0]
        u[i] = 1
        for j in range(3):
            axes.append(cross(u, e[j]))
    depth, best = INF, None
    for ax in axes:
        l2 = len2(ax)
        if l2 < 1e-18:
            continue
        l = sqrt(l2)
        u = [ax[0] / l, ax[1] / l, ax[2] / l]
        rad = h[0] * abs(u[0]) + h[1] * abs(u[1]) + h[2] * abs(u[2])
        p0, p1, p2 = dot(v[0], u), dot(v[1], u), dot(v[2], u)
        tmin, tmax = min(p0, p1, p2), max(p0, p1, p2)
        if tmin > rad or tmax < -rad:
            return -1, None
        lo, hi = rad - tmin, tmax + rad
        o = min(lo, hi)
        if o < depth:
            depth = o
            best = mul(u, -1) if lo < hi else u
    return depth, best


def aabb_triangle(box, tri):
    d, n = _box_tri_sat(mul(add(box["min"], box["max"]), 0.5), mul(sub(box["max"], box["min"]), 0.5), tri)
    return {"normal": n, "depth": d} if d > 0 else None


def aabb_triangle_overlap(box, tri):
    return _box_tri_sat(mul(add(box["min"], box["max"]), 0.5), mul(sub(box["max"], box["min"]), 0.5), tri)[0] >= 0


# ---------------- rays ----------------
def _hit_at(o, d, t, n): return {"t": t, "point": madd(o, d, t), "normal": n}


def _inside_normal(d):
    n = norm(d)
    return [-n[0], -n[1], -n[2]]


def ray_plane(o, d, pl, tmax=INF):
    den = dot(pl["n"], d)
    if abs(den) < 1e-300:
        return None
    t = (pl["d"] - dot(pl["n"], o)) / den
    if t < 0 or t > tmax:
        return None
    return _hit_at(o, d, t, list(pl["n"]) if den < 0 else mul(pl["n"], -1))


def ray_sphere(o, d, s, tmax=INF):
    m = sub(o, s["c"])
    a = dot(d, d)
    cc = dot(m, m) - s["r"] * s["r"]
    if cc <= 0:
        return _hit_at(o, d, 0, _inside_normal(d))
    if not a > 0:
        return None
    b = dot(m, d)
    if b >= 0:
        return None
    disc = b * b - a * cc
    if disc < 0:
        return None
    t = (-b - sqrt(disc)) / a
    if t > tmax:
        return None
    p = madd(o, d, t)
    return {"t": t, "point": p, "normal": mul(sub(p, s["c"]), 1 / s["r"])}


def ray_box_t(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, tmin, tmax, out=None):
    """Slab test: entry t (clamped to tmin) or -1; ``out[0]`` = entry axis (-1 if inside), ``out[1]`` = normal sign."""
    tn, tf, ax, sg = -INF, INF, -1, 0
    O, D, lo, hi = (ox, oy, oz), (dx, dy, dz), (x0, y0, z0), (x1, y1, z1)
    for i in range(3):
        d = D[i]
        if d == 0:
            if O[i] < lo[i] or O[i] > hi[i]:
                return -1
            continue
        inv = 1 / d
        t1, t2 = (lo[i] - O[i]) * inv, (hi[i] - O[i]) * inv
        if t1 > t2:
            t1, t2 = t2, t1
        if t1 > tn:
            tn, ax, sg = t1, i, (-1 if d > 0 else 1)
        if t2 < tf:
            tf = t2
    if tn > tf or tf < tmin:
        return -1
    t = tn
    if tn < tmin:
        t, ax = tmin, -1
    if t > tmax:
        return -1
    if out is not None:
        out[0], out[1] = ax, sg
    return t


def ray_aabb(o, d, box, tmax=INF):
    out = [0, 0]
    t = ray_box_t(o[0], o[1], o[2], d[0], d[1], d[2], box["min"][0], box["min"][1], box["min"][2], box["max"][0], box["max"][1], box["max"][2], 0, tmax, out)
    if t < 0:
        return None
    if out[0] < 0:
        return _hit_at(o, d, t, _inside_normal(d))
    n = [0, 0, 0]
    n[out[0]] = out[1]
    return _hit_at(o, d, t, n)


def ray_obb(o, d, ob, tmax=INF):
    lo = sub(o, ob["c"])
    ax, h = ob["axes"], ob["h"]
    O = [dot(lo, ax[0]), dot(lo, ax[1]), dot(lo, ax[2])]
    D = [dot(d, ax[0]), dot(d, ax[1]), dot(d, ax[2])]
    out = [0, 0]
    t = ray_box_t(O[0], O[1], O[2], D[0], D[1], D[2], -h[0], -h[1], -h[2], h[0], h[1], h[2], 0, tmax, out)
    if t < 0:
        return None
    if out[0] < 0:
        return _hit_at(o, d, t, _inside_normal(d))
    return _hit_at(o, d, t, mul(ax[out[0]], out[1]))


def _ray_cap_t(o, d, a, b, r, tmax):
    ab = sub(b, a)
    dd = dot(ab, ab)
    q = closest_point_segment(o, a, b)
    if len2(sub(o, q)) <= r * r:
        return 0
    a0 = dot(d, d)
    if not a0 > 0:
        return -1
    best = INF

    def sph(c):
        nonlocal best
        m = sub(o, c)
        b1, c1 = dot(m, d), dot(m, m) - r * r
        if b1 >= 0:
            return
        disc = b1 * b1 - a0 * c1
        if disc < 0:
            return
        t = (-b1 - sqrt(disc)) / a0
        if t >= 0 and t < best:
            best = t

    sph(a)
    sph(b)
    if dd > EPS2:
        m = sub(o, a)
        md, nd = dot(m, ab), dot(d, ab)
        A = dd * a0 - nd * nd
        B = dd * dot(m, d) - nd * md
        Cc = dd * (dot(m, m) - r * r) - md * md
        if A > 1e-18 * dd * a0:
            disc = B * B - A * Cc
            if disc >= 0:
                t = (-B - sqrt(disc)) / A
                s = md + t * nd
                if t >= 0 and s >= 0 and s <= dd and t < best:
                    best = t
    return best if (best <= tmax and best != INF) else -1


def ray_capsule(o, d, cp, tmax=INF):
    t = _ray_cap_t(o, d, cp["a"], cp["b"], cp["r"], tmax)
    if t < 0:
        return None
    if t == 0:
        return _hit_at(o, d, 0, _inside_normal(d))
    p = madd(o, d, t)
    q = closest_point_segment(p, cp["a"], cp["b"])
    return {"t": t, "point": p, "normal": mul(sub(p, q), 1 / cp["r"])}


def ray_triangle_flat(ox, oy, oz, dx, dy, dz, T, off, tmin, tmax, cull, out=None):
    """Moller-Trumbore on a flat soup (9 per triangle at offset ``off``): t or -1; ``out`` = [u, v, det sign]."""
    ax, ay, az = T[off], T[off + 1], T[off + 2]
    e1x, e1y, e1z = T[off + 3] - ax, T[off + 4] - ay, T[off + 5] - az
    e2x, e2y, e2z = T[off + 6] - ax, T[off + 7] - ay, T[off + 8] - az
    px, py, pz = dy * e2z - dz * e2y, dz * e2x - dx * e2z, dx * e2y - dy * e2x
    det = e1x * px + e1y * py + e1z * pz
    nx, ny, nz = e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x
    nl, dl = sqrt(nx * nx + ny * ny + nz * nz), sqrt(dx * dx + dy * dy + dz * dz)
    if nl == 0 or abs(det) <= 1e-14 * nl * dl:
        return -1
    if cull and det < 0:
        return -1
    inv = 1 / det
    tx, ty, tz = ox - ax, oy - ay, oz - az
    u = (tx * px + ty * py + tz * pz) * inv
    if u < -EPS or u > 1 + EPS:
        return -1
    qx, qy, qz = ty * e1z - tz * e1y, tz * e1x - tx * e1z, tx * e1y - ty * e1x
    v = (dx * qx + dy * qy + dz * qz) * inv
    if v < -EPS or u + v > 1 + EPS:
        return -1
    t = (e2x * qx + e2y * qy + e2z * qz) * inv
    if t < tmin or t > tmax:
        return -1
    if out is not None:
        out[0], out[1], out[2] = u, v, (1 if det > 0 else -1)
    return t


def ray_triangle(o, d, tri, tmin=0, tmax=INF, cull_back=False):
    T = [*tri[0], *tri[1], *tri[2]]
    out = [0, 0, 0]
    t = ray_triangle_flat(o[0], o[1], o[2], d[0], d[1], d[2], T, 0, tmin, tmax, bool(cull_back), out)
    if t < 0:
        return None
    n = tri_normal(tri[0], tri[1], tri[2])
    return {"t": t, "u": out[0], "v": out[1], "point": madd(o, d, t), "normal": n if out[2] > 0 else mul(n, -1), "front": out[2] > 0}


# ---------------- sweeps ----------------
def norm_world(w):
    """Flat soup (sequence) or ``{tris, count?, candidates?}`` -> ``{tris, count, candidates}``."""
    if isinstance(w, dict):
        tris = w["tris"]
        return {"tris": tris, "count": w["count"] if w.get("count") is not None else len(tris) // 9, "candidates": w.get("candidates")}
    return {"tris": w, "count": len(w) // 9, "candidates": None}


def _tri_at(T, o): return [[T[o], T[o + 1], T[o + 2]], [T[o + 3], T[o + 4], T[o + 5]], [T[o + 6], T[o + 7], T[o + 8]]]


def _orient(A, B, C, nrm):
    f = tri_normal(A, B, C)
    return (f if dot(f, nrm) >= 0 else mul(f, -1)) if len2(f) > 0 else nrm


def _sweep_sphere_tri(c, r, d, A, B, C):
    q0 = closest_point_triangle(c, A, B, C)
    dv = sub(c, q0)
    dd = len2(dv)
    n = tri_normal(A, B, C)
    if dd < r * r:
        dist = sqrt(dd)
        nrm = mul(dv, 1 / dist) if dist > EPS else (n if len2(n) > 0 else _up())
        if dist <= EPS and dot(nrm, d) > 0:
            nrm = mul(nrm, -1)
        if dot(d, nrm) >= 0:
            return None
        return {"t": 0, "normal": nrm, "face": _orient(A, B, C, nrm), "point": q0, "depth": r - dist, "penetrating": True}
    best = INF
    if len2(n) > 0:
        sd = dot(sub(c, A), n)
        s = 1 if sd >= 0 else -1
        dn = dot(d, n) * s
        if dn < 0:
            t = (r - s * sd) / dn
            if t >= 0 and t <= 1 and _bary_inside(madd(madd(c, d, t), n, -s * r), A, B, C):
                best = t
    for u, v in ((A, B), (B, C), (C, A)):
        t = _ray_cap_t(c, d, u, v, r, 1)
        if t >= 0 and t < best:
            best = t
    if not best <= 1:
        return None
    hc = madd(c, d, best)
    q = closest_point_triangle(hc, A, B, C)
    dr = sub(hc, q)
    l = length(dr)
    normal = mul(dr, 1 / l) if l > EPS else (mul(n, 1 if dot(n, d) < 0 else -1) if len2(n) > 0 else _up())
    return {"t": best, "normal": normal, "face": _orient(A, B, C, normal), "point": q, "depth": 0, "penetrating": False}


def _sweep_capsule_tri(pa, pb, r, d, A, B, C):
    dl2 = len2(d)
    t = 0
    for it in range(48):
        sa, sb = madd(pa, d, t), madd(pb, d, t)
        res = closest_seg_tri(sa, sb, A, B, C)
        if it == 0 and (res["crossing"] or res["d2"] < r * r):
            k = _cap_tri_contact(sa, sb, r, A, B, C)
            if not k:
                return None
            if dot(d, k["normal"]) >= 0:
                return None
            return {"t": 0, "normal": k["normal"], "face": _orient(A, B, C, k["normal"]), "point": k["pt"], "depth": k["depth"], "penetrating": True}
        if res["crossing"]:
            fn = tri_normal(A, B, C)
            nn = fn if dot(fn, d) < 0 else mul(fn, -1)
            return {"t": t, "normal": nn, "face": nn, "point": res["pt"], "depth": 0, "penetrating": False}
        dist = sqrt(res["d2"])
        gap = dist - r
        u = mul(sub(res["ps"], res["pt"]), 1 / dist) if dist > EPS else _up()
        closing = -dot(d, u)
        if not closing > 1e-12 or not dl2 > 0:
            return None
        if gap <= 1e-9:
            return {"t": t, "normal": u, "face": _orient(A, B, C, u), "point": res["pt"], "depth": 0, "penetrating": False}
        t += gap / closing
        if t > 1:
            return None
    return None


def _sweep_all(w, bmin, bmax, fn):
    lst = w["candidates"](bmin, bmax) if w["candidates"] else None
    n = len(lst) if lst is not None else w["count"]
    best = None
    for k in range(n):
        i = lst[k] if lst is not None else k
        h = fn(w["tris"], i * 9)
        if h and (best is None or h["t"] < best["t"]):
            h["index"] = i
            best = h
    return best


def sweep_sphere(c, r, d, world):
    """``d`` = full displacement; hit ``t`` in [0,1]. ``{t, normal, face, point, depth, penetrating, index}`` or None."""
    w, P = norm_world(world), 1e-6
    lo = [min(c[0], c[0] + d[0]) - r - P, min(c[1], c[1] + d[1]) - r - P, min(c[2], c[2] + d[2]) - r - P]
    hi = [max(c[0], c[0] + d[0]) + r + P, max(c[1], c[1] + d[1]) + r + P, max(c[2], c[2] + d[2]) + r + P]

    def fn(T, o):
        t = _tri_at(T, o)
        return _sweep_sphere_tri(c, r, d, t[0], t[1], t[2])

    return _sweep_all(w, lo, hi, fn)


def sweep_capsule(a, b, r, d, world):
    w, P = norm_world(world), 1e-6
    lo = [min(a[i], b[i], a[i] + d[i], b[i] + d[i]) - r - P for i in range(3)]
    hi = [max(a[i], b[i], a[i] + d[i], b[i] + d[i]) + r + P for i in range(3)]

    def fn(T, o):
        t = _tri_at(T, o)
        return _sweep_capsule_tri(a, b, r, d, t[0], t[1], t[2])

    return _sweep_all(w, lo, hi, fn)


def capsule_contacts(a, b, r, world):
    w, P = norm_world(world), 1e-6
    lo = [min(a[i], b[i]) - r - P for i in range(3)]
    hi = [max(a[i], b[i]) + r + P for i in range(3)]
    lst = w["candidates"](lo, hi) if w["candidates"] else None
    n = len(lst) if lst is not None else w["count"]
    out = []
    for k in range(n):
        i = lst[k] if lst is not None else k
        t = _tri_at(w["tris"], i * 9)
        c = _cap_tri_contact(a, b, r, t[0], t[1], t[2])
        if c:
            out.append({"index": i, "normal": c["normal"], "depth": c["depth"]})
    return out


# ---------------- kinematic character controller (capsule move-and-slide) ----------------
def create_character(pos=None, radius=None, height=None, step_height=None, min_ground_y=None, skin=None, snap_distance=None, max_iterations=None):
    def d(v, x): return x if v is None else v
    return {"pos": list(pos or [0, 0, 0]), "vel": [0, 0, 0], "grounded": False, "groundNormal": [0, 1, 0],
            "radius": d(radius, 0.4), "height": d(height, 1.8), "stepHeight": d(step_height, 0.35),
            "minGroundY": d(min_ground_y, 0.6427876096865394), "skin": d(skin, 1e-4),
            "snapDistance": d(snap_distance, 0.3), "maxIterations": d(max_iterations, 4)}


def _cap_a(ch, p): return [p[0], p[1] + ch["radius"], p[2]]
def _cap_b(ch, p): return [p[0], p[1] + ch["height"] - ch["radius"], p[2]]
def _sweep_ch(ch, w, p, d): return sweep_capsule(_cap_a(ch, p), _cap_b(ch, p), ch["radius"], d, w)


def depenetrate(ch, world, iterations=4):
    w = norm_world(world)
    for _ in range(iterations):
        cs = [c for c in capsule_contacts(_cap_a(ch, ch["pos"]), _cap_b(ch, ch["pos"]), ch["radius"], w) if c["depth"] > 1e-9]
        if not cs:
            return
        best = cs[0]
        for c in cs:
            if c["depth"] > best["depth"]:
                best = c
        ch["pos"] = madd(ch["pos"], best["normal"], best["depth"] + ch["skin"])


def _slide(ch, w, p0, d0, stick, info):
    p, d, planes = list(p0), list(d0), []
    it = 0
    while it < ch["maxIterations"] and len2(d) > EPS2:
        it += 1
        hit = _sweep_ch(ch, w, p, d)
        if not hit:
            p = add(p, d)
            d = [0, 0, 0]
            break
        p = madd(madd(p, d, hit["t"]), hit["normal"], ch["skin"])
        n = hit["normal"]
        f = hit.get("face") or n
        info["hits"].append(n)
        if f[1] >= ch["minGroundY"]:
            info["floor"] = f
            if stick:
                d = [0, 0, 0]
                break
            if n[1] < ch["minGroundY"]:
                info["wall"] = True
        elif n[1] < -0.7:
            info["ceil"] = True
        else:
            info["wall"] = True
        nn = n
        if n[1] > 0 and f[1] < ch["minGroundY"]:
            l = math.hypot(n[0], n[2])
            if l > 1e-9:
                nn = [n[0] / l, 0, n[2] / l]
        rem = mul(d, 1 - hit["t"])
        into = dot(rem, nn)
        if into < 0:
            rem = madd(rem, nn, -into)
        planes.append(nn)
        for k in range(len(planes) - 1):
            if dot(rem, planes[k]) < -1e-9:
                cr = cross(nn, planes[k])
                l = length(cr)
                rem = [0, 0, 0] if l < 1e-9 else mul(cr, dot(rem, cr) / (l * l))
        for pl in planes:
            if dot(rem, pl) < -1e-9:
                rem = [0, 0, 0]
        d = rem
    return p


def _h_dist(a, b): return math.hypot(a[0] - b[0], a[2] - b[2])


def _try_step(ch, w, start, hd):
    up = _sweep_ch(ch, w, start, [0, ch["stepHeight"], 0])
    rise = up["t"] * ch["stepHeight"] - ch["skin"] if up else ch["stepHeight"]
    if rise <= 1e-6:
        return None
    p1 = [start[0], start[1] + rise, start[2]]
    p2 = _slide(ch, w, p1, hd, False, {"hits": []})
    dn = rise + 1e-3
    hit = _sweep_ch(ch, w, p2, [0, -dn, 0])
    if not hit or (hit.get("face") or hit["normal"])[1] < ch["minGroundY"]:
        return None
    return madd(madd(p2, [0, -dn, 0], hit["t"]), hit["normal"], ch["skin"])


def move_and_slide(ch, vel, dt, world):
    """Move the character by ``vel*dt`` (slide + step-up + ground snap). Mutates and returns ``ch``."""
    w = norm_world(world)
    was_grounded, start = ch["grounded"], list(ch["pos"])
    depenetrate(ch, w)
    cur = list(ch["pos"])
    hd = [vel[0] * dt, 0, vel[2] * dt]
    info_h = {"hits": [], "wall": False, "floor": None, "ceil": False}
    if len2(hd) > 0:
        cur = _slide(ch, w, cur, hd, False, info_h)
        if was_grounded and info_h["wall"] and ch["stepHeight"] > 0:
            s = _try_step(ch, w, ch["pos"], hd)
            if s and _h_dist(s, ch["pos"]) > _h_dist(cur, ch["pos"]) + 1e-9:
                cur = s
    info_v = {"hits": [], "wall": False, "floor": None, "ceil": False}
    vy = vel[1] * dt
    if vy != 0:
        cur = _slide(ch, w, cur, [0, vy, 0], True, info_v)
    grounded, gn = False, [0, 1, 0]
    if vel[1] <= 0:
        if info_v["floor"]:
            grounded, gn = True, info_v["floor"]
        else:
            dist = ch["snapDistance"] if was_grounded else ch["skin"] * 3
            dv = [0, -dist, 0]
            hit = _sweep_ch(ch, w, cur, dv)
            if hit and (hit.get("face") or hit["normal"])[1] >= ch["minGroundY"]:
                cur = madd(madd(cur, dv, hit["t"]), hit["normal"], ch["skin"])
                grounded, gn = True, hit.get("face") or hit["normal"]
    ch["pos"], ch["grounded"], ch["groundNormal"] = cur, grounded, gn
    inv = 1 / dt if dt > 0 else 0
    vy_out = vel[1]
    if grounded:
        vy_out = 0
    elif info_v["ceil"] and vy_out > 0:
        vy_out = 0
    ch["vel"] = [(cur[0] - start[0]) * inv, vy_out, (cur[2] - start[2]) * inv]
    return ch
