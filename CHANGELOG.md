# Changelog

## Unreleased
- `web.validate-level`, `web.botplay`, `web.sheet`, `web.verify`, `web.serve` capabilities (registry, HTTP, MCP, Go/Rust/Python clients).
- `--web` scaffolds ship generic `tools/validate-level.mjs`, `tools/botplay.mjs` and `scripts/verify.sh` (levels discovered from `src/levels/*.json`); package.json gains `verify` and `lint:imports`.
- `--web` scaffolds no longer include the 7 `test/lib` tests that read factory-root `spec/` or `test/helpers` (they failed outside the factory).
- `tools/web/sheet.mjs` creates nested output dirs; `tools/web/serve.mjs` honours `SERVE_HOST`.
- pixbuf-web library adapter: exports sibling resolution variants (`px16/x` -> `px32/x`, tagged `variant:px32`) and per-frame PNGs for animated items. Character lore stays game-specific.
