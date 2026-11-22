# camera3d contract (v4)

Third-person camera rig: `templates/web-project/src/lib/camera3d.js`. Pure and deterministic: no Date, no Math.random, no globals. Y-up, metres, radians (fov in degrees), fixed step `dt` (normally 1/60) passed in. All state and config are plain JSON, so a Godot/other port can mirror it from the same data.

## Config (JSON)
Schema: `spec/v4/schemas/camera3d.schema.json`; examples in `spec/v4/examples/camera3d/`. Every key is optional; `createConfig(partial)` deep-merges over `DEFAULT_CONFIG`. Sections: `follow` (distance, minDistance, height, shoulder, pitch/minPitch/maxPitch, positionLag, rotationLag, probeRadius, collisionRecoverLag), `lockOn`, `aim`, `fov`, `shake`. `*Lag` values are exponential time constants in seconds (0 = instant), applied as `k = 1 - exp(-dt/lag)`. `checkConfig(cfg)` adds semantic rules (pitch range ordered, minDistance <= distance, ...).

## Conventions
yaw 0 puts the camera at +Z of the pivot looking toward -Z. Camera offset direction `(sin yaw cos pitch, sin pitch, cos yaw cos pitch)`; right `(cos yaw, 0, -sin yaw)`. Pivot = smoothed player feet + `(0, follow.height, 0)`.

## State and step
`createCamera(cfg, {target, yaw?, pitch?})` returns state `{yaw, pitch, pivot, boomScale, collided, lockBlend, aimBlend, fovKick, trauma, time, seed, out}`.
`stepCamera(state, cfg, input, world, dt)` with `input = {target:[x,y,z], yawDelta?, pitchDelta?, lock?:[x,y,z], aim?:bool}`. Result in `state.out = {pos, target, up, fov, roll, distance}`. Order per step: pivot smoothing, lock-on/orbit orientation, aim blend, boom sweep, FOV, shake.

## Collision boom
A sphere of radius `probeRadius` is swept with `collision3d.sweepSphere` from the shoulder-offset pivot along the boom (length = follow/aim distance + lock framing). `world` is a flat triangle array or a `bvh.asWorld` object. The boom shrinks instantly to the hit (never clips) but never below `minDistance`, and recovers with `collisionRecoverLag`. `state.collided` is true while the boom is shortened by geometry.

## Lock-on, aim, FOV, shake
- Lock: with `input.lock` set, yaw rotates to put the player-to-target line behind the player, pitch eases to `lockOn.pitch`, the look point moves `framing` of the way to the target, and the boom lengthens by `framingDistancePerMetre * separation` (capped by `maxExtraDistance`). `pickLockTarget(origin, facing, candidates, cfg, world?)` scores by angle and distance with a line-of-sight sweep; `switchLockTarget` flicks left/right.
- Aim: `aim.distance`, `aim.shoulder`, `aim.offset [x,y]` and `aim.fov` blended in by `aim.blendLag`.
- FOV: `kickFov(state, deg)` adds degrees that decay with `fov.kickDecay`; result clamped to `fov.max`.
- Shake: `addTrauma(state, amount)` (clamped 0..1), decays linearly at `shake.decay`/s; intensity = trauma^power; seeded value-noise (hash of `shake.seed`, channel, `time*frequency`) drives yaw/pitch/roll and x/y offset on the output only, never fed back into the rig.

## Helpers
`boxToTris`, `simulate(cfg, frames, world, dt)`, `noise1`.

## Capabilities
`camera3d.validate {config}` (schema + semantic check) and `camera3d.simulate {config?, world?, path, ...}` return `{ok,data,error,next}`.
