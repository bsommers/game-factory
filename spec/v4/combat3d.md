# combat3d (spec v4)

Deterministic frame-data combat for 3D fighters (player, enemies, bosses): hitboxes and hurtboxes, move frame data, input buffer, cancels, block and parry, i-frames, armor, poise and stagger, hit-stop, damage types and resistances, status effects, projectiles. Reference implementation: `templates/web-project/src/lib/combat3d.js`. Pure, zero deps, Y-up, metres, fixed step `dt = 1/60`, plain JSON state, no `Date` / `Math.random`; chance rolls use a mulberry32 state stored in `world.rng`. Overlap primitives come from `collision3d` (`spec/v3/collision3d.md`). A Godot (or other) port mirrors the algorithm below from the JSON fighter definitions. Schema: `spec/v4/schemas/combat3d.schema.json`. Examples: `spec/v4/examples/combat3d/{hero,enemy-swipe,duel}.json`.

Everything below is what the reference code does. Items marked TODO-verify were not confirmed by a test or by running the code.

## Conventions
- Facing: yaw about +Y. Forward at yaw 0 is **+Z**: `forward(yaw) = [sin yaw, 0, cos yaw]`. (This differs from locomotion3d, which faces -Z. A bridge must convert.)
- `rotYaw(v, yaw) = [v.x*cos + v.z*sin, v.y, -v.x*sin + v.z*cos]`. `rotYaw([0,0,1], yaw) == forward(yaw)`. `yawQuat(yaw) = [0, sin(yaw/2), 0, cos(yaw/2)]` (x,y,z,w).
- Move-local vectors (knockback, motion velocity, hitbox/spawn offsets without a bone) are rotated by the owner's yaw.
- `r6(v) = Math.round(v * 1e6) / 1e6` (round half toward +infinity). Applied to hp, taken, dealt, poise (on damage), damage, and positions in `hashWorld`.
- Frames are integers. A world frame is one `step`. A move's frame counter is 1 on the world frame the move starts (see "Move frames").
- All collection orders are array orders: fighters in `world.fighters` order, hitboxes in `move.hitboxes` order, hurtboxes in `def.hurtboxes` order. Ports must keep these orders.

## Data shapes

### Fighter definition (`def`; the JSON in the schema)
```
{ id, team?, maxHp? (100), maxPoise? (50), poiseRegenDelay? (120), poiseRegenRate? (0.25), staggerFrames? (60),
  bufferFrames? (6, 0..30), chipMult? (1), comboScaling?: number[], resist?: {physical|fire|water|toxic: number <= 1},
  hurtboxes?: [Hurtbox], block?: Block, actions?: {actionName: moveId}, moves: {moveId: Move}, statuses?: {id: Status} }
Hurtbox = { id, bone?, offset?: vec3, shape: Shape, mult? (1), weak? (false) }
Shape   = {type:'sphere', r} | {type:'capsule', a, b, r} | {type:'box', h:[hx,hy,hz] half extents}
Block   = { arc? (180 deg), parryWindow? (0), parryStun? (45), chip? (0.1), poiseMult? (0.5), kbMult? (0.5) }
Move    = { startup, active (>=1), recovery, damage? (0), damageType? ('physical'), hitstun? (0), blockstun? (0), hitstop? (0),
            knockback?: vec3 (move-local, [0,0,0]), poiseDamage? (0), guardBreak? (false), unblockable? (false),
            multihit?: {every}, statusOnly?, hitboxes?: [Hitbox], cancels?: [Cancel], armor?: {from,to,threshold?},
            iframes?: {from,to}, motion?: [{from,to,vel}], onHit?: [StatusHit], spawns?: [{frame, offset?, projectile}] }
Hitbox  = { id?, bone?, offset?, shape: Shape, from?, to?, keys?: [{frame, offset}] }
Cancel  = { into, action, from, to, on?: 'hit'|'block'|'contact'|'whiff'|'any' }
StatusHit = { id, chance? (1), duration? (status default) }
Status  = { duration? , tickEvery?, damage?, damageType? ('physical'), speedMult?, maxStacks? (1), stackMode?: 'refresh'|'stack'|'ignore', extinguishedBy?: damageType[] }
Projectile spec = { kind? ('straight'|'arc'|'homing'), pos?, offset?, dir? ([0,0,1], normalised, local to owner yaw), speed? (10), radius? (0.2),
                    life? (120), gravity? (arc: 20, else 0), pierce? (0), turn? (0.05 rad/frame), target?, hit?: {damage, damageType, hitstun, blockstun, knockback, hitstop, poiseDamage, guardBreak, unblockable, status[]} }
```
Defaults above are the runtime fallbacks (`??`). The schema sets types and ranges only. Damage types: `physical, fire, water, toxic`. Default hurtbox when `hurtboxes` is missing or empty: `[{id:'body', shape: capsule a=[0,0.4,0] b=[0,1.4,0] r=0.4, mult 1}]`.

