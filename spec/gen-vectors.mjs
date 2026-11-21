#!/usr/bin/env node
// Regenerate spec/vectors/*.json from the JS reference. Deterministic: fixed seeds, canonical (sorted) key order.
// Usage: node spec/gen-vectors.mjs   (writes files)   |  import { buildAll } for verify-vectors.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as rngRef from './rng-reference.mjs';
import * as phys from './reference/platformer-physics.mjs';
import * as haz from './reference/hazard-kit.mjs';
import * as wg from './reference/world-gen.mjs';
import * as ap from './reference/autopilot.mjs';

export const VERSION = 1;
const here = dirname(fileURLToPath(import.meta.url));
export const VECTOR_DIR = join(here, 'vectors');

const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number in vector');
  return v;
};
const rt = (v) => JSON.parse(JSON.stringify(v));

// ---------------- rng ----------------
function rngCases() {
  const c = [];
  const seeds = [0, 1, 42, 12345, 0x9e3779b9, 0xffffffff];
  for (const s of seeds) c.push({ name: `pcg32 u32 seed=${s}`, input: { alg: 'pcg32', seed: s, op: 'u32', n: 16 } });
  for (const s of ['', 'a', 'hello', 'game-factory', 'ünïcödé ☃']) {
    c.push({ name: `fnv1a ${JSON.stringify(s)}`, input: { op: 'fnv1a', str: s } });
    c.push({ name: `pcg32 u32 string seed ${JSON.stringify(s)}`, input: { alg: 'pcg32', seed: s, op: 'u32', n: 8 } });
  }
  for (const s of [1, 7, 99]) c.push({ name: `pcg32 float seed=${s}`, input: { alg: 'pcg32', seed: s, op: 'float', n: 12 } });
  for (const [lo, hi] of [[0, 0], [0, 1], [0, 9], [-5, 5], [10, 1000], [0, 4294967295], [3, 3]]) {
    c.push({ name: `pcg32 int ${lo}..${hi}`, input: { alg: 'pcg32', seed: 2024, op: 'int', lo, hi, n: 20 } });
  }
  c.push({ name: 'pcg32 range', input: { alg: 'pcg32', seed: 5, op: 'range', lo: -2.5, hi: 7.5, n: 10 } });
  c.push({ name: 'pcg32 chance', input: { alg: 'pcg32', seed: 5, op: 'chance', p: 0.3, n: 24 } });
  c.push({ name: 'pcg32 pick', input: { alg: 'pcg32', seed: 8, op: 'pick', items: ['a', 'b', 'c', 'd', 'e'], n: 16 } });
  for (const len of [0, 1, 2, 5, 12]) c.push({ name: `pcg32 shuffle len=${len}`, input: { alg: 'pcg32', seed: 31337, op: 'shuffle', items: Array.from({ length: len }, (_, i) => i) } });
  for (const s of [0, 1, 1234, 0xffffffff, 4294967297]) c.push({ name: `mulberry32 float seed=${s}`, input: { alg: 'mulberry32', seed: s, op: 'float', n: 10 } });
  c.push({ name: 'mulberry32 int', input: { alg: 'mulberry32', seed: 77, op: 'int', lo: 0, hi: 11, n: 20 } });
  for (const s of [0, 1, 0x9e3779b9, -5]) c.push({ name: `botRng seed=${s}`, input: { alg: 'bot', seed: s, op: 'float', n: 10 } });
  return c;
}

