// Deterministic vector runner for autopilot-kit.js. Closures in the JS API are replaced by declarative fixtures:
//   trajectory: entities from a hazard-kit registry (kinds as in hazard-kit runner; extra pattern 'faulty' throws in update)
//   search: costTable[family][i] gives cost(macro) where macro = {family, n} and make(n) = {family, n}
//   humanize/autopilot rng: {kind:'pcg32'|'bot', seed}
import * as A from '../../templates/web-project/src/lib/autopilot-kit.js';
import * as H from '../../templates/web-project/src/lib/hazard-kit.js';
import { pcg32, makeStream } from '../rng-reference.mjs';

const mkRng = (r) => (r.kind === 'pcg32' ? pcg32(r.seed).next : makeStream('bot', r.seed).next);

export function run(input) {
  switch (input.op) {
    case 'input': return { value: A.input(...input.args) };
    case 'botRng': { const f = A.botRng(input.seed); return { values: Array.from({ length: input.n }, f) }; }
    case 'trajectory': {
      const reg = H.createRegistry();
      for (const [name, k] of Object.entries(input.kinds)) {
        reg.register(name, k.pattern === 'faulty' ? { init() {}, update() { throw new Error('boom'); } } : H[k.pattern](k.params ?? {}), k.defaults ?? {});
      }
      const ents = input.entities.map((s) => reg.spawn(s.kind, s.props ?? {}, {}));
      const upd = (e, dt) => reg.update([e], dt, {});
      return { frames: A.trajectory(ents, input.n, input.dt, upd) };
    }
    case 'search': {
      const fam = input.families.map((f, fi) => ({ bias: f.bias, make: (n) => ({ family: fi, n }) }));
      const stride = input.opts?.stride ?? 3;
      const cost = (m) => input.costTable[m.family][m.n / stride];
      return { result: A.searchMacros(fam, cost, input.opts ?? {}) };
    }
    case 'watchdog': {
      const wd = A.makeWatchdog(input.opts ?? {}), steps = [];
      input.ticks.forEach(([k, time], i) => {
        const flail = wd.tick(k, time);
        steps.push({ flail, input: flail ? wd.flail(i + 1) : null, stuck: wd.stuck });
      });
      return { steps };
    }
    case 'humanize': {
      const h = A.humanize(input.skill, mkRng(input.rng));
      return { outputs: input.seq.map((s) => h(A.input(s.dx ?? 0, s.dy ?? 0, !!s.jp), s.canAct ?? true)) };
    }
    case 'autopilot': {
      let cur;
      const ap = A.createAutopilot({
        decide: () => { if (cur.decide === 'throw') throw new Error('decide failed'); return A.input(cur.decide.dx, cur.decide.dy ?? 0, !!cur.decide.jump); },
        progressKey: () => cur.key, time: () => cur.time, playing: () => cur.playing ?? true,
        canHumanize: () => cur.canHumanize ?? true, skill: input.cfg.skill, seed: input.cfg.seed, watchdog: input.cfg.watchdog,
      });
      const outputs = input.ticks.map((t) => { cur = t; return ap.input({}, 1 / 60); });
      return { outputs, stats: { errors: ap.stats.errors, stuck: ap.stats.stuck, hasError: ap.stats.lastError != null } };
    }
    default: throw new Error('unknown op ' + input.op);
  }
}
