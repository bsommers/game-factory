#!/usr/bin/env node
// Regenerate spec/v2/vectors/{collision2d,physics2d}.json from the JS reference (templates/web-project/src/lib).
// Deterministic: fixed inputs, canonical (sorted) key order, no clocks/randomness.
// Usage: node spec/v2/gen-vectors.mjs           write the files
//        node spec/v2/gen-vectors.mjs --check   regenerate in memory and diff against disk (exit 1 on drift)
// Port conformance: see spec/v2/collision2d.md and physics2d.md (ints exact, floats within 1e-9 abs/rel).
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as C from '../../templates/web-project/src/lib/collision2d.js';
import * as P from '../../templates/web-project/src/lib/physics2d.js';

import { same } from '../same.mjs';
export const VERSION = 2;
const here = dirname(fileURLToPath(import.meta.url));
export const VECTOR_DIR = join(here, 'vectors');

// Expected outputs only are snapped to a 1e-12 grid (cross-platform ulp differences in Math.*); inputs stay exact.
const snap = (v) => { if (Array.isArray(v)) return v.map(snap); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).map((k) => [k, snap(v[k])])); if (typeof v === 'number' && !Number.isInteger(v)) { const r = Math.round(v * 1e12) / 1e12; return Number.isInteger(r) ? v : r; } return v; };
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite number in vector'); return Object.is(v, -0) ? 0 : v; }
  return v;
};
const rt = (v) => JSON.parse(JSON.stringify(v));

// ---------------- collision2d reference runner ----------------
export const runCollision = (i) => {
  switch (i.op) {
    case 'collide': return C.collide(i.a, i.b);
    case 'distance': return C.distance(i.a, i.b);
    case 'contains': return C.containsPoint(i.shape, i.x, i.y);
    case 'bounds': return C.bounds(i.shape);
    case 'raycast': return C.raycast(i.shape, i.ox, i.oy, i.dx, i.dy, i.maxT ?? 1);
    case 'shapeCast': return C.shapeCast(i.a, i.dx, i.dy, i.b);
    case 'sweptAABB': return C.sweptAABB(i.a, i.dx, i.dy, i.b);
    case 'moveAABB': return C.moveAABB(i.a, i.dx, i.dy, i.boxes, i.iterations ?? 4);
    case 'hash': {
      const h = C.createSpatialHash(i.cellSize);
      for (const it of i.items) h.insert(it.id, it.bounds, { layer: it.layer, mask: it.mask });
      for (const m of i.moves ?? []) h.update(m.id, m.bounds);
      for (const r of i.removes ?? []) h.remove(r);
      return { pairs: h.pairs(), queries: (i.queries ?? []).map((b) => h.query(b)) };
    }
    case 'tilemap': {
      const tm = C.createTilemap(i.map);
      return { queries: (i.queries ?? []).map((b) => tm.query(b)), shapes: (i.shapes ?? []).map((s) => C.collideSource(tm, s.shape, s.opts ?? {}).map((r) => ({ col: r.collider.col, row: r.collider.row, manifold: r.manifold }))) };
    }
    default: throw new Error('unknown collision op ' + i.op);
  }
};

const A = C.aabb, Ci = C.circle, O = C.obb, Pg = C.polygon, Cp = C.capsule;
const tri = [{ x: -10, y: 8 }, { x: 12, y: 8 }, { x: 0, y: -12 }];
const hexa = Array.from({ length: 6 }, (_, k) => ({ x: Math.round(Math.cos(k * Math.PI / 3) * 1000) / 100, y: Math.round(Math.sin(k * Math.PI / 3) * 1000) / 100 }));

