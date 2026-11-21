import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyStyle } from '../../factory-core/styles/index.mjs';
import { capabilities, registerStyles } from '../../factory-core/styles/capabilities.mjs';
import { validateSchema } from '../../factory-core/styles/schema.mjs';

// scratch under CLAUDE_CODE_TMPDIR / os tmpdir (set to disk on this machine)
const proj = () => mkdtempSync(join(process.env.CLAUDE_CODE_TMPDIR || tmpdir(), 'styles-apply-'));
const snapshot = (d) => { const o = {}; const w = (p) => { for (const f of readdirSync(p)) { const q = join(p, f); statSync(q).isDirectory() ? w(q) : (o[q] = readFileSync(q, 'utf8')); } }; w(d); return o; };

test('apply writes style, theme and config; lists installs', () => {
  const d = proj();
  const r = applyStyle({ project: d, style: 'retro-8bit-sidescroller', theme: 'jungle' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.written.sort(), ['config/style.json', 'config/theme.json', 'factory.config.json']);
  assert.equal(JSON.parse(readFileSync(join(d, 'factory.config.json'), 'utf8')).style.theme, 'jungle');
  assert.ok(r.data.install.kits.includes('art-kit'));
  assert.deepEqual(r.data.install.missingKits.length, 4);
  assert.deepEqual(r.data.libraryTags, ['style:retro-8bit-sidescroller']);
});
test('apply is idempotent', () => {
  const d = proj();
  applyStyle({ project: d, style: 'ascii-terminal', theme: 'space' });
  const before = snapshot(d);
  const r = applyStyle({ project: d, style: 'ascii-terminal', theme: 'space' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.written, []);
  assert.equal(r.data.unchanged.length, 3);
  assert.deepEqual(snapshot(d), before);
});
test('apply refuses to overwrite differing files without yes, and changes nothing', () => {
  const d = proj();
  applyStyle({ project: d, style: 'retro-8bit-sidescroller' });
  const before = snapshot(d);
  const r = applyStyle({ project: d, style: 'top-down-arcade' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'CONFLICT');
  assert.ok(r.error.details.conflicts.includes('config/style.json'));
  assert.deepEqual(snapshot(d), before);
  const r2 = applyStyle({ project: d, style: 'top-down-arcade', yes: true });
  assert.equal(r2.ok, true);
  assert.equal(JSON.parse(readFileSync(join(d, 'config/style.json'), 'utf8')).id, 'top-down-arcade');
});
test('apply preserves unrelated keys in factory.config.json and user files', () => {
  const d = proj();
  writeFileSync(join(d, 'factory.config.json'), JSON.stringify({ name: 'mine', port: 9 }));
  mkdirSync(join(d, 'src')); writeFileSync(join(d, 'src', 'main.js'), 'keep');
  const r = applyStyle({ project: d, style: 'retro-16bit' });
  assert.equal(r.ok, true);
  const cfg = JSON.parse(readFileSync(join(d, 'factory.config.json'), 'utf8'));
  assert.equal(cfg.name, 'mine'); assert.equal(cfg.port, 9); assert.equal(cfg.style.id, 'retro-16bit');
  assert.equal(readFileSync(join(d, 'src', 'main.js'), 'utf8'), 'keep');
});
test('dryRun writes nothing; bad inputs give structured errors', () => {
  const d = proj();
  const r = applyStyle({ project: d, style: 'lowpoly-3d', dryRun: true });
  assert.equal(r.ok, true); assert.ok(r.data.written.length >= 2);
  assert.deepEqual(readdirSync(d), []);
  assert.equal(applyStyle({ project: d, style: 'nope' }).error.code, 'NOT_FOUND');
  assert.equal(applyStyle({ project: join(d, 'missing'), style: 'lowpoly-3d' }).error.code, 'NO_PROJECT');
  assert.equal(applyStyle({ project: d, style: 'raycaster-fps', theme: 'jungle' }).error.code, 'INVALID_THEME');
  assert.equal(applyStyle({ style: 'x' }).error.code, 'BAD_INPUT');
});
test('apply with invalid existing factory.config.json fails safely', () => {
  const d = proj(); writeFileSync(join(d, 'factory.config.json'), '{nope');
  assert.equal(applyStyle({ project: d, style: 'retro-16bit' }).error.code, 'BAD_CONFIG');
  assert.equal(existsSync(join(d, 'config')), false);
});

test('capabilities: registry format, schemas, and uniform result envelope', () => {
  assert.deepEqual(capabilities.map((c) => c.name), ['styles.list', 'styles.show', 'styles.recommend', 'styles.apply', 'styles.validate']);
  for (const c of capabilities) {
    assert.equal(typeof c.handler, 'function'); assert.equal(c.inputSchema.type, 'object'); assert.ok(c.summary.length > 20);
  }
  const call = (n, i) => capabilities.find((c) => c.name === n).handler(i);
  const list = call('styles.list', {});
  assert.equal(list.ok, true); assert.equal(list.data.styles.length, 11);
  assert.equal(call('styles.list', { dimension: '3d' }).data.styles.length, 3);
  assert.equal(call('styles.show', { id: 'raycaster-fps' }).data.style.id, 'raycaster-fps');
  assert.equal(call('styles.show', { id: 'zzz' }).error.code, 'NOT_FOUND');
  assert.equal(call('styles.recommend', { idea: 'duum clone, first person' }).data.ranked[0].id, 'raycaster-fps');
  assert.equal(call('styles.recommend', {}).ok, false);
  assert.equal(call('styles.validate', {}).ok, true);
  assert.equal(call('styles.validate', { file: '/nonexistent.json' }).error.code, 'BAD_INPUT');
  // inputs are checkable with the shared validator
  const rec = capabilities.find((c) => c.name === 'styles.recommend').inputSchema;
  assert.deepEqual(validateSchema(rec, { idea: 'x', constraints: { budget: 'low' } }), []);
  assert.ok(validateSchema(rec, { idea: 'x', constraints: { budget: 'bogus' } }).length);
  const arr = registerStyles([]); assert.equal(arr.length, 5);
  const map = registerStyles(new Map()); assert.ok(map.has('styles.apply'));
});
