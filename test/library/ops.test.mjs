import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { addItems, addAssets, installAssets, verifyInstalled, publishLibrary, scanSecrets, newLibrary } from '../../factory-core/library/ops.mjs';
import { licenseSet } from '../../factory-core/library/license.mjs';
import { loadLibrary } from '../../factory-core/library/format.mjs';
import { mkLib, item, tmp, readJ, png } from './helpers.mjs';

test('add: idempotent, conflict without update, patch bump with update', () => {
  const d = mkLib('addt', [item('a')]);
  assert.deepEqual(addItems(d, [item('a')]).data.unchanged, ['a']);
  const changed = item('a', { files: [{ path: 'a.png', data: png(9) }] });
  assert.equal(addItems(d, [changed]).error.code, 'CONFLICT');
  const r = addItems(d, [changed], { update: true });
  assert.deepEqual(r.data.updated, ['a']);
  assert.equal(readJ(join(d, 'assets/a/asset.json')).version, '1.0.1');
  assert.equal(addItems(d, [item('bad id!')]).error.code, 'BAD_INPUT');
  assert.equal(addItems(d, [item('x', { files: [{ path: '../evil', data: Buffer.from('x') }] })]).error.code, 'BAD_INPUT');
});
test('add from files', async () => {
  const d = mkLib('addf', []), src = join(tmp(), 'boom.png'); writeFileSync(src, png(2));
  const r = await addAssets({ library: d, files: [{ path: src, tags: ['t:boom'] }] });
  assert.equal(r.ok, true); assert.deepEqual(r.data.added, ['boom']);
  assert.equal((await addAssets({ library: d })).error.code, 'BAD_INPUT');
});
test('add from a pixbuf-web style project (pawfall) when present', async (t) => {
  const pf = '/home/bill/src/fun/pawfall';
  if (!existsSync(join(pf, 'src/core/defs.js'))) return t.skip('pawfall not present');
  const d = mkLib('addpf', []);
  const r = await addAssets({ library: d, from: { project: pf, names: ['colby_run', 'step', 'title'], style: 'retro-8bit-sidescroller' } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.data.added.sort(), ['pawfall.colby-run', 'pawfall.sfx-step', 'pawfall.song-title']);
  const a = readJ(join(d, 'assets/pawfall.colby-run/asset.json'));
  assert.equal(a.type, 'character'); assert.deepEqual(a.size, { w: 16, h: 24, frames: 6 }); assert.ok(a.tags.includes('style:retro-8bit-sidescroller'));
  assert.equal(loadLibrary(d).errors.length, 0);
});
test('install copies, resolves dependencies, writes lock, verify passes; idempotent', () => {
  const d = mkLib('inst', [item('base'), item('top', { dependencies: [{ id: 'base' }] }), item('other')]);
  const proj = tmp('proj-');
  const r = installAssets({ library: d, project: proj, assets: ['top'] });
  assert.equal(r.ok, true, JSON.stringify(r.error)); assert.deepEqual(r.data.installed.sort(), ['base', 'top']);
  assert.ok(existsSync(join(proj, 'assets/library/base/base.png')) && !existsSync(join(proj, 'assets/library/other')));
  const lock = readJ(join(proj, 'assets.lock.json'));
  assert.equal(lock.lockVersion, 1); assert.equal(lock.assets.length, 2); assert.match(lock.assets[0].hash, /^[0-9a-f]{64}$/); assert.equal(lock.assets[0].library.name, 'inst');
  assert.equal(verifyInstalled({ project: proj }).ok, true);
  const before = readFileSync(join(proj, 'assets.lock.json'), 'utf8');
  assert.deepEqual(installAssets({ library: d, project: proj, assets: ['top'] }).data.unchanged.sort(), ['base', 'top']);
  assert.equal(readFileSync(join(proj, 'assets.lock.json'), 'utf8'), before);
  assert.equal(installAssets({ library: d, project: proj, assets: ['nope'] }).error.code, 'NOT_FOUND');
  assert.equal(installAssets({ library: d, project: proj, assets: ['top'], dest: '../out' }).error.code, 'BAD_INPUT');
});
test('install: tamper detection (modified, missing, lock edited), source tamper aborts, conflicts need yes', () => {
  const d = mkLib('tamp', [item('a'), item('b')]), proj = tmp('proj-');
  installAssets({ library: d, project: proj, all: true });
  writeFileSync(join(proj, 'assets/library/a/a.png'), 'changed');
  let v = verifyInstalled({ project: proj }); assert.equal(v.error.code, 'TAMPERED'); assert.match(JSON.stringify(v.data.problems), /modified/);
  assert.equal(installAssets({ library: d, project: proj, all: true }).error.code, 'CONFLICT');
  assert.equal(installAssets({ library: d, project: proj, all: true, yes: true }).ok, true);
  assert.equal(verifyInstalled({ project: proj }).ok, true);
  rmSync(join(proj, 'assets/library/b/b.png'));
  assert.match(JSON.stringify(verifyInstalled({ project: proj }).data.problems), /missing/);
  const lock = readJ(join(proj, 'assets.lock.json')); lock.assets[0].files[0].sha256 = 'f'.repeat(64); writeFileSync(join(proj, 'assets.lock.json'), JSON.stringify(lock));
  assert.equal(verifyInstalled({ project: proj }).ok, false);
  // a library whose file was modified after indexing refuses to install anything
  writeFileSync(join(d, 'assets/a/a.png'), 'evil');
  const p2 = tmp('proj-'); const r = installAssets({ library: d, project: p2, all: true });
  assert.equal(r.error.code, 'INVALID'); assert.equal(existsSync(join(p2, 'assets')), false); assert.equal(existsSync(join(p2, 'assets.lock.json')), false);
});
test('install rejects a hostile lock (path traversal) on verify, and a symlinked destination', () => {
  const proj = tmp('proj-');
  writeFileSync(join(proj, 'assets.lock.json'), JSON.stringify({ lockVersion: 1, assets: [{ id: 'x', version: '1.0.0', type: 'sprite', library: { name: 'l', version: '1.0.0' }, hash: '0'.repeat(64), dest: '../../etc', files: [{ path: 'passwd', sha256: '0'.repeat(64), bytes: 1 }] }] }));
  assert.match(JSON.stringify(verifyInstalled({ project: proj }).data.problems), /unsafe dest/);
  const d = mkLib('symdest', [item('a')]), p2 = tmp('proj-'), outside = tmp('out-');
  mkdirSync(join(p2, 'assets')); symlinkSync(outside, join(p2, 'assets/library'));
  const rs = installAssets({ library: d, project: p2, assets: ['a'] }); assert.equal(rs.error.code, 'UNSAFE'); assert.match(rs.error.message, /symlink/);
  assert.equal(existsSync(join(outside, 'a/a.png')), false);
});
test('install never executes code-kit content', () => {
  const marker = join(tmp(), 'ran'); const code = `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, '1');`;
  const d = mkLib('kit', [item('kit', { type: 'code-kit', files: [{ path: 'kit.mjs', data: Buffer.from(code) }], preview: undefined })]);
  const proj = tmp('proj-'); assert.equal(installAssets({ library: d, project: proj, assets: ['kit'] }).ok, true);
  assert.equal(existsSync(marker), false); assert.ok(existsSync(join(proj, 'assets/library/kit/kit.mjs')));
});
test('publish is confirm-first, scans secrets, and only calls gh with yes', () => {
  const d = mkLib('pub', [item('a')]), calls = [];
  const run = (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { status: 0, stdout: 'https://github.com/me/pub\n', stderr: '' }; };
  const r = publishLibrary({ library: d, repo: 'me/pub' }, run);
  assert.equal(r.error.code, 'CONFIRM_REQUIRED'); assert.equal(calls.length, 0); assert.equal(r.data.visibility, 'private'); assert.ok(r.data.commands.some((c) => c.startsWith('gh repo create me/pub')));
  writeFileSync(join(d, 'notes.txt'), 'token = "ghp_' + 'a'.repeat(36) + '"');
  assert.equal(publishLibrary({ library: d, repo: 'me/pub', yes: true }, run).error.code, 'SECRETS_FOUND'); assert.equal(calls.length, 0);
  writeFileSync(join(d, 'notes.txt'), 'ok'); writeFileSync(join(d, '.env'), 'A=1');
  assert.equal(scanSecrets(d)[0].reason, 'sensitive file name');
});
test('publish with yes runs git+gh through the injected runner only', async () => {
  const d = mkLib('pub2', [item('a')]), calls = [];
  const run = (cmd, args) => { calls.push([cmd, ...args].join(' ')); return { status: 0, stdout: 'https://github.com/me/pub2\n', stderr: '' }; };
  assert.equal(publishLibrary({ library: d, repo: 'me/pub2', yes: true, visibility: 'public' }, run).error.code, 'LICENSE_BLOCKED'); assert.equal(calls.length, 0); // v1 asset: license status unknown
  assert.equal(licenseSet({ library: d, id: 'a', status: 'verified', redistribute: true, confirm: true }).ok, true);
  const r = publishLibrary({ library: d, repo: 'me/pub2', yes: true, visibility: 'public' }, run);
  assert.equal(r.ok, true); assert.ok(calls.some((c) => /^gh repo create me\/pub2 --public/.test(c)));
  assert.equal(publishLibrary({ library: d, repo: 'bad repo; rm -rf', yes: true }, run).error.code, 'BAD_INPUT');
});
test('new: refuses non-empty dir and bad names; secrets in names are not templated', () => {
  const d = mkLib('nn', []);
  assert.equal(newLibrary({ name: 'nn', dir: d }).error.code, 'EXISTS');
  assert.equal(newLibrary({ name: '../x' }).error.code, 'BAD_INPUT');
  const r = newLibrary({ name: 'quoted', dir: join(tmp(), 'q'), description: 'he said "hi"\nnow' });
  assert.equal(r.ok, true); assert.equal(loadLibrary(r.data.dir).errors.length, 0);
});
