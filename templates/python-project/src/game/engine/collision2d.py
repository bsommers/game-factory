"""collision2d: general 2D collision toolkit (port of templates/web-project/src/lib/collision2d.js; spec/v2/collision2d.md).

Coordinates: x right, y DOWN. Angles in radians. Shapes, manifolds, colliders and queries are plain dicts with the SAME
keys as the JSON spec (``{"type": "aabb", "x":..., "hw":...}``), so vectors round-trip unchanged. Function names are
snake_case. Pure, deterministic (no clocks / randomness); all tie-breaks are "first index / lower id wins".
Python floats are f64 like JS numbers; ints are kept where the inputs are ints (compared numerically by the tests).
"""
from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional

sqrt = math.sqrt
INF = float("inf")
EPS = 1e-9

TILE = {"EMPTY": 0, "SOLID": 1, "ONEWAY": 2, "SLOPE_R": 3, "SLOPE_L": 4, "SLOPE_R_LO": 5, "SLOPE_R_HI": 6,
        "SLOPE_L_HI": 7, "SLOPE_L_LO": 8}
SLOPES = {3: (0, 1), 4: (1, 0), 5: (0, 0.5), 6: (0.5, 1), 7: (1, 0.5), 8: (0.5, 0)}


def _len(x, y):
    return sqrt(x * x + y * y)


def _g(o, k):
    """Field of a dict or attribute object, None when missing (JS ``undefined``)."""
    return o.get(k) if isinstance(o, dict) else getattr(o, k, None)


def _i32(v: int) -> int:
    v &= 0xFFFFFFFF
    return v - 0x100000000 if v & 0x80000000 else v


# ---- shape factories --------------------------------------------------------------------------------------------
def aabb(x, y, hw, hh): return {"type": "aabb", "x": x, "y": y, "hw": hw, "hh": hh}
def circle(x, y, r): return {"type": "circle", "x": x, "y": y, "r": r}
def obb(x, y, hw, hh, angle=0): return {"type": "obb", "x": x, "y": y, "hw": hw, "hh": hh, "angle": angle}
def polygon(x, y, points, angle=0): return {"type": "polygon", "x": x, "y": y, "angle": angle, "points": points}
def capsule(x, y, hl, r, angle=0): return {"type": "capsule", "x": x, "y": y, "hl": hl, "r": r, "angle": angle}


def aabb_from_bounds(b):
    return aabb((b["minX"] + b["maxX"]) / 2, (b["minY"] + b["maxY"]) / 2, (b["maxX"] - b["minX"]) / 2, (b["maxY"] - b["minY"]) / 2)


def translate(s, dx, dy):
    o = dict(s)
    o["x"] = s["x"] + dx
    o["y"] = s["y"] + dy
    return o


def _area2(v):
    s = 0
    n = len(v)
    for i in range(n):
        p, q = v[i], v[(i + 1) % n]
        s += p[0] * q[1] - q[0] * p[1]
    return s


def hull(s):
    """Reduce a shape to (verts [(x,y)...], r) in world space (polygons get positive winding)."""
    t = s["type"]
    if t == "circle":
        return [(s["x"], s["y"])], s["r"]
    if t == "aabb":
        x, y, hw, hh = s["x"], s["y"], s["hw"], s["hh"]
        return [(x - hw, y - hh), (x + hw, y - hh), (x + hw, y + hh), (x - hw, y + hh)], 0
    if t in ("obb", "polygon"):
        a = s.get("angle") or 0
        c, sn = math.cos(a), math.sin(a)
        if t == "obb":
            hw, hh = s["hw"], s["hh"]
            pts = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
        else:
            pts = [(p["x"], p["y"]) for p in s["points"]]
        v = [(s["x"] + px * c - py * sn, s["y"] + px * sn + py * c) for px, py in pts]
        if _area2(v) < 0:
            v.reverse()
        return v, 0
    if t == "capsule":
        a = s.get("angle") or 0
        c, sn = math.cos(a), math.sin(a)
        hl = s["hl"]
        return [(s["x"] - hl * c, s["y"] - hl * sn), (s["x"] + hl * c, s["y"] + hl * sn)], s["r"]
    raise ValueError("collision2d: unknown shape type %s" % t)


