// Reference bot: deterministic look-ahead. decide(g) -> {dx, dy}. It never stalls: every candidate plan is scored on the CLONED game
// after `horizon` ticks, and progress toward the goal is part of the score, so the bot keeps advancing and only detours around danger.
// (A force-sum bot, goal pull minus hazard push, parks at the equilibrium point and stalls; do not write that.)
// skill: 0 = beeline (ignores hazards: the "novice"), 1 = short look-ahead, 2+ = longer look-ahead + wider plan family.
// 0<skill<1 is humanised: with probability 1-skill a decision is a plain beeline (seeded, deterministic).
import { DT } from '../core/defs.js';

const DIRS = (() => { const a = []; for (let i = 0; i < 16; i++) a.push([Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]); a.push([0, 0]); return a; })();
const near = (v) => Math.round(v * 1e6) / 1e6;

export function createBot({ skill = 1, seed = 1 } = {}) {
  let s = (seed | 0) || 1; // tiny LCG, independent of the game's rng
  const rand = () => { s = (Math.imul(s, 1664525) + 1013904223) | 0; return (s >>> 0) / 4294967296; };
  const horizon = skill <= 0 ? 0 : Math.round(18 * Math.min(skill, 4) ** 0.8) + 6; // ticks looked ahead per plan
  let hold = null; // [dx, dy, ticksLeft]: commit to a chosen direction for a few ticks (stable, cheap)

  const beeline = (g) => { const { player: p, goal } = g.snapshot(); const d = Math.hypot(goal.x - p.x, goal.y - p.y) || 1; return { dx: (goal.x - p.x) / d, dy: (goal.y - p.y) / d }; };

  function score(g, dx, dy, ticks) {
    const sim = g.clone(), in0 = { dx, dy };
    const hp0 = sim.snapshot().player.hp;
    for (let i = 0; i < ticks && !sim.outcome; i++) {
      // plan: hold the first direction for 1/3 of the horizon, then beeline (so a dodge is followed by progress, not another dodge)
      sim.update(DT, i < ticks / 3 ? in0 : beeline(sim));
    }
    const a = sim.snapshot(), lost = hp0 - a.player.hp;
    if (sim.outcome?.win) return 1e6 - sim.t;
    if (sim.outcome) return -1e6;
    return -lost * 1000 - Math.hypot(a.goal.x - a.player.x, a.goal.y - a.player.y);
  }

  return {
    skill,
    decide(g) {
      if (horizon === 0 || (skill < 1 && rand() > skill)) { hold = null; return beeline(g); }
      if (hold && hold[2] > 0) { hold[2]--; return { dx: hold[0], dy: hold[1] }; }
      const b = beeline(g);
      let best = null, bestScore = -Infinity;
      for (const [dx, dy] of [[b.dx, b.dy], ...DIRS]) { // beeline first: wins ties, so equal plans keep making progress
        const v = near(score(g, dx, dy, horizon));
        if (v > bestScore) { bestScore = v; best = [dx, dy]; }
      }
      hold = [best[0], best[1], 4];
      return { dx: best[0], dy: best[1] };
    },
  };
}
