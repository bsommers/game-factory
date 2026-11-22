// boss3d.validate / boss3d.fairness / boss3d.simulate over a boss JSON (inline `boss` or a project-relative `file`).
// Library: templates/web-project/src/lib/boss3d.js. Spec: spec/v4/boss3d.md.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ok, fail } from '../registry.mjs';
import { validate as schemaValidate } from '../schema.mjs';
import * as B from '../../templates/web-project/src/lib/boss3d.js';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const src = { boss: { type: 'object', description: 'boss definition (spec/v4/schemas/boss3d.schema.json)' }, file: { type: 'string', description: 'path to a boss .json (relative to project)' }, project: { type: 'string' } };
const profileSchema = { type: 'object', description: 'bot skill profile: hp, moveSpeed, reactionMs, dodgeDistance, iframeMs, dodgeCooldownMs, dodgeSkill (0-1), attackDamage, attackIntervalMs, range, weakAwareness (0-1)' };

function load(i) {
  if (i.boss) return i.boss;
  if (!i.file) throw Object.assign(new Error('pass boss (inline JSON) or file'), { code: 'BAD_INPUT' });
  const abs = resolve(i.project || '.', i.file);
  if (!existsSync(abs)) throw Object.assign(new Error(`file not found: ${abs}`), { code: 'NOT_FOUND' });
  try { return JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { throw Object.assign(new Error(`${i.file}: invalid JSON (${e.message})`), { code: 'BAD_INPUT' }); }
}
const wrap = (fn) => async (i) => { try { return await fn(i, load(i)); } catch (e) { return fail(e.code === 'NOT_FOUND' ? 'NOT_FOUND' : e.code === 'BAD_INPUT' ? 'BAD_INPUT' : 'FAILED', e.message); } };

export function registerBoss3d(r) {
  r.register({ name: 'boss3d.validate', summary: 'Validate a boss3d definition: structure (ids, parts, phases, enter conditions, attack timings, zone shapes, hazards) plus warnings. Returns errors with JSON paths.',
    inputSchema: obj(src), outputSchema: out,
    handler: wrap(async (i, def) => {
      const v = B.validateBoss(def);
      return v.ok ? ok(v, ['boss3d.fairness to check telegraphs, avoidability and safe zones', 'boss3d.simulate to measure win rate and time-to-kill'])
        : fail('BAD_INPUT', `${v.errors.length} problem(s): ${v.errors.slice(0, 3).map((e) => `${e.path} ${e.message}`).join('; ')}`, v.errors);
    }) });

  r.register({ name: 'boss3d.fairness', summary: 'Fairness gate for a boss: min telegraph vs human reaction, every attack avoidable under a dodge profile (distance, i-frames, cooldown), a safe zone for every simultaneous danger-zone combination, max simultaneous threats, and a perfect-reaction oracle bot sim. pass=false lists findings.',
    inputSchema: obj({ ...src, options: obj({ reactionMs: { type: 'number' }, moveSpeed: { type: 'number' }, margin: { type: 'number' }, maxThreats: { type: 'integer' }, oracleRuns: { type: 'integer', minimum: 1, maximum: 50 }, oracleDamageFrac: { type: 'number' }, simulate: { type: 'boolean' }, seed: { type: 'integer' },
      dodge: obj({ distance: { type: 'number' }, iframeMs: { type: 'number' }, cooldownMs: { type: 'number' }, jumpHeight: { type: 'number' } }) }) }), outputSchema: out,
    handler: wrap(async (i, def) => {
      const res = B.fairness(def, i.options || {});
      if (!res.ok) return fail('BAD_INPUT', 'boss definition is structurally invalid; run boss3d.validate', res.findings);
      return res.pass ? ok(res, ['boss3d.simulate to measure difficulty']) : { ok: false, data: res, error: { code: 'TASK_FAILED', message: `${res.errorCount} fairness error(s): ${res.findings.filter((f) => f.severity === 'error').slice(0, 3).map((f) => `${f.code} ${f.path}`).join('; ')}` }, next: ['fix the listed attacks (longer windup, smaller zone, add a gap) then re-run boss3d.fairness'] };
    }) });

  r.register({ name: 'boss3d.simulate', summary: 'Headless seeded fights: a bot with a skill profile fights the boss N times; reports win rate, time-to-kill (mean/median/p90), damage taken, per-phase seconds, attack hit counts and a determinism hash.',
    inputSchema: obj({ ...src, runs: { type: 'integer', minimum: 1, maximum: 500 }, seed: { type: 'integer' }, maxSeconds: { type: 'number', minimum: 5, maximum: 1200 }, profile: profileSchema, full: { type: 'boolean', description: 'include per-run results' } }), outputSchema: out,
    handler: wrap(async (i, def) => {
      const v = B.validateBoss(def); if (!v.ok) return fail('BAD_INPUT', 'boss definition is structurally invalid; run boss3d.validate', v.errors);
      const bad = i.profile && schemaValidate(profileSchema, i.profile); if (bad?.length) return fail('BAD_INPUT', bad.join('; '));
      const sim = B.simulate(def, { runs: i.runs ?? 20, seed: i.seed ?? 1, profile: i.profile || {}, maxSeconds: i.maxSeconds ?? 300 }); if (!i.full) delete sim.results;
      return ok(sim, sim.winRate === 0 ? ['win rate 0: check boss3d.fairness, or weaken the boss / strengthen the profile'] : ['boss3d.fairness to gate telegraphs and avoidability']);
    }) });
}
