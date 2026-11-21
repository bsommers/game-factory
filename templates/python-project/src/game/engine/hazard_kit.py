"""Behaviour registry, contact resolution and ready-made hazard patterns (port of ``hazard-kit.js``).

Entities are plain dicts (feet-anchored box ``x, y, w, h`` plus ``vx, t, st, frame, lethal, solidTop, dead,
layer, ...``) so they serialise to JSON and match the spec vectors key for key. ``g`` is the game facade, also a
dict: ``{"spawn": fn(kind, props), "rng": Pcg32?, "emit": fn(name, data)?, "width": n?, "time": s?}``.
Nothing here touches ``random`` or the clock; only ``tauntingBoss`` uses ``g["rng"]`` (spec PCG32).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional

Entity = Dict[str, Any]
Game = Dict[str, Any]


@dataclass
class Behaviour:
    """``init(e, g)`` runs after construction; ``update(e, dt, g)`` each tick; ``on_touch(e, player, g)`` may
    return a result dict that overrides the default contact result."""

    init: Optional[Callable[[Entity, Game], None]] = None
    update: Optional[Callable[[Entity, float, Game], None]] = None
    on_touch: Optional[Callable[[Entity, Any, Game], Optional[Dict[str, Any]]]] = None


class Registry:
    """Maps kind name -> (behaviour, defaults) and spawns/updates entities."""

    def __init__(self) -> None:
        self._defs: Dict[str, tuple] = {}
        self._next_id = 1

    def register(self, kind: str, behaviour: Behaviour, defaults: Optional[Mapping[str, Any]] = None) -> "Registry":
        self._defs[kind] = (behaviour, dict(defaults or {}))
        return self

    def has(self, kind: str) -> bool:
        return kind in self._defs

    def kinds(self) -> List[str]:
        return list(self._defs)

    def spawn(self, kind: str, props: Optional[Mapping[str, Any]] = None, g: Optional[Game] = None) -> Entity:
        """Make an entity (calls ``init`` last). The caller stores it. Overlay: base < kind defaults < props."""
        d = self._defs.get(kind)
        if d is None:
            raise KeyError("hazard-kit: unknown kind " + kind)
        b, defaults = d
        props = props or {}
        e: Entity = {"id": self._next_id, "kind": kind, "x": 0, "y": 0, "w": 8, "h": 8, "vx": 0, "t": 0, "frame": 0,
                     "lethal": None, "solidTop": False, "dead": False, "layer": "surface"}
        self._next_id += 1
        e.update(defaults)
        e.update(props)
        e["st"] = {**(defaults.get("st") or {}), **(props.get("st") or {})}
        if b.init:
            b.init(e, g if g is not None else {})
        return e

    def update(self, ents: List[Entity], dt: float, g: Optional[Game] = None) -> None:
        """Tick every live entity in list order. Entities appended during the pass (spawners) are visited
        in the same pass (index loop against the growing length, like JS array iteration)."""
        g = g if g is not None else {}
        i = 0
        while i < len(ents):
            e = ents[i]
            i += 1
            if e.get("dead"):
                continue
            d = self._defs.get(e["kind"])
            if d and d[0].update:
                d[0].update(e, dt, g)

    def touch(self, e: Entity, player: Any, g: Game) -> Optional[Dict[str, Any]]:
        d = self._defs.get(e["kind"])
        return d[0].on_touch(e, player, g) if d and d[0].on_touch else None

    def reset(self) -> None:
        self._next_id = 1


def create_registry() -> Registry:
    return Registry()


def _get(o: Any, k: str, default: Any = None) -> Any:
    if isinstance(o, Mapping):
        return o.get(k, default)
    return getattr(o, k, default)


def _nn(v: Any, default: Any) -> Any:
    """JS ``??``."""
    return default if v is None else v


def overlaps(p: Any, hw: float, hh: float, e: Entity) -> bool:
    """Feet-anchored player box (half-width ``hw``, height ``hh``) vs entity box; all comparisons strict."""
    px, py = _get(p, "x"), _get(p, "y")
    return (px + hw > e["x"] - e["w"] / 2 and px - hw < e["x"] + e["w"] / 2
            and py > e["y"] - e["h"] and py - hh < e["y"])


def resolve_contacts(registry: Registry, player: Any, ents: Iterable[Entity], opts: Optional[Mapping[str, Any]] = None,
                     g: Optional[Game] = None) -> List[Dict[str, Any]]:
    """Ordered results: ``{type:'kill',ent,kind}``, ``{type:'points',ent,amount}``, ``{type:'collect',ent}`` or a
    custom ``on_touch`` result. Options: hitW (8), hitH (16), hitCooldown (0.6), pointsPenalty (-100)."""
    opts = opts or {}
    g = g if g is not None else {}
    hw = _nn(opts.get("hitW"), 8) / 2
    hh = _nn(opts.get("hitH"), 16)
    cd = _nn(opts.get("hitCooldown"), 0.6)
    out: List[Dict[str, Any]] = []
    plr_layer = _get(player, "layer")
    for e in ents:
        if e.get("dead"):
            continue
        if e.get("layer") and plr_layer is not None and e["layer"] != plr_layer:
            continue
        if not overlaps(player, hw, hh, e):
            continue
        custom = registry.touch(e, player, g)
        if custom:
            out.append({"ent": e, **custom})
            continue
        if e.get("collect"):
            out.append({"type": "collect", "ent": e})
            continue
        lethal = e.get("lethal")
        if lethal == "life":
            out.append({"type": "kill", "ent": e, "kind": e["kind"]})
        elif lethal == "points":
            last = _nn(e["st"].get("hitT"), -math.inf)
            now = _nn(g.get("time"), e["t"])
            if now - last >= cd:
                e["st"]["hitT"] = now
                out.append({"type": "points", "ent": e, "amount": _nn(_nn(e.get("points"), opts.get("pointsPenalty")), -100)})
    return out


def solid_top_under(ents: Iterable[Entity], x: float, y: float, prev_y: float, slack: Optional[float] = 2) -> Optional[Entity]:
    """Entity whose solid top a body falling from ``prev_y`` to ``y`` lands on, or None."""
    slack = _nn(slack, 2)
    for e in ents:
        if e.get("dead") or not e.get("solidTop"):
            continue
        top = _nn(e.get("topY"), e["y"] - e["h"])
        if abs(x - e["x"]) <= e["w"] / 2 + slack and prev_y <= top + 1 and y >= top:
            return e
    return None


def solid_top_carrying(ents: Iterable[Entity], x: float, y: float, slack: Optional[float] = 2) -> Optional[Entity]:
    """Entity currently carrying a body standing at ``(x, y)``."""
    slack = _nn(slack, 2)
    for e in ents:
        if e.get("dead") or not e.get("solidTop"):
            continue
        if abs(x - e["x"]) <= e["w"] / 2 + slack and abs(y - _nn(e.get("topY"), e["y"] - e["h"])) <= 3:
            return e
    return None


def _advance(e: Entity, dx: float, frame_px: float, frames: int) -> None:
    e["st"]["dist"] = _nn(e["st"].get("dist"), 0) + abs(dx)
    e["frame"] = math.floor(e["st"]["dist"] / frame_px) % frames


# ---- patterns: each returns a Behaviour --------------------------------------------------------
def patroller(w: float = 12, h: float = 8, speed: float = 20, minX: float = 0, maxX: float = 320,
              lethal: Optional[str] = "life", framePx: float = 4, frames: int = 2) -> Behaviour:
    """Walks between ``minX`` and ``maxX``, turning at the ends (scorpion, guard)."""

    def init(e: Entity, g: Game) -> None:
        e.update(w=w, h=h, lethal=lethal, solidTop=False)
        e["st"]["minX"] = _nn(e["st"].get("minX"), minX)
        e["st"]["maxX"] = _nn(e["st"].get("maxX"), maxX)
        e["dir"] = 1 if e.get("dir") == 1 else -1
        e["x"] = min(e["st"]["maxX"], max(e["st"]["minX"], e["x"]))
        e["vx"] = e["dir"] * _nn(e.get("speed"), speed)

    def update(e: Entity, dt: float, g: Game) -> None:
        e["t"] += dt
        dx = e["vx"] * dt
        e["x"] += dx
        if e["x"] <= e["st"]["minX"]:
            e["x"] = e["st"]["minX"]
            e["dir"] = 1
        if e["x"] >= e["st"]["maxX"]:
            e["x"] = e["st"]["maxX"]
            e["dir"] = -1
        e["vx"] = e["dir"] * _nn(e.get("speed"), speed)
        _advance(e, dx, framePx, frames)

    return Behaviour(init, update)


def roller(w: float = 14, h: float = 8, speed: float = 46, lethal: Optional[str] = "points", framePx: float = 6,
           frames: int = 4, hop: Optional[Mapping[str, float]] = None, width: float = 320) -> Behaviour:
    """Rolls in one direction and wraps at ``width`` (rolling log). ``hop={period,len,height}`` adds hops."""

    def init(e: Entity, g: Game) -> None:
        e.update(w=w, h=h, lethal=lethal, solidTop=False)
        e["vx"] = _nn(e.get("dir"), -1) * _nn(e.get("speed"), speed)
        e["st"]["baseY"] = e["y"]

    def update(e: Entity, dt: float, g: Game) -> None:
        e["t"] += dt
        dx = e["vx"] * dt
        e["x"] += dx
        if e["x"] + e["w"] / 2 < 0:
            e["x"] += width + e["w"]
        if e["x"] - e["w"] / 2 > width:
            e["x"] -= width + e["w"]
        if hop:
            ph = math.fmod(e["t"], hop["period"])
            k = math.sin((math.pi * ph) / hop["len"]) if ph < hop["len"] else 0
            e["y"] = e["st"]["baseY"] - hop["height"] * k
        _advance(e, dx, framePx, frames)

    return Behaviour(init, update)


def stationary(w: float = 8, h: float = 12, lethal: Optional[str] = "life", frames: int = 3, fps: float = 8) -> Behaviour:
    """Stationary hazard with a flicker/sway animation (fire, snake)."""

    def init(e: Entity, g: Game) -> None:
        e.update(w=w, h=h, lethal=lethal, solidTop=False, vx=0)
        e["st"]["phase"] = _nn(e["st"].get("phase"), 0)

    def update(e: Entity, dt: float, g: Game) -> None:
        e["t"] += dt
        e["frame"] = ((math.floor((e["t"] + e["st"]["phase"]) * fps) % frames) + frames) % frames

    return Behaviour(init, update)


def cycler(w: float = 22, h: float = 10, period: float = 2.8, openFrac: float = 0.45, openLethal: Optional[str] = "life",
          closedSolid: bool = True) -> Behaviour:
    """Open/closed cycle (crocodile, spike trap). Closed = solidTop and harmless; open = lethal.
    Stagger neighbours with ``e['st']['phase']``. A pure function of ``e['t']``."""

    def apply(e: Entity) -> None:
        p = e["st"]["period"]
        cyc = math.fmod(math.fmod(e["t"] + e["st"]["phase"], p) + p, p)
        is_open = cyc >= p * (1 - e["st"]["openFrac"])
        e["frame"] = 1 if is_open else 0
        e["open"] = is_open
        e["solidTop"] = bool(closedSolid and not is_open)
        e["lethal"] = openLethal if is_open else None

    def init(e: Entity, g: Game) -> None:
        e.update(w=w, h=h, vx=0)
        st = e["st"]
        st["phase"] = _nn(st.get("phase"), 0)
        st["period"] = _nn(st.get("period"), period)
        st["openFrac"] = _nn(st.get("openFrac"), openFrac)
        apply(e)

    def update(e: Entity, dt: float, g: Game) -> None:
        e["t"] += dt
        apply(e)

    return Behaviour(init, update)


def spawner(every: float = 4, kind: Optional[str] = None, makeProps: Optional[Callable[..., Mapping[str, Any]]] = None,
            first: Optional[float] = None) -> Behaviour:
    """Spawns ``kind`` every ``every`` seconds via ``g['spawn'](kind, makeProps(e, g))``."""
    if every <= 0:
        raise ValueError("spawner: every must be > 0")
    make = makeProps or (lambda e, g: {})

    def init(e: Entity, g: Game) -> None:
        e["w"] = _nn(e.get("w"), 1)
        e["h"] = _nn(e.get("h"), 1)
        e["st"]["timer"] = _nn(first, every)

    def update(e: Entity, dt: float, g: Game) -> None:
        e["t"] += dt
        e["st"]["timer"] -= dt
        while e["st"]["timer"] <= 0:
            e["st"]["timer"] += every
            if g.get("spawn"):
                g["spawn"](kind, make(e, g))

    return Behaviour(init, update)


def tauntingBoss(every: float = 4, taunts: Optional[List[str]] = None, dur: float = 2.5, throwKind: Optional[str] = None,
                 throwProps: Optional[Callable[..., Mapping[str, Any]]] = None, sfx: Optional[str] = None) -> Behaviour:
    """Every ``every`` seconds picks a line (``g['rng'].pick`` if present, else round-robin), emits ``taunt`` and
    optionally throws a hazard. Fires at most once per update."""
    lines = taunts if taunts is not None else ["HA HA!"]
    props_fn = throwProps or (lambda e, g: {})

    def init(e: Entity, g: Game) -> None:
        e["st"]["timer"] = _nn(e["st"].get("timer"), every)
        e["st"]["said"] = 0

    def update(e: Entity, dt: float, g: Game) -> None:
        e["t"] += dt
        e["st"]["timer"] -= dt
        if e["st"]["timer"] > 0:
            return
        e["st"]["timer"] += every
        rng = g.get("rng")
        text = rng.pick(lines) if rng else lines[e["st"]["said"] % len(lines)]
        e["st"]["said"] += 1
        e["st"]["last"] = text
        if g.get("emit"):
            g["emit"]("taunt", {"text": text, "dur": dur, "ent": e})
            if sfx:
                g["emit"]("sfx", {"name": sfx})
        if throwKind and g.get("spawn"):
            g["spawn"](throwKind, props_fn(e, g))

    return Behaviour(init, update)
