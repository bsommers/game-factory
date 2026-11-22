// Offline Meshy/animated-GLB helpers (pure, no filesystem): units, facing, clip names, scale baking, GLB compaction,
// clip slicing, humanoid bone roles + rig comparison, Godot BoneMap. Built on templates/web-project/src/lib/gltf-anim.js.
import * as A from '../../templates/web-project/src/lib/gltf-anim.js';

export const r4 = (v) => Math.round(v * 1e4) / 1e4;
const unsupported = (m) => Object.assign(new Error(m), { code: 'UNSUPPORTED' });
const bad = (m) => Object.assign(new Error(m), { code: 'BAD_INPUT' });
const pad4 = (n) => (4 - (n % 4)) % 4;

// ---------------- summary ----------------
export function summarize(model, bytes = 0) {
  const tris = model.meshes.reduce((s, m) => s + m.primitives.reduce((t, p) => t + p.indices.length / 3, 0), 0);
  const verts = model.meshes.reduce((s, m) => s + m.primitives.reduce((t, p) => t + p.positions.length / 3, 0), 0);
  const b = A.posedBounds(model, null, 0), sk = model.skins[0];
  return { bytes, triangles: tris, vertices: verts, joints: sk ? sk.joints.length : 0, bounds: b && { min: b.min.map(r4), max: b.max.map(r4), size: b.size.map(r4) }, height: b ? r4(b.size[1]) : 0,
    clips: model.animations.map((a) => ({ name: a.name, duration: r4(a.duration) })), states: A.guessStates(model.animations.map((a) => a.name)),
    rigSignature: sk ? sk.joints.map((j) => model.nodes[j].name).join('|') : null };
}
export function hashStr(s) { let h = 2166136261; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

// ---------------- units ----------------
/** Height-based unit guess. Meshy's default `meshyrig` GLBs are centimetres; most others are metres. */
export function detectUnits(model) {
  const b = A.posedBounds(model, null, 0), height = b ? b.size[1] : 0;
  if (!b || !(height > 0)) return { units: 'unknown', height: 0, factor: 1, confidence: 'none' };
  if (height >= 0.05 && height <= 30) return { units: 'm', height: r4(height), factor: 1, confidence: height >= 0.3 && height <= 3.5 ? 'high' : 'low' };
  if (height > 30 && height <= 1000) return { units: 'cm', height: r4(height), factor: 0.01, confidence: height >= 100 && height <= 250 ? 'high' : 'low' };
  return { units: 'unknown', height: r4(height), factor: 1, confidence: 'none' };
}

// ---------------- clip names ----------------
/** 'Armature|walking_man|baselayer' -> 'walking_man'. Strips an armature prefix and a 'baselayer' suffix, sanitises. */
export function cleanClipName(name, o = {}) {
  let parts = String(name).split('|');
  if (parts.length > 1 && (/^armature/i.test(parts[0]) || (o.armatureNames || []).includes(parts[0]))) parts.shift();
  if (parts.length > 1 && /^baselayer$/i.test(parts[parts.length - 1])) parts.pop();
  let s = parts.join('_').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (o.case === 'lower') s = s.toLowerCase();
  return s || String(name);
}
/** Final clip names for a list: clean -> rename map (original or cleaned key) -> prefix -> de-duplicate with _2. Returns [{from,to}]. */
export function planClipNames(names, o = {}) {
  const used = new Set(), out = [];
  for (const from of names) {
    const cleaned = o.clean === false ? from : cleanClipName(from, o);
    let to = (o.rename?.[from] ?? o.rename?.[cleaned] ?? cleaned); to = (o.prefix || '') + to;
    let n = to, k = 2; while (used.has(n)) n = `${to}_${k++}`; used.add(n); out.push({ from, to: n });
  }
  return out;
}

// ---------------- low level accessors ----------------
function floatElems(json, bin, idx, fn) {
  const a = json.accessors[idx];
  if (a.sparse) throw unsupported(`accessor ${idx}: sparse accessors cannot be rescaled`);
  if (a.componentType !== 5126) throw unsupported(`accessor ${idx}: only float accessors can be rescaled (quantized/normalized data)`);
  if (a.bufferView === undefined) return;
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type], bv = json.bufferViews[a.bufferView], base = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || n * 4;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < a.count; i++) fn(dv, base + i * stride, n);
}
/** Bake a uniform scale k into a GLB: vertex positions (and morph targets), node translations, inverse bind matrices, translation
 *  animation outputs. Never leaves a scale on a node. Refuses (UNSUPPORTED) when a node already carries a non-unit scale. */
