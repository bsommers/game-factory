---
name: add-physics-hazards-worldgen
description: Add platformer physics, hazards, seeded level generation, fairness validation and an autopilot using the src/lib kits. Use when: physics, platformer, gravity, jump, hazards, hazard.
---

# Physics, hazards and world generation

## When to use
A side-scroller or platformer needs jumps, pits, one-way/moving platforms, ropes, patrolling or rolling enemies and generated levels that are always beatable.

## Steps
1. Import from `src/lib/`: `platformer-physics.js` (fixed step), `hazard-kit.js` (behaviour registry), `world-gen.js` (rule table + validator), `autopilot-kit.js` (bot parts).
2. Put numbers in `TUNING` in the shared defs file; use `jumpRange`/`jumpHeight` from the lib to derive `MAX_PIT`.
3. Write a sweep script first for any reach geometry (vines, ropes) and tune from its output.
4. Generate with per-screen seeded streams; validate with a reachability predicate; add a "different seed gives different output" test.
5. Stagger cyclers (phase = `i * period / 3`).

## Gotchas
- Measure gaps from the screen edge with a landing gap, not from the clearance zone.
- Rolling hazards stay off deadly-pit, lethal-static and collectible screens.
- Standing height is `y - h` (top of box); test with the entity actually spawned.
- A 44 px tunnel with a 52 px jump cannot be jumped; make such routes optional.
- Poll input once per frame and carry jump edges until a sim step consumes them.

## Verification
`node --test test/lib/*.test.mjs`; run the validator on 200 seeds; the autopilot finishes a level.

Suggested model: sonnet (cost medium).
