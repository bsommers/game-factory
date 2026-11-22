#!/usr/bin/env node
// Regenerates spec/v3/vectors/{collision3d,bvh}.json from the JS reference (templates/web-project/src/lib).
// Usage: node spec/v3/gen-vectors.mjs          write files
//        node spec/v3/gen-vectors.mjs --check  fail (exit 1) if files differ from a fresh generation
// Tolerance for consumers: compare numbers with abs error <= 1e-9 (values are rounded to 1e-12 here). Indices, counts,
// null/non-null and the bvh "fnv1a32" checksum of the serialized buffer must match EXACTLY.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as C from '../../templates/web-project/src/lib/collision3d.js';
import * as B from '../../templates/web-project/src/lib/bvh.js';

export const VERSION = 1, TOLERANCE = 1e-9;
const here = dirname(fileURLToPath(import.meta.url)), DIR = join(here, 'vectors');
import { same } from '../same.mjs';
const rnd = (v) => { if (Array.isArray(v)) return v.map(rnd); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, rnd(v[k])]));
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('non-finite'); if (Number.isInteger(v)) return Object.is(v, -0) ? 0 : v; const r = Math.round(v * 1e12) / 1e12; return Object.is(r, -0) ? 0 : r; } return v; };
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const fnv1a32 = (buf) => { const u = new Uint8Array(buf); let h = 0x811c9dc5; for (let i = 0; i < u.length; i++) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h; };
const hit = (h) => h ? { t: h.t, normal: h.normal, point: h.point } : null;
const con = (h) => h ? { normal: h.normal, depth: h.depth } : null;

