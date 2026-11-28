// Entry point: menu -> reference sim (src/sim) on a canvas. Replace the sim and the draw() with the real game (see ARCHITECTURE.md).
// Smoke convention (docs/BOTPLAY.md): `?autostart=1[&seed=N][&bot=1][&diff=hard][&size=2]` skips the menu and starts at once, and every
// running game is published as `window.__game` = { t, ticks, outcome, seed, snapshot() } so tools/smoke_web.sh can assert the sim advanced.
import { createStartMenu } from './ui/startmenu.js';
import { loadSettings, saveSettings } from './core/settings.js';
import { createBus } from './core/events.js';
import { DT } from './core/defs.js';
import { createGame, DEFAULT_LEVEL } from './sim/game.js';
import { createBot } from './sim/autopilot.js';
import { applyDifficulty } from './levels/difficulty.js';
import { applySize } from './levels/size.js';

const c = document.getElementById('game'), g2 = c.getContext('2d');
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const autostart = params.get('autostart') === '1';
const seedParam = Number(params.get('seed'));

let settings = loadSettings();
let game = null, bot = null, seed = 1, started = false, acc = 0, last = 0;
let menu = null;
const keys = new Set();
const bus = createBus();

function publish(gm, sd) {
  // Getters, not a snapshot copy: smoke reads live values. Never put the DOM or functions with side effects on this object.
  const handle = { seed: sd, snapshot: () => gm.snapshot() };
  for (const k of ['t', 'ticks', 'outcome']) Object.defineProperty(handle, k, { get: () => gm[k], enumerable: true });
  window.__game = handle;
}

function startGame(opts = {}) {
  seed = Number.isFinite(opts.seed) && opts.seed > 0 ? opts.seed : (Date.now() % 100000) + 1;
  const level = applyDifficulty(applySize(DEFAULT_LEVEL, opts.size ?? settings.size), opts.diff ?? settings.difficulty);
  game = createGame({ seed, level, bus });
  bot = opts.bot ? createBot({ skill: 1, seed }) : null;
  acc = 0; started = true;
  publish(game, seed);
}

function input() {
  if (bot) return bot.decide(game);
  const dx = (keys.has('ArrowRight') || keys.has('d') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('a') ? 1 : 0);
  const dy = (keys.has('ArrowDown') || keys.has('s') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('w') ? 1 : 0);
  return { dx, dy };
}

function draw() {
  g2.fillStyle = '#111'; g2.fillRect(0, 0, c.width, c.height);
  if (!game) { g2.fillStyle = '#fc0'; g2.font = '32px monospace'; g2.fillText('__NAME__', 40, 80); return; }
  const s = game.snapshot(), cell = Math.min((c.width - 40) / s.world.w, (c.height - 60) / s.world.h, 48);
  const px = (v) => v * cell + 20;
  g2.fillStyle = '#3a3'; g2.fillRect(px(s.goal.x) - cell / 2, px(s.goal.y) - cell / 2, cell, cell);
  g2.fillStyle = '#e44'; for (const e of s.enemies) g2.fillRect(px(e.x) - 6, px(e.y) - 6, 12, 12);
  g2.fillStyle = '#fc0'; g2.fillRect(px(s.player.x) - 7, px(s.player.y) - 7, 14, 14);
  g2.fillStyle = '#fff'; g2.font = '16px monospace';
  g2.fillText(`t=${s.t.toFixed(1)}  hp=${s.player.hp}${s.outcome ? '  ' + (s.outcome.win ? 'CLEARED' : 'DEAD') + ' - press R' : ''}`, 12, c.height - 12);
}

function frame(now) {
  if (game && !(menu && menu.isOpen) && !game.outcome) { // the menu doubles as pause
    acc = Math.min(acc + (now - last) / 1000, 0.25); // clamp: a background tab must not fast-forward the sim
    while (acc >= DT && !game.outcome) { game.update(DT, input()); acc -= DT; }
  }
  last = now; draw();
  requestAnimationFrame(frame);
}

addEventListener('keydown', (e) => {
  keys.add(e.key);
  if (e.key === 'Escape' || e.key === 'p') { if (menu) menu.toggle(); }
  if ((e.key === 'r' || e.key === 'R') && started) startGame({ seed });
});
addEventListener('keyup', (e) => keys.delete(e.key));

if (autostart) {
  startGame({ seed: seedParam, bot: params.get('bot') === '1', diff: params.get('diff') ?? undefined, size: params.get('size') ? Number(params.get('size')) : undefined });
} else {
  menu = createStartMenu({
    title: '__NAME__',
    tagline: 'scaffolded by game-factory',
    levels: [], titles: {},
    getSettings: () => settings,
    onSettings: (s) => { settings = s; saveSettings(s); },
    onPlay: () => { startGame(); menu.close(true); },
    onResume: () => {},
    canResume: () => started,
  });
  menu.open('main');
}
requestAnimationFrame((t) => { last = t; frame(t); });
