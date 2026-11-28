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

## Skill tiers and balance (`SKILL_TIERS`, `TIER_BANDS`, `balance(def, opts)`)

Additive; `simulate`/`fairness` and their hashes are unchanged. `SKILL_TIERS` are bot profiles: `novice` (reaction 520 ms, dodgeSkill 0.68, weakAwareness 0.35, slower attacks), `average` (450 ms, 0.72), `expert` (400 ms, 0.8) and `oracle` (the fairness oracle). `balance` runs `runs` (default 100) seeded fights per tier and reports `winRate`, `timeToKill`, `damageTaken`, `deaths`, `timeouts`, `deathsByPhase` and a hash, with `pass` per tier against `TIER_BANDS` (novice 10-35%, average 40-65%, expert 70-90%, oracle 85-100%; override with `bands`). A 100% win rate for a non-oracle tier is a tuning failure, not a success. Tune the boss JSON (hp, damage, cooldowns, telegraphs, hazard dps) until every tier is in band while `fairness` still passes; note that oracle damage comes mostly from hazards (vortex core, flood), so raise attack damage rather than hazard dps to add difficulty.

## Capabilities

`boss3d.balance` (tier win-rate bands plus the fairness gate; `ok:false`/`TASK_FAILED` lists the tiers out of band), `boss3d.validate`, `boss3d.fairness`, `boss3d.simulate` (CLI/HTTP/MCP/import); input is `boss` (inline) or `file` (project-relative).

## Determinism contract for ports (clarifications from the Godot parity run)

`runFight` / `simulate` are normative for a port, not just the step function: the bot, its seeding and the log hash are all part of the result. The GDScript mirror (`templates/godot-action3d/scripts/boss/boss3d.gd`) reproduces `simulate().hash` and every run's `logHash` for `hydra` and `vortex`; `parity.run {module: boss3d}` checks six bot profiles (see `spec/v4/PARITY.md`).
- `hashJSON(log)`: FNV-1a 32 over the UTF-16 units of `JSON.stringify(log)` (same function as combat3d). Events keep the key order of the `emit` calls; numbers print as ECMAScript `Number#toString`. The log is capped at 60000 events (`logDropped` counts the rest).
- Events hold **references**: `telegraph.zone` is the live `inst.zone` object, so a gas hazard growing its radius (`a.zone.r = a.zone.rOuter = r4(...)`) rewrites the already-logged telegraph, and the hash sees the final radius. A port must log the same object, not a copy. (Tracking zones are replaced, not mutated, so their logged zone stays the first one.)
- Randomness: the boss uses `state.rng` (`seed >>> 0 || 1`), the bot its own `rng = ((seed ^ 0x9e3779b9) >>> 0) || 7`; both are mulberry32 (`combat3d.md`, "RNG"). `simulate` runs seeds `seed + i * 7919`. The sim hash is `hashJSON(results.map(r => [r.seed, r.won, r.timeSeconds, r.damageTaken, r.logHash]))`.
- Draw order matters: debris draws `aimAtTarget` first, then (only if it missed) angle and `sqrt(radius)`; `spawnAdds` always draws one angle offset; a phase `gap` range draws after the attack pick; the bot draws one `weakAwareness` roll per decision that reaches target selection, and one `dodgeSkill` roll per newly perceived attack id.
- Math: `Math.hypot` is V8's scaled Kahan sum, and `sin/cos/atan2` are V8's fdlibm (not glibc); both differ from the naive versions in the last bit for a large share of inputs (numbers in `combat3d.md`, "Numerics a port must reproduce"). `Math.pow` and `Math.sqrt` match libm. Frame counts are `max(0, round(seconds * 60))` with round-half-up; `x / y` between two frame counters is float division, `%` on frame counters is integer modulo.
- `JSON.parse` (JS) keeps insertion order except integer-like keys (reordered ascending): do not use ids such as `"1"` in `parts`, `phases`, `hazards`.
