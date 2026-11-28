import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { addItems, addAssets, validateLibrary, publishLibrary, installAssets, newLibrary } from '../factory-core/library/ops.mjs';
import { loadLibrary, SCHEMAS } from '../factory-core/library/format.mjs';
import { validateSchema } from '../factory-core/library/schema-lite.mjs';
import { licenseAudit, licenseSet, attribution, ipReview } from '../factory-core/library/license.mjs';
import { capabilities } from '../factory-core/library/capabilities.mjs';
import { mkLib, item, tmp, readJ, png } from './library/helpers.mjs';

const okLi = (over = {}) => ({ spdx: 'CC0-1.0', status: 'verified', redistribute: true, verifiedBy: 'tester', verifiedAt: '2026-11-22', ...over });
const pubOk = (d, extra = {}) => publishLibrary({ library: d, repo: 'me/x', yes: true, visibility: 'public', ...extra }, () => ({ status: 0, stdout: 'u\n', stderr: '' }));
const glb = (json) => { const j = Buffer.from(JSON.stringify(json)); const pad = (4 - (j.length % 4)) % 4, jb = Buffer.concat([j, Buffer.alloc(pad, 0x20)]); const h = Buffer.alloc(20); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(20 + jb.length, 8); h.writeUInt32LE(jb.length, 12); h.writeUInt32LE(0x4e4f534a, 16); return Buffer.concat([h, jb]); };
const mkv2 = (items = []) => mkLib('v2lib', items, {});

test('new libraries are formatVersion 2; v1 libraries still load and validate', () => {
  const d = mkv2([item('a')]);
  assert.equal(readJ(join(d, 'library.json')).formatVersion, 2);
  assert.equal(readJ(join(d, 'assets/a/asset.json')).licenseInfo.status, 'needs-review');
  assert.equal(readJ(join(d, 'assets/a/asset.json')).contentId.length, 64);
  // downgrade to a v1 library: no licenseInfo, formatVersion 1
  const v1 = mkv2([]); const m = readJ(join(v1, 'library.json')); m.formatVersion = 1; writeFileSync(join(v1, 'library.json'), JSON.stringify(m));
  const r = addItems(v1, [item('b')]);
  assert.equal(r.ok, true);
  const desc = readJ(join(v1, 'assets/b/asset.json')); assert.equal(desc.licenseInfo, undefined); assert.equal(desc.contentId, undefined);
  assert.equal(validateLibrary({ library: v1 }).ok, true);
  assert.equal(validateLibrary({ library: v1, target: 'private' }).ok, true); // private: warnings only
  assert.equal(validateLibrary({ library: v1, target: 'public' }).error.code, 'LICENSE_BLOCKED');
  assert.equal(installAssets({ library: v1, project: tmp('p-'), assets: ['b'] }).ok, true);
});

test('schema v2: licenseInfo/provenance/model blocks validate; bad enums are rejected', () => {
  const base = readJ(join(mkv2([item('a')]), 'assets/a/asset.json'));
  assert.deepEqual(validateSchema(SCHEMAS.asset, base), []);
  const good = { ...base, type: 'model', licenseInfo: okLi(), provenance: { generator: 'meshy', plan: 'free', visibility: 'private', jobId: 'j1', prompt: 'a barrel' }, model: { tris: 10, rig: { type: 'humanoid', bones: 3, skeletonHash: 'a'.repeat(64) }, clips: [{ name: 'Walk', duration: 1, loop: true }] }, animation: { skeletonHash: 'b'.repeat(64), clips: [] }, audio: { codec: 'ogg', sampleRate: 44100 } };
  assert.deepEqual(validateSchema(SCHEMAS.asset, good), []);
  assert.ok(validateSchema(SCHEMAS.asset, { ...base, licenseInfo: { status: 'maybe' } }).length);
  assert.ok(validateSchema(SCHEMAS.asset, { ...base, provenance: { plan: 'gold' } }).length);
});

test('per-library limits: default 16 MiB file cap stays, manifest limits raise it, ceiling is enforced', () => {
  const d = mkv2([]); const big = join(d, 'assets', 'big'); mkdirSync(big, { recursive: true });
  const data = Buffer.alloc(17 << 20, 7), sha = createHash('sha256').update(data).digest('hex');
  writeFileSync(join(big, 'm.bin'), data);
  const files = [{ path: 'm.bin', sha256: sha, bytes: data.length }];
  const hash = createHash('sha256').update(`m.bin\0${sha}\n`).digest('hex');
  writeFileSync(join(big, 'asset.json'), JSON.stringify({ id: 'big', type: 'doc', version: '1.0.0', tags: [], license: 'CC0-1.0', author: 'a', files, hash }));
  assert.ok(loadLibrary(d).errors.some((e) => /too large/.test(e)));
  const m = readJ(join(d, 'library.json')); m.assetTypes = ['sprite', 'doc']; m.limits = { fileBytes: 32 << 20 }; writeFileSync(join(d, 'library.json'), JSON.stringify(m));
  const r = loadLibrary(d); assert.deepEqual(r.errors, []); assert.equal(r.limits.maxFileBytes, 32 << 20);
  assert.ok(loadLibrary(d, { maxFileBytes: 1 << 20 }).errors.length); // consumer cap wins
  m.limits = { fileBytes: 3 * 1024 ** 3 }; writeFileSync(join(d, 'library.json'), JSON.stringify(m));
  assert.ok(loadLibrary(d).errors.some((e) => /limits/.test(e))); // above the 2 GiB ceiling
});

