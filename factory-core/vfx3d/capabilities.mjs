// vfx3d.validate / vfx3d.sample over an effect JSON (inline `effect` or a project-relative `file`).
// Library: templates/web-project/src/lib/vfx3d.js. Spec: spec/v4/vfx3d.md.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ok, fail } from '../registry.mjs';
import * as V from '../../templates/web-project/src/lib/vfx3d.js';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };
const src = { effect: { type: 'object', description: 'vfx3d definition (spec/v4/schemas/vfx3d.schema.json)' }, file: { type: 'string', description: 'path to an effect .json (relative to project)' }, project: { type: 'string' } };
const MAX_SAMPLES = 2000;

function load(i) {
  if (i.effect) return i.effect;
  if (!i.file) throw Object.assign(new Error('pass effect (inline JSON) or file'), { code: 'BAD_INPUT' });
  const abs = resolve(i.project || '.', i.file);
  if (!existsSync(abs)) throw Object.assign(new Error(`file not found: ${abs}`), { code: 'NOT_FOUND' });
  try { return JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { throw Object.assign(new Error(`${i.file}: invalid JSON (${e.message})`), { code: 'BAD_INPUT' }); }
}
const wrap = (fn) => async (i) => { try { return await fn(i, load(i)); } catch (e) { return fail(e.code === 'NOT_FOUND' ? 'NOT_FOUND' : e.code === 'BAD_INPUT' ? 'BAD_INPUT' : 'FAILED', e.message); } };

export function registerVfx3d(r) {
  r.register({ name: 'vfx3d.validate', summary: 'Validate a vfx3d effect definition (whirlpool, flood water, sludge, fire, steam, sparks): force field, Gerstner waves, visual params and particle emitters. Errors carry JSON paths; warnings flag choppy waves or a vortex without ramp.',
    inputSchema: obj(src), outputSchema: out,
    handler: wrap(async (i, def) => {
      const v = V.validateEffect(def);
      return v.ok ? ok(v, ['vfx3d.sample to read force/water/particle values at points and times', 'share data.field with boss3d vortex hazards or locomotion3d env.force'])
        : fail('BAD_INPUT', `${v.errors.length} problem(s): ${v.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}`, v.errors);
    }) });

  r.register({ name: 'vfx3d.sample', summary: 'Evaluate an effect at points and times: force-field vector and damage (field), Gerstner water height and normal (water), whirlpool surface height incl. funnel (surface), or live seeded particles of one emitter (particles). Same maths the Godot loader and boss3d/locomotion3d use.',
    inputSchema: obj({ ...src, what: { type: 'string', enum: ['field', 'water', 'surface', 'particles'], description: 'default field' }, points: { type: 'array', maxItems: MAX_SAMPLES, items: vec3, description: '[x,y,z] points (water/surface use x,z); default [[0,0,0]]' },
      times: { type: 'array', maxItems: 200, items: { type: 'number', minimum: 0 }, description: 'seconds; default [0]' }, resisting: { type: 'boolean' }, emitter: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500, description: 'max particles returned' } }), outputSchema: out,
    handler: wrap(async (i, def) => {
      const v = V.validateEffect(def); if (!v.ok) return fail('BAD_INPUT', 'effect is structurally invalid; run vfx3d.validate', v.errors);
      const what = i.what || 'field', pts = i.points || [[0, 0, 0]], times = i.times || [0];
      if (pts.length * times.length > MAX_SAMPLES) return fail('BAD_INPUT', `points x times is ${pts.length * times.length}, max ${MAX_SAMPLES}`);
      const samples = [];
      if (what === 'particles') {
        const em = (def.emitters || [])[i.emitter ?? 0]; if (!em) return fail('BAD_INPUT', `emitter ${i.emitter ?? 0} not found (effect has ${(def.emitters || []).length})`);
        for (const t of times) { const ps = V.emitterParticles(em, def.seed ?? 0, t); samples.push({ t, count: ps.length, hash: V.hashJSON(ps), particles: ps.slice(0, i.limit ?? 20) }); }
        return ok({ what, samples }, ['vary times to see the emitter evolve; hash is stable for a given seed']);
      }
      if ((what === 'field' && !def.field) || ((what === 'water' || what === 'surface') && !def.water)) return fail('BAD_INPUT', `effect has no ${what === 'field' ? 'field' : 'water'} block to sample`);
      for (const t of times) for (const p of pts) {
        if (what === 'field') samples.push({ t, pos: p, force: V.fieldForce(def.field, p, t, { resisting: !!i.resisting }), amp: V.fieldAmp(def.field, t), dps: V.fieldDps(def.field, p) });
        else if (what === 'water') samples.push({ t, x: p[0], z: p[2], height: V.waterHeight(def.water, p[0], p[2], t), normal: V.waterNormal(def.water, p[0], p[2], t), level: V.waterLevel(def.water, t) });
        else samples.push({ t, x: p[0], z: p[2], height: V.surfaceHeight(def, p[0], p[2], t) });
      }
      return ok({ what, samples, hash: V.hashJSON(samples) }, ['feed field.force to boss3d/locomotion3d env.force; feed water height to env.water({surfaceY})']);
    }) });
}
