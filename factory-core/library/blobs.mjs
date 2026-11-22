// Content-addressed binary blobs for libraries: binaries live OUTSIDE git (GitHub Release assets named by sha256, no Git LFS).
// The catalogue only carries a text manifest (blobs/MANIFEST.txt). Network/gh is touched only by publish (not dryRun) and fetch(repo).
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadLibrary } from './format.mjs';
import { effectiveLimits, isSafeRel, readInside, readJson, resolveInside, sha256, walkTree } from './safe.mjs';
import { auditLoaded } from './license.mjs';
import { ok, fail } from './ops.mjs';

export const MANIFEST_PATH = 'blobs/MANIFEST.txt';
const HEADER = '# game-factory blob manifest: sha256<TAB>size<TAB>content-type<TAB>path (sorted by path). Binaries are stored out of git, addressed by sha256.\n';
const TYPES = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.hdr': 'image/vnd.radiance', '.exr': 'image/aces', '.ktx2': 'image/ktx2', '.fbx': 'application/octet-stream', '.blend': 'application/octet-stream', '.zip': 'application/zip' };
const BINARY = new Set(Object.keys(TYPES).filter((e) => e !== '.gltf'));
export const contentType = (p) => TYPES[extname(p).toLowerCase()] || 'application/octet-stream';
const SHA = /^[0-9a-f]{64}$/;

export function parseManifest(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [sha, size, type, ...rest] = line.split('\t'), path = rest.join('\t');
    if (!SHA.test(sha) || !/^\d+$/.test(size) || !type || !isSafeRel(path)) throw new Error(`bad manifest line: ${JSON.stringify(line.slice(0, 120))}`);
    entries.push({ sha256: sha, size: Number(size), contentType: type, path });
  }
  return entries;
}
export const formatManifest = (entries) => HEADER + [...entries].sort((a, b) => (a.path < b.path ? -1 : 1)).map((e) => `${e.sha256}\t${e.size}\t${e.contentType}\t${e.path}`).join('\n') + (entries.length ? '\n' : '');
export const readManifest = (dir) => { const p = join(dir, MANIFEST_PATH); if (!existsSync(p)) return null; return parseManifest(readFileSync(p, 'utf8')); };

/** Hash files into the manifest; optionally copy them into a local blob store (<store>/<sha256>). */
export function blobsPack(i = {}) {
  if (!i.library) return fail('BAD_INPUT', 'library (path) is required');
  const lib = loadLibrary(i.library);
  if (lib.errors.length) return fail('INVALID', 'library is invalid; fix it first', { errors: lib.errors });
  const dir = lib.dir, lim = effectiveLimits(lib.manifest?.limits);
  let rels;
  if (i.paths?.length) rels = i.paths;
  else { const w = walkTree(dir, { maxFileBytes: lim.maxFileBytes, maxLibraryBytes: lim.maxLibraryBytes }); if (w.problems.length) return fail('INVALID', 'library tree has problems', { problems: w.problems }); rels = w.files.filter((f) => f.startsWith('assets/') && BINARY.has(extname(f).toLowerCase())); }
  const entries = [];
  try {
    for (const rel of rels) {
      if (rel === MANIFEST_PATH) continue;
      const buf = readInside(dir, rel, lim.maxFileBytes);
      entries.push({ sha256: sha256(buf), size: buf.length, contentType: contentType(rel), path: rel });
    }
  } catch (e) { return fail('BAD_INPUT', e.message); }
  const dup = new Set(), dups = entries.filter((e) => (dup.has(e.path) ? true : (dup.add(e.path), false)));
  if (dups.length) return fail('BAD_INPUT', `duplicate paths: ${dups.map((d) => d.path).join(', ')}`);
  let stored = 0;
  if (i.store) {
    const store = resolve(i.store); mkdirSync(store, { recursive: true });
    for (const e of entries) { const to = join(store, e.sha256); if (!existsSync(to)) { copyFileSync(resolveInside(dir, e.path), to); stored++; } }
  }
  const text = formatManifest(entries);
  const manifestFile = join(dir, MANIFEST_PATH);
  mkdirSync(dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, text);
  const bytes = entries.reduce((n, e) => n + e.size, 0);
  return ok({ library: dir, manifest: MANIFEST_PATH, count: entries.length, bytes, stored, manifestSha256: sha256(Buffer.from(text)), entries }, [`library.blobs-publish {library: "${dir}"}   (dryRun by default)`, `library.blobs-fetch {library: "${dir}", source: "<blob store>"}`]);
}

