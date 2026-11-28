// Start / pause menu (DOM overlay). Views: main, levels, controls, options, scores.
//
// Close contract: close(resumed) is idempotent — if the menu is already closed or a close is in
// progress, onResume is not invoked again. onResume may call close(true); that re-entry is ignored.
import { loadScores, clearScores } from '../core/scores.js';
import { DIFFICULTIES, SCORE_MULT } from '../levels/difficulty.js';
import { SIZES, SIZE_SCORE } from '../levels/size.js';

/** @param {{ open: boolean, closing?: boolean }} state */
export function safeClose(state, resumed, onResume) {
  if (state.closing || !state.open) return;
  state.closing = true;
  state.open = false;
  try {
    if (resumed) onResume?.();
  } finally {
    state.closing = false;
  }
}

const DEFAULT_CONTROLS = [
  ['W A S D / Arrows', 'Move'],
  ['Mouse', 'Aim'],
  ['Left click / Space', 'Primary action'],
  ['Esc / P', 'Pause / resume'],
];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n[k] = v;
  }
  n.append(...kids.filter((x) => x != null));
  return n;
}

/**
 * opts: { title, tagline, levels: string[], titles: {id: label}, controls: [[keys, action]],
 *         currentId, getSettings, onSettings(settings), onPlay(levelId), onResume(), canResume() }
 * Score keys are `${levelId}:${difficulty}[:2x|3x]` (see src/core/scores.js).
 */
