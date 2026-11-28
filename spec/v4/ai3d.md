# ai3d spec (v4)

Reference: `templates/web-project/src/lib/ai3d.js`. Schema: `spec/v4/schemas/ai3d.schema.json`. Examples (full headless scenarios): `spec/v4/examples/ai3d/{grunt,ranged,charger,group-token}.json`. Capabilities: `ai3d.validate`, `ai3d.simulate`.

Contract: pure deterministic JS, zero deps, Y-up, metres, fixed step `dt = 1/60`, JSON-serialisable state. No `Date`/`Math.random`: each agent owns a uint32 `rng` (mulberry32) seeded by the caller. Steering and distances work on the XZ plane (y ignored). A Godot port reads the same config JSON and mirrors `tickAgent`; equal inputs must give equal intents (tolerance 1e-9, `cos` for the FOV cone is the only transcendental in decisions besides slot `atan2/cos/sin`).

## Intent (output of one tick; what locomotion and combat consume)
```
{ moveDir:[x,0,z]   unit vector, or [0,0,0] when standing
  speed:   number   multiplier of config stats.moveSpeed (0..1 normally; a charge may exceed 1)
  wantAttack: moveId|null   a move id from config.moves requested THIS tick (edge, not level)
  lookAt: [x,y,z]|null      point to face (locomotion turns toward it)
  state: string            label of the leaf that ran: idle|wander|seek|path|flee|keepDistance|orbit|surround|attack|windup|dash|recover|hold|reset
  target: id|null           current aggro target
  tell: string|null         telegraph tag for animation/VFX (set during a charge windup)  }
```
The AI never moves the agent. The host moves it, then writes `agent.pos`, `agent.facing` (unit XZ), `agent.hp` before the next tick.

## Agent state
`createAgent({id, config, role?, pos, facing?, seed, hp?})` -> `{id, config, role, pos, facing, hp, maxHp, spawn, rng, time, perc:{known:{id:{pos,t,seen,how}}, heardPos, heardT}, threat:{id:n}, target, cd:{}, mem:{}, slot, state}`. `cd` holds cooldown and move-ready deadlines, `mem` holds per-node running memory (cleared for nodes not visited in a tick), `slot` is the group-assigned surround angle (radians) or null.

## Config
`{version:1, id, role: melee|ranged|charger|support, stats, perception, threat, steering, leash, moves, tree}`; unspecified blocks take defaults (`DEF` in ai3d.js).
- `stats {moveSpeed 3.5, turnRate 8 rad/s, radius, eyeHeight 1.6}`
- `perception {sightRange 15, fovDeg 110, awareness 1.5 (always sensed inside, any direction), hearRadius 8, memorySec 6, targetEyeHeight 1.4}`
- `threat {sightGain 1/s, hearGain 0.5/s, damageGain 1, decay 0.1 (per second, linear), switchRatio 1.25}`
- `steering.separation {radius 1.2, weight 0.8}` pushes agents in `world.agents` apart.
- `moves.<id> {range:{min,max}, cooldown, duration, tokens, needsLos}`; `tokens > 0` means the move needs a group attack token.

## Perception, memory, threat
Per tick for each `world.targets[] {id,pos,noise?}` (sorted by id): seen if `dist <= sightRange`, and (`dist <= awareness` or the target lies within the FOV cone about `facing`), and line of sight is clear from the eye (`pos.y + eyeHeight`) to the target eye. LOS uses `world.los(from,to)` if given, else a `bvh.raycast` (bvh.js, `tmax = dist - 1e-4`) against `world.bvh`, else is clear. Heard if `dist <= hearRadius * target.noise`; one-shot `world.sounds[] {pos, loudness?, source?}` are heard within `hearRadius * loudness`. Seen/heard refreshes `known[id] = {pos, t, seen, how}`; entries expire `memorySec` after last sensing (the last known position stays usable meanwhile). `world.events[] {type:'damage', source, target, amount}` add threat and reveal the attacker. Threat grows while sensed (sight scaled by 1 - 0.5*dist/sightRange), decays linearly, and the target is the highest-threat known entity (ties: lowest id) with hysteresis `switchRatio`.

