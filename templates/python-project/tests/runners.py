"""Vector-runner adapters: ``run(engine, input) -> output`` (see spec/*.md "Vector runner").

Closures in the JS APIs are replaced by the declarative fixtures the spec describes.
"""
from __future__ import annotations

import copy
import re
from typing import Any, Dict

from game.engine import autopilot_kit as A
from game.engine import hazard_kit as H
from game.engine import platformer_physics as P
from game.engine import rng as R
from game.engine import world_gen as W


def snake(k: str) -> str:
    return re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), k)


def snake_keys(d: Dict[str, Any]) -> Dict[str, Any]:
    return {snake(k): v for k, v in (d or {}).items()}


# ---- rng ---------------------------------------------------------------------------------------
def run_rng(inp: Dict[str, Any]) -> Dict[str, Any]:
    op = inp["op"]
    if op == "fnv1a":
        return {"u32": R.fnv1a32(inp["str"])}
    alg, seed = inp["alg"], inp["seed"]
    s = R.make_stream(alg, seed)
    if alg == "bot":
        class _Bot:
            next_float = staticmethod(s)
        s = _Bot()
    n = inp.get("n")
    if op == "u32":
        return {"values": [s.next_u32() for _ in range(n)]}
    if op == "float":
        return {"values": [s.next_float() for _ in range(n)]}
    if op == "int":
        return {"values": [s.randint(inp["lo"], inp["hi"]) for _ in range(n)]}
    if op == "range":
        return {"values": [s.range(inp["lo"], inp["hi"]) for _ in range(n)]}
    if op == "chance":
        return {"values": [s.chance(inp["p"]) for _ in range(n)]}
    if op == "pick":
        return {"values": [s.pick(inp["items"]) for _ in range(n)]}
    if op == "shuffle":
        return {"values": s.shuffle(list(inp["items"]))}
    raise ValueError("unknown op " + op)


# ---- platformer-physics ------------------------------------------------------------------------
def _build_world(w: Dict[str, Any]):
    ropes = [P.pendulum(**r) for r in (w.get("ropes") or [])]
    movers = []
    platforms = []
    for p in w.get("platforms") or []:
        if p.get("moving"):
            m = P.MovingPlatform(**{"id": p.get("id"), **p["moving"]})
            movers.append(m)
            platforms.append(m)
        else:
            platforms.append(dict(p))
    world = {"groundY": w["groundY"], "pits": w.get("pits") or [], "platforms": platforms,
             "ladders": w.get("ladders") or [], "ropes": ropes}
    if w.get("bounds"):
        world["bounds"] = w["bounds"]
    return world, ropes, movers


def _idx(seq, obj):
    for i, o in enumerate(seq):
        if o is obj:
            return i
    return -1


def _snap(b: P.Body, ropes, ladders) -> Dict[str, Any]:
    return {"x": b.x, "y": b.y, "vx": b.vx, "vy": b.vy, "face": b.face, "mode": b.mode, "layer": b.layer,
            "landed": b.landed, "onPlatform": "[obj]" if isinstance(b.on_platform, dict) else b.on_platform,
            "grabCd": b.grab_cd, "swingK": b.swing_k, "offX": b.off_x, "offY": b.off_y, "t": b.t,
            "deathKind": b.death_kind, "rope": _idx(ropes, b.rope) if b.rope is not None else None,
            "ladder": _idx(ladders, b.ladder) if b.ladder is not None else None}


