// Reference implementation of the spec RNG (PCG32, integer-only, BigInt for the 64-bit state) plus the two legacy
// streams the JS engines hard-code (mulberry32 = world-gen createRng, botRng = autopilot-kit). See spec/rng.md.
import { createRng as legacyCreateRng } from '../templates/web-project/src/lib/world-gen.js';
import { botRng } from '../templates/web-project/src/lib/autopilot-kit.js';

const M64 = (1n << 64n) - 1n, MULT = 6364136223846793005n, INC = (54n << 1n) | 1n;

/** FNV-1a 32 over the UTF-8 bytes of a string. */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(str)) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** PCG32 (XSH-RR). seed: u32 number or string (FNV-1a). */
export function pcg32(seed = 1) {
  const s32 = typeof seed === 'string' ? fnv1a(seed) : seed >>> 0;
  let state = 0n;
  const step = () => { state = (state * MULT + INC) & M64; };
  step(); state = (state + BigInt(s32)) & M64; step();
  const nextU32 = () => {
    const old = state; step();
    const xs = (((old >> 18n) ^ old) >> 27n) & 0xffffffffn, rot = old >> 59n;
    return Number(((xs >> rot) | (xs << ((32n - rot) & 31n))) & 0xffffffffn);
  };
  const next = () => nextU32() / 4294967296;
  // int in [a,b] inclusive: ((u64)u32 * span) >> 32  (no rejection; span <= 2^32)
  const int = (a, b) => a + Number((BigInt(nextU32()) * BigInt(b - a + 1)) >> 32n);
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = int(0, i); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };
  return { nextU32, next, int, range: (a, b) => a + (b - a) * next(), pick: (arr) => arr[int(0, arr.length - 1)], chance: (p) => next() < p, shuffle };
}

/** Build a stream by {alg, seed}. alg: pcg32 | mulberry32 | bot. Returns {u32?, next}. */
export function makeStream(alg, seed) {
  if (alg === 'pcg32') return pcg32(seed);
  if (alg === 'mulberry32') { const r = legacyCreateRng(seed); return { next: r.next, int: r.int }; }
  if (alg === 'bot') { const f = botRng(seed); return { next: f }; }
  throw new Error('unknown alg ' + alg);
}

/** Vector runner. input: {alg, seed, op, ...}. */
export function run(input) {
  if (input.op === 'fnv1a') return { u32: fnv1a(input.str) };
  const r = makeStream(input.alg, input.seed);
  switch (input.op) {
    case 'u32': return { values: Array.from({ length: input.n }, () => r.nextU32()) };
    case 'float': return { values: Array.from({ length: input.n }, () => r.next()) };
    case 'int': return { values: Array.from({ length: input.n }, () => r.int(input.lo, input.hi)) };
    case 'range': return { values: Array.from({ length: input.n }, () => r.range(input.lo, input.hi)) };
    case 'chance': return { values: Array.from({ length: input.n }, () => r.chance(input.p)) };
    case 'pick': return { values: Array.from({ length: input.n }, () => r.pick(input.items)) };
    case 'shuffle': return { values: r.shuffle(input.items.slice()) };
    default: throw new Error('unknown op ' + input.op);
  }
}
