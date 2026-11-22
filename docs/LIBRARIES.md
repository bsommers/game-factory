# Asset libraries and the library registry

An **asset library** is a plain git repo of reusable game assets (sprites, characters, tilesets, sfx, songs, fx, fonts, levels, docs, code kits) that people, agents and software can discover without opening a single asset file. A **registry** merges many libraries (GitHub or local) into one searchable catalogue. Code: `factory-core/library/`; scaffold: `templates/asset-library/`; tests: `test/library/`, `test/library-v2.test.mjs`.

## Format

```
library.json              manifest: formatVersion, name, version (semver), license, description, tags, assetTypes
assets/<id>/asset.json    descriptor (one directory per asset; directory name == id)
assets/<id>/<files...>    payload files and the preview image
INDEX.json  INDEX.md      GENERATED (deterministic, no timestamps): machine and human catalogue with previews
tools/library/            standalone zero-dep validator/indexer (copied by `library.new`), .github/workflows/validate.yml
```

Descriptor fields: `id`, `type` (`sprite|character|tileset|sfx|song|fx|font|level|doc|code-kit`), `version`, `name`, `description`, `tags` (lowercase `[a-z0-9:._-]`; tag assets `style:<style-id>`, see `STYLES.md`), `license`, `author`, `provenance {game, generator, source, note}`, `format`, `palette`, `size {w,h,frames}` or `duration` (seconds), `files [{path, sha256, bytes}]`, `dependencies [{id, version?, library?}]`, `preview`, `hash`. `hash` is sha256 over the sorted `path\0sha256` lines of `files`, so it identifies the content regardless of metadata. Schemas: `factory-core/library/schemas/{library,asset,index,registry,lock}.schema.json`.

Validation (`library.validate`, also run in CI) checks: schemas; every file exists with the right size and sha256; `hash`; descriptor id equals directory; types are listed in `library.json`; dependencies resolve (version ranges `1.2.3`, `^`, `~`, `>=`, `*`) with no cycles; INDEX files are current; and, because libraries are untrusted input: only safe relative POSIX paths (no `..`, absolute, drive letters, backslashes), no symlinks or special files anywhere, caps (JSON 1 MiB, file 16 MiB, library 128 MiB, 5000 files, 2000 assets), and `__proto__` keys are rejected.

## Schema v2 (formatVersion 2, backward compatible)

New libraries are `formatVersion: 2`; v1 libraries load, validate, index and install unchanged (their INDEX files stay byte-identical). v2 adds, all optional in the schema:
- asset types `model|animation|texture|material|hdri|music`; `contentId` (same value as `hash`).
- `licenseInfo {spdx, status: verified|self-owned|needs-review|unknown|blocked, redistribute, commercialUse, attribution{required,text,url}, licenseFile, evidence[], verifiedBy, verifiedAt}`. `library.add` writes `needs-review` unless the item supplies one; only `library.license-set ... confirm:true` marks verified/self-owned. Changing the content of a signed-off asset (`update:true`) drops it back to `needs-review`.
- `provenance` gains `tool, jobId, plan (free|pro|studio|enterprise|unknown), visibility (private|community), prompt, sourceUrl, derivedFrom[]`; `ipReview {status: clear|flagged|unchecked, notes, hits}`.
- `model {tris, verts, materials, rig{type,bones,skinned,skeletonHash}, clips[{name,duration,loop,fps,file}], ...}`, `animation {targetRig, skeletonHash, clips}`, `audio {codec, sampleRate, channels, loopable, bpm, loudnessLufs}`. For `.glb` files `library.add` reads tris/verts/materials/clips/rig from the file (explicit values win).
- `library.json` `limits {fileBytes, libraryBytes}` raise the per-file / per-library caps (defaults 16 MiB / 128 MiB; ceiling 2 GiB / 64 GiB); a consumer cap (`loadLibrary(dir, {maxFileBytes})`, `library.install maxFileBytes`) always wins. `licensePolicy {allow[]}` overrides the SPDX allow-list; `releaseBase` is reserved for blob hosting.
- `library.add` reports `duplicates` (same sha256 in another asset) and refuses them with `DUPLICATE` for model/animation/texture/material/hdri/music unless `allowDuplicate:true`.

### Public-publish gate

