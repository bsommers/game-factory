# boss3d: data-driven multi-phase, multi-part boss

Pure deterministic JS reference (`templates/web-project/src/lib/boss3d.js`), zero dependencies, ES module. Y-up, metres, fixed step `dt = 1/60`. State is plain JSON; the only randomness is a seeded mulberry32 stored in `state.rng`. No `Date`, no `Math.random`. A Godot port mirrors it from the same JSON (schema: `spec/v4/schemas/boss3d.schema.json`, examples: `spec/v4/examples/boss3d/`). Times in data are seconds; the runtime rounds to frames (`round(s*60)`).

## Host contract

```js
const def = JSON.parse(...);            // boss JSON
const s = createBoss(def, seed);        // JSON-serialisable state
const r = step(s, def, { target: { pos: [x,y,z], invulnerable, resisting, radius }, hits: [{ part: 'head_a'|'core', damage, weak }], commands: [{ type: 'sever'|'stun'|'stunAll'|'flag', part, seconds, name, value }], flags: { sealed: true } });
// r = { events, force:[fx,fy,fz], playerDamage, done }
```

`force` is a drift velocity (m/s) to add to the target's movement (vortex pull). `playerDamage` is the HP the target loses this frame (the host may also read `damage` events). `target.invulnerable` (dodge i-frames) suppresses damage. Hits are requests from the host's combat system; the boss applies armour, weak-point and stun multipliers, stagger and part death.

Events (`state.log` holds all of them, `{f, type, ...}`): `telegraph` (resolved world zone + `warning` data + windup/active seconds, for decals/VFX/audio), `lock` (tracking zone froze), `active`, `recovery`, `attackEnd`, `cancel`, `damage` (`kind` attack|hazard), `hit`, `blocked`, `partDown`, `regrow`, `stun`, `stagger`, `enrage`, `coreDamaged`, `phase`, `heal`, `spawn` (adds), `hazardStart`, `hazardPulse`, `hazardEnd`, `flag`, `defeated`. `hashJSON(state.log)` is the determinism hash.

## Definition

- `core {hp, pos, radius, armor, stunMult, exposedWhen}`: the boss HP pool. `exposedWhen`: `"always"` or any-of `{partsDownAtLeast, phase, phaseIndexAtLeast, stunned, flag}`. Hits on a covered core are `blocked`.
- `parts[]`: named heads/limbs. `hp`, `pos` (offset from boss), `armor`, `weakPoint {multiplier, open}` (`open`: `always` or any of `idle windup active recovery stun`, default recovery+stun; only `weak:true` hits get the multiplier), `stagger {threshold, duration, decayPerSec}` (damage accumulation stuns the part and cancels its attack), `regrow {time, hpFrac, blockedBy}` (timer pauses while `flags[blockedBy]`, e.g. a sealed valve), `coreShare`, `onDeath {coreDamageFrac, stagger (all parts), enrageSpeed, clearAttacks, spawn, hazard, setFlag}`. `sever` command kills a part immediately.
- `phases[]`: `enter` (any-of `hpBelow`, `totalHpBelow`, `time`, `partsDown`, `phaseSeconds`, `flag`; phase 0 has none, phases only advance forward), `transition {invuln, heal, clearAttacks}`, `reviveParts`, `maxConcurrent`, `gap` (seconds between attack starts, number or `[min,max]`), `adds [{at, kind, count, radius}]`, `attacks[]`.
- Attack: `{id, part?, weight, cooldown, windup, active, recovery, damage|dps, rehit, minDist, maxDist, requires {partsAlive, partsDead, hpBelow, hpAbove, enraged, flag}, zone, warning}`. One attack per owner (body or part) at a time, `maxConcurrent` at once. Weighted pick (seeded) among off-cooldown, condition-satisfying attacks of free, living, unstunned owners. Recovery doubles as the weak-point window.
- Zone shapes (XZ plane, locked at windup start, `lockFrac` keeps tracking the target for that share of the windup): `circle {r, at}`, `cone {r, angle}`, `line {length, width}`, `ring {rInner, rOuter, at}`, `sweep {r, width, arc:[a0,a1]}` (a beam rotating from aim+a0 to aim+a1 across the active window). `maxY` lets a jump clear the zone.
- `hazards[]` (timed from fight start, or from phase entry when `phase` is set; `manual:true` or `onDeath.hazard` starts them on demand): `flood {fromY,toY,rise,dps}` (damage below the level, `arena.platforms` give high ground); `vortex {center,radius,strength,falloff,swirl,ramp,coreRadius,coreDps,pulse,resistFactor}` (force `strength*(1-d/radius)^falloff`, plus tangential `swirl`, `pulse` windows with a telegraph event); `debris {interval,count,r,damage,telegraph,aimAtTarget,area}` (seeded impact circles with telegraph); `gas {center,radius,growTo,grow,dps,windup}`.
- `enrage {afterSeconds|hpBelow|phase, speedMult, damageMult, windupMult}`: speed scales gap/cooldown/active/recovery; `windupMult` scales telegraphs (the fairness gate checks the result).

## Fairness validator (`fairness(def, opts)`)

Static: every windup >= `reactionMs` (default 350, after enrage `windupMult`); warning data present; every attack avoidable under the dodge profile (`moveSpeed`, dash `distance`, `iframeMs`, `cooldownMs`, `jumpHeight`): the worst-case escape distance from the zone (numeric) must be reachable in `windup - reaction`, or a one-shot attack must fit inside the i-frame window with the dodge off cooldown, or the zone must be jumpable; for every combination of simultaneous attacks (sampled target positions) plus persistent gas/vortex core a safe point exists in the arena within reach; flood needs reachable platforms above `toY` and a sane rise rate; vortex pull must stay under 90% of move speed (or have a resist mechanic); debris/gas/pulse telegraphs; max simultaneous threats (default 4; ambient vortex/flood forces are reported, not counted).
Simulated: an oracle bot (perfect dodging at the reaction floor) fights several seeds; fails on mean damage over `oracleDamageFrac` of its HP, or any attack that hits it more than `attackHitRate` of launches. Findings are `{severity, code, path, message}`; `pass` is true when there are no errors.

## Headless sim (`simulate(def, {runs, seed, profile})`)

A bot (profile: `hp, moveSpeed, reactionMs, dodgeDistance, iframeMs, dodgeCooldownMs, dodgeSkill, attackDamage, attackIntervalMs, range, weakAwareness`) perceives telegraphs after its reaction time (and fumbles a share set by `dodgeSkill`), walks or dashes out of zones, climbs platforms when flooded, leans against vortex pull, and attacks exposed weak points, then covered parts, then an exposed core. Reports `winRate, deathRate, timeoutRate, timeToKill {mean,median,p90}, damageTaken, phaseSeconds, attackLaunches, attackHits, killedBy, maxThreats, hash`. The same seed and definition always give the same hash.

## Capabilities

`boss3d.validate`, `boss3d.fairness`, `boss3d.simulate` (CLI/HTTP/MCP/import); input is `boss` (inline) or `file` (project-relative).
