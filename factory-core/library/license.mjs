// License gate for asset libraries (schema v2): per-asset licenseInfo checks, the public-publish gate, license sign-off,
// attribution generation and the IP tripwire review. Depends only on format/safe/ip so it can ship in tools/library/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCHEMAS, loadLibrary, writeIndex } from './format.mjs';
import { hitLabels, scanAsset } from './ip.mjs';
import { isSafeRel, readInside, readJson, resolveInside, stableJson } from './safe.mjs';
import { validateSchema } from './schema-lite.mjs';

const ok = (data, next = []) => ({ ok: true, data, error: null, next });
const fail = (code, message, data = null, next = []) => ({ ok: false, data, error: { code, message }, next });

export const DEFAULT_ALLOW = Object.freeze(['CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'MIT', 'Apache-2.0', 'Unlicense', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', 'CC-BY-3.0', 'LicenseRef-Owner-*']);
const NC_ND = /(^|-)(NC|ND)(-|$)/i;
const COPYLEFT = /(^|-)SA(-|$)|GPL|ODbL/i;
const VERIFIED = new Set(['verified', 'self-owned']);
export const MESHY_ATTRIBUTION = 'Model created with Meshy - CC BY 4.0 License';

const allowed = (spdx, allow) => allow.some((a) => (a.endsWith('*') ? String(spdx).startsWith(a.slice(0, -1)) : a === spdx));
const isMeshy = (d) => /meshy/i.test(d.provenance?.generator || '');
const needsAttribution = (d) => { const a = d.licenseInfo?.attribution; return a?.required === true || (a?.required === undefined && /^CC-BY/.test(d.license || '')); };
const policyAllow = (manifest, override) => (override?.length ? override : manifest?.licensePolicy?.allow?.length ? manifest.licensePolicy.allow : DEFAULT_ALLOW);

/** Gate one descriptor. -> { reasons: string[] (block a public publish), notes: string[] (warnings) } */
export function gateAsset(d, { allow = DEFAULT_ALLOW, assetDir = null, byId = new Map() } = {}) {
  const reasons = [], notes = [];
  const li = d.licenseInfo;
  if (!li) reasons.push('no licenseInfo (schema v1 descriptor): license status unknown');
  else {
    if (!VERIFIED.has(li.status)) reasons.push(`licenseInfo.status is ${li.status} (must be verified or self-owned)`);
    if (li.redistribute !== true) reasons.push('licenseInfo.redistribute is not true');
    if (li.status === 'verified' && !li.verifiedBy) reasons.push('verified without verifiedBy sign-off');
    if (needsAttribution(d) && !li.attribution?.text) reasons.push('attribution is required but attribution.text is empty');
    if (li.licenseFile && assetDir) { try { if (!readInside(assetDir, li.licenseFile, 1 << 20).length) reasons.push(`licenseFile ${li.licenseFile} is empty`); } catch { reasons.push(`licenseFile ${li.licenseFile} is missing`); } }
  }
  for (const [label, v] of [['license', d.license], ['licenseInfo.spdx', li?.spdx]]) {
    if (v == null) continue;
    if (NC_ND.test(v)) reasons.push(`${label} ${v} is non-commercial or no-derivatives (not redistributable here)`);
    else if (!allowed(v, allow)) reasons.push(`${label} ${v} is not on the license allow-list`);
  }
  if (/^LicenseRef-/.test(d.license || '') && !/^LicenseRef-Owner-/.test(d.license) && !li?.licenseFile) reasons.push(`${d.license} needs a licenseFile`);
  if (li?.spdx && li.spdx !== d.license) reasons.push(`licenseInfo.spdx (${li.spdx}) differs from license (${d.license})`);
  if ([d.license, li?.spdx].some((v) => v && COPYLEFT.test(v))) notes.push('copyleft/share-alike license: derivatives must carry the same terms');
  if (isMeshy(d)) {
    const p = d.provenance || {};
    if (!p.plan || p.plan === 'unknown') reasons.push('meshy asset without provenance.plan (license depends on the plan at generation time)');
    if (!p.visibility) reasons.push('meshy asset without provenance.visibility');
    if (p.plan === 'free') {
      if (d.license !== 'CC-BY-4.0' || (li?.spdx && li.spdx !== 'CC-BY-4.0')) reasons.push('free-plan Meshy output is CC-BY-4.0 only and cannot be relicensed');
      if (li && !li.attribution?.required) reasons.push('free-plan Meshy output requires attribution');
    } else if (p.plan && p.plan !== 'unknown' && p.visibility === 'community' && !(li?.status === 'verified' && li.verifiedBy)) reasons.push('paid-plan Meshy asset published to the Community needs a ToS review and human sign-off');
  }
  if (d.ipReview?.status === 'flagged') reasons.push('ipReview is flagged');
  const hits = scanAsset(d);
  if (hits.length && d.ipReview?.status !== 'clear') reasons.push(`ipReview unresolved: ${hitLabels(hits).join(', ')}`);
  for (const ref of d.provenance?.derivedFrom || []) {
    const p = byId.get(ref);
    if (!p) continue;
    if (NC_ND.test(p.license || '')) reasons.push(`derived from ${ref} with ${p.license}`);
    else if (COPYLEFT.test(p.license || '') && !COPYLEFT.test(d.license || '')) reasons.push(`derived from ${ref} (${p.license}) but license ${d.license} drops the share-alike terms`);
  }
  return { reasons, notes };
}

