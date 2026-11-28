// library.* and registry.* capabilities in the core registry format:
//   { name, summary, inputSchema, outputSchema, handler(input) -> { ok, data, error, next } | Promise<same> }
// library.add is async (it imports the source project's art/audio modules); everything else is synchronous.
import { newLibrary, addAssets, validateLibrary, indexLibrary, publishLibrary, installAssets, verifyInstalled } from './ops.mjs';
import { licenseAudit, licenseSet, attribution, ipReview } from './license.mjs';
import { registryAdd, registryRemove, registryRefresh, registrySearch, registryShow, registryList } from './registry.mjs';
import { ASSET_TYPES } from './format.mjs';

const outputSchema = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const str = (description) => ({ type: 'string', description });
const strs = (description) => ({ type: 'array', items: { type: 'string' }, description });
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const home = { home: str('registry home directory (default $FACTORY_HOME or ~/.game-factory)') };
const types = { type: 'array', items: { enum: ASSET_TYPES } };
const bool = (description) => ({ type: 'boolean', description });
const liStatus = { enum: ['verified', 'self-owned', 'needs-review', 'unknown', 'blocked'] };
const attrib = obj({ required: { type: 'boolean' }, text: str('credit text'), url: str('credit url') });
const licenseInfo = obj({ spdx: str('SPDX id or LicenseRef-<x>'), status: liStatus, redistribute: { type: 'boolean' }, commercialUse: { type: 'boolean' }, attribution: attrib, licenseFile: str('file inside the asset dir'), evidence: strs('where the license claim comes from'), verifiedBy: str('human sign-off name'), verifiedAt: str('date') }, ['status']);
const provenance = { type: 'object', description: 'source, generator, tool, jobId, plan (free|pro|studio|enterprise|unknown), visibility (private|community), prompt, sourceUrl, derivedFrom[], game, note' };
const free = (description) => ({ type: 'object', description });

