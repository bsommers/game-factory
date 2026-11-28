// Level size = pure transform of a LevelDef; 1x is the identity. Two shapes are understood:
//   generic     width/height, top-level {x,y} points (player, goal, ...) and entities[{x,y,count?}] are multiplied by k, and each entity's
//               count is multiplied by k too (more floor => more of everything; a missing count counts as 1). No entities => clone + stamp.
//   MicroMaze   tiles+waves+registers (detected by shape): every tile becomes a k x k block, see examples/micromaze-transforms.js.
import { isMicroMaze, microMazeSize } from './examples/micromaze-transforms.js';

export const SIZES = Object.freeze([1, 2, 3]);
export const SIZE_SCORE = Object.freeze({ 1: 1, 2: 1.5, 3: 2 });

export function normalizeSize(s) {
  const n = Number(s);
  return SIZES.includes(n) ? n : 1;
}

const isPt = (o) => o && typeof o === 'object' && typeof o.x === 'number' && typeof o.y === 'number';

export function applySize(level, size) {
  const k = normalizeSize(size);
  const out = structuredClone(level);
  if (k === 1) return out;
  if (isMicroMaze(out)) microMazeSize(level, out, k);
  else if (out && typeof out === 'object') {
    for (const key of ['width', 'height']) if (typeof out[key] === 'number') out[key] *= k;
    for (const [key, v] of Object.entries(out)) if (key !== 'entities' && isPt(v)) { v.x *= k; v.y *= k; }
    for (const e of Array.isArray(out.entities) ? out.entities : []) {
      if (!isPt(e)) continue;
      e.x *= k; e.y *= k;
      e.count = (typeof e.count === 'number' ? e.count : 1) * k;
    }
  }
  if (out && typeof out === 'object') out.size = k;
  return out;
}