export function buildAttributionEntries(descs) {
  return [...descs].filter(needsAttribution).sort((a, b) => (a.id < b.id ? -1 : 1)).map((d) => ({ id: d.id, name: d.name || d.id, author: d.author, license: d.license, text: d.licenseInfo?.attribution?.text || '', url: d.licenseInfo?.attribution?.url || '' }));
}
export function buildAttributionMd(entries, title = 'Attribution') {
  const out = [`# ${title}`, '', 'Generated by `library.attribution`; do not edit.', ''];
  if (!entries.length) out.push('No assets require attribution.');
  for (const e of entries) out.push(`- **${e.name}** (\`${e.id}\`) by ${e.author}. License: ${e.license}.${e.text ? ` ${e.text}` : ''}${e.url ? ` <${e.url}>` : ''}`);
  return out.join('\n') + '\n';
}

/** Run the gate over a loaded library. */
export function auditLoaded(lib, { target = 'public', allowList } = {}) {
  const allow = policyAllow(lib.manifest, allowList), byId = new Map(lib.assets.map((a) => [a.id, a.descriptor]));
  const blocked = [], warnings = [], counts = { total: lib.assets.length, byStatus: {}, blocked: 0 };
  for (const a of lib.assets) {
    const st = a.descriptor.licenseInfo?.status || 'unknown'; counts.byStatus[st] = (counts.byStatus[st] || 0) + 1;
    const g = gateAsset(a.descriptor, { allow, assetDir: a.dir, byId });
    if (g.reasons.length) blocked.push({ id: a.id, reasons: g.reasons });
    if (g.notes.length) warnings.push({ id: a.id, reasons: g.notes });
  }
  const libraryReasons = [];
  const entries = buildAttributionEntries(lib.assets.map((a) => a.descriptor));
  if (entries.length) {
    const p = join(lib.dir, 'ATTRIBUTION.md');
    if (!existsSync(p) || readFileSync(p, 'utf8') !== buildAttributionMd(entries)) libraryReasons.push('ATTRIBUTION.md is missing or out of date (run library.attribution)');
  }
  counts.blocked = blocked.length;
  const enforced = target === 'public';
  return { target, ok: !enforced || (!blocked.length && !libraryReasons.length), blocked: enforced ? blocked : [], warnings: [...warnings, ...(enforced ? [] : blocked.map((b) => ({ id: b.id, reasons: b.reasons })))], libraryReasons: enforced ? libraryReasons : [], notes: enforced ? [] : libraryReasons, counts };
}

const loadOrFail = (i, opts) => {
  if (!i.library) return { err: fail('BAD_INPUT', 'library (path) is required') };
  const lib = loadLibrary(i.library, opts);
  if (lib.errors.length) return { err: fail('INVALID', 'library is invalid; fix it first', { errors: lib.errors }) };
  return { lib };
};
function writeDescriptor(lib, id, desc) {
  const errs = validateSchema(SCHEMAS.asset, desc);
  if (errs.length) throw new Error(`${id}: ${errs.join('; ')}`);
  writeFileSync(join(lib.dir, 'assets', id, 'asset.json'), stableJson(desc));
}
const reindex = (lib) => { const r = writeIndex(lib.dir); if (!r.ok) throw new Error(`index failed: ${r.errors[0]}`); };

