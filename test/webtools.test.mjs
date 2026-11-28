import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buildRegistry } from '../factory-core/index.mjs';

const MM = process.env.MICROMAZE_DIR || new URL('../../micromaze', import.meta.url).pathname;
const have = existsSync(MM + '/tools/botplay.mjs');
const r = buildRegistry();

test('web.* capabilities are registered with schemas', () => {
  for (const n of ['web.validate-level', 'web.botplay', 'web.sheet', 'web.verify', 'web.serve']) assert.ok(r.has(n), n);
});
test('unknown project / bad input fail cleanly', async () => {
  assert.equal((await r.call('web.validate-level', { project: '/nonexistent-x', file: 'a.json' })).error.code, 'NOT_FOUND');
  assert.equal((await r.call('web.validate-level', {})).error.code, 'BAD_INPUT');
  assert.equal((await r.call('web.sheet', { project: '.', module: '../x' })).ok, false);
  assert.equal((await r.call('web.botplay', { project: MM, level: 'a b' })).ok, false);
});
test('web.serve is plan-only without yes', async () => {
  if (!have) return;
  const x = await r.call('web.serve', { project: MM, port: 4999 });
  assert.equal(x.ok, true); assert.equal(x.data.started, false); assert.equal(x.data.plan.url, 'http://127.0.0.1:4999/');
});
test('against micromaze: validate-level, botplay, sheet', { skip: !have }, async () => {
  const v = await r.call('web.validate-level', { project: MM, file: 'src/levels/store01.json' });
  assert.equal(v.ok, true, JSON.stringify(v));
  const bad = await r.call('web.validate-level', { project: MM, file: 'package.json' });
  assert.equal(bad.ok, false);
  const b = await r.call('web.botplay', { project: MM, level: 'store01', seeds: [1, 2, 3] });
  assert.equal(b.data.total, 3); assert.ok(b.data.rows.every((x) => typeof x.win === 'boolean'));
  const s = await r.call('web.sheet', { project: MM, module: 'characters', out: 'out/previews' });
  assert.ok(s.data && 'problems' in s.data, JSON.stringify(s).slice(0, 300));
});