test('license.set: verified needs confirm; sign-off stamps verifiedBy; non-verified clears it', () => {
  const d = mkv2([item('a')]);
  assert.equal(licenseSet({ library: d, id: 'a', status: 'verified', spdx: 'CC0-1.0', redistribute: true }).error.code, 'CONFIRM_REQUIRED');
  assert.equal(licenseSet({ library: d, id: 'zz', status: 'blocked' }).error.code, 'NOT_FOUND');
  assert.equal(licenseSet({ library: d, id: 'a' }).error.code, 'BAD_INPUT');
  const r = licenseSet({ library: d, id: 'a', status: 'verified', spdx: 'CC0-1.0', redistribute: true, confirm: true, verifiedBy: 'bill' });
  assert.equal(r.ok, true); const li = readJ(join(d, 'assets/a/asset.json')).licenseInfo;
  assert.equal(li.verifiedBy, 'bill'); assert.match(li.verifiedAt, /^\d{4}-\d\d-\d\d$/);
  assert.equal(readJ(join(d, 'INDEX.json')).assets[0].licenseStatus, 'verified');
  assert.equal(validateLibrary({ library: d }).ok, true); // index refreshed
  licenseSet({ library: d, id: 'a', status: 'needs-review' });
  assert.equal(readJ(join(d, 'assets/a/asset.json')).licenseInfo.verifiedBy, undefined);
});

test('public gate passes for verified CC0 and fails (LICENSE_BLOCKED) for unknown, needs-review, NC, ND, redistribute false', () => {
  const d = mkv2([item('a')]);
  assert.equal(pubOk(d).error.code, 'LICENSE_BLOCKED'); // needs-review
  assert.equal(licenseAudit({ library: d, target: 'private' }).ok, true);
  assert.equal(licenseAudit({ library: d }).error.code, 'LICENSE_BLOCKED');
  licenseSet({ library: d, id: 'a', status: 'verified', spdx: 'CC0-1.0', redistribute: true, confirm: true });
  assert.equal(pubOk(d).ok, true);
  for (const [spdx, re] of [['CC-BY-NC-4.0', /non-commercial/], ['CC-BY-ND-4.0', /no-derivatives/], ['Proprietary-X', /allow-list/]]) {
    licenseSet({ library: d, id: 'a', spdx, status: 'verified', redistribute: true, attribution: { required: false }, confirm: true });
    const r = pubOk(d); assert.equal(r.error.code, 'LICENSE_BLOCKED', spdx); assert.match(r.data.blocked[0].reasons.join(' '), re);
  }
  licenseSet({ library: d, id: 'a', spdx: 'CC0-1.0', status: 'verified', redistribute: false, confirm: true });
  assert.match(pubOk(d).data.blocked[0].reasons.join(' '), /redistribute/);
  licenseSet({ library: d, id: 'a', status: 'unknown' });
  assert.equal(pubOk(d).error.code, 'LICENSE_BLOCKED');
  // private visibility is not gated
  assert.equal(publishLibrary({ library: d, repo: 'me/x', yes: true }, () => ({ status: 0, stdout: 'u', stderr: '' })).ok, true);
  // the plan-only call (no yes) is gated too
  assert.equal(publishLibrary({ library: d, repo: 'me/x', visibility: 'public' }, () => ({ status: 0 })).error.code, 'LICENSE_BLOCKED');
});