/** Derive license fields of a Meshy asset from plan + visibility. Never marks anything verified. */
export function meshyDerive(d) {
  const p = d.provenance || {}, li = { ...(d.licenseInfo || {}) };
  if (!p.plan || p.plan === 'unknown') return { ...d, licenseInfo: { ...li, status: 'unknown' } };
  if (p.plan === 'free') return { ...d, license: 'CC-BY-4.0', licenseInfo: { ...li, spdx: 'CC-BY-4.0', status: 'needs-review', redistribute: true, commercialUse: true, attribution: { required: true, text: MESHY_ATTRIBUTION, url: li.attribution?.url || 'https://creativecommons.org/licenses/by/4.0/' } } };
  const o = { ...d, license: 'LicenseRef-Owner-Meshy-Paid', licenseInfo: { ...li, spdx: 'LicenseRef-Owner-Meshy-Paid', status: 'needs-review', redistribute: p.visibility === 'community' ? false : li.redistribute ?? false, commercialUse: true, attribution: { required: false } } };
  return o;
}

// ------------------------------------------------------------------ library.license-audit
export function licenseAudit(i = {}) {
  const t = i.target === 'private' ? 'private' : 'public';
  let l = loadOrFail(i); if (l.err) return l.err;
  let lib = l.lib;
  const fixed = [];
  if (i.fixMeshy) {
    try {
      for (const a of lib.assets) {
        if (!isMeshy(a.descriptor) || VERIFIED.has(a.descriptor.licenseInfo?.status)) continue;
        const n = meshyDerive(a.descriptor);
        if (stableJson(n) !== stableJson(a.descriptor)) { writeDescriptor(lib, a.id, n); fixed.push(a.id); }
      }
      if (fixed.length) { reindex(lib); lib = loadLibrary(lib.dir); }
    } catch (e) { return fail('BAD_INPUT', e.message); }
  }
  const r = auditLoaded(lib, { target: t, allowList: i.allowList });
  const data = { ...r, library: lib.dir, fixed };
  return r.ok ? ok(data, r.counts.blocked ? [] : []) : fail('LICENSE_BLOCKED', `${r.blocked.length} asset(s) and ${r.libraryReasons.length} library check(s) block a public release`, data, [`library.license-set {library: "${lib.dir}", id: "<id>", spdx, status: "verified", redistribute: true, confirm: true}`]);
}

// ------------------------------------------------------------------ library.license-set
export function licenseSet(i = {}) {
  const l = loadOrFail(i); if (l.err) return l.err;
  const lib = l.lib, ids = i.ids?.length ? i.ids : i.id ? [i.id] : [];
  if (!ids.length) return fail('BAD_INPUT', 'id (or ids) is required');
  const fields = ['spdx', 'status', 'redistribute', 'commercialUse', 'attribution', 'evidence', 'licenseFile', 'verifiedBy', 'verifiedAt'];
  if (!fields.some((k) => i[k] !== undefined)) return fail('BAD_INPUT', `pass at least one of ${fields.join(', ')}`);
  const byId = new Map(lib.assets.map((a) => [a.id, a]));
  const missing = ids.filter((x) => !byId.has(x)); if (missing.length) return fail('NOT_FOUND', `no asset(s): ${missing.join(', ')}`);
  const out = [];
  for (const id of ids) {
    const d = byId.get(id).descriptor, cur = d.licenseInfo || { status: 'unknown' };
    const li = { ...cur };
    for (const k of ['spdx', 'status', 'redistribute', 'commercialUse', 'attribution', 'evidence', 'licenseFile']) if (i[k] !== undefined) li[k] = i[k];
    if (li.spdx === undefined) li.spdx = d.license;
    if (VERIFIED.has(li.status)) {
      if (i.confirm !== true) return fail('CONFIRM_REQUIRED', `marking ${id} ${li.status} is an explicit human sign-off: re-run with confirm:true`, { id, proposed: li });
      li.verifiedBy = i.verifiedBy || cur.verifiedBy || 'user';
      li.verifiedAt = i.verifiedAt || new Date().toISOString().slice(0, 10);
    } else { delete li.verifiedBy; delete li.verifiedAt; }
    const nd = { ...d, license: i.spdx || d.license, licenseInfo: li };
    out.push([id, nd]);
  }
  try {
    for (const [id, nd] of out) writeDescriptor(lib, id, nd);
    reindex(lib);
  } catch (e) { return fail('BAD_INPUT', e.message); }
  return ok({ library: lib.dir, updated: out.map(([id, nd]) => ({ id, license: nd.license, licenseInfo: nd.licenseInfo })) }, [`library.license-audit {library: "${lib.dir}", target: "public"}`]);
}

