import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { buildRegistry } from '../factory-core/index.mjs';

const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const exDir = new URL('../spec/v4/examples/camera3d/', import.meta.url);

test('registered with envelope', async () => {
  const names = reg.list().map((c) => c.name); assert.ok(names.includes('camera3d.validate') && names.includes('camera3d.simulate'));
});
test('validate: all shipped examples pass; defaults filled', async () => {
  for (const f of readdirSync(exDir)) {
    const r = await call('camera3d.validate', { config: JSON.parse(readFileSync(new URL(f, exDir), 'utf8')) });
    assert.equal(r.ok, true, f + ' ' + JSON.stringify(r.error)); assert.equal(r.data.config.follow.height > 0, true);
  }
});
test('validate: rejects unknown keys, bad types, ranges and semantic errors', async () => {
  for (const config of [{ follow: { dist: 3 } }, { follow: { distance: 'far' } }, { fov: { base: 500 } }, { follow: { minPitch: 1, maxPitch: 0.1, pitch: 0.5 } }, { follow: { minDistance: 50 } }]) {
    const r = await call('camera3d.validate', { config }); assert.equal(r.ok, false, JSON.stringify(config)); assert.equal(r.error.code, 'BAD_INPUT');
  }
  assert.equal((await call('camera3d.validate', {})).ok, false);
});
test('simulate: open field has no collisions; walk path moves camera with player', async () => {
  const r = await call('camera3d.simulate', { path: { waypoints: [[0, 0, 0], [0, 0, -20]], speed: 5 } });
  assert.equal(r.ok, true); assert.equal(r.data.collisionFrames, 0); assert.equal(r.data.frames, 240);
  assert.ok(r.data.final.pos[2] < -10); assert.ok(r.data.samples.length > 5);
});
test('simulate: wall behind the path triggers boom collisions and is deterministic', async () => {
  const input = { world: { boxes: [{ min: [-5, -1, 1.5], max: [5, 6, 2.5] }] }, path: { waypoints: [[0, 0, 0], [0, 0, -2]], seconds: 2 }, trauma: [{ at: 0.5, amount: 0.8 }], fovKick: [{ at: 1, deg: 10 }] };
  const a = await call('camera3d.simulate', input), b = await call('camera3d.simulate', input);
  assert.equal(a.ok, true); assert.ok(a.data.collisionFrames > 0); assert.equal(a.data.firstCollisionFrame >= 0, true);
  assert.ok(a.data.minDistance < 4.5); assert.deepEqual(a, b);
  assert.ok(a.data.next === undefined && a.next.length > 0);
});
test('simulate: bad input and runaway length are rejected', async () => {
  assert.equal((await call('camera3d.simulate', { path: { waypoints: [[0, 0]] } })).ok, false);
  assert.equal((await call('camera3d.simulate', { path: { waypoints: [[0, 0, 0]], seconds: 99999 } })).ok, false);
  assert.equal((await call('camera3d.simulate', { config: { follow: { distance: 'x' } }, path: { waypoints: [[0, 0, 0]] } })).ok, false);
});
