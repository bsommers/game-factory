// Difficulty = pure transform of a LevelDef. Medium is the identity; unknown tiers fall back to medium.
// Two shapes are understood:
//   generic     optional entities[{x,y,hp?,speed?,count?}]; hp/speed/count scale with the tier. No entities => clone + stamp, never throws.
//   MicroMaze   tiles+waves+registers (detected by shape): the original tuned scaling, see examples/micromaze-transforms.js.
import { isMicroMaze, microMazeDifficulty } from './examples/micromaze-transforms.js';

export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard', 'insane']);

const MODS = Object.freeze({
  easy:   { hp: 0.7, speed: 0.85, count: 0.75, every: 1.2, regHp: 1.5, ammo: 1.5, drop: 0.15 },
  medium: { hp: 1, speed: 1, count: 1, every: 1, regHp: 1, ammo: 1, drop: 0 },
  hard:   { hp: 1.3, speed: 1.15, count: 1.3, every: 0.85, regHp: 0.85, ammo: 0.8, drop: -0.05 },
  insane: { hp: 1.7, speed: 1.35, count: 1.8, every: 0.7, regHp: 0.7, ammo: 0.6, drop: -0.1 },
});

export const SCORE_MULT = Object.freeze({ easy: 0.5, medium: 1, hard: 1.5, insane: 2 });

export function normalizeDifficulty(d) {
  return DIFFICULTIES.includes(d) ? d : 'medium';
}

export function applyDifficulty(level, difficulty) {
  const d = normalizeDifficulty(difficulty);
  const m = MODS[d];
  const out = structuredClone(level);
  if (d === 'medium') return out;
  if (isMicroMaze(out)) microMazeDifficulty(out, m);
  else if (Array.isArray(out?.entities)) {
    const r = (n) => Math.max(1, Math.round(n));
    for (const e of out.entities) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.hp === 'number') e.hp = r(e.hp * m.hp);
      if (typeof e.speed === 'number') e.speed = Math.round(e.speed * m.speed * 10) / 10;
      if (typeof e.count === 'number') e.count = r(e.count * m.count);
    }
  }
  if (out && typeof out === 'object') out.difficulty = d;
  return out;
}
