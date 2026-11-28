// library.blobs-* capabilities (binaries out of git, sha256-addressed). library.attribution and library.ip-review already exist in ./capabilities.mjs.
import { blobsPack, blobsPublish, blobsFetch } from './blobs.mjs';

const outputSchema = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const str = (description) => ({ type: 'string', description });
const strs = (description) => ({ type: 'array', items: { type: 'string' }, description });
const bool = (description) => ({ type: 'boolean', description });
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });

export const blobCapabilities = [
  { name: 'library.blobs-pack', summary: 'Hash a library\'s binary files (glb, png, ogg, ...) and write the text manifest blobs/MANIFEST.txt (sha256, size, content-type, path). store optionally copies blobs into a local content-addressed dir. No network.',
    inputSchema: obj({ library: str('library directory'), paths: strs('library-relative files to pack (default: every binary under assets/)'), store: str('local blob store directory; files are copied as <sha256>') }, ['library']),
    outputSchema, handler: (i) => blobsPack(i) },
  { name: 'library.blobs-publish', summary: 'Upload manifest blobs as GitHub Release assets named by sha256 via gh. dryRun defaults to true (plan only, no gh call). A public publish runs the license/IP gate and fails LICENSE_BLOCKED when any asset is blocked or ipReview is flagged/unresolved.',
    inputSchema: obj({ library: str('library directory'), repo: str('owner/name (required unless dryRun)'), tag: str('release tag (default blobs-<manifest hash>)'), visibility: { enum: ['public', 'private'], description: 'default private' }, dryRun: bool('default true; set false to really upload (explicit user instruction only)') }, ['library']),
    outputSchema, handler: (i) => blobsPublish(i) },
  { name: 'library.blobs-fetch', summary: 'Restore manifest blobs into a library by sha256 from a local directory / file:// store (or a GitHub release via gh when repo+tag are given), verifying size and hash before writing.',
    inputSchema: obj({ library: str('library directory'), source: str('blob store: directory path or file:// URL (files named <sha256>)'), repo: str('owner/name of a release holding the blobs (alternative to source)'), tag: str('release tag (with repo)'), paths: strs('only these manifest paths'), yes: bool('overwrite files whose content differs'), dryRun: bool('verify only, write nothing') }, ['library']),
    outputSchema, handler: (i) => blobsFetch(i) },
];

export function registerBlobs(registry) {
  for (const c of blobCapabilities) {
    if (Array.isArray(registry)) registry.push(c);
    else if (registry instanceof Map) registry.set(c.name, c);
    else if (registry && typeof registry.register === 'function') registry.register(c);
    else throw new TypeError('registerBlobs: unsupported registry');
  }
  return registry;
}
export default blobCapabilities;