// ---------------- platformer-physics ----------------
function physCases() {
  const c = [];
  const flat = { groundY: 160 };
  const sim = (name, input) => c.push({ name, input: { op: 'sim', dt: 1 / 60, ...input } });
  for (const [n, o] of [['default', {}], ['moon', { gravity: 200, jumpV: 120 }], ['fast', { runSpeed: 100, airSpeed: 90 }], ['heavy', { gravity: 900, jumpV: 300 }]]) {
    c.push({ name: `ranges ${n}`, input: { op: 'ranges', cfg: o } });
  }
  sim('run right on flat', { world: flat, body: { x: 20, y: 160 }, script: [{ dx: 1, n: 60 }, { dx: -1, n: 30 }, { n: 10 }] });
  sim('standing jump', { world: flat, body: { x: 100, y: 160 }, script: [{ jp: true, n: 1 }, { n: 80 }] });
  sim('run jump right', { world: flat, body: { x: 40, y: 160 }, script: [{ dx: 1, jp: true, n: 1 }, { dx: 1, n: 70 }] });
  sim('air steering', { world: flat, body: { x: 100, y: 160 }, script: [{ dx: 1, jp: true, n: 1 }, { dx: -1, n: 40 }, { dx: 1, n: 30 }] });
  sim('hard landing emits hardland', { world: flat, body: { x: 100, y: 20 }, script: [{ n: 90 }], });
  sim('deadly pit fall', { world: { groundY: 160, pits: [{ x0: 80, x1: 120, kind: 'tar' }] }, body: { x: 70, y: 160 }, script: [{ dx: 1, jp: true, n: 1 }, { dx: 1, n: 50 }, { n: 20 }] });
  sim('pit default kind', { world: { groundY: 160, pits: [{ x0: 80, x1: 120 }] }, body: { x: 85, y: 100 }, script: [{ n: 40 }] });
  sim('drop pit is safe', { world: { groundY: 160, pits: [{ x0: 80, x1: 120, kind: 'hole', drop: true }] }, body: { x: 90, y: 100 }, script: [{ n: 40 }] });
  sim('run off ledge into pit', { world: { groundY: 160, pits: [{ x0: 80, x1: 120, kind: 'pit' }] }, body: { x: 60, y: 160 }, script: [{ dx: 1, n: 50 }, { n: 40 }] });
  sim('jump across pit', { world: { groundY: 160, pits: [{ x0: 80, x1: 100 }] }, body: { x: 60, y: 160 }, script: [{ dx: 1, n: 5 }, { dx: 1, jp: true, n: 1 }, { dx: 1, n: 60 }] });
  const plats = { groundY: 160, platforms: [{ id: 'a', x: 100, y: 120, w: 40 }, { id: 'b', x: 160, y: 90, w: 30 }] };
  sim('land on one-way platform', { world: plats, body: { x: 100, y: 160 }, script: [{ jp: true, n: 1 }, { n: 60 }] });
  sim('platform walk off edge', { world: plats, body: { x: 100, y: 120 }, script: [{ dx: 1, n: 50 }, { n: 30 }] });
  sim('jump up through platform', { world: plats, body: { x: 160, y: 120 }, script: [{ jp: true, n: 1 }, { n: 60 }] });
  sim('moving platform carries rider', { world: { groundY: 160, platforms: [{ id: 'm', moving: { id: 'm', x0: 80, y0: 120, x1: 160, y1: 120, w: 30, speed: 30 } }] }, body: { x: 80, y: 120 }, script: [{ n: 90 }] });
  sim('vertical moving platform', { world: { groundY: 160, platforms: [{ id: 'm', moving: { id: 'm', x0: 100, y0: 140, x1: 100, y1: 90, w: 30, speed: 20 } }] }, body: { x: 100, y: 140 }, script: [{ n: 100 }] });
  const lad = { groundY: 160, ladders: [{ x: 100, top: 100, bottom: 160 }] };
  sim('climb ladder up to top', { world: lad, body: { x: 98, y: 160 }, script: [{ dy: -1, n: 120 }, { n: 5 }] });
  sim('climb down then bottom', { world: lad, body: { x: 100, y: 100 }, script: [{ dy: 1, n: 120 }] });
  sim('climb pause mid ladder', { world: lad, body: { x: 100, y: 160 }, script: [{ dy: -1, n: 20 }, { n: 10 }, { dy: 1, n: 10 }] });
  sim('ladder not entered when far', { world: lad, body: { x: 130, y: 160 }, script: [{ dy: -1, n: 10 }] });
  const rope = { groundY: 160, ropes: [{ px: 120, py: 40, len: 70, amp: 0.7, period: 2 }] };
  sim('grab rope and swing', { world: rope, useWorldT: true, body: { x: 116, y: 128, set: { mode: 'air', vy: -10 } }, script: [{ n: 120 }] });
  sim('rope release by jump', { world: rope, useWorldT: true, body: { x: 116, y: 128, set: { mode: 'air', vy: -10 } }, script: [{ n: 40 }, { jp: true, n: 1 }, { dx: 1, n: 60 }] });
  sim('rope uses body.t when no world.t', { world: rope, body: { x: 120, y: 126, set: { mode: 'air' } }, script: [{ n: 50 }] });
  sim('rope far away no grab', { world: rope, useWorldT: true, body: { x: 250, y: 100, set: { mode: 'air' } }, script: [{ n: 60 }] });
  sim('ceiling bounds clamp', { world: { groundY: 160, bounds: { minY: 60 } }, body: { x: 100, y: 160 }, script: [{ jp: true, n: 1 }, { n: 40 }] });
  sim('dead body is inert', { world: flat, body: { x: 100, y: 100, set: { mode: 'dead' } }, script: [{ dx: 1, jp: true, n: 10 }] });
  sim('custom cfg low gravity', { cfg: { gravity: 200, jumpV: 120, airSpeed: 40 }, world: flat, body: { x: 100, y: 160 }, script: [{ dx: 1, jp: true, n: 1 }, { dx: 1, n: 90 }] });
  sim('large dt 1/30', { dt: 1 / 30, world: flat, body: { x: 100, y: 160 }, script: [{ dx: 1, jp: true, n: 1 }, { dx: 1, n: 40 }] });
  sim('dt 1/120 jump', { dt: 1 / 120, world: flat, body: { x: 100, y: 160 }, script: [{ jp: true, n: 1 }, { n: 160 }] });
  sim('platform edge boundary |dx|==w/2', { world: { groundY: 160, platforms: [{ id: 'e', x: 100, y: 120, w: 40 }] }, body: { x: 120, y: 80, set: { mode: 'air' } }, script: [{ n: 30 }] });
  sim('grab cooldown blocks regrab', { world: rope, useWorldT: true, body: { x: 116, y: 128, set: { mode: 'air', vy: -10, grabCd: 0.35 } }, script: [{ n: 60 }] });
  c.push({ name: 'pendulum samples', input: { op: 'pendulum', rope: { px: 100, py: 20, len: 50, amp: 0.6, period: 2.4 }, ts: [0, 0.25, 0.6, 1.2, 1.8, 2.4, 3.1, 10] } });
  c.push({ name: 'pendulum large amp', input: { op: 'pendulum', rope: { px: 0, py: 0, len: 30, amp: 1.2, period: 1 }, ts: [0, 0.1, 0.25, 0.5, 0.75] } });
  c.push({ name: 'moving ping-pong', input: { op: 'moving', platform: { id: 1, x0: 0, y0: 0, x1: 30, y1: 40, speed: 25, w: 24 }, dt: 1 / 60, ticks: 200 } });
  c.push({ name: 'moving degenerate span', input: { op: 'moving', platform: { id: 2, x0: 5, y0: 5, speed: 10 }, dt: 0.1, ticks: 5 } });
  c.push({ name: 'moving with phase', input: { op: 'moving', platform: { id: 3, x0: 0, y0: 0, x1: 10, speed: 7, phase: 1.3 }, dt: 0.05, ticks: 60 } });
  const qw = { groundY: 160, pits: [{ x0: 50, x1: 70 }, { x0: 200, x1: 240 }], ladders: [{ x: 120, top: 80, bottom: 160 }, { x: 150, top: 80, bottom: 160, w: 20 }],
    platforms: [{ id: 'p', x: 100, y: 120, w: 30 }] };
  c.push({ name: 'support queries', input: { op: 'support', world: qw, pitAt: [49, 50, 51, 70, 69.9, 220, 241], ladderAt: [[120, 100], [124, 100], [124.1, 100], [150, 79], [150, 78.9], [150, 161], [160, 100]],
    supportAt: [[100, 120], [110, 123], [100, 124], [60, 160], [10, 160], [115, 120], [115.1, 120]] } });
  c.push({ name: 'edge transitions', input: { op: 'edge', cases: [
    { body: { x: 3.9 }, idx: 0, count: 10 }, { body: { x: 4 }, idx: 0, count: 10 }, { body: { x: 316 }, idx: 9, count: 10 }, { body: { x: 316.1 }, idx: 9, count: 10 },
    { body: { x: 2, mode: 'air' }, idx: 5, count: 10, cfg: { stride: 3 } }, { body: { x: 330 }, idx: 8, count: 10, cfg: { stride: 3 } },
    { body: { x: 2, mode: 'climb' }, idx: 5, count: 10 }, { body: { x: 2 }, idx: 1, count: 3, cfg: { stride: 5 } }, { body: { x: 100 }, idx: 1, count: 3 } ] } });
  return c;
}

