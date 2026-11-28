---
name: img2model-rig
description: Rig a model from an image: silhouette extraction, procedural model build and verification against the source image. Use when: rig model from image, img2model, image to model, silhouette, image to 3d model, procedural model.
---

# img2model-rig

## When to use
Rig a model from an image: silhouette extraction, procedural model build and verification against the source image.

## Steps
1. `img2model.silhouette {image}` extracts the outline and reports quality.
2. `img2model.build {image, out}` builds the rigged model from it.
3. `img2model.verify` compares the render silhouette to the source.

## Gotchas
- Needs a clean background; low contrast images fail the silhouette step.
- Output is stylised, not photoreal; use meshy-intake-generate for that.

## Verification
`img2model.verify` returns ok and the silhouette IoU above the threshold.

Suggested model: sonnet (cost medium). Factory capabilities: img2model.silhouette, img2model.build, img2model.verify.
