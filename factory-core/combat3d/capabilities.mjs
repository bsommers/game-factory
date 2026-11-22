// combat3d capabilities: combat3d.validate (schema + semantic) and combat3d.simulate (scripted duel, frame-data table).
// Library: templates/web-project/src/lib/combat3d.js. Schema: spec/v4/schemas/combat3d.schema.json.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok, fail } from '../registry.mjs';
import { validate as schemaValidate } from '../schema.mjs';
import * as C from '../../templates/web-project/src/lib/combat3d.js';

const SCHEMA_PATH = fileURLToPath(new URL('../../spec/v4/schemas/combat3d.schema.json', import.meta.url));
const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const pj = (i) => resolve(i.project || '.');
const fighterItem = { anyOf: [{ type: 'string' }, { type: 'object' }] };

let schemaCache;
// The bundled validator has no $ref; inline local "#/$defs/..." references once.
function schema() {
  if (schemaCache) return schemaCache;
  const root = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const inl = (n) => {
    if (Array.isArray(n)) return n.map(inl);
    if (n && typeof n === 'object') {
      if (typeof n.$ref === 'string') return inl(root.$defs[n.$ref.replace('#/$defs/', '')]);
      const o = {}; for (const [k, v] of Object.entries(n)) if (k !== '$defs') o[k] = inl(v); return o;
    }
    return n;
  };
  return (schemaCache = inl(root));
}
const bad = (message, code = 'BAD_INPUT') => Object.assign(new Error(message), { code });
function readJSON(project, p, base) {
  const abs = resolve(base || project, p);
  if (!inside(project, abs)) throw bad(`${p}: path must be inside the project dir (${project})`);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw bad(`file not found: ${abs}`, 'NOT_FOUND');
  try { return { abs, json: JSON.parse(readFileSync(abs, 'utf8')) }; } catch (e) { throw bad(`${p}: invalid JSON (${e.message})`); }
}
const loadFighters = (project, list, base) => list.map((f, i) => typeof f === 'string' ? { src: f, def: readJSON(project, f, base).json } : { src: `fighters[${i}]`, def: f });
function check(def) {
  const errors = schemaValidate(schema(), def);
  const sem = errors.length ? { errors: [], warnings: [] } : C.validateFighter(def);
  return { id: def?.id ?? null, errors: [...errors, ...sem.errors], warnings: sem.warnings, moves: Object.keys(def?.moves || {}).length };
}
const wrap = (fn) => async (i) => {
  try { return await fn(i); } catch (e) { return fail(e.code === 'NOT_FOUND' || e.code === 'BAD_INPUT' ? e.code : 'FAILED', e.message); }
};

export function registerCombat3d(r) {
  r.register({ name: 'combat3d.validate', summary: 'Validate combat3d fighter definitions (moves, hitboxes, hurtboxes, block, statuses): JSON-schema shape plus semantic checks (frame ordering, windows inside the move, cancel targets exist, status ids known, reachability warnings).',
    inputSchema: obj({ input: { type: 'string', description: 'path to a fighter JSON file (relative to project)' }, fighters: { type: 'array', items: fighterItem, minItems: 1, description: 'fighter objects or paths' }, project: { type: 'string' } }),
    outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), list = [...(i.input ? [i.input] : []), ...(i.fighters || [])];
      if (!list.length) return fail('BAD_INPUT', 'pass input (a fighter JSON path) or fighters:[...]');
      const results = loadFighters(project, list).map(({ src, def }) => ({ src, ...check(def) }));
      const errors = results.flatMap((x) => x.errors.map((e) => `${x.src}: ${e}`));
      if (errors.length) return fail('BAD_INPUT', `${errors.length} problem(s) in combat3d definitions`, errors, ['fix the listed paths, then re-run combat3d.validate']);
      return ok({ valid: true, fighters: results }, ['combat3d.simulate {fighters:[...two...], script:{...}} to run a scripted duel and print frame data']);
    }) });

  r.register({ name: 'combat3d.simulate', summary: 'Run a scripted duel between two combat3d fighters on the deterministic frame-data sim: returns the event log (hit, block, parry, stagger, death, ...), damage totals, winner, an event-log hash, and a frame-data table per fighter.',
    inputSchema: obj({
      input: { type: 'string', description: 'duel JSON ({fighters:[path,path], script, frames, distance, seed}); fighter paths resolve next to it' },
      fighters: { type: 'array', items: fighterItem, minItems: 2, maxItems: 2, description: 'two fighter objects or paths (override input.fighters)' },
      script: { type: 'object', description: '{ <fighterId or A|B>: [{at, action} | {from, to, block:true}] } with 1-based world frames' },
      frames: { type: 'integer', minimum: 1, maximum: 36000 }, distance: { type: 'number', minimum: 0 }, seed: { type: 'integer', minimum: 0 },
      statuses: { type: 'object', description: 'extra/overriding status definitions {id: {...}}' },
      events: { type: 'integer', minimum: 0, maximum: 5000, description: 'max events to return (default 200; hash always covers all)' },
      project: { type: 'string' },
    }),
    outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i); let cfg = {}, base = project;
      if (i.input) { const f = readJSON(project, i.input); cfg = f.json; base = dirname(f.abs); }
      const list = i.fighters || cfg.fighters;
      if (!Array.isArray(list) || list.length !== 2) return fail('BAD_INPUT', 'need exactly two fighters (fighters:[a,b] or an input duel file)');
      const fs = loadFighters(project, list, i.fighters ? undefined : base), reports = fs.map(({ src, def }) => ({ src, ...check(def) }));
      const errors = reports.flatMap((x) => x.errors.map((e) => `${x.src}: ${e}`));
      if (errors.length) return fail('BAD_INPUT', 'fighter definitions are invalid; run combat3d.validate', errors);
      const run = C.simulateDuel(fs[0].def, fs[1].def, { script: i.script ?? cfg.script ?? {}, frames: i.frames ?? cfg.frames ?? 600, distance: i.distance ?? cfg.distance ?? 1.6, seed: i.seed ?? cfg.seed ?? 1, statuses: i.statuses ?? cfg.statuses ?? {} });
      const cap = i.events ?? 200, ev = run.world.events;
      const ids = run.world.fighters.map((f) => f.id);
      return ok({
        frames: run.frames, winner: run.winner, totals: run.totals, counts: run.counts, hash: run.hash,
        eventCount: ev.length, events: ev.slice(0, cap), eventsTruncated: ev.length > cap,
        frameData: Object.fromEntries(fs.map(({ def }, k) => [ids[k], C.frameDataTable(def)])),
        frameDataMarkdown: Object.fromEntries(fs.map(({ def }, k) => [ids[k], C.frameDataMarkdown(def)])),
        warnings: reports.flatMap((x) => x.warnings.map((w) => `${x.src}: ${w}`)),
      }, ['same inputs always give the same hash; use it as a regression gate', 'tune frame data with the onHit/onBlock columns (positive = attacker advantage)']);
    }) });
}