export function bakeScale(json0, bin0, k) {
  const json = structuredClone(json0), bin = Uint8Array.from(bin0);
  for (const n of json.nodes || []) if (n.scale && n.scale.some((v) => Math.abs(v - 1) > 1e-6)) throw unsupported(`node "${n.name}" has a non-unit scale; apply it in Blender before export (not baked)`);
  for (const n of json.nodes || []) { if (n.translation) n.translation = n.translation.map((v) => v * k); if (n.matrix) { n.matrix[12] *= k; n.matrix[13] *= k; n.matrix[14] *= k; } }
  const done = new Set(), scaleAcc = (i, which) => {
    if (i === undefined || done.has(i)) return; done.add(i);
    floatElems(json, bin, i, (dv, off, n) => { const idx = which === 'ibm' ? [12, 13, 14] : [...Array(n).keys()]; for (const c of idx) dv.setFloat32(off + c * 4, dv.getFloat32(off + c * 4, true) * k, true); });
    const a = json.accessors[i]; if (which !== 'ibm') { if (a.min) a.min = a.min.map((v) => v * k); if (a.max) a.max = a.max.map((v) => v * k); }
  };
  for (const m of json.meshes || []) for (const p of m.primitives || []) { scaleAcc(p.attributes.POSITION); for (const t of p.targets || []) scaleAcc(t.POSITION); }
  for (const s of json.skins || []) scaleAcc(s.inverseBindMatrices, 'ibm');
  for (const an of json.animations || []) for (const c of an.channels) if (c.target.path === 'translation') scaleAcc(an.samplers[c.sampler].output);
  return { json, bin };
}

/** Drop unreferenced accessors/bufferViews and re-pack the single buffer. */
export function compactGLB(json0, bin) {
  const json = structuredClone(json0); if ((json.buffers || []).length > 1) throw unsupported('only single-buffer GLBs can be compacted');
  const acc = new Set(), mark = (i) => { if (i !== undefined) acc.add(i); };
  for (const m of json.meshes || []) for (const p of m.primitives || []) { Object.values(p.attributes).forEach(mark); mark(p.indices); for (const t of p.targets || []) Object.values(t).forEach(mark); }
  for (const s of json.skins || []) mark(s.inverseBindMatrices);
  for (const a of json.animations || []) for (const s of a.samplers) { mark(s.input); mark(s.output); }
  const accOrder = [...acc].sort((a, b) => a - b), accMap = new Map(accOrder.map((o, n) => [o, n]));
  const bvs = new Set(); const markBv = (i) => { if (i !== undefined) bvs.add(i); };
  for (const o of accOrder) { const a = json.accessors[o]; markBv(a.bufferView); if (a.sparse) { markBv(a.sparse.indices.bufferView); markBv(a.sparse.values.bufferView); } }
  for (const im of json.images || []) markBv(im.bufferView);
  const bvOrder = [...bvs].sort((a, b) => a - b), bvMap = new Map(bvOrder.map((o, n) => [o, n])), chunks = []; let len = 0;
  const newBvs = bvOrder.map((o) => { const v = json.bufferViews[o], at = v.byteOffset || 0; chunks.push(bin.subarray(at, at + v.byteLength)); const p = pad4(v.byteLength); if (p) chunks.push(new Uint8Array(p)); const nv = { ...v, byteOffset: len }; len += v.byteLength + p; return nv; });
  const newAccs = accOrder.map((o) => { const a = structuredClone(json.accessors[o]); if (a.bufferView !== undefined) a.bufferView = bvMap.get(a.bufferView); if (a.sparse) { a.sparse.indices.bufferView = bvMap.get(a.sparse.indices.bufferView); a.sparse.values.bufferView = bvMap.get(a.sparse.values.bufferView); } return a; });
  const remap = (o, key) => { if (o[key] !== undefined) o[key] = accMap.get(o[key]); };
  for (const m of json.meshes || []) for (const p of m.primitives || []) { for (const k of Object.keys(p.attributes)) remap(p.attributes, k); remap(p, 'indices'); for (const t of p.targets || []) for (const k of Object.keys(t)) remap(t, k); }
  for (const s of json.skins || []) remap(s, 'inverseBindMatrices');
  for (const a of json.animations || []) for (const s of a.samplers) { remap(s, 'input'); remap(s, 'output'); }
  for (const im of json.images || []) if (im.bufferView !== undefined) im.bufferView = bvMap.get(im.bufferView);
  json.accessors = newAccs; json.bufferViews = newBvs; json.buffers = [{ byteLength: len }];
  const out = new Uint8Array(len); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; }
  return { json, bin: out };
}

