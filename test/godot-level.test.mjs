import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const det = await call('godot.detect', {});
const skip = det.data.installed ? false : 'Godot not installed (see docs/GODOT.md)';
const TPL = new URL('../templates/godot-action3d/', import.meta.url);

test('godot level fixtures stay identical to the spec examples', () => {
  for (const n of ['arena-towers', 'river-arena', 'tutorial-yard']) assert.equal(readFileSync(new URL(`tests/level/fixtures/${n}.json`, TPL), 'utf8'), readFileSync(new URL(`../spec/v4/examples/level3d/${n}.json`, import.meta.url), 'utf8'), n);
  assert.ok(existsSync(new URL('scripts/level/level_loader.gd', TPL)) && existsSync(new URL('tests/run_level.gd', TPL)));
});
test('level_loader.gd builds the levels headless (collision, volumes, spawns, signals)', { skip, timeout: 240000 }, async () => {
  const d = mkdtempSync(join(SCRATCH, 'fgodot-lv-')); cpSync(TPL, d, { recursive: true });
  writeFileSync(join(d, 'project.godot'), readFileSync(join(d, 'project.godot'), 'utf8').replace('__NAME__', 'LevelT'));
  const r = await call('godot.test', { project: d, runner: 'res://tests/run_level.gd', timeoutMs: 200000 });
  assert.equal(r.ok, true, JSON.stringify(r.error) + '\n' + (r.data?.output || '').slice(-1500));
  assert.equal(r.data.failed, 0); assert.ok(r.data.passed >= 5, `passed ${r.data.passed}`);
});
