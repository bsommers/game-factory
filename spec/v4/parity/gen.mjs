#!/usr/bin/env node
// Generates / checks the parity scenario files: runs each scenario through the JS reference libs and stores the trajectory
// summary under `expected`. Usage: node spec/v4/parity/gen.mjs [--check]   (--check: fail if committed files are stale)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../../templates/web-project/src/lib/locomotion3d.js';
import * as C from '../../../templates/web-project/src/lib/camera3d.js';
import { buildWorld } from '../../../factory-core/locomotion3d/capabilities.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const r9 = (v) => Math.round(v * 1e9) / 1e9;
const rv = (a) => a.map(r9);
const EX = '../../examples';
const LOCO_TOL = { default: 1e-6, pos: 1e-6, speed: 1e-6, vy: 1e-6, yaw: 1e-6 };
const CAM_TOL = { default: 1e-6, pos: 1e-6, target: 1e-6, fov: 1e-6, distance: 1e-6, roll: 1e-6 };
const run = (m) => ({ frames: 60, move: m });

export const LOCO = [
  { name: 'hero-ground-ramp', config: `${EX}/locomotion3d/hero.json`, script: [{ frames: 24, move: [0, 0.4] }, { frames: 60, move: [0, 1] }, { frames: 60, move: [0, 1], sprint: true }, { frames: 60, move: [0, 0] }] },
  { name: 'hero-camera-relative-turn', config: `${EX}/locomotion3d/hero.json`, yaw: 0.3, script: [{ frames: 45, move: [1, 0], camYaw: 0.7 }, { frames: 45, move: [-0.7, 0.7], camYaw: 0.7 }, { frames: 45, move: [0, -1], camYaw: 2.5 }, { frames: 30, move: [0, 0], camYaw: 2.5 }] },
  { name: 'hero-jump-full-and-tap', config: `${EX}/locomotion3d/hero.json`, script: [{ frames: 1, jump: true, jumpHeld: true, move: [0, 1] }, { frames: 59, jumpHeld: true, move: [0, 1] }, { frames: 40, move: [0, 0] }, { frames: 1, jump: true, jumpHeld: false }, { frames: 70 }] },
  { name: 'hero-jump-buffer-coyote', config: `${EX}/locomotion3d/hero.json`, script: [{ frames: 40, move: [0, 1] }, { frames: 1, jump: true, jumpHeld: true, move: [0, 1] }, { frames: 15, jumpHeld: true, move: [0, 1] }, { frames: 1, jump: true, jumpHeld: true, move: [0, 1] }, { frames: 80, jumpHeld: false, move: [0, 1] }] },
  { name: 'hero-air-jump', config: { jump: { airJumps: 1 } }, script: [{ frames: 1, jump: true, jumpHeld: true }, { frames: 14, jumpHeld: true }, { frames: 1, jump: true, jumpHeld: true, move: [1, 0] }, { frames: 90, jumpHeld: true, move: [1, 0] }] },
  { name: 'hero-dodge-rest-and-run', config: `${EX}/locomotion3d/hero.json`, script: [{ frames: 1, dodge: true }, { frames: 59 }, { frames: 40, move: [0, 1] }, { frames: 1, dodge: true, move: [0, 1] }, { frames: 60, move: [0, 1] }, { frames: 1, dodge: true, move: [0, 1], camYaw: 1.2 }, { frames: 60 }] },
  { name: 'hero-knockback-launch', config: `${EX}/locomotion3d/hero.json`, script: [{ frames: 30, move: [0, 1] }, { frames: 1, impulse: [3, 6, -4], stun: 0.5, move: [0, 1] }, { frames: 120, move: [0, 1] }, { frames: 1, impulse: [-6, 0, 0], move: [0, 0] }, { frames: 40 }] },
  { name: 'hero-hard-landing', config: { jump: { speed: 22 }, land: { hardSpeed: 14 } }, script: [{ frames: 1, jump: true, jumpHeld: true }, { frames: 119, jumpHeld: true, move: [0, 1] }, { frames: 40, move: [0, 1] }] },
  { name: 'heavy-mixed', config: `${EX}/locomotion3d/heavy.json`, script: [{ frames: 70, move: [0, 1] }, { frames: 1, jump: true, jumpHeld: true, move: [0, 1] }, { frames: 80, jumpHeld: true, move: [0, 1] }, { frames: 1, dodge: true, move: [1, 0] }, { frames: 70 }] },
  { name: 'small-fast-mixed', config: `${EX}/locomotion3d/small-fast.json`, script: [{ frames: 60, move: [0, 1], sprint: true }, { frames: 1, jump: true, jumpHeld: true, move: [0, 1], sprint: true }, { frames: 60, jumpHeld: true, move: [0.5, 1], sprint: true }, { frames: 1, dodge: true }, { frames: 60 }] },
  { name: 'defaults-config', config: {}, script: [{ frames: 90, move: [0.3, 0.9] }, { frames: 1, jump: true, jumpHeld: true }, { frames: 100, jumpHeld: true }] },
  { name: 'world-ice', config: `${EX}/locomotion3d/hero.json`, world: { kind: 'ice' }, script: [{ frames: 30, move: [0, 1] }, { frames: 90, move: [0, 1] }, { frames: 120, move: [0, 0] }] },
  { name: 'world-conveyor', config: `${EX}/locomotion3d/hero.json`, world: { kind: 'conveyor', flow: [0, 0, -3] }, script: [{ frames: 90, move: [0, 1] }, { frames: 60, move: [0, 0] }] },
  { name: 'world-river-swim', config: `${EX}/locomotion3d/hero.json`, world: { kind: 'river', surfaceY: 2, flow: [3, 0, 0] }, script: [{ frames: 90, move: [0, 1] }, { frames: 120, move: [0, 1] }, { frames: 1, jump: true, jumpHeld: true, move: [0, 1] }, { frames: 60, jumpHeld: true }] },
  { name: 'world-platform-jump', config: `${EX}/locomotion3d/hero.json`, world: { kind: 'platform', velocity: [2, 0, 0] }, script: [{ frames: 30 }, { frames: 1, jump: true, jumpHeld: true }, { frames: 60, jumpHeld: true }] },
].map((s) => ({ kind: 'locomotion3d', description: `locomotion3d parity: ${s.name}`, world: 'flat', start: [0, 0, 0], yaw: 0, settle: 30, sampleEvery: 6, ...s }));

