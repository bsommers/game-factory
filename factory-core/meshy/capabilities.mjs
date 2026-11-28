// meshy.* capabilities (offline): import / verify / split / rig-map for Meshy (and other Blender-style) rigged .glb files.
// No network, no API client. Library: ./lib.mjs on top of templates/web-project/src/lib/gltf-anim.js.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ok, fail } from '../registry.mjs';
import * as A from '../../templates/web-project/src/lib/gltf-anim.js';
import * as L from './lib.mjs';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const rel = (project, p) => (relative(project, p) || p).split(sep).join('/');
const pj = (i) => resolve(i.project || '.');
const slug = (s) => s.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const err = (code, message) => Object.assign(new Error(message), { code });

function load(project, path) {
  const abs = resolve(project, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw err('NOT_FOUND', `file not found: ${abs}`);
  if (extname(abs).toLowerCase() !== '.glb') throw err('BAD_INPUT', `${basename(abs)}: only .glb is supported`);
  const data = new Uint8Array(readFileSync(abs));
  return { abs, data };
}
const wrap = (fn) => async (i) => {
  try { return await fn(i); } catch (e) {
    const code = ['NOT_FOUND', 'UNSUPPORTED', 'BAD_INPUT', 'EXISTS'].includes(e.code) ? e.code : /not a GLB|GLB|accessor|JSON|glTF/.test(e.message) ? 'BAD_INPUT' : 'FAILED';
    return fail(code, e.message);
  }
};
const defaultId = (file) => { const m = basename(file).match(/^Meshy_AI_(.+?)_\d{8}/); return (m ? m[1] : slug(basename(file))).replace(/[^A-Za-z0-9_-]+/g, '_').toLowerCase(); };
const licenseFor = (plan) => plan === 'free' ? { id: 'CC-BY-4.0', attribution: 'Meshy AI', commercialOk: true, requiresAttribution: true } : ['pro', 'studio', 'enterprise'].includes(plan) ? { id: 'Meshy-paid', attribution: null, commercialOk: true, requiresAttribution: false } : { id: 'unknown', attribution: null, commercialOk: null, requiresAttribution: null };

export function registerMeshy(r) {
  r.register({ name: 'meshy.import', summary: 'Normalise and import a Meshy (or Blender-style) animated .glb into assets/models: detect units and bake centimetres to metres (no node scale left behind), check facing, tidy clip names ("Armature|walking_man|baselayer" -> "walking_man"), write the GLB and a manifest entry with provenance (plan, visibility, jobId stay "unknown" unless supplied). Deterministic: no timestamps unless createdAt is given.',
    inputSchema: obj({ input: { type: 'string', description: '.glb path (project-relative or absolute)' }, id: { type: 'string', description: 'model id (default derived from the file name)' }, out: { type: 'string', description: 'directory inside the project (default assets/models)' },
      units: { type: 'string', enum: ['auto', 'm', 'cm'], description: 'auto detects from bind height (default)' }, height: { type: 'number', exclusiveMinimum: 0, description: 'rescale to this height in metres (overrides units)' },
      clips: { type: 'object', additionalProperties: false, properties: { rename: { type: 'object', additionalProperties: { type: 'string' } }, prefix: { type: 'string' }, keep: { type: 'array', items: { type: 'string' } }, drop: { type: 'array', items: { type: 'string' } }, clean: { type: 'boolean', description: 'strip Armature| and |baselayer (default true)' }, case: { type: 'string', enum: ['keep', 'lower'] } } },
      provenance: { type: 'object', additionalProperties: false, properties: { plan: { type: 'string', enum: ['free', 'pro', 'studio', 'enterprise', 'unknown'] }, visibility: { type: 'string', enum: ['public', 'private', 'unknown'] }, jobId: { type: 'string' }, prompt: { type: 'string' }, aiModel: { type: 'string' }, createdAt: { type: 'string' } } },
      overwrite: { type: 'boolean' }, project: { type: 'string' } }, ['input']), outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), dir = resolve(project, i.out || 'assets/models');
      if (!inside(project, dir)) return fail('BAD_INPUT', `out must be inside the project dir (${project})`);
      const { abs, data } = load(project, i.input), id = i.id || defaultId(abs), dest = join(dir, `${id}.glb`);
      if (existsSync(dest) && !i.overwrite && resolve(dest) !== abs) return fail('EXISTS', `${rel(project, dest)} exists (pass overwrite:true)`);
      const model = A.parseAnimGLB(data), before = L.summarize(model, data.length), u = L.detectUnits(model), applied = [], warnings = [...model.warnings];
      let { json, bin } = A.splitGLB(data), changed = false, factor = 1;
      if (i.height) factor = i.height / (u.height || 1); else if (i.units === 'cm') factor = 0.01; else if (i.units === 'm') factor = 1; else factor = u.factor;
      if (u.units === 'unknown' && !i.height && (!i.units || i.units === 'auto')) warnings.push(`could not tell the units (bind height ${u.height}); pass units:"m"|"cm" or height`);
      if (u.units === 'cm' && u.confidence === 'low' && (!i.units || i.units === 'auto')) warnings.push(`height ${u.height} is outside 100-250: baked as centimetres anyway; pass units:"m" if that is wrong`);
      if (Math.abs(factor - 1) > 1e-9) { ({ json, bin } = L.bakeScale(json, bin, factor)); changed = true; applied.push(`scale x${L.r4(factor)} (${u.units === 'cm' || i.units === 'cm' ? 'cm to m' : 'height rescale'}) baked into vertices, bones, bind matrices and translation tracks`); }
      const plan = L.planClipNames((json.animations || []).map((a, k) => a.name || `clip${k}`), { rename: i.clips?.rename, prefix: i.clips?.prefix, clean: i.clips?.clean, case: i.clips?.case, armatureNames: model.roots.map((x) => model.nodes[x].name) });
      const keep = i.clips?.keep, drop = new Set(i.clips?.drop || []), renames = [];
      const kept = (json.animations || []).map((a, k) => ({ a, p: plan[k] })).filter(({ p }) => (!keep || keep.includes(p.from) || keep.includes(p.to)) && !drop.has(p.from) && !drop.has(p.to));
      if (kept.length !== (json.animations || []).length) { json.animations = kept.map((k) => k.a); changed = true; applied.push(`dropped ${plan.length - kept.length} clip(s)`); }
      for (const { a, p } of kept) if (a.name !== p.to) { renames.push({ from: a.name, to: p.to }); a.name = p.to; changed = true; }
      if (renames.length) applied.push(`renamed ${renames.length} clip(s)`);
      if (changed && kept.length !== plan.length) ({ json, bin } = L.compactGLB(json, bin));
      const bytes = changed ? A.joinGLB(json, bin) : data;
      mkdirSync(dir, { recursive: true });
      if (changed) writeFileSync(dest, bytes); else if (resolve(dest) !== abs) copyFileSync(abs, dest);
      const m2 = changed ? A.parseAnimGLB(bytes) : model, after = L.summarize(m2, bytes.length), face = L.detectFacing(m2, after.height);
      if (face.axis !== '+Z' && face.axis !== 'unknown') warnings.push(`character faces ${face.axis}, not +Z; rotate it in the engine (not baked)`);
      if (!after.states.idle) warnings.push('no idle-like clip; add one (anim.merge) or map a state');
      const prov = i.provenance || {}, plan_ = prov.plan || 'unknown';
      const entry = { id, file: `${id}.glb`, bytes: bytes.length, sha256: sha(bytes), clips: after.clips, states: after.states, skinned: after.joints > 0, joints: after.joints, triangles: after.triangles, rig: after.rigSignature ? L.hashStr(after.rigSignature) : null,
        units: 'm', height: after.height, facing: face.axis,
        provenance: { source: 'meshy', plan: plan_, visibility: prov.visibility || 'unknown', jobId: prov.jobId || 'unknown', sourceFile: basename(abs), sourceSha256: sha(data), ...(prov.prompt ? { prompt: prov.prompt } : {}), ...(prov.aiModel ? { aiModel: prov.aiModel } : {}), ...(prov.createdAt ? { createdAt: prov.createdAt } : {}) },
        license: licenseFor(plan_), import: { unitsDetected: u.units, scale: L.r4(factor), clipRenames: renames } };
      const mpath = join(dir, 'manifest.json'); let manifest = { version: 1, models: [] };
      if (existsSync(mpath)) { try { manifest = JSON.parse(readFileSync(mpath, 'utf8')); manifest.models ||= []; } catch { /* rewritten */ } }
      manifest.models = manifest.models.filter((x) => x.id !== id).concat(entry).sort((a, b) => a.id.localeCompare(b.id));
      writeFileSync(mpath, JSON.stringify(manifest, null, 2) + '\n');
      writeFileSync(join(dir, 'models.js'), `// generated by anim.import / meshy.import; do not edit. Load with fetch(new URL(entry.file, import.meta.url)) then parseAnimGLB (src/lib/gltf-anim.js).\nexport const manifest = ${JSON.stringify(manifest, null, 2)};\nexport const modelUrl = (id) => new URL(manifest.models.find((m) => m.id === id).file, import.meta.url).href;\n`);
      const next = [`meshy.verify {input:"${rel(project, dest)}"}`];
      if (!after.states.idle) next.push('no idle clip: merge or alias one before relying on state playback');
      return ok({ id, path: rel(project, dest), manifest: rel(project, mpath), applied, unitsDetected: u, facing: face, before: { bytes: before.bytes, height: before.height, clips: before.clips.map((c) => c.name) }, after: { bytes: after.bytes, height: after.height, clips: after.clips.map((c) => c.name), states: after.states }, entry, warnings }, next);
    }) });

  r.register({ name: 'meshy.verify', summary: 'Check an animated .glb is game-ready: uncompressed, skin and joint count, weights, bind height (catches cm), facing, clips and a missing idle, per-clip root drift, scale tracks, pose stability, size budget, textures. Returns pass/warn/fail/info checks; pass is false when any check fails.',
    inputSchema: obj({ input: { type: 'string' }, budget: { type: 'object', additionalProperties: false, properties: { maxBytes: { type: 'number' }, maxTriangles: { type: 'number' }, maxJoints: { type: 'number' } }, description: 'limits; exceeding an explicit limit fails, a default limit only warns' },
      expect: { type: 'object', additionalProperties: false, properties: { clips: { type: 'array', items: { type: 'string' } }, heightRange: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, facing: { type: 'string', enum: ['+Z', '-Z', '+X', '-X'] } } }, project: { type: 'string' } }, ['input']), outputSchema: out,
    handler: wrap(async (i) => {
      const { abs, data } = load(pj(i), i.input), res = L.verifyModel(data, { budget: i.budget, expect: i.expect });
      const next = []; for (const c of res.checks.filter((x) => x.status === 'fail')) next.push(`fix: ${c.id}: ${c.detail}`);
      if (res.checks.some((c) => c.id === 'height' && c.units === 'cm')) next.push(`meshy.import {input:"${i.input}", units:"cm"}`);
      return ok({ file: basename(abs), ...res }, next);
    }) });

  r.register({ name: 'meshy.split', summary: 'Split or trim a merged clip by time ranges into new named clips, written to a new .glb (boundary keys are interpolated, times restart at 0). The source clip is replaced unless keepOriginal; other clips are kept unless only:true. Unused data is compacted away.',
    inputSchema: obj({ input: { type: 'string' }, out: { type: 'string', description: 'output .glb path inside the project' }, clip: { type: 'string', description: 'source clip (default: the only clip)' },
      ranges: { type: 'array', minItems: 1, items: obj({ name: { type: 'string', minLength: 1 }, start: { type: 'number', minimum: 0 }, end: { type: 'number', minimum: 0 } }, ['name', 'start', 'end']) },
      unit: { type: 'string', enum: ['seconds', 'frames'], description: 'unit of start/end (default seconds)' }, fps: { type: 'number', exclusiveMinimum: 0, description: 'frames per second when unit is frames (default 30)' },
      keepOriginal: { type: 'boolean' }, only: { type: 'boolean', description: 'write only the new clips' }, overwrite: { type: 'boolean' }, project: { type: 'string' } }, ['input', 'out', 'ranges']), outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), dest = resolve(project, i.out);
      if (!inside(project, dest)) return fail('BAD_INPUT', `out must be inside the project dir (${project})`);
      if (extname(dest).toLowerCase() !== '.glb') return fail('BAD_INPUT', 'out must end in .glb');
      if (existsSync(dest) && !i.overwrite) return fail('EXISTS', `${rel(project, dest)} exists (pass overwrite:true)`);
      const { data } = load(project, i.input), model = A.parseAnimGLB(data);
      const src = i.clip ? model.animations.find((a) => a.name === i.clip) : model.animations.length === 1 ? model.animations[0] : null;
      if (!src) return fail(i.clip ? 'NOT_FOUND' : 'BAD_INPUT', i.clip ? `no clip "${i.clip}" (have: ${model.animations.map((a) => a.name).join(', ')})` : `pass clip (have: ${model.animations.map((a) => a.name).join(', ') || 'none'})`);
      const div = i.unit === 'frames' ? (i.fps || 30) : 1, warnings = [], names = new Set(model.animations.filter((a) => a !== src || i.keepOriginal).map((a) => a.name));
      const ranges = i.ranges.map((g) => ({ name: g.name, start: g.start / div, end: g.end / div }));
      for (const g of ranges) {
        if (names.has(g.name)) return fail('BAD_INPUT', `clip name "${g.name}" already exists`); names.add(g.name);
        if (!(g.end > g.start)) return fail('BAD_INPUT', `range "${g.name}": end must be greater than start`);
        if (g.start >= src.duration) return fail('BAD_INPUT', `range "${g.name}": start ${g.start}s is past the clip end (${L.r4(src.duration)}s)`);
        if (g.end > src.duration + 1e-6) { warnings.push(`range "${g.name}": end clamped from ${g.end}s to ${L.r4(src.duration)}s`); g.end = src.duration; }
      }
      const { json, bin } = A.splitGLB(data), app = new L.GlbAppender(json, bin), srcIdx = model.animations.indexOf(src);
      const old = app.json.animations.slice(); app.json.animations = [];
      const added = [];
      for (const g of ranges) { const ch = L.sliceChannels(src, g.start, g.end); if (!ch.length) { warnings.push(`range "${g.name}": no channels`); continue; } app.addAnimation(g.name, ch); added.push({ name: g.name, start: L.r4(g.start), end: L.r4(g.end), duration: L.r4(g.end - g.start), channels: ch.length }); }
      const fresh = app.json.animations; app.json.animations = [...old.filter((a, k) => !i.only && (k !== srcIdx || i.keepOriginal)), ...fresh];
      const fin = app.finish(), comp = L.compactGLB(fin.json, fin.bin), bytes = A.joinGLB(comp.json, comp.bin);
      mkdirSync(join(dest, '..'), { recursive: true }); writeFileSync(dest, bytes);
      const res = A.parseAnimGLB(bytes), sum = L.summarize(res, bytes.length);
      return ok({ path: rel(project, dest), bytes: bytes.length, source: src.name, added, clips: sum.clips, states: sum.states, warnings: [...warnings, ...res.warnings] }, [`meshy.verify {input:"${i.out}"}`, `meshy.import {input:"${i.out}"}`]);
    }) });

  r.register({ name: 'meshy.rig-map', summary: 'Compare two skeletons (rigSignature) and suggest a bone mapping a->b by exact name, humanoid role (Rigify, Mixamo, UE/Unity names) and hierarchy position, listing bones only in one rig (e.g. Bone_0NN extras) and the rest-pose delta. Also emits a Godot SkeletonProfileHumanoid BoneMap JSON for input a (or only that, when b is omitted).',
    inputSchema: obj({ a: { type: 'string', description: 'first .glb' }, b: { type: 'string', description: 'second .glb to compare against (optional)' }, out: { type: 'string', description: 'write the Godot bone map JSON here (inside the project)' }, overwrite: { type: 'boolean' }, project: { type: 'string' } }, ['a']), outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), ma = A.parseAnimGLB(load(project, i.a).data); if (!ma.skins[0]) return fail('BAD_INPUT', `${i.a} has no skin`);
      const roles = L.humanoidRoles(ma), godot = L.godotBoneMap(roles), data = { a: { file: i.a, joints: ma.skins[0].joints.length, rigHash: L.hashStr(ma.skins[0].joints.map((j) => ma.nodes[j].name).join('|')) }, godotBoneMap: godot };
      const next = [];
      if (i.b) { const mb = A.parseAnimGLB(load(project, i.b).data), c = L.compareRigs(ma, mb); data.b = { file: i.b, joints: c.jointsB }; Object.assign(data, { identicalSignature: c.identicalSignature, sameJointSet: c.sameJointSet, mapping: c.mapping, byVia: c.byVia, onlyInA: c.onlyInA, onlyInB: c.onlyInB, restPoseMaxDelta: c.restPoseMaxDelta });
        next.push(c.identicalSignature ? 'identical skeletons: anim.merge can combine their clips directly' : c.sameJointSet ? 'same bone names in a different order: anim.merge matches by name, so it works' : `${c.onlyInA.length} bone(s) only in a, ${c.onlyInB.length} only in b: anim.merge drops channels for missing bones`); }
      if (godot.missingRequired.length) next.push(`Godot BoneMap lacks required bones: ${godot.missingRequired.join(', ')}`);
      if (i.out) { const dest = resolve(project, i.out); if (!inside(project, dest)) return fail('BAD_INPUT', `out must be inside the project dir (${project})`); if (existsSync(dest) && !i.overwrite) return fail('EXISTS', `${rel(project, dest)} exists (pass overwrite:true)`); mkdirSync(join(dest, '..'), { recursive: true }); writeFileSync(dest, JSON.stringify(godot, null, 2) + '\n'); data.boneMapPath = rel(project, dest); }
      return ok(data, next);
    }) });
}
