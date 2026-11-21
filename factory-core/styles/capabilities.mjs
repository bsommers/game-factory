// styles.* capabilities in the core registry format:
//   { name, summary, inputSchema, outputSchema, handler(input) -> { ok, data, error, next } }
// Every handler is synchronous, side-effect free except styles.apply (which only writes inside input.project).
import { listStyles, showStyle, recommend, applyStyle, validateAll, validateTheme, validatePreset, loadPresets, loadThemes, ok, fail } from './index.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const result = { type: 'object', required: ['ok', 'data', 'error', 'next'], properties: { ok: { type: 'boolean' }, data: {}, error: { type: ['object', 'null'] }, next: { type: 'array', items: { type: 'string' } } } };
const outputSchema = result;

export const capabilities = [
  {
    name: 'styles.list', summary: 'List game style presets (optionally filtered by camera, dimension or tag) and the available themes.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { camera: { type: 'string' }, dimension: { type: 'string', enum: ['2d', '2.5d', '3d', 'text'] }, tag: { type: 'string' } } },
    outputSchema,
    handler: (i = {}) => ok({ styles: listStyles(i), themes: loadThemes().map((t) => ({ id: t.id, name: t.name, description: t.description })) }, ['styles.show {id}', 'styles.recommend {idea}']),
  },
  {
    name: 'styles.show', summary: 'Show one style preset in full with its theming guide; optionally the compatible themes.',
    inputSchema: { type: 'object', required: ['id'], additionalProperties: false, properties: { id: { type: 'string' }, themes: { type: 'boolean' } } },
    outputSchema,
    handler: (i = {}) => (i.id ? showStyle(i.id, { themes: !!i.themes }) : fail('BAD_INPUT', 'id is required')),
  },
  {
    name: 'styles.recommend', summary: 'Rank style presets for a free-text game idea plus constraints (platform, team, budget, device, dimension, camera). Deterministic scoring with reasons and trade-offs.',
    inputSchema: { type: 'object', required: ['idea'], additionalProperties: false, properties: {
      idea: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: 11 },
      constraints: { type: 'object', additionalProperties: false, properties: {
        platform: { type: 'string', enum: ['web', 'desktop', 'terminal'] }, team: { type: 'integer', minimum: 1 },
        budget: { type: 'string', enum: ['low', 'medium', 'high'] }, device: { type: 'string', enum: ['low', 'mid', 'high'] },
        dimension: { type: 'string', enum: ['2d', '3d'] }, camera: { type: 'string' }, avoid: { type: 'array', items: { type: 'string' } } } } } },
    outputSchema,
    handler: (i = {}) => (typeof i.idea === 'string' && i.idea.trim() ? ok(recommend(i), ['styles.show {id: top choice}', 'styles.apply {project, style}']) : fail('BAD_INPUT', 'idea is required')),
  },
  {
    name: 'styles.apply', summary: 'Write a style (and optional theme) into a project: config/style.json, config/theme.json and the "style" key of factory.config.json; lists kits/libs/skills to install. Never overwrites differing files without yes. Idempotent.',
    inputSchema: { type: 'object', required: ['project', 'style'], additionalProperties: false, properties: { project: { type: 'string' }, style: { type: 'string' }, theme: { type: 'string', description: 'theme id or path to a theme.json' }, yes: { type: 'boolean' }, dryRun: { type: 'boolean' } } },
    outputSchema,
    handler: (i = {}) => applyStyle(i),
  },
  {
    name: 'styles.validate', summary: 'Validate presets and themes (schema plus semantic checks), or a given file, optionally for a style.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, theme: { type: 'string' }, file: { type: 'string', description: 'path to a style.json or theme.json to check' }, style: { type: 'string', description: 'with file (theme): style it is applied to' } } },
    outputSchema,
    handler: (i = {}) => {
      if (i.file) {
        let obj; try { obj = JSON.parse(readFileSync(resolve(i.file), 'utf8')); } catch (e) { return fail('BAD_INPUT', `cannot read JSON: ${e.message}`); }
        const isTheme = !!obj.palette && !!obj.palette.colors;
        const errors = isTheme ? validateTheme(obj, { style: i.style }) : validatePreset(obj);
        const data = { kind: isTheme ? 'theme' : 'style', file: i.file, errors };
        return errors.length ? { ok: false, data, error: { code: 'INVALID', message: `${errors.length} problem(s)` }, next: [] } : ok(data);
      }
      return validateAll(i);
    },
  },
];

// Register into a core registry: accepts an array, a Map, or an object with register(cap).
export function registerStyles(registry) {
  for (const c of capabilities) {
    if (Array.isArray(registry)) registry.push(c);
    else if (registry instanceof Map) registry.set(c.name, c);
    else if (registry && typeof registry.register === 'function') registry.register(c);
    else throw new TypeError('registerStyles: unsupported registry');
  }
  return registry;
}
export default capabilities;
