import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { blobsPack, blobsPublish, blobsFetch, readManifest, parseManifest } from '../factory-core/library/blobs.mjs';
import { blobCapabilities } from '../factory-core/library/blobs-capabilities.mjs';
import { validateLibrary } from '../factory-core/library/ops.mjs';
import { licenseSet, ipReview } from '../factory-core/library/license.mjs';
import { buildRegistry } from '../factory-core/index.mjs';
import { mkLib, item, tmp } from './library/helpers.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const noRun = () => { throw new Error('gh must not be called'); };
const signOff = (d, id) => assert.equal(licenseSet({ library: d, id, spdx: 'CC0-1.0', status: 'verified', redistribute: true, confirm: true, verifiedBy: 't' }).ok, true);

test('pack writes a deterministic text manifest and a local store; library still validates', () => {
  const d = mkLib('b1', [item('a'), item('bb')]), store = join(tmp(), 'store');
  const r = blobsPack({ library: d, store });
  assert.equal(r.ok, true); assert.ok(r.data.count >= 2);
  const m = readManifest(d);
  for (const e of m) { assert.equal(e.sha256, sha(readFileSync(join(d, e.path)))); assert.ok(existsSync(join(store, e.sha256))); }
  const text = readFileSync(join(d, 'blobs/MANIFEST.txt'), 'utf8');
  assert.equal(blobsPack({ library: d }).data.manifestSha256, r.data.manifestSha256);
  assert.equal(readFileSync(join(d, 'blobs/MANIFEST.txt'), 'utf8'), text);
  assert.equal(validateLibrary({ library: d }).ok, true);
  assert.equal(blobsPack({ library: d, paths: ['../x'] }).error.code, 'BAD_INPUT');
  assert.throws(() => parseManifest('zz\t1\tt\tp\n'));
});

test('publish defaults to dryRun, never calls gh; public is gated by license and ipReview', () => {
  const d = mkLib('b2', [item('a')]);
  assert.equal(blobsPublish({ library: d }, noRun).error.code, 'NOT_FOUND');
  blobsPack({ library: d });
  const dry = blobsPublish({ library: d, repo: 'me/x' }, noRun);
  assert.equal(dry.ok, true); assert.equal(dry.data.dryRun, true);
  assert.equal(blobsPublish({ library: d, repo: 'me/x', visibility: 'public' }, noRun).error.code, 'LICENSE_BLOCKED'); // needs-review
  signOff(d, 'a');
  assert.equal(blobsPublish({ library: d, repo: 'me/x', visibility: 'public' }, noRun).ok, true);
  // flagged IP blocks even a dry public plan
  assert.equal(ipReview({ library: d, set: { id: 'a', status: 'flagged', notes: 'looks like a trademark' } }).ok, true);
  assert.equal(blobsPublish({ library: d, repo: 'me/x', visibility: 'public', dryRun: false }, noRun).error.code, 'LICENSE_BLOCKED');
});

test('real publish uses injected gh runner: release create + upload sha-named files', () => {
  const d = mkLib('b3', [item('a')]); blobsPack({ library: d });
  const calls = [];
  const run = (cmd, args) => { calls.push([cmd, ...args]); return { status: args[1] === 'view' ? 1 : 0, stdout: '', stderr: '' }; };
  assert.equal(blobsPublish({ library: d, dryRun: false }, run).error.code, 'BAD_INPUT');
  const r = blobsPublish({ library: d, repo: 'me/x', tag: 'blobs-t', dryRun: false }, run);
  assert.equal(r.ok, true); assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].slice(0, 3), ['gh', 'release', 'create']);
  assert.ok(calls[2].some((a) => /^[0-9a-f]{64}$/.test(a.split('/').pop())));
  writeFileSync(join(d, readManifest(d)[0].path), 'changed');
  assert.equal(blobsPublish({ library: d, repo: 'me/x', dryRun: false }, run).error.code, 'INVALID'); // damaged binary: library no longer validates
});

test('fetch restores from a local dir and file:// store, verifies hashes', () => {
  const d = mkLib('b4', [item('a')]), store = join(tmp(), 'st');
  blobsPack({ library: d, store });
  const [e] = readManifest(d), abs = join(d, e.path), orig = readFileSync(abs);
  writeFileSync(abs, 'x'); // damage
  assert.equal(blobsFetch({ library: d, source: store }, noRun).error.code, 'TASK_FAILED'); // differs, no yes
  assert.equal(blobsFetch({ library: d, source: store, yes: true, dryRun: true }, noRun).ok, true);
  assert.equal(readFileSync(abs).toString(), 'x');
  assert.equal(blobsFetch({ library: d, source: pathToFileURL(store).href, yes: true }, noRun).ok, true);
  assert.deepEqual(readFileSync(abs), orig);
  assert.equal(blobsFetch({ library: d, source: store }, noRun).data.present.length, readManifest(d).length);
  // tampered blob in store is refused and not written
  writeFileSync(join(store, e.sha256), 'evil'); writeFileSync(abs, 'x');
  const bad = blobsFetch({ library: d, source: store, yes: true }, noRun);
  assert.equal(bad.error.code, 'TASK_FAILED'); assert.match(bad.data.failed[0].reason, /mismatch/);
  assert.equal(readFileSync(abs).toString(), 'x');
  const missing = blobsFetch({ library: d, source: join(tmp(), 'empty'), yes: true }, noRun);
  assert.match(missing.data.failed[0].reason, /not found/);
  assert.equal(blobsFetch({ library: d }, noRun).error.code, 'BAD_INPUT');
});

test('capabilities are registered with schemas on the core registry', async () => {
  assert.deepEqual(blobCapabilities.map((c) => c.name), ['library.blobs-pack', 'library.blobs-publish', 'library.blobs-fetch']);
  const r = buildRegistry();
  const list = r.list ? r.list() : [...r.values?.() ?? []];
  const names = new Set(list.map((c) => c.name));
  for (const c of blobCapabilities) { assert.ok(names.has(c.name), c.name); assert.ok(c.inputSchema && c.outputSchema); }
  const d = mkLib('b5', [item('a')]);
  const out = await r.call('library.blobs-pack', { library: d });
  assert.equal(out.ok, true);
  assert.equal((await r.call('library.blobs-publish', { library: d, bogus: 1 })).error.code, 'BAD_INPUT');
});
