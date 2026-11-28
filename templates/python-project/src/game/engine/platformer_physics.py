"""Fixed-step 2D platformer core (port of ``platformer-physics.js``; spec/platformer-physics.md).

Coordinates: x right, y DOWN. A body's ``(x, y)`` is its feet centre; the hitbox is ``hit_w`` wide and
``hit_h`` tall above y. All numbers are f64 (Python floats). No RNG, no clock.

The *world* is plain data (a dict, loadable from JSON, spec key names)::

    {"groundY": 160, "pits": [{"x0", "x1", "kind"?, "drop"?}], "platforms": [{"id"?, "x", "y", "w", "dx"?, "dy"?}],
     "ladders": [{"x", "top", "bottom", "w"?}], "ropes": [Pendulum], "bounds": {"minY"?}, "t"?: float}
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, NamedTuple, Optional, Union

World = Dict[str, Any]
Emit = Callable[[str, "Body", Any], None]


@dataclass
class Config:
    """Physics tuning (spec DEFAULTS). ``stride`` may be a number or ``fn(body) -> number``."""

    gravity: float = 520
    jump_v: float = 200
    run_speed: float = 60
    air_speed: float = 60
    air_accel: float = 160
    climb_speed: float = 40
    hit_w: float = 8
    hit_h: float = 16
    grab_r: float = 8
    grab_cooldown: float = 0.35
    swing_blend: float = 0.12
    edge_l: float = 4
    edge_r: float = 316
    stride: Union[float, Callable[["Body"], float]] = 1
    emit: Optional[Emit] = None


def make_config(**over: Any) -> Config:
    """``Config`` with overrides, e.g. ``make_config(gravity=600)``."""
    return Config(**over)


DEFAULTS = Config()


def jump_range(cfg: Config = DEFAULTS) -> float:
    """Max horizontal distance a run-jump covers on flat ground (use for pit-width fairness checks)."""
    return (cfg.run_speed * 2 * cfg.jump_v) / cfg.gravity


def jump_height(cfg: Config = DEFAULTS) -> float:
    """Apex height of a jump."""
    return (cfg.jump_v * cfg.jump_v) / (2 * cfg.gravity)


@dataclass
class Input:
    """One tick of player intent. ``dy`` is negative for up."""

    dx: int = 0
    dy: int = 0
    jump_pressed: bool = False


@dataclass
class Body:
    """Kinematic body. ``mode`` is 'ground' | 'air' | 'climb' | 'swing' | 'dead'."""

    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    face: int = 1
    mode: str = "ground"
    layer: int = 0
    on_platform: Any = None
    landed: bool = True
    grab_cd: float = 0.0
    swing_k: float = 0.0
    off_x: float = 0.0
    off_y: float = 0.0
    rope: Optional["Pendulum"] = None
    t: float = 0.0
    death_kind: Optional[str] = None
    ladder: Optional[Dict[str, Any]] = None


def make_body(x: float = 0, y: float = 0) -> Body:
    """New grounded body at feet position ``(x, y)``."""
    return Body(x=x, y=y)


class Tip(NamedTuple):
    x: float
    y: float
    a: float


class Vec(NamedTuple):
    x: float
    y: float


class Pendulum:
    """Rope / vine: ``angle = amp * sin(2*pi*t/period)``; the tip hangs ``length`` below ``(px, py)``."""

    def __init__(self, px: float, py: float, length: float, amp: float, period: float) -> None:
        self.px, self.py, self.len, self.amp, self.period = px, py, length, amp, period
        self.w = (2 * math.pi) / period

    def angle(self, t: float) -> float:
        return self.amp * math.sin(self.w * t)

    def tip(self, t: float) -> Tip:
        a = self.angle(t)
        return Tip(self.px + math.sin(a) * self.len, self.py + math.cos(a) * self.len, a)

    def tip_vel(self, t: float) -> Vec:
        a = self.angle(t)
        om = self.amp * self.w * math.cos(self.w * t)
        return Vec(self.len * om * math.cos(a), -self.len * om * math.sin(a))


def pendulum(px: float, py: float, len: float, amp: float, period: float) -> Pendulum:  # noqa: A002
    """Factory mirroring the JS API (keyword ``len`` kept for parity with rule tables)."""
    return Pendulum(px, py, len, amp, period)


class MovingPlatform(dict):  # type: ignore[type-arg]
    """Ping-pong platform on the segment ``(x0, y0)-(x1, y1)``; a dict so it drops into ``world['platforms']``.

    Call :meth:`update` once per tick; ``dx``/``dy`` hold that tick's delta (used to carry riders).
    """

    def __init__(self, id: Any = None, x0: float = 0, y0: float = 0, x1: Optional[float] = None,  # noqa: A002
                 y1: Optional[float] = None, w: float = 24, speed: float = 20, phase: float = 0) -> None:
        super().__init__()
        x1 = x0 if x1 is None else x1
        y1 = y0 if y1 is None else y1
        self._x0, self._y0, self._x1, self._y1, self._speed = x0, y0, x1, y1, speed
        self._span = math.hypot(x1 - x0, y1 - y0) or 1.0
        self.update_fields(id=id, x=x0, y=y0, w=w, dx=0, dy=0, t=phase)
        self._place()

    def update_fields(self, **kw: Any) -> None:
        dict.update(self, kw)

    def _place(self) -> None:
        span = self._span
        d = math.fmod(self["t"] * self._speed, 2 * span)  # C fmod, not Python %
        u = (d if d <= span else 2 * span - d) / span
        self["x"] = self._x0 + (self._x1 - self._x0) * u
        self["y"] = self._y0 + (self._y1 - self._y0) * u

    def update(self, dt: float) -> None:  # type: ignore[override]
        ox, oy = self["x"], self["y"]
        self["t"] += dt
        self._place()
        self["dx"] = self["x"] - ox
        self["dy"] = self["y"] - oy


# ---- support queries ---------------------------------------------------------------------------
def pit_at(world: World, x: float) -> Optional[Dict[str, Any]]:
    """First pit with ``x0 < x < x1`` (strict) or None."""
    for q in world.get("pits") or ():
        if x > q["x0"] and x < q["x1"]:
            return q
    return None


def ladder_at(world: World, x: float, feet_y: float) -> Optional[Dict[str, Any]]:
    """First ladder within reach of ``(x, feet_y)``."""
    for l in world.get("ladders") or ():
        w = l.get("w")
        if abs(x - l["x"]) <= (8 if w is None else w) / 2 and feet_y >= l["top"] - 1 and feet_y <= l["bottom"] + 1:
            return l
    return None


def _platform_under(world: World, x: float, y: float, prev_y: float) -> Optional[Dict[str, Any]]:
    for p in world.get("platforms") or ():
        if abs(x - p["x"]) <= p["w"] / 2 and prev_y <= p["y"] + 1 and y >= p["y"]:
            return p
    return None


def _platform_carrying(world: World, x: float, y: float) -> Optional[Dict[str, Any]]:
    for p in world.get("platforms") or ():
        if abs(x - p["x"]) <= p["w"] / 2 and abs(y - p["y"]) <= 3:
            return p
    return None


def support_at(world: World, x: float, y: float) -> Optional[Dict[str, Any]]:
    """Walkable support under a standing body: ``{"y", "platform"?}`` or None (nothing: it falls)."""
    p = _platform_carrying(world, x, y)
    if p is not None:
        return {"y": p["y"], "platform": p}
    if pit_at(world, x) is not None:
        return None
    return {"y": world["groundY"]}


def _emit(cfg: Config, name: str, b: Body, extra: Any = None) -> None:
    if cfg.emit:
        cfg.emit(name, b, extra)


def _enter_pit(b: Body, q: Dict[str, Any], world: World, cfg: Config) -> None:
    if q.get("drop"):
        b.vx = 0
        b.vy = 0
        b.y = world["groundY"]
        b.landed = True
        _emit(cfg, "drop", b, q)
        return
    b.mode = "dead"
    kind = q.get("kind")
    b.death_kind = "pit" if kind is None else kind
    b.vx = 0
    b.vy = 0
    b.y = world["groundY"]
    _emit(cfg, "death", b, q)


def _ballistic(b: Body, dt: float, dx: int, world: World, cfg: Config) -> None:
    prev_y = b.y
    if dx:
        target = dx * cfg.air_speed
        a = cfg.air_accel * dt
        b.vx = min(target, b.vx + a) if b.vx < target else max(target, b.vx - a)
    b.vy += cfg.gravity * dt
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.landed = False
    b.on_platform = None
    min_y = (world.get("bounds") or {}).get("minY")
    if min_y is not None and b.y - cfg.hit_h < min_y:
        b.y = min_y + cfg.hit_h
        if b.vy < 0:
            b.vy = 0
    if b.vy >= 0:
        p = _platform_under(world, b.x, b.y, prev_y)
        if p is not None:
            b.y = p["y"]
            b.vy = 0
            b.vx *= 0.5
            b.landed = True
            b.on_platform = p.get("id") if p.get("id") is not None else p
            _emit(cfg, "land", b, p)
            return
    if b.vy >= 0 and b.y >= world["groundY"]:
        q = pit_at(world, b.x)
        if q is not None:
            _enter_pit(b, q, world, cfg)
            return
        if b.vy > 140:
            _emit(cfg, "hardland", b)
        b.y = world["groundY"]
        b.vy = 0
        b.landed = True
        _emit(cfg, "land", b)


def _try_grab(b: Body, world: World, t: float, cfg: Config) -> bool:
    if b.grab_cd > 0:
        return False
    for r in world.get("ropes") or ():
        tip = r.tip(t)
        hx, hy = b.x, b.y - cfg.hit_h
        if math.hypot(tip.x - hx, tip.y - hy) <= cfg.grab_r:
            b.mode = "swing"
            b.rope = r
            b.swing_k = 1
            b.off_x = hx - tip.x
            b.off_y = hy - tip.y
            b.vx = 0
            b.vy = 0
            _emit(cfg, "grab", b, tip)
            return True
    return False


def _step_ground(b: Body, inp: Input, dt: float, world: World, cfg: Config) -> None:
    dx, dy = int(inp.dx), int(inp.dy)
    lad = ladder_at(world, b.x, b.y)
    if lad is not None and ((dy < 0 and b.y > lad["top"] + 1) or (dy > 0 and b.y < lad["bottom"] - 1)):
        b.mode = "climb"
        b.x = lad["x"]
        b.vx = 0
        b.vy = 0
        b.ladder = lad
        _emit(cfg, "climb", b, lad)
        return
    if inp.jump_pressed:
        b.vy = -cfg.jump_v
        b.vx = dx * cfg.air_speed
        if dx:
            b.face = dx
        b.mode = "air"
        b.on_platform = None
        b.landed = False
        _emit(cfg, "jump", b)
        return
    b.vx = dx * cfg.run_speed
    if dx:
        b.face = dx
    prev_x = b.x
    b.x += b.vx * dt
    carry = _platform_carrying(world, prev_x, b.y)  # uses the PRE-move x
    if carry is not None:
        b.x += carry.get("dx") or 0
        b.y += carry.get("dy") or 0
    sup = support_at(world, b.x, b.y)
    if sup is None:
        b.mode = "air"
        b.vy = 0
        b.on_platform = None
    else:
        b.y = sup["y"]
        p = sup.get("platform")
        b.on_platform = None if p is None else (p["id"] if p.get("id") is not None else p)


def _step_air(b: Body, inp: Input, dt: float, world: World, cfg: Config) -> None:
    dx = int(inp.dx)
    if dx:
        b.face = dx
    _ballistic(b, dt, dx, world, cfg)
    if b.mode != "air":
        return
    if b.landed:
        b.mode = "ground"
        return
    t = world.get("t")
    _try_grab(b, world, b.t if t is None else t, cfg)


def _step_swing(b: Body, inp: Input, dt: float, world: World, cfg: Config) -> None:
    r = b.rope
    if r is None:
        b.mode = "air"
        return
    t = world.get("t")
    t = b.t if t is None else t
    tip = r.tip(t)
    tv = r.tip_vel(t)
    b.swing_k = max(0, b.swing_k - dt / cfg.swing_blend)
    b.x = tip.x + b.off_x * b.swing_k
    b.y = tip.y + cfg.hit_h + b.off_y * b.swing_k
    if abs(tv.x) > 12:
        b.face = 1 if tv.x > 0 else -1
    b.vx = tv.x
    b.vy = tv.y
    if inp.jump_pressed:
        b.mode = "air"
        b.rope = None
        b.grab_cd = cfg.grab_cooldown
        b.landed = False
        _emit(cfg, "release", b)
        return
    if b.y >= world["groundY"] - 2 and pit_at(world, b.x) is None:
        b.mode = "ground"
        b.rope = None
        b.y = world["groundY"]
        b.vx = 0
        b.vy = 0
        b.grab_cd = cfg.grab_cooldown
        _emit(cfg, "land", b)


def _step_climb(b: Body, inp: Input, dt: float, world: World, cfg: Config) -> None:
    dy = int(inp.dy)
    l = b.ladder
    if l is None:
        b.mode = "air"
        return
    if dy:
        b.y += dy * cfg.climb_speed * dt
    if b.y <= l["top"]:
        b.y = l["top"]
        b.mode = "ground"
        b.ladder = None
        _emit(cfg, "climbEnd", b, "top")
    elif b.y >= l["bottom"]:
        b.y = l["bottom"]
        b.mode = "ground"
        b.ladder = None
        _emit(cfg, "climbEnd", b, "bottom")


def step_body(b: Body, inp: Input, dt: float, world: World, cfg: Config = DEFAULTS) -> Body:
    """Advance one body by one fixed tick and return it. ``world['t']`` (seconds) drives ropes, else ``b.t``."""
    b.t += dt
    if b.grab_cd > 0:
        b.grab_cd -= dt
    if b.mode == "ground":
        _step_ground(b, inp, dt, world, cfg)
    elif b.mode == "air":
        _step_air(b, inp, dt, world, cfg)
    elif b.mode == "swing":
        _step_swing(b, inp, dt, world, cfg)
    elif b.mode == "climb":
        _step_climb(b, inp, dt, world, cfg)
    return b


# ---- screen-edge transitions -------------------------------------------------------------------
def wrap_index(i: int, n: int) -> int:
    """Floor-mod wrap into ``[0, n)``."""
    return ((i % n) + n) % n


class Transition(NamedTuple):
    dir: int
    idx: int
    x: float


def edge_transition(b: Body, idx: int, count: int, cfg: Config = DEFAULTS) -> Optional[Transition]:
    """If the body left a screen edge, the new screen index and entry x for a circular world of ``count`` screens."""
    if b.mode not in ("ground", "air"):
        return None
    d = -1 if b.x < cfg.edge_l else (1 if b.x > cfg.edge_r else 0)
    if not d:
        return None
    stride = cfg.stride(b) if callable(cfg.stride) else cfg.stride
    return Transition(d, wrap_index(idx + d * stride, count), cfg.edge_l + 1 if d > 0 else cfg.edge_r - 1)


def apply_transition(b: Body, tr: Optional[Transition]) -> Body:
    """Apply an :func:`edge_transition` result to the body."""
    if tr is not None:
        b.x = tr.x
    return b