Default statuses (`DEFAULT_STATUSES`):
```
poison { duration 300, tickEvery 30, damage 2, damageType toxic, maxStacks 3, stackMode stack }
burn   { duration 180, tickEvery 20, damage 3, damageType fire,  maxStacks 1, stackMode refresh, extinguishedBy [water] }
slow   { duration 240, speedMult 0.5, maxStacks 1, stackMode refresh }
```
`def.statuses` is **validation-only**: `validateFighter` accepts those ids in `onHit`, but `createWorld` / `simulateDuel` do not copy them into `world.statuses`. Custom statuses must be passed through `createWorld({statuses})` / `simulate {statuses}`. (An `onHit` id that is unknown to the world is silently ignored by `applyStatus`.)

### Fighter runtime state
```
{ id, team (o.team ?? def.team ?? def.id), pos:[x,y,z], yaw, kb:[x,y,z], frozen,
  hp, maxHp, poise, maxPoise, poiseRegen (frames since last poise damage),
  def (deep copy), state: 'idle'|'move'|'block'|'hitstun'|'stagger'|'dead', stun, hitstop,
  move: null | {id, frame, hit:{[victimId]: lastHitFrame}, connected: null|'hit'|'block', spawned:{}},
  blockFrames, buffer:[{action, t}], status:[{type, left, stacks, age, src}], combo, tempo, dealt, taken, hits, wantBlock (set per step) }
```
`createFighter(def, {id, team, pos, yaw})`: `pos` defaults `[0,0,0]`, `yaw` 0, hp = maxHp, poise = maxPoise, `state 'idle'`, everything else zero/empty.

### World
```
{ frame:0, rng: seed>>>0, groundY: null|number, friendlyFire:false, hostility:null|{team:[team,...]}, maxEvents:20000, kbDecay:0.85,
  statuses:{...DEFAULT_STATUSES, ...passedStatuses}, fighters:[], projectiles:[], events:[], eventsDropped:0, nextProj:1 }
```
`createWorld({fighters, statuses, seed=1, groundY, friendlyFire, hostility, maxEvents, kbDecay})`. Entries of `fighters` that already have `.def` are used as-is, others go through `createFighter`. `statuses` merges by id (shallow, a passed id replaces the default wholesale).

### Projectile runtime state
`{id (nextProj++), kind, owner, team, pos, vel, radius, life, gravity, pierce, turn, target, hitSet:[victimId], age, hit:{damage, damageType, hitstun, blockstun, knockback, hitstop, poiseDamage, guardBreak, unblockable, status}}`.

## RNG
mulberry32 with the state held in `world.rng` (uint32):
```
rng = (rng + 0x6d2b79f5) >>> 0;  t = rng;
t = imul(t ^ (t >>> 15), t | 1);
t ^= t + imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
```
The generator is advanced only when a status roll has `chance < 1` (a `chance` of 0 still consumes one draw). No other system draws random numbers.

## Frame-data semantics (move frames)
- `total = startup + active + recovery`. Startup is frames `1..startup`, active is `startup+1 .. startup+active`, recovery the rest.
- A move's `frame` is 1 on the world frame it starts (the starting step advances the counter immediately, see step 3). A hit therefore first lands on world frame `startFrame + startup` (test: action pressed at world frame 1, startup 3, hit event at `f = 4`).
- Hitbox window: `hb.from..hb.to` (`to` defaults to `from`) if `from` is present, else the active range. Collection additionally requires the frame to be inside the active range, so an explicit window outside it never fires.
- `iframes`, `armor`, `motion[i]`, `cancels[i]` are inclusive move-frame windows `[from, to]` (`inWin`). Spawns fire on `frame == spawn.frame`.
- A move ends when the counter would exceed `total`: on the step that advances to `total+1` it emits `move-end`, clears `move`, sets `state 'idle'` (and a buffered action may start a new move on that same step).
- Frame-data table (`frameDataTable(def)`), one row per move in insertion order:
  - `tail = (active - 1) + recovery`; `onHit = hitstun - tail`; `onBlock = blockstun - tail` (positive = attacker advantage).
  - Columns: `move, startup, active, recovery, total, damage, damageType, hitstun, blockstun, onHit, onBlock, hitstop, poiseDamage, armor ("from-to" or ""), iframes ("from-to" or ""), cancels`. Cancel string per entry: `action>into@from-to` plus `:on` if `on` is set, space separated. Numbers missing default to 0 and `damageType` to `physical`.
  - `frameDataMarkdown(def)`: header `| col | ... |`, separator `|---|...|`, one row per move, cells joined with ` | `.
  - Example from the test: startup 5, active 3, recovery 9, hitstun 20, blockstun 10 gives total 17, onHit `20 - 11 = 9`, onBlock `10 - 11 = -1`.

