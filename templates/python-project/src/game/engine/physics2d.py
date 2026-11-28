"""physics2d: deterministic 2D rigid-body engine + kinematic character controller (port of physics2d.js; spec/v2/physics2d.md).

Builds on :mod:`collision2d`. x right, y DOWN, angles in radians. Body / joint definitions, world config, events and the
character config are plain dicts with the JSON spec keys (``linearDamping``, ``anchorA`` ...); runtime state lives on
small attribute objects. The solver reproduces the reference's exact floating point operation order and iteration order
(id order, pairs sorted by id, friction before normal) so fixed-step runs match the golden vectors.
"""
from __future__ import annotations

import copy
import math
from types import SimpleNamespace as NS
from typing import Any, Callable, Dict, List, Optional

from . import collision2d as C

sqrt = math.sqrt
INF = float("inf")
NAN = float("nan")

WORLD_DEFAULTS: Dict[str, Any] = {
    "gravity": {"x": 0, "y": 600}, "velocityIterations": 10, "slop": 0.25, "baumgarte": 0.2, "maxBias": 150,
    "restitutionThreshold": 30, "warmRadius": 4, "cellSize": 64, "sleep": True, "ccd": True, "timeToSleep": 0.5,
    "linearSleep": 5, "angularSleep": 0.1,
}


def _cross(ax, ay, bx, by):
    return ax * by - ay * bx


def _div(a, b):
    """JS-style float division (x/0 -> +-inf or NaN instead of raising)."""
    try:
        return a / b
    except ZeroDivisionError:
        if a == 0 or a != a:
            return NAN
        return math.copysign(INF, a) * (math.copysign(1.0, b))


# ---- mass properties ---------------------------------------------------------------------------------------------
def _poly_props(pts):
    a2 = cx = cy = I = 0
    n = len(pts)
    for i in range(n):
        p, q = pts[i], pts[(i + 1) % n]
        cr = p["x"] * q["y"] - q["x"] * p["y"]
        a2 += cr
        cx += (p["x"] + q["x"]) * cr
        cy += (p["y"] + q["y"]) * cr
        I += cr * (p["x"] * p["x"] + p["x"] * q["x"] + q["x"] * q["x"] + p["y"] * p["y"] + p["y"] * q["y"] + q["y"] * q["y"])
    area = a2 / 2
    sgn = -1 if area < 0 else 1
    A = abs(area)
    cx = _div(cx, 6 * area)
    cy = _div(cy, 6 * area)
    Io = sgn * I / 12
    return {"area": A, "cx": cx, "cy": cy, "I": Io - A * (cx * cx + cy * cy)}


def _mass_props(sh, density):
    t = sh["type"]
    if t == "circle":
        m = density * math.pi * sh["r"] * sh["r"]
        return m, 0.5 * m * sh["r"] * sh["r"]
    if t == "box":
        m = density * 4 * sh["hw"] * sh["hh"]
        return m, m * (4 * sh["hw"] * sh["hw"] + 4 * sh["hh"] * sh["hh"]) / 12
    if t == "capsule":
        hl, r = sh["hl"], sh["r"]
        mr = density * 4 * hl * r
        mc = density * math.pi * r * r
        d = 4 * r / (3 * math.pi)
        hm = mc / 2
        Ir = mr * (4 * hl * hl + 4 * r * r) / 12
        Ih = 0.5 * hm * r * r - hm * d * d + hm * (hl + d) * (hl + d)
        return mr + mc, Ir + 2 * Ih
    pp = _poly_props(sh["points"])
    return density * pp["area"], density * pp["I"]


def placed(b):
    s = b.shape
    t = s["type"]
    if t == "circle":
        return C.circle(b.x, b.y, s["r"])
    if t == "box":
        return C.aabb(b.x, b.y, s["hw"], s["hh"]) if b.angle == 0 else C.obb(b.x, b.y, s["hw"], s["hh"], b.angle)
    if t == "capsule":
        return C.capsule(b.x, b.y, s["hl"], s["r"], b.angle)
    return C.polygon(b.x, b.y, s["points"], b.angle)


body_shape = placed


def _pair_key(a, b):
    return "%s:%s" % (a, b)


def _apply_p(b, px, py, rx, ry, k):
    b.vx += px * b.inv_mass * k
    b.vy += py * b.inv_mass * k
    b.w += b.inv_i * _cross(rx, ry, px, py) * k


