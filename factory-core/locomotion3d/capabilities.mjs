// locomotion3d.validate / simulate / report: tune and verify third-person movement configs headlessly.
// Library: templates/web-project/src/lib/locomotion3d.js. Config schema: spec/v4/schemas/locomotion3d.schema.json.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ok, fail } from '../registry.mjs';
import * as L from '../../templates/web-project/src/lib/locomotion3d.js';

const out = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, required, properties });
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const rv = (a) => a.map(r4);
const configProps = { config: { type: 'object', description: 'locomotion3d config object (partial ok; missing keys default)' }, file: { type: 'string', description: 'path to a config .json (relative to project)' }, project: { type: 'string' } };

function loadConfig(i) {
  if (i.config && i.file) return { err: fail('BAD_INPUT', 'pass config or file, not both') };
  let cfg = i.config;
  if (i.file) {
    const abs = resolve(i.project || '.', i.file);
    if (!existsSync(abs)) return { err: fail('NOT_FOUND', `file not found: ${abs}`) };
    try { cfg = JSON.parse(readFileSync(abs, 'utf8')); } catch (e) { return { err: fail('BAD_INPUT', `${i.file}: not valid JSON (${e.message})`) }; }
  }
  cfg ||= {};
  const errors = L.validateConfig(cfg);
  if (errors.length) return { err: fail('BAD_INPUT', 'invalid locomotion3d config', errors) };
  return { cfg: L.mergeConfig(cfg) };
}

// ---- test worlds (flat triangle soups, y up) ----
const quad = (x0, z0, x1, z1, y0a, y0b) => [x0, y0a, z0, x0, y0b, z1, x1, y0b, z1, x0, y0a, z0, x1, y0b, z1, x1, y0a, z0]; // heights at z0 (y0a) and z1 (y0b)
const box = (x0, y0, z0, x1, y1, z1) => {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], f = [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]], t = [];
  for (const [a, b, c, d] of f) t.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  return t;
};
export function buildWorld(w = { kind: 'flat' }) {
  const S = 200;
  const kind = typeof w === 'string' ? w : w.kind || 'flat', env = {};
  let tris = quad(-S, -S, S, S, 0, 0).concat([]);
  if (kind === 'flat') { /* floor only */ }
  else if (kind === 'wall') tris = tris.concat(box(-S, 0, -20, S, 5, -19));
  else if (kind === 'ramp') { // flat floor for z>0, slope of angleDeg rising towards -z from z=0 for 40m
    const a = (w.angleDeg ?? 30) * Math.PI / 180, run = 40, rise = Math.tan(a) * run;
    tris = quad(-S, 0, S, S, 0, 0).concat(quad(-S, -run, S, 0, rise, 0), quad(-S, -S, S, -run, rise, rise));
  } else if (kind === 'ice') env.surface = (p) => (p[2] < -5 ? { friction: w.friction ?? 0.08 } : null);
  else if (kind === 'conveyor') env.surface = (p) => (p[2] < -5 ? { flow: w.flow || [0, 0, -3] } : null);
  else if (kind === 'river') { // water over z<-5 (surface y = surfaceY, floor y = 0 => depth = surfaceY), current flows along flow
    const sy = w.surfaceY ?? 2, flow = w.flow || [3, 0, 0];
    env.water = (p) => (p[2] < -5 ? { surfaceY: sy, flow } : null);
  } else if (kind === 'platform') env.platform = (p) => (Math.abs(p[0]) < 2 && Math.abs(p[2]) < 2 ? (w.velocity || [2, 0, 0]) : null);
  return { world: tris, env };
}
const KINDS = ['flat', 'wall', 'ramp', 'ice', 'conveyor', 'river', 'platform'];
const worldSchema = { anyOf: [{ type: 'string', enum: KINDS }, { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: KINDS }, angleDeg: { type: 'number' }, friction: { type: 'number' }, flow: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, surfaceY: { type: 'number' }, velocity: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } } }] };
const segSchema = { type: 'object', additionalProperties: false, properties: { frames: { type: 'integer', minimum: 1, maximum: 36000 }, seconds: { type: 'number', minimum: 0.0167, maximum: 600 }, move: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, camYaw: { type: 'number' }, sprint: { type: 'boolean' }, jump: { type: 'boolean', description: 'press on the first frame of the segment' }, jumpHeld: { type: 'boolean', description: 'hold the jump button for the whole segment' }, dodge: { type: 'boolean', description: 'press on the first frame' }, impulse: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'knockback applied before the first frame' }, stun: { type: 'number' } } };

