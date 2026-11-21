# Learnings from PawFall (Pitfall! parody, zero-dep web game, 14+ parallel agents)

Source: the per-agent reports in `pawfall/docs/swarm/reports/`. Format: **what happened -> rule**. Pairs with `LEARNINGS-CATXZZON.md`.

## Contract and integration
- **A `*/` inside a `/** */` comment ends it early** (`/*feet*/` in a doc block broke `defs.js` parsing for the whole swarm). Use `//` for inline notes in doc blocks; the hazards agent had to mirror constants until it was fixed. Run `tools/check-imports.mjs` after every contract edit.
- **Guessed hooks drift.** The UI agent had to guess the autopilot entry point (`createAutopilot` vs `createBot` vs default export). Put every cross-module hook (name, args, return shape) in the contract, with an example call.
- **Stamp state at the transition, not on the next tick.** `pose` set a tick late after kill/hurt/sink meant tests and the renderer read stale data. Set derived presentation fields in the same function that changes mode.
- **Event timestamps need the right clock.** HUD events stamped with a clock that restarts per game appeared stale; stamp on the next draw instead.
- **Poll input once per frame, carry edges.** On high-refresh displays a frame may run zero fixed steps; a jump edge must persist until a sim step consumes it.

## Physics and tuning (see `src/lib/platformer-physics.js`)
- **Check reach geometry before tuning.** Hands (top of the hitbox) were ~86 px up; a vine tip that never came below y 80-90 near the pit edge gave zero crossings until a sweep script (`out/vinesweep.mjs`) found a workable arc. Write the sweep first.
- **Derive fairness from the same numbers as physics.** `MAX_PIT = floor(jumpRange - hitW - 4)` in the generator and the validator come from `TUNING`, so retuning cannot silently break levels. `jumpRange`/`jumpHeight` are in the lib for this.
- **Surface height assumptions break.** Croc standing height assumed `y-2`, the real entity sat at `y+8`; standing height is `y - h` (top of the box). Test against the entity actually spawned, not a hand-made one.
- **Room to jump.** A 44 px tunnel with a 52 px jump means tunnel enemies cannot be jumped; make such routes optional shortcuts and keep the surface always crossable.
- **Rolling hazards stay off deadly-pit and lethal-static screens** (knock-back into fire or a pit is unfair) and off collectible screens (they sweep the item).

## Generation and fairness (see `src/lib/world-gen.js`)
- Measure obstacle gaps from the screen EDGE with a landing gap, not from the clearance zone (first check gave false FAILs).
- Per-screen seeded streams make generation order-independent; add a "different seed -> different output" test or a constant seed slips through (mutation check caught exactly that in the lib).
- Stagger cyclers: croc phase = `i * period / 3` so the three heads never open together.

## Art, render and audio
- `PixBuf.outline` only paints transparent pixels and adds outside the art: keep art in a 1 px margin (feet on row 22 of 24). Several sprites (life icon, tooth under cheese, swing arms behind hat) were fixed after viewing at x6.
- Seamless animated tiles need the period to divide the tile width; parallax layers tile only when `W*factor*120` is a multiple of the tile width.
- Judge tiny sprites at x6, view via `sheet --only <substr>` for cheap previews; the smallest, lowest-contrast sprite (scorpion) is the risk.
- A shim 2D context supporting `translate`, `scale(+-1)`, rect clip and `lighter` is enough to render the whole game to PNG in Node.
- Audio: keep SFX recipes pure data (pitch scaling after the recipe serves live and offline paths); validate music bars with `parseBar` (exactly 16 steps); loops are seamless when the offline renderer renders pass k=-1 and wraps; set master gain from measured peaks (0.55 gave peaks 0.6, 0.78 gave <= 0.88). Dynamic import of optional modules needs try/catch so Node tests pass.
- Node's builtin `process.getBuiltinModule('node:zlib')` keeps PNG encoding import-free for the browser.

## Tooling, docs, site
- Template engines: a `{{.}}` on primitive list items must return the item, not the context; `Math.round(-2.5)` is -2, mind it in test expectations.
- Strip HTML comments before regex-scanning docs in tests (a documented example GIF in a comment counted as a real asset).
- GitHub Pages serves `docs/site/` only if the Pages source is that folder or it is copied to the deploy root; relative `play/` links need the build output there. Nothing built it automatically: add a step.
- Tracker: wav duration must come from file size, not a 4 KB header read; sprite totals parsed from defs rows need a fallback for other games.
- Test fakes must mirror defaults of the real object (a fake with `dir = 1` made logs roll the wrong way); start moving tests away from wrap points.

## Process
- Extract reusable engines only after the game is integrated and its tests are green; keep the game untouched and re-prove the library with its own tests plus mutation checks.
- The bot (autopilot) is a first-class QA tool: look-ahead over the real hazard update functions, robust-plan smoothing, a no-progress watchdog and a `skill` knob. Its game-specific state mirror stays in the game; the generic parts are in `src/lib/autopilot-kit.js`.
