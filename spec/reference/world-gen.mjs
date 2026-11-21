// Deterministic vector runner for world-gen.js. Rule tables are JSON; the JS escape hatches are replaced by named
// fixtures (a port must implement these fixtures too, they are part of the spec):
//   slots.X.build = {type:'pit', chance:num|{base,perT,from,to}, w:num|{from,to,perT}, kind, lo?, hi?}
//   collectibles.exclude = 'key' (def => !!def[key]);  collectibles.prefer = {every, pitKind}
//   validate.crossable = {maxPit}; validate.hard = {tags:[..]} (isHard = tag in list)
// world-gen's own RNG is the legacy mulberry32 (createRng); it cannot be injected without editing the lib. See spec/rng.md.
import * as W from '../../templates/web-project/src/lib/world-gen.js';

function compile(rules) {
  const r = structuredClone(rules);
  for (const slot of Object.values(r.slots ?? {})) {
    const b = slot.build;
    if (b && typeof b === 'object') {
      slot.build = (def, ctx) => {
        if (!ctx.rng.chance(W.lerpVal(b.chance ?? 1, ctx.t))) return;
        const w = Math.round(W.lerpVal(b.w, ctx.t));
        const xs = ctx.freeXs({ lo: b.lo ?? 60, hi: b.hi ?? 260 });
        if (!xs.length) return;
        const x0 = ctx.rng.pick(xs);
        def.pit = { kind: b.kind ?? 'hole', x0, w };
        def.zones.push({ x0, x1: x0 + w, pit: true });
      };
    }
  }
  const c = r.collectibles;
  if (c) {
    if (typeof c.exclude === 'string') { const k = c.exclude; c.exclude = (def) => !!def[k]; }
    if (c.prefer && typeof c.prefer === 'object') { const { every, pitKind } = c.prefer; c.prefer = (def, k) => k % every === 0 && def.pit?.kind === pitKind; }
  }
  return r;
}
const vOpts = (v = {}) => {
  const o = { ...v }; delete o.crossable; delete o.hard;
  if (v.crossable) o.crossable = (def) => !def.pit || def.pit.w <= v.crossable.maxPit || `pit ${def.pit.w} too wide`;
  if (v.hard) o.isHard = (def) => v.hard.tags.includes(def.tag);
  return o;
};

export function run(input) {
  switch (input.op) {
    case 'helpers': return {
      wrap: input.wrap.map(([i, n]) => W.wrap(i, n)),
      circDist: input.circDist.map(([a, b, n]) => W.circDist(a, b, n)),
      rampOf: input.rampOf.map(([i, s, n]) => W.rampOf(i, s, n)),
      lerpVal: input.lerpVal.map(([v, t]) => W.lerpVal(v, t)),
    };
    case 'rng': { const r = W.createRng(input.seed); return { values: Array.from({ length: input.n }, () => r.next()) }; }
    case 'shuffle': { const r = W.createRng(input.seed); return { values: W.shuffle(input.items.slice(), r) }; }
    case 'weighted': { const r = W.createRng(input.seed); return { values: Array.from({ length: input.n }, () => W.pickWeighted(r, input.items)) }; }
    case 'generate': {
      const rules = compile(input.rules), w = W.generateWorld(rules);
      const out = { world: w, deterministic: W.isDeterministic(compile(input.rules)) };
      if (input.validate) out.validation = W.validateWorld(w, vOpts(input.validate));
      return out;
    }
    case 'validate': return { validation: W.validateWorld(input.world, vOpts(input.opts)) };
    default: throw new Error('unknown op ' + input.op);
  }
}
