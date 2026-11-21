// Capability registry: the single source of truth behind CLI, HTTP, MCP and scripts.
// Capability = { name, summary, inputSchema, outputSchema, handler(input) -> {ok,data,error,next} | Promise<same> }.
import { validate } from './schema.mjs';
export const ok = (data, next = []) => ({ ok: true, data, error: null, next });
export const fail = (code, message, details, next = []) => ({ ok: false, data: null, error: { code, message, ...(details ? { details } : {}) }, next });
// stable exit codes shared by the CLI (and mapped to HTTP statuses by the API)
export const EXIT = { OK: 0, FAILED: 1, USAGE: 2, NOT_FOUND: 3, CONFLICT: 4 };
export const exitCodeFor = (res) => (res.ok ? 0 : ({ BAD_INPUT: 2, UNKNOWN_CAPABILITY: 3, NOT_FOUND: 3, EXISTS: 4, CONFLICT: 4 })[res.error?.code] ?? 1);

export function createRegistry() {
  const map = new Map();
  const reg = {
    map,
    register(cap) {
      for (const k of ['name', 'summary', 'inputSchema', 'outputSchema', 'handler']) if (cap[k] === undefined) throw new TypeError(`capability ${cap.name || '?'} lacks ${k}`);
      map.set(cap.name, cap); return reg;
    },
    push(...caps) { caps.forEach((c) => reg.register(c)); return map.size; }, // lets registerX treat us as an array too
    get: (n) => map.get(n),
    has: (n) => map.has(n),
    list: () => [...map.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
    describe: () => reg.list().map(({ name, summary, inputSchema, outputSchema }) => ({ name, summary, inputSchema, outputSchema })),
    async call(name, input = {}) {
      const cap = map.get(name);
      if (!cap) return fail('UNKNOWN_CAPABILITY', `no capability "${name}"`, { suggestions: reg.list().map((c) => c.name).filter((n) => n.startsWith(name.split('.')[0])).slice(0, 8) });
      const errors = validate(cap.inputSchema, input ?? {});
      if (errors.length) return fail('BAD_INPUT', `invalid input for ${name}`, errors);
      try {
        const r = await cap.handler(input ?? {});
        return r && typeof r.ok === 'boolean' ? { ok: r.ok, data: r.data ?? null, error: r.error ?? null, next: r.next ?? [] } : ok(r);
      } catch (e) { return fail('INTERNAL', e.message); }
    },
  };
  return reg;
}
