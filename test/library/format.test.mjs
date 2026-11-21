import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadLibrary, writeIndex, validateIndexObject, satisfies, SCHEMAS } from '../../factory-core/library/format.mjs';
import { validateSchema } from '../../factory-core/library/schema-lite.mjs';
import { isSafeRel } from '../../factory-core/library/safe.mjs';
import { validateLibrary, addItems } from '../../factory-core/library/ops.mjs';
import { mkLib, item, readJ, tmp, setDeps } from './helpers.mjs';

test('fresh scaffold validates and has CI + standalone validator', () => {
  const d = mkLib('fresh', []);
  assert.equal(validateLibrary({ library: d }).ok, true);
  for (const f of ['library.json', 'INDEX.json', 'INDEX.md', 'README.md', '.github/workflows/validate.yml', 'tools/library/validate-cli.mjs', 'tools/library/schemas/asset.schema.json']) assert.ok(readFileSync(join(d, f)), f);
});
test('valid library: descriptors satisfy asset schema; index satisfies index schema', () => {
  const d = mkLib('ok1', [item('a'), item('b', { type: 'sfx', duration: 0.5, files: [{ path: 'b.wav', data: Buffer.from('RIFFxxxx') }] })]);
  const lib = loadLibrary(d);
  assert.deepEqual(lib.errors, []);
  for (const a of lib.assets) assert.deepEqual(validateSchema(SCHEMAS.asset, a.descriptor), []);
  assert.deepEqual(validateIndexObject(readJ(join(d, 'INDEX.json'))), []);
  assert.deepEqual(readJ(join(d, 'library.json')).assetTypes, ['sprite', 'sfx']);
});
test('schema rejects bad manifest and descriptor fields', () => {
  assert.ok(validateSchema(SCHEMAS.library, { formatVersion: 1, name: 'Bad Name', version: '1.0', license: 'x', description: '', tags: [], assetTypes: ['bogus'] }).length >= 3);
  assert.ok(validateSchema(SCHEMAS.asset, { id: 'x', type: 'sprite', version: '1.0.0', license: 'x', author: 'a', tags: ['UPPER'], files: [], hash: 'z' }).length >= 2);
  assert.ok(validateSchema(SCHEMAS.asset, { id: 'x', extra: 1 }).some((e) => /unexpected property/.test(e)));
});
test('index is deterministic and idempotent; check detects staleness', () => {
  const d = mkLib('det', [item('zz'), item('aa'), item('mm')]);
  const a = readFileSync(join(d, 'INDEX.json'), 'utf8'), m = readFileSync(join(d, 'INDEX.md'), 'utf8');
  assert.deepEqual(writeIndex(d).changed, []);
  assert.equal(readFileSync(join(d, 'INDEX.json'), 'utf8'), a);
  const ids = JSON.parse(a).assets.map((x) => x.id); assert.deepEqual(ids, ['aa', 'mm', 'zz']);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(a + m), 'no timestamps');
  // same content in a different location => identical bytes
  const d2 = mkLib('det', [item('mm'), item('zz'), item('aa')]);
  assert.equal(readFileSync(join(d2, 'INDEX.json'), 'utf8'), a);
  rmSync(join(d, 'INDEX.md')); assert.equal(writeIndex(d, { check: true }).ok, false);
  assert.equal(validateLibrary({ library: d }).error.code, 'STALE_INDEX');
});
test('tampered asset file, stale descriptor hash, wrong id and missing file are all reported', () => {
  const d = mkLib('tam', [item('a'), item('b')]);
  writeFileSync(join(d, 'assets/a/a.png'), 'evil');
  let e = loadLibrary(d).errors.join('\n'); assert.match(e, /assets\/a\/a\.png: size|sha256 mismatch/);
  const dj = readJ(join(d, 'assets/b/asset.json')); dj.hash = '0'.repeat(64); writeFileSync(join(d, 'assets/b/asset.json'), JSON.stringify(dj));
  e = loadLibrary(d).errors.join('\n'); assert.match(e, /content hash does not match/);
  dj.id = 'other'; writeFileSync(join(d, 'assets/b/asset.json'), JSON.stringify(dj));
  assert.match(loadLibrary(d).errors.join('\n'), /does not match directory name/);
  rmSync(join(d, 'assets/a/a.png')); assert.match(loadLibrary(d).errors.join('\n'), /ENOENT|no such file/i);
});
test('path traversal in descriptor files/preview is rejected', () => {
  for (const bad of ['../../library.json', '/etc/passwd', 'a/../../x', 'C:/x', 'a\\b', './a', 'a//b']) assert.equal(isSafeRel(bad), false, bad);
  const d = mkLib('trav', [item('a')]);
  writeFileSync(join(d, 'secret.txt'), 'top secret');
  const p = join(d, 'assets/a/asset.json'), dj = readJ(p);
  dj.files.push({ path: '../../secret.txt', sha256: '0'.repeat(64), bytes: 10 });
  writeFileSync(p, JSON.stringify(dj));
  assert.match(loadLibrary(d).errors.join('\n'), /unsafe file path/);
  dj.files.pop(); dj.preview = '../../secret.txt'; writeFileSync(p, JSON.stringify(dj));
  assert.match(loadLibrary(d).errors.join('\n'), /preview .*unsafe path/);
});
test('symlinks (file, dir, manifest) are rejected', () => {
  const d = mkLib('sym', [item('a')]);
  const outside = tmp('outside-'); writeFileSync(join(outside, 'x.png'), 'x');
  symlinkSync(join(outside, 'x.png'), join(d, 'assets/a/link.png'));
  assert.match(loadLibrary(d).errors.join('\n'), /symlink not allowed/);
  rmSync(join(d, 'assets/a/link.png'));
  mkdirSync(join(d, 'assets/b')); symlinkSync(outside, join(d, 'assets/b/files'));
  assert.match(loadLibrary(d).errors.join('\n'), /symlink not allowed/);
  const d2 = mkLib('sym2', [item('a')]); rmSync(join(d2, 'library.json')); symlinkSync(join(outside, 'x.png'), join(d2, 'library.json'));
  assert.ok(loadLibrary(d2).errors.length);
});
test('oversized descriptor and __proto__ keys are rejected', () => {
  const d = mkLib('big', [item('a')]);
  writeFileSync(join(d, 'assets/a/asset.json'), JSON.stringify({ pad: 'x'.repeat(1.2 * 1024 * 1024) }));
  assert.match(loadLibrary(d).errors.join('\n'), /too large/);
  writeFileSync(join(d, 'assets/a/asset.json'), '{"__proto__":{"x":1}}');
  assert.match(loadLibrary(d).errors.join('\n'), /__proto__/);
});
test('dependencies: missing, unsatisfied range and cycles', () => {
  assert.equal(addItems(mkLib('deps0', []), [item('a', { dependencies: [{ id: 'ghost' }] })]).error.code, 'BAD_INPUT');
  const d = mkLib('deps', [item('a')]); setDeps(d, 'a', [{ id: 'ghost' }]);
  assert.match(loadLibrary(d).errors.join('\n'), /dependency ghost not found/);
  const d2 = mkLib('deps2', [item('a'), item('b')]); setDeps(d2, 'a', [{ id: 'b' }]); setDeps(d2, 'b', [{ id: 'a' }]);
  assert.match(loadLibrary(d2).errors.join('\n'), /cycle/);
  const d3 = mkLib('deps3', [item('a'), item('b')]); setDeps(d3, 'a', [{ id: 'b', version: '^2.0.0' }]);
  assert.match(loadLibrary(d3).errors.join('\n'), /does not satisfy/);
  assert.ok(satisfies('1.4.2', '^1.2.0') && !satisfies('2.0.0', '^1.2.0') && satisfies('1.2.9', '~1.2.0') && !satisfies('1.3.0', '~1.2.0') && satisfies('0.0.1', '*'));
});
