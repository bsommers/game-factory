import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';
import { validate as schemaValidate } from '../factory-core/schema.mjs';

const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const ex = (n) => JSON.parse(readFileSync(new URL(`../spec/v4/examples/vfx3d/${n}.json`, import.meta.url), 'utf8'));
const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const NAMES = ['whirlpool', 'flood-water', 'toxic-sludge', 'fire', 'steam-vent', 'hit-spark'];

test('vfx3d capabilities are registered with the envelope', async () => {
  for (const n of ['vfx3d.validate', 'vfx3d.sample']) assert.ok(reg.has(n), n);
  const r = await call('vfx3d.validate', { effect: ex('whirlpool') }); assert.equal(r.ok, true); assert.deepEqual(Object.keys(r).sort(), ['data', 'error', 'next', 'ok']); assert.ok(r.next.length);
});
test('examples satisfy their JSON Schema and validate', async () => {
  const schema = JSON.parse(readFileSync(new URL('../spec/v4/schemas/vfx3d.schema.json', import.meta.url), 'utf8'));
  for (const n of NAMES) { assert.deepEqual(schemaValidate(schema, ex(n)), [], n); const r = await call('vfx3d.validate', { effect: ex(n) }); assert.equal(r.ok, true, n); }
  assert.ok(schemaValidate(schema, { id: 'x', kind: 'lava' }).length > 0);
});
test('Godot template defs are byte-identical copies of the spec examples', () => {
  const dir = new URL('../templates/godot-action3d/vfx/defs/', import.meta.url);
  assert.deepEqual(readdirSync(dir).sort(), NAMES.map((n) => `${n}.json`).sort());
  for (const n of NAMES) assert.equal(readFileSync(new URL(`${n}.json`, dir), 'utf8'), readFileSync(new URL(`../spec/v4/examples/vfx3d/${n}.json`, import.meta.url), 'utf8'), n);
});
test('vfx3d.validate rejects bad input, structural errors and reads project files', async () => {
  assert.equal((await call('vfx3d.validate', {})).error.code, 'BAD_INPUT');
  assert.equal((await call('vfx3d.validate', { file: 'nope.json' })).error.code, 'NOT_FOUND');
  const bad = ex('flood-water'); bad.water.waves[0].wavelength = 0; const r = await call('vfx3d.validate', { effect: bad });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_INPUT'); assert.ok(r.error.details.some((e) => e.path === '$.water.waves[0].wavelength'));
  const dir = mkdtempSync(join(SCRATCH, 'fvfx-')); writeFileSync(join(dir, 'e.json'), JSON.stringify(ex('fire')));
  const ok = await call('vfx3d.validate', { file: 'e.json', project: dir }); assert.equal(ok.ok, true); assert.equal(ok.data.stats.emitters, 2);
  writeFileSync(join(dir, 'x.json'), '{nope'); assert.equal((await call('vfx3d.validate', { file: 'x.json', project: dir })).error.code, 'BAD_INPUT');
});
test('vfx3d.sample field: shared vortex data, ramp/pulse in time, resisting, dps', async () => {
  const r = await call('vfx3d.sample', { effect: ex('whirlpool'), what: 'field', points: [[5, 0, 2], [1, 0, 0], [30, 0, 0]], times: [0, 3.5, 6] });
  assert.equal(r.ok, true); assert.equal(r.data.samples.length, 9);
  const at = (t, i) => r.data.samples.filter((s) => s.t === t)[i];
  assert.ok(at(0, 0).force.every((v) => v === 0), 'ramp starts at zero'); assert.ok(Math.hypot(...at(3.5, 0).force) > Math.hypot(...at(6, 0).force), 'idle pulse is weaker');
  assert.equal(at(3.5, 1).dps, 12); assert.deepEqual(at(3.5, 2).force, [0, 0, 0]);
  const res = await call('vfx3d.sample', { effect: ex('whirlpool'), points: [[5, 0, 2]], times: [3.5], resisting: true });
  assert.ok(Math.hypot(...res.data.samples[0].force) < Math.hypot(...at(3.5, 0).force));
  const again = await call('vfx3d.sample', { effect: ex('whirlpool'), what: 'field', points: [[5, 0, 2], [1, 0, 0], [30, 0, 0]], times: [0, 3.5, 6] }); assert.equal(again.data.hash, r.data.hash);
});
test('vfx3d.sample water/surface/particles and error paths', async () => {
  const w = await call('vfx3d.sample', { effect: ex('flood-water'), what: 'water', points: [[0, 0, 0], [3, 0, 4]], times: [0, 7] });
  assert.equal(w.ok, true); assert.equal(w.data.samples.length, 4); assert.equal(w.data.samples[2].level, 0.6); assert.ok(w.data.samples.every((s) => s.normal[1] > 0.5));
  const s = await call('vfx3d.sample', { effect: ex('whirlpool'), what: 'surface', points: [[0, 0, 0], [25, 0, 0]], times: [20] }); assert.ok(s.data.samples[0].height < s.data.samples[1].height - 1);
  const p = await call('vfx3d.sample', { effect: ex('fire'), what: 'particles', emitter: 1, times: [2], limit: 3 }); assert.equal(p.ok, true); assert.ok(p.data.samples[0].count > 5 && p.data.samples[0].particles.length === 3);
  assert.equal((await call('vfx3d.sample', { effect: ex('fire'), what: 'particles', emitter: 9 })).error.code, 'BAD_INPUT');
  assert.equal((await call('vfx3d.sample', { effect: ex('fire'), what: 'water' })).error.code, 'BAD_INPUT');
  assert.equal((await call('vfx3d.sample', { effect: ex('hit-spark'), what: 'field' })).error.code, 'BAD_INPUT');
  assert.equal((await call('vfx3d.sample', { effect: { id: 'x', kind: 'nope' } })).error.code, 'BAD_INPUT');
  assert.equal((await call('vfx3d.sample', { effect: ex('whirlpool'), what: 'bogus' })).ok, false);
  assert.equal((await call('vfx3d.sample', { effect: ex('whirlpool'), points: Array(50).fill([0, 0, 0]), times: Array(50).fill(1) })).ok, false);
});