// ---------------- slicing ----------------
/** Sample a clip's channels over [start,end] into new keyframes (boundary keys interpolated, times shifted to 0). CUBICSPLINE becomes LINEAR. */
export function sliceChannels(clip, start, end) {
  const eps = 1e-6, out = [];
  for (const ch of clip.channels) {
    if (!ch.times.length) continue;
    const times = [start, ...Array.from(ch.times).filter((t) => t > start + eps && t < end - eps), end], n = ch.path === 'rotation' ? 4 : 3, vals = new Float32Array(times.length * n);
    times.forEach((t, i) => vals.set(A.sampleChannel(ch, t), i * n));
    out.push({ node: ch.node, path: ch.path, interp: ch.interp === 'CUBICSPLINE' ? 'LINEAR' : ch.interp, times: Float32Array.from(times.map((t) => t - start)), values: vals });
  }
  return out;
}
/** Append float accessors / animations to a GLB (single buffer). */
export class GlbAppender {
  constructor(json, bin) { this.json = structuredClone(json); this.chunks = [bin]; this.len = bin.length + pad4(bin.length); if (this.len > bin.length) this.chunks.push(new Uint8Array(this.len - bin.length)); this.json.bufferViews ||= []; this.json.accessors ||= []; this.json.animations ||= []; }
  add(arr, comps, type) {
    const bytes = new Uint8Array(arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength)); this.chunks.push(bytes);
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.len, byteLength: bytes.length }); this.len += bytes.length; const p = pad4(bytes.length); if (p) { this.chunks.push(new Uint8Array(p)); this.len += p; }
    const a = { bufferView: this.json.bufferViews.length - 1, componentType: 5126, count: arr.length / comps, type };
    if (type === 'SCALAR') { a.min = [Math.min(...arr)]; a.max = [Math.max(...arr)]; }
    this.json.accessors.push(a); return this.json.accessors.length - 1;
  }
  addAnimation(name, channels) {
    const samplers = [], outCh = [];
    for (const c of channels) { const n = c.path === 'rotation' ? 4 : 3; samplers.push({ input: this.add(c.times, 1, 'SCALAR'), output: this.add(c.values, n, n === 4 ? 'VEC4' : 'VEC3'), interpolation: c.interp }); outCh.push({ sampler: samplers.length - 1, target: { node: c.node, path: c.path } }); }
    this.json.animations.push({ name, samplers, channels: outCh });
  }
  finish() { this.json.buffers = [{ byteLength: this.len }]; const out = new Uint8Array(this.len); let at = 0; for (const c of this.chunks) { out.set(c, at); at += c.length; } return { json: this.json, bin: out }; }
}

