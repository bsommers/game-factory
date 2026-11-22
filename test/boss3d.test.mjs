import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';

const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const ex = (n) => JSON.parse(readFileSync(new URL(`../spec/v4/examples/boss3d/${n}.json`, import.meta.url), 'utf8'));
const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());

test('boss3d capabilities are registered with the envelope', async () => {
  for (const n of ['boss3d.validate', 'boss3d.fairness', 'boss3d.simulate']) assert.ok(reg.has(n), n);
  const r = await call('boss3d.validate', { boss: ex('hydra') }); assert.equal(r.ok, true); assert.deepEqual(Object.keys(r).sort(), ['data', 'error', 'next', 'ok']); assert.ok(r.next.length);
});
test('boss3d.validate rejects bad input and structural errors', async () => {
  assert.equal((await call('boss3d.validate', {})).error.code, 'BAD_INPUT');
  assert.equal((await call('boss3d.validate', { file: 'nope.json' })).error.code, 'NOT_FOUND');
  const bad = ex('hydra'); bad.phases[0].attacks[0].zone.shape = 'blob'; const r = await call('boss3d.validate', { boss: bad });
  assert.equal(r.ok, false); assert.equal(r.error.code, 'BAD_INPUT'); assert.ok(r.error.details.some((e) => e.code === 'BAD_SHAPE'));
});
test('boss3d.validate reads a project file', async () => {
  const dir = mkdtempSync(join(SCRATCH, 'fboss-')); writeFileSync(join(dir, 'b.json'), JSON.stringify(ex('vortex')));
  const r = await call('boss3d.validate', { file: 'b.json', project: dir }); assert.equal(r.ok, true); assert.equal(r.data.stats.hazards, 3);
  writeFileSync(join(dir, 'x.json'), '{nope'); assert.equal((await call('boss3d.validate', { file: 'x.json', project: dir })).error.code, 'BAD_INPUT');
});
test('boss3d.fairness passes the examples and rejects a planted unfair boss', async () => {
  for (const n of ['hydra', 'vortex']) { const r = await call('boss3d.fairness', { boss: ex(n) }); assert.equal(r.ok, true, JSON.stringify(r.data?.findings)); assert.equal(r.data.pass, true); }
  const unfair = ex('hydra'); unfair.phases[0].attacks[0].windup = 0.12; unfair.phases[0].attacks[1].zone = { shape: 'circle', r: 40, at: 'target' }; unfair.phases[0].attacks[1].active = 1.0;
  const r = await call('boss3d.fairness', { boss: unfair }); assert.equal(r.ok, false); assert.equal(r.error.code, 'TASK_FAILED'); assert.equal(r.data.pass, false);
  const codes = r.data.findings.map((f) => f.code); assert.ok(codes.includes('TELEGRAPH_TOO_SHORT') && codes.includes('UNAVOIDABLE_ATTACK'), codes.join());
  assert.ok(r.next.length);
});
test('boss3d.fairness honours options (reaction floor, dodge profile)', async () => {
  const r = await call('boss3d.fairness', { boss: ex('hydra'), options: { reactionMs: 1000, simulate: false } }); assert.equal(r.ok, false);
  const slow = await call('boss3d.fairness', { boss: ex('hydra'), options: { moveSpeed: 1, dodge: { distance: 0.5 }, simulate: false } }); assert.equal(slow.ok, false);
});
test('boss3d.simulate reports stats and is deterministic', async () => {
  const a = await call('boss3d.simulate', { boss: ex('hydra'), runs: 8, seed: 4 }), b = await call('boss3d.simulate', { boss: ex('hydra'), runs: 8, seed: 4 });
  assert.equal(a.ok, true); assert.equal(a.data.hash, b.data.hash); assert.ok(a.data.winRate > 0 && a.data.timeToKill.mean > 0 && a.data.damageTaken.mean >= 0); assert.equal(a.data.results, undefined);
  const full = await call('boss3d.simulate', { boss: ex('vortex'), runs: 3, full: true, profile: { dodgeSkill: 0.5 } }); assert.equal(full.data.results.length, 3);
  assert.equal((await call('boss3d.simulate', { boss: ex('hydra'), runs: 0 })).error.code, 'BAD_INPUT');
});