function collisionCases() {
  const r = lcg(3), c = [], v = (s = 4) => [(r() - .5) * s, (r() - .5) * s, (r() - .5) * s], add = (op, args, expected) => c.push({ name: `${op} #${c.length}`, op, args, expected: rnd(expected) });
  const ops = {
    sphereSphere: (a) => con(C.sphereSphere({ c: a.a, r: a.ra }, { c: a.b, r: a.rb })),
    sphereAABB: (a) => con(C.sphereAABB({ c: a.c, r: a.r }, { min: a.min, max: a.max })),
    aabbAABB: (a) => con(C.aabbAABB({ min: a.amin, max: a.amax }, { min: a.bmin, max: a.bmax })),
    sphereTriangle: (a) => con(C.sphereTriangle({ c: a.c, r: a.r }, a.tri)),
    capsuleCapsule: (a) => con(C.capsuleCapsule({ a: a.a0, b: a.a1, r: a.ra }, { a: a.b0, b: a.b1, r: a.rb })),
    capsuleTriangle: (a) => con(C.capsuleTriangle({ a: a.p, b: a.q, r: a.r }, a.tri)),
    obbOBB: (a) => { const o = (c, h, q) => C.obbFromQuat(c, h, q); const x = C.obbOBB(o(a.ac, a.ah, a.aq), o(a.bc, a.bh, a.bq)); return x ? { depth: x.depth, normalAbs: x.normal.map(Math.abs) } : null; },
    raySphere: (a) => hit(C.raySphere(a.o, a.d, { c: a.c, r: a.r })),
    rayAABB: (a) => hit(C.rayAABB(a.o, a.d, { min: a.min, max: a.max })),
    rayTriangle: (a) => { const h = C.rayTriangle(a.o, a.d, a.tri); return h ? { t: h.t, u: h.u, v: h.v, front: h.front } : null; },
    rayCapsule: (a) => { const h = C.rayCapsule(a.o, a.d, { a: a.p, b: a.q, r: a.r }); return h ? { t: h.t, normal: h.normal } : null; },
    closestPointTriangle: (a) => ({ p: C.closestPointTriangle(a.p, ...a.tri) }),
    closestSegSeg: (a) => { const x = C.closestSegSeg(a.p1, a.q1, a.p2, a.q2); return { s: x.s, t: x.t, d2: x.d2 }; },
    sweepSphere: (a) => { const h = C.sweepSphere(a.c, a.r, a.d, a.tris); return h ? { t: h.t, normal: h.normal, index: h.index } : null; },
  };
  const quat = () => { const q = [r() - .5, r() - .5, r() - .5, r() - .5]; return q; };
  const tri = () => { const o = v(6); return [o, C.vec3.add(o, v(3)), C.vec3.add(o, v(3))]; };
  const push = (op, args) => add(op, args, ops[op](args));
  for (let i = 0; i < 3; i++) push('sphereSphere', { a: v(1.5), ra: 1, b: v(1.5), rb: 1.2 });
  push('sphereSphere', { a: [0, 0, 0], ra: 1, b: [3, 0, 0], rb: 1 });
  push('sphereSphere', { a: [1, 0, 0], ra: 1, b: [1, 0, 0], rb: 1 });
  for (let i = 0; i < 3; i++) push('sphereAABB', { c: v(3), r: 0.8, min: [-1, -1, -1], max: [1, 1, 1] });
  push('sphereAABB', { c: [0, 0, 0], r: 0.5, min: [-1, -1, -1], max: [1, 1, 1] });
  for (let i = 0; i < 3; i++) push('aabbAABB', { amin: v(2), amax: [1.5, 1.5, 1.5], bmin: [-1, -1, -1], bmax: [1, 1, 1] });
  for (let i = 0; i < 3; i++) push('sphereTriangle', { c: v(3), r: 1, tri: [[-2, 0, -2], [2, 0, -2], [0, 0, 2]] });
  for (let i = 0; i < 3; i++) push('capsuleCapsule', { a0: v(1.5), a1: v(1.5), ra: 0.5, b0: v(1.5), b1: v(1.5), rb: 0.6 });
  for (let i = 0; i < 3; i++) push('capsuleTriangle', { p: v(2), q: v(2), r: 0.5, tri: [[-3, 0, -3], [3, 0, -3], [0, 0, 3]] });
  for (let i = 0; i < 3; i++) push('obbOBB', { ac: [0, 0, 0], ah: [1, 0.5, 1], aq: quat(), bc: v(2.5), bh: [0.7, 0.7, 0.7], bq: quat() });
  for (let i = 0; i < 3; i++) push('raySphere', { o: [0, 0, -5], d: C.vec3.normalize(v(0.1).map((x, k) => x + [0, 0, 1][k])), c: v(0.5), r: 1 });
  for (let i = 0; i < 3; i++) push('rayAABB', { o: [(r() - .5) * 2, (r() - .5) * 2, -6], d: C.vec3.normalize(v(0.3).map((x, k) => x + [0, 0, 1][k])), min: [-1, -1, -1], max: [1, 2, 1] });
  push('rayAABB', { o: [0, 0, -5], d: [0, 0, 1], min: [-1, -1, -1], max: [1, 1, 1] });
  for (let i = 0; i < 4; i++) push('rayTriangle', { o: [(r() - .5) * 2, 3, (r() - .5) * 2], d: [0, -1, 0], tri: [[-2, 0, -2], [2, 0, -2], [0, 0, 2]] });
  push('rayTriangle', { o: [0, 3, -2], d: [0, -1, 0], tri: [[-2, 0, -2], [2, 0, -2], [0, 0, 2]] });
  push('rayTriangle', { o: [0, -3, 0], d: [0, 1, 0], tri: [[-2, 0, -2], [2, 0, -2], [0, 0, 2]] });
  for (let i = 0; i < 3; i++) push('rayCapsule', { o: [0, 0, -5], d: [(r() - .5) * .2, (r() - .5) * .2, 1], p: [-1, -1, 0], q: [1, 1, 0.5], r: 0.5 });
  for (let i = 0; i < 4; i++) push('closestPointTriangle', { p: v(6), tri: [[-1, 0, -1], [2, 0, -1], [0, 1, 2]] });
  for (let i = 0; i < 3; i++) push('closestSegSeg', { p1: v(), q1: v(), p2: v(), q2: v() });
  const floor = [-10, 0, -10, 10, 0, -10, 0, 0, 10, -10, 0, 10, 0, 0, -10, 0, 0, 10];
  for (let i = 0; i < 4; i++) push('sweepSphere', { c: [(r() - .5) * 4, 2, (r() - .5) * 4], r: 0.5, d: [(r() - .5), -3, (r() - .5)], tris: floor });
  return c;
}
function bvhCases() {
  const c = [];
  for (let i = 0; i < 24; i++) {
    const r = lcg(100 + i), n = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89][i % 10] + (i >= 10 ? i : 0), kind = i % 6 === 5 ? 'aabb' : 'tri', size = 1 + (i % 3);
    let prims = [];
    for (let k = 0; k < n; k++) {
      const p = [r() * 10, r() * 10, r() * 10];
      if (kind === 'tri') for (let q = 0; q < 3; q++) prims.push(p[0] + (r() - .2) * size, p[1] + (r() - .2) * size, p[2] + (r() - .2) * size);
      else prims.push(p[0], p[1], p[2], p[0] + r() * size, p[1] + r() * size, p[2] + r() * size);
    }
    prims = rnd(prims); // inputs are stored rounded, so expectations must be computed from the rounded values
    const build = kind === 'tri' ? B.buildTriangles : B.buildAABBs, bv = build(prims), buf = B.serialize(bv);
    const rays = [], res = [];
    for (let k = 0; k < 6; k++) {
      const o = [r() * 10, r() * 10, -2], d = [(r() - .5) * .6, (r() - .5) * .6, 1]; rays.push(rnd({ o, d }));
      const h = B.raycast(bv, rays[k].o, rays[k].d); res.push(h ? { t: h.t, index: h.index } : null);
    }
    const box = { min: [r() * 5, r() * 5, r() * 5], max: [5 + r() * 5, 5 + r() * 5, 5 + r() * 5] }, sp = { c: [r() * 10, r() * 10, r() * 10], r: 2 };
    box.min = rnd(box.min); box.max = rnd(box.max); sp.c = rnd(sp.c);
    c.push({ name: `${kind} n=${n} #${i}`, kind, prims, options: { maxLeafSize: 4 },
      expected: { nodeCount: bv.nodeCount, bytes: buf.byteLength, fnv1a32: fnv1a32(buf), rays, hits: res, queryAABB: { box, indices: B.queryAABB(bv, box) }, querySphere: { sphere: sp, indices: B.querySphere(bv, sp.c, sp.r) } } });
  }
  return c.map(rnd);
}