def bounds(s):
    t = s["type"]
    if t == "aabb":
        return {"minX": s["x"] - s["hw"], "minY": s["y"] - s["hh"], "maxX": s["x"] + s["hw"], "maxY": s["y"] + s["hh"]}
    if t == "circle":
        return {"minX": s["x"] - s["r"], "minY": s["y"] - s["r"], "maxX": s["x"] + s["r"], "maxY": s["y"] + s["r"]}
    v, r = hull(s)
    mnx = mny = INF
    mxx = mxy = -INF
    for x, y in v:
        if x < mnx: mnx = x
        if y < mny: mny = y
        if x > mxx: mxx = x
        if y > mxy: mxy = y
    return {"minX": mnx - r, "minY": mny - r, "maxX": mxx + r, "maxY": mxy + r}


def bounds_overlap(a, b):
    return a["minX"] <= b["maxX"] and a["maxX"] >= b["minX"] and a["minY"] <= b["maxY"] and a["maxY"] >= b["minY"]


def can_collide(a, b):
    """Layer/mask filter (32-bit AND). Defaults: layer 1, mask all bits. ``a``/``b``: dicts or attribute objects."""
    def d(v, dflt): return dflt if v is None else v
    return (_i32(int(d(_g(a, "layer"), 1))) & _i32(int(d(_g(b, "mask"), -1)))) != 0 and \
           (_i32(int(d(_g(b, "layer"), 1))) & _i32(int(d(_g(a, "mask"), -1)))) != 0


# ---- hull helpers -----------------------------------------------------------------------------------------------
def _faces(h):
    v = h[0]
    n = len(v)
    out = []
    if n < 2:
        return out
    for i in range(n):
        p, q = v[i], v[(i + 1) % n]
        ex, ey = q[0] - p[0], q[1] - p[1]
        l = _len(ex, ey)
        if l == 0:
            continue
        out.append((i, p, ey / l, -ex / l))
    if n == 2:
        a, b = v[0], v[1]
        ex, ey = b[0] - a[0], b[1] - a[1]
        l = _len(ex, ey)
        if l > 0:
            out.append((-1, b, ex / l, ey / l))
            out.append((-1, a, -ex / l, -ey / l))
    return out


def _min_dot(h, f):
    m = INF
    _, p, nx, ny = f
    for q in h[0]:
        d = (q[0] - p[0]) * nx + (q[1] - p[1]) * ny
        if d < m:
            m = d
    return m


def _separation(A, B):
    best, bf, from_a = -INF, None, True
    for f in _faces(A):
        s = _min_dot(B, f)
        if s > best:
            best, bf, from_a = s, f, True
    for f in _faces(B):
        s = _min_dot(A, f)
        if s > best + EPS:
            best, bf, from_a = s, f, False
    return best, bf, from_a


def _seg_closest(px, py, ax, ay, bx, by):
    ex, ey = bx - ax, by - ay
    l2 = ex * ex + ey * ey
    t = ((px - ax) * ex + (py - ay) * ey) / l2 if l2 > 0 else 0
    t = 0 if t < 0 else 1 if t > 1 else t
    return (ax + ex * t, ay + ey * t)


def _edges_of(h):
    v = h[0]
    n = len(v)
    if n == 1:
        return [(v[0], v[0])]
    if n == 2:
        return [(v[0], v[1])]
    return [(v[i], v[(i + 1) % n]) for i in range(n)]


def _closest_pair(A, B):
    best = INF
    pA = pB = None
    ea, eb = _edges_of(A), _edges_of(B)
    for v in A[0]:
        for p, q in eb:
            c = _seg_closest(v[0], v[1], p[0], p[1], q[0], q[1])
            dx, dy = c[0] - v[0], c[1] - v[1]
            d2 = dx * dx + dy * dy
            if d2 < best:
                best, pA, pB = d2, v, c
    for w in B[0]:
        for p, q in ea:
            c = _seg_closest(w[0], w[1], p[0], p[1], q[0], q[1])
            dx, dy = w[0] - c[0], w[1] - c[1]
            d2 = dx * dx + dy * dy
            if d2 < best:
                best, pA, pB = d2, c, w
    dist = sqrt(best)
    n = ((pB[0] - pA[0]) / dist, (pB[1] - pA[1]) / dist) if dist > 0 else (1, 0)
    return dist, pA, pB, n


