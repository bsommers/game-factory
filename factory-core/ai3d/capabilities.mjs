// Enemy AI capabilities: ai3d.validate (config or scenario) and ai3d.simulate (scripted world -> decision timeline).
// Library: templates/web-project/src/lib/ai3d.js. Spec: spec/v4/ai3d.md.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ok, fail } from '../registry.mjs';
import * as AI from '../../templates/web-project/src/lib/ai3d.js';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const src = { config: { type: 'object', description: 'one AI config (spec/v4/ai3d.md)' }, scenario: { type: 'object', description: 'simulation scenario bundling configs, agents, world, target' }, file: { type: 'string', description: 'path to a JSON config or scenario (relative to project)' }, project: { type: 'string' } };
const MAX_TIMELINE = 500;

function load(i) {
  const n = ['config', 'scenario', 'file'].filter((k) => i[k] !== undefined).length;
  if (n !== 1) throw Object.assign(new Error('pass exactly one of config, scenario, file'), { code: 'BAD_INPUT' });
  if (i.file !== undefined) {
    const abs = resolve(i.project || '.', i.file);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw Object.assign(new Error(`file not found: ${abs}`), { code: 'NOT_FOUND' });
    try { return JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { throw Object.assign(new Error(`${i.file}: invalid JSON (${e.message})`), { code: 'BAD_INPUT' }); }
  }
  return i.config ?? i.scenario;
}
// semantic + reference checks on a config doc or a scenario
function check(doc) {
  const errors = [], warnings = [];
  if (doc && doc.configs) {
    for (const [k, c] of Object.entries(doc.configs)) { const r = AI.validateConfig(c, `configs.${k}`); errors.push(...r.errors); warnings.push(...r.warnings); }
    if (!Array.isArray(doc.agents) || !doc.agents.length) errors.push('agents: needs at least one agent');
    const ids = new Set();
    (doc.agents || []).forEach((a, k) => { if (!doc.configs[a.config]) errors.push(`agents[${k}].config: unknown config "${a.config}"`); if (ids.has(a.id)) errors.push(`agents[${k}].id: duplicate "${a.id}"`); ids.add(a.id); if (!Array.isArray(a.pos) || a.pos.length !== 3) errors.push(`agents[${k}].pos: need [x,y,z]`); });
    if (!(doc.duration > 0)) errors.push('duration: must be > 0');
    if (doc.dt !== undefined && !(doc.dt > 0 && doc.dt <= 0.1)) errors.push('dt: must be in (0, 0.1]');
    if (doc.duration / (doc.dt || AI.DT) > 120000) errors.push('duration/dt exceeds 120000 steps');
    for (const [k, c] of Object.entries(doc.configs)) { const usesTok = Object.values(c.moves || {}).some((m) => m.tokens > 0); if (usesTok && !doc.group) warnings.push(`configs.${k}: moves need tokens but the scenario has no group (tokens are not enforced)`); }
    if (!doc.target) warnings.push('target: none; agents will never aggro');
    for (const [k, p] of Object.entries({ grid: doc.world?.grid, waypoints: doc.world?.waypoints })) if (p && k === 'grid' && !(p.width > 0 && p.height > 0)) errors.push('world.grid: width/height must be > 0');
  } else { const r = AI.validateConfig(doc, 'config'); errors.push(...r.errors); warnings.push(...r.warnings); }
  return { errors, warnings };
}
const wrap = (fn) => async (i) => { try { return await fn(i); } catch (e) { return fail(e.code === 'NOT_FOUND' || e.code === 'BAD_INPUT' ? e.code : 'FAILED', e.message); } };

export function registerAi3d(r) {
  r.register({ name: 'ai3d.validate', summary: 'Validate an enemy AI config (behaviour tree, perception, moves) or a simulation scenario: unknown conditions/actions/moves, bad ranges, tree depth, agent/config references. Errors and warnings carry JSON paths.',
    inputSchema: obj(src), outputSchema: out,
    handler: wrap(async (i) => {
      const doc = load(i), { errors, warnings } = check(doc), kind = doc && doc.configs ? 'scenario' : 'config';
      if (errors.length) return { ok: false, data: { kind, errors, warnings }, error: { code: 'BAD_INPUT', message: `${errors.length} problem(s) in the ${kind}`, details: errors }, next: ['fix the listed paths, then re-run ai3d.validate'] };
      return ok({ kind, errors, warnings }, [kind === 'scenario' ? 'ai3d.simulate {scenario|file} to see the decision timeline' : 'wrap it in a scenario (configs, agents, target, duration) and run ai3d.simulate']);
    }) });

  r.register({ name: 'ai3d.simulate', summary: 'Run enemy AI headlessly in a scripted world (walls for line of sight, grid/waypoint nav, a target walking a timed path, sounds, damage events) and return the decision timeline, attack counts, token stats and a determinism hash.',
    inputSchema: obj({ ...src, duration: { type: 'number', minimum: 0, description: 'override scenario duration (seconds)' }, seed: { type: 'integer', description: 'override scenario seed' }, limit: { type: 'integer', minimum: 1, maximum: 5000, description: `max timeline entries returned (default ${MAX_TIMELINE})` } }), outputSchema: out,
    handler: wrap(async (i) => {
      const doc = load(i); if (!doc || !doc.configs) return fail('BAD_INPUT', 'ai3d.simulate needs a scenario (configs, agents, target, duration); a bare config has no world to run in');
      const sc = { ...doc, ...(i.duration !== undefined ? { duration: i.duration } : {}), ...(i.seed !== undefined ? { seed: i.seed } : {}) };
      const { errors } = check(sc); if (errors.length) return fail('BAD_INPUT', `${errors.length} problem(s) in the scenario`, errors, ['ai3d.validate for the full list']);
      const res = AI.simulate(sc), cap = i.limit ?? MAX_TIMELINE, truncated = res.timeline.length > cap;
      return ok({ ...res, timeline: res.timeline.slice(0, cap), timelineTotal: res.timeline.length, truncated }, ['compare "hash" across runs/ports: it must be identical for the same scenario and seed', 'tune cooldowns/ranges in the config and re-run']);
    }) });
}
