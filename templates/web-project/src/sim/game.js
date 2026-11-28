// Reference sim (stub): reach the goal while patrolling enemies bounce up and down their column. Pure, deterministic, DOM-free,
// so botplay/balance run it headless. Replace with the real game but keep the contract (docs/BOTPLAY.md):
//   createGame({seed, level, bus}) -> { update(dt, input), snapshot(), clone(), t, score, outcome }
//   input = {dx, dy} in [-1,1]; outcome = null | {win:boolean, reason:string}; snapshot().player = {x, y, hp}.
import { TUNING } from '../core/defs.js';

// Same data as levels/level01.json (a test keeps them identical). The browser imports this: no fetch/JSON needed in the single-file build.
export const DEFAULT_LEVEL = Object.freeze({
  id: 'level01', title: 'Level 1', width: 20, height: 12, playerHp: 2,
  player: { x: 1, y: 6 }, goal: { x: 19, y: 6 },
  entities: [{ x: 5, y: 2, hp: 1, speed: 3, count: 4 }, { x: 10, y: 8, hp: 1, speed: 4, count: 4 }, { x: 15, y: 4, hp: 1, speed: 3.5, count: 4 }],
});

function rng(seed) { // mulberry32
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Build the initial plain-data state. Levels without width/height/player/goal/entities still play (trivial level). */
export function initState(level, seed = 1) {
  const W = level.width ?? 20, H = level.height ?? 12, rand = rng(seed);
  const enemies = [];
  for (const e of level.entities ?? []) {
    const n = Math.max(1, Math.round(e.count ?? 1));
    for (let i = 0; i < n; i++) {
      enemies.push({ x: e.x, y: (((e.y ?? 0) + (i * H) / n) % H + H) % H, dir: rand() < 0.5 ? -1 : 1, speed: e.speed ?? 2, hp: e.hp ?? 1 });
    }
  }
  const p = level.player ?? { x: 1, y: H / 2 }, goal = level.goal ?? { x: W - 1, y: H / 2 };
  return { W, H, t: 0, score: 0, outcome: null, goal: { ...goal }, enemies, hitCount: 0, ticks: 0,
    player: { x: p.x, y: p.y, hp: level.playerHp ?? TUNING.playerHp, inv: 0 } };
}

/** Advance a state by dt. Mutates `s`; returns the events that happened (['hit'|'win'|'lose']). */
export function step(s, dt, input = {}) {
  const ev = [];
  if (s.outcome) return ev;
  s.t += dt; s.ticks++;
  let dx = Number.isFinite(input.dx) ? input.dx : 0, dy = Number.isFinite(input.dy) ? input.dy : 0;
  const len = Math.hypot(dx, dy); if (len > 1) { dx /= len; dy /= len; }
  const p = s.player;
  p.x = Math.min(s.W, Math.max(0, p.x + dx * TUNING.playerSpeed * dt));
  p.y = Math.min(s.H, Math.max(0, p.y + dy * TUNING.playerSpeed * dt));
  p.inv = Math.max(0, p.inv - dt);
  for (const e of s.enemies) {
    e.y += e.dir * e.speed * dt;
    if (e.y < 0) { e.y = -e.y; e.dir = 1; } else if (e.y > s.H) { e.y = 2 * s.H - e.y; e.dir = -1; }
    if (p.inv === 0 && Math.hypot(e.x - p.x, e.y - p.y) < TUNING.hitRadius) {
      p.hp--; p.inv = TUNING.invuln; s.hitCount++; ev.push('hit');
    }
  }
  if (p.hp <= 0) { s.outcome = { win: false, reason: 'dead' }; ev.push('lose'); }
  else if (Math.hypot(s.goal.x - p.x, s.goal.y - p.y) < TUNING.goalRadius) {
    s.outcome = { win: true, reason: 'goal' }; s.score = Math.round(1000 + p.hp * 100 - s.t * 10); ev.push('win');
  }
  return ev;
}

function wrap(s, bus) {
  return {
    update(dt, input) { for (const type of step(s, dt, input)) bus?.emit(type, { t: s.t, hp: s.player.hp }); },
    snapshot: () => ({ t: s.t, world: { w: s.W, h: s.H }, player: { x: s.player.x, y: s.player.y, hp: s.player.hp }, goal: { ...s.goal }, enemies: s.enemies.map((e) => ({ x: e.x, y: e.y })), outcome: s.outcome }),
    clone: () => wrap(structuredClone(s), null), // events off: the bot's lookahead must not fire sounds
    get t() { return s.t; }, get score() { return s.score; }, get outcome() { return s.outcome; }, get ticks() { return s.ticks; },
  };
}

export function createGame({ seed = 1, level = DEFAULT_LEVEL, bus = null } = {}) {
  return wrap(initState(level, seed), bus);
}