def _clip_line(p0, p1, nx, ny, off):
    d0 = p0[0] * nx + p0[1] * ny - off
    d1 = p1[0] * nx + p1[1] * ny - off
    out = []
    if d0 <= 0:
        out.append(p0)
    if d1 <= 0:
        out.append(p1)
    if d0 * d1 < 0:
        t = d0 / (d0 - d1)
        out.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t))
    return out


def _clip_manifold_points(A, B, from_a, f):
    ref, inc = (A, B) if from_a else (B, A)
    n, m = len(inc[0]), len(ref[0])
    fi, _, fnx, fny = f
    v1, v2 = ref[0][fi], ref[0][(fi + 1) % m]
    bi, bd = 0, INF
    for i in range(n):
        p, q = inc[0][i], inc[0][(i + 1) % n]
        ex, ey = q[0] - p[0], q[1] - p[1]
        l = _len(ex, ey)
        if l == 0:
            continue
        d = (ey / l) * fnx + (-ex / l) * fny
        if d < bd:
            bd, bi = d, i
    p0, p1 = inc[0][bi], inc[0][(bi + 1) % n]
    tx, ty = v2[0] - v1[0], v2[1] - v1[1]
    tl = _len(tx, ty)
    tx /= tl
    ty /= tl
    c1 = _clip_line(p0, p1, -tx, -ty, -(v1[0] * tx + v1[1] * ty))
    if len(c1) < 2:
        return None
    c2 = _clip_line(c1[0], c1[1], tx, ty, v2[0] * tx + v2[1] * ty)
    if len(c2) < 2:
        return None
    pts = []
    for p in c2:
        sep = (p[0] - v1[0]) * fnx + (p[1] - v1[1]) * fny
        if sep <= EPS:
            pts.append({"x": p[0] - fnx * sep / 2, "y": p[1] - fny * sep / 2, "depth": max(0, -sep)})
    return pts or None


def _collide_aabb(a, b):
    dx, dy = b["x"] - a["x"], b["y"] - a["y"]
    ox = a["hw"] + b["hw"] - abs(dx)
    oy = a["hh"] + b["hh"] - abs(dy)
    if ox <= 0 or oy <= 0:
        return None
    x0 = max(a["x"] - a["hw"], b["x"] - b["hw"])
    x1 = min(a["x"] + a["hw"], b["x"] + b["hw"])
    y0 = max(a["y"] - a["hh"], b["y"] - b["hh"])
    y1 = min(a["y"] + a["hh"], b["y"] + b["hh"])
    if ox < oy:
        xm = (x0 + x1) / 2
        return {"normal": {"x": -1 if dx < 0 else 1, "y": 0}, "depth": ox,
                "points": [{"x": xm, "y": y0, "depth": ox}, {"x": xm, "y": y1, "depth": ox}]}
    ym = (y0 + y1) / 2
    return {"normal": {"x": 0, "y": -1 if dy < 0 else 1}, "depth": oy,
            "points": [{"x": x0, "y": ym, "depth": oy}, {"x": x1, "y": ym, "depth": oy}]}


