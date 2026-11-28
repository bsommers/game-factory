// Tiny Wavefront OBJ loader: v, vn, f (v, v/vt, v//vn, v/vt/vn; negative indices; polygons fan-triangulated).
// Returns triangles [{v:[[x,y,z]x3], n:[[x,y,z]x3]|null}].
export function parseOBJ(text) {
  const V = [], N = [], tris = [];
  const idx = (s, len) => { const i = parseInt(s, 10); return i < 0 ? len + i : i - 1; };
  for (const raw of String(text).split('\n')) {
    const t = raw.trim().split(/\s+/);
    if (t[0] === 'v') V.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'vn') N.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'f' && t.length >= 4) {
      const c = t.slice(1).map((s) => { const [a, , d] = s.split('/'); return { v: V[idx(a, V.length)], n: d ? N[idx(d, N.length)] : null }; });
      if (c.some((x) => !x.v)) throw new Error('OBJ face references a missing vertex');
      for (let k = 1; k + 1 < c.length; k++) {
        const f = [c[0], c[k], c[k + 1]];
        tris.push({ v: f.map((x) => x.v), n: f.every((x) => x.n) ? f.map((x) => x.n) : null });
      }
    }
  }
  return tris;
}