// ---------------- hazard-kit ----------------
const KINDS = {
  scorpion: { pattern: 'patroller', params: { minX: 50, maxX: 200, speed: 30 } },
  guard: { pattern: 'patroller', params: { w: 10, h: 14, speed: 12, lethal: 'life', framePx: 3, frames: 3 } },
  log: { pattern: 'roller', params: { speed: 46 } },
  hopper: { pattern: 'roller', params: { speed: 30, hop: { period: 1.2, len: 0.6, height: 12 } } },
  fire: { pattern: 'stationary', params: { frames: 3, fps: 8 } },
  croc: { pattern: 'cycler', params: { period: 2.8, openFrac: 0.45 } },
  gate: { pattern: 'cycler', params: { period: 1, openFrac: 0.5, closedSolid: false, openLethal: 'points' } },
  maker: { pattern: 'spawner', params: { every: 1.5, kind: 'log', props: { x: 310, y: 150 } } },
  boss: { pattern: 'tauntingBoss', params: { every: 1, taunts: ['HA', 'HO', 'HE', 'HU'], throwKind: 'log', throwProps: { x: 200, y: 150 }, sfx: 'laugh' } },
  mute: { pattern: 'tauntingBoss', params: { every: 0.5, taunts: ['one', 'two'] } },
};
function hazCases() {
  const c = [];
  const sim = (name, input) => c.push({ name, input: { op: 'sim', dt: 1 / 60, width: 320, ...input } });
  sim('patroller bounce', { kinds: KINDS, entities: [{ kind: 'scorpion', props: { x: 60, y: 160 } }], ticks: 400 });
  sim('patroller clamps init and dir', { kinds: KINDS, entities: [{ kind: 'scorpion', props: { x: 500, y: 160, dir: 1 } }, { kind: 'scorpion', props: { x: 0, y: 160, dir: 7 } }], ticks: 60 });
  sim('patroller per-entity speed and st', { kinds: KINDS, entities: [{ kind: 'guard', props: { x: 10, y: 160, speed: 50, st: { minX: 0, maxX: 40 } } }], ticks: 120 });
  sim('roller wraps left', { kinds: KINDS, entities: [{ kind: 'log', props: { x: 20, y: 160 } }], ticks: 240 });
  sim('roller wraps right', { kinds: KINDS, entities: [{ kind: 'log', props: { x: 300, y: 160, dir: 1 } }], ticks: 240 });
  sim('roller hop arcs', { kinds: KINDS, entities: [{ kind: 'hopper', props: { x: 300, y: 150 } }], ticks: 240 });
  sim('stationary flicker with phase', { kinds: KINDS, entities: [{ kind: 'fire', props: { x: 100, y: 160, st: { phase: 0.3 } } }, { kind: 'fire', props: { x: 120, y: 160 } }], ticks: 90 });
  sim('cycler open/closed', { kinds: KINDS, entities: [{ kind: 'croc', props: { x: 100, y: 160 } }], ticks: 240 });
  sim('cycler staggered phases', { kinds: KINDS, entities: [0, 1, 2].map((i) => ({ kind: 'croc', props: { x: 100 + i * 30, y: 160, st: { phase: (i * 2.8) / 3 } } })), ticks: 180 });
  sim('cycler non-solid gate', { kinds: KINDS, entities: [{ kind: 'gate', props: { x: 50, y: 100, st: { phase: 0.9 } } }], ticks: 130 });
  sim('spawner spawns and updates same tick', { kinds: KINDS, entities: [{ kind: 'maker', props: { x: 0, y: 0 } }], ticks: 300 });
  sim('spawner first delay', { kinds: { ...KINDS, maker: { pattern: 'spawner', params: { every: 2, first: 0.5, kind: 'fire', props: { x: 10, y: 20 } } } }, entities: [{ kind: 'maker', props: {} }], ticks: 200 });
  sim('boss taunts with spec rng', { kinds: KINDS, rngSeed: 4242, entities: [{ kind: 'boss', props: { x: 250, y: 160 } }], ticks: 300 });
  sim('boss without rng cycles lines', { kinds: KINDS, noRng: true, entities: [{ kind: 'boss', props: { x: 250, y: 160 } }], ticks: 300 });
  sim('boss no throw no sfx', { kinds: KINDS, rngSeed: 1, entities: [{ kind: 'mute', props: {} }], ticks: 90 });
  sim('dead entities skipped', { kinds: KINDS, entities: [{ kind: 'log', props: { x: 100, y: 160, dead: true } }, { kind: 'log', props: { x: 100, y: 160 } }], ticks: 30 });
  sim('mixed population', { kinds: KINDS, rngSeed: 9, entities: [{ kind: 'scorpion', props: { x: 100, y: 160 } }, { kind: 'log', props: { x: 300, y: 160 } }, { kind: 'fire', props: { x: 50, y: 160 } }, { kind: 'croc', props: { x: 200, y: 160 } }, { kind: 'boss', props: { x: 280, y: 160 } }], ticks: 200 });
  sim('defaults merge and st merge', { kinds: { a: { pattern: 'stationary', params: {}, defaults: { st: { phase: 0.5, extra: 1 }, points: -50 } } }, entities: [{ kind: 'a', props: { st: { phase: 0.1 } } }], ticks: 20 });
  sim('dt 1/30', { dt: 1 / 30, kinds: KINDS, entities: [{ kind: 'scorpion', props: { x: 60, y: 160 } }, { kind: 'log', props: { x: 100, y: 150 } }], ticks: 100 });
  const ovl = [];
  for (const [px, py] of [[100, 160], [95.9, 160], [96, 160], [104, 160], [104.1, 160], [100, 168], [100, 152], [100, 143.9], [100, 144], [100, 176]]) ovl.push({ p: { x: px, y: py }, hw: 4, hh: 16, e: { x: 100, y: 160, w: 12, h: 8 } });
  c.push({ name: 'overlaps boundaries', input: { op: 'overlaps', cases: ovl } });
  const ents = [{ kind: 'scorpion', props: { x: 100, y: 160 } }, { kind: 'log', props: { x: 100, y: 160 } }, { kind: 'fire', props: { x: 300, y: 160 } },
    { kind: 'fire', props: { x: 100, y: 160, collect: true, lethal: null } }, { kind: 'log', props: { x: 100, y: 160, layer: 'under' } }, { kind: 'croc', props: { x: 100, y: 160 } }, { kind: 'log', props: { x: 100, y: 160, dead: true } }];
  c.push({ name: 'contacts kinds and layers', input: { op: 'contacts', kinds: KINDS, entities: ents, steps: [{ time: 0, player: { x: 100, y: 160, layer: 'surface' } }], opts: {} } });
  c.push({ name: 'contacts layer under', input: { op: 'contacts', kinds: KINDS, entities: ents, steps: [{ time: 0, player: { x: 100, y: 160, layer: 'under' } }], opts: {} } });
  c.push({ name: 'contacts no player layer', input: { op: 'contacts', kinds: KINDS, entities: ents, steps: [{ time: 0, player: { x: 100, y: 160 } }], opts: { hitW: 6, hitH: 10 } } });
  c.push({ name: 'points cooldown', input: { op: 'contacts', kinds: KINDS, entities: [{ kind: 'log', props: { x: 100, y: 160, points: -25 } }],
    steps: [0, 0.3, 0.59, 0.6, 0.61, 1.2, 1.3].map((t) => ({ time: t, player: { x: 100, y: 160 } })), opts: {} } });
  c.push({ name: 'points default penalty and custom cooldown', input: { op: 'contacts', kinds: KINDS, entities: [{ kind: 'log', props: { x: 100, y: 160 } }],
    steps: [0, 0.5, 1, 1.4, 2].map((t) => ({ time: t, player: { x: 100, y: 160 } })), opts: { hitCooldown: 1, pointsPenalty: -7 } } });
  c.push({ name: 'points cooldown uses e.t when no time', input: { op: 'contacts', kinds: KINDS, entities: [{ kind: 'log', props: { x: 100, y: 160, t: 5 } }],
    steps: [{ player: { x: 100, y: 160 } }, { player: { x: 100, y: 160 } }], opts: {} } });
  const solids = [{ kind: 'croc', props: { x: 100, y: 160 } }, { kind: 'croc', props: { x: 100, y: 160, topY: 140, w: 40 } }, { kind: 'scorpion', props: { x: 300, y: 160 } }, { kind: 'croc', props: { x: 200, y: 160, dead: true } }, { kind: 'croc', props: { x: 220, y: 100 } }];
  c.push({ name: 'solidTop queries', input: { op: 'solid', kinds: KINDS, entities: solids,
    under: [[100, 150, 140], [100, 150, 160], [121, 150, 140], [123, 150, 140], [100, 120, 100, 0], [200, 150, 140], [220, 92, 80], [100, 150, 150.5]],
    carrying: [[100, 150], [100, 153], [100, 153.1], [100, 143], [100, 137], [200, 150], [300, 150], [125, 150, 0]] } });
  return c;
}