`library.publish visibility:public` (also with no `yes`), `library.validate target:public` and the generated CI (`validate-cli.mjs audit . --public`, public repos only) fail with `LICENSE_BLOCKED` unless every asset has: `licenseInfo.status` verified/self-owned (v1 descriptors count as unknown), `redistribute:true`, a license on the allow-list (default CC0-1.0, CC-BY-4.0, CC-BY-SA-4.0, MIT, Apache-2.0, `LicenseRef-Owner-*`, a few permissive others; NC/ND always denied), non-empty attribution text when required, a verifiedBy sign-off, no flagged or unresolved `ipReview`. Meshy assets (`provenance.generator: meshy`) also need `plan` and `visibility`; free plan must be CC-BY-4.0 with a credit; paid plan + `community` visibility needs a human sign-off. `ATTRIBUTION.md` must be current when any asset needs attribution. Private visibility never blocks. The IP scan is a keyword tripwire, not a clearance, and none of this is legal advice.

## Capabilities

All registered by `registerLibrary(registry)` / the `capabilities` array in `factory-core/library/capabilities.mjs`, in the core format `{name, summary, inputSchema, outputSchema, handler(input) -> {ok, data, error, next}}`. `library.add` is async (a Promise); the rest are synchronous. Errors carry stable `error.code`s.

| Capability | Purpose | Notable inputs |
|---|---|---|
| `library.new` | Scaffold a library repo | `name`, `dir`, `description`, `license`, `author` |
| `library.add` | Import assets, write descriptors and previews, re-index | `library`, `from {project, adapter, names, types, style, game}`, `files [{path,id,type,tags}]`, `update` |
| `library.validate` | Check a library (incl. INDEX freshness) | `library` |
| `library.index` | Regenerate INDEX.json / INDEX.md | `library`, `check` |
| `library.publish` | `gh repo create --source . --push`; confirm-first | `library`, `repo`, `visibility` (default private), `yes` |
| `library.install` | Copy assets plus in-library dependencies into a game, verify sha256 before and after, write `assets.lock.json` | `project`, `library` or `registryId`, `assets`/`all`, `dest` (default `assets/library`), `yes`, `dryRun` |
| `library.verify` | Compare installed files with `assets.lock.json` (modified/missing/tampered) | `project` |
| `library.license-set` | Record license info; `verified`/`self-owned` is the human sign-off and needs `confirm:true` | `library`, `id`/`ids`, `spdx`, `status`, `redistribute`, `commercialUse`, `attribution`, `evidence`, `confirm` |
| `library.license-audit` | Dry-run of the public gate; `LICENSE_BLOCKED` with reasons per asset for `target: public` | `library`, `target`, `allowList`, `fixMeshy` |
| `library.attribution` | Write `ATTRIBUTION.md` (library) or `CREDITS.md` (project, from `assets.lock.json`) | `library` or `project`, `format`, `write` |
| `library.ip-review` | Keyword tripwire for trademarked characters, brands, landmarks, map data; records `ipReview`; `set {id,status:clear,confirm}` is the human decision | `library`, `ids`, `write`, `set` |
| `registry.add/remove/list` | Manage `registry.json` | `source` (`owner/repo[@ref]` or a local path), `id` |
| `registry.refresh` | `git clone --depth 1` (fallback `gh repo clone`), validate, cache, rebuild catalogue | `id`, `offline` |
| `registry.search` | Query the merged catalogue | `query`, `type`, `tag` (all must match), `license`, `library`, `limit`, `offline` |
| `registry.show` | One asset in full (`id` or `library:id`) | `id` |

Safety rules baked in: `library.publish` never runs without `yes:true` (without it you only get the plan and a `CONFIRM_REQUIRED` error), refuses to run if it finds secrets (`.env`, `*.pem`, `id_rsa*`, tokens, private keys, credential assignments) and validates first. `library.install` aborts before copying anything if the library fails validation, never overwrites differing files without `yes`, never follows symlinks, and never executes anything (a `code-kit` is just copied). Remote libraries are fetched into a temp dir, `.git` removed, fully validated, and only then moved into the cache; a failing refetch keeps the previous cache (status `stale`).

### Registry home and catalogue

`$FACTORY_HOME` (default `~/.game-factory`; override per call with `home`): `registry.json`, `cache/<id>/` for remote libraries, `cache/catalogue.json`. Local-path sources are read in place. The catalogue lists libraries with a status (`ok`, `cached`, `stale`, `not-fetched`, `fetch-failed`, `invalid`, `missing`) and conflicts: `duplicate` (same asset id and identical content in several libraries), `conflict` (same id, different content), `library-name` (two sources whose manifests share a name). Search is offline by default (reads the cache; if no catalogue exists it is built from local sources and the cache, never the network). `registry.refresh` is the only call that touches the network. Refs must be branches or tags (`git clone --branch`).

