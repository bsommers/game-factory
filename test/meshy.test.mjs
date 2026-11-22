import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';
import * as L from '../factory-core/meshy/lib.mjs';
import * as A from '../templates/web-project/src/lib/gltf-anim.js';
import { buildRigGLB } from './helpers/anim-glb.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fmeshy-'));
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const close = (a, b, m, e = 1e-4) => assert.ok(Math.abs(a - b) < e, `${m}: ${a} vs ${b}`);

// Synthetic variants of the helper rig: Meshy-style clip names, and a centimetre-scaled copy.
function renamed(data, map) { const { json, bin } = A.splitGLB(data); for (const a of json.animations) a.name = map[a.name] ?? a.name; return A.joinGLB(json, bin); }
const meshyNames = { Wave: 'Armature|waving|baselayer', Slide: 'Armature|slide_move|baselayer', Idle: 'Armature|idle_stand|baselayer' };
const meshyGlb = () => renamed(buildRigGLB({ clips: ['Wave', 'Slide', 'Idle'] }), meshyNames);
const cmGlb = () => { const { json, bin } = A.splitGLB(meshyGlb()); const b = L.bakeScale(json, bin, 100); return A.joinGLB(b.json, b.bin); };

test('clip names: Armature| and |baselayer stripped, renames, prefix, de-dupe', () => {
  assert.equal(L.cleanClipName('Armature|walking_man|baselayer'), 'walking_man');
  assert.equal(L.cleanClipName('Armature|Idle'), 'Idle');
  assert.equal(L.cleanClipName('Take 001'), 'Take_001');
  assert.deepEqual(L.planClipNames(['Armature|a|baselayer', 'a', 'b'], { rename: { b: 'bee' }, prefix: 'x_' }).map((p) => p.to), ['x_a', 'x_a_2', 'x_bee']);
});
test('units: metres vs centimetres by bind height; bake scales every layer consistently', () => {
  const m = A.parseAnimGLB(meshyGlb()), cm = A.parseAnimGLB(cmGlb());
  assert.equal(L.detectUnits(m).units, 'm'); const u = L.detectUnits(cm); assert.equal(u.units, 'cm'); assert.equal(u.confidence, 'high'); close(u.factor, 0.01, 'factor');
  const { json, bin } = A.splitGLB(cmGlb()), back = L.bakeScale(json, bin, 0.01), m2 = A.parseAnimGLB(A.joinGLB(back.json, back.bin));
  for (const [clip, t] of [[null, 0], ['Armature|waving|baselayer', 0.5], ['Armature|slide_move|baselayer', 1.3]]) {
    const b1 = A.posedBounds(m, clip && m.animations.find((a) => a.name === clip), t), b2 = A.posedBounds(m2, clip && m2.animations.find((a) => a.name === clip), t);
    b1.min.forEach((v, k) => { close(v, b2.min[k], `min${k}`); close(b1.max[k], b2.max[k], `max${k}`); });
  }
  assert.ok(json.nodes.every((n) => !n.scale), 'no node scale introduced');
  assert.throws(() => { const j = structuredClone(json); j.nodes[0].scale = [100, 100, 100]; L.bakeScale(j, bin, 0.01); }, /non-unit scale/);
});
test('compactGLB drops unreferenced data and keeps animation behaviour', () => {
  const { json, bin } = A.splitGLB(meshyGlb()); json.animations = json.animations.filter((a) => a.name.includes('waving'));
  const c = L.compactGLB(json, bin), m = A.parseAnimGLB(A.joinGLB(c.json, c.bin));
  assert.ok(c.bin.length < bin.length); assert.deepEqual(m.animations.map((a) => a.name), ['Armature|waving|baselayer']); close(m.animations[0].duration, 1, 'dur');
});

