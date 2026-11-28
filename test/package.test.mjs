import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRegistry } from '../factory-core/registry.mjs';
import { registerPackage } from '../factory-core/package/capabilities.mjs';
import { tauriFiles, electronFiles, wailsFiles } from '../factory-core/package/generators.mjs';

const SCRATCH = process.env.FACTORY_TEST_TMP || (existsSync('/datanapps/claude-tmp') ? '/datanapps/claude-tmp' : tmpdir());
const tmp = () => mkdtempSync(join(existsSync(SCRATCH) ? SCRATCH : tmpdir(), 'pkg-'));
const w = (d, f, c = '') => { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), c); };
// stub: records calls; every probe passes unless listed in `missing`; build commands "produce" outputs via onBuild
function stubReg({ missing = [], onBuild } = {}) {
  const calls = [];
  const deps = { host: { os: 'linux', arch: 'x64' }, exec: async (cmd, args, o = {}) => {
    calls.push({ cmd, args, ...o });
    if (missing.includes(cmd) && ['--version', 'version'].includes(args[0])) return { code: 1, stdout: '', stderr: '', spawnError: 'ENOENT' };
    if (cmd === 'pkg-config') return { code: missing.includes('webkit') ? 1 : 0, stdout: '', stderr: '' };
    if (cmd === 'cargo' && args[0] === '--version') return { code: missing.includes('cargo') ? 1 : 0, stdout: '', stderr: '' };
    if (onBuild) await onBuild(cmd, args, o);
    return { code: 0, stdout: '', stderr: '' };
  } };
  return { reg: registerPackage(createRegistry(), deps), calls };
}
const webProj = () => { const d = tmp(); w(d, 'index.html', '<html></html>'); w(d, 'src/main.js', '//'); w(d, 'package.json', JSON.stringify({ name: 'My Game', version: '1.2.3' })); return d; };

test('generators: tauri v2 files are consistent', () => {
  const f = tauriFiles({ name: 'my-game', version: '1.2.3' });
  for (const k of ['src-tauri/Cargo.toml', 'src-tauri/build.rs', 'src-tauri/src/main.rs', 'src-tauri/tauri.conf.json', 'src-tauri/capabilities/default.json', 'src-tauri/icons/icon.png']) assert.ok(f[k], k);
  const conf = JSON.parse(f['src-tauri/tauri.conf.json']);
  assert.equal(conf.build.frontendDist, '../web'); assert.equal(conf.version, '1.2.3'); assert.equal(conf.app.windows[0].label, 'main');
  assert.deepEqual(JSON.parse(f['src-tauri/capabilities/default.json']).permissions, ['core:default']);
  assert.match(f['src-tauri/Cargo.toml'], /tauri-build = \{ version = "2"/); assert.match(f['src-tauri/Cargo.toml'], /custom-protocol/);
  assert.equal(f['src-tauri/icons/icon.png'].subarray(1, 4).toString(), 'PNG');
});
test('generators: electron and wails', () => {
  const e = electronFiles({ name: 'g', version: '0.1.0' });
  assert.equal(JSON.parse(e['package.json']).main, 'main.js'); assert.match(e['main.js'], /nodeIntegration: false/);
  const wl = wailsFiles({ name: 'g', version: '0.1.0' });
  assert.match(wl['main.go'], /go:embed all:frontend\/dist/); assert.match(wl['go.mod'], /wails\/v2 v/);
});

test('package.shells lists all shells with probes and honest size notes', async () => {
  const { reg } = stubReg({ missing: ['cargo'] });
  const r = await reg.call('package.shells', { project: webProj() });
  assert.ok(r.ok); const by = Object.fromEntries(r.data.shells.map((s) => [s.shell, s]));
  assert.deepEqual(Object.keys(by).sort(), ['electron', 'godot', 'go', 'neutralino', 'python', 'rust', 'tauri', 'wails'].sort());
  assert.equal(r.data.kind, 'web'); assert.equal(by.neutralino.default, true); assert.equal(by.tauri.available, false); assert.equal(by.rust.applicable, false);
  assert.match(by.electron.size, /NOT measured/); assert.equal(by.tauri.sizeMeasured, false);
});

test('standalone dryRun plans without writing or executing builds', async () => {
  const { reg, calls } = stubReg(); const d = webProj(); const o = join(tmp(), 'o');
  const r = await reg.call('package.standalone', { project: d, shell: 'tauri', out: o, dryRun: true });
  assert.ok(r.ok, JSON.stringify(r.error)); assert.deepEqual(r.data.artifacts, []);
  assert.equal(r.data.plan.base, 'my-game-1.2.3-linux-x64'); assert.ok(r.data.plan.generated.some((f) => f.replace(/\\/g, '/').endsWith('src-tauri/tauri.conf.json')));
  assert.equal(existsSync(o), false); assert.ok(!calls.some((c) => c.cmd === 'cargo' && c.args[0] === 'build'));
  const step = r.data.plan.steps.find((s) => s.id === 'cargo-build'); if (process.env.CARGO_TARGET_DIR) assert.equal(step.env.CARGO_TARGET_DIR, process.env.CARGO_TARGET_DIR); else assert.match(step.env.CARGO_TARGET_DIR, /cargo-target[\\/]my-game$/);
});

test('tauri with missing toolchain: SKIP with reason, generated dir written outside project', async () => {
  const { reg } = stubReg({ missing: ['webkit'] }); const d = webProj(); const o = join(tmp(), 'o');
  const r = await reg.call('package.standalone', { project: d, shell: 'tauri', out: o });
  assert.ok(r.ok); assert.equal(r.data.plan.status, 'SKIP'); assert.match(r.data.plan.skip, /webkit/);
  assert.ok(existsSync(join(o, '.build/tauri/src-tauri/Cargo.toml'))); assert.equal(existsSync(join(d, 'src-tauri')), false);
});

test('electron plan-only without network, warns about size', async () => {
  const { reg } = stubReg(); const r = await reg.call('package.standalone', { project: webProj(), shell: 'electron', out: join(tmp(), 'o'), dryRun: true });
  assert.equal(r.data.plan.status, 'SKIP'); assert.match(r.data.plan.skip, /network/); assert.ok(r.data.plan.warnings.some((x) => /85-110 MB/.test(x)));
});

test('go: cross-compile env, ldflags and archive + SHA256SUMS', async () => {
  const d = tmp(); w(d, 'go.mod', 'module x\n'); w(d, 'main.go', 'package main');
  const o = join(tmp(), 'o');
  const { reg, calls } = stubReg({ onBuild: (cmd, args) => { if (cmd === 'go' && args[0] === 'build') { const f = args[args.indexOf('-o') + 1]; mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, 'bin'); } } });
  const r = await reg.call('package.standalone', { project: d, platform: 'linux-x64', version: '2.0.0', out: o });
  assert.ok(r.ok, JSON.stringify(r.error));
  const b = calls.find((c) => c.cmd === 'go' && c.args[0] === 'build');
  assert.deepEqual(b.args.slice(0, 4), ['build', '-trimpath', '-ldflags', '-s -w']); assert.equal(b.env.CGO_ENABLED, '0'); assert.equal(b.env.GOARCH, 'amd64');
  assert.equal(r.data.artifacts.length, 1); assert.match(r.data.artifacts[0].path, /-2\.0\.0-linux-x64\.tar\.gz$/); assert.match(r.data.artifacts[0].sha256, /^[0-9a-f]{64}$/);
  assert.ok(readFileSync(join(o, 'SHA256SUMS'), 'utf8').includes(r.data.artifacts[0].sha256));
  // reproducible: second run gives the same hash
  const r2 = await reg.call('package.standalone', { project: d, platform: 'linux-x64', version: '2.0.0', out: o });
  assert.equal(r2.data.artifacts[0].sha256, r.data.artifacts[0].sha256);
  const rw = await reg.call('package.standalone', { project: d, platform: 'win-x64', version: '2.0.0', out: o, dryRun: true });
  assert.equal(rw.data.plan.steps[0].env.GOOS, 'windows'); assert.match(rw.data.plan.steps[0].args.at(-2), /\.exe$/);
});