## Step algorithm (normative; one call = one fixed step)
`step(world, inputs, poses) -> events emitted this step`. `inputs = {[fighterId]: {action?: string (one-shot press), block?: bool}}`. `poses` is optional `{[fighterId]: {pos, yaw, bones:{name:{pos, quat}}}}` supplied by the caller (animation skeleton).

0. `world.frame += 1`. Remember `before = events.length + eventsDropped`.
1. **Inputs and buffers** (every fighter, including dead ones, in order). If `inp.action`, push `{action, t: world.frame}`. Then drop entries with `world.frame - t > bufferFrames` (default 6; an entry pushed this step has age 0). `wantBlock = !!inp.block`. The buffer clock is the world frame; it is **not** paused by hit-stop (see approximations).
2. **Status ticks** for every non-dead fighter, in order (not frozen by hit-stop). See "Status effects".
3. **State machine**, per fighter in order, skipping `dead`:
   1. `frozen = false`. If `hitstop > 0`: `hitstop -= 1; frozen = true;` skip the rest of this fighter's step 3 (no knockback, no stun/timers, no move advance, no poise regen).
   2. Knockback integration: if `|kb| > 1e-4`: `pos += kb * DT; kb *= kbDecay (0.85); if groundY != null: pos.y = max(groundY, pos.y)`; else `kb = [0,0,0]`.
   3. By state:
      - `hitstun` or `stagger`: `stun -= 1; if stun <= 0 { state = 'idle'; combo = 0 }`.
      - `move`: `advanceMove` (below).
      - `block`: `blockFrames += 1; if stun > 0 { stun -= 1 }`.
   4. If the state is now `idle` or `block`, and (`state == idle` or `stun == 0`):
      - `firstStartable`: the oldest buffer entry whose `action` is in `def.actions` and whose move exists. If found: remove the first buffer entry with that action, `startMove(move, 'input')`, then `advanceMoveFrame` (so the move is at frame 1 this step).
      - else if `wantBlock` and `def.block` exists: if not already `block`, set `state='block'`, `blockFrames=1`.
      - else if `state == block`: `state='idle'`, `blockFrames=0`.
      A fighter in `block` with `stun > 0` (blockstun) cannot leave block or start a move.
   5. Poise regen: if state is not `hitstun`/`stagger`, `poiseRegen += 1`. If `poiseRegen > poiseRegenDelay (120)` and `poise < maxPoise`: `poise = min(maxPoise, poise + poiseRegenRate (0.25))` (no `r6` here).
4. **Collect attacks**: for each fighter in order with `state == 'move'` and not `frozen`: `collectMove` appends attack records to one list `attacks`. Nothing is resolved while collecting.
5. **Resolve** every record in list order with `resolveHit` (so same-frame trades both land; attackers killed earlier in the same list still have their already-collected hits resolved).
6. **Projectiles**: `stepProjectiles` (see below). Projectiles spawned this step (move spawns happen in step 3) move and can hit in this same step.
7. Clear `wantBlock` on every fighter. Return the events emitted this step (the last `events.length + eventsDropped - before` entries, or `[]`).

### startMove
`move = {id, frame: 0, hit: {}, connected: null, spawned: {}}`, `state='move'`, `stun=0`, `tempo=0`, `blockFrames=0`; emit `move {who, move, via}` with `via` `'input'` or `'cancel'`. `combo` is not reset. Returns false (no change) if the move id does not exist.

### advanceMove (tempo / slow)
`tempo += speedMult(fighter)`; if `tempo < 1 - 1e-9` return (the move frame does not advance this step; hitbox collection still runs for the unchanged frame but the once-per-target rule prevents re-hits); else `tempo -= 1` and `advanceMoveFrame`. `speedMult = product over f.status of world.statuses[type].speedMult ?? 1`. The first frame of a move (via `startMove`) always advances without consulting tempo.

### advanceMoveFrame
1. `frame += 1`. If `frame > total`: emit `move-end {who, move}`, `move = null`, `state = 'idle'`, return.
2. Motion: for each `motion[i]` containing `frame`: `pos += rotYaw(vel, yaw) * DT * speedMult`. Then if `groundY != null`: `pos.y = max(groundY, pos.y)`.
3. Spawns: for each `spawns[i]` with `frame == mv.frame`: `spawnProjectile(world, f, s.projectile, s.offset)`.
4. Cancels, in declared order, first match wins: skip unless `frame` in `[from, to]` and the buffer contains `c.action`. The condition `ok`:
   `on == 'any'` or `(on ?? 'hit') == connected` or (`on == 'contact'` and `connected` is not null) or (`on == 'whiff'` and `connected` is null). Also requires `moves[c.into]` to exist. On match: remove the first buffer entry with that action, emit `cancel {who, from, into}`, `startMove(into, 'cancel')`, `advanceMoveFrame` (recursive; the new move is at frame 1), return. Because `connected` is set at resolve time, a cancel is evaluated on the next frame advance after the hit, never on the same step.