// ---------------- humanoid roles ----------------
const FINGER = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Little', little: 'Little' };
const FSEG = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], other: ['Proximal', 'Intermediate', 'Distal'] };
const LIMB = [[/^(shoulder|clavicle|collar)$/, 'Shoulder'], [/^(upperarm|uparm|arm)$/, 'UpperArm'], [/^(forearm|lowerarm)$/, 'LowerArm'], [/^hand$/, 'Hand'], [/^(thigh|upleg|upperleg)$/, 'UpperLeg'], [/^(shin|calf|lowerleg|leg)$/, 'LowerLeg'], [/^foot$/, 'Foot'], [/^(toes?|toebase|ball)$/, 'Toes']];
export const GODOT_REQUIRED = ['Hips', 'Spine', 'Head', ...['Left', 'Right'].flatMap((s) => ['UpperArm', 'LowerArm', 'Hand', 'UpperLeg', 'LowerLeg', 'Foot'].map((b) => s + b))];
export const GODOT_HUMANOID_BONES = ['Root', 'Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'LeftEye', 'RightEye', 'Jaw',
  ...['Left', 'Right'].flatMap((s) => [`${s}Shoulder`, `${s}UpperArm`, `${s}LowerArm`, `${s}Hand`, ...['Thumb', 'Index', 'Middle', 'Ring', 'Little'].flatMap((f) => (f === 'Thumb' ? FSEG.Thumb : FSEG.other).map((g) => `${s}${f}${g}`)), `${s}UpperLeg`, `${s}LowerLeg`, `${s}Foot`, `${s}Toes`])];

/** Classify one bone name into a Godot humanoid role (or null). Handles Rigify (DEF-, .L/.R), Mixamo (mixamorig:Left...), UE/Unity (_l/_r), meshyrig. */
export function boneRole(name) {
  let n = name.replace(/^mixamorig[:_]?/i, '').replace(/^(DEF|ORG|MCH|CTRL)[-_]/, '');
  if (/(^|[._-])end$/i.test(n)) return null;
  let side = null, m;
  if ((m = n.match(/^(left|right)[._-]?(.+)$/i))) { side = m[1][0].toLowerCase() === 'l' ? 'Left' : 'Right'; n = m[2]; }
  else if ((m = n.match(/^(.+?)[._-](l|r)$/i)) || (m = n.match(/^(.+?)[._-](l|r)[._-]\d+$/i))) { side = m[2].toLowerCase() === 'l' ? 'Left' : 'Right'; n = m[1]; }
  else if ((m = n.match(/^(l|r)[._-](.+)$/i))) { side = m[1].toLowerCase() === 'l' ? 'Left' : 'Right'; n = m[2]; }
  const stem = n.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (side) {
    const f = stem.match(/^(?:hand|f)?(thumb|index|middle|ring|pinky|little)0*(\d)$/);
    if (f) { const g = FINGER[f[1]], seg = Number(f[2]); return seg >= 1 && seg <= 3 ? `${side}${g}${(g === 'Thumb' ? FSEG.Thumb : FSEG.other)[seg - 1]}` : null; }
    for (const [re, role] of LIMB) if (re.test(stem)) return side + role;
    return null;
  }
  if (/^(hips?|pelvis)$/.test(stem)) return 'Hips';
  if (stem === 'head') return 'Head';
  if (/^neck\d*$/.test(stem)) return 'Neck';
  if (stem === 'jaw') return 'Jaw';
  if (/^(lefteye|eyel)$/.test(stem)) return 'LeftEye'; if (/^(righteye|eyer)$/.test(stem)) return 'RightEye';
  return null;
}
const isChain = (name) => /^(spine|chest|upperchest)\d*$/.test(name.replace(/^mixamorig[:_]?/i, '').replace(/^(DEF|ORG|MCH|CTRL)[-_]/, '').toLowerCase().replace(/[^a-z0-9]/g, '')) && !/(^|[._-])end$/i.test(name);

