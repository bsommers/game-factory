// img2model.* : character sheet (front + side view on a flat background) -> rigged GLB, headless in Blender (tools/img2model/*.py).
// silhouette: segment + report + debug PNGs. build: image -> glb/blend/skeleton json/texture/screens. verify: re-import and check a GLB.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ok, fail } from '../registry.mjs';
import { findBlender } from '../models/capabilities.mjs';
import { boneRole, GODOT_REQUIRED } from '../meshy/lib.mjs';

const FACT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TOOLS = join(FACT, 'tools/img2model');
const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const safeName = (s) => String(s).replace(/[^A-Za-z0-9_.-]/g, '_');

function runBlender(script, params, { blender, timeoutMs } = {}) {
  const exe = findBlender(blender);
  if (!exe) return Promise.resolve({ error: fail('NOT_FOUND', 'blender not found (set $BLENDER or pass blender)') });
  return new Promise((done) => execFile(exe, ['-b', '--factory-startup', '--python', join(TOOLS, script), '--', JSON.stringify(params)], { timeout: timeoutMs || 300000, maxBuffer: 64 * 1024 * 1024 }, (err, so, se) => {
    const line = String(so).split('\n').reverse().find((l) => l.startsWith('GF_JSON '));
    if (!line) return done({ error: fail('TASK_FAILED', `blender ${script} produced no result${err ? ': ' + err.message : ''}`, { stderr: String(se).slice(-1500), stdout: String(so).slice(-1500) }) });
    try { done({ result: JSON.parse(line.slice(8)) }); } catch (e) { done({ error: fail('TASK_FAILED', `bad result from ${script}: ${e.message}`) }); }
  }));
}

/** Parse the JSON chunk of a .glb: joints, node names, materials, images, attributes. Pure JS, no Blender. */
export function glbInfo(file) {
  const b = readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (bad magic)');
  const len = b.readUInt32LE(12), json = JSON.parse(b.slice(20, 20 + len).toString('utf8'));
  const skin = (json.skins || [])[0], joints = skin ? skin.joints.map((j) => json.nodes[j].name) : [];
  const prim = ((json.meshes || [])[0] || { primitives: [{}] }).primitives[0];
  return { json, joints, skins: (json.skins || []).length, images: (json.images || []).length, textures: (json.textures || []).length, attributes: Object.keys(prim.attributes || {}), nodes: (json.nodes || []).length };
}
/** Godot humanoid role coverage of the joints (same naming rules meshy.rig-map uses). */
export function roleCoverage(joints) {
  const byRole = {}; for (const n of joints) { const r = boneRole(n); if (r && !byRole[r]) byRole[r] = n; }
  const chain = joints.filter((n) => /^spine\d*$/i.test(n)); // Hips/Spine/Spine1/Spine2 resolve like meshy.rig-map's chain logic
  if (!byRole.Hips && joints.includes('Hips')) byRole.Hips = 'Hips';
  if (!byRole.Spine && chain.length) byRole.Spine = chain[0];
  return { mapped: Object.keys(byRole).length, missingRequired: GODOT_REQUIRED.filter((r) => !byRole[r]), tailBones: joints.filter((n) => /^Tail\d+$/.test(n)).length };
}

const imgIn = { image: { type: 'string', description: 'path to the character sheet (front view left, side view right, flat background). Read-only; may be outside the project' }, outDir: { type: 'string', description: 'output directory (created)' }, name: { type: 'string', description: 'file base name (default: image file name)' },
  splitX: { type: 'integer', minimum: 1, description: 'pixel column separating the front and side views (default: auto, widest empty gap in the middle)' }, threshold: { type: 'number', exclusiveMinimum: 0, description: 'colour distance from the background that counts as figure (default auto from border noise)' },
  heightMeters: { type: 'number', exclusiveMinimum: 0, maximum: 100, description: 'model height in metres (default 1.0)' }, blender: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 900000 }, project: { type: 'string' } };

function prep(i) {
  const image = resolve(i.project || '.', i.image);
  if (!existsSync(image) || !statSync(image).isFile()) return { err: fail('NOT_FOUND', `image not found: ${image}`) };
  const outDir = resolve(i.project || '.', i.outDir); mkdirSync(outDir, { recursive: true });
  const name = safeName(i.name || image.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'model').toLowerCase();
  return { image, outDir, name };
}