test('Meshy rules: free plan must be CC-BY-4.0 with credit; missing plan blocked; paid+community needs sign-off; fixMeshy derives', async () => {
  const d = mkv2([]);
  const add = (id, provenance, extra = {}) => addItems(d, [item(id, { type: 'doc', provenance, ...extra })]);
  assert.equal(add('free1', { generator: 'meshy', plan: 'free', visibility: 'private', jobId: 'j' }).ok, true);
  assert.equal(add('noplan', { generator: 'meshy' }).ok, true);
  assert.equal(add('paidc', { generator: 'meshy', plan: 'pro', visibility: 'community' }).ok, true);
  assert.equal(add('paidp', { generator: 'meshy', plan: 'pro', visibility: 'private' }).ok, true);
  // add derived license from plan: free -> CC-BY-4.0 + credit, never verified
  const f = readJ(join(d, 'assets/free1/asset.json'));
  assert.equal(f.license, 'CC-BY-4.0'); assert.equal(f.licenseInfo.status, 'needs-review'); assert.match(f.licenseInfo.attribution.text, /Meshy/);
  assert.equal(readJ(join(d, 'assets/noplan/asset.json')).licenseInfo.status, 'unknown');
  // human sign-off for the free asset keeps CC-BY; a CC0 relabel is blocked
  licenseSet({ library: d, id: 'free1', status: 'verified', redistribute: true, confirm: true });
  attribution({ library: d });
  let a = licenseAudit({ library: d }), by = Object.fromEntries(a.data.blocked.map((b) => [b.id, b.reasons.join(' | ')]));
  assert.equal(by.free1, undefined);
  assert.match(by.noplan, /provenance\.plan/);
  assert.match(by.paidc, /Community|sign-off|needs-review/);
  licenseSet({ library: d, id: 'free1', spdx: 'CC0-1.0', status: 'verified', redistribute: true, attribution: { required: false }, confirm: true });
  a = licenseAudit({ library: d }); assert.match(a.data.blocked.find((b) => b.id === 'free1').reasons.join(' '), /CC-BY-4\.0 only/);
  // paid private: owner picks a release license and signs off
  licenseSet({ library: d, id: 'paidp', spdx: 'LicenseRef-Owner-Meshy-Paid', status: 'verified', redistribute: true, attribution: { required: false }, confirm: true });
  a = licenseAudit({ library: d }); assert.equal(a.data.blocked.some((b) => b.id === 'paidp'), false);
  // fixMeshy rewrites derived fields on unverified assets only
  licenseSet({ library: d, id: 'paidc', spdx: 'CC0-1.0', status: 'needs-review', redistribute: true });
  const fx = licenseAudit({ library: d, fixMeshy: true });
  assert.ok(fx.data.fixed.includes('paidc') && !fx.data.fixed.includes('paidp'));
  assert.equal(readJ(join(d, 'assets/paidc/asset.json')).licenseInfo.redistribute, false);
});

test('IP tripwire: Green Lantern-like costume flags, blocks public publish until a confirmed clear', () => {
  const d = mkv2([]);
  addItems(d, [item('hero', { name: 'Hero', provenance: { prompt: 'a hero in a green lantern style costume with a glowing ring' } }), item('barrel', { name: 'Barrel' }), item('eiffel', { name: 'Eiffel Tower replica' })]);
  for (const id of ['hero', 'barrel', 'eiffel']) licenseSet({ library: d, id, spdx: 'CC0-1.0', status: 'verified', redistribute: true, confirm: true });
  let r = ipReview({ library: d });
  assert.deepEqual(r.data.flagged.map((x) => x.id).sort(), ['eiffel', 'hero']);
  assert.equal(readJ(join(d, 'assets/hero/asset.json')).ipReview.status, 'flagged');
  assert.equal(readJ(join(d, 'assets/barrel/asset.json')).ipReview, undefined);
  let p = pubOk(d); assert.equal(p.error.code, 'LICENSE_BLOCKED'); assert.ok(p.data.blocked.every((b) => b.reasons.some((x) => /ipReview/.test(x))));
  assert.equal(ipReview({ library: d, set: { id: 'hero', status: 'clear', notes: 'original design' } }).error.code, 'CONFIRM_REQUIRED');
  assert.equal(ipReview({ library: d, set: { id: 'hero', status: 'clear', notes: 'original design', confirm: true } }).ok, true);
  assert.equal(ipReview({ library: d, set: { id: 'eiffel', status: 'clear', confirm: true } }).ok, true);
  assert.equal(pubOk(d).ok, true);
  r = ipReview({ library: d }); assert.equal(r.data.flagged.length, 0); assert.equal(r.data.cleared.length, 2); // cleared stays cleared
  // detection without recording
  assert.equal(ipReview({ library: d, ids: ['nope'] }).error.code, 'NOT_FOUND');
});

test('derived-from NC parent blocks the child', () => {
  const d = mkv2([item('parent'), item('child', { provenance: { derivedFrom: ['parent'] } })]);
  licenseSet({ library: d, ids: ['child'], spdx: 'CC0-1.0', status: 'verified', redistribute: true, confirm: true });
  licenseSet({ library: d, ids: ['parent'], spdx: 'CC-BY-NC-4.0', status: 'verified', redistribute: true, confirm: true });
  assert.ok(licenseAudit({ library: d }).data.blocked.find((b) => b.id === 'child').reasons.some((r) => /derived from parent/.test(r)));
});

