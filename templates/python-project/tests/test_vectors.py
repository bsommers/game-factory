"""Conformance tests against the language-neutral golden vectors (spec/vectors/*.json).

Finds the vectors by (1) ``FACTORY_SPEC_DIR`` (the ``vectors`` dir or its parent ``spec`` dir), else (2) searching
upward from this file for ``spec/vectors/rng.json``. Ints/strings/bools/null compare exactly; floats within 1e-9
(relative 1e-12 for |v| > 1e6). Runs under ``python -m unittest`` and under pytest (one test per vector case).
"""
from __future__ import annotations

import json
import math
import os
import sys
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
for _p in (_HERE, _HERE.parent / "src"):  # works with `python -I` (ignores PYTHONPATH) and without an install
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))
from runners import RUNNERS  # noqa: E402

ENGINES = ["rng", "platformer-physics", "hazard-kit", "world-gen", "autopilot"]


def find_vectors_dir():
    env = os.environ.get("FACTORY_SPEC_DIR")
    if env:
        p = Path(env)
        for c in (p, p / "vectors"):
            if (c / "rng.json").is_file():
                return c
        return None
    here = Path(__file__).resolve()
    for d in [here.parent, *here.parents]:
        if (d / "spec" / "vectors" / "rng.json").is_file():
            return d / "spec" / "vectors"
    return None


def _isnum(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def diff(actual, expect, path="$"):
    """Return a description of the first difference, or None when equal under the spec's rules."""
    if isinstance(expect, dict):
        if not isinstance(actual, dict):
            return "%s: expected object, got %r" % (path, actual)
        if set(actual) != set(expect):
            return "%s: keys differ: extra=%s missing=%s" % (path, sorted(set(actual) - set(expect)), sorted(set(expect) - set(actual)))
        for k in expect:
            d = diff(actual[k], expect[k], "%s.%s" % (path, k))
            if d:
                return d
        return None
    if isinstance(expect, list):
        if not isinstance(actual, (list, tuple)) or len(actual) != len(expect):
            return "%s: expected list of %d, got %r" % (path, len(expect), type(actual).__name__)
        for i, (a, e) in enumerate(zip(actual, expect)):
            d = diff(a, e, "%s[%d]" % (path, i))
            if d:
                return d
        return None
    if isinstance(expect, bool) or expect is None or isinstance(expect, str):
        return None if (actual is expect or actual == expect) and type(actual) is type(expect) else \
            "%s: expected %r, got %r" % (path, expect, actual)
    if _isnum(expect):
        if not _isnum(actual):
            return "%s: expected number %r, got %r" % (path, expect, actual)
        if isinstance(expect, int):
            return None if actual == expect else "%s: expected %r, got %r" % (path, expect, actual)
        tol = 1e-12 * abs(expect) if abs(expect) > 1e6 else 1e-9
        return None if math.isclose(actual, expect, rel_tol=0, abs_tol=tol) else \
            "%s: expected %r, got %r (tol %g)" % (path, expect, actual, tol)
    return "%s: unsupported expected %r" % (path, expect)


VDIR = find_vectors_dir()


class VectorsTest(unittest.TestCase):
    def test_vectors_dir_found(self):
        self.assertIsNotNone(VDIR, "spec/vectors not found: set FACTORY_SPEC_DIR or scaffold with the factory spec/ copy")


def _make(engine, case):
    def t(self):
        actual = RUNNERS[engine](case["input"])
        d = diff(actual, case["expect"])
        self.assertIsNone(d, "%s / %s" % (engine, case["name"]))
    return t


def _load():
    if VDIR is None:
        return
    for engine in ENGINES:
        data = json.loads((VDIR / (engine + ".json")).read_text(encoding="utf-8"))
        for i, case in enumerate(data["cases"]):
            name = "test_%s_%03d_%s" % (engine.replace("-", "_"), i, "".join(c if c.isalnum() else "_" for c in case["name"])[:60])
            setattr(VectorsTest, name, _make(engine, case))


_load()

if __name__ == "__main__":
    unittest.main()