// ---------------- world-gen ----------------
const RULES = (o = {}) => ({
  seed: 1234, count: 48, start: 0,
  blocks: { size: 12, deck: ['hole', 'hole', 'pit', 'plain', 'rest'], fixed: { 6: 'boss' }, firstSlot: 'rest' },
  spacing: { edgeClear: 36, gap: 48, step: 4 },
  slots: {
    plain: { place: [{ kinds: [{ kind: 'log', weight: 4 }, { kind: 'cheese', weight: 1.5, minT: 0.35, perT: 1.5 }], chance: { base: 0.5, perT: 0.4 }, count: 1, maxT: 1 }, { kinds: [{ kind: 'roll', weight: 1, props: { speed: 40 } }], chance: 0.5, mode: 'rolling' }] },
    hole: { set: { hole: true }, place: [{ kinds: [{ kind: 'fire' }], chance: 0.3 }], build: { type: 'pit', kind: 'hole', chance: 1, w: { from: 24, to: 52 } } },
    pit: { set: { deep: 1 }, build: { type: 'pit', kind: 'tar', chance: { from: 0.5, to: 1 }, w: { from: 20, to: 40 }, lo: 80, hi: 240 }, place: [{ kinds: [{ kind: 'snake' }, { kind: 'scorp', minT: 0.2 }], chance: 0.6, count: 2 }] },
    rest: {},
    boss: { set: { boss: true }, place: [{ kinds: [{ kind: 'cheese' }], chance: 1, fixedX: 160 }] },
  },
  collectibles: { count: 8, tiers: [{ type: 'tuna', upTo: 3 }, { type: 'gold', upTo: 8 }], exclude: 'boss', prefer: { every: 3, pitKind: 'hole' } },
  ...o,
});
function wgCases() {
  const c = [];
  c.push({ name: 'helpers', input: { op: 'helpers', wrap: [[0, 5], [-1, 5], [5, 5], [7, 5], [-11, 5], [3, 1]], circDist: [[0, 4, 10], [1, 9, 10], [5, 0, 10], [0, 5, 11], [3, 3, 7]],
    rampOf: [[0, 0, 10], [5, 0, 10], [3, 0, 10], [8, 2, 10], [0, 0, 7], [3, 0, 7]], lerpVal: [[null, 0.5], [3, 0.9], [{ from: 1, to: 3 }, 0.25], [{ base: 0.5, perT: 0.4 }, 0.5], [{ from: 1, to: 3, perT: 1 }, 0.5], [{ to: 2 }, 0.5], [{}, 1]] } });
  for (const s of [1, 2, 1234, 0xffffffff, 4294967297, 0]) c.push({ name: `createRng floats seed=${s}`, input: { op: 'rng', seed: s, n: 8 } });
  for (const len of [0, 1, 2, 3, 8, 12]) c.push({ name: `shuffle len=${len}`, input: { op: 'shuffle', seed: 99, items: Array.from({ length: len }, (_, i) => 'c' + i) } });
  c.push({ name: 'pickWeighted', input: { op: 'weighted', seed: 5, items: [['a', 4], ['b', 1.5], ['c', 0.5]], n: 30 } });
  c.push({ name: 'pickWeighted single', input: { op: 'weighted', seed: 5, items: [['a', 1]], n: 5 } });
  c.push({ name: 'pickWeighted zero weights falls to last', input: { op: 'weighted', seed: 5, items: [['a', 0], ['b', 0]], n: 3 } });
  for (const [seed, count, start] of [[1234, 48, 0], [1, 48, 0], [7, 36, 5], [99, 24, 23], [4294967297, 48, 0], [0, 48, 0]]) {
    c.push({ name: `generate seed=${seed} count=${count} start=${start}`, input: { op: 'generate', rules: RULES({ seed, count, start }), validate: { crossable: { maxPit: 56 }, edgeClear: 36, gap: 48, collectClear: 44, maxHardRun: 3, hard: { tags: ['hole', 'pit'] } } } });
  }
  c.push({ name: 'generate no collectibles', input: { op: 'generate', rules: RULES({ collectibles: undefined, count: 24 }) } });
  c.push({ name: 'generate block size 8 fixed first', input: { op: 'generate', rules: RULES({ count: 40, blocks: { size: 8, deck: ['plain', 'hole'], fixed: { 0: 'rest', 7: 'boss' } } }) } });
  c.push({ name: 'generate deck shorter than slots wraps', input: { op: 'generate', rules: RULES({ count: 36, blocks: { size: 12, deck: ['plain', 'pit'] } }) } });
  c.push({ name: 'generate no blocks defaults', input: { op: 'generate', rules: { seed: 3, count: 12, slots: { plain: { place: [{ kinds: [{ kind: 'log' }], chance: 1, count: 2 }] } } } } });
  c.push({ name: 'generate minT/maxT/clampT gates', input: { op: 'generate', rules: { seed: 5, count: 20, blocks: { size: 5, deck: ['a'] }, slots: { a: { place: [{ kinds: [{ kind: 'k1', maxT: 0.5 }, { kind: 'k2', minT: 0.5 }], chance: 1, clampT: 0.9, minT: 0.1 }, { kinds: [{ kind: 'late' }], chance: 1, minT: 0.6 }, { kinds: [{ kind: 'early' }], chance: 1, maxT: 0.4, lo: 40, hi: 120 }] } } } } });
  c.push({ name: 'generate wider spacing', input: { op: 'generate', rules: RULES({ spacing: { edgeClear: 60, gap: 90, step: 6 } }), validate: { edgeClear: 60, gap: 90 } } });
  c.push({ name: 'generate collectible overflow throws-free exclusion', input: { op: 'generate', rules: RULES({ count: 120, collectibles: { count: 30, tiers: [{ type: 'a', upTo: 12 }, { type: 'b', upTo: 30 }], exclude: 'boss' } }) } });
  const mk = (idx, items, zones = [], extra = {}) => ({ idx, tag: 'x', t: 0, items, zones, collectible: null, ...extra });
  c.push({ name: 'validate catches edge gap zone', input: { op: 'validate', world: { collectibles: [], screens: [
    mk(0, [{ kind: 'a', x: 10 }, { kind: 'b', x: 100 }, { kind: 'c', x: 120 }, { kind: 'r' }]),
    mk(1, [{ kind: 'a', x: 100 }], [{ x0: 130, x1: 150 }]), mk(2, [{ kind: 'a', x: 315 }]), mk(3, []) ] }, opts: {} } });
  c.push({ name: 'validate allow flags', input: { op: 'validate', world: { collectibles: [], screens: [mk(0, [{ kind: 'a', x: 10 }, { kind: 'b', x: 150 }], [{ x0: 160, x1: 180 }])] }, opts: { allowEdgeItems: true, allowItemsNearZones: true } } });
  c.push({ name: 'validate collectible rules', input: { op: 'validate', world: { collectibles: [{ id: 0, type: 't', screen: 0, x: 120 }, { id: 1, type: 't', screen: 0, x: 200 }], screens: [
    mk(0, [{ kind: 'a', x: 100 }, { kind: 'rolling' }], [], { collectible: { id: 0, type: 't', x: 120 } })] }, opts: { rollingSweepsCollectible: true } } });
  c.push({ name: 'validate crossable string and false', input: { op: 'validate', world: { collectibles: [], screens: [
    mk(0, [], [], { pit: { kind: 'h', x0: 100, w: 90 } }), mk(1, [], [], { pit: { kind: 'h', x0: 100, w: 30 } }), mk(2, [])] }, opts: { crossable: { maxPit: 56 } } } });
  const hardWorld = (tags) => ({ collectibles: [], screens: tags.map((t, i) => mk(i, [], [], { tag: t })) });
  c.push({ name: 'validate hardRun exceeded', input: { op: 'validate', world: hardWorld(['h', 'h', 'h', 'h', 'e', 'e']), opts: { maxHardRun: 3, hard: { tags: ['h'] } } } });
  c.push({ name: 'validate hardRun wraps circularly', input: { op: 'validate', world: hardWorld(['h', 'h', 'e', 'e', 'h', 'h']), opts: { maxHardRun: 3, hard: { tags: ['h'] } } } });
  c.push({ name: 'validate hardRun all hard ignored', input: { op: 'validate', world: hardWorld(['h', 'h', 'h']), opts: { maxHardRun: 1, hard: { tags: ['h'] } } } });
  c.push({ name: 'validate duplicate collectible screen', input: { op: 'validate', world: { collectibles: [{ id: 0, type: 't', screen: 1, x: 100 }, { id: 1, type: 't', screen: 1, x: 200 }], screens: [mk(0, []), mk(1, [])] }, opts: {} } });
  return c;
}

