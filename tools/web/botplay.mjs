#!/usr/bin/env node
// Generic bot-play harness. node tools/botplay.mjs [--level id] [--seeds 1,2,3] [--skill n] [--max-t sec] [--diff tier] [--size n]
// Convention (the game provides these; MicroMaze is the reference): src/levels/load-node.js (loadLevel), src/sim/game.js (createGame),
// src/sim/autopilot.js (createBot({skill, seed})), src/core/events.js (createBus), src/core/defs.js (DT). Optional: src/levels/difficulty.js / size.js.
// Prints one `seed=N win=bool reason=R score=S t=T` line per seed. Exit 0 when >=80% cleared (any win if <=3 seeds), 1 otherwise, 2 when the game lacks the sim modules.
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const need = ['levels/load-node.js', 'sim/game.js', 'sim/autopilot.js', 'core/events.js', 'core/defs.js'];
const missing = need.filter((f) => !existsSync(join(SRC, f)));
if (missing.length) { console.error('botplay: this game has no sim to play (missing src/' + missing.join(', src/') + '). Add them or replace tools/botplay.mjs.'); process.exit(2); }
const imp = (f) => import(pathToFileURL(join(SRC, f)).href);
const opt = async (f, name) => (existsSync(join(SRC, f)) ? (await imp(f))[name] : undefined);
const [{ createBus }, { loadLevel }, { createGame }, { createBot }, { DT }] = await Promise.all(['core/events.js', 'levels/load-node.js', 'sim/game.js', 'sim/autopilot.js', 'core/defs.js'].map(imp));
const applyDifficulty = (await opt('levels/difficulty.js', 'applyDifficulty')) || ((l) => l);
const applySize = (await opt('levels/size.js', 'applySize')) || ((l) => l);

const args = { level: undefined, seeds: [1, 2, 3], skill: 1, maxT: 180, diff: 'medium', size: 1 };
const argv = process.argv;
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--level') args.level = argv[++i]; else if (a === '--seeds') args.seeds = argv[++i].split(',').map(Number);
  else if (a === '--size') args.size = Number(argv[++i]); else if (a === '--diff') args.diff = argv[++i];
  else if (a === '--skill') args.skill = Number(argv[++i]); else if (a === '--max-t') args.maxT = Number(argv[++i]);
}
let level;
try { level = loadLevel(args.level); } catch (e) { console.error(e.message || e); process.exit(2); }
let wins = 0;
for (const seed of args.seeds) {
  const g = createGame({ seed, level: applyDifficulty(applySize(level, args.size), args.diff), bus: createBus() });
  const bot = createBot({ skill: args.skill, seed });
  let nan = false;
  for (let i = 0, n = Math.floor(args.maxT / DT); i < n && !g.outcome; i++) {
    g.update(DT, bot.decide(g));
    const p = g.snapshot().player;
    if (p && (!Number.isFinite(p.x) || !Number.isFinite(p.y))) { nan = true; break; }
  }
  const win = !!g.outcome?.win; if (win) wins++;
  console.log(`seed=${seed} win=${win} reason=${g.outcome?.reason ?? (nan ? 'nan' : 'timeout')} score=${g.score} t=${g.t.toFixed(1)}`);
}
const bar = Math.ceil(args.seeds.length * 0.8);
console.log(`cleared ${wins}/${args.seeds.length} (need ≥${bar} for 80%)`);
process.exit(wins >= bar || (args.seeds.length <= 3 && wins >= 1) ? 0 : 1);