def run_physics(inp: Dict[str, Any]) -> Dict[str, Any]:
    cfg = P.make_config(**snake_keys(inp.get("cfg")))
    op = inp["op"]
    if op == "ranges":
        return {"jumpRange": P.jump_range(cfg), "jumpHeight": P.jump_height(cfg)}
    if op == "pendulum":
        p = P.pendulum(**inp["rope"])
        return {"samples": [{"angle": p.angle(t), "tip": p.tip(t)._asdict(), "tipVel": p.tip_vel(t)._asdict()}
                            for t in inp["ts"]]}
    if op == "moving":
        m = P.MovingPlatform(**inp["platform"])
        fr = lambda: {"x": m["x"], "y": m["y"], "dx": m["dx"], "dy": m["dy"], "t": m["t"]}  # noqa: E731
        frames = [fr()]
        for _ in range(inp["ticks"]):
            m.update(inp["dt"])
            frames.append(fr())
        return {"frames": frames}
    if op == "support":
        world, _, _ = _build_world(inp["world"])
        out: Dict[str, Any] = {}
        out["pitAt"] = []
        for x in inp.get("pitAt") or []:
            q = P.pit_at(world, x)
            out["pitAt"].append(_idx(world["pits"], q) if q is not None else None)
        out["ladderAt"] = []
        for x, y in inp.get("ladderAt") or []:
            l = P.ladder_at(world, x, y)
            out["ladderAt"].append(_idx(world["ladders"], l) if l is not None else None)
        out["supportAt"] = []
        for x, y in inp.get("supportAt") or []:
            s = P.support_at(world, x, y)
            out["supportAt"].append(None if s is None else {"y": s["y"], "platform": s["platform"].get("id") if s.get("platform") else None})
        return out
    if op == "edge":
        res = []
        for c in inp["cases"]:
            b = P.make_body(c["body"]["x"], 0)
            b.mode = c["body"].get("mode") or "ground"
            tr = P.edge_transition(b, c["idx"], c["count"], P.make_config(**snake_keys(c.get("cfg"))))
            res.append({"wrapIndex": P.wrap_index(c["idx"], c["count"]), "tr": tr._asdict() if tr else None})
        return {"results": res}
    if op == "sim":
        world, ropes, movers = _build_world(inp["world"])
        lookup = {}
        for p in world["platforms"]:
            lookup[id(p)] = {"platform": p.get("id")}
        for i, q in enumerate(world["pits"]):
            lookup[id(q)] = {"pit": i}
        for i, l in enumerate(world["ladders"]):
            lookup[id(l)] = {"ladder": i}
        events = []
        tick = [0]

        def emit(name, b, extra=None):
            if extra is None:
                ex = None
            elif id(extra) in lookup:
                ex = lookup[id(extra)]
            elif isinstance(extra, tuple):
                ex = extra._asdict()
            else:
                ex = extra
            events.append({"tick": tick[0], "name": name, "extra": ex})

        cfg.emit = emit
        b = P.make_body(inp["body"]["x"], inp["body"]["y"])
        for k, v in snake_keys(inp["body"].get("set")).items():
            setattr(b, k, v)
        seq = []
        for s in inp["script"]:
            for _ in range(s["n"]):
                seq.append(P.Input(s.get("dx") or 0, s.get("dy") or 0, bool(s.get("jp"))))
        t = 0.0
        frames = []
        for tick[0] in range(len(seq)):
            for m in movers:
                m.update(inp["dt"])
            if inp.get("useWorldT"):
                t += inp["dt"]
                world["t"] = t
            P.step_body(b, seq[tick[0]], inp["dt"], world, cfg)
            frames.append(_snap(b, ropes, world["ladders"]))
        return {"frames": frames, "events": events}
    raise ValueError("unknown op " + op)


# ---- hazard-kit --------------------------------------------------------------------------------
def _behaviour(k: Dict[str, Any]) -> H.Behaviour:
    p = dict(k.get("params") or {})
    if k["pattern"] == "faulty":
        def boom(e, dt, g):
            raise RuntimeError("boom")
        return H.Behaviour(lambda e, g: None, boom)
    if "props" in p:
        props = p.pop("props")
        p["makeProps"] = lambda e, g, props=props: dict(props)
    if "throwProps" in p:
        tp = p.pop("throwProps")
        p["throwProps"] = lambda e, g, tp=tp: dict(tp)
    return getattr(H, k["pattern"])(**p)


def _make_reg(kinds: Dict[str, Any]) -> H.Registry:
    reg = H.create_registry()
    for name, k in kinds.items():
        reg.register(name, _behaviour(k), k.get("defaults") or {})
    return reg


