#!/usr/bin/env node
// Generates the game-factory brand kit: docs/assets/{logo,icon,social}.svg, assets/logo.svg, docs/assets/icons/icon-*.svg, then PNGs via inkscape.
// Usage: node tools/brand/gen.mjs [--no-png]
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const C = { bg: '#070d1c', bg2: '#0b1530', cy: '#00e5ff', sky: '#38bdf8', gn: '#00ff9d', mg: '#ff4fd8', am: '#ffb02e', tx: '#e6f4ff', dim: '#7aa2c8' };
const MONO = "'JetBrains Mono','DejaVu Sans Mono','Menlo','Consolas',monospace";
const f = (n) => +n.toFixed(2);

const defs = `<defs>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="tglow" x="-10%" y="-20%" width="120%" height="140%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <linearGradient id="bgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg2}"/><stop offset="1" stop-color="${C.bg}"/></linearGradient>
  <linearGradient id="top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7ff6ff"/><stop offset="1" stop-color="${C.cy}"/></linearGradient>
  <linearGradient id="left" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.gn}"/><stop offset="1" stop-color="#00a86b"/></linearGradient>
  <linearGradient id="right" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.mg}"/><stop offset="1" stop-color="#9a1f86"/></linearGradient>
</defs>`;

const hex = (cx, cy, r, rot = -90) => Array.from({ length: 6 }, (_, i) => { const a = (rot + i * 60) * Math.PI / 180; return `${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`; }).join(' ');
function gearPath(cx, cy, rOut, rIn, teeth) { // trapezoid teeth
  const pts = [], step = 2 * Math.PI / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    for (const [da, r] of [[-0.30, rIn], [-0.17, rOut], [0.17, rOut], [0.30, rIn]]) pts.push([cx + r * Math.cos(a + da * step * 1.6), cy + r * Math.sin(a + da * step * 1.6)]);
  }
  return 'M' + pts.map((p) => `${f(p[0])},${f(p[1])}`).join('L') + 'Z';
}
function cube(cx, cy, s) { // isometric cube, s = edge to vertex
  const dx = s * Math.cos(Math.PI / 6), dy = s / 2;
  const T = [[cx, cy - s], [cx + dx, cy - dy], [cx, cy], [cx - dx, cy - dy]], L = [[cx - dx, cy - dy], [cx, cy], [cx, cy + s], [cx - dx, cy + dy]], R = [[cx, cy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx, cy + s]];
  const P = (a) => a.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');
  return `<polygon points="${P(L)}" fill="url(#left)"/><polygon points="${P(R)}" fill="url(#right)"/><polygon points="${P(T)}" fill="url(#top)"/><g fill="none" stroke="${C.bg}" stroke-width="${f(s / 22)}" stroke-linejoin="round" opacity=".7"><polygon points="${P(T)}"/><polygon points="${P(L)}"/><polygon points="${P(R)}"/></g>`;
}
// emblem centred on (cx,cy) with outer hexagon radius R
function emblem(cx, cy, R) {
  const k = R / 190, sw = (w) => f(w * k);
  const spokes = Array.from({ length: 6 }, (_, i) => { const a = (-60 + i * 60) * Math.PI / 180; return `<line x1="${f(cx + 112 * k * Math.cos(a))}" y1="${f(cy + 112 * k * Math.sin(a))}" x2="${f(cx + 160 * k * Math.cos(a))}" y2="${f(cy + 160 * k * Math.sin(a))}"/>`; }).join('');
  const nodes = hex(cx, cy, R).split(' ').map((p) => { const [x, y] = p.split(','); return `<circle cx="${x}" cy="${y}" r="${sw(9)}" fill="${C.bg}" stroke="${C.gn}" stroke-width="${sw(4)}"/>`; }).join('');
  return `<g filter="url(#glow)">
    <polygon points="${hex(cx, cy, R)}" fill="url(#bgg)" stroke="${C.cy}" stroke-width="${sw(6)}" stroke-linejoin="round"/>
    <polygon points="${hex(cx, cy, R * 0.86, -60)}" fill="none" stroke="${C.sky}" stroke-width="${sw(3)}" stroke-dasharray="${sw(14)} ${sw(9)}" opacity=".8"/>
    <path d="${gearPath(cx, cy, 128 * k, 108 * k, 12)}" fill="${C.bg}" stroke="${C.sky}" stroke-width="${sw(5)}" stroke-linejoin="round"/>
    <circle cx="${cx}" cy="${cy}" r="${sw(86)}" fill="none" stroke="${C.cy}" stroke-width="${sw(3)}" opacity=".55"/>
    <g stroke="${C.sky}" stroke-width="${sw(4)}" stroke-linecap="round" opacity=".6">${spokes}</g>
    ${nodes}
  </g>${cube(cx, cy + 4 * k, 66 * k)}`;
}
const svg = (w, h, body, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" ${extra}>\n${defs}\n${body}\n</svg>\n`;
const grid = (w, h, step, op = 0.07) => { let d = ''; for (let x = 0; x <= w; x += step) d += `M${x},0V${h}`; for (let y = 0; y <= h; y += step) d += `M0,${y}H${w}`; return `<path d="${d}" stroke="${C.cy}" stroke-width="1" opacity="${op}" fill="none"/>`; };

// ---- square icon (no text) ----
const iconSvg = svg(512, 512, `<rect width="512" height="512" rx="96" fill="url(#bgg)"/>${grid(512, 512, 32)}<rect x="6" y="6" width="500" height="500" rx="90" fill="none" stroke="${C.cy}" stroke-width="4" opacity=".6"/>${emblem(256, 256, 190)}`);

// ---- conveyor strip with little cubes ----
function conveyor(x, y, w) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="10" rx="5" fill="${C.bg2}" stroke="${C.sky}" stroke-width="2"/>`;
  for (let i = 0; i < w / 22; i++) s += `<line x1="${x + 10 + i * 22}" y1="${y + 2}" x2="${x + 4 + i * 22}" y2="${y + 8}" stroke="${C.sky}" stroke-width="2" opacity=".6"/>`;
  const cols = [['url(#left)'], ['url(#right)'], ['url(#top)']];
  for (let i = 0, cx = x + 40; cx < x + w - 24; i++, cx += 110) s += `<g transform="translate(${cx} ${y - 4})"><polygon points="-12,-10 0,-17 12,-10 12,2 0,9 -12,2" fill="${cols[i % 3][0]}" stroke="${C.bg}" stroke-width="1.5" stroke-linejoin="round"/></g>`;
  return s;
}
const chip = (x, y, t, col) => `<g><rect x="${x}" y="${y}" width="${t.length * 13 + 24}" height="30" rx="8" fill="${C.bg}" stroke="${col}" stroke-width="2"/><text x="${x + 12}" y="${y + 21}" font-family="${MONO}" font-size="16" font-weight="700" fill="${col}" letter-spacing="1.5">${t}</text></g>`;

// ---- hero banner 1200x360 ----
const heroSvg = svg(1200, 360, `<rect width="1200" height="360" fill="url(#bgg)"/>${grid(1200, 360, 40)}
${emblem(190, 170, 132)}
<text x="360" y="150" font-family="${MONO}" font-size="84" font-weight="800" fill="${C.tx}" letter-spacing="6" filter="url(#tglow)">GAME</text>
<text x="360" y="232" font-family="${MONO}" font-size="84" font-weight="800" fill="${C.cy}" letter-spacing="6" filter="url(#tglow)">FACTORY</text>
<text x="364" y="268" font-family="${MONO}" font-size="19" fill="${C.dim}" letter-spacing="1.5">one capability registry · four front doors · agent swarms</text>
${chip(364, 288, 'CLI', C.gn)}${chip(458, 288, 'HTTP', C.sky)}${chip(566, 288, 'MCP', C.mg)}${chip(660, 288, 'IMPORT', C.am)}
${conveyor(790, 330, 380)}
<g opacity=".9"><text x="1170" y="64" text-anchor="end" font-family="${MONO}" font-size="15" fill="${C.dim}" letter-spacing="2">GDSCRIPT · JS · RUST · GO · PYTHON</text>
<text x="1170" y="90" text-anchor="end" font-family="${MONO}" font-size="15" fill="${C.gn}" letter-spacing="2">deterministic · parity-tested</text></g>`);

// ---- social card 1280x640 ----
const socialSvg = svg(1280, 640, `<rect width="1280" height="640" fill="url(#bgg)"/>${grid(1280, 640, 40)}
${emblem(640, 230, 150)}
<text x="640" y="450" text-anchor="middle" font-family="${MONO}" font-size="76" font-weight="800" fill="${C.tx}" letter-spacing="8" filter="url(#tglow)">GAME <tspan fill="${C.cy}">FACTORY</tspan></text>
<text x="640" y="500" text-anchor="middle" font-family="${MONO}" font-size="24" fill="${C.dim}" letter-spacing="2">tooling for building games with a swarm of AI agents</text>
${chip(404, 530, 'CLI', C.gn)}${chip(498, 530, 'HTTP', C.sky)}${chip(606, 530, 'MCP', C.mg)}${chip(700, 530, 'IMPORT', C.am)}
${conveyor(240, 600, 800)}`);

// ---- category icons 64x64 ----
const G = { cy: C.cy, gn: C.gn, mg: C.mg, am: C.am, sky: C.sky };
const glyphs = {
  styles: [`<circle cx="32" cy="32" r="14"/><circle cx="26" cy="27" r="2.5" fill="${C.mg}"/><circle cx="36" cy="25" r="2.5" fill="${C.am}"/><circle cx="40" cy="34" r="2.5" fill="${C.gn}"/><path d="M32 46c-5 0-3-6 1-6h4"/>`, C.mg],
  library: [`<path d="M18 46V22l6-2v26M26 46V18h8v28M36 46V22l8 2v22"/><path d="M14 46h36"/>`, C.sky],
  guide: [`<circle cx="32" cy="32" r="15"/><path d="M38 26l-4 10-8 2 4-10z" fill="${C.gn}" stroke="${C.gn}"/><circle cx="32" cy="32" r="1.5" fill="${C.bg}"/>`, C.gn],
  project: [`<path d="M20 44V26l12-8 12 8v18z"/><path d="M28 44v-9h8v9"/>`, C.cy],
  kits: [`<rect x="17" y="26" width="30" height="20" rx="3"/><path d="M26 26v-4a3 3 0 013-3h6a3 3 0 013 3v4M17 35h30"/><rect x="29" y="33" width="6" height="5" fill="${C.am}" stroke="${C.am}"/>`, C.am],
  swarm: [`<circle cx="32" cy="32" r="5" fill="${C.gn}" stroke="${C.gn}"/><circle cx="20" cy="22" r="3.5"/><circle cx="44" cy="22" r="3.5"/><circle cx="20" cy="43" r="3.5"/><circle cx="44" cy="43" r="3.5"/><path d="M23 24l6 5M41 24l-6 5M23 41l6-6M41 41l-6-6"/>`, C.gn],
  models: [`<path d="M32 17l14 8v14l-14 8-14-8V25z"/><path d="M18 25l14 8 14-8M32 33v14"/>`, C.cy],
  godot: [`<path d="M20 22l6 3h12l6-3v18c0 5-6 8-12 8s-12-3-12-8z"/><circle cx="27" cy="34" r="3" fill="${C.cy}" stroke="${C.cy}"/><circle cx="37" cy="34" r="3" fill="${C.cy}" stroke="${C.cy}"/>`, C.sky],
  parity: [`<rect x="15" y="22" width="14" height="20" rx="3"/><rect x="35" y="22" width="14" height="20" rx="3"/><path d="M29 30h6M29 36h6" stroke="${C.gn}"/><path d="M20 32l3 3 4-5M40 32l3 3 4-5" stroke="${C.gn}"/>`, C.gn],
  rendering: [`<circle cx="32" cy="32" r="14"/><path d="M14 32h8M42 32h8M32 14v8M32 42v8"/><path d="M26 26l12 12M38 26L26 38" opacity=".5"/>`, C.mg],
  languages: [`<path d="M22 24l-8 8 8 8M42 24l8 8-8 8M36 20l-8 24"/>`, C.cy],
  docs: [`<path d="M20 16h18l8 8v24H20z"/><path d="M38 16v8h8M26 32h14M26 38h14"/>`, C.sky],
  audio: [`<path d="M16 28h8l10-8v24l-10-8h-8z"/><path d="M40 26c3 3 3 9 0 12M45 22c6 6 6 14 0 20"/>`, C.am],
};
const iconSvgs = Object.fromEntries(Object.entries(glyphs).map(([name, [body, col]]) => [name, svg(64, 64, `<rect x="4" y="4" width="56" height="56" rx="12" fill="${C.bg}" stroke="${col}" stroke-width="1.75"/><path d="M20 4v56M36 4v56M52 4v56M4 20h56M4 36h56M4 52h56" stroke="${col}" stroke-width=".5" opacity=".12"/><g fill="none" stroke="${col}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${body}</g>`)]));

// ---- write ----
const out = (rel, s) => { const p = join(ROOT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s); return p; };
const png = process.argv.includes('--no-png') ? () => {} : (rel, w) => { const p = join(ROOT, rel); execFileSync('inkscape', [p, '--export-type=png', `--export-filename=${p.replace(/\.svg$/, '.png')}`, `--export-width=${w}`], { stdio: 'ignore' }); };
for (const [rel, s, w] of [['assets/logo.svg', iconSvg, 512], ['docs/assets/icon.svg', iconSvg, 512], ['docs/assets/logo.svg', heroSvg, 1200], ['docs/assets/social.svg', socialSvg, 1280]]) { out(rel, s); png(rel, w); }
for (const [n, s] of Object.entries(iconSvgs)) { const rel = `docs/assets/icons/icon-${n}.svg`; out(rel, s); png(rel, 128); }
console.log(`brand kit written: 4 hero/icon/social + ${Object.keys(iconSvgs).length} category icons`);
