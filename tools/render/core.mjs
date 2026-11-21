// CPU path tracer core: scene compile (-> typed arrays, structured-clonable) and tile rendering.
// Determinism: every (pixel, sample) pair seeds its own integer RNG from (seed, pixel, sample), so output is
// independent of tile order and thread count. Math.* transcendental results are same-machine deterministic.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildBVH } from './bvh.mjs';
import { parseOBJ } from './obj.mjs';
import { parseHDR } from './hdr.mjs';

export const MAT = { lambert: 0, metal: 1, dielectric: 2, emissive: 3 };
const PI = Math.PI;
const v3 = (a, d = [0, 0, 0]) => (Array.isArray(a) && a.length >= 3 ? [+a[0], +a[1], +a[2]] : d);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function hash32(x) {
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16; return x >>> 0;
}
// mulberry32 stream seeded per (seed, pixel, sample)
export function seedState(seed, pixel, sample) {
  return hash32(hash32((seed | 0) + Math.imul(pixel, 0x9e3779b1)) ^ Math.imul(sample + 1, 0x85ebca6b));
}

export function compileScene(scene, { baseDir = '.', readFile = readFileSync } = {}) {
  const matNames = new Map(), mats = [];
  const addMat = (name, m) => { matNames.set(name, mats.length); mats.push(m); return mats.length - 1; };
  addMat('__default', { type: 'lambert', color: [0.7, 0.7, 0.7] });
  for (const [name, m] of Object.entries(scene.materials || {})) {
    if (!(m.type in MAT)) throw new Error(`material "${name}": unknown type "${m.type}" (lambert|metal|dielectric|emissive)`);
    addMat(name, m);
  }
  const matId = (m) => {
    if (m == null) return 0;
    if (typeof m === 'object') return addMat('__inline' + mats.length, m);
    if (!matNames.has(m)) throw new Error(`unknown material "${m}"`);
    return matNames.get(m);
  };
  const tris = [], spheres = [], planes = [];
  const addTri = (v, mat, n = null) => tris.push({ v, mat, n });
  const addQuad = (c, u, w, mat) => {
    const p1 = [c[0] + u[0], c[1] + u[1], c[2] + u[2]], p3 = [c[0] + w[0], c[1] + w[1], c[2] + w[2]], p2 = [p1[0] + w[0], p1[1] + w[1], p1[2] + w[2]];
    addTri([c, p1, p2], mat); addTri([c, p2, p3], mat);
  };
  const lightsPoint = [], lightsArea = [];
  for (const o of scene.objects || []) {
    const mat = matId(o.material);
    if (o.type === 'sphere') spheres.push({ c: v3(o.center), r: +o.radius, mat });
    else if (o.type === 'triangle') addTri(o.v.map((p) => v3(p)), mat);
    else if (o.type === 'quad') addQuad(v3(o.corner), v3(o.u), v3(o.v), mat);
    else if (o.type === 'plane') planes.push({ p: v3(o.point), n: norm(v3(o.normal, [0, 1, 0])), mat });
    else if (o.type === 'mesh') {
      const text = o.text ?? readFile(resolve(baseDir, o.obj), 'utf8');
      const s = o.scale ?? 1, t = v3(o.translate), ry = ((o.rotateY || 0) * PI) / 180, cy = Math.cos(ry), sy = Math.sin(ry);
      const xf = (p) => { const x = p[0] * s, y = p[1] * s, z = p[2] * s; return [x * cy + z * sy + t[0], y + t[1], -x * sy + z * cy + t[2]]; };
      const xn = (p) => norm([p[0] * cy + p[2] * sy, p[1], -p[0] * sy + p[2] * cy]);
      for (const tr of parseOBJ(text)) addTri(tr.v.map(xf), mat, o.smooth === false || !tr.n ? null : tr.n.map(xn));
    } else throw new Error(`unknown object type "${o.type}"`);
  }
  for (const l of scene.lights || []) {
    const I = l.intensity ?? 1, col = v3(l.color, [1, 1, 1]);
    if (l.type === 'point') lightsPoint.push([...v3(l.pos), col[0] * I, col[1] * I, col[2] * I]);
    else if (l.type === 'area') {
      const c = v3(l.corner), u = v3(l.u), w = v3(l.v), nn = cross(u, w), area = len(nn), n = norm(nn);
      const mid = addMat('__light' + mats.length, { type: 'emissive', color: col, intensity: I, light: true });
      if (l.visible !== false) addQuad(c, u, w, mid);
      lightsArea.push([...c, ...u, ...w, ...n, area, col[0] * I, col[1] * I, col[2] * I]);
    } else throw new Error(`unknown light type "${l.type}"`);
  }
  // primitives: tris first, then spheres
  const nP = tris.length + spheres.length;
  const kind = new Uint8Array(nP), pmat = new Uint16Array(nP), data = new Float64Array(nP * 9), nrm = new Float64Array(nP * 9), smooth = new Uint8Array(nP), bounds = new Float32Array(nP * 6);
  tris.forEach((t, i) => {
    const [a, b, c] = t.v, e1 = sub(b, a), e2 = sub(c, a);
    data.set([...a, ...e1, ...e2], i * 9); pmat[i] = t.mat;
    if (t.n) { nrm.set([...t.n[0], ...t.n[1], ...t.n[2]], i * 9); smooth[i] = 1; }
    for (let k = 0; k < 3; k++) { bounds[i * 6 + k] = Math.min(a[k], b[k], c[k]); bounds[i * 6 + 3 + k] = Math.max(a[k], b[k], c[k]); }
  });
  spheres.forEach((s, j) => {
    const i = tris.length + j; kind[i] = 1; pmat[i] = s.mat; data.set([...s.c, s.r], i * 9);
    for (let k = 0; k < 3; k++) { bounds[i * 6 + k] = s.c[k] - s.r; bounds[i * 6 + 3 + k] = s.c[k] + s.r; }
  });
  const bvh = buildBVH(bounds);
  const nM = mats.length, matType = new Uint8Array(nM), matColor = new Float64Array(nM * 3), matEmit = new Float64Array(nM * 3), matParam = new Float64Array(nM), matLight = new Uint8Array(nM), chk = new Float64Array(nM * 4);
  mats.forEach((m, i) => {
    matType[i] = MAT[m.type]; const col = v3(m.color, [0.8, 0.8, 0.8]); matColor.set(col, i * 3);
    const I = m.intensity ?? 1; matEmit.set(m.emission ? v3(m.emission) : col.map((x) => x * I), i * 3);
    matParam[i] = m.type === 'dielectric' ? (m.ior ?? 1.5) : (m.rough ?? 0); matLight[i] = m.light ? 1 : 0;
    if (m.checker) chk.set([...v3(m.checker.color, [0.1, 0.1, 0.1]), m.checker.scale ?? 1], i * 4);
  });
  // environment
  const e = scene.env || {};
  let env = { kind: 0, top: [0, 0, 0], bottom: [0, 0, 0], intensity: e.intensity ?? 1, rotate: ((e.rotate || 0) * PI) / 180 };
  if (e.hdr) { const h = parseHDR(readFile(resolve(baseDir, e.hdr))); env = { ...env, kind: 2, w: h.width, h: h.height, rgb: h.rgb }; }
  else if (e.top || e.bottom) env = { ...env, kind: 1, top: v3(e.top, [0.5, 0.7, 1]), bottom: v3(e.bottom, [1, 1, 1]) };
  else if (e.color) env = { ...env, kind: 1, top: v3(e.color), bottom: v3(e.color) };
  const cam = scene.camera || {};
  const from = v3(cam.from, [0, 1, 5]), at = v3(cam.at, [0, 0, 0]);
  const fwd = norm(sub(at, from)), right = norm(cross(v3(cam.up, [0, 1, 0]), fwd)), up = cross(fwd, right);
  return {
    nP, kind, pmat, data, nrm, smooth, order: bvh.order, nodeF: bvh.f32, nodeU: bvh.u32, nodeCount: bvh.nodeCount,
    planes: planes.map((p) => [...p.p, ...p.n, p.mat]).flat(), nPlanes: planes.length,
    matType, matColor, matEmit, matParam, matLight, chk, lightsPoint: lightsPoint.flat(), nPoint: lightsPoint.length, lightsArea: lightsArea.flat(), nArea: lightsArea.length,
    env, camera: { from, fwd, right, up, fov: cam.fov ?? 40, aperture: cam.aperture ?? 0, focus: cam.focus ?? len(sub(at, from)) },
    meta: { triangles: tris.length, spheres: spheres.length, planes: planes.length, materials: nM, bvhNodes: bvh.nodeCount },
  };
}

