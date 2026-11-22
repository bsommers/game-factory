# locomotion3d (spec v4)

Third-person movement layer over `collision3d`'s capsule character (`createCharacter` / `moveAndSlide`, see `spec/v3/collision3d.md`). Reference implementation: `templates/web-project/src/lib/locomotion3d.js`. Pure, deterministic, zero deps, Y-up, metres, fixed step `dt = 1/60`, plain JSON state, no `Date` / `Math.random`. A Godot (or other) port mirrors the algorithm below from the JSON config. Config schema: `spec/v4/schemas/locomotion3d.schema.json`; examples: `spec/v4/examples/locomotion3d/{hero,heavy,small-fast}.json`.

## Conventions
- Yaw 0 faces -Z; positive yaw turns toward -X. `forward(yaw) = [-sin, 0, -cos]`, `right(yaw) = [cos, 0, -sin]`.
- Character pos = feet centre (collision3d). The layer owns gravity and jump (it supplies `vel.y` to `moveAndSlide`).
- State is `loco = {cfg, ch, hv:[x,z], vy, yaw, t, state, stateTime, coyote, buffer, airJumps, airDodges, jumping, cutDone, dodge:{dir,u}|null, dodgeCd, stun, launched, landLock, landMul, invulnerable, mode}`. `hv` is the self-propelled horizontal velocity; platform, conveyor and current drift are added per step and never stored in `hv`.

## API
- `createLocomotion(cfg, {pos, yaw})`, `stepLocomotion(loco, input, dt, world, env) -> output`, `applyImpulse(loco, [x,y,z], {stun, setVertical})`.
- `defaultConfig()`, `mergeConfig(partial)`, `validateConfig(cfg) -> string[]`, `jumpProfile(cfg, {hold})`, `hashState(v)` (FNV-1a over JSON), `DT`, `STATES`, `CONFIG_SPEC`.
- `input = {move:[x right, y forward] (-1..1), camYaw, sprint, jump (pressed this step), jumpHeld, dodge (pressed this step)}`. Move is rotated by `camYaw` (camera-relative).
- `env` (all optional pure callbacks, called with the feet position):
  - `water(pos) -> null | {surfaceY, flow?:[x,y,z]}` water volume; depth = `surfaceY - pos.y`. Flow is a current velocity carrying the character.
  - `surface(pos, groundNormal) -> null | {friction?, flow?:[x,y,z], slide?}` ground under the feet. `friction` multiplies ground accel/decel (ice = 0.08); `flow` drifts the character (conveyor, sewage current); `slide:true` forces slide state.
  - `platform(pos, groundNormal) -> null | [vx,vy,vz]` moving platform velocity. Horizontal part carries the character; the caller moves the platform geometry (vertical motion is resolved by collision depenetration and ground snap). Jumping inherits it when `jump.inheritPlatform`.
  - `force(pos, state) -> null | [ax,ay,az]` acceleration field on `hv` / `vy` (wind, whirlpool pull). Opposed by the normal accel/decel, so equilibrium speed is about `a / rate`.
- Output (animation graph input): `{locomotionState, stateTime, speed, speedNorm, grounded, verticalVelocity, yaw, facing, pos, invulnerable, dodgeProgress, mode ('ground'|'wade'|'swim'), events[]}`. `speed` is `|hv|` (self-propelled, excludes carry). `events`: `jump`, `airJump`, `dodge`, `dodgeEnd`, `land`, `hardLand`, `touchdown`, `leftGround`.
- `locomotionState` is one of: `idle walk run sprint jump fall land dodge stagger launched wade swim slide`. Priority: dodge > swim > stagger/launched > slide > air (jump if vy>0 else fall) > land lock > wade > ground tier. Ground tier: `idle` under 0.15 m/s, `walk` below the midpoint of walk and run speed, `run`, `sprint` above `runSpeed`.

