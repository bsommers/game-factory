// Generic template scaffolder: copy tree, substitute __NAME__/__SLUG__ in text files, drop .tmpl, sync swarm tools, git init.
import { cpSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const FACT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
const isText = (buf) => !buf.subarray(0, 8000).includes(0);

function walk(dir, fn) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, fn); else fn(p);
  }
}

export function scaffoldFromTemplate({ templateDir, dir, title, fact = FACT }) {
  if (!existsSync(templateDir)) throw new Error(`template ${templateDir} missing`);
  const slug = slugify(title);
  cpSync(templateDir, dir, { recursive: true });
  const files = []; walk(dir, (p) => files.push(p));
  for (const p of files) {
    const buf = readFileSync(p);
    let out = p;
    if (isText(buf)) writeFileSync(p, buf.toString('utf8').split('__NAME__').join(title).split('__SLUG__').join(slug));
    if (p.endsWith('.tmpl')) { out = p.slice(0, -5); renameSync(p, out); }
  }
  // swarm/tools sync, same as the web path
  mkdirSync(join(dir, 'tools/swarm-tracker'), { recursive: true });
  mkdirSync(join(dir, 'docs/swarm'), { recursive: true });
  for (const f of readdirSync(join(fact, 'tools'))) if (/\.(sh|mjs)$/.test(f)) cpSync(join(fact, 'tools', f), join(dir, 'tools', f));
  for (const d of ['bin', 'dashboard']) if (existsSync(join(fact, 'swarm', d))) cpSync(join(fact, 'swarm', d), join(dir, 'tools/swarm-tracker', d), { recursive: true });
  const cp = (a, b) => { if (existsSync(join(fact, a))) cpSync(join(fact, a), join(dir, b)); };
  cp('swarm/templates/SWARM.md', 'docs/swarm/SWARM.md'); cp('swarm/templates/CHECKPOINT.md', 'docs/CHECKPOINT.md');
  cp('swarm/templates/LEARNINGS.md', 'docs/LEARNINGS.md'); cp('swarm/PLAYBOOK.md', 'docs/PLAYBOOK.md');
  // conformance spec + golden vectors (v1 engines and any v2/v3 present) so the ported engines' tests find them
  if (existsSync(join(fact, 'spec'))) cpSync(join(fact, 'spec'), join(dir, 'spec'), { recursive: true });
  const gi = join(dir, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '.tracker/\nout/\ndist/\n*.log\ntarget/\n__pycache__/\n.venv/\ndocs/CHECKPOINT.md\ndocs/swarm/prompts/\ndocs/swarm/progress/\n');
  if (!existsSync(join(dir, 'README.md'))) writeFileSync(join(dir, 'README.md'), `# ${title}\n\nScaffolded by game-factory.\n`);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  return { slug };
}