// ---- character controller (createCharacter + moveAndSlide) ----
const boxTris = (x0, y0, z0, x1, y1, z1) => { // 12 tris, outward CCW
  const v = (x, y, z) => [x, y, z], p = [v(x0, y0, z0), v(x1, y0, z0), v(x1, y1, z0), v(x0, y1, z0), v(x0, y0, z1), v(x1, y0, z1), v(x1, y1, z1), v(x0, y1, z1)];
  const q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]], out = [];
  for (const [a, b, c, d] of q) out.push(...p[a], ...p[b], ...p[c], ...p[a], ...p[c], ...p[d]);
  return out;
};
const FLOOR = [-50, 0, -50, -50, 0, 50, 50, 0, 50, -50, 0, -50, 50, 0, 50, 50, 0, -50];
const slopeWorld = (deg) => { const a = deg * Math.PI / 180, y1 = 10 * Math.tan(a);
  return [0, 0, -10, 10, y1, -10, 0, 0, 10, 10, y1, -10, 10, y1, 10, 0, 0, 10, -20, 0, -10, 0, 0, 10, 0, 0, -10, -20, 0, -10, -20, 0, 10, 0, 0, 10]; };
// script segments: {vel:[x,y,z] constant, n}, {fall:true,n} = vel.y accumulates gravity (-20) until grounded, {jump:vy,n} = initial vy then gravity.
// Segment kinds keep the runner deterministic and trivially portable: every port applies the same per-step velocity rule.
export function runCharacter(input) {
  const ch = C.createCharacter(input.cfg), dt = 1 / 60, trace = [];
  let vy = 0;
  for (const seg of input.script) {
    if (seg.jump !== undefined) vy = seg.jump;
    for (let k = 0; k < seg.n; k++) {
      let vel;
      if (seg.vel) vel = seg.vel;
      else { vy = ch.grounded && vy <= 0 ? 0 : vy - 20 * dt; vel = [seg.dx ?? 0, vy, seg.dz ?? 0]; }
      C.moveAndSlide(ch, vel, dt, input.world);
      if (!seg.vel && ch.grounded && vy <= 0) vy = 0;
      trace.push([ch.pos[0], ch.pos[1], ch.pos[2], ch.grounded ? 1 : 0]);
    }
  }
  return { trace, final: { pos: ch.pos, vel: ch.vel, grounded: ch.grounded, groundNormal: ch.groundNormal } };
}
function characterCases() {
  const mk = (name, cfg, world, script) => {
    const input = rnd({ cfg, world, script });
    return { name, ...input, expected: rnd(runCharacter(input)) };
  };
  const settle = { vel: [0, -5, 0], n: 60 };
  return [
    mk('lands on floor and stays', { pos: [0, 2, 0] }, FLOOR, [{ fall: true, n: 120 }]),
    mk('walks into wall and stops', { pos: [0, 0, 0] }, [...FLOOR, ...boxTris(5, 0, -5, 6, 3, 5)], [settle, { vel: [3, -1, 0], n: 300 }]),
    mk('slides along wall', { pos: [0, 0, 0] }, [...FLOOR, ...boxTris(5, 0, -5, 6, 3, 5)], [settle, { vel: [3, -1, 0], n: 300 }, { vel: [3, -1, 3], n: 60 }]),
    mk('steps up small ledge', { pos: [0, 0, 0] }, [...FLOOR, ...boxTris(2, 0, -5, 9, 0.25, 5)], [settle, { vel: [2, -1, 0], n: 120 }]),
    mk('blocked by tall ledge', { pos: [0, 0, 0] }, [...FLOOR, ...boxTris(2, 0, -5, 9, 0.8, 5)], [settle, { vel: [2, -1, 0], n: 120 }]),
    mk('jump arc', { pos: [0, 0, 0] }, FLOOR, [settle, { jump: 6, n: 40 }]),
    mk('hits ceiling', { pos: [0, 0, 0] }, [...FLOOR, ...boxTris(-5, 2, -5, 5, 3, 5)], [settle, { vel: [0, 8, 0], n: 30 }]),
    mk('30 degree slope climbs', { pos: [-1, 0, 0] }, slopeWorld(30), [settle, { vel: [2, -1, 0], n: 90 }]),
    mk('70 degree slope blocks', { pos: [-1, 0, 0] }, slopeWorld(70), [settle, { vel: [2, -1, 0], n: 90 }]),
    mk('small radius and tall step height config', { pos: [0, 0, 0], radius: 0.25, height: 1.2, stepHeight: 0.6 }, [...FLOOR, ...boxTris(2, 0, -5, 9, 0.5, 5)], [settle, { vel: [2, -1, 0], n: 120 }]),
    mk('no ground snap, no step', { pos: [0, 0, 0], stepHeight: 0, snapDistance: 0 }, [...FLOOR, ...boxTris(2, 0, -5, 9, 0.2, 5)], [settle, { vel: [2, -1, 0], n: 120 }]),
    mk('wander over mixed geometry', { pos: [0, 1, 0] }, [...FLOOR, ...boxTris(3, 0, -5, 4, 2, 5), ...boxTris(-3, 0, -5, -2, 0.2, 5)],
      Array.from({ length: 40 }, (_, i) => ({ vel: [Math.sin(i / 4) * 4, -4, Math.cos(i * 0.18) * 2], n: 10 }))),
  ];
}
export function buildAll() {
  return { collision3d: { version: VERSION, tolerance: TOLERANCE, cases: collisionCases() }, bvh: { version: VERSION, tolerance: TOLERANCE, layout: 'spec/v3/bvh.md', cases: bvhCases() }, character: { version: VERSION, tolerance: TOLERANCE, cases: characterCases() } };
}
const ser = (o) => JSON.stringify(o, null, 1) + '\n';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const all = buildAll(), check = process.argv.includes('--check'); let bad = 0;
  if (!check) mkdirSync(DIR, { recursive: true });
  for (const [name, data] of Object.entries(all)) {
    const f = join(DIR, name + '.json'), text = ser(data);
    if (check) { if (!existsSync(f) || !same(JSON.parse(readFileSync(f, 'utf8')), JSON.parse(text))) { console.error('DIFF ' + f); bad++; } else console.log('ok   ' + name + ' (' + data.cases.length + ' cases)'); }
    else { writeFileSync(f, text); console.log('wrote ' + f + ' (' + data.cases.length + ' cases)'); }
  }
  process.exit(bad ? 1 : 0);
}
