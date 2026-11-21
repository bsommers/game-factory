"""Seeded, deterministic, CIRCULAR screen generator + fairness validator (port of ``world-gen.js``).

Driven by a declarative, JSON-shaped *rule table* (spec/world-gen.md). Its RNG is the legacy mulberry32
(:class:`game.engine.rng.Mulberry32`), NOT PCG32 -- that is part of the spec so worlds match across languages.
Callables are allowed in a rule table as escape hatches (``slots[tag]['build']``, ``collectibles['exclude'|'prefer']``,
``rules['finish']``); :func:`with_fixtures` turns the declarative vector fixtures into such callables.
"""
from __future__ import annotations

import copy
import math
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional, Sequence

from .rng import Mulberry32, js_round

Rules = Dict[str, Any]
Screen = Dict[str, Any]


def create_rng(seed: int = 1) -> Mulberry32:
    """The legacy world-gen stream."""
    return Mulberry32(seed)


def _nn(v: Any, default: Any) -> Any:
    return default if v is None else v


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def wrap(i: int, n: int) -> int:
    """Floor-mod wrap into ``[0, n)``."""
    return ((i % n) + n) % n


def circ_dist(a: int, b: int, n: int) -> int:
    """Circular distance between screens ``a`` and ``b`` in a world of ``n``."""
    d = wrap(a - b, n)
    return min(d, n - d)


def ramp_of(i: int, start: int, n: int) -> float:
    """Difficulty 0 at ``start`` .. 1 at the opposite side of the circle."""
    return circ_dist(i, start, n) / (n / 2)


def lerp_val(v: Any, t: float) -> float:
    """Interpolate ``None`` -> 0, a number -> itself, ``{from,to,base,perT}`` -> value at ``t``."""
    if v is None:
        return 0
    if _is_num(v):
        return v
    a = _nn(_nn(v.get("from"), v.get("base")), 0)
    return a + (_nn(v.get("to"), a) - a) * t + _nn(v.get("perT"), 0) * t


def shuffle(arr: List[Any], rng: Mulberry32) -> List[Any]:
    """In-place Fisher-Yates using ``rng.randint`` (mulberry32 flavour)."""
    for i in range(len(arr) - 1, 0, -1):
        j = rng.randint(0, i)
        arr[i], arr[j] = arr[j], arr[i]
    return arr


def pick_weighted(rng: Mulberry32, items: Sequence[Sequence[Any]]) -> Any:
    """Pick ``v`` from ``[[v, weight], ...]``; falls back to the last item."""
    tot = 0
    for _, w in items:
        tot += w
    r = rng.next_float() * tot
    for v, w in items:
        r -= w
        if r < 0:
            return v
    return items[-1][0]


def js_str(x: Any) -> str:
    """Render a number the way JS template strings do (integers without ``.0``)."""
    if isinstance(x, float):
        if x.is_integer() and abs(x) < 1e21:
            return str(int(x))
        return repr(x)
    return str(x)


def _block_slots(rules: Rules, b: int) -> Dict[int, str]:
    bl = rules.get("blocks") or {}
    size = _nn(bl.get("size"), 12)
    fixed = {int(k): v for k, v in (bl.get("fixed") or {}).items()}
    deck = bl.get("deck") or ["plain"]
    rng = create_rng(_nn(rules.get("seed"), 1) * 7 + 7001 + b * 31)
    free = [p for p in range(size) if p not in fixed]
    cards = shuffle([deck[k % len(deck)] for k in range(len(free))], rng)
    m: Dict[int, str] = dict(fixed)
    for k, p in enumerate(free):
        m[p] = cards[k]
    first = bl.get("firstSlot")
    if b == 0 and first and m.get(0) != first:
        # swap the first FREE POSITION holding firstSlot into position 0
        k = next((p for p in free if m[p] == first), None)
        if k is not None:
            m[0], m[k] = m[k], m.get(0)
    return m


