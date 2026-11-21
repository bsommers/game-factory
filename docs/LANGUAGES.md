# Languages

`languages.list` / `languages.show {id}` report each language and probe its toolchain (found, version, or missing). `project.new {lang}` (CLI: `--lang X`; `--web` is an alias for `--lang js`) scaffolds a game; default is `gdscript`.

| id | kind | toolchain probe | template | packagers | status | scaffolded by |
|---|---|---|---|---|---|---|
| gdscript | game | `godot --version` | `templates/godot-project/` | godot-export | stable | `bin/factory-scaffold.sh` |
| js | game | `node --version` | `templates/web-project/` | neutralino, single-file-html | stable | `bin/factory-scaffold.sh --web` |
| go | game + client | `go version` | `templates/go-project/` | native-binary, wasm | preview | `factory-core/languages/scaffold.mjs` |
| rust | game + client | `rustc --version`, `cargo --version` | `templates/rust-project/` | native-binary, wasm | preview | `factory-core/languages/scaffold.mjs` |
| python | game + client | `python3 --version` | `templates/python-project/` | pyinstaller, nuitka | preview | `factory-core/languages/scaffold.mjs` |

Unknown `lang` returns `BAD_INPUT` listing the valid ids. If a template directory does not exist yet, `project.new` returns `NOT_FOUND`.

## Generic templates (go, rust, python)
A plain tree; `*.tmpl` files and all text files have `__NAME__` (title) and `__SLUG__` (kebab-case) replaced, and the `.tmpl` suffix is dropped. The scaffolder then copies `tools/` and `tools/swarm-tracker/`, the swarm docs, writes a `.gitignore`/README if absent, and runs `git init`.

## project.run dispatch
`Cargo.toml` -> cargo (`test`; `build` = `--release`; `check-imports` = `cargo check`). `go.mod` -> `go vet` + `go test ./...` / `go build ./...` / `go vet`. `pyproject.toml` -> `python3 -m pytest -q` / `compileall`. Otherwise the original npm/Godot behavior. Cargo uses `CARGO_TARGET_DIR` if set, else `/datanapps/cargo-target/<dirname>` when `/datanapps` exists.

## guide.route / guide.plan
Both take optional `language` (`web|rust|go|python`; CLI `--lang`) and `dir` (`--dir`, detects Cargo.toml / go.mod / pyproject.toml / package.json when `language` is absent). With neither, output is unchanged. When set: `data.language` = `{id, source, template, verify}`; `npm test|start` become the language's test/run command and web-only commands (node/.mjs) are dropped, with test/build/run appended to `commands`; kits keep only the ported engine ones (platformer-physics, hazard-kit, world-gen, autopilot-kit, with a `port` path) unless `includeWebOnly: true`; `guide.plan` uses `templates/<lang>-project` paths for file ownership (e.g. `crates/engine/src/physics.rs`, `internal/engine/worldgen.go`, `src/game/engine/world_gen.py`), starts from core/levels/ui (art/audio/fx only when the goal asks, owning `assets/...`), and drops the Pages site. Code: `factory-core/guide/language.mjs`.
