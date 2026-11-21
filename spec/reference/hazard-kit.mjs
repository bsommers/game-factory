// Deterministic vector runner for hazard-kit.js. Behaviours are described declaratively:
//   kinds: { name: { pattern:'patroller'|'roller'|'stationary'|'cycler'|'spawner'|'tauntingBoss', params, defaults } }
//   spawner params.props / tauntingBoss params.throwProps are STATIC objects (fixture for makeProps()).
// g.rng is the spec PCG32 (seeded from input.rngSeed). Entities spawned during update() are appended to the live list
// and (JS array iteration semantics) are updated in the SAME tick.
import * as H from '../../templates/web-project/src/lib/hazard-kit.js';
import { pcg32 } from '../rng-reference.mjs';

function behaviour(k) {
  const p = { ...(k.params ?? {}) };
  if (p.props) { const props = p.props; delete p.props; p.makeProps = () => ({ ...props }); }
  if (p.throwProps) { const tp = p.throwProps; delete p.throwProps; p.throwProps = () => ({ ...tp }); }
  return H[k.pattern](p);
}
function makeReg(kinds) {
  const reg = H.createRegistry();
  for (const [name, k] of Object.entries(kinds)) reg.register(name, behaviour(k), k.defaults ?? {});
  return reg;
}
export const entSnap = (e) => ({ ...e, st: { ...e.st } });

export function run(input) {
  switch (input.op) {
    case 'overlaps': return { results: input.cases.map((c) => H.overlaps(c.p, c.hw, c.hh, c.e)) };
    case 'sim': {
      const reg = makeReg(input.kinds), events = []; let tick = 0, time = 0;
      const ents = [];
      const g = { rng: input.rngSeed != null ? pcg32(input.rngSeed) : undefined, width: input.width,
        spawn: (kind, props) => { const e = reg.spawn(kind, props, g); ents.push(e); return e; },
        emit: (name, data) => events.push({ tick, name, data: data.ent ? { ...data, ent: data.ent.id } : data }) };
      if (input.noRng) delete g.rng;
      for (const s of input.entities) g.spawn(s.kind, s.props ?? {});
      const frames = [ents.map(entSnap)];
      for (tick = 1; tick <= input.ticks; tick++) { reg.update(ents, input.dt, g); frames.push(ents.map(entSnap)); }
      return { frames, events, count: ents.length };
    }
    case 'contacts': {
      const reg = makeReg(input.kinds), g = {}, ents = input.entities.map((s) => reg.spawn(s.kind, s.props ?? {}, g));
      const steps = input.steps.map((s) => {
        const gg = s.time != null ? { time: s.time } : {};
        const res = H.resolveContacts(reg, s.player, ents, input.opts ?? {}, gg);
        return res.map((r) => ({ type: r.type, ent: r.ent.id, kind: r.kind ?? null, amount: r.amount ?? null }));
      });
      return { steps, ents: ents.map(entSnap) };
    }
    case 'solid': {
      const reg = makeReg(input.kinds), ents = input.entities.map((s) => reg.spawn(s.kind, s.props ?? {}, {}));
      const id = (e) => (e ? e.id : null);
      return {
        under: input.under.map(([x, y, prevY, slack]) => id(H.solidTopUnder(ents, x, y, prevY, slack))),
        carrying: input.carrying.map(([x, y, slack]) => id(H.solidTopCarrying(ents, x, y, slack))),
      };
    }
    default: throw new Error('unknown op ' + input.op);
  }
}