test('meshy.import: cm file becomes metres, clips renamed, manifest has provenance', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'Meshy_AI_Hero_20261121_x.glb'), cmGlb());
  const r = await call('meshy.import', { project: dir, input: 'Meshy_AI_Hero_20261121_x.glb', provenance: { plan: 'free' } });
  assert.ok(r.ok, JSON.stringify(r.error)); const d = r.data;
  assert.equal(d.id, 'hero'); assert.equal(d.unitsDetected.units, 'cm'); close(d.after.height, 2, 'height');
  assert.deepEqual(d.after.clips, ['waving', 'slide_move', 'idle_stand']); assert.equal(d.after.states.idle, 'idle_stand');
  assert.ok(d.applied.some((a) => /scale/.test(a)) && d.applied.some((a) => /renamed 3/.test(a)));
  const man = JSON.parse(readFileSync(join(dir, 'assets/models/manifest.json'), 'utf8')), e = man.models[0];
  assert.equal(e.provenance.plan, 'free'); assert.equal(e.provenance.visibility, 'unknown'); assert.equal(e.provenance.jobId, 'unknown'); assert.equal(e.license.id, 'CC-BY-4.0'); assert.equal(e.units, 'm');
  assert.match(e.sha256, /^[0-9a-f]{64}$/); assert.ok(existsSync(join(dir, 'assets/models/models.js')));
  const out = A.parseAnimGLB(new Uint8Array(readFileSync(join(dir, 'assets/models/hero.glb'))));
  assert.ok(out.nodes.every((n) => n.s.every((v) => v === 1)));
  // deterministic and idempotent with overwrite
  const sha1 = e.sha256, again = await call('meshy.import', { project: dir, input: 'Meshy_AI_Hero_20261121_x.glb', provenance: { plan: 'free' }, overwrite: true });
  assert.equal(again.data.entry.sha256, sha1);
  assert.equal((await call('meshy.import', { project: dir, input: 'Meshy_AI_Hero_20261121_x.glb' })).error.code, 'EXISTS');
});
test('meshy.import: metre file with clean names is copied verbatim; keep/drop/height options', async () => {
  const dir = tmp(); const src = buildRigGLB({ clips: ['Wave', 'Slide', 'Idle'] }); writeFileSync(join(dir, 'rig.glb'), src);
  const r = await call('meshy.import', { project: dir, input: 'rig.glb' });
  assert.ok(r.ok); assert.deepEqual(r.data.applied, []); assert.deepEqual(readFileSync(join(dir, 'assets/models/rig.glb')), Buffer.from(src));
  assert.equal(r.data.entry.provenance.plan, 'unknown');
  const r2 = await call('meshy.import', { project: dir, input: 'rig.glb', id: 'big', height: 4, clips: { drop: ['Slide'], rename: { Wave: 'greet' } } });
  assert.ok(r2.ok, JSON.stringify(r2.error)); close(r2.data.after.height, 4, 'height'); assert.deepEqual(r2.data.after.clips, ['greet', 'Idle']);
  assert.equal((await call('meshy.import', { project: dir, input: 'nope.glb' })).error.code, 'NOT_FOUND');
  assert.equal((await call('meshy.import', { project: dir, input: 'rig.glb', out: '../outside' })).error.code, 'BAD_INPUT');
});

test('meshy.verify: synthetic rig checks (units, idle, scale tracks, size budget)', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'm.glb'), meshyGlb()); writeFileSync(join(dir, 'cm.glb'), cmGlb()); writeFileSync(join(dir, 'noidle.glb'), buildRigGLB());
  const st = (res, id) => res.data.checks.find((c) => c.id === id)?.status;
  const ok1 = await call('meshy.verify', { project: dir, input: 'm.glb' });
  assert.ok(ok1.ok && ok1.data.pass, JSON.stringify(ok1.data.checks.filter((c) => c.status === 'fail')));
  assert.equal(st(ok1, 'skin'), 'pass'); assert.equal(st(ok1, 'idle'), undefined); assert.equal(st(ok1, 'clip-names'), 'warn'); assert.equal(ok1.data.summary.joints, 2);
  const cm = await call('meshy.verify', { project: dir, input: 'cm.glb' });
  assert.equal(cm.data.pass, false); assert.equal(st(cm, 'height'), 'fail'); assert.ok(cm.next.some((n) => /units:"cm"/.test(n)));
  const ni = await call('meshy.verify', { project: dir, input: 'noidle.glb', expect: { clips: ['Run'] }, budget: { maxJoints: 1 } });
  assert.equal(st(ni, 'idle'), 'warn'); assert.equal(st(ni, 'expect-clip'), 'fail'); assert.equal(st(ni, 'joints'), 'fail'); assert.equal(ni.data.pass, false);
  const slide = ok1.data.checks.find((c) => c.id === 'root-drift').clips.find((c) => c.clip.includes('slide'));
  close(slide.drift, 2, 'slide drift'); assert.equal(slide.locomotion, false);
  // compressed files are reported as a failed check, not a crash
  const { json, bin } = A.splitGLB(meshyGlb()); json.extensionsUsed = ['KHR_draco_mesh_compression']; writeFileSync(join(dir, 'draco.glb'), A.joinGLB(json, bin));
  const dr = await call('meshy.verify', { project: dir, input: 'draco.glb' }); assert.ok(dr.ok); assert.equal(dr.data.pass, false); assert.equal(st(dr, 'uncompressed'), 'fail');
  // unskinned
  const { json: j2, bin: b2 } = A.splitGLB(buildRigGLB()); delete j2.skins; delete j2.nodes[3].skin; delete j2.meshes[0].primitives[0].attributes.JOINTS_0; delete j2.meshes[0].primitives[0].attributes.WEIGHTS_0; writeFileSync(join(dir, 'static.glb'), A.joinGLB(j2, b2));
  assert.equal(st(await call('meshy.verify', { project: dir, input: 'static.glb' }), 'skin'), 'fail');
});

