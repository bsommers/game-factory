# Language-neutral engine spec + conformance vectors

JS stays the reference implementation (`templates/web-project/src/lib/`). Rust/Go/Python ports are verified against golden vectors generated from it.

| Doc | Engine | Vectors | Reference runner |
|---|---|---|---|
| `rng.md` | PCG32 + legacy mulberry32/botRng | `vectors/rng.json` | `rng-reference.mjs` |
| `platformer-physics.md` | `platformer-physics.js` | `vectors/platformer-physics.json` | `reference/platformer-physics.mjs` |
| `hazard-kit.md` | `hazard-kit.js` | `vectors/hazard-kit.json` | `reference/hazard-kit.mjs` |
| `world-gen.md` | `world-gen.js` (+ fairness validator) | `vectors/world-gen.json` | `reference/world-gen.mjs` |
| `autopilot.md` | `autopilot-kit.js` | `vectors/autopilot.json` | `reference/autopilot.mjs` |

## Vector file schema
```json
{ "engine": "hazard-kit", "version": 1,
  "cases": [ { "name": "human readable", "input": { "op": "sim", "...": "..." }, "expect": { "...": "..." } } ] }
```
`input.op` selects the runner operation (documented at the end of each engine doc); `input` is pure JSON, `expect` is the runner's JSON output.
Keys are sorted; JS closures in the engine APIs are replaced by declarative fixtures (named builders, cost tables, scripted deciders), described per engine.

## How a port consumes them
1. Implement the engine from its `.md` (function signatures, step order, constants) and a small `run(input) -> output` adapter per engine doc ("Vector runner").
2. For each case: `actual = run(case.input)`; compare to `case.expect` recursively: object keys as a set, arrays in order, ints/strings/bools/null **exactly**, floats `|a-b| <= 1e-9`.
3. Use f64 everywhere the doc says so; use fmod (not floor-mod) for float `%`; use stable sorts; use only the RNGs in `rng.md`.
4. Never edit `vectors/*.json` by hand.

## Tooling
* `node spec/gen-vectors.mjs`: regenerate all vectors (deliberate action; commit the diff).
* `node spec/verify-vectors.mjs`: re-run the JS reference and diff against the committed files (exit 1 on drift). Also run by `node --test test/spec.test.mjs`.

## Findings (non-determinism audit)
No engine calls `Math.random` or `Date`. Seams: hazard-kit `g.rng` (injected; spec PCG32), autopilot `humanize(rng)` (injectable), `world-gen` `createRng` and
`createAutopilot`'s `botRng` are hard-coded integer streams (documented as legacy streams in `rng.md`; ports implement them). Collections ordering relies on array order and a stable sort.