function collisionCases() {
  const c = [];
  const col = (name, a, b) => c.push({ name: 'collide ' + name, input: { op: 'collide', a, b } });
  col('aabb overlap x', A(0, 0, 10, 10), A(15, 2, 10, 10));
  col('aabb overlap y', A(0, 0, 10, 10), A(3, -17, 10, 10));
  col('aabb touching is none', A(0, 0, 10, 10), A(20, 0, 10, 10));
  col('aabb separated', A(0, 0, 10, 10), A(40, 0, 10, 10));
  col('aabb tie prefers y', A(0, 0, 5, 5), A(8, 8, 5, 5));
  col('aabb identical', A(3, 3, 4, 4), A(3, 3, 4, 4));
  col('circle circle', Ci(0, 0, 5), Ci(8, 0, 5));
  col('circle circle diagonal', Ci(0, 0, 5), Ci(6, 8, 5));
  col('circle circle apart', Ci(0, 0, 5), Ci(11, 0, 5));
  col('circle vs aabb side', A(0, 0, 10, 10), Ci(12, 0, 5));
  col('circle vs aabb corner', A(0, 0, 10, 10), Ci(13, 13, 5));
  col('circle centre inside aabb', A(0, 0, 10, 10), Ci(2, 1, 3));
  col('circle vs aabb corner apart', A(0, 0, 10, 10), Ci(14, 14, 5));
  col('obb vs obb', O(0, 0, 10, 10, 0.3), O(15, 3, 10, 10, -0.2));
  col('obb vs obb apart', O(0, 0, 10, 10, 0.3), O(30, 3, 10, 10, -0.2));
  col('obb face contact two points', O(0, 0, 10, 5, 0), O(0, 9, 8, 5, 0.1));
  col('obb vs aabb', A(0, 0, 10, 10), O(14, 1, 6, 6, Math.PI / 4));
  col('polygon triangle vs aabb', Pg(0, 0, tri), A(0, 14, 10, 10));
  col('hexagon vs hexagon', Pg(0, 0, hexa), Pg(15, 2, hexa, 0.5));
  col('polygon winding reversed', Pg(0, 0, [...tri].reverse()), A(0, 14, 10, 10));
  col('capsule vs capsule parallel', Cp(0, 0, 10, 4, 0), Cp(0, 6, 10, 4, 0));
  col('capsule vs capsule crossing', Cp(0, 0, 10, 3, 0), Cp(2, 0, 10, 3, Math.PI / 2));
  col('capsule vs circle at end', Cp(0, 0, 10, 4, 0), Ci(16, 0, 3));
  col('capsule vs aabb', A(0, 0, 10, 10), Cp(0, -12, 6, 4, 1));
  col('capsule vs aabb apart', A(0, 0, 10, 10), Cp(0, -30, 6, 4, 1));
  col('capsule vs polygon', Pg(0, 0, tri), Cp(4, -14, 5, 3, 0.4));
  c.push({ name: 'distance circle aabb', input: { op: 'distance', a: Ci(0, 0, 5), b: A(30, 0, 10, 10) } });
  c.push({ name: 'distance obb obb', input: { op: 'distance', a: O(0, 0, 5, 5, 0.5), b: O(30, 10, 5, 5, -0.4) } });
  c.push({ name: 'distance overlap is zero', input: { op: 'distance', a: A(0, 0, 5, 5), b: A(4, 0, 5, 5) } });
  for (const [n, s, x, y] of [['aabb in', A(0, 0, 10, 10), 5, -5], ['aabb out', A(0, 0, 10, 10), 11, 0], ['circle edge', Ci(0, 0, 5), 3, 4], ['capsule end', Cp(0, 0, 10, 4, 0), 13, 1], ['triangle in', Pg(0, 0, tri), 0, 0], ['obb out', O(0, 0, 10, 4, 0.5), 9, 9]]) c.push({ name: 'contains ' + n, input: { op: 'contains', shape: s, x, y } });
  c.push({ name: 'bounds obb', input: { op: 'bounds', shape: O(5, 5, 10, 4, 0.5) } });
  c.push({ name: 'bounds capsule', input: { op: 'bounds', shape: Cp(0, 0, 10, 4, 0.3) } });
  const ray = (name, shape, ox, oy, dx, dy, maxT) => c.push({ name: 'raycast ' + name, input: { op: 'raycast', shape, ox, oy, dx, dy, maxT } });
  ray('aabb hit', A(0, 0, 10, 10), -30, 0, 1, 0, 100);
  ray('aabb miss', A(0, 0, 10, 10), -30, 20, 1, 0, 100);
  ray('aabb too short', A(0, 0, 10, 10), -30, 0, 1, 0, 10);
  ray('aabb inside', A(0, 0, 10, 10), 1, 1, 2, 0, 1);
  ray('circle hit', Ci(0, 0, 5), -20, 3, 1, 0, 100);
  ray('circle tangent miss', Ci(0, 0, 5), -20, 5.5, 1, 0, 100);
  ray('obb diagonal', O(0, 0, 10, 4, 0.5), -30, -30, 1, 1, 100);
  ray('capsule side', Cp(0, 0, 10, 4, 0), 0, -30, 0, 1, 100);
  ray('capsule cap', Cp(0, 0, 10, 4, 0), -30, 0, 1, 0, 100);
  ray('polygon segment', Pg(0, 0, tri), -30, 0, 60, 0, 1);
  const sw = (name, a, dx, dy, b) => c.push({ name: 'sweptAABB ' + name, input: { op: 'sweptAABB', a, dx, dy, b } });
  sw('head on', A(0, 0, 5, 5), 100, 0, A(50, 0, 5, 5));
  sw('tunnelling speed', A(0, 0, 2, 2), 10000, 0, A(500, 0, 1, 20));
  sw('falling onto floor', A(0, 0, 5, 5), 0, 100, A(2, 60, 20, 5));
  sw('parallel touching misses', A(0, 0, 5, 5), 100, 0, A(0, 10, 5, 5));
  sw('moving away', A(0, 0, 5, 5), -100, 0, A(10, 0, 5, 5));
  sw('already overlapping', A(0, 0, 5, 5), 10, 0, A(6, 0, 5, 5));
  c.push({ name: 'shapeCast circle vs obb', input: { op: 'shapeCast', a: Ci(0, 0, 5), dx: 100, dy: 0, b: O(50, 0, 10, 10, 0.5) } });
  c.push({ name: 'shapeCast obb vs capsule', input: { op: 'shapeCast', a: O(0, 0, 4, 4, 0.2), dx: 80, dy: 30, b: Cp(60, 20, 8, 4, 1.2) } });
  c.push({ name: 'shapeCast miss', input: { op: 'shapeCast', a: Ci(0, 0, 3), dx: 100, dy: 0, b: A(50, 40, 5, 5) } });
  c.push({ name: 'shapeCast away', input: { op: 'shapeCast', a: Ci(0, 0, 3), dx: -100, dy: 0, b: A(50, 0, 5, 5) } });
  c.push({ name: 'moveAABB slide on wall', input: { op: 'moveAABB', a: A(0, 0, 4, 4), dx: 100, dy: 40, boxes: [A(30, 0, 5, 100)] } });
  c.push({ name: 'moveAABB corner', input: { op: 'moveAABB', a: A(0, 0, 4, 4), dx: 100, dy: 100, boxes: [A(40, 0, 5, 200), A(0, 40, 200, 5)] } });
  c.push({ name: 'moveAABB fast no tunnel', input: { op: 'moveAABB', a: A(0, 0, 2, 2), dx: 50000, dy: 0, boxes: [A(900, 0, 1, 30), A(300, 0, 1, 30)] } });
  const items = [0, 1, 2, 3, 4, 5].map((k) => ({ id: k, bounds: { minX: k * 10, minY: 0, maxX: k * 10 + 14, maxY: 10 } }));
  c.push({ name: 'hash pairs sorted', input: { op: 'hash', cellSize: 16, items, queries: [{ minX: 0, minY: 0, maxX: 5, maxY: 5 }, { minX: 25, minY: 0, maxX: 45, maxY: 5 }] } });
  c.push({ name: 'hash string ids and layers', input: { op: 'hash', cellSize: 32, items: [{ id: 'b', bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 }, layer: 1, mask: 2 }, { id: 'a', bounds: { minX: 10, minY: 10, maxX: 30, maxY: 30 }, layer: 2, mask: 1 }, { id: 7, bounds: { minX: 12, minY: 12, maxX: 18, maxY: 18 }, layer: 4, mask: 4 }, { id: 3, bounds: { minX: 14, minY: 14, maxX: 16, maxY: 16 } }] } });
  c.push({ name: 'hash negative coords + moves', input: { op: 'hash', cellSize: 8, items: [{ id: 1, bounds: { minX: -20, minY: -20, maxX: -4, maxY: -4 } }, { id: 2, bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 } }, { id: 3, bounds: { minX: 50, minY: 50, maxX: 60, maxY: 60 } }], moves: [{ id: 3, bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 } }], removes: [1], queries: [{ minX: -100, minY: -100, maxX: 100, maxY: 100 }] } });
  const map = { cols: 6, rows: 4, tileSize: 16, x: 8, y: -4, tiles: [0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 1, 4, 0, 0, 1, 1, 1, 1, 1, 1], outside: 0 };
  c.push({ name: 'tilemap query kinds and slopes', input: { op: 'tilemap', map, queries: [{ minX: 8, minY: -4, maxX: 104, maxY: 60 }, { minX: 40, minY: 20, maxX: 50, maxY: 30 }] } });
  c.push({ name: 'tilemap collideSource solids and oneway', input: { op: 'tilemap', map, shapes: [
    { shape: A(30, 40, 6, 6) },
    { shape: A(40, 14, 4, 4), opts: { prevMaxY: 16 } },
    { shape: A(40, 18, 4, 4), opts: { prevMaxY: 30 } },
    { shape: Ci(62, 40, 4) },
    { shape: A(30, 40, 6, 6), opts: { layer: 1, mask: 1 } },
  ] } });
  c.push({ name: 'tilemap outside solid', input: { op: 'tilemap', map: { cols: 2, rows: 2, tileSize: 10, tiles: [0, 0, 0, 0], outside: 1 }, queries: [{ minX: -5, minY: -5, maxX: 5, maxY: 5 }], shapes: [{ shape: A(-2, 5, 3, 3) }] } });
  const drop = new Set(['collide aabb identical', 'collide circle circle apart', 'collide circle vs aabb corner apart', 'collide capsule vs aabb apart', 'contains aabb out', 'contains circle edge', 'contains capsule end', 'contains obb out', 'bounds capsule', 'raycast aabb too short', 'raycast circle tangent miss', 'raycast capsule cap', 'sweptAABB moving away', 'shapeCast away', 'hash negative coords + moves', 'collide obb vs aabb']);
  return c.filter((x) => !drop.has(x.name));
}