### collectMove (hit detection, per attacker)
Runs only if `frame` in the active range. Build one shared hit descriptor `h`: `damage, damageType, hitstun, blockstun, hitstop, poiseDamage, guardBreak, unblockable` from the move (defaults 0/physical/false), `knockback = rotYaw(move.knockback, poses?.[id]?.yaw ?? f.yaw)`, `status = move.onHit ?? []`, `srcPos = root transform position` (`poses[id].pos ?? f.pos`), `owner = f.id`, `moveId`.

For each hitbox (array order) whose window contains `frame`:
1. World shape = `worldShape(hb.shape, boneT(f, hb.bone, poses), hitboxOffset(hb, frame))`.
2. For each victim `v` in `world.fighters` order: skip if `v === f`, `v` dead, or not (`hostile(f, v)` or `friendlyFire`).
3. Once-per-target: let `last = mv.hit[v.id]`. If `last` is defined, skip unless `move.multihit` exists and `frame - last >= multihit.every`.
4. For each hurtbox of `v` (array order): AABB prefilter (`shapeBounds`): skip if the boxes are disjoint (comparison is strict, touching boxes pass). `depth = shapeOverlap(hitShape, hurtShape)`. Keep the deepest: replace the current best only if `depth > best.depth + 1e-12` and `depth > 0` (first hurtbox wins ties).
5. If a best exists: append `{attacker: f, victim: v, part: hurtbox, h}` and set `mv.hit[v.id] = frame`. The mark is set at collection, so a hit that is later evaded, parried or blocked still counts as the move's hit on that target. The key is the victim id, shared by all hitboxes of the move (a second hitbox cannot also hit the same victim on the same move unless `multihit`).

Hitbox/hurtbox transform (`boneT`): no `bone` gives the root transform `{pos: poses[id].pos ?? f.pos, quat: yawQuat(poses[id].yaw ?? f.yaw)}`. With `bone`: `poses[id].bones[bone]` as `{pos, quat ?? identity}`; a missing bone falls back to the root transform. World point of a local point `p`: `T.pos + quatRot(T.quat, p)`; `quatRot` normalises `q` then `v + 2w(q.xyz x v) + q.xyz x (2 q.xyz x v)`. Shapes: sphere centre = `xf(offset)`; capsule endpoints `xf(offset + a)`, `xf(offset + b)`; box = `obbFromQuat(xf(offset), h, T.quat)` (`collision3d`: centre, half extents, rotated axes).

Keyframed offsets (`hitboxOffset(hb, frame)`): no `keys` (or empty) gives `hb.offset ?? [0,0,0]` (offset is ignored when keys exist). `frame <= keys[0].frame` gives `keys[0].offset`. Otherwise the first `i >= 1` with `frame <= keys[i].frame` gives a linear lerp with `t = (frame - k[i-1].frame) / ((k[i].frame - k[i-1].frame) || 1)`. Past the last key gives the last offset. `frame` is the move frame (the test also calls it with a fractional frame).

Hostility: `hostile(a, b)`: false if `a.id == b.id`; if `world.hostility` is set, `!!hostility[a.team]?.includes(b.team)` (directional); else `a.team != b.team`. `friendlyFire` bypasses this for move hitboxes only (any other fighter than self) and is **not** consulted for projectiles.

### Overlap tests (`shapeOverlap(A, B) -> depth, 0 = none`)
Types are canonicalised by string order (`box` < `capsule` < `sphere`; swap if `A.type > B.type`). Dispatch (each `collision3d` function returns `{depth,...}` or null; null counts as 0):
`sphere/sphere` `sphereSphere(A,B)`; `capsule/sphere` `sphereCapsule(sphere, capsule)`; `capsule/capsule` `capsuleCapsule(A,B)`; `box/sphere` `sphereOBB(sphere, box)`; `box/box` `obbOBB(A,B)`; `box/capsule` the capsule-vs-box approximation below. The depth values are those of `collision3d` (spec/v3).

## Hit resolution (`resolveHit(attacker|null, victim, part, h)`)
`base = {who: attacker?.id ?? h.owner ?? null, victim: victim.id, move: h.moveId ?? null, part: part.id ?? null}`. `credit = attacker ?? fighterOf(h.owner)`. If the victim is `dead`, return with no effect.