## Human usage (CLI)

`node factory-core/library/cli.mjs <library|registry> <command> [args] [--flags] [--json]` works today; `factory-surface` wires `factory library ...` and `factory registry ...` to it.

```sh
C="node ~/src/fun/game-factory/factory-core/library/cli.mjs"
$C library new my-assets --description "Jungle tiles" --license CC0-1.0
$C library add ./my-assets --from ~/src/fun/pawfall --style retro-8bit-sidescroller   # sprites, sfx, songs
$C library validate ./my-assets && $C library index ./my-assets --check
$C library publish ./my-assets --repo me/my-assets            # prints the plan only
$C library publish ./my-assets --repo me/my-assets --yes      # really creates the repo
$C registry add me/my-assets@main && $C registry refresh
$C registry search colby --type character --tag style:retro-8bit-sidescroller
$C library install ~/src/fun/newgame --registry-id my-assets --assets pawfall.colby-run   # (flags map to input fields)
$C library verify ~/src/fun/newgame
```

CLI flag notes: `--assets a,b` and `--tags` take comma lists; `--from <dir>` means `from: {project}`; first positionals fill the first required fields.

## Agent usage

1. Discover: `registry.search {query, type, tag: ["style:<id>"], license}`; read `INDEX.json` of any library directly for a cheap overview. Results include preview image paths and a `conflict` flag.
2. Inspect: `registry.show {id}` returns the full descriptor, source library, conflicts.
3. Use: `library.install {project, registryId, assets: [id]}` then `library.verify {project}`; commit `assets.lock.json` with the game. Re-running install is idempotent.
4. Contribute: `library.add {library, from: {project}}` (idempotent; changed content needs `update:true`, which patch-bumps the version), `library.validate`, then ask the user before `library.publish`. Never pass `yes:true` to publish unless the user explicitly asked.
Tag everything `style:<id>` so `styles.apply`'s `libraryTags` output can be fed straight into `registry.search {tag}`.

## API usage (Node)

```js
import { capabilities, registerLibrary, installAssets, registrySearch } from '~/src/fun/game-factory/factory-core/library/index.mjs';
registerLibrary(myRegistry);                       // array | Map | {register(cap)}
registrySearch({ query: 'colby', type: 'character' }).data.results;
```

`library.add` adapters live in `factory-core/library/adapters/<name>.mjs` and export `collect({project, names, types, game, styleTag}) -> items[]` (`{id,type,name,description,tags,format,size,duration,palette,provenance,dependencies,files:[{path,data}],preview:{path,data}}`). The built-in `pixbuf-web` adapter reads games that follow the web-project pattern (`src/core/defs.js` exports `ART`, `SFX`, `MUSIC`; `src/art/<module>.js` `build()`; `src/audio/sfx.js`, `music.js`). It imports the project's own code, so only point it at your own projects. Mapping: colby/critters creatures -> `character`; items, hazards props, world sprites -> `sprite`; `kind: tile` -> `tileset`; the fx module -> `fx`; each SFX -> `sfx` (WAV 22.05 kHz mono plus the voices recipe JSON); each track -> `song` (WAV).

## MCP usage

Each capability maps one-to-one to an MCP tool (`library_new`, `library_add`, ..., `registry_search`, ...) exposed by `factory-surface` from the same registry entries; input and output schemas are the capability schemas. The same confirm-first rule applies: an MCP client must pass `yes: true` to `library_publish`, and agents should do so only on an explicit user instruction. HTTP exposure is the same, one route per capability.

## Example library

`~/src/fun/pawfall-assets` (local only, not pushed): 100 assets extracted from PawFall (17 characters, 28 sprites, 9 tilesets, 12 fx, 28 sfx, 6 songs), tagged `pawfall`, `module:<art module>`, `style:retro-8bit-sidescroller`, CC0-1.0. Regenerate it with `library.add` (idempotent). To publish after review:
`node factory-core/library/cli.mjs library publish ~/src/fun/pawfall-assets --repo <owner>/pawfall-assets --visibility public --yes`

## Tests

`node --test test/library/ test/library-v2.test.mjs`: schema validation, index determinism, install integrity and tamper detection, path-traversal/symlink/size rejection, publish confirm-first and secret refusal (via an injected runner), registry merge, filters, conflicts, offline mode, hostile remote libraries (injected git).