def _collide_hulls(A, B):
    rr = A[1] + B[1]
    best, f, from_a = _separation(A, B)
    if f is None or best > 0:
        if rr == 0 and f is not None:
            return None
        dist, pA, pB, n = _closest_pair(A, B)
        depth = rr - dist
        if depth <= 0:
            return None
        sax, say = pA[0] + n[0] * A[1], pA[1] + n[1] * A[1]
        sbx, sby = pB[0] - n[0] * B[1], pB[1] - n[1] * B[1]
        pts = [{"x": (sax + sbx) / 2, "y": (say + sby) / 2, "depth": depth}]
        if len(B[0]) == 2 or len(A[0]) == 2:
            seg_b = len(B[0]) == 2
            two = []
            for v in (B[0] if seg_b else A[0]):
                if seg_b:
                    s = (v[0] - pA[0]) * n[0] + (v[1] - pA[1]) * n[1]
                else:
                    s = (pB[0] - v[0]) * n[0] + (pB[1] - v[1]) * n[1]
                d = rr - s
                if d > 0:
                    if seg_b:
                        two.append({"x": v[0] - n[0] * B[1] + n[0] * d / 2, "y": v[1] - n[1] * B[1] + n[1] * d / 2, "depth": d})
                    else:
                        two.append({"x": v[0] + n[0] * A[1] - n[0] * d / 2, "y": v[1] + n[1] * A[1] - n[1] * d / 2, "depth": d})
            if len(two) == 2:
                pts = two
        return {"normal": {"x": n[0], "y": n[1]}, "depth": depth, "points": pts}
    depth = rr - best
    if depth <= 0:
        return None
    _, fp, fnx, fny = f
    n = (fnx, fny) if from_a else (-fnx, -fny)
    pts = None
    if rr == 0 and len(A[0]) >= 3 and len(B[0]) >= 3:
        pts = _clip_manifold_points(A, B, from_a, f)
    if not pts:
        other = B if from_a else A
        cand = []
        for k, v in enumerate(other[0]):
            cand.append((((v[0] - fp[0]) * fnx + (v[1] - fp[1]) * fny), k, v))
        cand.sort(key=lambda c: (c[0], c[1]))
        pts = []
        for s, k, v in cand[:2]:
            d = rr - s
            if d <= 0 and pts:
                break
            dd = max(d, 0)
            if from_a:
                pts.append({"x": v[0] - n[0] * B[1] + n[0] * dd / 2, "y": v[1] - n[1] * B[1] + n[1] * dd / 2, "depth": dd})
            else:
                pts.append({"x": v[0] + n[0] * A[1] - n[0] * dd / 2, "y": v[1] + n[1] * A[1] - n[1] * dd / 2, "depth": dd})
    return {"normal": {"x": n[0], "y": n[1]}, "depth": depth, "points": pts}


def collide(a, b):
    """Contact manifold ``{normal, depth, points}`` (normal a -> b) or None."""
    if a["type"] == "aabb" and b["type"] == "aabb":
        return _collide_aabb(a, b)
    return _collide_hulls(hull(a), hull(b))


def overlaps(a, b):
    return collide(a, b) is not None


def overlap_all(shape, lst):
    return [i for i, s in enumerate(lst) if collide(shape, s)]


def distance(a, b):
    A, B = hull(a), hull(b)
    best, f, from_a = _separation(A, B)
    if f is not None and best <= 0:
        n = {"x": f[2], "y": f[3]} if from_a else {"x": -f[2], "y": -f[3]}
        return {"distance": 0, "overlap": True, "normal": n, "pointA": None, "pointB": None}
    dist, pA, pB, n = _closest_pair(A, B)
    d = dist - A[1] - B[1]
    nn = {"x": n[0], "y": n[1]}
    if d <= 0:
        return {"distance": 0, "overlap": True, "normal": nn, "pointA": None, "pointB": None}
    return {"distance": d, "overlap": False, "normal": nn,
            "pointA": {"x": pA[0] + n[0] * A[1], "y": pA[1] + n[1] * A[1]},
            "pointB": {"x": pB[0] - n[0] * B[1], "y": pB[1] - n[1] * B[1]}}


# ---- point / ray / segment / shape casts ------------------------------------------------------------------------
def contains_point(s, px, py):
    h = hull(s)
    if len(h[0]) < 3:
        p, q = _edges_of(h)[0]
        c = _seg_closest(px, py, p[0], p[1], q[0], q[1])
        dx, dy = px - c[0], py - c[1]
        return dx * dx + dy * dy <= h[1] * h[1]
    for _, p, nx, ny in _faces(h):
        if (px - p[0]) * nx + (py - p[1]) * ny > 0:
            return False
    return True