test('rust plan: profile env, cargo target dir default, cross target', async () => {
  const d = tmp(); w(d, 'Cargo.toml', '[package]\nname = "zed"\nversion = "0.1.0"\n');
  const { reg } = stubReg(); const r = await reg.call('package.standalone', { project: d, platform: 'win-x64', dryRun: true });
  const s = r.data.plan.steps[0]; assert.ok(s.args.includes('--target') && s.args.includes('x86_64-pc-windows-msvc'));
  assert.equal(s.env.CARGO_PROFILE_RELEASE_STRIP, 'true'); assert.ok(s.env.CARGO_TARGET_DIR); assert.match(r.data.plan.profileAdvice, /lto = true/);
});

test('godot wraps tools/build.sh; python gives a pyinstaller plan with nuitka alternative', async () => {
  const g = tmp(); w(g, 'game/project.godot'); w(g, 'tools/build.sh', '#!/bin/sh');
  const { reg } = stubReg(); const r = await reg.call('package.standalone', { project: g, platform: 'linux-x64', dryRun: true });
  assert.equal(r.data.plan.shell, 'godot'); assert.deepEqual(r.data.plan.steps[0].args.slice(-1), ['linux']);
  const p = tmp(); w(p, 'main.py', 'print(1)');
  const rp = await reg.call('package.standalone', { project: p, dryRun: true });
  assert.equal(rp.data.plan.shell, 'python'); assert.ok(rp.data.plan.steps[0].args.includes('PyInstaller')); assert.ok(rp.data.plan.alternatives.nuitka.includes('nuitka'));
});

test('neutralino wraps project tools/package-desktop.mjs, SKIP if absent', async () => {
  const d = webProj(); const { reg } = stubReg();
  const a = await reg.call('package.standalone', { project: d, dryRun: true }); assert.equal(a.data.plan.shell, 'neutralino'); assert.equal(a.data.plan.status, 'SKIP');
  w(d, 'tools/package-desktop.mjs'); const b = await reg.call('package.standalone', { project: d, dryRun: true });
  assert.equal(b.data.plan.status, 'READY'); assert.deepEqual(b.data.plan.steps[0].args.slice(1, 3), ['--platform', 'linux']);
});

test('BAD_INPUT paths', async () => {
  const { reg } = stubReg(); const d = webProj();
  const bad = async (i) => (await reg.call('package.standalone', i)).error?.code;
  assert.equal(await bad({}), 'BAD_INPUT'); assert.equal(await bad({ project: d, shell: 'bogus' }), 'BAD_INPUT');
  assert.equal(await bad({ project: d, shell: 'go' }), 'BAD_INPUT'); assert.equal(await bad({ project: d, platform: 'amiga-m68k' }), 'BAD_INPUT');
  assert.equal(await bad({ project: d, version: '1; rm -rf /' }), 'BAD_INPUT'); assert.equal(await bad({ project: join(d, 'nope') }), 'NOT_FOUND');
  assert.equal(await bad({ project: tmp() }), 'BAD_INPUT'); assert.equal(await bad({ project: d, out: '/' }), 'BAD_INPUT');
  assert.equal(await bad({ project: d, extra: 1 }), 'BAD_INPUT');
});
