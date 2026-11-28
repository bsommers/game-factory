# game-factory improvement plan from the Lantern Run dogfood

Source: building `~/src/fun/lantern-run` with `scripts/bootstrap.sh --new` (web scaffold) as one agent, no swarm. Game-side plan: `~/src/fun/lantern-run/docs/IMPROVEMENT-PLAN.md`. Each item has evidence; fix, then add a test under `test/`.

| # | Finding (evidence) | Fix | State |
|---|---|---|---|
| 1 | Scaffold `package.json` was named `game`, so artifact names were `game-*` | name from the title slug | fixed (`bin/factory-scaffold.sh`, `test/web-pkg.test.mjs`) |
| 2 | `src/levels/difficulty.js`, `size.js`, `test/levels/transforms.test.mjs` and `startmenu` assume MicroMaze levels (`registers`, `waves`, `mouse`, `Pete`, `tiles`); a generic level throws, and the scaffold's own test fails once you change them | ship generic transforms (a simple `{w,h,entities}` shape) plus a documented "replace me" contract, or move the MicroMaze ones to `kits/examples` | open |
| 3 | Scaffold bundles every `src/kits` and `src/lib` module: 349 KB for a 2D toy, 220+ unused tests | `factory new --web --with kits=audio,fx,...` (opt-in) or tree-shake the module map | open |
| 4 | `package.json` test glob lists fixed dirs; a new `test/sim/` was silently not run | `node --test test/` recursive, or glob `test/**/*.test.mjs` | open (lantern-run patched by hand) |
| 5 | The botplay contract (5 files, names, signatures) is only in a header comment of `tools/botplay.mjs`; `verify.sh` runs it `|| true` | template `src/sim/*` stubs + `docs/BOTPLAY.md`; make verify fail below the 80% bar | open |
| 6 | `startmenu`: `close(true)` calls `onResume`, so `onResume: () => menu.close(true)` recurses forever (hit in this build) | document in the menu header, or make `close` idempotent and re-entrancy-safe; add a test | open |
| 7 | `smoke_web.sh` / `smoke:desktop` only check that the page loads and serves; they passed while the packaged game could not load its levels (`fetch(new URL(..., import.meta.url))` breaks in the single file) | convention: `?autostart=1` plus `window.__game`; smoke runs the bot (or N frames) and asserts the sim advanced; add the pitfall to `docs/LEARNINGS.md` | open |
| 8 | `build-web.mjs` module map included Node-only modules, so esbuild failed and the build silently fell back to unbundled (and the desktop smoke then failed with "app.js not served") | skip modules importing `node:*` | fixed; make the unbundled fallback fail `package-desktop` instead of warning |
| 9 | Kits exist (audio, fx, world-gen, autopilot) but I never found or used them; `guide route` was not consulted, and the scaffold README/AGENTS never point at it | `guide.check` and the generated `AGENTS.md` should list kits relevant to the style; add a "reuse before write" check to the swarm playbook | open (my miss, partly a discoverability gap) |
| 10 | Swarm tracker, `ARCHITECTURE.md` contract, style presets: skipped because the game was small; `guide check` still reports them as warnings | decide whether a "solo mode" scaffold should hide them; otherwise exercise the swarm on the next game | open |
| 11 | Windows/macOS archives and installers are built but never run on those OSes | run on a Windows VM / mac; until then docs say untested | open |
| 12 | `factory sync` on a web project copied Godot scripts into it | fixed | fixed |
| 13 | `tools/check-imports.mjs` treated `import x from './a.json' with {type:'json'}` as a missing default export and failed `verify` | skip export checks for `.json` targets (existence still checked) | fixed (`test/web-pkg.test.mjs`) |
| 14 | `autopilot-kit`/botplay is the only difficulty oracle, but a stalling bot scored *worse* than a less skilled one; balance tests built on it can lie | ship a reference lookahead bot and a `balance.mjs` matrix in the template; document that bot parity with a novice means untested difficulty | open |

## Acceptance
- A new web game can `npm run verify && npm run build && npm run package && npm run smoke:web && npm run smoke:desktop` with zero edits to tooling.
- Each fixed item has a test that fails without the fix.
- Update `docs/BUILD-WEB.md` and `docs/LEARNINGS.md` as items close.