// ---------------- autopilot ----------------
function apCases() {
  const c = [];
  c.push({ name: 'input helper', input: { op: 'input', args: [1, -1, true] } });
  c.push({ name: 'input defaults', input: { op: 'input', args: [] } });
  for (const s of [1, 0, 0x9e3779b9, 123456]) c.push({ name: `botRng seed=${s}`, input: { op: 'botRng', seed: s, n: 8 } });
  const kinds = { scorpion: KINDS.scorpion, log: KINDS.log, croc: KINDS.croc, bad: { pattern: 'faulty' } };
  c.push({ name: 'trajectory patroller+roller', input: { op: 'trajectory', kinds, entities: [{ kind: 'scorpion', props: { x: 60, y: 160 } }, { kind: 'log', props: { x: 300, y: 150 } }], n: 30, dt: 1 / 60 } });
  c.push({ name: 'trajectory skips dead', input: { op: 'trajectory', kinds, entities: [{ kind: 'log', props: { x: 100, y: 150, dead: true } }, { kind: 'croc', props: { x: 100, y: 150 } }], n: 10, dt: 0.1 } });
  c.push({ name: 'trajectory faulty contained', input: { op: 'trajectory', kinds, entities: [{ kind: 'bad', props: { x: 1, y: 2 } }, { kind: 'log', props: { x: 100, y: 150 } }], n: 5, dt: 0.05 } });
  c.push({ name: 'trajectory n=0', input: { op: 'trajectory', kinds, entities: [{ kind: 'log', props: { x: 100, y: 150 } }], n: 0, dt: 0.05 } });
  // searchMacros: costs drawn from spec PCG so tables are deterministic
  const table = (seed, fams, n, hi) => { const r = rngRef.pcg32(seed); return Array.from({ length: fams }, () => Array.from({ length: n }, () => Math.round(r.next() * hi * 1000) / 1000)); };
  for (const [seed, hi, opts] of [[1, 100, {}], [2, 30, {}], [3, 100, { count: 10, stride: 2 }], [4, 20, { robustBelow: 5 }], [5, 100, { nTax: 0.5 }], [6, 100, { count: 1 }], [7, 40, { count: 30, stride: 3, robustBelow: 1e9 }]]) {
    const n = opts.count ?? 30;
    c.push({ name: `searchMacros seed=${seed} opts=${JSON.stringify(opts)}`, input: { op: 'search', families: [{ bias: 0 }, { bias: 2 }, { bias: -1.5 }], costTable: table(seed, 3, n, hi), opts } });
  }
  c.push({ name: 'searchMacros spike only robust at plateau', input: { op: 'search', families: [{ bias: 0 }, {}], costTable: [Array.from({ length: 30 }, (_, i) => (i === 5 ? 0 : 900)), Array.from({ length: 30 }, (_, i) => (i >= 10 && i <= 14 ? 10 : 900))], opts: {} } });
  c.push({ name: 'searchMacros all tied picks first', input: { op: 'search', families: [{}, {}], costTable: [Array(30).fill(7), Array(30).fill(7)], opts: { nTax: 0 } } });
  c.push({ name: 'searchMacros no families', input: { op: 'search', families: [], costTable: [], opts: {} } });
  const wdTicks = (n, f) => Array.from({ length: n }, (_, i) => f(i));
  c.push({ name: 'watchdog progress never stuck', input: { op: 'watchdog', opts: { limit: 5, panicTicks: 10 }, ticks: wdTicks(60, (i) => ['k' + Math.floor(i / 3), i / 10]) } });
  c.push({ name: 'watchdog stuck panics then recovers', input: { op: 'watchdog', opts: { limit: 2, panicTicks: 5 }, ticks: wdTicks(60, (i) => ['same', i / 10]) } });
  c.push({ name: 'watchdog defaults', input: { op: 'watchdog', opts: {}, ticks: wdTicks(400, (i) => ['same', i * 0.5]) } });
  c.push({ name: 'watchdog key change resets panic', input: { op: 'watchdog', opts: { limit: 1, panicTicks: 8 }, ticks: wdTicks(40, (i) => [i < 20 ? 'a' : 'b', i / 10]) } });
  c.push({ name: 'watchdog flail pattern long', input: { op: 'watchdog', opts: { limit: 0, panicTicks: 300 }, ticks: wdTicks(200, (i) => ['x', 1 + i]) } });
  const seq = (n, r) => Array.from({ length: n }, (_, i) => ({ dx: 1, jp: i % 7 === 3 || i % 11 === 0, canAct: r ? r(i) : true }));
  for (const [skill, rng] of [[1, { kind: 'bot', seed: 1 }], [0.9, { kind: 'bot', seed: 1 }], [0.5, { kind: 'bot', seed: 7 }], [0, { kind: 'bot', seed: 3 }], [0.5, { kind: 'pcg32', seed: 7 }], [0.75, { kind: 'pcg32', seed: 'abc' }]]) {
    c.push({ name: `humanize skill=${skill} rng=${rng.kind}:${rng.seed}`, input: { op: 'humanize', skill, rng, seq: seq(80) } });
  }
  c.push({ name: 'humanize canAct false passes through', input: { op: 'humanize', skill: 0.3, rng: { kind: 'bot', seed: 1 }, seq: seq(40, (i) => i % 5 !== 0) } });
  const ticks = (n, f) => Array.from({ length: n }, (_, i) => ({ key: 'k', time: i / 10, decide: { dx: 1, jump: i % 9 === 0 }, ...f(i) }));
  c.push({ name: 'autopilot passthrough perfect', input: { op: 'autopilot', cfg: {}, ticks: ticks(30, (i) => ({ key: 'k' + Math.floor(i / 5) })) } });
  c.push({ name: 'autopilot decide throws contained', input: { op: 'autopilot', cfg: {}, ticks: ticks(10, (i) => ({ key: 'k' + i, decide: i % 3 === 0 ? 'throw' : { dx: -1, jump: false } })) } });
  c.push({ name: 'autopilot watchdog flail', input: { op: 'autopilot', cfg: { watchdog: { limit: 1, panicTicks: 20 } }, ticks: ticks(80, () => ({})) } });
  c.push({ name: 'autopilot not playing skips watchdog', input: { op: 'autopilot', cfg: { watchdog: { limit: 1, panicTicks: 20 } }, ticks: ticks(60, () => ({ playing: false })) } });
  c.push({ name: 'autopilot humanized skill 0.5', input: { op: 'autopilot', cfg: { skill: 0.5, seed: 11 }, ticks: ticks(90, (i) => ({ key: 'k' + Math.floor(i / 2) })) } });
  c.push({ name: 'autopilot humanized canHumanize toggles', input: { op: 'autopilot', cfg: { skill: 0.2, seed: 5 }, ticks: ticks(60, (i) => ({ key: 'k' + i, canHumanize: i % 4 !== 0 })) } });
  c.push({ name: 'autopilot throw then humanize', input: { op: 'autopilot', cfg: { skill: 0.6, seed: 2 }, ticks: ticks(30, (i) => ({ key: 'k' + i, decide: i % 4 === 1 ? 'throw' : { dx: 1, jump: true } })) } });
  return c;
}

const ENGINES = [
  ['rng', rngRef, rngCases], ['platformer-physics', phys, physCases], ['hazard-kit', haz, hazCases],
  ['world-gen', wg, wgCases], ['autopilot', ap, apCases],
];
export function buildAll() {
  const out = {};
  for (const [engine, mod, mk] of ENGINES) {
    const cases = mk().map((cs) => ({ name: cs.name, input: canon(rt(cs.input)), expect: canon(rt(mod.run(rt(cs.input)))) }));
    out[engine] = JSON.stringify({ engine, version: VERSION, cases }, null, 1) + '\n';
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(VECTOR_DIR, { recursive: true });
  for (const [engine, text] of Object.entries(buildAll())) {
    writeFileSync(join(VECTOR_DIR, engine + '.json'), text);
    console.log(engine, JSON.parse(text).cases.length, 'cases');
  }
}