const defaultRun = (cmd, args, o) => spawnSync(cmd, args, { encoding: 'utf8', ...o });
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const TAG_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Upload manifest blobs as GitHub Release assets named by sha256. dryRun (default true) only returns the plan. */
export function blobsPublish(i = {}, run = defaultRun) {
  if (!i.library) return fail('BAD_INPUT', 'library (path) is required');
  const lib = loadLibrary(i.library);
  if (lib.errors.length) return fail('INVALID', 'library is invalid; fix it first', { errors: lib.errors });
  let entries; try { entries = readManifest(lib.dir); } catch (e) { return fail('INVALID', e.message); }
  if (!entries) return fail('NOT_FOUND', `no ${MANIFEST_PATH}; run library.blobs-pack first`, null, [`library.blobs-pack {library: "${lib.dir}"}`]);
  const vis = i.visibility === 'public' ? 'public' : 'private', dryRun = i.dryRun !== false;
  const repo = i.repo, tag = i.tag || `blobs-${sha256(Buffer.from(formatManifest(entries))).slice(0, 12)}`;
  if (repo !== undefined && !REPO_RE.test(repo)) return fail('BAD_INPUT', 'repo must be "owner/name"');
  if (!TAG_RE.test(tag)) return fail('BAD_INPUT', 'tag has invalid characters');
  // gate: a public publish needs every asset through the license gate (which includes ipReview flagged/unresolved)
  let audit = null;
  if (vis === 'public') {
    audit = auditLoaded(lib, { target: 'public' });
    if (!audit.ok) return fail('LICENSE_BLOCKED', `refusing a public blob publish: ${audit.blocked.length} asset(s) and ${audit.libraryReasons.length} library check(s) fail the license/IP gate`, { blocked: audit.blocked, libraryReasons: audit.libraryReasons, counts: audit.counts }, [`library.license-audit {library: "${lib.dir}", target: "public"}`]);
  }
  const uniq = [...new Map(entries.map((e) => [e.sha256, e])).values()];
  const missing = [], files = [];
  for (const e of uniq) {
    const src = entries.filter((x) => x.sha256 === e.sha256).map((x) => x.path);
    let abs = null;
    for (const p of src) { try { const a = resolveInside(lib.dir, p); if (statSync(a).isFile() && sha256(readFileSync(a)) === e.sha256) { abs = a; break; } } catch { /* try next */ } }
    if (abs) files.push({ sha256: e.sha256, size: e.size, abs }); else missing.push(e.path);
  }
  if (missing.length) return fail('NOT_FOUND', `${missing.length} blob(s) missing or changed since pack; re-run library.blobs-pack`, { missing });
  const plan = { repo: repo || null, tag, visibility: vis, dryRun, blobs: files.length, bytes: files.reduce((n, f) => n + f.size, 0), ...(audit ? { audit: audit.counts } : {}),
    commands: [`gh release create ${tag} --repo ${repo || '<owner/name>'} --title "${tag}" --notes "content-addressed blobs"`, `gh release upload ${tag} <sha256-named files> --repo ${repo || '<owner/name>'}`] };
  if (dryRun) return ok({ ...plan, note: 'dry run: nothing was uploaded' }, [`library.blobs-publish {library: "${lib.dir}", repo: "owner/name", dryRun: false}   (only on explicit user instruction)`]);
  if (!repo) return fail('BAD_INPUT', 'repo ("owner/name") is required unless dryRun');
  const stage = mkdtempSync(join(process.env.CLAUDE_CODE_TMPDIR || tmpdir(), 'blobs-'));
  const steps = [];
  try {
    const sh = (args) => { const r = run('gh', args, {}); steps.push({ cmd: ['gh', ...args].join(' '), status: r.status }); return r; };
    const view = sh(['release', 'view', tag, '--repo', repo]);
    if (view.status) { const c = sh(['release', 'create', tag, '--repo', repo, '--title', tag, '--notes', 'content-addressed blobs (sha256 asset names)']); if (c.status) return fail('GH_FAILED', (c.stderr || c.stdout || 'gh release create failed').trim(), { steps }); }
    const paths = files.map((f) => { const to = join(stage, f.sha256); copyFileSync(f.abs, to); return to; });
    const u = sh(['release', 'upload', tag, ...paths, '--repo', repo, '--clobber']);
    if (u.status) return fail('GH_FAILED', (u.stderr || u.stdout || 'gh release upload failed').trim(), { steps });
  } finally { rmSync(stage, { recursive: true, force: true }); }
  return ok({ ...plan, steps, uploaded: files.length });
}