/** Map skin-0 joints to Godot humanoid roles. Returns {map: Map<jointName, role>, byRole: {role: jointName}, extras: [names]}. */
export function humanoidRoles(model) {
  const sk = model.skins[0]; if (!sk) return { map: new Map(), byRole: {}, extras: [] };
  const inSkin = new Set(sk.joints), depth = (j) => { let d = 0, p = model.parent[j]; while (p >= 0) { d++; p = model.parent[p]; } return d; };
  const joints = sk.joints.map((j) => ({ j, name: model.nodes[j].name, d: depth(j) })).sort((a, b) => a.d - b.d || a.j - b.j), byRole = {}, map = new Map();
  const put = (role, name) => { if (role && !byRole[role]) { byRole[role] = name; map.set(name, role); } };
  for (const b of joints) put(boneRole(b.name), b.name);
  // spine chain: ordered by depth; the bone that parents the shoulders is the torso top, bones above it are neck/head.
  const chain = joints.filter((b) => isChain(b.name)).filter((b) => !map.has(b.name));
  if (chain.length) {
    const sh = joints.find((b) => /^(Left|Right)Shoulder$/.test(map.get(b.name) || '') || /^(Left|Right)UpperArm$/.test(map.get(b.name) || ''));
    let top = chain.length - 1;
    if (sh) { let p = model.parent[sh.j]; while (p >= 0 && !chain.some((c) => c.j === p)) p = model.parent[p]; if (p >= 0) top = chain.findIndex((c) => c.j === p); }
    const before = chain.slice(0, top + 1), above = chain.slice(top + 1);
    let rest = before;
    if (!byRole.Hips && before.length) { put('Hips', before[0].name); rest = before.slice(1); }
    if (rest.length === 1) put('Spine', rest[0].name);
    else if (rest.length >= 2) { put('Spine', rest[0].name); put('Chest', rest[rest.length >= 3 ? rest.length - 2 : 1].name); if (rest.length >= 3) put('UpperChest', rest[rest.length - 1].name); }
    if (!byRole.Head && !byRole.Neck && above.length >= 2) { put('Neck', above[0].name); put('Head', above[1].name); } else if (!byRole.Head && above.length >= 1) put('Head', above[above.length - 1].name);
    else if (!byRole.Neck && above.length >= 1 && byRole.Head && above[0].name !== byRole.Head) put('Neck', above[0].name);
  }
  return { map, byRole, extras: joints.map((b) => b.name).filter((n) => !map.has(n)) };
}
export const godotBoneMap = (roles) => ({ profile: 'SkeletonProfileHumanoid', bones: Object.fromEntries(GODOT_HUMANOID_BONES.filter((r) => roles.byRole[r]).map((r) => [r, roles.byRole[r]])), missingRequired: GODOT_REQUIRED.filter((r) => !roles.byRole[r]), unmappedBones: roles.extras });

// ---------------- facing ----------------
/** Which world axis the character faces, from foot->toe, falling back to a head-front helper joint. */
export function detectFacing(model, height) {
  const sk = model.skins[0]; if (!sk) return { axis: 'unknown', via: null };
  const roles = humanoidRoles(model), world = A.worldMatrices(model, A.poseAt(model, null, 0)), idx = new Map(sk.joints.map((j) => [model.nodes[j].name, j]));
  let vx = 0, vz = 0, via = 'foot-toe';
  for (const s of ['Left', 'Right']) { const f = idx.get(roles.byRole[`${s}Foot`]), t = idx.get(roles.byRole[`${s}Toes`]); if (f !== undefined && t !== undefined) { vx += world[t][12] - world[f][12]; vz += world[t][14] - world[f][14]; } }
  const minLen = 0.02 * (height || 1.7);
  if (Math.hypot(vx, vz) < minLen) {
    vx = vz = 0; via = 'head-front';
    const hf = sk.joints.find((j) => /(head_?front|face|nose)/i.test(model.nodes[j].name)), hd = idx.get(roles.byRole.Head);
    if (hf !== undefined && hd !== undefined) { vx = world[hf][12] - world[hd][12]; vz = world[hf][14] - world[hd][14]; }
  }
  if (Math.hypot(vx, vz) < minLen) return { axis: 'unknown', via: null };
  const axis = Math.abs(vz) >= Math.abs(vx) ? (vz > 0 ? '+Z' : '-Z') : (vx > 0 ? '+X' : '-X');
  return { axis, via, vector: [r4(vx), r4(vz)] };
}