1. **Evade**: if `victim.move` exists and `victim.move.frame` is in that move's `iframes` window: emit `evade base`, stop. No hit-stop, no damage, `connected` not set on the attacker.
2. **Block test**. `toSrc` = normalised horizontal (xz) vector from `victim.pos` to `h.srcPos`. `facing` = `|toSrc| < 1e-9` or `dot(forward(victim.yaw), toSrc) >= cos(arc/2) - 1e-12` with `arc = block.arc ?? 180` degrees. `blocking = victim.state == 'block' && def.block exists && facing && !h.unblockable`.
3. **Blocked**:
   - **Parry** if `victim.blockFrames <= (parryWindow ?? 0)`: if the attacker exists and is not dead: `attacker.move = null; state = 'stagger'; stun = block.parryStun ?? 45; attacker.hitstop = h.hitstop; attacker.kb = [0,0,0]` (a parried attacker does not get `poise` reset, `combo`, or `dead` handling). `victim.hitstop = h.hitstop`. Emit `parry base`. Defender takes nothing, `connected` is not set. Projectile hits (no attacker) only set the victim's hit-stop.
   - Otherwise: `dmg = applyDamage(victim, h.damage * (chip ?? 0.1) * part.mult * (victim.def.chipMult ?? 1), h.damageType)`; `victim.poise = r6(poise - h.poiseDamage * (poiseMult ?? 0.5)); poiseRegen = 0`; `victim.hitstop = attacker.hitstop = h.hitstop` (attacker only if present); `victim.kb = knockback * (kbMult ?? 0.5); victim.stun = h.blockstun` (state stays `block`); `credit.dealt = r6(dealt + dmg)`; `attacker.move.connected = 'block'`; emit `block {...base, damage, hp}`. If `hp <= 0`: `die`, return. Else if `poise <= 0` or `h.guardBreak`: `stagger(victim, base, guardBreak=true)`.
4. **Clean hit** (order matters for events and rng):
   1. `scale = victim.combo > 0 ? (comboScaling[min(combo, len) - 1] ?? 1) : 1` (empty array gives 1). `dmg = applyDamage(victim, h.damage * part.mult * scale, h.damageType)`.
   2. `credit.dealt = r6(dealt + dmg); credit.hits += 1; attacker.move.connected = 'hit'` (attacker only for the last).
   3. `extinguish(victim, h.damageType)`: removes every status whose `extinguishedBy` contains the type, emitting `status {op:'extinguish'}` per removed status.
   4. `victim.poise = r6(poise - h.poiseDamage * (part.weak ? 1.5 : 1)); poiseRegen = 0`.
   5. `armored = victim.move exists && victim.move.frame in moves[victim.move.id].armor window && h.poiseDamage <= (armor.threshold ?? Infinity) && !h.guardBreak`.
   6. Emit `hit {...base, damage, damageType, weak: part.weak, armored, hp, combo: victim.combo + 1}` (hp is the value after damage, before any death clamp, so it may be negative).
   7. `victim.hitstop = attacker.hitstop = h.hitstop` (overwrites, not max).
   8. If `hp <= 0`: `die`, return.
   9. Status application: for each `h.status` entry, in order: apply if `(chance ?? 1) >= 1` else if `rngNext(world) < chance`. `applyStatus(victim, id, {duration, src: base.who})`. Applies even when armored. (`victim.hp <= 0` re-check is a no-op in practice.)
   10. If `poise <= 0` and not `armored`: `stagger(victim, base, false)`, then `victim.kb = knockback`. Return.
   11. Else if not `armored`: `move = null; state = 'hitstun'; stun = h.hitstun; kb = knockback; combo += 1; blockFrames = 0`.
   Armor absorbs the state change only: damage, poise loss, hit-stop and status still apply.

`stagger(v, base, guardBreak)`: `move = null; state = 'stagger'; stun = def.staggerFrames ?? 60; poise = maxPoise; combo += 1`; emit `stagger {...base, guardBreak, frames: stun}`.

`die(v, by)`: `hp = max(0, hp); state = 'dead'; move = null; stun = 0; status = []; kb = [0,0,0]`; emit `death {who, by}` (`by` is the killer id or null). Dead fighters skip every later phase. `taken` keeps the unclamped damage.