export function registerImg2model(r) {
  r.register({ name: 'img2model.silhouette', summary: 'Segment the front and side figures of a character sheet by background colour (largest components, text labels dropped, holes filled) and report bounds, split column and scale; writes mask and overlay debug PNGs. Needs Blender (bundled numpy).',
    inputSchema: obj({ ...imgIn, cleanRadius: { type: 'integer', minimum: 0, maximum: 20 }, closeRadius: { type: 'integer', minimum: 0, maximum: 20 } }, ['image', 'outDir']), outputSchema: out,
    handler: async (i) => {
      const p = prep(i); if (p.err) return p.err;
      const { error, result } = await runBlender('silhouette.py', { ...i, ...p, heightMeters: i.heightMeters || 1 }, i); if (error) return error;
      const rep = result.report;
      return ok({ ...rep }, [`bin/factory call img2model.build '${JSON.stringify({ image: i.image, outDir: i.outDir })}'`, ...(rep.warnings.length ? rep.warnings : [])]);
    } });

  r.register({ name: 'img2model.build', summary: 'Character sheet (front + side view) -> rigged GLB: silhouettes, visual-hull body (lofted super-ellipse slices, tail swept from the side view, optional thin cape sheet), decimated mesh, inferred Mixamo/Meshy-named skeleton with a tail chain, automatic weights (distance fallback), projected texture, .blend, skeleton JSON and preview renders. Needs Blender.',
    inputSchema: obj({ ...imgIn, triangleBudget: { type: 'integer', minimum: 500, maximum: 200000, description: 'target triangles (default 10000)' }, detail: { type: 'integer', minimum: 48, maximum: 256, description: 'voxels along the height for the carve (default 128)' },
      tailBones: { type: 'integer', minimum: 1, maximum: 16, description: 'default 6' }, separateCape: { type: 'boolean', description: 'detect a saturated cape/cloak by colour and model it as a thin sheet (default true)' }, render: { type: 'boolean', description: 'write front/side/three-quarter/back and skeleton PNGs (default true)' },
      smooth: { type: 'number', minimum: 0, maximum: 4, description: 'gaussian sigma in voxels (default 1.1)' }, forceDistanceWeights: { type: 'boolean' }, overwrite: { type: 'boolean' } }, ['image', 'outDir']), outputSchema: out,
    handler: async (i) => {
      const p = prep(i); if (p.err) return p.err;
      const glb = join(p.outDir, `${p.name}.glb`);
      if (existsSync(glb) && !i.overwrite) return fail('EXISTS', `${glb} exists (pass overwrite:true)`);
      const { error, result } = await runBlender('build.py', { ...i, ...p, heightMeters: i.heightMeters || 1, triangleBudget: i.triangleBudget || 10000, detail: i.detail || 128 }, i); if (error) return error;
      const rep = result.report, info = glbInfo(rep.files.glb), cov = roleCoverage(info.joints);
      const poseOk = rep.poseTest.every((t) => t.ok);
      const data = { ...rep, glb: { joints: info.joints.length, images: info.images, attributes: info.attributes, humanoidRoles: cov } };
      if (!poseOk) return fail('TASK_FAILED', 'pose test failed: rotating a bone did not move the mesh', data);
      return ok(data, [`bin/factory call img2model.verify '${JSON.stringify({ glb: rep.files.glb })}'`, 'bin/factory call meshy.rig-map with a=<glb> to get the Godot BoneMap', ...rep.notes]);
    } });

  r.register({ name: 'img2model.verify', summary: 'Re-import a rigged GLB in Blender and check triangle count, bounds, joints, that every vertex is weighted with weights summing to 1 (max 4 influences), texture/UV presence, and a pose test (rotating arm/leg/tail/head bones moves vertices). Fails with TASK_FAILED listing failed checks.',
    inputSchema: obj({ glb: { type: 'string' }, maxTriangles: { type: 'integer', minimum: 1 }, minJoints: { type: 'integer', minimum: 1, description: 'default 10' }, blender: { type: 'string' }, timeoutMs: { type: 'integer', minimum: 1000, maximum: 900000 }, project: { type: 'string' } }, ['glb']), outputSchema: out,
    handler: async (i) => {
      const glb = resolve(i.project || '.', i.glb);
      if (!existsSync(glb)) return fail('NOT_FOUND', `glb not found: ${glb}`);
      let info; try { info = glbInfo(glb); } catch (e) { return fail('BAD_INPUT', e.message); }
      const { error, result } = await runBlender('verify.py', { glb }, i); if (error) return error;
      const v = result.report, checks = [];
      const add = (name, pass, detail) => checks.push({ name, pass, detail });
      add('has-mesh-and-armature', v.meshes >= 1 && v.armatures >= 1, `${v.meshes} mesh(es), ${v.armatures} armature(s)`);
      add('triangles', v.triangles > 0 && (!i.maxTriangles || v.triangles <= i.maxTriangles), `${v.triangles} (max ${i.maxTriangles ?? 'any'})`);
      add('joints', v.joints >= (i.minJoints || 10), `${v.joints} joints`);
      add('skin-in-glb', info.skins === 1 && info.attributes.includes('JOINTS_0') && info.attributes.includes('WEIGHTS_0'), `skins ${info.skins}, attributes ${info.attributes.join(',')}`);
      add('every-vertex-weighted', v.unweightedVertices === 0, `${v.unweightedVertices} unweighted`);
      add('weights-normalised', v.maxWeightSumError < 1e-2, `max |sum-1| ${v.maxWeightSumError.toExponential(2)}`);
      add('max-4-influences', v.maxInfluences <= 4, `${v.maxInfluences}`);
      add('pose-test', v.poseTest.length > 0 && v.poseTest.every((t) => t.ok), v.poseTest.map((t) => `${t.bone}:${t.movedVerts}v/${(t.maxDisplacement * 100).toFixed(1)}cm`).join(' '));
      add('textured', v.hasMaterialTexture && v.hasUV, `texture ${v.hasMaterialTexture}, uv ${v.hasUV}`);
      const bad = checks.filter((c) => !c.pass), cov = roleCoverage(info.joints);
      const data = { ok: bad.length === 0, checks, report: v, humanoidRoles: cov, joints: info.joints };
      return bad.length ? fail('TASK_FAILED', `verify failed: ${bad.map((c) => c.name).join(', ')}`, data) : ok(data, cov.missingRequired.length ? [`Godot humanoid roles missing: ${cov.missingRequired.join(', ')}`] : ['rig maps onto the Godot humanoid profile; meshy.rig-map can emit the BoneMap']);
    } });
}
