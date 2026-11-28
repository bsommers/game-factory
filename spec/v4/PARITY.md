# JS <-> GDScript parity (combat3d, boss3d)

The GDScript mirror in `templates/godot-action3d/scripts/{combat,boss}/` loads the same JSON as the JS reference (`spec/v4/examples/{combat3d,boss3d}`) and reproduces its event logs bit-for-bit. `parity.run` (capability area `parity`, `factory-core/parity/`) proves it: it runs the JS library and Godot headless (`scripts/combat/parity_dump.gd`) on the same inputs and diffs hashes and key numbers. Godot missing gives `NOT_FOUND` (tests skip).

```
bin/factory parity run --module combat3d --json      # 22 duels incl. the pinned hash 6fedb1fe
bin/factory parity run --module boss3d --json        # 6 bot/seed configurations over hydra and vortex
bin/factory godot test --project templates/godot-action3d --runner res://tests/run_combat.gd --json   # GDScript suite (19 tests)
```

## What is compared
| module | per case |
|---|---|
| combat3d | `frames`, `winner`, `counts`, `totals` (dealt/taken/hp/state/hits), `hash` (= `hashEvents`), `worldHash` (= `hashWorld`, covers rng, positions r6, status, projectiles), `eventCount`, the event list itself (first difference reported with index), the pinned duel hash `6fedb1fe` |
| boss3d | `simulate().hash`, per-run `[seed, won, died, timeSeconds, damageTaken, logHash]`, `winRate/deathRate/timeoutRate/timeToKill/damageTaken/phaseSeconds/attackLaunches/attackHits/killedBy/maxThreats`, first 300 events of run 0 |

The 22 combat cases exercise move/cancel/hit/block/parry/evade/stagger/death, armor and guard-break, poise break, combo scaling, arc and homing projectiles (pierce, hit set, expiry), poison/burn/slow/custom status ticks, expiry and water extinguish, and mulberry32 draws. Boss runs cover every event type except the rarely reached ones (`regrow` and `defeated` do occur; flood/debris/vortex/gas are exercised through vortex and hydra). Also covered: multihit intervals, bone hitboxes/hurtboxes with no pose (root fallback), unblockable and statusOnly moves. `simulateDuel` now takes `friendlyFire`, `hostility`, `kbDecay` and a static `poses` map (keys A/B/id), mirrored in `simulate_duel`, and per-frame `poseFrames`, with cases friendly-fire, hostility-directional, kb-decay, poses-bones, poses-animated and box-box-overlap (OBB vs OBB with a yawed victim). Not covered by a case: `maxEvents` overflow. Caveat: poses-animated carries 16-17 digit doubles in its pose JSON, which Godot parses not-always-correctly-rounded (item 11); it passes today, a drift there is a harness artefact, not a sim bug.

## Not ported (JS only, no parity needed)
`validateFighter`, `frameDataTable/Markdown`, boss `validateBoss`, `fairness`, `escapeDistance`, `balance`, `SKILL_TIERS`. The mirror covers the simulation, the bot, `runFight`/`simulate` and hashing.

## Divergences found while porting (all fixed in the port; the contract was ambiguous)
Measured on 40,000 random inputs unless noted. "Naive" = what a straight GDScript port does.