function run(cfg, input, { world = 'flat', start = [0, 0, 0], yaw = 0, sampleEvery = 6, settle = 30 }) {
  const { world: tris, env } = buildWorld(world), l = L.createLocomotion(cfg, { pos: start, yaw });
  // settle onto the ground before the script
  for (let i = 0; i < settle; i++) L.stepLocomotion(l, {}, L.DT, tris, env);
  l.t = 0;
  const timeline = [], states = {}, events = [];
  let step = 0, maxSpeed = 0, apex = l.ch.pos[1];
  const baseY = l.ch.pos[1];
  for (const seg of input) {
    const n = seg.frames ?? Math.round((seg.seconds ?? 1) / L.DT);
    if (seg.impulse) L.applyImpulse(l, seg.impulse, { stun: seg.stun });
    for (let k = 0; k < n; k++, step++) {
      const o = L.stepLocomotion(l, { move: seg.move || [0, 0], camYaw: seg.camYaw ?? 0, sprint: !!seg.sprint, jump: k === 0 && !!seg.jump, jumpHeld: !!seg.jumpHeld, dodge: k === 0 && !!seg.dodge }, L.DT, tris, env);
      states[o.locomotionState] = (states[o.locomotionState] || 0) + 1; maxSpeed = Math.max(maxSpeed, o.speed); apex = Math.max(apex, o.pos[1]);
      for (const e of o.events) events.push({ step, event: e });
      if (step % sampleEvery === 0 || o.events.length) timeline.push({ step, t: r4(l.t), state: o.locomotionState, pos: rv(o.pos), speed: r4(o.speed), grounded: o.grounded, vy: r4(o.verticalVelocity), invulnerable: o.invulnerable, events: o.events });
    }
  }
  const final = { pos: rv(l.ch.pos), hv: rv(l.hv), vy: r4(l.vy), yaw: r4(l.yaw), state: l.state };
  return { timeline, final, steps: step, states, maxSpeed: r4(maxSpeed), apexHeight: r4(apex - baseY), events, l };
}

function tuningReport(cfg) {
  const flat = (script, o = {}) => run(cfg, script, { sampleEvery: 1, ...o });
  const hold = L.jumpProfile(cfg, { hold: true }), tap = L.jumpProfile(cfg, { hold: false });
  const cap = (jr) => ({ apexHeight: r4(jr.apexHeight), timeToApexS: r4(jr.timeToApex), airTimeS: r4(jr.airTime) });
  // measured jump (full + tap) through the real controller
  const mj = (held) => { const r = flat([{ frames: 1, jump: true, jumpHeld: held }, { frames: 119, jumpHeld: held }]); return r.apexHeight; };
  // dodge from rest and while running
  const dod = (move) => { const r = flat([{ frames: 60, move }, { frames: 1, move, dodge: true }, { seconds: cfg.dodge.duration + 0.3, move: [0, 0] }]); return r; };
  const dist = (run0) => { const tl = run0.timeline; const di = tl.findIndex((e) => e.state === 'dodge'); const p0 = tl[di - 1].pos; let end = di; while (end + 1 < tl.length && tl[end + 1].state === 'dodge') end++; const p1 = tl[end].pos; return { frames: end - di + 1, distance: r4(Math.hypot(p1[0] - p0[0], p1[2] - p0[2])) }; };
  const dRest = dod([0, 0]), dRun = dod([0, 1]);
  const dr = dist(dRest), dn = dist(dRun);
  // run accel/decel times
  const acc = flat([{ seconds: 3, move: [0, 1] }]), toRun = acc.timeline.find((e) => e.speed >= cfg.ground.runSpeed - 1e-6);
  const spr = flat([{ seconds: 4, move: [0, 1], sprint: true }]), toSprint = spr.timeline.find((e) => e.speed >= cfg.ground.sprintSpeed - 1e-6);
  const stop = flat([{ seconds: 3, move: [0, 1] }, { seconds: 2, move: [0, 0] }]), t0 = Math.round(3 / L.DT), stopped = stop.timeline.find((e) => e.step >= t0 && e.speed < 0.01);
  const fallH = (cfg.air.maxFallSpeed ** 2) / (2 * cfg.air.gravity * cfg.air.fallGravityMul);
  const D = cfg.dodge, warnings = [];
  if (D.iframeEnd - D.iframeStart < 0.1) warnings.push('i-frame window under 0.1s is hard to use at 60Hz');
  if (D.cooldown + D.duration < D.iframeEnd - D.iframeStart + 0.1) warnings.push('dodge can be chained with near-continuous invulnerability');
  if (hold.apexHeight < cfg.body.stepHeight * 2) warnings.push('full jump apex is under twice stepHeight');
  return {
    jump: { analytic: { full: cap(hold), tap: cap(tap) }, measured: { fullApex: r4(mj(true)), tapApex: r4(mj(false)) }, coyoteTimeS: cfg.jump.coyoteTime, bufferTimeS: cfg.jump.bufferTime, airJumps: cfg.jump.airJumps },
    dodge: { configuredDistance: D.distance, measuredFromRest: dr.distance, measuredWhileRunning: dn.distance, durationFrames: dr.frames, durationS: r4(dr.frames * L.DT), iframes: { startS: D.iframeStart, endS: D.iframeEnd, windowFrames: Math.round((D.iframeEnd - D.iframeStart) / L.DT) }, cooldownS: D.cooldown, minTimeBetweenDodgesS: r4(D.duration + D.cooldown) },
    run: { timeToRunS: toRun ? r4(toRun.t) : null, timeToSprintS: toSprint ? r4(toSprint.t) : null, stopTimeS: stopped ? r4((stopped.step - t0) * L.DT) : null, walkSpeed: cfg.ground.walkSpeed, runSpeed: cfg.ground.runSpeed, sprintSpeed: cfg.ground.sprintSpeed },
    fall: { terminalSpeed: cfg.air.maxFallSpeed, heightToTerminalM: r4(fallH), hardLandSpeed: cfg.land.hardSpeed, hardLandFromHeightM: r4(cfg.land.hardSpeed ** 2 / (2 * cfg.air.gravity * cfg.air.fallGravityMul)) },
    warnings,
  };
}