export const capabilities = [
  { name: 'library.new', summary: 'Scaffold a new asset-library repo (library.json, assets/, INDEX files, standalone validator, CI workflow).',
    inputSchema: obj({ name: str('library name, ^[a-z0-9][a-z0-9-]{0,63}$'), dir: str('target directory (default ./<name>)'), description: str('one-line description'), license: str('SPDX license id (default CC0-1.0)'), author: str('author') }, ['name']),
    outputSchema, handler: (i) => newLibrary(i) },
  { name: 'library.add', summary: 'Import assets into a library from a game project (adapter pixbuf-web: sprites, characters, tilesets, fx, sfx, songs, tagged style:<id>) and/or plain files; writes descriptors and previews, regenerates the index. Existing assets with different content need update:true (patch version bump).',
    inputSchema: obj({ library: str('library directory'),
      from: obj({ project: str('game project directory'), adapter: str('adapter name (default pixbuf-web)'), names: strs('only these source names, e.g. colby_idle'), types, game: str('game name used for ids/tags'), style: str('style id to tag as style:<id> (default: read from the project)') }, ['project']),
      files: { type: 'array', items: obj({ path: str('file to add'), id: str('asset id'), type: { enum: ASSET_TYPES }, name: str('name'), description: str('description'), tags: strs('tags'), source: str('provenance note'), license: str('SPDX license for this file'), licenseInfo, provenance, ipReview: free('{status: clear|flagged|unchecked, notes}'), model: free('tris, verts, materials, rig{type,bones,skinned,skeletonHash}, clips[] (read from .glb when omitted)'), animation: free('targetRig, skeletonHash, clips[]'), audio: free('codec, sampleRate, channels, loopable, bpm, loudnessLufs'), version: str('semver (default 1.0.0)') }, ['path']) },
      types, tags: strs('extra tags for every added asset'), license: str('override license'), author: str('override author'), update: { type: 'boolean' }, allowDuplicate: bool('allow a model/animation/texture file whose sha256 already exists in another asset') }, ['library']),
    outputSchema, handler: (i) => addAssets(i) },
  { name: 'library.validate', summary: 'Validate a library: schemas, content hashes, path safety (no traversal or symlinks), size caps, dependencies, and that INDEX files are current.',
    inputSchema: obj({ library: str('library directory'), checkIndex: { type: 'boolean', description: 'also require INDEX files to be current (default true)' }, target: { enum: ['public', 'private'], description: 'also run the license gate (data.licenseAudit); public fails with LICENSE_BLOCKED' } }, ['library']),
    outputSchema, handler: (i) => validateLibrary(i) },
  { name: 'library.index', summary: 'Regenerate INDEX.json and INDEX.md (deterministic, no timestamps), or with check:true only report staleness.',
    inputSchema: obj({ library: str('library directory'), check: { type: 'boolean' } }, ['library']),
    outputSchema, handler: (i) => indexLibrary(i) },
  { name: 'library.publish', summary: 'Create and push a GitHub repo for a library via gh. Confirm-first: without yes:true it only returns the plan. Refuses when secrets are detected. Never run without explicit user instruction.',
    inputSchema: obj({ library: str('library directory'), repo: str('"name" or "owner/name" (default: library name)'), visibility: { enum: ['public', 'private'], description: 'default private; public runs the license gate and fails with LICENSE_BLOCKED' }, yes: { type: 'boolean', description: 'explicit confirmation' } }, ['library']),
    outputSchema, handler: (i) => publishLibrary(i) },
  { name: 'library.install', summary: 'Copy assets (and their in-library dependencies) into a game project, verifying sha256 before and after copying, and write/update assets.lock.json. Never executes anything.',
    inputSchema: obj({ project: str('game project directory'), library: str('library directory (or use registryId)'), registryId: str('id of a registered library'), assets: strs('asset ids'), all: { type: 'boolean' }, dest: str('destination under the project (default assets/library)'), yes: { type: 'boolean', description: 'overwrite differing files' }, dryRun: { type: 'boolean' }, source: str('provenance string recorded in the lock'), maxFileBytes: { type: 'integer', minimum: 1, description: 'consumer cap per file (overrides the library limits)' }, ...home }, ['project']),
    outputSchema, handler: (i) => installAssets(i) },
  { name: 'library.verify', summary: 'Check installed assets against assets.lock.json: reports modified, missing or tampered files.',
    inputSchema: obj({ project: str('game project directory') }, ['project']),
    outputSchema, handler: (i) => verifyInstalled(i) },
  { name: 'library.license-set', summary: 'Record license info for an asset. Marking it verified or self-owned is the human sign-off and needs confirm:true (stamps verifiedBy/verifiedAt).',
    inputSchema: obj({ library: str('library directory'), id: str('asset id'), ids: strs('several asset ids'), spdx: str('SPDX id or LicenseRef-<x> (also sets the descriptor license)'), status: liStatus, redistribute: { type: 'boolean' }, commercialUse: { type: 'boolean' }, attribution: attrib, evidence: strs('evidence'), licenseFile: str('license text file inside the asset dir'), verifiedBy: str('who signs off (default user)'), verifiedAt: str('date (default today)'), confirm: bool('explicit human confirmation, required for verified/self-owned') }, ['library']),
    outputSchema, handler: (i) => licenseSet(i) },
  { name: 'library.license-audit', summary: 'Dry-run of the public-publish gate: lists blocked assets with reasons (unknown/needs-review/NC/ND, free-plan Meshy not CC-BY, unresolved ipReview, stale ATTRIBUTION.md). Fails LICENSE_BLOCKED for target public. fixMeshy derives Meshy license fields from plan and visibility (never verifies).',
    inputSchema: obj({ library: str('library directory'), target: { enum: ['public', 'private'], description: 'default public; private only warns' }, allowList: strs('allowed SPDX ids (trailing * wildcard); default from library.json licensePolicy or built-in'), fixMeshy: bool('write derived Meshy license fields') }, ['library']),
    outputSchema, handler: (i) => licenseAudit(i) },
  { name: 'library.attribution', summary: 'Generate ATTRIBUTION.md (library) or CREDITS.md (installed project, from assets.lock.json) for assets that require attribution; deterministic.',
    inputSchema: obj({ library: str('library directory'), project: str('game project directory (uses assets.lock.json)'), format: { enum: ['md', 'json'] }, write: bool('write the file (default true)') }),
    outputSchema, handler: (i) => attribution(i) },
  { name: 'library.ip-review', summary: 'Keyword tripwire for trademarked characters, real brands, landmarks and map data in names, tags and prompts; flagged assets block a public publish until set {status: clear, confirm: true}. A tripwire only: a miss is not clearance.',
    inputSchema: obj({ library: str('library directory'), ids: strs('only these assets'), write: bool('record ipReview flags in descriptors (default true)'), set: obj({ id: str('asset id'), status: { enum: ['clear', 'flagged', 'unchecked'] }, notes: str('review notes'), reviewedBy: str('reviewer'), confirm: bool('required for clear') }, ['id', 'status']) }, ['library']),
    outputSchema, handler: (i) => ipReview(i) },
  { name: 'registry.add', summary: 'Add a library source (GitHub owner/repo@ref, or a local path) to registry.json.',
    inputSchema: obj({ source: str('owner/repo[@ref] or local path'), id: str('registry id (default from repo/dir name)'), note: str('note'), ...home }, ['source']),
    outputSchema, handler: (i) => registryAdd(i) },
  { name: 'registry.remove', summary: 'Remove a library source from registry.json and drop its cache.',
    inputSchema: obj({ id: str('registry id'), source: str('or the source string'), ...home }),
    outputSchema, handler: (i) => registryRemove(i) },
  { name: 'registry.list', summary: 'List registered library sources and their last known status.',
    inputSchema: obj({ ...home }), outputSchema, handler: (i) => registryList(i) },
  { name: 'registry.refresh', summary: 'Fetch (git clone --depth 1, fallback gh) and validate remote libraries into the cache and rebuild the merged catalogue with conflict report. offline:true skips the network and uses the cache.',
    inputSchema: obj({ id: str('only this library'), offline: { type: 'boolean' }, ...home }), outputSchema, handler: (i) => registryRefresh(i) },
  { name: 'registry.search', summary: 'Search the merged catalogue (works offline from the cache) with type/tag/license/library filters; flags assets offered by several libraries.',
    inputSchema: obj({ query: str('words matched against id, name, tags, description'), type: { anyOf: [{ enum: ASSET_TYPES }, types] }, tag: { anyOf: [{ type: 'string' }, strs('tags (all required)')] }, license: { anyOf: [{ type: 'string' }, strs('licenses')] }, library: str('restrict to a registry id'), limit: { type: 'integer', minimum: 1, maximum: 500 }, refresh: { type: 'boolean', description: 'fetch before searching' }, offline: { type: 'boolean' }, ...home }),
    outputSchema, handler: (i) => registrySearch(i) },
  { name: 'registry.show', summary: 'Show one catalogue asset in full (descriptor, library, preview path, conflicts). id is "asset-id" or "library:asset-id".',
    inputSchema: obj({ id: str('asset id or library:asset-id'), library: str('disambiguate'), ...home }, ['id']), outputSchema, handler: (i) => registryShow(i) },
];

export function registerLibrary(registry) {
  for (const c of capabilities) {
    if (Array.isArray(registry)) registry.push(c);
    else if (registry instanceof Map) registry.set(c.name, c);
    else if (registry && typeof registry.register === 'function') registry.register(c);
    else throw new TypeError('registerLibrary: unsupported registry');
  }
  return registry;
}
export default capabilities;
