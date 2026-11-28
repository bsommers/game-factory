# autopilot spec

Source: `templates/web-project/src/lib/autopilot-kit.js`. Deterministic: no `Math.random`/Date. Randomness is `botRng` (legacy integer stream, `spec/rng.md`);
`humanize(skill, rng)` takes an injectable `rng()` -> float in [0,1) (ports may pass spec PCG32 `next`); `createAutopilot` hard-codes `botRng(cfg.seed ?? 1)` (seam: a port should accept an rng
parameter but default to botRng to match vectors). Reference runner: `spec/reference/autopilot.mjs`. Vectors: `spec/vectors/autopilot.json`.
Floats f64: ints/bools/strings exact; floats 1e-9. All closure parameters become callbacks/trait objects in ports; vectors use declarative fixtures (below).

## Input
`input(dx=0,dy=0,jp=false) = {dx,dy,jump:jp,jumpPressed:jp}` (key order: dx,dy,jump,jumpPressed).

## trajectory(ents,n,dt,update,snap)
`cur = deep copies (st copied) of non-dead ents`; `out=[snap each]`; repeat n times: `update(e,dt)` for each e in order (**an error/panic in update is swallowed**, entity keeps its state), then push snapshots. Result has n+1 frames; default `snap` = copy of entity with copied `st`. Source entities untouched.

## searchMacros(families,cost,opts) -> {cost,family,n,macro} | null
`NN=count??30, stride=stride??3, robust=robustBelow??24, tax=nTax??0.004`. `costs[f][i] = cost(f.make(i*stride))`, i in 0..NN-1 (cost is called for every i of every family, in family-major order).
For `smooth in [true,false]`: `best=null`; for family fi (in order), i in 0..NN-1: `raw = smooth ? max(costs[i], costs[i-1] ?? costs[i], costs[i+1] ?? costs[i]) : costs[i]`; `c = raw + (bias??0) + i*tax`; **strictly** lower `c` replaces best (ties -> first seen); best=`{cost:c,family:fi,n:i*stride,macro:make(i*stride)}`.
Return best if `best && (!smooth || best.cost < robust)`; after both passes return null (also when no families). Float tolerance 1e-9 on `cost`; `family`,`n` exact.

## makeWatchdog({limit=40,panicTicks=90})
State `key='',since=0,panic=0,stuck=0`. `tick(k,time)`: `if k != key {key=k; since=time; panic=0}`; `if panic==0 && time-since > limit {stuck++; panic=panicTicks; since=time}`; `if panic>0 {panic--; return true}`; return false. Initial `key=''` so a first key `''` is "unchanged" from time 0.
`flail(tickNo) = input(tickNo%120 < 60 ? 1 : -1, 0, tickNo%40 === 0)` (integer mod).

## humanize(skill=1, rng=botRng(1)) -> fn(r, canAct=true)
State `pending=0`. `if skill>=1 || !canAct: return r`. `if pending>0 { pending--; return pending===0 ? {...r, jump:true, jumpPressed:true} : input(r.dx,0,false) }`.
`if r.jumpPressed { late = jsRound((1-skill)*14); pending = late + floor(rng()*(late+1)); if pending>0 return input(r.dx,0,false) }`; return r. (`jsRound(x)=floor(x+0.5)`.)
Note the `{...r, jump, jumpPressed}` spread keeps `r.dy` (key order dx,dy,jump,jumpPressed preserved). One `rng()` draw only on a jumpPressed with pending==0 and canAct.

## createAutopilot(cfg) -> {stats:{errors,stuck,lastError}, input(g,dt)}
`wd = makeWatchdog(cfg.watchdog)`, `lag = humanize(cfg.skill??1, botRng(cfg.seed??1))`, `tickNo=0`. `input(g,dt)`: `tickNo++`; `playing = cfg.playing?cfg.playing(g):true`; if `playing && wd.tick(cfg.progressKey(g), cfg.time(g))`: `stats.stuck=wd.stuck; return wd.flail(tickNo)` (flail bypasses the humanizer and decide).
Else `r = cfg.decide(g,dt)`; on error: `errors++`, `lastError=string`, `r=input(1)`; return `lag(r, cfg.canHumanize ? cfg.canHumanize(g) : true)`. `lastError` text is language specific: vectors only record `hasError`.
Note `stats.stuck` only updates when a flail is returned.

## Vector runner (`input.op`)
* `input {args}`, `botRng {seed,n}`.
* `trajectory {kinds,entities,n,dt}` (kinds as hazard-kit runner, plus pattern `faulty` whose update always errors) -> `{frames}`.
* `search {families:[{bias}],costTable,opts}`: `make(n)={family,n}`, `cost(m)=costTable[m.family][m.n/stride]` -> `{result}`.
* `watchdog {opts,ticks:[[key,time]]}` -> `{steps:[{flail,input|null,stuck}]}` (`flail(i+1)` for the i-th 0-based tick when flailing).
* `humanize {skill,rng:{kind:'bot'|'pcg32',seed},seq:[{dx,jp,canAct}]}` -> `{outputs}`.
* `autopilot {cfg:{skill,seed,watchdog},ticks:[{key,time,playing?,canHumanize?,decide:{dx,dy?,jump}|'throw'}]}` -> `{outputs,stats:{errors,stuck,hasError}}` (dt irrelevant).