export const CAM = [
  { name: 'follow-walk-orbit', config: `${EX}/camera3d/default.json`, start: [0, 0, 0], script: [{ frames: 30 }, { frames: 90, velocity: [0, 0, -5] }, { frames: 60, velocity: [2, 0, 0], yawDelta: 0.02 }, { frames: 40, pitchDelta: -0.02 }, { frames: 40, pitchDelta: 0.04, yawDelta: -0.03 }] },
  { name: 'lock-on-and-aim', config: `${EX}/camera3d/action-boss.json`, start: [0, 0, 0], script: [{ frames: 20 }, { frames: 90, lock: [3, 1.2, -9], velocity: [0.5, 0, 0] }, { frames: 40, lock: [-4, 1, -7] }, { frames: 30 }, { frames: 40, aim: true }, { frames: 40 }] },
  { name: 'shake-and-fov-kick', config: `${EX}/camera3d/shooter-tight.json`, start: [1, 0, 2], script: [{ frames: 10 }, { frames: 80, trauma: 0.9, fovKick: 12, velocity: [0, 0, -1] }, { frames: 80 }] },
  { name: 'boom-wall-collision', config: `${EX}/camera3d/default.json`, start: [0, 0, 0], world: { kind: 'wallZ', z: 2.5 }, script: [{ frames: 30 }, { frames: 40, velocity: [0, 0, 3] }, { frames: 60, velocity: [0, 0, -3] }, { frames: 60 }] },
  { name: 'defaults-config', config: {}, start: [0, 0, 0], yaw: 0.4, script: [{ frames: 60, velocity: [1, 0, 0], yawDelta: 0.01 }, { frames: 30, aim: true }] },
].map((s) => ({ kind: 'camera3d', description: `camera3d parity: ${s.name}`, dt: 1 / 60, sampleEvery: 6, ...s }));

