import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { registryAdd, registryRemove, registryRefresh, registrySearch, registryShow, registryList, parseSource, resolveLibraryDir } from '../../factory-core/library/registry.mjs';
import { installAssets } from '../../factory-core/library/ops.mjs';
import { capabilities, registerLibrary } from '../../factory-core/library/capabilities.mjs';
import { validateSchema } from '../../factory-core/library/schema-lite.mjs';
import { mkLib, item, tmp, png, readJ } from './helpers.mjs';

const home = () => ({ home: join(tmp('reghome-'), 'h') });
// fake "git clone": copies a prepared directory into the destination argument
const fakeClone = (srcs) => (cmd, args) => {
  if (cmd !== 'git' && cmd !== 'gh') return { status: 1 };
  const url = args.find((a) => /github\.com\//.test(a)) || args[args.indexOf('clone') + 1], dest = cmd === 'git' ? args[args.length - 1] : args[3];
  const key = Object.keys(srcs).find((k) => (url || '').includes(k) || args.includes(k));
  if (!key) return { status: 128, stderr: 'fatal: repository not found' };
  cpSync(srcs[key], dest, { recursive: true }); mkdirSync(join(dest, '.git'), { recursive: true }); writeFileSync(join(dest, '.git/HEAD'), 'ref');
  return { status: 0, stdout: '', stderr: '' };
};

test('parseSource: github, local, and rejected forms', () => {
  assert.deepEqual(parseSource('me/lib@v1.2'), { kind: 'github', owner: 'me', repo: 'lib', ref: 'v1.2' });
  assert.equal(parseSource('me/lib').ref, null);
  assert.equal(parseSource('/abs/dir').kind, 'local'); assert.equal(parseSource('./rel').kind, 'local'); assert.equal(parseSource('path:foo/bar').kind, 'local');
  for (const bad of ['https://evil.example/x.git', 'me/lib@../../x', '', 'me/lib@-x', 'a/b/c']) assert.equal(parseSource(bad), null, bad);
  assert.equal(parseSource('https://evil.example/x.git'), null);
});
test('add/list/remove; duplicate source idempotent; id clash conflicts', () => {
  const h = home(), d = mkLib('alpha', [item('a')]);
  assert.equal(registryAdd({ ...h, source: d }).data.id, 'alpha');
  assert.equal(registryAdd({ ...h, source: d }).data.unchanged, true);
  assert.equal(registryAdd({ ...h, source: join(tmp(), 'alpha') }).error.code, 'CONFLICT');
  assert.equal(registryAdd({ ...h, source: 'me/repo@main' }).data.id, 'repo');
  assert.equal(registryList(h).data.libraries.length, 2);
  assert.equal(registryAdd({ ...h, source: 'https://x.y/z' }).error.code, 'BAD_INPUT');
  assert.equal(registryRemove({ ...h, id: 'repo' }).ok, true); assert.equal(registryRemove({ ...h, id: 'repo' }).error.code, 'NOT_FOUND');
});
test('merge, search filters, conflicts and duplicates across libraries', () => {
  const h = home();
  const same = item('shared'), diffA = item('clash', { tags: ['style:x', 'jungle'] }), diffB = item('clash', { files: [{ path: 'clash.png', data: png(9) }], tags: ['style:y'] });
  const a = mkLib('liba', [same, diffA, item('only-a', { type: 'fx', tags: ['sparkle'] })], { license: 'MIT' });
  const b = mkLib('libb', [same, diffB, item('song1', { type: 'song', duration: 3, tags: ['music', 'jungle'], files: [{ path: 's.wav', data: Buffer.from('RIFF') }] })], { license: 'CC-BY-4.0' });
  registryAdd({ ...h, source: a }); registryAdd({ ...h, source: b });
  const r = registryRefresh(h); assert.equal(r.ok, true); assert.equal(r.data.assets, 6);
  assert.deepEqual(r.data.conflicts.map((c) => [c.id, c.kind]).sort(), [['clash', 'conflict'], ['shared', 'duplicate']]);
  const s = (q) => registrySearch({ ...h, ...q }).data;
  assert.equal(s({ type: 'song' }).total, 1);
  assert.equal(s({ tag: 'jungle' }).total, 2);
  assert.equal(s({ tag: ['jungle', 'music'] }).total, 1);
  assert.equal(s({ license: 'mit' }).results.every((x) => x.library === 'liba'), true);
  assert.equal(s({ library: 'libb' }).total, 3);
  assert.equal(s({ query: 'sparkle' }).results[0].id, 'only-a');
  assert.equal(s({ query: 'nothing-matches-this' }).total, 0);
  assert.equal(s({ query: 'clash' }).results.every((x) => x.conflict), true);
  const sh = registryShow({ ...h, id: 'clash' }); assert.equal(sh.data.matches.length, 2); assert.equal(sh.data.conflicts[0].kind, 'conflict');
  assert.equal(registryShow({ ...h, id: 'libb:clash' }).data.matches.length, 1);
  assert.equal(registryShow({ ...h, id: 'zzz' }).error.code, 'NOT_FOUND');
  // two libraries with the same manifest name
  const c = mkLib('liba', [item('c1')]); registryAdd({ ...h, source: c, id: 'liba2' });
  assert.ok(registryRefresh(h).data.conflicts.some((x) => x.kind === 'library-name'));
});
test('remote fetch via injected git: clone, validate, cache; offline uses cache; failures keep old cache', () => {
  const h = home(), remote = mkLib('remotelib', [item('r1', { tags: ['remote'] })]);
  registryAdd({ ...h, source: 'someone/remotelib@main' });
  assert.equal(registryRefresh({ ...h, offline: true }).data.libraries[0].status, 'not-fetched');
  assert.equal(registrySearch({ ...h, offline: true }).data.total, 0);
  const r = registryRefresh({ ...h, exec: fakeClone({ 'someone/remotelib': remote }) });
  assert.equal(r.data.libraries[0].status, 'ok'); assert.ok(!existsSync(join(h.home, 'cache/remotelib/.git')), '.git stripped');
  assert.equal(registrySearch({ ...h, offline: true, tag: 'remote' }).data.total, 1);
  const f = registryRefresh({ ...h, exec: () => ({ status: 128, stderr: 'network down' }) });
  assert.equal(f.data.libraries[0].status, 'stale'); assert.match(f.data.libraries[0].error, /fetch failed/);
  assert.equal(registrySearch({ ...h, offline: true }).data.total, 1, 'stale cache still searchable');
  // install straight from a registered, cached library
  const proj = tmp('proj-'); const i = installAssets({ ...h, registryId: 'remotelib', project: proj, assets: ['r1'], source: 'someone/remotelib@main' });
  assert.equal(i.ok, true, JSON.stringify(i.error)); assert.equal(readJ(join(proj, 'assets.lock.json')).assets[0].library.source, 'someone/remotelib@main');
  assert.equal(resolveLibraryDir('nope', h).error.code, 'NOT_FOUND');
});
test('hostile remote libraries are rejected and never cached', () => {
  const h = home();
  const evil = mkLib('evil', [item('a')]); symlinkSync('/etc/passwd', join(evil, 'assets/a/pw.png'));
  const trav = mkLib('trav', [item('a')]); const dj = readJ(join(trav, 'assets/a/asset.json')); dj.files[0].path = '../../library.json'; writeFileSync(join(trav, 'assets/a/asset.json'), JSON.stringify(dj));
  const junk = join(tmp(), 'junk'); mkdirSync(junk); writeFileSync(join(junk, 'library.json'), '{"name":"x"}');
  for (const [n, d] of [['evil', evil], ['trav', trav], ['junk', junk]]) registryAdd({ ...h, source: `bad/${n}` });
  const r = registryRefresh({ ...h, exec: fakeClone({ 'bad/evil': evil, 'bad/trav': trav, 'bad/junk': junk }) });
  assert.deepEqual(r.data.libraries.map((l) => l.status), ['invalid', 'invalid', 'invalid'].map((_, k) => r.data.libraries[k].status));
  for (const l of r.data.libraries) { assert.equal(l.status, 'fetch-failed'); assert.match(l.error, /invalid library/); }
  assert.ok(!existsSync(join(h.home, 'cache/evil')) && !existsSync(join(h.home, 'cache/trav')));
  assert.equal(registrySearch({ ...h, offline: true }).data.total, 0);
});
test('search works with no network at all (local sources only) and no catalogue yet', () => {
  const h = home(), d = mkLib('loc', [item('x1', { tags: ['hello'] })]);
  registryAdd({ ...h, source: d });
  const r = registrySearch({ ...h, query: 'hello' }); assert.equal(r.data.total, 1); assert.match(r.data.note, /no network/);
});
test('capabilities: core registry format, JSON-Schema I/O, unique names, register into array/Map/object', async () => {
  assert.deepEqual(capabilities.map((c) => c.name), ['library.new', 'library.add', 'library.validate', 'library.index', 'library.publish', 'library.install', 'library.verify', 'registry.add', 'registry.remove', 'registry.list', 'registry.refresh', 'registry.search', 'registry.show']);
  for (const c of capabilities) { assert.ok(c.summary && c.inputSchema && c.outputSchema && typeof c.handler === 'function', c.name); assert.equal(c.inputSchema.type, 'object'); }
  const a = []; registerLibrary(a); const m = new Map(); registerLibrary(m); const o = { n: 0, register() { this.n++; } }; registerLibrary(o);
  assert.equal(a.length, 13); assert.equal(m.size, 13); assert.equal(o.n, 13);
  const d = mkLib('cap', [item('a')]);
  const call = async (n, i) => capabilities.find((c) => c.name === n).handler(i);
  const out = await call('library.validate', { library: d });
  assert.deepEqual(validateSchema(capabilities[0].outputSchema, out), []);
  assert.equal(out.ok, true);
  assert.deepEqual(validateSchema(capabilities.find((c) => c.name === 'library.install').inputSchema, { project: '/x', bogus: 1 }), ['$: unexpected property "bogus"']);
  assert.equal((await call('library.publish', { library: d })).error.code, 'CONFIRM_REQUIRED');
});
