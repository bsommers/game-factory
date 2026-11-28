// JSON recipe -> Mesh. Deterministic, bounded. Part: {prim, args?, translate?, rotate?, scale?, mirror?, material?, parts?}
// A part with `parts` (and no prim) is a group whose transform applies to its children.
import * as M from '../../templates/web-project/src/lib/mesh.js';

export const PRIMITIVES = {
  box: M.box, sphere: M.sphere, icosphere: M.icosphere, cylinder: M.cylinder, cone: M.cone, capsule: M.capsule, torus: M.torus,
  plane: M.plane, grid: M.grid, lathe: (a) => M.lathe(a.profile, a),
  extrude: (a) => M.extrude(a.polygon, a.depth ?? 1, a.holes || []), heightmap: (a) => M.heightmap(a.heights, a),
};
const LIMITS = { parts: 5000, depth: 8, segments: 512, triangles: 3_000_000 };
const clampArgs = (a) => { for (const k of ['segments', 'rings', 'tubeSegments']) if (a[k] !== undefined && !(a[k] >= 3 && a[k] <= LIMITS.segments)) throw new Error(`${k} must be 3..${LIMITS.segments}`); if (a.subdivisions !== undefined && !(a.subdivisions >= 0 && a.subdivisions <= 6)) throw new Error('subdivisions must be 0..6'); return a; };

export function buildFromRecipe(recipe) {
  let count = 0;
  const build = (part, depth) => {
    if (depth > LIMITS.depth) throw new Error('recipe nesting too deep');
    if (++count > LIMITS.parts) throw new Error(`recipe has more than ${LIMITS.parts} parts`);
    let m;
    if (part.parts) m = M.merge(part.parts.map((p) => build(p, depth + 1)));
    else {
      const f = PRIMITIVES[part.prim];
      if (!f) throw new Error(`unknown primitive "${part.prim}" (${Object.keys(PRIMITIVES).join(', ')}, or a group with parts)`);
      m = f(clampArgs({ ...(part.args || {}) }));
    }
    if (part.material) m = M.setMaterial(m, part.material);
    if (part.mirror) m = M.mirror(m, part.mirror);
    if (part.translate || part.rotate || part.scale !== undefined) m = M.transform(m, { translate: part.translate, rotate: part.rotate, scale: part.scale });
    if (m.indices.length / 3 > LIMITS.triangles) throw new Error('recipe produces too many triangles');
    return m;
  };
  const out = build({ parts: recipe.parts || [] }, 0);
  if (!out.indices.length) throw new Error('recipe produced no geometry');
  return recipe.weld === true ? M.weld(out, 1e-6) : out; // default keeps uv seams; validate()/3MF weld by position themselves
}
