import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../factory-core/index.mjs';
import * as AI from '../templates/web-project/src/lib/ai3d.js';

// GDScript ai3d core (templates/godot-action3d/scripts/ai3d) vs the JS reference on the 4 example scenarios (hash + decision timeline).
// UPDATE_PARITY=1 regenerates spec/v4/parity/ai3d/*.json `expected` from the JS reference.
const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fagd-'));
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const det = await call('godot.detect', {}), skip = det.data.installed ? false : 'Godot not installed (see docs/GODOT.md)';
const PARITY = fileURLToPath(new URL('../spec/v4/parity/', import.meta.url)), TEMPLATE = fileURLToPath(new URL('../templates/godot-action3d/', import.meta.url));
const NAMES = ['grunt', 'ranged', 'charger', 'group-token'];

test('ai3d parity scenarios mirror the shipped examples and the JS reference reproduces their expected output', () => {
  for (const n of NAMES) {
    const p = join(PARITY, 'ai3d', `${n}.json`), doc = JSON.parse(readFileSync(p, 'utf8')), ex = JSON.parse(readFileSync(new URL(`../spec/v4/examples/ai3d/${n}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(doc.scenario, ex, `${n}: scenario drifted from spec/v4/examples/ai3d/${n}.json`);
    const got = AI.simulate(doc.scenario);
    if (process.env.UPDATE_PARITY) { writeFileSync(p, JSON.stringify({ ...doc, expected: got }) + '\n'); continue; }
    assert.deepEqual(got, doc.expected, `${n}: JS output drifted (UPDATE_PARITY=1 to regenerate)`);
    assert.match(doc.expected.hash, /^[0-9a-f]{8}$/); assert.ok(doc.expected.timeline.length > 3);
  }
  const o = { rng: 1 }; assert.deepEqual(JSON.parse(readFileSync(join(PARITY, 'ai3d', 'units.json'), 'utf8')).rng1, [AI.rngNext(o), AI.rngNext(o), AI.rngNext(o)]);
});
test('godot: ai3d core reproduces the JS hash and decision timeline on all 4 scenarios', { skip }, async () => {
  const d = tmp(); cpSync(TEMPLATE, d, { recursive: true, filter: (s) => !/[\\/]\.godot([\\/]|$)/.test(s) });
  writeFileSync(join(d, 'project.godot'), readFileSync(join(d, 'project.godot'), 'utf8').replace('__NAME__', 'T'));
  process.env.PARITY_DIR = PARITY.replace(/[\\/]$/, '');
  const r = await call('godot.test', { project: d, runner: 'res://tests/run_ai3d.gd', timeoutMs: 600000 });
  delete process.env.PARITY_DIR;
  assert.equal(r.ok, true, JSON.stringify(r.error) + (r.data?.output || '')); assert.equal(r.data.failed, 0);
  for (const n of ['grunt', 'ranged', 'charger', 'group_token']) assert.ok(r.data.tests.some((t) => t.name.includes(`${n}_parity`) && t.status === 'pass'), n);
});
