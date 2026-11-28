// Adapter: import assets from a game project that follows the web-project art/audio pattern
// (PawFall, catxzzon...): src/core/defs.js exports ART (rows {module,name,w,h,frames,kind,desc}), SFX and MUSIC name lists;
// src/art/<module>.js exports build() -> { name: PixBuf | PixBuf[] }; src/audio/sfx.js exports describe/renderSfx/duration;
// src/audio/music.js exports describeMusic/renderMusic.
// NOTE: this imports the PROJECT's own code (the project is yours); never point it at an untrusted checkout.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { previewOf, stripOf, encodePNG, waveformPNG, wavBytes } from '../png.mjs';

const SR = 22050;
const imp = (p) => import(pathToFileURL(p).href);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'game';
const SPRITE_CRITTERS = /^(log|stilllog|cheese|cheese_thrown|fire|tr_.*)$/;

function typeOfRow(r) {
  if (r.module === 'fx') return 'fx';
  if (r.kind === 'tile') return 'tileset';
  if (r.module === 'colby') return 'character';
  if (r.module === 'critters') return SPRITE_CRITTERS.test(r.name) ? 'sprite' : 'character';
  return 'sprite';
}
function readStyle(project) {
  for (const f of ['factory.config.json', 'config/style.json']) {
    try { const o = JSON.parse(readFileSync(join(project, f), 'utf8')); const id = o.style?.id || o.style?.name || (typeof o.style === 'string' ? o.style : null) || o.id; if (typeof id === 'string' && /^[a-z0-9-]+$/.test(id)) return id; } catch { /* none */ }
  }
  return null;
}
const hexOf = (r, g, b) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function collect({ project, types, names, game, styleTag }) {
  const defsPath = join(project, 'src', 'core', 'defs.js');
  if (!existsSync(defsPath)) throw new Error(`not a web-project game (missing src/core/defs.js): ${project}`);
  const defs = await imp(defsPath), gameName = game || basename(project), g = slug(gameName);
  const style = styleTag || readStyle(project), styleTags = style ? [`style:${style}`] : [];
  const want = (type, name) => (!types || !types.length || types.includes(type)) && (!names || !names.length || names.includes(name));
  const items = [];
  const ART = Array.isArray(defs.ART) ? defs.ART : [];
  const mods = [...new Set(ART.map((r) => r.module))];
  for (const mod of mods) {
    const rows = ART.filter((r) => r.module === mod && want(typeOfRow(r), r.name));
    if (!rows.length) continue;
    // Resolution variants: a module like px16/chars may have siblings px32/chars (same names, bigger frames). Each is exported as
    // `<name>-px32` with tag variant:px32; the base item keeps its id. Multi-frame items also ship per-frame PNGs.
    const m = /^(px\d+)\/(.+)$/.exec(mod);
    const variantMods = [mod];
    if (m && existsSync(join(project, 'src', 'art'))) {
      for (const d of readdirSync(join(project, 'src', 'art'))) if (/^px\d+$/.test(d) && d !== m[1] && existsSync(join(project, 'src', 'art', d, `${m[2]}.js`))) variantMods.push(`${d}/${m[2]}`);
    }
    for (const vmod of variantMods) {
      const vtag = vmod === mod ? null : vmod.split('/')[0];
      let built;
      try { built = (await imp(join(project, 'src', 'art', `${vmod}.js`))).build(); } catch (e) { if (!vtag) throw e; continue; }
      for (const r of rows) {
        const v = built[r.name], frames = (Array.isArray(v) ? v : [v]).filter((p) => p && p.rgba);
        if (!frames.length) { if (vtag) continue; throw new Error(`art module ${vmod} did not build ${r.name}`); }
        const strip = stripOf(frames.map((p) => ({ w: p.w, h: p.h, rgba: p.rgba }))), type = typeOfRow(r), pal = new Set();
        for (let i = 0; i < strip.rgba.length; i += 4) if (strip.rgba[i + 3] >= 128) pal.add(hexOf(strip.rgba[i], strip.rgba[i + 1], strip.rgba[i + 2]));
        const files = [{ path: `${r.name}.png`, data: encodePNG(strip.w, strip.h, strip.rgba) }];
        if (frames.length > 1) frames.forEach((f, k) => files.push({ path: `${r.name}_${k}.png`, data: encodePNG(f.w, f.h, f.rgba) }));
        const it = {
          id: `${g}.${r.name.replace(/_/g, '-')}${vtag ? '-' + vtag : ''}`, type, name: vtag ? `${r.name}-${vtag}` : r.name, description: r.desc || r.name, format: 'png-strip-rgba',
          size: { w: frames[0].w, h: frames[0].h, frames: frames.length },
          tags: [g, `module:${vmod.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase()}`, 'pixel-art', ...(frames.length > 1 ? ['animated'] : []), ...(vtag ? [`variant:${vtag}`] : []), ...styleTags],
          provenance: { game: gameName, generator: `src/art/${vmod}.js build() (deterministic, procedural)` },
          files,
          preview: { path: 'preview.png', data: previewOf(strip, 256, 2) },
        };
        if (pal.size && pal.size <= 256) it.palette = [...pal].sort();
        items.push(it);
      }
    }
  }
  if (!types || !types.length || types.includes('sfx')) {
    const sfx = await imp(join(project, 'src', 'audio', 'sfx.js'));
    for (const n of (defs.SFX || [])) {
      if (!want('sfx', n)) continue;
      const voices = sfx.describe(n), pcm = sfx.renderSfx(n, SR);
      items.push({
        id: `${g}.sfx-${n.replace(/_/g, '-')}`, type: 'sfx', name: n, description: `Sound effect "${n}" (${voices.length} voices)`, format: 'wav-pcm16-mono-22050',
        duration: Math.round(pcm.length / SR * 1000) / 1000, tags: [g, 'sfx', 'chiptune', 'procedural', ...styleTags],
        provenance: { game: gameName, generator: 'src/audio/sfx.js recipe (voices JSON included)' },
        files: [{ path: `${n}.wav`, data: wavBytes(pcm, SR) }, { path: `${n}.voices.json`, data: Buffer.from(JSON.stringify(voices, null, 1) + '\n') }],
        preview: { path: 'preview.png', data: waveformPNG(pcm) },
      });
    }
  }
  if (!types || !types.length || types.includes('song')) {
    const mus = await imp(join(project, 'src', 'audio', 'music.js'));
    for (const n of (defs.MUSIC || [])) {
      if (!want('song', n)) continue;
      const T = mus.describeMusic(n), pcm = mus.renderMusic(n, SR);
      items.push({
        id: `${g}.song-${n.replace(/_/g, '-')}`, type: 'song', name: n, description: `Music track "${n}": ${T.bpm} bpm, ${T.bars} bars, ${T.loop ? 'loops' : 'one-shot sting'}`, format: 'wav-pcm16-mono-22050',
        duration: Math.round(pcm.length / SR * 100) / 100, tags: [g, 'music', 'chiptune', 'procedural', T.loop ? 'loop' : 'sting', ...styleTags],
        provenance: { game: gameName, generator: 'src/audio/music.js tracker pattern (rendered offline)' },
        files: [{ path: `${n}.wav`, data: wavBytes(pcm, SR) }],
        preview: { path: 'preview.png', data: waveformPNG(pcm, 256, 48) },
      });
    }
  }
  return items;
}
