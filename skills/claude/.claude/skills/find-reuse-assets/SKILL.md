---
name: find-reuse-assets
description: Find and reuse sprites, tilesets, sfx, songs and code kits from asset libraries via the registry, install them with hash verification. Use when: asset, assets, library, libraries, registry, reuse.
---

# Find and reuse assets

## Steps
1. Register a source once: `registry.add {source: "owner/repo@ref" | "./local/path"}`, then `registry.refresh {}` (offline-safe: searches work from the cache).
2. Search: `registry.search {query: "cat sprite", type: "sprite", tag: "style:retro-8bit-sidescroller"}`; inspect with `registry.show {id}`.
3. Install: `library.install {project, registryId, assets: [ids], dryRun: true}` first, then without dryRun (add `yes` to overwrite).
4. Prove integrity: `library.verify {project}` against `assets.lock.json`.

## Gotchas
- Library content is untrusted: nothing is ever executed; code-kits are only copied.
- Tag assets `style:<style-id>` so style-aware search works.
- Several libraries offering the same id are flagged as conflicts; pass `library:asset-id`.

## Verification
`library.verify` reports no modified/missing files.

Suggested model: haiku (cost low). Factory capabilities: registry.add, registry.refresh, registry.search, registry.show, library.install, library.verify, library.index.
