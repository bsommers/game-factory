// Multi-library registry: registry.json lists library sources (GitHub owner/repo@ref or local paths); refresh fetches/validates them
// into a cache; the merged catalogue is searchable offline. All fetched content is untrusted: every library goes through loadLibrary()
// (schema, path traversal, symlink, size caps) and nothing from it is ever executed.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SCHEMAS, buildIndex, loadLibrary } from './format.mjs';
import { readJson, stableJson } from './safe.mjs';
import { validateSchema } from './schema-lite.mjs';

const ok = (data, next = []) => ({ ok: true, data, error: null, next });
const fail = (code, message, data = null, next = []) => ({ ok: false, data, error: { code, message }, next });
const GH_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:@([A-Za-z0-9][A-Za-z0-9._/-]{0,99}))?$/;
const slug = (s) => String(s).toLowerCase().replace(/\.git$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'library';

export const homeDir = (o = {}) => resolve(o.home || process.env.FACTORY_HOME || join(homedir(), '.game-factory'));
const paths = (o) => { const h = homeDir(o); return { home: h, reg: join(h, 'registry.json'), cache: join(h, 'cache'), cat: join(h, 'cache', 'catalogue.json') }; };

/** Classify a source string. -> { kind:'github', owner, repo, ref } | { kind:'local', path } | null */
export function parseSource(src) {
  if (typeof src !== 'string' || !src.trim() || src.includes('\0')) return null;
  const s = src.trim().replace(/^path:/, '');
  const explicitPath = src.trim().startsWith('path:') || isAbsolute(s) || s.startsWith('./') || s.startsWith('../') || s.startsWith('~');
  if (!explicitPath) { const m = GH_RE.exec(s); if (m && !(m[3] || '').includes('..')) return { kind: 'github', owner: m[1], repo: m[2], ref: m[3] || null }; }
  if (!explicitPath || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null; // neither owner/repo nor an explicit path (./x, ../x, /x, ~/x, path:x); URLs are refused
  return { kind: 'local', path: resolve(s.startsWith('~') ? join(homedir(), s.slice(1)) : s) };
}

function loadReg(o) {
  const p = paths(o);
  if (!existsSync(p.reg)) return { reg: { formatVersion: 1, libraries: [] }, p };
  const reg = readJson(p.reg); const e = validateSchema(SCHEMAS.registry, reg);
  if (e.length) throw new Error(`registry.json invalid: ${e[0]}`);
  return { reg, p };
}
const saveReg = (p, reg) => { mkdirSync(p.home, { recursive: true }); reg.libraries.sort((a, b) => (a.id < b.id ? -1 : 1)); writeFileSync(p.reg, stableJson(reg)); };
const guard = (fn) => (i = {}) => { try { return fn(i); } catch (e) { return fail('REGISTRY_ERROR', e.message); } };

export const registryList = guard((o) => { const { reg, p } = loadReg(o); const cat = readCat(p); return ok({ home: p.home, libraries: reg.libraries.map((l) => ({ ...l, status: cat?.libraries.find((x) => x.id === l.id)?.status || 'not-refreshed' })) }); });

export const registryAdd = guard((i) => {
  const src = parseSource(i.source);
  if (!src) return fail('BAD_INPUT', 'source must be "owner/repo[@ref]" or a local path (URLs are not accepted)');
  const { reg, p } = loadReg(i);
  const norm = src.kind === 'github' ? `${src.owner}/${src.repo}${src.ref ? '@' + src.ref : ''}` : src.path;
  const id = i.id ? i.id : slug(src.kind === 'github' ? src.repo : basename(src.path));
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return fail('BAD_INPUT', 'id must match ^[a-z0-9][a-z0-9-]{0,63}$');
  const same = reg.libraries.find((l) => l.source === norm);
  if (same) return ok({ id: same.id, source: norm, unchanged: true });
  if (reg.libraries.some((l) => l.id === id)) return fail('CONFLICT', `id "${id}" is already used by ${reg.libraries.find((l) => l.id === id).source}; pass a different id`);
  reg.libraries.push({ id, source: norm, ...(i.note ? { note: String(i.note).slice(0, 300) } : {}) });
  saveReg(p, reg);
  return ok({ id, source: norm, home: p.home }, ['registry.refresh {}', `registry.search {query: "..."}`]);
});

export const registryRemove = guard((i) => {
  const { reg, p } = loadReg(i), key = i.id || i.source;
  if (!key) return fail('BAD_INPUT', 'id or source is required');
  const l = reg.libraries.find((x) => x.id === key || x.source === key || x.source === (parseSource(key)?.path));
  if (!l) return fail('NOT_FOUND', `no library "${key}" in the registry`);
  reg.libraries = reg.libraries.filter((x) => x !== l); saveReg(p, reg);
  const dir = join(p.cache, l.id); if (existsSync(dir) && /^[a-z0-9-]+$/.test(l.id)) rmSync(dir, { recursive: true, force: true });
  buildCatalogue(reg, p, { offline: true });
  return ok({ removed: l.id });
});

const defaultRun = (cmd, args, o) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 120000, ...o });

