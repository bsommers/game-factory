import test from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../spec/verify-vectors.mjs';
import { buildAll } from '../spec/gen-vectors.mjs';

test('spec vectors match the JS reference (no drift)', () => {
  assert.deepEqual(verify(), []);
});
test('vector generation is deterministic and sized 20-60 cases', () => {
  const a = buildAll(), b = buildAll();
  assert.deepEqual(a, b);
  for (const [engine, text] of Object.entries(a)) { const n = JSON.parse(text).cases.length; assert.ok(n >= 20 && n <= 60, `${engine}: ${n}`); }
});