const loadCfg = (scn, dir) => (typeof scn.config === 'string' ? JSON.parse(readFileSync(resolve(dir, scn.config), 'utf8')) : scn.config);
const pick = (n, every, evSteps, total) => { const s = []; for (let i = 0; i < total; i++) if (i % every === 0 || i === total - 1 || evSteps.has(i)) s.push(i); return s; };

function expectLoco(scn, dir) {
  const wname = typeof scn.world === 'string' ? { kind: scn.world } : scn.world, { world, env } = buildWorld(wname);
  const l = L.createLocomotion(loadCfg(scn, dir), { pos: scn.start, yaw: scn.yaw });
  for (let i = 0; i < scn.settle; i++) L.stepLocomotion(l, {}, L.DT, world, env);
  l.t = 0;
  const all = [], events = [];
  let step = 0;
  for (const seg of scn.script) {
    const n = seg.frames ?? Math.round((seg.seconds ?? 1) / L.DT);
    if (seg.impulse) L.applyImpulse(l, seg.impulse, { stun: seg.stun });
    for (let k = 0; k < n; k++, step++) {
      const o = L.stepLocomotion(l, { move: seg.move || [0, 0], camYaw: seg.camYaw ?? 0, sprint: !!seg.sprint, jump: k === 0 && !!seg.jump, jumpHeld: !!seg.jumpHeld, dodge: k === 0 && !!seg.dodge }, L.DT, world, env);
      for (const e of o.events) events.push({ step, event: e });
      all.push({ step, state: o.locomotionState, pos: rv(o.pos), speed: r9(o.speed), vy: r9(o.verticalVelocity), yaw: r9(o.yaw), grounded: o.grounded, invulnerable: o.invulnerable });
    }
  }
  const keep = new Set(pick('', scn.sampleEvery, new Set(events.map((e) => e.step)), step));
  return { dt: L.DT, steps: step, samples: all.filter((s) => keep.has(s.step)), events };
}

function expectCam(scn, dir) {
  const cfg = C.createConfig(loadCfg(scn, dir)), dt = scn.dt;
  const world = scn.world?.kind === 'wallZ' ? C.boxToTris([-50, -1, scn.world.z], [50, 20, scn.world.z + 1]) : null;
  const st = C.createCamera(cfg, { target: scn.start, yaw: scn.yaw, pitch: scn.pitch });
  let t = [...scn.start], step = 0;
  const all = [];
  for (const seg of scn.script) {
    if (seg.target) t = [...seg.target];
    const v = seg.velocity || [0, 0, 0];
    for (let k = 0; k < (seg.frames ?? 1); k++, step++) {
      t = [t[0] + v[0] * dt, t[1] + v[1] * dt, t[2] + v[2] * dt];
      if (k === 0 && seg.trauma) C.addTrauma(st, seg.trauma);
      if (k === 0 && seg.fovKick) C.kickFov(st, seg.fovKick);
      C.stepCamera(st, cfg, { target: t, yawDelta: seg.yawDelta || 0, pitchDelta: seg.pitchDelta || 0, lock: seg.lock || null, aim: !!seg.aim }, world, dt);
      all.push({ step, pos: rv(st.out.pos), target: rv(st.out.target), fov: r9(st.out.fov), distance: r9(st.out.distance), roll: r9(st.out.roll), collided: st.collided });
    }
  }
  const keep = new Set(pick('', scn.sampleEvery, new Set(), step));
  return { dt, steps: step, samples: all.filter((s) => keep.has(s.step)), events: [] };
}

export function build() {
  const out = [];
  for (const [sub, list, tol, fn] of [['locomotion3d', LOCO, LOCO_TOL, expectLoco], ['camera3d', CAM, CAM_TOL, expectCam]]) {
    const dir = join(HERE, sub);
    for (const s of list) {
      const scn = { ...s, tolerance: tol };
      scn.expected = fn(scn, dir);
      out.push({ path: join(dir, `${s.name}.json`), dir, text: JSON.stringify(scn) + '\n', scn });
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const f of build()) {
    if (check) { let cur = ''; try { cur = readFileSync(f.path, 'utf8'); } catch { /* missing */ } if (cur !== f.text) { stale++; console.error('stale: ' + f.path); } }
    else { mkdirSync(f.dir, { recursive: true }); writeFileSync(f.path, f.text); console.log('wrote ' + f.path); }
  }
  if (stale) process.exit(1);
}