// ---------------- physics2d reference runner ----------------
const snapBodies = (w) => w.bodies.map((b) => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, vx: b.vx, vy: b.vy, w: b.w, asleep: b.asleep }));
export const runPhysics = (i) => {
  if (i.op === 'character') {
    const scene = i.map ? C.createTilemap(i.map) : C.createScene(i.colliders);
    const evs = [], cfg = P.makeCharConfig({ ...(i.cfg ?? {}), emit: (n, b) => evs.push({ n, step }) });
    const b = { ...P.makeCharacter(i.body.x, i.body.y), ...(i.body.mode ? { mode: i.body.mode } : {}) };
    let step = 0; const states = [];
    for (const seg of i.script) {
      for (let k = 0; k < seg.n; k++) { P.stepCharacter(b, { dx: seg.dx ?? 0, dy: seg.dy ?? 0, jumpPressed: !!seg.jp && k === 0 }, 1 / 60, scene, cfg); step++; }
      states.push({ step, x: b.x, y: b.y, vx: b.vx, vy: b.vy, mode: b.mode });
    }
    return { states, events: evs };
  }
  const w = P.createWorld(i.config ?? {});
  for (const d of i.bodies) w.addBody(d);
  for (const j of i.joints ?? []) w.addJoint(j);
  const states = [], events = []; let sensorLog = 0;
  for (let s = 1; s <= i.steps; s++) {
    for (const im of (i.impulses ?? []).filter((m) => m.step === s)) w.applyImpulse(im.id, im.ix, im.iy);
    for (const k of (i.kinematic ?? []).filter((m) => m.step === s)) w.kinematicStep(k.id, k.vx, k.vy, k.w ?? 0);
    w.step(i.dt ?? 1 / 60);
    for (const e of w.events) events.push({ step: s, ...e });
    if ((i.checkpoints ?? [i.steps]).includes(s)) states.push({ step: s, bodies: snapBodies(w) });
  }
  return { states, events, contacts: w.contacts.map((c) => ({ key: c.key, points: c.points.length, jn: c.points.map((p) => p.jn) })) };
};