export function registerLocomotion3d(r) {
  r.register({ name: 'locomotion3d.validate', summary: 'Validate a locomotion3d movement config (schema ranges plus cross-field rules such as walk<=run<=sprint, i-frames inside the dodge duration). Returns the fully merged config.',
    inputSchema: obj(configProps), outputSchema: out,
    handler: (i) => { const { cfg, err } = loadConfig(i); if (err) return err; return ok({ valid: true, config: cfg }, ['locomotion3d.report {file:...} for jump apex / dodge distance numbers', 'locomotion3d.simulate {config, script:[...]} to see a trajectory']); } });

  r.register({ name: 'locomotion3d.simulate', summary: 'Run scripted input through the locomotion controller on a built-in test world (flat, wall, ramp, ice, conveyor, river, platform) and return the state timeline, per-state frame counts, events and a determinism hash.',
    inputSchema: obj({ ...configProps, world: worldSchema, script: { type: 'array', minItems: 1, maxItems: 200, items: segSchema, description: 'segments of input; each runs for frames or seconds (default 1s)' }, start: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }, yaw: { type: 'number' }, sampleEvery: { type: 'integer', minimum: 1, maximum: 600 } }, ['script']), outputSchema: out,
    handler: (i) => {
      const { cfg, err } = loadConfig(i); if (err) return err;
      const t = i.script.reduce((s, g) => s + (g.frames ?? Math.round((g.seconds ?? 1) / L.DT)), 0);
      if (t > 72000) return fail('BAD_INPUT', `script is ${t} frames; max 72000`);
      const r = run(cfg, i.script, { world: i.world || 'flat', start: i.start || [0, 0, 0], yaw: i.yaw || 0, sampleEvery: i.sampleEvery || 6 });
      const { l, ...rest } = r;
      return ok({ ...rest, hash: L.hashState({ final: rest.final, states: rest.states, timeline: rest.timeline }), dt: L.DT }, ['locomotion3d.report for tuning numbers']);
    } });

  r.register({ name: 'locomotion3d.report', summary: 'Tuning report for a config: jump apex (analytic and measured, held vs tap), dodge distance and i-frame window (from rest and while running), run/sprint ramp-up and stop times, terminal fall and hard-landing heights, plus warnings.',
    inputSchema: obj(configProps), outputSchema: out,
    handler: (i) => { const { cfg, err } = loadConfig(i); if (err) return err; const rep = tuningReport(cfg); return ok({ name: cfg.name, ...rep }, rep.warnings.length ? ['address the warnings, then re-run locomotion3d.report'] : ['config looks sane; wire it with stepLocomotion in src/lib/locomotion3d.js']); } });
}
