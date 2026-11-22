---
name: meshy-intake-generate
description: Bring Meshy models into a project: generate from text or image, poll status, import, split, map rigs and verify the resulting .glb files.
triggers: [meshy, import meshy model, meshy generate, text to 3d, image to 3d, meshy rig, rig map, meshy status, meshy glb]
needs: [Node 22+]
outputs: [assets/models/*.glb]
model: sonnet
cost: medium
capabilities: [meshy.generate, meshy.status, meshy.import, meshy.split, meshy.rig-map, meshy.verify, anim.inspect, anim.merge]
---
# meshy-intake-generate

## When to use
Bring Meshy models into a project: generate from text or image, poll status, import, split, map rigs and verify the resulting .glb files.

## Steps
1. `meshy.generate {prompt|image}` starts a job (needs MESHY_API_KEY; offline/dry-run otherwise); `meshy.status {id}` polls it.
2. `meshy.import {inputs}` copies downloaded files into assets/models with provenance.
3. `meshy.split` separates parts; `meshy.rig-map` maps Meshy bones to the game skeleton.
4. `meshy.verify` checks the result, then use animated-models for clips.

## Gotchas
- Generation costs credits: confirm before looping.
- Keep licence and provenance data with every imported file.
- Compressed glb is unsupported; re-export uncompressed.

## Verification
`meshy.verify` ok on every imported model and `node --test test/meshy-generate.test.mjs` passes.
