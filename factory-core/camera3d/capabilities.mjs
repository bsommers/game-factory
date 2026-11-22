// camera3d.validate / camera3d.simulate over templates/web-project/src/lib/camera3d.js. Config schema: spec/v4/schemas/camera3d.schema.json.
import { readFileSync } from 'node:fs';
import { ok, fail } from '../registry.mjs';
import { validate } from '../schema.mjs';
import * as C from '../../templates/web-project/src/lib/camera3d.js';

const schema = JSON.parse(readFileSync(new URL('../../spec/v4/schemas/camera3d.schema.json', import.meta.url), 'utf8'));
const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const v3 = { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } };
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const rv = (a) => a.map(r4);
const MAX_FRAMES = 36000;

function problems(config) {
  const errs = validate(schema, config);
  if (errs.length) return errs;
  return C.checkConfig(C.createConfig(config));
}

export function registerCamera3d(r) {
  r.register({ name: 'camera3d.validate', summary: 'Validate a camera3d config (third-person rig: follow, lock-on, aim, fov, shake) against spec/v4/schemas/camera3d.schema.json plus semantic rules (pitch range, min distance). Returns the config with defaults filled.',
    inputSchema: obj({ config: { type: 'object', description: 'camera3d config JSON (all keys optional)' } }, ['config']), outputSchema: out,
    handler: (i) => {
      const errs = problems(i.config);
      if (errs.length) return fail('BAD_INPUT', `invalid camera3d config: ${errs[0]}`, { errors: errs });
      return ok({ valid: true, config: C.createConfig(i.config) }, ['camera3d.simulate {config, path:{waypoints:[[0,0,0],[10,0,0]]}} to preview the camera']);
    } });

  r.register({ name: 'camera3d.simulate', summary: 'Run a scripted target path through the camera rig at dt=1/60 and return sampled camera positions plus a collision summary (frames shortened by geometry, min/max boom length, final pose). World = boxes [{min,max}] and/or flat triangle arrays.',
    inputSchema: obj({
      config: { type: 'object' },
      world: obj({ boxes: { type: 'array', items: obj({ min: v3, max: v3 }, ['min', 'max']) }, tris: { type: 'array', items: { type: 'number' }, description: 'flat xyz triangle soup (9 numbers per triangle)' } }),
      path: obj({ waypoints: { type: 'array', minItems: 1, items: v3 }, speed: { type: 'number', minimum: 0, description: 'm/s along the polyline (default 5)' }, seconds: { type: 'number', minimum: 0, description: 'duration; default = time to walk the path (min 1s)' } }, ['waypoints']),
      lock: { ...v3, description: 'fixed lock-on target point' }, aim: { type: 'boolean' },
      yawRate: { type: 'number', description: 'camera yaw input in rad/s (ignored while locked)' },
      trauma: { type: 'array', items: obj({ at: { type: 'number' }, amount: { type: 'number' } }, ['at', 'amount']) },
      fovKick: { type: 'array', items: obj({ at: { type: 'number' }, deg: { type: 'number' } }, ['at', 'deg']) },
      sampleEvery: { type: 'integer', minimum: 1, description: 'return every Nth frame (default 30)' },
    }, ['path']), outputSchema: out,
    handler: (i) => {
      const cfgIn = i.config || {}, errs = problems(cfgIn);
      if (errs.length) return fail('BAD_INPUT', `invalid camera3d config: ${errs[0]}`, { errors: errs });
      const cfg = C.createConfig(cfgIn), dt = 1 / 60, pts = i.path.waypoints, speed = i.path.speed ?? 5;
      let total = 0; const segs = [];
      for (let k = 1; k < pts.length; k++) { const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1], pts[k][2] - pts[k - 1][2]); segs.push(l); total += l; }
      const seconds = i.path.seconds ?? Math.max(1, speed > 0 ? total / speed : 1), n = Math.round(seconds / dt);
      if (n > MAX_FRAMES) return fail('BAD_INPUT', `simulation too long (${n} frames > ${MAX_FRAMES}); shorten seconds or raise speed`);
      const tris = [...(i.world?.tris || [])]; for (const b of i.world?.boxes || []) tris.push(...C.boxToTris(b.min, b.max));
      const world = tris.length ? { tris: new Float64Array(tris), count: tris.length / 9 } : null;
      const at = (d) => { if (pts.length === 1 || d <= 0) return pts[0]; for (let k = 0; k < segs.length; k++) { if (d <= segs[k] || k === segs.length - 1) { const t = segs[k] > 0 ? Math.min(1, d / segs[k]) : 1; return pts[k].map((v, a) => v + (pts[k + 1][a] - v) * t); } d -= segs[k]; } return pts[pts.length - 1]; };
      const frames = [];
      for (let f = 0; f < n; f++) {
        const t0 = f * dt, t1 = t0 + dt, inp = { target: at(t0 * speed), aim: !!i.aim, yawDelta: (i.yawRate || 0) * dt };
        if (i.lock) inp.lock = i.lock;
        const tr = (i.trauma || []).filter((e) => e.at >= t0 && e.at < t1).reduce((s, e) => s + e.amount, 0); if (tr) inp.trauma = tr;
        const fk = (i.fovKick || []).filter((e) => e.at >= t0 && e.at < t1).reduce((s, e) => s + e.deg, 0); if (fk) inp.fovKick = fk;
        frames.push(inp);
      }
      const res = C.simulate(cfg, frames, world, dt), every = i.sampleEvery || 30, S = res.summary;
      const samples = res.frames.filter((_, k) => k % every === 0 || k === n - 1).map((s, k, arr) => ({ pos: rv(s.pos), target: rv(s.target), fov: r4(s.fov), distance: r4(s.distance), collided: s.collided }));
      const nextHints = [];
      if (S.collisionFrames) nextHints.push(`boom was shortened on ${S.collisionFrames} of ${S.frames} frames; raise follow.collisionRecoverLag or lower follow.distance if it feels cramped`);
      return ok({ frames: S.frames, seconds: r4(n * dt), collisionFrames: S.collisionFrames, firstCollisionFrame: S.firstCollisionFrame, minDistance: r4(S.minDistance), maxDistance: r4(S.maxDistance), final: { pos: rv(S.final.pos), target: rv(S.final.target), fov: r4(S.final.fov) }, samples }, nextHints);
    } });
}
