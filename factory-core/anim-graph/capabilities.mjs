// animgraph.validate / animgraph.simulate. Library: templates/web-project/src/lib/anim-graph.js (pure, deterministic). Spec: spec/v4/anim-graph.md.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { ok, fail } from '../registry.mjs';
import { validate as schemaValidate } from '../schema.mjs';
import * as A from '../../templates/web-project/src/lib/gltf-anim.js';
import * as G from '../../templates/web-project/src/lib/anim-graph.js';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const SCHEMA = JSON.parse(readFileSync(new URL('../../spec/v4/schemas/anim-graph.schema.json', import.meta.url), 'utf8'));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const bad = (m) => Object.assign(new Error(m), { code: 'BAD_INPUT' });

function readJSON(project, p) {
  const abs = resolve(project, p);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw Object.assign(new Error(`file not found: ${abs}`), { code: 'NOT_FOUND' });
  try { return JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { throw bad(`${p}: invalid JSON (${e.message})`); }
}
function loadInputs(i) {
  const project = resolve(i.project || '.');
  const graph = i.graph ?? (i.graphPath ? readJSON(project, i.graphPath) : null); if (!graph) throw bad('pass graph (object) or graphPath');
  let model = null;
  if (i.glb) {
    const abs = resolve(project, i.glb);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw Object.assign(new Error(`file not found: ${abs}`), { code: 'NOT_FOUND' });
    model = A.parseAnimGLB(new Uint8Array(readFileSync(abs)));
  }
  return { graph, model };
}
function check(graph, model, extra) {
  const schemaErrors = schemaValidate(SCHEMA, graph);
  const ctx = model ? { clips: model.animations.map((a) => a.name), bones: model.nodes.map((n) => n.name) } : { clips: extra ? Object.keys(extra) : undefined };
  const sem = schemaErrors.length ? { errors: [], warnings: [], clips: [] } : G.validateGraph(graph, ctx);
  return { schemaErrors, ...sem };
}
const wrap = (fn) => async (i) => {
  try { return await fn(i); } catch (e) { return fail(e.code === 'NOT_FOUND' ? 'NOT_FOUND' : e.code === 'UNSUPPORTED' ? 'UNSUPPORTED' : e.code === 'BAD_INPUT' ? 'BAD_INPUT' : /GLB|glTF|accessor/.test(e.message) ? 'BAD_INPUT' : 'FAILED', e.message); }
};
const inputProps = { graph: { type: 'object', description: 'anim-graph JSON (inline)' }, graphPath: { type: 'string', description: 'path to an anim-graph .json (relative to project)' }, glb: { type: 'string', description: 'animated .glb whose clips and bones the graph must reference' }, project: { type: 'string' } };

export function registerAnimGraph(r) {
  r.register({ name: 'animgraph.validate', summary: 'Validate an animation-graph JSON (states, blend spaces, transitions, layers, masks, root motion, events) against spec/v4/schemas/anim-graph.schema.json plus semantic checks; with glb, every referenced clip, mask bone and root bone must exist in that model. Returns {valid, schemaErrors, errors, warnings, clips}.',
    inputSchema: obj(inputProps), outputSchema: out,
    handler: wrap(async (i) => {
      const { graph, model } = loadInputs(i), c = check(graph, model), valid = !c.schemaErrors.length && !c.errors.length;
      const next = valid ? ['animgraph.simulate {graph|graphPath, glb?, duration, script:[{at, set:{speed:3}, trigger:["attack"]}]} to preview the state/event timeline'] : ['fix the listed errors and re-run animgraph.validate'];
      if (valid && !model) next.push('pass glb to also check that clips and bones exist in the model');
      return ok({ valid, schemaErrors: c.schemaErrors, errors: c.errors, warnings: c.warnings, clips: c.clips, checkedAgainstModel: !!model }, next);
    }) });

  r.register({ name: 'animgraph.simulate', summary: 'Run an animation graph headlessly at the fixed 1/60 step with scripted parameters and return a deterministic timeline: transitions, animation events (hit_start, footstep, i_frame_on, ...), periodic state samples and total root motion. Clip lengths come from glb, or from clips {name: seconds}.',
    inputSchema: obj({ ...inputProps, clips: { type: 'object', additionalProperties: { type: 'number', minimum: 0 }, description: 'clip durations in seconds when no glb is given' },
      duration: { type: 'number', minimum: 1 / 60, maximum: 600, description: 'seconds to simulate (default 3)' },
      script: { type: 'array', description: 'scripted inputs applied at the start of the frame nearest `at` seconds', items: obj({ at: { type: 'number', minimum: 0 }, set: { type: 'object', description: '{param: value}' }, trigger: { type: 'array', items: { type: 'string' } } }, ['at']) },
      sampleEvery: { type: 'number', minimum: 1 / 60, description: 'seconds between state samples (default 0.25)' } }), outputSchema: out,
    handler: wrap(async (i) => {
      const { graph, model } = loadInputs(i);
      if (!model && !i.clips) throw bad('pass glb or clips {name: seconds} so clip lengths are known');
      const c = check(graph, model, i.clips); if (c.schemaErrors.length || c.errors.length) return fail('BAD_INPUT', 'graph is invalid; run animgraph.validate', { schemaErrors: c.schemaErrors, errors: c.errors });
      const clips = model ? new G.AnimGraphPlayer(model, graph).clipInfo : Object.fromEntries(Object.entries(i.clips).map(([k, d]) => [k, { duration: d }]));
      const rt = new G.AnimGraph(graph, clips), frames = Math.round((i.duration ?? 3) * 60), every = Math.max(1, Math.round((i.sampleEvery ?? 0.25) * 60));
      const script = (i.script || []).map((s) => ({ ...s, f: Math.round(s.at * 60) })).sort((a, b) => a.f - b.f);
      const timeline = [], samples = [], total = { x: 0, y: 0, z: 0, yaw: 0 }; let si = 0;
      const sample = (f) => samples.push({ t: r6(f / 60), states: Object.fromEntries(rt.layers.map((L, k) => [L.def.name, rt.state(k)])), phase: Object.fromEntries(rt.layers.map((L, k) => [L.def.name, r6(rt.phase(k))])), params: { ...rt.params } });
      for (let f = 0; f < frames; f++) {
        while (si < script.length && script[si].f <= f) { for (const [k, v] of Object.entries(script[si].set || {})) rt.setParam(k, v); for (const t of script[si].trigger || []) rt.setTrigger(t); si++; }
        if (f % every === 0) sample(f);
        const r = rt.step(), t = r6((f + 1) / 60);
        for (const x of r.transitions) timeline.push({ t, kind: 'transition', ...x });
        for (const e of r.events) timeline.push({ t, kind: 'event', name: e.name, layer: e.layer, state: e.state, ...(e.data !== undefined ? { data: e.data } : {}) });
        for (const k of Object.keys(total)) total[k] += r.rootMotion[k];
      }
      return ok({ frames, dt: 1 / 60, timeline, samples, rootMotion: Object.fromEntries(Object.entries(total).map(([k, v]) => [k, r6(v)])), final: rt.snapshot(), warnings: c.warnings }, ['compare the timeline against the combat frame data; events fire on the step in which the playhead crosses them']);
    }) });
}
