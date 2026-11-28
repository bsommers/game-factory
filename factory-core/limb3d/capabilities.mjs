// limb3d.validate / limb3d.simulate over a limb JSON (inline `limb` or a project-relative `file`).
// Library: templates/web-project/src/lib/limb3d.js. Spec: spec/v4/limb3d.md.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ok, fail } from '../registry.mjs';
import * as L from '../../templates/web-project/src/lib/limb3d.js';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const src = { limb: { type: 'object', description: 'limb definition (spec/v4/schemas/limb3d.schema.json)' }, file: { type: 'string', description: 'path to a limb .json (relative to project)' }, project: { type: 'string' } };
const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };

function load(i) {
  if (i.limb) return i.limb;
  if (!i.file) throw Object.assign(new Error('pass limb (inline JSON) or file'), { code: 'BAD_INPUT' });
  const abs = resolve(i.project || '.', i.file);
  if (!existsSync(abs)) throw Object.assign(new Error(`file not found: ${abs}`), { code: 'NOT_FOUND' });
  try { return JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { throw Object.assign(new Error(`${i.file}: invalid JSON (${e.message})`), { code: 'BAD_INPUT' }); }
}
const wrap = (fn) => async (i) => { try { return await fn(i, load(i)); } catch (e) { return fail(e.code === 'NOT_FOUND' ? 'NOT_FOUND' : e.code === 'BAD_INPUT' ? 'BAD_INPUT' : 'FAILED', e.message); } };

export function registerLimb3d(r) {
  r.register({ name: 'limb3d.validate', summary: 'Validate a limb3d definition (hydra neck / tentacle): segment count and lengths, radius, solver, bend limits, seek, sway, sever/regrow and motion timings. Returns errors with JSON paths plus warnings and reach.',
    inputSchema: obj(src), outputSchema: out,
    handler: wrap(async (i, def) => {
      const v = L.validateLimb(def);
      return v.ok ? ok(v, ['limb3d.simulate to run a scripted target path and check segment length error and capsules'])
        : fail('BAD_INPUT', `${v.errors.length} problem(s): ${v.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}`, v.errors);
    }) });

  r.register({ name: 'limb3d.simulate', summary: 'Run a limb headlessly over a scripted path (target keyframes, motion commands, severs): tip trajectory, max segment length error, max bend angle, capsule-list summary (count min/max/mean, damaging frames), event counts, final bone pose and a determinism hash.',
    inputSchema: obj({ ...src, steps: { type: 'integer', minimum: 1, maximum: 36000 }, seed: { type: 'integer' }, sample: { type: 'integer', minimum: 1, maximum: 600, description: 'trajectory sampling interval in steps' },
      targets: { type: 'array', maxItems: 1000, items: obj({ f: { type: 'integer', minimum: 0 }, pos: vec3 }, ['f', 'pos']), description: 'target keyframes, linearly interpolated, sorted by f' },
      commands: { type: 'array', maxItems: 1000, items: obj({ f: { type: 'integer', minimum: 0 }, motion: { type: 'string' }, target: vec3 }, ['f', 'motion']) },
      severs: { type: 'array', maxItems: 1000, items: obj({ f: { type: 'integer', minimum: 0 }, keep: { type: 'integer', minimum: 1 } }, ['f', 'keep']) },
      full: { type: 'boolean', description: 'include the event list and final pose' } }), outputSchema: out,
    handler: wrap(async (i, def) => {
      const v = L.validateLimb(def); if (!v.ok) return fail('BAD_INPUT', 'limb definition is invalid; run limb3d.validate', v.errors);
      const keys = (i.targets || []).slice().sort((a, b) => a.f - b.f);
      for (const c of i.commands || []) if (!def.motions?.[c.motion]) return fail('BAD_INPUT', `command references unknown motion '${c.motion}'`);
      const res = L.simulate(def, { steps: i.steps ?? 600, seed: i.seed ?? 1, sample: i.sample ?? 30, targets: keys, commands: i.commands, severs: i.severs });
      if (!i.full) { delete res.events; delete res.finalPose; }
      const bad = res.segmentLengthError > 1e-3;
      return bad ? { ok: false, data: res, error: { code: 'TASK_FAILED', message: `segment length error ${res.segmentLengthError} exceeds 0.001` }, next: ['check limb3d.validate; lengths must stay rigid'] }
        : ok(res, ['feed data.capsules shape into combat3d hitboxes; apply pose bones to a Skeleton3D']);
    }) });
}
