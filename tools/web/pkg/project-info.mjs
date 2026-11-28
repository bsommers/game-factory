// Project identity for build/package tools: slug (binary + archive names), title (window, .app, shortcuts), appId, version.
// Source of truth: package.json (name, version) and <title> in index.html. Override with a "game" block in package.json:
//   "game": { "slug": "lantern-run", "title": "Lantern Run", "appId": "dev.example.lantern-run", "icon": "assets/icon.png" }
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game';

export function projectInfo(root) {
  const pkg = existsSync(join(root, 'package.json')) ? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) : {};
  const g = pkg.game ?? {};
  const html = existsSync(join(root, 'index.html')) ? readFileSync(join(root, 'index.html'), 'utf8') : '';
  const htmlTitle = (html.match(/<title>([^<]*)<\/title>/i) ?? [])[1]?.trim();
  const slug = slugify(g.slug ?? pkg.name ?? 'game');
  return {
    slug,
    title: g.title ?? htmlTitle ?? slug,
    appId: g.appId ?? `dev.${slug.replace(/-/g, '')}.game`,
    version: pkg.version ?? '0.1.0',
    icon: g.icon ?? 'assets/icon.png',
  };
}

// CLI for shell scripts: eval "$(node tools/project-info.mjs --sh)" -> SLUG, TITLE, APPID, VERSION
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--sh')) {
  const i = projectInfo(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  console.log(`SLUG=${q(i.slug)}; TITLE=${q(i.title)}; APPID=${q(i.appId)}; VERSION=${q(i.version)}`);
}
