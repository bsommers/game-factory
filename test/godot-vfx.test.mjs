import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildRegistry } from '../factory-core/index.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const det = await call('godot.detect', {});
const skip = det.data.installed ? false : 'Godot not installed (see docs/GODOT.md)';
const skipShot = skip || (det.data.screenshots ? false : 'no display/xvfb');
const project = () => { const d = mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'fvfx-g-')); cpSync(new URL('../templates/godot-action3d/', import.meta.url), d, { recursive: true }); writeFileSync(join(d, 'project.godot'), readFileSync(join(d, 'project.godot'), 'utf8').replace('__NAME__', 'T')); return d; };
const SCENES = ['whirlpool', 'flood_water', 'toxic_sludge', 'fire', 'steam_vent', 'hit_spark'];

test('committed vfx screenshots exist and are non-trivial PNGs', () => {
  for (const n of SCENES) { const p = new URL(`../docs/screens/vfx/${n}.png`, import.meta.url); assert.ok(existsSync(p), n); const b = readFileSync(p); assert.equal(b.subarray(1, 4).toString(), 'PNG'); assert.ok(b.length > 4000 && b.length < 400000, `${n} ${b.length} bytes`); }
});
test('vfx GDScript tests pass (loader, JS parity)', { skip }, async () => {
  const r = await call('godot.test', { project: project(), runner: 'res://tests/run_vfx.gd' });
  assert.equal(r.ok, true, JSON.stringify(r.error) + (r.data?.output || '')); assert.ok(r.data.passed >= 5 && r.data.failed === 0);
});
test('every preview scene renders something (not just the background)', { skip: skipShot }, async () => {
  const d = project();
  for (const n of SCENES) {
    const png = join(d, `${n}.png`), r = await call('godot.shot', { project: d, scene: `res://vfx/scenes/preview_${n}.tscn`, out: png, frames: 20, size: '320x180' });
    assert.equal(r.ok, true, `${n}: ${JSON.stringify(r.error)}`); assert.equal(r.data.width, 320); assert.ok(statSync(png).size > 2500, `${n}: image looks blank (${statSync(png).size} bytes)`);
  }
});