def _ray_circle(cx, cy, r, ox, oy, dx, dy, max_t):
    fx, fy = ox - cx, oy - cy
    a = dx * dx + dy * dy
    b = 2 * (fx * dx + fy * dy)
    c = fx * fx + fy * fy - r * r
    if a == 0:
        return None
    if c <= 0:
        l = sqrt(a)
        return {"t": 0, "x": ox, "y": oy, "normal": {"x": -dx / l, "y": -dy / l}, "inside": True}
    disc = b * b - 4 * a * c
    if disc < 0:
        return None
    t = (-b - sqrt(disc)) / (2 * a)
    if t < 0 or t > max_t:
        return None
    x, y = ox + dx * t, oy + dy * t
    return {"t": t, "x": x, "y": y, "normal": {"x": (x - cx) / r, "y": (y - cy) / r}, "inside": False}


def _ray_poly(h, ox, oy, dx, dy, max_t):
    l = _len(dx, dy)
    if l == 0:
        return None
    tmin, tmax, nx, ny = -INF, INF, 0, 0
    for _, p, fnx, fny in _faces(h):
        denom = dx * fnx + dy * fny
        dist = (ox - p[0]) * fnx + (oy - p[1]) * fny
        if denom == 0:
            if dist > 0:
                return None
            continue
        t = -dist / denom
        if denom < 0:
            if t > tmin:
                tmin, nx, ny = t, fnx, fny
        elif t < tmax:
            tmax = t
    if tmin > tmax:
        return None
    if tmin < 0:
        if tmax < 0:
            return None
        return {"t": 0, "x": ox, "y": oy, "normal": {"x": -dx / l, "y": -dy / l}, "inside": True}
    if tmin > max_t:
        return None
    return {"t": tmin, "x": ox + dx * tmin, "y": oy + dy * tmin, "normal": {"x": nx, "y": ny}, "inside": False}


def raycast(s, ox, oy, dx, dy, max_t=1):
    """Ray o + d*t, t in [0, max_t]. Nearest hit ``{t,x,y,normal,inside}`` or None."""
    if s["type"] == "circle":
        return _ray_circle(s["x"], s["y"], s["r"], ox, oy, dx, dy, max_t)
    if s["type"] == "capsule":
        h = hull(s)
        a, b = h[0][0], h[0][1]
        cand = [_ray_circle(a[0], a[1], s["r"], ox, oy, dx, dy, max_t),
                _ray_circle(b[0], b[1], s["r"], ox, oy, dx, dy, max_t),
                _ray_poly(hull(obb(s["x"], s["y"], s["hl"], s["r"], s.get("angle") or 0)), ox, oy, dx, dy, max_t)]
        best = None
        for c in cand:
            if not c:
                continue
            if c["inside"]:
                return c
            if best is None or c["t"] < best["t"]:
                best = c
        return best
    return _ray_poly(hull(s), ox, oy, dx, dy, max_t)


def segmentcast(s, x0, y0, x1, y1):
    return raycast(s, x0, y0, x1 - x0, y1 - y0, 1)


def raycast_nearest(lst, ox, oy, dx, dy, max_t=1):
    best = None
    for i, s in enumerate(lst):
        h = raycast(s, ox, oy, dx, dy, max_t)
        if h and (best is None or h["t"] < best["t"]):
            best = dict(h, index=i)
    return best


def shape_cast(a, dx, dy, b):
    """Continuous shape cast (conservative advancement, 128 iterations). ``{t,normal,x,y,overlap}`` or None."""
    t = 0
    for it in range(128):
        at = translate(a, dx * t, dy * t)
        m = collide(at, b)
        if m:
            return {"t": t, "normal": {"x": -m["normal"]["x"], "y": -m["normal"]["y"]},
                    "x": m["points"][0]["x"], "y": m["points"][0]["y"], "overlap": it == 0}
        d = distance(at, b)
        if d["overlap"]:
            return {"t": t, "normal": {"x": -d["normal"]["x"], "y": -d["normal"]["y"]}, "x": at["x"], "y": at["y"], "overlap": it == 0}
        closing = dx * d["normal"]["x"] + dy * d["normal"]["y"]
        if closing <= 0:
            return None
        if d["distance"] <= EPS:
            return {"t": t, "normal": {"x": -d["normal"]["x"], "y": -d["normal"]["y"]},
                    "x": (d["pointA"]["x"] + d["pointB"]["x"]) / 2, "y": (d["pointA"]["y"] + d["pointB"]["y"]) / 2, "overlap": False}
        t += d["distance"] / closing
        if t > 1:
            return None
    return None


