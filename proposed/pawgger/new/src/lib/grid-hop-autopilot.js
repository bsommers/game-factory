// grid-hop-autopilot: generic time-expanded A* planner for Frogger-like games (zero deps, deterministic, Node-safe).
// The game supplies the world as predicates; the planner searches (col,row,tick) states over hop and wait macros.
//   planHops({start:{col,row}, tick0?, goal(col,row)->bool, safe(col,row,tick)->bool,
//             canHop?(col,row,dir)->bool, hopTicks?=8, waitTicks?=4, maxTicks?=1800, dirs?, bounds?:{cols,rows},
//             carry?(col,row,tick)->colShift})
//   -> null (no plan) or {ticks, actions:[{dir:'up'|'down'|'left'|'right'|'wait', tick}]}  (tick = absolute start tick)
// safe(col,row,tick) must be true for the LANDING cell at landing time AND is also sampled at the take-off tick;
// carry (optional) shifts the column by whole cells while waiting on a drifting platform (logs, turtles).
// Optional h(col,row) must be an admissible lower bound on remaining ticks (default 0 = Dijkstra, always admissible).
export const DIR_STEP = Object.freeze({ up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] });

export function planHops(o) {
  const hopT = o.hopTicks ?? 8, waitT = o.waitTicks ?? 4, maxT = o.maxTicks ?? 1800, t0 = o.tick0 ?? 0;
  const dirs = o.dirs ?? ['up', 'left', 'right', 'down'];
  const b = o.bounds ?? null, h = o.h ?? (() => 0);
  const key = (c, r, t) => c + ',' + r + ',' + t;
  const open = [{ c: o.start.col, r: o.start.row, t: t0, g: 0, f: h(o.start.col, o.start.row), prev: null, act: null }];
  const seen = new Set([key(o.start.col, o.start.row, t0)]);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f || (open[i].f === open[bi].f && open[i].g > open[bi].g)) bi = i;
    const n = open.splice(bi, 1)[0];
    if (o.goal(n.c, n.r)) {
      const acts = [];
      for (let m = n; m.prev; m = m.prev) acts.push(m.act);
      return { ticks: n.t - t0, actions: acts.reverse() };
    }
    if (n.t - t0 >= maxT) continue;
    const push = (c, r, t, act) => {
      const k = key(c, r, t);
      if (seen.has(k)) return;
      seen.add(k);
      const g = t - t0;
      open.push({ c, r, t, g, f: g + h(c, r), prev: n, act });
    };
    // wait (drift with the carrier if any)
    const sh = o.carry ? o.carry(n.c, n.r, n.t) : 0, wc = n.c + sh;
    if (!b || (wc >= 0 && wc < b.cols)) if (o.safe(wc, n.r, n.t + waitT)) push(wc, n.r, n.t + waitT, { dir: 'wait', tick: n.t });
    for (const d of dirs) {
      const [dx, dy] = DIR_STEP[d];
      const c = n.c + dx, r = n.r + dy;
      if (b && (c < 0 || c >= b.cols || r < 0 || r >= b.rows)) continue;
      if (o.canHop && !o.canHop(n.c, n.r, d)) continue;
      if (!o.safe(n.c, n.r, n.t) || !o.safe(c, r, n.t + hopT)) continue;
      push(c, r, n.t + hopT, { dir: d, tick: n.t });
    }
  }
  return null;
}

/** Turn a plan into a per-tick decider: decide(tick) -> 'up'|'down'|'left'|'right'|null (wait = null). */
export function planDecider(plan) {
  const at = new Map();
  if (plan) for (const a of plan.actions) if (a.dir !== 'wait') at.set(a.tick, a.dir);
  return (tick) => at.get(tick) ?? null;
}
