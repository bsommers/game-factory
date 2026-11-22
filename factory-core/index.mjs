// Entry point: buildRegistry() registers styles, library (+registry), guide, then the core capabilities.
import { createRegistry } from './registry.mjs';
import { fileURLToPath } from 'node:url';
import { registerStyles } from './styles/capabilities.mjs';
import { registerLibrary } from './library/capabilities.mjs';
import { registerGuide } from './guide/capabilities.mjs';
import { registerCore } from './capabilities/core.mjs';
import { registerLanguages } from './languages/capabilities.mjs';
import { registerPackage } from './package/capabilities.mjs';
import { registerClients } from './clients/capabilities.mjs';
import { registerRendering } from './rendering/capabilities.mjs';
import { registerModels } from './models/index.mjs';
import { registerAnim } from './anim/index.mjs';
import { registerMeshy } from './meshy/index.mjs';
import { registerGodot } from './godot/index.mjs';
export * from './registry.mjs';
export { validate } from './schema.mjs';
export function buildRegistry() {
  const r = createRegistry();
  registerStyles(r); registerLibrary(r); registerGuide(r); registerCore(r);
  registerLanguages(r); registerPackage(r); registerClients(r); registerRendering(r); registerModels(r); registerAnim(r); registerMeshy(r); registerGodot(r);
  return r;
}
export const FACTORY_ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
