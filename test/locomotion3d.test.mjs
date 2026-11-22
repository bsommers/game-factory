import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../factory-core/index.mjs';
import { validate } from '../factory-core/schema.mjs';
import { CONFIG_SPEC } from '../templates/web-project/src/lib/locomotion3d.js';

const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const root = fileURLToPath(new URL('..', import.meta.url));
const schema = JSON.parse(readFileSync(`${root}spec/v4/schemas/locomotion3d.schema.json`, 'utf8'));
const exDir = `${root}spec/v4/examples/locomotion3d/`;

test('registered with hyphen-free area.verb names', () => {
  for (const n of ['locomotion3d.validate', 'locomotion3d.simulate', 'locomotion3d.report']) assert.ok(reg.has(n), n);
});

test('schema covers every config key; examples validate against schema and capability', async () => {
  for (const [s, ks] of Object.entries(CONFIG_SPEC)) for (const k of Object.keys(ks)) assert.ok(schema.properties[s].properties[k], `${s}.${k}`);
  const files = readdirSync(exDir).filter((f) => f.endsWith('.json')); assert.deepEqual(files.sort(), ['heavy.json', 'hero.json', 'small-fast.json']);
  for (const f of files) {
    const cfg = JSON.parse(readFileSync(exDir + f, 'utf8'));
    assert.deepEqual(validate(schema, cfg), [], f);
    const r = await call('locomotion3d.validate', { config: cfg }); assert.ok(r.ok, f + JSON.stringify(r.error));
  }
});

test('validate: rejects bad input with stable codes', async () => {
  let r = await call('locomotion3d.validate', { config: { dodge: { iframeStart: 0.5, iframeEnd: 0.2 } } });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_INPUT'); assert.ok(r.error.details.some((e) => /iframe/.test(e)));
  r = await call('locomotion3d.validate', { file: 'nope.json', project: root }); assert.equal(r.error.code, 'NOT_FOUND');
  r = await call('locomotion3d.validate', { config: {}, file: 'x' }); assert.equal(r.error.code, 'BAD_INPUT');
  r = await call('locomotion3d.validate', { bogus: 1 }); assert.equal(r.error.code, 'BAD_INPUT');
  r = await call('locomotion3d.validate', { file: 'spec/v4/examples/locomotion3d/heavy.json', project: root }); assert.ok(r.ok); assert.equal(r.data.config.name, 'heavy');
});

test('simulate: run, jump and dodge timeline on flat; envelope shape', async () => {
  const r = await call('locomotion3d.simulate', { file: 'spec/v4/examples/locomotion3d/hero.json', project: root, script: [{ seconds: 1, move: [0, 1] }, { frames: 40, jump: true, jumpHeld: true, move: [0, 1] }, { frames: 40, dodge: true, move: [0, 1] }], sampleEvery: 10 });
  assert.ok(r.ok, JSON.stringify(r.error)); assert.deepEqual(Object.keys(r).sort(), ['data', 'error', 'next', 'ok']);
  assert.ok(r.data.states.run > 0 && r.data.states.jump > 0 && r.data.states.dodge === 30);
  assert.ok(r.data.events.some((e) => e.event === 'jump') && r.data.events.some((e) => e.event === 'dodge'));
  assert.ok(Math.abs(r.data.apexHeight - 1.3722) < 1e-3); assert.match(r.data.hash, /^[0-9a-f]{8}$/);
});

test('simulate: ramp slide, ice, river, wall, platform worlds', async () => {
  const sim = (world, script, extra = {}) => call('locomotion3d.simulate', { world, script, sampleEvery: 30, ...extra });
  let r = await sim('wall', [{ seconds: 5, move: [0, 1] }]); assert.ok(r.data.final.pos[2] > -19.5 - 0.1 && r.data.final.pos[2] < -18, 'stopped by wall: ' + r.data.final.pos);
  r = await sim('river', [{ seconds: 3, move: [0, 1] }], { start: [0, 0, 2] }); assert.ok(r.data.states.swim > 0, 'river swim'); assert.ok(r.data.final.pos[0] > 3, 'current drift');
  r = await sim('ice', [{ seconds: 2, move: [0, 1] }, { seconds: 1, move: [0, 0] }], { start: [0, 0, 0] }); assert.ok(r.data.final.pos[2] < -5);
  r = await sim('platform', [{ seconds: 1 }]); assert.ok(r.data.final.pos[0] > 1.5, 'carried');
  r = await sim({ kind: 'ramp', angleDeg: 45 }, [{ seconds: 1.5, move: [0, 1] }], { start: [0, 0, 10] }); assert.ok(r.ok);
});

test('simulate: determinism (same input -> same hash) and bounds', async () => {
  const inp = { script: [{ seconds: 2, move: [0.4, 1], sprint: true, camYaw: 0.3 }, { frames: 1, jump: true, jumpHeld: true }, { seconds: 1, dodge: true, move: [1, 0] }] };
  const a = await call('locomotion3d.simulate', inp), b = await call('locomotion3d.simulate', inp);
  assert.equal(a.data.hash, b.data.hash); assert.deepEqual(a.data, b.data);
  const c = await call('locomotion3d.simulate', { script: [{ seconds: 2, move: [0.4, 1], sprint: true, camYaw: 0.31 }] }); assert.notEqual(c.data.hash, a.data.hash);
  const big = await call('locomotion3d.simulate', { script: Array.from({ length: 5 }, () => ({ seconds: 600 })) }); assert.equal(big.error.code, 'BAD_INPUT');
  const bad = await call('locomotion3d.simulate', { script: [] }); assert.equal(bad.error.code, 'BAD_INPUT');
});

test('report: jump apex and dodge distance match the config', async () => {
  for (const f of ['hero', 'heavy', 'small-fast']) {
    const cfg = JSON.parse(readFileSync(`${exDir}${f}.json`, 'utf8')), r = await call('locomotion3d.report', { config: cfg });
    assert.ok(r.ok, f); const d = r.data;
    assert.ok(Math.abs(d.jump.measured.fullApex - d.jump.analytic.full.apexHeight) < 1e-3, f + ' measured vs analytic apex');
    assert.ok(d.jump.measured.tapApex < d.jump.measured.fullApex);
    assert.ok(Math.abs(d.dodge.measuredFromRest - cfg.dodge.distance) < 0.02, `${f} dodge ${d.dodge.measuredFromRest} vs ${cfg.dodge.distance}`);
    assert.ok(Math.abs(d.dodge.measuredWhileRunning - cfg.dodge.distance) < 0.02);
    assert.ok(d.run.timeToRunS > 0 && d.run.stopTimeS >= 0 && Array.isArray(d.warnings));
  }
});