function readStore(source, sha) {
  const base = String(source).startsWith('file://') ? fileURLToPath(source) : resolve(source);
  for (const p of [join(base, sha), join(base, sha.slice(0, 2), sha)]) {
    if (existsSync(p) && lstatSync(p).isFile()) return readFileSync(p);
  }
  return null;
}

/** Download blobs by sha256 from a local dir / file:// store (or a GitHub release via gh when repo is given) and verify hashes. */
export function blobsFetch(i = {}, run = defaultRun) {
  if (!i.library) return fail('BAD_INPUT', 'library (path) is required');
  if (!i.source && !i.repo) return fail('BAD_INPUT', 'source (directory or file:// URL) or repo ("owner/name" with tag) is required');
  // lenient on purpose: a library with missing/damaged binaries fails loadLibrary, and restoring them is the point of fetch
  const lib = { dir: resolve(i.library), manifest: null };
  if (!existsSync(lib.dir)) return fail('NOT_FOUND', `not found: ${lib.dir}`);
  try { lib.manifest = readJson(join(lib.dir, 'library.json')); } catch { /* limits fall back to defaults */ }
  let entries; try { entries = readManifest(lib.dir); } catch (e) { return fail('INVALID', e.message); }
  if (!entries) return fail('NOT_FOUND', `no ${MANIFEST_PATH}`);
  if (i.paths?.length) entries = entries.filter((e) => i.paths.includes(e.path));
  const lim = effectiveLimits(lib.manifest?.limits), res = { fetched: [], present: [], failed: [] };
  let stage = null;
  if (!i.source) {
    if (!REPO_RE.test(i.repo || '') || !TAG_RE.test(i.tag || '')) return fail('BAD_INPUT', 'repo "owner/name" and tag are required');
    stage = mkdtempSync(join(process.env.CLAUDE_CODE_TMPDIR || tmpdir(), 'blobs-'));
  }
  try {
    const source = i.source || stage;
    for (const e of entries) {
      let dest; try { dest = resolveInside(lib.dir, e.path); } catch (err) { res.failed.push({ path: e.path, reason: err.message }); continue; }
      if (e.size > lim.maxFileBytes) { res.failed.push({ path: e.path, reason: `blob larger than limit (${e.size})` }); continue; }
      if (existsSync(dest) && lstatSync(dest).isFile() && sha256(readFileSync(dest)) === e.sha256) { res.present.push(e.path); continue; }
      if (existsSync(dest) && !i.yes) { res.failed.push({ path: e.path, reason: 'exists with different content (pass yes:true to overwrite)' }); continue; }
      if (stage && !existsSync(join(stage, e.sha256))) { const r = run('gh', ['release', 'download', i.tag, '--repo', i.repo, '--pattern', e.sha256, '--dir', stage], {}); if (r.status) { res.failed.push({ path: e.path, reason: `gh download failed: ${(r.stderr || '').trim()}` }); continue; } }
      const buf = readStore(source, e.sha256);
      if (!buf) { res.failed.push({ path: e.path, reason: 'blob not found in source' }); continue; }
      if (buf.length !== e.size || sha256(buf) !== e.sha256) { res.failed.push({ path: e.path, reason: 'sha256/size mismatch (corrupt or tampered blob); not written' }); continue; }
      if (!i.dryRun) { mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf); }
      res.fetched.push(e.path);
    }
  } finally { if (stage) rmSync(stage, { recursive: true, force: true }); }
  const data = { library: lib.dir, dryRun: !!i.dryRun, total: entries.length, ...res };
  return res.failed.length ? fail('TASK_FAILED', `${res.failed.length} blob(s) failed`, data) : ok(data, [`library.validate {library: "${lib.dir}"}`]);
}