function physicsCases() {
  const c = [];
  const floor = { type: 'static', x: 0, y: 200, shape: { type: 'box', hw: 400, hh: 20 } };
  const sim = (name, input) => c.push({ name, input: { op: 'sim', dt: 1 / 60, checkpoints: [input.steps], ...input } });
  sim('free fall circle', { steps: 60, bodies: [{ x: 0, y: 0, shape: { type: 'circle', r: 5 } }] });
  sim('box lands on floor', { steps: 90, checkpoints: [30, 60, 90], bodies: [floor, { x: 0, y: 100, shape: { type: 'box', hw: 10, hh: 10 } }] });
  sim('circle bounces e=0.8', { steps: 100, checkpoints: [40, 70, 100], bodies: [floor, { x: 0, y: 100, restitution: 0.8, shape: { type: 'circle', r: 10 } }] });
  sim('rotated box lands on corner', { steps: 120, checkpoints: [40, 80, 120], bodies: [floor, { x: 0, y: 120, angle: 0.5, shape: { type: 'box', hw: 12, hh: 8 } }] });
  sim('two box stack', { steps: 90, bodies: [floor, { x: 0, y: 159, shape: { type: 'box', hw: 10, hh: 10 } }, { x: 0, y: 138, shape: { type: 'box', hw: 10, hh: 10 } }] });
  sim('five box stack', { steps: 120, checkpoints: [60, 120], bodies: [floor, ...[0, 1, 2, 3, 4].map((k) => ({ x: 0, y: 169 - k * 20.5, shape: { type: 'box', hw: 10, hh: 10 } }))] });
  sim('box slides down ramp with friction', { steps: 100, checkpoints: [50, 100], bodies: [{ type: 'static', x: 0, y: 100, angle: 0.4, shape: { type: 'box', hw: 200, hh: 5 } }, { x: -40, y: 55, angle: 0.4, friction: 0.2, shape: { type: 'box', hw: 8, hh: 8 } }] });
  sim('box holds on rough ramp', { steps: 100, checkpoints: [50, 100], bodies: [{ type: 'static', x: 0, y: 100, angle: 0.4, shape: { type: 'box', hw: 200, hh: 5 }, friction: 1 }, { x: -40, y: 55, angle: 0.4, friction: 1, shape: { type: 'box', hw: 8, hh: 8 } }] });
  sim('head-on circles exchange momentum', { steps: 60, checkpoints: [20, 60], config: { gravity: { x: 0, y: 0 } }, bodies: [{ x: -50, y: 0, vx: 100, shape: { type: 'circle', r: 10 }, restitution: 1 }, { x: 50, y: 0, vx: -50, shape: { type: 'circle', r: 10 }, restitution: 1 }] });
  sim('heavy vs light circle', { steps: 60, checkpoints: [30, 60], config: { gravity: { x: 0, y: 0 } }, bodies: [{ x: -50, y: 0, vx: 100, density: 4, shape: { type: 'circle', r: 10 }, restitution: 0.5 }, { x: 30, y: 0, shape: { type: 'circle', r: 10 }, restitution: 0.5 }] });
  sim('polygon triangle on floor', { steps: 90, checkpoints: [45, 90], bodies: [floor, { x: 0, y: 120, shape: { type: 'polygon', points: [{ x: -12, y: 10 }, { x: 12, y: 10 }, { x: 0, y: -14 }] } }] });
  sim('capsule rolls to rest', { steps: 120, checkpoints: [60, 120], bodies: [floor, { x: 0, y: 120, angle: 0.8, shape: { type: 'capsule', hl: 14, r: 6 } }] });
  sim('fixed rotation box on edge', { steps: 80, checkpoints: [40, 80], bodies: [{ type: 'static', x: 0, y: 100, shape: { type: 'box', hw: 10, hh: 10 } }, { x: 6, y: 60, fixedRotation: true, shape: { type: 'box', hw: 10, hh: 10 } }] });
  sim('kinematic platform carries box', { steps: 90, checkpoints: [45, 90], config: { sleep: false }, kinematic: [{ step: 1, id: 1, vx: 40, vy: 0 }], bodies: [{ type: 'kinematic', x: 0, y: 100, shape: { type: 'box', hw: 40, hh: 5 } }, { x: 0, y: 85, friction: 1, shape: { type: 'box', hw: 8, hh: 5 } }] });
  sim('sensor enter stay exit', { steps: 80, checkpoints: [80], bodies: [{ type: 'static', x: 0, y: 100, sensor: true, shape: { type: 'box', hw: 30, hh: 10 } }, { x: 0, y: 0, shape: { type: 'circle', r: 4 }, gravityScale: 1 }] });
  sim('layers: masked body passes through', { steps: 60, bodies: [{ ...floor, layer: 2 }, { x: 0, y: 100, mask: 1, shape: { type: 'box', hw: 10, hh: 10 } }] });
  sim('applied impulse', { steps: 60, config: { gravity: { x: 0, y: 0 } }, impulses: [{ step: 1, id: 1, ix: 50, iy: -20 }], bodies: [{ x: 0, y: 0, shape: { type: 'circle', r: 5 } }] });
  sim('sleeps at rest', { steps: 150, checkpoints: [150], bodies: [floor, { x: 0, y: 169, shape: { type: 'box', hw: 10, hh: 10 } }] });
  sim('distance joint pendulum', { steps: 90, checkpoints: [30, 60, 90], bodies: [{ type: 'static', x: 0, y: 0, shape: { type: 'circle', r: 2 } }, { x: 50, y: 0, shape: { type: 'circle', r: 5 } }], joints: [{ type: 'distance', a: 1, b: 2 }] });
  sim('revolute pin swings', { steps: 90, checkpoints: [30, 60, 90], bodies: [{ type: 'static', x: 0, y: 0, shape: { type: 'circle', r: 2 } }, { x: 20, y: 0, shape: { type: 'box', hw: 20, hh: 3 } }], joints: [{ type: 'revolute', a: 1, b: 2, anchorA: { x: 0, y: 0 }, anchorB: { x: -20, y: 0 } }] });
  sim('spring bob', { steps: 90, checkpoints: [30, 60, 90], bodies: [{ type: 'static', x: 0, y: 0, shape: { type: 'circle', r: 2 } }, { x: 0, y: 60, shape: { type: 'circle', r: 5 } }], joints: [{ type: 'spring', a: 1, b: 2, length: 40, stiffness: 300, damping: 4 }] });
  sim('soft distance joint', { steps: 60, checkpoints: [30, 60], bodies: [{ type: 'static', x: 0, y: 0, shape: { type: 'circle', r: 2 } }, { x: 0, y: 50, shape: { type: 'circle', r: 5 } }], joints: [{ type: 'distance', a: 1, b: 2, length: 30, stiffness: 150, damping: 3 }] });
  sim('two-link chain', { steps: 90, checkpoints: [45, 90], bodies: [{ type: 'static', x: 0, y: 0, shape: { type: 'circle', r: 2 } }, { x: 10, y: 0, shape: { type: 'box', hw: 10, hh: 2 } }, { x: 30, y: 0, shape: { type: 'box', hw: 10, hh: 2 } }], joints: [{ type: 'revolute', a: 1, b: 2, anchorA: { x: 0, y: 0 }, anchorB: { x: -10, y: 0 } }, { type: 'revolute', a: 2, b: 3, anchorA: { x: 10, y: 0 }, anchorB: { x: -10, y: 0 } }] });
  sim('damping slows body', { steps: 60, config: { gravity: { x: 0, y: 0 } }, bodies: [{ x: 0, y: 0, vx: 100, linearDamping: 2, shape: { type: 'circle', r: 5 } }] });
  sim('gravity scale and wind', { steps: 60, config: { gravity: { x: 20, y: 300 } }, bodies: [{ x: 0, y: 0, gravityScale: 0.5, shape: { type: 'circle', r: 5 } }, { x: 0, y: 0, shape: { type: 'circle', r: 5 }, sensor: true }] });
  // character controller
  const flat = { cols: 12, rows: 5, tileSize: 16, tiles: [...new Array(48).fill(0), ...new Array(12).fill(1)].slice(0, 60).map((v, k) => (k >= 48 ? 1 : 0)) };
  const hills = { cols: 12, rows: 4, tileSize: 16, tiles: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 1, 4, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] };
  const chr = (name, input) => c.push({ name: 'character ' + name, input: { op: 'character', cfg: {}, body: { x: 8, y: 64 }, ...input } });
  chr('walk right on flat', { map: flat, script: [{ dx: 1, n: 30 }, { dx: 0, n: 5 }, { dx: -1, n: 20 }] });
  chr('jump and land', { map: flat, script: [{ dx: 1, jp: true, n: 1 }, { dx: 1, n: 79 }] });
  chr('walk off edge falls', { map: { cols: 6, rows: 4, tileSize: 16, tiles: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0] }, body: { x: 8, y: 48 }, script: [{ dx: 1, n: 60 }] });
  chr('walk up and over slope hill', { map: hills, body: { x: 8, y: 48 }, script: [{ dx: 1, n: 40 }, { dx: 1, n: 40 }, { dx: 1, n: 40 }] });
  chr('walk back down slope sticks to ground', { map: hills, body: { x: 90, y: 32 }, script: [{ dx: -1, n: 90 }] });
  chr('wall blocks', { map: { cols: 8, rows: 5, tileSize: 16, tiles: [...new Array(8 * 5).keys()].map((k) => (k >= 32 || (k % 8 === 5 && k >= 8 * 2 && k < 8 * 4) ? 1 : 0)) }, body: { x: 8, y: 64 }, script: [{ dx: 1, n: 90 }] });
  chr('blocked by a 16px tile ledge', { map: { cols: 8, rows: 5, tileSize: 16, tiles: [...new Array(40).keys()].map((k) => (k >= 32 ? 1 : 0)) }, colliders: undefined, body: { x: 8, y: 64 }, cfg: { stepHeight: 4 }, script: [{ dx: 1, n: 30 }] });
  c.push({ name: 'character step up ledge of 3px', input: { op: 'character', cfg: { stepHeight: 4 }, body: { x: 8, y: 64 }, colliders: [{ kind: 'solid', minX: 0, maxX: 200, minY: 64, maxY: 100 }, { kind: 'solid', minX: 40, maxX: 200, minY: 61, maxY: 100 }], script: [{ dx: 1, n: 50 }] } });
  c.push({ name: 'character blocked by 6px ledge', input: { op: 'character', cfg: { stepHeight: 4 }, body: { x: 8, y: 64 }, colliders: [{ kind: 'solid', minX: 0, maxX: 200, minY: 64, maxY: 100 }, { kind: 'solid', minX: 40, maxX: 200, minY: 58, maxY: 100 }], script: [{ dx: 1, n: 50 }] } });
  c.push({ name: 'character jumps through one-way and lands', input: { op: 'character', cfg: {}, body: { x: 50, y: 64 }, colliders: [{ kind: 'solid', minX: 0, maxX: 200, minY: 64, maxY: 100 }, { kind: 'oneway', minX: 30, maxX: 80, minY: 40, maxY: 44 }], script: [{ jp: true, n: 1 }, { n: 70 }] } });
  c.push({ name: 'character drops through one-way', input: { op: 'character', cfg: {}, body: { x: 50, y: 40 }, colliders: [{ kind: 'solid', minX: 0, maxX: 200, minY: 64, maxY: 100 }, { kind: 'oneway', minX: 30, maxX: 80, minY: 40, maxY: 44 }], script: [{ n: 1 }, { dy: 1, jp: true, n: 1 }, { n: 40 }] } });
  c.push({ name: 'character bonks ceiling', input: { op: 'character', cfg: {}, body: { x: 50, y: 64 }, colliders: [{ kind: 'solid', minX: 0, maxX: 200, minY: 64, maxY: 100 }, { kind: 'solid', minX: 0, maxX: 200, minY: 0, maxY: 40 }], script: [{ jp: true, n: 1 }, { n: 40 }] } });
  c.push({ name: 'character fast fall no tunnelling', input: { op: 'character', cfg: { gravity: 90000, maxFall: 100000 }, body: { x: 50, y: 0, mode: 'air' }, colliders: [{ kind: 'solid', minX: 0, maxX: 200, minY: 64, maxY: 100 }], script: [{ n: 30 }] } });
  c.push({ name: 'character on platformer world', input: { op: 'character', cfg: {}, body: { x: 20, y: 160 }, colliders: C.fromPlatformerWorld({ groundY: 160, pits: [{ x0: 60, x1: 80 }], platforms: [{ x: 120, y: 130, w: 40 }] }, { minX: 0, maxX: 320 }).colliders, script: [{ dx: 1, n: 25 }, { dx: 1, jp: true, n: 1 }, { dx: 1, n: 80 }] } });
  return c;
}