function fetchRemote(l, src, p, run) {
  const tmp = join(p.cache, `.tmp-${l.id}-${process.pid}`);
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(p.cache, { recursive: true });
  const refArgs = src.ref ? ['--branch', src.ref] : [];
  const url = `https://github.com/${src.owner}/${src.repo}.git`;
  let r = run('git', ['-c', 'core.symlinks=false', '-c', 'core.hooksPath=/dev/null', 'clone', '--depth', '1', '--no-tags', '--single-branch', ...refArgs, '--', url, tmp], {});
  if (r.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    r = run('gh', ['repo', 'clone', `${src.owner}/${src.repo}`, tmp, '--', '--depth', '1', ...refArgs], {});
    if (r.status !== 0) { rmSync(tmp, { recursive: true, force: true }); return { error: `fetch failed: ${(r.stderr || r.error?.message || '').toString().trim().split('\n').pop()}` }; }
  }
  rmSync(join(tmp, '.git'), { recursive: true, force: true });
  const lib = loadLibrary(tmp);
  if (lib.errors.length) { rmSync(tmp, { recursive: true, force: true }); return { error: `invalid library: ${lib.errors.slice(0, 3).join('; ')}`, errors: lib.errors }; }
  const dest = join(p.cache, l.id); rmSync(dest, { recursive: true, force: true }); renameSync(tmp, dest);
  return { dir: dest };
}

const readCat = (p) => { try { return existsSync(p.cat) ? readJson(p.cat) : null; } catch { return null; } };

function buildCatalogue(reg, p, { offline = false, run = defaultRun, only = null } = {}) {
  const libs = [], assets = [], notes = [];
  const prev = readCat(p);
  for (const l of reg.libraries) {
    const src = parseSource(l.source), entry = { id: l.id, source: l.source, status: 'ok' };
    let dir = null;
    if (!src) { entry.status = 'bad-source'; libs.push(entry); continue; }
    if (src.kind === 'local') dir = src.path;
    else {
      const cached = join(p.cache, l.id);
      if ((!only || only === l.id) && !offline) {
        const f = fetchRemote(l, src, p, run);
        if (f.error) { entry.status = existsSync(cached) ? 'stale' : 'fetch-failed'; entry.error = f.error; if (existsSync(cached)) dir = cached; } else dir = f.dir;
      } else if (existsSync(cached)) { dir = cached; entry.status = 'cached'; } else { entry.status = 'not-fetched'; }
    }
    if (dir && existsSync(dir)) {
      const lib = loadLibrary(dir);
      if (lib.errors.length) { entry.status = 'invalid'; entry.error = lib.errors.slice(0, 3).join('; '); }
      else {
        const idx = buildIndex(lib);
        Object.assign(entry, { name: lib.manifest.name, version: lib.manifest.version, license: lib.manifest.license, description: lib.manifest.description, hash: idx.library.hash, assets: idx.assets.length, dir });
        for (const a of idx.assets) assets.push({ ...a, library: l.id, key: `${l.id}:${a.id}` });
      }
    } else if (src.kind === 'local') { entry.status = 'missing'; entry.error = `path not found: ${src.path}`; }
    libs.push(entry);
  }
  // conflicts: same asset id offered by several libraries
  const byId = new Map(); for (const a of assets) (byId.get(a.id) || byId.set(a.id, []).get(a.id)).push(a);
  const conflicts = [];
  for (const [id, list] of [...byId].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length < 2) continue;
    const hashes = new Set(list.map((x) => x.hash));
    conflicts.push({ id, kind: hashes.size === 1 ? 'duplicate' : 'conflict', libraries: list.map((x) => ({ library: x.library, version: x.version, hash: x.hash })) });
  }
  const names = new Map(); for (const l of libs.filter((x) => x.name)) (names.get(l.name) || names.set(l.name, []).get(l.name)).push(l.id);
  for (const [n, ids] of names) if (ids.length > 1) conflicts.push({ id: `library:${n}`, kind: 'library-name', libraries: ids.map((x) => ({ library: x })) });
  assets.sort((a, b) => (a.key < b.key ? -1 : 1));
  const cat = { formatVersion: 1, libraries: libs, assets, conflicts };
  mkdirSync(p.cache, { recursive: true }); writeFileSync(p.cat, stableJson(cat));
  return { cat, notes, prev };
}

export const registryRefresh = guard((i) => {
  const { reg, p } = loadReg(i);
  if (i.id && !reg.libraries.some((l) => l.id === i.id)) return fail('NOT_FOUND', `no library "${i.id}"`);
  const { cat } = buildCatalogue(reg, p, { offline: !!i.offline, run: i.exec || defaultRun, only: i.id || null });
  const bad = cat.libraries.filter((l) => !['ok', 'cached'].includes(l.status));
  const data = { home: p.home, offline: !!i.offline, libraries: cat.libraries.map(({ id, status, name, version, assets, error }) => ({ id, status, name, version, assets, error })), assets: cat.assets.length, conflicts: cat.conflicts };
  return ok(data, bad.length ? ['some libraries could not be fetched or are invalid; see libraries[].error'] : ['registry.search {query: "..."}']);
});

