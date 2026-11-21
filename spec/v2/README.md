# spec/v2 (2D collision + physics conformance)

- `collision2d.md`, `physics2d.md`: behaviour specs for porting `templates/web-project/src/lib/collision2d.js` and `physics2d.js`.
- `vectors/collision2d.json`, `vectors/physics2d.json`: golden `{engine, version, cases:[{name,input,expect}]}` generated from the JS reference. Ints exact, floats 1e-9.
- `gen-vectors.mjs`: the generator; its `op` names (collide, distance, contains, bounds, raycast, shapeCast, sweptAABB, moveAABB, hash, tilemap; sim, character) are the runner contract.

Regenerate: `node spec/v2/gen-vectors.mjs`. Check drift (exit 1 on mismatch, run in CI): `node spec/v2/gen-vectors.mjs --check`. Never hand-edit vectors; change the reference, regenerate, and update the spec.