def free_xs(def_: Screen, rules: Rules, *, edge_clear: Optional[float] = None, gap: Optional[float] = None,
            extra: Sequence[float] = (), lo: float = 0, hi: float = 320) -> List[float]:
    """Free x positions honouring zones (padded), existing static items (``gap``) and edges."""
    sp = rules.get("spacing") or {}
    ec = _nn(edge_clear, _nn(sp.get("edgeClear"), 36))
    g = _nn(gap, _nn(sp.get("gap"), 48))
    step = _nn(sp.get("step"), 4)
    out: List[float] = []
    x = lo + ec
    while x <= hi - ec:
        ok = True
        for z in def_["zones"]:
            if x > z["x0"] - ec and x < z["x1"] + ec:
                ok = False
                break
        if ok:
            for h in def_["items"]:
                if h.get("x") is not None and abs(h["x"] - x) < g:
                    ok = False
                    break
        if ok:
            for e in extra:
                if abs(e - x) < g:
                    ok = False
                    break
        if ok:
            out.append(x)
        x += step
    return out


def _apply_place(def_: Screen, rule: Dict[str, Any], ctx: Any) -> None:
    rng, t = ctx.rng, ctx.t
    ch = lerp_val(_nn(rule.get("chance"), 1), t)
    if rule.get("minT") is not None and t < rule["minT"]:
        return
    if rule.get("maxT") is not None and t > rule["maxT"]:
        return
    if not rng.chance(ch):
        return
    tt = min(t, rule["clampT"]) if rule.get("clampT") is not None else t
    kinds = [[k, _nn(k.get("weight"), 1) + _nn(k.get("perT"), 0) * tt] for k in rule["kinds"]
             if (k.get("minT") is None or tt > k["minT"]) and (k.get("maxT") is None or tt <= k["maxT"])]
    if not kinds:
        return
    for _ in range(_nn(rule.get("count"), 1)):
        k = pick_weighted(rng, kinds)
        props = k.get("props") or {}
        if rule.get("mode") == "rolling":
            def_["items"].append({"kind": k["kind"], **props})
            continue
        xs = free_xs(def_, ctx.rules, lo=_nn(rule.get("lo"), 0), hi=_nn(rule.get("hi"), 320))
        if not xs:
            return
        def_["items"].append({"kind": k["kind"], "x": rule["fixedX"] if rule.get("fixedX") is not None
                              else rng.pick(xs), **props})


