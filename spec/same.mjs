// Drift comparison that tolerates cross-platform float noise (Math.sin/cos etc. differ by an ulp between CPUs/OSes).
// Structure, strings, bools, null and integer-valued numbers must match exactly; any non-integer number matches within tol.
export function same(a, b, tol = 1e-9) {
  if (typeof a === 'number' && typeof b === 'number') return a === b || ((!Number.isInteger(a) || !Number.isInteger(b)) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)));
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i], tol));
  if (a && typeof a === 'object') { if (!b || typeof b !== 'object' || Array.isArray(b)) return false; const k = Object.keys(a); return k.length === Object.keys(b).length && k.every((key) => key in b && same(a[key], b[key], tol)); }
  return a === b;
}
