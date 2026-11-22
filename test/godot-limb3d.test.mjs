// JS vs GDScript parity for limb3d: runs spec/v4/parity/limb3d/scenario.json through limb_core.gd in headless Godot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildRegistry } from '../factory-core/index.mjs';
import * as L from '../templates/web-project/src/lib/limb3d.js';

const reg = buildRegistry(), det = await reg.call('godot.detect', {}), have = det.data.installed, skip = have ? false : 'Godot not installed (see docs/GODOT.md)';
const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const P = new URL('../spec/v4/parity/limb3d/', import.meta.url), sc = JSON.parse(readFileSync(new URL('scenario.json', P), 'utf8'));
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('JS simulate reproduces the committed parity expectation', () => {
  const r = L.simulate(sc.config, sc.script);
  assert.deepEqual(r.events.map((e) => e.type), sc.expected.eventTypes); assert.equal(r.finalCount, sc.expected.finalCount);
  assert.deepEqual(r.trajectory, sc.expected.trajectory); assert.deepEqual(r.finalPose.bones.map((b) => b.q), sc.expected.finalQuats);
});
test('GDScript limb_core matches the JS stepper', { skip }, () => {
  const d = mkdtempSync(join(SCRATCH, 'flimb-gd-'));
  copyFileSync(new URL('../templates/godot-action3d/scripts/limb/limb_core.gd', import.meta.url), join(d, 'limb_core.gd'));
  copyFileSync(new URL('run.gd', P), join(d, 'run.gd')); copyFileSync(new URL('scenario.json', P), join(d, 'scenario.json'));
  writeFileSync(join(d, 'project.godot'), 'config_version=5\n[application]\nconfig/name="limb-parity"\n');
  const out = execFileSync(det.data.path, ['--headless', '--path', d, '--script', 'res://run.gd'], { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const line = out.split('\n').find((l) => l.startsWith('LIMB3D_RESULT ')); assert.ok(line, out.slice(-1500));
  const g = JSON.parse(line.slice('LIMB3D_RESULT '.length)), e = sc.expected, tol = sc.tolerance;
  assert.deepEqual(g.eventTypes, e.eventTypes); assert.equal(g.finalCount, e.finalCount); assert.equal(g.trajectory.length, e.trajectory.length);
  assert.ok(g.maxLenError < 1e-3, `len err ${g.maxLenError}`);
  g.trajectory.forEach((t, i) => { assert.equal(t.f, e.trajectory[i].f); assert.equal(t.count, e.trajectory[i].count); t.tip.forEach((v, k) => near(v, e.trajectory[i].tip[k], tol, `traj[${i}].tip[${k}]`)); });
  g.finalTip.forEach((v, k) => near(v, e.finalTip[k], tol, `finalTip[${k}]`));
  g.finalQuats.forEach((q, i) => q.forEach((v, k) => near(v, e.finalQuats[i][k], tol, `quat[${i}][${k}]`)));
});