class World:
    def __init__(self, opts: Optional[Dict[str, Any]] = None):
        opts = dict(opts or {})
        g = dict(WORLD_DEFAULTS["gravity"])
        g.update(opts.get("gravity") or {})
        cfg = dict(WORLD_DEFAULTS)
        cfg.update(opts)
        cfg["gravity"] = g
        self.on_event: Optional[Callable] = cfg.pop("onEvent", None)
        self.config = cfg
        self.st = NS(bodies=[], joints=[], contacts=[], sensors=[], next_id=1, next_joint=1, next_island=1, time=0, steps=0)
        self._by_id: Dict[int, Any] = {}
        self.events: List[dict] = []

    # -- accessors
    bodies = property(lambda self: self.st.bodies)
    joints = property(lambda self: self.st.joints)
    contacts = property(lambda self: self.st.contacts)
    time = property(lambda self: self.st.time)
    steps = property(lambda self: self.st.steps)

    def body(self, id):
        return self._by_id.get(id)

    def _reindex(self):
        self._by_id = {b.id: b for b in self.st.bodies}

    def _need(self, id):
        b = self._by_id.get(id)
        if b is None:
            raise KeyError("physics2d: no body %s" % (id,))
        return b

    def _joint_skip(self):
        s = set()
        for j in self.st.joints:
            if not j.collide_connected:
                s.add(_pair_key(j.a, j.b) if j.a < j.b else _pair_key(j.b, j.a))
        return s

    def _wake(self, b):
        if not b.asleep:
            b.sleep_t = 0
            return
        isl = b.island
        for o in self.st.bodies:
            if o.asleep and (o is b or (isl is not None and o.island == isl)):
                o.asleep = False
                o.island = None
                o.sleep_t = 0

    # -- construction
    def add_body(self, d: Dict[str, Any]) -> int:
        sh = d.get("shape")
        if not sh:
            raise ValueError("physics2d: body needs a shape")
        typ = d.get("type", "dynamic")
        density = d.get("density", 1)
        if sh["type"] == "polygon":
            shape = {"type": "polygon", "points": [{"x": p["x"], "y": p["y"]} for p in sh["points"]]}
        else:
            shape = dict(sh)
        x, y = d.get("x", 0), d.get("y", 0)
        angle = d.get("angle", 0)
        if shape["type"] == "polygon":
            pp = _poly_props(shape["points"])
            c, s = math.cos(angle), math.sin(angle)
            x += pp["cx"] * c - pp["cy"] * s
            y += pp["cx"] * s + pp["cy"] * c
            shape["points"] = [{"x": p["x"] - pp["cx"], "y": p["y"] - pp["cy"]} for p in shape["points"]]
        inv_mass = inv_i = 0
        if typ == "dynamic":
            m, I = _mass_props(shape, density)
            inv_mass = 1 / m if m > 0 else 0
            inv_i = 0 if (d.get("fixedRotation") or I <= 0) else 1 / I
        b = NS(id=self.st.next_id, type=typ, x=x, y=y, angle=angle, vx=d.get("vx", 0), vy=d.get("vy", 0), w=d.get("w", 0),
               fx=0, fy=0, torque=0, shape=shape, density=density, friction=d.get("friction", 0.5),
               restitution=d.get("restitution", 0), layer=d.get("layer", 1), mask=d.get("mask", -1), sensor=bool(d.get("sensor")),
               linear_damping=d.get("linearDamping", 0), angular_damping=d.get("angularDamping", 0),
               gravity_scale=d.get("gravityScale", 1), fixed_rotation=bool(d.get("fixedRotation")),
               allow_sleep=d.get("allowSleep", True), inv_mass=inv_mass, inv_i=inv_i, asleep=False, sleep_t=0, island=None,
               user_data=d.get("userData"))
        self.st.next_id += 1
        self.st.bodies.append(b)
        self._by_id[b.id] = b
        return b.id

    def remove_body(self, id):
        st = self.st
        st.bodies = [b for b in st.bodies if b.id != id]
        st.joints = [j for j in st.joints if j.a != id and j.b != id]
        st.contacts = [c for c in st.contacts if c.a != id and c.b != id]
        self._reindex()

    @staticmethod
    def _anchor(b, lx, ly):
        c, s = math.cos(b.angle), math.sin(b.angle)
        return b.x + lx * c - ly * s, b.y + lx * s + ly * c

    def add_joint(self, d: Dict[str, Any]) -> int:
        A, B = self._by_id.get(d["a"]), self._by_id.get(d["b"])
        if A is None or B is None:
            raise ValueError("physics2d: joint needs two bodies")
        lA, lB = d.get("anchorA") or {"x": 0, "y": 0}, d.get("anchorB") or {"x": 0, "y": 0}
        typ = d.get("type", "distance")
        j = NS(id=self.st.next_joint, type=typ, a=d["a"], b=d["b"], ax=lA["x"], ay=lA["y"], bx=lB["x"], by=lB["y"],
               length=d.get("length"), stiffness=d["stiffness"] if d.get("stiffness") is not None else (200 if d.get("type") == "spring" else 0),
               damping=d.get("damping", 0), collide_connected=bool(d.get("collideConnected")), j=0, jx=0, jy=0)
        self.st.next_joint += 1
        if typ != "revolute" and j.length is None:
            pax, pay = self._anchor(A, j.ax, j.ay)
            pbx, pby = self._anchor(B, j.bx, j.by)
            j.length = sqrt((pbx - pax) * (pbx - pax) + (pby - pay) * (pby - pay))
        self.st.joints.append(j)
        self._wake(A)
        self._wake(B)
        return j.id

    def remove_joint(self, id):
        self.st.joints = [j for j in self.st.joints if j.id != id]

    # -- control
    def wake(self, id): self._wake(self._need(id))

    def set_velocity(self, id, vx, vy, w=None):
        b = self._need(id)
        self._wake(b)
        b.vx, b.vy = vx, vy
        if w is not None:
            b.w = w

    def set_position(self, id, x, y, angle=None):
        b = self._need(id)
        self._wake(b)
        b.x, b.y = x, y
        if angle is not None:
            b.angle = angle

    def apply_force(self, id, fx, fy):
        b = self._need(id)
        self._wake(b)
        b.fx += fx
        b.fy += fy

    def apply_torque(self, id, t):
        b = self._need(id)
        self._wake(b)
        b.torque += t

    def apply_impulse(self, id, ix, iy, px=None, py=None):
        b = self._need(id)
        self._wake(b)
        b.vx += ix * b.inv_mass
        b.vy += iy * b.inv_mass
        if px is not None:
            b.w += b.inv_i * _cross(px - b.x, py - b.y, ix, iy)

    def kinematic_step(self, id, vx, vy, w=0):
        b = self._need(id)
        b.vx, b.vy, b.w = vx, vy, w

    # -- step
    def step(self, dt):
        cfg, st = self.config, self.st
        by_id = self._by_id
        self.events = events = []
        bodies, g = st.bodies, cfg["gravity"]
        # 1. integrate velocities
        for b in bodies:
            if b.type != "dynamic" or b.asleep:
                b.fx = b.fy = b.torque = 0
                continue
            b.vx += (g["x"] * b.gravity_scale + b.fx * b.inv_mass) * dt
            b.vy += (g["y"] * b.gravity_scale + b.fy * b.inv_mass) * dt
            b.w += b.torque * b.inv_i * dt
            b.vx /= 1 + dt * b.linear_damping
            b.vy /= 1 + dt * b.linear_damping
            b.w /= 1 + dt * b.angular_damping
            b.fx = b.fy = b.torque = 0
        # 2. broadphase + narrowphase
        h = C.SpatialHash(cfg["cellSize"])
        margin = cfg["slop"] * 2
        for b in bodies:
            bb = C.bounds(placed(b))
            h.insert(b.id, {"minX": bb["minX"] - margin, "minY": bb["minY"] - margin, "maxX": bb["maxX"] + margin, "maxY": bb["maxY"] + margin}, b)
        skip = self._joint_skip()
        prev = {c.key: c for c in st.contacts}
        prev_sensors = {s["key"]: s for s in st.sensors}
        contacts, sensors = [], []

        def settled(b):
            return b.type == "static" or b.asleep or (b.type == "kinematic" and b.vx == 0 and b.vy == 0 and b.w == 0)

        def awake(o):
            return (o.type == "dynamic" and not o.asleep) or (o.type == "kinematic" and not settled(o))

        warm2 = cfg["warmRadius"] * cfg["warmRadius"]
        for ia, ib in h.pairs():
            A, B = by_id[ia], by_id[ib]
            key = _pair_key(ia, ib)
            sp = A.sensor or B.sensor
            if A.sensor and B.sensor:
                continue
            if (A.type == "static" and B.type == "static") if sp else (A.type != "dynamic" and B.type != "dynamic"):
                continue
            if key in skip:
                continue
            if not sp and settled(A) and settled(B):
                p = prev.get(key)
                if p:
                    q = copy.copy(p)
                    q.carried = True
                    contacts.append(q)
                continue
            m = C.collide(placed(A), placed(B))
            if not m:
                continue
            if sp:
                sensors.append({"key": key, "sensor": ia if A.sensor else ib, "other": ib if A.sensor else ia})
                continue
            if A.asleep and awake(B):
                self._wake(A)
            if B.asleep and awake(A):
                self._wake(B)
            old = prev.get(key)
            pts = []
            for p in m["points"]:
                jn = jt = 0
                if old:
                    bd = warm2
                    for q in old.points:
                        dx, dy = q.x - p["x"], q.y - p["y"]
                        d2 = dx * dx + dy * dy
                        if d2 < bd:
                            bd, jn, jt = d2, q.jn, q.jt
                pts.append(NS(x=p["x"], y=p["y"], depth=p["depth"], jn=jn, jt=jt))
            contacts.append(NS(key=key, a=ia, b=ib, nx=m["normal"]["x"], ny=m["normal"]["y"], friction=sqrt(A.friction * B.friction),
                               restitution=max(A.restitution, B.restitution), points=pts, carried=False))
        # events
        cur_c = {c.key for c in contacts}
        prev_c = {c.key for c in st.contacts}
        for c in contacts:
            if c.key not in prev_c:
                events.append({"type": "begin", "a": c.a, "b": c.b})
        for c in st.contacts:
            if c.key not in cur_c:
                events.append({"type": "end", "a": c.a, "b": c.b})
        cur_s = {s["key"] for s in sensors}
        for s in sensors:
            events.append({"type": "stay" if s["key"] in prev_sensors else "enter", "sensor": s["sensor"], "other": s["other"]})
        for s in st.sensors:
            if s["key"] not in cur_s:
                events.append({"type": "exit", "sensor": s["sensor"], "other": s["other"]})

        # 3. pre-solve
        dt_ = dt
        solve = [c for c in contacts if not c.carried]
        rest_thr, slop, baum, max_bias = cfg["restitutionThreshold"], cfg["slop"], cfg["baumgarte"], cfg["maxBias"]
        for c in solve:
            A, B = by_id[c.a], by_id[c.b]
            tx, ty = c.ny, -c.nx
            for p in c.points:
                p.rax, p.ray, p.rbx, p.rby = p.x - A.x, p.y - A.y, p.x - B.x, p.y - B.y
                rnA = _cross(p.rax, p.ray, c.nx, c.ny)
                rnB = _cross(p.rbx, p.rby, c.nx, c.ny)
                rtA = _cross(p.rax, p.ray, tx, ty)
                rtB = _cross(p.rbx, p.rby, tx, ty)
                kN = A.inv_mass + B.inv_mass + A.inv_i * rnA * rnA + B.inv_i * rnB * rnB
                kT = A.inv_mass + B.inv_mass + A.inv_i * rtA * rtA + B.inv_i * rtB * rtB
                p.mass_n = 1 / kN if kN > 0 else 0
                p.mass_t = 1 / kT if kT > 0 else 0
                dvx = (B.vx - B.w * p.rby) - (A.vx - A.w * p.ray)
                dvy = (B.vy + B.w * p.rbx) - (A.vy + A.w * p.rax)
                vn = dvx * c.nx + dvy * c.ny
                bias_r = -c.restitution * vn if vn < -rest_thr else 0
                bias_p = min(max_bias, max(0, p.depth - slop) * baum / dt_)
                p.bias = max(bias_r, bias_p)
                px = p.jn * c.nx + p.jt * tx
                py = p.jn * c.ny + p.jt * ty
                _apply_p(A, px, py, p.rax, p.ray, -1)
                _apply_p(B, px, py, p.rbx, p.rby, 1)
        for j in st.joints:
            A, B = by_id[j.a], by_id[j.b]
            if A.asleep and awake(B):
                self._wake(A)
            if B.asleep and awake(A):
                self._wake(B)
        jlive = [j for j in st.joints if not (settled(by_id[j.a]) and settled(by_id[j.b]))]
        for j in jlive:
            self._prestep_joint(j, dt)

        # 4. velocity iterations
        for _ in range(cfg["velocityIterations"]):
            for j in jlive:
                self._solve_joint(j)
            for c in solve:
                A, B = by_id[c.a], by_id[c.b]
                tx, ty = c.ny, -c.nx
                for p in c.points:
                    dvx = (B.vx - B.w * p.rby) - (A.vx - A.w * p.ray)
                    dvy = (B.vy + B.w * p.rbx) - (A.vy + A.w * p.rax)
                    lam = -p.mass_t * (dvx * tx + dvy * ty)
                    max_f = c.friction * p.jn
                    nj = min(max_f, max(-max_f, p.jt + lam))
                    d = nj - p.jt
                    p.jt = nj
                    _apply_p(A, tx * d, ty * d, p.rax, p.ray, -1)
                    _apply_p(B, tx * d, ty * d, p.rbx, p.rby, 1)
                for p in c.points:
                    dvx = (B.vx - B.w * p.rby) - (A.vx - A.w * p.ray)
                    dvy = (B.vy + B.w * p.rbx) - (A.vy + A.w * p.rax)
                    lam = -p.mass_n * (dvx * c.nx + dvy * c.ny - p.bias)
                    nj = max(p.jn + lam, 0)
                    d = nj - p.jn
                    p.jn = nj
                    _apply_p(A, c.nx * d, c.ny * d, p.rax, p.ray, -1)
                    _apply_p(B, c.nx * d, c.ny * d, p.rbx, p.rby, 1)
        # 5. integrate positions
        for b in bodies:
            if b.type == "static" or b.asleep:
                continue
            mx, my = b.vx * dt, b.vy * dt
            if b.type == "dynamic" and not b.sensor and cfg["ccd"]:
                t = self._ccd_fraction(b, mx, my, bodies)
                if t < 1:
                    mx *= t
                    my *= t
            b.x += mx
            b.y += my
            b.angle += b.w * dt
        # 6. sleeping
        if cfg["sleep"]:
            live = [b for b in bodies if b.type == "dynamic" and not b.asleep]
            idx = {b.id: i for i, b in enumerate(live)}
            par = list(range(len(live)))

            def find(i):
                while par[i] != i:
                    par[i] = par[par[i]]
                    i = par[i]
                return i

            def uni(a, b):
                x, y = idx.get(a), idx.get(b)
                if x is None or y is None:
                    return
                rx, ry = find(x), find(y)
                if rx != ry:
                    par[max(rx, ry)] = min(rx, ry)

            for c in solve:
                uni(c.a, c.b)
            for j in jlive:
                uni(j.a, j.b)
            min_t: Dict[int, float] = {}
            ls2, as2 = cfg["linearSleep"] * cfg["linearSleep"], cfg["angularSleep"] * cfg["angularSleep"]
            for i, b in enumerate(live):
                still = b.allow_sleep and b.vx * b.vx + b.vy * b.vy < ls2 and b.w * b.w < as2
                b.sleep_t = b.sleep_t + dt if still else 0
                r = find(i)
                min_t[r] = min(min_t.get(r, INF), b.sleep_t)
            isl: Dict[int, int] = {}
            for i, b in enumerate(live):
                r = find(i)
                if min_t[r] >= cfg["timeToSleep"]:
                    if r not in isl:
                        isl[r] = st.next_island
                        st.next_island += 1
                    b.asleep = True
                    b.island = isl[r]
                    b.vx = b.vy = b.w = 0
        st.contacts = [NS(key=c.key, a=c.a, b=c.b, nx=c.nx, ny=c.ny, friction=c.friction, restitution=c.restitution,
                          points=[NS(x=p.x, y=p.y, depth=p.depth, jn=p.jn, jt=p.jt) for p in c.points]) for c in contacts]
        st.sensors = sensors
        st.time += dt
        st.steps += 1
        if self.on_event:
            for e in events:
                self.on_event(e)

    def _ccd_fraction(self, b, mx, my, bodies):
        cfg = self.config
        sh = placed(b)
        bb = C.bounds(sh)
        min_dim = min(bb["maxX"] - bb["minX"], bb["maxY"] - bb["minY"]) / 2
        d = sqrt(mx * mx + my * my)
        if d <= min_dim * 0.5:
            return 1
        best = None
        for o in bodies:
            if o.type != "static" or o.sensor or not C.can_collide(b, o):
                continue
            ob = C.bounds(placed(o))
            if not C.bounds_overlap({"minX": bb["minX"] + min(0, mx), "minY": bb["minY"] + min(0, my),
                                     "maxX": bb["maxX"] + max(0, mx), "maxY": bb["maxY"] + max(0, my)}, ob):
                continue
            h = C.shape_cast(sh, mx, my, placed(o))
            if h and not h["overlap"] and h["t"] < (best[0]["t"] if best else 1):
                best = (h, o)
        if not best:
            return 1
        h, o = best
        vn = b.vx * h["normal"]["x"] + b.vy * h["normal"]["y"]
        if vn < 0:
            e = max(b.restitution, o.restitution) * (1 if -vn > cfg["restitutionThreshold"] else 0)
            b.vx -= (1 + e) * vn * h["normal"]["x"]
            b.vy -= (1 + e) * vn * h["normal"]["y"]
        return h["t"] * (1 - 1e-6)

    # -- joints
    def _prestep_joint(self, j, dt):
        cfg, by_id = self.config, self._by_id
        A, B = by_id[j.a], by_id[j.b]
        ca, sa, cb, sb = math.cos(A.angle), math.sin(A.angle), math.cos(B.angle), math.sin(B.angle)
        j.rax = j.ax * ca - j.ay * sa
        j.ray = j.ax * sa + j.ay * ca
        j.rbx = j.bx * cb - j.by * sb
        j.rby = j.bx * sb + j.by * cb
        dx = B.x + j.rbx - A.x - j.rax
        dy = B.y + j.rby - A.y - j.ray
        if j.type == "revolute":
            iA, iB, mm = A.inv_i, B.inv_i, A.inv_mass + B.inv_mass
            k11 = mm + iA * j.ray * j.ray + iB * j.rby * j.rby
            k12 = -iA * j.rax * j.ray - iB * j.rbx * j.rby
            k22 = mm + iA * j.rax * j.rax + iB * j.rbx * j.rbx
            det = k11 * k22 - k12 * k12
            idet = 1 / det if det != 0 else 0
            j.m11, j.m12, j.m22 = k22 * idet, -k12 * idet, k11 * idet
            j.bias_x = dx * cfg["baumgarte"] / dt
            j.bias_y = dy * cfg["baumgarte"] / dt
            _apply_p(A, j.jx, j.jy, j.rax, j.ray, -1)
            _apply_p(B, j.jx, j.jy, j.rbx, j.rby, 1)
            return
        l = sqrt(dx * dx + dy * dy)
        j.ux = dx / l if l > 0 else 1
        j.uy = dy / l if l > 0 else 0
        Cc = l - j.length
        crA = _cross(j.rax, j.ray, j.ux, j.uy)
        crB = _cross(j.rbx, j.rby, j.ux, j.uy)
        k = A.inv_mass + B.inv_mass + A.inv_i * crA * crA + B.inv_i * crB * crB
        if j.stiffness > 0:
            j.gamma = 1 / (dt * (j.damping + dt * j.stiffness))
            j.bias = Cc * dt * j.stiffness * j.gamma
        else:
            j.gamma = 0
            j.bias = Cc * cfg["baumgarte"] / dt
        j.mass = 1 / (k + j.gamma) if k + j.gamma > 0 else 0
        _apply_p(A, j.ux * j.j, j.uy * j.j, j.rax, j.ray, -1)
        _apply_p(B, j.ux * j.j, j.uy * j.j, j.rbx, j.rby, 1)

    def _solve_joint(self, j):
        A, B = self._by_id[j.a], self._by_id[j.b]
        cx = (B.vx - B.w * j.rby) - (A.vx - A.w * j.ray)
        cy = (B.vy + B.w * j.rbx) - (A.vy + A.w * j.rax)
        if j.type == "revolute":
            rx, ry = -(cx + j.bias_x), -(cy + j.bias_y)
            ix = j.m11 * rx + j.m12 * ry
            iy = j.m12 * rx + j.m22 * ry
            j.jx += ix
            j.jy += iy
            _apply_p(A, ix, iy, j.rax, j.ray, -1)
            _apply_p(B, ix, iy, j.rbx, j.rby, 1)
            return
        imp = -j.mass * (cx * j.ux + cy * j.uy + j.bias + j.gamma * j.j)
        j.j += imp
        _apply_p(A, j.ux * imp, j.uy * imp, j.rax, j.ray, -1)
        _apply_p(B, j.ux * imp, j.uy * imp, j.rbx, j.rby, 1)

    # -- queries / state
    def energy(self):
        e, g = 0, self.config["gravity"]
        for b in self.st.bodies:
            if b.type == "dynamic" and b.inv_mass > 0:
                m = 1 / b.inv_mass
                e += 0.5 * m * (b.vx * b.vx + b.vy * b.vy) + (0.5 * (1 / b.inv_i) * b.w * b.w if b.inv_i > 0 else 0) \
                    - m * (g["x"] * b.x + g["y"] * b.y) * b.gravity_scale
        return e

    def raycast(self, ox, oy, dx, dy, max_t=1, include_sensors=False, layer=None, mask=None):
        best = None
        f = {"layer": layer, "mask": mask}
        for b in self.st.bodies:
            if (b.sensor and not include_sensors) or not C.can_collide(b, f):
                continue
            h = C.raycast(placed(b), ox, oy, dx, dy, max_t)
            if h and (best is None or h["t"] < best["t"]):
                best = dict(h, body=b.id)
        return best

    def query_aabb(self, bb):
        return [b.id for b in self.st.bodies if C.bounds_overlap(C.bounds(placed(b)), bb)]

    def query_point(self, x, y):
        return [b.id for b in self.st.bodies if C.contains_point(placed(b), x, y)]

    def snapshot(self):
        return copy.deepcopy((self.st, dict(self.config)))

    def restore(self, snap):
        st, cfg = copy.deepcopy(snap)
        self.st = st
        self.config.update(cfg)
        self._reindex()
        self.events = []


