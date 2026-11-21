// Entry point: buildRegistry() registers styles, library (+registry), guide, then the core capabilities.
import { createRegistry } from './registry.mjs';
import { registerStyles } from './styles/capabilities.mjs';
import { registerLibrary } from './library/capabilities.mjs';
import { registerGuide } from './guide/capabilities.mjs';
import { registerCore } from './capabilities/core.mjs';
export * from './registry.mjs';
export { validate } from './schema.mjs';
export function buildRegistry() {
  const r = createRegistry();
  registerStyles(r); registerLibrary(r); registerGuide(r); registerCore(r);
  return r;
}
export const FACTORY_ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