export function makeTracer(c, { width, height, seed = 1, maxDepth = 6, clamp = 50, mode = 'beauty', ao = { radius: 1, rays: 1 } } = {}) {
  const { kind, pmat, data, nrm, smooth, order, nodeF, nodeU, planes, nPlanes, matType, matColor, matEmit, matParam, matLight, chk, env } = c;
  const cam = c.camera, aspect = width / height, halfH = Math.tan((cam.fov * PI) / 360), halfW = halfH * aspect;
  const stack = new Int32Array(64);
  let rs = 1;
  const rnd = () => { rs = (rs + 0x6d2b79f5) | 0; let t = Math.imul(rs ^ (rs >>> 15), 1 | rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // hit record
  let hT = 0, hId = 0, hU = 0, hV = 0;
  const EPS = 1e-4;
  function intersect(ox, oy, oz, dx, dy, dz, tmax, any) {
    let best = tmax, found = false;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    if (c.nodeCount) {
      let sp = 0, node = 0;
      for (;;) {
        const o = node * 8;
        let t0 = (nodeF[o] - ox) * ix, t1 = (nodeF[o + 4] - ox) * ix, tn = Math.min(t0, t1), tf = Math.max(t0, t1);
        t0 = (nodeF[o + 1] - oy) * iy; t1 = (nodeF[o + 5] - oy) * iy; tn = Math.max(tn, Math.min(t0, t1)); tf = Math.min(tf, Math.max(t0, t1));
        t0 = (nodeF[o + 2] - oz) * iz; t1 = (nodeF[o + 6] - oz) * iz; tn = Math.max(tn, Math.min(t0, t1)); tf = Math.min(tf, Math.max(t0, t1));
        if (tn <= tf && tf >= EPS && tn < best) {
          const cnt = nodeU[o + 7];
          if (cnt === 0) { stack[sp++] = nodeU[o + 3]; node = node + 1; continue; }
          const first = nodeU[o + 3];
          for (let k = first; k < first + cnt; k++) {
            const p = order[k], d = p * 9;
            if (kind[p] === 0) {
              const e1x = data[d + 3], e1y = data[d + 4], e1z = data[d + 5], e2x = data[d + 6], e2y = data[d + 7], e2z = data[d + 8];
              const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
              const det = e1x * px + e1y * py + e1z * pz;
              if (det > -1e-12 && det < 1e-12) continue;
              const inv = 1 / det, tx = ox - data[d], ty = oy - data[d + 1], tz = oz - data[d + 2];
              const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
              const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
              const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
              const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
              if (t > EPS && t < best) { best = t; hId = p; hU = u; hV = v; found = true; if (any) { hT = t; return true; } }
            } else {
              const lx = ox - data[d], ly = oy - data[d + 1], lz = oz - data[d + 2], r = data[d + 3];
              const b = lx * dx + ly * dy + lz * dz, cc = lx * lx + ly * ly + lz * lz - r * r, disc = b * b - cc; // |d|=1
              if (disc < 0) continue;
              const sq = Math.sqrt(disc); let t = -b - sq; if (t <= EPS) t = -b + sq;
              if (t > EPS && t < best) { best = t; hId = p; found = true; if (any) { hT = t; return true; } }
            }
          }
        }
        if (sp === 0) break;
        node = stack[--sp];
      }
    }
    for (let i = 0; i < nPlanes; i++) {
      const q = i * 7, nx = planes[q + 3], ny = planes[q + 4], nz = planes[q + 5], den = nx * dx + ny * dy + nz * dz;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((planes[q] - ox) * nx + (planes[q + 1] - oy) * ny + (planes[q + 2] - oz) * nz) / den;
      if (t > EPS && t < best) { best = t; hId = -1 - i; found = true; if (any) { hT = t; return true; } }
    }
    hT = best; return found;
  }
  let nx = 0, ny = 0, nz = 0, mat = 0;
  function surface(px, py, pz) { // fills nx,ny,nz,mat for the current hit
    if (hId >= 0) {
      mat = pmat[hId]; const d = hId * 9;
      if (kind[hId] === 1) { const r = data[d + 3]; nx = (px - data[d]) / r; ny = (py - data[d + 1]) / r; nz = (pz - data[d + 2]) / r; }
      else if (smooth[hId]) {
        const w = 1 - hU - hV; nx = nrm[d] * w + nrm[d + 3] * hU + nrm[d + 6] * hV; ny = nrm[d + 1] * w + nrm[d + 4] * hU + nrm[d + 7] * hV; nz = nrm[d + 2] * w + nrm[d + 5] * hU + nrm[d + 8] * hV;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
      } else {
        const ax = data[d + 3], ay = data[d + 4], az = data[d + 5], bx = data[d + 6], by = data[d + 7], bz = data[d + 8];
        nx = ay * bz - az * by; ny = az * bx - ax * bz; nz = ax * by - ay * bx; const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nx /= l; ny /= l; nz /= l;
      }
    } else { const q = (-1 - hId) * 7; nx = planes[q + 3]; ny = planes[q + 4]; nz = planes[q + 5]; mat = planes[q + 6]; }
  }
  const bg = [0, 0, 0];
  function background(dx, dy, dz) {
    if (env.kind === 0) { bg[0] = bg[1] = bg[2] = 0; return bg; }
    if (env.kind === 1) { const t = 0.5 * (dy + 1); for (let k = 0; k < 3; k++) bg[k] = (env.bottom[k] * (1 - t) + env.top[k] * t) * env.intensity; return bg; }
    let u = (Math.atan2(dz, dx) + env.rotate) / (2 * PI) + 0.5; u -= Math.floor(u);
    const v = Math.acos(Math.max(-1, Math.min(1, dy))) / PI, fx = u * env.w - 0.5, fy = v * env.h - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    for (let k = 0; k < 3; k++) {
      const g = (x, y) => env.rgb[(Math.min(env.h - 1, Math.max(0, y)) * env.w + (((x % env.w) + env.w) % env.w)) * 3 + k];
      bg[k] = ((g(x0, y0) * (1 - ax) + g(x0 + 1, y0) * ax) * (1 - ay) + (g(x0, y0 + 1) * (1 - ax) + g(x0 + 1, y0 + 1) * ax) * ay) * env.intensity;
    }
    return bg;
  }
  function cosineDir(n0, n1, n2, out) {
    const ax = Math.abs(n0) > 0.9 ? 0 : 1, ay = ax ? 0 : 0;
    // tangent = normalize(cross(a, n)), a = x-axis or y-axis
    let tx, ty, tz;
    if (ax === 1) { tx = 0; ty = -n2; tz = n1; } else { tx = n2; ty = 0; tz = -n0; }
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz); tx /= tl; ty /= tl; tz /= tl;
    const bx = n1 * tz - n2 * ty, by = n2 * tx - n0 * tz, bz = n0 * ty - n1 * tx;
    const r1 = 2 * PI * rnd(), r2 = rnd(), s = Math.sqrt(r2), x = Math.cos(r1) * s, y = Math.sin(r1) * s, z = Math.sqrt(1 - r2);
    out[0] = tx * x + bx * y + n0 * z; out[1] = ty * x + by * y + n1 * z; out[2] = tz * x + bz * y + n2 * z; void ay;
  }
  const dirv = [0, 0, 0];
  function checkerAlbedo(m, px, py, pz, out) {
    const s = chk[m * 4 + 3];
    if (s && hId < 0) {
      const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
      const a = ax > ay && ax > az ? py : px, b = az > ay && az > ax ? py : pz;
      if (((Math.floor(a * s) + Math.floor(b * s)) & 1) === 1) { out[0] = chk[m * 4]; out[1] = chk[m * 4 + 1]; out[2] = chk[m * 4 + 2]; return; }
    }
    out[0] = matColor[m * 3]; out[1] = matColor[m * 3 + 1]; out[2] = matColor[m * 3 + 2];
  }
  const alb = [0, 0, 0], L = [0, 0, 0];
  function trace(ox, oy, oz, dx, dy, dz) {
    L[0] = L[1] = L[2] = 0; let t0 = 1, t1 = 1, t2 = 1, spec = true;
    for (let depth = 0; depth < maxDepth; depth++) {
      if (!intersect(ox, oy, oz, dx, dy, dz, Infinity, false)) { const b = background(dx, dy, dz); L[0] += t0 * b[0]; L[1] += t1 * b[1]; L[2] += t2 * b[2]; break; }
      const px = ox + dx * hT, py = oy + dy * hT, pz = oz + dz * hT;
      surface(px, py, pz); const m = mat, type = matType[m];
      if (type === 3) { if (spec || !matLight[m]) { L[0] += t0 * matEmit[m * 3]; L[1] += t1 * matEmit[m * 3 + 1]; L[2] += t2 * matEmit[m * 3 + 2]; } break; }
      const front = dx * nx + dy * ny + dz * nz < 0, sg = front ? 1 : -1, mx = nx * sg, my = ny * sg, mz = nz * sg;
      if (type === 0) {
        checkerAlbedo(m, px, py, pz, alb);
        const sx = px + mx * EPS, sy = py + my * EPS, sz = pz + mz * EPS;
        for (let i = 0; i < c.nPoint; i++) {
          const q = i * 6; let lx = c.lightsPoint[q] - sx, ly = c.lightsPoint[q + 1] - sy, lz = c.lightsPoint[q + 2] - sz;
          const d2 = lx * lx + ly * ly + lz * lz, dl = Math.sqrt(d2); lx /= dl; ly /= dl; lz /= dl;
          const cos = mx * lx + my * ly + mz * lz; if (cos <= 0) continue;
          if (intersect(sx, sy, sz, lx, ly, lz, dl * (1 - 1e-3), true)) continue;
          const f = cos / (PI * d2);
          L[0] += t0 * alb[0] * c.lightsPoint[q + 3] * f; L[1] += t1 * alb[1] * c.lightsPoint[q + 4] * f; L[2] += t2 * alb[2] * c.lightsPoint[q + 5] * f;
        }
        for (let i = 0; i < c.nArea; i++) {
          const q = i * 16, A = c.lightsArea, a = rnd(), b = rnd();
          const qx = A[q] + A[q + 3] * a + A[q + 6] * b, qy = A[q + 1] + A[q + 4] * a + A[q + 7] * b, qz = A[q + 2] + A[q + 5] * a + A[q + 8] * b;
          let lx = qx - sx, ly = qy - sy, lz = qz - sz; const d2 = lx * lx + ly * ly + lz * lz, dl = Math.sqrt(d2); lx /= dl; ly /= dl; lz /= dl;
          const cos = mx * lx + my * ly + mz * lz, cl = Math.abs(A[q + 9] * lx + A[q + 10] * ly + A[q + 11] * lz);
          if (cos <= 0 || cl <= 1e-6) continue;
          if (intersect(sx, sy, sz, lx, ly, lz, dl * (1 - 1e-3), true)) continue;
          const f = (cos * cl * A[q + 12]) / (PI * d2);
          L[0] += t0 * alb[0] * A[q + 13] * f; L[1] += t1 * alb[1] * A[q + 14] * f; L[2] += t2 * alb[2] * A[q + 15] * f;
        }
        cosineDir(mx, my, mz, dirv); dx = dirv[0]; dy = dirv[1]; dz = dirv[2];
        t0 *= alb[0]; t1 *= alb[1]; t2 *= alb[2]; spec = false; ox = sx; oy = sy; oz = sz;
      } else if (type === 1) {
        const dn = dx * mx + dy * my + dz * mz; dx -= 2 * dn * mx; dy -= 2 * dn * my; dz -= 2 * dn * mz;
        const r = matParam[m];
        if (r > 0) { let a, b, cz, l; do { a = 2 * rnd() - 1; b = 2 * rnd() - 1; cz = 2 * rnd() - 1; l = a * a + b * b + cz * cz; } while (l > 1 || l === 0); l = Math.sqrt(l); dx += (r * a) / l; dy += (r * b) / l; dz += (r * cz) / l; const dl = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= dl; dy /= dl; dz /= dl; }
        if (dx * mx + dy * my + dz * mz <= 0) break;
        t0 *= matColor[m * 3]; t1 *= matColor[m * 3 + 1]; t2 *= matColor[m * 3 + 2]; spec = true; ox = px + mx * EPS; oy = py + my * EPS; oz = pz + mz * EPS;
      } else {
        const ior = matParam[m], eta = front ? 1 / ior : ior, cosi = -(dx * mx + dy * my + dz * mz), s2 = eta * eta * (1 - cosi * cosi);
        const r0 = ((1 - ior) / (1 + ior)) ** 2, refl = s2 > 1 ? 1 : r0 + (1 - r0) * (1 - cosi) ** 5;
        if (rnd() < refl) { dx += 2 * cosi * mx; dy += 2 * cosi * my; dz += 2 * cosi * mz; ox = px + mx * EPS; oy = py + my * EPS; oz = pz + mz * EPS; }
        else { const k = eta * cosi - Math.sqrt(1 - s2); dx = eta * dx + k * mx; dy = eta * dy + k * my; dz = eta * dz + k * mz; ox = px - mx * EPS; oy = py - my * EPS; oz = pz - mz * EPS; }
        t0 *= matColor[m * 3]; t1 *= matColor[m * 3 + 1]; t2 *= matColor[m * 3 + 2]; spec = true;
      }
      if (depth >= 3) { const p = Math.min(0.95, Math.max(t0, t1, t2)); if (rnd() > p) break; t0 /= p; t1 /= p; t2 /= p; }
    }
    const lum = 0.2126 * L[0] + 0.7152 * L[1] + 0.0722 * L[2];
    if (lum > clamp) { const s = clamp / lum; L[0] *= s; L[1] *= s; L[2] *= s; }
    return L;
  }
  const px3 = [0, 0, 0];
  function aoSample(ox, oy, oz, dx, dy, dz) {
    px3[0] = px3[1] = px3[2] = 1;
    if (!intersect(ox, oy, oz, dx, dy, dz, Infinity, false)) return px3;
    const px = ox + dx * hT, py = oy + dy * hT, pz = oz + dz * hT; surface(px, py, pz);
    if (mode === 'normal') { px3[0] = nx * 0.5 + 0.5; px3[1] = ny * 0.5 + 0.5; px3[2] = nz * 0.5 + 0.5; return px3; }
    const sg = dx * nx + dy * ny + dz * nz < 0 ? 1 : -1, mx = nx * sg, my = ny * sg, mz = nz * sg;
    let vis = 0;
    for (let i = 0; i < ao.rays; i++) { cosineDir(mx, my, mz, dirv); if (!intersect(px + mx * EPS, py + my * EPS, pz + mz * EPS, dirv[0], dirv[1], dirv[2], ao.radius, true)) vis++; }
    px3[0] = px3[1] = px3[2] = vis / ao.rays; return px3;
  }
  // Renders samples [s0, s1) for tile [x0,x1)x[y0,y1); returns Float64Array of per-pixel sums (rgb).
  return function renderTile(x0, y0, x1, y1, s0, s1) {
    const tw = x1 - x0, out = new Float64Array(tw * (y1 - y0) * 3);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = ((y - y0) * tw + (x - x0)) * 3, pix = y * width + x;
      for (let s = s0; s < s1; s++) {
        rs = seedState(seed, pix, s);
        const sx = ((x + rnd()) / width) * 2 - 1, sy = 1 - ((y + rnd()) / height) * 2;
        let dx = cam.fwd[0] + sx * halfW * cam.right[0] + sy * halfH * cam.up[0], dy = cam.fwd[1] + sx * halfW * cam.right[1] + sy * halfH * cam.up[1], dz = cam.fwd[2] + sx * halfW * cam.right[2] + sy * halfH * cam.up[2];
        let l = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= l; dy /= l; dz /= l;
        let ox = cam.from[0], oy = cam.from[1], oz = cam.from[2];
        if (cam.aperture > 0) {
          const fx = ox + dx * cam.focus / (dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2]), fy = oy + dy * cam.focus / (dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2]), fz = oz + dz * cam.focus / (dx * cam.fwd[0] + dy * cam.fwd[1] + dz * cam.fwd[2]);
          const a = 2 * PI * rnd(), r = (cam.aperture / 2) * Math.sqrt(rnd()), lx = Math.cos(a) * r, ly = Math.sin(a) * r;
          ox += cam.right[0] * lx + cam.up[0] * ly; oy += cam.right[1] * lx + cam.up[1] * ly; oz += cam.right[2] * lx + cam.up[2] * ly;
          dx = fx - ox; dy = fy - oy; dz = fz - oz; l = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= l; dy /= l; dz /= l;
        }
        const r = mode === 'beauty' ? trace(ox, oy, oz, dx, dy, dz) : aoSample(ox, oy, oz, dx, dy, dz);
        out[o] += r[0]; out[o + 1] += r[1]; out[o + 2] += r[2];
      }
    }
    return out;
  };
}