def swept_aabb(a, dx, dy, b):
    hx, hy = a["hw"] + b["hw"], a["hh"] + b["hh"]
    n0, f0, n1, f1 = -INF, INF, -INF, INF
    if dx == 0:
        if abs(a["x"] - b["x"]) >= hx:
            return None
    else:
        t1, t2 = (b["x"] - hx - a["x"]) / dx, (b["x"] + hx - a["x"]) / dx
        n0, f0 = min(t1, t2), max(t1, t2)
    if dy == 0:
        if abs(a["y"] - b["y"]) >= hy:
            return None
    else:
        t1, t2 = (b["y"] - hy - a["y"]) / dy, (b["y"] + hy - a["y"]) / dy
        n1, f1 = min(t1, t2), max(t1, t2)
    entry, exit_ = max(n0, n1), min(f0, f1)
    if entry >= exit_ or exit_ <= 0 or entry > 1:
        return None
    if entry < 0:
        m = _collide_aabb(b, a)
        if not m:
            return None
        return {"t": 0, "normal": m["normal"], "x": a["x"], "y": a["y"], "overlap": True}
    normal = {"x": -1 if dx > 0 else 1, "y": 0} if n0 > n1 else {"x": 0, "y": -1 if dy > 0 else 1}
    return {"t": entry, "normal": normal, "x": a["x"] + dx * entry, "y": a["y"] + dy * entry, "overlap": False}


def move_aabb(a, dx, dy, boxes, iterations=4):
    x, y, rx, ry = a["x"], a["y"], dx, dy
    hits = []
    for _ in range(iterations):
        if rx == 0 and ry == 0:
            break
        best, bi = None, -1
        for i, bx in enumerate(boxes):
            s = swept_aabb(aabb(x, y, a["hw"], a["hh"]), rx, ry, bx)
            if s and (best is None or s["t"] < best["t"]):
                best, bi = s, i
        if best is None:
            x += rx
            y += ry
            rx = ry = 0
            break
        x += rx * best["t"]
        y += ry * best["t"]
        hits.append({"index": bi, "t": best["t"], "normal": best["normal"]})
        rem = 1 - best["t"]
        px, py = rx * rem, ry * rem
        dot = px * best["normal"]["x"] + py * best["normal"]["y"]
        if dot < 0:
            px -= best["normal"]["x"] * dot
            py -= best["normal"]["y"] * dot
        rx, ry = px, py
    return {"x": x, "y": y, "hits": hits}


# ---- uniform spatial hash broadphase ----------------------------------------------------------------------------
def _id_key(i):
    """Sort key: numbers before strings; numbers numerically, strings by code point."""
    return (1, i) if isinstance(i, str) else (0, i)


class _Item:
    __slots__ = ("id", "bounds", "layer", "mask", "keys", "ord")

    def __init__(self, id, bounds, layer, mask, keys, ord):
        self.id, self.bounds, self.layer, self.mask, self.keys, self.ord = id, bounds, layer, mask, keys, ord