// ---------------- rig comparison ----------------
function bindWorld(model) { const w = A.worldMatrices(model, A.poseAt(model, null, 0)), sk = model.skins[0]; return new Map(sk.joints.map((j) => [model.nodes[j].name, [w[j][12], w[j][13], w[j][14]]])); }
/** Compare two models' skeletons. Returns identical flag, mapping a->b (exact name, humanoid role, topology), leftovers and rest-pose delta. */
export function compareRigs(ma, mb) {
  const sa = ma.skins[0], sb = mb.skins[0]; if (!sa || !sb) throw bad('both inputs need a skin');
  const na = sa.joints.map((j) => ma.nodes[j].name), nb = sb.joints.map((j) => mb.nodes[j].name), sigA = na.join('|'), sigB = nb.join('|');
  const ra = humanoidRoles(ma), rb = humanoidRoles(mb), map = new Map(), usedB = new Set(), setB = new Set(nb);
  const link = (a, b, via) => { if (!map.has(a) && !usedB.has(b)) { map.set(a, { to: b, via }); usedB.add(b); } };
  for (const a of na) if (setB.has(a)) link(a, a, 'exact');
  for (const a of na) { const role = ra.map.get(a); if (role && rb.byRole[role]) link(a, rb.byRole[role], 'role'); }
  const parentName = (m, name) => { const i = m.nodes.findIndex((n) => n.name === name); const p = i >= 0 ? m.parent[i] : -1; return p >= 0 ? m.nodes[p].name : null; };
  const kids = (m, name) => { const i = m.nodes.findIndex((n) => n.name === name); return i < 0 ? [] : m.nodes[i].children.map((c) => m.nodes[c].name); };
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [a, { to }] of [...map]) {
      const ca = kids(ma, a).filter((c) => na.includes(c) && !map.has(c)), cb = kids(mb, to).filter((c) => nb.includes(c) && !usedB.has(c));
      if (ca.length === 1 && cb.length === 1) { link(ca[0], cb[0], 'topology'); changed = true; }
    }
    if (!changed) break;
  }
  const mapping = na.filter((a) => map.has(a)).map((a) => ({ from: a, to: map.get(a).to, via: map.get(a).via, role: ra.map.get(a) || null }));
  const wa = bindWorld(ma), wb = bindWorld(mb), ha = A.posedBounds(ma, null, 0)?.size[1] || 1, hb = A.posedBounds(mb, null, 0)?.size[1] || 1;
  const rootA = ra.byRole.Hips || na[0], rootB = map.get(rootA)?.to; let worst = { bone: null, delta: 0 };
  if (rootB) for (const { from, to } of mapping) { const pa = wa.get(from), pb = wb.get(to), oa = wa.get(rootA), ob = wb.get(rootB); const d = Math.hypot(...[0, 1, 2].map((k) => (pa[k] - oa[k]) / ha - (pb[k] - ob[k]) / hb)); if (d > worst.delta) worst = { bone: from, delta: r4(d) }; }
  return { identicalSignature: sigA === sigB, sameJointSet: na.length === nb.length && na.every((n) => setB.has(n)), jointsA: na.length, jointsB: nb.length, mapping,
    onlyInA: na.filter((a) => !map.has(a)), onlyInB: nb.filter((b) => !usedB.has(b)), restPoseMaxDelta: worst, rolesA: ra, rolesB: rb, byVia: mapping.reduce((o, m) => ({ ...o, [m.via]: (o[m.via] || 0) + 1 }), {}) };
}

// ---------------- verify ----------------
const HORIZ = (w, j) => [w[j][12], w[j][14]];
function rootJoint(model) { const sk = model.skins[0], set = new Set(sk.joints); return sk.joints.find((j) => !set.has(model.parent[j])) ?? sk.joints[0]; }
export function clipDrift(model, clip, height) {
  const root = rootJoint(model), N = 8, pts = []; for (let i = 0; i <= N; i++) { const w = A.worldMatrices(model, A.poseAt(model, clip, (clip.duration * i) / N, false)); pts.push({ h: HORIZ(w, root), y: w[root][13], all: w }); }
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return { drift: r4(d(pts[0].h, pts[N].h)), travel: r4(Math.max(...pts.map((p) => d(pts[0].h, p.h)))), vertical: r4(pts[N].y - pts[0].y), driftPerHeight: r4(d(pts[0].h, pts[N].h) / (height || 1)),
    explode: Math.max(...pts.map((p) => Math.max(...model.skins[0].joints.map((j) => Math.hypot(p.all[j][12] - p.all[root][12], p.all[j][13] - p.all[root][13], p.all[j][14] - p.all[root][14])))), 0) };
}
function pngSize(bytes) { if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) { const dv = new DataView(bytes.buffer, bytes.byteOffset); return [dv.getUint32(16), dv.getUint32(20)]; } return null; }