### Damage formula
`applyDamage(f, amount, type)`: `res = clamp(def.resist[type] ?? 0, -10, 1)`; `dmg = r6(max(0, amount * (1 - res)))`; `hp = r6(hp - dmg)`; `taken = r6(taken + dmg)`; returns `dmg`.
- Clean hit: `amount = move.damage * hurtbox.mult * comboScale`.
- Block: `amount = move.damage * block.chip * hurtbox.mult * def.chipMult`.
- DoT tick: `amount = status.damage * stacks`.
- Resistances: `1` = immune, `0.5` halves, negative = weakness (`-1` doubles). Test values: fire 10 with res 0.5, 1, -1 gives taken 5, 0, 20. Weak hurtbox (`head` mult 2, weak) deals 20 from base 10.
- Poise damage is not scaled by resistances or combo scaling.

## Hit-stop
`resolveHit` sets `hitstop = h.hitstop` on the victim and (if any) the attacker. At step 3 a fighter with `hitstop > 0` decrements it and is frozen for that step: it skips knockback, stun/state timers, move advance, input-driven starts, poise regen and hit collection. A hit-stop of N set during step S freezes the fighter for steps S+1..S+N and it advances normally at S+N+1 (test: hitstop 5 then 5 frozen steps, frame advances on the 6th). Not frozen: status ticks, projectiles, and the input buffer (aged by world frame). Dead fighters ignore hit-stop.

## Status effects
`applyStatus(world, f, id, {duration, src})`: false if the world has no such status or `f` is dead. `dur = opts.duration ?? sd.duration ?? 60`. If the fighter already has it: `stackMode == 'ignore'` returns false; else `left = max(left, dur)`; if `stackMode == 'stack'` and `stacks < (maxStacks ?? 1)` then `stacks += 1` (`age` is not reset, `src` is not updated). New: push `{type, left: dur, stacks: 1, age: 0, src: src ?? null}`. Emit `status {who, status, op: 'apply'|'refresh', stacks}`; returns true.

`tickStatus` (step 2) iterates a copy of `f.status` in order. For each: `age += 1; left -= 1;` if `sd.tickEvery` and `age % tickEvery == 0` and the fighter is not dead: `dmg = applyDamage(f, (sd.damage ?? 0) * stacks, sd.damageType ?? 'physical')`, emit `dot {who, status, damage, hp}`; if `hp <= 0`: `die(f, s.src)` and stop ticking this fighter. Then if `left <= 0`: remove it and emit `status {who, status, op: 'expire'}`. `speedMult` statuses affect move tempo and motion speed only (not knockback, projectiles or stun).

## Projectiles
`spawnProjectile(world, owner, spec, offset)`: `yaw = owner.yaw` (the stored yaw, not `poses`). `dir = rotYaw(normalize(spec.dir ?? [0,0,1]), yaw)` (not rotated when `owner` is null). `pos = spec.pos` if present, else `owner.pos + rotYaw(offset ?? spec.offset ?? [0,1,0.6], yaw)`. `vel = dir * (speed ?? 10)`. `gravity = kind=='arc' ? (spec.gravity ?? 20) : (spec.gravity ?? 0)`. `id = world.nextProj++`. Emit `projectile-spawn {id, owner, kind}`. `hit` fields default to 0/physical/false/`[0,0,0]`/`[]`.

`stepProjectiles` (once per step, in array order; survivors are kept in order):
1. `owner = fighterOf(p.owner)`; `me = owner ?? {id: p.owner, team: p.team, state:'alive'}`.
2. Homing: target = `p.target` fighter; if missing or dead, pick the nearest alive fighter hostile to `me` (distance from `f.pos` to `p.pos`, strict `<`, first wins; `p.target = id` or null). If a target exists and speed > 0: `want = normalize(target.pos + [0,1,0] - p.pos)`; `vel = rotateToward(normalize(vel), want, p.turn) * speed`.
   `rotateToward(cur, want, maxAng)`: `ang = acos(clamp(dot,-1,1))`; if `ang <= maxAng` return `want`; else rotate `cur` about `axis = normalize(cur x want)` (`[0,1,0]` if `|cross| < 1e-9`) by `maxAng` with Rodrigues, `normalize(cur*cos + (axis x cur)*sin + axis*(axis.cur)*(1-cos))`.
3. `vel.y -= gravity * DT` (semi-implicit; applied to all kinds).
4. `from = pos; to = from + vel*DT; n = max(1, ceil(|to-from| / max(radius, 1e-3)))`. For `s = 1..n`: sample sphere at `from + (to-from) * s/n`, radius `radius`; for each victim (order): skip if dead, already in `hitSet`, `v.id == p.owner`, or not `hostile(me, v)`. Deepest overlapping hurtbox by `shapeOverlap` (same `+1e-12` tie rule; no AABB prefilter). On a hit: push victim id to `hitSet`; `kb = rotYaw(hit.knockback, atan2(vel.x, vel.z))` (unrotated if `|vel| == 0`); `resolveHit(null, v, part, {...hit, owner: p.owner, knockback: kb, srcPos: sample centre, moveId: 'projectile#' + id})`. Then `if (p.pierce-- <= 0) { dead = true; break }` (pierce 0 dies on the first hit; the post-decrement value is stored).
5. `pos = to; age += 1; life -= 1`. Expiry (first match only): `!dead && life <= 0` emits `projectile-expire {id, why:'life'}`; else `!dead && groundY != null && pos.y < groundY` emits `why:'ground'`; else `dead` emits `why:'hit'`. Dead projectiles are dropped.
Projectile hits with `attacker = null`: no attacker hit-stop, no `connected`, no parry stagger; `dealt` is credited to the owner if it still exists (`hits` too, on clean hits). The owner is not hit-stopped, so a hit never changes the projectile's own motion.