class SpatialHash:
    """Uniform grid broadphase; all results sorted by id (numbers before strings)."""

    def __init__(self, cell_size=32):
        self.cell_size = cell_size
        self.cells: Dict[Any, list] = {}
        self.items: Dict[Any, _Item] = {}
        self._ord = 0

    def _range(self, b):
        cs = self.cell_size
        return (math.floor(b["minX"] / cs), math.floor(b["minY"] / cs), math.floor(b["maxX"] / cs), math.floor(b["maxY"] / cs))

    def _put(self, id, bounds, layer, mask, o):
        x0, y0, x1, y1 = self._range(bounds)
        keys = []
        for cy in range(y0, y1 + 1):
            for cx in range(x0, x1 + 1):
                k = (cx, cy)
                self.cells.setdefault(k, []).append(id)
                keys.append(k)
        self.items[id] = _Item(id, dict(bounds), layer, mask, keys, o)

    def _drop(self, id):
        it = self.items.get(id)
        if it is None:
            return
        for k in it.keys:
            c = self.cells[k]
            if id in c:
                c.remove(id)
            if not c:
                del self.cells[k]
        del self.items[id]

    def insert(self, id, bounds, meta=None):
        self._drop(id)
        self._put(id, bounds, _g(meta, "layer") if meta is not None else None, _g(meta, "mask") if meta is not None else None, self._ord)
        self._ord += 1
        return self

    def update(self, id, bounds):
        it = self.items.get(id)
        if it is None:
            raise KeyError("spatial hash: unknown id %s" % (id,))
        o, layer, mask = it.ord, it.layer, it.mask
        self._drop(id)
        self._put(id, bounds, layer, mask, o)
        return self

    def remove(self, id):
        self._drop(id)
        return self

    def clear(self):
        self.cells.clear()
        self.items.clear()
        self._ord = 0

    def has(self, id): return id in self.items
    def size(self): return len(self.items)

    def query(self, b):
        x0, y0, x1, y1 = self._range(b)
        seen, out = set(), []
        for cy in range(y0, y1 + 1):
            for cx in range(x0, x1 + 1):
                for id in self.cells.get((cx, cy), ()):
                    if id in seen:
                        continue
                    seen.add(id)
                    if bounds_overlap(self.items[id].bounds, b):
                        out.append(id)
        return sorted(out, key=_id_key)

    def query_point(self, x, y):
        return self.query({"minX": x, "minY": y, "maxX": x, "maxY": y})

    def pairs(self, filt: Optional[Callable] = None):
        seen, out = set(), []
        for c in self.cells.values():
            for i in range(len(c)):
                for j in range(i + 1, len(c)):
                    A, B = self.items[c[i]], self.items[c[j]]
                    lo, hi = (A, B) if A.ord < B.ord else (B, A)
                    k = (lo.ord, hi.ord)
                    if k in seen:
                        continue
                    seen.add(k)
                    if not bounds_overlap(A.bounds, B.bounds) or not can_collide(A, B) or (filt and not filt(A.id, B.id)):
                        continue
                    out.append([A.id, B.id] if _id_key(A.id) <= _id_key(B.id) else [B.id, A.id])
        out.sort(key=lambda p: (_id_key(p[0]), _id_key(p[1])))
        return out


def create_spatial_hash(cell_size=32):
    return SpatialHash(cell_size)


# ---- colliders, scene, tilemap ----------------------------------------------------------------------------------
def surface_y(c, x):
    if c["kind"] != "slope":
        return c["minY"]
    s = c["slope"]
    u = min(1, max(0, (x - s["x0"]) / (s["x1"] - s["x0"])))
    return s["y0"] + (s["y1"] - s["y0"]) * u


def collider_shape(c):
    if c["kind"] != "slope":
        return aabb((c["minX"] + c["maxX"]) / 2, (c["minY"] + c["maxY"]) / 2, (c["maxX"] - c["minX"]) / 2, (c["maxY"] - c["minY"]) / 2)
    s = c["slope"]
    return polygon(0, 0, [{"x": s["x0"], "y": c["maxY"]}, {"x": s["x1"], "y": c["maxY"]}, {"x": s["x1"], "y": s["y1"]}, {"x": s["x0"], "y": s["y0"]}])


class Scene:
    """Static geometry container; ``query(bounds)`` returns colliders in insertion order."""

    def __init__(self, colliders=(), cell_size=32):
        self._hash = SpatialHash(cell_size)
        self.colliders: List[dict] = []
        for c in colliders:
            self.add(c)

    def add(self, c):
        self._hash.insert(len(self.colliders), c)
        self.colliders.append(c)
        return self

    def query(self, b):
        return [self.colliders[i] for i in self._hash.query(b)]


def create_scene(colliders=(), cell_size=32):
    return Scene(colliders, cell_size)