def _ent_snap(e):
    return {**e, "st": dict(e["st"])}


def run_hazard(inp: Dict[str, Any]) -> Dict[str, Any]:
    op = inp["op"]
    if op == "overlaps":
        return {"results": [H.overlaps(c["p"], c["hw"], c["hh"], c["e"]) for c in inp["cases"]]}
    if op == "sim":
        reg = _make_reg(inp["kinds"])
        events = []
        tick = [0]
        ents = []

        def spawn(kind, props):
            e = reg.spawn(kind, props, g)
            ents.append(e)
            return e

        def emit(name, data):
            events.append({"tick": tick[0], "name": name,
                           "data": {**data, "ent": data["ent"]["id"]} if data.get("ent") else data})

        g = {"spawn": spawn, "emit": emit, "width": inp.get("width")}
        if inp.get("rngSeed") is not None:
            g["rng"] = R.Pcg32(inp["rngSeed"])
        if inp.get("noRng"):
            g.pop("rng", None)
        for s in inp["entities"]:
            spawn(s["kind"], s.get("props") or {})
        frames = [[_ent_snap(e) for e in ents]]
        for tick[0] in range(1, inp["ticks"] + 1):
            reg.update(ents, inp["dt"], g)
            frames.append([_ent_snap(e) for e in ents])
        return {"frames": frames, "events": events, "count": len(ents)}
    if op == "contacts":
        reg = _make_reg(inp["kinds"])
        ents = [reg.spawn(s["kind"], s.get("props") or {}, {}) for s in inp["entities"]]
        steps = []
        for s in inp["steps"]:
            gg = {"time": s["time"]} if s.get("time") is not None else {}
            res = H.resolve_contacts(reg, s["player"], ents, inp.get("opts") or {}, gg)
            steps.append([{"type": r["type"], "ent": r["ent"]["id"], "kind": r.get("kind"), "amount": r.get("amount")}
                          for r in res])
        return {"steps": steps, "ents": [_ent_snap(e) for e in ents]}
    if op == "solid":
        reg = _make_reg(inp["kinds"])
        ents = [reg.spawn(s["kind"], s.get("props") or {}, {}) for s in inp["entities"]]
        ident = lambda e: e["id"] if e else None  # noqa: E731
        return {"under": [ident(H.solid_top_under(ents, *a)) for a in inp["under"]],
                "carrying": [ident(H.solid_top_carrying(ents, *a)) for a in inp["carrying"]]}
    raise ValueError("unknown op " + op)


# ---- world-gen ---------------------------------------------------------------------------------
def _v_opts(v: Dict[str, Any]) -> Dict[str, Any]:
    o = snake_keys({k: x for k, x in (v or {}).items() if k not in ("crossable", "hard")})
    if v.get("crossable"):
        mp = v["crossable"]["maxPit"]
        o["crossable"] = lambda d, ctx: (not d.get("pit")) or d["pit"]["w"] <= mp or "pit %s too wide" % W.js_str(d["pit"]["w"])
    if v.get("hard"):
        tags = v["hard"]["tags"]
        o["is_hard"] = lambda d: d["tag"] in tags
    return o


def run_world(inp: Dict[str, Any]) -> Dict[str, Any]:
    op = inp["op"]
    if op == "helpers":
        return {"wrap": [W.wrap(i, n) for i, n in inp["wrap"]],
                "circDist": [W.circ_dist(a, b, n) for a, b, n in inp["circDist"]],
                "rampOf": [W.ramp_of(i, s, n) for i, s, n in inp["rampOf"]],
                "lerpVal": [W.lerp_val(v, t) for v, t in inp["lerpVal"]]}
    if op == "rng":
        r = W.create_rng(inp["seed"])
        return {"values": [r.next_float() for _ in range(inp["n"])]}
    if op == "shuffle":
        return {"values": W.shuffle(list(inp["items"]), W.create_rng(inp["seed"]))}
    if op == "weighted":
        r = W.create_rng(inp["seed"])
        return {"values": [W.pick_weighted(r, inp["items"]) for _ in range(inp["n"])]}
    if op == "generate":
        w = W.generate_world(W.with_fixtures(inp["rules"]))
        out = {"world": w, "deterministic": W.is_deterministic(W.with_fixtures(inp["rules"]))}
        if inp.get("validate"):
            out["validation"] = W.validate_world(w, **_v_opts(inp["validate"]))
        return out
    if op == "validate":
        return {"validation": W.validate_world(copy.deepcopy(inp["world"]), **_v_opts(inp["opts"]))}
    raise ValueError("unknown op " + op)


