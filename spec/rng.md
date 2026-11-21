# RNG spec

One portable, integer-only PRNG for everything new (hazard-kit `g.rng`, autopilot `humanize` rng, any port-side
randomness): **PCG32 (XSH-RR 64/32)**. JS `Math.random`, Go `math/rand` and Rust `rand` are NOT portable and must not be used
in engine code. Reference: `spec/rng-reference.mjs`. Vectors: `spec/vectors/rng.json`. All outputs are integers or exact
dyadic floats, so comparison is **exact** (no tolerance).

## PCG32
State: u64 `state`; constants `MULT = 6364136223846793005`, `INC = 109` (`(54 << 1) | 1`, fixed stream). All u64 math wraps mod 2^64.

```
step():      state = state * MULT + INC
seed(s:u32): state = 0; step(); state = state + s; step()          // s zero-extended
next_u32():  old = state; step()
             xs  = (((old >> 18) ^ old) >> 27) as u32               // low 32 bits
             rot = old >> 59                                         // 0..31
             return (xs >> rot) | (xs << ((32 - rot) & 31))          // u32 rotate right
next_float():     next_u32() / 4294967296.0                          // [0,1), exact in f64
int(a, b):        a + ((next_u32() as u64 * (b - a + 1) as u64) >> 32)   // inclusive, no rejection; span <= 2^32
range(a, b):      a + (b - a) * next_float()                         // f64
chance(p):        next_float() < p
pick(arr):        arr[int(0, len-1)]                                 // len >= 1
shuffle(arr):     for i = len-1 down to 1 { j = int(0, i); swap(arr[i], arr[j]) }   // in place, returns arr
```
Check: `seed(42)` -> first `next_u32` = 2707161783.

String seeds: `seed(fnv1a32(utf8_bytes(str)))`, FNV-1a 32: `h = 0x811c9dc5; for b: h ^= b; h = (h * 0x01000193) mod 2^32`.
Check: `fnv1a("a") = 3826002220`. Number seeds are reduced with `>>> 0` (mod 2^32) first.

Draw order is part of the contract: one `next_u32` per `next_float`/`int`/`chance`/`pick`; `shuffle` draws `len-1` times
(none for len <= 1); `int(a,a)` still draws once.

## Legacy streams (hard-coded in the JS engines; ports MUST implement them to match vectors)
The seam does not exist in the libs (they are not edited), so these two deterministic integer streams are part of the spec:

* **mulberry32** (`world-gen` `createRng(seed)`): `s = (seed mod 2^32) or 1 (if 0)`; per draw
  `s = s + 0x6D2B79F5 (mod 2^32); t = s; t = imul(t ^ (t>>15), t | 1); t ^= t + imul(t ^ (t>>7), t | 61); out = (t ^ (t>>14)) / 2^32`.
  Derived: `int(a,b) = a + floor(next*(b-a+1))`, `range`, `pick = arr[floor(next*len)]`, `chance`.
  (Not the same `int`/`pick` as PCG32 above: same value here because floor(u32/2^32 * span) == (u32*span)>>32 for span < 2^21.)
* **botRng** (`autopilot-kit`): `s = seed as i32; per draw s = (s + 0x6d2b79f5) as i32; t = imul(s ^ (s>>>15), 1 | s);
  t = (t + imul(t ^ (t>>>7), 61 | t)) ^ t; out = ((t ^ (t>>>14)) as u32) / 2^32` (`>>>` logical shift on the u32 view; all adds wrap 32-bit).
  Used by `createAutopilot` (seed `cfg.seed ?? 1`) and as `humanize`'s default.

## Vector ops (`rng.json` input)
`{alg:'pcg32'|'mulberry32'|'bot', seed, op:'u32'|'float'|'int'|'range'|'chance'|'pick'|'shuffle', n, lo, hi, p, items}`
-> `{values:[...]}`; `{op:'fnv1a', str}` -> `{u32}`. `alg:'pcg32'` seed may be a string.
