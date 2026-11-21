"""Game-agnostic building blocks for a deterministic look-ahead bot (port of ``autopilot-kit.js``).

``trajectory`` (clone + step hazards), ``search_macros`` (robust macro-plan search), ``Watchdog`` (no-progress
detector), ``humanize`` (deterministic late take-offs) and ``create_autopilot`` (glue with error containment).
Input shape: ``{"dx", "dy", "jump", "jumpPressed"}``.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence

from .rng import bot_rng, js_round

Input = Dict[str, Any]
Entity = Dict[str, Any]


def make_input(dx: int = 0, dy: int = 0, jp: bool = False) -> Input:
    """Autopilot input record (key order dx, dy, jump, jumpPressed)."""
    return {"dx": dx, "dy": dy, "jump": jp, "jumpPressed": jp}


def _default_snap(e: Entity) -> Entity:
    return {**e, "st": dict(e.get("st") or {})}


def trajectory(ents: Sequence[Entity], n: int, dt: float, update: Callable[[Entity, float], Any],
               snap: Callable[[Entity], Any] = _default_snap) -> List[List[Any]]:
    """Snapshots for ticks 0..n (index j = after j updates). Entities are cloned (``st`` copied) so the live game is
    untouched; an exception in ``update`` is swallowed (a faulty behaviour must not kill the planner)."""
    cur = [{**e, "st": dict(e.get("st") or {})} for e in ents if not e.get("dead")]
    out = [[snap(e) for e in cur]]
    for _ in range(n):
        for e in cur:
            try:
                update(e, dt)
            except Exception:  # noqa: BLE001
                pass
        out.append([snap(e) for e in cur])
    return out


@dataclass
class Family:
    """A macro family: ``make(n)`` builds the macro with delay ``n`` ticks; ``bias`` is added to its cost."""

    make: Callable[[int], Any]
    bias: float = 0.0


def search_macros(families: Sequence[Family], cost: Callable[[Any], float], count: Optional[int] = None,
                  stride: Optional[int] = None, robust_below: Optional[float] = None,
                  n_tax: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """Macro-plan search. Pass 1 smooths each cost with its neighbours (max of i-1, i, i+1) so a plan that only works
    at one exact tick is not trusted; if a smoothed plan is below ``robust_below`` the best wins, else raw costs decide.
    Returns ``{"cost","family","n","macro"}`` or None. Ties keep the first seen."""
    nn = 30 if count is None else count
    st = 3 if stride is None else stride
    robust = 24 if robust_below is None else robust_below
    tax = 0.004 if n_tax is None else n_tax
    grid = [(f, [cost(f.make(i * st)) for i in range(nn)]) for f in families]
    for smooth in (True, False):
        best: Optional[Dict[str, Any]] = None
        for fi, (f, costs) in enumerate(grid):
            for i in range(nn):
                if smooth:
                    lo = costs[i - 1] if i - 1 >= 0 and costs[i - 1] is not None else costs[i]
                    hi = costs[i + 1] if i + 1 < nn and costs[i + 1] is not None else costs[i]
                    raw = max(costs[i], lo, hi)
                else:
                    raw = costs[i]
                c = raw + (f.bias or 0) + i * tax
                if best is None or c < best["cost"]:
                    best = {"cost": c, "family": fi, "n": i * st, "macro": f.make(i * st)}
        if best is not None and (not smooth or best["cost"] < robust):
            return best
    return None


class Watchdog:
    """Progress watchdog. ``tick(key, time)`` returns True while the bot should flail (key unchanged for ``limit`` s)."""

    def __init__(self, limit: float = 40, panic_ticks: int = 90) -> None:
        self.limit, self.panic_ticks = limit, panic_ticks
        self.key: Any = ""
        self.since: float = 0
        self.panic = 0
        self.stuck = 0

    def tick(self, k: Any, time: float) -> bool:
        if k != self.key:
            self.key, self.since, self.panic = k, time, 0
        if self.panic == 0 and time - self.since > self.limit:
            self.stuck += 1
            self.panic = self.panic_ticks
            self.since = time
        if self.panic > 0:
            self.panic -= 1
            return True
        return False

    @staticmethod
    def flail(tick_no: int) -> Input:
        """Flail input: alternate direction, hop now and then."""
        return make_input(1 if tick_no % 120 < 60 else -1, 0, tick_no % 40 == 0)


def make_watchdog(limit: float = 40, panic_ticks: int = 90) -> Watchdog:
    return Watchdog(limit, panic_ticks)


def humanize(skill: float = 1, rng: Optional[Callable[[], float]] = None) -> Callable[..., Input]:
    """Deterministic human lag: delays each jump by up to ~(1-skill)*14 ticks. ``skill >= 1`` is a perfect bot.
    ``rng`` is any zero-arg float source (default ``bot_rng(1)``; ``Pcg32(seed).next_float`` also works)."""
    draw = rng if rng is not None else bot_rng(1)
    pending = [0]

    def lag(r: Input, can_act: bool = True) -> Input:
        if skill >= 1 or not can_act:
            return r
        if pending[0] > 0:
            pending[0] -= 1
            return {**r, "jump": True, "jumpPressed": True} if pending[0] == 0 else make_input(r["dx"], 0, False)
        if r.get("jumpPressed"):
            late = js_round((1 - skill) * 14)
            pending[0] = late + math.floor(draw() * (late + 1))
            if pending[0] > 0:
                return make_input(r["dx"], 0, False)
        return r

    return lag


@dataclass
class AutopilotStats:
    errors: int = 0
    stuck: int = 0
    last_error: Optional[str] = None


@dataclass
class AutopilotConfig:
    """``decide(g, dt) -> input``; ``progress_key(g)`` / ``time(g)`` feed the watchdog; ``playing``/``can_humanize``
    are optional predicates. ``rng`` overrides the default ``bot_rng(seed or 1)`` humanizer source."""

    decide: Callable[[Any, float], Input]
    progress_key: Callable[[Any], Any]
    time: Callable[[Any], float]
    playing: Optional[Callable[[Any], bool]] = None
    can_humanize: Optional[Callable[[Any], bool]] = None
    skill: float = 1
    seed: Optional[int] = None
    watchdog: Dict[str, Any] = field(default_factory=dict)
    rng: Optional[Callable[[], float]] = None


class Autopilot:
    """Glue: decide -> watchdog -> humanizer, with errors in ``decide`` contained and counted."""

    def __init__(self, cfg: AutopilotConfig) -> None:
        self.cfg = cfg
        self.stats = AutopilotStats()
        self._wd = Watchdog(**(cfg.watchdog or {}))
        self._lag = humanize(cfg.skill, cfg.rng if cfg.rng is not None else bot_rng(1 if cfg.seed is None else cfg.seed))
        self._tick = 0

    def input(self, g: Any, dt: float) -> Input:
        cfg = self.cfg
        self._tick += 1
        playing = cfg.playing(g) if cfg.playing else True
        if playing and self._wd.tick(cfg.progress_key(g), cfg.time(g)):
            self.stats.stuck = self._wd.stuck
            return self._wd.flail(self._tick)  # flail bypasses decide and the humanizer
        try:
            r = cfg.decide(g, dt)
        except Exception as e:  # noqa: BLE001
            self.stats.errors += 1
            self.stats.last_error = "%s: %s" % (type(e).__name__, e)
            r = make_input(1)
        return self._lag(r, cfg.can_humanize(g) if cfg.can_humanize else True)


def create_autopilot(cfg: AutopilotConfig) -> Autopilot:
    return Autopilot(cfg)