## Step algorithm (one call = one fixed step)
1. Decrement timers (dodge cooldown, stun, land lock, coyote, jump buffer). `input.jump` loads the buffer (`jump.bufferTime`).
2. Query env: water (swim if depth >= `swim.swimDepth`; wade if depth >= `wadeDepth` and grounded), surface, platform. Slide if grounded and `groundNormal.y < cos(slide.minAngleDeg)` or `surface.slide`.
3. Dodge start: pressed, cooldown 0, not stunned, not swimming, and grounded (or `dodge.airDodges` left). Direction = camera-relative input, else facing. Cancels jump variable-height state.
4. Dodge motion: displacement per step is `distance * (F(u1) - F(u0))` with `u = elapsed/duration`, `F(u) = u` (constant) or `1 - (1-u)^2` (easeOut, speed decays linearly). The sum telescopes, so total distance equals `dodge.distance` exactly on open ground. `invulnerable` is true while `[iframeStart, iframeEnd]` (seconds since dodge start) overlaps the step. On the last step `hv` becomes `dir * exitSpeed` and `dodgeCd = cooldown`.
5. Otherwise target speed: stick magnitude `m`; `m < runThreshold` -> `walkSpeed * m/runThreshold`; else `runSpeed` (or `sprintSpeed` with `sprint`). Swim uses `swim.speed*m`, wade multiplies by `wadeSpeedMul`. Land lock (`hardMoveMul`), stun (0) and slide (`slide.control`) scale control. `hv` approaches the target vector at a linear rate: ground `accel`/`decel` x surface friction, air `accel`/`decel`, stunned `knockback.groundDecel`/`airDecel`, swim `swim.accel`. Slide adds downhill acceleration `slide.accel` (clamped to `slide.maxSpeed`). Yaw turns toward intent at `turnRateDeg` (ground) / air `turnRateDeg`, shortest arc.
6. Vertical. Swimming: `vy` eases (`verticalDamp`) toward `clamp((surfaceY - floatOffset - y) * buoyancy, +-maxVerticalSpeed)`; a jump within `exitJumpWindow` of the swim depth launches out at `jump.speed * exitJumpMul`. Otherwise: grounded refreshes coyote (`coyoteTime`), air jumps and air dodges. A buffered jump fires if coyote > 0 (ground jump, sets `vy = jump.speed`) or if airborne with `airJumps` left (`airJumpSpeed`). Releasing the button while rising multiplies `vy` once by `cutMultiplier` (variable height). Gravity `air.gravity`, times `fallGravityMul` when falling, semi-implicit Euler (`vy -= g*dt` then move), clamp `maxFallSpeed`.
7. `moveAndSlide(ch, [hv.x + carry.x, vy + flow.y, hv.z + carry.z], dt, world)`. Blocked components are removed from `hv` (`hv += actual - commanded`).
8. Landing: grounded after air with fall speed >= `land.minSpeed` -> land lock `land.time`; >= `land.hardSpeed` -> `land.hardTime` with `hardMoveMul` control.
9. Knockback: `applyImpulse` adds to `hv` (x,z) and `vy` (y; y>0 leaves the ground and sets `launched` until landing), sets `stun`, cancels an active dodge.

## Config
Sections `body, ground, air, jump, land, dodge, swim, slide, knockback` (see schema for keys, defaults and ranges; `CONFIG_SPEC` in the lib is the source of truth and the schema is generated from it). Every key is optional; missing keys take defaults. `locomotion3d.validate` adds cross-field rules: `walkSpeed <= runSpeed <= sprintSpeed`, `iframeStart <= iframeEnd <= duration`, `wadeDepth < swimDepth`, `floatOffset <= height`, `land.time <= land.hardTime`, `stepHeight < height`. `body.*` feed `createCharacter` (`slopeLimitDeg` -> `minGroundY = cos`).

## Capabilities (factory-core/locomotion3d)
- `locomotion3d.validate {config | file}` -> `{valid, config(merged)}`; errors `BAD_INPUT` (details list) / `NOT_FOUND`.
- `locomotion3d.simulate {config|file, world, script, start, yaw, sampleEvery}` -> `{timeline, final, steps, states (frames per state), events, maxSpeed, apexHeight, hash, dt}`. Worlds: `flat, wall, ramp{angleDeg}, ice{friction}, conveyor{flow}, river{surfaceY, flow}, platform{velocity}` (water, surface and platform worlds use z < -5 / the origin patch as documented in the capability source). Script segments: `{frames|seconds, move, camYaw, sprint, jump (first frame), jumpHeld, dodge (first frame), impulse, stun}`. 30 settle steps run before the script.
- `locomotion3d.report {config|file}` -> jump apex (analytic and measured, full vs tap), dodge distance from rest and while running, i-frame frames, run/sprint ramp and stop time, terminal fall and hard-landing heights, warnings.

## Determinism
Same config, inputs, world and env callbacks give bit-identical state on one runtime; `hashState` of the state/log is used in tests. Cross-runtime (Godot port) expectations follow the collision3d vector policy: float compare at 1e-9 for positions, states and events exactly.

## Requests for collision3d (done in spec/v3/collision3d.md, "Ground info and moving ground")
- `ch.groundIndex` / `ch.groundMaterial` (world `{tris, materials}`) from `moveAndSlide`, and `ch.groundVelocity` as an input hint for moving/rising platforms. `env.surface` / `env.platform` may now key on these instead of position tests.