class Tilemap:
    def __init__(self, cols, rows, tile_size, tiles=None, x=0, y=0, outside=0, one_way_thickness=4):
        self.cols, self.rows, self.tile_size, self.x, self.y = cols, rows, tile_size, x, y
        self.outside, self.one_way_thickness = outside, one_way_thickness
        self.tiles = list(tiles) if tiles is not None else [0] * (cols * rows)

    def get(self, c, r):
        return self.outside if (c < 0 or r < 0 or c >= self.cols or r >= self.rows) else self.tiles[r * self.cols + c]

    def set(self, c, r, k):
        if 0 <= c < self.cols and 0 <= r < self.rows:
            self.tiles[r * self.cols + c] = k

    def collider_at(self, c, r):
        k = self.get(c, r)
        if k == TILE["EMPTY"]:
            return None
        ts = self.tile_size
        min_x, min_y = self.x + c * ts, self.y + r * ts
        max_x, max_y = min_x + ts, min_y + ts
        if k == TILE["SOLID"]:
            return {"kind": "solid", "minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y, "col": c, "row": r, "tile": k}
        if k == TILE["ONEWAY"]:
            return {"kind": "oneway", "minX": min_x, "minY": min_y, "maxX": max_x, "maxY": min_y + min(self.one_way_thickness, ts), "col": c, "row": r, "tile": k}
        s = SLOPES.get(k)
        if not s:
            return None
        return {"kind": "slope", "minX": min_x, "minY": min_y, "maxX": max_x, "maxY": max_y,
                "slope": {"x0": min_x, "y0": max_y - s[0] * ts, "x1": max_x, "y1": max_y - s[1] * ts}, "col": c, "row": r, "tile": k}

    def tile_at(self, wx, wy):
        c = math.floor((wx - self.x) / self.tile_size)
        r = math.floor((wy - self.y) / self.tile_size)
        return {"col": c, "row": r, "kind": self.get(c, r)}

    def query(self, b):
        ts = self.tile_size
        c0, c1 = math.floor((b["minX"] - self.x) / ts), math.floor((b["maxX"] - self.x) / ts)
        r0, r1 = math.floor((b["minY"] - self.y) / ts), math.floor((b["maxY"] - self.y) / ts)
        out = []
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                col = self.collider_at(c, r)
                if col:
                    out.append(col)
        return out


def create_tilemap(cols, rows, tile_size, tiles=None, x=0, y=0, outside=0, one_way_thickness=4):
    return Tilemap(cols, rows, tile_size, tiles, x, y, outside, one_way_thickness)


def collide_source(src, shape, layer=None, mask=None, prev_max_y=None):
    """Collide a shape with a scene/tilemap: ``[{collider, manifold}]`` (normal collider -> shape)."""
    out, f = [], {"layer": layer, "mask": mask}
    for c in src.query(bounds(shape)):
        if not can_collide(c, f):
            continue
        m = collide(collider_shape(c), shape)
        if not m:
            continue
        if c["kind"] == "oneway" and not (m["normal"]["y"] < -0.5 and (-INF if prev_max_y is None else prev_max_y) <= c["minY"] + 1e-6):
            continue
        out.append({"collider": c, "manifold": m})
    return out


def from_platformer_world(w, min_x=-10000, max_x=10000, depth=64):
    cs, cur = [], min_x
    for p in sorted(w.get("pits") or [], key=lambda p: p["x0"]):
        if p["x0"] > cur:
            cs.append({"kind": "solid", "minX": cur, "maxX": p["x0"], "minY": w["groundY"], "maxY": w["groundY"] + depth})
        cur = max(cur, p["x1"])
    if max_x > cur:
        cs.append({"kind": "solid", "minX": cur, "maxX": max_x, "minY": w["groundY"], "maxY": w["groundY"] + depth})
    for p in w.get("platforms") or []:
        cs.append({"kind": "oneway", "minX": p["x"] - p["w"] / 2, "maxX": p["x"] + p["w"] / 2, "minY": p["y"], "maxY": p["y"] + 4, "id": p.get("id")})
    return create_scene(cs, 64)
