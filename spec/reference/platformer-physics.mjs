// Deterministic vector runner for platformer-physics.js. Pure data in, pure data out. No RNG involved.
import * as P from '../../templates/web-project/src/lib/platformer-physics.js';

const snap = (b, ropes, ladders) => ({
  x: b.x, y: b.y, vx: b.vx, vy: b.vy, face: b.face, mode: b.mode, layer: b.layer, landed: b.landed,
  onPlatform: b.onPlatform != null && typeof b.onPlatform === 'object' ? '[obj]' : b.onPlatform ?? null,
  grabCd: b.grabCd, swingK: b.swingK, offX: b.offX, offY: b.offY, t: b.t, deathKind: b.deathKind,
  rope: b.rope ? ropes.indexOf(b.rope) : null, ladder: b.ladder ? ladders.indexOf(b.ladder) : null,
});

function buildWorld(w) {
  const ropes = (w.ropes ?? []).map((r) => P.pendulum(r));
  const movers = [];
  const platforms = (w.platforms ?? []).map((p) => {
    if (p.moving) { const m = P.movingPlatform({ id: p.id, ...p.moving }); movers.push(m); return m; }
    return { ...p };
  });
  const world = { groundY: w.groundY, pits: w.pits ?? [], platforms, ladders: w.ladders ?? [], ropes };
  if (w.bounds) world.bounds = w.bounds;
  return { world, ropes, movers };
}

export function run(input) {
  const cfg = P.makeConfig(input.cfg ?? {});
  switch (input.op) {
    case 'ranges': return { jumpRange: P.jumpRange(cfg), jumpHeight: P.jumpHeight(cfg) };
    case 'pendulum': {
      const p = P.pendulum(input.rope);
      return { samples: input.ts.map((t) => ({ angle: p.angle(t), tip: p.tip(t), tipVel: p.tipVel(t) })) };
    }
    case 'moving': {
      const m = P.movingPlatform(input.platform), frames = [{ x: m.x, y: m.y, dx: m.dx, dy: m.dy, t: m.t }];
      for (let i = 0; i < input.ticks; i++) { m.update(input.dt); frames.push({ x: m.x, y: m.y, dx: m.dx, dy: m.dy, t: m.t }); }
      return { frames };
    }
    case 'support': {
      const { world } = buildWorld(input.world);
      const out = {
        pitAt: (input.pitAt ?? []).map((x) => { const q = P.pitAt(world, x); return q ? world.pits.indexOf(q) : null; }),
        ladderAt: (input.ladderAt ?? []).map(([x, y]) => { const l = P.ladderAt(world, x, y); return l ? world.ladders.indexOf(l) : null; }),
        supportAt: (input.supportAt ?? []).map(([x, y]) => { const s = P.supportAt(world, x, y); return s ? { y: s.y, platform: s.platform ? s.platform.id : null } : null; }),
      };
      return out;
    }
    case 'edge': return { results: input.cases.map((c) => { const b = { ...P.makeBody(c.body.x, 0), mode: c.body.mode ?? 'ground' }; return { wrapIndex: P.wrapIndex(c.idx, c.count), tr: P.edgeTransition(b, c.idx, c.count, P.makeConfig(c.cfg ?? {})) }; }) };
    case 'sim': {
      const { world, ropes, movers } = buildWorld(input.world);
      const lookup = new Map();
      world.platforms.forEach((p) => lookup.set(p, { platform: p.id }));
      world.pits.forEach((q, i) => lookup.set(q, { pit: i }));
      world.ladders.forEach((l, i) => lookup.set(l, { ladder: i }));
      const events = []; let tick = 0;
      cfg.emit = (name, b, extra) => {
        let ex = null;
        if (extra !== undefined) ex = lookup.get(extra) ?? (typeof extra === 'object' ? { ...extra } : extra);
        events.push({ tick, name, extra: ex });
      };
      const b = Object.assign(P.makeBody(input.body.x, input.body.y), input.body.set ?? {});
      const seq = []; for (const s of input.script) for (let i = 0; i < s.n; i++) seq.push({ dx: s.dx ?? 0, dy: s.dy ?? 0, jumpPressed: !!s.jp });
      let t = 0; const frames = [];
      for (tick = 0; tick < seq.length; tick++) {
        for (const m of movers) m.update(input.dt);
        if (input.useWorldT) { t += input.dt; world.t = t; }
        P.stepBody(b, seq[tick], input.dt, world, cfg);
        frames.push(snap(b, ropes, world.ladders));
      }
      return { frames, events };
    }
    default: throw new Error('unknown op ' + input.op);
  }
}
