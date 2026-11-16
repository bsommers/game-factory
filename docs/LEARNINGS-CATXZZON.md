# Learnings, mistakes and fixes

Running log. Format: **what happened -> why -> fix / rule for next time**. Per-agent detail lives in `docs/swarm/reports/<agentId>.md`.

## 1. Dynamic import is invisible to the bundler
- **What happened:** The first web bundle booted with missing modules (pkg-build, found by the file:// smoke test; a second site in `renderer.js` too).
- **Why:** `import(variable)` cannot be followed by esbuild.
- **Fix / rule:** Stage a copy of `src/` where each such call consults a bundled module map. Keep dynamic imports few and greppable; always smoke the shipped artifact, not the dev tree.

## 2. Probing a native binary opened a real window
- **What happened:** `neutralino --version` opened a GUI on the user's Wayland desktop.
- **Why:** The binary has no side-effect-free flag.
- **Fix / rule:** Run unknown GUI binaries only under `xvfb-run` with `GDK_BACKEND=x11` and no `WAYLAND_DISPLAY`.

## 3. Tests that rebuild shared output race each other
- **What happened:** pkg-build tests could delete `dist/catxzzon.html` during a concurrent run.
- **Fix / rule:** Tests build into temp dirs (`buildWeb({outDir})`); never write the shared output from a test.

## 4. Look at the art, then measure it
- **What happened:** Several art modules shipped v1 sprites that were clipped, muddy or unreadable (cat ship edge-on, merged leaf blobs, alpha too low, boom frames clipped).
- **Fix / rule:** View sheets at x4 scale, measure opaque bounding boxes numerically, iterate at least twice. Numeric checks catch clipping that eyes miss.

## 5. Mutation checks find tests that agree with the bug
- **What happened:** An asar-padding mutation passed because reader and writer were consistent; a tie-score mutation went uncaught.
- **Fix / rule:** After writing a test, break the code once and confirm red; assert against an independent invariant (alignment, spec value), not the writer's own output.

## 6. Tuning needs a bot, not opinions
- **What happened:** Round 3 space was brutal (about 7 deaths in 40 s); the boss tuna spawned where the bot ran out of fuel.
- **Fix / rule:** Run the autopilot headless over rounds and stages and tune fire rates, drops and thresholds from the measured deaths.

## 7. Falsy-zero and small API traps
- **What happened:** `opts.spd || 95` swallowed `spd=0`; a comment containing `Math.random` tripped a source-scan test; the HUD used a glyph the font lacks.
- **Fix / rule:** Use `??` for numeric options, word comments carefully when scanning source, check glyph coverage of the pixel font.

## 8. Lifecycle ordering bugs
- **What happened:** A taunt listener registered lazily missed early events; queued jets despawned before flying in.
- **Fix / rule:** Subscribe at construction; check spawn waits against the engine's despawn distance.
