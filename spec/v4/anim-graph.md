# anim-graph v1 (spec)

Data-driven animation state machine. JSON in, deterministic state out. Reference: `templates/web-project/src/lib/anim-graph.js` (JS). A Godot `AnimationTree` port reads the same JSON.
Schema: `schemas/anim-graph.schema.json`. Examples: `examples/anim-graph/` (`humanoid.json`, `meshy-parkway-pete.json`).
Conventions: Y-up, metres, fixed step `dt = 1/60` passed in, no clock or randomness, runtime state is plain JSON (`snapshot()`).

## Document
```
{ version: 1, name?, parameters: {name: {type: bool|float|trigger, default?}},
  clips?: {clipName: {rootMotion?: none|extract|inplace, events?: [Event]}},
  rootMotion?: {mode?, bone?, axes?: xz|xyz, yaw?: bool, layer?: 0},
  layers: [Layer] }
Layer = { name, entry, weight?: 0..1 (1), weightParam?, blend?: override|additive, mask?: {bones[], exclude?[], descendants?: true, excludeDescendants?: true}, states: {name: State}, transitions: [Transition] }
State = exactly one of { clip } | { blend: {param, points: [{at, clip}]} } | { empty: true }, plus loop?: true, speed?: 1, speedParam?, events?: [Event]
Transition = { from: state|"*", to, conditions?: [{param, op?, value?}], exitTime?: 0..1, duration?: s (crossfade), offset?: 0..1, interrupt?: false, self?: false }
Event = { name, at (0..1 normalised) | time (s), data? }
```
Clip names are the clip names in the GLB (Meshy: `Walking`, `Running`, `Boxing_Practice` after `meshy.import` cleaning). Bone names match case- and punctuation-insensitively (`spine.001` = `spine_001`), so Rigify names (`spine`, `thigh.L`, `hand.R`) survive glTF name sanitising.

## Step semantics (normative, per `step(dt)`)
Layers are processed in order. For each layer:
1. **Transitions**: first transition in declared order whose `from` matches (state or `*`), target differs (unless `self`), is not blocked by a running crossfade (blocked unless `interrupt`), satisfies `exitTime` (state phase >= exitTime; one-shots clamp at 1) and all `conditions` fires. At most one per layer per step. Triggers named in its conditions are consumed (set false). Conditions: bool/trigger `==`/`!=` (value default true); float `== != < <= > >=` with numeric value. A transition with `duration > 0` starts a linear crossfade; the outgoing state keeps advancing.
2. **Advance**: phase += `dt * speed * speedParam / duration` (blend state duration = weight-averaged clip durations; clips in a blend share one normalised phase). Loops wrap, one-shots clamp at 1 and hold. Duration 0 finishes at once.
3. **Events**: every event whose position lies in `(phase0, phase1]` fires, in position then declaration order, only for the layer's current state (not the outgoing one). On the first step after entering a state the interval includes `phase0` so an event at 0 fires. Loops fire once per cycle. `time` is seconds in a single-clip state; blend states must use `at`. Use `at < 1` for loops (1 coincides with the next cycle's 0).
4. **Root motion** (layer `rootMotion.layer`, default 0, usually base): for each clip whose mode is `extract`, the root bone's world-space translation delta over the phase interval (loop wrap handled: end-of-cycle plus start-of-cycle segments) is accumulated, weighted by blend weights and crossfade weight. Result `{x,y,z,yaw}` is in model space (y is 0 with `axes: xz`; yaw is 0 unless `yaw: true`, radians about +Y). The consumer rotates it by the character's heading and feeds it to the movement code. `inplace` removes the clip's horizontal travel (and yaw) from the pose and reports nothing; `none` leaves the clip untouched. Pose locking subtracts the displacement relative to frame 0, so the root keeps its bind height and sway.
Then crossfade time advances; the fade ends when `fade >= duration`.

The root bone is `rootMotion.bone`, else the first skin joint whose parent is not a joint (Rigify/Meshy: `spine`, the pelvis).

## Layers and masks
Layer 0 is the base. Later `override` layers blend over the result per bone with weight `weight * maskBit * stateFade`; the mask lists bones (with descendants by default) minus `exclude`. Example upper-body attack: `mask.bones: ["spine.001"]` covers spine.001 up (arms, head) and leaves thighs on the locomotion. An `empty` state makes the layer contribute nothing; transitioning from or to it fades the layer in or out. An `additive` layer adds the delta of its clip against that clip's first frame (translation, scale added; rotation `base * slerp(I, ref^-1 * clip, w)`).

## Blend space (1D)
`points` sorted by `at`; the parameter selects two neighbours and linearly blends (poses by nlerp/slerp), clamped at the ends. Meshy rigs often have no idle clip: author one (or start the blend at the walk speed).

## Runtime state (JSON)
`{frame, params, layers:[{cur:{state,p,fresh}, prev:{state,p}|null, fade, fadeLen}]}`; `restore()` reproduces the same future exactly. Step output: `{events:[{name,layer,state,t,data?}], transitions:[{layer,from,to}], rootMotion, time}`.

## Capabilities
`animgraph.validate {graph|graphPath, glb?}` (schema + references; with `glb` every clip, mask bone and root bone must exist) and `animgraph.simulate {graph|graphPath, glb?|clips, duration, script:[{at,set,trigger}], sampleEvery}` (timeline of transitions, events, state samples, total root motion). The area is spelled `animgraph` because the surface test requires `^[a-z]+\.[a-z-]+$` for capability names.

## Godot mirror notes
`AnimationTree` state machine + `BlendSpace1D` + per-layer `AnimationNodeBlend2` with a bone filter and `Add2` for additive; root motion via `root_motion_track`; events via `Animation` method tracks or a step-driven emitter running this spec so frame data matches.
