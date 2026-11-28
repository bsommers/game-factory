# BOTPLAY: the bot-play contract

`npm run verify` plays every level in `src/levels/*.json` with a bot and **fails below the 80% bar**. This is how a swarm proves a game is
winnable without a human. The tools (`tools/botplay.mjs`, `tools/balance.mjs`, `tools/smoke_web.sh`) are generic; the game provides five modules.

## The 5 modules (names and signatures are the contract)

| File | Export | Contract |
|---|---|---|
| `src/levels/load-node.js` | `loadLevel(id?)`, `listLevels()` | Node-only. Reads `src/levels/<id>.json`; no id = first level. Throws a readable error for unknown ids. The browser never uses it. |
| `src/sim/game.js` | `createGame({seed, level, bus})` | Pure, deterministic, DOM-free. Returns `{update(dt, input), snapshot(), clone(), t, score, outcome}`. `outcome` is `null` while running, then `{win:boolean, reason:string}`. `snapshot().player` is `{x, y, ...}` (botplay stops on NaN positions). `clone()` is a deep copy with events off (the bot's look-ahead uses it). |
| `src/sim/autopilot.js` | `createBot({skill, seed})` | Returns `{decide(game) -> input}`. `skill` 0 = novice, 1 = competent, 2+ = strong. Must not stall. |
| `src/core/events.js` | `createBus()` | `{on, off, emit}`. The sim emits (`hit`, `win`, `lose`...); UI and audio subscribe. |
| `src/core/defs.js` | `DT` | Fixed step in seconds. Also the home of `TUNING` and `ART`. |

Optional: `src/levels/difficulty.js` (`applyDifficulty`) and `src/levels/size.js` (`applySize`); botplay applies them when present, so
`--diff hard --size 2` work. Both are generic: `entities[{x,y,hp?,speed?,count?}]` is scaled, a level without entities is cloned and stamped, and
MicroMaze-shaped levels (`tiles`+`waves`+`registers`) keep their tuned scaling (`src/levels/examples/micromaze-transforms.js`).

The template ships a working stub of all five (reach the goal past bouncing enemies) so a fresh scaffold passes `verify` on day one.
Replace `sim/game.js`, `sim/autopilot.js` and the level data with the real game; keep the shapes above.

## The 80% bar

`node tools/botplay.mjs --level <id> --seeds 1,2,3,4,5 [--skill n] [--diff tier] [--size n] [--max-t sec]` prints one
`seed=N win=bool reason=R score=S t=T` line per seed and exits:

- `0`: at least 80% of seeds cleared (with 3 or fewer seeds, any win);
- `1`: below the bar. `scripts/verify.sh` fails on this (it no longer says `|| true`);
- `2`: the sim contract is missing or broken, or the level is unknown. `verify.sh` fails on this too once `src/sim/game.js` exists.

`web.botplay` (registry) runs the same tool. Never weaken the bar to get green: fix the level or the bot.

## The reference bot: look-ahead, not force-sum

`src/sim/autopilot.js` scores each candidate direction by simulating the **cloned** game forward (`horizon` ticks, then beeline) and picks the
best, ties going to the beeline. Progress toward the goal is part of the score, so it detours around danger and keeps moving. A force-sum bot
(goal pull minus hazard push) parks where the forces cancel and stalls; it even scored worse than a less skilled bot in an earlier game. If you
write your own bot, give it a clone-and-simulate step (see also `src/lib/autopilot-kit.js`: `trajectory`, `searchMacros`, `makeWatchdog`).

`skill 0` is a plain beeline that ignores hazards (the novice). `0 < skill < 1` is humanised: with probability `1 - skill` a decision is a beeline.

## Balance matrix

`node tools/balance.mjs [--level id] [--skills 0,1,2] [--seeds 1,...,8] [--diff tier] [--size n] [--strict]` prints a skill x seed clear-rate table per level:

```
level         skill 0         skill 1         skill 2
level01       50% 3.5s        100% 3.5s       100% 3.5s
```

How to read it:

- **Skill 0 clears 100% means difficulty is untested for humans.** If a novice bot that ignores every hazard never loses, the hazards are
  decoration, whatever the competent bot reports. The tool prints a `WARN ... untested for humans` line; `--strict` turns warnings into exit 1.
- The best skill must meet the 80% bar, or the level is too hard (or the bot too weak).
- Clear rate must not fall as skill rises; if it does the bot is stalling or flailing. Fix the bot before trusting any balance number.
- Bots cannot judge fun or feel. This only shows the level is winnable and has teeth; a human still plays it.

## Smoke autostart convention

`src/main.js` honours `?autostart=1[&seed=N][&bot=1][&diff=tier][&size=n]`: no menu, the game starts at once, and every running game is published as
`window.__game = {t, ticks, outcome, seed, snapshot()}` (live getters). `tools/smoke_web.sh dist/<game>.html` loads the single-file build with
`?autostart=1&seed=1`, fails on any console error, then asserts `window.__game.t > 0`. Keep this when you replace the stub: the smoke is
the only check that exercises the shipped file, and `fetch(new URL(..., import.meta.url))` level loading passes every other check and fails only there.
