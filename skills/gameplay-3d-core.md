---
name: gameplay-3d-core
description: Build the 3D action gameplay core: camera, animation graph, locomotion, combat, enemy AI and boss fights, with balance and fairness simulation.
triggers: [3d action game, boss fight, boss balance, third person camera, locomotion, combat system, enemy ai, animation graph, dodge roll, souls-like, action rpg, 3d gameplay]
needs: [Node 22+]
outputs: [src/gameplay/*.json, reports]
model: sonnet
cost: medium
capabilities: [camera3d.validate, camera3d.simulate, animgraph.validate, animgraph.simulate, locomotion3d.validate, locomotion3d.simulate, locomotion3d.report, combat3d.validate, combat3d.simulate, ai3d.validate, ai3d.simulate, boss3d.validate, boss3d.simulate, boss3d.fairness, boss3d.balance]
---
# gameplay-3d-core

## When to use
Build the 3D action gameplay core: camera, animation graph, locomotion, combat, enemy AI and boss fights, with balance and fairness simulation.

## Steps
1. Write data configs per module (camera, animgraph, locomotion, combat, ai, boss).
2. `<module>.validate {config}` for each, then `<module>.simulate` for deterministic runs.
3. Boss: `boss3d.fairness` checks telegraphs and punish windows; `boss3d.balance` searches player skill levels for a target win rate.
4. `locomotion3d.report` summarises speeds, jump arcs and slopes.
5. Wire into the engine only after simulations are green.

## Gotchas
- Everything is deterministic by seed; log the seed on failure.
- Fix the config, never the thresholds, when fairness fails.
- Keep frame-rate independent: fixed step simulation.

## Verification
All validate calls ok, boss3d.balance win rate within target band, boss3d.fairness reports no violations.