test('attribution: ATTRIBUTION.md is required fresh for the public gate; project CREDITS.md from lock', () => {
  const d = mkv2([item('a')]);
  licenseSet({ library: d, id: 'a', spdx: 'CC-BY-4.0', status: 'verified', redistribute: true, attribution: { required: true, text: 'Art by Bill', url: 'https://x.example' }, confirm: true });
  let r = pubOk(d); assert.equal(r.error.code, 'LICENSE_BLOCKED'); assert.match(r.data.libraryReasons[0], /ATTRIBUTION/);
  const at = attribution({ library: d }); assert.equal(at.data.entries.length, 1);
  assert.match(readFileSync(join(d, 'ATTRIBUTION.md'), 'utf8'), /Art by Bill/);
  assert.equal(pubOk(d).ok, true);
  const proj = tmp('game-'); assert.equal(installAssets({ library: d, project: proj, assets: ['a'] }).ok, true);
  const c = attribution({ project: proj }); assert.match(readFileSync(c.data.path, 'utf8'), /Art by Bill/);
  const j = attribution({ project: proj, format: 'json', write: false }); assert.equal(j.data.path, null); assert.equal(JSON.parse(j.data.text).entries[0].id, 'a');
  // required attribution with empty text is blocked
  licenseSet({ library: d, id: 'a', attribution: { required: true, text: '' }, confirm: true, status: 'verified' });
  assert.match(licenseAudit({ library: d }).data.blocked[0].reasons.join(' '), /attribution/);
});

test('library.add: model/animation blocks from GLB, provenance passthrough, duplicates, update downgrades sign-off', async () => {
  const d = mkv2([]), dir = tmp('glb-');
  const model = glb({ asset: { version: '2.0' }, accessors: [{ count: 3 }, { count: 3 }, { count: 2, max: [1.5] }], meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0 }] }], materials: [{}], nodes: [{ name: 'root' }, { name: 'hip' }], skins: [{ joints: [0, 1] }], animations: [{ name: 'Walk', samplers: [{ input: 2 }] }] });
  const p = join(dir, 'hero.glb'); writeFileSync(p, model);
  const r = await addAssets({ library: d, files: [{ path: p, id: 'hero', license: 'CC-BY-4.0', provenance: { generator: 'meshy', plan: 'free', visibility: 'private', jobId: 'j9', prompt: 'a knight' } }] });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const a = readJ(join(d, 'assets/hero/asset.json'));
  assert.equal(a.type, 'model'); assert.equal(a.model.tris, 1); assert.equal(a.model.verts, 3); assert.equal(a.model.rig.bones, 2); assert.match(a.model.rig.skeletonHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(a.model.clips.map((c) => [c.name, c.duration]), [['Walk', 1.5]]); assert.equal(a.provenance.jobId, 'j9'); assert.equal(a.licenseInfo.attribution.required, true);
  assert.deepEqual(validateSchema(SCHEMAS.asset, a), []);
  // same payload under a different id: DUPLICATE for model types, allowed with allowDuplicate
  const dup = await addAssets({ library: d, files: [{ path: p, id: 'hero2' }] });
  assert.equal(dup.error.code, 'DUPLICATE');
  assert.equal((await addAssets({ library: d, files: [{ path: p, id: 'hero2' }], allowDuplicate: true })).data.duplicates[0].duplicateOf, 'hero');
  // sign-off then content change -> back to needs-review
  licenseSet({ library: d, id: 'hero', status: 'verified', redistribute: true, confirm: true });
  const p2 = join(dir, 'hero.glb'); writeFileSync(p2, glb({ asset: { version: '2.0' }, materials: [{}, {}] }));
  assert.equal((await addAssets({ library: d, files: [{ path: p2, id: 'hero', license: 'CC-BY-4.0' }], update: true })).ok, true);
  assert.equal(readJ(join(d, 'assets/hero/asset.json')).licenseInfo.status, 'needs-review');
});

test('capabilities are registered with strict schemas and work through their handlers', () => {
  const names = ['library.license-set', 'library.license-audit', 'library.attribution', 'library.ip-review'];
  for (const n of names) { const c = capabilities.find((x) => x.name === n); assert.ok(c, n); assert.equal(c.inputSchema.additionalProperties, false); assert.ok(c.inputSchema.required.includes('library') || n === 'library.attribution'); }
  const d = mkv2([item('a')]);
  assert.equal(capabilities.find((x) => x.name === 'library.license-audit').handler({ library: d }).error.code, 'LICENSE_BLOCKED');
  assert.equal(capabilities.find((x) => x.name === 'library.license-audit').handler({}).error.code, 'BAD_INPUT');
  const lib = newLibrary({ name: 'stand', dir: join(tmp(), 'stand') });
  assert.ok(existsSync(join(lib.data.dir, 'tools/library/license.mjs')) && existsSync(join(lib.data.dir, 'tools/library/ip.mjs')));
});
