# limb3d: procedural limbs (normative)

Deterministic hydra necks and tentacles. Pure JS (`templates/web-project/src/lib/limb3d.js`) with a GDScript mirror
(`templates/godot-action3d/scripts/limb/limb_core.gd`). Fixed step `dt = 1/60`, Y-up, metres, degrees in JSON, radians internally.
Schema: `schemas/limb3d.schema.json`. Examples: `examples/limb3d/`. Parity scenario: `parity/limb3d/`.
Capabilities: `limb3d.validate`, `limb3d.simulate`. Pairs with `boss3d` (parts own hp, `regrow`) and `combat3d` (hitboxes).

## State
Plain JSON: `{f, rng, count, joints[count+1][3], goal[3], motion|null, regrow|null, phase[3]}`.
`rng` is mulberry32 (uint32); only `create` draws from it (3 sway phases in [0, 2pi)). No clock, no `Math.random`.
`joints[0]` is always `root.pos`. Segment `i` runs `joints[i] -> joints[i+1]` with rigid length `L[i]`
(`segmentLengths[i]`, else `segmentLength * (1 + (lengthTaper-1) * i/(N-1))`). `radius` is a number or `{base, tip}` interpolated by `i/(N-1)`.
Initial pose: straight along `root.dir`; `goal` = rest goal.

## step(state, cfg, input) -> {events, capsules, pose, tip}
`input = {target?: [x,y,z], command?: {motion, target?}, sever?: {keep}}`. Order is fixed:
1. **sever** if `input.sever`: see Sever.
2. **command** if `input.command`: start a motion (rejected, event `commandRejected{reason}`, when the motion is unknown, another motion runs (`busy`), or `count < segments` (`severed`)). The lock point is `command.target`, else `input.target`, else root + `root.dir * 0.9 * reach`.
3. **idle goal**: `rest = root + root.dir * reach(count) * restFrac` (restFrac default 0.9). If `seek` and a target are present and `|target-root| <= seek.range` (default 1.5*reach): `rest = root + normalize(target-root) * min(dist, 0.9*reach)`, `y += seek.height`. Add sway offset `a=sway.amp*reach`, `w=2pi*sway.freq*(f/60)`: `(a sin(w+ph0), 0.5a sin(0.7w+ph1), a cos(1.3w+ph2))`.
4. **goal**: while a motion runs the goal is the motion curve value (no speed limit); otherwise the stored goal moves toward the idle goal by at most `seek.speed * dt` (default 4 m/s).
5. **solve** with the goal clamped to `0.999 * reach(count)` from the root.
6. **regrow** tick. 7. **outputs** (capsules, pose). 8. `f += 1`.

## Solver
`fabrik` runs `iterations` (default 8) iterations, warm-started from the previous pose; `follow` runs exactly one (follow-the-leader: the head leads, the body trails, more lag). Each iteration:
- backward (tip to root): `p[n] = goal`; for `i = n-1..0`, `d = normalize(p[i]-p[i+1])`; if `i < n-1` clamp `d` to `maxBend` of `normalize(p[i+1]-p[i+2])`; `p[i] = p[i+1] + d*L[i]`.
- forward (root to tip): `p[0] = root`; `prev = root.dir`; for each `i`, `d = clamp(normalize(p[i+1]-p[i]), prev, i==0 ? maxBase : maxBend)`; `p[i+1] = p[i] + d*L[i]`; `prev = d`.
Clamp = rotate `d` toward `prev` (in their plane) until the angle equals the limit. Defaults `maxBend 35`, `maxBase 60` degrees.
Guarantees after every step: `joints[0] == root`, every segment length equals `L[i]` (error <= 1e-9), bend between neighbours (forward pass) `<= maxBend`, segment 0 within `maxBase` of `root.dir`. The tip may miss an unreachable or over-bent goal; it never stretches. Zero-length vectors fall back to the reference direction.

