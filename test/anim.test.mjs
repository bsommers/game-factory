import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';
import * as A from '../templates/web-project/src/lib/gltf-anim.js';
import { buildRigGLB } from './helpers/anim-glb.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fanim-'));
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const close = (a, b, m, e = 1e-5) => assert.ok(Math.abs(a - b) < e, `${m}: ${a} vs ${b}`);

test('parse: skeleton, skin, clips, state guess', () => {
  const m = A.parseAnimGLB(buildRigGLB({ clips: ['Wave', 'Slide', 'Idle'] }));
  assert.deepEqual(m.animations.map((a) => [a.name, a.duration]), [['Wave', 1], ['Slide', 2], ['Idle', 2]]);
  assert.equal(m.skins[0].joints.length, 2); assert.equal(m.meshes[0].primitives[0].joints.length, 16);
  assert.deepEqual(A.guessStates(['Armature|Idle_loop', 'Walking', 'Run_Fast', 'Jump', 'Death']), { idle: 'Armature|Idle_loop', walk: 'Walking', run: 'Run_Fast', jump: 'Jump', die: 'Death' });
});
test('skinning: 90deg arm rotation moves the arm vertices about the joint', () => {
  const m = A.parseAnimGLB(buildRigGLB()), wave = m.animations[0];
  const rest = A.skinPrimitive(m.meshes[0].primitives[0], A.jointMatrices(m, 0, A.worldMatrices(m, A.poseAt(m, null, 0)))).positions;
  assert.deepEqual(Array.from(rest), [0, 0, 0, 1, 0, 0, 0, 2, 0, 1, 2, 0]);
  const p = A.skinPrimitive(m.meshes[0].primitives[0], A.jointMatrices(m, 0, A.worldMatrices(m, A.poseAt(m, wave, 1, false)))).positions;
  [0, 0, 0, 1, 0, 0, -1, 1, 0, -1, 2, 0].forEach((v, k) => close(p[k], v, `v${k}`));
  const half = A.skinPrimitive(m.meshes[0].primitives[0], A.jointMatrices(m, 0, A.worldMatrices(m, A.poseAt(m, wave, 0.5, false)))).positions;
  close(half[6], -Math.SQRT1_2, 'slerp midpoint x'); close(half[7], 1 + Math.SQRT1_2, 'slerp midpoint y');
  const norm = A.skinPrimitive(m.meshes[0].primitives[0], A.jointMatrices(m, 0, A.worldMatrices(m, A.poseAt(m, wave, 1, false)))).normals; close(Math.hypot(norm[6], norm[7], norm[8]), 1, 'unit normal');
});
test('translation clip, loop wrap and STEP interpolation', () => {
  const m = A.parseAnimGLB(buildRigGLB({ clips: ['Slide', 'Idle'] })), slide = m.animations[0], idle = m.animations[1];
  close(A.posedBounds(m, slide, 1).min[0], 1, 'half way'); close(A.posedBounds(m, slide, 2).min[0], 2, 'end clamps');
  close(A.poseAt(m, slide, 3, true)[1].t[0], 1, 'loop 3 -> 1');
  close(A.poseAt(m, idle, 0.9)[1].t[1], 0, 'step holds first key'); close(A.poseAt(m, idle, 1.1)[1].t[1], 0.1, 'step jumps at key 1');
});
test('player: states, crossfade, non-looping clip finishes', () => {
  const m = A.parseAnimGLB(buildRigGLB()), p = new A.AnimPlayer(m, { states: { idle: 'Slide', attack: 'Wave' } });
  p.setState('idle'); p.update(1); close(p.pose()[1].t[0], 1, 'slide at 1s');
  p.setState('attack', { fade: 0.5 }); p.update(0.25);
  const mid = p.pose()[2].r; assert.ok(mid[2] > 0 && mid[2] < Math.SQRT1_2, 'blending toward wave');
  p.update(2); assert.equal(p.finished, true); close(p.pose()[2].r[2], Math.SQRT1_2, 'ended on last key');
  assert.throws(() => p.play('Nope'), /no clip "Nope"/);
  assert.equal(p.skinned()[0].primitives[0].positions.length, 12);
  assert.equal(p.jointMatrices()[0].length, 32);
});
test('compressed files are rejected with a fix', () => {
  const { splitGLB, joinGLB } = A, { json, bin } = splitGLB(buildRigGLB()); json.extensionsRequired = ['KHR_draco_mesh_compression'];
  assert.throws(() => A.parseAnimGLB(joinGLB(json, bin)), (e) => e.code === 'UNSUPPORTED' && /Draco/.test(e.message));
});
test('merge: clips from other files are matched by node name; unknown bones are skipped', () => {
  const base = buildRigGLB({ clips: ['Wave'] }), other = buildRigGLB({ clips: ['Slide', 'Wave'] }), foreign = buildRigGLB({ clips: ['Slide'], nodeNames: ['A', 'B', 'C', 'D'] });
  const r = A.mergeAnimGLB(base, [{ data: other, name: 'o.glb' }, { data: foreign, name: 'f.glb' }]);
  assert.deepEqual(r.added.map((a) => a.name), ['Wave_2', 'Slide']); assert.equal(r.skipped.length, 1); assert.match(r.skipped[0].reason, /no channel matched/);
  const m = A.parseAnimGLB(r.glb); assert.deepEqual(m.animations.map((a) => a.name), ['Wave', 'Wave_2', 'Slide']);
  close(A.posedBounds(m, m.animations[2], 1).min[0], 1, 'merged clip plays');
  const r2 = A.mergeAnimGLB(base, [{ data: other, name: 'o.glb', prefix: 'x_', clips: ['Slide'] }]); assert.deepEqual(r2.added.map((a) => a.name), ['x_Slide']);
  assert.equal(A.mergeAnimGLB(base, [{ data: other, name: 'o.glb' }], { onConflict: 'skip' }).skipped.length, 1);
});

