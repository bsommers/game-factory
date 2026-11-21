// Tiny JSON-Schema validator (subset + anyOf). Returns string[] of "path: problem". Zero deps.
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);
export function validate(schema, value, path = '$') {
  const errs = [];
  const walk = (s, v, p) => {
    if (!s || typeof s !== 'object') return;
    if (s.anyOf) { if (!s.anyOf.some((a) => validate(a, v, p).length === 0)) errs.push(`${p}: matches none of the allowed forms`); return; }
    if (s.type) { const ts = [].concat(s.type); if (!ts.some((t) => isType(v, t))) { errs.push(`${p}: expected ${ts.join('|')}, got ${typeOf(v)}`); return; } }
    if (s.enum && !s.enum.includes(v)) errs.push(`${p}: must be one of ${s.enum.join(', ')}`);
    if (s.const !== undefined && v !== s.const) errs.push(`${p}: must equal ${JSON.stringify(s.const)}`);
    if (typeof v === 'string') {
      if (s.minLength !== undefined && v.length < s.minLength) errs.push(`${p}: shorter than ${s.minLength}`);
      if (s.maxLength !== undefined && v.length > s.maxLength) errs.push(`${p}: longer than ${s.maxLength}`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) errs.push(`${p}: does not match ${s.pattern}`);
    }
    if (typeof v === 'number') { if (s.minimum !== undefined && v < s.minimum) errs.push(`${p}: below ${s.minimum}`); if (s.maximum !== undefined && v > s.maximum) errs.push(`${p}: above ${s.maximum}`); }
    if (Array.isArray(v)) { if (s.minItems !== undefined && v.length < s.minItems) errs.push(`${p}: needs >= ${s.minItems} items`); if (s.maxItems !== undefined && v.length > s.maxItems) errs.push(`${p}: needs <= ${s.maxItems} items`); if (s.items) v.forEach((x, i) => walk(s.items, x, `${p}[${i}]`)); }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const r of s.required || []) if (v[r] === undefined) errs.push(`${p}.${r}: required`);
      const props = s.properties || {};
      for (const [k, x] of Object.entries(v)) {
        if (props[k]) walk(props[k], x, `${p}.${k}`);
        else if (s.additionalProperties === false) errs.push(`${p}.${k}: unknown property`);
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, x, `${p}.${k}`);
      }
    }
  };
  walk(schema, value, path);
  return errs;
}