## Motions (data)
`motions.<id> = {kind, windup, strike, recover (s), curves?, damage?, hitSegments?, ...}`. Phase lengths are `round(s*60)` frames; phase `u` runs 0..1 across the phase; curve `e(u)`: `linear`, `easeIn u^3`, `easeOut 1-(1-u)^3`, `easeInOut u^2(3-2u)`. Defaults: windup `easeInOut`, strike `easeIn`, recover `easeInOut`.
At the command: `from` = current tip, `lock` = lock point, `aim = atan2(lock.z-root.z, lock.x-root.x)`, `R = reach`, `dist = min(|lock-root|, 0.95R)`.
- `strike`: `B = root - dir_xz*retract*R + (0,lift,0)` (retract default 0.5, lift default 0.5R, dir_xz = unit XZ direction to lock), `C = lock`.
- `slam`: `B = lock + (0, height, 0)` (height default 0.8R), `C = lock`.
- `sweep`: `rr = radius (default dist)`, `h = height (default root.y+0.5)`; arc point `a(t) = root + rr*(cos(aim+arc0+(arc1-arc0)t), .., sin(..))` at height `h`; `B = a(0)`, `C = (lock.x, h, lock.z)`.
Goal per phase: windup `lerp(from, B, e)`; strike `lerp(B, C, e)` (sweep: arc point at `t = e`); recover `lerp(strikeEnd, idleGoal, e)` (strikeEnd = C, or arc end for sweep). The goal is still clamped to reach, so the tip can fall short of `C`.
Events: `telegraph{motion,kind,windup,aim,at,warning}` at the command frame (this is the readable warning; windup is the minimum telegraph), then `strike`, `recover` on the first frame of each phase, `done` on the first frame after recovery (goal returns to idle). Capsules carry `damaging: true, damage` for the last `hitSegments` (default 2) segments on strike-phase frames only.

## Capsules
One per live segment: `{id, seg, a, b, r, tip, stump, damaging, damage, motion}` in world space, order root to tip, chained (`cap[i].a == cap[i-1].b`). `stump` marks the last segment of a severed limb. Every capsule is a valid hurtbox; hosts feed `damaging` ones to combat3d as hitboxes. `segmentAt(cfg, state, point)` returns the segment whose capsule contains a hit point.

## Sever / regrow
`sever {keep}` (or `severLimb`): `keep = max(sever.minKeep (default 1), keep)`; no-op when `keep >= count` or `sever.allowed == false`. Truncates joints to `keep+1`, cancels any motion, event `sever{keep, lost, lostCapsules, cancelledMotion}` (the lost capsules let a host spawn a falling piece). If `regrow` is set a timer starts: after `delay` s (default 5), one segment is appended every `interval` s (default 1), extending the last direction; event `regrow{segments}` each time and `regrown` when full. A further sever restarts the timer. Motions are rejected until the limb is whole. A host that needs boss3d semantics (`blockedBy`, core damage) drives `sever` itself and may disable `regrow` here.

## Pose
`pose = {bones:[{i, pos, q, len}], tip, count}`; bone `i` starts at `joints[i]`, points along +Y in its local frame, `q = [x,y,z,w]` unit quaternion. `q[0] = rotBetween(+Y, d0)`, `q[i] = rotBetween(d[i-1], d[i]) * q[i-1]` (parallel transport, no twist). `rotBetween` is the shortest arc; for antiparallel vectors it is a half turn about a fixed perpendicular. Apply to `Skeleton3D.set_bone_global_pose` (Godot) or bone matrices.

## Output rounding and parity
Outputs (capsules, pose, tip) are rounded to 1e-4 (negative zero normalised); state is not. The GDScript mirror uses `Vector3` (float32), so parity is to a tolerance (0.005 m / quaternion component in `parity/limb3d/scenario.json`), event order and counts exactly. `simulate(cfg, {steps, seed, sample, targets:[{f,pos}], commands:[{f,motion,target?}], severs:[{f,keep}]})` is the shared driver; targets interpolate linearly, `hash` is FNV-1a over trajectory, events and final pose.
