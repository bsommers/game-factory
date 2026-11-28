import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';
import { buildRigGLB } from './helpers/anim-glb.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fgodot-t-'));
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const det = await call('godot.detect', {});
const have = det.data.installed, skip = have ? false : 'Godot not installed (see docs/GODOT.md)';

test('godot.detect returns the standard envelope', () => {
  assert.equal(det.ok, true); assert.equal(typeof det.data.installed, 'boolean'); assert.ok(Array.isArray(det.next));
  if (have) assert.match(det.data.version, /^4\./);
});
test('godot capabilities are registered with hyphenated names', () => {
  const names = reg.list().map((c) => c.name);
  for (const n of ['godot.detect', 'godot.test', 'godot.shot', 'godot.import-check']) assert.ok(names.includes(n), n);
});
test('bad input and missing project are reported without Godot', async () => {
  assert.equal((await call('godot.import-check', {})).error.code, 'BAD_INPUT');
  assert.equal((await call('godot.test', { godot: '/nonexistent/godot' })).ok === false, true);
});
test('godot.test on the action3d template', { skip }, async () => {
  const d = tmp(); cpSync(new URL('../templates/godot-action3d/', import.meta.url), d, { recursive: true });
  writeFileSync(join(d, 'project.godot'), readFileSync(join(d, 'project.godot'), 'utf8').replace('__NAME__', 'T'));
  const r = await call('godot.test', { project: d });
  assert.equal(r.ok, true, JSON.stringify(r.error) + (r.data?.output || ''));
  assert.ok(r.data.passed >= 1 && r.data.failed === 0);
  writeFileSync(join(d, 'tests/test_fail.gd'), 'extends "res://tests/test_base.gd"\nfunc test_bad() -> void:\n\tcheck(false, "boom")\n');
  const f = await call('godot.test', { project: d });
  assert.equal(f.ok, false); assert.equal(f.error.code, 'TASK_FAILED'); assert.equal(f.data.failed, 1);
});
test('godot.shot renders the template main scene', { skip: skip || (det.data.screenshots ? false : 'no display/xvfb') }, async () => {
  const d = tmp(); cpSync(new URL('../templates/godot-action3d/', import.meta.url), d, { recursive: true });
  const png = join(d, 'o.png'), r = await call('godot.shot', { project: d, out: png, frames: 3, size: '320x180' });
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.data.width, 320); assert.ok(existsSync(png) && r.data.bytes > 200);
});
test('godot.import-check reports skeleton and animations of a generated glb', { skip }, async () => {
  const d = tmp(), glb = join(d, 'rig.glb'); writeFileSync(glb, buildRigGLB());
  const r = await call('godot.import-check', { glb });
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.ok(r.data.skeletons.length >= 1); assert.ok(r.data.bones >= 2);
  assert.deepEqual(r.data.animations.map((a) => a.name).sort(), ['Slide', 'Wave']);
});
