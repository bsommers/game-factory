import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../factory-core/index.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => { mkdirSync(SCRATCH, { recursive: true }); return mkdtempSync(join(SCRATCH, 'fgexp-')); };
const reg = buildRegistry(), call = (n, i) => reg.call(n, i);
const TEMPLATE = fileURLToPath(new URL('../templates/godot-action3d/', import.meta.url));
const det = await call('godot.detect', {}), have = det.data.installed;
const st = have ? await call('godot.export-templates', {}) : null;

test('godot.export-templates reports status without downloading', { skip: have ? false : 'Godot not installed' }, () => {
  assert.ok(st.ok); assert.match(st.data.version, /^\d+\.\d+/); assert.equal(typeof st.data.installed, 'boolean'); assert.match(st.data.url, /^https:\/\/github\.com\/godotengine\/godot\/releases\/download\//);
});
test('godot.export-templates unpacks a local .tpz (fromFile) into a templatesDir', { skip: have ? false : 'Godot not installed' }, async () => {
  const w = tmp(), ver = st.data.version;
  try {
    mkdirSync(join(w, 'src/templates'), { recursive: true });
    writeFileSync(join(w, 'src/templates/version.txt'), ver + '\n'); writeFileSync(join(w, 'src/templates/linux_release.x86_64'), 'x');
    execFileSync('zip', ['-qr', join(w, 't.tpz'), 'templates'], { cwd: join(w, 'src') });
    const r = await call('godot.export-templates', { install: true, fromFile: join(w, 't.tpz'), templatesDir: join(w, 'dest') });
    assert.ok(r.ok, JSON.stringify(r)); assert.equal(r.data.installed, true); assert.ok(existsSync(join(w, 'dest', ver, 'linux_release.x86_64')));
    writeFileSync(join(w, 'src/templates/version.txt'), '0.0.0.stable\n'); execFileSync('zip', ['-qr', join(w, 'bad.tpz'), 'templates'], { cwd: join(w, 'src') });
    const bad = await call('godot.export-templates', { install: true, fromFile: join(w, 'bad.tpz'), templatesDir: join(w, 'dest2') });
    assert.equal(bad.ok, false); assert.equal(bad.error.code, 'BAD_INPUT');
  } finally { rmSync(w, { recursive: true, force: true }); }
});
test('template export_presets.cfg defines Linux x86_64 and Web', async () => {
  const w = tmp();
  try {
    cpSync(TEMPLATE, w, { recursive: true });
    const r = await call('godot.export', { project: w, preset: 'Nope' });
    assert.equal(r.ok, false); if (have) assert.equal(r.error.code, 'BAD_INPUT'); assert.ok(r.error);
    for (const n of ['Linux x86_64', 'Web']) assert.match(execFileSync('cat', [join(w, 'export_presets.cfg')], { encoding: 'utf8' }), new RegExp(`name="${n}"`));
  } finally { rmSync(w, { recursive: true, force: true }); }
});
test('godot.export: real Linux export smoke', { skip: !have ? 'Godot not installed' : !st.data.installed ? `export templates ${st?.data.version} not installed (godot.export-templates {install:true}); real export NOT verified` : false, timeout: 600000 }, async () => {
  const w = tmp();
  try {
    cpSync(TEMPLATE, w, { recursive: true });
    const r = await call('godot.export', { project: w, preset: 'Linux x86_64' });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.ok(r.data.bytes > 1e6, 'exported binary should embed the engine');
  } finally { rmSync(w, { recursive: true, force: true }); }
});