# ---- autopilot ---------------------------------------------------------------------------------
def _mk_rng(r: Dict[str, Any]):
    return R.Pcg32(r["seed"]).next_float if r["kind"] == "pcg32" else R.bot_rng(r["seed"])


def run_autopilot(inp: Dict[str, Any]) -> Dict[str, Any]:
    op = inp["op"]
    if op == "input":
        return {"value": A.make_input(*inp["args"])}
    if op == "botRng":
        f = R.bot_rng(inp["seed"])
        return {"values": [f() for _ in range(inp["n"])]}
    if op == "trajectory":
        reg = _make_reg(inp["kinds"])
        ents = [reg.spawn(s["kind"], s.get("props") or {}, {}) for s in inp["entities"]]
        return {"frames": A.trajectory(ents, inp["n"], inp["dt"], lambda e, dt: reg.update([e], dt, {}))}
    if op == "search":
        opts = inp.get("opts") or {}
        fams = [A.Family(make=(lambda n, fi=fi: {"family": fi, "n": n}), bias=f.get("bias") or 0)
                for fi, f in enumerate(inp["families"])]
        stride = opts["stride"] if opts.get("stride") is not None else 3
        cost = lambda m: inp["costTable"][m["family"]][m["n"] // stride]  # noqa: E731
        return {"result": A.search_macros(fams, cost, count=opts.get("count"), stride=opts.get("stride"),
                                          robust_below=opts.get("robustBelow"), n_tax=opts.get("nTax"))}
    if op == "watchdog":
        o = inp.get("opts") or {}
        wd = A.Watchdog(**snake_keys(o))
        steps = []
        for i, (k, t) in enumerate(inp["ticks"]):
            fl = wd.tick(k, t)
            steps.append({"flail": fl, "input": wd.flail(i + 1) if fl else None, "stuck": wd.stuck})
        return {"steps": steps}
    if op == "humanize":
        h = A.humanize(inp["skill"], _mk_rng(inp["rng"]))
        return {"outputs": [h(A.make_input(s.get("dx") or 0, s.get("dy") or 0, bool(s.get("jp"))),
                              True if s.get("canAct") is None else s["canAct"]) for s in inp["seq"]]}
    if op == "autopilot":
        cur: Dict[str, Any] = {}

        def decide(g, dt):
            d = cur["decide"]
            if d == "throw":
                raise RuntimeError("decide failed")
            return A.make_input(d["dx"], d.get("dy") or 0, bool(d.get("jump")))

        c = inp["cfg"]
        ap = A.create_autopilot(A.AutopilotConfig(
            decide=decide, progress_key=lambda g: cur["key"], time=lambda g: cur["time"],
            playing=lambda g: True if cur.get("playing") is None else cur["playing"],
            can_humanize=lambda g: True if cur.get("canHumanize") is None else cur["canHumanize"],
            skill=1 if c.get("skill") is None else c["skill"], seed=c.get("seed"),
            watchdog=snake_keys(c.get("watchdog") or {})))
        outs = []
        for t in inp["ticks"]:
            cur.clear()
            cur.update(t)
            outs.append(ap.input({}, 1 / 60))
        return {"outputs": outs, "stats": {"errors": ap.stats.errors, "stuck": ap.stats.stuck,
                                           "hasError": ap.stats.last_error is not None}}
    raise ValueError("unknown op " + op)


RUNNERS = {"rng": run_rng, "platformer-physics": run_physics, "hazard-kit": run_hazard,
           "world-gen": run_world, "autopilot": run_autopilot}
