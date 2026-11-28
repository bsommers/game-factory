# game-factory improvement plan from the Lantern Run dogfood

Source: building `~/src/fun/lantern-run` with `scripts/bootstrap.sh --new` (web scaffold) as one agent, no swarm. Game-side plan: `~/src/fun/lantern-run/docs/IMPROVEMENT-PLAN.md`. Each item has evidence; fix, then add a test under `test/`.

> Authorship: rows in the table below and the Acceptance section are from the prior **Claude** dogfood agent. Sections marked **[Composer]** are this reviewer’s additions (2026-11-28).

| # | Finding (evidence) | Fix | State |
|---|---|---|---|
| 1 | Scaffold `package.json` was named `game`, so artifact names were `game-*` | name from the title slug | fixed (`bin/factory-scaffold.sh`, `test/web-pkg.test.mjs`) |
| 2 | `src/levels/difficulty.js`, `size.js`, `test/levels/transforms.test.mjs` and `startmenu` assume MicroMaze levels (`registers`, `waves`, `mouse`, `Pete`, `tiles`); a generic level throws, and the scaffold's own test fails once you change them | ship generic transforms (a simple `{w,h,entities}` shape) plus a documented "replace me" contract, or move the MicroMaze ones to `kits/examples` | fixed (generic+MicroMaze example; Composer PR #1) |
| 3 | Scaffold bundles every `src/kits` and `src/lib` module: 349 KB for a 2D toy, 220+ unused tests | `factory new --web --with kits=audio,fx,...` (opt-in) or tree-shake the module map | fixed (opt-in `--with kits=`; Composer PR #1) |
| 4 | `package.json` test glob lists fixed dirs; a new `test/sim/` was silently not run | `node --test test/` recursive, or glob `test/**/*.test.mjs` | fixed (`node --test test/**/*.test.mjs`; Node 24 rejects `test/` as a dir; Composer PR #1) |
| 5 | The botplay contract (5 files, names, signatures) is only in a header comment of `tools/botplay.mjs`; `verify.sh` runs it `|| true` | template `src/sim/*` stubs + `docs/BOTPLAY.md`; make verify fail below the 80% bar | fixed (stubs+BOTPLAY.md; verify enforces bar; Composer PR #1) |
| 6 | `startmenu`: `close(true)` calls `onResume`, so `onResume: () => menu.close(true)` recurses forever (hit in this build) | document in the menu header, or make `close` idempotent and re-entrancy-safe; add a test | fixed (re-entrancy-safe close + test; Composer PR #1) |
| 7 | `smoke_web.sh` / `smoke:desktop` only check that the page loads and serves; they passed while the packaged game could not load its levels (`fetch(new URL(..., import.meta.url))` breaks in the single file) | convention: `?autostart=1` plus `window.__game`; smoke runs the bot (or N frames) and asserts the sim advanced; add the pitfall to `docs/LEARNINGS.md` | fixed (smoke asserts `__game.t>0`; LEARNINGS; Composer PR #1) |
| 8 | `build-web.mjs` module map included Node-only modules, so esbuild failed and the build silently fell back to unbundled (and the desktop smoke then failed with "app.js not served") | skip modules importing `node:*` | fixed (+ `package-desktop` rejects unbundled; Composer PR #1) |
| 9 | Kits exist (audio, fx, world-gen, autopilot) but I never found or used them; `guide route` was not consulted, and the scaffold README/AGENTS never point at it | `guide.check` and the generated `AGENTS.md` should list kits relevant to the style; add a "reuse before write" check to the swarm playbook | fixed (AGENTS.md + PLAYBOOK reuse; Composer PR #1) |
| 10 | Swarm tracker, `ARCHITECTURE.md` contract, style presets: skipped because the game was small; `guide check` still reports them as warnings | decide whether a "solo mode" scaffold should hide them; otherwise exercise the swarm on the next game | fixed (`--solo` + guide.check info; Composer PR #1) |
| 11 | Windows/macOS archives and installers are built but never run on those OSes | run on a Windows VM / mac; until then docs say untested | open (docs honest; runtime still untested) |
| 12 | `factory sync` on a web project copied Godot scripts into it | fixed | fixed |
| 13 | `tools/check-imports.mjs` treated `import x from './a.json' with {type:'json'}` as a missing default export and failed `verify` | skip export checks for `.json` targets (existence still checked) | fixed (`test/web-pkg.test.mjs`) |
| 14 | `autopilot-kit`/botplay is the only difficulty oracle, but a stalling bot scored *worse* than a less skilled one; balance tests built on it can lie | ship a reference lookahead bot and a `balance.mjs` matrix in the template; document that bot parity with a novice means untested difficulty | fixed (lookahead bot + `tools/balance.mjs`; Composer PR #1) |

## Acceptance
- A new web game can `npm run verify && npm run build && npm run package && npm run smoke:web && npm run smoke:desktop` with zero edits to tooling.
- Each fixed item has a test that fails without the fix.
- Update `docs/BUILD-WEB.md` and `docs/LEARNINGS.md` as items close.

---

## [Composer] Relation to PR #1 (2026-11-28)

Open PR: https://github.com/bsommers/game-factory/pull/1  
`dogfood/lantern-run-improvements` → `main` (42 commits; ~multilang + Lantern Run packaging). PR body notes the open PLAN-DOGFOOD items were **not** in that push.

**Plan change:** do **not** open a second PR. Land Composer review + item execution as follow-up commits on the same head branch and **update PR #1** (description + push). Base stays `main`. Only one open PR on the repo at check time.

## [Composer] Review (2026-11-28)

Verdict: the dogfood findings are real and well-evidenced. Priority should be **scaffold correctness for a non-MicroMaze game** (2, 4, 5, 6) and **packaging honesty** (7, 8 follow-up) before kit-size / solo-mode polish (3, 9, 10). Item 11 is documentation until a Mac/Windows run is scheduled.

### Agreement with Claude (keep as written)
- Items 1, 12, 13 are correctly marked fixed.
- Item 6 is a clear defect; idempotent / re-entrancy-safe `close` beats docs-only.
- Item 4 is a one-line fix with outsized value; do it immediately.
- Item 7 + LEARNINGS pitfall is the right smoke bar; load-only smokes hid the JSON-import regression.
- Item 14’s “bot can lie” warning belongs in `docs/BOTPLAY.md` next to the contract.

### [Composer] Refinements / ordering
1. **Item 2 — prefer “generic default + MicroMaze example”, not kit relocation only.** Ship `applyDifficulty` / `applySize` that no-op (or scale generic `entities[].{x,y,hp,speed,count}`) when MicroMaze keys are absent; keep MicroMaze transforms as `src/levels/examples/micromaze-transforms.js` (or under `kits/examples`) so lantern-run / MicroMaze can opt in. Startmenu copy that says “defend a store” / Pete must become placeholders.
2. **Item 3 — opt-in kits, default `none` (or `core`).** Full kit+lib copy is the dogfood pain; `--with kits=audio,fx` (comma list) plus always-copy `lib` primitives used by smoke is enough for v1. Tree-shaking the module map is a follow-up if bundle size still hurts. Do **not** remove kits from the factory template; only stop copying them all into every new game.
3. **Item 5 — stubs must make `verify` green out of the box.** Empty/stub sim that always “wins” at ≥80% is wrong (masks games); better: ship a tiny playable stub level + bot that clears ≥80%, *or* gate the 80% bar behind `src/sim/game.js` existing **and** document that replacing the stub means verify becomes the real gate. Prefer: stub sim + one JSON level + lookahead bot that clears; `|| true` removed.
4. **Item 8 follow-up — fail hard on unbundled when packaging desktop.** `package-desktop` should refuse `UNBUNDLED` / missing `dist/web/app.js` (exit nonzero). Keep unbundled as a local-dev escape hatch for `build` alone if desired, but not for ship.
5. **Item 9 — wire `templates/AGENTS.game.md` into scaffold.** Checkpoint claims bootstrap ships it; `factory-scaffold.sh` currently writes a thin README and never copies AGENTS. Fix: copy `templates/AGENTS.game.md` → `AGENTS.md`, mention `bin/factory guide route`, `docs/KITS.md`, and “reuse before write”.
6. **Item 10 — `--solo` flag, don’t silently hide warnings.** Solo mode: scaffold skips swarm tracker copy / softens `guide.check` swarm warnings to info; still recommend `ARCHITECTURE.md` as a one-pager. Default remains swarm-ready.
7. **Item 11 — docs already partially honest in `BUILD-WEB.md`.** Mark “untested on Win/mac installers” in Acceptance until a real VM/ssh run; no fake “fixed”.
8. **Item 14 — reference bot in template `src/sim/autopilot.js` + `tools/balance.mjs`.** Document skill bands and that “skill 0 clears 100%” means the level is untested for humans. Don’t block ship on matrix tuning.

### [Composer] Out of scope this PR (park)
- Real Windows VM / Mac installer execution (item 11 runtime).
- Full module-map tree-shaking beyond kit opt-in (item 3 stretch).
- Changing lantern-run itself (lives outside this repo).

### [Composer] Execution waves
| Wave | Items | Model tier |
|---|---|---|
| A | 4, 6, 8-followup, 11-docs | fast / mechanical |
| B | 2, 5, 7, 14 | standard+ (tests) |
| C | 3, 9, 10 | standard+ (scaffold/UX) |

### [Composer] Acceptance addenda
- Fresh `factory new /tmp/gf-dogfood "Dogfood Toy" --web` then `npm test && npm run verify && npm run build` succeeds without editing MicroMaze-shaped levels.
- `onResume: () => menu.close(true)` does not stack-overflow (unit test).
- `npm test` picks up `test/sim/*.test.mjs` without editing `package.json` globs.
- `package-desktop` fails if the web build was unbundled / lacks `app.js`.
- New games get `AGENTS.md` pointing at kits + `guide route`.