## Capsule vs box approximation (known)
`box/capsule` is not an exact test. The capsule is replaced by a chain of spheres: `len = |b - a|; n = max(1, ceil(len / max(r, 1e-3)))`, spheres at `a + (b - a) * i/n` for `i = 0..n` (n+1 spheres, radius `r`), and the depth is the maximum `sphereOBB(sphere_i, box)` depth. It slightly under-reports depth between spheres (and the depth is a sphere-vs-box value, not a true capsule depth). A port must use the same chain, not an exact capsule-box routine, to match depths and best-part selection.

## Other known approximations
- **Hit-stop and the input buffer.** Hit-stop freezes the state machine but the buffer is aged by world frame (`world.frame - t > bufferFrames`), so entries expire during hit-stop; a fighter with a long hit-stop and a short `bufferFrames` can lose a buffered press. Nothing is queued while frozen. (The buffer clock is therefore not paused; the freeze only blocks starting moves and cancels.)
- Hit detection is per move frame, with no sub-frame sweep of hitboxes; fast hitboxes can tunnel through thin hurtboxes (keyframes should be dense enough).
- Hurtboxes and hitboxes use the pose supplied for the current step; no interpolation.
- A move on a frozen attacker does not collect hits; a victim in hit-stop can still be hit (by another fighter, a projectile or a trade).
- `friendlyFire` does not apply to projectiles.
- `poiseRegen` regen increment is not `r6`-rounded.
- Combat has no vertical state (jump/air); `groundY` only clamps `pos.y` from below during knockback and move motion.

## Events and hashing
Event log entry: `{f: world.frame, type, ...data}` with keys in this order (key order is part of the hash). `base` = `who, victim, move, part`.

| type | data keys (after `f`, `type`) |
|---|---|
| `move` | `who, move, via` |
| `move-end` | `who, move` |
| `cancel` | `who, from, into` |
| `evade` | `who, victim, move, part` |
| `parry` | `who, victim, move, part` |
| `block` | `who, victim, move, part, damage, hp` |
| `hit` | `who, victim, move, part, damage, damageType, weak, armored, hp, combo` |
| `stagger` | `who, victim, move, part, guardBreak, frames` |
| `death` | `who, by` |
| `status` | `who, status, op ('apply'|'refresh'|'expire'|'extinguish'), stacks?` (`stacks` only for apply/refresh) |
| `dot` | `who, status, damage, hp` |
| `projectile-spawn` | `id, owner, kind` |
| `projectile-expire` | `id, why ('life'|'ground'|'hit')` |

For projectile hits `move = 'projectile#<id>'` and `who` is the projectile owner. `world.events` is capped at `maxEvents` (20000): after each push, if longer, the oldest is shifted and `eventsDropped += 1`.

`hashJSON(o)`: `s = JSON.stringify(o)`; FNV-1a 32-bit over the UTF-16 code units of `s` (`h = 2166136261; h ^= code; h = imul(h, 16777619)`); result `(h >>> 0)` as 8 lowercase hex digits, zero-padded. Number text is ECMAScript `Number#toString` (shortest round-trip); `-0` prints `0`, NaN/Infinity print `null`. A port must reproduce that formatting and the JSON key order.
- `hashEvents(events) = hashJSON(events)` (the whole log, not the truncated list returned by the capability).
- `hashWorld(world) = hashJSON({f: frame, rng, fighters: [{id, hp, pos: pos.map(r6), state, move: move && {id, frame}, poise, status}], projectiles, events})` where `status` is the raw array of status objects and `projectiles` the raw projectile objects.

