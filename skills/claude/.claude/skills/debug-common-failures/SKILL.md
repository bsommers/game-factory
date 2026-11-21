---
name: debug-common-failures
description: Triage common game-factory and swarm failures: broken contract parsing, stale state, unreachable hazards, blank frames, flaky tests, swarm usage limits. Use when: debug, bug, broken, fails, failing, error.
---

# Debug common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Whole swarm fails to import defs | `*/` inside a `/** */` comment | use `//`; run `tools/check-imports.mjs` |
| Agents call different entry points | hook not in the contract | document name, args, return, example |
| Sprite edge looks clipped | outline needs 1 px margin | keep art off the border |
| Blank screenshot (std < 0.01) | class/module not registered | check imports, absolute paths |
| Hazard never crossable | reach geometry untested | write a sweep script first |
| Tests pass with a constant seed | no seed-difference test | add one; mutation check |
| HUD event looks stale | wrong clock | stamp on next draw |
| Pose/state a tick late | derived field set next tick | set in the transition |
| Swarm dies mid-run | too many concurrent agents / big resumes | max 4 running, fresh agents from checkpoints |
| Pages shows no game | build output not in served folder | copy the build to the Pages root |

## Steps
1. Reproduce with the smallest test. 2. Change one thing at a time. 3. Add the regression test. 4. Record the lesson under "Learnings" in your report.

## Gotchas
- A failure that persists whatever you change often means a stale import/cache or the wrong file is loaded.
- Re-run agents' "tests pass" claims yourself.

## Verification
The regression test fails before the fix and passes after.

Suggested model: sonnet (cost medium). Factory capabilities: guide.check, guide.explain.