function catalogueFor(i) {
  const { reg, p } = loadReg(i);
  let cat = readCat(p), note = null;
  if (!cat || i.refresh) {
    const r = buildCatalogue(reg, p, { offline: !!i.offline || !i.refresh, run: i.exec || defaultRun }); cat = r.cat;
    if (!i.refresh) note = 'catalogue built from local sources and the existing cache (no network); run registry.refresh to fetch remote libraries';
  }
  return { cat, note, reg, p };
}

const tokens = (q) => String(q || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase());

export const registrySearch = guard((i) => {
  const { cat, note } = catalogueFor(i), toks = tokens(i.query), types = asList(i.type), tags = asList(i.tag ?? i.tags), lic = asList(i.license), libs = asList(i.library);
  const hits = [];
  for (const a of cat.assets) {
    if (types.length && !types.includes(a.type)) continue;
    if (lic.length && !lic.includes(String(a.license).toLowerCase())) continue;
    if (libs.length && !libs.includes(a.library)) continue;
    const at = a.tags.map((t) => t.toLowerCase());
    if (tags.some((t) => !at.includes(t))) continue;
    let score = 0, good = true;
    for (const t of toks) {
      const s = (a.id.toLowerCase() === t ? 10 : a.id.toLowerCase().includes(t) ? 5 : 0) + ((a.name || '').toLowerCase().includes(t) ? 4 : 0) + (at.some((x) => x === t || x.includes(t)) ? 3 : 0) + ((a.description || '').toLowerCase().includes(t) ? 1 : 0) + (a.type === t ? 3 : 0);
      if (!s) { good = false; break; } score += s;
    }
    if (good) hits.push({ score, a });
  }
  hits.sort((x, y) => y.score - x.score || (x.a.key < y.a.key ? -1 : 1));
  const lim = Math.min(500, Math.max(1, i.limit || 50)), confl = new Set(cat.conflicts.map((c) => c.id));
  const lib = new Map(cat.libraries.map((l) => [l.id, l]));
  const results = hits.slice(0, lim).map(({ a, score }) => ({ key: a.key, id: a.id, library: a.library, type: a.type, name: a.name, description: a.description, version: a.version, tags: a.tags, license: a.license, size: a.size, duration: a.duration, hash: a.hash, preview: a.preview && lib.get(a.library)?.dir ? join(lib.get(a.library).dir, a.preview) : undefined, conflict: confl.has(a.id) || undefined, score }));
  return ok({ total: hits.length, results, conflicts: cat.conflicts.filter((c) => results.some((r) => r.id === c.id)), offline: !!i.offline, note }, results.length ? ['registry.show {id}', 'library.install {registryId, assets:[id], project}'] : []);
});

export const registryShow = guard((i) => {
  if (!i.id) return fail('BAD_INPUT', 'id is required ("asset-id" or "library:asset-id")');
  const { cat } = catalogueFor(i);
  const [lq, aid] = i.id.includes(':') && cat.libraries.some((l) => l.id === i.id.split(':')[0]) ? [i.id.split(':')[0], i.id.slice(i.id.indexOf(':') + 1)] : [i.library || null, i.id];
  const found = cat.assets.filter((a) => a.id === aid && (!lq || a.library === lq));
  if (!found.length) return fail('NOT_FOUND', `no asset "${i.id}" in the catalogue`);
  const items = found.map((a) => {
    const l = cat.libraries.find((x) => x.id === a.library); let descriptor = null;
    try { descriptor = readJson(join(l.dir, a.descriptor)); } catch { /* cache gone */ }
    return { key: a.key, library: { id: l.id, name: l.name, version: l.version, license: l.license, source: l.source, status: l.status }, descriptor: descriptor || a, preview: a.preview ? join(l.dir, a.preview) : undefined };
  });
  return ok({ matches: items, conflicts: cat.conflicts.filter((c) => c.id === aid) }, [`library.install {registryId: "${found[0].library}", assets: ["${aid}"], project: <dir>}`]);
});

/** Resolve a registered library id to its on-disk directory (for library.install). */
export function resolveLibraryDir(id, o = {}) {
  try {
    const { cat } = catalogueFor({ ...o, refresh: false, offline: true });
    const l = cat.libraries.find((x) => x.id === id);
    if (!l) return fail('NOT_FOUND', `no library "${id}" in the registry`);
    if (!l.dir) return fail('NOT_FETCHED', `library "${id}" is ${l.status}; run registry.refresh first`);
    return ok({ dir: l.dir, source: l.source });
  } catch (e) { return fail('REGISTRY_ERROR', e.message); }
}
