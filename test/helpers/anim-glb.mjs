// Builds a tiny rigged + animated GLB in code (no binary fixtures): Armature > Hips > Arm, a 2-bone quad skinned to Hips (y=0) and Arm (y=2).
import { joinGLB } from '../../templates/web-project/src/lib/gltf-anim.js';

export function buildRigGLB({ clips = ['Wave', 'Slide'], nodeNames = ['Armature', 'Hips', 'Arm', 'Body'] } = {}) {
  const chunks = [], views = [], accs = [];
  let len = 0;
  const add = (arr, type, count, extra = {}, target) => {
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); chunks.push(b); const pad = (4 - (b.length % 4)) % 4; if (pad) chunks.push(new Uint8Array(pad));
    views.push({ buffer: 0, byteOffset: len, byteLength: b.length, ...(target ? { target } : {}) }); len += b.length + pad;
    const ct = arr instanceof Float32Array ? 5126 : arr instanceof Uint16Array ? 5123 : arr instanceof Uint8Array ? 5121 : 5125;
    accs.push({ bufferView: views.length - 1, componentType: ct, count, type, ...extra }); return accs.length - 1;
  };
  const pos = add(new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0, 1, 2, 0]), 'VEC3', 4, { min: [0, 0, 0], max: [1, 2, 0] }, 34962);
  const nor = add(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 'VEC3', 4, {}, 34962);
  const idx = add(new Uint16Array([0, 1, 2, 2, 1, 3]), 'SCALAR', 6, {}, 34963);
  const jnt = add(new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4', 4, {}, 34962);
  const wgt = add(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 'VEC4', 4, {}, 34962);
  const ibm = add(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]), 'MAT4', 2);
  const s2 = Math.SQRT1_2, animations = [];
  const sampler = (times, values, comps, interp = 'LINEAR') => ({ input: add(new Float32Array(times), 'SCALAR', times.length, { min: [Math.min(...times)], max: [Math.max(...times)] }), output: add(new Float32Array(values), comps === 4 ? 'VEC4' : 'VEC3', times.length), interpolation: interp });
  if (clips.includes('Wave')) animations.push({ name: 'Wave', samplers: [sampler([0, 1], [0, 0, 0, 1, 0, 0, s2, s2], 4)], channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }] });
  if (clips.includes('Slide')) animations.push({ name: 'Slide', samplers: [sampler([0, 2], [0, 0, 0, 2, 0, 0], 3)], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] });
  if (clips.includes('Idle')) animations.push({ name: 'Idle', samplers: [sampler([0, 1, 2], [0, 0, 0, 0, 0.1, 0, 0, 0, 0], 3, 'STEP')], channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }] });
  const json = {
    asset: { version: '2.0', generator: 'game-factory test' }, scene: 0, scenes: [{ nodes: [0, 3] }],
    nodes: [{ name: nodeNames[0], children: [1] }, { name: nodeNames[1], children: [2] }, { name: nodeNames[2], translation: [0, 1, 0] }, { name: nodeNames[3], mesh: 0, skin: 0 }],
    meshes: [{ name: 'Quad', primitives: [{ attributes: { POSITION: pos, NORMAL: nor, JOINTS_0: jnt, WEIGHTS_0: wgt }, indices: idx }] }],
    skins: [{ joints: [1, 2], inverseBindMatrices: ibm, skeleton: 0 }], animations, accessors: accs, bufferViews: views, buffers: [{ byteLength: len }],
  };
  const bin = new Uint8Array(len); let at = 0; for (const c of chunks) { bin.set(c, at); at += c.length; }
  return joinGLB(json, bin);
}