// ------------------------------------------------------------------ library.attribution
export function attribution(i = {}) {
  const fmt = i.format === 'json' ? 'json' : 'md';
  let descs, outDir, name, title;
  if (i.project) {
    const proj = resolve(i.project), lp = join(proj, 'assets.lock.json');
    if (!existsSync(lp)) return fail('NOT_FOUND', `assets.lock.json not found in ${proj}`);
    let lock; try { lock = readJson(lp); } catch (e) { return fail('BAD_INPUT', e.message); }
    descs = [];
    for (const a of lock.assets || []) {
      if (!isSafeRel(a.dest)) return fail('BAD_INPUT', `unsafe dest in lock: ${a.dest}`);
      try { descs.push(readJson(resolveInside(proj, `${a.dest}/asset.json`))); } catch { return fail('NOT_FOUND', `installed descriptor missing for ${a.id}`); }
    }
    outDir = proj; name = 'CREDITS'; title = 'Credits';
  } else {
    const l = loadOrFail(i); if (l.err) return l.err;
    descs = l.lib.assets.map((a) => a.descriptor); outDir = l.lib.dir; name = 'ATTRIBUTION'; title = 'Attribution';
  }
  const entries = buildAttributionEntries(descs);
  const text = fmt === 'json' ? stableJson({ entries }) : buildAttributionMd(entries, title);
  const path = join(outDir, `${name}.${fmt}`);
  if (i.write !== false) writeFileSync(path, text);
  return ok({ path: i.write !== false ? path : null, entries, text: i.write === false ? text : undefined }, i.project ? [] : [`library.license-audit {library: "${outDir}"}`]);
}

// ------------------------------------------------------------------ library.ip-review
export function ipReview(i = {}) {
  const l = loadOrFail(i); if (l.err) return l.err;
  const lib = l.lib, byId = new Map(lib.assets.map((a) => [a.id, a]));
  try {
    if (i.set) {
      const s = i.set, a = byId.get(s.id);
      if (!a) return fail('NOT_FOUND', `no asset ${s.id}`);
      if (!['clear', 'flagged', 'unchecked'].includes(s.status)) return fail('BAD_INPUT', 'set.status must be clear, flagged or unchecked');
      if (s.status === 'clear' && s.confirm !== true) return fail('CONFIRM_REQUIRED', `clearing the IP review of ${s.id} is a human decision: re-run with set.confirm:true`, { id: s.id, hits: hitLabels(scanAsset(a.descriptor)) });
      const r = { status: s.status, ...(s.notes ? { notes: s.notes } : {}), ...(s.status === 'clear' ? { reviewedBy: s.reviewedBy || 'user', reviewedAt: new Date().toISOString().slice(0, 10) } : {}) };
      writeDescriptor(lib, s.id, { ...a.descriptor, ipReview: r }); reindex(lib);
      return ok({ id: s.id, ipReview: r }, [`library.license-audit {library: "${lib.dir}"}`]);
    }
    const want = i.ids?.length ? i.ids : [...byId.keys()];
    const missing = want.filter((x) => !byId.has(x)); if (missing.length) return fail('NOT_FOUND', `no asset(s): ${missing.join(', ')}`);
    const flagged = [], cleared = [], changed = [];
    for (const id of want) {
      const a = byId.get(id), d = a.descriptor, hits = scanAsset(d), labels = hitLabels(hits);
      if (!hits.length) continue;
      if (d.ipReview?.status === 'clear') { cleared.push({ id, hits: labels }); continue; }
      flagged.push({ id, hits: labels });
      if (i.write !== false) { writeDescriptor(lib, id, { ...d, ipReview: { status: 'flagged', hits: labels, ...(d.ipReview?.notes ? { notes: d.ipReview.notes } : {}) } }); changed.push(id); }
    }
    if (changed.length) reindex(lib);
    return ok({ library: lib.dir, scanned: want.length, flagged, cleared, changed, note: 'Keyword tripwire only: a miss is not clearance, and a human decision is still required.' }, flagged.length ? [`library.ip-review {library: "${lib.dir}", set: {id: "<id>", status: "clear", notes: "...", confirm: true}}`] : []);
  } catch (e) { return fail('BAD_INPUT', e.message); }
}