def generate_world(rules: Rules) -> Dict[str, Any]:
    """Generate ``{"screens": [...], "collectibles": [...]}`` (plain JSON-able data). Pure in the rule table."""
    n = rules["count"]
    start = _nn(rules.get("start"), 0)
    size = _nn((rules.get("blocks") or {}).get("size"), 12)
    seed = _nn(rules.get("seed"), 1)
    maps = [_block_slots(rules, b) for b in range(math.ceil(n / size))]
    screens: List[Screen] = []
    for i in range(n):
        rng = create_rng(seed * 101 + 90001 + i * 7919)
        t = ramp_of(i, start, n)
        tag = _nn(maps[i // size].get(i % size), "plain")
        slot = (rules.get("slots") or {}).get(tag) or {}
        def_: Screen = {"idx": i, "tag": tag, "t": t, "items": [], "zones": [], "collectible": None,
                        **copy.deepcopy(slot.get("set") or {})}
        ctx = SimpleNamespace(rng=rng, t=t, rules=rules, idx=i, n=n,
                              free_xs=lambda o=None, d=def_: free_xs(d, rules, **(o or {})))
        for rule in slot.get("place") or []:
            _apply_place(def_, rule, ctx)
        if slot.get("build"):
            slot["build"](def_, ctx)
        pit = def_.get("pit")
        if pit and pit.get("x0") is not None and not any(z.get("pit") for z in def_["zones"]):
            def_["zones"].append({"x0": pit["x0"], "x1": pit["x0"] + _nn(pit.get("w"), 0), "pit": True})
        screens.append(def_)
    collectibles = place_collectibles(screens, rules) if rules.get("collectibles") else []
    if rules.get("finish"):
        rules["finish"](screens, collectibles)
    return {"screens": screens, "collectibles": collectibles}


def place_collectibles(screens: List[Screen], rules: Rules) -> List[Dict[str, Any]]:
    """Spread ``count`` collectibles round the circle (nudged to valid screens); tier by distance rank from start."""
    c = rules["collectibles"]
    n = len(screens)
    start = _nn(rules.get("start"), 0)
    used = {start}
    picks: List[Dict[str, Any]] = []
    rng = create_rng(_nn(rules.get("seed"), 1) * 13 + 555)
    xlo, xhi = _nn(c.get("xRange"), [30, 290])
    step = _nn(c.get("xStep"), 10)
    clear = _nn(c.get("clear"), 44)
    zc = _nn(c.get("zoneClear"), 28)
    exclude, prefer = c.get("exclude"), c.get("prefer")

    def xs_for(s: Screen, items: List[Dict[str, Any]]) -> List[float]:
        res = []
        x = xlo
        while x <= xhi:
            if (not any(x > z["x0"] - zc and x < z["x1"] + zc for z in s["zones"])
                    and not any(abs(h["x"] - x) < clear for h in items)):
                res.append(x)
            x += step
        return res

    for k in range(c["count"]):
        target = js_round(((k + 0.5) * n) / c["count"])
        cands = [wrap(target + o, n) for o in _nn(c.get("offsets"), [0, 1, -1, 2, -2])]
        cands = [i for i in cands if i not in used and not (exclude and exclude(screens[i]))]
        if prefer:
            pr = [i for i in cands if prefer(screens[i], k)]
            if pr:
                cands = pr
        if not cands:
            raise RuntimeError("world-gen: collectible placement failed for %d" % k)
        si = cands[0]
        used.add(si)
        s = screens[si]
        s["items"] = [h for h in s["items"] if h.get("x") is not None]  # rolling hazards would sweep the collectible
        xs = xs_for(s, s["items"])
        if not xs:
            s["items"] = []
            xs = xs_for(s, [])
        if not xs:
            raise RuntimeError("world-gen: no free x for collectible on screen %d" % si)
        picks.append({"screen": si, "x": rng.pick(xs)})
    picks.sort(key=lambda p: p["screen"])
    order = [{"id": i, **p, "d": circ_dist(p["screen"], start, n)} for i, p in enumerate(picks)]
    order.sort(key=lambda o: (o["d"], o["screen"]))  # stable

    def tier_of(rank: int) -> str:
        for t in c["tiers"]:
            if rank < t["upTo"]:
                return t["type"]
        return c["tiers"][-1]["type"]

    out = [{"id": o["id"], "type": tier_of(r), "screen": o["screen"], "x": o["x"]} for r, o in enumerate(order)]
    out.sort(key=lambda o: o["id"])
    for tr in out:
        screens[tr["screen"]]["collectible"] = {"id": tr["id"], "type": tr["type"], "x": tr["x"]}
    return out


# ---- fairness validator ------------------------------------------------------------------------
def validate_world(world: Dict[str, Any], *, crossable: Optional[Callable[[Screen, Any], Any]] = None,
                   collectible_reachable: Optional[Callable[[Screen, Dict[str, Any], Any], Any]] = None,
                   edge_clear: Optional[float] = None, gap: Optional[float] = None,
                   collect_clear: Optional[float] = None, checks: Sequence[Callable[[Screen, Any], Optional[str]]] = (),
                   max_hard_run: Optional[int] = None, is_hard: Optional[Callable[[Screen], bool]] = None,
                   allow_edge_items: bool = False, allow_items_near_zones: bool = False,
                   rolling_sweeps_collectible: bool = False) -> Dict[str, Any]:
    """``{"ok", "failures": [{"screen","rule","msg"}], "stats": {...}}``.

    ``crossable(def, ctx)`` returns True, False or a failure string (wire it to ``jump_range``); ``checks`` are
    extra ``(def, ctx) -> str | None`` rules; ``max_hard_run`` + ``is_hard`` bound consecutive hard screens (circular).
    """
    screens = world["screens"]
    collectibles = world.get("collectibles")
    n = len(screens)
    failures: List[Dict[str, Any]] = []
    ec = _nn(edge_clear, 36)
    gp = _nn(gap, 48)
    cc = _nn(collect_clear, 44)
    ctx = SimpleNamespace(n=n, screens=screens)

    def fail(d: Screen, rule: str, msg: str) -> None:
        failures.append({"screen": d["idx"], "rule": rule, "msg": msg})

    for d in screens:
        if crossable:
            r = crossable(d, ctx)
            if r is not True:
                fail(d, "crossable", r if isinstance(r, str) else "not crossable")
        st = sorted((h for h in d["items"] if h.get("x") is not None), key=lambda h: h["x"])
        for k, h in enumerate(st):
            if h["x"] < ec or h["x"] > 320 - ec:
                if not allow_edge_items:
                    fail(d, "edgeClear", "%s@%s within %s of edge" % (h["kind"], js_str(h["x"]), js_str(ec)))
            if k and h["x"] - st[k - 1]["x"] < gp:
                fail(d, "gap", "%s/%s only %spx apart" % (st[k - 1]["kind"], h["kind"], js_str(h["x"] - st[k - 1]["x"])))
            for z in d["zones"]:
                if h["x"] > z["x0"] - ec and h["x"] < z["x1"] + ec and not allow_items_near_zones:
                    fail(d, "zoneClear", "%s@%s too near a zone" % (h["kind"], js_str(h["x"])))
        col = d.get("collectible")
        if col:
            for h in st:
                if abs(h["x"] - col["x"]) < cc:
                    fail(d, "collectClear", "%s %spx from collectible" % (h["kind"], js_str(abs(h["x"] - col["x"]))))
            if rolling_sweeps_collectible and any(h.get("x") is None for h in d["items"]):
                fail(d, "rolling", "rolling hazard on collectible screen")
            if collectible_reachable:
                r = collectible_reachable(d, col, ctx)
                if r is not True:
                    fail(d, "collectibleReachable", r if isinstance(r, str) else "unreachable")
        for chk in checks:
            msg = chk(d, ctx)
            if msg:
                fail(d, "custom", msg)
    if max_hard_run and is_hard:
        run = worst = 0
        for i in range(2 * n):
            run = run + 1 if is_hard(screens[i % n]) else 0
            worst = max(worst, run)
        if worst > max_hard_run and worst < 2 * n:
            failures.append({"screen": -1, "rule": "hardRun",
                             "msg": "%d consecutive hard screens (max %s)" % (worst, js_str(max_hard_run))})
    if collectibles is not None:
        if len({c["screen"] for c in collectibles}) != len(collectibles):
            failures.append({"screen": -1, "rule": "collectibleUnique", "msg": "two collectibles share a screen"})
    return {"ok": not failures, "failures": failures,
            "stats": {"screens": n, "collectibles": len(collectibles) if collectibles else 0}}


def is_deterministic(rules: Rules) -> bool:
    """True if generating twice yields identical screens (guards hidden non-determinism)."""
    return generate_world(rules)["screens"] == generate_world(rules)["screens"]


# ---- declarative fixtures (spec) ---------------------------------------------------------------
def with_fixtures(rules: Rules) -> Rules:
    """Deep copy of ``rules`` with the spec's declarative fixtures compiled to callables:
    ``slots[X].build={type:'pit',...}``, ``collectibles.exclude='key'``, ``collectibles.prefer={every,pitKind}``."""
    r = copy.deepcopy(rules)
    for slot in (r.get("slots") or {}).values():
        b = slot.get("build")
        if isinstance(b, dict):
            def build(def_: Screen, ctx: Any, b: Dict[str, Any] = b) -> None:
                if not ctx.rng.chance(lerp_val(_nn(b.get("chance"), 1), ctx.t)):
                    return
                w = js_round(lerp_val(b.get("w"), ctx.t))
                xs = ctx.free_xs({"lo": _nn(b.get("lo"), 60), "hi": _nn(b.get("hi"), 260)})
                if not xs:
                    return
                x0 = ctx.rng.pick(xs)
                def_["pit"] = {"kind": _nn(b.get("kind"), "hole"), "x0": x0, "w": w}
                def_["zones"].append({"x0": x0, "x1": x0 + w, "pit": True})
            slot["build"] = build
    c = r.get("collectibles")
    if c:
        if isinstance(c.get("exclude"), str):
            key = c["exclude"]
            c["exclude"] = lambda d, key=key: bool(d.get(key))
        if isinstance(c.get("prefer"), dict):
            every, pit_kind = c["prefer"]["every"], c["prefer"]["pitKind"]
            c["prefer"] = lambda d, k: k % every == 0 and (d.get("pit") or {}).get("kind") == pit_kind
    return r
