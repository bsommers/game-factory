"""Portable RNGs (spec/rng.md): PCG32, FNV-1a seeding and the two legacy 32-bit streams.

Everything is integer math with explicit masking, so results are bit-identical to the JS/Rust/Go
implementations. Never use ``random`` in engine code.
"""
from __future__ import annotations

import math
from typing import Callable, List, MutableSequence, Sequence, TypeVar, Union

T = TypeVar("T")

M32 = 0xFFFFFFFF
M64 = 0xFFFFFFFFFFFFFFFF
_MULT = 6364136223846793005
_INC = (54 << 1) | 1  # 109, fixed stream


def fnv1a32(data: Union[str, bytes]) -> int:
    """FNV-1a 32-bit hash of ``data`` (strings are UTF-8 encoded)."""
    raw = data.encode("utf-8") if isinstance(data, str) else data
    h = 0x811C9DC5
    for b in raw:
        h ^= b
        h = (h * 0x01000193) & M32
    return h


def js_round(x: float) -> int:
    """JavaScript ``Math.round`` for finite floats: ``floor(x + 0.5)`` (ties toward +inf)."""
    return math.floor(x + 0.5)


class Pcg32:
    """PCG32 XSH-RR 64/32 with the fixed stream used by the spec.

    ``seed`` is a u32 (any int is reduced mod 2**32) or a string (FNV-1a 32 of its UTF-8 bytes).
    Draw order is part of the contract: one ``next_u32`` per float/randint/chance/pick call;
    ``shuffle`` draws ``len-1`` times.
    """

    __slots__ = ("state",)

    def __init__(self, seed: Union[int, str] = 1) -> None:
        s32 = fnv1a32(seed) if isinstance(seed, str) else int(seed) & M32
        self.state = 0
        self._step()
        self.state = (self.state + s32) & M64
        self._step()

    def _step(self) -> None:
        self.state = (self.state * _MULT + _INC) & M64

    def next_u32(self) -> int:
        """Next uniform u32."""
        old = self.state
        self._step()
        xs = (((old >> 18) ^ old) >> 27) & M32
        rot = old >> 59
        return ((xs >> rot) | (xs << ((32 - rot) & 31))) & M32

    def next_float(self) -> float:
        """Uniform float in [0, 1), exact in f64."""
        return self.next_u32() / 4294967296.0

    def randint(self, a: int, b: int) -> int:
        """Inclusive integer in [a, b]; no rejection (span <= 2**32)."""
        return a + ((self.next_u32() * (b - a + 1)) >> 32)

    def range(self, a: float, b: float) -> float:
        """Float in [a, b)."""
        return a + (b - a) * self.next_float()

    def chance(self, p: float) -> bool:
        """True with probability ``p``."""
        return self.next_float() < p

    def pick(self, items: Sequence[T]) -> T:
        """Uniform element; ``items`` must be non-empty."""
        return items[self.randint(0, len(items) - 1)]

    def shuffle(self, items: MutableSequence[T]) -> MutableSequence[T]:
        """In-place Fisher-Yates (``len-1`` draws); returns ``items``."""
        for i in range(len(items) - 1, 0, -1):
            j = self.randint(0, i)
            items[i], items[j] = items[j], items[i]
        return items


def _mix32(s: int) -> float:
    """Shared output function of mulberry32 / botRng for an already advanced u32 state."""
    t = ((s ^ (s >> 15)) * (1 | s)) & M32
    t = (t + (((t ^ (t >> 7)) * (61 | t)) & M32)) & M32 ^ t
    return ((t ^ (t >> 14)) & M32) / 4294967296.0


class Mulberry32:
    """Legacy world-gen stream (JS ``createRng``): ``seed mod 2**32`` or 1 if that is 0."""

    __slots__ = ("s",)

    def __init__(self, seed: int = 1) -> None:
        self.s = (int(seed) & M32) or 1

    def next_float(self) -> float:
        self.s = (self.s + 0x6D2B79F5) & M32
        return _mix32(self.s)

    def range(self, a: float, b: float) -> float:
        return a + (b - a) * self.next_float()

    def randint(self, a: int, b: int) -> int:
        """Inclusive ``a + floor(next * (b - a + 1))`` (differs from Pcg32.randint in general)."""
        return a + math.floor(self.next_float() * (b - a + 1))

    def pick(self, items: Sequence[T]) -> T:
        return items[math.floor(self.next_float() * len(items))]

    def chance(self, p: float) -> bool:
        return self.next_float() < p


def bot_rng(seed: int = 0x9E3779B9) -> Callable[[], float]:
    """Legacy autopilot stream (JS ``botRng``): returns a zero-arg callable giving floats in [0, 1)."""
    state = [int(seed) & M32]  # ``seed | 0`` viewed as u32

    def draw() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & M32
        return _mix32(state[0])

    return draw


def make_stream(alg: str, seed: Union[int, str]):
    """Build a stream by name: ``pcg32``, ``mulberry32`` or ``bot`` (returns a Pcg32/Mulberry32/callable)."""
    if alg == "pcg32":
        return Pcg32(seed)
    if alg == "mulberry32":
        return Mulberry32(int(seed))
    if alg == "bot":
        return bot_rng(int(seed))
    raise ValueError("unknown alg " + alg)
