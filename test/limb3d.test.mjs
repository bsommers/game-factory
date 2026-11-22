import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';

const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const ex = (n) => JSON.parse(readFileSync(new URL(`../spec/v4/examples/limb3d/${n}.json`, import.meta.url), 'utf8'));
const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const script = { steps: 400, seed: 3, targets: [{ f: 0, pos: [4, 1, 3] }, { f: 400, pos: [-3, 2, 4] }], commands: [{ f: 40, motion: 'bite' }], severs: [{ f: 300, keep: 3 }] };

test('limb3d capabilities are registered with the envelope', async () => {
  for (const n of ['limb3d.validate', 'limb3d.simulate']) assert.ok(reg.has(n), n);
  const r = await call('limb3d.validate', { limb: ex('hydra-neck') }); assert.equal(r.ok, true); assert.deepEqual(Object.keys(r).sort(), ['data', 'error', 'next', 'ok']); assert.ok(r.next.length);
});
test('limb3d.validate rejects bad input and structural errors; reads files', async () => {
  assert.equal((await call('limb3d.validate', {})).error.code, 'BAD_INPUT');
  assert.equal((await call('limb3d.validate', { file: 'nope.json' })).error.code, 'NOT_FOUND');
  const bad = ex('tentacle'); bad.solver = 'magic'; const r = await call('limb3d.validate', { limb: bad });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_INPUT'); assert.ok(r.error.details.some((e) => e.code === 'BAD_SOLVER'));
  const dir = mkdtempSync(join(SCRATCH, 'flimb-')); writeFileSync(join(dir, 'l.json'), JSON.stringify(ex('tentacle')));
  assert.equal((await call('limb3d.validate', { file: 'l.json', project: dir })).data.stats.segments, 12);
  writeFileSync(join(dir, 'x.json'), '{nope'); assert.equal((await call('limb3d.validate', { file: 'x.json', project: dir })).error.code, 'BAD_INPUT');
});
test('limb3d.simulate reports trajectory, length error, capsule summary and a stable hash', async () => {
  const a = await call('limb3d.simulate', { limb: ex('hydra-neck'), ...script }), b = await call('limb3d.simulate', { limb: ex('hydra-neck'), ...script });
  assert.equal(a.ok, true, JSON.stringify(a.error)); assert.equal(a.data.hash, b.data.hash); assert.ok(a.data.segmentLengthError < 1e-3);
  assert.equal(a.data.capsules.max, 6); assert.equal(a.data.capsules.min, 3); assert.ok(a.data.capsules.damagingFrames > 0); assert.ok(a.data.trajectory.length > 5); assert.equal(a.data.eventCounts.sever, 1); assert.equal(a.data.events, undefined);
  const full = await call('limb3d.simulate', { limb: ex('hydra-neck'), ...script, full: true }); assert.ok(full.data.events.length && full.data.finalPose.bones.length === 3);
});
test('limb3d.simulate validates input', async () => {
  assert.equal((await call('limb3d.simulate', { limb: ex('tentacle'), steps: 0 })).error.code, 'BAD_INPUT');
  assert.equal((await call('limb3d.simulate', { limb: ex('tentacle'), commands: [{ f: 1, motion: 'nope' }] })).error.code, 'BAD_INPUT');
  const bad = ex('tentacle'); bad.segments = 0; assert.equal((await call('limb3d.simulate', { limb: bad })).error.code, 'BAD_INPUT');
});
