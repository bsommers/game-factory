# Asset libraries and the library registry

An **asset library** is a plain git repo of reusable game assets (sprites, characters, tilesets, sfx, songs, fx, fonts, levels, docs, code kits) that people, agents and software can discover without opening a single asset file. A **registry** merges many libraries (GitHub or local) into one searchable catalogue. Code: `factory-core/library/`; scaffold: `templates/asset-library/`; tests: `test/library/`.

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

`node --test test/library/`: schema validation, index determinism, install integrity and tamper detection, path-traversal/symlink/size rejection, publish confirm-first and secret refusal (via an injected runner), registry merge, filters, conflicts, offline mode, hostile remote libraries (injected git).