test('anim.* registered with schemas', () => { for (const n of ['inspect', 'import', 'merge', 'sample']) { const c = reg.get(`anim.${n}`); assert.ok(c && c.summary.length > 30, n); } });
test('anim.inspect / import / merge / sample through the registry', async () => {
  const d = tmp(); writeFileSync(join(d, 'Walk.glb'), buildRigGLB({ clips: ['Slide'] })); writeFileSync(join(d, 'Hero Idle.glb'), buildRigGLB({ clips: ['Idle'] }));
  const ins = await call('anim.inspect', { project: d, input: 'Walk.glb' }); assert.ok(ins.ok, JSON.stringify(ins.error));
  assert.equal(ins.data.skinned, true); assert.equal(ins.data.skins[0].joints, 2); assert.equal(ins.data.triangles, 2); assert.deepEqual(ins.data.bindBounds.size, [1, 2, 0]);
  const imp = await call('anim.import', { project: d, inputs: ['Walk.glb', 'Hero Idle.glb'] }); assert.ok(imp.ok, JSON.stringify(imp.error));
  assert.deepEqual(imp.data.models.map((m) => m.id).sort(), ['Hero_Idle', 'Walk']); assert.equal(imp.data.sameRig.length, 1); assert.match(imp.next[0], /anim\.merge/);
  assert.ok(existsSync(join(d, 'assets/models/Walk.glb'))); const man = JSON.parse(readFileSync(join(d, 'assets/models/manifest.json'), 'utf8')); assert.equal(man.models.length, 2);
  assert.match(readFileSync(join(d, 'assets/models/models.js'), 'utf8'), /export const manifest/);
  assert.equal((await call('anim.import', { project: d, inputs: ['Walk.glb', 'Hero Idle.glb'] })).error.code, 'EXISTS');
  const mg = await call('anim.merge', { project: d, base: 'Walk.glb', inputs: ['Hero Idle.glb'], out: 'assets/models/hero.glb' }); assert.ok(mg.ok, JSON.stringify(mg.error));
  assert.deepEqual(mg.data.clips.map((c) => c.name), ['Slide', 'Idle']); assert.equal(mg.data.states.idle, 'Idle');
  assert.equal((await call('anim.merge', { project: d, base: 'Walk.glb', inputs: ['Hero Idle.glb'], out: 'assets/models/hero.glb' })).error.code, 'EXISTS');
  const s = await call('anim.sample', { project: d, input: 'assets/models/hero.glb', clip: 'Slide', time: 1 }); assert.ok(s.ok); close(s.data.joints.Hips[0], 1, 'Hips x'); close(s.data.bounds.min[0], 1, 'bounds');
  assert.equal((await call('anim.sample', { project: d, input: 'Walk.glb', clip: 'Nope' })).error.code, 'NOT_FOUND');
});
test('anim.* error paths', async () => {
  const d = tmp(); writeFileSync(join(d, 'bad.glb'), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])); writeFileSync(join(d, 'm.obj'), 'v 0 0 0\n');
  assert.equal((await call('anim.inspect', { project: d, input: 'missing.glb' })).error.code, 'NOT_FOUND');
  assert.equal((await call('anim.inspect', { project: d, input: 'm.obj' })).error.code, 'BAD_INPUT');
  assert.equal((await call('anim.inspect', { project: d, input: 'bad.glb' })).error.code, 'BAD_INPUT');
  assert.equal((await call('anim.import', { project: d, inputs: ['bad.glb'], out: '../escape' })).error.code, 'BAD_INPUT');
  const { splitGLB, joinGLB } = A, g = splitGLB(buildRigGLB()); g.json.extensionsUsed = ['EXT_meshopt_compression']; writeFileSync(join(d, 'c.glb'), joinGLB(g.json, g.bin));
  const c = await call('anim.inspect', { project: d, input: 'c.glb' }); assert.equal(c.error.code, 'UNSUPPORTED'); assert.match(c.error.message, /Re-export/);
});