export function verifyModel(data, o = {}) {
  const checks = [], add = (id, status, detail, extra) => checks.push({ id, status, detail, ...(extra || {}) });
  const budget = { maxBytes: 20e6, maxTriangles: 100000, maxJoints: 100, ...(o.budget || {}) }, explicit = (k) => o.budget && o.budget[k] !== undefined, over = (k) => (explicit(k) ? 'fail' : 'warn');
  const { json } = A.splitGLB(data), ext = [...(json.extensionsUsed || []), ...(json.extensionsRequired || [])].filter((e) => /draco|meshopt/i.test(e));
  if (ext.length) { add('uncompressed', 'fail', `compressed geometry (${[...new Set(ext)].join(', ')}); re-export uncompressed (npx @gltf-transform/cli copy in.glb out.glb)`); return finish(checks, null); }
  let model; try { model = A.parseAnimGLB(data); } catch (e) { if (e.code === 'UNSUPPORTED') { add('uncompressed', 'fail', e.message); return finish(checks, null); } throw e; }
  add('uncompressed', 'pass', 'no Draco/meshopt');
  const sum = summarize(model, data.length), sk = model.skins[0], skinned = model.meshes.some((m) => m.primitives.some((p) => p.joints));
  if (!sk || !skinned) { add('skin', 'fail', sk ? 'skin present but no mesh uses JOINTS_0/WEIGHTS_0' : 'no skin; mesh is not rigged'); return finish(checks, sum, model); }
  add('skin', 'pass', `${model.skins.length} skin(s), ${sum.joints} joints`);
  add('joints', sum.joints > budget.maxJoints ? over('maxJoints') : 'pass', `${sum.joints} joints (limit ${budget.maxJoints})`);
  let badIdx = 0, badW = 0, nv = 0; for (const m of model.meshes) for (const p of m.primitives) if (p.joints) for (let v = 0; v < p.positions.length / 3; v++) { nv++; let s = 0; for (let k = 0; k < 4; k++) { const w = p.weights[v * 4 + k]; s += w; if (w > 0 && p.joints[v * 4 + k] >= sum.joints) badIdx++; } if (Math.abs(s - 1) > 0.01) badW++; }
  add('weights', badIdx ? 'fail' : badW ? 'warn' : 'pass', badIdx ? `${badIdx} influences point past the joint list` : badW ? `${badW} of ${nv} vertices have weights that do not sum to 1` : 'weights normalised, indices in range');
  const [lo, hi] = o.expect?.heightRange || [0.3, 3.5], u = detectUnits(model);
  add('height', sum.height >= lo && sum.height <= hi ? 'pass' : 'fail', `bind height ${sum.height} m (expected ${lo}-${hi})${u.units === 'cm' ? '; looks like centimetres: meshy.import {units:"auto"} bakes it to metres' : ''}`, { units: u.units });
  add('bounds', sum.bounds ? 'pass' : 'fail', sum.bounds ? `size ${sum.bounds.size.join(' x ')} m, min y ${sum.bounds.min[1]}` : 'no mesh bounds');
  if (sum.bounds && Math.abs(sum.bounds.min[1]) > 0.1 * sum.height) add('origin', 'warn', `feet are ${sum.bounds.min[1]} m from y=0 (expected origin at the feet)`);
  const fc = detectFacing(model, sum.height), wantFace = o.expect?.facing || '+Z';
  add('facing', fc.axis === 'unknown' ? 'info' : fc.axis === wantFace ? 'pass' : 'warn', fc.axis === 'unknown' ? 'could not determine facing (no foot/toe or head-front joints)' : `faces ${fc.axis} via ${fc.via}${fc.axis === wantFace ? '' : `; expected ${wantFace} (rotate in the engine or re-export)`}`, { axis: fc.axis });
  const names = sum.clips.map((c) => c.name);
  add('clips', names.length ? 'pass' : 'warn', names.length ? `${names.length}: ${sum.clips.map((c) => `${c.name} (${c.duration}s)`).join(', ')}` : 'no animation clips');
  for (const need of o.expect?.clips || []) if (!names.includes(need)) add('expect-clip', 'fail', `missing expected clip "${need}"`);
  if (!sum.states.idle) add('idle', 'warn', `no idle-like clip (guessed states: ${Object.keys(sum.states).join(', ') || 'none'}); add one or alias a state`);
  const oddNames = names.filter((n) => /[|\s]/.test(n)); if (oddNames.length) add('clip-names', 'warn', `clip names with '|' or spaces: ${oddNames.join(', ')} (meshy.import renames them)`);
  const drift = [], scaleInfo = []; let explode = false;
  for (const clip of model.animations) {
    const d = clipDrift(model, clip, sum.height), locomotion = /walk|run|sprint|jog|dash|roll|jump|leap/i.test(clip.name), sc = clip.channels.filter((c) => c.path === 'scale');
    const nonId = sc.some((c) => Array.from(c.values).some((v) => Math.abs(v - 1) > 1e-3));
    drift.push({ clip: clip.name, drift: d.drift, travel: d.travel, vertical: d.vertical, locomotion }); scaleInfo.push({ clip: clip.name, channels: sc.length, nonIdentity: nonId });
    if (d.explode > 3 * sum.height) explode = true;
  }
  const drifty = drift.filter((d) => !d.locomotion && d.travel > 0.1 * sum.height);
  add('root-drift', drifty.length ? 'warn' : 'pass', drifty.length ? `non-locomotion clips move the root: ${drifty.map((d) => `${d.clip} (${d.travel} m)`).join(', ')}` : `root travel per clip: ${drift.map((d) => `${d.clip} ${d.travel} m`).join(', ') || 'n/a'}`, { clips: drift });
  const nonId = scaleInfo.filter((s) => s.nonIdentity), withScale = scaleInfo.filter((s) => s.channels);
  add('scale-tracks', nonId.length ? 'warn' : withScale.length ? 'info' : 'pass', nonId.length ? `non-identity scale tracks in ${nonId.map((s) => s.clip).join(', ')} (engines may stretch bones)` : withScale.length ? `identity scale tracks in ${withScale.length} clip(s) (${withScale.reduce((a, s) => a + s.channels, 0)} channels); safe to strip for size` : 'no scale tracks', { clips: scaleInfo });
  add('pose-stable', explode ? 'fail' : 'pass', explode ? 'a clip throws joints more than 3x body height from the root (bad retarget or unit mismatch)' : 'joints stay within 3x height of the root in every clip');
  const rs = model.nodes[rootJoint(model)].s; if (rs.some((v) => Math.abs(v - 1) > 1e-4)) add('root-scale', 'warn', `skeleton root carries scale ${rs.map(r4).join(',')}; bake it`);
  add('size', data.length > budget.maxBytes || sum.triangles > budget.maxTriangles ? (data.length > budget.maxBytes ? over('maxBytes') : over('maxTriangles')) : 'pass', `${(data.length / 1e6).toFixed(1)} MB (limit ${(budget.maxBytes / 1e6).toFixed(0)}), ${sum.triangles} triangles (limit ${budget.maxTriangles})`, { bytes: data.length });
  const imgs = model.images.map((im) => ({ mime: im.mime, bytes: im.bytes?.length ?? 0, size: im.bytes ? pngSize(im.bytes) : null }));
  add('textures', imgs.length ? 'pass' : 'warn', imgs.length ? `${imgs.length} image(s): ${imgs.map((i) => `${i.size ? i.size.join('x') : i.mime} ${(i.bytes / 1e6).toFixed(1)}MB`).join(', ')}` : 'no textures (untextured mesh)');
  for (const w of model.warnings) add('parse-warning', 'warn', w);
  return finish(checks, sum, model);
}
function finish(checks, summary) {
  const counts = { pass: 0, warn: 0, fail: 0, info: 0 }; for (const c of checks) counts[c.status]++;
  return { pass: counts.fail === 0, counts, checks, summary };
}