test('meshy.split: ranges become clips with interpolated boundaries', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'm.glb'), buildRigGLB({ clips: ['Slide', 'Wave'] }));
  const r = await call('meshy.split', { project: dir, input: 'm.glb', clip: 'Slide', out: 'out/split.glb', ranges: [{ name: 'a', start: 0, end: 0.5 }, { name: 'b', start: 0.5, end: 2 }] });
  assert.ok(r.ok, JSON.stringify(r.error)); assert.deepEqual(r.data.clips.map((c) => c.name), ['Wave', 'a', 'b']);
  const m = A.parseAnimGLB(new Uint8Array(readFileSync(join(dir, 'out/split.glb')))), a = m.animations.find((x) => x.name === 'a'), b = m.animations.find((x) => x.name === 'b');
  close(a.duration, 0.5, 'a dur'); close(b.duration, 1.5, 'b dur');
  close(A.sampleChannel(a.channels[0], 0.5)[0], 0.5, 'a end x'); close(A.sampleChannel(b.channels[0], 0)[0], 0.5, 'b start x'); close(A.sampleChannel(b.channels[0], 1.5)[0], 2, 'b end x');
  assert.equal((await call('meshy.split', { project: dir, input: 'm.glb', out: 'out/s0.glb', ranges: [{ name: 'a', start: 0, end: 1 }] })).error.code, 'BAD_INPUT'); // two clips: clip required
  assert.equal((await call('meshy.split', { project: dir, input: 'm.glb', clip: 'Slide', out: 'out/split.glb', ranges: [{ name: 'a', start: 0, end: 1 }] })).error.code, 'EXISTS');
  assert.equal((await call('meshy.split', { project: dir, input: 'm.glb', clip: 'Slide', out: 'out/s2.glb', ranges: [{ name: 'Wave', start: 0, end: 1 }] })).error.code, 'BAD_INPUT');
  assert.equal((await call('meshy.split', { project: dir, input: 'm.glb', clip: 'Slide', out: 'out/s2.glb', ranges: [{ name: 'z', start: 5, end: 6 }] })).error.code, 'BAD_INPUT');
  const fr = await call('meshy.split', { project: dir, input: 'm.glb', clip: 'Slide', out: 'out/s3.glb', unit: 'frames', fps: 10, only: true, keepOriginal: true, ranges: [{ name: 'f', start: 0, end: 10 }] });
  assert.ok(fr.ok); assert.deepEqual(fr.data.clips.map((c) => c.name), ['f']); close(fr.data.added[0].duration, 1, 'frames to seconds');
  const step = await call('meshy.split', { project: dir, input: 'm.glb', clip: 'Wave', out: 'out/s4.glb', ranges: [{ name: 'half', start: 0, end: 0.5 }] });
  const sm = A.parseAnimGLB(new Uint8Array(readFileSync(join(dir, 'out/s4.glb')))), h = sm.animations.find((x) => x.name === 'half'); assert.ok(step.ok);
  close(A.sampleChannel(h.channels[0], 0.5)[3], Math.cos(Math.PI / 8), 'slerp midpoint w');
});