## Behaviour tree
Re-evaluated from the root every tick (reactive). Statuses success|failure|running. Nodes:
- `selector`, `sequence` `{children, memory?}`: with `memory:true` the node resumes at its running child and skips earlier checks (use for multi-phase actions like a charge).
- `invert`, `succeeder` `{child}`.
- `condition {test, not?, ...args}`: always, never, hasTarget, canSee, remembers (known but not visible), heard {within}, inRange {min,max}, healthBelow {pct}, outsideLeash {radius}, nearSpawn {radius}, hasToken, tokenAvailable, moveReady {move}, roll {p}, timeSinceSeen {gt,lt}, hasSlot, role {is}.
- `cooldown {seconds, id?, child, on?}`: fails while cooling; starts on child success (`on:"done"` also on failure).
- `weighted {children, weights? | child.weight, hold?}`: seeded random pick, kept while the child runs and for `hold` seconds.
- `utility {options:[{name, weight, consider:[{input,min,max,invert,power}], node}], stickiness}`: score = weight * product of normalised considerations (inputs: dist, healthPct, visible, hasToken, tokenFree, timeSinceSeen, threat, hasTarget); highest wins (ties: first), current option gets `stickiness` (default 1.2); all-zero fails.
- `action {do, ...}`: `to` is target|lastKnown|spawn|heard.
  - `idle`; `wander {radius, interval, speed}`; `seek|arrive|path {to, stop, slow, speed, repath, reach, face}` (`path` asks `world.nav` unless `nav.isClear` says the straight line is free); `flee {from, dist}`; `keepDistance {min,max,speed}` (success when inside the band); `orbit {radius, dir: cw|ccw|random, speed, duration}`; `surround {radius}` (go to the group slot around the target); `face`; `attack {move}` (needs a target, range, cooldown ready, LOS if `needsLos`, a token if `tokens>0` and a group exists; success emits `wantAttack`); `charge {windup, speed, maxDist, recover, hitDist, hitMove, tell}` (windup standing and facing with `tell`, then a locked-direction dash at `speed`x, stops at `maxDist` or `hitDist` from the target, then recovery); `dropAggro` (clear threat/memory).

## Steering (pure functions)
`seek, arrive(pos,target,slow,stop), flee, separation(pos,others,radius), orbit(pos,target,radius,sign), keepDistance(pos,target,min,max), combine(parts,cap)` -> `{dir, speed}`. `orbit` sign +1 is counter-clockwise about +Y. Contributions are summed weighted by speed and the resultant magnitude is clamped to `max(1, largest contribution speed)`.

## Navigation
`NavProvider`: `findPath(from,to,opts?) -> [[x,y,z],...]` waypoints excluding `from`, ending at the (snapped) goal, or null; optional `isClear(from,to) -> bool`. Built-ins: `createGridNav({origin:[x,z],cellSize,width,height,blocked})` (8-neighbour A*, octile heuristic, no corner cutting, heap tie-break by f, h, index, then string-pulled), `gridFromBoxes(boxes,{...,inflate,yRange})`, `createWaypointNav({nodes:[{id,pos}],edges})`. A recast/Detour navmesh plugs in by implementing the interface.

## Groups
`createGroup({maxAttackers, ttl})`; `groupRequest/Release/Holds/Free`. A token lasts `ttl` (attack moves refresh it for `duration`). `groupUpdate` assigns melee agents evenly spaced angle slots around the target, choosing the slot rotation that minimises angular travel. `tickAll(agents, configs, world)` ticks agents in id order so token grabbing is deterministic.

## Simulation scenario (`ai3d.simulate`)
`{configs, agents, group?, world?:{walls (AABBs for LOS), grid | waypoints}, target:{id,noise,path:[{t,pos}]}, sounds?, events?, duration, seed?, dt?}`. A kinematic integrator stands in for locomotion. Output: a decision timeline (an entry whenever an agent's state/wantAttack/target changes), attack counts, token stats and an FNV-1a `hash` of every tick's (agent, state, wantAttack, rounded position), used as the determinism gate.
