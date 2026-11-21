---
name: qa-with-bot
description: QA a game with an autopilot bot, headless smoke tests, screenshots and mutation checks instead of trusting "tests pass".
triggers: [qa, bot, autopilot, test, tests, testing, smoke, headless, regression, mutation, verify, screenshot, playtest, coverage, flaky]
needs: [src/lib/autopilot-kit.js, tools/shot.mjs]
outputs: [test/*.test.mjs, out/shots/*.png]
model: sonnet
cost: medium
capabilities: [guide.check]
kits: [autopilot-kit]
---
# QA with a bot

## Steps
1. Build the bot from `autopilot-kit.js`: look-ahead over the real hazard update functions, robust-plan smoothing, a no-progress watchdog, a `skill` knob. The game-specific state mirror stays in the game.
2. Run it over many seeds; assert it finishes levels and the watchdog never fires.
3. Mutation check: reintroduce the bug, confirm the test fails, restore.
4. Screenshots: `tools/shot.mjs` renders via a shim 2D context; check mean/std (std < 0.01 means blank).
5. `npm test` and re-run suites yourself before committing.

## Gotchas
- Test fakes must mirror the defaults of the real object.
- Start movement tests away from wrap points.
- Stamp derived fields (pose) at the transition, not the next tick.

## Verification
Bot completion rate recorded; mutation check fails as expected.