test('boneRole: Rigify, Mixamo, UE names', () => {
  const t = { 'upper_arm.L': 'LeftUpperArm', 'forearm.R': 'RightLowerArm', 'thigh.L': 'LeftUpperLeg', 'shin.R': 'RightLowerLeg', 'toe.L': 'LeftToes', 'toe.L_end': null, 'thumb.01.L': 'LeftThumbMetacarpal', 'f_pinky.03.R': 'RightLittleDistal', 'f_index.02.L': 'LeftIndexIntermediate',
    'mixamorig:LeftArm': 'LeftUpperArm', 'mixamorig:LeftForeArm': 'LeftLowerArm', 'mixamorig:LeftUpLeg': 'LeftUpperLeg', 'mixamorig:RightLeg': 'RightLowerLeg', 'mixamorig:LeftToeBase': 'LeftToes', 'mixamorig:LeftHandIndex1': 'LeftIndexProximal', 'mixamorig:LeftHandThumb4': null,
    'mixamorig:Hips': 'Hips', 'mixamorig:Head': 'Head', 'upperarm_l': 'LeftUpperArm', 'calf_r': 'RightLowerLeg', 'DEF-hand.L': 'LeftHand', 'Bone_041': null, headfront: null };
  for (const [n, r] of Object.entries(t)) assert.equal(L.boneRole(n), r, n);
});
test('meshy.rig-map: synthetic rigs map by name and role, Godot map', async () => {
  const dir = tmp(); writeFileSync(join(dir, 'a.glb'), buildRigGLB()); writeFileSync(join(dir, 'b.glb'), buildRigGLB({ nodeNames: ['Rig', 'Pelvis', 'Wrist', 'Mesh'] })); writeFileSync(join(dir, 'c.glb'), buildRigGLB());
  const same = await call('meshy.rig-map', { project: dir, a: 'a.glb', b: 'c.glb' }); assert.ok(same.ok); assert.equal(same.data.identicalSignature, true); assert.equal(same.data.onlyInA.length, 0);
  const diff = await call('meshy.rig-map', { project: dir, a: 'a.glb', b: 'b.glb' });
  assert.equal(diff.data.identicalSignature, false); assert.equal(diff.data.mapping.length, 2); assert.deepEqual(diff.data.mapping.map((m) => m.via), ['role', 'topology']); // Hips <-> Pelvis by role, Arm <-> Wrist by hierarchy
  assert.ok(diff.data.godotBoneMap.missingRequired.includes('Head'));
  const p = await call('meshy.rig-map', { project: dir, a: 'a.glb', out: 'bm/map.json' }); assert.equal(JSON.parse(readFileSync(join(dir, 'bm/map.json'), 'utf8')).profile, 'SkeletonProfileHumanoid');
  assert.equal((await call('meshy.rig-map', { project: dir, a: 'a.glb', out: 'bm/map.json' })).error.code, 'EXISTS');
});

// ---------------- real Meshy exports (skipped when the files are absent) ----------------
const REAL = '/home/bill/src/fun/colbdysseus/assets/meshy', realFiles = existsSync(REAL) ? readdirSync(REAL).filter((f) => f.endsWith('.glb')) : [];
const pete = realFiles.find((f) => /Parkway_Pete/.test(f)), colby = realFiles.find((f) => /SuperColby/.test(f));
test('real: Parkway Pete verify + Godot bone map with fingers', { skip: !pete }, async () => {
  const v = await call('meshy.verify', { input: join(REAL, pete) }); assert.ok(v.ok && v.data.pass, JSON.stringify(v.data.checks.filter((c) => c.status === 'fail')));
  assert.equal(v.data.summary.joints, 58); assert.equal(v.data.checks.find((c) => c.id === 'facing').detail.startsWith('faces +Z'), true);
  assert.deepEqual(v.data.summary.clips.map((c) => c.name), ['Running', 'Walking', 'Boxing_Practice']);
  const g = (await call('meshy.rig-map', { a: join(REAL, pete) })).data.godotBoneMap;
  assert.equal(g.bones.Hips, 'spine'); assert.equal(g.bones.Head, 'spine.005'); assert.equal(g.bones.LeftLittleDistal, 'f_pinky.03.L'); assert.deepEqual(g.missingRequired, []);
});
test('real: SuperColby verify, no idle, Bone_0NN extras vs Pete', { skip: !colby || !pete }, async () => {
  const v = await call('meshy.verify', { input: join(REAL, colby) }); assert.ok(v.ok && v.data.pass);
  assert.equal(v.data.summary.joints, 45); assert.equal(v.data.checks.find((c) => c.id === 'idle').status, 'warn');
  const c = (await call('meshy.rig-map', { a: join(REAL, pete), b: join(REAL, colby) })).data;
  assert.equal(c.identicalSignature, false); assert.equal(c.onlyInB.length, 19); assert.ok(c.onlyInB.every((n) => /^Bone_0\d\d$/.test(n))); assert.ok(c.mapping.length >= 26);
});
test('real: import SuperColby normalises names into a scratch project', { skip: !colby }, async () => {
  const dir = tmp(), r = await call('meshy.import', { project: dir, input: join(REAL, colby), provenance: { plan: 'pro', jobId: 'job-1' } });
  assert.ok(r.ok, JSON.stringify(r.error)); assert.equal(r.data.id, 'supercolby'); assert.equal(r.data.entry.provenance.visibility, 'unknown');
  assert.deepEqual(r.data.after.clips, ['Running', 'Walking', '360_Power_Spin_Jump', 'Angry_Stomp', 'air_squat']); assert.equal(r.data.entry.license.requiresAttribution, false);
  const s = await call('meshy.split', { project: dir, input: 'assets/models/supercolby.glb', clip: 'Angry_Stomp', out: 'split.glb', only: true, ranges: [{ name: 'stomp_a', start: 0, end: 2 }, { name: 'stomp_b', start: 2, end: 4 }] });
  assert.ok(s.ok, JSON.stringify(s.error)); assert.deepEqual(s.data.clips.map((c) => c.name), ['stomp_a', 'stomp_b']);
});
