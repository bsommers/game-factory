// Shared by test/godot-animgraph.test.mjs: runs a parity scenario (spec/v4/parity/animgraph/*.json) through the JS reference AnimGraph.
// Scenario: {name, graph, clips:{N:{duration, root?:{pos:[[t,x,y,z],...], yaw?:[[t,rad],...]}}}, frames, sampleEvery, script:[{f, set?, trigger?}]}
// The GDScript mirror lives in templates/godot-action3d/tests/animgraph/test_animgraph_parity.gd and uses the same tables and interpolation.
import { AnimGraph } from '../../templates/web-project/src/lib/anim-graph.js';

const lerpTab = (tab, t) => {
  if (t <= tab[0][0]) return tab[0].slice(1);
  for (let i = 1; i < tab.length; i++) if (t <= tab[i][0]) { const a = tab[i - 1], b = tab[i], k = (t - a[0]) / (b[0] - a[0] || 1); return a.slice(1).map((v, j) => v + (b[j + 1] - v) * k); }
  return tab[tab.length - 1].slice(1);
};
const qyaw = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
export function buildClips(spec) {
  const out = {};
  for (const [n, c] of Object.entries(spec)) {
    out[n] = { duration: c.duration };
    if (c.root) out[n].root = (t) => ({ p: lerpTab(c.root.pos, t), q: qyaw(c.root.yaw ? lerpTab(c.root.yaw, t)[0] : 0) });
  }
  return out;
}
const r9 = (v) => Math.round(v * 1e9) / 1e9;
export function runScenario(sc) {
  const rt = new AnimGraph(sc.graph, buildClips(sc.clips)), script = [...(sc.script || [])].sort((a, b) => a.f - b.f);
  const timeline = [], samples = [], total = { x: 0, y: 0, z: 0, yaw: 0 }; let si = 0;
  for (let f = 0; f < sc.frames; f++) {
    while (si < script.length && script[si].f <= f) { for (const [k, v] of Object.entries(script[si].set || {})) rt.setParam(k, v); for (const t of script[si].trigger || []) rt.setTrigger(t); si++; }
    if (f % sc.sampleEvery === 0) samples.push({ f, states: Object.fromEntries(rt.layers.map((L, k) => [L.def.name, rt.state(k)])), phase: Object.fromEntries(rt.layers.map((L, k) => [L.def.name, rt.phase(k)])), weight: Object.fromEntries(rt.layers.map((L, k) => [L.def.name, rt.weightOf(k)])), params: { ...rt.params } });
    const r = rt.step();
    for (const x of r.transitions) timeline.push({ f: f + 1, kind: 'transition', ...x });
    for (const e of r.events) timeline.push({ f: f + 1, kind: 'event', ...e });
    for (const k of Object.keys(total)) total[k] += r.rootMotion[k];
  }
  return JSON.parse(JSON.stringify({ timeline, samples, rootMotion: total, final: rt.snapshot() }));
}
export const approxEqual = (a, b, path = '', tol = 1e-9, errs = []) => {
  if (typeof a === 'number' && typeof b === 'number') { if (!(Math.abs(a - b) <= tol)) errs.push(`${path}: ${a} != ${b}`); }
  else if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) errs.push(`${path}: length ${a.length} != ${b.length}`); else a.forEach((v, i) => approxEqual(v, b[i], `${path}[${i}]`, tol, errs)); }
  else if (a && b && typeof a === 'object' && typeof b === 'object') { const ks = new Set([...Object.keys(a), ...Object.keys(b)]); for (const k of ks) approxEqual(a[k], b[k], `${path}.${k}`, tol, errs); }
  else if (a !== b) errs.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  return errs;
};
