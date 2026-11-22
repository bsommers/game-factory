---
name: asset-library-blobs
description: Pack, publish and fetch large asset blobs (models, textures, audio) for the shared asset library with integrity hashes, keeping the git index small. Use when: asset blobs, library blobs, pack blobs, publish blobs, fetch blobs, large assets.
---

# asset-library-blobs

## When to use
Pack, publish and fetch large asset blobs (models, textures, audio) for the shared asset library with integrity hashes, keeping the git index small.

## Steps
1. `library.blobs-pack {library}` hashes large files into blobs and writes the manifest.
2. `library.blobs-publish` uploads them to the configured store.
3. `library.blobs-fetch {project}` restores missing blobs; errors with BLOB_MISSING if absent.
4. `library.verify {project}` proves integrity.

## Gotchas
- Hashes are content addresses; never edit a blob in place.
- Respect the licence gate before publishing.

## Verification
`library.verify` ok after a fresh fetch; `node --test test/library-blobs.test.mjs` passes.

Suggested model: haiku (cost low). Factory capabilities: library.blobs-pack, library.blobs-publish, library.blobs-fetch, library.verify, library.install.