## Scripted duel (`simulateDuel(defA, defB, {script, frames=600, distance=1.6, seed=1, statuses})`)
- A: `createFighter(defA, {pos:[0,0,-distance/2], yaw:0, team: defA.team ?? 'a'})`; B: `pos:[0,0,distance/2], yaw: PI, team: defB.team ?? 'b'`. If the teams are equal B's team gets `-2` appended; if the ids are equal B's id gets `-2`. World: `createWorld({fighters:[a,b], seed, statuses, groundY: 0})`.
- `script` keys: `A`, `B`, or a fighter id. Each entry is `{at, action}` (the one-shot action at 1-based world frame `at`; later entries on the same frame overwrite) or `{from, to, block: true}` (block held on frames `from..to`).
- Loop `frames` times: build inputs for `world.frame + 1`, `step`; stop early after the step in which any fighter is dead.
- Result: `{world, frames: world.frame, totals: {id: {dealt, taken, hp, state, hits}}, winner (id if exactly one fighter is not dead, else null), counts: {hit, block, parry, stagger, death, evade}, hash: hashEvents(world.events)}`.

### Pinned duel hash
`spec/v4/examples/combat3d/duel.json` (`hero.json` vs `enemy-swipe.json`, `seed 7`, `frames 240`, `distance 1.4`, script hero: light@1, light@2, heavy@3; ghoul: swipe@60, swipe@150) must give event-log hash **`6fedb1fe`** (pinned in `test/combat3d.test.mjs`, "determinism hash is pinned for the shipped duel"). Verified run: 240 frames, winner `null`, counts `hit 2, stagger 1, block 0, parry 0, death 0, evade 0`, hero `dealt 34.2 hp 120 hits 2`, ghoul `taken 34.2 hp 55.8`. The unit test in `templates/web-project/test/lib/combat3d.test.mjs` only asserts two equal-seed runs agree (hero vs ghoul, seed 7, 400 frames, distance 1.4); for reference that run hashes events to `8f7f67e8` and `hashWorld` to `c998d550` (observed, not pinned). Re-pin only on an intentional sim change. A Godot port must reproduce `6fedb1fe` from the same JSON; the cross-runtime tolerance policy for positions is the `collision3d` vector policy (1e-9) while event types, frames and r6-rounded values must match exactly (TODO-verify: no cross-runtime run exists yet).

## Validation (`validateFighter(def, statusIds)`, semantic; the JSON schema covers shape)
Errors: an `actions` target move that does not exist; duplicate hurtbox ids; `startup`/`recovery` not integer >= 0 or `active` not integer >= 1; unknown `damageType`; `iframes`/`armor`/`motion`/`cancels` window with `from > to` or outside `1..total`; a hitbox window outside the active range; hitbox `keys` frames not strictly ascending; damage > 0 with neither hitboxes nor spawns; spawn frame outside `1..total`; cancel `into` missing or `action` empty; `onHit` status id unknown (known = default ids plus `def.statuses` ids plus any passed `statusIds`); negative `armor.threshold`. Warnings: hitboxes with zero damage (unless `statusOnly`); `hitstop > 10`; a move not reachable from any action or cancel; `block.parryWindow > 20`.

## Capabilities (factory-core/combat3d)
All results follow `{ok, data, error, next}`. Paths must be inside `project` (default cwd): otherwise `BAD_INPUT`; missing file `NOT_FOUND`; invalid JSON `BAD_INPUT`; any other failure `FAILED`.
- `combat3d.validate {input?: path, fighters?: [path|object] (min 1), project?}` runs schema validation then `validateFighter` per fighter. Success: `{valid: true, fighters: [{src, id, errors: [], warnings, moves}]}`. Failure: `BAD_INPUT` with a details list of `src: error` lines. Needs `input` or `fighters`.
- `combat3d.simulate {input?: duel path, fighters?: [a, b] (paths or objects, exactly 2), script?, frames? (1..36000, default 600), distance? (default 1.6), seed? (default 1), statuses?, events? (0..5000, default 200), project?}`. `input` is a duel JSON `{fighters, script, frames, distance, seed, statuses}`; fighter paths in it resolve relative to the duel file; explicit arguments override the file. Both fighters are validated first (failure is `BAD_INPUT`). Success data: `{frames, winner, totals, counts, hash, eventCount, events (first N), eventsTruncated, frameData: {fighterId: rows}, frameDataMarkdown: {fighterId: string}, warnings}`. `frameData` keys are the final fighter ids (B gets `-2` on an id clash). `hash` always covers the full log.

## Godot port notes
- Mirror `world` and `fighter` as dictionaries; run `step` from `_physics_process` at 60 Hz with `poses` from the skeleton (bone name to transform in world space). Keep yaw convention (+Z forward) or convert at the boundary.
- Do not use Godot's physics for hit detection; port `shapeOverlap` with the `collision3d` depth functions, including the sphere-chain capsule/box approximation, to match frame data and `6fedb1fe`.
- Use a 32-bit mulberry32 and keep `world.rng` in the saved state. Compute hashes over a canonical JSON string with the key order above and ECMAScript number formatting (round with `r6` before printing).