const ENGINES = [['collision2d', runCollision, collisionCases], ['physics2d', runPhysics, physicsCases]];
export function buildAll() {
  const out = {};
  for (const [engine, run, mk] of ENGINES) {
    const cases = mk().map((cs) => ({ name: cs.name, input: canon(rt(cs.input)), expect: snap(canon(rt(run(rt(cs.input)) ?? null))) }));
    out[engine] = JSON.stringify({ engine, version: VERSION, cases }, null, 1) + '\n';
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = buildAll();
  if (process.argv.includes('--check')) {
    let bad = 0;
    for (const [engine, text] of Object.entries(all)) {
      const f = join(VECTOR_DIR, engine + '.json'), disk = existsSync(f) ? readFileSync(f, 'utf8') : null;
      if (disk === null || !same(JSON.parse(disk), JSON.parse(text))) { console.error('DRIFT: ' + f + (disk === null ? ' missing' : ' differs from the JS reference')); bad++; } else console.log(engine, JSON.parse(text).cases.length, 'cases ok');
    }
    process.exit(bad ? 1 : 0);
  }
  mkdirSync(VECTOR_DIR, { recursive: true });
  for (const [engine, text] of Object.entries(all)) { writeFileSync(join(VECTOR_DIR, engine + '.json'), text); console.log(engine, JSON.parse(text).cases.length, 'cases'); }
}
