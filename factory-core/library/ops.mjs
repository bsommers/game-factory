// Library operations. Every function returns { ok, data, error, next } (core registry result format).
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ASSET_TYPES, FORMAT_VERSION, SCHEMAS, assetHash, fingerprint, loadLibrary, writeIndex } from './format.mjs';
import { isSafeRel, readInside, readJson, resolveInside, sha256, stableJson, walkTree } from './safe.mjs';
import { validateSchema } from './schema-lite.mjs';
import { resolveLibraryDir } from './registry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const FACTORY_ROOT = resolve(here, '..', '..');
export const ok = (data, next = []) => ({ ok: true, data, error: null, next });
export const fail = (code, message, data = null, next = []) => ({ ok: false, data, error: { code, message }, next });
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CORE_FILES = ['schema-lite.mjs', 'safe.mjs', 'format.mjs', 'validate-cli.mjs', 'png.mjs'];

// ------------------------------------------------------------------ library.new
export function newLibrary(i = {}) {
  const name = i.name;
  if (!name || !NAME_RE.test(name)) return fail('BAD_INPUT', 'name must match ^[a-z0-9][a-z0-9-]{0,63}$');
  const dir = resolve(i.dir || name);
  if (existsSync(dir) && readdirSync(dir).length) return fail('EXISTS', `${dir} exists and is not empty`);
  const tpl = join(FACTORY_ROOT, 'templates', 'asset-library');
  if (!existsSync(tpl)) return fail('MISSING_TEMPLATE', `template not found: ${tpl}`);
  const sub = { __NAME__: name, __DESCRIPTION__: (i.description || `Reusable game assets: ${name}`).replace(/["\\\n]/g, ' '), __LICENSE__: (i.license || 'CC0-1.0').replace(/["\\\n]/g, ' '), __AUTHOR__: (i.author || 'unknown').replace(/["\\\n]/g, ' ') };
  const written = [];
  const copyTpl = (rel) => {
    const src = join(tpl, rel), st = lstatSync(src);
    if (st.isDirectory()) { for (const n of readdirSync(src).sort()) copyTpl(rel ? `${rel}/${n}` : n); return; }
    const out = join(dir, rel.replace(/\.tmpl$/, ''));
    mkdirSync(dirname(out), { recursive: true });
    let txt = readFileSync(src, 'utf8'); for (const [k, v] of Object.entries(sub)) txt = txt.split(k).join(v);
    writeFileSync(out, txt); written.push(rel.replace(/\.tmpl$/, ''));
  };
  copyTpl('');
  for (const f of CORE_FILES) { mkdirSync(join(dir, 'tools', 'library'), { recursive: true }); copyFileSync(join(here, f), join(dir, 'tools', 'library', f)); written.push(`tools/library/${f}`); }
  cpSync(join(here, 'schemas'), join(dir, 'tools', 'library', 'schemas'), { recursive: true }); written.push('tools/library/schemas/');
  const idx = writeIndex(dir);
  if (!idx.ok) return fail('INVALID', 'scaffold failed validation', { errors: idx.errors });
  return ok({ dir, name, written: written.sort(), index: idx.changed }, [`library.add {library: "${dir}", from: {project: <game dir>}}`, `library.validate {library: "${dir}"}`]);
}

// ------------------------------------------------------------------ library.validate / library.index
export function validateLibrary(i = {}) {
  if (!i.library) return fail('BAD_INPUT', 'library (path) is required');
  const r = loadLibrary(i.library);
  const data = { library: r.dir, name: r.manifest?.name, version: r.manifest?.version, assets: r.assets.length, errors: r.errors, warnings: r.warnings };
  if (!r.errors.length && i.checkIndex !== false) {
    const c = writeIndex(r.dir, { check: true });
    if (!c.ok) { data.errors = [...c.errors]; data.stale = c.stale; return fail('STALE_INDEX', 'INDEX files are out of date; run library.index', data, [`library.index {library: "${r.dir}"}`]); }
  }
  return r.errors.length ? fail('INVALID', `${r.errors.length} problem(s)`, data) : ok(data);
}
export function indexLibrary(i = {}) {
  if (!i.library) return fail('BAD_INPUT', 'library (path) is required');
  const r = writeIndex(i.library, { check: !!i.check });
  if (!r.ok) return fail(i.check ? 'STALE_INDEX' : 'INVALID', r.errors.join('; ') || 'index failed', { errors: r.errors, stale: r.stale });
  return ok({ changed: r.changed, assets: r.index.counts.total, byType: r.index.counts.byType, hash: r.index.library.hash, warnings: r.warnings });
}

// ------------------------------------------------------------------ library.add
const bumpPatch = (v) => v.replace(/^(\d+)\.(\d+)\.(\d+)/, (_, a, b, c) => `${a}.${b}.${+c + 1}`);
/** items: [{ id, type, name?, description?, tags?, format?, size?, duration?, palette?, provenance?, dependencies?, files:[{path,data}], preview?:{path,data} }] */
export function addItems(libDir, items, { update = false, author, license, tags = [] } = {}) {
  const lib = loadLibrary(libDir);
  if (lib.errors.length) return fail('INVALID', 'target library is invalid; fix it first', { errors: lib.errors });
  const m = lib.manifest, added = [], updated = [], unchanged = [], conflicts = [], plan = [];
  const existing = new Map(lib.assets.map((a) => [a.id, a.descriptor]));
  for (const it of items) {
    const errs = [];
    if (!it.id || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(it.id)) errs.push(`bad id ${JSON.stringify(it.id)}`);
    if (!ASSET_TYPES.includes(it.type)) errs.push(`bad type ${it.type}`);
    if (!it.files?.length) errs.push('no files');
    for (const f of it.files || []) if (!isSafeRel(f.path) || f.path === 'asset.json') errs.push(`unsafe file path ${f.path}`);
    if (it.preview && !isSafeRel(it.preview.path)) errs.push(`unsafe preview path ${it.preview.path}`);
    if (errs.length) return fail('BAD_INPUT', `${it.id}: ${errs.join('; ')}`);
    const files = [...it.files].sort((a, b) => (a.path < b.path ? -1 : 1)).map((f) => ({ path: f.path, sha256: sha256(f.data), bytes: f.data.length }));
    const hash = assetHash(files), prev = existing.get(it.id);
    const meta = { tags: [...new Set([...(it.tags || []), ...tags])].sort(), license: it.license || license || m.license, author: it.author || author || m.authors?.[0] || 'unknown' };
    const previewSame = !prev || !it.preview || (prev.preview === it.preview.path);
    if (prev && prev.hash === hash && previewSame && JSON.stringify(prev.tags) === JSON.stringify(meta.tags)) { unchanged.push(it.id); continue; }
    if (prev && prev.hash !== hash && !update) { conflicts.push(it.id); continue; }
    plan.push({ it, files, hash, prev, meta });
  }
  const known = new Set([...existing.keys(), ...items.map((x) => x.id)]);
  for (const it of items) for (const d of it.dependencies || []) if (!d.library && !known.has(d.id)) return fail('BAD_INPUT', `${it.id}: dependency ${d.id} is neither in the library nor in this batch`);
  if (conflicts.length) return fail('CONFLICT', `assets already exist with different content: ${conflicts.join(', ')} (pass update:true to replace and bump the patch version)`, { conflicts });
  for (const { it, files, hash, prev, meta } of plan) {
    const d = join(lib.dir, 'assets', it.id);
    if (prev) rmSync(d, { recursive: true, force: true });
    mkdirSync(d, { recursive: true });
    for (const f of it.files) { const p = resolveInside(d, f.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, f.data); }
    if (it.preview) { const p = resolveInside(d, it.preview.path); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, it.preview.data); }
    const desc = { id: it.id, type: it.type, version: prev ? (prev.hash === hash ? prev.version : bumpPatch(prev.version)) : (it.version || '1.0.0'), tags: meta.tags, license: meta.license, author: meta.author, files, hash };
    for (const k of ['name', 'description', 'format', 'size', 'duration', 'palette', 'provenance', 'dependencies']) if (it[k] !== undefined) desc[k] = it[k];
    if (it.preview) desc.preview = it.preview.path;
    const errs = validateSchema(SCHEMAS.asset, desc);
    if (errs.length) return fail('BAD_INPUT', `${it.id}: ${errs.join('; ')}`);
    writeFileSync(join(d, 'asset.json'), stableJson(desc));
    (prev ? updated : added).push(it.id);
  }
  const types = new Set(m.assetTypes); for (const { it } of plan) types.add(it.type);
  if (types.size !== m.assetTypes.length) { m.assetTypes = ASSET_TYPES.filter((t) => types.has(t)); writeFileSync(join(lib.dir, 'library.json'), stableJson(m)); }
  const idx = writeIndex(lib.dir);
  if (!idx.ok) return fail('INVALID', 'library invalid after add', { errors: idx.errors });
  return ok({ library: lib.dir, added, updated, unchanged, total: idx.index.counts.total }, [`library.validate {library: "${lib.dir}"}`, `library.publish {library: "${lib.dir}", repo: "owner/${m.name}"}`]);
}

export async function addAssets(i = {}) {
  if (!i.library) return fail('BAD_INPUT', 'library (path) is required');
  const items = [];
  if (i.from) {
    const adapterName = i.from.adapter || 'pixbuf-web';
    let adapter;
    try { adapter = await import(`./adapters/${/^[a-z0-9-]+$/.test(adapterName) ? adapterName : 'invalid'}.mjs`); } catch { return fail('BAD_INPUT', `unknown adapter ${adapterName}`); }
    if (!i.from.project) return fail('BAD_INPUT', 'from.project is required');
    try { items.push(...await adapter.collect({ project: resolve(i.from.project), include: i.from.include, types: i.from.types, names: i.from.names, game: i.from.game, styleTag: i.from.style })); }
    catch (e) { return fail('IMPORT_FAILED', e.message); }
  }
  for (const f of i.files || []) {
    try {
      const src = resolve(f.path), st = lstatSync(src);
      if (!st.isFile() || st.isSymbolicLink()) return fail('BAD_INPUT', `not a regular file: ${f.path}`);
      const data = readFileSync(src), ext = extname(src).slice(1).toLowerCase(), id = f.id || basename(src, extname(src)).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      const type = f.type || ({ png: 'sprite', wav: 'sfx', ogg: 'sfx', ttf: 'font', woff2: 'font', md: 'doc', json: 'level', js: 'code-kit', mjs: 'code-kit' }[ext] || 'doc');
      items.push({ id, type, name: f.name || id, description: f.description, tags: f.tags || [], format: ext, files: [{ path: basename(src), data }], preview: ext === 'png' ? { path: 'preview.png', data } : undefined, provenance: { source: f.source || 'imported file' } });
    } catch (e) { return fail('BAD_INPUT', `${f.path}: ${e.message}`); }
  }
  if (!items.length) return fail('BAD_INPUT', 'nothing to add: pass from {project} and/or files [{path}]');
  const typeFilter = i.types && i.types.length ? new Set(i.types) : null;
  const sel = items.filter((x) => (!typeFilter || typeFilter.has(x.type)));
  return addItems(i.library, sel, { update: !!i.update, author: i.author, license: i.license, tags: i.tags || [] });
}

// ------------------------------------------------------------------ library.publish
const SECRET_NAMES = [/^\.env(\.|$)/i, /\.(pem|key|p12|pfx|kdbx)$/i, /^id_(rsa|dsa|ecdsa|ed25519)/, /^credentials(\.|$)/i, /^\.npmrc$/, /^\.netrc$/];
const SECRET_BODY = [[/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'], [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'], [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'], [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'], [/\bsk-[A-Za-z0-9_-]{32,}/, 'API secret key'], [/(api[_-]?key|secret|token|passwd|password)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/i, 'credential assignment']];
const BINARY = new Set(['.png', '.wav', '.ogg', '.mp3', '.gif', '.jpg', '.jpeg', '.woff', '.woff2', '.ttf']);
export function scanSecrets(dir) {
  const { files } = walkTree(dir), hits = [];
  for (const f of files) {
    const n = basename(f);
    if (SECRET_NAMES.some((r) => r.test(n))) { hits.push({ file: f, reason: 'sensitive file name' }); continue; }
    if (BINARY.has(extname(n).toLowerCase())) continue;
    let txt; try { const b = readInside(dir, f, 4 << 20); if (b.includes(0)) continue; txt = b.toString('utf8'); } catch { continue; }
    for (const [re, why] of SECRET_BODY) if (re.test(txt)) { hits.push({ file: f, reason: why }); break; }
  }
  return hits;
}
export function publishLibrary(i = {}, run = (cmd, args, o) => spawnSync(cmd, args, { encoding: 'utf8', ...o })) {
  if (!i.library) return fail('BAD_INPUT', 'library (path) is required');
  const v = validateLibrary({ library: i.library });
  if (!v.ok) return fail('INVALID', 'library must validate before publishing', v.data);
  const dir = v.data.library, repo = i.repo || `${v.data.name}`, vis = i.visibility === 'public' ? 'public' : 'private';
  if (!/^([A-Za-z0-9-]{1,39}\/)?[A-Za-z0-9._-]{1,100}$/.test(repo)) return fail('BAD_INPUT', 'repo must be "name" or "owner/name"');
  const hits = scanSecrets(dir);
  if (hits.length) return fail('SECRETS_FOUND', `refusing to publish: ${hits.length} possible secret(s)`, { hits });
  const commands = [!existsSync(join(dir, '.git')) ? 'git init -b main' : null, 'git add -A', `git commit -m "Publish ${v.data.name} ${v.data.version}"`, `gh repo create ${repo} --${vis} --source . --push --description "<library description>"`].filter(Boolean);
  const plan = { repo, visibility: vis, library: dir, assets: v.data.assets, commands, note: 'This creates a GitHub repository and pushes the whole library directory.' };
  if (!i.yes) return fail('CONFIRM_REQUIRED', 'publishing is confirm-first: re-run with yes:true (CLI --yes) after reviewing the plan', plan, [`library.publish {library: "${dir}", repo: "${repo}", yes: true}`]);
  const desc = (loadLibrary(dir).manifest?.description || '').slice(0, 300);
  const steps = [];
  const sh = (cmd, args) => { const r = run(cmd, args, { cwd: dir }); steps.push({ cmd: [cmd, ...args].join(' '), status: r.status }); return r; };
  if (!existsSync(join(dir, '.git'))) { const r = sh('git', ['init', '-b', 'main']); if (r.status) return fail('GIT_FAILED', r.stderr || 'git init failed', { steps }); }
  for (const a of [['add', '-A'], ['commit', '-m', `Publish ${v.data.name} ${v.data.version}`]]) { const r = sh('git', a); if (r.status && !/nothing to commit/.test((r.stdout || '') + (r.stderr || ''))) return fail('GIT_FAILED', r.stderr || r.stdout || 'git failed', { steps }); }
  const r = sh('gh', ['repo', 'create', repo, `--${vis}`, '--source', '.', '--push', '--description', desc]);
  if (r.status) return fail('GH_FAILED', (r.stderr || r.stdout || 'gh failed').trim(), { steps });
  return ok({ ...plan, steps, url: (r.stdout || '').trim() });
}

// ------------------------------------------------------------------ library.install / library.verify
const LOCK = 'assets.lock.json';
export function installAssets(i = {}) {
  try { return installImpl(i); } catch (e) { return fail('UNSAFE', e.message); }
}
function installImpl(i) {
  if (!i.project) return fail('BAD_INPUT', 'project (game directory) is required');
  let libDir = i.library;
  if (!libDir && i.registryId) { const r = resolveLibraryDir(i.registryId, i); if (!r.ok) return r; libDir = r.data.dir; }
  if (!libDir) return fail('BAD_INPUT', 'library (path) or registryId is required');
  const dest = i.dest || 'assets/library';
  if (!isSafeRel(dest)) return fail('BAD_INPUT', `unsafe dest ${dest}`);
  const proj = resolve(i.project);
  if (!existsSync(proj)) return fail('BAD_INPUT', `project not found: ${proj}`);
  const lib = loadLibrary(libDir);
  if (lib.errors.length) return fail('INVALID', 'library failed validation; nothing installed', { errors: lib.errors });
  const byId = new Map(lib.assets.map((a) => [a.id, a]));
  const want = i.assets?.length ? i.assets : (i.all ? [...byId.keys()] : null);
  if (!want) return fail('BAD_INPUT', 'pass assets: [ids] (or all: true)');
  const order = [], seen = new Set();
  const take = (id) => { if (seen.has(id)) return; const a = byId.get(id); if (!a) throw new Error(`asset not found in library: ${id}`); seen.add(id); for (const d of a.descriptor.dependencies || []) { if (d.library) throw new Error(`${id} depends on external library asset ${d.id} (${d.library}); install it from there first`); take(d.id); } order.push(id); };
  try { want.forEach(take); } catch (e) { return fail('NOT_FOUND', e.message); }
  let lock = { lockVersion: 1, assets: [] };
  const lockPath = join(proj, LOCK);
  if (existsSync(lockPath)) { try { lock = readJson(lockPath); const e = validateSchema(SCHEMAS.lock, lock); if (e.length) return fail('BAD_LOCK', `existing ${LOCK} invalid: ${e[0]}`); } catch (e) { return fail('BAD_LOCK', `existing ${LOCK} unreadable: ${e.message}`); } }
  const copies = [], conflicts = [], unchanged = [];
  for (const id of order) {
    const a = byId.get(id), d = a.descriptor, base = `${dest}/${id}`;
    const payload = [...d.files.map((f) => f.path), 'asset.json', ...(d.preview && !d.files.some((f) => f.path === d.preview) ? [d.preview] : [])];
    const bufs = [];
    for (const p of payload) { const b = readInside(a.dir, p); if (p !== 'asset.json' && !d.files.some((f) => f.path === p)) { bufs.push([p, b]); continue; } const f = d.files.find((x) => x.path === p); if (f && sha256(b) !== f.sha256) return fail('INTEGRITY', `${id}/${p}: hash mismatch, aborting`); bufs.push([p, b]); }
    let same = true, exists = false;
    for (const [p, b] of bufs) { const t = resolveInside(proj, `${base}/${p}`); if (existsSync(t)) { exists = true; if (!readFileSync(t).equals(b)) same = false; } else same = false; }
    const prior = lock.assets.find((x) => x.id === id);
    if (exists && !same && !i.yes) conflicts.push(id);
    else if (same && prior && prior.hash === d.hash) unchanged.push(id);
    copies.push({ id, base, bufs, desc: d, same });
  }
  if (conflicts.length) return fail('CONFLICT', `destination already has different files for: ${conflicts.join(', ')} (pass yes:true to overwrite)`, { conflicts });
  if (i.dryRun) return ok({ dryRun: true, would: order.map((id) => `${dest}/${id}`), unchanged });
  const installed = [];
  for (const c of copies) {
    for (const [p, b] of c.bufs) { const t = resolveInside(proj, `${c.base}/${p}`); mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, b); }
    // verify what actually landed on disk
    for (const f of c.desc.files) { const got = sha256(readInside(proj, `${c.base}/${f.path}`)); if (got !== f.sha256) return fail('INTEGRITY', `${c.desc.id}/${f.path}: post-copy hash mismatch`); }
    const entry = { id: c.desc.id, version: c.desc.version, type: c.desc.type, library: { name: lib.manifest.name, version: lib.manifest.version, ...(i.source ? { source: String(i.source) } : {}) }, hash: c.desc.hash, dest: c.base, files: c.desc.files.map((f) => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })) };
    lock.assets = lock.assets.filter((x) => x.id !== entry.id); lock.assets.push(entry); installed.push(entry.id);
  }
  lock.assets.sort((a, b) => (a.id < b.id ? -1 : 1));
  writeFileSync(lockPath, stableJson(lock));
  return ok({ project: proj, installed, unchanged, lock: LOCK, dest }, [`library.verify {project: "${proj}"}`]);
}

