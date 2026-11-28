// Level capabilities: level3d.validate, level3d.bake, nav.bake. Library: templates/web-project/src/lib/level3d.js. Spec: spec/v4/level3d.md.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ok, fail } from '../registry.mjs';
import * as LV from '../../templates/web-project/src/lib/level3d.js';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const strs = { type: 'array', items: { type: 'string' } };
const src = {
  level: { type: 'object', description: 'level JSON (spec/v4/level3d.md)' }, file: { type: 'string', description: 'path to a level .json (relative to project)' }, project: { type: 'string', description: 'project dir (default .)' },
  locomotion: { type: 'object', description: 'locomotion3d config; body.stepHeight/slopeLimitDeg/radius/height drive the nav bake (overrides level.locomotion)' },
  refs: { type: 'object', additionalProperties: false, description: 'known ids to resolve references against; only the lists you pass are enforced', properties: { ai: strs, boss: strs, hazards: strs, assets: strs } },
  checkAssets: { type: 'boolean', description: 'resolve glb piece assets as files under the project dir' },
};
const wrap = (fn) => async (i) => { try { return await fn(i); } catch (e) { return e.code === 'BAD_INPUT' && e.details ? fail('BAD_INPUT', e.message, e.details) : fail(['NOT_FOUND', 'BAD_INPUT', 'EXISTS'].includes(e.code) ? e.code : 'FAILED', e.message); } };
const bad = (m, code = 'BAD_INPUT') => Object.assign(new Error(m), { code });
const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

function load(i) {
  const n = ['level', 'file'].filter((k) => i[k] !== undefined).length; if (n !== 1) throw bad('pass exactly one of level, file');
  if (i.level) return i.level;
  const abs = resolve(i.project || '.', i.file);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw bad(`file not found: ${abs}`, 'NOT_FOUND');
  try { return JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { throw bad(`${i.file}: invalid JSON (${e.message})`); }
}
function opts(i, level) {
  const o = { locomotion: i.locomotion, refs: i.refs ? { ...i.refs } : undefined };
  if (i.checkAssets) { const root = resolve(i.project || '.'); o.refs = { ...(o.refs || {}), assets: (level.pieces || []).filter((p) => p?.type === 'glb' && typeof p.asset === 'string' && existsSync(resolve(root, p.asset))).map((p) => p.asset) }; }
  return o;
}
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '_');
function writeOut(i, level, files) {
  const project = resolve(i.project || '.'), dir = resolve(project, i.out || 'assets/levels/baked');
  if (!inside(project, dir)) throw bad(`out must be inside the project dir (${project})`);
  const targets = files.map(([name]) => join(dir, `${slug(level.id)}.${name}`));
  if (!i.overwrite) for (const t of targets) if (existsSync(t)) throw bad(`${relative(project, t).split(sep).join('/')} exists (pass overwrite:true)`, 'EXISTS');
  mkdirSync(dir, { recursive: true });
  return files.map(([, data], k) => { writeFileSync(targets[k], data); return relative(project, targets[k]).split(sep).join('/'); });
}
const summary = (r) => ({ errors: r.errors, warnings: r.warnings, report: r.report });
const failed = (r, what) => ({ ok: false, data: summary(r), error: { code: 'BAD_INPUT', message: `${r.errors.length} problem(s) in the level; ${what}`, details: r.errors }, next: ['fix the listed paths, then re-run level3d.validate'] });

export function registerLevel3d(r) {
  const write = { out: { type: 'string', description: 'directory inside the project (default assets/levels/baked)' }, overwrite: { type: 'boolean' } };
  r.register({ name: 'level3d.validate', summary: 'Validate a 3D level JSON: structure and references (spawns, triggers, hazards, checkpoints, arena), spawns standing on ground, every spawn/pickup/checkpoint reachable from a player spawn over the baked nav grid, boss arena bounds closed (except listed gates). Returns errors/warnings with JSON paths plus the deterministic bake hash.',
    inputSchema: obj({ ...src, deep: { type: 'boolean', description: 'false: structure and references only (skip bake, ground, reachability, closure)' } }), outputSchema: out,
    handler: wrap(async (i) => {
      const level = load(i), res = LV.validate(level, { ...opts(i, level), deep: i.deep });
      if (res.errors.length) return failed(res, 'nothing was baked');
      return ok(summary(res), [i.deep === false ? 'level3d.validate without deep:false for ground/reachability/closure' : 'level3d.bake {file, out} to write the collision BVH + nav for the runtime', 'godot-action3d/scripts/level/level_loader.gd loads the same JSON']);
    }) });
  r.register({ name: 'level3d.bake', summary: 'Bake a level JSON into runtime artifacts under out/ (default assets/levels/baked): <id>.collision.bvh (serialized triangle BVH, spec/v3/bvh.md), <id>.nav.json (walkable-grid nav, ai3d NavProvider) and <id>.bake.json (hash, stats, reachability). Refuses invalid levels; output is byte-identical for the same input.',
    inputSchema: obj({ ...src, ...write }), outputSchema: out,
    handler: wrap(async (i) => {
      const level = load(i), res = LV.validate(level, opts(i, level)); if (res.errors.length) return failed(res, 'nothing was written');
      const b = res.baked, report = { id: level.id, hash: b.hash, ...res.report.stats ? { stats: res.report.stats } : {}, body: b.body, reachability: res.report.reachability, arena: res.report.arena, warnings: res.warnings };
      const files = writeOut(i, level, [['collision.bvh', new Uint8Array(b.bvhBuffer)], ['nav.json', JSON.stringify(b.navData) + '\n'], ['bake.json', JSON.stringify(report, null, 2) + '\n']]);
      return ok({ hash: b.hash, stats: res.report.stats, files, warnings: res.warnings }, [`load ${files[1]} with navFromJSON (src/lib/level3d.js) as an ai3d world.nav`, 'same hash on every machine: compare it in CI']);
    }) });
  r.register({ name: 'nav.bake', summary: 'Bake only the navigation grid of a level JSON (slope/step/radius/height from the level or a locomotion3d config) to <id>.nav.json; an ai3d NavProvider (findPath/isClear/walkable) can be rebuilt from it with navFromJSON. Reports node/edge counts and reachability from player spawns.',
    inputSchema: obj({ ...src, ...write }), outputSchema: out,
    handler: wrap(async (i) => {
      const level = load(i), res = LV.validate(level, opts(i, level)); if (res.errors.length) return failed(res, 'nothing was written');
      const [file] = writeOut(i, level, [['nav.json', JSON.stringify(res.baked.navData) + '\n']]);
      return ok({ file, nodes: res.report.stats.navNodes, edges: res.report.stats.navEdges, cellSize: res.baked.navData.cellSize, body: res.baked.body, reachability: res.report.reachability, warnings: res.warnings }, ['ai3d world.nav = navFromJSON(JSON.parse(file))']);
    }) });
}