export function createStartMenu(opts) {
  const LEVELS = opts.levels ?? [];
  const LEVEL_TITLES = opts.titles ?? {};
  const CONTROLS = opts.controls ?? DEFAULT_CONTROLS;
  const TITLE = opts.title ?? 'GAME';
  const root = el('div', { id: 'startmenu', hidden: true, role: 'dialog', 'aria-label': `${TITLE} menu` });
  document.body.appendChild(root);
  let view = 'main';
  const menuState = { open: false, closing: false };

  const btn = (label, fn, cls = '') => el('button', { class: 'mbtn ' + cls, type: 'button', textContent: label, onclick: fn });
  const back = () => btn('« Back', () => go('main'), 'sub');

  function slider(label, key) {
    const s = opts.getSettings();
    const out = el('span', { class: 'val', textContent: Math.round(s[key] * 100) + '%' });
    const inp = el('input', {
      type: 'range', min: 0, max: 100, step: 5, value: Math.round(s[key] * 100),
      oninput: (e) => {
        const v = Number(e.target.value) / 100;
        out.textContent = Math.round(v * 100) + '%';
        opts.onSettings({ ...opts.getSettings(), [key]: v });
      },
    });
    return el('label', { class: 'row' }, el('span', { textContent: label }), inp, out);
  }
  function toggle(label, key, on, off) {
    const b = el('button', { class: 'mbtn small', type: 'button' });
    const paint = () => { b.textContent = opts.getSettings()[key] === on ? 'ON' : 'OFF'; };
    paint();
    b.onclick = () => {
      const s = opts.getSettings();
      opts.onSettings({ ...s, [key]: s[key] === on ? off : on });
      paint();
    };
    return el('div', { class: 'row' }, el('span', { textContent: label }), b);
  }
  function gfxRow() {
    const b = el('button', { class: 'mbtn small', type: 'button' });
    const paint = () => { b.textContent = opts.getSettings().gfx === '32bit' ? '32-bit' : '16-bit'; };
    paint();
    b.onclick = () => {
      const s = opts.getSettings();
      opts.onSettings({ ...s, gfx: s.gfx === '16bit' ? '32bit' : '16bit' });
      paint();
    };
    return el('div', { class: 'row' }, el('span', { textContent: 'Graphics' }), b);
  }

  function render() {
    const kids = [];
    if (view === 'main') {
      kids.push(el('h1', { textContent: opts.canResume() ? 'PAUSED' : TITLE.toUpperCase() }), el('p', { class: 'tag', textContent: opts.tagline ?? '' }));
      if (opts.canResume()) kids.push(btn('Resume', () => close(true), 'primary'));
      kids.push(
        btn(opts.canResume() ? 'Restart / Levels' : 'Play', () => go('levels'), opts.canResume() ? '' : 'primary'),
        btn('Controls', () => go('controls')),
        btn('Options', () => go('options')),
        btn('Top Scores', () => go('scores')),
      );
    } else if (view === 'levels') {
      kids.push(el('h2', { textContent: 'Choose a level' }));
      const cur = opts.getSettings().difficulty;
      const dr = el('div', { class: 'diffrow' });
      for (const d of DIFFICULTIES) {
        dr.append(el('button', {
          class: 'mbtn small' + (d === cur ? ' primary' : ''), type: 'button',
          textContent: d.toUpperCase(), title: `Score x${SCORE_MULT[d]}`,
          onclick: () => { opts.onSettings({ ...opts.getSettings(), difficulty: d }); render(); },
        }));
      }
      const curSize = opts.getSettings().size;
      const sr = el('div', { class: 'diffrow' });
      for (const z of SIZES) {
        sr.append(el('button', {
          class: 'mbtn small' + (z === curSize ? ' primary' : ''), type: 'button',
          textContent: `${z}x`, title: `${z}x the floor space, ${z}x the vermin`,
          onclick: () => { opts.onSettings({ ...opts.getSettings(), size: z }); render(); },
        }));
      }
      kids.push(dr, el('p', { class: 'tag', textContent: 'Difficulty' }), sr,
        el('p', { class: 'tag', textContent: `Store size (more floor + vermin) · score x${(SCORE_MULT[cur] * SIZE_SCORE[curSize]).toFixed(2).replace(/\.?0+$/, '')}` }));
      const best = loadScores();
      for (const id of LEVELS) {
        const top = best[`${id}:${cur}${curSize > 1 ? ':' + curSize + 'x' : ''}`]?.[0];
        kids.push(btn(`${LEVEL_TITLES[id] ?? id}${top ? `  — best ${top.score}` : ''}`, () => opts.onPlay(id), id === opts.currentId ? 'primary' : ''));
      }
      kids.push(back());
    } else if (view === 'controls') {
      kids.push(el('h2', { textContent: 'Controls' }));
      const t = el('table', { class: 'ctl' });
      for (const [k, v] of CONTROLS) t.append(el('tr', {}, el('th', { textContent: k }), el('td', { textContent: v })));
      kids.push(t, back());
    } else if (view === 'options') {
      kids.push(
        el('h2', { textContent: 'Options' }),
        toggle('Mute all', 'mute', true, false),
        slider('Master volume', 'master'),
        slider('SFX volume', 'sfx'),
        slider('Music volume', 'music'),
        gfxRow(),
        toggle('CRT filter', 'crt', true, false),
        back(),
      );
    } else if (view === 'scores') {
      kids.push(el('h2', { textContent: 'Top Scores (this browser)' }));
      const all = loadScores();
      let any = false;
      for (const key of LEVELS.flatMap((l) => DIFFICULTIES.flatMap((d) => SIZES.map((z) => `${l}:${d}${z > 1 ? ':' + z + 'x' : ''}`)))) {
        const list = all[key];
        if (!list?.length) continue;
        const [id, dif, sz] = key.split(':');
        any = true;
        const ol = el('ol', { class: 'scores' });
        for (const e of list.slice(0, 5)) {
          ol.append(el('li', { textContent: `${String(e.score).padStart(6, ' ')}  ${e.win ? 'WIN ' : 'LOSS'}  ${e.date}` }));
        }
        kids.push(el('h3', { textContent: `${LEVEL_TITLES[id] ?? id} — ${dif.toUpperCase()}${sz ? ' ' + sz : ''}` }), ol);
      }
      if (!any) kids.push(el('p', { class: 'tag', textContent: 'No runs yet. Play a level to set a score.' }));
      kids.push(btn('Clear scores', () => { clearScores(); render(); }, 'sub'), back());
    }
    root.replaceChildren(el('div', { class: 'panel' }, ...kids));
    root.querySelector('button')?.focus();
  }

  function go(v) { view = v; render(); }
  function openMenu(v = 'main') {
    menuState.open = true;
    menuState.closing = false;
    view = v;
    root.hidden = false;
    render();
  }
  function close(resumed) {
    safeClose(menuState, resumed, opts.onResume);
    if (!menuState.open) root.hidden = true;
  }

  return {
    open: openMenu,
    close,
    get isOpen() { return menuState.open; },
    toggle() { menuState.open ? (opts.canResume() && close(true)) : openMenu('main'); },
  };
}
