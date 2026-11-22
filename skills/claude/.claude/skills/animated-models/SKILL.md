---
name: animated-models
description: Bring rigged, animated .glb models (Meshy, Blender, Mixamo) into a game: inspect clips and skeleton, import into assets/models, merge clips from several files, and play them with crossfades and CPU or GPU skinning. Use when: animated model, animation, animated glb, rigged, skeleton, skinning.
---

# Animated .glb models

## When to use
You have rigged, animated models exported as binary glTF (`.glb`), for example from Meshy or Blender, and want them in a game.

## Steps
1. `anim.inspect {input}`: joints, clips with durations, guessed states (idle, walk, run, jump, attack, ...), bounds, warnings. Compressed (Draco/meshopt) files come back UNSUPPORTED with the fix; re-export uncompressed.
2. `anim.import {inputs: [...]}`: copies into `assets/models/`, writes `manifest.json` and `models.js`. Files sharing a rig are reported under `sameRig`.
3. Meshy exports one clip per file: `anim.merge {base, inputs, out}` combines clips into one `.glb` (matched by bone name; use `prefix` or `rename` for tidy clip names).
4. Verify without rendering: `anim.sample {input, clip, time}` returns the posed bounds and joint positions.
5. In the game: `import { parseAnimGLB, AnimPlayer } from './lib/gltf-anim.js'`; `const player = new AnimPlayer(parseAnimGLB(bytes))`; `player.setState('walk')` (crossfades); each frame `player.update(dt)`, then `player.skinned()` (CPU skinned positions, model space) or `player.jointMatrices()` (GPU skinning, column-major).

## Gotchas
- glTF is metres, Y up, right-handed; scale and rotate in your renderer, not in the file.
- `setState` falls back to `idle` for unmapped states; override with `new AnimPlayer(model, {states: {walk: 'Armature|Walking'}})`.
- Morph targets, non-triangle primitives and external `.bin` files are not supported; they are reported in `warnings`, never dropped silently.
- Non-looping states (jump, attack, hurt, die) hold the last pose and set `player.finished`.

## Verification
`anim.inspect` reports no warnings you did not expect and lists every clip you exported; `anim.sample` at two times of a clip returns different joint positions; `node --test test/anim.test.mjs` passes.

Suggested model: haiku (cost low). Factory capabilities: anim.inspect, anim.import, anim.merge, anim.sample.