def create_world(opts: Optional[Dict[str, Any]] = None) -> World:
    return World(opts)


# ---- kinematic character controller ----------------------------------------------------------------------------
CHAR_DEFAULTS: Dict[str, Any] = {"gravity": 520, "jumpV": 200, "runSpeed": 60, "airSpeed": 60, "airAccel": 160, "hitW": 8,
                                 "hitH": 16, "stepHeight": 4, "snapDist": 4, "maxFall": 1000, "dropTime": 0.25}


def make_char_config(over: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    c = dict(CHAR_DEFAULTS)
    c.update(over or {})
    return c


def make_character(x=0, y=0) -> Dict[str, Any]:
    return {"x": x, "y": y, "vx": 0, "vy": 0, "face": 1, "mode": "ground", "layer": 0, "onPlatform": None, "landed": True,
            "t": 0, "dropT": 0, "ground": None}


def _open_ov(a0, a1, b0, b1):
    return a0 < b1 and b0 < a1


def _find_support(cs, b, hw, max_drop):
    best, bc = INF, None
    for c in cs:
        if c["kind"] == "oneway" and b["dropT"] > 0:
            continue
        if c["kind"] == "slope":
            if b["x"] < c["minX"] or b["x"] > c["maxX"]:
                continue
            s = C.surface_y(c, b["x"])
        else:
            if not _open_ov(b["x"] - hw, b["x"] + hw, c["minX"], c["maxX"]):
                continue
            s = c["minY"]
        if s >= b["y"] - 1e-6 and s <= b["y"] + max_drop + 1e-9 and s < best:
            best, bc = s, c
    return (best, bc) if bc else None


def _move_character(b, dx, dy, world, cfg, was_ground):
    hw, hh = cfg["hitW"] / 2, cfg["hitH"]
    landed, ground = False, None

    def q(m):
        return world.query({"minX": b["x"] - hw - m, "maxX": b["x"] + hw + m, "minY": b["y"] - hh - m, "maxY": b["y"] + m})

    nx = min(256, max(1, math.ceil(abs(dx) / hw)))
    sx = dx / nx
    step_h = cfg["stepHeight"]
    i = 0
    while i < nx and dx != 0:
        i += 1
        b["x"] += sx
        cs = q(abs(sx) + step_h)
        for c in cs:
            if c["kind"] != "solid" or not _open_ov(b["x"] - hw, b["x"] + hw, c["minX"], c["maxX"]) or not _open_ov(b["y"] - hh, b["y"], c["minY"], c["maxY"]):
                continue
            rise = b["y"] - c["minY"]
            if (was_ground or landed) and rise > 0 and rise <= step_h and not any(
                    o["kind"] == "solid" and _open_ov(b["x"] - hw, b["x"] + hw, o["minX"], o["maxX"]) and _open_ov(b["y"] - rise - hh, b["y"] - rise, o["minY"], o["maxY"]) for o in cs):
                b["y"] -= rise
            else:
                b["x"] = c["minX"] - hw if sx > 0 else c["maxX"] + hw
                b["vx"] = 0
        for c in cs:
            if c["kind"] != "slope" or b["x"] < c["minX"] or b["x"] > c["maxX"]:
                continue
            s = C.surface_y(c, b["x"])
            if not (b["y"] > s and b["y"] - hh < c["maxY"]):
                continue
            sl = c["slope"]
            grad = abs(sl["y1"] - sl["y0"]) / (sl["x1"] - sl["x0"])
            if b["y"] - s <= abs(sx) * grad + 1e-4:
                b["y"] = s
                landed, ground = True, c
            else:
                b["x"] = c["minX"] - hw if sx > 0 else c["maxX"] + hw
                b["vx"] = 0
    prev_y = b["y"]
    cs = q(abs(dy) + cfg["snapDist"] + 1)
    if dy < 0:
        cl = -INF
        for c in cs:
            if c["kind"] == "oneway":
                continue
            inx = (b["x"] >= c["minX"] and b["x"] <= c["maxX"]) if c["kind"] == "slope" else _open_ov(b["x"] - hw, b["x"] + hw, c["minX"], c["maxX"])
            if inx and prev_y - hh >= c["maxY"] - 1e-6 and prev_y + dy - hh < c["maxY"] and c["maxY"] > cl:
                cl = c["maxY"]
        if cl > -INF:
            b["y"] = cl + hh
            b["vy"] = 0
        else:
            b["y"] = prev_y + dy
        landed, ground = False, None
    else:
        f = _find_support(cs, b, hw, dy)
        if f:
            b["y"], landed, ground = f[0], True, f[1]
        else:
            b["y"] = prev_y + dy
    if not landed and was_ground and b["vy"] >= 0:
        f = _find_support(q(cfg["snapDist"] + 1), b, hw, cfg["snapDist"])
        if f:
            b["y"], landed, ground = f[0], True, f[1]
    b["landed"], b["ground"] = landed, ground
    if ground and ground["kind"] == "oneway":
        b["onPlatform"] = ground["id"] if ground.get("id") is not None else ground
    else:
        b["onPlatform"] = None
    if landed:
        b["vy"] = 0
        b["mode"] = "ground"
    else:
        b["mode"] = "air"


def step_character(b, inp, dt, world, cfg=CHAR_DEFAULTS):
    """Advance one character one fixed tick. ``inp`` = ``{dx, dy (up negative), jumpPressed}``. Returns the body dict."""
    def emit(n, extra=None):
        if cfg.get("emit"):
            cfg["emit"](n, b, extra)

    b["t"] += dt
    if b["dropT"] > 0:
        b["dropT"] -= dt
    dx, dy = int(inp.get("dx") or 0), int(inp.get("dy") or 0)
    was_ground = b["mode"] == "ground"
    if dx:
        b["face"] = dx
    if was_ground:
        if inp.get("jumpPressed") and dy > 0 and b["ground"] and b["ground"]["kind"] == "oneway":
            b["dropT"] = cfg["dropTime"]
            b["vy"] = 0
            b["vx"] = dx * cfg["runSpeed"]
            was_ground = False
        elif inp.get("jumpPressed"):
            b["vy"] = -cfg["jumpV"]
            b["vx"] = dx * cfg["airSpeed"]
            b["mode"] = "air"
            b["landed"] = False
            b["ground"] = None
            b["onPlatform"] = None
            emit("jump")
            return b
        else:
            b["vx"] = dx * cfg["runSpeed"]
            b["vy"] = 0
    if not was_ground:
        if dx:
            target, a = dx * cfg["airSpeed"], cfg["airAccel"] * dt
            b["vx"] = min(target, b["vx"] + a) if b["vx"] < target else max(target, b["vx"] - a)
        b["vy"] = min(cfg["maxFall"], b["vy"] + cfg["gravity"] * dt)
    impact, was = b["vy"], b["mode"]
    _move_character(b, b["vx"] * dt, b["vy"] * dt, world, cfg, was_ground)
    if b["mode"] == "ground" and (was == "air" or not was_ground):
        if impact > 140:
            emit("hardland")
        emit("land", b["ground"])
    return b