| # | JS behaviour | Naive Godot result | Fix in the mirror |
|---|---|---|---|
| 1 | `Math.hypot(a,b[,c])` is V8's max-scaled Kahan sum | `sqrt(x*x+y*y)` differs in the last bit for 35% of inputs (and `Vector3.length()` is float32) | `js_compat.gd: hyp2 / vlen / hypn` replicate the V8 algorithm; 0 mismatches. Plain Arrays of floats instead of `Vector3` |
| 2 | `Math.sin/cos/atan2/acos` are fdlibm (V8 `ieee754.cc`) | glibc: sin 3.4%, cos 3.2%, acos 7.7%, atan2 17.6% last-bit mismatches | `fdlibm.gd` ports kernel sin/cos, `rem_pio2` (medium range), atan, atan2, acos from exact hex words; 0 mismatches. Arguments beyond about 8e5 rad fall back to engine functions (never produced by the sims) |
| 3 | `JSON.stringify` of numbers = ECMAScript `Number#toString` | `str(float)` prints about 14 digits; JSON ints/floats are the same type in Godot | `js_compat.gd num_str` (digits from `String.num_scientific`, laid out by the ECMAScript rules). Integer-valued floats print without `.0`. Residual: `String.num_scientific` is not always the shortest string for 16-17 digit doubles (about 0.5% of random doubles, because Godot's internal strtod is not correctly rounded). Logged numbers are r4/r6-rounded, integers, short JSON literals, or the angle constants (pi/180 products) which are checked in `test_jscompat.gd`; a new value with 16+ significant digits in an event would need re-checking |
| 4 | `Math.round` rounds half toward +infinity exactly | `floor(x + 0.5)` is wrong for 0.49999999999999994 | `round_js`: `floor(x)` then compare `x - floor(x) >= 0.5` (exact) |
| 5 | `Math.imul` / `>>> 0` in mulberry32 | a signed 64-bit product of two 32-bit values overflows | `mul32` splits the multiplier into 16-bit halves; all state kept as unsigned 32-bit ints |
| 6 | FNV-1a over UTF-16 code units | hashing UTF-8 bytes | ASCII fast path on UTF-8 bytes; other strings via `to_utf16_buffer` (`fnv_hex("é")` tested) |
| 7 | Object key order in the hashed JSON | n/a | GDScript Dictionaries keep insertion order, so the mirror builds each event with the spec's key order. Caveat: `JSON.parse` in JS reorders integer-like keys, Godot does not (no example uses them; spec now forbids them) |
| 8 | `if (def.block)` etc. test presence | `{}` is falsy in GDScript | explicit `has`/`!= null` checks everywhere |
| 9 | `a / b` on integers is float division | GDScript `int / int` truncates | frame divisions go through `float()` (e.g. `windupF / FPS`, `t / activeF`) |
| 10 | Telegraph events hold the live zone object (gas growth rewrites the logged zone) | copying the zone (`duplicate`) loses the later mutation | the mirror logs the same Dictionary reference; now stated in `boss3d.md` |
| 11 | Godot's JSON parser and GDScript float literals are not correctly rounded for 16-17 digit decimals | different doubles than JS from the same text | not fixable in-engine; the shipped examples use short decimals (<= 6 digits) which parse exactly. `parity.run` would catch a drifting example. Test literals with 17 digits are compared as text |
| 12 | Type inference: `var p = find(...)` where `find` may return `null` | GDScript infers `null` and rejects `p["x"]` at parse time | helpers that can return null carry `-> Variant` |

## Spec edits made (clarifications only)
- `combat3d.md`: replaced the "TODO-verify: no cross-runtime run exists yet" with the parity result; new section "Numerics a port must reproduce" (hypot algorithm, fdlibm, imul, number text, key order of `status` and projectile objects inside `hashWorld`, JS truthiness, integer-like keys); the Godot notes link the mirror.
- `boss3d.md`: new section "Determinism contract for ports" (log hash, event references/zone mutation, rng seeding of boss and bot, `simulate` seeds and hash composition, draw order, math notes).

## Remaining risks
- The mirror tracks `templates/web-project/src/lib/{combat3d,boss3d}.js`. Any change to the sim, bot or hash in JS (other agents are editing `boss3d.js`, `hydra.json`, `vortex.json`) needs the same change in `scripts/{combat,boss}/*.gd`; `parity.run` will fail until it is done. Adding a JS dependency on `Math.*` functions beyond `hypot sin cos atan2 acos pow sqrt round ceil floor abs min max atan` needs an exactness check first (see the harness described in item 2: compare IEEE bit patterns, not printed values).
- Performance: `parity.run` over all six boss cases (JS plus GDScript, headless editor binary) takes about 7 s and the 13 combat cases about 1.5 s; the GDScript is not tuned.