export function verifyInstalled(i = {}) {
  if (!i.project) return fail('BAD_INPUT', 'project is required');
  const proj = resolve(i.project), lockPath = join(proj, LOCK);
  if (!existsSync(lockPath)) return fail('NO_LOCK', `${LOCK} not found in ${proj}`);
  let lock; try { lock = readJson(lockPath); } catch (e) { return fail('BAD_LOCK', e.message); }
  const errs = validateSchema(SCHEMAS.lock, lock); if (errs.length) return fail('BAD_LOCK', errs.join('; '));
  const problems = [];
  for (const a of lock.assets) {
    if (!isSafeRel(a.dest)) { problems.push({ id: a.id, problem: 'unsafe dest in lock' }); continue; }
    for (const f of a.files) {
      if (!isSafeRel(f.path)) { problems.push({ id: a.id, file: f.path, problem: 'unsafe path in lock' }); continue; }
      let b; try { b = readInside(proj, `${a.dest}/${f.path}`); } catch (e) { problems.push({ id: a.id, file: f.path, problem: /ENOENT/.test(e.message) ? 'missing' : e.message }); continue; }
      if (b.length !== f.bytes || sha256(b) !== f.sha256) problems.push({ id: a.id, file: f.path, problem: 'modified (hash mismatch)' });
    }
    if (assetHash(a.files) !== a.hash) problems.push({ id: a.id, problem: 'lock entry hash does not match its files (lock edited)' });
  }
  const data = { project: proj, assets: lock.assets.length, problems };
  return problems.length ? fail('TAMPERED', `${problems.length} integrity problem(s)`, data) : ok(data);
}
