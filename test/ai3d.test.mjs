import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const EX = 'spec/v4/examples/ai3d/';

test('ai3d capabilities are registered with envelope output', () => {
  for (const n of ['ai3d.validate', 'ai3d.simulate']) assert.ok(reg.has(n), n);
});
test('ai3d.validate accepts every example scenario', async () => {
  for (const f of ['grunt', 'ranged', 'charger', 'group-token']) { const r = await call('ai3d.validate', { file: `${EX}${f}.json` }); assert.equal(r.ok, true, JSON.stringify(r.error)); assert.equal(r.data.kind, 'scenario'); }
});
test('ai3d.validate accepts a bare config, and reports paths for bad ones', async () => {
  const sc = JSON.parse((await import('node:fs')).readFileSync(`${EX}grunt.json`, 'utf8'));
  const good = await call('ai3d.validate', { config: sc.configs.grunt }); assert.equal(good.ok, true); assert.equal(good.data.kind, 'config');
  const bad = await call('ai3d.validate', { config: { tree: { type: 'action', do: 'attack', move: 'nope' } } });
  assert.equal(bad.ok, false); assert.equal(bad.error.code, 'BAD_INPUT'); assert.ok(bad.error.details.some((d) => d.includes('unknown move')));
  const ref = await call('ai3d.validate', { scenario: { ...sc, agents: [{ id: 'x', config: 'ghost', pos: [0, 0, 0] }] } }); assert.equal(ref.ok, false); assert.ok(ref.error.details.some((d) => d.includes('ghost')));
});
test('ai3d.validate input errors: none/many sources, missing file, bad json', async () => {
  assert.equal((await call('ai3d.validate', {})).error.code, 'BAD_INPUT');
  assert.equal((await call('ai3d.validate', { config: {}, file: 'x' })).error.code, 'BAD_INPUT');
  assert.equal((await call('ai3d.validate', { file: 'nope.json' })).error.code, 'NOT_FOUND');
  const d = mkdtempSync(join(SCRATCH, 'fai3d-')); writeFileSync(join(d, 'b.json'), '{oops');
  assert.equal((await call('ai3d.validate', { file: 'b.json', project: d })).error.code, 'BAD_INPUT');
  assert.equal((await call('ai3d.validate', { bogus: 1 })).error.code, 'BAD_INPUT', 'schema rejects unknown property');
});
test('ai3d.simulate returns a timeline and a stable hash; overrides work; truncation flagged', async () => {
  const a = await call('ai3d.simulate', { file: `${EX}group-token.json` }), b = await call('ai3d.simulate', { file: `${EX}group-token.json` });
  assert.equal(a.ok, true); assert.equal(a.data.hash, b.data.hash); assert.ok(a.data.timeline.length > 5); assert.ok(a.data.stats.maxTokens <= 2);
  const c = await call('ai3d.simulate', { file: `${EX}charger.json`, duration: 3 }); assert.equal(c.data.duration, 3); assert.equal(c.data.steps, 180);
  const t = await call('ai3d.simulate', { file: `${EX}group-token.json`, limit: 3 }); assert.equal(t.data.timeline.length, 3); assert.equal(t.data.truncated, true); assert.ok(t.data.timelineTotal > 3);
  const s1 = await call('ai3d.simulate', { file: `${EX}charger.json`, seed: 1 }), s2 = await call('ai3d.simulate', { file: `${EX}charger.json`, seed: 2 }); assert.equal(s1.ok && s2.ok, true);
});
test('ai3d.simulate rejects a bare config and invalid scenarios', async () => {
  assert.equal((await call('ai3d.simulate', { config: { tree: { type: 'action', do: 'idle' } } })).error.code, 'BAD_INPUT');
  const sc = JSON.parse((await import('node:fs')).readFileSync(`${EX}grunt.json`, 'utf8')); sc.duration = 0;
  assert.equal((await call('ai3d.simulate', { scenario: sc })).error.code, 'BAD_INPUT');
});
