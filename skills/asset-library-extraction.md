---
name: asset-library-extraction
description: Extract a game's reusable assets into its own CC0 asset-library repo (models, textures, hdri, sfx, songs) with raised size caps and the extra 3D asset types.
triggers: [asset library, extract assets, publish assets, cheesemageddon-assets, pawfall-assets, glb library, texture library, hdri library, library schema, size cap]
needs: [Node 22+, templates/asset-library]
outputs: [<game>-assets repo, library.json, INDEX.json, assets/*]
model: haiku
cost: low
capabilities: [library.verify, library.install]
---
# asset-library-extraction

## When to use
A game finished and its models/textures/audio should be reused by the next game (pattern: `pawfall-assets` for 2D, `cheesemageddon-assets` for 3D).

## Steps
1. Scaffold from `templates/asset-library`; one folder per asset id `assets/<game>.<name>/asset.json` with sha256 file hashes, licence (CC0-1.0 for Poly Haven), source slug.
2. 3D differences vs the 2D library: add `model`, `texture`, `hdri` to the `type` enum in both `asset.schema.json` and `library.schema.json` (`assetTypes`), and raise `tools/library/safe.mjs` limits from 16 MB per file / 128 MB library to 95 MB / 512 MB so rigged glb files and HDRIs fit.
3. Index: `INDEX.json` + `INDEX.md` list id, type, tags, bytes. Textures are grouped per set (color/normal/rough as one asset); a character is one glb plus preview PNGs and the builder script reference.
4. `library.verify` after install into a project; for very large blobs use `library.blobs-pack` (skill asset-library-blobs) so git stays small.
5. Credit sources in README; keep generated files byte-deterministic.

## Gotchas
- Do not silently raise the caps in the shared factory code: the factory's `factory-core/library/safe.mjs` and schemas are still 16/128 MB and 2D types only (as of this skill); a 3D library repo carries its own forked `tools/library`. Upstreaming the new types and caps is an open follow-up.
- Limits exist against untrusted input: keep per-file cap at what your largest glb needs, not unbounded.
- Licence gate first: only CC0/own work goes in.

## Verification
`node tools/library/validate-cli.mjs` passes in the library repo, `library.verify` ok after install, repo size within the library cap.
