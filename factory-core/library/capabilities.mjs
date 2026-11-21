// library.* and registry.* capabilities in the core registry format:
//   { name, summary, inputSchema, outputSchema, handler(input) -> { ok, data, error, next } | Promise<same> }
// library.add is async (it imports the source project's art/audio modules); everything else is synchronous.
import { newLibrary, addAssets, validateLibrary, indexLibrary, publishLibrary, installAssets, verifyInstalled } from './ops.mjs';
import { registryAdd, registryRemove, registryRefresh, registrySearch, registryShow, registryList } from './registry.mjs';
import { ASSET_TYPES } from './format.mjs';

const outputSchema = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const str = (description) => ({ type: 'string', description });
const strs = (description) => ({ type: 'array', items: { type: 'string' }, description });
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const home = { home: str('registry home directory (default $FACTORY_HOME or ~/.game-factory)') };
const types = { type: 'array', items: { enum: ASSET_TYPES } };

export const capabilities = [
  { name: 'library.new', summary: 'Scaffold a new asset-library repo (library.json, assets/, INDEX files, standalone validator, CI workflow).',
    inputSchema: obj({ name: str('library name, ^[a-z0-9][a-z0-9-]{0,63}$'), dir: str('target directory (default ./<name>)'), description: str('one-line description'), license: str('SPDX license id (default CC0-1.0)'), author: str('author') }, ['name']),
    outputSchema, handler: (i) => newLibrary(i) },
  { name: 'library.add', summary: 'Import assets into a library from a game project (adapter pixbuf-web: sprites, characters, tilesets, fx, sfx, songs, tagged style:<id>) and/or plain files; writes descriptors and previews, regenerates the index. Existing assets with different content need update:true (patch version bump).',
    inputSchema: obj({ library: str('library directory'),
      from: obj({ project: str('game project directory'), adapter: str('adapter name (default pixbuf-web)'), names: strs('only these source names, e.g. colby_idle'), types, game: str('game name used for ids/tags'), style: str('style id to tag as style:<id> (default: read from the project)') }, ['project']),
      files: { type: 'array', items: obj({ path: str('file to add'), id: str('asset id'), type: { enum: ASSET_TYPES }, name: str('name'), description: str('description'), tags: strs('tags'), source: str('provenance note') }, ['path']) },
      types, tags: strs('extra tags for every added asset'), license: str('override license'), author: str('override author'), update: { type: 'boolean' } }, ['library']),
    outputSchema, handler: (i) => addAssets(i) },
  { name: 'library.validate', summary: 'Validate a library: schemas, content hashes, path safety (no traversal or symlinks), size caps, dependencies, and that INDEX files are current.',
    inputSchema: obj({ library: str('library directory'), checkIndex: { type: 'boolean', description: 'also require INDEX files to be current (default true)' } }, ['library']),
    outputSchema, handler: (i) => validateLibrary(i) },
  { name: 'library.index', summary: 'Regenerate INDEX.json and INDEX.md (deterministic, no timestamps), or with check:true only report staleness.',
    inputSchema: obj({ library: str('library directory'), check: { type: 'boolean' } }, ['library']),
    outputSchema, handler: (i) => indexLibrary(i) },
  { name: 'library.publish', summary: 'Create and push a GitHub repo for a library via gh. Confirm-first: without yes:true it only returns the plan. Refuses when secrets are detected. Never run without explicit user instruction.',
    inputSchema: obj({ library: str('library directory'), repo: str('"name" or "owner/name" (default: library name)'), visibility: { enum: ['public', 'private'], description: 'default private' }, yes: { type: 'boolean', description: 'explicit confirmation' } }, ['library']),
    outputSchema, handler: (i) => publishLibrary(i) },
  { name: 'library.install', summary: 'Copy assets (and their in-library dependencies) into a game project, verifying sha256 before and after copying, and write/update assets.lock.json. Never executes anything.',
    inputSchema: obj({ project: str('game project directory'), library: str('library directory (or use registryId)'), registryId: str('id of a registered library'), assets: strs('asset ids'), all: { type: 'boolean' }, dest: str('destination under the project (default assets/library)'), yes: { type: 'boolean', description: 'overwrite differing files' }, dryRun: { type: 'boolean' }, source: str('provenance string recorded in the lock'), ...home }, ['project']),
    outputSchema, handler: (i) => installAssets(i) },
  { name: 'library.verify', summary: 'Check installed assets against assets.lock.json: reports modified, missing or tampered files.',
    inputSchema: obj({ project: str('game project directory') }, ['project']),
    outputSchema, handler: (i) => verifyInstalled(i) },
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
