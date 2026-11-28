#!/usr/bin/env node
// Balance matrix: clear-rate of the game's bot at several skill levels over several seeds, per level.
//   node tools/balance.mjs [--level id] [--skills 0,1,2] [--seeds 1,2,3,4,5,6,7,8] [--diff tier] [--size n] [--max-t sec] [--strict]
// Same game contract as tools/botplay.mjs (docs/BOTPLAY.md). Prints a table; a trailing WARN line is the point of the tool:
// if skill 0 (the beeline "novice") clears 100% the level has no teeth: difficulty is UNTESTED for humans, whatever the bot says.
// Exit 0 normally, 1 with --strict when any level has that warning or its best skill misses the 80% bar, 2 when the game has no sim.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const need = ['levels/load-node.js', 'sim/game.js', 'sim/autopilot.js', 'core/events.js', 'core/defs.js'];
const missing = need.filter((f) => !existsSync(join(SRC, f)));
if (missing.length) { console.error('balance: this game has no sim to play (missing src/' + missing.join(', src/') + ').'); process.exit(2); }
const imp = (f) => import(pathToFileURL(join(SRC, f)).href);
const opt = async (f, name) => (existsSync(join(SRC, f)) ? (await imp(f))[name] : undefined);
const [{ createBus }, { loadLevel, listLevels }, { createGame }, { createBot }, { DT }] = await Promise.all(['core/events.js', 'levels/load-node.js', 'sim/game.js', 'sim/autopilot.js', 'core/defs.js'].map(imp));
const applyDifficulty = (await opt('levels/difficulty.js', 'applyDifficulty')) || ((l) => l);
const applySize = (await opt('levels/size.js', 'applySize')) || ((l) => l);

const args = { level: undefined, skills: [0, 1, 2], seeds: [1, 2, 3, 4, 5, 6, 7, 8], diff: 'medium', size: 1, maxT: 120, strict: false };
const argv = process.argv;
const nums = (s) => s.split(',').map(Number);
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--level') args.level = argv[++i]; else if (a === '--skills') args.skills = nums(argv[++i]); else if (a === '--seeds') args.seeds = nums(argv[++i]);
  else if (a === '--diff') args.diff = argv[++i]; else if (a === '--size') args.size = Number(argv[++i]); else if (a === '--max-t') args.maxT = Number(argv[++i]);
  else if (a === '--strict') args.strict = true;
  else { console.error('balance: unknown arg ' + a); process.exit(2); }
}
if (!args.skills.length || !args.seeds.length || [...args.skills, ...args.seeds].some((n) => !Number.isFinite(n))) { console.error('balance: --skills/--seeds need comma-separated numbers'); process.exit(2); }

function clearRate(level, skill) {
  let wins = 0, tSum = 0;
  for (const seed of args.seeds) {
    const g = createGame({ seed, level: applyDifficulty(applySize(level, args.size), args.diff), bus: createBus() });
    const bot = createBot({ skill, seed });
    for (let i = 0, n = Math.floor(args.maxT / DT); i < n && !g.outcome; i++) g.update(DT, bot.decide(g));
    if (g.outcome?.win) { wins++; tSum += g.t; }
  }
  return { wins, rate: wins / args.seeds.length, avgT: wins ? tSum / wins : NaN };
}

let ids;
try { ids = args.level ? [args.level] : listLevels(); loadLevel(ids[0]); } catch (e) { console.error(e.message || e); process.exit(2); }
console.log(`balance: diff=${args.diff} size=${args.size} seeds=${args.seeds.length} (${args.seeds.join(',')})`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('level', 14) + args.skills.map((s) => pad('skill ' + s, 16)).join(''));
let bad = 0;
for (const id of ids) {
  const level = loadLevel(id), cells = args.skills.map((s) => ({ s, ...clearRate(level, s) }));
  console.log(pad(id, 14) + cells.map((c) => pad(`${Math.round(c.rate * 100)}% ${Number.isNaN(c.avgT) ? '-' : c.avgT.toFixed(1) + 's'}`, 16)).join(''));
  const lo = cells.reduce((a, b) => (b.s < a.s ? b : a)), hi = cells.reduce((a, b) => (b.s > a.s ? b : a));
  if (cells.length > 1 && lo.s <= 0 && lo.rate === 1) { console.log(`WARN ${id}: skill ${lo.s} clears 100% -> difficulty untested for humans (a novice bot never loses; add hazards or tighten tuning)`); bad++; }
  if (hi.rate < 0.8) { console.log(`WARN ${id}: best skill ${hi.s} clears ${Math.round(hi.rate * 100)}% < 80% bar (level too hard or bot too weak)`); bad++; }
  if (cells.length > 1 && cells.some((c, i) => i && c.s > cells[i - 1].s && c.rate < cells[i - 1].rate - 0.2)) { console.log(`WARN ${id}: clear rate drops as skill rises -> the bot is stalling or flailing; fix the bot before trusting any balance number`); bad++; }
}
console.log(bad ? `${bad} warning(s)` : 'balance OK: skills separate and the best skill meets the bar');
process.exit(args.strict && bad ? 1 : 0);
