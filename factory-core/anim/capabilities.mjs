// Animated model capabilities: anim.inspect / import / merge / sample for rigged, animated .glb files (Meshy, Blender, Mixamo exports).
// The library lives in templates/web-project/src/lib/gltf-anim.js (browser-safe); this file adds the filesystem and the registry surface.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ok, fail } from '../registry.mjs';
import * as A from '../../templates/web-project/src/lib/gltf-anim.js';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const inside = (root, p) => { const r = relative(root, p); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
const rel = (project, p) => (relative(project, p) || p).split(sep).join('/');
const pj = (i) => resolve(i.project || '.');
const slug = (s) => s.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'model';
const r4 = (v) => Math.round(v * 1e4) / 1e4;

function load(project, path) {
  const abs = resolve(project, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw Object.assign(new Error(`file not found: ${abs}`), { code: 'NOT_FOUND' });
  if (extname(abs).toLowerCase() !== '.glb') throw Object.assign(new Error(`${basename(abs)}: only .glb is supported (export "glTF Binary" from Blender/Meshy)`), { code: 'BAD_INPUT' });
  const data = new Uint8Array(readFileSync(abs));
  return { abs, data, model: A.parseAnimGLB(data) };
}
function report(model, abs, bytes) {
  const names = model.animations.map((a) => a.name), skin0 = model.skins[0];
  const tris = model.meshes.reduce((s, m) => s + m.primitives.reduce((t, p) => t + p.indices.length / 3, 0), 0), verts = model.meshes.reduce((s, m) => s + m.primitives.reduce((t, p) => t + p.positions.length / 3, 0), 0);
  const bind = A.posedBounds(model, null, 0), rnd = (b) => b && { min: b.min.map(r4), max: b.max.map(r4), size: b.size.map(r4) };
  return {
    file: abs && basename(abs), bytes, generator: model.asset.generator || null,
    nodes: model.nodes.length, meshes: model.meshes.length, vertices: verts, triangles: tris,
    skins: model.skins.map((s) => ({ name: s.name, joints: s.joints.length, jointNames: s.joints.map((j) => model.nodes[j].name) })),
    skinned: model.meshes.some((m) => m.primitives.some((p) => p.joints)),
    clips: model.animations.map((a) => ({ name: a.name, duration: r4(a.duration), channels: a.channels.length, paths: [...new Set(a.channels.map((c) => c.path))], interpolation: [...new Set(a.channels.map((c) => c.interp))] })),
    states: A.guessStates(names), bindBounds: rnd(bind),
    materials: model.materials.length, textures: model.textures.length, images: model.images.length,
    rigSignature: model.skins[0] ? model.skins[0].joints.map((j) => model.nodes[j].name).join('|') : null,
    warnings: model.warnings,
  };
}
const wrap = (fn) => async (i) => {
  try { return await fn(i); } catch (e) {
    const code = e.code === 'NOT_FOUND' ? 'NOT_FOUND' : e.code === 'UNSUPPORTED' ? 'UNSUPPORTED' : e.code === 'BAD_INPUT' || e.code === 'EXISTS' ? e.code : /not a GLB|GLB|accessor|JSON|glTF/.test(e.message) ? 'BAD_INPUT' : 'FAILED';
    return fail(code, e.message);
  }
};

export function registerAnim(r) {
  r.register({ name: 'anim.inspect', summary: 'Inspect a rigged/animated .glb (Meshy, Blender, Mixamo): skeleton joints, skinned meshes, animation clips with durations, guessed game states (idle/walk/run/...), bounds, materials, warnings. Reports compressed (Draco/meshopt) files as UNSUPPORTED with the fix.',
    inputSchema: obj({ input: { type: 'string', description: 'path to a .glb (relative to project)' }, project: { type: 'string' } }, ['input']), outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), { abs, data, model } = load(project, i.input), rep = report(model, abs, data.length);
      const next = []; if (!model.animations.length) next.push('this file has no animation clips; export with "Animation" enabled, or merge clips from another file with anim.merge');
      else next.push(`anim.import {inputs:["${i.input}"]} to add it to the game (assets/models + manifest)`);
      return ok(rep, next);
    }) });

  r.register({ name: 'anim.import', summary: 'Copy one or more animated .glb files into the project (assets/models/), inspect each, and write assets/models/manifest.json + models.js listing id, file, clips, guessed state map and rig groups. Files that share a rig are flagged so their clips can be combined with anim.merge.',
    inputSchema: obj({ inputs: { type: 'array', items: { type: 'string' }, minItems: 1, description: '.glb paths (relative to project or absolute)' }, out: { type: 'string', description: 'directory inside the project (default assets/models)' },
      ids: { type: 'object', additionalProperties: { type: 'string' }, description: 'optional {inputPath: id} overrides; default id = sanitised file name' }, overwrite: { type: 'boolean' }, project: { type: 'string' } }, ['inputs']), outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), dir = resolve(project, i.out || 'assets/models');
      if (!inside(project, dir)) return fail('BAD_INPUT', `out must be inside the project dir (${project})`);
      const loaded = i.inputs.map((p) => ({ p, ...load(project, p) })), seen = new Set(), entries = [];
      for (const m of loaded) {
        let id = i.ids?.[m.p] || slug(basename(m.abs)); if (seen.has(id)) return fail('BAD_INPUT', `two inputs map to id "${id}"; pass ids:{path:id}`); seen.add(id);
        const dest = join(dir, `${id}.glb`); if (existsSync(dest) && !i.overwrite && resolve(dest) !== m.abs) return fail('EXISTS', `${rel(project, dest)} exists (pass overwrite:true)`);
        entries.push({ id, dest, m });
      }
      mkdirSync(dir, { recursive: true });
      const mpath = join(dir, 'manifest.json'); let manifest = { version: 1, models: [] };
      if (existsSync(mpath)) { try { manifest = JSON.parse(readFileSync(mpath, 'utf8')); manifest.models ||= []; } catch { /* rewritten */ } }
      const results = [];
      for (const { id, dest, m } of entries) {
        if (resolve(dest) !== m.abs) copyFileSync(m.abs, dest);
        const rep = report(m.model, dest, m.data.length), e = { id, file: rel(dir, dest), bytes: rep.bytes, clips: rep.clips.map((c) => ({ name: c.name, duration: c.duration })), states: rep.states, skinned: rep.skinned, joints: rep.skins[0]?.joints ?? 0, triangles: rep.triangles, rig: rep.rigSignature ? hash(rep.rigSignature) : null };
        manifest.models = manifest.models.filter((x) => x.id !== id).concat(e); results.push({ ...e, path: rel(project, dest), warnings: rep.warnings });
      }
      manifest.models.sort((a, b) => a.id.localeCompare(b.id));
      writeFileSync(mpath, JSON.stringify(manifest, null, 2) + '\n');
      writeFileSync(join(dir, 'models.js'), `// generated by anim.import; do not edit. Load with fetch(new URL(entry.file, import.meta.url)) then parseAnimGLB (src/lib/gltf-anim.js).\nexport const manifest = ${JSON.stringify(manifest, null, 2)};\nexport const modelUrl = (id) => new URL(manifest.models.find((m) => m.id === id).file, import.meta.url).href;\n`);
      const groups = {}; for (const e of results) if (e.rig) (groups[e.rig] ||= []).push(e.id);
      const sameRig = Object.values(groups).filter((g) => g.length > 1);
      const next = ['in the game: import { parseAnimGLB, AnimPlayer } from "./lib/gltf-anim.js"; const model = parseAnimGLB(new Uint8Array(await (await fetch(url)).arrayBuffer())); const player = new AnimPlayer(model); player.setState("walk"); each frame player.update(dt); player.skinned() or player.jointMatrices()'];
      if (sameRig.length) next.unshift(`${sameRig.map((g) => g.join(' + ')).join('; ')} share a rig: combine their clips into one file with anim.merge {base, inputs:[...]}`);
      return ok({ dir: rel(project, dir), manifest: rel(project, mpath), models: results, sameRig }, next);
    }) });

  r.register({ name: 'anim.merge', summary: 'Combine animation clips from several .glb files that share a skeleton into one .glb (Meshy exports one clip per file). Channels are matched to the base rig by node name; clips whose bones do not exist are skipped and reported.',
    inputSchema: obj({ base: { type: 'string', description: '.glb providing mesh + skeleton (and its own clips)' }, inputs: { type: 'array', items: { type: 'string' }, minItems: 1, description: '.glb files whose clips are added' }, out: { type: 'string', description: 'output .glb path inside the project' },
      prefix: { type: 'string', description: 'prepended to every added clip name' }, rename: { type: 'object', additionalProperties: { type: 'string' }, description: '{clipName: newName} applied to added clips' }, onConflict: { type: 'string', enum: ['rename', 'skip'], description: 'clip name already present (default rename with _2 suffix)' }, overwrite: { type: 'boolean' }, project: { type: 'string' } }, ['base', 'inputs', 'out']), outputSchema: out,
    handler: wrap(async (i) => {
      const project = pj(i), dest = resolve(project, i.out);
      if (!inside(project, dest)) return fail('BAD_INPUT', `out must be inside the project dir (${project})`);
      if (extname(dest).toLowerCase() !== '.glb') return fail('BAD_INPUT', 'out must end in .glb');
      if (existsSync(dest) && !i.overwrite) return fail('EXISTS', `${rel(project, dest)} exists (pass overwrite:true)`);
      const base = load(project, i.base), srcs = i.inputs.map((p) => { const l = load(project, p); return { data: l.data, name: basename(l.abs), prefix: i.prefix, rename: i.rename }; });
      const res = A.mergeAnimGLB(base.data, srcs, { onConflict: i.onConflict });
      mkdirSync(join(dest, '..'), { recursive: true }); writeFileSync(dest, res.glb);
      const rep = report(A.parseAnimGLB(res.glb), dest, res.glb.length);
      return ok({ path: rel(project, dest), bytes: res.glb.length, added: res.added, skipped: res.skipped, warnings: [...res.warnings, ...rep.warnings], clips: rep.clips, states: rep.states }, [`anim.import {inputs:["${i.out}"]}`]);
    }) });

  r.register({ name: 'anim.sample', summary: 'Pose a .glb at a clip and time (no rendering): returns the posed bounding box and the world position of every joint, to verify an animation or script against it. time is seconds; loop wraps, otherwise clamps.',
    inputSchema: obj({ input: { type: 'string' }, clip: { type: 'string', description: 'clip name; omit for bind pose' }, time: { type: 'number', minimum: 0 }, loop: { type: 'boolean' }, project: { type: 'string' } }, ['input']), outputSchema: out,
    handler: wrap(async (i) => {
      const { model } = load(pj(i), i.input); let clip = null;
      if (i.clip) { clip = model.animations.find((a) => a.name === i.clip); if (!clip) return fail('NOT_FOUND', `no clip "${i.clip}" (have: ${model.animations.map((a) => a.name).join(', ') || 'none'})`); }
      const t = i.time ?? 0, pose = A.poseAt(model, clip, t, i.loop !== false), world = A.worldMatrices(model, pose), joints = {};
      for (const s of model.skins) for (const j of s.joints) joints[model.nodes[j].name] = [world[j][12], world[j][13], world[j][14]].map(r4);
      const b = A.posedBounds(model, clip, i.loop === false ? t : clip ? ((t % (clip.duration || 1)) + (clip.duration || 1)) % (clip.duration || 1) : 0);
      return ok({ clip: clip?.name ?? null, time: t, duration: clip?.duration ?? 0, bounds: b && { min: b.min.map(r4), max: b.max.map(r4), size: b.size.map(r4) }, joints });
    }) });
}
function hash(s) { let h = 2166136261; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }
