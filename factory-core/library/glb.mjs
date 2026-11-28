// Minimal GLB reader for library.add stats: tris, verts, materials, clips, rig (joint count + skeletonHash). Untrusted input:
// bounds-checked, JSON chunk only, never loads the binary chunk. Returns null when the buffer is not a parseable GLB.
import { createHash } from 'node:crypto';

export function glbStats(buf) {
  try {
    if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return null;
    const len = buf.readUInt32LE(8);
    if (len > buf.length) return null;
    const clen = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== 0x4e4f534a || 20 + clen > buf.length || clen > 32 << 20) return null;
    const j = JSON.parse(buf.subarray(20, 20 + clen).toString('utf8'));
    const acc = j.accessors || [];
    let tris = 0, verts = 0;
    for (const m of j.meshes || []) for (const p of m.primitives || []) {
      const mode = p.mode ?? 4, ia = p.indices != null ? acc[p.indices] : null, pa = p.attributes?.POSITION != null ? acc[p.attributes.POSITION] : null;
      const n = ia ? ia.count : pa ? pa.count : 0;
      if (pa) verts += pa.count;
      tris += mode === 4 ? Math.floor(n / 3) : (mode === 5 || mode === 6) ? Math.max(0, n - 2) : 0;
    }
    const clips = (j.animations || []).map((a, i) => {
      let duration = 0;
      for (const s of a.samplers || []) { const mx = acc[s.input]?.max?.[0]; if (typeof mx === 'number') duration = Math.max(duration, mx); }
      return { name: a.name || `clip${i}`, duration: Math.round(duration * 1000) / 1000 };
    });
    const out = { tris, verts, materials: (j.materials || []).length, clips, extensionsRequired: j.extensionsRequired || [] };
    const skin = (j.skins || [])[0];
    if (skin?.joints?.length) {
      const names = skin.joints.map((n) => j.nodes?.[n]?.name ?? `#${n}`);
      out.rig = { type: 'custom', bones: names.length, skinned: true, skeletonHash: createHash('sha256').update(names.join('\n')).digest('hex') };
    } else out.rig = { type: 'none', bones: 0, skinned: false };
    return out;
  } catch { return null; }
}
