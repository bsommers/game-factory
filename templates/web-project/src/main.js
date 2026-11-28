// Entry point stub: mounts the start/pause menu over a placeholder canvas. Replace the canvas part with the real game (see ARCHITECTURE.md).
import { createStartMenu } from './ui/startmenu.js';
import { loadSettings, saveSettings } from './core/settings.js';

const c = document.getElementById('game'), g = c.getContext('2d');
g.fillStyle = '#fc0'; g.font = '32px monospace'; g.fillText('__NAME__ — scaffolded by game-factory', 40, 80);

let settings = loadSettings();
let started = false;
const menu = createStartMenu({
  title: '__NAME__',
  tagline: 'scaffolded by game-factory',
  levels: [], titles: {},
  getSettings: () => settings,
  onSettings: (s) => { settings = s; saveSettings(s); },
  onPlay: () => { started = true; menu.close(true); },
  onResume: () => {},
  canResume: () => started,
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'p') menu.toggle(); });
menu.open('main');
